import { format } from 'date-fns';
import * as Crypto from 'expo-crypto';

import { getDb } from '@/db/client';
import { insertTransaction, type NewTransaction } from '@/db/queries/transactions';
import { advanceDueDate, planDueRuns, rollDueDateForward } from '@/domain/recurring';
import type {
  LendingDirection,
  RecurringFrequency,
  RecurringGroup,
  RecurringStatus,
  RecurringTemplate,
  Transaction,
  TransactionType,
} from '@/domain/types';

interface TemplateRow {
  id: string;
  type: TransactionType;
  name: string;
  amount: number;
  account_id: string | null;
  to_account_id: string | null;
  category_id: string | null;
  person_id: string | null;
  direction: LendingDirection | null;
  frequency: RecurringFrequency;
  interval_days: number | null;
  next_due_date: string;
  end_date: string | null;
  active: number;
  status: RecurringStatus;
  paused_until: string | null;
  recurring_group: RecurringGroup | null;
  total_installments: number | null;
  principal_amount: number | null;
  created_at: string;
}

function fromRow(row: TemplateRow): RecurringTemplate {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    amountMinor: row.amount,
    accountId: row.account_id ?? undefined,
    toAccountId: row.to_account_id ?? undefined,
    categoryId: row.category_id ?? undefined,
    personId: row.person_id ?? undefined,
    direction: row.direction ?? undefined,
    frequency: row.frequency,
    intervalDays: row.interval_days ?? undefined,
    nextDueDate: row.next_due_date,
    endDate: row.end_date ?? undefined,
    status: row.status,
    pausedUntil: row.paused_until ?? undefined,
    recurringGroup: row.recurring_group ?? 'other',
    totalInstallments: row.total_installments ?? undefined,
    principalMinor: row.principal_amount ?? undefined,
    active: row.status === 'active',
    createdAt: row.created_at,
  };
}

export type NewRecurringTemplate = Omit<RecurringTemplate, 'id' | 'createdAt' | 'active'>;

/** Keep the legacy `active` INTEGER in sync with `status` on every write. */
function activeFlag(status: RecurringStatus): number {
  return status === 'active' ? 1 : 0;
}

export async function createTemplate(input: NewRecurringTemplate): Promise<RecurringTemplate> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO recurring_templates
       (id, type, name, amount, account_id, to_account_id, category_id, person_id,
        direction, frequency, interval_days, next_due_date, end_date, active,
        status, paused_until, recurring_group, total_installments, principal_amount, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.type,
    input.name,
    input.amountMinor,
    input.accountId ?? null,
    input.toAccountId ?? null,
    input.categoryId ?? null,
    input.personId ?? null,
    input.direction ?? null,
    input.frequency,
    input.intervalDays ?? null,
    input.nextDueDate,
    input.endDate ?? null,
    activeFlag(input.status),
    input.status,
    input.pausedUntil ?? null,
    input.recurringGroup,
    input.totalInstallments ?? null,
    input.principalMinor ?? null,
    createdAt,
  );
  return { ...input, id, active: input.status === 'active', createdAt };
}

