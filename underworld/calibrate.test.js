// Calibration hits the target LUFS through the real chain, across targets, always holding
// the ceiling — with the uncalibrated render as the control that it does something.
const T = require('./translate.js');
const { calibrate } = require('./calibrate.js');
const { renderChain } = require('./chain.js');
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));

// dense-ish program ~ -0.7 dBTP
const N = FS, L = new Float64Array(N), R = new Float64Array(N);
for (let i = 0; i < N; i++) { const t = i / FS; L[i] = 0.55 * Math.sin(2 * Math.PI * 90 * t) + 0.35 * Math.sin(2 * Math.PI * 700 * t) + 0.28 * Math.sin(2 * Math.PI * 3500 * t); R[i] = 0.55 * Math.sin(2 * Math.PI * 90 * t + 0.2) + 0.35 * Math.sin(2 * Math.PI * 900 * t) + 0.28 * Math.sin(2 * Math.PI * 4200 * t); }
let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
const g = 0.92 / pk; for (let i = 0; i < N; i++) { L[i] *= g; R[i] *= g; }

console.log('Calibration — hits target LUFS across targets, holds the ceiling');
for (const target of [-16, -14, -11]) {
  const { preset, out } = calibrate({ compAmount: 0.3, ceilingDbTp: -1, makeupDb: 0, targetLufs: target }, L, R, FS, { passes: 5 });
  const got = out.meters.integrated, tp = 20 * Math.log10(out.meters.truePeak);
  check(`target ${target} LUFS reached`, Math.abs(got - target) < 0.5, `got ${got.toFixed(2)} (${preset.report.calibration.passes.length} passes)`);
  check(`ceiling held at target ${target}`, tp <= -1 + 0.1, `${tp.toFixed(3)} dBTP`);
}

console.log('Control — the uncalibrated render misses, and the report records the fact');
{
  const target = -11;
  const uncal = renderChain(T.toChainPreset({ compAmount: 0.3, ceilingDbTp: -1, makeupDb: 0, targetLufs: target }), L, R, FS);
  const { out } = calibrate({ compAmount: 0.3, ceilingDbTp: -1, makeupDb: 0, targetLufs: target }, L, R, FS, { passes: 5 });
  check('uncalibrated misses the target (control)', Math.abs(uncal.meters.integrated - target) > 0.5, `uncal ${uncal.meters.integrated.toFixed(2)} vs ${target}`);
  check('calibration closed the gap', Math.abs(out.meters.integrated - target) < Math.abs(uncal.meters.integrated - target), `${uncal.meters.integrated.toFixed(2)} -> ${out.meters.integrated.toFixed(2)}`);
}

console.log('Robust exit — deterministic drive on a grid (LAW 5 defense)');
{
  const ms = { compAmount: 0.3, ceilingDbTp: -1, makeupDb: 0, targetLufs: -12 };
  const a = calibrate(ms, L, R, FS, { passes: 6 }), b = calibrate(ms, L, R, FS, { passes: 6 });
  const da = a.preset.casket.drive, db = b.preset.casket.drive;
  check('two runs give identical drive (deterministic)', da === db, `${da} === ${db}`);
  check('final drive sits on the 0.1 dB grid', Math.abs(da * 10 - Math.round(da * 10)) < 1e-9, `${da}`);
  check('pass count is bounded', a.preset.report.calibration.passes.length <= 6, `${a.preset.report.calibration.passes.length}`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
