/**
 * Transaction AI V1 — machine-readable interpretation contract (types).
 *
 * This is the TypeScript equivalent of the conceptual `InterpretationResult`
 * in Test/TRANSACTION_AI_TECHNICAL_CONTRACT_V1.md. It is deliberately
 * STRUCTURALLY DIFFERENT from the database `Transaction` model: it carries
 * provenance, uncertainty, evidence, conflicts, raw expressions, and TEXTUAL
 * entity references — and it never carries authoritative DB ids, resolved
 * timestamps, balances, approval state, or commit state.
 *
 * Three tiers of types live here:
 *  - `Raw*`        — the untrusted shape accepted from Gemini after JSON parse.
 *  - `Validated*`  — after deterministic validation (grounding recomputed,
 *                    candidate/unqualified split done). Still no DB ids.
 *  - `Resolved*`   — after APPLICATION-owned entity resolution (ids attached),
 *                    ready for the approval gate and commit.
 */

export const CONTRACT_SCHEMA_VERSION = 'v1';

// ── Enums ────────────────────────────────────────────────────────────────
export type Provenance = 'USER_EXPLICIT' | 'AI_INTERPRETED' | 'AI_INFERRED' | 'UNRESOLVED';
export type InfoState = 'KNOWN' | 'INFERRED' | 'AMBIGUOUS' | 'UNKNOWN';

export type OrdinaryKind = 'income' | 'expense' | 'transfer' | 'lending';
export type SpecializedKind = 'bill_split' | 'recurring';

export type LendingDirection =
  | 'lend'
  | 'lend_repayment_received'
  | 'borrow'
  | 'borrow_repayment_made';

export type IntervalHint = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' | 'UNRESOLVED';
export type EvidenceStrength = 'clear' | 'strong' | 'ambiguous' | 'one_time';

export type InterpretationOutcome =
  | 'CANDIDATES_PRESENT'
  | 'NO_TRANSACTION_VALUE_DETECTED'
  | 'STRUCTURALLY_INVALID';

export type RejectionReason =
  | 'NO_TRANSACTION_VALUE_DETECTED'
  | 'UNSUPPORTED_OPERATION';

export type ConflictKind =
  | 'amount_correction'
  | 'action_vs_label'
  | 'entity_conflict'
  | 'recurrence_vs_onetime'
  | 'split_descriptive_vs_instructional'
  | 'injection_suspected';

export type DateKind = 'absolute' | 'relative' | 'named_weekday' | 'none';

// ── Shared value objects (validated tier) ────────────────────────────────
export interface EvidenceSpan {
  sourceText: string;
  supports: string;
}

export interface Conflict {
  kind: ConflictKind;
  note: string;
}

/** Amount after validation. `grounded` is APP-COMPUTED — never trusted from the model. */
export interface Amount {
  expression: string | null;
  /** Integer minor units (cents), positive, or null when unresolved. */
  valueMinor: number | null;
  provenance: Provenance;
  state: InfoState;
  grounded: boolean;
}

/** A textual entity reference. Carries NO database id — resolution is a later app step. */
export interface EntityRef {
  reference: string | null;
  provenance: Provenance;
  /** Certainty of the AI's INTERPRETATION of the reference — NOT DB resolution. */
  state: InfoState;
  /** Populated when AMBIGUOUS: the competing textual readings. */
  candidates: string[];
}

export interface DateExpr {
  expression: string | null;
  kind: DateKind;
}

// ── Validated operations ─────────────────────────────────────────────────
export interface OrdinaryCandidate {
  localId: string;
  operation: OrdinaryKind;
  /** Guaranteed `grounded === true` by validation. */
  amount: Amount;
  account: EntityRef;
  toAccount: EntityRef | null; // transfer only
  category: EntityRef | null; // expense/income only
  person: EntityRef | null; // lending required; optional tag on expense/income
  direction: LendingDirection | null; // lending only
  requestedLabel: string | null; // a label the user asked for, if it differs from the action
  date: DateExpr;
  name: string;
  conflicts: Conflict[];
  evidence: EvidenceSpan[];
}

export interface BillSplitOperation {
  localId: string;
  kind: 'bill_split';
  operation: 'expense';
  total: Amount; // grounded
  participants: EntityRef[];
  payer: EntityRef | null;
  allocationHint: string | null;
  account: EntityRef | null;
  category: EntityRef | null;
  date: DateExpr;
  name: string;
  splitEvidence: EvidenceSpan[]; // guaranteed non-empty
  conflicts: Conflict[];
}

export interface RecurringOperation {
  localId: string;
  kind: 'recurring';
  operation: OrdinaryKind; // the underlying transaction type
  base: Amount; // grounded
  recurrenceExpression: string | null;
  intervalHint: IntervalHint;
  anchorDate: DateExpr;
  /** Raw end-condition wording the user spoke ("for the next 3 months",
   *  "until December", "for 6 payments"). An EXPRESSION only — the app
   *  resolves it to a real end date (TC-025). */
  endExpression: string | null;
  /** A stated number of occurrences, when the user gave a count rather than a
   *  duration. Null when unstated. */
  occurrenceCount: number | null;
  evidenceStrength: EvidenceStrength;
  account: EntityRef | null;
  toAccount: EntityRef | null;
  category: EntityRef | null;
  person: EntityRef | null;
  direction: LendingDirection | null;
  name: string;
  recurringEvidence: EvidenceSpan[]; // guaranteed non-empty
  conflicts: Conflict[];
}

export type SpecializedOperation = BillSplitOperation | RecurringOperation;

export interface UnqualifiedIntent {
  localId: string;
  operation: OrdinaryKind | 'unknown';
  amount: Amount; // guaranteed `grounded === false`
  account: EntityRef | null;
  category: EntityRef | null;
  person: EntityRef | null;
  date: DateExpr;
  evidence: EvidenceSpan[];
  rejectionReason: RejectionReason;
  /** Structural guarantees — an unqualified intent is NEVER a candidate. */
  promoted: false;
  entersQueue: false;
}

export interface ValidatedInterpretation {
  schemaVersion: string;
  outcome: InterpretationOutcome;
  transcript: string;
  candidates: OrdinaryCandidate[];
  specializedOperations: SpecializedOperation[];
  unqualifiedIntents: UnqualifiedIntent[];
  /** Non-fatal validation notes (telemetry/debug). */
  issues: string[];
}

// ── Resolved tier (after application-owned entity resolution) ─────────────
export type ResolutionStatus = 'resolved' | 'unresolved' | 'ambiguous';

export interface ResolvedRef {
  reference: string | null;
  /** Real application entity id, or null when not resolved. */
  id: string | null;
  status: ResolutionStatus;
  /** Candidate matches when ambiguous (id + name pairs). */
  options: { id: string; name: string }[];
}

/** A single application-owned pending operation, ready for review / the gate. */
export interface ResolvedOperation {
  localId: string;
  kind: OrdinaryKind | SpecializedKind;
  operation: OrdinaryKind;
  amountMinor: number; // grounded, positive integer
  amountProvenance: Provenance;
  account: ResolvedRef | null;
  toAccount: ResolvedRef | null;
  category: ResolvedRef | null;
  person: ResolvedRef | null;
  direction: LendingDirection | null;
  requestedLabel: string | null;
  dateExpression: string | null;
  name: string;
  conflicts: Conflict[];
  transcript: string;
  /** Specialized payload preserved verbatim for the dedicated editors. */
  specialized: SpecializedOperation | null;
}
