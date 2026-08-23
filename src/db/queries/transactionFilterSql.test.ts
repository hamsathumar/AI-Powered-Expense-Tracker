/// <reference types="node" />
/**
 * Executes the ledger filter against a real SQLite engine (node's built-in
 * `node:sqlite`) using the app's real schema — the same guard the report SQL
 * has, for the same reason: a template-string WHERE clause is invisible to
 * `tsc` and ESLint, so only running it proves anything.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import {
  hasActiveTransactionFilter,
  transactionFilterWhere,
  type TransactionFilter,
} from './transactionFilterSql';

let db: DatabaseSync;

/** Ids matching the filter, newest first — mirrors listTransactionItems. */
function ids(filter: TransactionFilter): string[] {
  const { sql, params } = transactionFilterWhere(filter);
  const rows = db
    .prepare(`SELECT t.id FROM transactions t WHERE ${sql} ORDER BY t.occurred_at DESC`)
    .all(...params) as { id: string }[];
  return rows.map((r) => r.id);
}

function schemaV1(): string {
  const source = readFileSync(join(__dirname, '../migrations.ts'), 'utf8');
  const match = source.match(/const SCHEMA_V1 = `([\s\S]*?)`;/);
  if (!match) throw new Error('Could not find SCHEMA_V1 in migrations.ts');
  return match[1];
}

