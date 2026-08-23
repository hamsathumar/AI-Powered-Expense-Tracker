/**
 * Aggregate/report queries. EVERY query here must respect the golden rule
 * (§4.1): spending/earning = approved expense/income only — transfers and
 * lending never appear.
 *
 * Month grouping uses SQLite's 'localtime' modifier so a 1 a.m. purchase
 * belongs to the local month, not the UTC one (timestamps are stored UTC).
 */
import { getDb } from '@/db/client';
import { listAccountBalancesMinor } from '@/db/queries/accounts';
import {
  breakdownSql,
  dailyTotalsSql,
  largestTransactionSql,
  rangeSummarySql,
  sliceAllTimeStatsSql,
  sliceLargestNameSql,
  slicePeriodStatsSql,
  sliceTransactionIdsSql,
  type BreakdownDim,
  type ReportFilter,
  type ReportKind,
} from '@/db/queries/reportSql';

/** "2026-08" for the device-local month of the given date. */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Total balance across all non-archived accounts (approved-only, §4.2). */
export async function getTotalBalanceMinor(): Promise<number> {
  const balances = await listAccountBalancesMinor();
  let total = 0;
  for (const value of balances.values()) total += value;
  return total;
}

export interface MonthlySummary {
  incomeMinor: number;
  expenseMinor: number;
}

