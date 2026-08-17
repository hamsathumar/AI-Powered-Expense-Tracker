/**
 * Application-owned pending store for Transaction AI V1.
 *
 * Rows here are `ResolvedOperation`s awaiting review. They are NOT ledger
 * entries — they only become `transactions` (approved) after the final safety
 * gate passes (see src/ai/commitOperation.ts). Storing the full resolved
 * operation as JSON lets the queue re-run resolution + the gate at commit time
 * against live entities, and lets the user resolve missing fields via edits.
 */
import * as Crypto from 'expo-crypto';

import { getDb } from '@/db/client';
import type { ResolvedOperation } from '@/ai/interpretation/types';

export interface PendingOperationRecord {
  id: string;
  op: ResolvedOperation;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  payload: string;
  created_at: string;
  updated_at: string;
}

function fromRow(row: Row): PendingOperationRecord {
  return {
    id: row.id,
    op: JSON.parse(row.payload) as ResolvedOperation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertPendingOperation(op: ResolvedOperation): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO pending_operations
       (id, kind, operation, name, amount, transcript, date_expression, has_conflicts, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    op.kind,
    op.operation,
    op.name,
    op.amountMinor,
    op.transcript || null,
    op.dateExpression ?? null,
    op.conflicts.length > 0 ? 1 : 0,
    JSON.stringify(op),
    now,
    now,
  );
  return id;
}

export async function insertPendingOperations(ops: ResolvedOperation[]): Promise<string[]> {
  const ids: string[] = [];
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const op of ops) ids.push(await insertPendingOperation(op));
  });
  return ids;
}

export async function listPendingOperations(): Promise<PendingOperationRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    'SELECT id, payload, created_at, updated_at FROM pending_operations ORDER BY created_at DESC',
  );
  return rows.map(fromRow);
}

export async function getPendingOperation(id: string): Promise<PendingOperationRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>(
    'SELECT id, payload, created_at, updated_at FROM pending_operations WHERE id = ?',
    id,
  );
  return row ? fromRow(row) : null;
}

/** Persist user edits (resolved ids, cleared conflicts, etc.). */
export async function updatePendingOperation(id: string, op: ResolvedOperation): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE pending_operations
       SET kind = ?, operation = ?, name = ?, amount = ?, date_expression = ?, has_conflicts = ?, payload = ?, updated_at = ?
     WHERE id = ?`,
    op.kind,
    op.operation,
    op.name,
    op.amountMinor,
    op.dateExpression ?? null,
    op.conflicts.length > 0 ? 1 : 0,
    JSON.stringify(op),
    new Date().toISOString(),
    id,
  );
}

export async function deletePendingOperation(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM pending_operations WHERE id = ?', id);
}

export async function countPendingOperations(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM pending_operations',
  );
  return row?.n ?? 0;
}
