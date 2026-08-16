#!/usr/bin/env node
/* ============================================================================
   estate_lint.js — structural invariants of the repository itself.

   Every project here guards its own arithmetic ferociously and nothing at all
   guards the shape they sit in. That is where this week's cheap mistakes
   lived: a workflow that walked out of its own checkout, a second copy of a
   CI file that nothing runs, a count marker in a document no tool manages.
   None of those are DSP bugs and none of the DSP harnesses could ever have
   found them.

   Each rule below exists because the thing it forbids actually happened.

   USAGE
     node tools/estate_lint.js
   ========================================================================== */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var PROJECTS = ['AUTOPSY', 'RIGOR', 'CASKET'];

var pass = 0, fail = [];
function ok(msg) { pass++; console.log('  ✓ ' + msg); }
function no(msg, detail) { fail.push(msg); console.log('  ✗ ' + msg + (detail ? '\n      ' + detail : '')); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

console.log('\nestate lint — the shape of the repository, not its arithmetic\n');

/* ---------------------------------------------------------------------------
   1. Workflows live at the root, and only at the root.
   GitHub reads <repo-root>/.github/workflows and nowhere else. A workflow
   inside a project directory is inert, which would be harmless if it were
   empty and is corrosive when it is a full copy that silently stops matching.
   ------------------------------------------------------------------------- */
PROJECTS.forEach(function (p) {
  var dir = p + '/.github/workflows';
  if (!exists(dir)) { ok(p + ' has no in-project workflows'); return; }
  fs.readdirSync(path.join(ROOT, dir)).forEach(function (f) {
    var body = read(dir + '/' + f);
    var live = body.split('\n').filter(function (l) {
      return l.trim() && l.trim()[0] !== '#';
    });
    if (live.length) {
      no(dir + '/' + f + ' still holds a live workflow',
         'GitHub will never run it. Empty it to a pointer comment, or delete the directory.');
    } else {
      ok(dir + '/' + f + ' is an inert pointer (safe to delete)');
    }
  });
});

/* ---------------------------------------------------------------------------
   2. Every root workflow either sets working-directory or is honestly rooted.
   The AUTOPSY tripwire once opened with `cd ../AUTOPSY`, which escaped the
   checkout entirely and would have failed on the first run under any layout.
   ------------------------------------------------------------------------- */
var wfDir = '.github/workflows';
var workflows = exists(wfDir) ? fs.readdirSync(path.join(ROOT, wfDir)).filter(function (f) {
  return /\.ya?ml$/.test(f);
}) : [];

if (!workflows.length) no('no workflows at the repository root');

workflows.forEach(function (f) {
  /* Strip comment lines first. The first version of this rule flagged the
     root casket.yml, whose comment *describes* the `cd ../AUTOPSY` bug it
     fixed. A linter that cannot tell code from the note explaining the code
     punishes documentation, and this estate documents heavily. */
  var body = read(wfDir + '/' + f).split('\n')
    .filter(function (l) { return l.trim()[0] !== '#'; }).join('\n');
  if (/\bcd\s+\.\.\//.test(body)) {
    no(wfDir + '/' + f + ' contains `cd ../`',
       'A step cannot walk above the checkout. Use defaults.run.working-directory.');
  } else {
    ok(wfDir + '/' + f + ' never climbs above the checkout');
  }
});

/* ---------------------------------------------------------------------------
   3. The allowlist admits every root workflow.
   The .gitignore denies everything and re-admits by name, so a new workflow
   is invisible to git until somebody remembers to add it — and an invisible
   workflow is one that never runs, with no error to say so.
   ------------------------------------------------------------------------- */
if (exists('.gitignore')) {
  var gi = read('.gitignore');
  workflows.forEach(function (f) {
    var rule = '!/' + wfDir + '/' + f;
    /* NECROPHONE's build.yml is deliberately excluded: its sources are not in
       this repository, so admitting it would add a job that could only fail. */
    if (f === 'build.yml') {
      if (gi.indexOf(rule) < 0) ok('build.yml is deliberately NOT admitted (NECROPHONE lives elsewhere)');
      else no('build.yml is admitted but NECROPHONE\'s sources are not in this repository');
      return;
    }
    if (gi.indexOf(rule) >= 0) ok(f + ' is admitted by the allowlist');
    else no(f + ' is NOT admitted by the allowlist', 'add `' + rule + '` to .gitignore, or it will never run');
  });

  /* 4. The two files that must never be committed. */
  ['www.patreon.com.har', 'www.patreon.com.collections.har'].forEach(function (f) {
    if (!exists(f)) { ok(f + ' is not present'); return; }
    /* the leading /* deny-all is what actually catches these; assert it exists
       rather than trusting a specific rule to be the one that fires */
    if (/^\/\*\s*$/m.test(gi)) ok(f + ' is caught by the deny-all rule');
    else no('the deny-all `/*` rule is missing from .gitignore',
            f + ' contains session_id / authorization / cookie values in plaintext');
  });
} else {
  no('.gitignore is missing');
}

/* ---------------------------------------------------------------------------
   5. Each project's parity gate is reachable from the estate root.
   All three include shared/ by relative path. The whole estate moving
   together is what keeps those paths valid; one project moving alone breaks
   them, and the failure appears at compile time in CI rather than here.
   ------------------------------------------------------------------------- */
/* The first version of this rule only looked at direct includes in
   core_parity.cpp. None of the three name a shared header directly — they
   include their project's Core.h, which includes shared/ — so the rule
   reported "includes no shared header" as a PASS for all three and proved
   nothing. That is the estate's own vacuous-gate failure, committed by the
   tool written to catch structural mistakes. It now follows the chain. */
function includeClosure(startAbs, depth) {
  var seen = {}, shared = [], broken = [];
  (function walk(abs, d) {
    if (d > (depth || 4) || seen[abs]) return;
    seen[abs] = 1;
    if (!fs.existsSync(abs)) return;
    var here = path.dirname(abs);
    (fs.readFileSync(abs, 'utf8').match(/#include\s+"[^"]+"/g) || []).forEach(function (inc) {
      var rel = /"([^"]+)"/.exec(inc)[1];
      var target = path.resolve(here, rel);
      if (/[\\/]shared[\\/]/.test(rel)) {
        (fs.existsSync(target) ? shared : broken).push(rel);
      }
      walk(target, d + 1);
    });
  })(startAbs, 0);
  return { shared: shared, broken: broken };
}

