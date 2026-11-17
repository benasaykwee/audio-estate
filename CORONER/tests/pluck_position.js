/* ===================================================================
   CORONER — the pluck-position gate
   tests/pluck_position.js

   Plucking a string at fraction p puts nulls in its harmonic series at
   n = k/p. This recovers p from that comb, and the bodies below have
   their pluck position built in, so the truth is known by construction
   rather than labelled by ear.

   TWO THINGS ARE BEING TESTED, and the second matters more:

     1. that a measurable pluck position is recovered accurately;
     2. that an UNMEASURABLE one is refused rather than invented.

   The second is not a nicety. A pluck close to the bridge puts its first
   null past the partials that can be tracked, and the best-correlating
   candidate is then an accident: p = 0.05 recovers as 0.38 if it is
   allowed to. PALLBEARER's importer clamps and defaults in silence, so a
   confident wrong pluck position would arrive, be accepted, and change
   the whole character of the sound with nothing anywhere saying so.

   Run:  node tests/pluck_position.js
   =================================================================== */

'use strict';

var path = require('path');
var HERE = __dirname;
var ROOT = path.join(HERE, '..', '..');

var NM = require(path.join(ROOT, 'shared', 'necromath.js'));
global.NM = NM;
var CR = require(path.join(HERE, '..', 'coroner_core.js'));

var pass = 0, fail = 0, failures = [], section = '';
function sec(s) { section = s; console.log('\n' + s); }
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; failures.push(section + ' :: ' + name + (detail ? '  [' + detail + ']' : ''));
    console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : ''));
  }
}

var SR = 44100;

function Dice(seed) {
  var s = seed >>> 0 || 1;
  this.next = function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  this.bi = function () { return this.next() * 2 - 1; };
}

/* An ideal plucked string: triangular initial displacement with its apex
   at fraction p, so A_n = |sin(n·π·p)| / n². Options add the things a real
   string has and an ideal one does not. */
function pluck(f0, p, dur, o) {
  o = o || {};
  var n = Math.floor(dur * SR), out = new Float64Array(n), ph = 0;
  var d = new Dice(o.seed || 5);
  var amps = [];
  for (var k = 1; k <= 32; k++) {
    amps.push(k * f0 > SR * 0.45 ? 0 : Math.abs(NM.sin(k * Math.PI * p)) / (k * k));
  }
  for (var i = 0; i < n; i++) {
    ph += 2 * Math.PI * f0 / SR;
    var s = 0;
    for (var k2 = 1; k2 <= amps.length; k2++) {
      if (!amps[k2 - 1]) continue;
      var m = k2 * Math.sqrt(1 + (o.inharm || 0) * k2 * k2);
      var dec = o.perPartialDecay ? NM.pow10(-(o.perPartialDecay * k2) * (i / SR) / 20) : 1;
      s += amps[k2 - 1] * NM.sin(ph * m) * dec;
    }
    var t = i / SR, e = 1;
    if (o.decayPerSec) e *= NM.pow10(o.decayPerSec * t / 20);
    out[i] = s * e + (o.noise ? d.bi() * o.noise * e : 0);
  }
  var pk = 0;
  for (i = 0; i < n; i++) { var a = Math.abs(out[i]); if (a > pk) pk = a; }
  if (pk > 0) for (i = 0; i < n; i++) out[i] /= pk;
  return out;
}

// ===================================================================
sec('I. When it speaks, it is right — and it often declines');

/* THE BAR THAT MATTERS IS NOT THE ANSWER RATE.

   Swept across pluck positions, the estimator refuses about a third of
   the time. That is the design, not a shortfall: a comb at p shares half
   its nulls with one at p/2, so when only some nulls fall in range two
   positions explain the same evidence equally well. No threshold on
   partial count separates them — a bar strict enough to make p=0.11 safe
   still lets p=0.30 through at 32 partials.

   So the assertion is one-sided on purpose: EVERY answer it gives must be
   right, and refusing is always acceptable. A measurement that is silent
   when it does not know is worth more than one that is usually right. */

console.log('       truth   measured   fit    verdict');
var spoke = 0, wrong = [];
[0.08, 0.11, 0.13, 0.16, 0.20, 0.25, 0.30, 0.33, 0.40].forEach(function (truth) {
  var f = CR.examine(pluck(110, truth, 2.0, {}), SR).features;
  var got = f.pluckPos, fit = f.pluckFit;
  var err = got > 0 ? Math.abs(got - truth) : NaN;
  console.log('       ' + truth.toFixed(3) + '   ' +
    (got > 0 ? got.toFixed(3) : '  —  ').padStart(7) + '   ' + fit.toFixed(2) +
    '   ' + (got > 0 ? ('±' + err.toFixed(3)) : 'declined'));
  if (got > 0) {
    spoke++;
    if (!(err < 0.03)) wrong.push('p=' + truth + ' answered ' + got.toFixed(3));
  }
});

