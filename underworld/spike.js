// THE UNDERWORLD — chaining spike.
// Proves the Masterbox->trilogy signal/preset contract end-to-end, under LAW 0
// (../UNDERWORLD_CHARTER.md): we ONLY drive the trilogy cores' public API
// (createEngine/setState/process, CASKET.renderOffline) and chain their outputs.
// Nothing of theirs is edited.
//
// Two assertions, each with its control:
//   A. CEILING — hot signal AUTOPSY->RIGOR->CASKET(lid -1 dBTP, driven) comes out at or
//      under -1 dBTP AND rides up to it. Control: the INPUT is over the ceiling.
//   B. NULL    — all three idle -> bit-exact to 1 ULP. Control: the working chain differs.
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const AUTOPSY = require(path.join(ROOT, 'AUTOPSY', 'autopsy_core.js'));
const RIGOR   = require(path.join(ROOT, 'RIGOR', 'rigor_core.js'));
const CASKET  = require(path.join(ROOT, 'CASKET', 'casket_core.js'));

const FS = 48000, N = FS;

function makeInput() {
  const L = new Float64Array(N), R = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / FS;
    L[i] = 0.6*Math.sin(2*Math.PI*110*t) + 0.4*Math.sin(2*Math.PI*1320*t) + 0.3*Math.sin(2*Math.PI*60*t);
    R[i] = 0.6*Math.sin(2*Math.PI*110*t + 0.15) + 0.4*Math.sin(2*Math.PI*1760*t) + 0.3*Math.sin(2*Math.PI*60*t);
  }
  let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.92 / pk; for (let i = 0; i < N; i++) { L[i] *= g; R[i] *= g; }
  return { L, R };
}
const dbtp = (L, R) => 20*Math.log10(Math.max(CASKET.truePeakOf(L, 16), CASKET.truePeakOf(R, 16)));
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]-b[i])); return m; };
function stage(core, state) {
  const e = core.createEngine(FS); e.setState(state);
  return (inL, inR) => { const oL = new Float64Array(inL.length), oR = new Float64Array(inR.length); e.process(inL, inR, oL, oR); return { L: oL, R: oR }; };
}
let pass = 0, fail = 0;
const check = (name, cond, detail) => (cond ? (pass++, console.log(`  [PASS] ${name}  ${detail}`)) : (fail++, console.log(`  [FAIL] ${name}  ${detail}`)));

// ============================ A. CEILING =====================================
console.log('A. Ceiling — hot signal AUTOPSY -> RIGOR -> CASKET(lid -1 dBTP)');
let working;
{
  const { L, R } = makeInput();
  const inDb = dbtp(L, R);
  const aState = AUTOPSY.defaultState();
  aState.bands[0] = { on: true, type: 'lowshelf', freq: 120, gain: 3, q: 0.7, slope: 12, place: 'st', dyn: { on:false, range:0, thresh:-30, att:10, rel:150 } };
  const a = stage(AUTOPSY, aState)(L, R);
  const rState = RIGOR.defaultState(); rState.thresh = -24; rState.ratio = 3; rState.look = 0; rState.mix = 100;
  const r = stage(RIGOR, rState)(a.L, a.R);
  const cState = CASKET.defaultState(); cState.lid = -1.0; cState.drive = 8;
  const out = CASKET.renderOffline(cState, r.L, r.R, FS);
  const outDb = dbtp(out.L, out.R);
  console.log(`     input=${inDb.toFixed(3)} dBTP   output=${outDb.toFixed(3)} dBTP   CASKET latency=${out.latency} smp`);
  check('input was actually over the ceiling (control)', inDb > -1.0, `in ${inDb.toFixed(2)} > -1`);
  check('output holds -1 dBTP ceiling', outDb <= -1.0 + 0.05, `out ${outDb.toFixed(3)} <= -0.95`);
  check('limiter actively rode up to the ceiling', outDb > -1.5, `out ${outDb.toFixed(3)} near -1 (driven)`);
  working = { inL: L, outL: out.L, n: out.L.length };
}

// ============================ B. NULL ========================================
console.log('B. Null — all three idle, expect bit-exact passthrough');
{
  const { L, R } = makeInput();
  const a = stage(AUTOPSY, AUTOPSY.defaultState())(L, R);            // no bands
  const rState = RIGOR.defaultState(); rState.mix = 0; rState.look = 0;  // 100% dry
  const r = stage(RIGOR, rState)(a.L, a.R);
  // True idle for CASKET's active path: lid above signal + knee:0 + dc:false.
  const cState = CASKET.defaultState(); cState.lid = 6.0; cState.knee = 0; cState.dc = false;
  const out = CASKET.renderOffline(cState, r.L, r.R, FS);
  const dL = maxDiff(out.L, L), dR = maxDiff(out.R, R), ULP = Number.EPSILON;
  console.log(`     max|out-in|  L=${dL.toExponential(2)}  R=${dR.toExponential(2)}   (1 ULP = ${ULP.toExponential(2)})`);
  check('idle chain is bit-exact passthrough (<= 1 ULP)', Math.max(dL, dR) <= ULP, `maxdiff ${Math.max(dL,dR).toExponential(2)}`);
  let wd = 0; for (let i = 0; i < working.n; i++) wd = Math.max(wd, Math.abs(working.outL[i]-working.inL[i]));
  check('working chain differs from input (control)', wd > 0.01, `working maxdiff ${wd.toFixed(3)}`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
