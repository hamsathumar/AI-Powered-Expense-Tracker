/**
 * Voice interpretation orchestrator (Transaction AI V1).
 *
 *   audio → Gemini → UNTRUSTED interpretation → deterministic validation →
 *   application-owned entity resolution → pending operations (own store).
 *
 * Nothing here writes to the `transactions` ledger. Grounded candidates become
 * reviewable pending operations; ungrounded intents are preserved as
 * unqualified intents and NEVER queued. Commit happens later, behind the final
 * safety gate (src/ai/commitOperation.ts).
 */
import { buildDiagnostics, type CriticOutcome, type VoiceDiagnostics } from '@/ai/diagnostics';
import { evaluateApproval } from '@/ai/interpretation/gate';
import { getGeminiApiKey } from '@/ai/secureConfig';
import {
  buildCorrectionNote,
  chooseInterpretation,
  critiqueHasFindings,
  countMoneyMentions,
  critiqueInterpretation,
  shouldCritique,
} from '@/ai/critic';
import { fileToBase64, interpretAudioWithGemini, interpretTextWithGemini } from '@/ai/geminiInterpret';
import type { InterpretPromptContext } from '@/ai/interpretPrompt';
import { validateInterpretation } from '@/ai/interpretation/validate';
import { resolveInterpretation, type ResolveContext } from '@/ai/interpretation/resolve';
import type {
  ResolvedOperation,
  UnqualifiedIntent,
  ValidatedInterpretation,
} from '@/ai/interpretation/types';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import {
  countPendingLendingByPerson,
  listPeople,
  listPeopleWithNetBalances,
} from '@/db/queries/people';
import { insertPendingOperations } from '@/db/queries/pendingOperations';
import { getCurrencyCode, getGeminiModel } from '@/db/queries/settings';
import { type AudioFacts, shrinkWavBase64 } from '@/ai/audio';
import { base64Bytes, emptyMeter, type StageTiming, stopwatch, type VoiceTimings } from '@/ai/timing';

/** Default capture format (expo-audio recorder). The speech-recognition
 *  capture (pipeline B) persists WAV, so the screen passes 'audio/wav'. The
 *  interpretation logic below is identical regardless of container. */
const DEFAULT_AUDIO_MIME = 'audio/mp4';

export interface InterpretResult {
  outcome: 'CANDIDATES_PRESENT' | 'NO_TRANSACTION_VALUE_DETECTED' | 'STRUCTURALLY_INVALID';
  transcript: string;
  /** Ids of the pending operations created (grounded candidates + specialized). */
  pendingIds: string[];
  candidateCount: number;
  specializedCount: number;
  unqualifiedIntents: UnqualifiedIntent[];
  /** Queued operations still missing their amount. */
  needsAmountCount: number;
  /** What happened inside this parse (Phase C). */
  diagnostics: VoiceDiagnostics;
}

async function loadContext(): Promise<{ resolve: ResolveContext; prompt: InterpretPromptContext }> {
  const [accounts, expenseCategories, incomeCategories, people, currencyCode, balances, pendingByPerson] =
    await Promise.all([
      listAccounts(),
      listCategories('expense'),
      listCategories('income'),
      listPeople('name'),
      getCurrencyCode(),
      listPeopleWithNetBalances(),
      countPendingLendingByPerson(),
    ]);
  const personBalances = new Map(
    balances.map(({ person, netMinor }) => [
      person.id,
      { netMinor, pendingCount: pendingByPerson.get(person.id) ?? 0 },
    ]),
  );
  const lite = <T extends { id: string; name: string }>(xs: T[]) => xs.map((x) => ({ id: x.id, name: x.name }));
  return {
    resolve: {
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, kind: a.type, isPrivate: a.isPrivate })),
      expenseCategories: lite(expenseCategories),
      incomeCategories: lite(incomeCategories),
      people: lite(people),
      // TC-031: lets "all the money he owed me" be filled from the ledger.
      personBalances,
    },
    prompt: {
      // Names + type only (V1.3: lets the model tell where withdrawn cash goes).
      accounts: accounts.map((a) => ({ name: a.name, kind: a.type })),
      expenseCategories,
      incomeCategories,
      people,
      currencyCode,
      referenceDateISO: new Date().toISOString(),
    },
  };
}

