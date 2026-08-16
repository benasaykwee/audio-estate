// THE UNDERWORLD — the consolidated master report (round-3 task 20).
// One object holding everything a mastering pass produced and proved, assembled from the
// in/out audio + the calibrated preset. The CLI, the app, and the HTML report all read this.
const { reconcileTruePeak } = require('./meter-reconcile.js');
const { correlation, monoCompatDb, inputStats, loudnessHistory, spectrumBalance } = require('./measure.js');

function fullReport(inL, inR, outL, outR, preset, out, fs) {
  const base = preset.report || {};
  return {
    target: preset.target,
    achieved: base.achieved,
    calibration: base.calibration,
    clamped: base.clamped || [],
    safety: base.safety || { trimmedDb: 0 },
    gr: out.gr || { rigor: 0, casket: 0 },
    latencySamples: out.latency,
    meterCheck: reconcileTruePeak(outL, outR, fs),
    stereo: {
      correlationIn: correlation(inL, inR), correlationOut: correlation(outL, outR),
      monoCompatInDb: monoCompatDb(inL, inR), monoCompatOutDb: monoCompatDb(outL, outR),
    },
    input: inputStats(inL, inR),
    spectrum: { in: spectrumBalance(inL, inR, fs), out: spectrumBalance(outL, outR, fs) },
    loudnessHistory: loudnessHistory(outL, outR, fs),
  };
}

module.exports = { fullReport };
