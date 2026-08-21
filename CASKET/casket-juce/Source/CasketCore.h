/* ============================================================
   CasketCore.h — C++ twin of casket_core.js
   "nothing gets out."
   v0.1 · Phase 2 · 2026-08-15
   Every operation in the same ORDER as the JS. That is what makes the
   parity gate bit-exact rather than "within a few ulp".
   PARITY LAW: compile with -ffp-contract=off.
   Relative includes are deliberate — no -I flag needed, so CI's bare
   g++ line works and the header sits at the same depth AUTOPSY's does.
   ============================================================ */
#pragma once
#include <cmath>
#include <vector>
#include <string>
#include <cstdint>
#include <atomic>
#include "../../../shared/necromath.h"
#include "../../../shared/necrodyn.h"

namespace casket {

static const char* VERSION = "0.1";
static const int CTRL = 32;
static const double SMOOTH = 0.25;
static const double SNAP = 1e-9;
static const int OS_Q = 16;
static const int METER_OS = 4;
static const int DEC_Q = 64;        // the seal's decimator: half = DEC_Q * M
static const double DEC_CUT = 0.96; // cutoff as a fraction of base Nyquist

enum Style { PINE = 0, VELVET = 1, OAK = 2, IRON = 3, LEAD = 4 };
enum Dust { DUST_OFF = 0, DUST_FLAT = 1, DUST_SHAPED = 2 };

struct StyleDef {
    double smoothFrac;
    int relShape;             // 0 = exponential, 1 = linear in dB
    double vigil, release, knee;
    int lining;
    double margin;
    bool autoRel;
    double sat;
    bool seal;
};
inline const StyleDef& styleDef(int s) {
    static const StyleDef T[5] = {
        /* pine   */ { 1.0,   1, 3.0, 200, 0.0,  4,  0.0,  false, 0,  false },
        /* velvet */ { 1.0,   0, 2.0, 150, 3.0,  4,  0.0,  true,  0,  false },
        /* oak    */ { 0.375, 0, 1.0, 60,  0.0,  4,  0.0,  true,  0,  false },
        /* iron   */ { 0.625, 0, 1.5, 40,  1.5,  8,  0.0,  false, 60, false },
        /* lead   */ { 1.0,   1, 5.0, 400, 6.0,  4,  -0.3, true,  0,  true  }
    };
    return T[(s < 0 || s > 4) ? VELVET : s];
}

/* ---------- state ---------- */
struct State {
    bool bypass = false;
    int style = VELVET;
    double drive = 0;
    double lid = -1.0;
    double margin = 0;
    double vigil = 2.0;
    double release = 150;
    bool autoRel = true;
    double knee = 3.0;
    double hold = 0;
    double link = 100;
    int lining = 4;
    bool seal = false;
    double sat = 0;
    bool ms = false;
    double msMid = 0, msSide = 0;
    bool dc = true;
    bool unity = false;
    int dust = DUST_OFF;
    int dustBits = 16;
    std::uint32_t dustSeed = 1848;
    double targetLufs = -14;
};

inline State fromStyle(int s) {
    const StyleDef& d = styleDef(s);
    State st;
    st.style = s;
    st.vigil = d.vigil; st.release = d.release; st.knee = d.knee;
    st.lining = d.lining; st.margin = d.margin; st.autoRel = d.autoRel; st.sat = d.sat;
    st.seal = d.seal;
    return st;
}

inline bool legalLining(int m) { return m == 1 || m == 2 || m == 4 || m == 8 || m == 16; }

inline State sanitize(State s) {
    State o;
    o.bypass = s.bypass;
    o.style = (s.style < 0 || s.style > 4) ? VELVET : s.style;
    o.drive = nd::clamp(s.drive, -12, 24);
    o.lid = nd::clamp(s.lid, -20, 0);
    o.margin = nd::clamp(s.margin, -1, 0);
    o.vigil = nd::clamp(s.vigil, 0.1, 20);
    o.release = nd::clamp(s.release, 1, 1000);
    o.knee = nd::clamp(s.knee, 0, 12);
    o.hold = nd::clamp(s.hold, 0, 500);
    o.link = nd::clamp(s.link, 0, 100);
    o.sat = nd::clamp(s.sat, 0, 100);
    o.targetLufs = nd::clamp(s.targetLufs, -30, -5);
    o.ms = s.ms;
    o.msMid = nd::clamp(s.msMid, -12, 12);
    o.msSide = nd::clamp(s.msSide, -12, 12);
    o.autoRel = s.autoRel;
    o.seal = s.seal;
    o.lining = legalLining(s.lining) ? s.lining : 4;
    /* sealed at 1x is a contradiction — corrected, not obeyed */
    if (o.seal && o.lining == 1) o.lining = 2;
    o.dc = s.dc;
    o.unity = s.unity;
    o.dust = (s.dust < 0 || s.dust > 2) ? DUST_OFF : s.dust;
    o.dustBits = (s.dustBits == 16 || s.dustBits == 20 || s.dustBits == 24) ? s.dustBits : 16;
    o.dustSeed = s.dustSeed ? s.dustSeed : 1848;
    return o;
}

/* ---------- the oversampler (the lining) ----------
   Mth-band FIR, windowed sinc, cutoff exactly at fs/2M. Branch 0 is a
   pure delay; latency is q base samples at every M. */
struct Oversampler {
    int M = 1, q = OS_Q, len = 1, center = 0, histLen = 1;
    std::vector<double> taps;
    std::vector<std::vector<double> > phases;
};

inline Oversampler designOversampler(int M, int q) {
    Oversampler o;
    o.M = M; o.q = q; o.histLen = 2 * q + 1;
    if (M == 1) {
        o.len = 1; o.center = 0;
        o.taps.assign(1, 1.0);
        o.phases.push_back(std::vector<double>(1, 1.0));
        return o;
    }
    int L = 2 * M * q + 1, c = M * q;
    o.len = L; o.center = c;
    o.taps.assign((size_t)L, 0.0);
    const double a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
    double den = L - 1;
    int k;
    for (k = 0; k < L; k++) {
        double u = 2 * M_PI * k / den;
        double w = a0 - a1 * nm::cos_(u) + a2 * nm::cos_(2 * u) - a3 * nm::cos_(3 * u);
        double t = (double)(k - c) / M;
        double st;
        if (t == 0) st = 1;
        else { double pt = M_PI * t; st = nm::sin_(pt) / pt; }
        o.taps[(size_t)k] = st * w;
    }
    /* exact Mth-band correction — these values are known in closed form */
    for (k = 0; k < L; k++) if ((k - c) % M == 0) o.taps[(size_t)k] = (k == c) ? 1.0 : 0.0;
    for (int i = 0; i < M; i++) {
        std::vector<double> ph;
        for (int j = 0; j * M + i < L; j++) ph.push_back(o.taps[(size_t)(j * M + i)]);
        double sum = 0;
        for (size_t z = 0; z < ph.size(); z++) sum += ph[z];
        if (sum != 0 && sum != 1) for (size_t z = 0; z < ph.size(); z++) ph[z] /= sum;
        o.phases.push_back(ph);
    }
    return o;
}

/* ---------- the decimator (the seal) ----------
   A DIFFERENT filter from the interpolator above: that one is -6 dB AT
   Nyquist by construction, which makes it a fine interpolator and a poor
   decimator. Unit DC gain. */
struct Decimator { std::vector<double> taps; int len = 1, half = 0; };

inline Decimator designDecimator(int M, int decQ, double cutFrac) {
    Decimator d;
    int half = decQ * M, L = 2 * half + 1;
    d.len = L; d.half = half;
    d.taps.assign((size_t)L, 0.0);
    const double a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
    double den = L - 1, fc = cutFrac / M;
    int k;
    for (k = 0; k < L; k++) {
        double u = 2 * M_PI * k / den;
        double w = a0 - a1 * nm::cos_(u) + a2 * nm::cos_(2 * u) - a3 * nm::cos_(3 * u);
        double t = (double)(k - half) * fc;
        double st;
        if (t == 0) st = 1;
        else { double pt = M_PI * t; st = nm::sin_(pt) / pt; }
        d.taps[(size_t)k] = st * w;
    }
    double sum = 0;
    for (k = 0; k < L; k++) sum += d.taps[(size_t)k];
    for (k = 0; k < L; k++) d.taps[(size_t)k] /= sum;
    return d;
}

/* ---------- ITU-R BS.1770-4 K-weighting ---------- */
struct KWeight { nd::BqCoef shelf, hp; };

inline KWeight kWeight(double fs) {
    KWeight k;
    double f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    double K = nm::sin_(M_PI * f0 / fs) / nm::cos_(M_PI * f0 / fs);
    double Vh = nm::pow10_(G / 20);
    double Vb = nm::exp_(nm::log_(Vh) * 0.4996667741545416);
    double a0 = 1 + K / Q + K * K;
    k.shelf.b0 = (Vh + Vb * K / Q + K * K) / a0;
    k.shelf.b1 = 2 * (K * K - Vh) / a0;
    k.shelf.b2 = (Vh - Vb * K / Q + K * K) / a0;
    k.shelf.a1 = 2 * (K * K - 1) / a0;
    k.shelf.a2 = (1 - K / Q + K * K) / a0;
    double f1 = 38.13547087602444, Q1 = 0.5003270373238773;
    double K1 = nm::sin_(M_PI * f1 / fs) / nm::cos_(M_PI * f1 / fs);
    double d1 = 1 + K1 / Q1 + K1 * K1;
    k.hp.b0 = 1; k.hp.b1 = -2; k.hp.b2 = 1;
    k.hp.a1 = 2 * (K1 * K1 - 1) / d1;
    k.hp.a2 = (1 - K1 / Q1 + K1 * K1) / d1;
    return k;
}

inline double loudnessOf(double z) {
    return z > 1e-30 ? -0.691 + 10 * nm::log10_(z) : -std::numeric_limits<double>::infinity();
}

/* ---------- derived sizes ----------
   floor(x + 0.5), not std::round: JS Math.round and C++ std::round
   disagree on ties for negatives, and floor does not. */
inline int vigilSamples(const State& s, double fs) {
    return (int)std::floor(nd::clamp(s.vigil, 0.1, 20) * 0.001 * fs + 0.5);
}
inline int latencySamples(const State& state, double fs) {
    State s = sanitize(state);
    return OS_Q + vigilSamples(s, fs) + 1 + (s.seal ? DEC_Q : 0);
}
inline int boxLen(const State& s, double fs) {
    int Lb = vigilSamples(s, fs), M = s.lining;
    int span = (int)std::floor(styleDef(s.style).smoothFrac * M * Lb);
    int B = (int)std::floor(span / 2.0) + 1;
    return B < 1 ? 1 : B;
}

inline double transferAt(const State& state, double inDb) {
    State s = sanitize(state);
    double T = s.lid + s.margin;
    double x = inDb + s.drive;
    double y = nd::kneeOut(x, T, s.knee, 0);
    if (s.unity) y += s.drive < 0 ? 0 : -s.drive;
    return y;
}

/* ============================================================
   THE PLOT — BS.1770-4 metering
   ============================================================ */
static const double BIN_LO = -70, BIN_W = 0.1;
static const int NBINS = 751;

struct Meters {
    double momentary, shortTerm, integrated, lra;
    double peakDb, truePeakDb, peak, truePeak;
    double gr, grPeak;
    int latency;
};

/* THE TRACE — peaks since the last read, for a scrolling display.
   Distinct from Meters::peak, which is a running maximum since the last
   resetMeters(). Sampling a running maximum at 30 Hz and drawing it as a
   scrolling level produces a line that climbs to a plateau and then never
   moves again — which is what the first editor did. A scrolling view needs
   the peak WITHIN each frame, so these reset on read.
   The input figure is here because every number the meter produces is
   measured AFTER the limiter, so a face that wants to show what went in
   has nothing to draw and must either invent it or draw the output twice. */
struct Trace {
    double inPeak, outPeak, gr;
    double inPeakDb, outPeakDb;
};

/* ============================================================
   DISPLAY MAPPINGS — how a number becomes a position
   ============================================================
   Moved here 2026-08-19 from static functions inside PluginEditor.cpp.
   They are not DSP and they do not belong to the engine; they are here for
   one reason, which is that `static` in a .cpp is unreachable by any test.
   The browser's identical copies live in UIH and are asserted headlessly —
   dbToY round-trips, meterFrac clamps at both ends, grToPx cannot exceed
   its band. The C++ copies had none of that, which is the wrong way round:
   the plugin's face is the one nobody can open in this sandbox.

   Kept as free functions rather than folded into Engine because both faces
   need them without an engine instance, and because a scale mapping that
   depended on engine state would be a bug waiting to happen. */
inline double meterFrac(double v, double lo, double hi) {
    if (!std::isfinite(v)) return 0.0;      /* silence reads empty, not NaN */
    double f = (v - lo) / (hi - lo);
    return f < 0 ? 0 : (f > 1 ? 1 : f);
}
/* the viewing's dB→pixel map. TOP/BOT are the browser's UIH.TOP/UIH.BOT. */
inline double dbToY(double v, double h, double top, double bot) {
    if (v > top) v = top;
    if (v < bot) v = bot;
    return (top - v) / (top - bot) * h;
}
/* the weight hangs from the top: no reduction draws nothing, and it can
   never exceed its band no matter how deep the reduction goes */
inline double grToPx(double gr, double h, double grMax) {
    double g = gr > 0 ? 0 : (gr < -grMax ? -grMax : gr);
    return (-g / grMax) * h;
}

/* THE RANGE, as a fixed-size POD so it can cross a Handoff — 2026-08-19.
   Variable-length would mean allocating on the audio thread, which is the
   one thing processBlock may never do; 751 bins is the histogram's whole
   fixed width (BIN_LO −70 LUFS, 0.1 LU steps), so carrying all of it costs
   6 KB per slot and asks no questions. The browser sends sparse bins over
   postMessage instead — it can afford to allocate, and a message is not a
   real-time deadline. Same picture, different transport, for the same
   reason each side does everything else differently at this seam. */
struct Hist {
    double counts[751];
    double gate, p10, p95, lra;
    bool   any;            /* false until the 3 s short-term window has filled */
};

/* A trace with nothing in it yet — moved here from PluginProcessor.h
   2026-08-19 so it can be tested without JUCE. The dB fields seed to −inf
   rather than 0: a zero-initialised Trace draws a 0 dBFS line on an idle
   transport, which reads as "full scale" rather than "silence". */
inline Trace emptyTrace() {
    Trace t {};
    t.inPeakDb = t.outPeakDb = -std::numeric_limits<double>::infinity();
    return t;
}

/* FOLD ONE BLOCK'S TRACE INTO AN ACCUMULATOR.
   Extracted from processBlock 2026-08-19 for the same reason histBinKept
   came out of the canvas code: it is a rule about what the user sees,
   living where no test could reach it.

   Why an accumulator exists at all: Engine::trace() RESETS ON READ, and
   after the 2026-08-18 seam rewrite that read happens per audio block. The
   editor draws at 30 Hz, so between two frames several blocks have come and
   gone — take only the last one and every peak in the others is lost, which
   on a scrolling display looks like a meter that misses transients. So the
   audio thread folds each block in and clears only when the editor confirms
   it has drawn a frame.

   The directions are not symmetric and that is the whole content of this
   function: peaks accumulate as MAXIMA, gain reduction as a MINIMUM,
   because gr is negative-going and the deepest reduction is the one worth
   showing. The dB fields fold as maxima directly rather than being
   recomputed from the linear ones — dB is monotone in the value it mirrors,
   so the larger dB always belongs to the larger linear peak. */
inline void foldTrace(Trace& acc, const Trace& t) {
    if (t.inPeak    > acc.inPeak)    acc.inPeak    = t.inPeak;
    if (t.outPeak   > acc.outPeak)   acc.outPeak   = t.outPeak;
    if (t.inPeakDb  > acc.inPeakDb)  acc.inPeakDb  = t.inPeakDb;
    if (t.outPeakDb > acc.outPeakDb) acc.outPeakDb = t.outPeakDb;
    if (t.gr        < acc.gr)        acc.gr        = t.gr;
}

/* ============================================================
   HANDOFF — publishing a snapshot from the audio thread to the UI
   ============================================================
   ADDED 2026-08-18. Built and stress-tested; deliberately NOT yet wired
   into Engine::meters(). Read the whole comment before using it.

   THE PROBLEM IT EXISTS FOR. `Meter::read()` walks four 751-bin histograms
   and two ring buffers to produce a `Meters`. In the plugin that walk
   happens on the MESSAGE thread (the editor's 30 Hz timer calls
   `latestMeters`) while `Meter::push()` is writing those same arrays from
   the AUDIO thread. That is a data race over roughly 1,500 doubles.

   WHY `std::atomic` PER FIELD IS THE WRONG FIX, and it is the first thing
   anyone reaches for. It would (a) put an atomic operation in the meter's
   innermost per-sample loop, on the audio thread, for no benefit, and
   (b) NOT ACTUALLY FIX ANYTHING: making each bin individually atomic still
   lets the reader observe bin 40 from before an update and bin 41 from
   after it. The result is a snapshot that never existed — internally
   inconsistent numbers that satisfy every atomic and still describe no
   real moment. Tearing here is about the SET, not the elements.

   THE SHAPE THAT WORKS. The audio thread computes the small `Meters` POD
   itself (it is the only thread that can do so consistently) and publishes
   it whole; the UI takes a copy. Three slots rotating, with the index
   published release/acquire, and the reader verifying the index did not
   move underneath it. Three rather than two because with two, a reader
   copying slot A can be overtaken by a writer that publishes B and then
   comes back around to A. With three, a reader is safe unless two full
   publishes land inside one struct copy — at ~100 publishes/second against
   a sub-microsecond copy, that is not a race that happens.

   The audio thread never blocks, never allocates, and never waits: publish
   is a copy and one release store. The reader may fail, and says so, so
   the caller can keep its last good frame rather than draw a torn one.

   TWO BUGS LIVED HERE, AND `tests/handoff_stress.cpp` found both. Neither
   is visible by reading the code, and no single-threaded harness can see
   either. This is the whole argument for that test existing.

   1. THE VERSION COUNTER MUST BE MONOTONIC. The first version published a
      SLOT INDEX (0,1,2) and had the reader verify the index had not moved.
      Textbook ABA: three publishes during one copy bring the index all the
      way around to where it started, so the reader's check sees the value
      it began with and returns a struct assembled from two different
      moments while every check agrees nothing changed. A counter that only
      increases cannot lie that way — three publishes take it `a` to `a+3`,
      the comparison fails, the reader retries.

   2. THE FENCE IS LOAD-BEARING, and this one was worse: swapping the index
      for a counter made tearing MUCH more frequent, not less, which is the
      opposite of what the fix predicted. An acquire load is a ONE-WAY
      barrier. It stops later operations from moving before it; it does
      nothing to stop the earlier struct copy from sinking AFTER it. So the
      compiler was free to schedule the copy after the verification read,
      and the verification then vouched for a copy that had not happened
      yet. `std::atomic_thread_fence(acquire)` between the copy and the
      check is what actually orders them. The counter change was necessary
      and insufficient, and only measurement distinguished those.

   The lesson worth keeping: a concurrency fix that makes the symptom worse
   is still information. Had this class been reasoned about rather than run,
   the counter would have shipped, looked principled, and been wrong.

   TO WIRE IT (needs a JUCE build to verify, which is why it is not done
   here): call `pub.publish(m)` at the end of `Engine::process()` after the
   existing meter update, and have `latestMeters` read from `pub` instead
   of calling `mtr.read()` on the message thread. `Engine::meters()` itself
   must keep its current direct behaviour, because the parity gate calls it
   single-threaded and expects exactly today's values. */
template <typename T>
class Handoff {
public:
    /* audio thread only, and only one of it */
    void publish(const T& v) {
        unsigned s = seq.load(std::memory_order_relaxed);
        slot[(s + 1) % 3] = v;
        seq.store(s + 1, std::memory_order_release);
    }
    /* any other thread. false means "publishes overtook the copy" — keep
       whatever you drew last; do NOT draw the half-copied value. */
    bool read(T& out) const {
        for (int tries = 0; tries < 8; ++tries) {
            unsigned a = seq.load(std::memory_order_acquire);
            out = slot[a % 3];
            /* NOT redundant with the acquire above — see note 2. Without
               this the copy is free to sink past the check below. */
            std::atomic_thread_fence(std::memory_order_acquire);
            if (seq.load(std::memory_order_relaxed) == a) return true;
        }
        return false;
    }
private:
    T slot[3] = {};
    std::atomic<unsigned> seq{0};
};

class Meter {
public:
    void init(double fs_) {
        fs = fs_;
        kc = kWeight(fs);
        subN = (int)std::floor(fs * 0.1 + 0.5);
        tos = designOversampler(METER_OS, OS_Q);
        thN = tos.histLen;
        thL.assign((size_t)thN, 0.0); thR.assign((size_t)thN, 0.0);
        rL.assign(30, 0.0); rR.assign(30, 0.0);
        hist.assign((size_t)NBINS, 0.0); histE.assign((size_t)NBINS, 0.0);
        histS.assign((size_t)NBINS, 0.0); histSE.assign((size_t)NBINS, 0.0);
        reset();
    }
    void reset() {
        subI = 0; accL = 0; accR = 0; rp = 0; filled = 0;
        for (int i = 0; i < NBINS; i++) { hist[(size_t)i] = 0; histE[(size_t)i] = 0;
                                          histS[(size_t)i] = 0; histSE[(size_t)i] = 0; }
        for (int i = 0; i < RING; i++) { rL[(size_t)i] = 0; rR[(size_t)i] = 0; }
        peak = 0; tp = 0;
        kl1.clear(); kl2.clear(); kr1.clear(); kr2.clear();
        for (int i = 0; i < thN; i++) { thL[(size_t)i] = 0; thR[(size_t)i] = 0; }
        thp = 0;
    }
    void push(double l, double r) {
        double a = l < 0 ? -l : l, b = r < 0 ? -r : r;
        if (a > peak) peak = a;
        if (b > peak) peak = b;
        thL[(size_t)thp] = l; thR[(size_t)thp] = r;
        thp = thp + 1 == thN ? 0 : thp + 1;
        for (int i = 0; i < METER_OS; i++) {
            double vl, vr;
            if (i == 0) {
                int z = thp - 1 - OS_Q; if (z < 0) z += thN;
                vl = thL[(size_t)z]; vr = thR[(size_t)z];
            } else { vl = tpPhase(thL, i); vr = tpPhase(thR, i); }
            if (vl < 0) vl = -vl;
            if (vr < 0) vr = -vr;
            if (vl > tp) tp = vl;
            if (vr > tp) tp = vr;
        }
        double wl = kl2.tick(kc.hp, kl1.tick(kc.shelf, l));
        double wr = kr2.tick(kc.hp, kr1.tick(kc.shelf, r));
        accL += wl * wl; accR += wr * wr;
        subI++;
        if (subI >= subN) {
            rL[(size_t)rp] = accL / subN; rR[(size_t)rp] = accR / subN;
            rp = rp + 1 == RING ? 0 : rp + 1;
            if (filled < RING) filled++;
            accL = 0; accR = 0; subI = 0;
            if (filled >= 4) {
                double bl = windowLoud(4);
                if (bl >= BIN_LO) {
                    int bi = (int)std::floor((bl - BIN_LO) / BIN_W);
                    if (bi >= NBINS) bi = NBINS - 1;
                    if (bi >= 0) { hist[(size_t)bi] += 1; histE[(size_t)bi] += nm::pow10_((bl + 0.691) / 10); }
                }
            }
            if (filled >= RING) {
                double sl2 = windowLoud(RING);
                if (sl2 >= BIN_LO) {
                    int si = (int)std::floor((sl2 - BIN_LO) / BIN_W);
                    if (si >= NBINS) si = NBINS - 1;
                    if (si >= 0) { histS[(size_t)si] += 1; histSE[(size_t)si] += nm::pow10_((sl2 + 0.691) / 10); }
                }
            }
        }
    }
    /* EBU Tech 3342 — a SECOND distribution, over short-term loudness,
       with a -20 LU relative gate (not -10). */
    /* The gate-and-percentile pass, extracted 2026-08-19 so lra() and
       histogramS() cannot drift apart — the same refactor the JS core got
       when THE RANGE was built, for the same reason. The arithmetic is
       moved, not changed: every operation is in its original order, and the
       parity gate (which covers lra at every metering case) is what proves
       that rather than my say-so. */
    struct ShortTermStats { double gate, p10, p95, lra; bool has10, has95; };
    ShortTermStats shortTermStats() const {
        ShortTermStats r { -std::numeric_limits<double>::infinity(), 0, 0, 0, false, false };
        int i; double sum = 0, cnt = 0;
        for (i = 0; i < NBINS; i++) {
            if (histS[(size_t)i] == 0) continue;
            sum += histSE[(size_t)i]; cnt += histS[(size_t)i];
        }
        if (cnt < 1) return r;
        double gate = loudnessOf(sum / cnt) - 20;
        r.gate = gate;
        double kept = 0;
        for (i = 0; i < NBINS; i++) {
            if (histS[(size_t)i] == 0) continue;
            if (BIN_LO + (i + 0.5) * BIN_W <= gate) continue;
            kept += histS[(size_t)i];
        }
        if (kept < 1) return r;
        double lo = kept * 0.10, hi = kept * 0.95;
        double run = 0, p10 = 0, p95 = 0;
        bool h10 = false, h95 = false;
        for (i = 0; i < NBINS; i++) {
            if (histS[(size_t)i] == 0) continue;
            double l = BIN_LO + (i + 0.5) * BIN_W;
            if (l <= gate) continue;
            run += histS[(size_t)i];
            if (!h10 && run >= lo) { p10 = l; h10 = true; }
            if (!h95 && run >= hi) { p95 = l; h95 = true; break; }
        }
        r.p10 = p10; r.p95 = p95; r.has10 = h10; r.has95 = h95;
        if (!h10 || !h95) return r;
        r.lra = p95 - p10;
        return r;
    }
    double lra() const { return shortTermStats().lra; }

