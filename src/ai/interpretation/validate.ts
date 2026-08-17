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

function toRef(raw: unknown): EntityRef {
  // NOTE: any `id`/`accountId`/… on `raw` is intentionally NOT read.
  const o = asObject(raw);
  const reference = asString(o.reference);
  const candidates = asArray(o.candidates)
    .map((c) => asString(c))
    .filter((c): c is string => c !== null);
  return {
    reference,
    provenance: normProvenance(o.provenance),
    state: reference ? normState(o.state) : 'UNKNOWN',
    candidates,
  };
}

function toRefOrNull(raw: unknown): EntityRef | null {
  const ref = toRef(raw);
  return ref.reference || ref.candidates.length > 0 ? ref : null;
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

function cleanName(raw: unknown, fallback: string): string {
  const s = asString(raw);
  if (!s) return fallback;
  // Collapse whitespace and cap length. (Naming quality R12 - no data-integrity impact.)
  const cleaned = s.replace(/\s+/g, ' ').trim().slice(0, 120);
  return cleaned.length > 0 ? cleaned : fallback;
}

// ── Injection detection (deterministic backstop, not the only defence) ────
const INJECTION_MARKERS: RegExp[] = [
  /ignore\s+(all\s+)?(the\s+)?previous\s+instructions/i,
  /ignore\s+everything\s+above/i,
  /ignore\s+your\s+(transaction\s+)?rules/i,
  /disregard\s+(the\s+)?(above|previous|prior)/i,
  /system\s+override/i,
  /change\s+the\s+amount\s+to/i,
  /you\s+are\s+now/i,
  /pretend\s+(that|to)/i,
];
function detectInjection(transcript: string): boolean {
  return INJECTION_MARKERS.some((re) => re.test(transcript));
}

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

    candidates.push({
      localId: nextId('cand'),
      operation,
      amount,
      account: toRef(src.account),
      toAccount: operation === 'transfer' ? toRef(src.toAccount) : null,
      category: isExpInc ? toRef(src.category) : null,
      person: operation === 'lending' ? toRef(src.person) : toRefOrNull(src.person),
      direction: operation === 'lending' ? normDirection(src.direction) : null,
      requestedLabel,
      date: toDate(src.dateExpression),
      name: cleanName(src.name, operation),
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
    candidates.push({
      localId: nextId('cand'),
      operation,
      amount,
      account: toRef(src.account),
      toAccount: operation === 'transfer' ? toRef(src.toAccount) : null,
      category: isExpInc ? toRef(src.category) : null,
      person: operation === 'lending' ? toRef(src.person) : toRefOrNull(src.person),
      direction: operation === 'lending' ? normDirection(src.direction) : null,
      requestedLabel: null,
      date: toDate(src.dateExpression ?? src.anchorDateExpression),
      name: cleanName(src.name, operation),
      conflicts: [...toConflicts(src.conflicts), ...extraConflicts],
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
      const splitEvidence = toEvidence(src.splitEvidence);
      const participants = asArray(src.participantRefs ?? src.participants)
        .map((p) => toRefOrNull(p))
        .filter((p): p is EntityRef => p !== null);

      // BS-1 backstop: without EXPLICIT split evidence AND ≥1 participant,
      // this is an ordinary expense — never a Bill Split.
      if (splitEvidence.length === 0 || participants.length < 1) {
        issues.push('bill_split downgraded to ordinary expense: no explicit split evidence');
        downgradeToOrdinary(src, 'expense', total, []);
        return;
      }
      specialized.push({
        localId: nextId('bs'),
        kind: 'bill_split',
        operation: 'expense',
        total,
        participants,
        payer: toRefOrNull(src.payerRef ?? src.payer),
        allocationHint: asString(src.allocationHint),
        account: toRefOrNull(src.account),
        category: toRefOrNull(src.category),
        date: toDate(src.dateExpression),
        name: cleanName(src.name, 'Split bill'),
        splitEvidence,
        conflicts: toConflicts(src.conflicts),
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
      specialized.push({
        localId: nextId('rec'),
        kind: 'recurring',
        operation: op,
        base,
        recurrenceExpression: asString(src.recurrenceExpression),
        intervalHint: normInterval(src.intervalHint),
        anchorDate: toDate(src.anchorDateExpression),
        evidenceStrength: strength,
        account: toRefOrNull(src.account),
        toAccount: op === 'transfer' ? toRefOrNull(src.toAccount) : null,
        category: op === 'expense' || op === 'income' ? toRefOrNull(src.category) : null,
        person: op === 'lending' ? toRefOrNull(src.person) : null,
        direction: op === 'lending' ? normDirection(src.direction) : null,
        name: cleanName(src.name, 'Recurring'),
        recurringEvidence: evidence,
        conflicts: toConflicts(src.conflicts),
      });
      return;
    }

    // Unknown specialized kind: fall back to treating it as an ordinary intent.
    processOrdinary({ ...src, operation: src.operation });
  };

  asArray(raw.candidates).forEach(processOrdinary);
  asArray(raw.unqualifiedIntents).forEach(processOrdinary);
  asArray(raw.specializedOperations).forEach(processSpecialized);

  // Injection backstop: flag every qualified operation for mandatory review.
  if (detectInjection(transcript)) {
    const note = 'Instruction-like text detected in the spoken input; verify against the transcript before approving.';
    for (const c of candidates) c.conflicts.push({ kind: 'injection_suspected', note });
    for (const s of specialized) s.conflicts.push({ kind: 'injection_suspected', note });
    issues.push('injection markers detected in transcript');
  }

  const hasQualified = candidates.length > 0 || specialized.length > 0;
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    outcome: hasQualified ? 'CANDIDATES_PRESENT' : 'NO_TRANSACTION_VALUE_DETECTED',
    transcript,
    candidates,
    specializedOperations: specialized,
    unqualifiedIntents: unqualified,
    issues,
  };
}
