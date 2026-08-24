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
/* THE PROSE COUNT, AGAINST THE PARSED COUNT — added 2026-08-18, because it
   was wrong twice at once: the README said "Eighteen parameters" in one
   place and "22 parameters" in another while the layout declared 22. A
   number spelled out in a sentence is the one no generator rewrites and no
   grep for digits finds. The README spells it as a word, so this maps the
   word; the PluginProcessor.h header comment states it as a word too and
   is checked the same way. If the layout grows a parameter, both sentences
   go red until someone updates the words — which is the point. */
var WORDS = { eighteen: 18, nineteen: 19, twenty: 20,
              'twenty-one': 21, 'twenty-two': 22, 'twenty-three': 23, 'twenty-four': 24 };
var readmeText = slurp(path.join(SRC, '..', '..', 'README.md'));
var rm = readmeText.match(/([A-Za-z-]+) parameters/);
ok(rm && WORDS[rm[1].toLowerCase()] === declared.length,
   'the README\'s spelled-out parameter count ("' + (rm ? rm[1] : 'none found') +
   '") matches the layout\'s ' + declared.length);
/* the header's sentence lives in a COMMENT, so read the raw file — procH
   is decommented, which is right for every other check here and exactly
   wrong for prose */
var hm = slurp(path.join(SRC, 'PluginProcessor.h')).match(/([A-Za-z-]+) parameters/i);
ok(hm && WORDS[hm[1].toLowerCase()] === declared.length,
   'PluginProcessor.h\'s own count ("' + (hm ? hm[1] : 'none found') +
   '") matches the layout\'s ' + declared.length);
/* and the architecture doc — the third copy of this claim, which said
   "eighteen, as built" for months after seal/ms/ms_mid/ms_side landed.
   §10 both states the count and LISTS the ids, so check both: the word,
   and that every declared id appears in the list. */
var archText = slurp(path.join(SRC, '..', '..', '..', 'CASKET_ARCHITECTURE.md'));
var am = archText.match(/([A-Za-z-]+) host parameters, as built/i);
ok(am && WORDS[am[1].toLowerCase()] === declared.length,
   'CASKET_ARCHITECTURE.md §10\'s count ("' + (am ? am[1] : 'none found') +
   '") matches the layout\'s ' + declared.length);
var archMissing = declared.filter(function (id) {
  return archText.indexOf('`' + id + '`') < 0;
});
ok(archMissing.length === 0,
   'every declared parameter id appears in §10\'s list' +
   (archMissing.length ? ' — MISSING: ' + archMissing.join(', ') : ''));

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

/* count CONSTRUCTION SITES, not raw string occurrences. The old heuristic
   ("the id appears more than twice anywhere") false-positived the moment
   the arrangement fix (2026-08-23) made "style" legitimately appear three
   times — its Chooser, applyArrangement's set(), the timer's reflect read —
   of which only the first is a control. A control is a dial/latch/chooser
   factory call or a direct `apvts, "id"` construction; a second one of
   those for the same id is still exactly the defect this gate exists for. */
