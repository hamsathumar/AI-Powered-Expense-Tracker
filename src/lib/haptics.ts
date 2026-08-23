/**
 * Thin haptic wrappers used across the app.
 *
 * A tactile tap the instant something *happens* makes the app feel physical;
 * a success notification confirms money actually moved. All calls are
 * fire-and-forget and swallow errors — haptics are an enhancement, never a
 * dependency, and are silently absent on devices without a Taptic Engine.
 *
 * Gating lives here rather than at each call site: `FeedbackProvider` pushes
 * the user's preference in via `setHapticsEnabled`, so services and queries can
 * fire haptics without threading a setting through every function.
 *
 * Restraint is the design rule (design-system.md §7 — "motion confirms actions;
 * it never performs"). Plain navigation and scrolling stay silent, so that when
 * the phone does buzz, it meant something.
 */
import * as Haptics from 'expo-haptics';

let enabled = true;

/** Set from FeedbackProvider whenever the user's preference loads or changes. */
export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

export function areHapticsEnabled(): boolean {
  return enabled;
}

/** Crisp tap when the user starts speaking. */
export function hapticStart(): void {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Softer tap when capture stops and processing begins. */
export function hapticStop(): void {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
}

/** Success notification when a transaction is logged / approved / settled. */
export function hapticSuccess(): void {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/**
 * Light selection tick — the workhorse. Tabs, chips, segmented controls,
 * toggles: anything where the user changed *what they are looking at*.
 */
export function hapticTick(): void {
  if (!enabled) return;
  Haptics.selectionAsync().catch(() => {});
}

/** Warning buzz when something couldn't be done, or was rejected/deleted. */
export function hapticError(): void {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

/** Firm tap for a committing press — primary buttons, FAB, swipe actions. */
export function hapticPress(): void {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
