/* CASKET coverage census — which parts of this program is nobody watching?
   ============================================================
   Every other harness answers "is the code correct?". This asks a
   different, less comfortable question: "is there anything CASKET does
   that NOTHING checks?" RIGOR's rigor_coverage.js proved the shape of this
   out — it found a plugin that hadn't compiled for two rounds and an FFT
   with zero parity coverage, both while every existing test stayed green,
   because no test knew those things existed. A green suite only answers
   for what it was told to watch.

   This walks CASKET's state surface — every field defaultState() returns —
   and asks of each, mechanically, whether it is named in: the JS core, the
   C++ twin, the plugin (host-reachable), the browser instrument, and any
   test file. A blank is not automatically a bug — `meta` is not DSP, and
   `version`/`dustSeed` are deliberately not host parameters — but every
   blank should be there ON PURPOSE. This prints them so the decision gets
   made rather than defaulted into.

     node tests/casket_coverage.js            the matrix
     node tests/casket_coverage.js --strict   exit non-zero on an unexplained gap

   Caveat, stated rather than hidden: this is mechanical text search, not
   static analysis. A field read only through a helper (e.g. spread into an
   options object) can read as absent when it is not. Short field names
   (`ms`, `dc`, `sat`) are checked with a word-boundary regex to keep
   "ms" from matching inside "milliseconds" or a comment, but a search this
   simple can still be fooled. Treat a red row as a question to go answer
   by reading the code, not as a verdict on its own. */
'use strict';
var fs = require('fs');
var path = require('path');
var C = require('../casket_core.js');

var ROOT = path.join(__dirname, '..');
function read(p) { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (e) { return ''; } }

var SRC = {
  core: read('casket_core.js'),
  twin: read('casket-juce/Source/CasketCore.h'),
  proc: read('casket-juce/Source/PluginProcessor.cpp'),
  html: read('casket.html')
};
/* THE TEST LIST IS READ FROM DISK, NOT TYPED HERE — added 2026-08-18.
   It used to be a hand-maintained array, and by the time anyone looked it
   had already gone stale: casket_cpu_gate.js was missing, and so was
   casket_audit.js for the first hours of its life. That is the exact
   failure this file exists to catch, committed by this file, about itself.
   A census whose own list of watchers is hand-typed can only ever answer
   "is anything unwatched by the harnesses I remembered to name?" — which
   is not the question. Reading the directory means a new harness counts
   the moment it lands.

   NOT_A_TEST is the deliberate exclusion list, and each entry earns its
   place by NOT ASSERTING anything. The census asks "does something WATCH
   this field?", and a file that measures and prints without a pass/fail
   is not watching — it is describing. Counting one would let a field read
   as covered when nothing would go red if it broke. */
var NOT_A_TEST = {
  'casket_coverage.js':
    'this file — it names version/meta/dustSeed/autoRel in EXEMPT, so reading ' +
    'itself would make those four report as tested by their own excuse',
  'casket_bench.js':
    'a cost table; prints realtime factors, asserts nothing',
  'seal_experiment.js':
    'the §6.3 evidence rig — reports, does not assert, by design'
};
var TEST_FILES = fs.readdirSync(path.join(ROOT, 'tests'))
  .filter(function (f) {
    if (!/\.js$/.test(f)) return false;
    /* Harness scratch — every gitignored scratch name in this tree carries a
       DOUBLE underscore (`*.__mut.js`, `*.__probe.js`, `.__mut_test.js`,
       `__delete_probe_test.js`) and no real harness does, so one test covers
       all four patterns. Written as `__mut|__probe` first, which silently let
       `__delete_probe_test.js` through — it has only a single underscore
       before `probe` — and the census counted 21 harnesses where there are
       20. Caught by checking the printed count against `ls`, which is the
       only reason a filter this small was worth a second look. */
    if (/__/.test(f) || f.charAt(0) === '.') return false;
    return !NOT_A_TEST[f];
  })
  .sort();
var TESTS = TEST_FILES.map(function (f) { return read('tests/' + f); }).join('\n');

/* Deliberate exemptions — a decision on the record, not an oversight.
   Anything NOT listed here that comes up blank is what --strict fails on. */
var EXEMPT = {
  version:  { twin: 'the JS case-file version tag; the C++ twin has no case files',
              plugin: 'not a knob — a save-format tag, not a host parameter' },
  meta:     { twin: 'display-only text (name/note); not DSP', plugin: 'not a knob',
              html: 'read via the case-file loader, not the DSP path checked here' },
  dustSeed: { plugin: 'deliberately not a host parameter — a random dust seed exposed ' +
                       'to automation would make every render non-reproducible' },
  autoRel:  {} // present everywhere; placeholder shape kept for symmetry with RIGOR's file
};

