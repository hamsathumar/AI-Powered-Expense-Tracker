/**
 * Shrink the voice recording before it is uploaded (voice speed, Phase 1a).
 *
 * Phase 0 measured the cause: the same nine-transaction sentence took 26 s on
 * Wi-Fi and 53 s on mobile data with identical Gemini work — the difference was
 * the upload. The recording arrives as a WAV at ~88 KB per second (44.1 kHz:
 * iOS ignores the 16 kHz the capture asks for), so a 45-second sentence is
 * ~4 MB, ~5.3 MB once base64-encoded into the request.
 *
 * Gemini reduces all audio to 16 kHz mono itself, so anything finer is upload
 * cost with no recognition benefit. This converts a WAV to 16-bit PCM, 16 kHz,
 * mono — about 2.7× smaller for a 44.1 kHz recording — and returns null for
 * anything it does not fully understand, in which case the caller sends the
 * original bytes exactly as before.
 *
 * Pure: no I/O, no platform APIs (its own base64 codec), so it is unit-tested in
 * plain node.
 */

export const TARGET_SAMPLE_RATE = 16_000;

export interface WavInfo {
  /** 1 = integer PCM, 3 = IEEE float (WAVE_FORMAT_EXTENSIBLE is unwrapped). */
  format: 1 | 3;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataBytes: number;
  durationSec: number;
}

export interface AudioFacts {
  durationSec: number | null;
  sampleRate: number | null;
  channels: number | null;
  bitsPerSample: number | null;
  /** Size of the recording as captured. */
  originalBytes: number;
  /** Size actually sent to Gemini. */
  sentBytes: number;
  /** True when the recording was converted; false when sent as captured. */
  shrunk: boolean;
}

// ── base64 ───────────────────────────────────────────────────────────────
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)]!;
    const b = LOOKUP[clean.charCodeAt(i + 1)] ?? -1;
    const c = i + 2 < clean.length ? LOOKUP[clean.charCodeAt(i + 2)]! : -1;
    const d = i + 3 < clean.length ? LOOKUP[clean.charCodeAt(i + 3)]! : -1;
    if (b < 0) break;
    out[o++] = (a << 2) | (b >> 4);
    if (c >= 0) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : -1;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : -1;
    chunk +=
      ALPHABET[a >> 2]! +
      ALPHABET[((a & 3) << 4) | (b >= 0 ? b >> 4 : 0)]! +
      (b >= 0 ? ALPHABET[((b & 15) << 2) | (c >= 0 ? c >> 6 : 0)]! : '=') +
      (c >= 0 ? ALPHABET[c & 63]! : '=');
    // Build in slices: one huge `+=` string is slow on some JS engines.
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = '';
    }
  }
  parts.push(chunk);
  return parts.join('');
}

// ── WAV ──────────────────────────────────────────────────────────────────
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** Read a RIFF/WAVE header, walking chunks (iOS adds e.g. a FLLR chunk). Null if not a supported WAV. */
export function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 12;
  let fmt: Omit<WavInfo, 'dataOffset' | 'dataBytes' | 'durationSec'> | null = null;
  while (pos + 8 <= bytes.length) {
    const id = ascii(bytes, pos, 4);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ' && size >= 16) {
      let format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of the sub-format GUID.
      if (format === 0xfffe && size >= 40) format = view.getUint16(body + 24, true);
      if (format !== 1 && format !== 3) return null;
      fmt = { format: format as 1 | 3, channels, sampleRate, bitsPerSample };
    } else if (id === 'data') {
      if (!fmt) return null;
      const dataBytes = Math.min(size, bytes.length - body);
      const frame = fmt.channels * (fmt.bitsPerSample / 8);
      if (!fmt.channels || !fmt.sampleRate || !frame) return null;
      return { ...fmt, dataOffset: body, dataBytes, durationSec: dataBytes / frame / fmt.sampleRate };
    }
    pos = body + size + (size % 2); // chunks are word-aligned
  }
  return null;
}

/** One mono sample per frame, as floats in [-1, 1]. Null for unsupported encodings. */
function readMono(bytes: Uint8Array, info: WavInfo): Float32Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset + info.dataOffset, info.dataBytes);
  const width = info.bitsPerSample / 8;
  const frames = Math.floor(info.dataBytes / (width * info.channels));
  const out = new Float32Array(frames);
  let read: (offset: number) => number;
  if (info.format === 1 && info.bitsPerSample === 16) read = (o) => view.getInt16(o, true) / 32768;
  else if (info.format === 1 && info.bitsPerSample === 24) {
    read = (o) => {
      const v = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16);
      return v / 8388608;
    };
  } else if (info.format === 1 && info.bitsPerSample === 32) read = (o) => view.getInt32(o, true) / 2147483648;
  else if (info.format === 3 && info.bitsPerSample === 32) read = (o) => view.getFloat32(o, true);
  else return null;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = f * width * info.channels;
    for (let c = 0; c < info.channels; c++) sum += read(base + c * width);
    out[f] = sum / info.channels;
  }
  return out;
}

/**
 * Resample to `target` Hz. Each output sample is the average of the source
 * samples it covers (a box low-pass of one output period) — enough to keep
 * content above the new Nyquist from folding back into the speech band.
 */
export function resample(input: Float32Array, from: number, target: number): Float32Array {
  if (from === target) return input;
  const ratio = from / target;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = i * ratio;
    const end = Math.min(input.length, start + Math.max(1, ratio));
    let sum = 0;
    let weight = 0;
    for (let s = Math.floor(start); s < Math.ceil(end); s++) {
      const w = Math.min(s + 1, end) - Math.max(s, start);
      if (w <= 0) continue;
      sum += input[s]! * w;
      weight += w;
    }
    out[i] = weight > 0 ? sum / weight : 0;
  }
  return out;
}

/** 16-bit PCM mono WAV bytes from float samples. */
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true);
  }
  return bytes;
}

/**
 * A base64 WAV, made 16 kHz / mono / 16-bit when that is smaller. Never
 * throws: anything unexpected returns the original untouched, with the facts
 * that could be read.
 */
export function shrinkWavBase64(base64: string): { base64: string; facts: AudioFacts } {
  const originalBytes = Math.floor((base64.replace(/=+$/, '').length * 3) / 4);
  const unchanged = (info: WavInfo | null): { base64: string; facts: AudioFacts } => ({
    base64,
    facts: {
      durationSec: info?.durationSec ?? null,
      sampleRate: info?.sampleRate ?? null,
      channels: info?.channels ?? null,
      bitsPerSample: info?.bitsPerSample ?? null,
      originalBytes,
      sentBytes: originalBytes,
      shrunk: false,
    },
  });
  try {
    const bytes = base64ToBytes(base64);
    const info = parseWav(bytes);
    if (!info) return unchanged(null);
    const already =
      info.format === 1 && info.bitsPerSample === 16 && info.channels === 1 && info.sampleRate <= TARGET_SAMPLE_RATE;
    if (already || info.sampleRate < TARGET_SAMPLE_RATE) return unchanged(info);
    const mono = readMono(bytes, info);
    if (!mono || mono.length === 0) return unchanged(info);
    const wav = encodeWav16(resample(mono, info.sampleRate, TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE);
    if (wav.length >= bytes.length) return unchanged(info);
    return {
      base64: bytesToBase64(wav),
      facts: {
        durationSec: info.durationSec,
        sampleRate: info.sampleRate,
        channels: info.channels,
        bitsPerSample: info.bitsPerSample,
        originalBytes: bytes.length,
        sentBytes: wav.length,
        shrunk: true,
      },
    };
  } catch {
    return unchanged(null);
  }
}