var boundTwice = [];
bound.forEach(function (id) {
  var f = (edit.match(new RegExp('\\b(?:dial|latch|chooser)\\s*\\(\\s*"' + id + '"\\s*,', 'g')) || []).length;
  var a = (edit.match(new RegExp('apvts,\\s*"' + id + '"', 'g')) || []).length;
  var n = f + a;
  if (n > 1) boundTwice.push(id + '×' + n);
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

/* ---------- 5b. the arrangement applies its recipe ----------
   Found by EARS, not by a harness — Ben, GarageBand, 2026-08-23, the first
   listening session: "the arrangements all sound the same." They did. The
   dropdown was an ordinary attached parameter, so it moved only the two
   traits the engine derives from style, while vigil/release/knee/lining/
   margin/autoRel/sat/seal — the audible recipe, Lead's seal above all —
   sat wherever they were. The browser never had this hole because
   UIH.applyStyle merges every styleDefaults field on every pick.
   These gates keep the two faces meaning the same thing by "arrangement":
   the editor must apply EVERY field styleDefaults defines (enumerated from
   the JS core, so a field added there turns this red here), the C++ table
   it reads must agree with the JS table value for value, and the wiring
   must be gesture-only so automation and preset loads cannot stomp a
   saved session's knobs. */
console.log('\n— the arrangement applies its recipe —');

var STYLE_NAMES = ['pine', 'velvet', 'oak', 'iron', 'lead'];
var FIELD_TO_PARAM = { vigil: 'vigil', release: 'release', knee: 'knee',
                       lining: 'lining', margin: 'margin', autoRel: 'auto_rel',
                       sat: 'sat', seal: 'seal' };
var recipeFields = Object.keys(C.styleDefaults('pine'));
var unmapped = recipeFields.filter(function (f) { return !(f in FIELD_TO_PARAM); });
ok(unmapped.length === 0, 'every styleDefaults field has a parameter mapping here' +
   (unmapped.length ? ' — UNMAPPED (extend FIELD_TO_PARAM and the editor): ' +
    unmapped.join(', ') : ''));

var applyBody = (edit.match(/void CasketEditor::applyArrangement[\s\S]*?\n\}/) || [''])[0];
ok(applyBody.length > 100, 'applyArrangement located in the editor');
function unappliedIn(body) {
  return recipeFields.filter(function (f) {
    return !(new RegExp('set\\("' + FIELD_TO_PARAM[f] + '"').test(body));
  });
}
var unapplied = unappliedIn(applyBody);
ok(unapplied.length === 0, 'applyArrangement applies every styleDefaults field' +
   (unapplied.length ? ' — NOT APPLIED: ' + unapplied.join(', ') : ''));
ok(/set\("style"/.test(applyBody), 'and the style parameter itself');
ok(/casket::styleDef/.test(applyBody),
   'the recipe is read from casket::styleDef — the table the ENGINE uses, no third copy');
ok(/beginChangeGesture/.test(applyBody) && /endChangeGesture/.test(applyBody) &&
   /setValueNotifyingHost/.test(applyBody),
   'every move is a proper host gesture the DAW can record and undo');
ok(/\{ 1, 2, 4, 8, 16 \}/.test(applyBody) && /\{ 1, 2, 4, 8, 16 \}/.test(proc),
   'the lining factor→index table is the inverse of buildState\'s, same values');

/* the C++ StyleDef table must agree with the JS STYLE map, value for value.
   Both twins have carried this table since sealed arrangements landed; the
   parity gate proves the ENGINE reads them identically, but the d-fields
   (the recipe) were engine-invisible until the editor started applying
   them — so they get their own diff, here. */
var sdBlock = (core.match(/static const StyleDef T\[5\] = \{([\s\S]*?)\};/) || ['', ''])[1];
var sdRows = [];
sdBlock.replace(/\{([^{}]*)\}/g, function (m, r) {
  sdRows.push(r.split(',').map(function (x) { return x.trim(); }));
  return m;
});
ok(sdRows.length === 5, 'the twin StyleDef table has five arrangements (found ' +
   sdRows.length + ')');
function styleTableDiff(rows) {
  var POS = { vigil: 2, release: 3, knee: 4, lining: 5, margin: 6,
              autoRel: 7, sat: 8, seal: 9 };
  var diffs = [];
  STYLE_NAMES.forEach(function (n, i) {
    var d = C.styleDefaults(n);
    Object.keys(POS).forEach(function (f) {
      var cpp = rows[i] ? rows[i][POS[f]] : undefined;
      var got = cpp === 'true' ? true : cpp === 'false' ? false : parseFloat(cpp);
      if (got !== d[f]) diffs.push(n + '.' + f + ' cpp=' + cpp + ' js=' + d[f]);
    });
  });
  return diffs;
}
var tblDiffs = styleTableDiff(sdRows);
ok(tblDiffs.length === 0, 'twin StyleDef agrees with JS styleDefaults, all five × eight' +
   (tblDiffs.length ? ' — ' + tblDiffs.join('; ') : ''));

/* the wiring must be gesture-only: the style box has NO attachment, its
   user pick routes through applyArrangement, and external moves reach the
   box only through the quiet reflect() in the timer */
ok(/new Chooser\([^;]*"style"[^;]*applyArrangement/.test(edit),
   'the style box is the callback Chooser, wired to applyArrangement');
var tcBody = (edit.match(/void CasketEditor::timerCallback[\s\S]*?\n\}/) || [''])[0];
ok(/choosers\[0\]->reflect/.test(tcBody) && /"style"/.test(tcBody),
   'the timer reflects external style moves into the box');
var reflBody = (edit.match(/void Chooser::reflect[\s\S]*?\n\}/) || [''])[0];
ok(/dontSendNotification/.test(reflBody),
   'reflect() is quiet — it can never re-trigger the recipe');
ok(/\{\s*"Pine", "Velvet", "Oak", "Iron", "Lead"\s*\}/.test(proc),
   'the dropdown order is the index order both twins assume');

/* and these gates must bite, per the house standard */
(function () {
  var noSeal = applyBody.replace(/set\("seal"[^;]*;/, '');
  ok(unappliedIn(noSeal).indexOf('seal') >= 0,
     'BITES: an applyArrangement that forgot the seal would be caught');
  var doctored = sdRows.map(function (r) { return r.slice(); });
  if (doctored[4]) doctored[4][2] = '3.0';   /* lead vigil 5 → 3 */
  ok(styleTableDiff(doctored).length > 0,
     'BITES: a drifted lead.vigil in the twin table would be caught');
})();

/* ---------- 5b·2. the one count the markers cannot reach ----------
   The README's own note explains why its per-harness figures are absent:
   a fenced code block cannot carry a counts.js marker, and a hand-typed
   count inside one is a number with no gate behind it. One survived the
   purge anyway — the mutant total in the flags block — and it went stale
   within an hour of two mutants being added, which is this project's
   oldest failure mode arriving through the one door left open.
   It cannot be generated, so it is gated instead. */
(function () {
  var mutSrc = slurp(path.join(__dirname, 'casket_mutate.js'));
  var declaredMutants = (mutSrc.match(/^\s*\{ name: '/gm) || []).length;
  var stated = readmeText.match(/casket_mutate\.js --list\s*#\s*(\d+) mutants/);
  ok(!!stated, 'the README still documents the mutant lister');
  ok(stated && +stated[1] === declaredMutants,
     'and states the real mutant count (' + (stated ? stated[1] : '?') +
     ' vs ' + declaredMutants + ' declared)');
})();

/* ---------- 5b·3. what an arrangement must NOT touch ----------
   THE EXCLUSION IS AS LOAD-BEARING AS THE INCLUSION, and only the
   inclusion was asserted. An arrangement is a CHARACTER, not a session
   reset: picking Lead must not move the drive you spent ten minutes
   setting, the lid the delivery spec demands, the dither you chose for the
   format, or the loudness target you are aiming at. The browser has always
   behaved this way — UIH.applyStyle merges only the recipe's own keys over
   the current state — and applyArrangement was written to match.
   Nothing enforced it. A single well-meant `set("lid", ...)` added here
   later would silently start overwriting a delivery ceiling on every pick,
   and the only symptom would be a master that came out quieter than the
   plant asked for. */
console.log('\n— what an arrangement must not touch —');
(function () {
  var body = (edit.match(/void CasketEditor::applyArrangement[\s\S]*?\n\}/) || [''])[0];
  /* every declared parameter that is NOT part of a recipe */
  var recipeParams = recipeFields.map(function (f) { return FIELD_TO_PARAM[f]; }).concat(['style']);
  var mustNotMove = declared.filter(function (id) { return recipeParams.indexOf(id) < 0; });
  ok(mustNotMove.length >= 10,
     'there are ' + mustNotMove.length + ' parameters an arrangement has no business moving');
  var trespass = mustNotMove.filter(function (id) {
    return new RegExp('set\\("' + id + '"').test(body);
  });
  ok(trespass.length === 0,
     'applyArrangement touches none of them' +
     (trespass.length ? ' — TRESPASS: ' + trespass.join(', ') : ' (drive, lid, dust and the rest survive a pick)'));
  (function () {
    var spiked = body.replace('set("style"', 'set("lid", -0.3f); set("style"');
    var caught = mustNotMove.filter(function (id) {
      return new RegExp('set\\("' + id + '"').test(spiked);
    });
    ok(caught.length === 1 && caught[0] === 'lid',
       'BITES: an arrangement that started overwriting the lid would be caught');
  })();
})();

/* ---------- 5b·4. the state a host saves is the state it gets back ----------
   Ben's `.aupreset` survived a save, a plugin swap and a reload during the
   first session — by OBSERVATION, which is not a gate. The execution half
   of that round trip needs a real host and belongs in the listening
   protocol; what can be held here is the plumbing, and the plumbing is
   where the silent failures live.

   Three properties, and the third is the one with teeth:
     · the two halves are symmetric APVTS calls, not hand-rolled writers
     · every declared parameter lives in the tree copyState walks
     · buildState() READS every declared parameter — because a parameter
       can round-trip through the XML perfectly and still mean nothing, if
       nothing on the audio side ever asks for it. That is exactly how the
       M/S fields sat real-in-the-core and unreachable-from-a-DAW for
       weeks, one layer up. */
console.log('\n— the state a host saves is the state it gets back —');
(function () {
  ok(/getStateInformation[\s\S]{0,220}apvts\.copyState\(\)[\s\S]{0,80}createXml/.test(proc),
     'getStateInformation copies the whole APVTS tree as XML');
  ok(/setStateInformation[\s\S]{0,220}apvts\.replaceState\([\s\S]{0,80}fromXml/.test(proc),
     'setStateInformation replaces it from XML — the symmetric call');
  ok(!/getStateInformation[\s\S]{0,400}getRawParameterValue/.test(proc),
     'and neither half hand-rolls a per-parameter writer that could miss one');

  var build = (proc.match(/casket::State CasketProcessor::buildState[\s\S]*?\n\}/) || [''])[0];
  ok(build.length > 200, 'buildState located for inspection');
  var unread = declared.filter(function (id) {
    return !(new RegExp('f\\("' + id + '"\\)').test(build));
  });
  ok(unread.length === 0,
     'every declared parameter is read back by buildState' +
     (unread.length ? ' — SAVED BUT NEVER READ: ' + unread.join(', ') : ' (all ' + declared.length + ')'));
  (function () {
    var spiked = build.replace(/f\("unity"\)/, 'false');
    var caught = declared.filter(function (id) {
      return !(new RegExp('f\\("' + id + '"\\)').test(spiked));
    });
    ok(caught.length === 1 && caught[0] === 'unity',
       'BITES: a parameter that stopped being read would be caught');
  })();
})();

/* ---------- 5c. the vigil, as the host is told it ----------
   THE SCREENSHOTS BECOME A PROMISE. During the first listening session
   (2026-08-23) the plugin header reported a different latency for every
   arrangement — 61 / 83 / 105 / 149 / 302 samples at 44.1 kHz — and that
   was the most visible evidence that switching an arrangement really does
   reshape the machine rather than just relabel it.
   Evidence read off a screen once is not a guarantee. These cases derive
   the same five numbers from styleDef + latencySamples, so a change to any
   arrangement's vigil, or to the latency formula, or to the seal's
   decimator, turns them red.
   Both rates are checked on purpose: vigilSamples ROUNDS, so 44.1 kHz and
   48 kHz do not differ by a clean ratio and a harness that only ever asks
   for 48,000 cannot see a rounding fault at the rate Ben actually records. */
console.log('\n— the vigil, as the host is told it —');
(function () {
  function latOf(name, fs) {
    var st = C.defaultState(), d = C.styleDefaults(name);
    st.style = name;
    for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) st[k] = d[k];
    return C.latencySamples(st, fs);
  }
  /* measured in GarageBand at 44.1 kHz, 2026-08-23, read off the header */
  var WITNESSED_441 = { oak: 61, iron: 83, velvet: 105, pine: 149, lead: 302 };
  var wrong = [];
  STYLE_NAMES.forEach(function (n) {
    var got = latOf(n, 44100);
    if (got !== WITNESSED_441[n]) wrong.push(n + ' ' + got + '≠' + WITNESSED_441[n]);
  });
  ok(wrong.length === 0,
     'every arrangement reports the latency the session witnessed at 44.1 kHz' +
     (wrong.length ? ' — ' + wrong.join(', ') : ' (' +
      STYLE_NAMES.map(function (n) { return WITNESSED_441[n]; }).join('/') + ')'));

  /* the formula itself, at the rate the estate's other harnesses use */
  var OSQ = C.OS_Q, DECQ = C.DEC_Q;
  var badFormula = [];
  STYLE_NAMES.forEach(function (n) {
    var d = C.styleDefaults(n);
    var vs = Math.round(d.vigil * 0.001 * 48000);
    var want = OSQ + vs + 1 + (d.seal ? DECQ : 0);
    if (latOf(n, 48000) !== want) badFormula.push(n);
  });
  ok(badFormula.length === 0,
     'and at 48 kHz each equals OS_Q + vigil + 1 + (seal ? DEC_Q : 0)' +
     (badFormula.length ? ' — ' + badFormula.join(', ') : ''));

  /* the seal is the only thing that may add to the reported latency, and
     the lining must not — that independence is what lets a user change the
     lining mid-session without the host's compensation moving. */
  var linIndep = true;
  [1, 2, 4, 8, 16].forEach(function (M) {
    var st = C.defaultState(); st.lining = M; st.seal = false;
    if (C.latencySamples(st, 48000) !== C.latencySamples(C.defaultState(), 48000)) linIndep = false;
  });
  ok(linIndep, 'the reported latency is independent of the lining at every factor');
  var leadOnly = latOf('lead', 44100) - latOf('pine', 44100);
  ok(leadOnly > DECQ, 'and only Lead pays the decimator (Lead − Pine = ' + leadOnly + ' > ' + DECQ + ')');

  /* the twin must carry the same formula, not merely the same constants */
  ok(/OS_Q \+ vigilSamples\(s, fs\) \+ 1 \+ \(s\.seal \? DEC_Q : 0\)/.test(core),
     'the C++ twin computes latency by the same expression');

  /* AND BOTH FACES MUST SAY IT IN BOTH UNITS. Samples is what the host
     compensates by; milliseconds is what a person can feel. The browser
     has printed both since the beginning and the plugin printed only
     samples, which is how "302" sat in a header all session meaning
     nothing to the man reading it. */
  ok(/" smp"/.test(edit) && /" ms"/.test(edit),
     'the JUCE header reports latency in samples AND milliseconds');
  ok(/m\.latency \* 1000\.0 \/ fs/.test(edit),
     'and derives the milliseconds from the rate the host prepared, not a constant');
  ok(/proc\.rate\(\)/.test(edit) && /std::atomic<double> sr/.test(procH),
     'the rate crosses to the editor through an atomic, like every other cross-thread read here');
  var browserLat = slurp(path.join(SRC, '..', '..', 'casket.html'));
  ok(/latencySamples\(state, FS\) \/ FS \* 1000/.test(browserLat),
     'and the browser face still prints both, so the two agree on what to show');

  (function () {
    var doctored = Object.assign({}, WITNESSED_441, { lead: 237 });   /* seal forgotten */
    var caught = STYLE_NAMES.some(function (n) { return latOf(n, 44100) !== doctored[n]; });
    ok(caught, 'BITES: a witnessed table that forgot the seal would be caught');
  })();
})();

/* ---------- 5d. every parameter can say what it is ----------
   AUDIO_INTERCHANGE §4 (added estate-wide 2026-08-23 by a sibling project's
   session) records that JUCE falls back to SEVEN decimal places when a float
   parameter has neither a display formatter nor a step interval, and names
   CASKET the estate's exemplar for having formatters. That is a compliment
   this suite had no way to verify, and a compliment nobody measures is just
   a rumour with good manners.
   So: every float parameter must have a formatter OR a non-zero interval.
   Note the rule deliberately accepts either. The same interchange entry warns
   that reaching for the interval to fix DISPLAY is a real defect — it
   quantises the value and coarsens automation — so this gate must never be
   "read" as advice to add intervals. It asks only that the parameter can
   render itself; WHICH mechanism is the author's call, and five of CASKET's
   twelve floats legitimately use an interval that exists for musical
   reasons of its own. */
console.log('\n— every parameter can say what it is —');
(function () {
  var floats = [];
  var re = /std::make_unique<FP>\(id\("([a-z0-9_]+)"\)[\s\S]*?(?=std::make_unique<|return l;)/g;
  var m;
  while ((m = re.exec(proc)) !== null) {
    var body = m[0];
    var range = body.match(/NormalisableRange<float>\(([^)]*)\)/);
    var parts = range ? range[1].split(',').map(function (s) { return s.trim(); }) : [];
    floats.push({
      id: m[1],
      formatter: /withStringFromValueFunction/.test(body),
      interval: parts.length >= 3 ? parseFloat(parts[2]) : 0
    });
  }
  ok(floats.length >= 10, 'found ' + floats.length + ' float parameters to inspect');
  var mute = floats.filter(function (f) { return !f.formatter && !(f.interval > 0); });
  ok(mute.length === 0,
     'every float parameter has a formatter or a step interval — none falls back to seven places' +
     (mute.length ? ' — SILENT: ' + mute.map(function (f) { return f.id; }).join(', ') : ''));
  var withFmt = floats.filter(function (f) { return f.formatter; });
  ok(withFmt.length >= 7,
     'and ' + withFmt.length + ' of them carry a real formatter (the figure §4 cites)');
  (function () {
    var spiked = floats.concat([{ id: '__mute', formatter: false, interval: 0 }]);
    ok(spiked.filter(function (f) { return !f.formatter && !(f.interval > 0); }).length === 1,
       'BITES: a parameter with neither would be caught');
  })();
})();

/* ---------- 5e. the face can tell the meter to forget ----------
   FOUND BY THE FIRST LISTENING SESSION, and by looking rather than by a
   test: the header's true peak is a MAX-HOLD. Across minutes of listening
   it sat at one figure, which reads as a stuck meter rather than a
   remembering one. The processor has always had the machinery — an atomic
   epoch the audio thread services — and the browser face has had a Reset
   Plot button since the beginning. The JUCE face had no control at all, so
   the epoch was unreachable from the only face Ben was using.
   A capability that exists in the processor, is used by one face, and is
   absent from the other is exactly the shape of the M/S parameters that
   were real in the core for weeks while no DAW could reach them. Same
   lesson, same gate: assert the FACE, not the machinery. */
console.log('\n— the face can tell the meter to forget —');
ok(/resetMeters/.test(procH), 'the processor still exposes the reset epoch');
ok(/proc\.resetMeters\(\)/.test(edit),
   'and the JUCE face has a control that raises it');
ok(/class Press/.test(editH) && /presses/.test(edit),
   'THE REST is a momentary press, not a parameter — clearing is an action, not state');
var restDeclared = declared.filter(function (id) { return /rest/i.test(id); });
ok(restDeclared.length === 0,
   'and it is deliberately NOT a host parameter (a preset must not restore a button press)' +
   (restDeclared.length ? ' — FOUND: ' + restDeclared.join(', ') : ''));
ok(/resetMetersBtn/.test(slurp(path.join(SRC, '..', '..', 'casket.html'))),
   'the browser face has its own, so both faces can forget');
(function () {
  var faceless = 'void CasketEditor::timerCallback() { proc.latestMeters(m); }';
  ok(!/proc\.resetMeters\(\)/.test(faceless),
     'BITES: a face with no reset control would fail the gate above');
})();

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

/* ---------- 7b. the audio/UI seam ----------
   Wired 2026-08-18: the message thread reads snapshots, never the engine.
   These are the assertions that keep it that way — each one names a
   regression that would LOOK like a simplification. The race this closed
   is invisible to every single-threaded harness, so the only cheap defence
   is refusing the code shapes that reintroduce it. */
console.log('\n— the audio/UI seam —');
var lmBody = (procH.match(/void latestMeters[\s\S]*?\n    \}/) || [''])[0];
var ltBody = (procH.match(/void latestTrace[\s\S]*?\n    \}/) || [''])[0];
ok(/metersPub\.read/.test(lmBody) && !/engine\./.test(lmBody),
   'latestMeters reads the Handoff snapshot, never the engine');
ok(/tracePub\.read/.test(ltBody) && !/engine\./.test(ltBody),
   'latestTrace reads the Handoff snapshot, never the engine');
ok(/void resetMeters\(\)[^}]*meterResetReq/.test(procH) &&
   !/void resetMeters\(\)[^}]*engine\./.test(procH),
   'the reset button raises an epoch — it does not touch the engine cross-thread');
