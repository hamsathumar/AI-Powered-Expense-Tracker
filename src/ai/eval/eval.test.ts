/**
 * Hermetic replay of the eval corpus (audit F8c).
 *
 * Every case's RECORDED model response is pushed through the real
 * validate → resolve → gate pipeline and scored. No key, no network: this asks
 * "given this reading, does the app still reach the right end state?", which is
 * the half of accuracy the app actually controls.
 *
 * The live half — "does the model still produce that reading?" — is
 * `liveEval.test.ts`, run deliberately against Gemini when a prompt changes.
 */
import { describe, expect, it } from '@jest/globals';

import { EVAL_CONTEXT, EVAL_CORPUS, EVAL_NOW } from './corpus';
import { formatReport, scoreCase, summarise } from './score';

describe('interpretation eval corpus (offline replay)', () => {
  for (const testCase of EVAL_CORPUS) {
    const label = testCase.origin ? `${testCase.id} [${testCase.origin}] — ${testCase.what}` : `${testCase.id} — ${testCase.what}`;
    it(label, () => {
      const result = scoreCase(testCase, testCase.modelOutput, EVAL_CONTEXT, EVAL_NOW);
      // Surfacing the reasons makes a regression readable without a debugger.
      expect(result.failures).toEqual([]);
      expect(result.passed).toBe(true);
    });
  }

  it('the whole corpus passes', () => {
    const report = summarise(
      EVAL_CORPUS.map((testCase) => scoreCase(testCase, testCase.modelOutput, EVAL_CONTEXT, EVAL_NOW)),
    );
    // Compared as text so a failure prints the full per-case report rather
    // than "expected 17 to be 18".
    expect(report.passed === report.total ? 'all cases pass' : formatReport(report)).toBe('all cases pass');
  });

  it('the scorer actually fails a wrong reading (a green corpus must mean something)', () => {
    const merged = {
      transcript: 'Spent 500 on food and 200 on stationeries, both from cash.',
      // The TC-020 failure: two spends collapsed into one total.
      candidates: [
        {
          operation: 'expense',
          amount: { expression: '700', value: 700, provenance: 'USER_EXPLICIT', state: 'KNOWN' },
          category: { reference: 'Food', provenance: 'USER_EXPLICIT', state: 'KNOWN' },
          account: { reference: 'Cash', provenance: 'USER_EXPLICIT', state: 'KNOWN' },
          name: 'Food',
        },
      ],
      specializedOperations: [],
      unqualifiedIntents: [],
    };
    const twoExpenses = EVAL_CORPUS.find((c) => c.id === 'EV-02')!;
    const result = scoreCase(twoExpenses, merged, EVAL_CONTEXT, EVAL_NOW);
    expect(result.passed).toBe(false);
    expect(result.failures.join(' ')).toContain('expected 2 operation(s), got 1');
  });

  it('a category list accepts any listed answer, but never an invented one', () => {
    const fruits = EVAL_CORPUS.find((c) => c.id === 'EV-23')!;
    const reading = (category: string) => ({
      transcript: 'Bought strawberries for 500 rupees on cash, label it as fruits.',
      candidates: [
        {
          operation: 'expense',
          amount: { expression: '500 rupees', value: 500, provenance: 'USER_EXPLICIT', state: 'KNOWN' },
          account: { reference: 'Cash', provenance: 'USER_EXPLICIT', state: 'KNOWN' },
          category: { reference: category, provenance: 'AI_INTERPRETED', state: 'KNOWN' },
          name: 'Fruits',
        },
      ],
      specializedOperations: [],
      unqualifiedIntents: [],
    });
    expect(scoreCase(fruits, reading('Food'), EVAL_CONTEXT, EVAL_NOW).passed).toBe(true);
    expect(scoreCase(fruits, reading('Groceries'), EVAL_CONTEXT, EVAL_NOW).passed).toBe(true);
    const invented = scoreCase(fruits, reading('Strawberries'), EVAL_CONTEXT, EVAL_NOW);
    expect(invented.passed).toBe(false);
    expect(invented.failures.join(' ')).toContain('expected category "Groceries" or "Food", got unresolved');
  });
});
