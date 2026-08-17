// THE UNDERWORLD — C++ preset serialization to the UNDERWORLD_INTERCHANGE §2 schema.
// A minimal JSON writer (no dependency) so the host path emits exactly the `underworld.chain`
// document the JS side does. Numbers use %.10g so the JS↔C++ parity harness can compare values.
#pragma once
#include "translator.h"
#include <string>
#include <sstream>
#include <cstdio>

namespace underworld {

inline std::string num(double v) {
  char buf[64];
  std::snprintf(buf, sizeof(buf), "%.17g", v);   // full double round-trip for value parity
  return std::string(buf);
}
inline std::string jstr(const std::string& s) { return "\"" + s + "\""; }

inline std::string bandJson(const EqBand& b) {
  std::ostringstream o;
  o << "{\"on\":" << (b.on ? "true" : "false")
    << ",\"type\":" << jstr(b.type)
    << ",\"freq\":" << num(b.freq)
    << ",\"gain\":" << num(b.gain)
    << ",\"q\":" << num(b.q)
    << ",\"place\":" << jstr(b.place) << "}";
  return o.str();
}

inline std::string toPresetJson(const ChainPreset& p, const std::string& generatedBy = "masterbox/cpp", double fs = 48000) {
  std::ostringstream o;
  o << "{";
  o << "\"format\":\"underworld.chain\",\"version\":1";
  o << ",\"generatedBy\":" << jstr(generatedBy);
  o << ",\"fs\":" << num(fs);
  o << ",\"target\":{\"lufs\":" << num(p.targetLufs) << ",\"ceilingDbTp\":" << num(p.ceilingDbTp) << "}";
  o << ",\"autopsy\":{\"bands\":[";
  for (size_t i = 0; i < p.autopsy.bands.size(); ++i) { if (i) o << ","; o << bandJson(p.autopsy.bands[i]); }
  o << "]}";
  o << ",\"rigor\":{\"bands\":" << p.rigor.bands
    << ",\"xover\":[" << num(p.rigor.xover[0]) << "," << num(p.rigor.xover[1]) << "]"
    << ",\"thresh\":" << num(p.rigor.thresh)
    << ",\"ratio\":" << num(p.rigor.ratio)
    << ",\"attack\":" << num(p.rigor.attack)
    << ",\"release\":" << num(p.rigor.release)
    << ",\"knee\":" << num(p.rigor.knee) << "}";
  o << ",\"casket\":{\"lid\":" << num(p.casket.lid)
    << ",\"drive\":" << num(p.casket.drive)
    << ",\"targetLufs\":" << num(p.casket.targetLufs)
    << ",\"ms\":" << (p.casket.ms ? "true" : "false")
    << ",\"msSide\":" << num(p.casket.msSide) << "}";
  o << "}";
  return o.str();
}

} // namespace underworld
