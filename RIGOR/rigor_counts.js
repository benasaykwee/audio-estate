/* ============================================================
   rigor_counts.js — the docs stop restating their numbers and
   start deriving them.

     node rigor_counts.js            measure, then write the marked blocks
     node rigor_counts.js --check    measure and compare; write nothing,
                                     exit 1 if any doc disagrees (CI)
     node rigor_counts.js --print    measure and show, touch nothing
     node rigor_counts.js --fast     skip the C++ gate; read its declared
                                     size instead of observing it

   WHY THIS EXISTS. This project's oldest lesson is that an assertion
   which names its own expected value is not checking anything, it is
   restating itself. That lesson was learned about tests — the plugin
   lint "passed" for two rounds while the core and the twin carried
   different version strings, because the assertion contained the
   answer — and then it was ignored everywhere else. The README's
   vitals table and the chart's labs table are both hand-typed
   restatements of numbers nobody re-measured. The chart's table still
   reads "parity 26,022, core 160" from the seventh round. The
   interchange §1 row drifted for five rounds and had to be settled by
   compiling the gate, because BOTH numbers in circulation were wrong.

   So: every figure below is OBSERVED by running the thing that
   produces it. Nothing here reads a number out of another document,
   which would only launder one restatement into two.

   WHAT IT DELIBERATELY DOES NOT TOUCH. Dated records are history and
   history does not get regenerated. `docs/AUDIT_2026-08-16.md` says
   parity was 50,718 and it WAS, on that date. The chart's timeline
   entries say what was true when they were written. Rewriting those
   to today's figures would destroy the only evidence of how anything
   moved. Only blocks between the COUNTS markers are ever written, and
   the markers are only ever placed around tables that claim to
   describe the CURRENT state.
   ============================================================ */
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var HERE = __dirname;
var checkOnly = process.argv.indexOf('--check') >= 0;
var printOnly = process.argv.indexOf('--print') >= 0;
var fast = process.argv.indexOf('--fast') >= 0;

function die(msg) {
  console.error('\n  ✗ ' + msg + '\n');
  process.exit(2);
}

/* ---------- running a harness and believing it -------------------
   Two failure modes are guarded because both would put a number in a
   document that the number does not describe:

     · the harness FAILED — a README reading "233 passed" taken from a
       run where three failed is worse than no README at all.
     · the output did not PARSE — the silent path to recording 0, or
       to recording last week's figure because the write was skipped.
       An unparseable run is an error, never a shrug.
   ---------------------------------------------------------------- */
