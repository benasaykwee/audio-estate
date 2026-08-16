/* AUTOPSY core tests — node tests/autopsy_test.js */
'use strict';
var A = require('../autopsy_core.js');
var FS = 48000;
var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
function near(a, b, eps, name) { ok(Math.abs(a - b) <= eps, name + ' (' + a.toFixed(6) + ' ≈ ' + b + ')'); }

console.log('AUTOPSY core v' + A.VERSION + ' — examination begins');

/* --- 1. flat state is flat --- */
(function () {
  var s = A.defaultState();
  near(A.magnitudeAt(s, FS, 20), 0, 1e-9, 'flat @20');
  near(A.magnitudeAt(s, FS, 1000), 0, 1e-9, 'flat @1k');
  near(A.magnitudeAt(s, FS, 20000), 0, 1e-9, 'flat @20k');
})();

/* --- 2. bell reads its own gain at center --- */
(function () {
  var s = A.defaultState();
  s.bands[0] = { on: true, type: 'bell', freq: 1000, gain: 6, q: 1 };
  near(A.magnitudeAt(s, FS, 1000), 6, 1e-6, 'bell +6 @1k reads +6');
  s.bands[0].gain = -9.5;
  near(A.magnitudeAt(s, FS, 1000), -9.5, 1e-6, 'bell -9.5 reads -9.5');
})();

/* --- 3. shelves read their gain in the shelf region --- */
(function () {
  var s = A.defaultState();
  s.bands[0] = { on: true, type: 'lowshelf', freq: 200, gain: 6, q: 0.71 };
  near(A.magnitudeAt(s, FS, 15), 6, 0.05, 'lowshelf +6 deep below');
  near(A.magnitudeAt(s, FS, 20000), 0, 0.05, 'lowshelf flat far above');
  s.bands[0] = { on: true, type: 'highshelf', freq: 5000, gain: -6, q: 0.71 };
  near(A.magnitudeAt(s, FS, 22000), -6, 0.2, 'highshelf -6 far above');
  near(A.magnitudeAt(s, FS, 30), 0, 0.05, 'highshelf flat far below');
})();

/* --- 4. Butterworth cuts: -3.01 dB at cutoff, ~-12.3 dB one octave out --- */
(function () {
  var s = A.defaultState();
  s.bands[0] = { on: true, type: 'lowcut', freq: 100, gain: 0, q: 1 };
  near(A.magnitudeAt(s, FS, 100), -3.0103, 0.02, 'lowcut -3 dB at fc');
  // analog 2nd-order BW HP at fc/2: 20log10(1/sqrt(1+16)) = -12.304 (bilinear warp small at 100Hz/48k)
  near(A.magnitudeAt(s, FS, 50), -12.304, 0.1, 'lowcut ~-12.3 dB one octave down');
  s.bands[0] = { on: true, type: 'highcut', freq: 8000, gain: 0, q: 1 };
  near(A.magnitudeAt(s, FS, 8000), -3.0103, 0.05, 'highcut -3 dB at fc');
})();

/* --- 5. notch kills its center --- */
(function () {
  var s = A.defaultState();
  s.bands[0] = { on: true, type: 'notch', freq: 1000, gain: 0, q: 4 };
  ok(A.magnitudeAt(s, FS, 1000) < -60, 'notch deep at center');
  near(A.magnitudeAt(s, FS, 100), 0, 0.05, 'notch flat far away');
})();

/* --- 6. curve = sum of bands + output gain --- */
(function () {
  var s = A.defaultState();
  s.bands[0] = { on: true, type: 'bell', freq: 500, gain: 4, q: 2 };
  s.bands[1] = { on: true, type: 'bell', freq: 500, gain: 3, q: 2 };
  s.out.gain = 2;
  near(A.magnitudeAt(s, FS, 500), 9, 1e-6, 'two bells + out gain sum in dB');
})();

