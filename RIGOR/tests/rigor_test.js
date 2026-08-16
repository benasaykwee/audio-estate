/* RIGOR core tests — node tests/rigor_test.js */
'use strict';
var R = require('../rigor_core.js');
var ND = require('../../shared/necrodyn.js');
var A = require('../../AUTOPSY/autopsy_core.js');
var FS = 48000;
var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
function near(a, b, eps, name) { ok(Math.abs(a - b) <= eps, name + ' (' + a + ' ≈ ' + b + ')'); }
function note(s) { console.log('    · ' + s); }
function db(x) { return 20 * Math.log10(Math.abs(x) + 1e-300); }
function styled(name, patch) {
  var s = R.defaultState(), d = R.styleDefaults(name);
  for (var k in d) s[k] = d[k];
  s.style = name;
  if (patch) for (var k2 in patch) s[k2] = patch[k2];
  return s;
}

console.log('RIGOR core v' + R.VERSION + ' — the body stops moving');

/* ============================================================
   1. the shared substrate
   ============================================================ */
console.log('\n— the shared substrate —');
(function () {
  /* AUTOPSY keeps its own copies of these on purpose (sealed artifact).
     This is what stops the two from drifting. */
  /* AUTOPSY's 12 dB/oct cut is Butterworth: Q = 1/(2·cos(π/4)).
     It must be computed with NM.cos, not Math.cos — the two disagree in
     the last ulp, which survives into the coefficients at some
     frequencies and not others (100 Hz and 1 kHz happen to agree, 8 kHz
     does not). That is the whole reason necromath exists, demonstrated
     here in miniature. */
  var BW_Q = 1 / (2 * ND._nm.cos(Math.PI / 4));
  var same = true;
  [100, 1000, 8000, 15000].forEach(function (f) {
    var a = A.designBand({ on: true, type: 'lowcut', freq: f, gain: 0, q: 1, slope: 12 }, FS)[0];
    var b = ND.secSosHP(f, BW_Q, FS);
    ['b0', 'b1', 'b2', 'a1', 'a2'].forEach(function (k) {
      if (a[k] !== b[k]) same = false;
    });
  });
  ok(same, 'ND.secSosHP is bit-identical to AUTOPSY\'s Butterworth highpass section');
  ok(BW_Q !== 1 / (2 * Math.cos(Math.PI / 4)),
     'and NM.cos genuinely differs from Math.cos here — the test has teeth');
  var lp = ND.secSosLP(1000, Math.SQRT1_2, FS);
  ok(isFinite(lp.b0) && isFinite(lp.a2), 'ND.secSosLP designs');

  /* invR: the one place a magic value lives, so it gets asserted */
  ok(R.invRatio(1) === 1, 'ratio 1:1 gives invR exactly 1');
  ok(R.invRatio(4) === 0.25, 'ratio 4:1 gives invR 0.25');
  ok(R.invRatio(R.RATIO_INF) === 0, 'ratio ∞ gives invR EXACTLY 0, not 1/1000');
  ok(R.invRatio(R.RATIO_INF + 500) === 0, 'anything past ∞ is still exactly 0');

  /* knee C1 continuity, both junctions, at a real ratio */
  var T = -18, W = 8, ir = 0.25;
  near(ND.kneeGain(T - W / 2, T, W, ir), 0, 1e-12, 'no reduction entering the knee');
  near(ND.kneeGain(T + W / 2, T, W, ir), (W / 2) * (ir - 1), 1e-12, 'knee meets the linear branch');
  var h = 1e-6;
  var d1 = (ND.kneeGain(T - W / 2 + h, T, W, ir) - ND.kneeGain(T - W / 2 - h, T, W, ir)) / (2 * h);
  near(d1, 0, 1e-4, 'slope is 0 entering the knee (C¹)');
  var d2 = (ND.kneeGain(T + W / 2 + h, T, W, ir) - ND.kneeGain(T + W / 2 - h, T, W, ir)) / (2 * h);
  near(d2, ir - 1, 1e-4, 'slope is (1/R − 1) leaving the knee (C¹)');
  /* monotonic: more input never means less reduction */
  var mono = true, prev = 1;
  for (var x = -60; x <= 12; x += 0.05) {
    var g = ND.kneeGain(x, T, W, ir);
    if (g > prev + 1e-12) mono = false;
    prev = g;
  }
  ok(mono, 'gain reduction is monotonic in level');

  /* THE BOUNDARY SWEEP.
     Every bug this codebase has produced lives at a legal value that is
     also a boundary value — AUTOPSY's `isFinite` threshold of 0, CASKET's
     knee branch, the `y < x` guard. So sweep the boundaries on purpose:
     W = 0 with x exactly at T is the case where a `>` instead of a `>=`
     would drop through to the knee branch and evaluate 0/0. A NaN there
     is unrecoverable in a feedback topology. */
  var nan = 0, pts = 0;
  [0, 1e-12, 0.5, 6, 30].forEach(function (W) {
    [0, 0.001, 0.25, 1].forEach(function (ir) {
      for (var x2 = -60; x2 <= 12; x2 += 0.05) {
        [x2, -18 - W / 2, -18 + W / 2, -18].forEach(function (xx) {
          var g = ND.kneeGain(xx, -18, W, ir);
          var o = ND.kneeOut(xx, -18, W, ir);
          pts += 2;
          if (!isFinite(g) || !isFinite(o)) nan++;
        });
      }
    });
  });
  ok(nan === 0, 'no NaN or infinity anywhere on the boundary sweep (' + pts + ' points)');
  ok(ND.kneeGain(-18, -18, 0, 0.25) === 0, 'hard knee exactly AT threshold returns exactly 0');
  ok(ND.kneeOut(-18, -18, 0, 0.25) === -18, 'and passes the level through untouched');
})();

/* ============================================================
   2. THE NULL TEST — the single most valuable assertion here
   ============================================================ */
console.log('\n— the null test —');
(function () {
  var n = 16384;
  R.STYLES.forEach(function (style) {
    var s = styled(style, { ratio: 1, thresh: -40, mix: 100, makeup: 0, autoMakeup: false });
    var e = R.createEngine(FS); e.setState(s);
    var x = R.makeNoise(4242, n), y = R.makeNoise(9111, n);
    for (var i = 0; i < n; i++) { x[i] *= 0.3; y[i] *= 0.3; }
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(x, y, oL, oR);
    var bad = 0;
    for (i = 0; i < n; i++) { if (oL[i] !== x[i]) bad++; if (oR[i] !== y[i]) bad++; }
    ok(bad === 0, style + ' at 1:1 is BIT-IDENTICAL to its input');
  });

  R.STYLES.forEach(function (style) {
    var s = styled(style, { ratio: 8, thresh: 0, knee: 0, makeup: 0 });
    var e = R.createEngine(FS); e.setState(s);
    var x = R.makeNoise(31337, n);
    for (var i = 0; i < n; i++) x[i] *= 0.02;   // −34 dBFS, nowhere near a 0 dB threshold
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(x, x, oL, oR);
    var bad = 0;
    for (i = 0; i < n; i++) if (oL[i] !== x[i]) bad++;
    ok(bad === 0, style + ' below threshold is BIT-IDENTICAL to its input');
  });

  /* mix = 0 must return the DELAYED dry, exactly — this is what proves
     the lookahead alignment and that the dry tap sits after the delay */
  var s2 = styled('fresh', { ratio: 8, thresh: -40, mix: 0, look: 5, makeup: 0 });
  var e2 = R.createEngine(FS); e2.setState(s2);
  var x2 = R.makeNoise(606, n);
  var a2 = new Float64Array(n), b2 = new Float64Array(n);
  e2.process(x2, x2, a2, b2);
  var lat = R.latencySamples(s2, FS), bad2 = 0;
  for (var i2 = lat; i2 < n; i2++) if (a2[i2] !== x2[i2 - lat]) bad2++;
  ok(bad2 === 0, 'mix = 0 % returns the delayed dry BIT-EXACTLY (' + lat + ' samples)');
  ok(lat === Math.round(5 * 0.001 * FS), 'reported latency matches the lookahead setting');
})();

/* ============================================================
   3. the numbers a compressor is judged on
   ============================================================ */
console.log('\n— behaviour —');
(function () {
  /* Steady state must match the transfer function — on a signal whose
     level actually IS steady. A square wave has constant |x|, which is
     precisely what a static curve describes; a sine does not, because a
     peak detector follows the instantaneous peak and that dips twice a
     cycle. Both are asserted, with the sine's tolerance set by the
     follower's droop rather than pretended away. */
  var s = styled('fresh', { thresh: -20, ratio: 4, knee: 0, attack: 100, release: 800,
                            autoRel: false, makeup: 0, mix: 100 });
  var n = FS * 3, i;
  var amp = Math.pow(10, -8 / 20);
  var sq = new Float64Array(n);
  for (i = 0; i < n; i++) sq[i] = (i % 480) < 240 ? amp : -amp;   // 100 Hz, |x| constant
  var e = R.createEngine(FS); e.setState(s);
  var oL = new Float64Array(n), oR = new Float64Array(n);
  e.process(sq, sq, oL, oR);
  var mx = 0;
  for (i = n - FS; i < n; i++) mx = Math.max(mx, Math.abs(oL[i]));
  near(db(mx), R.transferAt(s, -8), 0.001, '4:1 steady state matches transferAt on a constant level');

  var sig = R.makeSine(200, FS, n, amp);
  var e2 = R.createEngine(FS); e2.setState(s);
  var p2 = new Float64Array(n), q2 = new Float64Array(n);
  e2.process(sig, sig, p2, q2);
  var mx2 = 0;
  for (i = n - FS; i < n; i++) mx2 = Math.max(mx2, Math.abs(p2[i]));
  near(db(mx2), R.transferAt(s, -8), 0.25, 'and lands within a quarter dB on a 200 Hz sine');
  note('the gap is the peak follower drooping ' +
       (-20 * Math.log10(Math.exp(-5 / 15))).toFixed(2) +
       ' dB between peaks at 200 Hz — real, documented, and not a sign error');
  near(R.transferAt(s, -8), -17, 1e-9, 'transferAt: −8 in at 4:1 over −20 gives −17');
  near(R.transferAt(s, -30), -30, 1e-9, 'transferAt: below threshold is unity');

  [2, 4, 10, R.RATIO_INF].forEach(function (ratio) {
    var st = styled('fresh', { thresh: -20, ratio: ratio, knee: 0, makeup: 0 });
    var over = 10, expected = -20 + over * R.invRatio(ratio);
    near(R.transferAt(st, -20 + over), expected, 1e-9,
         'ratio ' + (ratio >= R.RATIO_INF ? '∞' : ratio) + ':1 — 10 dB over lands at ' + expected.toFixed(1));
  });
})();

