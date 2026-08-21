/**
 * Tests for the specialized-operation editor prefill adapters (handoff).
 * Verifies deterministic mapping and the safety invariants: no invented ids,
 * grounded amount only, unresolved participants surfaced (not auto-created),
 * unresolved account/category left null, recurring stays recurring.
 */
import { describe, expect, it } from '@jest/globals';

import { evaluateApproval } from './interpretation/gate';
import { resolveSpecialized, type ResolveContext } from './interpretation/resolve';
import { validateInterpretation } from './interpretation/validate';
import {
  buildBillSplitPrefill,
  buildRecurringInitial,
  ME,
  recurringEndNote,
} from './specializedPrefill';

const ctx: ResolveContext = {
  accounts: [
    { id: 'acc-cb', name: 'Commercial Bank' },
    { id: 'acc-cash', name: 'Cash' },
  ],
  expenseCategories: [{ id: 'cat-food', name: 'Food' }],
  incomeCategories: [{ id: 'cat-salary', name: 'Salary' }],
  people: [
    { id: 'p-sham', name: 'Sham' },
    { id: 'p-nuski', name: 'Nuski' },
  ],
};

const userAmount = (expr: string, value: number) => ({
  expression: expr,
  value,
  provenance: 'USER_EXPLICIT',
  state: 'KNOWN',
});

function billSplitOp() {
  const v = validateInterpretation({
    transcript: 'I paid Rs.4000 for dinner and we split it between me, Sham, Nuski and Peter.',
    specializedOperations: [
      {
        operationKind: 'bill_split',
        total: userAmount('Rs.4000', 4000),
        participants: [{ reference: 'me' }, { reference: 'Sham' }, { reference: 'Nuski' }, { reference: 'Peter' }],
        payer: { reference: 'me' },
        account: { reference: 'Commercial Bank', provenance: 'USER_EXPLICIT', state: 'KNOWN' },
        splitEvidence: [{ sourceText: 'we split it between', supports: 'split' }],
        name: 'Dinner',
      },
    ],
  });
  return { v, op: resolveSpecialized(v.specializedOperations[0]!, ctx) };
}

describe('Bill Split prefill handoff', () => {
  it('stays a bill_split pending operation (never flattened) and is not ordinary-committable', () => {
    const { v, op } = billSplitOp();
    expect(v.specializedOperations[0]!.kind).toBe('bill_split');
    expect(op.kind).toBe('bill_split');
    // The ordinary commit gate still refuses it — the editor path is separate.
    expect(evaluateApproval(op).blockers.some((b) => b.code === 'needs_specialized_editor')).toBe(true);
  });

  it('prefills grounded amount, resolved account, resolved participants; surfaces unknown names', () => {
    const { op } = billSplitOp();
    const pre = buildBillSplitPrefill(op, ctx.people);
    expect(pre.name).toBe('Dinner');
    expect(pre.amountText).toBe('4000.00'); // grounded 4000, editor input format
    expect(pre.accountId).toBe('acc-cb'); // resolved by the app, not the AI
    expect(pre.participantIds).toContain(ME);
    expect(pre.participantIds).toContain('p-sham');
    expect(pre.participantIds).toContain('p-nuski');
    // "Peter" is not in People → surfaced, NOT auto-created, NOT an invented id
    expect(pre.unresolvedNames).toEqual(['Peter']);
    expect(pre.participantIds).not.toContain('Peter');
  });

  it('leaves an unresolved account/category null (no defaulting)', () => {
    const v = validateInterpretation({
      transcript: 'split 900 between me and Sham',
      specializedOperations: [
        {
          operationKind: 'bill_split',
          total: userAmount('900', 900),
          participants: [{ reference: 'me' }, { reference: 'Sham' }],
          splitEvidence: [{ sourceText: 'split', supports: 'split' }],
        },
      ],
    });
    const op = resolveSpecialized(v.specializedOperations[0]!, ctx);
    const pre = buildBillSplitPrefill(op, ctx.people);
    expect(pre.accountId).toBeNull();
    expect(pre.categoryId).toBeNull();
  });
});

