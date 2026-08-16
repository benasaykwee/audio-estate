/* CASKET headless UI-logic tests — node tests/casket_ui_test.js
   Extracts the pure UIH helper block from casket.html (between the
   UIH-START / UIH-END markers) and tests it without a DOM.
   Also parses every script block under vm.Script (syntax gate) and
   enforces the embed ORDER, which is load-bearing: ND closes over NM,
   and the core closes over both. */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var C = require('../casket_core.js');

var html = fs.readFileSync(path.join(__dirname, '..', 'casket.html'), 'utf8');
var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
function near(a, b, eps, name) { ok(Math.abs(a - b) <= eps, name); }

/* --- every script block parses; there are exactly four --- */
var blocks = [];
html.replace(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g, function (_m, body) { blocks.push(body); return _m; });
ok(blocks.length === 4, 'exactly four script blocks (nm-src, nd-src, core-src, app)');
ok(/<script type="text\/plain" id="nm-src">/.test(html), 'nm-src embed block present');
ok(/<script type="text\/plain" id="nd-src">/.test(html), 'nd-src embed block present');
ok(/<script type="text\/plain" id="core-src">/.test(html), 'core-src embed block present');
ok(html.indexOf('id="nm-src"') < html.indexOf('id="nd-src"'),
   'necromath embedded BEFORE necrodyn (ND closes over NM)');
ok(html.indexOf('id="nd-src"') < html.indexOf('id="core-src"'),
   'necrodyn embedded BEFORE the core (the core closes over both)');
blocks.forEach(function (b, i) {
  var parsed = true;
  try { new vm.Script(b); } catch (e) { parsed = false; }
  ok(parsed, 'script block ' + i + ' parses');
});

/* --- the embeds are byte-identical to their source files --- */
[['nm-src', '../../shared/necromath.js'],
 ['nd-src', '../../shared/necrodyn.js'],
 ['core-src', '../casket_core.js']].forEach(function (pair) {
  var re = new RegExp('<script type="text\\/plain" id="' + pair[0] + '">\\n([\\s\\S]*?)\\n<\\/script>');
  var m = html.match(re);
  var src = fs.readFileSync(path.join(__dirname, pair[1]), 'utf8');
  ok(!!m && m[1] === src, pair[0] + ' embed is byte-identical to its source file');
});

/* --- no literal closing script tag can have survived --- */
ok(blocks.every(function (b) { return b.indexOf('<' + '/script>') === -1; }),
   'no literal closing script tag inside any block');

/* --- THE BOOT PATH ---
   Compile the three embeds in the page's order, exactly as casket.html and
   the AudioWorklet blob both do, and prove the result renders bit-for-bit
   like the core we require from disk. `module` and `require` are shadowed
   to undefined because that is what a browser and a worklet provide; leave
   them visible and Node's own require leaks in and resolves the core's
   relative paths against the wrong directory. */
(function () {
  function grab(id) {
    var re = new RegExp('<script type="text\\/plain" id="' + id + '">\\n([\\s\\S]*?)\\n<\\/script>');
    return html.match(re)[1];
  }
  var bundle = grab('nm-src') + '\n' + grab('nd-src') + '\n' + grab('core-src');
  var K = null, booted = true;
  try { K = (new Function('module', 'require', bundle + ';return CASKET;'))(undefined, undefined); }
  catch (e) { booted = false; }
  ok(booted && K && K.VERSION === C.VERSION, 'the embedded bundle boots as a browser would');
  if (K) {
    var st = C.defaultState();
    st.lid = -1; st.drive = 12; st.style = 'iron'; st.sat = 70; st.dust = 'shaped';
    var n = 8192, x = C.makeNoise(7, n);
    var a = new Float64Array(n), b = new Float64Array(n), p = new Float64Array(n), q = new Float64Array(n);
    var e1 = K.createEngine(48000); e1.setState(st); e1.process(x, x, a, b);
    var e2 = C.createEngine(48000); e2.setState(st); e2.process(x, x, p, q);
    var same = true;
    for (var i = 0; i < n; i++) if (a[i] !== p[i] || b[i] !== q[i]) same = false;
    ok(same, 'the embedded bundle renders BIT-IDENTICALLY to the core on disk');
  }
})();

