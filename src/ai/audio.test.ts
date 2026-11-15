/// <reference types="node" />
/**
 * Voice speed, Phase 1a — shrinking the recording before upload.
 */
import { describe, expect, it } from '@jest/globals';

import {
  base64ToBytes,
  bytesToBase64,
  encodeWav16,
  parseWav,
  resample,
  shrinkWavBase64,
  TARGET_SAMPLE_RATE,
} from './audio';
import { describeAudio } from './timing';

/** A WAV like iOS writes: optional extra chunk before `data`. */
function makeWav(opts: {
  sampleRate: number;
  channels: number;
  bits: 16 | 32;
  float?: boolean;
  seconds: number;
  tone?: number;
  extensible?: boolean;
  extraChunk?: boolean;
  /** Size of the extra chunk's body (default 12). */
  extraSize?: number;
}): Uint8Array {
  const frames = Math.round(opts.sampleRate * opts.seconds);
  const width = opts.bits / 8;
  const dataBytes = frames * opts.channels * width;
  const fmtSize = opts.extensible ? 40 : 16;
  const extraSize = opts.extraSize ?? 12;
  const extra = opts.extraChunk ? 8 + extraSize : 0;
  const total = 12 + 8 + fmtSize + extra + 8 + dataBytes;
  const bytes = new Uint8Array(total);
  const v = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => (bytes[at + i] = ch.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, total - 8, true);
  text(8, 'WAVE');
  let p = 12;
  text(p, 'fmt ');
  v.setUint32(p + 4, fmtSize, true);
  v.setUint16(p + 8, opts.extensible ? 0xfffe : opts.float ? 3 : 1, true);
  v.setUint16(p + 10, opts.channels, true);
  v.setUint32(p + 12, opts.sampleRate, true);
  v.setUint32(p + 16, opts.sampleRate * opts.channels * width, true);
  v.setUint16(p + 20, opts.channels * width, true);
  v.setUint16(p + 22, opts.bits, true);
  if (opts.extensible) {
    v.setUint16(p + 24, 22, true);
    v.setUint16(p + 32, opts.float ? 3 : 1, true); // sub-format GUID's first two bytes
  }
  p += 8 + fmtSize;
  if (opts.extraChunk) {
    text(p, 'FLLR');
    v.setUint32(p + 4, extraSize, true);
    p += 8 + extraSize;
  }
  text(p, 'data');
  v.setUint32(p + 4, dataBytes, true);
  p += 8;
  for (let f = 0; f < frames; f++) {
    const s = opts.tone ? 0.5 * Math.sin((2 * Math.PI * opts.tone * f) / opts.sampleRate) : 0;
    for (let c = 0; c < opts.channels; c++) {
      const at = p + (f * opts.channels + c) * width;
      if (opts.float) v.setFloat32(at, s, true);
      else if (opts.bits === 16) v.setInt16(at, Math.round(s * 32767), true);
      else v.setInt32(at, Math.round(s * 2147483647), true);
    }
  }
  return bytes;
}

const toB64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

/** RMS of a 16-bit mono WAV's samples. */
function rms(wav: Uint8Array): number {
  const info = parseWav(wav)!;
  const v = new DataView(wav.buffer, wav.byteOffset + info.dataOffset, info.dataBytes);
  let sum = 0;
  const n = info.dataBytes / 2;
  for (let i = 0; i < n; i++) sum += (v.getInt16(i * 2, true) / 32768) ** 2;
  return Math.sqrt(sum / n);
}

describe('base64', () => {
  it('round-trips exactly, matching node\'s own encoder', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 1000, 8195]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 37 + 11) & 255);
      const b64 = bytesToBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString('base64'));
      expect([...base64ToBytes(b64)]).toEqual([...bytes]);
    }
  });
});

describe('parseWav', () => {
  it('reads the header, walking past an extra chunk like iOS writes', () => {
    const info = parseWav(makeWav({ sampleRate: 44100, channels: 1, bits: 16, seconds: 1, extraChunk: true }))!;
    expect(info).toMatchObject({ format: 1, sampleRate: 44100, channels: 1, bitsPerSample: 16 });
    expect(info.durationSec).toBeCloseTo(1, 3);
  });

  it('unwraps WAVE_FORMAT_EXTENSIBLE, and rejects what is not a WAV', () => {
    expect(parseWav(makeWav({ sampleRate: 48000, channels: 2, bits: 32, float: true, extensible: true, seconds: 0.1 }))!.format).toBe(3);
    expect(parseWav(new Uint8Array(100))).toBeNull();
  });
});

