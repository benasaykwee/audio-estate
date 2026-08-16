/* ============================================================
   necrodyn — the dynamics DNA, shared substrate
   Written 2026-08-15 for CASKET; RIGOR inherits it unchanged.
   Everything here is deterministic and allocation-free after
   construction. The op ORDER is load-bearing exactly as it is in
   necromath: it is what lets the C++ twins be bit-exact.
   DEPENDS ON: shared/necromath.js (NM).
   Mirror (Phase 2): shared/necrodyn.h (namespace nd).
   ============================================================ */
var ND = (function (NM) {
  'use strict';

  var VERSION = '0.1';

  /* ---------- scalars ---------- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* dB <-> linear. The floor keeps log() away from zero without
     inventing a discontinuity: -600 dB is silence by any measure. */
  var DB_FLOOR = 1e-30;
  function dbToLin(db) { return NM.pow10(db / 20); }
  function linToDb(x) { return 20 * NM.log10(x > DB_FLOOR ? x : DB_FLOOR); }

  /* one-pole coefficient: y += (1-c)(x-y) reaches 1-1/e of a step in
     exactly `ms` milliseconds. Identical formula to AUTOPSY's dyn-EQ. */
  function onePole(ms, fs) {
    return NM.exp(-1 / (clamp(ms, 1e-6, 1e9) * 0.001 * fs));
  }

  /* the soft-saturating blend shape. Third appearance in this codebase:
     AUTOPSY's dyn range, RIGOR's auto-release, CASKET's program release. */
  function blend(d, k) { return d / (d + k); }

  /* ---------- gain computer ----------
     dB domain, quadratic-interpolated soft knee, C1 continuous at both
     junctions. invR = 1/ratio, so a limiter is EXACTLY invR = 0.
     W = 0 is a legal hard knee: the outer branches then cover the whole
     domain and the middle is unreachable, but we guard anyway because
     "0 is a legal value" is the bug family that bit AUTOPSY v0.4. */
  /* THE INFINITE-RATIO GUARD (2026-08-16, at the source at last).
     `T + d * invR` with d = +Infinity and invR = 0 is Infinity * 0, which
     is NaN. A limiter is invR = 0 BY DEFINITION, so CASKET is the only
     program in this suite that can reach it — RIGOR at a finite ratio gets
     Infinity back, which is ugly but survivable, which is why four rounds
     of RIGOR never found it.
     The mathematically right answer is plain: at an infinite ratio nothing
     above the knee gets past T, whatever the input. So `invR === 0 ? T`.

     This short circuit is BIT-EXACT for every finite input — for finite d,
     `T + d * 0` is `T + 0` is `T` — which is why it can be added to a file
     with three sealed regression suites behind it. And it is unreachable
     for NaN input: NaN fails `d > W/2`, so a NaN still falls through to
     the knee branch and still comes out NaN, which is the caller's error
     reported plainly rather than swallowed. */
  function kneeOut(x, T, W, invR) {
    var d = x - T;
    if (W <= 0) return d <= 0 ? x : (invR === 0 ? T : T + d * invR);
    if (d < -W / 2) return x;
    if (d > W / 2) return invR === 0 ? T : T + d * invR;
    var t = d + W / 2;
    return x + (invR - 1) * t * t / (2 * W);
  }
  /* gain reduction in dB (<= 0).
     Computed DIRECTLY rather than as kneeOut(x) - x. The two are
     algebraically identical, but differencing computes T + (x-T) and then
     subtracts x, and that round trip does not always return exactly x in
     floating point. The residue is ~5e-15 dB, inaudible, and fatal to the
     one assertion worth having: at 1:1 (invR = 1) the gain reduction must
     be EXACTLY zero so an idle compressor returns its input bit-for-bit.
     Measured before this fix: 421 of 6,500 sampled points returned
     -5.3e-15 instead of 0. The old `y < x ? y - x : 0` guard only caught
     the half of those whose residue happened to be positive.

     CORRECTION (2026-08-15): an earlier note here claimed CASKET was
     unaffected because it only calls this with invR = 0. That was wrong,
     and expensively so. invR = 0 makes the LINEAR branch exact, but not
     the KNEE branch — and CASKET's `lead` style runs a 6 dB knee, the
     widest of the five. Worse than the residue: when the true reduction
     is smaller than one ulp of x, `x + c` rounds back to exactly x, the
     `y < x` guard reads false, and the whole reduction is discarded.
     `lead` was overshooting its lid by 103% and firing the safety clamp
     17,756 times per 48,000 samples — clipping, not limiting. Fixing this
     restored its regression hash to the original blessed value.
     Lesson worth keeping: "that branch is exact" is a claim about ONE
     branch, and every other branch still needs checking. */
  function kneeGain(x, T, W, invR) {
    var d = x - T;
    if (W <= 0) return d <= 0 ? 0 : d * (invR - 1);
    if (d < -W / 2) return 0;
    if (d >= W / 2) return d * (invR - 1);
    var t = d + W / 2;
    return (invR - 1) * t * t / (2 * W);
  }

  /* ---------- soft clip ----------
     C1 at the knee: both branches have slope 1 at |x| = t.
     t >= 1 is a pure passthrough (and must be — it is how the
     saturation stage disappears for the bit-exact null test). */
  function softClip(x, t) {
    if (t >= 1) return x;
    var a = x < 0 ? -x : x;
    if (a <= t) return x;
    var u = (a - t) / (1 - t);
    var y;
    /* tanh(20) differs from 1 by 8e-18, which is below a double's
       resolution at 1.0 — so this branch is exact, not an approximation.
       It also has to exist: NM.exp scales by repeated doubling, so a huge
       argument does not merely overflow, it spins for billions of
       iterations first. Never hand NM.exp an unbounded input. */
    if (u > 20) y = 1;
    else {
      var e = NM.exp(2 * u);
      y = t + (1 - t) * ((e - 1) / (e + 1));
    }
    return x < 0 ? -y : y;
  }

  /* ---------- deterministic pseudo-random ----------
     Park-Miller LCG. Products stay under 2^53 so JS doubles are exact
     and the C++ twin agrees trivially.
     NOTE: autopsy_core.js keeps its own verbatim copy of this on
     purpose — AUTOPSY is a sealed artifact with byte-stable hashes and
     is not edited for tidiness. casket_test.js asserts the two agree. */
  function lcg(seed) {
    var x = (seed >>> 0) || 1;
    return function () {
      x = (x * 16807) % 2147483647;
      return x / 2147483647;
    };
  }
  function makeNoise(seed, n) {
    var r = lcg(seed);
    var out = new Float64Array(n);
    for (var i = 0; i < n; i++) out[i] = r() * 2 - 1;
    return out;
  }

  /* ---------- sliding minimum ----------
     Monotonic deque. Amortised O(1), and it performs NO arithmetic on
     the samples at all — only comparison and copy — so it cannot be a
     source of parity drift.
     push(x) returns min over the last `w` pushes (inclusive).
     Pre-filled with `init` so the first w-1 outputs are meaningful. */
  function slidingMin(w, init) {
    var n = w < 1 ? 1 : (w | 0);
    var v = new Float64Array(n);
    var t = new Float64Array(n); // absolute times; exact to 2^53 samples
    var h = 0, c = 0, now = 0;
    function push(x) {
      /* expire first, so the ring can never overrun */
      while (c > 0 && t[h] <= now - n) { h = h + 1 === n ? 0 : h + 1; c--; }
      while (c > 0) {
        var b = h + c - 1; if (b >= n) b -= n;
        if (v[b] >= x) c--; else break;
      }
      var p = h + c; if (p >= n) p -= n;
      v[p] = x; t[p] = now; c++;
      now++;
      return v[h];
    }
    for (var i = 0; i < n - 1; i++) push(init);
    return { push: push, width: n };
  }

  /* ---------- boxcar (running-sum moving average) ----------
     O(1) per sample regardless of length. The running sum accumulates
     rounding; recompute() exists so the harness can prove the drift
     stays under 1e-9 across a long render. Both language twins
     accumulate in the same order, so parity is unaffected either way. */
  function boxcar(len, init) {
    var n = len < 1 ? 1 : (len | 0);
    var buf = new Float64Array(n);
    for (var k = 0; k < n; k++) buf[k] = init;
    var i = 0, sum = init * n, inv = 1 / n;
    return {
      push: function (x) {
        sum += x - buf[i];
        buf[i] = x;
        i = i + 1 === n ? 0 : i + 1;
        return sum * inv;
      },
      sum: function () { return sum; },
      recompute: function () { var s = 0; for (var k2 = 0; k2 < n; k2++) s += buf[k2]; return s; },
      len: n
    };
  }

  /* ---------- integer delay line ---------- */
  function delay(len) {
    var n = len < 1 ? 1 : (len | 0);
    var buf = new Float64Array(n);
    var i = 0;
    return {
      push: function (x) {
        var y = buf[i];
        buf[i] = x;
        i = i + 1 === n ? 0 : i + 1;
        return y;
      },
      clear: function () { for (var k = 0; k < n; k++) buf[k] = 0; i = 0; },
      len: n
    };
  }

  /* ---------- first-order DC blocker ----------
     y[n] = x[n] - x[n-1] + R*y[n-1]; -3 dB at fc. */
  function dcBlocker(fc, fs) {
    var R = NM.exp(-2 * Math.PI * fc / fs);
    var x1 = 0, y1 = 0;
    return {
      tick: function (x) { var y = x - x1 + R * y1; x1 = x; y1 = y; return y; },
      clear: function () { x1 = 0; y1 = 0; },
      R: R
    };
  }

  /* ---------- RBJ section designers (sidechain filtering) ----------
     RIGOR needs a highpass and a lowpass on its detector. AUTOPSY has
     these already, but AUTOPSY is a sealed artifact with byte-stable
     hashes and does not get edited for tidiness, so the canonical copy
     lives here and rigor_test.js asserts the two agree bit-for-bit —
     the same arrangement makeNoise has.
     Returned a0-normalised as {b0,b1,b2,a1,a2}, ready for nd.biquad. */
  function norm(b0, b1, b2, a0, a1, a2) {
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }
  function secSosHP(f, q, fs) {
    var w0 = 2 * Math.PI * f / fs;
    var cw = NM.cos(w0), sw = NM.sin(w0);
    var alpha = sw / (2 * q);
    return norm((1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
  }
  function secSosLP(f, q, fs) {
    var w0 = 2 * Math.PI * f / fs;
    var cw = NM.cos(w0), sw = NM.sin(w0);
    var alpha = sw / (2 * q);
    return norm((1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
  }
  var BYPASS_SECTION = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

  /* ---------- transposed-direct-form-II biquad ----------
     Same structure AUTOPSY uses, so ported behaviour is already known. */
  function biquad() {
    var z1 = 0, z2 = 0;
    return {
      tick: function (c, x) {
        var y = c.b0 * x + z1;
        z1 = c.b1 * x - c.a1 * y + z2;
        z2 = c.b2 * x - c.a2 * y;
        return y;
      },
      clear: function () { z1 = 0; z2 = 0; }
    };
  }

  return {
    VERSION: VERSION,
    clamp: clamp, dbToLin: dbToLin, linToDb: linToDb, DB_FLOOR: DB_FLOOR,
    onePole: onePole, blend: blend,
    kneeOut: kneeOut, kneeGain: kneeGain, softClip: softClip,
    lcg: lcg, makeNoise: makeNoise,
    slidingMin: slidingMin, boxcar: boxcar, delay: delay,
    dcBlocker: dcBlocker, biquad: biquad,
    secSosHP: secSosHP, secSosLP: secSosLP, BYPASS_SECTION: BYPASS_SECTION,
    _nm: NM
  };
})(typeof module !== 'undefined' && module.exports
     ? require('./necromath.js') : NM);
if (typeof module !== 'undefined' && module.exports) module.exports = ND;
