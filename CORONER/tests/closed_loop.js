/* ===================================================================
   CORONER — THE CLOSED LOOP
   tests/closed_loop.js

   Render each NECROPHONE engine, hand the audio straight back to
   CORONER, and check where it goes.

   THIS TEST EXISTS BECAUSE IT ALREADY FOUND SOMETHING. Run once by hand
   from a NECROPHONE session, it caught the strongest physical tell in
   the machine running exactly backwards: the GRAIN CLOUD measured
   B = 9.22e-3 at R² = 0.999 — the best stiff-string fit in the set — and
   was routed to the physical engine, while `Bone & Sinew`, the actual
   string model, measured 2.23e-6 and was sent to the granular one.
   Eight real files and seventeen deliberate sabotages had all missed it.

   WHAT THIS CAN AND CANNOT ASSERT, stated before the code so the number
   at the bottom is not read as more than it is. `chooseEngine` maps
   MATERIAL to a SUITABLE engine — not audio to its origin. A stable
   harmonic wavetable render genuinely does suit The Revenant, so
   "did it come home" is the wrong question and would fail honestly.
   What can be asserted:

     · a render must never be routed to an engine that CANNOT make that
       kind of sound;
     · a verdict outside the defensible set must not be CONFIDENT
       (Bone & Sinew's wrong answer came back at 0.94);
     · the grain cloud must never again report plausible string
       stiffness — the closed bug, gated directly;
     · nothing anywhere may be NaN.

   DETERMINISM. NECROPHONE renders through `Math.random()`. A harness
   built on that is flaky, and a flaky test is usually a badly posed one.
   `Math.random` is therefore swapped for a seeded mulberry32 for the
   duration of every render and restored afterwards, so the same seed
   gives the same audio and a failure here means something moved.

   Run:  node tests/closed_loop.js
   =================================================================== */

'use strict';

var path = require('path');
var fs = require('fs');

var HERE = __dirname;
var ROOT = path.join(HERE, '..', '..');

var NM = require(path.join(ROOT, 'shared', 'necromath.js'));
global.NM = NM;
var CR = require(path.join(HERE, '..', 'coroner_core.js'));

require('./_requires.js').requires({
  name: "the closed loop",
  files: [path.join(ROOT, 'necrophone_core.js')],
  because: 'NECROPHONE is deliberately not in the estate repository — the root .gitignore is an allowlist, and its own comment explains that a workflow without its sources is a job that can only fail.',
  gates: [
    "that a rendered engine is never routed to one that cannot make that sound",
    "that the grain cloud never again reports plausible string stiffness",
    "that no verdict outside the defensible set comes back CONFIDENT",
    "that snap() is still being called, without which all four engines render identically"
  ]
});
var NECRO = require(path.join(ROOT, 'necrophone_core.js'));

var pass = 0, fail = 0, failures = [], section = '';
function sec(s) { section = s; console.log('\n' + s); }
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; failures.push(section + ' :: ' + name + (detail ? '  [' + detail + ']' : ''));
    console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : ''));
  }
}

// ===================================================================
// THE SEEDED RENDER
// ===================================================================

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

var SR = 44100;

/* Render notes through a real NecrophoneCore. `Math.random` is replaced
   for the whole render and restored in a `finally`, so a throw inside the
   engine cannot leave the global patched for every later test. */
function render(params, notes, seconds, seed) {
  var realRandom = Math.random;
  Math.random = mulberry32(seed || 1);
  try {
    var core = new NECRO.NecrophoneCore(SR);
    var p = NECRO.defaults();
    for (var k in params) p[k] = params[k];
    /* Anything that would make the render a performance rather than a
       sound is forced off: the arp invents notes, and a wandering master
       level would move every envelope measurement for no reason. */
    p.arpOn = 'off';
    p.vol = 0.8;
    core.setParams(p);

    var n = Math.floor(seconds * SR);
    var L = new Float32Array(n), R = new Float32Array(n);
    var BLK = 128;

    // schedule: each note on at its own time, all released at 70% through
    var events = notes.map(function (nt, ix) {
      return { note: nt, onAt: Math.floor((ix / notes.length) * n * 0.6), offAt: Math.floor(n * 0.72) };
    });

    var bl = new Float32Array(BLK), br = new Float32Array(BLK);
    for (var off = 0; off < n; off += BLK) {
      var len = Math.min(BLK, n - off);
      events.forEach(function (e) {
        if (e.onAt >= off && e.onAt < off + len && !e.fired) { core.noteOn(e.note, 100, 0); e.fired = 1; }
        if (e.offAt >= off && e.offAt < off + len && !e.released) { core.noteOff(e.note, 0); e.released = 1; }
      });
      core.render(bl, br, len);
      for (var i = 0; i < len; i++) { L[off + i] = bl[i]; R[off + i] = br[i]; }
    }
    return { left: L, right: R, sr: SR };
  } finally {
    Math.random = realRandom;
  }
}

