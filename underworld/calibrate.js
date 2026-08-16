// THE UNDERWORLD — loudness calibration.
// The brain asks for a target LUFS; this hits it through the REAL chain by driving CASKET,
// then records what was ACHIEVED in report (§2.5 / §3.3: target is the ask, report is the fact).
//
// Loudness is monotone in drive but NOT linear once the limiter is working (CASKET's own
// note: +6 dB drive buys far less than +6 LU), so this is damped measure-and-offset over a
// few passes — the same shape as Masterbox's learnMaster — breaking when it lands.
const T = require('./translate.js');
const { renderChain } = require('./chain.js');
const { CASKET } = T.cores;

function calibrate(ms, inL, inR, fs, opts) {
  opts = opts || {};
  const maxPasses = opts.passes || 4, tol = opts.tolLu || 0.1;
  const target = ms.targetLufs;
  const preset = T.toChainPreset(ms);
  let drive = preset.casket.drive || 0;
  const history = [];

  for (let i = 0; i < maxPasses; i++) {
    preset.casket = CASKET.sanitizeState(Object.assign({}, preset.casket, { drive }));
    const out = renderChain(preset, inL, inR, fs);
    const achieved = out.meters.integrated;
    history.push({ pass: i + 1, drive: preset.casket.drive, lufs: +achieved.toFixed(3) });
    const gap = target - achieved;                     // +gap => need louder
    if (Math.abs(gap) < tol) break;
    drive = Math.min(24, Math.max(-12, preset.casket.drive + gap));   // dB-for-LU; nonlinearity damps it
  }

  const out = renderChain(preset, inL, inR, fs);
  const clampedDrive = history.length && (history[history.length - 1].drive <= -12 || history[history.length - 1].drive >= 24);
  preset.report = Object.assign({}, preset.report, {
    achieved: { lufs: +out.meters.integrated.toFixed(3), truePeakDb: +(20 * Math.log10(out.meters.truePeak)).toFixed(3) },
    calibration: { target, passes: history, reachedTarget: Math.abs(target - out.meters.integrated) < 0.5, driveAtLimit: clampedDrive },
  });
  return { preset, out };
}

module.exports = { calibrate };