/* --- 7. engine: disabled bands pass audio untouched (unity, center pan) --- */
(function () {
  var e = A.createEngine(FS);
  e.setState(A.defaultState());
  var n = 4096;
  var noise = A.makeNoise(1234, n);
  var inL = new Float64Array(noise), inR = new Float64Array(noise);
  var outL = new Float64Array(n), outR = new Float64Array(n);
  e.process(inL, inR, outL, outR);
  var maxErr = 0;
  for (var i = 0; i < n; i++) maxErr = Math.max(maxErr, Math.abs(outL[i] - inL[i]), Math.abs(outR[i] - inR[i]));
  ok(maxErr < 1e-12, 'bypass neutrality (max err ' + maxErr.toExponential(2) + ')');
})();

/* --- 8. engine: rendered sine level matches magnitudeAt --- */
(function () {
  var s = A.defaultState();
  s.bands[0] = { on: true, type: 'bell', freq: 1000, gain: 6, q: 1 };
  var e = A.createEngine(FS);
  e.setState(s);
  var n = FS; // 1 s
  var inL = new Float64Array(n), inR = new Float64Array(n);
  for (var i = 0; i < n; i++) inL[i] = inR[i] = Math.sin(2 * Math.PI * 1000 * i / FS);
  var outL = new Float64Array(n), outR = new Float64Array(n);
  e.process(inL, inR, outL, outR);
  // RMS of last half (past smoothing settle)
  var sum = 0, cnt = 0;
  for (i = n / 2; i < n; i++) { sum += outL[i] * outL[i]; cnt++; }
  var db = 20 * Math.log10(Math.sqrt(sum / cnt) / Math.SQRT1_2);
  near(db, A.magnitudeAt(s, FS, 1000), 0.05, 'rendered sine matches analytic curve');
})();

/* --- 9. engine stability: extreme settings produce finite output --- */
(function () {
  var s = A.defaultState();
  for (var k = 0; k < A.MAX_BANDS; k++) {
    s.bands[k] = { on: true, type: A.TYPES[k % A.TYPES.length],
                   freq: 20 + k * 1800, gain: (k % 2 ? 30 : -30), q: (k % 3 ? 40 : 0.05) };
  }
  s.out.gain = 12; s.out.pan = -1;
  var e = A.createEngine(FS);
  e.setState(s);
  var n = 8192;
  var noise = A.makeNoise(99, n);
  var outL = new Float64Array(n), outR = new Float64Array(n);
  e.process(noise, noise, outL, outR);
  var finite = true;
  for (var i = 0; i < n; i++) if (!isFinite(outL[i]) || !isFinite(outR[i])) { finite = false; break; }
  ok(finite, 'all 12 bands at extremes: output finite');
  ok(Math.abs(outR[n - 1]) < 1e-9 || Math.max.apply(null, Array.prototype.slice.call(outR.slice(-64)).map(Math.abs)) < 1e-6, 'hard-left pan silences right');
})();

/* --- 9b. variable-slope cuts: Butterworth all the way down --- */
(function () {
  function cutAt(slope, probe) {
    var s = A.defaultState();
    s.bands[0] = { on: true, type: 'lowcut', freq: 200, gain: 0, q: 1, slope: slope, place: 'st' };
    return A.magnitudeAt(s, FS, probe);
  }
  near(cutAt(6, 200), -3.0103, 0.03, 'slope 6: -3 dB at fc');
  near(cutAt(6, 100), -6.99, 0.1, 'slope 6: ~-7 dB one octave down');
  near(cutAt(24, 200), -3.0103, 0.03, 'slope 24: -3 dB at fc');
  near(cutAt(24, 100), -24.1, 0.2, 'slope 24: ~-24 dB one octave down');
  near(cutAt(48, 200), -3.0103, 0.03, 'slope 48: -3 dB at fc');
  near(cutAt(48, 100), -48.16, 0.4, 'slope 48: ~-48 dB one octave down');
  near(cutAt(18, 200), -3.0103, 0.03, 'slope 18 (odd order): -3 dB at fc');
  near(cutAt(18, 100), -18.13, 0.2, 'slope 18: ~-18 dB one octave down');
})();

/* --- 9c. tilt: complementary shelves --- */
(function () {
  var s = A.defaultState();
  s.bands[0] = { on: true, type: 'tilt', freq: 1000, gain: 6, q: 0.71, slope: 12, place: 'st' };
  near(A.magnitudeAt(s, FS, 20000), 3, 0.1, 'tilt +6: +3 far above');
  near(A.magnitudeAt(s, FS, 20), -3, 0.1, 'tilt +6: -3 far below');
  near(A.magnitudeAt(s, FS, 1000), 0, 0.15, 'tilt: ~0 at pivot');
})();

