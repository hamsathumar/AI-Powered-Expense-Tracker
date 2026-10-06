/**
 * Ordering of the People list. Three views of the same people:
 *   manual — the order the user dragged them into (stored as `sortOrder`);
 *   name   — A to Z;
 *   owed   — by net balance, most owed TO the user first, most owed BY them last.
 * Only `manual` is editable; the other two are read-only views and never touch
 * the stored order.
 */
export type PeopleSortMode = 'manual' | 'name' | 'owed';
export const DEFAULT_PEOPLE_SORT: PeopleSortMode = 'manual';

export function isPeopleSortMode(value: string | null): value is PeopleSortMode {
  return value === 'manual' || value === 'name' || value === 'owed';
}

interface Sortable {
  person: { name: string; sortOrder: number };
  netMinor: number;
}

function byName(a: Sortable, b: Sortable): number {
  return a.person.name.localeCompare(b.person.name, undefined, { sensitivity: 'base' });
}

export function sortPeople<T extends Sortable>(items: T[], mode: PeopleSortMode): T[] {
  const copy = [...items];
  switch (mode) {
    case 'manual':
      return copy.sort((a, b) => a.person.sortOrder - b.person.sortOrder || byName(a, b));
    case 'name':
      return copy.sort(byName);
    case 'owed':
      return copy.sort((a, b) => b.netMinor - a.netMinor || byName(a, b));
  }
}

/** A copy of `items` with the element at `from` moved to `to`. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return [...items];
  const target = Math.max(0, Math.min(items.length - 1, to));
  const copy = [...items];
  const [moved] = copy.splice(from, 1);
  copy.splice(target, 0, moved!);
  return copy;
}

/**
 * Slot → new order while one row is dragged: the index a row's centre is over,
 * clamped to the list. Pure so the geometry is testable off-device; the
 * 'worklet' markers let the drag gesture call these on the UI thread.
 */
export function slotForOffset(offset: number, slotHeight: number, count: number): number {
  'worklet';
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(offset / slotHeight)));
}

/** Position map after dragging `id` from its slot to `toSlot` (others shift by one). */
export function reflowPositions(
  positions: Record<string, number>,
  id: string,
  toSlot: number,
): Record<string, number> {
  'worklet';
  const from = positions[id];
  if (from === undefined || from === toSlot) return positions;
  const next: Record<string, number> = {};
  for (const key of Object.keys(positions)) {
    const p = positions[key]!;
    if (key === id) next[key] = toSlot;
    else if (from < toSlot && p > from && p <= toSlot) next[key] = p - 1;
    else if (toSlot < from && p >= toSlot && p < from) next[key] = p + 1;
    else next[key] = p;
  }
  return next;
}

/** Keys ordered by their slot. */
export function orderFromPositions(positions: Record<string, number>): string[] {
  return Object.keys(positions).sort((a, b) => positions[a]! - positions[b]!);
}
