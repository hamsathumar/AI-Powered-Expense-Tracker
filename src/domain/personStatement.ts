/**
 * A person's history as a dated statement: transactions grouped by day, each
 * day closing with the running balance between the user and that person
 * (e.g. owed 1,000, lent 500 more today → the day ends at "owes you 1,500").
 *
 * One pure builder feeds both the person screen and the PDF export, so the two
 * can never disagree. Balance math is `personEffectMinor` — approved lending
 * only; pending rows are listed (so nothing seems to vanish) but never move
 * the balance, and rejected rows are not expected here.
 *
 * Days are LOCAL calendar days. Amounts are integer minor units.
 */
import { endOfDay, format, isToday, isYesterday, startOfDay } from 'date-fns';

import { personEffectMinor } from '@/domain/rules';
import type { LendingDirection, Transaction } from '@/domain/types';

export interface StatementDay<T> {
  /** Local calendar day, 'yyyy-MM-dd'. */
  dayKey: string;
  /** A moment inside the day, for formatting. */
  date: Date;
  /** The day's entries, newest first. */
  entries: T[];
  /** Net movement of the day: + they owe more, − less. Approved lending only. */
  dayNetMinor: number;
  /** Balance after the day's last transaction (+ they owe you, − you owe them). */
  closingBalanceMinor: number;
}

export interface PersonStatement<T> {
  /** Balance just before the range starts (0 for an unbounded range). */
  openingBalanceMinor: number;
  /** Balance at the end of the range. */
  closingBalanceMinor: number;
  /** Newest day first. */
  days: StatementDay<T>[];
}

export interface StatementRange {
  from?: Date;
  to?: Date;
}

/**
 * `items` may arrive in any order. Pass the person's FULL history even for a
 * date-ranged statement — earlier rows are what make the opening balance right.
 */
export function buildPersonStatement<T extends { tx: Transaction }>(
  items: T[],
  personId: string,
  range: StatementRange = {},
): PersonStatement<T> {
  const fromMs = range.from ? startOfDay(range.from).getTime() : -Infinity;
  const toMs = range.to ? endOfDay(range.to).getTime() : Infinity;

  // Oldest first, so a running sum can walk forward. createdAt breaks ties
  // between rows stamped the same minute.
  const chronological = [...items].sort((a, b) => {
    const byWhen = new Date(a.tx.occurredAt).getTime() - new Date(b.tx.occurredAt).getTime();
    return byWhen !== 0 ? byWhen : a.tx.createdAt.localeCompare(b.tx.createdAt);
  });

  let running = 0;
  let openingBalanceMinor = 0;
  const byDay = new Map<string, StatementDay<T>>();

  for (const item of chronological) {
    const when = new Date(item.tx.occurredAt);
    const ms = when.getTime();
    const effect = personEffectMinor(item.tx, personId);

    if (ms < fromMs) {
      running += effect;
      openingBalanceMinor = running;
      continue;
    }
    if (ms > toMs) continue;

    running += effect;
    const dayKey = format(when, 'yyyy-MM-dd');
    let day = byDay.get(dayKey);
    if (!day) {
      day = { dayKey, date: when, entries: [], dayNetMinor: 0, closingBalanceMinor: 0 };
      byDay.set(dayKey, day);
    }
    day.entries.unshift(item); // chronological in, so unshift → newest first
    day.dayNetMinor += effect;
    day.closingBalanceMinor = running;
  }

  const days = [...byDay.values()].reverse(); // Map keeps insertion (oldest-first) order
  return { openingBalanceMinor, closingBalanceMinor: running, days };
}

/** Approved lending with this person inside the statement, per direction. */
export function directionTotalsMinor<T extends { tx: Transaction }>(
  days: StatementDay<T>[],
  personId: string,
): Record<LendingDirection, number> {
  const totals: Record<LendingDirection, number> = {
    lend: 0,
    lend_repayment_received: 0,
    borrow: 0,
    borrow_repayment_made: 0,
  };
  for (const day of days) {
    for (const { tx } of day.entries) {
      if (tx.type === 'lending' && tx.status === 'approved' && tx.personId === personId) {
        totals[tx.direction] += tx.amountMinor;
      }
    }
  }
  return totals;
}

/** "Today · 6 Oct", "Yesterday · 5 Oct", otherwise "Mon 12 Oct 2026". */
export function statementDayTitle(date: Date): string {
  if (isToday(date)) return `Today · ${format(date, 'd MMM')}`;
  if (isYesterday(date)) return `Yesterday · ${format(date, 'd MMM')}`;
  return format(date, 'EEE d MMM yyyy');
}
