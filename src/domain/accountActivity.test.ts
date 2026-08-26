import { describe, expect, it } from '@jest/globals';

import { accountDeltaMinor, dayNetMinor } from '@/domain/accountActivity';
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

describe('dayNetMinor — the Accounts day header', () => {
  const income = { ...base, type: 'income', accountId: 'a', categoryId: 'c' } as Transaction;
  const expense = { ...base, type: 'expense', accountId: 'a', categoryId: 'c' } as Transaction;
  const transfer = { ...base, type: 'transfer', accountId: 'a', toAccountId: 'b' } as Transaction;
  const lend = { ...base, type: 'lending', accountId: 'a', personId: 'p', direction: 'lend' } as Transaction;
  const borrow = { ...base, type: 'lending', accountId: 'a', personId: 'p', direction: 'borrow' } as Transaction;

  describe('across all accounts — net SPENDING (the golden rule)', () => {
    it('counts income and expense', () => {
      expect(dayNetMinor(income)).toBe(1000);
      expect(dayNetMinor(expense)).toBe(-1000);
    });

    it('ignores transfers and lending in BOTH directions', () => {
      expect(dayNetMinor(transfer)).toBe(0);
      expect(dayNetMinor(lend)).toBe(0);
      expect(dayNetMinor(borrow)).toBe(0);
      expect(dayNetMinor({ ...borrow, direction: 'lend_repayment_received' } as Transaction)).toBe(0);
      expect(dayNetMinor({ ...borrow, direction: 'borrow_repayment_made' } as Transaction)).toBe(0);
    });

    it('reproduces the reported day: borrowed money no longer inflates the total', () => {
      // The real 25 Aug list. It read −5,280 because +300 and +200 borrowed and
      // −50 lent were folded in; only spending should count.
      const at = (amountMinor: number, type: 'expense' | 'income') =>
        ({ ...base, amountMinor, type, accountId: 'a', categoryId: 'c' }) as Transaction;
      const lending = (amountMinor: number, direction: 'lend' | 'borrow') =>
        ({ ...base, amountMinor, type: 'lending', accountId: 'a', personId: 'p', direction }) as Transaction;

      const day: Transaction[] = [
        at(10000, 'expense'), // Chips Packet
        at(30000, 'expense'), // Lunch
        lending(30000, 'borrow'), // Lunch, borrowed from Sham (bill-split pair)
        at(40000, 'income'), // Refund from Mayees
        at(530000, 'expense'), // Rent
        lending(20000, 'borrow'), // Borrowed from Nuski
        at(25000, 'expense'), // Laundry
        lending(5000, 'lend'), // Breakfast, lent to Sham
        at(14000, 'expense'), // Breakfast
        at(4000, 'expense'), // Bus Ticket
      ];

      expect(day.reduce((sum, tx) => sum + dayNetMinor(tx), 0)).toBe(-573000);
      // The bill-split expense is included, not cancelled out by its borrow.
      expect(day.reduce((sum, tx) => sum + accountDeltaMinor(tx), 0)).toBe(-528000); // the old, wrong figure
    });
  });

  describe('with one account selected — that account’s cash movement', () => {
    it('counts transfers in and out', () => {
      expect(dayNetMinor(transfer, 'a')).toBe(-1000);
      expect(dayNetMinor(transfer, 'b')).toBe(1000);
      expect(dayNetMinor(transfer, 'z')).toBe(0);
    });

    it('counts lending, because the cash really left or arrived', () => {
      expect(dayNetMinor(lend, 'a')).toBe(-1000);
      expect(dayNetMinor(borrow, 'a')).toBe(1000);
    });
  });
});
