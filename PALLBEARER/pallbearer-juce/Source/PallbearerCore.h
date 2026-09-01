/* ============================================================
   PALLBEARER — PallbearerCore.h
   C++ parity port of pallbearer_core.js (the single source of truth).
   RULE: this file follows the JS core, never leads it. Any change lands
   in pallbearer_core.js first, then is mirrored here and proven by
   tests/core_parity.cpp.

   Doubles everywhere. Order of operations matches the JS exactly — every
   expression below is transcribed term for term, including the apparently
   redundant parenthesisation, because a reassociated sum is a different
   number and the gate is bit-exact.

   INTERCHANGE law 1: compile with -ffp-contract=off.
   INTERCHANGE law 2: every transcendental goes through nm::.
   ============================================================ */
#pragma once
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>
#include "../../../shared/necromath.h"

namespace pallbearer {

static const char* VERSION = "0.3";

static const double LN2 = 0.69314718055994531;
static const double TWO_PI = 6.2831853071795865;
static const int DISPERSION_STAGES = 4;
static const double WOOD_RATIO_1 = 2.16;
static const double WOOD_RATIO_2 = 4.42;

inline double pow2(double x) { return nm::exp_(x * LN2); }
inline double clampd(double x, double lo, double hi) { return x < lo ? lo : x > hi ? hi : x; }

/* ---------------------------------------------------------------
   THE DICE — must be bit-identical to the JS xorshift.
   JS `x << 13` coerces to int32 then `>>> 0` yields uint32; uint32_t
   here has exactly those bits. `x >>> 17` is a logical shift, which is
   what >> is on an unsigned type. This equivalence is the only reason
   a parity gate over stochastic audio is possible at all.
   --------------------------------------------------------------- */
struct Rng {
    std::uint32_t s;
    explicit Rng(std::uint32_t seed = 1) { s = seed ? seed : 0x9E3779B9u; }
    inline std::uint32_t next() {
        std::uint32_t x = s;
        x ^= (x << 13);
        x ^= (x >> 17);
        x ^= (x << 5);
        s = x;
        return x;
    }
    inline double uni() { return (double)next() / 4294967296.0; }
    inline double bi() { return uni() * 2.0 - 1.0; }
};

/* JS does the multiplies on doubles then coerces with >>> 0, so the
   product is taken mod 2^32 only at the coercion. Reproduce that by
   multiplying in double and masking, NOT by uint32 multiplication —
   they differ once the product exceeds 2^53 / are rounded differently. */
inline std::uint32_t js_u32(double v) {
    double m = std::fmod(v, 4294967296.0);
    if (m < 0) m += 4294967296.0;
    return (std::uint32_t)m;
}
inline std::uint32_t seedFor(std::uint32_t base, int note, int stringIdx, std::uint32_t counter) {
    std::uint32_t h = base;
    h = (h ^ js_u32((double)note * 2654435761.0));
    h = (h ^ js_u32((double)stringIdx * 40503.0 + 2246822507.0 /*0x85EBCA6B*/));
    h = (h ^ js_u32((double)counter * 2246822519.0));
    h = (h ^ (h >> 15));
    return h ? h : 1u;
}

/* ---------------------------------------------------------------
   Pure helpers
   --------------------------------------------------------------- */
inline double midiToFreq(double n) { return 440.0 * pow2((n - 69.0) / 12.0); }

inline double loopGainFor(double f0, double decaySec, double /*sr*/) {
    if (!(decaySec > 0.0) || !(f0 > 0.0)) return 0.0;
    double trips = decaySec * f0;
    if (trips < 1.0) trips = 1.0;
    return pow2(-10.0 / trips);
}

inline double dispersionFor(double f0, double inharm) {
    double lowness = clampd((120.0 - f0) / 100.0, 0.0, 1.0);
    return clampd(inharm * (0.25 + 0.75 * lowness), 0.0, 1.0) * 0.42;
}

inline double velBrightness(double vel, double amount) {
    return -clampd(amount, 0.0, 1.0) * (clampd(vel, 0.0, 1.0) - 0.5) * 0.34;
}

struct Shape { double bright, burst, click, damp, posBias; };
inline Shape styleShape(const std::string& style, double hardness) {
    double h = clampd(hardness, 0.0, 1.0);
    if (style == "pick")  return { 0.72 + 0.28 * h, 0.18, 0.55, 0.10, -0.03 };
    if (style == "slap")  return { 0.88 + 0.12 * h, 0.09, 0.95, 0.04, -0.05 };
    if (style == "thumb") return { 0.22 + 0.20 * h, 0.55, 0.12, 0.26, 0.14 };
    if (style == "muted") return { 0.18 + 0.16 * h, 0.40, 0.20, 0.72, 0.05 };
    return                       { 0.42 + 0.34 * h, 0.34, 0.22, 0.14, 0.0 };
}

struct Artic { double mult, damp, decay, amp, noise, buzz; };
inline Artic articShape(const std::string& a) {
    if (a == "harmonic") return { 2.0, -0.16, 1.35, 0.62, 0.4, 0.0 };
    if (a == "ghost")    return { 1.0,  0.55, 0.10, 0.75, 3.2, 1.6 };
    if (a == "palm")     return { 1.0,  0.30, 0.28, 0.90, 0.7, 0.5 };
    /* dead — touched, not pressed. Almost all attack, nearly no tail. */
    if (a == "dead")     return { 1.0,  0.82, 0.035, 0.85, 5.0, 2.2 };
    return                      { 1.0,  0.0,  1.0,  1.0,  1.0, 1.0 };
}

struct FretPos { int string; int fret; };
inline std::vector<FretPos> fretPositions(int note, const std::vector<int>& open, int frets) {
    std::vector<FretPos> out;
    for (size_t s = 0; s < open.size(); ++s) {
        int fret = note - open[s];
        if (fret >= 0 && fret <= frets) out.push_back({ (int)s, fret });
    }
    return out;
}

/* Returns string index, or -1 when the note has nowhere to go. */
inline int chooseString(int note, const std::vector<int>& open, int frets,
                        double handPos, const std::vector<bool>& busy, int* outFret,
                        double handVel = 0.0) {
    std::vector<FretPos> cands = fretPositions(note, open, frets);
    if (cands.empty()) return -1;
    double hv = std::isfinite(handVel) ? handVel : 0.0;
    int best = -1, bestFret = 0;
    double bestCost = std::numeric_limits<double>::infinity();
    for (size_t i = 0; i < cands.size(); ++i) {
        const FretPos& c = cands[i];
        double cost = 0.0;
        double move = (double)c.fret - handPos;
        cost += c.fret == 0 ? 0.0 : std::fabs(move) * 1.0;
        cost += c.fret > 17 ? ((double)c.fret - 17.0) * 1.6 : 0.0;
        if (!busy.empty() && busy[c.string]) cost += 6.0;
        cost += (double)c.string * 0.55;
        /* HAND MOMENTUM — a hand already travelling up continues up more
           cheaply than it reverses. Small term: it breaks ties, not rules. */
        if (hv != 0.0 && move != 0.0 && c.fret != 0) {
            bool withGrain = (move > 0.0) == (hv > 0.0);
            cost += withGrain ? -std::min(std::fabs(hv), 4.0) * 0.22
                              :  std::min(std::fabs(hv), 4.0) * 0.30;
        }
        if (cost < bestCost) { bestCost = cost; best = c.string; bestFret = c.fret; }
    }
    if (outFret) *outFret = bestFret;
    return best;
}

/* ---------------------------------------------------------------
   Allpass
   --------------------------------------------------------------- */
struct Allpass1 {
    double c = 0, x1 = 0, y1 = 0;
    inline void setFrac(double frac) {
        double f = clampd(frac, 0.0001, 0.9999);
        c = (1.0 - f) / (1.0 + f);
    }
    inline void setCoeff(double cc) { c = clampd(cc, -0.999, 0.999); }
    inline double tick(double x) {
        double y = c * x + x1 - c * y1;
        x1 = x; y1 = y;
        return y;
    }
    inline void reset() { x1 = 0; y1 = 0; }
};

/* ---------------------------------------------------------------
   Parameters — mirrors the JS registry, sanitised the same way
   --------------------------------------------------------------- */
struct Params {
    std::string tuning = "standard-4";
    double frets = 24, capo = 0;
    double decay = 4.5, damping = 0.28, inharm = 0.35, stretch = 0.30;
    std::string style = "finger", artic = "normal";
    double pluckPos = 0.13, hardness = 0.45, noise = 0.22;
    double velBright = 0.55, buzz = 0.16, relNoise = 0.20, fretNoise = 0.30, humanize = 0.25;
    double pickupA = 0.11, pickupB = 0.26, pickupMix = 0.42;
    std::string pickupInv = "in";
    double coilFreq = 3100, coilQ = 1.35;
    double bodyFreq = 92, bodyQ = 3.2, woodMix = 0.40, bodyMix = 0.30;
    double tone = 3800, drive = 0.12, level = 0.9;
    double glide = 0, couple = 0.18, relDamp = 0.08, velSense = 0.75;
    double strGain = 1, atkGain = 0, atkDecay = 0.25;
};

struct AttackLayer {
    const double* data = nullptr;
    int length = 0;
    double sr = 48000;
    double root = 33;
};

/* ---------------------------------------------------------------
   The string
   --------------------------------------------------------------- */
struct StringVoice {
    double sr = 48000;
    std::vector<double> buf;
    int mask = 0, w = 0;
    double delay = 100, targetDelay = 100, glideCoef = 1;
    Allpass1 frac;
    Allpass1 disp[DISPERSION_STAGES];
    double lp = 0, gain = 0.999, damp = 0.3;
    bool sounding = false, releasing = false;
    int note = -1;
    double env = 0, relCoef = 0, f0 = 0;
    double pickA = 0, pickB = 0, bloom = 0, bloomDec = 0;
    double _a = 0, _b = 0, _atk = 0;
    double buzzAmt = 0, buzzDec = 0, buzzLp = 0;
    double relAmt = 0, relDec = 0, relLp = 0;
    double shiftAmt = 0, shiftDec = 0, shiftLp = 0;
    double _bridge = 0;
    bool primed = false, passive = false;
    double atkPos = 0, atkRate = 0, atkEnv = 0, atkDec = 0;
    bool atkOn = false;
    Rng rng{ 1 };

