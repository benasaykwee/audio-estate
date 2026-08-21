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

/* THE THIRD COLUMN TRAVELS; THE FIRST TWO DO NOT — added 2026-08-18.
   Milliseconds and realtime factors are facts about the machine this ran
   on; quote either on different hardware and the number is fiction. The
   ×bypass column is the same idea casket_cpu_gate.js is built on: bypass
   is measured fresh at the top of every run, on whatever machine this is,
   so the RATIO is a property of the code. When two people compare notes
   about CASKET's cost, this is the column they can compare. */
var bypassMs = 0;
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
              '   ' + (rt.toFixed(0) + '×').padStart(6) + ' realtime' +
              (bypassMs > 0 ? ('   ' + ('×' + (ms / bypassMs).toFixed(2)).padStart(7) + ' bypass')
                            : '   (the yardstick)'));
  return ms;
}

/* bypass FIRST, so every later row can be stated relative to it */
console.log('CASKET cost — ' + SECS + ' s of stereo at ' + FS + ' Hz');
console.log('  (ms and ×realtime are THIS machine; ×bypass travels)\n');
bypassMs = bench('bypass (the calibration)', { bypass: true });

console.log('\n  UNSEALED (gain applied at base rate)');
[1, 2, 4, 8, 16].forEach(function (M) { bench('lining ' + M + '×', { lining: M, seal: false }); });
console.log('\n  SEALED (gain applied oversampled, then decimated)');
[2, 4, 8, 16].forEach(function (M) { bench('lining ' + M + '×', { lining: M, seal: true }); });
console.log('\n  ARRANGEMENTS at their own defaults');
C.STYLES.forEach(function (s) { bench(s, { style: s }); });
/* WHAT THE SEAM COSTS THE AUDIO THREAD — added 2026-08-19.
   The 2026-08-18 rewrite moved meters() and trace() ONTO the audio thread
   so the editor could read snapshots instead of racing the engine. That is
   correct, and it is also new work in the real-time path: meters() walks
   four 751-bin histograms plus two ring buffers, every block.
   The arithmetic said negligible. Arithmetic is not measurement, and "we
   fixed a correctness bug and quietly took a performance one" is a trade
   worth catching before a user does. So: measure it, in the one unit that
   travels between machines. */
console.log('\n  THE AUDIO/UI SEAM (what publishing a snapshot costs per block)');
(function () {
  var st = C.defaultState(), d = C.styleDefaults('velvet');
  for (var k in d) st[k] = d[k];
  st.lid = -1; st.drive = 10;
  var BLK = 512, blocks = Math.floor(N / BLK);
  function run(withSnapshot) {
    var e = C.createEngine(FS);
    e.setState(st);
    var oL = new Float64Array(BLK), oR = new Float64Array(BLK);
    var iL = src.subarray(0, BLK), iR = src.subarray(0, BLK);
    for (var w = 0; w < 8; w++) e.process(iL, iR, oL, oR);   // warm
    var t0 = process.hrtime.bigint();
    for (var b = 0; b < blocks; b++) {
      e.process(iL, iR, oL, oR);
      if (withSnapshot) { e.meters(); e.trace(); }
    }
    return Number(process.hrtime.bigint() - t0) / 1e6;
  }
  var bare = run(false), pub = run(true);
  var perBlock = (pub - bare) / blocks * 1000;   // microseconds
  console.log('  ' + ('render only').padEnd(30) + (bare.toFixed(1) + ' ms').padStart(9) +
              '   ' + blocks + ' blocks of ' + BLK);
  console.log('  ' + ('render + meters() + trace()').padEnd(30) + (pub.toFixed(1) + ' ms').padStart(9) +
              '   ' + ('×' + (pub / bare).toFixed(3)).padStart(7) + ' of render');
  console.log('  ' + ('the seam, per block').padEnd(30) + (perBlock.toFixed(1) + ' µs').padStart(9) +
              '   at ' + BLK + ' samples that is ' +
              (100 * perBlock / (BLK / FS * 1e6)).toFixed(2) + '% of the block period');
})();

console.log('\n  EXTRAS');
bench('+ shaped dust 16-bit', { dust: 'shaped', dustBits: 16 });
bench('+ mid/side', { ms: true, msMid: 2, msSide: -3 });
bench('+ saturation', { sat: 80 });
bench('bypass', { bypass: true });
/* THE CLOSING CLAIM, CORRECTED 2026-08-18 against this file's own output.
   It used to read "...it scales with the lining while the unsealed path
   barely does." The numbers printed directly above disagree: unsealed goes
   from 2× to 16× lining for about 4.5 times the time, which is not "barely."
   Both paths scale; the sealed one scales WORSE, and the multiplier between
   them widens as the lining climbs. That is the real shape and it is still a
   perfectly good argument for Lead defaulting to 4× — it just is not the
   argument the sentence was making. A summary sentence contradicted by the
   table above it is the easiest kind of wrong thing to leave in a file,
   because nobody reads the two together. */
console.log('\n  The sealed path costs what the decimator costs: its filter is');
console.log('  2·DEC_Q·M+1 taps, so it scales with the lining MORE STEEPLY than');
console.log('  the unsealed path — which scales too, roughly 4.5× from 2× to 16×.');
console.log('  Sealing adds ~1.7× on top at 2× lining and ~2.3× at 16×: the');
console.log('  penalty for sealing itself grows with the lining. That widening');
console.log('  gap, not the absolute cost, is why Lead defaults to 4× and not 16×.');
