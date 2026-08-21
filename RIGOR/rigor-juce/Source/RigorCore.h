/* ============================================================
   RIGOR — RigorCore.h
   C++ parity port of rigor_core.js (the single source of truth).
   RULE: this file follows the JS core, never leads it. Any change lands
   in rigor_core.js first, then is mirrored here and proven by
   tests/core_parity.cpp.
   Doubles everywhere. Order of operations matches the JS exactly.
   INTERCHANGE law 1: compile with -ffp-contract=off.
   INTERCHANGE law 2: every transcendental goes through nm::.
   ============================================================ */
#pragma once
#include <cmath>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>
#include <memory>
#include "../../../shared/necromath.h"
#include "../../../shared/necrodyn.h"

namespace rigor {

static const char* VERSION = "0.5";
static const int CTRL = 32;
static const double SMOOTH = 0.25;
static const double SNAP = 1e-9;
static const double MAX_LOOK_MS = 20.0;
static const double PEAK_DECAY_MS = 15.0;
static const double RATIO_INF = 1000.0;
static const int MAX_BANDS = 3;
static const double DNF = 1e-30;
static const int TP_OS = 4;
static const int TP_TAPS = 8;
/* the legal detector phase counts. Declared up here with the constants
   rather than beside tpTaps() because sanitizeState() needs it and sits
   several hundred lines earlier. */
static const int DET_OS_MAX = 8;
inline bool detOsLegal(int x) { return x == 2 || x == 4 || x == 8; }

/* Denormal flush — mirrors dn() in the JS. This CHANGES the arithmetic,
   so it is part of the contract, not an optimisation the port may skip. */
inline double dn(double v) { return (v < DNF && v > -DNF) ? 0.0 : v; }

enum Style { FRESH = 0, SETTLING, SPASM, REPOSE, NUM_STYLES };
static const char* STYLE_NAMES[NUM_STYLES] = { "fresh", "settling", "spasm", "repose" };
enum Detect { D_AUTO = 0, D_PEAK, D_RMS, NUM_DETECTS };
enum Place { P_LR = 0, P_MS, NUM_PLACES };

struct StyleCfg {
    int fb;              /* topo: 0 = feedforward, 1 = feedback  */
    int detectRms;       /* the style's own detector             */
    double rmsMs;
    double pkMs;         /* peak-follower decay — a PATH property */
    int smoothLevel;     /* envelope BEFORE the gain computer    */
    int levelAttack;     /* attack recomputed from the overshoot */
    double knee, attack, release; int autoRel; double ratio;
};
/* mirrors STYLE in the JS, in STYLES order */
static const StyleCfg STYLE_CFG[NUM_STYLES] = {
    { 0, 0,  0.0, 15.0, 0, 0,  6.0, 10.0,  200.0, 0, 4.0 },
    { 1, 1, 10.0, 15.0, 1, 1,  9.0, 25.0,  300.0, 1, 3.0 },
    { 0, 0,  0.0,  2.0, 0, 0,  0.0,  0.5,   80.0, 1, 6.0 },
    { 0, 1, 50.0, 15.0, 0, 0, 18.0, 30.0,  400.0, 1, 2.0 }
};
inline const StyleCfg& styleCfg(int s) {
    return STYLE_CFG[(s >= 0 && s < NUM_STYLES) ? s : FRESH];
}

inline double invRatio(double r) { return r >= RATIO_INF ? 0.0 : 1.0 / r; }

/* Note divisions for tempo-synced release. Index 0 is "off, use ms".
   The tempo lives in the STATE, never fetched inside the DSP, so a synced
   release stays a pure function of the case file — which is what keeps
   byte-stable regression possible. */
static const int NUM_SYNC = 11;
static const double SYNC_DIV[NUM_SYNC] = {
    0, 1.0/32, 1.0/16, 1.0/8, 3.0/16, 1.0/4, 3.0/8, 1.0/2, 3.0/4, 1.0, 2.0
};

/* ---------- state ---------- */
struct BandCfg { double threshOff, gain; bool mute, solo; };
struct State {
    bool bypass;
    /* bypassSplit — what "bypass" means when a crossover exists.
       false (default): bypass is DRY, the audio never enters the
         splitter, bit-transparent at every band count.
       true: bypass is CROSSOVER-ONLY, split and re-summed but
         uncompressed — flat to 0.06 dB, NOT bit-transparent, because
         an LR4 pair is magnitude-flat and not linear-phase.
       Inert at bands == 1, where there is no crossover to route
       through. See the JS core for the full reasoning. */
    bool bypassSplit;
    int style;
    double inGain, thresh, ratio, knee, attack, release;
    bool autoRel;
    double hold, holdTaper, range, look;
    int detect;
    bool scOn; double scHp, scLp; bool scListen;
    double link, mix, makeup;
    bool autoMakeup;
    int place;
    bool delta;
    int deltaBand;      /* 0 = whole removal, 1..3 = only that band's */
    int scBand;         /* 0 = off, else the band driving every detector */
    double tsSplit;     /* 0..100 transient/sustain blend */
    double curve;
    bool detOs;
    int detOsX;
    int relSync;
    double bpm;
    int bands;
    double xover[2];
    BandCfg band[MAX_BANDS];
    std::string name, note;
};

inline State defaultState() {
    State s;
    const StyleCfg& d = STYLE_CFG[FRESH];
    s.bypass = false; s.bypassSplit = false; s.style = FRESH; s.inGain = 0.0; s.thresh = -18.0;
    s.ratio = d.ratio; s.knee = d.knee; s.attack = d.attack;
    s.release = d.release; s.autoRel = d.autoRel != 0;
    s.hold = 0.0; s.holdTaper = 0.0; s.range = 60.0; s.look = 0.0; s.detect = D_AUTO;
    s.scOn = false; s.scHp = 100.0; s.scLp = 12000.0; s.scListen = false;
    s.link = 100.0; s.mix = 100.0; s.makeup = 0.0; s.autoMakeup = false;
    s.place = P_LR; s.delta = false; s.curve = 0.0;
    s.deltaBand = 0; s.scBand = 0; s.tsSplit = 0.0;
    s.detOs = false; s.detOsX = 4; s.relSync = 0; s.bpm = 120.0;
    s.bands = 1; s.xover[0] = 200.0; s.xover[1] = 2000.0;
    for (int i = 0; i < MAX_BANDS; i++) { s.band[i] = BandCfg{ 0.0, 0.0, false, false }; }
    s.name = "Fresh Case"; s.note = "";
    return s;
}

inline State sanitizeState(const State& in) {
    State o = defaultState();
    o.bypass = in.bypass;
    o.bypassSplit = in.bypassSplit;
    o.style = (in.style >= 0 && in.style < NUM_STYLES) ? in.style : FRESH;
    o.inGain = nd::clamp(in.inGain, -24.0, 24.0);
    o.thresh = nd::clamp(in.thresh, -60.0, 0.0);
    o.ratio = nd::clamp(in.ratio, 1.0, RATIO_INF);
    o.knee = nd::clamp(in.knee, 0.0, 30.0);
    o.attack = nd::clamp(in.attack, 0.02, 500.0);
    o.release = nd::clamp(in.release, 1.0, 2500.0);
    o.hold = nd::clamp(in.hold, 0.0, 500.0);
    o.holdTaper = nd::clamp(in.holdTaper, 0.0, 100.0);
    o.range = nd::clamp(in.range, 0.0, 60.0);
    o.look = nd::clamp(in.look, 0.0, MAX_LOOK_MS);
    o.scHp = nd::clamp(in.scHp, 10.0, 1000.0);
    o.scLp = nd::clamp(in.scLp, 1000.0, 20000.0);
    o.link = nd::clamp(in.link, 0.0, 100.0);
    o.mix = nd::clamp(in.mix, 0.0, 100.0);
    o.makeup = nd::clamp(in.makeup, -24.0, 24.0);
    o.autoRel = in.autoRel; o.scOn = in.scOn; o.scListen = in.scListen;
    o.autoMakeup = in.autoMakeup;
    o.detect = (in.detect >= 0 && in.detect < NUM_DETECTS) ? in.detect : D_AUTO;
    o.place = (in.place >= 0 && in.place < NUM_PLACES) ? in.place : P_LR;
    o.delta = in.delta;
    o.deltaBand = (int)nd::clamp(std::floor(in.deltaBand + 0.5), 0.0, (double)MAX_BANDS);
    o.scBand = (int)nd::clamp(std::floor(in.scBand + 0.5), 0.0, (double)MAX_BANDS);
    o.tsSplit = nd::clamp(in.tsSplit, 0.0, 100.0);
    o.curve = nd::clamp(in.curve, 0.0, 100.0);
    o.detOs = in.detOs;
    /* set membership, not a clamp — mirrors the JS. 3 is not a cheaper 4. */
    o.detOsX = detOsLegal(in.detOsX) ? in.detOsX : 4;
    o.relSync = (int)nd::clamp(std::floor(in.relSync + 0.5), 0.0, (double)(NUM_SYNC - 1));
    o.bpm = nd::clamp(in.bpm, 20.0, 300.0);
    o.bands = (int)nd::clamp(std::floor(in.bands + 0.5), 1.0, (double)MAX_BANDS);
    o.xover[0] = nd::clamp(in.xover[0], 20.0, 20000.0);
    o.xover[1] = nd::clamp(in.xover[1], 20.0, 20000.0);
    /* Push the LOWER one down first — raising the upper one and clamping
       it back leaves both pinned at 20 kHz with no separation, and the
       splitter then designs a section at 23,760 Hz. Found by the fuzzer. */
    if (o.xover[0] > 20000.0 / 1.1) o.xover[0] = 20000.0 / 1.1;
    if (o.xover[1] < o.xover[0] * 1.1) o.xover[1] = o.xover[0] * 1.1;
    if (o.xover[1] > 20000.0) o.xover[1] = 20000.0;
    for (int i = 0; i < MAX_BANDS; i++) {
        o.band[i].threshOff = nd::clamp(in.band[i].threshOff, -24.0, 24.0);
        o.band[i].gain = nd::clamp(in.band[i].gain, -24.0, 24.0);
        o.band[i].mute = in.band[i].mute;
        o.band[i].solo = in.band[i].solo;
    }
    o.name = in.name; o.note = in.note;
    return o;
}

/* release time in ms, resolving the sync setting */
inline double releaseMs(const State& st) {
    if (!st.relSync) return st.release;
    double beats = SYNC_DIV[st.relSync] * 4;      /* divisions are of a bar */
    return nd::clamp(beats * 60000.0 / st.bpm, 1.0, 2500.0);
}

/* ---------- derived, pure ---------- */
/* JS: Math.floor(x + 0.5) on a non-negative value */
inline int lookSamples(const State& st, double fs) {
    return (int)std::floor(nd::clamp(st.look, 0.0, MAX_LOOK_MS) * 0.001 * fs + 0.5);
}
inline int latencySamples(const State& s, double fs) { return lookSamples(sanitizeState(s), fs); }

inline double autoMakeupDb(const State& s) {
    State st = sanitizeState(s);
    return -nd::kneeGain(0.0, st.thresh, st.knee, invRatio(st.ratio));
}
inline double makeupDb(const State& s) {
    State st = sanitizeState(s);
    return st.autoMakeup ? autoMakeupDb(st) : st.makeup;
}
/* Analytic makeup for one band: the gain computer at 0 dBFS for THAT
   band's effective threshold, negated. Pure, so it cannot make the output
   depend on playback history. */
inline double bandMakeupDb(const State& s, int k) {
    State st = sanitizeState(s);
    double t = nd::clamp(st.thresh + st.band[k].threshOff, -60.0, 0.0);
    return -nd::kneeGain(0.0, t, st.knee, invRatio(st.ratio));
}

inline double transferAt(const State& s, double inDb) {
    State st = sanitizeState(s);
    double x = inDb + st.inGain;
    double gr = nd::kneeGain(x, st.thresh, st.knee, invRatio(st.ratio));
    if (gr < -st.range) gr = -st.range;
    double m = st.mix / 100.0;
    double lin = nd::dbToLin(gr);
    double blended = (1.0 - m) + lin * m;
    return x + nd::linToDb(blended) + makeupDb(st);
}

/* ---------- auto threshold ----------
   From the level DISTRIBUTION, not the peak, so one stray transient does
   not decide the answer. Pure: same material, same number. */
inline double suggestThreshold(const double* samples, int n, double ratio, double targetGr) {
    if (n <= 0) return -20.0;
    double iR = invRatio(nd::clamp(ratio, 1.0, RATIO_INF));
    if (iR >= 1.0) return 0.0;
    const int BINS = 200;
    std::vector<double> hist((size_t)BINS, 0.0);
    int counted = 0;
    for (int i = 0; i < n; i++) {
        double a = samples[i] < 0 ? -samples[i] : samples[i];
        if (a < 1e-6) continue;
        double db = 20.0 * nm::log10_(a);
        if (db < -80.0) continue;
        int b = (int)std::floor((db + 80.0) / 80.0 * BINS);
        if (b < 0) b = 0;
        if (b >= BINS) b = BINS - 1;
        hist[(size_t)b] += 1.0; counted++;
    }
    if (!counted) return -20.0;
    /* Interpolate within the bin rather than taking its centre — 200 bins
       across 80 dB is 0.4 dB wide, and the centre carried up to 0.2 dB of
       bias straight into the threshold. That bias is what the interchange
       log recorded as a "systematic and monotone in ratio" error; it was
       one quantisation error scaled by (1 - invR). See the JS core. */
    double want = counted * 0.9, acc = 0, p90 = -20.0;
    for (int i = 0; i < BINS; i++) {
        double before = acc;
        acc += hist[(size_t)i];
        if (acc >= want) {
            double frac = hist[(size_t)i] > 0 ? (want - before) / hist[(size_t)i] : 0.5;
            p90 = -80.0 + ((double)i + frac) / BINS * 80.0;
            break;
        }
    }
    double g = targetGr < 0 ? targetGr : -targetGr;
    return nd::clamp(p90 + g / (1.0 - iR), -60.0, 0.0);
}

/* ---------- metering ---------- */
/* Sized for the LARGEST legal phase count; `n` says how many rows are live.
   Fixed extent on purpose — the audio path may not allocate. */
struct TpTaps { int n; double t[DET_OS_MAX][TP_TAPS]; };
/* TP_TAPS = 8 is EMPIRICAL and load-bearing; see the JS core's note, which
   was REWRITTEN in round 8 because the old reason for the pin was measuring
   edge Gibbs rather than the filter.
   Built here rather than table-pasted so the twin DERIVES the values. */
inline TpTaps tpTaps(int os = TP_OS) {
    TpTaps out;
    out.n = os;
    double half = TP_TAPS / 2.0;
    for (int p = 0; p < os; p++) {
        double frac = (double)p / os, sum = 0;
        for (int i = 0; i < TP_TAPS; i++) {
            double x = ((double)i - (half - 1.0)) - frac;
            double s = (x == 0.0) ? 1.0 : nm::sin_(M_PI * x) / (M_PI * x);
            double u = (x + half) / (2.0 * half);
            double w = 0.42 - 0.5 * nm::cos_(2 * M_PI * u) + 0.08 * nm::cos_(4 * M_PI * u);
            if (w < 0) w = 0;
            out.t[p][i] = s * w;
            sum += s * w;
        }
        for (int i = 0; i < TP_TAPS; i++) out.t[p][i] = out.t[p][i] / sum;
    }
    return out;
}
inline double tan_(double x) { return nm::sin_(x) / nm::cos_(x); }
inline nd::BqCoef kweightHigh(double fs) {
    double f0 = 1681.9744509555319, G = 3.9998438531093142, Q = 0.70717523608148132;
    double K = tan_(M_PI * f0 / fs);
    double Vh = nm::pow10_(G / 20.0);
    double Vb = nm::exp_(nm::log_(Vh) * 0.49966775916574335);
    double a0 = 1 + K / Q + K * K;
    nd::BqCoef c;
    c.b0 = (Vh + Vb * K / Q + K * K) / a0;
    c.b1 = 2 * (K * K - Vh) / a0;
    c.b2 = (Vh - Vb * K / Q + K * K) / a0;
    c.a1 = 2 * (K * K - 1) / a0;
    c.a2 = (1 - K / Q + K * K) / a0;
    return c;
}
inline nd::BqCoef kweightLow(double fs) {
    double f0 = 38.135470876002885, Q = 0.50032703732504273;
    double K = tan_(M_PI * f0 / fs);
    double d = 1 + K / Q + K * K;
    nd::BqCoef c;
    c.b0 = 1; c.b1 = -2; c.b2 = 1;
    c.a1 = 2 * (K * K - 1) / d;
    c.a2 = (1 - K / Q + K * K) / d;
    return c;
}
inline double lkfs(double msL, double msR) {
    double z = msL + msR;
    return z <= 0 ? -200.0 : -0.691 + 10.0 * nm::log10_(z);
}

struct Meters {
    double gr = 0, grPeak = 0; int latency = 0;
    double makeup = 0, thresh = 0;
    double tpL = 0, tpR = 0, lufsM = -200, lufsS = -200, lufsI = -200, corr = 1;
    double bandGr[MAX_BANDS] = { 0, 0, 0 };
};

class Meter {
public:
    void init(double sampleRate) {
        fs = sampleRate;
        TAPS = tpTaps();
        kwHi = kweightHigh(fs); kwLo = kweightLow(fs);
        subN = (int)std::floor(fs * 0.1 + 0.5);
        corrC = nd::onePole(100.0, fs);
        reset();
    }
    void reset() {
        for (int i = 0; i < TP_TAPS; i++) { tpzL[i] = 0; tpzR[i] = 0; }
        tpw = 0;
        k1L.clear(); k2L.clear(); k1R.clear(); k2R.clear();
        subI = 0; subL = 0; subR = 0;
        ringM.clear(); ringS.clear(); blocks.clear();
        cLR = cLL = cRR = 0; blkTL = blkTR = 0;
        tpL = tpR = 0; lufsM = lufsS = lufsI = -200; corr = 1;
    }
    void push(double l, double r) {
        double tL = truePeak(tpzL, l), tR = truePeak(tpzR, r);
        tpw = tpw + 1 == TP_TAPS ? 0 : tpw + 1;
        if (tL > blkTL) blkTL = tL;
        if (tR > blkTR) blkTR = tR;
        cLR = corrC * cLR + (1 - corrC) * (l * r);
        cLL = corrC * cLL + (1 - corrC) * (l * l);
        cRR = corrC * cRR + (1 - corrC) * (r * r);
        double a = k2L.tick(kwLo, k1L.tick(kwHi, l));
        double b = k2R.tick(kwLo, k1R.tick(kwHi, r));
        subL += a * a; subR += b * b;
        if (++subI < subN) return;
        ringM.push_back(subL / subN); ringS.push_back(subR / subN);
        subI = 0; subL = 0; subR = 0;
        if ((int)ringM.size() > 30) { ringM.erase(ringM.begin()); ringS.erase(ringS.begin()); }
        lufsM = lkfs(meanTail(ringM, 4), meanTail(ringS, 4));
        lufsS = lkfs(meanTail(ringM, 30), meanTail(ringS, 30));
        if ((int)ringM.size() >= 4 && (int)blocks.size() < 36000) {
            double bm = meanTail(ringM, 4), bs = meanTail(ringS, 4);
            double bl = lkfs(bm, bs);
            if (bl > -70.0) { blocks.push_back(bl); blockZ.push_back(bm + bs); }
        }
        if (!blocks.empty()) {
            double sum = 0;
            for (size_t i = 0; i < blockZ.size(); i++) sum += blockZ[i];
            double relGate = -0.691 + 10.0 * nm::log10_(sum / (double)blockZ.size()) - 10.0;
            double s2 = 0; int c2 = 0;
            for (size_t i = 0; i < blocks.size(); i++)
                if (blocks[i] > relGate) { s2 += blockZ[i]; c2++; }
            lufsI = c2 ? -0.691 + 10.0 * nm::log10_(s2 / (double)c2) : -200.0;
        }
    }
    void latch() {
        tpL = blkTL; tpR = blkTR; blkTL = 0; blkTR = 0;
        double den = std::sqrt(cLL * cRR);
        corr = den > 1e-20 ? nd::clamp(cLR / den, -1.0, 1.0) : 1.0;
    }
    double tpL = 0, tpR = 0, lufsM = -200, lufsS = -200, lufsI = -200, corr = 1;
private:
    double truePeak(double* z, double x) {
        z[tpw] = x;
        double best = x < 0 ? -x : x;
        for (int p = 0; p < TP_OS; p++) {
            double acc = 0; int idx = tpw;
            for (int k = 0; k < TP_TAPS; k++) {
                acc += TAPS.t[p][k] * z[idx];
                idx = idx == 0 ? TP_TAPS - 1 : idx - 1;
            }
            double a = acc < 0 ? -acc : acc;
            if (a > best) best = a;
        }
        return best;
    }
    static double meanTail(const std::vector<double>& a, int k) {
        int n2 = (int)a.size() < k ? (int)a.size() : k;
        double s = 0;
        for (int i = (int)a.size() - n2; i < (int)a.size(); i++) s += a[(size_t)i];
        return n2 ? s / n2 : 0.0;
    }
    double fs = 48000;
    TpTaps TAPS{};
    double tpzL[TP_TAPS] = { 0 }, tpzR[TP_TAPS] = { 0 };
    int tpw = 0;
    nd::BqCoef kwHi{}, kwLo{};
    nd::Biquad k1L, k2L, k1R, k2R;
    int subN = 4800, subI = 0;
    double subL = 0, subR = 0;
    std::vector<double> ringM, ringS, blocks, blockZ;
    double corrC = 0, cLR = 0, cLL = 0, cRR = 0, blkTL = 0, blkTR = 0;
};

/* ---------- deterministic radix-2 FFT + spectrum ----------
   Twiddles through nm:: so the twin lands on the same bits. Mirrors the
   JS operation for operation, including the bit-reversal loop. */
inline void fft(double* re, double* im, int n) {
    int i, j = 0, k, m;
    double t;
    for (i = 1; i < n; i++) {
        int bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }
    for (m = 2; m <= n; m <<= 1) {
        double ang = -2 * M_PI / m;
        double wr = nm::cos_(ang), wi = nm::sin_(ang);
        for (i = 0; i < n; i += m) {
            double cr = 1, ci = 0;
            int hlf = m >> 1;
            for (k = 0; k < hlf; k++) {
                double ur = re[i + k], ui = im[i + k];
                double vr = re[i + k + hlf] * cr - im[i + k + hlf] * ci;
                double vi = re[i + k + hlf] * ci + im[i + k + hlf] * cr;
                re[i + k] = ur + vr; im[i + k] = ui + vi;
                re[i + k + hlf] = ur - vr; im[i + k + hlf] = ui - vi;
                double nr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr; cr = nr;
            }
        }
    }
}
inline void spectrum(const double* sig, int sigLen, double* out, int outLen) {
    int n = outLen * 2, i;
    std::vector<double> re((size_t)n, 0.0), im((size_t)n, 0.0);
    int take = sigLen < n ? sigLen : n;
    for (i = 0; i < take; i++) {
        double w = 0.5 - 0.5 * nm::cos_(2 * M_PI * i / (n - 1));
        re[(size_t)i] = sig[sigLen - take + i] * w;
    }
    fft(re.data(), im.data(), n);
    for (i = 0; i < outLen; i++) {
        double mag = std::sqrt(re[(size_t)i] * re[(size_t)i] + im[(size_t)i] * im[(size_t)i]) * 2 / n;
        out[i] = nd::linToDb(mag);
    }
}

/* ---------- Linkwitz-Riley splitter ---------- */
class Splitter {
public:
    void init(double sampleRate) { fs = sampleRate; design(); clear(); }
    void set(double n, double a, double b) {
        int nn = (int)nd::clamp(std::floor(n + 0.5), 1.0, (double)MAX_BANDS);
        /* Clamp, separate, then clamp AGAIN — the separation rule can push
           the upper crossover back over the Nyquist guard, and a section
           designed above it is not a filter, it is noise. */
        double na = nd::clamp(a, 20.0, fs * 0.45), nb = nd::clamp(b, 20.0, fs * 0.45);
        if (na > fs * 0.45 / 1.1) na = fs * 0.45 / 1.1;
        if (nb < na * 1.1) nb = na * 1.1;
        nb = nd::clamp(nb, 20.0, fs * 0.45);
        if (nn != nB || na != f1 || nb != f2) { nB = nn; f1 = na; f2 = nb; design(); clear(); }
    }
    void clear() {
        for (int i = 0; i < 2; i++)
            for (int k = 0; k < 2; k++) {
                lo1[i][k].clear(); hi1[i][k].clear(); lo2[i][k].clear();
                hi2[i][k].clear(); apL[i][k].clear(); apH[i][k].clear();
            }
    }
    int count() const { return nB; }
    void split(double xL, double xR, double* out) {
        if (nB == 1) { out[0] = xL; out[1] = xR; return; }
        double aL = two(lp1, lo1[0], xL), aR = two(lp1, lo1[1], xR);
        double bL = two(hp1, hi1[0], xL), bR = two(hp1, hi1[1], xR);
        if (nB == 2) { out[0] = aL; out[1] = aR; out[2] = bL; out[3] = bR; return; }
        out[0] = two(lp2, apL[0], aL) + two(hp2, apH[0], aL);
        out[1] = two(lp2, apL[1], aR) + two(hp2, apH[1], aR);
        out[2] = two(lp2, lo2[0], bL); out[3] = two(lp2, lo2[1], bR);
        out[4] = two(hp2, hi2[0], bL); out[5] = two(hp2, hi2[1], bR);
    }
private:
    /* RIGOR's own guarded biquad rather than nd::Biquad.
       A three-band split leaves SIX filter chains per channel ringing
       after every decay, and an unguarded IIR settles into denormals
       rather than zero — measured at ~1e-314, inaudible and worth 50-100x
       CPU for as long as the track is silent. nd::Biquad is CASKET's and
       is not guarded; this is a RIGOR-local need, so RIGOR carries the
       guard rather than changing shared code. Mirrors the JS gbq(). */
    struct GBq {
        double z1 = 0, z2 = 0;
        double tick(const nd::BqCoef& c, double x) {
            double y = c.b0 * x + z1;
            z1 = dn(c.b1 * x - c.a1 * y + z2);
            z2 = dn(c.b2 * x - c.a2 * y);
            return y;
        }
        void clear() { z1 = 0; z2 = 0; }
    };
    static double two(const nd::BqCoef& c, GBq* q, double x) {
        return q[1].tick(c, q[0].tick(c, x));
    }
    void design() {
        double ny = fs * 0.45;
        lp1 = nd::secSosLP(nd::clamp(f1, 20.0, ny), M_SQRT1_2, fs);
        hp1 = nd::secSosHP(nd::clamp(f1, 20.0, ny), M_SQRT1_2, fs);
        lp2 = nd::secSosLP(nd::clamp(f2, 20.0, ny), M_SQRT1_2, fs);
        hp2 = nd::secSosHP(nd::clamp(f2, 20.0, ny), M_SQRT1_2, fs);
    }
    double fs = 48000, f1 = 200, f2 = 2000;
    int nB = 1;
    nd::BqCoef lp1{}, hp1{}, lp2{}, hp2{};
    GBq lo1[2][2], hi1[2][2], lo2[2][2], hi2[2][2], apL[2][2], apH[2][2];
};

/* ---------- the engine ---------- */
class Engine {
public:
    explicit Engine(double sampleRate) : fs(sampleRate) {
        st = defaultState();
        dTAPS = tpTaps();
        meter.init(fs);
        scRing.assign(4096, 0.0);
        outRing.assign(4096, 0.0);
        applyTargets(); rebuild(); snapAll(); control();
    }

