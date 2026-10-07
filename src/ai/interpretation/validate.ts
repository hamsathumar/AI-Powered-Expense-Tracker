/**
 * Deterministic validation of an untrusted Gemini interpretation.
 *
 * Input: whatever `JSON.parse` produced from the model (typed `unknown`).
 * Output: a `ValidatedInterpretation` in which
 *   - grounding is RECOMPUTED by the app (the model's own `grounded` flag is
 *     never read),
 *   - only whitelisted fields are read (any model-supplied id / approved /
 *     commit field is structurally ignored),
 *   - ungrounded intents become `UnqualifiedIntent`s (never candidates, never
 *     queued) instead of being dropped,
 *   - over-eager Bill Split / Recurring classifications are downgraded unless
 *     the required explicit evidence is present,
 *   - action-vs-label and injection conflicts are surfaced.
 *
 * Pure and synchronous — no I/O, no crypto — so it is fully unit-testable.
 */
import { resolveDateExpression } from './dates';
import { detectInjection, isSuspiciousEntityReference, sanitiseName } from './injection';
import { resolveName, type NameContext } from './naming';
import {
  CONTRACT_SCHEMA_VERSION,
  type Amount,
  type Conflict,
  type DateExpr,
  type DateKind,
  type EntityRef,
  type EvidenceSpan,
  type EvidenceStrength,
  type InfoState,
  type IntervalHint,
  type LendingDirection,
  type OrdinaryCandidate,
  type OrdinaryKind,
  type Provenance,
  type RejectionReason,
  type SpecializedOperation,
  type UnqualifiedIntent,
  type ValidatedInterpretation,
} from './types';

// ── Small defensive readers (never throw) ────────────────────────────────
function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}
function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ── Normalizers ──────────────────────────────────────────────────────────
const ORDINARY = new Set<OrdinaryKind>(['income', 'expense', 'transfer', 'lending']);
const DIRECTIONS = new Set<LendingDirection>([
  'lend',
  'lend_repayment_received',
  'borrow',
  'borrow_repayment_made',
]);
const PROVENANCES = new Set<Provenance>([
  'USER_EXPLICIT',
  'AI_INTERPRETED',
  'AI_INFERRED',
  'UNRESOLVED',
]);
const STATES = new Set<InfoState>(['KNOWN', 'INFERRED', 'AMBIGUOUS', 'UNKNOWN']);

function normOrdinary(v: unknown): OrdinaryKind | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return ORDINARY.has(s as OrdinaryKind) ? (s as OrdinaryKind) : null;
}
function normDirection(v: unknown): LendingDirection | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return DIRECTIONS.has(s as LendingDirection) ? (s as LendingDirection) : null;
}
function normProvenance(v: unknown): Provenance {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return PROVENANCES.has(s as Provenance) ? (s as Provenance) : 'AI_INFERRED';
}
function normState(v: unknown): InfoState {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return STATES.has(s as InfoState) ? (s as InfoState) : 'UNKNOWN';
}
function normStrength(v: unknown): EvidenceStrength {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s === 'clear' || s === 'strong' || s === 'ambiguous' || s === 'one_time'
    ? (s as EvidenceStrength)
    : 'ambiguous';
}
function normInterval(v: unknown): IntervalHint {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  const ok: IntervalHint[] = ['daily', 'weekly', 'monthly', 'yearly', 'custom'];
  return ok.includes(s as IntervalHint) ? (s as IntervalHint) : 'UNRESOLVED';
}
function normDateKind(v: unknown): DateKind {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s === 'absolute' || s === 'relative' || s === 'named_weekday' ? (s as DateKind) : 'none';
}

// ── Grounding — the independent, app-authoritative check ─────────────────
const MAGNITUDE_WORDS =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|lakh|lac|crore|grand|dozen|[0-9]+k|[0-9]+m)\b/i;

/** Romanised Tamil number words the user actually speaks (audit F2). Spelling
 *  varies by speaker, so common variants are listed. Units (one…ninety) match
 *  as whole words; magnitude stems (ayiram, nooru, laksham, kodi) match as
 *  substrings because Tamil compounds them — "rendayiram" (2000) contains no
 *  standalone word. */
const TAMIL_MAGNITUDE_WORDS =
  /\b(onnu|onru|oru|rendu|irandu|moonu|moondru|munu|naalu|nalu|nanku|anju|ainthu|aaru|aru|ezhu|elu|ettu|onbathu|onpathu|pathu|paththu|patthu|irupathu|muppathu)\b|(a{1,2}yira(m|th)?|noo?ru|noothi|laksham?|latcham?|lacham?|kodi)/i;

/** Tamil-script number stems. `\b` does not work across Tamil codepoints and
 *  compounds fuse the initial vowel (ரெண்டாயிரம் carries யிர, not ஆயிரம்), so
 *  these are stem substrings. Tamil numeral digits (௦–௯) count as digits too. */
const TAMIL_SCRIPT_MAGNITUDES = ['யிர', 'ஆயிரம்', 'நூறு', 'நூற்', 'நூத்தி', 'லட்சம்', 'கோடி', 'பத்து'];

/** The user's expression must plausibly encode a numeric magnitude (digit or
 *  spoken number — English, romanised Tamil, or Tamil script). */
function expressionSupportsAmount(expr: string): boolean {
  if (/[\d௦-௯]/.test(expr)) return true;
  if (MAGNITUDE_WORDS.test(expr)) return true;
  if (TAMIL_MAGNITUDE_WORDS.test(expr)) return true;
  return TAMIL_SCRIPT_MAGNITUDES.some((w) => expr.includes(w));
}

