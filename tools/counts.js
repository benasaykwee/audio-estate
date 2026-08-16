#!/usr/bin/env node
/* ============================================================================
   counts.js — the estate's numbers, measured rather than remembered.

   WHY THIS EXISTS. Every count in every document here was true when someone
   typed it and false a day later. On 2026-08-16 the interchange's §1 table
   said RIGOR's gate held 50,718 checks, a handoff note said 36,998, and the
   gate itself reported 61,694 — three numbers for one fact, in one hour. The
   §1 table already carries a footnote admitting it is "a claim like any
   other." This program is the alternative to that footnote.

   HOW IT WORKS. Every live number in the docs is wrapped in an HTML comment
   span, which GitHub renders as nothing:

       the gate stands at <!--c:casket.parity-->22,861<!--/c--> checks

   This script runs the gates and the harnesses, then rewrites what is between
   each pair of markers. Prose stays prose; only the digits move.

   WHAT IT DELIBERATELY DOES NOT TOUCH. Historical measurements are evidence,
   not status. "8,351 mismatches out of 11,164" records what FMA contraction
   did on the day it was measured; rewriting 11,164 to today's total would
   invent a measurement nobody performed. Those numbers carry no marker, and
   a check below fails if anyone wraps one in a span by mistake.

   USAGE
     node tools/counts.js            collect, then rewrite the docs
     node tools/counts.js --check    collect, report drift, write nothing (exit 1 if stale)
     node tools/counts.js --full     also run the slow harnesses instead of using the cache
     node tools/counts.js --list     print what would be written, touch nothing

   CI runs the plain form and then `git diff --exit-code`, which is the same
   shape as the parity gate's "emit, then prove it did not move".
   ========================================================================== */

'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var CACHE = path.join(__dirname, 'counts.json');

var ARGS = process.argv.slice(2);
var CHECK = ARGS.indexOf('--check') >= 0;
var FULL = ARGS.indexOf('--full') >= 0;
var LIST = ARGS.indexOf('--list') >= 0;

/* --only=casket,rigor — measure just these and MERGE over the cache.
   A full run takes about ten minutes, which is longer than several
   environments will let a single process live. Partial runs must therefore
   merge rather than overwrite: a project that was not measured this time
   keeps the value and the date it already had, and says so. */
var ONLY = (function () {
  var a = ARGS.filter(function (x) { return x.indexOf('--only=') === 0; })[0];
  return a ? a.slice(7).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : null;
})();

/* ---------------------------------------------------------------------------
   THE SPEC.

   `slow: true` means the harness is skipped on a normal run and its value is
   read from the cache instead, carrying the date it was last measured. The
   three marked slow cost about four minutes between them, which is the
   difference between a script people run and a script people stop running.
   Measured 2026-08-16: album 100 s, rate 110 s, tools_fuzz 72 s at 25 states.
   ------------------------------------------------------------------------- */
var SPEC = {
  autopsy: {
    dir: 'AUTOPSY',
    parity: 'tests/core_parity.cpp',
    regression: 'tests/autopsy_regression.js',
    harnesses: [
      { file: 'tests/autopsy_test.js' },
      { file: 'tests/autopsy_ui_test.js' },
      { file: 'tests/autopsy_plugin_test.js' }
    ]
  },
  rigor: {
    dir: 'RIGOR',
    parity: 'tests/core_parity.cpp',
    regression: 'tests/rigor_regression.js',
    harnesses: [
      { file: 'tests/rigor_test.js' },
      { file: 'tests/rigor_ui_test.js' },
      { file: 'tests/rigor_plugin_test.js' }
    ]
  },
  casket: {
    dir: 'CASKET',
    parity: 'tests/core_parity.cpp',
    regression: 'tests/casket_regression.js',
    harnesses: [
      { file: 'tests/casket_test.js' },
      { file: 'tests/casket_ui_test.js' },
      { file: 'tests/casket_edge.js' },
      { file: 'tests/casket_dither.js' },
      { file: 'tests/casket_conformance.js' },
      { file: 'tests/casket_nan_audit.js' },
      { file: 'tests/casket_seal_margin.js' },
      { file: 'tests/casket_plugin_test.js' },
      { file: 'tests/casket_host.js' },
      { file: 'tests/casket_album.js', slow: true },
      { file: 'tests/casket_rate.js', slow: true }
    ]
  }
};

