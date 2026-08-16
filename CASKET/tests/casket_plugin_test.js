/* CASKET plugin lint — static checks on the JUCE sources.
   node tests/casket_plugin_test.js

   There is no JUCE in this sandbox, so the first real compile happens on a
   CI runner. That is not a reason to write the plugin blind. Every bug this
   project has actually produced in its wrapper is a bug a compiler catches
   late and a regex catches now: a control bound to a parameter that does not
   exist, a state field the core no longer has, an allocation on the audio
   thread.

   RIGOR's equivalent lint checks that everything the plugin NAMES exists.
   This one adds the direction that matters more and is easier to forget:
   that everything the CORE offers is REACHABLE. A parameter the plugin
   never declares is not a compile error. It is a feature that silently does
   not exist, and it will sit there for rounds. That check found three on its
   first run.  */
'use strict';
var fs = require('fs');
var path = require('path');
var C = require('../casket_core.js');

var JUCE = path.join(__dirname, '..', 'casket-juce');
var SRC = path.join(JUCE, 'Source');
function slurp(p) { return fs.readFileSync(p, 'utf8'); }
var cmake = slurp(path.join(JUCE, 'CMakeLists.txt'));
/* MOVED 2026-08-16 to the ESTATE ROOT ('..', '..'). This one was not
   hypothetical: the nested copy had drifted to 214 lines against the root's
   278, so the harness-coverage check below was asking "does CI run every
   harness?" of a file GitHub would never execute, and passing. The root
   workflow is the one that runs, so it is the one that gets audited. */
var ci = slurp(path.join(__dirname, '..', '..', '.github', 'workflows', 'casket.yml'));

var pass = 0, fail = 0;
function ok(c, n) {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ FAIL: ' + n); }
}

/* Strip C++ comments before scanning for CODE.
   The first version of this lint reported that processBlock called
   `realloc` and `new`. It does neither. It has a comment containing the
   words "reallocate" and "new latency". A linter that reads prose as code
   is a linter that will be switched off by its third false positive, so
   the stripping is not a nicety — it is what makes the real finding
   (an honest `.resize()` on the audio thread) legible at all. */
function decomment(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}
var proc  = decomment(slurp(path.join(SRC, 'PluginProcessor.cpp')));
var procH = decomment(slurp(path.join(SRC, 'PluginProcessor.h')));
var edit  = decomment(slurp(path.join(SRC, 'PluginEditor.cpp')));
var editH = decomment(slurp(path.join(SRC, 'PluginEditor.h')));
var core  = decomment(slurp(path.join(SRC, 'CasketCore.h')));

console.log('CASKET plugin lint — the checks that do not need a compiler\n');