/**
 * Audit F1 ("that amount" bug): an expression that refers BACK to an amount
 * already stated in the same utterance. Such an amount is not invented — it is
 * grounded by reference, provided its value exactly matches another grounded
 * amount in the same interpretation (checked by the caller). Deliberately a
 * closed list: anything not clearly anaphoric stays ungrounded.
 */
const ANAPHORIC_AMOUNT =
  /\b(that|the\s+same|this|it|same)\b[\s\S]{0,24}?\b(amount|money|sum|figure|value)\b|^\s*(it|that|the\s+same|same)\s*$|\b(full|whole|entire)\s+(amount|sum)\b|அதே\s*தொகை|அந்த\s*தொகை/i;

export function isAnaphoricAmountExpression(expr: string | null): boolean {
  if (!expr) return false;
  return ANAPHORIC_AMOUNT.test(expr);
}

/**
 * `grounded === true` requires ALL of:
 *  (a) a finite positive numeric value,
 *  (b) provenance ∈ {USER_EXPLICIT, AI_INTERPRETED} (never AI_INFERRED/UNRESOLVED),
 *  (c) a non-empty supporting expression that actually encodes a magnitude.
 * The model's own `grounded` claim is never consulted.
 */
function computeGrounded(value: number | null, provenance: Provenance, expression: string | null): boolean {
  if (value === null || value <= 0) return false;
  if (provenance !== 'USER_EXPLICIT' && provenance !== 'AI_INTERPRETED') return false;
  const expr = expression?.trim() ?? '';
  if (expr.length === 0) return false;
  return expressionSupportsAmount(expr);
}

function toAmount(raw: unknown): Amount {
  const o = asObject(raw);
  const value = asNumber(o.value);
  const provenance = normProvenance(o.provenance);
  const expression = asString(o.expression);
  const grounded = computeGrounded(value, provenance, expression);
  return {
    expression,
    valueMinor: grounded && value !== null ? Math.round(value * 100) : null,
    provenance,
    state: normState(o.state),
    grounded,
  };
}

/**
 * Audit F1: second-chance grounding for an anaphoric amount. "I received 2000…
 * and transferred that amount" used to drop the transfer, because "that
 * amount" carries no digits. An ungrounded amount is promoted when ALL of:
 *  (a) its expression is clearly anaphoric,
 *  (b) the model carried a concrete positive value for it, and
 *  (c) that value EXACTLY matches another grounded amount in the same
 *      utterance (the pool) — a deterministic cross-check, so nothing is
 *      invented.
 * The caller must attach the returned blocking `amount_by_reference` conflict
 * so the user confirms the link before approving.
 */
function groundByReference(
  rawAmount: unknown,
  amount: Amount,
  pool: Set<number>,
): { amount: Amount; conflict: Conflict } | null {
  if (amount.grounded) return null;
  if (!isAnaphoricAmountExpression(amount.expression)) return null;
  const value = asNumber(asObject(rawAmount).value);
  if (value === null || value <= 0) return null;
  const minor = Math.round(value * 100);
  if (!pool.has(minor)) return null;
  return {
    amount: { ...amount, valueMinor: minor, provenance: 'AI_INTERPRETED', grounded: true },
    conflict: {
      kind: 'amount_by_reference',
      note: `Amount read as the same ${minor % 100 === 0 ? minor / 100 : (minor / 100).toFixed(2)} mentioned earlier in this sentence (“${amount.expression}”). Confirm before approving.`,
    },
  };
}

/** Audit F6: a grounded amount the model itself marked AMBIGUOUS must be
 *  confirmed, not silently presented as certain. */
function ambiguousAmountConflict(amount: Amount): Conflict | null {
  if (!amount.grounded || amount.state !== 'AMBIGUOUS') return null;
  return {
    kind: 'amount_uncertain',
    note: `The amount was uncertain${amount.expression ? ` (“${amount.expression}”)` : ''} — check the figure against the transcript before approving.`,
  };
}

/**
 * Read one entity reference. Instruction-like references are DROPPED here
 * (TC-026): they never reach entity resolution, never reach the review screen,
 * and therefore can never be offered for creation as a real Person / Account /
 * Category. Every dropped reference is reported through `dropped` so the caller
 * can attach a blocking conflict.
 */
function toRef(raw: unknown, dropped: string[] = []): EntityRef {
  // NOTE: any `id`/`accountId`/… on `raw` is intentionally NOT read.
  const o = asObject(raw);
  let reference = asString(o.reference);
  if (reference !== null && isSuspiciousEntityReference(reference)) {
    dropped.push(reference);
    reference = null;
  }
  const candidates = asArray(o.candidates)
    .map((c) => asString(c))
    .filter((c): c is string => c !== null)
    .filter((c) => {
      if (isSuspiciousEntityReference(c)) {
        dropped.push(c);
        return false;
      }
      return true;
    });
  return {
    reference,
    provenance: normProvenance(o.provenance),
    state: reference ? normState(o.state) : 'UNKNOWN',
    candidates,
  };
}

function toRefOrNull(raw: unknown, dropped: string[] = []): EntityRef | null {
  const ref = toRef(raw, dropped);
  return ref.reference || ref.candidates.length > 0 ? ref : null;
}

/** A stated number of occurrences. Bounded so a malformed value cannot become
 *  an absurd schedule; anything outside the range is treated as unstated. */
