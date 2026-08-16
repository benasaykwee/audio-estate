/* AUTOPSY parity gate — C++ core vs JS truth values.
   g++ -std=c++17 -O2 -ffp-contract=off -o core_parity tests/core_parity.cpp && ./core_parity
   PARITY LAW: -ffp-contract=off (no FMA fusion). Gate: bit-exact. */
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cmath>
#include "../autopsy-juce/Source/AutopsyCore.h"
#include "parity_expected.h"

using namespace autopsy;

static int fails = 0, checks = 0;
static double worstUlp = 0;
static char worstWhere[64] = "";

static double ulpDiff(double a, double b) {
    if (a == b) return 0;
    std::int64_t ia, ib;
    std::memcpy(&ia, &a, 8);
    std::memcpy(&ib, &b, 8);
    if (ia < 0) ia = INT64_MIN - ia;
    if (ib < 0) ib = INT64_MIN - ib;
    return std::fabs((double)(ia - ib));
}

static void check(double got, double exp, const char* where) {
    checks++;
    if (got == exp) return;
    double u = ulpDiff(got, exp);
    if (u > worstUlp) { worstUlp = u; std::snprintf(worstWhere, sizeof(worstWhere), "%s", where); }
    fails++;
    if (fails <= 8)
        std::printf("  MISMATCH %s: got %.17g expected %.17g (%.0f ulp)\n", where, got, exp, u);
}

/* mirrors the emitter's case list exactly */
struct CC { BandType t; double f, g, q; int slope; };
static const double SETTINGS[5][3] = { {100,6,0.71},{1000,-9.5,1.0},{3200,2.5,2.8},{12000,12,8},{40,-18,0.4} };

static State surgical() {
    State s;
    s.bands[0] = { true, LOWCUT, 80, 0, 1, 12, P_ST };
    s.bands[1] = { true, BELL, 240, -3.5, 2.2, 12, P_ST };
    s.bands[2] = { true, BELL, 3200, 2.5, 1.4, 12, P_ST };
    s.bands[3] = { true, HIGHSHELF, 9000, 1.5, 0.71, 12, P_ST };
    s.outGain = -1.5; s.outPan = 0.25;
    return s;
}
static State dynamicSt() {
    State s;
    s.bands[0].on = true; s.bands[0].type = BELL; s.bands[0].freq = 1000;
    s.bands[0].gain = 0; s.bands[0].q = 1.5;
    s.bands[0].dyn = { true, -12, -30, 5, 80 };
    s.bands[1].on = true; s.bands[1].type = HIGHSHELF; s.bands[1].freq = 8000;
    s.bands[1].gain = 2; s.bands[1].q = 0.71;
    s.bands[1].dyn = { true, 6, -36, 20, 200 };
    s.bands[2].on = true; s.bands[2].type = LOWCUT; s.bands[2].freq = 60;
    s.bands[2].gain = 0; s.bands[2].q = 1; s.bands[2].slope = 24;
    s.outGain = -1.0; s.outPan = 0.1;
    return s;
}

static State placed() {
    State s;
    s.bands[0] = { true, LOWCUT, 100, 0, 1, 36, P_ST };
    s.bands[1] = { true, BELL, 500, 4, 1.8, 12, P_M };
    s.bands[2] = { true, HIGHSHELF, 8000, -3, 0.71, 12, P_S };
    s.bands[3] = { true, BELL, 1200, 2, 2.5, 12, P_L };
    s.bands[4] = { true, NOTCH, 2000, 0, 6, 12, P_R };
    s.bands[5] = { true, TILT, 700, 3, 0.71, 12, P_ST };
    s.bands[6] = { true, BANDPASS, 1000, 0, 2, 12, P_ST };
    s.bands[7] = { true, HIGHCUT, 15000, 0, 1, 48, P_ST };
    s.outGain = 1.0; s.outPan = -0.3;
    return s;
}