interface AuditInput {
  apiKey: string;
  model: string;
  context: InterpretPromptContext;
  raw: unknown;
  validated: ValidatedInterpretation;
  now: Date;
  /** Critic / repair timings are appended here (Phase 0). */
  stages: StageTiming[];
}

interface AuditResult {
  validated: ValidatedInterpretation;
  /** What happened, for the diagnostics record (Phase C). */
  critic: CriticOutcome;
  missing: string[];
  duplicated: string[];
  /** The re-read the critic asked for, when one was made. */
  repairRaw?: unknown;
}

/**
 * Audit a compound utterance for money the first reading dropped or
 * double-counted (audit F8d), and re-interpret if the auditor found something.
 *
 * Short, ordinary notes never reach the network here — `shouldCritique` filters
 * them out, so the common case still costs exactly one call. Every failure
 * path returns the ORIGINAL reading: an audit that errors, finds nothing, or
 * produces a repair that drifts the wrong way changes nothing at all.
 */
async function auditCompoundUtterance(input: AuditInput): Promise<AuditResult> {
  const { validated, now } = input;
  const transcript = validated.transcript;
  if (!shouldCritique(transcript, validated)) {
    const critic: CriticOutcome = countMoneyMentions(transcript) === 0 ? 'no_figures' : 'not_needed';
    return { validated, critic, missing: [], duplicated: [] };
  }

  const criticMeter = emptyMeter();
  const critique = await critiqueInterpretation({
    apiKey: input.apiKey,
    model: input.model,
    transcript,
    interpretation: input.raw,
    meter: criticMeter,
  });
  input.stages.push({ stage: 'critic', ms: criticMeter.ms, call: criticMeter });
  const missing = critique.missing.map((c) => `${c.amountExpression} — “${c.sourceText}”`);
  const duplicated = critique.duplicated.map((c) => `${c.amountExpression} — “${c.sourceText}”`);
  if (!critiqueHasFindings(critique)) return { validated, critic: 'no_findings', missing, duplicated };

  let repairRaw: unknown;
  let repaired: ValidatedInterpretation;
  const repairMeter = emptyMeter();
  try {
    repairRaw = await interpretTextWithGemini({
      apiKey: input.apiKey,
      model: input.model,
      transcript,
      context: input.context,
      correctionNote: buildCorrectionNote(critique),
      meter: repairMeter,
    });
    repaired = validateInterpretation(repairRaw, { now });
  } catch {
    // a failed repair must never cost the user the original
    input.stages.push({ stage: 'repair', ms: repairMeter.ms, call: repairMeter });
    return { validated, critic: 'repair_failed', missing, duplicated };
  }
  input.stages.push({ stage: 'repair', ms: repairMeter.ms, call: repairMeter });

  if (chooseInterpretation(validated, repaired, critique) === 'original') {
    return {
      validated: {
        ...validated,
        issues: [...validated.issues, 'compound-utterance audit found issues but the re-read did not improve on them'],
      },
      critic: 'kept_original',
      missing,
      duplicated,
      repairRaw,
    };
  }

  return {
    validated: {
      ...repaired,
      // The transcript is the user's words — keep the one heard from the audio.
      transcript,
      issues: [
        ...repaired.issues,
        `compound-utterance audit applied (missing: ${critique.missing.length}, duplicated: ${critique.duplicated.length})`,
      ],
    },
    critic: 'applied',
    missing,
    duplicated,
    repairRaw,
  };
}

