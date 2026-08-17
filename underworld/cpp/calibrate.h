// THE UNDERWORLD — C++ loudness calibration skeleton (task C11).
// The LAW-5-defensive grid exit, ported from calibrate.js: drive lives on a 0.1 dB grid and
// the loop exits when the QUANTISED next drive equals the current — never on a raw-float
// tolerance. This is the design that pre-empts CASKET's autoDrive -O3 failure; keeping it in
// the C++ from the start means the host path cannot reintroduce it.
//
// It is measure-callback driven, so it needs no trilogy code: the host passes a function that
// renders at a given drive and returns the achieved LUFS.
#pragma once
#include <functional>
#include <cmath>
#include <algorithm>

namespace underworld {

inline double gridDrive(double d) { return std::round(std::min(24.0, std::max(-12.0, d)) * 10.0) / 10.0; }

struct CalibrationResult { double drive; int passes; bool reachedTarget; };

inline CalibrationResult calibrateDrive(double targetLufs,
                                        const std::function<double(double)>& measureAtDrive,
                                        int maxPasses = 6) {
  double drive = gridDrive(0), bestDrive = drive, bestAbsGap = 1e300;
  int passes = 0;
  for (int i = 0; i < maxPasses; ++i) {
    ++passes;
    double achieved = measureAtDrive(drive);
    double gap = targetLufs - achieved;
    if (std::fabs(gap) < bestAbsGap) { bestAbsGap = std::fabs(gap); bestDrive = drive; }
    double next = gridDrive(drive + gap);
    if (next == drive) break;                       // discrete fixpoint on the grid — robust exit
    drive = next;
  }
  return { bestDrive, passes, bestAbsGap < 0.5 };
}

} // namespace underworld
