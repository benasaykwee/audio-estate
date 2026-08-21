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
/* this harness reading itself — the UIH census below asks "does this file
   name each member?", which requires the file's own text */
var self_ = fs.readFileSync(__filename, 'utf8');
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

/* --- extract UIH ---
   evalUIH is reusable on purpose: the bites-proof below rebuilds UIH from a
   deliberately mutated copy of the same source, and the two must go through
   the same construction or the comparison proves nothing. */
var m2 = html.match(/\/\* UIH-START[\s\S]*?\*\/([\s\S]*?)\/\* UIH-END \*\//);
ok(!!m2, 'UIH markers found');
var uihSrc = m2 ? m2[1] : '';
function evalUIH(src) {
  var sandbox = { Math: Math, isFinite: isFinite, JSON: JSON,
                  encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
                  Object: Object, Uint8Array: Uint8Array, DataView: DataView,
                  ArrayBuffer: ArrayBuffer };
  vm.createContext(sandbox);
  vm.runInContext(src + '; this._UIH = UIH;', sandbox);
  return sandbox._UIH;
}
var UIH = m2 ? evalUIH(uihSrc) : null;
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

  /* THE RANGE's gate classification. The interesting assertion is the third
     one: a bin sitting EXACTLY on the gate must read as excluded, because
     that is what the core does (`shortTermStats()` skips bins whose centre
     is <= gate). Get this wrong by one comparison operator and the chart
     colours a bin as counted while the LRA number beside it has already
     thrown that bin away — a disagreement between a picture and a figure,
     in the single case least likely to be noticed by eye. LAW 5. */
  ok(UIH.histBinKept(-20, -30) === true, 'a bin above the gate is kept');
  ok(UIH.histBinKept(-40, -30) === false, 'a bin below the gate is gated out');
  ok(UIH.histBinKept(-30, -30) === false,
     'a bin exactly ON the gate is EXCLUDED — matches the core, which skips centre <= gate');
  ok(UIH.histBinKept(-20, -Infinity) === true, 'with no gate yet, everything counts');
  ok(UIH.histBinKept(-20, NaN) === true, 'a non-finite gate does not swallow the whole chart');

  /* THE README'S ARRANGEMENT TABLE, AGAINST THE ACTUAL DEFAULTS — added
     2026-08-18, because it was wrong. The table published Lead at 16×
     lining for as long as it has existed; the code has always shipped 4×,
     for the reason the doc itself gives elsewhere (sealed, the lining is
     the processing rate too, and detection is already exact at 4×).
     Nothing compared the two, so a reader following the table would have
     picked a setting the program does not use and been told it was the
     default. Prose about a number is not a gate on that number. */
  var readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  var tableRows = readme.match(/^\| \*\*(Pine|Velvet|Oak|Iron|Lead)\*\*.*$/gm) || [];
  ok(tableRows.length === 5, 'the README arrangement table has all five rows (' + tableRows.length + ')');
  var tableWrong = [];
  function tableMismatches(rows) {
    var wrong = [];
    rows.forEach(function (row) {
      var name = (row.match(/\*\*(\w+)\*\*/) || [])[1].toLowerCase();
      var d = C.styleDefaults(name);
      var lining = (row.match(/(\d+)×\s*\|?\s*$/) || [])[1];
      var vigil = (row.match(/\|\s*([\d.]+) ms\s*\|/) || [])[1];
      if (+lining !== d.lining) wrong.push(name + ' lining says ' + lining + '× but is ' + d.lining + '×');
      if (+vigil !== d.vigil) wrong.push(name + ' vigil says ' + vigil + ' but is ' + d.vigil);
    });
    return wrong;
  }
  var tableWrong = tableMismatches(tableRows);
  ok(tableWrong.length === 0,
     'every README arrangement row matches styleDefaults()' +
     (tableWrong.length ? ' — WRONG: ' + tableWrong.join('; ') : ''));

  /* THE GATES MUST BITE — the PALLBEARER pattern ("both law gates are
     proved to bite by feeding them a deliberately broken sample"), applied
     to the two gates this file gained on 2026-08-18. A gate proved only by
     passing is indistinguishable from a gate that checks nothing; each of
     these hands its gate the EXACT bug it was written for and asserts the
     gate goes red. Both bugs are real history, not hypotheticals: the 16×
     row shipped, and the >= confusion is precisely what the core's
     `<= gate` exclusion makes tempting. */
  var doctoredRows = tableRows.map(function (r) {
    return /\*\*Lead\*\*/.test(r) ? r.replace(/4×(\s*\|?\s*)$/, '16×$1') : r;
  });
  var caughtTable = tableMismatches(doctoredRows);
  ok(caughtTable.length === 1 && /lead lining says 16/.test(caughtTable[0]),
     'the table gate BITES: fed the exact 16× error that shipped, it reports it (' +
     (caughtTable[0] || 'missed it') + ')');

  /* the vocabulary must name all three panes, and the help overlay must
     explain them — either one going quiet undoes 2026-08-18's fix that
     gave THE RANGE any prose at all */
  ok(/\| Loudness-distribution chart \| \*\*THE RANGE\*\* \|/.test(readme),
     'the README vocabulary table names THE RANGE alongside the viewing and the plot');

  /* the ARCHITECTURE doc's arrangement table carried the same 16× error as
     the README's, in a document that explains the correct value eight
     paragraphs earlier. Same gate, second document. Its table is columnar
     (one row of lining defaults, Pine→Lead), so parse that row. */
  var arch = fs.readFileSync(path.join(__dirname, '..', '..', 'CASKET_ARCHITECTURE.md'), 'utf8');
  var liningRow = arch.match(/^\| Lining default \|(.+)$/m);
  ok(!!liningRow, 'the architecture doc still has its lining-default row');
  if (liningRow) {
    var vals = liningRow[1].split('|').map(function (s) {
      return +(s.replace(/[^\d]/g, ''));
    }).filter(function (n) { return n > 0; });
    var expect = C.STYLES.map(function (s) { return C.styleDefaults(s).lining; });
    ok(vals.length === 5 && vals.join(',') === expect.join(','),
       'the architecture doc\'s five lining defaults match styleDefaults() (' +
       vals.join('/') + ' vs ' + expect.join('/') + ')');
  }
  var overlay = (html.match(/id="helpOverlay"[\s\S]*?<\/div>\s*<\/div>/) || [''])[0];
  ['the viewing', 'the plot', 'the range'].forEach(function (pane) {
    ok(overlay.indexOf(pane) >= 0, 'the help overlay explains ' + pane);
  });

  /* the boundary gate: rebuild UIH from source with > flipped to >=, and
     assert the boundary assertion above would have failed against it */
  (function () {
    var mutSrc = uihSrc.replace('return loudness > gate;', 'return loudness >= gate;');
    ok(mutSrc !== uihSrc, 'the histBinKept mutation target still exists in UIH');
    var mutUIH = evalUIH(mutSrc);
    ok(mutUIH.histBinKept(-30, -30) === true && UIH.histBinKept(-30, -30) === false,
       'the boundary gate BITES: >= keeps the on-gate bin, > excludes it — the assertion separates them');
  })();

  /* THE UIH CENSUS — added 2026-08-19, and smaller than expected, which is
     itself the finding: 23 of 25 members were already exercised by name.
     The two that were not are `HIST` (a ring-buffer length, exercised
     through histPush rather than named) and `fmtPct`. Both get a home
     below: fmtPct gets an actual assertion, HIST an exemption with its
     reason. The census exists so the NEXT helper cannot arrive unwatched —
     which is the same argument the engine-surface census makes, and the
     same one that turned out to matter when histogramS landed. */
  ok(UIH.fmtPct(0) === '0 %' && UIH.fmtPct(49.6) === '50 %' && UIH.fmtPct(100) === '100 %',
     'fmtPct rounds and spaces the way the rack expects');
  var UIH_EXEMPT = {
    HIST: 'a ring length, not behaviour — exercised through histPush/histAt above, ' +
          'and asserting the constant equals itself would prove nothing'
  };
  var uihGaps = Object.keys(UIH).filter(function (k) {
    if (UIH_EXEMPT[k]) return false;
    /* `self` here is this very file: a member is watched if this harness
       names it anywhere, which is exactly what the census asks */
    return self_.indexOf('UIH.' + k) < 0;
  });
  ok(uihGaps.length === 0,
     'every UIH member is either exercised here or exempt with a reason' +
     (uihGaps.length ? ' — UNWATCHED: ' + uihGaps.join(', ') : ''));

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

  /* Every factory arrangement must survive the sanitiser unchanged — and
     this checks EVERY field the preset literal actually names, not a
     hand-picked subset. A fixed field list here once missed `seal`
     entirely, which is exactly how "Sealed for Delivery" — styled lead,
     named and noted as the sealed/plant-ready arrangement — shipped
     without ever setting `seal: true`. sanitizeState() defaults a missing
     boolean to false, so the preset silently handed back an UNSEALED
     arrangement wearing a sealed one's name. Caught by reading the FACTORY
     literal directly rather than trusting this test's own field list;
     fixed in both places, and this loop is now field-agnostic so a future
     preset field can't fall through the same gap. */
  var allGood = true, names = {}, badField = null;
  var SKIP = { name: 1, note: 1 }; // descriptive only, not sanitised state
  UIH.FACTORY.forEach(function (f) {
    var s = C.sanitizeState(f);
    for (var k in f) {
      if (SKIP[k]) continue;
      var same = typeof f[k] === 'number' ? Math.abs(s[k] - f[k]) < 1e-9 : s[k] === f[k];
      if (!same) { allGood = false; badField = f.name + '.' + k; }
    }
    if (names[f.name]) allGood = false;
    names[f.name] = 1;
  });
  ok(allGood, 'all ' + UIH.FACTORY.length + ' factory arrangements survive sanitize with unique names' +
     (badField ? ' (first mismatch: ' + badField + ')' : ''));
  /* The field-diff loop above only checks fields a preset BOTHERS to name —
     it cannot catch one that never mentions `seal` at all, which is
     precisely how the bug above hid. This checks the intent directly: a
     lead-styled preset that omits `seal` is not a preset with a default,
     it is a lead arrangement quietly unsealed. */
  ok(UIH.FACTORY.filter(function (f) { return f.style === 'lead'; })
       .every(function (f) { return f.seal === true; }),
     'every lead-styled factory preset explicitly seals — lead\'s defining trait cannot be an unstated default');
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
  /* CANVAS COUNTS AS A CONTROL — added 2026-08-18. The element list was
     button|input|select|textarea, so all three canvases (the viewing, the
     plot, and THE RANGE) sat outside this check entirely. The viewing is
     not merely a display: it is drag-to-set-the-lid, the most-used control
     in the program, and it was as unreachable-by-this-test as a button
     with no handler. Found when THE RANGE landed and the reachability
     section stayed at the same count — a new element that changes no test
     number is a new element nothing is looking at. */
  var idRe = /<(?:button|input|select|textarea|canvas)\b[^>]*\bid="([A-Za-z0-9_]+)"/g;
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
  ['albumBtn', 'gaplessChk', 'histogram'].forEach(function (id) {
    ok(new RegExp('id="' + id + '"').test(html) && body.indexOf("el('" + id + "')") >= 0,
       id + ' is both declared and wired');
  });
  /* THE RANGE's own chain, end to end: the engine can produce the data,
     the worklet forwards it, and the browser draws it. Any one of those
     three missing leaves a canvas that is present, sized, and permanently
     blank — which looks like a rendering bug rather than a missing wire. */
  ok(/histogramS\s*:/.test(fs.readFileSync(path.join(__dirname, '..', 'casket_core.js'), 'utf8')),
     'the core exposes histogramS()');
  ok(/\.histogramS\(\)/.test(body), 'and the browser actually calls it');
  ok(/function drawHistogram/.test(body), 'and there is a drawHistogram to receive it');
  ok(/CASKET\.albumMaster\(/.test(body), 'the browser actually calls albumMaster');
  ok(/CASKET\.albumReport\(/.test(body), 'and albumReport, so the record comes with its table');
  ok(/CASKET\.conformToRate\(/.test(body),
     'and conformToRate, so a record of mixed sample rates becomes one record');

  /* THE UI'S GATE RULE AGAINST THE CORE'S, ON REAL DATA. The unit tests
     earlier pin histBinKept's own behaviour; this checks that behaviour is
     the SAME ONE the core used when it produced the number. Two levels far
     enough apart that the quiet one is gated out, then: every bin the chart
     would colour as kept must sit above the gate the core reported, and the
     percentile markers the core computed must both land inside that kept
     region — otherwise the gold lines would be drawn over greyed-out bars. */
  var FSx = 48000, seg = FSx * 5;
  var stx = C.defaultState(); stx.bypass = true;
  var eng = C.createEngine(FSx); eng.setState(stx);
  [[-20, seg], [-70, seg]].forEach(function (p) {
    var x = C.makeSine(1000, FSx, p[1], Math.pow(10, p[0] / 20));
    var o1 = new Float64Array(x.length), o2 = new Float64Array(x.length);
    eng.process(x, x, o1, o2);
  });
  var hh = eng.histogramS();
  ok(hh.bins.length > 0 && isFinite(hh.gate), 'the probe produced a real histogram and a real gate');
  var keptBins = hh.bins.filter(function (b) { return UIH.histBinKept(b.loudness, hh.gate); });
  ok(keptBins.length > 0 && keptBins.length < hh.bins.length,
     'the gate splits this material — some bins kept, some excluded (' +
     keptBins.length + ' of ' + hh.bins.length + ')');
  ok(keptBins.every(function (b) { return b.loudness > hh.gate; }),
     'every bin the chart keeps is above the gate the core reported');
  ok(UIH.histBinKept(hh.p10, hh.gate) && UIH.histBinKept(hh.p95, hh.gate),
     'both percentile markers land inside the kept region, not over greyed bars');

  /* LAW 5 SWEEP. The hand-picked boundary values earlier prove today's
     implementation; this sweeps a lattice of loudness values around the
     REAL, engine-computed gate — half-bin steps, both sides, and the gate
     itself — and pins the classification to `v > gate` at every point. The
     implementation is one comparison today, so this cannot fail today; it
     exists for the reimplementation that adds an epsilon, a rounding, or a
     >= "for safety" and moves the boundary by one bin. The boundary is
     where every bug in this suite has lived; sweep it on purpose. */
  var sweepBad = [];
  for (var k = -6; k <= 6; k++) {
    var v = hh.gate + k * 0.05;                 /* half the 0.1 LU bin width */
    if (UIH.histBinKept(v, hh.gate) !== (v > hh.gate)) sweepBad.push(k);
  }
  if (UIH.histBinKept(hh.gate, hh.gate) !== false) sweepBad.push('exact');
  ok(sweepBad.length === 0,
     'LAW 5 sweep: 13 half-bin steps across the real gate all classify as (v > gate)' +
     (sweepBad.length ? ' — WRONG at ' + sweepBad.join(', ') : ''));

  /* THE ONCE-A-SECOND THROTTLE, both audio paths. Static, and honest about
     it: the worklet body is a template string the browser compiles, so
     nothing here can execute it. What IS checkable is that both paths
     throttle at all and that both key off sampleRate rather than a literal
     — the bug worth catching is a hardcoded `>= 48000`, which would
     silently change meaning with the session rate. */
  ok(/this\.histCount\s*\+=/.test(body) && /this\.histCount\s*>=\s*sampleRate/.test(body),
     'the worklet path throttles the histogram, keyed to sampleRate');
  ok(/spHistCount\s*\+=/.test(body) && /spHistCount\s*>=\s*ctx\.sampleRate/.test(body),
     'and the script-processor fallback throttles it the same way');
  ok(!/histCount\s*>=\s*\d/.test(body),
     'neither throttle compares against a hardcoded sample count');
  /* the accumulate-and-reset arithmetic, at block sizes a host actually uses */
  [128, 512, 1024, 4096].forEach(function (blk) {
    var count = 0, fires = 0;
    for (var i = 0; i < FSx * 3 / blk; i++) {
      count += blk;
      if (count >= FSx) { fires++; count = 0; }
    }
    ok(fires === 3, 'accumulate-and-reset fires 3x over 3 s at block ' + blk + ' (' + fires + ')');
  });
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
