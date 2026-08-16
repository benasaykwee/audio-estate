// Task 3 (DynEq -> AUTOPSY per-band dynamics) and task 7 (verified explanations).
const T = require('./translate.js');
const { explainChain } = require('./explain.js');
const { AUTOPSY } = T.cores;
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));
const rms = (b) => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); };
const runA = (st, L) => { const e = AUTOPSY.createEngine(FS); e.setState(st); const o1 = new Float64Array(L.length), o2 = new Float64Array(L.length); e.process(L, L, o1, o2); return o1; };
const tone = (hz, amp, n) => { const b = new Float64Array(n); for (let i = 0; i < n; i++) b[i] = amp * Math.sin(2 * Math.PI * hz * i / FS); return b; };

// ---- (3) Dynamic EQ -> AUTOPSY per-band dynamics -----------------------------
console.log('(3) Dynamic EQ — dqAmount engages per-band dynamics that tame loud content');
{
  const st = T.translateAutopsy({ dqAmount: 0.8, dqThrMid: -30 }).state;
  const dynBands = st.bands.filter((b) => b.on && b.dyn && b.dyn.on);
  check('dqAmount engages dynamic bands', dynBands.length >= 1, `${dynBands.length} dyn bands`);
  check('emitted state is a fixpoint', JSON.stringify(AUTOPSY.sanitizeState(st)) === JSON.stringify(st));
  // a loud 1 kHz tone (over the dyn threshold) is reduced more than a quiet one
  const loud = runA(st, tone(1000, 0.5, 16384)), quiet = runA(st, tone(1000, 0.01, 16384));
  const gLoud = rms(loud) / rms(tone(1000, 0.5, 16384)), gQuiet = rms(quiet) / rms(tone(1000, 0.01, 16384));
  check('loud content pulled down more than quiet (dynamic action)', gLoud < gQuiet - 0.02, `loud ${gLoud.toFixed(3)} < quiet ${gQuiet.toFixed(3)}`);
  // control: with dqAmount 0 there is no dynamic action
  const flat = T.translateAutopsy({ dqAmount: 0 }).state;
  check('no DynEq -> no dyn bands (control)', flat.bands.every((b) => !(b.dyn && b.dyn.on)));
}

// ---- (7) Verified explanations ----------------------------------------------
console.log('(7) Explanations — every claim carries measured evidence');
{
  const N = FS, L = new Float64Array(N), R = new Float64Array(N);
  for (let i = 0; i < N; i++) { const t = i / FS; L[i] = 0.5 * Math.sin(2 * Math.PI * 90 * t) + 0.3 * Math.sin(2 * Math.PI * 900 * t); R[i] = 0.5 * Math.sin(2 * Math.PI * 90 * t + 0.2) + 0.3 * Math.sin(2 * Math.PI * 1100 * t); }
  let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); const g = 0.8 / pk; for (let i = 0; i < N; i++) { L[i] *= g; R[i] *= g; }

  const { explain } = explainChain({ eqLow: 4, eqHigh: -3, compAmount: 0.4, width: 1.3, ceilingDbTp: -1, targetLufs: -14 }, L, R, FS);
  check('an explanation was produced for each move', explain.length >= 5, `${explain.length} entries`);
  check('every claim is verified by measurement', explain.every((e) => e.verified === true), explain.filter((e) => !e.verified).map((e) => e.move).join(',') || 'all verified');
  // the measured numbers actually match the intent direction (real evidence, not a rubber stamp)
  const low = explain.find((e) => e.move === 'Low EQ'), high = explain.find((e) => e.move === 'High EQ');
  check('Low EQ measured a real boost', /\+/.test(low.measured), low.measured);
  check('High EQ measured a real cut (control)', /-/.test(high.measured), high.measured);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
