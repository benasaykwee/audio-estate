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
  /* 16× sealed, added 2026-08-19. The suite pinned 2× and 4× and stopped —
     but 16× is the configuration the architecture doc measures as slightly
     WORSE (+0.562 vs 4×'s +0.507), because a longer decimator has a sharper
     transition and preserves more product energy just under Nyquist. It is
     also the longest filter in the program, so it is where a decimator
     change would show first and where nobody was looking. */
  sealed16x: styled('velvet', { seal: true, lining: 16, drive: 12 }),
  sealedDust: styled('lead', { seal: true, dust: 'shaped', dustBits: 24, dustSeed: 909 }),
  midside: styled('velvet', { ms: true, msMid: 3, msSide: -4, drive: 10 })
};

/* a true-stereo case needs a second seed or the channels are identical */
var STEREO_SEEDS = { linked0: 133742, lining16: 987654 };

var results = {};
Object.keys(CASES).forEach(function (name) {
  results[name] = render(CASES[name], STEREO_SEEDS[name]);
});

/* THE ALBUM PIPELINE gets a baseline too — added 2026-08-18, additively
   (every pre-existing hash above is untouched; verified by diff at the
   blessing). By this file's own standard the sealed path earned baselines
   for being "a second signal path [that] would be free to drift" — and so
   is this one: gapless renders the whole record through ONE engine and
   cuts it back into tracks, with the dither generator forced continuous
   across the join. The ENGINE under it is pinned by every case above; what
   nothing pinned is the cutting — the latency-compensated slice arithmetic
   and the seam itself. An off-by-one in the cut would move every sample of
   track two while all fourteen engine baselines stayed green.
   Shaped dust on purpose: gapless forces `continuous`, so this hash also
   pins the noise stream not restarting at the join — the exact thing
   mutant 12 in casket_mutate.js breaks. */
results.gaplessBatch = (function () {
  var st = styled('velvet', { dust: 'shaped', dustBits: 16 })();
  var L = source(424242, 4), R = source(133742, 4);
  var half = N >> 1;
  var rec = [
    { name: 'a', L: L.subarray(0, half), R: R.subarray(0, half) },
    { name: 'b', L: L.subarray(half),    R: R.subarray(half) }
  ];
  var b = C.batchRender(st, rec, FS, { gapless: true });
  var parts = [];
  b.tracks.forEach(function (t) {
    for (var i = 0; i < t.L.length; i += 7) {
      parts.push(t.L[i].toPrecision(17), t.R[i].toPrecision(17));
    }
  });
  return fnv1a(parts.join(','));
})();

/* --list — added 2026-08-19, the same argument the mutant listing earned.
   Sixteen baselines, each a state patch, and the only way to answer "what
   does this actually cover?" was reading the CASES literal. It also shows
   which hashes are recorded but no longer produced (a case renamed or
   removed leaves its hash in the baseline file forever, silently) and which
   are produced but not yet recorded. */
if (process.argv.indexOf('--list') >= 0) {
  var known = fs.existsSync(BASE) ? JSON.parse(fs.readFileSync(BASE, 'utf8')).hashes : {};
  var names = Object.keys(results);
  console.log('CASKET regression baselines — ' + names.length + ' cases\n');
  console.log('  case            hash       what it pins');
  var WHAT = {
    idle:        'lid above the signal — the bit-exact null test',
    pine:        'the plain box at its own defaults',
    velvet:      'the default arrangement',
    oak:         'the short smoother (⅜ vigil)',
    iron:        'soft-clip pre-stage at 8× lining',
    lead:        'sealed, the one arrangement that trades the null test',
    lining16:    '16× with a long vigil, knee and hold',
    linked0:     'unlinked channels, true stereo material',
    dusted:      'shaped dither at 16 bits',
    saturated:   'saturation with unity armed',
    sealed2x:    'the shortest sealed decimator',
    sealed4x:    'the sealed default',
    sealed16x:   'the longest decimator — §6.4 measures it as the worst residual',
    sealedDust:  'sealed AND dithered, 24-bit',
    midside:     'the M/S pre-stage, off-unity both axes',
    gaplessBatch:'the album cut — join arithmetic and continuous dither'
  };
  names.forEach(function (n) {
    var state = known[n] === undefined ? 'NEW' : (known[n] === results[n] ? 'ok' : 'DRIFTED');
    console.log('  ' + n.padEnd(15) + results[n] + '   ' +
                (state === 'ok' ? '' : '[' + state + '] ') + (WHAT[n] || '(undescribed)'));
  });
  var orphans = Object.keys(known).filter(function (n) { return results[n] === undefined; });
  var undescribed = names.filter(function (n) { return !WHAT[n]; });
  console.log('\n' + names.length + ' cases produced, ' + Object.keys(known).length + ' hashes on record.');
  if (orphans.length) console.log('  ORPHANED hashes (recorded, no longer produced): ' + orphans.join(', '));
  if (undescribed.length) console.log('  UNDESCRIBED (add a line to WHAT): ' + undescribed.join(', '));
  process.exit(orphans.length || undescribed.length ? 1 : 0);
}

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
Object.keys(results).forEach(function (name) {
  if (base.hashes[name] === results[name]) {
    console.log('  ✓ ' + name + ' byte-stable (' + results[name] + ')');
  } else {
    console.log('  ✗ FAIL: ' + name + ' drifted (' + base.hashes[name] + ' → ' + results[name] + ')');
    fail++;
  }
});
console.log(fail ? '\nREGRESSION: the lid has shifted.' : '\nregression clean — the box is sealed as it was.');
process.exit(fail ? 1 : 0);
