/* RIGOR audits — the properties a HOST depends on, which the other
   harnesses do not cover because they call the engine politely.
   node tests/rigor_audit.js */
'use strict';
var R = require('../rigor_core.js');

var pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } }
function near(a, b, e, n) { ok(Math.abs(a - b) <= e, n + '  (' + a + ' vs ' + b + ')'); }
function note(s) { console.log('    · ' + s); }
function rng(seed) {
  var x = (seed >>> 0) || 1;
  return function () { x = (x * 16807) % 2147483647; return x / 2147483647; };
}
function styled(name, patch) {
  var s = R.defaultState(), d = R.styleDefaults(name);
  for (var k in d) s[k] = d[k];
  s.style = name;
  if (patch) for (var k2 in patch) s[k2] = patch[k2];
  return s;
}
var FS = 48000;

console.log('RIGOR audits — latency, automation, transitions, extremes');

/* ============================================================
   1. LATENCY COMPENSATION, end to end.
   The plugin reports a number to the host. Nothing so far proves the
   number is the one the audio actually needs.
   ============================================================ */
console.log('\n— latency compensation —');
(function () {
  var N = 16384;
  var src = R.makeNoise(4242, N);
  for (var i = 0; i < N; i++) src[i] *= 0.3;

  [0, 1, 3, 5, 12, 20].forEach(function (ms) {
    /* mix = 0 gives the dry path alone, which is the delayed input and
       nothing else — so the reported latency must line it back up exactly */
    var st = styled('fresh', { ratio: 8, thresh: -40, mix: 0, makeup: 0, look: ms });
    var e = R.createEngine(FS);
    e.setState(st);
    var a = new Float64Array(N), b = new Float64Array(N);
    e.process(src, src, a, b);
    var lat = e.latency();
    var bad = 0;
    for (var k = lat; k < N; k++) if (a[k] !== src[k - lat]) bad++;
    ok(bad === 0 && lat === R.latencySamples(st, FS),
       ms + ' ms lookahead: reported ' + lat + ' samples, and the audio aligns bit-exactly');
  });

  /* the head of the buffer must be silence, not stale memory */
  var st2 = styled('fresh', { ratio: 8, thresh: -40, mix: 0, makeup: 0, look: 5 });
  var e2 = R.createEngine(FS);
  e2.setState(st2);
  var a2 = new Float64Array(N), b2 = new Float64Array(N);
  e2.process(src, src, a2, b2);
  var clean = true;
  for (i = 0; i < e2.latency(); i++) if (a2[i] !== 0) clean = false;
  ok(clean, 'the delay line starts clean — the first ' + e2.latency() + ' samples are silence');
})();

/* ============================================================
   2. MULTIBAND LATENCY CONSISTENCY.
   Every band shares one lookahead setting, so every band must share one
   delay. A single sample of disagreement would smear the sum.
   ============================================================ */
