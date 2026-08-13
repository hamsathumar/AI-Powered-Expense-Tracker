import { describe, expect, it } from '@jest/globals';

import { accountDeltaMinor } from '@/domain/accountActivity';
import type { Transaction } from '@/domain/types';

const base = {
  id: 't',
  status: 'approved' as const,
  source: 'manual' as const,
  name: 'x',
  amountMinor: 1000,
  occurredAt: '2026-08-10T00:00:00.000Z',
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
  confidenceFlags: [],
};

describe('accountDeltaMinor', () => {
  it('income adds, expense subtracts', () => {
    expect(accountDeltaMinor({ ...base, type: 'income', accountId: 'a', categoryId: 'c' } as Transaction)).toBe(1000);
    expect(accountDeltaMinor({ ...base, type: 'expense', accountId: 'a', categoryId: 'c' } as Transaction)).toBe(-1000);
  });

  it('a transfer nets to zero with no account selected', () => {
    const tx = { ...base, type: 'transfer', accountId: 'a', toAccountId: 'b' } as Transaction;
    expect(accountDeltaMinor(tx)).toBe(0);
  });

  it('a transfer is ±amount for the selected account', () => {
    const tx = { ...base, type: 'transfer', accountId: 'a', toAccountId: 'b' } as Transaction;
    expect(accountDeltaMinor(tx, 'a')).toBe(-1000); // out of source
    expect(accountDeltaMinor(tx, 'b')).toBe(1000); // into destination
    expect(accountDeltaMinor(tx, 'z')).toBe(0); // untouched
  });

  it('lending follows the direction cash flow', () => {
    const lend = { ...base, type: 'lending', accountId: 'a', personId: 'p' } as const;
    expect(accountDeltaMinor({ ...lend, direction: 'lend' } as Transaction)).toBe(-1000);
    expect(accountDeltaMinor({ ...lend, direction: 'lend_repayment_received' } as Transaction)).toBe(1000);
    expect(accountDeltaMinor({ ...lend, direction: 'borrow' } as Transaction)).toBe(1000);
    expect(accountDeltaMinor({ ...lend, direction: 'borrow_repayment_made' } as Transaction)).toBe(-1000);
  });
});
