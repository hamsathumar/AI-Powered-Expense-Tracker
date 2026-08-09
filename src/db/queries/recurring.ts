import { format } from 'date-fns';
import * as Crypto from 'expo-crypto';

import { getDb } from '@/db/client';
import { insertTransaction, type NewTransaction } from '@/db/queries/transactions';
import { planDueRuns } from '@/domain/recurring';
import type {
  LendingDirection,
  RecurringFrequency,
  RecurringTemplate,
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
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

export type NewRecurringTemplate = Omit<RecurringTemplate, 'id' | 'createdAt'>;

export async function createTemplate(input: NewRecurringTemplate): Promise<RecurringTemplate> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO recurring_templates
       (id, type, name, amount, account_id, to_account_id, category_id, person_id,
        direction, frequency, interval_days, next_due_date, end_date, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    input.active ? 1 : 0,
    createdAt,
  );
  return { ...input, id, createdAt };
}

export async function updateTemplate(id: string, input: NewRecurringTemplate): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE recurring_templates SET
       type = ?, name = ?, amount = ?, account_id = ?, to_account_id = ?,
       category_id = ?, person_id = ?, direction = ?, frequency = ?,
       interval_days = ?, next_due_date = ?, end_date = ?, active = ?
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
    input.active ? 1 : 0,
    id,
  );
}

export async function setTemplateActive(id: string, active: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE recurring_templates SET active = ? WHERE id = ?', active ? 1 : 0, id);
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

export async function getTemplate(id: string): Promise<RecurringTemplate | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<TemplateRow>(
    'SELECT * FROM recurring_templates WHERE id = ?',
    id,
  );
  return row ? fromRow(row) : null;
}

/** Template → pending transaction for one due date; null if malformed. */
function toNewTransaction(t: RecurringTemplate, dueDate: string): NewTransaction | null {
  const base = {
    status: 'pending' as const,
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
 * Foreground evaluation (§4.5): generate pending transactions for every due
 * occurrence, advance next_due_date, deactivate past end_date. The
 * duplicate guard (recurring_id + calendar date) makes repeated app opens
 * idempotent even if a previous run was interrupted mid-way.
 */
export async function evaluateRecurringTemplates(): Promise<number> {
  const db = await getDb();
  const today = format(new Date(), 'yyyy-MM-dd');
  const templates = (await listTemplates()).filter((t) => t.active);
  let generated = 0;

  for (const template of templates) {
    const plan = planDueRuns(template, today);
    for (const dueDate of plan.runDates) {
      const duplicate = await db.getFirstAsync<{ one: number }>(
        `SELECT 1 AS one FROM transactions
         WHERE recurring_id = ? AND date(occurred_at) = date(?)`,
        template.id,
        `${dueDate}T12:00:00.000Z`,
      );
      if (duplicate) continue;
      const input = toNewTransaction(template, dueDate);
      if (!input) continue; // malformed template — skip, don't crash startup
      await insertTransaction(input);
      generated += 1;
    }
    if (plan.runDates.length > 0 || !plan.stillActive) {
      await db.runAsync(
        'UPDATE recurring_templates SET next_due_date = ?, active = ? WHERE id = ?',
        plan.nextDueDate,
        plan.stillActive && template.active ? 1 : 0,
        template.id,
      );
    }
  }
  return generated;
}
