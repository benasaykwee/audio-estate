/* CASKET fuzzer — node tests/casket_fuzz.js [iterations]
   The boundary sweep finds the bugs I thought to look for. This finds the
   ones I didn't. Thousands of random LEGAL states are pushed through
   hostile material and four invariants are asserted every time:

     1. nothing is NaN or infinite, ever
     2. no output sample exceeds the lid (the whole thesis)
     3. reported latency equals measured latency
     4. an idle unsealed limiter is bit-identical to its delayed input

   Deterministic: the state generator is seeded, so a failure reports a
   seed that reproduces it exactly. A fuzzer you cannot re-run is a
   fuzzer that finds a bug once and then loses it. */
'use strict';
var C = require('../casket_core.js');
var ND = require('../../shared/necrodyn.js');

/* SAMPLE RATES. Everything in the core derives from fs — K-weighting,
   filter design, every time constant, the sub-block length — but almost
   every other test runs at 48 k. Sweeping the rates here is cheap and it
   is exactly the class of gap the shaped-dither bug lived in. */
var RATES = [44100, 48000, 88200, 96000, 192000];
var ITERS = parseInt(process.argv[2], 10) || 1200;

/* --seed=17183[,17184]  — replay exactly these cases and nothing else.
   The header above promises that a reported seed reproduces a failure
   exactly. That was true and useless: seeds are 1000 + iteration, so
   reproducing seed 17183 meant re-running the 16,183 cases in front of it,
   about three minutes to reach one case that takes milliseconds. The
   nightly deep fuzz reports seeds nobody can afford to chase.
   Everything about a case derives from `ND.lcg(seed)`, so a seed is a
   complete description of it and can simply be run on its own. */
var SEEDS = (function () {
  var a = process.argv.slice(2).filter(function (x) { return x.indexOf('--seed=') === 0; })[0];
  return a ? a.slice(7).split(',').map(Number).filter(function (n) { return isFinite(n); }) : null;
})();
var N = 2400;                       // samples per case — small and many
var fails = 0, checked = 0, blkUsed;
var worstHeadroom = Infinity, worstAt = '';

function rnd(r, lo, hi) { return lo + r() * (hi - lo); }
function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }

/* a random but always LEGAL state — the point is to exercise the engine,
   not the sanitiser (the sanitiser has its own tests) */
function randomState(r) {
  var style = pick(r, C.STYLES);
  var s = C.defaultState(), d = C.styleDefaults(style);
  for (var k in d) s[k] = d[k];
  s.style = style;
  s.drive = rnd(r, -12, 24);
  s.lid = rnd(r, -20, 0);
  s.margin = rnd(r, -1, 0);
  s.knee = rnd(r, 0, 12);
  s.vigil = rnd(r, 0.1, 20);
  s.release = rnd(r, 1, 1000);
  s.hold = rnd(r, 0, 500);
  s.link = rnd(r, 0, 100);
  s.sat = r() < 0.3 ? rnd(r, 0, 100) : 0;
  s.lining = pick(r, C.LININGS);
  s.seal = r() < 0.35;
  s.autoRel = r() < 0.5;
  s.dc = r() < 0.5;
  s.unity = r() < 0.25;
  s.ms = r() < 0.3;
  s.msMid = s.ms ? rnd(r, -12, 12) : 0;
  s.msSide = s.ms ? rnd(r, -12, 12) : 0;
  s.dust = pick(r, C.DUSTS);
  s.dustBits = pick(r, C.DUST_BITS);
  s.dustSeed = 1 + Math.floor(r() * 100000);
  return C.sanitizeState(s);
}

/* hostile material, chosen to break things rather than to sound nice */
function randomSignal(r, n, FS) {
  var kind = Math.floor(r() * 7), a = new Float64Array(n), i;
  var amp = rnd(r, 0.05, 1.0);
  if (kind === 0) {                                   // clipped noise
    var v = ND.makeNoise(1 + Math.floor(r() * 99999), n);
    var g = rnd(r, 1, 12);
    for (i = 0; i < n; i++) { var t = v[i] * g; a[i] = t > 1 ? 1 : (t < -1 ? -1 : t) * amp; }
  } else if (kind === 1) {                            // square
    a = C.makeSquare(rnd(r, 40, 4000), FS, n, amp);   // period is in samples, rate-agnostic
  } else if (kind === 2) {                            // impulse train
    a = C.makeImpulses(2 + Math.floor(r() * 200), n, amp);
  } else if (kind === 3) {                            // sine, sometimes near Nyquist
    a = C.makeSine(rnd(r, 20, FS * 0.49), FS, n, amp);
  } else if (kind === 4) {                            // DC step
    var at = Math.floor(n * rnd(r, 0.1, 0.9));
    for (i = at; i < n; i++) a[i] = amp;
  } else if (kind === 5) {                            // digital silence
    /* left at zero on purpose — silence has broken more DSP than noise */
  } else {                                            // full-scale alternating
    for (i = 0; i < n; i++) a[i] = (i % 2 ? amp : -amp);
  }
  return a;
}

function fail(msg, seed, st, rate) {
  fails++;
  if (fails <= 6) {
    console.log('  ✗ ' + msg);
    console.log('      seed ' + seed + '  style ' + st.style +
                ' lid ' + st.lid.toFixed(2) + ' margin ' + st.margin.toFixed(2) +
                ' drive ' + st.drive.toFixed(1) + ' lining ' + st.lining +
                (st.seal ? ' SEALED' : '') + (st.ms ? ' M/S' : '') +
                ' vigil ' + st.vigil.toFixed(2) + ' dust ' + st.dust +
                ' @ ' + (rate || '?') + ' Hz' +
                (typeof blkUsed !== 'undefined' ? ' blk ' + blkUsed : ''));
  }
}