/* --- 9d. bandpass: 0 dB peak, falls both ways --- */
(function () {
  var s = A.defaultState();
  s.bands[0] = { on: true, type: 'bandpass', freq: 1000, gain: 0, q: 2, slope: 12, place: 'st' };
  near(A.magnitudeAt(s, FS, 1000), 0, 0.01, 'bandpass 0 dB at center');
  ok(A.magnitudeAt(s, FS, 100) < -20, 'bandpass falls below');
  ok(A.magnitudeAt(s, FS, 10000) < -20, 'bandpass falls above');
})();

/* --- 9e. placement algebra (exact, on rendered audio) --- */
(function () {
  function render(place, mkIn) {
    var s = A.defaultState();
    s.bands[0] = { on: true, type: 'bell', freq: 800, gain: 6, q: 1.5, slope: 12, place: place };
    var e = A.createEngine(FS);
    e.setState(s);
    var n = 4096;
    var io = mkIn(n);
    var outL = new Float64Array(n), outR = new Float64Array(n);
    e.process(io.L, io.R, outL, outR);
    return { L: outL, R: outR };
  }
  function mono(n) {
    var x = A.makeNoise(777, n);
    return { L: new Float64Array(x), R: new Float64Array(x) };
  }
  function stereoDiff(n) {
    var x = A.makeNoise(777, n), y = A.makeNoise(888, n);
    return { L: new Float64Array(x), R: new Float64Array(y) };
  }
  var st = render('st', mono), m = render('m', mono), sSolo = render('s', mono);
  var maxE = 0, i;
  for (i = 0; i < st.L.length; i++) maxE = Math.max(maxE, Math.abs(st.L[i] - m.L[i]), Math.abs(st.R[i] - m.R[i]));
  ok(maxE === 0, 'mid band on mono signal == stereo band (bit-exact, err ' + maxE + ')');
  var inMono = mono(4096);
  maxE = 0;
  for (i = 0; i < sSolo.L.length; i++) maxE = Math.max(maxE, Math.abs(sSolo.L[i] - inMono.L[i]));
  ok(maxE === 0, 'side band on mono signal is a perfect passthrough');
  var lOnly = render('l', stereoDiff);
  var ref = stereoDiff(4096);
  var rTouched = 0;
  for (i = 0; i < lOnly.R.length; i++) rTouched = Math.max(rTouched, Math.abs(lOnly.R[i] - ref.R[i]));
  /* output stage multiplies by cos(pi/4)*sqrt(2) ~ 1 within 1 ulp, so
     "untouched" means unity-gain-rounding, not bitwise input */
  ok(rTouched < 1e-12, 'left-placed band leaves the right channel untouched (err ' + rTouched.toExponential(2) + ')');
  var lChanged = 0;
  for (i = 0; i < lOnly.L.length; i++) lChanged = Math.max(lChanged, Math.abs(lOnly.L[i] - ref.L[i]));
  ok(lChanged > 1e-4, 'left-placed band actually filters the left channel');
})();

/* --- 9f. twelve slope-48 bands at extremes: still finite --- */
(function () {
  var s = A.defaultState();
  for (var k = 0; k < A.MAX_BANDS; k++) {
    s.bands[k] = { on: true, type: k % 2 ? 'lowcut' : 'highcut',
                   freq: 30 + k * 1500, gain: 0, q: 1, slope: 48,
                   place: A.PLACES[k % A.PLACES.length] };
  }
  var e = A.createEngine(FS);
  e.setState(s);
  var n = 8192;
  var noise = A.makeNoise(31337, n);
  var outL = new Float64Array(n), outR = new Float64Array(n);
  e.process(noise, noise, outL, outR);
  var finite = true;
  for (var i = 0; i < n; i++) if (!isFinite(outL[i]) || !isFinite(outR[i])) { finite = false; break; }
  ok(finite, '12 x slope-48 cascades with mixed placement: finite');
})();

