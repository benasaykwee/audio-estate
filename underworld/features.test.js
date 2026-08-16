// Width mapping, delivery presets, and preset round-trip — each with a control.
const T = require('./translate.js');
const { renderChain } = require('./chain.js');
const { writePreset, readPreset } = require('./preset-io.js');
const { CASKET } = T.cores;
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const sideRms = (L, R) => { let s = 0; for (let i = 0; i < L.length; i++) { const d = (L[i] - R[i]) * 0.5; s += d * d; } return Math.sqrt(s / L.length); };

// ---- width -> CASKET msSide -------------------------------------------------
console.log('Width — maps to CASKET M/S side trim; neutral width keeps the null');
{
  const N = 16384, L = new Float64Array(N), R = new Float64Array(N);
  for (let i = 0; i < N; i++) { const t = i / FS; L[i] = 0.3 * Math.sin(2 * Math.PI * 200 * t) + 0.15 * Math.sin(2 * Math.PI * 600 * t); R[i] = 0.3 * Math.sin(2 * Math.PI * 200 * t); }
  const inSide = sideRms(L, R);
  const render = (w) => { const st = T.translateCasket({ width: w, ceilingDbTp: 0 }).state; const o = CASKET.renderOffline(st, L, R, FS); return o; };
  const wide = render(2.0), narrow = render(0.5), neutral = render(1.0);
  const noWidth = CASKET.renderOffline(T.translateCasket({ ceilingDbTp: 0 }).state, L, R, FS);   // same CASKET, no M/S stage
  check('width 2.0 widens (side ~2x)', sideRms(wide.L, wide.R) / inSide > 1.8, `${(sideRms(wide.L, wide.R) / inSide).toFixed(2)}x`);
  check('width 0.5 narrows (side ~0.5x)', sideRms(narrow.L, narrow.R) / inSide < 0.6, `${(sideRms(narrow.L, narrow.R) / inSide).toFixed(2)}x`);
  check('width 1.0 is a no-op vs no-width (control)', maxDiff(neutral.L, noWidth.L) === 0 && maxDiff(neutral.R, noWidth.R) === 0, `maxdiff ${maxDiff(neutral.L, noWidth.L).toExponential(1)}`);
}

// ---- delivery presets -------------------------------------------------------
console.log('Delivery — maps to target + ceiling, mirrors Masterbox exactly');
{
  const club = T.fromDelivery('club');
  check('club -> -8 LUFS / -0.3 dBTP', club.targetLufs === -8 && club.ceilingDbTp === -0.3, `${club.targetLufs} / ${club.ceilingDbTp}`);
  const bc = T.toChainPreset(T.fromDelivery('broadcast'));
  check('broadcast -> casket.lid -1, target -23', bc.casket.lid === -1 && bc.target.lufs === -23, `lid ${bc.casket.lid}, lufs ${bc.target.lufs}`);
  let threw = false; try { T.fromDelivery('myspace'); } catch (e) { threw = true; }
  check('unknown delivery throws (control)', threw);
}

// ---- preset round-trip ------------------------------------------------------
console.log('Round-trip — slabs re-sanitise, unknown fields survive, render is identical');
{
  const preset = T.toChainPreset({ eqLow: 3, compAmount: 0.5, ceilingDbTp: -1, width: 1.5, makeupDb: 2, targetLufs: -14 });
  preset.customNote = 'a newer writer wrote this';                 // an unknown envelope field
  const back = readPreset(writePreset(preset));
  for (const [core, San] of [['autopsy', T.cores.AUTOPSY.sanitizeState], ['rigor', T.cores.RIGOR.sanitizeState], ['casket', T.cores.CASKET.sanitizeState]])
    check(`${core} slab is a fixpoint after read`, JSON.stringify(San(back[core])) === JSON.stringify(back[core]));
  check('unknown envelope field preserved (§2.3)', back.customNote === 'a newer writer wrote this', back.customNote);

  const N = 24000, L = new Float64Array(N), R = new Float64Array(N);
  for (let i = 0; i < N; i++) { const t = i / FS; L[i] = 0.5 * Math.sin(2 * Math.PI * 120 * t); R[i] = 0.5 * Math.sin(2 * Math.PI * 120 * t + 0.1); }
  const a = renderChain(preset, L, R, FS), b = renderChain(back, L, R, FS);
  check('render identical before/after round-trip', maxDiff(a.L, b.L) === 0 && maxDiff(a.R, b.R) === 0, `maxdiff ${maxDiff(a.L, b.L).toExponential(1)}`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
