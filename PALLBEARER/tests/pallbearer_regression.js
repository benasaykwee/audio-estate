/* PALLBEARER regression — byte-stable baselines.
   node tests/pallbearer_regression.js           check against the baseline
   node tests/pallbearer_regression.js --bless   re-record (deliberately)

   The cheapest possible proof that a change which was supposed to be
   inaudible actually was. Every phrase below is a fixed patch, fixed seed
   and fixed note list, so the bytes cannot move unless the DSP moved.

   Blessing is a decision, never a convenience. If a hash shifts and you did
   not mean it, you have found a bug, not an inconvenience. */
'use strict';
var fs = require('fs');
var path = require('path');
var PB = require('../pallbearer_core.js');

var BASELINE = path.join(__dirname, 'regression_baseline.json');
var bless = process.argv.indexOf('--bless') >= 0;
var SR = 48000;

var CASES = [
  { name: 'default_walk',   seed: 0x5EED1E, notes: [28, 33, 40, 35, 28], patch: {} },
  { name: 'precision',      seed: 0x5EED1E, notes: [28, 35, 40], patch: {
      style: 'finger', pickupA: 0.25, pickupB: 0.25, pickupMix: 0.5, pluckPos: 0.14,
      damping: 0.34, inharm: 0.42, decay: 4.2, bodyFreq: 88, bodyMix: 0.34, tone: 2600, drive: 0.14 } },
  { name: 'slap',           seed: 0xBEEF, notes: [28, 40, 28, 43], patch: {
      style: 'slap', hardness: 0.9, buzz: 1, pluckPos: 0.05, damping: 0.10, tone: 8000, drive: 0.22 } },
  { name: 'upright',        seed: 0x11, notes: [28, 33, 31], patch: {
      style: 'finger', pluckPos: 0.30, damping: 0.66, inharm: 0.12, decay: 1.9,
      bodyFreq: 68, bodyQ: 5.5, bodyMix: 0.62, woodMix: 0.8, tone: 1200, hardness: 0.15 } },
  { name: 'ghost_and_palm', seed: 0x99, notes: [33, 33, 36], patch: { artic: 'ghost', noise: 0.8 } },
  { name: 'harmonics',      seed: 0x7, notes: [28, 33, 40], patch: { artic: 'harmonic', inharm: 0.7, decay: 8 } },
  { name: 'five_string',    seed: 0x5, notes: [23, 28, 26], patch: {
      tuning: 'standard-5', bodyFreq: 62, woodMix: 1, bodyMix: 0.4, inharm: 0.55 } },
  { name: 'humanize_max',   seed: 0x2222, notes: [33, 33, 33, 33], patch: { humanize: 1, buzz: 0.6, relNoise: 1 } },
  { name: 'extremes',       seed: 0xFFFF, notes: [23, 43], patch: {
      damping: 0.985, inharm: 1, stretch: 1, drive: 1, level: 2, pickupInv: 'out',
      pickupMix: 1, humanize: 1, buzz: 1, relNoise: 1, velBright: 1 } },
  { name: 'sampled_path',   seed: 0x33, notes: [33, 38], patch: { strGain: 0, atkGain: 1 }, layer: true },
  { name: 'hybrid_path',    seed: 0x33, notes: [33, 38], patch: { strGain: 1, atkGain: 0.7 }, layer: true }
];

/* Portable fixture, same rule as the parity gate: no transcendental. */
function makeLayer(sr, secs, seed) {
  var n = Math.floor(secs * sr), d = new Float64Array(n);
  var r = new PB.Rng(seed), env = 1;
  for (var i = 0; i < n; i++) { d[i] = env * r.bi(); env *= 0.99946; }
  return d;
}

function renderCase(c) {
  var core = new PB.PallbearerCore(SR, c.seed);
  core.setPatch(c.patch);
  if (c.layer) core.setAttackLayer({ data: makeLayer(SR, 0.3, 0xA77AC4), sr: SR, root: 33 });
  var ns = 0.32;
  var total = Math.floor((c.notes.length * ns + 1.2) * SR);
  var L = new Float64Array(total), R = new Float64Array(total);
  var blk = 64, tl = new Float64Array(blk), tr = new Float64Array(blk);
  var pos = 0, ni = 0, nextOn = 0, offAt = -1, cur = -1;
  while (pos < total) {
    while (ni < c.notes.length && pos >= nextOn) {
      if (cur >= 0) { core.noteOff(cur); cur = -1; }
      cur = c.notes[ni]; core.noteOn(cur, 0.88);
      offAt = pos + Math.floor(ns * 0.85 * SR);
      nextOn += Math.floor(ns * SR); ni++;
    }
    if (offAt > 0 && pos >= offAt && cur >= 0) { core.noteOff(cur); cur = -1; offAt = -1; }
    var m = Math.min(blk, total - pos);
    core.render(tl, tr, m);
    L.set(tl.subarray(0, m), pos);
    pos += m;
  }
  return L;
}

var got = {};
var stats = {};
CASES.forEach(function (c) {
  var L = renderCase(c);
  var pk = 0, energy = 0, bad = 0;
  for (var i = 0; i < L.length; i++) {
    var v = L[i];
    if (!isFinite(v)) bad++;
    var a = Math.abs(v); if (a > pk) pk = a;
    energy += v * v;
  }
  got[c.name] = PB.hashBuf(L);
  stats[c.name] = { peak: pk, rms: Math.sqrt(energy / L.length), bad: bad, n: L.length };
});

if (bless || !fs.existsSync(BASELINE)) {
  fs.writeFileSync(BASELINE, JSON.stringify({
    version: PB.VERSION, sr: SR, recorded: new Date().toISOString().slice(0, 10), hashes: got
  }, null, 2));
  console.log((fs.existsSync(BASELINE) && !bless ? 'no baseline found — recorded' : 'BLESSED') +
              ' ' + Object.keys(got).length + ' baselines at v' + PB.VERSION);
  Object.keys(got).forEach(function (k) { console.log('  ' + k.padEnd(18) + ' ' + got[k]); });
  process.exit(0);
}

var base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
var fails = 0, checked = 0;
console.log('PALLBEARER regression — baseline recorded ' + base.recorded + ' at v' + base.version + '\n');
Object.keys(got).forEach(function (k) {
  checked++;
  var b = base.hashes[k];
  var s = stats[k];
  if (b === undefined) {
    console.log('  ? ' + k.padEnd(18) + ' NEW — not in baseline (' + got[k] + ')');
    fails++;
  } else if (b === got[k]) {
    console.log('  ✓ ' + k.padEnd(18) + ' byte-stable (' + got[k] + ')  peak ' + s.peak.toFixed(4));
  } else {
    console.log('  ✗ ' + k.padEnd(18) + ' MOVED  ' + b + ' → ' + got[k] + '   peak ' + s.peak.toFixed(4));
    fails++;
  }
  if (s.bad) { console.log('    !! ' + s.bad + ' non-finite samples'); fails++; }
});
Object.keys(base.hashes).forEach(function (k) {
  if (got[k] === undefined) { console.log('  ✗ ' + k.padEnd(18) + ' MISSING — baseline has it, the run does not'); fails++; }
});

console.log('');
if (fails === 0) {
  console.log('regression clean — nothing has shifted in the grave.  (' + checked + ' phrases)');
  process.exit(0);
}
console.log(fails + ' of ' + checked + ' moved. If you meant it: --bless. If you did not, you found a bug.');
process.exit(1);
