import { describe, expect, it } from '@jest/globals';

import {
  moveItem,
  orderFromPositions,
  reflowPositions,
  slotForOffset,
  sortPeople,
} from './peopleOrder';

const p = (name: string, sortOrder: number, netMinor: number) => ({
  person: { name, sortOrder },
  netMinor,
});

describe('sortPeople', () => {
  const list = [p('Kamal', 2, 5000), p('anu', 0, -3000), p('Zed', 1, 0), p('Bala', 3, 12000)];

  it('manual follows the stored order', () => {
    expect(sortPeople(list, 'manual').map((x) => x.person.name)).toEqual(['anu', 'Zed', 'Kamal', 'Bala']);
  });

  it('name is A–Z regardless of case', () => {
    expect(sortPeople(list, 'name').map((x) => x.person.name)).toEqual(['anu', 'Bala', 'Kamal', 'Zed']);
  });

  it('owed puts who owes you most first and who you owe last', () => {
    expect(sortPeople(list, 'owed').map((x) => x.person.name)).toEqual(['Bala', 'Kamal', 'Zed', 'anu']);
  });

  it('never mutates its input, and ties fall back to name', () => {
    const tied = [p('B', 0, 100), p('A', 0, 100)];
    const copy = [...tied];
    expect(sortPeople(tied, 'owed').map((x) => x.person.name)).toEqual(['A', 'B']);
    expect(tied).toEqual(copy);
  });
});

describe('moveItem', () => {
  it('moves down and up', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('clamps and ignores no-ops / bad indexes', () => {
    expect(moveItem(['a', 'b'], 0, 9)).toEqual(['b', 'a']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('drag geometry', () => {
  it('maps a dragged offset to the slot under it, clamped', () => {
    expect(slotForOffset(0, 76, 5)).toBe(0);
    expect(slotForOffset(37, 76, 5)).toBe(0);
    expect(slotForOffset(39, 76, 5)).toBe(1);
    expect(slotForOffset(-200, 76, 5)).toBe(0);
    expect(slotForOffset(9999, 76, 5)).toBe(4);
    expect(slotForOffset(10, 76, 0)).toBe(0);
  });

  it('reflow shifts the rows between old and new slot and keeps slots a permutation', () => {
    const start = { a: 0, b: 1, c: 2, d: 3 };
    const down = reflowPositions(start, 'a', 2);
    expect(down).toEqual({ a: 2, b: 0, c: 1, d: 3 });
    const up = reflowPositions(start, 'd', 1);
    expect(up).toEqual({ a: 0, b: 2, c: 3, d: 1 });
    for (const pos of [down, up]) {
      expect(Object.values(pos).sort()).toEqual([0, 1, 2, 3]);
    }
  });

  it('reflow agrees with moveItem for every from/to pair', () => {
    const keys = ['a', 'b', 'c', 'd', 'e'];
    const start = Object.fromEntries(keys.map((k, i) => [k, i]));
    for (let from = 0; from < keys.length; from++) {
      for (let to = 0; to < keys.length; to++) {
        const viaPositions = orderFromPositions(reflowPositions(start, keys[from]!, to));
        expect(viaPositions).toEqual(moveItem(keys, from, to));
      }
    }
  });

  it('reflow returns the same map when nothing moves', () => {
    const start = { a: 0, b: 1 };
    expect(reflowPositions(start, 'a', 0)).toBe(start);
    expect(reflowPositions(start, 'missing', 1)).toBe(start);
  });
});
