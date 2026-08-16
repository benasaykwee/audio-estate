// Translator verification. The three §3.2 assertions (fixpoint, clamping-reported,
// rendered-and-null) PLUS render proofs that each core mapping does what it claims —
// every check paired with a control that fails when the mapping is wrong.
const T = require('./translate.js');
const { AUTOPSY, RIGOR, CASKET } = T.cores;
const FS = 48000;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));
const autopsyRun = (state, inL, inR) => { const e = AUTOPSY.createEngine(FS); e.setState(state); const oL = new Float64Array(inL.length), oR = new Float64Array(inR.length); e.process(inL, inR, oL, oR); return { L: oL, R: oR }; };
const rigorRun = (state, inL, inR) => { const e = RIGOR.createMulti(FS); e.setState(state); const oL = new Float64Array(inL.length), oR = new Float64Array(inR.length); e.process(inL, inR, oL, oR); return { L: oL, R: oR }; };
const tone = (hz, amp, n) => { const b = new Float64Array(n); for (let i = 0; i < n; i++) b[i] = amp * Math.sin(2 * Math.PI * hz * i / FS); return b; };
const rms = (b) => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); };
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

// ===================== §3.2(1) FIXPOINT ======================================
console.log('§3.2(1) Fixpoint — every emitted state is a sanitiser fixpoint');
{
  const p = T.toChainPreset({ eqLow: 3, eqHigh: -2, compAmount: 0.5, ceilingDbTp: -1, makeupDb: 3, targetLufs: -14 });
  for (const [core, San] of [['autopsy', AUTOPSY.sanitizeState], ['rigor', RIGOR.sanitizeState], ['casket', CASKET.sanitizeState]]) {
    check(`${core}: sanitize(s) === s`, eq(San(p[core]), p[core]));
    check(`${core}: sanitize idempotent`, eq(San(San(p[core])), San(p[core])));
  }
  const bad = Object.assign({}, p.casket, { lid: 999 });
  check('fixpoint check bites (corrupted lid=999 fails)', !eq(CASKET.sanitizeState(bad), bad));
}

// ===================== §3.2(2) CLAMPING REPORTED =============================
console.log('§3.2(2) Clamping — reported, never silent');
{
  const over = T.toChainPreset({ ceilingDbTp: 5, makeupDb: 99, targetLufs: -14 });
  check('lid +5 clamp reported', !!over.report.clamped.find(c => c.field === 'lid'));
  check('drive 99 clamp reported', !!over.report.clamped.find(c => c.field === 'drive'));
  const ok = T.toChainPreset({ ceilingDbTp: -1, makeupDb: 3, compAmount: 0.5, eqLow: 4, targetLufs: -14 });
  check('in-range -> no false clamps (control)', ok.report.clamped.length === 0, `n=${ok.report.clamped.length}`);
}

// ===================== AUTOPSY (EQ) renders correctly =======================
console.log('AUTOPSY — EQ boosts the right band, leaves the rest, flat = passthrough');
{
  const N = 16384;
  const pLow = T.toChainPreset({ eqLow: 6 });
  const r60 = autopsyRun(pLow.autopsy, tone(60, 0.3, N), tone(60, 0.3, N));
  check('eqLow +6 boosts 60 Hz', rms(r60.L) / rms(tone(60, 0.3, N)) > 1.5, `ratio ${(rms(r60.L) / rms(tone(60, 0.3, N))).toFixed(2)}`);
  const r4k = autopsyRun(pLow.autopsy, tone(4000, 0.3, N), tone(4000, 0.3, N));
  check('eqLow +6 leaves 4 kHz (selectivity control)', Math.abs(rms(r4k.L) / rms(tone(4000, 0.3, N)) - 1) < 0.05, `ratio ${(rms(r4k.L) / rms(tone(4000, 0.3, N))).toFixed(3)}`);
  const fb = 4, mf = T.MATCH_FREQS[fb];
  const pM = T.toChainPreset({ matchGains: [0, 0, 0, 0, 6, 0, 0, 0, 0, 0], matchStrength: 1 });
  const rM = autopsyRun(pM.autopsy, tone(mf, 0.3, N), tone(mf, 0.3, N));
  check(`match band ${fb} boosts ${mf.toFixed(0)} Hz`, rms(rM.L) / rms(tone(mf, 0.3, N)) > 1.5, `ratio ${(rms(rM.L) / rms(tone(mf, 0.3, N))).toFixed(2)}`);
  const flat = autopsyRun(T.toChainPreset({}).autopsy, tone(60, 0.3, N), tone(60, 0.3, N));
  check('flat EQ passes through (control)', maxDiff(flat.L, tone(60, 0.3, N)) < 1e-9, `maxdiff ${maxDiff(flat.L, tone(60, 0.3, N)).toExponential(1)}`);
}