function peakOf(buf) {
  var pk = 0;
  for (var i = 0; i < buf.length; i++) { var a = Math.abs(buf[i]); if (a > pk) pk = a; }
  return pk;
}

// ===================================================================
// THE FOUR ENGINES
// ===================================================================

/* A corpse for the engines that grind one. Without material, Dust & Ashes
   has nothing to work on — which is itself the fault the pack handoff was
   built to close, and is not what this test is measuring. */
function corpse(seconds) {
  var n = Math.floor(seconds * SR), m = new Float32Array(n), ph = 0;
  for (var i = 0; i < n; i++) {
    ph += 2 * Math.PI * 196 / SR;
    var s = 0;
    for (var k = 1; k <= 9; k++) s += (1 / k) * NM.sin(ph * k);
    m[i] = s * 0.2 * (0.6 + 0.4 * NM.sin(2 * Math.PI * 0.7 * i / SR));
  }
  return m;
}

var ENGINES = [
  {
    id: 'analog', label: 'The Revenant',
    params: { engine: 'analog', anWave: 'sawtooth', anDet: 6, anSub: 0.2,
              atk: 0.02, dec: 0.4, sus: 0.85, rel: 0.5, cut: 6000, res: 1.2,
              rev: 0, dly: 0, chor: 0, sat: 0 },
    /* A stable harmonic oscillator. It may honestly read as any sustained
       family — that is what it sounds like. It must NOT read as a struck
       string, because it has no stiffness and no attack transient. */
    defensible: ['synthetic', 'blown', 'bowed', 'voice'],
    cannotRouteTo: ['physical']
  },
  {
    id: 'wavetable', label: 'Chorus of Breath',
    params: { engine: 'wavetable', wtMor: 0.5, wtBlm: 20,
              atk: 0.08, dec: 0.5, sus: 0.8, rel: 0.6, cut: 7000,
              rev: 0, dly: 0, chor: 0, sat: 0 },
    defensible: ['synthetic', 'blown', 'bowed', 'voice'],
    cannotRouteTo: ['physical']
  },
  {
    id: 'granular', label: 'Dust & Ashes',
    params: { engine: 'granular', grSize: 90, grDens: 24, grSpray: 0.5, grDrift: 0.3,
              atk: 0.05, dec: 0.6, sus: 0.8, rel: 0.7, cut: 9000,
              rev: 0, dly: 0, chor: 0, sat: 0 },
    needsCorpse: true,
    /* A cloud of grains. It is texture. It is emphatically not a string,
       and this is the case that caught the inverted tell. */
    defensible: ['noise', 'percussive', 'synthetic', 'ensemble'],
    cannotRouteTo: ['physical']
  },
  {
    id: 'physical', label: 'Bone & Sinew',
    params: { engine: 'physical', phHard: 0.6, phDecay: 0.97, phBody: 4000,
              atk: 0.001, dec: 1.2, sus: 0.1, rel: 0.8, cut: 8000,
              rev: 0, dly: 0, chor: 0, sat: 0 },
    /* 'percussive' is deliberately NOT here. It means UNPITCHED, and a
       string model ringing at G3 is pitched. Allowing it is what let a
       "Percussive at 94%" verdict pass this gate on the first run — the
       defensible set was doing the classifier's excusing for it. */
    defensible: ['plucked', 'synthetic', 'bowed'],
    cannotRouteTo: []
  }
];

// ===================================================================
sec('I. Every engine renders, and renders reproducibly');

var RENDERS = {};

