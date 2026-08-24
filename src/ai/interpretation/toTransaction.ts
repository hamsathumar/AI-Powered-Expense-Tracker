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
    amountMinor: op.amountMinor,
    occurredAt: iso,
    confidenceFlags: [] as never[],
  };

  switch (op.operation) {
    case 'expense':
    case 'income':
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
