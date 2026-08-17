// App-polish workflow: confidence warnings, multi-platform bounce, preset library bundle.
const fs = require('fs'), os = require('os'), path = require('path');
const { fullReport } = require('./report.js');
const { calibrate } = require('./calibrate.js');
const { bounceAll } = require('./bounce.js');
const { savePreset, exportLibrary, importLibrary, listPresets } = require('./presets.js');
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uw-pol-'));
const mk = (fn, n, peak) => { const L = new Float64Array(n), R = new Float64Array(n); for (let i = 0; i < n; i++) { const [l, r] = fn(i / FS); L[i] = l; R[i] = r; } let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); const g = (peak || 0.8) / pk; for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; } return { L, R }; };

// ---- confidence warnings ----------------------------------------------------
console.log('Warnings — surface honest concerns');
{
  // clipped input
  const clip = mk((t) => { const v = 1.5 * Math.sin(2 * Math.PI * 200 * t); return [Math.max(-1, Math.min(1, v)), Math.max(-1, Math.min(1, v))]; }, FS, 1.0);
  const c1 = calibrate({ compAmount: 0.3, ceilingDbTp: -1, targetLufs: -12 }, clip.L, clip.R, FS);
  const r1 = fullReport(clip.L, clip.R, c1.out.L, c1.out.R, c1.preset, c1.out, FS);
  check('clipped input raises a warning', r1.warnings.some((w) => /clipped/.test(w.msg)), `${r1.warnings.length} warnings`);

  // clean mix — no clipping warning
  const clean = mk((t) => { const m = 0.5 * Math.sin(2 * Math.PI * 90 * t) + 0.3 * Math.sin(2 * Math.PI * 900 * t); return [m, m * 0.98]; }, FS, 0.7);
  const c2 = calibrate({ compAmount: 0.3, ceilingDbTp: -1, targetLufs: -14 }, clean.L, clean.R, FS);
  const r2 = fullReport(clean.L, clean.R, c2.out.L, c2.out.R, c2.preset, c2.out, FS);
  check('clean mix does not warn about clipping (control)', !r2.warnings.some((w) => /clipped/.test(w.msg)));
  check('warnings carry a level', r1.warnings.every((w) => w.level && w.msg));
}

// ---- multi-platform bounce --------------------------------------------------
console.log('Bounce — one mix to several targets at once');
{
  const s = mk((t) => { const m = 0.5 * Math.sin(2 * Math.PI * 90 * t) + 0.3 * Math.sin(2 * Math.PI * 800 * t); return [m, m * 0.98]; }, FS, 0.8);
  const res = bounceAll(s.L, s.R, FS, ['spotify', 'club', 'broadcast'], { compAmount: 0.3 });
  check('three masters, one per target', res.length === 3);
  const byd = Object.fromEntries(res.map((r) => [r.delivery, r]));
  check('each hits its own target', Math.abs(byd.spotify.achievedLufs + 14) < 0.6 && Math.abs(byd.club.achievedLufs + 8) < 0.6 && Math.abs(byd.broadcast.achievedLufs + 23) < 0.6, res.map((r) => `${r.delivery} ${r.achievedLufs}`).join(', '));
}

// ---- preset library bundle --------------------------------------------------
console.log('Library — export/import a shareable bundle');
{
  const a = path.join(dir, 'a'), b = path.join(dir, 'b'); fs.mkdirSync(a); fs.mkdirSync(b);
  savePreset('warm', { eqLow: 2, targetLufs: -14 }, a);
  savePreset('loud', { compAmount: 0.6, targetLufs: -8 }, a);
  const lib = exportLibrary(a);
  check('bundle holds all presets', Object.keys(lib.presets).length === 2 && lib.format === 'underworld.library');
  const names = importLibrary(lib, b);
  check('import restores them elsewhere', names.length === 2 && listPresets(b).sort().join() === 'loud,warm');
  check('a restored preset keeps its values', importLibrary(lib, b) && require(path.join(b, 'warm.underworld.json')).eqLow === 2);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
