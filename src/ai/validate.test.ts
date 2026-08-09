/**
 * Validation-layer tests — the LLM output is untrusted, so this is where a
 * bad parse must be caught, resolved, or flagged (never blindly inserted).
 */
import { describe, expect, it } from '@jest/globals';

import type { RawParsedTransaction } from './prompt';
import { buildVoiceDraft, type VoiceContext } from './validate';

const ctx: VoiceContext = {
  accounts: [
    { id: 'acc-cash', name: 'Cash', type: 'cash', openingBalanceMinor: 0, archived: false, createdAt: 'x' },
    { id: 'acc-bank', name: 'Commercial Bank', type: 'bank', openingBalanceMinor: 0, archived: false, createdAt: 'x' },
  ],
  expenseCategories: [
    { id: 'cat-food', name: 'Food', kind: 'expense', isDefault: true, archived: false },
    { id: 'cat-other', name: 'Other', kind: 'expense', isDefault: true, archived: false },
  ],
  incomeCategories: [
    { id: 'cat-salary', name: 'Salary', kind: 'income', isDefault: true, archived: false },
  ],
  people: [{ id: 'p-kamal', name: 'Kamal', unresolved: false, createdAt: 'x' }],
};

function raw(over: Partial<RawParsedTransaction>): RawParsedTransaction {
  return {
    type: 'expense',
    name: 'Lunch',
    amount: 200,
    currency: 'LKR',
    category: 'Food',
    account: 'Cash',
    toAccount: null,
    person: null,
    direction: null,
    transcript: 'spent two hundred on lunch',
    confidence_flags: [],
    ...over,
  };
}

describe('amount handling', () => {
  it('converts major units to integer minor units', () => {
    const result = buildVoiceDraft(raw({ amount: 200 }), ctx);
    expect(result.ok && result.draft.amountMinor).toBe(20000);
  });

  it('rounds floating cents correctly', () => {
    const result = buildVoiceDraft(raw({ amount: 19.99 }), ctx);
    expect(result.ok && result.draft.amountMinor).toBe(1999);
  });

  it('rejects a non-positive or non-finite amount', () => {
    expect(buildVoiceDraft(raw({ amount: 0 }), ctx).ok).toBe(false);
    expect(buildVoiceDraft(raw({ amount: -5 }), ctx).ok).toBe(false);
    expect(buildVoiceDraft(raw({ amount: NaN }), ctx).ok).toBe(false);
  });
});

describe('entity resolution', () => {
  it('resolves account and category by name, case-insensitively', () => {
    const result = buildVoiceDraft(raw({ account: 'cash', category: 'food' }), ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.accountId).toBe('acc-cash');
      expect(result.draft.categoryId).toBe('cat-food');
      expect(result.draft.confidenceFlags).toEqual([]);
    }
  });

  it('falls back + flags when the account is unknown', () => {
    const result = buildVoiceDraft(raw({ account: 'Mystery Wallet' }), ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.accountId).toBe('acc-cash'); // first account
      expect(result.draft.confidenceFlags).toContain('no_account_matched');
    }
  });

  it('falls back + flags when the category is unknown', () => {
    const result = buildVoiceDraft(raw({ category: 'Spaceships' }), ctx);
    expect(result.ok && result.draft.confidenceFlags).toContain('no_category_matched');
  });

  it('keeps only known confidence flags from the model', () => {
    const result = buildVoiceDraft(
      raw({ confidence_flags: ['low_confidence_amount', 'totally_made_up'] }),
      ctx,
    );
    expect(result.ok && result.draft.confidenceFlags).toEqual(['low_confidence_amount']);
  });
});

describe('lending', () => {
  it('resolves a known person', () => {
    const result = buildVoiceDraft(
      raw({ type: 'lending', person: 'Kamal', direction: 'lend', category: null, account: 'Cash' }),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.personId).toBe('p-kamal');
      expect(result.draft.direction).toBe('lend');
      expect(result.draft.unresolvedPersonName).toBeUndefined();
    }
  });

  it('keeps an unknown person verbatim and flags it', () => {
    const result = buildVoiceDraft(
      raw({ type: 'lending', person: 'Suresh', direction: 'lend' }),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.unresolvedPersonName).toBe('Suresh');
      expect(result.draft.personId).toBeUndefined();
      expect(result.draft.confidenceFlags).toContain('unrecognized_name');
    }
  });

  it('defaults an invalid direction to lend', () => {
    const result = buildVoiceDraft(
      raw({ type: 'lending', person: 'Kamal', direction: 'sideways' }),
      ctx,
    );
    expect(result.ok && result.draft.direction).toBe('lend');
  });

  it('fails when lending has no person at all', () => {
    const result = buildVoiceDraft(raw({ type: 'lending', person: null }), ctx);
    expect(result.ok).toBe(false);
  });
});

describe('transfer', () => {
  it('resolves two distinct accounts', () => {
    const result = buildVoiceDraft(
      raw({ type: 'transfer', account: 'Cash', toAccount: 'Commercial Bank', category: null }),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.accountId).toBe('acc-cash');
      expect(result.draft.toAccountId).toBe('acc-bank');
    }
  });

  it('picks a different account + flags when destination is unclear', () => {
    const result = buildVoiceDraft(
      raw({ type: 'transfer', account: 'Cash', toAccount: 'Cash' }),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.toAccountId).toBe('acc-bank');
      expect(result.draft.confidenceFlags).toContain('no_account_matched');
    }
  });
});

describe('hard failures', () => {
  it('rejects an unknown type', () => {
    expect(buildVoiceDraft(raw({ type: 'donation' }), ctx).ok).toBe(false);
  });

  it('rejects when no accounts exist', () => {
    expect(buildVoiceDraft(raw({}), { ...ctx, accounts: [] }).ok).toBe(false);
  });
});
