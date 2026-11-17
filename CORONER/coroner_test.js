/* ===================================================================
   CORONER — the harness
   coroner_test.js

   THE ARGUMENT FOR THIS FILE'S DESIGN.

   A classifier tested against real recordings can only be checked by ear,
   which means the test is Ben, which means it is not a test. So every
   signal below is SYNTHESIZED, and its true nature is known by
   construction: a plucked string is plucked because this file stretched
   its partials and decayed them, not because someone labelled a wav.

   That buys a real ground truth and costs a real limitation, which is
   stated here rather than buried: passing these tests proves the
   classifier can read the physics it was told to look for. It does NOT
   prove it survives a room, a microphone, a preamp and a mix bus. Those
   live in section XII, which is a list of what this harness cannot see.

   Run:  node coroner_test.js
   =================================================================== */

'use strict';

var NM = require('../shared/necromath.js');
global.NM = NM;
var CR = require('./coroner_core.js');

var pass = 0, fail = 0, section = '';
var failures = [];

function sec(s) { section = s; console.log('\n' + s); }

function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else {
    fail++;
    var line = section + ' :: ' + name + (detail ? '  [' + detail + ']' : '');
    failures.push(line);
    console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : ''));
  }
}

function near(name, got, want, tol, unit) {
  var d = Math.abs(got - want);
  ok(name, d <= tol, 'got ' + got.toFixed(4) + (unit || '') + ', want ' + want + '+-' + tol);
}

function within(name, got, lo, hi) {
  ok(name, got >= lo && got <= hi, 'got ' + (typeof got === 'number' ? got.toFixed(4) : got) + ', want ' + lo + '..' + hi);
}

// ===================================================================
// THE SIGNAL FORGE — deterministic, no Math.random anywhere
// ===================================================================

/* 32-bit xorshift, the estate's dice. Seeded per generator so the whole
   harness is reproducible: a flaky classification test would be
   indistinguishable from a real regression, and PALLBEARER already paid
   for that lesson once ("a flaky test is usually a badly posed one"). */
function Dice(seed) {
  var s = seed >>> 0 || 1;
  this.next = function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
  this.bi = function () { return this.next() * 2 - 1; };
}

var SR = 22050;

function buf(sec) { return new Float64Array(Math.floor(sec * SR)); }

/* An additive tone with explicit control over every property the
   classifier claims to measure. This one generator produces nearly all
   the test bodies, which is deliberate: if a feature separates two
   signals from this function, it separated them on the property that was
   varied and nothing else. */
function tone(o) {
  o = o || {};
  var dur = o.dur || 1.8;
  var f0 = o.f0 || 220;
  var nPart = o.partials || 12;
  var slope = o.slope === undefined ? 1.0 : o.slope;   // amplitude ~ 1/n^slope
  var B = o.inharm || 0;                                 // stiffness
  var oddOnly = !!o.oddOnly;
  var noise = o.noise || 0;                              // broadband noise level
  var jitterCents = o.jitter || 0;                       // random pitch wander
  var vibHz = o.vibHz || 0, vibCents = o.vibCents || 0;
  var atk = o.atk === undefined ? 0.01 : o.atk;
  var decayPerSec = o.decayPerSec === undefined ? 0 : o.decayPerSec;  // dB/s on the whole tone
  var partialDecay = o.partialDecay || 0;   // extra dB/s per partial index
  var seed = o.seed || 12345;

  var d = new Dice(seed);
  var out = buf(dur);
  var n = out.length;

  /* The pitch track is built first, then integrated into phase. Building
     phase from an instantaneous frequency per sample is the only way a
     vibrato comes out as a vibrato rather than as a phase discontinuity
     every buffer. */
  /* JITTER MUST LIVE IN THE BAND THE ANALYSER CAN SEE.

     The first version of this used a per-sample random walk with a very
     long time constant, which produced a pitch that WANDERED SLOWLY. That
     is drift, not jitter — and once CORONER learned to remove a line per
     segment (correctly, since a smooth sag is not instability), this
     generator's "unstable" bodies became indistinguishable from steady
     ones and a hand-played phrase started reading as synthetic.

     The generator was wrong, not the analyser. Frame-to-frame tracking
     sees modulation from roughly 1 to 50 Hz, so jitter has to be generated
     at a CONTROL RATE in that band: a fresh target 100 times a second,
     smoothed just enough to stay continuous. Faster than this and it
     averages out inside a single analysis frame; slower and it is drift
     again. */
  /* 20 Hz control rate sits in the natural pitch-tremor band and well
     inside what frame-to-frame tracking can resolve. The x5 is a
     CALIBRATION, not a fudge: the control signal is a peak amplitude and
     the analyser reports a standard deviation, and a smoothed uniform
     signal's standard deviation is roughly a fifth of its peak. Without it
     `jitter: 22` produced 3.2 measured cents, every "human" test body sat
     under the synthetic bar, and the tests read as though they were
     describing something they were not. Measured after the change,
     `jitter: N` lands within a few cents of N. */
  var CTRL = Math.max(1, Math.floor(SR / 20));
  var JITTER_SCALE = 5;
  var jTarget = 0, jCur = 0;
  var phase = new Float64Array(n);
  var ph = 0;
  for (var i = 0; i < n; i++) {
    var t = i / SR;
    var c = 0;
    if (vibHz > 0) c += vibCents * NM.sin(2 * Math.PI * vibHz * t);
    if (jitterCents > 0) {
      if (i % CTRL === 0) jTarget = d.bi() * jitterCents * JITTER_SCALE;
      jCur += (jTarget - jCur) * 0.4;
      c += jCur;
    }
    var f = f0 * NM.exp(c / 1200 * 0.69314718055994531);
    ph += 2 * Math.PI * f / SR;
    phase[i] = ph;
  }

  for (var k = 1; k <= nPart; k++) {
    if (oddOnly && k % 2 === 0) continue;
    // stiffness stretches partials sharp
    var mult = k * Math.sqrt(1 + B * k * k);
    if (mult * f0 > SR * 0.45) break;
    var amp = 1 / Math.pow(k, slope);
    var pdB = partialDecay * k;
    for (var j = 0; j < n; j++) {
      var tt = j / SR;
      var a = amp;
      if (pdB > 0) a *= NM.pow10(-pdB * tt / 20);
      out[j] += a * NM.sin(phase[j] * mult);
    }
  }

  // envelope
  for (i = 0; i < n; i++) {
    var t2 = i / SR;
    var e = 1;
    if (atk > 0) e *= t2 < atk ? (t2 / atk) : 1;
    if (decayPerSec !== 0) e *= NM.pow10(decayPerSec * t2 / 20);
    out[i] *= e;
    if (noise > 0) out[i] += d.bi() * noise * e;
  }

  // normalise so level never drives a verdict
  var pk = 0;
  for (i = 0; i < n; i++) { var ax = Math.abs(out[i]); if (ax > pk) pk = ax; }
  if (pk > 0) for (i = 0; i < n; i++) out[i] /= pk;
  return out;
}

/* A PHRASE — several notes in a row, each internally steady.

   This generator exists because of a gap MUTATION TESTING found, not
   because anyone thought of it in advance. Every other body in this file
   is a single held note, so the entire segmentation layer could be
   deleted and the harness stayed green — while the bug segmentation was
   written to fix (jitter reading the melody instead of the note) was
   found on real audio and is invisible to any single-note test.

   Each note here is steady by construction, so a correct measurement must
   report LOW jitter no matter how far apart the notes are. */
function melody(f0s, noteDur, o) {
  o = o || {};
  var parts = f0s.map(function (f, ix) {
    return tone({
      f0: f, dur: noteDur, partials: o.partials || 14, slope: o.slope === undefined ? 0.9 : o.slope,
      atk: o.atk === undefined ? 0.01 : o.atk, inharm: o.inharm || 0, noise: o.noise || 0,
      jitter: o.jitter || 0, decayPerSec: o.decayPerSec === undefined ? -6 : o.decayPerSec,
      seed: (o.seed || 1000) + ix * 17
    });
  });
  var total = parts.reduce(function (a, p) { return a + p.length; }, 0);
  var out = new Float64Array(total), at = 0;
  parts.forEach(function (p) { out.set(p, at); at += p.length; });
  return out;
}

/* A note whose pitch SAGS steadily — a player losing support, or tape
   slowing. Drift is not jitter, and without a line removed before the
   spread is taken, a perfectly smooth sag reads as instability. */
function driftingTone(f0, centsOverWhole, dur, seed) {
  var d = new Dice(seed || 606), n = Math.floor(dur * SR), out = new Float64Array(n), ph = 0;
  for (var i = 0; i < n; i++) {
    var frac = i / n;
    var f = f0 * NM.exp((centsOverWhole * frac) / 1200 * 0.69314718055994531);
    ph += 2 * Math.PI * f / SR;
    for (var k = 1; k <= 12; k++) out[i] += (1 / k) * NM.sin(ph * k);
  }
  var pk = 0;
  for (i = 0; i < n; i++) { var a = Math.abs(out[i]); if (a > pk) pk = a; }
  if (pk > 0) for (i = 0; i < n; i++) out[i] /= pk;
  return out;
}

function whiteNoise(dur, seed) {
  var d = new Dice(seed || 999), out = buf(dur);
  for (var i = 0; i < out.length; i++) out[i] = d.bi();
  return out;
}

/* A one-pole lowpassed noise burst with a fast decay: a drum, near enough
   for a classifier that only claims to tell "struck" from "held". */
function drumHit(dur, cutoffHz, seed) {
  var d = new Dice(seed || 777), out = buf(dur);
  var a = NM.exp(-2 * Math.PI * cutoffHz / SR), z = 0;
  for (var i = 0; i < out.length; i++) {
    var t = i / SR;
    z = d.bi() * (1 - a) + z * a;
    out[i] = z * NM.exp(-t * 28);
  }
  var pk = 0;
  for (i = 0; i < out.length; i++) { var ax = Math.abs(out[i]); if (ax > pk) pk = ax; }
  if (pk > 0) for (i = 0; i < out.length; i++) out[i] /= pk;
  return out;
}

function sine(f, dur, sr) {
  sr = sr || SR;
  var n = Math.floor(dur * sr), out = new Float64Array(n);
  for (var i = 0; i < n; i++) out[i] = NM.sin(2 * Math.PI * f * i / sr);
  return out;
}

