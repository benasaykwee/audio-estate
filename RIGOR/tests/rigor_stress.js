/* RIGOR stress — hostile AUDIO, not hostile settings.
   ============================================================
   The fuzzer hammers the state: random parameters, hostile combinations,
   nonsense in every field. It never once handed the engine a bad SAMPLE,
   and neither did anything else in this suite. Every NaN assertion in the
   project was about the output.

   That gap hid a hard lock-up. A single +Infinity sample — which any
   upstream plugin can produce, and which an uninitialised buffer produces
   for free — reached the peak follower, then ND.linToDb, then NM.log10,
   which iterates and never converges on a non-finite argument. Not a
   click, not a dropout: the audio thread stops and the DAW needs a force
   quit. Everything except bypass hung, at every style, at any block size,
   and 198 tests were green the whole time.

   ND.linToDb has always guarded the LOW end — 0, negative and denormal all
   clamp to -600 dB — which is why digital silence was never a problem.
   Nothing guarded the high end.

   So this file exists to hand RIGOR the things a host can actually do to
   it, and to keep handing them over after the fix.

     node tests/rigor_stress.js
   ============================================================ */
'use strict';
var R = require('../rigor_core.js');

var FS = 48000;
var pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } }
function styled(name, patch) {
  var s = R.defaultState(), d = R.styleDefaults(name);
  for (var k in d) s[k] = d[k];
  s.style = name;
  if (patch) for (var k2 in patch) s[k2] = patch[k2];
  return R.sanitizeState(s);
}
function mk(st) {
  var e = (st.bands > 1 ? R.createMulti : R.createEngine)(FS);
  e.setState(st);
  return e;
}
function run(e, x, n) {
  var a = new Float64Array(n), b = new Float64Array(n);
  e.process(x, x, a, b);
  return a;
}
function allFinite(a) {
  for (var i = 0; i < a.length; i++) if (!isFinite(a[i])) return false;
  return true;
}

var STYLES = ['fresh', 'settling', 'spasm', 'repose'];

/* ============================================================
   1. POISONED SAMPLES — the lock-up
   ============================================================ */
console.log('\n— hostile input samples —');

var POISON = [
  ['+Infinity', Infinity],
  ['-Infinity', -Infinity],
  ['NaN', NaN]
];

/* Every configuration that has its own path to the follower. If this ever
   times out rather than failing, that IS the bug returning — the original
   symptom was a hang, not a wrong answer. */
var CONFIGS = [
  ['fresh 1-band', { thresh: -30, ratio: 8 }],
  ['settling (feedback topology)', { style: 'settling', thresh: -30, ratio: 8 }],
  ['spasm', { style: 'spasm', thresh: -30, ratio: 8 }],
  ['repose', { style: 'repose', thresh: -30, ratio: 8 }],
  ['3-band (splitter runs first)', { bands: 3, thresh: -30, ratio: 8 }],
  ['lookahead 5 ms', { look: 5, thresh: -30, ratio: 8 }],
  ['oversampled detection', { detOs: true, detOsX: 8, thresh: -30, ratio: 8 }],
  ['mid/side', { place: 'ms', thresh: -30, ratio: 8 }],
  ['sidechain filter on', { scOn: true, thresh: -30, ratio: 8 }],
  ['bypass', { bypass: true }]
];

POISON.forEach(function (p) {
  CONFIGS.forEach(function (c) {
    var st = styled(c[1].style || 'fresh', c[1]);
    var e = mk(st);
    var n = 256, x = new Float64Array(n);
    for (var i = 0; i < n; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / FS);
    x[37] = p[1];
    var out = run(e, x, n);
    ok(allFinite(out), 'one ' + p[0] + ' sample through ' + c[0] +
       ' returns, and every output sample is finite');
  });
});

/* A poisoned sample must not be a permanent injury. The follower, the
   filters and the delay line all carry state; if the bad value lodges in
   any of them the instance is dead and only reconstruction fixes it.

   My first version of this test demanded that a later clean block be
   IDENTICAL to an engine that never saw the poison. That is not what
   recovery means and the test was wrong, not the engine. The guard
   replaces a poisoned sample with silence, so the damaged engine really
   did receive a different signal — three samples of it — and a compressor
   is a stateful system that responds to the input it actually got. A
   momentary difference is correct behaviour.

   What must be true is that the difference DECAYS: the envelope is a
   leaky integrator, so the memory of those three samples has to fade at
   the release time constant and not lodge anywhere permanent. That is
   derivable rather than fitted, but it has to be derived from the SLOWEST
   path in the design, not the nominal one: so the test asserts both that the gap shrinks monotonically
   auto-release runs a second follower at eight times the release, so over
   five nominal release constants the slowest legitimate decay is only
   e^(-5/8) = 0.535 of the original gap. My second attempt asserted an
   absolute floor of 1e-9 and failed three styles that were behaving
   exactly as designed — a fitted number, again. What the test asserts now
   is the shape: monotonically shrinking, and down by at least the factor
   the slow follower permits. Poison that had lodged somewhere permanent
   would show a FLAT gap, which is what this catches. */
