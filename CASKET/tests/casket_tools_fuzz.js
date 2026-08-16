/* CASKET offline-tools fuzzer — node tests/casket_tools_fuzz.js [iters]
   renderOffline, autoDrive, difference, matchReference and autoMargin all
   do arithmetic on user-supplied audio, all were added recently, and none
   had ever seen a random state. The engine fuzzer found a real bug in its
   first 400 states; these had seen zero.

   The invariants are different from the engine's, because these functions
   return NUMBERS and ADVICE rather than a stream:
     - nothing returns NaN or Infinity where a real number is promised
     - autoDrive's answer, when applied, actually lands near its target
     - difference against self is exactly zero, always
     - autoMargin never rounds toward the unsafe side, and says so honestly
       when it cannot cover the residual
     - none of them mutates the state it was handed */
'use strict';
var C = require('../casket_core.js');
var ND = require('../../shared/necrodyn.js');

var ITERS = parseInt(process.argv[2], 10) || 60;
/* Deliberately short material. autoDrive alone does nine full renders per
   call, so a 4-second buffer at 96 k means ~36 s of audio rendered per
   iteration before the other four tools have run. Short and many beats
   long and few for finding bugs, and this harness is about coverage of
   STATES rather than of durations. */
var RATES = [44100, 48000];
var fails = 0, checked = 0;
function fail(msg, seed) {
  fails++;
  if (fails <= 8) console.log('  ✗ ' + msg + '   [seed ' + seed + ']');
}
function rnd(r, lo, hi) { return lo + r() * (hi - lo); }
function pick(r, a) { return a[Math.floor(r() * a.length) % a.length]; }

function randomState(r) {
  var style = pick(r, C.STYLES);
  var s = C.defaultState(), d = C.styleDefaults(style);
  for (var k in d) s[k] = d[k];
  s.style = style;
  s.lid = rnd(r, -20, 0);
  s.margin = rnd(r, -1, 0);
  s.drive = rnd(r, -12, 24);
  s.knee = rnd(r, 0, 12);
  s.vigil = rnd(r, 0.1, 20);
  s.release = rnd(r, 1, 1000);
  s.lining = pick(r, C.LININGS);
  s.seal = r() < 0.35;
  s.ms = r() < 0.3;
  s.msMid = s.ms ? rnd(r, -12, 12) : 0;
  s.msSide = s.ms ? rnd(r, -12, 12) : 0;
  s.dust = pick(r, C.DUSTS);
  s.dustBits = pick(r, C.DUST_BITS);
  s.sat = r() < 0.25 ? rnd(r, 0, 100) : 0;
  s.dc = r() < 0.5;
  s.targetLufs = rnd(r, -30, -5);
  return C.sanitizeState(s);
}

/* material: mostly musical, sometimes degenerate — the degenerate cases
   are where a loudness measurement returns -Infinity and everything
   downstream has a chance to become NaN */
function randomAudio(r, n, fs) {
  var kind = Math.floor(r() * 6), a = new Float64Array(n), i;
  if (kind === 0) return a;                       // digital silence
  if (kind === 1) { for (i = 0; i < n; i++) a[i] = 1e-300; return a; }  // sub-audible
  if (kind === 2) {                                // clipped noise
    var v = ND.makeNoise(1 + Math.floor(r() * 9999), n), g = rnd(r, 1, 10);
    for (i = 0; i < n; i++) { var t = v[i] * g; a[i] = t > 1 ? 1 : (t < -1 ? -1 : t); }
    return a;
  }
  if (kind === 3) return C.makeSine(rnd(r, 30, fs * 0.4), fs, n, rnd(r, 0.01, 1));
  if (kind === 4) {                                // harmonic
    [55, 110, 220, 440, 880, 1760].forEach(function (f, k) {
      for (i = 0; i < n; i++) a[i] += Math.sin(2 * Math.PI * f * i / fs + k * 0.7) / 6;
    });
    var m = 0;
    for (i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i]));
    for (i = 0; i < n; i++) a[i] *= rnd(r, 0.05, 0.98) / m;
    return a;
  }
  for (i = 0; i < n; i++) a[i] = (i % 2 ? 0.95 : -0.95);   // full-scale alternating
  return a;
}

console.log('CASKET offline-tools fuzzer — ' + ITERS + ' random states\n');

