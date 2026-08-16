// Export dither (10), sample-rate sweep (11), AIFF decode (12), true-peak guard (18).
const fs = require('fs'), os = require('os'), path = require('path');
const { writeWav, readWav, writeAiff, readAiff, readAudio } = require('./wav.js');
const { guardTruePeak } = require('./safety.js');
const { calibrate } = require('./calibrate.js');
const T = require('./translate.js');
const { CASKET } = T.cores;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uw-exp-'));
const tone = (hz, amp, n, fsr) => { const b = new Float64Array(n); for (let i = 0; i < n; i++) b[i] = amp * Math.sin(2 * Math.PI * hz * i / fsr); return b; };
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const tpDb = (L, R) => 20 * Math.log10(Math.max(CASKET.truePeakOf(L, 16), CASKET.truePeakOf(R, 16)));

// ---- (10) dither ------------------------------------------------------------
console.log('(10) Dither — 16-bit export is TPDF-dithered and deterministic when seeded');
{
  const N = 8000, L = tone(220, 0.3, N, 48000), R = tone(220, 0.3, N, 48000);
  const a = path.join(dir, 'd1.wav'), b = path.join(dir, 'd2.wav'), u = path.join(dir, 'undith.wav');
  writeWav(a, L, R, 48000, 16, { seed: 7 }); writeWav(b, L, R, 48000, 16, { seed: 7 }); writeWav(u, L, R, 48000, 16, { dither: false });
  check('same seed -> byte-identical file (deterministic)', Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0);
  check('dither changes samples vs truncation', Buffer.compare(fs.readFileSync(a), fs.readFileSync(u)) !== 0);
  const rd = readWav(a);
  const onGrid = [...rd.L].every((v) => Math.abs(v * 32768 - Math.round(v * 32768)) < 1e-9);
  check('output sits on the 16-bit grid', onGrid);
}

// ---- (12) AIFF + format dispatch --------------------------------------------
console.log('(12) AIFF — write/read round-trip, readAudio dispatches by magic');
{
  const N = 6000, L = tone(300, 0.5, N, 48000), R = tone(300, 0.5, N, 44100 /* differ */); // R just different content
  const aiff = path.join(dir, 't.aiff');
  writeAiff(aiff, L, R, 48000, 24);
  const rd = readAiff(aiff);
  check('AIFF sample rate + length', rd.sampleRate === 48000 && rd.L.length === N, `${rd.sampleRate}Hz x${rd.L.length}`);
  check('AIFF 24-bit round-trip within a step', maxDiff(rd.L, L) < 2e-7, `maxdiff ${maxDiff(rd.L, L).toExponential(2)}`);
  const wav = path.join(dir, 't.wav'); writeWav(wav, L, R, 48000, 24);
  check('readAudio dispatches AIFF vs WAV', readAudio(aiff).sampleRate === 48000 && readAudio(wav).sampleRate === 48000);
  let threw = false; const bogus = path.join(dir, 'x.bin'); fs.writeFileSync(bogus, Buffer.from('OggS....')); try { readAudio(bogus); } catch (e) { threw = true; }
  check('unknown format throws (control)', threw);
}

// ---- (18) true-peak safety net ----------------------------------------------
console.log('(18) True-peak guard — trims an over, leaves a clear signal alone');
{
  const N = 20000, L = tone(1000, 0.999, N, 48000), R = tone(1105, 0.999, N, 48000);   // inter-sample over -1
  const before = tpDb(L, R);
  const g = guardTruePeak(L, R, -1);
  check('an over-ceiling signal is flagged and trimmed', g.wasOver && g.trimDb < 0, `was ${before.toFixed(2)} -> trim ${g.trimDb}`);
  check('after the guard it holds -1 dBTP', tpDb(g.L, g.R) <= -1 + 0.02, `${tpDb(g.L, g.R).toFixed(3)}`);
  const q = tone(1000, 0.2, N, 48000);
  const g2 = guardTruePeak(q, q, -1);
  check('a clear signal is left untouched (control)', !g2.wasOver && g2.L === q, `tp ${g2.truePeakDb}`);
}

// ---- (11) sample-rate sweep -------------------------------------------------
console.log('(11) Sample-rate sweep — the chain hits target and holds ceiling at every rate');
for (const fsr of [44100, 48000, 88200, 96000]) {
  const N = Math.round(fsr * 0.7), L = new Float64Array(N), R = new Float64Array(N);
  for (let i = 0; i < N; i++) { const t = i / fsr; L[i] = 0.5 * Math.sin(2 * Math.PI * 90 * t) + 0.3 * Math.sin(2 * Math.PI * 900 * t); R[i] = 0.5 * Math.sin(2 * Math.PI * 90 * t + 0.2) + 0.3 * Math.sin(2 * Math.PI * 1100 * t); }
  let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); const gg = 0.8 / pk; for (let i = 0; i < N; i++) { L[i] *= gg; R[i] *= gg; }
  const { out } = calibrate({ compAmount: 0.3, ceilingDbTp: -1, targetLufs: -14 }, L, R, fsr, { passes: 6 });
  check(`${fsr} Hz: hits -14 LUFS`, Math.abs(out.meters.integrated - (-14)) < 0.5, `${out.meters.integrated.toFixed(2)}`);
  check(`${fsr} Hz: holds ceiling`, 20 * Math.log10(out.meters.truePeak) <= -1 + 0.05, `${(20 * Math.log10(out.meters.truePeak)).toFixed(3)}`);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
