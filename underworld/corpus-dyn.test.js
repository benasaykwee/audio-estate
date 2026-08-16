// Golden corpus (14) and analysis-driven dynamic EQ (6).
const T = require('./translate.js');
const { CORPUS } = require('./corpus.js');
const { autoDynEq } = require('./auto.js');
const { calibrate } = require('./calibrate.js');
const { CASKET } = T.cores;
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));

// ---- (14) golden corpus -----------------------------------------------------
console.log('(14) Corpus — every representative program masters to spec, deterministically');
for (const entry of CORPUS) {
  const a = entry.audio;
  const { preset, out } = calibrate(entry.ms, a.L, a.R, a.sampleRate, { passes: 6 });
  const tpMeter = 20 * Math.log10(out.meters.truePeak);
  check(`${entry.name}: reaches ${entry.ms.targetLufs} LUFS`, Math.abs(out.meters.integrated - entry.ms.targetLufs) < 0.6, `${out.meters.integrated.toFixed(2)}`);
  check(`${entry.name}: holds ceiling`, tpMeter <= entry.ms.ceilingDbTp + 0.05, `${tpMeter.toFixed(3)}`);
  const h1 = JSON.stringify(T.toChainPreset(entry.ms)), h2 = JSON.stringify(T.toChainPreset(entry.ms));
  check(`${entry.name}: preset is deterministic`, h1 === h2);
}

// ---- (6) analysis-driven dynamic EQ -----------------------------------------
console.log('(6) Dynamic EQ depth — resonances raise dqAmount; flat material does not');
{
  const N = FS, res = { L: new Float64Array(N), R: new Float64Array(N) }, flat = { L: new Float64Array(N), R: new Float64Array(N) };
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  for (let i = 0; i < N; i++) { const t = i / FS; res.L[i] = 0.1 * rnd() + 0.7 * Math.sin(2 * Math.PI * 2500 * t); res.R[i] = res.L[i]; flat.L[i] = 0.3 * rnd(); flat.R[i] = 0.3 * rnd(); }
  const dr = autoDynEq(res.L, res.R, FS), df = autoDynEq(flat.L, flat.R, FS);
  check('resonance raises dqAmount', dr.dqAmount > df.dqAmount + 0.2, `res ${dr.dqAmount} vs flat ${df.dqAmount}`);
  check('the resonant region is the peaky one', dr.peakiness.mid >= dr.peakiness.low && dr.peakiness.mid >= dr.peakiness.high - 1, JSON.stringify(dr.peakiness));
  // feeding it into the translator engages dynamic bands
  const st = T.translateAutopsy(Object.assign({ eqLow: 0 }, dr)).state;
  check('auto dyn settings engage AUTOPSY dynamics', st.bands.some((b) => b.on && b.dyn && b.dyn.on));
  check('flat material keeps dqAmount low (control)', df.dqAmount < 0.2, `${df.dqAmount}`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
