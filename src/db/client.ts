/**
 * Database open/init singleton.
 *
 * `getDb()` lazily opens the SQLite file once, enables WAL + foreign keys,
 * runs pending migrations, and memoizes the connection promise so every
 * caller shares one database handle.
 */
import * as SQLite from 'expo-sqlite';

import { runMigrations } from '@/db/migrations';

const DB_NAME = 'kaasu.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= init();
  return dbPromise;
}

async function init(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // WAL: faster concurrent reads/writes. foreign_keys is off by default in
  // SQLite and must be enabled per-connection.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await runMigrations(db);
  return db;
}
