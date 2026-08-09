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
}

export async function createAccount(input: NewAccount): Promise<Account> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO accounts (id, name, type, owner_label, opening_balance, icon, color, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.name,
    input.type,
    input.ownerLabel ?? null,
    input.openingBalanceMinor ?? 0,
    input.icon ?? null,
    input.color ?? null,
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
    createdAt,
  };
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

/** Balances for all non-archived accounts in one query. */
export async function listAccountBalancesMinor(): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; balance: number }>(
    `SELECT a.id, a.opening_balance + COALESCE(SUM(${BALANCE_CASE_SQL}), 0) AS balance
     FROM accounts a
     LEFT JOIN transactions t
       ON t.status = 'approved'
      AND (t.account_id = a.id OR t.to_account_id = a.id)
     WHERE a.archived = 0
     GROUP BY a.id`,
  );
  return new Map(rows.map((r) => [r.id, r.balance]));
}
