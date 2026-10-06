import * as Crypto from 'expo-crypto';

import { isSuspiciousEntityReference } from '@/ai/interpretation/injection';
import { getDb } from '@/db/client';
import {
  INSERT_PERSON_SQL,
  LIST_PEOPLE_BY_NAME_SQL,
  LIST_PEOPLE_SQL,
  LIST_PEOPLE_WITH_NET_SQL,
  SET_PERSON_ORDER_SQL,
} from '@/db/queries/peopleSql';
import type { Person } from '@/domain/types';

/**
 * The last containment boundary for TC-026: an injected phrase reached the
 * People table and became durable, reusable application state. Validation now
 * drops such references long before this point, but People is the one place
 * AI-heard text can become permanent, so the check is repeated HERE — where
 * the write actually happens — rather than trusted to every call site.
 *
 * Applies to manual entry too: a name is a short label, and nothing that reads
 * as an instruction belongs in it.
 */
function assertUsablePersonName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) throw new Error('A person needs a name.');
  if (isSuspiciousEntityReference(trimmed)) {
    throw new Error('That does not look like a person\u2019s name. Use a short name, not a phrase.');
  }
  return trimmed;
}

interface PersonRow {
  id: string;
  name: string;
  unresolved: number;
  sort_order: number;
  created_at: string;
}

function fromRow(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
    unresolved: row.unresolved === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export async function createPerson(name: string, unresolved = false): Promise<Person> {
  const safeName = assertUsablePersonName(name);
  const db = await getDb();
  const id = Crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.runAsync(INSERT_PERSON_SQL, id, safeName, unresolved ? 1 : 0, createdAt);
  const row = await db.getFirstAsync<{ sort_order: number }>(
    'SELECT sort_order FROM people WHERE id = ?',
    id,
  );
  return { id, name: safeName, unresolved, sortOrder: row?.sort_order ?? 0, createdAt };
}

/**
 * `manual` (default) is the user's own order, for anything they look at.
 * `name` is for machine resolution (voice), where a stable order independent
 * of drag-and-drop keeps behaviour predictable.
 */
export async function listPeople(order: 'manual' | 'name' = 'manual'): Promise<Person[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PersonRow>(
    order === 'manual' ? LIST_PEOPLE_SQL : LIST_PEOPLE_BY_NAME_SQL,
  );
  return rows.map(fromRow);
}

/** Persist a new manual order: `ids[0]` becomes first. One transaction, so a
 *  crash can never leave two people sharing a slot. */
export async function savePeopleOrder(ids: string[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < ids.length; i++) {
      await db.runAsync(SET_PERSON_ORDER_SQL, i, ids[i]!);
    }
  });
}

export async function getPerson(id: string): Promise<Person | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<PersonRow>('SELECT * FROM people WHERE id = ?', id);
  return row ? fromRow(row) : null;
}

export async function renamePerson(id: string, name: string): Promise<void> {
  const safeName = assertUsablePersonName(name);
  const db = await getDb();
  await db.runAsync('UPDATE people SET name = ?, unresolved = 0 WHERE id = ?', safeName, id);
}

/** How many transactions reference this person (any status). Used to block a
 *  delete that would orphan lending / bill-split history. */
export async function countTransactionsForPerson(id: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM transactions WHERE person_id = ?',
    id,
  );
  return row?.n ?? 0;
}

/** Delete a person outright. Caller must first ensure no transactions
 *  reference them (see countTransactionsForPerson). */
export async function deletePerson(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM people WHERE id = ?', id);
}

export interface PersonWithNet {
  person: Person;
  netMinor: number;
}

/** Everyone with their §4.3 net balance, in the user's manual order. */
export async function listPeopleWithNetBalances(): Promise<PersonWithNet[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PersonRow & { net: number }>(LIST_PEOPLE_WITH_NET_SQL);
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