    /* THE RANGE's data, mirrored into the twin 2026-08-19 — a deliberate
       reversal of the DIAGNOSTIC_ONLY decision recorded on 2026-08-18.
       The reasoning then was sound and is now outdated: histogramS existed
       only to feed a canvas in casket.html, and the JUCE editor drew its own
       meters, so mirroring it would have added parity surface with no
       guarantee attached. That held right up until the plugin's face wanted
       the same chart, at which point the choice became "mirror it" or "have
       two faces that disagree about what the program measures".
       Still not parity-gated, and that is still deliberate — it is a
       picture, not a sample. What IS gated is `lra`, the number this chart
       is drawn around, which both faces now compute through the same
       shortTermStats() above. */
    void histogramS(double* countsOut, double& gateOut,
                    double& p10Out, double& p95Out, double& lraOut) const {
        ShortTermStats st = shortTermStats();
        gateOut = st.gate; p10Out = st.p10; p95Out = st.p95; lraOut = st.lra;
        for (int i = 0; i < NBINS; i++) countsOut[i] = histS[(size_t)i];
    }
    void read(Meters& m) const {
        double sum = 0, cnt = 0;
        int i;
        for (i = 0; i < NBINS; i++) {
            if (hist[(size_t)i] == 0) continue;
            sum += histE[(size_t)i]; cnt += hist[(size_t)i];
        }
        double integ = -std::numeric_limits<double>::infinity();
        if (cnt > 0) {
            double g2 = loudnessOf(sum / cnt) - 10;
            double sum2 = 0, cnt2 = 0;
            for (i = 0; i < NBINS; i++) {
                if (hist[(size_t)i] == 0) continue;
                double l = BIN_LO + (i + 0.5) * BIN_W;
                if (l <= g2) continue;
                sum2 += histE[(size_t)i]; cnt2 += hist[(size_t)i];
            }
            if (cnt2 > 0) integ = loudnessOf(sum2 / cnt2);
        }
        m.momentary = windowLoud(4);
        m.shortTerm = windowLoud(30);
        m.integrated = integ;
        m.lra = lra();
        m.peakDb = nd::linToDb(peak);
        m.truePeakDb = nd::linToDb(tp);
        m.peak = peak; m.truePeak = tp;
    }
private:
    static const int RING = 30;
    double tpPhase(const std::vector<double>& h, int ph) const {
        const std::vector<double>& taps = tos.phases[(size_t)ph];
        double s = 0;
        int idx = thp - 1;
        for (size_t j = 0; j < taps.size(); j++) {
            if (idx < 0) idx += thN;
            s += taps[j] * h[(size_t)idx];
            idx--;
        }
        return s;
    }
    double windowLoud(int k) const {
        if (filled < k) k = filled;
        if (k <= 0) return -std::numeric_limits<double>::infinity();
        double zl = 0, zr = 0;
        for (int i = 0; i < k; i++) {
            int p = rp - 1 - i; while (p < 0) p += RING;
            zl += rL[(size_t)p]; zr += rR[(size_t)p];
        }
        return loudnessOf(zl / k + zr / k);
    }
    double fs = 48000;
    KWeight kc;
    nd::Biquad kl1, kl2, kr1, kr2;
    int subN = 4800, subI = 0, rp = 0, filled = 0, thN = 1, thp = 0;
    double accL = 0, accR = 0, peak = 0, tp = 0;
    std::vector<double> rL, rR, hist, histE, histS, histSE, thL, thR;
    Oversampler tos;
};

/* ============================================================
   THE ENGINE
   ============================================================ */
class Engine {
public:
    void prepare(double fs_) {
        fs = fs_;
        first = true;
        st = State();
        mtr.init(fs);
        dcL.init(5, fs); dcR.init(5, fs);
        applyTargets();
        rebuild();
        snapAll();
        control();
    }

