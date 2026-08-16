/* RIGOR CPU budget — how many instances does a session survive?
   Deliberately a separate script, not instrumentation inside the engine:
   a timer in the audio path would be both a lie (it measures the timer)
   and a source of non-determinism the parity gate cannot tolerate.
   node tests/rigor_bench.js */
'use strict';
var R = require('../rigor_core.js');

var FS = 48000, BLOCK = 512, SECONDS = 20;
var N = FS * SECONDS;

function styled(name, patch) {
  var s = R.defaultState(), d = R.styleDefaults(name);
  for (var k in d) s[k] = d[k];
  s.style = name;
  if (patch) for (var k2 in patch) s[k2] = patch[k2];
  return s;
}

var srcL = R.makeNoise(424242, N), srcR = R.makeNoise(133742, N);
for (var i = 0; i < N; i++) {
  var g = (i % 12000 < 1200) ? 0.9 : 0.06;
  srcL[i] *= g; srcR[i] *= g;
}

function bench(label, state, multi) {
  var e = (multi ? R.createMulti : R.createEngine)(FS);
  e.setState(state);
  var oL = new Float64Array(BLOCK), oR = new Float64Array(BLOCK);
  /* one warm pass so the JIT is not part of the measurement */
  for (var p = 0; p + BLOCK <= FS; p += BLOCK)
    e.process(srcL.subarray(p, p + BLOCK), srcR.subarray(p, p + BLOCK), oL, oR);

  var t0 = process.hrtime.bigint();
  for (p = 0; p + BLOCK <= N; p += BLOCK)
    e.process(srcL.subarray(p, p + BLOCK), srcR.subarray(p, p + BLOCK), oL, oR);
  var t1 = process.hrtime.bigint();

  var sec = Number(t1 - t0) / 1e9;
  var xrt = SECONDS / sec;
  return { label: label, sec: sec, xrt: xrt };
}

var CASES = [
  ['fresh, 1 band',             styled('fresh'), false],
  ['settling (feedback)',       styled('settling'), false],
  ['repose (RMS)',              styled('repose'), false],
  ['+ sidechain filter',        styled('fresh', { scOn: true }), false],
  ['+ lookahead 5 ms',          styled('fresh', { look: 5 }), false],
  ['+ mid/side',                styled('fresh', { place: 'ms' }), false],
  ['+ oversampled detection',   styled('fresh', { detOs: true }), false],
  ['2 bands',                   styled('fresh', { bands: 2 }), true],
  ['3 bands',                   styled('fresh', { bands: 3 }), true],
  ['3 bands + everything',      styled('settling', { bands: 3, scOn: true, look: 5,
                                                     place: 'ms', detOs: true, curve: 50 }), true]
];

console.log('RIGOR CPU budget — ' + SECONDS + ' s of stereo at ' + FS +
            ' Hz, ' + BLOCK + '-sample blocks');
console.log('(single-threaded JS; the C++ twin is materially faster, but this is\n' +
            ' the number that is actually measured rather than hoped for)\n');
console.log('  case                        x realtime   ~instances at 70% load');
console.log('  ' + new Array(62).join('-'));

var worst = Infinity, worstCase = '';
CASES.forEach(function (c) {
  var r = bench(c[0], c[1], c[2]);
  var inst = Math.floor(r.xrt * 0.7);
  if (r.xrt < worst) { worst = r.xrt; worstCase = c[0]; }
  console.log('  ' + c[0].padEnd(28) + (r.xrt.toFixed(1) + 'x').padStart(9) +
              String(inst).padStart(20));
});
console.log('  ' + new Array(62).join('-'));
console.log('  worst case: ' + worstCase + ' at ' + worst.toFixed(1) + 'x realtime');
console.log('\n  Budget headline: the heaviest configuration runs ' + worst.toFixed(0) +
            'x faster than realtime,');
console.log('  so a 70%-loaded session supports roughly ' + Math.floor(worst * 0.7) +
            ' instances of it.');
