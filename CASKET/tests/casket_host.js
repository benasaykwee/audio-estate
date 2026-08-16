/* CASKET host harness — the plugin boundary, proven rather than asserted.
   node tests/casket_host.js

   There is no JUCE here, so nothing in this file runs the real wrapper.
   What it does instead is simulate the wrapper's ALGORITHM exactly as
   PluginProcessor.cpp implements it — chunk at MAX_CHUNK, convert to float
   at the boundary, read channel 0 twice when the bus is mono — and prove
   the properties a host depends on. `casket_plugin_test.js` separately
   lints that the C++ really does implement this algorithm, so between the
   two the claim is closed without a compiler.

   The properties, in the order a host discovers them:
     1. the block size must not change the audio             (pluginval s10)
     2. chunking a long block must equal not chunking it     (the new code)
     3. the reported latency must be the real latency        (every DAW)
     4. float at the boundary must not move where things land
     5. a mono bus must not be a different program

   Why this is worth a file of its own: the wrapper used to `.resize()` its
   scratch vectors when a host sent more samples than it promised, which is
   a heap allocation on the audio thread. Chunking replaces it — and
   chunking is only safe because the core carries its control-block phase
   across calls. That was fixed two rounds ago for a different reason. This
   harness is where the two facts are made to shake hands. */
'use strict';
var C = require('../casket_core.js');

var pass = 0, fail = 0;
function ok(c, n) {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ FAIL: ' + n); }
}

var FS = 48000;
/* must match PluginProcessor.h — and the lint below checks that it does,
   because a constant duplicated in two languages is a constant that will
   drift the moment somebody tunes one of them */
var MAX_CHUNK = 8192;
(function () {
  var fs = require('fs'), path = require('path');
  var h = fs.readFileSync(path.join(__dirname, '..', 'casket-juce', 'Source',
                                    'PluginProcessor.h'), 'utf8');
  var m = h.match(/MAX_CHUNK\s*=\s*(\d+)/);
  ok(!!m && +m[1] === MAX_CHUNK,
     'MAX_CHUNK here (' + MAX_CHUNK + ') matches the wrapper (' +
     (m ? m[1] : 'absent') + ')');
})();

/* ---- the wrapper, in JS ----
   float conversion included, because that is what JUCE hands us and the
   core is double throughout. */
function hostRender(state, xL, xR, blocks, opts) {
  opts = opts || {};
  var n = xL.length;
  var e = C.createEngine(FS);
  e.setState(state);
  var cap = MAX_CHUNK;
  var dL = new Float64Array(cap), dR = new Float64Array(cap);
  var oL = new Float64Array(cap), oR = new Float64Array(cap);
  var outL = new Float32Array(n), outR = new Float32Array(n);
  var pos = 0, bi = 0;
  while (pos < n) {
    var blk = Math.min(typeof blocks === 'function' ? blocks(bi++) : blocks, n - pos);
    /* the host's block, then the wrapper's chunking inside it */
    for (var off = 0; off < blk; ) {
      var take = Math.min(cap, blk - off);
      for (var i = 0; i < take; i++) {
        /* float in — JUCE buffers are float */
        dL[i] = Math.fround(xL[pos + off + i]);
        dR[i] = opts.mono ? Math.fround(xL[pos + off + i])
                          : Math.fround(xR[pos + off + i]);
      }
      e.process(dL.subarray(0, take), dR.subarray(0, take),
                oL.subarray(0, take), oR.subarray(0, take));
      for (i = 0; i < take; i++) {
        outL[pos + off + i] = Math.fround(oL[i]);
        if (!opts.mono) outR[pos + off + i] = Math.fround(oR[i]);
      }
      off += take;
    }
    pos += blk;
  }
  return { L: outL, R: outR, latency: C.latencySamples(C.sanitizeState(state), FS) };
}

