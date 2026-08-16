/* RIGOR regression — byte-stable render baselines.
   node tests/rigor_regression.js          → compare against baseline
   node tests/rigor_regression.js --write  → (re)write baseline
   Hash = FNV-1a over %.17g of every output sample, so ANY numeric drift
   in the core — or in shared/necromath.js, or shared/necrodyn.js — fails
   the gate. See ../AUDIO_INTERCHANGE.md §4. */
'use strict';
var fs = require('fs');
var path = require('path');
var R = require('../rigor_core.js');

var BASE = path.join(__dirname, 'rigor_regression_baseline.json');
var FS = 48000, N = 48000;

function fnv1a(str) {
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

/* a demanding, deterministic source: noise with a loud burst in the
   middle, so attack, hold and release all get exercised in one render */
function source(seed) {
  var a = R.makeNoise(seed, N);
  for (var i = 0; i < N; i++) {
    var env = (i > N * 0.35 && i < N * 0.55) ? 0.95 : 0.12;
    a[i] *= env;
  }
  return a;
}

function styled(name, patch) {
  var s = R.defaultState(), d = R.styleDefaults(name);
  for (var k in d) s[k] = d[k];
  s.style = name; s.thresh = -24; s.inGain = 6;
  if (patch) for (var k2 in patch) s[k2] = patch[k2];
  return s;
}

function render(stateFn, seedR) {
  var st = stateFn();
  /* multiband cases go through the wrapper; everything else through the
     single engine. At bands === 1 the wrapper is bit-identical anyway —
     that is asserted in rigor_test.js — so this only changes which code
     path is exercised, never the numbers. */
  var e = (st.bands > 1 ? R.createMulti : R.createEngine)(FS);
  e.setState(st);
  var inL = source(424242);
  var inR = source(seedR || 424242);
  var outL = new Float64Array(N), outR = new Float64Array(N);
  e.process(inL, inR, outL, outR);
  var parts = [];
  for (var i = 0; i < N; i += 7) {
    parts.push(outL[i].toPrecision(17), outR[i].toPrecision(17));
  }
  return fnv1a(parts.join(','));
}

var CASES = {
  idle: function () { return styled('fresh', { ratio: 1, thresh: -60, inGain: 0 }); },
  fresh: function () { return styled('fresh'); },
  settling: function () { return styled('settling'); },
  spasm: function () { return styled('spasm'); },
  repose: function () { return styled('repose'); },
  lookmix: function () { return styled('fresh', { look: 5, mix: 45, ratio: 8, attack: 1 }); },
  sidechained: function () { return styled('fresh', { scOn: true, scHp: 220, scLp: 6000, ratio: 6 }); },
  heldRange: function () { return styled('spasm', { hold: 40, range: 9, autoRel: true, ratio: 12 }); },
  unlinked: function () { return styled('repose', { link: 0, autoMakeup: true }); },
  infinite: function () { return styled('fresh', { ratio: R.RATIO_INF, knee: 0, attack: 0.1 }); },
  /* --- v0.2 --- */
  delta: function () { return styled('fresh', { delta: true, ratio: 6, thresh: -30, attack: 5 }); },
  midside: function () { return styled('fresh', { place: 'ms', ratio: 6, thresh: -30, link: 25 }); },
  curved: function () { return styled('fresh', { curve: 80, ratio: 8, thresh: -28, autoRel: false }); },
  msdelta: function () { return styled('settling', { place: 'ms', delta: true, curve: 50, look: 2, ratio: 10 }); },
  /* --- v0.3 multiband --- */
  band2: function () { return styled('fresh', { bands: 2, xover: [300, 2000], ratio: 6, thresh: -30 }); },
  band3: function () { return styled('repose', { bands: 3, xover: [180, 2400], ratio: 4, thresh: -34,
                                                 band: [{ threshOff: -4, gain: 2 }, {}, { threshOff: 3, gain: -1 }] }); },
  bandSolo: function () { return styled('spasm', { bands: 3, ratio: 8, thresh: -26,
                                                   band: [{}, { solo: true }, {}] }); },
  /* --- v0.4 --- */
  truePeakDet: function () { return styled('fresh', { detOs: true, ratio: 8, thresh: -20, attack: 1 }); },
  synced: function () { return styled('spasm', { relSync: 5, bpm: 174, ratio: 6, thresh: -26 }); },
  bandMakeup: function () { return styled('repose', { bands: 3, xover: [200, 3000], ratio: 4,
                                                      thresh: -32, autoMakeup: true,
                                                      band: [{ threshOff: -5, gain: 1 }, { gain: -2 }, { threshOff: 4 }] }); }
};
/* EVERY FACTORY CASE IS A BASELINE.
   Fifteen presets are the settings most likely to be used and, until now,
   the least likely to be tested — none of them was covered. They are read
   straight out of rigor.html so the list cannot drift from the shipped
   instrument. */
(function () {
  var fs2 = require('fs'), path2 = require('path'), vm2 = require('vm');
  var html = fs2.readFileSync(path2.join(__dirname, '..', 'rigor.html'), 'utf8');
  var a = html.indexOf('/* UIH-START'), b = html.indexOf('/* UIH-END');
  if (a < 0 || b < a) return;
  var ctx = { window: undefined, Math: Math, JSON: JSON, RIGOR: R,
              encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent };
  vm2.createContext(ctx);
  var src = html.slice(a, b);
  try { vm2.runInContext('var ' + src.slice(src.indexOf('var ') + 4), ctx); } catch (err) { return; }
  if (!ctx.UIH || !Array.isArray(ctx.UIH.FACTORY)) return;
  ctx.UIH.FACTORY.forEach(function (f) {
    var key = 'factory_' + f.name.replace(/[^A-Za-z0-9]+/g, '_');
    CASES[key] = function () { return R.loadCase(f.s); };
  });
})();

var STEREO_SEEDS = { unlinked: 133742, lookmix: 987654 };

var results = {};
Object.keys(CASES).forEach(function (name) {
  results[name] = render(CASES[name], STEREO_SEEDS[name]);
});

if (process.argv.indexOf('--write') !== -1) {
  fs.writeFileSync(BASE, JSON.stringify({ version: R.VERSION, fs: FS, n: N, hashes: results }, null, 2) + '\n');
  console.log('baseline written:', JSON.stringify(results));
  process.exit(0);
}

if (!fs.existsSync(BASE)) {
  console.error('No baseline. Run with --write first (and commit the baseline).');
  process.exit(1);
}
var base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
var fail = 0;
Object.keys(CASES).forEach(function (name) {
  if (base.hashes[name] === results[name]) {
    console.log('  ✓ ' + name + ' byte-stable (' + results[name] + ')');
  } else {
    console.log('  ✗ FAIL: ' + name + ' drifted (' + base.hashes[name] + ' → ' + results[name] + ')');
    fail++;
  }
});
console.log(fail ? '\nREGRESSION: the body has moved.' : '\nregression clean — rigor holds.');
process.exit(fail ? 1 : 0);