(function () {
  /* ENVELOPE TIMING. Attack is DEFINED as time to 63.2 % of the target
     gain reduction; this is the test that catches an off-by-one in the
     coefficient. A DC step gives a constant detector level, so the target
     is known exactly. */
  var ATT = 20;
  var s = styled('fresh', { thresh: -30, ratio: 4, knee: 0, attack: ATT, release: 2000,
                            autoRel: false, makeup: 0, hold: 0 });
  var n = FS;
  var lvl = Math.pow(10, -10 / 20);
  var x = R.makeStep(FS, n, 0, lvl, 0.25);
  var e = R.createEngine(FS); e.setState(s);
  var oL = new Float64Array(n), oR = new Float64Array(n);
  e.process(x, x, oL, oR);
  var at = Math.floor(n * 0.25);
  var target = R.transferAt(s, -10) - (-10);          // dB of reduction, < 0
  var want = target * (1 - 1 / Math.E);
  var wantN = at + Math.round(ATT * 0.001 * FS);
  var got = db(oL[wantN]) - db(lvl);
  near(got, want, 0.02, 'attack reaches 63.2 % of target at exactly ' + ATT + ' ms');
  note('target ' + target.toFixed(3) + ' dB · 63.2 % = ' + want.toFixed(3) +
       ' dB · measured ' + got.toFixed(3) + ' dB');
  var settled = db(oL[n - 1]) - db(lvl);
  near(settled, target, 0.01, 'and settles on the target');
})();

(function () {
  /* range clamps the reduction and nothing else */
  var s = styled('fresh', { thresh: -40, ratio: 20, knee: 0, range: 6, attack: 1, release: 500,
                            autoRel: false, makeup: 0 });
  var n = FS;
  var sig = R.makeSine(300, FS, n, 0.9);
  var e = R.createEngine(FS); e.setState(s);
  var oL = new Float64Array(n), oR = new Float64Array(n);
  e.process(sig, sig, oL, oR);
  var m = e.meters();
  ok(m.grPeak >= -6.0001, 'range = 6 dB caps the reduction at 6 dB (got ' + m.grPeak.toFixed(3) + ')');
  ok(m.grPeak < -5.9, 'and it does reach the cap');
})();

(function () {
  /* auto makeup is analytic — a pure function of the parameters */
  var s = styled('fresh', { thresh: -20, ratio: 4, knee: 0, autoMakeup: true });
  near(R.autoMakeupDb(s), 15, 1e-9, 'auto makeup at −20/4:1 is +15 dB (the 0 dBFS reduction, negated)');
  /* the knee only changes the makeup if 0 dBFS falls INSIDE it — with a
     −20 threshold it is 20 dB past even a 12 dB knee, so it does not */
  var far = styled('fresh', { thresh: -20, ratio: 4, knee: 12, autoMakeup: true });
  near(R.autoMakeupDb(far), 15, 1e-9, 'a knee far below 0 dBFS leaves the makeup alone');
  var near0 = styled('fresh', { thresh: -3, ratio: 4, knee: 12, autoMakeup: true });
  var hard0 = styled('fresh', { thresh: -3, ratio: 4, knee: 0, autoMakeup: true });
  var a = R.autoMakeupDb(near0);
  /* A soft knee starts reducing BELOW the threshold, so by 0 dBFS it has
     reduced MORE than a hard knee has, and the makeup is correspondingly
     larger. I had this backwards on the first pass. */
  ok(a > R.autoMakeupDb(hard0),
     'a knee straddling 0 dBFS raises the makeup, because it started earlier (' +
     a.toFixed(3) + ' vs ' + R.autoMakeupDb(hard0).toFixed(3) + ' dB)');
  var s2 = styled('fresh', { thresh: -20, ratio: 1, knee: 0, autoMakeup: true });
  near(R.autoMakeupDb(s2), 0, 1e-12, 'at 1:1 the auto makeup is exactly 0');
})();

(function () {
  /* stereo link */
  var n = FS;
  var loud = R.makeSine(300, FS, n, 0.9), quiet = R.makeSine(300, FS, n, 0.02);
  function rightPeak(link) {
    var s = styled('fresh', { thresh: -30, ratio: 8, knee: 0, link: link, attack: 5,
                              release: 200, autoRel: false, makeup: 0 });
    var e = R.createEngine(FS); e.setState(s);
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(loud, quiet, oL, oR);
    var mx = 0;
    for (var i = n / 2; i < n; i++) mx = Math.max(mx, Math.abs(oR[i]));
    return mx;
  }
  var linked = rightPeak(100), free = rightPeak(0);
  ok(linked < free * 0.5, 'linked at 100 % the quiet channel is pulled down with the loud one');
  near(db(free), db(0.02), 0.05, 'unlinked, the quiet channel is left alone');
})();

(function () {
  /* the sidechain filter — keeping bass out of the detector is the single
     most common reason a compressor sounds wrong */
  var n = FS;
  var bass = R.makeSine(50, FS, n, 0.9);
  function grOn(scOn) {
    var s = styled('fresh', { thresh: -30, ratio: 8, knee: 0, scOn: scOn, scHp: 200,
                              scLp: 12000, attack: 5, release: 200, autoRel: false, makeup: 0 });
    var e = R.createEngine(FS); e.setState(s);
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(bass, bass, oL, oR);
    return e.meters().grPeak;
  }
  var off = grOn(false), on = grOn(true);
  ok(on > off + 10, 'a 200 Hz sidechain highpass stops 50 Hz triggering the detector');
  note('50 Hz tone: ' + off.toFixed(2) + ' dB of reduction without the filter, ' +
       on.toFixed(2) + ' dB with it');

  /* listen returns the detector signal, not the audio */
  var s2 = styled('fresh', { scOn: true, scListen: true, scHp: 500, thresh: -60 });
  var e2 = R.createEngine(FS); e2.setState(s2);
  var oL2 = new Float64Array(n), oR2 = new Float64Array(n);
  e2.process(bass, bass, oL2, oR2);
  var mx2 = 0;
  for (var i = n / 2; i < n; i++) mx2 = Math.max(mx2, Math.abs(oL2[i]));
  ok(db(mx2) < db(0.9) - 20, 'listening to the chest hears the filtered detector, not the source');
})();

/* ============================================================
   4. the feedback topology — the one that can actually blow up
   ============================================================ */
console.log('\n— Settling, the feedback canary —');
(function () {
  var s = styled('settling', { thresh: -30, ratio: 10, attack: 1, release: 30, range: 60 });
  var e = R.createEngine(FS); e.setState(s);
  var CH = 48000, total = 60;   // 60 seconds of full-scale noise
  var oL = new Float64Array(CH), oR = new Float64Array(CH);
  var bad = 0, mx = 0;
  for (var b = 0; b < total; b++) {
    var x = R.makeNoise(1000 + b, CH);
    var e2 = e;
    e2.process(x, x, oL, oR);
    for (var i = 0; i < CH; i++) {
      var v = oL[i];
      if (!isFinite(v)) bad++;
      var a = v < 0 ? -v : v;
      if (a > mx) mx = a;
    }
  }
  ok(bad === 0, 'feedback topology: 60 s of full-scale noise, not one NaN or infinity');
  ok(mx < 4, 'feedback topology stays bounded (peak ' + db(mx).toFixed(2) + ' dB)');
  note('a feedback detector compounds its own error through a nonlinear gain computer — ' +
       'if anything diverges, it diverges here first');
})();

(function () {
  /* the optical styles smooth the LEVEL, so attack time varies with
     overshoot on purpose. Assert the two paths genuinely differ. */
  var n = FS;
  var x = R.makeStep(FS, n, 0, 0.7, 0.25);
  function riseTime(style) {
    var s = styled(style, { thresh: -30, ratio: 6, attack: 20, release: 500, autoRel: false });
    var e = R.createEngine(FS); e.setState(s);
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(x, x, oL, oR);
    var at = Math.floor(n * 0.25), base = db(0.7);
    var fin = db(oL[n - 1]) - base;
    for (var i = at; i < n; i++) {
      if ((db(oL[i]) - base) <= fin * 0.632) return i - at;
    }
    return -1;
  }
  var ff = riseTime('fresh'), fb = riseTime('settling');
  ok(ff > 0 && fb > 0, 'both topologies reach 63.2 % of their own target');
  ok(Math.abs(ff - fb) > 20, 'the optical path does NOT share the feedforward attack time');
  note('fresh took ' + ff + ' samples, settling took ' + fb +
       ' — level-dependent attack is the point, not a bug');
})();

/* ============================================================
   5. hygiene
   ============================================================ */
console.log('\n— state hygiene —');
(function () {
  var s = R.sanitizeState(null);
  ok(s.style === 'fresh' && s.thresh === -18, 'null → default case file');
  ok(R.sanitizeState({ thresh: 0 }).thresh === 0, 'a threshold of exactly 0 dB survives');
  ok(R.sanitizeState({ knee: 0 }).knee === 0, 'a knee of exactly 0 survives');
  ok(R.sanitizeState({ mix: 0 }).mix === 0, 'a mix of exactly 0 % survives');
  ok(R.sanitizeState({ link: 0 }).link === 0, 'a link of exactly 0 % survives');
  ok(R.sanitizeState({ range: 0 }).range === 0, 'a range of exactly 0 survives');
  ok(R.sanitizeState({ look: 0 }).look === 0, 'a lookahead of exactly 0 survives');
  ok(R.sanitizeState({ ratio: 0.2 }).ratio === 1, 'a ratio below 1:1 is clamped, not accepted');
  ok(R.sanitizeState({ style: 'rigor mortis' }).style === 'fresh', 'an unknown style falls back');
  ok(R.sanitizeState({ detect: 'rms' }).detect === 'rms', 'a legal detector is kept');
  var d = R.styleDefaults('settling');
  d.knee = 999;
  ok(R.styleDefaults('settling').knee !== 999, 'styleDefaults hands out copies');
})();

