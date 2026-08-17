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
import { resolveDateExpression } from '@/ai/interpretation/dates';
import type { ResolvedOperation, ResolvedRef } from '@/ai/interpretation/types';
import type { EntityLite, ResolveContext } from '@/ai/interpretation/resolve';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { listPeople } from '@/db/queries/people';
import {
  deletePendingOperation,
  getPendingOperation,
  listPendingOperations,
} from '@/db/queries/pendingOperations';
import { insertTransaction, type NewTransaction } from '@/db/queries/transactions';

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
  if (ref.reference) {
    const needle = ref.reference.trim().toLowerCase();
    const matches = pool.filter((e) => e.name.trim().toLowerCase() === needle);
    if (matches.length === 1) return { reference: ref.reference, id: matches[0]!.id, status: 'resolved', options: [] };
    if (matches.length > 1)
      return {
        reference: ref.reference,
        id: null,
        status: 'ambiguous',
        options: matches.map((m) => ({ id: m.id, name: m.name })),
      };
  }
  return { reference: ref.reference, id: null, status: 'unresolved', options: [] };
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

function toNewTransaction(op: ResolvedOperation): NewTransaction {
  const { iso } = resolveDateExpression(op.dateExpression, new Date());
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

/**
 * Attempt to commit one pending operation. Returns blockers instead of
 * committing when the final gate does not pass. Only removes the pending row
 * on a successful commit.
 */
export async function commitPendingOperation(id: string): Promise<CommitResult> {
  const record = await getPendingOperation(id);
  if (!record) return { committed: false, blockers: [{ code: 'unsupported_operation', message: 'Pending item not found.' }] };

  const ctx = await loadContext();
  const op = refresh(record.op, ctx);

  const gate = evaluateApproval(op);
  if (!gate.approvable) return { committed: false, blockers: gate.blockers };

  const inserted = await insertTransaction(toNewTransaction(op));
  await deletePendingOperation(id);
  return { committed: true, transactionId: inserted.id, blockers: [] };
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

/** Bulk approve — commits only the operations that pass the gate; others stay. */
export async function commitAllApprovable(): Promise<{ committed: number; skipped: number }> {
  const records = await listPendingOperations();
  let committed = 0;
  let skipped = 0;
  for (const r of records) {
    const res = await commitPendingOperation(r.id);
    if (res.committed) committed++;
    else skipped++;
  }
  return { committed, skipped };
}
