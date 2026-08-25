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
  Conflict,
  EntityRef,
  LendingDirection,
  OrdinaryCandidate,
  OrdinaryKind,
  Provenance,
  ResolvedOperation,
  ResolvedRef,
  SpecializedOperation,
  UnqualifiedIntent,
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

// ── Near-match suggestions (audit F10) ───────────────────────────────────
/** Fold to comparable letters/digits: "Commercial Bank" → "commercialbank". */
function fold(s: string): string {
  return s.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** Levenshtein distance, bailing out once it exceeds `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length]!;
}

/** How far two labels of this length may differ and still be "the same name". */
function tolerance(length: number): number {
  if (length <= 3) return 0;
  if (length <= 6) return 1;
  return 2;
}

/**
 * Names close enough to what was heard to be worth OFFERING. Speech
 * recognition mangles proper nouns constantly ("Nuski" → "Nusky"), and an
 * exact-match-only resolver turns every such miss into a manual hunt.
 *
 * These are SUGGESTIONS, never resolutions — the caller marks them
 * `ambiguous`, which the final gate refuses to commit. The user still picks.
 */
export function nearMatches(reference: string, pool: EntityLite[]): EntityLite[] {
  const needle = fold(reference);
  if (needle.length < 3) return []; // too short to guess safely
  const scored: { entity: EntityLite; score: number }[] = [];
  for (const entity of pool) {
    const candidate = fold(entity.name);
    if (candidate.length === 0) continue;
    if (candidate === needle) {
      scored.push({ entity, score: 0 });
      continue;
    }
    // One name contained in the other ("bank" → "Commercial Bank"). The
    // shorter side must be a real word's worth of characters, so a stray
    // fragment cannot match half the list.
    const shorter = Math.min(candidate.length, needle.length);
    if (shorter >= 4 && (candidate.includes(needle) || needle.includes(candidate))) {
      scored.push({ entity, score: candidate.startsWith(needle) || needle.startsWith(candidate) ? 1 : 2 });
      continue;
    }
    const limit = tolerance(Math.min(candidate.length, needle.length));
    if (limit === 0) continue;
    const distance = editDistance(needle, candidate, limit);
    if (distance <= limit) scored.push({ entity, score: 2 + distance });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.entity.name.localeCompare(b.entity.name))
    .slice(0, 4)
    .map((s) => s.entity);
}

/**
 * Resolve one reference against a pool. Never guesses; never picks the first.
 *
 * A reference that matches exactly one entity resolves. Anything else —
 * several exact matches, or only near-matches — stays UNRESOLVED/AMBIGUOUS
 * with the possibilities attached, so the user chooses and the gate keeps
 * blocking until they do.
 */
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
  // No exact match: offer near-matches for confirmation (audit F10).
  const near = nearMatches(ref.reference, pool);
  if (near.length > 0) {
    return {
      reference: ref.reference,
      id: null,
      status: 'ambiguous',
      options: near.map((m) => ({ id: m.id, name: m.name })),
    };
  }
  return { reference: ref.reference, id: null, status: 'unresolved', options: [] };
}

function categoryPool(op: OrdinaryCandidate['operation'], ctx: ResolveContext): EntityLite[] {
  return op === 'income' ? ctx.incomeCategories : ctx.expenseCategories;
}

/**
 * An intent the user voiced but whose amount could not be grounded (audit F3).
 *
 * V1 discarded these after validation: only a count survived, so a real intent
 * carrying a correct account, category, person and date became unrecoverable —
 * strictness turned into silent data loss. They now enter the queue as
 * ordinary pending rows with a NULL amount, which the user fills in on the
 * review screen.
 *
 * Nothing is invented to make that possible. The amount stays null (the gate
 * refuses it), and when the model named no recognisable operation, the assumed
 * type carries a blocking `type_unconfirmed` conflict rather than passing
 * itself off as understood.
 */
export function resolveUnqualified(intent: UnqualifiedIntent, ctx: ResolveContext): ResolvedOperation {
  const operation: OrdinaryKind = intent.operation === 'unknown' ? 'expense' : intent.operation;
  const known = intent.operation !== 'unknown';
  const isExpInc = operation === 'expense' || operation === 'income';

  const conflicts: Conflict[] = [
    {
      kind: 'amount_uncertain',
      note: 'No amount was heard for this one — add it before approving.',
    },
  ];
  if (!known) {
    conflicts.push({
      kind: 'type_unconfirmed',
      note: 'The type was not clear from what you said; it is assumed to be an expense. Confirm or change it.',
    });
  }

  return {
    localId: intent.localId,
    kind: operation,
    operation,
    amountMinor: null, // genuinely not known — never defaulted
    amountProvenance: 'UNRESOLVED',
    account: resolveRef(intent.account, ctx.accounts),
    toAccount: null,
    category: isExpInc ? resolveRef(intent.category, categoryPool(operation, ctx)) : null,
    person: resolveRef(intent.person, ctx.people),
    direction: null,
    requestedLabel: null,
    dateExpression: intent.date.expression,
    name: intent.name,
    conflicts,
    transcript: '',
    specialized: null,
  };
}

export function resolveCandidate(cand: OrdinaryCandidate, ctx: ResolveContext): ResolvedOperation {
  const isExpInc = cand.operation === 'expense' || cand.operation === 'income';
  return {
    localId: cand.localId,
    kind: cand.operation,
    operation: cand.operation,
    amountMinor: cand.amount.valueMinor,
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
