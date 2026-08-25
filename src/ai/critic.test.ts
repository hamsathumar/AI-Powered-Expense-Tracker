/**
 * The compound-utterance critic's decision logic (audit F8d).
 *
 * The network call is thin and untested; everything that decides WHETHER to
 * audit, what the auditor is allowed to claim, and which reading survives is
 * pure and lives here. The containment tests matter most: a self-correction
 * loop that can invent money is worse than no loop at all.
 */
import { describe, expect, it } from '@jest/globals';

import {
  buildCorrectionNote,
  chooseInterpretation,
  countMoneyMentions,
  critiqueHasFindings,
  shouldCritique,
  verifyCritique,
  type Critique,
} from './critic';
import type { ValidatedInterpretation } from './interpretation/types';

const interpretation = (counts: {
  candidates?: number;
  specialized?: number;
  unqualified?: number;
}): ValidatedInterpretation => ({
  schemaVersion: 'v1',
  outcome: 'CANDIDATES_PRESENT',
  transcript: '',
  candidates: Array.from({ length: counts.candidates ?? 0 }, () => ({}) as never),
  specializedOperations: Array.from({ length: counts.specialized ?? 0 }, () => ({}) as never),
  unqualifiedIntents: Array.from({ length: counts.unqualified ?? 0 }, () => ({}) as never),
  issues: [],
});

const claim = (amountExpression: string, sourceText = 'said it') => ({ amountExpression, sourceText });

// ── When the audit runs at all ───────────────────────────────────────────
describe('countMoneyMentions', () => {
  it('counts each sum in a compound utterance', () => {
    expect(countMoneyMentions('Spent 500 on food and 200 on stationery')).toBe(2);
  });

  it('ignores quantities that are plainly not money', () => {
    expect(countMoneyMentions('a recurring payment of 394.33 for the next 3 months')).toBe(1);
    expect(countMoneyMentions('split 900 between 4 people')).toBe(1);
  });

  it('handles formatted and shorthand amounts', () => {
    expect(countMoneyMentions('paid 2,500 and 2.5k')).toBe(2);
  });
});

describe('shouldCritique', () => {
  it('skips the ordinary single-transaction note — the common case costs nothing', () => {
    expect(shouldCritique('Spent 500 on food from cash', interpretation({ candidates: 1 }))).toBe(false);
  });

  it('audits when more sums were said than readings produced', () => {
    // Two amounts spoken, one operation produced: the exact shape of a drop.
    expect(shouldCritique('Spent 500 on food and 200 on stationery', interpretation({ candidates: 1 }))).toBe(true);
  });

  it('does not audit when the extra sum was preserved as an unqualified intent', () => {
    // Nothing was lost — the second sum is already in the queue awaiting an
    // amount (audit F3), so there is nothing for the auditor to find.
    expect(
      shouldCritique('Spent 500 on food and 200 on stationery', interpretation({ candidates: 1, unqualified: 1 })),
    ).toBe(false);
  });

  it('audits a long rambling utterance even when the counts line up', () => {
    const rambling =
      'Long day today, went out in the morning and ended up at the market near the office where I filled petrol for 3000 rupees using the bank card on the way back home';
    expect(shouldCritique(rambling, interpretation({ candidates: 1 }))).toBe(true);
  });

  it('never audits an empty transcript', () => {
    expect(shouldCritique('   ', interpretation({ candidates: 1 }))).toBe(false);
  });
});

// ── What the auditor is allowed to claim ─────────────────────────────────
describe('verifyCritique — the auditor may only point at money the user said', () => {
  const transcript = 'Spent 500 on food and 200 on stationery from cash.';

  it('keeps a claim whose amount is really in the transcript', () => {
    const verified = verifyCritique({ missing: [claim('200')], duplicated: [] }, transcript);
    expect(verified.missing.map((c) => c.amountExpression)).toEqual(['200']);
  });

  it('discards an invented amount outright', () => {
    const verified = verifyCritique({ missing: [claim('9999')], duplicated: [] }, transcript);
    expect(verified.missing).toHaveLength(0);
    expect(critiqueHasFindings(verified)).toBe(false);
  });

  it('matches regardless of formatting', () => {
    const verified = verifyCritique({ missing: [claim('Rs. 500')], duplicated: [] }, 'Spent 500 on food');
    expect(verified.missing).toHaveLength(1);
  });

  it('accepts a spoken amount only when those words appear', () => {
    expect(verifyCritique({ missing: [claim('two thousand')], duplicated: [] }, 'I spent two thousand').missing)
      .toHaveLength(1);
    expect(verifyCritique({ missing: [claim('two thousand')], duplicated: [] }, 'I spent 500').missing)
      .toHaveLength(0);
  });

  it('survives junk from the model without throwing', () => {
    expect(verifyCritique(null, transcript)).toEqual({ missing: [], duplicated: [] });
    expect(verifyCritique({ missing: 'not an array' }, transcript)).toEqual({ missing: [], duplicated: [] });
    expect(verifyCritique({ missing: [{ nonsense: true }] }, transcript)).toEqual({ missing: [], duplicated: [] });
  });
});

describe('buildCorrectionNote', () => {
  it('points at the money without asserting a transaction', () => {
    const note = buildCorrectionNote({ missing: [{ amountExpression: '200', whatFor: 'stationery', sourceText: '200 on stationery' }], duplicated: [] });
    expect(note).toContain('200');
    expect(note).toContain('stationery');
    // It must invite a re-read, not dictate an answer.
    expect(note).toContain('ONLY if they are genuinely separate transactions');
    expect(note).toContain('Do not invent anything');
  });

  it('states the one-sum-one-operation rule when money was double-counted', () => {
    const note = buildCorrectionNote({ missing: [], duplicated: [claim('900')] });
    expect(note).toContain('exactly ONE operation');
  });
});

// ── Which reading survives ───────────────────────────────────────────────
describe('chooseInterpretation', () => {
  const missing: Critique = { missing: [claim('200')], duplicated: [] };
  const duplicated: Critique = { missing: [], duplicated: [claim('900')] };

  it('takes the repair when money was missing and the re-read found more', () => {
    expect(chooseInterpretation(interpretation({ candidates: 1 }), interpretation({ candidates: 2 }), missing)).toBe(
      'repaired',
    );
  });

  it('keeps the original when the re-read did not actually add anything', () => {
    expect(chooseInterpretation(interpretation({ candidates: 1 }), interpretation({ candidates: 1 }), missing)).toBe(
      'original',
    );
  });

  it('keeps the original when the re-read LOST a transaction it was meant to add', () => {
    expect(chooseInterpretation(interpretation({ candidates: 2 }), interpretation({ candidates: 1 }), missing)).toBe(
      'original',
    );
  });

  it('takes the repair when money was double-counted and the re-read has fewer', () => {
    expect(
      chooseInterpretation(interpretation({ candidates: 2 }), interpretation({ candidates: 1 }), duplicated),
    ).toBe('repaired');
  });

  it('keeps the original when a duplicate-fix somehow produced MORE operations', () => {
    expect(
      chooseInterpretation(interpretation({ candidates: 1 }), interpretation({ candidates: 3 }), duplicated),
    ).toBe('original');
  });

  it('counts specialized operations too, so a split repair is not miscounted', () => {
    expect(
      chooseInterpretation(interpretation({ candidates: 1 }), interpretation({ candidates: 1, specialized: 1 }), missing),
    ).toBe('repaired');
  });
});
