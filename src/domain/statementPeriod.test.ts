import { describe, expect, it } from '@jest/globals';

import {
  describeRange,
  normalizeRange,
  statementFilename,
  statementPeriod,
} from './statementPeriod';

const today = new Date(2026, 9, 6, 15, 30); // Tue 6 Oct 2026, afternoon

describe('statementPeriod', () => {
  it('last 1 day is today only', () => {
    expect(statementPeriod('lastDay', today)).toEqual({ startDay: '2026-10-06', endDay: '2026-10-06' });
  });
  it('last week is 7 days ending today', () => {
    expect(statementPeriod('lastWeek', today)).toEqual({ startDay: '2026-09-30', endDay: '2026-10-06' });
  });
  it('last month is one calendar month ending today', () => {
    expect(statementPeriod('lastMonth', today)).toEqual({ startDay: '2026-09-07', endDay: '2026-10-06' });
  });
  it('last month across a year boundary and from a short month', () => {
    expect(statementPeriod('lastMonth', new Date(2026, 0, 10))).toEqual({
      startDay: '2025-12-11',
      endDay: '2026-01-10',
    });
    // 31 Mar → subMonths clamps to 28 Feb → starts 1 Mar: still exactly "March so far"
    expect(statementPeriod('lastMonth', new Date(2026, 2, 31))).toEqual({
      startDay: '2026-03-01',
      endDay: '2026-03-31',
    });
  });
});

describe('normalizeRange / describeRange', () => {
  it('orders a reversed pick', () => {
    expect(normalizeRange('2026-10-06', '2026-09-01')).toEqual({ startDay: '2026-09-01', endDay: '2026-10-06' });
  });
  it('describes single days, same-year and cross-year ranges', () => {
    expect(describeRange({ startDay: '2026-10-06', endDay: '2026-10-06' })).toBe('6 Oct 2026');
    expect(describeRange({ startDay: '2026-09-07', endDay: '2026-10-06' })).toBe('7 Sep – 6 Oct 2026');
    expect(describeRange({ startDay: '2025-12-28', endDay: '2026-01-03' })).toBe('28 Dec 2025 – 3 Jan 2026');
  });
});

describe('statementFilename', () => {
  it('is filesystem-safe and names the range', () => {
    expect(statementFilename('Kamal Perera', { startDay: '2026-09-07', endDay: '2026-10-06' })).toBe(
      'Kaasu-Kamal-Perera-2026-09-07-to-2026-10-06.pdf',
    );
    expect(statementFilename('a/b:c?', { startDay: '2026-10-06', endDay: '2026-10-06' })).toBe(
      'Kaasu-abc-2026-10-06.pdf',
    );
    expect(statementFilename('???', { startDay: '2026-10-06', endDay: '2026-10-06' })).toBe(
      'Kaasu-person-2026-10-06.pdf',
    );
  });
  it('keeps non-Latin names (Tamil, accented)', () => {
    expect(statementFilename('கமல் ராஜ்', { startDay: '2026-10-06', endDay: '2026-10-06' })).toBe(
      'Kaasu-கமல்-ராஜ்-2026-10-06.pdf',
    );
    expect(statementFilename('José', { startDay: '2026-10-06', endDay: '2026-10-06' })).toBe(
      'Kaasu-José-2026-10-06.pdf',
    );
  });
});
