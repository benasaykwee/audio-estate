// THE UNDERWORLD — loudness-matched A/B (task 3).
// To judge a master you compare TONE, not level. This brings the ORIGINAL to the mastered
// loudness (never the reverse — you never make the master quieter to flatter it), so the
// only thing your ear hears between A and B is what the chain actually changed.
const T = require('./translate.js');
const { CASKET } = T.cores;

const loudness = (L, R, fs) => CASKET.meterBuffer(L, R, fs).integrated;

function abPair(origL, origR, mastL, mastR, fs) {
  const lo = loudness(origL, origR, fs), lm = loudness(mastL, mastR, fs);
  const g = Math.pow(10, (lm - lo) / 20);
  const oL = new Float64Array(origL.length), oR = new Float64Array(origR.length);
  for (let i = 0; i < origL.length; i++) { oL[i] = origL[i] * g; oR[i] = origR[i] * g; }
  return {
    originalMatched: { L: oL, R: oR }, mastered: { L: mastL, R: mastR },
    matchGainDb: +(20 * Math.log10(g)).toFixed(2),
    originalLufs: +lo.toFixed(2), masteredLufs: +lm.toFixed(2),
  };
}

module.exports = { abPair };
