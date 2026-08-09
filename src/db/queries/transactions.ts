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
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error(`amountMinor must be a positive integer, got ${input.amountMinor}`);
  }
  if (input.type === 'transfer' && input.accountId === input.toAccountId) {
    throw new Error('Transfer must use two distinct accounts');
  }

  const db = await getDb();
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
