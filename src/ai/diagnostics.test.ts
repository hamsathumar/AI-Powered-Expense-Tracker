/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from '@jest/globals';

import {
  buildDiagnostics,
  describeCritic,
  diagnosticsReport,
  MAX_RESPONSE_CHARS,
  parseDiagnostics,
} from './diagnostics';
import type { ResolvedOperation } from './interpretation/types';

const op = (over: Partial<ResolvedOperation> = {}): ResolvedOperation => ({
  localId: 'c-0',
  kind: 'expense',
  operation: 'expense',
  amountMinor: 20000,
  amountProvenance: 'USER_EXPLICIT',
  account: null,
  toAccount: null,
  category: null,
  person: null,
  direction: null,
  requestedLabel: null,
  dateExpression: null,
  name: 'Other Expense',
  conflicts: [],
  transcript: '',
  specialized: null,
  ...over,
});

const sample = () =>
  buildDiagnostics({
    model: 'gemini-3.5-flash-lite',
    transcript: 'Transfer 5000 from Room to BOC and note as 200 left',
    critic: 'kept_original',
    criticMissing: ['200 — “note as 200 left”'],
    validationIssues: ['operation built from a number inside a dictated note was flagged', 'operation built from a number inside a dictated note was flagged'],
    rawResponse: { candidates: [{ operation: 'expense', amount: { value: 200 } }] },
    repairedResponse: { candidates: [] },
    operations: [{ op: op(), blockers: [{ code: 'account_unresolved', message: 'No account selected.' }] }],
    now: new Date('2026-10-07T08:00:00.000Z'),
  });

describe('voice diagnostics (Phase C)', () => {
  it('records the reading, the critic, the adjustments (de-duplicated) and what blocks each item', () => {
    const d = sample();
    expect(d.model).toBe('gemini-3.5-flash-lite');
    expect(d.validationIssues).toHaveLength(1);
    expect(d.operations).toEqual([
      { name: 'Other Expense', kind: 'expense', amountMinor: 20000, blockers: ['No account selected.'] },
    ]);
    expect(d.rawResponse).toContain('"operation": "expense"');
  });

  it('round-trips through storage', () => {
    const d = sample();
    expect(parseDiagnostics(JSON.stringify(d))).toEqual(d);
  });

  it('reads nothing from malformed, missing or future-version records', () => {
    expect(parseDiagnostics(null)).toBeNull();
    expect(parseDiagnostics('{oops')).toBeNull();
    expect(parseDiagnostics(JSON.stringify({ ...sample(), version: 99 }))).toBeNull();
  });

  it('caps a huge model response so one capture cannot bloat the database', () => {
    const huge = { text: 'x'.repeat(MAX_RESPONSE_CHARS * 2) };
    const d = buildDiagnostics({ model: 'm', transcript: '', critic: 'not_needed', validationIssues: [], rawResponse: huge, operations: [] });
    expect(d.rawResponse.length).toBeLessThan(MAX_RESPONSE_CHARS + 200);
    expect(d.rawResponse).toMatch(/truncated/);
    expect(d.repairedResponse).toBeNull();
  });

  it('the shareable report reads summary-first and says whether the re-read was used', () => {
    const report = diagnosticsReport(sample());
    expect(report.indexOf('Result:')).toBeLessThan(report.indexOf('Gemini returned:'));
    expect(report).toContain('Other Expense (expense, 200.00) — blocked: No account selected.');
    expect(report).toContain('Re-read (not used):');
    expect(report).toContain(describeCritic('kept_original'));
  });

  it('never contains the API key — there is no field that could hold it', () => {
    expect(Object.keys(sample()).sort()).toEqual(
      [
        'at',
        'critic',
        'criticDuplicated',
        'criticMissing',
        'model',
        'operations',
        'rawResponse',
        'repairedResponse',
        'transcript',
        'validationIssues',
        'version',
      ].sort(),
    );
  });
});

describe('migration 9 — voice_jobs.diagnostics', () => {
  const source = readFileSync(join(__dirname, '../db/migrations.ts'), 'utf8');
  const v5 = source.match(/version: 5,[\s\S]*?await db\.execAsync\(`([\s\S]*?)`\);/)![1]!;
  const v9 = source.match(/version: 9,[\s\S]*?await db\.execAsync\(`([\s\S]*?)`\);/)![1]!;

  it('adds the column; existing jobs survive with no record', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(v5);
    db.exec(`INSERT INTO voice_jobs (id, audio_uri, audio_mime, status, created_at, updated_at)
             VALUES ('j1', 'file:///a.wav', 'audio/wav', 'done', 'x', 'x')`);
    db.exec(v9);
    const row = db.prepare('SELECT id, diagnostics FROM voice_jobs').get() as { id: string; diagnostics: string | null };
    expect(row).toEqual({ id: 'j1', diagnostics: null });
    db.close();
  });
});
