// THE UNDERWORLD — measurement (round 3). Everything a mastering report should show,
// computed from the in/out buffers: correlation, mono-compatibility, input health, the
// before/after tonal balance, and a loudness-over-time history.
const T = require('./translate.js');
const { averageSpectrum } = require('./analyze.js');
const { CASKET } = T.cores;

const rms = (b) => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); };

function correlation(L, R) {
  let ll = 0, rr = 0, lr = 0;
  for (let i = 0; i < L.length; i++) { ll += L[i] * L[i]; rr += R[i] * R[i]; lr += L[i] * R[i]; }
  const d = Math.sqrt(ll * rr); return d < 1e-20 ? 1 : +(lr / d).toFixed(3);
}

// How much level survives a fold to mono (0 dB = perfectly mono-compatible).
function monoCompatDb(L, R) {
  const mono = new Float64Array(L.length); for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) * 0.5;
  const stereo = Math.sqrt((rms(L) ** 2 + rms(R) ** 2) / 2);
  if (stereo < 1e-20) return 0;
  return +Math.max(-60, Math.min(0, 20 * Math.log10(rms(mono) / stereo + 1e-9))).toFixed(2);   // floor at -60, never -Inf
}

function inputStats(L, R) {
  let peak = 0, clipped = 0, dcL = 0, dcR = 0;
  for (let i = 0; i < L.length; i++) { peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); if (Math.abs(L[i]) > 0.999 || Math.abs(R[i]) > 0.999) clipped++; dcL += L[i]; dcR += R[i]; }
  return { peakDb: +(20 * Math.log10(peak + 1e-12)).toFixed(2), clippedSamples: clipped, clipping: clipped > 8, dcOffset: +((dcL + dcR) / (2 * L.length)).toFixed(5) };
}

// Integrated loudness in a sliding window -> a curve for a history graph.
function loudnessHistory(L, R, fs, winSec, hopSec) {
  winSec = winSec || 1.0; hopSec = hopSec || 0.5;
  const win = Math.round(fs * winSec), hop = Math.round(fs * hopSec), out = [];
  for (let off = 0; off + win <= L.length; off += hop) {
    const wl = L.subarray(off, off + win), wr = R.subarray(off, off + win);
    out.push({ t: +(off / fs).toFixed(2), lufs: +CASKET.meterBuffer(wl, wr, fs).integrated.toFixed(2) });
  }
  return out;
}

function spectrumBalance(L, R, fs) {
  const sp = averageSpectrum(L, R, fs, T.MATCH_FREQS);
  return T.MATCH_FREQS.map((f, b) => ({ hz: Math.round(f), db: +sp[b].toFixed(1) }));
}

module.exports = { correlation, monoCompatDb, inputStats, loudnessHistory, spectrumBalance, rms };