function maxDiff(a, b) {
  var mx = 0;
  for (var i = 0; i < a.length; i++) {
    var d = Math.abs(a[i] - b[i]);
    if (d > mx) mx = d;
  }
  return mx;
}

function hostile(seed, n) {
  var x = C.makeNoise(seed, n);
  for (var i = 0; i < n; i++) {
    var v = x[i] * 3.2;
    x[i] = v > 1 ? 1 : (v < -1 ? -1 : v);
  }
  return x;
}

console.log('CASKET host harness — the plugin boundary\n');

/* ============================================================
   1. THE BLOCK SIZE MUST NOT CHANGE THE AUDIO
   pluginval at strictness 10 varies the block size between calls. This is
   that test, run against the wrapper's algorithm rather than the bare core.
   ============================================================ */
console.log('— the host may pick any block size —');
(function () {
  var n = 30000;
  var xL = hostile(31337, n), xR = hostile(90210, n);
  var st = C.defaultState();
  st.style = 'velvet'; st.drive = 14; st.lid = -1.0; st.dc = false;

  var ref = hostRender(st, xL, xR, 512);
  var bad = [];
  [1, 2, 3, 7, 13, 32, 64, 127, 240, 256, 333, 480, 512, 997, 1024,
   1200, 2048, 4096].forEach(function (b) {
    var got = hostRender(st, xL, xR, b);
    var d = maxDiff(ref.L, got.L) + maxDiff(ref.R, got.R);
    if (d !== 0) bad.push(b + ' (' + d.toExponential(2) + ')');
  });
  ok(bad.length === 0, '18 fixed block sizes including primes are bit-identical' +
     (bad.length ? ' — ' + bad.join(', ') : ''));

  /* and the nastier case: a size that CHANGES every call, which is what
     strictness 10 actually does */
  var rng = 12345;
  function wobble() { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return 1 + (rng % 2000); }
  var w1 = hostRender(st, xL, xR, wobble);
  rng = 999;
  var w2 = hostRender(st, xL, xR, wobble);
  ok(maxDiff(ref.L, w1.L) === 0 && maxDiff(ref.R, w1.R) === 0,
     'a block size that changes every call is bit-identical too');
  ok(maxDiff(w1.L, w2.L) === 0,
     'and two different random block schedules agree with each other');

  /* zero-length calls, which hosts do send */
  var z = hostRender(st, xL, xR, function (i) { return i % 3 === 0 ? 0 : 777; });
  ok(maxDiff(ref.L, z.L) === 0, 'zero-length blocks interleaved change nothing');
})();

/* ============================================================
   2. CHUNKING MUST EQUAL NOT CHUNKING
   The whole point of the new processBlock. A host that sends more samples
   than it promised now gets chunked instead of a heap allocation, so the
   chunking had better be free.
   ============================================================ */
console.log('\n— chunking a long block —');
(function () {
  var n = MAX_CHUNK * 3 + 501;      /* three full chunks and an awkward tail */
  var xL = hostile(5150, n), xR = hostile(6160, n);
  var st = C.defaultState();
  st.style = 'lead'; st.drive = 10; st.lid = -0.8;

  /* the wrapper, chunking at MAX_CHUNK */
  var chunked = hostRender(st, xL, xR, n);
  /* the same audio with a cap large enough that no chunking occurs */
  var save = MAX_CHUNK;
  MAX_CHUNK = n + 1;
  var whole = hostRender(st, xL, xR, n);
  MAX_CHUNK = save;

  ok(maxDiff(chunked.L, whole.L) === 0 && maxDiff(chunked.R, whole.R) === 0,
     'a ' + n + '-sample block chunked at ' + MAX_CHUNK +
     ' is bit-identical to the same block uncut');

  /* exactly on the boundary, which is where these break */
  [MAX_CHUNK - 1, MAX_CHUNK, MAX_CHUNK + 1].forEach(function (len) {
    var a = hostile(77, len), b = hostile(88, len);
    var c1 = hostRender(st, a, b, len);
    save = MAX_CHUNK; MAX_CHUNK = len * 2 + 8;
    var c2 = hostRender(st, a, b, len);
    MAX_CHUNK = save;
    ok(maxDiff(c1.L, c2.L) === 0, 'block of exactly ' + len + ' survives the boundary');
  });
})();

