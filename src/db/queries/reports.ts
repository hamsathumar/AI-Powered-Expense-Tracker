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