// ===================================================================
// I. THE GLASS — FFT and windows
// ===================================================================
sec('I. The glass — FFT, windows, spectra');

(function () {
  // a DC signal must put all its energy in bin 0 and nothing anywhere else
  var n = 64;
  var re = new Float64Array(n), im = new Float64Array(n);
  for (var i = 0; i < n; i++) re[i] = 1;
  CR._fft(re, im);
  near('DC lands entirely in bin 0', re[0], n, 1e-9);
  var leak = 0;
  for (i = 1; i < n; i++) leak += Math.abs(re[i]) + Math.abs(im[i]);
  ok('DC leaks nothing into other bins', leak < 1e-9, 'leak=' + leak);
})();

(function () {
  // a sinusoid exactly on a bin centre must land on that bin
  var n = 256, binWanted = 7;
  var re = new Float64Array(n), im = new Float64Array(n);
  for (var i = 0; i < n; i++) re[i] = NM.cos(2 * Math.PI * binWanted * i / n);
  CR._fft(re, im);
  var best = 0, bestMag = 0;
  for (i = 0; i < n / 2; i++) {
    var m = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    if (m > bestMag) { bestMag = m; best = i; }
  }
  ok('on-bin sinusoid lands on its own bin', best === binWanted, 'got bin ' + best);
  near('and carries the expected magnitude', bestMag, n / 2, 1e-6);
})();

(function () {
  // Parseval: the FFT must conserve energy, which catches a wrong twiddle
  // sign that a single-peak test would miss entirely
  var n = 128, d = new Dice(4242);
  var re = new Float64Array(n), im = new Float64Array(n), t = 0;
  for (var i = 0; i < n; i++) { re[i] = d.bi(); t += re[i] * re[i]; }
  CR._fft(re, im);
  var s = 0;
  for (i = 0; i < n; i++) s += re[i] * re[i] + im[i] * im[i];
  near('Parseval holds (energy conserved)', s / n, t, 1e-9);
})();

(function () {
  var w = CR._hann(8);
  near('Hann starts at zero', w[0], 0, 1e-12);
  near('Hann peaks at 1 in the middle', w[4], 1, 1e-12);
  ok('Hann is symmetric about its peak', Math.abs(w[3] - w[5]) < 1e-12);
})();

(function () {
  var s = sine(1000, 0.2);
  var mag = CR._magSpectrum(s.subarray(0, 1024), 1024);
  var best = 0, bm = 0;
  for (var i = 0; i < mag.length; i++) if (mag[i] > bm) { bm = mag[i]; best = i; }
  var hz = best * SR / 1024;
  near('1 kHz sine peaks at 1 kHz in the spectrum', hz, 1000, SR / 1024);
})();

// ===================================================================
// II. PITCH — YIN against known frequencies
// ===================================================================
sec('II. Pitch — YIN against known frequencies');

[55, 82.41, 110, 220, 440, 880, 1760].forEach(function (f) {
  var s = sine(f, 0.3);
  var r = CR._yinF0(s.subarray(0, 2048), SR, 40, 4000, 0.15);
  var errC = Math.abs(CR._cents(r.hz, f));
  ok('YIN finds ' + f + ' Hz within 10 cents', errC < 10, 'got ' + r.hz.toFixed(2) + ' Hz, ' + errC.toFixed(1) + 'c off');
});

(function () {
  /* THE OCTAVE TRAP. NECROPHONE's autocorrelation detector reported C4 as
     65 Hz — an octave-down error from normalising by (N-lag). A rich
     harmonic tone is where that bug shows, because the second harmonic is
     a perfectly good period if you let it be. */
  var s = tone({ f0: 261.63, partials: 16, slope: 0.7, dur: 0.5, atk: 0.001 });
  var r = CR._yinF0(s.subarray(1000, 1000 + 2048), SR, 40, 4000, 0.15);
  var errC = Math.abs(CR._cents(r.hz, 261.63));
  ok('a harmonically rich C4 does NOT read an octave down', errC < 30,
     'got ' + r.hz.toFixed(2) + ' Hz (' + errC.toFixed(0) + 'c off)');
})();

(function () {
  /* THE PLATEAU TRAP. The same detector then reported E2 as 1600 Hz by
     peak-picking into the short-lag plateau before the real minimum. */
  var s = tone({ f0: 82.41, partials: 20, slope: 0.6, dur: 0.5, atk: 0.001 });
  var r = CR._yinF0(s.subarray(1000, 1000 + 4096), SR, 40, 4000, 0.15);
  var errC = Math.abs(CR._cents(r.hz, 82.41));
  ok('a low E2 does NOT read a high harmonic', errC < 30,
     'got ' + r.hz.toFixed(2) + ' Hz (' + errC.toFixed(0) + 'c off)');
})();

(function () {
  var n = whiteNoise(0.3, 31337);
  var r = CR._yinF0(n.subarray(0, 2048), SR, 40, 4000, 0.15);
  ok('noise reports no pitch, or reports it with low confidence', r.hz === 0 || r.conf < 0.75,
     'hz=' + r.hz.toFixed(1) + ' conf=' + r.conf.toFixed(2));
})();

// ===================================================================
// III. MODULATION — vibrato and tremolo
// ===================================================================
sec('III. Modulation — the same measurement, two signals');

(function () {
  // a 5 Hz, 30-unit sinusoidal series sampled at 100 Hz
  var rate = 100, n = 512, series = [];
  for (var i = 0; i < n; i++) series.push(30 * NM.sin(2 * Math.PI * 5 * i / rate));
  var m = CR._modulation(series, rate, 1, 20);
  near('finds the 5 Hz modulation rate', m.rate, 5, 0.4, ' Hz');
  near('finds the 30-unit depth', m.depth, 30, 6);
})();

(function () {
  // a constant series is not a 0 Hz modulation of enormous depth
  var series = [];
  for (var i = 0; i < 256; i++) series.push(7.5);
  var m = CR._modulation(series, 100, 1, 20);
  ok('a constant series reports no depth', m.depth < 0.01, 'depth=' + m.depth);
})();

// ===================================================================
// IV. DOWNMIX AND WIDTH
// ===================================================================
sec('IV. Downmix and stereo width');

(function () {
  var l = sine(300, 0.2), r = sine(300, 0.2);
  var d = CR._toMono({ left: l, right: r });
  near('identical channels report zero width', d.width, 0, 1e-9);
  near('and the downmix preserves the signal', d.mono[500], l[500], 1e-12);
})();

(function () {
  var l = sine(300, 0.2), r = new Float64Array(l.length);
  for (var i = 0; i < l.length; i++) r[i] = -l[i];
  var d = CR._toMono({ left: l, right: r });
  near('fully out-of-phase channels report full width', d.width, 1, 1e-6);
  ok('and the mid cancels to silence', Math.abs(d.mono[500]) < 1e-12);
})();

(function () {
  var m = CR._toMono(sine(300, 0.1));
  ok('a bare mono array is accepted', m.mono.length > 0 && m.width === 0);
})();

// ===================================================================
// V. THE FEATURE REGISTRY
// ===================================================================
sec('V. The feature registry — the contract a model will read');

(function () {
  var seen = {}, dupes = 0;
  CR.FEATURES.forEach(function (f) { if (seen[f.id]) dupes++; seen[f.id] = 1; });
  ok('no duplicate feature ids', dupes === 0, dupes + ' duplicates');

  var badRange = 0;
  CR.FEATURES.forEach(function (f) {
    if (!(typeof f.min === 'number' && typeof f.max === 'number' && f.max > f.min)) badRange++;
  });
  ok('every feature declares a usable range', badRange === 0, badRange + ' bad');

  var named = CR.FEATURES.filter(function (f) { return f.name && f.name.length; }).length;
  ok('every feature has a human name', named === CR.FEATURES.length);
})();

(function () {
  var rep = CR.autopsy(tone({ f0: 220 }), SR);
  ok('the vector length matches the registry', rep.vector.length === CR.FEATURES.length,
     rep.vector.length + ' vs ' + CR.FEATURES.length);
  ok('the normalised vector matches too', rep.normalized.length === CR.FEATURES.length);

  var outOfRange = 0;
  for (var i = 0; i < rep.normalized.length; i++) {
    if (!(rep.normalized[i] >= 0 && rep.normalized[i] <= 1)) outOfRange++;
  }
  ok('every normalised value lands in 0..1', outOfRange === 0, outOfRange + ' outside');

  var nonFinite = 0;
  for (i = 0; i < rep.vector.length; i++) if (!isFinite(rep.vector[i])) nonFinite++;
  ok('no feature is NaN or Infinity', nonFinite === 0, nonFinite + ' non-finite');
})();

(function () {
  /* The vector's ORDER is the contract, not just its contents. A model
     trained on this order and handed a reordered one reads every field
     out of the wrong slot and fails silently, which is the worst way to
     fail. Pin the order explicitly so a reorder breaks a test rather
     than a downstream model six months from now. */
  var ids = CR.FEATURES.map(function (f) { return f.id; }).join(',');
  var expected = 'f0,f0conf,f0jitter,vibRate,vibDepth,harmonicity,inharm,inharmFit,oddEven,irregular,bandSlope,' +
                 'centroid,centroidVar,rolloff,flatness,flux,subRatio,highRatio,noiseRatio,' +
                 'attack,decayRate,sustain,tremRate,tremDepth,onsetRate,crest,zcr,polyphony,dur,stereoWidth,' +
                 'noteCount,pluckPos,pluckFit';
  ok('the vector order is exactly the pinned contract', ids === expected, 'got ' + ids);
  ok('FEATURE_VERSION is stamped', CR.FEATURE_VERSION === 4);
})();

// ===================================================================
// VI. INDIVIDUAL FEATURES — measured against known physics
// ===================================================================
sec('VI. Individual features against known physics');

(function () {
  var pure = CR.examine(sine(440, 1.5), SR).features;
  var noisy = CR.examine(whiteNoise(1.5, 5150), SR).features;
  ok('a sine is spectrally peaked (low flatness)', pure.flatness < 0.1, 'flatness=' + pure.flatness.toFixed(4));
  ok('white noise is spectrally flat (high flatness)', noisy.flatness > 0.3, 'flatness=' + noisy.flatness.toFixed(4));
  ok('and noise is much flatter than a sine', noisy.flatness > pure.flatness * 5);
})();

