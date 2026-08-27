/* CASKET intake — the CORONER seam, from CASKET's side.
   node tests/casket_intake.js

   THE INTAKE takes a report about a recording and hands back a
   `.casket.json` state. That makes it the first thing in this project
   that accepts input written by ANOTHER PROGRAM, and the failure modes of
   that are not the failure modes the rest of the suite was built for.
   Everything else here is handed a state a human typed or a fuzzer
   generated, and both of those arrive in shapes the sanitiser already
   knows. A feature vector from a tool under active development by another
   session arrives in whatever shape that session left it in this morning.

   So the questions this file asks are mostly about TRUST:

     · does a partial, stale or absent report degrade, or does it throw?
     · does a confident-looking answer actually have evidence behind it?
     · does the intake stay inside its own territory, or does a report
       quietly reset a session?
     · when it says a margin covers the peaks, does it?

   THE FILE DELIBERATELY DOES NOT IMPORT CORONER. A gate that required a
   file another session is mid-way through writing would go red for
   reasons that have nothing to do with CASKET, and a red gate nobody
   believes is worse than no gate. The fixtures below are hand-built
   feature vectors in CORONER's documented shape. The cost of that choice
   is real and worth naming: this file cannot notice if CORONER renames a
   feature. What it CAN notice is the intake reading a field it never
   declared, which is the other half of the same failure and the half
   CASKET owns. */
'use strict';
var C = require('../casket_core.js');

var pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } }
var FS = 44100;

/* Fixtures in CORONER's documented feature shape, one per character the
   chooser is supposed to be able to tell apart. Values are inside the
   ranges CORONER's own FEATURES registry declares.

   THE VERSION STAMP IS DERIVED, NOT TYPED. These fixtures originally
   carried a literal `version: 2`, and CORONER moved to 3 the same day —
   so a file written to catch version drift was itself carrying a drifted
   version number within hours. Reading the constant means the fixtures
   describe "a current report" for as long as that stays true, and the
   one deliberately-stale case below states its staleness as an OFFSET
   from the constant rather than as a number of its own. */
var V = C.INTAKE_FEATURE_VERSION;
var FIX = {
  sustained: { version: V, crest: 16, onsetRate: 0.8, attack: 0.09,  sustain: 0.85, flatness: 0.05, highRatio: 0.02, dur: 30 },
  percussive:{ version: V, crest: 9,  onsetRate: 11,  attack: 0.002, sustain: 0.10, flatness: 0.30, highRatio: 0.09, dur: 30 },
  bright:    { version: V, crest: 5,  onsetRate: 8,   attack: 0.004, sustain: 0.30, flatness: 0.62, highRatio: 0.19, dur: 30 },
  plain:     { version: V, crest: 11, onsetRate: 3,   attack: 0.02,  sustain: 0.50, flatness: 0.20, highRatio: 0.06, dur: 30 }
};

console.log('CASKET intake — what a report from CORONER is allowed to do\n');

/* ============================================================
   1. THE SHAPE THAT COMES BACK
   ============================================================ */
console.log('— the shape that comes back —');
(function () {
  var shapes = [
    ['a whole report',      { version: V, features: FIX.percussive }],
    ['a bare feature bag',  FIX.percussive],
    ['nothing at all',      null],
    ['an empty object',     {}],
    ['a string',            'a recording of a cat'],
    ['an array',            [1, 2, 3]],
    ['a number',            42]
  ];
  shapes.forEach(function (s) {
    var r = null, threw = null;
    try { r = C.intake(s[1], null, null, FS); } catch (e) { threw = e; }
    ok(!threw && r && r.state,
       s[0] + ' returns a state rather than throwing' + (threw ? ' — THREW: ' + threw.message : ''));
    if (r) {
      ok(C.STYLES.indexOf(r.state.style) >= 0, '  and the arrangement it names is one CASKET has');
      ok(Array.isArray(r.warnings), '  and warnings is always an array, even when empty');
    }
  });
})();

