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

export function resolveDateExpression(expression: string | null, reference: Date): DateResolution {
  const nowIso = reference.toISOString();
  if (!expression) return { iso: nowIso, resolved: true }; // unexpressed → reference now (honest default)

  const e = expression.trim().toLowerCase();
  if (e === 'today' || e === 'now') return { iso: nowIso, resolved: true };
  if (e === 'yesterday') return { iso: shiftDays(reference, -1).toISOString(), resolved: true };
  if (e === 'tomorrow') return { iso: shiftDays(reference, 1).toISOString(), resolved: true };
  if (e === 'day before yesterday') return { iso: shiftDays(reference, -2).toISOString(), resolved: true };

  const agoMatch = e.match(/^(\d+)\s+days?\s+ago$/);
  if (agoMatch) return { iso: shiftDays(reference, -Number(agoMatch[1])).toISOString(), resolved: true };

  // "last friday" / "next monday" / "this tuesday" / bare "friday"
  const wdMatch = e.match(/^(last|next|this)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
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
    const base = new Date(anchor);
    base.setMonth(monthIndex);
    if (year !== null) base.setFullYear(year);
    // No year given: the end must be in the future relative to the anchor.
    if (year === null && base < anchor) base.setFullYear(base.getFullYear() + 1);
    if (day !== null && day >= 1 && day <= 31) {
      base.setDate(day);
    } else {
      // "until December" with no day -> the last day of that month.
      base.setMonth(base.getMonth() + 1, 0);
    }
    return { endDate: toDayString(base), resolved: true, explicitNever: false };
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
