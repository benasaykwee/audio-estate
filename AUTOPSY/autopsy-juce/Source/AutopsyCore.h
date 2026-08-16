/* ============================================================
   AUTOPSY — AutopsyCore.h
   C++ parity port of autopsy_core.js (the single source of truth).
   RULE: this file follows the JS core, never leads it. Any change
   lands in autopsy_core.js first, then is mirrored here and proven
   by tests/core_parity.cpp.
   Doubles everywhere. Order of operations matches the JS exactly,
   including the shared `dirty` flag quirk in control().
   ============================================================ */
#pragma once
#include <cmath>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>
#include "../../../shared/necromath.h"

namespace autopsy {

static const char* VERSION = "0.4";
static const int MAX_BANDS = 12;
static const int MAX_SECTIONS = 4; // slope 48 = 4 cascaded biquads
static const int CTRL = 32;
static const double SMOOTH = 0.25;
static const double SNAP = 1e-6;

enum BandType { BELL = 0, LOWSHELF, HIGHSHELF, LOWCUT, HIGHCUT, NOTCH, BANDPASS, TILT, NUM_TYPES };
static const char* TYPE_NAMES[NUM_TYPES] = { "bell", "lowshelf", "highshelf", "lowcut", "highcut", "notch", "bandpass", "tilt" };
enum Place { P_ST = 0, P_L, P_R, P_M, P_S, NUM_PLACES };
static const char* PLACE_NAMES[NUM_PLACES] = { "stereo", "left", "right", "mid", "side" };
static const int SLOPES[6] = { 6, 12, 18, 24, 36, 48 };

/* necromath lives in shared/necromath.h — included above. */

/* ---------- limits (mirror JS) ---------- */
inline double clampd(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline double clampFreq(double f, double fs) { return clampd(f, 10.0, fs * 0.49); }
inline double clampGain(double g) { return clampd(g, -30.0, 30.0); }
inline double clampQ(double q) { return clampd(q, 0.05, 40.0); }

/* ---------- state model ---------- */
struct Dyn {
    bool on = false;
    double range = 0.0;    // dB, +/- toward which gain moves
    double thresh = -30.0; // dB
    double att = 10.0;     // ms
    double rel = 150.0;    // ms
};

struct Band {
    bool on = false;
    BandType type = BELL;
    double freq = 1000.0;
    double gain = 0.0;
    double q = 1.0;
    int slope = 12;       // 6..48 dB/oct, cut types only
    Place place = P_ST;   // stereo / left / right / mid / side
    Dyn dyn;
};

inline bool hasGainType(BandType t) {
    return t == BELL || t == LOWSHELF || t == HIGHSHELF || t == TILT;
}

inline bool slopeValid(int s) {
    for (int i = 0; i < 6; i++) if (SLOPES[i] == s) return true;
    return false;
}

struct State {
    Band bands[MAX_BANDS];
    double outGain = 0.0;
    double outPan = 0.0;
    std::string name = "Fresh Slab";
    std::string note;
};

/* mirrors sanitizeState(): clamps in the same order with the same
   falsy fallbacks (0 → default) the JS `+x || d` idiom produces. */
inline State sanitizeState(const State& s) {
    State out; // defaults
    for (int i = 0; i < MAX_BANDS; i++) {
        const Band& b = s.bands[i];
        Band& o = out.bands[i];
        o.on = b.on;
        o.type = (b.type >= 0 && b.type < NUM_TYPES) ? b.type : BELL;
        double f = b.freq; if (f != f || f == 0.0) f = 1000.0;   // JS: +b.freq || 1000
        o.freq = clampd(f, 10.0, 30000.0);
        double g = b.gain; if (g != g) g = 0.0;                  // JS: +b.gain || 0 (0 stays 0)
        o.gain = clampGain(g);
        double q = b.q; if (q != q || q == 0.0) q = 1.0;         // JS: +b.q || 1
        o.q = clampQ(q);
        o.slope = slopeValid(b.slope) ? b.slope : 12;
        o.place = (b.place >= 0 && b.place < NUM_PLACES) ? b.place : P_ST;
        {   /* mirror of the JS dyn sanitizer, same falsy idioms */
            double th = b.dyn.thresh; if (th != th) th = -30.0;
            double rg = b.dyn.range; if (rg != rg || rg == 0.0) rg = 0.0;
            double at = b.dyn.att; if (at != at || at == 0.0) at = 10.0;
            double rl = b.dyn.rel; if (rl != rl || rl == 0.0) rl = 150.0;
            o.dyn.on = b.dyn.on;
            o.dyn.range = clampd(rg, -24.0, 24.0);
            o.dyn.thresh = clampd(th, -60.0, 0.0);
            o.dyn.att = clampd(at, 0.1, 500.0);
            o.dyn.rel = clampd(rl, 1.0, 2000.0);
        }
    }
    double og = s.outGain; if (og != og) og = 0.0;
    out.outGain = clampd(og, -36.0, 36.0);
    double op = s.outPan; if (op != op) op = 0.0;
    out.outPan = clampd(op, -1.0, 1.0);
    out.name = s.name.empty() ? std::string("Fresh Slab") : s.name;
    out.note = s.note;
    return out;
}

/* ---------- RBJ coefficient design (mirror of the JS designers) ---------- */
struct Coeffs { double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0; };
struct BandCoeffs { Coeffs sec[MAX_SECTIONS]; int n = 1; };

inline Coeffs normC(double b0, double b1, double b2, double a0, double a1, double a2) {
    Coeffs c;
    c.b0 = b0 / a0; c.b1 = b1 / a0; c.b2 = b2 / a0; c.a1 = a1 / a0; c.a2 = a2 / a0;
    return c;
}
inline Coeffs secBell(double f, double g, double q, double fs) {
    double w0 = 2 * M_PI * f / fs;
    double cw = nm::cos_(w0), sw = nm::sin_(w0);
    double alpha = sw / (2 * q);
    double A = nm::pow10_(g / 40);
    return normC(1 + alpha * A, -2 * cw, 1 - alpha * A,
                 1 + alpha / A, -2 * cw, 1 - alpha / A);
}
inline Coeffs secLowShelf(double f, double g, double q, double fs) {
    double w0 = 2 * M_PI * f / fs;
    double cw = nm::cos_(w0), sw = nm::sin_(w0);
    double alpha = sw / (2 * q);
    double A = nm::pow10_(g / 40);
    double sA = 2 * std::sqrt(A) * alpha;
    return normC(
        A * ((A + 1) - (A - 1) * cw + sA),
        2 * A * ((A - 1) - (A + 1) * cw),
        A * ((A + 1) - (A - 1) * cw - sA),
        (A + 1) + (A - 1) * cw + sA,
        -2 * ((A - 1) + (A + 1) * cw),
        (A + 1) + (A - 1) * cw - sA);
}
inline Coeffs secHighShelf(double f, double g, double q, double fs) {
    double w0 = 2 * M_PI * f / fs;
    double cw = nm::cos_(w0), sw = nm::sin_(w0);
    double alpha = sw / (2 * q);
    double A = nm::pow10_(g / 40);
    double sA = 2 * std::sqrt(A) * alpha;
    return normC(
        A * ((A + 1) + (A - 1) * cw + sA),
        -2 * A * ((A - 1) + (A + 1) * cw),
        A * ((A + 1) + (A - 1) * cw - sA),
        (A + 1) - (A - 1) * cw + sA,
        2 * ((A - 1) - (A + 1) * cw),
        (A + 1) - (A - 1) * cw - sA);
}
inline Coeffs secNotch(double f, double q, double fs) {
    double w0 = 2 * M_PI * f / fs;
    double cw = nm::cos_(w0), sw = nm::sin_(w0);
    double alpha = sw / (2 * q);
    return normC(1, -2 * cw, 1, 1 + alpha, -2 * cw, 1 - alpha);
}
inline Coeffs secBandpass(double f, double q, double fs) {
    double w0 = 2 * M_PI * f / fs;
    double cw = nm::cos_(w0), sw = nm::sin_(w0);
    double alpha = sw / (2 * q);
    return normC(alpha, 0, -alpha, 1 + alpha, -2 * cw, 1 - alpha);
}
inline Coeffs secSosHP(double f, double q, double fs) {
    double w0 = 2 * M_PI * f / fs;
    double cw = nm::cos_(w0), sw = nm::sin_(w0);
    double alpha = sw / (2 * q);
    return normC((1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
}
inline Coeffs secSosLP(double f, double q, double fs) {
    double w0 = 2 * M_PI * f / fs;
    double cw = nm::cos_(w0), sw = nm::sin_(w0);
    double alpha = sw / (2 * q);
    return normC((1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
}
inline Coeffs secFoHP(double f, double fs) {
    double w0 = 2 * M_PI * f / fs;
    double cw = nm::cos_(w0), sw = nm::sin_(w0);
    double K = sw / (1 + cw);
    Coeffs c;
    c.b0 = 1 / (K + 1); c.b1 = -1 / (K + 1); c.b2 = 0; c.a1 = (K - 1) / (K + 1); c.a2 = 0;
    return c;
}
inline Coeffs secFoLP(double f, double fs) {
    double w0 = 2 * M_PI * f / fs;
    double cw = nm::cos_(w0), sw = nm::sin_(w0);
    double K = sw / (1 + cw);
    Coeffs c;
    c.b0 = K / (K + 1); c.b1 = K / (K + 1); c.b2 = 0; c.a1 = (K - 1) / (K + 1); c.a2 = 0;
    return c;
}
inline BandCoeffs cutCascade(double f, int slope, double fs, bool isHP) {
    int s = slopeValid(slope) ? slope : 12;
    int n = s / 6;
    BandCoeffs out;
    out.n = 0;
    if (n % 2 == 1) out.sec[out.n++] = isHP ? secFoHP(f, fs) : secFoLP(f, fs);
    int pairs = n / 2;
    for (int k = 1; k <= pairs; k++) {
        double phi = (n % 2 == 0) ? M_PI * (2 * k - 1) / (2 * n) : M_PI * k / n;
        double qk = 1 / (2 * nm::cos_(phi));
        out.sec[out.n++] = isHP ? secSosHP(f, qk, fs) : secSosLP(f, qk, fs);
    }
    return out;
}
inline BandCoeffs designBand(BandType type, double freq, double gain, double q,
                             int slope, double fs) {
    double f = clampFreq(freq, fs);
    double Q = clampQ(q);
    double g = clampGain(gain);
    BandCoeffs out;
    switch (type) {
        case BELL:      out.sec[0] = secBell(f, g, Q, fs); out.n = 1; break;
        case LOWSHELF:  out.sec[0] = secLowShelf(f, g, Q, fs); out.n = 1; break;
        case HIGHSHELF: out.sec[0] = secHighShelf(f, g, Q, fs); out.n = 1; break;
        case NOTCH:     out.sec[0] = secNotch(f, Q, fs); out.n = 1; break;
        case BANDPASS:  out.sec[0] = secBandpass(f, Q, fs); out.n = 1; break;
        case TILT:
            out.sec[0] = secLowShelf(f, -g / 2, Q, fs);
            out.sec[1] = secHighShelf(f, g / 2, Q, fs);
            out.n = 2; break;
        case LOWCUT:    out = cutCascade(f, slope, fs, true); break;
        case HIGHCUT:   out = cutCascade(f, slope, fs, false); break;
        default:        out.sec[0] = Coeffs{}; out.n = 1; break;
    }
    return out;
}
inline BandCoeffs designBand(const Band& b, double fs) {
    return designBand(b.type, b.freq, b.gain, b.q, b.slope, fs);
}

/* ---------- analytic magnitude (mirror sectionMagAt / magnitudeAt) ---------- */
inline double sectionMagAt(const Coeffs& c, double fs, double f) {
    double w = 2.0 * M_PI * f / fs;
    double c1 = nm::cos_(w), s1 = nm::sin_(w);
    double c2 = nm::cos_(2 * w), s2 = nm::sin_(2 * w);
    double nr = c.b0 + c.b1 * c1 + c.b2 * c2;
    double ni = -(c.b1 * s1 + c.b2 * s2);
    double dr = 1 + c.a1 * c1 + c.a2 * c2;
    double di = -(c.a1 * s1 + c.a2 * s2);
    return std::sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}

inline double bandLinMagAt(const Band& b, double fs, double f) {
    BandCoeffs bc = designBand(b, fs);
    double m = 1;
    for (int i = 0; i < bc.n; i++) m *= sectionMagAt(bc.sec[i], fs, f);
    return m;
}

inline double magnitudeAt(const State& state, double fs, double f) {
    double db = state.outGain;
    for (int i = 0; i < MAX_BANDS; i++) {
        const Band& b = state.bands[i];
        if (!b.on) continue;
        double m = bandLinMagAt(b, fs, f);
        db += 20.0 * nm::log10_(m > 1e-12 ? m : 1e-12);
    }
    return db;
}
inline double bandMagAt(const Band& b, double fs, double f) {
    double m = bandLinMagAt(b, fs, f);
    return 20.0 * nm::log10_(m > 1e-12 ? m : 1e-12);
}

/* ---------- engine (mirror createEngine) ---------- */
class Engine {
public:
    explicit Engine(double sampleRate) : fs(sampleRate) {
        for (int i = 0; i < MAX_BANDS; i++) {
            cur[i] = CurBand{ nm::log_(1000.0), 0.0, 0.0, false, P_ST };
            coeffs[i] = BandCoeffs{};
            std::memset(zs[i], 0, sizeof(zs[i]));
            detC[i] = Coeffs{ 0, 0, 0, 0, 0 };
            detZ[i][0] = detZ[i][1] = 0;
            env[i] = 0; dynG[i] = 0; dynAct[i] = false;
            attC[i] = 0; relC[i] = 0;
        }
    }

    void dynGains(double* out12) const {
        for (int k = 0; k < MAX_BANDS; k++) out12[k] = dynG[k];
    }

    void setState(const State& s) {
        target = sanitizeState(s);
        outGTgt = target.outGain;
        panTgt = target.outPan;
        for (int k = 0; k < MAX_BANDS; k++) refreshBandTargetsOnEnable(k);
        if (!primed) { // first state ever: arrive, don't fade in
            outGCur = outGTgt;
            panCur = panTgt;
            primed = true;
        }
    }

    /* reset() = fresh-engine equivalence; byte-identity asserted by the fuzzer */
    void reset() {
        for (int k = 0; k < MAX_BANDS; k++) {
            cur[k] = CurBand{ nm::log_(1000.0), 0.0, 0.0, false, P_ST };
            coeffs[k] = BandCoeffs{};
            zeroZ(k);
        }
        ctrlPhase = 0;
        for (int k2 = 0; k2 < MAX_BANDS; k2++) refreshBandTargetsOnEnable(k2);
        outGCur = outGTgt;
        panCur = panTgt;
    }

    /* mirrors process(inL,inR,outL,outR) — same CTRL blocking, same pan law */
    void process(const double* inL, const double* inR, double* outL, double* outR, int n) {
        int pos = 0;
        while (pos < n) {
            if (ctrlPhase == 0) control();
            int run = std::min(CTRL - ctrlPhase, n - pos);
            int end = pos + run;
            double amp = nm::pow10_(outGCur / 20.0);
            double th = (panCur + 1.0) * M_PI / 4.0;
            double gL = amp * nm::cos_(th) * M_SQRT2;
            double gR = amp * nm::sin_(th) * M_SQRT2;
            for (int s = pos; s < end; s++) {
                double xL = inL[s], xR = inR[s];
                for (int k = 0; k < MAX_BANDS; k++) {
                    if (!cur[k].on) continue;
                    if (dynAct[k]) { // detector on this band's chain input, mono mix
                        double dv = tick(detC[k], detZ[k], 0, (xL + xR) * 0.5);
                        double ad = std::fabs(dv);
                        env[k] = dn(ad > env[k]
                            ? attC[k] * env[k] + (1 - attC[k]) * ad
                            : relC[k] * env[k] + (1 - relC[k]) * ad);
                    }
                    const BandCoeffs& bc = coeffs[k];
                    double* z = zs[k];
                    Place plc = cur[k].plc;
                    int ns = bc.n, si, o;
                    if (plc == P_ST) {
                        for (si = 0; si < ns; si++) {
                            o = si * 4;
                            xL = tick(bc.sec[si], z, o, xL);
                            xR = tick(bc.sec[si], z, o + 2, xR);
                        }
                    } else if (plc == P_L) {
                        for (si = 0; si < ns; si++) xL = tick(bc.sec[si], z, si * 4, xL);
                    } else if (plc == P_R) {
                        for (si = 0; si < ns; si++) xR = tick(bc.sec[si], z, si * 4 + 2, xR);
                    } else { // P_M / P_S — exact matrix, reconstruction (m+s, m-s)
                        double mid = (xL + xR) * 0.5;
                        double sd = (xL - xR) * 0.5;
                        if (plc == P_M) {
                            for (si = 0; si < ns; si++) mid = tick(bc.sec[si], z, si * 4, mid);
                        } else {
                            for (si = 0; si < ns; si++) sd = tick(bc.sec[si], z, si * 4, sd);
                        }
                        xL = mid + sd;
                        xR = mid - sd;
                    }
                }
                outL[s] = xL * gL;
                outR[s] = xR * gR;
            }
            ctrlPhase = (ctrlPhase + run) % CTRL;
            pos = end;
        }
    }

    /* float convenience for the JUCE processor */
    void processFloat(const float* inL, const float* inR, float* outL, float* outR, int n) {
        scratch.resize((size_t)n * 4);
        double* dL = scratch.data();
        double* dR = dL + n;
        double* oL = dR + n;
        double* oR = oL + n;
        for (int i = 0; i < n; i++) { dL[i] = inL[i]; dR[i] = inR[i]; }
        process(dL, dR, oL, oR, n);
        for (int i = 0; i < n; i++) { outL[i] = (float)oL[i]; outR[i] = (float)oR[i]; }
    }

private:
    struct CurBand { double fl, g, ql; bool on; Place plc; };

    double fs;
    State target;
    CurBand cur[MAX_BANDS];
    BandCoeffs coeffs[MAX_BANDS];
    double zs[MAX_BANDS][MAX_SECTIONS * 4];

    Coeffs detC[MAX_BANDS];
    double detZ[MAX_BANDS][2];
    double env[MAX_BANDS];
    double dynG[MAX_BANDS];
    bool dynAct[MAX_BANDS];
    double attC[MAX_BANDS], relC[MAX_BANDS];

    void zeroZ(int k) {
        std::memset(zs[k], 0, sizeof(zs[k]));
        detZ[k][0] = detZ[k][1] = 0;
        env[k] = 0;
        dynG[k] = 0;
    }

    /* denormal flush — mirrors the JS dn() operation-for-operation; the flush
       is part of the arithmetic contract so both deployments sound identical */
    static double dn(double x) { return x < 1e-300 && x > -1e-300 ? 0 : x; }

    /* one biquad section, single channel; z offset o uses [o, o+1].
       y flushed too — the chain, not just the recursion. */
    static double tick(const Coeffs& c, double* z, int o, double x) {
        double y = dn(c.b0 * x + z[o]);
        z[o] = dn(c.b1 * x - c.a1 * y + z[o + 1]);
        z[o + 1] = dn(c.b2 * x - c.a2 * y);
        return y;
    }
    double outGCur = 0.0, outGTgt = 0.0;
    double panCur = 0.0, panTgt = 0.0;
    int ctrlPhase = 0; // stream-time control phase, carried across process() calls
    bool primed = false; // first setState snaps smoothing; later ones glide
    std::vector<double> scratch;

    static double smoothv(double c, double t) {
        double n = c + (t - c) * SMOOTH;
        return std::fabs(t - n) < SNAP ? t : n;
    }

    /* NOTE: `dirty` is deliberately shared across the band loop —
       the JS core declares it once, so a toggle on band k forces a
       coefficient recompute for every later band that block. The
       recompute is numerically idempotent, but parity means parity. */
    void control() {
        bool dirty = false;
        for (int k = 0; k < MAX_BANDS; k++) {
            const Band& tb = target.bands[k];
            CurBand& cb = cur[k];
            if (cb.on != tb.on) { cb.on = tb.on; zeroZ(k); dirty = true; }
            if (cb.plc != tb.place) { cb.plc = tb.place; zeroZ(k); dirty = true; }
            if (!cb.on) continue;
            double tf = nm::log_(clampFreq(tb.freq, fs));
            double tq = nm::log_(clampQ(tb.q));
            double tg = clampGain(tb.gain);
            double nf = smoothv(cb.fl, tf), ng = smoothv(cb.g, tg), nq = smoothv(cb.ql, tq);

            /* dynamics: envelope -> gain offset, evaluated at control rate */
            const Dyn& dyn = tb.dyn;
            dynAct[k] = dyn.on && hasGainType(tb.type);
            if (dynAct[k]) {
                attC[k] = nm::exp_(-1 / (clampd(dyn.att, 0.1, 500) * 0.001 * fs));
                relC[k] = nm::exp_(-1 / (clampd(dyn.rel, 1, 2000) * 0.001 * fs));
                double envDb = 20 * nm::log10_(env[k] + 1e-9);
                double over = envDb - clampd(dyn.thresh, -60, 0);
                dynG[k] = over <= 0 ? 0 : clampd(dyn.range, -24, 24) * (over / (over + 6));
            } else {
                dynG[k] = 0;
            }

            if (nf != cb.fl || ng != cb.g || nq != cb.ql || dirty || dynAct[k]) {
                cb.fl = nf; cb.g = ng; cb.ql = nq;
                coeffs[k] = designBand(tb.type, nm::exp_(nf), ng + dynG[k], nm::exp_(nq), tb.slope, fs);
                if (dynAct[k]) {
                    detC[k] = secBandpass(clampFreq(nm::exp_(nf), fs),
                                          clampd(nm::exp_(nq), 0.3, 8), fs);
                }
            }
        }
        outGCur = smoothv(outGCur, outGTgt);
        panCur = smoothv(panCur, panTgt);
    }

    void refreshBandTargetsOnEnable(int k) {
        const Band& tb = target.bands[k];
        CurBand& cb = cur[k];
        if (tb.on && !cb.on) {
            cb.fl = nm::log_(clampFreq(tb.freq, fs));
            cb.g = clampGain(tb.gain);
            cb.ql = nm::log_(clampQ(tb.q));
            coeffs[k] = designBand(tb.type, nm::exp_(cb.fl), cb.g, nm::exp_(cb.ql), tb.slope, fs);
        }
    }
};

/* ---------- deterministic noise (mirror makeNoise) ---------- */
inline std::vector<double> makeNoise(unsigned seed, int n) {
    long long x = (seed == 0) ? 1 : (long long)seed;
    std::vector<double> out((size_t)n);
    for (int i = 0; i < n; i++) {
        x = (x * 16807LL) % 2147483647LL;
        out[(size_t)i] = ((double)x / 2147483647.0) * 2.0 - 1.0;
    }
    return out;
}

} // namespace autopsy
