/* CASKET parity gate — C++ core vs JS truth values.
   g++ -std=c++17 -O2 -ffp-contract=off -o core_parity tests/core_parity.cpp && ./core_parity
   PARITY LAW: -ffp-contract=off (no FMA fusion). Gate: bit-exact.
   The polyphase inner loop is a long multiply-accumulate chain — exactly
   the shape GCC most wants to fuse — so this matters more here than it
   did in AUTOPSY. */
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cmath>
#include <limits>
#include <string>
#include "../casket-juce/Source/CasketCore.h"
#include "parity_expected.h"

using namespace casket;

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
static void check(double got, double exp_, const char* where) {
    checks++;
    if (got == exp_) return;
    if (std::isinf(got) && std::isinf(exp_) && ((got > 0) == (exp_ > 0))) return;
    double u = ulpDiff(got, exp_);
    if (u > worstUlp) { worstUlp = u; std::snprintf(worstWhere, sizeof(worstWhere), "%s", where); }
    fails++;
    if (fails <= 10)
        std::printf("  MISMATCH %s: got %.17g expected %.17g (%.0f ulp)\n", where, got, exp_, u);
}
static void checkInt(int got, int exp_, const char* where) {
    checks++;
    if (got == exp_) return;
    fails++;
    if (fails <= 10) std::printf("  MISMATCH %s: got %d expected %d\n", where, got, exp_);
}

static const int LININGS[5] = { 1, 2, 4, 8, 16 };

