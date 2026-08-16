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
const fsMod = require('fs');
const { readAudio, writeWav, writeAiff } = require('./wav.js');
const { writePreset } = require('./preset-io.js');
const { guardTruePeak } = require('./safety.js');
const T = require('./translate.js');
const { calibrate } = require('./calibrate.js');

// Build settings + run the pipeline. Pure: no file I/O, so tests drive it directly.
function runPipeline(L, R, fs, opts) {
  let ms = {
    ceilingDbTp: opts.ceiling != null ? opts.ceiling : -1,
    targetLufs: opts.lufs != null ? opts.lufs : -14,
    compAmount: opts.comp != null ? opts.comp : 0,
    eqLow: opts.eqLow, eqHigh: opts.eqHigh, eqLowMid: opts.eqLowMid, eqHighMid: opts.eqHighMid,
    width: opts.width, makeupDb: 0,
  };
  if (opts.delivery) ms = T.fromDelivery(opts.delivery, ms);
  return calibrate(ms, L, R, fs, { passes: opts.passes || 5 });
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

function main(argv) {
  const o = parseArgs(argv);
  const inPath = o._[0];
  if (!inPath) { console.error('usage: cli.js in.wav [--out out.wav] [--delivery club] [--lufs -14] [--ceiling -1] [--comp 0.3] ...'); process.exit(2); }
  const { L, R, sampleRate } = readAudio(inPath);
  const { preset, out } = runPipeline(L, R, sampleRate, o);
  // final independent true-peak guard before the file is written
  const guard = guardTruePeak(out.L, out.R, preset.target.ceilingDbTp);
  preset.report.safety = guard.wasOver ? { trimmedDb: guard.trimDb, independentTruePeakDb: guard.truePeakDb } : { trimmedDb: 0 };
  const bits = o.bits === 16 ? 16 : 24;
  const fmt = (o.format || 'wav').toLowerCase();
  const base = inPath.replace(/\.(wav|aiff?|flac)$/i, '');
  const outFile = o.out || `${base}.mastered.${fmt === 'aiff' ? 'aiff' : 'wav'}`;
  const outJson = o.preset || `${base}.underworld.json`;
  (fmt === 'aiff' ? writeAiff : writeWav)(outFile, guard.L, guard.R, sampleRate, bits);
  fsMod.writeFileSync(outJson, writePreset(preset));
  const r = preset.report;
  console.log(`\n  THE UNDERWORLD — mastered ${inPath}`);
  console.log(`  target      : ${preset.target.lufs} LUFS  /  ${preset.target.ceilingDbTp} dBTP`);
  console.log(`  achieved    : ${r.achieved.lufs} LUFS  /  ${r.achieved.truePeakDb} dBTP  ${r.calibration.reachedTarget ? '✓' : '(missed)'}`);
  console.log(`  calibration : ${r.calibration.passes.length} passes${r.calibration.driveAtLimit ? '  [drive at limit]' : ''}`);
  console.log(`  safety      : ${guard.wasOver ? `trimmed ${guard.trimDb} dB (independent meter read ${guard.truePeakDb})` : 'clear'}`);
  console.log(`  clamped     : ${r.clamped.length ? r.clamped.map(c => c.field).join(', ') : 'none'}`);
  console.log(`  output      : ${bits}-bit ${fmt.toUpperCase()}  ·  latency ${out.latency} smp`);
  console.log(`  -> ${outFile}\n  -> ${outJson}\n`);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { runPipeline, parseArgs };
