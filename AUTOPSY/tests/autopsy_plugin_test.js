/* AUTOPSY plugin lint — static analysis of the JUCE sources, no compiler needed.
   node tests/autopsy_plugin_test.js
   Modelled on RIGOR's lint plus CASKET's reverse direction — the one that
   found mid/side implemented, mirrored, fuzzed, parity-checked, and
   unreachable from any DAW because nobody added the parameter.
   Directions:
     FORWARD:  everything the plugin names must exist.
     REVERSE:  everything the core offers must be reachable from a host.
   Plus: the five laws hold in CMake/CI/twin; versions are DERIVED, not
   restated (an assertion that names its expected value is not checking
   anything — RIGOR's version strings disagreed for two rounds under one). */
'use strict';
var fs = require('fs');
var path = require('path');
var A = require('../autopsy_core.js');

var root = path.join(__dirname, '..');
function rd(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }
var procH = rd('autopsy-juce/Source/PluginProcessor.h');
var procC = rd('autopsy-juce/Source/PluginProcessor.cpp');
var edH = rd('autopsy-juce/Source/PluginEditor.h');
var edC = rd('autopsy-juce/Source/PluginEditor.cpp');
var twin = rd('autopsy-juce/Source/AutopsyCore.h');
var cmake = rd('autopsy-juce/CMakeLists.txt');
/* MOVED 2026-08-16 to the ESTATE ROOT. GitHub reads workflows only from
   <repo-root>/.github/workflows, and the estate is rooted at CLAUDE/, so
   AUTOPSY/.github/workflows/autopsy.yml was never going to execute. A lint
   that asserts LAW 1 against a file nobody runs is the Interchange's own
   rule wearing a lint's clothes: a workflow that has never run is not a
   gate, it is a wish. This now reads the file CI actually executes. */
var ci = rd('../.github/workflows/autopsy.yml');

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}

/* ---------- reconstruct the parameter layout from createLayout() ---------- */
var layoutIds = new Set();
// explicit ParameterID("...") occurrences
procC.replace(/ParameterID\("([^"]+)"/g, function (_m, id) { layoutIds.add(id); return _m; });
// bandId(b, "xxx") pattern expands to b1_xxx .. b12_xxx
var bandSuffixes = [];
procC.replace(/ParameterID\(bandId\(b, "([^"]+)"\)/g, function (_m, sfx) { bandSuffixes.push(sfx); return _m; });
bandSuffixes.forEach(function (sfx) {
  for (var b = 1; b <= A.MAX_BANDS; b++) layoutIds.add('b' + b + '_' + sfx);
});
ok(layoutIds.size === 146, 'layout declares exactly 146 parameters (found ' + layoutIds.size + ')');

/* ---------- FORWARD: everything named exists ---------- */
var referenced = [];
procC.replace(/getRawParameterValue\(bandId\(b, "([^"]+)"\)\)/g, function (_m, sfx) {
  referenced.push({ kind: 'band', sfx: sfx }); return _m;
});
procC.replace(/getRawParameterValue\("([^"]+)"\)/g, function (_m, id) {
  referenced.push({ kind: 'flat', id: id }); return _m;
});
var fwdMissing = [];
referenced.forEach(function (r) {
  if (r.kind === 'flat') { if (!layoutIds.has(r.id)) fwdMissing.push(r.id); }
  else { if (!layoutIds.has('b1_' + r.sfx)) fwdMissing.push('b*_' + r.sfx); }
});
ok(fwdMissing.length === 0, 'FORWARD: every parameter the processor reads exists in the layout' +
   (fwdMissing.length ? ' (missing: ' + fwdMissing.join(', ') + ')' : ''));

/* ---------- REVERSE: everything the core offers is reachable ---------- */
/* Derive the core's field surface from defaultState() itself — never a
   hand-written list, which would just be a second copy that drifts. */
var ds = A.defaultState();
var coreFields = [];
Object.keys(ds.bands[0]).forEach(function (k) {
  if (k === 'dyn') Object.keys(ds.bands[0].dyn).forEach(function (dk) { coreFields.push('band.dyn.' + dk); });
  else coreFields.push('band.' + k);
});
Object.keys(ds.out).forEach(function (k) { coreFields.push('out.' + k); });
Object.keys(ds.meta).forEach(function (k) { coreFields.push('meta.' + k); });

