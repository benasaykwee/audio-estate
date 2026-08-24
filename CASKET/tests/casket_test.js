/* CASKET core tests — node tests/casket_test.js */
'use strict';
var C = require('../casket_core.js');
var ND = require('../../shared/necrodyn.js');
var A = require('../../AUTOPSY/autopsy_core.js');
var FS = 48000;
var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
function near(a, b, eps, name) {
  ok(Math.abs(a - b) <= eps, name + ' (' + a + ' ≈ ' + b + ')');
}
function note(s) { console.log('    · ' + s); }
function db(x) { return 20 * Math.log10(Math.abs(x) + 1e-300); }

console.log('CASKET core v' + C.VERSION + ' — the lid comes down');

/* ============================================================
   1. shared substrate
   ============================================================ */
console.log('\n— the shared substrate —');
(function () {
  /* AUTOPSY keeps its own verbatim copy of Park-Miller on purpose (it is a
     sealed artifact). This is the test that stops the two from drifting. */
  var a = A.makeNoise(12345, 500), b = ND.makeNoise(12345, 500);
  var same = true;
  for (var i = 0; i < 500; i++) if (a[i] !== b[i]) same = false;
  ok(same, 'ND.makeNoise is bit-identical to AUTOPSY.makeNoise');

  /* knee: C1 continuity at both junctions, and the ceiling really is the ceiling */
  var T = -6, W = 4;
  var lo = ND.kneeOut(T - W / 2, T, W, 0), loRef = T - W / 2;
  near(lo, loRef, 1e-12, 'knee lower junction is continuous');
  near(ND.kneeOut(T + W / 2, T, W, 0), T, 1e-12, 'knee upper junction meets the lid');
  var d1 = (ND.kneeOut(T - W / 2 + 1e-6, T, W, 0) - ND.kneeOut(T - W / 2 - 1e-6, T, W, 0)) / 2e-6;
  near(d1, 1, 1e-4, 'knee slope is 1 entering the knee (C¹)');
  var d2 = (ND.kneeOut(T + W / 2 + 1e-6, T, W, 0) - ND.kneeOut(T + W / 2 - 1e-6, T, W, 0)) / 2e-6;
  near(d2, 0, 1e-4, 'knee slope is 0 leaving the knee (C¹)');
  var mx = -Infinity;
  for (var x = -40; x <= 20; x += 0.01) mx = Math.max(mx, ND.kneeOut(x, T, W, 0));
  ok(mx <= T + 1e-12, 'soft knee never exceeds the threshold');
  near(ND.kneeOut(0, 0, 0, 0), 0, 0, 'hard knee (W=0) does not divide by zero');

  /* soft clip */
  ok(ND.softClip(0.9, 1) === 0.9, 'softClip passthrough is EXACT when disarmed');
  ok(ND.softClip(50, 1) === 50, 'softClip disarmed passes even over-unity untouched');
  var t = 0.5;
  near(ND.softClip(t, t), t, 1e-15, 'softClip continuous at the knee');
  var s1 = (ND.softClip(t + 1e-6, t) - ND.softClip(t - 1e-6, t)) / 2e-6;
  near(s1, 1, 1e-4, 'softClip slope is 1 at the knee (C¹)');
  ok(ND.softClip(-0.8, 0.5) === -ND.softClip(0.8, 0.5), 'softClip is odd-symmetric');
  ok(ND.softClip(1e9, 0.5) < 1.0000001, 'softClip is bounded');

  /* sliding minimum vs brute force, bit-exact */
  var r = ND.lcg(777), N = 3000, w = 37;
  var src = new Float64Array(N);
  for (i = 0; i < N; i++) src[i] = Math.floor(r() * 100) / 10;
  var sm = ND.slidingMin(w, 0), good = true;
  for (i = 0; i < N; i++) {
    var got = sm.push(src[i]);
    var want = 0; // the w-1 pre-filled zeros are part of the window early on
    var lo2 = i - w + 1;
    want = (lo2 < 0) ? 0 : src[lo2];
    for (var k = Math.max(0, lo2); k <= i; k++) if (src[k] < want) want = src[k];
    if (lo2 < 0) { want = 0; for (k = 0; k <= i; k++) if (src[k] < want) want = src[k]; }
    if (got !== want) { good = false; break; }
  }
  ok(good, 'slidingMin matches brute force bit-exactly over 3000 samples');

  /* boxcar running-sum drift over a long render — asserted RELATIVE,
     because the error is a random walk that scales with the sum */
  var bc = ND.boxcar(512, 0), r2 = ND.lcg(9182);
  for (i = 0; i < 48000 * 60; i++) bc.push(-r2() * 12);
  var rd = Math.abs(bc.sum() - bc.recompute()) / (Math.abs(bc.recompute()) + 1e-30);
  ok(rd < 1e-10, 'boxcar running sum survives 60 s (' + rd.toExponential(2) + ' relative)');
})();

/* ============================================================
   2. the lining (oversampler)
   ============================================================ */
console.log('\n— the lining —');
(function () {
  C.LININGS.forEach(function (M) {
    var o = C.designOversampler(M, C.OS_Q);
    if (M === 1) { ok(o.phases[0][0] === 1, 'lining 1× is the identity'); return; }
    var bad = 0;
    for (var k = 0; k < o.len; k++) {
      if ((k - o.center) % M === 0) {
        var want = (k === o.center) ? 1 : 0;
        if (o.taps[k] !== want) bad++;
      }
    }
    ok(bad === 0, 'lining ' + M + '× is an Mth-band filter EXACTLY (branch 0 is a pure delay)');
  });

  /* reconstruction accuracy — the property true-peak detection rests on.
     Warm-up is skipped: the silence→signal step at a buffer edge is a real
     discontinuity and its ringing is a real true peak, not filter error. */
  var o8 = C.designOversampler(8, 32);
  [100, 1000, 6000, 12000, 19000].forEach(function (f) {
    var n = 3000, w = 2 * Math.PI * f / FS;
    var x = new Float64Array(n);
    for (var i = 0; i < n; i++) x[i] = Math.sin(w * i + 0.3);
    var histN = o8.histLen, h = new Float64Array(histN), p = 0, worst = 0;
    for (var s = 0; s < n; s++) {
      h[p] = x[s]; p = p + 1 === histN ? 0 : p + 1;
      for (var ph = 1; ph < 8; ph++) {
        var taps = o8.phases[ph], acc = 0, idx = p - 1;
        for (var j = 0; j < taps.length; j++) {
          if (idx < 0) idx += histN;
          acc += taps[j] * h[idx]; idx--;
        }
        var t = (s - 32) + ph / 8;
        if (t < 200 || t > n - 200) continue;
        var e = Math.abs(acc - Math.sin(w * t + 0.3));
        if (e > worst) worst = e;
      }
    }
    ok(worst < 2e-5, 'reconstruction at ' + f + ' Hz within 2e-5 (' + worst.toExponential(2) + ')');
  });
})();

/* ============================================================
   3. latency — reported must equal measured, exactly
   ============================================================ */
console.log('\n— latency —');
(function () {
  C.LININGS.forEach(function (M) {
    [0.1, 1, 5].forEach(function (v) {
      var st = C.defaultState();
      st.lining = M; st.vigil = v; st.dc = false; st.lid = 0; st.style = 'pine';
      var e = C.createEngine(FS); e.setState(st);
      var n = 4096, x = new Float64Array(n), z = new Float64Array(n);
      x[1000] = 0.25;
      var oL = new Float64Array(n), oR = new Float64Array(n);
      e.process(x, z, oL, oR);
      var at = -1;
      for (var i = 0; i < n; i++) if (oL[i] !== 0) { at = i; break; }
      var want = 1000 + C.latencySamples(st, FS);
      ok(at === want, 'lining ' + M + '× vigil ' + v + ' ms: impulse lands at reported latency (' + at + ')');
    });
  });
  var st2 = C.defaultState(); st2.lining = 16; st2.vigil = 3;
  var st4 = C.defaultState(); st4.lining = 4; st4.vigil = 3;
  ok(C.latencySamples(st2, FS) === C.latencySamples(st4, FS),
     'latency is independent of the lining — 4× and 16× report the same');
})();

/* ============================================================
   4. THE NULL TEST — the most valuable line in the suite
   ============================================================ */
console.log('\n— the null test —');
(function () {
  C.STYLES.forEach(function (style) {
    var st = C.defaultState();
    var d = C.styleDefaults(style);
    for (var k in d) st[k] = d[k];
    st.style = style; st.dc = false; st.sat = 0; st.lid = 0; st.margin = 0;
    var e = C.createEngine(FS); e.setState(st);
    var n = 16384, x = C.makeNoise(4242, n);
    for (var i = 0; i < n; i++) x[i] *= 0.1;         // −20 dBFS, far under the lid
    var xr = C.makeNoise(9111, n);
    for (i = 0; i < n; i++) xr[i] *= 0.1;
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(x, xr, oL, oR);
    var lat = C.latencySamples(st, FS), errs = 0;
    for (i = lat; i < n; i++) {
      if (oL[i] !== x[i - lat]) errs++;
      if (oR[i] !== xr[i - lat]) errs++;
    }
    /* Lead is sealed, and a sealed arrangement CANNOT be bit-identical —
       its idle output is decimate(upsample(x)), which is not x. That is
       the trade, made deliberately, so the test asserts the trade rather
       than pretending it did not happen. Every other arrangement must
       still be exact, and that is what keeps the choice a real choice. */
    if (st.seal) {
      ok(errs > 0, style + ' is sealed, so it is NOT bit-identical — as designed');
    } else {
      ok(errs === 0, style + ': idle output is BIT-IDENTICAL to the delayed input');
    }
  });
  /* dither off must not perturb a single bit either */
  var st = C.defaultState(); st.dc = false; st.lid = 0; st.dust = 'off';
  var e = C.createEngine(FS); e.setState(st);
  var n = 8192, x = C.makeNoise(31337, n);
  for (var i = 0; i < n; i++) x[i] *= 0.05;
  var a1 = new Float64Array(n), a2 = new Float64Array(n);
  e.process(x, x, a1, a2);
  var lat = C.latencySamples(st, FS), bad = 0;
  for (i = lat; i < n; i++) if (a1[i] !== x[i - lat]) bad++;
  ok(bad === 0, 'the dust disarmed leaves the signal untouched');
})();

/* ============================================================
   5. THE GUARANTEE
   ============================================================ */
console.log('\n— the guarantee —');

/* 5a. the theorem itself, on synthetic gain data, independent of the engine */
(function () {
  var r = ND.lcg(4242), N = 20000, L = 96, B = Math.floor(L / 2) + 1;
  var req = new Float64Array(N);
  for (var i = 0; i < N; i++) req[i] = r() < 0.06 ? -r() * 30 : 0;   // sparse deep dips
  var sm = ND.slidingMin(L + 1, 0), b1 = ND.boxcar(B, 0), b2 = ND.boxcar(B, 0);
  var g = new Float64Array(N);
  for (i = 0; i < N; i++) g[i] = b2.push(b1.push(sm.push(req[i])));
  /* g[n] is aligned to req[n-L]; assert g never exceeds what was required */
  var worst = -Infinity;
  for (i = L; i < N; i++) {
    var d = g[i] - req[i - L];
    if (d > worst) worst = d;
  }
  /* In exact arithmetic worst <= 0, always. What is left is the boxcar's
     running-sum rounding, and its size is the point of the assertion:
     1e-13 dB is rounding, 1e-2 dB would be a broken theorem. */
  ok(worst < 1e-9, 'sliding-min ∘ triangle never exceeds the required gain, to rounding');
  note('worst excess over 20 000 samples: ' + worst.toExponential(3) + ' dB');
})();

