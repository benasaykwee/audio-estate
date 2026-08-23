/* PALLBEARER mutation tester — a test for the tests.
   ============================================================
   WHY THIS EXISTS. A gate audit on 2026-08-23 swept every harness on the
   property for the disease two rebuilt gates had the night before. The
   estate came out well: all four regression baselines hash rendered AUDIO,
   which is behaviour, and PALLBEARER's own CPU gate already calibrates
   like for like against one string of its own core. One hole was left.

   AUTOPSY has an audit harness. RIGOR has an audit and a mutation tester.
   CASKET has three. PALLBEARER had NONE, while carrying 13,335 parity
   checks and 251 assertions, the largest parity count of any instrument
   here. Not one of them had ever been shown to fail for the right reason.

   That is not a theoretical worry, and CASKET's own mutation harness says
   why in its header: CASKET once caught itself running a gate that passed
   22,848 checks VACUOUSLY, because the test buffers were 85 ms long while
   BS.1770 integrates over 400 ms. Three separate mutations survived before
   anybody noticed. Green is a statement about the ENGINE, never about the
   HARNESS, until something like this file has been run.

   HOW IT WORKS. Break the core on purpose, one small edit at a time, and
   demand pallbearer_test.js go red. A mutant that SURVIVES is the
   interesting result: it means that line of DSP could be wrong in exactly
   that way and every test in the building would still say the bass is fine.

   Mutations are written BY HAND. A generated mutant that fails to parse
   teaches nothing, and the edits worth making are the ones that mirror
   mistakes actually made in a physical model: a sign, a boundary, a
   constant, a short-circuit removed, an off-by-one on the neck.

   Usage:  node tests/pallbearer_mutate.js        run them all
           node tests/pallbearer_mutate.js 3      run just mutant 3
           node tests/pallbearer_mutate.js 4-7    run a range
           node tests/pallbearer_mutate.js --list name them without running

   The range form is not a convenience, it is the same concession CASKET
   makes: the witness takes real time, so a full pass can exceed the window
   some environments allow a single process. A tool that cannot be run in
   the place it lives does not get run.
   ============================================================ */
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
var CORE = path.join(ROOT, 'pallbearer_core.js');
var MUT_CORE = path.join(ROOT, 'pallbearer_core.__mut.js');
var SRC = fs.readFileSync(CORE, 'utf8');

/* Each entry names what breaks, the exact edit, and — the part that decides
   whether a mutant is worth having — what a SURVIVOR would mean. A mutation
   that cannot be given that sentence is not testing anything anybody cares
   about, and writing the sentence first is what stops this file filling up
   with edits that merely change a number. */