ok('it answered at least some of them', spoke >= 4, spoke + ' of 9');
ok('EVERY answer it gave was within 0.03', wrong.length === 0, wrong.join('; '));
console.log('       answered ' + spoke + '/9, and all ' + spoke + ' were right');

sec('II. Refusing a position that is NOT in the sound');

(function () {
  /* p = 0.05 has its first null at partial 20 and no second one inside
     the trackable range. One null cannot fix a period. Left unguarded it
     recovers as 0.38 — a confident answer nearly eight times the truth. */
  var f = CR.examine(pluck(110, 0.05, 2.0, {}), SR).features;
  console.log('       a pluck at 0.05 (first null at partial 20): pluckPos=' +
              f.pluckPos.toFixed(3) + ' fit=' + f.pluckFit.toFixed(2));
  ok('a pluck too near the bridge is refused, not invented',
     f.pluckPos === 0, 'reported ' + f.pluckPos.toFixed(3));
})();

(function () {
  var f = CR.examine((function () {
    var d = new Dice(31), n = Math.floor(2.0 * SR), o = new Float64Array(n);
    for (var i = 0; i < n; i++) o[i] = d.bi();
    return o;
  })(), SR).features;
  ok('noise has no pluck position', f.pluckPos === 0, 'reported ' + f.pluckPos.toFixed(3));
})();

(function () {
  /* A pure sine has one partial and therefore no comb at all. */
  var n = Math.floor(2.0 * SR), o = new Float64Array(n);
  for (var i = 0; i < n; i++) o[i] = NM.sin(2 * Math.PI * 220 * i / SR);
  var f = CR.examine(o, SR).features;
  ok('a single sine has no pluck position', f.pluckPos === 0, 'reported ' + f.pluckPos.toFixed(3));
})();

// ===================================================================
sec('III. It survives the things a real string has');

[
  ['stiffness (B=6e-4)',   { inharm: 0.0006 }],
  ['a decaying envelope',  { decayPerSec: -12 }],
  ['faster high partials', { perPartialDecay: 0.6, decayPerSec: -8 }],
  ['finger noise',         { noise: 0.06, seed: 12 }],
  ['all of them at once',  { inharm: 0.0005, decayPerSec: -10, perPartialDecay: 0.4, noise: 0.05, seed: 13 }]
].forEach(function (c) {
  var truth = 0.16;
  var f = CR.examine(pluck(110, truth, 2.2, c[1]), SR).features;
  var err = f.pluckPos > 0 ? Math.abs(f.pluckPos - truth) : NaN;
  ok('p is still recovered with ' + c[0], isFinite(err) && err < 0.05,
     f.pluckPos > 0 ? ('got ' + f.pluckPos.toFixed(3) + ', off by ' + err.toFixed(3))
                    : ('refused, fit ' + f.pluckFit.toFixed(2)));
});

// ===================================================================
sec('IV. The PALLBEARER slip');

