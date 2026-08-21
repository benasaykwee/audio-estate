/* CASKET — THE SEAL EXPERIMENT
   node tests/seal_experiment.js

   This is not a pass/fail harness. It is the evidence behind §6.3 of the
   architecture doc, kept runnable so the conclusion can be re-checked
   instead of taken on trust — and so that if the decision is ever
   revisited, the rig already exists.

   THE QUESTION
   CASKET applies its gain at base rate. That is what preserves the
   bit-exact null test, and it is also the source of the true-peak
   residual (§6.2): a fast-moving gain times a signal has energy above
   Nyquist, and sampling folds it back. Can we do better?

   THE TWO CANDIDATES, both applying the gain in the oversampled domain:

     RESIDUAL   y[p] = x[p−D] + decimate( (g4 − 1)·x4 )
                Attractive because when g4 ≡ 1 the correction is exactly
                zero and the null test survives untouched.

     FULL       y[p] = decimate( g4·x4 )
                The textbook oversampled chain. Correct, but the output
                when idle is decimate(upsample(x)), which is NOT x — so
                the bit-exact null test is gone for good.

   WHAT THE NUMBERS SAY
   The residual form is ill-conditioned in exactly the regime it was meant
   to fix. Under heavy limiting the gain is small, so the correction is
   most of the signal (at 13 dB of reduction, (g−1) ≈ −0.78), and the
   output is a difference of two large, nearly-cancelling terms. Every bit
   of decimation-filter error inside that correction lands undivided on
   the output. Longer and sharper decimators barely help, because the
   problem is conditioning, not filter quality.

   The full form works, and roughly halves the residual — at the price of
   the one assertion this project has protected above all others.

   So the remaining choice is a product decision, not a technical one, and
   it is recorded in §14 rather than taken here. */
'use strict';
var path = require('path');
var C = require(path.join(__dirname, '..', 'casket_core.js'));
var ND = require(path.join(__dirname, '..', '..', 'shared', 'necrodyn.js'));

var FS = 48000, N = 32000;
function db(x) { return 20 * Math.log10(Math.abs(x) + 1e-300); }

/* ---------- material ---------- */
function clipped(scale) {
  var a = C.makeNoise(2718, N);
  for (var i = 0; i < N; i++) { var v = a[i] * scale; a[i] = v > 1 ? 1 : (v < -1 ? -1 : v); }
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
var MUSICAL = (function () {
  var b = new Float64Array(N), i;
  [55, 110, 220, 440, 880, 1760, 3520, 7040].forEach(function (f, k) {
    for (i = 0; i < N; i++) b[i] += Math.sin(2 * Math.PI * f * i / FS + k * 0.7) / 8;
  });
  var m = 0;
  for (i = 0; i < N; i++) m = Math.max(m, Math.abs(b[i]));
  for (i = 0; i < N; i++) b[i] /= m;
  return b;
})();
var BANDED = lowpass(lowpass(clipped(8), 9000), 9000);
var FULL = clipped(8);

/* ---------- a purpose-built decimation FIR ----------
   Unlike the engine's Mth-band interpolator (which is −6 dB AT Nyquist by
   construction, since that is what forces h[kM] = 0), a decimator wants
   its cutoff BELOW Nyquist with a real transition band. Reusing the
   interpolator here was the first mistake and cost about a decibel. */
function decFir(M, half, cutFrac) {
  var L = 2 * half + 1, h = new Float64Array(L), c = half, k;
  var a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
  var den = L - 1, fc = cutFrac / M;
  for (k = 0; k < L; k++) {
    var u = 2 * Math.PI * k / den;
    var w = a0 - a1 * Math.cos(u) + a2 * Math.cos(2 * u) - a3 * Math.cos(3 * u);
    var t = (k - c) * fc;
    h[k] = (t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)) * w;
  }
  var s = 0;
  for (k = 0; k < L; k++) s += h[k];
  for (k = 0; k < L; k++) h[k] /= s;   // DC gain 1
  return h;
}

/* ---------- a stripped limiter that can run either candidate ----------
   Same gain path as the engine (required gain → release → sliding min →
   two boxcars); only the application differs. Deliberately simplified so
   the comparison isolates the one variable. */