console.log('\n— multiband latency —');
(function () {
  var N = 8192;
  var src = R.makeNoise(777, N);
  for (var i = 0; i < N; i++) src[i] *= 0.3;
  [1, 2, 3].forEach(function (nb) {
    [0, 4, 20].forEach(function (ms) {
      var st = styled('fresh', { bands: nb, look: ms, ratio: 1, thresh: -60, makeup: 0 });
      var m = R.createMulti(FS);
      m.setState(st);
      var a = new Float64Array(N), b = new Float64Array(N);
      m.process(src, src, a, b);
      ok(m.latency() === R.latencySamples(st, FS),
         nb + ' band(s) at ' + ms + ' ms report the same latency as a single engine');
    });
  });

  /* Do the bands share ONE delay?
     The first version of this compared the delayed output against the
     delayed INPUT and demanded they match — which an allpass never will,
     because moving phase is the whole point of a Linkwitz-Riley split.
     That is a bad assertion, not a bug, and it is the same mistake the
     fuzzer's output bound made six times.
     Nor is "look = L shifts the output by L" true in general: with
     lookahead the gain deliberately LEADS the audio, which is the entire
     point of it, so the output is not a pure shift. That was the second
     bad assertion here.
     The property that IS true, and that isolates the delay from the gain:
     at ratio 1:1 the gain is exactly 1 everywhere, so the only thing
     lookahead can do is delay. Render at look = 0 and look = L, and the
     second must be the first shifted by exactly L. If one band were
     delayed differently from another, the sum would differ — and this
     catches it to the bit. */
  function renderLook(nb, ms) {
    var st = styled('fresh', { bands: nb, look: ms, ratio: 1, thresh: -60, makeup: 0 });
    var m = R.createMulti(FS);
    m.setState(st);
    var a = new Float64Array(N), b = new Float64Array(N);
    m.process(src, src, a, b);
    return { out: a, lat: m.latency() };
  }
  [1, 2, 3].forEach(function (nb) {
    var zero = renderLook(nb, 0), five = renderLook(nb, 5);
    var bad = 0;
    for (var k = 0; k + five.lat < N; k++)
      if (five.out[k + five.lat] !== zero.out[k]) { bad++; break; }
    ok(bad === 0, nb + ' band(s): lookahead shifts the output by exactly ' +
       five.lat + ' samples and changes nothing else');
  });
  note('every band shares one delay — a one-sample mismatch would smear the sum');
})();

/* ============================================================
   3. AUTOMATION SMOOTHING.
   Hosts move parameters while audio runs. The harnesses so far set and
   hold. A discontinuity here is a click, and nothing else would catch it.
   ============================================================ */
console.log('\n— automation —');
(function () {
  var N = 24000, BLK = 64;
  var src = new Float64Array(N);
  for (var i = 0; i < N; i++) src[i] = 0.4 * Math.sin(2 * Math.PI * 220 * i / FS);

  var SWEEPS = [
    ['thresh', -60, 0], ['ratio', 1, 40], ['knee', 0, 30],
    ['makeup', -24, 24], ['mix', 0, 100], ['link', 0, 100],
    ['inGain', -24, 24], ['curve', 0, 100], ['range', 0, 60]
  ];
  SWEEPS.forEach(function (sw) {
    var e = R.createEngine(FS);
    var st = styled('fresh', { thresh: -30, ratio: 4, makeup: 0, attack: 5, release: 100 });
    e.setState(st);
    var out = new Float64Array(N);
    for (var p = 0; p < N; p += BLK) {
      var t = p / N;
      st[sw[0]] = sw[1] + (sw[2] - sw[1]) * t;   /* sweep it every block */
      e.setState(st);
      var len = Math.min(BLK, N - p);
      var a = new Float64Array(len), b = new Float64Array(len);
      e.process(src.subarray(p, p + len), src.subarray(p, p + len), a, b);
      out.set(a, p);
    }
    /* a click is a sample-to-sample jump far larger than the signal's own
       slew. The source moves at most 2*pi*220/48000*0.4 per sample. */
    var srcSlew = 0.4 * 2 * Math.PI * 220 / FS;
    var worst = 0, nan = 0;
    for (i = 1; i < N; i++) {
      if (!isFinite(out[i])) { nan++; break; }
      var d = Math.abs(out[i] - out[i - 1]);
      if (d > worst) worst = d;
    }
    ok(nan === 0 && worst < srcSlew * 12,
       'sweeping ' + sw[0] + ' at audio rate produces no click (worst step ' +
       (worst / srcSlew).toFixed(1) + 'x the signal slew)');
  });
})();

/* ============================================================
   4. PARAMETER TRANSITIONS.
   The fuzzer randomises static states. Changing state MID-RENDER is a
   different failure surface: style switches rebuild the engine, band
   count changes reallocate, lookahead changes clear the delay line.
   ============================================================ */
