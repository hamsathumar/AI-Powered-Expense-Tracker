/**
 * Where the time goes in one voice capture (speed investigation, Phase 0).
 *
 * A 6–7 transaction utterance was taking 2–3 minutes, and nothing recorded
 * why: the first Gemini call, the critic, the repair re-read, the upload, a
 * retry after a rate-limit error and the time spent waiting in the queue all
 * looked the same from the outside. This records each stage's duration and
 * Gemini's own token counts (`usageMetadata`) so the next decision about speed
 * is made from numbers, not guesses.
 *
 * Measurement only — nothing here changes what is sent, read or saved.
 * Pure (apart from `Date.now` in the stopwatch), so the wording is unit-tested.
 */
import type { AudioFacts } from '@/ai/audio';

/** What one Gemini request cost. Filled in by `callGemini` as it goes, so a
 *  call that throws still reports how long it took and why. */
export interface CallMeter {
  ms: number;
  /** HTTP status of the final response, or null when the network failed. */
  status: number | null;
  /** The declared schema was rejected and the call was sent a second time. */
  schemaRetry: boolean;
  promptTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  totalTokens: number | null;
}

export const emptyMeter = (): CallMeter => ({
  ms: 0,
  status: null,
  schemaRetry: false,
  promptTokens: null,
  outputTokens: null,
  thinkingTokens: null,
  totalTokens: null,
});

export type StageName =
  /** Key, model name, reading the recording, loading accounts/people. */
  | 'prepare'
  /** Converting the recording to 16 kHz mono before upload (Phase 1a). */
  | 'shrink'
  /** The main audio → JSON call. */
  | 'interpret'
  /** The compound-utterance auditor. */
  | 'critic'
  /** The re-read the critic asked for. */
  | 'repair'
  /** Validation + resolution + gate (all on the phone). */
  | 'resolve'
  /** Writing the pending operations. */
  | 'save';

export interface StageTiming {
  stage: StageName;
  ms: number;
  /** Present for the stages that call Gemini. */
  call?: CallMeter;
}

export interface VoiceTimings {
  /** From the start of this attempt to the operations being saved. */
  totalMs: number;
  /** From the moment the recording was queued to the start of this attempt —
   *  large when earlier attempts failed or the app was backgrounded. */
  queuedMs: number | null;
  /** 1 for the first try; higher means earlier attempts failed. */
  attempt: number;
  /** Size of the recording sent to Gemini. */
  audioBytes: number | null;
  /** What the recording was and what was sent (Phase 1a). Absent on older records. */
  audio?: AudioFacts | null;
  /** Why the previous attempt failed, when this is a retry ("rate limit…"). */
  previousError: string | null;
  stages: StageTiming[];
}

/** A stopwatch: call the returned function to read the elapsed milliseconds. */
export function stopwatch(now: () => number = Date.now): () => number {
  const start = now();
  return () => Math.max(0, now() - start);
}

/** Bytes represented by a base64 string (without decoding it). */
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

const STAGE_WORDS: Record<StageName, string> = {
  prepare: 'Getting ready (recording, accounts, people)',
  shrink: 'Shrinking the recording for upload',
  interpret: 'Gemini reading the recording',
  critic: 'Second check (critic)',
  repair: 'Re-read the critic asked for',
  resolve: 'Checking and matching on the phone',
  save: 'Saving to the review queue',
};