function render(src, opt) {
  var M = opt.lining, q = C.OS_Q, o = C.designOversampler(M, q);
  var Lb = Math.round(opt.vigil * 0.001 * FS);
  var W = M * (Lb + 1) + 1, B = Math.floor(M * Lb / 2) + 1;
  var smin = ND.slidingMin(W, 0), b1 = ND.boxcar(B, 0), b2 = ND.boxcar(B, 0);
  var T = opt.lid, kneeStart = Math.pow(10, T / 20);
  var drive = Math.pow(10, opt.drive / 20);
  var histN = o.histLen, h = new Float64Array(histN), hp = 0;
  var x4 = new Float64Array(W), xw = 0;
  var dec = decFir(M, opt.half, opt.cut), dl = dec.length;
  var cn = dl + M, c4 = new Float64Array(cn), cw = 0;
  var out = new Float64Array(N);
  var env = 0, cF = Math.exp(-1 / (150 * 0.001 * FS));
  var s, i, j, k;
  for (s = 0; s < N; s++) {
    var x = src[s] * drive;
    h[hp] = x; hp = hp + 1 === histN ? 0 : hp + 1;
    for (i = 0; i < M; i++) {
      var v;
      if (i === 0) { var z = hp - 1 - q; if (z < 0) z += histN; v = h[z]; }
      else {
        var tp = o.phases[i], acc = 0, idx = hp - 1;
        for (j = 0; j < tp.length; j++) { if (idx < 0) idx += histN; acc += tp[j] * h[idx]; idx--; }
        v = acc;
      }
      var a = v < 0 ? -v : v;
      var gr = a <= kneeStart ? 0 : ND.kneeGain(ND.linToDb(a), T, 0, 0);
      env = Math.min(gr, env * cF);
      if (gr === 0 && env > -1e-12) env = 0;
      var g = b2.push(b1.push(smin.push(env)));
      var nx = xw + 1 === W ? 0 : xw + 1;
      var old = x4[nx];
      x4[xw] = v; xw = nx;
      var glin = g === 0 ? 1 : Math.pow(10, g / 20);
      c4[cw] = opt.mode === 'full' ? glin * old : (glin - 1) * old;
      cw = cw + 1 === cn ? 0 : cw + 1;
    }
    var id = cw - M; if (id < 0) id += cn;
    var F = 0;
    for (k = 0; k < dl; k++) { F += dec[k] * c4[id]; id = id === 0 ? cn - 1 : id - 1; }
    out[s] = F;
  }
  if (opt.mode === 'full') return db(C.truePeakOf(out, 16, 4000)) - opt.lid;
  /* the residual form needs the direct path added back; search a small
     window for the alignment rather than trusting the derivation */
  var D0 = Math.round(q + Lb + 1 + opt.half / M), best = Infinity;
  for (var D = D0 - 4; D <= D0 + 4; D++) {
    var y = new Float64Array(N);
    for (s = 0; s < N; s++) y[s] = (s - D >= 0 ? src[s - D] * drive : 0) + out[s];
    var tp2 = db(C.truePeakOf(y, 16, 4000)) - opt.lid;
    if (tp2 < best) best = tp2;
  }
  return best;
}

/* ---------- the engine as it actually ships, for the baseline column ---------- */
function shipped(src, lining, vigil, drive, lid) {
  var st = C.defaultState();
  st.style = 'velvet'; st.lid = lid; st.margin = 0; st.drive = drive;
  st.dc = false; st.lining = lining; st.vigil = vigil; st.knee = 0;
  var e = C.createEngine(FS); e.setState(st);
  var oL = new Float64Array(N), oR = new Float64Array(N);
  e.process(src, src, oL, oR);
  return db(C.truePeakOf(oL, 16, 4000)) - lid;
}