(function () {
  var dark = CR.examine(tone({ f0: 220, partials: 4, slope: 2.5 }), SR).features;
  var bright = CR.examine(tone({ f0: 220, partials: 24, slope: 0.4 }), SR).features;
  ok('a bright tone has a higher centroid than a dark one',
     bright.centroid > dark.centroid * 1.5,
     dark.centroid.toFixed(0) + ' Hz vs ' + bright.centroid.toFixed(0) + ' Hz');
  ok('and a higher rolloff', bright.rolloff > dark.rolloff);
})();

(function () {
  var stiff = CR.examine(tone({ f0: 110, partials: 20, inharm: 0.0008, slope: 0.8 }), SR).features;
  var pure = CR.examine(tone({ f0: 110, partials: 20, inharm: 0, slope: 0.8 }), SR).features;
  ok('a stiff string measures inharmonic', stiff.inharm > 0.0002, 'B=' + stiff.inharm.toExponential(2));
  ok('a pure harmonic series measures near zero', pure.inharm < 0.00008, 'B=' + pure.inharm.toExponential(2));
  ok('and the stiff one is clearly stiffer', stiff.inharm > pure.inharm * 4);
})();

(function () {
  /* THE PITCH OF A STIFF STRING — a gap found by mutation testing, not by
     writing tests forwards.

     Deliberately breaking the joint pitch/stiffness fit and forcing the raw
     YIN estimate through instead left the whole harness GREEN. B survived
     the sabotage because the regression solves for its own intercept and is
     therefore robust to a bad seed, which is a real virtue of the method —
     but f0 did not survive, and nothing was watching it. The corpseRoot
     assertion elsewhere rounds to the nearest semitone, so a 31-cent error
     sailed straight through it.

     A sample handed to NECROPHONE 31 cents sharp is a sample that plays out
     of tune against everything else in the session. That is worth a gate. */
  var stiff = CR.examine(tone({ f0: 110, partials: 20, inharm: 0.0008, slope: 0.8, dur: 1.8 }), SR).features;
  var errC = Math.abs(CR._cents(stiff.f0, 110));
  ok('a stiff string\'s fundamental is measured accurately, not pulled sharp', errC < 8,
     'got ' + stiff.f0.toFixed(3) + ' Hz, ' + errC.toFixed(1) + ' cents off');

  // and the same measurement on a body with no stiffness must not drift
  var soft = CR.examine(tone({ f0: 110, partials: 20, inharm: 0, slope: 0.8, dur: 1.8 }), SR).features;
  var errS = Math.abs(CR._cents(soft.f0, 110));
  ok('and a harmonic string at the same pitch is measured accurately too', errS < 8,
     'got ' + soft.f0.toFixed(3) + ' Hz, ' + errS.toFixed(1) + ' cents off');
})();

(function () {
  /* THE DETUNE CONFOUND — found on a real NECROPHONE render, not by
     reasoning about it beforehand.

     Several detuned copies of an oscillator broaden and displace every
     partial, and a displaced partial is exactly what stiffness looks like
     to anything measuring one partial at a time. revenant_pad.wav, which
     is oscillators and nothing else, fitted B=3.09e-4 — squarely "stiff
     string" — and got routed to the PHYSICAL engine on the strength of it.

     The two are separable because stiffness obeys a law and detune does
     not: a real string's partials fall on a straight line in the fitted
     coordinates, and detuned ones scatter. So the gate is the goodness of
     fit, and this test proves it bites in both directions — the false
     stiffness must be refused AND the true stiffness must survive, since a
     guard that rejects everything would pass a one-sided test. */
  function detunedUnison(f0, cents_, voices, seed) {
    var d = new Dice(seed || 3131), n = Math.floor(1.8 * SR), out = new Float64Array(n);
    for (var v = 0; v < voices; v++) {
      var off = (v / (voices - 1) - 0.5) * 2 * cents_;
      var fv = f0 * NM.exp(off / 1200 * 0.69314718055994531);
      var ph = d.next() * 6.283;
      for (var k = 1; k <= 16; k++) {
        if (k * fv > SR * 0.45) break;
        for (var i = 0; i < n; i++) out[i] += (1 / k) * NM.sin(2 * Math.PI * k * fv * i / SR + ph * k);
      }
    }
    var pk = 0;
    for (i = 0; i < n; i++) { var a = Math.abs(out[i]); if (a > pk) pk = a; }
    if (pk > 0) for (i = 0; i < n; i++) out[i] /= pk;
    return out;
  }

  /* A body whose partials are displaced by a comparable amount but
     SCATTERED rather than following the stiffness law.

     Written this way after an honest failure: a plain additive unison at
     several detune amounts never reproduced the real render's false
     B=3.09e-4, so a test built on it gated nothing and the "delete the
     guard" mutation survived. Rather than keep tuning a body until it
     happened to fool the fitter, the test now goes at the MECHANISM the
     guard actually keys on — displacement that obeys no law — which is
     what unison detune produces and what the guard exists to refuse.

     Stated plainly: this proves the guard rejects lawless displacement. It
     does not reproduce a real detuned pad, and the real evidence for that
     confound is revenant_pad.wav, not this. */
  function scatteredPartials(f0, maxCents, seed) {
    var d = new Dice(seed || 8181), n = Math.floor(1.8 * SR), out = new Float64Array(n);
    for (var k = 1; k <= 20; k++) {
      var off = d.bi() * maxCents * (k / 20);   // grows with n, like stiffness, but signed at random
      var fk = k * f0 * NM.exp(off / 1200 * 0.69314718055994531);
      if (fk > SR * 0.45) break;
      for (var i = 0; i < n; i++) out[i] += (1 / Math.pow(k, 0.8)) * NM.sin(2 * Math.PI * fk * i / SR);
    }
    var pk = 0;
    for (i = 0; i < n; i++) { var a = Math.abs(out[i]); if (a > pk) pk = a; }
    if (pk > 0) for (i = 0; i < n; i++) out[i] /= pk;
    return out;
  }

  var pad = CR.examine(scatteredPartials(110, 260, 8181), SR).features;
  var str = CR.examine(tone({ f0: 110, partials: 20, inharm: 0.0008, slope: 0.8, dur: 1.8 }), SR).features;

  ok('lawlessly displaced partials are NOT reported as a stiff string', pad.inharm < 5e-5,
     'B=' + pad.inharm.toExponential(2) + ' at fit ' + pad.inharmFit.toFixed(3));
  ok('and the poor fit is reported rather than hidden', pad.inharmFit < 0.75,
     'fit=' + pad.inharmFit.toFixed(3));

  // a plain detuned unison must also come back clean
  var uni = CR.examine(detunedUnison(110, 18, 5, 4242), SR).features;
  ok('a detuned unison is not reported as a stiff string either', uni.inharm < 5e-5,
     'B=' + uni.inharm.toExponential(2) + ' at fit ' + uni.inharmFit.toFixed(3));

  ok('a genuine stiff string still survives the guard', str.inharm > 2e-4,
     'B=' + str.inharm.toExponential(2) + ' at fit ' + str.inharmFit.toFixed(3));
  ok('and fits the stiff-string law closely', str.inharmFit > 0.9,
     'fit=' + str.inharmFit.toFixed(3));

  ok('the guard separates them by a real margin, not a hair',
     str.inharmFit - pad.inharmFit > 0.25,
     'fits are ' + pad.inharmFit.toFixed(3) + ' and ' + str.inharmFit.toFixed(3));
})();

(function () {
  /* ⚠ A GOODNESS OF FIT ONLY TELLS YOU THE SHAPE IS RIGHT.

     The closed loop — render a NECROPHONE engine, feed the audio back in,
     see where it routes — was run for the first time by a parallel session
     and found this file's strongest physical tell running BACKWARDS. The
     grain cloud measured B=9.22e-3 at R²=0.999, the best stiff-string fit
     in the set, and was routed to the physical engine; Bone & Sinew, the
     actual string model, measured 2.23e-6 and was sent to the granular one.

     The R² guard was powerless by construction: it refuses poor fits, and
     that fit was superb. The tell was the VALUE — nine times the stiffest
     piano bass string, and 92% of the maximum this file itself declared,
     which is what let an impossible answer look unremarkable.

     So the test is: a body that obeys the stiff-string law PERFECTLY but at
     a magnitude no string can reach must be refused on the magnitude, while
     a plausible one at an equally good fit sails through. Both directions,
     because a ceiling that rejected everything would pass a one-sided
     version of this. */
  var impossible = CR.examine(tone({ f0: 110, partials: 20, inharm: 0.0092, slope: 0.8, dur: 1.8 }), SR).features;
  var plausible  = CR.examine(tone({ f0: 110, partials: 20, inharm: 0.0009, slope: 0.8, dur: 1.8 }), SR).features;

  ok('a body nine times stiffer than any real string is refused',
     impossible.inharm === 0, 'B=' + impossible.inharm.toExponential(2));
  ok('and it is refused on the VALUE, not on a poor fit',
     impossible.inharmFit > 0.75,
     'fit was ' + impossible.inharmFit.toFixed(3) + ' — if this were low, the ceiling proved nothing');

  ok('a plausible stiff string at an equally good fit still passes',
     plausible.inharm > 4e-4, 'B=' + plausible.inharm.toExponential(2));
  ok('so the ceiling discriminates rather than simply rejecting',
     plausible.inharm > 0 && impossible.inharm === 0);

  /* The declared range is part of the guard, not decoration. A maximum
     that admits impossible values is a range in which impossible answers
     look ordinary — which is how this got through in the first place. */
  ok('the declared maximum for stiffness is physically defensible',
     CR.FEATURE_BY_ID.inharm.max <= 0.002,
     'declared max = ' + CR.FEATURE_BY_ID.inharm.max);
})();

