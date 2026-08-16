/* RIGOR parity gate — C++ core vs JS truth values.
   g++ -std=c++17 -O2 -ffp-contract=off -o core_parity tests/core_parity.cpp && ./core_parity
   INTERCHANGE law 1: -ffp-contract=off. Gate: bit-exact.
   The case lists here mirror tests/parity_emit.js exactly. */
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cmath>
#include <vector>
#include <memory>
#include "../rigor-juce/Source/RigorCore.h"
#include "parity_expected.h"

using namespace rigor;

static int fails = 0, checks = 0;
static double worstUlp = 0;
static char worstWhere[96] = "";

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
    if (fails <= 10)
        std::printf("  MISMATCH %s: got %.17g expected %.17g (%.0f ulp)\n", where, got, exp, u);
}

static const double GC_T[5] = { -60, -45, -26, -12, 0 };
static const double GC_W[5] = { 0, 1, 6, 12, 30 };
static const double GC_R[6] = { 1, 2, 4, 8, 20, 1000 };
static const double TC_MS[13] = { 0.02, 0.1, 0.5, 1, 5, 10, 15, 50, 100, 500, 1200, 2500, 20000 };
static const double SC_F[8] = { 10, 40, 100, 220, 1000, 4000, 12000, 20000 };
static const double KW_FS[5] = { 44100, 48000, 88200, 96000, 192000 };
static const double SPL_C[5][3] = { {1, 200, 2000}, {2, 300, 2000}, {3, 180, 2400},
                                    {3, 19000, 19500}, {2, 20000, 20000} };

struct TS { int style; double thresh, ratio, knee, range, mix, makeup, inGain; bool autoMakeup; };
static const TS TSTATES[6] = {
    { FRESH,    -20, 4,    6,  60, 100, 0, 0,  false },
    { SETTLING, -34, 6,    4,  60, 100, 3, 2,  false },
    { SPASM,    -28, 8,    0,  12, 50,  0, 0,  true  },
    { REPOSE,   -38, 2,    10, 60, 75,  0, -3, true  },
    { FRESH,    -50, 1000, 0,  24, 100, 0, 0,  false },
    { FRESH,    -20, 1,    6,  60, 100, 0, 0,  false }
};

struct RS {
    int style; double thresh, ratio, knee, attack, release, makeup, look, mix, hold, link;
    bool scOn; double scHp, scLp; bool delta; int place; double curve; bool autoRelSet, autoRelVal;
};
static const RS RSTATES[10] = {
    { FRESH,    -30, 4,  6,  10,  120, 0, 0, 100, 0,  100, false, 100, 12000, false, P_LR, 0,  false, false },
    { SETTLING, -34, 6,  4,  20,  300, 3, 0, 100, 0,  100, false, 100, 12000, false, P_LR, 0,  false, false },
    { SPASM,    -28, 8,  0,  0.5, 40,  4, 0, 100, 0,  100, false, 100, 12000, false, P_LR, 0,  false, false },
    { REPOSE,   -38, 2,  10, 30,  400, 2, 0, 100, 0,  100, false, 100, 12000, false, P_LR, 0,  false, false },
    { FRESH,    -32, 10, 3,  1,   90,  0, 5, 45,  20, 100, false, 100, 12000, false, P_LR, 0,  false, false },
    { FRESH,    -36, 6,  6,  8,   100, 0, 0, 100, 0,  50,  true,  220, 6000,  false, P_LR, 0,  false, false },
    { FRESH,    -30, 6,  6,  5,   100, 0, 0, 100, 0,  100, false, 100, 12000, true,  P_LR, 0,  false, false },
    { FRESH,    -30, 6,  6,  5,   100, 0, 0, 100, 0,  25,  false, 100, 12000, false, P_MS, 0,  false, false },
    { FRESH,    -28, 8,  2,  3,   200, 0, 0, 100, 0,  100, false, 100, 12000, false, P_LR, 80, true,  false },
    { SETTLING, -38, 10, 8,  15,  250, 0, 2, 100, 0,  100, false, 100, 12000, true,  P_MS, 50, false, false }
};

struct MS2 {
    int style; double thresh, ratio, knee; int bands; double x0, x1;
    double off[3], gain[3]; bool solo[3];
};
static const MS2 MSTATES[3] = {
    { FRESH,  -30, 6, 6, 2, 300, 2000, {0,0,0},   {0,0,0},   {false,false,false} },
    { REPOSE, -34, 4, 8, 3, 180, 2400, {-4,0,3},  {2,0,-1},  {false,false,false} },
    { SPASM,  -26, 8, 0, 3, 200, 3000, {0,0,0},   {0,0,0},   {false,true,false}  }
};

