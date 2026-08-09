/**
 * Money-math unit tests (technical-plan.md §8) — the non-negotiable ones:
 * account balance across all four types and both transfer directions, person
 * net balance through a full lend → partial repay → settle cycle, and the
 * golden rule.
 */
import { describe, expect, it } from '@jest/globals';

import {
  accountBalanceMinor,
  isReportable,
  personNetBalanceMinor,
  reportTotalsMinor,
} from './rules';
import type { LendingDirection, Transaction, TransactionStatus } from './types';

let counter = 0;
function tx(partial: {
  type: Transaction['type'];
  amountMinor: number;
  status?: TransactionStatus;
  accountId?: string;
  toAccountId?: string;
  categoryId?: string;
  personId?: string;
  direction?: LendingDirection;
}): Transaction {
  const base = {
    id: `tx-${++counter}`,
    status: partial.status ?? ('approved' as const),
    name: 'test',
    amountMinor: partial.amountMinor,
    occurredAt: '2026-08-09T12:00:00.000Z',
    source: 'manual' as const,
    confidenceFlags: [],
    createdAt: '2026-08-09T12:00:00.000Z',
    updatedAt: '2026-08-09T12:00:00.000Z',
  };
  switch (partial.type) {
    case 'expense':
    case 'income':
      return {
        ...base,
        type: partial.type,
        accountId: partial.accountId ?? 'acc-1',
        categoryId: partial.categoryId ?? 'cat-1',
      };
    case 'transfer':
      return {
        ...base,
        type: 'transfer',
        accountId: partial.accountId ?? 'acc-1',
        toAccountId: partial.toAccountId ?? 'acc-2',
      };
    case 'lending':
      return {
        ...base,
        type: 'lending',
        accountId: partial.accountId ?? 'acc-1',
        personId: partial.personId ?? 'person-1',
        direction: partial.direction ?? 'lend',
      };
  }
}

describe('accountBalanceMinor (§4.2)', () => {
  it('handles all four types and both transfer directions', () => {
    const history = [
      tx({ type: 'expense', amountMinor: 20000 }), // −200
      tx({ type: 'income', amountMinor: 50000 }), // +500
      tx({ type: 'transfer', amountMinor: 10000, accountId: 'acc-1', toAccountId: 'acc-2' }), // −100 from acc-1
      tx({ type: 'transfer', amountMinor: 5000, accountId: 'acc-2', toAccountId: 'acc-1' }), // +50 into acc-1
      tx({ type: 'lending', amountMinor: 7500, direction: 'lend' }), // −75
      tx({ type: 'lending', amountMinor: 2500, direction: 'lend_repayment_received' }), // +25
      tx({ type: 'lending', amountMinor: 4000, direction: 'borrow' }), // +40
      tx({ type: 'lending', amountMinor: 1000, direction: 'borrow_repayment_made' }), // −10
    ];
    expect(accountBalanceMinor(100000, history, 'acc-1')).toBe(
      100000 - 20000 + 50000 - 10000 + 5000 - 7500 + 2500 + 4000 - 1000,
    );
    // The mirror side of the transfers, for acc-2:
    expect(accountBalanceMinor(0, history, 'acc-2')).toBe(10000 - 5000);
  });

  it('ignores pending and rejected transactions entirely', () => {
    const history = [
      tx({ type: 'expense', amountMinor: 99900, status: 'pending' }),
      tx({ type: 'income', amountMinor: 88800, status: 'rejected' }),
    ];
    expect(accountBalanceMinor(12345, history, 'acc-1')).toBe(12345);
  });

  it('a transfer nets to zero across the two accounts', () => {
    const history = [tx({ type: 'transfer', amountMinor: 33300 })];
    const total =
      accountBalanceMinor(0, history, 'acc-1') + accountBalanceMinor(0, history, 'acc-2');
    expect(total).toBe(0);
  });
});

describe('personNetBalanceMinor (§4.3)', () => {
  it('tracks a full lend → partial repay → settle cycle', () => {
    const lend = tx({ type: 'lending', amountMinor: 50000, direction: 'lend' });
    expect(personNetBalanceMinor([lend], 'person-1')).toBe(50000); // they owe 500

    const partial = tx({
      type: 'lending',
      amountMinor: 20000,
      direction: 'lend_repayment_received',
    });
    expect(personNetBalanceMinor([lend, partial], 'person-1')).toBe(30000); // 300 left

    const settle = tx({
      type: 'lending',
      amountMinor: 30000,
      direction: 'lend_repayment_received',
    });
    expect(personNetBalanceMinor([lend, partial, settle], 'person-1')).toBe(0);
  });

  it('borrowing makes the net negative (user owes them)', () => {
    const history = [
      tx({ type: 'lending', amountMinor: 40000, direction: 'borrow' }),
      tx({ type: 'lending', amountMinor: 15000, direction: 'borrow_repayment_made' }),
    ];
    expect(personNetBalanceMinor(history, 'person-1')).toBe(-25000);
  });

  it('only counts approved rows for the given person', () => {
    const history = [
      tx({ type: 'lending', amountMinor: 10000, direction: 'lend', status: 'pending' }),
      tx({ type: 'lending', amountMinor: 5000, direction: 'lend', personId: 'someone-else' }),
    ];
    expect(personNetBalanceMinor(history, 'person-1')).toBe(0);
  });
});

describe('the golden rule (§4.1)', () => {
  it('transfers and lendings are never reportable', () => {
    expect(isReportable(tx({ type: 'transfer', amountMinor: 100 }))).toBe(false);
    expect(isReportable(tx({ type: 'lending', amountMinor: 100 }))).toBe(false);
    expect(isReportable(tx({ type: 'expense', amountMinor: 100 }))).toBe(true);
    expect(isReportable(tx({ type: 'income', amountMinor: 100 }))).toBe(true);
  });

  it('pending expense/income are not reportable either', () => {
    expect(isReportable(tx({ type: 'expense', amountMinor: 100, status: 'pending' }))).toBe(false);
  });

  it('report totals exclude movements even when they dwarf real spending', () => {
    const { incomeMinor, expenseMinor } = reportTotalsMinor([
      tx({ type: 'expense', amountMinor: 20000 }),
      tx({ type: 'income', amountMinor: 50000 }),
      tx({ type: 'transfer', amountMinor: 900000 }),
      tx({ type: 'lending', amountMinor: 800000, direction: 'lend' }),
      tx({ type: 'expense', amountMinor: 70000, status: 'pending' }),
    ]);
    expect(expenseMinor).toBe(20000);
    expect(incomeMinor).toBe(50000);
  });
});
