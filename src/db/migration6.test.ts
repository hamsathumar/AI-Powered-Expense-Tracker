/// <reference types="node" />
/**
 * Executes migration 6 against a REAL SQLite engine (node's built-in
 * `node:sqlite`), using the SQL exactly as it ships in `migrations.ts`.
 *
 * Why this exists: migration 6 is the first migration that REBUILDS an
 * existing table rather than adding one — SQLite cannot drop a CHECK
 * constraint in place, so `pending_operations` is recreated and copied. A
 * mistake there does not fail a pure-logic test; it fails on the user's phone,
 * on real data, at launch. The v4 table definition and the v6 migration are
 * both read out of `migrations.ts` so this can never drift from what ships.
 *
 * What it proves: existing rows survive the rebuild intact, the index is back,
 * a NULL amount is now accepted (audit F3), and a zero/negative amount is
 * still refused.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

let db: DatabaseSync;

function migrationsSource(): string {
  return readFileSync(join(__dirname, 'migrations.ts'), 'utf8');
}

/** The v4 `pending_operations` table, as originally shipped. */
function pendingOperationsV4(): string {
  const match = migrationsSource().match(
    /(CREATE TABLE pending_operations \([\s\S]*?\);[\s\S]*?CREATE INDEX idx_pending_ops_created ON pending_operations\(created_at\);)/,
  );
  if (!match) throw new Error('Could not find the v4 pending_operations DDL in migrations.ts');
  return match[1]!;
}

/** The body of migration 6's `execAsync` template literal. */
function migration6(): string {
  const match = migrationsSource().match(
    /version: 6,[\s\S]*?await db\.execAsync\(`([\s\S]*?)`\);/,
  );
  if (!match) throw new Error('Could not find migration 6 in migrations.ts');
  return match[1]!;
}

function insertRow(id: string, amount: number | null): void {
  db.prepare(
    `INSERT INTO pending_operations
       (id, kind, operation, name, amount, transcript, date_expression, has_conflicts, payload, created_at, updated_at)
     VALUES (?, 'expense', 'expense', ?, ?, 'said it', 'yesterday', 0, '{}', '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z')`,
  ).run(id, `Row ${id}`, amount);
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(pendingOperationsV4());
});

afterEach(() => {
  db.close();
});

describe('migration 6 — pending_operations may await its amount', () => {
  it('the v4 table refuses a NULL amount (the constraint this migration removes)', () => {
    expect(() => insertRow('before', null)).toThrow();
  });

  it('carries existing rows through the rebuild unchanged', () => {
    insertRow('keep-1', 80000);
    insertRow('keep-2', 45050);

    db.exec(migration6());

    const rows = db
      .prepare('SELECT id, name, amount, transcript, date_expression, created_at FROM pending_operations ORDER BY id')
      .all() as { id: string; name: string; amount: number; transcript: string; date_expression: string }[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toEqual(['keep-1', 'keep-2']);
    expect(rows.map((r) => r.amount)).toEqual([80000, 45050]);
    expect(rows[0]!.transcript).toBe('said it');
    expect(rows[0]!.date_expression).toBe('yesterday');
  });

  it('accepts a NULL amount afterwards (audit F3)', () => {
    db.exec(migration6());
    expect(() => insertRow('needs-amount', null)).not.toThrow();
    const row = db.prepare('SELECT amount FROM pending_operations WHERE id = ?').get('needs-amount') as {
      amount: number | null;
    };
    expect(row.amount).toBeNull();
  });

  it('still refuses a zero or negative amount', () => {
    db.exec(migration6());
    expect(() => insertRow('zero', 0)).toThrow();
    expect(() => insertRow('negative', -500)).toThrow();
  });

  it('restores the created_at index', () => {
    db.exec(migration6());
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pending_operations'")
      .all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('idx_pending_ops_created');
  });

  it('leaves no scratch table behind', () => {
    db.exec(migration6());
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'pending_operations%'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(['pending_operations']);
  });
});
