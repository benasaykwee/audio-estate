// THE UNDERWORLD — analysis-driven settings.
// matchReference (task 4): derive a Match-EQ curve that moves the mix's tonal SHAPE toward a
// reference (level-normalised, so it's tone not loudness), optionally matching loudness too.
// withLraTarget (task 9): tighten dynamics toward a target loudness range.
const T = require('./translate.js');
const { averageSpectrum } = require('./analyze.js');
const { CASKET } = T.cores;

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

function matchReference(mixL, mixR, refL, refR, fs, opts) {
  opts = opts || {};
  const freqs = T.MATCH_FREQS;
  const mix = averageSpectrum(mixL, mixR, fs, freqs), ref = averageSpectrum(refL, refR, fs, freqs);
  const mm = mean(mix), rm = mean(ref);
  const strength = opts.strength == null ? 0.8 : opts.strength;
  const matchGains = freqs.map((_, b) => Math.max(-12, Math.min(12, ((ref[b] - rm) - (mix[b] - mm)) * strength)));
  const ms = Object.assign({ matchGains, matchStrength: 1, ceilingDbTp: opts.ceilingDbTp || -1, targetLufs: opts.targetLufs || -14 }, opts.base || {});
  if (opts.matchLoudness) ms.targetLufs = +CASKET.meterBuffer(refL, refR, fs).integrated.toFixed(2);
  return { ms, mixSpectrum: mix, refSpectrum: ref };
}

// Push compression up when the mix is more dynamic than the target range. LRA falls as
// compression rises, so this is a first-pass estimate the calibration then renders.
function withLraTarget(ms, mixL, mixR, fs, targetLra) {
  const lra = CASKET.meterBuffer(mixL, mixR, fs).lra;
  const out = Object.assign({}, ms);
  if (lra > targetLra) out.compAmount = Math.min(1, (ms.compAmount || 0) + (lra - targetLra) * 0.08);
  return { ms: out, measuredLra: +lra.toFixed(2) };
}

module.exports = { matchReference, withLraTarget };