console.log(SEEDS
  ? 'CASKET fuzzer — replaying seed(s) ' + SEEDS.join(', ')
  : 'CASKET fuzzer — ' + ITERS + ' random states × ' + N +
    ' samples, across ' + RATES.join(' / ') + ' Hz');

/* --from=N — start at iteration N instead of 0, so a long run can be split
   across several windows. Twenty thousand states is about three and a half
   minutes, which is longer than some environments allow one process. */
var FROM = (function () {
  var a = process.argv.slice(2).filter(function (x) { return x.indexOf('--from=') === 0; })[0];
  return a ? parseInt(a.slice(7), 10) : 0;
})();

var SEED_LIST = SEEDS || (function () {
  var a = []; for (var i = FROM; i < ITERS; i++) a.push(1000 + i); return a;
})();

for (var it = 0; it < SEED_LIST.length; it++) {
  var seed = SEED_LIST[it];
  var r = ND.lcg(seed);
  var FS = pick(r, RATES);
  var st = randomState(r);
  var inL = randomSignal(r, N, FS), inR = randomSignal(r, N, FS);
  var oL = new Float64Array(N), oR = new Float64Array(N);
  var e = C.createEngine(FS);
  e.setState(st);
  /* BUFFER SIZE IS A FUZZED DIMENSION TOO, and deliberately awkward.
     The control-phase bug hid for a whole round because every test
     rendered in one call or in multiples of CTRL, and every buffer size
     anyone reaches for first is a power of two. Primes and odd sizes are
     now in the rotation so that class cannot recur silently. */
  var CHUNKS = [0, 1, 7, 32, 111, 128, 333, 512, 1024, 2400];
  var blk = pick(r, CHUNKS); blkUsed = blk || 'whole';
  if (blk === 0) {
    e.process(inL, inR, oL, oR);
  } else {
    for (var bp = 0; bp < N; bp += blk) {
      var bm = Math.min(blk, N - bp);
      e.process(inL.subarray(bp, bp + bm), inR.subarray(bp, bp + bm),
                oL.subarray(bp, bp + bm), oR.subarray(bp, bp + bm));
    }
  }
  checked++;

  /* 1. finite */
  var bad = 0, i;
  for (i = 0; i < N; i++) if (!isFinite(oL[i]) || !isFinite(oR[i])) bad++;
  if (bad) { fail(bad + ' non-finite samples', seed, st, FS); continue; }

  /* 2. the lid holds. The clamp guarantees the sample domain, so any
        violation here is a broken clamp, not a broken theorem. */
  var lidLin = ND.dbToLin(st.lid + st.margin);
  /* ZERO tolerance, dither included. The dithered output is clamped to
     the largest quantisation step at or below the lid, so there is no
     budget to allow for — a violation here is a real violation. */
  var tol = 0;
  var over = 0, peak = 0;
  for (i = 0; i < N; i++) {
    var al = Math.abs(oL[i]), ar = Math.abs(oR[i]);
    if (al > peak) peak = al;
    if (ar > peak) peak = ar;
    if (al > lidLin + tol || ar > lidLin + tol) over++;
  }
  if (over) { fail(over + ' samples over the lid (peak ' +
                   (20 * Math.log10(peak)).toFixed(4) + ' vs ' +
                   (st.lid + st.margin).toFixed(2) + ')', seed, st, FS); continue; }
  if (peak > 0) {
    var head = 20 * Math.log10(lidLin / peak);
    if (head < worstHeadroom) {
      worstHeadroom = head;
      worstAt = st.style + (st.seal ? ' sealed' : '') + ' lid ' + st.lid.toFixed(2);
    }
  }

  /* 3. reported latency is honest — impulse in, find it coming out */
  var lat = C.latencySamples(st, FS);
  var imp = new Float64Array(N), zer = new Float64Array(N);
  imp[200] = 0.01;                       // small enough never to be limited
  var e2 = C.createEngine(FS);
  var quiet = C.sanitizeState(st);
  quiet.lid = 0; quiet.margin = 0; quiet.drive = 0; quiet.dust = 'off';
  quiet.dc = false; quiet.sat = 0; quiet.ms = false; quiet.unity = false;
  e2.setState(quiet);
  var pL = new Float64Array(N), pR = new Float64Array(N);
  e2.process(imp, zer, pL, pR);
  var at = -1, mx = 0;
  for (i = 0; i < N; i++) if (Math.abs(pL[i]) > mx) { mx = Math.abs(pL[i]); at = i; }
  var wantLat = C.latencySamples(quiet, FS);
  if (at !== 200 + wantLat) {
    fail('latency lies: impulse at ' + at + ', reported ' + (200 + wantLat), seed, quiet, FS);
    continue;
  }

  /* 4. an idle UNSEALED limiter is bit-identical to its delayed input */
  if (!quiet.seal) {
    var e3 = C.createEngine(FS);
    e3.setState(quiet);
    var q = ND.makeNoise(seed, N);
    for (i = 0; i < N; i++) q[i] *= 0.02;
    var qL = new Float64Array(N), qR = new Float64Array(N);
    e3.process(q, q, qL, qR);
    var errs = 0;
    for (i = wantLat; i < N; i++) if (qL[i] !== q[i - wantLat]) errs++;
    if (errs) { fail('idle unsealed output is not bit-identical (' + errs + ')', seed, quiet, FS); }
  }
}

console.log('\n' + checked + ' states exercised, ' + fails + ' failures');
if (!fails) {
  console.log('tightest headroom seen: ' + worstHeadroom.toFixed(5) +
              ' dB under the lid  (' + worstAt + ')');
  console.log('nothing got out.');
}
process.exit(fails ? 1 : 0);