/* `half: 256` IS NOT ARBITRARY, and that is the whole reason the lining bug
   was so hard to see — audited 2026-08-19 across every sweep in the suite.
   The shipped engine sets the decimator half-length to DEC_Q·M. At this
   file's default `lining: 4` that is 64 × 4 = 256, so OPT is EXACTLY what
   the product uses, and every measurement here that keeps the default
   lining is faithful. The figure in §6.3's table matched live output to
   three decimals for precisely this reason.
   It only goes wrong when `lining` is swept while `half` stays put — the
   one thing nobody had done until the ladder was added. `cut: 0.96` is
   likewise the engine's own DEC_CUT and does not scale with M, so it is
   correct at every lining.
   AUDIT RESULT: this is the ONLY file in the suite that reimplements the
   DSP rather than driving the engine — every other lining sweep
   (casket_test, casket_host, casket_bench, parity_emit) sets `lining` on a
   real state and lets the engine derive its own filter lengths, so the
   trap cannot exist there. One reimplementation, one fixed constant, one
   bug — now with the constant scaled where it needs to be. */
var OPT = { lining: 4, vigil: 2, drive: 12, lid: -1, half: 256, cut: 0.96 };
function opts(mode) {
  var o = {};
  for (var k in OPT) o[k] = OPT[k];
  o.mode = mode;
  return o;
}

console.log('CASKET — the seal experiment');
console.log('4× lining · 2 ms vigil · +12 dB drive · −1.0 dBTP lid · 513-tap decimator\n');

/* sanity: with no limiting at all the residual form must reproduce the
   input exactly. If this line disagrees, nothing below means anything. */
var sane = opts('residual'); sane.drive = 0; sane.lid = 20;
var got = render(FULL, sane) + 20, want = db(C.truePeakOf(FULL, 16, 4000));
console.log('  sanity — idle residual reproduces the input: ' +
            got.toFixed(4) + ' vs ' + want.toFixed(4) +
            (Math.abs(got - want) < 1e-6 ? '   OK' : '   *** RIG IS BROKEN ***') + '\n');

console.log('  true-peak residual above the lid, in dB (lower is better)\n');
console.log('  material            shipped (base-rate)   RESIDUAL form   FULL oversampled');
var headline = null;   /* full-band clip's three figures — the case the whole question turns on */
[['harmonic / musical', MUSICAL], ['band-limited clip', BANDED], ['full-band clip', FULL]]
  .forEach(function (p) {
    var s = shipped(p[1], OPT.lining, OPT.vigil, OPT.drive, OPT.lid);
    var r = render(p[1], opts('residual'));
    var f = render(p[1], opts('full'));
    if (p[1] === FULL) headline = { base: s, residual: r, full: f };
    console.log('  ' + p[0].padEnd(20) +
      (s >= 0 ? '+' : '') + s.toFixed(3).padStart(9) + '          ' +
      (r >= 0 ? '+' : '') + r.toFixed(3).padStart(8) + '        ' +
      (f >= 0 ? '+' : '') + f.toFixed(3).padStart(8));
  });

/* THE SEALED LINING LADDER — added 2026-08-19, because architecture §6.4
   publishes "2× +0.447, 4× +0.507, 16× +0.562" as the reason Lead defaults
   to 4×, and nothing in the suite reproduced it. Not wrong, but unbacked:
   the numbers predate this file's current shape and no harness swept sealed
   linings. A figure that decides a shipped default deserves to be runnable,
   which is this file's whole stated purpose.
   Note the counter-intuitive direction the doc reports and this confirms:
   MORE lining is slightly WORSE sealed, because a longer decimator has a
   sharper transition and preserves more product energy just under Nyquist.
   Lead still defaults to 4× rather than 2× — detection is not exact at 2×,
   so the marginally lower residual there is bought with a worse detector. */
console.log('\n  the FULL oversampled form, sweeping the lining');
console.log('  decimator half-length scaled as DEC_Q·M, the way the SHIPPED engine does —');
console.log('  holding it fixed measures this rig instead of the product:');
var ladder = [];
[2, 4, 8, 16].forEach(function (M) {
  var o = opts('full');
  o.lining = M;
  /* THE TRAP THIS LINE EXISTS FOR. `OPT.half` is a constant 256 in this
     file, which is right for the decimator-quality sweep further down —
     that sweep is ABOUT holding the lining still and varying the filter.
     Sweeping the lining with `half` fixed measures something the product
     never does: the shipped engine sets half = DEC_Q·M, so its decimator
     grows with the lining and its relative response stays put. Fixed, the
     filter gets effectively sharper as M rises and the residual falls
     steeply — a clean, believable, entirely artefactual result. Measured
     both ways before this comment was written, because the fixed-half
     version produced exactly the kind of tidy monotone curve that gets
     quoted. */
  o.half = C.DEC_Q * M;
  var res = render(FULL, o);
  ladder.push({ M: M, res: res });
  console.log('    ' + (M + '× lining').padStart(10) +
              '  →  full-band residual +' + res.toFixed(3) + ' dB' +
              '   (decimator ' + (2 * o.half + 1) + ' taps)');
});

