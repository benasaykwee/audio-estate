/* PALLBEARER parity emitter — writes tests/parity_expected.h
   Truth values from the JS core as C++ double literals via toExponential(17).
   The case lists here are mirrored EXACTLY in core_parity.cpp.
   Run: node tests/parity_emit.js */
'use strict';
var fs = require('fs');
var path = require('path');
var PB = require('../pallbearer_core.js');

var SR = 48000;

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
function u32arr(name, v) {
  var s = 'static const std::uint32_t ' + name + '[' + v.length + '] = {\n';
  for (var i = 0; i < v.length; i += 6)
    s += '  ' + v.slice(i, i + 6).map(function (x) { return x + 'u'; }).join(', ') + (i + 6 < v.length ? ',' : '') + '\n';
  return s + '};\n';
}

var total = 0;

/* ---- 1. the dice ---- */
var RNG_SEEDS = [1, 2, 12345, 0x9E3779B9, 4294967295, 7, 999999];
var rngv = [];
RNG_SEEDS.forEach(function (sd) {
  var r = new PB.Rng(sd);
  for (var i = 0; i < 64; i++) rngv.push(r.next());
});
total += rngv.length;

var SEED_NOTES = [23, 28, 33, 40, 55, 67];
var SEED_STR = [0, 1, 2, 3, 4];
var SEED_CNT = [1, 2, 17, 1000, 65535];
var seedv = [];
SEED_NOTES.forEach(function (n) {
  SEED_STR.forEach(function (s) {
    SEED_CNT.forEach(function (c) { seedv.push(PB.seedFor(0x5EED1E, n, s, c)); });
  });
});
total += seedv.length;

/* ---- 2. pure helpers ---- */
var MIDI_N = [];
for (var n = 0; n <= 127; n++) MIDI_N.push(n);
var mtf = MIDI_N.map(PB.midiToFreq);
total += mtf.length;

var LG_F = [20, 30.87, 41.2, 55, 82.4, 98, 196, 400];
var LG_D = [0.5, 1, 2.5, 4.5, 8, 12, 0];
var lgv = [];
LG_F.forEach(function (f) { LG_D.forEach(function (d) { lgv.push(PB.loopGainFor(f, d, SR)); }); });
total += lgv.length;

var DI_F = [20, 41.2, 60, 98, 120, 196, 400];
var DI_I = [0, 0.15, 0.35, 0.6, 1];
var div = [];
DI_F.forEach(function (f) { DI_I.forEach(function (i) { div.push(PB.dispersionFor(f, i)); }); });
total += div.length;

var VB_V = [0, 0.25, 0.5, 0.75, 1];
var VB_A = [0, 0.3, 0.55, 1];
var vbv = [];
VB_V.forEach(function (v) { VB_A.forEach(function (a) { vbv.push(PB.velBrightness(v, a)); }); });
total += vbv.length;

var STYLES = ['finger', 'pick', 'slap', 'thumb', 'muted'];
var HARD = [0, 0.25, 0.45, 0.8, 1];
var ssv = [];
STYLES.forEach(function (s) {
  HARD.forEach(function (h) {
    var sh = PB.styleShape(s, h);
    ssv.push(sh.bright, sh.burst, sh.click, sh.damp, sh.posBias);
  });
});
total += ssv.length;

var ARTICS = ['normal', 'harmonic', 'ghost', 'palm', 'dead'];
var arv = [];
ARTICS.forEach(function (a) {
  var x = PB.articShape(a);
  arv.push(x.mult, x.damp, x.decay, x.amp, x.noise, x.buzz);
});
total += arv.length;

/* ---- 3. allpass ---- */
var AP_FRAC = [0.0001, 0.1, 0.35, 0.5, 0.77, 0.9999];
var apv = [];
AP_FRAC.forEach(function (f) {
  var a = new PB.Allpass1();
  a.setFrac(f);
  apv.push(a.c);
  for (var i = 0; i < 24; i++) apv.push(a.tick(i === 0 ? 1 : (i % 3 === 0 ? -0.5 : 0.25)));
});
var AP_COEF = [-0.999, -0.42, 0, 0.3, 0.999];
AP_COEF.forEach(function (c) {
  var a = new PB.Allpass1();
  a.setCoeff(c);
  for (var i = 0; i < 24; i++) apv.push(a.tick(Math.sin(i * 0.37)));
});
total += apv.length;

