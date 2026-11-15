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
// Phase 1b: typed-array codec. The first version rebuilt strings and used a
// regex over the whole ~5 MB payload, which was most of the 1.3 s the phone
// spent here. Output is byte-for-byte identical.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const ENCODE = new Uint8Array(64);
const LOOKUP = new Uint8Array(256).fill(255);
for (let i = 0; i < ALPHABET.length; i++) {
  ENCODE[i] = ALPHABET.charCodeAt(i);
  LOOKUP[ALPHABET.charCodeAt(i)] = i;
}

/** Character codes of a base64 string, without whitespace/padding/stray characters. */
function base64Codes(base64: string): Uint8Array {
  const codes = new Uint8Array(base64.length);
  let n = 0;
  for (let i = 0; i < base64.length; i++) {
    const c = base64.charCodeAt(i);
    if (c < 256 && LOOKUP[c] !== 255) codes[n++] = c;
  }
  return codes.subarray(0, n);
}

export function base64ToBytes(base64: string): Uint8Array {
  const codes = base64Codes(base64);
  const len = codes.length;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  let i = 0;
  for (; i + 4 <= len; i += 4) {
    const a = LOOKUP[codes[i]!]!;
    const b = LOOKUP[codes[i + 1]!]!;
    const c = LOOKUP[codes[i + 2]!]!;
    const d = LOOKUP[codes[i + 3]!]!;
    out[o++] = (a << 2) | (b >> 4);
    out[o++] = ((b & 15) << 4) | (c >> 2);
    out[o++] = ((c & 3) << 6) | d;
  }
  const rest = len - i;
  if (rest >= 2) {
    const a = LOOKUP[codes[i]!]!;
    const b = LOOKUP[codes[i + 1]!]!;
    out[o++] = (a << 2) | (b >> 4);
    if (rest === 3) {
      const c = LOOKUP[codes[i + 2]!]!;
      out[o++] = ((b & 15) << 4) | (c >> 2);
    }
  }
  return out.subarray(0, o);
}

const EQUALS = 61;

export function bytesToBase64(bytes: Uint8Array): string {
  const out = new Uint8Array(Math.ceil(bytes.length / 3) * 4);
  let o = 0;
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1]!;
    const c = bytes[i + 2]!;
    out[o++] = ENCODE[a >> 2]!;
    out[o++] = ENCODE[((a & 3) << 4) | (b >> 4)]!;
    out[o++] = ENCODE[((b & 15) << 2) | (c >> 6)]!;
    out[o++] = ENCODE[c & 63]!;
  }
  const rest = bytes.length - i;
  if (rest > 0) {
    const a = bytes[i]!;
    const b = rest === 2 ? bytes[i + 1]! : 0;
    out[o++] = ENCODE[a >> 2]!;
    out[o++] = ENCODE[((a & 3) << 4) | (b >> 4)]!;
    out[o++] = rest === 2 ? ENCODE[(b & 15) << 2]! : EQUALS;
    out[o++] = EQUALS;
  }
  // ASCII codes → string in slices (one giant apply() overflows the stack).
  const parts: string[] = [];
  for (let p = 0; p < out.length; p += 8192) {
    // A typed array is array-like, so apply() takes it directly (no copy).
    parts.push(String.fromCharCode.apply(null, out.subarray(p, p + 8192) as unknown as number[]));
  }
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

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** One mono sample per frame, as floats in [-1, 1]. Null for unsupported encodings. */
function readMono(bytes: Uint8Array, info: WavInfo): Float32Array | null {
  // Phase 1b fast path: iOS writes mono 32-bit float. On a little-endian
  // device (every iPhone) the samples can be copied out in one block instead
  // of read one by one — the same values, a fraction of the time.
  if (LITTLE_ENDIAN && info.format === 3 && info.bitsPerSample === 32 && info.channels === 1) {
    const frames = Math.floor(info.dataBytes / 4);
    const copy = bytes.slice(info.dataOffset, info.dataOffset + frames * 4);
    return new Float32Array(copy.buffer, copy.byteOffset, frames);
  }
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
  const pcm = LITTLE_ENDIAN ? new Int16Array(bytes.buffer, 44, samples.length) : null;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const v = s > 1 ? 1 : s < -1 ? -1 : s;
    const q = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
    if (pcm) pcm[i] = q;
    else view.setInt16(44 + i * 2, q, true);
  }
  return bytes;
}

/**
 * A base64 WAV, made 16 kHz / mono / 16-bit when that is smaller. Never
 * throws: anything unexpected returns the original untouched, with the facts
 * that could be read.
 */
export function shrinkWavBase64(base64: string): { base64: string; facts: AudioFacts } {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const originalBytes = Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
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
