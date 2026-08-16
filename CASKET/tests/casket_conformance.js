/* CASKET conformance — node tests/casket_conformance.js
   Every true-peak and loudness number in the suite so far has been checked
   against OUR OWN reconstruction or our own meter. That proves internal
   consistency and nothing else: if the reconstruction were wrong, every
   test would agree with it, wrongly.

   This harness checks against answers that come from OUTSIDE the code —
   values known analytically, or published in ITU-R BS.1770-4 and EBU Tech
   3341. Where a case is my own construction rather than a published
   vector, it says so, because "conformance" is a strong word. */
'use strict';
var C = require('../casket_core.js');
var FS = 48000;
var pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } }
function near(a, b, eps, n) { ok(Math.abs(a - b) <= eps, n + ' (' + a.toFixed(4) + ' vs ' + b + ')'); }
function note(s) { console.log('    · ' + s); }
function db(x) { return 20 * Math.log10(Math.abs(x) + 1e-300); }

console.log('CASKET conformance — answers from outside the code\n');

/* ============================================================
   TRUE PEAK — analytic cases where the right answer is arithmetic
   ============================================================ */
console.log('— true peak, against analytic truth —');
(function () {
  /* A sine of amplitude A has a true peak of exactly A regardless of where
     the samples land. Sample it so the samples MISS the crest and the
     measured sample peak is wrong by a known amount; the true peak must
     still come back to A. This is the whole job of the reconstructor and
     the answer owes nothing to our code. */
  var n = 20000;
  [[12000, Math.PI / 4, -3.0103], [16000, 0.9, null], [8000, 1.3, null],
   [19000, 0.4, null], [23000, 0.2, null]].forEach(function (t) {
    var f = t[0], ph = t[1], expectedSampleDb = t[2];
    var x = new Float64Array(n), i;
    for (i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * f * i / FS + ph);
    var sp = 0;
    for (i = 2000; i < n - 2000; i++) sp = Math.max(sp, Math.abs(x[i]));
    var tp = db(C.truePeakOf(x, 16, 2000));
    near(tp, 0, 0.02, f + ' Hz sine reconstructs to its true 0 dBFS peak');
    if (expectedSampleDb !== null) {
      near(db(sp), expectedSampleDb, 0.001,
           '  and its SAMPLE peak really is ' + expectedSampleDb + ' dB — the crest is missed');
    }
  });
  note('if the reconstructor were wrong these would all be wrong together, ' +
       'and every other true-peak test in the suite would still have agreed with it');
})();

(function () {
  /* The canonical inter-sample case: +1,+1,-1,-1 at quarter-Nyquist is a
     45-degree-sampled sine whose samples sit at ±1/sqrt(2) when scaled to
     unity crest. Scaled to full-scale SAMPLES it overshoots by exactly
     3.0103 dB — the number every true-peak discussion quotes. */
  var n = 20000, x = new Float64Array(n), i;
  for (i = 0; i < n; i++) x[i] = [1, 1, -1, -1][i % 4];
  var tp = db(C.truePeakOf(x, 16, 2000));
  near(tp, 3.0103, 0.05, 'full-scale ±1,±1 at fs/4 overshoots by the canonical 3.01 dB');
  note('this is the figure that makes true-peak limiting necessary at all');
})();

(function () {
  /* DC and a single sample are degenerate: the true peak must equal the
     sample peak exactly, because there is nothing between the samples. */
  var n = 8000, dc = new Float64Array(n), i;
  for (i = 0; i < n; i++) dc[i] = 0.5;
  near(db(C.truePeakOf(dc, 16, 1000)), db(0.5), 0.001,
       'DC has no inter-sample content — true peak equals sample peak');
})();

/* ============================================================
   LOUDNESS — EBU Tech 3341 compliance cases
   ============================================================ */