/* ============================================================
   2. THE TERRITORY — what a report may never touch.

   Derived from defaultState() rather than hand-typed, so a field added to
   the state next month is covered by this the moment it exists. That
   matters more here than the usual "don't repeat yourself": the whole
   danger of an ingest function is a field nobody remembered to think
   about, and a hand-typed exclusion list is exactly a list of the fields
   somebody DID remember.
   ============================================================ */
console.log('\n— the territory a report may not leave —');
(function () {
  var recipe = Object.keys(C.styleDefaults('velvet'));
  var mine = ['style', 'drive', 'targetLufs'].concat(recipe);
  var mustHold = Object.keys(C.defaultState()).filter(function (k) {
    return mine.indexOf(k) < 0;
  });
  ok(mustHold.length >= 10,
     'there are ' + mustHold.length + ' state fields a report has no business moving');

  /* A base where every one of them is AWAY from its default, so the test
     cannot pass by the base and the default happening to agree. */
  var base = C.sanitizeState({
    bypass: true, lid: -9.5, hold: 40, link: 55,
    ms: true, msMid: 3, msSide: -2, dc: false, unity: true,
    dust: 'shaped', dustBits: 24, dustSeed: 777,
    meta: { name: 'Ben\'s master', note: 'do not touch' }
  });
  var def = C.defaultState();
  var differing = mustHold.filter(function (k) {
    return JSON.stringify(base[k]) !== JSON.stringify(def[k]);
  });
  ok(differing.length >= mustHold.length - 1,
     'the probe base actually differs from default on ' + differing.length + ' of ' +
     mustHold.length + ' — so this section cannot pass vacuously' +
     (differing.length < mustHold.length
        ? ' (only `version` is legitimately equal)' : ''));

  Object.keys(FIX).forEach(function (name) {
    var r = C.intake(FIX[name], null, null, FS, { base: base });
    var moved = mustHold.filter(function (k) {
      return JSON.stringify(r.state[k]) !== JSON.stringify(base[k]);
    });
    ok(moved.length === 0,
       'the ' + name + ' report leaves all ' + mustHold.length + ' alone' +
       (moved.length ? ' — TRESPASS: ' + moved.join(', ') : ''));
  });

  /* BITES. The same comparison run against a state that DID move the lid
     must go red, or the loop above proves nothing. */
  (function () {
    var spiked = C.sanitizeState(base);
    spiked.lid = -0.3;
    var caught = mustHold.filter(function (k) {
      return JSON.stringify(spiked[k]) !== JSON.stringify(base[k]);
    });
    ok(caught.length === 1 && caught[0] === 'lid',
       'BITES: an intake that started overwriting the lid would be caught here');
  })();
})();

/* ============================================================
   3. THE RECIPE LANDS WHOLE — §16, and the bug that earned it.
   ============================================================ */
console.log('\n— an arrangement is a gesture, not a parameter —');
(function () {
  var fields = Object.keys(C.styleDefaults('velvet'));
  ok(fields.length === 8, 'a recipe is ' + fields.length + ' fields (' + fields.join(', ') + ')');

  C.STYLES.forEach(function (style) {
    var d = C.styleDefaults(style);
    /* force the choice, so this tests the APPLICATION and not the chooser */
    var r = C.intake(FIX.plain, null, null, FS, {
      chooser: function () { return { style: style, confidence: 1, evidence: [] }; }
    });
    var wrong = fields.filter(function (k) { return r.state[k] !== d[k]; });
    ok(r.state.style === style && wrong.length === 0,
       style + ' arrives whole — all ' + fields.length + ' recipe fields applied' +
       (wrong.length ? ' — MISSING: ' + wrong.join(', ') : ''));
  });

  /* The 2026-08-23 bug in one assertion: a style label with the recipe
     left behind. If the intake ever regressed to setting `style` alone,
     four of the five arrangements would come back carrying velvet's
     numbers, and this is what that looks like. */
  var velvetNumbers = C.styleDefaults('velvet');
  var lead = C.intake(FIX.plain, null, null, FS, {
    chooser: function () { return { style: 'lead', confidence: 1, evidence: [] }; }
  }).state;
  var sameAsVelvet = fields.filter(function (k) { return lead[k] === velvetNumbers[k]; });
  ok(lead.seal === true && sameAsVelvet.length < fields.length,
     'lead is not velvet in costume — seal is on and the recipe differs (' +
     (fields.length - sameAsVelvet.length) + ' of ' + fields.length + ' fields)');
})();