ENGINES.forEach(function (E) {
  var mat = E.needsCorpse ? corpse(2.0) : null;

  function doRender(seed) {
    var params = {};
    for (var k in E.params) params[k] = E.params[k];
    var realRandom = Math.random;
    Math.random = mulberry32(seed);
    var core;
    try {
      core = new NECRO.NecrophoneCore(SR);
      var p = NECRO.defaults();
      for (var kk in params) p[kk] = params[kk];
      p.arpOn = 'off'; p.vol = 0.8;
      core.setParams(p);

      /* ⚠ snap() IS NOT OPTIONAL, and leaving it out fails SILENTLY.

         `setParams` writes to `this.params`, which are TARGETS. The values
         a voice is actually built from are `this.cur`, and those only move
         when `smoothTick()` runs — which happens inside `render()`. So a
         `noteOn` issued before the first render builds its voice from
         whatever `cur` still holds, which is `defaults()`.

         Measured, because the first version of this harness got it wrong:
         without snap(), all four engines rendered BYTE-IDENTICALLY. Not
         approximately — identically. The test was measuring the default
         patch four times and labelling the results 'analog', 'wavetable',
         'granular' and 'physical'. Every assertion passed. With snap(),
         the four separate immediately (summed |x|: 26932 / 25960 / 24766 /
         4732).

         This is the shape worth carrying: an offline render that omits
         snap() does not crash, does not warn, and produces a completely
         plausible wrong answer. Anything that renders NECROPHONE headless
         must call it — the training-corpus renderer above all, where the
         mistake would poison a million samples and every one of them would
         look fine. */
      core.snap();

      if (mat && typeof core.setMaterial === 'function') core.setMaterial(mat, SR);
    } finally { Math.random = realRandom; }

    realRandom = Math.random;
    Math.random = mulberry32(seed);
    try {
      var n = Math.floor(2.4 * SR);
      var L = new Float32Array(n), R = new Float32Array(n);
      var BLK = 128, bl = new Float32Array(BLK), br = new Float32Array(BLK);
      var onAt = 0, offAt = Math.floor(n * 0.72), fired = 0, rel = 0;
      for (var off = 0; off < n; off += BLK) {
        var len = Math.min(BLK, n - off);
        if (!fired && onAt < off + len) { core.noteOn(55, 100, 0); fired = 1; }
        if (!rel && offAt >= off && offAt < off + len) { core.noteOff(55, 0); rel = 1; }
        core.render(bl, br, len);
        for (var i = 0; i < len; i++) { L[off + i] = bl[i]; R[off + i] = br[i]; }
      }
      return { left: L, right: R };
    } finally { Math.random = realRandom; }
  }

  var a = doRender(12345);
  var b = doRender(12345);

  var pk = peakOf(a.left);
  ok(E.label + ' renders something audible', pk > 0.001, 'peak ' + pk.toFixed(5));

  var same = a.left.length === b.left.length;
  if (same) for (var i = 0; i < a.left.length; i++) if (a.left[i] !== b.left[i]) { same = false; break; }
  /* Reported rather than asserted for granular. NECROPHONE's own notes
     record that the granular engine has randomness beyond Math.random and
     is not bit-reproducible; only the spectral path is. Asserting equality
     there would be asserting something known to be false. */
  if (E.id === 'granular') {
    console.log('       (granular reproducibility: ' + (same ? 'bit-identical' : 'differs — expected, per NECROPHONE\'s own notes') + ')');
    ok(E.label + ' at least renders a stable LEVEL across seeds',
       Math.abs(peakOf(a.left) - peakOf(b.left)) < 0.25,
       'peaks ' + peakOf(a.left).toFixed(4) + ' vs ' + peakOf(b.left).toFixed(4));
  } else {
    ok(E.label + ' is bit-reproducible under a seeded Math.random', same);
  }

  RENDERS[E.id] = a;
});

// ===================================================================
sec('II. Where each render is routed');

var results = {};

