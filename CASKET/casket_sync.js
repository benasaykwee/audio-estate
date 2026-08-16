/* CASKET sync — embeds shared/necromath.js, shared/necrodyn.js AND
   casket_core.js VERBATIM into casket.html.
   Run after ANY edit to any of the three:  node casket_sync.js
   Verifies all three embeds are byte-identical afterwards.
   LOAD ORDER MATTERS and is enforced by casket_ui_test.js:
   NM must exist before ND evaluates, and both before the core does. */
'use strict';
var fs = require('fs');
var path = require('path');
var dir = __dirname;

var EMBEDS = [
  { id: 'nm-src', file: path.join(dir, '..', 'shared', 'necromath.js'), label: 'necromath' },
  { id: 'nd-src', file: path.join(dir, '..', 'shared', 'necrodyn.js'), label: 'necrodyn' },
  { id: 'core-src', file: path.join(dir, 'casket_core.js'), label: 'core' }
];

var htmlPath = path.join(dir, 'casket.html');
var html = fs.readFileSync(htmlPath, 'utf8');

EMBEDS.forEach(function (em) {
  em.text = fs.readFileSync(em.file, 'utf8');
  if (em.text.indexOf('<' + '/script>') !== -1) {
    console.error('FATAL: ' + em.label + ' contains a literal closing script tag — it would sever the embed.');
    process.exit(1);
  }
  em.re = new RegExp('(<script type="text\\/plain" id="' + em.id + '">\\n)[\\s\\S]*?(\\n<\\/script>)');
  if (!em.re.test(html)) {
    console.error('FATAL: ' + em.id + ' embed markers not found in casket.html');
    process.exit(1);
  }
  html = html.replace(em.re, function (_m, open, close) { return open + em.text + close; });
});

fs.writeFileSync(htmlPath, html);

/* verify byte-identical */
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