console.log('\n— transitions —');
(function () {
  var rnd = rng(20250815);
  var N = 8192, BLK = 128;
  var src = R.makeNoise(31337, N);
  for (var i = 0; i < N; i++) src[i] *= 0.5;

  var nan = 0, threw = 0, huge = 0, worstPk = 0;
  for (var it = 0; it < 300; it++) {
    var m = R.createMulti(FS);
    var out = new Float64Array(N);
    try {
      for (var p = 0; p < N; p += BLK) {
        /* a new random state EVERY block — the hostile version of
           automation, and exactly what a preset-morphing host does */
        var st = R.sanitizeState({
          style: R.STYLES[Math.floor(rnd() * 4) % 4],
          thresh: -rnd() * 60, ratio: 1 + rnd() * 30, knee: rnd() * 30,
          attack: 0.02 + rnd() * 200, release: 1 + rnd() * 1000,
          look: rnd() < 0.5 ? rnd() * 20 : 0,
          bands: 1 + Math.floor(rnd() * 3),
          xover: [20 + rnd() * 3000, 500 + rnd() * 15000],
          place: rnd() < 0.3 ? 'ms' : 'lr',
          detOs: rnd() < 0.3, delta: rnd() < 0.15,
          scOn: rnd() < 0.4, mix: rnd() * 100, link: rnd() * 100,
          makeup: 0, inGain: 0
        });
        m.setState(st);
        var len = Math.min(BLK, N - p);
        var a = new Float64Array(len), b = new Float64Array(len);
        m.process(src.subarray(p, p + len), src.subarray(p, p + len), a, b);
        out.set(a, p);
      }
    } catch (e) { threw++; continue; }
    for (i = 0; i < N; i++) {
      if (!isFinite(out[i])) { nan++; break; }
      var v = Math.abs(out[i]);
      if (v > worstPk) worstPk = v;
      if (v > 50) { huge++; break; }
    }
  }
  ok(threw === 0, 'changing every parameter every block never throws (300 runs)');
  ok(nan === 0, 'and never produces a NaN');
  ok(huge === 0, 'and never runs away (worst peak ' + worstPk.toFixed(3) + ')');
  note('style, band count and lookahead all rebuild engine state mid-stream');
})();

/* ============================================================
   5. DENORMALS, end to end.
   The guard is asserted as a function elsewhere. This is the case it
   exists for: a long decay into digital silence.
   ============================================================ */
console.log('\n— denormal decay —');
(function () {
  var N = FS;
  var src = new Float64Array(N);
  for (var i = 0; i < 4000; i++) src[i] = 0.9 * Math.sin(2 * Math.PI * 100 * i / FS);

  var bad = 0, cases = 0;
  R.STYLES.forEach(function (sty) {
    [1, 3].forEach(function (nb) {
      cases++;
      var st = styled(sty, { bands: nb, ratio: 8, thresh: -50, release: 2000, makeup: 0, scOn: true });
      var e = (nb > 1 ? R.createMulti : R.createEngine)(FS);
      e.setState(st);
      var a = new Float64Array(N), b = new Float64Array(N);
      e.process(src, src, a, b);
      /* the last tenth of a second, long after the signal stopped */
      for (var k = N - FS / 10; k < N; k++) {
        if (a[k] !== 0 || b[k] !== 0) { bad++; break; }
        if (!isFinite(a[k])) { bad++; break; }
      }
    });
  });
  ok(bad === 0, 'every style at 1 and 3 bands decays to EXACT zero (' + cases + ' cases)');
  note('not "small" — zero. A denormal tail is inaudible and expensive.');
})();

/* ============================================================
   6. EXTREME SAMPLE RATES.
   The sweep elsewhere covers 44.1 to 192. The crossover Nyquist guard
   and the true-peak taps are exactly what breaks outside that.
   ============================================================ */
