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
import type { SQLiteDatabase } from 'expo-sqlite';

import { seedDefaultCategories } from '@/db/seed';

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
  {
    // Recurring redesign: three-state lifecycle (active/paused/cancelled),
    // a meta group taxonomy for the summary bar, and loan/installment fields.
    // The legacy `active` INTEGER column is kept in sync on writes so nothing
    // stale breaks, but `status` is now authoritative.
    version: 3,
    up: async (db) => {
      await db.execAsync(`
        ALTER TABLE recurring_templates
          ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active','paused','cancelled'));
        ALTER TABLE recurring_templates ADD COLUMN paused_until TEXT;
        ALTER TABLE recurring_templates
          ADD COLUMN recurring_group TEXT
          CHECK (recurring_group IN ('subscription','bill','rent','loan','other'));
        ALTER TABLE recurring_templates ADD COLUMN total_installments INTEGER;
        ALTER TABLE recurring_templates ADD COLUMN principal_amount INTEGER;

        UPDATE recurring_templates
          SET status = CASE WHEN active = 1 THEN 'active' ELSE 'cancelled' END;
        UPDATE recurring_templates
          SET recurring_group = 'other' WHERE recurring_group IS NULL;
      `);
    },
  },
  {
    // Transaction AI V1: application-owned pending store for AI-interpreted
    // operations. Kept SEPARATE from `transactions` (the authoritative ledger)
    // so an AI operation with unresolved account/category can exist as a
    // reviewable pending item WITHOUT ever polluting the ledger. Rows here are
    // committed into `transactions` (as approved) only after the final safety
    // gate passes; nothing here is a financial record.
    version: 4,
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE pending_operations (
          id              TEXT PRIMARY KEY,
          kind            TEXT NOT NULL,   -- income|expense|transfer|lending|bill_split|recurring
          operation       TEXT NOT NULL,  -- underlying ordinary type
          name            TEXT NOT NULL,
          amount          INTEGER NOT NULL CHECK (amount > 0),
          transcript      TEXT,
          date_expression TEXT,
          has_conflicts   INTEGER NOT NULL DEFAULT 0,
          payload         TEXT NOT NULL,  -- JSON ResolvedOperation (incl. user edits)
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL
        );
        CREATE INDEX idx_pending_ops_created ON pending_operations(created_at);
      `);
    },
  },
  {
    // ── v5 — durable voice-parse jobs (TC-027) ─────────────────────────────
    // Interpretation used to live entirely inside the voice screen's React
    // state, so backgrounding the app (or leaving the screen) stalled the parse
    // and killing the app lost the recording outright. A job row makes the work
    // survive both: the runner picks up anything unfinished the next time the
    // app is in the foreground.
    //
    // This is NOT a financial table. A job only ever produces rows in
    // `pending_operations`, which still face the approval gate — the safety
    // boundary is unchanged.
    version: 5,
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE voice_jobs (
          id           TEXT PRIMARY KEY,
          audio_uri    TEXT NOT NULL,
          audio_mime   TEXT NOT NULL,
          transcript   TEXT,            -- on-device transcript (display only)
          status       TEXT NOT NULL,   -- queued|running|done|failed
          attempts     INTEGER NOT NULL DEFAULT 0,
          error        TEXT,
          pending_ids  TEXT,            -- JSON array of pending_operations ids
          result_transcript TEXT,        -- what Gemini transcribed (may differ from on-device)
          unqualified_count INTEGER NOT NULL DEFAULT 0, -- intents heard without an amount
          notified     INTEGER NOT NULL DEFAULT 0,
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL
        );
        CREATE INDEX idx_voice_jobs_status ON voice_jobs(status, created_at);
      `);
    },
  },
  {
    // ── v6 — a pending operation may be waiting for its AMOUNT (audit F3) ──
    // Until now an intent the user clearly voiced but without a resolvable
    // amount ("I paid the electricity bill") was thrown away after validation:
    // only a count survived, so the information was unrecoverable. Those
    // intents now enter the queue as ordinary pending rows with a NULL amount,
    // which the user completes on the review screen.
    //
    // `CHECK (amount > 0)` has to go for that, and SQLite cannot drop a CHECK
    // in place — the table is rebuilt. The safety boundary is untouched: the
    // final gate blocks any operation whose amount is not a positive integer,
    // so a NULL-amount row can never reach the ledger.
    version: 6,
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE pending_operations_v6 (
          id              TEXT PRIMARY KEY,
          kind            TEXT NOT NULL,
          operation       TEXT NOT NULL,
          name            TEXT NOT NULL,
          amount          INTEGER CHECK (amount IS NULL OR amount > 0),
          transcript      TEXT,
          date_expression TEXT,
          has_conflicts   INTEGER NOT NULL DEFAULT 0,
          payload         TEXT NOT NULL,
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL
        );
        INSERT INTO pending_operations_v6
          SELECT id, kind, operation, name, amount, transcript, date_expression,
                 has_conflicts, payload, created_at, updated_at
          FROM pending_operations;
        DROP TABLE pending_operations;
        ALTER TABLE pending_operations_v6 RENAME TO pending_operations;
        CREATE INDEX idx_pending_ops_created ON pending_operations(created_at);
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