/* ============================================================
   3. THE REPORTED LATENCY MUST BE THE REAL LATENCY
   A plugin whose reported latency is a lie smears every parallel path in
   the session. The core asserts this; this asserts it THROUGH the wrapper,
   float conversion and chunking included.
   ============================================================ */
console.log('\n— the latency the host is told —');
(function () {
  var n = 12000, at = 3000;
  var bad = [], checked = 0;
  ['pine', 'velvet', 'oak', 'iron', 'lead'].forEach(function (style) {
    [1, 2, 4, 8, 16].forEach(function (lin) {
      [false, true].forEach(function (seal) {
        var st = C.defaultState();
        st.style = style; st.lining = lin; st.seal = seal;
        st.lid = -1.0; st.drive = 0; st.dc = false;
        var xL = new Float64Array(n), xR = new Float64Array(n);
        xL[at] = 0.5; xR[at] = 0.5;          /* well under the lid: pure delay */
        var r = hostRender(st, xL, xR, 337);  /* a prime, on purpose */
        var pk = 0, pi = -1;
        for (var i = 0; i < n; i++) {
          var v = Math.abs(r.L[i]);
          if (v > pk) { pk = v; pi = i; }
        }
        checked++;
        if (pi !== at + r.latency)
          bad.push(style + '/' + lin + 'x' + (seal ? '/sealed' : '') +
                   ' → ' + pi + ' want ' + (at + r.latency));
      });
    });
  });
  ok(bad.length === 0, checked + ' arrangement × lining × seal combinations land ' +
     'the impulse at exactly the reported latency' +
     (bad.length ? ' — ' + bad.slice(0, 4).join('; ') : ''));

  /* the latency must also be what the host is told BEFORE any audio flows,
     since that is when the host builds its delay compensation graph */
  var s1 = C.defaultState(); s1.style = 'pine'; s1.seal = false;
  var s2 = C.defaultState(); s2.style = 'pine'; s2.seal = true;
  ok(C.latencySamples(s2, FS) - C.latencySamples(s1, FS) === C.DEC_Q,
     'sealing costs exactly DEC_Q (' + C.DEC_Q + ') and the host is told so up front');
  var v1 = C.defaultState(); v1.vigil = 2;
  var v2 = C.defaultState(); v2.vigil = 8;
  ok(C.latencySamples(v2, FS) > C.latencySamples(v1, FS),
     'a longer vigil reports a longer latency');
})();

/* ============================================================
   4. FLOAT AT THE BOUNDARY
   The core is double throughout; JUCE is float. The conversion must not
   move anything structural — only add its own quantisation.
   ============================================================ */
console.log('\n— float at the boundary —');
(function () {
  var n = 8000;
  var xL = hostile(2468, n), xR = hostile(1357, n);
  var st = C.defaultState(); st.style = 'oak'; st.drive = 8; st.lid = -1.0;
  var r = hostRender(st, xL, xR, 512);

  var over = 0, lidLin = Math.pow(10, -1.0 / 20);
  for (var i = 0; i < n; i++) {
    if (Math.abs(r.L[i]) > lidLin || Math.abs(r.R[i]) > lidLin) over++;
  }
  /* Float rounding can push a sample AT the lid one float-ulp over it. That
     is a property of float32, not of the limiter, and pretending otherwise
     would be the kind of number-fudging this project keeps catching itself
     at. So: assert the bound the float boundary can actually honour. */
  var worst = 0;
  for (i = 0; i < n; i++) {
    var a = Math.max(Math.abs(r.L[i]), Math.abs(r.R[i]));
    if (a > lidLin) worst = Math.max(worst, a / lidLin - 1);
  }
  ok(worst <= 6e-8, 'float conversion costs at most one float ulp at the lid (' +
     (over ? worst.toExponential(2) + ' relative, ' + over + ' samples' : 'none over') + ')');

  var finite = true;
  for (i = 0; i < n; i++) if (!isFinite(r.L[i]) || !isFinite(r.R[i])) finite = false;
  ok(finite, 'nothing non-finite survives the round trip through float');
})();