console.log('\n— extreme sample rates —');
(function () {
  [22050, 384000].forEach(function (fs) {
    var n = Math.round(fs * 0.5);
    var src = R.makeNoise(999, n);
    for (var i = 0; i < n; i++) src[i] *= 0.5;
    var st = styled('repose', { bands: 3, xover: [200, 8000], ratio: 6, thresh: -30,
                                scOn: true, scLp: 20000, detOs: true, look: 5 });
    var m = R.createMulti(fs);
    m.setState(st);
    var a = new Float64Array(n), b = new Float64Array(n);
    var threw = false;
    try { m.process(src, src, a, b); } catch (e) { threw = true; }
    var nan = 0;
    for (i = 0; i < n; i++) if (!isFinite(a[i])) { nan++; break; }
    ok(!threw && nan === 0, fs + ' Hz: three bands, sidechain at 20 kHz, true-peak detection — all finite');
    ok(m.latency() === R.latencySamples(st, fs), 'and latency is correct at ' + fs + ' Hz');
  });
  /* at 22.05 k the sidechain lowpass ceiling (20 kHz) is ABOVE Nyquist,
     and the crossover pair can be too. Both must be clamped, not designed. */
  var sp = R.createSplitter(22050);
  sp.set(3, 19000, 20000);
  var out = new Float64Array(6), bad = 0;
  for (var k = 0; k < 2000; k++) {
    sp.split(Math.sin(k * 0.1), Math.sin(k * 0.1), out);
    for (var j = 0; j < 6; j++) if (!isFinite(out[j])) bad++;
  }
  ok(bad === 0, 'crossovers above Nyquist at 22.05 k are clamped, not designed');
})();

/* ============================================================
   7. PLUGIN STATE ROUND TRIP.
   A host session saves parameters and restores them. If the restored
   state is not identical, a reopened project sounds different.
   ============================================================ */
console.log('\n— state round trip —');
(function () {
  var rnd = rng(5150);
  var bad = 0;
  for (var it = 0; it < 200; it++) {
    var st = R.sanitizeState({
      style: R.STYLES[Math.floor(rnd() * 4) % 4],
      inGain: (rnd() - 0.5) * 48, thresh: -rnd() * 60,
      ratio: 1 + rnd() * 900, knee: rnd() * 30,
      attack: 0.02 + rnd() * 400, release: 1 + rnd() * 2400,
      autoRel: rnd() < 0.5, relSync: Math.floor(rnd() * 11), bpm: 20 + rnd() * 280,
      curve: rnd() * 100, hold: rnd() * 500, range: rnd() * 60, look: rnd() * 20,
      detect: R.DETECTS[Math.floor(rnd() * 3) % 3], detOs: rnd() < 0.5,
      scOn: rnd() < 0.5, scHp: 10 + rnd() * 990, scLp: 1000 + rnd() * 19000,
      scListen: rnd() < 0.3, link: rnd() * 100, place: rnd() < 0.4 ? 'ms' : 'lr',
      mix: rnd() * 100, delta: rnd() < 0.3, makeup: (rnd() - 0.5) * 48,
      autoMakeup: rnd() < 0.4, bands: 1 + Math.floor(rnd() * 3),
      xover: [20 + rnd() * 4000, 500 + rnd() * 15000],
      band: [0, 1, 2].map(function () {
        return { threshOff: (rnd() - 0.5) * 48, gain: (rnd() - 0.5) * 48,
                 mute: rnd() < 0.3, solo: rnd() < 0.3 };
      })
    });
    /* the trip a host session actually makes: serialise, store, restore */
    var back = R.loadCase(JSON.parse(JSON.stringify(st)));
    if (JSON.stringify(back) !== JSON.stringify(st)) bad++;
  }
  ok(bad === 0, 'a state survives serialise → store → restore identically (200 random states)');

  /* and the audio must be identical too, not merely the numbers */
  var N = 4096;
  var src = R.makeNoise(2468, N);
  for (var i = 0; i < N; i++) src[i] *= 0.4;
  var st2 = R.sanitizeState({ style: 'settling', bands: 2, thresh: -28, ratio: 6,
                              look: 3, place: 'ms', curve: 40, relSync: 5, bpm: 174 });
  function render(s) {
    var m = R.createMulti(FS);
    m.setState(s);
    var a = new Float64Array(N), b = new Float64Array(N);
    m.process(src, src, a, b);
    return a;
  }
  var one = render(st2), two = render(R.loadCase(JSON.parse(JSON.stringify(st2))));
  var same = true;
  for (i = 0; i < N; i++) if (one[i] !== two[i]) { same = false; break; }
  ok(same, 'and renders BIT-IDENTICALLY after the round trip');
})();