(function () {
  /* Vibrato must not destroy a genuine stiffness measurement. Averaging a
     spectrum across a vibrato averages across every pitch it visited; the
     same body measured this way fitted at 0.495 and had its real stiffness
     thrown away, against 0.999 for the identical body held still. Sampling
     the segment where the note is momentarily still is what recovers it. */
  var still = CR.examine(tone({ f0: 220, partials: 18, inharm: 0.0006, slope: 0.8, dur: 2.4 }), SR).features;
  var wobbly = CR.examine(tone({ f0: 220, partials: 18, inharm: 0.0006, slope: 0.8, dur: 2.4,
                                 vibHz: 5.2, vibCents: 30 }), SR).features;
  ok('a held stiff string fits the law', still.inharmFit > 0.9, 'fit=' + still.inharmFit.toFixed(3));
  ok('and a vibrato does not destroy that fit', wobbly.inharmFit > 0.75,
     'fit=' + wobbly.inharmFit.toFixed(3));
  ok('so its stiffness survives the vibrato', wobbly.inharm > 1e-4,
     'B=' + wobbly.inharm.toExponential(2));
})();

(function () {
  var odd = CR.examine(tone({ f0: 220, partials: 16, oddOnly: true, slope: 1 }), SR).features;
  var all = CR.examine(tone({ f0: 220, partials: 16, oddOnly: false, slope: 1 }), SR).features;
  ok('an odd-only spectrum reads as odd-dominant', odd.oddEven > 0.9, 'oddEven=' + odd.oddEven.toFixed(3));
  ok('a full harmonic series is more balanced', all.oddEven < 0.85, 'oddEven=' + all.oddEven.toFixed(3));
})();

(function () {
  var steady = CR.examine(tone({ f0: 330, jitter: 0, dur: 2 }), SR).features;
  var wobbly = CR.examine(tone({ f0: 330, jitter: 45, dur: 2, seed: 8 }), SR).features;
  ok('a perfectly steady oscillator has near-zero jitter', steady.f0jitter < 4,
     'jitter=' + steady.f0jitter.toFixed(2) + 'c');
  ok('a wandering pitch measures real jitter', wobbly.f0jitter > steady.f0jitter * 2,
     'steady=' + steady.f0jitter.toFixed(2) + 'c vs wobbly=' + wobbly.f0jitter.toFixed(2) + 'c');
})();

(function () {
  var vib = CR.examine(tone({ f0: 440, dur: 2.5, vibHz: 5.5, vibCents: 35, partials: 10 }), SR).features;
  near('a 5.5 Hz vibrato is measured at 5.5 Hz', vib.vibRate, 5.5, 1.2, ' Hz');
  ok('and its depth is in the right neighbourhood', vib.vibDepth > 12 && vib.vibDepth < 80,
     'depth=' + vib.vibDepth.toFixed(1) + 'c');

  /* THE MEASUREMENT THAT MUST NOT LIE. A deliberate vibrato is not
     jitter. If the vibrato leaked into the jitter figure, every
     expressive player would read as unstable and the synthetic tell
     would invert — so this assertion is load-bearing for the whole
     classifier, not a nicety. */
  ok('the vibrato does NOT inflate the jitter figure', vib.f0jitter < 15,
     'jitter=' + vib.f0jitter.toFixed(2) + 'c under a ' + vib.vibDepth.toFixed(0) + 'c vibrato');
})();

(function () {
  var slow = CR.examine(tone({ f0: 220, atk: 0.4, dur: 2 }), SR).features;
  var fast = CR.examine(tone({ f0: 220, atk: 0.001, dur: 2 }), SR).features;
  ok('a slow attack is measured as slow', slow.attack > 0.15, 'attack=' + slow.attack.toFixed(3) + 's');
  ok('a fast attack is measured as fast', fast.attack < 0.05, 'attack=' + fast.attack.toFixed(3) + 's');
})();

(function () {
  var held = CR.examine(tone({ f0: 220, dur: 2, decayPerSec: 0 }), SR).features;
  var dying = CR.examine(tone({ f0: 220, dur: 2, decayPerSec: -18, atk: 0.001 }), SR).features;
  ok('a held tone sustains', held.sustain > 0.7, 'sustain=' + held.sustain.toFixed(3));
  ok('a decaying tone does not', dying.sustain < 0.3, 'sustain=' + dying.sustain.toFixed(3));
  ok('and the decay rate is negative and real', dying.decayRate < -8, 'decay=' + dying.decayRate.toFixed(1) + ' dB/s');
})();

(function () {
  var clean = CR.examine(tone({ f0: 220, noise: 0, partials: 12 }), SR).features;
  var breathy = CR.examine(tone({ f0: 220, noise: 0.35, partials: 12, seed: 61 }), SR).features;
  ok('a clean tone has little residual', clean.noiseRatio < 0.35, 'noise=' + clean.noiseRatio.toFixed(3));
  ok('a breathy tone has much more', breathy.noiseRatio > clean.noiseRatio + 0.12,
     clean.noiseRatio.toFixed(3) + ' vs ' + breathy.noiseRatio.toFixed(3));
})();

(function () {
  var low = CR.examine(tone({ f0: 45, partials: 10, slope: 1.4 }), SR).features;
  var high = CR.examine(tone({ f0: 600, partials: 10, slope: 1.4 }), SR).features;
  ok('a 45 Hz tone carries sub energy', low.subRatio > 0.2, 'sub=' + low.subRatio.toFixed(3));
  ok('a 600 Hz tone carries almost none', high.subRatio < 0.05, 'sub=' + high.subRatio.toFixed(3));
})();

// ===================================================================
// VI-b. PHRASES — the single-note assumption, and where it broke
// ===================================================================
sec('VI-b. Phrases — several notes, not one');

(function () {
  /* THE BUG THIS SECTION EXISTS FOR.

     Measuring the whole file as one note reported pitch jitter of 250 to
     435 CENTS on eight real NECROPHONE renders. Nothing in them was
     unstable; it was measuring the tune. Since near-zero jitter is the
     strongest synthetic tell in the machine, and no piece of music can
     show near-zero jitter under that definition, the tell could never fire
     on real material at all — an oscillator pad came back "Blown or Reed".

     Every one of these assertions would have passed before the fix if the
     phrase were a single note, which is exactly why the harness missed it. */
  var notes = [220, 277.18, 329.63, 261.63, 196];
  var phrase = melody(notes, 0.55, { jitter: 0 });
  var f = CR.examine(phrase, SR).features;

  ok('a five-note phrase is seen as several notes, not one',
     f.noteCount >= 3, 'noteCount=' + f.noteCount);

  /* The load-bearing one. These notes span a minor tenth — about 1600
     cents — so a whole-file spread would be in the hundreds. Each note is
     steady by construction, so the honest answer is small. */
  ok('and its jitter reflects the NOTES, not the tune',
     f.f0jitter < 15, 'jitter=' + f.f0jitter.toFixed(1) + 'c across a ~1600-cent phrase');

  ok('the reported pitch is one of the notes actually played',
     notes.some(function (n) { return Math.abs(CR._cents(f.f0, n)) < 60; }),
     'got ' + f.f0.toFixed(1) + ' Hz, played ' + notes.join('/'));
})();

(function () {
  /* A phrase of steady oscillator notes must still reach the synthetic
     verdict. This is the end-to-end version of the failure: not "is the
     number smaller" but "does the machine now reach the right conclusion
     on material shaped like real music". */
  var phrase = melody([196, 261.63, 329.63, 261.63], 0.6,
                      { jitter: 0, noise: 0, inharm: 0, decayPerSec: 0, atk: 0.02 });
  var v = CR.autopsy(phrase, SR).verdict;
  ok('a phrase played by an oscillator still reads as synthetic',
     v.klass === 'synthetic', 'got "' + v.klass + '" at ' + (v.confidence * 100).toFixed(0) + '%');
})();

(function () {
  /* And the converse: a phrase played by something unsteady must NOT read
     synthetic, or segmentation has simply made everything look like a
     machine. */
  var phrase = melody([196, 261.63, 329.63, 261.63], 0.6,
                      { jitter: 30, noise: 0.2, inharm: 0.0006, seed: 4004 });
  var v = CR.autopsy(phrase, SR).verdict;
  ok('a phrase played by a hand does not read as synthetic',
     v.klass !== 'synthetic', 'got "' + v.klass + '"');
})();

(function () {
  /* A REPEATED NOTE — the case that needs onsets, and only onsets.

     Written after mutation testing showed the onset half of the segmenter
     could be deleted with the harness staying green. The reason was in the
     test bodies, not the code: `melody` concatenates separately-generated
     notes, so every boundary carries a phase discontinuity that the pitch
     tracker rejects anyway. The segments were being separated by an
     accident of the generator, and any splitter at all would have passed.

     This body removes that accident. Phase is continuous, pitch never
     changes, and the amplitude dips to 35% and recovers rather than
     reaching silence — so neither the pitch test nor the energy gate can
     see a boundary. Five strikes of one note. Only an onset detector finds
     them, which is the whole point. */
  function reArticulated(f0, strikes, strikeDur) {
    var n = Math.floor(strikes * strikeDur * SR), out = new Float64Array(n), ph = 0;
    for (var i = 0; i < n; i++) {
      var into = (i / SR) % strikeDur;
      var env = 0.35 + 0.65 * NM.exp(-into * 9);
      if (into < 0.004) env *= into / 0.004;
      ph += 2 * Math.PI * f0 / SR;
      var s = 0;
      for (var k = 1; k <= 16; k++) s += (1 / Math.pow(k, 0.8)) * NM.sin(ph * k);
      out[i] = s * env;
    }
    var pk = 0;
    for (i = 0; i < n; i++) { var a = Math.abs(out[i]); if (a > pk) pk = a; }
    if (pk > 0) for (i = 0; i < n; i++) out[i] /= pk;
    return out;
  }

  var f = CR.examine(reArticulated(220, 5, 0.45), SR).features;
  ok('five strikes of ONE pitch are counted as five notes, not one',
     f.noteCount >= 4, 'noteCount=' + f.noteCount);
  ok('and the onsets that separated them are reported',
     f.onsetRate > 1, 'onsetRate=' + f.onsetRate.toFixed(1) + '/s');
})();

