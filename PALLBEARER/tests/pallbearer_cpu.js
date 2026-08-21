/* PALLBEARER CPU — measure now, before there is anything to regress.
   node tests/pallbearer_cpu.js            check against the baseline
   node tests/pallbearer_cpu.js --bless    re-record

   Six waveguides, four dispersion allpasses each, a three-mode body and a
   coil filter is not free, and the first time that matters will be inside
   Logic with thirty other plugins loaded. CASKET keeps a cpu baseline for
   the same reason.

   WHAT THIS IS NOT. It is not a benchmark of the machine — a shared runner
   is far too noisy for that. It is a RATIO gate: every case is measured
   against a reference workload measured in the same process seconds
   earlier, so a slow day scales both and the ratio holds. A gate that
   fails whenever the CI box is busy is a gate people learn to ignore. */
'use strict';
var fs = require('fs');
var path = require('path');
var PB = require('../pallbearer_core.js');

var BASELINE = path.join(__dirname, 'cpu_baseline.json');
var bless = process.argv.indexOf('--bless') >= 0;
var SR = 48000;
var BLOCK = 128;
var SECONDS = 4;

function timeCase(patch, notes, seconds) {
  var core = new PB.PallbearerCore(SR, 0x5EED1E);
  core.setPatch(patch);
  var total = Math.floor(seconds * SR);
  var L = new Float64Array(BLOCK), R = new Float64Array(BLOCK);
  var gap = Math.floor(total / (notes.length + 1));
  var t0 = process.hrtime.bigint();
  var pos = 0, ni = 0, cur = -1;
  while (pos < total) {
    while (ni < notes.length && pos >= ni * gap) {
      if (cur >= 0) core.noteOff(cur);
      cur = notes[ni]; core.noteOn(cur, 0.88); ni++;
    }
    core.render(L, R, Math.min(BLOCK, total - pos));
    pos += BLOCK;
  }
  var t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6;   // ms
}

/* The reference: one string, nothing switched on. Everything else is
   reported as a multiple of this, which is the number that stays stable
   across machines. */
var REF_PATCH = { couple: 0, bodyMix: 0, drive: 0, buzz: 0, relNoise: 0,
                  fretNoise: 0, humanize: 0, noise: 0 };

var CASES = [
  { name: 'reference_1_string', patch: REF_PATCH, notes: [33] },
  { name: 'four_strings',       patch: REF_PATCH, notes: [28, 33, 38, 43] },
  { name: 'body_on',            patch: { couple: 0, bodyMix: 0.6, woodMix: 1, drive: 0 }, notes: [28, 33, 38, 43] },
  { name: 'coupling_on',        patch: { couple: 1, bodyMix: 0, drive: 0 }, notes: [28, 33, 38, 43] },
  { name: 'everything_on',      patch: { couple: 1, bodyMix: 0.6, woodMix: 1, drive: 0.5,
                                         buzz: 1, relNoise: 1, fretNoise: 1, humanize: 1, noise: 1 },
                                notes: [28, 33, 38, 43] },
  { name: 'six_string_full',    patch: { tuning: 'standard-6', couple: 1, bodyMix: 0.6,
                                         woodMix: 1, drive: 0.5, humanize: 1 },
                                notes: [23, 28, 33, 38, 43, 48] }
];

/* WARM EACH CASE, not just the process. The first version warmed only the
   reference patch and the ratios then swung wildly between runs — coupling
   read 4.47× on one pass and 2.63× on the next, because the coupling path
   was still being compiled during its own first measurement. A gate whose
   numbers move by 70% for no reason is worse than no gate: it trains you to
   ignore it. Every case now runs twice before the clock starts. */
CASES.forEach(function (c) { timeCase(c.patch, c.notes, 1); timeCase(c.patch, c.notes, 1); });

var results = {};
var refMs = 0;
console.log('PALLBEARER CPU — ' + SECONDS + ' s of audio per case, block ' + BLOCK + ', ' + SR + ' Hz\n');
CASES.forEach(function (c) {
  /* MINIMUM of seven, not the median. Noise on a shared machine is strictly
     additive — a scheduler preemption or a GC pause can only ever make a run
     slower, never faster — so the fastest observation is the closest estimate
     of the true cost, while the median still carries whatever the box was
     doing that second. The median version of this failed one run in three
     for no reason at all, which is the failure mode that teaches people to
     stop reading a gate. */
  var runs = [];
  for (var i = 0; i < 7; i++) runs.push(timeCase(c.patch, c.notes, SECONDS));
  runs.sort(function (a, b) { return a - b; });
  var ms = runs[0];
  if (c.name === 'reference_1_string') refMs = ms;
  var realtime = (SECONDS * 1000) / ms;
  results[c.name] = { ratio: +(ms / refMs).toFixed(3) };
  console.log('  ' + c.name.padEnd(20) + ms.toFixed(1).padStart(7) + ' ms   ' +
              (ms / refMs).toFixed(2).padStart(5) + '× ref   ' +
              realtime.toFixed(0).padStart(5) + '× realtime');
});

var slowest = Math.max.apply(null, Object.keys(results).map(function (k) { return results[k].ratio; }));
console.log('\n  reference case ran ' + ((SECONDS * 1000) / refMs).toFixed(0) + '× faster than realtime');
console.log('  heaviest case is ' + slowest.toFixed(2) + '× the reference');

if (bless || !fs.existsSync(BASELINE)) {
  fs.writeFileSync(BASELINE, JSON.stringify({
    recorded: new Date().toISOString().slice(0, 10), version: PB.VERSION,
    note: 'ratios against reference_1_string, not absolute times',
    ratios: results
  }, null, 2));
  console.log('\n' + (bless ? 'BLESSED' : 'no baseline found — recorded') + ' ' +
              Object.keys(results).length + ' cost ratios at v' + PB.VERSION);
  process.exit(0);
}

var base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
var fails = 0;
/* 50% headroom, and that is a deliberate admission rather than a target.
   This is a coarse net: it will catch a per-sample allocation, a filter
   recomputed inside the loop, or an accidental O(n²) — the mistakes that
   double or triple a cost. It will NOT catch a 20% regression, and pretending
   otherwise on a shared runner would just produce a gate that cries wolf.
   If a finer measurement is ever needed it wants a quiet machine, not a
   tighter number here. */
var TOL = 1.5;
console.log('\nagainst the baseline recorded ' + base.recorded + ' at v' + base.version + ':');
Object.keys(results).forEach(function (k) {
  var was = base.ratios[k];
  if (!was) { console.log('  ? ' + k.padEnd(20) + 'NEW — not in baseline'); fails++; return; }
  var now = results[k].ratio, r = now / was.ratio;
  if (r > TOL) { console.log('  ✗ ' + k.padEnd(20) + was.ratio + '× → ' + now + '×  (' + ((r - 1) * 100).toFixed(0) + '% heavier)'); fails++; }
  else console.log('  ✓ ' + k.padEnd(20) + was.ratio + '× → ' + now + '×');
});

console.log('');
if (fails === 0) { console.log('cost gate clean — nothing got heavier.'); process.exit(0); }
console.log(fails + ' case(s) exceeded the ' + Math.round((TOL - 1) * 100) + '% tolerance. If deliberate: --bless.');
process.exit(1);
