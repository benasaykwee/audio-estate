/* RIGOR plugin lint — static checks on the JUCE sources.

   These are the checks that do NOT need a compiler, and they cover the
   class of bug that has actually bitten this project: an editor control
   bound to a parameter ID that does not exist, or a processor reading a
   state field the core no longer has.

   CORRECTION, 2026-08-22. This header used to open "there is no JUCE in
   the sandbox, so the first real build happens on CI", and that sentence
   did real damage: it made a compiler feel unavailable when it was one
   `git clone` away, and a one-token scope error rode a green suite all the
   way to the macOS runner. JUCE can be fetched here and the C++ FRONT END
   runs fine — `tests/rigor_juce_syntax.sh` now does exactly that.

   That gate is deliberately NOT in CI: the macOS job already compiles for
   real, so cloning JUCE into the Linux job would buy nothing it does not
   already prove, and cost minutes on every run. Its job is to fail on your
   own machine before you spend a runner finding out. This lint stays in
   CI because it needs nothing and takes two seconds.

   node tests/rigor_plugin_test.js */
'use strict';
var fs = require('fs');
var path = require('path');
var R = require('../rigor_core.js');

var SRC = path.join(__dirname, '..', 'rigor-juce', 'Source');
var proc = fs.readFileSync(path.join(SRC, 'PluginProcessor.cpp'), 'utf8');
var procH = fs.readFileSync(path.join(SRC, 'PluginProcessor.h'), 'utf8');
var edit = fs.readFileSync(path.join(SRC, 'PluginEditor.cpp'), 'utf8');
var editH = fs.readFileSync(path.join(SRC, 'PluginEditor.h'), 'utf8');
var core = fs.readFileSync(path.join(SRC, 'RigorCore.h'), 'utf8');

var pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } }

console.log('RIGOR plugin lint — the checks that do not need a compiler');

