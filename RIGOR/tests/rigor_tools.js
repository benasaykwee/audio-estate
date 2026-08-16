/* RIGOR offline tools — things you run ON a case file rather than tests
   that run against the code.

     node tests/rigor_tools.js null   <a.json> <b.json>   how different are two cases?
     node tests/rigor_tools.js ratio  <audio.json|->      suggest a ratio from material
     node tests/rigor_tools.js render <case.json> <in> <out>
     node tests/rigor_tools.js demo                       run all three on generated material

   These live here rather than in the instrument because they answer
   questions you ask ABOUT a setting, not questions you ask while using it. */
'use strict';
var fs = require('fs');
var path = require('path');
var R = require('../rigor_core.js');

var FS = 48000;

/* ============================================================
   NULL TEST — how different are two case files, really?
   Renders both against the same material and reports the difference as a
   number. "Are these the same?" stops being an argument.
   ============================================================ */
function nullTest(stA, stB, src, fs2) {
  fs2 = fs2 || FS;
  var n = src.length;
  function render(st) {
    var e = (st.bands > 1 ? R.createMulti : R.createEngine)(fs2);
    e.setState(st);
    var a = new Float64Array(n), b = new Float64Array(n);
    e.process(src, src, a, b);
    return a;
  }
  var A = render(stA), B = render(stB);
  var peak = 0, sumSq = 0, sumA = 0, bitSame = true;
  for (var i = 0; i < n; i++) {
    if (A[i] !== B[i]) bitSame = false;
    var d = A[i] - B[i];
    var ad = d < 0 ? -d : d;
    if (ad > peak) peak = ad;
    sumSq += d * d;
    sumA += A[i] * A[i];
  }
  var rms = Math.sqrt(sumSq / n);
  var ref = Math.sqrt(sumA / n);
  return {
    bitIdentical: bitSame,
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    rmsDb: rms > 0 ? 20 * Math.log10(rms) : -Infinity,
    relDb: (rms > 0 && ref > 0) ? 20 * Math.log10(rms / ref) : -Infinity
  };
}

/* ============================================================
   AUTO RATIO — the same level histogram that suggests a threshold can
   suggest a ratio. Wide dynamic range wants a gentle ratio; a already-
   squashed source wants either a high ratio or to be left alone.
   Deterministic and pure, like every other suggestion in this codebase.
   ============================================================ */
function suggestRatio(samples, targetGr, fs2) {
  fs2 = fs2 || FS;
  var n = samples.length;
  if (!n) return 4;

  /* MEASURE THE ENVELOPE, NOT THE SAMPLES.
     The first version histogrammed |x| directly, which sounds reasonable
     and measures the wrong thing: for uniform noise the median-to-90th
     span of |x| is only about 5 dB no matter how dynamic the music is,
     because that span describes the WAVEFORM's amplitude distribution
     rather than the performance's. Asking for 6 dB of reduction across an
     apparent 5 dB span then demanded an infinite ratio on ordinary
     material. A 20 ms RMS envelope is what "dynamic range" means to a
     listener, and it is what a compressor actually rides. */
  var win = Math.max(1, Math.round(fs2 * 0.02));
  var env = [], acc = 0, cnt = 0, i;
  for (i = 0; i < n; i++) {
    acc += samples[i] * samples[i];
    if (++cnt === win) {
      var rms = Math.sqrt(acc / win);
      if (rms > 1e-6) env.push(20 * Math.log10(rms));
      acc = 0; cnt = 0;
    }
  }
  if (env.length < 8) return 4;
  env.sort(function (x, y) { return x - y; });
  function pct(p) { return env[Math.min(env.length - 1, Math.floor(env.length * p))]; }

  /* the span the compressor would work across: the loud passages against
     the body of the material, ignoring the very top so one stray transient
     does not set the answer */
  var span = pct(0.95) - pct(0.5);
  var g = targetGr < 0 ? -targetGr : targetGr;
  if (g <= 0) g = 6;

  /* to remove g dB from a span of `span` dB the ratio must satisfy
     g = span * (1 - 1/R)  =>  R = 1 / (1 - g/span) */
  if (span <= g * 1.05) return R.RATIO_INF;   /* the ask exceeds the span */
  var ratio = 1 / (1 - g / span);
  return Math.round(Math.min(Math.max(ratio, 1), 60) * 10) / 10;
}

/* the measured envelope span, exposed because it is the number that
   explains the ratio the tool suggests */
function dynamicRangeDb(samples, fs2) {
  fs2 = fs2 || FS;
  var win = Math.max(1, Math.round(fs2 * 0.02));
  var env = [], acc = 0, cnt = 0;
  for (var i = 0; i < samples.length; i++) {
    acc += samples[i] * samples[i];
    if (++cnt === win) {
      var rms = Math.sqrt(acc / win);
      if (rms > 1e-6) env.push(20 * Math.log10(rms));
      acc = 0; cnt = 0;
    }
  }
  if (env.length < 8) return 0;
  env.sort(function (a2, b2) { return a2 - b2; });
  return env[Math.floor(env.length * 0.95)] - env[Math.floor(env.length * 0.5)];
}