/* 5a-ii. THE THEOREM'S HYPOTHESIS, asserted directly.
   ------------------------------------------------------------------
   Added 2026-08-16 because the mutation tester found a hole here.

   Everything above tests a CONSEQUENCE of the overshoot theorem — that the
   smoothed gain never exceeds the required gain, and that no output sample
   passes the lid. The theorem itself has a precondition: the triangular
   smoother's support must lie inside the sliding minimum's window [0, L].
   Nothing asserted that.

   `casket_mutate.js` mutant 5 widens the smoother by one sample, which
   violates the precondition by two oversampled samples out of several
   hundred — and the entire suite stayed green. Not because the code was
   still correct, but because a violation that small is absorbed by the
   final safety clamp, and the clamp-work assertion's threshold is looser
   than the damage. The theorem had stopped being proven and every test
   that could have noticed was measuring downstream of the thing that
   hides it.

   So: assert the precondition itself, across every combination that can
   reach it. A property test of a hypothesis is worth more than any number
   of tests of its consequences, because the consequences have a clamp
   standing in front of them and the hypothesis does not. */
(function () {
  var worstSlack = Infinity, worstAt = '', n = 0;
  ['pine', 'velvet', 'oak', 'iron', 'lead'].forEach(function (style) {
    [1, 2, 4, 8, 16].forEach(function (lining) {
      [0.1, 0.5, 1, 1.5, 2, 3, 5, 10, 20].forEach(function (vigil) {
        [44100, 48000, 88200, 96000, 192000].forEach(function (fs) {
          var st = C.sanitizeState(
            Object.assign(C.defaultState(), { style: style, lining: lining, vigil: vigil }));
          var L = C.vigilSamples(st, fs);          /* base-rate window   */
          var B = C.boxLen(st, fs);                /* one boxcar's length */
          /* two cascaded boxcars of B have triangular support 2B-2,
             measured in OVERSAMPLED samples; the window is M*L of them */
          var slack = st.lining * L - (2 * B - 2);
          n++;
          if (slack < worstSlack) {
            worstSlack = slack;
            worstAt = style + ' ' + st.lining + '× ' + vigil + ' ms @ ' + fs;
          }
        });
      });
    });
  });
  ok(worstSlack >= 0,
     'the smoother\'s support never leaves the vigil — the theorem\'s hypothesis holds');
  note(n + ' combinations; tightest slack ' + worstSlack +
       ' oversampled samples at ' + worstAt);
})();

/* 5a-iii. WHAT THE NULL TEST DOES NOT SAY, measured.
   ------------------------------------------------------------------
   Added 2026-08-16, chasing a surviving mutant, and it turned into a
   qualification of the headline claim rather than a bug.

   The null test above proves a FRESH engine passes its input through
   bit-identically. It says nothing about an engine that has already done
   work — and after limiting, three of the five arrangements never return
   to exactly unity. Measured, at 6 seconds of silence after a 0.1 s burst:

       pine    exact          linear release, arrives at zero by addition
       oak     exact
       velvet  −6.0e-10 dB    a full-span smoother that has been driven
       iron    +1.9e-15 dB    one ulp

   This is not the release envelope failing to snap — that guard works.
   It is the two cascaded boxcars, whose running sums do not return to
   exactly zero once a large value has passed through them. §3 of the
   interchange already documents this about `ND.boxcar`: *the error is a
   RANDOM WALK; assert it relative, never absolute.* What was never
   written down is the consequence for CASKET's loudest promise.

   So the honest statement is: **the null test is bit-exact for an engine
   that has not limited, and exact to about 1e-9 relative for one that
   has.** −6e-10 dB is nothing anybody will ever hear. But an unbounded
   nothing becomes a something, and this is the assertion that keeps it
   bounded — if a future change makes the residue grow, it fails here
   rather than in somebody's master. */
/* SIX seconds of silence, not two. Written with two first, and velvet
   failed at 4.3e-5 — which is not the residue, it is the release still
   releasing. Velvet's program-dependent release stretches its own time
   constant, so two seconds after a hard burst it is still audibly on its
   way down. Worth knowing on its own: "the release has finished" and "the
   release setting has elapsed" are several seconds apart on that
   arrangement. The tail has to outlast the release before what is left
   can honestly be called a residue. */
(function () {
  var fsL = 48000, burst = Math.floor(fsL * 0.1), n = burst + fsL * 6;
  var worst = 0, worstStyle = '', exact = {};
  ['pine', 'velvet', 'oak', 'iron'].forEach(function (style) {
    var st = C.defaultState(), d = C.styleDefaults(style);
    for (var k in d) st[k] = d[k];
    st.style = style; st.dc = false; st.sat = 0; st.lid = 0;
    st.margin = 0; st.dust = 'off';
    st = C.sanitizeState(st);

    var L = new Float64Array(n), R = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var v = Math.sin(2 * Math.PI * 220 * i / fsL);
      L[i] = R[i] = i < burst ? v * 0.98 : 0;          /* drive it hard, then silence */
    }
    var e = C.createEngine(fsL); e.setState(st);
    e.process(L, R, new Float64Array(n), new Float64Array(n));

    /* now hand it quiet material the lid cannot possibly touch */
    var q = 4096, qL = new Float64Array(q), qR = new Float64Array(q);
    for (i = 0; i < q; i++) { qL[i] = Math.sin(2 * Math.PI * 220 * i / fsL) * 0.05; qR[i] = qL[i]; }
    var pL = new Float64Array(q), pR = new Float64Array(q);
    e.process(qL, qR, pL, pR);

    var lat = C.latencySamples(st, fsL), diffs = 0;
    for (i = lat; i < q; i++) {
      var ref = qL[i - lat];
      if (pL[i] !== ref) diffs++;
      if (ref === 0) continue;
      var rel = Math.abs(pL[i] / ref - 1);
      if (rel > worst) { worst = rel; worstStyle = style; }
    }
    exact[style] = diffs === 0;
  });
  ok(worst < 1e-9,
     'after limiting, the box reopens to within 1e-9 relative — the smoother\'s residue is bounded');
  note('worst residue ' + worst.toExponential(3) + ' relative (' +
       (20 * Math.log10(1 - worst)).toExponential(2) + ' dB) on ' + worstStyle);

  /* Two of the four reopen EXACTLY, and that is a stronger claim worth its
     own assertion rather than being folded into the bound above.
       pine  arrives at zero by addition — a linear release overshoots and
             the `n > gr` clamp lands it on exactly gr.
       oak   arrives by the snap in `advance()`, because a multiplicative
             release only ever approaches zero asymptotically.
     Those are two different mechanisms reaching the same place, and oak is
     the one that proves the snap is doing real work. Loosen the snap's
     threshold and this assertion is the only thing in the suite that
     notices — the relative bound above cannot, because an envelope stuck at
     1e-18 dB is comfortably inside 1e-9. */
  ok(exact.pine && exact.oak,
     'pine and oak reopen BIT-EXACTLY after limiting — by clamp and by snap respectively');
  note('exact after release: ' + Object.keys(exact).filter(function (k) { return exact[k]; }).join(', ') +
       ' · inexact: ' + Object.keys(exact).filter(function (k) { return !exact[k]; }).join(', '));
})();

/* 5a-iv. Why the knee guard is allowed to be a `<=`.
   `requiredGr` short-circuits with `if (a <= kneeStartLin) return 0`. The
   mutation tester flips that to `<` and the suite stays green, which looks
   like a hole at a boundary — the exact shape of every bug LAW 5 describes.
   It is not one: `ND.kneeGain` returns EXACTLY zero at the knee start, so
   both spellings compute the same thing and the guard is a speed
   optimisation rather than a correctness one.
   That is currently true by luck. ND is shared, and a future change there
   could make it 1e-17 instead of 0, at which point the guard silently
   becomes load-bearing and the mutant silently becomes a real hole. So the
   equivalence is pinned here rather than assumed. */
(function () {
  var bad = 0, ND2 = C._nd;
  [[0, -1], [3, -1], [6, -6], [1.5, -0.3], [12, -20], [0.5, 0]].forEach(function (p) {
    var W = p[0], T = p[1];
    if (ND2.kneeGain(T - W / 2, T, W, 0) !== 0) bad++;
  });
  ok(bad === 0,
     'kneeGain is EXACTLY zero at the knee start — which is what makes the `<=` guard equivalent');
})();

/* 5a-v. Why the release snap is unreachable, and what would make it matter.
   `advance()` snaps the envelope to exact zero once it is within 1e-12 dB.
   The mutation tester loosens that to 1e-30 and nothing anywhere goes red,
   through four different attempts to catch it. The reason is that TWO other
   mechanisms reach exactness first:

     · dbToLin returns EXACTLY 1.0 for any magnitude below 4.82e-16 dB, so
       the last sliver of reduction rounds away by itself;
     · the sliding minimum emits exact zero as soon as its window contains
       only zeros — one vigil after the signal stops.

   Both are properties of code that lives elsewhere: ND, and a primitive
   shared with RIGOR. If either changed, the snap would stop being
   defensive and start being the only thing standing between this project
   and a null test that is merely very good. Pinned here so that change
   announces itself. */
(function () {
  var ND2 = C._nd;
  ok(ND2.dbToLin(-4.8e-16) === 1 && ND2.dbToLin(4.8e-16) === 1,
     'dbToLin rounds to EXACTLY 1.0 below ~4.8e-16 dB — the first reason the snap is unreachable');
  ok(ND2.dbToLin(-1e-12) !== 1,
     'and NOT at 1e-12 dB, so the snap\'s own threshold is doing real work when it fires');
  var sm = ND2.slidingMin(8, 0), out = 0;
  for (var i = 0; i < 4; i++) sm.push(-6);      /* fill with reduction   */
  for (i = 0; i < 16; i++) out = sm.push(0);    /* then flush with zeros */
  ok(out === 0,
     'the sliding minimum emits EXACT zero once its window is clear — the second reason');
})();

/* 5a-vi. The bypass TOGGLE, not the bypass state.
   ------------------------------------------------------------------
   Added 2026-08-16 from a surviving mutant. Four places in this file set
   `bypass = true` before processing; not one of them ever turns it on
   part-way through, which is the only situation the round-5 bug could
   occur in. The fix then was to push audio into the bypass delay line on
   EVERY sample, bypassed or not, so a toggle finds it primed. Stop feeding
   it and the mutation tester walks straight past every assertion here.
   RIGOR shipped the same defect, and its second half was a burst of
   digital silence on leaving bypass. */
