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

/** The user's expression must plausibly encode a numeric magnitude (digit or spoken number). */
function expressionSupportsAmount(expr: string): boolean {
  if (/\d/.test(expr)) return true;
  return MAGNITUDE_WORDS.test(expr);
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
  /** Reference "now" — reserved for future relative-date resolution notes. */
  now?: Date;
}

export function validateInterpretation(
  input: unknown,
  _opts: ValidateOptions = {},
): ValidatedInterpretation {
  const raw = asObject(input);
  const transcript = asString(raw.transcript) ?? '';
  const issues: string[] = [];
  const candidates: OrdinaryCandidate[] = [];
  const specialized: SpecializedOperation[] = [];
  const unqualified: UnqualifiedIntent[] = [];

  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${counter++}`;

  const pushUnqualified = (
    src: Record<string, unknown>,
    operation: OrdinaryKind | 'unknown',
    amount: Amount,
    reason: RejectionReason,
  ) => {
    unqualified.push({
      localId: nextId('uq'),
      operation,
      amount, // grounded === false guaranteed by caller
      account: toRefOrNull(src.account),
      category: toRefOrNull(src.category),
      person: toRefOrNull(src.person),
      date: toDate(src.dateExpression),
      evidence: toEvidence(src.evidence),
      rejectionReason: reason,
      promoted: false,
      entersQueue: false,
    });
  };

  // Both `candidates` and `unqualifiedIntents` from the model are routed
  // through the SAME app-decided promotion logic: the app — not the model —
  // decides candidate-vs-unqualified purely from recomputed grounding.
  const processOrdinary = (rawItem: unknown) => {
    const src = asObject(rawItem);
    const amount = toAmount(src.amount);
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
      date: toDate(src.dateExpression),
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
      date: toDate(src.dateExpression ?? src.anchorDateExpression),
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
      const total = toAmount(src.total ?? src.amount);
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
        downgradeToOrdinary(src, 'expense', total, []);
        return;
      }
      const payer = toRefOrNull(src.payerRef ?? src.payer, dropped);
      const account = toRefOrNull(src.account, dropped);
      const category = toRefOrNull(src.category, dropped);
      const conflicts = toConflicts(src.conflicts);
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
      const base = toAmount(src.baseAmount ?? src.amount ?? src.total);
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
      if (evidence.length === 0 || strength === 'one_time') {
        downgradeToOrdinary(src, op, base, []);
        return;
      }
      if (strength === 'ambiguous') {
        downgradeToOrdinary(src, op, base, [
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
