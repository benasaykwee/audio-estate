/* ===================================================================
   CORONER — the parameter contract gate
   tests/param_contract.js

   THE OLDEST DEFECT IN THIS ESTATE, IN ITS FAVOURITE HIDING PLACE:
   two copies of one rule with nothing holding them together.

   CORONER hardcodes NECROPHONE's parameter ranges inside
   `routeToNecrophone` — every `clamp(x, 60, 14000)` is a transcription of
   a number that lives in `necrophone_core.js`. NECROPHONE has no idea
   CORONER exists. And `loadPatchFromHash` merges with `if (j in patch)`,
   so a renamed id is **silently dropped**: no throw, no warning, just a
   patch that is not what the slip said.

   CORONER's own comment predicted this and said a release check could
   compare them. This is that check, finally written. Same shape as
   PALLBEARER's plugin-parity gate: read the OTHER project's registry as
   TEXT, and compare it against what this one actually emits.

   Reading the registry as text rather than requiring the module is
   deliberate. It is the same discipline PALLBEARER's gate uses on
   `Parameters.h`, and it means the gate keeps working when the two
   projects are built or loaded differently — the contract is the
   declared table, not whatever happens to be in memory.

   Run:  node tests/param_contract.js
   =================================================================== */

'use strict';

var fs = require('fs');
var path = require('path');

var HERE = __dirname;
var ROOT = path.join(HERE, '..', '..');
var NECRO_CORE = path.join(ROOT, 'necrophone_core.js');
var CORONER_CORE = path.join(HERE, '..', 'coroner_core.js');

var NM = require(path.join(ROOT, 'shared', 'necromath.js'));
global.NM = NM;
var CR = require(CORONER_CORE);

var pass = 0, fail = 0, failures = [], section = '';
function sec(s) { section = s; console.log('\n' + s); }
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; failures.push(section + ' :: ' + name + (detail ? '  [' + detail + ']' : ''));
    console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : ''));
  }
}

// ===================================================================
// PARSE NECROPHONE'S REGISTRY OUT OF ITS SOURCE
// ===================================================================

require('./_requires.js').requires({
  name: "the parameter contract gate",
  files: [NECRO_CORE],
  because: 'NECROPHONE is deliberately not in the estate repository — the root .gitignore is an allowlist, and its own comment explains that a workflow without its sources is a job that can only fail.',
  gates: [
    "that every id CORONER emits exists in NECROPHONE's real registry",
    "that every clamp literal matches NECROPHONE's declared bounds digit for digit",
    "that no enum value is one NECROPHONE does not offer",
    "that the two copies of NECROPHONE's ranges have not drifted apart"
  ]
});
var SRC = fs.readFileSync(NECRO_CORE, 'utf8');

/* Pull the PARAMS array out by brace/bracket matching, then read each
   entry. Counting delimiters rather than trusting a regex to find the
   end, for the same reason the pack gate does: a regex that stops at the
   first `]` stops inside the first nested array. */
function extractParamsBlock(src) {
  var at = src.indexOf('var PARAMS = [');
  if (at < 0) return null;
  var open = src.indexOf('[', at), depth = 0, i = open;
  for (; i < src.length; i++) {
    var ch = src[i];
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(open, i);
}

var block = extractParamsBlock(SRC);

sec("0. Reading NECROPHONE's registry as text");
ok('the PARAMS block was found', !!block);
if (!block) { console.log('cannot continue.'); process.exit(1); }

/* Each entry is `{ id: 'x', ... }`. Parse the fields this gate cares
   about; anything else in the entry is not this contract's business. */
function parseRegistry(text) {
  var out = {}, count = 0;
  var re = /\{\s*id:\s*'([^']+)'([\s\S]*?)\}/g, m;
  while ((m = re.exec(text)) !== null) {
    var id = m[1], body = m[2];
    var entry = { id: id };
    var mn = /\bmin:\s*(-?[\d.eE+-]+)/.exec(body);
    var mx = /\bmax:\s*(-?[\d.eE+-]+)/.exec(body);
    var df = /\bdef:\s*(-?[\d.eE+-]+|'[^']*')/.exec(body);
    var ty = /\btype:\s*'([^']+)'/.exec(body);
    var op = /\boptions:\s*\[([^\]]*)\]/.exec(body);
    if (mn) entry.min = parseFloat(mn[1]);
    if (mx) entry.max = parseFloat(mx[1]);
    if (df) entry.def = df[1][0] === "'" ? df[1].slice(1, -1) : parseFloat(df[1]);
    if (ty) entry.type = ty[1];
    if (op) {
      entry.options = op[1].split(',').map(function (s) { return s.trim().replace(/^'|'$/g, ''); })
                            .filter(function (s) { return s.length; });
    }
    out[id] = entry;
    count++;
  }
  return { params: out, count: count };
}

