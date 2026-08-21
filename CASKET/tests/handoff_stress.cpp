/* CASKET — Handoff<T> stress test
   ============================================================
   g++ -std=c++17 -O2 -pthread -o build/handoff tests/handoff_stress.cpp && ./build/handoff

   Handoff<T> exists to carry a meter snapshot from the audio thread to the
   UI without either blocking or tearing (see the long comment above it in
   CasketCore.h). This proves it does — and, just as importantly, proves the
   test itself can SEE tearing, by running the same load against a
   deliberately unprotected struct and watching that one fail.

   A concurrency test that only ever passes is indistinguishable from a
   concurrency test that does nothing, so this runs both arms every time.

   The payload is a struct whose fields must stay mutually consistent: every
   field is derived from one counter, so any mix of old and new values is
   detectable without needing to know WHICH publish was observed. That is
   exactly the property the real Meters needs and that per-field atomics
   would not give it. */
#include <atomic>
#include <thread>
#include <cstdio>
#include <cstdlib>
#include <chrono>
#include <cmath>
#include <limits>

/* THE REAL HEADER, not a copy — added 2026-08-19 for the trace-fold
   section below. The Handoff arms further down still use local copies on
   purpose (they need a deliberately-broken variant side by side with the
   good one), but foldTrace/emptyTrace are tested as the plugin actually
   compiles them: a test of a copy would keep passing after the original
   changed, which is the failure mode this whole file exists to avoid. */
#include "../casket-juce/Source/CasketCore.h"

/* ---- the payload: internally consistent by construction ---- */
struct Payload {
    long long seed;
    long long twice;
    long long square;
    double    asDouble;
    char      pad[64];      /* big enough that a copy is not one instruction */
    static Payload of(long long n) {
        Payload p{};
        p.seed = n; p.twice = n * 2; p.square = n * n;
        p.asDouble = (double)n;
        for (int i = 0; i < 64; i++) p.pad[i] = (char)(n & 0x7f);
        return p;
    }
    bool consistent() const {
        if (twice != seed * 2) return false;
        if (square != seed * seed) return false;
        if (asDouble != (double)seed) return false;
        for (int i = 0; i < 64; i++) if (pad[i] != (char)(seed & 0x7f)) return false;
        return true;
    }
};

/* ---- the thing under test, copied verbatim from CasketCore.h ---- */
template <typename T>
class Handoff {
public:
    void publish(const T& v) {
        unsigned s = seq.load(std::memory_order_relaxed);
        slot[(s + 1) % 3] = v;
        seq.store(s + 1, std::memory_order_release);
    }
    bool read(T& out) const {
        for (int tries = 0; tries < 8; ++tries) {
            unsigned a = seq.load(std::memory_order_acquire);
            out = slot[a % 3];
            /* the fence is load-bearing — see the note in CasketCore.h */
            std::atomic_thread_fence(std::memory_order_acquire);
            if (seq.load(std::memory_order_relaxed) == a) return true;
        }
        return false;
    }
private:
    T slot[3] = {};
    std::atomic<unsigned> seq{0};
};

/* The FIRST version of Handoff, kept as a second control arm. It published
   a slot index and verified the index had not moved — which three publishes
   during one copy defeat, because the index comes back around to where it
   started (ABA). It tore under this exact test, which is the only reason
   the bug was ever found. Keeping it here means the fix cannot silently
   regress to it: if `Handoff` is ever "simplified" back to an index, this
   arm and that arm start agreeing, and the test says so. */
template <typename T>
class HandoffABA {
public:
    void publish(const T& v) {
        int next = writeSlot;
        slot[next] = v;
        live.store(next, std::memory_order_release);
        writeSlot = (next + 1) % 3;
    }
    bool read(T& out) const {
        for (int tries = 0; tries < 4; ++tries) {
            int a = live.load(std::memory_order_acquire);
            out = slot[a];
            if (live.load(std::memory_order_acquire) == a) return true;
        }
        return false;
    }
private:
    T slot[3] = {};
    std::atomic<int> live{0};
    int writeSlot = 1;
};

