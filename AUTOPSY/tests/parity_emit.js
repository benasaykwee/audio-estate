/* AUTOPSY parity emitter — writes tests/parity_expected.h
   Truth values from the JS core, as C++ double literals via
   toExponential(17). Run: node tests/parity_emit.js */
'use strict';
var fs = require('fs');
var path = require('path');
var A = require('../autopsy_core.js');

var FS = 48000, N = 4800, STRIDE = 7;

function lit(x) {
  if (!isFinite(x)) throw new Error('non-finite value in parity data');
  return x.toExponential(17);
}

/* --- coefficient table ---
   every type x 5 settings, plus both cut types x all 6 slopes.
   Each case emits n + MAX_SECTIONS padded sections (identity pad). */
var SETTINGS = [[100, 6, 0.71], [1000, -9.5, 1.0], [3200, 2.5, 2.8], [12000, 12, 8], [40, -18, 0.4]];
var COEFF_CASES = [];
A.TYPES.forEach(function (t) {
  SETTINGS.forEach(function (c) {
    COEFF_CASES.push({ type: t, freq: c[0], gain: c[1], q: c[2], slope: 12 });
  });
});
A.SLOPES.forEach(function (sl) {
  COEFF_CASES.push({ type: 'lowcut', freq: 150, gain: 0, q: 1, slope: sl });
  COEFF_CASES.push({ type: 'highcut', freq: 6000, gain: 0, q: 1, slope: sl });
});

var coeffVals = [], coeffNs = [];
var IDENT = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
COEFF_CASES.forEach(function (c) {
  var secs = A.designBand(c, FS);
  coeffNs.push(secs.length);
  for (var i = 0; i < A.MAX_SECTIONS; i++) {
    var k = i < secs.length ? secs[i] : IDENT;
    coeffVals.push(k.b0, k.b1, k.b2, k.a1, k.a2);
  }
});

/* --- states --- */
function surgical() {
  var s = A.defaultState();
  s.bands[0] = { on: true, type: 'lowcut', freq: 80, gain: 0, q: 1, slope: 12, place: 'st' };
  s.bands[1] = { on: true, type: 'bell', freq: 240, gain: -3.5, q: 2.2, slope: 12, place: 'st' };
  s.bands[2] = { on: true, type: 'bell', freq: 3200, gain: 2.5, q: 1.4, slope: 12, place: 'st' };
  s.bands[3] = { on: true, type: 'highshelf', freq: 9000, gain: 1.5, q: 0.71, slope: 12, place: 'st' };
  s.out.gain = -1.5; s.out.pan = 0.25;
  return s;
}
function placed() {
  var s = A.defaultState();
  s.bands[0] = { on: true, type: 'lowcut', freq: 100, gain: 0, q: 1, slope: 36, place: 'st' };
  s.bands[1] = { on: true, type: 'bell', freq: 500, gain: 4, q: 1.8, slope: 12, place: 'm' };
  s.bands[2] = { on: true, type: 'highshelf', freq: 8000, gain: -3, q: 0.71, slope: 12, place: 's' };
  s.bands[3] = { on: true, type: 'bell', freq: 1200, gain: 2, q: 2.5, slope: 12, place: 'l' };
  s.bands[4] = { on: true, type: 'notch', freq: 2000, gain: 0, q: 6, slope: 12, place: 'r' };
  s.bands[5] = { on: true, type: 'tilt', freq: 700, gain: 3, q: 0.71, slope: 12, place: 'st' };
  s.bands[6] = { on: true, type: 'bandpass', freq: 1000, gain: 0, q: 2, slope: 12, place: 'st' };
  s.bands[7] = { on: true, type: 'highcut', freq: 15000, gain: 0, q: 1, slope: 48, place: 'st' };
  s.out.gain = 1.0; s.out.pan = -0.3;
  return s;
}

/* --- magnitude probes on both states --- */
var MAG_FREQS = [20, 55, 80, 240, 700, 1000, 3200, 9000, 15000, 20000];
var magVals = [];
MAG_FREQS.forEach(function (f) { magVals.push(A.magnitudeAt(surgical(), FS, f)); });
MAG_FREQS.forEach(function (f) { magVals.push(A.magnitudeAt(placed(), FS, f)); });

