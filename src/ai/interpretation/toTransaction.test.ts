import { describe, expect, it } from '@jest/globals';

import { toNewTransaction } from './toTransaction';
import type { ResolvedOperation } from './types';

/** 8:15am — the sort of time breakfast actually gets recorded. */
const MORNING = '2026-08-24T02:45:00.000Z';
/** 11:30pm the same day — when the queue actually gets reviewed. */
const NIGHT = '2026-08-24T18:00:00.000Z';

function op(partial: Partial<ResolvedOperation> = {}): ResolvedOperation {
  return {
    operation: 'expense',
    name: 'Breakfast',
    amountMinor: 50_000,
    dateExpression: null,
    account: { reference: 'cash', id: 'a1', status: 'resolved', options: [] },
    toAccount: { reference: null, id: null, status: 'unresolved', options: [] },
    category: { reference: 'food', id: 'c1', status: 'resolved', options: [] },
    person: { reference: null, id: null, status: 'unresolved', options: [] },
    direction: null,
    ...partial,
  } as ResolvedOperation;
}

describe('toNewTransaction date semantics', () => {
  it('stamps an undated operation with when it was CAPTURED, not approved', () => {
    // The bug this guards: a morning transaction approved at night was stored
    // at the approval time, so the whole day's queue collapsed onto 11pm.
    const tx = toNewTransaction(op(), MORNING);
    expect(tx.occurredAt).toBe(MORNING);
  });

  it('resolves "today" to the capture day, not the approval day', () => {
    const tx = toNewTransaction(op({ dateExpression: 'today' }), MORNING);
    expect(tx.occurredAt).toBe(MORNING);
  });

  it('resolves "yesterday" relative to capture', () => {
    // Said on the 24th, so it means the 23rd — regardless of when it is
    // approved. Resolving at approval time could shift it a whole day.
    const tx = toNewTransaction(op({ dateExpression: 'yesterday' }), MORNING);
    expect(tx.occurredAt.slice(0, 10)).toBe('2026-08-23');
  });

  it('gives a different answer than resolving at approval time would', () => {
    const captured = toNewTransaction(op(), MORNING);
    const approved = toNewTransaction(op(), NIGHT);
    expect(captured.occurredAt).not.toBe(approved.occurredAt);
  });

  it('falls back to now rather than storing an Invalid Date', () => {
    const tx = toNewTransaction(op(), 'not-a-timestamp');
    expect(Number.isNaN(new Date(tx.occurredAt).getTime())).toBe(false);
  });
});

describe('toNewTransaction shape', () => {
  it('commits as approved, from voice, with a positive amount', () => {
    const tx = toNewTransaction(op(), MORNING);
    expect(tx.status).toBe('approved');
    expect(tx.source).toBe('voice');
    expect(tx.amountMinor).toBe(50_000);
  });

  it('maps an expense to its account and category', () => {
    const tx = toNewTransaction(op(), MORNING);
    expect(tx).toMatchObject({ type: 'expense', accountId: 'a1', categoryId: 'c1' });
  });

  it('maps a transfer to both accounts', () => {
    const tx = toNewTransaction(
      op({
        operation: 'transfer',
        toAccount: { reference: 'boc', id: 'a2', status: 'resolved', options: [] },
      }),
      MORNING,
    );
    expect(tx).toMatchObject({ type: 'transfer', accountId: 'a1', toAccountId: 'a2' });
  });

  it('maps lending to its person and direction', () => {
    const tx = toNewTransaction(
      op({
        operation: 'lending',
        direction: 'lend',
        person: { reference: 'mateen', id: 'p1', status: 'resolved', options: [] },
      }),
      MORNING,
    );
    expect(tx).toMatchObject({ type: 'lending', accountId: 'a1', personId: 'p1', direction: 'lend' });
  });
});
