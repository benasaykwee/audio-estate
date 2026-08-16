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
[['harmonic / musical', MUSICAL], ['band-limited clip', BANDED], ['full-band clip', FULL]]
  .forEach(function (p) {
    var s = shipped(p[1], OPT.lining, OPT.vigil, OPT.drive, OPT.lid);
    var r = render(p[1], opts('residual'));
    var f = render(p[1], opts('full'));
    console.log('  ' + p[0].padEnd(20) +
      (s >= 0 ? '+' : '') + s.toFixed(3).padStart(9) + '          ' +
      (r >= 0 ? '+' : '') + r.toFixed(3).padStart(8) + '        ' +
      (f >= 0 ? '+' : '') + f.toFixed(3).padStart(8));
  });

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
