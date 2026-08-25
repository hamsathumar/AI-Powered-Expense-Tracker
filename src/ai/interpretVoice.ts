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
import { getGeminiApiKey } from '@/ai/secureConfig';
import {
  buildCorrectionNote,
  chooseInterpretation,
  critiqueHasFindings,
  critiqueInterpretation,
  shouldCritique,
} from '@/ai/critic';
import { fileToBase64, interpretAudioWithGemini, interpretTextWithGemini } from '@/ai/geminiInterpret';
import type { InterpretPromptContext } from '@/ai/interpretPrompt';
import { validateInterpretation } from '@/ai/interpretation/validate';
import {
  resolveCandidate,
  resolveSpecialized,
  resolveUnqualified,
  type ResolveContext,
} from '@/ai/interpretation/resolve';
import type {
  ResolvedOperation,
  UnqualifiedIntent,
  ValidatedInterpretation,
} from '@/ai/interpretation/types';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { listPeople } from '@/db/queries/people';
import { insertPendingOperations } from '@/db/queries/pendingOperations';
import { getCurrencyCode, getGeminiModel } from '@/db/queries/settings';

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
}

async function loadContext(): Promise<{ resolve: ResolveContext; prompt: InterpretPromptContext }> {
  const [accounts, expenseCategories, incomeCategories, people, currencyCode] = await Promise.all([
    listAccounts(),
    listCategories('expense'),
    listCategories('income'),
    listPeople(),
    getCurrencyCode(),
  ]);
  const lite = <T extends { id: string; name: string }>(xs: T[]) => xs.map((x) => ({ id: x.id, name: x.name }));
  return {
    resolve: {
      accounts: lite(accounts),
      expenseCategories: lite(expenseCategories),
      incomeCategories: lite(incomeCategories),
      people: lite(people),
    },
    prompt: {
      accounts,
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
async function auditCompoundUtterance(input: AuditInput): Promise<ValidatedInterpretation> {
  const { validated, now } = input;
  const transcript = validated.transcript;
  if (!shouldCritique(transcript, validated)) return validated;

  const critique = await critiqueInterpretation({
    apiKey: input.apiKey,
    model: input.model,
    transcript,
    interpretation: input.raw,
  });
  if (!critiqueHasFindings(critique)) return validated;

  let repaired: ValidatedInterpretation;
  try {
    const rawRepair = await interpretTextWithGemini({
      apiKey: input.apiKey,
      model: input.model,
      transcript,
      context: input.context,
      correctionNote: buildCorrectionNote(critique),
    });
    repaired = validateInterpretation(rawRepair, { now });
  } catch {
    return validated; // a failed repair must never cost the user the original
  }

  if (chooseInterpretation(validated, repaired, critique) === 'original') {
    return {
      ...validated,
      issues: [...validated.issues, 'compound-utterance audit found issues but the re-read did not improve on them'],
    };
  }

  return {
    ...repaired,
    // The transcript is the user's words — keep the one heard from the audio.
    transcript,
    issues: [
      ...repaired.issues,
      `compound-utterance audit applied (missing: ${critique.missing.length}, duplicated: ${critique.duplicated.length})`,
    ],
  };
}

export async function interpretVoice(
  audioUri: string,
  audioMimeType: string = DEFAULT_AUDIO_MIME,
): Promise<InterpretResult> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error('Add your Gemini API key in Settings first.');

  const [model, base64, ctx] = await Promise.all([getGeminiModel(), fileToBase64(audioUri), loadContext()]);

  const raw = await interpretAudioWithGemini({
    apiKey,
    model,
    audioBase64: base64,
    audioMimeType,
    context: ctx.prompt,
  });

  const now = new Date();
  const validated = await auditCompoundUtterance({
    apiKey,
    model,
    context: ctx.prompt,
    raw,
    validated: validateInterpretation(raw, { now }),
    now,
  });

  // Resolve every operation against the CURRENT entities (app-owned).
  // Unqualified intents are queued too (audit F3): they arrive with a null
  // amount and cannot pass the gate, but the user can complete them instead of
  // losing what they said.
  const ops: ResolvedOperation[] = [
    ...validated.candidates.map((c) => ({ ...resolveCandidate(c, ctx.resolve), transcript: validated.transcript })),
    ...validated.specializedOperations.map((s) => ({
      ...resolveSpecialized(s, ctx.resolve),
      transcript: validated.transcript,
    })),
    ...validated.unqualifiedIntents.map((u) => ({
      ...resolveUnqualified(u, ctx.resolve),
      transcript: validated.transcript,
    })),
  ];

  const pendingIds = ops.length > 0 ? await insertPendingOperations(ops) : [];

  return {
    outcome: validated.outcome,
    transcript: validated.transcript,
    pendingIds,
    candidateCount: validated.candidates.length,
    specializedCount: validated.specializedOperations.length,
    unqualifiedIntents: validated.unqualifiedIntents,
  };
}
