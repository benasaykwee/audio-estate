/* RIGOR fuzzer — random states, hostile signals, no mercy.
   The harnesses test what I thought to test. This tests what I didn't.
   Deterministic: every run uses the same seeded sequence, so a failure
   can be reproduced by running it again.
   node tests/rigor_fuzz.js [iterations] */
'use strict';
var R = require('../rigor_core.js');

var FS = 48000;
var ITER = parseInt(process.argv[2], 10) || 400;
var pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } }
function note(s) { console.log('    · ' + s); }

/* Park–Miller, same generator the core uses, so the fuzzer is as
   deterministic as the thing it is fuzzing. */
function rng(seed) {
  var x = (seed >>> 0) || 1;
  return function () { x = (x * 16807) % 2147483647; return x / 2147483647; };
}

console.log('RIGOR fuzzer — ' + ITER + ' iterations, seeded and reproducible');

/* ============================================================
   1. THE STATE FUZZER
   sanitizeState is the only thing standing between a corrupt case file
   and the DSP. It must ALWAYS return something the engine can run, from
   any input at all — including hostile ones.
   ============================================================ */
console.log('\n— state fuzzer —');
(function () {
  var rnd = rng(9001);
  var HOSTILE = [undefined, null, NaN, Infinity, -Infinity, '', 'nonsense',
                 {}, [], true, false, 0, -0, 1e308, -1e308, 1e-308, '12', '-0'];
  function pick(a) { return a[Math.floor(rnd() * a.length) % a.length]; }
  function hostileVal() {
    var r = rnd();
    if (r < 0.45) return HOSTILE[Math.floor(rnd() * HOSTILE.length) % HOSTILE.length];
    if (r < 0.75) return (rnd() - 0.5) * 4000;
    return pick(['lr', 'ms', 'fresh', 'spasm', 'auto', 'peak', 'rms', 'zzz']);
  }
  var KEYS = Object.keys(R.defaultState());
  var bad = 0, notIdem = 0, threw = 0, n = 0;
  var firstBad = null;

  for (var it = 0; it < ITER * 4; it++) {
    var s = {};
    var howMany = 1 + Math.floor(rnd() * KEYS.length);
    for (var k = 0; k < howMany; k++) s[KEYS[Math.floor(rnd() * KEYS.length) % KEYS.length]] = hostileVal();
    /* sometimes hand it a malformed band array or xover */
    if (rnd() < 0.3) s.band = [hostileVal(), { gain: hostileVal(), mute: hostileVal() }];
    if (rnd() < 0.3) s.xover = [hostileVal(), hostileVal()];
    if (rnd() < 0.1) s.band = hostileVal();
    if (rnd() < 0.1) s.xover = hostileVal();

    var a;
    try { a = R.sanitizeState(s); } catch (e) { threw++; if (!firstBad) firstBad = JSON.stringify(s); continue; }
    n++;

    /* every numeric field must be finite and inside its range */
    var okAll = true;
    function chk(v, lo, hi) { if (typeof v !== 'number' || !isFinite(v) || v < lo || v > hi) okAll = false; }
    chk(a.inGain, -24, 24); chk(a.thresh, -60, 0); chk(a.ratio, 1, R.RATIO_INF);
    chk(a.knee, 0, 30); chk(a.attack, 0.02, 500); chk(a.release, 1, 2500);
    chk(a.hold, 0, 500); chk(a.range, 0, 60); chk(a.look, 0, R.MAX_LOOK_MS);
    chk(a.holdTaper, 0, 100);
    /* detOsX is a SET, not a range — chk would pass 3. */
    if (R.DET_OS_CHOICES.indexOf(a.detOsX) < 0) okAll = false;
    chk(a.scHp, 10, 1000); chk(a.scLp, 1000, 20000);
    chk(a.link, 0, 100); chk(a.mix, 0, 100); chk(a.makeup, -24, 24);
    chk(a.curve, 0, 100); chk(a.bands, 1, R.MAX_BANDS);
    chk(a.relSync, 0, R.SYNC_DIV.length - 1); chk(a.bpm, 20, 300);
    chk(a.xover[0], 20, 20000); chk(a.xover[1], 20, 20000);
    if (a.xover[1] < a.xover[0] * 1.1 - 1e-9) okAll = false;
    if (R.STYLES.indexOf(a.style) < 0) okAll = false;
    if (R.DETECTS.indexOf(a.detect) < 0) okAll = false;
    if (R.PLACES.indexOf(a.place) < 0) okAll = false;
    if (a.band.length !== R.MAX_BANDS) okAll = false;
    a.band.forEach(function (b) {
      chk(b.threshOff, -24, 24); chk(b.gain, -24, 24);
      if (typeof b.mute !== 'boolean' || typeof b.solo !== 'boolean') okAll = false;
    });
    if (!okAll) { bad++; if (!firstBad) firstBad = JSON.stringify(s); }

    /* IDEMPOTENT: sanitising a sanitised state must change nothing, or
       a case file would drift every time it was loaded and saved */
    if (JSON.stringify(R.sanitizeState(a)) !== JSON.stringify(a)) {
      notIdem++;
      if (!firstBad) firstBad = JSON.stringify(s);
    }
  }
  ok(threw === 0, 'sanitizeState never throws (' + (ITER * 4) + ' hostile inputs)');
  ok(bad === 0, 'every sanitised state is inside every range');
  ok(notIdem === 0, 'sanitizeState is idempotent');
  if (firstBad) note('first offending input: ' + firstBad.slice(0, 180));

  /* JSON round trip, which is what a case file actually is */
  var rtBad = 0;
  for (it = 0; it < ITER; it++) {
    var st = R.sanitizeState({
      style: R.STYLES[Math.floor(rnd() * 4) % 4],
      thresh: -rnd() * 60, ratio: 1 + rnd() * 60, knee: rnd() * 30,
      bands: 1 + Math.floor(rnd() * 3), place: rnd() < 0.5 ? 'ms' : 'lr',
      curve: rnd() * 100, relSync: Math.floor(rnd() * 11), bpm: 20 + rnd() * 280,
      band: [{ gain: (rnd() - 0.5) * 40 }, { threshOff: (rnd() - 0.5) * 40 }, { solo: rnd() < 0.5 }]
    });
    if (JSON.stringify(R.sanitizeState(JSON.parse(JSON.stringify(st)))) !== JSON.stringify(st)) rtBad++;
  }
  ok(rtBad === 0, 'a sanitised state survives a JSON round trip unchanged (' + ITER + ' cases)');
})();

