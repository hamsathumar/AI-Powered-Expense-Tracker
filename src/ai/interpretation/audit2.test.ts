/**
 * Regression tests for the 2026-08-25 AI-pipeline audit, Phase 2
 * (findings F3, F4-grammar, F5, F10 — see Test/TRANSACTION_AI_V1_2_AMENDMENTS.md).
 *
 * F3  — an intent voiced without a resolvable amount is QUEUED (null amount,
 *       un-committable) instead of being silently discarded.
 * F4  — the extended relative-date grammar.
 * F5  — the review screen's edits are just field changes on a ResolvedOperation,
 *       so they are tested here at the gate level: a user-supplied amount makes
 *       a needs-amount item approvable.
 * F10 — near-matched entity names are OFFERED (ambiguous), never auto-resolved.
 */
import { describe, expect, it } from '@jest/globals';

import { resolveDateExpression } from './dates';
import { evaluateApproval } from './gate';
import { nearMatches, resolveCandidate, resolveRef, resolveUnqualified, type ResolveContext } from './resolve';
import type { EntityRef, UnqualifiedIntent } from './types';
import { validateInterpretation } from './validate';

const ctx: ResolveContext = {
  accounts: [
    { id: 'acc-cb', name: 'Commercial Bank' },
    { id: 'acc-cash', name: 'Cash' },
    { id: 'acc-boc', name: 'BOC' },
  ],
  expenseCategories: [
    { id: 'cat-food', name: 'Food' },
    { id: 'cat-groceries', name: 'Groceries' },
  ],
  incomeCategories: [{ id: 'cat-salary', name: 'Salary' }],
  people: [
    { id: 'p-nuski', name: 'Nuski' },
    { id: 'p-sham', name: 'Sham' },
    { id: 'p-mayees', name: 'Mayees Mowlavi' },
  ],
};

const ref = (reference: string): EntityRef => ({
  reference,
  provenance: 'USER_EXPLICIT',
  state: 'KNOWN',
  candidates: [],
});

// ── F3 — voiced intents survive as needs-amount queue items ──────────────
describe('Audit F3 — an intent without an amount reaches the queue', () => {
  const interpretation = validateInterpretation({
    transcript: 'I paid the electricity bill from Commercial Bank.',
    candidates: [
      {
        operation: 'expense',
        amount: { expression: null, value: null, provenance: 'UNRESOLVED', state: 'UNKNOWN' },
        account: { reference: 'Commercial Bank', provenance: 'USER_EXPLICIT', state: 'KNOWN' },
        name: 'Electricity Bill',
        dateExpression: { expression: 'yesterday', kind: 'relative' },
      },
    ],
  });

  it('is preserved as an unqualified intent that keeps its resolved context', () => {
    expect(interpretation.candidates).toHaveLength(0);
    expect(interpretation.unqualifiedIntents).toHaveLength(1);
    const intent = interpretation.unqualifiedIntents[0]!;
    expect(intent.committable).toBe(false);
    expect(intent.account?.reference).toBe('Commercial Bank');
    expect(intent.name).toBe('Electricity Bill'); // readable in the queue
    expect(intent.date.expression).toBe('yesterday');
  });

  it('resolves into a queueable operation with a NULL amount — never a zero', () => {
    const op = resolveUnqualified(interpretation.unqualifiedIntents[0]!, ctx);
    expect(op.amountMinor).toBeNull();
    expect(op.amountProvenance).toBe('UNRESOLVED');
    expect(op.account?.id).toBe('acc-cb'); // context the user gave is kept
    expect(op.name).toBe('Electricity Bill');
  });

  it('cannot be committed while the amount is missing', () => {
    const op = resolveUnqualified(interpretation.unqualifiedIntents[0]!, ctx);
    const gate = evaluateApproval(op);
    expect(gate.approvable).toBe(false);
    expect(gate.blockers.map((b) => b.code)).toContain('amount_not_grounded');
  });

  it('becomes approvable once the user supplies the amount and category (audit F5)', () => {
    const op = resolveUnqualified(interpretation.unqualifiedIntents[0]!, ctx);
    // Exactly what the review screen produces when the user types a figure and
    // picks the remaining field.
    const edited = {
      ...op,
      amountMinor: 245000,
      amountProvenance: 'USER_EXPLICIT' as const,
      category: { reference: 'Food', id: 'cat-food', status: 'resolved' as const, options: [] },
      conflicts: [],
    };
    expect(evaluateApproval(edited).approvable).toBe(true);
  });

  it('assumes a type only with a blocking confirmation when none was heard', () => {
    const intent: UnqualifiedIntent = {
      localId: 'uq-0',
      operation: 'unknown',
      amount: { expression: null, valueMinor: null, provenance: 'UNRESOLVED', state: 'UNKNOWN', grounded: false },
      account: null,
      category: null,
      person: null,
      date: { expression: null, kind: 'none' },
      name: 'Something',
      evidence: [],
      rejectionReason: 'NO_TRANSACTION_VALUE_DETECTED',
      promoted: false,
      committable: false,
    };
    const op = resolveUnqualified(intent, ctx);
    expect(op.operation).toBe('expense');
    expect(op.conflicts.some((c) => c.kind === 'type_unconfirmed')).toBe(true);
    expect(evaluateApproval(op).approvable).toBe(false);
  });
});