    void init(double sampleRate) {
        sr = sampleRate;
        int need = (int)std::ceil(sr / 25.0) + 8;
        int size = 256;
        while (size < need) size *= 2;
        buf.assign((size_t)size, 0.0);
        mask = size - 1;
    }
    void reset() {
        std::fill(buf.begin(), buf.end(), 0.0);
        w = 0; lp = 0; env = 0;
        sounding = false; releasing = false; note = -1;
        buzzAmt = 0; relAmt = 0; buzzLp = 0; relLp = 0;
        shiftAmt = 0; shiftLp = 0; _bridge = 0;
        primed = false; passive = false;
        atkOn = false; atkEnv = 0; atkPos = 0;
        frac.reset();
        for (int i = 0; i < DISPERSION_STAGES; ++i) disp[i].reset();
    }
    inline double read(int d) const { return buf[(size_t)((w - d) & mask)]; }

    /* PRIME — set the line up for an open string WITHOUT exciting it. This is
       what an idle string on a real bass is: tuned, undamped, waiting.
       Without it sympathetic coupling cannot work, because the render loop
       skips silent strings and a skipped string can receive nothing. */
    void prime(double f0in, const Params& p) {
        double total = sr / f0in;
        if (total < 4.0) total = 4.0;
        if (total > 4000.0) total = 4000.0;

        damp = clampd(p.damping + 0.20, 0.02, 0.985);
        double dispv = dispersionFor(f0in, p.inharm);
        for (int s = 0; s < DISPERSION_STAGES; ++s) disp[s].setCoeff(-dispv);

        double dDisp = (1.0 + dispv) / (1.0 - dispv);
        double aDamp = 1.0 - damp;
        double dDamp = (1.0 - aDamp) / aDamp;
        double rem = total - (double)DISPERSION_STAGES * dDisp - dDamp;
        if (rem < 4.0) rem = 4.0;
        int D = (int)std::floor(rem);
        double fr = rem - (double)D;
        if (fr < 0.1) { D -= 1; fr += 1.0; }
        if (D < 2) { D = 2; fr = 0.5; }

        delay = D; targetDelay = D;
        frac.setFrac(fr);
        f0 = f0in;
        gain = loopGainFor(f0in, p.decay, sr);
        std::fill(buf.begin(), buf.end(), 0.0);
        w = D;
        lp = 0;
        bloom = 0;
        frac.reset();
        for (int z = 0; z < DISPERSION_STAGES; ++z) disp[z].reset();
        pickA = clampd(p.pickupA, 0.03, 0.45);
        pickB = clampd(p.pickupB, 0.03, 0.45);
        primed = true; passive = true;
        sounding = false; releasing = false; env = 0;
    }