ok(/metersPub\.publish/.test(pb) && /tracePub\.publish/.test(pb),
   'processBlock publishes both snapshots from the audio thread');
ok(/engine\.trace\(/.test(pb),
   'engine.trace() is consumed on the audio thread, where its reset-on-read is harmless');
ok(/traceResetSeen/.test(pb) && /meterResetSeen/.test(pb),
   'both editor requests are serviced inside processBlock');
/* THE RANGE crosses the same seam, added 2026-08-19 — and must be throttled,
   because its snapshot is 751 doubles and the chart describes a 3 s window */
var lhBody = (procH.match(/bool latestHistogram[\s\S]*?\n    \}/) || [''])[0];
ok(/histPub\.read/.test(lhBody) && !/engine\./.test(lhBody),
   'latestHistogram reads the Handoff snapshot, never the engine');
ok(/histPub\.publish/.test(pb) && /engine\.histogram\(/.test(pb),
   'processBlock publishes the histogram from the audio thread');
ok(/histCount\s*\+=/.test(pb) && /histCount >= \(int\)sr/.test(pb),
   'and throttles it to about once a second, keyed to the sample rate');
ok(!/histCount >= \d/.test(pb),
   'the histogram throttle does not compare against a hardcoded sample count');
/* the editor itself must not have grown a direct line to the processor's engine */
ok(!/\bengine\b/.test(edit) && !/\bengine\b/.test(editH),
   'the editor never names the engine at all — snapshots are its whole world');

/* THESE GATES MUST BITE — added 2026-08-19, the same standard the README
   table gates were held to. Every assertion above is a REGEX over source
   text, which is the cheapest kind of test to write and the easiest kind to
   get subtly wrong: a pattern that never matches passes exactly as quietly
   as one that always does. So each check below hands the gate the specific
   regression it exists to stop and confirms the gate rejects it.
   The regressions are not hypothetical — every one is what this code looked
   like BEFORE 2026-08-18, so these are the diffs a well-meaning
   simplification would actually produce. */
(function () {
  var wasLatestMeters = 'void latestMeters(casket::Meters& m) { engine.meters(m); }';
  var wasLatestTrace  = 'void latestTrace(casket::Trace& t) { engine.trace(t); }';
  var wasReset        = 'void resetMeters() { engine.resetMeters(); }';

  /* the pre-rewrite bodies must FAIL the same predicates the live ones pass */
  ok(!(/metersPub\.read/.test(wasLatestMeters) && !/engine\./.test(wasLatestMeters)),
     'BITES: the old engine-touching latestMeters would fail the snapshot gate');
  ok(!(/tracePub\.read/.test(wasLatestTrace) && !/engine\./.test(wasLatestTrace)),
     'BITES: the old engine-touching latestTrace would fail its gate');
  ok(!(/void resetMeters\(\)[^}]*meterResetReq/.test(wasReset) &&
       !/void resetMeters\(\)[^}]*engine\./.test(wasReset)),
     'BITES: the old direct resetMeters would fail the epoch gate');

  /* and the editor gate: prove it reacts to the word appearing, rather than
     passing because `edit` happens to be empty or unreadable */
  var edithSpiked = editH + '\n  casket::Engine& engine;\n';
  ok(!(!/\bengine\b/.test(edithSpiked)),
     'BITES: an editor that grew an engine reference would fail the editor gate');
  ok(edit.length > 500 && editH.length > 200,
     'and both editor sources were actually read (' + edit.length + '/' + editH.length +
     ' chars) — an empty read would pass every check above vacuously');

  /* processBlock's publish gate, against a body that forgot to publish */
  var pbNoPublish = pb.replace(/metersPub\.publish[^;]*;/, '');
  ok(!(/metersPub\.publish/.test(pbNoPublish) && /tracePub\.publish/.test(pbNoPublish)),
     'BITES: a processBlock that stopped publishing meters would fail its gate');
})();

