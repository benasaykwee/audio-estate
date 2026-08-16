// Minimal WAV I/O for the offline CLI — stereo PCM 16/24-bit, Float64 in memory.
const fs = require('fs');

function writeWav(filePath, L, R, sampleRate, bits) {
  bits = bits || 24;
  const n = L.length, ch = 2, bps = bits / 8, dataLen = n * ch * bps;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * ch * bps, 28); buf.writeUInt16LE(ch * bps, 32); buf.writeUInt16LE(bits, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  const clamp = (x) => (x < -1 ? -1 : x > 1 ? 1 : x);
  let off = 44;
  for (let i = 0; i < n; i++) {
    for (const s of [L[i], R[i]]) {
      const v = clamp(s);
      if (bits === 16) { buf.writeInt16LE(Math.round(v * 32767), off); off += 2; }
      else { buf.writeIntLE(Math.round(v * 8388607), off, 3); off += 3; }
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

module.exports = { writeWav, readWav };
