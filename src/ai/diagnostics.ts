/**
 * Voice-capture diagnostics (Transaction AI V1.3, Phase C).
 *
 * Three of the third round's root causes could only be INFERRED, because the
 * evidence was thrown away: what Gemini actually returned, what the app's
 * deterministic checks changed, and whether the critic re-read the sentence.
 * This keeps that record for each capture so the next "why did it read it like
 * that?" is answered by looking, not guessing.
 *
 * Privacy: the record never leaves the phone unless the user taps Share. It
 * holds what the user said and entity NAMES (already in the app) — never the
 * API key, never balances. Only the latest captures keep one (see voiceJobs).
 *
 * Pure: building, parsing and wording live here so they are unit-tested; the
 * runner stores the JSON and the sheet renders it.
 */
import type { Blocker } from '@/ai/interpretation/gate';
import type { ResolvedOperation } from '@/ai/interpretation/types';

export const DIAGNOSTICS_VERSION = 1;

/** Cap on each stored model response, so one rambling capture cannot bloat the DB. */
export const MAX_RESPONSE_CHARS = 30_000;

export type CriticOutcome =
  /** Short single-sum note — the critic was not consulted (the common case). */
  | 'not_needed'
  /** Consulted; it found every sum accounted for. */
  | 'no_findings'
  /** It found a problem and the re-read was used. */
  | 'applied'
  /** It found a problem but the re-read was no better, so the first reading stood. */
  | 'kept_original'
  /** The re-read call failed; the first reading stood. */
  | 'repair_failed';

export interface DiagnosticOperation {
  name: string;
  kind: string;
  amountMinor: number | null;
  /** What still blocks approval, in the gate's own words (empty = approvable). */
  blockers: string[];
}

export interface VoiceDiagnostics {
  version: number;
  model: string;
  /** When the parse finished (ISO). */
  at: string;
  /** What Gemini heard (its own transcript). */
  transcript: string;
  critic: CriticOutcome;
  /** The critic's verified findings, when it was consulted. */
  criticMissing: string[];
  criticDuplicated: string[];
  /** Every adjustment the app's deterministic checks recorded. */
  validationIssues: string[];
  /** Gemini's first reading, verbatim JSON (truncated). */
  rawResponse: string;
  /** The critic-requested re-read, when one was made (truncated). */
  repairedResponse: string | null;
  operations: DiagnosticOperation[];
}

function truncate(json: string): string {
  return json.length > MAX_RESPONSE_CHARS
    ? `${json.slice(0, MAX_RESPONSE_CHARS)}\n… (truncated, ${json.length - MAX_RESPONSE_CHARS} more characters)`
    : json;
}

function stringify(value: unknown): string {
  try {
    return truncate(JSON.stringify(value, null, 2) ?? 'null');
  } catch {
    return '(could not be serialised)';
  }
}

export interface DiagnosticsInput {
  model: string;
  transcript: string;
  critic: CriticOutcome;
  criticMissing?: string[];
  criticDuplicated?: string[];
  validationIssues: string[];
  rawResponse: unknown;
  repairedResponse?: unknown;
  operations: { op: ResolvedOperation; blockers: Blocker[] }[];
  now?: Date;
}

export function buildDiagnostics(input: DiagnosticsInput): VoiceDiagnostics {
  return {
    version: DIAGNOSTICS_VERSION,
    model: input.model,
    at: (input.now ?? new Date()).toISOString(),
    transcript: input.transcript,
    critic: input.critic,
    criticMissing: input.criticMissing ?? [],
    criticDuplicated: input.criticDuplicated ?? [],
    validationIssues: [...new Set(input.validationIssues)],
    rawResponse: stringify(input.rawResponse),
    repairedResponse: input.repairedResponse === undefined ? null : stringify(input.repairedResponse),
    operations: input.operations.map(({ op, blockers }) => ({
      name: op.name,
      kind: op.kind,
      amountMinor: op.amountMinor,
      blockers: blockers.map((b) => b.message),
    })),
  };
}

/** Read a stored record back. Anything malformed or from a future version → null. */
export function parseDiagnostics(raw: string | null): VoiceDiagnostics | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<VoiceDiagnostics>;
    if (!d || typeof d !== 'object' || d.version !== DIAGNOSTICS_VERSION) return null;
    if (typeof d.model !== 'string' || typeof d.rawResponse !== 'string') return null;
    return {
      version: DIAGNOSTICS_VERSION,
      model: d.model,
      at: typeof d.at === 'string' ? d.at : '',
      transcript: typeof d.transcript === 'string' ? d.transcript : '',
      critic: d.critic ?? 'not_needed',
      criticMissing: Array.isArray(d.criticMissing) ? d.criticMissing.filter((x) => typeof x === 'string') : [],
      criticDuplicated: Array.isArray(d.criticDuplicated) ? d.criticDuplicated.filter((x) => typeof x === 'string') : [],
      validationIssues: Array.isArray(d.validationIssues) ? d.validationIssues.filter((x) => typeof x === 'string') : [],
      rawResponse: d.rawResponse,
      repairedResponse: typeof d.repairedResponse === 'string' ? d.repairedResponse : null,
      operations: Array.isArray(d.operations) ? d.operations : [],
    };
  } catch {
    return null;
  }
}

const CRITIC_WORDS: Record<CriticOutcome, string> = {
  not_needed: 'Not needed — a short note with one sum of money.',
  no_findings: 'Checked the reading; every sum of money was accounted for.',
  applied: 'Found money missing or counted twice, and the sentence was re-read. The re-read is what you see.',
  kept_original: 'Found a possible problem, but the re-read was no better, so the first reading was kept.',
  repair_failed: 'Found a possible problem, but the re-read failed, so the first reading was kept.',
};

export function describeCritic(outcome: CriticOutcome): string {
  return CRITIC_WORDS[outcome];
}

/**
 * The whole record as plain text — what the Share button sends, and what to
 * paste into a bug report. The model's JSON goes last so the summary reads
 * first.
 */
export function diagnosticsReport(d: VoiceDiagnostics): string {
  const money = (minor: number | null) => (minor === null ? 'no amount' : (minor / 100).toFixed(2));
  const lines = [
    'Kaasu voice diagnostics',
    `Model: ${d.model}`,
    `When: ${d.at}`,
    `Heard: “${d.transcript}”`,
    '',
    'Result:',
    ...d.operations.map(
      (o) =>
        `- ${o.name} (${o.kind}, ${money(o.amountMinor)})${
          o.blockers.length ? ` — blocked: ${o.blockers.join('; ')}` : ' — ready to approve'
        }`,
    ),
    '',
    `Critic: ${describeCritic(d.critic)}`,
    ...d.criticMissing.map((m) => `  missing: ${m}`),
    ...d.criticDuplicated.map((m) => `  counted twice: ${m}`),
    '',
    'What the app adjusted:',
    ...(d.validationIssues.length ? d.validationIssues.map((i) => `- ${i}`) : ['- nothing']),
    '',
    'Gemini returned:',
    d.rawResponse,
  ];
  if (d.repairedResponse) {
    lines.push('', `Re-read (${d.critic === 'applied' ? 'used' : 'not used'}):`, d.repairedResponse);
  }
  return lines.join('\n');
}