static State fromRS(const RS& o) {
    State s = defaultState();
    s.style = o.style; s.thresh = o.thresh; s.ratio = o.ratio; s.knee = o.knee;
    s.attack = o.attack; s.release = o.release; s.makeup = o.makeup;
    s.look = o.look; s.mix = o.mix; s.hold = o.hold; s.link = o.link;
    s.scOn = o.scOn; s.scHp = o.scHp; s.scLp = o.scLp;
    s.delta = o.delta; s.place = o.place; s.curve = o.curve;
    if (o.autoRelSet) s.autoRel = o.autoRelVal;
    return s;
}

int main() {
    const double FS = EXP_FS;
    int p = 0;
    char w[96];

    /* 1. gain computer */
    for (int a = 0; a < 5; a++)
        for (int b = 0; b < 5; b++)
            for (int c = 0; c < 6; c++)
                for (double x = -90; x <= 6; x += 6) {
                    std::snprintf(w, sizeof(w), "kneeGain T=%g W=%g R=%g x=%g", GC_T[a], GC_W[b], GC_R[c], x);
                    check(nd::kneeGain(x, GC_T[a], GC_W[b], invRatio(GC_R[c])), EXP_GC[p++], w);
                }

    /* 2. time constants */
    for (int i = 0; i < 13; i++) {
        std::snprintf(w, sizeof(w), "onePole %g ms", TC_MS[i]);
        check(nd::onePole(TC_MS[i], FS), EXP_TC[i], w);
    }

    /* 3. sidechain sections */
    p = 0;
    for (int i = 0; i < 8; i++) {
        nd::BqCoef h = nd::secSosHP(SC_F[i], M_SQRT1_2, FS);
        nd::BqCoef l = nd::secSosLP(SC_F[i], M_SQRT1_2, FS);
        const double got[10] = { h.b0, h.b1, h.b2, h.a1, h.a2, l.b0, l.b1, l.b2, l.a1, l.a2 };
        for (int k = 0; k < 10; k++) {
            std::snprintf(w, sizeof(w), "sc[%d] @%g", k, SC_F[i]);
            check(got[k], EXP_SCC[p++], w);
        }
    }

    /* 4. K-weighting, true-peak taps, lkfs */
    p = 0;
    for (int i = 0; i < 5; i++) {
        nd::BqCoef h = kweightHigh(KW_FS[i]), l = kweightLow(KW_FS[i]);
        const double got[10] = { h.b0, h.b1, h.b2, h.a1, h.a2, l.b0, l.b1, l.b2, l.a1, l.a2 };
        for (int k = 0; k < 10; k++) {
            std::snprintf(w, sizeof(w), "kweight[%d] @%g", k, KW_FS[i]);
            check(got[k], EXP_KW[p++], w);
        }
    }
    {
        TpTaps T = tpTaps();
        p = 0;
        for (int ph = 0; ph < TP_OS; ph++)
            for (int k = 0; k < TP_TAPS; k++) {
                std::snprintf(w, sizeof(w), "tpTap[%d][%d]", ph, k);
                check(T.t[ph][k], EXP_TPT[p++], w);
            }
        static const double LKP[5][2] = { {0,0}, {1e-6,1e-6}, {0.005,0.005}, {0.01,0.02}, {1,1} };
        for (int i = 0; i < 5; i++) {
            std::snprintf(w, sizeof(w), "lkfs[%d]", i);
            check(lkfs(LKP[i][0], LKP[i][1]), EXP_LK[i], w);
        }
    }

    /* 5. transfer + makeup */
    p = 0;
    for (int i = 0; i < 6; i++) {
        const TS& o = TSTATES[i];
        State s = defaultState();
        s.style = o.style; s.thresh = o.thresh; s.ratio = o.ratio; s.knee = o.knee;
        s.range = o.range; s.mix = o.mix; s.makeup = o.makeup; s.inGain = o.inGain;
        s.autoMakeup = o.autoMakeup;
        for (double x = -96; x <= 6; x += 3) {
            std::snprintf(w, sizeof(w), "transfer[%d] x=%g", i, x);
            check(transferAt(s, x), EXP_TF[p++], w);
        }
    }
    for (int i = 0; i < 6; i++) {
        const TS& o = TSTATES[i];
        State s = defaultState();
        s.style = o.style; s.thresh = o.thresh; s.ratio = o.ratio; s.knee = o.knee;
        s.range = o.range; s.mix = o.mix; s.makeup = o.makeup; s.inGain = o.inGain;
        s.autoMakeup = o.autoMakeup;
        std::snprintf(w, sizeof(w), "autoMakeup[%d]", i);
        check(autoMakeupDb(s), EXP_AMK[i], w);
    }

    /* 6. the sources must agree before anything rendered can */
    std::vector<double> srcL, srcR;
    makeNoise(424242u, EXP_N, srcL);
    makeNoise(133742u, EXP_N, srcR);
    for (int i = 0; i < EXP_N; i++) {
        double g = (i % 1200 < 120) ? 0.9 : 0.06;
        srcL[(size_t)i] *= g; srcR[(size_t)i] *= g;
    }
    p = 0;
    for (int i = 0; i < EXP_N; i += 97) {
        std::snprintf(w, sizeof(w), "srcL[%d]", i); check(srcL[(size_t)i], EXP_SRC[p++], w);
        std::snprintf(w, sizeof(w), "srcR[%d]", i); check(srcR[(size_t)i], EXP_SRC[p++], w);
    }

    /* 7. auto threshold */
    {
        static const double AT_R[6] = { 1, 2, 4, 8, 20, 1000 };
        static const double AT_G[3] = { -3, -6, -12 };
        p = 0;
        for (int i = 0; i < 6; i++)
            for (int k = 0; k < 3; k++) {
                std::snprintf(w, sizeof(w), "suggestThreshold r=%g g=%g", AT_R[i], AT_G[k]);
                check(suggestThreshold(srcL.data(), EXP_N, AT_R[i], AT_G[k]), EXP_AT[p++], w);
            }
    }

    /* 8. the splitter */
    p = 0;
    for (int i = 0; i < 5; i++) {
        Splitter sp;
        sp.init(FS);
        sp.set(SPL_C[i][0], SPL_C[i][1], SPL_C[i][2]);
        double out[MAX_BANDS * 2];
        int nb = (int)SPL_C[i][0];
        for (int k = 0; k < 600; k++) {
            sp.split(srcL[(size_t)k], srcR[(size_t)k], out);
            if (k % 7 == 0)
                for (int b = 0; b < nb * 2; b++) {
                    std::snprintf(w, sizeof(w), "split[%d] k=%d b=%d", i, k, b);
                    check(out[b], EXP_SPL[p++], w);
                }
        }
    }

    /* 9. rendered audio + meters */
    p = 0;
    int pm = 0;
    for (int i = 0; i < 10; i++) {
        State s = fromRS(RSTATES[i]);
        Engine e(FS);
        e.setState(s);
        std::vector<double> oL((size_t)EXP_N), oR((size_t)EXP_N);
        e.process(srcL.data(), srcR.data(), oL.data(), oR.data(), EXP_N);
        for (int k = 0; k < EXP_N; k += EXP_STRIDE) {
            std::snprintf(w, sizeof(w), "render[%d] L[%d]", i, k); check(oL[(size_t)k], EXP_REND[p++], w);
            std::snprintf(w, sizeof(w), "render[%d] R[%d]", i, k); check(oR[(size_t)k], EXP_REND[p++], w);
        }
        Meters m = e.meters();
        const double gm[8] = { m.gr, m.grPeak, m.tpL, m.tpR, m.lufsM, m.lufsS, m.lufsI, m.corr };
        static const char* mn[8] = { "gr","grPeak","tpL","tpR","lufsM","lufsS","lufsI","corr" };
        for (int k = 0; k < 8; k++) {
            std::snprintf(w, sizeof(w), "meter[%d] %s", i, mn[k]);
            check(gm[k], EXP_MET[pm++], w);
        }
    }

    /* 10. multiband */
    p = 0; pm = 0;
    for (int i = 0; i < 3; i++) {
        const MS2& o = MSTATES[i];
        State s = defaultState();
        s.style = o.style; s.thresh = o.thresh; s.ratio = o.ratio; s.knee = o.knee;
        s.bands = o.bands; s.xover[0] = o.x0; s.xover[1] = o.x1;
        for (int k = 0; k < 3; k++) {
            s.band[k].threshOff = o.off[k];
            s.band[k].gain = o.gain[k];
            s.band[k].solo = o.solo[k];
        }
        Multi mb(FS);
        mb.setState(s);
        std::vector<double> oL((size_t)EXP_N), oR((size_t)EXP_N);
        mb.process(srcL.data(), srcR.data(), oL.data(), oR.data(), EXP_N);
        for (int k = 0; k < EXP_N; k += EXP_STRIDE) {
            std::snprintf(w, sizeof(w), "mb[%d] L[%d]", i, k); check(oL[(size_t)k], EXP_MREND[p++], w);
            std::snprintf(w, sizeof(w), "mb[%d] R[%d]", i, k); check(oR[(size_t)k], EXP_MREND[p++], w);
        }
        Meters m = mb.meters();
        const double gm[8] = { m.gr, m.tpL, m.tpR, m.lufsI, m.corr,
                               m.bandGr[0], m.bandGr[1], m.bandGr[2] };
        static const char* mn[8] = { "gr","tpL","tpR","lufsI","corr","bandGr0","bandGr1","bandGr2" };
        for (int k = 0; k < 8; k++) {
            std::snprintf(w, sizeof(w), "mbMeter[%d] %s", i, mn[k]);
            check(gm[k], EXP_MMET[pm++], w);
        }
    }

    /* ---- 11. v0.4: tempo sync, per-band makeup, oversampled detection ---- */
    {
        static const double SYNC_BPM[4] = { 60, 90, 120, 174 };
        p = 0;
        for (int i = 0; i < 4; i++)
            for (int d = 0; d < NUM_SYNC; d++) {
                State s2 = defaultState();
                s2.release = 200; s2.relSync = d; s2.bpm = SYNC_BPM[i];
                std::snprintf(w, sizeof(w), "releaseMs bpm=%g div=%d", SYNC_BPM[i], d);
                check(releaseMs(sanitizeState(s2)), EXP_REL[p++], w);
            }
        static const double BMK[3][3] = { {-30,4,0}, {-24,8,6}, {-40,2,12} };
        p = 0;
        for (int i = 0; i < 3; i++) {
            State s2 = defaultState();
            s2.thresh = BMK[i][0]; s2.ratio = BMK[i][1]; s2.knee = BMK[i][2];
            s2.band[0].threshOff = -6; s2.band[1].threshOff = 0; s2.band[2].threshOff = 6;
            for (int k = 0; k < 3; k++) {
                std::snprintf(w, sizeof(w), "bandMakeup[%d][%d]", i, k);
                check(bandMakeupDb(s2, k), EXP_BMK[p++], w);
            }
        }
        struct OS { int style; double thresh, ratio, knee, attack, release;
                    int detect, relSync; double bpm; int osx;
                    bool os; double hold, taper; int arel; };
        /* rows 2-5 are round 8's selectable detector phase count;
           rows 6-9 are round 8's hold taper (os off, hold on).
           arel: -1 = leave the style default alone, 0/1 = force it. */
        static const OS OSS[10] = {
            { FRESH,    -12, 8, 0, 1,  100, D_PEAK, 0, 120, 4, true,   0,   0, -1 },
            { SPASM,    -20, 6, 2, 2,  150, D_AUTO, 5, 174, 4, true,   0,   0, -1 },
            { FRESH,    -12, 8, 0, 1,  100, D_PEAK, 0, 120, 2, true,   0,   0, -1 },
            { FRESH,    -12, 8, 0, 1,  100, D_PEAK, 0, 120, 4, true,   0,   0, -1 },
            { FRESH,    -12, 8, 0, 1,  100, D_PEAK, 0, 120, 8, true,   0,   0, -1 },
            { SETTLING, -22, 5, 4, 8,  220, D_AUTO, 0, 120, 8, true,   0,   0, -1 },
            { FRESH,    -26, 8, 0, 1,  300, D_AUTO, 0, 120, 4, false, 40,   0, -1 },
            { FRESH,    -26, 8, 0, 1,  300, D_AUTO, 0, 120, 4, false, 40,  55, -1 },
            { FRESH,    -26, 8, 0, 1,  300, D_AUTO, 0, 120, 4, false, 40, 100,  1 },
            { SETTLING, -30, 4, 6, 12, 260, D_AUTO, 0, 120, 4, false, 25,  80, -1 }
        };
        p = 0;
        for (int i = 0; i < 10; i++) {
            State s2 = defaultState();
            s2.style = OSS[i].style; s2.thresh = OSS[i].thresh; s2.ratio = OSS[i].ratio;
            s2.knee = OSS[i].knee; s2.attack = OSS[i].attack; s2.release = OSS[i].release;
            s2.detect = OSS[i].detect; s2.relSync = OSS[i].relSync; s2.bpm = OSS[i].bpm;
            s2.detOs = OSS[i].os; s2.detOsX = OSS[i].osx;
            s2.hold = OSS[i].hold; s2.holdTaper = OSS[i].taper;
            if (OSS[i].arel >= 0) s2.autoRel = OSS[i].arel != 0;
            Engine e(FS);
            e.setState(s2);
            std::vector<double> oL((size_t)EXP_N), oR((size_t)EXP_N);
            e.process(srcL.data(), srcR.data(), oL.data(), oR.data(), EXP_N);
            for (int k = 0; k < EXP_N; k += EXP_STRIDE) {
                std::snprintf(w, sizeof(w), "os[%d] L[%d]", i, k); check(oL[(size_t)k], EXP_OREND[p++], w);
                std::snprintf(w, sizeof(w), "os[%d] R[%d]", i, k); check(oR[(size_t)k], EXP_OREND[p++], w);
            }
        }
    }

    /* ---- 12. the FFT ---- */
    {
        p = 0;
        static const int LENS[3] = { 64, 256, 1024 };
        for (int i = 0; i < 3; i++) {
            int len = LENS[i], outLen = len / 2;
            std::vector<double> out((size_t)outLen);
            spectrum(srcL.data(), len, out.data(), outLen);
            for (int k = 0; k < outLen; k += 3) {
                std::snprintf(w, sizeof(w), "spectrum[%d][%d]", len, k);
                check(out[(size_t)k], EXP_SPEC[p++], w);
            }
        }
        std::vector<double> fr((size_t)256, 0.0), fi((size_t)256, 0.0);
        for (int i = 0; i < 256; i++) fr[(size_t)i] = srcL[(size_t)i];
        fft(fr.data(), fi.data(), 256);
        for (int i = 0; i < 256; i += 5) {
            std::snprintf(w, sizeof(w), "fft re[%d]", i); check(fr[(size_t)i], EXP_SPEC[p++], w);
            std::snprintf(w, sizeof(w), "fft im[%d]", i); check(fi[(size_t)i], EXP_SPEC[p++], w);
        }
    }

    /* ---- 13. round 9: per-band delta, band sidechain, transient split ---- */
    {
        struct R9 { int style; double thresh, ratio, knee; int bands;
                    double x0, x1; bool delta; int deltaBand, scBand; double tsSplit; };
        static const R9 RR[4] = {
            { FRESH,    -34, 6, 6, 3, 200, 3000, true,  2, 0, 0   },
            { FRESH,    -34, 8, 4, 3, 180, 2400, false, 0, 3, 0   },
            { SPASM,    -30, 6, 2, 1, 200, 2000, false, 0, 0, 100 },
            { SETTLING, -32, 5, 6, 2, 250, 4000, false, 0, 1, 55  }
        };
        p = 0;
        for (int i = 0; i < 4; i++) {
            State s = defaultState();
            s.style = RR[i].style; s.thresh = RR[i].thresh; s.ratio = RR[i].ratio;
            s.knee = RR[i].knee; s.bands = RR[i].bands;
            s.xover[0] = RR[i].x0; s.xover[1] = RR[i].x1;
            s.delta = RR[i].delta; s.deltaBand = RR[i].deltaBand;
            s.scBand = RR[i].scBand; s.tsSplit = RR[i].tsSplit;
            std::vector<double> oL((size_t)EXP_N), oR((size_t)EXP_N);
            if (s.bands > 1) {
                Multi m(FS); m.setState(s);
                m.process(srcL.data(), srcR.data(), oL.data(), oR.data(), EXP_N);
            } else {
                Engine e(FS); e.setState(s);
                e.process(srcL.data(), srcR.data(), oL.data(), oR.data(), EXP_N);
            }
            for (int k = 0; k < EXP_N; k += EXP_STRIDE) {
                std::snprintf(w, sizeof(w), "r9[%d] L[%d]", i, k); check(oL[(size_t)k], EXP_R9[p++], w);
                std::snprintf(w, sizeof(w), "r9[%d] R[%d]", i, k); check(oR[(size_t)k], EXP_R9[p++], w);
            }
        }
    }

    /* ---- 14. AUDIT: poisoned input, bypass, sidechain listen ---- */
    {
        std::vector<double> pL(srcL), pR(srcR);
        pL[7] = INFINITY;  pR[7] = -INFINITY;
        pL[32] = NAN;      pR[33] = INFINITY;
        pL[(size_t)EXP_N - 1] = -INFINITY;

        /* look and bypassSplit joined this table when bypass stopped being
           arithmetically trivial: it now runs a delay line in the engine and
           a second one in the wrapper, whose dry tap sits between the input
           guard and the splitter. Lookahead is non-zero on the new cases on
           purpose — at look = 0 the delay lines are pass-throughs and would
           hide an indexing slip. */
        struct AU { int style; double thresh, ratio; int bands; double x0, x1;
                    bool poison, bypass, scOn, scListen; double look; bool bypassSplit; };
        static const AU AA[14] = {
            { FRESH,    -30, 8, 1, 200, 2000, true,  false, false, false,  0.0, false },
            { SETTLING, -30, 8, 1, 200, 2000, true,  false, false, false,  0.0, false },
            { FRESH,    -30, 8, 3, 200, 3000, true,  false, false, false,  0.0, false },
            { FRESH,    -30, 8, 1, 200, 2000, false, true,  false, false,  0.0, false },
            { FRESH,    -30, 8, 1, 200, 2000, false, false, true,  true ,  0.0, false },
            { REPOSE,   -26, 4, 2, 300, 3000, false, false, true,  true ,  0.0, false },
            { FRESH,    -30, 8, 1, 200, 2000, false, true,  false, false,  7.0, false },
            { SETTLING, -30, 8, 1, 200, 2000, false, true,  false, false,  3.5, false },
            { FRESH,    -30, 8, 2, 300, 3000, false, true,  false, false,  7.0, false },
            { FRESH,    -30, 8, 2, 300, 3000, false, true,  false, false,  7.0, true  },
            { REPOSE,   -26, 4, 3, 200, 3000, false, true,  false, false, 11.0, false },
            { REPOSE,   -26, 4, 3, 200, 3000, false, true,  false, false, 11.0, true  },
            { FRESH,    -30, 8, 3, 200, 3000, false, false, false, false,  7.0, true  },
            { FRESH,    -30, 8, 3, 200, 3000, true,  true,  false, false,  5.0, false }
        };
        p = 0;
        for (int i = 0; i < 14; i++) {
            State s = defaultState();
            s.style = AA[i].style; s.thresh = AA[i].thresh; s.ratio = AA[i].ratio;
            s.bands = AA[i].bands; s.xover[0] = AA[i].x0; s.xover[1] = AA[i].x1;
            s.bypass = AA[i].bypass; s.scOn = AA[i].scOn; s.scListen = AA[i].scListen;
            s.look = AA[i].look; s.bypassSplit = AA[i].bypassSplit;
            const double* iL = AA[i].poison ? pL.data() : srcL.data();
            const double* iR = AA[i].poison ? pR.data() : srcR.data();
            std::vector<double> oL((size_t)EXP_N), oR((size_t)EXP_N);
            if (s.bands > 1) {
                Multi m(FS); m.setState(s);
                m.process(iL, iR, oL.data(), oR.data(), EXP_N);
            } else {
                Engine e(FS); e.setState(s);
                e.process(iL, iR, oL.data(), oR.data(), EXP_N);
            }
            for (int k = 0; k < EXP_N; k += EXP_STRIDE) {
                std::snprintf(w, sizeof(w), "aud[%d] L[%d]", i, k); check(oL[(size_t)k], EXP_AUD[p++], w);
                std::snprintf(w, sizeof(w), "aud[%d] R[%d]", i, k); check(oR[(size_t)k], EXP_AUD[p++], w);
            }
        }
    }

    /* ---- THE GATE ON THE GATE ----
       A parity run can report green while proving nothing. It happened:
       the linker could not overwrite the old binary, the stale one ran,
       and it printed a confident all-bit-exact for a build that did not
       contain the new tests. The check COUNT is the tell — it is emitted
       alongside the truth values, so a binary that skipped a block, or a
       binary older than the header it claims to test, cannot pass. */
    if (checks != EXP_CHECKS) {
        std::printf("PARITY GATE: ran %d checks but the header expects %d.\n",
                    checks, EXP_CHECKS);
        std::printf("  The binary and the truth values disagree about what the\n"
                    "  test IS. Rebuild — this run proves nothing.\n");
        return 1;
    }

    if (fails) {
        std::printf("\nPARITY FAILED: %d of %d checks differ. Worst %.0f ulp at %s\n",
                    fails, checks, worstUlp, worstWhere);
        std::printf("Check: -ffp-contract=off set? every transcendental through nm::?\n");
        return 1;
    }
    std::printf("PARITY: %d checks, all bit-exact. The twin is identical.\n", checks);
    return 0;
}
