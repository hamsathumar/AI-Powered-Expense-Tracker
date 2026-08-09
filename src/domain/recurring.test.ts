/** Recurring evaluation tests (technical-plan §8): idempotent, no duplicates. */
import { describe, expect, it } from '@jest/globals';

import { advanceDueDate, planDueRuns } from './recurring';

describe('advanceDueDate', () => {
  it('advances by each frequency', () => {
    expect(advanceDueDate('2026-08-09', 'daily')).toBe('2026-08-10');
    expect(advanceDueDate('2026-08-09', 'weekly')).toBe('2026-08-16');
    expect(advanceDueDate('2026-08-09', 'monthly')).toBe('2026-09-09');
    expect(advanceDueDate('2026-08-09', 'custom', 10)).toBe('2026-08-19');
  });

  it('handles month-end clamping', () => {
    expect(advanceDueDate('2026-01-31', 'monthly')).toBe('2026-02-28');
  });

  it('rejects custom without a valid interval', () => {
    expect(() => advanceDueDate('2026-08-09', 'custom')).toThrow();
  });
});

describe('planDueRuns', () => {
  it('generates nothing before the due date', () => {
    const plan = planDueRuns(
      { frequency: 'monthly', nextDueDate: '2026-09-01', active: true },
      '2026-08-09',
    );
    expect(plan.runDates).toEqual([]);
    expect(plan.nextDueDate).toBe('2026-09-01');
  });

  it('catches up all missed occurrences after an absence', () => {
    const plan = planDueRuns(
      { frequency: 'monthly', nextDueDate: '2026-05-01', active: true },
      '2026-08-09',
    );
    expect(plan.runDates).toEqual(['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01']);
    expect(plan.nextDueDate).toBe('2026-09-01');
    expect(plan.stillActive).toBe(true);
  });

  it('is idempotent: re-planning after applying yields no runs', () => {
    const first = planDueRuns(
      { frequency: 'weekly', nextDueDate: '2026-08-01', active: true },
      '2026-08-09',
    );
    expect(first.runDates.length).toBeGreaterThan(0);
    const second = planDueRuns(
      { frequency: 'weekly', nextDueDate: first.nextDueDate, active: true },
      '2026-08-09',
    );
    expect(second.runDates).toEqual([]);
  });

  it('stops at endDate and deactivates', () => {
    const plan = planDueRuns(
      { frequency: 'monthly', nextDueDate: '2026-05-01', endDate: '2026-06-30', active: true },
      '2026-08-09',
    );
    expect(plan.runDates).toEqual(['2026-05-01', '2026-06-01']);
    expect(plan.stillActive).toBe(false);
  });

  it('inactive templates generate nothing', () => {
    const plan = planDueRuns(
      { frequency: 'daily', nextDueDate: '2026-08-01', active: false },
      '2026-08-09',
    );
    expect(plan.runDates).toEqual([]);
  });
});
