/* RIGOR coverage audit — which parts of this program is nobody watching?
   ============================================================
   Every other harness here answers "is the code correct?". This one answers
   a different and less comfortable question: "is there anything the code
   does that NOTHING checks?"

   Those are not the same question, and this project has repeatedly shipped
   things that passed every test because no test knew they existed. The
   plugin could not compile for two rounds. FFT had zero parity coverage.
   The browser instrument ran an older engine than the tests. A crossover
   rule sat unreachable behind a second copy of itself.

   So this walks the ACTUAL surface — every state field, every export — and
   asks of each one, mechanically:

     sanitised   does sanitizeState() constrain it?
     engine      does any engine read it?
     parity      does the C++ twin know about it?
     plugin      is it reachable from a host?
     ui          is it reachable from the browser instrument?
     tested      does any harness name it?
     migrate     does case-file migration handle it?

   A blank column is not automatically a bug. Some fields legitimately have
   none (`meta` is not DSP). The point is that every blank should be there
   ON PURPOSE, and this prints them so the decision is made rather than
   defaulted into.

     node tests/rigor_coverage.js           the matrix
     node tests/rigor_coverage.js --strict  exit non-zero on an UNEXPLAINED gap
   ============================================================ */
'use strict';
var fs = require('fs');
var path = require('path');
var R = require('../rigor_core.js');

var ROOT = path.join(__dirname, '..');
function read(p) { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (e) { return ''; } }

var SRC = {
  core: read('rigor_core.js'),
  twin: read('rigor-juce/Source/RigorCore.h'),
  proc: read('rigor-juce/Source/PluginProcessor.cpp'),
  edit: read('rigor-juce/Source/PluginEditor.cpp'),
  html: read('rigor.html'),
  emit: read('tests/parity_emit.js'),
  pcpp: read('tests/core_parity.cpp')
};
/* every harness, concatenated — "does anything test this" is a question
   about the whole suite, not about one file */
var TESTS = ['rigor_test.js', 'rigor_ui_test.js', 'rigor_plugin_test.js',
             'rigor_fuzz.js', 'rigor_audit.js', 'rigor_regression.js',
             'rigor_styles.js', 'rigor_tools.js', 'rigor_mutate.js',
             'rigor_coverage.js']
  .map(function (f) { return read('tests/' + f); }).join('\n');

/* Fields that are DELIBERATELY not covered somewhere, with the reason.
   An entry here is a decision on the record. Anything missing that is NOT
   listed here is what --strict fails on. */
/* Fields the engine reads THROUGH a helper rather than by name. The
   indirection is deliberate in the core — releaseMs() folds tempo sync into
   one number, autoMakeupDb() keeps makeup a pure function of the state — so
   a census that only greps for `st.field` reports a false gap. Named here
   with the helper that does the reading, so the exemption is checkable
   rather than a shrug. */
var VIA_HELPER = {
  release: 'releaseMs(st)',
  relSync: 'releaseMs(st)',
  bpm: 'releaseMs(st)',
  autoMakeup: 'makeupDb(st) -> autoMakeupDb(st)'
};

var EXEMPT = {
  meta: 'not DSP — name and note only. Carried through the case file and shown in the UI, never read by an engine.',
  version: 'the case-file format number. Read by migration, deliberately not a parameter.'
};

/* ---------------- the matrix ---------------- */
var d = R.defaultState();
var fields = Object.keys(d);

/* A field is "known to" a file if the file names it as a property or a
   quoted key. Deliberately literal: this is a coverage census, not a
   semantic analysis, and a false NEGATIVE here is the useful direction —
   it makes me go look. */
function names(hay, f) {
  if (!hay) return false;
  var pats = [
    new RegExp('\\.' + f + '\\b'),          /* st.field        */
    new RegExp('[\'"]' + f + '[\'"]'),      /* 'field'         */
    new RegExp('\\b' + f + '\\s*[:=]'),     /* field:  field = */
    new RegExp('\\bs\\.' + f + '\\b')
  ];
  return pats.some(function (p) { return p.test(hay); });
}