/* ---- 3b. pickup coil resonance (v0.3) ---- */
var COIL_F = [1200, 2200, 3100, 4800, 6500];
var COIL_Q = [0.4, 1.35, 3, 6];
var coilv = [];
COIL_F.forEach(function (f) {
  COIL_Q.forEach(function (q) {
    var b = new PB.Biquad();
    b.lowpassRes(f, q, SR);
    coilv.push(b.b0, b.b1, b.b2, b.a1, b.a2);
    for (var i = 0; i < 40; i++) coilv.push(b.tick(i === 0 ? 1 : (i % 5 === 0 ? -0.4 : 0.15)));
  });
});
total += coilv.length;

/* ---- 4. body ---- */
var BODY_F = [40, 62, 92, 160, 260];
var BODY_Q = [0.5, 3.2, 8];
var BODY_W = [0, 0.4, 1];
var bodyv = [];
BODY_F.forEach(function (f) {
  BODY_Q.forEach(function (q) {
    BODY_W.forEach(function (w) {
      var b = new PB.Body(SR);
      b.set(f, q, w);
      bodyv.push(b.air.b0, b.air.b1, b.air.b2, b.air.a1, b.air.a2);
      for (var i = 0; i < 40; i++) bodyv.push(b.tick(i === 0 ? 1 : (i % 7 === 0 ? -0.3 : 0.1)));
    });
  });
});
total += bodyv.length;

/* ---- 5. the fingering brain (integers, but they gate the audio) ---- */
var FB_NOTES = [];
for (var fn = 20; fn <= 72; fn++) FB_NOTES.push(fn);
var FB_HAND = [0, 5, 12, 19];
var FB_VEL = [0, 3, -3];          // hand momentum, v0.3
var fbv = [];
FB_NOTES.forEach(function (nn) {
  FB_HAND.forEach(function (h) {
    FB_VEL.forEach(function (hv) {
      var open = PB.TUNINGS['standard-4'].open;
      var r = PB.chooseString(nn, open, 24, h, [false, false, false, false], hv);
      fbv.push(r ? r.string : -1, r ? r.fret : -1);
      var r2 = PB.chooseString(nn, open, 24, h, [true, false, true, false], hv);
      fbv.push(r2 ? r2.string : -1, r2 ? r2.fret : -1);
    });
  });
});
total += fbv.length;

/* ---- 6. RENDERED AUDIO — the one that actually matters ----
   Everything above is arithmetic in isolation. This runs the whole
   instrument: fingering, excitation, dice, loop filter, dispersion,
   pickups, buzz, body, drive. If this is bit-exact, the port is real. */
var RENDER_CASES = [
  { name: 'default',   patch: {}, notes: [28, 33, 40] },
  { name: 'slap',      patch: { style: 'slap', hardness: 0.9, buzz: 1, humanize: 0.6, drive: 0.3 }, notes: [28, 35, 28] },
  { name: 'ghost',     patch: { artic: 'ghost', noise: 0.8, relNoise: 1 }, notes: [33, 33, 38] },
  { name: 'harmonic',  patch: { artic: 'harmonic', inharm: 0.8, decay: 9 }, notes: [28, 33] },
  { name: 'fivestring',patch: { tuning: 'standard-5', bodyFreq: 62, woodMix: 1, bodyMix: 0.7 }, notes: [23, 28, 31] },
  { name: 'extremes',  patch: { damping: 0.985, inharm: 1, stretch: 1, drive: 1, level: 2,
                                pickupA: 0.45, pickupB: 0.03, pickupInv: 'out', pickupMix: 1,
                                humanize: 1, buzz: 1, relNoise: 1, velBright: 1 }, notes: [23, 43] },
  { name: 'muted',     patch: { style: 'muted', artic: 'palm', glide: 0, decay: 1.2 }, notes: [33, 36, 33] },
  /* v0.3: coupling drives idle strings, so this case exercises prime() and
     the bus. Big interval jumps force real position shifts and shift noise. */
  { name: 'coupled',   patch: { couple: 1, decay: 9, damping: 0.12, fretNoise: 1, humanize: 0.5 },
                       notes: [28, 60, 28, 55] },
  { name: 'dead',      patch: { artic: 'dead', noise: 1, buzz: 1, couple: 0.5 }, notes: [33, 40, 33] },
  { name: 'coilmax',   patch: { coilFreq: 1200, coilQ: 6, drive: 0.6, couple: 0.8 }, notes: [28, 35] }
];
var RENDER_N = 6000, RENDER_STRIDE = 11;
var renderv = [];
RENDER_CASES.forEach(function (c) {
  var core = new PB.PallbearerCore(SR, 0x5EED1E);
  core.setPatch(c.patch);
  var L = new Float64Array(RENDER_N), R = new Float64Array(RENDER_N);
  var blk = 64, tl = new Float64Array(blk), tr = new Float64Array(blk);
  var pos = 0, ni = 0, gap = Math.floor(RENDER_N / (c.notes.length + 1));
  var cur = -1;
  while (pos < RENDER_N) {
    while (ni < c.notes.length && pos >= ni * gap) {
      if (cur >= 0) core.noteOff(cur);
      cur = c.notes[ni]; core.noteOn(cur, 0.85); ni++;
    }
    var m = Math.min(blk, RENDER_N - pos);
    core.render(tl, tr, m);
    L.set(tl.subarray(0, m), pos);
    pos += m;
  }
  for (var i = 0; i < RENDER_N; i += RENDER_STRIDE) renderv.push(L[i]);
});
total += renderv.length;

