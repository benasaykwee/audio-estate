/* ===================================================================
   CORONER — the PALLBEARER link gate
   tests/pallbearer_link.js

   CORONER's README has always promised that a report ends in a click
   through to NECROPHONE **or PALLBEARER** with a patch already waiting.
   For months that was true of one of the two names: PALLBEARER had no
   hash reader, so a correct and fully measured patch was computed and
   then handed to the user as JSON to paste into a console.

   PALLBEARER built the reader on 2026-09-01. This gate holds the seam
   from CORONER's side the same way the NECROPHONE gates do: by lifting
   PALLBEARER's REAL `loadPatchFromHash` and `b64urlDecode` out of
   `pallbearer.html` and round-tripping a live slip through them. Not a
   reimplementation of the check — the actual shipped reader.

   Run:  node tests/pallbearer_link.js
   =================================================================== */

'use strict';

var fs = require('fs');
var path = require('path');

var HERE = __dirname;
var ROOT = path.join(HERE, '..', '..');
var PB_HTML = path.join(ROOT, 'PALLBEARER', 'pallbearer.html');

var NM = require(path.join(ROOT, 'shared', 'necromath.js'));
global.NM = NM;
var CR = require(path.join(HERE, '..', 'coroner_core.js'));

require('./_requires.js').requires({
  name: "the PALLBEARER link gate",
  files: [PB_HTML],
  because: "PALLBEARER is in the estate repository, so this should normally run — if it is skipping, the checkout is partial rather than the project absent.",
  gates: [
    "that a CORONER link is accepted by PALLBEARER's REAL loadPatchFromHash",
    "that every parameter in the slip survives the trip",
    "that the v:1 stamp PALLBEARER refuses an unknown value of is present"
  ]
});

var pass = 0, fail = 0, failures = [], section = '';
function sec(s) { section = s; console.log('\n' + s); }
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; failures.push(section + ' :: ' + name + (detail ? '  [' + detail + ']' : ''));
    console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : ''));
  }
}

var HTML = fs.readFileSync(PB_HTML, 'utf8');

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

sec("0. Lifting PALLBEARER's real reader");
var srcDecode = lift('b64urlDecode');
ok('b64urlDecode was found in pallbearer.html', !!srcDecode);
if (!srcDecode) { console.log('cannot continue.'); process.exit(1); }
var b64urlDecode = (new Function(srcDecode + '\nreturn b64urlDecode;'))();
ok('and it runs', typeof b64urlDecode === 'function');

/* `loadPatchFromHash` touches `location`, `PBm`, `node`, `say`, `buildBoard`
   and `syncWidgets`, so it is exercised through a stub environment rather
   than called bare. The DECODE and VERSION logic — the parts that decide
   whether a CORONER link is readable at all — are the real ones. */
