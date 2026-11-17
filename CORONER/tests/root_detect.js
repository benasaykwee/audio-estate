/* ===================================================================
   CORONER — the root detector, measured against the incumbent
   tests/root_detect.js

   CORONER claims a better root detector than the one NECROPHONE already
   has. A claim like that is worth nothing unrun, so this lifts
   NECROPHONE's REAL `detectPitchHz` out of `necrophone.html` and puts
   the two side by side on bodies whose pitch is known by construction.

   BOTH DIRECTIONS ARE TESTED, and that matters more than the win rate.
   A detector that is more accurate and refuses less often is not better
   — NECROPHONE's own comment says a wrong confident answer is worse
   than none, and this inherits that rule rather than beating it.

   Nothing here modifies NECROPHONE. This measures; whether to swap is a
   separate decision with its own risk, and it is Ben's.

   Run:  node tests/root_detect.js
   =================================================================== */

'use strict';

var fs = require('fs');
var path = require('path');

var HERE = __dirname;
var ROOT = path.join(HERE, '..', '..');
var NECRO_HTML = path.join(ROOT, 'necrophone.html');

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

// ---- lift the incumbent -------------------------------------------
require('./_requires.js').requires({
  name: "the root detector comparison",
  files: [NECRO_HTML],
  because: 'NECROPHONE is deliberately not in the estate repository — the root .gitignore is an allowlist, and its own comment explains that a workflow without its sources is a job that can only fail.',
  gates: [
    "that CORONER's root detector still beats detectPitchHz on known-pitch bodies",
    "that a stiff string is still measured accurately rather than ~30 cents sharp",
    "that a chord is still REFUSED rather than answered at a phantom subharmonic"
  ]
});
var HTML = fs.readFileSync(NECRO_HTML, 'utf8');

