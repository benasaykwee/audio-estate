// THE UNDERWORLD — final true-peak guard (task 18).
// CASKET holds the ceiling by its OWN detector. This is belt-and-braces before the file is
// written: measure with an INDEPENDENT meter (truePeakOf, which reads higher on noise — the
// §9.3 divergence), and if it's over, apply the smallest linear trim that brings it under.
// It only ever brings level DOWN, never up, and reports what it did.
const T = require('./translate.js');
const { CASKET } = T.cores;

function guardTruePeak(L, R, ceilingDb, marginDb) {
  const margin = marginDb == null ? 0 : marginDb;
  const tpDb = 20 * Math.log10(Math.max(CASKET.truePeakOf(L, 16), CASKET.truePeakOf(R, 16)));
  const limit = ceilingDb + margin;
  if (tpDb <= limit) return { L, R, trimDb: 0, wasOver: false, truePeakDb: +tpDb.toFixed(3) };
  const trimDb = limit - tpDb;                    // negative
  const g = Math.pow(10, trimDb / 20);
  const oL = new Float64Array(L.length), oR = new Float64Array(R.length);
  for (let i = 0; i < L.length; i++) { oL[i] = L[i] * g; oR[i] = R[i] * g; }
  return { L: oL, R: oR, trimDb: +trimDb.toFixed(3), wasOver: true, truePeakDb: +tpDb.toFixed(3) };
}

module.exports = { guardTruePeak };
