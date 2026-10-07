/**
 * Commit path for Transaction AI V1 — the ONLY route from a pending operation
 * to the `transactions` ledger, and it always runs the final safety gate.
 *
 * At commit time it RE-RESOLVES entity ids against live data (guarding against
 * deleted/renamed entities), RE-RUNS the deterministic gate, and only on a
 * clean pass inserts an `approved` transaction. Single approve, "approve now",
 * and bulk approve all call `commitPendingOperation` / `commitAll`, so no path
 * can bypass the gate.
 */
import { evaluateApproval, type Blocker, type GateResult } from '@/ai/interpretation/gate';
import { toNewTransactions } from '@/ai/interpretation/toTransaction';
import type { ResolvedOperation, ResolvedRef } from '@/ai/interpretation/types';
import {
  resolveAccountRef,
  resolveRef,
  type EntityLite,
  type ResolveContext,
} from '@/ai/interpretation/resolve';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { listPeople } from '@/db/queries/people';
import {
  deletePendingOperation,
  getPendingOperation,
  listPendingOperations,
  updatePendingOperation,
} from '@/db/queries/pendingOperations';
import { insertTransactionsAtomically } from '@/db/queries/transactions';
import { recordPendingOutcome } from '@/state/pendingOutcomes';

export interface CommitResult {
  committed: boolean;
  transactionId?: string;
  blockers: Blocker[];
}

async function loadContext(): Promise<ResolveContext> {
  const [accounts, expenseCategories, incomeCategories, people] = await Promise.all([
    listAccounts(),
    listCategories('expense'),
    listCategories('income'),
    listPeople('name'),
  ]);
  const lite = <T extends { id: string; name: string }>(xs: T[]): EntityLite[] =>
    xs.map((x) => ({ id: x.id, name: x.name }));
  return {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, kind: a.type })),
    expenseCategories: lite(expenseCategories),
    incomeCategories: lite(incomeCategories),
    people: lite(people),
  };
}

/** Re-verify a resolved ref against live data: an id that vanished is downgraded.
 *  Accounts re-resolve through `resolveAccountRef`, exactly as at interpretation
 *  time, so the queue and the commit path can never disagree about a name. */
function refreshRef(
  ref: ResolvedRef | null,
  pool: EntityLite[],
  resolve: typeof resolveRef = resolveRef,
): ResolvedRef | null {
  if (!ref) return null;
  if (ref.id) {
    if (pool.some((e) => e.id === ref.id)) return { ...ref, status: 'resolved', options: [] };
    // fall through: the chosen id no longer exists — try to re-resolve by name
  }
  // Re-run the SAME resolution rules used at interpretation time (including
  // near-match suggestions), so the queue and the commit path can never
  // disagree about what a name means.
  return (
    resolve({ reference: ref.reference, provenance: 'AI_INTERPRETED', state: 'KNOWN', candidates: [] }, pool) ?? null
  );
}

function refresh(op: ResolvedOperation, ctx: ResolveContext): ResolvedOperation {
  const catPool = op.operation === 'income' ? ctx.incomeCategories : ctx.expenseCategories;
  return {
    ...op,
    account: refreshRef(op.account, ctx.accounts, resolveAccountRef),
    toAccount: refreshRef(op.toAccount, ctx.accounts, resolveAccountRef),
    category: op.category ? refreshRef(op.category, catPool) : null,
    person: refreshRef(op.person, ctx.people),
    paidBy: refreshRef(op.paidBy ?? null, ctx.people),
  };
}


/** Gate + insert + delete for one already-loaded record, against a shared
 *  entity context. Committing never mutates entities, so one context is valid
 *  for a whole bulk run. */
async function commitRecord(
  record: { id: string; op: ResolvedOperation; createdAt: string },
  ctx: ResolveContext,
): Promise<CommitResult> {
  const op = refresh(record.op, ctx);

  const gate = evaluateApproval(op);
  if (!gate.approvable) return { committed: false, blockers: gate.blockers };

  // The capture time, not now — see toTransaction.ts. One row, or the
  // borrow + expense pair for "X paid for me" (V1.3) — all or nothing.
  const inserted = await insertTransactionsAtomically(toNewTransactions(op, record.createdAt));
  await deletePendingOperation(record.id);
  recordPendingOutcome(record.id, 'approved');
  return { committed: true, transactionId: inserted[inserted.length - 1]!.id, blockers: [] };
}

