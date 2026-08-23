/**
 * Donut geometry — pure maths, no React, so the arc layout is unit-testable.
 *
 * Written after a real bug: the donut originally drew each segment as a full
 * <Circle> with a `strokeDasharray` gap. That paints correctly, but every
 * segment's touch target is the WHOLE ring, so the last-rendered (smallest)
 * segment sat on top and swallowed every tap — you could only ever select one
 * slice. Real wedge paths give each segment a hit area that matches its own
 * visible span, which is what `annularSectorPath` produces.
 */

export interface DonutInput {
  id: string;
  label: string;
  value: number;
  color: string;
}

export interface DonutArc extends DonutInput {
  /** Share of the total, 0–1. */
  fraction: number;
  /** Radians, 0 = 12 o'clock, growing clockwise. */
  startAngle: number;
  endAngle: number;
}

/** 12 o'clock, so the first slice starts where a reader expects it to. */
const START = -Math.PI / 2;
const TAU = Math.PI * 2;

/**
 * A single slice covering the whole circle can't be drawn as one arc — the
 * start and end points coincide and SVG renders nothing. Stopping a hair short
 * keeps it a valid path; the gap is far under a pixel.
 */
const FULL_CIRCLE_EPSILON = 0.0001;

/**
 * Lay segments out as consecutive, non-overlapping wedges, largest-first order
 * preserved. Zero and negative values are dropped: they have no angular span,
 * so they would be invisible but still stack an invisible hit target.
 */
export function buildArcs(segments: DonutInput[], total: number): DonutArc[] {
  const positive = segments.filter((s) => s.value > 0);
  if (total <= 0) return [];

  const arcs: DonutArc[] = [];
  let cursor = START;

  for (const segment of positive) {
    const fraction = segment.value / total;
    const sweep = Math.min(fraction * TAU, TAU - FULL_CIRCLE_EPSILON);
    arcs.push({
      ...segment,
      fraction,
      startAngle: cursor,
      endAngle: cursor + sweep,
    });
    cursor += fraction * TAU;
  }
  return arcs;
}

/** Midpoint angle of an arc — where its percentage label belongs. */
export function midAngle(arc: DonutArc): number {
  return (arc.startAngle + arc.endAngle) / 2;
}

/** Point on a circle at `angle`. */
export function polarPoint(
  cx: number,
  cy: number,
  radius: number,
  angle: number,
): { x: number; y: number } {
  'worklet';
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

/**
 * SVG path for a donut wedge: out along the outer radius, back along the
 * inner one. Filled (not stroked), so the touch target is exactly the wedge.
 */
export function annularSectorPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  // 'worklet' so the sweep-in animation can rebuild the path on the UI thread
  // each frame; the function stays callable from JS exactly as before.
  'worklet';
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  const outerStart = polarPoint(cx, cy, outerRadius, startAngle);
  const outerEnd = polarPoint(cx, cy, outerRadius, endAngle);
  const innerEnd = polarPoint(cx, cy, innerRadius, endAngle);
  const innerStart = polarPoint(cx, cy, innerRadius, startAngle);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}
