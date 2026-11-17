/* ===================================================================
   CORONER — the embedder
   coroner_sync.js

   coroner_core.js is the single source of truth. coroner.html carries a
   VERBATIM copy of it, plus a verbatim copy of shared/necromath.js, so
   the page is one self-contained file that opens from a double-click
   with no server and no build step.

   Run after ANY edit to the core:   node coroner_sync.js
   Check without writing (for CI):   node coroner_sync.js --check

   LAW 4 — nm-src must precede core-src in the document, because the core
   resolves NM by walking the scope chain at definition time.

   The estate's release-check lesson applies here and is worth restating:
   the embed identity check must be DELEGATED to this file and never
   re-implemented with a regex somewhere else. NECROPHONE's naive extract
   was 161 bytes long and false-alarmed for as long as it existed.
   =================================================================== */

'use strict';

var fs = require('fs');
var path = require('path');

var HERE = __dirname;
var HTML = path.join(HERE, 'coroner.html');
var CORE = path.join(HERE, 'coroner_core.js');
var NM = path.join(HERE, '..', 'shared', 'necromath.js');

var MARKS = [
  { name: 'necromath', file: NM,   start: '/* NM-EMBED-START */', end: '/* NM-EMBED-END */' },
  { name: 'core',      file: CORE, start: '/* CORE-EMBED-START */', end: '/* CORE-EMBED-END */' }
];

var check = process.argv.indexOf('--check') >= 0;

function fail(msg) {
  console.error('coroner_sync: ' + msg);
  process.exit(1);
}

if (!fs.existsSync(HTML)) fail('coroner.html not found at ' + HTML);

var html = fs.readFileSync(HTML, 'utf8');
var changed = [], mismatched = [];

MARKS.forEach(function (m) {
  if (!fs.existsSync(m.file)) fail(m.name + ' source not found at ' + m.file);
  var src = fs.readFileSync(m.file, 'utf8');

  /* LAW 3 is enforced HERE rather than trusted. A literal closing script
     tag anywhere in an embedded source closes the tag in the browser and
     the page silently loses everything after it — a failure that no node
     harness can see, because node never parses the HTML. */
  if (src.indexOf('</' + 'script') >= 0) {
    fail('LAW 3 violated: ' + m.name + ' contains a literal closing script tag and cannot be embedded');
  }

  var si = html.indexOf(m.start), ei = html.indexOf(m.end);
  if (si < 0 || ei < 0) fail('markers for ' + m.name + ' not found in coroner.html');
  if (ei < si) fail('markers for ' + m.name + ' are out of order in coroner.html');

  var before = html.slice(0, si + m.start.length);
  var current = html.slice(si + m.start.length, ei);
  var after = html.slice(ei);
  var wanted = '\n' + src + '\n';

  if (current === wanted) return;
  mismatched.push(m.name);
  html = before + wanted + after;
  changed.push(m.name);
});

// LAW 4 — order matters, so verify it rather than assume it
var nmAt = html.indexOf('/* NM-EMBED-START */');
var coreAt = html.indexOf('/* CORE-EMBED-START */');
if (!(nmAt >= 0 && coreAt > nmAt)) {
  fail('LAW 4 violated: the necromath embed must appear before the core embed');
}

if (check) {
  if (mismatched.length) {
    console.error('coroner_sync --check: OUT OF DATE — ' + mismatched.join(', '));
    console.error('run `node coroner_sync.js` to re-embed');
    process.exit(1);
  }
  console.log('coroner_sync --check: embed is byte-identical to source');
  process.exit(0);
}

if (changed.length) {
  fs.writeFileSync(HTML, html, 'utf8');
  console.log('coroner_sync: re-embedded ' + changed.join(', '));
} else {
  console.log('coroner_sync: already current, nothing written');
}
