/// <reference types="node" />
/**
 * Executes the report SQL against a REAL SQLite engine (node's built-in
 * `node:sqlite`) using the app's REAL schema.
 *
 * Why this exists: the money-math tests are pure and never touched a database,
 * so a statement that SQLite refuses to prepare — or worse, one it prepares but
 * groups wrongly — shipped undetected. `GROUP BY id` did exactly that: with a
 * join it was "ambiguous column name: id", and without one it silently bound to
 * transactions.id and emitted a row per transaction. Both are caught here.
 *
 * The schema is read out of `migrations.ts` rather than copied, so it can never
 * drift from what actually ships. Only SCHEMA_V1 is needed: later migrations
 * touch `recurring_templates` and add new tables, never the four tables the
 * reports read.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import {
  breakdownSql,
  dailyTotalsSql,
  largestTransactionSql,
  rangeSummarySql,
  sliceAllTimeStatsSql,
  slicePeriodStatsSql,
  sliceTransactionIdsSql,
  type BreakdownDim,
  type ReportFilter,
  type Statement,
} from './reportSql';

const AUGUST: ReportFilter = { startDay: '2026-08-01', endDay: '2026-08-31' };

const ALL_DIMS: BreakdownDim[] = ['category', 'account', 'person', 'recurring'];

let db: DatabaseSync;

function run<T = Record<string, unknown>>({ sql, params }: Statement): T[] {
  return db.prepare(sql).all(...params) as T[];
}

function schemaV1(): string {
  const source = readFileSync(join(__dirname, '../migrations.ts'), 'utf8');
  const match = source.match(/const SCHEMA_V1 = `([\s\S]*?)`;/);
  if (!match) throw new Error('Could not find SCHEMA_V1 in migrations.ts');
  return match[1];
}

/** occurred_at is stored UTC; these all land inside August local time. */
function tx(row: {
  id: string;
  type: string;
  status?: string;
  name: string;
  amount: number;
  at: string;
  account?: string | null;
  category?: string | null;
  person?: string | null;
  source?: string;
  direction?: string | null;
}) {
  db.prepare(
    `INSERT INTO transactions
       (id, type, status, direction, name, amount, description, occurred_at,
        account_id, to_account_id, category_id, person_id, source, transcript,
        confidence_flags, bill_split_id, recurring_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(
    row.id,
    row.type,
    row.status ?? 'approved',
    row.direction ?? null,
    row.name,
    row.amount,
    row.at,
    row.account ?? null,
    row.category ?? null,
    row.person ?? null,
    row.source ?? 'manual',
    '2026-08-01T00:00:00Z',
    '2026-08-01T00:00:00Z',
  );
}

beforeAll(() => {
  db = new DatabaseSync(':memory:');
  db.exec(schemaV1());

  db.exec(`
    INSERT INTO accounts VALUES ('a1','Cash','cash',NULL,0,'dollar-sign','#23A866',0,'2026-08-01');
    INSERT INTO accounts VALUES ('a2','Bank','bank',NULL,0,'home','#2C74BE',0,'2026-08-01');
    INSERT INTO categories VALUES ('c1','Food','expense','coffee','#D1462F',1,0);
    INSERT INTO categories VALUES ('c2','Transport','expense','navigation','#F2A925',1,0);
    INSERT INTO categories VALUES ('c3','Salary','income','briefcase','#23A866',1,0);
    INSERT INTO people VALUES ('p1','Nuski',0,'2026-08-01');
    INSERT INTO people VALUES ('p2','Shaam',0,'2026-08-01');
  `);

  // Reportable rows.
  tx({ id: 't1', type: 'expense', name: 'Lunch', amount: 50_000, at: '2026-08-05T06:00:00Z', account: 'a1', category: 'c1', person: 'p1' });
  tx({ id: 't2', type: 'expense', name: 'Dinner', amount: 30_000, at: '2026-08-05T14:00:00Z', account: 'a1', category: 'c1' });
  tx({ id: 't3', type: 'expense', name: 'Bus', amount: 12_000, at: '2026-08-07T04:00:00Z', account: 'a2', category: 'c2', person: 'p1' });
  tx({ id: 't4', type: 'expense', name: 'Netflix', amount: 20_000, at: '2026-08-09T04:00:00Z', account: 'a2', category: 'c1', source: 'recurring' });
  tx({ id: 't5', type: 'income', name: 'Pay', amount: 900_000, at: '2026-08-01T04:00:00Z', account: 'a2', category: 'c3' });

  // Must never appear in any report: not approved, or not expense/income.
  tx({ id: 't6', type: 'expense', status: 'pending', name: 'Pending', amount: 99_999, at: '2026-08-06T04:00:00Z', account: 'a1', category: 'c1' });
  tx({ id: 't7', type: 'transfer', name: 'Transfer', amount: 77_777, at: '2026-08-06T04:00:00Z', account: 'a1' });
  tx({ id: 't8', type: 'lending', direction: 'lend', name: 'Lent', amount: 88_888, at: '2026-08-06T04:00:00Z', account: 'a1', person: 'p2' });

  // Outside the period.
  tx({ id: 't9', type: 'expense', name: 'July food', amount: 40_000, at: '2026-07-15T04:00:00Z', account: 'a1', category: 'c1' });
});

afterAll(() => db?.close());

describe('every statement prepares', () => {
  // The bug this file was written for: SQLite refused to prepare the breakdown
  // because `GROUP BY id` was ambiguous across the join.
  it.each(ALL_DIMS)('breakdown by %s prepares for both kinds', (dim) => {
    expect(() => run(breakdownSql(AUGUST, dim, 'expense'))).not.toThrow();
    expect(() => run(breakdownSql(AUGUST, dim, 'income'))).not.toThrow();
  });

  it('prepares with every filter narrowing applied at once', () => {
    const filter: ReportFilter = {
      ...AUGUST,
      accountId: 'a1',
      personId: 'p1',
      includeCategoryIds: ['c1', 'c2'],
      excludeCategoryIds: ['c2'],
    };
    for (const dim of ALL_DIMS) {
      expect(() => run(breakdownSql(filter, dim, 'expense'))).not.toThrow();
      expect(() => run(slicePeriodStatsSql(filter, dim, 'c1', 'expense'))).not.toThrow();
      expect(() => run(sliceTransactionIdsSql(filter, dim, 'c1', 'expense'))).not.toThrow();
    }
    expect(() => run(rangeSummarySql(filter))).not.toThrow();
    expect(() => run(dailyTotalsSql(filter))).not.toThrow();
    expect(() => run(largestTransactionSql(filter, 'expense'))).not.toThrow();
  });
});

describe('the golden rule', () => {
  it('counts only approved expense and income', () => {
    const [row] = run<{ incomeMinor: number; expenseMinor: number; txCount: number }>(
      rangeSummarySql(AUGUST),
    );
    // 50000 + 30000 + 12000 + 20000 — never the pending 99999,
    // the 77777 transfer, or the 88888 lending row.
    expect(row.expenseMinor).toBe(112_000);
    expect(row.incomeMinor).toBe(900_000);
    expect(row.txCount).toBe(5);
  });

  it('keeps transfers and lending out of a person breakdown', () => {
    const rows = run<{ id: string; totalMinor: number }>(
      breakdownSql(AUGUST, 'person', 'expense'),
    );
    // Shaam only ever appears on a lending row, so he must not be here at all.
    expect(rows.map((r) => r.id)).toEqual(['p1']);
    expect(rows[0].totalMinor).toBe(62_000);
  });

  it('excludes rows outside the period', () => {
    const rows = run<{ id: string; totalMinor: number }>(
      breakdownSql(AUGUST, 'category', 'expense'),
    );
    // July's 40000 of Food is not counted.
    expect(rows.find((r) => r.id === 'c1')?.totalMinor).toBe(100_000);
  });
});

describe('breakdown grouping', () => {
  it('collapses to one row per category', () => {
    const rows = run<{ id: string; name: string; totalMinor: number; txCount: number }>(
      breakdownSql(AUGUST, 'category', 'expense'),
    );
    expect(rows).toEqual([
      expect.objectContaining({ id: 'c1', name: 'Food', totalMinor: 100_000, txCount: 3 }),
      expect.objectContaining({ id: 'c2', name: 'Transport', totalMinor: 12_000, txCount: 1 }),
    ]);
  });

  it('collapses to one row per account', () => {
    const rows = run<{ id: string; totalMinor: number; txCount: number }>(
      breakdownSql(AUGUST, 'account', 'expense'),
    );
    expect(rows).toEqual([
      expect.objectContaining({ id: 'a1', totalMinor: 80_000, txCount: 2 }),
      expect.objectContaining({ id: 'a2', totalMinor: 32_000, txCount: 2 }),
    ]);
  });

  it('collapses recurring to exactly two buckets, not one row per transaction', () => {
    const rows = run<{ id: string; name: string; totalMinor: number; txCount: number }>(
      breakdownSql(AUGUST, 'recurring', 'expense'),
    );
    expect(rows).toHaveLength(2);
    expect(rows).toEqual([
      expect.objectContaining({ id: 'one_off', name: 'One-off', totalMinor: 92_000, txCount: 3 }),
      expect.objectContaining({ id: 'recurring', name: 'Recurring', totalMinor: 20_000, txCount: 1 }),
    ]);
  });

  it('ranks slices largest first', () => {
    const rows = run<{ totalMinor: number }>(breakdownSql(AUGUST, 'category', 'expense'));
    const totals = rows.map((r) => r.totalMinor);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
  });
});

describe('filters', () => {
  it('narrows to one account', () => {
    const rows = run<{ id: string; totalMinor: number }>(
      breakdownSql({ ...AUGUST, accountId: 'a1' }, 'category', 'expense'),
    );
    expect(rows).toEqual([expect.objectContaining({ id: 'c1', totalMinor: 80_000 })]);
  });

  it('include narrows to the listed categories', () => {
    const rows = run<{ id: string }>(
      breakdownSql({ ...AUGUST, includeCategoryIds: ['c2'] }, 'category', 'expense'),
    );
    expect(rows.map((r) => r.id)).toEqual(['c2']);
  });

  it('exclude removes the listed categories', () => {
    const rows = run<{ id: string }>(
      breakdownSql({ ...AUGUST, excludeCategoryIds: ['c1'] }, 'category', 'expense'),
    );
    expect(rows.map((r) => r.id)).toEqual(['c2']);
  });
});

describe('daily totals', () => {
  it('groups by local day and splits the two kinds', () => {
    const rows = run<{ day: string; incomeMinor: number; expenseMinor: number }>(
      dailyTotalsSql(AUGUST),
    );
    expect(rows).toEqual([
      { day: '2026-08-01', incomeMinor: 900_000, expenseMinor: 0 },
      { day: '2026-08-05', incomeMinor: 0, expenseMinor: 80_000 },
      { day: '2026-08-07', incomeMinor: 0, expenseMinor: 12_000 },
      { day: '2026-08-09', incomeMinor: 0, expenseMinor: 20_000 },
    ]);
  });
});

describe('slice stats', () => {
  it('reports total, count and largest for the period', () => {
    const [row] = run<{ totalMinor: number; txCount: number; largestMinor: number }>(
      slicePeriodStatsSql(AUGUST, 'category', 'c1', 'expense'),
    );
    expect(row).toEqual({ totalMinor: 100_000, txCount: 3, largestMinor: 50_000 });
  });

  it('all-time ignores the period and the rest of the filter', () => {
    const [row] = run<{ totalMinor: number; txCount: number; lastOccurredAt: string }>(
      sliceAllTimeStatsSql('category', 'c1', 'expense'),
    );
    // Includes July's 40000, which the period query excluded.
    expect(row.totalMinor).toBe(140_000);
    expect(row.txCount).toBe(4);
  });

  it('separates the two recurring slices', () => {
    const [recurring] = run<{ totalMinor: number }>(
      slicePeriodStatsSql(AUGUST, 'recurring', 'recurring', 'expense'),
    );
    const [oneOff] = run<{ totalMinor: number }>(
      slicePeriodStatsSql(AUGUST, 'recurring', 'one_off', 'expense'),
    );
    expect(recurring.totalMinor).toBe(20_000);
    expect(oneOff.totalMinor).toBe(92_000);
  });
});

describe('slice transaction ids', () => {
  it('lists the slice newest first', () => {
    const rows = run<{ id: string }>(
      sliceTransactionIdsSql(AUGUST, 'category', 'c1', 'expense'),
    );
    expect(rows.map((r) => r.id)).toEqual(['t4', 't2', 't1']);
  });
});

describe('largest transaction', () => {
  it('picks the biggest expense with its category', () => {
    const [row] = run<{ id: string; name: string; amountMinor: number; categoryName: string }>(
      largestTransactionSql(AUGUST, 'expense'),
    );
    expect(row).toMatchObject({ id: 't1', name: 'Lunch', amountMinor: 50_000, categoryName: 'Food' });
  });
});