PROJECTS.forEach(function (p) {
  var gate = p + '/tests/core_parity.cpp';
  if (!exists(gate)) { no(gate + ' is missing'); return; }
  var r = includeClosure(path.join(ROOT, gate));
  if (r.broken.length) {
    no(p + '\'s gate cannot resolve a shared header', r.broken.join(', '));
  } else if (!r.shared.length) {
    no(p + '\'s gate reaches no shared header at all',
       'every gate here depends on NM. Reaching none means this check is not checking.');
  } else {
    ok(p + '\'s gate resolves ' + r.shared.length + ' shared include(s) through its core');
  }
});

/* ---------------------------------------------------------------------------
   6. Nothing in shared/ contains a literal closing script tag.
   LAW 3. These files are embedded verbatim into HTML; one of those anywhere,
   comments included, severs the embed. The sync scripts check their own
   project's copy — this checks the source of truth for all of them.
   ------------------------------------------------------------------------- */
['shared/necromath.js', 'shared/necrodyn.js'].forEach(function (f) {
  if (!exists(f)) { no(f + ' is missing'); return; }
  if (read(f).indexOf('</' + 'script') >= 0) no(f + ' contains a literal closing script tag (LAW 3)');
  else ok(f + ' is safe to embed (LAW 3)');
});

/* ---------------------------------------------------------------------------
   7. The interchange log is not in debt.
   §8 requires a §7 entry whenever shared/ is touched. A shared/ file newer
   than the log means somebody changed the substrate and has not written it
   down yet — which, on 2026-08-16, was the signal that another session was
   mid-task rather than finished.
   ------------------------------------------------------------------------- */
if (exists('AUDIO_INTERCHANGE.md')) {
  var logAge = fs.statSync(path.join(ROOT, 'AUDIO_INTERCHANGE.md')).mtimeMs;
  var newer = ['shared/necromath.js', 'shared/necrodyn.js', 'shared/necromath.h', 'shared/necrodyn.h']
    .filter(function (f) { return exists(f) && fs.statSync(path.join(ROOT, f)).mtimeMs > logAge; });
  if (newer.length) {
    no('shared/ has changed since the interchange log was last written',
       newer.join(', ') + ' — §8 requires a §7 entry. A sibling session may also be mid-task.');
  } else {
    ok('the interchange log is at least as new as shared/');
  }
} else {
  no('AUDIO_INTERCHANGE.md is missing');
}

/* --- verdict --------------------------------------------------------------- */
console.log('\n' + pass + ' passed, ' + fail.length + ' failed');
if (fail.length) {
  console.log('\nthe estate\'s shape is wrong in ' + fail.length + ' place(s).');
  process.exit(1);
}
console.log('the estate holds its shape.');