/* ---- the control arm: the same job with no protection at all ---- */
template <typename T>
class Unprotected {
public:
    void publish(const T& v) { slot = v; }
    bool read(T& out) const { out = slot; return true; }
private:
    T slot{};
};

static std::atomic<bool> stop{false};

/* publishEveryUs == 0 means "as fast as the machine allows" — far harsher
   than any audio thread, and the arm that exposes ordering bugs. A real
   audio thread publishes once per block: ~93 times a second at 512 samples
   and 48 kHz, which the `realistic` arm models at 1000/s to keep an order
   of magnitude of headroom over reality. */
template <typename H>
static void run(const char* label, H& h, int publishEveryUs, int readEveryUs,
                long long& reads, long long& torn, long long& missed) {
    stop.store(false);
    reads = torn = missed = 0;

    std::thread writer([&h, publishEveryUs] {
        long long n = 1;
        while (!stop.load(std::memory_order_relaxed)) {
            h.publish(Payload::of(n));
            ++n;
            if (publishEveryUs > 0)
                std::this_thread::sleep_for(std::chrono::microseconds(publishEveryUs));
        }
    });

    /* reader: the UI. Copies, then checks the copy describes ONE moment. */
    std::thread reader([&h, readEveryUs, &reads, &torn, &missed] {
        Payload p{};
        while (!stop.load(std::memory_order_relaxed)) {
            if (!h.read(p)) { ++missed; }
            else { ++reads; if (!p.consistent()) ++torn; }
            if (readEveryUs > 0)
                std::this_thread::sleep_for(std::chrono::microseconds(readEveryUs));
        }
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(1200));
    stop.store(true);
    writer.join(); reader.join();

    std::printf("  %-26s %10lld reads  %8lld torn  %8lld declined\n",
                label, reads, torn, missed);
}

/* ============================================================
   THE TRACE FOLD — the other half of the seam
   ============================================================
   Handoff carries a snapshot safely; foldTrace decides WHAT is in it.
   Engine::trace() resets on read and that read now happens per audio
   block, so between two 30 Hz editor frames several blocks are consumed.
   Getting this wrong does not crash or tear — it silently drops peaks, and
   a meter that misses transients looks like a meter that is working. */
static int foldFails = 0;
static void fok(bool cond, const char* what) {
    if (cond) std::printf("  + %s\n", what);
    else { std::printf("  x FAIL: %s\n", what); foldFails++; }
}

static void traceFoldSection() {
    using casket::Trace;
    std::printf("CASKET — the trace fold (what the editor is shown)\n\n");

    /* an empty accumulator must read as SILENCE, not as full scale */
    Trace e = casket::emptyTrace();
    fok(e.inPeakDb == -std::numeric_limits<double>::infinity() &&
        e.outPeakDb == -std::numeric_limits<double>::infinity(),
        "emptyTrace seeds the dB fields to -inf, not 0 (0 dBFS would read as full scale)");
    fok(e.inPeak == 0.0 && e.outPeak == 0.0 && e.gr == 0.0,
        "and the linear fields to 0, where 0 genuinely means none");

    /* PEAKS ACCUMULATE. Three blocks, the loudest in the middle — the one
       the editor must be shown. Taking only the last block loses it. */
    Trace acc = casket::emptyTrace();
    Trace b1 {}; b1.inPeak = 0.2; b1.outPeak = 0.1; b1.inPeakDb = -14.0; b1.outPeakDb = -20.0; b1.gr = -1.0;
    Trace b2 {}; b2.inPeak = 0.9; b2.outPeak = 0.8; b2.inPeakDb =  -0.9; b2.outPeakDb =  -1.9; b2.gr = -6.0;
    Trace b3 {}; b3.inPeak = 0.3; b3.outPeak = 0.2; b3.inPeakDb = -10.5; b3.outPeakDb = -14.0; b3.gr = -2.0;
    casket::foldTrace(acc, b1);
    casket::foldTrace(acc, b2);
    casket::foldTrace(acc, b3);
    fok(acc.inPeak == 0.9 && acc.outPeak == 0.8,
        "the loudest block's peaks survive being followed by a quieter one");
    fok(acc.inPeakDb == -0.9 && acc.outPeakDb == -1.9,
        "the dB fields follow the same maxima, not the last block's values");

    /* GAIN REDUCTION GOES THE OTHER WAY, and this is the asymmetry most
       likely to be "tidied" into a maximum by someone reading quickly. */
    fok(acc.gr == -6.0,
        "gr keeps the DEEPEST reduction (-6), not the largest number (-1)");

    /* the epoch clear: after the editor confirms a frame, the next fold
       starts from nothing rather than inheriting an old peak forever */
    acc = casket::emptyTrace();
    casket::foldTrace(acc, b3);
    fok(acc.inPeak == 0.3 && acc.gr == -2.0,
        "after a reset the accumulator reflects only what came after it");

    /* silence must not overwrite a real peak with 0 */
    Trace quiet = casket::emptyTrace();
    casket::foldTrace(acc, quiet);
    fok(acc.inPeak == 0.3 && acc.inPeakDb == -10.5,
        "folding a silent block does not erase the peak already held");
    fok(acc.gr == -2.0,
        "nor does a silent block's gr of 0 count as less reduction than -2");

    /* idempotence — folding the same block twice is folding it once */
    Trace once = casket::emptyTrace(), twice = casket::emptyTrace();
    casket::foldTrace(once, b2);
    casket::foldTrace(twice, b2); casket::foldTrace(twice, b2);
    fok(once.inPeak == twice.inPeak && once.gr == twice.gr && once.outPeakDb == twice.outPeakDb,
        "the fold is idempotent — a repeated block cannot inflate the reading");

    std::printf("\n");
}

/* ============================================================
   DISPLAY MAPPINGS — the same cases UIH passes in the browser
   ============================================================
   casket_ui_test.js asserts these exact properties against UIH.dbToY,
   UIH.meterFrac and UIH.grToPx. Until 2026-08-19 the C++ copies were
   `static` inside PluginEditor.cpp, so the face nobody here can open was
   also the face nothing could test. Same cases, same expectations — if the
   two faces ever disagree about where a number goes, one instrument's
   screenshot stops being evidence about the other. */
static void displaySection() {
    const double TOPv = 6, BOTv = -60, GRMAXv = 24, H = 300;
    std::printf("CASKET — display mappings (the cases UIH passes)\n\n");

    fok(std::fabs(casket::dbToY(TOPv, H, TOPv, BOTv) - 0.0) < 1e-9,
        "top of the scale is the top edge");
    fok(std::fabs(casket::dbToY(BOTv, H, TOPv, BOTv) - H) < 1e-9,
        "bottom of the scale is the bottom edge");
    fok(std::fabs(casket::dbToY(999, H, TOPv, BOTv) - 0.0) < 1e-9,
        "over-range clamps to the top");
    fok(std::fabs(casket::dbToY(-999, H, TOPv, BOTv) - H) < 1e-9,
        "under-range clamps to the bottom");

    fok(std::fabs(casket::meterFrac(-40, -40, 0) - 0.0) < 1e-9, "meter floor is empty");
    fok(std::fabs(casket::meterFrac(0, -40, 0) - 1.0) < 1e-9, "meter ceiling is full");
    fok(std::fabs(casket::meterFrac(-20, -40, 0) - 0.5) < 1e-9, "meter is linear in dB");
    fok(casket::meterFrac(-std::numeric_limits<double>::infinity(), -40, 0) == 0.0,
        "silence reads empty, not NaN");

    fok(std::fabs(casket::grToPx(0, 100, GRMAXv) - 0.0) < 1e-9,
        "no gain reduction draws no weight");
    fok(std::fabs(casket::grToPx(-GRMAXv, 100, GRMAXv) - 100.0) < 1e-9,
        "full gain reduction fills the band");
    fok(std::fabs(casket::grToPx(-GRMAXv * 2, 100, GRMAXv) - 100.0) < 1e-9,
        "the weight cannot exceed the band");
    fok(std::fabs(casket::grToPx(5, 100, GRMAXv) - 0.0) < 1e-9,
        "a positive gain draws nothing (there is no such thing)");

    /* THE RANGE's kept/gated rule, which the browser tests at the boundary
       and sweeps either side of. The C++ chart applies it inline in
       drawRange; this pins the rule itself. */
    auto kept = [](double loud, double gate) {
        return !std::isfinite(gate) || loud > gate;
    };
    fok(kept(-20, -30) == true,  "a bin above the gate is kept");
    fok(kept(-40, -30) == false, "a bin below the gate is gated out");
    fok(kept(-30, -30) == false,
        "a bin exactly ON the gate is EXCLUDED — matches the core's <= gate skip");
    fok(kept(-20, -std::numeric_limits<double>::infinity()) == true,
        "with no gate yet, everything counts");

    std::printf("\n");
}

int main() {
    traceFoldSection();
    displaySection();

    std::printf("CASKET — Handoff<T> under two threads\n\n");
    std::printf("  UNTHROTTLED: writer as fast as the machine allows. Millions of\n");
    std::printf("  publishes a second against an audio thread's ~93. Judged on\n");
    std::printf("  TEARING ONLY — declining under this load is correct behaviour.\n\n");

    /* THE CONTROL IS RETRIED BEFORE IT IS BELIEVED — added 2026-08-19 after
       watching this exit 1 on one run and 0 on the next with identical code.
       The failure was correct in principle: if the unprotected arm does not
       tear, the run cannot tell a working Handoff from a blind test, and
       calling that a pass would be a lie. But the arm depends on the
       scheduler interleaving two threads, and on a quiet machine it
       occasionally does not — which turns a rigorous check into a flaky one,
       and a flaky check is one people learn to re-run rather than read.
       Two attempts costs 1.2 s and makes the "genuinely could not
       reproduce" verdict mean something. */
    long long r1 = 0, t1 = 0, m1 = 0;
    Unprotected<Payload> bare;
    run("unprotected (control)", bare, 0, 0, r1, t1, m1);
    if (t1 == 0) {
        std::printf("    (control did not tear — retrying once before calling it inconclusive)\n");
        Unprotected<Payload> bare2;
        run("unprotected (retry)", bare2, 0, 0, r1, t1, m1);
    }

    long long r3 = 0, t3 = 0, m3 = 0;
    HandoffABA<Payload> aba;
    run("index-only (the ABA bug)", aba, 0, 0, r3, t3, m3);

    long long r2 = 0, t2 = 0, m2 = 0;
    Handoff<Payload> safe;
    run("Handoff<Payload>", safe, 0, 0, r2, t2, m2);

    /* THE REAL PAYLOAD, added 2026-08-19. Everything above uses a 96-byte
       struct; THE RANGE's Hist is 6 KB — sixty times the copy, and the copy
       is exactly the window the acquire fence exists to protect. A class
       proven safe carrying a small struct has not been proven safe carrying
       a large one, and the difference is not theoretical: a longer memcpy
       means more publishes can land inside it.
       Consistency is checked the same way — every bin derived from one
       counter, so any mix of two snapshots is detectable without knowing
       which two. */
    {
        struct BigPayload {
            double counts[751];
            double seed;
            static BigPayload of(double n) {
                BigPayload b{};
                b.seed = n;
                for (int i = 0; i < 751; i++) b.counts[i] = n + i;
                return b;
            }
            bool consistent() const {
                for (int i = 0; i < 751; i++) if (counts[i] != seed + i) return false;
                return true;
            }
        };
        std::printf("\n  THE REAL PAYLOAD: Hist-sized, %zu bytes (the small arms above are %zu)\n\n",
                    sizeof(BigPayload), sizeof(Payload));
        std::atomic<bool> bstop{false};
        long long breads = 0, btorn = 0, bmissed = 0;
        Handoff<BigPayload> bh;
        std::thread bw([&] {
            double n = 1;
            while (!bstop.load(std::memory_order_relaxed)) { bh.publish(BigPayload::of(n)); n += 1; }
        });
        std::thread br([&] {
            BigPayload p{};
            while (!bstop.load(std::memory_order_relaxed)) {
                if (!bh.read(p)) { ++bmissed; continue; }
                ++breads;
                if (!p.consistent()) ++btorn;
            }
        });
        std::this_thread::sleep_for(std::chrono::milliseconds(1200));
        bstop.store(true);
        bw.join(); br.join();
        std::printf("  %-26s %10lld reads  %8lld torn  %8lld declined\n",
                    "Handoff<Hist-sized>", breads, btorn, bmissed);
        if (btorn != 0) {
            std::printf("  x the 6 KB payload TORE %lld times — the fence does not hold at this size\n", btorn);
            foldFails++;
        } else {
            std::printf("  + %lld reads of a 6 KB payload, not one torn\n", breads);
        }
    }

    std::printf("\n  REALISTIC: writer at 1000 publishes/s (10x an audio thread at\n");
    std::printf("  512 samples), reader at 30 Hz (the editor's timer). This is the\n");
    std::printf("  arm that has to actually deliver frames.\n\n");

    long long r4 = 0, t4 = 0, m4 = 0;
    Handoff<Payload> live;
    run("Handoff<Payload> in situ", live, 1000, 33333, r4, t4, m4);

    std::printf("\n");
    int fail = 0;

    /* The control MUST tear. If it does not, this machine/optimiser is not
       reproducing the condition and the pass below proves nothing. */
    if (t1 == 0) {
        std::printf("  x INCONCLUSIVE: the unprotected control never tore, so this run\n");
        std::printf("    cannot distinguish a working Handoff from a test that is blind.\n");
        fail = 1;
    } else {
        std::printf("  + the control tore %lld times — the test can see the bug it is testing for\n", t1);
    }

    /* The ABA arm is the specific bug this class was written wrong for once.
       It is allowed to tear; what it must NOT do is come out clean, because
       a clean run there means this machine is not exercising the window and
       the real arm's pass is not evidence of anything either. */
    if (t3 == 0) {
        std::printf("  ! the index-only arm did not tear on this run — the ABA window was not\n");
        std::printf("    hit, so treat the Handoff result below as weaker evidence than usual.\n");
    } else {
        std::printf("  + the index-only arm tore %lld times — ABA reproduced, as it did when found\n", t3);
    }

    if (t2 != 0) {
        std::printf("  x Handoff TORE %lld times — it does not hold\n", t2);
        fail = 1;
    } else {
        std::printf("  + Handoff: %lld reads, not one of them torn\n", r2);
    }

    /* THE ARM THAT DECIDES USABILITY. Under the unthrottled writer above,
       declining is the correct answer and says nothing about the class —
       a reader losing to a writer running millions of times faster than any
       real audio thread is arithmetic, not a defect. At the actual rates the
       plugin uses, it has to hand over clean frames essentially every time. */
    if (t4 != 0) {
        std::printf("  x at realistic rates it still tore %lld times\n", t4);
        fail = 1;
    } else if (r4 == 0 || m4 * 100 > r4) {
        std::printf("  x at realistic rates it declined too often (%lld declined vs %lld good)\n", m4, r4);
        fail = 1;
    } else {
        std::printf("  + at realistic rates: %lld clean frames, %lld declined, 0 torn\n", r4, m4);
    }

    if (foldFails) {
        std::printf("  x the trace fold failed %d check(s) — see the top of this run\n", foldFails);
        fail = 1;
    }

    std::printf("\n%s\n", fail ? "FAILED" : "the seam holds: the fold keeps the peaks, the handoff carries them intact.");
    return fail;
}