/* ---- 7. the attack layer (hybrid + sampled) ---- */
/* THE TEST DATA ITSELF BROKE LAW 2 ON THE FIRST RUN.
   The original layer was built with Math.exp/Math.sin here and std::exp/
   std::sin in the gate. Those disagree by 1–2 ulp — which is precisely the
   drift LAW 2 exists to forbid — so 1,108 checks failed while every other
   section, rendered audio included, was already bit-exact. The core was
   fine; the fixture was lying.

   Rebuilt with no transcendental at all: the waveform comes from the
   portable xorshift and the envelope from repeated multiplication by a
   plain double literal. A parity fixture must be at least as portable as
   the thing it is testing. */
var LAYER_DECAY = 0.99946;
function makeLayer(sr, secs, seed) {
  var n = Math.floor(secs * sr), d = new Float64Array(n);
  var r = new PB.Rng(seed);
  var env = 1;
  for (var i = 0; i < n; i++) { d[i] = env * r.bi(); env *= LAYER_DECAY; }
  return d;
}
var LAYER = makeLayer(SR, 0.3, 0xA77AC4);
var layerv = [];
[[1, 1], [0, 1]].forEach(function (gains) {
  var core = new PB.PallbearerCore(SR, 0x5EED1E);
  core.setPatch({ strGain: gains[0], atkGain: gains[1], atkDecay: 0.2, humanize: 0 });
  core.setAttackLayer({ data: LAYER, sr: SR, root: 33 });
  var L = new Float64Array(4000), R = new Float64Array(4000);
  core.noteOn(33, 0.9);
  var blk = 64, tl = new Float64Array(blk), tr = new Float64Array(blk), pos = 0;
  while (pos < 4000) {
    var m = Math.min(blk, 4000 - pos);
    core.render(tl, tr, m);
    L.set(tl.subarray(0, m), pos); pos += m;
  }
  for (var i = 0; i < 4000; i += 7) layerv.push(L[i]);
});
total += layerv.length;

/* ---- write ---- */
var out = '';
out += '/* GENERATED by tests/parity_emit.js — do not edit.\n';
out += '   Truth values from pallbearer_core.js. ' + total + ' doubles + uint32s. */\n';
out += '#pragma once\n#include <cstdint>\n\n';
out += '#define EXP_SR 48000\n';
out += '#define EXP_RENDER_N ' + RENDER_N + '\n';
out += '#define EXP_RENDER_STRIDE ' + RENDER_STRIDE + '\n\n';
out += u32arr('EXP_RNG', rngv);
out += u32arr('EXP_SEEDFOR', seedv);
out += arr('EXP_MTF', mtf);
out += arr('EXP_LOOPGAIN', lgv);
out += arr('EXP_DISP', div);
out += arr('EXP_VELBRIGHT', vbv);
out += arr('EXP_STYLE', ssv);
out += arr('EXP_ARTIC', arv);
out += arr('EXP_ALLPASS', apv);
out += arr('EXP_COIL', coilv);
out += arr('EXP_BODY', bodyv);
out += arr('EXP_FINGER', fbv);
out += arr('EXP_RENDER', renderv);
out += arr('EXP_LAYER', layerv);

fs.writeFileSync(path.join(__dirname, 'parity_expected.h'), out);
console.log('✓ wrote tests/parity_expected.h — ' + total + ' values');
console.log('  rng ' + rngv.length + ' · seedFor ' + seedv.length + ' · midiToFreq ' + mtf.length +
            ' · loopGain ' + lgv.length + ' · dispersion ' + div.length);
console.log('  velBright ' + vbv.length + ' · style ' + ssv.length + ' · artic ' + arv.length +
            ' · allpass ' + apv.length + ' · body ' + bodyv.length);
console.log('  fingering ' + fbv.length + ' · RENDERED AUDIO ' + renderv.length + ' · layer ' + layerv.length);
