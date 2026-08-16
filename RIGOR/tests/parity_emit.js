/* RIGOR parity emitter — writes tests/parity_expected.h
   Truth values from the JS core as C++ double literals via toExponential(17).
   The case lists here are mirrored EXACTLY in core_parity.cpp.
   Run: node tests/parity_emit.js */
'use strict';
var fs = require('fs');
var path = require('path');
var R = require('../rigor_core.js');
var ND = require('../../shared/necrodyn.js');

var FS = 48000, N = 4800, STRIDE = 7;

function lit(x) {
  if (!isFinite(x)) throw new Error('non-finite value in parity data');
  return x.toExponential(17);
}
function arr(name, v) {
  var s = 'static const double ' + name + '[' + v.length + '] = {\n';
  for (var i = 0; i < v.length; i += 4)
    s += '  ' + v.slice(i, i + 4).map(lit).join(', ') + (i + 4 < v.length ? ',' : '') + '\n';
  return s + '};\n';
}

/* ---- 1. gain computer (ND, shared) ---- */
var GC_T = [-60, -45, -26, -12, 0];
var GC_W = [0, 1, 6, 12, 30];
var GC_R = [1, 2, 4, 8, 20, 1000];
var gc = [];
GC_T.forEach(function (t) {
  GC_W.forEach(function (w) {
    GC_R.forEach(function (r) {
      for (var x = -90; x <= 6; x += 6) gc.push(ND.kneeGain(x, t, w, R.invRatio(r)));
    });
  });
});

/* ---- 2. one-pole time constants ---- */
var TC_MS = [0.02, 0.1, 0.5, 1, 5, 10, 15, 50, 100, 500, 1200, 2500, 20000];
var tcv = TC_MS.map(function (m) { return ND.onePole(m, FS); });

/* ---- 3. sidechain sections ---- */
var SC_F = [10, 40, 100, 220, 1000, 4000, 12000, 20000];
var scc = [];
SC_F.forEach(function (f) {
  var h = ND.secSosHP(f, Math.SQRT1_2, FS), l = ND.secSosLP(f, Math.SQRT1_2, FS);
  scc.push(h.b0, h.b1, h.b2, h.a1, h.a2, l.b0, l.b1, l.b2, l.a1, l.a2);
});

/* ---- 4. K-weighting across five rates + true-peak taps + lkfs ---- */
var KW_FS = [44100, 48000, 88200, 96000, 192000];
var kw = [];
KW_FS.forEach(function (f) {
  var h = R.kweightHigh(f), l = R.kweightLow(f);
  kw.push(h.b0, h.b1, h.b2, h.a1, h.a2, l.b0, l.b1, l.b2, l.a1, l.a2);
});
var tpt = [];
R.tpTaps().forEach(function (row) { row.forEach(function (v) { tpt.push(v); }); });
var lk = [];
[[0, 0], [1e-6, 1e-6], [0.005, 0.005], [0.01, 0.02], [1, 1]].forEach(function (p) {
  lk.push(R.lkfs(p[0], p[1]));
});

/* ---- 5. transfer + makeup ---- */
/* mirrored field-for-field in core_parity.cpp */
var TSTATES = [
  { style: 'fresh',    thresh: -20, ratio: 4,    knee: 6,  range: 60, mix: 100, makeup: 0, inGain: 0,  autoMakeup: false },
  { style: 'settling', thresh: -34, ratio: 6,    knee: 4,  range: 60, mix: 100, makeup: 3, inGain: 2,  autoMakeup: false },
  { style: 'spasm',    thresh: -28, ratio: 8,    knee: 0,  range: 12, mix: 50,  makeup: 0, inGain: 0,  autoMakeup: true },
  { style: 'repose',   thresh: -38, ratio: 2,    knee: 10, range: 60, mix: 75,  makeup: 0, inGain: -3, autoMakeup: true },
  { style: 'fresh',    thresh: -50, ratio: 1000, knee: 0,  range: 24, mix: 100, makeup: 0, inGain: 0,  autoMakeup: false },
  { style: 'fresh',    thresh: -20, ratio: 1,    knee: 6,  range: 60, mix: 100, makeup: 0, inGain: 0,  autoMakeup: false }
];
function baseState(o) {
  var s = R.defaultState();
  for (var k in o) s[k] = o[k];
  return R.sanitizeState(s);
}
var tf = [], amk = [];
TSTATES.forEach(function (o) {
  var s = baseState(o);
  for (var x = -96; x <= 6; x += 3) tf.push(R.transferAt(s, x));
  amk.push(R.autoMakeupDb(s));
});