function toOccurrenceCount(raw: unknown): number | null {
  const n = asNumber(raw);
  if (n === null || !Number.isInteger(n) || n < 1 || n > 600) return null;
  return n;
}

function toDate(raw: unknown): DateExpr {
  const o = asObject(raw);
  const expression = asString(o.expression);
  return { expression, kind: expression ? normDateKind(o.kind) : 'none' };
}

function toEvidence(raw: unknown): EvidenceSpan[] {
  return asArray(raw)
    .map((e) => {
      const o = asObject(e);
      const sourceText = asString(o.sourceText);
      if (!sourceText) return null;
      return { sourceText, supports: asString(o.supports) ?? '' } as EvidenceSpan;
    })
    .filter((e): e is EvidenceSpan => e !== null);
}

function toConflicts(raw: unknown): Conflict[] {
  return asArray(raw)
    .map((c) => {
      const o = asObject(c);
      const kind = typeof o.kind === 'string' ? o.kind.trim() : '';
      const allowed = new Set([
        'amount_correction',
        'action_vs_label',
        'entity_conflict',
        'recurrence_vs_onetime',
        'split_descriptive_vs_instructional',
      ]);
      if (!allowed.has(kind)) return null;
      return { kind: kind as Conflict['kind'], note: asString(o.note) ?? '' };
    })
    .filter((c): c is Conflict => c !== null);
}

// ── V1.3: action-vs-label is APP-OWNED (TC-028, TC-036) ──────────────────
/** Transaction-type words, so a label can be checked for actually naming a
 *  TYPE. "label it as fruits" names nothing; "record it as income" does. */
const TYPE_WORDS: [RegExp, OrdinaryKind][] = [
  [/\b(income|earn(?:ed|ing|ings)?)\b/i, 'income'],
  [/\b(expenses?|spen(?:t|d|ding))\b/i, 'expense'],
  [/\btransfer(?:s|red|ring)?\b/i, 'transfer'],
  [/\b(lend(?:ing)?|lent|loans?|borrow(?:ed|ing)?|repa(?:y|id|yment))\b/i, 'lending'],
];

/** The first transaction type named in `text` that differs from `operation`. */
function otherTypeNamed(text: string | null, operation: OrdinaryKind): OrdinaryKind | null {
  if (!text) return null;
  const exact = normOrdinary(text);
  if (exact) return exact !== operation ? exact : null;
  for (const [pattern, kind] of TYPE_WORDS) {
    if (kind !== operation && pattern.test(text)) return kind;
  }
  return null;
}

/**
 * Final conflict list for one operation.
 *
 * An action-vs-label conflict is decided by the APP, like grounding: it exists
 * only when the user asked for a DIFFERENT transaction type than the action
 * they described — from the model's `requestedLabel`, or failing that from the
 * model's own action_vs_label notes. The model's conflict objects themselves
 * are never passed through, so:
 *  - "label it as fruits" / "label it as Sham's share" (a NAME, not a type)
 *    raises nothing (TC-036);
 *  - the same contradiction reported by both the model and the app becomes
 *    ONE conflict, not two (TC-028).
 * Any other exact duplicate (same kind and note) is collapsed too.
 */
