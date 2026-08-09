import * as Crypto from 'expo-crypto';

import { getDb } from '@/db/client';
import type { Person } from '@/domain/types';

interface PersonRow {
  id: string;
  name: string;
  unresolved: number;
  created_at: string;
}

function fromRow(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
    unresolved: row.unresolved === 1,
    createdAt: row.created_at,
  };
}

export async function createPerson(name: string, unresolved = false): Promise<Person> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO people (id, name, unresolved, created_at) VALUES (?, ?, ?, ?)',
    id,
    name,
    unresolved ? 1 : 0,
    createdAt,
  );
  return { id, name, unresolved, createdAt };
}

export async function listPeople(): Promise<Person[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PersonRow>('SELECT * FROM people ORDER BY name');
  return rows.map(fromRow);
}

export async function getPerson(id: string): Promise<Person | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<PersonRow>('SELECT * FROM people WHERE id = ?', id);
  return row ? fromRow(row) : null;
}

export async function renamePerson(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE people SET name = ?, unresolved = 0 WHERE id = ?', name, id);
}

export interface PersonWithNet {
  person: Person;
  netMinor: number;
}

/** Everyone with their §4.3 net balance in one query (no N+1). */
export async function listPeopleWithNetBalances(): Promise<PersonWithNet[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PersonRow & { net: number }>(
    `SELECT p.*, COALESCE(SUM(
       CASE t.direction
         WHEN 'lend'                    THEN  t.amount
         WHEN 'lend_repayment_received' THEN -t.amount
         WHEN 'borrow'                  THEN -t.amount
         WHEN 'borrow_repayment_made'   THEN  t.amount
       END), 0) AS net
     FROM people p
     LEFT JOIN transactions t
       ON t.person_id = p.id AND t.type = 'lending' AND t.status = 'approved'
     GROUP BY p.id
     ORDER BY p.name`,
  );
  return rows.map((row) => ({ person: fromRow(row), netMinor: row.net }));
}

/**
 * Person net balance (technical-plan.md §4.3).
 * Positive = they owe the user; negative = the user owes them.
 * Approved lending transactions only.
 */
export async function getPersonNetBalanceMinor(personId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ net: number }>(
    `SELECT COALESCE(SUM(
       CASE direction
         WHEN 'lend'                    THEN  amount
         WHEN 'lend_repayment_received' THEN -amount
         WHEN 'borrow'                  THEN -amount
         WHEN 'borrow_repayment_made'   THEN  amount
       END), 0) AS net
     FROM transactions
     WHERE type = 'lending' AND status = 'approved' AND person_id = ?`,
    personId,
  );
  return row?.net ?? 0;
}

/** Whether the person has pending lending rows (Settle Up hint — spec §3.5). */
export async function hasPendingLending(personId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM transactions
     WHERE type = 'lending' AND status = 'pending' AND person_id = ?`,
    personId,
  );
  return row?.n ?? 0;
}