var MUTANTS = [

  { name: 'concert A moves to 441 Hz',
    find: 'return 440 * pow2((n - 69) / 12);',
    repl: 'return 441 * pow2((n - 69) / 12);',
    means: 'every note in the instrument would sit about 3.9 cents sharp. ' +
           'The suite PRINTS a worst-cents figure across the range, and a ' +
           'printed number that no assertion reads is decoration. If this ' +
           'survives, the tuning claim is a caption rather than a test.' },

  { name: 'the loop gain exceeds unity',
    find: 'return pow2(-10 / trips);',
    repl: 'return pow2(10 / trips);',
    means: 'every waveguide becomes an oscillator that grows without bound ' +
           'instead of a string that decays. This is the crudest possible ' +
           'break of a plucked model. If the suite cannot see it, nothing ' +
           'in it is actually listening to the output.' },

  { name: 'the short-decay floor halves',
    find: 'if (trips < 1) trips = 1;',
    repl: 'if (trips < 0.5) trips = 0.5;',
    means: 'the floor exists so a very short decay on a very low string ' +
           'cannot ask for a loop gain the waveguide will not survive. ' +
           'Halving it only bites at the extremes, which is exactly where ' +
           'a fuzz suite with realistic parameter ranges will never look. ' +
           'A survivor here means the boundary is untested, and every bug ' +
           'in this estate so far has lived on a boundary.' },

  { name: 'dispersion is a quarter stronger',
    find: 'return clamp(inharm * (0.25 + 0.75 * lowness), 0, 1) * 0.42;',
    repl: 'return clamp(inharm * (0.25 + 0.75 * lowness), 0, 1) * 0.52;',
    means: 'inharmonicity is what makes a bass string sound like a string ' +
           'rather than a sine. Every partial would land in the wrong place. ' +
           'The byte-stable baselines should catch this even if no named ' +
           'assertion does, so a survivor tells you the two are not both ' +
           'covering it and one of them is doing less than it appears.' },

  { name: 'harder playing gets darker',
    find: 'return -clamp(amount, 0, 1) * (clamp(vel, 0, 1) - 0.5) * 0.34;',
    repl: 'return clamp(amount, 0, 1) * (clamp(vel, 0, 1) - 0.5) * 0.34;',
    means: 'the velocity-to-brightness relationship inverts, so digging in ' +
           'would dull the note and playing softly would brighten it. That ' +
           'is backwards on every real instrument. A survivor means nothing ' +
           'asserts the DIRECTION of the map, only that it moves.' },

  { name: 'open strings lose their free pass',
    find: 'cost += c.fret === 0 ? 0 : Math.abs(move) * 1.0;',
    repl: 'cost += Math.abs(move) * 1.0;',
    means: 'the fingering brain would stop preferring an open string, and ' +
           'start fretting notes a bassist would always play open. The ' +
           'chosen string and fret change without any single sample looking ' +
           'obviously wrong, which is the hardest class of bug to notice ' +
           'by ear and the easiest to assert directly.' },

  { name: 'the brain re-plucks a ringing string',
    find: 'if (busy && busy[c.string]) cost += 6;',
    repl: 'if (busy && busy[c.string]) cost += 0;',
    means: 'the penalty for choosing a string that is still sounding is the ' +
           'whole reason this is a fingering BRAIN and not a lookup table. ' +
           'Remove it and phrases would choke their own sustain. If the ' +
           'suite stays green, no test plays a phrase and checks what it ' +
           'chose, only that individual notes come out.' },

  { name: 'the pickup comb sits an octave off',
    find: 'var f = k * f0 / (2 * pos);',
    repl: 'var f = k * f0 / pos;',
    means: 'every pickup null moves up an octave, so the comb filtering that ' +
           'gives a pickup position its character lands on the wrong ' +
           'partials. A survivor means pickupNulls() is exported, documented ' +
           'and never checked against a frequency anybody worked out by hand.' },

  { name: 'the top fret falls off the neck',
    find: 'if (fret >= 0 && fret <= frets) out.push({ string: s, fret: fret });',
    repl: 'if (fret >= 0 && fret < frets) out.push({ string: s, fret: fret });',
    means: 'the highest fret on every string becomes unreachable, so the ' +
           'top note of the range either moves to another string or stops ' +
           'sounding. Classic off-by-one on an inclusive bound. If nothing ' +
           'catches it, the range of the instrument is not being asserted ' +
           'at its edges, only in its comfortable middle.' },

  /* THE EQUIVALENT MUTANT. It must change nothing at all, and it is here to
     test the OTHER direction: not "can the suite see a break" but "does the
     suite assert something that is not true". Both operands are pure
     comparisons on locals with no side effects, so swapping the order of a
     short circuit is semantically identical in every input case including
     NaN, where both forms return 0.

     If this one is KILLED, do not celebrate. A test went red for a change
     that cannot alter behaviour, which means that test is asserting an
     implementation detail rather than a property, and it will go red again
     the next time somebody tidies a line. */
  { name: 'a short-circuit swaps its operands (changes nothing)',
    find: 'if (!(decaySec > 0) || !(f0 > 0)) return 0;',
    repl: 'if (!(f0 > 0) || !(decaySec > 0)) return 0;',
    equivalent: true,
    means: 'this mutation cannot change behaviour, so a test going red for ' +
           'it is asserting something false. Find that test.' },
];

function cleanup() {
  [MUT_CORE, MUT_TEST_ROOT, MUT_TEST_TESTS].forEach(function (f) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { /* best effort */ }
  });
}

