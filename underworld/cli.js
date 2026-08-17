#!/usr/bin/env node
// THE UNDERWORLD — offline CLI. The whole seam, end to end:
//   a WAV in -> a chain preset + a mastered WAV + a report.
//
//   node underworld/cli.js in.wav [--out out.wav] [--preset out.json]
//        [--delivery spotify|club|broadcast|...] [--lufs -14] [--ceiling -1]
//        [--comp 0.3] [--eq-low 2] [--eq-high 1] [--width 1.1]
//
// LAW 0: builds a preset from Masterbox-style settings and renders through the trilogy's
// public API. Nothing of theirs is edited.
const fsMod = require('fs'), nodePath = require('path');
const { readAudio, writeWav, writeAiff } = require('./wav.js');
const { writePreset } = require('./preset-io.js');
const { guardTruePeak } = require('./safety.js');
const { reconcileTruePeak } = require('./meter-reconcile.js');
const { albumMaster } = require('./album.js');
const T = require('./translate.js');
const { calibrate } = require('./calibrate.js');

// Settings from flags: genre/describe form a base, explicit flags override, delivery pins loudness.
function buildMs(opts) {
  const { genre, describe } = require('./describe.js');
  let base = {};
  if (opts.genre) base = genre(opts.genre);
  if (opts.describe) base = Object.assign(base, describe(opts.describe, base).ms);
  let ms = Object.assign({ ceilingDbTp: -1, targetLufs: -14, compAmount: 0, makeupDb: 0 }, base);
  const ov = { ceilingDbTp: opts.ceiling, targetLufs: opts.lufs, compAmount: opts.comp, eqLow: opts.eqLow, eqHigh: opts.eqHigh, eqLowMid: opts.eqLowMid, eqHighMid: opts.eqHighMid, width: opts.width };
  for (const k of Object.keys(ov)) if (ov[k] != null) ms[k] = ov[k];
  if (opts.delivery) ms = T.fromDelivery(opts.delivery, ms);
  return ms;
}
// Build settings + run the pipeline. Pure: no file I/O, so tests drive it directly.
function runPipeline(L, R, fs, opts) {
  return calibrate(buildMs(opts), L, R, fs, { passes: opts.passes || 5 });
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); const v = argv[i + 1]; o[k] = (v === undefined || v.startsWith('--')) ? true : (isNaN(+v) ? v : +v); if (o[k] !== true) i++; }
    else o._.push(a);
  }
  return o;
}

// Master every WAV/AIFF in a folder to ONE target, write masters + one album report.
function batchAlbum(dir, o) {
  const files = fsMod.readdirSync(dir).filter((f) => /\.(wav|aiff?)$/i.test(f)).sort();
  if (!files.length) { console.error('no WAV/AIFF files in ' + dir); process.exit(2); }
  const bits = o.bits === 16 ? 16 : 24, fmt = (o.format || 'wav').toLowerCase();
  console.log(`\n  THE UNDERWORLD — album mode · ${files.length} tracks -> ${o.delivery || (o.lufs || -14) + ' LUFS'}\n`);
  const report = { tracks: [] };
  for (const f of files) {
    const a = readAudio(nodePath.join(dir, f));
    const { preset, out } = runPipeline(a.L, a.R, a.sampleRate, o);
    const g = guardTruePeak(out.L, out.R, preset.target.ceilingDbTp);
    const outFile = nodePath.join(dir, f.replace(/\.(wav|aiff?)$/i, '') + `.mastered.${fmt === 'aiff' ? 'aiff' : 'wav'}`);
    (fmt === 'aiff' ? writeAiff : writeWav)(outFile, g.L, g.R, a.sampleRate, bits);
    const lufs = preset.report.achieved.lufs;
    report.tracks.push({ file: f, lufs, truePeakDb: preset.report.achieved.truePeakDb, trimDb: g.trimDb });
    console.log(`  ${f.padEnd(28)} ${lufs.toFixed(2)} LUFS  ${g.wasOver ? `(trimmed ${g.trimDb})` : ''}`);
  }
  const lufs = report.tracks.map((t) => t.lufs);
  report.spreadLu = +(Math.max(...lufs) - Math.min(...lufs)).toFixed(3);
  fsMod.writeFileSync(nodePath.join(dir, 'album.underworld.json'), JSON.stringify(report, null, 2));
  console.log(`\n  album loudness spread: ${report.spreadLu} LU  ->  ${nodePath.join(dir, 'album.underworld.json')}\n`);
}

