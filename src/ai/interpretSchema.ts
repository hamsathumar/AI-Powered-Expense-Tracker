/**
 * Gemini structured-output schema for the interpretation contract (audit F8b).
 *
 * Until now the request asked only for `responseMimeType: application/json` and
 * trusted prose rules to produce the right SHAPE. That left two avoidable
 * failure modes: a response that will not `JSON.parse` at all (the recording is
 * kept, but the user has to retry), and — worse because it is silent — plausible
 * JSON with the wrong field names, which validation reads as "the model said
 * nothing here" and quietly drops.
 *
 * Declaring the schema removes both. It does NOT make the output trustworthy:
 * `validate.ts` remains the authority on every value, and a schema-shaped
 * response still passes through grounding, injection, dedup and the gate
 * exactly as before. This constrains the container, never the contents.
 *
 * Types are UPPERCASE because the REST API deserialises them as proto enum
 * names (`STRING`, `OBJECT`, …), not as OpenAPI lowercase.
 *
 * `required` is kept deliberately small. Forcing a field the utterance does not
 * support is how models start inventing: an optional entity reference that is
 * simply absent is the correct answer far more often than a guessed one.
 */

const PROVENANCE = ['USER_EXPLICIT', 'AI_INTERPRETED', 'AI_INFERRED', 'UNRESOLVED'];
const INFO_STATE = ['KNOWN', 'INFERRED', 'AMBIGUOUS', 'UNKNOWN'];
const ORDINARY = ['income', 'expense', 'transfer', 'lending'];
const DIRECTIONS = ['lend', 'lend_repayment_received', 'borrow', 'borrow_repayment_made'];
const DATE_KINDS = ['absolute', 'relative', 'named_weekday'];
const CONFLICT_KINDS = [
  'amount_correction',
  'action_vs_label',
  'entity_conflict',
  'recurrence_vs_onetime',
  'split_descriptive_vs_instructional',
];

const amount = {
  type: 'OBJECT',
  description:
    'A sum of money the user actually stated. Never invent one: if no amount was said, value is null and provenance is UNRESOLVED.',
  properties: {
    expression: {
      type: 'STRING',
      nullable: true,
      description:
        "The user's exact words for the amount. If they were not digits (spoken words, Tamil, mixed), append the numeric form in parentheses, e.g. 'rendayiram (2000)'.",
    },
    value: { type: 'NUMBER', nullable: true, description: 'Amount in whole currency units.' },
    provenance: { type: 'STRING', enum: PROVENANCE },
    state: { type: 'STRING', enum: INFO_STATE },
  },
  required: ['expression', 'value', 'provenance', 'state'],
  propertyOrdering: ['expression', 'value', 'provenance', 'state'],
};

const entityRef = {
  type: 'OBJECT',
  description:
    'A reference to an entity BY NAME as the user said it. Never a database id. A person reference must be a plausible human name.',
  properties: {
    reference: { type: 'STRING', nullable: true },
    provenance: { type: 'STRING', enum: PROVENANCE },
    state: { type: 'STRING', enum: INFO_STATE },
    candidates: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['reference', 'provenance', 'state'],
  propertyOrdering: ['reference', 'provenance', 'state', 'candidates'],
};

const dateExpression = {
  type: 'OBJECT',
  description: 'The date AS SPOKEN. Never resolve it to a calendar date — the application does that.',
  properties: {
    expression: { type: 'STRING', nullable: true },
    kind: { type: 'STRING', enum: DATE_KINDS },
  },
  required: ['expression', 'kind'],
  propertyOrdering: ['expression', 'kind'],
};

const evidence = {
  type: 'ARRAY',
  description: 'Snippets of the transcript supporting the values above.',
  items: {
    type: 'OBJECT',
    properties: {
      sourceText: { type: 'STRING' },
      supports: { type: 'STRING' },
    },
    required: ['sourceText', 'supports'],
    propertyOrdering: ['sourceText', 'supports'],
  },
};

const conflicts = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      kind: { type: 'STRING', enum: CONFLICT_KINDS },
      note: { type: 'STRING' },
    },
    required: ['kind', 'note'],
    propertyOrdering: ['kind', 'note'],
  },
};

const candidate = {
  type: 'OBJECT',
  properties: {
    operation: { type: 'STRING', enum: ORDINARY, description: 'The action the user DESCRIBED.' },
    requestedLabel: {
      type: 'STRING',
      nullable: true,
      description: 'A type the user asked for, when it contradicts the described action.',
    },
    amount,
    account: entityRef,
    toAccount: entityRef,
    category: entityRef,
    person: entityRef,
    direction: { type: 'STRING', enum: DIRECTIONS },
    dateExpression,
    name: { type: 'STRING', description: 'Short Title Case name for what the money was for.' },
    evidence,
    conflicts,
  },
  required: ['operation', 'amount', 'name'],
  propertyOrdering: [
    'operation',
    'requestedLabel',
    'amount',
    'account',
    'toAccount',
    'category',
    'person',
    'direction',
    'dateExpression',
    'name',
    'evidence',
    'conflicts',
  ],
};

