// THE UNDERWORLD — loudness calibration.
// The brain asks for a target LUFS; this hits it through the REAL chain by driving CASKET,
// then records what was ACHIEVED in report (§2.5 / §3.3: target is the ask, report is the fact).
//
// Loudness is monotone in drive but NOT linear once the limiter is working (CASKET's own
// note: +6 dB drive buys far less than +6 LU), so this is damped measure-and-offset over a
// few passes — the same shape as Masterbox's learnMaster.
//
// LAW 5, defended deliberately. This loop is the SAME shape as CASKET's autoDrive, which
// produces different iteration counts (and a quantised output offset) at -O3 because a
// float landing near the tolerance flips a boundary comparison. Two guards make this loop
// robust to that, so a future C++ port does not inherit the failure:
//   1. Drive lives on a 0.1 dB GRID (which is how CASKET applies it anyway). The exit test
//      compares grid points by `===` of canonicalised values, never a raw-float tolerance —
//      so sub-grid float noise cannot change the iteration count.
//   2. The final drive is the best GRID point seen (min |gap|), so if it dithers between two
//      grid steps the result is stable and bounded, never a runaway.
// With `-ffp-contract=off` (§4 LAW 1) the loudness is bit-identical build-to-build, so the
// whole loop is then bit-reproducible; without it, the worst case is a bounded 0.1 dB step.
const T = require('./translate.js');
const { renderChain } = require('./chain.js');
const { CASKET } = T.cores;

const grid = (d) => Math.round(Math.min(24, Math.max(-12, d)) * 10) / 10;   // 0.1 dB grid

function calibrate(ms, inL, inR, fs, opts) {
  opts = opts || {};
  const maxPasses = opts.passes || 6;
  const target = ms.targetLufs;
  const preset = T.toChainPreset(ms);
  let drive = grid(preset.casket.drive || 0);
  const history = [];
  let bestDrive = drive, bestAbsGap = Infinity;

  for (let i = 0; i < maxPasses; i++) {
    preset.casket = CASKET.sanitizeState(Object.assign({}, preset.casket, { drive }));
    const out = renderChain(preset, inL, inR, fs);
    const achieved = out.meters.integrated;
    const gap = target - achieved;                     // +gap => need louder
    history.push({ pass: i + 1, drive, lufs: +achieved.toFixed(3) });
    if (Math.abs(gap) < bestAbsGap) { bestAbsGap = Math.abs(gap); bestDrive = drive; }
    const next = grid(drive + gap);                    // dB-for-LU; nonlinearity damps it
    if (next === drive) break;                          // discrete fixpoint on the grid — robust exit
    drive = next;
  }

  preset.casket = CASKET.sanitizeState(Object.assign({}, preset.casket, { drive: bestDrive }));
  const out = renderChain(preset, inL, inR, fs);
  preset.report = Object.assign({}, preset.report, {
    achieved: { lufs: +out.meters.integrated.toFixed(3), truePeakDb: +(20 * Math.log10(out.meters.truePeak)).toFixed(3) },
    calibration: { target, gridDb: 0.1, passes: history, reachedTarget: Math.abs(target - out.meters.integrated) < 0.5, driveAtLimit: bestDrive <= -12 || bestDrive >= 24 },
  });
  return { preset, out };
}

module.exports = { calibrate };
