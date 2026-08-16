/* AUTOPSY regression — byte-stable render baselines.
   node tests/autopsy_regression.js          → compare against baseline
   node tests/autopsy_regression.js --write  → (re)write baseline
   Hash = FNV-1a over %.17g of every output sample, so ANY numeric
   drift in the core fails the gate. */
'use strict';
var fs = require('fs');
var path = require('path');
var A = require('../autopsy_core.js');

var BASE = path.join(__dirname, 'autopsy_regression_baseline.json');
var FS = 48000, N = 48000;

function fnv1a(str) {
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

function render(stateFn, seed, seedR) {
  var s = stateFn();
  var e = A.createEngine(FS);
  e.setState(s);
  var noise = A.makeNoise(seed, N);
  var noiseR = seedR ? A.makeNoise(seedR, N) : noise;
  var outL = new Float64Array(N), outR = new Float64Array(N);
  e.process(noise, noiseR, outL, outR);
  var parts = [];
  for (var i = 0; i < N; i += 7) { // stride keeps the string manageable, still catches drift
    parts.push(outL[i].toPrecision(17), outR[i].toPrecision(17));
  }
  return fnv1a(parts.join(','));
}

var CASES = {
  flat: function () { return A.defaultState(); },
  surgical: function () {
    var s = A.defaultState();
    s.bands[0] = { on: true, type: 'lowcut', freq: 80, gain: 0, q: 1 };
    s.bands[1] = { on: true, type: 'bell', freq: 240, gain: -3.5, q: 2.2 };
    s.bands[2] = { on: true, type: 'bell', freq: 3200, gain: 2.5, q: 1.4 };
    s.bands[3] = { on: true, type: 'highshelf', freq: 9000, gain: 1.5, q: 0.71 };
    return s;
  },
  extremes: function () {
    var s = A.defaultState();
    for (var k = 0; k < A.MAX_BANDS; k++) {
      s.bands[k] = { on: true, type: A.TYPES[k % A.TYPES.length],
                     freq: 25 + k * 1700, gain: (k % 2 ? 18 : -18), q: (k % 3 ? 12 : 0.3) };
    }
    s.out.gain = -6; s.out.pan = 0.4;
    return s;
  },
  placed: function () { // v0.3: slopes, placement, tilt, bandpass — true stereo input
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
  },
  dynamic: function () { // v0.4: envelope follower + control-rate gain modulation
    var s = A.defaultState();
    s.bands[0] = { on: true, type: 'bell', freq: 1000, gain: 0, q: 1.5, slope: 12, place: 'st',
                   dyn: { on: true, range: -12, thresh: -30, att: 5, rel: 80 } };
    s.bands[1] = { on: true, type: 'highshelf', freq: 8000, gain: 2, q: 0.71, slope: 12, place: 'st',
                   dyn: { on: true, range: 6, thresh: -36, att: 20, rel: 200 } };
    s.bands[2] = { on: true, type: 'lowcut', freq: 60, gain: 0, q: 1, slope: 24, place: 'st' };
    s.out.gain = -1.0; s.out.pan = 0.1;
    return s;
  }
};

var STEREO_SEEDS = { placed: 133742 };
var results = {};
Object.keys(CASES).forEach(function (name) {
  results[name] = render(CASES[name], 424242, STEREO_SEEDS[name]);
});

if (process.argv.indexOf('--write') !== -1) {
  fs.writeFileSync(BASE, JSON.stringify({ version: A.VERSION, fs: FS, n: N, hashes: results }, null, 2));
  console.log('baseline written:', JSON.stringify(results));
  process.exit(0);
}

if (!fs.existsSync(BASE)) {
  console.error('No baseline. Run with --write first (and commit the baseline).');
  process.exit(1);
}
var base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
var fail = 0;
Object.keys(CASES).forEach(function (name) {
  if (base.hashes[name] === results[name]) {
    console.log('  ✓ ' + name + ' byte-stable (' + results[name] + ')');
  } else {
    console.log('  ✗ FAIL: ' + name + ' drifted (' + base.hashes[name] + ' → ' + results[name] + ')');
    fail++;
  }
});
console.log(fail ? '\nREGRESSION: the corpse has moved.' : '\nregression clean — nothing has shifted in the grave.');
process.exit(fail ? 1 : 0);
