/**
 * Core money math (technical-plan.md §4) as pure functions.
 *
 * The app's screens compute these same rules in SQL (src/db/queries) for
 * performance; this module is the executable specification — dependency-free
 * so the unit tests (§8) can pin the math down. If SQL and this file ever
 * disagree, one of them is wrong: resolve against technical-plan.md §4.
 */
import type { Transaction } from '@/domain/types';

/**
 * THE GOLDEN RULE (§4.1): only expense and income are spending/earning.
 * Transfer and lending are money movements — they must never appear in
 * spending/income reports or category breakdowns.
 */
export function isReportable(tx: Transaction): boolean {
  return tx.status === 'approved' && (tx.type === 'expense' || tx.type === 'income');
}

/** Signed effect of one transaction on one account's balance (§4.2). */
export function accountEffectMinor(tx: Transaction, accountId: string): number {
  if (tx.status !== 'approved') return 0;
  switch (tx.type) {
    case 'expense':
      return tx.accountId === accountId ? -tx.amountMinor : 0;
    case 'income':
      return tx.accountId === accountId ? tx.amountMinor : 0;
    case 'transfer':
      if (tx.accountId === accountId) return -tx.amountMinor;
      if (tx.toAccountId === accountId) return tx.amountMinor;
      return 0;
    case 'lending': {
      if (tx.accountId !== accountId) return 0;
      const moneyOut = tx.direction === 'lend' || tx.direction === 'borrow_repayment_made';
      return moneyOut ? -tx.amountMinor : tx.amountMinor;
    }
  }
}

/** Account balance across a transaction history (§4.2). */
export function accountBalanceMinor(
  openingBalanceMinor: number,
  transactions: Transaction[],
  accountId: string,
): number {
  return transactions.reduce(
    (sum, tx) => sum + accountEffectMinor(tx, accountId),
    openingBalanceMinor,
  );
}

/**
 * Person net balance (§4.3). Positive = they owe the user; negative = the
 * user owes them. Approved lending rows only.
 */
export function personNetBalanceMinor(transactions: Transaction[], personId: string): number {
  return transactions.reduce((sum, tx) => {
    if (tx.type !== 'lending' || tx.status !== 'approved' || tx.personId !== personId) {
      return sum;
    }
    switch (tx.direction) {
      case 'lend':
        return sum + tx.amountMinor;
      case 'lend_repayment_received':
        return sum - tx.amountMinor;
      case 'borrow':
        return sum - tx.amountMinor;
      case 'borrow_repayment_made':
        return sum + tx.amountMinor;
    }
  }, 0);
}

/** Spending/earning totals for reports — golden-rule filtered by definition. */
export function reportTotalsMinor(transactions: Transaction[]): {
  incomeMinor: number;
  expenseMinor: number;
} {
  let incomeMinor = 0;
  let expenseMinor = 0;
  for (const tx of transactions) {
    if (!isReportable(tx)) continue;
    if (tx.type === 'income') incomeMinor += tx.amountMinor;
    else expenseMinor += tx.amountMinor;
  }
  return { incomeMinor, expenseMinor };
}
