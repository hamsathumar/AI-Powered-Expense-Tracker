/**
 * Lossless FLAC for the voice upload (voice speed, Phase 2).
 *
 * The owner records mostly on mobile data, where the upload is still ~10 s of
 * a ~28 s capture (Phase 1a/1b). FLAC is lossless — Gemini receives exactly
 * the same samples — and accepts `audio/flac` directly. Speech at 16 kHz
 * typically compresses to well under the 16-bit WAV's size.
 *
 * Deliberately the simplest valid FLAC: mono, 16-bit, fixed 4096-sample
 * blocks, and per block the best of CONSTANT (silence), FIXED polynomial
 * prediction (orders 0–4) with partitioned Rice coding, or VERBATIM. No LPC,
 * no MD5 (allowed: an all-zero MD5 means "not computed").
 *
 * A matching decoder lives here too. The app decodes every file it encodes
 * and compares every sample before sending it (`encodeFlacVerified`); any
 * difference — or any error — means the 16-bit WAV is sent instead. Tests
 * additionally cross-check against ffmpeg, an independent decoder.
 *
 * Pure: no I/O, no platform APIs.
 */

const BLOCK_SIZE = 4096;
const MAX_RICE_PARAM = 14; // 15 is the escape code — never needed for 16-bit input
const MAX_PARTITION_ORDER = 8;

// ── CRCs (FLAC spec: CRC-8 poly 0x07, CRC-16 poly 0x8005, both MSB-first, init 0) ──
const CRC8 = new Uint8Array(256);
const CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let c8 = i;
  let c16 = i << 8;
  for (let b = 0; b < 8; b++) {
    c8 = c8 & 0x80 ? ((c8 << 1) ^ 0x07) & 0xff : (c8 << 1) & 0xff;
    c16 = c16 & 0x8000 ? ((c16 << 1) ^ 0x8005) & 0xffff : (c16 << 1) & 0xffff;
  }
  CRC8[i] = c8;
  CRC16[i] = c16;
}
function crc8(bytes: Uint8Array, from: number, to: number): number {
  let crc = 0;
  for (let i = from; i < to; i++) crc = CRC8[crc ^ bytes[i]!]!;
  return crc;
}
function crc16(bytes: Uint8Array, from: number, to: number): number {
  let crc = 0;
  for (let i = from; i < to; i++) crc = ((crc << 8) & 0xffff) ^ CRC16[(crc >> 8) ^ bytes[i]!]!;
  return crc;
}

// ── Bit writer ─────────────────────────────────────────────────────────────
class BitWriter {
  buf: Uint8Array;
  pos = 0; // bytes fully written
  private acc = 0; // pending bits (fewer than 8)
  private n = 0;

  constructor(capacity: number) {
    this.buf = new Uint8Array(Math.max(64, capacity));
  }

  private ensure(extra: number): void {
    if (this.pos + extra <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.pos + extra + 1024));
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }

  /** Write the low `bits` bits of a non-negative `value` (bits ≤ 24 per call). */
  private put(value: number, bits: number): void {
    this.acc = (this.acc << bits) | (value & ((1 << bits) - 1));
    this.n += bits;
    if (this.pos + 4 > this.buf.length) this.ensure(4);
    while (this.n >= 8) {
      this.n -= 8;
      this.buf[this.pos++] = (this.acc >>> this.n) & 0xff;
    }
    this.acc &= (1 << this.n) - 1;
  }

  /** One Rice-coded value: unary quotient, then `k` low bits. Hot path. */
  rice(u: number, k: number): void {
    let q = u >>> k;
    if (q + 1 + k <= 24) {
      this.put((1 << k) | (u & ((1 << k) - 1)), q + 1 + k);
      return;
    }
    while (q >= 24) {
      this.put(0, 24);
      q -= 24;
    }
    this.put(1, q + 1);
    if (k > 0) this.put(u & ((1 << k) - 1), k);
  }

  write(value: number, bits: number): void {
    while (bits > 24) {
      bits -= 24;
      this.put(Math.floor(value / 2 ** bits) & 0xffffff, 24);
    }
    if (bits > 0) this.put(value % 2 ** bits, bits);
  }

  /** `q` zero bits then a one. */
  unary(q: number): void {
    while (q >= 24) {
      this.put(0, 24);
      q -= 24;
    }
    this.put(1, q + 1);
  }

  /** Pad with zero bits to the next byte boundary. */
  align(): void {
    if (this.n > 0) this.put(0, 8 - this.n);
  }

  get byteLength(): number {
    return this.pos;
  }
}