/* --- parsing ---------------------------------------------------------------
   Two summary dialects are in use and neither is going to be normalised for
   the convenience of this script:
     CASKET   "22861 checks, 0 mismatches"
     AUTOPSY  "PARITY: 9292 checks, all bit-exact. The twin is identical."
   Both are accepted. A harness that prints neither is an error, not a zero —
   silently counting a broken harness as nought assertions is exactly how a
   number goes wrong quietly.
   ------------------------------------------------------------------------- */
function parseAssertions(out, label) {
  var m = /(\d+)\s+passed,\s+(\d+)\s+failed/.exec(out);
  if (!m) throw new Error(label + ': no "N passed, M failed" line in output');
  if (+m[2] !== 0) throw new Error(label + ': ' + m[2] + ' FAILING — refusing to publish a count from a red suite');
  return +m[1];
}

function parseParity(out, label) {
  var m = /(?:PARITY:\s*)?(\d+)\s+checks/.exec(out);
  if (!m) throw new Error(label + ': no "N checks" line in output');
  if (/mismatch(?!es, 0)|BROKEN|drifted/i.test(out) && !/0 mismatches/.test(out))
    throw new Error(label + ': parity is BROKEN — refusing to publish a count from a red gate');
  return +m[1];
}

function parseBaselines(out, label) {
  var n = (out.match(/✓/g) || []).length;
  if (!n) throw new Error(label + ': no ✓ lines — regression harness produced nothing to count');
  return n;
}

/* --- running -------------------------------------------------------------- */
function run(cmd, cwd) {
  return cp.execSync(cmd, { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
}

function say(s) { if (!LIST) process.stderr.write(s + '\n'); }

function collect() {
  var cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { /* first run */ }

  var today = new Date().toISOString().slice(0, 10);
  /* merge, do not overwrite — see --only above */
  var out = { changed: null, projects: JSON.parse(JSON.stringify(cache.projects || {})) };
  var tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'counts-'));

  var wanted = Object.keys(SPEC).filter(function (n) { return !ONLY || ONLY.indexOf(n) >= 0; });
  if (ONLY) {
    var bogus = ONLY.filter(function (n) { return !SPEC[n]; });
    if (bogus.length) throw new Error('--only names no such project: ' + bogus.join(', '));
    /* A project skipped with nothing in the cache is not an error, it is an
       incomplete bootstrap. Collect what was asked for, save it, and refuse to
       rewrite the docs until every project has been measured at least once —
       a half-known set of values would silently leave some spans stale while
       reporting success. */
    Object.keys(SPEC).filter(function (n) { return wanted.indexOf(n) < 0; }).forEach(function (n) {
      if (!out.projects[n]) { (out.missing = out.missing || []).push(n); say('── ' + n + '  (skipped, NEVER MEASURED)'); }
      else say('── ' + n + '  (skipped, cached from ' + out.projects[n].measured + ')');
    });
  }

  wanted.forEach(function (name) {
    var s = SPEC[name];
    var dir = path.join(ROOT, s.dir);
    var p = { harnesses: {} };
    say('── ' + name);

    /* the parity gate. Compiled fresh every time and ALWAYS with
       -ffp-contract=off, because LAW 1 is not suspended for a reporting
       script — a count produced by a build that breaks the law is a count
       for a different program. */
    var bin = path.join(tmp, name + '_parity');
    run('g++ -std=c++17 -O2 -ffp-contract=off -o ' + JSON.stringify(bin) + ' ' + JSON.stringify(s.parity), dir);
    p.parity = parseParity(run(JSON.stringify(bin), dir), name + ' parity');
    say('   parity      ' + p.parity.toLocaleString('en-US'));

    /* byte-stable render baselines */
    p.baselines = parseBaselines(run('node ' + JSON.stringify(s.regression), dir), name + ' regression');
    say('   baselines   ' + p.baselines);

    /* the asserting harnesses.

       `measured` is the date a value last CHANGED, not the date it was last
       confirmed. That distinction is what makes this script idempotent, and
       idempotence is what makes it gateable: CI regenerates and then runs
       `git diff --exit-code`, so a date that advanced on every run would put
       the build red every morning for no reason and teach everyone to ignore
       it. "These figures have been true since the 16th" is also the more
       useful sentence than "somebody re-ran this today". */
    var was = cache.projects && cache.projects[name];
    var total = 0, live = 0, cached = 0;
    s.harnesses.forEach(function (h) {
      var key = path.basename(h.file, '.js');
      var prior = was && was.harnesses && was.harnesses[key];
      var value;
      if (h.slow && !FULL && prior) { value = prior.value; cached++; }
      else { value = parseAssertions(run('node ' + JSON.stringify(h.file), dir), key); live++; }
      p.harnesses[key] = {
        value: value,
        measured: (prior && prior.value === value) ? prior.measured : today
      };
      total += value;
    });
    p.assertions = total;
    p.harnessCount = s.harnesses.length;

    var same = was && was.parity === p.parity && was.baselines === p.baselines &&
               was.assertions === p.assertions && was.harnessCount === p.harnessCount;
    p.measured = same ? was.measured : today;

    say('   assertions  ' + total + '  (' + live + ' live, ' + cached + ' cached)' +
        (same ? '  — unchanged since ' + p.measured : '  — CHANGED'));
    out.projects[name] = p;
  });

  /* estate totals */
  var ps = Object.keys(out.projects).map(function (k) { return out.projects[k]; });
  out.estate = {
    parity: ps.reduce(function (a, p) { return a + p.parity; }, 0),
    assertions: ps.reduce(function (a, p) { return a + p.assertions; }, 0),
    baselines: ps.reduce(function (a, p) { return a + p.baselines; }, 0)
  };
  /* newest project change — the last time anything here actually moved */
  out.changed = ps.map(function (p) { return p.measured; }).sort().pop() || today;
  return out;
}

