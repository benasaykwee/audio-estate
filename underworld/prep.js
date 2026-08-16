// THE UNDERWORLD — input preparation (tasks 10, 11).
// removeDc strips a DC offset before the chain (a real fault in some captures); gainStage
// trims the input to a sane operating level so the compressor and limiter work in their
// sweet spot rather than fighting a hot or timid source. Both are opt-in in the pipeline.
function removeDc(L, R) {
  let dl = 0, dr = 0; for (let i = 0; i < L.length; i++) { dl += L[i]; dr += R[i]; }
  dl /= L.length; dr /= R.length;
  const oL = new Float64Array(L.length), oR = new Float64Array(R.length);
  for (let i = 0; i < L.length; i++) { oL[i] = L[i] - dl; oR[i] = R[i] - dr; }
  return { L: oL, R: oR, removedDc: +((dl + dr) / 2).toFixed(6) };
}

function gainStage(L, R, targetPeakDb) {
  targetPeakDb = targetPeakDb == null ? -6 : targetPeakDb;
  let pk = 0; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  if (pk < 1e-9) return { L, R, trimDb: 0 };
  const g = Math.pow(10, targetPeakDb / 20) / pk;
  const oL = new Float64Array(L.length), oR = new Float64Array(R.length);
  for (let i = 0; i < L.length; i++) { oL[i] = L[i] * g; oR[i] = R[i] * g; }
  return { L: oL, R: oR, trimDb: +(20 * Math.log10(g)).toFixed(2) };
}

module.exports = { removeDc, gainStage };
