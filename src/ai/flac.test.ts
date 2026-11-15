/// <reference types="node" />
/**
 * Voice speed, Phase 2 — lossless FLAC upload.
 *
 * The encoder is checked three ways: its own decoder must return every sample
 * exactly; a corrupted byte must be caught by the CRCs; and, where ffmpeg is
 * installed, an INDEPENDENT decoder must agree sample for sample (so a bug
 * shared by this module's encoder and decoder cannot hide).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { base64ToBytes, parseWav, prepareUpload } from './audio';
import { decodeFlac16Mono, encodeFlac16Mono, encodeFlacVerified } from './flac';
import { describeAudio } from './timing';

const SR = 16000;
let seed = 7;
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);

/** Speech-like test audio: gliding tones, a quiet floor, silences, a loud burst, full-scale extremes. */
function speechLike(n: number): Int16Array {
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const sec = Math.floor(t * 2);
    let v = 0.3 * Math.sin(2 * Math.PI * (140 + 60 * Math.sin(t)) * t) + 0.08 * Math.sin(2 * Math.PI * 950 * t) + 0.01 * noise();
    if (sec % 6 === 5) v = 0; // pauses → CONSTANT blocks
    out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  if (n > 10) {
    out[3] = 32767;
    out[4] = -32768;
  }
  return out;
}

const same = (a: Int16Array, b: Int16Array) => a.length === b.length && a.every((v, i) => v === b[i]);

describe('FLAC encode → decode is exact', () => {
  it.each([
    ['one full block', 4096],
    ['several blocks', 4096 * 5],
    ['a last block needing a 16-bit size', 4096 * 2 + 1000],
    ['a last block needing an 8-bit size', 4096 * 2 + 100],
    ['a last block of 1 sample', 4096 + 1],
    ['shorter than one block', 2000],
    ['the minimum (16 samples)', 16],
    ['a minute of audio', SR * 60],
  ])('%s', (_label, n) => {
    const samples = speechLike(n);
    const back = decodeFlac16Mono(encodeFlac16Mono(samples, SR));
    expect(back?.sampleRate).toBe(SR);
    expect(same(back!.samples, samples)).toBe(true);
  });

  it('silence (CONSTANT) and white noise (VERBATIM) both survive', () => {
    const silence = new Int16Array(4096 * 2).fill(-5);
    expect(same(decodeFlac16Mono(encodeFlac16Mono(silence, SR))!.samples, silence)).toBe(true);
    const loud = new Int16Array(4096).map(() => Math.round(noise() * 65535));
    expect(same(decodeFlac16Mono(encodeFlac16Mono(loud, SR))!.samples, loud)).toBe(true);
  });

  it('compresses speech-like audio well below the 16-bit size', () => {
    const samples = speechLike(SR * 30);
    expect(encodeFlac16Mono(samples, SR).length).toBeLessThan(samples.length * 2 * 0.75);
  });
});

describe('the safeguards', () => {
  it('a corrupted byte is caught (CRC), so verification refuses it', () => {
    const flac = encodeFlac16Mono(speechLike(4096 * 3), SR);
    const bad = flac.slice();
    bad[Math.floor(bad.length / 2)] ^= 0x10;
    const back = decodeFlac16Mono(bad);
    expect(back === null || !same(back.samples, speechLike(4096 * 3))).toBe(true);
  });

  it('encodeFlacVerified returns the bytes only when they round-trip', () => {
    expect(encodeFlacVerified(speechLike(SR), SR)).not.toBeNull();
    expect(encodeFlacVerified(new Int16Array(8), SR)).toBeNull(); // too short to bother
  });

  it('decodeFlac16Mono rejects what is not one of its files', () => {
    expect(decodeFlac16Mono(new Uint8Array(100))).toBeNull();
  });
});

// ── An independent decoder (ffmpeg), when this machine has one ──────────────
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

