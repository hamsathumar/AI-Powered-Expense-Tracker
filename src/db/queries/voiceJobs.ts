/**
 * Durable voice-parse jobs (TC-027).
 *
 * A job is a recording that has been captured but not yet interpreted. Storing
 * it means the work outlives the screen that started it AND outlives the app
 * process: whatever is unfinished is picked up again by
 * `src/ai/voiceJobRunner.ts` the next time Kaasu is in the foreground.
 *
 * A job is NOT a financial record. Completing one only creates rows in
 * `pending_operations`, which still face the approval gate before anything
 * reaches the ledger.
 */
import * as Crypto from 'expo-crypto';

import { getDb } from '@/db/client';

export type VoiceJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface VoiceJob {
  id: string;
  audioUri: string;
  audioMime: string;
  /** The on-device transcript captured while speaking (display only). */
  transcript: string;
  status: VoiceJobStatus;
  attempts: number;
  error: string | null;
  /** Ids of the pending operations this job produced, once it is done. */
  pendingIds: string[];
  /** Gemini's own transcript, once the parse has run. */
  resultTranscript: string;
  /** Financial intents heard WITHOUT a grounded amount — preserved, not logged. */
  unqualifiedCount: number;
  notified: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  audio_uri: string;
  audio_mime: string;
  transcript: string | null;
  status: string;
  attempts: number;
  error: string | null;
  pending_ids: string | null;
  result_transcript: string | null;
  unqualified_count: number;
  notified: number;
  created_at: string;
  updated_at: string;
}

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function fromRow(row: Row): VoiceJob {
  return {
    id: row.id,
    audioUri: row.audio_uri,
    audioMime: row.audio_mime,
    transcript: row.transcript ?? '',
    status: (['queued', 'running', 'done', 'failed'] as const).includes(row.status as VoiceJobStatus)
      ? (row.status as VoiceJobStatus)
      : 'failed',
    attempts: row.attempts,
    error: row.error,
    pendingIds: parseIds(row.pending_ids),
    resultTranscript: row.result_transcript ?? '',
    unqualifiedCount: row.unqualified_count,
    notified: row.notified === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT = `SELECT id, audio_uri, audio_mime, transcript, status, attempts, error,
                       pending_ids, result_transcript, unqualified_count, notified,
                       created_at, updated_at
                  FROM voice_jobs`;

export async function enqueueVoiceJob(input: {
  audioUri: string;
  audioMime: string;
  transcript: string;
}): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO voice_jobs (id, audio_uri, audio_mime, transcript, status, attempts, notified, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', 0, 0, ?, ?)`,
    id,
    input.audioUri,
    input.audioMime,
    input.transcript || null,
    now,
    now,
  );
  return id;
}

export async function getVoiceJob(id: string): Promise<VoiceJob | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>(`${SELECT} WHERE id = ?`, id);
  return row ? fromRow(row) : null;
}

/**
 * Jobs still owed work, oldest first. `running` is included on purpose: a job
 * left in that state means the app was suspended or killed mid-request, which
 * is precisely the TC-027 case that must resume rather than be abandoned.
 */
export async function listUnfinishedVoiceJobs(): Promise<VoiceJob[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    `${SELECT} WHERE status IN ('queued', 'running') ORDER BY created_at ASC`,
  );
  return rows.map(fromRow);
}

/** Completed jobs the user has not been told about yet. */
export async function listUnnotifiedVoiceJobs(): Promise<VoiceJob[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    `${SELECT} WHERE status = 'done' AND notified = 0 ORDER BY created_at ASC`,
  );
  return rows.map(fromRow);
}

export async function markVoiceJobRunning(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE voice_jobs SET status = 'running', updated_at = ? WHERE id = ?`,
    new Date().toISOString(),
    id,
  );
}

export interface VoiceJobOutcome {
  pendingIds: string[];
  transcript: string;
  unqualifiedCount: number;
}

export async function markVoiceJobDone(id: string, outcome: VoiceJobOutcome): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE voice_jobs
        SET status = 'done', error = NULL, pending_ids = ?, result_transcript = ?,
            unqualified_count = ?, updated_at = ?
      WHERE id = ?`,
    JSON.stringify(outcome.pendingIds),
    outcome.transcript || null,
    outcome.unqualifiedCount,
    new Date().toISOString(),
    id,
  );
}

export async function markVoiceJobFailed(id: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE voice_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
    error.slice(0, 500),
    new Date().toISOString(),
    id,
  );
}

/**
 * Return a job to the queue without consuming an attempt. Used when the app was
 * suspended mid-request — that is the platform interrupting us, not a failure
 * of the recording.
 */
export async function requeueVoiceJob(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE voice_jobs SET status = 'queued', updated_at = ? WHERE id = ?`,
    new Date().toISOString(),
    id,
  );
}

export async function bumpVoiceJobAttempts(id: string): Promise<number> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE voice_jobs SET attempts = attempts + 1, updated_at = ? WHERE id = ?`,
    new Date().toISOString(),
    id,
  );
  const row = await db.getFirstAsync<{ attempts: number }>(
    'SELECT attempts FROM voice_jobs WHERE id = ?',
    id,
  );
  return row?.attempts ?? 0;
}

export async function markVoiceJobNotified(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE voice_jobs SET notified = 1 WHERE id = ?', id);
}

export async function deleteVoiceJob(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM voice_jobs WHERE id = ?', id);
}

/**
 * Housekeeping: finished jobs are only kept so the UI can show a recent result.
 * Failed jobs are kept longer because the user may still want to retry them.
 */
export async function pruneFinishedVoiceJobs(olderThanHours = 24): Promise<void> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000).toISOString();
  await db.runAsync(`DELETE FROM voice_jobs WHERE status = 'done' AND updated_at < ?`, cutoff);
  await db.runAsync(
    `DELETE FROM voice_jobs WHERE status = 'failed' AND updated_at < ?`,
    new Date(Date.now() - olderThanHours * 7 * 3600_000).toISOString(),
  );
}
