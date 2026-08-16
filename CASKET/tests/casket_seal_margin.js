/* CASKET — THE SEAL AND THE MARGIN, MEASURED AGAINST EACH OTHER
   ----------------------------------------------------------------------
   Two features solve the same problem by different means and had never
   been put in the same room.

   THE SEAL applies the gain in the oversampled domain, so the limiter
   controls the reconstructed waveform rather than only the samples. It
   halves the true-peak residual. It costs the null test: a sealed
   arrangement's idle output is decimate(upsample(x)), not x.

   THE MARGIN just lowers the lid, trading loudness for headroom. It costs
   nothing structurally and guarantees nothing by itself.

   AUTO-MARGIN measures how much margin the MATERIAL needs. So the obvious
   question, never asked until now: does sealing reduce the margin
   auto-margin asks for, and by how much? If it does, the two features are
   redundant on the same axis and a user paying for both is paying twice.
   If it does not, sealing is buying something margin cannot.

   This harness answers that with numbers rather than with reasoning, and
   asserts the parts of the answer that must not silently change.  */

var C = require('../casket_core.js');
var ND = C._nd;
var pass = 0, fail = 0;

function ok(cond, what) {
  if (cond) { pass++; console.log('  ✓ ' + what); }
  else { fail++; console.log('  ✗ ' + what); }
}
function note(s) { console.log('    · ' + s); }

var FS = 48000, N = 24000;

/* Material chosen to span the residual range. §6.3 measured the residual
   from +0.000 dB on harmonic content to about +1.2 dB on clipped noise,
   so these three should land at the bottom, middle and top of it. */
function clipped(seed, n, amt) {
  var a = C.makeNoise(seed, n);
  for (var i = 0; i < n; i++) {
    var v = a[i] * amt;
    a[i] = v > 1 ? 1 : (v < -1 ? -1 : v);
  }
  return a;
}
var MATERIAL = [
  ['harmonic content (a loud sine pair)', (function () {
    var a = C.makeSine(220, FS, N, 0.7), b = C.makeSine(660, FS, N, 0.28);
    var o = new Float64Array(N);
    for (var i = 0; i < N; i++) o[i] = a[i] + b[i];
    return o;
  })()],
  ['band-limited noise at full tilt', C.makeNoise(21, N)],
  ['hard-clipped noise, the worst case', clipped(5, N, 4)]
];

function stateFor(sealed) {
  var st = C.sanitizeState(C.defaultState());
  var d = C.styleDefaults('lead');
  for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) st[k] = d[k];
  st.seal = sealed;
  st.margin = 0;          // auto-margin's job is to tell us what to put here
  st.drive = 6;           // enough that the limiter is genuinely working
  st.dust = 'off';        // dither has its own ceiling budget; keep it out of this
  return C.sanitizeState(st);
}

console.log('CASKET — the seal vs the margin\n');

console.log('— the residual each mode leaves at margin 0 —');
var rows = [];
MATERIAL.forEach(function (m) {
  var open = C.autoMargin(stateFor(false), m[1], m[1], FS, 6);
  var shut = C.autoMargin(stateFor(true), m[1], m[1], FS, 6);
  rows.push([m[0], open, shut]);
  note(m[0]);
  note('  unsealed: residual ' + open.residual.toFixed(4) +
       ' dB, wants margin ' + open.margin.toFixed(2) +
       ', covered ' + open.covered);
  note('  sealed:   residual ' + shut.residual.toFixed(4) +
       ' dB, wants margin ' + shut.margin.toFixed(2) +
       ', covered ' + shut.covered);
});

