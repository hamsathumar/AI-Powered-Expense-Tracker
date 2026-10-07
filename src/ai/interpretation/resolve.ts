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
import { formatAmount } from '@/domain/money';

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
  /** Accounts only: 'bank' | 'card' | 'cash'. Lets a type word the user
   *  added ("BOC *bank* account") be checked against the real account. */
  kind?: string;
}

/** A person's APPROVED lending balance (+ they owe the user), plus how many
 *  of their lending rows are still pending — exactly what Settle Up shows. */
export interface PersonBalance {
  netMinor: number;
  pendingCount: number;
}

export interface ResolveContext {
  accounts: EntityLite[];
  expenseCategories: EntityLite[];
  incomeCategories: EntityLite[];
  people: EntityLite[];
  /** Optional: enables filling "all the money he owed me" (TC-031). */
  personBalances?: Map<string, PersonBalance>;
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

// ── V1.3 (TC-029): generic words around an account name ─────────────────
/** Words that describe what an account IS rather than naming it. "account"
 *  fits any account; the rest must agree with the account's real type, so
 *  "BOC card" can never resolve to a BOC *bank* account. */
const GENERIC_ACCOUNT_WORDS: { pattern: RegExp; kinds: string[] | null }[] = [
  { pattern: /\b(?:savings\s+|current\s+)?(?:account|acct|a\/c)\b|^\s*(?:my|the|our)\s+/gi, kinds: null },
  { pattern: /\bbank\b/gi, kinds: ['bank'] },
  { pattern: /\b(?:credit\s+|debit\s+)?card\b/gi, kinds: ['card'] },
  { pattern: /\b(?:wallet|in\s+hand)\b/gi, kinds: ['cash'] },
];

/**
 * Resolve an ACCOUNT reference. Exact matching runs first and is unchanged.
 * Only when it finds nothing does a second, still-exact pass retry with the
 * generic words removed — "BOC bank account" → "BOC" — and that pass resolves
 * ONLY when:
 *  - the stripped name matches exactly ONE account, and
 *  - every type word removed agrees with that account's type.
 * Otherwise the ordinary result (near-match suggestions or unresolved) stands.
 * No guessing is added: the user said the account's name; the extra words
 * merely described it.
 */
export function resolveAccountRef(ref: EntityRef | null, pool: EntityLite[]): ResolvedRef | null {
  const first = resolveRef(ref, pool);
  if (!first || first.status === 'resolved' || !ref?.reference) return first;
  if (first.status === 'ambiguous' && matchPool(ref.reference, pool).length > 1) return first;

  // Strip progressively — "Commercial Bank account" must stop at
  // "Commercial Bank" (whose own name contains "Bank"), while "BOC bank
  // account" goes on to "BOC". The first step that matches exactly ONE
  // account, with every removed type word agreeing, wins.
  let stripped = ref.reference;
  const removedKinds: (string[] | null)[] = [];
  for (const { pattern, kinds } of GENERIC_ACCOUNT_WORDS) {
    const next = stripped.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
    if (next === stripped.replace(/\s+/g, ' ').trim()) continue;
    removedKinds.push(kinds);
    stripped = next;
    if (stripped.length === 0) return first;
    const matches = matchPool(stripped, pool);
    if (matches.length > 1) return first;
    if (matches.length === 0) continue;
    const account = matches[0]!;
    const typeAgrees = removedKinds.every(
      (k) => k === null || (account.kind !== undefined && k.includes(account.kind)),
    );
    if (!typeAgrees) return first;
    // The account's real name labels it from here on ("BOC", not "BOC bank
    // account") — the descriptive words added nothing.
    return { reference: account.name, id: account.id, status: 'resolved', options: [] };
  }
  return first;
}

// ── V1.3 (TC-031): "all the money he owed me" ───────────────────────────
/** A closed list of phrases that mean "the person's whole balance". Like the
 *  anaphoric-amount list, deliberately narrow: "half of what he owes" or "some
 *  of it" is NOT here and stays "Amount needed". */
const WHOLE_BALANCE =
  /\b(?:all|everything|whatever)\b[^.]{0,30}\b(?:owed?|owing|borrowed|lent|due)\b|\b(?:full|whole|entire|complete|total)\s+(?:balance|amount|debt|dues?)\b|\bsettled?\s+(?:up\s+)?(?:in\s+full|everything|completely|fully)\b|\bsettled?\s+up\s+all\b/i;

export function isWholeBalanceExpression(text: string | null): boolean {
  return !!text && WHOLE_BALANCE.test(text);
}

/**
 * Fill a repayment's amount from the person's APPROVED balance when the user
 * referred to the whole balance instead of a figure. Returns null unless every
 * piece lines up: a resolved person, a repayment direction that matches who
 * owes whom, and a non-zero balance in that direction. The result always
 * carries a BLOCKING confirmation — the app supplied the figure, the user must
 * agree to it (editing the amount clears it, like any amount conflict).
 */
function fillFromBalance(
  intent: UnqualifiedIntent,
  person: ResolvedRef | null,
  ctx: ResolveContext,
): { amountMinor: number; conflict: Conflict } | null {
  if (intent.operation !== 'lending' || !person?.id || !ctx.personBalances) return null;
  const said = [intent.amount.expression, ...intent.evidence.map((e) => e.sourceText)];
  if (!said.some(isWholeBalanceExpression)) return null;
  const balance = ctx.personBalances.get(person.id);
  if (!balance) return null;
  let amountMinor = 0;
  if (intent.direction === 'lend_repayment_received' && balance.netMinor > 0) amountMinor = balance.netMinor;
  if (intent.direction === 'borrow_repayment_made' && balance.netMinor < 0) amountMinor = -balance.netMinor;
  if (amountMinor <= 0) return null;

  const name = person.options[0]?.name ?? intent.person?.reference ?? 'them';
  const figure = formatAmount(amountMinor);
  const pending =
    balance.pendingCount > 0
      ? ` ${balance.pendingCount} pending lending item${balance.pendingCount === 1 ? '' : 's'} with ${name} ${balance.pendingCount === 1 ? 'is' : 'are'} not included.`
      : '';
  return {
    amountMinor,
    conflict: {
      kind: 'amount_by_reference',
      note: `${name}'s approved balance is ${figure} — this settles it in full.${pending} Confirm the amount.`,
    },
  };
}

// ── V1.3: the account the user SAID, when the model left it out ─────────
/**
 * What the user said about THIS operation: its own evidence spans, plus the
 * clauses of the transcript that mention its person or its amount. When the
 * utterance holds only one operation, the whole transcript is its scope.
 * Clauses split at "and", "then" and punctuation, so in "borrowed 300 from
 * Nuski to cash and spent 270 on lunch" the borrow sees only its own half.
 */
export interface SpokenScope {
  transcript: string;
  /** True when the utterance produced exactly one operation. */
  soleOperation: boolean;
}

function scopeTexts(
  scope: SpokenScope | undefined,
  evidence: { sourceText: string }[],
  anchors: (string | null | undefined)[],
): string[] {
  const texts = evidence.map((e) => e.sourceText);
  if (!scope?.transcript) return texts;
  if (scope.soleOperation) return [...texts, scope.transcript];
  const marks = anchors.filter((a): a is string => !!a && a.trim().length >= 2).map((a) => a.toLowerCase());
  if (marks.length === 0) return texts;
  const clauses = scope.transcript.split(/[,;.!?]|\band\b|\bthen\b/i);
  return [...texts, ...clauses.filter((c) => marks.some((m) => c.toLowerCase().includes(m)))];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * TC-035 backstop: the model sometimes leaves an income/lending account out
 * even though the user said it ("borrowed 300 from Nuski TO CASH"). The app
 * looks for an account NAME right after a money-movement word in what the user
 * said about this operation, and adopts it only when exactly ONE account is
 * named that way. A bare mention never counts ("paid room rent" does not mean
 * the Room account) — only "to/into/in" (and "from" for lending, where money
 * can leave the account) followed by the name.
 */
function accountFromWords(
  operation: OrdinaryKind,
  texts: string[],
  accounts: EntityLite[],
): EntityLite | null {
  if (operation !== 'income' && operation !== 'lending') return null;
  const cue = operation === 'lending' ? '(?:to|into|in|from)' : '(?:to|into|in)';
  const found = new Set<EntityLite>();
  for (const account of accounts) {
    const pattern = new RegExp(
      `\\b${cue}\\s+(?:my\\s+|the\\s+|our\\s+)?${escapeRegex(account.name.trim())}(?![\\p{L}\\p{N}])`,
      'iu',
    );
    if (texts.some((t) => pattern.test(t))) found.add(account);
  }
  return found.size === 1 ? [...found][0]! : null;
}

/** Adopt a spoken account when the model gave none at all. A reference the
 *  model DID give (even an unresolved one) is never overridden. */
function withSpokenAccount(
  resolved: ResolvedRef | null,
  operation: OrdinaryKind,
  texts: string[],
  accounts: EntityLite[],
): ResolvedRef | null {
  if (resolved && (resolved.status === 'resolved' || resolved.reference)) return resolved;
  const spoken = accountFromWords(operation, texts, accounts);
  if (!spoken) return resolved;
  return { reference: spoken.name, id: spoken.id, status: 'resolved', options: [] };
}

// ── V1.3 (TC-032, decision D2): where withdrawn cash goes ───────────────
const WITHDRAWAL_WORDS = /\b(withdr[ae]w[ns]?|withdrawals?|withdrawing|atm)\b/i;

/**
 * A transfer the user described as a cash withdrawal, whose destination the
 * model left empty, goes to the account literally named "Cash" — only when
 * exactly one account has that name. Otherwise the destination stays for the
 * user to pick. Never overrides a destination the model did give.
 */
function withCashDestination(
  resolved: ResolvedRef | null,
  texts: string[],
  accounts: EntityLite[],
): ResolvedRef | null {
  if (resolved && (resolved.status === 'resolved' || resolved.reference)) return resolved;
  if (!texts.some((t) => WITHDRAWAL_WORDS.test(t))) return resolved;
  const cash = accounts.filter((a) => a.name.trim().toLowerCase() === 'cash');
  if (cash.length !== 1) return resolved;
  return { reference: cash[0]!.name, id: cash[0]!.id, status: 'resolved', options: [] };
}

// ── V1.3 (device round): "spent 70 on lunch FROM IT" ──────────────────────
/** "from it", "from that", "from the money I borrowed / got", "from what I
 *  received" — the spend was paid out of money that came in earlier in the
 *  SAME sentence. A closed list; nothing vaguer counts. */
const FROM_THAT_MONEY =
  /\bfrom\s+(?:it|that|this|(?:the|that)\s+(?:same\s+)?(?:money|cash|amount)(?:\s+(?:i|that\s+i)\s+(?:borrowed|got|received|took))?|the\s+borrowed\s+(?:money|cash|amount)|what\s+i\s+(?:borrowed|got|received))\b/i;

/**
 * An expense the user paid "from it" / "from the money I borrowed" takes the
 * account of the money that came in earlier in the same utterance (a borrow,
 * a repayment received, or income) — but only when that is ONE resolved
 * account, and only for an expense whose own clause says so (found by its
 * amount). Anything else is left for the user to pick. Applied after every
 * operation is resolved, because it reads a sibling's account.
 */
export function inheritFundingAccount(ops: ResolvedOperation[], transcript: string): ResolvedOperation[] {
  if (!transcript || !FROM_THAT_MONEY.test(transcript)) return ops;
  const funding = new Set(
    ops
      .filter(
        (o) =>
          (o.operation === 'income' ||
            (o.operation === 'lending' && (o.direction === 'borrow' || o.direction === 'lend_repayment_received'))) &&
          o.account?.status === 'resolved' &&
          o.account.id,
      )
      .map((o) => `${o.account!.id}\u0000${o.account!.reference ?? ''}`),
  );
  if (funding.size !== 1) return ops;
  const [id, reference] = [...funding][0]!.split('\u0000') as [string, string];
  const clauses = transcript.split(/[,;.!?]|\band\b|\bthen\b/i);
  return ops.map((o) => {
    if (o.operation !== 'expense' || o.amountMinor === null) return o;
    if (o.account && (o.account.status === 'resolved' || o.account.reference)) return o;
    const digits = String(Math.round(o.amountMinor / 100));
    const own = clauses.filter((c) => new RegExp(`(^|\\D)${digits}(\\D|$)`).test(c));
    if (!own.some((c) => FROM_THAT_MONEY.test(c))) return o;
    return { ...o, account: { reference: reference || null, id, status: 'resolved', options: [] } };
  });
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
export function resolveUnqualified(
  intent: UnqualifiedIntent,
  ctx: ResolveContext,
  scope?: SpokenScope,
): ResolvedOperation {
  const operation: OrdinaryKind = intent.operation === 'unknown' ? 'expense' : intent.operation;
  const known = intent.operation !== 'unknown';
  const isExpInc = operation === 'expense' || operation === 'income';

  // The null amount is itself the blocker (the gate reports it once, as
  // "No amount yet"). V1.2 also attached an amount conflict here, which made a
  // single missing figure read as three separate problems (TC-031).
  const conflicts: Conflict[] = [];
  if (!known) {
    conflicts.push({
      kind: 'type_unconfirmed',
      note: 'The type was not clear from what you said; it is assumed to be an expense. Confirm or change it.',
    });
  }

  const person = resolveRef(intent.person, ctx.people);
  const personName = person?.id ? ctx.people.find((p) => p.id === person.id)?.name : undefined;
  const fromBalance = fillFromBalance(
    intent,
    person && personName ? { ...person, options: [{ id: person.id!, name: personName }] } : person,
    ctx,
  );
  if (fromBalance) conflicts.unshift(fromBalance.conflict);

  return {
    localId: intent.localId,
    kind: operation,
    operation,
    // Genuinely not known — never defaulted. The one exception is a whole-
    // balance repayment, filled from the app's own ledger with a confirmation.
    amountMinor: fromBalance?.amountMinor ?? null,
    amountProvenance: fromBalance ? 'AI_INTERPRETED' : 'UNRESOLVED',
    account: withSpokenAccount(
      resolveAccountRef(intent.account, ctx.accounts),
      operation,
      scopeTexts(scope, intent.evidence, [intent.person?.reference, intent.amount.expression]),
      ctx.accounts,
    ),
    toAccount: null,
    category: isExpInc ? resolveRef(intent.category, categoryPool(operation, ctx)) : null,
    person,
    direction: intent.direction,
    requestedLabel: null,
    dateExpression: intent.date.expression,
    name: intent.name,
    note: intent.note,
    paidBy: null,
    conflicts,
    transcript: '',
    specialized: null,
  };
}

export function resolveCandidate(
  cand: OrdinaryCandidate,
  ctx: ResolveContext,
  scope?: SpokenScope,
): ResolvedOperation {
  const isExpInc = cand.operation === 'expense' || cand.operation === 'income';
  return {
    localId: cand.localId,
    kind: cand.operation,
    operation: cand.operation,
    amountMinor: cand.amount.valueMinor,
    amountProvenance: cand.amount.provenance,
    account: withSpokenAccount(
      resolveAccountRef(cand.account, ctx.accounts),
      cand.operation,
      scopeTexts(scope, cand.evidence, [
        cand.person?.reference,
        cand.amount.expression?.replace(/\D+/g, '') || cand.amount.expression,
      ]),
      ctx.accounts,
    ),
    toAccount:
      cand.operation === 'transfer'
        ? withCashDestination(
            resolveAccountRef(cand.toAccount, ctx.accounts),
            [cand.name, ...scopeTexts(scope, cand.evidence, [cand.amount.expression?.replace(/\D+/g, '') || null])],
            ctx.accounts,
          )
        : null,
    category: isExpInc ? resolveRef(cand.category, categoryPool(cand.operation, ctx)) : null,
    person: resolveRef(cand.person, ctx.people),
    direction: cand.direction,
    requestedLabel: cand.requestedLabel,
    dateExpression: cand.date.expression,
    name: cand.name,
    note: cand.note,
    paidBy: cand.operation === 'expense' ? resolveRef(cand.paidBy, ctx.people) : null,
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
    account: resolveAccountRef(op.account, ctx.accounts),
    toAccount:
      op.kind === 'recurring' && operation === 'transfer'
        ? resolveAccountRef(op.toAccount, ctx.accounts)
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