(function () {
  var fsL = 48000, n = 8192;
  var L = new Float64Array(n), R = new Float64Array(n);
  for (var i = 0; i < n; i++) {
    L[i] = Math.sin(2 * Math.PI * 300 * i / fsL) * 0.9;
    R[i] = Math.sin(2 * Math.PI * 410 * i / fsL) * 0.9;
  }
  var st = C.defaultState();
  st.dc = false; st.sat = 0; st.lid = -1; st.dust = 'off'; st.bypass = false;
  st = C.sanitizeState(st);
  var lat = C.latencySamples(st, fsL);

  var e = C.createEngine(fsL); e.setState(st);
  var aL = new Float64Array(n), aR = new Float64Array(n);
  e.process(L, R, aL, aR);              /* limit hard for a while … */

  st.bypass = true; e.setState(st);     /* … then hit bypass mid-stream */
  var bL = new Float64Array(n), bR = new Float64Array(n);
  var L2 = new Float64Array(n), R2 = new Float64Array(n);
  for (i = 0; i < n; i++) {
    L2[i] = Math.sin(2 * Math.PI * 300 * (i + n) / fsL) * 0.9;
    R2[i] = Math.sin(2 * Math.PI * 410 * (i + n) / fsL) * 0.9;
  }
  e.process(L2, R2, bL, bR);

  /* Bypassed output must be the input delayed by exactly the reported
     latency — the first `lat` samples come from the tail of the previous
     buffer, which the line can only supply if it was being fed all along. */
  var bad = 0, silent = 0;
  for (i = lat; i < n; i++) {
    if (bL[i] !== L2[i - lat]) bad++;
    if (bR[i] !== R2[i - lat]) bad++;
  }
  for (i = 0; i < lat; i++) if (bL[i] === 0 && bR[i] === 0) silent++;

  ok(bad === 0, 'bypass engaged mid-stream still delays by exactly the reported latency');
  ok(silent < lat, 'and the first block after the toggle is not a dropout');
  note('checked ' + (n - lat) + ' samples across the toggle; ' + silent +
       ' of the first ' + lat + ' were silent');
})();

/* 5a-vii. `quantize`, which had no JavaScript test whatsoever.
   ------------------------------------------------------------------
   The mutation tester swapped `Math.round(x * inv) / inv` for
   `Math.round(x / g) * g` and the whole suite stayed green. Searching for
   why turned up something worse than a missing assertion: `quantize`
   appeared in exactly two files, `parity_emit.js` and the mutation tester
   itself. Its ONLY guard was the parity gate.

   A parity gate proves the two twins agree. It does not prove either is
   right. Spell this function wrong in JavaScript, port the same wrong
   spelling to C++, and 22,861 checks pass while every control lands on the
   wrong grid point. §7 already records that the two spellings disagree at
   exact halves — 0.35 → 0.3 one way and 0.4 the other — and that bisection
   midpoints over a dB range hit exact halves constantly.

   The rule this is an instance of: **agreement is not correctness, and a
   value that only a parity gate checks is a value nobody has checked.** */
(function () {
  var bad = [];
  /* the *inv spelling is the browser's, so it is the one the core must use */
  /* −9.75 → −9.7, NOT −9.8. Written as −9.8 first, out of the habit of
     assuming halves round away from zero; §7 of the interchange says
     otherwise and it is right. JS `Math.round` sends halves toward +∞, so
     every NEGATIVE half goes the opposite way from a C++ `std::round`.
     That is the note for anyone porting this: use `std::floor(x + 0.5)`. */
  [[0.35, 0.1, 0.4], [-0.35, 0.1, -0.3], [0.25, 0.1, 0.3], [-9.75, 0.1, -9.7],
   [2.5, 1, 3], [-2.5, 1, -2], [0.05, 0.1, 0.1], [-0.05, 0.1, -0]]
    .forEach(function (t) {
      var got = C.quantize(t[0], t[1]);
      if (Math.abs(got - t[2]) > 1e-12) bad.push(t[0] + '/' + t[1] + ' → ' + got + ', want ' + t[2]);
    });
  ok(bad.length === 0, 'quantize uses the *inv spelling, exactly, at halves and negative halves');
  if (bad.length) note(bad.join('  ·  '));

  /* and the two spellings really do differ, or the test above proves nothing */
  var differs = 0;
  for (var k = -200; k <= 200; k++) {
    var x = k / 40;                                   /* lands on exact halves of 0.1 */
    if (C.quantize(x, 0.1) !== Math.round(x / 0.1) * 0.1) differs++;
  }
  ok(differs > 0,
     'the two spellings genuinely disagree somewhere in range — so pinning one means something');
  note('they differ at ' + differs + ' of 401 grid probes');
})();

/* 5b. the engine, against hostile material, at zero epsilon */
(function () {
  var n = 48000;
  var mats = {
    'clipped noise': (function () { var a = C.makeNoise(555, n); for (var i = 0; i < n; i++) a[i] = a[i] * 6 > 1 ? 1 : (a[i] * 6 < -1 ? -1 : a[i] * 6); return a; })(),
    'square 110 Hz': C.makeSquare(110, FS, n, 1.0),
    'impulse train': C.makeImpulses(97, n, 1.0),
    'DC step': (function () { var a = new Float64Array(n); for (var i = n / 3 | 0; i < n; i++) a[i] = 0.98; return a; })(),
    'sine 19 kHz': C.makeSine(19000, FS, n, 1.0)
  };
  C.STYLES.forEach(function (style) {
    var st = C.defaultState();
    var d = C.styleDefaults(style);
    for (var k in d) st[k] = d[k];
    st.style = style; st.lid = -1.0; st.drive = 12;
    var lidLin = C._nd.dbToLin(st.lid + st.margin);
    var worstAll = -Infinity, over = 0, clampWorst = 0;
    Object.keys(mats).forEach(function (name) {
      var e = C.createEngine(FS); e.setState(st);
      var oL = new Float64Array(n), oR = new Float64Array(n);
      e.process(mats[name], mats[name], oL, oR);
      var dbg = e._debug();
      if (dbg.clampWorst > clampWorst) clampWorst = dbg.clampWorst;
      for (var i = 0; i < n; i++) {
        var a = Math.abs(oL[i]);
        if (a > worstAll) worstAll = a;
        if (a > lidLin) over++;
      }
    });
    ok(over === 0, style + ': not one sample exceeds the lid — 5 hostile signals × 48 000, zero epsilon');
    /* UNSEALED the clamp is a last-ulp backstop, and its size is the
       theorem's empirical receipt: if the design were wrong it would be
       doing real work. SEALED it also absorbs the decimation filter's
       ripple, so it is allowed to be larger — but only barely, and the
       number is asserted rather than waved at. Measured across the whole
       battery: 2 samples in 96,000, on a full-scale 19 kHz sine, 0.088 dB. */
    if (st.seal) {
      ok(clampWorst < 0.02, style + ' (sealed): the clamp absorbs decimator ripple, ' +
         (20 * Math.log10(1 + clampWorst)).toFixed(4) + ' dB at worst');
    } else {
      ok(clampWorst < 1e-12, style + ': the rounding clamp only ever caught rounding (' +
         (clampWorst === 0 ? '0' : clampWorst.toExponential(2)) + ' relative)');
    }
    note('peak reached ' + db(worstAll).toFixed(4) + ' dB against a lid of ' +
         (st.lid + st.margin).toFixed(2) + ' dB');
  });
})();

/* 5c. TRUE-PEAK RESIDUAL — measured, reported, and not overclaimed.
   Detection is oversampled; the gain is APPLIED at base rate. When the
   gain is slow relative to Nyquist, that costs nothing and the output's
   reconstruction lands exactly on the lid. When the material demands a
   gain that moves fast — full-scale, full-band, square-edged — the
   product of gain and signal has energy above Nyquist, sampling folds it
   back, and a residual appears. So the residual is governed by the VIGIL
   (how fast the gain is allowed to move), not by the LINING (how well we
   see). Both sweeps are printed because that distinction is the single
   most useful thing to know when setting this thing up. */
(function () {
  var n = 48000;
  function clipped(scale) {
    var a = C.makeNoise(2718, n);
    for (var i = 0; i < n; i++) { var v = a[i] * scale; a[i] = v > 1 ? 1 : (v < -1 ? -1 : v); }
    return a;
  }
  function lowpass(x, fc) {
    var y = new Float64Array(x.length), a = Math.exp(-2 * Math.PI * fc / FS), p = 0;
    for (var i = 0; i < x.length; i++) { p = a * p + (1 - a) * x[i]; y[i] = p; }
    var m = 0;
    for (i = 0; i < y.length; i++) m = Math.max(m, Math.abs(y[i]));
    for (i = 0; i < y.length; i++) y[i] /= m;
    return y;
  }
  var musical = (function () {
    var b = new Float64Array(n);
    [55, 110, 220, 440, 880, 1760, 3520, 7040].forEach(function (f, k) {
      for (var i = 0; i < n; i++) b[i] += Math.sin(2 * Math.PI * f * i / FS + k * 0.7) / 8;
    });
    var m = 0;
    for (var i = 0; i < n; i++) m = Math.max(m, Math.abs(b[i]));
    for (i = 0; i < n; i++) b[i] /= m;
    return b;
  })();
  var band = lowpass(lowpass(clipped(8), 9000), 9000);
  var full = clipped(8);

  function out(src, opt) {
    var st = C.defaultState();
    st.style = 'velvet'; st.lid = -1.0; st.margin = 0; st.drive = 12; st.dc = false;
    st.lining = opt.lining; st.vigil = opt.vigil;
    var e = C.createEngine(FS); e.setState(st);
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(src, src, oL, oR);
    return db(C.truePeakOf(oL, 16, 4000)) + 1.0;   // residual above the −1 dB lid
  }

  console.log('  true-peak residual above a −1.0 dBTP lid, +12 dB drive:');
  console.log('    material            in dBTP    4× lining   16× lining');
  var mats = { 'harmonic (musical)': musical, 'band-limited clip': band, 'full-band clip': full };
  var res = {};
  Object.keys(mats).forEach(function (k) {
    var a = out(mats[k], { lining: 4, vigil: 2 }), b = out(mats[k], { lining: 16, vigil: 2 });
    res[k] = b;
    console.log('    ' + k.padEnd(20) +
      db(C.truePeakOf(mats[k], 16, 4000)).toFixed(2).padStart(7) +
      (a >= 0 ? '   +' : '   ') + a.toFixed(3) +
      (b >= 0 ? '     +' : '     ') + b.toFixed(3));
  });
  ok(Math.abs(res['harmonic (musical)']) < 0.001,
     'on harmonic material the output lands ON the lid (±0.001 dB)');
  ok(res['band-limited clip'] < 0.60,
     'band-limited clipped material stays within 0.6 dB of the lid');
  ok(res['full-band clip'] < 1.25,
     'full-scale full-band clipped noise — the worst case — stays within 1.25 dB');
  /* The lining is DETECTION. It does not touch the residual, and the
     numbers above say so out loud: 4× and 16× agree to three decimals on
     the pathological case. Anyone reading the table should take that as
     the finding it is, not as a filter that needs tuning. */
  ok(Math.abs(res['full-band clip'] - out(full, { lining: 4, vigil: 2 })) < 0.01,
     'the lining does NOT change the residual — it is a gain-application effect');

  console.log('  the same pathological signal, sweeping the VIGIL at 16×:');
  var prev = Infinity, monotone = true;
  [0.5, 1, 2, 5, 10, 20].forEach(function (v) {
    var r = out(full, { lining: 16, vigil: v });
    console.log('    vigil ' + (v + ' ms').padStart(6) + '  → residual ' +
                (r >= 0 ? '+' : '') + r.toFixed(3) + ' dB');
    if (r > prev + 0.02) monotone = false;
    prev = r;
  });
  ok(monotone, 'a longer vigil lowers the residual monotonically (a slower gain aliases less)');
  ok(out(full, { lining: 16, vigil: 20 }) < out(full, { lining: 16, vigil: 0.5 }) - 0.1,
     'a 20 ms vigil buys real headroom over 0.5 ms — but does not close the gap');
})();

