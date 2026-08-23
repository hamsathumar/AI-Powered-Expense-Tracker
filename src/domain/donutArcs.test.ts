import { describe, expect, it } from '@jest/globals';

import { annularSectorPath, buildArcs, midAngle, type DonutInput } from './donutArcs';

const seg = (id: string, value: number): DonutInput => ({ id, label: id, value, color: '#000' });

const TAU = Math.PI * 2;

describe('buildArcs', () => {
  it('gives each segment its own non-overlapping span', () => {
    const arcs = buildArcs([seg('a', 50), seg('b', 30), seg('c', 20)], 100);
    expect(arcs).toHaveLength(3);
    // The whole point of the fix: no two slices may share an angular range,
    // or they share a hit target and only one is ever tappable.
    for (let i = 1; i < arcs.length; i += 1) {
      expect(arcs[i].startAngle).toBeCloseTo(arcs[i - 1].endAngle);
      expect(arcs[i].endAngle).toBeGreaterThan(arcs[i].startAngle);
    }
  });

  it('sweeps each segment in proportion to its value', () => {
    const arcs = buildArcs([seg('a', 50), seg('b', 30), seg('c', 20)], 100);
    expect(arcs[0].endAngle - arcs[0].startAngle).toBeCloseTo(TAU * 0.5);
    expect(arcs[1].endAngle - arcs[1].startAngle).toBeCloseTo(TAU * 0.3);
    expect(arcs[2].endAngle - arcs[2].startAngle).toBeCloseTo(TAU * 0.2);
  });

  it('starts at 12 o’clock and closes the full circle', () => {
    const arcs = buildArcs([seg('a', 1), seg('b', 1)], 2);
    expect(arcs[0].startAngle).toBeCloseTo(-Math.PI / 2);
    expect(arcs[arcs.length - 1].endAngle).toBeCloseTo(-Math.PI / 2 + TAU, 3);
  });

  it('keeps a lone 100% segment drawable rather than degenerate', () => {
    const [arc] = buildArcs([seg('only', 10)], 10);
    const sweep = arc.endAngle - arc.startAngle;
    expect(sweep).toBeLessThan(TAU);
    expect(sweep).toBeGreaterThan(TAU - 0.001);
  });

  it('drops zero and negative values so they cannot stack invisible hit areas', () => {
    const arcs = buildArcs([seg('a', 10), seg('zero', 0), seg('neg', -5)], 10);
    expect(arcs.map((a) => a.id)).toEqual(['a']);
  });

  it('returns nothing when the total is zero', () => {
    expect(buildArcs([seg('a', 0)], 0)).toEqual([]);
  });

  it('reports each fraction for the label', () => {
    const arcs = buildArcs([seg('a', 25), seg('b', 75)], 100);
    expect(arcs.map((a) => a.fraction)).toEqual([0.25, 0.75]);
  });
});

describe('midAngle', () => {
  it('is halfway through the slice', () => {
    const [arc] = buildArcs([seg('a', 100)], 400); // quarter circle
    expect(midAngle(arc)).toBeCloseTo(-Math.PI / 2 + TAU / 8);
  });
});

describe('annularSectorPath', () => {
  it('draws out along the outer radius and back along the inner one', () => {
    const path = annularSectorPath(50, 50, 40, 25, -Math.PI / 2, 0);
    // Starts at 12 o'clock on the outer radius, ends closed.
    expect(path.startsWith('M 50 10')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    expect(path).toContain('A 40 40');
    expect(path).toContain('A 25 25');
  });

  it('sets the large-arc flag only past a half turn', () => {
    const small = annularSectorPath(0, 0, 10, 5, 0, Math.PI / 2);
    const large = annularSectorPath(0, 0, 10, 5, 0, Math.PI * 1.5);
    expect(small).toContain('A 10 10 0 0 1');
    expect(large).toContain('A 10 10 0 1 1');
  });
});