/* --- 9g. dynamic EQ --- */
(function () {
  function dynState(range, thresh) {
    var s = A.defaultState();
    s.bands[0] = { on: true, type: 'bell', freq: 1000, gain: 0, q: 1.5, slope: 12, place: 'st',
                   dyn: { on: true, range: range, thresh: thresh, att: 5, rel: 80 } };
    return s;
  }
  function staticState() {
    var s = A.defaultState();
    s.bands[0] = { on: true, type: 'bell', freq: 1000, gain: 0, q: 1.5, slope: 12, place: 'st' };
    return s;
  }
  function sine(n, amp) {
    var x = new Float64Array(n);
    for (var i = 0; i < n; i++) x[i] = amp * Math.sin(2 * Math.PI * 1000 * i / FS);
    return x;
  }
  function run(state, input) {
    var e = A.createEngine(FS);
    e.setState(state);
    var outL = new Float64Array(input.length), outR = new Float64Array(input.length);
    e.process(input, input, outL, outR);
    return { out: outL, gr: e.dynGains() };
  }
  var n = FS / 2;

  /* below threshold: dyn engaged but silent — output must be bit-exact static */
  var quiet = sine(n, 0.001); // -60 dBFS, thresh -30
  var dq = run(dynState(-12, -30), quiet), sq = run(staticState(), quiet);
  var maxE = 0;
  for (var i = 0; i < n; i++) maxE = Math.max(maxE, Math.abs(dq.out[i] - sq.out[i]));
  ok(maxE === 0, 'below threshold: dynamic == static, bit-exact');

  /* loud signal at band freq pulls gain toward negative range */
  var loud = sine(n, 0.9);
  var dl = run(dynState(-12, -30), loud);
  ok(dl.gr[0] < -6, 'loud input engages reduction (gr ' + dl.gr[0].toFixed(2) + ' dB)');
  var dm = run(dynState(-12, -30), sine(n, 0.09)); // 20 dB quieter
  ok(dm.gr[0] < 0 && dm.gr[0] > dl.gr[0], 'reduction is monotonic with level (' +
     dm.gr[0].toFixed(2) + ' vs ' + dl.gr[0].toFixed(2) + ')');

  /* upward range works too */
  var up = run(dynState(9, -30), loud);
  ok(up.gr[0] > 4, 'positive range pushes gain up (gr ' + up.gr[0].toFixed(2) + ')');

  /* gainless types ignore dyn entirely */
  var s2 = A.defaultState();
  s2.bands[0] = { on: true, type: 'lowcut', freq: 100, gain: 0, q: 1, slope: 24, place: 'st',
                  dyn: { on: true, range: -12, thresh: -60, att: 5, rel: 80 } };
  var cut = run(A.sanitizeState(s2), loud);
  ok(cut.gr[0] === 0, 'lowcut ignores dynamics');

  /* sanitize: dyn clamps, and thresh 0 is legal */
  var s3 = A.sanitizeState({ bands: [{ on: true, type: 'bell', freq: 1000, gain: 0, q: 1,
    dyn: { on: true, range: 99, thresh: 0, att: -5, rel: 1e9 } }] });
  ok(s3.bands[0].dyn.range === 24, 'dyn range clamped');
  ok(s3.bands[0].dyn.thresh === 0, 'thresh 0 dB survives sanitize');
  ok(s3.bands[0].dyn.att === 0.1 && s3.bands[0].dyn.rel === 2000, 'att/rel clamped');
})();

/* --- 9h. host buffer size must not change the sound (Interchange §7) ---
   Every multiple of 32 always agreed; primes and DAW-reality sizes like 441
   diverged up to -16.9 dBFS during a glide before ctrlPhase was carried
   across calls. This test renders a 12 dB glide in seventeen chunkings and
   demands bit-identity with the single-call render. */
