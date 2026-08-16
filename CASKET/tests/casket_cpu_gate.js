/* CASKET — THE CPU GATE
   ----------------------------------------------------------------------
   Correctness is defended by eleven harnesses. Performance is defended by
   nobody, which means it degrades the way weather changes: gradually, and
   nobody can say when it started.

   The obvious gate — "fail if velvet takes more than 100 ms" — is useless,
   because a CI runner is between two and ten times slower than a laptop
   and varies run to run depending on what else is on the box. An absolute
   threshold is either so loose it catches nothing or so tight it cries
   wolf, and a gate that cries wolf gets disabled within a fortnight.

   So this measures RATIOS. Every arrangement is timed against a
   calibration workload run on the same machine, in the same process,
   moments earlier. A runner twice as slow makes both numbers twice as
   large and leaves the ratio alone. What the gate then defends is the
   SHAPE of the cost — "lead costs about eight times what bypass costs" —
   which is a property of the code rather than of the hardware.

   Run with --bless to record the current shape as the new baseline. That
   is a deliberate act and belongs in the Interchange, exactly like
   re-blessing a regression hash.  */

var C = require('../casket_core.js');
var fs_ = require('fs');
var path = require('path');

var BASELINE = path.join(__dirname, 'casket_cpu_baseline.json');
var BLESS = process.argv.indexOf('--bless') >= 0;
var TOL = 0.30;          // 30 % — loose enough for a noisy shared runner,
                         // tight enough to catch a doubling
var REPS = 5;            // median of five; timing noise is one-sided (things
                         // only ever get slower when the box is busy), so the
                         // median is far more honest here than the mean

var FS = 48000, N = 48000 * 2;      // two seconds
var L = C.makeNoise(1234, N), R = C.makeNoise(5678, N);

function timeOnce(st) {
  var s = C.sanitizeState(st);
  var e = C.createEngine(FS);
  e.setState(s);
  var oL = new Float64Array(N), oR = new Float64Array(N);
  var t0 = process.hrtime.bigint();
  e.process(L, R, oL, oR);
  var t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6;
}

function median(a) {
  var b = a.slice().sort(function (x, y) { return x - y; });
  return b[Math.floor(b.length / 2)];
}

function measure(st) {
  var runs = [];
  timeOnce(st);                       // one throwaway pass to let JIT settle
  for (var i = 0; i < REPS; i++) runs.push(timeOnce(st));
  return median(runs);
}

/* THE CALIBRATION. Bypass still walks the whole buffer and still runs the
   meters, so it exercises the same memory traffic as a real render without
   any of the limiting. That makes it a good yardstick: if the machine is
   slow, this is slow too, and in the same proportion. */
function calibState() {
  var st = C.defaultState();
  st.bypass = true;
  return st;
}

function styleState(name) {
  var st = C.defaultState();
  var d = C.styleDefaults(name);
  for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) st[k] = d[k];
  st.style = name;
  return st;
}

console.log('CASKET CPU gate — ratios against a same-machine calibration\n');

var calib = measure(calibState());
console.log('  calibration (bypass, 2 s stereo): ' + calib.toFixed(1) + ' ms on this machine');
if (calib <= 0) { console.log('timer resolution too coarse; cannot gate'); process.exit(0); }

var SUBJECTS = [];
C.STYLES.forEach(function (s) { SUBJECTS.push([s, styleState(s)]); });
(function () {
  var st = styleState('lead'); st.dust = 'shaped';
  SUBJECTS.push(['lead + shaped dust', st]);
  var m = styleState('velvet'); m.ms = true; m.msSide = 2;
  SUBJECTS.push(['velvet + mid/side', m]);
  var o = styleState('velvet'); o.lining = 16;
  SUBJECTS.push(['velvet at 16x lining', o]);
})();

var now = {};
var fail = 0;
console.log('');
SUBJECTS.forEach(function (s) {
  var ms = measure(s[1]);
  var ratio = ms / calib;
  now[s[0]] = Math.round(ratio * 1000) / 1000;
  console.log('  ' + s[0].padEnd(24) + ms.toFixed(1).padStart(8) + ' ms' +
              ('×' + ratio.toFixed(2)).padStart(10) + ' calibration');
});

/* ============================================================
   THE OFFLINE TOOLS
   ----------------------------------------------------------------------
   Nothing was watching what these cost, and they are where the real time
   goes now. Album mode does one full render of the ENTIRE RECORD per
   bisection probe — ten probes on a forty-minute album is over six hours
   of audio through the limiter, and until this section existed the only
   way to discover that was to wait for it.

   Same ratio discipline as above, but the calibration is different on
   purpose: these are timed against ONE REAL RENDER of the same material
   through the same arrangement, not against bypass. That makes the number
   directly legible — "autoDrive costs eleven renders" is a sentence
   somebody can act on, and it stays true on a slower machine.

   The tools take real time, so the workload here is deliberately shorter
   than the two seconds used above; the ratio does not care.
   ============================================================ */