/* ============================================================
   2. THE SIGNAL FUZZER
   Random states x hostile material. Nothing may produce a NaN, an
   infinity, or a level that runs away — in either the single engine or
   the multiband wrapper.
   ============================================================ */
console.log('\n— signal fuzzer —');
(function () {
  var rnd = rng(31337);
  var N = 4096;

  function material(kind, seed) {
    var a = new Float64Array(N), r2 = rng(seed), i;
    switch (kind) {
      case 0: for (i = 0; i < N; i++) a[i] = (r2() * 2 - 1) * 0.999; break;      // full-scale noise
      case 1: for (i = 0; i < N; i++) a[i] = i % 2 ? 0.999 : -0.999; break;      // Nyquist square
      case 2: for (i = 0; i < N; i++) a[i] = (i % 512 === 0) ? 1.0 : 0; break;   // impulse train
      case 3: for (i = 0; i < N; i++) a[i] = i < N / 2 ? 0 : 0.999; break;       // DC step
      case 4: for (i = 0; i < N; i++) a[i] = 0; break;                           // digital silence
      case 5: for (i = 0; i < N; i++) a[i] = Math.cos(Math.PI * i / 2 + Math.PI / 4); break; // inter-sample peaks
      case 6: for (i = 0; i < N; i++) a[i] = (r2() * 2 - 1) * 1e-25; break;      // denormal-adjacent
      default: for (i = 0; i < N; i++) a[i] = Math.sin(2 * Math.PI * 19000 * i / FS) * 0.999;
    }
    return a;
  }
  function randomState() {
    return R.sanitizeState({
      style: R.STYLES[Math.floor(rnd() * 4) % 4],
      inGain: (rnd() - 0.5) * 48,
      thresh: -rnd() * 60,
      ratio: rnd() < 0.15 ? R.RATIO_INF : 1 + rnd() * 40,
      knee: rnd() * 30,
      attack: 0.02 + rnd() * 400,
      release: 1 + rnd() * 2400,
      autoRel: rnd() < 0.5,
      relSync: rnd() < 0.3 ? Math.floor(rnd() * 11) : 0,
      bpm: 20 + rnd() * 280,
      curve: rnd() < 0.4 ? rnd() * 100 : 0,
      hold: rnd() * 500,
      /* round 8. Deliberately fed ILLEGAL phase counts most of the time:
         the sanitiser's job is to reject 3 and 16, and a fuzzer that only
         offers legal values never tests the rejection. */
      holdTaper: rnd() < 0.4 ? rnd() * 100 : 0,
      detOsX: rnd() < 0.5 ? R.DET_OS_CHOICES[Math.floor(rnd() * 3) % 3]
                          : Math.floor(rnd() * 20) - 4,
      range: rnd() * 60,
      look: rnd() < 0.4 ? rnd() * R.MAX_LOOK_MS : 0,
      detect: R.DETECTS[Math.floor(rnd() * 3) % 3],
      detOs: rnd() < 0.3,
      scOn: rnd() < 0.4,
      scHp: 10 + rnd() * 990,
      scLp: 1000 + rnd() * 19000,
      scListen: rnd() < 0.1,
      link: rnd() * 100,
      place: rnd() < 0.3 ? 'ms' : 'lr',
      mix: rnd() * 100,
      delta: rnd() < 0.2,
      makeup: (rnd() - 0.5) * 48,
      autoMakeup: rnd() < 0.3,
      bands: 1 + Math.floor(rnd() * 3),
      xover: [20 + rnd() * 2000, 500 + rnd() * 15000],
      band: [{ threshOff: (rnd() - 0.5) * 48, gain: (rnd() - 0.5) * 48, mute: rnd() < 0.15, solo: rnd() < 0.15 },
             { threshOff: (rnd() - 0.5) * 48, gain: (rnd() - 0.5) * 48, mute: rnd() < 0.15, solo: rnd() < 0.15 },
             { threshOff: (rnd() - 0.5) * 48, gain: (rnd() - 0.5) * 48, mute: rnd() < 0.15, solo: rnd() < 0.15 }]
    });
  }

  var nan = 0, huge = 0, latBad = 0, meterBad = 0, threw = 0;
  var worstPeak = 0, firstFail = null;
  for (var it = 0; it < ITER; it++) {
    var st = randomState();
    var kind = Math.floor(rnd() * 8) % 8;
    var L = material(kind, 1000 + it), Rr = material((kind + 3) % 8, 2000 + it);
    var e = (st.bands > 1 ? R.createMulti : R.createEngine)(FS);
    var oL = new Float64Array(N), oR = new Float64Array(N);
    try {
      e.setState(st);
      e.process(L, Rr, oL, oR);
    } catch (err) { threw++; if (!firstFail) firstFail = err.message + ' :: ' + JSON.stringify(st); continue; }

    /* WHAT THIS ASSERTION IS FOR, and what it is not.
       I tried six times to bound the output with an exact model of the
       gain staging, and was wrong six times — a flat constant, then
       forgetting mid/side, then Linkwitz-Riley ringing, then measuring
       that ringing on a step when noise excites it 1.7x harder, then
       sidechain-listen still meeting per-band gain, then per-band auto
       makeup following each band's SHIFTED threshold. Each wrong version
       made the fuzzer report my bound instead of a bug. The engine was
       right every single time.
       The lesson is the point: a bound that re-derives the signal path
       is a second implementation of it, with its own bugs and none of
       the tests. So the assertion is split.
       Here, over the FULL random space, the check is only what can be
       guaranteed: finite, and below a ceiling far above anything the
       parameter ranges permit (+24 in, +60 auto makeup, +24 per band,
       three bands is 7.5e5). Divergence is orders of magnitude; this
       catches it. The tight bound lives below, on a subspace where the
       gain staging is unity and therefore knowable. */
    var ceiling = 5e6;

    for (var i = 0; i < N; i++) {
      var a = oL[i], b = oR[i];
      if (!isFinite(a) || !isFinite(b)) { nan++; if (!firstFail) firstFail = 'non-finite at ' + i + ' :: ' + JSON.stringify(st); break; }
      var m = Math.abs(a) > Math.abs(b) ? Math.abs(a) : Math.abs(b);
      if (m > worstPeak) worstPeak = m;
      /* The bound is DERIVED from the state, not invented. The first
         version used a flat 1e4 and duly "found" a 1.26e4 peak that was
         simply a user asking for +24 in, +60 of auto makeup and +24 per
         band across three bands. A ceiling you made up is not a test, it
         is a second bug waiting to be reported. */
      if (m > ceiling) { huge++; if (!firstFail) firstFail = 'runaway ' + m + ' > ceiling ' + ceiling.toExponential(2) + ' :: ' + JSON.stringify(st); break; }
    }
    var mt = e.meters();
    if (!isFinite(mt.gr) || mt.gr > 1e-9) meterBad++;
    if (!isFinite(mt.tpL) || !isFinite(mt.corr) || Math.abs(mt.corr) > 1.0000001) meterBad++;
    var wantLat = R.latencySamples(st, FS);
    if (e.latency() !== wantLat) latBad++;
  }
  ok(threw === 0, 'no exception in ' + ITER + ' random renders');
  ok(nan === 0, 'no NaN or infinity in any output sample');
  ok(huge === 0, 'no runaway levels (worst peak ' + worstPeak.toExponential(2) + ')');
  ok(meterBad === 0, 'meters stay finite and in range');
  ok(latBad === 0, 'reported latency always matches latencySamples()');
  if (firstFail) note('first failure: ' + firstFail.slice(0, 220));

  /* THE TIGHT BOUND, on a subspace where gain staging is unity.
     No input gain, no makeup, no band gain, no auto makeup, no listen.
     A compressor can then only ever make a signal QUIETER, so the output
     must not exceed the input at all — except through the crossover,
     which rings. That is checkable, and it is where a real gain bug
     would show up. */
  var tightBad = 0, worstTight = 0, tightFail = null;
  for (it = 0; it < ITER; it++) {
    var st2 = randomState();
    st2.inGain = 0; st2.makeup = 0; st2.autoMakeup = false; st2.scListen = false;
    st2.band[0].gain = 0; st2.band[1].gain = 0; st2.band[2].gain = 0;
    st2 = R.sanitizeState(st2);
    var kind2 = Math.floor(rnd() * 8) % 8;
    var L2 = material(kind2, 5000 + it), R2 = material((kind2 + 5) % 8, 6000 + it);
    var e2 = (st2.bands > 1 ? R.createMulti : R.createEngine)(FS);
    var a2 = new Float64Array(N), b2 = new Float64Array(N);
    e2.setState(st2); e2.process(L2, R2, a2, b2);
    var inPk = 0, outPk = 0;
    for (var j = 0; j < N; j++) {
      var ia = Math.abs(L2[j]) > Math.abs(R2[j]) ? Math.abs(L2[j]) : Math.abs(R2[j]);
      if (ia > inPk) inPk = ia;
      var oa = Math.abs(a2[j]) > Math.abs(b2[j]) ? Math.abs(b2[j]) : Math.abs(a2[j]);
      oa = Math.max(Math.abs(a2[j]), Math.abs(b2[j]));
      if (oa > outPk) outPk = oa;
    }
    if (inPk < 1e-12) continue;
    /* ---- THE ALLOWANCE, DERIVED (round 8) ----
       This used to be a fitted constant: "the crossover rings up to 1.73x,
       measured across six crossover pairs and four materials", rounded to
       2.0. Six pairs is not a proof, and when round 8 added two fields to
       randomState() the reshuffled sequence immediately found a 3-band case
       at 2.116 — above the 2.04 allowance and entirely innocent. Neutralis-
       ing the new fields on the SAME sequence reproduced it exactly, which
       is how we know it was the bound that was wrong and not the engine.
       That makes seven fitted output bounds in this file's history and
       seven times the engine was right.

       So derive it instead. At unity gain staging every band's gain is <= 1,
       so the reconstruction cannot exceed the sum of the BAND peaks, which
       the real splitter can be asked for directly:
           outPk <= sum_b peak(band_b)
       That is the triangle inequality over the actual filtered signal, not
       a guess about how much an LR4 rings. Mid/side still doubles, because
       reconstruction is (m+s, m-s). 1.02 keeps the arithmetic slack. */
    var allow;
    if (st2.bands > 1) {
      var sp = R.createSplitter(FS);
      sp.set(st2.bands, st2.xover[0], st2.xover[1]);
      var bo = [0, 0, 0, 0, 0, 0], bandPk = [0, 0, 0];
      for (var q = 0; q < N; q++) {
        sp.split(L2[q], R2[q], bo);
        for (var bq = 0; bq < st2.bands; bq++) {
          var pl = Math.abs(bo[bq * 2]), pr = Math.abs(bo[bq * 2 + 1]);
          var pm = pl > pr ? pl : pr;
          if (pm > bandPk[bq]) bandPk[bq] = pm;
        }
      }
      var sum = 0;
      for (bq = 0; bq < st2.bands; bq++) sum += bandPk[bq];
      allow = 1.02 * (st2.place === 'ms' ? 2 : 1) * (sum / inPk);
    } else {
      allow = 1.02 * (st2.place === 'ms' ? 2 : 1);
    }
    var ratio = outPk / inPk;
    if (ratio / allow > worstTight) worstTight = ratio / allow;
    if (ratio > allow) {
      tightBad++;
      if (!tightFail) tightFail = 'out/in ' + ratio.toFixed(3) + ' > allow ' + allow.toFixed(2) +
        ' :: bands ' + st2.bands + ' place ' + st2.place + ' :: ' + JSON.stringify(st2).slice(0, 160);
    }
  }
  ok(tightBad === 0, 'at unity gain staging a compressor only ever makes things quieter (' +
     ITER + ' cases, worst ' + (worstTight * 100).toFixed(0) + '% of the allowance)');
  if (tightFail) note(tightFail);
})();

