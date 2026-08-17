// JS↔C++ translator parity (task C10). Compiles the C++ CLI, runs it per case, and compares
// the emitted preset to the JS toChainPreset. Pure-arithmetic fields must be BYTE-EXACT;
// transcendental-derived fields (freqs via pow, msSide via log10) agree to within a ULP —
// byte-exactness there would require necromath, which LAW 0 forbids forking. All well below
// anything audible (1e-9 dB / Hz).
const { execFileSync } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const T = require('./translate.js');
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));

const bin = path.join(os.tmpdir(), 'uw_translate_parity');
try { execFileSync('c++', ['-std=c++17', '-ffp-contract=off', path.join(__dirname, 'cpp', 'main.cpp'), '-o', bin]); }
catch (e) { console.log('  [FAIL] C++ did not compile\n' + (e.stderr || e).toString()); process.exit(1); }

const flagMap = { eqLow: '--eq-low', eqHigh: '--eq-high', eqLowMid: '--eq-low-mid', eqHighMid: '--eq-high-mid', compAmount: '--comp', punch: '--punch', width: '--width', makeupDb: '--makeup', ceilingDbTp: '--ceiling', targetLufs: '--lufs', dqAmount: '--dq-amount', sideAir: '--side-air', midBody: '--mid-body' };
function cppPreset(ms) {
  const args = [];
  for (const k of Object.keys(flagMap)) if (ms[k] != null) args.push(flagMap[k], String(ms[k]));
  return JSON.parse(execFileSync(bin, args, { encoding: 'utf8' }));
}

const cases = [
  { name: 'eq + comp', ms: { eqLow: 2, eqHigh: -1, compAmount: 0.4, punch: 0.5, ceilingDbTp: -1, targetLufs: -14 } },
  { name: 'width + comp', ms: { compAmount: 0.7, width: 1.35, ceilingDbTp: -0.3, targetLufs: -8 } },
  { name: 'mids + high target', ms: { eqLowMid: 1.5, eqHighMid: -2, compAmount: 0.2, ceilingDbTp: -1, targetLufs: -9 } },
  { name: 'dyn eq + m/s', ms: { dqAmount: 0.8, sideAir: 4, midBody: 3, compAmount: 0.3, ceilingDbTp: -1, targetLufs: -14 } },
];

console.log('JS ↔ C++ translator parity');
const EXACT = 0, TOL = 1e-9;
for (const { name, ms } of cases) {
  const js = T.toChainPreset(ms), cpp = cppPreset(ms);
  let exactBad = 0, tolBad = 0;
  // pure arithmetic: byte-exact
  for (const k of ['thresh', 'ratio', 'attack', 'release', 'knee', 'bands']) if (Math.abs(js.rigor[k] - cpp.rigor[k]) > EXACT) exactBad++;
  for (const k of ['lid', 'drive', 'targetLufs']) if (Math.abs((js.casket[k] || 0) - (cpp.casket[k] || 0)) > EXACT) exactBad++;
  if (Math.abs(js.target.lufs - cpp.target.lufs) > EXACT || Math.abs(js.target.ceilingDbTp - cpp.target.ceilingDbTp) > EXACT) exactBad++;
  // transcendental-derived: within a ULP
  if (Math.abs((js.casket.msSide || 0) - (cpp.casket.msSide || 0)) > TOL) tolBad++;
  for (let i = 0; i < js.autopsy.bands.length; i++) {
    const a = js.autopsy.bands[i], b = cpp.autopsy.bands[i];
    if (a.on !== b.on || a.type !== b.type || a.place !== b.place) exactBad++;
    if (Math.abs(a.gain - b.gain) > EXACT) exactBad++;          // gains are pure arithmetic
    if (Math.abs(a.freq - b.freq) > 1e-6) tolBad++;             // freqs via pow
  }
  check(`${name}: pure-arithmetic fields byte-exact`, exactBad === 0, exactBad ? `${exactBad} mismatches` : 'all exact');
  check(`${name}: transcendental fields within a ULP`, tolBad === 0, `msSide/freq drift ${tolBad}`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
