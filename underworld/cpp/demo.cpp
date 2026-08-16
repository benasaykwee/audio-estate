// Compiles the C++ translator skeleton standalone (no trilogy linked) and checks the mapping
// matches the JS. Build:  c++ -std=c++17 -ffp-contract=off underworld/cpp/demo.cpp -o /tmp/uw_cpp && /tmp/uw_cpp
#include "translator.h"
#include <cstdio>
#include <cassert>

int main() {
    using namespace underworld;
    MasteringSettings s;
    s.eqLow = 2; s.eqHigh = -1; s.compAmount = 0.4; s.punch = 0.5; s.width = 1.2;
    s.ceilingDbTp = -1; s.targetLufs = -14;
    ChainPreset p = toChainPreset(s);

    // RIGOR mirrors Masterbox's exact formulas
    assert(std::fabs(p.rigor.thresh - (-12 - 0.4 * 24)) < 1e-9);
    assert(std::fabs(p.rigor.ratio - (1.5 + 0.4 * 3)) < 1e-9);
    assert(std::fabs(p.rigor.attack - (1 + 0.5 * 29)) < 1e-9);
    assert(p.rigor.bands == 3 && p.rigor.xover[0] == 200 && p.rigor.xover[1] == 3000);
    // CASKET
    assert(p.casket.lid == -1 && p.casket.ms && std::fabs(p.casket.msSide - 20 * std::log10(1.2)) < 1e-9);
    // AUTOPSY: low shelf on, gain 2
    assert(p.autopsy.bands[0].on && p.autopsy.bands[0].type == "lowshelf" && std::fabs(p.autopsy.bands[0].gain - 2) < 1e-9);

    std::printf("C++ translator skeleton OK\n");
    std::printf("  RIGOR  thresh=%.2f ratio=%.2f attack=%.2f  (%d bands, xover %.0f/%.0f)\n",
                p.rigor.thresh, p.rigor.ratio, p.rigor.attack, p.rigor.bands, p.rigor.xover[0], p.rigor.xover[1]);
    std::printf("  CASKET lid=%.2f drive=%.2f msSide=%.2f\n", p.casket.lid, p.casket.drive, p.casket.msSide);
    std::printf("  AUTOPSY %zu bands (low shelf %.1f dB)\n", p.autopsy.bands.size(), p.autopsy.bands[0].gain);
    return 0;
}
