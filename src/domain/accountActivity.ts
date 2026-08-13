/**
 * Per-transaction cash effect for the Accounts day-net (design-system-v2 §6:
 * "day header + the day's net"). Uses the §4.2 balance rules:
 *   - income adds, expense subtracts;
 *   - a transfer moves money BETWEEN the user's own accounts, so with no
 *     account selected it nets to zero; with an account selected it counts as
 *     −amount out of the source / +amount into the destination;
 *   - lending follows its direction's cash direction.
 * Amounts are integer minor units.
 */
import type { Transaction } from '@/domain/types';

export function accountDeltaMinor(tx: Transaction, selectedAccountId?: string): number {
  switch (tx.type) {
    case 'income':
      return tx.amountMinor;
    case 'expense':
      return -tx.amountMinor;
    case 'transfer':
      if (!selectedAccountId) return 0;
      if (tx.accountId === selectedAccountId) return -tx.amountMinor;
      if (tx.toAccountId === selectedAccountId) return tx.amountMinor;
      return 0;
    case 'lending':
      switch (tx.direction) {
        case 'lend':
          return -tx.amountMinor;
        case 'lend_repayment_received':
          return tx.amountMinor;
        case 'borrow':
          return tx.amountMinor;
        case 'borrow_repayment_made':
          return -tx.amountMinor;
      }
  }
}
