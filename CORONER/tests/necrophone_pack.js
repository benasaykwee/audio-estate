/* ===================================================================
   CORONER — the NECROPHONE pack gate
   tests/necrophone_pack.js

   CORONER reproduces two of NECROPHONE's formats rather than importing
   them: the corpse codec and the `pack-1.0` document. That is the right
   call for portability and the wrong call for safety, unless the two
   copies are held together by something. This is that something.

   THE METHOD, which is the estate's and not mine: lift NECROPHONE's REAL
   functions out of `necrophone.html` as text by brace-matching, evaluate
   them, and run them against CORONER's ports. Not a reimplementation of
   the check — the actual shipped code, on both sides.

   `js_pack.js` in NECROPHONE does the same thing for its C++ twin, and
   the release-check lesson applies here too: a naive regex extract is
   the thing that false-alarms. Match braces, do not guess.

   Run:  node tests/necrophone_pack.js
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

// ===================================================================
// LIFT — pull real functions out of necrophone.html by brace matching
// ===================================================================

require('./_requires.js').requires({
  name: "the NECROPHONE pack gate",
  files: [NECRO_HTML],
  because: 'NECROPHONE is deliberately not in the estate repository — the root .gitignore is an allowlist, and its own comment explains that a workflow without its sources is a job that can only fail.',
  gates: [
    "that CORONER's corpse codec is byte-exact against NECROPHONE's own encoder",
    "that a CORONER pack is accepted by NECROPHONE's REAL decodePack",
    "that the corpse audio actually travels inside the pack",
    "that an asymmetric i16 scale has not been quietly 'tidied' to a symmetric one"
  ]
});
var HTML = fs.readFileSync(NECRO_HTML, 'utf8');

/* Extract `function NAME(...) { ... }` by counting braces from the opening
   one. Brace counting rather than a regex, because a regex that stops at
   the first `}` stops inside the first nested block and returns something
   that parses and is wrong. */