function finalizeConflicts(
  modelConflicts: Conflict[],
  operation: OrdinaryKind,
  requestedLabel: string | null,
): Conflict[] {
  const modelLabelNotes = modelConflicts.filter((c) => c.kind === 'action_vs_label').map((c) => c.note);
  const asked =
    otherTypeNamed(requestedLabel, operation) ??
    modelLabelNotes.map((note) => otherTypeNamed(note, operation)).find((k) => k !== null) ??
    null;

  const out: Conflict[] = [];
  const seen = new Set<string>();
  const add = (c: Conflict) => {
    const key = `${c.kind}\u0000${c.note}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  if (asked) {
    add({
      kind: 'action_vs_label',
      note: `Described action is "${operation}" but the input asked to record it as "${asked}".`,
    });
  }
  for (const c of modelConflicts) if (c.kind !== 'action_vs_label') add(c);
  return out;
}

/**
 * V1.3 (TC-029, TC-031, TC-035): for income and lending the user's account is
 * where the money LANDED ("to cash", "into BOC"), and the model regularly puts
 * that in `toAccount` — a field only transfers read, so the account was
 * silently lost. When `account` is empty and `toAccount` names something, the
 * reference the model actually heard is used. Nothing is invented.
 */
function accountSource(src: Record<string, unknown>, operation: OrdinaryKind | 'unknown'): unknown {
  if (operation !== 'income' && operation !== 'lending') return src.account;
  if (asString(asObject(src.account).reference)) return src.account;
  return asString(asObject(src.toAccount).reference) ? src.toAccount : src.account;
}

/** A dictated note: free text, so it gets the same injection check as a name
 *  (instruction-like text is never content) and a sane length cap. */
function toNote(raw: unknown): string | null {
  const text = asString(raw)?.replace(/\s+/g, ' ').trim() ?? '';
  if (!text) return null;
  const safe = sanitiseName(text);
  return safe ? safe.slice(0, 200) : null;
}

/** "me" / "I" / "myself" as the payer means the user paid — no pair needed. */
const SELF_REFERENCE = /^(me|i|myself|my\s*self|mine|us|we)$/i;

/** Expense only: who paid instead of the user (V1.3, TC-039). */
function toPayer(raw: unknown, operation: OrdinaryKind, dropped: string[]): EntityRef | null {
  if (operation !== 'expense') return null;
  const ref = toRefOrNull(raw, dropped);
  if (!ref?.reference || SELF_REFERENCE.test(ref.reference.trim())) return null;
  return ref;
}

/**
 * Name an operation (TC-023 / TC-024). Delegates to the app-owned naming
 * module: injected text is stripped, an uninformative name (the model echoing
 * "expense" back) is replaced by one derived from resolved context, and the
 * result is rendered in Title Case. Naming never affects financial data.
 */
function nameFor(raw: unknown, ctx: NameContext): string {
  return resolveName(asString(raw), ctx, sanitiseName);
}

/** Conflict attached when instruction-like text was stripped from an operation. */
const INJECTION_NOTE =
  'Instruction-like text detected in the spoken input; verify against the transcript before approving.';
const droppedRefNote = (refs: string[]): Conflict => ({
  kind: 'injection_suspected',
  note: `Ignored instruction-like text where a name was expected (${refs
    .map((r) => `“${r.slice(0, 40)}”`)
    .join(', ')}). Pick the right one before approving.`,
});

// ── Main entry ───────────────────────────────────────────────────────────
export interface ValidateOptions {
  /** Reference "now" — used to check whether a stated date expression is
   *  resolvable at all (audit F4). The real resolution still happens at
   *  commit, against the CAPTURE time. */
  now?: Date;
}

export function validateInterpretation(
  input: unknown,
  opts: ValidateOptions = {},
): ValidatedInterpretation {
  const now = opts.now ?? new Date();
  const raw = asObject(input);
  const transcript = asString(raw.transcript) ?? '';
  const issues: string[] = [];
  const candidates: OrdinaryCandidate[] = [];
  const specialized: SpecializedOperation[] = [];
  const unqualified: UnqualifiedIntent[] = [];

  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${counter++}`;

  // ── Audit F1 pre-scan: every grounded amount in the utterance. An anaphoric
  // amount ("that amount") may be promoted only against this pool.
  const groundedPool = new Set<number>();
  for (const item of [...asArray(raw.candidates), ...asArray(raw.unqualifiedIntents)]) {
    const a = toAmount(asObject(item).amount);
    if (a.grounded && a.valueMinor !== null) groundedPool.add(a.valueMinor);
  }
  for (const item of asArray(raw.specializedOperations)) {
    const o = asObject(item);
    const a = toAmount(o.total ?? o.baseAmount ?? o.amount);
    if (a.grounded && a.valueMinor !== null) groundedPool.add(a.valueMinor);
  }

  /** Promote an anaphoric amount against the pool; report through `issues`. */
  const withReferenceGrounding = (
    rawAmount: unknown,
    amount: Amount,
  ): { amount: Amount; conflict: Conflict | null } => {
    const promoted = groundByReference(rawAmount, amount, groundedPool);
    if (!promoted) return { amount, conflict: null };
    issues.push('amount grounded by reference to another amount in the same utterance');
    return promoted;
  };

  /**
   * Audit F4: a stated date expression the app-owned resolver cannot read
   * becomes a blocking conflict — without this, `toNewTransaction` would
   * silently record the capture day. Ordinary candidates only: specialized
   * operations open their dedicated editors, where the concrete date is
   * visible and editable before anything is saved.
   */
  const unresolvedDateConflict = (date: DateExpr): Conflict | null => {
    if (!date.expression) return null;
    const resolution = resolveDateExpression(date.expression, now);
    if (resolution.resolved && resolution.timeNeedsConfirm) {
      // V1.3 (TC-033): the day is understood, the hour could be am or pm.
      return {
        kind: 'date_unresolved',
        note: `“${date.expression}” — morning or evening? Set the time before approving.`,
      };
    }
    if (resolution.resolved) return null;
    return {
      kind: 'date_unresolved',
      note: `Couldn't turn “${date.expression}” into a date — approving records it on the day it was spoken. Confirm, or reject and re-enter with the date.`,
    };
  };

  const pushUnqualified = (
    src: Record<string, unknown>,
    operation: OrdinaryKind | 'unknown',
    amount: Amount,
    reason: RejectionReason,
  ) => {
    const account = toRefOrNull(accountSource(src, operation));
    const category = toRefOrNull(src.category);
    const person = toRefOrNull(src.person);
    const direction = operation === 'lending' ? normDirection(src.direction) : null;
    unqualified.push({
      localId: nextId('uq'),
      operation,
      amount, // grounded === false guaranteed by caller
      account,
      category,
      person,
      direction,
      date: toDate(src.dateExpression),
      // Named like any other operation so it is readable in the queue (F3).
      name: nameFor(src.name, {
        operation: operation === 'unknown' ? 'expense' : operation,
        categoryReference: category?.reference,
        personReference: person?.reference,
        accountReference: account?.reference,
        direction,
      }),
      note: toNote(src.note),
      evidence: toEvidence(src.evidence),
      rejectionReason: reason,
      promoted: false,
      committable: false,
    });
  };

  // Both `candidates` and `unqualifiedIntents` from the model are routed
  // through the SAME app-decided promotion logic: the app — not the model —
  // decides candidate-vs-unqualified purely from recomputed grounding.
  const processOrdinary = (rawItem: unknown) => {
    const src = asObject(rawItem);
    const promoted = withReferenceGrounding(src.amount, toAmount(src.amount));
    const amount = promoted.amount;
    const operation = normOrdinary(src.operation);

    if (!amount.grounded) {
      pushUnqualified(src, operation ?? 'unknown', amount, 'NO_TRANSACTION_VALUE_DETECTED');
      return;
    }
    if (!operation) {
      pushUnqualified(src, 'unknown', amount, 'UNSUPPORTED_OPERATION');
      return;
    }

    const isExpInc = operation === 'expense' || operation === 'income';
    const requestedLabelRaw = asString(src.requestedLabel);
    const requestedLabel = requestedLabelRaw?.trim().toLowerCase() ?? null;
    const conflicts = finalizeConflicts(toConflicts(src.conflicts), operation, requestedLabel);
    if (promoted.conflict) conflicts.push(promoted.conflict);
    const uncertain = ambiguousAmountConflict(amount);
    if (uncertain) conflicts.push(uncertain);

    const dropped: string[] = [];
    const account = toRef(accountSource(src, operation), dropped);
    const toAccount = operation === 'transfer' ? toRef(src.toAccount, dropped) : null;
    const category = isExpInc ? toRef(src.category, dropped) : null;
    const person =
      operation === 'lending' ? toRef(src.person, dropped) : toRefOrNull(src.person, dropped);
    const direction = operation === 'lending' ? normDirection(src.direction) : null;
    const paidBy = toPayer(src.paidBy, operation, dropped);
    if (dropped.length > 0) conflicts.push(droppedRefNote(dropped));

    const date = toDate(src.dateExpression);
    const dateConflict = unresolvedDateConflict(date);
    if (dateConflict) conflicts.push(dateConflict);

    candidates.push({
      localId: nextId('cand'),
      operation,
      amount,
      account,
      toAccount,
      category,
      person,
      direction,
      requestedLabel,
      date,
      name: nameFor(src.name, {
        operation,
        categoryReference: category?.reference,
        personReference: person?.reference,
        toAccountReference: toAccount?.reference,
        accountReference: account.reference,
        direction,
      }),
      note: toNote(src.note),
      paidBy,
      conflicts,
      evidence: toEvidence(src.evidence),
    });
  };

  const downgradeToOrdinary = (
    src: Record<string, unknown>,
    operation: OrdinaryKind,
    amount: Amount,
    extraConflicts: Conflict[],
  ) => {
    const isExpInc = operation === 'expense' || operation === 'income';
    const dropped: string[] = [];
    const account = toRef(accountSource(src, operation), dropped);
    const toAccount = operation === 'transfer' ? toRef(src.toAccount, dropped) : null;
    const category = isExpInc ? toRef(src.category, dropped) : null;
    const person =
      operation === 'lending' ? toRef(src.person, dropped) : toRefOrNull(src.person, dropped);
    const direction = operation === 'lending' ? normDirection(src.direction) : null;
    const conflicts = [
      ...finalizeConflicts(toConflicts(src.conflicts), operation, asString(src.requestedLabel)),
      ...extraConflicts,
    ];
    if (dropped.length > 0) conflicts.push(droppedRefNote(dropped));
    const uncertain = ambiguousAmountConflict(amount);
    if (uncertain) conflicts.push(uncertain);

    const date = toDate(src.dateExpression ?? src.anchorDateExpression);
    const dateConflict = unresolvedDateConflict(date);
    if (dateConflict) conflicts.push(dateConflict);

    candidates.push({
      localId: nextId('cand'),
      operation,
      amount,
      account,
      toAccount,
      category,
      person,
      direction,
      requestedLabel: null,
      date,
      name: nameFor(src.name, {
        operation,
        categoryReference: category?.reference,
        personReference: person?.reference,
        toAccountReference: toAccount?.reference,
        accountReference: account.reference,
        direction,
      }),
      note: toNote(src.note),
      paidBy: toPayer(src.paidBy, operation, dropped),
      conflicts,
      evidence: toEvidence(src.evidence),
    });
  };

  const processSpecialized = (rawItem: unknown) => {
    const src = asObject(rawItem);
    const kind = typeof src.operationKind === 'string' ? src.operationKind.trim().toLowerCase() : '';

    if (kind === 'bill_split') {
      const promotedTotal = withReferenceGrounding(src.total ?? src.amount, toAmount(src.total ?? src.amount));
      const total = promotedTotal.amount;
      if (!total.grounded) {
        pushUnqualified(src, 'expense', total, 'NO_TRANSACTION_VALUE_DETECTED');
        return;
      }
      const dropped: string[] = [];
      const splitEvidence = toEvidence(src.splitEvidence);
      const participants = asArray(src.participantRefs ?? src.participants)
        .map((p) => toRefOrNull(p, dropped))
        .filter((p): p is EntityRef => p !== null);

      // BS-1 backstop: without EXPLICIT split evidence AND ≥1 participant,
      // this is an ordinary expense — never a Bill Split.
      if (splitEvidence.length === 0 || participants.length < 1) {
        issues.push('bill_split downgraded to ordinary expense: no explicit split evidence');
        downgradeToOrdinary(src, 'expense', total, promotedTotal.conflict ? [promotedTotal.conflict] : []);
        return;
      }
      const payer = toRefOrNull(src.payerRef ?? src.payer, dropped);
      const account = toRefOrNull(src.account, dropped);
      const category = toRefOrNull(src.category, dropped);
      const conflicts = finalizeConflicts(toConflicts(src.conflicts), 'expense', asString(src.requestedLabel));
      if (promotedTotal.conflict) conflicts.push(promotedTotal.conflict);
      const uncertainTotal = ambiguousAmountConflict(total);
      if (uncertainTotal) conflicts.push(uncertainTotal);
      if (dropped.length > 0) conflicts.push(droppedRefNote(dropped));

      specialized.push({
        localId: nextId('bs'),
        kind: 'bill_split',
        operation: 'expense',
        total,
        participants,
        payer,
        allocationHint: asString(src.allocationHint),
        account,
        category,
        date: toDate(src.dateExpression),
        name: nameFor(src.name, {
          operation: 'expense',
          categoryReference: category?.reference,
          billSplit: true,
        }),
        splitEvidence,
        conflicts,
      });
      return;
    }

    if (kind === 'recurring') {
      const promotedBase = withReferenceGrounding(
        src.baseAmount ?? src.amount ?? src.total,
        toAmount(src.baseAmount ?? src.amount ?? src.total),
      );
      const base = promotedBase.amount;
      const op = normOrdinary(src.operation) ?? 'expense';
      if (!base.grounded) {
        pushUnqualified(src, op, base, 'NO_TRANSACTION_VALUE_DETECTED');
        return;
      }
      const evidence = toEvidence(src.recurringEvidence);
      const strength = normStrength(src.evidenceStrength);

      // RC backstop (evidence-based, no numeric threshold):
      //  - clear/strong + evidence → recurring operation
      //  - ambiguous → ordinary one-time candidate WITH a blocking conflict
      //  - one_time / no evidence → plain ordinary candidate
      const carried = promotedBase.conflict ? [promotedBase.conflict] : [];
      if (evidence.length === 0 || strength === 'one_time') {
        downgradeToOrdinary(src, op, base, carried);
        return;
      }
      if (strength === 'ambiguous') {
        downgradeToOrdinary(src, op, base, [
          ...carried,
          {
            kind: 'recurrence_vs_onetime',
            note: 'Recurring intent is ambiguous; recorded as one-time pending your confirmation.',
          },
        ]);
        return;
      }
      const dropped: string[] = [];
      const account = toRefOrNull(accountSource(src, op), dropped);
      const toAccount = op === 'transfer' ? toRefOrNull(src.toAccount, dropped) : null;
      const category = op === 'expense' || op === 'income' ? toRefOrNull(src.category, dropped) : null;
      const person = op === 'lending' ? toRefOrNull(src.person, dropped) : null;
      const direction = op === 'lending' ? normDirection(src.direction) : null;
      const conflicts = finalizeConflicts(toConflicts(src.conflicts), op, asString(src.requestedLabel));
      if (promotedBase.conflict) conflicts.push(promotedBase.conflict);
      const uncertainBase = ambiguousAmountConflict(base);
      if (uncertainBase) conflicts.push(uncertainBase);
      if (dropped.length > 0) conflicts.push(droppedRefNote(dropped));

      specialized.push({
        localId: nextId('rec'),
        kind: 'recurring',
        operation: op,
        base,
        recurrenceExpression: asString(src.recurrenceExpression),
        intervalHint: normInterval(src.intervalHint),
        anchorDate: toDate(src.anchorDateExpression),
        // TC-025: a stated duration ("for the next 3 months") is part of what
        // the user said. It is preserved as an EXPRESSION / count here and
        // resolved to a real end date by app-owned logic, never by the model.
        endExpression: asString(src.endExpression),
        occurrenceCount: toOccurrenceCount(src.occurrenceCount),
        evidenceStrength: strength,
        account,
        toAccount,
        category,
        person,
        direction,
        name: nameFor(src.name, {
          operation: op,
          categoryReference: category?.reference,
          personReference: person?.reference,
          toAccountReference: toAccount?.reference,
          accountReference: account?.reference,
          direction,
          recurring: true,
        }),
        recurringEvidence: evidence,
        conflicts,
      });
      return;
    }

    // Unknown specialized kind: fall back to treating it as an ordinary intent.
    processOrdinary({ ...src, operation: src.operation });
  };

  asArray(raw.candidates).forEach(processOrdinary);
  asArray(raw.unqualifiedIntents).forEach(processOrdinary);
  asArray(raw.specializedOperations).forEach(processSpecialized);

  // ── TC-021 backstop: one spend, one operation ──────────────────────────
  // A single utterance that describes a Bill Split (or a recurring charge)
  // must not ALSO yield a plain candidate for the same money. In TC-021 the
  // model emitted both, both became real pending rows, and approving both
  // would have double-counted Rs900. The specialized operation is canonical;
  // the duplicate is suppressed here, before anything is queued.
  //
  // Deliberately narrow so two genuinely different transactions of the same
  // value survive: the amount, the operation type AND the category reference
  // must all agree (a null category on either side counts as agreement,
  // because the model routinely omits it on the duplicate).
  const deduped = candidates.filter((cand) => {
    const twin = specialized.find((sp) => {
      const spAmount = sp.kind === 'bill_split' ? sp.total.valueMinor : sp.base.valueMinor;
      if (spAmount === null || spAmount !== cand.amount.valueMinor) return false;
      if (sp.operation !== cand.operation) return false;
      return sameReference(sp.category?.reference ?? null, cand.category?.reference ?? null);
    });
    if (!twin) return true;
    issues.push(
      `suppressed ordinary ${cand.operation} candidate duplicating ${twin.kind} operation ${twin.localId}`,
    );
    return false;
  });

  // ── V1.3 (TC-038): one voiced intent, one queue item ───────────────────
  // The model can list the same amountless intent in BOTH `candidates` (with a
  // null amount) and `unqualifiedIntents`; both arrays are read, so a single
  // "spent … on samosas" produced two identical "Amount needed" cards. An
  // unqualified intent is dropped when it repeats one already kept, or repeats
  // a qualified candidate (same type and name, compatible references). Two
  // genuinely different intents — different names or entities — both survive.
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const keptUnqualified: UnqualifiedIntent[] = [];
  for (const u of unqualified) {
    const twin =
      keptUnqualified.find(
        (k) =>
          k.operation === u.operation &&
          sameName(k.name, u.name) &&
          sameReference(k.category?.reference ?? null, u.category?.reference ?? null) &&
          sameReference(k.account?.reference ?? null, u.account?.reference ?? null) &&
          sameReference(k.person?.reference ?? null, u.person?.reference ?? null),
      ) ??
      deduped.find(
        (c) =>
          c.operation === u.operation &&
          sameName(c.name, u.name) &&
          sameReference(c.category?.reference ?? null, u.category?.reference ?? null) &&
          sameReference(c.person?.reference ?? null, u.person?.reference ?? null),
      );
    if (twin) {
      issues.push(`suppressed unqualified ${u.operation} intent "${u.name}" duplicating ${twin.localId}`);
      continue;
    }
    keptUnqualified.push(u);
  }

  // ── V1.3 (TC-034, Critical): a number inside a NOTE is not a transaction ─
  // "Transfer 5,000 from Room to BOC, add a note: 200 left" produced a second,
  // spurious "Note" expense of Rs200. The note is read from the user's own
  // words; any operation whose amount appears ONLY inside it is flagged with a
  // blocking conflict (never silently dropped — the user rejects it), and the
  // note is attached to the real operation when there is exactly one.
  const dictated = userNote(transcript);
  if (dictated) {
    const outside = transcript.replace(dictated.span, ' ');
    const digitsIn = (minor: number | null) => (minor === null ? null : String(Math.round(minor / 100)));
    const appearsOnlyInNote = (minor: number | null) => {
      const d = digitsIn(minor);
      if (!d) return false;
      const re = new RegExp(`(^|\\D)${d}(\\D|$)`);
      return re.test(dictated.text.replace(/,/g, '')) && !re.test(outside.replace(/,/g, ''));
    };
    const real: OrdinaryCandidate[] = [];
    for (const c of deduped) {
      if (appearsOnlyInNote(c.amount.valueMinor)) {
        c.conflicts.push({
          kind: 'note_not_transaction',
          note: `“${dictated.text}” is the note you dictated — this ${c.amount.valueMinor! / 100} is part of it, not a separate transaction. Reject this one unless it really is.`,
        });
        issues.push('operation built from a number inside a dictated note was flagged');
      } else {
        real.push(c);
      }
    }
    const realOps = real.length + specialized.length + keptUnqualified.length;
    if (realOps === 1) {
      const target = real[0] ?? keptUnqualified[0];
      if (target && !target.note) target.note = dictated.text.slice(0, 200);
    }
  }

  // ── V1.3 (TC-032): withdrawing cash is not spending ────────────────────
  // An ATM withdrawal moves money from a bank into cash in hand — a transfer.
  // If one still arrives typed as an EXPENSE, the app does not retype it (the
  // type is the user's to confirm), but it blocks with a plain question so it
  // can never inflate spending through "Approve now".
  if (WITHDRAWAL.test(transcript)) {
    const looksLikeWithdrawal = (c: OrdinaryCandidate) =>
      WITHDRAWAL.test(c.name) || c.evidence.some((e) => WITHDRAWAL.test(e.sourceText)) || deduped.length === 1;
    for (const c of deduped) {
      if (c.operation === 'expense' && looksLikeWithdrawal(c) && !c.conflicts.some((x) => x.kind === 'type_unconfirmed')) {
        c.conflicts.push({
          kind: 'type_unconfirmed',
          note: 'Withdrawing cash moves money into your Cash account — that is a transfer, not spending. Change the type, or confirm if this really was a purchase.',
        });
      }
    }
  }

  // ── V1.3 (TC-036): "label it as fruits" is the NAME the user chose ────
  // Read straight from the user's words, so it holds whatever the model did
  // with the instruction. Only when the utterance yields exactly ONE
  // operation — with several, the words cannot be tied to one of them here
  // (the prompt handles that case). A label naming a transaction TYPE
  // ("label it as income") is not a name: that stays an action-vs-label
  // conflict. Instruction-like text is never adopted (sanitiseName).
  const instruction = userLabelInstruction(transcript);
  const label = instruction?.label ?? null;
  const total = deduped.length + specialized.length + keptUnqualified.length;

  // ── V1.3 (device round, "label it as Shamsiya"): a label is never a conflict
  // The model sometimes turns the user's label into a vague conflict ("Shamsiya
  // is not a known entity"), which blocks the item and names nothing. Any
  // MODEL conflict that merely restates the label is dropped — app-owned kinds
  // (type contradiction, injection) are never touched. The operation the model
  // attached it to is exactly where the label belongs, so with several
  // operations that pinpoints which one to name.
  if (label) {
    const needle = label.toLowerCase();
    const restates = (c: Conflict) =>
      c.kind !== 'action_vs_label' && c.kind !== 'injection_suspected' && c.note.toLowerCase().includes(needle);
    const holders = [...deduped, ...specialized].filter((op) => op.conflicts.some(restates));
    for (const op of holders) {
      op.conflicts = op.conflicts.filter((c) => !restates(c));
      issues.push('dropped a model conflict that only restated the user\'s label');
    }
    const safe = sanitiseName(label);
    if (total > 1 && holders.length === 1 && safe && !otherTypeNamed(label, holders[0]!.operation)) {
      holders[0]!.name = resolveName(safe, { operation: holders[0]!.operation }, sanitiseName);
    }
  }
  if (label && total === 1) {
    const target = (deduped[0] ?? specialized[0] ?? keptUnqualified[0]) as
      | OrdinaryCandidate
      | SpecializedOperation
      | UnqualifiedIntent;
    const op: OrdinaryKind = target.operation === 'unknown' ? 'expense' : target.operation;
    // A type named by the label itself ("label it as income") or by the noun
    // the user called it ("name THE EXPENSE as rent provision", said of an
    // income — TC-028). Either is a type contradiction to confirm once; a
    // noun-only contradiction still lets the label become the name.
    const askedType = otherTypeNamed(label, op);
    const calledType = instruction?.noun ? otherTypeNamed(instruction.noun, op) : null;
    if (!askedType && calledType && 'conflicts' in target && !target.conflicts.some((c) => c.kind === 'action_vs_label')) {
      target.conflicts.push({
        kind: 'action_vs_label',
        note: `Described action is "${op}" but the input called it "${calledType}". Confirm the type.`,
      });
    }
    if (askedType) {
      // "label it as income" on a spend: a TYPE contradiction, said in the
      // user's own words — raise it even if the model reported nothing.
      // (An amountless intent has no conflicts yet; it is blocked anyway.)
      if ('conflicts' in target && !target.conflicts.some((c) => c.kind === 'action_vs_label')) {
        target.conflicts.push({
          kind: 'action_vs_label',
          note: `Described action is "${op}" but the input asked to record it as "${askedType}".`,
        });
      }
    } else if (!normOrdinary(label)) {
      const safe = sanitiseName(label);
      if (safe) {
        target.name = resolveName(safe, { operation: op }, sanitiseName);
        issues.push('name taken from the label the user asked for');
      }
    }
  }

  // Injection backstop: flag every qualified operation for mandatory review.
  if (detectInjection(transcript)) {
    for (const c of deduped) {
      if (!c.conflicts.some((x) => x.kind === 'injection_suspected')) {
        c.conflicts.push({ kind: 'injection_suspected', note: INJECTION_NOTE });
      }
    }
    for (const s of specialized) {
      if (!s.conflicts.some((x) => x.kind === 'injection_suspected')) {
        s.conflicts.push({ kind: 'injection_suspected', note: INJECTION_NOTE });
      }
    }
    issues.push('injection markers detected in transcript');
  }

  const hasQualified = deduped.length > 0 || specialized.length > 0;
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    outcome: hasQualified ? 'CANDIDATES_PRESENT' : 'NO_TRANSACTION_VALUE_DETECTED',
    transcript,
    candidates: deduped,
    specializedOperations: specialized,
    unqualifiedIntents: keptUnqualified,
    issues,
  };
}