    void setState(const State& s) {
        State prev = st;
        st = sanitize(s);
        bool structural = first ||
            st.lining != prev.lining || st.vigil != prev.vigil ||
            st.style != prev.style || st.dustSeed != prev.dustSeed;
        applyTargets();
        if (structural) rebuild();
        if (first) { snapAll(); first = false; }
        control();
    }

    void reset() {
        rebuild();
        mtr.reset();
        grNow = 0; grPeak = 0;
        clampWorst = 0; clampHits = 0;
        snapAll();
        control();
    }

    int latency() const { return lat; }
    double gr() const { return grNow; }
    /* AUDIO THREAD (or single-threaded harness) ONLY — audited 2026-08-18.
       clampWorst/clampHits are plain doubles/longs written per-sample in
       process(); this accessor is not snapshot-published the way meters()
       now is. That is a decision, not an oversight: nothing in the plugin
       calls it (verified — zero references in PluginProcessor/PluginEditor),
       its only callers are the JS side's _debug() twin-of-convenience and
       single-threaded harnesses, and making it thread-safe would put an
       atomic in the innermost sample loop to protect a diagnostic nobody
       reads live. If an editor ever wants this number, route it through
       the Meters snapshot instead of calling this cross-thread. */
    double getClampWorst() const { return clampWorst; }