function runHarness(file, opts) {
  opts = opts || {};
  var full = path.join(HERE, 'tests', file);
  if (!fs.existsSync(full)) die('no such harness: tests/' + file);
  var out;
  try {
    out = cp.execSync('node ' + JSON.stringify(full), {
      cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (e) {
    var partial = (e.stdout || '') + (e.stderr || '');
    die('tests/' + file + ' FAILED. The docs do not get a number from a red ' +
        'suite.\n' + partial.split('\n').slice(-12).join('\n'));
  }
  if (opts.raw) return out;
  var m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  if (!m) die('could not read a count out of tests/' + file + '. Refusing to ' +
              'guess — an unparseable run and a clean run must not look alike.');
  if (+m[2] !== 0) die('tests/' + file + ' reports ' + m[2] + ' failures');
  return { passed: +m[1], out: out };
}

/* ---------- the measurements ---------- */
var R = require('./rigor_core.js');
var V = {};

process.stderr.write('measuring (this runs the suite; it is not a lookup)\n');

var RAW = {};
['rigor_test|core', 'rigor_ui_test|ui', 'rigor_plugin_test|lint',
 'rigor_fuzz|fuzz', 'rigor_audit|audit', 'rigor_stress|stress'
].forEach(function (pair) {
  var f = pair.split('|')[0], k = pair.split('|')[1];
  process.stderr.write('  · ' + f + '\n');
  var r = runHarness(f + '.js');
  V[k] = r.passed;
  RAW[k] = r.out;          /* kept so nothing has to be run twice */
});

/* ---------- regression baselines, counted TWO ways ----------
   The harness prints one `byte-stable` line per baseline it checked;
   the baseline file declares a set of hashes. Either alone can be
   wrong in a way that looks reasonable — my first attempt read the
   JSON's TOP-LEVEL keys and confidently wrote "4 baselines" into the
   README, because the hashes live one level down under `hashes` and
   4 is not an absurd-looking number. Requiring the two to agree is
   what turns a plausible wrong answer into a loud one. */
process.stderr.write('  · rigor_regression.js\n');
var regOut = runHarness('rigor_regression.js', { raw: true });
if (!/regression clean/.test(regOut))
  die('regression did not report clean; the baseline count would be meaningless');
var checked = (regOut.match(/byte-stable/g) || []).length;
var baseFile = path.join(HERE, 'tests', 'rigor_regression_baseline.json');
var baseJson = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
var declaredHashes = Object.keys(baseJson.hashes || {}).length;
if (!checked) die('the regression harness reported no baselines at all');
if (checked !== declaredHashes)
  die('the regression harness checked ' + checked + ' baselines but the file ' +
      'declares ' + declaredHashes + '. One of them is not describing the suite.');
V.baselines = checked;

/* mutation: parsed from its own summary line, not counted by hand */
process.stderr.write('  · rigor_mutate.js\n');
var mutOut = runHarness('rigor_mutate.js', { raw: true });
var mm = mutOut.match(/(\d+)\s+killed,\s+(\d+)\s+survived,\s+(\d+)\s+equivalent/);
if (!mm) die('could not read the mutation summary');
if (+mm[2] !== 0) die('mutation reports ' + mm[2] + ' survivors');
V.mutKilled = +mm[1]; V.mutSurvived = +mm[2]; V.mutEquiv = +mm[3];

/* coverage census: a state, not a count */
process.stderr.write('  · rigor_coverage.js --strict\n');
try {
  cp.execSync('node ' + JSON.stringify(path.join(HERE, 'tests', 'rigor_coverage.js')) +
              ' --strict', { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
                             maxBuffer: 32 * 1024 * 1024 });
  V.coverage = 'no unexplained gaps';
} catch (e) { die('coverage --strict reports an unexplained gap'); }

/* ---------- parity ----------
   EXP_CHECKS is what the gate ENFORCES — core_parity.cpp refuses to
   pass if its own count disagrees, which is the guard added after a
   stale binary printed a green result for a test it did not contain.
   Reading it is therefore honest about the gate's SIZE. But the README
   says "bit-exact", and that is a claim about a RUN. So by default the
   gate is compiled and executed, and the two numbers must agree. */
var hdr = fs.readFileSync(path.join(HERE, 'tests', 'parity_expected.h'), 'utf8');
var pm = hdr.match(/EXP_CHECKS\s*=\s*(\d+)/);
if (!pm) die('parity_expected.h declares no EXP_CHECKS');
V.parity = +pm[1];
V.parityVerified = false;

if (!fast) {
  var hasGpp = true;
  try { cp.execSync('g++ --version', { stdio: 'ignore' }); } catch (e) { hasGpp = false; }
  if (!hasGpp) {
    process.stderr.write('  · no g++ — parity size read, not observed (use --fast to silence)\n');
  } else {
    process.stderr.write('  · compiling and running the parity gate\n');
    var bin = path.join(require('os').tmpdir(), 'rigor_counts_parity');
    try { fs.unlinkSync(bin); } catch (e) {}   /* a stale binary proves nothing */
    try {
      cp.execSync('g++ -std=c++17 -O2 -ffp-contract=off -o ' + JSON.stringify(bin) + ' ' +
                  JSON.stringify(path.join(HERE, 'tests', 'core_parity.cpp')),
                  { cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { die('the parity gate did not compile:\n' + (e.stderr || '')); }
    if (!fs.existsSync(bin)) die('the parity binary was not produced');
    var pOut;
    try { pOut = cp.execSync(JSON.stringify(bin), { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); }
    catch (e) { die('the parity gate FAILED:\n' + ((e.stdout || '') + (e.stderr || '')).slice(-800)); }
    var ran = pOut.match(/PARITY:\s*(\d+)\s+checks/);
    if (!ran) die('could not read the parity gate output');
    if (+ran[1] !== V.parity)
      die('the gate ran ' + ran[1] + ' checks but the header declares ' + V.parity +
          '. That disagreement is the exact thing EXP_CHECKS exists to catch.');
    V.parityVerified = true;
  }
}

/* ---------- host parameters: ASK THE LINT, do not re-count ----------
   My first attempt grepped `ParameterID{ "..."` out of
   PluginProcessor.cpp and got 39 against a true 47, because eight of
   them are generated in a loop over MAX_BANDS and a static regex
   cannot see a parameter that does not exist as a literal. A second
   implementation of a count is a second thing that can be wrong, and
   this one had no tests.

   `rigor_plugin_test.js` already resolves the real list — that is the
   assertion round 10 rebuilt to be derived rather than a floor — so
   the number is read from the harness that is itself tested. Its
   `fields` figure is cross-checked against defaultState() here, which
   is the independent source; if the lint ever starts lying, the two
   stop agreeing. */
var lm = RAW.lint.match(/(\d+)\s+fields,\s*(\d+)\s+parameters/);
if (!lm) die('the plugin lint no longer states its field/parameter counts in a ' +
             'form this can read. Fix the parse rather than hand-typing a number.');
V.stateFields = Object.keys(R.defaultState()).length;
V.hostParams = +lm[2];
if (+lm[1] !== V.stateFields)
  die('the plugin lint counted ' + lm[1] + ' state fields; defaultState() has ' +
      V.stateFields + '. Two sources disagreeing is the whole reason both are read.');

var styles = Object.keys(R.STYLE || {}).length;
if (!styles) die('could not count styles off the core');
V.styles = styles;

/* ---------- rendering ---------- */
function n(x) { return x.toLocaleString('en-US'); }

var README_BLOCK = [
  '| | |',
  '|---|---|',
  '| Core harness | **' + V.core + '** |',
  '| UI-logic harness | ' + V.ui + ' |',
  '| Plugin lint | ' + V.lint + ' |',
  '| Fuzzer | ' + V.fuzz + ' |',
  '| **Audits** (latency, automation, transitions, extremes, advice) | **' + V.audit + '** |',
  '| **Stress** (hostile input samples, determinism, block boundaries) | **' + V.stress + '** |',
  '| **Coverage census** (every field: sanitised / read / ported / exposed / tested) | ' + V.coverage + ' |',
  '| **Mutation** (the core broken on purpose) | **' + V.mutKilled + ' killed, ' +
    V.mutSurvived + ' survived, ' + V.mutEquiv + ' equivalent** |',
  '| Regression baselines | **' + V.baselines + '**, byte-stable — every factory case included |',
  /* NOTE the absence of a "verified this run" marker here. It was in an
     earlier draft and it was a bug: the rendered block would then differ
     between a full run and a --fast one, so `--check --fast` would call a
     perfectly current document stale. Whether the gate was COMPILED is a
     property of this invocation; the number is a property of the project.
     Mixing the two makes the check untrustworthy, and an untrustworthy
     check is worse than none — people learn to re-run it until it agrees.
     The verification status is reported on the console instead. */
  '| **Parity gate** | **' + n(V.parity) + ' bit-exact** |',
  '| Host parameters | ' + V.hostParams + ' |',
  '| State fields | ' + V.stateFields + ' |'
].join('\n');

var LABS_BLOCK = [
  "  ['Parity gate — JS vs C++ twin', '" + n(V.parity) + "', 'bit-exact', 'n', " +
    "'Every figure in this table is measured by <code>rigor_counts.js</code>, not typed. " +
    "This row used to read 26,022 four rounds after it stopped being true.'],",
  "  ['Core harness', '" + V.core + "', 'all green', 'n', ''],",
  "  ['Audits', '" + V.audit + "', 'all green', 'n', 'Latency, automation, transitions, " +
    "extremes, state round trip, and whether the advice functions deliver what they promise.'],",
  "  ['UI-logic harness', '" + V.ui + "', 'all green', 'n', ''],",
  "  ['Plugin lint', '" + V.lint + "', 'all green', 'n', ''],",
  "  ['Fuzzer', '" + V.fuzz + "', 'all green', 'n', ''],",
  "  ['Stress', '" + V.stress + "', 'all green', 'n', 'Hostile input samples, recovery, " +
    "determinism, block boundaries inside the control interval.'],",
  "  ['Mutation', '" + V.mutKilled + " killed', '" + V.mutSurvived + " survived', 'n', " +
    "'" + V.mutEquiv + " equivalent — cannot be killed, and the tester flags an equivalent " +
    "mutant that DIES, which would mean a test asserts something false.'],",
  "  ['Regression baselines', '" + V.baselines + " / " + V.baselines + "', 'byte-stable', 'n', " +
    "'Every factory case is a baseline, read straight out of the instrument so the list cannot drift.'],",
  "  ['Coverage census', 'clean', '" + V.coverage + "', 'n', ''],",
  "  ['Host parameters · state fields', '" + V.hostParams + " · " + V.stateFields + "', " +
    "'in step', 'n', 'The census fails if a field exists that no host can reach.'],",
  "  ['Topologies, measured', '" + V.styles + "', 'distinct', 'n', " +
    "'Counted off the STYLE table. Was 3-not-4 until Spasm was given its own peak decay.']"
].join('\n');

/* ---------- the marked blocks ---------- */
var TARGETS = [
  { file: 'README.md',       key: 'VITALS', body: README_BLOCK, cmt: 'md' },
  { file: 'docs/chart.html', key: 'LABS',   body: LABS_BLOCK,   cmt: 'html' }
];

function markers(key) {
  return { a: '<!-- COUNTS:' + key + ' BEGIN — generated by rigor_counts.js, do not hand-edit -->',
           b: '<!-- COUNTS:' + key + ' END -->' };
}

if (printOnly) {
  console.log(JSON.stringify(V, null, 2));
  process.exit(0);
}

var stale = [], wrote = [], missing = [];

TARGETS.forEach(function (t) {
  var p = path.join(HERE, t.file);
  if (!fs.existsSync(p)) die('no such file: ' + t.file);
  var s = fs.readFileSync(p, 'utf8');
  var mk = markers(t.key);
  var ia = s.indexOf(mk.a), ib = s.indexOf(mk.b);
  if (ia < 0 || ib < 0 || ib < ia) { missing.push(t.file + ' (' + t.key + ')'); return; }
  var head = s.slice(0, ia + mk.a.length);
  var tail = s.slice(ib);
  var current = s.slice(ia + mk.a.length, ib);
  var next = '\n' + t.body + '\n';
  if (current === next) return;
  stale.push(t.file);
  if (!checkOnly) { fs.writeFileSync(p, head + next + tail); wrote.push(t.file); }
});

if (missing.length) {
  die('these files have no COUNTS markers, so nothing could be derived:\n    ' +
      missing.join('\n    ') + '\n  Add the BEGIN/END pair around the table that ' +
      'claims to describe the CURRENT state. Do NOT put them around a dated record.');
}

console.log('\n  parity ' + n(V.parity) + (V.parityVerified ? ' (gate compiled and run)' : ' (declared)') +
            ' · core ' + V.core + ' · ui ' + V.ui + ' · lint ' + V.lint +
            ' · fuzz ' + V.fuzz + ' · audit ' + V.audit + ' · stress ' + V.stress +
            ' · ' + V.baselines + ' baselines · ' + V.hostParams + ' params · ' +
            V.stateFields + ' fields');

if (checkOnly) {
  if (stale.length) {
    console.error('\n  ✗ STALE — these documents state numbers the suite does not produce:\n    ' +
                  stale.join('\n    ') + '\n\n  Run `node rigor_counts.js` to derive them.\n');
    process.exit(1);
  }
  console.log('  ✓ every derived block matches what the suite actually produces\n');
  process.exit(0);
}

console.log(wrote.length ? '  ✓ rewrote: ' + wrote.join(', ') + '\n'
                         : '  ✓ already current — nothing to rewrite\n');
