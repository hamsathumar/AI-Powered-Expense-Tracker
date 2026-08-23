import { describe, expect, it } from '@jest/globals';

import {
  bucketIndexForDay,
  buildBuckets,
  customPeriod,
  dayCount,
  elapsedDays,
  fromDay,
  granularityFor,
  isFuturePeriod,
  periodFor,
  previousRange,
  rangeForPreset,
  rangeLabel,
  shiftPeriod,
  toDay,
} from './reportRange';

const at = (day: string) => fromDay(day);

describe('rangeForPreset', () => {
  it('daily is the single day', () => {
    expect(rangeForPreset('daily', at('2026-08-23'))).toEqual({
      startDay: '2026-08-23',
      endDay: '2026-08-23',
    });
  });

  it('weekly runs Monday to Sunday', () => {
    // 2026-08-23 is a Sunday.
    expect(rangeForPreset('weekly', at('2026-08-23'))).toEqual({
      startDay: '2026-08-17',
      endDay: '2026-08-23',
    });
  });

  it('monthly covers the whole calendar month', () => {
    expect(rangeForPreset('monthly', at('2026-02-14'))).toEqual({
      startDay: '2026-02-01',
      endDay: '2026-02-28',
    });
  });

  it('yearly covers the whole year', () => {
    expect(rangeForPreset('yearly', at('2026-08-23'))).toEqual({
      startDay: '2026-01-01',
      endDay: '2026-12-31',
    });
  });
});

describe('dayCount', () => {
  it('counts both ends', () => {
    expect(dayCount({ startDay: '2026-08-01', endDay: '2026-08-01' })).toBe(1);
    expect(dayCount({ startDay: '2026-08-01', endDay: '2026-08-31' })).toBe(31);
  });
});

describe('previousRange', () => {
  it('is the equally long window ending the day before', () => {
    expect(previousRange({ startDay: '2026-08-01', endDay: '2026-08-31' })).toEqual({
      startDay: '2026-07-01',
      endDay: '2026-07-31',
    });
  });

  it('handles a single day', () => {
    expect(previousRange({ startDay: '2026-08-23', endDay: '2026-08-23' })).toEqual({
      startDay: '2026-08-22',
      endDay: '2026-08-22',
    });
  });
});

describe('elapsedDays', () => {
  const august = { startDay: '2026-08-01', endDay: '2026-08-31' };

  it('counts only days up to today inside a running month', () => {
    expect(elapsedDays(august, at('2026-08-10'))).toBe(10);
  });

  it('uses the full range once the period is over', () => {
    expect(elapsedDays(august, at('2026-09-05'))).toBe(31);
  });

  it('never returns 0 for a future range', () => {
    expect(elapsedDays(august, at('2026-07-01'))).toBe(1);
  });
});

describe('shiftPeriod', () => {
  it('steps a month back', () => {
    const p = shiftPeriod(periodFor('monthly', at('2026-08-15')), -1);
    expect(p.range).toEqual({ startDay: '2026-07-01', endDay: '2026-07-31' });
  });

  it('steps a week forward', () => {
    const p = shiftPeriod(periodFor('weekly', at('2026-08-23')), 1);
    expect(p.range).toEqual({ startDay: '2026-08-24', endDay: '2026-08-30' });
  });

  it('steps a custom range by its own length', () => {
    const p = shiftPeriod(customPeriod('2026-08-10', '2026-08-19'), -1);
    expect(p.range).toEqual({ startDay: '2026-07-31', endDay: '2026-08-09' });
  });
});

describe('customPeriod', () => {
  it('orders reversed picks', () => {
    expect(customPeriod('2026-08-19', '2026-08-10').range).toEqual({
      startDay: '2026-08-10',
      endDay: '2026-08-19',
    });
  });
});

describe('isFuturePeriod', () => {
  it('is true only when the range starts after today', () => {
    expect(isFuturePeriod(periodFor('monthly', at('2026-09-01')), at('2026-08-23'))).toBe(true);
    expect(isFuturePeriod(periodFor('monthly', at('2026-08-01')), at('2026-08-23'))).toBe(false);
  });
});

describe('rangeLabel', () => {
  it('labels each preset', () => {
    expect(rangeLabel(periodFor('monthly', at('2026-08-05')))).toBe('August 2026');
    expect(rangeLabel(periodFor('yearly', at('2026-08-05')))).toBe('2026');
    expect(rangeLabel(periodFor('daily', at('2026-08-05')))).toBe('5 August 2026');
    expect(rangeLabel(periodFor('weekly', at('2026-08-23')))).toBe('17–23 Aug 2026');
  });

  it('spells out a cross-month custom range', () => {
    expect(rangeLabel(customPeriod('2026-07-28', '2026-08-04'))).toBe('28 Jul – 4 Aug 2026');
  });
});

describe('granularityFor', () => {
  it('uses days for short ranges, weeks for a year, months beyond', () => {
    expect(granularityFor({ startDay: '2026-08-01', endDay: '2026-08-31' })).toBe('day');
    expect(granularityFor({ startDay: '2026-01-01', endDay: '2026-12-31' })).toBe('week');
    expect(granularityFor({ startDay: '2024-01-01', endDay: '2026-12-31' })).toBe('month');
  });
});

describe('buildBuckets', () => {
  it('makes one bucket per day', () => {
    const buckets = buildBuckets({ startDay: '2026-08-01', endDay: '2026-08-31' }, 'day');
    expect(buckets).toHaveLength(31);
    expect(buckets[0]).toEqual({
      key: '2026-08-01',
      label: '1',
      startDay: '2026-08-01',
      endDay: '2026-08-01',
    });
  });

  it('clips the first and last week to the range', () => {
    // 2026-08-01 is a Saturday, so the first week ends immediately.
    const buckets = buildBuckets({ startDay: '2026-08-01', endDay: '2026-08-31' }, 'week');
    expect(buckets[0]).toMatchObject({ startDay: '2026-08-01', endDay: '2026-08-02' });
    expect(buckets[buckets.length - 1].endDay).toBe('2026-08-31');
  });

  it('covers the range contiguously with no gaps or overlaps', () => {
    const range = { startDay: '2026-02-10', endDay: '2026-05-04' };
    const buckets = buildBuckets(range, 'month');
    expect(buckets[0].startDay).toBe('2026-02-10');
    expect(buckets[buckets.length - 1].endDay).toBe('2026-05-04');
    for (let i = 1; i < buckets.length; i += 1) {
      const dayAfterPrevious = fromDay(buckets[i - 1].endDay);
      dayAfterPrevious.setDate(dayAfterPrevious.getDate() + 1);
      expect(buckets[i].startDay).toBe(toDay(dayAfterPrevious));
    }
  });
});

describe('bucketIndexForDay', () => {
  const buckets = buildBuckets({ startDay: '2026-08-01', endDay: '2026-08-31' }, 'week');

  it('finds the bucket containing a day', () => {
    expect(bucketIndexForDay(buckets, '2026-08-01')).toBe(0);
    expect(bucketIndexForDay(buckets, '2026-08-05')).toBe(1);
  });

  it('returns -1 outside the range', () => {
    expect(bucketIndexForDay(buckets, '2026-09-01')).toBe(-1);
  });
});