int main() {
    std::printf("CASKET parity gate — C++ twin vs JS truth\n");
    char w[96];

    /* ---- 1. oversampler ---- */
    {
        int pi = 0;
        for (int mi = 0; mi < 5; mi++) {
            Oversampler o = designOversampler(LININGS[mi], OS_Q);
            int base = EXP_TAP_OFF[mi];
            checkInt(o.len, EXP_TAP_OFF[mi + 1] - base, "oversampler length");
            for (int k = 0; k < o.len; k++) {
                std::snprintf(w, sizeof(w), "taps[%dx][%d]", LININGS[mi], k);
                check(o.taps[(size_t)k], EXP_TAPS[base + k], w);
            }
            for (size_t p = 0; p < o.phases.size(); p++) {
                double s = 0;
                for (size_t j = 0; j < o.phases[p].size(); j++) s += o.phases[p][j];
                std::snprintf(w, sizeof(w), "phaseSum[%dx][%zu]", LININGS[mi], p);
                check(s, EXP_PHASE_SUMS[pi++], w);
            }
        }
    }

    /* ---- 1b. the seal's decimator ---- */
    {
        const int SEALED[4] = { 2, 4, 8, 16 };
        for (int mi = 0; mi < 4; mi++) {
            Decimator d = designDecimator(SEALED[mi], DEC_Q, DEC_CUT);
            int base = EXP_DEC_OFF[mi];
            checkInt(d.len, EXP_DEC_OFF[mi + 1] - base, "decimator length");
            for (int k = 0; k < d.len; k++) {
                std::snprintf(w, sizeof(w), "dec[%dx][%d]", SEALED[mi], k);
                check(d.taps[(size_t)k], EXP_DEC[base + k], w);
            }
        }
    }

    /* ---- 2. K-weighting ---- */
    for (int r = 0; r < EXP_RATE_N; r++) {
        KWeight k = kWeight(EXP_RATES[r]);
        const double got[10] = { k.shelf.b0, k.shelf.b1, k.shelf.b2, k.shelf.a1, k.shelf.a2,
                                 k.hp.b0, k.hp.b1, k.hp.b2, k.hp.a1, k.hp.a2 };
        for (int i = 0; i < 10; i++) {
            std::snprintf(w, sizeof(w), "kWeight[%g][%d]", EXP_RATES[r], i);
            check(got[i], EXP_KW[r * 10 + i], w);
        }
    }

    /* ---- 3. gain computer ---- */
    {
        int n = 0;
        const double KNEES[3] = { 0, 3, 12 };
        for (int ki = 0; ki < 3; ki++) {
            for (int i = 0; i <= 200; i++) {
                double x = -40 + i * 0.25;
                std::snprintf(w, sizeof(w), "kneeGain[W=%g][%d]", KNEES[ki], i);
                check(nd::kneeGain(x, -1.0, KNEES[ki], 0), EXP_GC[n++], w);
            }
        }
    }

    /* ---- 4. transferAt ---- */
    {
        int n = 0;
        for (int s = 0; s < 5; s++) {
            State st = fromStyle(s);
            st.drive = 6; st.lid = -1.0;
            for (int i = 0; i <= 40; i++) {
                std::snprintf(w, sizeof(w), "transferAt[style %d][%d]", s, i);
                check(transferAt(st, -40 + i), EXP_TF[n++], w);
            }
        }
    }

    /* ---- 5. rendered audio + meters ---- */
    {
        const int N = EXP_REND_LEN;
        std::vector<double> a, b;
        makeNoise(424242, N, a);
        makeNoise(133742, N, b);
        for (int i = 0; i < N; i++) {
            double v = a[(size_t)i] * 4;
            a[(size_t)i] = v > 1 ? 1 : (v < -1 ? -1 : v);
            v = b[(size_t)i] * 4;
            b[(size_t)i] = v > 1 ? 1 : (v < -1 ? -1 : v);
        }
        for (int c = 0; c < EXP_REND_N; c++) {
            std::string nm = EXP_REND_NAMES[c];
            int style = VELVET;
            if (nm == "pine" || nm == "lining1" || nm == "dusted") style = PINE;
            else if (nm == "bypassSealed") style = LEAD;
            else if (nm == "oak") style = OAK;
            else if (nm == "iron" || nm == "saturated") style = IRON;
            else if (nm == "lead" || nm == "sealedDust") style = LEAD;
            State st = fromStyle(style);
            st.lid = -1.0; st.drive = 9;
            if (nm == "lining16") { st.lining = 16; st.vigil = 4; st.knee = 6; st.hold = 20; }
            else if (nm == "lining1") { st.lining = 1; st.vigil = 0.5; }
            else if (nm == "linked0") { st.link = 0; st.drive = 14; }
            else if (nm == "dusted") { st.dust = DUST_SHAPED; st.dustBits = 16; st.dustSeed = 4711; }
            else if (nm == "saturated") { st.sat = 90; st.drive = 15; st.unity = true; }
            else if (nm == "sealed2x") { st.seal = true; st.lining = 2; st.drive = 12; }
            else if (nm == "sealed4x") { st.seal = true; st.lining = 4; st.drive = 12; }
            else if (nm == "sealed16x") { st.seal = true; st.lining = 16; st.vigil = 1; }
            else if (nm == "sealedDust") { st.dust = DUST_SHAPED; st.dustBits = 24; st.dustSeed = 909; }
            else if (nm == "midside") { st.ms = true; st.msMid = 3; st.msSide = -4; st.drive = 10; }
            else if (nm == "split") { st.drive = 12; }
            else if (nm == "bypassed") { st.bypass = true; st.drive = 9; }
            else if (nm == "bypassSealed") { st.bypass = true; st.seal = true; }

            Engine e;
            e.prepare(48000);
            e.setState(st);
            std::vector<double> oL((size_t)N), oR((size_t)N);
            if (nm == "split") {
                const int chunks[5] = { 111, 333, 7, 1024, 240 };
                int ci = 0, p = 0;
                while (p < N) {
                    int m = chunks[ci % 5]; if (p + m > N) m = N - p;
                    e.process(&a[(size_t)p], &b[(size_t)p], &oL[(size_t)p], &oR[(size_t)p], m);
                    p += m; ci++;
                }
            } else {
                e.process(&a[0], &b[0], &oL[0], &oR[0], N);
            }
            int base = EXP_REND_OFF[c], n = 0;
            for (int i = 0; i < N; i += EXP_REND_STRIDE) {
                std::snprintf(w, sizeof(w), "render[%s].L[%d]", EXP_REND_NAMES[c], i);
                check(oL[(size_t)i], EXP_REND[base + n++], w);
                std::snprintf(w, sizeof(w), "render[%s].R[%d]", EXP_REND_NAMES[c], i);
                check(oR[(size_t)i], EXP_REND[base + n++], w);
            }
            Meters m;
            e.meters(m);
            std::snprintf(w, sizeof(w), "render[%s].peak", EXP_REND_NAMES[c]);
            check(m.peak, EXP_REND[base + n++], w);
            std::snprintf(w, sizeof(w), "render[%s].truePeak", EXP_REND_NAMES[c]);
            check(m.truePeak, EXP_REND[base + n++], w);
            std::snprintf(w, sizeof(w), "render[%s].gr", EXP_REND_NAMES[c]);
            check(m.gr, EXP_REND[base + n++], w);
            std::snprintf(w, sizeof(w), "render[%s].grPeak", EXP_REND_NAMES[c]);
            check(m.grPeak, EXP_REND[base + n++], w);
            /* the trace — display-only, and therefore the surface most
               likely to drift between the languages unwatched */
            Trace tr;
            e.trace(tr);
            std::snprintf(w, sizeof(w), "render[%s].trace.inPeak", EXP_REND_NAMES[c]);
            check(tr.inPeak, EXP_REND[base + n++], w);
            std::snprintf(w, sizeof(w), "render[%s].trace.outPeak", EXP_REND_NAMES[c]);
            check(tr.outPeak, EXP_REND[base + n++], w);
            std::snprintf(w, sizeof(w), "render[%s].trace.gr", EXP_REND_NAMES[c]);
            check(tr.gr, EXP_REND[base + n++], w);
            std::snprintf(w, sizeof(w), "render[%s].trace.inPeakDb", EXP_REND_NAMES[c]);
            check(tr.inPeakDb, EXP_REND[base + n++], w);
            std::snprintf(w, sizeof(w), "render[%s].trace.outPeakDb", EXP_REND_NAMES[c]);
            check(tr.outPeakDb, EXP_REND[base + n++], w);
            checkInt(base + n, EXP_REND_OFF[c + 1], "render block length");
        }
    }

    /* ---- 5b. loudness range ---- */
    {
        const double PROG[2][4][2] = {
            { { -20, 8 }, { -30, 8 }, { -20, 8 }, { -30, 8 } },
            { { -20, 8 }, { -26, 8 }, { -20, 8 }, { -26, 8 } }
        };
        int n = 0;
        for (int p = 0; p < 2; p++) {
            State s2; s2.bypass = true;
            Engine e2; e2.prepare(48000); e2.setState(s2);
            for (int g = 0; g < 4; g++) {
                int len = (int)std::floor(48000 * PROG[p][g][1] + 0.5);
                std::vector<double> x;
                makeSine(1000, 48000, len, std::pow(10.0, PROG[p][g][0] / 20.0), x);
                std::vector<double> a((size_t)len), b((size_t)len);
                e2.process(&x[0], &x[0], &a[0], &b[0], len);
            }
            Meters m2; e2.meters(m2);
            std::snprintf(w, sizeof(w), "lra[prog %d]", p);
            check(m2.lra, EXP_LRA[n++], w);
            std::snprintf(w, sizeof(w), "lra[prog %d].integrated", p);
            check(m2.integrated, EXP_LRA[n++], w);
        }
    }

    /* ---- 6. latency ---- */
    {
        int n = 0;
        const double VIG[5] = { 0.1, 1, 2, 5, 20 };
        for (int mi = 0; mi < 5; mi++) {
            for (int vi = 0; vi < 5; vi++) {
                for (int si = 0; si < 2; si++) {
                    State st;
                    st.lining = LININGS[mi]; st.vigil = VIG[vi]; st.seal = (si == 1);
                    std::snprintf(w, sizeof(w), "latency[%dx][%g ms][seal %d]",
                                  LININGS[mi], VIG[vi], si);
                    checkInt(latencySamples(st, 48000), EXP_LAT[n++], w);
                }
            }
        }
    }

    /* ---- 6b. the quantiser, where the two round() spellings diverge ---- */
    {
        const double QX[13] = { 0.35, -0.35, -9.75, 0.25, -0.05, 2.5, -2.5,
                                0.15, -0.15, 13.45, -11.95, 0.005, -0.005 };
        const double QG[13] = { 0.1, 0.1, 0.1, 0.1, 0.1, 1, 1,
                                0.1, 0.1, 0.1, 0.1, 0.01, 0.01 };
        for (int i = 0; i < EXP_QUANT_N; i++) {
            std::snprintf(w, sizeof(w), "quantize(%g, %g)", QX[i], QG[i]);
            check(quantize(QX[i], QG[i]), EXP_QUANT[i], w);
        }
    }

    /* ---- 7. THE OFFLINE TOOLS ----
       Ported this round. The gate covers every scalar these tools return,
       booleans included: `reached` and `covered` are the fields a user acts
       on, and a boolean that disagrees between the twins is a plugin that
       contradicts the browser about whether the ceiling is safe. */
    {
        int n = 0;
        const int N = 24000;   /* 0.5 s — shorter never opens the BS.1770 gate */
        std::vector<double> noiseL, noiseR, sineL, sineR, clipL, noise2;
        makeNoise(31, N, noiseL); makeNoise(32, N, noiseR);
        makeSine(997, 48000, N, 0.85, sineL); makeSine(1103, 48000, N, 0.85, sineR);
        makeNoise(33, N, clipL);
        for (int i = 0; i < N; i++) {
            double v = clipL[(size_t)i] * 3;
            clipL[(size_t)i] = v > 1 ? 1 : (v < -1 ? -1 : v);
        }
        makeNoise(34, N, noise2);

        const double* MATS[3][2] = {
            { noiseL.data(), noiseR.data() },
            { sineL.data(),  sineR.data()  },
            { clipL.data(),  noise2.data() }
        };
        const char* MATN[3] = { "noise", "sine", "clipped" };
        const int STY[2] = { PINE, LEAD };
        const char* STYN[2] = { "pine", "lead" };

        auto styled = [](int s) {
            State st = fromStyle(s);
            st.style = s; st.drive = 4; st.dust = DUST_OFF;
            return st;
        };

        for (int mi = 0; mi < 3; mi++) {
            for (int si = 0; si < 2; si++) {
                State st = styled(STY[si]);
                const double* A = MATS[mi][0];
                const double* B = MATS[mi][1];

                Offline r = renderOffline(st, A, B, N, 48000);
                std::snprintf(w, sizeof(w), "renderOffline[%s][%s]", MATN[mi], STYN[si]);
                check(r.meters.integrated, EXP_OFFLINE[n++], w);
                check(r.meters.momentary,  EXP_OFFLINE[n++], w);
                check(r.meters.shortTerm,  EXP_OFFLINE[n++], w);
                check(r.meters.lra,        EXP_OFFLINE[n++], w);
                check(r.meters.peakDb,     EXP_OFFLINE[n++], w);
                check(r.meters.truePeakDb, EXP_OFFLINE[n++], w);
                check(r.meters.grPeak,     EXP_OFFLINE[n++], w);
                check((double)r.latency,   EXP_OFFLINE[n++], w);
                { const int IDX[6] = { 0, 1, 37, 512, 2048, 23999 };
                  for (int k = 0; k < 6; k++) {
                      check(r.L[(size_t)IDX[k]], EXP_OFFLINE[n++], w);
                      check(r.R[(size_t)IDX[k]], EXP_OFFLINE[n++], w);
                  } }

                DriveResult ad = autoDrive(st, A, B, N, 48000, -14, 4, 0.1);
                std::snprintf(w, sizeof(w), "autoDrive[%s][%s]", MATN[mi], STYN[si]);
                check(ad.drive,    EXP_OFFLINE[n++], w);
                check(ad.lufs,     EXP_OFFLINE[n++], w);
                check(ad.truePeak, EXP_OFFLINE[n++], w);
                check(ad.gr,       EXP_OFFLINE[n++], w);
                check(ad.error,    EXP_OFFLINE[n++], w);
                check(ad.reached ? 1.0 : 0.0, EXP_OFFLINE[n++], w);
                check(ad.grid,     EXP_OFFLINE[n++], w);

                /* the rails, forced to win by targets that cannot be met */
                { const double TGT[2] = { -40, 6 };
                  for (int k = 0; k < 2; k++) {
                      DriveResult ar = autoDrive(st, A, B, N, 48000, TGT[k], 4, 0.1);
                      std::snprintf(w, sizeof(w), "autoDrive rail[%g][%s][%s]",
                                    TGT[k], MATN[mi], STYN[si]);
                      check(ar.drive, EXP_OFFLINE[n++], w);
                      check(ar.lufs,  EXP_OFFLINE[n++], w);
                      check(ar.error, EXP_OFFLINE[n++], w);
                      check(ar.reached ? 1.0 : 0.0, EXP_OFFLINE[n++], w);
                  } }

                MarginResult am = autoMargin(st, A, B, N, 48000, 3);
                std::snprintf(w, sizeof(w), "autoMargin[%s][%s]", MATN[mi], STYN[si]);
                check(am.truePeak,     EXP_OFFLINE[n++], w);
                check(am.verifiedPeak, EXP_OFFLINE[n++], w);
                check(am.lid,          EXP_OFFLINE[n++], w);
                check(am.residual,     EXP_OFFLINE[n++], w);
                check(am.margin,       EXP_OFFLINE[n++], w);
                check(am.covered ? 1.0 : 0.0, EXP_OFFLINE[n++], w);
            }
            DiffResult df = difference(styled(PINE), styled(LEAD),
                                       MATS[mi][0], MATS[mi][1], N, 48000);
            std::snprintf(w, sizeof(w), "difference[%s]", MATN[mi]);
            check(df.peakDb, EXP_OFFLINE[n++], w);
            check(df.rmsDb,  EXP_OFFLINE[n++], w);
            check(df.identical ? 1.0 : 0.0, EXP_OFFLINE[n++], w);
            check((double)df.latencyA, EXP_OFFLINE[n++], w);
            check((double)df.latencyB, EXP_OFFLINE[n++], w);
            { const int IDX[4] = { 0, 100, 1000, 23999 };
              for (int k = 0; k < 4; k++) {
                  check(df.L[(size_t)IDX[k]], EXP_OFFLINE[n++], w);
                  check(df.R[(size_t)IDX[k]], EXP_OFFLINE[n++], w);
              } }
        }
        if (n != EXP_OFFLINE_N) {
            std::printf("  OFFLINE COUNT MISMATCH: consumed %d of %d\n", n, EXP_OFFLINE_N);
            fails++;
        }
    }

    std::printf("\n%d checks, %d mismatches\n", checks, fails);
    if (fails) {
        std::printf("worst: %s at %.0f ulp\n", worstWhere, worstUlp);
        std::printf("PARITY BROKEN — the twin has drifted.\n");
        return 1;
    }
    std::printf("parity bit-exact — the twins are identical.\n");
    return 0;
}
