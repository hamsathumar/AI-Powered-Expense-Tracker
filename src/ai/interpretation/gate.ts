/**
 * Final deterministic approval safety gate.
 *
 * This is the ONE authoritative check that runs immediately before commit —
 * on the CURRENT operation (after any user edits / resolution), not on the
 * state captured when the item entered the queue. Bulk approval, single
 * approval, and "approve now" all route through here; nothing may bypass it.
 *
 * A blocker means "not committable". Pure and re-runnable.
 */
import type { ResolvedOperation } from './types';

export type BlockerCode =
  | 'amount_not_grounded'
  | 'amount_provenance_inferred'
  | 'account_unresolved'
  | 'account_ambiguous'
  | 'to_account_unresolved'
  | 'to_account_ambiguous'
  | 'transfer_same_account'
  | 'category_unresolved'
  | 'category_ambiguous'
  | 'person_unresolved'
  | 'person_ambiguous'
  | 'direction_unresolved'
  | 'unresolved_conflict'
  | 'needs_specialized_editor'
  | 'unsupported_operation';

export interface Blocker {
  code: BlockerCode;
  message: string;
  /** For conflict blockers: the underlying conflict kind. */
  detail?: string;
}

export interface GateResult {
  approvable: boolean;
  blockers: Blocker[];
}

const b = (code: BlockerCode, message: string, detail?: string): Blocker => ({ code, message, detail });

export function evaluateApproval(op: ResolvedOperation): GateResult {
  const blockers: Blocker[] = [];

  // Specialized operations are never committed through the ordinary path.
  if (op.kind === 'bill_split' || op.kind === 'recurring') {
    blockers.push(
      b('needs_specialized_editor', `This ${op.kind === 'bill_split' ? 'Bill Split' : 'recurring'} operation must be completed in its dedicated editor.`),
    );
  }

  // Amount must be a grounded positive integer with acceptable provenance.
  if (!Number.isInteger(op.amountMinor) || op.amountMinor <= 0) {
    blockers.push(b('amount_not_grounded', 'The amount is not a grounded value.'));
  }
  if (op.amountProvenance !== 'USER_EXPLICIT' && op.amountProvenance !== 'AI_INTERPRETED') {
    blockers.push(b('amount_provenance_inferred', 'The amount was not grounded in what the user said.'));
  }

  // Every surfaced conflict blocks approval until resolved/cleared.
  for (const c of op.conflicts) {
    blockers.push(b('unresolved_conflict', `Unresolved conflict: ${c.note || c.kind}`, c.kind));
  }

  if (op.kind === 'expense' || op.kind === 'income' || op.kind === 'transfer' || op.kind === 'lending') {
    // Source account required for all ordinary operations.
    if (!op.account || op.account.status === 'unresolved') {
      blockers.push(b('account_unresolved', 'No account selected.'));
    } else if (op.account.status === 'ambiguous') {
      blockers.push(b('account_ambiguous', 'The account reference matches more than one account.'));
    }

    if (op.kind === 'expense' || op.kind === 'income') {
      if (!op.category || op.category.status === 'unresolved') {
        blockers.push(b('category_unresolved', 'No category selected.'));
      } else if (op.category.status === 'ambiguous') {
        blockers.push(b('category_ambiguous', 'The category reference matches more than one category.'));
      }
    }

    if (op.kind === 'transfer') {
      if (!op.toAccount || op.toAccount.status === 'unresolved') {
        blockers.push(b('to_account_unresolved', 'No destination account selected.'));
      } else if (op.toAccount.status === 'ambiguous') {
        blockers.push(b('to_account_ambiguous', 'The destination reference matches more than one account.'));
      } else if (op.account && op.toAccount.id && op.account.id === op.toAccount.id) {
        blockers.push(b('transfer_same_account', 'A transfer needs two different accounts.'));
      }
    }

    if (op.kind === 'lending') {
      if (!op.person || op.person.status === 'unresolved') {
        blockers.push(b('person_unresolved', 'No person selected.'));
      } else if (op.person.status === 'ambiguous') {
        blockers.push(b('person_ambiguous', 'The person reference matches more than one person.'));
      }
      if (!op.direction) {
        blockers.push(b('direction_unresolved', 'The lending direction is not set.'));
      }
    }
  } else {
    blockers.push(b('unsupported_operation', `Unsupported operation "${op.kind}".`));
  }

  return { approvable: blockers.length === 0, blockers };
}