(function () {
  var N = 4800, SW = 480;
  function glideRender(chunk) {
    var e = A.createEngine(FS);
    var s0 = A.defaultState();
    s0.bands[0] = { on: true, type: 'bell', freq: 1000, gain: 0, q: 2, slope: 12, place: 'st' };
    e.setState(s0);
    var s1 = JSON.parse(JSON.stringify(s0));
    s1.bands[0].gain = 12;
    var noise = A.makeNoise(4242, N);
    var outL = new Float64Array(N), outR = new Float64Array(N);
    var pos = 0;
    while (pos < N) {
      if (pos === SW) e.setState(s1);
      var lim = pos < SW ? SW : N;
      var n = Math.min(chunk, lim - pos);
      e.process(noise.subarray(pos, pos + n), noise.subarray(pos, pos + n),
                outL.subarray(pos, pos + n), outR.subarray(pos, pos + n));
      pos += n;
    }
    return outL;
  }
  var ref = glideRender(N);
  var sizes = [32, 64, 128, 512, 1024, 2048, 480, 7, 13, 31, 97, 111, 127, 240, 333, 441, 1000];
  var worst = 0, worstSz = 0;
  sizes.forEach(function (c) {
    var out = glideRender(c);
    for (var i = 0; i < N; i++) {
      var d = Math.abs(out[i] - ref[i]);
      if (d > worst) { worst = d; worstSz = c; }
    }
  });
  ok(worst === 0, 'seventeen buffer sizes incl. primes render bit-identically' +
     (worst ? ' (WORST ' + worst.toExponential(2) + ' at chunk ' + worstSz + ')' : ''));
})();

/* --- 9i. the latency promise (Interchange §6.4) ---
   AUTOPSY reports zero latency (minimum-phase IIR, no lookahead, no
   oversampling in the audio path). CASKET's bypass bug taught the suite that
   reported latency is a promise about EVERY state. Here: an impulse must
   exit at sample 0 in a flat state, a working state, and with every band
   engaged — if energy ever arrives late, the zero-latency claim is a lie. */
(function () {
  function impulsePos(stateFn) {
    var e = A.createEngine(FS);
    e.setState(stateFn());
    var n = 256;
    var inp = new Float64Array(n); inp[0] = 1;
    var outL = new Float64Array(n), outR = new Float64Array(n);
    e.process(inp, inp, outL, outR);
    for (var i = 0; i < n; i++) if (Math.abs(outL[i]) > 1e-12) return i;
    return -1;
  }
  ok(impulsePos(A.defaultState) === 0, 'flat state: impulse exits at sample 0');
  ok(impulsePos(function () {
    var s = A.defaultState();
    s.bands[0] = { on: true, type: 'bell', freq: 1000, gain: 6, q: 2, slope: 12, place: 'st' };
    s.bands[1] = { on: true, type: 'lowcut', freq: 40, gain: 0, q: 1, slope: 48, place: 'st' };
    return s;
  }) === 0, 'working state: impulse exits at sample 0');
  ok(impulsePos(function () {
    var s = A.defaultState();
    for (var k = 0; k < A.MAX_BANDS; k++) {
      s.bands[k] = { on: true, type: A.TYPES[k % A.TYPES.length],
                     freq: 50 + k * 900, gain: 3, q: 1, slope: 48,
                     place: A.PLACES[k % A.PLACES.length] };
    }
    return s;
  }) === 0, 'all 12 bands, every placement: impulse still exits at sample 0');
})();

/* --- 9j. denormal stress: silence after a burst must not go subnormal ---
   Measured before the dn() guard: 178,519 subnormal output samples starting
   9.46 s into a silent tail, decaying to 4.94e-324. The worklet has no FTZ
   control, so those are real microcode-assisted operations on stage. */
(function () {
  var s = A.defaultState();
  for (var k = 0; k < 12; k++) {
    s.bands[k] = { on: true, type: k % 2 ? 'bell' : 'lowcut', freq: 60 + k * 800,
                   gain: k % 2 ? -18 : 0, q: 8, slope: 48, place: 'st',
                   dyn: { on: k % 2 === 1, range: -12, thresh: -40, att: 5, rel: 500 } };
  }
  var e = A.createEngine(FS);
  e.setState(s);
  var N = FS * 12;
  var x = new Float64Array(N);
  var nz = A.makeNoise(123, FS / 2);
  for (var i = 0; i < FS / 2; i++) x[i] = nz[i];
  var oL = new Float64Array(N), oR = new Float64Array(N);
  e.process(x, x, oL, oR);
  var sub = 0;
  var TINY = 2.2250738585072014e-308;
  for (i = FS; i < N; i++) {
    var vL = Math.abs(oL[i]), vR = Math.abs(oR[i]);
    if ((vL > 0 && vL < TINY) || (vR > 0 && vR < TINY)) sub++;
  }
  ok(sub === 0, '12 s silent tail through 12 heavy bands: zero subnormal outputs (was 178,519)');
})();

