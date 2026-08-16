/* CASKET soak — node tests/casket_soak.js [minutes]
   Not part of the fast harness. This is the slow kind of wrong: running
   sums that creep, meters that saturate, envelopes that wander after an
   hour of continuous audio. Everything here is O(1) per sample by design,
   so if it drifts the design is wrong rather than merely slow. */
'use strict';
var C = require('../casket_core.js');

var MINUTES = parseFloat(process.argv[2]) || 20;
var rate = 48000, CH = rate * 10;              // 10 s per block
var blocks = Math.max(1, Math.round(MINUTES * 6));
var fails = 0;

function soak(styleName) {
  var st = C.defaultState(), d = C.styleDefaults(styleName);
  for (var k in d) st[k] = d[k];
  st.style = styleName; st.lid = -1; st.drive = 8; st.dust = 'shaped';
  var e = C.createEngine(rate);
  e.setState(st);
  var oL = new Float64Array(CH), oR = new Float64Array(CH);
  var lidLin = Math.pow(10, (st.lid + st.margin) / 20);
  var over = 0, nonFinite = 0, i, b;
  for (b = 0; b < blocks; b++) {
    var x = C.makeNoise(7000 + b * 13, CH);
    for (i = 0; i < CH; i++) { var v = x[i] * 5; x[i] = v > 1 ? 1 : (v < -1 ? -1 : v); }
    e.process(x, x, oL, oR);
    for (i = 0; i < CH; i++) {
      if (!isFinite(oL[i]) || !isFinite(oR[i])) nonFinite++;
      if (Math.abs(oL[i]) > lidLin || Math.abs(oR[i]) > lidLin) over++;
    }
  }
  var dbg = e._debug(), m = e.meters();
  var drift = Math.abs(dbg.boxSums[0] - dbg.boxRecomputed[0]) /
              (Math.abs(dbg.boxRecomputed[0]) + 1e-30);
    /* 1e-10 relative, from measurement rather than from a round number.
     Across the five arrangements at 3 minutes each the spread is
     3.4e-13 to 1.2e-11; pine is consistently worst because it has the
     longest boxcar (3 ms vigil, full smoothing), hence the largest
     running sum and the most accumulation. An order of magnitude of
     headroom over the worst measured value, and no more. */
  var bad = nonFinite || over || drift > 1e-10 || !isFinite(m.integrated);
  if (bad) fails++;
  console.log('  ' + (bad ? '✗' : '✓') + ' ' + styleName.padEnd(8) +
              '  non-finite ' + nonFinite +
              '  over ' + over +
              '  boxcar drift ' + drift.toExponential(2) + ' rel' +
              '  integrated ' + (isFinite(m.integrated) ? m.integrated.toFixed(2) : 'NaN') +
              ' LUFS  LRA ' + m.lra.toFixed(2) + ' LU');
}

console.log('CASKET soak — ' + MINUTES + ' minutes per arrangement at ' + rate + ' Hz, shaped dust armed');
console.log('(' + (blocks * CH).toLocaleString() + ' samples per channel each)\n');
C.STYLES.forEach(soak);
console.log('\n' + (fails ? fails + ' arrangement(s) drifted.' : 'nothing drifted. the box holds.'));
process.exit(fails ? 1 : 0);
