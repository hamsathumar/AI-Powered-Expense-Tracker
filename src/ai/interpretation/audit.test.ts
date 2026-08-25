/**
 * Regression tests for the 2026-08-25 AI-pipeline audit, Phase 1
 * (findings F1, F2, F4, F6 — see Test/TRANSACTION_AI_V1_2_AMENDMENTS.md).
 *
 * F1 — anaphoric amounts ("that amount") are grounded by reference against
 *      another grounded amount in the SAME utterance, never dropped.
 * F2 — grounding accepts Tamil number words (romanised and script), so a
 *      mixed-language amount is not silently demoted.
 * F4 — a stated date expression the app cannot resolve becomes a blocking
 *      conflict instead of silently committing as the capture day.
 * F6 — a grounded amount the model marked AMBIGUOUS carries a blocking
 *      confirm-conflict instead of presenting as certain.
 */
import { describe, expect, it } from '@jest/globals';

import { evaluateApproval } from './gate';
import { resolveCandidate, type ResolveContext } from './resolve';
import { validateInterpretation } from './validate';

const ctx: ResolveContext = {
  accounts: [
    { id: 'acc-cb', name: 'Commercial Bank' },
    { id: 'acc-cash', name: 'Cash' },
  ],
  expenseCategories: [{ id: 'cat-food', name: 'Food' }],
  incomeCategories: [{ id: 'cat-salary', name: 'Salary' }],
  people: [{ id: 'p-nuski', name: 'Nuski' }],
};

const userAmount = (expr: string, value: number) => ({
  expression: expr,
  value,
  provenance: 'USER_EXPLICIT',
  state: 'KNOWN',
});

// ── F1 — the "that amount" bug ───────────────────────────────────────────
describe('Audit F1 — anaphoric amount grounded by reference', () => {
  const transcript =
    'I received 2000 from a person that owes me and I transferred that amount from Commercial Bank to Cash.';

  const input = (transferAmount: unknown) => ({
    transcript,
    candidates: [
      { operation: 'income', amount: userAmount('2000', 2000) },
      {
        operation: 'transfer',
        amount: transferAmount,
        account: { reference: 'Commercial Bank', provenance: 'USER_EXPLICIT', state: 'KNOWN' },
        toAccount: { reference: 'Cash', provenance: 'USER_EXPLICIT', state: 'KNOWN' },
      },
    ],
  });

  it('promotes "that amount" when its value matches a grounded amount in the same utterance', () => {
    const v = validateInterpretation(
      input({ expression: 'that amount', value: 2000, provenance: 'AI_INTERPRETED', state: 'INFERRED' }),
    );
    expect(v.candidates).toHaveLength(2); // the transfer is NOT dropped any more
    const transfer = v.candidates.find((c) => c.operation === 'transfer')!;
    expect(transfer.amount.grounded).toBe(true);
    expect(transfer.amount.valueMinor).toBe(200000);
    expect(transfer.conflicts.some((c) => c.kind === 'amount_by_reference')).toBe(true);
    expect(v.issues).toContain('amount grounded by reference to another amount in the same utterance');
  });

  it('the promoted transfer still requires explicit user confirmation at the gate', () => {
    const v = validateInterpretation(
      input({ expression: 'that amount', value: 2000, provenance: 'AI_INTERPRETED', state: 'INFERRED' }),
    );
    const transfer = v.candidates.find((c) => c.operation === 'transfer')!;
    const op = resolveCandidate(transfer, ctx);
    const gate = evaluateApproval(op);
    expect(gate.approvable).toBe(false);
    expect(gate.blockers.some((b) => b.code === 'unresolved_conflict' && b.detail === 'amount_by_reference')).toBe(true);

    // user acknowledges the reference → the conflict clears → approvable
    op.conflicts = op.conflicts.filter((c) => c.kind !== 'amount_by_reference');
    expect(evaluateApproval(op).approvable).toBe(true);
  });

  it('does NOT promote when the carried value matches no grounded amount (no invention)', () => {
    const v = validateInterpretation(
      input({ expression: 'that amount', value: 500, provenance: 'AI_INTERPRETED', state: 'INFERRED' }),
    );
    expect(v.candidates.map((c) => c.operation)).toEqual(['income']);
    expect(v.unqualifiedIntents).toHaveLength(1); // preserved, not silently lost
  });

  it('does NOT promote a non-anaphoric vague expression even when the value matches', () => {
    const v = validateInterpretation(
      input({ expression: 'some money', value: 2000, provenance: 'AI_INTERPRETED', state: 'INFERRED' }),
    );
    expect(v.candidates.map((c) => c.operation)).toEqual(['income']);
    expect(v.unqualifiedIntents).toHaveLength(1);
  });

  it('does NOT promote when the model carried no value at all', () => {
    const v = validateInterpretation(
      input({ expression: 'that amount', value: null, provenance: 'UNRESOLVED', state: 'UNKNOWN' }),
    );
    expect(v.candidates.map((c) => c.operation)).toEqual(['income']);
    expect(v.unqualifiedIntents).toHaveLength(1);
  });

  it('promotes a bill_split total by reference, and the TC-021 dedup then suppresses the twin candidate', () => {
    const v = validateInterpretation({
      transcript: 'Spent 900 on food. Split that amount between me, Nuski and Sham.',
      candidates: [{ operation: 'expense', amount: userAmount('900', 900) }],
      specializedOperations: [
        {
          operationKind: 'bill_split',
          total: { expression: 'that amount', value: 900, provenance: 'AI_INTERPRETED', state: 'INFERRED' },
          participants: [
            { reference: 'Nuski', provenance: 'USER_EXPLICIT', state: 'KNOWN' },
            { reference: 'Sham', provenance: 'USER_EXPLICIT', state: 'KNOWN' },
          ],
          splitEvidence: [{ sourceText: 'split that amount between', supports: 'bill_split' }],
        },
      ],
    });
    expect(v.specializedOperations).toHaveLength(1);
    expect(v.specializedOperations[0]!.kind).toBe('bill_split');
    expect(v.candidates).toHaveLength(0); // one sum of money, one operation
  });
});

