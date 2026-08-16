// THE UNDERWORLD — delivery compare (task 14) and dry-run plan (task 16).
const T = require('./translate.js');
const { calibrate } = require('./calibrate.js');
const { diffPresets } = require('./diff.js');
const { CASKET } = T.cores;

// Master the same mix to several delivery targets and diff the first two.
function compareDeliveries(L, R, fs, deliveries, baseMs) {
  const results = deliveries.map((d) => {
    const ms = T.fromDelivery(d, Object.assign({}, baseMs || {}));
    const { preset, out } = calibrate(ms, L, R, fs);
    return { delivery: d, preset, achievedLufs: +out.meters.integrated.toFixed(2), truePeakDb: +(20 * Math.log10(out.meters.truePeak)).toFixed(2) };
  });
  return { results, diff: results.length >= 2 ? diffPresets(results[0].preset, results[1].preset) : [] };
}

// Dry run: what the chain WILL do, without a full render. Fast — no calibration/limiting.
function plan(ms) {
  const preset = T.toChainPreset(ms);
  const moves = [];
  const on = preset.autopsy.bands.filter((b) => b.on);
  if (on.length) moves.push(`EQ: ${on.length} band${on.length > 1 ? 's' : ''} (${on.slice(0, 4).map((b) => `${Math.round(b.freq)}Hz ${b.gain > 0 ? '+' : ''}${b.gain.toFixed(1)}`).join(', ')}${on.length > 4 ? '…' : ''})`);
  if (preset.rigor.ratio > 1.01) moves.push(`Comp: ${preset.rigor.ratio.toFixed(1)}:1 @ ${preset.rigor.thresh.toFixed(0)} dB, ${preset.rigor.bands}-band`);
  if (preset.casket.ms) moves.push(`Width: side ${preset.casket.msSide > 0 ? '+' : ''}${preset.casket.msSide.toFixed(1)} dB`);
  moves.push(`Limiter: ${preset.casket.lid} dBTP ceiling`);
  moves.push(`Target: ${preset.target.lufs} LUFS`);
  return { preset, moves, clamped: preset.report.clamped };
}

module.exports = { compareDeliveries, plan };
