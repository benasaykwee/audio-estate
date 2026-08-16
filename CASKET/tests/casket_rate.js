/* CASKET rate harness — sample-rate conversion, measured.
   node tests/casket_rate.js

   A resampler is easy to write and hard to know you got right, because a
   broken one still produces plausible-looking audio. Every assertion here
   is a property that a broken resampler fails and a correct one cannot,
   and each one names the specific way it would break.  */
'use strict';
var C = require('../casket_core.js');

var pass = 0, fail = 0;
function ok(c, n) {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ FAIL: ' + n); }
}
function near(a, b, tol, n) {
  var d = Math.abs(a - b);
  ok(d <= tol, n + ' (' + a + ' ≈ ' + b + ', off by ' + d.toExponential(2) + ')');
}

/* A single-bin DFT, HANN-WINDOWED — and the window is the whole point.

   The first version of this function used a rectangular window, and it
   reported 1.2e-3 of energy at 1.5× the test frequency, which read
   exactly like a resampler emitting a spurious tone at −58 dB. It is not.
   A rectangular window on a tone that does not complete a whole number of
   cycles leaks across the entire spectrum with sidelobes that fall only as
   1/Δf, and 1.2e-3 is what that leakage measures to at this length.

   The way this was settled is the point: measure a sine that was NEVER
   RESAMPLED with the same function. It read 9.6e-4 — the same figure, from
   a signal that cannot possibly contain a resampling artefact. The
   instrument was the whole finding.

   Hann's sidelobes fall as 1/Δf³. Under it the same measurements read
   8.31e-8 for the resampled tone against 8.24e-8 for the pure control:
   the resampler adds nothing detectable. Coherent gain is 0.5, so the
   normalisation divides by the window sum rather than by n.  */