/* --- 9k. nothing assumes 48 k: the analytics hold at five rates --- */
(function () {
  [44100, 88200, 96000, 192000].forEach(function (fs) {
    var s = A.defaultState();
    s.bands[0] = { on: true, type: 'bell', freq: 1000, gain: 6, q: 1, slope: 12, place: 'st' };
    near(A.magnitudeAt(s, fs, 1000), 6, 1e-6, 'bell +6 reads +6 at ' + fs + ' Hz');
    s.bands[0] = { on: true, type: 'lowcut', freq: 100, gain: 0, q: 1, slope: 24, place: 'st' };
    near(A.magnitudeAt(s, fs, 100), -3.0103, 0.03, 'slope-24 cut is -3 dB at fc at ' + fs + ' Hz');
  });
  /* and the engine agrees with the analytics away from 48 k */
  var fs2 = 44100;
  var s2 = A.defaultState();
  s2.bands[0] = { on: true, type: 'bell', freq: 1000, gain: 6, q: 1, slope: 12, place: 'st' };
  var e2 = A.createEngine(fs2);
  e2.setState(s2);
  var n2 = fs2;
  var in2 = new Float64Array(n2);
  for (var i2 = 0; i2 < n2; i2++) in2[i2] = Math.sin(2 * Math.PI * 1000 * i2 / fs2);
  var o2L = new Float64Array(n2), o2R = new Float64Array(n2);
  e2.process(in2, in2, o2L, o2R);
  var sum2 = 0, c2 = 0;
  for (i2 = n2 / 2; i2 < n2; i2++) { sum2 += o2L[i2] * o2L[i2]; c2++; }
  var db2 = 20 * Math.log10(Math.sqrt(sum2 / c2) / Math.SQRT1_2);
  near(db2, A.magnitudeAt(s2, fs2, 1000), 0.05, 'rendered sine matches analytic curve at 44.1 k');
})();

/* --- 10. necromath accuracy vs native libm (consistency is the goal,
       but it must also be *correct* to ~1e-13) --- */
(function () {
  var nm = A._nm;
  var worst = 0;
  for (var i = 0; i <= 400; i++) {
    var x = i / 400 * 6.28; // sin/cos domain used by the core
    worst = Math.max(worst,
      Math.abs(nm.sin(x) - Math.sin(x)),
      Math.abs(nm.cos(x) - Math.cos(x)));
  }
  ok(worst < 1e-13, 'nm sin/cos within 1e-13 of libm (worst ' + worst.toExponential(2) + ')');
  worst = 0;
  for (i = 1; i <= 300; i++) {
    var v = i * 100; // 100..30000 (freq domain)
    worst = Math.max(worst, Math.abs(nm.log(v) - Math.log(v)) / Math.abs(Math.log(v)));
  }
  ok(worst < 1e-14, 'nm log rel err < 1e-14 (worst ' + worst.toExponential(2) + ')');
  worst = 0;
  for (i = -30; i <= 30; i++) {
    var p = i / 10; // pow10 domain ±3
    worst = Math.max(worst, Math.abs(nm.pow10(p) - Math.pow(10, p)) / Math.pow(10, p));
  }
  ok(worst < 1e-14, 'nm pow10 rel err < 1e-14 (worst ' + worst.toExponential(2) + ')');
})();

/* --- 11. sanitizeState rejects garbage --- */
(function () {
  var s = A.sanitizeState({ bands: [{ on: true, type: 'voodoo', freq: -5, gain: 999, q: 0, slope: 7, place: 'x' }] });
  ok(s.bands[0].type === 'bell', 'unknown type → bell');
  ok(s.bands[0].freq >= 10, 'freq clamped up');
  ok(s.bands[0].gain <= 30, 'gain clamped');
  ok(s.bands[0].q >= 0.05, 'q clamped');
  ok(s.bands[0].slope === 12, 'illegal slope → 12');
  ok(s.bands[0].place === 'st', 'illegal placement → stereo');
  var d = A.sanitizeState(null);
  ok(d.bands.length === A.MAX_BANDS, 'null → default state');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
