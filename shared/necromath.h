/* ============================================================
   necromath.h — portable transcendentals, shared DSP substrate
   C++ mirror of shared/necromath.js. Extracted VERBATIM from
   AutopsyCore.h v0.4 (2026-08-15) so AUTOPSY and RIGOR cannot drift.
   The op ORDER is the load-bearing property. Do not reorder.
   PARITY LAW: compile with -ffp-contract=off. GCC will otherwise
   FMA-fuse a*b+c and the fused result differs in the last bit.
   ============================================================ */
#pragma once
#include <cmath>

/* ---------- nm: portable "necromath" (mirror of NM in the JS core) ----------
   Same IEEE ops in the same order as the JS — this is what makes the
   parity gate bit-exact instead of "within a few ulp of libm". */
namespace nm {
    static const double LN2 = 0.69314718055994531;
    static const double LN10 = 2.3025850929940459;
    static const double PI_2 = 1.5707963267948966;
    /* ---- DOMAIN GUARDS (added 2026-08-16) --------------------------
       Mirror of the guards in necromath.js, in the same order, for the
       same reason. Every one is a COMPARISON; no arithmetic changed.
       For any argument that was already legal they are all false and
       the original op order runs untouched, which is what keeps the
       parity gates bit-exact and the blessed hashes where they are.

       What they fix: these used to LOOP FOREVER rather than return —
       a hung audio thread and a force quit — while every test in the
       suite stayed green, because the fuzzers hammered the STATE and
       never handed the substrate a bad ARGUMENT. */
    inline double twoPow(double k) {
        /* Saturation shortcut. 2^1024 is already infinity and 2^-1075
           is already zero, so past those the loop is multiplying a
           value that can no longer change; these return exactly what
           it would have returned. The wait is the point: k arrives as
           floor(x/LN2), so a LEGAL FINITE x of 1e308 asks this loop
           for 1.4e308 iterations. +-infinity is the same defect with
           an obvious face — `k--` on an infinity is still infinity. */
        if (k >= 1100) return INFINITY;
        if (k <= -1100) return 0;
        double r = 1;
        if (k >= 0) { while (k-- > 0) r *= 2; } else { while (k++ < 0) r *= 0.5; }
        return r;
    }
    inline double exp_(double x) {
        /* The twoPow guard alone stops the hang but leaves exp(+-inf)
           returning NaN, because r = x - k*LN2 is inf - inf. A silent
           NaN in a detector is worse than a freeze: it poisons the
           signal and looks like nothing happened. */
        if (x != x) return x;
        if (x == INFINITY) return INFINITY;
        if (x == -INFINITY) return 0;
        double k = std::floor(x / LN2 + 0.5);
        double r = x - k * LN2;
        double p = 1 + r * (1 + r * (1.0 / 2 + r * (1.0 / 6 + r * (1.0 / 24 + r * (1.0 / 120 +
            r * (1.0 / 720 + r * (1.0 / 5040 + r * (1.0 / 40320 + r * (1.0 / 362880 +
            r * (1.0 / 3628800 + r * (1.0 / 39916800 + r * (1.0 / 479001600 +
            r * (1.0 / 6227020800)))))))))))));
        return p * twoPow(k);
    }
    inline double log_(double x) {
        /* Three ways in, and all three used to spin:
             +infinity -> `while (m >= 2) m *= 0.5` never falls below 2
             0         -> `while (m < 1) m *= 2` never rises above 0
             negatives -> same loop, marching to -infinity, still < 1
           NaN was always fine here purely by accident: every compare
           against NaN is false, so it fell through both loops. That
           accident is why the suite's NaN assertions caught none of
           this. */
        if (x != x) return x;
        if (x == INFINITY) return INFINITY;
        if (x <= 0) return x == 0 ? -INFINITY : NAN;
        double e = 0, m = x;
        while (m >= 2) { m *= 0.5; e++; }
        while (m < 1) { m *= 2; e--; }
        if (m > 4.0 / 3) { m *= 0.5; e++; }
        double z = (m - 1) / (m + 1);
        double z2 = z * z;
        double s = z2 * (1.0 / 3 + z2 * (1.0 / 5 + z2 * (1.0 / 7 + z2 * (1.0 / 9 + z2 * (1.0 / 11 +
            z2 * (1.0 / 13 + z2 * (1.0 / 15 + z2 * (1.0 / 17 + z2 * (1.0 / 19)))))))));
        return e * LN2 + 2 * z * (1 + s);
    }
    inline double sincos_(double x, bool wantSin) {
        /* This one never hung — no loop — but it is the only place in
           the substrate with genuine UNDEFINED BEHAVIOUR rather than a
           wrong answer: casting a non-finite double to long long is UB
           in C++, so the twin could do anything at all where the JS
           merely returned NaN. Now they agree on purpose.

           NOT guarded, and recorded rather than silently changed: the
           same cast is undefined for any |n| >= 2^63, i.e. |x| >=
           ~1.4e19. Unreachable here — sin/cos only ever see
           w0 = 2*pi*f/fs, bounded by pi — and closing it would alter
           finite results nobody has measured. */
        if (!(x > -INFINITY && x < INFINITY)) return NAN;
        double n = std::floor(x / PI_2 + 0.5);
        double r = x - n * PI_2;
        long long ni = (long long)n;
        int q = (int)(((ni % 4) + 4) % 4);
        double r2 = r * r;
        double S = r * (1 + r2 * (-1.0 / 6 + r2 * (1.0 / 120 + r2 * (-1.0 / 5040 +
            r2 * (1.0 / 362880 + r2 * (-1.0 / 39916800 + r2 * (1.0 / 6227020800 +
            r2 * (-1.0 / 1307674368000))))))));
        double C = 1 + r2 * (-1.0 / 2 + r2 * (1.0 / 24 + r2 * (-1.0 / 720 +
            r2 * (1.0 / 40320 + r2 * (-1.0 / 3628800 + r2 * (1.0 / 479001600 +
            r2 * (-1.0 / 87178291200 + r2 * (1.0 / 20922789888000))))))));
        if (wantSin) return q == 0 ? S : q == 1 ? C : q == 2 ? -S : -C;
        return q == 0 ? C : q == 1 ? -S : q == 2 ? -C : S;
    }
    inline double sin_(double x) { return sincos_(x, true); }
    inline double cos_(double x) { return sincos_(x, false); }
    inline double log10_(double x) { return log_(x) / LN10; }
    inline double pow10_(double x) { return exp_(x * LN10); }
} // namespace nm
