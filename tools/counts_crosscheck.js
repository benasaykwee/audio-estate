#!/usr/bin/env node
/* ============================================================================
   counts_crosscheck.js — two counting tools, held together by a test.

   WHY THIS EXISTS. On 2026-08-16 two sessions independently built a tool to
   stop the documents restating their numbers, roughly forty minutes apart:

     tools/counts.js         estate-wide, inline <!--c:key--> spans
     RIGOR/rigor_counts.js   RIGOR-scoped, <!-- COUNTS:KEY BEGIN --> blocks

   They do not collide — different files, different marker syntax — and both
   are good. But they both measure RIGOR, and two independent authorities for
   one fact is precisely the drift both were written to abolish, returning
   through a side door.

   Deleting one would be the obvious move and the wrong one. `rigor_counts.js`
   knows things the estate tool does not (mutation survivors, coverage gaps,
   state-field and host-parameter counts) and it regenerates whole table
   bodies rather than single figures. The estate tool knows all three projects
   and gates CI. Each is better at its own job.

   So this follows the pattern §3 of the interchange already uses for the
   deliberate duplications of `makeNoise` and `secSosHP`/`secSosLP`:
   **keep both copies, and write the test that makes disagreement impossible.**

   Cheap by construction: `tools/counts.json` is read rather than re-measured,
   because CI already gates it as current. Only RIGOR's tool actually runs.

   USAGE
     node tools/counts_crosscheck.js

   Exit 0 if the two tools agree about RIGOR. Exit 1, loudly, if they do not.
   ========================================================================== */

'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');

function die(msg) { console.error('\n' + msg); process.exit(1); }

/* --- side A: the estate tool's cache -------------------------------------- */
var cache;
try {
  cache = JSON.parse(fs.readFileSync(path.join(__dirname, 'counts.json'), 'utf8'));
} catch (e) {
  die('cannot read tools/counts.json — run `node tools/counts.js` first.\n' + e.message);
}
var A = cache.projects && cache.projects.rigor;
if (!A) die('tools/counts.json has no rigor entry — run `node tools/counts.js --only=rigor`.');

/* --- side B: RIGOR's own tool, measured live ------------------------------ */
console.log('running RIGOR\'s own counter (it measures; this is not a lookup)…\n');
var raw;
try {
  raw = cp.execSync('node rigor_counts.js --print', {
    cwd: path.join(ROOT, 'RIGOR'), encoding: 'utf8', maxBuffer: 1 << 26
  });
} catch (e) {
  die('RIGOR/rigor_counts.js --print failed:\n' + (e.stdout || '') + (e.stderr || ''));
}

/* it prints progress before the JSON, so take the last {...} block */
var m = raw.match(/\{[\s\S]*\}/);
if (!m) die('no JSON object in rigor_counts.js output. Has its --print format changed?\n' + raw.slice(-400));
var B;
try { B = JSON.parse(m[0]); } catch (e) { die('rigor_counts.js emitted unparseable JSON: ' + e.message); }

/* --- the claims that must agree ------------------------------------------- */
/* rigor_counts reports its asserting harnesses separately; the estate tool
   sums the same three. Summing here rather than in the estate tool keeps the
   arithmetic visible at the point of comparison, where a mismatch is read. */
var checks = [
  ['parity checks',   A.parity,     B.parity],
  ['render baselines', A.baselines, B.baselines],
  ['assertions (core + ui + lint)', A.assertions, B.core + B.ui + B.lint]
];

var bad = [];
console.log('  ' + 'claim'.padEnd(34) + 'tools/counts.js'.padStart(16) + 'rigor_counts.js'.padStart(18));
checks.forEach(function (c) {
  var ok = c[1] === c[2];
  if (!ok) bad.push(c);
  console.log('  ' + (ok ? '✓ ' : '✗ ') + c[0].padEnd(32) +
              String(c[1]).padStart(16) + String(c[2]).padStart(18));
});

/* rigor_counts also verifies its gate actually ran rather than reading a
   declared size. If it took the shortcut, its parity figure is a restatement
   and comparing against it proves nothing — which is the very failure mode
   both tools exist to prevent. */
if (B.parityVerified === false) {
  die('rigor_counts.js reported parityVerified:false — it read the gate\'s declared\n' +
      'size instead of observing it. Re-run it without --fast; a comparison against\n' +
      'a restated number is not a comparison.');
}

if (bad.length) {
  die(bad.length + ' disagreement(s) between the two counters.\n\n' +
      'One of them has gone stale, or RIGOR changed under one and not the other.\n' +
      'Re-run BOTH — `node tools/counts.js --only=rigor` and `node RIGOR/rigor_counts.js`\n' +
      '— and if they still disagree, the tools have diverged in what they count and\n' +
      'that is a real bug in one of them.');
}

console.log('\nthe two counters agree about RIGOR. The duplication is safe.');