// ── F10 — near matches are offered, never applied ────────────────────────
describe('Audit F10 — near-matched entity names', () => {
  it('offers a misheard person as an ambiguous suggestion, not a resolution', () => {
    const resolved = resolveRef(ref('Nusky'), ctx.people)!;
    expect(resolved.status).toBe('ambiguous');
    expect(resolved.id).toBeNull(); // never auto-applied
    expect(resolved.options.map((o) => o.name)).toContain('Nuski');
  });

  it('keeps an exact match resolving exactly as before', () => {
    const resolved = resolveRef(ref('Commercial Bank'), ctx.accounts)!;
    expect(resolved.status).toBe('resolved');
    expect(resolved.id).toBe('acc-cb');
  });

  it('offers a partial name ("bank" → Commercial Bank)', () => {
    expect(nearMatches('bank', ctx.accounts).map((m) => m.name)).toContain('Commercial Bank');
  });

  it('does not guess between genuinely unrelated names', () => {
    expect(nearMatches('Petrol Station', ctx.people)).toHaveLength(0);
    expect(resolveRef(ref('Petrol Station'), ctx.people)!.status).toBe('unresolved');
  });

  it('refuses to guess from a reference too short to be meaningful', () => {
    expect(nearMatches('a', ctx.accounts)).toHaveLength(0);
  });

  it('an ambiguous suggestion still blocks approval until the user picks', () => {
    const v = validateInterpretation({
      transcript: 'Lent 500 to Nusky from Cash.',
      candidates: [
        {
          operation: 'lending',
          direction: 'lend',
          amount: { expression: '500', value: 500, provenance: 'USER_EXPLICIT', state: 'KNOWN' },
          account: { reference: 'Cash', provenance: 'USER_EXPLICIT', state: 'KNOWN' },
          person: { reference: 'Nusky', provenance: 'USER_EXPLICIT', state: 'KNOWN' },
        },
      ],
    });
    const op = resolveCandidate(v.candidates[0]!, ctx);
    expect(op.person?.status).toBe('ambiguous');
    expect(evaluateApproval(op).blockers.map((b) => b.code)).toContain('person_ambiguous');
  });
});

// ── F4 — extended date grammar ───────────────────────────────────────────
describe('Audit F4 — extended relative-date grammar', () => {
  // A Tuesday, so weekday maths is unambiguous in the assertions below.
  const now = new Date('2026-08-25T12:00:00.000Z');
  const day = (expr: string) => resolveDateExpression(expr, now).iso.slice(0, 10);

  it('resolves durations ago', () => {
    expect(day('3 days ago')).toBe('2026-08-22');
    expect(day('two weeks ago')).toBe('2026-08-11');
    expect(day('a month ago')).toBe('2026-07-25');
    expect(day('two years ago')).toBe('2024-08-25');
  });

  it('resolves "last week/month/year"', () => {
    expect(day('last week')).toBe('2026-08-18');
    expect(day('last month')).toBe('2026-07-25');
    expect(day('last year')).toBe('2025-08-25');
  });

  it('resolves explicit calendar dates in either word order', () => {
    expect(day('15 August')).toBe('2026-08-15');
    expect(day('August 15')).toBe('2026-08-15');
    expect(day('3rd of August 2025')).toBe('2025-08-03');
    expect(day('2026-08-01')).toBe('2026-08-01');
  });

  it('reads a bare calendar date as the most recent one, never the future', () => {
    // 25 Dec has not happened yet in the reference year.
    expect(day('25 December')).toBe('2025-12-25');
  });

  it('resolves a day of the month, past-leaning', () => {
    expect(day('the 15th')).toBe('2026-08-15'); // already passed this month
    expect(day('the 30th')).toBe('2026-07-30'); // not yet reached → last month
  });

  it('treats time-of-day words as the day they belong to', () => {
    expect(day('this morning')).toBe('2026-08-25');
    expect(day('tonight')).toBe('2026-08-25');
    expect(day('last night')).toBe('2026-08-24');
  });

  it('tolerates leading filler', () => {
    expect(day('on 15 August')).toBe('2026-08-15');
    expect(day('yesterday.')).toBe('2026-08-24');
  });

  it('still reports genuinely unsupported wording as unresolved', () => {
    expect(resolveDateExpression('right after the festival', now).resolved).toBe(false);
    expect(resolveDateExpression('when I get paid', now).resolved).toBe(false);
  });

  it('never overflows a month boundary', () => {
    // 31 Jan − 1 month must not land on 2 or 3 March.
    const from31 = resolveDateExpression('a month ago', new Date('2026-03-31T12:00:00.000Z'));
    expect(from31.iso.slice(0, 10)).toBe('2026-02-28');
  });
});