// ── Encoder ────────────────────────────────────────────────────────────────
const zigzag = (r: number) => (r >= 0 ? r * 2 : -r * 2 - 1);

/** Residuals of FIXED predictor `order` for samples [start, start+n). */
function fixedResiduals(x: Int16Array, start: number, n: number, order: number, out: Int32Array): void {
  for (let i = order; i < n; i++) {
    const j = start + i;
    let r: number;
    switch (order) {
      case 0:
        r = x[j]!;
        break;
      case 1:
        r = x[j]! - x[j - 1]!;
        break;
      case 2:
        r = x[j]! - 2 * x[j - 1]! + x[j - 2]!;
        break;
      case 3:
        r = x[j]! - 3 * x[j - 1]! + 3 * x[j - 2]! - x[j - 3]!;
        break;
      default:
        r = x[j]! - 4 * x[j - 1]! + 6 * x[j - 2]! - 4 * x[j - 3]! + x[j - 4]!;
    }
    out[i - order] = r;
  }
}

/**
 * The FIXED order (0–4) with the smallest total |residual|, in ONE pass:
 * each order's residual is the difference of the previous order's.
 * Sums run over samples 4.. for every order, as libFLAC does.
 */
function bestFixedOrder(x: Int16Array, start: number, n: number): number {
  const maxOrder = Math.min(4, n - 1);
  if (n <= 4) return maxOrder;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let a = x[start + 3]!;
  let b = a - x[start + 2]!;
  let c = b - (x[start + 2]! - x[start + 1]!);
  let d = c - (x[start + 2]! - 2 * x[start + 1]! + x[start]!);
  for (let i = 4; i < n; i++) {
    const e0 = x[start + i]!;
    const e1 = e0 - a;
    const e2 = e1 - b;
    const e3 = e2 - c;
    const e4 = e3 - d;
    s0 += e0 < 0 ? -e0 : e0;
    s1 += e1 < 0 ? -e1 : e1;
    s2 += e2 < 0 ? -e2 : e2;
    s3 += e3 < 0 ? -e3 : e3;
    s4 += e4 < 0 ? -e4 : e4;
    a = e0;
    b = e1;
    c = e2;
    d = e3;
  }
  const sums = [s0, s1, s2, s3, s4];
  let best = 0;
  for (let o = 1; o <= maxOrder; o++) if (sums[o]! < sums[best]!) best = o;
  return best;
}

function riceParamFor(sum: number, count: number): number {
  if (count <= 0 || sum <= count) return 0;
  const k = Math.floor(Math.log2(sum / count));
  return Math.max(0, Math.min(MAX_RICE_PARAM, k));
}

interface RicePlan {
  partitionOrder: number;
  params: number[];
  estimatedBits: number;
}

/**
 * Choose the partition order and per-partition Rice parameters (estimated,
 * like libFLAC). Zig-zag sums are taken once at the finest partitioning and
 * merged upward, so every order costs O(partitions), not O(samples).
 */