/* --- extract UIH --- */
var m2 = html.match(/\/\* UIH-START[\s\S]*?\*\/([\s\S]*?)\/\* UIH-END \*\//);
ok(!!m2, 'UIH markers found');
var UIH = null;
if (m2) {
  var sandbox = { Math: Math, isFinite: isFinite, JSON: JSON,
                  encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
                  Object: Object, Uint8Array: Uint8Array, DataView: DataView,
                  ArrayBuffer: ArrayBuffer };
  vm.createContext(sandbox);
  vm.runInContext(m2[1] + '; this._UIH = UIH;', sandbox);
  UIH = sandbox._UIH;
}
ok(UIH && typeof UIH.dbToY === 'function', 'UIH evaluates headlessly');

if (UIH) {
  var H = 300;

  /* level mapping */
  near(UIH.dbToY(UIH.TOP, H), 0, 1e-9, 'top of the scale is the top edge');
  near(UIH.dbToY(UIH.BOT, H), H, 1e-9, 'bottom of the scale is the bottom edge');
  near(UIH.yToDb(UIH.dbToY(-12, H), H), -12, 1e-9, 'db↔y round trips');
  near(UIH.dbToY(999, H), 0, 1e-9, 'over-range clamps to the top');
  near(UIH.dbToY(-999, H), H, 1e-9, 'under-range clamps to the bottom');

  /* the weight hangs from the top */
  near(UIH.grToPx(0, 100), 0, 1e-9, 'no gain reduction draws no weight');
  near(UIH.grToPx(-UIH.GRMAX, 100), 100, 1e-9, 'full gain reduction fills the band');
  near(UIH.grToPx(-UIH.GRMAX * 2, 100), 100, 1e-9, 'the weight cannot exceed the band');
  near(UIH.grToPx(5, 100), 0, 1e-9, 'a positive gain draws nothing (there is no such thing)');

  /* meter fractions */
  near(UIH.meterFrac(-40, -40, 0), 0, 1e-9, 'meter floor is empty');
  near(UIH.meterFrac(0, -40, 0), 1, 1e-9, 'meter ceiling is full');
  near(UIH.meterFrac(-20, -40, 0), 0.5, 1e-9, 'meter is linear in dB');
  ok(UIH.meterFrac(-Infinity, -40, 0) === 0, 'silence reads empty, not NaN');

  /* lid drag is clamped to the legal range */
  ok(UIH.lidFromY(-500, H) <= 0, 'dragging above the top pins the lid at 0');
  ok(UIH.lidFromY(H * 2, H) >= -20, 'dragging below the bottom pins the lid at −20');

  /* formatting */
  ok(UIH.fmtDb(3) === '+3.0', 'positive dB gets a sign');
  ok(UIH.fmtDb(-3) === '-3.0', 'negative dB keeps its own');
  ok(UIH.fmtDb(-Infinity) === '−∞', 'silence formats as −∞');
  ok(UIH.fmtMs(0.5) === '0.50 ms', 'sub-10 ms shows two decimals');
  ok(UIH.fmtMs(150) === '150 ms', 'over 10 ms shows whole milliseconds');
  ok(UIH.fmtLufs(-14) === '-14.0 LUFS', 'LUFS formatting');

  /* applyStyle is pure */
  var base = C.defaultState();
  var applied = UIH.applyStyle(base, 'lead', C.styleDefaults('lead'));
  ok(applied.seal === true && applied.style === 'lead', 'applyStyle takes the arrangement defaults');
  ok(base.seal !== true || base.style !== 'lead', 'applyStyle does not mutate the original');
  ok(UIH.sealBlurb(true) !== UIH.sealBlurb(false), 'the seal explains itself both ways');
  ok(applied.drive === base.drive, 'applyStyle leaves untouched fields alone');

  /* the history ring */
  var ring = new Float64Array(4), idx = 0;
  [1, 2, 3, 4, 5].forEach(function (v) { idx = UIH.histPush(ring, idx, v); });
  near(UIH.histAt(ring, idx, 0), 5, 1e-12, 'histAt(0) is the newest sample');
  near(UIH.histAt(ring, idx, 1), 4, 1e-12, 'histAt(1) is one older');
  near(UIH.histAt(ring, idx, 3), 2, 1e-12, 'the ring wraps without losing order');

  /* arrangement URL round trip, through the sanitiser */
  var st = C.defaultState();
  st.style = 'oak'; st.lid = -2.5; st.lining = 8; st.sat = 40;
  var back = C.sanitizeState(UIH.decodeArrangement(UIH.encodeArrangement(st)));
  ok(back.style === 'oak' && back.lid === -2.5 && back.lining === 8 && back.sat === 40,
     'arrangement survives the URL round trip');
  ok(UIH.decodeArrangement('%%%not json') === null, 'a mangled hash decodes to null, not a throw');

  /* every factory arrangement must survive the sanitiser unchanged */
  var allGood = true, names = {};
  UIH.FACTORY.forEach(function (f) {
    var s = C.sanitizeState(f);
    if (s.style !== f.style) allGood = false;
    if (Math.abs(s.lid - f.lid) > 1e-9) allGood = false;
    if (s.lining !== f.lining) allGood = false;
    if (Math.abs(s.vigil - f.vigil) > 1e-9) allGood = false;
    if (Math.abs(s.margin - f.margin) > 1e-9) allGood = false;
    if (names[f.name]) allGood = false;
    names[f.name] = 1;
  });
  ok(allGood, 'all ' + UIH.FACTORY.length + ' factory arrangements survive sanitize with unique names');
  ok(UIH.FACTORY.every(function (f) { return f.note && f.note.length > 10; }),
     'every factory arrangement explains itself');
  ok(C.STYLES.every(function (s) { return UIH.styleName(s) && UIH.styleBlurb(s); }),
     'every arrangement has a display name and a blurb');

  /* ---- the WAV writer ----
     A wrong header opens silently in some editors and as noise in others,
     so every field is checked against the RIFF spec by hand. */
  (function () {
    var nFrames = 1000, nCh = 2, rate = 48000, bits = 24;
    var h = UIH.wavHeader(nFrames, nCh, rate, bits);
    var dv = new DataView(h.buffer);
    function tag(o) { return String.fromCharCode(h[o], h[o + 1], h[o + 2], h[o + 3]); }
    var dataLen = nFrames * nCh * (bits / 8);
    ok(h.length === 44, 'WAV header is 44 bytes');
    ok(tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(12) === 'fmt ' && tag(36) === 'data',
       'RIFF / WAVE / fmt / data tags in place');
    ok(dv.getUint32(4, true) === 36 + dataLen, 'RIFF chunk size counts the payload');
    ok(dv.getUint32(16, true) === 16 && dv.getUint16(20, true) === 1, 'PCM, 16-byte fmt chunk');
    ok(dv.getUint16(22, true) === 2, 'channel count');
    ok(dv.getUint32(24, true) === 48000, 'sample rate');
    ok(dv.getUint32(28, true) === 48000 * 2 * 3, 'byte rate = rate × channels × bytes');
    ok(dv.getUint16(32, true) === 6, 'block align = channels × bytes');
    ok(dv.getUint16(34, true) === 24, 'bit depth');
    ok(dv.getUint32(40, true) === dataLen, 'data chunk size');
    var h16 = new DataView(UIH.wavHeader(10, 1, 44100, 16).buffer);
    ok(h16.getUint32(28, true) === 44100 * 2 && h16.getUint16(32, true) === 2,
       'mono 16-bit at 44.1k computes its own rates');

    /* the quantiser: symmetric, saturating, never wrapping */
    ok(UIH.pcmClamp(0, 24) === 0, 'silence quantises to zero');
    ok(UIH.pcmClamp(1, 24) === 8388607, 'full scale saturates at +2^23−1, it does not wrap');
    ok(UIH.pcmClamp(-1, 24) === -8388608, 'negative full scale reaches the floor');
    ok(UIH.pcmClamp(99, 24) === 8388607, 'over-range clips rather than wrapping');
    ok(UIH.pcmClamp(-99, 24) === -8388608, 'under-range clips too');
    ok(UIH.pcmClamp(0.5, 16) === 16384, '16-bit half scale');
    var mono = true;
    for (var v = -1; v <= 1; v += 0.013) {
      var a = UIH.pcmClamp(v, 24), b = UIH.pcmClamp(v + 0.0005, 24);
      if (b < a) mono = false;
    }
    ok(mono, 'the quantiser is monotonic across the whole range');
  })();
}

/* ---------- THE REACHABILITY LINT ----------
   Three rounds running, this project has shipped engine features that
   nothing with a screen could reach: share-as-URL had no button, mid/side
   had a control that was never read, and batch, album, gapless and rate
   conversion all landed with no way in at all. Every one of them passed
   its harness, because a harness calls the core directly and never asks
   whether a person could.

   So: every control declared in the markup must be referenced by the
   script, and every control the script reaches for must exist in the
   markup. The first direction catches a dead button. The second catches
   a rename that turned a live one into a silent no-op — which is worse,
   because the control is still sitting there looking clickable. */
console.log('\n— reachability: no control without a wire, no wire without a control —');
(function () {
  var declared = [], m;
  var idRe = /<(?:button|input|select|textarea)\b[^>]*\bid="([A-Za-z0-9_]+)"/g;
  while ((m = idRe.exec(html)) !== null) declared.push(m[1]);

  /* the script half of the file — everything after the last embed block */
  var scriptStart = html.lastIndexOf('</script>');
  var body = html;

  var unreachable = declared.filter(function (id) {
    var uses = body.split("el('" + id + "')").length - 1
             + body.split('getElementById("' + id + '")').length - 1
             + body.split("getElementById('" + id + "')").length - 1;
    return uses === 0;
  });
  ok(unreachable.length === 0,
     'every declared control is referenced by the script' +
     (unreachable.length ? '  << orphaned: ' + unreachable.join(', ') : ''));

  var reached = [], m2;
  var useRe = /el\('([A-Za-z0-9_]+)'\)/g;
  while ((m2 = useRe.exec(body)) !== null) if (reached.indexOf(m2[1]) < 0) reached.push(m2[1]);
  var missing = reached.filter(function (id) {
    return !new RegExp('id="' + id + '"').test(html);
  });
  ok(missing.length === 0,
     'every control the script reaches for exists in the markup' +
     (missing.length ? '  << phantom: ' + missing.join(', ') : ''));

  /* and the specific ones this round added, named so a future rename
     cannot quietly delete the feature */
  ['albumBtn', 'gaplessChk'].forEach(function (id) {
    ok(new RegExp('id="' + id + '"').test(html) && body.indexOf("el('" + id + "')") >= 0,
       id + ' is both declared and wired');
  });
  ok(/CASKET\.albumMaster\(/.test(body), 'the browser actually calls albumMaster');
  ok(/CASKET\.albumReport\(/.test(body), 'and albumReport, so the record comes with its table');
  ok(/CASKET\.conformToRate\(/.test(body),
     'and conformToRate, so a record of mixed sample rates becomes one record');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
