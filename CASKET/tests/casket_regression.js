/* CASKET regression — byte-stable render baselines.
   node tests/casket_regression.js          → compare against baseline
   node tests/casket_regression.js --write  → (re)write baseline
   Hash = FNV-1a over %.17g of every output sample, so ANY numeric drift
   in the core — or in shared/necromath.js, or in shared/necrodyn.js —
   fails the gate. */
'use strict';
var fs = require('fs');
var path = require('path');
var C = require('../casket_core.js');

var BASE = path.join(__dirname, 'casket_regression_baseline.json');
var FS = 48000, N = 48000;

function fnv1a(str) {
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

/* a deterministic, demanding source: clipped noise, distinct per channel */
function source(seed, scale) {
  var a = C.makeNoise(seed, N);
  for (var i = 0; i < N; i++) {
    var v = a[i] * scale;
    a[i] = v > 1 ? 1 : (v < -1 ? -1 : v);
  }
  return a;
}

function render(stateFn, seedR) {
  var s = stateFn();
  var e = C.createEngine(FS);
  e.setState(s);
  var inL = source(424242, 4);
  var inR = seedR ? source(seedR, 4) : inL;
  var outL = new Float64Array(N), outR = new Float64Array(N);
  e.process(inL, inR, outL, outR);
  var parts = [];
  for (var i = 0; i < N; i += 7) {
    parts.push(outL[i].toPrecision(17), outR[i].toPrecision(17));
  }
  return fnv1a(parts.join(','));
}

function styled(name, patch) {
  return function () {
    var s = C.defaultState();
    var d = C.styleDefaults(name);
    for (var k in d) s[k] = d[k];
    s.style = name;
    s.lid = -1.0; s.drive = 9;
    if (patch) for (var k2 in patch) s[k2] = patch[k2];
    return s;
  };
}

var CASES = {
  idle: function () { var s = C.defaultState(); s.lid = 0; s.drive = 0; return s; },
  pine: styled('pine'),
  velvet: styled('velvet'),
  oak: styled('oak'),
  iron: styled('iron'),
  lead: styled('lead'),
  lining16: styled('velvet', { lining: 16, vigil: 4, knee: 6, hold: 20 }),
  linked0: styled('velvet', { link: 0, drive: 14 }),
  dusted: styled('pine', { dust: 'shaped', dustBits: 16, dustSeed: 4711 }),
  saturated: styled('iron', { sat: 90, drive: 15, unity: true }),
  /* the sealed path gets its own baselines — it is a second signal path
     and an unwatched one would be free to drift */
  sealed2x: styled('velvet', { seal: true, lining: 2, drive: 12 }),
  sealed4x: styled('velvet', { seal: true, lining: 4, drive: 12 }),
  sealedDust: styled('lead', { seal: true, dust: 'shaped', dustBits: 24, dustSeed: 909 }),
  midside: styled('velvet', { ms: true, msMid: 3, msSide: -4, drive: 10 })
};

/* a true-stereo case needs a second seed or the channels are identical */
var STEREO_SEEDS = { linked0: 133742, lining16: 987654 };

var results = {};
Object.keys(CASES).forEach(function (name) {
  results[name] = render(CASES[name], STEREO_SEEDS[name]);
});

if (process.argv.indexOf('--write') !== -1) {
  fs.writeFileSync(BASE, JSON.stringify({ version: C.VERSION, fs: FS, n: N, hashes: results }, null, 2) + '\n');
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
console.log(fail ? '\nREGRESSION: the lid has shifted.' : '\nregression clean — the box is sealed as it was.');
process.exit(fail ? 1 : 0);
