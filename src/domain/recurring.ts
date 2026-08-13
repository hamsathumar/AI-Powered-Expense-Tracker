/**
 * Recurring due-date evaluation (technical-plan §4.5) — pure planning logic.
 *
 * Dates are 'yyyy-MM-dd' strings (lexically comparable). The DB layer applies
 * a plan by inserting one pending transaction per run date (guarded against
 * duplicates) and storing the advanced nextDueDate — so planning again after
 * applying yields no runs: generation is idempotent.
 */
import { addDays, addMonths, addWeeks, format, parseISO } from 'date-fns';

import type { RecurringFrequency } from '@/domain/types';

/** Safety cap on catch-up generation after long absences (~2 months daily). */
const MAX_RUNS = 62;

export function advanceDueDate(
  dateISO: string,
  frequency: RecurringFrequency,
  intervalDays?: number,
): string {
  const date = parseISO(dateISO);
  switch (frequency) {
    case 'daily':
      return format(addDays(date, 1), 'yyyy-MM-dd');
    case 'weekly':
      return format(addWeeks(date, 1), 'yyyy-MM-dd');
    case 'monthly':
      return format(addMonths(date, 1), 'yyyy-MM-dd');
    case 'custom': {
      if (!intervalDays || intervalDays < 1) {
        throw new Error('Custom frequency needs intervalDays >= 1');
      }
      return format(addDays(date, intervalDays), 'yyyy-MM-dd');
    }
  }
}

/**
 * Whether the current period has already been settled by an approved payment.
 *
 * Deriving this from `nextDueDate` vs today alone is ambiguous — a future
 * `nextDueDate` means "due soon, unpaid" just as often as "paid, next period".
 * The clean, frequency-agnostic signal: advance the LATEST approved payment's
 * due date by one step; if it lands exactly on `nextDueDate`, that payment is
 * the one that produced the current schedule position → this period is paid.
 * When time rolls on and the next occurrence is generated (advancing
 * `nextDueDate` again), the equality breaks and the period reads unpaid again.
 *
 * `lastApprovedDueISO` is the 'yyyy-MM-dd' due date of the most recent approved
 * transaction for the template (null if there are none).
 */
export function isCurrentPeriodPaid(
  schedule: { frequency: RecurringFrequency; intervalDays?: number; nextDueDate: string },
  lastApprovedDueISO: string | null,
): boolean {
  if (!lastApprovedDueISO) return false;
  return (
    advanceDueDate(lastApprovedDueISO, schedule.frequency, schedule.intervalDays) ===
    schedule.nextDueDate
  );
}

export interface DueSchedule {
  frequency: RecurringFrequency;
  intervalDays?: number;
  nextDueDate: string;
  endDate?: string;
  active: boolean;
}

export interface DuePlan {
  /** Due dates to generate, oldest first (catch-up after absences). */
  runDates: string[];
  /** The advanced nextDueDate to store back. */
  nextDueDate: string;
  /** False once past endDate — deactivate the template. */
  stillActive: boolean;
}

/**
 * Average days per month (365 / 12). Used to normalise weekly/daily/custom
 * cadences to a comparable monthly figure for the summary + forecast. Kept as
 * a shared constant so both Recurring tabs and the group bar agree.
 */
const DAYS_PER_MONTH = 365 / 12;

export interface MonthlyCadence {
  frequency: RecurringFrequency;
  intervalDays?: number;
  amountMinor: number;
}

/**
 * A template's amount normalised to "per month", in integer minor units.
 * Money never becomes a float: we round the normalised figure to the nearest
 * cent. Malformed custom intervals contribute 0 rather than NaN.
 */
export function monthlyAmountMinor(t: MonthlyCadence): number {
  switch (t.frequency) {
    case 'monthly':
      return t.amountMinor;
    case 'daily':
      return Math.round(t.amountMinor * DAYS_PER_MONTH);
    case 'weekly':
      return Math.round((t.amountMinor * DAYS_PER_MONTH) / 7);
    case 'custom': {
      if (!t.intervalDays || t.intervalDays < 1) return 0;
      return Math.round((t.amountMinor * DAYS_PER_MONTH) / t.intervalDays);
    }
  }
}

/**
 * Advance a due date forward to the first occurrence on/after `floorISO`
 * WITHOUT emitting any runs — used when resuming a paused template so the
 * gap spent paused isn't retroactively back-generated. Bounded so a corrupt
 * schedule can't spin forever.
 */
export function rollDueDateForward(
  dateISO: string,
  frequency: RecurringFrequency,
  intervalDays: number | undefined,
  floorISO: string,
): string {
  let next = dateISO;
  let guard = 0;
  while (next < floorISO && guard < 4000) {
    next = advanceDueDate(next, frequency, intervalDays);
    guard += 1;
  }
  return next;
}

export function planDueRuns(schedule: DueSchedule, todayISO: string): DuePlan {
  if (!schedule.active) {
    return { runDates: [], nextDueDate: schedule.nextDueDate, stillActive: false };
  }

  const runDates: string[] = [];
  let next = schedule.nextDueDate;
  while (
    next <= todayISO &&
    (!schedule.endDate || next <= schedule.endDate) &&
    runDates.length < MAX_RUNS
  ) {
    runDates.push(next);
    next = advanceDueDate(next, schedule.frequency, schedule.intervalDays);
  }

  const stillActive = !schedule.endDate || next <= schedule.endDate;
  return { runDates, nextDueDate: next, stillActive };
}
