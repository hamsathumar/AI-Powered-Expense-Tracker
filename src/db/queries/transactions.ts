import * as Crypto from 'expo-crypto';

import { getDb } from '@/db/client';
import type {
  ConfidenceFlag,
  LendingDirection,
  Transaction,
  TransactionSource,
  TransactionStatus,
  TransactionType,
} from '@/domain/types';

interface TransactionRow {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  direction: LendingDirection | null;
  name: string;
  amount: number;
  description: string | null;
  occurred_at: string;
  account_id: string | null;
  to_account_id: string | null;
  category_id: string | null;
  person_id: string | null;
  source: TransactionSource;
  transcript: string | null;
  confidence_flags: string | null;
  bill_split_id: string | null;
  recurring_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Row → domain union. The DB can't express the union's invariants, so this
 * mapper re-asserts them: a row that violates the type rules throws rather
 * than producing an impossible `Transaction`.
 */
function fromRow(row: TransactionRow): Transaction {
  const base = {
    id: row.id,
    status: row.status,
    name: row.name,
    amountMinor: row.amount,
    description: row.description ?? undefined,
    occurredAt: row.occurred_at,
    source: row.source,
    transcript: row.transcript ?? undefined,
    confidenceFlags: row.confidence_flags
      ? (JSON.parse(row.confidence_flags) as ConfidenceFlag[])
      : [],
    billSplitId: row.bill_split_id ?? undefined,
    recurringId: row.recurring_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  switch (row.type) {
    case 'expense':
    case 'income':
      if (!row.account_id || !row.category_id) {
        throw new Error(`Corrupt ${row.type} row ${row.id}: missing account/category`);
      }
      return {
        ...base,
        type: row.type,
        accountId: row.account_id,
        categoryId: row.category_id,
        personId: row.person_id ?? undefined,
      };
    case 'transfer':
      if (!row.account_id || !row.to_account_id) {
        throw new Error(`Corrupt transfer row ${row.id}: missing account(s)`);
      }
      return {
        ...base,
        type: 'transfer',
        accountId: row.account_id,
        toAccountId: row.to_account_id,
      };
    case 'lending':
      if (!row.account_id || !row.person_id || !row.direction) {
        throw new Error(`Corrupt lending row ${row.id}: missing account/person/direction`);
      }
      return {
        ...base,
        type: 'lending',
        accountId: row.account_id,
        personId: row.person_id,
        direction: row.direction,
      };
  }
}

/**
 * Distributes Omit over each member of a union. A plain `Omit<Transaction, K>`
 * would collapse the union to its common properties and lose the
 * discriminated variants (categoryId, direction, toAccountId, …).
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Everything the caller provides; id/timestamps are generated on insert. */
export type NewTransaction = DistributiveOmit<Transaction, 'id' | 'createdAt' | 'updatedAt'>;

export async function insertTransaction(input: NewTransaction): Promise<Transaction> {
  const db = await getDb();
  return insertWithDb(db, input);
}

/**
 * Inserts several transactions in ONE database transaction — all or none.
 * Used by the bill splitter so a half-written split can never exist.
 * (Approval afterwards is still per-row — decision P7.)
 */
export async function insertTransactionsAtomically(
  inputs: NewTransaction[],
): Promise<Transaction[]> {
  const db = await getDb();
  const results: Transaction[] = [];
  await db.withTransactionAsync(async () => {
    for (const input of inputs) {
      results.push(await insertWithDb(db, input));
    }
  });
  return results;
}

async function insertWithDb(
  db: Awaited<ReturnType<typeof getDb>>,
  input: NewTransaction,
): Promise<Transaction> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error(`amountMinor must be a positive integer, got ${input.amountMinor}`);
  }
  if (input.type === 'transfer' && input.accountId === input.toAccountId) {
    throw new Error('Transfer must use two distinct accounts');
  }