export async function interpretVoice(
  audioUri: string,
  audioMimeType: string = DEFAULT_AUDIO_MIME,
  /** The durable job this parse belongs to (Phase C diagnostics link). */
  voiceJobId?: string,
  /** When the recording was queued and which attempt this is (Phase 0 timing). */
  job?: { queuedAt?: string; attempt?: number; previousError?: string | null },
): Promise<InterpretResult> {
  // Phase 0: every stage is timed; nothing about the work changes.
  const startedAt = Date.now();
  const total = stopwatch();
  const stages: StageTiming[] = [];
  const queuedAtMs = job?.queuedAt ? Date.parse(job.queuedAt) : NaN;

  let lap = stopwatch();
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error('Add your Gemini API key in Settings first.');

  const [model, recorded, ctx] = await Promise.all([getGeminiModel(), fileToBase64(audioUri), loadContext()]);
  stages.push({ stage: 'prepare', ms: lap() });

  // Phase 1a: send 16 kHz mono — what Gemini uses anyway — instead of the
  // ~44.1 kHz WAV iOS records. Anything not understood is sent as recorded.
  let base64 = recorded;
  let audio: AudioFacts | null = null;
  if (/wav/i.test(audioMimeType)) {
    lap = stopwatch();
    const shrunk = shrinkWavBase64(recorded);
    base64 = shrunk.base64;
    audio = shrunk.facts;
    stages.push({ stage: 'shrink', ms: lap() });
  }

  const interpretMeter = emptyMeter();
  const raw = await interpretAudioWithGemini({
    apiKey,
    model,
    audioBase64: base64,
    audioMimeType,
    context: ctx.prompt,
    meter: interpretMeter,
  });
  stages.push({ stage: 'interpret', ms: interpretMeter.ms, call: interpretMeter });

  const now = new Date();
  lap = stopwatch();
  const firstReading = validateInterpretation(raw, { now });
  let resolveMs = lap();
  const audit = await auditCompoundUtterance({
    apiKey,
    model,
    context: ctx.prompt,
    raw,
    validated: firstReading,
    now,
    stages,
  });
  const { validated } = audit;
  lap = stopwatch();

  // Resolve every operation against the CURRENT entities (app-owned).
  // Unqualified intents are queued too (audit F3): they arrive with a null
  // amount and cannot pass the gate, but the user can complete them instead of
  // losing what they said. One shared path with the eval harness (V1.4).
  const resolved = resolveInterpretation(validated, ctx.resolve);
  const finalOps: ResolvedOperation[] = resolved.operations;
  // Phase C: tag each operation with the capture that produced it, so the
  // review screen can open this capture's diagnostics.
  const tagged = voiceJobId ? finalOps.map((o) => ({ ...o, voiceJobId })) : finalOps;
  const blockers = tagged.map((op) => ({ op, blockers: evaluateApproval(op).blockers }));
  resolveMs += lap();
  stages.push({ stage: 'resolve', ms: resolveMs });

  lap = stopwatch();
  const pendingIds = tagged.length > 0 ? await insertPendingOperations(tagged) : [];
  stages.push({ stage: 'save', ms: lap() });

  const timings: VoiceTimings = {
    totalMs: total(),
    queuedMs: Number.isNaN(queuedAtMs) ? null : Math.max(0, startedAt - queuedAtMs),
    attempt: job?.attempt ?? 1,
    audioBytes: base64Bytes(base64),
    audio,
    previousError: job?.previousError ?? null,
    stages,
  };

  const diagnostics = buildDiagnostics({
    model,
    transcript: validated.transcript,
    critic: audit.critic,
    criticMissing: audit.missing,
    criticDuplicated: audit.duplicated,
    validationIssues: [...validated.issues, ...resolved.issues],
    rawResponse: raw,
    repairedResponse: audit.repairRaw,
    operations: blockers,
    timings,
    now,
  });

  return {
    outcome: validated.outcome,
    transcript: validated.transcript,
    pendingIds,
    candidateCount: validated.candidates.length,
    specializedCount: validated.specializedOperations.length,
    unqualifiedIntents: validated.unqualifiedIntents,
    // After resolution — a whole-balance repayment is filled from the ledger,
    // so it no longer "needs an amount" even though it was amountless when
    // heard (the Faraj case, V1.3).
    needsAmountCount: finalOps.filter((o) => o.amountMinor === null).length,
    diagnostics,
  };
}