    void pluck(double f0in, double vel, const Params& p, Shape shape,
               const Artic& art, std::uint32_t seed, const AttackLayer* layer,
               const std::string& style, double drift, double shiftDist) {
        rng = Rng(seed);

        /* ROUND-ROBIN DEPTH — `drift` is a slow random WALK owned by the
           instrument, not an independent draw per note. White noise per note
           sounds busy; a walk sounds like someone playing. */
        double hum = clampd(p.humanize, 0.0, 1.0);
        double dr = std::isfinite(drift) ? drift : 0.0;
        double posJit = (rng.bi() * 0.45 + dr * 0.85) * hum * 0.045;
        double hardJit = rng.bi() * hum * 0.12;
        double ampJit = 1.0 + rng.bi() * hum * 0.10;
        double tuneJit = rng.bi() * hum * 0.0016;

        double f0 = f0in * art.mult * (1.0 + tuneJit);
        double total = sr / f0;
        if (total < 4.0) total = 4.0;
        if (total > 4000.0) total = 4000.0;

        /* Recomputing the shape from the jittered hardness. The JS did not do
           this at first — it built `hard` and dropped it, so humanize never
           reached attack hardness. Found while writing this file. */
        double hard = clampd(p.hardness + hardJit, 0.0, 1.0);
        if (!style.empty()) shape = styleShape(style, hard);
        double bright = shape.bright;
        damp = clampd(p.damping + shape.damp * 0.5 + (1.0 - bright) * 0.35
                      + velBrightness(vel, p.velBright) + art.damp, 0.02, 0.985);

        double dispv = dispersionFor(f0, p.inharm);
        for (int s = 0; s < DISPERSION_STAGES; ++s) disp[s].setCoeff(-dispv);

        double dDisp = (1.0 + dispv) / (1.0 - dispv);
        double aDamp = 1.0 - damp;
        double dDamp = (1.0 - aDamp) / aDamp;

        double rem = total - (double)DISPERSION_STAGES * dDisp - dDamp;
        if (rem < 4.0) rem = 4.0;

        int D = (int)std::floor(rem);
        double fr = rem - (double)D;
        if (fr < 0.1) { D -= 1; fr += 1.0; }
        if (D < 2) { D = 2; fr = 0.5; }

        delay = D; targetDelay = D;
        frac.setFrac(fr);
        f0 = f0;
        this->f0 = f0;

        gain = loopGainFor(f0, p.decay * art.decay * (1.0 - shape.damp * 0.85), sr);
        bloom = p.stretch * vel * 0.035;
        bloomDec = pow2(-1.0 / (0.05 * sr / 64.0));

        double pos = clampd(p.pluckPos + shape.posBias + posJit, 0.02, 0.5);
        int apex = (int)std::floor((double)D * pos);
        if (apex < 1) apex = 1;
        if (apex > D - 2) apex = D - 2;

        double amp = vel * (0.55 + 0.45 * shape.click) * art.amp * ampJit;
        double nAmt = p.noise * shape.burst * art.noise;
        std::fill(buf.begin(), buf.end(), 0.0);
        for (int i = 0; i < D; ++i) {
            double v = i < apex ? ((double)i / (double)apex)
                                : ((double)(D - i) / (double)(D - apex));
            v = v * amp;
            if (nAmt > 0.0) v += rng.bi() * nAmt * amp * 0.5;
            buf[(size_t)i] = v;
        }
        int passes = 1 + (int)std::floor((1.0 - bright) * 7.0 * (1.0 - clampd(p.velBright, 0.0, 1.0) * (vel - 0.5)));
        if (passes < 1) passes = 1;
        if (passes > 12) passes = 12;
        for (int k = 0; k < passes; ++k) {
            double prev = buf[(size_t)(D - 1)];
            for (int i = 0; i < D; ++i) { double cur = buf[(size_t)i]; buf[(size_t)i] = 0.5 * (cur + prev); prev = cur; }
        }
        if (shape.click > 0.3) buf[0] += amp * shape.click * 0.6;

        if (art.mult > 1.0) {
            double mean = 0.0;
            for (int i = 0; i < D; ++i) mean += buf[(size_t)i];
            mean /= (double)D;
            for (int i = 0; i < D; ++i) buf[(size_t)i] -= mean;
        }

        w = D;
        lp = 0;
        frac.reset();
        for (int z = 0; z < DISPERSION_STAGES; ++z) disp[z].reset();

        sounding = true; releasing = false; env = 1;
        pickA = clampd(p.pickupA, 0.03, 0.45);
        pickB = clampd(p.pickupB, 0.03, 0.45);

        double bz = p.buzz * art.buzz * clampd(vel * 1.8 - 0.9, 0.0, 1.0);
        if (f0 < 60.0) bz *= 1.5; else if (f0 > 150.0) bz *= 0.55;
        buzzAmt = bz * 0.5;
        buzzDec = pow2(-1.0 / (0.028 * sr));
        buzzLp = 0;

        /* POSITION-SHIFT NOISE — fingertips dragging across wound windings.
           The fingering brain already computed the distance to choose this
           fret, so the noise is tied to a real playing decision. */
        double sd = std::isfinite(shiftDist) ? std::fabs(shiftDist) : 0.0;
        double shiftA = p.fretNoise * clampd((sd - 1.5) / 9.0, 0.0, 1.0);
        shiftAmt = shiftA * 0.05;
        shiftDec = pow2(-1.0 / (0.075 * sr));
        shiftLp = 0;

        atkOn = false;
        if (layer && layer->data && layer->length > 0 && p.atkGain > 0.0005) {
            atkOn = true;
            atkPos = 0;
            atkRate = (f0 / midiToFreq(layer->root)) * (layer->sr / sr);
            atkEnv = amp;
            atkDec = pow2(-1.0 / (clampd(p.atkDecay, 0.01, 2.0) * sr));
        }
    }

