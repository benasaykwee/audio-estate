// The reconciler must AGREE on clean material and SURFACE the disagreement on noise —
// never hide it. (§9.3)
const { reconcileTruePeak } = require('./meter-reconcile.js');
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));

const N = FS;
// clean tone — meters should agree
const tL = new Float64Array(N), tR = new Float64Array(N);
for (let i = 0; i < N; i++) { tL[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / FS); tR[i] = tL[i]; }
// broadband noise — the worst case for inter-sample peaks
const nL = new Float64Array(N), nR = new Float64Array(N); let seed = 999;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
for (let i = 0; i < N; i++) { nL[i] = 0.5 * rnd(); nR[i] = 0.5 * rnd(); }

console.log('Meter reconciliation — agree on tone, surface the gap on noise');
{
  const t = reconcileTruePeak(tL, tR, FS);
  check('tone: meters agree (spread <= 0.1 dB)', t.agree, `spread ${t.spreadDb} dB (${t.readings.casketMeter} vs ${t.readings.independent})`);

  const n = reconcileTruePeak(nL, nR, FS);
  check('noise: divergence is surfaced, not hidden', !n.agree && n.spreadDb > 0.1, `spread ${n.spreadDb} dB (${n.readings.casketMeter} vs ${n.readings.independent})`);
  check('noise: both readings are still returned (control)', typeof n.readings.casketMeter === 'number' && typeof n.readings.independent === 'number');

  // a third meter (e.g. Masterbox's) folds in and widens the spread if it disagrees
  const withThird = reconcileTruePeak(nL, nR, FS, { masterbox: n.readings.independent + 0.3 });
  check('extra meter widens the reported spread', withThird.spreadDb >= n.spreadDb, `${withThird.spreadDb} >= ${n.spreadDb}`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
