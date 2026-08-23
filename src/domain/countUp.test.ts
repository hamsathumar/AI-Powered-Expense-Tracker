import { describe, expect, it } from '@jest/globals';

import { countUpValue, easeOutCubic, shouldCountUp } from './countUp';

describe('easeOutCubic', () => {
  it('spans 0 to 1', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('decelerates — more than half the distance is covered by halfway', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it('never overshoots, so a money figure cannot bounce past its value', () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const eased = easeOutCubic(t);
      expect(eased).toBeGreaterThanOrEqual(0);
      expect(eased).toBeLessThanOrEqual(1);
    }
  });

  it('clamps out-of-range input', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe('countUpValue', () => {
  it('starts at the from value and lands exactly on the target', () => {
    expect(countUpValue(0, 125_050, 0)).toBe(0);
    expect(countUpValue(0, 125_050, 1)).toBe(125_050);
  });

  it('stays on whole minor units mid-flight', () => {
    for (let p = 0; p <= 1.0001; p += 0.07) {
      expect(Number.isInteger(countUpValue(0, 125_050, p))).toBe(true);
    }
  });

  it('counts down as well as up', () => {
    expect(countUpValue(100_000, 0, 1)).toBe(0);
    expect(countUpValue(100_000, 0, 0.5)).toBeLessThan(100_000);
  });

  it('handles negative targets (a negative balance)', () => {
    expect(countUpValue(0, -50_000, 1)).toBe(-50_000);
    expect(countUpValue(0, -50_000, 0.5)).toBeLessThan(0);
  });

  it('clamps progress outside 0–1', () => {
    expect(countUpValue(0, 1000, -0.5)).toBe(0);
    expect(countUpValue(0, 1000, 1.5)).toBe(1000);
  });
});

describe('shouldCountUp', () => {
  it('skips a no-op change', () => {
    expect(shouldCountUp(0, 0)).toBe(false);
    expect(shouldCountUp(500, 500)).toBe(false);
  });

  it('animates a real change', () => {
    expect(shouldCountUp(0, 500)).toBe(true);
  });
});