function planRice(zz: Uint32Array, blockSize: number, order: number): RicePlan {
  let maxP = 0;
  while (
    maxP < MAX_PARTITION_ORDER &&
    blockSize % (1 << (maxP + 1)) === 0 &&
    blockSize >> (maxP + 1) > order
  ) {
    maxP++;
  }
  // Finest-level sums; partition 0 is short by `order` residuals.
  const finest = 1 << maxP;
  const perFinest = blockSize >> maxP;
  let sums = new Float64Array(finest);
  let counts = new Int32Array(finest);
  let idx = 0;
  for (let part = 0; part < finest; part++) {
    const count = part === 0 ? perFinest - order : perFinest;
    let sum = 0;
    for (let i = 0; i < count; i++) sum += zz[idx + i]!;
    idx += count;
    sums[part] = sum;
    counts[part] = count;
  }
  let best: RicePlan | null = null;
  for (let p = maxP; p >= 0; p--) {
    const parts = 1 << p;
    const params: number[] = [];
    let bits = 6; // coding method (2) + partition order (4)
    for (let part = 0; part < parts; part++) {
      const k = riceParamFor(sums[part]!, counts[part]!);
      params.push(k);
      bits += 4 + counts[part]! * (k + 1) + Math.floor(sums[part]! / 2 ** k);
    }
    if (!best || bits < best.estimatedBits) best = { partitionOrder: p, params, estimatedBits: bits };
    if (p > 0) {
      const nextSums = new Float64Array(parts >> 1);
      const nextCounts = new Int32Array(parts >> 1);
      for (let i = 0; i < parts >> 1; i++) {
        nextSums[i] = sums[2 * i]! + sums[2 * i + 1]!;
        nextCounts[i] = counts[2 * i]! + counts[2 * i + 1]!;
      }
      sums = nextSums;
      counts = nextCounts;
    }
  }
  return best!;
}

function writeUtf8Number(w: BitWriter, n: number): void {
  if (n < 0x80) w.write(n, 8);
  else if (n < 0x800) {
    w.write(0xc0 | (n >> 6), 8);
    w.write(0x80 | (n & 0x3f), 8);
  } else if (n < 0x10000) {
    w.write(0xe0 | (n >> 12), 8);
    w.write(0x80 | ((n >> 6) & 0x3f), 8);
    w.write(0x80 | (n & 0x3f), 8);
  } else {
    w.write(0xf0 | (n >> 18), 8);
    w.write(0x80 | ((n >> 12) & 0x3f), 8);
    w.write(0x80 | ((n >> 6) & 0x3f), 8);
    w.write(0x80 | (n & 0x3f), 8);
  }
}

const SAMPLE_RATE_CODES: Record<number, number> = {
  8000: 0b0100,
  16000: 0b0101,
  22050: 0b0110,
  24000: 0b0111,
  32000: 0b1000,
  44100: 0b1001,
  48000: 0b1010,
};