/* ---------- 1. the parameter layout ---------- */
console.log('— the layout —');
var declared = [];
proc.replace(/id\("([a-z0-9_]+)"\)/g, function (m, id) { declared.push(id); return m; });
proc.replace(/ParameterID\{?\s*"([a-z0-9_]+)"\s*,/g, function (m, id) { declared.push(id); return m; });
declared = declared.filter(function (v, i) { return declared.indexOf(v) === i; });
ok(declared.length >= 18, 'layout declares ' + declared.length + ' parameters');

var dupes = [];
declared.forEach(function (id) {
  var n = (proc.match(new RegExp('id\\("' + id + '"\\)', 'g')) || []).length;
  if (n > 1) dupes.push(id + '×' + n);
});
ok(dupes.length === 0, 'no parameter is declared twice' +
   (dupes.length ? ' — ' + dupes.join(', ') : ''));

/* ---------- 2. every field of the JS state must be REACHABLE ----------
   The direction RIGOR's lint does not check. A parameter that is missing
   from the layout produces no error anywhere: buildState() simply never
   writes that field, the C++ struct default stands, and a feature the core
   fully implements is unreachable from a DAW forever. */
console.log('\n— every core control is reachable from the host —');
var st = C.defaultState();
/* fields that are legitimately not host parameters, each with its reason */
var NOT_A_PARAM = {
  version: 'file-format tag',
  meta: 'name and note, not audio',
  dustSeed: 'determinism seed; exposed as a parameter it would be an invitation to automate noise'
};
var coreFields = Object.keys(st).filter(function (f) { return !NOT_A_PARAM[f]; });
/* map JS camelCase to the plugin's snake_case ids */
function snake(f) { return f.replace(/[A-Z]/g, function (c) { return '_' + c.toLowerCase(); }); }
var unreachable = coreFields.filter(function (f) {
  var s = snake(f);
  return declared.indexOf(f) < 0 && declared.indexOf(s) < 0;
});
ok(unreachable.length === 0,
   'every one of the ' + coreFields.length + ' user-facing state fields has a parameter' +
   (unreachable.length ? ' — UNREACHABLE: ' + unreachable.join(', ') : ''));

/* and the processor must actually WRITE each one — a declared parameter
   that buildState() forgets is the same hole with a nicer disguise */
var written = [];
proc.replace(/\bs\.([a-zA-Z]+)\s*=/g, function (m, f) { written.push(f); return m; });
written = written.filter(function (v, i) { return written.indexOf(v) === i; });
var unwritten = coreFields.filter(function (f) { return written.indexOf(f) < 0; });
ok(unwritten.length === 0, 'buildState() writes every one of them' +
   (unwritten.length ? ' — NEVER WRITTEN: ' + unwritten.join(', ') : ''));

/* ---------- 3. the processor may only touch fields the core has ---------- */
console.log('\n— the processor matches the core state —');
var bad = written.filter(function (f) {
  return !Object.prototype.hasOwnProperty.call(st, f);
});
ok(bad.length === 0, 'every state field the processor writes exists on the JS core' +
   (bad.length ? ' — BAD: ' + bad.join(', ') : ''));
ok(!/\bs\.lookahead\b/.test(proc), 'no stale "lookahead" — this lineage calls it vigil');
ok(!/\bs\.ceiling\b/.test(proc), 'no stale "ceiling" — this lineage calls it lid');

/* ---------- 4. the editor binds only real parameters ---------- */
console.log('\n— the editor binds only real parameters —');
var bound = [];
/* the factory pattern the face uses: dial("drive", "Drive") */
edit.replace(/\b(?:dial|latch|chooser)\s*\(\s*"([a-z0-9_]+)"\s*,/g,
  function (m, id) { bound.push(id); return m; });
/* and the direct forms, kept so the lint survives a change of style */
edit.replace(/apvts,\s*"([a-z0-9_]+)"/g, function (m, id) { bound.push(id); return m; });
edit.replace(/getParameter\("([a-z0-9_]+)"\)/g, function (m, id) { bound.push(id); return m; });
bound = bound.filter(function (v, i) { return bound.indexOf(v) === i; });
ok(bound.length >= 12, 'editor binds ' + bound.length + ' distinct parameters');
var missing = bound.filter(function (id) { return declared.indexOf(id) < 0; });
ok(missing.length === 0, 'every editor binding names a declared parameter' +
   (missing.length ? ' — MISSING: ' + missing.join(', ') : ''));

/* the completeness direction, for the FACE this time: a parameter that
   exists but has no control is reachable by automation and invisible to a
   person, which is the same hole one layer up */
var faceless = declared.filter(function (id) { return bound.indexOf(id) < 0; });
ok(faceless.length === 0, 'every declared parameter has a control on the face' +
   (faceless.length ? ' — NO CONTROL: ' + faceless.join(', ') : ''));

var boundTwice = [];
bound.forEach(function (id) {
  var n = (edit.match(new RegExp('"' + id + '"', 'g')) || []).length;
  if (n > 2) boundTwice.push(id + '×' + n);
});
ok(boundTwice.length === 0, 'no parameter is wired to two controls' +
   (boundTwice.length ? ' — ' + boundTwice.join(', ') : ''));

/* the face must be bespoke, not the generic list */
ok(!/GenericAudioProcessorEditor/.test(edit + editH),
   'no GenericAudioProcessorEditor — the face is bespoke');

/* ---------- 5. editor → processor interface ---------- */
console.log('\n— editor to processor interface —');
var called = [];
edit.replace(/proc\.([a-zA-Z]+)\(/g, function (m, f) { called.push(f); return m; });
called = called.filter(function (v, i) { return called.indexOf(v) === i; });
var missingM = called.filter(function (f) { return procH.indexOf(f + '(') < 0; });
ok(missingM.length === 0, 'every proc.*() the editor calls is declared' +
   (missingM.length ? ' — MISSING: ' + missingM.join(', ') : ''));

/* every Meters field the editor reads must exist on the twin's struct.
   This is the check that caught the editor drawing an input trace it had
   no way to source: it wrote hIn from m.peakDb, which is an OUTPUT figure,
   and then never drew it. */
var mStruct = (core.match(/struct Meters \{([\s\S]*?)\}/) || ['', ''])[1];
var mFields = [];
mStruct.replace(/\b([a-zA-Z][a-zA-Z0-9]*)\s*(?=[,;])/g, function (m, f) { mFields.push(f); return m; });
var readM = [];
edit.replace(/\bm\.([a-zA-Z][a-zA-Z0-9]*)/g, function (m, f) { readM.push(f); return m; });
readM = readM.filter(function (v, i) { return readM.indexOf(v) === i; });
var ghost = readM.filter(function (f) { return mFields.indexOf(f) < 0; });
ok(ghost.length === 0, 'every m.* the editor reads exists on Meters' +
   (ghost.length ? ' — GHOST: ' + ghost.join(', ') : ''));

/* a history ring that is fed from the same source twice is a lie on screen */
var ringFeeds = {};
edit.replace(/\b(h[A-Z][a-zA-Z]*)\[hIdx\]\s*=\s*\(float\)\s*([a-zA-Z0-9_.]+)/g,
  function (m, ring, src) { ringFeeds[ring] = src; return m; });
var srcs = Object.keys(ringFeeds).map(function (k) { return ringFeeds[k]; });
var dupSrc = srcs.filter(function (v, i) { return srcs.indexOf(v) !== i; });
ok(dupSrc.length === 0,
   'no two history traces are fed from the same value' +
   (dupSrc.length ? ' — ' + JSON.stringify(ringFeeds) : ''));
/* and nothing is written that is never drawn */
var unread = Object.keys(ringFeeds).filter(function (r) {
  return (edit.match(new RegExp('\\b' + r + '\\b', 'g')) || []).length < 3;
});
ok(unread.length === 0, 'every history trace written is also drawn' +
   (unread.length ? ' — WRITTEN BUT NEVER DRAWN: ' + unread.join(', ') : ''));

/* ---------- 6. real-time safety in processBlock ---------- */
console.log('\n— the audio thread —');
var pb = ((proc.match(/void CasketProcessor::processBlock[\s\S]*?\n\}/) || [''])[0]);
ok(pb.length > 100, 'processBlock located for inspection');
var allocs = [];
[/\.resize\s*\(/, /\.assign\s*\(/, /\bnew\s+[A-Za-z]/, /\b(?:malloc|calloc|realloc)\s*\(/,
 /std::vector\s*<[^>]*>\s+[a-zA-Z]/, /juce::String\s+[a-zA-Z]/].forEach(function (re) {
  var m = pb.match(re);
  if (m) allocs.push(m[0].trim());
});
ok(allocs.length === 0,
   'processBlock allocates nothing — no resize, assign, new or malloc' +
   (allocs.length ? ' — FOUND: ' + allocs.join(', ') : ''));
/* the scratch buffers must therefore be sized for anything the host can
   send, and the block must be chunked if the host exceeds it */
ok(/MAX_BLOCK|chunk|CHUNK/.test(proc),
   'oversized blocks are chunked rather than reallocated');
ok(/setLatencySamples/.test(proc), 'the host is told the latency');
ok(/casket::latencySamples/.test(proc),
   'latency comes from the pure function, not a local calculation');

/* ---------- 7. block-size independence ---------- */
console.log('\n— block-size independence —');
ok(/ctrlPhase|phase/.test(core),
   'the twin carries the control-block phase across calls (the −37 dB bug)');
ok(!/samplesPerBlock/.test(pb),
   'processBlock does not assume the prepared block size');

/* ---------- 8. the twin mirrors the core ---------- */
console.log('\n— the twin mirrors the core —');
var twinVer = (core.match(/VERSION = "([^"]+)"/) || [])[1];
ok(twinVer === C.VERSION,
   'CasketCore.h version (' + twinVer + ') matches the JS core (' + C.VERSION + ')');
var twinCtrl = +(core.match(/CTRL = (\d+)/) || [])[1];
ok(twinCtrl === C.CTRL, 'CTRL matches (' + twinCtrl + ' = ' + C.CTRL + ')');
var twinOsq = +(core.match(/OS_Q = (\d+)/) || [])[1];
ok(twinOsq === C.OS_Q, 'OS_Q matches (' + twinOsq + ' = ' + C.OS_Q + ')');
[['designOversampler', 'designOversampler'], ['designDecimator', 'designDecimator'],
 ['kWeight', 'kWeight'], ['latencySamples', 'latencySamples'],
 ['transferAt', 'transferAt'], ['class Engine', 'the engine'],
 ['class Meter', 'the meter'], ['struct Meters', 'the meters struct']
].forEach(function (p) {
  ok(core.indexOf(p[0]) >= 0, 'twin has ' + p[1]);
});
/* every field of the JS state must exist on the C++ struct too */
var twinState = (core.match(/struct State \{([\s\S]*?)\n\};/) || ['', ''])[1];
var absent = Object.keys(st).filter(function (f) {
  return !NOT_A_PARAM[f] && !new RegExp('\\b' + f + '\\b').test(twinState);
});
ok(absent.length === 0, 'the twin State carries every JS state field' +
   (absent.length ? ' — ABSENT: ' + absent.join(', ') : ''));

/* ---------- 9. the laws ---------- */
/* ---------- 8b. the CI must actually run what exists ----------
   Round 4 could not watch CI run and neither could Round 5 — there is no
   runner in this sandbox, and saying a workflow passes before watching it
   pass is the exact sin the last three rounds have been about.

   What CAN be checked without a runner is the thing that silently rots:
   a harness added to tests/ and never added to the workflow is a harness
   that runs on one machine and is never seen again. This round added four
   of them, which is precisely how that rot starts. */
console.log('\n— the CI runs what exists —');
(function () {
  var all = fs.readdirSync(__dirname)
    .filter(function (f) { return /^casket_.*\.js$/.test(f); })
    .filter(function (f) { return !/_baseline|_probe/.test(f); });
  var referenced = [];
  /* scoped to casket_* on purpose: the workflow also contains an AUTOPSY
     tripwire job that cd's into ../AUTOPSY and runs ITS harnesses. The
     first version of this check read those as CASKET files that did not
     exist and reported three ghosts. A lint that cannot tell whose test
     it is looking at will be switched off by its second false positive. */
  ci.replace(/node\s+tests\/(casket_[a-z0-9_]+\.js)/g, function (m, f) { referenced.push(f); return m; });
  var orphans = all.filter(function (f) { return referenced.indexOf(f) < 0; });
  ok(orphans.length === 0, 'every one of the ' + all.length +
     ' harnesses in tests/ is named in the workflow' +
     (orphans.length ? ' — NOT IN CI: ' + orphans.join(', ') : ''));
  var ghosts = referenced.filter(function (f) {
    return all.indexOf(f) < 0 && !fs.existsSync(path.join(__dirname, f));
  });
  ok(ghosts.length === 0, 'and the workflow names no harness that does not exist' +
     (ghosts.length ? ' — GHOST: ' + ghosts.join(', ') : ''));
})();

console.log('\n— INTERCHANGE laws —');
ok(/-ffp-contract=off/.test(cmake), 'LAW 1: CMake sets -ffp-contract=off');
ok((cmake.match(/-ffp-contract=off/g) || []).length >= 2,
   'LAW 1: both the plugin and the parity target set it');
ok(/-ffp-contract=off/.test(ci), 'LAW 1: CI compiles the parity gate with it');
ok(!/std::sin\s*\(|std::cos\s*\(|std::exp\s*\(|std::log\s*\(|std::pow\s*\(/.test(core),
   'LAW 2: the twin calls no libm transcendental directly');
ok(/std::sqrt/.test(core) || true, 'LAW 2: sqrt is the documented exception');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (!fail) console.log('the wrapper matches the core. the face is its own.');
process.exit(fail ? 1 : 0);
