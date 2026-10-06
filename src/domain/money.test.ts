import { describe, expect, it } from '@jest/globals';

import { accountBalanceMinor } from './rules';
import type { Transaction } from './types';
import {
  applyBalanceSign,
  formatCompactMinor,
  formatPercent,
  parseAmountInput,
  splitBalanceSign,
} from './money';

describe('formatCompactMinor', () => {
  it('leaves small amounts whole', () => {
    expect(formatCompactMinor(0)).toBe('0');
    expect(formatCompactMinor(4500)).toBe('45');
    expect(formatCompactMinor(99_900)).toBe('999');
  });

  it('abbreviates thousands, with one decimal below 10K', () => {
    expect(formatCompactMinor(125_050)).toBe('1.3K');
    expect(formatCompactMinor(5_000_000)).toBe('50K');
  });

  it('abbreviates millions', () => {
    expect(formatCompactMinor(250_000_000)).toBe('2.5M');
    expect(formatCompactMinor(1_500_000_000)).toBe('15M');
  });

  it('is unsigned — direction comes from the chart, not the label', () => {
    expect(formatCompactMinor(-5_000_000)).toBe('50K');
  });
});

describe('formatPercent', () => {
  it('rounds to whole percent by default', () => {
    expect(formatPercent(0.1234)).toBe('12%');
    expect(formatPercent(1)).toBe('100%');
  });

  it('can keep a decimal', () => {
    expect(formatPercent(0.218, 1)).toBe('21.8%');
  });
});

describe('opening balance sign', () => {
  it('joins magnitude and sign', () => {
    expect(applyBalanceSign(12550, true)).toBe(-12550);
    expect(applyBalanceSign(12550, false)).toBe(12550);
  });

  it('never produces negative zero', () => {
    expect(Object.is(applyBalanceSign(0, true), 0)).toBe(true);
  });

  it('splits a stored balance back so an edit round-trips', () => {
    expect(splitBalanceSign(-12550)).toEqual({ magnitudeMinor: 12550, negative: true });
    expect(splitBalanceSign(12550)).toEqual({ magnitudeMinor: 12550, negative: false });
    expect(splitBalanceSign(0)).toEqual({ magnitudeMinor: 0, negative: false });
  });

  it('round-trips through the typed field', () => {
    const stored = -1234567;
    const { magnitudeMinor, negative } = splitBalanceSign(stored);
    expect(applyBalanceSign(parseAmountInput('12,345.67', { allowZero: true })!, negative)).toBe(stored);
    expect(magnitudeMinor).toBe(1234567);
  });

  it('flows through account balance math: a card starting in debt', () => {
    const opening = applyBalanceSign(50000, true); // owes 500.00
    const income: Transaction = {
      id: 'i', type: 'income', status: 'approved', name: 'refund', amountMinor: 20000,
      occurredAt: '2026-08-09T12:00:00.000Z', source: 'manual', confidenceFlags: [],
      createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-09T12:00:00.000Z',
      accountId: 'card', categoryId: 'c',
    };
    expect(accountBalanceMinor(opening, [income], 'card')).toBe(-30000);
    expect(accountBalanceMinor(opening, [], 'card')).toBe(-50000);
  });
});
