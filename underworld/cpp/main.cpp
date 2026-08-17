// THE UNDERWORLD — C++ CLI: settings (flags) -> underworld.chain preset JSON on stdout.
// Drives the host-path translator; the JS↔C++ parity harness runs this and compares.
//   uw_translate --eq-low 2 --comp 0.4 --width 1.2 --ceiling -1 --lufs -14
//   uw_translate --delivery club --genre disco --describe "warm and wide"
#include "translator.h"
#include "presets.h"
#include "serialize.h"
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <string>

using namespace underworld;

int main(int argc, char** argv) {
  MasteringSettings s;
  std::string delivery, genre, desc;
  auto next = [&](int& i) -> double { return (i + 1 < argc) ? std::atof(argv[++i]) : 0.0; };
  for (int i = 1; i < argc; ++i) {
    std::string a = argv[i];
    if (a == "--eq-low") s.eqLow = next(i);
    else if (a == "--eq-high") s.eqHigh = next(i);
    else if (a == "--eq-low-mid") s.eqLowMid = next(i);
    else if (a == "--eq-high-mid") s.eqHighMid = next(i);
    else if (a == "--comp") s.compAmount = next(i);
    else if (a == "--punch") s.punch = next(i);
    else if (a == "--width") s.width = next(i);
    else if (a == "--makeup") s.makeupDb = next(i);
    else if (a == "--ceiling") s.ceilingDbTp = next(i);
    else if (a == "--lufs") s.targetLufs = next(i);
    else if (a == "--match-strength") s.matchStrength = next(i);
    else if (a == "--dq-amount") s.dqAmount = next(i);
    else if (a == "--side-air") s.sideAir = next(i);
    else if (a == "--mid-body") s.midBody = next(i);
    else if (a == "--delivery") delivery = argv[++i];
    else if (a == "--genre") genre = argv[++i];
    else if (a == "--describe") desc = argv[++i];
  }
  if (!genre.empty()) applyGenre(genre, s);
  if (!desc.empty()) describe(desc, s);
  if (!delivery.empty()) applyDelivery(delivery, s);

  ChainPreset p = toChainPreset(s);
  std::printf("%s\n", toPresetJson(p).c_str());
  return 0;
}
