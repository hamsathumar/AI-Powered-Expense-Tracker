/**
 * Voice pipeline orchestrator (technical-plan §5.1):
 *   audio file -> base64 -> Gemini -> validate -> (create person) -> insert pending.
 *
 * Every path ends as a status='pending', source='voice' transaction in the
 * queue — never auto-posted. Failures throw with a user-facing message; the
 * caller keeps the recording for retry so nothing spoken is lost (§5.7).
 */
import { fileToBase64, parseAudioWithGemini } from '@/ai/gemini';
import type { PromptContext } from '@/ai/prompt';
import { getGeminiApiKey } from '@/ai/secureConfig';
import { buildVoiceDraft, type VoiceContext, type VoiceDraft } from '@/ai/validate';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { createPerson, listPeople } from '@/db/queries/people';
import { getGeminiModel } from '@/db/queries/settings';
import { insertTransaction, type NewTransaction } from '@/db/queries/transactions';
import type { ConfidenceFlag } from '@/domain/types';

/** m4a from expo-audio's HIGH_QUALITY preset is an MP4 audio container. */
const AUDIO_MIME = 'audio/mp4';

export interface VoiceResult {
  name: string;
  flags: ConfidenceFlag[];
}

async function loadContext(): Promise<{ voice: VoiceContext; prompt: PromptContext }> {
  const [accounts, expenseCategories, incomeCategories, people] = await Promise.all([
    listAccounts(),
    listCategories('expense'),
    listCategories('income'),
    listPeople(),
  ]);
  const voice: VoiceContext = { accounts, expenseCategories, incomeCategories, people };
  return { voice, prompt: { ...voice, currencyCode: 'LKR' } };
}

function assemble(draft: VoiceDraft, personId: string | undefined): NewTransaction {
  const base = {
    status: 'pending' as const,
    source: 'voice' as const,
    name: draft.name,
    amountMinor: draft.amountMinor,
    occurredAt: new Date().toISOString(),
    transcript: draft.transcript,
    confidenceFlags: draft.confidenceFlags,
  };
  switch (draft.type) {
    case 'expense':
    case 'income':
      return { ...base, type: draft.type, accountId: draft.accountId, categoryId: draft.categoryId!, personId };
    case 'transfer':
      return { ...base, type: 'transfer', accountId: draft.accountId, toAccountId: draft.toAccountId! };
    case 'lending':
      return { ...base, type: 'lending', accountId: draft.accountId, personId: personId!, direction: draft.direction! };
  }
}

export async function logVoiceTransaction(audioUri: string): Promise<VoiceResult> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error('Add your Gemini API key in Settings first.');

  const [model, base64, ctx] = await Promise.all([
    getGeminiModel(),
    fileToBase64(audioUri),
    loadContext(),
  ]);

  const raw = await parseAudioWithGemini({
    apiKey,
    model,
    audioBase64: base64,
    audioMimeType: AUDIO_MIME,
    context: ctx.prompt,
  });

  const result = buildVoiceDraft(raw, ctx.voice);
  if (!result.ok) throw new Error(result.reason);

  const { draft } = result;
  let personId = draft.personId;
  if (draft.unresolvedPersonName) {
    const person = await createPerson(draft.unresolvedPersonName, true);
    personId = person.id;
  }

  await insertTransaction(assemble(draft, personId));
  return { name: draft.name, flags: draft.confidenceFlags };
}
