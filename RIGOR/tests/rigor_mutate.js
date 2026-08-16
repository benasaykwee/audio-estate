/* RIGOR mutation tester — a test for the tests.
   ============================================================
   Every harness in this project is green. That is a statement about the
   ENGINE. It is not a statement about the harness, and this codebase has
   now produced roughly ten wrong assertions of my own against about seven
   real bugs, plus one parity run that printed a confident all-bit-exact
   from a stale binary. A green suite is only worth what it would catch.

   So: deliberately damage the core, one small edit at a time, and demand
   that the suite go red. A mutant that SURVIVES is the interesting result.
   It means that line of DSP could be wrong in that exact way and every
   test in the building would still tell Ben everything is fine.

   Each mutation is a surgical string edit against rigor_core.js. They are
   written by hand rather than generated, because a generated mutant that
   does not compile teaches nothing, and because the mutations worth making
   are the ones that mirror mistakes actually made here: an operator
   boundary, a sign, an order of operations, a coefficient.

   Usage:  node tests/rigor_mutate.js          run them all
           node tests/rigor_mutate.js 3        run just mutant 3
   ============================================================ */
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
var CORE = path.join(ROOT, 'rigor_core.js');
var MUT_CORE = path.join(ROOT, 'rigor_core.__mut.js');
var MUT_TEST = path.join(__dirname, '.__mut_test.js');
var SRC = fs.readFileSync(CORE, 'utf8');

/* Each entry: what we break, the exact edit, and — importantly — the
   sentence explaining what a survivor would MEAN. If a mutation cannot
   be described that way it is not worth running. */
var MUTANTS = [
  { name: 'ratio: 1:1 no longer an exact identity',
    find: 'function invRatio(r) { return r >= RATIO_INF ? 0 : 1 / r; }',
    repl: 'function invRatio(r) { return r >= RATIO_INF ? 0 : 1 / (r + 1e-12); }',
    means: 'the null test at 1:1 would stop being bit-exact. That promise is ' +
           'what the whole regression suite is built on.' },

  { name: 'peak follower: decay AFTER the compare instead of before',
    find: 'pkL *= pkC; if (apl > pkL) pkL = apl;',
    repl: 'if (apl > pkL) pkL = apl; pkL *= pkC;',
    means: 'the exact operation-order mistake that produced 7,507 parity ' +
           'mismatches in the C++ twin. If the JS suite cannot see it, only ' +
           'the parity gate protects that line.' },

  { name: 'range clamps the wrong direction',
    find: 'return gr < -rangeDb ? -rangeDb : gr;',
    repl: 'return gr > -rangeDb ? -rangeDb : gr;',
    means: 'range would FLOOR the gain reduction rather than cap it, so ' +
           'range=0 would stop being a bypass and would instead mean ' +
           '"always reduce by nothing" only by accident.' },

  { name: 'stereo link follows the quieter channel',
    find: 'var mx = lvL > lvR ? lvL : lvR;',
    repl: 'var mx = lvL < lvR ? lvL : lvR;',
    means: 'linked stereo would follow the QUIETER side, so a hit on one ' +
           'channel would not duck the other — the entire point of linking.' },

  { name: 'dry/wet blend inverted on the left channel',
    find: 'yl = dl * (mixD + lgL * mixW);',
    repl: 'yl = dl * (mixW + lgL * mixD);',
    means: 'mix=0 would be fully compressed and mix=100 dry, on one channel ' +
           'only. The null-at-mix-0 test exists precisely for this.' },

  { name: 'right channel attacks with the release coefficient',
    find: 'if (tR < gRf) { gRf = moveTo(gRf, tR, attC); holdR = holdN; }',
    repl: 'if (tR < gRf) { gRf = moveTo(gRf, tR, relF); holdR = holdN; }',
    means: 'the two channels would have different attack times. Every ' +
           'stereo source would drift image on transients.' },

  { name: 'lookahead ignores a one-sample delay',
    find: 'var dl = lookN > 0 ? delL.push(xl) : xl;',
    repl: 'var dl = lookN > 1 ? delL.push(xl) : xl;',
    means: 'at the smallest non-zero lookahead the reported latency would ' +
           'no longer match the real delay, and the host would misalign the ' +
           'track by a sample.' },

  /* EQUIVALENT MUTANT — kept, and marked, deliberately.
     I wrote this one expecting it to expose an untested fast path. It
     cannot: the guard skips the multiply only when inLin is exactly 1.0,
     and multiplying by exactly 1.0 is bit-exact in IEEE. The mutant and
     the original are the same program. It is unkillable, and a suite that
     "caught" it would be asserting something false.
     It stays in the list as a live reminder that a surviving mutant has
     two possible meanings, and the first thing to check is whether the
     mutation was a real change at all. That is the same mistake this
     project has now made about ten times: the test was wrong, not the code. */
  { name: 'input gain applied unconditionally', equivalent: true,
    find: 'if (inLin !== 1) { xl *= inLin; xr *= inLin; }',
    repl: 'xl *= inLin; xr *= inLin;',
    means: 'nothing — multiplying by exactly 1.0 is bit-exact, so this ' +
           'mutant IS the original program. Expected to survive.' },

  { name: 'crossover: the low band loses its allpass correction',
    find: 'out[0] = two(lp2, apL[0], aL) + two(hp2, apH[0], aL);',
    repl: 'out[0] = aL;',
    means: 'the three bands would no longer sum flat. A multiband instance ' +
           'doing no compression at all would still colour the signal.' },

  { name: 'crossover separation rule reversed',
    find: 'if (nb < na * 1.1) nb = na * 1.1;',
    repl: 'if (nb < na * 1.1) na = nb / 1.1;',
    means: 'the fuzzer found this class of bug once already: crossovers can ' +
           'collide and a filter section gets designed above the Nyquist ' +
           'guard, where it is not a filter but noise.' },

  { name: 'transient split blends the wrong follower',
    find: 'al = al * (1 - tsW) + (wL2 * tsFL + (1 - wL2) * tsSL) * tsW;',
    repl: 'al = al * (1 - tsW) + ((1 - wL2) * tsFL + wL2 * tsSL) * tsW;',
    means: 'the newest DSP in the building would favour the slow follower ' +
           'exactly when the signal is moving — backwards — and nothing ' +
           'written this round would notice.' },

  { name: 'band solo no longer overrides mute',
    find: 'for (k = 0; k < nb; k++) if (st.band[k].solo) anySolo = true;',
    repl: 'for (k = 0; k < nb; k++) if (false) anySolo = true;',
    means: 'soloing a band would do nothing at all, silently, and the ' +
           'multiband UI would appear to work.' }
];

