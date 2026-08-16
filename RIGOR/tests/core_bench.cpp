/* RIGOR CPU budget — THE TWIN.
   tests/rigor_bench.js measures the JS core. The JS core is not what ships:
   the plugin ships RigorCore.h, and until round 8 nobody had measured it.
   The published figure was the JS one with "the C++ twin is materially
   faster" appended, which is a hope rather than a measurement.

   Same cases, same block size, same source, same 70%-load convention as the
   JS bench, so the two numbers are directly comparable.

   g++ -std=c++17 -O2 -ffp-contract=off -o /tmp/rb tests/core_bench.cpp && /tmp/rb

   -ffp-contract=off is not optional even here. It is slower than the fused
   form, and benchmarking the FAST build would publish a figure for a binary
   that does not pass the parity gate. */
#include <cstdio>
#include <cstring>
#include <chrono>
#include <string>
#include <vector>
#include "../rigor-juce/Source/RigorCore.h"

using namespace rigor;

static const double FS = 48000.0;
static const int BLOCK = 512;
static const int SECONDS = 20;
static const int N = 48000 * SECONDS;

/* NOTE: makeNoise is NOT redefined here. RigorCore.h already carries the
   parity-proven Park-Miller mirror of ND.makeNoise, and a second copy in a
   bench file is exactly the kind of quiet fork that makes two benchmarks
   incomparable. Same generator, same seeds, same envelope as
   tests/rigor_bench.js, so the JS and C++ figures describe one workload. */

static State styled(int st)
{
    State s = defaultState();
    const StyleCfg& d = styleCfg(st);
    s.style = st;
    s.knee = d.knee; s.attack = d.attack; s.release = d.release;
    s.autoRel = d.autoRel != 0; s.ratio = d.ratio;
    return s;
}

struct Case { const char* label; State st; bool multi; };

template <class E>
static double runOne(E& e, const std::vector<double>& L, const std::vector<double>& R)
{
    std::vector<double> oL((size_t)BLOCK), oR((size_t)BLOCK);
    /* warm pass — one second, matching the JS bench's JIT warm-up so the
       two are measuring the same thing */
    for (int p = 0; p + BLOCK <= 48000; p += BLOCK)
        e.process(L.data() + p, R.data() + p, oL.data(), oR.data(), BLOCK);

    auto t0 = std::chrono::steady_clock::now();
    for (int p = 0; p + BLOCK <= N; p += BLOCK)
        e.process(L.data() + p, R.data() + p, oL.data(), oR.data(), BLOCK);
    auto t1 = std::chrono::steady_clock::now();
    return std::chrono::duration<double>(t1 - t0).count();
}

int main()
{
    std::vector<double> srcL, srcR;
    makeNoise(424242u, N, srcL);
    makeNoise(133742u, N, srcR);
    for (int i = 0; i < N; i++) {
        double g = (i % 12000 < 1200) ? 0.9 : 0.06;
        srcL[(size_t)i] *= g; srcR[(size_t)i] *= g;
    }

    std::vector<Case> cases;
    { State s = styled(FRESH);    cases.push_back({ "fresh, 1 band", s, false }); }
    { State s = styled(SETTLING); cases.push_back({ "settling (feedback)", s, false }); }
    { State s = styled(REPOSE);   cases.push_back({ "repose (RMS)", s, false }); }
    { State s = styled(FRESH); s.scOn = true;      cases.push_back({ "+ sidechain filter", s, false }); }
    { State s = styled(FRESH); s.look = 5;         cases.push_back({ "+ lookahead 5 ms", s, false }); }
    { State s = styled(FRESH); s.place = P_MS;     cases.push_back({ "+ mid/side", s, false }); }
    { State s = styled(FRESH); s.detOs = true;     cases.push_back({ "+ oversampled det (4x)", s, false }); }
    /* round 8 additions — the two new paths deserve their own line, because
       "how much does 8x cost" is exactly the question a user asks */
    { State s = styled(FRESH); s.detOs = true; s.detOsX = 2; cases.push_back({ "+ oversampled det (2x)", s, false }); }
    { State s = styled(FRESH); s.detOs = true; s.detOsX = 8; cases.push_back({ "+ oversampled det (8x)", s, false }); }
    { State s = styled(FRESH); s.hold = 40; s.holdTaper = 100; cases.push_back({ "+ tapered hold", s, false }); }
    { State s = styled(FRESH); s.bands = 2;        cases.push_back({ "2 bands", s, true }); }
    { State s = styled(FRESH); s.bands = 3;        cases.push_back({ "3 bands", s, true }); }
    { State s = styled(SETTLING); s.bands = 3; s.scOn = true; s.look = 5;
      s.place = P_MS; s.detOs = true; s.curve = 50;
      cases.push_back({ "3 bands + everything", s, true }); }

    std::printf("RIGOR CPU budget — THE C++ TWIN — %d s of stereo at %.0f Hz, %d-sample blocks\n",
                SECONDS, FS, BLOCK);
    std::printf("(compiled -O2 -ffp-contract=off, the SAME flags the parity gate requires;\n"
                " a faster build that fails parity would be a figure for a different plugin)\n\n");
    std::printf("  case                        x realtime   ~instances at 70%% load\n");
    std::printf("  -------------------------------------------------------------\n");

    double worst = 1e18; std::string worstCase;
    for (size_t i = 0; i < cases.size(); i++) {
        double sec;
        if (cases[i].multi) {
            Multi e(FS); e.setState(cases[i].st);
            sec = runOne(e, srcL, srcR);
        } else {
            Engine e(FS); e.setState(cases[i].st);
            sec = runOne(e, srcL, srcR);
        }
        double xrt = SECONDS / sec;
        if (xrt < worst) { worst = xrt; worstCase = cases[i].label; }
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%.1fx", xrt);
        std::printf("  %-28s%9s%20d\n", cases[i].label, buf, (int)(xrt * 0.7));
    }
    std::printf("  -------------------------------------------------------------\n");
    std::printf("  worst case: %s at %.1fx realtime\n", worstCase.c_str(), worst);
    std::printf("\n  Budget headline: the heaviest configuration runs %.0fx faster than\n", worst);
    std::printf("  realtime, so a 70%%-loaded session supports roughly %d instances.\n",
                (int)(worst * 0.7));
    return 0;
}
