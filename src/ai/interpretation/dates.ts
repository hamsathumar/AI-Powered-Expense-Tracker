/**
 * Conservative relative-date resolution against an application reference date.
 *
 * The AI only produces a date EXPRESSION; this app-owned resolver turns a
 * supported expression into an ISO timestamp. Unsupported/absent expressions
 * fall back to the reference "now" and report `resolved:false` so the caller
 * can surface it. Time-of-day and future-date signalling remain OPEN product
 * questions and are intentionally not decided here.
 */
import { addDays, addMonths, addWeeks, addYears } from 'date-fns';

export interface DateResolution {
  iso: string;
  /** true when the expression was understood (or absent → reference now). */
  resolved: boolean;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function shiftDays(ref: Date, days: number): Date {
  const d = new Date(ref);
  d.setDate(d.getDate() + days);
  return d;
}

/** Spoken counts the grammar below accepts in place of digits. */
const SPOKEN_COUNTS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

function spokenCount(token: string): number | null {
  const digits = Number(token);
  if (Number.isInteger(digits) && digits > 0) return digits;
  return SPOKEN_COUNTS[token.toLowerCase()] ?? null;
}

const COUNT = '(\\d{1,3}|a|an|one|two|couple|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';

/** Keep the reference's time of day while moving the calendar date. */
function atReferenceTime(reference: Date, y: number, monthIndex: number, day: number): Date {
  const d = new Date(reference);
  d.setDate(1); // never overflow while the month is being changed
  d.setFullYear(y);
  d.setMonth(monthIndex);
  const lastDay = new Date(y, monthIndex + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

export function resolveDateExpression(expression: string | null, reference: Date): DateResolution {
  const nowIso = reference.toISOString();
  if (!expression) return { iso: nowIso, resolved: true }; // unexpressed → reference now (honest default)

  // Strip filler that carries no date information ("on ", "at ", trailing ".").
  const e = expression
    .trim()
    .toLowerCase()
    .replace(/^(on|at|in)\s+/, '')
    .replace(/[.,]+$/, '')
    .trim();

  if (e === 'today' || e === 'now') return { iso: nowIso, resolved: true };
  if (e === 'yesterday') return { iso: shiftDays(reference, -1).toISOString(), resolved: true };
  if (e === 'tomorrow') return { iso: shiftDays(reference, 1).toISOString(), resolved: true };
  if (e === 'day before yesterday' || e === 'the day before yesterday')
    return { iso: shiftDays(reference, -2).toISOString(), resolved: true };
  if (e === 'day after tomorrow' || e === 'the day after tomorrow')
    return { iso: shiftDays(reference, 2).toISOString(), resolved: true };

  // Time-of-day words that still mean the reference DAY. Kaasu stores a
  // timestamp but has no clock-time capture (Architecture §26 open question),
  // so these resolve to the day, not to an invented hour — except the ones
  // that plainly mean yesterday.
  if (/^(this\s+)?(morning|afternoon|evening)$/.test(e) || e === 'tonight' || e === 'just now')
    return { iso: nowIso, resolved: true };
  if (e === 'last night' || e === 'yesterday night' || e === 'last evening')
    return { iso: shiftDays(reference, -1).toISOString(), resolved: true };

  // "3 days ago" / "two weeks ago" / "a month ago"
  const agoMatch = e.match(new RegExp(`^${COUNT}\\s+(day|week|month|year)s?\\s+ago$`));
  if (agoMatch) {
    const n = spokenCount(agoMatch[1]!);
    if (n !== null) {
      const unit = agoMatch[2]!;
      const d =
        unit === 'day' ? addDays(reference, -n)
        : unit === 'week' ? addWeeks(reference, -n)
        : unit === 'month' ? addMonths(reference, -n)
        : addYears(reference, -n);
      return { iso: d.toISOString(), resolved: true };
    }
  }

  // "last week" / "last month" / "last year" — the same weekday/day-of-month a
  // period earlier, which is what "I paid it last month" means in practice.
  const lastUnit = e.match(/^(last|past|previous)\s+(week|month|year)$/);
  if (lastUnit) {
    const unit = lastUnit[2]!;
    const d =
      unit === 'week' ? addWeeks(reference, -1) : unit === 'month' ? addMonths(reference, -1) : addYears(reference, -1);
    return { iso: d.toISOString(), resolved: true };
  }
  if (/^(this)\s+(week|month|year)$/.test(e)) return { iso: nowIso, resolved: true };

  // "last friday" / "next monday" / "this tuesday" / bare "friday"
  const wdMatch = e.match(/^(last|next|this|past)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (wdMatch) {
    const qualifier = wdMatch[1] ?? '';
    const target = WEEKDAYS[wdMatch[2]!]!;
    const current = reference.getDay();
    let delta = target - current;
    if (qualifier === 'next') {
      if (delta <= 0) delta += 7;
    } else {
      // "last"/"this"/bare → most recent occurrence on/before today (past-leaning, matches spoken past tense)
      if (delta >= 0) delta -= 7;
      if (qualifier === 'this' && target === current) delta = 0;
    }
    return { iso: shiftDays(reference, delta).toISOString(), resolved: true };
  }

  // ISO "2026-08-15" — also how the review screen's date picker writes back.
  const isoMatch = e.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const monthIndex = Number(isoMatch[2]) - 1;
    const day = Number(isoMatch[3]);
    if (monthIndex >= 0 && monthIndex <= 11 && day >= 1 && day <= 31) {
      return { iso: atReferenceTime(reference, y, monthIndex, day).toISOString(), resolved: true };
    }
  }

  // "15 august" / "august 15" / "15 august 2026" / "august 15, 2026"
  const monthNames = MONTHS.join('|');
  const dayMonth =
    e.match(new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})(?:\\s+(\\d{4}))?$`)) ??
    e.match(new RegExp(`^(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?$`));
  if (dayMonth) {
    const first = dayMonth[1]!;
    const monthFirst = MONTHS.includes(first);
    const monthIndex = MONTHS.indexOf(monthFirst ? first : dayMonth[2]!);
    const day = Number(monthFirst ? dayMonth[2] : first);
    const year = dayMonth[3] ? Number(dayMonth[3]) : null;
    if (monthIndex >= 0 && day >= 1 && day <= 31) {
      let d = atReferenceTime(reference, year ?? reference.getFullYear(), monthIndex, day);
      // No year stated: a date ahead of the reference means the year just past
      // (spoken money notes describe what already happened).
      if (year === null && d > reference) d = atReferenceTime(reference, reference.getFullYear() - 1, monthIndex, day);
      return { iso: d.toISOString(), resolved: true };
    }
  }

  // "the 15th" / "on the 3rd" — a day in the current month, past-leaning.
  const dayOfMonth = e.match(/^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)$/);
  if (dayOfMonth) {
    const day = Number(dayOfMonth[1]);
    if (day >= 1 && day <= 31) {
      let d = atReferenceTime(reference, reference.getFullYear(), reference.getMonth(), day);
      if (d > reference) {
        const prev = addMonths(reference, -1);
        d = atReferenceTime(reference, prev.getFullYear(), prev.getMonth(), day);
      }
      return { iso: d.toISOString(), resolved: true };
    }
  }

  return { iso: nowIso, resolved: false }; // unsupported expression → reference now, flagged
}

// ── Recurrence end conditions (TC-025) ───────────────────────────────────
/**
 * TC-025: the user said "for the next 3 months" and the template was still
 * saved as "Ends: Never". The model now preserves that wording as an
 * EXPRESSION (or an explicit occurrence count); this app-owned resolver turns
 * it into a real end date. The AI never computes a date.
 *
 * `endDate` is INCLUSIVE in src/domain/recurring.ts (`next <= endDate`), so N
 * occurrences means anchor + (N - 1) intervals.
 *
 * Interpretation rule for a stated DURATION: when the duration's unit matches
 * the recurrence interval ("for 3 months", monthly), it is read as a COUNT of
 * payments — 3 monthly payments, ending on the 3rd. When the units differ
 * ("for 3 months", weekly), it is read as a span of time from the anchor.
 */
export type EndFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' | 'UNRESOLVED';

export interface RecurrenceEndInput {
  /** Raw wording the user spoke, or null. */
  endExpression: string | null;
  /** An explicit count of occurrences, or null. */
  occurrenceCount: number | null;
  frequency: EndFrequency;
  intervalDays?: number;
  /** The first due date — the end condition is measured from here. */
  anchor: Date;
}

export interface RecurrenceEndResolution {
  /** 'yyyy-MM-dd', or null when the schedule has no end. */
  endDate: string | null;
  /** false when the user stated an end condition the app could not understand. */
  resolved: boolean;
  /** true when the user explicitly said it never ends. */
  explicitNever: boolean;
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12,
  fifteen: 15, twenty: 20, twentyfour: 24,
};

function toCount(token: string): number | null {
  const digits = Number(token);
  if (Number.isInteger(digits) && digits > 0) return digits;
  const word = NUMBER_WORDS[token.toLowerCase()];
  return word ?? null;
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** Same day-string derivation as the anchor uses, so both shift together. */
function toDayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Advance the anchor by `steps` whole recurrence intervals. */
function advance(anchor: Date, steps: number, frequency: EndFrequency, intervalDays?: number): Date {
  switch (frequency) {
    case 'daily':
      return addDays(anchor, steps);
    case 'weekly':
      return addWeeks(anchor, steps);
    case 'yearly':
      return addYears(anchor, steps);
    case 'custom':
      return addDays(anchor, steps * (intervalDays && intervalDays > 0 ? intervalDays : 1));
    case 'monthly':
    case 'UNRESOLVED':
    default:
      return addMonths(anchor, steps);
  }
}

/** Advance the anchor by a stated span of time (unit differs from the interval). */
function advanceUnit(anchor: Date, n: number, unit: string): Date {
  if (unit.startsWith('day')) return addDays(anchor, n);
  if (unit.startsWith('week')) return addWeeks(anchor, n);
  if (unit.startsWith('year')) return addYears(anchor, n);
  return addMonths(anchor, n);
}

const NEVER = /\b(forever|indefinitely|ongoing|no\s+end(\s+date)?|never\s+ends?|until\s+(i|we)\s+cancel|until\s+further\s+notice)\b/i;
const COUNT_UNITS = /(payments?|installments?|instalments?|times?|occurrences?|cycles?|charges?)/i;
const NUM = '(\\d{1,3}|a|an|one|two|couple|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|fifteen|twenty)';

/** Map a duration unit onto the frequency it would be a count for. */
const UNIT_FOR_FREQUENCY: Record<string, EndFrequency> = {
  day: 'daily',
  week: 'weekly',
  month: 'monthly',
  year: 'yearly',
};

export function resolveRecurrenceEnd(input: RecurrenceEndInput): RecurrenceEndResolution {
  const { endExpression, occurrenceCount, frequency, intervalDays, anchor } = input;
  const expr = endExpression?.trim().toLowerCase() ?? '';

  // An explicit count always wins — it needs no language parsing.
  if (occurrenceCount !== null && occurrenceCount > 0) {
    return {
      endDate: toDayString(advance(anchor, occurrenceCount - 1, frequency, intervalDays)),
      resolved: true,
      explicitNever: false,
    };
  }

  if (expr.length === 0) {
    return { endDate: null, resolved: true, explicitNever: false }; // nothing stated
  }

  if (NEVER.test(expr)) {
    return { endDate: null, resolved: true, explicitNever: true };
  }

  // "for 6 payments" / "6 more installments" / "3 times"
  const countMatch = expr.match(new RegExp(`\\b${NUM}\\s+(?:more\\s+)?${COUNT_UNITS.source}\\b`, 'i'));
  if (countMatch) {
    const n = toCount(countMatch[1]!);
    if (n !== null) {
      return {
        endDate: toDayString(advance(anchor, n - 1, frequency, intervalDays)),
        resolved: true,
        explicitNever: false,
      };
    }
  }

  // "for the next 3 months" / "over 6 weeks" / "for a year"
  const durationMatch = expr.match(new RegExp(`\\b${NUM}\\s+(days?|weeks?|months?|years?)\\b`, 'i'));
  if (durationMatch) {
    const n = toCount(durationMatch[1]!);
    const unit = durationMatch[2]!.toLowerCase().replace(/s$/, '');
    if (n !== null) {
      const effective = frequency === 'UNRESOLVED' ? 'monthly' : frequency;
      // Unit matches the cadence -> the user counted PAYMENTS, not calendar time.
      const asCount = UNIT_FOR_FREQUENCY[unit] === effective;
      const end = asCount
        ? advance(anchor, n - 1, effective, intervalDays)
        : advanceUnit(anchor, n, unit);
      return { endDate: toDayString(end), resolved: true, explicitNever: false };
    }
  }

  // "until December" / "until 31 December 2026" / "till the end of March"
  const monthMatch = expr.match(
    /\b(?:until|till|through|up\s+to|ending)\b[^]*?\b(\d{1,2})?\s*(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i,
  );
  if (monthMatch) {
    const monthIndex = MONTHS.indexOf(monthMatch[2]!.toLowerCase());
    const year = monthMatch[3] ? Number(monthMatch[3]) : null;
    const day = monthMatch[1] ? Number(monthMatch[1]) : null;
    // Set day 1 BEFORE the month so a day-31 anchor can never overflow into
    // the following month (audit F11); the anchor's time of day is preserved
    // so day-string derivation stays consistent with the anchor's.
    const build = (y: number): Date => {
      const d = new Date(anchor);
      d.setDate(1);
      d.setFullYear(y);
      d.setMonth(monthIndex);
      // "until December" with no day -> the last day of that month.
      const lastDay = new Date(y, monthIndex + 1, 0).getDate();
      d.setDate(day !== null && day >= 1 && day <= 31 ? Math.min(day, lastDay) : lastDay);
      return d;
    };
    let end = build(year ?? anchor.getFullYear());
    // No year given: the end must not fall before the anchor.
    if (year === null && end < anchor) end = build(anchor.getFullYear() + 1);
    return { endDate: toDayString(end), resolved: true, explicitNever: false };
  }

  // "until 2027-03-01" / "until 1/3/2027"
  const isoMatch = expr.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return { endDate: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`, resolved: true, explicitNever: false };
  }

  // Stated, but not understood — the caller surfaces this rather than
  // silently defaulting to "Never" (which is exactly the TC-025 failure).
  return { endDate: null, resolved: false, explicitNever: false };
}
