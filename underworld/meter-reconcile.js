// THE UNDERWORLD — meter reconciliation (§9.3: "whose meters are authoritative?").
// Two BS.1770 true-peak measurements can legitimately disagree — CASKET's own meter uses
// one oversampled reconstruction, its `truePeakOf` utility another (and Masterbox has a
// third). On worst-case material they diverge ~0.15 dB. The seam's rule is to SURFACE the
// disagreement, never silently pick one — so a report can say "held its ceiling by the
// limiter's own detector; an independent meter reads 0.16 dB higher."
const T = require('./translate.js');
const { CASKET } = T.cores;

// A third meter slot is left open for Masterbox's BS.1770 once this runs in a build that
// links it; today we reconcile the two CASKET provides.
function reconcileTruePeak(L, R, fs, extraMeters) {
  const m = CASKET.meterBuffer(L, R, fs);
  const readings = {
    casketMeter: +(20 * Math.log10(m.truePeak)).toFixed(3),
    independent: +(20 * Math.log10(Math.max(CASKET.truePeakOf(L, 16), CASKET.truePeakOf(R, 16)))).toFixed(3),
  };
  if (extraMeters) for (const k of Object.keys(extraMeters)) readings[k] = +extraMeters[k].toFixed(3);
  const vals = Object.values(readings);
  const spread = +(Math.max(...vals) - Math.min(...vals)).toFixed(3);
  return { readings, spreadDb: spread, agree: spread <= 0.1, integratedLufs: +m.integrated.toFixed(3) };
}

module.exports = { reconcileTruePeak };
