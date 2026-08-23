import { describe, expect, it } from '@jest/globals';

import {
  isSelectionEdge,
  isWithinSelection,
  monthGrid,
  nextRangeSelection,
  type RangeSelection,
} from './calendarGrid';
import { fromDay } from './reportRange';

describe('monthGrid', () => {
  it('pads so every row is a full week', () => {
    for (const month of ['2026-01-01', '2026-02-01', '2026-08-01', '2027-11-01']) {
      for (const row of monthGrid(fromDay(month))) {
        expect(row).toHaveLength(7);
      }
    }
  });

  it('puts the 1st in the right weekday column', () => {
    // 2026-08-01 is a Saturday → index 5 in a Monday-first week.
    const [firstRow] = monthGrid(fromDay('2026-08-01'));
    expect(firstRow.indexOf('2026-08-01')).toBe(5);
    expect(firstRow.slice(0, 5).every((cell) => cell === null)).toBe(true);
  });

  it('contains every day of the month exactly once, in order', () => {
    const days = monthGrid(fromDay('2026-08-15')).flat().filter(Boolean);
    expect(days).toHaveLength(31);
    expect(days[0]).toBe('2026-08-01');
    expect(days[30]).toBe('2026-08-31');
    expect([...days].sort()).toEqual(days);
  });

  it('handles a leap February', () => {
    const days = monthGrid(fromDay('2028-02-10')).flat().filter(Boolean);
    expect(days).toHaveLength(29);
    expect(days[28]).toBe('2028-02-29');
  });

  it('handles a non-leap February', () => {
    const days = monthGrid(fromDay('2026-02-10')).flat().filter(Boolean);
    expect(days).toHaveLength(28);
  });
});

describe('nextRangeSelection', () => {
  const pending: RangeSelection = { startDay: '2026-08-10', endDay: null };
  const complete: RangeSelection = { startDay: '2026-08-10', endDay: '2026-08-14' };

  it('closes a pending range on a later day', () => {
    expect(nextRangeSelection(pending, '2026-08-14')).toEqual({
      startDay: '2026-08-10',
      endDay: '2026-08-14',
    });
  });

  it('allows a single-day range', () => {
    expect(nextRangeSelection(pending, '2026-08-10')).toEqual({
      startDay: '2026-08-10',
      endDay: '2026-08-10',
    });
  });

  it('restarts rather than making a backwards range', () => {
    expect(nextRangeSelection(pending, '2026-08-03')).toEqual({
      startDay: '2026-08-03',
      endDay: null,
    });
  });

  it('starts a new range when one is already complete', () => {
    expect(nextRangeSelection(complete, '2026-08-20')).toEqual({
      startDay: '2026-08-20',
      endDay: null,
    });
  });

  it('can always reach an earlier start', () => {
    // Two taps from a complete range: restart, then close.
    const restarted = nextRangeSelection(complete, '2026-08-02');
    expect(nextRangeSelection(restarted, '2026-08-05')).toEqual({
      startDay: '2026-08-02',
      endDay: '2026-08-05',
    });
  });
});

describe('isWithinSelection', () => {
  const complete: RangeSelection = { startDay: '2026-08-10', endDay: '2026-08-14' };

  it('includes both ends and everything between', () => {
    expect(isWithinSelection('2026-08-10', complete)).toBe(true);
    expect(isWithinSelection('2026-08-12', complete)).toBe(true);
    expect(isWithinSelection('2026-08-14', complete)).toBe(true);
  });

  it('excludes days outside', () => {
    expect(isWithinSelection('2026-08-09', complete)).toBe(false);
    expect(isWithinSelection('2026-08-15', complete)).toBe(false);
  });

  it('matches only the start while the range is pending', () => {
    const pending: RangeSelection = { startDay: '2026-08-10', endDay: null };
    expect(isWithinSelection('2026-08-10', pending)).toBe(true);
    expect(isWithinSelection('2026-08-11', pending)).toBe(false);
  });
});

describe('isSelectionEdge', () => {
  it('is true only for the two ends', () => {
    const complete: RangeSelection = { startDay: '2026-08-10', endDay: '2026-08-14' };
    expect(isSelectionEdge('2026-08-10', complete)).toBe(true);
    expect(isSelectionEdge('2026-08-14', complete)).toBe(true);
    expect(isSelectionEdge('2026-08-12', complete)).toBe(false);
  });
});
