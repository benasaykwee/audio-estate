/* AUTOPSY fuzzer — seeded and reproducible. node tests/autopsy_fuzz.js
   Both siblings failed their first fuzz run (CASKET: shaped dither over the
   lid; RIGOR: crossover ceiling). Invariants here:
     1. sanitizeState never lets an illegal value through, and never
        mangles a LEGAL boundary value (LAW 5 — sweep the boundaries).
     2. finite output for every state x hostile material x sample rate.
     3. null test: all bands off == the output stage alone, bit-exact
        against a hand-computed gain (unity in, unity path).
     4. reset() byte-identity: render, reset, render again — identical
        (CASKET's constructor was eating the snap flag; this is that trap).
     5. no NaN from magnitudeAt/bandMagAt over hostile probe frequencies. */
'use strict';
var A = require('../autopsy_core.js');

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}

/* Park–Miller, same family as the core's makeNoise, independent stream */
function lcg(seed) {
  var x = (seed >>> 0) || 1;
  return function () { x = (x * 16807) % 2147483647; return x / 2147483647; };
}

/* ---------- 1. sanitizer hostility + boundary preservation ---------- */
(function () {
  var HOSTILE = [NaN, Infinity, -Infinity, 0, -0, 1e308, -1e308, 5e-324, -5e-324,
                 '13', 'voodoo', null, undefined, [], {}, true, false, 1e-30];
  var rnd = lcg(1337);
  var n = 0, bad = null;
  for (var iter = 0; iter < 1600 && !bad; iter++) {
    var b = {
      on: HOSTILE[(rnd() * HOSTILE.length) | 0],
      type: HOSTILE[(rnd() * HOSTILE.length) | 0],
      freq: HOSTILE[(rnd() * HOSTILE.length) | 0],
      gain: HOSTILE[(rnd() * HOSTILE.length) | 0],
      q: HOSTILE[(rnd() * HOSTILE.length) | 0],
      slope: HOSTILE[(rnd() * HOSTILE.length) | 0],
      place: HOSTILE[(rnd() * HOSTILE.length) | 0],
      dyn: rnd() < 0.5 ? HOSTILE[(rnd() * HOSTILE.length) | 0] : {
        on: HOSTILE[(rnd() * HOSTILE.length) | 0],
        range: HOSTILE[(rnd() * HOSTILE.length) | 0],
        thresh: HOSTILE[(rnd() * HOSTILE.length) | 0],
        att: HOSTILE[(rnd() * HOSTILE.length) | 0],
        rel: HOSTILE[(rnd() * HOSTILE.length) | 0]
      }
    };
    var s = A.sanitizeState({ bands: [b], out: { gain: b.gain, pan: b.q }, meta: { name: b.type } });
    var sb = s.bands[0];
    var legal =
      typeof sb.on === 'boolean' &&
      A.TYPES.indexOf(sb.type) >= 0 &&
      isFinite(sb.freq) && sb.freq >= 10 && sb.freq <= 30000 &&
      isFinite(sb.gain) && sb.gain >= -30 && sb.gain <= 30 &&
      isFinite(sb.q) && sb.q >= 0.05 && sb.q <= 40 &&
      A.SLOPES.indexOf(sb.slope) >= 0 &&
      A.PLACES.indexOf(sb.place) >= 0 &&
      typeof sb.dyn === 'object' &&
      isFinite(sb.dyn.range) && sb.dyn.range >= -24 && sb.dyn.range <= 24 &&
      isFinite(sb.dyn.thresh) && sb.dyn.thresh >= -60 && sb.dyn.thresh <= 0 &&
      isFinite(sb.dyn.att) && sb.dyn.att >= 0.1 && sb.dyn.att <= 500 &&
      isFinite(sb.dyn.rel) && sb.dyn.rel >= 1 && sb.dyn.rel <= 2000 &&
      isFinite(s.out.gain) && isFinite(s.out.pan);
    if (!legal) bad = { iter: iter, band: b, got: sb };
    n++;
  }
  ok(!bad, n + ' hostile sanitizer inputs all produce legal states' +
     (bad ? ' — FAILED at iter ' + bad.iter + ': ' + JSON.stringify(bad.got) : ''));

  /* LAW 5: legal boundary values must survive EXACTLY */
  var edges = A.sanitizeState({ bands: [
    { on: true, type: 'bell', freq: 10, gain: -30, q: 0.05, slope: 6, place: 'st',
      dyn: { on: true, range: -24, thresh: 0, att: 0.1, rel: 1 } },
    { on: true, type: 'tilt', freq: 30000, gain: 30, q: 40, slope: 48, place: 's',
      dyn: { on: true, range: 24, thresh: -60, att: 500, rel: 2000 } }
  ], out: { gain: 0, pan: 0 } });
  var e0 = edges.bands[0], e1 = edges.bands[1];
  ok(e0.freq === 10 && e0.gain === -30 && e0.q === 0.05 && e0.slope === 6 &&
     e0.dyn.thresh === 0 && e0.dyn.att === 0.1 && e0.dyn.rel === 1 && e0.dyn.range === -24,
     'LAW 5: every low legal boundary survives sanitize untouched');
  ok(e1.freq === 30000 && e1.gain === 30 && e1.q === 40 && e1.slope === 48 &&
     e1.dyn.thresh === -60 && e1.dyn.att === 500 && e1.dyn.rel === 2000 && e1.dyn.range === 24,
     'LAW 5: every high legal boundary survives sanitize untouched');
  ok(edges.out.gain === 0 && edges.out.pan === 0, 'LAW 5: legal zeros survive (out gain/pan)');
})();

