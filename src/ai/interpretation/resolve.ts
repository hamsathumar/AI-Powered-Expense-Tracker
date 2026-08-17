/**
 * Application-owned entity resolution.
 *
 * Turns TEXTUAL references from a validated interpretation into real
 * application entity ids — or leaves them genuinely unresolved. There is NO
 * "?? first entity" fallback: an unmatched reference stays `unresolved`, and a
 * reference that matches more than one entity stays `ambiguous`. The AI never
 * supplies ids; only this layer does.
 *
 * Pure: callers inject the current entity lists, so it is unit-testable and
 * re-runnable at commit time (the final gate re-resolves against live data).
 */
import type {
  EntityRef,
  LendingDirection,
  OrdinaryCandidate,
  Provenance,
  ResolvedOperation,
  ResolvedRef,
  SpecializedOperation,
} from './types';

export interface EntityLite {
  id: string;
  name: string;
}

export interface ResolveContext {
  accounts: EntityLite[];
  expenseCategories: EntityLite[];
  incomeCategories: EntityLite[];
  people: EntityLite[];
}

function matchPool(reference: string, pool: EntityLite[]): EntityLite[] {
  const needle = reference.trim().toLowerCase();
  return pool.filter((e) => e.name.trim().toLowerCase() === needle);
}

/** Resolve one reference against a pool. Never guesses; never picks the first. */
export function resolveRef(ref: EntityRef | null, pool: EntityLite[]): ResolvedRef | null {
  if (!ref) return null;
  if (!ref.reference) {
    return { reference: null, id: null, status: 'unresolved', options: [] };
  }
  const matches = matchPool(ref.reference, pool);
  if (matches.length === 1) {
    return { reference: ref.reference, id: matches[0]!.id, status: 'resolved', options: [] };
  }
  if (matches.length > 1) {
    return {
      reference: ref.reference,
      id: null,
      status: 'ambiguous',
      options: matches.map((m) => ({ id: m.id, name: m.name })),
    };
  }
  return { reference: ref.reference, id: null, status: 'unresolved', options: [] };
}

function categoryPool(op: OrdinaryCandidate['operation'], ctx: ResolveContext): EntityLite[] {
  return op === 'income' ? ctx.incomeCategories : ctx.expenseCategories;
}

export function resolveCandidate(cand: OrdinaryCandidate, ctx: ResolveContext): ResolvedOperation {
  const isExpInc = cand.operation === 'expense' || cand.operation === 'income';
  return {
    localId: cand.localId,
    kind: cand.operation,
    operation: cand.operation,
    amountMinor: cand.amount.valueMinor ?? 0,
    amountProvenance: cand.amount.provenance,
    account: resolveRef(cand.account, ctx.accounts),
    toAccount: cand.operation === 'transfer' ? resolveRef(cand.toAccount, ctx.accounts) : null,
    category: isExpInc ? resolveRef(cand.category, categoryPool(cand.operation, ctx)) : null,
    person: resolveRef(cand.person, ctx.people),
    direction: cand.direction,
    requestedLabel: cand.requestedLabel,
    dateExpression: cand.date.expression,
    name: cand.name,
    conflicts: cand.conflicts,
    transcript: '',
    specialized: null,
  };
}

/**
 * Specialized operations (Bill Split / Recurring) resolve their scalar refs
 * but are kept as a `specialized` payload for the dedicated editors — they are
 * NOT committed through the ordinary path (the gate blocks that).
 */
export function resolveSpecialized(op: SpecializedOperation, ctx: ResolveContext): ResolvedOperation {
  const base =
    op.kind === 'bill_split' ? op.total.valueMinor : op.base.valueMinor;
  const provenance: Provenance =
    op.kind === 'bill_split' ? op.total.provenance : op.base.provenance;
  const operation = op.operation;
  const isExpInc = operation === 'expense' || operation === 'income';
  const direction: LendingDirection | null =
    op.kind === 'recurring' ? op.direction : null;
  return {
    localId: op.localId,
    kind: op.kind,
    operation,
    amountMinor: base ?? 0,
    amountProvenance: provenance,
    account: resolveRef(op.account, ctx.accounts),
    toAccount:
      op.kind === 'recurring' && operation === 'transfer'
        ? resolveRef(op.toAccount, ctx.accounts)
        : null,
    category: isExpInc ? resolveRef(op.category, categoryPool(operation, ctx)) : null,
    person: op.kind === 'recurring' ? resolveRef(op.person, ctx.people) : null,
    direction,
    requestedLabel: null,
    dateExpression: op.kind === 'recurring' ? op.anchorDate.expression : op.date.expression,
    name: op.name,
    conflicts: op.conflicts,
    transcript: '',
    specialized: op,
  };
}
