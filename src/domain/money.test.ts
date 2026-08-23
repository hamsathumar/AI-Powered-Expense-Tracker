import { describe, expect, it } from '@jest/globals';

import { formatCompactMinor, formatPercent } from './money';

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
