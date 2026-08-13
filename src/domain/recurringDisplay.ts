/**
 * Presentation helpers for the Recurring screens — pure string/label logic
 * shared by the list, detail, and form so wording never drifts between them.
 * Kept out of the components (and free of theme/React) so it can be unit-tested.
 */
import { differenceInCalendarDays, format, parseISO } from 'date-fns';

import type { RecurringFrequency, RecurringGroup, RecurringTemplate } from '@/domain/types';

export const GROUP_OPTIONS: { id: RecurringGroup; label: string }[] = [
  { id: 'subscription', label: 'Subscription' },
  { id: 'bill', label: 'Bill' },
  { id: 'rent', label: 'Rent' },
  { id: 'loan', label: 'Loan' },
  { id: 'other', label: 'Other' },
];

/** Plural legend label for the summary bar (e.g. 'Subscriptions'). */
export function groupLegendLabel(group: RecurringGroup): string {
  switch (group) {
    case 'subscription':
      return 'Subscriptions';
    case 'bill':
      return 'Bills';
    case 'rent':
      return 'Rent';
    case 'loan':
      return 'Loans';
    case 'other':
      return 'Other';
  }
}

/** Short cadence word for a list-row caption, e.g. "Monthly". */
export function frequencyLabel(frequency: RecurringFrequency, intervalDays?: number): string {
  switch (frequency) {
    case 'daily':
      return 'Daily';
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    case 'custom':
      return intervalDays ? `Every ${intervalDays} days` : 'Custom';
  }
}

/** ordinal(14) → "14th" — used in "every month on the 14th". */
function ordinal(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}

/** Full cadence phrase for the detail screen, e.g. "every month on the 14th". */
export function repeatsPhrase(t: Pick<RecurringTemplate, 'frequency' | 'intervalDays' | 'nextDueDate'>): string {
  const due = parseISO(t.nextDueDate);
  switch (t.frequency) {
    case 'daily':
      return 'every day';
    case 'weekly':
      return `every week on ${format(due, 'EEEE')}`;
    case 'monthly':
      return `every month on the ${ordinal(due.getDate())}`;
    case 'custom':
      return t.intervalDays ? `every ${t.intervalDays} days` : 'on a custom schedule';
  }
}

/** Sentence-case cadence for a details row, e.g. "Monthly on the 14th". */
export function repeatsRowLabel(t: Pick<RecurringTemplate, 'frequency' | 'intervalDays' | 'nextDueDate'>): string {
  const due = parseISO(t.nextDueDate);
  switch (t.frequency) {
    case 'daily':
      return 'Daily';
    case 'weekly':
      return `Weekly on ${format(due, 'EEEE')}`;
    case 'monthly':
      return `Monthly on the ${ordinal(due.getDate())}`;
    case 'custom':
      return t.intervalDays ? `Every ${t.intervalDays} days` : 'Custom';
  }
}

export interface DueEyebrow {
  /** Uppercase section label, e.g. "TOMORROW", "IN 3 DAYS", "OVERDUE". */
  lead: string;
  /** Formatted calendar date, e.g. "14 AUG" (uppercased by caller if desired). */
  dateLabel: string;
  /** True when the date should be appended to the lead (recent / imminent). */
  showDate: boolean;
}

/**
 * Relative label for a due date, income-agnostic. Groups the list into
 * "TODAY / TOMORROW / IN N DAYS · <date>" for the next week, plain "<date>"
 * beyond, and "OVERDUE · <date>" for anything already past.
 */
export function dueEyebrow(nextDueISO: string, todayISO: string): DueEyebrow {
  const days = differenceInCalendarDays(parseISO(nextDueISO), parseISO(todayISO));
  const dateLabel = format(parseISO(nextDueISO), 'd MMM');
  if (days < 0) return { lead: 'OVERDUE', dateLabel, showDate: true };
  if (days === 0) return { lead: 'TODAY', dateLabel, showDate: true };
  if (days === 1) return { lead: 'TOMORROW', dateLabel, showDate: true };
  if (days <= 7) return { lead: `IN ${days} DAYS`, dateLabel, showDate: true };
  return { lead: dateLabel, dateLabel, showDate: false };
}

/** Compact "Due tomorrow" / "Due in 3 days" / "Overdue" for the detail pill. */
export function dueShortLabel(nextDueISO: string, todayISO: string, expected: boolean): string {
  const days = differenceInCalendarDays(parseISO(nextDueISO), parseISO(todayISO));
  const verb = expected ? 'Expected' : 'Due';
  if (days < 0) return expected ? 'Overdue' : 'Overdue';
  if (days === 0) return `${verb} today`;
  if (days === 1) return `${verb} tomorrow`;
  if (days <= 7) return `${verb} in ${days} days`;
  return `${verb} ${format(parseISO(nextDueISO), 'd MMM')}`;
}
