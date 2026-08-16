// Preset library (13), delivery compare (14), plan/dry-run (16), HTML report (12), A/B + report export (15,12).
const fs = require('fs'), os = require('os'), path = require('path');
const { STARTER_PACK, savePreset, loadPreset, listPresets } = require('./presets.js');
const { compareDeliveries, plan } = require('./compare.js');
const { renderReportHtml } = require('./report-html.js');
const { fullReport } = require('./report.js');
const { calibrate } = require('./calibrate.js');
const { writeWav } = require('./wav.js');
const { main } = require('./cli.js');
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uw-del-'));
const sig = (n) => { const L = new Float64Array(n), R = new Float64Array(n); for (let i = 0; i < n; i++) { const t = i / FS; L[i] = 0.5 * Math.sin(2 * Math.PI * 90 * t) + 0.3 * Math.sin(2 * Math.PI * 800 * t); R[i] = 0.5 * Math.sin(2 * Math.PI * 90 * t + 0.2) + 0.3 * Math.sin(2 * Math.PI * 1000 * t); } let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); const g = 0.8 / pk; for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; } return { L, R }; };

// ---- (13) preset library ----------------------------------------------------
console.log('(13) Preset library — starter pack + save/load');
{
  check('starter pack has named presets', Object.keys(STARTER_PACK).length >= 5, `${Object.keys(STARTER_PACK).length}`);
  savePreset('my sound', { compAmount: 0.4, eqLow: 2, targetLufs: -13 }, dir);
  const back = loadPreset('my sound', dir);
  check('save then load round-trips', back.compAmount === 0.4 && back.eqLow === 2);
  check('listPresets finds it', listPresets(dir).includes('my_sound'));
}

// ---- (14) delivery compare --------------------------------------------------
console.log('(14) Compare — same mix to two targets, with a diff');
{
  const s = sig(FS);
  const { results, diff } = compareDeliveries(s.L, s.R, FS, ['spotify', 'club'], { compAmount: 0.3 });
  check('both targets reached', Math.abs(results[0].achievedLufs - (-14)) < 0.6 && Math.abs(results[1].achievedLufs - (-8)) < 0.6, `${results[0].achievedLufs} / ${results[1].achievedLufs}`);
  check('diff reports the target change', diff.some((c) => /target LUFS/.test(c.field)), JSON.stringify(diff.find((c) => /target/.test(c.field)) || {}));
}

// ---- (16) plan / dry-run ----------------------------------------------------
console.log('(16) Plan — the moves, without a render');
{
  const p = plan({ eqLow: 3, compAmount: 0.5, width: 1.3, ceilingDbTp: -1, targetLufs: -12 });
  check('plan lists EQ, comp, limiter, target', p.moves.length >= 4 && p.moves.some((m) => /Comp/.test(m)) && p.moves.some((m) => /Limiter/.test(m)), p.moves.length + ' moves');
  check('plan returns the preset without rendering', !!p.preset.casket && p.preset.format === 'underworld.chain');
}

// ---- (12) HTML report -------------------------------------------------------
console.log('(12) HTML report — a standalone page from the full report');
{
  const s = sig(FS);
  const { preset, out } = calibrate({ compAmount: 0.4, ceilingDbTp: -1, targetLufs: -12 }, s.L, s.R, FS);
  const rep = fullReport(s.L, s.R, out.L, out.R, preset, out, FS);
  const html = renderReportHtml(rep, 'test-master');
  check('report HTML is a full page', /<!doctype html>/i.test(html) && /Master Report/.test(html) && html.length > 1500);
  check('report shows achieved loudness', html.includes(String(rep.achieved.lufs)));
}

// ---- (15,12) CLI --ab --report export ---------------------------------------
console.log('(15) CLI --ab --report — writes matched original + HTML report');
{
  const s = sig(FS); const inP = path.join(dir, 'mix.wav'); writeWav(inP, s.L, s.R, FS, 24);
  const log = console.log; console.log = () => {};      // silence the CLI banner
  main([inP, '--delivery', 'spotify', '--comp', '0.3', '--ab', '--report']);
  console.log = log;
  const b = path.join(dir, 'mix');
  check('mastered WAV written', fs.existsSync(b + '.mastered.wav'));
  check('matched A/B original written', fs.existsSync(b + '.ab-original.wav'));
  check('HTML report written', fs.existsSync(b + '.report.html') && fs.readFileSync(b + '.report.html', 'utf8').includes('Master Report'));
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