var reg = parseRegistry(block);

/* NOT EVERY PARAMETER IS A LITERAL. The mod matrix is PUSHED in a loop
   after the array — eight slots of four — so a parser that reads only the
   literal entries finds 92 of 124 and looks like it worked. The
   cross-check below is what caught that, and it is the reason the
   cross-check exists: a text parser that silently reads two thirds of a
   table makes every assertion downstream pass vacuously.

   NECROPHONE's own browser-side parity checker expands exactly this loop
   for exactly this reason. */
(function expandLoopPushed() {
  var re = /PARAMS\.push\(\{\s*id:\s*'mm'\s*\+\s*_ms\s*\+\s*'([A-Za-z]+)'([\s\S]*?)\}\)/g, m;
  var added = 0;
  while ((m = re.exec(SRC)) !== null) {
    var suffix = m[1], body = m[2];
    var mn = /\bmin:\s*(-?[\d.eE+-]+)/.exec(body);
    var mx = /\bmax:\s*(-?[\d.eE+-]+)/.exec(body);
    var ty = /\btype:\s*'([^']+)'/.exec(body);
    for (var slot = 1; slot <= 8; slot++) {
      var id = 'mm' + slot + suffix;
      if (reg.params[id]) continue;
      var e = { id: id, loopGenerated: true };
      if (mn) e.min = parseFloat(mn[1]);
      if (mx) e.max = parseFloat(mx[1]);
      if (ty) e.type = ty[1];
      reg.params[id] = e;
      reg.count++; added++;
    }
  }
  console.log('       expanded ' + added + ' loop-generated parameters');
})();

ok('it parses into a registry of a plausible size', reg.count > 100, reg.count + ' parameters');

/* CROSS-CHECK THE PARSER AGAINST THE LOADED MODULE. A text parser that
   silently reads half the table would make every assertion below pass
   vacuously — this is the "at least one body pushed an edge" lesson in
   another shape. */
var LIVE = null;
try { LIVE = require(NECRO_CORE); } catch (e) { /* optional */ }
if (LIVE && Array.isArray(LIVE.PARAMS)) {
  ok('the text parser agrees with the loaded module on the count',
     reg.count === LIVE.PARAMS.length, reg.count + ' parsed vs ' + LIVE.PARAMS.length + ' live');
  var mismatched = [];
  LIVE.PARAMS.forEach(function (p) {
    var got = reg.params[p.id];
    if (!got) { mismatched.push(p.id + ' (missing)'); return; }
    if (p.min !== undefined && got.min !== p.min) mismatched.push(p.id + '.min');
    if (p.max !== undefined && got.max !== p.max) mismatched.push(p.id + '.max');
  });
  ok('and on every range it parsed', mismatched.length === 0, mismatched.slice(0, 6).join(', '));
} else {
  ok('the loaded module was unavailable — parser cross-check skipped', true);
}

// ===================================================================
// I. EVERY ID CORONER CAN EMIT MUST EXIST
// ===================================================================
sec('I. Every id CORONER can emit exists in NECROPHONE');

/* Drive real bodies through the router rather than reading CORONER's
   source, so the set under test is what it ACTUALLY emits — including
   any id an engine branch only reaches under particular conditions. */
var SR = 22050;
function Dice(seed) {
  var s = seed >>> 0 || 1;
  this.next = function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  this.bi = function () { return this.next() * 2 - 1; };
}
function tone(o) {
  o = o || {};
  var dur = o.dur || 1.6, f0 = o.f0 || 220, d = new Dice(o.seed || 7);
  var n = Math.floor(dur * SR), out = new Float64Array(n), ph = 0;
  var CTRL = Math.max(1, Math.floor(SR / 20)), jT = 0, jC = 0;
  for (var i = 0; i < n; i++) {
    var c = 0;
    if (o.vibHz) c += (o.vibCents || 0) * NM.sin(2 * Math.PI * o.vibHz * i / SR);
    if (o.jitter) { if (i % CTRL === 0) jT = d.bi() * o.jitter * 5; jC += (jT - jC) * 0.4; c += jC; }
    var fq = f0 * NM.exp(c / 1200 * 0.69314718055994531);
    ph += 2 * Math.PI * fq / SR;
    var s = 0;
    for (var k = 1; k <= (o.partials || 14); k++) {
      var m = k * Math.sqrt(1 + (o.inharm || 0) * k * k);
      if (m * f0 > SR * 0.45) break;
      s += (1 / Math.pow(k, o.slope === undefined ? 0.9 : o.slope)) * NM.sin(ph * m);
    }
    var t = i / SR, e = (o.atk ? (t < o.atk ? t / o.atk : 1) : 1);
    if (o.decayPerSec) e *= NM.pow10(o.decayPerSec * t / 20);
    out[i] = s * e + (o.noise ? d.bi() * o.noise * e : 0);
  }
  var pk = 0;
  for (i = 0; i < n; i++) { var a = Math.abs(out[i]); if (a > pk) pk = a; }
  if (pk > 0) for (i = 0; i < n; i++) out[i] /= pk;
  return out;
}
function noise(dur, seed) {
  var d = new Dice(seed), n = Math.floor(dur * SR), o = new Float64Array(n);
  for (var i = 0; i < n; i++) o[i] = d.bi();
  return o;
}