/* THE WITNESS LADDER, and why it is a ladder rather than a single suite.

   Write the mutant core beside the real one, point a copy of each harness at
   it, and run that copy in a child process. Beside, not in a temp dir,
   because a harness resolves the core by relative path and moving either one
   would change what is being tested. Both scratch names are already covered
   by the estate .gitignore (*.__mut.* and .__mut_test.js).


   CASKET's mutation tester judges each mutant by ONE named suite, chosen
   per mutant. That is fine there. Here it produced a false result on the
   very first full run: three mutants were reported as holes when the
   question "did ANY harness notice" had never been asked. A harness that
   calls something a hole because it only looked in one place is committing
   the same error this whole audit was about.

   So a mutant is only a HOLE if every harness below stays green. When a
   later rung catches what the first missed, that is still worth printing,
   because it tells you the named-assertion suite is blind to something its
   siblings can see, and the named assertions are what a human reads.

   EACH RUNG'S COPY MUST KEEP ITS ORIGINAL __dirname, and the first draft of
   this file did not. It wrote every copy to the project root, which for a
   harness living in tests/ silently moved `path.join(__dirname, ...)` up one
   level. pallbearer_regression.js resolves its baseline that way, so it did
   not find one, and helpfully CREATED a fresh baseline from the MUTANT core.
   Every later rung then compared against a baseline built from broken code.

   The tell was a stray PALLBEARER/regression_baseline.json appearing beside
   the real one in tests/. Caught, and worth writing down: a harness that
   moves the code it is testing is not testing that code. */
var LADDER = [
  { file: 'pallbearer_test.js',          in: 'root',  label: 'the named assertions' },
  { file: 'pallbearer_regression.js',    in: 'tests', label: 'the byte-stable baselines' },
  { file: 'pallbearer_fuzz.js',          in: 'tests', label: 'the fuzzer' },
];
var MUT_TEST_ROOT = path.join(ROOT, '.__mut_test.js');
var MUT_TEST_TESTS = path.join(__dirname, '.__mut_test.js');

function runWitnessAgainst(mutantSrc) {
  fs.writeFileSync(MUT_CORE, mutantSrc);
  for (var i = 0; i < LADDER.length; i++) {
    var rung = LADDER[i];
    var atRoot = rung.in === 'root';
    var srcPath = atRoot ? path.join(ROOT, rung.file) : path.join(__dirname, rung.file);
    var dstPath = atRoot ? MUT_TEST_ROOT : MUT_TEST_TESTS;
    /* Copy stays in its own directory so __dirname is unchanged and every
       path.join(__dirname, ...) inside the harness still lands where the
       harness expects. Only the core require is redirected. */
    var src = fs.readFileSync(srcPath, 'utf8')
                .replace(/require\('(\.\.?\/)pallbearer_core\.js'\)/g,
                         "require('$1pallbearer_core.__mut.js')");
    fs.writeFileSync(dstPath, src);
    var r = cp.spawnSync(process.execPath, [dstPath],
                         { encoding: 'utf8', timeout: 300000, cwd: ROOT });
    var out = (r.stdout || '') + (r.stderr || '');
    var m = out.match(/(\d+) passed, (\d+) failed/);
    var died = r.status !== 0 || (m && +m[2] > 0);
    if (died) {
      return {
        died: true, rung: i, by: rung.label,
        crashed: !m && /\b(Error|SyntaxError|TypeError|ReferenceError)\b/.test(out),
        failed: m ? parseInt(m[2], 10) : -1,
        firstFail: (out.match(/[\u2717x\u2718] [^\n]*/) || [''])[0].slice(0, 76)
      };
    }
  }
  return { died: false };
}

if (process.argv.indexOf('--list') >= 0) {
  console.log('PALLBEARER mutants:\n');
  MUTANTS.forEach(function (m, i) {
    console.log('  ' + String(i).padStart(2, ' ') + '. ' + m.name +
                (m.equivalent ? '   [equivalent — expected to survive]' : ''));
  });
  process.exit(0);
}