    void meters(Meters& m) {
        mtr.read(m);
        m.gr = grNow; m.grPeak = grPeak; m.latency = lat;
    }
    /* THE RANGE's snapshot. Cheap enough for the audio thread — a copy of
       751 doubles and one gate pass, alongside the meter read already
       happening there — but the editor only redraws it at 30 Hz, so the
       processor throttles the call rather than making it every block. */
    void histogram(Hist& h) {
        mtr.histogramS(h.counts, h.gate, h.p10, h.p95, h.lra);
        h.any = false;
        for (int i = 0; i < 751; i++) if (h.counts[i] != 0) { h.any = true; break; }
    }
    /* READ AND RESET. Deliberately not folded into meters(): a read with
       a side effect surprises everybody eventually. */
    void trace(Trace& t) {
        t.inPeak = tIn; t.outPeak = tOut; t.gr = tGr;
        t.inPeakDb = nd::linToDb(tIn); t.outPeakDb = nd::linToDb(tOut);
        tIn = 0; tOut = 0; tGr = 0;
    }
    void resetMeters() { mtr.reset(); grPeak = 0; tIn = 0; tOut = 0; tGr = 0; }

    void process(const double* inL, const double* inR, double* outL, double* outR, int n) {
        int pos = 0;
        while (pos < n) {
            if (ctrlPhase == 0) control();
            int end = pos + (CTRL - ctrlPhase); if (end > n) end = n;
            for (int s = pos; s < end; s++) {
                double xl = inL[s], xr = inR[s];
                /* the input trace, taken before ANYTHING — including drive
                   and bypass — because "what arrived" is the one thing no
                   other meter in this core can tell you */
                double tl = xl < 0 ? -xl : xl, tr = xr < 0 ? -xr : xr;
                if (tl > tIn) tIn = tl;
                if (tr > tIn) tIn = tr;
                /* always pushed — see the note at bypL's declaration */
                double byl = bypL.push(xl), byr = bypR.push(xr);
                if (st.bypass) {
                    outL[s] = byl; outR[s] = byr;
                    grNow = 0;
                    double bl2 = byl < 0 ? -byl : byl, br2 = byr < 0 ? -byr : byr;
                    if (bl2 > tOut) tOut = bl2;
                    if (br2 > tOut) tOut = br2;
                    mtr.push(byl, byr);
                    continue;
                }
                if (driveLin != 1) { xl *= driveLin; xr *= driveLin; }
                if (st.dc) { xl = dcL.tick(xl); xr = dcR.tick(xr); }
                /* M/S pre-stage — short-circuits at unity so arming it
                   with nothing dialled in cannot cost a bit */
                if (msOn && !(msMidLin == 1 && msSideLin == 1)) {
                    double mm = (xl + xr) * 0.5, ss = (xl - xr) * 0.5;
                    mm *= msMidLin; ss *= msSideLin;
                    xl = mm + ss; xr = mm - ss;
                }
                if (pSatC < 1) { xl = nd::softClip(xl, pSatC); xr = nd::softClip(xr, pSatC); }

                double dl = delL.push(xl), dr = delR.push(xr);

                histL[(size_t)hp] = xl; histR[(size_t)hp] = xr;
                hp = hp + 1 == histN ? 0 : hp + 1;

                double gStepL = 0, gStepR = 0;
                for (int i = 0; i < M; i++) {
                    double sl, sr;
                    if (i == 0) {
                        int z = hp - 1 - OS_Q; if (z < 0) z += histN;
                        sl = histL[(size_t)z]; sr = histR[(size_t)z];
                    } else {
                        sl = phase(histL, i); sr = phase(histR, i);
                    }
                    double al = sl < 0 ? -sl : sl, ar = sr < 0 ? -sr : sr;
                    double gl = requiredGr(al), gr2 = requiredGr(ar);
                    double mn = gl < gr2 ? gl : gr2;
                    double ll = linkA * mn + linkB * gl;
                    double lr = linkA * mn + linkB * gr2;
                    double bl = boxL2.push(boxL1.push(sminL.push(tickL(ll))));
                    double br = boxR2.push(boxR1.push(sminR.push(tickR(lr))));
                    if (sealOn) {
                        int nx = xw + 1 == xn ? 0 : xw + 1;
                        double oldL = x4L[(size_t)nx], oldR = x4R[(size_t)nx];
                        x4L[(size_t)xw] = sl; x4R[(size_t)xw] = sr;
                        xw = nx;
                        y4L[(size_t)yw] = oldL * (bl == 0 ? 1 : nd::dbToLin(bl));
                        y4R[(size_t)yw] = oldR * (br == 0 ? 1 : nd::dbToLin(br));
                        yw = yw + 1 == yn ? 0 : yw + 1;
                        if (bl < gStepL) gStepL = bl;
                        if (br < gStepR) gStepR = br;
                    } else {
                        ringL[(size_t)rp] = bl; ringR[(size_t)rp] = br;
                        rp = rp + 1 == ringN ? 0 : rp + 1;
                    }
                }

                double yl, yr;
                if (sealOn) {
                    int idx = yw - M; if (idx < 0) idx += yn;
                    double F1 = 0, F2 = 0;
                    for (int k3 = 0; k3 < decLen; k3++) {
                        double tp3 = dec.taps[(size_t)k3];
                        F1 += tp3 * y4L[(size_t)idx];
                        F2 += tp3 * y4R[(size_t)idx];
                        idx = idx == 0 ? yn - 1 : idx - 1;
                    }
                    yl = F1; yr = F2;
                    grNow = gStepL < gStepR ? gStepL : gStepR;
                } else {
                    double gL = ringL[0], gR = ringR[0];
                    for (int k2 = 1; k2 < ringN; k2++) {
                        if (ringL[(size_t)k2] < gL) gL = ringL[(size_t)k2];
                        if (ringR[(size_t)k2] < gR) gR = ringR[(size_t)k2];
                    }
                    grNow = gL < gR ? gL : gR;
                    yl = dl * (gL == 0 ? 1 : nd::dbToLin(gL));
                    yr = dr * (gR == 0 ? 1 : nd::dbToLin(gR));
                }
                if (grNow < grPeak) grPeak = grNow.load(std::memory_order_relaxed);
                if (yl > lidLin || yl < -lidLin) {
                    double ex = (yl < 0 ? -yl : yl) / lidLin - 1;
                    if (ex > clampWorst) clampWorst = ex;
                    clampHits++;
                    yl = yl < 0 ? -lidLin : lidLin;
                }
                if (yr > lidLin || yr < -lidLin) {
                    double ex2 = (yr < 0 ? -yr : yr) / lidLin - 1;
                    if (ex2 > clampWorst) clampWorst = ex2;
                    clampHits++;
                    yr = yr < 0 ? -lidLin : lidLin;
                }
                if (unityLin != 1) { yl *= unityLin; yr *= unityLin; }
                if (dustOn) { yl = dither(yl, false); yr = dither(yr, true); }
                outL[s] = yl; outR[s] = yr;
                double ol = yl < 0 ? -yl : yl, orr = yr < 0 ? -yr : yr;
                if (ol > tOut) tOut = ol;
                if (orr > tOut) tOut = orr;
                if (grNow < tGr) tGr = grNow.load(std::memory_order_relaxed);
                mtr.push(yl, yr);
            }
            ctrlPhase += end - pos;
            if (ctrlPhase >= CTRL) ctrlPhase = 0;
            pos = end;
        }
    }

private:
    void rebuild() {
        M = st.lining;
        Lb = vigilSamples(st, fs);
        sealOn = st.seal;
        lat = OS_Q + Lb + 1 + (sealOn ? DEC_Q : 0);
        relShape = styleDef(st.style).relShape;
        os = designOversampler(M, OS_Q);
        histN = os.histLen;
        histL.assign((size_t)histN, 0.0); histR.assign((size_t)histN, 0.0); hp = 0;
        delL.init(lat); delR.init(lat);
        bypL.init(lat); bypR.init(lat);
        W = M * (Lb + 1) + 1;
        sminL.init(W, 0); sminR.init(W, 0);
        B = boxLen(st, fs);
        boxL1.init(B, 0); boxL2.init(B, 0);
        boxR1.init(B, 0); boxR2.init(B, 0);
        ringN = 2 * M - 1;
        ringL.assign((size_t)ringN, 0.0); ringR.assign((size_t)ringN, 0.0); rp = 0;
        if (sealOn) {
            dec = designDecimator(M, DEC_Q, DEC_CUT);
            decLen = dec.len;
            xn = W; x4L.assign((size_t)xn, 0.0); x4R.assign((size_t)xn, 0.0); xw = 0;
            yn = decLen + M; y4L.assign((size_t)yn, 0.0); y4R.assign((size_t)yn, 0.0); yw = 0;
        } else {
            decLen = 1; xn = yn = 1;
            x4L.clear(); x4R.clear(); y4L.clear(); y4R.clear(); xw = yw = 0;
        }
        envLf = envLs = envRf = envRs = 0; holdL = holdR = 0;
        ctrlPhase = 0;
        e1 = e2 = e1r = e2r = 0;
        dcL.clear(); dcR.clear();
        dustRand.reset(st.dustSeed);
    }

