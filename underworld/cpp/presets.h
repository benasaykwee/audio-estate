// THE UNDERWORLD — C++ delivery/genre/describe (mirrors the JS tables). Host-path convenience.
#pragma once
#include "translator.h"
#include <string>
#include <map>
#include <utility>

namespace underworld {

inline bool applyDelivery(const std::string& name, MasteringSettings& s) {
  static const std::map<std::string, std::pair<double, double>> D = {
    {"spotify", {-14, -1}}, {"apple", {-16, -1}}, {"youtube", {-14, -1}}, {"tidal", {-14, -1}},
    {"amazon", {-14, -2}}, {"soundcloud", {-14, -1}}, {"club", {-8, -0.3}}, {"cd", {-9, -0.3}},
    {"broadcast", {-23, -1}}, {"podcast", {-16, -1}} };
  auto it = D.find(name);
  if (it == D.end()) return false;
  s.targetLufs = it->second.first; s.ceilingDbTp = it->second.second; return true;
}

inline bool applyGenre(const std::string& name, MasteringSettings& s) {
  s.targetLufs = -14; s.ceilingDbTp = -1; s.width = 1;
  if (name == "motown") { s.eqLow = 1.5; s.eqHighMid = 1.5; s.compAmount = 0.4; s.punch = 0.6; s.width = 1.1; s.targetLufs = -12; }
  else if (name == "disco") { s.eqLow = 2; s.eqHigh = 2; s.compAmount = 0.35; s.punch = 0.4; s.width = 1.3; s.targetLufs = -10; }
  else if (name == "lo-fi") { s.eqHigh = -3; s.eqLow = 1; s.compAmount = 0.5; s.punch = 0.2; s.targetLufs = -14; }
  else if (name == "hiphop") { s.eqLow = 3; s.compAmount = 0.3; s.punch = 0.5; s.targetLufs = -9; s.ceilingDbTp = -0.3; }
  else if (name == "jazz") { s.compAmount = 0.15; s.punch = -0.1; s.width = 1.1; s.targetLufs = -16; }
  else if (name == "classical") { s.compAmount = 0.05; s.width = 1.15; s.targetLufs = -18; }
  else if (name == "rock") { s.eqHighMid = 1; s.compAmount = 0.45; s.punch = 0.5; s.targetLufs = -10; }
  else if (name == "edm") { s.eqLow = 2.5; s.eqHigh = 1.5; s.compAmount = 0.4; s.targetLufs = -8; s.ceilingDbTp = -0.3; }
  else if (name == "folk") { s.compAmount = 0.2; s.eqHighMid = 1; s.width = 1.05; s.targetLufs = -15; }
  else if (name == "soul") { s.eqLow = 1.5; s.eqHighMid = 1; s.compAmount = 0.3; s.width = 1.1; s.targetLufs = -13; }
  else return false;
  return true;
}

inline void describe(const std::string& t, MasteringSettings& s) {
  auto has = [&](const char* w) { return t.find(w) != std::string::npos; };
  if (has("warm")) { s.eqLow += 2; s.eqHigh -= 1.5; }
  if (has("bright") || has("air")) s.eqHigh += 3;
  if (has("dark")) s.eqHigh -= 3;
  if (has("punch")) { s.compAmount += 0.25; s.punch += 0.2; }
  if (has("wide")) s.width += 0.3;
  if (has("narrow")) s.width -= 0.3;
  if (has("boomy") || has("bass")) s.eqLow += 3;
  if (has("scoop")) { s.eqLowMid -= 2; s.eqHighMid += 2; }
  if (has("present") || has("clear")) s.eqHighMid += 2;
  // Two clamps, both unconditional. They were on one line, which made the
  // second read as if the first `if` guarded it and earned a
  // -Wmisleading-indentation warning on every translation unit that includes
  // this header. The behaviour was already correct; the shape was the kind
  // that hides a real bug later.
  if (s.compAmount < 0) s.compAmount = 0;
  if (s.compAmount > 1) s.compAmount = 1;
  if (s.width < 0) s.width = 0;
}

} // namespace underworld
