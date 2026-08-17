// Robustness (17) + performance benchmark (18). Pathological inputs must stay finite and
// bounded; the offline chain must run comfortably faster than real time.
const T = require('./translate.js');
const { renderChain } = require('./chain.js');
const { sanitizeInput } = require('./prep.js');
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));
const finiteBounded = (b, lim) => { for (let i = 0; i < b.length; i++) if (!Number.isFinite(b[i]) || Math.abs(b[i]) > (lim || 4)) return false; return true; };
const preset = T.toChainPreset({ compAmount: 0.4, eqLow: 2, eqHigh: 1, width: 1.2, ceilingDbTp: -1, targetLufs: -14 });

console.log('(17) Robustness — pathological inputs stay finite and bounded');
const cases = {
  silence: (n) => [new Float64Array(n), new Float64Array(n)],
  dc: (n) => { const a = new Float64Array(n).fill(0.5), b = new Float64Array(n).fill(-0.5); return [a, b]; },
  overscale: (n) => { const a = new Float64Array(n), b = new Float64Array(n); for (let i = 0; i < n; i++) { a[i] = 4 * Math.sin(2 * Math.PI * 200 * i / FS); b[i] = 4 * Math.sin(2 * Math.PI * 200 * i / FS); } return [a, b]; },
  denormal: (n) => { const a = new Float64Array(n).fill(1e-30), b = new Float64Array(n).fill(1e-30); return [a, b]; },
  hardclip: (n) => { const a = new Float64Array(n), b = new Float64Array(n); for (let i = 0; i < n; i++) { a[i] = Math.sin(2 * Math.PI * 200 * i / FS) > 0 ? 1 : -1; b[i] = a[i]; } return [a, b]; },
  mono: (n) => { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = 0.5 * Math.sin(2 * Math.PI * 300 * i / FS); return [a, a.slice()]; },
  subframe: () => [new Float64Array(64).fill(0.3), new Float64Array(64).fill(0.3)],
  single: () => [new Float64Array(1).fill(0.5), new Float64Array(1).fill(0.5)],
};
for (const [name, gen] of Object.entries(cases)) {
  const [L, R] = gen(FS);
  const out = renderChain(preset, L, R, FS);
  check(`${name}: output finite & bounded`, finiteBounded(out.L) && finiteBounded(out.R), `len ${out.L.length}`);
}
// non-finite input is sanitized to 0 before the DSP, so the master stays finite
{
  const L = new Float64Array(FS).fill(NaN), R = new Float64Array(FS).fill(Infinity);
  const s = sanitizeInput(L, R);
  const out = renderChain(preset, s.L, s.R, FS);
  check('NaN/Inf input sanitized -> finite master', finiteBounded(out.L) && finiteBounded(out.R), `fixed ${s.fixed} samples`);
}

console.log('(18) Performance — the offline chain runs faster than real time');
{
  const N = FS * 2, L = new Float64Array(N), R = new Float64Array(N);
  for (let i = 0; i < N; i++) { const t = i / FS; L[i] = 0.5 * Math.sin(2 * Math.PI * 90 * t) + 0.3 * Math.sin(2 * Math.PI * 900 * t); R[i] = L[i] * 0.98; }
  const t0 = process.hrtime.bigint();
  const reps = 3; for (let k = 0; k < reps; k++) renderChain(preset, L, R, FS);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / reps;
  const audioMs = N / FS * 1000, xRt = audioMs / ms;
  check('renders faster than real time', xRt > 1, `${xRt.toFixed(1)}x real time (${ms.toFixed(0)} ms for ${(audioMs / 1000).toFixed(0)}s)`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