    void applyTargets() {
        /* Shaped dither feeds its own error back (f = 2*e1 - e2, each e
           bounded by 1.5 LSB), so it can excurse ~6 LSB, not 2. The
           fuzzer found this; see the JS twin for the measurement. */
        double lsb = nm::pow10_((1 - st.dustBits) * nm::log10_(2));
        double trimLsb = st.dust == DUST_SHAPED ? 6 : 2;
        double dustTrim = st.dust == DUST_OFF ? 0 : 20 * nm::log10_(1 - trimLsb * lsb);
        pTt = st.lid + st.margin + dustTrim;
        pWt = st.knee;
        pDt = st.drive;
        pLt = st.link / 100;
        pSt = 1 - (st.sat / 100) * 0.6;
        dustOn = st.dust != DUST_OFF;
        dustShape = st.dust == DUST_SHAPED;
        dustLsb = lsb;
    }

    static void smooth1(double& c, double t) {
        double n = c + (t - c) * SMOOTH;
        c = std::fabs(t - n) < SNAP ? t : n;
    }
    void snapAll() { pTc = pTt; pWc = pWt; pDc = pDt; pLc = pLt; pSatC = pSt; }

    void control() {
        /* The threshold tightens instantly and loosens smoothly — see the
           JS twin. A smoothed threshold lags a downward lid automation and
           lets the output sit above the ceiling just requested. */
        if (pTt < pTc) pTc = pTt; else smooth1(pTc, pTt);
        smooth1(pWc, pWt); smooth1(pDc, pDt);
        smooth1(pLc, pLt); smooth1(pSatC, pSt);
        Tdb = pTc; Wdb = pWc;
        driveLin = pDc == 0 ? 1 : nd::dbToLin(pDc);
        unityLin = (st.unity && pDc > 0) ? nd::dbToLin(-pDc) : 1;
        kneeStartLin = nd::dbToLin(Tdb - Wdb / 2);
        lidLin = nd::dbToLin(Tdb);
        trueLidLin = nd::dbToLin(st.lid + st.margin);
        dustCeil = dustLsb > 0 ? std::floor(trueLidLin / dustLsb) * dustLsb : trueLidLin;
        linkA = pLc; linkB = 1 - pLc;
        msOn = st.ms;
        msMidLin = st.msMid == 0 ? 1 : nd::dbToLin(st.msMid);
        msSideLin = st.msSide == 0 ? 1 : nd::dbToLin(st.msSide);
        cF = nd::onePole(st.release, fs);
        cS = nd::onePole(st.release * 8, fs);
        stepF = 20 / (st.release * 0.001 * fs);
        stepS = stepF / 8;
        holdN = (int)std::floor(st.hold * 0.001 * fs + 0.5);
        autoRel = st.autoRel;
    }