(function () {
  /* PALLBEARER's registry, transcribed. Same discipline as the NECROPHONE
     contract gate: the seam is only safe while both copies agree, and
     PALLBEARER's `sanitize()` cannot report — it returns a complete,
     plausible patch built entirely from defaults and says nothing. */
  var PB = {
    style:    { enum: ['finger', 'pick', 'slap', 'thumb', 'muted'] },
    inharm:   { min: 0, max: 1 },
    decay:    { min: 0.5, max: 12 },
    damping:  { min: 0, max: 1 },
    hardness: { min: 0, max: 1 },
    tone:     { min: 200, max: 12000 },
    noise:    { min: 0, max: 1 },
    drive:    { min: 0, max: 1 },
    pluckPos: { min: 0.02, max: 0.5 }
  };

  var bodies = [
    ['a low plucked string', pluck(49,  0.16, 2.2, { inharm: 0.0005, decayPerSec: -9, noise: 0.03, seed: 21 })],
    ['a bass near the bridge', pluck(55, 0.05, 2.2, { inharm: 0.0005, decayPerSec: -9, noise: 0.03, seed: 22 })],
    ['a bass plucked mid-neck', pluck(41, 0.30, 2.2, { inharm: 0.0004, decayPerSec: -7, noise: 0.04, seed: 23 })]
  ];

  var unknown = [], bad = [], sawPluck = false, sawSlip = false;
  bodies.forEach(function (b) {
    var slip = CR.autopsy(b[1], SR).slip;
    if (!slip || slip.target !== 'PALLBEARER') return;
    sawSlip = true;
    if ('pluckPos' in slip.params) sawPluck = true;
    Object.keys(slip.params).forEach(function (k) {
      var spec = PB[k];
      if (!spec) { unknown.push(b[0] + ': ' + k); return; }
      var v = slip.params[k];
      if (spec.enum) { if (spec.enum.indexOf(v) < 0) bad.push(k + '=' + v); }
      else if (!(v >= spec.min && v <= spec.max)) bad.push(k + '=' + v + ' outside [' + spec.min + ',' + spec.max + ']');
    });
  });

  ok('at least one body reached PALLBEARER', sawSlip);
  ok('no slip invents a parameter PALLBEARER does not have', unknown.length === 0, unknown.join(', '));
  ok('no slip writes a value outside PALLBEARER\'s range', bad.length === 0, bad.join(', '));

  /* ⚠ THE DECLINE IS THE FEATURE, and this pins it.

     Pluck position is now MEASURED and reported. It is still not written
     into the patch, because reporting a measurement and acting on it are
     different bars and this clears only the first. PALLBEARER's
     `sanitize()` cannot report — it returns a complete, plausible patch
     built from defaults and says nothing — so a value that is right two
     times in three would arrive, be accepted, and move the character of
     the sound with nothing anywhere saying so.

     If a future hand connects it, this fails, and that hand should have to
     read the estimator's own account of its aliasing first. */
  ok('pluck position is measured but deliberately NOT written into the patch',
     !sawPluck,
     'pluckPos reached the slip — read pluckPosition() on why that is not yet safe');
})();

(function () {
  /* ⚠ THE ONE THAT IS NOT ABOUT PLUCK POSITION AT ALL.

     PALLBEARER's seam document records that String Coupling can
     self-oscillate, and that the slip is safe today "by omission rather
     than by design" — warning that a stiffness measurement is exactly what
     would tempt someone to add coupling. CORONER now measures stiffness
     AND pluck position, which is precisely the pair that makes `couple`
     look like the obvious next line.

     So the omission stops being an accident and becomes a gate. This fails
     the moment anyone adds it, which is the point: fix the oscillation in
     PALLBEARER first, THEN emit it. */
  var everSeen = false;
  [0.10, 0.16, 0.25, 0.33].forEach(function (pp) {
    [41, 49, 55, 73].forEach(function (f0) {
      var slip = CR.autopsy(pluck(f0, pp, 2.0, { inharm: 0.0005, decayPerSec: -9, noise: 0.03, seed: 30 }), SR).slip;
      if (slip && slip.target === 'PALLBEARER' && ('couple' in slip.params)) everSeen = true;
    });
  });
  ok('`couple` is NEVER emitted — string coupling can self-oscillate', !everSeen,
     'a patch that drones can now be handed to PALLBEARER');

  var src = require('fs').readFileSync(path.join(HERE, '..', 'coroner_core.js'), 'utf8');
  ok('and the source carries the warning, so the next hand knows why',
     /couple/.test(src) && /self-oscillat/i.test(src));
})();

// ===================================================================
sec('V. The feature contract');

(function () {
  ok('pluckPos and pluckFit are declared in the registry',
     !!CR.FEATURE_BY_ID.pluckPos && !!CR.FEATURE_BY_ID.pluckFit);
  ok('they were appended at the END, so no existing slot shifted',
     CR.FEATURES[CR.FEATURES.length - 2].id === 'pluckPos' &&
     CR.FEATURES[CR.FEATURES.length - 1].id === 'pluckFit',
     CR.FEATURES.slice(-3).map(function (f) { return f.id; }).join(','));
  ok('and the version was bumped anyway, because the LENGTH is part of the contract',
     CR.FEATURE_VERSION === 4, 'v' + CR.FEATURE_VERSION);
  ok('the declared maximum for a pluck position is physically defensible',
     CR.FEATURE_BY_ID.pluckPos.max <= 0.5,
     'a pluck past the midpoint is the mirror of one before it');
})();

// ===================================================================
console.log('\n' + '='.repeat(66));
console.log('CORONER pluck position — ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' checks');
if (fail) { console.log('\nfailures:'); failures.forEach(function (f) { console.log('  · ' + f); }); }
console.log('='.repeat(66));
process.exit(fail ? 1 : 0);