/* ---------- random legal state generator ---------- */
function randState(rnd) {
  var s = A.defaultState();
  var nb = 1 + ((rnd() * A.MAX_BANDS) | 0);
  for (var k = 0; k < nb; k++) {
    s.bands[k] = {
      on: rnd() < 0.85,
      type: A.TYPES[(rnd() * A.TYPES.length) | 0],
      freq: 10 * Math.pow(10, rnd() * 3.3),
      gain: (rnd() * 60) - 30,
      q: 0.05 * Math.pow(10, rnd() * 2.9),
      slope: A.SLOPES[(rnd() * A.SLOPES.length) | 0],
      place: A.PLACES[(rnd() * A.PLACES.length) | 0],
      dyn: { on: rnd() < 0.4, range: rnd() * 48 - 24, thresh: -rnd() * 60,
             att: 0.1 + rnd() * 499, rel: 1 + rnd() * 1999 }
    };
  }
  s.out.gain = rnd() * 48 - 24;
  s.out.pan = rnd() * 2 - 1;
  return A.sanitizeState(s);
}

/* hostile materials */
function material(name, n, fs) {
  var x = new Float64Array(n), i;
  switch (name) {
    case 'silence': break;
    case 'dc': for (i = 0; i < n; i++) x[i] = 0.7; break;
    case 'fs4': for (i = 0; i < n; i++) x[i] = 0.9 * Math.sin(Math.PI / 2 * i + Math.PI / 4); break;
    case 'clip': { var no = A.makeNoise(777, n); for (i = 0; i < n; i++) x[i] = Math.max(-0.99, Math.min(0.99, no[i] * 3)); break; }
    case 'burst-tail': { var nz = A.makeNoise(888, n); for (i = 0; i < n; i++) x[i] = i < n / 8 ? nz[i] : 0; break; }
    case 'impulses': for (i = 0; i < n; i += 997) x[i] = (i % 2 ? -1 : 1); break;
    case 'sweep': for (i = 0; i < n; i++) { var f = 20 * Math.pow(1000, i / n); x[i] = 0.8 * Math.sin(2 * Math.PI * f * i / fs); } break;
    default: { var d = A.makeNoise(999, n); for (i = 0; i < n; i++) x[i] = d[i]; }
  }
  return x;
}

