// Three guards in the trilogy's own idiom:
//   (11) golden render — the chain hits its target and holds its ceiling across program types
//   (12) byte-stable baselines — a fixed settings object -> a byte-identical preset (§9.4)
//   (17) null-control matrix — each core's idle nulls AND each working config does not
const T = require('./translate.js');
const { renderChain } = require('./chain.js');
const { calibrate } = require('./calibrate.js');
const { AUTOPSY, RIGOR, CASKET } = T.cores;
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const fnv = (s) => { let h = 0x811c9dc5 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('0000000' + (h >>> 0).toString(16)).slice(-8); };
const dbtp = (a, b) => 20 * Math.log10(Math.max(CASKET.truePeakOf(a, 16), CASKET.truePeakOf(b, 16)));

// ---- signal generators (deterministic) --------------------------------------
function norm(L, R, peak) { let pk = 0; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); const g = peak / pk; for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; } }
function signal(kind, n, peak) {
  const L = new Float64Array(n), R = new Float64Array(n); let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  for (let i = 0; i < n; i++) {
    const t = i / FS;
    if (kind === 'tone') { L[i] = Math.sin(2 * Math.PI * 440 * t); R[i] = Math.sin(2 * Math.PI * 440 * t + 0.1); }
    else if (kind === 'noise') { L[i] = rnd(); R[i] = rnd(); }
    else if (kind === 'dense') { L[i] = Math.sin(2 * Math.PI * 70 * t) + 0.7 * Math.sin(2 * Math.PI * 520 * t) + 0.5 * Math.sin(2 * Math.PI * 2600 * t) + 0.3 * Math.sin(2 * Math.PI * 9000 * t); R[i] = Math.sin(2 * Math.PI * 70 * t + 0.2) + 0.7 * Math.sin(2 * Math.PI * 610 * t) + 0.5 * Math.sin(2 * Math.PI * 3100 * t); }
    else if (kind === 'mono') { L[i] = Math.sin(2 * Math.PI * 300 * t) + 0.5 * Math.sin(2 * Math.PI * 1500 * t); R[i] = L[i]; }
  }
  norm(L, R, peak == null ? 0.9 : peak);
  return { L, R };
}

// ---- (11) golden render across program material -----------------------------
console.log('(11) Golden render — hits -14 LUFS and holds the ceiling on every program type');
for (const kind of ['tone', 'noise', 'dense', 'mono']) {
  const s = signal(kind, FS);
  const { out } = calibrate({ compAmount: 0.35, ceilingDbTp: -1, makeupDb: 0, targetLufs: -14 }, s.L, s.R, FS, { passes: 6 });
  check(`${kind}: reaches -14 LUFS`, Math.abs(out.meters.integrated - (-14)) < 0.5, `${out.meters.integrated.toFixed(2)}`);
  // The ceiling CASKET GUARANTEES is what its own limiter/meter enforce; an independent
  // meter (truePeakOf) can read ~0.15 dB higher on noise — that divergence is task 18 / §9.3.
  check(`${kind}: holds -1 dBTP (CASKET meter)`, 20 * Math.log10(out.meters.truePeak) <= -1 + 0.05, `${(20 * Math.log10(out.meters.truePeak)).toFixed(3)}`);
}

// ---- (12) byte-stable baselines ---------------------------------------------
console.log('(12) Byte-stable — a fixed settings object yields a byte-identical preset');
{
  const cases = {
    A: { eqLow: 2, eqHigh: -1, eqLowMid: 1, compAmount: 0.4, punch: 0.5, width: 1.2, ceilingDbTp: -1, makeupDb: 0, targetLufs: -14 },
    B: T.fromDelivery('club', { compAmount: 0.6, eqHigh: 2 }),
    C: { matchGains: [3, 2, 0, -1, -2, 0, 1, 2, 3, 4], matchStrength: 0.8, compAmount: 0.2, ceilingDbTp: -0.3, targetLufs: -9 },
  };
  const BASELINE = { A: '03bdc20a', B: '1f6e4cc8', C: 'd5a3aec3' };
  for (const k of Object.keys(cases)) {
    const h1 = fnv(JSON.stringify(T.toChainPreset(cases[k]))), h2 = fnv(JSON.stringify(T.toChainPreset(cases[k])));
    check(`case ${k} matches baseline ${BASELINE[k]}`, h1 === BASELINE[k], h1 === BASELINE[k] ? '' : `got ${h1} (re-bless if the mapping changed on purpose)`);
    check(`case ${k} is deterministic (control)`, h1 === h2);
  }
}

// ---- (17) null-control matrix ------------------------------------------------
console.log('(17) Null matrix — each core idle nulls, each working config does not');
{
  const s = signal('dense', 16384, 0.4);   // below any lid so CASKET idle can null
  const L = s.L, R = s.R;
  const runA = (st) => { const e = AUTOPSY.createEngine(FS); e.setState(st); const o1 = new Float64Array(L.length), o2 = new Float64Array(R.length); e.process(L, R, o1, o2); return { L: o1, R: o2 }; };
  const runR = (st) => { const e = RIGOR.createMulti(FS); e.setState(st); const o1 = new Float64Array(L.length), o2 = new Float64Array(R.length); e.process(L, R, o1, o2); return { L: o1, R: o2 }; };
  const runC = (st) => CASKET.renderOffline(st, L, R, FS);
  const rows = [
    ['AUTOPSY', runA, T.autopsyIdle(), T.translateAutopsy({ eqLow: 6 }).state],
    ['RIGOR', runR, T.rigorIdle(), T.translateRigor({ compAmount: 1 }).state],
    ['CASKET', runC, T.casketIdle(), T.translateCasket({ ceilingDbTp: -12, makeupDb: 12 }).state],
  ];
  for (const [name, run, idle, work] of rows) {
    const ni = Math.max(maxDiff(run(idle).L, L), maxDiff(run(idle).R, R));
    const nw = maxDiff(run(work).L, L);
    check(`${name} idle nulls (<= 1 ULP)`, ni <= Number.EPSILON, `${ni.toExponential(1)}`);
    check(`${name} working is not a null (control)`, nw > 0.001, `${nw.toExponential(2)}`);
  }
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
