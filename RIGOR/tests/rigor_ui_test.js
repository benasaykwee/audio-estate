/* RIGOR UI-logic harness — headless. Pulls the UIH block out of
   rigor.html and exercises the pure helpers. No DOM, no audio.
   Also enforces INTERCHANGE laws 3 and 4 on the embed.
   node tests/rigor_ui_test.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var R = require('../rigor_core.js');

var html = fs.readFileSync(path.join(__dirname, '..', 'rigor.html'), 'utf8');
var pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } }
function near(a, b, e, n) { ok(Math.abs(a - b) <= e, n + '  (' + a + ' vs ' + b + ')'); }

console.log('RIGOR UI logic — the parts that can be tested without a browser');

/* ============================================================
   1. the embed — INTERCHANGE laws 3 and 4
   ============================================================ */
console.log('\n— the embed —');
var blocks = [];
html.replace(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g, function (m, b) { blocks.push(b); return m; });
ok(blocks.length === 4, 'exactly four script blocks (nm-src, nd-src, core-src, app)');
blocks.forEach(function (b, i) {
  var parsed = true;
  try { new vm.Script(b); } catch (e) { parsed = false; }
  ok(parsed, 'script block ' + i + ' parses');
});

/* LAW 4: the order is load-bearing. ND closes over NM; the core closes
   over both. Asserted by byte position, not by hope. */
var pNM = html.indexOf('id="nm-src"');
var pND = html.indexOf('id="nd-src"');
var pCore = html.indexOf('id="core-src"');
ok(pNM > 0 && pND > 0 && pCore > 0, 'all three embed blocks present');
ok(pNM < pND, 'necromath is embedded BEFORE necrodyn (ND closes over NM)');
ok(pND < pCore, 'necrodyn is embedded BEFORE the core (the core closes over both)');

/* LAW 3: a literal closing script tag anywhere severs the embed */
ok(blocks.join('\n').indexOf('<' + '/script>') === -1,
   'no literal closing script tag inside any embedded file');

/* the embeds must be CURRENT — a stale embed is a silently wrong instrument */
function embedded(id) {
  var re = new RegExp('<script type="text\\/plain" id="' + id + '">\\n([\\s\\S]*?)\\n<\\/script>');
  var m = html.match(re);
  return m ? m[1] : null;
}
var srcNM = fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'necromath.js'), 'utf8');
var srcND = fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'necrodyn.js'), 'utf8');
var srcCore = fs.readFileSync(path.join(__dirname, '..', 'rigor_core.js'), 'utf8');
ok(embedded('nm-src') === srcNM, 'necromath embed is byte-identical to shared/necromath.js');
ok(embedded('nd-src') === srcND, 'necrodyn embed is byte-identical to shared/necrodyn.js');
ok(embedded('core-src') === srcCore, 'core embed is byte-identical to rigor_core.js');

/* ============================================================
   2. UIH pure helpers
   ============================================================ */
console.log('\n— UIH —');
var s0 = html.indexOf('/* UIH-START');
var e0 = html.indexOf('/* UIH-END');
ok(s0 > 0 && e0 > s0, 'UIH markers found');
var UIH = null;
if (s0 > 0 && e0 > s0) {
  var src = html.slice(s0, e0);
  var ctx = { window: undefined, Math: Math, JSON: JSON, RIGOR: R,
              encodeURIComponent: encodeURIComponent,
              decodeURIComponent: decodeURIComponent };
  vm.createContext(ctx);
  try {
    vm.runInContext('var ' + src.slice(src.indexOf('var ') + 4), ctx);
    UIH = ctx.UIH;
  } catch (err) { console.log('    · UIH eval failed: ' + err.message); }
}
ok(!!UIH, 'UIH evaluates headlessly');

if (UIH) {
  if (typeof UIH.dbToY === 'function') {
    near(UIH.dbToY(UIH.DBMAX === undefined ? 0 : UIH.DBMAX, 100), 0, 1e-9, 'top of the scale maps to y = 0');
    near(UIH.yToDb(UIH.dbToY(-18.5, 300), 300), -18.5, 1e-6, 'dB to y and back round trips');
  }
  if (typeof UIH.fmtRatio === 'function') {
    ok(UIH.fmtRatio(R.RATIO_INF).indexOf('∞') >= 0, 'the infinity ratio formats as ∞');
    ok(UIH.fmtRatio(4).indexOf('4') >= 0, 'a plain ratio formats plainly');
  }
  if (typeof UIH.encodeCase === 'function' && typeof UIH.decodeCase === 'function') {
    var st = R.sanitizeState({ style: 'spasm', thresh: -13.5, bands: 3, place: 'ms', curve: 40 });
    var rt = UIH.decodeCase(UIH.encodeCase(st));
    ok(rt && rt.style === 'spasm' && rt.thresh === -13.5 && rt.bands === 3,
       'case encode to decode round trips, multiband included');
    ok(UIH.decodeCase('not a case') === null, 'garbage decodes to null rather than throwing');
  }
  if (Array.isArray(UIH.FACTORY)) {
    var clean = true, named = true;
    UIH.FACTORY.forEach(function (f) {
      if (!f.name) named = false;
      var a = R.sanitizeState(f.s || f.state || f);
      if (JSON.stringify(a) !== JSON.stringify(R.sanitizeState(a))) clean = false;
    });
    ok(named, 'every factory case is named');
    ok(clean, 'every factory case survives the core sanitiser unchanged');
    /* the factory set is the first thing anyone touches, so it should
       actually demonstrate what the compressor can do */
    var mb = 0, feat = {};
    UIH.FACTORY.forEach(function (f2) {
      var a = R.loadCase(f2.s || f2.state || f2);
      if (a.bands > 1) mb++;
      if (a.detOs) feat.detOs = 1;
      if (a.relSync) feat.sync = 1;
    });
    ok(UIH.FACTORY.length >= 12, 'at least a dozen factory cases (' + UIH.FACTORY.length + ')');
    ok(mb >= 2, 'at least two demonstrate multiband (' + mb + ')');
    ok(feat.detOs === 1, 'one demonstrates true-peak detection');
    ok(feat.sync === 1, 'one demonstrates tempo-synced release');
  }
}