/** Reject: the operation is discarded and never reaches the ledger. Every
 *  screen still showing it learns why it left (state/pendingOutcomes.ts). */
export async function rejectPendingOperation(id: string): Promise<void> {
  await deletePendingOperation(id);
  recordPendingOutcome(id, 'rejected');
}

/** A bill-split / recurring operation finished in its own editor, which wrote
 *  the real rows itself — consume the pending item as saved. */
export async function markPendingOperationSaved(id: string): Promise<void> {
  await deletePendingOperation(id);
  recordPendingOutcome(id, 'saved');
}

/**
 * Attempt to commit one pending operation. Returns blockers instead of
 * committing when the final gate does not pass. Only removes the pending row
 * on a successful commit.
 */
export async function commitPendingOperation(id: string): Promise<CommitResult> {
  const record = await getPendingOperation(id);
  if (!record) return { committed: false, blockers: [{ code: 'unsupported_operation', message: 'Pending item not found.' }] };
  return commitRecord(record, await loadContext());
}

/**
 * "Confirm & approve" (V1.3): the user acknowledged every confirmation note on
 * the item they are looking at. Those conflicts are cleared — that IS the
 * confirmation — and the item goes through the normal gate. Anything else
 * still blocking (a missing field, or a suspected injection, which is never
 * cleared here) keeps it out of the ledger exactly as before.
 */
export async function confirmAndCommitPendingOperation(id: string): Promise<CommitResult> {
  const record = await getPendingOperation(id);
  if (!record) return { committed: false, blockers: [{ code: 'unsupported_operation', message: 'Pending item not found.' }] };
  const confirmed = {
    ...record,
    // Only the one-tap kinds are acknowledged here (see issues.ts
    // `confirmableInline`); anything else keeps blocking.
    op: {
      ...record.op,
      conflicts: record.op.conflicts.filter(
        (c) => !['amount_by_reference', 'amount_uncertain', 'amount_correction', 'date_unresolved'].includes(c.kind),
      ),
    },
  };
  const result = await commitRecord(confirmed, await loadContext());
  // Keep the acknowledgement even if something else still blocks, so the
  // user is not asked the same question twice.
  if (!result.committed) await updatePendingOperation(id, confirmed.op);
  return result;
}

export interface EvaluatedPending {
  id: string;
  op: ResolvedOperation;
  gate: GateResult;
  createdAt: string;
}

/** For the review queue: refresh + gate every pending operation (one ctx load). */
export async function evaluateAllPending(): Promise<EvaluatedPending[]> {
  const [records, ctx] = await Promise.all([listPendingOperations(), loadContext()]);
  return records.map((r) => {
    const op = refresh(r.op, ctx);
    return { id: r.id, op, gate: evaluateApproval(op), createdAt: r.createdAt };
  });
}

/**
 * Refresh + gate a SPECIFIC set of pending operations (one ctx load). Used by
 * the voice confirmation screen to show only the operations produced by the
 * capture that just happened — with their live gate status, so "Approve now"
 * can be offered inline. Missing ids (already approved/rejected elsewhere) are
 * skipped. Order follows the input ids.
 */
export async function evaluatePendingByIds(ids: string[]): Promise<EvaluatedPending[]> {
  if (ids.length === 0) return [];
  const [ctx, records] = await Promise.all([
    loadContext(),
    Promise.all(ids.map((id) => getPendingOperation(id))),
  ]);
  const out: EvaluatedPending[] = [];
  for (const r of records) {
    if (!r) continue;
    const op = refresh(r.op, ctx);
    out.push({ id: r.id, op, gate: evaluateApproval(op), createdAt: r.createdAt });
  }
  return out;
}

/** Bulk approve — commits only the operations that pass the gate; others stay.
 *  One context load for the whole run (audit F11). */
export async function commitAllApprovable(): Promise<{ committed: number; skipped: number }> {
  const [records, ctx] = await Promise.all([listPendingOperations(), loadContext()]);
  let committed = 0;
  let skipped = 0;
  for (const r of records) {
    const res = await commitRecord(r, ctx);
    if (res.committed) committed++;
    else skipped++;
  }
  return { committed, skipped };
}