    void setState(const State& s) {
        State prev = st;
        st = sanitizeState(s);
        bool structural = first || st.style != prev.style ||
            st.look != prev.look || st.detect != prev.detect || st.place != prev.place ||
            st.detOs != prev.detOs || st.detOsX != prev.detOsX;
        applyTargets();
        if (structural) rebuild();
        if (first) { snapAll(); first = false; }
        control();
    }
    void reset() { rebuild(); grNow = 0; grPeak = 0; snapAll(); control(); }
    int latency() const { return lookN; }
    double gr() const { return grNow; }

    Meters meters() const {
        Meters m;
        m.gr = grNow; m.grPeak = grPeak; m.latency = lookN;
        m.makeup = pMk.c; m.thresh = Tdb;
        m.tpL = meter.tpL; m.tpR = meter.tpR;
        m.lufsM = meter.lufsM; m.lufsS = meter.lufsS; m.lufsI = meter.lufsI;
        m.corr = meter.corr;
        return m;
    }
    /* most recent OUTPUT samples, oldest first — same contract as scTap */
    int outTap(double* out, int n) const {
        int k = n < 4096 ? n : 4096;
        for (int i = 0; i < k; i++) out[i] = outRing[(size_t)((outw - k + i + 4096) & 4095)];
        return k;
    }
    int scTap(double* out, int n) const {
        int k = n < 4096 ? n : 4096;
        for (int i = 0; i < k; i++) out[i] = scRing[(size_t)((scw - k + i + 4096) & 4095)];
        return k;
    }

