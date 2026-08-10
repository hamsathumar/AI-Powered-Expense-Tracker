/**
 * Default category seed (spec §3.2). Shared by the initial migration and by
 * "Clear All Data" (which restores a fresh-install state). Icon names are
 * Feather icons; colours cycle through the fixed category palette.
 */
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { categoryPalette } from '@/theme/tokens';

const DEFAULT_EXPENSE_CATEGORIES: [name: string, icon: string][] = [
  ['Food', 'coffee'],
  ['Groceries', 'shopping-cart'],
  ['Transport', 'navigation'],
  ['Rent', 'home'],
  ['Utilities', 'zap'],
  ['Health', 'heart'],
  ['Shopping', 'shopping-bag'],
  ['Entertainment', 'film'],
  ['Education', 'book'],
  ['Gifts', 'gift'],
  ['Personal', 'user'],
  ['Other', 'more-horizontal'],
];

const DEFAULT_INCOME_CATEGORIES: [name: string, icon: string][] = [
  ['Salary', 'briefcase'],
  ['Business', 'trending-up'],
  ['Freelance', 'pen-tool'],
  ['Interest', 'percent'],
  ['Gift', 'gift'],
  ['Refund', 'rotate-ccw'],
  ['Other', 'more-horizontal'],
];

export async function seedDefaultCategories(db: SQLiteDatabase): Promise<void> {
  const insert = await db.prepareAsync(
    `INSERT INTO categories (id, name, kind, icon, color, is_default)
     VALUES ($id, $name, $kind, $icon, $color, 1)`,
  );
  try {
    const seed = async (kind: 'expense' | 'income', list: [string, string][]) => {
      for (const [i, [name, icon]] of list.entries()) {
        await insert.executeAsync({
          $id: Crypto.randomUUID(),
          $name: name,
          $kind: kind,
          $icon: icon,
          $color: categoryPalette[i % categoryPalette.length],
        });
      }
    };
    await seed('expense', DEFAULT_EXPENSE_CATEGORIES);
    await seed('income', DEFAULT_INCOME_CATEGORIES);
  } finally {
    await insert.finalizeAsync();
  }
}
