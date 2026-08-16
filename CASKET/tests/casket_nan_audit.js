/* CASKET — THE NaN AUDIT
   ----------------------------------------------------------------------
   Digital silence is a legal input everywhere in this suite. Somebody
   drags in the wrong file, or a track that has not rendered yet, or the
   head of a fade-in, and the whole public API is handed zeros.

   BS.1770 says the loudness of silence is -Infinity, and it is right to
   say so. But -Infinity is contagious: subtract two of them and you get
   NaN, and NaN prints as "NaN dB" in a user's face and compares false
   against everything, so it silently disables guards written as `x > y`.

   matchReference shipped that bug. This harness is the sweep that proves
   nothing else did: walk EVERY public function with degenerate material
   and assert that no NaN reaches the surface, at any depth, in any field.

   Deliberately not "check the fields I remember" — it recurses into
   whatever a function returns, so a field added later is covered without
   anyone remembering to add it here.  */

var C = require('../casket_core.js');
var pass = 0, fail = 0;

function ok(cond, what) {
  if (cond) { pass++; console.log('  ✓ ' + what); }
  else { fail++; console.log('  ✗ ' + what); }
}

/* Recursively walk anything and collect the paths of every NaN found.
   Typed arrays are walked too — a single NaN sample poisons a whole
   render, and it is exactly the kind of thing a spot check misses. */
function nanPaths(v, path, out, depth) {
  out = out || []; path = path || '$'; depth = depth || 0;
  if (depth > 6) return out;
  if (typeof v === 'number') {
    if (v !== v) out.push(path);
    return out;
  }
  if (v == null || typeof v !== 'object') return out;
  if (ArrayBuffer.isView(v)) {
    for (var i = 0; i < v.length; i++) {
      if (v[i] !== v[i]) { out.push(path + '[' + i + ']'); break; }
    }
    return out;
  }
  if (Array.isArray(v)) {
    for (var j = 0; j < v.length; j++) nanPaths(v[j], path + '[' + j + ']', out, depth + 1);
    return out;
  }
  for (var k in v) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
    if (k === '_nm' || k === '_nd') continue;      // the shared modules
    nanPaths(v[k], path + '.' + k, out, depth + 1);
  }
  return out;
}

function clean(label, value) {
  var bad = nanPaths(value);
  ok(bad.length === 0, label + (bad.length ? '  << NaN at ' + bad.slice(0, 4).join(', ') : ''));
}

var FS = 48000, N = 4096;

/* the degenerate materials, each one something a person can actually
   produce by accident */
function zeros(n) { return new Float64Array(n); }
function tiny(n) { var a = new Float64Array(n); for (var i = 0; i < n; i++) a[i] = 1e-300; return a; }
function dc(n, v) { var a = new Float64Array(n); for (var i = 0; i < n; i++) a[i] = v; return a; }
var MATERIALS = [
  ['digital silence', zeros(N), zeros(N)],
  ['1e-300, below every gate', tiny(N), tiny(N)],
  ['silence left, signal right', zeros(N), C.makeNoise(7, N)],
  ['a single sample of silence', zeros(1), zeros(1)],
  ['sustained DC at full scale', dc(N, 1), dc(N, -1)],
  ['one impulse in an ocean of zeros', (function () { var a = zeros(N); a[100] = 1; return a; })(), zeros(N)]
];

/* the states worth sweeping: the five arrangements, plus the two settings
   that change the shape of the maths (the seal, and shaped dither) */
var STATES = [];
C.STYLES.forEach(function (s) {
  var st = C.defaultState(); st.style = s; STATES.push([s, C.sanitizeState(st)]);
});
(function () {
  var st = C.defaultState(); st.style = 'lead'; st.dust = 'shaped';
  STATES.push(['lead + shaped dust', C.sanitizeState(st)]);
})();

console.log('CASKET NaN audit — silence is a legal input everywhere\n');

console.log('— the meters, on material that legitimately measures -Infinity —');
MATERIALS.forEach(function (m) {
  var r = C.renderOffline(STATES[0][1], m[1], m[2], FS);
  clean('renderOffline + meters survive ' + m[0], r);
});

console.log('\n— every arrangement against every degenerate material —');
STATES.forEach(function (s) {
  var worst = 0;
  MATERIALS.forEach(function (m) {
    var r = C.renderOffline(s[1], m[1], m[2], FS);
    worst += nanPaths(r).length;
  });
  ok(worst === 0, s[0] + ' produces no NaN on any of the ' + MATERIALS.length + ' materials');
});