console.log('\n— recovery: the difference must DECAY, not vanish instantly —');
STYLES.forEach(function (s) {
  var relMs = R.styleDefaults(s).release;
  var blk = Math.ceil(FS * relMs / 1000);        /* one release constant */
  var poisoned = mk(styled(s, { thresh: -30, ratio: 8, bands: 3 }));
  var clean = mk(styled(s, { thresh: -30, ratio: 8, bands: 3 }));

  var first = new Float64Array(blk), later = new Float64Array(blk);
  for (var i = 0; i < blk; i++) {
    first[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / FS);
    later[i] = first[i];
  }
  var bad = Float64Array.from(first);
  bad[10] = Infinity; bad[11] = NaN; bad[12] = -Infinity;

  run(poisoned, bad, blk);
  run(clean, first, blk);

  var gaps = [], finite = true;
  for (var k = 0; k < 5; k++) {
    var p2 = run(poisoned, later, blk), c2 = run(clean, later, blk);
    if (!allFinite(p2)) finite = false;
    var w = 0;
    for (i = 0; i < blk; i++) w = Math.max(w, Math.abs(p2[i] - c2[i]));
    gaps.push(w);
  }
  var shrinking = gaps.every(function (g, j) { return j === 0 || g <= gaps[j - 1]; });
  /* the slow auto-release follower is 8x the release, so e^(-5/8) is the
     least decay any legal path can show over five release constants */
  var floor = Math.exp(-5 / 8);
  var decayed = gaps[4] <= gaps[0] * floor;
  ok(finite && shrinking && decayed,
     s + ': the poison fades — gap shrinks monotonically to ' +
     (gaps[4] / gaps[0]).toFixed(3) + ' of its start over five release ' +
     'constants (slowest legal decay ' + floor.toFixed(3) + '), ' +
     gaps.map(function (g) { return g.toExponential(1); }).join(' → '));
});

/* ============================================================
   2. DETERMINISM — the promise the whole regression suite rests on
   ============================================================ */
console.log('\n— determinism —');
STYLES.forEach(function (s) {
  var st = styled(s, { thresh: -28, ratio: 6, bands: 2, look: 3, autoRel: true });
  var n = 4096, x = R.makeNoise(90210, n);
  var a = run(mk(st), x, n), b = run(mk(st), x, n);
  var same = true;
  for (var i = 0; i < n; i++) if (a[i] !== b[i]) { same = false; break; }
  ok(same, s + ': two engines given the same state and the same input are ' +
     'BIT-IDENTICAL — no hidden time, randomness or global state');
});

/* Splitting a buffer must not change it. The fuzzer checks 32/127/whole;
   this checks the nastier case of a block boundary landing INSIDE the
   control interval, since control() runs every CTRL samples. */
console.log('\n— block boundaries against the control interval —');
var CTRL = R.CTRL;
[1, CTRL - 1, CTRL, CTRL + 1, 2 * CTRL + 3].forEach(function (blk) {
  var st = styled('fresh', { thresh: -28, ratio: 6, look: 2 });
  var n = 2048, x = R.makeNoise(1234, n);
  var whole = run(mk(st), x, n);
  var e = mk(st), piece = new Float64Array(n);
  for (var off = 0; off < n; off += blk) {
    var len = Math.min(blk, n - off);
    var sub = x.subarray(off, off + len);
    var oa = new Float64Array(len), ob = new Float64Array(len);
    e.process(sub, sub, oa, ob);
    piece.set(oa, off);
  }
  var same = true;
  for (var i = 0; i < n; i++) if (whole[i] !== piece[i]) { same = false; break; }
  ok(same, 'block size ' + blk + ' (CTRL is ' + CTRL + ') gives bit-identical ' +
     'output to processing the buffer whole');
});

/* ============================================================
   3. DENORMAL AND EXTREME MATERIAL
   ============================================================ */
console.log('\n— extreme but legal material —');
var EXTREME = [
  ['full-scale square', function (i) { return i % 2 ? 1 : -1; }],
  ['denormal-level noise', function (i) { return (i % 7 - 3) * 1e-310; }],
  ['DC at +1', function () { return 1; }],
  ['DC at -1', function () { return -1; }],
  ['alternating silence and full scale', function (i) { return (i % 128 < 64) ? 0 : 0.999; }],
  ['smallest normal double', function () { return 2.2250738585072014e-308; }]
];
EXTREME.forEach(function (m) {
  var st = styled('fresh', { thresh: -40, ratio: 12, bands: 3 });
  var n = 1024, x = new Float64Array(n);
  for (var i = 0; i < n; i++) x[i] = m[1](i);
  var out = run(mk(st), x, n);
  var peak = 0;
  for (i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  ok(allFinite(out) && peak < 1e6, m[0] + ': finite and bounded (peak ' +
     peak.toExponential(2) + ')');
});

/* ============================================================
   4. THE GUARD MUST NOT COST A BASELINE
   ============================================================ */
console.log('\n— the guard is invisible to legal material —');
(function () {
  var st = styled('fresh', { thresh: -30, ratio: 8, mix: 0, look: 5 });
  var n = 2048, x = R.makeNoise(555, n);
  var out = run(mk(st), x, n);
  var lat = R.latencySamples(st, FS), same = true;
  for (var i = lat; i < n; i++) if (out[i] !== x[i - lat]) { same = false; break; }
  ok(same, 'mix = 0 is still bit-exactly the delayed dry signal — the input ' +
     'guard touches nothing that is already a finite number');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