function binMag(buf, freq, fs) {
  var re = 0, im = 0, n = buf.length, w = 2 * Math.PI * freq / fs, sw = 0;
  for (var i = 0; i < n; i++) {
    var h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    sw += h;
    re += h * buf[i] * Math.cos(w * i);
    im -= h * buf[i] * Math.sin(w * i);
  }
  return 2 * Math.sqrt(re * re + im * im) / sw;
}
function rms(buf) {
  var s = 0;
  for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

console.log('CASKET rate harness — a 44.1 file in a 96 session\n');

/* ============================================================
   1. THE NULL TEST FOR THE RESAMPLER
   ============================================================ */
console.log('— same rate in, same audio out —');
(function () {
  var n = 4096;
  var a = C.makeNoise(1234, n), b = C.makeNoise(5678, n);
  var r = C.resample(a, b, 48000, 48000);
  var bad = 0;
  for (var i = 0; i < n; i++) if (r.L[i] !== a[i] || r.R[i] !== b[i]) bad++;
  ok(bad === 0, '48 k → 48 k is BIT-IDENTICAL, not merely transparent');
  ok(r.converted === false, 'and says so — converted is false');
  ok(r.ratio === 1, 'ratio is exactly 1');
  /* the trap this guards: a windowed sinc evaluated at ratio 1 is very
     nearly the identity, and "very nearly" is how a bit-exact project
     stops being bit-exact */
  ok(r.taps === 0, 'no filter was run at all');
})();

/* ============================================================
   2. DC GAIN IS EXACTLY ONE
   Normalising the taps makes this true by construction. If the taps were
   merely windowed and not normalised, this drifts with the ratio.
   ============================================================ */
console.log('\n— DC survives at unity —');
(function () {
  [[44100, 48000], [48000, 44100], [44100, 96000], [96000, 44100],
   [48000, 96000], [96000, 48000], [48000, 192000], [192000, 48000]].forEach(function (p) {
    var n = 6000;
    var dc = new Float64Array(n);
    for (var i = 0; i < n; i++) dc[i] = 0.5;
    var r = C.resample(dc, dc, p[0], p[1]);
    /* skip the edges — the clamped tap fetch is a deliberate choice at the
       boundary and is not what this assertion is about */
    var mn = 1e9, mx = -1e9, edge = 200;
    for (i = edge; i < r.L.length - edge; i++) {
      if (r.L[i] < mn) mn = r.L[i];
      if (r.L[i] > mx) mx = r.L[i];
    }
    ok(Math.abs(mn - 0.5) < 1e-12 && Math.abs(mx - 0.5) < 1e-12,
       p[0] / 1000 + 'k → ' + p[1] / 1000 + 'k holds DC at 0.5 (spread ' +
       (mx - mn).toExponential(1) + ')');
  });
})();

/* ============================================================
   3. A SINE STAYS THE SAME SINE
   Same frequency, same amplitude. A resampler with the wrong ratio gives
   the wrong frequency; one with the wrong cutoff gives the wrong level.
   ============================================================ */
console.log('\n— a tone keeps its pitch and its level —');
(function () {
  [[44100, 48000], [48000, 44100], [44100, 96000], [96000, 48000]].forEach(function (p) {
    var f = 997, n = Math.floor(p[0] * 0.25);
    var x = C.makeSine(f, p[0], n, 0.5);
    var r = C.resample(x, x, p[0], p[1]);
    var mid = r.L.subarray(400, r.L.length - 400);
    var atF = binMag(mid, f, p[1]);
    var off = binMag(mid, f * 1.5, p[1]);
    near(atF, 0.5, 2e-3, p[0] / 1000 + 'k → ' + p[1] / 1000 + 'k: 997 Hz still reads 0.5');
    /* 1e-6 is −120 dB. The pure, never-resampled control reads 8.2e-8
       here, so this threshold is a real bound on the resampler and not a
       restatement of the window's own floor. */
    ok(off < 1e-6, '  and there is nothing at 1.5× f (' + off.toExponential(1) + ')');
  });
})();

/* ============================================================
   4. THE ANTI-ALIASING — the assertion that matters most
   Feed 96 k a tone ABOVE 44.1 k's Nyquist and convert down. A resampler
   without a moving cutoff folds it back into the audible band as a loud,
   wrong tone. This is the single mistake that makes a resampler sound
   broken, and it is invisible on program material.
   ============================================================ */
console.log('\n— what happens above the new Nyquist —');
(function () {
  var fsIn = 96000, fsOut = 44100, n = 24000;
  var f = 30000;                     /* well above 22.05 kHz */
  var x = C.makeSine(f, fsIn, n, 0.7);
  var r = C.resample(x, x, fsIn, fsOut);
  var mid = r.L.subarray(600, r.L.length - 600);

  /* where a naive resampler would put it: 96000 - 30000 folded about the
     new Nyquist. 30000 mod 44100 = 30000; reflected about 22050 → 14100. */
  var alias = binMag(mid, 14100, fsOut);
  ok(alias < 1e-4, 'the 30 kHz tone does NOT appear at 14.1 kHz (' +
     (20 * Math.log10(alias + 1e-30)).toFixed(1) + ' dB)');
  ok(rms(mid) < 1e-3, 'and essentially nothing survives at all (rms ' +
     rms(mid).toExponential(2) + ') — it was above the new Nyquist, so it should not');

  /* the control: a tone BELOW the new Nyquist must survive intact, or the
     filter is simply eating everything and the test above proves nothing */
  var y = C.makeSine(5000, fsIn, n, 0.7);
  var r2 = C.resample(y, y, fsIn, fsOut);
  var keep = binMag(r2.L.subarray(600, r2.L.length - 600), 5000, fsOut);
  near(keep, 0.7, 3e-3, 'while 5 kHz passes through untouched');
})();

/* ============================================================
   5. THE ROUND TRIP
   ============================================================ */
console.log('\n— up and back —');
(function () {
  var n = 20000, fs = 48000;
  /* band-limited material, because anything near Nyquist is legitimately
     lost on the way down and would be measuring the filter, not the trip */
  var x = new Float64Array(n);
  [220, 440, 1000, 3000, 7000].forEach(function (f) {
    var s = C.makeSine(f, fs, n, 0.15);
    for (var i = 0; i < n; i++) x[i] += s[i];
  });
  var up = C.resample(x, x, fs, 96000);
  var back = C.resample(up.L, up.R, 96000, fs);
  var e = 0, edge = 500;
  for (var i = edge; i < n - edge && i < back.L.length - edge; i++)
    e = Math.max(e, Math.abs(back.L[i] - x[i]));
  ok(e < 2e-3, '48 k → 96 k → 48 k returns the signal to within ' +
     (20 * Math.log10(e)).toFixed(1) + ' dB');
})();

/* ============================================================
   6. LENGTHS AND DEGENERATE INPUT
   ============================================================ */
console.log('\n— the awkward sizes —');
(function () {
  var n = 10000;
  var x = C.makeNoise(9, n);
  var up = C.resample(x, x, 44100, 48000);
  var want = Math.floor(n * 48000 / 44100);
  ok(up.L.length === want, 'output length is floor(n × ratio) = ' + want);
  var dn = C.resample(x, x, 96000, 44100);
  ok(dn.L.length === Math.floor(n * 44100 / 96000), 'and downward too');

  ok(C.resample(new Float64Array(0), new Float64Array(0), 44100, 48000).L.length === 0,
     'a zero-length buffer converts to a zero-length buffer');
  var one = C.resample(new Float64Array([0.5]), new Float64Array([0.5]), 44100, 48000);
  ok(one.L.length >= 1 && isFinite(one.L[0]), 'a single sample survives (' + one.L[0] + ')');

  var sil = C.resample(new Float64Array(2000), new Float64Array(2000), 96000, 48000);
  var loud = 0;
  for (var i = 0; i < sil.L.length; i++) if (sil.L[i] !== 0) loud++;
  ok(loud === 0, 'silence converts to exact silence, not to 1e-18 of something');

  ok(C.resample(x, x, 0, 48000).converted === false, 'a zero source rate is refused');
  ok(C.resample(x, x, 44100, NaN).converted === false, 'a NaN target rate is refused');

  /* mono in — the second channel must mirror, not be undefined */
  var mono = C.resample(x, null, 44100, 48000);
  ok(mono.R.length === mono.L.length && mono.R[100] === mono.L[100],
     'a mono source produces a mirrored right channel');
})();

/* ============================================================
   7. NOTHING NON-FINITE, EVER
   ============================================================ */
console.log('\n— finiteness across the grid —');
(function () {
  var rates = [8000, 22050, 44100, 48000, 88200, 96000, 176400, 192000];
  var bad = [], n = 3000;
  var x = C.makeNoise(4242, n);
  for (var a = 0; a < rates.length; a++) {
    for (var b = 0; b < rates.length; b++) {
      var r = C.resample(x, x, rates[a], rates[b]);
      for (var i = 0; i < r.L.length; i++) {
        if (!isFinite(r.L[i]) || !isFinite(r.R[i])) { bad.push(rates[a] + '→' + rates[b]); break; }
      }
    }
  }
  ok(bad.length === 0, rates.length * rates.length +
     ' rate pairs produce nothing non-finite' + (bad.length ? ' — ' + bad[0] : ''));
})();

/* ============================================================
   8. THE LOADER'S SENTENCE
   A silent conversion is how somebody masters at the wrong rate for an
   hour. The note is part of the feature, so it is part of the test.
   ============================================================ */
console.log('\n— what the loader says out loud —');
(function () {
  var x = C.makeNoise(1, 2000);
  var same = C.conformToRate(x, x, 48000, 48000);
  ok(/already at 48000/.test(same.note), 'no conversion says so: "' + same.note + '"');
  var up = C.conformToRate(x, x, 44100, 96000);
  ok(/44100/.test(up.note) && /96000/.test(up.note) && /up/.test(up.note),
     'upward names both rates: "' + up.note + '"');
  var dn = C.conformToRate(x, x, 96000, 44100);
  ok(/anti-aliased at 22050/.test(dn.note),
     'downward names the anti-aliasing: "' + dn.note + '"');
  var junk = C.conformToRate(x, x, -1, 48000);
  ok(/unknown source rate/.test(junk.note), 'an impossible rate is refused in words too');
})();

/* ============================================================
   9. AND IT ACTUALLY HELPS — the reason this exists
   Metering a 44.1 k buffer as though it were 96 k reports the loudness of
   a file played at 2.18× speed. Converting first fixes the NUMBER, not
   just the sound.
   ============================================================ */
console.log('\n— the reason the limiter cares —');
(function () {
  var fsFile = 44100, fsSession = 96000;
  var n = Math.floor(fsFile * 3);
  var tone = C.makeSine(1000, fsFile, n, Math.pow(10, -23 / 20));

  var st = C.defaultState();
  st.style = 'pine'; st.lid = -1; st.drive = 0;

  /* the wrong way: pretend the buffer is at the session rate */
  var wrong = C.renderOffline(st, tone, tone, fsSession);
  /* the right way: conform first */
  var conf = C.conformToRate(tone, tone, fsFile, fsSession);
  var right = C.renderOffline(st, conf.L, conf.R, fsSession);

  console.log('    · mis-declared: ' + wrong.meters.integrated.toFixed(2) +
              ' LUFS   conformed: ' + right.meters.integrated.toFixed(2) + ' LUFS');
  ok(Math.abs(right.meters.integrated + 23) < 0.35,
     'a −23 LUFS tone conformed to the session reads −23 (' +
     right.meters.integrated.toFixed(2) + ')');
  /* K-weighting is a shelf and a high-pass designed AT fs, so a 1 kHz tone
     mis-declared as 96 k is measured as though it were 2177 Hz — which the
     shelf lifts. The gap is the whole argument for this feature. */
  ok(Math.abs(wrong.meters.integrated - right.meters.integrated) > 0.15,
     'and mis-declaring the rate measurably moves the reported loudness (' +
     Math.abs(wrong.meters.integrated - right.meters.integrated).toFixed(3) + ' LU)');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (!fail) console.log('the file arrives at the session\'s rate, and says so.');
process.exit(fail ? 1 : 0);