function lift(name) {
  var at = HTML.indexOf('function ' + name + '(');
  if (at < 0) return null;
  var open = HTML.indexOf('{', at), depth = 0, i = open;
  for (; i < HTML.length; i++) {
    var ch = HTML[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HTML.slice(at, i);
}

var srcDetect = lift('detectPitchHz');
sec("0. Lifting NECROPHONE's own detector");
ok('detectPitchHz was found in necrophone.html', !!srcDetect);
if (!srcDetect) { process.exit(1); }

var detectPitchHz = (new Function(srcDetect + '\nreturn detectPitchHz;'))();
ok('and it runs', typeof detectPitchHz === 'function');

// ---- bodies whose pitch is known by construction -------------------
var SR = 44100;
function Dice(seed) {
  var s = seed >>> 0 || 1;
  this.next = function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  this.bi = function () { return this.next() * 2 - 1; };
}

function note(f0, dur, o) {
  o = o || {};
  var n = Math.floor(dur * SR), out = new Float64Array(n), ph = 0;
  var d = new Dice(o.seed || 3);
  for (var i = 0; i < n; i++) {
    ph += 2 * Math.PI * f0 / SR;
    var s = 0;
    for (var k = 1; k <= (o.partials || 16); k++) {
      var m = k * Math.sqrt(1 + (o.inharm || 0) * k * k);
      if (m * f0 > SR * 0.45) break;
      s += (1 / Math.pow(k, o.slope === undefined ? 0.8 : o.slope)) * NM.sin(ph * m);
    }
    var t = i / SR, e = 1;
    if (o.atk) e *= t < o.atk ? t / o.atk : 1;
    if (o.decayPerSec) e *= NM.pow10(o.decayPerSec * t / 20);
    out[i] = s * e + (o.noise ? d.bi() * o.noise * e : 0);
  }
  var pk = 0;
  for (i = 0; i < n; i++) { var a = Math.abs(out[i]); if (a > pk) pk = a; }
  if (pk > 0) for (i = 0; i < n; i++) out[i] /= pk;
  return out;
}

function join() {
  var parts = Array.prototype.slice.call(arguments);
  var tot = parts.reduce(function (a, p) { return a + p.length; }, 0);
  var out = new Float64Array(tot), at = 0;
  parts.forEach(function (p) { out.set(p, at); at += p.length; });
  return out;
}

function noiseBuf(dur, seed) {
  var d = new Dice(seed), n = Math.floor(dur * SR), o = new Float64Array(n);
  for (var i = 0; i < n; i++) o[i] = d.bi();
  return o;
}

function chord(f0s, dur) {
  var parts = f0s.map(function (f) { return note(f, dur, { partials: 12 }); });
  var n = parts[0].length, out = new Float64Array(n);
  for (var i = 0; i < n; i++) { for (var j = 0; j < parts.length; j++) out[i] += parts[j][i] / parts.length; }
  return out;
}

function cents(a, b) { return (a > 0 && b > 0) ? 1200 * Math.log(a / b) / Math.LN2 : NaN; }

// ---- the cases -----------------------------------------------------
var CASES = [
  { label: 'a plain held note (G3)', truth: 196,
    buf: note(196, 2.0, { partials: 14 }) },

  { label: 'a STIFF string (B=8e-4)', truth: 110,
    buf: note(110, 2.0, { partials: 20, inharm: 0.0008 }),
    note_: 'autocorrelation reads this sharp — real physics, not a bug' },

  { label: 'a very stiff short string', truth: 147,
    buf: note(147, 2.0, { partials: 20, inharm: 0.0015 }) },

  { label: 'a PHRASE, root note first', truth: 196,
    buf: join(note(196, 0.7, {}), note(261.63, 0.7, {}), note(329.63, 0.7, {})),
    note_: 'the middle quarter-second lands on the SECOND note' },

  { label: 'a phrase with the root last', truth: 220,
    buf: join(note(330, 0.6, {}), note(277.18, 0.6, {}), note(220, 1.2, {})),
    lenient: true,
    note_: 'the longest note is the root; a fixed middle window is not on it' },

  { label: 'a decaying pluck then silence', truth: 196,
    buf: join(note(196, 0.5, { atk: 0.002, decayPerSec: -20, inharm: 0.0005 }),
              new Float64Array(Math.floor(2.5 * SR))) },

  { label: 'a quiet note (-30 dBFS)', truth: 220,
    buf: (function () { var b = note(220, 2.0, {}); for (var i = 0; i < b.length; i++) b[i] *= 0.03; return b; })() },

  { label: 'a breathy note', truth: 262,
    buf: note(262, 2.0, { noise: 0.3, seed: 9 }) }
];

var REFUSE_CASES = [
  { label: 'white noise', buf: noiseBuf(2.0, 11) },
  { label: 'a three-note chord', buf: chord([220, 277.18, 329.63], 2.0) },
  { label: 'silence', buf: new Float64Array(SR) }
];

// ===================================================================
sec('I. Accuracy on bodies whose pitch is known');

console.log('       ' + 'case'.padEnd(32) + 'truth'.padStart(7) + '   CORONER'.padEnd(22) + 'NECROPHONE');

var coronerErrs = [], necroErrs = [], coronerWins = 0, necroWins = 0;

CASES.forEach(function (c) {
  var r = CR.detectRoot(c.buf, SR);
  var f32 = new Float32Array(c.buf);
  var nh = detectPitchHz(f32, SR, 50, 1600);

  var ce = r.refused ? NaN : Math.abs(cents(r.hz, c.truth));
  var ne = nh > 0 ? Math.abs(cents(nh, c.truth)) : NaN;

  console.log('       ' + c.label.padEnd(32) + String(c.truth).padStart(7) + '   ' +
    (r.refused ? 'refused'.padEnd(20) : (r.hz.toFixed(1) + ' (' + ce.toFixed(0) + 'c)').padEnd(20)) + '  ' +
    (nh > 0 ? (nh.toFixed(1) + ' (' + ne.toFixed(0) + 'c)') : 'refused'));
  if (c.note_) console.log('           ' + c.note_);

  if (isFinite(ce)) coronerErrs.push(ce);
  if (isFinite(ne)) necroErrs.push(ne);
  if (isFinite(ce) && (!isFinite(ne) || ce < ne - 2)) coronerWins++;
  if (isFinite(ne) && (!isFinite(ce) || ne < ce - 2)) necroWins++;

  /* The bar is a SEMITONE, because corpseRoot is quantised to semitones —
     being right to the cent is nice and being right to the semitone is
     what actually changes the parameter. `lenient` cases are ones where
     more than one note could defensibly be called the root. */
  var bar = c.lenient ? 250 : 50;
  ok(c.label + ' — CORONER lands within ' + (bar === 50 ? 'a semitone' : 'two semitones'),
     isFinite(ce) && ce < bar,
     r.refused ? ('refused: ' + r.why) : (ce.toFixed(0) + ' cents off'));
});

console.log('');
console.log('       CORONER answered ' + coronerErrs.length + '/' + CASES.length +
            ', worst ' + (coronerErrs.length ? Math.max.apply(null, coronerErrs).toFixed(0) : '—') + ' cents');
console.log('       NECROPHONE answered ' + necroErrs.length + '/' + CASES.length +
            ', worst ' + (necroErrs.length ? Math.max.apply(null, necroErrs).toFixed(0) : '—') + ' cents');
console.log('       clear wins: CORONER ' + coronerWins + ', NECROPHONE ' + necroWins);

// ===================================================================
sec('II. The stiff-string case, on its own');

(function () {
  /* The specific claim: autocorrelation reads a stiff string sharp
     because stretched partials share no period, and fitting stiffness
     alongside pitch removes that bias. If this does not hold, the claim
     in CORONER's own comments is wrong and should be deleted. */
  var truth = 110;
  var buf = note(truth, 2.0, { partials: 20, inharm: 0.0008 });
  var r = CR.detectRoot(buf, SR);
  var nh = detectPitchHz(new Float32Array(buf), SR, 50, 1600);

  var ce = Math.abs(cents(r.hz, truth));
  var ne = Math.abs(cents(nh, truth));
  console.log('       CORONER ' + r.hz.toFixed(2) + ' Hz (' + ce.toFixed(1) + 'c)   ' +
              'NECROPHONE ' + nh.toFixed(2) + ' Hz (' + ne.toFixed(1) + 'c)');

  ok('CORONER is accurate on a stiff string', ce < 15, ce.toFixed(1) + ' cents');
  ok('and it reports the stiffness it fitted', r.inharm > 2e-4 && r.inharmFit > 0.75,
     'B=' + r.inharm.toExponential(2) + ' fit=' + r.inharmFit.toFixed(3));
  ok('and says so in its reasoning', /stiffness/.test(r.why), r.why);
})();

// ===================================================================
sec('III. Refusing — the half that matters more');

REFUSE_CASES.forEach(function (c) {
  var r = CR.detectRoot(c.buf, SR);
  var nh = detectPitchHz(new Float32Array(c.buf), SR, 50, 1600);
  console.log('       ' + c.label.padEnd(24) +
              'CORONER ' + (r.refused ? 'refused' : r.hz.toFixed(1) + ' Hz').padEnd(14) +
              'NECROPHONE ' + (nh > 0 ? nh.toFixed(1) + ' Hz' : 'refused'));
  ok(c.label + ' is refused rather than guessed', r.refused, r.refused ? '' : ('answered ' + r.hz.toFixed(1) + ' Hz'));
  if (r.refused) ok('   and says why in English', typeof r.why === 'string' && r.why.length > 8, r.why);
});

// ===================================================================
sec('IV. The shape of the answer');

(function () {
  var r = CR.detectRoot(note(392, 2.0, {}), SR);
  ok('a root carries the note name', r.note === 'G4', 'got ' + r.note);
  ok('and the corpseRoot offset NECROPHONE actually wants', r.corpseRoot === 12,
     'got ' + r.corpseRoot + ' (G4 is twelve semitones above G3)');
  ok('and a confidence', r.confidence > 0 && r.confidence <= 1, String(r.confidence));
  ok('and it is not marked refused', r.refused === false);
})();

(function () {
  /* A phrase can have a well-measured root and still be a poor thing to
     set one corpseRoot from. The detector must SAY that rather than hide
     it behind a confident number. */
  var single = CR.detectRoot(note(220, 2.2, {}), SR);
  var many = CR.detectRoot(join(note(220, 0.6, {}), note(277, 0.6, {}), note(330, 0.6, {}), note(262, 0.6, {})), SR);
  ok('a single note reports noteCount 1', single.noteCount === 1, 'got ' + single.noteCount);
  ok('a phrase reports more', many.noteCount > 1, 'got ' + many.noteCount);
  ok('and a phrase is LESS confident than a single note',
     many.confidence < single.confidence,
     single.confidence.toFixed(2) + ' vs ' + many.confidence.toFixed(2));
  ok('and says which note it measured', /longest of/.test(many.why), many.why);
})();

(function () {
  var r = CR.detectRoot(new Float64Array(50), SR);
  ok('a body too short to examine is refused, not guessed', r.refused === true);
  ok('and returns a zero root rather than nonsense', r.hz === 0 && r.corpseRoot === 0);
})();

// ===================================================================
sec('V. What this does NOT claim');

console.log([
  '  · Nothing in NECROPHONE was changed. This measures a candidate; whether',
  '    to swap detectors is a separate decision with its own risk.',
  '  · The bodies are synthesized. A real piano sample has a soundboard, a',
  '    room and a recording chain, none of which are here.',
  '  · "Wins" counts cases where one detector beat the other by more than two',
  '    cents. It is a description of eight bodies, not a benchmark.',
  '  · detectPitchHz is doing exactly what it says: a quarter second from the',
  '    middle, cheaply. Where it loses, it loses to more work, not to a',
  '    better idea about autocorrelation.'
].join('\n'));

// ===================================================================
console.log('\n' + '='.repeat(66));
console.log('CORONER root detector — ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' checks');
if (fail) { console.log('\nfailures:'); failures.forEach(function (f) { console.log('  · ' + f); }); }
console.log('='.repeat(66));
process.exit(fail ? 1 : 0);