/* ---- 6. auto threshold ---- */
var srcL = R.makeNoise(424242, N);
var srcR = R.makeNoise(133742, N);
for (var i = 0; i < N; i++) {
  var g = (i % 1200 < 120) ? 0.9 : 0.06;
  srcL[i] *= g; srcR[i] *= g;
}
var AT_R = [1, 2, 4, 8, 20, 1000];
var AT_G = [-3, -6, -12];
var at = [];
AT_R.forEach(function (r) { AT_G.forEach(function (g2) { at.push(R.suggestThreshold(srcL, r, g2)); }); });

/* ---- 7. the splitter ---- */
/* the last two press the ceiling — the case the fuzzer found */
var SPL = [[1, 200, 2000], [2, 300, 2000], [3, 180, 2400], [3, 19000, 19500], [2, 20000, 20000]];
var spl = [];
SPL.forEach(function (c) {
  var sp = R.createSplitter(FS);
  sp.set(c[0], c[1], c[2]);
  var out = new Float64Array(6);
  for (var k = 0; k < 600; k++) {
    sp.split(srcL[k], srcR[k], out);
    if (k % 7 === 0) for (var b = 0; b < c[0] * 2; b++) spl.push(out[b]);
  }
});

/* ---- 8. rendered audio ---- */
/* mirrored field-for-field in core_parity.cpp */
var RSTATES = [
  { style: 'fresh',    thresh: -30, ratio: 4,  knee: 6,  attack: 10,  release: 120 },
  { style: 'settling', thresh: -34, ratio: 6,  knee: 4,  attack: 20,  release: 300, makeup: 3 },
  { style: 'spasm',    thresh: -28, ratio: 8,  knee: 0,  attack: 0.5, release: 40,  makeup: 4 },
  { style: 'repose',   thresh: -38, ratio: 2,  knee: 10, attack: 30,  release: 400, makeup: 2 },
  { style: 'fresh',    thresh: -32, ratio: 10, knee: 3,  attack: 1,   release: 90, look: 5, mix: 45, hold: 20 },
  { style: 'fresh',    thresh: -36, ratio: 6,  knee: 6,  attack: 8,   release: 100, scOn: true, scHp: 220, scLp: 6000, link: 50 },
  { style: 'fresh',    thresh: -30, ratio: 6,  knee: 6,  attack: 5,   release: 100, delta: true },
  { style: 'fresh',    thresh: -30, ratio: 6,  knee: 6,  attack: 5,   release: 100, place: 'ms', link: 25 },
  { style: 'fresh',    thresh: -28, ratio: 8,  knee: 2,  attack: 3,   release: 200, curve: 80, autoRel: false },
  { style: 'settling', thresh: -38, ratio: 10, knee: 8,  attack: 15,  release: 250, place: 'ms', delta: true, curve: 50, look: 2 }
];
var rend = [], mets = [];
RSTATES.forEach(function (o) {
  var s = baseState(o);
  var e = R.createEngine(FS);
  e.setState(s);
  var oL = new Float64Array(N), oR = new Float64Array(N);
  e.process(srcL, srcR, oL, oR);
  for (var k = 0; k < N; k += STRIDE) rend.push(oL[k], oR[k]);
  var m = e.meters();
  mets.push(m.gr, m.grPeak, m.tpL, m.tpR, m.lufsM, m.lufsS, m.lufsI, m.corr);
});

