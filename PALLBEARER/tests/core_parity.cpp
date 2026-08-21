/* PALLBEARER parity gate — C++ core vs JS truth values.
   g++ -std=c++17 -O2 -ffp-contract=off -o core_parity tests/core_parity.cpp && ./core_parity
   INTERCHANGE law 1: -ffp-contract=off. Gate: bit-exact.
   The case lists here mirror tests/parity_emit.js exactly. */
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cmath>
#include <string>
#include <vector>
#include <limits>
#include "../pallbearer-juce/Source/PallbearerCore.h"
#include "parity_expected.h"

using namespace pallbearer;

static int fails = 0;
static long checks = 0;
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
    double u = ulpDiff(got, exp_);
    if (u > worstUlp) { worstUlp = u; std::snprintf(worstWhere, sizeof(worstWhere), "%s", where); }
    fails++;
    if (fails <= 12)
        std::printf("  MISMATCH %s: got %.17g expected %.17g (%.0f ulp)\n", where, got, exp_, u);
}
static void checkU(std::uint32_t got, std::uint32_t exp_, const char* where) {
    checks++;
    if (got == exp_) return;
    fails++;
    if (fails <= 12)
        std::printf("  MISMATCH %s: got %u expected %u\n", where, got, exp_);
}

/* ---- mirrored case lists ---- */
static const std::uint32_t RNG_SEEDS[7] = { 1u, 2u, 12345u, 0x9E3779B9u, 4294967295u, 7u, 999999u };
static const int SEED_NOTES[6] = { 23, 28, 33, 40, 55, 67 };
static const int SEED_STR[5] = { 0, 1, 2, 3, 4 };
static const std::uint32_t SEED_CNT[5] = { 1u, 2u, 17u, 1000u, 65535u };
static const double LG_F[8] = { 20, 30.87, 41.2, 55, 82.4, 98, 196, 400 };
static const double LG_D[7] = { 0.5, 1, 2.5, 4.5, 8, 12, 0 };
static const double DI_F[7] = { 20, 41.2, 60, 98, 120, 196, 400 };
static const double DI_I[5] = { 0, 0.15, 0.35, 0.6, 1 };
static const double VB_V[5] = { 0, 0.25, 0.5, 0.75, 1 };
static const double VB_A[4] = { 0, 0.3, 0.55, 1 };
static const char* STYLES[5] = { "finger", "pick", "slap", "thumb", "muted" };
static const double HARD[5] = { 0, 0.25, 0.45, 0.8, 1 };
static const char* ARTICS[5] = { "normal", "harmonic", "ghost", "palm", "dead" };
static const double AP_FRAC[6] = { 0.0001, 0.1, 0.35, 0.5, 0.77, 0.9999 };
static const double AP_COEF[5] = { -0.999, -0.42, 0, 0.3, 0.999 };
static const double BODY_F[5] = { 40, 62, 92, 160, 260 };
static const double BODY_Q[3] = { 0.5, 3.2, 8 };
static const double BODY_W[3] = { 0, 0.4, 1 };
static const int FB_HAND[4] = { 0, 5, 12, 19 };
static const double FB_VEL[3] = { 0, 3, -3 };
static const double COIL_F[5] = { 1200, 2200, 3100, 4800, 6500 };
static const double COIL_Q[4] = { 0.4, 1.35, 3, 6 };