    double requiredGr(double a) const {
        if (a <= kneeStartLin) return 0;
        return nd::kneeGain(nd::linToDb(a), Tdb, Wdb, 0);
    }

    double advance(double e, double g, double c, double step) const {
        double n = relShape == 1 ? e + step : e * c;
        if (n > g) n = g;
        if (g == 0 && n > -1e-12) return 0;
        return n;
    }

    double tickL(double g) {
        if (g <= envLf) { envLf = g; holdL = holdN; }
        else if (holdL > 0) { holdL--; }
        else { envLf = advance(envLf, g, cF, stepF); }
        if (!autoRel) { envLs = envLf; return envLf; }
        if (g <= envLs) envLs = g;
        else if (holdL <= 0) envLs = advance(envLs, g, cS, stepS);
        double d = envLf - envLs; if (d < 0) d = -d;
        double w = nd::blend(d, 3);
        return w * envLf + (1 - w) * envLs;
    }
    double tickR(double g) {
        if (g <= envRf) { envRf = g; holdR = holdN; }
        else if (holdR > 0) { holdR--; }
        else { envRf = advance(envRf, g, cF, stepF); }
        if (!autoRel) { envRs = envRf; return envRf; }
        if (g <= envRs) envRs = g;
        else if (holdR <= 0) envRs = advance(envRs, g, cS, stepS);
        double d = envRf - envRs; if (d < 0) d = -d;
        double w = nd::blend(d, 3);
        return w * envRf + (1 - w) * envRs;
    }

    double phase(const std::vector<double>& h, int ph) const {
        const std::vector<double>& taps = os.phases[(size_t)ph];
        double s = 0;
        int idx = hp - 1;
        for (size_t j = 0; j < taps.size(); j++) {
            if (idx < 0) idx += histN;
            s += taps[j] * h[(size_t)idx];
            idx--;
        }
        return s;
    }

    double dither(double x, bool isR) {
        double f = dustShape ? (isR ? 2 * e1r - e2r : 2 * e1 - e2) : 0;
        double v = x - f;
        double d = (dustRand.next() - dustRand.next()) * dustLsb;
        double w2 = v + d;
        double q = std::floor(w2 / dustLsb + 0.5) * dustLsb;
        if (q > dustCeil) q = dustCeil;
        else if (q < -dustCeil) q = -dustCeil;
        if (dustShape) {
            double er = q - v;
            if (isR) { e2r = e1r; e1r = er; } else { e2 = e1; e1 = er; }
        }
        return q;
    }

    double fs = 48000;
    State st;
    bool first = true;
    Oversampler os;
    int M = 1, Lb = 0, W = 1, B = 1, histN = 1, hp = 0, ringN = 1, rp = 0;
    /* `lat` IS CROSS-THREAD, unlike its neighbours above — split out of that
       group 2026-08-18 so the difference is visible rather than buried in a
       comma list. It is written on the audio thread by rebuild() and read on
       the message thread through meters() (the editor prints it).
       An aligned int does not tear on any platform CASKET targets, so this
       was never going to corrupt a reading — the worst real symptom is the
       editor showing a one-frame-stale number, which is cosmetic. It is
       still formally a data race, relaxed atomics cost literally nothing
       here (same mov instruction), and leaving a known race in place because
       today's hardware forgives it is how a project ends up unable to run a
       thread sanitiser without wading through noise.
       Relaxed is the right ordering: this value guards nothing else, so
       there is no ordering to establish — only the read itself must be
       well-defined. NOTE the host's OWN latency does not come through here;
       PluginProcessor::refreshLatency() calls the pure latencySamples()
       instead, which is why this was never a correctness problem for the DAW. */
    std::atomic<int> lat{0};
    int relShape = 0;
    /* control-block phase carried ACROSS process() calls, so control()
       fires every CTRL samples of stream time rather than of call time.
       Without it the output of a parameter glide depends on the host's
       buffer size — measured -37 dB of divergence. See the JS twin. */
    int ctrlPhase = 0;
    bool sealOn = false;
    Decimator dec;
    int decLen = 1, xn = 1, xw = 0, yn = 1, yw = 0;
    std::vector<double> x4L, x4R, y4L, y4R;
    std::vector<double> histL, histR, ringL, ringR;
    nd::Delay delL, delR;
    nd::SlidingMin sminL, sminR;
    nd::Boxcar boxL1, boxL2, boxR1, boxR2;
    nd::DcBlocker dcL, dcR;

