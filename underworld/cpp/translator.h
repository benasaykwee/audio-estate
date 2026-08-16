// THE UNDERWORLD — C++ translator skeleton (task 16).
// A structural port of underworld/translate.js for the eventual HOST path (UNDERWORLD_INTERCHANGE
// §9.1). It computes the DESIRED state values from Masterbox settings; the host then hands each
// slab to the real trilogy core's setState/sanitizeState. LAW 0: this file includes NO trilogy
// header and links no trilogy code — it is the seam's own logic, compiled on its own.
//
// The one hazard already designed around lives in the JS calibrator, not here: any loudness
// loop that ports later must keep the 0.1 dB grid + discrete exit (autoDrive -O3, LAW 5).
#pragma once
#include <string>
#include <vector>
#include <cmath>
#include <algorithm>

namespace underworld {

struct MasteringSettings {
    double eqLow = 0, eqLowMid = 0, eqHighMid = 0, eqHigh = 0;
    std::vector<double> matchGains;        // up to 10
    double matchStrength = 1.0;
    double compAmount = 0.0, punch = 0.3, width = 1.0;
    double makeupDb = 0.0, ceilingDbTp = -1.0, targetLufs = -14.0;
};

struct EqBand { bool on = false; std::string type = "bell"; double freq = 1000, gain = 0, q = 1.0; std::string place = "st"; };
struct AutopsyState { std::vector<EqBand> bands; };                 // -> AUTOPSY.setState
struct RigorState { int bands = 3; double xover[2] = {200, 3000}, thresh = -18, ratio = 2, attack = 10, release = 150, knee = 6; };
struct CasketState { double lid = -1, drive = 0, targetLufs = -14, msSide = 0; bool ms = false; };
struct ChainPreset { double targetLufs, ceilingDbTp; AutopsyState autopsy; RigorState rigor; CasketState casket; };

inline double clampd(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }

inline std::vector<double> matchFreqs() {
    std::vector<double> f(10);
    for (int b = 0; b < 10; ++b) f[b] = 50.0 * std::pow(14000.0 / 50.0, b / 9.0);
    return f;
}

// RIGOR — mirrors Masterbox MultibandCompressor exactly (thresh=-12-amt*24, ratio=1.5+amt*3,
// attack=1+punch*29 ms, xover 200/3000).
inline RigorState translateRigor(const MasteringSettings& s) {
    double a = clampd(s.compAmount, 0, 1), p = clampd(s.punch, 0, 1);
    RigorState r;
    r.bands = 3; r.xover[0] = 200; r.xover[1] = 3000;
    r.thresh = -12 - a * 24; r.ratio = 1.5 + a * 3; r.attack = 1 + p * 29; r.release = 150; r.knee = 6;
    return r;
}

// CASKET — ceiling->lid, makeup->drive (§5.2), width->msSide off-neutral.
inline CasketState translateCasket(const MasteringSettings& s) {
    CasketState c;
    c.lid = clampd(s.ceilingDbTp, -20, 0);
    c.drive = clampd(std::max(0.0, s.makeupDb), -12, 24);
    c.targetLufs = clampd(s.targetLufs, -30, -5);
    if (std::fabs(s.width - 1.0) > 1e-4) { c.ms = true; c.msSide = clampd(20 * std::log10(std::max(s.width, 1e-3)), -12, 12); }
    return c;
}

// AUTOPSY — shelves + 10-band match, mid tone bells folded into the nearest match bell.
inline AutopsyState translateAutopsy(const MasteringSettings& s) {
    auto freqs = matchFreqs();
    auto nearest = [&](double target) { int bi = 0; double bd = 1e9; for (int i = 0; i < 10; ++i) { double d = std::fabs(std::log(freqs[i]) - std::log(target)); if (d < bd) { bd = d; bi = i; } } return bi; };
    std::vector<double> bell(10, 0.0);
    for (int b = 0; b < 10; ++b) bell[b] = (b < (int)s.matchGains.size() ? s.matchGains[b] : 0.0) * s.matchStrength;
    bell[nearest(400)]  += s.eqLowMid;
    bell[nearest(3000)] += s.eqHighMid;

    AutopsyState a;
    a.bands.push_back({std::fabs(s.eqLow) > 0.01,  "lowshelf",  100,  clampd(s.eqLow, -30, 30),  0.7, "st"});
    a.bands.push_back({std::fabs(s.eqHigh) > 0.01, "highshelf", 8000, clampd(s.eqHigh, -30, 30), 0.7, "st"});
    for (int b = 0; b < 10; ++b) a.bands.push_back({std::fabs(bell[b]) > 0.01, "bell", freqs[b], clampd(bell[b], -30, 30), 2.0, "st"});
    return a;
}

inline ChainPreset toChainPreset(const MasteringSettings& s) {
    ChainPreset p;
    p.targetLufs = s.targetLufs; p.ceilingDbTp = s.ceilingDbTp;
    p.autopsy = translateAutopsy(s); p.rigor = translateRigor(s); p.casket = translateCasket(s);
    return p;
}

} // namespace underworld
