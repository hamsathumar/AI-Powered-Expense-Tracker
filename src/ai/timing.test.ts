/**
 * Speed investigation, Phase 0 — where the time goes in one voice capture.
 * Measurement only: these tests pin the wording, the stored shape, and that
 * `callGemini` reports duration + Gemini's token counts without changing the
 * call itself.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { buildDiagnostics, diagnosticsReport, parseDiagnostics } from './diagnostics';
import { callGemini } from './geminiInterpret';
import {
  base64Bytes,
  describeTimings,
  emptyMeter,
  parseTimings,
  seconds,
  stopwatch,
  type VoiceTimings,
} from './timing';

const sample = (over: Partial<VoiceTimings> = {}): VoiceTimings => ({
  totalMs: 150_000,
  queuedMs: 2_000,
  attempt: 1,
  audioBytes: 512 * 1024,
  previousError: null,
  stages: [
    { stage: 'prepare', ms: 800 },
    {
      stage: 'interpret',
      ms: 70_000,
      call: { ...emptyMeter(), ms: 70_000, status: 200, promptTokens: 9000, outputTokens: 4200, thinkingTokens: 0, totalTokens: 13_200 },
    },
    { stage: 'critic', ms: 9_000, call: { ...emptyMeter(), ms: 9_000, status: 200, outputTokens: 40 } },
    { stage: 'repair', ms: 70_000, call: { ...emptyMeter(), ms: 70_000, status: 200, outputTokens: 4300 } },
    { stage: 'resolve', ms: 30 },
    { stage: 'save', ms: 170 },
  ],
  ...over,
});

describe('describeTimings', () => {
  it('summarises the whole capture and marks the slowest stage', () => {
    const t = describeTimings(sample());
    expect(t.summary).toBe('Took 150 s, after waiting 2.0 s in the queue · 3 Gemini calls · recording 512 KB');
    expect(t.lines[1]).toBe(
      'Gemini reading the recording: 70 s (47%) — 4200 tokens out, 9000 in ← slowest',
    );
    expect(t.lines.filter((l) => l.includes('← slowest'))).toHaveLength(1);
    expect(t.lines[4]).toBe('Checking and matching on the phone: 30 ms (0%)');
  });

  it('says when this was a retry, and why the last try failed', () => {
    const t = describeTimings(sample({ attempt: 2, previousError: 'Gemini rate limit or quota reached. Try again later.' }));
    expect(t.summary).toContain('attempt 2 — earlier tries failed');
    expect(t.lines).toContain('Previous attempt failed: Gemini rate limit or quota reached. Try again later.');
  });

  it('flags a schema retry, thinking tokens and a failed response', () => {
    const t = describeTimings({
      ...sample(),
      stages: [
        { stage: 'interpret', ms: 5000, call: { ...emptyMeter(), ms: 5000, status: 429, schemaRetry: true, thinkingTokens: 800, outputTokens: 10 } },
      ],
    });
    expect(t.lines[0]).toContain('800 thinking');
    expect(t.lines[0]).toContain('sent twice (schema rejected)');
    expect(t.lines[0]).toContain('HTTP 429');
  });

  it('formats durations', () => {
    expect(seconds(250)).toBe('250 ms');
    expect(seconds(2500)).toBe('2.5 s');
    expect(seconds(95_000)).toBe('95 s');
  });
});

describe('helpers', () => {
  it('stopwatch measures from its start', () => {
    let clock = 1000;
    const lap = stopwatch(() => clock);
    clock = 1750;
    expect(lap()).toBe(750);
  });

  it('base64Bytes gives the decoded size', () => {
    expect(base64Bytes('QUJD')).toBe(3); // "ABC"
    expect(base64Bytes('QUI=')).toBe(2);
    expect(base64Bytes('QQ==')).toBe(1);
  });

  it('parseTimings survives junk and keeps only known stages', () => {
    expect(parseTimings(null)).toBeNull();
    expect(parseTimings({ totalMs: 'x' })).toBeNull();
    const t = parseTimings({ totalMs: 10, stages: [{ stage: 'interpret', ms: 5, call: { status: 200 } }, { stage: 'bogus', ms: 1 }] });
    expect(t!.stages).toHaveLength(1);
    expect(t!.stages[0]!.call!.outputTokens).toBeNull();
    expect(t!.attempt).toBe(1);
  });
});

describe('diagnostics carry the timings', () => {
  const build = (timings?: VoiceTimings) =>
    buildDiagnostics({
      model: 'm',
      transcript: 'spent 200 on lunch',
      critic: 'not_needed',
      validationIssues: [],
      rawResponse: {},
      operations: [],
      ...(timings ? { timings } : {}),
    });

  it('round-trips through storage and appears in the shared report', () => {
    const stored = JSON.stringify(build(sample()));
    const back = parseDiagnostics(stored)!;
    expect(back.timings!.totalMs).toBe(150_000);
    const report = diagnosticsReport(back);
    expect(report).toContain('Timing:');
    expect(report).toContain('Took 150 s');
    expect(report.indexOf('Timing:')).toBeLessThan(report.indexOf('Gemini returned:'));
  });

  it('records made before Phase 0 still open, with no timing section', () => {
    const old = build();
    const raw = JSON.parse(JSON.stringify(old)) as Record<string, unknown>;
    delete raw.timings;
    const back = parseDiagnostics(JSON.stringify(raw))!;
    expect(back.timings).toBeNull();
    expect(diagnosticsReport(back)).not.toContain('Timing:');
  });
});

describe('callGemini fills the meter (and changes nothing else)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const reply = (status: number, body: unknown) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    }) as unknown as Response;

  it('records status, duration and Gemini\'s token counts', async () => {
    globalThis.fetch = jest.fn(async () =>
      reply(200, {
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
        usageMetadata: { promptTokenCount: 9000, candidatesTokenCount: 420, thoughtsTokenCount: 12, totalTokenCount: 9432 },
      }),
    ) as unknown as typeof fetch;
    const meter = emptyMeter();
    const out = await callGemini({ apiKey: 'k', model: 'm', systemInstruction: 's', parts: [{ text: 't' }], meter });
    expect(out).toEqual({ ok: true });
    expect(meter).toMatchObject({ status: 200, promptTokens: 9000, outputTokens: 420, thinkingTokens: 12, totalTokens: 9432, schemaRetry: false });
    expect(meter.ms).toBeGreaterThanOrEqual(0);
  });

  it('still reports a call that fails (a rate limit)', async () => {
    globalThis.fetch = jest.fn(async () => reply(429, { error: { message: 'quota' } })) as unknown as typeof fetch;
    const meter = emptyMeter();
    await expect(
      callGemini({ apiKey: 'k', model: 'm', systemInstruction: 's', parts: [{ text: 't' }], meter }),
    ).rejects.toThrow(/rate limit/);
    expect(meter.status).toBe(429);
  });

  it('notes a schema rejection that made the call go twice', async () => {
    const calls: unknown[] = [];
    globalThis.fetch = jest.fn(async (_url: unknown, init: unknown) => {
      calls.push(init);
      return calls.length === 1
        ? reply(400, { error: { message: 'Invalid responseSchema' } })
        : reply(200, { candidates: [{ content: { parts: [{ text: '{}' }] } }] });
    }) as unknown as typeof fetch;
    const meter = emptyMeter();
    await callGemini({ apiKey: 'k', model: 'm', systemInstruction: 's', parts: [{ text: 't' }], responseSchema: {}, meter });
    expect(calls).toHaveLength(2);
    expect(meter.schemaRetry).toBe(true);
    expect(meter.status).toBe(200);
  });

  it('works exactly as before without a meter', async () => {
    globalThis.fetch = jest.fn(async () => reply(200, { candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] })) as unknown as typeof fetch;
    await expect(callGemini({ apiKey: 'k', model: 'm', systemInstruction: 's', parts: [{ text: 't' }] })).resolves.toEqual({ a: 1 });
  });
});
