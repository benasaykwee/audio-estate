// The three translator assertions from UNDERWORLD_INTERCHANGE §3.2, each with a control
// that proves it BITES (§11: "prove each bites by breaking it once").
const T = require('./translate.js');
const { AUTOPSY, RIGOR, CASKET } = T.cores;
const FS = 48000;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d||''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d||''}`)));
const eng = (core, state, inL, inR) => { const e = core.createEngine(FS); e.setState(state); const oL = new Float64Array(inL.length), oR = new Float64Array(inR.length); e.process(inL, inR, oL, oR); return [oL, oR]; };
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]-b[i])); return m; };

// ===================== §3.2(1) FIXPOINT ======================================
console.log('§3.2(1) Fixpoint — every emitted state is a sanitiser fixpoint');
{
  const p = T.toChainPreset({ ceilingDbTp: -1, makeupDb: 3, targetLufs: -14 });
  for (const [core, San] of [['autopsy', AUTOPSY.sanitizeState], ['rigor', RIGOR.sanitizeState], ['casket', CASKET.sanitizeState]]) {
    check(`${core}: sanitize(s) === s`, eq(San(p[core]), p[core]));
    check(`${core}: sanitize idempotent`, eq(San(San(p[core])), San(p[core])));
  }
  // control — prove the check bites: a hand-corrupted state is NOT a fixpoint
  const bad = Object.assign({}, p.casket, { lid: 999 });
  check('fixpoint check bites (corrupted lid=999 fails)', !eq(CASKET.sanitizeState(bad), bad));
}

// ===================== §3.2(2) CLAMPING REPORTED =============================
console.log('§3.2(2) Clamping — reported, never silent');
{
  const over = T.toChainPreset({ ceilingDbTp: 5, makeupDb: 99, targetLufs: -14 }); // lid +5 -> 0, drive 99 -> 24
  const lidC = over.report.clamped.find(c => c.field === 'lid');
  const drvC = over.report.clamped.find(c => c.field === 'drive');
  check('lid +5 clamp reported', !!lidC, lidC ? `asked ${lidC.asked} -> ${lidC.got}` : 'MISSING');
  check('drive 99 clamp reported', !!drvC, drvC ? `asked ${drvC.asked} -> ${drvC.got}` : 'MISSING');
  // control — in-range settings report NOTHING (proves it isn't always-true)
  const ok = T.toChainPreset({ ceilingDbTp: -1, makeupDb: 3, targetLufs: -14 });
  check('in-range -> no false clamps (control)', ok.report.clamped.length === 0, `n=${ok.report.clamped.length}`);
}

// ===================== §3.2(3) RENDER MEASURED + NULL ========================
console.log('§3.2(3) Render — hits ceiling; a "do nothing" preset nulls');
{
  const N = FS, L = new Float64Array(N), R = new Float64Array(N);
  for (let i = 0; i < N; i++) { const t = i/FS; L[i] = 0.6*Math.sin(2*Math.PI*110*t) + 0.4*Math.sin(2*Math.PI*1320*t); R[i] = 0.6*Math.sin(2*Math.PI*110*t+0.15) + 0.4*Math.sin(2*Math.PI*1760*t); }
  let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.92/pk; for (let i = 0; i < N; i++) { L[i] *= g; R[i] *= g; }
  const dbtp = (a, b) => 20*Math.log10(Math.max(CASKET.truePeakOf(a,16), CASKET.truePeakOf(b,16)));

  // working preset: ceiling -1, driven; AUTOPSY/RIGOR idle, CASKET does the work
  const p = T.toChainPreset({ ceilingDbTp: -1, makeupDb: 8, targetLufs: -14 });
  let [aL, aR] = eng(AUTOPSY, p.autopsy, L, R);
  let [rL, rR] = eng(RIGOR, p.rigor, aL, aR);
  const out = CASKET.renderOffline(p.casket, rL, rR, FS);
  const od = dbtp(out.L, out.R);
  check('rendered chain holds -1 dBTP ceiling', od <= -1 + 0.05, `out ${od.toFixed(3)} dBTP`);
  check('limiter actively rode to the ceiling (control)', od > -1.5, `out ${od.toFixed(3)}`);

  // null control: a "do nothing" preset -> bit-exact through the whole chain (signal under lid)
  const hL = L.map(x => x*0.5), hR = R.map(x => x*0.5);   // ~ -6 dBFS, below lid=0
  const idle = { autopsy: T.autopsyIdle(), rigor: T.rigorIdle(), casket: T.casketIdle() };
  let [ia, ib] = eng(AUTOPSY, idle.autopsy, hL, hR);
  let [ic, id] = eng(RIGOR, idle.rigor, ia, ib);
  const io = CASKET.renderOffline(idle.casket, ic, id, FS);
  const nd = Math.max(maxDiff(io.L, hL), maxDiff(io.R, hR));
  check('do-nothing preset nulls (<= 1 ULP)', nd <= Number.EPSILON, `maxdiff ${nd.toExponential(2)}`);
  // control — the working chain is NOT a null
  check('working chain is not a null (control)', maxDiff(out.L, rL) > 0.01, `maxdiff ${maxDiff(out.L, rL).toFixed(3)}`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
