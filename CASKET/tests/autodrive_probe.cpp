/* WHAT autoDrive ACTUALLY RETURNS, AT WHATEVER -O LEVEL THIS IS BUILT WITH.
   ------------------------------------------------------------------------
   g++ -std=c++17 -O0 -ffp-contract=off -o ad0 tests/autodrive_probe.cpp && ./ad0
   g++ -std=c++17 -O2 -ffp-contract=off -o ad2 tests/autodrive_probe.cpp && ./ad2
   g++ -std=c++17 -O3 -ffp-contract=off -o ad3 tests/autodrive_probe.cpp && ./ad3
   diff <(./ad0) <(./ad2); diff <(./ad2) <(./ad3)

   WHY THIS EXISTS. The parity gate reports one mismatching SCALAR at a
   time, all seven fields of a DriveResult sharing the label
   "autoDrive[noise][pine]". Reading four sampled lines out of that, a
   previous session concluded the bisection was flipping a branch at depth
   four. That story does not survive contact with the code:

     - JS truth for [noise][pine] is drive = -12 (RAILED, target -14 is
       unreachable: the floor of the drive control still measures -10.61).
     - CI's -O3 twin reported lufs = -8.3603485335562979.
     - A render at drive -9.75 produces EXACTLY that lufs. Nothing else does;
       -9.7 gives -8.3103 and -9.8 gives -8.4103.
     - But -9.75 cannot come out of quantize(). It is floor(x*10+0.5)/10,
       whose output is always a multiple of 0.1, in both twins.

   So the twin rendered at an off-grid drive that its own quantiser cannot
   produce, which is a different and more interesting fault than a flipped
   comparison. This probe prints the WHOLE result for every case instead of
   whichever scalar the gate happened to trip on first, so the next -O3 run
   answers the question outright rather than supplying four more clues.

   It asserts nothing and never fails. It is an instrument, not a gate. */
#include <cstdio>
#include <cmath>
#include <vector>
#include "../casket-juce/Source/CasketCore.h"

using namespace casket;

int main() {
    /* Materials and state built EXACTLY as tests/core_parity.cpp builds
       them. If this drifts from that file the probe describes a different
       experiment than the one that is failing, which is worse than useless. */
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
    const int   STY[2]  = { PINE, LEAD };
    const char* STYN[2] = { "pine", "lead" };
    const double TGT[3] = { -14, -40, 6 };

    auto styled = [](int s) {
        State st = fromStyle(s);
        st.style = s; st.drive = 4; st.dust = DUST_OFF;
        return st;
    };

    std::printf("# autoDrive full results — 4 passes, grid 0.1, 48 kHz, 24000 samples\n");
    std::printf("# %-8s %-6s %6s   %-12s %-22s %-22s %-8s %s\n",
                "material", "style", "target", "drive", "lufs", "error", "reached", "grid");

    for (int t = 0; t < 3; t++) {
        for (int mi = 0; mi < 3; mi++) {
            for (int si = 0; si < 2; si++) {
                State st = styled(STY[si]);
                DriveResult r = autoDrive(st, MATS[mi][0], MATS[mi][1], N, 48000, TGT[t], 4, 0.1);

                /* An off-grid drive is the specific thing worth shouting
                   about: quantize() cannot produce one, so if it appears
                   here the fault is upstream of the comparison everybody
                   has been staring at. */
                double onGrid = std::floor(r.drive * 10.0 + 0.5) / 10.0;
                const char* flag = (r.drive == onGrid) ? "" : "   <== OFF-GRID DRIVE";

                std::printf("  %-8s %-6s %6.0f   %-12.6f %-22.17g %-22.17g %-8s %.4f%s\n",
                            MATN[mi], STYN[si], TGT[t], r.drive, r.lufs, r.error,
                            r.reached ? "true" : "false", r.grid, flag);
            }
        }
    }

    /* THE LADDER. Every drive a 4-pass bisection over [-12, 24] can visit:
       the two rails, then the midpoints along the only path these materials
       take (each is louder than -14 even at the floor, so `hi` keeps coming
       down). Printing the LUFS at each one means a -O3 divergence is visible
       as a NUMBER rather than inferred from which scalar the gate tripped on.

       It also lets anyone reading a failure work backwards: given a reported
       lufs, this table says which drive produced it. That is how -8.3603...
       was traced to drive -9.75, a value quantize() cannot return — the
       observation that broke the "flipped bisection branch" story. */
    std::printf("\n# THE LADDER — integrated LUFS at every drive the search can visit\n");
    std::printf("# %-8s %-6s", "material", "style");
    const double LADDER[6] = { -12, 24, 6, -3, -7.5, -9.75 };
    for (int i = 0; i < 6; i++) std::printf(" %22.6g", LADDER[i]);
    std::printf("\n");

    for (int mi = 0; mi < 3; mi++) {
        for (int si = 0; si < 2; si++) {
            std::printf("  %-8s %-6s", MATN[mi], STYN[si]);
            for (int i = 0; i < 6; i++) {
                State s = styled(STY[si]);
                s.drive = LADDER[i];
                s.unity = false;
                Meters m = renderOffline(s, MATS[mi][0], MATS[mi][1], N, 48000).meters;
                std::printf(" %22.17g", m.integrated);
            }
            std::printf("\n");
        }
    }
    return 0;
}
