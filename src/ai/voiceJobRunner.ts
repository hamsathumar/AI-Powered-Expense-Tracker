/**
 * Durable voice-parse runner (TC-027).
 *
 * The V1 pipeline ran the Gemini call inside the voice screen's React state, so
 * the work was only as durable as that screen: backgrounding the app stalled
 * the parse, navigating away abandoned it, and killing the app lost the
 * recording. Reported behaviour was "processing only continues when I come back
 * to the app" — accurate, and worse than it looked.
 *
 * This module owns the work instead. A capture is written to `voice_jobs`
 * BEFORE any network call, and this runner drains that queue:
 *   - it runs whether or not the voice screen is mounted,
 *   - it resumes anything left unfinished on the next foreground, including
 *     after the app was killed outright,
 *   - it distinguishes "iOS suspended us mid-request" from a genuine failure,
 *     retrying the former for free rather than burning the recording,
 *   - it notifies when a parse lands while the user is looking elsewhere.
 *
 * What it does NOT do — stated plainly because the docs must not overclaim:
 * this is not true iOS background execution. A suspended app runs no
 * JavaScript, and Expo SDK 57 exposes no equivalent of `beginBackgroundTask`.
 * A request that outlives iOS's short post-background grace window resumes on
 * the next foreground rather than completing while away. What is guaranteed is
 * that the work is never LOST and never depends on a particular screen.
 *
 * The safety boundary is untouched: a job produces `pending_operations` only.
 * Nothing here writes to the ledger and nothing here approves anything.
 */
import { AppState } from 'react-native';

import { interpretVoice } from '@/ai/interpretVoice';
import { notifyVoiceParse } from '@/lib/notifications';
import {
  bumpVoiceJobAttempts,
  listUnfinishedVoiceJobs,
  markVoiceJobDone,
  markVoiceJobFailed,
  markVoiceJobNotified,
  markVoiceJobRunning,
  pruneFinishedVoiceJobs,
  requeueVoiceJob,
  type VoiceJob,
} from '@/db/queries/voiceJobs';

/** After this many genuine (non-interruption) failures, stop retrying and let
 *  the user decide. The recording is kept either way. */
const MAX_ATTEMPTS = 3;

type Listener = () => void;

const listeners = new Set<Listener>();
let pumping = false;
/** Set when the app leaves the foreground while a request is in flight. */
let suspendedDuringRequest = false;

/** Subscribe to "something about the job queue changed". */
export function subscribeVoiceJobs(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // a bad subscriber must never stall the queue
    }
  }
}

/** Called by the provider's AppState listener — see src/state/VoiceJobs.tsx. */
export function noteAppSuspended(): void {
  if (pumping) suspendedDuringRequest = true;
}

function summarise(job: VoiceJob, names: string[]): { title: string; body: string } {
  if (names.length === 0) {
    return {
      title: 'Nothing logged',
      body: job.transcript
        ? `Kaasu heard no amount in “${job.transcript.slice(0, 80)}”, so nothing was recorded.`
        : 'Kaasu heard no amount, so nothing was recorded.',
    };
  }
  if (names.length === 1) {
    return { title: '1 transaction ready', body: `${names[0]} is waiting in your review queue.` };
  }
  return {
    title: `${names.length} transactions ready`,
    body: `${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''} are waiting in your review queue.`,
  };
}

/**
 * Run one job to completion. Returns true when the queue should keep draining.
 * Never throws — a job failure is recorded on the row, not propagated.
 */
async function runJob(job: VoiceJob): Promise<void> {
  suspendedDuringRequest = false;
  await markVoiceJobRunning(job.id);
  emit();

  try {
    const parsed = await interpretVoice(job.audioUri, job.audioMime);
    await markVoiceJobDone(job.id, {
      pendingIds: parsed.pendingIds,
      transcript: parsed.transcript,
      unqualifiedCount: parsed.unqualifiedIntents.length,
    });

    // Only tell the user separately when they are not already watching the
    // result appear on the voice screen.
    if (AppState.currentState !== 'active') {
      const { names } = await describeResult(parsed.pendingIds);
      await notifyVoiceParse(summarise(job, names));
      await markVoiceJobNotified(job.id);
    }
    emit();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // iOS killed the socket because we were suspended — that is the platform
    // interrupting us, not a bad recording. Retry for free on the next
    // foreground rather than consuming an attempt.
    if (suspendedDuringRequest) {
      await requeueVoiceJob(job.id);
      emit();
      return;
    }

    const attempts = await bumpVoiceJobAttempts(job.id);
    if (attempts >= MAX_ATTEMPTS) {
      await markVoiceJobFailed(job.id, message);
    } else {
      await requeueVoiceJob(job.id);
    }
    emit();
  }
}

/** Read back the names of the operations a job produced, for the notification. */
async function describeResult(pendingIds: string[]): Promise<{ names: string[] }> {
  if (pendingIds.length === 0) return { names: [] };
  try {
    const { evaluatePendingByIds } = await import('@/ai/commitOperation');
    const items = await evaluatePendingByIds(pendingIds);
    return { names: items.map((i) => i.op.name) };
  } catch {
    return { names: [] };
  }
}

/**
 * Drain the queue. Safe to call as often as you like — concurrent calls
 * collapse into the one already running, and the work is serial so two parses
 * never contend for the network or the database.
 */
export async function pumpVoiceJobs(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    // A bounded loop: a job that keeps requeueing (because the app keeps being
    // suspended) must not spin forever inside one pump.
    for (let round = 0; round < 10; round++) {
      const jobs = await listUnfinishedVoiceJobs();
      const next = jobs[0];
      if (!next) break;
      if (next.attempts >= MAX_ATTEMPTS) {
        await markVoiceJobFailed(next.id, next.error ?? 'Gave up after repeated failures.');
        emit();
        continue;
      }
      await runJob(next);
      // Requeued because we were suspended → stop; the next foreground resumes.
      if (suspendedDuringRequest) break;
    }
    await pruneFinishedVoiceJobs();
  } catch {
    // never let housekeeping take down the app
  } finally {
    pumping = false;
    emit();
  }
}

/** True while a parse is actually in flight. */
export function isPumping(): boolean {
  return pumping;
}