function main(argv) {
  const o = parseArgs(argv);
  if (o.album) return batchAlbum(o.album, o);
  const inPath = o._[0];
  if (!inPath) { console.error('usage: cli.js in.wav [--out out.wav] [--delivery club] [--lufs -14] [--ceiling -1]\n            [--comp 0.3] [--bits 16|24] [--format wav|aiff] [--report] [--ab] [--plan]\n       cli.js --album <folder> [--delivery ...] [--ab]'); process.exit(2); }
  if (o.plan) {
    const { plan } = require('./compare.js');
    const p = plan(buildMs(o));
    console.log(`\n  THE UNDERWORLD — plan for ${inPath} (no render)`);
    p.moves.forEach((m) => console.log('  · ' + m));
    if (p.clamped.length) console.log('  clamped: ' + p.clamped.map((c) => c.field).join(', '));
    console.log('');
    return;
  }
  if (o.bounce) {
    const { bounceAll } = require('./bounce.js');
    const src = readAudio(inPath);
    const dels = String(o.bounce).split(',').map((d) => d.trim()).filter(Boolean);
    const b = inPath.replace(/\.(wav|aiff?)$/i, ''), bits = o.bits === 16 ? 16 : 24;
    console.log(`\n  THE UNDERWORLD — bounced ${inPath} to ${dels.length} targets`);
    for (const r of bounceAll(src.L, src.R, src.sampleRate, dels, buildMs(o))) {
      const f = `${b}.${r.delivery}.wav`; writeWav(f, r.L, r.R, src.sampleRate, bits);
      console.log(`  ${r.delivery.padEnd(12)} ${r.achievedLufs} LUFS / ${r.ceilingDbTp} dBTP -> ${f}`);
    }
    console.log('');
    return;
  }
  const { L, R, sampleRate } = readAudio(inPath);
  const { preset, out } = runPipeline(L, R, sampleRate, o);
  // final independent true-peak guard before the file is written
  const guard = guardTruePeak(out.L, out.R, preset.target.ceilingDbTp);
  preset.report.safety = guard.wasOver ? { trimmedDb: guard.trimDb, independentTruePeakDb: guard.truePeakDb } : { trimmedDb: 0 };
  preset.report.meterCheck = reconcileTruePeak(guard.L, guard.R, sampleRate);   // §9.3: every master carries it
  const bits = o.bits === 16 ? 16 : 24;
  const fmt = (o.format || 'wav').toLowerCase();
  const base = inPath.replace(/\.(wav|aiff?|flac)$/i, '');
  const outFile = o.out || `${base}.mastered.${fmt === 'aiff' ? 'aiff' : 'wav'}`;
  const outJson = o.preset || `${base}.underworld.json`;
  (fmt === 'aiff' ? writeAiff : writeWav)(outFile, guard.L, guard.R, sampleRate, bits);
  fsMod.writeFileSync(outJson, writePreset(preset));
  // optional: matched A/B original, and a standalone HTML report
  let abFile, htmlFile;
  if (o.ab) { const { abPair } = require('./ab.js'); const ab = abPair(L, R, guard.L, guard.R, sampleRate); abFile = `${base}.ab-original.wav`; writeWav(abFile, ab.originalMatched.L, ab.originalMatched.R, sampleRate, 16); }
  if (o.report) { const { fullReport } = require('./report.js'); const { renderReportHtml } = require('./report-html.js'); htmlFile = `${base}.report.html`; fsMod.writeFileSync(htmlFile, renderReportHtml(fullReport(L, R, guard.L, guard.R, preset, out, sampleRate), nodePath.basename(base))); }
  const r = preset.report;
  console.log(`\n  THE UNDERWORLD — mastered ${inPath}`);
  console.log(`  target      : ${preset.target.lufs} LUFS  /  ${preset.target.ceilingDbTp} dBTP`);
  console.log(`  achieved    : ${r.achieved.lufs} LUFS  /  ${r.achieved.truePeakDb} dBTP  ${r.calibration.reachedTarget ? '✓' : '(missed)'}`);
  console.log(`  calibration : ${r.calibration.passes.length} passes${r.calibration.driveAtLimit ? '  [drive at limit]' : ''}`);
  console.log(`  safety      : ${guard.wasOver ? `trimmed ${guard.trimDb} dB (independent meter read ${guard.truePeakDb})` : 'clear'}`);
  console.log(`  meters      : ${r.meterCheck.agree ? 'agree' : 'DIVERGE'} ${r.meterCheck.spreadDb} dB (CASKET ${r.meterCheck.readings.casketMeter} · indep ${r.meterCheck.readings.independent})`);
  console.log(`  clamped     : ${r.clamped.length ? r.clamped.map(c => c.field).join(', ') : 'none'}`);
  { const { warnings } = require('./report.js'); const { correlation, monoCompatDb, inputStats } = require('./measure.js');
    const w = warnings(r, out.gr || { rigor: 0, casket: 0 }, r.meterCheck, { monoCompatOutDb: monoCompatDb(guard.L, guard.R) }, inputStats(L, R));
    if (w.length) { console.log('  warnings    :'); w.forEach((x) => console.log(`    ${x.level === 'warn' ? '!' : '·'} ${x.msg}`)); } }
  console.log(`  output      : ${bits}-bit ${fmt.toUpperCase()}  ·  latency ${out.latency} smp`);
  console.log(`  -> ${outFile}\n  -> ${outJson}${abFile ? '\n  -> ' + abFile : ''}${htmlFile ? '\n  -> ' + htmlFile : ''}\n`);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { runPipeline, parseArgs, batchAlbum, buildMs, main };
