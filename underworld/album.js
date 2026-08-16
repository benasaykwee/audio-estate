// THE UNDERWORLD — album mode.
// Master a set of tracks to ONE consistent loudness and tone: the same tonal settings and
// the same target LUFS applied to each, so a record plays back even track to track. Each
// track is calibrated individually through the real chain (loudness depends on program),
// so consistency is measured, not assumed.
const { calibrate } = require('./calibrate.js');

function albumMaster(tracks, ms, fs, opts) {
  const masters = tracks.map((t, i) => {
    const { preset, out } = calibrate(ms, t.L, t.R, fs, opts);
    return { index: i, name: t.name || `track ${i + 1}`, preset, out, achievedLufs: out.meters.integrated };
  });
  const lufs = masters.map((m) => m.achievedLufs);
  const spread = Math.max(...lufs) - Math.min(...lufs);
  return { masters, target: ms.targetLufs, spreadLu: +spread.toFixed(3), consistent: spread < 0.5 };
}

module.exports = { albumMaster };