(function () {
  var s = styled('spasm', { thresh: -24, ratio: 6, look: 3, inGain: 6 });
  var e = R.createEngine(FS); e.setState(s);
  var n = 8192, x = R.makeNoise(11, n);
  var a = new Float64Array(n), b = new Float64Array(n);
  e.process(x, x, a, b);
  e.reset();
  var c = new Float64Array(n), d2 = new Float64Array(n);
  e.process(x, x, c, d2);
  var same = true;
  for (var i = 0; i < n; i++) if (a[i] !== c[i]) same = false;
  ok(same, 'reset() returns the engine to a byte-identical starting state');
})();

/* ============================================================
   v0.2 — delta, mid/side, release curve, metering
   ============================================================ */
function runE(s, L, Rr) {
  var e = R.createEngine(FS), n = L.length;
  var a = new Float64Array(n), b = new Float64Array(n);
  e.setState(s); e.process(L, Rr, a, b);
  return { L: a, R: b, e: e };
}
function runM(s, L, Rr) {
  var e = R.createMulti(FS), n = L.length;
  var a = new Float64Array(n), b = new Float64Array(n);
  e.setState(s); e.process(L, Rr, a, b);
  return { L: a, R: b, e: e };
}
function bitSame(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
var NZ = 16384;
var nzL = R.makeNoise(4242, NZ), nzR = R.makeNoise(9111, NZ);
for (var zi = 0; zi < NZ; zi++) { nzL[zi] *= 0.3; nzR[zi] *= 0.3; }

console.log('\n— delta listening —');
(function () {
  var d1 = runE(styled('fresh', { ratio: 1, thresh: -40, delta: true, makeup: 0 }), nzL, nzR);
  var silent = true;
  for (var i = 0; i < NZ; i++) if (d1.L[i] !== 0 || d1.R[i] !== 0) silent = false;
  ok(silent, 'delta at 1:1 is EXACTLY silent, not approximately');

  var d2 = runE(styled('fresh', { ratio: 6, thresh: -30, delta: true, makeup: 0 }), nzL, nzR);
  var heard = false;
  for (i = 0; i < NZ; i++) if (d2.L[i] !== 0) { heard = true; break; }
  ok(heard, 'delta is audible once the compressor works');

  /* the identity that makes delta trustworthy */
  var wet = runE(styled('fresh', { ratio: 6, thresh: -30, mix: 100, makeup: 0 }), nzL, nzR).L;
  var dry = runE(styled('fresh', { ratio: 6, thresh: -30, mix: 0, makeup: 0 }), nzL, nzR).L;
  var worst = 0;
  for (i = 0; i < NZ; i++) worst = Math.max(worst, Math.abs((wet[i] + d2.L[i]) - dry[i]));
  ok(worst < 1e-15, 'wet + delta reconstructs the dry path (' + worst.toExponential(2) + ')');
})();

console.log('\n— mid/side placement —');
(function () {
  var ms = runE(styled('fresh', { ratio: 1, thresh: -40, place: 'ms', makeup: 0 }), nzL, nzR);
  var e1 = 0;
  for (var i = 0; i < NZ; i++)
    e1 = Math.max(e1, Math.abs(ms.L[i] - nzL[i]), Math.abs(ms.R[i] - nzR[i]));
  ok(e1 < 1e-15, 'M/S at 1:1 round-trips to within an ulp (' + e1.toExponential(2) + ')');

  /* on MONO material the side channel is silence, so mid IS the signal */
  var mono = R.makeNoise(777, 8192);
  for (i = 0; i < 8192; i++) mono[i] *= 0.4;
  var a = runE(styled('fresh', { ratio: 6, thresh: -30, place: 'ms', link: 100, makeup: 0 }), mono, mono).L;
  var b = runE(styled('fresh', { ratio: 6, thresh: -30, place: 'lr', link: 100, makeup: 0 }), mono, mono).L;
  ok(bitSame(a, b), 'on mono material M/S is BIT-IDENTICAL to L/R');

  var msC = runE(styled('fresh', { ratio: 6, thresh: -30, place: 'ms', makeup: 0 }), nzL, nzR).L;
  var lrC = runE(styled('fresh', { ratio: 6, thresh: -30, place: 'lr', makeup: 0 }), nzL, nzR).L;
  ok(!bitSame(msC, lrC), 'on stereo material M/S and L/R differ');
})();

console.log('\n— release curve —');
(function () {
  var c0 = runE(styled('fresh', { ratio: 6, thresh: -30, curve: 0, autoRel: false, makeup: 0 }), nzL, nzR).L;
  var c1 = runE(styled('fresh', { ratio: 6, thresh: -30, curve: 100, autoRel: false, makeup: 0 }), nzL, nzR).L;
  ok(!bitSame(c0, c1), 'curve 0 and curve 100 release differently');
  var cn = runE(styled('fresh', { ratio: 1, thresh: -40, curve: 100, makeup: 0 }), nzL, nzR).L;
  ok(bitSame(cn, nzL), 'curve = 100 is STILL bitwise null at 1:1');
  var cz = runE(styled('fresh', { ratio: 6, thresh: -30, autoRel: false, makeup: 0 }), nzL, nzR).L;
  ok(bitSame(cz, c0), 'curve = 0 costs nothing — identical to the plain one-pole');
})();

console.log('\n— denormals —');
(function () {
  ok(R.dn(1e-31) === 0, 'sub-denormal flushes to zero');
  ok(R.dn(-1e-31) === 0, 'and negatively');
  ok(R.dn(1e-20) === 1e-20, 'ordinary small values untouched');
  ok(R.dn(0) === 0 && R.dn(1) === 1, 'zero and one pass through');
})();

console.log('\n— metering —');
(function () {
  function mOf(sig) {
    var e = R.createEngine(FS), n = sig.length;
    var a = new Float64Array(n), b = new Float64Array(n);
    e.setState(styled('fresh', { ratio: 1, thresh: -40, makeup: 0 }));
    e.process(sig, sig, a, b);
    return e.meters();
  }
  function cos(n, w, ph) {
    var s = new Float64Array(n);
    for (var i = 0; i < n; i++) s[i] = Math.cos(w * i + ph);
    return s;
  }
  /* the peak a SAMPLE meter cannot see: fs/4 at 45 deg peaks exactly
     halfway between samples, so every sample reads 0.7071 */
  var tc1 = mOf(cos(8192, Math.PI / 2, Math.PI / 4));
  near(db(tc1.tpL), 0, 0.1, 'fs/4 @45 deg: true peak finds 0 dBTP');
  var tc2 = mOf(cos(8192, 2 * Math.PI * 0.3, 0.7));
  near(db(tc2.tpL), 0, 0.1, '0.3 fs @0.7 rad reads 0 dBTP');
  ok(R.TP_TAPS === 8 && R.TP_OS === 4, 'true-peak geometry pinned at 8 taps x 4 phases');
  /* ROUND 8 — the old note here said the pin was because "more taps is
     worse: 8 -> -0.049 dB, 12 -> +0.451, 16 -> +0.613". Those readings are
     real but they are EDGE GIBBS, not filter quality: they were taken from
     a cold engine, where a tone starting at full scale is a genuine step,
     and a longer sinc overshoots more at a step. Kaiser tracks Blackman to
     0.006 dB across every length, which is the giveaway.
     The two assertions below replace that one case, because one case cannot
     distinguish a good filter from two errors cancelling. */

  /* STEADY STATE, swept. A unit cosine peaks at exactly 1.0 at every
     frequency and phase, so the target is 0 dB — derived, never named. */
  (function () {
    var TP = R.TP_TAPS, T = R.tpTaps(R.TP_OS);
    function peakOf(f, ph) {
      var z = new Float64Array(TP), w = 0, best = 0, N2 = 1024;
      for (var n2 = 0; n2 < N2; n2++) {
        var v = Math.cos(2 * Math.PI * f * n2 + ph);
        z[w] = v;
        var b = Math.abs(v);
        for (var p = 0; p < R.TP_OS; p++) {
          var row = T[p], acc = 0, idx = w;
          for (var k = 0; k < TP; k++) { acc += row[k] * z[idx]; idx = idx === 0 ? TP - 1 : idx - 1; }
          var q = Math.abs(acc); if (q > b) b = q;
        }
        if (n2 > TP * 4 && b > best) best = b;   // past the fill-in transient
        w = w + 1 === TP ? 0 : w + 1;
      }
      return 20 * Math.log10(best);
    }
    var worstHi = -99, worstLo = 99;
    for (var fi = 1; fi <= 48; fi++) {
      for (var pi = 0; pi < 8; pi++) {
        var e2 = peakOf(fi / 100, pi * Math.PI / 4);
        if (e2 > worstHi) worstHi = e2;
        if (e2 < worstLo) worstLo = e2;
      }
    }
    /* A true-peak meter may under-read a little; it must never OVER-read,
       because the whole point is to be the number you trust before a
       limiter. 0.01 dB of slack for the arithmetic. */
    ok(worstHi < 0.01, 'in steady state the meter never reads ABOVE the true peak (worst +' +
       worstHi.toFixed(4) + ' dB)');
    /* And it may not under-read by more than 4x oversampling forces it to.
       The floor is cos(2*pi*f/(2*TP_OS)) at the worst frequency swept — the
       error from a grid that can miss the peak by half a step. DERIVED from
       TP_OS, so raising TP_OS automatically tightens this assertion. */
    var floorDb = 20 * Math.log10(Math.cos(2 * Math.PI * 0.48 / (2 * R.TP_OS)));
    ok(worstLo > floorDb, 'and never under-reads past the ' + R.TP_OS +
       'x grid floor (' + worstLo.toFixed(4) + ' dB vs floor ' + floorDb.toFixed(4) + ')');
    note('the dominant error is TP_OS, not the window: no tap count or window moves that floor.');
  })();
  var taps = R.tpTaps(), dcOk = true;
  taps.forEach(function (row) {
    var t = 0;
    for (var i = 0; i < row.length; i++) t += row[i];
    if (Math.abs(t - 1) > 1e-12) dcOk = false;
  });
  ok(dcOk, 'every true-peak phase has unity DC gain');

  /* EBU Tech 3341 case 1 */
  function sine(peakDb, secs) {
    var n = Math.round(FS * secs), amp = Math.pow(10, peakDb / 20);
    var s = new Float64Array(n);
    for (var i = 0; i < n; i++) s[i] = amp * Math.sin(2 * Math.PI * 1000 * i / FS);
    return s;
  }
  var L23 = mOf(sine(-23, 4));
  near(L23.lufsI, -23, 0.15, 'EBU 3341 case 1: 1 kHz at -23 dBFS reads -23 LUFS');
  near(L23.lufsS, -23, 0.15, 'short-term agrees');
  var L18 = mOf(sine(-18, 4));
  near(L18.lufsI - L23.lufsI, 5, 0.02, '5 dB of level is 5 LU of loudness');
  var kh = R.kweightHigh(FS), kl = R.kweightLow(FS);
  function km(f) { return ND.secSosHP === undefined ? 0 : 0; }
  ok(isFinite(kh.b0) && isFinite(kl.a2), 'K-weighting designs at 48 k');
  ok(isFinite(R.kweightHigh(44100).b0) && isFinite(R.kweightHigh(96000).b0),
     'and at 44.1 and 96 k — designed parametrically, not pasted from one table');
  ok(R.lkfs(0, 0) < -150, 'silence reads as effectively minus infinity, not NaN');

  var corrSame = mOf(sine(-12, 1));
  near(corrSame.corr, 1, 0.01, 'identical channels correlate at +1');
  var dec = runE(styled('fresh', { ratio: 1, thresh: -40, makeup: 0 }), nzL, nzR);
  ok(Math.abs(dec.e.meters().corr) < 0.1, 'decorrelated noise correlates near 0');
})();

console.log('\n— auto threshold + loudness match —');
(function () {
  var bursts = R.makeNoise(2468, 24000);
  for (var i = 0; i < 24000; i++) bursts[i] *= (i % 6000 < 600 ? 0.9 : 0.05);
  var t4 = R.suggestThreshold(bursts, 4, -6);
  ok(t4 > -60 && t4 < 0, 'suggests a threshold in range');
  ok(R.suggestThreshold(bursts, 4, -6) === t4, 'deterministic — same material, same number');
  ok(R.suggestThreshold(bursts, 8, -6) > R.suggestThreshold(bursts, 2, -6),
     'a higher ratio needs a higher threshold for the same reduction');
  ok(R.suggestThreshold(new Float64Array(1000), 4, -6) === -20, 'silence falls back to a default');
  ok(R.suggestThreshold(bursts, 1, -6) === 0, '1:1 cannot reduce, so the threshold is meaningless');
  near(R.loudnessMatch(-14, -20), 6, 1e-12, 'loudness match: B is 6 LU quieter, so lift it 6');
  ok(R.loudnessMatch(-200, -20) === 0, 'no match against silence');
  ok(R.loudnessMatch(-14, -14) === 0, 'equal loudness needs no offset');
})();

/* ============================================================
   v0.3 — the crossover and multiband
   ============================================================ */
console.log('\n— Linkwitz-Riley crossover —');
(function () {
  /* ALLPASS: the summed branches must have unit magnitude at EVERY
     frequency, or a multiband compressor cannot reconstruct its input.
     Measured by sine sweep rather than FFT, so the proof does not depend
     on the analyser's window. */
  [2, 3].forEach(function (nb) {
    var worst = 0, worstF = 0;
    [30, 50, 100, 200, 300, 500, 800, 1200, 2000, 3000, 5000, 8000, 16000].forEach(function (f) {
      var sp = R.createSplitter(FS);
      sp.set(nb, 200, 2000);
      var n = FS / 2 | 0, out = new Float64Array(6), sI = 0, sO = 0;
      for (var i = 0; i < n; i++) {
        var v = Math.sin(2 * Math.PI * f * i / FS);
        sp.split(v, v, out);
        var y = 0;
        for (var k = 0; k < nb; k++) y += out[k * 2];
        if (i > n / 2) { sI += v * v; sO += y * y; }
      }
      var d = 10 * Math.log10(sO / sI);
      if (Math.abs(d) > Math.abs(worst)) { worst = d; worstF = f; }
    });
    ok(Math.abs(worst) < 0.01, nb + '-band crossover sums FLAT — worst ' +
       worst.toFixed(4) + ' dB at ' + worstF + ' Hz');
  });
  note('without the low-band allpass correction the 3-band sum sags 0.108 dB at 300 Hz');
  var sp2 = R.createSplitter(FS);
  sp2.set(1, 200, 2000);
  var o = new Float64Array(6);
  sp2.split(0.5, -0.25, o);
  ok(o[0] === 0.5 && o[1] === -0.25, 'at 1 band the splitter is a pure passthrough');
})();

console.log('\n— multiband —');
(function () {
  /* THE load-bearing constraint: 1 band must not cost a single bit */
  R.STYLES.forEach(function (sty) {
    var cfg = { bands: 1, ratio: 6, thresh: -30, makeup: 0 };
    var m = runM(styled(sty, cfg), nzL, nzR);
    var e = runE(styled(sty, cfg), nzL, nzR);
    ok(bitSame(m.L, e.L) && bitSame(m.R, e.R),
       'bands = 1 (' + sty + ') is BIT-IDENTICAL to the single engine');
  });

  var m3 = runM(styled('fresh', { bands: 3, ratio: 1, thresh: -40, makeup: 0 }), nzL, nzR);
  var eIn = 0, eOut = 0;
  for (var i = 0; i < NZ; i++) { eIn += nzL[i] * nzL[i]; eOut += m3.L[i] * m3.L[i]; }
  near(eOut / eIn, 1, 0.002, '3 bands at 1:1 preserve energy (allpass, so phase moves)');

  var m3c = runM(styled('fresh', { bands: 3, ratio: 6, thresh: -30, makeup: 0 }), nzL, nzR);
  var m1c = runM(styled('fresh', { bands: 1, ratio: 6, thresh: -30, makeup: 0 }), nzL, nzR);
  ok(!bitSame(m3c.L, m1c.L), '3 bands compress differently from 1');
  var bg = m3c.e.meters().bandGr;
  ok(bg.length === 3 && bg[0] <= 0 && bg[1] <= 0 && bg[2] <= 0, 'per-band gain reduction reported');
  note('per-band GR ' + bg.map(function (v) { return v.toFixed(2); }).join(' / '));

  /* solo beats mute, as on every console ever built */
  var solo = runM(styled('fresh', { bands: 3, ratio: 1, thresh: -40, makeup: 0,
                                    band: [{ solo: true }, {}, {}] }), nzL, nzR);
  var mute = runM(styled('fresh', { bands: 3, ratio: 1, thresh: -40, makeup: 0,
                                    band: [{}, { mute: true }, { mute: true }] }), nzL, nzR);
  ok(bitSame(solo.L, mute.L), 'soloing band 1 equals muting bands 2 and 3');
  var allMute = runM(styled('fresh', { bands: 3, ratio: 1, thresh: -40, makeup: 0,
                                       band: [{ mute: true }, { mute: true }, { mute: true }] }), nzL, nzR);
  var sil = true;
  for (i = 0; i < NZ; i++) if (allMute.L[i] !== 0) sil = false;
  ok(sil, 'every band muted is exactly silent');

  var gained = runM(styled('fresh', { bands: 2, ratio: 1, thresh: -40, makeup: 0,
                                      band: [{ gain: 6 }, {}] }), nzL, nzR);
  var flat = runM(styled('fresh', { bands: 2, ratio: 1, thresh: -40, makeup: 0 }), nzL, nzR);
  ok(!bitSame(gained.L, flat.L), 'per-band gain does something');
})();

console.log('\n— v0.3 sanitiser (INTERCHANGE law 5: boundaries) —');
(function () {
  ok(R.sanitizeState({ place: 'ms' }).place === 'ms', 'place accepted');
  ok(R.sanitizeState({ place: 'nope' }).place === 'lr', 'unknown place falls back');
  ok(R.sanitizeState({ curve: 0 }).curve === 0, 'curve 0 survives');
  ok(R.sanitizeState({ curve: 999 }).curve === 100, 'curve clamps');
  ok(R.sanitizeState({ bands: 0 }).bands === 1, 'bands floors at 1');
  ok(R.sanitizeState({ bands: 99 }).bands === R.MAX_BANDS, 'bands ceilings at 3');
  ok(R.sanitizeState({ bands: 2.6 }).bands === 3, 'bands rounds');
  var x = R.sanitizeState({ xover: [5000, 100] });
  ok(x.xover[1] >= x.xover[0] * 1.1, 'crossovers are reordered and kept apart');
  ok(R.sanitizeState({ band: [{ gain: 0 }] }).band[0].gain === 0, 'band gain 0 survives');
  ok(R.sanitizeState({ band: [{ threshOff: 0 }] }).band[0].threshOff === 0, 'band offset 0 survives');
  ok(R.sanitizeState({ band: [{ gain: 999 }] }).band[0].gain === 24, 'band gain clamps');
  ok(R.sanitizeState(null).bands === 1, 'null gives a sane default');
  var rt = R.sanitizeState(JSON.parse(JSON.stringify(
    R.sanitizeState({ bands: 3, place: 'ms', curve: 40, band: [{ gain: 3 }, { mute: true }, {}] }))));
  ok(rt.bands === 3 && rt.place === 'ms' && rt.curve === 40 && rt.band[1].mute === true,
     'JSON round trip is stable');
})();

/* ============================================================
   v0.4 — tempo sync, true-peak detection, per-band makeup
   ============================================================ */
console.log('\n— tempo-synced release —');
(function () {
  var base = { release: 200, bpm: 120 };
  ok(R.releaseMs(R.sanitizeState(base)) === 200, 'sync off returns the ms setting');
  base.relSync = 5;                                   /* 1/4 */
  near(R.releaseMs(R.sanitizeState(base)), 500, 1e-9, '1/4 at 120 bpm is 500 ms');
  base.bpm = 60;
  near(R.releaseMs(R.sanitizeState(base)), 1000, 1e-9, 'and 1000 ms at 60 bpm');
  base.bpm = 120; base.relSync = 9;                   /* 1 bar */
  near(R.releaseMs(R.sanitizeState(base)), 2000, 1e-9, '1 bar at 120 bpm is 2000 ms');
  base.relSync = 10; base.bpm = 20;                   /* 2 bars, very slow */
  ok(R.releaseMs(R.sanitizeState(base)) === 2500, 'sync clamps to the release maximum');
  /* the tempo lives in STATE, never fetched inside the DSP — that is what
     keeps a synced release a pure function of the case file */
  var a = R.releaseMs(R.sanitizeState({ release: 200, relSync: 5, bpm: 174 }));
  var b = R.releaseMs(R.sanitizeState({ release: 200, relSync: 5, bpm: 174 }));
  ok(a === b, 'releaseMs is pure');
  ok(R.SYNC_DIV.length === R.SYNC_NAMES.length, 'every sync division has a name');
  ok(R.sanitizeState({ relSync: 999 }).relSync === R.SYNC_DIV.length - 1, 'relSync clamps');
  ok(R.sanitizeState({ relSync: 0 }).relSync === 0, 'relSync 0 survives');
  ok(R.sanitizeState({ bpm: 1 }).bpm === 20 && R.sanitizeState({ bpm: 9999 }).bpm === 300,
     'bpm clamps both ends');
})();

console.log('\n— oversampled (true-peak) detection —');
(function () {
  /* fs/4 at 45 deg: every SAMPLE sits at 0.7071 of the real peak, so a
     sample detector under-reads by 3 dB and an interpolating one does not */
  var n = 24000, sig = new Float64Array(n);
  for (var i = 0; i < n; i++) sig[i] = Math.cos(Math.PI * i / 2 + Math.PI / 4) * Math.pow(10, -3 / 20);
  function grOf(os) {
    var e = R.createEngine(FS);
    e.setState(styled('fresh', { thresh: -6, ratio: 8, knee: 0, attack: 1,
                                 release: 100, detOs: os, makeup: 0, detect: 'peak' }));
    var a = new Float64Array(n), b = new Float64Array(n);
    e.process(sig, sig, a, b);
    return e.meters().gr;
  }
  var off = grOf(false), on = grOf(true);
  near(off, 0, 0.05, 'the sample detector reads 0 dB — the peaks are between samples');
  ok(on < -2, 'the true-peak detector finds the inter-sample peak (' + on.toFixed(2) + ' dB)');
  note('3 dB over threshold at 8:1 predicts -2.63 dB; measured ' + on.toFixed(2));
  /* and it must not break the one assertion worth having */
  var e2 = R.createEngine(FS);
  e2.setState(styled('fresh', { ratio: 1, thresh: -40, detOs: true, makeup: 0 }));
  var x = R.makeNoise(4242, 8192);
  for (i = 0; i < 8192; i++) x[i] *= 0.3;
  var oa = new Float64Array(8192), ob = new Float64Array(8192);
  e2.process(x, x, oa, ob);
  var bit = true;
  for (i = 0; i < 8192; i++) if (oa[i] !== x[i]) bit = false;
  ok(bit, 'still BITWISE null at 1:1 with true-peak detection on');
})();

console.log('\n— hold, tapering into release —');
(function () {
  var N2 = 9000;
  /* one loud burst, then quiet — so hold engages on the way down */
  var src = R.makeNoise(5150, N2);
  for (var i = 0; i < N2; i++) src[i] *= (i > 1000 && i < 2200) ? 0.95 : 0.04;
  function rend(tp) {
    var e = R.createEngine(FS);
    e.setState(styled('fresh', { thresh: -30, ratio: 8, knee: 0, attack: 1,
                                 release: 400, hold: 80, holdTaper: tp,
                                 autoRel: false, makeup: 0 }));
    var a = new Float64Array(N2), b = new Float64Array(N2);
    e.process(src, src, a, b);
    return a;
  }
  var t0 = rend(0), t50 = rend(50), t100 = rend(100);
  function ident(a, b) {
    for (var i2 = 0; i2 < a.length; i2++) if (a[i2] !== b[i2]) return false;
    return true;
  }
  /* the assertion that protects every baseline in the repository */
  ok(ident(t0, rend(0)), 'holdTaper 0 is deterministic');
  var noHold = R.createEngine(FS);
  noHold.setState(styled('fresh', { thresh: -30, ratio: 8, knee: 0, attack: 1,
                                    release: 400, hold: 80, autoRel: false, makeup: 0 }));
  var nh = new Float64Array(N2), nh2 = new Float64Array(N2);
  noHold.process(src, src, nh, nh2);
  ok(ident(t0, nh), 'holdTaper 0 renders IDENTICALLY to not setting it at all');
  ok(!ident(t0, t50) && !ident(t0, t100), 'and 50 / 100 genuinely change the render');

  /* DERIVED from the construction rather than measured by eye.
     holdCoef(rem) = 1 - (1-relF)*(1-frac)*holdW, and relF < 1, so the
     coefficient is <= 1 at every point: the tapered envelope can only ever
     move TOWARD the target sooner, never later. The target during release
     is less reduction, so the tapered gain is >= the untapered one, and
     since y = x*g on identical x, |y_taper| >= |y_plain| POINTWISE. */
  function dominates(big, small) {
    var strict = false;
    for (var i3 = 0; i3 < big.length; i3++) {
      var a = Math.abs(big[i3]), b = Math.abs(small[i3]);
      if (a < b - 1e-15) return { ok: false, at: i3 };
      if (a > b + 1e-12) strict = true;
    }
    return { ok: true, strict: strict };
  }
  var d50 = dominates(t50, t0), d100 = dominates(t100, t50);
  ok(d50.ok && d50.strict, 'a tapered hold NEVER holds the gain down longer than a hard one');
  ok(d100.ok && d100.strict, 'and more taper releases sooner still (100 dominates 50)');

  /* the taper must be inert when there is no hold to taper */
  function noHoldRend(tp) {
    var e = R.createEngine(FS);
    e.setState(styled('fresh', { thresh: -30, ratio: 8, knee: 0, attack: 1,
                                 release: 400, hold: 0, holdTaper: tp,
                                 autoRel: false, makeup: 0 }));
    var a = new Float64Array(N2), b = new Float64Array(N2);
    e.process(src, src, a, b);
    return a;
  }
  ok(ident(noHoldRend(0), noHoldRend(100)),
     'with hold at 0 the taper is inert — nothing to ease out of');

  /* boundary: hold shorter than one sample. holdN rounds to 0, and
     holdCoef divides by it. A legal value that is also a boundary value. */
  var tiny = R.createEngine(FS);
  tiny.setState(styled('fresh', { thresh: -30, ratio: 8, hold: 0.001, holdTaper: 100, makeup: 0 }));
  var ta = new Float64Array(512), tb = new Float64Array(512);
  tiny.process(src.subarray(0, 512), src.subarray(0, 512), ta, tb);
  var finite = true;
  for (var i4 = 0; i4 < 512; i4++) if (!isFinite(ta[i4]) || !isFinite(tb[i4])) finite = false;
  ok(finite, 'a sub-sample hold with full taper does not divide by zero');

  R.DET_OS_CHOICES.length;   // keep the linter honest about the shared import
  var nz = R.makeNoise(4, 2000);
  var e9 = R.createEngine(FS);
  e9.setState(styled('fresh', { ratio: 1, thresh: -40, hold: 50, holdTaper: 100, makeup: 0 }));
  var oa = new Float64Array(2000), ob = new Float64Array(2000);
  e9.process(nz, nz, oa, ob);
  var bit2 = true;
  for (var i5 = 0; i5 < 2000; i5++) if (oa[i5] !== nz[i5] || ob[i5] !== nz[i5]) bit2 = false;
  ok(bit2, 'BITWISE null at 1:1 with a fully tapered hold');
})();

console.log('\n— the detector phase count (2 / 4 / 8) —');
(function () {
  /* --- the legal set is a SET, not a range --- */
  ok(R.DET_OS_CHOICES.join(',') === '2,4,8', 'three legal phase counts');
  ok(R.defaultState().detOsX === 4, 'the default is 4 — the ITU true-peak convention');
  R.DET_OS_CHOICES.forEach(function (v) {
    ok(R.sanitizeState({ detOsX: v }).detOsX === v, v + ' survives sanitising');
  });
  /* the boundary values that are ALSO legal-looking: 3 is between two legal
     values, 16 is a plausible next power of two, 0 is falsy but numeric */
  [3, 0, 1, 6, 16, -4, NaN, Infinity, null, undefined, '4', 'eight'].forEach(function (v) {
    var got = R.sanitizeState({ detOsX: v }).detOsX;
    var expect = R.DET_OS_CHOICES.indexOf(+v) >= 0 ? +v : 4;
    ok(got === expect, JSON.stringify(v) + ' sanitises to ' + expect);
  });

  /* --- the nesting invariant, DERIVED from the geometry ---
     phase p sits at frac = p/os, so the offsets an 8-phase bank visits are a
     superset of a 4-phase bank's, which are a superset of a 2-phase bank's.
     A superset of candidates cannot produce a SMALLER maximum. This is the
     assertion that would catch an off-by-one in the phase loop. */
  var TP = R.TP_TAPS;
  function ipk(os, sig) {
    var T = R.tpTaps(os), z = new Float64Array(TP), w = 0, best = 0;
    for (var n2 = 0; n2 < sig.length; n2++) {
      z[w] = sig[n2];
      var b = Math.abs(sig[n2]);
      for (var p = 0; p < os; p++) {
        var row = T[p], acc = 0, idx = w;
        for (var k = 0; k < TP; k++) { acc += row[k] * z[idx]; idx = idx === 0 ? TP - 1 : idx - 1; }
        var q = Math.abs(acc); if (q > b) b = q;
      }
      if (b > best) best = b;
      w = w + 1 === TP ? 0 : w + 1;
    }
    return best;
  }
  /* an ISOLATED band-limited transient whose peak lands at a chosen
     fractional offset. Its true peak is exactly 1.0 by construction, so the
     expected value is derived and never named. */
  function blip(n2, n0, off) {
    var s = new Float64Array(n2);
    for (var i2 = 0; i2 < n2; i2++) {
      var xx = i2 - n0 - off;
      s[i2] = xx === 0 ? 1 : Math.sin(Math.PI * xx) / (Math.PI * xx);
    }
    return s;
  }
  var nested = true, everStrict = false;
  [0, 0.0625, 0.125, 0.1875, 0.25, 0.3125, 0.375, 0.4375, 0.5].forEach(function (off) {
    var s = blip(256, 120, off);
    var v2 = ipk(2, s), v4 = ipk(4, s), v8 = ipk(8, s);
    if (!(v8 >= v4 && v4 >= v2)) nested = false;
    if (v8 > v4 || v4 > v2) everStrict = true;
  });
  ok(nested, 'more phases NEVER report a lower peak — the offsets nest');
  ok(everStrict, 'and somewhere they report a strictly higher one, so the knob does something');

  /* Sustained tone: extra phases buy NOTHING, because the sample index
     already sweeps the fractional offsets densely. Worth pinning, because
     it is the reason this control is documented as a transient tool. */
  var tone = new Float64Array(1024);
  for (var i3 = 0; i3 < 1024; i3++) tone[i3] = Math.cos(2 * Math.PI * 0.31 * i3 + 0.4);
  ok(ipk(8, tone) === ipk(4, tone),
     'on a SUSTAINED tone 8 phases and 4 agree exactly — time already sweeps the offsets');

  /* --- 4 must reproduce the default bit-for-bit --- */
  function rend(patch) {
    var e = R.createEngine(FS), nn = 6000;
    var src = R.makeNoise(31337, nn);
    for (var i4 = 0; i4 < nn; i4++) src[i4] *= (i4 > 2000 && i4 < 2600) ? 0.98 : 0.15;
    e.setState(styled('fresh', patch));
    var a2 = new Float64Array(nn), b2 = new Float64Array(nn);
    e.process(src, src, a2, b2);
    return a2;
  }
  function ident(a2, b2) {
    for (var i5 = 0; i5 < a2.length; i5++) if (a2[i5] !== b2[i5]) return false;
    return true;
  }
  var base = { thresh: -20, ratio: 8, knee: 0, attack: 1, release: 90, detOs: true, detect: 'peak', makeup: 0 };
  function withX(x) { var o = {}; for (var k in base) o[k] = base[k]; o.detOsX = x; return o; }
  ok(ident(rend(base), rend(withX(4))),
     'detOsX:4 renders IDENTICALLY to the unset default — no baseline moved');
  ok(!ident(rend(withX(2)), rend(withX(4))), '2 phases render differently from 4');
  ok(!ident(rend(withX(8)), rend(withX(4))), '8 phases render differently from 4');

  /* and the law survives every one of them */
  R.DET_OS_CHOICES.forEach(function (x) {
    var e = R.createEngine(FS), nz = R.makeNoise(99, 3000);
    e.setState(styled('fresh', { ratio: 1, thresh: -40, makeup: 0, detOs: true, detOsX: x }));
    var a2 = new Float64Array(3000), b2 = new Float64Array(3000);
    e.process(nz, nz, a2, b2);
    var b3 = true;
    for (var i6 = 0; i6 < 3000; i6++) if (a2[i6] !== nz[i6] || b2[i6] !== nz[i6]) b3 = false;
    ok(b3, 'BITWISE null at 1:1 with ' + x + '-phase detection');
  });
})();

console.log('\n— per-band analytic makeup —');
(function () {
  var st = styled('repose', { bands: 3, thresh: -30, ratio: 4, knee: 0,
                              band: [{ threshOff: -6 }, { threshOff: 0 }, { threshOff: 6 }] });
  var m0 = R.bandMakeupDb(st, 0), m1 = R.bandMakeupDb(st, 1), m2 = R.bandMakeupDb(st, 2);
  ok(m0 > m1 && m1 > m2, 'a lower band threshold needs more makeup (' +
     m0.toFixed(1) + ' / ' + m1.toFixed(1) + ' / ' + m2.toFixed(1) + ')');
  near(m1, R.autoMakeupDb(st), 1e-12, 'a zero offset matches the global auto makeup');
  ok(R.bandMakeupDb(st, 0) === m0, 'pure — same state, same number');
  var one = styled('fresh', { ratio: 1, thresh: -30 });
  ok(R.bandMakeupDb(one, 0) === 0, '1:1 needs no makeup in any band');
})();

/* ============================================================
   v0.5 — case-file migration
   ============================================================ */
console.log('\n— case-file migration —');
(function () {
  /* the shape a case file had before the lineage merge */
  var legacy = { style: 'fresh', thresh: -24, lookahead: 5,
                 sc: { on: true, hp: 220, lp: 6000, listen: true },
                 link: 0.5, mix: 0.45, curve: 0.8 };
  var naive = R.sanitizeState(legacy);
  var fixed = R.loadCase(legacy);

  /* the whole point: a bare sanitize drops every legacy field silently */
  ok(naive.look === 0 && naive.scOn === false,
     'a bare sanitize SILENTLY discards legacy fields — this is the failure being fixed');

  ok(fixed.look === 5, 'lookahead migrates to look');
  ok(fixed.scOn === true, 'sc.on migrates to scOn');
  ok(fixed.scHp === 220 && fixed.scLp === 6000, 'sc.hp / sc.lp migrate');
  ok(fixed.scListen === true, 'sc.listen migrates');
  near(fixed.link, 50, 1e-9, 'link 0..1 rescales to 0..100');
  near(fixed.mix, 45, 1e-9, 'mix 0..1 rescales to 0..100');
  near(fixed.curve, 80, 1e-9, 'curve 0..1 rescales to 0..100');

  /* a MODERN file must pass through untouched — a migration that also
     mangles current files is worse than no migration */
  var modern = R.sanitizeState({ style: 'spasm', look: 3, scOn: true, scHp: 300,
                                 link: 75, mix: 100, curve: 40, bands: 2 });
  ok(JSON.stringify(R.loadCase(modern)) === JSON.stringify(modern),
     'a current case file passes through the migration unchanged');
  ok(JSON.stringify(R.loadCase(R.loadCase(legacy))) === JSON.stringify(fixed),
     'migration is idempotent — loading twice does not rescale twice');

  /* THE RESCALE IS KEYED ON A STRUCTURAL MARKER, NEVER ON THE VALUE.
     The first version sniffed "is it <= 1?", which looks reasonable and
     is wrong: link = 0.11 is a legal current value meaning 0.11%, and the
     sniff silently turned it into 11%. The round-trip audit caught it —
     a saved session would reopen LOUDER than it was closed. */
  near(R.loadCase({ mix: 0.5 }).mix, 0.5, 1e-9,
     'a lone 0.5 with no legacy marker is 0.5%, and is left alone');
  near(R.loadCase({ mix: 0.5, lookahead: 2 }).mix, 50, 1e-9,
     'the SAME 0.5 alongside a legacy marker is 50% and is rescaled');
  near(R.loadCase({ mix: 0.5, sc: { on: true } }).mix, 50, 1e-9,
     'a legacy sc block is a marker too');
  near(R.loadCase({ mix: 100 }).mix, 100, 1e-9, 'a current 100 is untouched');
  near(R.loadCase({ mix: 0 }).mix, 0, 1e-9, 'zero is zero either way');
  /* the property that actually matters, and the one that broke */
  var live = R.sanitizeState({ link: 0.109, mix: 0.558, curve: 0.4 });
  ok(JSON.stringify(R.loadCase(JSON.parse(JSON.stringify(live)))) === JSON.stringify(live),
     'a CURRENT state with sub-1% values survives save and reload unchanged');

  ok(R.migrateCase(null) === null, 'migration tolerates null');
  ok(typeof R.migrateCase('nonsense') === 'string', 'and non-objects');
  ok(JSON.stringify(R.loadCase(undefined)) === JSON.stringify(R.defaultState()),
     'undefined gives defaults, not a throw');
})();

/* ============================================================
   the styles claim, checked against the styles
   ============================================================ */
console.log('\n— how many topologies are there, really? —');
(function () {
  /* Driven with IDENTICAL explicit settings, two styles that share a
     signal path must render identically, and two that do not must not.
     This is the assertion that caught the documentation claiming four
     topologies when there are three. */
  var n = 8192, x = R.makeNoise(4242, n);
  for (var i = 0; i < n; i++) x[i] *= 0.5;
  function render(sty) {
    var s = R.defaultState();
    s.style = sty; s.thresh = -30; s.ratio = 4; s.knee = 6;
    s.attack = 20; s.release = 300; s.autoRel = false; s.makeup = 0;
    var e = R.createEngine(FS);
    e.setState(s);
    var a = new Float64Array(n), b = new Float64Array(n);
    e.process(x, x, a, b);
    return a;
  }
  function same(a, b) {
    for (var i2 = 0; i2 < a.length; i2++) if (a[i2] !== b[i2]) return false;
    return true;
  }
  var out = {};
  R.STYLES.forEach(function (s) { out[s] = render(s); });

  /* the paths, derived from the STYLE table rather than asserted by hand.
     pkMs joined the signature when Spasm got its own peak-follower decay;
     leaving it out would have let the table say "different" while the
     audio said "identical", which is the exact failure this block exists
     to catch. */
  function pathOf(s) {
    var c = R.STYLE[s];
    return c.topo + '|' + c.detect + '|' + c.rmsMs + '|' + c.pkMs + '|' +
           c.smoothLevel + '|' + c.levelAttack;
  }
  var paths = {};
  R.STYLES.forEach(function (s) { paths[pathOf(s)] = (paths[pathOf(s)] || []).concat(s); });
  var nPaths = Object.keys(paths).length;
  /* Derived, not named: the claim is "every style is its own path", so the
     expected value is the style count. A hardcoded 4 would go stale the
     moment a fifth style arrived. */
  ok(nPaths === R.STYLES.length,
     'every style is its own signal path (' + nPaths + ' paths / ' + R.STYLES.length + ' styles)');
  note(Object.keys(paths).map(function (k) { return paths[k].join('+'); }).join('  ·  '));

  /* and rendering must agree with the table — same path, same audio */
  var wrong = 0;
  for (var i2 = 0; i2 < R.STYLES.length; i2++)
    for (var j = i2 + 1; j < R.STYLES.length; j++) {
      var a = R.STYLES[i2], b = R.STYLES[j];
      var shouldMatch = pathOf(a) === pathOf(b);
      if (same(out[a], out[b]) !== shouldMatch) wrong++;
    }
  ok(wrong === 0, 'rendering agrees with the table: same path renders identically, different paths do not');
  ok(!same(out.fresh, out.spasm),
     'fresh and spasm are NO LONGER the same path — spasm has its own peak decay');
  ok(!same(out.fresh, out.settling) && !same(out.fresh, out.repose),
     'settling and repose are genuinely different paths');

  /* The decay has to move in the direction claimed, not merely differ.
     Derived from the STYLE table so the direction of the assertion cannot
     disagree with the constants it is describing. */
  var pkFresh = R.STYLE.fresh.pkMs, pkSpasm = R.STYLE.spasm.pkMs;
  ok(pkSpasm < pkFresh,
     'spasm decays faster than fresh in the table (' + pkSpasm + ' ms vs ' + pkFresh + ' ms)');

  /* and in the audio: a sustained tone lets the two followers settle to
     different places, so the steady-state gain reduction must differ. */
  function settledGr(sty) {
    var s = R.defaultState();
    s.style = sty; s.thresh = -30; s.ratio = 4; s.knee = 0;
    s.attack = 1; s.release = 50; s.autoRel = false; s.makeup = 0;
    var m = 24000, sig = R.makeSine(200, FS, m, 0.5);   // (freq, fs, n, amp)
    var e = R.createEngine(FS);
    e.setState(s);
    var a = new Float64Array(m), b = new Float64Array(m);
    e.process(sig, sig, a, b);
    /* peak of the last 2000 samples, in dB, against the input's */
    var po = 0, pi = 0, i4;
    for (i4 = m - 2000; i4 < m; i4++) {
      var va = a[i4] < 0 ? -a[i4] : a[i4]; if (va > po) po = va;
      var vi = sig[i4] < 0 ? -sig[i4] : sig[i4]; if (vi > pi) pi = vi;
    }
    return db(po / pi);
  }
  var grF = settledGr('fresh'), grS = settledGr('spasm');
  ok(Math.abs(grF - grS) > 0.01,
     'the two followers settle to measurably different reduction (fresh ' +
     grF.toFixed(3) + ' dB, spasm ' + grS.toFixed(3) + ' dB)');
  note('a 2 ms follower falls further between cycles of a 200 Hz tone, so it ' +
       'reads a lower average level and compresses less on sustain — which is ' +
       'exactly the transient-forward character wanted.');
})();

/* ============================================================
   HOLES FOUND BY THE MUTATION TESTER (tests/rigor_mutate.js)
   Each of these closes a specific mutant that survived the whole 198-test
   suite. They are not hypothetical: the tester proved that RIGOR could be
   wrong in exactly these ways today and nothing in this file would say so.
   ============================================================ */
(function () {
  /* ---- 1. the two channels must behave identically ----
     Mutant: the right channel attacked with the release coefficient.
     Every stereo source would have drifted image on transients, and 198
     tests passed. Nothing here was comparing L against R at all. */
  var n = 4096;
  var burst = new Float64Array(n);
  for (var i = 0; i < n; i++) burst[i] = (i > 500 && i < 2500) ? 0.8 : 0.02;
  var sil = new Float64Array(n);

  function runLR(a, b) {
    var st = styled('fresh', { thresh: -30, ratio: 8, link: 0, attack: 5 });
    var e = R.createEngine(48000); e.setState(st);
    var oa = new Float64Array(n), ob = new Float64Array(n);
    e.process(a, b, oa, ob);
    return [oa, ob];
  }
  /* signal on the left only, then the same signal on the right only.
     With link at 0 the channels are independent, so out.L of the first
     must equal out.R of the second, sample for sample. */
  var A = runLR(burst, sil), B = runLR(sil, burst);
  var maxD = 0;
  for (i = 0; i < n; i++) { var d = Math.abs(A[0][i] - B[1][i]); if (d > maxD) maxD = d; }
  ok(maxD === 0, 'the left and right channels are the SAME compressor — ' +
     'signal on L alone gives bit-identical output to the same signal on R alone',
     'worst difference ' + maxD.toExponential(3));

  /* ---- 2. reported latency must be the REAL delay ----
     Mutant: lookahead ignored a one-sample delay. The host would have
     misaligned the track and the meter would have said everything was fine.
     Checked at the SMALLEST non-zero setting, because that is where an
     off-by-one hides — a legal value that is also a boundary value. */
  var smallest = 1000 / 48000;   /* one sample of lookahead, in ms */
  [smallest, 0.5, 5].forEach(function (ms) {
    var st = styled('fresh', { look: ms, thresh: 0, ratio: 1, mix: 100 });
    var e = R.createEngine(48000); e.setState(st);
    var imp = new Float64Array(512); imp[0] = 1;
    var oL = new Float64Array(512), oR = new Float64Array(512);
    e.process(imp, imp, oL, oR);
    var lat = e.latency(), where = -1;
    for (i = 0; i < 512; i++) if (oL[i] !== 0) { where = i; break; }
    ok(where === lat,
       'lookahead ' + ms.toFixed(4) + ' ms: the impulse comes out exactly ' +
       'where latency() says it will — reported ' + lat +
       ', arrived at ' + where);
  });

  /* ---- 3. the splitter enforces its OWN separation rule ----
     Mutant: the separation rule pushed the low crossover DOWN instead of
     the high one up. It survived a test that went through setState,
     because sanitizeState carries a second copy of the same rule and
     always runs first — so the splitter's copy is unreachable that way and
     the mutant was invisible. The rule is still real defence-in-depth
     (the splitter also clamps to fs * 0.45, which sanitizeState does not
     know about), so the fix is to test the splitter DIRECTLY. It is
     exported for exactly this reason.

     A rule with two copies needs two tests, or the second copy is
     decoration. */
  var sp = R.createSplitter(48000);
  sp.set(3, 5000, 1000);                 /* deliberately inverted */
  var out6 = new Float64Array(6);
  var eB = [0, 0, 0];
  for (i = 0; i < 8192; i++) {
    var v = 0.5 * Math.sin(2 * Math.PI * 2000 * i / 48000);
    sp.split(v, v, out6);
    if (i >= 4096) for (var k = 0; k < 3; k++) eB[k] += out6[k * 2] * out6[k * 2];
  }
  ok(eB[0] > eB[2] * 100,
     'the splitter given crossovers of 5000/1000 raises the UPPER one — a ' +
     '2 kHz tone stays in the low band, where the request put it (band 1 ' +
     eB[0].toExponential(2) + ' vs band 3 ' + eB[2].toExponential(2) + ')');

  /* and the copy in sanitizeState must agree with it */
  var sz = R.sanitizeState(styled('fresh', { bands: 3, xover: [5000, 1000] }));
  ok(sz.xover[0] === 5000 && sz.xover[1] >= 5500,
     'sanitizeState resolves the same inverted request the same way — the ' +
     'requested low crossover survives and the upper one is raised above it ' +
     '(' + sz.xover[0] + ' / ' + sz.xover[1] + ')');

  /* ---- 4. the transient split must lean on the FAST follower ----
     Mutant: the blend weights were swapped, so the newest DSP in the
     building leaned on the SLOW follower exactly when the signal moved.

     My first attempt at this test asserted that split=100 would reach the
     transient FASTER than split=0. That is not something the signal path
     can do and the test was wrong, not the engine: both followers are
     lowpasses, so blending toward either of them can only be slower than
     the raw detector value. Recording it because it is the same mistake
     this project keeps making — an assertion that re-derives the path.

     What IS derivable is the convergence RATE, straight from the two
     declared coefficients. The fast follower has a 1.5 ms time constant
     and the slow one 60 ms. If the blend leans on the fast follower it
     must have essentially caught up within a few milliseconds of the
     transient. A slow-leaning blend physically cannot: 10 ms is a sixth
     of one 60 ms time constant, barely 15 % of the way there. */
  /* link MUST be 0 here. With the channels linked the detector takes
     max(L, R), and on identical material that maximum absorbs almost all
     of a mis-weighted blend — the mutant moved the output by 6e-5 and this
     test could not see it. Unlinked, the same mutant moves it by 0.64.
     A test can be pointed at the right line and still be looking through
     a setting that hides the answer. */
  function grAt(ts, at) {
    var st = styled('fresh', { thresh: -30, ratio: 10, attack: 0.1,
                               tsSplit: ts, link: 0 });
    var e = R.createEngine(48000); e.setState(st);
    var a = new Float64Array(n), b = new Float64Array(n);
    e.process(burst, burst, a, b);
    return 20 * Math.log10(Math.abs(a[at]) / Math.abs(burst[at]));
  }
  var onsetAt = 501;
  var tenMs = onsetAt + Math.round(48000 * 0.010);   /* 10 ms after the edge */
  var ref = grAt(0, tenMs);
  var gap = Math.abs(grAt(100, tenMs) - ref);
  ok(gap < 0.35,
     '10 ms after a transient the split detector has converged to within ' +
     '0.35 dB of the unsplit one — it is riding the 1.5 ms follower, not the ' +
     '60 ms one (gap ' + gap.toFixed(3) + ' dB)');

  /* and the other half of the claim: on steady material the two followers
     agree, so the split has almost nothing left to do */
  var steady = new Float64Array(n);
  for (i = 0; i < n; i++) steady[i] = 0.8 * Math.sin(2 * Math.PI * 300 * i / 48000);
  var save = burst; burst = steady;
  var steadyGap = Math.abs(grAt(100, 3000) - grAt(0, 3000));
  burst = save;
  ok(steadyGap < 1.0,
     'on steady material the fast and slow followers converge, so the ' +
     'transient split barely changes the result (gap ' +
     steadyGap.toFixed(3) + ' dB)');
})();

/* ============================================================
   ROUND 9's TWO UNTESTED FIELDS (found by tests/rigor_coverage.js)
   deltaBand and scBand were verified by hand when they were built and then
   never pinned down by anything. A field nobody names is a field that can
   quietly stop working, so here they are, asserted by properties rather
   than by remembered numbers.
   ============================================================ */
(function () {
  var FSx = 48000, n = 16384;
  /* A short release ON PURPOSE. The first version of the scBand test used
     the default 200 ms and then measured a "quiet" window 17 ms after the
     burst — which is still deep inside the release tail, so of course the
     band was still ducked. There is no burst-free window at that spacing.
     The release and the burst period are chosen here so that five release
     constants fit in the gap, and the measuring window is derived from
     that rather than picked by eye. */
  var RELMS = 20, relN = Math.round(FSx * RELMS / 1000);
  var PERIOD = 8192, BURST = 1200;

  /* material with energy in a low band and a burst high up, so the two
     bands are separable by ear and by arithmetic */
  var x = new Float64Array(n);
  for (var i = 0; i < n; i++) {
    var low = 0.35 * Math.sin(2 * Math.PI * 90 * i / FSx);
    var hiOn = (i % PERIOD) < BURST;
    var hi = hiOn ? 0.55 * Math.sin(2 * Math.PI * 6000 * i / FSx) : 0;
    x[i] = low + hi;
  }
  function render(patch) {
    var st = styled('fresh', patch);
    st = R.sanitizeState(st);
    var e = (st.bands > 1 ? R.createMulti : R.createEngine)(FSx);
    e.setState(st);
    var a = new Float64Array(n), b = new Float64Array(n);
    e.process(x, x, a, b);
    return a;
  }
  function energy(a) {
    var s2 = 0;
    for (var j = n / 2; j < n; j++) s2 += a[j] * a[j];   /* skip settling */
    return s2;
  }

  var base3 = { bands: 3, xover: [300, 3000], thresh: -30, ratio: 8, release: RELMS };
  function withB(extra) {
    var o = {}; for (var k in base3) o[k] = base3[k];
    for (var k2 in extra) o[k2] = extra[k2];
    return o;
  }

  /* ---- deltaBand ----
     The whole delta signal is everything the compressor removed. Splitting
     it per band must ACCOUNT for that signal: each band's delta is a part
     of it, none of them is the whole thing, and the parts are disjoint
     enough that they sum to something close to it. Asserting the sum
     rather than a remembered magnitude is what makes this survive a
     future change to the crossover. */
  var whole = render(withB({ delta: true }));
  var parts = [1, 2, 3].map(function (bd) {
    return render(withB({ delta: true, deltaBand: bd }));
  });
  var eWhole = energy(whole);
  var eParts = parts.map(energy);

  ok(eWhole > 0, 'delta on 3 bands removes something to look at (energy ' +
     eWhole.toExponential(2) + ')');

  eParts.forEach(function (e2, k) {
    ok(e2 < eWhole, 'deltaBand ' + (k + 1) + ' is a PART of the whole ' +
       'removal, not all of it (' + (e2 / eWhole).toFixed(4) + ' of it)');
  });

  var summed = new Float64Array(n);
  for (i = 0; i < n; i++) summed[i] = parts[0][i] + parts[1][i] + parts[2][i];
  var relErr = Math.abs(energy(summed) - eWhole) / eWhole;
  ok(relErr < 0.02, 'the three per-band deltas SUM back to the whole delta ' +
     '— the split accounts for all of the removal (relative error ' +
     (relErr * 100).toFixed(2) + '%)');

  ok(!bitSame(parts[0], parts[2]),
     'deltaBand 1 and deltaBand 3 are different signals — the control ' +
     'actually selects a band rather than being decorative');

  /* ---- scBand ----
     Band 3 ducking band 1 is the whole point. The low tone is steady, so
     without a band sidechain the low band's gain barely moves; with
     scBand = 3 the high burst must duck it. Comparing the low band against
     ITSELF under the two settings is the derivable form — it needs no
     remembered dB figure. */
  var soloLow = { mute: false, solo: true };
  function lowBandOnly(extra) {
    var st = R.sanitizeState(styled('fresh', withB(extra)));
    st.band[0].solo = true;
    var e = R.createMulti(FSx); e.setState(st);
    var a = new Float64Array(n), b = new Float64Array(n);
    e.process(x, x, a, b);
    return a;
  }
  var free = lowBandOnly({});
  var ducked = lowBandOnly({ scBand: 3 });

  /* measure inside the high burst, where the two must diverge */
  function windowEnergy(a, from, to) {
    var s2 = 0; for (var j = from; j < to; j++) s2 += a[j] * a[j]; return s2;
  }
  var burstFrom = PERIOD + 100, burstTo = PERIOD + BURST - 100;
  /* Compare each condition against ITSELF across time, not against the
     other one. My first attempt compared the two conditions directly and
     asserted the wrong direction twice: without a band sidechain the low
     band is compressing hard against its OWN steady 90 Hz tone, so
     switching its detector to the mostly-quiet high band makes it LOUDER
     overall, not quieter. That absolute comparison was never going to say
     anything about whether the sidechain works.

     What a band sidechain means is that the low band's gain should follow
     BAND 3's envelope. Band 3 bursts; the low band's own content does not.
     So: under scBand the low band must dip during the burst and recover
     between bursts, and without it the low band should be roughly level
     across both windows because nothing in its own input changed. */
  /* five release constants after the burst ends, which is where the tail
     is down to e^-5 of itself and any difference left is real */
  var quietFrom = PERIOD + BURST + 5 * relN, quietTo = quietFrom + 1000;

  var duckBurst = windowEnergy(ducked, burstFrom, burstTo);
  var duckQuiet = windowEnergy(ducked, quietFrom, quietTo);
  var freeBurst = windowEnergy(free, burstFrom, burstTo);
  var freeQuiet = windowEnergy(free, quietFrom, quietTo);
  var nBurst = burstTo - burstFrom, nQuiet = quietTo - quietFrom;
  function perSampleDb(e2, cnt) { return 10 * Math.log10(e2 / cnt); }

  var duckDip = perSampleDb(duckQuiet, nQuiet) - perSampleDb(duckBurst, nBurst);
  var freeDip = perSampleDb(freeQuiet, nQuiet) - perSampleDb(freeBurst, nBurst);

  ok(duckDip > 3,
     'scBand 3 makes band 3 duck band 1 — under the band sidechain the low ' +
     'band dips ' + duckDip.toFixed(2) + ' dB while the 6 kHz burst plays, ' +
     'even though its own input never changes');

  ok(Math.abs(freeDip) < 1,
     'and without the band sidechain the same low band is level across the ' +
     'same two windows (' + freeDip.toFixed(2) + ' dB) — so the dip above is ' +
     'the sidechain and not the material');

  ok(bitSame(lowBandOnly({ scBand: 0 }), free),
     'scBand 0 is exactly "off" — bit-identical to not setting it');
})();

/* ============================================================
   BYPASS: a promise about every state, and what it means when
   there is a crossover in the way.

   Both halves of this were broken and both were measured before
   they were fixed. `latencySamples()` reported the lookahead in
   every state while the bypassed impulse came out at sample 0, so
   a host compensating by the reported figure moved the audio up
   to 10 ms EARLIER the moment you pressed bypass — which made
   every A/B with lookahead on invalid. And the delay line went
   unfed while bypassed, so LEAVING bypass dropped `look`
   milliseconds of digital silence into the track.

   These assertions DERIVE their expectation from
   latencySamples() rather than naming a number, because an
   assertion that states its own expected value is restating
   itself, not checking anything. That mistake has been made in
   this project before.
   ============================================================ */
(function () {
  var fsr = 48000, n = 8192;
  var sig = new Float64Array(n);
  for (var i = 0; i < n; i++)
    sig[i] = Math.sin(i * 0.037) * 0.4 + Math.sin(i * 0.31) * 0.2 + Math.sin(i * 1.1) * 0.1;

  function render(st, Ctor) {
    var e = Ctor(fsr); e.setState(st);
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(sig, sig, oL, oR);
    return oL;
  }
  /* is `out` exactly `sig` delayed by L? bitwise, not "close" */
  function isDelayedDry(out, L) {
    for (var i = 0; i < n - L; i++) if (out[i + L] !== sig[i]) return false;
    return true;
  }

  [0, 1, 5, 10, 20].forEach(function (ms) {
    var st = R.defaultState(); st.look = ms; st.bypass = true;
    var L = R.latencySamples(st, fsr);
    ok(isDelayedDry(render(st, R.createEngine), L),
       'bypass at look = ' + ms + ' ms is the dry signal delayed by exactly the ' +
       'reported ' + L + ' samples — the engine keeps the promise latencySamples() makes');
  });

  /* the second half: the line must be PRIMED, or leaving bypass drops out */
  (function () {
    var st = R.defaultState(); st.look = 10; st.bypass = true;
    var e = R.createEngine(fsr); e.setState(st);
    var oL = new Float64Array(n), oR = new Float64Array(n);
    e.process(sig, sig, oL, oR);
    st.bypass = false; e.setState(st);
    var pL = new Float64Array(n), pR = new Float64Array(n);
    e.process(sig, sig, pL, pR);
    var L = R.latencySamples(st, fsr), peak = 0;
    for (var i = 0; i < L; i++) if (Math.abs(pL[i]) > peak) peak = Math.abs(pL[i]);
    ok(peak > 0.05,
       'and the line stays fed WHILE bypassed, so the first ' + L + ' samples after ' +
       'leaving bypass carry audio (peak ' + peak.toFixed(4) + ') instead of the ' +
       'silent dropout this used to produce');
  })();

  /* bypassSplit — the switch, at every band count.
     Note the two copies problem: sanitizeState and the wrapper both
     have a say here, so this exercises it through setState rather
     than by poking the engine. */
  [1, 2, 3].forEach(function (nb) {
    [0, 10].forEach(function (ms) {
      var st = R.defaultState();
      st.bands = nb; st.look = ms; st.bypass = true; st.bypassSplit = false;
      var L = R.latencySamples(st, fsr);
      ok(isDelayedDry(render(st, R.createMulti), L),
         'dry bypass at ' + nb + ' band' + (nb > 1 ? 's' : '') + ', look = ' + ms +
         ' ms is bit-transparent — the audio never enters the splitter');
    });
  });

  [2, 3].forEach(function (nb) {
    var st = R.defaultState();
    st.bands = nb; st.bypass = true; st.bypassSplit = true;
    var out = render(st, R.createMulti), diff = 0;
    for (var i = 0; i < n; i++) if (out[i] !== sig[i]) diff++;
    ok(diff > n / 2,
       'crossover-only bypass at ' + nb + ' bands is deliberately NOT transparent ' +
       '(' + diff + ' of ' + n + ' samples differ) — an LR4 pair is magnitude-flat ' +
       'and emphatically not linear-phase, which is the whole point of offering it');
  });

  /* the switch must be inert everywhere it has no business acting */
  [0, 10].forEach(function (ms) {
    var a = R.defaultState(); a.bands = 1; a.look = ms; a.bypass = true; a.bypassSplit = false;
    var b = R.defaultState(); b.bands = 1; b.look = ms; b.bypass = true; b.bypassSplit = true;
    ok(bitSame(render(a, R.createMulti), render(b, R.createMulti)),
       'bypassSplit is inert at 1 band (look = ' + ms + ' ms) — there is no crossover ' +
       'to route through, which is what keeps the bands === 1 bit-identity load-bearing');
  });

  [2, 3].forEach(function (nb) {
    var a = R.defaultState(); a.bands = nb; a.look = 5; a.thresh = -30; a.bypassSplit = false;
    var b = R.defaultState(); b.bands = nb; b.look = 5; b.thresh = -30; b.bypassSplit = true;
    ok(bitSame(render(a, R.createMulti), render(b, R.createMulti)),
       'and inert at ' + nb + ' bands while actually compressing — it is a property ' +
       'of bypass, not a second signal path through the working engine');
  });
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