    /* scL/scR are OPTIONAL — when present they replace the detector source
       entirely. Mirrors the JS. */
    void process(const double* inL, const double* inR, double* outL, double* outR, int n,
                 const double* scL = nullptr, const double* scR = nullptr) {
        int pos = 0;
        bool useExt = (scL != nullptr && scR != nullptr);
        while (pos < n) {
            control();
            int end = pos + CTRL; if (end > n) end = n;
            for (int s = pos; s < end; s++) {
                /* THE INPUT GUARD — mirrors the JS exactly.
                   A non-finite sample locked the audio thread: it reaches
                   the peak follower, then nd::linToDb, then nm::log10,
                   which iterates and never converges. linToDb guards the
                   low end (0, negative, denormal -> -600 dB); nothing
                   guarded the high end. Non-finite becomes silence — there
                   is no honest magnitude to assign to NaN. */
                double xl = inL[s], xr = inR[s];
                if (!std::isfinite(xl)) xl = 0.0;
                if (!std::isfinite(xr)) xr = 0.0;
                /* BYPASS RUNS THROUGH THE DELAY LINE — mirrors the JS.
                   This used to write the input straight out, which was
                   wrong twice: latency() reports the lookahead in every
                   state and bypass is a state (measured 480 samples of
                   promise against an impulse that came out at 0), and the
                   line went unfed while bypassed, so leaving bypass
                   dropped `look` milliseconds of silence into the track.
                   At look == 0 this is identical to the old line. */
                if (st.bypass) {
                    outL[s] = lookN > 0 ? delL.push(xl) : xl;
                    outR[s] = lookN > 0 ? delR.push(xr) : xr;
                    outRing[(size_t)outw] = outL[s]; outw = (outw + 1) & 4095;
                    grNow = 0; continue;
                }
                if (inLin != 1) { xl *= inLin; xr *= inLin; }

                if (msPlace) {
                    double mm = (xl + xr) * 0.5, ss = (xl - xr) * 0.5;
                    xl = mm; xr = ss;
                }

                double dl = lookN > 0 ? delL.push(xl) : xl;
                double dr = lookN > 0 ? delR.push(xr) : xr;

                double sl, sr;
                if (useExt) {
                    sl = scL[s]; sr = scR[s];
                    if (!std::isfinite(sl)) sl = 0.0;
                    if (!std::isfinite(sr)) sr = 0.0;
                }
                else { sl = fbTopo ? xl * fbL : xl; sr = fbTopo ? xr * fbR : xr; }

                if (scOn) {
                    sl = lpL.tick(scLpC, hpL.tick(scHpC, sl));
                    sr = lpR.tick(scLpC, hpR.tick(scHpC, sr));
                }
                scRing[(size_t)scw] = sl; scw = (scw + 1) & 4095;

                double al, ar;
                if (useRms) {
                    msL = msC * msL + (1 - msC) * (sl * sl);
                    msR = msC * msR + (1 - msC) * (sr * sr);
                    al = std::sqrt(msL); ar = std::sqrt(msR);
                } else {
                    double apl, apr;
                    if (detOs) {
                        apl = ipeak(dzL, sl); apr = ipeak(dzR, sr);
                        dzw = dzw + 1 == TP_TAPS ? 0 : dzw + 1;
                    } else {
                        apl = sl < 0 ? -sl : sl; apr = sr < 0 ? -sr : sr;
                    }
                    /* max(|x|, decayed) — NOT a conditional on |x| > pk.
                       Written the conditional way a level that merely HOLDS
                       takes the decay branch and droops. Mirrors the JS
                       operation for operation, including the order: decay
                       first, then take the max. Writing it the other way
                       cost 7,507 parity mismatches. */
                    pkL *= pkC; if (apl > pkL) pkL = apl;
                    pkR *= pkC; if (apr > pkR) pkR = apr;
                    al = pkL; ar = pkR;
                }

                if (tsW > 0) {
                    tsFL = tsFastC * tsFL + (1 - tsFastC) * al;
                    tsSL = tsSlowC * tsSL + (1 - tsSlowC) * al;
                    tsFR = tsFastC * tsFR + (1 - tsFastC) * ar;
                    tsSR = tsSlowC * tsSR + (1 - tsSlowC) * ar;
                    double dL2 = tsFL - tsSL; if (dL2 < 0) dL2 = -dL2;
                    double dR2 = tsFR - tsSR; if (dR2 < 0) dR2 = -dR2;
                    double wL2 = nd::blend(dL2, 0.02), wR2 = nd::blend(dR2, 0.02);
                    al = al * (1 - tsW) + (wL2 * tsFL + (1 - wL2) * tsSL) * tsW;
                    ar = ar * (1 - tsW) + (wR2 * tsFR + (1 - wR2) * tsSR) * tsW;
                }
                double lvL = nd::linToDb(al), lvR = nd::linToDb(ar);
                double mx = lvL > lvR ? lvL : lvR;
                double vL = linkA * mx + linkB * lvL;
                double vR = linkA * mx + linkB * lvR;

                double gl, gr2, tgtL = 0, tgtR = 0;
                if (smoothLevel) {
                    double aL = attackFor(vL - Tdb), aR = attackFor(vR - Tdb);
                    if (vL > eLf) { eLf = moveTo(eLf, vL, aL); holdL = holdN; }
                    else if (holdL > 0) { holdL--; if (holdW > 0) eLf = moveTo(eLf, vL, holdCoef(holdL)); }
                    else { eLf = moveTo(eLf, vL, relF); }
                    if (autoRel) {
                        if (vL > eLs) eLs = moveTo(eLs, vL, aL);
                        else if (holdL <= 0) eLs = moveTo(eLs, vL, relS);
                        double dL = eLf - eLs; if (dL < 0) dL = -dL;
                        double wL = nd::blend(dL, 3.0);
                        gl = gainComp(wL * eLf + (1 - wL) * eLs);
                    } else { eLs = eLf; gl = gainComp(eLf); }
                    tgtL = gainComp(vL);

                    if (vR > eRf) { eRf = moveTo(eRf, vR, aR); holdR = holdN; }
                    else if (holdR > 0) { holdR--; if (holdW > 0) eRf = moveTo(eRf, vR, holdCoef(holdR)); }
                    else { eRf = moveTo(eRf, vR, relF); }
                    if (autoRel) {
                        if (vR > eRs) eRs = moveTo(eRs, vR, aR);
                        else if (holdR <= 0) eRs = moveTo(eRs, vR, relS);
                        double dR = eRf - eRs; if (dR < 0) dR = -dR;
                        double wR = nd::blend(dR, 3.0);
                        gr2 = gainComp(wR * eRf + (1 - wR) * eRs);
                    } else { eRs = eRf; gr2 = gainComp(eRf); }
                    tgtR = gainComp(vR);
                } else {
                    double tL = gainComp(vL), tR = gainComp(vR);
                    tgtL = tL; tgtR = tR;
                    if (tL < gLf) { gLf = moveTo(gLf, tL, attC); holdL = holdN; }
                    else if (holdL > 0) { holdL--; if (holdW > 0) gLf = moveTo(gLf, tL, holdCoef(holdL)); }
                    else { gLf = moveTo(gLf, tL, relF); }
                    if (autoRel) {
                        if (tL < gLs) gLs = moveTo(gLs, tL, attC);
                        else if (holdL <= 0) gLs = moveTo(gLs, tL, relS);
                        double d2 = gLf - gLs; if (d2 < 0) d2 = -d2;
                        double w2 = nd::blend(d2, 3.0);
                        gl = w2 * gLf + (1 - w2) * gLs;
                    } else { gLs = gLf; gl = gLf; }

                    if (tR < gRf) { gRf = moveTo(gRf, tR, attC); holdR = holdN; }
                    else if (holdR > 0) { holdR--; if (holdW > 0) gRf = moveTo(gRf, tR, holdCoef(holdR)); }
                    else { gRf = moveTo(gRf, tR, relF); }
                    if (autoRel) {
                        if (tR < gRs) gRs = moveTo(gRs, tR, attC);
                        else if (holdR <= 0) gRs = moveTo(gRs, tR, relS);
                        double d3 = gRf - gRs; if (d3 < 0) d3 = -d3;
                        double w3 = nd::blend(d3, 3.0);
                        gr2 = w3 * gRf + (1 - w3) * gRs;
                    } else { gRs = gRf; gr2 = gRf; }
                }

                gl = dn(shape(gl, gPrevL, tgtL));
                gr2 = dn(shape(gr2, gPrevR, tgtR));
                gPrevL = gl; gPrevR = gr2;

                grNow = gl < gr2 ? gl : gr2;
                if (grNow < grPeak) grPeak = grNow;

                double lgL = gl == 0 ? 1 : nd::dbToLin(gl);
                double lgR = gr2 == 0 ? 1 : nd::dbToLin(gr2);
                fbL = lgL; fbR = lgR;

                if (st.scListen) {
                    double ll = sl, rr = sr;
                    if (msPlace) { double q = ll + rr; rr = ll - rr; ll = q; }
                    outL[s] = ll; outR[s] = rr;
                    outRing[(size_t)outw] = ll; outw = (outw + 1) & 4095;
                    meter.push(ll, rr);
                    continue;
                }

                double yl, yr;
                if (deltaOn) { yl = dl - dl * lgL; yr = dr - dr * lgR; }
                else {
                    yl = dl * (mixD + lgL * mixW);
                    yr = dr * (mixD + lgR * mixW);
                }
                if (mkLin != 1) { yl *= mkLin; yr *= mkLin; }
                if (msPlace) { double rl = yl + yr; yr = yl - yr; yl = rl; }
                outL[s] = yl; outR[s] = yr;
                outRing[(size_t)outw] = yl; outw = (outw + 1) & 4095;
                meter.push(yl, yr);
            }
            pos = end;
        }
        meter.latch();
    }

private:
    static double moveTo(double cur, double t, double coef) { return coef * cur + (1 - coef) * t; }
    /* release coefficient while HOLD counts down — mirrors the JS.
       At holdW == 0 the CALLER skips this entirely, which is what keeps
       every pre-round-8 baseline bit-identical rather than merely close. */
    double holdCoef(int rem) const {
        double frac = holdN > 0 ? (double)rem / holdN : 0.0;
        return 1 - (1 - relF) * (1 - frac) * holdW;
    }
    /* Interpolated peak on the DETECTOR path, so the compressor can react to
       an inter-sample peak before it becomes a sample peak. The phase count
       is selectable (2/4/8); see the JS core for why it only matters on
       isolated transients. */
    double ipeak(double* z, double x) {
        z[dzw] = x;
        double best = x < 0 ? -x : x;
        for (int p2 = 0; p2 < dTAPS.n; p2++) {
            double acc = 0; int idx = dzw;
            for (int k = 0; k < TP_TAPS; k++) {
                acc += dTAPS.t[p2][k] * z[idx];
                idx = idx == 0 ? TP_TAPS - 1 : idx - 1;
            }
            double a = acc < 0 ? -acc : acc;
            if (a > best) best = a;
        }
        return best;
    }
    double attackFor(double overDb) const {
        if (!levelAttack) return attC;
        double o = overDb > 0 ? overDb : 0;
        if (o > 30) o = 30;
        return nd::onePole(st.attack / (1 + o / 8), fs);
    }
    double gainComp(double x) const {
        double g = nd::kneeGain(x, Tdb, Wdb, invR);
        return g < -rangeDb ? -rangeDb : g;
    }
    double shape(double g, double prev, double target) const {
        if (curveW <= 0 || g <= prev) return g;
        double lin = prev + linRate;
        if (lin > 0) lin = 0;
        if (lin > target) lin = target;
        return g * (1 - curveW) + lin * curveW;
    }
    void rebuild() {
        const StyleCfg& sd = styleCfg(st.style);
        fbTopo = sd.fb != 0;
        smoothLevel = sd.smoothLevel != 0;
        levelAttack = sd.levelAttack != 0;
        rmsMs = sd.rmsMs;
        pkMs = sd.pkMs;
        /* rebuilt here, mirroring the JS — a different phase count is a
           different filter, and rebuild() is the only place that may. */
        dTAPS = tpTaps(detOsLegal(st.detOsX) ? st.detOsX : 4);
        useRms = st.detect == D_AUTO ? (sd.detectRms != 0) : (st.detect == D_RMS);
        lookN = lookSamples(st, fs);
        delL.init(lookN > 0 ? lookN : 1);
        delR.init(lookN > 0 ? lookN : 1);
        msL = msR = 0; pkL = pkR = 0;
        gLf = gLs = gRf = gRs = 0;
        eLf = eLs = eRf = eRs = -120;
        holdL = holdR = 0;
        fbL = fbR = 1;
        hpL.clear(); hpR.clear(); lpL.clear(); lpR.clear();
        gPrevL = gPrevR = 0;
        tsFL = tsSL = tsFR = tsSR = 0;
        for (int di = 0; di < TP_TAPS; di++) { dzL[di] = 0; dzR[di] = 0; }
        dzw = 0;
        meter.reset();
        std::fill(scRing.begin(), scRing.end(), 0.0);
        scw = 0;
        std::fill(outRing.begin(), outRing.end(), 0.0);
        outw = 0;
    }
    struct P { double c = 0, t = 0; };
    static void smoothP(P& p) {
        double n = p.c + (p.t - p.c) * SMOOTH;
        p.c = std::fabs(p.t - n) < SNAP ? p.t : n;
    }
    void snapAll() {
        pT.c = pT.t; pW.c = pW.t; pR.c = pR.t; pIn.c = pIn.t;
        pMk.c = pMk.t; pLink.c = pLink.t; pMix.c = pMix.t;
    }
    void applyTargets() {
        pT.t = st.thresh; pW.t = st.knee; pR.t = invRatio(st.ratio);
        pIn.t = st.inGain; pMk.t = makeupDb(st);
        pLink.t = st.link / 100.0; pMix.t = st.mix / 100.0;
    }
    void control() {
        smoothP(pT); smoothP(pW); smoothP(pR); smoothP(pIn);
        smoothP(pMk); smoothP(pLink); smoothP(pMix);
        Tdb = pT.c; Wdb = pW.c; invR = pR.c;
        inLin = pIn.c == 0 ? 1 : nd::dbToLin(pIn.c);
        mkLin = pMk.c == 0 ? 1 : nd::dbToLin(pMk.c);
        rangeDb = st.range;
        linkA = pLink.c; linkB = 1 - pLink.c;
        mixW = pMix.c; mixD = 1 - pMix.c;
        attC = nd::onePole(st.attack, fs);
        double relMs = releaseMs(st);
        relF = nd::onePole(relMs, fs);
        relS = nd::onePole(relMs * 8, fs);
        holdN = (int)std::floor(st.hold * 0.001 * fs + 0.5);
        holdW = st.holdTaper / 100.0;
        autoRel = st.autoRel;
        msC = rmsMs > 0 ? nd::onePole(rmsMs, fs) : 0;
        pkC = nd::onePole(pkMs, fs);
        msPlace = (st.place == P_MS);
        deltaOn = st.delta;
        tsW = st.tsSplit / 100.0;
        tsFastC = nd::onePole(1.5, fs);
        tsSlowC = nd::onePole(60.0, fs);
        curveW = st.curve / 100.0;
        linRate = 20.0 / (releaseMs(st) * 0.001 * fs);
        detOs = st.detOs;
        scOn = st.scOn;
        if (scOn) {
            scHpC = nd::secSosHP(nd::clamp(st.scHp, 10.0, fs * 0.45), M_SQRT1_2, fs);
            scLpC = nd::secSosLP(nd::clamp(st.scLp, 1000.0, fs * 0.45), M_SQRT1_2, fs);
        }
    }

