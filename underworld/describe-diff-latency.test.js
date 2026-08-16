// Genre presets (5), preset diff (15), latency/PDC self-test (17).
const T = require('./translate.js');
const { genre, GENRE } = require('./describe.js');
const { diffPresets } = require('./diff.js');
const { latencySelfTest } = require('./selftest.js');
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));

// ---- (5) genres -------------------------------------------------------------
console.log('(5) Genres — each yields a valid, distinct chain preset');
{
  const hashes = new Set();
  for (const name of Object.keys(GENRE)) {
    const ms = genre(name), p = T.toChainPreset(ms);
    check(`${name} -> valid preset`, p.format === 'underworld.chain' && !!p.autopsy && !!p.rigor && !!p.casket);
    hashes.add(JSON.stringify(p.casket) + JSON.stringify(p.autopsy).length);
  }
  check('genres are not all identical (control)', hashes.size >= 6, `${hashes.size} distinct`);
  let threw = false; try { genre('polka-core'); } catch (e) { threw = true; }
  check('unknown genre throws (control)', threw);
}

// ---- (15) preset diff -------------------------------------------------------
console.log('(15) Diff — reports exactly what changed between two chains');
{
  const a = T.toChainPreset({ eqLow: 2, compAmount: 0.3, ceilingDbTp: -1, targetLufs: -14 });
  const b = T.toChainPreset({ eqLow: 5, compAmount: 0.3, ceilingDbTp: -1, targetLufs: -9 });
  const d = diffPresets(a, b);
  check('finds the target change', d.some((c) => /target LUFS/.test(c.field) && c.to === -9), JSON.stringify(d.find((c) => /target/.test(c.field)) || {}));
  check('finds the low-EQ change', d.some((c) => /AUTOPSY band0/.test(c.field)), d.filter((c) => /AUTOPSY/.test(c.field)).map((c) => c.field).join(','));
  check('identical presets -> empty diff (control)', diffPresets(a, a).length === 0);
}

// ---- (17) latency self-test -------------------------------------------------
console.log('(17) Latency — reported figure is honest, compensation aligns the impulse');
{
  const r = latencySelfTest(FS);
  check('raw impulse exits at the reported CASKET latency', r.rawHonest, `exit ${r.rawExitOffset} == ${r.casketLat}`);
  check('reported chain latency = CASKET latency (AUTOPSY/RIGOR = 0)', r.reported === r.casketLat, `${r.reported}`);
  check('compensated chain lands the impulse at the front', r.aligned, `at ${r.compExitIndex} (in at 100)`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
