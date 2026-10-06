/**
 * What happened to each AI pending operation this session — the shared truth
 * that keeps every screen showing the same item in step.
 *
 * Why it exists: a pending operation is DELETED from `pending_operations` both
 * when it is approved and when it is rejected, so the database alone cannot
 * tell a screen that still holds the card whether it should now say
 * "Approved" or "Rejected". Every path that consumes a pending operation —
 * Approve now on the voice screen, Approve/Reject on the review screen, the
 * Home queue, bulk approve, and the bill-split / recurring editors — records
 * its outcome here, and any screen still showing that card re-reads on focus
 * or on the change event.
 *
 * Session memory only: the voice "Logged" screen it serves lives no longer
 * than the app process. Pure TypeScript (no React Native) so it is unit-tested.
 */
export type PendingOutcome = 'approved' | 'rejected' | 'saved';

const outcomes = new Map<string, PendingOutcome>();
const listeners = new Set<() => void>();

export function recordPendingOutcome(id: string, outcome: PendingOutcome): void {
  outcomes.set(id, outcome);
  for (const listener of [...listeners]) listener();
}

export function pendingOutcome(id: string): PendingOutcome | null {
  return outcomes.get(id) ?? null;
}

/** Returns an unsubscribe function. */
export function subscribePendingOutcomes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test hook — never called by the app. */
export function resetPendingOutcomesForTests(): void {
  outcomes.clear();
  listeners.clear();
}

/**
 * One card on the voice "Logged" screen. `live` is the current pending row
 * (with any edits made on the review screen); once it is gone the card keeps
 * its last-known content and shows how it was resolved.
 */
export type ConfirmCardState<T> =
  | { id: string; state: 'pending'; item: T }
  | { id: string; state: PendingOutcome | 'gone'; item: T };

/**
 * Reconcile the ids a capture produced against what is still pending. Order
 * is the capture's order, never re-sorted, so cards don't jump around. An id
 * with no live row and no recorded outcome (resolved in a previous session)
 * reads as `gone` — "no longer pending" — rather than offering an action that
 * can only fail.
 */
export function reconcileConfirmCards<T>(
  ids: string[],
  live: Map<string, T>,
  lastKnown: Map<string, T>,
  outcomeOf: (id: string) => PendingOutcome | null = pendingOutcome,
): ConfirmCardState<T>[] {
  const out: ConfirmCardState<T>[] = [];
  for (const id of ids) {
    const current = live.get(id);
    if (current) {
      out.push({ id, state: 'pending', item: current });
      continue;
    }
    const previous = lastKnown.get(id);
    if (!previous) continue; // never seen on this screen — nothing to show
    out.push({ id, state: outcomeOf(id) ?? 'gone', item: previous });
  }
  return out;
}