/* ---- 9. multiband ---- */
var MSTATES = [
  { style: 'fresh',  thresh: -30, ratio: 6, knee: 6, bands: 2, xover: [300, 2000] },
  { style: 'repose', thresh: -34, ratio: 4, knee: 8, bands: 3, xover: [180, 2400],
    band: [{ threshOff: -4, gain: 2 }, {}, { threshOff: 3, gain: -1 }] },
  { style: 'spasm',  thresh: -26, ratio: 8, knee: 0, bands: 3, xover: [200, 3000],
    band: [{}, { solo: true }, {}] }
];
var mrend = [], mmets = [];
MSTATES.forEach(function (o) {
  var s = baseState(o);
  var e = R.createMulti(FS);
  e.setState(s);
  var oL = new Float64Array(N), oR = new Float64Array(N);
  e.process(srcL, srcR, oL, oR);
  for (var k = 0; k < N; k += STRIDE) mrend.push(oL[k], oR[k]);
  var m = e.meters();
  mmets.push(m.gr, m.tpL, m.tpR, m.lufsI, m.corr,
             m.bandGr[0], m.bandGr[1], m.bandGr[2]);
});

/* ---- 9b. v0.4: tempo sync, per-band makeup, oversampled detection ---- */
var SYNC_BPM = [60, 90, 120, 174];
var rel = [];
SYNC_BPM.forEach(function (bpm) {
  for (var d = 0; d < R.SYNC_DIV.length; d++) {
    var st2 = R.sanitizeState({ release: 200, relSync: d, bpm: bpm });
    rel.push(R.releaseMs(st2));
  }
});
var bmk = [];
[[-30, 4, 0], [-24, 8, 6], [-40, 2, 12]].forEach(function (c) {
  var st2 = R.sanitizeState({ thresh: c[0], ratio: c[1], knee: c[2],
    band: [{ threshOff: -6 }, { threshOff: 0 }, { threshOff: 6 }] });
  for (var k = 0; k < 3; k++) bmk.push(R.bandMakeupDb(st2, k));
});
var OSTATES = [
  { style: 'fresh', thresh: -12, ratio: 8, knee: 0, attack: 1, release: 100, detOs: true, detect: 'peak' },
  { style: 'spasm', thresh: -20, ratio: 6, knee: 2, attack: 2, release: 150, detOs: true, relSync: 5, bpm: 174 },
  /* round 8: every legal detector phase count, because each is a DIFFERENT
     filter bank and the twin builds its own rather than receiving one.
     detOsX: 4 duplicates the first entry's geometry on purpose — if the
     default ever stops meaning 4, these two rows stop agreeing. */
  { style: 'fresh', thresh: -12, ratio: 8, knee: 0, attack: 1, release: 100, detOs: true, detect: 'peak', detOsX: 2 },
  { style: 'fresh', thresh: -12, ratio: 8, knee: 0, attack: 1, release: 100, detOs: true, detect: 'peak', detOsX: 4 },
  { style: 'fresh', thresh: -12, ratio: 8, knee: 0, attack: 1, release: 100, detOs: true, detect: 'peak', detOsX: 8 },
  { style: 'settling', thresh: -22, ratio: 5, knee: 4, attack: 8, release: 220, detOs: true, detOsX: 8 },
  /* round 8: the hold taper. Both branches of the envelope need covering —
     `fresh` smooths the GAIN, `settling` smooths the LEVEL, and the taper
     is patched into all four hold sites. holdTaper: 0 alongside a nonzero
     hold is the case that proves the skip, not merely the maths. */
  { style: 'fresh',    thresh: -26, ratio: 8, knee: 0, attack: 1, release: 300, hold: 40, holdTaper: 0 },
  { style: 'fresh',    thresh: -26, ratio: 8, knee: 0, attack: 1, release: 300, hold: 40, holdTaper: 55 },
  { style: 'fresh',    thresh: -26, ratio: 8, knee: 0, attack: 1, release: 300, hold: 40, holdTaper: 100, autoRel: true },
  { style: 'settling', thresh: -30, ratio: 4, knee: 6, attack: 12, release: 260, hold: 25, holdTaper: 80 }
];
var orend = [];
OSTATES.forEach(function (o) {
  var st2 = baseState(o);
  var e = R.createEngine(FS);
  e.setState(st2);
  var oL = new Float64Array(N), oR = new Float64Array(N);
  e.process(srcL, srcR, oL, oR);
  for (var k = 0; k < N; k += STRIDE) orend.push(oL[k], oR[k]);
});