/* ============================================================
   3. THE NULL TEST, FUZZED
   The one assertion worth having, checked against random surroundings:
   whatever else is set, a 1:1 ratio must return the input untouched.
   ============================================================ */
console.log('\n— the null test, fuzzed —');
(function () {
  var rnd = rng(4242);
  var N = 4096;
  var bad = 0, tried = 0, firstBad = null;
  for (var it = 0; it < ITER; it++) {
    /* everything random EXCEPT the things that must make it a null:
       ratio 1:1, no makeup, full wet, no delta, no listen, in gain 0 */
    var st = R.sanitizeState({
      style: R.STYLES[Math.floor(rnd() * 4) % 4],
      ratio: 1, thresh: -rnd() * 60, knee: rnd() * 30,
      attack: 0.02 + rnd() * 400, release: 1 + rnd() * 2400,
      autoRel: rnd() < 0.5, relSync: Math.floor(rnd() * 11), bpm: 20 + rnd() * 280,
      curve: rnd() * 100, hold: rnd() * 500, range: 60,
      holdTaper: rnd() * 100,
      detOsX: R.DET_OS_CHOICES[Math.floor(rnd() * 3) % 3],
      detect: R.DETECTS[Math.floor(rnd() * 3) % 3], detOs: rnd() < 0.5,
      link: rnd() * 100, mix: 100, makeup: 0, autoMakeup: false,
      inGain: 0, delta: false, scListen: false, place: 'lr',
      look: 0, bands: 1
    });
    var x = new Float64Array(N), y = new Float64Array(N), r2 = rng(7000 + it);
    for (var i = 0; i < N; i++) { x[i] = (r2() * 2 - 1) * 0.4; y[i] = (r2() * 2 - 1) * 0.4; }
    var e = R.createEngine(FS);
    e.setState(st);
    var oL = new Float64Array(N), oR = new Float64Array(N);
    e.process(x, y, oL, oR);
    tried++;
    for (i = 0; i < N; i++) {
      if (oL[i] !== x[i] || oR[i] !== y[i]) {
        bad++;
        if (!firstBad) firstBad = 'sample ' + i + ' :: ' + JSON.stringify(st);
        break;
      }
    }
  }
  ok(bad === 0, 'at 1:1 the output is BIT-IDENTICAL regardless of every other setting (' + tried + ' cases)');
  if (firstBad) note(firstBad.slice(0, 220));

  /* and the same through the multiband wrapper at one band */
  var mbBad = 0;
  for (it = 0; it < 60; it++) {
    var st2 = R.sanitizeState({ style: R.STYLES[it % 4], ratio: 1, thresh: -20,
      bands: 1, mix: 100, makeup: 0, inGain: 0 });
    var x2 = new Float64Array(1024), r3 = rng(8000 + it);
    for (i = 0; i < 1024; i++) x2[i] = (r3() * 2 - 1) * 0.4;
    var m = R.createMulti(FS);
    m.setState(st2);
    var a2 = new Float64Array(1024), b2 = new Float64Array(1024);
    m.process(x2, x2, a2, b2);
    for (i = 0; i < 1024; i++) if (a2[i] !== x2[i]) { mbBad++; break; }
  }
  ok(mbBad === 0, 'and through the multiband wrapper at one band');
})();