/* ============================================================
   5d. THE SEAL — the switchable oversampled gain path
   ============================================================ */
console.log('\n— the seal —');
(function () {
  /* Unsealed arrangements must be untouched by the seal's existence.
     This is the assertion that keeps the choice a real choice. */
  ['pine', 'velvet', 'oak', 'iron'].forEach(function (style) {
    var st = C.defaultState(), d = C.styleDefaults(style);
    for (var k in d) st[k] = d[k];
    st.style = style; st.dc = false; st.sat = 0; st.lid = 0; st.margin = 0;
    ok(st.seal === false, style + ' is unsealed by default');
    var e = C.createEngine(FS); e.setState(st);
    var n = 8192, x = C.makeNoise(4242, n);
    for (var i = 0; i < n; i++) x[i] *= 0.1;
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(x, x, oL, oR);
    var lat = C.latencySamples(st, FS), bad = 0;
    for (i = lat; i < n; i++) if (oL[i] !== x[i - lat]) bad++;
    ok(bad === 0, style + ' still passes the BIT-EXACT null test');
  });
  ok(C.styleDefaults('lead').seal === true, 'lead is the sealed arrangement');

  /* sealed latency is exact and still independent of the lining */
  [2, 4, 8, 16].forEach(function (M) {
    var st = C.defaultState();
    st.seal = true; st.lining = M; st.vigil = 1; st.dc = false; st.lid = 0; st.style = 'pine';
    var e = C.createEngine(FS); e.setState(st);
    var n = 8192, x = new Float64Array(n), z = new Float64Array(n);
    x[2000] = 0.25;
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(x, z, oL, oR);
    var pk = 0, at = -1;
    for (var i = 0; i < n; i++) if (Math.abs(oL[i]) > pk) { pk = Math.abs(oL[i]); at = i; }
    ok(at === 2000 + C.latencySamples(st, FS),
       'sealed ' + M + '×: impulse peaks at the reported latency (' + at + ')');
  });
  var a = C.defaultState(); a.seal = true; a.lining = 2; a.vigil = 3;
  var b = C.defaultState(); b.seal = true; b.lining = 16; b.vigil = 3;
  ok(C.latencySamples(a, FS) === C.latencySamples(b, FS),
     'sealed latency is still independent of the lining');
  var u = C.defaultState(); u.seal = false; u.vigil = 3;
  ok(C.latencySamples(a, FS) - C.latencySamples(u, FS) === C.DEC_Q,
     'sealing costs exactly DEC_Q (' + C.DEC_Q + ') extra samples of latency');

  /* sealed at 1× is a contradiction and is corrected, not obeyed */
  ok(C.sanitizeState({ seal: true, lining: 1 }).lining === 2,
     'sealed at 1× is corrected to 2× (there is no oversampled domain at 1×)');
  ok(C.sanitizeState({ seal: false, lining: 1 }).lining === 1,
     'unsealed at 1× is left alone');

  /* the decimator is a DIFFERENT filter from the interpolator, and unit DC */
  var dec = C.designDecimator(4, C.DEC_Q, C.DEC_CUT);
  var sum = 0;
  for (var k2 = 0; k2 < dec.len; k2++) sum += dec.taps[k2];
  near(sum, 1, 1e-12, 'the decimator has unit DC gain');
  ok(dec.len === 2 * C.DEC_Q * 4 + 1, 'decimator length scales with the lining');
  var os = C.designOversampler(4, C.OS_Q);
  ok(dec.len !== os.len, 'the decimator is not the interpolator — different jobs, different filters');
})();

(function () {
  /* WHAT SEALING BUYS, and what it costs. Both measured. */
  var n = 48000;
  function clipped(scale) {
    var a = C.makeNoise(2718, n);
    for (var i = 0; i < n; i++) { var v = a[i] * scale; a[i] = v > 1 ? 1 : (v < -1 ? -1 : v); }
    return a;
  }
  function lowpass(x, fc) {
    var y = new Float64Array(x.length), a = Math.exp(-2 * Math.PI * fc / FS), p = 0, i;
    for (i = 0; i < x.length; i++) { p = a * p + (1 - a) * x[i]; y[i] = p; }
    var m = 0;
    for (i = 0; i < y.length; i++) m = Math.max(m, Math.abs(y[i]));
    for (i = 0; i < y.length; i++) y[i] /= m;
    return y;
  }
  var musical = (function () {
    var b = new Float64Array(n), i;
    [55, 110, 220, 440, 880, 1760, 3520, 7040].forEach(function (f, k) {
      for (i = 0; i < n; i++) b[i] += Math.sin(2 * Math.PI * f * i / FS + k * 0.7) / 8;
    });
    var m = 0;
    for (i = 0; i < n; i++) m = Math.max(m, Math.abs(b[i]));
    for (i = 0; i < n; i++) b[i] /= m;
    return b;
  })();
  var band = lowpass(lowpass(clipped(8), 9000), 9000), full = clipped(8);
  function resid(src, seal) {
    var st = C.defaultState();
    st.style = 'velvet'; st.lid = -1; st.margin = 0; st.drive = 12; st.dc = false;
    st.lining = 4; st.vigil = 2; st.seal = seal;
    var e = C.createEngine(FS); e.setState(st);
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(src, src, oL, oR);
    return db(C.truePeakOf(oL, 16, 4000)) + 1.0;
  }
  console.log('  true-peak residual above a −1.0 dBTP lid, +12 dB drive, 4× lining:');
  var gains = {};
  [['harmonic / musical', musical], ['band-limited clip', band], ['full-band clip', full]]
    .forEach(function (p) {
      var u = resid(p[1], false), s = resid(p[1], true);
      gains[p[0]] = u - s;
      console.log('    ' + p[0].padEnd(20) + 'unsealed ' + (u >= 0 ? '+' : '') + u.toFixed(3) +
                  '   sealed ' + (s >= 0 ? '+' : '') + s.toFixed(3) +
                  '   (' + (u - s >= 0 ? '−' : '+') + Math.abs(u - s).toFixed(3) + ' dB)');
    });
  ok(gains['full-band clip'] > 0.5, 'sealing buys over half a dB on the worst case');
  ok(gains['band-limited clip'] > 0.15, 'and buys real headroom on band-limited material');
  ok(Math.abs(gains['harmonic / musical']) < 0.01,
     'on musical material there was nothing to buy — both already land on the lid');

  /* the price: the up/down conversion is no longer an identity */
  function idleErr(src) {
    var st = C.defaultState();
    st.seal = true; st.lining = 4; st.lid = 0; st.dc = false;
    var e = C.createEngine(FS); e.setState(st);
    var m = src.length, oL = new Float64Array(m), oR = new Float64Array(m);
    e.process(src, src, oL, oR);
    var lat = C.latencySamples(st, FS), er = 0, sg = 0;
    for (var i = lat + 3000; i < m - 3000; i++) {
      var d2 = oL[i] - src[i - lat];
      er += d2 * d2; sg += src[i - lat] * src[i - lat];
    }
    return db(Math.sqrt(er) / Math.sqrt(sg));
  }
  var quiet = new Float64Array(n);
  for (var i = 0; i < n; i++) quiet[i] = musical[i] * 0.25;
  var white = C.makeNoise(4242, n);
  for (i = 0; i < n; i++) white[i] *= 0.1;
  var em = idleErr(quiet), ew = idleErr(white);
  ok(em < -100, 'sealed idle error on musical content is ' + em.toFixed(1) + ' dB — inaudible');
  note('on white noise it is ' + ew.toFixed(1) + ' dB, which is a fact about white noise: ' +
       'a quarter of its energy sits above 18 kHz, where the decimator rolls off');
})();

(function () {
  /* the rolloff, stated in numbers rather than adjectives */
  function respAt(f) {
    var st = C.defaultState();
    st.seal = true; st.lining = 4; st.lid = 0; st.dc = false; st.vigil = 2;
    var e = C.createEngine(FS); e.setState(st);
    var n = 24000, x = C.makeSine(f, FS, n, 0.25);
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(x, x, oL, oR);
    var mx = 0;
    for (var i = 8000; i < n - 2000; i++) mx = Math.max(mx, Math.abs(oL[i]));
    return db(mx) - db(0.25);
  }
  [100, 1000, 10000, 15000, 18000].forEach(function (f) {
    near(respAt(f), 0, 0.002, 'sealed response is flat at ' + f + ' Hz');
  });
  var r22 = respAt(22000);
  ok(r22 < -0.5 && r22 > -3, 'and rolls off above 21 kHz (' + r22.toFixed(2) + ' dB at 22 kHz)');
  note('flat to 18 kHz, −0.04 at 20 k, −1.06 at 22 k, −8.2 at 23 k — the whole ' +
       'price of sealing lives in the top 2 kHz');
})();

/* ============================================================
   5e. MID/SIDE (a pre-stage) and LOUDNESS RANGE
   ============================================================ */
/* ============================================================
   the arrangements are not the same limiter
   ------------------------------------------------------------
   WHAT THE FROZEN-RECIPE BUG HID, measured.

   On 2026-08-23 CASKET was played by a person for the first time, and the
   report was that the five arrangements all sounded the same. They did:
   the plugin's dropdown moved the style label and the two traits the
   engine derives from it, while the audible recipe — vigil, release, knee,
   lining, margin, program release, saturation and the seal — stayed
   wherever it was, which was Velvet's. The engine was never at fault; it
   faithfully rendered the state it was handed, and the state it was handed
   was Velvet wearing four other names.

   This estate records what its bugs COST, not merely that they died. So
   each arrangement is rendered twice on identical material — once with its
   own recipe, once with Velvet's under its own name — and the gap between
   them is the thing Ben could not hear.

   Two of these assertions are the interesting ones:

     · VELVET IS THE CONTROL. Velvet-frozen IS Velvet, so its gap must be
       EXACTLY zero. If it ever isn't, the comparison itself is broken and
       every other number in the table is worthless. A measurement with no
       control is an anecdote with decimals.

     · The arrangements must differ from EACH OTHER. That is the premise
       the word "arrangement" rests on, and until today nothing asserted
       it. Note this could not have caught the bug — it lived in the editor,
       and the core has always applied whatever recipe it was given — which
       is exactly why the editor gate in casket_plugin_test.js §5b exists
       beside it. One gate for the promise, one for the delivery.
   ============================================================ */