ENGINES.forEach(function (E) {
  var r = RENDERS[E.id];
  if (peakOf(r.left) <= 0.001) { ok(E.label + ' skipped (silent render)', true); return; }

  var rep = CR.autopsy({ left: r.left, right: r.right }, SR);
  results[E.id] = rep;

  var v = rep.verdict, f = rep.features;
  console.log('       ' + E.label.padEnd(18) + v.name.padEnd(26) +
              (v.confidence * 100).toFixed(0) + '%  → ' + rep.slip.target +
              (rep.slip.engine ? '/' + rep.slip.engine : '') +
              '   B=' + f.inharm.toExponential(1) + ' fit=' + f.inharmFit.toFixed(2) +
              ' jit=' + f.f0jitter.toFixed(1));

  // --- no NaN, ever ---
  var bad = 0;
  for (var i = 0; i < rep.vector.length; i++) if (!isFinite(rep.vector[i])) bad++;
  ok(E.label + ' produces a finite feature vector', bad === 0, bad + ' non-finite');

  // --- never routed to an engine that cannot make that sound ---
  if (E.cannotRouteTo.length) {
    var to = rep.slip.engine;
    ok(E.label + ' is not routed to ' + E.cannotRouteTo.join('/') + ' — which cannot make it',
       E.cannotRouteTo.indexOf(to) < 0, 'routed to ' + to);
  }

  // --- a verdict outside the defensible set must not be confident ---
  var defensible = E.defensible.indexOf(v.klass) >= 0;
  if (!defensible) {
    ok(E.label + ' reads as "' + v.klass + '" — arguable, so it must NOT be confident',
       v.confidence <= 0.9, 'confidence ' + (v.confidence * 100).toFixed(0) + '%');
  } else {
    ok(E.label + ' reads as "' + v.klass + '", which is defensible', true);
  }
});

// ===================================================================
sec('III. The closed bug, gated directly');

(function () {
  var rep = results.granular;
  if (!rep) { ok('granular render available', false, 'no render'); return; }
  var f = rep.features;

  /* THE REGRESSION GUARD. B = 9.22e-3 at R² = 0.999 is what this looked
     like before the plausibility ceiling. The fit is allowed to be
     excellent — that was never the problem, and asserting the fit is low
     would be gating the wrong thing. The VALUE must be impossible for a
     string, because a cloud of grains is not one. */
  ok('the grain cloud does not report plausible string stiffness',
     f.inharm < 5e-5,
     'B=' + f.inharm.toExponential(2) + ' at fit ' + f.inharmFit.toFixed(3));

  ok('and it is not sent to the string model',
     rep.slip.engine !== 'physical', 'routed to ' + rep.slip.engine);
})();

(function () {
  var rep = results.physical;
  if (!rep) { ok('physical render available', false, 'no render'); return; }
  /* THE OTHER HALF, and it is NOT a CORONER fault. Bone & Sinew has no
     dispersion — three parameters, and the only allpasses in
     necrophone_core.js are in the reverb — so it is an ideal flexible
     string with zero stiffness by construction. CORONER measures that
     correctly. This is recorded rather than asserted as a pass or a fail,
     because the day someone adds dispersion it should CHANGE, loudly. */
  var f = rep.features;
  console.log('       Bone & Sinew stiffness: B=' + f.inharm.toExponential(2) +
              ' fit=' + f.inharmFit.toFixed(3) +
              '  (an ideal flexible string has none — this is NECROPHONE\'s shape, not a CORONER fault)');
  ok('the string model is measured, whatever it measures to', isFinite(f.inharm));
})();

// ===================================================================
sec('IV. No verdict anywhere is confidently wrong');

(function () {
  var worst = null;
  ENGINES.forEach(function (E) {
    var rep = results[E.id];
    if (!rep) return;
    if (E.defensible.indexOf(rep.verdict.klass) >= 0) return;
    if (!worst || rep.verdict.confidence > worst.c) {
      worst = { e: E.label, k: rep.verdict.klass, c: rep.verdict.confidence };
    }
  });
  if (!worst) {
    ok('every engine reached a defensible verdict', true);
  } else {
    ok('the least defensible verdict is still not confident',
       worst.c <= 0.9,
       worst.e + ' → "' + worst.k + '" at ' + (worst.c * 100).toFixed(0) + '%');
  }
})();

// ===================================================================
console.log('\n' + '='.repeat(66));
console.log('CORONER closed loop — ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' checks');
if (fail) { console.log('\nfailures:'); failures.forEach(function (f) { console.log('  · ' + f); }); }
console.log('='.repeat(66));
process.exit(fail ? 1 : 0);
