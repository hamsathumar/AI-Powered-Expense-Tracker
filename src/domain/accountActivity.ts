/**
 * Per-transaction CASH EFFECT (technical-plan §4.2 balance rules):
 *   - income adds, expense subtracts;
 *   - a transfer moves money BETWEEN the user's own accounts, so with no
 *     account selected it nets to zero; with an account selected it counts as
 *     −amount out of the source / +amount into the destination;
 *   - lending follows its direction's cash direction.
 * Amounts are integer minor units.
 *
 * This answers "how much money moved?", which is the right question for one
 * account (and for a CSV row). It is NOT the right question for the all-accounts
 * day header — see `dayNetMinor` below.
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

/**
 * The Accounts day-header total (design-system-v2 §6: "day header + the day's
 * net"), which is a different question depending on what the list is showing.
 *
 * **All accounts → net SPENDING.** Only `expense` and `income` count — the
 * golden rule. A day-header cash figure was actively misleading here: lending
 * rows render unsigned, so the total could not be derived from anything on
 * screen (+300 borrowed and +200 borrowed silently lifted a −5,730 day to
 * −5,280). Worse, a bill split where someone else paid is stored as a
 * borrow + expense PAIR that nets to zero in cash, so the day header hid
 * split spending entirely — the opposite of the decision that "spending is
 * reported on the bill's date".
 *
 * **One account selected → cash effect on THAT account.** Here "how much
 * moved in and out" is exactly what the user is asking, and transfers and
 * lending genuinely belong in it.
 *
 * Note the consequence of the first rule, which is intended: a day containing
 * only transfers or lending nets to zero. Nothing was spent or earned.
 */
export function dayNetMinor(tx: Transaction, selectedAccountId?: string): number {
  if (selectedAccountId) return accountDeltaMinor(tx, selectedAccountId);
  if (tx.type === 'income') return tx.amountMinor;
  if (tx.type === 'expense') return -tx.amountMinor;
  return 0; // transfer + lending are movements, never spending
}