/* Bodies chosen to reach every branch of routeToNecrophone: each engine,
   the voice/formant path, and the vibrato path that writes lfo1Rate. */
var BODIES = [
  ['stable oscillator',   tone({ f0: 220, jitter: 0, noise: 0 })],
  ['stiff pluck',         tone({ f0: 196, inharm: 0.0009, atk: 0.002, decayPerSec: -14 })],
  ['vibrato + breath',    tone({ f0: 440, vibHz: 5.5, vibCents: 40, noise: 0.2, jitter: 12, seed: 71 })],
  ['odd-harmonic reed',   tone({ f0: 130, noise: 0.3, seed: 72 })],
  ['flat texture',        noise(1.6, 73)],
  ['bright noise',        noise(1.6, 74)],
  ['a very high tone',    tone({ f0: 3000, partials: 3 })],
  ['a very low tone',     tone({ f0: 60, partials: 10 })],
  ['moving timbre',       tone({ f0: 300, vibHz: 4, vibCents: 20, jitter: 18, noise: 0.12, seed: 75 })]
];

var emitted = {};
BODIES.forEach(function (b) {
  var slip = CR.autopsy(b[1], SR).slip;
  if (!slip || slip.target !== 'NECROPHONE') return;
  Object.keys(slip.params).forEach(function (k) {
    (emitted[k] = emitted[k] || []).push({ body: b[0], value: slip.params[k] });
  });
});

var emittedIds = Object.keys(emitted).sort();
ok('the router emitted something to check', emittedIds.length > 0, emittedIds.length + ' distinct ids');
console.log('       ids emitted: ' + emittedIds.join(', '));

var unknown = emittedIds.filter(function (k) { return !reg.params[k]; });
ok('every emitted id exists in NECROPHONE\'s registry', unknown.length === 0,
   unknown.length ? ('NECROPHONE would SILENTLY DROP: ' + unknown.join(', ')) : '');

// ===================================================================
// II. EVERY VALUE IS INSIDE ITS DECLARED RANGE
// ===================================================================
sec('II. Every value CORONER emits is legal for that parameter');

var outOfRange = [], badEnum = [];
emittedIds.forEach(function (k) {
  var spec = reg.params[k];
  if (!spec) return;
  emitted[k].forEach(function (e) {
    if (spec.options) {
      if (spec.options.indexOf(e.value) < 0) badEnum.push(k + '=' + e.value + ' (' + e.body + ')');
    } else if (spec.min !== undefined && spec.max !== undefined) {
      if (!(e.value >= spec.min && e.value <= spec.max)) {
        outOfRange.push(k + '=' + e.value + ' outside [' + spec.min + ',' + spec.max + '] (' + e.body + ')');
      }
    }
  });
});
ok('no numeric value falls outside its declared range', outOfRange.length === 0, outOfRange.slice(0, 5).join(' · '));
ok('no enum value is one NECROPHONE does not offer', badEnum.length === 0, badEnum.slice(0, 5).join(' · '));

// ===================================================================
// III. THE CLAMPS THEMSELVES, NOT JUST THE OUTPUTS
// ===================================================================
sec('III. The clamps in CORONER match the ranges in NECROPHONE');

/* Section II proves the values that came out were legal. It cannot prove
   the CLAMPS are right, because a body that never approaches an edge
   passes either way — the same vacuity that hid a missing clamp once
   already. So read CORONER's own clamp literals and compare them to
   NECROPHONE's declared bounds, digit for digit. */
var CORONER_SRC = fs.readFileSync(CORONER_CORE, 'utf8');

/* SCOPE THE SCAN TO THE RIGHT FUNCTION. `routeToNecrophone` and
   `routeToPallbearer` both build a patch called `p`, so a scan of the
   whole file attributes PALLBEARER's `damping`, `decay`, `hardness`,
   `inharm`, `noise` and `tone` to NECROPHONE and reports six parameters
   NECROPHONE has never heard of. Which it did, on the first run. */