/* ============================================================
   5. A MONO BUS IS NOT A DIFFERENT PROGRAM
   isBusesLayoutSupported accepts mono. The wrapper then reads channel 0
   twice and writes only channel 0. That must give the same answer as the
   left channel of a stereo render of the same signal on both sides —
   otherwise a mono track is quietly a different limiter.
   ============================================================ */
console.log('\n— the mono bus —');
(function () {
  var n = 9000;
  var x = hostile(4242, n);
  var st = C.defaultState(); st.style = 'iron'; st.drive = 12; st.lid = -1.0;
  var mono = hostRender(st, x, x, 480, { mono: true });
  var stereo = hostRender(st, x, x, 480);
  ok(maxDiff(mono.L, stereo.L) === 0,
     'mono equals the left channel of the same signal in stereo');

  /* link at 0 % is where a mono bus could plausibly diverge, because the
     channels stop constraining each other */
  st.link = 0;
  var m0 = hostRender(st, x, x, 480, { mono: true });
  var s0 = hostRender(st, x, x, 480);
  ok(maxDiff(m0.L, s0.L) === 0, 'and still does at 0 % link');
})();

/* ============================================================
   6. THE STRUCTURAL CHANGE A HOST WILL ACTUALLY MAKE
   ============================================================ */
console.log('\n— a structural change mid-stream —');
(function () {
  /* The wrapper calls setState() and refreshLatency() every block. When a
     structural value moves, the reported latency moves with it, and the
     host is told. What must NOT happen is a non-finite sample or a breach
     of the lid while the gain path is being rebuilt underneath. */
  var n = 20000;
  var xL = hostile(1122, n), xR = hostile(3344, n);
  var e = C.createEngine(FS);
  var oL = new Float64Array(n), oR = new Float64Array(n);
  var lats = [], breach = 0, nonFinite = 0, pos = 0, k = 0;
  var linings = [1, 2, 4, 8, 16];
  while (pos < n) {
    var blk = Math.min(256, n - pos);
    var st = C.defaultState();
    st.style = ['pine', 'velvet', 'oak', 'iron', 'lead'][k % 5];
    st.lining = linings[k % 5];
    st.seal = (k % 3) === 0;
    st.vigil = 0.5 + (k % 7);
    st.lid = -1.0; st.drive = 16;
    e.setState(st);
    var lat = C.latencySamples(st, FS);
    if (lats.indexOf(lat) < 0) lats.push(lat);
    e.process(xL.subarray(pos, pos + blk), xR.subarray(pos, pos + blk),
              oL.subarray(pos, pos + blk), oR.subarray(pos, pos + blk));
    var lidLin = Math.pow(10, (st.lid + st.margin) / 20);
    for (var i = pos; i < pos + blk; i++) {
      if (!isFinite(oL[i]) || !isFinite(oR[i])) nonFinite++;
      if (Math.abs(oL[i]) > lidLin || Math.abs(oR[i]) > lidLin) breach++;
    }
    pos += blk; k++;
  }
  ok(nonFinite === 0, 'nothing non-finite through ' + k + ' structural changes');
  ok(breach === 0, 'and the lid held through every one of them');
  ok(lats.length >= 8, 'the reported latency genuinely moved (' +
     lats.length + ' distinct values seen)');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (!fail) console.log('the host boundary holds. the wrapper is not the weak part.');
process.exit(fail ? 1 : 0);
