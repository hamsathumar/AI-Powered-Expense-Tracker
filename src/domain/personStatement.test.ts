import { describe, expect, it } from '@jest/globals';

import { buildPersonStatement } from './personStatement';
import type { LendingDirection, Transaction, TransactionStatus } from './types';

let n = 0;
/** Local-time stamp so the day grouping is TZ-independent. */
function at(day: number, hour = 12, minute = 0): string {
  return new Date(2026, 7, day, hour, minute).toISOString();
}
function row(
  direction: LendingDirection,
  amountMinor: number,
  when: string,
  opts: { status?: TransactionStatus; personId?: string } = {},
): { tx: Transaction } {
  return {
    tx: {
      id: `t${++n}`,
      type: 'lending',
      status: opts.status ?? 'approved',
      name: 'x',
      amountMinor,
      occurredAt: when,
      source: 'manual',
      confidenceFlags: [],
      createdAt: when,
      updatedAt: when,
      accountId: 'a',
      personId: opts.personId ?? 'p',
      direction,
    },
  };
}

describe('buildPersonStatement', () => {
  it('owes 1000, lent 500 more today → the day ends at 1500', () => {
    const items = [row('lend', 100000, at(1)), row('lend', 50000, at(2))];
    const s = buildPersonStatement(items, 'p');
    expect(s.days.map((d) => d.dayKey)).toEqual(['2026-08-02', '2026-08-01']);
    expect(s.days[0]!.closingBalanceMinor).toBe(150000);
    expect(s.days[0]!.dayNetMinor).toBe(50000);
    expect(s.days[1]!.closingBalanceMinor).toBe(100000);
    expect(s.closingBalanceMinor).toBe(150000);
  });

  it('closes each day after ALL of its rows, whatever order they arrive in', () => {
    const items = [
      row('lend_repayment_received', 30000, at(1, 18)),
      row('lend', 100000, at(1, 9)),
      row('lend', 20000, at(1, 13)),
    ];
    const s = buildPersonStatement(items, 'p');
    expect(s.days).toHaveLength(1);
    expect(s.days[0]!.closingBalanceMinor).toBe(90000);
    expect(s.days[0]!.dayNetMinor).toBe(90000);
    // newest first inside the day
    expect(s.days[0]!.entries.map((e) => e.tx.amountMinor)).toEqual([30000, 20000, 100000]);
  });

  it('goes negative when the user owes them, and across a repayment through zero', () => {
    const items = [row('borrow', 40000, at(1)), row('lend', 100000, at(2))];
    const s = buildPersonStatement(items, 'p');
    expect(s.days[1]!.closingBalanceMinor).toBe(-40000);
    expect(s.days[0]!.closingBalanceMinor).toBe(60000);

    const settled = buildPersonStatement(
      [row('lend', 5000, at(1)), row('lend_repayment_received', 5000, at(3))],
      'p',
    );
    expect(settled.closingBalanceMinor).toBe(0);
  });

  it('lists pending rows but never counts them; a pending-only day carries the balance', () => {
    const items = [
      row('lend', 100000, at(1)),
      row('lend', 99900, at(2), { status: 'pending' }),
    ];
    const s = buildPersonStatement(items, 'p');
    expect(s.days[0]!.entries).toHaveLength(1);
    expect(s.days[0]!.dayNetMinor).toBe(0);
    expect(s.days[0]!.closingBalanceMinor).toBe(100000);
  });

  it('ignores other people and non-lending rows for the balance', () => {
    const other = row('lend', 70000, at(1), { personId: 'someone-else' });
    const expense = {
      tx: { ...row('lend', 1, at(1)).tx, type: 'expense', categoryId: 'c', direction: undefined } as unknown as Transaction,
    };
    const s = buildPersonStatement([other, expense, row('lend', 1000, at(1))], 'p');
    expect(s.closingBalanceMinor).toBe(1000);
  });

  it('a date range keeps the true balance: opening comes from rows before it', () => {
    const items = [
      row('lend', 100000, at(1)),
      row('lend', 50000, at(5)),
      row('lend_repayment_received', 20000, at(6)),
      row('lend', 10000, at(10)),
    ];
    const s = buildPersonStatement(items, 'p', { from: new Date(2026, 7, 5), to: new Date(2026, 7, 6) });
    expect(s.openingBalanceMinor).toBe(100000);
    expect(s.days.map((d) => d.dayKey)).toEqual(['2026-08-06', '2026-08-05']);
    expect(s.days[1]!.closingBalanceMinor).toBe(150000);
    expect(s.closingBalanceMinor).toBe(130000);
  });

  it('range bounds are whole local days (inclusive start, inclusive end)', () => {
    const items = [
      row('lend', 100, new Date(2026, 7, 5, 0, 0, 0).toISOString()),
      row('lend', 200, new Date(2026, 7, 6, 23, 59, 59).toISOString()),
      row('lend', 400, new Date(2026, 7, 7, 0, 0, 1).toISOString()),
    ];
    const s = buildPersonStatement(items, 'p', { from: new Date(2026, 7, 5, 15), to: new Date(2026, 7, 6, 3) });
    expect(s.days.flatMap((d) => d.entries).map((e) => e.tx.amountMinor).sort()).toEqual([100, 200]);
    expect(s.closingBalanceMinor).toBe(300);
  });

  it('empty history is a settled zero', () => {
    const s = buildPersonStatement([], 'p');
    expect(s).toEqual({ openingBalanceMinor: 0, closingBalanceMinor: 0, days: [] });
  });

  it('a range with no activity still reports the carried balance', () => {
    const s = buildPersonStatement([row('lend', 100000, at(1))], 'p', {
      from: new Date(2026, 7, 10),
      to: new Date(2026, 7, 12),
    });
    expect(s.days).toEqual([]);
    expect(s.openingBalanceMinor).toBe(100000);
    expect(s.closingBalanceMinor).toBe(100000);
  });
});
