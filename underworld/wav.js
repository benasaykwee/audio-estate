// Minimal audio I/O for the offline CLI — stereo PCM WAV/AIFF, Float64 in memory,
// with TPDF dither on 16-bit export.
const fs = require('fs');

// Triangular (TPDF) dither: two independent uniforms summed -> ±1 LSB triangular PDF, the
// correct dither for reducing quantization to white noise. Deterministic when seeded.
function makeDither(seed) {
  let s = (seed || 0x2545F491) >>> 0;
  const u = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xffffffff; };
  return () => (u() + u() - 1);   // triangular in [-1, 1]
}

function writeWav(filePath, L, R, sampleRate, bits, opts) {
  bits = bits || 24; opts = opts || {};
  const dither = bits === 16 && opts.dither !== false ? makeDither(opts.seed) : null;
  const n = L.length, ch = 2, bps = bits / 8, dataLen = n * ch * bps;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * ch * bps, 28); buf.writeUInt16LE(ch * bps, 32); buf.writeUInt16LE(bits, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  const full = bits === 16 ? 32767 : 8388607;
  const clampI = (v) => (v < -full - 1 ? -full - 1 : v > full ? full : v);
  let off = 44;
  for (let i = 0; i < n; i++) {
    for (const s of [L[i], R[i]]) {
      const d = dither ? dither() : 0;                        // ±1 LSB before quantizing
      const q = clampI(Math.round((s < -1 ? -1 : s > 1 ? 1 : s) * full + d));
      if (bits === 16) { buf.writeInt16LE(q, off); off += 2; }
      else { buf.writeIntLE(q, off, 3); off += 3; }
    }
  }
  fs.writeFileSync(filePath, buf);
}

function readWav(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV');
  let off = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    else if (id === 'data') { dataOff = off + 8; dataLen = sz; }
    off += 8 + sz + (sz & 1);
  }
  if (!fmt || dataOff < 0) throw new Error('missing fmt/data chunk');
  const bps = fmt.bits / 8, frames = Math.floor(dataLen / (fmt.ch * bps));
  const L = new Float64Array(frames), R = new Float64Array(frames);
  let p = dataOff;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.ch; c++) {
      let v;
      if (fmt.bits === 16) { v = buf.readInt16LE(p) / 32768; p += 2; }
      else { v = buf.readIntLE(p, 3) / 8388608; p += 3; }
      if (c === 0) L[i] = v; else if (c === 1) R[i] = v;
    }
    if (fmt.ch === 1) R[i] = L[i];
  }
  return { L, R, sampleRate: fmt.sampleRate, bits: fmt.bits };
}

// AIFF (big-endian PCM). Enough of the format to read a mix; sample rate is an 80-bit
// IEEE extended float in COMM, decoded here without a library.
function ext80(buf, off) {
  const exp = ((buf[off] & 0x7f) << 8) | buf[off + 1];
  let mant = 0; for (let i = 0; i < 8; i++) mant = mant * 256 + buf[off + 2 + i];
  if (exp === 0 && mant === 0) return 0;
  return (buf[off] & 0x80 ? -1 : 1) * mant * Math.pow(2, exp - 16383 - 63);
}
function readAiff(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.toString('ascii', 0, 4) !== 'FORM' || buf.toString('ascii', 8, 12) !== 'AIFF') throw new Error('not an AIFF');
  let off = 12, comm = null, ssndOff = -1;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), sz = buf.readUInt32BE(off + 4);
    if (id === 'COMM') comm = { ch: buf.readUInt16BE(off + 8), frames: buf.readUInt32BE(off + 10), bits: buf.readUInt16BE(off + 14), sampleRate: Math.round(ext80(buf, off + 16)) };
    else if (id === 'SSND') ssndOff = off + 8 + 8 + buf.readUInt32BE(off + 8);   // skip offset+blockSize
    off += 8 + sz + (sz & 1);
  }
  if (!comm || ssndOff < 0) throw new Error('missing COMM/SSND chunk');
  const bps = comm.bits / 8, L = new Float64Array(comm.frames), R = new Float64Array(comm.frames);
  let p = ssndOff;
  for (let i = 0; i < comm.frames; i++) {
    for (let c = 0; c < comm.ch; c++) {
      let v;
      if (comm.bits === 16) { v = buf.readInt16BE(p) / 32768; p += 2; }
      else { v = ((buf.readInt8(p) << 16) | (buf[p + 1] << 8) | buf[p + 2]) / 8388608; p += 3; }
      if (c === 0) L[i] = v; else if (c === 1) R[i] = v;
    }
    if (comm.ch === 1) R[i] = L[i];
  }
  return { L, R, sampleRate: comm.sampleRate, bits: comm.bits };
}

function ext80Encode(rate) {
  const b = Buffer.alloc(10);
  if (rate <= 0) return b;
  const r = BigInt(Math.round(rate)), e = r.toString(2).length - 1;
  let mant = r << BigInt(63 - e);                 // 64-bit mantissa, MSB set
  const expField = 16383 + e;
  b[0] = (expField >> 8) & 0x7f; b[1] = expField & 0xff;
  for (let i = 9; i >= 2; i--) { b[i] = Number(mant & 0xffn); mant >>= 8n; }
  return b;
}
function writeAiff(filePath, L, R, sampleRate, bits) {
  bits = bits || 24; const n = L.length, ch = 2, bps = bits / 8, dataLen = n * ch * bps;
  const ssndSize = 8 + dataLen, formSize = 4 + (8 + 18) + (8 + ssndSize);
  const buf = Buffer.alloc(8 + formSize);
  buf.write('FORM', 0); buf.writeUInt32BE(formSize, 4); buf.write('AIFF', 8);
  buf.write('COMM', 12); buf.writeUInt32BE(18, 16);
  buf.writeUInt16BE(ch, 20); buf.writeUInt32BE(n, 22); buf.writeUInt16BE(bits, 26);
  ext80Encode(sampleRate).copy(buf, 28);
  buf.write('SSND', 38); buf.writeUInt32BE(ssndSize, 42); buf.writeUInt32BE(0, 46); buf.writeUInt32BE(0, 50);
  const full = bits === 16 ? 32767 : 8388607;
  let off = 54;
  for (let i = 0; i < n; i++) for (const s of [L[i], R[i]]) {
    const q = Math.max(-full - 1, Math.min(full, Math.round((s < -1 ? -1 : s > 1 ? 1 : s) * full)));
    if (bits === 16) { buf.writeInt16BE(q, off); off += 2; }
    else { buf.writeIntBE(q, off, 3); off += 3; }
  }
  fs.writeFileSync(filePath, buf);
}

// Dispatch by magic bytes. FLAC/other compressed formats need a real decoder and are out
// of scope for a dependency-free tool — decode them to WAV/AIFF first.
function readAudio(filePath) {
  const head = fs.readFileSync(filePath, { start: 0, end: 4 }).toString('ascii', 0, 4);
  if (head === 'RIFF') return readWav(filePath);
  if (head === 'FORM') return readAiff(filePath);
  throw new Error(`unsupported audio format (magic "${head}") — WAV or AIFF only; decode compressed formats first`);
}

module.exports = { writeWav, readWav, writeAiff, readAiff, readAudio, makeDither };