/* ---- 1. the parameter layout ---- */
console.log('\n— parameters —');
var declared = [];
proc.replace(/ParameterID\{\s*"([a-z0-9_]+)"\s*,/g, function (m, id) { declared.push(id); return m; });
/* the per-band ones are built from a loop, so expand them */
['off', 'gain', 'mute', 'solo'].forEach(function (suf) {
  if (proc.indexOf('"b" + n + "_' + suf + '"') >= 0)
    for (var b = 1; b <= R.MAX_BANDS; b++) declared.push('b' + b + '_' + suf);
});
/* ---- THE ASSERTION THAT HAD NO TEETH ----
   This used to read `declared.length >= 25`. Thirty-five were declared, so
   it passed comfortably while THREE parameters added in round 9 —
   deltaBand, scBand and tsSplit — existed in the core, the twin and the
   browser instrument but were unreachable from any host. A floor cannot
   notice something missing; it can only notice a catastrophe. Same species
   as the version assertion that named its own expected value and "passed"
   for two rounds while the two files disagreed.

   So derive it. Every field in defaultState() is either a host parameter or
   is listed below with a reason. That way the NEXT field added to the core
   fails this test until somebody decides, on the record, which it is. */
var NOT_A_PARAM = {
  version: 'case-file format number, not a control',
  meta: 'name and note — text, and hosts do not automate text',
  bpm: 'read from the playhead, never from a knob — that is what keeps tempo sync compatible with byte-stable regression',
  band: 'expanded into the per-band parameters above',
  xover: 'expanded into xover1 and xover2'
};
var stateFields = Object.keys(R.defaultState());
var mapped = declared.join(' ');
/* Core name -> host parameter ID, where the two differ by more than
   camelCase becoming snake_case. Explicit, because a fuzzy match is how
   the first version of this assertion let a renamed parameter through:
   it accepted "the processor assigns this field" as proof, and the
   processor happily assigns a field from a parameter that does not
   exist. What must be proven is that a DECLARED parameter feeds it. */
var ALIAS = { inGain: 'in_gain', look: 'lookahead_ms' };
function looksMapped(f) {
  var snake = f.replace(/[A-Z]/g, function (c) { return '_' + c.toLowerCase(); });
  var candidates = [ALIAS[f], snake, f.toLowerCase(), f];
  return candidates.some(function (c) { return c && declared.indexOf(c) >= 0; });
}
var unreachable = stateFields.filter(function (f) {
  return !NOT_A_PARAM[f] && !looksMapped(f);
});
ok(unreachable.length === 0,
   'every DSP field in defaultState() is reachable from a host — ' +
   stateFields.length + ' fields, ' + declared.length + ' parameters, ' +
   Object.keys(NOT_A_PARAM).length + ' deliberately not automatable' +
   (unreachable.length ? '\n         UNREACHABLE: ' + unreachable.join(', ') : ''));
var dupes = declared.filter(function (v, i) { return declared.indexOf(v) !== i; });
ok(dupes.length === 0, 'no duplicate parameter IDs' + (dupes.length ? ' — ' + dupes.join(', ') : ''));

/* ---- 2. every ID the EDITOR binds must exist ----
   This is the assertion that would have caught binding the mid/side
   toggle to the delta parameter. */
console.log('\n— the editor binds only real parameters —');
var bound = [];
edit.replace(/bind\([A-Za-z]+,\s*"([a-z0-9_]+)"\)/g, function (m, id) { bound.push(id); return m; });
edit.replace(/proc\.apvts,\s*"([a-z0-9_]+)"/g, function (m, id) { bound.push(id); return m; });
edit.replace(/getParameter\("([a-z0-9_]+)"\)/g, function (m, id) { bound.push(id); return m; });
edit.replace(/\{\s*"([a-z0-9_]+)",\s*"[^"]+"\s*\}/g, function (m, id) { bound.push(id); return m; });
bound = bound.filter(function (v, i) { return bound.indexOf(v) === i; });
/* ---- WHICH PARAMETERS HAVE NO KNOB ----
   `bound.length > 8` was another floor: 34 of 46 are bound, so it passed
   while twelve parameters had no control in the bespoke editor at all.
   They are automatable and they work — a host can write automation for
   them — but nobody can reach them by hand from the plugin window. That is
   a real gap and it is also a design decision, so it is recorded as one
   here rather than left to a floor. Anything added to this list has to be
   put there deliberately; anything NEW that lands without a control fails
   this test until somebody chooses. */
var NO_CONTROL_YET = [
  'hold_taper', 'detect', 'det_os_x',       /* browser instrument has all three */
  'delta_band', 'sc_band', 'ts_split',      /* added round 9, plumbed round 10 */
  'b1_mute', 'b2_mute', 'b3_mute',
  'b1_solo', 'b2_solo', 'b3_solo',          /* browser has the whole band rack */
  /* A deliberate choice, not an oversight. It only means anything with
     2+ bands AND bypass engaged, the switch row is already full, and
     the default (dry) is the one almost everybody wants — the other
     setting is a measurement tool. Automatable, and in the browser. */
  'bypass_split'
];
var noControl = declared.filter(function (d) { return bound.indexOf(d) < 0; });
var unexpected = noControl.filter(function (d) { return NO_CONTROL_YET.indexOf(d) < 0; });
var nowFixed = NO_CONTROL_YET.filter(function (d) { return noControl.indexOf(d) < 0; });
ok(unexpected.length === 0,
   'editor binds ' + bound.length + ' of ' + declared.length + ' parameters; ' +
   'the ' + NO_CONTROL_YET.length + ' without a control are the ones on the ' +
   'record as not having one yet' +
   (unexpected.length ? '\n         NEW AND UNREACHABLE BY HAND: ' + unexpected.join(', ') : ''));
ok(nowFixed.length === 0,
   'and the list has no stale entries — everything on it is still missing a control' +
   (nowFixed.length ? '\n         these now HAVE controls, remove them from the list: ' + nowFixed.join(', ') : ''));
var missing = bound.filter(function (id) { return declared.indexOf(id) < 0; });
ok(missing.length === 0, 'every editor binding names a declared parameter' +
   (missing.length ? ' — MISSING: ' + missing.join(', ') : ''));
/* and no parameter is bound twice by different controls */
var boundTwice = [];
['delta', 'place', 'bands', 'rel_sync'].forEach(function (id) {
  var n = (edit.match(new RegExp('"' + id + '"', 'g')) || []).length;
  if (n > 1) boundTwice.push(id + '×' + n);
});
ok(boundTwice.length === 0, 'no parameter is wired to two controls' +
   (boundTwice.length ? ' — ' + boundTwice.join(', ') : ''));

/* ---- 3. the processor may only touch state fields the core has ---- */
console.log('\n— the processor matches the core state —');
var touched = [];
proc.replace(/\bs\.([a-zA-Z]+)/g, function (m, f) { touched.push(f); return m; });
touched = touched.filter(function (v, i) { return touched.indexOf(v) === i; });
var st = R.defaultState();
var CORE_ONLY = { band: 1, xover: 1, bpm: 1 };  /* arrays/host-fed, checked separately */
var badFields = touched.filter(function (f) {
  return !Object.prototype.hasOwnProperty.call(st, f) && !CORE_ONLY[f];
});
ok(badFields.length === 0, 'every state field the processor writes exists on the core' +
   (badFields.length ? ' — BAD: ' + badFields.join(', ') : ''));
ok(touched.indexOf('lookahead') < 0, 'no stale "lookahead" (the ND lineage calls it look)');
ok(proc.indexOf('s.sc.') < 0, 'no stale nested sc.* fields');

/* ---- 4. methods the editor calls must exist on the processor ---- */
console.log('\n— editor to processor interface —');
var called = [];
edit.replace(/proc\.([a-zA-Z]+)\(/g, function (m, f) { called.push(f); return m; });
called = called.filter(function (v, i) { return called.indexOf(v) === i; });
var missingM = called.filter(function (f) {
  return procH.indexOf(f + '(') < 0 && f !== 'apvts';
});
ok(missingM.length === 0, 'every proc.*() the editor calls is declared' +
   (missingM.length ? ' — MISSING: ' + missingM.join(', ') : ''));

/* ---- 5. the C++ core must mirror the JS core's surface ---- */
console.log('\n— the twin mirrors the core —');
/* Compare the twin against the core's ACTUAL version, not a literal.
   The previous form asserted a hardcoded "0.3" while claiming it matched
   the JS core — which said 0.1. It passed for two rounds while the two
   disagreed. An assertion that names the expected value instead of
   deriving it is not checking anything; it is restating itself. */
var twinVer = (core.match(/VERSION = "([^"]+)"/) || [])[1];
ok(twinVer === R.VERSION,
   'RigorCore.h version (' + twinVer + ') matches the JS core (' + R.VERSION + ')');
[['createMulti', 'class Multi'], ['createSplitter', 'class Splitter'],
 ['createMeter', 'class Meter'], ['suggestThreshold', 'suggestThreshold'],
 ['transferAt', 'transferAt'], ['bandMakeupDb', 'bandMakeupDb'],
 ['releaseMs', 'releaseMs']].forEach(function (p) {
  ok(core.indexOf(p[1]) >= 0, 'twin has ' + p[0]);
});
['delta', 'place', 'curve', 'bands', 'detOs', 'relSync', 'bpm'].forEach(function (f) {
  ok(new RegExp('\\b' + f + '\\b').test(core), 'twin State carries "' + f + '"');
});

/* ---- 6. the laws ---- */
/* ---- 6. NAMESPACE QUALIFICATION ----
   THE BUG THIS EXISTS FOR, 2026-08-22. `PluginEditor.cpp:315` wrote
   `(juce_wchar)` where the type is `juce::juce_wchar`. It was the single
   error in the macOS build and it cost RIGOR the first compiled binary in
   the estate — the only instrument still without one.

   Two things made it survive review. The double-barrelled name READS as
   though it is already qualified, and every other JUCE symbol in these
   files is written out in full, so nothing looked out of place. And these
   files carry no `using namespace juce`, so there is no fallback lookup.

   The rule is narrow and derivable: JUCE's lowercase `juce_`-prefixed
   types live inside namespace juce, so an unqualified one is always
   wrong here. Uppercase `JUCE_` macros are preprocessor and unaffected.
   This runs in the harness job in about two seconds, which is the point:
   it fails before a runner spends seventy of them finding out. */
console.log('\n— namespace qualification —');
(function () {
  var files = [['PluginEditor.cpp', edit], ['PluginEditor.h', editH],
               ['PluginProcessor.cpp', proc], ['PluginProcessor.h', procH],
               ['RigorCore.h', core]];
  /* The premise. If someone ever adds `using namespace juce`, the check
     below stops being meaningful and should be reconsidered rather than
     left running as decoration. */
  var usingNs = files.filter(function (f) { return /using namespace juce\s*;/.test(f[1]); });
  ok(usingNs.length === 0,
     'no file says `using namespace juce`, so every juce symbol must be qualified' +
     (usingNs.length ? ' — FOUND IN: ' + usingNs.map(function (f) { return f[0]; }).join(', ') : ''));

  var offenders = [];
  files.forEach(function (f) {
    /* Strip comments and #include lines before scanning. A scan that reads
       prose as code reports defects that are not there — and the comment
       four lines above this one names `juce_wchar` deliberately. Include
       paths legitimately contain `juce_audio_processors/juce_...h`. */
    var src = f[1]
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^[ \t]*\/\/.*$/gm, ' ')
      .replace(/^[ \t]*#\s*include.*$/gm, ' ');
    var re = /(::)?\bjuce_[a-z]\w*/g, m;
    while ((m = re.exec(src)) !== null) {
      if (m[1] === '::') continue;                       // already juce::juce_x
      var name = m[0];
      if (/^juce_(audio|core|events|graphics|gui|dsp|data)/.test(name)) continue; // module names
      var line = src.slice(0, m.index).split('\n').length;
      offenders.push(f[0] + ':' + line + ' — ' + name);
    }
  });
  ok(offenders.length === 0,
     'every juce_-prefixed type is written juce::juce_… — the bare form does ' +
     'not compile and looks qualified when it is not' +
     (offenders.length ? '\n      OFFENDERS: ' + offenders.join('\n                 ') : ''));

  /* PROVEN TO BITE. Reintroduce the exact defect against the real rule and
     watch it fail — a lint nobody has seen fail is a lint nobody should
     trust, and this project has shipped two of those already. */
  var probe = 'void f(){ x.set(juce::String::charToString((juce_wchar)(65))); }';
  var pm = /(::)?\bjuce_[a-z]\w*/.exec(probe);
  ok(pm && pm[1] !== '::' && pm[0] === 'juce_wchar',
     'and the rule is proven to catch the exact line that broke the macOS build');
  var clean = 'void f(){ x.set(juce::String::charToString(static_cast<juce::juce_wchar>(65))); }';
  var cm = /(::)?\bjuce_[a-z]\w*/.exec(clean);
  ok(cm && cm[1] === '::',
     'while the corrected form reads as qualified and passes');
})();

console.log('\n— INTERCHANGE laws —');
var cmake = fs.readFileSync(path.join(__dirname, '..', 'rigor-juce', 'CMakeLists.txt'), 'utf8');
ok(/-ffp-contract=off/.test(cmake), 'LAW 1: CMake sets -ffp-contract=off');
/* MOVED 2026-08-16 to the ESTATE ROOT ('..', '..'). GitHub reads workflows
   only from <repo-root>/.github/workflows, and the estate is rooted at
   CLAUDE/, so RIGOR/.github/workflows/rigor.yml was never going to execute.
   Asserting LAW 1 against a file nobody runs proves nothing. */
var ci = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'rigor.yml'), 'utf8');
ok(/-ffp-contract=off/.test(ci), 'LAW 1: CI compiles the parity gate with it too');
ok(/std::sin|std::cos|std::exp|std::log|std::pow/.test(core) === false,
   'LAW 2: the twin calls no libm transcendental directly');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
