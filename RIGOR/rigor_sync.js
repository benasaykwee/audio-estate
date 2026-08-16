/* RIGOR sync — embeds shared/necromath.js, shared/necrodyn.js AND
   rigor_core.js VERBATIM into rigor.html.
   Run after ANY edit to any of the three:  node rigor_sync.js
   LOAD ORDER MATTERS and is enforced by rigor_ui_test.js:
   NM must exist before ND evaluates, and both before the core does.
   See ../AUDIO_INTERCHANGE.md §2, laws 3 and 4.

     node rigor_sync.js            embed and verify
     node rigor_sync.js --check    report staleness, write nothing, exit 1 if stale

   AUDIT NOTE (round 10): round 9 added a second embed tool at
   tools/embed.js without noticing this one already existed — the same
   "a rule with two copies" defect the same round had just flagged
   elsewhere, committed by the person flagging it. The two useful things
   that tool had, a --check mode and an explicit law 4 order assertion,
   are folded in here and the duplicate is gone. CI and the README have
   always named THIS file. */
'use strict';
var fs = require('fs');
var path = require('path');
var dir = __dirname;

var EMBEDS = [
  { id: 'nm-src', file: path.join(dir, '..', 'shared', 'necromath.js'), label: 'necromath' },
  { id: 'nd-src', file: path.join(dir, '..', 'shared', 'necrodyn.js'), label: 'necrodyn' },
  { id: 'core-src', file: path.join(dir, 'rigor_core.js'), label: 'core' }
];

var checkOnly = process.argv.indexOf('--check') >= 0;
var htmlPath = path.join(dir, 'rigor.html');
var html = fs.readFileSync(htmlPath, 'utf8');
var original = html;

EMBEDS.forEach(function (em) {
  em.text = fs.readFileSync(em.file, 'utf8');
  if (em.text.indexOf('<' + '/script>') !== -1) {
    console.error('FATAL: ' + em.label + ' contains a literal closing script tag — it would sever the embed.');
    process.exit(1);
  }
  em.re = new RegExp('(<script type="text\\/plain" id="' + em.id + '">\\n)[\\s\\S]*?(\\n<\\/script>)');
  if (!em.re.test(html)) {
    console.error('FATAL: ' + em.id + ' embed markers not found in rigor.html');
    process.exit(1);
  }
  em.at = html.indexOf('id="' + em.id + '"');
  html = html.replace(em.re, function (_m, open, close) { return open + em.text + close; });
});

/* LAW 4: the blocks must appear in dependency order. NM must exist before
   ND evaluates and both before the core does, so the ORDER of the blocks
   in the file is load-bearing rather than cosmetic. Checked here, at the
   point of writing, rather than discovered as a blank page in a browser. */
for (var oi = 1; oi < EMBEDS.length; oi++) {
  if (EMBEDS[oi].at < EMBEDS[oi - 1].at) {
    console.error('FATAL (law 4): ' + EMBEDS[oi].id + ' appears before ' +
                  EMBEDS[oi - 1].id + ' in rigor.html. Each depends on the one');
    console.error('  before it. Reorder the blocks by hand; this tool will not');
    console.error('  guess where they belong.');
    process.exit(1);
  }
}

if (checkOnly) {
  if (html === original) {
    console.log('rigor.html is current — all three embeds match their sources.');
    process.exit(0);
  }
  console.error('rigor.html is STALE. The instrument in the browser is running');
  console.error('different code from the one the tests pass on.');
  EMBEDS.forEach(function (em) {
    var block = original.match(em.re);
    var was = block ? block[0].slice(block[0].indexOf('\n') + 1,
                                     block[0].lastIndexOf('\n<' + '/script>')) : null;
    if (was !== em.text) console.error('  · ' + em.label + ' (' + em.id + ')');
  });
  console.error('\nRun `node rigor_sync.js` to refresh.');
  process.exit(1);
}

fs.writeFileSync(htmlPath, html);

var back = fs.readFileSync(htmlPath, 'utf8');
var ok = true;
EMBEDS.forEach(function (em) {
  var block = back.match(em.re)[0];
  var embedded = block.slice(block.indexOf('\n') + 1, block.lastIndexOf('\n<' + '/script>'));
  if (embedded === em.text) {
    console.log('sync OK — ' + em.label + ' embedded byte-identical (' + em.text.length + ' bytes)');
  } else {
    console.error('FATAL: ' + em.label + ' embed mismatch after write');
    ok = false;
  }
});
process.exit(ok ? 0 : 1);
