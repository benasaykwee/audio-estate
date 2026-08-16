// describe() turns words into settings; albumMaster() lands a set of tracks at one loudness.
const T = require('./translate.js');
const { describe } = require('./describe.js');
const { albumMaster } = require('./album.js');
const { renderChain } = require('./chain.js');
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));

console.log('describe — words become settings, and a chain preset');
{
  const w = describe('warm and wide, a bit punchy');
  check('warm -> low up / high down', w.ms.eqLow > 0 && w.ms.eqHigh < 0, `low ${w.ms.eqLow}, high ${w.ms.eqHigh}`);
  check('wide -> width > 1', w.ms.width > 1, `${w.ms.width}`);
  check('punchy -> compression up', w.ms.compAmount > 0, `${w.ms.compAmount}`);
  const p = T.toChainPreset(w.ms);
  check('produces a valid preset', p.format === 'underworld.chain' && !!p.autopsy && !!p.casket);

  const b = describe('bright, loud and aggressive');
  check('bright -> high up', b.ms.eqHigh > 0, `${b.ms.eqHigh}`);
  check('loud -> hotter target', b.ms.targetLufs > -14, `${b.ms.targetLufs}`);

  const none = describe('xyzzy plugh frobnicate');
  check('no keywords -> no matches (control)', none.matched.length === 0, `${none.matched.length}`);
}

console.log('album — three tracks land at one target loudness');
{
  const mk = (freqs, level) => { const N = FS, L = new Float64Array(N), R = new Float64Array(N); for (let i = 0; i < N; i++) { const t = i / FS; let s = 0; freqs.forEach((f, k) => { s += (1 / (k + 1)) * Math.sin(2 * Math.PI * f * t); }); L[i] = s; R[i] = s * 0.98 + 0.02 * Math.sin(2 * Math.PI * freqs[0] * t + 1); } let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); const g = level / pk; for (let i = 0; i < N; i++) { L[i] *= g; R[i] *= g; } return { L, R }; };
  const tracks = [mk([80, 800, 5000], 0.9), mk([120, 1200], 0.4), mk([60, 300, 2000, 8000], 0.7)];

  // raw loudness spread before mastering (control)
  const rawLufs = tracks.map((t) => renderChain({ autopsy: T.autopsyIdle(), rigor: T.rigorIdle(), casket: T.casketIdle() }, t.L, t.R, FS).meters.integrated);
  const rawSpread = Math.max(...rawLufs) - Math.min(...rawLufs);

  const album = albumMaster(tracks, { compAmount: 0.3, eqLow: 1, ceilingDbTp: -1, targetLufs: -14 }, FS, { passes: 6 });
  check('all tracks reach -14 LUFS', album.masters.every((m) => Math.abs(m.achievedLufs - (-14)) < 0.5), album.masters.map((m) => m.achievedLufs.toFixed(2)).join(', '));
  check('album loudness is consistent (spread < 0.5 LU)', album.consistent, `spread ${album.spreadLu} LU`);
  check('raw tracks were NOT consistent (control)', rawSpread > 1, `raw spread ${rawSpread.toFixed(2)} LU`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