/* ============================================================
   OFFLINE RENDER — a case file applied to a buffer with no realtime
   constraint. Exists so a setting can be auditioned on a whole file, and
   so the null test above has something to render with.
   ============================================================ */
function renderOffline(st, src, fs2) {
  fs2 = fs2 || FS;
  var n = src.length;
  var e = (st.bands > 1 ? R.createMulti : R.createEngine)(fs2);
  e.setState(st);
  var a = new Float64Array(n), b = new Float64Array(n);
  e.process(src, src, a, b);
  return { L: a, R: b, meters: e.meters(), latency: e.latency() };
}

module.exports = { nullTest: nullTest, suggestRatio: suggestRatio,
                   dynamicRangeDb: dynamicRangeDb, renderOffline: renderOffline };

/* ============================================================
   CLI
   ============================================================ */
if (require.main === module) {
  var cmd = process.argv[2] || 'demo';
  function load(p) { return R.loadCase(JSON.parse(fs.readFileSync(p, 'utf8'))); }
  function material() {
    var n = FS, a = R.makeNoise(424242, n);
    for (var i = 0; i < n; i++) {
      var env = (i % 12000 < 1200) ? 0.9 : 0.06;
      a[i] *= env;
    }
    return a;
  }
  function styled(name, patch) {
    var s = R.defaultState(), d = R.styleDefaults(name);
    for (var k in d) s[k] = d[k];
    s.style = name;
    if (patch) for (var k2 in patch) s[k2] = patch[k2];
    return R.sanitizeState(s);
  }

  if (cmd === 'null' && process.argv[4]) {
    var r = nullTest(load(process.argv[3]), load(process.argv[4]), material());
    console.log(r.bitIdentical ? 'BIT-IDENTICAL — these two cases are the same setting.'
      : 'difference:  peak ' + r.peakDb.toFixed(2) + ' dBFS   rms ' +
        r.rmsDb.toFixed(2) + ' dBFS   (' + r.relDb.toFixed(2) + ' dB relative to A)');

  } else if (cmd === 'ratio') {
    console.log('suggested ratio: ' + suggestRatio(material(), -6) + ':1 for 6 dB of reduction');

  } else if (cmd === 'demo') {
    console.log('RIGOR offline tools — demonstration on generated material\n');
    var src = material();

    console.log('— null test —');
    var same = nullTest(styled('fresh'), styled('fresh'), src);
    console.log('  fresh vs fresh:        ' + (same.bitIdentical ? 'BIT-IDENTICAL' : 'DIFFERENT (wrong!)'));
    var vs = nullTest(styled('fresh'), styled('settling'), src);
    console.log('  fresh vs settling:     peak ' + vs.peakDb.toFixed(2) +
                ' dBFS, rms ' + vs.rmsDb.toFixed(2) + ' dBFS (' + vs.relDb.toFixed(1) + ' dB rel.)');
    var near = nullTest(styled('fresh', { thresh: -30 }), styled('fresh', { thresh: -30.1 }), src);
    console.log('  0.1 dB of threshold:   rms ' + near.rmsDb.toFixed(2) +
                ' dBFS (' + near.relDb.toFixed(1) + ' dB rel.) — audible? probably not, and now you know');

    console.log('\n— auto ratio —');
    console.log('  measured dynamic range (20 ms envelope, p50 to p95): ' +
                dynamicRangeDb(src).toFixed(1) + ' dB');
    [-3, -6, -12].forEach(function (g) {
      var r2 = suggestRatio(src, g);
      console.log('  for ' + g + ' dB of reduction: ' +
                  (r2 >= R.RATIO_INF ? 'infinity:1 — the ask exceeds the span' : r2 + ':1'));
    });
    console.log('  and a threshold to go with it: ' +
                R.suggestThreshold(src, suggestRatio(src, -6), -6).toFixed(1) + ' dB');

    console.log('\n— offline render —');
    var out = renderOffline(styled('repose', { bands: 3, autoMakeup: true }), src);
    console.log('  3-band repose over 1 s: GR ' + out.meters.gr.toFixed(2) +
                ' dB, latency ' + out.latency + ' samples');
    console.log('  true peak ' + (20 * Math.log10(out.meters.tpL)).toFixed(2) +
                ' dBTP, integrated ' + out.meters.lufsI.toFixed(1) + ' LUFS');

  } else {
    console.log('usage: node tests/rigor_tools.js [demo|null a.json b.json|ratio]');
  }
}
