// THE UNDERWORLD — host adapter interface (tasks C12, C13, C14).
// The seam for the eventual HOST plugin. The Underworld never links trilogy code (LAW 0); a
// host provides three ICore implementations that wrap the real AUTOPSY/RIGOR/CASKET (setState
// takes that core's slab JSON, process drives its audio, latencySamples reports its delay).
// The Chain drives them in order and owns the ONE reported latency (UNDERWORLD_INTERCHANGE §6).
#pragma once
#include "translator.h"
#include "serialize.h"
#include <string>

namespace underworld {

struct ICore {
  virtual ~ICore() {}
  virtual void setState(const std::string& slabJson) = 0;                                  // -> core.sanitizeState
  virtual void process(const double* inL, const double* inR, double* outL, double* outR, int n) = 0;
  virtual int latencySamples(int fs) const = 0;
};

// Serialize a single slab (the host feeds each to its core's setState).
inline std::string autopsyJson(const ChainPreset& p) { std::string s = "{\"bands\":["; for (size_t i = 0; i < p.autopsy.bands.size(); ++i) { if (i) s += ","; s += bandJson(p.autopsy.bands[i]); } return s + "]}"; }
inline std::string rigorJson(const ChainPreset& p) { char b[256]; std::snprintf(b, sizeof b, "{\"bands\":%d,\"xover\":[%s,%s],\"thresh\":%s,\"ratio\":%s,\"attack\":%s,\"release\":%s,\"knee\":%s}", p.rigor.bands, num(p.rigor.xover[0]).c_str(), num(p.rigor.xover[1]).c_str(), num(p.rigor.thresh).c_str(), num(p.rigor.ratio).c_str(), num(p.rigor.attack).c_str(), num(p.rigor.release).c_str(), num(p.rigor.knee).c_str()); return b; }
inline std::string casketJson(const ChainPreset& p) { std::string s = "{\"lid\":" + num(p.casket.lid) + ",\"drive\":" + num(p.casket.drive) + ",\"targetLufs\":" + num(p.casket.targetLufs) + ",\"ms\":" + (p.casket.ms ? "true" : "false") + ",\"msSide\":" + num(p.casket.msSide) + "}"; return s; }

struct Chain {
  ICore* autopsy = nullptr; ICore* rigor = nullptr; ICore* casket = nullptr;

  int latencySamples(int fs) const {                                     // §6: sum once
    int lat = 0;
    if (autopsy) lat += autopsy->latencySamples(fs);
    if (rigor) lat += rigor->latencySamples(fs);
    if (casket) lat += casket->latencySamples(fs);
    return lat;
  }

  // Push the preset's slabs into the three cores. The host then processes audio through them
  // in order (autopsy -> rigor -> casket) and compensates the summed latency once.
  void applyPreset(const ChainPreset& p) const {
    if (autopsy) autopsy->setState(autopsyJson(p));
    if (rigor) rigor->setState(rigorJson(p));
    if (casket) casket->setState(casketJson(p));
  }
  void process(const double* inL, const double* inR, double* outL, double* outR, int n,
               double* tmpL, double* tmpR) const {
    autopsy->process(inL, inR, tmpL, tmpR, n);
    rigor->process(tmpL, tmpR, outL, outR, n);
    casket->process(outL, outR, outL, outR, n);
  }
};

} // namespace underworld
