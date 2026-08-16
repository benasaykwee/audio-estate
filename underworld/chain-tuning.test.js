// RIGOR sidechain/detector/per-band/crossover from analysis (7,8,9), input prep (10,11).
const T = require('./translate.js');
const { autoRigorTuning } = require('./auto.js');
const { removeDc, gainStage } = require('./prep.js');
const { RIGOR } = T.cores;
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));
const mk = (fn, n) => { const L = new Float64Array(n), R = new Float64Array(n); for (let i = 0; i < n; i++) { const [l, r] = fn(i / FS, i); L[i] = l; R[i] = r; } return { L, R }; };

// ---- (7,8,9) RIGOR tuning from analysis --------------------------------------
console.log('(7,8,9) RIGOR tuning — sidechain/detector/crossovers/per-band from analysis');
{
  let seed = 3; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  const bass = mk((t) => { const v = 0.8 * Math.sin(2 * Math.PI * 55 * t) + 0.1 * Math.sin(2 * Math.PI * 3000 * t); return [v, v]; }, FS);
  const bright = mk((t) => { const v = 0.2 * Math.sin(2 * Math.PI * 300 * t) + 0.7 * Math.sin(2 * Math.PI * 6000 * t); return [v, v]; }, FS);
  const transient = mk((_, i) => { const v = (i % 4800 < 60) ? 0.9 * (1 - (i % 4800) / 60) : 0.02 * rnd(); return [v, v]; }, FS);
  const bt = autoRigorTuning(bass.L, bass.R, FS), brt = autoRigorTuning(bright.L, bright.R, FS), tt = autoRigorTuning(transient.L, transient.R, FS);
  check('bass-heavy -> higher sidechain HP', bt.scHp > brt.scHp, `bass ${bt.scHp} vs bright ${brt.scHp}`);
  check('transient material -> peak detector', tt.detect === 'peak', `crest ${tt.crest}`);
  check('crossovers land in range', bt.xover[0] >= 80 && bt.xover[0] <= 400 && bt.xover[1] >= 1500 && bt.xover[1] <= 6000, JSON.stringify(bt.xover));
  check('per-band threshold offsets, 3 values', bt.bandThreshOff.length === 3);
  // feed the tuning into the translator and confirm it takes
  const st = RIGOR.sanitizeState(T.translateRigor(Object.assign({ compAmount: 0.4 }, bt)).state);
  check('translator applies sidechain + detector + per-band', st.scOn && st.scHp === bt.scHp && st.detect === bt.detect && st.band[0].threshOff === bt.bandThreshOff[0], `scHp ${st.scHp} detect ${st.detect}`);
  check('emitted RIGOR state is a fixpoint', JSON.stringify(RIGOR.sanitizeState(st)) === JSON.stringify(st));
}

// ---- (10,11) input prep ------------------------------------------------------
console.log('(10,11) Input prep — DC removal and gain-staging');
{
  const off = mk((t) => { const v = 0.3 * Math.sin(2 * Math.PI * 200 * t); return [v + 0.05, v - 0.03]; }, FS);   // +0.05/-0.03 DC
  const dc = removeDc(off.L, off.R);
  let ml = 0, mr = 0; for (let i = 0; i < dc.L.length; i++) { ml += dc.L[i]; mr += dc.R[i]; }
  check('DC offset removed (means ~0)', Math.abs(ml / dc.L.length) < 1e-9 && Math.abs(mr / dc.R.length) < 1e-9, `reported ${dc.removedDc}`);

  const quiet = mk((t) => { const v = 0.05 * Math.sin(2 * Math.PI * 200 * t); return [v, v]; }, FS);
  const st = gainStage(quiet.L, quiet.R, -6);
  let pk = 0; for (let i = 0; i < st.L.length; i++) pk = Math.max(pk, Math.abs(st.L[i]), Math.abs(st.R[i]));
  check('gain-staged to -6 dBFS peak', Math.abs(20 * Math.log10(pk) - (-6)) < 0.1, `peak ${(20 * Math.log10(pk)).toFixed(2)} dB (trim ${st.trimDb})`);
  check('gain-stage trim is positive for a quiet source (control)', st.trimDb > 0, `${st.trimDb} dB`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