function writeFrame(
  w: BitWriter,
  x: Int16Array,
  start: number,
  n: number,
  frameNumber: number,
  sampleRate: number,
  res: Int32Array,
  zz: Uint32Array,
): void {
  const frameStart = w.byteLength; // aligned: every frame ends aligned
  w.write(0b11111111111110, 14); // sync
  w.write(0, 1); // reserved
  w.write(0, 1); // fixed block size
  const sizeCode = n === BLOCK_SIZE ? 0b1100 : n <= 256 ? 0b0110 : 0b0111;
  w.write(sizeCode, 4);
  w.write(SAMPLE_RATE_CODES[sampleRate] ?? 0b0000, 4);
  w.write(0b0000, 4); // mono
  w.write(0b100, 3); // 16 bits per sample
  w.write(0, 1); // reserved
  writeUtf8Number(w, frameNumber);
  if (sizeCode === 0b0110) w.write(n - 1, 8);
  else if (sizeCode === 0b0111) w.write(n - 1, 16);
  w.write(crc8(w.buf, frameStart, w.byteLength), 8);

  // Subframe — CONSTANT when the block is one value (silence).
  let constant = true;
  for (let i = 1; i < n; i++) {
    if (x[start + i] !== x[start]) {
      constant = false;
      break;
    }
  }
  if (constant) {
    w.write(0, 1);
    w.write(0b000000, 6);
    w.write(0, 1);
    w.write(x[start]! & 0xffff, 16);
  } else {
    // FIXED: the order with the smallest total |residual|.
    const bestOrder = bestFixedOrder(x, start, n);
    fixedResiduals(x, start, n, bestOrder, res);
    for (let i = 0; i < n - bestOrder; i++) zz[i] = zigzag(res[i]!);
    const plan = planRice(zz, n, bestOrder);
    const fixedBits = 8 + bestOrder * 16 + plan.estimatedBits;
    if (fixedBits >= n * 16 + 8) {
      // VERBATIM: incompressible noise.
      w.write(0, 1);
      w.write(0b000001, 6);
      w.write(0, 1);
      for (let i = 0; i < n; i++) w.write(x[start + i]! & 0xffff, 16);
    } else {
      w.write(0, 1);
      w.write(0b001000 | bestOrder, 6);
      w.write(0, 1);
      for (let i = 0; i < bestOrder; i++) w.write(x[start + i]! & 0xffff, 16);
      w.write(0b00, 2); // Rice, 4-bit parameters
      w.write(plan.partitionOrder, 4);
      const perPart = n >> plan.partitionOrder;
      let idx = 0;
      plan.params.forEach((k, part) => {
        w.write(k, 4);
        const count = part === 0 ? perPart - bestOrder : perPart;
        for (let i = 0; i < count; i++) w.rice(zz[idx + i]!, k);
        idx += count;
      });
    }
  }
  w.align();
  w.write(crc16(w.buf, frameStart, w.byteLength), 16);
}

/** A complete FLAC file for mono 16-bit samples. */
export function encodeFlac16Mono(samples: Int16Array, sampleRate: number): Uint8Array {
  const total = samples.length;
  const w = new BitWriter(Math.ceil(total * 1.2) + 128);
  w.write(0x664c6143, 32); // "fLaC"
  // STREAMINFO, the only (and so last) metadata block.
  w.write(1, 1);
  w.write(0, 7);
  w.write(34, 24);
  const block = Math.min(BLOCK_SIZE, total);
  w.write(block, 16); // min block size (the last block may be smaller)
  w.write(block, 16); // max block size
  w.write(0, 24); // min frame size: unknown
  w.write(0, 24); // max frame size: unknown
  w.write(sampleRate, 20);
  w.write(0, 3); // channels - 1
  w.write(15, 5); // bits per sample - 1
  w.write(total, 36);
  for (let i = 0; i < 4; i++) w.write(0, 32); // MD5: not computed
  const res = new Int32Array(BLOCK_SIZE);
  const zz = new Uint32Array(BLOCK_SIZE);
  for (let f = 0, start = 0; start < total; f++, start += BLOCK_SIZE) {
    writeFrame(w, samples, start, Math.min(BLOCK_SIZE, total - start), f, sampleRate, res, zz);
  }
  return w.buf.slice(0, w.byteLength);
}

// ── Decoder (verification) ─────────────────────────────────────────────────
class BitReader {
  /** Absolute position in BITS (public: the residual loop reads it inline). */
  bitPos: number;
  constructor(
    private readonly b: Uint8Array,
    bytePos: number,
  ) {
    this.bitPos = bytePos * 8;
  }

  get pos(): number {
    return this.bitPos >>> 3;
  }

  set pos(bytePos: number) {
    this.bitPos = bytePos * 8;
  }

