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
  critiqueInterpretation,
  shouldCritique,
} from '@/ai/critic';
import { fileToBase64, interpretAudioWithGemini, interpretTextWithGemini } from '@/ai/geminiInterpret';
import type { InterpretPromptContext } from '@/ai/interpretPrompt';
import { validateInterpretation } from '@/ai/interpretation/validate';
import {
  inheritFundingAccount,
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
import {
  countPendingLendingByPerson,
  listPeople,
  listPeopleWithNetBalances,
} from '@/db/queries/people';
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
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, kind: a.type })),
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
    return { validated, critic: 'not_needed', missing: [], duplicated: [] };
  }

  const critique = await critiqueInterpretation({
    apiKey: input.apiKey,
    model: input.model,
    transcript,
    interpretation: input.raw,
  });
  const missing = critique.missing.map((c) => `${c.amountExpression} — “${c.sourceText}”`);
  const duplicated = critique.duplicated.map((c) => `${c.amountExpression} — “${c.sourceText}”`);
  if (!critiqueHasFindings(critique)) return { validated, critic: 'no_findings', missing, duplicated };

  let repairRaw: unknown;
  let repaired: ValidatedInterpretation;
  try {
    repairRaw = await interpretTextWithGemini({
      apiKey: input.apiKey,
      model: input.model,
      transcript,
      context: input.context,
      correctionNote: buildCorrectionNote(critique),
    });
    repaired = validateInterpretation(repairRaw, { now });
  } catch {
    // a failed repair must never cost the user the original
    return { validated, critic: 'repair_failed', missing, duplicated };
  }

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
  const audit = await auditCompoundUtterance({
    apiKey,
    model,
    context: ctx.prompt,
    raw,
    validated: validateInterpretation(raw, { now }),
    now,
  });
  const { validated } = audit;

  // Resolve every operation against the CURRENT entities (app-owned).
  // Unqualified intents are queued too (audit F3): they arrive with a null
  // amount and cannot pass the gate, but the user can complete them instead of
  // losing what they said.
  // What the user said, so the resolver can recover an account the model left
  // out — scoped to each operation's own clause (V1.3, TC-035).
  const opCount =
    validated.candidates.length + validated.specializedOperations.length + validated.unqualifiedIntents.length;
  const scope = { transcript: validated.transcript, soleOperation: opCount === 1 };
  const ops: ResolvedOperation[] = [
    ...validated.candidates.map((c) => ({
      ...resolveCandidate(c, ctx.resolve, scope),
      transcript: validated.transcript,
    })),
    ...validated.specializedOperations.map((s) => ({
      ...resolveSpecialized(s, ctx.resolve),
      transcript: validated.transcript,
    })),
    ...validated.unqualifiedIntents.map((u) => ({
      ...resolveUnqualified(u, ctx.resolve, scope),
      transcript: validated.transcript,
    })),
  ];

  // "…and spent 70 on lunch from it" — the spend takes the account of the
  // money that came in earlier in the same sentence (V1.3, device round).
  const finalOps = inheritFundingAccount(ops, validated.transcript);
  // Phase C: tag each operation with the capture that produced it, so the
  // review screen can open this capture's diagnostics.
  const tagged = voiceJobId ? finalOps.map((o) => ({ ...o, voiceJobId })) : finalOps;
  const pendingIds = tagged.length > 0 ? await insertPendingOperations(tagged) : [];

  const diagnostics = buildDiagnostics({
    model,
    transcript: validated.transcript,
    critic: audit.critic,
    criticMissing: audit.missing,
    criticDuplicated: audit.duplicated,
    validationIssues: validated.issues,
    rawResponse: raw,
    repairedResponse: audit.repairRaw,
    operations: tagged.map((op) => ({ op, blockers: evaluateApproval(op).blockers })),
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
