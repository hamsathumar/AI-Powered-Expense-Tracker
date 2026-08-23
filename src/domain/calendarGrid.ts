/**
 * Calendar grid + range-selection logic for the filter sheet's date picker.
 * Pure (no React, no DB) so the awkward parts — month padding, leap years,
 * what a second tap means — are unit-tested rather than eyeballed on device.
 *
 * Weeks run Monday→Sunday to match the "Weekly" period preset in
 * `reportRange.ts`; a week selected on this calendar lines up with the week
 * that preset would produce.
 */
import { endOfMonth, getDay, startOfMonth } from 'date-fns';

import { toDay } from '@/domain/reportRange';

/** Monday-first, matching `reportRange`'s week convention. */
export const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/** A cell is a local 'yyyy-MM-dd', or null for padding outside the month. */
export type CalendarCell = string | null;

/**
 * The month laid out as weeks. Leading/trailing padding keeps every row seven
 * cells wide so the grid aligns under the weekday header.
 */
export function monthGrid(anchor: Date): CalendarCell[][] {
  const first = startOfMonth(anchor);
  const lastDate = endOfMonth(anchor).getDate();

  // date-fns getDay is Sunday=0; shift so Monday=0.
  const leading = (getDay(first) + 6) % 7;
  const cells: CalendarCell[] = new Array(leading).fill(null);

  for (let date = 1; date <= lastDate; date += 1) {
    cells.push(toDay(new Date(anchor.getFullYear(), anchor.getMonth(), date)));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/** A range being built: `endDay` is null between the first and second tap. */
export interface RangeSelection {
  startDay: string;
  endDay: string | null;
}

/**
 * What a tap on `day` does.
 *
 * Tapping with a complete range starts a new one — otherwise you could never
 * pick an earlier start without a separate "reset". Tapping before the pending
 * start also restarts, rather than producing a backwards range.
 */
export function nextRangeSelection(current: RangeSelection, day: string): RangeSelection {
  if (current.endDay != null) return { startDay: day, endDay: null };
  if (day < current.startDay) return { startDay: day, endDay: null };
  return { startDay: current.startDay, endDay: day };
}

/** Is this day inside the selection (inclusive of both ends)? */
export function isWithinSelection(day: string, selection: RangeSelection): boolean {
  if (selection.endDay == null) return day === selection.startDay;
  return day >= selection.startDay && day <= selection.endDay;
}

/** Is this day one of the two draggable ends? */
export function isSelectionEdge(day: string, selection: RangeSelection): boolean {
  return day === selection.startDay || day === selection.endDay;
}
