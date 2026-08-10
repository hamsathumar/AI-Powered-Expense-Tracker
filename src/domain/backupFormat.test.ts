import { describe, expect, it } from '@jest/globals';

import { backupFilename, BACKUP_TABLES, parseBackup, type KaasuBackup } from './backupFormat';

function validBackup(): KaasuBackup {
  const tables = Object.fromEntries(
    BACKUP_TABLES.map((t) => [t, []]),
  ) as unknown as KaasuBackup['tables'];
  return { app: 'Kaasu', version: 1, schemaVersion: 2, exportedAt: '2026-08-10T00:00:00.000Z', tables };
}

describe('parseBackup', () => {
  it('accepts a well-formed backup', () => {
    const json = JSON.stringify(validBackup());
    expect(parseBackup(json).app).toBe('Kaasu');
  });

  it('rejects non-JSON', () => {
    expect(() => parseBackup('not json {')).toThrow(/JSON/);
  });

  it('rejects a file from a different app', () => {
    const bad = { ...validBackup(), app: 'SomethingElse' };
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(/Kaasu backup/);
  });

  it('rejects a newer backup version', () => {
    const bad = { ...validBackup(), version: 99 };
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(/newer version/);
  });

  it('rejects a backup missing a table', () => {
    const backup = validBackup();
    const bad = { ...backup, tables: { ...backup.tables, transactions: undefined } };
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(/transactions/);
  });
});

describe('backupFilename', () => {
  it('includes app name and a timestamp', () => {
    const name = backupFilename(new Date('2026-08-10T09:05:00'));
    expect(name).toBe('kaasu-backup-20260810-0905.json');
  });
});