/* --- the values the markers may name --------------------------------------- */
function comma(n) { return n.toLocaleString('en-US'); }

function values(c) {
  /* `measured` is the OLDEST project date, not today's. After a partial run
     it would be a small lie to stamp everything with the date of the one
     project that was re-measured; the oldest date is the honest reading of
     "nothing on this page is staler than". */
  var dates = Object.keys(c.projects).map(function (k) { return c.projects[k].measured || c.changed; }).sort();
  var v = { 'measured': dates[0] || c.changed };
  Object.keys(c.projects).forEach(function (name) {
    var p = c.projects[name];
    v[name + '.measured'] = p.measured || c.changed;
    v[name + '.parity'] = comma(p.parity);
    v[name + '.assertions'] = comma(p.assertions);
    v[name + '.baselines'] = String(p.baselines);
    v[name + '.harnesses'] = String(p.harnessCount);
    /* the suite total EXCLUDES parity on purpose. "534 assertions plus 14
       baselines" is a claim about the harnesses; folding 22,861 parity checks
       into it would make one big number that answers no question anybody
       asked. */
    v[name + '.suite'] = comma(p.assertions + p.baselines);
  });
  v['estate.parity'] = comma(c.estate.parity);
  v['estate.assertions'] = comma(c.estate.assertions);
  v['estate.baselines'] = String(c.estate.baselines);
  return v;
}

/* --- the documents --------------------------------------------------------- */
var DOCS = [
  'README.md',
  'AUDIO_INTERCHANGE.md',
  'AUTOPSY_ARCHITECTURE.md',
  'RIGOR_ARCHITECTURE.md',
  'CASKET_ARCHITECTURE.md',
  'CASKET/README.md',
  'AUTOPSY/README.md',
  'RIGOR/README.md'
];

var SPAN = /<!--c:([a-z.]+)-->([\s\S]*?)<!--\/c-->/g;

/* Where markers are ALLOWED to live. A span in a file this script does not
   manage is the worst possible outcome: it looks generated, so nobody checks
   it, and nothing updates it. Found immediately after building this — the
   tool's own README used real-looking markers as examples. Documentation for
   a generator is exactly the file most likely to contain a fake one, so the
   examples there now use an uppercase placeholder that the regex above cannot
   match, and this walk makes sure nobody reintroduces the problem. */