console.log('\n— the arrangements are not the same limiter —');
(function () {
  var n = 24000, i;
  /* material with real dynamics: noise under a slow swell, so the quiet
     stretches leave the limiter idle and the loud ones drive it hard —
     the same two-hump shape THE RANGE drew during the session. */
  var src = C.makeNoise(20260823, n), xL = new Float64Array(n), xR = new Float64Array(n);
  for (i = 0; i < n; i++) {
    var env = 0.18 + 0.82 * Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * i / n * 3), 2);
    xL[i] = src[i] * env;
    xR[i] = src[n - 1 - i] * env;
  }

  function recipeState(style, frozen) {
    var st = C.defaultState(), d = C.styleDefaults(frozen ? 'velvet' : style), k;
    for (k in d) if (Object.prototype.hasOwnProperty.call(d, k)) st[k] = d[k];
    st.style = style;               /* the label is always honest */
    st.drive = 12; st.lid = -1; st.dc = false; st.dust = 'off';
    return st;
  }
  function rmsDiffDb(a, b) {
    var s = 0, m = Math.min(a.length, b.length);
    for (var j = 0; j < m; j++) { var d = a[j] - b[j]; s += d * d; }
    return db(Math.sqrt(s / m));
  }

  var STYLES = ['pine', 'velvet', 'oak', 'iron', 'lead'];
  var trueR = {}, cost = {};
  STYLES.forEach(function (style) {
    var t = C.renderOffline(recipeState(style, false), xL, xR, FS);
    var f = C.renderOffline(recipeState(style, true), xL, xR, FS);
    trueR[style] = t;
    /* both renders report their own latency; compare the common tail so a
       latency difference is never mistaken for a timbral one */
    var lat = Math.max(t.latency, f.latency);
    cost[style] = {
      diff: rmsDiffDb(t.L.subarray(lat), f.L.subarray(lat)),
      dLufs: t.meters.integrated - f.meters.integrated,
      dGr: t.meters.gr - f.meters.gr,
      lat: t.latency - f.latency
    };
  });

  note('what the frozen recipe hid, per arrangement (12 dB drive, −1 dBTP lid):');
  note('  arrangement   Δrms dB    ΔLUFS    Δweight dB   Δlatency');
  STYLES.forEach(function (s) {
    var c = cost[s];
    note('  ' + s.padEnd(13) +
         (c.diff < -300 ? 'exact' : c.diff.toFixed(2)).padStart(7) +
         c.dLufs.toFixed(2).padStart(9) +
         c.dGr.toFixed(2).padStart(12) +
         (c.lat + ' smp').padStart(11));
  });

  ok(cost.velvet.diff < -300 && cost.velvet.lat === 0,
     'THE CONTROL: velvet-frozen is velvet — the gap is exactly nothing');
  var silent = STYLES.filter(function (s) {
    return s !== 'velvet' && !(cost[s].diff > -120);
  });
  ok(silent.length === 0,
     'every other arrangement was audibly changed by the bug' +
     (silent.length ? ' — INDISTINGUISHABLE: ' + silent.join(', ') : ''));
  /* PREDICTION CORRECTED IN PLACE, 2026-08-23: this first read "three of
     the five", which was a guess and was wrong. It is FOUR — every
     arrangement except the control, because every one of them names a
     vigil other than Velvet's 2 ms, and the vigil is what the reported
     latency is made of. Writing the wrong number first and letting the
     harness correct it is the cheap version of this mistake; the expensive
     version is a document that states it and is never run. */
  var moved = STYLES.filter(function (s) { return cost[s].lat !== 0; });
  ok(moved.length === 4 && moved.indexOf('velvet') < 0,
     'and every arrangement but the control had its reported latency frozen too (' +
     moved.join(', ') + ')');

  /* the premise: an arrangement is a different limiter, not a label */
  var same = [];
  for (i = 0; i < STYLES.length; i++) {
    for (var j = i + 1; j < STYLES.length; j++) {
      var d2 = rmsDiffDb(trueR[STYLES[i]].L, trueR[STYLES[j]].L);
      if (!(d2 > -120)) same.push(STYLES[i] + '≡' + STYLES[j]);
    }
  }
  ok(same.length === 0,
     'and all ten arrangement pairs render differently from one another' +
     (same.length ? ' — IDENTICAL: ' + same.join(', ') : ''));
})();

/* ============================================================
   THE WAKE — the loudness-matched A/B, as a measurement
   ------------------------------------------------------------
   A PROTOTYPE under test, not a shipped mode. Nothing in the render path
   calls it; these assertions are what would have to stay true if it ever
   became a monitoring feature, and one of them is the reason it must
   never become anything more than that.
   ============================================================ */
console.log('\n— the wake —');
(function () {
  /* TWO SECONDS, and the length is load-bearing. The first version of this
     section used 16,000 samples — a third of a second — and every reading
     came back −inf, because BS.1770 integrates over 400 ms blocks and a
     buffer that short contains no complete one to gate. That is the exact
     trap casket_mutate.js's own header records: this project once ran a
     gate that passed 22,848 checks VACUOUSLY for the same reason. It is
     written down, and it still caught the next person to write a
     loudness test. Two seconds is five whole blocks. */
  var n = FS * 2, src = C.makeNoise(8675309, n), i;
  var xL = new Float64Array(n), xR = new Float64Array(n);
  for (i = 0; i < n; i++) { xL[i] = src[i] * 0.5; xR[i] = src[n - 1 - i] * 0.5; }

  /* IDLE: the lid far above the signal, and the PREMISE ASSERTED rather
     than assumed. The first version of this case used the full-scale
     material with the lid at 0 and Velvet's 3 dB knee, which starts
     bending 1.5 dB below the lid — so the "idle" case was quietly doing
     0.07 dB of work and the gap was never going to be zero. Quiet
     material, no knee, and a check that the engine really did nothing. */
  var qL = new Float64Array(n), qR = new Float64Array(n);
  for (i = 0; i < n; i++) { qL[i] = xL[i] * 0.2; qR[i] = xR[i] * 0.2; }
  var idle = C.defaultState();
  idle.lid = 0; idle.margin = 0; idle.drive = 0; idle.knee = 0;
  idle.dc = false; idle.dust = 'off';
  ok(C.renderOffline(C.sanitizeState(idle), qL, qR, FS).meters.grPeak === 0,
     'the idle case really is idle — the engine reports no reduction at all');
  var w0 = C.wake(idle, qL, qR, FS);
  ok(Math.abs(w0.gapDb) < 0.01,
     'so nothing was taken, and there is nothing to match (' + w0.gapDb.toFixed(4) + ' dB)');

  /* WORKING HARD, with Unity already on — the exact case that misled a
     listener. Unity has given the drive back and the side is STILL
     quieter, because the limiter took something Unity cannot return. */
  var hard = C.defaultState();
  hard.lid = -1; hard.margin = 0; hard.drive = 14; hard.unity = true;
  hard.dc = false; hard.dust = 'off';
  var w1 = C.wake(hard, xL, xR, FS);
  ok(w1.unityWasOn, 'the hard case really does have Unity armed');
  ok(w1.gapDb > 0.5,
     'and the processed side is still quieter than bypass by ' + w1.gapDb.toFixed(2) +
     ' dB — which is what Unity cannot give back');
  note('THE WAKE at drive +14, Unity on: live ' + w1.liveLufs.toFixed(2) +
       ' LUFS vs bypass ' + w1.bypassLufs.toFixed(2) +
       ' LUFS — gap ' + w1.gapDb.toFixed(2) + ' dB');

  /* THE MEASUREMENT MUST BE TRUE, not merely plausible: apply the reported
     trim and the two must actually measure the same. A matching number
     nobody re-measures is a plausible number. */
  var lifted = new Float64Array(n), liftedR = new Float64Array(n);
  var live = C.renderOffline(C.sanitizeState(hard), xL, xR, FS);
  var g = C._nd.dbToLin(w1.gapDb);
  for (i = 0; i < n; i++) { lifted[i] = live.L[i] * g; liftedR[i] = live.R[i] * g; }
  var after = C.meterBuffer(lifted, liftedR, FS).integrated;
  ok(Math.abs(after - w1.bypassLufs) < 0.1,
     'applying the reported trim really does match the loudness (' +
     after.toFixed(2) + ' vs ' + w1.bypassLufs.toFixed(2) + ' LUFS)');

  /* THE TRUE-PEAK FIGURE MUST BE REAL, checked against an independent
     measurement of the same buffer rather than trusted. */
  var tpIndep = C._nd.linToDb(Math.max(C.truePeakOf(lifted), C.truePeakOf(liftedR)));
  ok(Math.abs(tpIndep - w1.truePeakIfLifted) < 1e-9,
     'the reported true peak of the lifted side is the one it actually has');

  /* A PREDICTION CORRECTED, and the correction is the useful part.
     This section first asserted that lifting the processed side would
     ALWAYS break the lid. It does not, and the measurement says why: with
     Unity armed the output has already been trimmed by the whole drive,
     so there is 13 dB of headroom under the lid and the lift lands at
     −1.48 dBTP, comfortably inside it. The danger is real but NARROWER
     than claimed — it needs a processed side that is both quieter than
     bypass AND already sitting on its ceiling, which is what heavy
     limiting without Unity looks like. Asserting the wide version would
     have been a gate that passed for the wrong reason on this material
     and failed on someone else's. */
  var squash = C.defaultState();
  squash.lid = -20; squash.margin = 0; squash.drive = 0; squash.unity = false;
  squash.dc = false; squash.dust = 'off';
  var w2 = C.wake(squash, xL, xR, FS);
  ok(w2.gapDb > 6,
     'squashed to a −20 lid: the processed side is ' + w2.gapDb.toFixed(2) + ' dB quieter');
  ok(!w2.liftClearsLid,
     'and lifting THAT to match would land at ' + w2.truePeakIfLifted.toFixed(2) +
     ' dBTP, straight through a lid of ' + w2.lidDb.toFixed(2));

  /* WHICH IS WHY THE TOOL OFFERS THE OTHER DIRECTION. Attenuating the
     BYPASSED side cannot break anything: it adds no gain after the
     limiter, so the lid stays a theorem rather than a hope. This is the
     only number a monitoring path should ever use. */
  ok(Math.abs(w1.matchOnBypass + w1.gapDb) < 1e-12 &&
     Math.abs(w2.matchOnBypass + w2.gapDb) < 1e-12,
     'so what it offers a monitoring path is the attenuation of the bypassed side');

  /* AN INDEPENDENT CONFIRMATION OF §6.3, arriving sideways. Measured at
     16× — a longer reconstruction than the engine's own 4× detector —
     full-band noise through the UNSEALED path lands above the lid by the
     documented residual, which is the whole reason the seal and the
     margin exist. Reported, not asserted to a tolerance: the exact figure
     is a property of this material. */
  var liveOff = C.renderOffline(C.sanitizeState((function () {
    var s = C.defaultState();
    s.lid = -1; s.margin = 0; s.drive = 14; s.unity = false; s.dc = false; s.dust = 'off';
    return s;
  })()), xL, xR, FS);
  var resid = C._nd.linToDb(Math.max(C.truePeakOf(liveOff.L), C.truePeakOf(liveOff.R))) - (-1);
  note('unsealed 4× residual on full-band noise, measured at 16×: +' +
       resid.toFixed(2) + ' dB over the lid (§6.3 documents up to +1.194)');
  ok(resid > 0 && resid < 1.3,
     'and it sits inside the range §6.3 measured for this path');
})();