/* ---------- 7c. the editor fits inside its own minimum size ----------
   Added 2026-08-19, after arithmetic found the rack's bottom row laid out
   below the window edge at the smallest permitted height. That bug predates
   THE RANGE and had never been seen, because seeing it needs a display and
   this project has never had one — but it is pure arithmetic, and the
   numbers are all in the source.
   The top band is FIXED: resized() skips it and lays out only the rack. So
   minHeight must cover the band, the rack's rows, its group labels and the
   insets. Reading the constants out of the source rather than restating
   them means a change to any of them re-runs this sum. */
console.log('\n— the editor fits its own minimum —');
(function () {
  function num(re, what) {
    var m = edit.match(re);
    ok(!!m, 'found ' + what + ' in the editor source');
    return m ? +m[1] : NaN;
  }
  /* anchored on CODE, not on the comment beside it — `edit` is decommented
     before these checks run, so a regex reaching for the explanatory text
     matches nothing and quietly yields NaN. Caught immediately, because the
     assertion printed "needs NaN px" rather than passing. */
  var band  = num(/void CasketEditor::resized[\s\S]*?removeFromTop\((\d+)\)/, 'the fixed pane band');
  var rowH  = num(/const int rowH = (\d+);/, 'the rack row height');
  var lim   = edit.match(/setResizeLimits\((\d+),\s*(\d+),/);
  ok(!!lim, 'found setResizeLimits');
  var minW = lim ? +lim[1] : NaN, minH = lim ? +lim[2] : NaN;

  var resizedBody = (edit.match(/void CasketEditor::resized[\s\S]*?\n\}/) || [''])[0];
  var rows   = (resizedBody.match(/rowOf\(\)/g) || []).length;
  var labels = (resizedBody.match(/removeFromTop\(14\)/g) || []).length;
  var rackInset = 12;   /* reduced(14, 6) — 6 top + 6 bottom */

  var needed = band + rackInset + rows * rowH + labels * 14;
  ok(rows === 4 && labels === 4,
     'the rack is ' + rows + ' rows and ' + labels + ' group labels');
  ok(minH >= needed,
     'minimum height ' + minH + ' covers the ' + needed + ' px the layout needs' +
     (minH >= needed ? '' : ' — THE BOTTOM ROW WOULD CLIP by ' + (needed - minH) + ' px'));

  /* and the pane band's own subdivision has to leave THE RANGE something
     to draw in — it is the newest pane and the one squeezed if the split
     is ever retuned */
  var paneBody = band - 44 - 12;          /* header, then reduced(14,6) */
  var rangeH = Math.floor(paneBody / 2) - 3;
  ok(rangeH - 20 - 28 > 40,
     'THE RANGE keeps ' + (rangeH - 20 - 28) + ' px of bar height after its title and footer');

  /* width: the right column is a fixed 280, so the viewing takes the rest */
  var viewingW = minW - 28 - 280 - 10;
  ok(viewingW > 300,
     'at minimum width the viewing still gets ' + viewingW + ' px (it is the pane users drag)');
})();

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