/**
 * "label it as fruits", "name the expense as rent provision", "call it Sham's
 * share" → the label. The capture stops at the end of the clause, or at a
 * connective that starts the next thought ("… as Sham's share on lunch" →
 * "Sham's share"). Five words at most — a longer capture is a sentence, not a
 * label. Null when there is no such instruction.
 */
const LABEL_INSTRUCTION =
  /\b(?:label|name|call|title)\s+(?:it|this|that|the\s+(expense|income|transaction|payment|transfer|loan|entry|item|purchase|bill))?\s*(?:as|to)?\s+(?!(?:of|is|was)\b)["“']?([^,.;!?"”]+?)["”']?\s*(?=[,.;!?]|$|\s(?:and|then|from|on|in|with|using|for|by)\b)/i;

/** The label, plus the noun the user used for the transaction ("name THE
 *  EXPENSE as …"), which can itself contradict the action (TC-028). */
export function userLabelInstruction(transcript: string): { label: string; noun: string | null } | null {
  const m = transcript.match(LABEL_INSTRUCTION);
  const label = m?.[2]?.trim() ?? '';
  if (!label || label.split(/\s+/).length > 5) return null;
  return { label, noun: m?.[1]?.toLowerCase() ?? null };
}

export function userLabel(transcript: string): string | null {
  return userLabelInstruction(transcript)?.label ?? null;
}

/** Cash leaving a bank by withdrawal (TC-032). */
const WITHDRAWAL = /\b(withdr[ae]w[ns]?|withdrawals?|withdrawing|atm)\b/i;

/**
 * A note the user dictated: "add (an optional) note as 200 left", "with a note
 * saying …", "note: …". A cue is required — "a note book for 200" is not a
 * note. Returns the note text and the exact span it was read from.
 */
const NOTE_INSTRUCTION =
  /(?:\b(?:add|with|put|attach|include|optional)\b(?:\s+\w+){0,2}?\s+note\b\s*(?:as|saying|that\s+says|that|:|-)?|\bnote\s*(?:as|saying|that\s+says|:|-))\s*["“']?([^"”.;!?]+?)["”']?\s*(?=[.;!?]|$)/i;

export function userNote(transcript: string): { text: string; span: string } | null {
  const m = transcript.match(NOTE_INSTRUCTION);
  const text = m?.[1]?.trim() ?? '';
  if (!m || !text) return null;
  const safe = sanitiseName(text);
  return safe ? { text: safe, span: m[0] } : null;
}

/** Two textual references agree when they are equal, or either is absent. */
function sameReference(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return true;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