(hasFfmpeg ? describe : describe.skip)('ffmpeg agrees, sample for sample', () => {
  it('decodes the encoder\'s output to exactly the input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kaasu-flac-'));
    try {
      const samples = speechLike(SR * 20 + 777);
      writeFileSync(join(dir, 'a.flac'), encodeFlac16Mono(samples, SR));
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(dir, 'a.flac'), '-f', 's16le', '-acodec', 'pcm_s16le', join(dir, 'a.raw')]);
      const raw = readFileSync(join(dir, 'a.raw'));
      const decoded = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
      expect(same(decoded, samples)).toBe(true);
      const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'csv=p=0', join(dir, 'a.flac')])
        .toString()
        .trim();
      expect(probe).toBe('flac,16000,1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── What gets uploaded ───────────────────────────────────────────────────
/** A WAV like the iPhone records: 16 kHz mono 32-bit float. */
function iphoneWav(samples: Float32Array): string {
  const bytes = new Uint8Array(44 + samples.length * 4);
  const v = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 4, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, SR, true);
  v.setUint32(28, SR * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 32, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 4, true);
  samples.forEach((s, i) => v.setFloat32(44 + i * 4, s, true));
  return Buffer.from(bytes).toString('base64');
}

describe('prepareUpload', () => {
  const speech = () => Float32Array.from(speechLike(SR * 5), (s) => s / 32768);

  it('the iPhone recording goes as lossless FLAC, with the 16-bit WAV kept as the fallback', () => {
    const up = prepareUpload(iphoneWav(speech()), 'audio/wav');
    expect(up.mimeType).toBe('audio/flac');
    expect(up.facts).toMatchObject({ format: 'flac', shrunk: true, sampleRate: SR, bitsPerSample: 32 });
    expect(up.facts.sentBytes).toBeLessThan(up.facts.wavBytes! * 0.9);
    expect(up.fallback?.mimeType).toBe('audio/wav');
    // The FLAC and the fallback WAV carry exactly the same samples.
    const flac = decodeFlac16Mono(base64ToBytes(up.base64))!;
    const wavBytes = base64ToBytes(up.fallback!.base64);
    const info = parseWav(wavBytes)!;
    const wavSamples = new Int16Array(wavBytes.slice(info.dataOffset, info.dataOffset + info.dataBytes).buffer);
    expect(same(flac.samples, wavSamples)).toBe(true);
  });

  it('noise that FLAC cannot shrink goes as the 16-bit WAV, as before', () => {
    const hiss = Float32Array.from({ length: SR * 2 }, () => noise() * 1.9);
    const up = prepareUpload(iphoneWav(hiss), 'audio/wav');
    expect(up.mimeType).toBe('audio/wav');
    expect(up.fallback).toBeNull();
    expect(up.facts.format).toBe('wav');
  });

  it('a recording that is not a WAV, or not readable, is sent exactly as recorded', () => {
    const m4a = Buffer.from('not really audio').toString('base64');
    expect(prepareUpload(m4a, 'audio/mp4')).toMatchObject({ base64: m4a, mimeType: 'audio/mp4', fallback: null });
    const junk = Buffer.from(new Uint8Array(64)).toString('base64');
    expect(prepareUpload(junk, 'audio/wav')).toMatchObject({ base64: junk, mimeType: 'audio/wav', fallback: null });
  });
});

describe('Timing wording', () => {
  const base = { durationSec: 61, sampleRate: 16000, channels: 1, bitsPerSample: 32, originalBytes: 3842 * 1024, shrunk: true };
  it('says when FLAC was sent, and when Gemini refused it', () => {
    expect(describeAudio({ ...base, format: 'flac', wavBytes: 1919 * 1024, sentBytes: 1100 * 1024 })).toBe(
      '61 s recording, 3842 KB → 1919 KB WAV → 1100 KB sent as lossless FLAC (16 kHz mono 32-bit → 16 kHz mono 16-bit)',
    );
    expect(describeAudio({ ...base, format: 'wav', wavBytes: 1919 * 1024, sentBytes: 1919 * 1024, flacRejected: true })).toContain(
      'Gemini refused the FLAC, so the WAV was sent',
    );
  });
});