(function () {
  /* THE HARMONIC MEASUREMENTS MUST COME FROM ONE NOTE.

     Also written after a surviving mutation: the whole segment-spectrum
     machinery could be bypassed without a single failure, because every
     other body is one note and the two spectra are then the same thing.

     These three pitches are deliberately NOT simple ratios — a tritone
     apart, so their harmonic series barely overlap. Averaged together they
     make a spectrum with no coherent series in it at all. Measured on one
     note, the stiffness is exactly what was built in. */
  function unrelatedStiffPhrase(f0s, dur, B) {
    var parts = f0s.map(function (f) {
      var n = Math.floor(dur * SR), o = new Float64Array(n), ph = 0;
      for (var i = 0; i < n; i++) {
        ph += 2 * Math.PI * f / SR;
        var s = 0;
        for (var k = 1; k <= 20; k++) {
          var m = k * Math.sqrt(1 + B * k * k);
          if (m * f > SR * 0.45) break;
          s += (1 / Math.pow(k, 0.8)) * NM.sin(ph * m);
        }
        var t = i / SR;
        o[i] = s * (t < 0.01 ? t / 0.01 : 1);
      }
      var pk = 0;
      for (i = 0; i < n; i++) { var a = Math.abs(o[i]); if (a > pk) pk = a; }
      if (pk > 0) for (i = 0; i < n; i++) o[i] /= pk;
      return o;
    });
    var tot = parts.reduce(function (a, p) { return a + p.length; }, 0);
    var out = new Float64Array(tot), at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }

  var f = CR.examine(unrelatedStiffPhrase([110, 138.59, 184.997], 0.8, 0.0008), SR).features;
  ok('a phrase at unrelated pitches is still counted as several notes',
     f.noteCount >= 3, 'noteCount=' + f.noteCount);
  ok('its stiffness is measured on ONE note, not on the smear of all three',
     f.inharm > 4e-4, 'B=' + f.inharm.toExponential(2) + ' (built with 8.0e-4)');
  ok('and that measurement fits the stiff-string law closely',
     f.inharmFit > 0.9, 'fit=' + f.inharmFit.toFixed(3));
  ok('harmonicity likewise reflects one note, not three mixed series',
     f.harmonicity > 0.8, 'harmonicity=' + f.harmonicity.toFixed(3));
})();

(function () {
  /* Jitter across segments is a MEDIAN, so one badly-tracked note cannot
     drag the figure. Four steady notes and one wild one, all joined
     cleanly, so the wild note really does become its own segment rather
     than being discarded at a broken boundary. */
  function jitterPhrase(specs) {
    var segs = specs.map(function (c) {
      var dd = new Dice(c[3]), n = Math.floor(c[2] * SR), o = new Float64Array(n), ph = 0;
      var CTRL = Math.max(1, Math.floor(SR / 20)), jT = 0, jC = 0;
      for (var i = 0; i < n; i++) {
        if (c[1] > 0) { if (i % CTRL === 0) jT = dd.bi() * c[1] * 5; jC += (jT - jC) * 0.4; }
        var fq = c[0] * NM.exp(jC / 1200 * 0.69314718055994531);
        ph += 2 * Math.PI * fq / SR;
        var s = 0;
        for (var k = 1; k <= 14; k++) s += (1 / k) * NM.sin(ph * k);
        var t = i / SR;
        o[i] = s * (t < 0.01 ? t / 0.01 : 1);
      }
      var pk = 0;
      for (i = 0; i < n; i++) { var a = Math.abs(o[i]); if (a > pk) pk = a; }
      if (pk > 0) for (i = 0; i < n; i++) o[i] /= pk;
      return o;
    });
    var tot = segs.reduce(function (a, p) { return a + p.length; }, 0);
    var out = new Float64Array(tot), at = 0;
    segs.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }

  var f = CR.examine(jitterPhrase([
    [220, 0, 0.6, 1], [277.18, 0, 0.6, 2], [329.63, 0, 0.6, 3], [261.63, 0, 0.6, 4],
    [196, 40, 0.6, 5]
  ]), SR).features;

  ok('all five notes are found', f.noteCount >= 4, 'noteCount=' + f.noteCount);
  ok('one wild note among four steady ones does not hijack the jitter figure',
     f.f0jitter < 8, 'jitter=' + f.f0jitter.toFixed(2) + 'c with one 40-cent note in five');
})();

(function () {
  /* A MEASUREMENT THAT RUNS BACKWARDS IS WORSE THAN NO MEASUREMENT,
     because it will be believed.

     Found by probing rather than by any assertion here: bodies built with
     increasing instability reported 12.3, then 7.1, then 0.8 cents. The
     segmenter was breaking a wobbling note into fragments at every frame
     that crossed the note-change threshold, each fragment covered only the
     moments the pitch was briefly still, and the measured spread collapsed
     as the real instability grew. Since jitter is the strongest single
     signal in the classifier, the most unstable material in the world was
     being handed to it labelled "steadier than a hand".

     Nothing in the harness could see it, because every body had either no
     jitter or one fixed amount. A single value can never show a monotonic
     relationship. This test sweeps. */
  var params = [0, 5, 10, 20, 30, 40];
  var got = params.map(function (j) {
    return CR.examine(tone({ f0: 196, partials: 14, dur: 1.5, jitter: j, seed: j + 1 }), SR).features.f0jitter;
  });

  var backwards = [];
  for (var i = 1; i < got.length; i++) {
    if (got[i] + 1.0 < got[i - 1]) backwards.push(params[i - 1] + '->' + params[i]);
  }
  ok('reported jitter rises as real instability rises, across the usable range',
     backwards.length === 0,
     'went backwards at ' + backwards.join(', ') + '  [' + got.map(function (g) { return g.toFixed(1); }).join(', ') + ']');

  ok('a steady body sits at the bottom of that sweep', got[0] < 1, got[0].toFixed(2) + 'c');
  ok('and the most unstable body of the sweep is far above it', got[got.length - 1] > 20,
     got[got.length - 1].toFixed(1) + 'c');

  /* THE CEILING, MEASURED RATHER THAN GUESSED — and narrower than the
     first version of this test claimed.

     The sweep originally ran to a much wilder body and asserted
     monotonicity over the whole of it. It does not hold there, and finding
     out why is the useful part: beyond roughly 30 measured cents, "a note
     wobbling" and "a pitch gliding" stop being distinguishable, and the
     segmenter's span limit — which exists because a glide is genuinely not
     one note — starts cutting a very unstable note into pieces. Any rule
     that separates glides from wobbles has this failure somewhere; the
     honest thing is to know where it is rather than to claim it is not
     there.

     Everything real measured so far sits well inside the usable range: the
     eight NECROPHONE renders span 0.9 to 23.4 cents, and Ben's own
     recordings 3.2 and 12.0. Above about 30, read the figure as "very
     unstable" and not as a number. */
  var wild = CR.examine(tone({ f0: 196, partials: 14, dur: 1.5, jitter: 120, seed: 9 }), SR).features.f0jitter;
  ok('an extreme body is still reported as unsteady, even past the reliable range',
     wild > got[0] + 3, 'wild=' + wild.toFixed(1) + 'c vs steady=' + got[0].toFixed(2) + 'c');
})();

(function () {
  /* A STEADY TONE IS ONE NOTE. The onset threshold was built from two
     RELATIVE terms, both of which collapse toward zero on steady material,
     so float noise crossed it and a perfectly held 277 Hz tone was cut
     into six notes. Every harmonic measurement then came from a sixth of
     the evidence available. */
  var pitches = [110, 220, 277.18, 329.63, 440];
  var wrong = pitches.filter(function (p) {
    return CR.examine(tone({ f0: p, partials: 14, dur: 1.5, jitter: 0 }), SR).features.noteCount !== 1;
  });
  ok('a held tone is one note at every pitch tried', wrong.length === 0,
     'fragmented at ' + wrong.join(', ') + ' Hz');
})();

(function () {
  /* A GLIDE IS NOT ONE NOTE — the last gap mutation testing found.

     Once a pitch change had to PERSIST to count as a note boundary, a slow
     portamento stopped triggering one at all: nothing moves 60 cents
     between adjacent frames, so an entire sweep fused into a single
     segment whose "jitter" was the width of the glide. Two real NECROPHONE
     pads went straight to the 200-cent ceiling that way, arriving at the
     original whole-file bug by a completely different road.

     The contour here rises and falls rather than running straight, on
     purpose: a LINEAR glide is removed by the line detrend and would prove
     nothing. It also moves at 0.4 Hz, far below the vibrato detector's 3
     to 12 Hz window, so that cannot rescue it either. Only a limit on how
     far one note may wander from where it began catches this. */
  function glidingTone(f0, spanCents, dur, rateHz) {
    var n = Math.floor(dur * SR), out = new Float64Array(n), ph = 0;
    for (var i = 0; i < n; i++) {
      var t = i / SR;
      // triangle contour: up and back down, so no straight line fits it
      var u = (t * rateHz) % 1;
      var tri = u < 0.5 ? (u * 2) : (2 - u * 2);
      var f = f0 * NM.exp((tri * spanCents) / 1200 * 0.69314718055994531);
      ph += 2 * Math.PI * f / SR;
      var s = 0;
      for (var k = 1; k <= 14; k++) s += (1 / k) * NM.sin(ph * k);
      out[i] = s * (t < 0.01 ? t / 0.01 : 1);
    }
    var pk = 0;
    for (i = 0; i < n; i++) { var a = Math.abs(out[i]); if (a > pk) pk = a; }
    if (pk > 0) for (i = 0; i < n; i++) out[i] /= pk;
    return out;
  }

  var g = CR.examine(glidingTone(196, 400, 3.0, 0.4), SR).features;
  ok('a 400-cent glide is broken into several notes, not fused into one',
     g.noteCount >= 2, 'noteCount=' + g.noteCount);
  ok('so the width of the glide is not reported as pitch jitter',
     g.f0jitter < 60, 'jitter=' + g.f0jitter.toFixed(1) + 'c across a 400-cent sweep');

  /* And the converse, so the span limit cannot be "fixed" by making it
     chop everything: a held note with a wide VIBRATO is still one note,
     because it keeps returning to where it started. */
  var v = CR.examine(tone({ f0: 196, partials: 14, dur: 2.4, vibHz: 5.5, vibCents: 55 }), SR).features;
  ok('a wide vibrato is still a single note', v.noteCount <= 2, 'noteCount=' + v.noteCount);
  ok('and is reported as vibrato rather than as instability',
     v.vibRate > 3 && v.f0jitter < 20,
     'vib=' + v.vibRate.toFixed(1) + 'Hz, jitter=' + v.f0jitter.toFixed(1) + 'c');
})();