/* which fields does buildState() actually write from parameters? */
var WRITES = {
  'band.on': /s\.bands\[b\]\.on\s*=/, 'band.type': /s\.bands\[b\]\.type\s*=/,
  'band.freq': /s\.bands\[b\]\.freq\s*=/, 'band.gain': /s\.bands\[b\]\.gain\s*=/,
  'band.q': /s\.bands\[b\]\.q\s*=/, 'band.slope': /s\.bands\[b\]\.slope\s*=/,
  'band.place': /s\.bands\[b\]\.place\s*=/,
  'band.dyn.on': /s\.bands\[b\]\.dyn\.on\s*=/, 'band.dyn.range': /s\.bands\[b\]\.dyn\.range\s*=/,
  'band.dyn.thresh': /s\.bands\[b\]\.dyn\.thresh\s*=/, 'band.dyn.att': /s\.bands\[b\]\.dyn\.att\s*=/,
  'band.dyn.rel': /s\.bands\[b\]\.dyn\.rel\s*=/,
  'out.gain': /s\.outGain\s*=/, 'out.pan': /s\.outPan\s*=/
};
/* deliberately host-unreachable, with the reason on record: */
var UNREACHABLE_OK = {
  'meta.name': 'cosmetic label; plugin state persists the whole APVTS instead',
  'meta.note': 'cosmetic; same'
};
var unreachable = [];
coreFields.forEach(function (f) {
  if (UNREACHABLE_OK[f]) return;
  if (!WRITES[f]) { unreachable.push(f + ' (no lint rule — add one)'); return; }
  if (!WRITES[f].test(procC)) unreachable.push(f);
});
ok(unreachable.length === 0, 'REVERSE: every core field is reachable from a host' +
   (unreachable.length ? ' — UNREACHABLE: ' + unreachable.join(', ') : ''));

/* ---------- twin mirrors the core surface ---------- */
var TWIN_MUST_HAVE = [
  'sanitizeState', 'designBand', 'magnitudeAt', 'bandMagAt', 'bandLinMagAt',
  'makeNoise', 'clampFreq', 'clampGain', 'clampQ', 'hasGainType',
  'setState', 'process', 'processFloat', 'reset', 'dynGains',
  'MAX_BANDS', 'MAX_SECTIONS', 'CTRL', 'SLOPES', 'ctrlPhase'
];
var twinMissing = TWIN_MUST_HAVE.filter(function (s) { return twin.indexOf(s) === -1; });
ok(twinMissing.length === 0, 'twin mirrors the core surface' +
   (twinMissing.length ? ' (missing: ' + twinMissing.join(', ') + ')' : ''));
ok(twin.indexOf('TYPE_NAMES[NUM_TYPES]') !== -1 &&
   A.TYPES.every(function (t) { return twin.indexOf('"' + t + '"') !== -1; }),
   'twin knows every band type the core knows (derived from A.TYPES)');
ok(A.SLOPES.every(function (s) { return new RegExp('[{, ]' + s + '[,} ]').test(twin.match(/SLOPES\[6\][^;]+;/)[0]); }),
   'twin SLOPES set matches the core (derived from A.SLOPES)');

/* ---------- versions are DERIVED, never restated ---------- */
var twinVer = (twin.match(/VERSION = "([^"]+)"/) || [])[1];
ok(twinVer === A.VERSION, 'twin VERSION matches JS core (both read: "' + twinVer + '" vs "' + A.VERSION + '")');

/* ---------- the laws, where they are enforced ---------- */
ok(/-ffp-contract=off/.test(cmake), 'LAW 1 in CMakeLists (plugin build)');
ok((ci.match(/-ffp-contract=off/g) || []).length >= 1, 'LAW 1 in CI (parity compile)');
var dspBody = twin.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
var libmHits = (dspBody.match(/std::(sin|cos|tan|exp|log|log10|pow)\b/g) || []);
ok(libmHits.length === 0, 'LAW 2: zero libm transcendentals in the twin' +
   (libmHits.length ? ' (found: ' + libmHits.join(', ') + ')' : ''));
ok(/#include "\.\.\/\.\.\/\.\.\/shared\/necromath\.h"/.test(twin) || /#include ".*necromath\.h"/.test(twin),
   'twin includes shared necromath.h (no fork)');

/* ---------- editor discipline ---------- */
var procCalls = [];
edC.replace(/proc\.(\w+)\(/g, function (_m, fn) { if (procCalls.indexOf(fn) === -1) procCalls.push(fn); return _m; });
var undeclared = procCalls.filter(function (fn) {
  return !(new RegExp('\\b' + fn + '\\s*\\(').test(procH));
});
ok(undeclared.length === 0, 'every proc.*() the editor calls is declared' +
   (undeclared.length ? ' (missing: ' + undeclared.join(', ') + ')' : ''));
var attachIds = [];
edC.replace(/Attachment[^;]*apvts,\s*"([^"]+)"/g, function (_m, id) { attachIds.push(id); return _m; });
var attachMissing = attachIds.filter(function (id) { return !layoutIds.has(id); });
ok(attachMissing.length === 0, 'every editor attachment id exists in the layout (' + attachIds.length + ' attachments)' +
   (attachMissing.length ? ' MISSING: ' + attachMissing.join(', ') : ''));
var dupes = attachIds.filter(function (id, i) { return attachIds.indexOf(id) !== i; });
ok(dupes.length === 0, 'no parameter is attached to two controls' +
   (dupes.length ? ' (dupes: ' + dupes.join(', ') + ')' : ''));

/* ---------- CI knows every harness ---------- */
var HARNESSES = ['autopsy_test.js', 'autopsy_ui_test.js', 'autopsy_regression.js',
                 'parity_emit.js', 'autopsy_plugin_test.js', 'autopsy_fuzz.js', 'autopsy_audit.js'];
var ciMissing = HARNESSES.filter(function (h) { return ci.indexOf(h) === -1; });
ok(ciMissing.length === 0, 'CI runs every harness' +
   (ciMissing.length ? ' (not in workflow: ' + ciMissing.join(', ') + ')' : ''));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