function lift(name) {
  var sig = 'function ' + name + '(';
  var at = HTML.indexOf(sig);
  if (at < 0) return null;
  var open = HTML.indexOf('{', at);
  if (open < 0) return null;
  var depth = 0, i = open;
  for (; i < HTML.length; i++) {
    var ch = HTML[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HTML.slice(at, i);
}

var WANT = ['compressCorpseArr', 'decodePack', 'normalizePackMeta', 'packPatchKeys',
            'packSigil', 'hashString', 'packSummary'];
var sources = {}, missing = [];
WANT.forEach(function (n) {
  var src = lift(n);
  if (src) sources[n] = src; else missing.push(n);
});

sec('0. Lifting the real functions out of necrophone.html');
ok('every function this gate needs was found', missing.length === 0, 'missing ' + missing.join(','));
if (missing.length) {
  /* A genuine failure, not a skip: necrophone.html IS present and does
     not contain what this gate needs. That means the format moved. */
  console.log('\nnecrophone.html is present but these functions are gone — the format has moved.');
  process.exit(1);
}

/* Indirect eval, so declarations land in the global scope. A direct
   `eval()` in strict mode keeps them to itself — the trap NECROPHONE's
   own pack generator hit and recorded. */
var NECRO = {};
(function () {
  var bundle = WANT.map(function (n) { return sources[n]; }).join('\n');
  // packSigil calls hashString; declaration order does not matter for
  // function declarations, but the dependency is why hashString is lifted.
  var factory = new Function(bundle + '\nreturn {' +
    WANT.map(function (n) { return n + ':' + n; }).join(',') + '};');
  NECRO = factory();
})();
ok('they evaluate and expose themselves', typeof NECRO.compressCorpseArr === 'function' &&
   typeof NECRO.decodePack === 'function');

// ===================================================================
// I. THE CORPSE CODEC — byte for byte
// ===================================================================
sec('I. The corpse codec, byte for byte');

function Dice(seed) {
  var s = seed >>> 0 || 1;
  this.next = function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  this.bi = function () { return this.next() * 2 - 1; };
}

var CASES = [
  { name: 'a plain sine at 48k',    n: 48000, sr: 48000, f: function (i) { return NM.sin(2 * Math.PI * 220 * i / 48000); } },
  { name: 'a plain sine at 44.1k',  n: 44100, sr: 44100, f: function (i) { return NM.sin(2 * Math.PI * 220 * i / 44100); } },
  { name: 'a rate BELOW the target', n: 8000, sr: 8000,  f: function (i) { return NM.sin(2 * Math.PI * 110 * i / 8000); } },
  { name: 'full-scale positive',    n: 4000,  sr: 48000, f: function () { return 1; } },
  { name: 'full-scale negative',    n: 4000,  sr: 48000, f: function () { return -1; } },
  { name: 'over the rails, both ways', n: 4000, sr: 48000, f: function (i) { return i % 2 ? 4.5 : -4.5; } },
  { name: 'a single sample',        n: 1,     sr: 48000, f: function () { return 0.5; } },
  { name: 'silence',                n: 4000,  sr: 48000, f: function () { return 0; } },
  { name: 'negative zero',          n: 4000,  sr: 48000, f: function () { return -0; } }
];

CASES.forEach(function (c) {
  var buf = new Float64Array(c.n);
  for (var i = 0; i < c.n; i++) buf[i] = c.f(i);
  var mine = CR.compressCorpse(buf, c.sr);
  var theirs = NECRO.compressCorpseArr(buf, c.sr);
  ok(c.name + ' encodes identically',
     !!mine && !!theirs && mine.data === theirs.data && mine.rate === theirs.rate && mine.enc === theirs.enc,
     mine && theirs ? ('lengths ' + mine.data.length + ' vs ' + theirs.data.length) : 'one side returned null');
});

(function () {
  /* NaN and a read past the end both go through `|| 0`. Worth its own case
     because `isFinite` would be the obvious "improvement" and would change
     the bytes on -0. */
  var buf = new Float64Array(2000);
  for (var i = 0; i < buf.length; i++) buf[i] = (i % 7 === 0) ? NaN : Math.sin(i * 0.01);
  ok('NaN is handled identically', CR.compressCorpse(buf, 48000).data === NECRO.compressCorpseArr(buf, 48000).data);
})();

(function () {
  var d = new Dice(4242), buf = new Float64Array(30000);
  for (var i = 0; i < buf.length; i++) buf[i] = d.bi();
  ok('30,000 samples of noise encode identically',
     CR.compressCorpse(buf, 48000).data === NECRO.compressCorpseArr(buf, 48000).data);
})();

(function () {
  ok('an empty buffer is refused by both', CR.compressCorpse(new Float64Array(0), 48000) === null &&
     NECRO.compressCorpseArr(new Float64Array(0), 48000) === null);
  ok('and so is nothing at all', CR.compressCorpse(null, 48000) === null &&
     NECRO.compressCorpseArr(null, 48000) === null);
})();

(function () {
  /* PROVE THE GATE BITES. If the asymmetric scale were "tidied" to a single
     32767, the two would disagree — and this asserts that they would, so a
     future simplification cannot pass silently. */
  var buf = new Float64Array(1000);
  for (var i = 0; i < buf.length; i++) buf[i] = -1;
  var sym = (function () {
    var outLen = Math.max(1, Math.floor(1000 / 3)), i16 = new Int16Array(outLen);
    for (var k = 0; k < outLen; k++) i16[k] = -1 * 32767;   // the "tidy" version
    return Buffer.from(new Uint8Array(i16.buffer)).toString('base64');
  })();
  ok('a symmetric scale WOULD disagree, so this gate is load-bearing',
     CR.compressCorpse(buf, 48000).data !== sym);
})();

// ===================================================================
// II. THE PACK — NECROPHONE's real decoder must accept ours
// ===================================================================
sec("II. The pack — NECROPHONE's real decoder must accept ours");

var SR = 22050;
function body(f0, dur) {
  var n = Math.floor(dur * SR), out = new Float64Array(n), ph = 0;
  for (var i = 0; i < n; i++) {
    ph += 2 * Math.PI * f0 / SR;
    var s = 0;
    for (var k = 1; k <= 12; k++) s += (1 / k) * NM.sin(ph * k);
    out[i] = s;
  }
  var pk = 0;
  for (i = 0; i < n; i++) { var a = Math.abs(out[i]); if (a > pk) pk = a; }
  if (pk > 0) for (i = 0; i < n; i++) out[i] /= pk;
  return out;
}

var samples = body(196, 1.6);
var report = CR.autopsy(samples, SR);
var pack = CR.necrophonePack(report.slip, { samples: samples, sr: SR, name: 'test body', report: report });

ok('a pack is produced for a NECROPHONE slip', !!pack);
ok('it declares pack-1.0', pack && pack.necrophone === 'pack-1.0');

var decoded = NECRO.decodePack(JSON.stringify(pack));
ok("NECROPHONE's REAL decodePack accepts it", !!decoded, 'returned null — the pack would be silently refused');

if (decoded) {
  ok('exactly one patch survives', decoded.patches.length === 1, 'got ' + decoded.patches.length);
  var p = decoded.patches[0];
  ok('the engine survived', p.params.engine === report.slip.params.engine,
     p.params.engine + ' vs ' + report.slip.params.engine);
  ok('corpseRoot survived', p.params.corpseRoot === report.slip.params.corpseRoot);

  var lost = Object.keys(report.slip.params).filter(function (k) { return !(k in p.params); });
  ok('no parameter was dropped in transit', lost.length === 0, lost.join(','));

  /* THE WHOLE POINT OF THE PACK. */
  ok('THE CORPSE TRAVELS WITH IT', typeof p.material === 'string' && p.material.length > 0,
     'no material on the patch — the root offset would land on the wrong sample');
  ok('and declares its encoding', p.materialEnc === 'i16');
  ok('and its rate', p.materialRate === 16000);
  ok('and a name', typeof p.materialName === 'string' && p.materialName.length > 0);

  ok('the carried audio is byte-identical to the codec output',
     p.material === CR.compressCorpse(samples, SR).data);

  ok('the pack summary sees the corpse', /carrying/.test(NECRO.packSummary(decoded)),
     NECRO.packSummary(decoded));
}

(function () {
  /* Without audio the pack must still be valid, and must SAY that the root
     refers to material it is not carrying — a silent omission here is the
     fault this whole task exists to close. */
  var slipOnly = CR.necrophonePack(report.slip, { name: 'no audio' });
  var d2 = NECRO.decodePack(JSON.stringify(slipOnly));
  ok('a pack with no audio is still accepted', !!d2);
  ok('and carries no material rather than an empty one', d2 && !d2.patches[0].material);
  ok('and says so in its description', d2 && /does not have/.test(d2.description), d2 && d2.description);
})();

(function () {
  var pb = CR.autopsy(body(45, 1.6), SR);
  if (pb.slip.target === 'PALLBEARER') {
    ok('a PALLBEARER slip yields no NECROPHONE pack', CR.necrophonePack(pb.slip) === null);
  } else {
    ok('a PALLBEARER slip yields no NECROPHONE pack (routed elsewhere, skipped)', true);
  }
})();

(function () {
  /* No clock is read anywhere in the core, so the same input must produce
     the same bytes. A timestamp here would make every regression baseline
     in this project impossible. */
  var a = JSON.stringify(CR.necrophonePack(report.slip, { samples: samples, sr: SR, name: 'x', report: report }));
  var b = JSON.stringify(CR.necrophonePack(report.slip, { samples: samples, sr: SR, name: 'x', report: report }));
  ok('two packs of the same body are byte-identical', a === b);
  ok('and created is 0, not a timestamp', JSON.parse(a).created === 0);
})();

(function () {
  /* A hostile name must not escape the format. decodePack trims and caps;
     confirm our side does not hand it something it has to rescue. */
  var nasty = CR.necrophonePack(report.slip, { name: '   ' + 'x'.repeat(400) + '\n\n<script>' });
  ok('a hostile name is trimmed before it is sent', nasty.patches[0].name.length <= 72,
     'length ' + nasty.patches[0].name.length);
  var d3 = NECRO.decodePack(JSON.stringify(nasty));
  ok('and the decoder still accepts it', !!d3);
  ok('and agrees on the trimmed name', d3 && d3.patches[0].name === nasty.patches[0].name);
})();

// ===================================================================
console.log('\n' + '='.repeat(66));
console.log('CORONER pack gate — ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' checks');
if (fail) { console.log('\nfailures:'); failures.forEach(function (f) { console.log('  · ' + f); }); }
console.log('='.repeat(66));
process.exit(fail ? 1 : 0);