console.log('\n— what must be true of the pair —');
rows.forEach(function (r) {
  var name = r[0], open = r[1], shut = r[2];

  /* THE HEADLINE. Sealing controls the reconstructed waveform, so it
     cannot leave MORE inter-sample overshoot than not sealing does.
     A tolerance of 0.02 dB because the decimator has its own ripple. */
  ok(shut.residual <= open.residual + 0.02,
     name + ': sealing never leaves a LARGER residual than not sealing');

  /* And therefore it can never need more margin. If this ever fails, the
     two features are fighting rather than cooperating. */
  ok(shut.margin >= open.margin - 1e-9,
     '  and so it never asks for more margin than the unsealed path');

  /* Both must still be honest about coverage — this is the autoMargin
     contract, and sealing must not be allowed to quietly break it. */
  if (open.covered) {
    ok(open.verifiedPeak <= open.lid + 1e-6,
       '  unsealed "covered" is still a verified measurement, not a claim');
  }
  if (shut.covered) {
    ok(shut.verifiedPeak <= shut.lid + 1e-6,
       '  sealed "covered" is still a verified measurement, not a claim');
  }
});

console.log('\n— the trade, stated in numbers rather than in prose —');
(function () {
  var worst = null;
  rows.forEach(function (r) {
    var saved = r[1].residual - r[2].residual;
    if (worst === null || saved > worst.saved) worst = { name: r[0], saved: saved };
  });
  note('the seal buys at most ' + worst.saved.toFixed(4) +
       ' dB of residual on this material (' + worst.name + ')');

  /* THE COST, asserted so it cannot be forgotten: a sealed arrangement is
     NOT bit-transparent when idle, and an unsealed one is. This is the
     one documented exception to the null test in the whole suite, and it
     belongs in this harness because this is where somebody deciding
     between the two features will look. */
  var quiet = C.makeSine(220, FS, 8192, 0.02);   // far below any lid
  var openSt = stateFor(false), shutSt = stateFor(true);
  openSt.drive = 0; shutSt.drive = 0;
  openSt.margin = 0; shutSt.margin = 0;
  /* THE DC BLOCKER MUST BE OFF, and forgetting it cost me twenty minutes.
     `dc: true` is the DEFAULT state, and a DC blocker is a high-pass — so
     a 220 Hz sine legitimately comes out altered by about -61 dBFS, with
     grPeak sitting at exactly 0 the whole time. That reads precisely like
     a broken null test and is nothing of the kind.
     The main harness has always set `dc = false` here; this one did not,
     and the fault was mine. Fourth time in this project that the
     measuring rig was the broken part. The null test is a statement about
     the LIMITER, so everything that is not the limiter has to be off. */
  openSt.dc = false; shutSt.dc = false;
  var a = C.renderOffline(openSt, quiet, quiet, FS);
  var b = C.renderOffline(shutSt, quiet, quiet, FS);
  var exactOpen = true, exactShut = true, maxShut = 0;
  for (var i = 0; i < quiet.length; i++) {
    if (a.L[i] !== quiet[i]) exactOpen = false;
    var d = Math.abs(b.L[i] - quiet[i]);
    if (d !== 0) { exactShut = false; if (d > maxShut) maxShut = d; }
  }
  ok(exactOpen, 'unsealed passes a quiet signal through BIT-IDENTICALLY');
  ok(!exactShut, 'sealed does NOT — and that is the documented trade, not a regression');
  note('sealed idle error peaks at ' + ND.linToDb(maxShut).toFixed(1) +
       ' dBFS — inaudible, but not zero, and zero is what the null test means');
})();

console.log('\n— and the guarantee holds in both modes regardless —');
MATERIAL.forEach(function (m) {
  [false, true].forEach(function (sealed) {
    var st = stateFor(sealed);
    var am = C.autoMargin(st, m[1], m[1], FS, 6);
    st.margin = am.margin;
    var r = C.renderOffline(st, m[1], m[1], FS);
    var over = 0, lidLin = ND.dbToLin(st.lid);
    for (var i = 0; i < r.L.length; i++) {
      var v = Math.abs(r.L[i]); if (v > lidLin && v - lidLin > over) over = v - lidLin;
    }
    ok(over === 0, (sealed ? 'sealed' : 'unsealed') + ' + auto-margin: no SAMPLE exceeds the lid on ' +
       m[0].split(' ')[0] + ' material');
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
console.log('the seal and the margin are measured against each other, at last.');