function tx(row: {
  id: string;
  type: string;
  status?: string;
  name: string;
  description?: string | null;
  amount: number;
  at: string;
  account?: string | null;
  toAccount?: string | null;
  category?: string | null;
  person?: string | null;
  direction?: string | null;
}) {
  db.prepare(
    `INSERT INTO transactions
       (id, type, status, direction, name, amount, description, occurred_at,
        account_id, to_account_id, category_id, person_id, source, transcript,
        confidence_flags, bill_split_id, recurring_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(
    row.id,
    row.type,
    row.status ?? 'approved',
    row.direction ?? null,
    row.name,
    row.amount,
    row.description ?? null,
    row.at,
    row.account ?? null,
    row.toAccount ?? null,
    row.category ?? null,
    row.person ?? null,
    '2026-08-01T00:00:00Z',
    '2026-08-01T00:00:00Z',
  );
}

beforeAll(() => {
  db = new DatabaseSync(':memory:');
  db.exec(schemaV1());
  db.exec(`
    INSERT INTO accounts VALUES ('a1','Cash','cash',NULL,0,NULL,NULL,0,'2026-08-01');
    INSERT INTO accounts VALUES ('a2','BOC','bank',NULL,0,NULL,NULL,0,'2026-08-01');
    INSERT INTO categories VALUES ('c1','Food','expense',NULL,NULL,1,0);
    INSERT INTO categories VALUES ('c2','Salary','income',NULL,NULL,1,0);
    INSERT INTO people VALUES ('p1','Mateen',0,'2026-08-01');
  `);

  tx({ id: 'e1', type: 'expense', name: 'Lunch', amount: 50_000, at: '2026-08-20T06:00:00Z', account: 'a1', category: 'c1' });
  tx({ id: 'e2', type: 'expense', name: 'Rice, dhal', amount: 30_000, at: '2026-08-21T06:00:00Z', account: 'a2', category: 'c1', description: 'weekly shop' });
  tx({ id: 'i1', type: 'income', name: 'Pocket Money', amount: 500_000, at: '2026-08-22T06:00:00Z', account: 'a1', category: 'c2' });
  tx({ id: 'tr1', type: 'transfer', name: 'To BOC', amount: 20_000, at: '2026-08-23T06:00:00Z', account: 'a1', toAccount: 'a2' });
  tx({ id: 'l1', type: 'lending', direction: 'lend', name: 'Lent Mateen', amount: 200_000, at: '2026-08-23T07:00:00Z', account: 'a1', person: 'p1' });
  tx({ id: 'p1x', type: 'expense', status: 'pending', name: 'Pending tea', amount: 5_000, at: '2026-08-23T08:00:00Z', account: 'a1', category: 'c1' });
  tx({ id: 'r1', type: 'expense', status: 'rejected', name: 'Rejected junk', amount: 9_000, at: '2026-08-23T09:00:00Z', account: 'a1', category: 'c1' });
});

afterAll(() => db?.close());

describe('default listing', () => {
  it('shows every type, newest first, including pending', () => {
    expect(ids({})).toEqual(['p1x', 'l1', 'tr1', 'i1', 'e2', 'e1']);
  });

  it('hides rejected rows but keeps pending ones', () => {
    // Unlike the reports, this ledger must show what is still in the queue.
    expect(ids({}).includes('r1')).toBe(false);
    expect(ids({ statuses: ['pending'] })).toEqual(['p1x']);
  });

  it('shows rejected rows only when asked for by name', () => {
    expect(ids({ statuses: ['rejected'] })).toEqual(['r1']);
  });
});

describe('account filter', () => {
  it('includes transfers where the account is either end', () => {
    // Real money moved through a2 even though it is the destination.
    expect(ids({ accountId: 'a2' }).sort()).toEqual(['e2', 'tr1']);
  });

  it('matches the source account too', () => {
    expect(ids({ accountId: 'a1' })).toEqual(['p1x', 'l1', 'tr1', 'i1', 'e1']);
  });
});

describe('type filter', () => {
  it('narrows to the chosen types', () => {
    expect(ids({ types: ['transfer'] })).toEqual(['tr1']);
    expect(ids({ types: ['expense', 'income'] })).toEqual(['p1x', 'i1', 'e2', 'e1']);
  });
});

describe('category and person filters', () => {
  it('narrows by category', () => {
    expect(ids({ categoryIds: ['c1'] })).toEqual(['p1x', 'e2', 'e1']);
  });

  it('narrows by person', () => {
    expect(ids({ personId: 'p1' })).toEqual(['l1']);
  });
});

describe('date range', () => {
  it('bounds both ends inclusively', () => {
    expect(ids({ startDay: '2026-08-21', endDay: '2026-08-22' })).toEqual(['i1', 'e2']);
  });

  it('accepts an open-ended range', () => {
    expect(ids({ startDay: '2026-08-23' })).toEqual(['p1x', 'l1', 'tr1']);
    expect(ids({ endDay: '2026-08-20' })).toEqual(['e1']);
  });
});

describe('search', () => {
  it('matches the name', () => {
    expect(ids({ search: 'lunch' })).toEqual(['e1']);
  });

  it('matches the description too', () => {
    expect(ids({ search: 'weekly' })).toEqual(['e2']);
  });

  it('ignores surrounding whitespace and matches nothing sensibly', () => {
    expect(ids({ search: '   ' })).toEqual(['p1x', 'l1', 'tr1', 'i1', 'e2', 'e1']);
    expect(ids({ search: 'zzz' })).toEqual([]);
  });
});

describe('combined filters', () => {
  it('applies every clause together', () => {
    expect(
      ids({
        accountId: 'a1',
        types: ['expense', 'income'],
        startDay: '2026-08-20',
        endDay: '2026-08-22',
      }),
    ).toEqual(['i1', 'e1']);
  });

  it('prepares with every field set at once', () => {
    expect(() =>
      ids({
        accountId: 'a1',
        categoryIds: ['c1', 'c2'],
        personId: 'p1',
        types: ['expense', 'income', 'transfer', 'lending'],
        statuses: ['pending', 'approved'],
        startDay: '2026-08-01',
        endDay: '2026-08-31',
        search: 'a',
      }),
    ).not.toThrow();
  });
});

describe('hasActiveTransactionFilter', () => {
  it('is false for an empty filter', () => {
    expect(hasActiveTransactionFilter({})).toBe(false);
    expect(hasActiveTransactionFilter({ types: [], categoryIds: [], search: '  ' })).toBe(false);
  });

  it('is true for any narrowing', () => {
    expect(hasActiveTransactionFilter({ accountId: 'a1' })).toBe(true);
    expect(hasActiveTransactionFilter({ types: ['expense'] })).toBe(true);
    expect(hasActiveTransactionFilter({ startDay: '2026-08-01' })).toBe(true);
    expect(hasActiveTransactionFilter({ search: 'x' })).toBe(true);
  });
});