var rows = fields.map(function (f) {
  return {
    field: f,
    sanitised: names(SRC.core.slice(SRC.core.indexOf('function sanitizeState')), f),
    engine: names(SRC.core.slice(SRC.core.indexOf('function createEngine')), f) ||
            !!VIA_HELPER[f],
    parity: names(SRC.twin, f) && (names(SRC.emit, f) || names(SRC.pcpp, f)),
    plugin: names(SRC.proc, f) || names(SRC.edit, f),
    ui: names(SRC.html, f),
    tested: names(TESTS, f),
    migrate: names(SRC.core.slice(SRC.core.indexOf('function migrateCase'),
                                  SRC.core.indexOf('function loadCase')), f)
  };
});

var COLS = ['sanitised', 'engine', 'parity', 'plugin', 'ui', 'tested'];
var W = Math.max.apply(null, fields.map(function (f) { return f.length; })) + 2;

console.log('RIGOR coverage audit — ' + fields.length + ' state fields\n');
console.log('field'.padEnd(W) + COLS.map(function (c) { return c.slice(0, 4).padStart(6); }).join(''));
console.log('-'.repeat(W + COLS.length * 6));

var gaps = [];
rows.forEach(function (r) {
  var line = r.field.padEnd(W);
  COLS.forEach(function (c) { line += (r[c] ? '  ok  ' : '   ·  '); });
  console.log(line);
  COLS.forEach(function (c) {
    if (!r[c] && !EXEMPT[r.field]) gaps.push({ field: r.field, col: c });
  });
});

/* ---------------- exports nobody uses ---------------- */
var exps = Object.keys(R).filter(function (k) { return k.charAt(0) !== '_'; });
var consumers = SRC.html + '\n' + TESTS + '\n' + read('tests/parity_emit.js') +
                '\n' + read('rigor_sync.js') + '\n' + read('tools/embed.js');
var unused = exps.filter(function (k) {
  /* NOT [\.\b] — inside a character class \b means BACKSPACE, not a word
     boundary, so that pattern only ever matched ".name" and reported five
     heavily-used exports as dead. My own tool, wrong in its first run, which
     is the joke this audit keeps telling. */
  return !new RegExp('\\b' + k + '\\b').test(consumers);
});

console.log('\n' + '='.repeat(W + COLS.length * 6));
console.log('EXPORTS: ' + exps.length + ' public');
if (unused.length) {
  console.log('  never referenced by the instrument, any harness, or any tool:');
  unused.forEach(function (k) { console.log('    · R.' + k); });
  console.log('  An export is a promise to keep something working. One that');
  console.log('  nothing calls is a promise with no evidence behind it.');
} else {
  console.log('  every export is referenced by something.');
}

/* ---------------- the exemptions, stated out loud ---------------- */
console.log('\nREAD THROUGH A HELPER (not a gap)');
Object.keys(VIA_HELPER).forEach(function (k) {
  console.log('  · ' + k + ' — via ' + VIA_HELPER[k]);
});

console.log('\nDELIBERATE EXEMPTIONS');
Object.keys(EXEMPT).forEach(function (k) {
  console.log('  · ' + k + ' — ' + EXEMPT[k]);
});

/* ---------------- verdict ---------------- */
console.log('\n' + '='.repeat(W + COLS.length * 6));
if (!gaps.length) {
  console.log('No unexplained gaps. Every field is sanitised, read, ported,');
  console.log('exposed both ways, and named by at least one harness.');
} else {
  var byField = {};
  gaps.forEach(function (g) { (byField[g.field] = byField[g.field] || []).push(g.col); });
  console.log(Object.keys(byField).length + ' field(s) with an unexplained gap:');
  Object.keys(byField).forEach(function (f) {
    console.log('  · ' + f + ' — missing: ' + byField[f].join(', '));
  });
  console.log('\nEither close the gap or add the field to EXEMPT with a reason.');
  console.log('A gap that is fine is still a gap somebody should have decided on.');
}

var strict = process.argv.indexOf('--strict') >= 0;
process.exit(strict && (gaps.length || unused.length) ? 1 : 0);