/* ---- 9c. the FFT — core DSP with NM twiddles, previously ungated ---- */
var spec = [];
[64, 256, 1024].forEach(function (len) {
  var out = new Float64Array(len / 2);
  R.spectrum(srcL.subarray(0, len), out);
  for (var i = 0; i < out.length; i += 3) spec.push(out[i]);
});
/* raw FFT of a known signal, real and imaginary, so a bit-reversal or
   twiddle-order slip cannot hide behind the magnitude */
var fftRe = new Float64Array(256), fftIm = new Float64Array(256);
for (var i = 0; i < 256; i++) fftRe[i] = srcL[i];
R.fft(fftRe, fftIm);
for (i = 0; i < 256; i += 5) spec.push(fftRe[i], fftIm[i]);

/* ---- 9d. round 9: per-band delta, band sidechain, transient split ---- */
var R9 = [
  { style: 'fresh', thresh: -34, ratio: 6, knee: 6, bands: 3, xover: [200, 3000], delta: true, deltaBand: 2 },
  { style: 'fresh', thresh: -34, ratio: 8, knee: 4, bands: 3, xover: [180, 2400], scBand: 3 },
  { style: 'spasm', thresh: -30, ratio: 6, knee: 2, tsSplit: 100 },
  { style: 'settling', thresh: -32, ratio: 5, knee: 6, tsSplit: 55, bands: 2, xover: [250, 4000], scBand: 1 }
];
var r9 = [];
R9.forEach(function (o) {
  var s = baseState(o);
  var e2 = (s.bands > 1 ? R.createMulti : R.createEngine)(FS);
  e2.setState(s);
  var oL = new Float64Array(N), oR = new Float64Array(N);
  e2.process(srcL, srcR, oL, oR);
  for (var k = 0; k < N; k += STRIDE) r9.push(oL[k], oR[k]);
});

/* ---- 9e. AUDIT: the paths that had no parity coverage at all ----
   The coverage audit found three: bypass, scListen, and — the one that
   mattered — hostile input samples. A non-finite sample used to lock the
   audio thread, and the guard that now prevents it is arithmetic the twin
   must reproduce exactly like any other. */
var poisonL = new Float64Array(N), poisonR = new Float64Array(N);
for (var pi = 0; pi < N; pi++) { poisonL[pi] = srcL[pi]; poisonR[pi] = srcR[pi]; }
/* spread across the buffer AND across a control boundary (CTRL is 32) */
poisonL[7] = Infinity;  poisonR[7] = -Infinity;
poisonL[32] = NaN;      poisonR[33] = Infinity;
poisonL[N - 1] = -Infinity;

var AUD = [
  { style: 'fresh', thresh: -30, ratio: 8, poison: true },
  { style: 'settling', thresh: -30, ratio: 8, poison: true },
  { style: 'fresh', thresh: -30, ratio: 8, bands: 3, xover: [200, 3000], poison: true },
  { style: 'fresh', thresh: -30, ratio: 8, bypass: true },
  { style: 'fresh', thresh: -30, ratio: 8, scOn: true, scListen: true },
  { style: 'repose', thresh: -26, ratio: 4, bands: 2, xover: [300, 3000], scOn: true, scListen: true },
  /* BYPASS, now that it runs through the delay line and has a switch.
     A bypassed path used to be arithmetically trivial; it now involves a
     delay line in the engine and a second one in the wrapper, and the
     wrapper's dry tap sits between the input guard and the splitter. All
     three are places the twin can diverge, so all three are gated.
     Both settings of bypassSplit at both band counts, with lookahead on,
     because at look = 0 the delay lines are pass-throughs and would hide
     an indexing error. */
  { style: 'fresh', thresh: -30, ratio: 8, look: 7, bypass: true },
  { style: 'settling', thresh: -30, ratio: 8, look: 3.5, bypass: true },
  { style: 'fresh', thresh: -30, ratio: 8, look: 7, bands: 2, xover: [300, 3000],
    bypass: true, bypassSplit: false },
  { style: 'fresh', thresh: -30, ratio: 8, look: 7, bands: 2, xover: [300, 3000],
    bypass: true, bypassSplit: true },
  { style: 'repose', thresh: -26, ratio: 4, look: 11, bands: 3, xover: [200, 3000],
    bypass: true, bypassSplit: false },
  { style: 'repose', thresh: -26, ratio: 4, look: 11, bands: 3, xover: [200, 3000],
    bypass: true, bypassSplit: true },
  /* and bypassSplit set while NOT bypassed, which must change nothing —
     a parity case that pins the inertness rather than trusting it */
  { style: 'fresh', thresh: -30, ratio: 8, look: 7, bands: 3, xover: [200, 3000],
    bypassSplit: true },
  /* poisoned input THROUGH the dry path: the wrapper's dry tap reads the
     guarded sample, so the guard and the tap must agree in both languages */
  { style: 'fresh', thresh: -30, ratio: 8, look: 5, bands: 3, xover: [200, 3000],
    bypass: true, poison: true }
];
var aud = [];
AUD.forEach(function (o) {
  var s = baseState(o);
  var e3 = (s.bands > 1 ? R.createMulti : R.createEngine)(FS);
  e3.setState(s);
  var oL = new Float64Array(N), oR = new Float64Array(N);
  e3.process(o.poison ? poisonL : srcL, o.poison ? poisonR : srcR, oL, oR);
  for (var k = 0; k < N; k += STRIDE) aud.push(oL[k], oR[k]);
});