    void release(double relDampSec, double relNoiseAmt) {
        if (!sounding) return;
        releasing = true;
        relCoef = pow2(-1.0 / (std::max(0.001, relDampSec) * sr / 64.0));
        relAmt = relNoiseAmt * 0.06;
        relDec = pow2(-1.0 / (0.035 * sr));
        relLp = 0;
    }

    inline double tickAttack(const AttackLayer* layer) {
        if (!layer || !layer->data) { atkOn = false; return 0.0; }
        int p0 = (int)atkPos;
        if (p0 >= layer->length - 1) { atkOn = false; return 0.0; }
        double f = atkPos - (double)p0;
        double v = layer->data[p0] * (1.0 - f) + layer->data[p0 + 1] * f;
        atkPos += atkRate;
        v *= atkEnv;
        atkEnv *= atkDec;
        if (atkEnv < 0.00002) atkOn = false;
        return v;
    }

    double tick(double inject, const AttackLayer* layer) {
        _atk = 0;
        /* A passive string is tuned and undamped but unplayed. It runs the
           loop so the coupling bus can drive it — that ringing IS sympathetic
           resonance — but it has no envelope and never releases. */
        if (!sounding && passive) {
            int pd = (int)delay;
            if (pd < 2) pd = 2;
            double px = read(pd);
            px = frac.tick(px);
            for (int ps = 0; ps < DISPERSION_STAGES; ++ps) px = disp[ps].tick(px);
            lp = lp + (1.0 - damp) * (px - lp);
            double py = lp * gain;
            if (inject != 0.0) py += inject;
            buf[(size_t)w] = py;
            w = (w + 1) & mask;
            int pA = (int)(2.0 * pickA * delay);
            int pB = (int)(2.0 * pickB * delay);
            if (pA < 1) pA = 1;
            if (pB < 1) pB = 1;
            _a = py - read(pA);
            _b = py - read(pB);
            if (atkOn) _atk = tickAttack(layer);
            return py;
        }
        if (!sounding) {
            _a = 0; _b = 0;
            if (atkOn) _atk = tickAttack(layer);
            return 0.0;
        }

        if (delay != targetDelay) {
            delay += (targetDelay - delay) * glideCoef;
            if (std::fabs(delay - targetDelay) < 0.01) delay = targetDelay;
        }

        double d = delay;
        if (bloom > 0.000001) { d = d / (1.0 + bloom); bloom *= bloomDec; }
        int di = (int)d;
        if (di < 2) di = 2;

        double x = read(di);
        x = frac.tick(x);
        for (int s = 0; s < DISPERSION_STAGES; ++s) x = disp[s].tick(x);

        lp = lp + (1.0 - damp) * (x - lp);
        double y = lp * gain;

        if (releasing) {
            env *= relCoef;
            y *= env;
            if (env < 0.0002) { sounding = false; env = 0; }
        }

        if (inject != 0.0) y += inject;

        buf[(size_t)w] = y;
        w = (w + 1) & mask;

        int dA = (int)(2.0 * pickA * d);
        int dB = (int)(2.0 * pickB * d);
        if (dA < 1) dA = 1;
        if (dB < 1) dB = 1;
        double a = y - read(dA);
        double b = y - read(dB);

        if (buzzAmt > 0.000001) {
            double bn = rng.bi() * buzzAmt;
            buzzLp = buzzLp + 0.55 * (bn - buzzLp);
            double bv = bn - buzzLp;
            a += bv; b += bv;
            buzzAmt *= buzzDec;
        }
        if (relAmt > 0.000001) {
            double rn = rng.bi() * relAmt;
            relLp = relLp + 0.30 * (rn - relLp);
            double rv = rn - relLp;
            a += rv; b += rv;
            relAmt *= relDec;
        }
        if (shiftAmt > 0.000001) {
            // narrower and duller than buzz — skin on winding, not metal on fret
            double sn2 = rng.bi() * shiftAmt;
            shiftLp = shiftLp + 0.18 * (sn2 - shiftLp);
            double sv = shiftLp;
            a += sv; b += sv;
            shiftAmt *= shiftDec;
        }

        if (atkOn) _atk = tickAttack(layer);

        _a = a; _b = b;
        return y;
    }
};

/* ---------------------------------------------------------------
   Body
   --------------------------------------------------------------- */
struct Biquad {
    double b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    double x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    void bandpass(double f, double q, double sr) {
        double w = TWO_PI * clampd(f, 20.0, sr * 0.45) / sr;
        double sn = nm::sin_(w), cs = nm::cos_(w);
        double al = sn / (2.0 * clampd(q, 0.3, 20.0));
        double a0 = 1.0 + al;
        b0 = al / a0; b1 = 0; b2 = -al / a0;
        a1 = -2.0 * cs / a0; a2 = (1.0 - al) / a0;
    }
    /* Resonant lowpass — the RLC a pickup coil actually is. */
    void lowpassRes(double f, double q, double sr) {
        double w = TWO_PI * clampd(f, 20.0, sr * 0.45) / sr;
        double sn = nm::sin_(w), cs = nm::cos_(w);
        double al = sn / (2.0 * clampd(q, 0.1, 20.0));
        double a0 = 1.0 + al;
        b0 = ((1.0 - cs) / 2.0) / a0; b1 = (1.0 - cs) / a0; b2 = b0;
        a1 = -2.0 * cs / a0; a2 = (1.0 - al) / a0;
    }
    inline double tick(double x) {
        double y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        return y;
    }
    void reset() { x1 = x2 = y1 = y2 = 0; }
};

struct Body {
    double sr = 48000;
    Biquad air, w1, w2;
    double woodMix = 0.4;
    void init(double sampleRate) { sr = sampleRate; set(92, 3.2, 0.4); }
    void set(double f, double q, double wm) {
        air.bandpass(f, q, sr);
        w1.bandpass(f * WOOD_RATIO_1, clampd(q * 1.7, 0.3, 20.0), sr);
        w2.bandpass(f * WOOD_RATIO_2, clampd(q * 2.3, 0.3, 20.0), sr);
        woodMix = clampd(wm, 0.0, 1.0);
    }
    inline double tick(double x) {
        double a = air.tick(x);
        double b = w1.tick(x) * 0.55 + w2.tick(x) * 0.30;
        return a + b * woodMix;
    }
    void reset() { air.reset(); w1.reset(); w2.reset(); }
};

/* ---------------------------------------------------------------
   The instrument
   --------------------------------------------------------------- */
inline std::vector<int> tuningOpen(const std::string& key) {
    if (key == "drop-d-4")   return { 26, 33, 38, 43 };
    if (key == "standard-5") return { 23, 28, 33, 38, 43 };
    if (key == "high-c-5")   return { 28, 33, 38, 43, 48 };
    if (key == "standard-6") return { 23, 28, 33, 38, 43, 48 };
    if (key == "tenor-4")    return { 33, 38, 43, 48 };
    return { 28, 33, 38, 43 };
}

class PallbearerCore {
public:
    double sr;
    std::uint32_t seed, noteCounter = 0;
    Params p;
    std::vector<int> open;
    std::vector<StringVoice> strings;
    std::vector<bool> busy;
    double handPos = 5;
    double handVel = 0;            // smoothed direction of travel along the neck
    double drift = 0;              // the slow walk under the per-note jitter
    Rng driftRng{ 1 };
    double coupleBus = 0;          // last sample's summed bridge radiation
    Body body;
    Biquad coil;
    double tonez = 0, toneCoef = 0.3;
    const AttackLayer* attackLayer = nullptr;