  /** Up to 24 bits at a time from a 4-byte window; wider reads are split. */
  read(bits: number): number {
    if (bits > 24) {
      const hi = this.read(bits - 24);
      return hi * 16777216 + this.read(24);
    }
    if (bits === 0) return 0;
    const byte = this.bitPos >>> 3;
    if (((this.bitPos + bits + 7) >>> 3) > this.b.length) throw new Error('eof');
    const b = this.b;
    const window =
      ((b[byte] ?? 0) << 24) | ((b[byte + 1] ?? 0) << 16) | ((b[byte + 2] ?? 0) << 8) | (b[byte + 3] ?? 0);
    const shift = 32 - (this.bitPos & 7) - bits;
    this.bitPos += bits;
    return (window >>> shift) & ((1 << bits) - 1);
  }

  signed(bits: number): number {
    const v = this.read(bits);
    return v >= 2 ** (bits - 1) ? v - 2 ** bits : v;
  }

  /** Count zero bits up to the next one bit (consumed). Skips whole zero bytes. */
  unary(): number {
    let q = 0;
    const b = this.b;
    for (;;) {
      const byte = this.bitPos >>> 3;
      if (byte >= b.length) throw new Error('eof');
      const off = this.bitPos & 7;
      const rest = (b[byte]! << off) & 0xff;
      if (rest === 0) {
        q += 8 - off;
        this.bitPos += 8 - off;
        continue;
      }
      const lead = Math.clz32(rest) - 24;
      q += lead;
      this.bitPos += lead + 1;
      return q;
    }
  }

  align(): void {
    this.bitPos = (this.bitPos + 7) & ~7;
  }
}

/**
 * Decode `count` Rice-coded residuals with parameter `k` into x[at..],
 * reading bits inline (the hot loop of the verifying decode). Returns the new
 * bit position. Bytes past the end read as 0; the frame CRC catches overruns.
 */
function readRiceRun(b: Uint8Array, bitPos: number, count: number, k: number, x: Int32Array, at: number): number {
  const mask = (1 << k) - 1;
  for (let c = 0; c < count; c++) {
    let q = 0;
    for (;;) {
      const byte = bitPos >>> 3;
      if (byte >= b.length) throw new Error('eof');
      const off = bitPos & 7;
      const rest = (b[byte]! << off) & 0xff;
      if (rest === 0) {
        q += 8 - off;
        bitPos += 8 - off;
        continue;
      }
      const lead = Math.clz32(rest) - 24;
      q += lead;
      bitPos += lead + 1;
      break;
    }
    let low = 0;
    if (k > 0) {
      const byte = bitPos >>> 3;
      const window = ((b[byte]! << 24) | (b[byte + 1]! << 16) | (b[byte + 2]! << 8) | b[byte + 3]!) >>> 0;
      low = (window >>> (32 - (bitPos & 7) - k)) & mask;
      bitPos += k;
    }
    const u = q * (mask + 1) + low;
    x[at + c] = u & 1 ? -((u + 1) / 2) : u / 2;
  }
  return bitPos;
}

/** Turn residuals in x[order..] into samples, given the warm-up in x[0..order). */
function restoreFixed(x: Int32Array, n: number, order: number): void {
  switch (order) {
    case 1:
      for (let i = 1; i < n; i++) x[i] = x[i]! + x[i - 1]!;
      break;
    case 2:
      for (let i = 2; i < n; i++) x[i] = x[i]! + 2 * x[i - 1]! - x[i - 2]!;
      break;
    case 3:
      for (let i = 3; i < n; i++) x[i] = x[i]! + 3 * x[i - 1]! - 3 * x[i - 2]! + x[i - 3]!;
      break;
    case 4:
      for (let i = 4; i < n; i++) x[i] = x[i]! + 4 * x[i - 1]! - 6 * x[i - 2]! + 4 * x[i - 3]! - x[i - 4]!;
      break;
    default:
      break; // order 0: residuals are the samples
  }
}

/**
 * Decode the subset this module writes (mono 16-bit; CONSTANT / VERBATIM /
 * FIXED; Rice incl. escape), checking every CRC. Null on anything else.
 */