  const id = Crypto.randomUUID();
  const now = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO transactions
       (id, type, status, direction, name, amount, description, occurred_at,
        account_id, to_account_id, category_id, person_id,
        source, transcript, confidence_flags, bill_split_id, recurring_id,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.type,
    input.status,
    input.type === 'lending' ? input.direction : null,
    input.name,
    input.amountMinor,
    input.description ?? null,
    input.occurredAt,
    input.accountId,
    input.type === 'transfer' ? input.toAccountId : null,
    input.type === 'expense' || input.type === 'income' ? input.categoryId : null,
    input.type === 'transfer' ? null : (input.personId ?? null),
    input.source,
    input.transcript ?? null,
    input.confidenceFlags.length > 0 ? JSON.stringify(input.confidenceFlags) : null,
    input.billSplitId ?? null,
    input.recurringId ?? null,
    now,
    now,
  );

  return { ...input, id, createdAt: now, updatedAt: now };
}

export async function getTransaction(id: string): Promise<Transaction | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<TransactionRow>(
    'SELECT * FROM transactions WHERE id = ?',
    id,
  );
  return row ? fromRow(row) : null;
}

/** A transaction plus the display names its list row needs (one query, no N+1). */
export interface TransactionListItem {
  tx: Transaction;
  accountName: string | null;
  toAccountName: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  personName: string | null;
}

type JoinedRow = TransactionRow & {
  account_name: string | null;
  to_account_name: string | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  person_name: string | null;
};

const JOINED_SELECT = `
  SELECT t.*,
         a.name  AS account_name,
         ta.name AS to_account_name,
         c.name  AS category_name,
         c.icon  AS category_icon,
         c.color AS category_color,
         p.name  AS person_name
  FROM transactions t
  LEFT JOIN accounts   a  ON a.id  = t.account_id
  LEFT JOIN accounts   ta ON ta.id = t.to_account_id
  LEFT JOIN categories c  ON c.id  = t.category_id
  LEFT JOIN people     p  ON p.id  = t.person_id`;

function toListItem(row: JoinedRow): TransactionListItem {
  return {
    tx: fromRow(row),
    accountName: row.account_name,
    toAccountName: row.to_account_name,
    categoryName: row.category_name,
    categoryIcon: row.category_icon,
    categoryColor: row.category_color,
    personName: row.person_name,
  };
}

/** One transaction with its joined display fields (for the detail view). */
export async function getTransactionItem(id: string): Promise<TransactionListItem | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<JoinedRow>(`${JOINED_SELECT} WHERE t.id = ?`, id);
  return row ? toListItem(row) : null;
}

export interface TransactionListFilter {
  /** Only transactions touching this account — including transfers where it
   *  is the source OR destination (a transfer moves real money through it). */
  accountId?: string;
  /** Case-insensitive substring match on name or description. */
  search?: string;
  limit?: number;
}

export async function listTransactionItems(
  filter: TransactionListFilter = {},
): Promise<TransactionListItem[]> {
  const db = await getDb();
  const where: string[] = ["t.status != 'rejected'"];
  const params: (string | number)[] = [];

  if (filter.accountId) {
    where.push('(t.account_id = ? OR t.to_account_id = ?)');
    params.push(filter.accountId, filter.accountId);
  }
  if (filter.search?.trim()) {
    where.push('(t.name LIKE ? OR t.description LIKE ?)');
    const like = `%${filter.search.trim()}%`;
    params.push(like, like);
  }
  params.push(filter.limit ?? 200);

  const rows = await db.getAllAsync<JoinedRow>(
    `${JOINED_SELECT}
     WHERE ${where.join(' AND ')}
     ORDER BY t.occurred_at DESC
     LIMIT ?`,
    ...params,
  );
  return rows.map(toListItem);
}

