// Orchestrator proofs: latency is summed once and compensation is correct (a do-nothing
// preset nulls end-to-end), a working preset holds the ceiling, and length is preserved.
const T = require('./translate.js');
const { renderChain, chainLatency } = require('./chain.js');
const { CASKET, RIGOR } = T.cores;
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const dbtp = (a, b) => 20 * Math.log10(Math.max(CASKET.truePeakOf(a, 16), CASKET.truePeakOf(b, 16)));

// test signal ~ -0.7 dBTP
const N = FS, L = new Float64Array(N), R = new Float64Array(N);
for (let i = 0; i < N; i++) { const t = i / FS; L[i] = 0.6 * Math.sin(2 * Math.PI * 110 * t) + 0.4 * Math.sin(2 * Math.PI * 1320 * t); R[i] = 0.6 * Math.sin(2 * Math.PI * 110 * t + 0.15) + 0.4 * Math.sin(2 * Math.PI * 1760 * t); }
let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
const g = 0.92 / pk; for (let i = 0; i < N; i++) { L[i] *= g; R[i] *= g; }

console.log('Orchestrator — latency summed once, compensation correct');
{
  // latency accounting (§6): AUTOPSY 0 + RIGOR (look:0 -> 0) + CASKET's own
  const p = T.toChainPreset({ ceilingDbTp: -1, makeupDb: 6, compAmount: 0.4, eqLow: 2, targetLufs: -14 });
  check('RIGOR latency is 0 (translator sets look:0)', RIGOR.latencySamples(p.rigor, FS) === 0, `${RIGOR.latencySamples(p.rigor, FS)} smp`);
  const casketLat = CASKET.latencySamples(p.casket, FS);
  check('chainLatency = AUTOPSY 0 + RIGOR 0 + CASKET', chainLatency(p, FS) === casketLat, `${chainLatency(p, FS)} = ${casketLat}`);
  check('latency is non-zero (control — CASKET has lookahead)', casketLat > 0, `${casketLat} smp`);

  const out = renderChain(p, L, R, FS);
  check('output length preserved', out.L.length === N, `${out.L.length}`);
  check('rendered chain holds -1 dBTP ceiling', dbtp(out.L, out.R) <= -1 + 0.05, `${dbtp(out.L, out.R).toFixed(3)} dBTP`);
}

console.log('Compensation is correct — a do-nothing preset nulls end-to-end');
{
  const idle = { autopsy: T.autopsyIdle(), rigor: T.rigorIdle(), casket: T.casketIdle() };
  const hL = L.map(x => x * 0.5), hR = R.map(x => x * 0.5);   // below the idle lid
  const out = renderChain(idle, hL, hR, FS);
  const nd = Math.max(maxDiff(out.L, hL), maxDiff(out.R, hR));
  check('idle preset nulls through the orchestrator (<= 1 ULP)', nd <= Number.EPSILON, `maxdiff ${nd.toExponential(2)}`);
  // control: a working preset does NOT null
  const w = renderChain(T.toChainPreset({ compAmount: 0.6, makeupDb: 8, ceilingDbTp: -1 }), L, R, FS);
  check('working preset is not a null (control)', maxDiff(w.L, L) > 0.01, `maxdiff ${maxDiff(w.L, L).toFixed(3)}`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
