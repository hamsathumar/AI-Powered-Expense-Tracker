/**
 * Backup file format + validation — pure, dependency-free so it can be
 * unit-tested and so the untrusted-input check never depends on the DB layer.
 * The DB-side export/restore lives in src/db/backup.ts.
 */

/** Tables exported/restored, in FK-safe insert order. */
export const BACKUP_TABLES = [
  'accounts',
  'categories',
  'people',
  'recurring_templates',
  'transactions',
  'settings',
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

export const BACKUP_APP = 'Kaasu';
export const BACKUP_VERSION = 1;

export interface KaasuBackup {
  app: typeof BACKUP_APP;
  version: number;
  schemaVersion: number;
  exportedAt: string;
  tables: Record<BackupTable, Record<string, unknown>[]>;
}

export function backupFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `kaasu-backup-${stamp}.json`;
}

/** Parse + validate untrusted file text as a Kaasu backup, or throw. */
export function parseBackup(text: string): KaasuBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (!data || typeof data !== 'object') throw new Error('Not a Kaasu backup file.');
  const backup = data as Partial<KaasuBackup>;
  if (backup.app !== BACKUP_APP) throw new Error('Not a Kaasu backup file.');
  if (typeof backup.version !== 'number' || backup.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of Kaasu.');
  }
  if (!backup.tables || typeof backup.tables !== 'object') {
    throw new Error('Backup is missing its data.');
  }
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(backup.tables[table])) {
      throw new Error(`Backup is missing the "${table}" table.`);
    }
  }
  return backup as KaasuBackup;
}