int main() {
    double fs = PARITY_FS;
    char where[64];

    /* build the same case list as the emitter */
    CC cases[NUM_TYPES * 5 + 12];
    int nc = 0;
    for (int t = 0; t < NUM_TYPES; t++)
        for (int s = 0; s < 5; s++)
            cases[nc++] = { (BandType)t, SETTINGS[s][0], SETTINGS[s][1], SETTINGS[s][2], 12 };
    for (int i = 0; i < 6; i++) {
        cases[nc++] = { LOWCUT, 150, 0, 1, SLOPES[i] };
        cases[nc++] = { HIGHCUT, 6000, 0, 1, SLOPES[i] };
    }
    if (nc != PARITY_NCASES) { std::printf("case-count mismatch %d vs %d\n", nc, PARITY_NCASES); return 1; }

    int idx = 0;
    for (int cse = 0; cse < nc; cse++) {
        BandCoeffs bc = designBand(cases[cse].t, cases[cse].f, cases[cse].g,
                                   cases[cse].q, cases[cse].slope, fs);
        if (bc.n != EXP_SECN[cse]) {
            std::printf("  MISMATCH section count case %d: %d vs %d\n", cse, bc.n, EXP_SECN[cse]);
            fails++;
        }
        Coeffs ident;
        for (int si = 0; si < MAX_SECTIONS; si++) {
            const Coeffs& c = si < bc.n ? bc.sec[si] : ident;
            const double vals[5] = { c.b0, c.b1, c.b2, c.a1, c.a2 };
            for (int v = 0; v < 5; v++) {
                std::snprintf(where, sizeof(where), "coeff[case %d/%s s%d v%d]",
                              cse, TYPE_NAMES[cases[cse].t], si, v);
                check(vals[v], EXP_COEFFS[idx++], where);
            }
        }
    }

    /* magnitude probes on both states */
    const double MF[10] = { 20, 55, 80, 240, 700, 1000, 3200, 9000, 15000, 20000 };
    State s1 = surgical(), s2 = placed();
    int mi = 0;
    for (int i = 0; i < 10; i++) {
        std::snprintf(where, sizeof(where), "mag[surgical %g Hz]", MF[i]);
        check(magnitudeAt(s1, fs, MF[i]), EXP_MAGS[mi++], where);
    }
    for (int i = 0; i < 10; i++) {
        std::snprintf(where, sizeof(where), "mag[placed %g Hz]", MF[i]);
        check(magnitudeAt(s2, fs, MF[i]), EXP_MAGS[mi++], where);
    }

    /* rendered engine output, both states */
    auto renderCheck = [&](State st, unsigned seedL, unsigned seedR, int& ridx, const char* tag) {
        Engine e(fs);
        e.setState(st);
        auto nL = makeNoise(seedL, PARITY_N);
        auto nR = makeNoise(seedR, PARITY_N);
        std::vector<double> oL(PARITY_N), oR(PARITY_N);
        e.process(nL.data(), nR.data(), oL.data(), oR.data(), PARITY_N);
        for (int i = 0; i < PARITY_N; i += PARITY_STRIDE) {
            std::snprintf(where, sizeof(where), "render[%s L@%d]", tag, i);
            check(oL[(size_t)i], EXP_RENDER[ridx++], where);
            std::snprintf(where, sizeof(where), "render[%s R@%d]", tag, i);
            check(oR[(size_t)i], EXP_RENDER[ridx++], where);
        }
    };
    int ridx = 0;
    renderCheck(surgical(), 424242, 424242, ridx, "surgical");
    renderCheck(placed(), 424242, 133742, ridx, "placed");
    renderCheck(dynamicSt(), 987654, 987654, ridx, "dynamic");

    /* other sample rates — nothing assumes 48 k */
    {
        auto renderAt = [&](State st, double fs2, unsigned sL, unsigned sR, const char* tag) {
            Engine e(fs2);
            e.setState(st);
            auto nL = makeNoise(sL, PARITY_N);
            auto nR = makeNoise(sR, PARITY_N);
            std::vector<double> oL(PARITY_N), oR(PARITY_N);
            e.process(nL.data(), nR.data(), oL.data(), oR.data(), PARITY_N);
            for (int i = 0; i < PARITY_N; i += PARITY_STRIDE) {
                std::snprintf(where, sizeof(where), "render[%s L@%d]", tag, i);
                check(oL[(size_t)i], EXP_RENDER[ridx++], where);
                std::snprintf(where, sizeof(where), "render[%s R@%d]", tag, i);
                check(oR[(size_t)i], EXP_RENDER[ridx++], where);
            }
        };
        renderAt(placed(), 44100.0, 424242, 133742, "placed@44.1k");
        renderAt(dynamicSt(), 96000.0, 987654, 987654, "dynamic@96k");
    }

    /* split-glide: truth was emitted from two single calls; here the same
       stream is chopped into prime chunks. Bit-equality proves ctrlPhase is
       carried across process() calls — the block-size-independence contract. */
    {
        const int SW = 999;
        const int CHUNKS[5] = { 111, 333, 7, 1024, 240 };
        State s0 = surgical();
        State s1 = surgical();
        s1.bands[1].gain = 8;
        s1.outGain = 2;
        Engine e(fs);
        e.setState(s0);
        auto nL = makeNoise(31415, PARITY_N);
        auto nR = makeNoise(27182, PARITY_N);
        std::vector<double> oL(PARITY_N), oR(PARITY_N);
        int pos = 0, ci = 0;
        bool switched = false;
        while (pos < PARITY_N) {
            if (!switched && pos == SW) { e.setState(s1); switched = true; }
            int lim = pos < SW ? SW : PARITY_N;
            int n2 = std::min(CHUNKS[ci++ % 5], lim - pos);
            e.process(nL.data() + pos, nR.data() + pos, oL.data() + pos, oR.data() + pos, n2);
            pos += n2;
        }
        for (int i = 0; i < PARITY_N; i += PARITY_STRIDE) {
            std::snprintf(where, sizeof(where), "render[split L@%d]", i);
            check(oL[(size_t)i], EXP_RENDER[ridx++], where);
            std::snprintf(where, sizeof(where), "render[split R@%d]", i);
            check(oR[(size_t)i], EXP_RENDER[ridx++], where);
        }
    }

    if (fails == 0) {
        std::printf("PARITY: %d checks, all bit-exact. The twin is identical.\n", checks);
        return 0;
    }
    std::printf("PARITY: %d/%d mismatched. Worst: %.0f ulp at %s\n", fails, checks, worstUlp, worstWhere);
    return 1;
}
