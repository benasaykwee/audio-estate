/* CASKET cost table — node tests/casket_bench.js
   Not a pass/fail harness. An honest measurement, so "16× sealed" comes
   with a number attached instead of a shrug. Reported as a REALTIME
   FACTOR: how many seconds of stereo audio the engine renders per second
   of CPU. Higher is better; anything under ~5× is uncomfortable in a
   worklet once a session has other plugins in it. */
'use strict';
var C = require('../casket_core.js');
var FS = 48000, SECS = 2, N = FS * SECS;

var src = C.makeNoise(2718, N);
for (var i = 0; i < N; i++) { var v = src[i] * 4; src[i] = v > 1 ? 1 : (v < -1 ? -1 : v); }

function bench(label, patch) {
  var st = C.defaultState(), d = C.styleDefaults(patch.style || 'velvet');
  for (var k in d) st[k] = d[k];
  st.style = patch.style || 'velvet';
  st.lid = -1; st.drive = 10;
  for (var k2 in patch) st[k2] = patch[k2];
  var e = C.createEngine(FS);
  e.setState(st);
  var oL = new Float64Array(N), oR = new Float64Array(N);
  e.process(src, src, oL, oR);                    // warm the JIT
  var t0 = process.hrtime.bigint();
  e.process(src, src, oL, oR);
  var ms = Number(process.hrtime.bigint() - t0) / 1e6;
  var rt = (SECS * 1000) / ms;
  console.log('  ' + label.padEnd(30) + (ms.toFixed(1) + ' ms').padStart(9) +
              '   ' + (rt.toFixed(0) + '×').padStart(6) + ' realtime');
  return rt;
}

console.log('CASKET cost — ' + SECS + ' s of stereo at ' + FS + ' Hz\n');
console.log('  UNSEALED (gain applied at base rate)');
[1, 2, 4, 8, 16].forEach(function (M) { bench('lining ' + M + '×', { lining: M, seal: false }); });
console.log('\n  SEALED (gain applied oversampled, then decimated)');
[2, 4, 8, 16].forEach(function (M) { bench('lining ' + M + '×', { lining: M, seal: true }); });
console.log('\n  ARRANGEMENTS at their own defaults');
C.STYLES.forEach(function (s) { bench(s, { style: s }); });
console.log('\n  EXTRAS');
bench('+ shaped dust 16-bit', { dust: 'shaped', dustBits: 16 });
bench('+ mid/side', { ms: true, msMid: 2, msSide: -3 });
bench('+ saturation', { sat: 80 });
bench('bypass', { bypass: true });
console.log('\n  The sealed path costs what the decimator costs: its filter is');
console.log('  2·DEC_Q·M+1 taps, so it scales with the lining while the unsealed');
console.log('  path barely does. Lead defaults to 4× sealed for exactly that reason.');
