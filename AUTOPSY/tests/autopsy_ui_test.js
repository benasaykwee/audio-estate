/* AUTOPSY headless UI-logic tests — node tests/autopsy_ui_test.js
   Extracts the pure UIH helper block from autopsy.html (between
   UIH-START / UIH-END markers) and tests it without a DOM.
   Also parses both script blocks under vm.Script (syntax gate). */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var html = fs.readFileSync(path.join(__dirname, '..', 'autopsy.html'), 'utf8');
var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
function near(a, b, eps, name) { ok(Math.abs(a - b) <= eps, name); }

/* --- every script block parses ---
   Three since the necromath extraction: #nm-src, #core-src, and the app.
   The count is asserted so a stray or duplicated block can't sneak in. */
var blocks = [];
html.replace(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g, function (_m, body) { blocks.push(body); return _m; });
ok(blocks.length === 3, 'exactly three script blocks (nm-src, core-src, app)');
ok(/<script type="text\/plain" id="nm-src">/.test(html), 'nm-src embed block present');
ok(html.indexOf('id="nm-src"') < html.indexOf('id="core-src"'),
   'necromath embedded BEFORE the core (the core closes over NM)');
blocks.forEach(function (b, i) {
  var parsed = true;
  try { new vm.Script(b); } catch (e) { parsed = false; }
  ok(parsed, 'script block ' + i + ' parses');
});