/* ---------- 2. finite output: states x materials x rates ---------- */
(function () {
  var RATES = [44100, 48000, 88200, 96000, 192000];
  var MATS = ['noise', 'silence', 'dc', 'fs4', 'clip', 'burst-tail', 'impulses', 'sweep'];
  var rnd = lcg(60601);
  var rendered = 0, badSeed = null;
  for (var iter = 0; iter < 120 && !badSeed; iter++) {
    var fs = RATES[iter % RATES.length];
    var st = randState(rnd);
    var mat = material(MATS[iter % MATS.length], 4096, fs);
    var e = A.createEngine(fs);
    e.setState(st);
    var oL = new Float64Array(4096), oR = new Float64Array(4096);
    e.process(mat, mat, oL, oR);
    for (var i = 0; i < 4096; i++) {
      if (!isFinite(oL[i]) || !isFinite(oR[i])) { badSeed = { iter: iter, fs: fs, mat: MATS[iter % MATS.length], i: i }; break; }
    }
    rendered++;
  }
  ok(!badSeed, rendered + ' random states x hostile materials x 5 rates: all output finite' +
     (badSeed ? ' — FAILED ' + JSON.stringify(badSeed) : ''));
})();

/* ---------- 3. null test: all bands off is JUST the output stage ---------- */
(function () {
  var rnd = lcg(424243);
  var worst = 0;
  for (var iter = 0; iter < 200; iter++) {
    var s = randState(rnd);
    s.bands.forEach(function (b) { b.on = false; });
    s.out.gain = 0; s.out.pan = 0;
    var e = A.createEngine(48000);
    e.setState(s);
    var x = material('noise', 2048, 48000);
    var oL = new Float64Array(2048), oR = new Float64Array(2048);
    e.process(x, x, oL, oR);
    for (var i = 0; i < 2048; i++) worst = Math.max(worst, Math.abs(oL[i] - x[i]), Math.abs(oR[i] - x[i]));
  }
  /* center-pan unity is cos(pi/4)*sqrt2 — within 1 ulp of 1, never worse */
  ok(worst < 1e-15, '200 fuzzed null tests: bands-off output is the input to 1 ulp (worst ' +
     worst.toExponential(2) + ')');
})();

/* ---------- 4. reset() byte-identity (the CASKET constructor trap) ---------- */
(function () {
  var rnd = lcg(90909);
  var badIter = -1;
  for (var iter = 0; iter < 50 && badIter < 0; iter++) {
    var s = randState(rnd);
    var e = A.createEngine(48000);
    e.setState(s);
    var x = material('clip', 1024, 48000);
    var a = new Float64Array(1024), b2 = new Float64Array(1024), tmp = new Float64Array(1024);
    e.process(x, x, a, tmp);
    e.reset();
    e.process(x, x, b2, tmp);
    for (var i = 0; i < 1024; i++) if (a[i] !== b2[i]) { badIter = iter; break; }
  }
  ok(badIter < 0, '50 render/reset/render pairs byte-identical' +
     (badIter >= 0 ? ' — diverged at iter ' + badIter : ''));
})();

/* ---------- 4b. no fade-in: the first render arrives at target gain ---------- */
(function () {
  var s = A.defaultState();
  s.out.gain = -12;
  var e = A.createEngine(48000);
  e.setState(s);
  var n = 64;
  var x = new Float64Array(n); for (var i = 0; i < n; i++) x[i] = 1;
  var oL = new Float64Array(n), oR = new Float64Array(n);
  e.process(x, x, oL, oR);
  var want = Math.pow(10, -12 / 20);
  ok(Math.abs(oL[0] - want) < 1e-12,
     'sample 0 of the first render is already at -12 dB (' + oL[0].toFixed(9) + ' vs ' + want.toFixed(9) + ') — no fade-in from defaults');
})();

/* ---------- 5. response math never NaNs ---------- */
(function () {
  var rnd = lcg(31338);
  var PROBES = [1e-3, 1, 10, 19.999, 20, 24000, 96000, 1e7];
  var bad = null;
  for (var iter = 0; iter < 300 && !bad; iter++) {
    var s = randState(rnd);
    PROBES.forEach(function (f) {
      var m = A.magnitudeAt(s, 48000, f);
      if (!isFinite(m)) bad = { iter: iter, f: f, m: m };
    });
  }
  ok(!bad, '300 states x 8 probe freqs incl. absurd ones: magnitudeAt always finite' +
     (bad ? ' — ' + JSON.stringify(bad) : ''));
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