/* ============================================================
   4. CONFIDENCE MUST BE EARNED.

   This section exists because the first draft of chooseArrangement failed
   it. Velvet carried a free point so an empty report would land on the
   default, which meant an empty report scored 1 against a field of zeros
   and the margin-over-runner-up confidence read 1.00. Maximum certainty,
   no evidence. The default moved into the tie-break and the point went
   away; these assertions are what keeps it away.
   ============================================================ */
console.log('\n— confidence is earned, not free —');
(function () {
  var empty = C.intake(null, null, null, FS);
  ok(empty.confidence === 0,
     'an empty report is confidence 0.00, not 1.00 (got ' + empty.confidence.toFixed(2) + ')');
  ok(empty.evidence.length === 0, 'and it carries no evidence, which is why');
  ok(empty.arrangement === 'velvet', 'and it still lands on velvet, the way a fresh session does');

  Object.keys(FIX).forEach(function (name) {
    var r = C.intake(FIX[name], null, null, FS);
    ok(r.confidence === 0 || r.evidence.length > 0,
       'the ' + name + ' report cannot be confident without evidence (' +
       r.confidence.toFixed(2) + ' on ' + r.evidence.length + ' findings)');
    ok(r.confidence >= 0 && r.confidence <= 1,
       '  and its confidence is inside 0..1');
  });

  /* Evidence is ordered heaviest first, because a face that prints one
     line should be printing the reason. */
  var b = C.intake(FIX.bright, null, null, FS);
  var ordered = true;
  for (var i = 1; i < b.evidence.length; i++) {
    if (b.evidence[i].weight > b.evidence[i - 1].weight) ordered = false;
  }
  ok(ordered, 'evidence is ordered by weight, heaviest first');
  ok(b.evidence.every(function (e) {
    return e.feature && C.INTAKE_READS[e.feature] &&
           typeof e.reads === 'string' && e.reads.length > 8;
  }), 'every finding names a declared feature and reads in English');

  /* Less material, less certainty — and only when the duration was
     actually reported. */
  var full = C.intake(FIX.percussive, null, null, FS);
  var scrap = {}; for (var k in FIX.percussive) scrap[k] = FIX.percussive[k];
  scrap.dur = 1.5;
  var frag = C.intake(scrap, null, null, FS);
  ok(frag.confidence < full.confidence && frag.arrangement === full.arrangement,
     'a 1.5 s fragment reaches the same verdict with less confidence (' +
     full.confidence.toFixed(2) + ' → ' + frag.confidence.toFixed(2) + ')');
  var noDur = {}; for (var k2 in FIX.percussive) noDur[k2] = FIX.percussive[k2];
  delete noDur.dur;
  ok(C.intake(noDur, null, null, FS).confidence === full.confidence,
     'an ABSENT duration is unknown rather than short, and is not punished as though it were');
})();

/* ============================================================
   5. THE DECLARED VECTOR — both directions.

   INTAKE_READS is a promise about what CASKET depends on. A promise that
   is only checked in one direction rots in the other: a field read but
   never declared is an undocumented dependency, and a field declared but
   never read is a lie about what matters.
   ============================================================ */
