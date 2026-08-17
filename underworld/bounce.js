// THE UNDERWORLD — master to several delivery targets at once (app-polish).
// One mix in, a set of masters out — each calibrated to its platform and guarded.
const T = require('./translate.js');
const { calibrate } = require('./calibrate.js');
const { guardTruePeak } = require('./safety.js');

function bounceAll(L, R, fs, deliveries, baseMs) {
  return deliveries.map((d) => {
    const ms = T.fromDelivery(d, Object.assign({}, baseMs || {}));
    const { preset, out } = calibrate(ms, L, R, fs);
    const guard = guardTruePeak(out.L, out.R, preset.target.ceilingDbTp);
    return { delivery: d, L: guard.L, R: guard.R, achievedLufs: +out.meters.integrated.toFixed(2), ceilingDbTp: preset.target.ceilingDbTp, trimDb: guard.trimDb };
  });
}

module.exports = { bounceAll };