/* ============================================================
   ADVICE MUST BE VERIFIED.

   The suite has this law and RIGOR was the project not obeying it:
   CASKET's four advice functions all render to check themselves,
   while `suggestThreshold` returned a number and trusted it. When
   somebody finally measured it, it was off by a systematic and
   monotone-in-ratio 0.10 to 0.19 dB, and nobody could say why.

   The why: it took the CENTRE of whichever histogram bin held the
   90th percentile. 200 bins over 80 dB is 0.4 dB, so up to 0.2 dB
   of bias went straight into the threshold — and a threshold error
   of e becomes a gain-reduction error of e * (1 - invR), which is
   exactly the "monotone in ratio" shape. One error, four hats.

   Two things make this assertion worth having rather than
   decorative. It checks against a p90 computed by SORTING THE RAW
   SAMPLES, not by the histogram under test, so it cannot pass by
   agreeing with itself. And it runs on three materials, so it
   cannot pass by being tuned to one noise seed.
   ============================================================ */
(function () {
  function material(kind) {
    var N = FS * 3, s = R.makeNoise(20260816, N);
    for (var i = 0; i < N; i++) {
      var g = kind === 'bursty' ? ((i % 1200 < 120) ? 0.9 : 0.35)
            : kind === 'steady' ? 0.5
            : (0.25 + 0.6 * Math.abs(Math.sin(i / FS * 2.1)));
      s[i] *= g;
    }
    return s;
  }
  /* the independent reference: an exact percentile, no bins involved */
  function trueP90(s) {
    var a = [];
    for (var i = 0; i < s.length; i++) {
      var v = Math.abs(s[i]);
      if (v < 1e-6) continue;
      var d = 20 * Math.log10(v);
      if (d >= -80) a.push(d);
    }
    a.sort(function (x, y) { return x - y; });
    return a[Math.floor(a.length * 0.9)];
  }

  var worst = 0, worstWhere = '';
  var byRatio = {};
  ['bursty', 'steady', 'swell'].forEach(function (kind) {
    var src = material(kind), P = trueP90(src);
    [2, 4, 8, 20].forEach(function (r) {
      var T = R.suggestThreshold(src, r, -6);
      var st = R.defaultState();
      st.ratio = r; st.thresh = T; st.knee = 0;
      st.autoMakeup = false; st.makeup = 0;
      /* APPLY the advice and measure, rather than re-deriving it */
      var got = R.transferAt(R.sanitizeState(st), P);
      var err = Math.abs(got - (P - 6));
      if (err > worst) { worst = err; worstWhere = kind + ' at ' + r + ':1'; }
      byRatio[r] = Math.max(byRatio[r] || 0, err);
    });
  });

  /* The bound is DERIVED, not fitted: one bin is 80/200 = 0.4 dB, and
     interpolation should leave well under a tenth of that. Naming 0.19
     here — the old measured error — would be an assertion that passes
     by restating the bug it is supposed to have fixed. */
  var BIN_DB = 80 / 200;
  ok(worst < BIN_DB / 10,
     'suggestThreshold delivers the reduction it promises: worst error ' +
     worst.toFixed(4) + ' dB across three materials and four ratios (worst at ' +
     worstWhere + '), against a bound of one tenth of a histogram bin (' +
     (BIN_DB / 10).toFixed(3) + ' dB). Was 0.10–0.19 dB before the bin ' +
     'interpolation landed.');

  note('per-ratio worst: ' + [2, 4, 8, 20].map(function (r) {
    return r + ':1 ' + byRatio[r].toFixed(4);
  }).join('  ') + ' dB');

  /* The old error grew with ratio because it was a threshold error
     scaled by (1 - invR). If that signature is still present at a
     scale that matters, the fix did not reach the cause. */
  var spread = byRatio[20] - byRatio[2];
  ok(spread < BIN_DB / 20,
     'and the monotone-in-ratio signature is gone: 20:1 exceeds 2:1 by ' +
     spread.toFixed(4) + ' dB, where a surviving threshold bias would show ' +
     'the (1 - invR) fan-out of 0.50 -> 0.95 that produced the original ' +
     'numbers');

  /* LAW 5: the rails. A search or estimator that never evaluates its
     own boundaries cannot return a boundary answer — CASKET paid for
     this one. Here the boundaries are the clamp at each end. */
  var quiet = new Float64Array(FS);
  for (var i = 0; i < quiet.length; i++) quiet[i] = 1e-7;
  ok(R.suggestThreshold(quiet, 4, -6) >= -60,
     'material below the -80 dB floor returns the documented fallback rather ' +
     'than a threshold derived from nothing');
  ok(R.suggestThreshold(material('steady'), 1, -6) === 0,
     'and a 1:1 ratio returns 0 rather than dividing by (1 - 1)');
})();

