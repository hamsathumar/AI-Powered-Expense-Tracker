/** Relative-date resolution (TC-004 class): expressions resolve against an app
 *  reference date; unsupported/absent → reference now with a resolved flag. */
import { describe, expect, it } from '@jest/globals';

import { resolveDateExpression } from './dates';

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