/* THIS FILE NOW ASSERTS ONE THING — added 2026-08-19. Everything else here
   reports rather than gates, on purpose: it is §6.3's evidence, and evidence
   argues rather than polices. But the ladder above is different in kind now,
   because CASKET_ARCHITECTURE.md §6.4 was rewritten to quote it, and the
   figures it replaced were figures nobody could reproduce. A doc table
   sourced from a print statement is one refactor away from being orphaned
   again.
   The DIRECTION is asserted, not the magnitudes. The direction is the
   argument — sealed residual rises with the lining, which is why Lead
   defaults to 4× rather than 16× — and it is what would have caught the
   fixed-decimator mistake that produced a confident monotone FALL. The
   magnitudes are wall-clock-free but still material- and filter-dependent,
   and pinning them would make this a brittle gate rather than a true one. */
var rising = ladder.every(function (p, i) { return i === 0 || p.res >= ladder[i - 1].res; });
var spread = ladder[ladder.length - 1].res - ladder[0].res;
console.log('\n  ASSERTED: the ladder rises with the lining' +
            (rising ? '  ✓' : '  ✗ IT DOES NOT — see §6.4, which is written on the assumption that it does'));
console.log('    2× ' + ladder[0].res.toFixed(3) + ' → 16× ' + ladder[ladder.length - 1].res.toFixed(3) +
            '  (spread ' + spread.toFixed(3) + ' dB)');
if (!rising) {
  console.log('    If this went red honestly, §6.4 needs rewriting. If it went red after a');
  console.log('    change to THIS file, check that every constant the engine varies is varying');
  console.log('    here too — a fixed decimator half-length reverses this result convincingly.');
  process.exitCode = 1;
}

console.log('\n  the residual form, sweeping decimator length and cutoff');
console.log('  (if it were merely a filter-quality problem, this column would fall)');
[[64, 0.90], [128, 0.94], [256, 0.96], [512, 0.98]].forEach(function (p) {
  var o = opts('residual');
  o.half = p[0]; o.cut = p[1];
  console.log('    ' + (2 * p[0] + 1 + ' taps').padStart(10) + '  cutoff ' + p[1].toFixed(2) +
              '  →  full-band residual ' + render(FULL, o).toFixed(3) + ' dB');
});

console.log('\n  CONCLUSION');
console.log('  The residual form loses. It is a difference of two large, nearly');
console.log('  cancelling terms whenever the limiter works hard, so decimation error');
console.log('  inside the correction arrives undivided — and sharper filters barely');
console.log('  move it, because the problem is conditioning, not filter quality.');
console.log('  The full oversampled form works and roughly halves the residual, but');
console.log('  costs the bit-exact null test permanently. That trade is §14\'s to');
console.log('  settle, not this file\'s.');
/* One machine-checkable line, COMPUTED rather than typed — added
   2026-08-18. This file is the runnable evidence behind architecture §6.3,
   and §6.3 publishes its table; but the table this printed and the prose
   the doc carries had no line a tool could compare. This is that line: the
   headline figures, from the variables that made the table above, in the
   number-adjacent-to-a-sentence shape check_mastering_citations.js's
   extractor reads — so if a doc ever cites this file, the citation is
   verifiable from day one instead of needing the harness patched first
   (the fate casket_seal_margin.js's per-material figures suffered). */
console.log('\n  Measured on full-band clip: shipped ' + headline.base.toFixed(3) +
            ' dB, residual form ' + headline.residual.toFixed(3) +
            ' dB, full oversampled ' + headline.full.toFixed(3) + ' dB.');
