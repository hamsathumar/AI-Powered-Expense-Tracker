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
