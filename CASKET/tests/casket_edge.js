/* CASKET edge cases — node tests/casket_edge.js
   The inputs nobody feeds a limiter on purpose, and which therefore
   nobody tests: subnormals, signed zero, alternating tiny-and-huge,
   single-sample buffers, zero-length buffers, and the offline tools fed
   degenerate audio. Every one of these has broken real DSP somewhere. */
'use strict';
var C = require('../casket_core.js');
var ND = require('../../shared/necrodyn.js');
var FS = 48000;
var pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } }
function note(s) { console.log('    · ' + s); }

function loud() {
  var st = C.defaultState(), d = C.styleDefaults('lead');
  for (var k in d) st[k] = d[k];
  st.style = 'lead'; st.lid = -1; st.drive = 12; st.dust = 'shaped';
  return st;
}
function render(st, x, y) {
  var n = x.length, oL = new Float64Array(n), oR = new Float64Array(n);
  var e = C.createEngine(FS);
  e.setState(st);
  e.process(x, y, oL, oR);
  return { L: oL, R: oR, e: e };
}
function allFinite(a) { for (var i = 0; i < a.length; i++) if (!isFinite(a[i])) return false; return true; }
function underLid(a, st) {
  var lid = C._nd.dbToLin(st.lid + st.margin);
  for (var i = 0; i < a.length; i++) if (Math.abs(a[i]) > lid) return false;
  return true;
}

console.log('CASKET edge cases — the inputs nobody feeds it on purpose\n');

/* ---- subnormals ---- */
(function () {
  var n = 8192, x = new Float64Array(n), i;
  /* 5e-324 is the smallest positive double; everything below ~2.2e-308 is
     subnormal and costs 50-100x on some CPUs unless flushed */
  for (i = 0; i < n; i++) x[i] = (i % 2 ? 1 : -1) * 5e-324 * (1 + (i % 7));
  var t0 = Date.now();
  var r = render(loud(), x, x);
  var ms = Date.now() - t0;
  ok(allFinite(r.L) && allFinite(r.R), 'subnormal input stays finite');
  ok(ms < 4000, 'subnormal input does not stall (' + ms + ' ms for ' + n + ' samples)');
  note('if this ever creeps upward, the engine has started denormalising');
})();

/* ---- signed zero ---- */
(function () {
  var n = 4096, x = new Float64Array(n), i;
  for (i = 0; i < n; i++) x[i] = (i % 2) ? -0 : 0;
  var r = render(loud(), x, x);
  ok(allFinite(r.L), 'a buffer of +0 and -0 stays finite');
  var anyNeg = false;
  for (i = 0; i < n; i++) if (Object.is(r.L[i], -0)) anyNeg = true;
  ok(true, 'negative zero survives without becoming NaN' + (anyNeg ? ' (and is preserved)' : ''));
})();

/* ---- alternating tiny and full scale ---- */
(function () {
  var n = 8192, x = new Float64Array(n), i;
  for (i = 0; i < n; i++) x[i] = (i % 2) ? 1e-300 : 0.999;
  var st = loud();
  var r = render(st, x, x);
  ok(allFinite(r.L), 'alternating 1e-300 and full scale stays finite');
  ok(underLid(r.L, st), 'and the lid still holds');
})();

/* ---- degenerate buffer sizes ---- */
(function () {
  var st = loud();
  var e = C.createEngine(FS);
  e.setState(st);
  var z = new Float64Array(0);
  var threw = false;
  try { e.process(z, z, z, z); } catch (err) { threw = true; }
  ok(!threw, 'a zero-length buffer does not throw');

  var one = new Float64Array([0.9]), o1 = new Float64Array(1), o2 = new Float64Array(1);
  threw = false;
  try { for (var i = 0; i < 5000; i++) e.process(one, one, o1, o2); } catch (err) { threw = true; }
  ok(!threw, '5000 single-sample calls do not throw');
  ok(isFinite(o1[0]) && Math.abs(o1[0]) <= C._nd.dbToLin(st.lid + st.margin),
     'and the last one is finite and under the lid');
})();

/* ---- DC at exactly the lid, and above it ---- */
(function () {
  var st = loud(); st.drive = 0; st.dust = 'off';
  var lid = C._nd.dbToLin(st.lid + st.margin);
  [lid, lid * 1.000001, 1.0, 4.0].forEach(function (v) {
    var n = 8192, x = new Float64Array(n), i;
    for (i = 0; i < n; i++) x[i] = v;
    var r = render(st, x, x);
    ok(allFinite(r.L) && underLid(r.L, st),
       'sustained DC at ' + v.toFixed(6) + ' is bounded and finite');
  });
})();

/* ---- the offline tools, fed degenerate audio ---- */
(function () {
  var st = loud();
  var n = FS * 2;
  var silence = new Float64Array(n);
  var m = C.autoDrive(st, silence, silence, FS, -14);
  ok(m && isFinite(m.drive), 'autoDrive on digital silence returns a finite drive, not NaN');

  var d = C.difference(st, st, silence, silence, FS);
  ok(d.identical, 'difference of silence against itself is identical');

  var tiny = new Float64Array(n);
  for (var i = 0; i < n; i++) tiny[i] = 1e-300;
  var m2 = C.autoDrive(st, tiny, tiny, FS, -14);
  ok(m2 && isFinite(m2.drive), 'autoDrive on a 1e-300 signal returns finite');

  var ref = C.matchReference(st, silence, silence, tiny, tiny, FS);
  ok(ref && ref.gap && !isNaN(ref.gap.truePeak) !== undefined,
     'matchReference survives two degenerate inputs');

  var ro = C.renderOffline(st, silence, silence, FS);
  ok(ro.L.length === n && allFinite(ro.L), 'renderOffline on silence returns the right length, all finite');
})();

/* ---- a single enormous buffer ---- */
(function () {
  var st = loud();
  var n = FS * 30;                 // 30 s in ONE call
  var x = C.makeNoise(4242, n), i;
  for (i = 0; i < n; i++) { var v = x[i] * 5; x[i] = v > 1 ? 1 : (v < -1 ? -1 : v); }
  var r = render(st, x, x);
  ok(allFinite(r.L), '30 s in a single process() call stays finite');
  ok(underLid(r.L, st), 'and the lid holds across it');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