    double fs;
    State st;
    bool first = true;
    int lookN = 0;
    nd::Delay delL, delR;
    bool fbTopo = false, smoothLevel = false, levelAttack = false, useRms = false;
    double rmsMs = 0;
    double pkMs = PEAK_DECAY_MS;
    P pT, pW, pR, pIn, pMk, pLink, pMix;
    double inLin = 1, mkLin = 1, Tdb = 0, Wdb = 0, invR = 1, rangeDb = 60;
    double linkA = 1, linkB = 0, mixW = 1, mixD = 0;
    double attC = 0, relF = 0, relS = 0, msC = 0, pkC = 0;
    int holdN = 0;
    double holdW = 0;
    bool autoRel = false, scOn = false, msPlace = false, deltaOn = false, detOs = false;
    double tsW = 0, tsFastC = 0, tsSlowC = 0;
    double tsFL = 0, tsSL = 0, tsFR = 0, tsSR = 0;
    TpTaps dTAPS{};
    double dzL[TP_TAPS] = { 0 }, dzR[TP_TAPS] = { 0 };
    int dzw = 0;
    double curveW = 0, linRate = 0;
    nd::BqCoef scHpC = nd::BYPASS_SECTION, scLpC = nd::BYPASS_SECTION;
    double msL = 0, msR = 0, pkL = 0, pkR = 0;
    double gLf = 0, gLs = 0, gRf = 0, gRs = 0;
    double eLf = 0, eLs = 0, eRf = 0, eRs = 0;
    int holdL = 0, holdR = 0;
    double fbL = 1, fbR = 1, gPrevL = 0, gPrevR = 0;
    nd::Biquad hpL, hpR, lpL, lpR;
    double grNow = 0, grPeak = 0;
    Meter meter;
    std::vector<double> scRing;
    int scw = 0;
    /* OUTPUT ring — mirrors the JS exactly, including being written on the
       bypass path. See rigor_core.js for why this is not folded into the
       meter: the meter is not pushed while bypassed, and bypass on/off is
       the comparison an output spectrum exists to serve. */
    std::vector<double> outRing;
    int outw = 0;
};

/* ---------- multiband ----------
   At bands == 1 the splitter is bypassed and the caller's own buffers go
   straight to engine 0, so the result is BIT-IDENTICAL to the single
   engine. The inner engines are deliberately NOT primed at construction:
   they snap on their first setState and glide afterwards, so priming with
   defaults would make the first real state glide in from them. */
class Multi {
public:
    explicit Multi(double sampleRate) : fs(sampleRate) {
        eng.reserve(MAX_BANDS);
        for (int i = 0; i < MAX_BANDS; i++) eng.emplace_back(new Engine(sampleRate));
        sp.init(sampleRate);
        meter.init(sampleRate);
        st = defaultState();
        sp.set((double)st.bands, st.xover[0], st.xover[1]);
    }
    void setState(const State& s) {
        st = sanitizeState(s);
        sp.set((double)st.bands, st.xover[0], st.xover[1]);
        /* rebuilt only when the length changes — re-allocating a delay
           line empties it, and emptying it mid-stream is a dropout */
        int want = lookSamples(st, fs);
        if (want != dryN) {
            dryN = want;
            dryL.init(dryN > 0 ? dryN : 1);
            dryR.init(dryN > 0 ? dryN : 1);
        }
        if (st.bands == 1) eng[0]->setState(st);
        else for (int k = 0; k < st.bands; k++) eng[(size_t)k]->setState(bandState(k));
    }
    void reset() {
        for (int k = 0; k < MAX_BANDS; k++) eng[(size_t)k]->reset();
        sp.clear(); meter.reset();
        std::fill(outRingM.begin(), outRingM.end(), 0.0);
        outwM = 0;
    }
    /* Analyser taps at the wrapper level. scTap delegates unconditionally
       — the sidechain trace is band 0's detector by definition. outTap
       delegates ONLY at bands == 1, where eng[0]'s output really is the
       wrapper's output; above that the sum happens here and eng[0] has
       never seen the other bands. */
    int scTap(double* out, int n) const { return eng[0]->scTap(out, n); }
    int outTap(double* out, int n) const {
        if (st.bands == 1) return eng[0]->outTap(out, n);
        int k = n < 4096 ? n : 4096;
        for (int i = 0; i < k; i++) out[i] = outRingM[(size_t)((outwM - k + i + 4096) & 4095)];
        return k;
    }
    int latency() const { return eng[0]->latency(); }
    void process(const double* inL, const double* inR, double* outL, double* outR, int n) {
        if (st.bands == 1) {
            eng[0]->process(inL, inR, outL, outR, n);
            bandGr[0] = eng[0]->gr(); bandGr[1] = 0; bandGr[2] = 0;
            return;
        }
        grow(n);
        int nb = st.bands;
        double frame[MAX_BANDS * 2];
        for (int i = 0; i < n; i++) {
            /* guard BEFORE the splitter: an Inf entering a crossover
               biquad becomes part of that filter's state permanently, so
               the band engines' own guards would be on the wrong side of
               the wound. Mirrors the JS wrapper. */
            double gl2 = inL[i], gr3 = inR[i];
            if (!std::isfinite(gl2)) gl2 = 0.0;
            if (!std::isfinite(gr3)) gr3 = 0.0;
            /* dry tap: guarded, and before the splitter — the only point
               in the wrapper where the signal is both safe and untouched.
               Fed every sample regardless of bypass so the line is primed
               when the toggle comes. */
            dryBufL[(size_t)i] = dryN > 0 ? dryL.push(gl2) : gl2;
            dryBufR[(size_t)i] = dryN > 0 ? dryR.push(gr3) : gr3;
            sp.split(gl2, gr3, frame);
            for (int k = 0; k < nb; k++) {
                bL[(size_t)k][(size_t)i] = frame[k * 2];
                bR[(size_t)k][(size_t)i] = frame[k * 2 + 1];
            }
        }
        int scb = (st.scBand - 1 >= 0 && st.scBand - 1 < nb) ? st.scBand - 1 : -1;
        for (int k = 0; k < nb; k++) {
            if (scb >= 0)
                eng[(size_t)k]->process(bL[(size_t)k].data(), bR[(size_t)k].data(),
                                        oL[(size_t)k].data(), oR[(size_t)k].data(), n,
                                        bL[(size_t)scb].data(), bR[(size_t)scb].data());
            else
                eng[(size_t)k]->process(bL[(size_t)k].data(), bR[(size_t)k].data(),
                                        oL[(size_t)k].data(), oR[(size_t)k].data(), n);
        }
        bool anySolo = false;
        for (int k = 0; k < nb; k++) if (st.band[k].solo) anySolo = true;
        double g[MAX_BANDS] = { 0, 0, 0 };
        for (int k = 0; k < nb; k++) {
            bool audible = anySolo ? st.band[k].solo : !st.band[k].mute;
            if (st.delta && st.deltaBand > 0) audible = (st.deltaBand == k + 1);
            g[k] = audible ? nd::dbToLin(st.band[k].gain) : 0.0;
        }
        /* DRY BYPASS. The bands were still processed and the splitter was
           still fed, so every filter and delay line stays primed and the
           toggle back is seamless; their output is simply not what
           leaves. Mirrors the JS wrapper. */
        bool bypassDry = st.bypass && !st.bypassSplit;
        for (int i = 0; i < n; i++) {
            double yl, yr;
            if (bypassDry) { yl = dryBufL[(size_t)i]; yr = dryBufR[(size_t)i]; }
            else {
                yl = 0; yr = 0;
                for (int k = 0; k < nb; k++) {
                    yl += oL[(size_t)k][(size_t)i] * g[k];
                    yr += oR[(size_t)k][(size_t)i] * g[k];
                }
            }
            outL[i] = yl; outR[i] = yr;
            outRingM[(size_t)outwM] = yl; outwM = (outwM + 1) & 4095;
            meter.push(yl, yr);
        }
        meter.latch();
        for (int k = 0; k < MAX_BANDS; k++) bandGr[k] = k < nb ? eng[(size_t)k]->gr() : 0.0;
    }
    Meters meters() const {
        if (st.bands == 1) {
            Meters m = eng[0]->meters();
            for (int k = 0; k < MAX_BANDS; k++) m.bandGr[k] = bandGr[k];
            return m;
        }
        Meters m;
        double worst = 0;
        for (int k = 0; k < st.bands; k++) if (bandGr[k] < worst) worst = bandGr[k];
        m.gr = worst; m.grPeak = worst; m.latency = eng[0]->latency();
        m.thresh = st.thresh;
        m.tpL = meter.tpL; m.tpR = meter.tpR;
        m.lufsM = meter.lufsM; m.lufsS = meter.lufsS; m.lufsI = meter.lufsI;
        m.corr = meter.corr;
        for (int k = 0; k < MAX_BANDS; k++) m.bandGr[k] = bandGr[k];
        return m;
    }
private:
    State bandState(int k) const {
        State b = sanitizeState(st);
        b.thresh = nd::clamp(b.thresh + st.band[k].threshOff, -60.0, 0.0);
        b.bands = 1;
        if (st.delta && st.deltaBand > 0) b.delta = (st.deltaBand == k + 1);
        return b;
    }
    void grow(int n) {
        if (n <= cap) return;
        cap = n;
        bL.assign(MAX_BANDS, std::vector<double>((size_t)cap, 0.0));
        bR.assign(MAX_BANDS, std::vector<double>((size_t)cap, 0.0));
        oL.assign(MAX_BANDS, std::vector<double>((size_t)cap, 0.0));
        oR.assign(MAX_BANDS, std::vector<double>((size_t)cap, 0.0));
        dryBufL.assign((size_t)cap, 0.0);
        dryBufR.assign((size_t)cap, 0.0);
    }
    double fs;
    State st;
    std::vector<std::unique_ptr<Engine>> eng;
    Splitter sp;
    Meter meter;
    std::vector<std::vector<double>> bL, bR, oL, oR;
    /* the wrapper's own dry path, for bypassSplit == false — audio that
       never touched the splitter, which is the whole point of it */
    nd::Delay dryL, dryR;
    int dryN = 0;
    std::vector<double> dryBufL, dryBufR;
    std::vector<double> outRingM = std::vector<double>(4096, 0.0);
    int outwM = 0;
    int cap = 0;
    double bandGr[MAX_BANDS] = { 0, 0, 0 };
};

/* ---------- deterministic test signals (mirror of the JS) ---------- */
/* Park-Miller LCG, mirroring ND.makeNoise in the JS. Products stay under
   2^53 so doubles are exact and the twin agrees trivially. */
inline void makeNoise(unsigned int seed, int n, std::vector<double>& out) {
    double x = (double)(seed ? seed : 1u);
    out.resize((size_t)n);
    for (int i = 0; i < n; i++) {
        x = std::fmod(x * 16807.0, 2147483647.0);
        out[(size_t)i] = (x / 2147483647.0) * 2.0 - 1.0;
    }
}
inline void makeSine(double freq, double fs, int n, double amp, std::vector<double>& out) {
    out.resize((size_t)n);
    double w = 2 * M_PI * freq / fs;
    for (int i = 0; i < n; i++) out[(size_t)i] = amp * nm::sin_(w * i);
}
inline void makeStep(double fs, int n, double lo, double hi, double atFrac,
                     std::vector<double>& out) {
    out.resize((size_t)n);
    int at = (int)std::floor(n * (atFrac > 0 ? atFrac : 0.5));
    for (int i = 0; i < n; i++) out[(size_t)i] = i < at ? lo : hi;
}

} // namespace rigor