for (var it = 0; it < ITERS; it++) {
  var seed = 5000 + it;
  var r = ND.lcg(seed);
  var fs = pick(r, RATES);
  var st = randomState(r);
  var n = Math.round(fs * rnd(r, 0.4, 0.9));
  var L = randomAudio(r, n, fs), R = randomAudio(r, n, fs);
  checked++;

  var before = JSON.stringify(st);

  /* --- renderOffline --- */
  var ro = C.renderOffline(st, L, R, fs);
  if (ro.L.length !== n || ro.R.length !== n) { fail('renderOffline changed the length', seed); continue; }
  var badF = 0;
  for (var i = 0; i < n; i++) if (!isFinite(ro.L[i]) || !isFinite(ro.R[i])) badF++;
  if (badF) { fail('renderOffline produced ' + badF + ' non-finite samples', seed); continue; }
  if (ro.latency !== C.latencySamples(st, fs)) { fail('renderOffline latency disagrees', seed); continue; }

  /* --- autoDrive --- */
  var tgt = st.targetLufs;
  var ad = C.autoDrive(st, L, R, fs, tgt, 6);   // 6 passes is plenty to test the contract
  if (!ad || !isFinite(ad.drive)) { fail('autoDrive returned a non-finite drive', seed); continue; }
  if (ad.drive < -12.0001 || ad.drive > 24.0001) { fail('autoDrive left the legal range', seed); continue; }
  /* if the material has ANY loudness at all, applying the answer must land
     near the target — silence and 1e-300 legitimately cannot reach it */
  if (isFinite(ad.lufs) && ad.lufs > -60) {
    var ap = C.sanitizeState(st); ap.drive = ad.drive; ap.unity = false;
    var got = C.renderOffline(ap, L, R, fs).meters.integrated;
    if (isFinite(got) && Math.abs(got - ad.lufs) > 0.05) {
      fail('autoDrive predicted ' + ad.lufs.toFixed(2) + ' but re-rendering gives ' +
           got.toFixed(2), seed);
      continue;
    }
  }

  /* --- difference --- */
  var same = C.difference(st, st, L, R, fs);
  if (!same.identical) { fail('difference against ITSELF is not identical', seed); continue; }
  var other = randomState(ND.lcg(seed + 77777));
  var d2 = C.difference(st, other, L, R, fs);
  if (!isFinite(d2.peakDb) && d2.peakDb !== -Infinity) { fail('difference peak is NaN', seed); continue; }
  for (i = 0; i < n; i++) if (!isFinite(d2.L[i])) { badF++; break; }
  if (badF) { fail('difference produced non-finite samples', seed); continue; }

  /* --- autoMargin --- */
  var am = C.autoMargin(st, L, R, fs, 3);
  if (!am || !isFinite(am.margin)) { fail('autoMargin returned a non-finite margin', seed); continue; }
  if (am.margin > 0 || am.margin < -1) { fail('autoMargin left the legal range', seed); continue; }
  /* never round toward the unsafe side: the suggestion must cover at least
     the residual, or admit it cannot */
  if (am.covered && am.residual > 0 && -am.margin + 1e-9 < am.residual) {
    fail('autoMargin claims covered but the margin is smaller than the residual', seed);
    continue;
  }
  if (am.covered && isFinite(am.residual) && am.residual > 0) {
    var ap2 = C.sanitizeState(st); ap2.margin = am.margin;
    var o2 = C.renderOffline(ap2, L, R, fs);
    var tp = ND.linToDb(Math.max(C.truePeakOf(o2.L, 16, 64), C.truePeakOf(o2.R, 16, 64)));
    if (isFinite(tp) && tp > st.lid + 0.05) {
      fail('autoMargin said covered but the render is still ' +
           (tp - st.lid).toFixed(3) + ' dB over', seed);
      continue;
    }
  }

  /* --- matchReference --- */
  var mr = C.matchReference(st, L, R, R, L, fs);
  if (!mr || !mr.gap) { fail('matchReference returned nothing', seed); continue; }
  /* null is the honest answer for an uncomputable gap; NaN is not */
  ['lufs', 'truePeak', 'lra'].forEach(function (kk) {
    var v = mr.gap[kk];
    if (v !== null && !isFinite(v)) fail('matchReference gap.' + kk + ' is ' + v, seed);
  });

  /* --- THE OPTION SURFACE ---
     batchRender and albumMaster grew arguments the fuzzer did not know
     existed: gapless, three dither policies, and the proxy search. An
     option nobody fuzzes is an option nobody has tested on anything but
     the one case its author had in mind. */
  var gapless = r() < 0.5;
  var policy = ['perTrack', 'same', 'continuous'][(r() * 3) | 0];
  var bopts = { gapless: gapless, dust: policy };
  var half = (L.length / 2) | 0;
  var rec = [
    { name: 'a', L: L.subarray(0, half), R: R.subarray(0, half) },
    { name: 'b', L: L.subarray(half), R: R.subarray(half) }
  ];

  var br = C.batchRender(st, rec, fs, bopts);
  if (!br || br.tracks.length !== 2) { fail('batchRender lost a track', seed); continue; }
  for (var bi = 0; bi < br.tracks.length; bi++) {
    var bt = br.tracks[bi];
    if (bt.L.length !== rec[bi].L.length) { fail('batchRender changed a track length', seed); break; }
    var bn = 0;
    for (var bj = 0; bj < bt.L.length; bj++) {
      if (bt.L[bj] !== bt.L[bj] || bt.R[bj] !== bt.R[bj]) { bn++; break; }
    }
    if (bn) { fail('batchRender produced NaN (gapless ' + gapless + ', dust ' + policy + ')', seed); break; }
  }

  /* GAPLESS MUST JOIN CLEANLY. The whole point is that the limiter's
     state carries across a track boundary, so the last sample of one
     track and the first of the next must be as continuous as they were
     in the source. A discontinuity here is an audible click on a live
     record, and it would never show up in a per-track test. */
  if (gapless) {
    var g = C.batchRender(st, rec, fs, { gapless: true });
    var whole = C.renderOffline(st, L, R, fs);
    var joinBad = 0;
    for (var gi = 0; gi < g.tracks[0].L.length; gi++) {
      if (g.tracks[0].L[gi] !== whole.L[gi]) { joinBad++; break; }
    }
    for (var gj = 0; gj < g.tracks[1].L.length; gj++) {
      if (g.tracks[1].L[gj] !== whole.L[half + gj]) { joinBad++; break; }
    }
    if (joinBad) { fail('gapless split does not equal one continuous render', seed); continue; }
  }

  /* the proxy search must not change the answer — it exists to be
     cheaper, and a cheaper answer that differs is just a wrong answer */
  /* SAMPLED, not skipped. Two albumMaster searches cost more than the
     other five tools combined, so running them on every state trades a
     lot of state coverage for a little option coverage. Every fourth
     state keeps both — the seeds are deterministic, so this is a stride
     through the same space rather than a hole in it. */
  if (it % 4) {
    if (JSON.stringify(st) !== before) { fail('a tool MUTATED the state it was handed', seed); }
    continue;
  }
  var apx = C.albumMaster(st, rec, fs, st.targetLufs, { passes: 3, proxySeconds: 0.6 });
  var afl = C.albumMaster(st, rec, fs, st.targetLufs, { passes: 3, proxy: false });
  if (!isFinite(apx.drive) || !isFinite(afl.drive)) {
    fail('albumMaster returned a non-finite drive', seed); continue;
  }
  /* THE CONTRACT IS NOT "IDENTICAL", AND CLAIMING IT WAS COST AN HOUR.
     The two searches bisect DIFFERENT functions — one a slice, one the
     whole record — so their bisection paths differ and they can land on
     neighbouring grid points. Demanding an identical drive is demanding
     that two different algorithms be the same algorithm.
     What actually matters to a user is that the cheap search is not
     WORSE. That is falsifiable, it is the property the feature exists to
     have, and it fails loudly if the proxy ever misleads. */
  /* Only meaningful when the target is actually attainable. When it is
     NOT — a record already far louder than asked for, so both searches
     just report their closest miss — the two "answers" are arbitrary
     points on a curve that never crosses the target, and comparing them
     measures nothing. Seed 5036 made that concrete: 9.4 LU off against
     8.8 LU off, drives 18 and 6, both equally useless and neither wrong. */
  var eP = Math.abs(apx.error), eF = Math.abs(afl.error);
  var attainable = afl.reached || eF <= 1.0;
  if (attainable && isFinite(eP) && isFinite(eF) && eP > eF + 0.15) {
    fail('the proxy search is WORSE: ' + eP.toFixed(3) + ' LU off vs the full search\'s ' +
         eF.toFixed(3) + ' (drive ' + apx.drive + ' vs ' + afl.drive + ')', seed);
    continue;
  }
  /* And the proxy is frequently BETTER, which surprised me enough to
     check twice. It refines inside a narrow bracket, so with the same
     pass count it resolves far finer than bisecting the whole 36 dB
     range — the fuzzer found states where the cheap search hits the
     target and the expensive one misses. Being better is not a failure,
     so there is no assertion in that direction; what IS asserted is that
     `reached` never lies, which is checked below against the measured
     error rather than against the other search's opinion. */
  if (apx.reached && isFinite(apx.error) && Math.abs(apx.error) > 0.1001) {
    fail('the proxy says reached but is ' + Math.abs(apx.error).toFixed(3) + ' LU off', seed);
    continue;
  }
  if (apx.reached && isFinite(apx.album.integrated) &&
      Math.abs(apx.album.integrated - apx.target) > 0.1001) {
    fail('albumMaster claims reached but is ' +
         Math.abs(apx.album.integrated - apx.target).toFixed(3) + ' LU off', seed);
    continue;
  }

  /* --- none of them may mutate the caller's state --- */
  if (JSON.stringify(st) !== before) { fail('a tool MUTATED the state it was handed', seed); continue; }
}

console.log(checked + ' states exercised, ' + fails + ' failures');
if (!fails) console.log('the offline tools hold.');
process.exit(fails ? 1 : 0);
