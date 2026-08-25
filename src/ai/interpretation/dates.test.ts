/** Relative-date resolution (TC-004 class): expressions resolve against an app
 *  reference date; unsupported/absent → reference now with a resolved flag. */
import { describe, expect, it } from '@jest/globals';

import { resolveDateExpression, resolveRecurrenceEnd } from './dates';

const ref = new Date('2026-08-17T12:00:00.000Z'); // a Monday

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

describe('resolveDateExpression', () => {
  it('absent expression → reference now, resolved', () => {
    const r = resolveDateExpression(null, ref);
    expect(dayOf(r.iso)).toBe('2026-08-17');
    expect(r.resolved).toBe(true);
  });

  it('"yesterday" resolves to the day before the reference (fixes TC-004)', () => {
    expect(dayOf(resolveDateExpression('yesterday', ref).iso)).toBe('2026-08-16');
  });

  it('"today" and "tomorrow"', () => {
    expect(dayOf(resolveDateExpression('today', ref).iso)).toBe('2026-08-17');
    expect(dayOf(resolveDateExpression('tomorrow', ref).iso)).toBe('2026-08-18');
  });

  it('"3 days ago"', () => {
    expect(dayOf(resolveDateExpression('3 days ago', ref).iso)).toBe('2026-08-14');
  });

  it('"last friday" → most recent past Friday', () => {
    // 2026-08-17 is Monday; the previous Friday is 2026-08-14.
    expect(dayOf(resolveDateExpression('last friday', ref).iso)).toBe('2026-08-14');
  });

  it('unsupported expression → reference now, flagged not-resolved', () => {
    const r = resolveDateExpression('some fuzzy time', ref);
    expect(dayOf(r.iso)).toBe('2026-08-17');
    expect(r.resolved).toBe(false);
  });
});

// ── Recurrence end conditions — TC-025 ───────────────────────────────────
const anchor = new Date('2026-08-21T12:00:00.000Z'); // the TC-025 "Next due"

describe('resolveRecurrenceEnd — TC-025 ("for the next 3 months" became "Ends: Never")', () => {
  it('reads a duration whose unit matches the cadence as a COUNT of payments', () => {
    // 3 monthly payments: 21 Aug, 21 Sep, 21 Oct. endDate is inclusive in
    // src/domain/recurring.ts, so it lands on the third one.
    const r = resolveRecurrenceEnd({
      endExpression: 'for the next 3 months',
      occurrenceCount: null,
      frequency: 'monthly',
      anchor,
    });
    expect(r.endDate).toBe('2026-10-21');
    expect(r.resolved).toBe(true);
    expect(r.explicitNever).toBe(false);
  });

  it('reads a duration whose unit differs from the cadence as a span of time', () => {
    const r = resolveRecurrenceEnd({
      endExpression: 'for the next 3 months',
      occurrenceCount: null,
      frequency: 'weekly',
      anchor,
    });
    expect(r.endDate).toBe('2026-11-21');
    expect(r.resolved).toBe(true);
  });

  it('honours an explicit occurrence count above any wording', () => {
    const r = resolveRecurrenceEnd({
      endExpression: null,
      occurrenceCount: 6,
      frequency: 'monthly',
      anchor,
    });
    expect(r.endDate).toBe('2027-01-21'); // anchor + 5 months
  });

  it('reads "for 6 payments" / "3 times" as counts', () => {
    expect(
      resolveRecurrenceEnd({ endExpression: 'for 6 payments', occurrenceCount: null, frequency: 'monthly', anchor })
        .endDate,
    ).toBe('2027-01-21');
    expect(
      resolveRecurrenceEnd({ endExpression: 'three times', occurrenceCount: null, frequency: 'weekly', anchor })
        .endDate,
    ).toBe('2026-09-04'); // anchor + 2 weeks
  });

  it('reads "until <month>" as the end of that month', () => {
    const r = resolveRecurrenceEnd({
      endExpression: 'until December',
      occurrenceCount: null,
      frequency: 'monthly',
      anchor,
    });
    expect(r.endDate).toBe('2026-12-31');
    expect(r.resolved).toBe(true);
  });

  it('rolls "until <month>" into next year when the month has already passed', () => {
    const r = resolveRecurrenceEnd({
      endExpression: 'until March',
      occurrenceCount: null,
      frequency: 'monthly',
      anchor,
    });
    expect(r.endDate).toBe('2027-03-31');
  });

  it('records an explicit "never" as never — not as unparsed', () => {
    const r = resolveRecurrenceEnd({
      endExpression: 'until I cancel',
      occurrenceCount: null,
      frequency: 'monthly',
      anchor,
    });
    expect(r.endDate).toBeNull();
    expect(r.explicitNever).toBe(true);
    expect(r.resolved).toBe(true);
  });

  it('nothing stated → no end date, and that is a resolved answer', () => {
    const r = resolveRecurrenceEnd({
      endExpression: null,
      occurrenceCount: null,
      frequency: 'monthly',
      anchor,
    });
    expect(r.endDate).toBeNull();
    expect(r.resolved).toBe(true);
    expect(r.explicitNever).toBe(false);
  });

  it('stated but not understood → flagged unresolved, never silently "Never"', () => {
    const r = resolveRecurrenceEnd({
      endExpression: 'until things settle down',
      occurrenceCount: null,
      frequency: 'monthly',
      anchor,
    });
    expect(r.endDate).toBeNull();
    expect(r.resolved).toBe(false);
  });

  it('never invents an end date from a garbage count', () => {
    const r = resolveRecurrenceEnd({
      endExpression: null,
      occurrenceCount: 0,
      frequency: 'monthly',
      anchor,
    });
    expect(r.endDate).toBeNull();
  });
});

// ── Audit F11 — month-end edges in "until <month>" resolution ────────────
describe('resolveRecurrenceEnd — month-end anchors (audit F11)', () => {
  it('a day-31 anchor does not overflow past a short month ("until february")', () => {
    const r = resolveRecurrenceEnd({
      endExpression: 'until february',
      occurrenceCount: null,
      frequency: 'monthly',
      anchor: new Date('2026-01-31T12:00:00.000Z'),
    });
    expect(r.endDate).toBe('2026-02-28'); // 2026 is not a leap year — never 2026-03-03
    expect(r.resolved).toBe(true);
  });

  it('a stated day earlier in the anchor month rolls to next year, not before the anchor', () => {
    const r = resolveRecurrenceEnd({
      endExpression: 'until 5 august',
      occurrenceCount: null,
      frequency: 'monthly',
      anchor, // 21 Aug 2026
    });
    expect(r.endDate).toBe('2027-08-05');
  });

  it('"until december" from a day-31 anchor lands on 31 December', () => {
    const r = resolveRecurrenceEnd({
      endExpression: 'until december',
      occurrenceCount: null,
      frequency: 'monthly',
      anchor: new Date('2026-08-31T12:00:00.000Z'),
    });
    expect(r.endDate).toBe('2026-12-31');
  });
});