    explicit PallbearerCore(double sampleRate = 48000, std::uint32_t sd = 0x5EED1Eu)
        : sr(sampleRate), seed(sd) {
        open = tuningOpen(p.tuning);
        driftRng = Rng(sd ^ 0x9E3779B9u);
        body.init(sr);
        body.set(p.bodyFreq, p.bodyQ, p.woodMix);
        coil.lowpassRes(p.coilFreq, p.coilQ, sr);
        rebuild();
        recalcTone();
    }

    void rebuild() {
        size_t want = open.size();
        strings.resize(want);
        for (size_t i = 0; i < want; ++i) if (strings[i].buf.empty()) strings[i].init(sr);
        busy.assign(want, false);
    }
    void recalcTone() {
        double w = TWO_PI * clampd(p.tone, 50.0, sr * 0.45) / sr;
        toneCoef = clampd(w / (w + 1.0), 0.001, 0.999);
    }
    void setTuning(const std::string& key) {
        p.tuning = key; open = tuningOpen(key); rebuild(); allOff();
    }
    void setBody() { body.set(p.bodyFreq, p.bodyQ, p.woodMix); }
    void setCoil() { coil.lowpassRes(p.coilFreq, p.coilQ, sr); }
    void setAttackLayer(const AttackLayer* l) { attackLayer = (l && l->data && l->length) ? l : nullptr; }

