/**
 * Live eval against Gemini (audit F8c) — measures the MODEL, not the pipeline.
 *
 * `eval.test.ts` replays recorded responses and answers "does the app still
 * handle this reading correctly?". This answers the other question: "does the
 * model still produce a workable reading for these utterances?" — the one that
 * matters when the prompt, the model, or the response schema changes.
 *
 * It is SKIPPED unless a key is supplied, because it costs money, needs the
 * network, and a model is never bit-for-bit reproducible. `npm test` stays
 * hermetic. To run it:
 *
 *   GEMINI_API_KEY=... npx jest liveEval
 *   GEMINI_API_KEY=... GEMINI_MODEL=gemini-2.5-pro npx jest liveEval
 *   GEMINI_API_KEY=... EVAL_ONLY=EV-02,EV-11b npx jest liveEval
 *
 * It runs inside jest rather than as a standalone script on purpose: ts-jest
 * already resolves the `@/` aliases and TypeScript, so this needs no extra
 * tooling in an Expo project.
 *
 * Each utterance is sent as TEXT, which isolates interpretation from speech
 * recognition — a failure here belongs to the prompt, not the microphone.
 * Whether the same sentence survives being spoken aloud is what on-device
 * testing is for.
 */
import { describe, expect, it } from '@jest/globals';

import { interpretTextWithGemini } from '@/ai/geminiInterpret';
import type { InterpretPromptContext } from '@/ai/interpretPrompt';

import { EVAL_CONTEXT, EVAL_CORPUS, EVAL_NOW } from './corpus';
import { scoreCase } from './score';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const ONLY = (process.env.EVAL_ONLY ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const CASES = ONLY.length > 0 ? EVAL_CORPUS.filter((c) => ONLY.includes(c.id)) : EVAL_CORPUS;

const PROMPT_CONTEXT: InterpretPromptContext = {
  accounts: EVAL_CONTEXT.accounts,
  expenseCategories: EVAL_CONTEXT.expenseCategories,
  incomeCategories: EVAL_CONTEXT.incomeCategories,
  people: EVAL_CONTEXT.people,
  currencyCode: 'LKR',
  referenceDateISO: EVAL_NOW.toISOString(),
};

const live = API_KEY ? describe : describe.skip;

live(`live eval against ${MODEL}`, () => {
  for (const testCase of CASES) {
    const label = testCase.origin ? `${testCase.id} [${testCase.origin}] — ${testCase.what}` : `${testCase.id} — ${testCase.what}`;
    it(
      label,
      async () => {
        const output = await interpretTextWithGemini({
          apiKey: API_KEY!,
          model: MODEL,
          transcript: testCase.utterance,
          context: PROMPT_CONTEXT,
        });
        const result = scoreCase(testCase, output, EVAL_CONTEXT, EVAL_NOW);
        if (!result.passed) {
          // The reading itself is the evidence — print it, or the failure is
          // just a number and the next prompt change is another guess.
          console.log(`\n${testCase.id} model output:\n${JSON.stringify(output, null, 2)}\n`);
        }
        expect(result.failures).toEqual([]);
      },
      120_000,
    );
  }
});
