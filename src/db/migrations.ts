/**
 * Versioned migration runner.
 *
 * Tracks the schema version with SQLite's built-in `PRAGMA user_version`
 * (starts at 0 on a fresh database). Each migration runs inside a
 * transaction and bumps the version, so a crash mid-migration rolls back
 * cleanly and re-runs next launch. Migrations are append-only: never edit a
 * shipped migration — add a new one.
 *
 * Schema source of truth: technical-plan.md §3.
 */
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { categoryPalette } from '@/theme/tokens';

const SCHEMA_V1 = `
CREATE TABLE accounts (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('bank','card','cash')),
  owner_label     TEXT,
  opening_balance INTEGER NOT NULL DEFAULT 0,
  icon            TEXT,
  color           TEXT,
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);

CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('expense','income')),
  icon       TEXT,
  color      TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE people (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  unresolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE recurring_templates (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  name          TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  account_id    TEXT REFERENCES accounts(id),
  to_account_id TEXT REFERENCES accounts(id),
  category_id   TEXT REFERENCES categories(id),
  person_id     TEXT REFERENCES people(id),
  direction     TEXT,
  frequency     TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','custom')),
  interval_days INTEGER,
  next_due_date TEXT NOT NULL,
  end_date      TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE transactions (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL CHECK (type IN ('expense','income','transfer','lending')),
  status           TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  direction        TEXT CHECK (direction IN
                     ('lend','lend_repayment_received','borrow','borrow_repayment_made')),
  name             TEXT NOT NULL,
  amount           INTEGER NOT NULL CHECK (amount > 0),
  description      TEXT,
  occurred_at      TEXT NOT NULL,
  account_id       TEXT REFERENCES accounts(id),
  to_account_id    TEXT REFERENCES accounts(id),
  category_id      TEXT REFERENCES categories(id),
  person_id        TEXT REFERENCES people(id),
  source           TEXT NOT NULL CHECK (source IN ('voice','manual','recurring','bill_split')),
  transcript       TEXT,
  confidence_flags TEXT,
  bill_split_id    TEXT,
  recurring_id     TEXT REFERENCES recurring_templates(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX idx_tx_status   ON transactions(status);
CREATE INDEX idx_tx_occurred ON transactions(occurred_at);
CREATE INDEX idx_tx_account  ON transactions(account_id);
CREATE INDEX idx_tx_person   ON transactions(person_id);
CREATE INDEX idx_tx_category ON transactions(category_id);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Default categories (spec §3.2) — icon names are Feather icons. */
const DEFAULT_EXPENSE_CATEGORIES: [name: string, icon: string][] = [
  ['Food', 'coffee'],
  ['Groceries', 'shopping-cart'],
  ['Transport', 'navigation'],
  ['Rent', 'home'],
  ['Utilities', 'zap'],
  ['Health', 'heart'],
  ['Shopping', 'shopping-bag'],
  ['Entertainment', 'film'],
  ['Education', 'book'],
  ['Gifts', 'gift'],
  ['Personal', 'user'],
  ['Other', 'more-horizontal'],
];

const DEFAULT_INCOME_CATEGORIES: [name: string, icon: string][] = [
  ['Salary', 'briefcase'],
  ['Business', 'trending-up'],
  ['Freelance', 'pen-tool'],
  ['Interest', 'percent'],
  ['Gift', 'gift'],
  ['Refund', 'rotate-ccw'],
  ['Other', 'more-horizontal'],
];

async function seedDefaultCategories(db: SQLiteDatabase): Promise<void> {
  const insert = await db.prepareAsync(
    `INSERT INTO categories (id, name, kind, icon, color, is_default)
     VALUES ($id, $name, $kind, $icon, $color, 1)`,
  );
  try {
    const seed = async (kind: 'expense' | 'income', list: [string, string][]) => {
      for (const [i, [name, icon]] of list.entries()) {
        await insert.executeAsync({
          $id: Crypto.randomUUID(),
          $name: name,
          $kind: kind,
          $icon: icon,
          $color: categoryPalette[i % categoryPalette.length],
        });
      }
    };
    await seed('expense', DEFAULT_EXPENSE_CATEGORIES);
    await seed('income', DEFAULT_INCOME_CATEGORIES);
  } finally {
    await insert.finalizeAsync();
  }
}

interface Migration {
  version: number;
  up: (db: SQLiteDatabase) => Promise<void>;
}

const migrations: Migration[] = [
  {
    version: 1,
    up: async (db) => {
      await db.execAsync(SCHEMA_V1);
      await seedDefaultCategories(db);
    },
  },
  {
    // One-time cleanup of the Stage 2 dev-db verification rows (Test Cash /
    // Test Kamal and their transactions) from devices that ran the scenario.
    version: 2,
    up: async (db) => {
      await db.execAsync(`
        DELETE FROM transactions
          WHERE account_id IN (SELECT id FROM accounts WHERE name = 'Test Cash')
             OR person_id  IN (SELECT id FROM people   WHERE name = 'Test Kamal');
        DELETE FROM people   WHERE name = 'Test Kamal';
        DELETE FROM accounts WHERE name = 'Test Cash';
      `);
    },
  },
];

export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let current = row?.user_version ?? 0;

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    await db.withTransactionAsync(async () => {
      await migration.up(db);
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
    current = migration.version;
  }
}