export async function getMonthlySummary(month: string): Promise<MonthlySummary> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ income: number; expense: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'income'  THEN amount END), 0) AS income,
       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense
     FROM transactions
     WHERE status = 'approved'
       AND type IN ('expense','income')            -- golden rule
       AND strftime('%Y-%m', occurred_at, 'localtime') = ?`,
    month,
  );
  return { incomeMinor: row?.income ?? 0, expenseMinor: row?.expense ?? 0 };
}

export interface CategorySpending {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string | null;
  totalMinor: number;
}

export async function getSpendingByCategory(month: string): Promise<CategorySpending[]> {
  const db = await getDb();
  return db.getAllAsync<CategorySpending & { totalMinor: number }>(
    `SELECT c.id AS categoryId, c.name, c.icon, c.color, SUM(t.amount) AS totalMinor
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     WHERE t.status = 'approved'
       AND t.type = 'expense'                      -- golden rule
       AND strftime('%Y-%m', t.occurred_at, 'localtime') = ?
     GROUP BY c.id
     ORDER BY totalMinor DESC`,
    month,
  );
}

export interface DailySpending {
  /** Day-of-month 1..31 (device-local). */
  day: number;
  totalMinor: number;
}

/** Approved expense per day of the month (golden rule). Days with no spending
 *  are omitted — the caller fills the full month. */
export async function getDailySpending(month: string): Promise<DailySpending[]> {
  const db = await getDb();
  return db.getAllAsync<DailySpending>(
    `SELECT CAST(strftime('%d', occurred_at, 'localtime') AS INTEGER) AS day,
            SUM(amount) AS totalMinor
     FROM transactions
     WHERE status = 'approved'
       AND type = 'expense'                        -- golden rule
       AND strftime('%Y-%m', occurred_at, 'localtime') = ?
     GROUP BY day
     ORDER BY day`,
    month,
  );
}

export interface AccountSpending {
  accountId: string;
  name: string;
  type: 'bank' | 'card' | 'cash';
  totalMinor: number;
}

/** Approved expense per account for the month (golden rule). */
export async function getSpendingByAccount(month: string): Promise<AccountSpending[]> {
  const db = await getDb();
  return db.getAllAsync<AccountSpending>(
    `SELECT a.id AS accountId, a.name, a.type, SUM(t.amount) AS totalMinor
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     WHERE t.status = 'approved'
       AND t.type = 'expense'                      -- golden rule
       AND strftime('%Y-%m', t.occurred_at, 'localtime') = ?
     GROUP BY a.id
     ORDER BY totalMinor DESC`,
    month,
  );
}

// ---------------------------------------------------------------------------
// Range + filter aware reporting (Reports tab v2)
//
// Everything below takes a `ReportFilter` — an inclusive local day range plus
// optional account / person / include-category / exclude-category narrowing —
// so the whole screen (totals, insights, trend, donut, lists, drill-downs)
// reads from one shared definition of "what is being reported".
//
// The statements themselves live in `reportSql.ts` (pure, no db handle) so
// they can be executed against a real SQLite engine in `reportSql.test.ts`.
// That is where the golden rule is enforced: transfers and lending can never
// leak into a report, in any grouping. A "person" breakdown therefore means
// expense/income rows TAGGED with that person (a bill-split share, a gift) —
// never their lending balance, which lives on the People screen.
// ---------------------------------------------------------------------------

export type {
  BreakdownDim,
  ReportFilter,
  ReportKind,
} from '@/db/queries/reportSql';

export interface RangeSummary {
  incomeMinor: number;
  expenseMinor: number;
  /** Approved expense + income rows in range (what "Transactions" counts). */
  txCount: number;
}

export async function getRangeSummary(filter: ReportFilter): Promise<RangeSummary> {
  const db = await getDb();
  const { sql, params } = rangeSummarySql(filter);
  const row = await db.getFirstAsync<RangeSummary>(sql, ...params);
  return {
    incomeMinor: row?.incomeMinor ?? 0,
    expenseMinor: row?.expenseMinor ?? 0,
    txCount: row?.txCount ?? 0,
  };
}

export interface LargestTransaction {
  id: string;
  name: string;
  amountMinor: number;
  categoryName: string | null;
}

/** The single biggest row of `kind` in range — the "Largest expense" insight. */
export async function getLargestTransaction(
  filter: ReportFilter,
  kind: ReportKind,
): Promise<LargestTransaction | null> {
  const db = await getDb();
  const { sql, params } = largestTransactionSql(filter, kind);
  return (await db.getFirstAsync<LargestTransaction>(sql, ...params)) ?? null;
}

export interface DayTotals {
  /** Local 'yyyy-MM-dd'. */
  day: string;
  incomeMinor: number;
  expenseMinor: number;
}

/**
 * Income and expense per local day in range. The trend chart buckets these in
 * JS (see `domain/reportRange.buildBuckets`) so day, week and month
 * granularities all come from this one query. Days with no activity are
 * omitted — the caller fills the gaps.
 */
export async function getDailyTotals(filter: ReportFilter): Promise<DayTotals[]> {
  const db = await getDb();
  const { sql, params } = dailyTotalsSql(filter);
  return db.getAllAsync<DayTotals>(sql, ...params);
}

export interface BreakdownSlice {
  id: string;
  name: string;
  icon: string | null;
  /** Stored colour where the entity has one (category, account); else null and
   *  the UI assigns a stable palette colour. */
  color: string | null;
  totalMinor: number;
  txCount: number;
}

/** Ranked slices for the donut + list, largest first. */
export async function getBreakdown(
  filter: ReportFilter,
  dim: BreakdownDim,
  kind: ReportKind,
): Promise<BreakdownSlice[]> {
  const db = await getDb();
  const { sql, params } = breakdownSql(filter, dim, kind);
  return db.getAllAsync<BreakdownSlice>(sql, ...params);
}

export interface SliceStats {
  /** In the active period, under the active filter. */
  totalMinor: number;
  txCount: number;
  /** Mean transaction size in the period (0 when there are none). */
  averageMinor: number;
  largestMinor: number;
  largestName: string | null;
  /** Ignores the period AND the rest of the filter — a true lifetime figure. */
  allTimeTotalMinor: number;
  allTimeCount: number;
  /** UTC timestamp of the most recent row of this slice, ever. */
  lastOccurredAt: string | null;
}

/** Stat grid for the drill-down screen. */
export async function getSliceStats(
  filter: ReportFilter,
  dim: BreakdownDim,
  sliceId: string,
  kind: ReportKind,
): Promise<SliceStats> {
  const db = await getDb();

  const periodStmt = slicePeriodStatsSql(filter, dim, sliceId, kind);
  const largestStmt = sliceLargestNameSql(filter, dim, sliceId, kind);
  const allTimeStmt = sliceAllTimeStatsSql(dim, sliceId, kind);

  const [period, largest, allTime] = await Promise.all([
    db.getFirstAsync<{ totalMinor: number; txCount: number; largestMinor: number }>(
      periodStmt.sql,
      ...periodStmt.params,
    ),
    db.getFirstAsync<{ name: string }>(largestStmt.sql, ...largestStmt.params),
    db.getFirstAsync<{ totalMinor: number; txCount: number; lastOccurredAt: string | null }>(
      allTimeStmt.sql,
      ...allTimeStmt.params,
    ),
  ]);

  const txCount = period?.txCount ?? 0;
  const totalMinor = period?.totalMinor ?? 0;
  return {
    totalMinor,
    txCount,
    averageMinor: txCount > 0 ? Math.round(totalMinor / txCount) : 0,
    largestMinor: period?.largestMinor ?? 0,
    largestName: largest?.name ?? null,
    allTimeTotalMinor: allTime?.totalMinor ?? 0,
    allTimeCount: allTime?.txCount ?? 0,
    lastOccurredAt: allTime?.lastOccurredAt ?? null,
  };
}

/** Row ids making up one slice, newest first — the drill-down's list. */
export async function listSliceTransactionIds(
  filter: ReportFilter,
  dim: BreakdownDim,
  sliceId: string,
  kind: ReportKind,
): Promise<string[]> {
  const db = await getDb();
  const { sql, params } = sliceTransactionIdsSql(filter, dim, sliceId, kind);
  const rows = await db.getAllAsync<{ id: string }>(sql, ...params);
  return rows.map((r) => r.id);
}