// ── F2 — multilingual amount grounding ───────────────────────────────────
describe('Audit F2 — Tamil amount expressions are grounded', () => {
  it('accepts romanised Tamil number words', () => {
    const v = validateInterpretation({
      transcript: 'Rendayiram rupees for food.',
      candidates: [{ operation: 'expense', amount: userAmount('rendayiram rupees', 2000) }],
    });
    expect(v.candidates).toHaveLength(1);
    expect(v.candidates[0]!.amount.grounded).toBe(true);
    expect(v.candidates[0]!.amount.valueMinor).toBe(200000);
  });

  it('accepts Tamil-script number words (compound forms included)', () => {
    const v = validateInterpretation({
      transcript: 'ரெண்டாயிரம் ரூபாய் உணவுக்கு.',
      candidates: [{ operation: 'expense', amount: userAmount('ரெண்டாயிரம் ரூபாய்', 2000) }],
    });
    expect(v.candidates).toHaveLength(1);
    expect(v.candidates[0]!.amount.grounded).toBe(true);
  });

  it('still refuses expressions with no magnitude in any language', () => {
    const v = validateInterpretation({
      transcript: 'I spent some money.',
      candidates: [
        { operation: 'expense', amount: { expression: 'konjam kaasu', value: 500, provenance: 'AI_INFERRED', state: 'INFERRED' } },
      ],
    });
    expect(v.candidates).toHaveLength(0);
    expect(v.unqualifiedIntents).toHaveLength(1);
  });
});

// ── F4 — un-understood dates must not commit silently ────────────────────
describe('Audit F4 — unresolved date expression blocks approval', () => {
  const base = (expression: string | null) => ({
    transcript: 'I spent Rs.800 on food.',
    candidates: [
      {
        operation: 'expense',
        amount: userAmount('Rs.800', 800),
        category: { reference: 'Food', provenance: 'USER_EXPLICIT', state: 'KNOWN' },
        account: { reference: 'Cash', provenance: 'USER_EXPLICIT', state: 'KNOWN' },
        dateExpression: expression ? { expression, kind: 'relative' } : undefined,
      },
    ],
  });

  it('attaches a blocking date_unresolved conflict for an unsupported expression', () => {
    const v = validateInterpretation(base('right after the festival'), {
      now: new Date('2026-08-25T12:00:00Z'),
    });
    const cand = v.candidates[0]!;
    expect(cand.conflicts.some((c) => c.kind === 'date_unresolved')).toBe(true);
    const gate = evaluateApproval(resolveCandidate(cand, ctx));
    expect(gate.approvable).toBe(false);
    expect(gate.blockers.some((b) => b.detail === 'date_unresolved')).toBe(true);
  });

  it('attaches nothing for a supported expression ("yesterday")', () => {
    const v = validateInterpretation(base('yesterday'), { now: new Date('2026-08-25T12:00:00Z') });
    expect(v.candidates[0]!.conflicts).toHaveLength(0);
  });

  it('attaches nothing when no date was spoken', () => {
    const v = validateInterpretation(base(null), { now: new Date('2026-08-25T12:00:00Z') });
    expect(v.candidates[0]!.conflicts).toHaveLength(0);
  });
});

// ── F6 — ambiguous amounts must be confirmed ─────────────────────────────
describe('Audit F6 — AMBIGUOUS amount carries a confirm-conflict', () => {
  it('flags a grounded amount the model marked AMBIGUOUS', () => {
    const v = validateInterpretation({
      transcript: 'It was 500 or maybe 5000 for food.',
      candidates: [
        {
          operation: 'expense',
          amount: { expression: '500 or maybe 5000', value: 5000, provenance: 'AI_INTERPRETED', state: 'AMBIGUOUS' },
        },
      ],
    });
    const cand = v.candidates[0]!;
    expect(cand.amount.grounded).toBe(true);
    expect(cand.conflicts.some((c) => c.kind === 'amount_uncertain')).toBe(true);
    const gate = evaluateApproval(resolveCandidate(cand, ctx));
    expect(gate.blockers.some((b) => b.detail === 'amount_uncertain')).toBe(true);
  });

  it('does not flag a KNOWN amount', () => {
    const v = validateInterpretation({
      transcript: 'Rs.500 for food.',
      candidates: [{ operation: 'expense', amount: userAmount('Rs.500', 500) }],
    });
    expect(v.candidates[0]!.conflicts).toHaveLength(0);
  });
});
