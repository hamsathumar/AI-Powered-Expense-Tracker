/**
 * Bill split generator (spec §4, technical-plan §4.4).
 *
 * Not a storage entity — a pure function from a split plan to Transactions
 * sharing one bill_split_id, all status='pending', source='bill_split'.
 *
 * Case A (user paid): one Expense for the user's own share (real spending,
 * categorized) + one Lending `lend` per other participant.
 * Case B (someone else paid): a **borrow + expense pair** for the user's
 * share — net-zero on the account, spending reported on the bill's date
 * (decision of 2026-08-09; see spec §4). Other participants' debts to the
 * payer are not the user's ledger and generate nothing.
 *
 * Rounding: equal splits assign the remainder cent(s) to the PAYER,
 * deliberately — totals must reconcile exactly, never silently drift.
 *
 * Pure module: type-only imports, no runtime dependencies (unit-testable in
 * plain node).
 */
import type { NewTransaction } from '@/db/queries/transactions';

export interface SplitParticipant {
  personId: string;
  shareMinor: number;
}

export interface BillSplitPlan {
  billSplitId: string;
  name: string;
  occurredAt: string;
  /** User's account: pays out in Case A; hosts the net-zero pair in Case B. */
  accountId: string;
  /** Category for the user's own share. */
  categoryId: string;
  totalMinor: number;
  /** User's share; 0 when the user isn't a participant. */
  myShareMinor: number;
  /** Every participant EXCEPT the user, with their share. */
  others: SplitParticipant[];
  payer: { kind: 'me' } | { kind: 'person'; personId: string };
}

/**
 * Equal shares in minor units; the remainder cents go to `payerIndex`
 * so the shares always sum exactly to the total (§4.4).
 */
export function equalSharesMinor(
  totalMinor: number,
  count: number,
  payerIndex: number,
): number[] {
  if (count <= 0 || !Number.isInteger(totalMinor) || totalMinor <= 0) {
    throw new Error('Equal split needs a positive integer total and at least one participant');
  }
  if (payerIndex < 0 || payerIndex >= count) {
    throw new Error('Payer must be one of the participants');
  }
  const base = Math.floor(totalMinor / count);
  const shares = new Array<number>(count).fill(base);
  shares[payerIndex] += totalMinor - base * count;
  return shares;
}

export function generateBillSplitTransactions(plan: BillSplitPlan): NewTransaction[] {
  const shares = [plan.myShareMinor, ...plan.others.map((o) => o.shareMinor)];
  if (shares.some((s) => !Number.isInteger(s) || s < 0)) {
    throw new Error('Shares must be non-negative integers (minor units)');
  }
  const sum = shares.reduce((a, b) => a + b, 0);
  if (sum !== plan.totalMinor) {
    throw new Error(
      `Shares (${sum}) must sum exactly to the total (${plan.totalMinor}) — no cent may be lost`,
    );
  }
  if (plan.payer.kind === 'person') {
    const payerId = plan.payer.personId;
    if (!plan.others.some((o) => o.personId === payerId)) {
      throw new Error('Payer must be one of the participants');
    }
  }

  const base = {
    status: 'pending' as const,
    source: 'bill_split' as const,
    occurredAt: plan.occurredAt,
    billSplitId: plan.billSplitId,
    confidenceFlags: [] as never[],
  };

  const myExpense: NewTransaction | null =
    plan.myShareMinor > 0
      ? {
          ...base,
          type: 'expense',
          name: plan.name,
          amountMinor: plan.myShareMinor,
          accountId: plan.accountId,
          categoryId: plan.categoryId,
        }
      : null;

  if (plan.payer.kind === 'me') {
    // Case A: full amount left the user's account; own share is spending,
    // everyone else's share is a lend.
    const lends: NewTransaction[] = plan.others
      .filter((o) => o.shareMinor > 0)
      .map((o) => ({
        ...base,
        type: 'lending',
        direction: 'lend',
        name: plan.name,
        amountMinor: o.shareMinor,
        accountId: plan.accountId,
        personId: o.personId,
      }));
    return myExpense ? [myExpense, ...lends] : lends;
  }

  // Case B: no money moved for the user; record the borrow + expense pair
  // for the user's share only.
  if (!myExpense) return []; // user wasn't a participant — nothing to record
  const borrow: NewTransaction = {
    ...base,
    type: 'lending',
    direction: 'borrow',
    name: plan.name,
    amountMinor: plan.myShareMinor,
    accountId: plan.accountId,
    personId: plan.payer.personId,
  };
  return [borrow, myExpense];
}
