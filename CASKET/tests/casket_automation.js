/* CASKET automation stress — node tests/casket_automation.js [passes]
   Everything else in the suite sets a state once and renders. A host does
   not do that: it moves parameters continuously, and some of CASKET's are
   STRUCTURAL — vigil, lining, seal, dust seed — which reallocate the gain
   path and change the reported latency.

   So: hammer setState between blocks, including the structural ones, and
   assert the invariants survive. This is the path a real session takes
   and the one least covered by everything above. */
'use strict';
var C = require('../casket_core.js');
var ND = require('../../shared/necrodyn.js');

/* TWO RATES, and the reason is arithmetic rather than caution. vigilSamples
   ROUNDS the lookahead into whole samples, so 44.1 kHz and 48 kHz do not sit
   at a clean ratio: 2 ms is 96 samples at 48 k and 88 at 44.1 k, the
   smoother's boxcar length is derived from THAT number, and the reported
   latency moves with it. A harness that only ever asks for 48,000 cannot
   see a rounding fault at the rate the studio actually records at — which is
   44.1 kHz on Ben's interface, and therefore the rate every figure witnessed
   during the first listening session was measured at. */
var FS48 = 48000, FS441 = 44100;
var PASSES = parseInt(process.argv[2], 10) || 200;
var BLOCK = 64;                 // small blocks: worst case for reallocation
var BLOCKS = 120;
var pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } }

function run(label, mutate, fsOpt) {
  var FS = fsOpt || FS48;
  var nonFinite = 0, over = 0, worstOver = 0, r = ND.lcg(31337), p;
  for (p = 0; p < PASSES; p++) {
    var st = C.defaultState();
    st.lid = -1; st.margin = 0; st.drive = 12; st.dc = false;
    var e = C.createEngine(FS);
    e.setState(st);
    var inL = new Float64Array(BLOCK), inR = new Float64Array(BLOCK);
    var oL = new Float64Array(BLOCK), oR = new Float64Array(BLOCK);
    var lidLin = C._nd.dbToLin(st.lid + st.margin);
    for (var b = 0; b < BLOCKS; b++) {
      mutate(st, r, b);
      var s2 = C.sanitizeState(st);
      lidLin = C._nd.dbToLin(s2.lid + s2.margin);
      e.setState(s2);
      for (var i = 0; i < BLOCK; i++) {
        var v = (r() * 2 - 1) * 6;
        inL[i] = v > 1 ? 1 : (v < -1 ? -1 : v);
        v = (r() * 2 - 1) * 6;
        inR[i] = v > 1 ? 1 : (v < -1 ? -1 : v);
      }
      e.process(inL, inR, oL, oR);
      for (i = 0; i < BLOCK; i++) {
        if (!isFinite(oL[i]) || !isFinite(oR[i])) nonFinite++;
        var a = Math.abs(oL[i]), c = Math.abs(oR[i]);
        if (a > lidLin) { over++; if (a / lidLin - 1 > worstOver) worstOver = a / lidLin - 1; }
        if (c > lidLin) { over++; if (c / lidLin - 1 > worstOver) worstOver = c / lidLin - 1; }
      }
    }
  }
  ok(nonFinite === 0, label + ': nothing went non-finite');
  ok(over === 0, label + ': the lid held through every change' +
     (over ? ' (worst +' + (20 * Math.log10(1 + worstOver)).toFixed(4) + ' dB)' : ''));
}

console.log('CASKET automation stress — ' + PASSES + ' passes × ' + BLOCKS +
            ' blocks of ' + BLOCK + ' samples, setState between every block\n');

/* continuous parameters only — the common case */
run('continuous', function (st, r) {
  st.lid = -1 - r() * 8;
  st.drive = r() * 20;
  st.knee = r() * 12;
  st.release = 1 + r() * 900;
  st.link = r() * 100;
  st.margin = -r();
  st.msMid = (r() * 2 - 1) * 8;
  st.msSide = (r() * 2 - 1) * 8;
});

/* STRUCTURAL — these reallocate the gain path and move the latency.
   The engine rebuilds mid-stream; the ceiling must survive it. */
run('structural', function (st, r) {
  st.vigil = 0.1 + r() * 19.9;
  st.lining = C.LININGS[Math.floor(r() * C.LININGS.length) % C.LININGS.length];
  st.seal = r() < 0.4;
  st.style = C.STYLES[Math.floor(r() * C.STYLES.length) % C.STYLES.length];
});

/* everything at once, dust included */
run('everything', function (st, r) {
  st.lid = -1 - r() * 10;
  st.drive = r() * 22;
  st.vigil = 0.1 + r() * 19.9;
  st.lining = C.LININGS[Math.floor(r() * C.LININGS.length) % C.LININGS.length];
  st.seal = r() < 0.4;
  st.style = C.STYLES[Math.floor(r() * C.STYLES.length) % C.STYLES.length];
  st.ms = r() < 0.4;
  st.msMid = (r() * 2 - 1) * 10;
  st.msSide = (r() * 2 - 1) * 10;
  st.sat = r() < 0.3 ? r() * 100 : 0;
  st.dust = C.DUSTS[Math.floor(r() * C.DUSTS.length) % C.DUSTS.length];
  st.dustBits = C.DUST_BITS[Math.floor(r() * C.DUST_BITS.length) % C.DUST_BITS.length];
  st.unity = r() < 0.3;
  st.dc = r() < 0.5;
});

/* the pathological case: a structural change EVERY block for a long time,
   which is what an automation lane drawn with a mouse actually looks like */
run('vigil swept every block', function (st, r, b) {
  st.vigil = 0.1 + (b % 40) * 0.5;
  st.seal = (b % 7) === 0;
});

/* ARRANGEMENT SWITCHING — the path a user actually takes, and one this
   harness could not previously reach.

   Every arm above that touches `style` sets the LABEL alone, leaving the
   recipe wherever it was. That was a faithful model of the plugin until
   2026-08-23, when it stopped being one: the editor's dropdown now applies
   the whole recipe on a pick, so a single click can move the vigil, the
   lining, the seal, the release, the knee, the margin, the saturation and
   the program-release flag together, between one block and the next, while
   audio is running.

   That is the largest structural change CASKET can be asked to make, it is
   now one gesture away at any moment, and nothing was rendering it. The
   arm below does exactly what applyArrangement() does, mid-stream. */
function applyRecipe(st, style) {
  var d = C.styleDefaults(style);
  for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) st[k] = d[k];
  st.style = style;
}
function arrangementSwitch(st, r, b) {
  /* a fresh pick every few blocks, plus the drive a user would be pushing */
  if (b % 3 === 0) applyRecipe(st, C.STYLES[Math.floor(r() * C.STYLES.length) % C.STYLES.length]);
  st.drive = 8 + r() * 14;
}
run('arrangement switching', arrangementSwitch);

/* and the same two structural arms at the rate the studio records at */
run('structural @ 44.1k', function (st, r) {
  st.vigil = 0.1 + r() * 19.9;
  st.lining = C.LININGS[Math.floor(r() * C.LININGS.length) % C.LININGS.length];
  st.seal = r() < 0.4;
  st.style = C.STYLES[Math.floor(r() * C.STYLES.length) % C.STYLES.length];
}, FS441);
run('arrangement switching @ 44.1k', arrangementSwitch, FS441);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
