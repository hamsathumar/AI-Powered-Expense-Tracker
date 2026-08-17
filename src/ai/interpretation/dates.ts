/**
 * Conservative relative-date resolution against an application reference date.
 *
 * The AI only produces a date EXPRESSION; this app-owned resolver turns a
 * supported expression into an ISO timestamp. Unsupported/absent expressions
 * fall back to the reference "now" and report `resolved:false` so the caller
 * can surface it. Time-of-day and future-date signalling remain OPEN product
 * questions and are intentionally not decided here.
 */
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