function dynamic() {
  var s = A.defaultState();
  s.bands[0] = { on: true, type: 'bell', freq: 1000, gain: 0, q: 1.5, slope: 12, place: 'st',
                 dyn: { on: true, range: -12, thresh: -30, att: 5, rel: 80 } };
  s.bands[1] = { on: true, type: 'highshelf', freq: 8000, gain: 2, q: 0.71, slope: 12, place: 'st',
                 dyn: { on: true, range: 6, thresh: -36, att: 20, rel: 200 } };
  s.bands[2] = { on: true, type: 'lowcut', freq: 60, gain: 0, q: 1, slope: 24, place: 'st' };
  s.out.gain = -1.0; s.out.pan = 0.1;
  return s;
}

/* --- rendered engine output --- */
function renderCase(stateFn, seedL, seedR, fs) {
  fs = fs || FS;
  var e = A.createEngine(fs);
  e.setState(stateFn());
  var nL = A.makeNoise(seedL, N), nR = A.makeNoise(seedR, N);
  var outL = new Float64Array(N), outR = new Float64Array(N);
  e.process(nL, nR, outL, outR);
  var vals = [];
  for (var i = 0; i < N; i += STRIDE) vals.push(outL[i], outR[i]);
  return vals;
}

/* split-glide truth: rendered in two single calls with a setState at 999.
   The TWIN renders the same stream chopped into prime-sized chunks — it can
   only match these values if it carries ctrlPhase across calls. */
var SPLIT_SW = 999;
function splitGlide() {
  var e = A.createEngine(FS);
  var s0 = surgical();
  e.setState(s0);
  var s1 = surgical();
  s1.bands[1].gain = 8;
  s1.out.gain = 2;
  var nL = A.makeNoise(31415, N), nR = A.makeNoise(27182, N);
  var outL = new Float64Array(N), outR = new Float64Array(N);
  e.process(nL.subarray(0, SPLIT_SW), nR.subarray(0, SPLIT_SW),
            outL.subarray(0, SPLIT_SW), outR.subarray(0, SPLIT_SW));
  e.setState(s1);
  e.process(nL.subarray(SPLIT_SW), nR.subarray(SPLIT_SW),
            outL.subarray(SPLIT_SW), outR.subarray(SPLIT_SW));
  var vals = [];
  for (var i = 0; i < N; i += STRIDE) vals.push(outL[i], outR[i]);
  return vals;
}

var renderVals = renderCase(surgical, 424242, 424242)
  .concat(renderCase(placed, 424242, 133742))    // true stereo input for placement paths
  .concat(renderCase(dynamic, 987654, 987654))   // envelope + gain-modulation path
  .concat(renderCase(placed, 424242, 133742, 44100))  // nothing assumes 48 k
  .concat(renderCase(dynamic, 987654, 987654, 96000))
  .concat(splitGlide());                         // ctrlPhase across calls

/* --- write header --- */
function arrD(name, vals) {
  return 'static const double ' + name + '[] = {\n  ' +
    vals.map(lit).join(',\n  ') + '\n};\nstatic const int ' + name + '_N = ' + vals.length + ';\n';
}
function arrI(name, vals) {
  return 'static const int ' + name + '[] = { ' + vals.join(', ') + ' };\n';
}
var hdr = '/* GENERATED by tests/parity_emit.js — do not edit.\n' +
  '   Truth values from autopsy_core.js v' + A.VERSION + ' at fs=' + FS + '. */\n' +
  '#pragma once\n' +
  'static const double PARITY_FS = ' + FS + ';\n' +
  'static const int PARITY_N = ' + N + ';\n' +
  'static const int PARITY_STRIDE = ' + STRIDE + ';\n' +
  'static const int PARITY_NCASES = ' + COEFF_CASES.length + ';\n' +
  arrI('EXP_SECN', coeffNs) +
  arrD('EXP_COEFFS', coeffVals) +
  arrD('EXP_MAGS', magVals) +
  arrD('EXP_RENDER', renderVals);
fs.writeFileSync(path.join(__dirname, 'parity_expected.h'), hdr);
console.log('parity_expected.h written: ' + COEFF_CASES.length + ' coeff cases, ' +
  magVals.length + ' mags, ' + renderVals.length + ' samples');
