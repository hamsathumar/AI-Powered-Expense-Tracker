import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  pendingOutcome,
  reconcileConfirmCards,
  recordPendingOutcome,
  resetPendingOutcomesForTests,
  subscribePendingOutcomes,
} from './pendingOutcomes';

beforeEach(resetPendingOutcomesForTests);

describe('pending outcome store', () => {
  it('remembers how each item was resolved', () => {
    recordPendingOutcome('a', 'approved');
    recordPendingOutcome('b', 'rejected');
    expect(pendingOutcome('a')).toBe('approved');
    expect(pendingOutcome('b')).toBe('rejected');
    expect(pendingOutcome('c')).toBeNull();
  });

  it('notifies subscribers, and stops after unsubscribe', () => {
    const listener = jest.fn();
    const off = subscribePendingOutcomes(listener);
    recordPendingOutcome('a', 'approved');
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    recordPendingOutcome('b', 'approved');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a listener that unsubscribes itself mid-notify does not break the others', () => {
    const second = jest.fn();
    const off = subscribePendingOutcomes(() => off());
    subscribePendingOutcomes(second);
    recordPendingOutcome('a', 'approved');
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('reconcileConfirmCards', () => {
  const card = (name: string) => ({ name });

  it('the bug: approved on the review screen → the card says approved, not "Approve now"', () => {
    const lastKnown = new Map([['x', card('Lunch')]]);
    recordPendingOutcome('x', 'approved');
    const cards = reconcileConfirmCards(['x'], new Map(), lastKnown);
    expect(cards).toEqual([{ id: 'x', state: 'approved', item: card('Lunch') }]);
  });

  it('edited but not approved → still pending, showing the EDITED content', () => {
    const lastKnown = new Map([['x', card('Lunch')]]);
    const live = new Map([['x', card('Lunch with Kamal')]]);
    expect(reconcileConfirmCards(['x'], live, lastKnown)).toEqual([
      { id: 'x', state: 'pending', item: card('Lunch with Kamal') },
    ]);
  });

  it('rejected and editor-saved outcomes come through', () => {
    const lastKnown = new Map([
      ['r', card('R')],
      ['s', card('S')],
    ]);
    recordPendingOutcome('r', 'rejected');
    recordPendingOutcome('s', 'saved');
    expect(reconcileConfirmCards(['r', 's'], new Map(), lastKnown).map((c) => c.state)).toEqual([
      'rejected',
      'saved',
    ]);
  });

  it('resolved with no recorded outcome reads as gone (never a dead action)', () => {
    const lastKnown = new Map([['x', card('X')]]);
    expect(reconcileConfirmCards(['x'], new Map(), lastKnown)[0]!.state).toBe('gone');
  });

  it('keeps capture order and skips ids never shown', () => {
    const lastKnown = new Map([
      ['a', card('A')],
      ['c', card('C')],
    ]);
    const live = new Map([['c', card('C2')]]);
    recordPendingOutcome('a', 'approved');
    expect(reconcileConfirmCards(['a', 'b', 'c'], live, lastKnown).map((c) => [c.id, c.state])).toEqual([
      ['a', 'approved'],
      ['c', 'pending'],
    ]);
  });
});
