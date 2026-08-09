import * as Crypto from 'expo-crypto';

import { getDb } from '@/db/client';
import type { Category, CategoryKind } from '@/domain/types';

interface CategoryRow {
  id: string;
  name: string;
  kind: CategoryKind;
  icon: string | null;
  color: string | null;
  is_default: number;
  archived: number;
}

function fromRow(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    icon: row.icon ?? undefined,
    color: row.color ?? undefined,
    isDefault: row.is_default === 1,
    archived: row.archived === 1,
  };
}

/** The two kinds are separate lists (spec §3.2) — always query by kind. */
export async function listCategories(kind: CategoryKind): Promise<Category[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<CategoryRow>(
    'SELECT * FROM categories WHERE kind = ? AND archived = 0 ORDER BY name',
    kind,
  );
  return rows.map(fromRow);
}

export interface NewCategory {
  name: string;
  kind: CategoryKind;
  icon?: string;
  color?: string;
}

export async function getCategory(id: string): Promise<Category | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<CategoryRow>('SELECT * FROM categories WHERE id = ?', id);
  return row ? fromRow(row) : null;
}

export async function updateCategory(
  id: string,
  changes: Pick<NewCategory, 'name' | 'icon' | 'color'>,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?',
    changes.name,
    changes.icon ?? null,
    changes.color ?? null,
    id,
  );
}

/** Soft delete — existing transactions keep their category reference. */
export async function archiveCategory(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE categories SET archived = 1 WHERE id = ?', id);
}

export async function createCategory(input: NewCategory): Promise<Category> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  await db.runAsync(
    `INSERT INTO categories (id, name, kind, icon, color, is_default)
     VALUES (?, ?, ?, ?, ?, 0)`,
    id,
    input.name,
    input.kind,
    input.icon ?? null,
    input.color ?? null,
  );
  return { id, ...input, isDefault: false, archived: false };
}
