/**
 * Report periods — pure date logic for the Reports tab (no DB, no React), so
 * the range maths is unit-testable (technical-plan.md §8).
 *
 * A period is a preset (daily/weekly/monthly/yearly/custom) plus an anchor
 * date; the anchor expands into an inclusive local day range. Everything
 * downstream — SQL filters, the trend chart's buckets, "average per day" —
 * reads that range, so the whole screen moves as one when the user shifts the
 * period or picks a custom range in the filter sheet.
 *
 * Days are local 'yyyy-MM-dd' strings and both ends are INCLUSIVE, matching
 * the `date(occurred_at, 'localtime') BETWEEN ? AND ?` convention in
 * `db/queries/reports.ts` (timestamps are stored UTC; a 1 a.m. purchase must
 * belong to the local day).
 */
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  isSameMonth,
  isSameYear,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns';

/** Weeks run Monday→Sunday. */
const WEEK_OPTS = { weekStartsOn: 1 } as const;

export type RangePreset = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

/** Presets the period arrows can step through (custom steps by its length). */
export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export interface DateRange {
  /** Local 'yyyy-MM-dd', inclusive. */
  startDay: string;
  /** Local 'yyyy-MM-dd', inclusive. */
  endDay: string;
}

export interface Period {
  preset: RangePreset;
  /** A date inside the period; presets expand it, custom ignores it. */
  anchor: Date;
  range: DateRange;
}

