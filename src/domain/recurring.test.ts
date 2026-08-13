/** Recurring evaluation tests (technical-plan §8): idempotent, no duplicates. */
import { describe, expect, it } from '@jest/globals';

import {
  advanceDueDate,
  isCurrentPeriodPaid,
  monthlyAmountMinor,
  planDueRuns,
  rollDueDateForward,
} from './recurring';

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

describe('monthlyAmountMinor', () => {
  it('passes monthly cadence through unchanged', () => {
    expect(monthlyAmountMinor({ frequency: 'monthly', amountMinor: 189000 })).toBe(189000);
  });

  it('normalises weekly to ~4.33× and stays an integer', () => {
    const monthly = monthlyAmountMinor({ frequency: 'weekly', amountMinor: 100000 });
    expect(Number.isInteger(monthly)).toBe(true);
    expect(monthly).toBe(Math.round((100000 * 365) / 12 / 7));
  });

  it('normalises daily and custom intervals', () => {
    expect(monthlyAmountMinor({ frequency: 'daily', amountMinor: 1000 })).toBe(
      Math.round((1000 * 365) / 12),
    );
    expect(monthlyAmountMinor({ frequency: 'custom', intervalDays: 10, amountMinor: 5000 })).toBe(
      Math.round((5000 * 365) / 12 / 10),
    );
  });

  it('treats a malformed custom interval as zero, never NaN', () => {
    expect(monthlyAmountMinor({ frequency: 'custom', amountMinor: 5000 })).toBe(0);
  });
});

describe('isCurrentPeriodPaid', () => {
  const monthly = { frequency: 'monthly' as const, nextDueDate: '2026-09-14' };

  it('is false when there are no approved payments', () => {
    expect(isCurrentPeriodPaid(monthly, null)).toBe(false);
  });

  it('is true when the latest approved payment advances exactly onto nextDueDate', () => {
    // Paid the 14 Aug occurrence → nextDueDate moved to 14 Sep.
    expect(isCurrentPeriodPaid(monthly, '2026-08-14')).toBe(true);
  });

  it('is false once nextDueDate has rolled a further period ahead', () => {
    // Aug paid, but Sep already generated → nextDueDate is 14 Oct now.
    expect(
      isCurrentPeriodPaid({ frequency: 'monthly', nextDueDate: '2026-10-14' }, '2026-08-14'),
    ).toBe(false);
  });

  it('handles custom intervals', () => {
    const custom = { frequency: 'custom' as const, intervalDays: 10, nextDueDate: '2026-08-21' };
    expect(isCurrentPeriodPaid(custom, '2026-08-11')).toBe(true);
    expect(isCurrentPeriodPaid(custom, '2026-08-01')).toBe(false);
  });
});

describe('rollDueDateForward', () => {
  it('rolls a stale due date up to the first occurrence on/after the floor', () => {
    expect(rollDueDateForward('2026-05-01', 'monthly', undefined, '2026-08-09')).toBe('2026-09-01');
  });

  it('leaves a future due date untouched', () => {
    expect(rollDueDateForward('2026-10-01', 'monthly', undefined, '2026-08-09')).toBe('2026-10-01');
  });

  it('lands exactly on the floor when it coincides with an occurrence', () => {
    expect(rollDueDateForward('2026-08-01', 'weekly', undefined, '2026-08-15')).toBe('2026-08-15');
  });
});