/* ---- 10. the sources must agree first ---- */
var srcChk = [];
for (i = 0; i < N; i += 97) srcChk.push(srcL[i], srcR[i]);

var total = gc.length + tcv.length + scc.length + kw.length + tpt.length +
            lk.length + tf.length + amk.length + at.length + spl.length +
            rend.length + mets.length + mrend.length + mmets.length + srcChk.length +
            rel.length + bmk.length + orend.length + spec.length + r9.length + aud.length;

var out =
  '/* GENERATED by tests/parity_emit.js — do not edit.\n' +
  '   Truth values from rigor_core.js. ' + total + ' doubles. */\n' +
  '#pragma once\n\n' +
  '#define EXP_FS ' + FS + '\n#define EXP_N ' + N + '\n#define EXP_STRIDE ' + STRIDE + '\n\n' +
  arr('EXP_GC', gc) + '\n' + arr('EXP_TC', tcv) + '\n' + arr('EXP_SCC', scc) + '\n' +
  arr('EXP_KW', kw) + '\n' + arr('EXP_TPT', tpt) + '\n' + arr('EXP_LK', lk) + '\n' +
  arr('EXP_TF', tf) + '\n' + arr('EXP_AMK', amk) + '\n' + arr('EXP_AT', at) + '\n' +
  arr('EXP_SPL', spl) + '\n' + arr('EXP_SRC', srcChk) + '\n' +
  arr('EXP_REND', rend) + '\n' + arr('EXP_MET', mets) + '\n' +
  arr('EXP_MREND', mrend) + '\n' + arr('EXP_MMET', mmets) + '\n' +
  arr('EXP_REL', rel) + '\n' + arr('EXP_BMK', bmk) + '\n' + arr('EXP_OREND', orend) + '\n' +
  arr('EXP_SPEC', spec) + '\n' + arr('EXP_R9', r9) + '\n' + arr('EXP_AUD', aud) +
  '\nstatic const int EXP_CHECKS = ' + total + ';\n';

fs.writeFileSync(path.join(__dirname, 'parity_expected.h'), out);
console.log('parity_expected.h written: ' + total.toLocaleString() + ' truth values');
[['gain computer', gc], ['time constants', tcv], ['sc sections', scc],
 ['K-weighting', kw], ['true-peak taps', tpt], ['lkfs', lk],
 ['transfer', tf], ['auto makeup', amk], ['auto threshold', at],
 ['splitter', spl], ['sources', srcChk], ['rendered', rend],
 ['meters', mets], ['multiband', mrend], ['multiband meters', mmets],
 ['tempo sync', rel], ['band makeup', bmk], ['oversampled det', orend],
 ['fft + spectrum', spec], ['round 9 DSP', r9], ['audit: poison/bypass/scListen', aud]
].forEach(function (p) {
  console.log('  ' + p[0].padEnd(17) + p[1].length);
});
