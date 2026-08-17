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
import { fileToBase64, interpretAudioWithGemini } from '@/ai/geminiInterpret';
import type { InterpretPromptContext } from '@/ai/interpretPrompt';
import { validateInterpretation } from '@/ai/interpretation/validate';
import { resolveCandidate, resolveSpecialized, type ResolveContext } from '@/ai/interpretation/resolve';
import type { ResolvedOperation, UnqualifiedIntent } from '@/ai/interpretation/types';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { listPeople } from '@/db/queries/people';
import { insertPendingOperations } from '@/db/queries/pendingOperations';
import { getCurrencyCode, getGeminiModel } from '@/db/queries/settings';

const AUDIO_MIME = 'audio/mp4';

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

export async function interpretVoice(audioUri: string): Promise<InterpretResult> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error('Add your Gemini API key in Settings first.');

  const [model, base64, ctx] = await Promise.all([getGeminiModel(), fileToBase64(audioUri), loadContext()]);

  const raw = await interpretAudioWithGemini({
    apiKey,
    model,
    audioBase64: base64,
    audioMimeType: AUDIO_MIME,
    context: ctx.prompt,
  });

  const validated = validateInterpretation(raw, { now: new Date() });

  // Resolve every qualified operation against the CURRENT entities (app-owned).
  const ops: ResolvedOperation[] = [
    ...validated.candidates.map((c) => ({ ...resolveCandidate(c, ctx.resolve), transcript: validated.transcript })),
    ...validated.specializedOperations.map((s) => ({
      ...resolveSpecialized(s, ctx.resolve),
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
