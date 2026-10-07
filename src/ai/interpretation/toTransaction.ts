/**
 * Pending operation → transaction row. Pure, so the date semantics are
 * testable without a database.
 *
 * THE POINT OF THIS FILE: the date expression is resolved against the moment
 * the operation was CAPTURED, never the moment it is approved.
 *
 * Transactions pile up in the queue during the day and get reviewed in one
 * sitting at night. Resolving "breakfast" (no date said) against the approval
 * time stamped every one of them 11pm; resolving "yesterday" against approval
 * time was worse, because it silently meant a different day than when it was
 * spoken. The user's words are only meaningful relative to when they said
 * them, so that is the reference.
 */
import { resolveDateExpression } from '@/ai/interpretation/dates';
import type { ResolvedOperation } from '@/ai/interpretation/types';
import type { NewTransaction } from '@/db/queries/transactions';

/**
 * @param capturedAt ISO timestamp of when the operation was recorded — the
 *   pending row's `createdAt`, NOT the current time.
 */
export function toNewTransaction(op: ResolvedOperation, capturedAt: string): NewTransaction {
  const reference = new Date(capturedAt);
  // A malformed stored timestamp must not produce an Invalid Date row.
  const safeReference = Number.isNaN(reference.getTime()) ? new Date() : reference;
  const { iso } = resolveDateExpression(op.dateExpression, safeReference);

  const base = {
    status: 'approved' as const,
    source: 'voice' as const,
    name: op.name,
    ...(op.note ? { description: op.note } : {}),
    // Non-null by construction: the gate refuses a null/non-positive amount,
    // and this function is only ever reached after the gate passes.
    amountMinor: op.amountMinor!,
    occurredAt: iso,
    confidenceFlags: [] as never[],
  };

  switch (op.operation) {
    case 'expense':
    case 'income':
      // NOTE: the contract allows an optional person TAG on expense/income
      // ("lunch with Sham"), but the transactions schema has no person column
      // for these types, so the tag is intentionally not persisted.
      return { ...base, type: op.operation, accountId: op.account!.id!, categoryId: op.category!.id! };
    case 'transfer':
      return { ...base, type: 'transfer', accountId: op.account!.id!, toAccountId: op.toAccount!.id! };
    case 'lending':
      return {
        ...base,
        type: 'lending',
        accountId: op.account!.id!,
        personId: op.person!.id!,
        direction: op.direction!,
      };
  }
}

/**
 * Everything one approved operation writes (V1.3). Usually one row. An expense
 * someone ELSE paid for ("Sham paid 280 for my dinner", TC-039) is two: a
 * borrow from that person into the account and the expense out of it — the
 * same pair a bill split records when someone else paid (billSplit.ts Case B):
 * net zero on the account, the spending reported on its date, and the debt on
 * the person's balance. The caller inserts them atomically.
 */
export function toNewTransactions(op: ResolvedOperation, capturedAt: string): NewTransaction[] {
  const expense = toNewTransaction(op, capturedAt);
  if (op.operation !== 'expense' || !op.paidBy?.id) return [expense];
  const payerName = op.paidBy.options[0]?.name ?? op.paidBy.reference ?? 'them';
  const borrow: NewTransaction = {
    status: 'approved',
    source: 'voice',
    type: 'lending',
    direction: 'borrow',
    name: `${op.name} · paid by ${payerName}`,
    amountMinor: expense.amountMinor,
    occurredAt: expense.occurredAt,
    accountId: op.account!.id!,
    personId: op.paidBy.id,
    confidenceFlags: [],
  };
  return [borrow, expense];
}