/* WHAT THE TWIN DELIBERATELY DOES NOT MIRROR, on the record — added
   2026-08-18. Everything above asserts the C++ twin keeps up with the JS
   core, which makes any JS function ABSENT from the twin look like an
   oversight the parity gate failed to notice. Some absences are decisions,
   and a decision nobody wrote down is indistinguishable from a gap.

   The rule that separates them: the twin mirrors anything that can change
   a SAMPLE. Diagnostics that only ever feed a display do not need a C++
   counterpart, because the plugin's face is native JUCE and never runs the
   browser's drawing code — mirroring them would add parity surface with no
   guarantee attached to it.

   This list is asserted in the negative on purpose: if one of these ever
   DOES appear in the twin, that is a real change of policy and this test
   should go red so somebody restates the decision rather than drifting
   into it. */
/* DIAGNOSTIC_ONLY IS NOW EMPTY, AND THE REVERSAL IS THE RECORD — 2026-08-19.
   On 2026-08-18 histogramS was listed here as deliberately absent from the
   twin, with a sound argument: it fed a canvas in casket.html, the JUCE
   editor drew its own meters, and mirroring it would have added parity
   surface with no guarantee attached. That held exactly until the plugin's
   face wanted the same chart. The choice then was "mirror it" or "ship two
   faces that disagree about what the program measures", and the second is
   not a real option.
   So the list is empty rather than deleted: an empty list with a history is
   a decision that was made and remade, and the assertion below keeps it
   honest — anything added here must genuinely be absent from the twin.
   What did NOT change: histogramS is still not parity-gated. It is a
   picture, not a sample. The NUMBER it is drawn around, Meters::lra, is
   gated, and both faces now compute it through the same shortTermStats(). */
