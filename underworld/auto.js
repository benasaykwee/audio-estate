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

// Dynamic-EQ depth from analysis (task 6): find where the spectrum sticks out above its
// local trend (resonances) and set the dynamic-cut amount + per-region thresholds from how
// peaky each region is — instead of a fixed dqAmount.
function autoDynEq(mixL, mixR, fs) {
  const freqs = T.MATCH_FREQS;
  const sp = averageSpectrum(mixL, mixR, fs, freqs);
  const peak = sp.map((v, b) => {
    const nb = [sp[b - 1], sp[b + 1]].filter((x) => x != null);
    return v - nb.reduce((s, x) => s + x, 0) / nb.length;
  });
  const reg = (a, b) => { let m = 0; for (let i = a; i <= b; i++) m = Math.max(m, peak[i] || 0); return m; };
  const low = reg(0, 3), mid = reg(3, 6), high = reg(7, 9), overall = Math.max(low, mid, high);
  return {
    dqAmount: +Math.min(1, overall / 6).toFixed(3),
    dqThrLow: +(-20 - low * 2).toFixed(1), dqThrMid: +(-20 - mid * 2).toFixed(1), dqThrHigh: +(-20 - high * 2).toFixed(1),
    peakiness: { low: +low.toFixed(1), mid: +mid.toFixed(1), high: +high.toFixed(1) },
  };
}

// RIGOR tuning from analysis (tasks 7,8,9): sidechain HP + detector from the low-end and
// crest, per-band threshold offsets from each region's energy, crossovers at spectral valleys.
function autoRigorTuning(mixL, mixR, fs) {
  const freqs = T.MATCH_FREQS, sp = averageSpectrum(mixL, mixR, fs, freqs);
  let peak = 0, sq = 0; for (let i = 0; i < mixL.length; i++) { const v = Math.abs(mixL[i]); if (v > peak) peak = v; sq += mixL[i] * mixL[i]; }
  const crest = 20 * Math.log10(peak / (Math.sqrt(sq / mixL.length) + 1e-12) + 1e-12);
  const region = (a, b) => { let m = 0; for (let i = a; i <= b; i++) m += sp[i]; return m / (b - a + 1); };
  const lowE = region(0, 2), m = mean(sp);
  const off = (e) => +Math.max(-12, Math.min(12, -(e - m) * 0.5)).toFixed(1);
  const valley = (a, b) => { let bi = a, bv = 1e9; for (let i = a; i <= b; i++) if (sp[i] < bv) { bv = sp[i]; bi = i; } return Math.round(freqs[bi]); };
  return {
    scHp: lowE > m + 4 ? 90 : 30,                          // HP the sidechain when the low end dominates
    detect: crest > 12 ? 'peak' : 'rms',
    bandThreshOff: [off(region(0, 2)), off(region(3, 6)), off(region(7, 9))],
    xover: [Math.max(80, Math.min(400, valley(2, 4))), Math.max(1500, Math.min(6000, valley(6, 8)))],
    crest: +crest.toFixed(1),
  };
}

module.exports = { matchReference, withLraTarget, autoDynEq, autoRigorTuning };
