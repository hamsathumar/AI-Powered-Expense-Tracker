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
import { toNewTransaction } from '@/ai/interpretation/toTransaction';
import type { ResolvedOperation, ResolvedRef } from '@/ai/interpretation/types';
import { resolveRef, type EntityLite, type ResolveContext } from '@/ai/interpretation/resolve';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { listPeople } from '@/db/queries/people';
import {
  deletePendingOperation,
  getPendingOperation,
  listPendingOperations,
} from '@/db/queries/pendingOperations';
import { insertTransaction } from '@/db/queries/transactions';

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
    listPeople(),
  ]);
  const lite = <T extends { id: string; name: string }>(xs: T[]): EntityLite[] =>
    xs.map((x) => ({ id: x.id, name: x.name }));
  return {
    accounts: lite(accounts),
    expenseCategories: lite(expenseCategories),
    incomeCategories: lite(incomeCategories),
    people: lite(people),
  };
}

/** Re-verify a resolved ref against live data: an id that vanished is downgraded. */
function refreshRef(ref: ResolvedRef | null, pool: EntityLite[]): ResolvedRef | null {
  if (!ref) return null;
  if (ref.id) {
    if (pool.some((e) => e.id === ref.id)) return { ...ref, status: 'resolved', options: [] };
    // fall through: the chosen id no longer exists — try to re-resolve by name
  }
  // Re-run the SAME resolution rules used at interpretation time (including
  // near-match suggestions), so the queue and the commit path can never
  // disagree about what a name means.
  return (
    resolveRef({ reference: ref.reference, provenance: 'AI_INTERPRETED', state: 'KNOWN', candidates: [] }, pool) ?? null
  );
}

function refresh(op: ResolvedOperation, ctx: ResolveContext): ResolvedOperation {
  const catPool = op.operation === 'income' ? ctx.incomeCategories : ctx.expenseCategories;
  return {
    ...op,
    account: refreshRef(op.account, ctx.accounts),
    toAccount: refreshRef(op.toAccount, ctx.accounts),
    category: op.category ? refreshRef(op.category, catPool) : null,
    person: refreshRef(op.person, ctx.people),
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

  // The capture time, not now — see toTransaction.ts.
  const inserted = await insertTransaction(toNewTransaction(op, record.createdAt));
  await deletePendingOperation(record.id);
  return { committed: true, transactionId: inserted.id, blockers: [] };
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
