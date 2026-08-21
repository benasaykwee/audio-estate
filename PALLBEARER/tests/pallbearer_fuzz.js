/* PALLBEARER fuzz — hostile input, deliberately.
   node tests/pallbearer_fuzz.js [iterations]

   LAW 5 says a legal value that is also a boundary value is where these
   break. This sweeps the boundaries on purpose, then throws genuine
   garbage at every entry point and demands the same three things every
   time: no NaN, no runaway, no throw.

   The generator is seeded, so a failure is reproducible from its index. */
'use strict';
var PB = require('../pallbearer_core.js');

var ITER = parseInt(process.argv[2], 10) || 2500;
var SR = 48000;
var fails = 0, checks = 0;
function bad(msg) { fails++; if (fails <= 15) console.log('  ✗ ' + msg); }

/* Values chosen to be nasty rather than random: every parameter boundary,
   plus the classic poisons. */
var POISON = [0, -0, 1, -1, NaN, Infinity, -Infinity, 1e308, -1e308, 1e-308,
              0.1 + 0.2, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER,
              '', '0', 'abc', null, undefined, true, false, [], {}, [1, 2]];

function rnd(r) { return r.uni(); }

console.log('PALLBEARER fuzz — ' + ITER + ' iterations\n');

/* ---- 1. sanitize must never emit a non-finite or out-of-range value ---- */
(function () {
  var r = new PB.Rng(0xF0F0);
  for (var it = 0; it < ITER; it++) {
    var patch = {};
    PB.PARAMS.forEach(function (p) {
      var pick = Math.floor(rnd(r) * (POISON.length + 3));
      if (pick < POISON.length) patch[p.id] = POISON[pick];
      else if (p.type === 'enum') patch[p.id] = rnd(r) < 0.5 ? p.options[Math.floor(rnd(r) * p.options.length)] : 'nonsense';
      else patch[p.id] = (rnd(r) * 2 - 0.5) * (p.max - p.min) + p.min;
    });
    var clean = PB.sanitize(patch);
    PB.PARAMS.forEach(function (p) {
      checks++;
      var v = clean[p.id];
      if (p.type === 'enum') {
        if (p.options.indexOf(v) < 0) bad('sanitize let a bad enum through: ' + p.id + ' = ' + v + ' (iter ' + it + ')');
      } else {
        if (!isFinite(v)) bad('sanitize emitted non-finite ' + p.id + ' = ' + v + ' (iter ' + it + ')');
        else if (v < p.min - 1e-12 || v > p.max + 1e-12) bad('sanitize emitted out-of-range ' + p.id + ' = ' + v + ' (iter ' + it + ')');
      }
    });
  }
})();

/* ---- 2. random patches must render clean audio ---- */
(function () {
  var r = new PB.Rng(0xABCD);
  var tunings = Object.keys(PB.TUNINGS);
  var worstPeak = 0;
  var n = Math.max(60, Math.floor(ITER / 12));
  for (var it = 0; it < n; it++) {
    var patch = {};
    PB.PARAMS.forEach(function (p) {
      if (p.type === 'enum') patch[p.id] = p.options[Math.floor(rnd(r) * p.options.length)];
      else patch[p.id] = p.min + rnd(r) * (p.max - p.min);
    });
    patch.tuning = tunings[Math.floor(rnd(r) * tunings.length)];

    var core, L, R;
    try {
      core = new PB.PallbearerCore(SR, (r.next() >>> 0));
      core.setPatch(patch);
      L = new Float64Array(2048); R = new Float64Array(2048);
      var open = PB.TUNINGS[patch.tuning].open;
      for (var k = 0; k < 6; k++) {
        var note = open[0] + Math.floor(rnd(r) * 30);
        core.noteOn(note, rnd(r));
        core.render(L, R, 2048);
        if (rnd(r) < 0.5) core.noteOff(note);
      }
      for (var q = 0; q < 8; q++) core.render(L, R, 2048);
    } catch (e) {
      bad('render threw on a legal random patch: ' + e.message + ' (iter ' + it + ')');
      continue;
    }
    checks++;
    var pk = 0, nan = 0;
    for (var i = 0; i < L.length; i++) {
      var v = L[i];
      if (!isFinite(v)) nan++;
      var a = Math.abs(v); if (a > pk) pk = a;
    }
    if (nan) bad(nan + ' non-finite samples from a legal patch (iter ' + it + ')');
    if (pk > 1.6000001) bad('output exceeded the clip ceiling: ' + pk + ' (iter ' + it + ')');
    if (pk > worstPeak) worstPeak = pk;
  }
  console.log('  worst peak across random patches: ' + worstPeak.toFixed(6) + ' (ceiling 1.6)');
})();

/* ---- 3. hostile note and velocity input ---- */
(function () {
  var wild = [-1e9, -128, -1, 0, 1, 20, 28, 127, 128, 1e9, NaN, Infinity, -Infinity, 0.5, null, undefined, '33'];
  var core = new PB.PallbearerCore(SR, 7);
  var L = new Float64Array(512), R = new Float64Array(512);
  wild.forEach(function (n) {
    wild.forEach(function (v) {
      checks++;
      try {
        core.noteOn(n, v);
        core.render(L, R, 512);
        core.noteOff(n);
        for (var i = 0; i < 512; i++) if (!isFinite(L[i])) { bad('non-finite from noteOn(' + n + ',' + v + ')'); break; }
      } catch (e) {
        bad('noteOn(' + n + ', ' + v + ') threw: ' + e.message);
      }
    });
  });
  core.allOff();
})();