// ===================== RIGOR (comp) renders correctly =======================
console.log('RIGOR — loud material compressed, quiet left alone');
{
  const N = 16384;
  const pC = T.toChainPreset({ compAmount: 1, punch: 0.3 });   // thresh -36, ratio 4.5
  const loud = tone(150, 0.5, N);                               // -6 dBFS, well over threshold
  const comp = rigorRun(pC.rigor, loud, loud), idle = rigorRun(T.rigorIdle(), loud, loud);
  check('loud tone is compressed vs idle', rms(comp.L) < rms(idle.L) * 0.7, `${(rms(comp.L) / rms(idle.L)).toFixed(3)}x`);
  const quiet = tone(150, 0.004, N);                           // -48 dBFS, below threshold
  const cq = rigorRun(pC.rigor, quiet, quiet), iq = rigorRun(T.rigorIdle(), quiet, quiet);
  check('quiet tone left alone (threshold control)', Math.abs(rms(cq.L) / rms(iq.L) - 1) < 0.05, `${(rms(cq.L) / rms(iq.L)).toFixed(3)}x`);
}

// ===================== §3.2(3) FULL CHAIN: ceiling + null ====================
console.log('§3.2(3) Full chain — hits ceiling; a "do nothing" preset nulls');
{
  const N = FS, L = new Float64Array(N), R = new Float64Array(N);
  for (let i = 0; i < N; i++) { const t = i / FS; L[i] = 0.6 * Math.sin(2 * Math.PI * 110 * t) + 0.4 * Math.sin(2 * Math.PI * 1320 * t); R[i] = 0.6 * Math.sin(2 * Math.PI * 110 * t + 0.15) + 0.4 * Math.sin(2 * Math.PI * 1760 * t); }
  let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.92 / pk; for (let i = 0; i < N; i++) { L[i] *= g; R[i] *= g; }
  const dbtp = (a, b) => 20 * Math.log10(Math.max(CASKET.truePeakOf(a, 16), CASKET.truePeakOf(b, 16)));

  const p = T.toChainPreset({ eqLow: 2, compAmount: 0.4, ceilingDbTp: -1, makeupDb: 8, targetLufs: -14 });
  const a = autopsyRun(p.autopsy, L, R);
  const r = rigorRun(p.rigor, a.L, a.R);
  const out = CASKET.renderOffline(p.casket, r.L, r.R, FS);
  const od = dbtp(out.L, out.R);
  check('rendered chain holds -1 dBTP ceiling', od <= -1 + 0.05, `out ${od.toFixed(3)} dBTP`);
  check('limiter actively rode to the ceiling (control)', od > -1.5, `out ${od.toFixed(3)}`);

  const hL = L.map(x => x * 0.5), hR = R.map(x => x * 0.5);
  const ia = autopsyRun(T.autopsyIdle(), hL, hR);
  const ir = rigorRun(T.rigorIdle(), ia.L, ia.R);
  const io = CASKET.renderOffline(T.casketIdle(), ir.L, ir.R, FS);
  const nd = Math.max(maxDiff(io.L, hL), maxDiff(io.R, hR));
  check('do-nothing preset nulls (<= 1 ULP)', nd <= Number.EPSILON, `maxdiff ${nd.toExponential(2)}`);
  check('working chain is not a null (control)', maxDiff(out.L, r.L) > 0.01, `maxdiff ${maxDiff(out.L, r.L).toFixed(3)}`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