/* ---- case loading must migrate, not just sanitise ---- */
console.log('\n— case loading —');
/* Three paths bring OUTSIDE data in — the file picker, the whole-page
   drop, and the URL hash — and all three must migrate first, or a
   pre-merge file opens looking wrong and says nothing about why.
   The undo stack and the A→B copy deliberately do NOT migrate: they
   deserialise state this session serialised itself, which is already
   current, and running a rescale over it would corrupt it. */
var loadCalls = (html.match(/RIGOR\.loadCase\(/g) || []).length;
ok(loadCalls >= 3, 'all three external load paths migrate (' + loadCalls + ' loadCase calls)');
var internal = (html.match(/RIGOR\.sanitizeState\(JSON\.parse/g) || []).length;
ok(internal === 2, 'exactly the two internal paths (undo, A→B) still use a bare sanitize');
ok(/id="btnMatch"/.test(html), 'loudness-matched A/B button present');
ok(/loudnessMatch\(/.test(html), 'and it uses the core helper rather than its own arithmetic');

/* ---- the sidechain analyser ---- */
console.log('\n— the analyser —');
ok(/id="spec"/.test(html), 'analyser canvas present');
ok(/RIGOR\.spectrum\(/.test(html), 'it is fed by the core FFT, not a decorative squiggle');
ok(/scTap\(/.test(html), 'and by the real sidechain tap');
ok(/bandGr/.test(html), 'per-band gain reduction is drawn');
ok(!/lookahead:/.test(html), 'no factory case still uses the pre-ND field names');

/* ============================================================
   3. the control surface must name real state
   ============================================================ */
console.log('\n— the control surface —');
var st1 = R.defaultState();
['bypass', 'style', 'inGain', 'thresh', 'ratio', 'knee', 'attack', 'release',
 'autoRel', 'hold', 'range', 'look', 'detect', 'scOn', 'scHp', 'scLp',
 'scListen', 'link', 'mix', 'makeup', 'autoMakeup',
 'place', 'delta', 'curve', 'bands', 'xover', 'band'].forEach(function (k) {
  ok(Object.prototype.hasOwnProperty.call(st1, k), 'state has "' + k + '"');
});
['threshOff', 'gain', 'mute', 'solo'].forEach(function (k) {
  ok(Object.prototype.hasOwnProperty.call(st1.band[0], k), 'band config has "' + k + '"');
});
ok(st1.band.length === R.MAX_BANDS, 'band config array matches MAX_BANDS');

/* EVERY control the rack builds must name a field that actually exists.
   This is the assertion that would have caught the instrument silently
   pointing at v0.2 field names (`sc.hp`, `lookahead`) after the core moved
   to the ND lineage — the harnesses were all green while the control rack
   was reading undefined. */
var ctlKeys = [];
/* keys look like "thresh", "xover.0" or "band.2.gain" — digits included,
   because the multiband controls address array members */
html.replace(/\{ k: '([a-zA-Z][a-zA-Z0-9.]*)'(?!\s*\+)/g, function (m, k) { ctlKeys.push(k); return m; });
/* the per-band ones are built in a loop, so expand the template */
if (/k: 'band\.' \+ bi \+ '\./.test(html)) {
  ['threshOff', 'gain'].forEach(function (f) {
    for (var b = 0; b < R.MAX_BANDS; b++) ctlKeys.push('band.' + b + '.' + f);
  });
}
ok(ctlKeys.length > 10, 'found the control definitions (' + ctlKeys.length + ' keys)');
var broken = [];
ctlKeys.forEach(function (k) {
  var good, pp = k.split('.');
  if (pp.length === 1) good = Object.prototype.hasOwnProperty.call(st1, k);
  else if (pp.length === 2) good = st1[pp[0]] !== undefined && st1[pp[0]][pp[1]] !== undefined;
  else good = st1[pp[0]] && st1[pp[0]][+pp[1]] &&
              Object.prototype.hasOwnProperty.call(st1[pp[0]][+pp[1]], pp[2]);
  if (!good) broken.push(k);
});
ok(broken.length === 0, 'every control key resolves against the real state' +
   (broken.length ? ' — BROKEN: ' + broken.join(', ') : ''));

/* ============================================================
   THE SAME RULE, APPLIED TO THE SECOND PLACE STATE IS NAMED.

   Round 9 added the assertion above after the control rack was found
   naming v2 fields against an ND core. The rack is not the only place
   the instrument names a state field: the keyboard handler does it too,
   and it was never covered — so `state().sc.listen` survived there and
   threw a TypeError on every press of L from the lineage merge until it
   was found by hand in round 12. `sc` is not an object in this lineage.

   A rule enforced in one of the two places it applies is decoration in
   the other. This scans every `state().X` and `state().X.Y` reference in
   the app block and resolves it against defaultState(), so any field
   renamed in the core fails here instead of silently in a browser
   console nobody has open.
   ============================================================ */
(function () {
  /* Strip comments before scanning. The first run of this check failed on
     `sc.listen` — inside the comment that documents the fix. A scan that
     cannot tell code from prose reports defects that are not there, and
     the eventual response to a check that cries wolf is to edit real code
     until it stops, which is worse than not having it.

     Block comments go entirely. Line comments go ONLY when they start a
     line, because `https://` inside a string mid-line would otherwise eat
     the rest of that line and hide a real reference — a false negative,
     which is the failure this check exists to prevent. */
  var app = (blocks[3] || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');
  var st2 = R.defaultState(), bad = [], seen = {};
  /* deliberately also matches the assignment form, since the bug that
     motivated this was a write and not a read */
  var re = /state\(\)\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g, m2;
  while ((m2 = re.exec(app)) !== null) {
    var head = m2[1], tail = m2[2], key = head + (tail ? '.' + tail : '');
    if (seen[key]) continue;
    seen[key] = 1;
    var good2 = Object.prototype.hasOwnProperty.call(st2, head);
    /* `band` and `xover` are arrays reached by index, not by name — a
       word after them is a method call, not a field */
    if (good2 && tail && head !== 'band' && head !== 'xover')
      good2 = st2[head] !== null && typeof st2[head] === 'object' &&
              Object.prototype.hasOwnProperty.call(st2[head], tail);
    if (!good2) bad.push(key);
  }
  ok(Object.keys(seen).length >= 8,
     'the scan actually found state references to check (' +
     Object.keys(seen).length + ') — a regex that matches nothing passes vacuously');
  ok(bad.length === 0,
     'every state field named OUTSIDE the control rack resolves too' +
     (bad.length ? ' — BROKEN: ' + bad.join(', ') : ''));
  /* prove it bites: the exact defect it was written for must fail it */
  var probe = 'state().sc.listen = !state().sc.listen;';
  var pm = /state\(\)\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/.exec(probe);
  ok(pm && !Object.prototype.hasOwnProperty.call(st2, pm[1]),
     'and the check is proven to catch `state().sc.listen`, the defect that prompted it');
})();

/* ============================================================
   ROUND 8 — the redraw budget, drag-swap, diffing, CSV
   ============================================================ */
/* ============================================================
   ROUND 12 — the worklet analyser tap (item 8)

   The spectrum existed from round 5 and only ever drew on the
   ScriptProcessor fallback. On the worklet the engine is on the audio
   thread, so the analyser needs the tap POSTED to it. Nothing asserted
   that, which is why it stayed half-built through four rounds while
   looking finished.
   ============================================================ */
/* ============================================================
   ROUND 12 — four case slots (item 14)
   ============================================================ */
/* ============================================================
   ROUND 12 — the preset browser, and the two-loader bug (item 12)
   ============================================================ */
/* ============================================================
   ROUND 12 — undo reaches the slot that was actually written (item 13)
   ============================================================ */
console.log('\n— undo across writes it did not make (item 13) —');
(function () {
  var app = blocks[3] || '';
  ok(/function pushUndoFor\(slot\)/.test(app),
     'there is a way to snapshot a slot that is not the active one');

  /* THE DEFECT: Copy and level-match both write to prevWhich, and both
     used pushUndo(), which snapshots `which` onto which's stack. Copy was
     therefore irreversible and level-match undid the wrong case. Derived
     by reading each handler rather than by trusting that it was fixed. */
  [['btnCopy', 'overwrites the comparison case'],
   ['btnMatch', 'changes the comparison case\'s makeup']].forEach(function (p) {
    var body = new RegExp("el\\('" + p[0] + "'\\)\\.addEventListener\\('click', function \\(\\) \\{([\\s\\S]*?)\\n\\}\\);")
                 .exec(app);
    ok(!!body, 'found the ' + p[0] + ' handler');
    if (!body) return;
    var src = body[1];
    ok(/pushUndoFor\(prevWhich\)/.test(src),
       p[0] + ' snapshots the slot it writes — it ' + p[1]);
    ok(!/pushUndo\(false\)|pushUndo\(true\)/.test(src),
       'and no longer snapshots the ACTIVE slot, which recorded the wrong case entirely');
  });

  /* pushUndoFor must push the target's state onto the TARGET's stack.
     Executed, not read: swapping either of those two for `which` still
     parses, still runs, and is exactly the bug being fixed. */
  var src2 = (/function pushUndoFor\(slot\) \{[\s\S]*?\n\}/.exec(app) || [])[0];
  ok(!!src2, 'found pushUndoFor in the shipped source');
  var sandbox = { undos: { A: [], B: [] }, cases: { A: { m: 'a' }, B: { m: 'b' } },
                  which: 'A', JSON: JSON };
  vm.createContext(sandbox);
  new vm.Script(src2 + '\npushUndoFor("B");').runInContext(sandbox);
  ok(sandbox.undos.B.length === 1 && sandbox.undos.A.length === 0,
     'it pushes onto the TARGET stack, not the active one');
  ok(sandbox.undos.B[0] === JSON.stringify({ m: 'b' }),
     'and pushes the TARGET case, not the active one');
  new vm.Script('pushUndoFor("nope");').runInContext(sandbox);
  ok(sandbox.undos.B.length === 1, 'an unknown slot is ignored rather than throwing');

  ok(/undos = \{ A: \[\], B: \[\], C: \[\], D: \[\] \}/.test(app),
     'and every slot has a stack for it to push onto');
})();

console.log('\n— the preset browser and its tags (item 12) —');
(function () {
  var app = blocks[3] || '';
  var F = UIH.FACTORY;
  ok(F.every(function (f) { return Array.isArray(f.tags) && f.tags.length > 0; }),
     'every factory case carries at least one tag');

  var vocab = {};
  F.forEach(function (f) { f.tags.forEach(function (t) { vocab[t] = (vocab[t] || 0) + 1; }); });
  ok(Object.keys(vocab).length >= 8,
     'the tag vocabulary is worth filtering by (' + Object.keys(vocab).length + ' tags)');
  var singletons = Object.keys(vocab).filter(function (t) { return vocab[t] === 1; });
  ok(singletons.length <= Object.keys(vocab).length / 2,
     'and most tags group more than one case — a tag used once is a second name, ' +
     'not a category (' + singletons.length + ' singletons)');
  ok(F.every(function (f) { return f.tags.every(function (t) { return /^[a-z-]+$/.test(t); }); }),
     'tags are lowercase and unpunctuated, so a filter cannot miss on case');
  ok(/Object\.keys\(seen\)\.sort\(\)/.test(app),
     'the filter row derives its vocabulary from the cases rather than keeping a second list');

  /* ---- THE BUG THIS SECTION EXISTS FOR ----
     The instrument loaded factory cases with sanitizeState while the
     regression harness loaded the SAME entries with loadCase. sanitizeState
     drops keys it does not know, so three presets carrying the pre-ND
     `sc: {on,hp,lp}` block shipped with their sidechain filter switched
     off — and the baselines, computed through loadCase, blessed a sound
     the instrument never made. Two paths, one tested. */
  var drift = F.filter(function (f) {
    var a2 = R.sanitizeState(JSON.parse(JSON.stringify(f.s)));
    var b2 = R.loadCase(JSON.parse(JSON.stringify(f.s)));
    return JSON.stringify(a2) !== JSON.stringify(b2);
  });
  ok(drift.length === 0,
     'every factory case loads IDENTICALLY through sanitizeState and loadCase — ' +
     'the instrument and the regression harness cannot describe different sounds' +
     (drift.length ? ' — DRIFTS: ' + drift.map(function (f) { return f.name; }).join(', ') : ''));
  ok(!/sc: \{/.test(JSON.stringify(F)),
     'and no entry still carries the pre-ND nested sc block');
  ok(/setStateObj\(RIGOR\.loadCase\(/.test(app),
     'the instrument loads factory cases through loadCase, the same door the harness uses');

  /* the presets whose whole identity is their sidechain filter must
     actually have one — named, so a silent regression cannot hide */
  [['Vocal', 120], ['Mix Glue', 60], ['Kick Ducks Bass', 40]].forEach(function (p) {
    var f = F.filter(function (x) { return x.name.indexOf(p[0]) === 0; })[0];
    ok(!!f, 'found the "' + p[0] + '" case');
    if (!f) return;
    var s2 = R.loadCase(JSON.parse(JSON.stringify(f.s)));
    ok(s2.scOn === true && s2.scHp === p[1],
       '"' + f.name + '" ships with its sidechain highpass ON at ' + p[1] +
       ' Hz (' + s2.scOn + ', ' + s2.scHp + ') — it is the reason the preset exists');
  });
})();

console.log('\n— A / B / C / D (item 14) —');
(function () {
  var app = blocks[3] || '';
  var sl = (/var SLOTS = \[([^\]]*)\]/.exec(app) || [])[1] || '';
  var slots = sl.split(',').map(function (s) { return s.replace(/['"\s]/g, ''); })
                .filter(Boolean);
  ok(slots.length === 4, 'there are four slots (' + slots.join(' ') + ')');

  /* everything below is DERIVED from SLOTS rather than from the literal
     letters, so adding a fifth slot cannot leave half the instrument
     wired for four */
  var missing = slots.filter(function (k) {
    return app.indexOf("el('btn" + k + "')") < 0 && !new RegExp("id=\"btn" + k + "\"").test(html);
  });
  ok(missing.length === 0, 'every slot has a button in the markup' +
     (missing.length ? ' — MISSING: ' + missing.join(', ') : ''));
  var noUndo = slots.filter(function (k) {
    return !new RegExp('undos = \\{[^}]*\\b' + k + ':').test(app);
  });
  ok(noUndo.length === 0, 'and its own undo stack — a shared one would let ' +
     'exhuming in C reach back into A' +
     (noUndo.length ? ' — MISSING: ' + noUndo.join(', ') : ''));
  var noMemo = slots.filter(function (k) {
    return !new RegExp('lufsMemo = \\{[^}]*\\b' + k + ':').test(app);
  });
  ok(noMemo.length === 0, 'and its own loudness reading, so level-matching ' +
     'generalises rather than staying an A/B feature' +
     (noMemo.length ? ' — MISSING: ' + noMemo.join(', ') : ''));

  /* the four defaults should not be four copies of one sound — the point
     of the starting points is that stepping through them is a real
     comparison. Derived from the STYLE table, not from a list here. */
  var styles = (app.match(/style: '(\w+)'[\s\S]{0,200}?meta: \{ name: 'Case/g) || [])
                 .map(function (m) { return /style: '(\w+)'/.exec(m)[1]; });
  ok(styles.length === 4, 'four starting cases are defined (' + styles.length + ')');
  ok(new Set(styles).size === 4,
     'and they use four DIFFERENT styles — stepping A→B→C→D is a pass ' +
     'through every topology, which is the comparison the listening ' +
     'protocol asks for (' + styles.join(', ') + ')');
  styles.forEach(function (s) {
    ok(R.STYLES.indexOf(s) >= 0, 'starting style "' + s + '" is a real style');
  });

  /* THE REGRESSION THIS SECTION EXISTS FOR: the old code held caseA and
     caseB as two bare variables, and every binary action named them
     directly. A leftover reference would still parse, still run, and
     silently act on the wrong slot. */
  ok(!/\bcaseA\b|\bcaseB\b|\bundoA\b|\bundoB\b/.test(app),
     'no bare caseA/caseB/undoA/undoB survives — a leftover would act on ' +
     'the wrong slot without erroring');
  ['btnCopy', 'btnMatch', 'btnDiff'].forEach(function (b) {
    var body = new RegExp("el\\('" + b + "'\\)\\.addEventListener\\('click', function \\(\\) \\{([\\s\\S]*?)\\n\\}\\);")
                 .exec(app);
    ok(!!body, 'found the ' + b + ' handler');
    if (body) ok(/prevWhich/.test(body[1]),
      b + ' acts on the comparison slot rather than a hardcoded B');
  });
  ok(/pairLabel/.test(app) && /btnDiff'\)\.textContent|el\('btnDiff'\)\.textContent/.test(app),
     'and the three binary buttons print which pair they will act on');
})();

console.log('\n— the worklet analyser tap (item 8) —');
(function () {
  /* The array ends with `].join('\n');`, NOT with `];`. My first version
     of this regex looked for the latter, never matched inside the array,
     and ran on to the end of the file — so the "process() part" contained
     bootSP's buffers and the no-allocation assertion failed against code
     that is not in the worklet at all. Terminate on the real delimiter. */
  var wrap = (/var WORKLET_WRAP = \[([\s\S]*?)\]\.join\(/.exec(blocks[3] || '') || [])[1] || '';
  ok(wrap.length > 0, 'found the worklet source');
  ok(!/bootSP|createScriptProcessor/.test(wrap),
     'and the extraction stops at the end of the array — the regex that did not ' +
     'made every check below read the wrong code');
  ok(/this\.e\.scTap\(/.test(wrap) && /this\.e\.outTap\(/.test(wrap),
     'the worklet reads BOTH taps — a spectrum with one trace live and one dead is worse than none');
  ok(/postMessage\(\{[^}]*sc:[^}]*out:/.test(wrap.replace(/\n/g, ' ')),
     'and posts them with the meters, on one message rather than a second schedule');

  /* THE RULE THAT ACTUALLY MATTERS: nothing may be allocated on the audio
     thread. Derived by splitting the blob at the constructor boundary
     rather than by eyeballing it. */
  var ctorEnd = wrap.indexOf('process(inputs');
  ok(ctorEnd > 0, 'found the process() boundary in the worklet');
  var ctorPart = wrap.slice(0, ctorEnd), procPart = wrap.slice(ctorEnd);
  ok(/new Float64Array\(2048\)/.test(ctorPart),
     'the tap arrays are allocated in the constructor');
  /* Stated precisely rather than sweepingly. There IS one pre-existing
     allocation in process(): `new Float32Array(n)` for a disconnected
     input. It is not mine, it only fires when nothing is patched in, and
     an assertion that quietly papered over it with a string replace —
     which is what I wrote first — would have been an assertion arranged to
     pass. The rule being enforced is about the TAP buffers. */
  ok(!/new Float64Array/.test(procPart),
     'process() allocates no tap buffer — posting by reference structured-clones ' +
     'without detaching, so the audio thread allocates nothing per tick');
  ok(!/this\.(tsc|tou)\s*=/.test(procPart),
     'and never reassigns them, which is the other way an allocation sneaks in');

  /* the main thread must read the ENVELOPE, not the old bare-meters shape */
  ok(/meters = d\.m \|\| d/.test(blocks[3] || ''),
     'the main thread reads the message shape rather than assuming it');

  /* copyTap, executed rather than eyeballed — pulled from the shipped
     source so this cannot pass against a copy that has drifted */
  var src = (/function copyTap\(src, o\) \{[\s\S]*?\n\}/.exec(blocks[3] || '') || [])[0];
  ok(!!src, 'found copyTap in the shipped source');
  var copyTap = new vm.Script('(' + src.replace('function copyTap', 'function') + ')')
                  .runInNewContext({});
  var o8 = new Float64Array(4);
  ok(copyTap(null, o8) === 0, 'no tap yet reads as zero rather than throwing');
  ok(copyTap(new Float64Array(0), o8) === 0, 'and an empty tap likewise');
  var srcArr = new Float64Array([1, 2, 3, 4, 5, 6]);
  var got8 = copyTap(srcArr, o8);
  ok(got8 === 4, 'a short destination takes what fits (' + got8 + ')');
  /* OLDEST-FIRST is the contract the core's taps publish. Taking the head
     instead of the tail would show a stale spectrum that still looks
     plausible — the exact failure a display bug hides behind. */
  ok(o8[0] === 3 && o8[3] === 6,
     'and takes the MOST RECENT samples, oldest-first — [3,4,5,6] not [1,2,3,4]');
  var o9 = new Float64Array(8), got9 = copyTap(srcArr, o9);
  ok(got9 === 6, 'a long destination is filled only as far as the tap goes (' + got9 + ')');
})();

console.log('\n— reduced motion and the eco pause (item 11) —');
(function () {
  var U = UIH;
  /* the regression this exists to prevent: reduced motion must not mean
     NO redraw. It used to gate the whole animation loop off. */
  ok(U.redrawInterval({ reduced: true }) !== Infinity,
     'reduced motion still redraws — it throttles, it does not switch off');
  ok(U.redrawInterval({ reduced: true }) > 0, 'and it is genuinely throttled, not full rate');
  ok(U.redrawInterval({}) === 0, 'normally, every animation frame');
  ok(U.redrawInterval({ hidden: true }) === Infinity, 'hidden tab redraws nothing — the eco pause');
  ok(U.redrawInterval({ hidden: true, reduced: true }) === Infinity,
     'hidden wins over reduced — no point throttling something invisible');

  /* the gate itself, over a simulated clock. DERIVED: at an interval of
     REDRAW_REDUCED_MS across a second, the count is 1000/interval. */
  /* Count over one second of 1 ms ticks starting at t = 0 with last = 0.
     t = 0 does NOT fire — 0 - 0 is not >= iv — so the first redraw is at
     t = iv and the last at t = 1000, giving exactly 1000/iv. Derived from
     iv, so changing REDRAW_REDUCED_MS re-derives the expectation. */
  var iv = U.REDRAW_REDUCED_MS, last = 0, n = 0;
  for (var t = 0; t <= 1000; t++) {
    if (U.shouldRedraw({ reduced: true }, t, last)) { last = t; n++; }
  }
  ok(n === Math.floor(1000 / iv),
     'reduced motion redraws ' + n + ' times per second (interval ' + iv + ' ms)');
  var n2 = 0, last2 = 0;
  for (t = 0; t <= 100; t++) if (U.shouldRedraw({}, t, last2)) { last2 = t; n2++; }
  ok(n2 === 101, 'unthrottled, every tick redraws');
  var n3 = 0, last3 = 0;
  for (t = 0; t <= 100; t++) if (U.shouldRedraw({ hidden: true }, t, last3)) { last3 = t; n3++; }
  ok(n3 === 0, 'hidden, nothing redraws at all');

  /* and the instrument must actually START the loop unconditionally.
     Anchored to a line start: the UIH note ABOUT the old gate quotes it
     inside a comment, and a naive substring search matches its own
     documentation. (It did, on the first run.) */
  ok(/^\s*if \(!reduce\) frame\(\);\s*$/m.test(html) === false,
     'the old `if (!reduce) frame()` gate is gone from the instrument');
  ok(/^frame\(\);$/m.test(html), 'frame() is started unconditionally');
})();

console.log('\n— crossover drag-swap (item 5) —');
(function () {
  var U = UIH;
  var r = U.dragXover([200, 2000], 0, 300);
  ok(!r.swapped && r.xover[0] === 300 && r.xover[1] === 2000, 'an ordinary drag just moves');
  ok(r.held === 0, 'and keeps hold of the same handle');

  /* the whole point: dragging the LOW one past the HIGH one swaps */
  var s = U.dragXover([200, 2000], 0, 5000);
  ok(s.swapped, 'dragging the low crossover past the high one SWAPS');
  ok(s.xover[0] === 2000 && s.xover[1] === 5000, 'the pair comes back ordered');
  ok(s.held === 1, 'and the pointer is now holding the upper handle');

  var s2 = U.dragXover([200, 2000], 1, 50);
  ok(s2.swapped && s2.xover[0] === 50 && s2.xover[1] === 200, 'and it swaps the other way too');
  ok(s2.held === 0, 'the pointer is now holding the lower handle');

  /* every result must be something the CORE will accept unchanged —
     otherwise the UI is showing a value the engine will quietly move.
     Derived by round-tripping through the real sanitiser. */
  var bad = [];
  [[200, 2000], [40, 80], [1000, 1100], [18000, 19500]].forEach(function (pair) {
    [0, 1].forEach(function (idx) {
      [5, 20, 60, 300, 2500, 9000, 19000, 21000, 0.5].forEach(function (hz) {
        var got = U.dragXover(pair, idx, hz).xover;
        var back = R.sanitizeState({ xover: got }).xover;
        if (Math.abs(back[0] - got[0]) > 1e-9 || Math.abs(back[1] - got[1]) > 1e-9)
          bad.push(pair + '/' + idx + '/' + hz);
      });
    });
  });
  ok(bad.length === 0, 'every drag result survives the core sanitiser unchanged' +
     (bad.length ? ' — BROKEN: ' + bad.slice(0, 4).join(' ') : ''));

  /* ordering is an invariant, not a happy path */
  var ordered = true;
  for (var i = 0; i < 400; i++) {
    var a = 20 + (i * 97) % 19000, b = 20 + (i * 331) % 19000;
    var p2 = a < b ? [a, b] : [b, a];
    var res = U.dragXover(p2, i % 2, 20 + (i * 761) % 21000);
    if (!(res.xover[0] < res.xover[1])) ordered = false;
  }
  ok(ordered, 'the pair comes out strictly ascending for 400 random drags');
})();

console.log('\n— case diffing (item 15) —');
(function () {
  var U = UIH;
  var a = R.sanitizeState({ style: 'fresh', thresh: -20, ratio: 4 });
  var b = R.sanitizeState({ style: 'fresh', thresh: -20, ratio: 4 });
  ok(U.diffCases(a, b).length === 0, 'identical cases differ in nothing');

  var c = R.sanitizeState({ style: 'spasm', thresh: -30, ratio: 4 });
  var d = U.diffCases(a, c);
  var keys = d.map(function (x) { return x.key; }).sort().join(',');
  ok(keys === 'style,thresh', 'two changed fields are reported, and only those (' + keys + ')');
  var th = d.filter(function (x) { return x.key === 'thresh'; })[0];
  ok(th.a === -20 && th.b === -30, 'and it reports both sides');

  /* a rename is not a setting */
  var e = R.sanitizeState({ style: 'fresh', thresh: -20, ratio: 4, meta: { name: 'Other', note: 'hi' } });
  ok(U.diffCases(a, e).length === 0, 'renaming a case is not a difference');

  /* per band and per field, because "band differs" is not actionable */
  var f = R.sanitizeState({ bands: 3, band: [{}, { gain: 3 }, { mute: true }] });
  var g = R.sanitizeState({ bands: 3, band: [{}, { gain: 0 }, { mute: false }] });
  var bd = U.diffCases(f, g).map(function (x) { return x.key; }).sort();
  ok(bd.join(',') === 'band2.gain,band3.mute', 'band differences name the band and the field (' + bd.join(',') + ')');

  var h = R.sanitizeState({ xover: [200, 2000] });
  var i2 = R.sanitizeState({ xover: [300, 2000] });
  ok(U.diffCases(h, i2).map(function (x) { return x.key; }).join(',') === 'xover[0]',
     'and the crossover pair is diffed per element');

  /* round 8's own new fields must be visible to the differ, or the tool
     goes stale the moment anything is added */
  var j = R.sanitizeState({ holdTaper: 0, detOsX: 4 });
  var k = R.sanitizeState({ holdTaper: 60, detOsX: 8 });
  var nk = U.diffCases(j, k).map(function (x) { return x.key; }).sort().join(',');
  ok(nk === 'detOsX,holdTaper', 'the new round-8 fields diff too (' + nk + ')');

  /* the differ must cover EVERY scalar the sanitiser produces — derived
     from the state itself, so a field added later cannot slip past it */
  var s1 = R.sanitizeState({}), missed = [];
  Object.keys(s1).forEach(function (key) {
    if (key === 'meta' || key === 'band' || key === 'xover') return;
    if (typeof s1[key] === 'object') return;
    var mod = R.sanitizeState({});
    mod[key] = typeof s1[key] === 'boolean' ? !s1[key] :
               typeof s1[key] === 'number' ? s1[key] + 1 : 'zzz';
    var mm = R.sanitizeState(mod);
    if (mm[key] !== s1[key] && U.diffCases(s1, mm).length === 0) missed.push(key);
  });
  ok(missed.length === 0, 'no scalar field is invisible to the differ' +
     (missed.length ? ' — MISSED: ' + missed.join(', ') : ''));
})();

console.log('\n— gain-reduction CSV (item 7) —');
(function () {
  var U = UIH;
  var gr = [0, -1.5, -3.25, -2, 0];
  var csv = U.grCsv(gr, 48000, 1);
  var lines = csv.trim().split('\n');
  ok(lines[0] === 'time_s,gr_db', 'there is a header');
  ok(lines.length === gr.length + 1, 'one row per sample plus the header');
  /* DERIVED: lines[0] is the header, so lines[n] carries SAMPLE n-1.
     Getting that off by one was the first version of this assertion. */
  var row = 3, si = row - 1;
  var cells = lines[row].split(',');
  /* the tolerance is DERIVED from the file's own precision — half of the
     last written decimal. Pinning it at 1e-9 (the first attempt) asserted
     more precision than the format carries, and failed on a correct file. */
  var tTol = 0.5 * Math.pow(10, -U.CSV_TIME_DP);
  ok(Math.abs(parseFloat(cells[0]) - si / 48000) <= tTol, 'time is seconds, not sample index');
  ok(Math.abs(parseFloat(cells[1]) - gr[si]) < 1e-9, 'and the value round-trips');
  /* stride 2 over 5 samples visits 0, 2, 4 — so ceil(5/2) rows plus header */
  ok(U.grCsv(gr, 48000, 2).trim().split('\n').length === Math.ceil(gr.length / 2) + 1,
     'stride thins the file');
  /* a small value must not become 0 in a spreadsheet */
  var tiny = U.grCsv([-0.0000123], 48000, 1).trim().split('\n')[1].split(',')[1];
  ok(parseFloat(tiny) !== 0, 'a very small reduction survives the format (' + tiny + ')');
  ok(U.grCsv([NaN, Infinity], 48000, 1).indexOf('NaN') === -1, 'non-finite values do not reach the file');
  ok(U.grCsv([], 48000, 1).trim() === 'time_s,gr_db', 'an empty render is a header and nothing else');
})();

/* ============================================================
   ROUND 8 — keyboard and accessibility audit (item 10)
   Static, because there is no DOM here. That is a real limit and it is
   stated rather than glossed: this checks the MARKUP and the SOURCE, not
   a rendered page. It cannot prove focus order; it can prove that every
   control has a name and that nothing has opted out of the tab order.
   ============================================================ */
console.log('\n— keyboard and accessibility (item 10) —');
(function () {
  /* 1. every button must have an accessible name: text, or aria-label */
  var btns = html.match(/<button[^>]*>[\s\S]*?<\/button>/g) || [];
  ok(btns.length > 8, 'found ' + btns.length + ' buttons');
  var unnamed = [];
  btns.forEach(function (b) {
    var text = b.replace(/<[^>]*>/g, '').trim();
    var aria = /aria-label\s*=\s*"([^"]+)"/.exec(b);
    /* a single glyph is not a name — "?" tells a screen reader nothing */
    var namedByText = text.length >= 2 && /[a-z]/i.test(text);
    if (!namedByText && !aria) unnamed.push(text || '(empty)');
  });
  ok(unnamed.length === 0, 'every button has an accessible name' +
     (unnamed.length ? ' — UNNAMED: ' + unnamed.join(', ') : ''));

  /* 2. the canvases carry the only output with no text form at all */
  var canv = html.match(/<canvas[^>]*>/g) || [];
  var mute = canv.filter(function (c) { return !/aria-label/.test(c); });
  ok(canv.length > 0 && mute.length === 0,
     'all ' + canv.length + ' canvases have a text alternative' +
     (mute.length ? ' — MISSING: ' + mute.join(' ') : ''));

  /* 3. a positive tabindex reorders the whole document and is almost
        always a mistake. 0 and -1 are fine. */
  var tabs = html.match(/tabindex\s*=\s*"(-?\d+)"/g) || [];
  var positive = tabs.filter(function (t) { return /"([1-9]\d*)"/.test(t); });
  ok(positive.length === 0, 'no positive tabindex reorders the document' +
     (positive.length ? ' — FOUND: ' + positive.join(', ') : ''));

  /* 4. every generated range/checkbox/select must be paired with a label.
        Checked structurally: the builder emits `for="ID"` and then an
        element with that id. If the two ever drift, this catches it. */
  var forIds = [], elemIds = [];
  html.replace(/<label for="([^"]+)"/g, function (m, id) { forIds.push(id); return m; });
  html.replace(/\bid\s*=\s*'([^']+)'/g, function (m, id) { elemIds.push(id); return m; });
  html.replace(/\bid\s*=\s*"([^"]+)"/g, function (m, id) { elemIds.push(id); return m; });
  /* the builder writes ids by concatenation ('c_' + key), so compare the
     TEMPLATES rather than literal strings */
  var tmplPairs = (html.match(/<label for="' \+ (\w+) \+ '"/g) || []).length;
  ok(tmplPairs >= 2, 'the control builder emits label/for pairs (' + tmplPairs + ' templates)');
  var literalUnlabelled = forIds.filter(function (id) {
    return id.indexOf("'") === -1 && elemIds.indexOf(id) === -1;
  });
  ok(literalUnlabelled.length === 0, 'every literal label points at an element that exists' +
     (literalUnlabelled.length ? ' — DANGLING: ' + literalUnlabelled.join(', ') : ''));

  /* 5. the one genuinely mouse-only gesture is the threshold drag on the
        chart. It MUST have a keyboard equivalent, and it does: the
        Threshold slider. Asserted by checking the control list actually
        contains it rather than by remembering that it does. */
  ok(/\{ k: 'thresh'/.test(html), 'the chart drag has a keyboard equivalent (a Threshold slider)');
  ok(/aria-label="[^"]*Threshold slider[^"]*"/.test(html) ||
     /Threshold slider does the same/.test(html),
     'and the canvas label says so, for someone who cannot see the drag');

  /* 6. the keyboard reference in the help panel must not have been
        clobbered — the first version of the diff button overwrote it */
  ok(/<div id="help"><div>[\s\S]{0,400}<dt>Space<\/dt>/.test(html),
     'the keyboard reference is still in the help panel');
  ok(/<div id="diff"/.test(html), 'and the diff has its own overlay rather than borrowing it');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