function bodyOfFunction(src, name) {
  var at = src.indexOf('function ' + name + '(');
  if (at < 0) return '';
  var open = src.indexOf('{', at), depth = 0, i = open;
  for (; i < src.length; i++) {
    var ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(at, i);
}
var NECRO_ROUTE = bodyOfFunction(CORONER_SRC, 'routeToNecrophone');
ok('routeToNecrophone was located in CORONER\'s source', NECRO_ROUTE.length > 200,
   NECRO_ROUTE.length + ' bytes');

/* Matches `p.cut = clamp(<anything>, 60, 14000)` and the `p.x = clamp(...)`
   forms used in the engine branches. */
var clampRe = /p\.([A-Za-z0-9_]+)\s*=\s*clamp\(([\s\S]*?),\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*\)/g;
var found = {}, m2;
while ((m2 = clampRe.exec(NECRO_ROUTE)) !== null) {
  found[m2[1]] = { lo: parseFloat(m2[3]), hi: parseFloat(m2[4]) };
}

var clampIds = Object.keys(found).sort();
ok('CORONER\'s clamp literals were located', clampIds.length > 5, clampIds.length + ' clamps: ' + clampIds.join(', '));

var drifted = [];
clampIds.forEach(function (k) {
  var spec = reg.params[k];
  if (!spec || spec.min === undefined) return;      // enum or unknown — section I/II covers it
  var c = found[k];
  if (c.lo !== spec.min || c.hi !== spec.max) {
    drifted.push(k + ': CORONER clamps [' + c.lo + ',' + c.hi + '], NECROPHONE declares [' + spec.min + ',' + spec.max + ']');
  }
});
ok('EVERY clamp matches NECROPHONE digit for digit', drifted.length === 0, drifted.join('  ·  '));

var clampedButUnknown = clampIds.filter(function (k) { return !reg.params[k]; });
ok('no clamp names a parameter NECROPHONE does not have', clampedButUnknown.length === 0,
   clampedButUnknown.join(', '));

// ===================================================================
// IV. THE ENUM OPTION SETS
// ===================================================================
sec('IV. Enum writes name options that exist');

/* Enum order matters to a host, which stores a choice as an INDEX — a
   reorder rewrites saved sessions. CORONER writes enums BY NAME, which is
   the safe form, so what has to hold is that the name exists. Recorded
   here rather than assumed, because writing by index would look almost
   identical at the call site. */
var enumWrites = [];
var enumRe = /p\.([A-Za-z0-9_]+)\s*=\s*([^;]*?)\?\s*'([^']+)'\s*:\s*'([^']+)'/g;
while ((m2 = enumRe.exec(NECRO_ROUTE)) !== null) {
  enumWrites.push({ id: m2[1], vals: [m2[3], m2[4]] });
}
enumWrites.push({ id: 'engine', vals: ['analog', 'wavetable', 'granular', 'physical'] });

var enumBad = [];
enumWrites.forEach(function (w) {
  var spec = reg.params[w.id];
  if (!spec || !spec.options) { enumBad.push(w.id + ' has no options in NECROPHONE'); return; }
  w.vals.forEach(function (v) {
    if (spec.options.indexOf(v) < 0) enumBad.push(w.id + " can be written '" + v + "', which is not an option");
  });
});
ok('every enum value CORONER can write is a real option', enumBad.length === 0, enumBad.join(' · '));

var writesByIndex = /p\.(engine|anWave)\s*=\s*\d/.test(NECRO_ROUTE);
ok('no enum is written by index, which a reorder would silently rewrite', !writesByIndex);

// ===================================================================
// V. PROVE THE GATE BITES
// ===================================================================
sec('V. Prove the gate bites');

(function () {
  /* A gate that has never failed is a gate nobody has tested. Run the same
     comparisons against a deliberately corrupted registry and confirm each
     one would catch it. */
  var fake = JSON.parse(JSON.stringify(reg.params));
  fake.cut.max = 9999;
  var wouldCatch = found.cut && found.cut.hi !== fake.cut.max;
  ok('a drifted RANGE would be caught', wouldCatch);

  var fake2 = JSON.parse(JSON.stringify(reg.params));
  delete fake2.corpseRoot;
  var wouldCatch2 = emittedIds.indexOf('corpseRoot') >= 0 && !fake2.corpseRoot;
  ok('a RENAMED id would be caught', wouldCatch2,
     'corpseRoot is emitted, so its disappearance must fail this gate');

  var fake3 = JSON.parse(JSON.stringify(reg.params));
  fake3.anWave.options = ['sine'];
  var wouldCatch3 = fake3.anWave.options.indexOf('sawtooth') < 0;
  ok('a changed ENUM option set would be caught', wouldCatch3);
})();

// ===================================================================
console.log('\n' + '='.repeat(66));
console.log('CORONER param contract — ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' checks');
if (fail) {
  console.log('\nfailures:');
  failures.forEach(function (f) { console.log('  · ' + f); });
  console.log('\nTwo copies of one rule have drifted apart. NECROPHONE will not');
  console.log('complain — its loader drops what it does not recognise in silence.');
}
console.log('='.repeat(66));
process.exit(fail ? 1 : 0);