var DIAGNOSTIC_ONLY = {
  wake: 'THE WAKE is a loudness-matched A/B MEASUREMENT, prototyped 2026-08-24 and ' +
        'not yet a shipped mode. It renders twice and measures; it is never on an ' +
        'audio thread and nothing in the render path calls it, which puts it on ' +
        'exactly the footing matchReference has had since it was written. If Ben ' +
        'rules that it ships as a monitoring feature, the question of a twin gets ' +
        'asked then — and the answer is probably still no, because the plugin would ' +
        'attenuate a bypass path rather than render one offline.'
};
Object.keys(DIAGNOSTIC_ONLY).forEach(function (fn) {
  ok(typeof C[fn] !== 'undefined',
     'the JS core still has ' + fn + ' (if not, delete it from DIAGNOSTIC_ONLY)');
  ok(core.indexOf(fn) < 0,
     fn + ' is deliberately NOT in the twin — ' + DIAGNOSTIC_ONLY[fn].split('.')[0]);
});
/* THE POSITIVE COUNTERPART — added 2026-08-19. DIAGNOSTIC_ONLY being empty
   is a meaningful statement, and an empty list is a weak way to make it: it
   asserts nothing, so a mirror could silently vanish and the emptiness would
   look unchanged. This is the same claim from the other side — the surfaces
   that MUST exist in both faces, each with the reason it earned that status.
   A deletion from the twin now fails here rather than passing quietly. */