/** Date → local 'yyyy-MM-dd'. */
export function toDay(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/** Local 'yyyy-MM-dd' → local midnight Date. */
export function fromDay(day: string): Date {
  return parseISO(day);
}

/** Expand a preset + anchor into its inclusive day range. */
export function rangeForPreset(preset: Exclude<RangePreset, 'custom'>, anchor: Date): DateRange {
  switch (preset) {
    case 'daily':
      return { startDay: toDay(anchor), endDay: toDay(anchor) };
    case 'weekly':
      return {
        startDay: toDay(startOfWeek(anchor, WEEK_OPTS)),
        endDay: toDay(endOfWeek(anchor, WEEK_OPTS)),
      };
    case 'monthly':
      return { startDay: toDay(startOfMonth(anchor)), endDay: toDay(endOfMonth(anchor)) };
    case 'yearly':
      return { startDay: toDay(startOfYear(anchor)), endDay: toDay(endOfYear(anchor)) };
  }
}

export function periodFor(preset: Exclude<RangePreset, 'custom'>, anchor: Date): Period {
  return { preset, anchor, range: rangeForPreset(preset, anchor) };
}

/** A hand-picked range. The anchor is its first day so labels stay sensible. */
export function customPeriod(startDay: string, endDay: string): Period {
  const [a, b] = startDay <= endDay ? [startDay, endDay] : [endDay, startDay];
  return { preset: 'custom', anchor: fromDay(a), range: { startDay: a, endDay: b } };
}

/** Step the period forward (+1) or back (−1). Custom steps by its own length. */
export function shiftPeriod(period: Period, delta: number): Period {
  switch (period.preset) {
    case 'daily':
      return periodFor('daily', addDays(period.anchor, delta));
    case 'weekly':
      return periodFor('weekly', addWeeks(period.anchor, delta));
    case 'monthly':
      return periodFor('monthly', addMonths(period.anchor, delta));
    case 'yearly':
      return periodFor('yearly', addYears(period.anchor, delta));
    case 'custom': {
      const span = dayCount(period.range);
      return customPeriod(
        toDay(addDays(fromDay(period.range.startDay), span * delta)),
        toDay(addDays(fromDay(period.range.endDay), span * delta)),
      );
    }
  }
}

/** Number of days the range covers (inclusive of both ends). */
export function dayCount(range: DateRange): number {
  return differenceInCalendarDays(fromDay(range.endDay), fromDay(range.startDay)) + 1;
}

/**
 * The equally-long range immediately before this one — the baseline for the
 * "was Rs…" comparison on the summary card.
 */
export function previousRange(range: DateRange): DateRange {
  const span = dayCount(range);
  const end = addDays(fromDay(range.startDay), -1);
  return { startDay: toDay(addDays(end, -(span - 1))), endDay: toDay(end) };
}

/**
 * Days of the range that have actually happened, for "average per day": a
 * half-finished month must not be divided by 31. Never returns 0.
 */
export function elapsedDays(range: DateRange, today: Date): number {
  const total = dayCount(range);
  const sinceStart = differenceInCalendarDays(today, fromDay(range.startDay)) + 1;
  return Math.max(1, Math.min(total, sinceStart));
}

/** True when the whole range lies after today — used to disable the › arrow. */
export function isFuturePeriod(period: Period, today: Date): boolean {
  return fromDay(period.range.startDay) > today;
}

/** Human label for the period switcher: "August 2026", "11–17 Aug 2026", … */
export function rangeLabel(period: Period): string {
  const start = fromDay(period.range.startDay);
  const end = fromDay(period.range.endDay);
  switch (period.preset) {
    case 'daily':
      return format(start, 'd MMMM yyyy');
    case 'monthly':
      return format(start, 'MMMM yyyy');
    case 'yearly':
      return format(start, 'yyyy');
    case 'weekly':
    case 'custom':
      break;
  }
  if (period.range.startDay === period.range.endDay) return format(start, 'd MMM yyyy');
  if (isSameMonth(start, end)) return `${format(start, 'd')}–${format(end, 'd MMM yyyy')}`;
  if (isSameYear(start, end)) return `${format(start, 'd MMM')} – ${format(end, 'd MMM yyyy')}`;
  return `${format(start, 'd MMM yyyy')} – ${format(end, 'd MMM yyyy')}`;
}

// ---------------------------------------------------------------------------
// Trend-chart buckets
// ---------------------------------------------------------------------------

export type Granularity = 'day' | 'week' | 'month';

/** Keep the bar count readable: days up to ~2 months, then weeks, then months. */
export function granularityFor(range: DateRange): Granularity {
  const days = dayCount(range);
  if (days <= 62) return 'day';
  if (days <= 366) return 'week';
  return 'month';
}

export interface Bucket {
  key: string;
  /** Axis label ("14", "4 Aug", "Aug"). */
  label: string;
  startDay: string;
  endDay: string;
}

/** Contiguous buckets covering the range, clipped to its ends. */
export function buildBuckets(range: DateRange, granularity: Granularity): Bucket[] {
  const buckets: Bucket[] = [];
  let cursorDay = range.startDay;
  let guard = 0;

  // Day strings compare lexicographically, so stepping on them (rather than on
  // Dates) sidesteps end-of-day times and DST shifts entirely.
  while (cursorDay <= range.endDay && guard++ < 800) {
    const cursor = fromDay(cursorDay);
    let bucketEndDay: string;
    let label: string;
    switch (granularity) {
      case 'day':
        bucketEndDay = cursorDay;
        label = format(cursor, 'd');
        break;
      case 'week':
        bucketEndDay = toDay(endOfWeek(cursor, WEEK_OPTS));
        label = format(cursor, 'd MMM');
        break;
      case 'month':
        bucketEndDay = toDay(endOfMonth(cursor));
        label = format(cursor, 'MMM');
        break;
    }
    const endDay = bucketEndDay > range.endDay ? range.endDay : bucketEndDay;
    buckets.push({ key: cursorDay, label, startDay: cursorDay, endDay });
    cursorDay = toDay(addDays(fromDay(endDay), 1));
  }

  return buckets;
}

/** Index of the bucket a given day falls in, or -1. Buckets are contiguous. */
export function bucketIndexForDay(buckets: Bucket[], day: string): number {
  return buckets.findIndex((b) => day >= b.startDay && day <= b.endDay);
}