    double pTt = 0, pTc = 0, pWt = 0, pWc = 0, pDt = 0, pDc = 0;
    double pLt = 1, pLc = 1, pSt = 1, pSatC = 1;
    double driveLin = 1, unityLin = 1, kneeStartLin = 0, Tdb = 0, Wdb = 0, lidLin = 1;
    double trueLidLin = 1, dustCeil = 1;
    bool msOn = false;
    double msMidLin = 1, msSideLin = 1;
    double clampWorst = 0;
    long long clampHits = 0;
    double linkA = 1, linkB = 0;
    double cF = 0, cS = 0, stepF = 0, stepS = 0;
    int holdN = 0;
    bool autoRel = false;
    bool dustOn = false, dustShape = false;
    double dustLsb = 0;
    nd::Lcg dustRand{1848};
    double e1 = 0, e2 = 0, e1r = 0, e2r = 0;

    double envLf = 0, envLs = 0, envRf = 0, envRs = 0;
    int holdL = 0, holdR = 0;
    Meter mtr;
    /* ATOMIC — added 2026-08-18. These five are written every sample on the
       AUDIO thread (inside process(), below) and read on the MESSAGE thread
       by PluginEditor's 30 Hz timer via meters()/trace(). Plain double was
       an unsynchronised cross-thread read-modify-write with no lock and no
       atomics — undefined behaviour by the letter of the standard, and a
       plausible contributor to pluginval's exit-9 crash at strictness 10
       (which runs the editor's timer and the audio thread genuinely
       concurrently, --validate-in-process, and is exactly the kind of
       timing stress that makes a data race surface). relaxed ordering is
       enough: nothing else depends on these being ordered against other
       memory, only on the load/store itself not tearing.
       NOT extended to Meter (mtr) in this pass — its internal state (the
       LUFS histograms, the K-weighting filter chain, the oversampler
       history ring) is large and mutually-dependent, and a correct fix
       there is a proper snapshot/double-buffer, not per-field atomics.
       That is real remaining work, flagged rather than rushed, since nei-
       ther a JUCE toolchain nor pluginval exists in this sandbox to verify
       a bigger change against. See IN_THE_LINING_Report.html. */
    std::atomic<double> grNow{0}, grPeak{0};
    std::atomic<double> tIn{0}, tOut{0}, tGr{0};   /* the trace — reset on read */