(function () {
  /* ⚠ SILENCE IS NOT A FAILURE TO FIND A PITCH.

     Found by the closed loop on a real Bone & Sinew render. Pitch
     confidence was computed as voiced frames over ALL frames, silent tail
     included — which structurally punishes exactly the sounds that DECAY,
     since a fast-decaying note is mostly tail. The pitch was found and it
     was RIGHT (195.7 Hz against a G3 at 195.998), then discarded by the
     denominator, and a ringing string came back as **"Percussive" at 94%
     confidence**: a correct measurement thrown away, then reported with
     conviction.

     The test is a short pluck in a long buffer. The ratio of note to
     silence is the only thing varied, and the verdict must not depend on
     it — a note followed by four seconds of nothing is the same note. */
  function pluckInSilence(tailSec) {
    var noteSec = 0.5;
    var n = Math.floor((noteSec + tailSec) * SR), out = new Float64Array(n), ph = 0;
    var noteN = Math.floor(noteSec * SR);
    for (var i = 0; i < noteN; i++) {
      ph += 2 * Math.PI * 196 / SR;
      var s = 0;
      for (var k = 1; k <= 16; k++) {
        var m = k * Math.sqrt(1 + 0.0006 * k * k);
        if (m * 196 > SR * 0.45) break;
        s += (1 / Math.pow(k, 0.8)) * NM.sin(ph * m);
      }
      out[i] = s * NM.pow10(-20 * (i / SR) / 20);
    }
    var pk = 0;
    for (i = 0; i < n; i++) { var a = Math.abs(out[i]); if (a > pk) pk = a; }
    if (pk > 0) for (i = 0; i < n; i++) out[i] /= pk;
    return out;
  }

  var tight = CR.autopsy(pluckInSilence(0.1), SR);
  var loose = CR.autopsy(pluckInSilence(3.0), SR);

  ok('a pluck followed by a little silence is pitched',
     tight.features.f0 > 0 && tight.features.f0conf > 0.25,
     'f0=' + tight.features.f0.toFixed(1) + ' conf=' + tight.features.f0conf.toFixed(2));

  ok('and the SAME pluck followed by three seconds of silence is still pitched',
     loose.features.f0 > 0 && loose.features.f0conf > 0.25,
     'f0=' + loose.features.f0.toFixed(1) + ' conf=' + loose.features.f0conf.toFixed(2));

  var errC = Math.abs(CR._cents(tight.features.f0, loose.features.f0));
  ok('both find the same pitch', errC < 20, errC.toFixed(1) + ' cents apart');

  ok('and reach the same verdict, because silence carries no evidence',
     tight.verdict.klass === loose.verdict.klass,
     tight.verdict.klass + ' vs ' + loose.verdict.klass);

  ok('neither calls a ringing string unpitched',
     tight.verdict.klass !== 'percussive' && loose.verdict.klass !== 'percussive',
     tight.verdict.klass + ' / ' + loose.verdict.klass);
})();

(function () {
  /* DRIFT IS NOT JITTER. A pitch sagging smoothly across a note is a
     player running out of support or a tape slowing down; it is not
     cycle-to-cycle instability, and leaving it in inflates every reading
     that has any drift at all. */
  var steady = CR.examine(tone({ f0: 220, dur: 2.4, jitter: 0, partials: 12 }), SR).features;
  var sagging = CR.examine(driftingTone(220, 70, 2.4, 9), SR).features;
  ok('a smooth 70-cent sag is not reported as jitter',
     sagging.f0jitter < steady.f0jitter + 8,
     'steady=' + steady.f0jitter.toFixed(2) + 'c, sagging=' + sagging.f0jitter.toFixed(2) + 'c');
})();

// ===================================================================
// VII. THE VERDICT — against bodies whose nature is known
// ===================================================================
sec('VII. The verdict, against bodies of known nature');

function bodyOf(name, samples, wantKlass, minConf, wantRegister) {
  var rep = CR.autopsy(samples, SR);
  var v = rep.verdict;
  ok(name + ' reads as ' + wantKlass, v.klass === wantKlass,
     'got "' + v.klass + '" at ' + (v.confidence * 100).toFixed(0) + '% conf');
  if (minConf !== undefined) {
    ok(name + ' is called with some conviction', v.confidence >= minConf,
       'conf=' + (v.confidence * 100).toFixed(0) + '%, want >=' + (minConf * 100) + '%');
  }
  if (wantRegister !== undefined) {
    ok(name + ' sits in the ' + wantRegister + ' register', v.register === wantRegister,
       'got "' + v.register + '"');
  }
  return rep;
}

/* A synthesizer: perfectly steady, exactly harmonic, no noise at all.
   The three tells fire together, which is the case the classifier was
   designed around. */
bodyOf('a pure oscillator', tone({
  f0: 220, partials: 16, slope: 1, jitter: 0, noise: 0, inharm: 0, dur: 2
}), 'synthetic', 0.3);

/* A plucked string: stiff partials, struck once, ringing out. */
bodyOf('a plucked string', tone({
  f0: 196, partials: 20, slope: 0.7, inharm: 0.0009, atk: 0.002,
  decayPerSec: -14, partialDecay: 0.9, jitter: 3, noise: 0.02, dur: 2
}), 'plucked', 0.2);

/* A bowed string: held, vibrato, bow noise, a little instability, AND
   STIFFNESS.

   The first version of this body left inharm at 0 and the classifier
   called it "blown" — correctly, on the evidence it was given, because a
   sustained tone with no stiffness whatsoever IS an air column. The bug
   was here: a bowed string is a string, and a string that reports zero
   inharmonicity is not a violin, it is an oboe wearing one's name. A
   violin D string sits near B=1.5e-4.

   Filed under the estate's standing lesson that most of the bugs a good
   harness finds are in the harness. */
bodyOf('a bowed string', tone({
  f0: 293.66, partials: 18, slope: 0.9, atk: 0.09, dur: 2.5, inharm: 0.00015,
  vibHz: 5.2, vibCents: 30, jitter: 14, noise: 0.09, seed: 202
}), 'bowed', 0.15);

/* Unpitched broadband texture. */
bodyOf('white noise', whiteNoise(2, 1234), 'noise', 0.3);

/* A struck drum: instant attack, fast decay, no pitch. */
bodyOf('a drum hit', drumHit(1.2, 900, 4041), 'percussive', 0.2);

/* Low and heavy with a plucked envelope.

   Note what is asserted and what is NOT. The FAMILY is plucked, because a
   bass note is a plucked string and that is the honest answer; the low
   register is a separate finding reported alongside it. The first version
   of this test demanded klass==='bass' and failed, which is how the
   category error got caught: "bass" and "plucked" were competing for one
   slot when they were never alternatives. */
bodyOf('a bass note', tone({
  f0: 49, partials: 18, slope: 1.1, inharm: 0.0004, atk: 0.004,
  decayPerSec: -9, partialDecay: 0.5, jitter: 5, noise: 0.03, dur: 2.2
}), 'plucked', 0.2, 'sub');

// ===================================================================
// VIII. THE VERDICT MUST BE ABLE TO CHANGE ITS MIND
// ===================================================================
sec('VIII. The classifier separates on the property that was varied');

(function () {
  /* THE CRITICAL EXPERIMENT. Two bodies identical in every respect except
     the three synthetic tells. If the classifier does not flip between
     them, it is reading something else — level, brightness, length —
     and every passing test above is a coincidence. */
  var base = { f0: 246.94, partials: 16, slope: 0.9, atk: 0.05, dur: 2.2, seed: 5150 };

  var machine = tone(Object.assign({}, base, { jitter: 0, noise: 0, inharm: 0 }));
  var human   = tone(Object.assign({}, base, { jitter: 22, noise: 0.18, inharm: 0.0007 }));

  var vm = CR.autopsy(machine, SR).verdict;
  var vh = CR.autopsy(human, SR).verdict;

  ok('the machine version reads synthetic', vm.klass === 'synthetic', 'got ' + vm.klass);
  ok('the human version does NOT read synthetic', vh.klass !== 'synthetic', 'got ' + vh.klass);
  ok('and the synthetic score genuinely dropped',
     vh.scores.synthetic < vm.scores.synthetic,
     vm.scores.synthetic.toFixed(2) + ' -> ' + vh.scores.synthetic.toFixed(2));
})();

(function () {
  /* THERE IS NO SUCH THING AS A SILENT FLUTE.

     "Held, no stiffness, therefore an air column" beat the synthetic
     reading on a NECROPHONE pad whose noise fraction was exactly 0.00, and
     sent an analogue pad to the wrong engine. Air moving through a tube is
     what makes a wind instrument one; a perfectly clean spectrum is
     evidence against ANY physical source, not weak evidence for a flute.

     Both directions are checked, because a rule that simply stopped
     naming anything would pass a one-sided version of this. */
  /* Both bodies carry the same modest pitch wobble, so the ONLY thing that
     differs between them is breath. With both held dead steady the
     synthetic case wins on stability alone in each, and the pair proves
     nothing about the rule under test — a comparison is only a comparison
     when one variable moves. */
  var base = { f0: 220, partials: 16, slope: 0.9, atk: 0.08, dur: 2.4,
               decayPerSec: 0, inharm: 0, jitter: 12 };
  function withNoise(nz, seed) {
    var o = {}; for (var k in base) o[k] = base[k];
    o.noise = nz; o.seed = seed;
    return CR.autopsy(tone(o), SR).verdict;
  }

  var silent = withNoise(0, 11);
  var breathy = withNoise(0.35, 12);

  ok('a held, stiffness-free, perfectly SILENT tone is not called a wind instrument',
     silent.klass !== 'blown', 'got "' + silent.klass + '"');
  ok('it is called synthetic instead', silent.klass === 'synthetic', 'got "' + silent.klass + '"');
  ok('but add breath to the same tone and it does read as blown',
     breathy.klass === 'blown', 'got "' + breathy.klass + '"');
})();

