/**
 * Thin haptic wrappers for the voice flow (design ref: "small sensory details").
 *
 * A tactile tap the instant recording starts/stops makes the mic feel physical;
 * a success notification on a logged transaction confirms it landed. All calls
 * are fire-and-forget and swallow errors — haptics are an enhancement, never a
 * dependency, and are silently absent on devices/simulators without a Taptic
 * Engine.
 */
import * as Haptics from 'expo-haptics';

/** Crisp tap when the user starts speaking. */
export function hapticStart(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Softer tap when capture stops and processing begins. */
export function hapticStop(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
}

/** Success notification when a transaction is logged / approved. */
export function hapticSuccess(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** Light selection tick — used as chips reveal / on approve-now. */
export function hapticTick(): void {
  Haptics.selectionAsync().catch(() => {});
}

/** Warning buzz when something couldn't be logged. */
export function hapticError(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