/* ---- 4. hostile setParam ---- */
(function () {
  var core = new PB.PallbearerCore(SR, 11);
  var ids = PB.PARAMS.map(function (p) { return p.id; }).concat(['', 'nope', '__proto__', 'constructor', 'toString']);
  var L = new Float64Array(256), R = new Float64Array(256);
  ids.forEach(function (id) {
    POISON.forEach(function (v) {
      checks++;
      try {
        core.setParam(id, v);
        core.noteOn(33, 0.8);
        core.render(L, R, 256);
        for (var i = 0; i < 256; i++) if (!isFinite(L[i])) { bad('non-finite after setParam(' + id + ', ' + String(v) + ')'); break; }
      } catch (e) {
        bad('setParam(' + id + ', ' + String(v) + ') threw: ' + e.message);
      }
    });
  });
  /* Prototype pollution: setParam must not be a back door onto Object. */
  checks++;
  if (({}).polluted !== undefined) bad('setParam polluted Object.prototype');
})();

/* ---- 5. hostile attack layers ---- */
(function () {
  var core = new PB.PallbearerCore(SR, 13);
  core.setPatch({ atkGain: 1, strGain: 0.5 });
  var L = new Float64Array(1024), R = new Float64Array(1024);
  var layers = [
    null, undefined, {}, { data: null }, { data: [] }, { data: new Float64Array(0) },
    { data: new Float64Array([NaN, NaN, NaN]), sr: SR, root: 33 },
    { data: new Float64Array([Infinity, 1, 2]), sr: SR, root: 33 },
    { data: new Float64Array([1, 2, 3]), sr: 0, root: 33 },
    { data: new Float64Array([1, 2, 3]), sr: SR, root: -1e9 },
    { data: new Float64Array([1, 2, 3]), sr: SR, root: NaN },
    { data: new Float64Array(4).fill(1e300), sr: SR, root: 33 }
  ];
  layers.forEach(function (lay, li) {
    checks++;
    try {
      core.setAttackLayer(lay);
      core.noteOn(33, 0.9);
      core.render(L, R, 1024);
      core.noteOff(33);
      /* A layer full of NaN legitimately produces NaN — garbage in, garbage
         out is acceptable. What is NOT acceptable is throwing, or poisoning
         the instrument so that a LATER clean note is broken too. */
      core.setAttackLayer(null);
      core.allOff();
      core.setPatch({ atkGain: 0, strGain: 1 });
      core.noteOn(33, 0.9);
      core.render(L, R, 1024);
      for (var j = 0; j < 1024; j++) {
        if (!isFinite(L[j])) { bad('layer #' + li + ' poisoned the instrument for later clean notes'); break; }
      }
      core.setPatch({ atkGain: 1, strGain: 0.5 });
    } catch (e) {
      bad('attack layer #' + li + ' threw: ' + e.message);
    }
  });
})();

/* ---- 6. boundary sweep on every numeric parameter ---- */
(function () {
  PB.PARAMS.forEach(function (p) {
    if (p.type === 'enum') return;
    var pts = [p.min, p.min + 1e-12, p.min + (p.max - p.min) * 0.5, p.max - 1e-12, p.max,
               p.min - 1e-9, p.max + 1e-9, 0];
    pts.forEach(function (v) {
      checks++;
      try {
        var patch = {}; patch[p.id] = v;
        var r = PB.renderNote(patch, 33, 0.25, SR, 0.9, 0.2, 0x1234);
        for (var i = 0; i < r.L.length; i++) {
          if (!isFinite(r.L[i])) { bad('non-finite at ' + p.id + ' = ' + v); break; }
          if (Math.abs(r.L[i]) > 1.6000001) { bad('clip ceiling breached at ' + p.id + ' = ' + v); break; }
        }
      } catch (e) {
        bad(p.id + ' = ' + v + ' threw: ' + e.message);
      }
    });
  });
})();

/* ---- 7. long soak — the instrument must not drift or accumulate ---- */
(function () {
  var core = new PB.PallbearerCore(SR, 0x50AC);
  core.setPatch({ decay: 12, couple: 1, humanize: 1, buzz: 1, relNoise: 1, drive: 0.5 });
  var L = new Float64Array(4096), R = new Float64Array(4096);
  var r = new PB.Rng(0x50AC);
  var maxSeen = 0, broke = false;
  for (var i = 0; i < 400 && !broke; i++) {
    if (i % 3 === 0) core.noteOn(23 + Math.floor(rnd(r) * 30), rnd(r));
    if (i % 5 === 0) core.noteOff(23 + Math.floor(rnd(r) * 30));
    core.render(L, R, 4096);
    for (var j = 0; j < 4096; j++) {
      var v = L[j];
      if (!isFinite(v)) { bad('non-finite during the soak at block ' + i); broke = true; break; }
      var a = Math.abs(v); if (a > maxSeen) maxSeen = a;
    }
  }
  checks++;
  console.log('  soak: 400 blocks, peak ' + maxSeen.toFixed(6));
  if (maxSeen > 1.6000001) bad('soak breached the ceiling: ' + maxSeen);
})();

console.log('');
if (fails === 0) {
  console.log('✓ fuzz clean — ' + checks + ' hostile cases, no NaN, no runaway, no throw.');
  process.exit(0);
}
console.log('✗ ' + fails + ' failures out of ' + checks + ' hostile cases.');
process.exit(1);