var lo = 0, hi = MUTANTS.length - 1;
if (process.argv[2] && process.argv[2].indexOf('--') !== 0) {
  var mm = /^(\d+)(?:-(\d+))?$/.exec(process.argv[2]);
  if (!mm) {
    console.error('usage: node tests/pallbearer_mutate.js [n | n-m | --list]');
    process.exit(2);
  }
  lo = parseInt(mm[1], 10);
  hi = mm[2] === undefined ? lo : parseInt(mm[2], 10);
  if (lo > hi || lo < 0 || lo >= MUTANTS.length) {
    console.error('range ' + process.argv[2] + ' selects no mutants — there are ' +
                  MUTANTS.length + ', numbered 0 to ' + (MUTANTS.length - 1) + '.');
    process.exit(2);
  }
  if (hi >= MUTANTS.length) hi = MUTANTS.length - 1;
}

console.log('PALLBEARER mutation tester — witness is pallbearer_test.js\n');

var killed = 0, survived = 0, equiv = 0, notFound = 0, missedByNamed = 0, holes = [];

MUTANTS.forEach(function (mu, i) {
  if (i < lo || i > hi) return;
  var label = String(i).padStart(2, ' ') + '. ' + mu.name;

  /* A mutation that cannot be applied is NOT a pass. It means the core has
     moved and this mutant now tests nothing, which is the silent rot that
     turns a suite into decoration. Loud, and it fails the run. */
  if (SRC.indexOf(mu.find) < 0) {
    console.log(label + '\n    NOT APPLIED — the target line is gone from the core.');
    console.log('    looked for: ' + mu.find);
    notFound++; return;
  }
  if (SRC.split(mu.find).length > 2) {
    console.log(label + '\n    AMBIGUOUS — that text appears more than once; ' +
                'skipped rather than guessed at.');
    notFound++; return;
  }

  var r = runWitnessAgainst(SRC.replace(mu.find, mu.repl));

  if (r.died && mu.equivalent) {
    survived++;
    holes.push({ name: mu.name + ' (EQUIVALENT MUTANT KILLED)',
                 means: 'this mutation changes nothing, so a test going red for ' +
                        'it is asserting something false. Find that test.' });
    console.log(label + '\n    *** an EQUIVALENT mutant was killed — a test is lying. ***');
  } else if (r.died) {
    killed++;
    console.log(label + '\n    killed by ' + r.by +
      (r.crashed ? ' (the mutant crashed outright)'
                 : (r.failed >= 0 ? ' — ' + r.failed + ' assertion' +
                    (r.failed === 1 ? '' : 's') + ' went red' : '')) +
      (r.firstFail ? '\n    first: ' + r.firstFail : ''));
    /* Caught, but NOT by the suite a human reads. Worth saying out loud:
       the named assertions are blind to something their siblings can see. */
    if (r.rung > 0) {
      missedByNamed++;
      console.log('    NOTE: the named assertions stayed green. Only ' + r.by +
                  ' noticed, and nobody reads a hash for pleasure.');
    }
  } else if (mu.equivalent) {
    equiv++;
    console.log(label + '\n    survived, as expected — equivalent mutant, not a hole.');
  } else {
    survived++; holes.push(mu);
    console.log(label + '\n    *** SURVIVED — the whole suite stayed green. ***');
    console.log('    ' + mu.means);
  }
});

cleanup();

console.log('\n[' + lo + '-' + hi + ']  ' + killed + ' killed, ' + survived + ' survived, ' +
            equiv + ' equivalent, ' + notFound + ' not applied');

if (missedByNamed) {
  console.log('\n' + missedByNamed + ' mutation(s) were caught ONLY by a baseline or the ' +
              'fuzzer, never by a named assertion. Those are not holes, but they are the ' +
              'places where a failure will arrive as a moved hash rather than a sentence, ' +
              'and a moved hash is the thing this estate has twice re-blessed by mistake.');
}
if (notFound) {
  console.log('\n' + notFound + ' mutation(s) could not be applied. The core has moved ' +
              'and those mutants are testing nothing — repair them or this suite is ' +
              'quietly smaller than it looks.');
}
if (holes.length) {
  console.log('\nHOLES:');
  holes.forEach(function (h) { console.log('  · ' + h.name + '\n    ' + h.means); });
  process.exit(1);
}
if (notFound) process.exit(1);
console.log('\nevery deliberate break was caught. the suite is worth what it claims.');
