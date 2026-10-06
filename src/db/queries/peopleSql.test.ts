/// <reference types="node" />
/**
 * Runs migration 7 and the people SQL against a REAL SQLite engine, with the
 * schema and migration read straight out of `migrations.ts` so this cannot
 * drift from what ships.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import {
  INSERT_PERSON_SQL,
  LIST_PEOPLE_BY_NAME_SQL,
  LIST_PEOPLE_SQL,
  LIST_PEOPLE_WITH_NET_SQL,
  SET_PERSON_ORDER_SQL,
} from './peopleSql';

const source = readFileSync(join(__dirname, '..', 'migrations.ts'), 'utf8');

function schemaV1(): string {
  const m = source.match(/const SCHEMA_V1 = `([\s\S]*?)`;/);
  if (!m) throw new Error('SCHEMA_V1 not found');
  return m[1]!;
}
function migration7(): string {
  const m = source.match(/version: 7,[\s\S]*?await db\.execAsync\(`([\s\S]*?)`\);/);
  if (!m) throw new Error('migration 7 not found');
  return m[1]!;
}

let db: DatabaseSync;
const names = () => (db.prepare(LIST_PEOPLE_SQL).all() as { name: string }[]).map((r) => r.name);

function addPerson(id: string, name: string) {
  db.prepare(INSERT_PERSON_SQL).run(id, name, 0, '2026-08-01T00:00:00.000Z');
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(schemaV1());
});
afterEach(() => db.close());

describe('migration 7 — people.sort_order', () => {
  it('numbers existing people by name so nothing visibly moves', () => {
    for (const [id, name] of [['1', 'Zed'], ['2', 'Anu'], ['3', 'Kamal']]) {
      db.prepare('INSERT INTO people (id, name, unresolved, created_at) VALUES (?, ?, 0, ?)').run(
        id,
        name,
        '2026-08-01T00:00:00.000Z',
      );
    }
    db.exec(migration7());
    const rows = db.prepare('SELECT name, sort_order FROM people ORDER BY sort_order').all() as {
      name: string;
      sort_order: number;
    }[];
    expect(rows.map((r) => r.name)).toEqual(['Anu', 'Kamal', 'Zed']);
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2]);
  });

  it('gives duplicate names distinct slots', () => {
    for (const id of ['b', 'a']) {
      db.prepare('INSERT INTO people (id, name, unresolved, created_at) VALUES (?, ?, 0, ?)').run(
        id,
        'Sam',
        '2026-08-01T00:00:00.000Z',
      );
    }
    db.exec(migration7());
    const orders = (db.prepare('SELECT sort_order FROM people').all() as { sort_order: number }[])
      .map((r) => r.sort_order)
      .sort();
    expect(orders).toEqual([0, 1]);
  });

  it('is fine on an empty table', () => {
    expect(() => db.exec(migration7())).not.toThrow();
  });
});

describe('people SQL', () => {
  beforeEach(() => db.exec(migration7()));

  it('appends new people at the end', () => {
    addPerson('1', 'Zed');
    addPerson('2', 'Anu');
    addPerson('3', 'Kamal');
    expect(names()).toEqual(['Zed', 'Anu', 'Kamal']);
  });

  it('saves a manual order and lists by it; name order stays available', () => {
    addPerson('1', 'Zed');
    addPerson('2', 'Anu');
    addPerson('3', 'Kamal');
    const set = db.prepare(SET_PERSON_ORDER_SQL);
    ['3', '1', '2'].forEach((id, i) => set.run(i, id));
    expect(names()).toEqual(['Kamal', 'Zed', 'Anu']);
    expect((db.prepare(LIST_PEOPLE_BY_NAME_SQL).all() as { name: string }[]).map((r) => r.name)).toEqual([
      'Anu',
      'Kamal',
      'Zed',
    ]);
  });

  it('a person added after a reorder lands last, even after deletes', () => {
    addPerson('1', 'A');
    addPerson('2', 'B');
    db.prepare('DELETE FROM people WHERE id = ?').run('2');
    addPerson('3', 'C');
    expect(names()).toEqual(['A', 'C']);
  });

  it('the balance list keeps manual order and still sums approved lending only', () => {
    addPerson('1', 'Zed');
    addPerson('2', 'Anu');
    db.prepare("INSERT INTO accounts (id, name, type, opening_balance, created_at) VALUES ('a','Cash','cash',0,'x')").run();
    const ins = db.prepare(
      `INSERT INTO transactions (id, type, status, name, amount, occurred_at, source, direction, account_id, person_id, created_at, updated_at)
       VALUES (?, 'lending', ?, 'x', ?, '2026-08-01T00:00:00.000Z', 'manual', ?, 'a', ?, 'x', 'x')`,
    );
    ins.run('t1', 'approved', 1000, 'lend', '1');
    ins.run('t2', 'approved', 300, 'lend_repayment_received', '1');
    ins.run('t3', 'pending', 9999, 'lend', '1');
    ins.run('t4', 'approved', 500, 'borrow', '2');
    const rows = db.prepare(LIST_PEOPLE_WITH_NET_SQL).all() as { name: string; net: number }[];
    expect(rows.map((r) => [r.name, r.net])).toEqual([
      ['Zed', 700],
      ['Anu', -500],
    ]);
  });
});