    /* THE BYPASS DELAY — latency-compensated bypass.
       Bypass used to pass audio through with ZERO delay while
       latencySamples() reported the full figure, so a host compensating by
       the reported number moved the audio 113 samples EARLIER at 48 k the
       moment you toggled it. Two and a third milliseconds — enough to comb
       against a parallel path and enough to read as a tone change. An A/B
       whose two sides are not time-aligned is not an A/B.
       Pushed on EVERY sample so toggling mid-stream finds it primed. */
    nd::Delay bypL, bypR;
};

/* ============================================================
   THE OFFLINE TOOLS — the C++ twin of casket_core.js's analysis layer
   ============================================================
   These have lived only in JavaScript for four rounds, which meant the
   browser could master a record and the plugin could not. Everything here
   mirrors the JS byte for byte: the same bisection order, the same rail
   probes, the same quantisation expression, the same verification pass.
   `tests/core_parity.cpp` checks them against JS truth values, because a
   port that is merely "equivalent" is a port that drifts.

   Nothing here runs on the audio thread and nothing here allocates in
   `Engine::process`. They are allowed to be slow; they are not allowed to
   be different.  */

struct Offline {
    std::vector<double> L, R;
    Meters meters;
    int latency = 0;
};

/* Meter a buffer that has ALREADY been rendered. Separate from the engine's
   own meter on purpose: the engine meters what it produced INCLUDING the
   latency pad, and metering the trimmed buffer is what removed the
   systematic 1.5e-3 LU bias. */
inline Meters meterBuffer(const double* L, const double* R, int n, double fs) {
    Meter mt;
    mt.init(fs);
    for (int i = 0; i < n; i++) mt.push(L[i], R[i]);
    Meters m{};
    mt.read(m);
    return m;
}

inline Offline renderOffline(const State& state, const double* inL, const double* inR,
                             int n, double fs) {
    State st = sanitize(state);
    int lat = latencySamples(st, fs);
    int N = n + lat;
    std::vector<double> dL((size_t)N, 0.0), dR((size_t)N, 0.0);
    for (int i = 0; i < n; i++) { dL[(size_t)i] = inL[i]; dR[(size_t)i] = inR[i]; }
    Engine e;
    e.prepare(fs);
    e.setState(st);
    std::vector<double> oL((size_t)N, 0.0), oR((size_t)N, 0.0);
    e.process(dL.data(), dR.data(), oL.data(), oR.data(), N);
    Offline r;
    r.L.assign(oL.begin() + lat, oL.begin() + lat + n);
    r.R.assign(oR.begin() + lat, oR.begin() + lat + n);
    r.meters = meterBuffer(r.L.data(), r.R.data(), n, fs);
    Meters eng{};
    e.meters(eng);
    r.meters.gr = eng.gr;
    r.meters.grPeak = eng.grPeak;
    r.meters.latency = lat;
    r.latency = lat;
    return r;
}

/* The independent reconstruction autoMargin checks its own work with —
   deliberately denser than the live meter's, so it is a check rather than
   the same code marking its own homework. */
inline double truePeakOf(const double* buf, int n, int factor, int skip) {
    int m = factor ? factor : 16;
    Oversampler o = designOversampler(m, 32);
    int histN2 = o.histLen;
    int sk = skip;
    std::vector<double> h((size_t)histN2, 0.0);
    int p = 0;
    double mx = 0;
    for (int s = 0; s < n; s++) {
        h[(size_t)p] = buf[s];
        p = (p + 1 == histN2) ? 0 : p + 1;
        if (s < sk + 32 || s >= n - sk) continue;
        for (int i = 0; i < m; i++) {
            double v;
            if (i == 0) {
                int z = p - 1 - 32; if (z < 0) z += histN2;
                v = h[(size_t)z];
            } else {
                const std::vector<double>& taps = o.phases[(size_t)i];
                double acc = 0;
                int idx = p - 1;
                for (size_t j = 0; j < taps.size(); j++) {
                    if (idx < 0) idx += histN2;
                    acc += taps[j] * h[(size_t)idx];
                    idx--;
                }
                v = acc;
            }
            if (v < 0) v = -v;
            if (v > mx) mx = v;
        }
    }
    return mx;
}

/* QUANTISE A CONTROL TO ITS GRID — the twin of casket_core.js's quantize().
   Named rather than inline because the two obvious spellings are not the
   same function: round(x/g)*g and round(x*(1/g))/(1/g) disagree at exact
   halves and in the last bits elsewhere, and bisection midpoints land on
   exact halves regularly. While this was inline the parity gate could not
   see the difference — swapping one form for the other passed all 22,848
   checks. Naming it is what made it gateable.
   std::floor(v + 0.5) rather than std::round: std::round rounds halves
   AWAY from zero, JS Math.round rounds them toward +Infinity, and they
   disagree on every negative half. */
inline double quantize(double x, double grid) {
    double g = (grid > 0) ? grid : 0.1;
    double inv = 1.0 / g;
    return std::floor(x * inv + 0.5) / inv;
}

struct DriveResult {
    double drive = 0, lufs = 0, truePeak = 0, gr = 0;
    double target = 0, error = 0, grid = 0.1;
    bool reached = false;
};

/* CANONICALISE THE BISECTION BRANCH — added 2026-08-18, LAW-5 shape, mirrors
   the identical comment and fix in casket_core.js's autoDrive. -O3 can
   reorder the summation inside renderOffline's LUFS gate (auto-vectorisation
   is legal even under -ffp-contract=off, which only forbids FMA fusion) and
   return a value that differs from -O0/-O2 by about one ulp — enough to flip
   a bisection branch and send the search into a different half of the range.
   Rounding to 1e-9 LU before branching absorbs that noise (nine orders of
   magnitude coarser than the ~1e-15 relative noise, eight orders tighter
   than the 0.1 LU this function already calls "reached") without touching
   the exact values this function returns.

   CORRECTED 2026-08-21, AFTER THE FIRST CI RUN ON x86-64. This fix did not
   hold, and the two claims above that justify it are both wrong.

   The "~1e-15 relative" figure: CI's -O3 log reports residuals of 19,212 and
   34,148 ulp, which is ~1e-11 relative. canon9 clears the real noise floor
   by roughly 30x, not by nine orders of magnitude.

   The "auto-vectorisation" mechanism: `g++ -O3 -Q --help=optimizers` reports
   -fassociative-math DISABLED at -O3, and GCC will not reassociate a
   floating-point reduction without it. The named cause therefore cannot be
   what is happening. It was never measured — it was inferred, and a fix was
   built on the inference.

   What IS measured, by tests/autodrive_probe.cpp: the -O3 twin's lufs for
   [noise][pine], [noise][lead] and [sine][pine] equals, to all 17 digits,
   the LUFS at drive exactly -9.75 — the last bisection midpoint, UNQUANTISED.
   quantize(-9.75, 0.1) is floor(-97.5 + 0.5)/10 = -9.7 here and in the JS,
   so a flipped comparison alone cannot produce it; a flipped branch still
   passes through the quantiser. Reproducing all three values in the JS twin
   needs TWO injected faults: a lo-rail probe that never registers, and a
   quantise that never runs.

   Separately, the rail[6] residual is a divergence in renderOffline's own
   `integrated` at a FIXED drive of 24. That is a render that is not
   reproducible at -O3, which no amount of desensitising a comparison can
   reach. canon9 was aimed at the wrong layer for that half.

   Keep canon9 anyway — a branch that turns on the last bits of a long
   summation deserves a guard — but treat the paragraph above it as a
   hypothesis that failed, not as the explanation. */
inline double canon9(double x) { return std::round(x * 1e9) / 1e9; }

inline DriveResult autoDrive(const State& state, const double* inL, const double* inR,
                             int n, double fs, double targetLufs,
                             int iters = 9, double step = 0.1) {
    double lo = -12, hi = 24;
    bool have = false;
    double bestDrive = 0, bestLufs = 0;
    int passes = iters ? iters : 9;
    /* inv rather than dividing by the grid: Math.round(x/0.1)*0.1 and
       Math.round(x*10)/10 disagree at exact halves. The JS uses the
       *10/10 form, so this must too, or the twins quantise differently
       and the parity gate — correctly — refuses them. */
    double grid = (step > 0) ? step : 0.1;
    double inv = 1.0 / grid;
    double targetC = canon9(targetLufs);

    struct LufsAt {
        const State& state; const double* inL; const double* inR; int n; double fs;
        double operator()(double d) const {
            State s = sanitize(state);
            s.drive = d;
            s.unity = false;
            return renderOffline(s, inL, inR, n, fs).meters.integrated;
        }
    } lufsAt{state, inL, inR, n, fs};

    auto consider = [&](double d, double got) {
        if (!std::isfinite(got)) return;
        if (!have || std::fabs(canon9(got) - targetC) < std::fabs(canon9(bestLufs) - targetC)) {
            have = true; bestDrive = d; bestLufs = got;
        }
    };
    /* the rails first — bisection computes midpoints and never visits its
       own endpoints, so without these it cannot return a boundary answer */
    consider(lo, lufsAt(lo));
    consider(hi, lufsAt(hi));
    for (int k = 0; k < passes; k++) {
        double mid = (lo + hi) / 2;
        double got = lufsAt(mid);
        if (!std::isfinite(got)) { lo = mid; continue; }
        consider(mid, got);
        if (canon9(got) < targetC) lo = mid; else hi = mid;
    }
    DriveResult out;
    out.target = targetLufs;
    out.grid = grid;
    if (!have) {
        out.drive = 0;
        out.lufs = -std::numeric_limits<double>::infinity();
        out.truePeak = -std::numeric_limits<double>::infinity();
        out.gr = 0;
        out.error = std::numeric_limits<double>::infinity();
        out.reached = false;
        return out;
    }
    double drive = nd::clamp(quantize(bestDrive, grid), -12.0, 24.0);
    State vs = sanitize(state);
    vs.drive = drive;
    vs.unity = false;
    Meters v = renderOffline(vs, inL, inR, n, fs).meters;
    double err = std::isfinite(v.integrated)
                   ? v.integrated - targetLufs
                   : std::numeric_limits<double>::infinity();
    out.drive = drive;
    out.lufs = v.integrated;
    out.truePeak = v.truePeakDb;
    out.gr = v.grPeak;
    out.error = err;
    out.reached = std::isfinite(err) && std::fabs(err) <= 0.1;
    return out;
}

struct MarginResult {
    double truePeak = 0, verifiedPeak = 0, lid = 0, residual = 0, margin = 0;
    bool covered = false;
};

inline MarginResult autoMargin(const State& state, const double* inL, const double* inR,
                               int n, double fs, int passes = 4) {
    State probe = sanitize(state);
    auto peakAt = [&](double margin) {
        State p = sanitize(state);
        p.margin = margin;
        Offline r = renderOffline(p, inL, inR, n, fs);
        double a = nd::linToDb(truePeakOf(r.L.data(), n, 16, 64));
        double b = nd::linToDb(truePeakOf(r.R.data(), n, 16, 64));
        return a > b ? a : b;
    };
    double tp0 = peakAt(0);
    double lid = probe.lid;
    double margin = 0, tp = tp0;
    int np = passes ? passes : 4;
    for (int k = 0; k < np; k++) {
        double over = tp - lid;
        if (over <= 0) break;
        double step = std::ceil(over / 0.05) * 0.05;
        double next = nd::clamp(margin - step, -1.0, 0.0);
        if (next == margin) break;
        margin = next;
        tp = peakAt(margin);
    }
    MarginResult out;
    out.truePeak = tp0;
    out.verifiedPeak = tp;
    out.lid = lid;
    out.residual = tp0 - lid;
    out.margin = margin;
    out.covered = tp <= lid + 1e-6;
    return out;
}

struct DiffResult {
    std::vector<double> L, R;
    double peakDb = 0, rmsDb = 0;
    bool identical = false;
    int latencyA = 0, latencyB = 0;
};

inline DiffResult difference(const State& a_, const State& b_,
                             const double* inL, const double* inR, int n, double fs) {
    Offline a = renderOffline(a_, inL, inR, n, fs);
    Offline b = renderOffline(b_, inL, inR, n, fs);
    DiffResult d;
    d.L.assign((size_t)n, 0.0); d.R.assign((size_t)n, 0.0);
    double peak = 0, sum = 0;
    for (int i = 0; i < n; i++) {
        d.L[(size_t)i] = a.L[(size_t)i] - b.L[(size_t)i];
        d.R[(size_t)i] = a.R[(size_t)i] - b.R[(size_t)i];
        double m = std::fabs(d.L[(size_t)i]); if (m > peak) peak = m;
        m = std::fabs(d.R[(size_t)i]); if (m > peak) peak = m;
        sum += d.L[(size_t)i] * d.L[(size_t)i] + d.R[(size_t)i] * d.R[(size_t)i];
    }
    d.peakDb = nd::linToDb(peak);
    d.rmsDb = nd::linToDb(std::sqrt(sum / (2.0 * n)));
    d.identical = (peak == 0);
    d.latencyA = a.latency;
    d.latencyB = b.latency;
    return d;
}

} // namespace casket

namespace casket {

/* ---------- deterministic test signals (mirror the JS exactly) ---------- */
inline void makeNoise(std::uint32_t seed, int n, std::vector<double>& out) {
    nd::Lcg r(seed);
    out.assign((size_t)n, 0.0);
    for (int i = 0; i < n; i++) out[(size_t)i] = r.next() * 2 - 1;
}
inline void makeSine(double freq, double fs, int n, double amp, std::vector<double>& out) {
    out.assign((size_t)n, 0.0);
    double w = 2 * M_PI * freq / fs;
    for (int i = 0; i < n; i++) out[(size_t)i] = amp * nm::sin_(w * i);
}

} // namespace casket
