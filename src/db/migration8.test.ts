/// <reference types="node" />
/**
 * Migration 8 (accounts.is_private) against a real SQLite engine, using the
 * SQL exactly as it ships: existing accounts survive and start PERSONAL.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from '@jest/globals';

const source = readFileSync(join(__dirname, 'migrations.ts'), 'utf8');
const SCHEMA_V1 = source.match(/const SCHEMA_V1 = `([\s\S]*?)`;/)![1]!;
const MIGRATION_8 = source.match(/version: 8,[\s\S]*?await db\.execAsync\(`([\s\S]*?)`\);/)![1]!;

describe('migration 8 — private accounts', () => {
  it('keeps existing accounts and makes them personal; new ones may be private', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(SCHEMA_V1);
    db.exec(`INSERT INTO accounts (id, name, type, opening_balance, created_at) VALUES ('a', 'Cash', 'cash', -5000, 'x')`);
    db.exec(MIGRATION_8);

    const row = db.prepare('SELECT name, opening_balance, is_private FROM accounts').get() as {
      name: string;
      opening_balance: number;
      is_private: number;
    };
    expect(row).toEqual({ name: 'Cash', opening_balance: -5000, is_private: 0 });

    db.exec(`INSERT INTO accounts (id, name, type, opening_balance, created_at, is_private) VALUES ('r', 'Room', 'cash', 0, 'x', 1)`);
    const priv = db.prepare('SELECT id FROM accounts WHERE is_private = 1').all() as { id: string }[];
    expect(priv.map((r) => r.id)).toEqual(['r']);
    db.close();
  });
});
