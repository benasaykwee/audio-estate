/* CASKET soak — node tests/casket_soak.js [minutes] [--only=pine,lead]
   Not part of the fast harness. This is the slow kind of wrong: running
   sums that creep, meters that saturate, envelopes that wander after an
   hour of continuous audio. Everything here is O(1) per sample by design,
   so if it drifts the design is wrong rather than merely slow.

   --only=NAME[,NAME] runs a subset of the arrangements — added 2026-08-19
   for the same reason casket_fuzz.js has --from: the nightly runs 12
   minutes per arrangement, five arrangements, in ONE process, and some
   environments cap a single process well below that. The full sweep had
   therefore never been completed anywhere except CI, which makes CI the
   only witness to a test whose entire purpose is catching slow drift.
   Splitting it across runs is not as good as one long process — a drift
   that needed all five arrangements' worth of wall clock in one engine
   would still hide — but each arrangement gets its OWN engine here, so
   per-arrangement is the natural seam and nothing is lost by cutting on it.

   VERIFIED, not asserted (2026-08-19): the same arrangement run inside a
   full sweep and run alone under --only produces byte-identical output —
   every field, including the boxcar drift figure that is the whole point of
   this harness. That is what "nothing is lost" has to mean, and it was a
   claim in this comment before it was a thing anyone had checked. It holds
   because `soak()` calls C.createEngine() per arrangement, so there is no
   state for a neighbour to have influenced. */
'use strict';
var C = require('../casket_core.js');

var ONLY = (function () {
  var a = process.argv.slice(2).filter(function (x) { return x.indexOf('--only=') === 0; })[0];
  return a ? a.slice(7).split(',') : null;
})();
var MINUTES = parseFloat(process.argv.slice(2).filter(function (x) {
  return x.indexOf('--') !== 0;
})[0]) || 20;
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
  var lidLin = C._nd.dbToLin(st.lid + st.margin);
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

var RUN = ONLY ? C.STYLES.filter(function (s) { return ONLY.indexOf(s) >= 0; }) : C.STYLES;
var unknown = ONLY ? ONLY.filter(function (s) { return C.STYLES.indexOf(s) < 0; }) : [];
if (unknown.length) {
  console.error('unknown arrangement(s): ' + unknown.join(', ') +
                '  — known: ' + C.STYLES.join(', '));
  process.exit(2);
}
if (!RUN.length) { console.error('--only selected no arrangements'); process.exit(2); }

console.log('CASKET soak — ' + MINUTES + ' minutes per arrangement at ' + rate + ' Hz, shaped dust armed');
console.log('(' + (blocks * CH).toLocaleString() + ' samples per channel each)');
if (ONLY) console.log('running ' + RUN.length + ' of ' + C.STYLES.length +
                      ' arrangements: ' + RUN.join(', '));
console.log('');
RUN.forEach(soak);
/* A PARTIAL SWEEP SAYS SO. Same rule as casket_tools_fuzz.js's time budget:
   "nothing drifted" after two of five arrangements is true and misleading,
   and the two are indistinguishable in a log a week later. */
if (!fails && RUN.length < C.STYLES.length) {
  console.log('\n' + RUN.length + ' of ' + C.STYLES.length + ' arrangements held (' +
              RUN.join(', ') + ') — a PARTIAL sweep. The others were not run.');
} else {
  console.log('\n' + (fails ? fails + ' arrangement(s) drifted.' : 'nothing drifted. the box holds.'));
}
process.exit(fails ? 1 : 0);