/**
 * Bill Split and Recurring share one object because the schema language has no
 * discriminated unions: `operationKind` selects which fields apply, and the
 * rest are optional. Validation enforces the real per-kind requirements
 * (explicit split evidence, recurrence evidence strength).
 */
const specialized = {
  type: 'OBJECT',
  properties: {
    operationKind: { type: 'STRING', enum: ['bill_split', 'recurring'] },
    operation: { type: 'STRING', enum: ORDINARY, description: 'Recurring only: the underlying type.' },
    total: { ...amount, description: 'Bill split only: the full bill.' },
    baseAmount: { ...amount, description: 'Recurring only: the amount of one occurrence.' },
    participants: {
      type: 'ARRAY',
      description: 'Bill split only: everyone sharing the bill, including the user.',
      items: entityRef,
    },
    payer: entityRef,
    allocationHint: { type: 'STRING', nullable: true },
    recurrenceExpression: { type: 'STRING', nullable: true },
    intervalHint: { type: 'STRING', enum: ['daily', 'weekly', 'monthly', 'yearly', 'custom'] },
    anchorDateExpression: dateExpression,
    endExpression: {
      type: 'STRING',
      nullable: true,
      description: "The user's exact wording for when the schedule ends. Never a computed date.",
    },
    occurrenceCount: { type: 'INTEGER', nullable: true },
    evidenceStrength: { type: 'STRING', enum: ['clear', 'strong', 'ambiguous', 'one_time'] },
    account: entityRef,
    toAccount: entityRef,
    category: entityRef,
    person: entityRef,
    direction: { type: 'STRING', enum: DIRECTIONS },
    dateExpression,
    name: { type: 'STRING' },
    splitEvidence: { ...evidence, description: 'Bill split only: proof the user said it was split.' },
    recurringEvidence: { ...evidence, description: 'Recurring only: proof the user described a schedule.' },
    conflicts,
  },
  required: ['operationKind', 'name'],
  propertyOrdering: [
    'operationKind',
    'operation',
    'total',
    'baseAmount',
    'participants',
    'payer',
    'allocationHint',
    'recurrenceExpression',
    'intervalHint',
    'anchorDateExpression',
    'endExpression',
    'occurrenceCount',
    'evidenceStrength',
    'account',
    'toAccount',
    'category',
    'person',
    'direction',
    'dateExpression',
    'name',
    'splitEvidence',
    'recurringEvidence',
    'conflicts',
  ],
};

const unqualified = {
  type: 'OBJECT',
  description: 'A financial intent the user voiced with NO resolvable amount. Preserved, not turned into a transaction.',
  properties: {
    operation: { type: 'STRING', enum: ORDINARY },
    amount,
    account: entityRef,
    category: entityRef,
    person: entityRef,
    dateExpression,
    name: { type: 'STRING' },
    evidence,
    rejectionReason: { type: 'STRING', enum: ['NO_TRANSACTION_VALUE_DETECTED'] },
  },
  required: ['amount', 'rejectionReason'],
  propertyOrdering: [
    'operation',
    'amount',
    'account',
    'category',
    'person',
    'dateExpression',
    'name',
    'evidence',
    'rejectionReason',
  ],
};

export const INTERPRETATION_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING', description: 'Everything the user said, verbatim.' },
    candidates: { type: 'ARRAY', items: candidate },
    specializedOperations: { type: 'ARRAY', items: specialized },
    unqualifiedIntents: { type: 'ARRAY', items: unqualified },
  },
  required: ['transcript', 'candidates', 'specializedOperations', 'unqualifiedIntents'],
  propertyOrdering: ['transcript', 'candidates', 'specializedOperations', 'unqualifiedIntents'],
};

/** Structured-output schema for the compound-utterance auditor (audit F8d). */
export const CRITIQUE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    missing: {
      type: 'ARRAY',
      description: 'Sums of money mentioned in the transcript that the interpretation does not account for.',
      items: {
        type: 'OBJECT',
        properties: {
          amountExpression: { type: 'STRING', description: "The amount exactly as it appears in the transcript." },
          whatFor: { type: 'STRING' },
          sourceText: { type: 'STRING', description: 'The phrase in the transcript that mentions it.' },
        },
        required: ['amountExpression', 'sourceText'],
        propertyOrdering: ['amountExpression', 'whatFor', 'sourceText'],
      },
    },
    duplicated: {
      type: 'ARRAY',
      description: 'Sums of money the interpretation records more than once, though said once.',
      items: {
        type: 'OBJECT',
        properties: {
          amountExpression: { type: 'STRING' },
          sourceText: { type: 'STRING' },
        },
        required: ['amountExpression', 'sourceText'],
        propertyOrdering: ['amountExpression', 'sourceText'],
      },
    },
  },
  required: ['missing', 'duplicated'],
  propertyOrdering: ['missing', 'duplicated'],
};