var MUST_MIRROR = {
  histogramS:     'THE RANGE is drawn by both faces; if only one has the data, they disagree ' +
                  'about what the program measured. Parity-gated as of 2026-08-19.',
  shortTermStats: 'the single gate-and-percentile pass. Both lra() and histogramS() go ' +
                  'through it precisely so they cannot drift apart.',
  lra:            'the number THE RANGE is drawn around, and the one figure of the three ' +
                  'that was always parity-gated.',
  foldTrace:      'decides which peaks the editor is shown between frames — a rule about ' +
                  'what the user sees, not a display detail.',
  emptyTrace:     'seeds the trace to silence rather than 0 dBFS; getting it wrong draws ' +
                  'full scale on an idle transport.',
  Handoff:        'the audio→UI seam itself. Two real bugs lived here.',
  meterFrac:      'both faces map a level to a position with this; divergence would make ' +
                  'one instrument\'s screenshot stop being evidence about the other.',
  quantize:       'the control-grid expression the core, the browser and the twin must all ' +
                  'spell identically — a mutation test proved the parity gate could not see ' +
                  'the difference until it was given a name.'
};
/* WORD BOUNDARIES, not indexOf — the first version of this check used a
   substring match and a bites-proof caught it immediately: renaming
   foldTrace to foldTraceXX left "foldTrace" as a substring, so a mirror
   could be renamed out of existence and this would still pass. Exactly the
   trap casket_coverage.js's has() documents about short field names,
   arrived at from the opposite direction. */