(function () {
  var TN = 48000 * 3;                       /* three seconds per track */
  var tL = C.makeNoise(31, TN), tR = C.makeNoise(41, TN);
  for (var i = 0; i < TN; i++) {
    var v = tL[i] * 2.6; tL[i] = v > 1 ? 1 : (v < -1 ? -1 : v);
    v = tR[i] * 2.6; tR[i] = v > 1 ? 1 : (v < -1 ? -1 : v);
  }
  var st = styleState('velvet'); st.lid = -1; st.drive = 6;

  function t(fn) {
    fn();                                   /* JIT settle */
    var runs = [];
    for (var k = 0; k < 3; k++) {
      var a = process.hrtime.bigint();
      fn();
      runs.push(Number(process.hrtime.bigint() - a) / 1e6);
    }
    return median(runs);
  }

  var one = t(function () { C.renderOffline(st, tL, tR, FS); });
  console.log('\n— the offline tools, against ONE render of the same material —');
  console.log('  one render (3 s stereo, velvet): ' + one.toFixed(1) + ' ms');
  if (one <= 0) return;

  var rec = [
    { name: 'a', L: tL, R: tR },
    { name: 'b', L: tL, R: tR },
    { name: 'c', L: tL, R: tR }
  ];

  var TOOLS = [
    ['autoDrive (9 passes)', function () { C.autoDrive(st, tL, tR, FS, -14, 9, 0.1); }],
    ['autoMargin (4 passes)', function () { C.autoMargin(st, tL, tR, FS, 4); }],
    ['difference (two states)', function () {
        var b2 = C.sanitizeState(st); b2.style = 'lead';
        C.difference(st, b2, tL, tR, FS);
      }],
    ['matchReference', function () { C.matchReference(st, tL, tR, tL, tR, FS); }],
    ['resample 44.1 → 96', function () { C.resample(tL, tR, 44100, 96000); }],
    ['resample 96 → 44.1', function () { C.resample(tL, tR, 96000, 44100); }],
    ['batchRender ×3', function () { C.batchRender(st, rec, FS); }],
    ['batchRender ×3 gapless', function () { C.batchRender(st, rec, FS, { gapless: true }); }],
    ['albumMaster ×3 (6 passes)', function () { C.albumMaster(st, rec, FS, -14, { passes: 6 }); }]
  ];
  TOOLS.forEach(function (tool) {
    var ms = t(tool[1]);
    var ratio = ms / one;
    now[tool[0]] = Math.round(ratio * 1000) / 1000;
    console.log('  ' + tool[0].padEnd(26) + ms.toFixed(1).padStart(9) + ' ms' +
                ('×' + ratio.toFixed(2)).padStart(10) + ' one render');
  });
  /* THE SANITY CHECK THAT IS NOT ABOUT SPEED. albumMaster with 6 passes
     probes both rails plus 6 midpoints plus one verification render, over
     3 tracks — so it must cost roughly 27 renders. If it ever costs 3,
     something has stopped rendering, and the gate would otherwise report
     that as a magnificent improvement. */
  var alb = now['albumMaster ×3 (6 passes)'];
  if (alb < 12) {
    console.log('  ✗ albumMaster costs only ×' + alb.toFixed(1) +
                ' — far too cheap. It should render ~27 times. Something is not running.');
    fail++;
  }
})();

if (BLESS || !fs_.existsSync(BASELINE)) {
  fs_.writeFileSync(BASELINE, JSON.stringify({
    note: 'Ratios against a same-machine bypass calibration. Re-blessing is a deliberate act — record it in AUDIO_INTERCHANGE.md §7.',
    blessed: new Date().toISOString().slice(0, 10),
    tolerance: TOL,
    ratios: now
  }, null, 2) + '\n');
  console.log('\nbaseline ' + (BLESS ? 're-blessed' : 'created') + ' at ' + path.basename(BASELINE));
  console.log('a blessing is a decision, not a shrug — write it down.');
  process.exit(0);
}

var base = JSON.parse(fs_.readFileSync(BASELINE, 'utf8'));
var pass = 0;
console.log('\n— against the baseline blessed ' + base.blessed + ' —');
Object.keys(now).forEach(function (k) {
  var was = base.ratios[k];
  if (was === undefined) {
    console.log('  · ' + k + ' is new; nothing to compare against yet');
    return;
  }
  var drift = (now[k] - was) / was;
  /* one-sided ON PURPOSE. Getting faster is never a regression, and a
     gate that fails on an improvement is a gate people learn to ignore. */
  if (drift > TOL) {
    fail++;
    console.log('  ✗ ' + k + ' is ' + (drift * 100).toFixed(0) + '% slower than baseline (×' +
                was.toFixed(2) + ' → ×' + now[k].toFixed(2) + ')');
  } else {
    pass++;
    console.log('  ✓ ' + k + ' ×' + now[k].toFixed(2) +
                ' (baseline ×' + was.toFixed(2) + ', ' +
                (drift >= 0 ? '+' : '') + (drift * 100).toFixed(0) + '%)');
  }
});

console.log('\n' + pass + ' within tolerance, ' + fail + ' regressed');
if (fail) {
  console.log('performance is defended like correctness. investigate, or re-bless deliberately.');
  process.exit(1);
}
console.log('the shape of the cost is unchanged.');