describe('shrinkWavBase64', () => {
  it('44.1 kHz stereo → 16 kHz mono 16-bit, ~5.5× smaller, same length in time', () => {
    const original = makeWav({ sampleRate: 44100, channels: 2, bits: 16, seconds: 2, tone: 440 });
    const { base64, facts } = shrinkWavBase64(toB64(original));
    const out = base64ToBytes(base64);
    const info = parseWav(out)!;
    expect(info).toMatchObject({ format: 1, sampleRate: TARGET_SAMPLE_RATE, channels: 1, bitsPerSample: 16 });
    expect(info.durationSec).toBeCloseTo(2, 2);
    expect(facts).toMatchObject({ shrunk: true, sampleRate: 44100, channels: 2, originalBytes: original.length, sentBytes: out.length });
    expect(original.length / out.length).toBeGreaterThan(5);
  });

  it('keeps speech-band sound (a 440 Hz tone keeps its level)', () => {
    const { base64 } = shrinkWavBase64(toB64(makeWav({ sampleRate: 44100, channels: 1, bits: 16, seconds: 1, tone: 440 })));
    // A sine of amplitude 0.5 has RMS ≈ 0.354.
    expect(rms(base64ToBytes(base64))).toBeGreaterThan(0.33);
  });

  it('damps content above 8 kHz instead of folding it into speech (a 12 kHz tone)', () => {
    const { base64 } = shrinkWavBase64(toB64(makeWav({ sampleRate: 44100, channels: 1, bits: 16, seconds: 1, tone: 12000 })));
    expect(rms(base64ToBytes(base64))).toBeLessThan(0.354 * 0.5);
  });

  it('handles 32-bit float, 48 kHz', () => {
    const { facts } = shrinkWavBase64(toB64(makeWav({ sampleRate: 48000, channels: 1, bits: 32, float: true, seconds: 0.5, tone: 300 })));
    expect(facts.shrunk).toBe(true);
  });

  it('sends as recorded when already 16 kHz mono 16-bit, or not a WAV at all', () => {
    const small = toB64(makeWav({ sampleRate: 16000, channels: 1, bits: 16, seconds: 0.5 }));
    expect(shrinkWavBase64(small)).toMatchObject({ base64: small, facts: { shrunk: false, sampleRate: 16000 } });
    const junk = toB64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(shrinkWavBase64(junk)).toMatchObject({ base64: junk, facts: { shrunk: false, sampleRate: null } });
    expect(shrinkWavBase64('')).toMatchObject({ base64: '', facts: { shrunk: false } });
  });
});

describe('Phase 1b fast path (16 kHz mono 32-bit float — what the iPhone records)', () => {
  it('gives exactly the samples the general path would', () => {
    const wav = makeWav({ sampleRate: 16000, channels: 1, bits: 32, float: true, seconds: 0.5, tone: 440 });
    const { base64, facts } = shrinkWavBase64(toB64(wav));
    expect(facts).toMatchObject({ shrunk: true, sampleRate: 16000, bitsPerSample: 32 });
    const out = base64ToBytes(base64);
    // Expected: each float sample, read independently, quantised to 16-bit.
    const info = parseWav(wav)!;
    const src = new DataView(wav.buffer, info.dataOffset, info.dataBytes);
    const frames = info.dataBytes / 4;
    const expected = new Float32Array(frames);
    for (let i = 0; i < frames; i++) expected[i] = src.getFloat32(i * 4, true);
    expect([...out]).toEqual([...encodeWav16(expected, 16000)]);
    expect(out.length).toBe(44 + frames * 2); // exactly half the samples' size
  });

  it('copes with audio data that does not start on a 4-byte boundary', () => {
    // A 6-byte extra chunk puts the samples at offset 62 — not a multiple of 4,
    // which a direct Float32Array view would reject.
    const wav = makeWav({ sampleRate: 16000, channels: 1, bits: 32, float: true, seconds: 0.1, tone: 300, extraChunk: true, extraSize: 6 });
    expect(parseWav(wav)!.dataOffset % 4).not.toBe(0);
    const { base64, facts } = shrinkWavBase64(toB64(wav));
    expect(facts.shrunk).toBe(true);
    expect(parseWav(base64ToBytes(base64))!.durationSec).toBeCloseTo(0.1, 3);
  });
});

describe('resample / encodeWav16', () => {
  it('keeps the length in time and clips out-of-range samples', () => {
    expect(resample(new Float32Array(44100), 44100, 16000).length).toBe(16000);
    const wav = encodeWav16(new Float32Array([2, -2, 0]), 16000);
    const v = new DataView(wav.buffer);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([32767, -32768, 0]);
  });
});

describe('describeAudio (Timing line)', () => {
  it('says what was recorded and what was sent', () => {
    expect(
      describeAudio({ durationSec: 45.2, sampleRate: 44100, channels: 1, bitsPerSample: 16, originalBytes: 3923 * 1024, sentBytes: 1424 * 1024, shrunk: true }),
    ).toBe('45 s recording, 3923 KB → 1424 KB sent (44.1 kHz mono 16-bit → 16 kHz mono 16-bit)');
    // The device case: already 16 kHz, but 32-bit — the label must say what changed.
    expect(
      describeAudio({ durationSec: 61, sampleRate: 16000, channels: 1, bitsPerSample: 32, originalBytes: 3842 * 1024, sentBytes: 1919 * 1024, shrunk: true }),
    ).toBe('61 s recording, 3842 KB → 1919 KB sent (16 kHz mono 32-bit → 16 kHz mono 16-bit)');
    expect(
      describeAudio({ durationSec: null, sampleRate: null, channels: null, bitsPerSample: null, originalBytes: 2048, sentBytes: 2048, shrunk: false }),
    ).toBe('recording 2 KB sent as recorded');
  });
});
