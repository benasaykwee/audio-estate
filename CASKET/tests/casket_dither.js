/* CASKET dither quality — node tests/casket_dither.js
   The harness asserts the dust is SAFE (on the grid, under the lid,
   deterministic). It has never asserted it is GOOD. This measures what
   the shaping actually does to the noise floor, because "shaped" is a
   claim about a spectrum and a claim about a spectrum should be measured.

   Method: quantise digital silence with a tiny DC offset so the dither is
   the only signal, then take the spectrum of the result. Flat TPDF should
   be flat; shaped should be quieter in the midband and louder up top,
   with the same total power. */
'use strict';
var C = require('../casket_core.js');
var ND = require('../../shared/necrodyn.js');
var FS = 48000, N = 1 << 15;
var pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } }

/* real DFT magnitude in dB, averaged into log-spaced bands */
function bands(x) {
  var n = x.length, i;
  /* Goertzel-per-band is cheaper than a full DFT and we only need a few */
  var edges = [20, 200, 1000, 4000, 10000, 16000, 20000, 23999];
  var out = [];
  for (var b = 0; b < edges.length - 1; b++) {
    var lo = edges[b], hi = edges[b + 1], acc = 0, cnt = 0;
    /* sample 24 frequencies inside the band */
    for (var k = 0; k < 24; k++) {
      var f = lo * Math.pow(hi / lo, k / 23);
      var w = 2 * Math.PI * f / FS, sr = 0, si = 0;
      for (i = 0; i < n; i++) { sr += x[i] * Math.cos(w * i); si -= x[i] * Math.sin(w * i); }
      acc += (sr * sr + si * si) / (n * n);
      cnt++;
    }
    out.push({ lo: lo, hi: hi, db: 10 * Math.log10(acc / cnt + 1e-300) });
  }
  return out;
}

function quantised(dust, bits) {
  var st = C.defaultState();
  st.dust = dust; st.dustBits = bits; st.dustSeed = 4242;
  st.lid = 0; st.dc = false; st.lining = 1; st.vigil = 0.1;
  var e = C.createEngine(FS);
  e.setState(st);
  /* a signal far below the LSB: the output is dither and quantisation
     noise and nothing else */
  var x = new Float64Array(N), i;
  var lsb = Math.pow(2, 1 - bits);
  for (i = 0; i < N; i++) x[i] = lsb * 0.1 * Math.sin(2 * Math.PI * 997 * i / FS);
  var oL = new Float64Array(N), oR = new Float64Array(N);
  e.process(x, x, oL, oR);
  return oL.subarray(2000);
}

console.log('CASKET dither quality — what the shaping actually does\n');

var flat = quantised('flat', 16), shaped = quantised('shaped', 16);
var bf = bands(flat), bs = bands(shaped);

console.log('  band              flat TPDF     shaped      shift');
for (var i = 0; i < bf.length; i++) {
  var lbl = (bf[i].lo >= 1000 ? (bf[i].lo / 1000) + 'k' : bf[i].lo) + '–' +
            (bf[i].hi >= 1000 ? (bf[i].hi / 1000) + 'k' : bf[i].hi);
  var d = bs[i].db - bf[i].db;
  console.log('  ' + lbl.padEnd(16) + bf[i].db.toFixed(1).padStart(8) + ' dB' +
              bs[i].db.toFixed(1).padStart(10) + ' dB' +
              (d >= 0 ? '   +' : '   ') + d.toFixed(1) + ' dB');
}
console.log();

/* the midband is where the ear lives — 1-4 kHz */
var mid = 2;                       // the 1k-4k band
var top = bf.length - 1;           // the top band
ok(bs[mid].db < bf[mid].db - 3, 'shaping pushes the noise floor DOWN in the 1–4 kHz band (' +
   (bs[mid].db - bf[mid].db).toFixed(1) + ' dB)');
ok(bs[top].db > bf[top].db + 3, 'and UP above 20 kHz, where it belongs (+' +
   (bs[top].db - bf[top].db).toFixed(1) + ' dB)');

/* total power must not collapse — shaping moves noise, it does not remove it */
function rms(x) { var s = 0; for (var i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / x.length); }
var rf = 20 * Math.log10(rms(flat)), rs = 20 * Math.log10(rms(shaped));
ok(rs > rf, 'shaped has MORE total power than flat — it moves noise, it does not delete it (' +
   rf.toFixed(1) + ' → ' + rs.toFixed(1) + ' dB)');

/* both must actually dither: the output cannot be all zeros, or the
   quantiser has simply truncated a sub-LSB signal to silence */
ok(rms(flat) > 0, 'flat dither is actually present (a truncating quantiser would be silent)');
ok(rms(shaped) > 0, 'shaped dither is actually present');

/* depth must matter, and in the right direction */
var q16 = 20 * Math.log10(rms(quantised('flat', 16)));
var q24 = 20 * Math.log10(rms(quantised('flat', 24)));
ok(q24 < q16 - 40, '24-bit dither is far quieter than 16-bit (' +
   q16.toFixed(1) + ' vs ' + q24.toFixed(1) + ' dB)');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
