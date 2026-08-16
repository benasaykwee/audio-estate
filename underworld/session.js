// THE UNDERWORLD — session recall (task 19).
// Reopen a saved master and either re-render it exactly, or re-tweak it: take the saved
// preset's target, layer new setting deltas, and re-calibrate. The preset is the session.
const T = require('./translate.js');
const { readPreset } = require('./preset-io.js');
const { renderChain } = require('./chain.js');
const { calibrate } = require('./calibrate.js');

// Re-render a saved preset exactly as stored (sanitised on the way in).
function rerender(presetOrJson, L, R, fs) {
  const preset = readPreset(presetOrJson);
  return { preset, out: renderChain(preset, L, R, fs) };
}

// Re-tweak: keep the saved target + ceiling, layer overrides (eqLow, compAmount, width...),
// re-derive the chain and re-calibrate to the target.
function retweak(presetOrJson, msOverrides, L, R, fs) {
  const preset = readPreset(presetOrJson);
  const ms = Object.assign(
    { targetLufs: preset.target && preset.target.lufs, ceilingDbTp: preset.target && preset.target.ceilingDbTp },
    msOverrides || {}
  );
  return calibrate(ms, L, R, fs);
}

module.exports = { rerender, retweak };
