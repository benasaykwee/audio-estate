/* ============================================================
   necromath — portable transcendentals, shared DSP substrate
   Extracted VERBATIM from autopsy_core.js v0.4 (2026-08-15) so that
   AUTOPSY and RIGOR cannot drift. The op ORDER in this file is the
   load-bearing property: it is what makes the JS<->C++ parity gates
   bit-exact. Do not reorder, do not "simplify", do not use libm.
   Mirror: shared/necromath.h (namespace nm).
   ============================================================ */
/* ---------- NM: portable "necromath" ----------
   Transcendentals built from IEEE +-*x/ ops in a FIXED order so the
   JS core and the C++ twin (AutopsyCore.h) produce bit-identical
   doubles. Native libm and v8 disagree in the last 1-2 ulp, which
   an IIR feeds back into audible-in-the-hash drift; these do not.
   Accuracy ~1e-15 relative. sqrt stays native (IEEE-exact). */
var NM = (function () {
  var LN2 = 0.69314718055994531;
  var LN10 = 2.3025850929940459;
  var PI_2 = 1.5707963267948966;
  /* ---- DOMAIN GUARDS (added 2026-08-16) --------------------------
     Everything below this comment is a COMPARISON, never a change of
     arithmetic. For every argument that was already legal the guards
     are all false and the original op order runs untouched — which is
     what keeps four programs' worth of blessed hashes and ~90,000
     parity checks exactly where they were. Proven, not asserted:
     30,075 arguments x 6 functions bit-identical before and after.

     What they fix: these functions used to LOOP FOREVER rather than
     return. In a DAW that is a hung audio thread and a force quit,
     and every test in the suite stayed green while it was true,
     because the fuzzers all hammered the STATE and never once handed
     the substrate a bad ARGUMENT. */
  function twoPow(k) {
    /* Saturation shortcut. 2^1024 is already Infinity and 2^-1075 is
       already 0, so past those the loop is doing arithmetic on a value
       that can no longer change — the guards return exactly what it
       would have returned, just without the wait. The wait is the
       point: k arrives as floor(x/LN2), so a LEGAL FINITE x of 1e308
       asks this loop for 1.4e308 iterations. That is a hang with no
       infinity anywhere in sight, and it is how this whole guard set
       was discovered. +-Infinity is the same defect wearing its
       obvious face: `k--` on an infinity is still that infinity. */
    if (k >= 1100) return Infinity;
    if (k <= -1100) return 0;
    var r = 1;
    if (k >= 0) { while (k-- > 0) r *= 2; } else { while (k++ < 0) r *= 0.5; }
    return r;
  }
  function exp_(x) {
    /* The twoPow guard alone would stop the hang but leave exp(+-Inf)
       returning NaN, because r = x - k*LN2 is Inf - Inf. Silent NaN
       into a detector is worse than a freeze: it poisons the signal
       and looks like nothing. These return the IEEE answers. */
    if (x !== x) return x;
    if (x === Infinity) return Infinity;
    if (x === -Infinity) return 0;
    var k = Math.floor(x / LN2 + 0.5);
    var r = x - k * LN2;
    var p = 1 + r * (1 + r * (1 / 2 + r * (1 / 6 + r * (1 / 24 + r * (1 / 120 +
      r * (1 / 720 + r * (1 / 5040 + r * (1 / 40320 + r * (1 / 362880 +
      r * (1 / 3628800 + r * (1 / 39916800 + r * (1 / 479001600 +
      r * (1 / 6227020800)))))))))))));
    return p * twoPow(k);
  }
  function log_(x) {
    /* Three ways in and all three used to spin:
         +Infinity  -> `while (m >= 2) m *= 0.5` never falls below 2
         0          -> `while (m < 1) m *= 2` never rises above 0
         negatives  -> same loop, marching to -Infinity, still < 1
       NaN was always fine here purely by accident: every comparison
       against NaN is false, so it fell straight through both loops.
       That accident is why the project's NaN assertions never caught
       any of this. */
    if (x !== x) return x;
    if (x === Infinity) return Infinity;
    if (x <= 0) return x === 0 ? -Infinity : NaN;
    var e = 0, m = x;
    while (m >= 2) { m *= 0.5; e++; }
    while (m < 1) { m *= 2; e--; }
    if (m > 4 / 3) { m *= 0.5; e++; }
    var z = (m - 1) / (m + 1);
    var z2 = z * z;
    var s = z2 * (1 / 3 + z2 * (1 / 5 + z2 * (1 / 7 + z2 * (1 / 9 + z2 * (1 / 11 +
      z2 * (1 / 13 + z2 * (1 / 15 + z2 * (1 / 17 + z2 * (1 / 19)))))))));
    return e * LN2 + 2 * z * (1 + s);
  }
  function sincos_(x, wantSin) {
    /* This one never hung — it has no loop — and JS already returns
       NaN here by the same accident that saved log_. The guard is for
       the TWIN: necromath.h casts the quadrant index to long long,
       and casting a non-finite double to an integer is undefined
       behaviour in C++, not merely wrong. Stated explicitly so the
       two languages agree on purpose rather than by luck.

       NOT guarded, and recorded rather than silently changed: the
       same cast is undefined for any |n| >= 2^63, i.e. |x| >= ~1.4e19.
       Unreachable here — sin/cos only ever see w0 = 2*pi*f/fs, which
       is bounded by pi — and changing it would alter finite results
       nobody has ever measured. */
    if (!(x > -Infinity && x < Infinity)) return NaN;
    var n = Math.floor(x / PI_2 + 0.5);
    var r = x - n * PI_2;
    var q = ((n % 4) + 4) % 4;
    var r2 = r * r;
    var S = r * (1 + r2 * (-1 / 6 + r2 * (1 / 120 + r2 * (-1 / 5040 +
      r2 * (1 / 362880 + r2 * (-1 / 39916800 + r2 * (1 / 6227020800 +
      r2 * (-1 / 1307674368000))))))));
    var C = 1 + r2 * (-1 / 2 + r2 * (1 / 24 + r2 * (-1 / 720 +
      r2 * (1 / 40320 + r2 * (-1 / 3628800 + r2 * (1 / 479001600 +
      r2 * (-1 / 87178291200 + r2 * (1 / 20922789888000))))))));
    if (wantSin) return q === 0 ? S : q === 1 ? C : q === 2 ? -S : -C;
    return q === 0 ? C : q === 1 ? -S : q === 2 ? -C : S;
  }
  return {
    LN10: LN10,
    exp: exp_, log: log_,
    log10: function (x) { return log_(x) / LN10; },
    pow10: function (x) { return exp_(x * LN10); },
    sin: function (x) { return sincos_(x, true); },
    cos: function (x) { return sincos_(x, false); }
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = NM;