var srcLoad = lift('loadPatchFromHash');
ok('loadPatchFromHash was found', !!srcLoad);
ok('it reads the #p= shape CORONER writes', /\[#&\]p=/.test(srcLoad), 'pattern not found');
ok('and it refuses an unknown major version rather than half-loading',
   /o\.v\s*!==\s*1/.test(srcLoad), 'no version refusal found');

// ===================================================================
sec('I. A live slip survives the round trip through their decoder');

var SR = 44100;

function Dice(seed) {
  var s = seed >>> 0 || 1;
  this.next = function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  this.bi = function () { return this.next() * 2 - 1; };
}

/* A plucked string that CORONER will actually route to PALLBEARER.

   Getting one takes care, and the reason is a real property of the fork
   rather than a quirk of this file. The route needs `klass === 'plucked'`,
   which needs MEASURED stiffness, which needs surviving high partials —
   and a bass note is exactly where high partials die soonest. An earlier
   draft of this body used a per-partial decay of 0.5 dB/s/partial, which
   is physically reasonable and left the fit at 0.31, so the stiffness was
   refused, the verdict came back `synthetic`, and the body went to
   NECROPHONE.

   Swept across 105 combinations of pitch, pluck position and stiffness,
   34 route to PALLBEARER — and every one of those measures its stiffness
   accurately (fit 0.89 to 1.00, B within a few percent of what was built
   in). The fork is selective rather than unreliable: it sends the bass
   instrument only bodies whose physicality it could actually confirm.
   That is the behaviour CORONER wants, and it is worth knowing that it
   means a real bass with a dull, fast-decaying tone may well be routed to
   the synthesizer instead. */
function pluck(f0, p, dur, o) {
  o = o || {};
  var n = Math.floor(dur * SR), out = new Float64Array(n), ph = 0;
  var d = new Dice(o.seed || 21), amps = [];
  for (var k = 1; k <= 32; k++) {
    amps.push(k * f0 > SR * 0.45 ? 0 : Math.abs(NM.sin(k * Math.PI * p)) / (k * k));
  }
  for (var i = 0; i < n; i++) {
    ph += 2 * Math.PI * f0 / SR;
    var s = 0;
    for (var k2 = 1; k2 <= amps.length; k2++) {
      if (!amps[k2 - 1]) continue;
      var m = k2 * Math.sqrt(1 + (o.inharm || 0) * k2 * k2);
      s += amps[k2 - 1] * NM.sin(ph * m);
    }
    var t = i / SR, e = NM.pow10((o.decayPerSec === undefined ? -9 : o.decayPerSec) * t / 20);
    out[i] = s * e + (o.noise ? d.bi() * o.noise * e : 0);
  }
  var pk = 0;
  for (i = 0; i < n; i++) { var a = Math.abs(out[i]); if (a > pk) pk = a; }
  if (pk > 0) for (i = 0; i < n; i++) out[i] /= pk;
  return out;
}

var rep = CR.autopsy(pluck(65, 0.13, 2.2, { inharm: 0.0006, noise: 0.02, seed: 21 }), SR);
ok('a low physical body routes to PALLBEARER', rep.slip.target === 'PALLBEARER',
   'routed to ' + rep.slip.target);

var link = CR.pallbearerLink(rep.slip);
ok('a link is produced', typeof link === 'string' && link.indexOf('#p=') > 0, String(link));

var m = link ? link.match(/[#&]p=([^&]+)/) : null;
ok("it matches PALLBEARER's own hash pattern", !!m);

/* Guarded rather than assumed. An earlier run of this file threw here
   because the body routed to NECROPHONE and `link` was null, which turned
   a clear failed assertion into a stack trace. A gate that crashes tells
   you less than one that fails. */
var o = m ? (function () { try { return JSON.parse(b64urlDecode(m[1])); } catch (e) { return null; } })() : null;
ok('their REAL b64urlDecode reads it', !!o && typeof o === 'object');
ok('it carries the v:1 stamp they check for', !!o && o.v === 1, o ? ('v=' + o.v) : 'nothing decoded');
ok('and a patch object', !!o && !!o.p && typeof o.p === 'object');

if (o && o.p) {
  var lost = Object.keys(rep.slip.params).filter(function (k) { return !(k in o.p); });
  ok('every parameter survived the trip', lost.length === 0, lost.join(','));
  console.log('       carried: ' + Object.keys(o.p).sort().join(', '));
} else {
  ok('every parameter survived the trip', false, 'nothing decoded');
}

// ===================================================================
sec('II. The link is refused where it should be');

ok('a NECROPHONE slip yields no PALLBEARER link',
   CR.pallbearerLink({ target: 'NECROPHONE', params: {} }) === null);
ok('and a PALLBEARER slip yields no NECROPHONE link',
   CR.necrophoneLink(rep.slip) === null);
ok('nothing at all yields nothing', CR.pallbearerLink(null) === null);

(function () {
  /* handoffLink exists so the test bed stops special-casing the fork. It
     must agree with whichever specific builder applies. */
  ok('handoffLink agrees with pallbearerLink on a PALLBEARER slip',
     CR.handoffLink(rep.slip) === CR.pallbearerLink(rep.slip));
  var nrep = CR.autopsy(pluck(220, 0.16, 1.8, { inharm: 0, noise: 0, decayPerSec: 0 }), SR);
  if (nrep.slip.target === 'NECROPHONE') {
    ok('and with necrophoneLink on a NECROPHONE slip',
       CR.handoffLink(nrep.slip) === CR.necrophoneLink(nrep.slip));
  } else {
    ok('and with necrophoneLink on a NECROPHONE slip (body routed elsewhere, skipped)', true);
  }
})();

// ===================================================================
sec('III. ⚠ `couple` is still not emitted — for a NEW reason');

(function () {
  /* THE PREREQUISITE IS MET. PALLBEARER fixed the self-oscillation on
     2026-09-01: the bus was the raw sum of every other string's bridge
     output, so loop gain scaled with string count. Dividing by (nStr - 1)
     fixed it, and their §XXIV gate now sweeps `couple` across its range on
     all six tunings and asserts decay. They explicitly left the decision
     to emit it with CORONER.

     CORONER still does not emit it, and the reason has CHANGED rather than
     persisted. It is no longer "that parameter is dangerous". It is:

         CORONER HAS NOTHING TO PUT IN IT.

     `couple` is sympathetic resonance between strings. CORONER measures
     stiffness and pluck position; neither maps to it. Sympathetic coupling
     would show as energy appearing at OTHER strings' pitches as a note
     decays, which is measurable in principle and is not built.

     Emitting a plausible-looking number for an unmeasured parameter is
     exactly what CORONER refused to do with pluck position, and the refusal
     does not get weaker because the receiving end got safer. When there is
     a measurement, this gate comes out. */
  var everSeen = false;
  [55, 65, 73, 82].forEach(function (f0) {
    [0.08, 0.13, 0.22, 0.30].forEach(function (pp) {
      var slip = CR.autopsy(pluck(f0, pp, 2.0, { inharm: 0.0006, noise: 0.02, seed: 30 }), SR).slip;
      if (slip && slip.target === 'PALLBEARER' && ('couple' in slip.params)) everSeen = true;
    });
  });
  ok('`couple` is not emitted, because nothing measures it', !everSeen,
     'a value was sent for a parameter CORONER does not measure');
})();

// ===================================================================
console.log('\n' + '='.repeat(66));
console.log('CORONER PALLBEARER link — ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' checks');
if (fail) { console.log('\nfailures:'); failures.forEach(function (f) { console.log('  · ' + f); }); }
console.log('='.repeat(66));
process.exit(fail ? 1 : 0);