(function () {
  // pitch alone must move a tone from NECROPHONE's world to PALLBEARER's
  var high = tone({ f0: 220, partials: 16, inharm: 0.0006, atk: 0.003, decayPerSec: -12, partialDecay: 0.6, dur: 2 });
  var low  = tone({ f0: 44,  partials: 16, inharm: 0.0006, atk: 0.003, decayPerSec: -12, partialDecay: 0.6, dur: 2 });
  var sHigh = CR.autopsy(high, SR).slip;
  var sLow  = CR.autopsy(low, SR).slip;
  ok('the same pluck an octave and a half up goes to NECROPHONE', sHigh.target === 'NECROPHONE', 'got ' + sHigh.target);
  ok('and down at 44 Hz it goes to PALLBEARER', sLow.target === 'PALLBEARER', 'got ' + sLow.target);
})();

(function () {
  // every verdict must be able to show its working
  var rep = CR.autopsy(tone({ f0: 220, jitter: 0, noise: 0 }), SR);
  ok('the verdict carries evidence', rep.verdict.evidence.length > 0);
  var wellFormed = rep.verdict.evidence.every(function (e) {
    return e.feature && CR.FEATURE_BY_ID[e.feature] && typeof e.reads === 'string' && e.reads.length > 4;
  });
  ok('every piece of evidence names a real feature and reads in English', wellFormed);
  ok('evidence is ordered by weight', (function () {
    for (var i = 1; i < rep.verdict.evidence.length; i++) {
      if (rep.verdict.evidence[i].weight > rep.verdict.evidence[i - 1].weight) return false;
    }
    return true;
  })());
})();

// ===================================================================
// IX. THE ROUTING SLIP
// ===================================================================
sec('IX. The routing slip');

(function () {
  var reps = {
    flat:    CR.autopsy(whiteNoise(2, 22), SR),
    stiff:   CR.autopsy(tone({ f0: 196, inharm: 0.0009, atk: 0.002, decayPerSec: -14, partialDecay: 0.9, dur: 2 }), SR),
    steady:  CR.autopsy(tone({ f0: 220, partials: 14, jitter: 0, noise: 0, dur: 2 }), SR)
  };
  ok('noise is sent to Dust & Ashes', reps.flat.slip.engine === 'granular', 'got ' + reps.flat.slip.engine);
  ok('a stiff pluck is sent to Bone & Sinew', reps.stiff.slip.engine === 'physical', 'got ' + reps.stiff.slip.engine);
  ok('a steady oscillator is sent to The Revenant', reps.steady.slip.engine === 'analog', 'got ' + reps.steady.slip.engine);
})();

(function () {
  /* corpseRoot is a SEMITONE OFFSET from G3 (MIDI 55), which is what
     R14-101 made it so that the default stayed bit-exact. A patch that
     wrote an absolute root here would be silently wrong by 55 semitones. */
  near('G3 itself needs no correction', CR._corpseRootOffset(196.0), 0, 0.001, ' st');
  near('G4 is twelve semitones up', CR._corpseRootOffset(392.0), 12, 0.001, ' st');
  near('G2 is twelve down', CR._corpseRootOffset(98.0), -12, 0.001, ' st');
  ok('silence asks for no offset at all', CR._corpseRootOffset(0) === 0);
  within('the offset is clamped to the parameter range', CR._corpseRootOffset(20000), -48, 48);
})();

(function () {
  var rep = CR.autopsy(tone({ f0: 392, partials: 14, jitter: 0, noise: 0, dur: 2 }), SR);
  var p = rep.slip.params;
  ok('the slip sets an engine', typeof p.engine === 'string');
  near('and pitches the corpse to the detected note', p.corpseRoot, 12, 1, ' st');
  within('the filter lands inside NECROPHONE\'s range', p.cut, 60, 14000);
  within('the attack lands inside range', p.atk, 0.001, 2);
  within('the sustain lands inside range', p.sus, 0, 1);
})();

(function () {
  /* EVERY parameter a slip emits must be a real NECROPHONE parameter with
     a legal value. A slip carrying an invented id is not a handoff, it is
     a patch that silently does nothing — precisely the failure PALLBEARER's
     plugin-parity gate was built to catch. This list is transcribed from
     necrophone_core.js's PARAMS. */
  var NECRO_RANGES = {
    engine:     { enum: ['analog', 'wavetable', 'granular', 'physical'] },
    atk:        { min: 0.001, max: 2 },
    dec:        { min: 0.01, max: 3 },
    sus:        { min: 0, max: 1 },
    cut:        { min: 60, max: 14000 },
    corpseRoot: { min: -48, max: 48 },
    lfo1Rate:   { min: 0.01, max: 20 },
    anWave:     { enum: ['sawtooth', 'square', 'triangle'] },
    anDet:      { min: 0, max: 40 },
    anSub:      { min: 0, max: 1 },
    wtMor:      { min: 0, max: 1 },
    wtBlm:      { min: 2, max: 40 },
    grSize:     { min: 10, max: 300 },
    grDens:     { min: 4, max: 60 },
    grSpray:    { min: 0, max: 1 },
    grDrift:    { min: 0, max: 1 },
    phHard:     { min: 0, max: 1 },
    phDecay:    { min: 0.80, max: 0.999 },
    phBody:     { min: 600, max: 9000 },
    formant:    { min: 0, max: 1 }
  };

  /* THE BODIES THAT STRESS THE CLAMPS — a second gap found by mutation.

     Deleting the clamp on the filter parameter entirely left this test
     green, because at 22.05 kHz Nyquist is 11 kHz and the 85% rolloff can
     never reach the 14 kHz ceiling it was being clamped to. The clamp was
     load-bearing and completely untested: every body was comfortably inside
     the range whether it was clamped or not.

     So the list now deliberately includes bodies whose measurements land
     OUTSIDE NECROPHONE's parameter ranges — bright material at 44.1 kHz
     that pushes rolloff past 14 kHz, and near-silence at the other end —
     because a clamp is only tested by something that needs clamping. */
  var bodies = [
    { b: tone({ f0: 220, jitter: 0, noise: 0, dur: 1.6 }), sr: SR },
    { b: tone({ f0: 196, inharm: 0.0009, atk: 0.002, decayPerSec: -14, dur: 1.6 }), sr: SR },
    { b: tone({ f0: 440, vibHz: 5.5, vibCents: 40, noise: 0.2, dur: 1.8, seed: 71 }), sr: SR },
    { b: tone({ f0: 130, oddOnly: true, noise: 0.3, dur: 1.6, seed: 72 }), sr: SR },
    { b: whiteNoise(1.6, 73), sr: SR },
    { b: drumHit(1.2, 700, 74), sr: SR },
    { b: tone({ f0: 3000, partials: 3, dur: 1.6 }), sr: SR },
    { b: sine(60, 1.6), sr: SR },
    // ---- clamp stress: bright noise at 44.1k, rolloff well past 14 kHz ----
    { b: whiteNoise(1.6, 75), sr: 44100 },
    { b: sine(9000, 1.6), sr: 44100 },
    // ---- clamp stress: the dark and slow end ----
    { b: tone({ f0: 70, partials: 2, slope: 3, atk: 1.2, dur: 2.4 }), sr: SR },
    // ---- clamp stress: an extremely long decay, so dec would exceed 3 s ----
    { b: tone({ f0: 220, atk: 0.001, decayPerSec: -0.6, dur: 2.4 }), sr: SR }
  ];

  var unknown = [], outOfRange = [];
  bodies.forEach(function (spec, bi) {
    var slip = CR.autopsy(spec.b, spec.sr).slip;
    if (!slip || slip.target !== 'NECROPHONE') return;
    Object.keys(slip.params).forEach(function (k) {
      var spec = NECRO_RANGES[k];
      if (!spec) { unknown.push('body' + bi + '.' + k); return; }
      var v = slip.params[k];
      if (spec.enum) { if (spec.enum.indexOf(v) < 0) outOfRange.push('body' + bi + '.' + k + '=' + v); }
      else if (!(v >= spec.min && v <= spec.max)) outOfRange.push('body' + bi + '.' + k + '=' + v);
    });
  });
  ok('no slip invents a parameter NECROPHONE does not have', unknown.length === 0, unknown.join(' '));
  ok('no slip writes a value outside its parameter range', outOfRange.length === 0, outOfRange.join(' '));

  /* PROOF THAT THE PREVIOUS ASSERTION IS DOING WORK.

     "Everything was in range" is exactly what a test reports when nothing
     it measured was ever near an edge, which is how the missing clamp
     stayed invisible. So check the RAW measurements directly and confirm at
     least one of them genuinely lands outside a parameter's range — if none
     does, the clamp test above is passing vacuously and the bodies need
     changing, which is a failure worth being told about. */
  var pushedAnEdge = false;
  bodies.forEach(function (spec) {
    var f = CR.examine(spec.b, spec.sr).features;
    if (f.rolloff > 14000 || (f.rolloff > 0 && f.rolloff < 60)) pushedAnEdge = true;
    if (f.decayRate < 0 && 60 / Math.abs(f.decayRate) > 3) pushedAnEdge = true;
    if (f.attack > 2) pushedAnEdge = true;
  });
  ok('at least one body actually exceeds a parameter range, so the clamps are exercised',
     pushedAnEdge, 'no body pushed any edge — the range test is passing vacuously');
})();

(function () {
  var PB_RANGES = {
    style:    { enum: ['finger', 'pick', 'slap', 'thumb', 'muted'] },
    inharm:   { min: 0, max: 1 },
    decay:    { min: 0.5, max: 12 },
    damping:  { min: 0, max: 1 },
    hardness: { min: 0, max: 1 },
    tone:     { min: 200, max: 12000 },
    noise:    { min: 0, max: 1 },
    drive:    { min: 0, max: 1 }
  };
  var lows = [
    tone({ f0: 41.2, partials: 18, inharm: 0.0005, atk: 0.004, decayPerSec: -9, dur: 2 }),
    tone({ f0: 55,   partials: 18, inharm: 0.0005, atk: 0.001, decayPerSec: -20, dur: 2 }),
    tone({ f0: 73.4, partials: 18, inharm: 0.0003, atk: 0.03, decayPerSec: -4, dur: 2 })
  ];
  var bad = [];
  lows.forEach(function (b, bi) {
    var slip = CR.autopsy(b, SR).slip;
    if (slip.target !== 'PALLBEARER') return;
    Object.keys(slip.params).forEach(function (k) {
      var spec = PB_RANGES[k];
      if (!spec) { bad.push('low' + bi + '.' + k + ' unknown'); return; }
      var v = slip.params[k];
      if (spec.enum) { if (spec.enum.indexOf(v) < 0) bad.push('low' + bi + '.' + k + '=' + v); }
      else if (!(v >= spec.min && v <= spec.max)) bad.push('low' + bi + '.' + k + '=' + v);
    });
  });
  ok('every PALLBEARER slip is legal too', bad.length === 0, bad.join(' '));
})();