export function seconds(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function describeCall(call: CallMeter): string {
  const parts: string[] = [];
  if (call.outputTokens !== null) parts.push(`${call.outputTokens} tokens out`);
  if (call.thinkingTokens) parts.push(`${call.thinkingTokens} thinking`);
  if (call.promptTokens !== null) parts.push(`${call.promptTokens} in`);
  if (call.schemaRetry) parts.push('sent twice (schema rejected)');
  if (call.status !== null && call.status !== 200) parts.push(`HTTP ${call.status}`);
  if (call.status === null) parts.push('no response');
  return parts.join(', ');
}

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

/** "61 s recording, 3842 KB → 1919 KB sent (16 kHz mono 32-bit → 16 kHz mono 16-bit)". */
export function describeAudio(a: AudioFacts): string {
  const length = a.durationSec !== null ? `${Math.round(a.durationSec)} s recording, ` : 'recording ';
  if (!a.shrunk) return `${length}${kb(a.sentBytes)} sent as recorded`;
  const rate = a.sampleRate !== null ? `${(a.sampleRate / 1000).toFixed(a.sampleRate % 1000 ? 1 : 0)} kHz` : '?';
  const channels = a.channels === 1 ? 'mono' : a.channels === 2 ? 'stereo' : `${a.channels ?? '?'} ch`;
  // The bit depth is shown too: a 16 kHz recording at 32-bit read as
  // "16 kHz mono → 16 kHz mono", which hid what actually changed.
  const bits = a.bitsPerSample !== null ? ` ${a.bitsPerSample}-bit` : '';
  return `${length}${kb(a.originalBytes)} → ${kb(a.sentBytes)} sent (${rate} ${channels}${bits} → 16 kHz mono 16-bit)`;
}

/** One plain line per stage, slowest marked — shared by the sheet and the report. */
export function describeTimings(t: VoiceTimings): { summary: string; lines: string[] } {
  const slowest = t.stages.reduce<StageTiming | null>((a, s) => (!a || s.ms > a.ms ? s : a), null);
  const lines = t.stages.map((s) => {
    const share = t.totalMs > 0 ? ` (${Math.round((s.ms / t.totalMs) * 100)}%)` : '';
    const call = s.call ? describeCall(s.call) : '';
    const mark = slowest && s === slowest && t.stages.length > 1 ? ' ← slowest' : '';
    return `${STAGE_WORDS[s.stage]}: ${seconds(s.ms)}${share}${call ? ` — ${call}` : ''}${mark}`;
  });
  const waited =
    t.queuedMs !== null && t.queuedMs >= 1000 ? `, after waiting ${seconds(t.queuedMs)} in the queue` : '';
  const attempt = t.attempt > 1 ? ` (attempt ${t.attempt} — earlier tries failed)` : '';
  if (t.previousError) lines.push(`Previous attempt failed: ${t.previousError}`);
  const calls = t.stages.filter((s) => s.call).length;
  const audio = t.audio ? ` · ${describeAudio(t.audio)}` : t.audioBytes !== null ? ` · recording ${Math.round(t.audioBytes / 1024)} KB` : '';
  return {
    summary: `Took ${seconds(t.totalMs)}${waited}${attempt} · ${calls} Gemini call${calls === 1 ? '' : 's'}${audio}`,
    lines,
  };
}

function parseAudio(raw: unknown): AudioFacts | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Partial<AudioFacts>;
  if (typeof a.originalBytes !== 'number' || typeof a.sentBytes !== 'number') return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    durationSec: n(a.durationSec),
    sampleRate: n(a.sampleRate),
    channels: n(a.channels),
    bitsPerSample: n(a.bitsPerSample),
    originalBytes: a.originalBytes,
    sentBytes: a.sentBytes,
    shrunk: a.shrunk === true,
  };
}

/** Read a stored timings object back; anything malformed → null. */
export function parseTimings(raw: unknown): VoiceTimings | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Partial<VoiceTimings>;
  if (typeof t.totalMs !== 'number' || !Array.isArray(t.stages)) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const stages = t.stages
    .filter((s): s is StageTiming => !!s && typeof s === 'object' && typeof s.ms === 'number' && s.stage in STAGE_WORDS)
    .map((s) => {
      const c = s.call as Partial<CallMeter> | undefined;
      return {
        stage: s.stage,
        ms: s.ms,
        ...(c && typeof c === 'object'
          ? {
              call: {
                ms: num(c.ms) ?? 0,
                status: num(c.status),
                schemaRetry: c.schemaRetry === true,
                promptTokens: num(c.promptTokens),
                outputTokens: num(c.outputTokens),
                thinkingTokens: num(c.thinkingTokens),
                totalTokens: num(c.totalTokens),
              },
            }
          : {}),
      };
    });
  return {
    totalMs: t.totalMs,
    queuedMs: num(t.queuedMs),
    attempt: num(t.attempt) ?? 1,
    audioBytes: num(t.audioBytes),
    audio: parseAudio(t.audio),
    previousError: typeof t.previousError === 'string' ? t.previousError.slice(0, 300) : null,
    stages,
  };
}