export async function updateTemplate(id: string, input: NewRecurringTemplate): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE recurring_templates SET
       type = ?, name = ?, amount = ?, account_id = ?, to_account_id = ?,
       category_id = ?, person_id = ?, direction = ?, frequency = ?,
       interval_days = ?, next_due_date = ?, end_date = ?, active = ?,
       status = ?, paused_until = ?, recurring_group = ?,
       total_installments = ?, principal_amount = ?
     WHERE id = ?`,
    input.type,
    input.name,
    input.amountMinor,
    input.accountId ?? null,
    input.toAccountId ?? null,
    input.categoryId ?? null,
    input.personId ?? null,
    input.direction ?? null,
    input.frequency,
    input.intervalDays ?? null,
    input.nextDueDate,
    input.endDate ?? null,
    activeFlag(input.status),
    input.status,
    input.pausedUntil ?? null,
    input.recurringGroup,
    input.totalInstallments ?? null,
    input.principalMinor ?? null,
    id,
  );
}

/** Move a template into a lifecycle state; keeps `active` and `paused_until` coherent. */
export async function setTemplateStatus(
  id: string,
  status: RecurringStatus,
  pausedUntil?: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE recurring_templates SET status = ?, paused_until = ?, active = ? WHERE id = ?',
    status,
    status === 'paused' ? (pausedUntil ?? null) : null,
    activeFlag(status),
    id,
  );
}

/** Pause generation; optionally auto-resume on `resumeDateISO` ('yyyy-MM-dd'). */
export async function pauseTemplate(id: string, resumeDateISO?: string): Promise<void> {
  await setTemplateStatus(id, 'paused', resumeDateISO);
}

/**
 * Resume a paused template. Rolls its due date forward past today so the
 * paused span isn't back-generated as a flood of catch-up transactions.
 */
export async function resumeTemplate(id: string): Promise<void> {
  const template = await getTemplate(id);
  if (!template) return;
  const today = format(new Date(), 'yyyy-MM-dd');
  const nextDue = rollDueDateForward(
    template.nextDueDate,
    template.frequency,
    template.intervalDays,
    today,
  );
  const db = await getDb();
  await db.runAsync(
    'UPDATE recurring_templates SET status = ?, paused_until = NULL, active = 1, next_due_date = ? WHERE id = ?',
    'active',
    nextDue,
    id,
  );
}

/** Soft-cancel: stops generation but keeps the row so payments stay linked. */
export async function cancelTemplate(id: string): Promise<void> {
  await setTemplateStatus(id, 'cancelled');
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = await getDb();
  // Generated transactions keep their recurring_id but survive the template.
  await db.runAsync('UPDATE transactions SET recurring_id = NULL WHERE recurring_id = ?', id);
  await db.runAsync('DELETE FROM recurring_templates WHERE id = ?', id);
}

export async function listTemplates(): Promise<RecurringTemplate[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TemplateRow>(
    'SELECT * FROM recurring_templates ORDER BY next_due_date',
  );
  return rows.map(fromRow);
}

export interface RecurringListItem {
  template: RecurringTemplate;
  accountName: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
}

/** Templates with the display names their list rows need (one query, no N+1). */
export async function listTemplateItems(): Promise<RecurringListItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<
    TemplateRow & {
      account_name: string | null;
      category_name: string | null;
      category_icon: string | null;
      category_color: string | null;
    }
  >(
    `SELECT r.*,
            a.name  AS account_name,
            c.name  AS category_name,
            c.icon  AS category_icon,
            c.color AS category_color
     FROM recurring_templates r
     LEFT JOIN accounts   a ON a.id = r.account_id
     LEFT JOIN categories c ON c.id = r.category_id
     ORDER BY r.next_due_date`,
  );
  return rows.map((row) => ({
    template: fromRow(row),
    accountName: row.account_name,
    categoryName: row.category_name,
    categoryIcon: row.category_icon,
    categoryColor: row.category_color,
  }));
}

export async function getTemplate(id: string): Promise<RecurringTemplate | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<TemplateRow>(
    'SELECT * FROM recurring_templates WHERE id = ?',
    id,
  );
  return row ? fromRow(row) : null;
}

/** One template with its joined display names, for the detail screen. */
export async function getTemplateItem(id: string): Promise<RecurringListItem | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<
    TemplateRow & {
      account_name: string | null;
      category_name: string | null;
      category_icon: string | null;
      category_color: string | null;
    }
  >(
    `SELECT r.*,
            a.name  AS account_name,
            c.name  AS category_name,
            c.icon  AS category_icon,
            c.color AS category_color
     FROM recurring_templates r
     LEFT JOIN accounts   a ON a.id = r.account_id
     LEFT JOIN categories c ON c.id = r.category_id
     WHERE r.id = ?`,
    id,
  );
  if (!row) return null;
  return {
    template: fromRow(row),
    accountName: row.account_name,
    categoryName: row.category_name,
    categoryIcon: row.category_icon,
    categoryColor: row.category_color,
  };
}

/** Template → transaction for one due date (status supplied by caller). */
function toNewTransaction(
  t: RecurringTemplate,
  dueDate: string,
  status: 'pending' | 'approved',
): NewTransaction | null {
  const base = {
    status,
    source: 'recurring' as const,
    name: t.name,
    amountMinor: t.amountMinor,
    // Noon UTC keeps the calendar date stable across timezones.
    occurredAt: `${dueDate}T12:00:00.000Z`,
    recurringId: t.id,
    confidenceFlags: [] as never[],
  };
  switch (t.type) {
    case 'expense':
    case 'income':
      if (!t.accountId || !t.categoryId) return null;
      return { ...base, type: t.type, accountId: t.accountId, categoryId: t.categoryId };
    case 'transfer':
      if (!t.accountId || !t.toAccountId) return null;
      return { ...base, type: 'transfer', accountId: t.accountId, toAccountId: t.toAccountId };
    case 'lending':
      if (!t.accountId || !t.personId || !t.direction) return null;
      return {
        ...base,
        type: 'lending',
        accountId: t.accountId,
        personId: t.personId,
        direction: t.direction,
      };
  }
}

/**
 * Manual fast-path (scoped exception): the user is looking at a template and
 * wants to settle its current occurrence NOW. Inserts the generated
 * transaction directly as `approved` — skipping the pending queue — and
 * advances next_due_date so the foreground job won't double-generate the same
 * period. This is the ONLY path that bypasses the Approval Queue; it still
 * honours the golden rule (only approved rows count) — the approval just
 * happens immediately instead of via the queue.
 */
export async function markRecurringPaid(templateId: string): Promise<Transaction> {
  const template = await getTemplate(templateId);
  if (!template) throw new Error('Recurring item not found.');
  const dueDate = template.nextDueDate;
  const input = toNewTransaction(template, dueDate, 'approved');
  if (!input) {
    throw new Error('This template is missing an account or category — edit it first.');
  }
  const tx = await insertTransaction(input);

  const nextDue = advanceDueDate(dueDate, template.frequency, template.intervalDays);
  const stillActive = !template.endDate || nextDue <= template.endDate;
  const db = await getDb();
  await db.runAsync(
    'UPDATE recurring_templates SET next_due_date = ?, status = ?, active = ? WHERE id = ?',
    nextDue,
    stillActive ? 'active' : 'cancelled',
    stillActive ? 1 : 0,
    templateId,
  );
  return tx;
}

export interface RecurringStats {
  /** Approved payments — drive loan progress and the golden-rule totals. */
  approvedCount: number;
  approvedSumMinor: number;
  /** Non-rejected payments — "N payments since …". */
  totalCount: number;
  firstOccurredAt: string | null;
  /** Latest approved payment's occurred_at — drives the "paid this period" state. */
  lastApprovedOccurredAt: string | null;
}

export async function getRecurringStats(recurringId: string): Promise<RecurringStats> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    approved_count: number;
    approved_sum: number | null;
    total_count: number;
    first_occurred: string | null;
    last_approved: string | null;
  }>(
    `SELECT
       SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END)      AS approved_count,
       SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END) AS approved_sum,
       SUM(CASE WHEN status != 'rejected' THEN 1 ELSE 0 END)     AS total_count,
       MIN(CASE WHEN status != 'rejected' THEN occurred_at END)  AS first_occurred,
       MAX(CASE WHEN status = 'approved' THEN occurred_at END)   AS last_approved
     FROM transactions WHERE recurring_id = ?`,
    recurringId,
  );
  return {
    approvedCount: row?.approved_count ?? 0,
    approvedSumMinor: row?.approved_sum ?? 0,
    totalCount: row?.total_count ?? 0,
    firstOccurredAt: row?.first_occurred ?? null,
    lastApprovedOccurredAt: row?.last_approved ?? null,
  };
}

/**
 * Latest approved payment date ('yyyy-MM-dd') per template — lets the list
 * rows derive their "paid this period" state (see `isCurrentPeriodPaid`).
 */
export async function getLastApprovedDates(): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; mx: string }>(
    `SELECT recurring_id AS id, MAX(occurred_at) AS mx
     FROM transactions
     WHERE recurring_id IS NOT NULL AND status = 'approved'
     GROUP BY recurring_id`,
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.id] = r.mx.slice(0, 10);
  return map;
}

export interface RecurringPayment {
  id: string;
  amountMinor: number;
  occurredAt: string;
  status: Transaction['status'];
}

/** Payments generated by one template, newest first (excludes rejected). */
export async function listPaymentsForRecurring(
  recurringId: string,
  limit?: number,
): Promise<RecurringPayment[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    amount: number;
    occurred_at: string;
    status: Transaction['status'];
  }>(
    `SELECT id, amount, occurred_at, status FROM transactions
     WHERE recurring_id = ? AND status != 'rejected'
     ORDER BY occurred_at DESC${limit ? ' LIMIT ?' : ''}`,
    ...(limit ? [recurringId, limit] : [recurringId]),
  );
  return rows.map((r) => ({
    id: r.id,
    amountMinor: r.amount,
    occurredAt: r.occurred_at,
    status: r.status,
  }));
}

/** Most recent non-rejected payment amount per template — for variable-bill "≈" rows. */
export async function getLastPaymentAmounts(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; amount: number }>(
    `SELECT t.recurring_id AS id, t.amount AS amount
     FROM transactions t
     JOIN (
       SELECT recurring_id, MAX(occurred_at) AS mx
       FROM transactions
       WHERE recurring_id IS NOT NULL AND status != 'rejected'
       GROUP BY recurring_id
     ) latest ON latest.recurring_id = t.recurring_id AND latest.mx = t.occurred_at
     WHERE t.status != 'rejected'`,
  );
  const map: Record<string, number> = {};
  for (const r of rows) map[r.id] = r.amount;
  return map;
}

export interface ApprovedAggregate {
  count: number;
  sumMinor: number;
}

/** Approved count + sum per template — for loan progress on list rows. */
export async function getApprovedAggregates(): Promise<Record<string, ApprovedAggregate>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; cnt: number; sm: number }>(
    `SELECT recurring_id AS id, COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS sm
     FROM transactions
     WHERE recurring_id IS NOT NULL AND status = 'approved'
     GROUP BY recurring_id`,
  );
  const map: Record<string, ApprovedAggregate> = {};
  for (const r of rows) map[r.id] = { count: r.cnt, sumMinor: r.sm };
  return map;
}

/**
 * Foreground evaluation (§4.5): generate pending transactions for every due
 * occurrence, advance next_due_date, deactivate past end_date. The
 * duplicate guard (recurring_id + calendar date) makes repeated app opens
 * idempotent even if a previous run was interrupted mid-way.
 *
 * `paused` and `cancelled` templates are skipped. A `paused` template whose
 * `paused_until` has arrived auto-resumes first (rolling its due date forward
 * so the paused span isn't back-generated).
 */
export async function evaluateRecurringTemplates(): Promise<number> {
  const db = await getDb();
  const today = format(new Date(), 'yyyy-MM-dd');
  const templates = await listTemplates();
  let generated = 0;

  for (const template of templates) {
    let current = template;

    // Auto-resume a paused template once its resume date has arrived.
    if (current.status === 'paused') {
      if (current.pausedUntil && current.pausedUntil <= today) {
        await resumeTemplate(current.id);
        const refreshed = await getTemplate(current.id);
        if (!refreshed) continue;
        current = refreshed;
      } else {
        continue; // still paused
      }
    }

    if (current.status !== 'active') continue;

    const plan = planDueRuns(current, today);
    for (const dueDate of plan.runDates) {
      const duplicate = await db.getFirstAsync<{ one: number }>(
        `SELECT 1 AS one FROM transactions
         WHERE recurring_id = ? AND date(occurred_at) = date(?)`,
        current.id,
        `${dueDate}T12:00:00.000Z`,
      );
      if (duplicate) continue;
      const input = toNewTransaction(current, dueDate, 'pending');
      if (!input) continue; // malformed template — skip, don't crash startup
      await insertTransaction(input);
      generated += 1;
    }
    if (plan.runDates.length > 0 || !plan.stillActive) {
      const nextStatus: RecurringStatus = plan.stillActive ? 'active' : 'cancelled';
      await db.runAsync(
        'UPDATE recurring_templates SET next_due_date = ?, status = ?, active = ? WHERE id = ?',
        plan.nextDueDate,
        nextStatus,
        nextStatus === 'active' ? 1 : 0,
        current.id,
      );
    }
  }
  return generated;
}