/* ------------------------------------------------------------------ */
function cleanup() {
  [MUT_CORE, MUT_TEST].forEach(function (p) {
    try { fs.unlinkSync(p); } catch (e) { /* already gone */ }
  });
}

function runSuiteAgainst(mutantSrc) {
  fs.writeFileSync(MUT_CORE, mutantSrc);
  var t = fs.readFileSync(path.join(__dirname, 'rigor_test.js'), 'utf8')
            .replace("require('../rigor_core.js')", "require('../rigor_core.__mut.js')");
  fs.writeFileSync(MUT_TEST, t);
  var r = cp.spawnSync(process.execPath, [MUT_TEST],
                       { encoding: 'utf8', timeout: 120000, cwd: ROOT });
  var out = (r.stdout || '') + (r.stderr || '');
  var m = out.match(/(\d+) passed, (\d+) failed/);
  return {
    died: r.status !== 0,
    crashed: r.status !== 0 && !m,
    failed: m ? parseInt(m[2], 10) : -1,
    firstFail: (out.match(/FAIL[^\n]*/) || [''])[0].slice(0, 78)
  };
}

var only = process.argv[2] ? parseInt(process.argv[2], 10) : -1;
console.log('RIGOR mutation tester — breaking the core on purpose\n');
console.log('A mutant that DIES means the suite would have caught that bug.');
console.log('A mutant that SURVIVES is a hole, and is reported as one.\n');

var killed = 0, survived = 0, notFound = 0, equiv = 0, holes = [];

MUTANTS.forEach(function (mu, i) {
  if (only >= 0 && i !== only) return;
  var label = String(i).padStart(2, ' ') + '. ' + mu.name;

  if (SRC.indexOf(mu.find) < 0) {
    /* The mutation could not be applied. This is NOT a pass — it means the
       core moved and this mutant is now testing nothing. Loudly. */
    console.log(label + '\n    NOT APPLIED — the target line is gone from the core.');
    console.log('    looked for: ' + mu.find);
    notFound++;
    return;
  }
  if (SRC.split(mu.find).length > 2) {
    console.log(label + '\n    AMBIGUOUS — that text appears more than once; ' +
                'mutation skipped rather than guessed at.');
    notFound++;
    return;
  }

  var r = runSuiteAgainst(SRC.replace(mu.find, mu.repl));
  if (r.died && mu.equivalent) {
    survived++;   /* counted as a problem, because it is one */
    holes.push({ name: mu.name + ' (EQUIVALENT MUTANT KILLED)',
                 means: 'this mutation changes nothing, so a test that goes ' +
                        'red for it is asserting something false. Find that ' +
                        'test and fix it.' });
    console.log(label + '\n    *** an EQUIVALENT mutant was killed — a test is lying. ***');
  } else if (r.died) {
    killed++;
    console.log(label + '\n    killed' +
                (r.crashed ? ' (the mutant crashed outright)'
                           : ' — ' + r.failed + ' test' + (r.failed === 1 ? '' : 's') + ' went red') +
                (r.firstFail ? '\n    first: ' + r.firstFail : ''));
  } else if (mu.equivalent) {
    equiv++;
    console.log(label + '\n    survived, as expected — equivalent mutant, not a hole.');
  } else {
    survived++;
    holes.push(mu);
    console.log(label + '\n    *** SURVIVED — the whole suite stayed green. ***');
    console.log('    ' + mu.means);
  }
});

cleanup();

console.log('\n' + '-'.repeat(64));
console.log(killed + ' killed, ' + survived + ' survived' +
            (equiv ? ', ' + equiv + ' equivalent (cannot be killed)' : '') +
            (notFound ? ', ' + notFound + ' could not be applied' : ''));

if (survived) {
  console.log('\nTHE HOLES — each of these is a way RIGOR could be wrong today:');
  holes.forEach(function (h) { console.log('  · ' + h.name + '\n      ' + h.means); });
}
if (notFound) {
  console.log('\nMutants that would not apply are failures of THIS file, not of the');
  console.log('core. They must be repointed at the moved code or deleted, or this');
  console.log('tool will quietly measure less and less over time.');
}
/* Exit non-zero on a hole OR on a stale mutant, because both mean the
   number printed above is smaller than it looks. */
process.exit((survived || notFound) ? 1 : 0);