/* ---------- THE RECONSTRUCTION LADDER ----------
   Every true-peak figure in this suite comes from truePeakOf, and until
   now every one of them was checked against truePeakOf. If the polyphase
   reconstructor had a SYSTEMATIC error — a tap normalisation that was
   slightly off, a phase that summed to the wrong gain — every test would
   have agreed with it, in unison, and been wrong together.

   A single oversampling factor can never expose that. A ladder can:
   reconstruct the same buffer at 4x, 8x and 16x and require the answers
   to CONVERGE upward. Each factor is a different filter with a different
   tap count and different phases; a systematic error would have to be
   the same in all three to hide, which a normalisation slip is not.

   The inequality direction matters and is not arbitrary. Denser
   reconstruction can only FIND peaks, never lose them, so the sequence
   must be non-decreasing to within the interpolation error. A ladder
   that went DOWN would mean the coarse filter was inventing energy. */
console.log('\n— the reconstruction ladder: 4x vs 8x vs 16x —');
(function () {
  var CASES = [
    ['a sine at fs/4, the worst case for sample peak', C.makeSine(12000, 48000, 4096, 1)],
    ['band-limited noise', C.makeNoise(11, 4096)],
    ['a lone impulse', (function () { var a = new Float64Array(2048); a[900] = 0.9; return a; })()],
    ['a hard-clipped square, dense in harmonics', C.makeSquare(997, 48000, 4096, 0.98)]
  ];
  CASES.forEach(function (c) {
    var p4 = C.truePeakOf(c[1], 4, 64);
    var p8 = C.truePeakOf(c[1], 8, 64);
    var p16 = C.truePeakOf(c[1], 16, 64);
    var d4 = C._nd.linToDb(p4), d8 = C._nd.linToDb(p8), d16 = C._nd.linToDb(p16);
    /* non-decreasing, allowing a hair for the fact that different filters
       have different passband ripple */
    ok(p8 >= p4 - 1e-9 && p16 >= p8 - 1e-9,
       c[0] + ': the ladder does not go down (' +
       d4.toFixed(4) + ' -> ' + d8.toFixed(4) + ' -> ' + d16.toFixed(4) + ' dB)');
    /* and it must CONVERGE: the 8->16 step must be smaller than the 4->8
       step, or the sequence is not settling on an answer at all */
    var step1 = d8 - d4, step2 = d16 - d8;
    ok(Math.abs(step2) <= Math.abs(step1) + 0.02,
       '  and it converges rather than wandering (steps ' +
       step1.toFixed(4) + ' then ' + step2.toFixed(4) + ' dB)');
  });
  /* the anchor: a sine's true peak is its amplitude, at EVERY factor.
     If a normalisation were wrong this is where it shows, because the
     answer is known exactly and independently of the filter. */
  var sine = C.makeSine(12000, 48000, 8192, 1);
  [4, 8, 16].forEach(function (m) {
    var d = C._nd.linToDb(C.truePeakOf(sine, m, 64));
    ok(Math.abs(d) < 0.05,
       m + 'x reconstruction of a full-scale sine lands on 0 dBFS (' + d.toFixed(4) + ')');
  });
})();

console.log('\n— loudness, against EBU Tech 3341 —');
function meterOf(segments) {
  var st = C.defaultState();
  st.bypass = true;                 // metering only
  var e = C.createEngine(FS);
  e.setState(st);
  segments.forEach(function (seg) {
    var lvl = seg[0], secs = seg[1];
    var len = Math.round(FS * secs);
    var x = lvl === null ? new Float64Array(len)
                         : C.makeSine(1000, FS, len, Math.pow(10, lvl / 20));
    var a = new Float64Array(len), b = new Float64Array(len);
    e.process(x, x, a, b);
  });
  return e.meters();
}

/* Tech 3341 case 1: stereo 1 kHz at -23 dBFS -> -23.0 LUFS */
near(meterOf([[-23, 20]]).integrated, -23.0, 0.1, 'case 1: −23 dBFS tone reads −23.0 LUFS');
/* case 2: -33 dBFS -> -33.0 */
near(meterOf([[-33, 20]]).integrated, -33.0, 0.1, 'case 2: −33 dBFS tone reads −33.0 LUFS');
/* THE RELATIVE GATE, checked at its boundary rather than at one point.
   My first attempt asserted "−36/−23/−36 gives −23.0" from memory. It does
   not, and the code was right: with 2/3 of blocks at −36 the ungated mean
   sits at −27.36, the relative gate is 10 LU below that at −37.36, and
   −36 is ABOVE it — so the flanks are kept and −27.36 is the correct
   answer. Working the algorithm by hand rather than trusting the memory
   is what found that.
   So instead of one remembered number, assert the whole boundary: below
   about −38 the flanks drop out and the answer snaps to −23; above it they
   are kept and the answer is the power mean. A gate is a threshold, and a
   threshold is best tested by crossing it. */
