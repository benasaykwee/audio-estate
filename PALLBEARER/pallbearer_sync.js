/* ===================================================================
   PALLBEARER — the sync
   node pallbearer_sync.js          embed NM + core into the HTML
   node pallbearer_sync.js --check  verify the embed matches, exit 1 if not

   The core file is the single source of truth. The HTML carries a verbatim
   copy so the page is one self-contained artifact. This script is the only
   thing allowed to write that copy, and --check is what CI runs.

   LAW 4 — the embed order is load-bearing: nm-src precedes core-src,
   because the core closes over NM. Asserted by byte position, not by hope.
   =================================================================== */

var fs = require('fs');
var path = require('path');

var HERE = __dirname;
var HTML = path.join(HERE, 'pallbearer.html');
var CORE = path.join(HERE, 'pallbearer_core.js');
var NM = path.join(HERE, '..', 'shared', 'necromath.js');

var check = process.argv.indexOf('--check') >= 0;

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }
function block(id) {
  return new RegExp('(<script type="text/plain" id="' + id + '">)([\\s\\S]*?)(<' + '/script>)');
}

var html = fs.readFileSync(HTML, 'utf8');
var core = fs.readFileSync(CORE, 'utf8');
var nm = fs.readFileSync(NM, 'utf8');

/* LAW 3 is checked here rather than trusted, because a literal closing
   script tag in either source silently severs the embed and the page then
   fails in a way that looks like a DSP bug. */
var CLOSER = '<' + '/script>';
if (core.indexOf(CLOSER) >= 0) fail('LAW 3 — pallbearer_core.js contains a literal closing script tag');
if (nm.indexOf(CLOSER) >= 0) fail('LAW 3 — shared/necromath.js contains a literal closing script tag');

var mNm = html.match(block('nm-src'));
var mCore = html.match(block('core-src'));
if (!mNm) fail('the HTML has no nm-src block');
if (!mCore) fail('the HTML has no core-src block');

// LAW 4 — order, by byte position
if (html.indexOf('id="nm-src"') > html.indexOf('id="core-src"'))
  fail('LAW 4 — nm-src must appear before core-src in the HTML');

if (check) {
  var okNm = mNm[2] === nm;
  var okCore = mCore[2] === core;
  if (okNm && okCore) {
    console.log('✓ embed is byte-identical to source  (NM ' + nm.length + 'b, core ' + core.length + 'b)');
    process.exit(0);
  }
  if (!okNm) console.error('✗ nm-src differs from shared/necromath.js  (' + mNm[2].length + 'b embedded vs ' + nm.length + 'b on disk)');
  if (!okCore) console.error('✗ core-src differs from pallbearer_core.js  (' + mCore[2].length + 'b embedded vs ' + core.length + 'b on disk)');
  console.error('  run: node pallbearer_sync.js');
  process.exit(1);
}

var out = html.replace(block('nm-src'), function (_, a, _b, c) { return a + nm + c; })
              .replace(block('core-src'), function (_, a, _b, c) { return a + core + c; });
fs.writeFileSync(HTML, out);

// re-read and prove it, rather than announcing success on faith
var after = fs.readFileSync(HTML, 'utf8');
var vNm = after.match(block('nm-src'))[2] === nm;
var vCore = after.match(block('core-src'))[2] === core;
if (!vNm || !vCore) fail('wrote the embed but it did not verify — refusing to claim success');

console.log('✓ embedded NM (' + nm.length + 'b) and core (' + core.length + 'b) into pallbearer.html');
console.log('✓ verified byte-identical after write');
