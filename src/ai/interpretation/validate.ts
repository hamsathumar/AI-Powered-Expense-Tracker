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
    if (resolveDateExpression(date.expression, now).resolved) return null;
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
    const account = toRefOrNull(src.account);
    const category = toRefOrNull(src.category);
    const person = toRefOrNull(src.person);
    unqualified.push({
      localId: nextId('uq'),
      operation,
      amount, // grounded === false guaranteed by caller
      account,
      category,
      person,
      date: toDate(src.dateExpression),
      // Named like any other operation so it is readable in the queue (F3).
      name: nameFor(src.name, {
        operation: operation === 'unknown' ? 'expense' : operation,
        categoryReference: category?.reference,
        personReference: person?.reference,
        accountReference: account?.reference,
      }),
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
    const conflicts = toConflicts(src.conflicts);
    if (promoted.conflict) conflicts.push(promoted.conflict);
    const uncertain = ambiguousAmountConflict(amount);
    if (uncertain) conflicts.push(uncertain);
    const requestedLabelRaw = asString(src.requestedLabel);
    const requestedLabel = requestedLabelRaw?.trim().toLowerCase() ?? null;
    const normalizedLabel = normOrdinary(requestedLabel);
    if (normalizedLabel && normalizedLabel !== operation) {
      conflicts.push({
        kind: 'action_vs_label',
        note: `Described action is "${operation}" but the input asked to record it as "${normalizedLabel}".`,
      });
    }

    const dropped: string[] = [];
    const account = toRef(src.account, dropped);
    const toAccount = operation === 'transfer' ? toRef(src.toAccount, dropped) : null;
    const category = isExpInc ? toRef(src.category, dropped) : null;
    const person =
      operation === 'lending' ? toRef(src.person, dropped) : toRefOrNull(src.person, dropped);
    const direction = operation === 'lending' ? normDirection(src.direction) : null;
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
    const account = toRef(src.account, dropped);
    const toAccount = operation === 'transfer' ? toRef(src.toAccount, dropped) : null;
    const category = isExpInc ? toRef(src.category, dropped) : null;
    const person =
      operation === 'lending' ? toRef(src.person, dropped) : toRefOrNull(src.person, dropped);
    const direction = operation === 'lending' ? normDirection(src.direction) : null;
    const conflicts = [...toConflicts(src.conflicts), ...extraConflicts];
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
      const conflicts = toConflicts(src.conflicts);
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
      const account = toRefOrNull(src.account, dropped);
      const toAccount = op === 'transfer' ? toRefOrNull(src.toAccount, dropped) : null;
      const category = op === 'expense' || op === 'income' ? toRefOrNull(src.category, dropped) : null;
      const person = op === 'lending' ? toRefOrNull(src.person, dropped) : null;
      const direction = op === 'lending' ? normDirection(src.direction) : null;
      const conflicts = toConflicts(src.conflicts);
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
    unqualifiedIntents: unqualified,
    issues,
  };
}

/** Two textual references agree when they are equal, or either is absent. */
function sameReference(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return true;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