/* ============================================================
   THE FALLING-CEILING ASYMMETRY, AND WHY RIGOR DOES NOT NEED IT.

   CASKET found that a symmetrically smoothed threshold cannot
   track a ceiling automated downward: for a dozen control blocks
   the gain computer still worked to the OLD, higher lid and the
   output exceeded the new one by 2.37 dB. Its fix was to tighten
   instantly and loosen smoothly. The interchange log passed the
   question to RIGOR, which smooths `thresh` the same way.

   The answer is no, and the reason is structural rather than
   lucky, which is why it is worth pinning rather than just
   noting. The law the log itself states is: a smoothed parameter
   that BOUNDS something needs the asymmetry, one that merely
   COLOURS something does not.

     · `thresh` — smoothed, and bounds NOTHING. A compressor's
       threshold is where reduction begins, not a ceiling it
       promises. Glide it and you get slightly less compression
       for a few milliseconds. Nothing is exceeded, because
       nothing was guaranteed. CASKET is the only program in the
       suite that makes a guarantee, which is exactly why the
       interchange order is EQ -> compressor -> limiter and why
       the limiter must be last.

     · `range` — DOES bound something (the maximum reduction) and
       is therefore the one that would matter. It is not smoothed
       at all: `rangeDb = st.range`, straight through, so it is
       immune to the defect by construction rather than by care.

   There IS a residual overshoot when `range` is automated
   downward, and it is not this bug. It scales with the RELEASE
   time (0.52 dB at 1 ms, 7.46 dB at 800 ms), because the gain
   computer clamps instantly while the envelope has to release up
   to the new clamp. An envelope that lags is what an envelope is.
   Snapping it would replace a controlled release with a click,
   which is strictly worse and not what anybody asked for.
   ============================================================ */
