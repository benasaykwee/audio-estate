/* AUTOPSY CPU budget — node tests/autopsy_bench.js
   A separate script on purpose, never instrumentation inside the engine:
   a timer in the audio path both lies and destroys determinism (RIGOR's
   convention). JS single thread, 20 s at 48 k, 512-sample blocks. */
'use strict';
var A = require('../autopsy_core.js');

var FS = 48000, SECONDS = 20, BLOCK = 512;

function bench(name, stateFn) {
  var e = A.createEngine(FS);
  e.setState(stateFn());
  var n = FS * SECONDS;
  var x = A.makeNoise(42, BLOCK);
  var inL = new Float64Array(x), inR = new Float64Array(x);
  var outL = new Float64Array(BLOCK), outR = new Float64Array(BLOCK);
  var t0 = Date.now();
  for (var pos = 0; pos < n; pos += BLOCK) {
    e.process(inL, inR, outL, outR);
  }
  var ms = Date.now() - t0;
  var xrt = (SECONDS * 1000) / ms;
  console.log('  ' + name.padEnd(34) + String(ms).padStart(6) + ' ms   ' +
              xrt.toFixed(1).padStart(7) + 'x realtime');
  return xrt;
}

console.log('AUTOPSY bench — ' + SECONDS + ' s @ ' + FS + ' Hz, ' + BLOCK + '-sample blocks\n');

bench('1 bell (typical single band)', function () {
  var s = A.defaultState();
  s.bands[0] = { on: true, type: 'bell', freq: 1000, gain: 4, q: 1.5, slope: 12, place: 'st' };
  return s;
});

bench('12 bands, heavy (slope 48, M/S)', function () {
  var s = A.defaultState();
  for (var k = 0; k < 12; k++) {
    s.bands[k] = { on: true, type: A.TYPES[k % A.TYPES.length], freq: 40 + k * 900,
                   gain: k % 2 ? 6 : -6, q: 2, slope: 48, place: A.PLACES[k % A.PLACES.length] };
  }
  return s;
});

var worst = bench('12 heavy + dynamics on all eligible', function () {
  var s = A.defaultState();
  for (var k = 0; k < 12; k++) {
    s.bands[k] = { on: true, type: A.TYPES[k % A.TYPES.length], freq: 40 + k * 900,
                   gain: k % 2 ? 6 : -6, q: 2, slope: 48, place: A.PLACES[k % A.PLACES.length],
                   dyn: { on: true, range: -9, thresh: -30, att: 5, rel: 120 } };
  }
  return s;
});

console.log('\n~' + Math.floor(worst * 0.7) + ' instances of the worst case fit a 70%-loaded core.');
