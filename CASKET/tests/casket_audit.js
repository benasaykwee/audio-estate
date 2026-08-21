/* CASKET audits — the offline advice functions, checked against math
   OUTSIDE themselves rather than against their own internals.
   node tests/casket_audit.js

   autoDrive, autoMargin and matchReference all give the user a NUMBER and
   ask them to trust it. Nothing else in the suite verifies that trust from
   the outside: casket_test.js and casket_tools_fuzz.js call these functions
   politely and check they don't crash or produce something non-finite, but
   none of them re-derive the claim by a route that does not run back
   through the function being checked. This file does that, on the pattern
   RIGOR's rigor_audit.js proved out: verify a CLAIM with the simplest
   independent measurement available, not by re-implementing the algorithm
   (a bound that re-derives the signal path is a second implementation of
   it, with its own bugs and none of the tests — RIGOR learned that one
   the expensive way). */
'use strict';
var C = require('../casket_core.js');

var pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } }
function styled(name, patch) {
  var s = C.defaultState();
  s.style = name;
  var d = C.styleDefaults ? C.styleDefaults(name) : null;
  if (d) for (var k in d) s[k] = d[k];
  if (patch) for (var k2 in patch) s[k2] = patch[k2];
  return s;
}
var FS = 48000;

console.log('CASKET audits — autoDrive, autoMargin, matchReference, checked from outside\n');

/* ============================================================
   1. autoDrive — the returned drive, independently re-rendered.
   autoDrive's own "verification pass" measures the render it returns, so a
   bug that corrupted the RETURNED numbers without corrupting the render
   itself would sail through the function's own self-check. Re-render here
   through renderOffline directly, with none of autoDrive's machinery in
   the call path, and demand the same numbers.
   ============================================================ */
console.log('— autoDrive —');
(function () {
  var n = 96000;
  var matL = C.makeNoise(11, n), matR = C.makeNoise(12, n);
  for (var i = 0; i < n; i++) { matL[i] *= 0.6; matR[i] *= 0.6; }
  var targets = [-23, -16, -9];
  var styles = ['pine', 'iron', 'lead'];
  var bad = [];
  styles.forEach(function (style) {
    targets.forEach(function (t) {
      var st = styled(style, { lid: -1.0 });
      var ad = C.autoDrive(st, matL, matR, FS, t);
      var vs = C.sanitizeState(st);
      vs.drive = ad.drive; vs.unity = false;
      var v = C.renderOffline(vs, matL, matR, FS).meters;
      if (v.integrated !== ad.lufs)
        bad.push(style + '/' + t + ': independent render gives ' + v.integrated +
                  ' LUFS, autoDrive claimed ' + ad.lufs);
      var derivedErr = isFinite(v.integrated) ? v.integrated - t : Infinity;
      if (Math.abs(derivedErr - ad.error) > 1e-12)
        bad.push(style + '/' + t + ': error field does not equal lufs − target');
      if (ad.reached !== (isFinite(ad.error) && Math.abs(ad.error) <= 0.1))
        bad.push(style + '/' + t + ': reached flag does not match the 0.1 LU rule it documents');
    });
  });
  ok(bad.length === 0, 9 + ' (style, target) pairs: autoDrive\'s claim matches an independent ' +
     'renderOffline call' + (bad.length ? ' — ' + bad.slice(0, 3).join('; ') : ''));

  /* the canon9 fix (2026-08-18): confirm the branch really is desensitised,
     by checking the search is deterministic across repeated calls — the
     same property underworld/calibrate.js's own defence was verified by */
  var st2 = styled('velvet', { lid: -1.0 });
  var a1 = C.autoDrive(st2, matL, matR, FS, -14);
  var a2 = C.autoDrive(st2, matL, matR, FS, -14);
  ok(a1.drive === a2.drive && a1.lufs === a2.lufs,
     'two identical autoDrive calls return bit-identical results (LAW-5 determinism)');
})();

/* ============================================================
   2. autoMargin — when it claims "covered", the lid actually holds.
   Re-render at the returned margin through renderOffline directly and
   measure true peak with the same independent reconstruction the function
   itself uses internally — but called fresh, not through autoMargin's own
   closure, so a bug in what autoMargin REPORTS (as opposed to what it
   measures) cannot hide behind its own bookkeeping.
   ============================================================ */
