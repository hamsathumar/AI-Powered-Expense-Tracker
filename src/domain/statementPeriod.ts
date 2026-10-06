/**
 * The period a person's PDF statement covers. Presets are ROLLING windows
 * that end today (inclusive), shown to the user with their real dates so
 * "last week" is never ambiguous:
 *   lastDay   — today only
 *   lastWeek  — today and the 6 days before (7 days)
 *   lastMonth — the day after this date last month, through today
 *               (6 Oct → 7 Sep – 6 Oct)
 *   custom    — any inclusive range the user picks
 * Days are local 'yyyy-MM-dd' strings, like reportRange.ts.
 */
import { addDays, format, subDays, subMonths } from 'date-fns';

import { fromDay, toDay } from '@/domain/reportRange';

export type StatementPreset = 'lastMonth' | 'lastWeek' | 'lastDay' | 'custom';

export interface DayRange {
  startDay: string;
  endDay: string;
}

export const STATEMENT_PRESETS: { value: StatementPreset; label: string }[] = [
  { value: 'lastMonth', label: 'Last month' },
  { value: 'lastWeek', label: 'Last week' },
  { value: 'lastDay', label: 'Last 1 day' },
  { value: 'custom', label: 'Custom' },
];

export function statementPeriod(preset: Exclude<StatementPreset, 'custom'>, today: Date): DayRange {
  const endDay = toDay(today);
  switch (preset) {
    case 'lastDay':
      return { startDay: endDay, endDay };
    case 'lastWeek':
      return { startDay: toDay(subDays(today, 6)), endDay };
    case 'lastMonth':
      return { startDay: toDay(addDays(subMonths(today, 1), 1)), endDay };
  }
}

/** A range the user picked, put in order (the calendar can hand them back reversed). */
export function normalizeRange(a: string, b: string): DayRange {
  return a <= b ? { startDay: a, endDay: b } : { startDay: b, endDay: a };
}

/** "6 Oct 2026" or "7 Sep – 6 Oct 2026" / "28 Dec 2025 – 3 Jan 2026". */
export function describeRange({ startDay, endDay }: DayRange): string {
  const start = fromDay(startDay);
  const end = fromDay(endDay);
  if (startDay === endDay) return format(end, 'd MMM yyyy');
  const sameYear = start.getFullYear() === end.getFullYear();
  return `${format(start, sameYear ? 'd MMM' : 'd MMM yyyy')} – ${format(end, 'd MMM yyyy')}`;
}

/** File name for the shared PDF: safe on every filesystem, readable in Files. */
export function statementFilename(personName: string, { startDay, endDay }: DayRange): string {
  const safeName =
    personName
      .normalize('NFC')
      .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'person';
  return startDay === endDay
    ? `Kaasu-${safeName}-${startDay}.pdf`
    : `Kaasu-${safeName}-${startDay}-to-${endDay}.pdf`;
}