export async function listRecentTransactionItems(limit = 50): Promise<TransactionListItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<JoinedRow>(
    `${JOINED_SELECT}
     WHERE t.status != 'rejected'
     ORDER BY t.occurred_at DESC
     LIMIT ?`,
    limit,
  );
  return rows.map(toListItem);
}

/**
 * Approved transactions that occurred on the given local calendar day (any
 * type). Powers Home's "Today" section. `dayISO` is a local 'yyyy-MM-dd'; the
 * `'localtime'` modifier matches the day-grouping convention used across
 * reports so late-evening entries land on the right day.
 */
export async function listApprovedItemsForDay(dayISO: string): Promise<TransactionListItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<JoinedRow>(
    `${JOINED_SELECT}
     WHERE t.status = 'approved' AND date(t.occurred_at, 'localtime') = date(?)
     ORDER BY t.occurred_at DESC`,
    dayISO,
  );
  return rows.map(toListItem);
}

/** Full history involving one person: lending plus tagged expense/income. */
export async function listTransactionItemsForPerson(
  personId: string,
): Promise<TransactionListItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<JoinedRow>(
    `${JOINED_SELECT}
     WHERE t.status != 'rejected' AND t.person_id = ?
     ORDER BY t.occurred_at DESC`,
    personId,
  );
  return rows.map(toListItem);
}

export async function listRecentTransactions(limit = 50): Promise<Transaction[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TransactionRow>(
    'SELECT * FROM transactions ORDER BY occurred_at DESC LIMIT ?',
    limit,
  );
  return rows.map(fromRow);
}

/** The Approval Queue: pending items, oldest first (spec §7). */
export async function listPendingTransactions(): Promise<Transaction[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TransactionRow>(
    "SELECT * FROM transactions WHERE status = 'pending' ORDER BY occurred_at",
  );
  return rows.map(fromRow);
}

/** Queue items with display names, newest day first. */
export async function listPendingTransactionItems(): Promise<TransactionListItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<JoinedRow>(
    `${JOINED_SELECT}
     WHERE t.status = 'pending'
     ORDER BY t.occurred_at DESC`,
  );
  return rows.map(toListItem);
}

/** Bulk approve — one statement, used by the queue's "Approve all". */
export async function approveAllPending(): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    "UPDATE transactions SET status = 'approved', updated_at = ? WHERE status = 'pending'",
    new Date().toISOString(),
  );
  return result.changes;
}

/** Full edit of a (pending) transaction — same shape rules as insert. */
export async function updateTransaction(id: string, input: NewTransaction): Promise<void> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error(`amountMinor must be a positive integer, got ${input.amountMinor}`);
  }
  if (input.type === 'transfer' && input.accountId === input.toAccountId) {
    throw new Error('Transfer must use two distinct accounts');
  }
  const db = await getDb();
  await db.runAsync(
    `UPDATE transactions SET
       type = ?, direction = ?, name = ?, amount = ?, description = ?, occurred_at = ?,
       account_id = ?, to_account_id = ?, category_id = ?, person_id = ?, updated_at = ?
     WHERE id = ?`,
    input.type,
    input.type === 'lending' ? input.direction : null,
    input.name,
    input.amountMinor,
    input.description ?? null,
    input.occurredAt,
    input.accountId,
    input.type === 'transfer' ? input.toAccountId : null,
    input.type === 'expense' || input.type === 'income' ? input.categoryId : null,
    input.type === 'transfer' ? null : (input.personId ?? null),
    new Date().toISOString(),
    id,
  );
}

export async function countPendingTransactions(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM transactions WHERE status = 'pending'",
  );
  return row?.n ?? 0;
}

/** Approve or reject a queue item. */
export async function setTransactionStatus(
  id: string,
  status: Exclude<TransactionStatus, 'pending'>,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE transactions SET status = ?, updated_at = ? WHERE id = ?',
    status,
    new Date().toISOString(),
    id,
  );
}

export async function deleteTransaction(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM transactions WHERE id = ?', id);
}