export function decodeFlac16Mono(bytes: Uint8Array): { sampleRate: number; samples: Int16Array } | null {
  try {
    if (bytes.length < 42 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'fLaC') return null;
    const r = new BitReader(bytes, 4);
    let sampleRate = 0;
    let total = 0;
    for (;;) {
      const last = r.read(1);
      const type = r.read(7);
      const length = r.read(24);
      const end = r.pos + length;
      if (type === 0) {
        r.read(16);
        r.read(16);
        r.read(24);
        r.read(24);
        sampleRate = r.read(20);
        if (r.read(3) !== 0 || r.read(5) !== 15) return null;
        total = r.read(36);
      }
      r.pos = end;
      if (last) break;
    }
    const out = new Int16Array(total);
    let o = 0;
    while (o < total) {
      const frameStart = r.pos;
      if (r.read(14) !== 0b11111111111110 || r.read(1) !== 0 || r.read(1) !== 0) return null;
      const sizeCode = r.read(4);
      r.read(4); // sample rate code
      if (r.read(4) !== 0 || r.read(3) !== 0b100 || r.read(1) !== 0) return null;
      let lead = r.read(8); // UTF-8 frame number
      let extra = lead < 0x80 ? 0 : lead < 0xe0 ? 1 : lead < 0xf0 ? 2 : 3;
      while (extra-- > 0) lead = r.read(8);
      let n: number;
      if (sizeCode === 0b1100) n = 4096;
      else if (sizeCode === 0b0110) n = r.read(8) + 1;
      else if (sizeCode === 0b0111) n = r.read(16) + 1;
      else return null;
      const headerEnd = r.pos;
      if (r.read(8) !== crc8(bytes, frameStart, headerEnd)) return null;
      if (r.read(1) !== 0) return null;
      const type = r.read(6);
      if (r.read(1) !== 0) return null; // wasted bits: never written
      if (type === 0) {
        const v = r.signed(16);
        for (let i = 0; i < n; i++) out[o + i] = v;
      } else if (type === 1) {
        for (let i = 0; i < n; i++) out[o + i] = r.signed(16);
      } else if ((type & 0b111000) === 0b001000 && (type & 7) <= 4) {
        const order = type & 7;
        const x = new Int32Array(n);
        for (let i = 0; i < order; i++) x[i] = r.signed(16);
        if (r.read(2) !== 0) return null;
        const p = r.read(4);
        const perPart = n >> p;
        // Residuals first (into x[order..]), then the prediction in one pass.
        let i = order;
        for (let part = 0; part < 1 << p; part++) {
          const count = part === 0 ? perPart - order : perPart;
          const k = r.read(4);
          if (k === 15) {
            const raw = r.read(5);
            for (let c = 0; c < count; c++, i++) x[i] = raw ? r.signed(raw) : 0;
          } else {
            r.bitPos = readRiceRun(bytes, r.bitPos, count, k, x, i);
            i += count;
          }
        }
        restoreFixed(x, n, order);
        for (let s = 0; s < n; s++) out[o + s] = x[s]!;
      } else return null;
      r.align();
      const frameEnd = r.pos;
      if (r.read(16) !== crc16(bytes, frameStart, frameEnd)) return null;
      o += n;
    }
    return { sampleRate, samples: out };
  } catch {
    return null;
  }
}

/**
 * Encode, then decode and compare every sample. Returns the FLAC bytes only
 * when they round-trip exactly; otherwise null (the caller sends the WAV).
 */
export function encodeFlacVerified(samples: Int16Array, sampleRate: number): Uint8Array | null {
  if (samples.length < 16) return null;
  try {
    const flac = encodeFlac16Mono(samples, sampleRate);
    const back = decodeFlac16Mono(flac);
    if (!back || back.sampleRate !== sampleRate || back.samples.length !== samples.length) return null;
    for (let i = 0; i < samples.length; i++) if (back.samples[i] !== samples[i]) return null;
    return flac;
  } catch {
    return null;
  }
}
