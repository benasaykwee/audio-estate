// THE UNDERWORLD — the consolidated master report (round-3 task 20).
// One object holding everything a mastering pass produced and proved, assembled from the
// in/out audio + the calibrated preset. The CLI, the app, and the HTML report all read this.
const { reconcileTruePeak } = require('./meter-reconcile.js');
const { correlation, monoCompatDb, inputStats, loudnessHistory, spectrumBalance } = require('./measure.js');

// Confidence flags: honest concerns a master should surface rather than hide.
function warnings(base, gr, meterCheck, stereo, input) {
  const w = [];
  if (base.calibration && !base.calibration.reachedTarget) w.push({ level: 'warn', msg: `did not reach the loudness target — the mix may be fighting it${base.calibration.driveAtLimit ? ' (drive at its limit)' : ''}` });
  if ((base.clamped || []).length) w.push({ level: 'info', msg: `${base.clamped.length} setting${base.clamped.length > 1 ? 's' : ''} clamped to the core's range` });
  if (input.clipping) w.push({ level: 'warn', msg: `the INPUT is already clipped (${input.clippedSamples} samples at full scale)` });
  if (base.safety && base.safety.trimmedDb) w.push({ level: 'info', msg: `true-peak guard trimmed ${base.safety.trimmedDb} dB before write` });
  if (!meterCheck.agree) w.push({ level: 'info', msg: `the two true-peak meters disagree by ${meterCheck.spreadDb} dB (§9.3)` });
  if (stereo.monoCompatOutDb < -3) w.push({ level: 'warn', msg: `poor mono-compatibility (${stereo.monoCompatOutDb} dB lost folding to mono)` });
  if (gr.rigor > 12) w.push({ level: 'info', msg: `heavy compression (${gr.rigor} dB) — check it isn't squashing the life out` });
  return w;
}

function fullReport(inL, inR, outL, outR, preset, out, fs) {
  const base = preset.report || {};
  const meterCheck = reconcileTruePeak(outL, outR, fs);
  const stereo = { correlationIn: correlation(inL, inR), correlationOut: correlation(outL, outR), monoCompatInDb: monoCompatDb(inL, inR), monoCompatOutDb: monoCompatDb(outL, outR) };
  const input = inputStats(inL, inR);
  const gr = out.gr || { rigor: 0, casket: 0 };
  return {
    warnings: warnings(base, gr, meterCheck, stereo, input),
    target: preset.target,
    achieved: base.achieved,
    calibration: base.calibration,
    clamped: base.clamped || [],
    safety: base.safety || { trimmedDb: 0 },
    gr,
    latencySamples: out.latency,
    meterCheck,
    stereo,
    input,
    spectrum: { in: spectrumBalance(inL, inR, fs), out: spectrumBalance(outL, outR, fs) },
    loudnessHistory: loudnessHistory(outL, outR, fs),
  };
}

module.exports = { fullReport, warnings };
