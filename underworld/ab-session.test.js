// A/B pairs (3), album batch (2), session recall (19), meter line (13).
const fs = require('fs'), os = require('os'), path = require('path');
const { abPair } = require('./ab.js');
const { rerender, retweak } = require('./session.js');
const { batchAlbum } = require('./cli.js');
const { writeWav } = require('./wav.js');
const { writePreset } = require('./preset-io.js');
const { calibrate } = require('./calibrate.js');
const { reconcileTruePeak } = require('./meter-reconcile.js');
const T = require('./translate.js');
const { CASKET } = T.cores;
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uw-b-'));
const sig = (fseed, level, n) => { const L = new Float64Array(n), R = new Float64Array(n); for (let i = 0; i < n; i++) { const t = i / FS; L[i] = Math.sin(2 * Math.PI * fseed * t) + 0.5 * Math.sin(2 * Math.PI * fseed * 6 * t); R[i] = L[i] * 0.97; } let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); const g = level / pk; for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; } return { L, R }; };

// ---- (3) loudness-matched A/B ----------------------------------------------
console.log('(3) A/B — the original is matched to the mastered loudness');
{
  const s = sig(100, 0.5, FS);
  const { out } = calibrate({ compAmount: 0.4, ceilingDbTp: -1, targetLufs: -12 }, s.L, s.R, FS);
  const ab = abPair(s.L, s.R, out.L, out.R, FS);
  const matchedLufs = CASKET.meterBuffer(ab.originalMatched.L, ab.originalMatched.R, FS).integrated;
  check('matched original sits at the mastered loudness', Math.abs(matchedLufs - ab.masteredLufs) < 0.1, `${matchedLufs.toFixed(2)} vs ${ab.masteredLufs}`);
  check('the master itself was not altered (control)', ab.mastered.L === out.L);
}

// ---- (19) session recall ----------------------------------------------------
console.log('(19) Session — re-render is exact, re-tweak changes tone but keeps target');
{
  const s = sig(120, 0.6, FS);
  const first = calibrate({ eqLow: 2, compAmount: 0.3, ceilingDbTp: -1, targetLufs: -14 }, s.L, s.R, FS);
  const json = writePreset(first.preset);
  const again = rerender(json, s.L, s.R, FS);
  check('re-render of a saved preset is identical', maxDiff(again.out.L, first.out.L) === 0 && maxDiff(again.out.R, first.out.R) === 0, `maxdiff ${maxDiff(again.out.L, first.out.L).toExponential(1)}`);
  const tweaked = retweak(json, { eqHigh: 4 }, s.L, s.R, FS);
  check('re-tweak keeps the target', Math.abs(tweaked.out.meters.integrated - (-14)) < 0.5, `${tweaked.out.meters.integrated.toFixed(2)}`);
  check('re-tweak changes the sound (control)', maxDiff(tweaked.out.L, first.out.L) > 0.001, `maxdiff ${maxDiff(tweaked.out.L, first.out.L).toExponential(2)}`);
}

// ---- (2) album batch --------------------------------------------------------
console.log('(2) Album — a folder of tracks mastered to one loudness, one report');
{
  const alb = path.join(dir, 'album'); fs.mkdirSync(alb);
  for (const [name, s] of [['a.wav', sig(80, 0.9, FS)], ['b.wav', sig(200, 0.35, FS)], ['c.wav', sig(60, 0.6, FS)]]) writeWav(path.join(alb, name), s.L, s.R, FS, 24);
  batchAlbum(alb, { delivery: 'spotify', comp: 0.3 });
  const masters = fs.readdirSync(alb).filter((f) => /\.mastered\.wav$/.test(f));
  check('a master was written per track', masters.length === 3, `${masters.length}`);
  const rep = JSON.parse(fs.readFileSync(path.join(alb, 'album.underworld.json'), 'utf8'));
  check('album loudness is consistent', rep.spreadLu < 0.5, `spread ${rep.spreadLu} LU`);
  check('every track reached -14', rep.tracks.every((t) => Math.abs(t.lufs - (-14)) < 0.5), rep.tracks.map((t) => t.lufs.toFixed(1)).join(', '));
}

// ---- (13) meter line in the report -----------------------------------------
console.log('(13) Meter line — every master carries a reconciliation');
{
  const s = sig(90, 0.7, FS);
  const { out } = calibrate({ ceilingDbTp: -1, targetLufs: -12 }, s.L, s.R, FS);
  const mc = reconcileTruePeak(out.L, out.R, FS);
  check('reconciliation has both readings + a verdict', typeof mc.readings.casketMeter === 'number' && typeof mc.readings.independent === 'number' && typeof mc.agree === 'boolean', `spread ${mc.spreadDb}`);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
