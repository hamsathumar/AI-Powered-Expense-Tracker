/**
 * Count-up maths for animated money figures — pure, so the interpolation and
 * its edge cases are testable without a renderer.
 *
 * Amounts are integer minor units everywhere in the app, and that holds during
 * the animation too: every intermediate frame is a whole number of cents, so a
 * paused or interrupted count can never display a fractional cent.
 */

/** Decelerating curve — fast at first, settling gently. No overshoot: this is
 *  a money app, and a figure that bounces past its value reads as wrong. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/** Value at `progress` (0–1) along the count, in whole minor units. */
export function countUpValue(fromMinor: number, toMinor: number, progress: number): number {
  if (progress <= 0) return fromMinor;
  if (progress >= 1) return toMinor;
  return Math.round(fromMinor + (toMinor - fromMinor) * easeOutCubic(progress));
}

/**
 * Whether a change is worth animating. Counting from 0 to 0, or between two
 * values a frame apart, is just noise — snap instead.
 */
export function shouldCountUp(fromMinor: number, toMinor: number): boolean {
  return fromMinor !== toMinor;
}