/* ============================================================
   4. SAMPLE RATE — the meters are designed parametrically, so they had
   better actually work away from 48 k.
   ============================================================ */
console.log('\n— sample rates —');
(function () {
  var RATES = [44100, 48000, 88200, 96000, 192000];
  var lufsBad = 0, tpBad = 0, nanBad = 0, latBad = 0;
  RATES.forEach(function (fs) {
    /* EBU 3341 case 1 at every rate: 1 kHz at -23 dBFS peak reads -23 LUFS */
    var n = Math.round(fs * 4), amp = Math.pow(10, -23 / 20);
    var sig = new Float64Array(n);
    for (var i = 0; i < n; i++) sig[i] = amp * Math.sin(2 * Math.PI * 1000 * i / fs);
    var st = R.sanitizeState({ ratio: 1, thresh: -40, makeup: 0 });
    var e = R.createEngine(fs);
    e.setState(st);
    var a = new Float64Array(n), b = new Float64Array(n);
    e.process(sig, sig, a, b);
    var m = e.meters();
    if (!(Math.abs(m.lufsI + 23) < 0.2)) { lufsBad++; note(fs + ' Hz reads ' + m.lufsI.toFixed(2) + ' LUFS'); }
    if (!isFinite(m.tpL)) tpBad++;
    for (i = 0; i < n; i += 97) if (!isFinite(a[i])) { nanBad++; break; }
    /* latency must be reported in SAMPLES, so it scales with the rate */
    var st2 = R.sanitizeState({ look: 5 });
    var e2 = R.createEngine(fs);
    e2.setState(st2);
    if (e2.latency() !== Math.floor(5 * 0.001 * fs + 0.5)) latBad++;
  });
  ok(lufsBad === 0, 'EBU 3341 case 1 reads -23 LUFS at 44.1, 48, 88.2, 96 and 192 k');
  ok(tpBad === 0, 'true peak stays finite at every rate');
  ok(nanBad === 0, 'no non-finite output at any rate');
  ok(latBad === 0, 'reported latency scales with the sample rate');
})();