console.log('\n— mid/side and loudness range —');
(function () {
  var n = 16384;
  var st = C.defaultState();
  st.ms = true; st.dc = false; st.lid = 0;
  var e = C.createEngine(FS); e.setState(st);
  var x = C.makeNoise(4242, n), y = C.makeNoise(9111, n);
  for (var i = 0; i < n; i++) { x[i] *= 0.1; y[i] *= 0.1; }
  var oL = new Float64Array(n), oR = new Float64Array(n);
  e.process(x, y, oL, oR);
  var lat = C.latencySamples(st, FS), bad = 0;
  for (i = lat; i < n; i++) { if (oL[i] !== x[i - lat]) bad++; if (oR[i] !== y[i - lat]) bad++; }
  ok(bad === 0, 'M/S armed but at unity costs not one bit (it short-circuits)');

  function sideDb(sideTrim) {
    var s = C.defaultState();
    s.ms = true; s.msSide = sideTrim; s.dc = false; s.lid = 0;
    var g = C.createEngine(FS); g.setState(s);
    var a = new Float64Array(n), b = new Float64Array(n);
    g.process(x, y, a, b);
    var l2 = C.latencySamples(s, FS), sd = 0;
    for (var j = l2; j < n; j++) { var v = (a[j] - b[j]) * 0.5; sd += v * v; }
    return db(Math.sqrt(sd / (n - l2)));
  }
  var base = sideDb(0);
  near(sideDb(6) - base, 6, 0.001, 'a +6 dB side trim widens by exactly 6 dB');
  near(sideDb(-6) - base, -6, 0.001, 'a -6 dB side trim narrows by exactly 6 dB');
  near(sideDb(-12) - base, -12, 0.001, 'and -12 collapses it by 12');

  /* THE POINT of making this a pre-stage: the ceiling proof is untouched */
  var lidTest = C.defaultState(), d2 = C.styleDefaults('lead');
  for (var k in d2) lidTest[k] = d2[k];
  lidTest.style = 'lead'; lidTest.ms = true; lidTest.msSide = 12; lidTest.msMid = 6;
  lidTest.lid = -1; lidTest.drive = 12;
  var e2 = C.createEngine(FS); e2.setState(lidTest);
  var big = C.makeNoise(555, n);
  for (i = 0; i < n; i++) { var v = big[i] * 6; big[i] = v > 1 ? 1 : (v < -1 ? -1 : v); }
  var a2 = new Float64Array(n), b2 = new Float64Array(n);
  e2.process(big, y, a2, b2);
  var lidLin = C._nd.dbToLin(lidTest.lid + lidTest.margin), over = 0;
  for (i = 0; i < n; i++) if (Math.abs(a2[i]) > lidLin || Math.abs(b2[i]) > lidLin) over++;
  ok(over === 0, 'the ceiling still holds with M/S pushed to +12 side / +6 mid');
  note('that is the whole reason M/S is a pre-stage: the limiter still runs last, ' +
       'so §5\'s proof carries over instead of needing to be re-derived');
})();

(function () {
  /* EBU Tech 3342: two levels a known distance apart give that distance */
  function lraOf(pairs) {
    var st = C.defaultState(); st.bypass = true;
    var e = C.createEngine(FS); e.setState(st);
    pairs.forEach(function (p) {
      var x = C.makeSine(1000, FS, Math.round(FS * p[1]), Math.pow(10, p[0] / 20));
      var o1 = new Float64Array(x.length), o2 = new Float64Array(x.length);
      e.process(x, x, o1, o2);
    });
    return e.meters().lra;
  }
  near(lraOf([[-20, 12], [-30, 12], [-20, 12], [-30, 12]]), 10, 0.15,
       'LRA of two levels 10 LU apart is 10 LU');
  near(lraOf([[-20, 12], [-26, 12], [-20, 12], [-26, 12]]), 6, 0.15,
       'LRA of two levels 6 LU apart is 6 LU');
  var steady = lraOf([[-23, 30]]);
  ok(steady < 0.5, 'a steady tone has essentially no loudness range (' + steady.toFixed(2) + ' LU)');
  /* the -20 LU relative gate must discard a quiet tail rather than count it */
  var gated = lraOf([[-20, 20], [-70, 20]]);
  ok(gated < 2, 'a passage 50 LU down is gated out of the range, not counted (' +
     gated.toFixed(2) + ' LU)');

  /* histogramS() — added 2026-08-18 alongside the browser's THE RANGE
     chart. lra() and histogramS() now share one shortTermStats() helper
     instead of each computing the gate independently, so the strongest
     test of that refactor is simply: do their two entry points still
     agree, on the exact material that already exercises the gate above? */
  (function () {
    var st = C.defaultState(); st.bypass = true;
    var e = C.createEngine(FS);
    e.setState(st);
    [[-20, 20], [-70, 20]].forEach(function (p) {
      var x = C.makeSine(1000, FS, Math.round(FS * p[1]), Math.pow(10, p[0] / 20));
      var o1 = new Float64Array(x.length), o2 = new Float64Array(x.length);
      e.process(x, x, o1, o2);
    });
    var m = e.meters(), h = e.histogramS();
    ok(h.lra === m.lra, 'histogramS().lra agrees EXACTLY with meters().lra — one gate, two callers');
    ok(h.bins.length > 0, 'histogramS() returns at least one populated bin');
    ok(h.bins.every(function (b) { return b.count > 0; }), 'every returned bin is genuinely populated (sparse, not padded with zeros)');
    ok(isFinite(h.gate), 'the relative gate is a real number once there is any content');
    ok(h.p10 !== null && h.p95 !== null && h.p95 >= h.p10, 'p95 is at or above p10, and neither is null once content survives the gate');
    /* the quiet 50-LU-down tail must be VISIBLE in the bins (a chart that
       hides gated-out material is a chart that hides the reason its own
       gate line is where it is) even though it does not affect lra */
    ok(h.bins.some(function (b) { return b.loudness < h.gate; }),
       'material gated out of the LRA figure still appears in the bins, below the gate line');
  })();
})();

/* ============================================================
   5f. OFFLINE TOOLS — auto-drive and the difference
   ============================================================ */
console.log('\n— the offline tools —');
(function () {
  var n = FS * 6, i;
  var src = new Float64Array(n);
  [55, 110, 220, 440, 880, 1760, 3520].forEach(function (f, k) {
    for (i = 0; i < n; i++) src[i] += Math.sin(2 * Math.PI * f * i / FS + k * 0.7) / 7;
  });
  var m = 0;
  for (i = 0; i < n; i++) m = Math.max(m, Math.abs(src[i]));
  for (i = 0; i < n; i++) src[i] /= m * 3;

  var st = C.defaultState();
  st.style = 'velvet'; st.lid = -1;
  [-16, -14, -9].forEach(function (t) {
    var r = C.autoDrive(st, src, src, FS, t);
    near(r.lufs, t, 0.15, 'auto-drive hits ' + t + ' LUFS (drive ' + r.drive.toFixed(2) + ' dB)');
  });
  /* monotone: a louder target must never ask for less drive */
  var a = C.autoDrive(st, src, src, FS, -18), b = C.autoDrive(st, src, src, FS, -10);
  ok(b.drive > a.drive, 'a louder target asks for more drive');
  /* deterministic — an offline tool that wanders is not a tool */
  var r1 = C.autoDrive(st, src, src, FS, -14), r2 = C.autoDrive(st, src, src, FS, -14);
  ok(r1.drive === r2.drive && r1.lufs === r2.lufs, 'auto-drive is deterministic');

  /* renderOffline is latency-compensated */
  var ro = C.renderOffline(st, src, src, FS);
  ok(ro.L.length === n, 'renderOffline returns a buffer the length of the source');
  ok(ro.latency === C.latencySamples(st, FS), 'and reports the latency it compensated');

  /* the difference */
  function styled2(name, patch) {
    var s = C.defaultState(), d = C.styleDefaults(name);
    for (var k in d) s[k] = d[k];
    s.style = name; s.lid = -1; s.drive = 10;
    if (patch) for (var k2 in patch) s[k2] = patch[k2];
    return s;
  }
  var same = C.difference(styled2('pine'), styled2('pine'), src, src, FS);
  ok(same.identical, 'an arrangement differenced against itself is BIT-IDENTICAL');
  var diff = C.difference(styled2('pine'), styled2('iron'), src, src, FS);
  ok(!diff.identical && diff.peakDb > -60, 'pine and iron genuinely differ (' +
     diff.peakDb.toFixed(1) + ' dB peak)');
  /* the two have DIFFERENT latencies; the subtraction must still be valid */
  var sealedDiff = C.difference(styled2('pine'), styled2('lead'), src, src, FS);
  ok(sealedDiff.latencyA !== sealedDiff.latencyB,
     'pine and lead have different latencies (' + sealedDiff.latencyA + ' vs ' +
     sealedDiff.latencyB + ')');
  ok(sealedDiff.peakDb < 0, 'and the difference is still bounded — both were compensated first');
})();

/* ============================================================
   5g. SAMPLE RATES, and a long soak
   ============================================================ */
console.log('\n— every rate, not just 48 k —');
(function () {
  var RATES = [44100, 48000, 88200, 96000, 192000];
  RATES.forEach(function (rate) {
    /* BS.1770 is defined for any rate; the K-weighting is derived from the
       analog prototype rather than the spec's 48 k table, so this is the
       assertion that the derivation is right rather than merely tuned. */
    var st = C.defaultState(); st.bypass = true;
    var e = C.createEngine(rate); e.setState(st);
    var n = Math.round(rate * 5);
    var x = C.makeSine(1000, rate, n, Math.pow(10, -23 / 20));
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(x, x, oL, oR);
    near(e.meters().integrated, -23.0, 0.06, rate + ' Hz: 1 kHz at −23 dBFS reads −23.0 LUFS');
  });

  RATES.forEach(function (rate) {
    /* the lid must hold at every rate, and the vigil is specified in
       MILLISECONDS, so its sample count changes underneath everything */
    var st = C.defaultState(), d = C.styleDefaults('velvet');
    for (var k in d) st[k] = d[k];
    st.style = 'velvet'; st.lid = -1; st.drive = 14; st.dc = false;
    var e = C.createEngine(rate); e.setState(st);
    var n = Math.round(rate * 0.5), i;
    var x = C.makeNoise(4242, n);
    for (i = 0; i < n; i++) { var v = x[i] * 6; x[i] = v > 1 ? 1 : (v < -1 ? -1 : v); }
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(x, x, oL, oR);
    var lidLin = C._nd.dbToLin(-1), over = 0;
    for (i = 0; i < n; i++) if (Math.abs(oL[i]) > lidLin) over++;
    ok(over === 0, rate + ' Hz: the lid still holds');
  });

  /* latency is specified in ms and reported in samples — it must track */
  var a = C.defaultState(); a.vigil = 2; a.lining = 4;
  var l48 = C.latencySamples(a, 48000), l96 = C.latencySamples(a, 96000);
  var vig48 = C.vigilSamples(a, 48000), vig96 = C.vigilSamples(a, 96000);
  ok(vig96 === vig48 * 2, 'the vigil doubles in samples when the rate doubles');
  ok(l96 - vig96 === l48 - vig48, 'and the fixed part of the latency does not move');
  ok(C.latencySamples(a, 44100) < C.latencySamples(a, 192000),
     'a higher rate means more samples of latency for the same milliseconds');
})();