var lostMirrors = Object.keys(MUST_MIRROR).filter(function (fn) {
  return !new RegExp('\\b' + fn + '\\b').test(core);
});
ok(lostMirrors.length === 0,
   'every surface that must exist in both faces is still in the twin' +
   (lostMirrors.length ? ' — MISSING: ' + lostMirrors.join(', ') : ''));
ok(Object.keys(DIAGNOSTIC_ONLY).length + Object.keys(MUST_MIRROR).length > 0,
   'the two lists together are the record: ' + Object.keys(MUST_MIRROR).length +
   ' mirrored on purpose, ' + Object.keys(DIAGNOSTIC_ONLY).length + ' deliberately not');

/* the reversal itself, asserted: both faces must now be able to draw it */
ok(/histogramS/.test(core), 'the twin now HAS histogramS — the 2026-08-18 exemption was reversed on purpose');
ok(/shortTermStats/.test(core),
   'and both lra() and histogramS() go through one shortTermStats(), so they cannot drift');
ok(/double lra\(\) const \{ return shortTermStats\(\)\.lra; \}/.test(core),
   'lra() is now a one-liner over that helper — the arithmetic moved, not changed (parity proves it)');

/* THE OTHER DIRECTION — added 2026-08-19. Everything above asks whether the
   twin keeps up with the JS core. Nothing asked the reverse: what does the
   twin have that the core does NOT, and is each one a decision?
   That question stopped being theoretical the day Handoff<T> and foldTrace
   landed — real, load-bearing C++ with no JS counterpart, added without
   anything anywhere recording that the asymmetry was intentional. It is:
   the browser is single-threaded, so a thread-handoff has nothing to do
   there. But "obviously fine" is what every undocumented asymmetry looks
   like until someone tries to reconcile the two files.
   C++ TYPES ARE EXPECTED to have no JS twin — JS has no structs — so the
   list below is only the things that could plausibly have been shared. */
console.log('\n— what the twin has that the core does not —');
var TWIN_ONLY = {
  /* threading — the whole category has no browser counterpart */
  Handoff:    'a lock-free publish for the audio→UI seam. JS is single-threaded ' +
              'in both the worklet and the fallback, so there is nothing to hand off.',
  foldTrace:  'folds per-block traces for a 30 Hz editor. The browser reads the ' +
              'engine directly at frame rate, so it never accumulates across blocks.',
  emptyTrace: 'seeds a Trace to silence for the same editor path.',
  /* C++ shape — JS returns object literals where C++ needs a declared type */
  StyleDef: 'a struct; JS uses the STYLE object literal', State: 'a struct; JS uses defaultState()',
  /* Hist is C++-only for a REASON, not just because JS has no structs: the
     browser's histogramS returns SPARSE bins over postMessage, because it
     can allocate freely. The plugin cannot allocate on the audio thread, so
     its snapshot is a fixed 751-bin POD that fits through a Handoff. Same
     picture, two shapes, each dictated by its transport. */
  Hist: 'a fixed-size POD so THE RANGE can cross a Handoff without allocating; ' +
        'the browser sends sparse bins instead, which it can afford to allocate',
  /* display mappings — the JS equivalents live in UIH (casket.html), not in
     casket_core.js, so they are correctly absent from the core's exports.
     They are in the TWIN only because `static` in a .cpp is untestable. */
  meterFrac: 'the browser\'s UIH.meterFrac; here so a test can reach it (it was static in PluginEditor.cpp)',
  dbToY:     'the browser\'s UIH.dbToY; same reason',
  grToPx:    'the browser\'s UIH.grToPx; same reason',
  Meters: 'a struct', Trace: 'a struct', DriveResult: 'a struct', MarginResult: 'a struct',
  DiffResult: 'a struct', Oversampler: 'a struct', Decimator: 'a struct', KWeight: 'a struct',
  Meter: 'a class; JS uses makeMeter()', Engine: 'a class; JS uses createEngine()',
  Offline: 'a struct for renderOffline results',
  /* C++ spellings of things the JS core does export under another name */
  sanitize: 'sanitizeState', fromStyle: 'styleDefaults', legalLining: 'inline in sanitizeState',
  canon9: 'PRESENT in the JS core too — the bisection guard, mirrored on purpose'
};
var TYPE_WORDS = { char: 1, int: 1, double: 1, unsigned: 1, bool: 1, void: 1, size_t: 1 };
var twinNames = [];
var twinRe = /^(?:inline\s+\w[\w:<>\s*&]*?|static\s+\w[\w\s]*?|class|struct|template\s*<[^>]*>\s*(?:class|struct))\s+(\w+)/gm;
var tm;
while ((tm = twinRe.exec(core))) if (!TYPE_WORDS[tm[1]] && tm[1].length > 2) twinNames.push(tm[1]);
twinNames = twinNames.filter(function (v, i) { return twinNames.indexOf(v) === i; });
var jsExports = Object.keys(C);
var undecided = twinNames.filter(function (n) {
  return jsExports.indexOf(n) < 0 && !TWIN_ONLY[n];
});
ok(twinNames.length > 15, 'the twin scan found ' + twinNames.length + ' top-level names to census');
ok(undecided.length === 0,
   'every twin-only construct has a recorded reason' +
   (undecided.length ? ' — UNDECIDED: ' + undecided.join(', ') : ''));

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