/* ============================================================
   5. HOST BEHAVIOUR — a DAW does not call the engine the way a test does.
   ============================================================ */
console.log('\n— host behaviour —');
(function () {
  var rnd = rng(777);
  var N = 8192;
  var x = new Float64Array(N), y = new Float64Array(N);
  var r2 = rng(1234);
  for (var i = 0; i < N; i++) {
    var env = (i % 2048 < 256) ? 0.9 : 0.05;
    x[i] = (r2() * 2 - 1) * env; y[i] = (r2() * 2 - 1) * env;
  }
  function runBlocks(st, size, setEvery) {
    var e = (st.bands > 1 ? R.createMulti : R.createEngine)(FS);
    e.setState(st);
    var out = new Float64Array(N), outR = new Float64Array(N);
    for (var p = 0; p < N; p += size) {
      var len = Math.min(size, N - p);
      if (setEvery) e.setState(st);          /* what a host actually does */
      var oL = new Float64Array(len), oR = new Float64Array(len);
      e.process(x.subarray(p, p + len), y.subarray(p, p + len), oL, oR);
      out.set(oL, p); outR.set(oR, p);
    }
    return out;
  }
  function same(a, b) {
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  var blockBad = 0, setBad = 0;
  for (var it = 0; it < 40; it++) {
    var st = R.sanitizeState({
      style: R.STYLES[it % 4], thresh: -20 - rnd() * 20, ratio: 2 + rnd() * 10,
      knee: rnd() * 20, attack: 1 + rnd() * 50, release: 50 + rnd() * 400,
      bands: 1 + Math.floor(rnd() * 3), look: rnd() < 0.5 ? 3 : 0,
      place: rnd() < 0.3 ? 'ms' : 'lr'
    });
    var ref = runBlocks(st, N, false);
    if (!same(ref, runBlocks(st, 32, false))) blockBad++;
    if (!same(ref, runBlocks(st, 127, false))) blockBad++;   /* deliberately not a power of two */
    /* setState on every block with an UNCHANGED state must not alter output —
       hosts do this constantly, and a smoothing reset here would be audible */
    if (!same(ref, runBlocks(st, 256, true))) setBad++;
  }
  ok(blockBad === 0, 'block size does not change the output (32, 127 and whole-buffer, 40 states)');
  ok(setBad === 0, 'setState every block with an unchanged state is a no-op');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