(function () {
  /* A SHORT SOAK. The full one lives in tests/casket_soak.js — an hour of
     audio does not belong in a harness that has to stay fast enough to run
     on every edit. This is 60 s, enough to catch a running sum that is
     obviously wrong; the soak script is what catches the slow kind. */
  var rate = 48000, CH = rate * 10;
  var st = C.defaultState(), d = C.styleDefaults('lead');
  for (var k in d) st[k] = d[k];
  st.style = 'lead'; st.lid = -1; st.drive = 8;
  var e = C.createEngine(rate);
  e.setState(st);
  var oL = new Float64Array(CH), oR = new Float64Array(CH);
  var lidLin = C._nd.dbToLin(st.lid + st.margin);
  var over = 0, nonFinite = 0, i;
  for (var b = 0; b < 6; b++) {
    var x = C.makeNoise(7000 + b, CH);
    for (i = 0; i < CH; i++) { var v = x[i] * 5; x[i] = v > 1 ? 1 : (v < -1 ? -1 : v); }
    e.process(x, x, oL, oR);
    for (i = 0; i < CH; i++) {
      if (!isFinite(oL[i])) nonFinite++;
      if (Math.abs(oL[i]) > lidLin) over++;
    }
  }
  ok(nonFinite === 0, '60 s of continuous audio: nothing went non-finite');
  ok(over === 0, 'and not one sample drifted over the lid');
  var dbg = e._debug();
  /* RELATIVE, not absolute. The running sum's error is a random walk, so
     it scales with the magnitude of the sum rather than with the number of
     pushes — measured across 100 k to 6.4 M pushes it sits at 1e-14 to
     5e-14 relative and does NOT grow. An absolute threshold looked fine at
     one boxcar length and failed at another purely because the sum was
     bigger; that was my threshold being wrong, not the code.
     In gain terms: the sum is divided by the boxcar length, so 1e-13
     relative on a 193-tap window is ~1e-14 dB of gain error. */
  var relDrift = Math.abs(dbg.boxSums[0] - dbg.boxRecomputed[0]) /
                 (Math.abs(dbg.boxRecomputed[0]) + 1e-30);
  ok(relDrift < 1e-10, 'the boxcar running sum has not drifted (' +
     relDrift.toExponential(2) + ' relative)');
  var m = e.meters();
  ok(isFinite(m.integrated) && m.integrated < 0, 'the integrated meter is still sane (' +
     m.integrated.toFixed(2) + ' LUFS)');
})();

/* ============================================================
   5h. AUTOMATION — the path a real session takes
   ============================================================ */
console.log('\n— automation —');
(function () {
  /* The full stress lives in tests/casket_automation.js. This is the
     compact guard: the lid swept DOWNWARD every block, which is the case
     that found a real bug — a smoothed threshold lags a falling ceiling
     and lets the output sit above the lid just requested (+2.37 dB before
     the fix). The threshold now tightens instantly and loosens smoothly. */
  var BLOCK = 64, BLOCKS = 400, r = ND.lcg(31337);
  var st = C.defaultState();
  st.lid = -1; st.margin = 0; st.drive = 14; st.dc = false;
  var e = C.createEngine(FS);
  e.setState(st);
  var inL = new Float64Array(BLOCK), inR = new Float64Array(BLOCK);
  var oL = new Float64Array(BLOCK), oR = new Float64Array(BLOCK);
  var over = 0, worst = 0, nonFinite = 0, i;
  for (var b = 0; b < BLOCKS; b++) {
    /* a sawtooth ceiling: repeatedly slammed down, then released */
    st.lid = -1 - (b % 25) * 0.7;
    var s2 = C.sanitizeState(st);
    e.setState(s2);
    var lidLin = C._nd.dbToLin(s2.lid + s2.margin);
    for (i = 0; i < BLOCK; i++) {
      var v = (r() * 2 - 1) * 6;
      inL[i] = v > 1 ? 1 : (v < -1 ? -1 : v);
      v = (r() * 2 - 1) * 6;
      inR[i] = v > 1 ? 1 : (v < -1 ? -1 : v);
    }
    e.process(inL, inR, oL, oR);
    for (i = 0; i < BLOCK; i++) {
      if (!isFinite(oL[i])) nonFinite++;
      var a = Math.abs(oL[i]);
      if (a > lidLin) { over++; if (a / lidLin - 1 > worst) worst = a / lidLin - 1; }
    }
  }
  ok(nonFinite === 0, 'a ceiling swept every block stays finite');
  ok(over === 0, 'and the lid holds on the way DOWN' +
     (over ? ' (worst +' + (20 * Math.log10(1 + worst)).toFixed(4) + ' dB)' : ''));
  note('the threshold tightens instantly and loosens smoothly — the same ' +
       'asymmetry the release envelope uses, and for the same reason');
})();

(function () {
  /* reference matching */
  var n = FS * 6, i;
  function tone(amp) {
    var b = new Float64Array(n);
    [55, 110, 220, 440, 880, 1760].forEach(function (f, k) {
      for (i = 0; i < n; i++) b[i] += Math.sin(2 * Math.PI * f * i / FS + k * 0.7) / 6;
    });
    var m = 0;
    for (i = 0; i < n; i++) m = Math.max(m, Math.abs(b[i]));
    for (i = 0; i < n; i++) b[i] *= amp / m;
    return b;
  }
  var mine = tone(0.10), ref = tone(0.40);      // reference ~12 dB louder
  var st = C.defaultState(); st.style = 'velvet'; st.lid = -1;
  var m = C.matchReference(st, mine, mine, ref, ref, FS);
  ok(m.gap.lufs < -6, 'reference matching sees my mix is quieter (' +
     m.gap.lufs.toFixed(1) + ' LU)');
  ok(m.suggest && m.suggest.drive > 6,
     'and suggests real drive to close it (' + m.suggest.drive.toFixed(1) + ' dB)');
  near(m.suggest.lufs, m.reference.lufs, 0.2,
       'the suggestion actually lands on the reference loudness');
  ok(isFinite(m.reference.truePeak) && isFinite(m.mine.truePeak),
     'and both true peaks are reported');
})();

/* ============================================================
   5i. BLOCK-SIZE INDEPENDENCE
   ============================================================ */
console.log('\n— block-size independence —');
(function () {
  /* A host picks its own buffer size and may change it mid-session. The
     output must not care. This nearly wasn't true: control() used to fire
     every CTRL samples of CALL time rather than STREAM time, so any buffer
     size that is not a multiple of 32 landed its control blocks somewhere
     else — 240- and 1200-sample buffers diverged from 4800-sample ones by
     -37 dB during a drive glide. The phase is now carried across calls. */
  var SW = 4800, n = 24000, i;
  var x = C.makeNoise(4242, n), y = C.makeNoise(9111, n);
  for (i = 0; i < n; i++) {
    var v = x[i] * 3; x[i] = v > 1 ? 1 : (v < -1 ? -1 : v);
    v = y[i] * 3; y[i] = v > 1 ? 1 : (v < -1 ? -1 : v);
  }
  function render(blk) {
    var oL = new Float64Array(n), oR = new Float64Array(n);
    var a = C.defaultState(); a.style = 'velvet'; a.lid = -1; a.drive = 0; a.dc = false;
    var b = C.defaultState(); b.style = 'velvet'; b.lid = -1; b.drive = 18; b.dc = false;
    var e = C.createEngine(FS); e.setState(a);
    var p = 0;
    while (p < n) {
      /* never straddle the switch point, or the test measures itself
         rather than the engine */
      var m = Math.min(blk, n - p);
      if (p < SW && p + m > SW) m = SW - p;
      if (p === SW) e.setState(b);
      e.process(x.subarray(p, p + m), y.subarray(p, p + m),
                oL.subarray(p, p + m), oR.subarray(p, p + m));
      p += m;
    }
    return oL;
  }
  var ref = render(4800), bad = 0, worst = 0;
  [1, 3, 7, 32, 64, 96, 111, 160, 240, 333, 480, 512, 800, 1024, 1200, 2400, 3000].forEach(function (b) {
    var o = render(b), mx = 0;
    for (var j = 0; j < n; j++) mx = Math.max(mx, Math.abs(o[j] - ref[j]));
    if (mx !== 0) { bad++; if (mx > worst) worst = mx; }
  });
  ok(bad === 0, 'seventeen buffer sizes, including primes, render BIT-IDENTICALLY' +
     (bad ? ' (' + bad + ' differ, worst ' + worst.toExponential(2) + ')' : ''));
  note('control() fires every CTRL samples of STREAM time, not of call time — ' +
       'a plugin whose audio changes with the host buffer size cannot be A/B\'d');
})();

/* ============================================================
   5j. AUTO-MARGIN
   ============================================================ */
console.log('\n— auto-margin —');
(function () {
  var n = FS * 3, i;
  function clipped(sc) {
    var a = C.makeNoise(2718, n);
    for (i = 0; i < n; i++) { var v = a[i] * sc; a[i] = v > 1 ? 1 : (v < -1 ? -1 : v); }
    return a;
  }
  var musical = (function () {
    var b = new Float64Array(n);
    [55, 110, 220, 440, 880, 1760, 3520].forEach(function (f, k) {
      for (i = 0; i < n; i++) b[i] += Math.sin(2 * Math.PI * f * i / FS + k * 0.7) / 7;
    });
    var m = 0;
    for (i = 0; i < n; i++) m = Math.max(m, Math.abs(b[i]));
    for (i = 0; i < n; i++) b[i] /= m;
    return b;
  })();
  var st = C.defaultState(), d = C.styleDefaults('velvet');
  for (var k in d) st[k] = d[k];
  st.style = 'velvet'; st.lid = -1; st.drive = 12;

  var mus = C.autoMargin(st, musical, musical, FS);
  ok(mus.residual < 0.02, 'harmonic material needs essentially no margin (' +
     mus.residual.toFixed(3) + ' dB)');
  ok(mus.covered, 'and the suggestion covers it');

  var full = clipped(8);
  var bad = C.autoMargin(st, full, full, FS);
  ok(bad.residual > 1, 'full-band clipped noise needs more than a dB (' +
     bad.residual.toFixed(3) + ')');
  ok(!bad.covered, 'and auto-margin says so rather than pretending — covered = false');
  note('a margin control that only goes to -1 dB cannot cover a +1.21 dB residual; ' +
       'reporting that honestly is the useful behaviour, not clamping quietly');

  /* COVERED MEANS VERIFIED. The first version estimated the margin from a
     single render at margin 0 and claimed success — the offline-tools
     fuzzer caught it saying "covered" on a render still 0.554 dB over,
     because lowering the threshold moves WHERE the limiter engages and the
     true peak does not shrink one-for-one. It now iterates and re-renders,
     and `covered` is a statement about a measurement rather than a guess. */
  ok(bad.margin <= -Math.min(1, bad.residual) + 1e-9,
     'the suggested margin never rounds toward the unsafe side');
  ok(mus.margin <= 0 && mus.margin >= -1, 'and stays inside the legal range');

  [['harmonic', musical], ['band-limited', clipped(3)]].forEach(function (p) {
    var s2 = C.defaultState();
    for (k in d) s2[k] = d[k];
    s2.style = 'velvet'; s2.lid = -1; s2.drive = 6;
    var sug = C.autoMargin(s2, p[1], p[1], FS);
    if (!sug.covered) { ok(true, p[0] + ': not coverable, and said so'); return; }
    var applied = C.sanitizeState(s2);
    applied.margin = sug.margin;
    var out = C.renderOffline(applied, p[1], p[1], FS);
    var tp = db(Math.max(C.truePeakOf(out.L, 16, 64), C.truePeakOf(out.R, 16, 64)));
    ok(tp <= s2.lid + 1e-3, p[0] + ': a covered suggestion VERIFIABLY lands under the lid (' +
       tp.toFixed(4) + ' dBTP)');
    near(tp, sug.verifiedPeak, 1e-9, '  and verifiedPeak is what re-rendering actually gives');
  });
})();

/* ============================================================
   6. behaviour
   ============================================================ */
