/**
 * Bill split tests (technical-plan §8): totals reconcile exactly including
 * rounding remainders; Case A and Case B produce the right shapes.
 */
import { describe, expect, it } from '@jest/globals';

import { equalSharesMinor, generateBillSplitTransactions, type BillSplitPlan } from './billSplit';
import { accountBalanceMinor, reportTotalsMinor } from './rules';
import type { Transaction } from './types';

const basePlan: Omit<BillSplitPlan, 'myShareMinor' | 'others' | 'payer'> = {
  billSplitId: 'split-1',
  name: 'Lunch',
  occurredAt: '2026-08-09T12:00:00.000Z',
  accountId: 'acc-1',
  categoryId: 'cat-food',
  totalMinor: 150000, // Rs1,500.00
};

/** Promote generated rows to approved Transactions for math checks. */
function approved(rows: ReturnType<typeof generateBillSplitTransactions>): Transaction[] {
  return rows.map(
    (row, i) =>
      ({
        ...row,
        id: `gen-${i}`,
        status: 'approved',
        createdAt: row.occurredAt,
        updatedAt: row.occurredAt,
      }) as Transaction,
  );
}

describe('equalSharesMinor', () => {
  it('splits evenly when exact', () => {
    expect(equalSharesMinor(150000, 3, 0)).toEqual([50000, 50000, 50000]);
  });

  it('gives the remainder cents to the payer — total always reconciles', () => {
    const shares = equalSharesMinor(100000, 3, 1); // 1000.00 / 3
    expect(shares).toEqual([33333, 33334, 33333]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100000);
  });

  it('rejects a payer outside the participant list', () => {
    expect(() => equalSharesMinor(100, 2, 5)).toThrow();
  });
});

describe('Case A — user paid', () => {
  const rows = generateBillSplitTransactions({
    ...basePlan,
    myShareMinor: 50000,
    others: [
      { personId: 'kamal', shareMinor: 50000 },
      { personId: 'nimal', shareMinor: 50000 },
    ],
    payer: { kind: 'me' },
  });

  it('generates one expense (own share) + one lend per other participant', () => {
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ type: 'expense', amountMinor: 50000, categoryId: 'cat-food' });
    expect(rows[1]).toMatchObject({ type: 'lending', direction: 'lend', personId: 'kamal' });
    expect(rows[2]).toMatchObject({ type: 'lending', direction: 'lend', personId: 'nimal' });
  });

  it('generated amounts sum exactly to the total', () => {
    expect(rows.reduce((sum, r) => sum + r.amountMinor, 0)).toBe(150000);
  });

  it('all rows are pending, source bill_split, sharing one bill_split_id', () => {
    for (const row of rows) {
      expect(row).toMatchObject({ status: 'pending', source: 'bill_split', billSplitId: 'split-1' });
    }
  });

  it('account loses the FULL amount but reports show only the own share', () => {
    const txs = approved(rows);
    expect(accountBalanceMinor(0, txs, 'acc-1')).toBe(-150000);
    expect(reportTotalsMinor(txs).expenseMinor).toBe(50000); // golden rule
  });

  it('user not participating → lends only, no expense', () => {
    const lendOnly = generateBillSplitTransactions({
      ...basePlan,
      totalMinor: 100000,
      myShareMinor: 0,
      others: [
        { personId: 'kamal', shareMinor: 60000 },
        { personId: 'nimal', shareMinor: 40000 },
      ],
      payer: { kind: 'me' },
    });
    expect(lendOnly).toHaveLength(2);
    expect(lendOnly.every((r) => r.type === 'lending')).toBe(true);
  });
});

describe('Case B — someone else paid', () => {
  const rows = generateBillSplitTransactions({
    ...basePlan,
    myShareMinor: 50000,
    others: [
      { personId: 'kamal', shareMinor: 50000 }, // the payer's own share
      { personId: 'nimal', shareMinor: 50000 },
    ],
    payer: { kind: 'person', personId: 'kamal' },
  });

  it('generates exactly the borrow + expense pair for the user share', () => {
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      type: 'lending',
      direction: 'borrow',
      personId: 'kamal',
      amountMinor: 50000,
    });
    expect(rows[1]).toMatchObject({ type: 'expense', amountMinor: 50000, categoryId: 'cat-food' });
  });

  it('the pair nets to ZERO on the account (no money actually moved)', () => {
    expect(accountBalanceMinor(0, approved(rows), 'acc-1')).toBe(0);
  });

  it('spending is still reported — on the bill date, with the category', () => {
    expect(reportTotalsMinor(approved(rows)).expenseMinor).toBe(50000);
  });

  it('user not participating → nothing to record', () => {
    const nothing = generateBillSplitTransactions({
      ...basePlan,
      totalMinor: 100000,
      myShareMinor: 0,
      others: [
        { personId: 'kamal', shareMinor: 60000 },
        { personId: 'nimal', shareMinor: 40000 },
      ],
      payer: { kind: 'person', personId: 'kamal' },
    });
    expect(nothing).toEqual([]);
  });
});

describe('validation', () => {
  it('rejects shares that do not sum to the total', () => {
    expect(() =>
      generateBillSplitTransactions({
        ...basePlan,
        myShareMinor: 50000,
        others: [{ personId: 'kamal', shareMinor: 49999 }],
        payer: { kind: 'me' },
      }),
    ).toThrow(/sum exactly/);
  });

  it('rejects a payer who is not a participant', () => {
    expect(() =>
      generateBillSplitTransactions({
        ...basePlan,
        totalMinor: 100000,
        myShareMinor: 50000,
        others: [{ personId: 'kamal', shareMinor: 50000 }],
        payer: { kind: 'person', personId: 'stranger' },
      }),
    ).toThrow(/Payer/);
  });
});