console.log('\n— the vector CASKET says it depends on —');
(function () {
  var declared = Object.keys(C.INTAKE_READS);
  var src = C.chooseArrangement.toString();

  /* every feature the source actually pulls out of the vector */
  var used = [], m, re = /readFeature\(\s*f\s*,\s*'([a-zA-Z0-9_]+)'\s*\)/g;
  while ((m = re.exec(src)) !== null) if (used.indexOf(m[1]) < 0) used.push(m[1]);

  var undeclared = used.filter(function (k) { return declared.indexOf(k) < 0; });
  ok(undeclared.length === 0,
     'the chooser reads nothing it did not declare' +
     (undeclared.length ? ' — UNDECLARED: ' + undeclared.join(', ') : ''));

  /* The vector is reached ONLY through readFeature, which is what makes
     the regex above a census rather than a sample. A bare `f.crest`
     would slip past it, so forbid the shape. */
  ok(!/\bf\.[a-zA-Z]/.test(src) && !/\bf\[\s*'/.test(src),
     'and it reaches the vector only through readFeature, so LAW 5 applies everywhere');

  /* Declared but dead: perturbing it must change SOMETHING, or the entry
     is decoration. Each feature is swept across the range CORONER
     declares for it and the (style, confidence) pair must move at least
     once.

     SWEPT ACROSS EVERY FIXTURE, and the first version was not. It swept
     only `plain`, which scores zero on every rule — and since `dur` acts
     by SCALING confidence, multiplying a zero by five different durations
     gives five zeros, and the check reported `dur` as dead code. It is
     not dead; it is conditional, and a census that can only see a feature
     under one set of conditions will keep reporting the conditional ones
     as dead. Requiring a feature to matter SOMEWHERE is the honest form
     of this question. */
  var SWEEP = {
    crest:     [1, 4, 8, 12, 20, 40],
    onsetRate: [0, 1, 3, 8, 20, 40],
    attack:    [0, 0.001, 0.02, 0.08, 1, 4],
    sustain:   [0, 0.1, 0.5, 0.8, 1],
    flatness:  [0, 0.2, 0.45, 0.7, 1],
    highRatio: [0, 0.05, 0.11, 0.2, 1],
    dur:       [0.5, 2, 5, 60, 3600]
  };
  var dead = declared.filter(function (id) {
    var movedSomewhere = false;
    Object.keys(FIX).forEach(function (fixture) {
      var seen = {}, n = 0;
      (SWEEP[id] || []).forEach(function (v) {
        var f = {}; for (var k in FIX[fixture]) f[k] = FIX[fixture][k];
        f[id] = v;
        var r = C.chooseArrangement(f);
        var key = r.style + '/' + r.confidence.toFixed(4);
        if (!seen[key]) { seen[key] = 1; n++; }
      });
      if (n >= 2) movedSomewhere = true;
    });
    return !movedSomewhere;
  });
  ok(dead.length === 0,
     'every declared feature actually changes an outcome' +
     (dead.length ? ' — DEAD: ' + dead.join(', ') : ' (all ' + declared.length + ' of them)'));

  ok(Object.keys(SWEEP).length === declared.length,
     'the sweep covers every declared feature, so none is untested by omission');

  /* BITES. The deadness detector has to be able to SEE deadness, or the
     assertion above is a green light with nothing behind it. `centroid`
     is a real CORONER feature that CASKET deliberately does not read, so
     it is the honest control: run it through the identical machinery and
     it must come back dead. */
  (function () {
    var movedSomewhere = false;
    Object.keys(FIX).forEach(function (fixture) {
      var seen = {}, n = 0;
      [200, 800, 2000, 6000].forEach(function (v) {
        var f = {}; for (var k in FIX[fixture]) f[k] = FIX[fixture][k];
        f.centroid = v;
        var r = C.chooseArrangement(f);
        var key = r.style + '/' + r.confidence.toFixed(4);
        if (!seen[key]) { seen[key] = 1; n++; }
      });
      if (n >= 2) movedSomewhere = true;
    });
    ok(!movedSomewhere,
       'BITES: `centroid`, which CASKET does not read, comes back dead through the same check');
  })();
})();

/* ============================================================
   6. ZERO IS A LEGAL VALUE — the LAW 5 probe.

   Nearly every feature here can legitimately be zero: silence has no
   onsets, a tone has no air, a sample has no measured duration. The
   `+x || def` idiom reads all of those as "absent" and substitutes a
   neutral value, which is a wrong answer that looks exactly like a right
   one. AUTOPSY paid for this lesson; the fallback here is isFinite.
   ============================================================ */
console.log('\n— zero is a value, not an absence —');
(function () {
  /* onsetRate 0 is sparser than the 1.5 threshold and must vote for the
     long-release arrangements. A `|| 3` bug would read the neutral 3 and
     cast no vote at all. */
  var f = {}; for (var k in FIX.plain) f[k] = FIX.plain[k];
  f.onsetRate = 0;
  var zero = C.chooseArrangement(f);
  var votedOnOnset = zero.evidence.some(function (e) { return e.feature === 'onsetRate'; });
  ok(votedOnOnset, 'onsetRate 0 is heard as "sparse", not as "missing"');

  delete f.onsetRate;
  var absent = C.chooseArrangement(f);
  ok(!absent.evidence.some(function (e) { return e.feature === 'onsetRate'; }),
     'and an ABSENT onsetRate casts no vote, which is the difference the idiom hides');

  /* highRatio 0 and flatness 0 must not reach for the seal */
  var g = {}; for (var k2 in FIX.bright) g[k2] = FIX.bright[k2];
  g.highRatio = 0; g.flatness = 0;
  ok(C.chooseArrangement(g).style !== 'lead',
     'a report with no air and no noise does not get the seal');
})();

/* ============================================================
   7. THE SAME REPORT TWICE — determinism and the fixpoint.
   ============================================================ */
console.log('\n— the same report twice —');
(function () {
  Object.keys(FIX).forEach(function (name) {
    var a = C.intake(FIX[name], null, null, FS).state;
    var b = C.intake(FIX[name], null, null, FS).state;
    ok(JSON.stringify(a) === JSON.stringify(b),
       'the ' + name + ' report gives a byte-identical state twice');
    ok(JSON.stringify(C.sanitizeState(a)) === JSON.stringify(a),
       '  and that state is a sanitize FIXPOINT — a save/load cycle cannot drift it');
  });
})();

/* ============================================================
   8. WITH AUDIO — the two numbers that must never be opinions.

   Short buffers on purpose: autoDrive's bisection plus autoMargin's
   verified passes cost about a second per second of stereo material, and
   a gate nobody runs because it takes a minute is a gate that rots.
   ============================================================ */
console.log('\n— the numbers it measures rather than guesses —');
(function () {
  var n = FS;                        /* one second */
  var L = C.makeNoise(1848, n), R = C.makeNoise(9021, n);

  var r = C.intake(FIX.bright, L, R, FS, { targetLufs: -14 });
  ok(r.measured !== null, 'handed audio, it reports a measurement block');
  ok(isFinite(r.measured.drive) && isFinite(r.measured.margin),
     '  with a finite drive and margin');

  /* THE GUARANTEE, on the state it just handed back. Measured with a
     longer reconstruction than the engine's own detector, the way
     autoMargin does, so this is a check rather than the same code marking
     its own work. */
  var out = C.renderOffline(r.state, L, R, FS);
  var lid = r.state.lid + r.state.margin;
  var tp = 20 * Math.log10(Math.max(C.truePeakOf(out.L, 16, 64), C.truePeakOf(out.R, 16, 64)));
  ok(tp <= lid + 1e-6,
     'the lid still holds on the state the intake produced (' + tp.toFixed(4) +
     ' dBTP against ' + lid.toFixed(3) + ')');

  /* THE MARGIN ONLY EVER TIGHTENS. Lead ships -0.3 because that covers
     material in general. On material that overshoots by nothing,
     autoMargin's honest answer is 0 — and taking it would mean the intake
     silently removing a safety allowance on the one path where nobody is
     watching the knob. */
  var quiet = new Float64Array(n), quietR = new Float64Array(n);
  for (var i = 0; i < n; i++) { quiet[i] = L[i] * 0.02; quietR[i] = R[i] * 0.02; }
  var sealed = C.intake(FIX.bright, quiet, quietR, FS, { targetLufs: -30, measure: true });
  var leadMargin = C.styleDefaults('lead').margin;
  if (sealed.arrangement === 'lead') {
    ok(sealed.state.margin <= leadMargin,
       'on material that needs no margin, lead KEEPS its ' + leadMargin +
       ' rather than being relaxed to 0 (got ' + sealed.state.margin + ')');
  } else {
    ok(false, 'the quiet-bright fixture was expected to choose lead, got ' + sealed.arrangement);
  }

  /* measure:false is the cheap path and must skip the renders entirely */
  var t0 = Date.now();
  var cheap = C.intake(FIX.bright, L, R, FS, { measure: false });
  var dt = Date.now() - t0;
  ok(cheap.measured === null && dt < 200,
     'measure:false skips the renders (' + dt + ' ms) and says so by reporting no measurement');
})();

/* ============================================================
   9. WHEN THE OTHER SIDE CHANGES OR MISBEHAVES.
   ============================================================ */
console.log('\n— when the other side changes under us —');
(function () {
  var stale = {}; for (var k in FIX.plain) stale[k] = FIX.plain[k];
  stale.version = C.INTAKE_FEATURE_VERSION + 5;
  var r = C.intake(stale, null, null, FS);
  ok(r.state && r.warnings.some(function (w) { return /version/.test(w); }),
     'a feature vector from a future CORONER is reported, not refused');
  ok(r.featureVersion === stale.version, '  and the version it was handed is echoed back');

  /* THE OTHER HALF, and it is the half that actually went wrong. A report
     stamped with the version CASKET declares must produce NO version
     warning at all. On 2026-08-27 CORONER moved to 3 within hours of this
     being written against 2, so every real report tripped the mismatch —
     and a warning that always fires is a warning nobody reads, which
     turns a genuine signal into furniture. Asserting only that a
     MISMATCH warns would have gone green through the whole of that. */
  var current = {}; for (var ck in FIX.plain) current[ck] = FIX.plain[ck];
  current.version = C.INTAKE_FEATURE_VERSION;
  var matched = C.intake(current, null, null, FS);
  ok(!matched.warnings.some(function (w) { return /version/.test(w); }),
     'a report at the version CASKET declares raises NO version warning' +
     ' (INTAKE_FEATURE_VERSION = ' + C.INTAKE_FEATURE_VERSION + ')');

  var partial = C.intake({ version: C.INTAKE_FEATURE_VERSION, crest: 12 }, null, null, FS);
  ok(partial.warnings.some(function (w) { return /neutral defaults/.test(w); }),
     'a partial vector names the fields it had to default');

  /* Hostile values inside the declared fields */
  var nasty = { version: V, crest: NaN, onsetRate: Infinity, attack: -5,
                sustain: 'loud', flatness: null, highRatio: 1e300, dur: -1 };
  var n2 = null, threw = null;
  try { n2 = C.intake(nasty, null, null, FS); } catch (e) { threw = e; }
  ok(!threw && n2 && C.STYLES.indexOf(n2.state.style) >= 0,
     'NaN, Infinity, a string and a negative all degrade to a legal state' +
     (threw ? ' — THREW: ' + threw.message : ''));
  ok(JSON.stringify(C.sanitizeState(n2.state)) === JSON.stringify(n2.state),
     '  and it is still a sanitize fixpoint');

  /* A replacement chooser is the whole point of the layer split, so a
     BROKEN replacement must not be able to produce an illegal state. */
  var bogus = C.intake(FIX.plain, null, null, FS, {
    chooser: function () { return { style: 'mahogany', confidence: 9, evidence: null }; }
  });
  ok(C.STYLES.indexOf(bogus.state.style) >= 0 &&
     bogus.warnings.some(function (w) { return /does not have/.test(w); }),
     'a chooser naming an arrangement CASKET does not have falls back and says so');
  ok(Array.isArray(bogus.evidence), '  and evidence is still an array, not the null it was handed');

  var thrower = null, caught = null;
  try {
    thrower = C.intake(FIX.plain, null, null, FS, { chooser: function () { return null; } });
  } catch (e) { caught = e; }
  ok(!caught && thrower && thrower.state,
     'a chooser that returns nothing at all still yields a state' +
     (caught ? ' — THREW: ' + caught.message : ''));
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (!fail) console.log('the report is advice. the state is CASKET\'s.');
process.exit(fail ? 1 : 0);