    int noteOn(int note, double velocity, const std::string& articOverride = "") {
        int n = note + (int)p.capo;
        double vel = clampd(velocity, 0.0, 1.0);
        vel = 1.0 - p.velSense + p.velSense * vel;

        int fret = 0;
        int si = chooseString(n, open, (int)p.frets, handPos, busy, &fret, handVel);
        if (si < 0) return -1;

        StringVoice& st = strings[(size_t)si];
        double f0 = midiToFreq(n);
        Shape shape = styleShape(p.style, p.hardness);
        Artic art = articShape(articOverride.empty() ? p.artic : articOverride);

        /* THE HAND, as a thing with a position and a direction. An open
           string costs no travel, which is why players reach for them. */
        double shift = (fret == 0) ? 0.0 : ((double)fret - handPos);
        handVel = handVel * 0.55 + shift * 0.45;
        handPos = fret;

        /* Advance the walk once per note, from the instrument's generator
           rather than the note's — it is a property of the performance.
           Mean-reverting: a hand that drifts forever is not a hand. */
        drift = clampd(drift * 0.82 + driftRng.bi() * 0.38, -1.0, 1.0);

        noteCounter = noteCounter + 1u;
        std::uint32_t sd = seedFor(seed, n, si, noteCounter);
        st.pluck(f0, vel, p, shape, art, sd, attackLayer, p.style, drift, shift);
        st.note = n;
        busy[(size_t)si] = true;

        if (p.couple > 0.001) {
            for (size_t i = 0; i < strings.size(); ++i) {
                if ((int)i == si) continue;
                if (!strings[i].sounding) continue;
                strings[i].env = std::min(1.0, strings[i].env + p.couple * 0.05 * vel);
            }
        }
        return si;
    }

