// THE UNDERWORLD — C++ host-path unit tests (task C15). Compiles standalone (no trilogy),
// prints "N passed, M failed", exits non-zero on any failure so CI can gate on it.
//   c++ -std=c++17 -ffp-contract=off underworld/cpp/test.cpp -o /tmp/uw_test && /tmp/uw_test
#include "translator.h"
#include "presets.h"
#include "serialize.h"
#include "host.h"
#include "calibrate.h"
#include <cstdio>
#include <cmath>
#include <string>

using namespace underworld;
static int pass = 0, fail = 0;
static void ok(const char* n, bool c) { if (c) { ++pass; std::printf("  [PASS] %s\n", n); } else { ++fail; std::printf("  [FAIL] %s\n", n); } }

struct MockCore : ICore {
  int lat; std::string lastState;
  explicit MockCore(int l) : lat(l) {}
  void setState(const std::string& j) override { lastState = j; }
  void process(const double* iL, const double* iR, double* oL, double* oR, int n) override { for (int i = 0; i < n; ++i) { oL[i] = iL[i]; oR[i] = iR[i]; } }
  int latencySamples(int) const override { return lat; }
};

int main() {
  std::printf("THE UNDERWORLD — C++ host-path tests\n");

  // --- translator ---
  { MasteringSettings s; s.eqLow = 2; s.compAmount = 0.4; s.punch = 0.5; s.width = 1.2; s.ceilingDbTp = -1; s.targetLufs = -14;
    ChainPreset p = toChainPreset(s);
    ok("RIGOR thresh = -12 - amt*24", std::fabs(p.rigor.thresh - (-21.6)) < 1e-12);
    ok("RIGOR ratio = 1.5 + amt*3", std::fabs(p.rigor.ratio - 2.7) < 1e-12);
    ok("RIGOR attack = 1 + punch*29", std::fabs(p.rigor.attack - 15.5) < 1e-12);
    ok("CASKET msSide = 20*log10(width)", std::fabs(p.casket.msSide - 20 * std::log10(1.2)) < 1e-12);
    ok("AUTOPSY low shelf on at +2", p.autopsy.bands[0].on && std::fabs(p.autopsy.bands[0].gain - 2) < 1e-12);
    ok("12 bands", p.autopsy.bands.size() == 12); }

  // --- dynamic EQ + M/S ---
  { MasteringSettings s; s.dqAmount = 0.8; s.sideAir = 4; s.midBody = 3;
    ChainPreset p = toChainPreset(s);
    int dyn = 0, side = 0, mid = 0;
    for (auto& b : p.autopsy.bands) { if (b.dyn.on) ++dyn; if (b.place == "s") ++side; if (b.place == "m") ++mid; }
    ok("dqAmount engages dynamic bands", dyn >= 1);
    ok("sideAir -> a side band", side == 1);
    ok("midBody -> a mid band", mid == 1); }

  // --- presets ---
  { MasteringSettings s; ok("delivery club", applyDelivery("club", s) && s.targetLufs == -8 && s.ceilingDbTp == -0.3);
    MasteringSettings g; ok("genre disco", applyGenre("disco", g) && g.targetLufs == -10);
    MasteringSettings d; describe("warm and wide", d); ok("describe warm+wide", d.eqLow > 0 && d.width > 1); }

  // --- serialize ---
  { MasteringSettings s; s.eqLow = 3; ChainPreset p = toChainPreset(s);
    std::string j = toPresetJson(p);
    ok("JSON has the schema tag", j.find("\"format\":\"underworld.chain\"") != std::string::npos);
    ok("JSON has rigor thresh", j.find("\"thresh\":") != std::string::npos); }

  // --- calibration grid exit (LAW 5) ---
  { int calls = 0; auto measure = [&](double d) { ++calls; return -20.0 + d; };   // 1 LU per dB
    CalibrationResult r = calibrateDrive(-14, measure);
    ok("calibration reaches target on the grid", r.reachedTarget && std::fabs(r.drive - 6.0) < 0.11);
    CalibrationResult r2 = calibrateDrive(-14, measure);
    ok("calibration is deterministic", r2.drive == r.drive);
    ok("pass count bounded", r.passes <= 6); }

  // --- chain / host adapter ---
  { MockCore a(0), rg(0), ck(113); Chain c; c.autopsy = &a; c.rigor = &rg; c.casket = &ck;
    ok("chain latency sums the cores", c.latencySamples(48000) == 113);
    MasteringSettings s; s.compAmount = 0.4; c.applyPreset(toChainPreset(s));
    ok("applyPreset feeds each core its slab", !a.lastState.empty() && rg.lastState.find("thresh") != std::string::npos && ck.lastState.find("lid") != std::string::npos);
    double iL[4] = {0.1, 0.2, 0.3, 0.4}, iR[4] = {0.1, 0.2, 0.3, 0.4}, oL[4], oR[4], tL[4], tR[4];
    c.process(iL, iR, oL, oR, 4, tL, tR);
    ok("chain processes through all three", oL[3] == 0.4); }

  std::printf("\n=== %d passed, %d failed ===\n", pass, fail);
  return fail ? 1 : 0;
}