var FIELDS = Object.keys(C.defaultState());

function has(text, field) {
  if (!text) return false;
  var re = new RegExp('\\b' + field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
  return re.test(text);
}

console.log('CASKET coverage census — ' + FIELDS.length + ' state fields, ' +
            TEST_FILES.length + ' asserting harnesses read from tests/\n');
var cols = ['core', 'twin', 'proc', 'html', 'tested'];
console.log('  ' + pad('field', 12) + cols.map(function (c) { return pad(c, 7); }).join(''));

var gaps = [];
FIELDS.forEach(function (f) {
  if (f === 'meta') return; // structural, not a scalar field — checked separately below
  var row = {
    core: has(SRC.core, f),
    twin: has(SRC.twin, f),
    proc: has(SRC.proc, f),
    html: has(SRC.html, f),
    tested: has(TESTS, f)
  };
  var marks = cols.map(function (c) { return pad(row[c] ? '✓' : '·', 7); });
  console.log('  ' + pad(f, 12) + marks.join(''));
  cols.forEach(function (c) {
    if (!row[c]) {
      var reason = EXEMPT[f] && EXEMPT[f][c === 'proc' ? 'plugin' : c];
      if (!reason) gaps.push(f + '.' + c);
    }
  });
});
/* meta is structural (an object with name/note), not a single identifier —
   checked once, not per the has() loop above */
['name', 'note'].forEach(function (sub) {
  if (!has(SRC.core, sub)) gaps.push('meta.' + sub + '.core');
});

/* ============================================================
   THE ENGINE SURFACE — added 2026-08-18.
   The field census above answers for STATE; this answers for the API.
   Everything casket_core.js exports is a promise somebody can call, and a
   promise can be unwatched the same way a field can: histogramS() lived
   for most of a day as an export whose deliberate absence from the C++
   twin was recorded nowhere until a test was written by hand. This makes
   that class of decision mechanical — every export is either present in
   the twin, or its absence has a written reason; either exercised by a
   test, or its excuse is on the record.
   Columns: twin (named in CasketCore.h) · html (the browser uses it) ·
   tested (any harness names it). `proc` is deliberately NOT a column —
   the plugin reaches the core THROUGH the twin, so twin coverage is what
   host-reachability means for an export. */
/* The twin is C++ and idiomatic C++ spells some of these differently.
   An alias is stronger than an exemption: a rename in the twin still gets
   caught, because the census would then find NEITHER spelling. */
var API_ALIAS = {
  sanitizeState: 'sanitize',       /* the twin's validator */
  styleDefaults: 'styleDef',       /* positional style table + accessor */
  createEngine:  'class Engine'    /* a class, not a factory */
};

/* Deliberate absences — a decision each, none of them "didn't get to it".
   First run of this census reported 12 candidate gaps; each below survived
   an actual check of the twin's source rather than a guess about it. */
var API_EXEMPT = {
  /* the twin mirrors anything that can change a SAMPLE; these cannot */
  histogramS:  { twin: 'diagnostic only, feeds THE RANGE canvas; asserted in the ' +
                       'NEGATIVE by casket_plugin_test.js (DIAGNOSTIC_ONLY)' },
  /* the JS state-shape surface — the plugin's state IS its parameter set,
     so the twin has sanitize() and needs none of the JS-side shape helpers */
  STYLES:      { twin: 'the set lives positionally in the twin\'s style table; a named JS array would be a second copy of a rule' },
  LININGS:     { twin: 'legal linings are enforced inside the twin\'s sanitize(), not as a named array' },
  DUSTS:       { twin: 'ditto — an enum in sanitize()' },
  DUST_BITS:   { twin: 'ditto' },
  defaultState:{ twin: 'the host\'s parameter defaults ARE the defaults; a second defaultState would be a copy that could drift' },
  /* browser-only workflows — no plugin surface by design */
  matchReference: { twin: 'offline advice against a reference file; browser-only, and unlike autoDrive/autoMargin it was never given a twin' },
  batchRender: { twin: 'the album pipeline lives in the browser' },
  albumMaster: { twin: 'ditto' },
  albumLoudness: { twin: 'ditto' },
  albumReport: { twin: 'ditto' },
  conformToRate: { twin: 'a plugin receives audio at the host rate by definition' },
  resample:    { twin: 'conformToRate\'s engine — same reason' },
  RS_Q:        { twin: 'the resampler\'s tap constant — travels with resample()',
                 tested: 'parameterises resample(), which casket_rate.js tests end-to-end; ' +
                         'the constant has no contract of its own to assert' },
  /* deterministic test-signal generators — harness surface */
  makeSquare:  { twin: 'test-signal generator the twin\'s harness does not need' },
  makeImpulses:{ twin: 'ditto' },
  /* escape hatches, private by convention */
  _nm:         { twin: 'hands tests the NM closure; not API' },
  _nd:         { twin: 'hands tests the ND closure; not API' }
};

var API = Object.keys(C).filter(function (k) { return k !== 'STYLE'; }); // STYLE is data, censused via styleDefaults
console.log('\nengine surface — ' + API.length + ' exports\n');
console.log('  ' + pad('export', 18) + ['twin', 'html', 'tested'].map(function (c) { return pad(c, 7); }).join(''));
var apiGaps = [];
API.forEach(function (fn) {
  var row = {
    twin: has(SRC.twin, fn) || (API_ALIAS[fn] ? SRC.twin.indexOf(API_ALIAS[fn]) >= 0 : false),
    html: has(SRC.html, fn),
    tested: has(TESTS, fn)
  };
  console.log('  ' + pad(fn, 18) +
              ['twin', 'html', 'tested'].map(function (c) { return pad(row[c] ? '✓' : '·', 7); }).join(''));
  ['twin', 'html', 'tested'].forEach(function (c) {
    if (!row[c] && !(API_EXEMPT[fn] && API_EXEMPT[fn][c])) apiGaps.push(fn + '.' + c);
  });
});

/* THE CENSUS MUST BITE — added 2026-08-19, the standard the other harnesses
   were held to first. Everything above is a mechanical text search, and a
   search that never matches passes exactly as quietly as one that always
   does. If `has()` were broken — a bad regex, an unreadable file, an empty
   TESTS blob — this file would report a clean sweep over nothing at all and
   look identical to a genuinely clean sweep.
   So: three probes. A field that cannot possibly be present must be
   reported absent; a field that certainly is present must be found; and the
   corpus each column searches must be non-empty, because searching an empty
   string finds nothing and calls it coverage. */
var proofs = [];
function proof(cond, what) { if (!cond) proofs.push(what); }

proof(has(SRC.core, 'drive') === true,
      'has() finds a field that is definitely in the core');
proof(has(SRC.core, 'zzz_not_a_field_' + Date.now()) === false,
      'has() rejects a field that cannot be there');
/* the word-boundary claim the header makes — `ms` must not match inside
   `milliseconds`, which is the whole reason short field names were called
   out as a risk */
proof(has('a milliseconds b', 'ms') === false,
      'has() respects word boundaries (ms does not match inside milliseconds)');
proof(has('a ms b', 'ms') === true, 'and still finds the real thing');
/* every corpus must be non-empty, or its column is vacuous */
['core', 'twin', 'proc', 'html'].forEach(function (k) {
  proof(SRC[k] && SRC[k].length > 500, 'the ' + k + ' source was actually read (' +
        ((SRC[k] || '').length) + ' chars)');
});
proof(TESTS.length > 5000, 'the concatenated test corpus is non-empty (' + TESTS.length + ' chars)');
/* and the gap machinery itself: an EXEMPT-less absent field must surface */
proof((function () {
  var fake = 'zzz_probe_' + Date.now();
  return !has(SRC.core, fake) && !EXEMPT[fake];
})(), 'an unexempted absent field would be counted as a gap');

console.log('\nself-check — the census can see what it claims to see');
if (proofs.length) {
  proofs.forEach(function (p) { console.log('  ✗ ' + p); });
  console.log('  the census is not measuring what it reports. Fix this before reading anything above.');
} else {
  console.log('  ✓ has() finds present fields, rejects absent ones, respects word boundaries');
  console.log('  ✓ all five corpora were read and are non-empty');
}

var allGaps = gaps.concat(apiGaps).concat(proofs);
console.log('\n' + FIELDS.length + ' fields + ' + API.length + ' exports censused, ' +
            allGaps.length + ' unexplained gap(s).');
if (allGaps.length) {
  console.log('  ' + allGaps.join(', '));
  console.log('\nEach gap above is either a real hole or belongs in an EXEMPT with a reason.');
}
if (process.argv.indexOf('--strict') >= 0 && allGaps.length) {
  console.log('\n--strict: failing.');
  process.exit(1);
}
console.log(allGaps.length ? '\n(not --strict: reporting only.)' : '\nnothing unwatched.');

function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