(function () {
  var N = 16384, sig = new Float64Array(N);
  for (var i = 0; i < N; i++) sig[i] = Math.sin(2 * Math.PI * 1000 * i / FS) * 0.5;

  function automate(field, from, to, release) {
    var st = R.defaultState();
    st.ratio = 8; st.knee = 0; st.attack = 0.02; st.release = release;
    st.autoRel = false; st.autoMakeup = false; st.makeup = 0;
    st.range = 60; st[field] = from;
    var e = R.createEngine(FS); e.setState(st);
    var B = 64, tr = [];
    for (var b = 0; b * B < N; b++) {
      if (b === 20) { st[field] = to; e.setState(st); }
      var iL = sig.subarray(b * B, (b + 1) * B);
      var oL = new Float64Array(B), oR = new Float64Array(B);
      e.process(iL, iL, oL, oR);
      tr.push(e.meters().gr);
    }
    return tr;
  }
  function worstPast(tr, limit) {
    var w = 0;
    for (var i = 21; i < tr.length; i++) { var o = -tr[i] - limit; if (o > w) w = o; }
    return w;
  }

  /* 1. `range` is not smoothed. Derived, not named: if it were
     smoothed at SMOOTH = 0.25 the first control block after the
     change would deliver only a quarter of the move, so requiring
     more than half proves the parameter path is direct. */
  var quick = automate('range', 60, 3, 1);
  var before = -quick[19], after = -quick[20], moved = (before - after) / (before - 3);
  ok(moved > 0.5,
     '`range` reaches its new value through the control path immediately — ' +
     (moved * 100).toFixed(0) + '% of the move lands in the first block after the ' +
     'change, where SMOOTH = ' + 0.25 + ' would cap it at 25%. It is the one ' +
     'RIGOR parameter that bounds anything, and it is unsmoothed by construction.');

  /* 2. the residual belongs to the RELEASE, and the proof is that it
     scales with it. A bug in the parameter path would not. */
  var byRelease = [1, 10, 50, 200, 800].map(function (rel) {
    return { rel: rel, over: worstPast(automate('range', 60, 3, rel), 3) };
  });
  var monotone = true;
  for (var j = 1; j < byRelease.length; j++)
    if (byRelease[j].over <= byRelease[j - 1].over) monotone = false;
  ok(monotone,
     'and the overshoot left over when `range` is automated down belongs to the ' +
     'release envelope, not the parameter path — it grows monotonically with ' +
     'release (' + byRelease.map(function (x) {
       return x.rel + ' ms: ' + x.over.toFixed(2);
     }).join(', ') + ' dB). Snapping it would trade a controlled release for a click.');

  /* 3. `thresh` is deliberately SYMMETRIC. If somebody later gives it
     CASKET's asymmetry this fails, and they will have to justify
     bounding something a compressor does not bound.

     MEASURED ON THE PARAMETER, NOT ON THE GAIN. The first version of
     this compared gain-reduction settling times and read 10 blocks
     down against 205 up — which looks exactly like an asymmetry and
     is nothing of the kind. Lowering the threshold means MORE
     reduction, which the gain envelope reaches at the ATTACK rate
     (0.02 ms here); raising it means LESS, which it reaches at the
     RELEASE rate (50 ms). Attack and release are supposed to differ.
     The envelope was doing its job and my assertion was reading it as
     a defect in a parameter three layers away. Reading `Tdb` off the
     probe puts the question where it belongs. */
  function glide(from, to) {
    var st = R.defaultState();
    st.ratio = 8; st.knee = 0; st.attack = 0.02; st.release = 50;
    st.autoRel = false; st.autoMakeup = false; st.makeup = 0; st.thresh = from;
    var e = R.createEngine(FS); e.setState(st);
    var B = 64, oL = new Float64Array(B), oR = new Float64Array(B);
    var iL = sig.subarray(0, B);
    e.process(iL, iL, oL, oR);
    st.thresh = to; e.setState(st);
    for (var b = 0; b < 400; b++) {
      e.process(iL, iL, oL, oR);
      if (Math.abs(e._debug().Tdb - to) < 1e-6) return b + 1;
    }
    return -1;
  }
  var down = glide(-6, -30), up = glide(-30, -6);
  ok(down > 0 && up > 0 && down === up,
     '`thresh` glides SYMMETRICALLY on purpose — the smoothed threshold itself ' +
     'takes ' + down + ' blocks down and ' + up + ' up. It bounds nothing, so it ' +
     'needs no tighten-fast/loosen-slow asymmetry: a compressor threshold is where ' +
     'reduction begins, not a ceiling it promises. CASKET is the only program in ' +
     'the suite that guarantees one, which is why it is the only one that needed ' +
     'the fix.');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