console.log('\n— autoMargin —');
(function () {
  var n = 48000;
  var matL = C.hostileFullBand ? C.hostileFullBand(21, n) : C.makeNoise(21, n);
  var matR = C.hostileFullBand ? C.hostileFullBand(22, n) : C.makeNoise(22, n);
  for (var i = 0; i < n; i++) { matL[i] = Math.max(-1, Math.min(1, matL[i] * 3.5));
                                 matR[i] = Math.max(-1, Math.min(1, matR[i] * 3.5)); }
  var bad = [], checked = 0;
  ['pine', 'oak', 'lead'].forEach(function (style) {
    var st = styled(style, { lid: -1.0, margin: 0 });
    var am = C.autoMargin(st, matL, matR, FS, 4);
    checked++;
    var p = C.sanitizeState(st);
    p.margin = am.margin;
    var r = C.renderOffline(p, matL, matR, FS);
    var tpL = C.truePeakOf ? C.truePeakOf(r.L, 16, 64) : null;
    var tpR = C.truePeakOf ? C.truePeakOf(r.R, 16, 64) : null;
    if (tpL !== null) {
      var tpDb = C._nd.linToDb(Math.max(tpL, tpR));
      if (am.covered && tpDb > am.lid + 1e-6)
        bad.push(style + ': claimed covered at margin ' + am.margin +
                  ' but an independent re-measure reads ' + tpDb.toFixed(4) +
                  ' dBTP against a ' + am.lid + ' dBTP lid');
    }
  });
  ok(bad.length === 0, checked + ' arrangements: autoMargin\'s "covered" claim survives an ' +
     'independent true-peak re-measurement' + (bad.length ? ' — ' + bad.join('; ') : ''));
})();

/* ============================================================
   3. matchReference — the arithmetic is honest, and the suggestion points
   the right direction. Two independent facts, neither of which requires
   trusting matchReference's own internals: subtraction is subtraction, and
   "louder than the reference" must suggest less drive than "quieter".
   ============================================================ */
console.log('\n— matchReference —');
(function () {
  var n = 60000;
  var refL = C.makeNoise(31, n), refR = C.makeNoise(32, n);
  for (var i = 0; i < n; i++) { refL[i] *= 0.5; refR[i] *= 0.5; }

  /* matchReference measures `inL/inR` directly with meterBuffer — it does
     NOT render them through `state` first. So to build "my mix, rendered
     louder/quieter than the reference", the rendering has to happen here,
     before the call, or both cases would just measure the same raw
     material and the test would prove nothing (caught on the first run:
     both suggestions came back 0). `state` still matters for the call —
     it seeds the arrangement autoDrive's suggestion searches within. */
  var quietSrc = C.renderOffline(styled('pine', { drive: -10, lid: -1.0, unity: false }),
                                  refL, refR, FS);
  var loudSrc  = C.renderOffline(styled('pine', { drive: 14, lid: -1.0, unity: false }),
                                  refL, refR, FS);
  var mQuiet = C.matchReference(styled('pine', { lid: -1.0 }), quietSrc.L, quietSrc.R, refL, refR, FS);
  var mLoud  = C.matchReference(styled('pine', { lid: -1.0 }), loudSrc.L, loudSrc.R, refL, refR, FS);

  var bad = [];
  [['quiet', mQuiet], ['loud', mLoud]].forEach(function (pair) {
    var m = pair[1];
    if (m.gap.lufs !== null &&
        Math.abs(m.gap.lufs - (m.mine.lufs - m.reference.lufs)) > 1e-12)
      bad.push(pair[0] + ': gap.lufs does not equal mine.lufs − reference.lufs');
  });
  ok(bad.length === 0, 'gap arithmetic matches a plain subtraction on both sides' +
     (bad.length ? ' — ' + bad.join('; ') : ''));

  /* the quiet mix is playing itself as its own reference at a lower drive,
     so its suggested drive must be HIGHER than the loud mix's suggestion */
  ok(mQuiet.suggest && mLoud.suggest &&
     mQuiet.suggest.drive > mLoud.suggest.drive,
     'the mix rendered quieter than its reference gets a louder suggestion than ' +
     'the one rendered louder (' + (mQuiet.suggest && mQuiet.suggest.drive) + ' vs ' +
     (mLoud.suggest && mLoud.suggest.drive) + ')');

  /* a mix matched against ITSELF at the same settings must read a zero gap */
  var same = styled('iron', { drive: 4, lid: -1.0 });
  var mSame = C.matchReference(same, refL, refR, refL, refR, FS);
  ok(Math.abs(mSame.gap.lufs) < 1e-9 && Math.abs(mSame.gap.truePeak) < 1e-9,
     'a mix matched against an identical copy of itself reads a zero gap');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (!fail) console.log('the advice checks out.');
process.exit(fail ? 1 : 0);