console.log('\n— behaviour —');
(function () {
  /* steady-state transfer: a sine well over the lid should land ON the lid */
  var st = C.defaultState();
  st.style = 'pine'; st.lid = -3; st.knee = 0; st.dc = false; st.drive = 0; st.release = 100;
  var e = C.createEngine(FS); e.setState(st);
  var n = 24000, x = C.makeSine(500, FS, n, 0.5);   // −6 dBFS, 3 dB over a −3 lid... no, under
  var oL = new Float64Array(n), oR = new Float64Array(n);
  e.process(x, x, oL, oR);
  var mx = 0;
  for (var i = 12000; i < n; i++) mx = Math.max(mx, Math.abs(oL[i]));
  near(db(mx), db(0.5), 0.001, 'a signal under the lid is passed at its own level');

  st.lid = -6;
  e = C.createEngine(FS); e.setState(st);
  x = C.makeSine(500, FS, n, 1.0);
  e.process(x, x, oL, oR);
  mx = 0;
  for (i = 12000; i < n; i++) mx = Math.max(mx, Math.abs(oL[i]));
  near(db(mx), -6, 0.02, 'a sine 6 dB over the lid settles exactly ON the lid');

  /* transferAt is the same math the UI draws */
  near(C.transferAt(st, 0), -6, 1e-9, 'transferAt agrees: 0 dBFS in → lid out');
  near(C.transferAt(st, -20), -20, 1e-9, 'transferAt agrees: under the lid is unity');
})();

(function () {
  /* linear release recovers 20 dB per release time, by definition */
  var st = C.defaultState();
  st.style = 'pine'; st.autoRel = false; st.release = 100; st.lid = -1;
  st.dc = false; st.vigil = 1; st.knee = 0;
  var e = C.createEngine(FS); e.setState(st);
  var n = 24000, x = new Float64Array(n);
  for (var i = 0; i < 240; i++) x[i] = 1.0;            // 5 ms of full scale, then silence
  var oL = new Float64Array(n), oR = new Float64Array(n);
  e.process(x, x, oL, oR);
  var m = e.meters();
  ok(m.grPeak < -0.9, 'a full-scale burst against a −1 dB lid produced gain reduction');
  note('peak gain reduction ' + m.grPeak.toFixed(3) + ' dB');
})();

(function () {
  /* channel link: an event in one channel only */
  var n = 16000;
  var a = C.makeSine(300, FS, n, 1.0), b = C.makeSine(300, FS, n, 0.02);
  function ratio(link) {
    var st = C.defaultState();
    st.link = link; st.lid = -6; st.dc = false; st.style = 'pine'; st.knee = 0;
    var e = C.createEngine(FS); e.setState(st);
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(a, b, oL, oR);
    var mr = 0;
    for (var i = 8000; i < n; i++) mr = Math.max(mr, Math.abs(oR[i]));
    return mr;
  }
  var linked = ratio(100), free = ratio(0);
  ok(linked < free * 0.9, 'linked at 100 % the quiet channel is pulled down with the loud one');
  near(db(free) - db(0.02), 0, 0.01, 'unlinked, the quiet channel is left alone');
})();

(function () {
  /* unity: honest A/B */
  var st = C.defaultState();
  st.drive = 10; st.unity = true; st.lid = 0; st.dc = false; st.lining = 1;
  var e = C.createEngine(FS); e.setState(st);
  var n = 8192, x = C.makeNoise(606, n);
  for (var i = 0; i < n; i++) x[i] *= 0.02;   // stays under the lid even with +10 drive
  var oL = new Float64Array(n), oR = new Float64Array(n);
  e.process(x, x, oL, oR);
  var lat = C.latencySamples(st, FS), worst = 0;
  for (i = lat; i < n; i++) {
    var d = Math.abs(oL[i] - x[i - lat]) / (Math.abs(x[i - lat]) + 1e-30);
    if (d > worst) worst = d;
  }
  /* 10^(g/20) · 10^(−g/20) is 1 to within an ulp, not exactly 1 — so this
     is a relative assertion, deliberately. */
  ok(worst < 1e-14, 'unity + drive with no limiting is a wash — output level unchanged');
})();

/* ============================================================
   7. the dust
   ============================================================ */
console.log('\n— the dust —');
(function () {
  function render(dust, bits, seed) {
    var st = C.defaultState();
    st.dust = dust; st.dustBits = bits; st.dustSeed = seed; st.lid = -1; st.dc = false;
    var e = C.createEngine(FS); e.setState(st);
    var n = 8192, x = C.makeSine(997, FS, n, 0.3);
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(x, x, oL, oR);
    return oL;
  }
  var a = render('flat', 16, 1848), b = render('flat', 16, 1848), c = render('flat', 16, 99);
  var same = true, diff = false;
  for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) same = false; if (a[i] !== c[i]) diff = true; }
  ok(same, 'the dust is deterministic — same seed, identical bits');
  ok(diff, 'a different seed gives different dust');

  /* quantised to the grid */
  var lsb = Math.pow(2, 1 - 16), offGrid = 0;
  for (i = 200; i < a.length; i++) {
    var q = a[i] / lsb;
    if (Math.abs(q - Math.round(q)) > 1e-9) offGrid++;
  }
  ok(offGrid === 0, 'dithered output sits exactly on the 16-bit grid');

  /* and the lid still holds, quantisation included */
  var st = C.defaultState();
  st.dust = 'shaped'; st.dustBits = 16; st.lid = -0.1; st.drive = 18; st.dc = false;
  var e = C.createEngine(FS); e.setState(st);
  var n = 24000, x = C.makeNoise(1234, n);
  var oL = new Float64Array(n), oR = new Float64Array(n);
  e.process(x, x, oL, oR);
  var lidLin = C._nd.dbToLin(-0.1), over = 0, mx = 0;
  for (i = 0; i < n; i++) { mx = Math.max(mx, Math.abs(oL[i])); if (Math.abs(oL[i]) > lidLin) over++; }
  ok(over === 0, 'shaped dust at 16 bits still cannot push a sample over the lid');
  note('dithered peak ' + db(mx).toFixed(4) + ' dB vs lid −0.1000 dB');
})();

/* ============================================================
   8. the plot — ITU-R BS.1770-4
   ============================================================ */
console.log('\n— the plot —');
(function () {
  var k = C.kWeight(48000);
  /* the coefficients published in BS.1770-4 Tables 1 and 2 */
  near(k.shelf.b0, 1.53512485958697, 1e-12, 'K-weight shelf b0 matches the spec');
  near(k.shelf.b1, -2.69169618940638, 1e-12, 'K-weight shelf b1 matches the spec');
  near(k.shelf.b2, 1.19839281085285, 1e-12, 'K-weight shelf b2 matches the spec');
  near(k.shelf.a1, -1.69065929318241, 1e-12, 'K-weight shelf a1 matches the spec');
  near(k.shelf.a2, 0.73248077421585, 1e-12, 'K-weight shelf a2 matches the spec');
  near(k.hp.a1, -1.99004745483398, 1e-10, 'K-weight RLB a1 matches the spec');
  near(k.hp.a2, 0.99007225036621, 1e-10, 'K-weight RLB a2 matches the spec');
})();

(function () {
  function measure(amp, secs, freq) {
    var st = C.defaultState();
    st.bypass = true;   // metering only — do not let the limiter colour the number
    var e = C.createEngine(FS); e.setState(st);
    var n = Math.round(FS * secs);
    var x = C.makeSine(freq || 1000, FS, n, amp);
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(x, x, oL, oR);
    return e.meters();
  }
  var m = measure(Math.pow(10, -23 / 20), 5);
  near(m.integrated, -23.0, 0.05, 'BS.1770 calibration: 1 kHz at −23 dBFS reads −23.0 LUFS');
  near(m.momentary, -23.0, 0.05, 'momentary agrees at −23.0 LUFS');
  near(m.shortTerm, -23.0, 0.05, 'short-term agrees at −23.0 LUFS');
  var m2 = measure(Math.pow(10, -33 / 20), 5);
  near(m2.integrated, -33.0, 0.05, '10 dB quieter reads exactly 10 LU quieter');
  near(m2.truePeakDb, -33.0, 0.05, 'true peak of a 1 kHz sine equals its amplitude');
})();

(function () {
  /* gating: a long quiet tail must not drag the integrated number down.
     Four blocks straddle the transition and are legitimately counted, so
     the tolerance is 0.05 LU rather than 0 — that is the spec working,
     not slop. */
  var st = C.defaultState(); st.bypass = true;
  var e = C.createEngine(FS); e.setState(st);
  var loud = C.makeSine(1000, FS, FS * 20, Math.pow(10, -20 / 20));
  var quiet = new Float64Array(FS * 20);     // digital silence, under the absolute gate
  var o1 = new Float64Array(loud.length), o2 = new Float64Array(loud.length);
  e.process(loud, loud, o1, o2);
  var ungated = e.meters().integrated;
  var q1 = new Float64Array(quiet.length), q2 = new Float64Array(quiet.length);
  e.process(quiet, quiet, q1, q2);
  var m = e.meters();
  near(ungated, -20.0, 0.02, 'integrated reads −20.0 LUFS on 20 s of −20 dBFS tone');
  near(m.integrated, -20.0, 0.05, 'gating: 20 s of silence does not move the integrated number');
  ok(m.shortTerm < -60, 'short-term does follow the silence down (it is ungated)');
})();

/* ============================================================
   9. state hygiene
   ============================================================ */
console.log('\n— state hygiene —');
(function () {
  var s = C.sanitizeState(null);
  ok(s.style === 'velvet' && s.lid === -1, 'null → default arrangement');
  ok(C.sanitizeState({ lid: 0 }).lid === 0, 'a lid of exactly 0 dB survives (isFinite, not ||)');
  ok(C.sanitizeState({ margin: 0 }).margin === 0, 'a margin of exactly 0 survives');
  ok(C.sanitizeState({ link: 0 }).link === 0, 'a link of exactly 0 % survives');
  ok(C.sanitizeState({ drive: 0 }).drive === 0, 'a drive of exactly 0 dB survives');
  ok(C.sanitizeState({ lid: 99 }).lid === 0, 'an out-of-range lid is clamped, not rejected');
  ok(C.sanitizeState({ lining: 7 }).lining === 4, 'an illegal lining falls back to 4×');
  ok(C.sanitizeState({ style: 'oak' }).style === 'oak', 'a legal arrangement is kept');
  ok(C.sanitizeState({ style: 'mahogany' }).style === 'velvet', 'an unknown arrangement falls back');
  var d = C.styleDefaults('lead');
  ok(d.seal === true && d.lining === 4 && d.margin === -0.3,
     'lead defaults to sealed, 4× and a −0.3 dB margin');
  d.lining = 1;
  ok(C.styleDefaults('lead').lining === 4, 'styleDefaults hands out copies, not the original');
})();

(function () {
  /* reset really resets */
  var st = C.defaultState(); st.lid = -1; st.drive = 12; st.dc = false;
  var e = C.createEngine(FS); e.setState(st);
  var n = 4096, x = C.makeNoise(11, n);
  var a = new Float64Array(n), b = new Float64Array(n);
  e.process(x, x, a, b);
  e.reset();
  var c = new Float64Array(n), d2 = new Float64Array(n);
  e.process(x, x, c, d2);
  var same = true;
  for (var i = 0; i < n; i++) if (a[i] !== c[i]) same = false;
  ok(same, 'reset() returns the engine to a byte-identical starting state');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