int main() {
    const double SR = EXP_SR;
    std::printf("PALLBEARER parity gate — JS truth vs C++ core\n");
    std::printf("  -ffp-contract=off (LAW 1) · bit-exact gate\n\n");

    /* ---- 1. the dice ---- */
    { int k = 0;
      for (int s = 0; s < 7; ++s) {
        Rng r(RNG_SEEDS[s]);
        for (int i = 0; i < 64; ++i) checkU(r.next(), EXP_RNG[k++], "rng");
      } }
    { int k = 0;
      for (int a = 0; a < 6; ++a) for (int b = 0; b < 5; ++b) for (int c = 0; c < 5; ++c)
        checkU(seedFor(0x5EED1Eu, SEED_NOTES[a], SEED_STR[b], SEED_CNT[c]), EXP_SEEDFOR[k++], "seedFor");
    }

    /* ---- 2. pure helpers ---- */
    for (int n = 0; n <= 127; ++n) check(midiToFreq(n), EXP_MTF[n], "midiToFreq");
    { int k = 0;
      for (int f = 0; f < 8; ++f) for (int d = 0; d < 7; ++d)
        check(loopGainFor(LG_F[f], LG_D[d], SR), EXP_LOOPGAIN[k++], "loopGainFor"); }
    { int k = 0;
      for (int f = 0; f < 7; ++f) for (int i = 0; i < 5; ++i)
        check(dispersionFor(DI_F[f], DI_I[i]), EXP_DISP[k++], "dispersionFor"); }
    { int k = 0;
      for (int v = 0; v < 5; ++v) for (int a = 0; a < 4; ++a)
        check(velBrightness(VB_V[v], VB_A[a]), EXP_VELBRIGHT[k++], "velBrightness"); }
    { int k = 0;
      for (int s = 0; s < 5; ++s) for (int h = 0; h < 5; ++h) {
        Shape sh = styleShape(STYLES[s], HARD[h]);
        check(sh.bright, EXP_STYLE[k++], "styleShape.bright");
        check(sh.burst,  EXP_STYLE[k++], "styleShape.burst");
        check(sh.click,  EXP_STYLE[k++], "styleShape.click");
        check(sh.damp,   EXP_STYLE[k++], "styleShape.damp");
        check(sh.posBias,EXP_STYLE[k++], "styleShape.posBias");
      } }
    { int k = 0;
      for (int a = 0; a < 5; ++a) {
        Artic x = articShape(ARTICS[a]);
        check(x.mult, EXP_ARTIC[k++], "artic.mult");
        check(x.damp, EXP_ARTIC[k++], "artic.damp");
        check(x.decay,EXP_ARTIC[k++], "artic.decay");
        check(x.amp,  EXP_ARTIC[k++], "artic.amp");
        check(x.noise,EXP_ARTIC[k++], "artic.noise");
        check(x.buzz, EXP_ARTIC[k++], "artic.buzz");
      } }

    /* ---- 3. allpass ---- */
    { int k = 0;
      for (int f = 0; f < 6; ++f) {
        Allpass1 a; a.setFrac(AP_FRAC[f]);
        check(a.c, EXP_ALLPASS[k++], "allpass.c");
        for (int i = 0; i < 24; ++i)
          check(a.tick(i == 0 ? 1.0 : (i % 3 == 0 ? -0.5 : 0.25)), EXP_ALLPASS[k++], "allpass.tick");
      }
      for (int c = 0; c < 5; ++c) {
        Allpass1 a; a.setCoeff(AP_COEF[c]);
        for (int i = 0; i < 24; ++i)
          check(a.tick(std::sin(i * 0.37)), EXP_ALLPASS[k++], "allpass.coef.tick");
      } }

    /* ---- 3b. pickup coil resonance ---- */
    { int k = 0;
      for (int f = 0; f < 5; ++f) for (int q = 0; q < 4; ++q) {
        Biquad b; b.lowpassRes(COIL_F[f], COIL_Q[q], SR);
        check(b.b0, EXP_COIL[k++], "coil.b0");
        check(b.b1, EXP_COIL[k++], "coil.b1");
        check(b.b2, EXP_COIL[k++], "coil.b2");
        check(b.a1, EXP_COIL[k++], "coil.a1");
        check(b.a2, EXP_COIL[k++], "coil.a2");
        for (int i = 0; i < 40; ++i)
          check(b.tick(i == 0 ? 1.0 : (i % 5 == 0 ? -0.4 : 0.15)), EXP_COIL[k++], "coil.tick");
      } }

    /* ---- 4. body ---- */
    { int k = 0;
      for (int f = 0; f < 5; ++f) for (int q = 0; q < 3; ++q) for (int w = 0; w < 3; ++w) {
        Body b; b.init(SR); b.set(BODY_F[f], BODY_Q[q], BODY_W[w]);
        check(b.air.b0, EXP_BODY[k++], "body.b0");
        check(b.air.b1, EXP_BODY[k++], "body.b1");
        check(b.air.b2, EXP_BODY[k++], "body.b2");
        check(b.air.a1, EXP_BODY[k++], "body.a1");
        check(b.air.a2, EXP_BODY[k++], "body.a2");
        for (int i = 0; i < 40; ++i)
          check(b.tick(i == 0 ? 1.0 : (i % 7 == 0 ? -0.3 : 0.1)), EXP_BODY[k++], "body.tick");
      } }

    /* ---- 5. the fingering brain ---- */
    { int k = 0;
      std::vector<int> open = tuningOpen("standard-4");
      for (int nn = 20; nn <= 72; ++nn) for (int h = 0; h < 4; ++h) for (int v = 0; v < 3; ++v) {
        int fret = -1;
        std::vector<bool> free4(4, false);
        int s = chooseString(nn, open, 24, FB_HAND[h], free4, &fret, FB_VEL[v]);
        check(s, EXP_FINGER[k++], "chooseString.string");
        check(s < 0 ? -1 : fret, EXP_FINGER[k++], "chooseString.fret");
        std::vector<bool> busy4(4, false); busy4[0] = true; busy4[2] = true;
        int fret2 = -1;
        int s2 = chooseString(nn, open, 24, FB_HAND[h], busy4, &fret2, FB_VEL[v]);
        check(s2, EXP_FINGER[k++], "chooseString.busy.string");
        check(s2 < 0 ? -1 : fret2, EXP_FINGER[k++], "chooseString.busy.fret");
      } }

    /* ---- 6. RENDERED AUDIO ---- */
    struct RC { const char* name; std::vector<int> notes; };
    { int k = 0;
      for (int ci = 0; ci < 10; ++ci) {
        PallbearerCore core(SR, 0x5EED1Eu);
        std::vector<int> notes;
        switch (ci) {
          case 0: notes = { 28, 33, 40 }; break;
          case 1: core.p.style = "slap"; core.p.hardness = 0.9; core.p.buzz = 1;
                  core.p.humanize = 0.6; core.p.drive = 0.3;
                  notes = { 28, 35, 28 }; break;
          case 2: core.p.artic = "ghost"; core.p.noise = 0.8; core.p.relNoise = 1;
                  notes = { 33, 33, 38 }; break;
          case 3: core.p.artic = "harmonic"; core.p.inharm = 0.8; core.p.decay = 9;
                  notes = { 28, 33 }; break;
          case 4: core.setTuning("standard-5"); core.p.bodyFreq = 62; core.p.woodMix = 1;
                  core.p.bodyMix = 0.7; core.setBody();
                  notes = { 23, 28, 31 }; break;
          case 5: core.p.damping = 0.985; core.p.inharm = 1; core.p.stretch = 1; core.p.drive = 1;
                  core.p.level = 2; core.p.pickupA = 0.45; core.p.pickupB = 0.03;
                  core.p.pickupInv = "out"; core.p.pickupMix = 1; core.p.humanize = 1;
                  core.p.buzz = 1; core.p.relNoise = 1; core.p.velBright = 1;
                  notes = { 23, 43 }; break;
          case 6: core.p.style = "muted"; core.p.artic = "palm"; core.p.glide = 0; core.p.decay = 1.2;
                  notes = { 33, 36, 33 }; break;
          case 7: core.p.couple = 1; core.p.decay = 9; core.p.damping = 0.12;
                  core.p.fretNoise = 1; core.p.humanize = 0.5;
                  notes = { 28, 60, 28, 55 }; break;
          case 8: core.p.artic = "dead"; core.p.noise = 1; core.p.buzz = 1; core.p.couple = 0.5;
                  notes = { 33, 40, 33 }; break;
          case 9: core.p.coilFreq = 1200; core.p.coilQ = 6; core.p.drive = 0.6; core.p.couple = 0.8;
                  core.setCoil();
                  notes = { 28, 35 }; break;
        }
        core.recalcTone();
        std::vector<double> L(EXP_RENDER_N, 0.0), R(EXP_RENDER_N, 0.0);
        const int blk = 64;
        double tl[blk], tr[blk];
        int pos = 0, ni = 0, cur = -1;
        int gap = EXP_RENDER_N / ((int)notes.size() + 1);
        while (pos < EXP_RENDER_N) {
            while (ni < (int)notes.size() && pos >= ni * gap) {
                if (cur >= 0) core.noteOff(cur);
                cur = notes[ni]; core.noteOn(cur, 0.85); ni++;
            }
            int m = std::min(blk, EXP_RENDER_N - pos);
            core.render(tl, tr, m);
            for (int i = 0; i < m; ++i) L[pos + i] = tl[i];
            pos += m;
        }
        for (int i = 0; i < EXP_RENDER_N; i += EXP_RENDER_STRIDE)
            check(L[i], EXP_RENDER[k++], "render");
      } }

    /* ---- 7. the attack layer ---- */
    { int k = 0;
      /* Mirrors parity_emit.js: no transcendental in the fixture. The first
         version used std::exp/std::sin against JS Math.exp/Math.sin and
         failed 1,108 checks on 1–2 ulp of libm-vs-v8 drift — the fixture
         breaking LAW 2, not the core. */
      const double LAYER_DECAY = 0.99946;
      int LN = (int)(0.3 * SR);
      std::vector<double> layer((size_t)LN);
      { Rng lr(0xA77AC4u); double env = 1.0;
        for (int i = 0; i < LN; ++i) { layer[(size_t)i] = env * lr.bi(); env *= LAYER_DECAY; } }
      AttackLayer al; al.data = layer.data(); al.length = LN; al.sr = SR; al.root = 33;
      double gains[2][2] = { { 1, 1 }, { 0, 1 } };
      for (int g = 0; g < 2; ++g) {
        PallbearerCore core(SR, 0x5EED1Eu);
        core.p.strGain = gains[g][0]; core.p.atkGain = gains[g][1];
        core.p.atkDecay = 0.2; core.p.humanize = 0;
        core.setAttackLayer(&al);
        std::vector<double> L(4000, 0.0);
        const int blk = 64; double tl[blk], tr[blk];
        core.noteOn(33, 0.9);
        int pos = 0;
        while (pos < 4000) {
            int m = std::min(blk, 4000 - pos);
            core.render(tl, tr, m);
            for (int i = 0; i < m; ++i) L[pos + i] = tl[i];
            pos += m;
        }
        for (int i = 0; i < 4000; i += 7) check(L[i], EXP_LAYER[k++], "attackLayer");
      } }

    /* Summary dialect matters. tools/counts.js parses `(\d+)\s+checks`, so
       "9095 parity checks" does NOT match — the word "parity" lands where the
       regex wants "checks". Printing CASKET's dialect verbatim is what lets
       the estate's generator read this gate instead of someone retyping the
       number into a document, which is the whole point of §1. */
    std::printf("\n");
    if (fails == 0) {
        std::printf("  ✓ %ld checks, 0 mismatches. The twin is real.\n", checks);
        return 0;
    }
    std::printf("  ✗ %d of %ld checks failed. Worst %.0f ulp at %s\n", fails, checks, worstUlp, worstWhere);
    return 1;
}