console.log('\n— the offline tools, which do dB ARITHMETIC and so are the real risk —');
(function () {
  var st = STATES[0][1];
  var sil = zeros(N), noise = C.makeNoise(3, N);

  /* the bug that shipped: two silent files, both measuring -Infinity */
  var mr = C.matchReference(st, sil, sil, sil, sil, FS);
  clean('matchReference(silence, silence) — the bug that shipped', mr);
  ok(mr.gap.lufs === null, '  and it reports the gap as null rather than a number it cannot know');

  clean('matchReference(silence, signal)', C.matchReference(st, sil, sil, noise, noise, FS));
  clean('matchReference(signal, silence)', C.matchReference(st, noise, noise, sil, sil, FS));

  clean('autoDrive on silence', C.autoDrive(st, sil, sil, FS, -14, 4));
  ok(C.autoDrive(st, sil, sil, FS, -14, 4).reached === false,
     '  and autoDrive admits it did not reach the target rather than implying it did');
  clean('autoDrive on 1e-300', C.autoDrive(st, tiny(N), tiny(N), FS, -14, 4));

  clean('autoMargin on silence', C.autoMargin(st, sil, sil, FS, 2));
  clean('difference of silence against silence', C.difference(st, STATES[1][1], sil, sil, FS));
  ok(C.difference(st, st, sil, sil, FS).identical === true,
     '  and silence differenced against itself is identical, not NaN-equal');
})();

console.log('\n— the pure helpers, fed the values that break naive dB code —');
(function () {
  var st = C.sanitizeState(C.defaultState());
  /* NaN in is the caller's error and is reported as NaN, deliberately.
     Every other value must produce a number. */
  [-Infinity, Infinity, 0, -600, -1e300, 1e300].forEach(function (v) {
    var out = C.transferAt(st, v);
    ok(out === out, 'transferAt(' + v + ') is not NaN (got ' + out + ')');
  });
  ok(C.transferAt(st, NaN) !== C.transferAt(st, NaN),
     'transferAt(NaN) stays NaN — garbage in is reported, not silently invented');
  /* THIS ASSERTION USED TO PROVE THE BUG WAS STILL THERE.
     Last round it read `kneeOut(Infinity,…,0) !== itself` — a test that
     PASSED BECAUSE THE SHARED CODE WAS BROKEN, deliberately, so the latent
     defect could not be quietly forgotten while CASKET carried a local
     workaround. It has now been fixed at the source, so the assertion is
     turned the right way up. Which means it is the second thing in this
     round to change direction, and it is worth naming the pattern: a test
     that pins a known defect in place must be findable when the defect is
     fixed, or it becomes the thing that fails and gets "corrected" by
     someone who does not know why it was written. */
  ok(C._nd.kneeOut(Infinity, -1, 6, 0) === -1,
     'shared ND.kneeOut at INFINITE ratio now returns the threshold, not NaN');
  ok(C._nd.kneeOut(Infinity, -1, 0, 0) === -1,
     '  and the hard-knee branch (W <= 0) too');
  ok(C._nd.kneeOut(Infinity, -1, 6, 0.25) === Infinity,
     '  while a FINITE ratio still returns Infinity, exactly as it always did');
  ok(C._nd.kneeOut(NaN, -1, 6, 0) !== C._nd.kneeOut(NaN, -1, 6, 0),
     '  and a NaN input is still reported as NaN rather than swallowed by the guard');
  /* the fix must not have moved the finite domain by one bit */
  (function () {
    var bad = 0, n = 0;
    for (var T = -24; T <= 0; T += 0.37)
      for (var W = 0; W <= 12; W += 0.61)
        for (var x = -60; x <= 24; x += 0.13) {
          var d = x - T, want;
          if (W <= 0) want = d <= 0 ? x : T + d * 0;
          else if (d < -W / 2) want = x;
          else if (d > W / 2) want = T + d * 0;
          else want = x + (0 - 1) * (d + W / 2) * (d + W / 2) / (2 * W);
          n++;
          if (!Object.is(want, C._nd.kneeOut(x, T, W, 0))) bad++;
        }
    ok(bad === 0, '  and the finite domain is bit-identical across ' +
       n.toLocaleString('en-US') + ' points — which is what let it be changed at all');
  })();
  ok(C.truePeakOf(zeros(64), 4, 0) === 0, 'truePeakOf(silence) is exactly 0, not NaN');
  ok(C.loudnessOf(0) === -Infinity, 'loudnessOf(0) is -Infinity — correct, and the contagion starts here');
  ok(isFinite(C._nd.linToDb(0)), 'linToDb(0) is floored and finite — this is why peakDb never went NaN');
})();

console.log('\n— the state sanitiser, handed the values a corrupt file supplies —');
(function () {
  var junk = { drive: NaN, lid: -Infinity, vigil: 'x', margin: undefined,
               targetLufs: Infinity, msMid: NaN, msSide: null, style: 42, dust: {} };
  var s = C.sanitizeState(junk);
  clean('sanitizeState scrubs NaN, Infinity, strings, null and objects', s);
  ok(C.STYLES.indexOf(s.style) >= 0, '  and an out-of-range style falls back to a real arrangement');
  var r = C.renderOffline(s, C.makeNoise(1, 1024), C.makeNoise(2, 1024), FS);
  clean('  and the scrubbed state renders clean', r);
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
console.log('no NaN reached the surface. silence stays silent.');