var SEARCH_DIRS = ['', 'shared', 'tools', 'AUTOPSY', 'RIGOR', 'CASKET'];

function everyMarkdown() {
  var found = [];
  SEARCH_DIRS.forEach(function walk(rel) {
    var abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    fs.readdirSync(abs, { withFileTypes: true }).forEach(function (d) {
      var r = rel ? rel + '/' + d.name : d.name;
      if (d.isDirectory()) {
        if (/^(node_modules|build|\.git|JUCE)$/.test(d.name)) return;
        if (!rel) return;              /* root: files only, subdirs listed explicitly */
        walk(r);
      } else if (/\.md$/.test(d.name)) found.push(r);
    });
  });
  return found;
}

function strayMarkers() {
  return everyMarkdown().filter(function (rel) {
    if (DOCS.indexOf(rel) >= 0) return false;
    SPAN.lastIndex = 0;
    return SPAN.test(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  });
}

/* TWO PASSES, and the separation is the point. The first version of this
   function scanned and wrote in one go, so a document naming an unknown key
   made the script exit 2 with "UNKNOWN MARKERS" — after it had already
   rewritten every other file. The report said nothing happened and four
   files had changed. Plan the whole edit, validate it, then commit it. */
function rewrite(c) {
  var v = values(c);
  var drift = [], unknown = [], planned = [];

  DOCS.forEach(function (rel) {
    var file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) return;
    var src = fs.readFileSync(file, 'utf8');
    var next = src.replace(SPAN, function (whole, key, cur) {
      if (!(key in v)) { unknown.push(rel + ' → ' + key); return whole; }
      if (cur !== v[key]) drift.push(rel + ':  ' + key + '  ' + JSON.stringify(cur) + ' → ' + JSON.stringify(v[key]));
      return '<!--c:' + key + '-->' + v[key] + '<!--/c-->';
    });
    if (next !== src) planned.push({ file: file, rel: rel, text: next });
  });

  /* nothing is written if any marker was unrecognised, so the exit-2 message
     is true when it says the documents are untouched */
  if (!unknown.length && !CHECK && !LIST) planned.forEach(function (p) { fs.writeFileSync(p.file, p.text); });

  return {
    drift: drift, unknown: unknown, values: v,
    touched: planned.map(function (p) { return p.rel; })
  };
}

/* --- main ------------------------------------------------------------------ */
try {
  var counts = collect();

  if (counts.missing) {
    if (!CHECK) fs.writeFileSync(CACHE, JSON.stringify(counts, null, 2) + '\n');
    console.log('\ncache saved, docs NOT rewritten — never measured: ' + counts.missing.join(', '));
    console.log('run those, then run again with no --only to publish.');
    process.exit(0);
  }

  var stray = strayMarkers();
  if (stray.length) {
    console.error('\nMARKERS IN UNMANAGED FILES — these would never be updated:');
    stray.forEach(function (s) { console.error('  ' + s); });
    console.error('Add the file to DOCS in tools/counts.js, or stop using a real marker in it.');
    process.exit(2);
  }

  var r = rewrite(counts);

  if (LIST) {
    Object.keys(r.values).sort().forEach(function (k) { console.log(k.padEnd(22) + r.values[k]); });
    process.exit(0);
  }

  if (r.unknown.length) {
    console.error('\nUNKNOWN MARKERS — a document names a count this script does not produce:');
    r.unknown.forEach(function (u) { console.error('  ' + u); });
    process.exit(2);
  }

  if (!CHECK) fs.writeFileSync(CACHE, JSON.stringify(counts, null, 2) + '\n');

  if (!r.drift.length) {
    console.log('\ncounts current — every derived number in the docs matches its gate.');
    process.exit(0);
  }

  console.log('\n' + r.drift.length + ' number(s) had drifted:');
  r.drift.forEach(function (d) { console.log('  ' + d); });

  if (CHECK) {
    console.error('\nDOCS ARE STALE. Run `node tools/counts.js` and commit the result.');
    process.exit(1);
  }
  console.log('\nrewritten: ' + r.touched.join(', '));
} catch (e) {
  console.error('\ncounts.js failed: ' + e.message);
  process.exit(3);
}
