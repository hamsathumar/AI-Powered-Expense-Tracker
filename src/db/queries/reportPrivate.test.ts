/// <reference types="node" />
/**
 * Private accounts in reports, run against a real SQLite engine with the
 * shipped schema + migration 8 (see reportSql.test.ts for why).
 *
 * The rules (reportSql.reportRowsSql):
 *   - a private account's own expense/income never reaches a personal report;
 *   - personal → private transfer = personal EXPENSE ("Moved to private");
 *   - private → personal transfer = personal INCOME ("Back from private");
 *   - transfers within one side and all lending stay out (golden rule);
 *   - filtering to the private account shows ITS OWN expense/income only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import {
  breakdownSql,
  dailyTotalsSql,
  largestTransactionSql,
  PRIVATE_TRANSFER_CATEGORY,
  rangeSummarySql,
  sliceExtentSql,
  sliceStatsSql,
  sliceTransactionIdsSql,
  type ReportFilter,
  type Statement,
} from './reportSql';

const source = readFileSync(join(__dirname, '../migrations.ts'), 'utf8');
const SCHEMA_V1 = source.match(/const SCHEMA_V1 = `([\s\S]*?)`;/)![1]!;
const MIGRATION_8 = source.match(/version: 8,[\s\S]*?await db\.execAsync\(`([\s\S]*?)`\);/)![1]!;

const AUGUST: ReportFilter = { startDay: '2026-08-01', endDay: '2026-08-31' };

let db: DatabaseSync;
function run<T = Record<string, unknown>>({ sql, params }: Statement): T[] {
  return db.prepare(sql).all(...params) as T[];
}
function one<T>(stmt: Statement): T {
  return run<T>(stmt)[0]!;
}

function tx(r: {
  id: string;
  type: string;
  amount: number;
  account: string;
  to?: string;
  category?: string;
  status?: string;
  direction?: string;
  person?: string;
  day?: number;
}) {
  db.prepare(
    `INSERT INTO transactions
       (id, type, status, direction, name, amount, occurred_at, account_id, to_account_id,
        category_id, person_id, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'x', 'x')`,
  ).run(
    r.id,
    r.type,
    r.status ?? 'approved',
    r.direction ?? null,
    `Row ${r.id}`,
    r.amount,
    `2026-08-${String(r.day ?? 10).padStart(2, '0')}T06:00:00Z`,
    r.account,
    r.to ?? null,
    r.category ?? null,
    r.person ?? null,
  );
}

beforeAll(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_V1);
  db.exec(MIGRATION_8);
  db.exec(`
    INSERT INTO accounts (id, name, type, opening_balance, created_at, is_private) VALUES
      ('bank', 'Bank', 'bank', 0, 'x', 0),
      ('cash', 'Cash', 'cash', 0, 'x', 0),
      ('room', 'Room', 'cash', 0, 'x', 1),
      ('trip', 'Trip', 'cash', 0, 'x', 1);
    INSERT INTO categories (id, name, kind, icon, color, is_default, archived) VALUES
      ('food', 'Food', 'expense', 'coffee', '#111111', 1, 0),
      ('pay',  'Salary', 'income', 'briefcase', '#222222', 1, 0);
    INSERT INTO people (id, name, unresolved, created_at) VALUES ('kamal', 'Kamal', 0, 'x');
  `);

  // Personal life.
  tx({ id: 'p-food', type: 'expense', amount: 10_000, account: 'bank', category: 'food', day: 3 });
  tx({ id: 'p-pay', type: 'income', amount: 500_000, account: 'bank', category: 'pay', day: 1 });
  // The private pot's own life — never in a personal report.
  tx({ id: 'r-food', type: 'expense', amount: 70_000, account: 'room', category: 'food', day: 4 });
  tx({ id: 'r-collect', type: 'income', amount: 90_000, account: 'room', category: 'pay', day: 4 });
  // Crossing the boundary.
  tx({ id: 'to-room', type: 'transfer', amount: 5_000, account: 'bank', to: 'room', day: 5 });
  tx({ id: 'from-room', type: 'transfer', amount: 2_000, account: 'room', to: 'cash', day: 6 });
  // Staying on one side — neutral.
  tx({ id: 'bank-cash', type: 'transfer', amount: 33_000, account: 'bank', to: 'cash', day: 7 });
  tx({ id: 'room-trip', type: 'transfer', amount: 44_000, account: 'room', to: 'trip', day: 7 });
  // Lending through the private pot — never a report row.
  tx({ id: 'r-lend', type: 'lending', direction: 'lend', amount: 8_000, account: 'room', person: 'kamal', day: 8 });
  // A pending boundary transfer must not count yet.
  tx({ id: 'to-room-pending', type: 'transfer', status: 'pending', amount: 9_999, account: 'bank', to: 'room', day: 9 });
});

afterAll(() => db?.close());

describe('personal reports (no account selected)', () => {
  it('totals: own private rows out, boundary transfers in', () => {
    const s = one<{ incomeMinor: number; expenseMinor: number; txCount: number }>(rangeSummarySql(AUGUST));
    expect(s.expenseMinor).toBe(10_000 + 5_000);
    expect(s.incomeMinor).toBe(500_000 + 2_000);
    expect(s.txCount).toBe(4);
  });

  it('category breakdown shows the boundary as its own named slice', () => {
    const expense = run<{ id: string; name: string; icon: string; totalMinor: number }>(
      breakdownSql(AUGUST, 'category', 'expense'),
    );
    expect(expense).toEqual([
      expect.objectContaining({ id: 'food', name: 'Food', totalMinor: 10_000 }),
      expect.objectContaining({ id: PRIVATE_TRANSFER_CATEGORY, name: 'Moved to private', icon: 'lock', totalMinor: 5_000 }),
    ]);
    const income = run<{ id: string; name: string; totalMinor: number }>(
      breakdownSql(AUGUST, 'category', 'income'),
    );
    expect(income.find((r) => r.id === PRIVATE_TRANSFER_CATEGORY)).toEqual(
      expect.objectContaining({ name: 'Back from private', totalMinor: 2_000 }),
    );
  });

  it('account breakdown attributes the boundary to the PERSONAL side', () => {
    const expense = run<{ id: string; totalMinor: number }>(breakdownSql(AUGUST, 'account', 'expense'));
    expect(expense).toEqual([expect.objectContaining({ id: 'bank', totalMinor: 15_000 })]);
    const income = run<{ id: string; totalMinor: number }>(breakdownSql(AUGUST, 'account', 'income'));
    expect(income.map((r) => [r.id, r.totalMinor])).toEqual([
      ['bank', 500_000],
      ['cash', 2_000],
    ]);
  });

  it('private accounts never appear as slices; person/recurring breakdowns stay clean', () => {
    for (const kind of ['expense', 'income'] as const) {
      const ids = run<{ id: string }>(breakdownSql(AUGUST, 'account', kind)).map((r) => r.id);
      expect(ids).not.toContain('room');
      expect(ids).not.toContain('trip');
    }
    expect(run(breakdownSql(AUGUST, 'person', 'expense'))).toEqual([]);
    const recurring = run<{ totalMinor: number }>(breakdownSql(AUGUST, 'recurring', 'expense'));
    expect(recurring.reduce((sum, r) => sum + r.totalMinor, 0)).toBe(15_000);
  });

  it('daily totals and the largest-expense insight follow the same rows', () => {
    const days = run<{ day: string; expenseMinor: number; incomeMinor: number }>(dailyTotalsSql(AUGUST));
    expect(days.map((d) => d.day)).toEqual(['2026-08-01', '2026-08-03', '2026-08-05', '2026-08-06']);
    const largest = one<{ id: string; categoryName: string }>(largestTransactionSql(AUGUST, 'expense'));
    expect(largest.id).toBe('p-food');
    const onlyBoundary = one<{ id: string; categoryName: string }>(
      largestTransactionSql({ ...AUGUST, includeCategoryIds: [PRIVATE_TRANSFER_CATEGORY] }, 'expense'),
    );
    expect(onlyBoundary).toEqual(expect.objectContaining({ id: 'to-room', categoryName: 'Moved to private' }));
  });

  it('a category filter that names only real categories leaves the boundary slice out', () => {
    const s = one<{ expenseMinor: number }>(rangeSummarySql({ ...AUGUST, includeCategoryIds: ['food'] }));
    expect(s.expenseMinor).toBe(10_000);
  });
});

describe("a private account's own report (selected in the filter)", () => {
  const ROOM: ReportFilter = { ...AUGUST, accountId: 'room' };

  it('shows its own expense and income only — no transfers, no lending', () => {
    const s = one<{ incomeMinor: number; expenseMinor: number }>(rangeSummarySql(ROOM));
    expect(s).toEqual(expect.objectContaining({ expenseMinor: 70_000, incomeMinor: 90_000 }));
    const cats = run<{ id: string }>(breakdownSql(ROOM, 'category', 'expense')).map((r) => r.id);
    expect(cats).toEqual(['food']);
  });

  it('selecting a personal account is unchanged, boundary transfer included', () => {
    const s = one<{ expenseMinor: number }>(rangeSummarySql({ ...AUGUST, accountId: 'bank' }));
    expect(s.expenseMinor).toBe(15_000);
  });

  it('opening the private account as a drill-down slice shows its rows', () => {
    const stats = one<{ totalMinor: number }>(sliceStatsSql(AUGUST, 'account', 'room', 'expense', 'period'));
    expect(stats.totalMinor).toBe(70_000);
    const all = one<{ totalMinor: number }>(sliceStatsSql(AUGUST, 'account', 'room', 'expense', 'allTime'));
    expect(all.totalMinor).toBe(70_000);
    expect(one<{ totalMinor: number }>(sliceExtentSql('account', 'room', 'expense')).totalMinor).toBe(70_000);
  });

  it('a personal category drill-down never leaks the private pot', () => {
    for (const scope of ['period', 'allTime'] as const) {
      const ids = run<{ id: string }>(sliceTransactionIdsSql(AUGUST, 'category', 'food', 'expense', scope)).map(
        (r) => r.id,
      );
      expect(ids).toEqual(['p-food']);
    }
    expect(one<{ totalMinor: number }>(sliceExtentSql('category', 'food', 'expense')).totalMinor).toBe(10_000);
  });

  it('the boundary slice drills down to the transfers themselves', () => {
    const ids = run<{ id: string }>(
      sliceTransactionIdsSql(AUGUST, 'category', PRIVATE_TRANSFER_CATEGORY, 'expense', 'period'),
    ).map((r) => r.id);
    expect(ids).toEqual(['to-room']);
  });
});
