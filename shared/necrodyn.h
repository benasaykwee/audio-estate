/* ============================================================
   necrodyn.h — the dynamics DNA, shared substrate
   C++ mirror of shared/necrodyn.js. Written 2026-08-15 for CASKET;
   RIGOR inherits it unchanged.
   The op ORDER is the load-bearing property, exactly as in necromath.
   PARITY LAW: compile with -ffp-contract=off. GCC will otherwise
   FMA-fuse a*b+c and the fused result differs in the last bit.
   ============================================================ */
#pragma once
#include <cmath>
#include <vector>
#include <cstdint>
#include "necromath.h"

namespace nd {

/* ---------- scalars ---------- */
inline double clamp(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }

static const double DB_FLOOR = 1e-30;
inline double dbToLin(double db) { return nm::pow10_(db / 20); }
inline double linToDb(double x) { return 20 * nm::log10_(x > DB_FLOOR ? x : DB_FLOOR); }

inline double onePole(double ms, double fs) {
    return nm::exp_(-1 / (clamp(ms, 1e-6, 1e9) * 0.001 * fs));
}

inline double blend(double d, double k) { return d / (d + k); }

/* ---------- gain computer ----------
   invR = 1/ratio, so a limiter is EXACTLY invR = 0. */
/* THE INFINITE-RATIO GUARD (2026-08-16). `T + d * invR` with d = +Infinity
   and invR = 0 is Infinity * 0, which is NaN — and a limiter is invR = 0 by
   definition. Bit-exact for every finite input (T + d*0 == T + 0 == T) and
   unreachable for NaN, which still fails `d > W/2` and still comes out NaN.
   See the JS twin for the full note. */
inline double kneeOut(double x, double T, double W, double invR) {
    double d = x - T;
    if (W <= 0) return d <= 0 ? x : (invR == 0 ? T : T + d * invR);
    if (d < -W / 2) return x;
    if (d > W / 2) return invR == 0 ? T : T + d * invR;
    double t = d + W / 2;
    return x + (invR - 1) * t * t / (2 * W);
}
/* Gain reduction in dB (<= 0), computed DIRECTLY rather than as
   kneeOut(x) - x. See the JS twin for why: differencing does not always
   return exactly zero at 1:1, and an idle compressor must pass its input
   through bit-for-bit. */
inline double kneeGain(double x, double T, double W, double invR) {
    double d = x - T;
    if (W <= 0) return d <= 0 ? 0 : d * (invR - 1);
    if (d < -W / 2) return 0;
    if (d >= W / 2) return d * (invR - 1);
    double t = d + W / 2;
    return (invR - 1) * t * t / (2 * W);
}

/* ---------- soft clip ----------
   t >= 1 is a pure passthrough, and must be: it is how the saturation
   stage disappears for the bit-exact null test.
   The u > 20 branch is exact, not an approximation — tanh(20) differs
   from 1 by 8e-18, below a double's resolution at 1.0 — and it must
   exist, because nm::exp_ scales by repeated doubling and a huge
   argument spins for billions of iterations before it overflows. */
inline double softClip(double x, double t) {
    if (t >= 1) return x;
    double a = x < 0 ? -x : x;
    if (a <= t) return x;
    double u = (a - t) / (1 - t);
    double y;
    if (u > 20) y = 1;
    else {
        double e = nm::exp_(2 * u);
        y = t + (1 - t) * ((e - 1) / (e + 1));
    }
    return x < 0 ? -y : y;
}

/* ---------- deterministic pseudo-random ----------
   Park-Miller. The JS twin holds the state in a double, where the
   product stays under 2^53 and is therefore exact; we mirror that with
   int64 arithmetic, which represents the same integers exactly. */
struct Lcg {
    std::int64_t x;
    explicit Lcg(std::uint32_t seed) : x(seed ? (std::int64_t)seed : 1) {}
    double next() {
        x = (x * 16807) % 2147483647;
        return (double)x / 2147483647.0;
    }
    void reset(std::uint32_t seed) { x = seed ? (std::int64_t)seed : 1; }
};

/* ---------- sliding minimum ----------
   Monotonic deque. Performs NO arithmetic on the samples — only
   comparison and copy — so it cannot be a source of parity drift. */
class SlidingMin {
public:
    void init(int w, double initVal) {
        n = w < 1 ? 1 : w;
        v.assign((size_t)n, 0.0);
        t.assign((size_t)n, 0.0);
        h = 0; c = 0; now = 0;
        for (int i = 0; i < n - 1; i++) push(initVal);
    }
    double push(double x) {
        while (c > 0 && t[(size_t)h] <= now - n) { h = h + 1 == n ? 0 : h + 1; c--; }
        while (c > 0) {
            int b = h + c - 1; if (b >= n) b -= n;
            if (v[(size_t)b] >= x) c--; else break;
        }
        int p = h + c; if (p >= n) p -= n;
        v[(size_t)p] = x; t[(size_t)p] = now; c++;
        now++;
        return v[(size_t)h];
    }
    int width() const { return n; }
private:
    std::vector<double> v, t;
    int n = 1, h = 0, c = 0;
    double now = 0;
};

/* ---------- boxcar (running-sum moving average) ---------- */
class Boxcar {
public:
    void init(int len, double initVal) {
        n = len < 1 ? 1 : len;
        buf.assign((size_t)n, initVal);
        i = 0; sum = initVal * n; inv = 1.0 / n;
    }
    double push(double x) {
        sum += x - buf[(size_t)i];
        buf[(size_t)i] = x;
        i = i + 1 == n ? 0 : i + 1;
        return sum * inv;
    }
    double getSum() const { return sum; }
    double recompute() const { double s = 0; for (int k = 0; k < n; k++) s += buf[(size_t)k]; return s; }
    int len() const { return n; }
private:
    std::vector<double> buf;
    int n = 1, i = 0;
    double sum = 0, inv = 1;
};

/* ---------- integer delay line ---------- */
class Delay {
public:
    void init(int len) { n = len < 1 ? 1 : len; buf.assign((size_t)n, 0.0); i = 0; }
    double push(double x) {
        double y = buf[(size_t)i];
        buf[(size_t)i] = x;
        i = i + 1 == n ? 0 : i + 1;
        return y;
    }
    void clear() { for (int k = 0; k < n; k++) buf[(size_t)k] = 0.0; i = 0; }
    int len() const { return n; }
private:
    std::vector<double> buf;
    int n = 1, i = 0;
};

/* ---------- first-order DC blocker ---------- */
class DcBlocker {
public:
    void init(double fc, double fs) { R = nm::exp_(-2 * M_PI * fc / fs); x1 = 0; y1 = 0; }
    double tick(double x) { double y = x - x1 + R * y1; x1 = x; y1 = y; return y; }
    void clear() { x1 = 0; y1 = 0; }
    double getR() const { return R; }
private:
    double R = 0, x1 = 0, y1 = 0;
};

/* ---------- transposed-direct-form-II biquad ---------- */
struct BqCoef { double b0, b1, b2, a1, a2; };

/* ---------- RBJ section designers (sidechain filtering) ----------
   Canonical copy lives here; AUTOPSY keeps its own on purpose. */
inline BqCoef bqNorm(double b0, double b1, double b2, double a0, double a1, double a2) {
    BqCoef c;
    c.b0 = b0 / a0; c.b1 = b1 / a0; c.b2 = b2 / a0;
    c.a1 = a1 / a0; c.a2 = a2 / a0;
    return c;
}
inline BqCoef secSosHP(double f, double q, double fs) {
    double w0 = 2 * M_PI * f / fs;
    double cw = nm::cos_(w0), sw = nm::sin_(w0);
    double alpha = sw / (2 * q);
    return bqNorm((1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
}
inline BqCoef secSosLP(double f, double q, double fs) {
    double w0 = 2 * M_PI * f / fs;
    double cw = nm::cos_(w0), sw = nm::sin_(w0);
    double alpha = sw / (2 * q);
    return bqNorm((1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
}
static const BqCoef BYPASS_SECTION = { 1, 0, 0, 0, 0 };
class Biquad {
public:
    double tick(const BqCoef& c, double x) {
        double y = c.b0 * x + z1;
        z1 = c.b1 * x - c.a1 * y + z2;
        z2 = c.b2 * x - c.a2 * y;
        return y;
    }
    void clear() { z1 = 0; z2 = 0; }
private:
    double z1 = 0, z2 = 0;
};

} // namespace nd
