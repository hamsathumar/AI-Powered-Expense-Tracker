/**
 * Local backup / restore / wipe (spec §6 non-functional: "no data loss —
 * add a backup/export before relying on the app").
 *
 * The file format + validation is in `src/domain/backupFormat.ts` (pure).
 * Here: read every table into a backup, REPLACE all data from one (atomic),
 * and wipe to a fresh-install state (default categories re-seeded).
 */
import { getDb } from '@/db/client';
import { seedDefaultCategories } from '@/db/seed';
import {
  BACKUP_APP,
  BACKUP_TABLES,
  BACKUP_VERSION,
  type BackupTable,
  type KaasuBackup,
} from '@/domain/backupFormat';

type Row = Record<string, unknown>;

export async function exportBackup(): Promise<KaasuBackup> {
  const db = await getDb();
  const schema = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const tables = {} as Record<BackupTable, Row[]>;
  for (const table of BACKUP_TABLES) {
    tables[table] = await db.getAllAsync<Row>(`SELECT * FROM ${table}`);
  }
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    schemaVersion: schema?.user_version ?? 0,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

async function insertRows(
  db: Awaited<ReturnType<typeof getDb>>,
  table: BackupTable,
  rows: Row[],
): Promise<void> {
  for (const row of rows) {
    const columns = Object.keys(row);
    if (columns.length === 0) continue;
    const placeholders = columns.map(() => '?').join(', ');
    await db.runAsync(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
      ...columns.map((c) => row[c] as string | number | null),
    );
  }
}

/** REPLACE all data with the backup — atomic (all or nothing). */
export async function restoreBackup(backup: KaasuBackup): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const table of [...BACKUP_TABLES].reverse()) {
      await txn.execAsync(`DELETE FROM ${table}`);
    }
    for (const table of BACKUP_TABLES) {
      await insertRows(txn, table, backup.tables[table]);
    }
  });
}

/** Wipe everything back to a fresh install: empty tables + re-seeded default
 *  categories. Settings are cleared too. */
export async function clearAllData(): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const table of [...BACKUP_TABLES].reverse()) {
      await txn.execAsync(`DELETE FROM ${table}`);
    }
    await seedDefaultCategories(txn);
  });
}