(function () {
  function predict(quiet, loud, fracQuiet) {
    var zq = Math.pow(10, quiet / 10), zl = Math.pow(10, loud / 10);
    var mean = fracQuiet * zq + (1 - fracQuiet) * zl;
    var gate = 10 * Math.log10(mean) - 10;
    var kq = quiet > gate, kl = loud > gate;
    var num = (kq ? fracQuiet * zq : 0) + (kl ? (1 - fracQuiet) * zl : 0);
    var den = (kq ? fracQuiet : 0) + (kl ? (1 - fracQuiet) : 0);
    return 10 * Math.log10(num / den);
  }
  [-26, -30, -36, -40, -50, -60].forEach(function (q) {
    var got = meterOf([[q, 20], [-23, 20], [q, 20]]).integrated;
    var want = predict(q, -23, 2 / 3);
    near(got, want, 0.2, 'flanks at ' + q + ' dB: integrated matches the algorithm (' +
         (q > -38 ? 'kept' : 'gated out') + ')');
  });
  var kept = meterOf([[-36, 20], [-23, 20], [-36, 20]]).integrated;
  var gated = meterOf([[-45, 20], [-23, 20], [-45, 20]]).integrated;
  ok(Math.abs(gated - (-23)) < 0.2, 'below the gate the answer snaps to the loud part alone');
  ok(kept < gated - 3, 'and above it the flanks genuinely drag the number down (' +
     kept.toFixed(2) + ' vs ' + gated.toFixed(2) + ')');
  note('the gate crossing is between −36 and −40 for this material, exactly where ' +
       'the relative-gate arithmetic puts it');
})();

/* momentary and short-term on a steady tone must agree with integrated */
(function () {
  var m = meterOf([[-23, 20]]);
  near(m.momentary, -23.0, 0.1, 'momentary agrees on a steady tone');
  near(m.shortTerm, -23.0, 0.1, 'short-term agrees on a steady tone');
})();

/* ============================================================
   LOUDNESS RANGE — EBU Tech 3342
   ============================================================ */
console.log('\n— loudness range, against EBU Tech 3342 —');
/* 3342 case 1: two levels 10 LU apart -> LRA 10 LU */
near(meterOf([[-20, 20], [-30, 20], [-20, 20], [-30, 20]]).lra, 10.0, 1.0,
     'case 1: two levels 10 LU apart give LRA 10 LU');
/* 3342 case 2: 5 LU apart -> 5 */
near(meterOf([[-20, 20], [-25, 20], [-20, 20], [-25, 20]]).lra, 5.0, 1.0,
     'case 2: two levels 5 LU apart give LRA 5 LU');
/* a steady tone has no range at all */
ok(meterOf([[-23, 30]]).lra < 1.0, 'a steady tone has essentially no loudness range');

/* ============================================================
   THE OFFSET — why -0.691 exists at all
   ============================================================ */
console.log('\n— the K-weighting offset —');
(function () {
  /* BS.1770's -0.691 dB offset exists precisely so that a 1 kHz tone reads
     back its own dBFS value: K-weighting has about +0.691 dB of gain at
     1 kHz and the offset cancels it. Verify the cancellation directly by
     checking several levels all read back exactly. */
  var worst = 0;
  [-6, -12, -18, -23, -30, -40].forEach(function (lvl) {
    var got = meterOf([[lvl, 12]]).integrated;
    worst = Math.max(worst, Math.abs(got - lvl));
  });
  ok(worst < 0.1, 'a 1 kHz tone reads back its own dBFS at every level (worst ' +
     worst.toFixed(3) + ' LU)');
  note('the −0.691 offset and the K-weighting gain at 1 kHz cancel exactly — ' +
       'that cancellation is what makes the number checkable at all');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
