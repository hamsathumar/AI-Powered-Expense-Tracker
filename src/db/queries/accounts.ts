import * as Crypto from 'expo-crypto';

import { getDb } from '@/db/client';
import type { Account, AccountType } from '@/domain/types';

interface AccountRow {
  id: string;
  name: string;
  type: AccountType;
  owner_label: string | null;
  opening_balance: number;
  icon: string | null;
  color: string | null;
  archived: number;
  is_private: number;
  created_at: string;
}

function fromRow(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    ownerLabel: row.owner_label ?? undefined,
    openingBalanceMinor: row.opening_balance,
    icon: row.icon ?? undefined,
    color: row.color ?? undefined,
    archived: row.archived === 1,
    isPrivate: row.is_private === 1,
    createdAt: row.created_at,
  };
}

export interface NewAccount {
  name: string;
  type: AccountType;
  ownerLabel?: string;
  openingBalanceMinor?: number;
  icon?: string;
  color?: string;
  isPrivate?: boolean;
}

export async function createAccount(input: NewAccount): Promise<Account> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO accounts (id, name, type, owner_label, opening_balance, icon, color, is_private, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.name,
    input.type,
    input.ownerLabel ?? null,
    input.openingBalanceMinor ?? 0,
    input.icon ?? null,
    input.color ?? null,
    input.isPrivate ? 1 : 0,
    createdAt,
  );
  return {
    id,
    name: input.name,
    type: input.type,
    ownerLabel: input.ownerLabel,
    openingBalanceMinor: input.openingBalanceMinor ?? 0,
    icon: input.icon,
    color: input.color,
    archived: false,
    isPrivate: input.isPrivate ?? false,
    createdAt,
  };
}

export async function getAccount(id: string): Promise<Account | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<AccountRow>('SELECT * FROM accounts WHERE id = ?', id);
  return row ? fromRow(row) : null;
}

export async function updateAccount(
  id: string,
  changes: Pick<NewAccount, 'name' | 'type' | 'openingBalanceMinor' | 'isPrivate'>,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE accounts SET name = ?, type = ?, opening_balance = ?, is_private = ? WHERE id = ?',
    changes.name,
    changes.type,
    changes.openingBalanceMinor ?? 0,
    changes.isPrivate ? 1 : 0,
    id,
  );
}

/**
 * How many live (pending or approved) transactions touch this account. Used to
 * warn before an opening-balance edit, which shifts every balance derived from it.
 */
export async function countAccountTransactions(accountId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM transactions
     WHERE status != 'rejected' AND (account_id = ? OR to_account_id = ?)`,
    accountId,
    accountId,
  );
  return row?.n ?? 0;
}

/** Ids of every private account, archived ones included — an archived
 *  private account's history must stay private too. */
export async function listPrivateAccountIds(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM accounts WHERE is_private = 1');
  return new Set(rows.map((r) => r.id));
}

/** Soft delete — history stays intact; archived accounts leave all lists. */
export async function archiveAccount(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE accounts SET archived = 1 WHERE id = ?', id);
}

export async function listAccounts(): Promise<Account[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<AccountRow>(
    'SELECT * FROM accounts WHERE archived = 0 ORDER BY created_at',
  );
  return rows.map(fromRow);
}

/**
 * Account balance (technical-plan.md §4.2). Approved transactions only.
 * ALL four types affect balances — the golden rule excludes transfer/lending
 * from REPORTS, never from balances.
 */
const BALANCE_CASE_SQL = `
  CASE
    WHEN t.type = 'expense'  AND t.account_id    = a.id THEN -t.amount
    WHEN t.type = 'income'   AND t.account_id    = a.id THEN  t.amount
    WHEN t.type = 'transfer' AND t.account_id    = a.id THEN -t.amount
    WHEN t.type = 'transfer' AND t.to_account_id = a.id THEN  t.amount
    WHEN t.type = 'lending'  AND t.account_id    = a.id
      AND t.direction IN ('lend','borrow_repayment_made')      THEN -t.amount
    WHEN t.type = 'lending'  AND t.account_id    = a.id
      AND t.direction IN ('lend_repayment_received','borrow')  THEN  t.amount
    ELSE 0
  END`;

export async function getAccountBalanceMinor(accountId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ balance: number }>(
    `SELECT a.opening_balance + COALESCE(SUM(${BALANCE_CASE_SQL}), 0) AS balance
     FROM accounts a
     LEFT JOIN transactions t
       ON t.status = 'approved'
      AND (t.account_id = a.id OR t.to_account_id = a.id)
     WHERE a.id = ?
     GROUP BY a.id`,
    accountId,
  );
  if (!row) throw new Error(`Account not found: ${accountId}`);
  return row.balance;
}

/**
 * Balances for all non-archived accounts in one query. `personalOnly` leaves
 * private accounts out — what the Home / Reports total balance means.
 */
export async function listAccountBalancesMinor(
  { personalOnly = false }: { personalOnly?: boolean } = {},
): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; balance: number }>(
    `SELECT a.id, a.opening_balance + COALESCE(SUM(${BALANCE_CASE_SQL}), 0) AS balance
     FROM accounts a
     LEFT JOIN transactions t
       ON t.status = 'approved'
      AND (t.account_id = a.id OR t.to_account_id = a.id)
     WHERE a.archived = 0${personalOnly ? ' AND a.is_private = 0' : ''}
     GROUP BY a.id`,
  );
  return new Map(rows.map((r) => [r.id, r.balance]));
}
