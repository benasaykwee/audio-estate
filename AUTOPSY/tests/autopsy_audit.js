/* AUTOPSY audits — node tests/autopsy_audit.js
   Cross-cutting checks that live in no other harness:
     round-trips (sanitize idempotence, report files, share URLs),
     forward-compat with v0.1-shaped reports,
     advice verification (Interchange §6.5 — advice must verify itself),
     LAW 4 embed freshness (the embedded shared file IS the shared file),
     derived version agreement,
     motion guards (RIGOR's round 8 found reduced-motion killing the UI). */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var A = require('../autopsy_core.js');

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'autopsy.html'), 'utf8');
var nmFile = fs.readFileSync(path.join(root, '..', 'shared', 'necromath.js'), 'utf8');
var coreFile = fs.readFileSync(path.join(root, 'autopsy_core.js'), 'utf8');
var twin = fs.readFileSync(path.join(root, 'autopsy-juce', 'Source', 'AutopsyCore.h'), 'utf8');
var expectedH = fs.readFileSync(path.join(__dirname, 'parity_expected.h'), 'utf8');

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}

/* UIH, extracted the same way the UI harness does */
var m = html.match(/\/\* UIH-START[\s\S]*?\*\/([\s\S]*?)\/\* UIH-END \*\//);
var sandbox = { Math: Math };
vm.createContext(sandbox);
vm.runInContext(m[1] + '; this._UIH = UIH;', sandbox);
var UIH = sandbox._UIH;

function lcg(seed) {
  var x = (seed >>> 0) || 1;
  return function () { x = (x * 16807) % 2147483647; return x / 2147483647; };
}
function randState(rnd) {
  var s = A.defaultState();
  var nb = 1 + ((rnd() * A.MAX_BANDS) | 0);
  for (var k = 0; k < nb; k++) {
    s.bands[k] = {
      on: rnd() < 0.9,
      type: A.TYPES[(rnd() * A.TYPES.length) | 0],
      freq: 10 * Math.pow(10, rnd() * 3.3),
      gain: rnd() * 60 - 30,
      q: 0.05 * Math.pow(10, rnd() * 2.9),
      slope: A.SLOPES[(rnd() * A.SLOPES.length) | 0],
      place: A.PLACES[(rnd() * A.PLACES.length) | 0],
      dyn: { on: rnd() < 0.5, range: rnd() * 48 - 24, thresh: -rnd() * 60,
             att: 0.1 + rnd() * 499, rel: 1 + rnd() * 1999 }
    };
  }
  s.out.gain = rnd() * 48 - 24;
  s.out.pan = rnd() * 2 - 1;
  return A.sanitizeState(s);
}

/* ---------- sanitize idempotence + file round-trip ---------- */
(function () {
  var rnd = lcg(2718);
  var stable = true, urlStable = true;
  for (var i = 0; i < 50; i++) {
    var s = randState(rnd);
    var once = JSON.stringify(s);
    var twice = JSON.stringify(A.sanitizeState(JSON.parse(once)));
    if (once !== twice) stable = false;
    var dec = UIH.decodeReport(UIH.encodeReport(s));
    if (JSON.stringify(A.sanitizeState(dec)) !== once) urlStable = false;
  }
  ok(stable, '50 random states: save -> load -> save is byte-stable (sanitize is idempotent)');
  ok(urlStable, '50 random states: share-URL round trip is byte-stable');
})();

/* ---------- forward compat: a v0.1-shaped report still opens ---------- */
(function () {
  var old = {
    version: 1,
    bands: [{ on: true, type: 'bell', freq: 750, gain: -4.5, q: 2.2 },
            { on: true, type: 'lowcut', freq: 90, gain: 0, q: 1 }],
    out: { gain: -1.5, pan: 0.2 },
    meta: { name: 'Old Case', note: '' }
  };
  var s = A.sanitizeState(old);
  ok(s.bands[0].freq === 750 && s.bands[0].gain === -4.5 &&
     s.bands[0].slope === 12 && s.bands[0].place === 'st' &&
     s.bands[0].dyn && s.bands[0].dyn.on === false &&
     s.bands[1].type === 'lowcut' && s.out.gain === -1.5,
     'v0.1-shaped report opens: missing slope/place/dyn arrive as defaults, nothing else moves');
})();

/* ---------- advice verification (Interchange §6.5) ----------
   AUTOPSY has exactly one advice function: Compensate, built on
   UIH.avgCurveDb. Advice must verify itself: apply it, re-measure,
   and the residue must be ~0 for ANY state. */
(function () {
  var rnd = lcg(31415);
  var worst = 0;
  for (var i = 0; i < 30; i++) {
    var s = randState(rnd);
    var avg = UIH.avgCurveDb(A.magnitudeAt, s, 48000);
    s.out.gain = Math.min(Math.max(s.out.gain - avg, -24), 24);
    var after = UIH.avgCurveDb(A.magnitudeAt, s, 48000);
    /* clamping can make the target unreachable — only unclamped cases must land at 0 */
    if (s.out.gain > -24 && s.out.gain < 24) worst = Math.max(worst, Math.abs(after));
  }
  ok(worst < 1e-9, 'Compensate verified on 30 random states: post-advice average curve = 0 (worst ' +
     worst.toExponential(2) + ')');
})();

/* ---------- LAW 4: embeds fresh AND ordered ---------- */
(function () {
  function embedded(id) {
    var re = new RegExp('<script type="text\\/plain" id="' + id + '">\\n([\\s\\S]*?)\\n<\\/script>');
    var mm = html.match(re);
    return mm ? mm[1] : null;
  }
  var nmPos = html.indexOf('id="nm-src"');
  var corePos = html.indexOf('id="core-src"');
  ok(nmPos > 0 && corePos > nmPos, 'LAW 4: nm-src precedes core-src by byte position');
  ok(embedded('nm-src') === nmFile, 'embedded necromath is BYTE-IDENTICAL to shared/necromath.js');
  ok(embedded('core-src') === coreFile, 'embedded core is BYTE-IDENTICAL to autopsy_core.js');
})();

/* ---------- versions derive, never restate ---------- */
(function () {
  var twinVer = (twin.match(/VERSION = "([^"]+)"/) || [])[1];
  ok(twinVer === A.VERSION, 'twin version equals core version (' + twinVer + ')');
  ok(expectedH.indexOf('v' + A.VERSION + ' ') !== -1,
     'parity_expected.h was emitted by the CURRENT core version (v' + A.VERSION + ')');
})();

/* ---------- motion guards (RIGOR round 8: reduced-motion killed the UI) ---------- */
(function () {
  var vis = html.match(/addEventListener\('visibilitychange',[\s\S]*?\}\);/);
  ok(!!vis && /ecoPaused\s*=\s*document\.hidden/.test(vis[0]) &&
     !/suspend|\.stop\(|disconnect/.test(vis[0]),
     'visibilitychange only pauses DRAWING — it never touches the audio graph');
  ok(/if \(reduceMotion\) setTimeout\(frame, 100\);/.test(html),
     'reduced-motion keeps the instrument alive at 10 Hz instead of killing it');
  ok(/if \(!ecoPaused\) draw\(\);/.test(html),
     'eco pause gates draw() only; the frame loop itself never stops');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