/* --- extract UIH --- */
var m = html.match(/\/\* UIH-START[\s\S]*?\*\/([\s\S]*?)\/\* UIH-END \*\//);
ok(!!m, 'UIH markers found');
var UIH = null;
if (m) {
  var sandbox = { Math: Math };
  vm.createContext(sandbox);
  vm.runInContext(m[1] + '; this._UIH = UIH;', sandbox);
  UIH = sandbox._UIH;
}
ok(UIH && typeof UIH.freqToX === 'function', 'UIH evaluates headlessly');

if (UIH) {
  var W = 800, H = 400;

  /* mapping round-trips and anchors */
  near(UIH.xToFreq(UIH.freqToX(1000, W), W), 1000, 0.01, 'freq↔x round trip @1k');
  near(UIH.xToFreq(UIH.freqToX(55, W), W), 55, 0.01, 'freq↔x round trip @55');
  near(UIH.freqToX(20, W), 0, 1e-9, 'x(20Hz)=left edge');
  near(UIH.freqToX(20000, W), W, 1e-9, 'x(20kHz)=right edge');
  near(UIH.dbToY(0, H), H / 2, 1e-9, '0 dB = midline');
  near(UIH.yToDb(UIH.dbToY(6, H), H), 6, 1e-9, 'db↔y round trip');
  near(UIH.yToDb(0, H), UIH.DB, 1e-9, 'top edge = +DB');

  /* Q wheel */
  ok(UIH.qFromWheel(1, -100) > 1, 'wheel up raises Q');
  ok(UIH.qFromWheel(1, 100) < 1, 'wheel down lowers Q');
  ok(UIH.qFromWheel(39.9, -100) <= 40, 'Q ceiling 40');
  ok(UIH.qFromWheel(0.051, 100) >= 0.05, 'Q floor 0.05');

  /* handle position: gainless types ride the 0 dB line */
  var bell = { on: true, type: 'bell', freq: 1000, gain: 12, q: 1 };
  var cut = { on: true, type: 'lowcut', freq: 100, gain: 0, q: 1 };
  ok(UIH.handlePos(bell, W, H).y < H / 2, 'bell handle follows gain');
  near(UIH.handlePos(cut, W, H).y, H / 2, 1e-9, 'cut handle rides midline');

  /* hit testing */
  var bands = [bell, cut, { on: false, type: 'bell', freq: 5000, gain: 6, q: 1 }];
  var p = UIH.handlePos(bell, W, H);
  ok(UIH.hitTest(bands, p.x + 3, p.y - 3, W, H) === 0, 'hitTest finds nearby handle');
  ok(UIH.hitTest(bands, p.x + 200, p.y, W, H) !== 0, 'hitTest ignores far click');
  var pOff = UIH.handlePos(bands[2], W, H);
  ok(UIH.hitTest(bands, pOff.x, pOff.y, W, H) !== 2, 'disabled band is unhittable');

  /* formatting */
  ok(UIH.fmtFreq(500) === '500 Hz', 'fmtFreq 500');
  ok(UIH.fmtFreq(1500) === '1.50 kHz', 'fmtFreq 1.5k');
  ok(UIH.fmtFreq(12000) === '12.0 kHz', 'fmtFreq 12k');
  ok(UIH.fmtDb(3) === '+3.0 dB', 'fmtDb positive sign');
  ok(UIH.fmtDb(-4.25) === '-4.2 dB' || UIH.fmtDb(-4.25) === '-4.3 dB', 'fmtDb negative');
  ok(UIH.fmtPan(0) === 'C', 'fmtPan center');
  ok(UIH.fmtPan(-0.5) === '50 L', 'fmtPan left');
  ok(UIH.fmtPan(1) === '100 R', 'fmtPan right');

  /* slots */
  var all = [];
  for (var i = 0; i < 12; i++) all.push({ on: true });
  ok(UIH.firstFreeSlot(all) === -1, 'no thirteenth incision');
  all[7] = { on: false };
  ok(UIH.firstFreeSlot(all) === 7, 'finds the free slot');

  /* solo derivation */
  var st = {
    version: 1,
    bands: [
      { on: true, type: 'bell', freq: 100, gain: 3, q: 1, slope: 12, place: 'st' },
      { on: true, type: 'notch', freq: 900, gain: 0, q: 4, slope: 12, place: 'st' },
      { on: false, type: 'bell', freq: 5000, gain: 6, q: 1, slope: 12, place: 'st' }
    ],
    out: { gain: -2, pan: 0.5 },
    meta: { name: 'x', note: '' }
  };
  var solo = UIH.soloState(st, 1);
  ok(solo.bands[1].on === true, 'soloState keeps the soloed band');
  ok(solo.bands[0].on === false, 'soloState mutes the others');
  ok(st.bands[0].on === true, 'soloState never mutates the original');
  ok(solo.out.gain === -2 && solo.out.pan === 0.5, 'soloState preserves output section');
  ok(solo.bands[1].q === 4 && solo.bands[1].type === 'notch', 'soloState copies band params intact');
  var soloOff = UIH.soloState(st, 2);
  ok(soloOff.bands[2].on === false, 'soloing a disabled band stays silent, not resurrective');

  /* gainless handle logic */
  ok(UIH.hasGain('tilt'), 'tilt drags gain');
  ok(!UIH.hasGain('bandpass'), 'bandpass is gainless');
  var bp = { on: true, type: 'bandpass', freq: 1000, gain: 12, q: 2 };
  near(UIH.handlePos(bp, W, H).y, H / 2, 1e-9, 'bandpass handle rides the midline');

  /* share-link round trip */
  var enc = UIH.encodeReport(st);
  var dec = UIH.decodeReport(enc);
  ok(dec && dec.bands.length === 3 && dec.bands[1].q === 4, 'report survives the URL round trip');
  ok(UIH.decodeReport('%%%not-json%%%') === null, 'garbage hash decodes to null, not a crash');

  /* dynState applies live offsets without mutating */
  var grs = [0, -4.5, 0];
  var dstate = UIH.dynState(st, grs);
  ok(dstate.bands[1].gain === st.bands[1].gain - 4.5, 'dynState offsets gain by gr');
  ok(dstate.bands[0].gain === st.bands[0].gain, 'dynState leaves zero-gr bands alone');
  ok(st.bands[1].gain === 0, 'dynState never mutates the original');

  /* gain tools */
  var gt = {
    version: 1,
    bands: [
      { on: true, type: 'bell', freq: 100, gain: 6, q: 1, slope: 12, place: 'st',
        dyn: { on: true, range: -6, thresh: -30, att: 10, rel: 150 } },
      { on: true, type: 'lowcut', freq: 50, gain: 0, q: 1, slope: 24, place: 'st',
        dyn: { on: false, range: 0, thresh: -30, att: 10, rel: 150 } },
      { on: true, type: 'tilt', freq: 800, gain: -4, q: 0.71, slope: 12, place: 'st',
        dyn: { on: false, range: 0, thresh: -30, att: 10, rel: 150 } }
    ],
    out: { gain: 2, pan: 0 }, meta: { name: 'x', note: '' }
  };
  var half = UIH.scaleGains(gt, 0.5);
  ok(half.bands[0].gain === 3 && half.bands[2].gain === -2, 'scaleGains halves gain types');
  ok(half.bands[1].gain === 0 && half.bands[1].slope === 24, 'scaleGains leaves cuts alone');
  ok(half.bands[0].dyn && half.bands[0].dyn.range === -6, 'scaleGains carries dyn through');
  ok(gt.bands[0].gain === 6, 'scaleGains never mutates');
  var inv = UIH.invertGains(gt);
  ok(inv.bands[0].gain === -6 && inv.bands[2].gain === 4, 'invertGains mirrors');
  var flat = UIH.scaleGains(gt, 0);
  ok(flat.bands[0].gain === 0 && flat.bands[2].gain === 0, 'scale 0 flattens');

  /* avgCurveDb: flat state with output gain g averages exactly g */
  var flatMag = function (s2, fs, f) { return s2.out.gain; };
  near(UIH.avgCurveDb(flatMag, { out: { gain: 3 } }, 48000), 3, 1e-12, 'avgCurveDb of flat curve = out gain');

  /* soloState carries dyn */
  var stDyn = UIH.soloState(gt, 0);
  ok(stDyn.bands[0].dyn && stDyn.bands[0].dyn.on === true, 'soloState carries dyn through');

  /* peak-hold */
  ok(UIH.holdStep(-90, -40, 0.25) === -40, 'holdStep rises instantly');
  ok(UIH.holdStep(-40, -90, 0.25) === -40.25, 'holdStep falls by the decay');
  ok(UIH.holdStep(-200, -300, 0.25) === -200, 'holdStep floors at -200');

  /* band menu model */
  var cutBand = { type: 'lowcut', slope: 24, place: 'st' };
  var menu = UIH.bandMenu(cutBand, 0, false);
  ok(menu.some(function (it) { return it.act === 'slope' && it.val === 24 && it.checked; }),
     'cut band menu offers slopes, current one checked');
  ok(menu.filter(function (it) { return it.act === 'slope'; }).length === 6,
     'cut band menu offers all six slopes');
  var bellBand = { type: 'bell', slope: 12, place: 'm' };
  var menu2 = UIH.bandMenu(bellBand, 1, true);
  ok(!menu2.some(function (it) { return it.act === 'slope'; }),
     'bell band menu has no slope rows');
  ok(menu2.some(function (it) { return it.act === 'place' && it.val === 'm' && it.checked; }),
     'placement rows mark the current placement');
  ok(menu2[0].act === 'solo' && /lift/.test(menu2[0].label),
     'soloed band menu offers to lift the solo');
  ok(menu2.some(function (it) { return it.act === 'type' && it.val === 'bell' && it.checked; }),
     'current type is checked');

  /* factory reports validate against the actual core */
  var CORE = require('../autopsy_core.js');
  var allValid = true, allFit = true;
  UIH.FACTORY.forEach(function (fp) {
    if (fp.bands.length > CORE.MAX_BANDS) allFit = false;
    var s2 = CORE.defaultState();
    fp.bands.forEach(function (b, k) { s2.bands[k] = b; });
    var clean = CORE.sanitizeState(s2);
    fp.bands.forEach(function (b, k) {
      if (clean.bands[k].type !== b.type || clean.bands[k].freq !== b.freq ||
          clean.bands[k].slope !== b.slope || clean.bands[k].place !== b.place) allValid = false;
    });
  });
  ok(allFit, 'every factory report fits the slab');
  ok(allValid, 'every factory report survives sanitize unchanged (' + UIH.FACTORY.length + ' reports)');
}

/* --- forbidden literal check (the NECROPHONE scar) --- */
var scripts = blocks.join('');
ok(scripts.indexOf('<' + '/script>') === -1, 'no literal closing script tag inside scripts');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
