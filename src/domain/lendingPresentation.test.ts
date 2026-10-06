import { describe, expect, it } from '@jest/globals';

import { lendingPresentation, netTone } from './lendingPresentation';
import { personNetBalanceMinor } from './rules';
import type { LendingDirection, Transaction } from './types';

const ALL: LendingDirection[] = [
  'lend',
  'lend_repayment_received',
  'borrow',
  'borrow_repayment_made',
];

function lending(direction: LendingDirection, amountMinor: number): Transaction {
  return {
    id: `t-${direction}`,
    type: 'lending',
    status: 'approved',
    name: 'x',
    amountMinor,
    occurredAt: '2026-08-09T12:00:00.000Z',
    source: 'manual',
    confidenceFlags: [],
    createdAt: '2026-08-09T12:00:00.000Z',
    updatedAt: '2026-08-09T12:00:00.000Z',
    accountId: 'a',
    personId: 'p',
    direction,
  };
}

describe('lendingPresentation', () => {
  it('gives every direction a distinct icon, so meaning never rides on colour alone', () => {
    const icons = ALL.map((d) => lendingPresentation(d).icon);
    expect(new Set(icons).size).toBe(4);
  });

  it('keeps lent and borrowed in separate tones; a repayment keeps its parent tone', () => {
    expect(lendingPresentation('lend').tone).toBe('lent');
    expect(lendingPresentation('lend_repayment_received').tone).toBe('lent');
    expect(lendingPresentation('borrow').tone).toBe('borrowed');
    expect(lendingPresentation('borrow_repayment_made').tone).toBe('borrowed');
  });

  it('flags only the two repayments', () => {
    expect(ALL.filter((d) => lendingPresentation(d).isRepayment)).toEqual([
      'lend_repayment_received',
      'borrow_repayment_made',
    ]);
  });

  it('sign always agrees with the direction of the person-balance math', () => {
    for (const d of ALL) {
      const effect = personNetBalanceMinor([lending(d, 700)], 'p');
      const sign = lendingPresentation(d).sign;
      expect(effect).toBe(sign === '+' ? 700 : -700);
    }
  });

  it('words each direction with the person', () => {
    expect(lendingPresentation('lend').label('Kamal')).toBe('Lent to Kamal');
    expect(lendingPresentation('lend_repayment_received').label('Kamal')).toBe('Kamal repaid you');
    expect(lendingPresentation('borrow').label('Kamal')).toBe('Borrowed from Kamal');
    expect(lendingPresentation('borrow_repayment_made').label('Kamal')).toBe('Repaid Kamal');
  });

  it('tones a net balance by who owes whom', () => {
    expect(netTone(1000)).toBe('lent');
    expect(netTone(-1000)).toBe('borrowed');
    expect(netTone(0)).toBeNull();
  });
});
