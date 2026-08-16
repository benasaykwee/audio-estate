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

var FS = 48000;
var PASSES = parseInt(process.argv[2], 10) || 200;
var BLOCK = 64;                 // small blocks: worst case for reallocation
var BLOCKS = 120;
var pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } }

function run(label, mutate) {
  var nonFinite = 0, over = 0, worstOver = 0, r = ND.lcg(31337), p;
  for (p = 0; p < PASSES; p++) {
    var st = C.defaultState();
    st.lid = -1; st.margin = 0; st.drive = 12; st.dc = false;
    var e = C.createEngine(FS);
    e.setState(st);
    var inL = new Float64Array(BLOCK), inR = new Float64Array(BLOCK);
    var oL = new Float64Array(BLOCK), oR = new Float64Array(BLOCK);
    var lidLin = Math.pow(10, (st.lid + st.margin) / 20);
    for (var b = 0; b < BLOCKS; b++) {
      mutate(st, r, b);
      var s2 = C.sanitizeState(st);
      lidLin = Math.pow(10, (s2.lid + s2.margin) / 20);
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