describe('Recurring prefill handoff', () => {
  function recurringOp() {
    const v = validateInterpretation({
      transcript: 'Set up a recurring Netflix payment of Rs.1500 every month on the 15th.',
      specializedOperations: [
        {
          operationKind: 'recurring',
          operation: 'expense',
          baseAmount: userAmount('Rs.1500', 1500),
          recurrenceExpression: 'every month on the 15th',
          intervalHint: 'monthly',
          anchorDateExpression: { expression: 'today', kind: 'relative' },
          evidenceStrength: 'clear',
          recurringEvidence: [{ sourceText: 'recurring ... every month', supports: 'recurrence' }],
          account: { reference: 'Cash', provenance: 'USER_EXPLICIT', state: 'KNOWN' },
          category: { reference: 'Food', provenance: 'AI_INFERRED', state: 'INFERRED' },
          name: 'Netflix',
        },
      ],
    });
    return { v, op: resolveSpecialized(v.specializedOperations[0]!, ctx) };
  }

  it('stays a recurring operation (never flattened to one-time)', () => {
    const { v, op } = recurringOp();
    expect(v.specializedOperations[0]!.kind).toBe('recurring');
    expect(op.kind).toBe('recurring');
    expect(evaluateApproval(op).blockers.some((b) => b.code === 'needs_specialized_editor')).toBe(true);
  });

  it('prefills the recurring editor initial with grounded amount + resolved refs', () => {
    const { op } = recurringOp();
    const init = buildRecurringInitial(op, new Date('2026-08-17T12:00:00Z'));
    expect(init.type).toBe('expense');
    expect(init.name).toBe('Netflix');
    expect(init.amountMinor).toBe(150000); // grounded 1500 → minor
    expect(init.frequency).toBe('monthly');
    expect(init.accountId).toBe('acc-cash'); // resolved
    expect(init.categoryId).toBe('cat-food'); // resolved
    expect(init.nextDueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/); // date string, not a raw expression
    expect(init.status).toBe('active');
  });

  it('maps an unsupported interval (yearly) to the editor default, never inventing a schedule', () => {
    const v = validateInterpretation({
      transcript: 'recurring 100 yearly for domain',
      specializedOperations: [
        {
          operationKind: 'recurring',
          operation: 'expense',
          baseAmount: userAmount('100', 100),
          intervalHint: 'yearly',
          evidenceStrength: 'clear',
          recurringEvidence: [{ sourceText: 'yearly', supports: 'recurrence' }],
        },
      ],
    });
    const init = buildRecurringInitial(resolveSpecialized(v.specializedOperations[0]!, ctx), new Date());
    expect(init.frequency).toBe('monthly'); // conservative default; user edits
  });
});

// ── TC-025 — a stated duration must reach the editor's "Ends" field ──────
describe('TC-025 — recurring end condition reaches the editor', () => {
  const now = new Date('2026-08-21T12:00:00Z');

  function recurringWith(extra: Record<string, unknown>) {
    const v = validateInterpretation({
      transcript:
        'Record a recurring transaction of 394 rupees 33 cents for the next 3 months from my Commercial Bank',
      specializedOperations: [
        {
          operationKind: 'recurring',
          operation: 'expense',
          baseAmount: userAmount('394 rupees 33 cents', 394.33),
          intervalHint: 'monthly',
          anchorDateExpression: { expression: 'today', kind: 'relative' },
          evidenceStrength: 'clear',
          recurringEvidence: [{ sourceText: 'recurring transaction', supports: 'recurrence' }],
          account: { reference: 'Commercial Bank', provenance: 'USER_EXPLICIT', state: 'KNOWN' },
          name: 'phone back cover purchase',
          ...extra,
        },
      ],
    });
    return resolveSpecialized(v.specializedOperations[0]!, ctx);
  }

  it('prefills "Ends: On date" instead of leaving "Never" selected (the observed failure)', () => {
    const init = buildRecurringInitial(recurringWith({ endExpression: 'for the next 3 months' }), now);
    expect(init.nextDueDate).toBe('2026-08-21');
    expect(init.endDate).toBe('2026-10-21'); // 3 monthly payments, inclusive
    expect(init.amountMinor).toBe(39433);
    expect(init.accountId).toBe('acc-cb');
  });

  it('title-cases the name on the way through, without changing the schedule', () => {
    const init = buildRecurringInitial(recurringWith({ endExpression: 'for the next 3 months' }), now);
    expect(init.name).toBe('Phone Back Cover Purchase');
    expect(init.frequency).toBe('monthly');
  });

  it('leaves endDate undefined when the user stated no end — unchanged behaviour', () => {
    const init = buildRecurringInitial(recurringWith({}), now);
    expect(init.endDate).toBeUndefined();
  });

  it('leaves endDate undefined when the user explicitly said it never ends', () => {
    const init = buildRecurringInitial(recurringWith({ endExpression: 'until I cancel' }), now);
    expect(init.endDate).toBeUndefined();
    expect(recurringEndNote(recurringWith({ endExpression: 'until I cancel' }), now)).toBeNull();
  });

  it('warns rather than silently defaulting when the wording cannot be understood', () => {
    const op = recurringWith({ endExpression: 'until things settle down' });
    expect(buildRecurringInitial(op, now).endDate).toBeUndefined();
    expect(recurringEndNote(op, now)).toMatch(/could not turn that into an end date/);
  });

  it('says nothing when there was no end condition to resolve', () => {
    expect(recurringEndNote(recurringWith({}), now)).toBeNull();
  });
});