// ===================================================================
// X. THE HANDOFF LINK
// ===================================================================
sec('X. The handoff link — NECROPHONE must be able to read it back');

(function () {
  var rep = CR.autopsy(tone({ f0: 392, partials: 14, jitter: 0, noise: 0, dur: 2 }), SR);
  var link = CR.necrophoneLink(rep.slip, 'necrophone.html');
  ok('a link is produced', typeof link === 'string' && link.indexOf('#p=') > 0, link);

  /* Decode it exactly the way loadPatchFromHash does, and confirm the
     patch survives the trip. A handoff nobody verified the far end of is
     a handoff that fails in front of Ben. */
  var m = link.match(/[#&]p=([^&]+)/);
  ok('the hash matches NECROPHONE\'s own pattern', !!m);
  var s = m[1].replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  var json = Buffer.from(s, 'base64').toString('utf8');
  var o = JSON.parse(json);
  ok('it carries the v:1 stamp NECROPHONE checks for', o.v === 1);
  ok('and a patch object', !!o.p && typeof o.p === 'object');
  ok('the engine survived the round trip', o.p.engine === rep.slip.params.engine,
     o.p.engine + ' vs ' + rep.slip.params.engine);
  near('and so did corpseRoot', o.p.corpseRoot, rep.slip.params.corpseRoot, 0.0001);

  var lostKeys = Object.keys(rep.slip.params).filter(function (k) { return !(k in o.p); });
  ok('nothing was dropped in encoding', lostKeys.length === 0, lostKeys.join(','));
})();

(function () {
  /* A PHYSICAL bass, with the stiffness, finger noise and pitch wobble a
     real one has. The first version of this test used a clean 45 Hz tone
     with none of those and then asserted it reached PALLBEARER; it did
     not, and it was right not to. A perfectly steady, perfectly harmonic,
     perfectly silent 45 Hz tone is a synth bass, and PALLBEARER — which
     models a physical instrument and nothing else — cannot make that
     sound. See routeToPallbearer's note on the deliberate split. */
  var rep = CR.autopsy(tone({
    f0: 49, partials: 18, slope: 1.1, inharm: 0.0004, atk: 0.004,
    decayPerSec: -9, partialDecay: 0.5, jitter: 5, noise: 0.03, dur: 2.2
  }), SR);
  ok('the physical bass reached PALLBEARER', rep.slip.target === 'PALLBEARER', 'got ' + rep.slip.target);
  ok('a PALLBEARER slip yields no NECROPHONE link', CR.necrophoneLink(rep.slip) === null);
})();

(function () {
  /* THE DELIBERATE SPLIT, pinned as a test so it cannot drift into being
     an accident. Two bodies at the same low pitch: one physical, one an
     oscillator. They must go to different instruments, because PALLBEARER
     models a plucked string and cannot produce a clean synthetic sub,
     while NECROPHONE's Revenant produces one directly. */
  var physical = tone({ f0: 49, partials: 18, inharm: 0.0004, atk: 0.004,
                        decayPerSec: -9, jitter: 5, noise: 0.03, dur: 2.2 });
  var synthSub = tone({ f0: 49, partials: 18, inharm: 0, atk: 0.004,
                        decayPerSec: -9, jitter: 0, noise: 0, dur: 2.2 });
  var sp = CR.autopsy(physical, SR).slip, ss = CR.autopsy(synthSub, SR).slip;
  ok('the physical low note goes to PALLBEARER', sp.target === 'PALLBEARER', 'got ' + sp.target);
  ok('the synthetic sub at the same pitch goes to NECROPHONE', ss.target === 'NECROPHONE', 'got ' + ss.target);
})();

(function () {
  var enc = CR._b64urlEncode('{"v":1,"p":{"a":1}}');
  ok('base64url uses no padding', enc.indexOf('=') < 0, enc);
  ok('base64url uses no plus or slash', enc.indexOf('+') < 0 && enc.indexOf('/') < 0, enc);
})();

// ===================================================================
// XI. DETERMINISM AND ROBUSTNESS
// ===================================================================
sec('XI. Determinism and robustness');

(function () {
  var body = tone({ f0: 220, noise: 0.15, dur: 1.8, seed: 606 });
  var a = CR.autopsy(body, SR), b = CR.autopsy(body, SR);
  var same = true;
  for (var i = 0; i < a.vector.length; i++) if (a.vector[i] !== b.vector[i]) same = false;
  /* Byte-for-byte, not "close". The analysis path has no randomness, so
     anything less than exact equality means something is reading a clock,
     a cache, or uninitialised memory. */
  ok('the same body twice yields a bit-identical vector', same);
  ok('and the same verdict', a.verdict.klass === b.verdict.klass);
})();

(function () {
  var silence = new Float64Array(SR);
  var rep = CR.autopsy(silence, SR);
  var nonFinite = 0;
  for (var i = 0; i < rep.vector.length; i++) if (!isFinite(rep.vector[i])) nonFinite++;
  ok('silence produces no NaN', nonFinite === 0, nonFinite + ' non-finite');
  ok('silence claims no pitch', rep.features.f0 === 0, 'f0=' + rep.features.f0);
  ok('and no confidence in a verdict', rep.verdict.confidence < 0.9);
})();

(function () {
  var tiny = new Float64Array(100);
  var rep = CR.autopsy(tiny, SR);
  ok('a body too short to examine says so rather than guessing', rep.tooShort === true);
  ok('and offers no routing slip', rep.slip === null);
})();

(function () {
  var d = new Dice(31), hostile = new Float64Array(SR);
  for (var i = 0; i < hostile.length; i++) hostile[i] = d.bi() * 1e6;   // wildly over full scale
  var rep = CR.autopsy(hostile, SR);
  var nonFinite = 0;
  for (i = 0; i < rep.vector.length; i++) if (!isFinite(rep.vector[i])) nonFinite++;
  ok('a signal 120 dB over full scale does not break the examination', nonFinite === 0);

  var dc = new Float64Array(SR);
  for (i = 0; i < dc.length; i++) dc[i] = 0.9;
  rep = CR.autopsy(dc, SR);
  nonFinite = 0;
  for (i = 0; i < rep.vector.length; i++) if (!isFinite(rep.vector[i])) nonFinite++;
  ok('pure DC does not break it either', nonFinite === 0);
})();

(function () {
  /* Sample rate must not change the verdict. The same note at 22.05k and
     44.1k is the same note, and a feature that drifts with rate is a
     feature measured in bins rather than in Hz. */
  function toneAt(sr) {
    var n = Math.floor(1.8 * sr), out = new Float64Array(n);
    for (var k = 1; k <= 12; k++) {
      for (var i = 0; i < n; i++) out[i] += (1 / k) * NM.sin(2 * Math.PI * 220 * k * i / sr);
    }
    var pk = 0;
    for (i = 0; i < n; i++) { var a = Math.abs(out[i]); if (a > pk) pk = a; }
    for (i = 0; i < n; i++) out[i] /= pk;
    return out;
  }
  var lo = CR.autopsy(toneAt(22050), 22050);
  var hi = CR.autopsy(toneAt(44100), 44100);
  ok('the verdict survives a sample-rate change', lo.verdict.klass === hi.verdict.klass,
     lo.verdict.klass + ' vs ' + hi.verdict.klass);
  var errC = Math.abs(CR._cents(lo.features.f0, hi.features.f0));
  ok('and so does the detected pitch', errC < 10, errC.toFixed(1) + ' cents apart');
})();

(function () {
  /* The swap point must actually be swappable. If setVerdictEngine cannot
     replace the classifier, then the whole "a neural verdict drops in
     later" argument is a comment rather than an architecture. */
  var called = null;
  CR.setVerdictEngine(function (f) {
    called = f;
    return { klass: 'voice', name: 'Voice', confidence: 0.99, scores: {}, evidence: [], engine: 'test-stub' };
  });
  var rep = CR.autopsy(tone({ f0: 220, dur: 1.6 }), SR);
  ok('a replacement verdict engine is actually used', rep.verdict.engine === 'test-stub');
  ok('and it was handed the real feature object', called && typeof called.f0 === 'number' && called.f0 > 0);
  ok('and routing still works downstream of it', rep.slip && rep.slip.target === 'NECROPHONE');
  CR.setVerdictEngine(null);
  var back = CR.autopsy(tone({ f0: 220, dur: 1.6 }), SR);
  ok('and the rule engine comes back when the swap is released', back.verdict.engine === 'rules-v1');
})();

// ===================================================================
// XII. WHAT THIS HARNESS CANNOT SEE
// ===================================================================
sec('XII. What this harness cannot see (stated, not tested)');

console.log([
  '  · A ROOM. Every body above is anechoic. Reverb smears the attack',
  '    measurement and raises the noise floor, and both feed the synthetic',
  '    tell directly — a dry synth in a hall may well read as acoustic.',
  '  · A MICROPHONE AND PREAMP. Real recordings carry hiss, proximity bass',
  '    and gentle saturation. noiseRatio in particular has never met any.',
  '  · A MIX BUS. Compression flattens crest and sustain; EQ moves centroid',
  '    and rolloff; limiting rewrites the envelope the routing slip reads.',
  '  · REAL INSTRUMENTS. A trumpet is not a sum of decaying sinusoids. The',
  '    classifier has been shown physics, not performances.',
  '  · POLYPHONY IN EARNEST. Two notes at once are barely tested and a full',
  '    mix is not tested at all. Separation has to come first and has not',
  '    been built.',
  '  These are the reasons the first real test is Ben feeding it his own',
  '  recordings, and why the verdict layer was built to be replaced.'
].join('\n'));

// ===================================================================
console.log('\n' + '='.repeat(66));
console.log('CORONER — ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' checks');
if (fail) {
  console.log('\nfailures:');
  failures.forEach(function (f) { console.log('  · ' + f); });
}
console.log('='.repeat(66));
process.exit(fail ? 1 : 0);