    void noteOff(int note) {
        int n = note + (int)p.capo;
        for (size_t i = 0; i < strings.size(); ++i) {
            if (strings[i].sounding && strings[i].note == n) {
                strings[i].release(p.relDamp, p.relNoise);
                busy[i] = false;
            }
        }
    }

    void allOff() {
        for (size_t i = 0; i < strings.size(); ++i) { strings[i].reset(); busy[i] = false; }
        tonez = 0;
        coupleBus = 0;
        handVel = 0;
        body.reset();
        coil.reset();
    }

    int soundingCount() const {
        int c = 0;
        for (size_t i = 0; i < strings.size(); ++i) if (strings[i].sounding) c++;
        return c;
    }

    void render(double* outL, double* outR, int n) {
        double inv = p.pickupInv == "out" ? -1.0 : 1.0;
        double mix = p.pickupMix, drive = p.drive, lvl = p.level;
        double bodyMix = p.bodyMix, strGain = p.strGain, atkGain = p.atkGain;
        size_t nStr = strings.size();

        /* SYMPATHETIC COUPLING. Every string is bolted to the same bridge, so
           each is driven by what the others radiate. The bus carries LAST
           sample's total — feeding a string a sum including its own present
           output closes a delay-free loop, which is an oscillator, not a model. */
        double couple = p.couple;
        double bus = coupleBus;
        const double COUPLE_K = 0.018;
        bool coupling = couple > 0.001;
        /* THE OSCILLATION FIX (2026-09-01), mirrored from pallbearer_core.js.
           Divide by the number of OTHER strings actually contributing to the
           bus, so `couple` means the same thing on a four-string as a six.
           See the JS twin for the full measurement. */
        double coupleDiv = nStr > 1 ? (double)(nStr - 1) : 1.0;
        if (coupling) {
            for (size_t ps2 = 0; ps2 < nStr; ++ps2)
                if (!strings[ps2].primed && !strings[ps2].sounding)
                    strings[ps2].prime(midiToFreq((double)open[ps2]), p);
        }

        for (int i = 0; i < n; ++i) {
            double sum = 0.0;
            double newBus = 0.0;
            for (size_t s = 0; s < nStr; ++s) {
                StringVoice& st = strings[s];
                bool runs = st.sounding || st.atkOn || (coupling && st.passive);
                if (!runs) { st._bridge = 0; continue; }
                double inject = 0.0;
                if (coupling) inject = COUPLE_K * couple * (bus - st._bridge) / coupleDiv;
                double bridge = st.tick(inject, attackLayer);
                st._bridge = bridge;
                newBus += bridge;
                sum += (st._a * (1.0 - mix) + st._b * mix * inv) * strGain + st._atk * atkGain;
            }
            bus = newBus;

            /* The coil sits between the pickups and everything else, because
               that is where it is: the resonance belongs to the transducer. */
            sum = coil.tick(sum);

            if (bodyMix > 0.001) sum = sum * (1.0 - bodyMix) + body.tick(sum) * bodyMix * 2.2;

            tonez += toneCoef * (sum - tonez);
            double y = tonez;

            if (drive > 0.001) {
                double g = 1.0 + drive * 6.0;
                double xg = y * g;
                y = xg / (1.0 + std::fabs(xg));
                y *= (1.0 + drive * 0.5);
            }

            y *= lvl;
            if (y > 1.6) y = 1.6; else if (y < -1.6) y = -1.6;
            outL[i] = y;
            outR[i] = y;
        }
        coupleBus = bus;
    }
};

} // namespace pallbearer
