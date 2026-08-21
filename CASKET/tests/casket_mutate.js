/* CASKET mutation tester — a test for the tests.
   ============================================================
   Every harness in this project is green. That is a statement about the
   ENGINE, not about the harness. CASKET has 534 assertions and 22,861
   parity checks and not one of them has ever been shown to fail for the
   right reason — and this project has already caught itself running a gate
   that passed 22,848 checks VACUOUSLY, because the test buffers were 85 ms
   long and BS.1770 integrates over 400 ms. Three separate mutations passed
   before anybody noticed.

   So: break the core on purpose, one small edit at a time, and demand the
   suite go red. A mutant that SURVIVES is the interesting result. It means
   that line of DSP could be wrong in exactly that way and every test in the
   building would still say the box holds.

   Mutations are written by hand, not generated. A generated mutant that
   fails to parse teaches nothing, and the edits worth making are the ones
   that mirror mistakes actually made here: an operator boundary, a sign, an
   order of operations, a short-circuit removed.

   Usage:  node tests/casket_mutate.js       run them all
           node tests/casket_mutate.js 3     run just mutant 3
           node tests/casket_mutate.js 4-7   run a range

   The range form is not a convenience. The witness harness takes about a
   minute, so a full pass is ten-plus minutes and exceeds the window some
   environments allow a single process — including the one this was written
   in. A tool that cannot be run in the place it lives does not get run.
   ============================================================ */
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
var CORE = path.join(ROOT, 'casket_core.js');
var MUT_CORE = path.join(ROOT, 'casket_core.__mut.js');
var MUT_TEST = path.join(__dirname, '.__mut_test.js');
var SRC = fs.readFileSync(CORE, 'utf8');

/* Each entry names what breaks, the exact edit, and — the part that decides
   whether a mutant is worth having — what a SURVIVOR would mean. A mutation
   that cannot be given that sentence is not testing anything anybody cares
   about. */
var MUTANTS = [

  { name: 'channel link follows the smaller reduction',
    find: 'var mn = gl < gr2 ? gl : gr2;',
    repl: 'var mn = gl > gr2 ? gl : gr2;',
    means: 'linked stereo would take the LESSER of the two gain reductions, ' +
           'so the louder channel would be permitted straight through the ' +
           'lid. This breaks the one absolute guarantee CASKET makes.' },

  { name: 'branch 0 reads one sample off',
    find: 'var z = hp - 1 - OS_Q; if (z < 0) z += histN;',
    repl: 'var z = hp - OS_Q; if (z < 0) z += histN;',
    means: 'branch 0 of the oversampler is a pure delay by construction, and ' +
           'it is where the TRUE unfiltered sample comes from. Off by one and ' +
           'the detector watches the wrong sample while latencySamples() ' +
           'keeps reporting the old figure. The null test exists for this.' },

  { name: 'the safety clamp lets one ulp through',
    find: 'yl = yl < 0 ? -lidLin : lidLin;',
    repl: 'yl = yl < 0 ? -lidLin * (1 + 1e-15) : lidLin * (1 + 1e-15);',
    means: 'the guarantee is stated with ZERO epsilon — no output sample ' +
           'exceeds the lid, ever. A test written with a tolerance instead of ' +
           'an exact comparison would not see this, and the whole claim would ' +
           'quietly become "very nearly".' },

  { name: 'reported latency drops its +1',
    find: 'return OS_Q + vigilSamples(st, fs) + 1 + (st.seal ? DEC_Q : 0);',
    repl: 'return OS_Q + vigilSamples(st, fs) + (st.seal ? DEC_Q : 0);',
    means: 'the host would compensate by one sample less than the real delay. ' +
           'A plugin whose reported latency is a lie smears every parallel ' +
           'path in a session, and latency here is supposed to be a pure ' +
           'function shared by the browser, the harness and the plugin.' },

  { name: 'reported latency forgets the seal\'s decimator',
    find: 'return OS_Q + vigilSamples(st, fs) + 1 + (st.seal ? DEC_Q : 0);',
    repl: 'return OS_Q + vigilSamples(st, fs) + 1;',
    means: 'Lead is the sealed arrangement and would misreport by DEC_Q ' +
           'samples while the other four stayed correct — a bug that only ' +
           'appears on one preset, which is the kind that ships.' },

  { name: 'the smoother outgrows the vigil',
    find: 'var B = Math.floor(span / 2) + 1;',
    repl: 'var B = Math.floor(span / 2) + 2;',
    means: 'the overshoot proof requires the triangular smoother\'s support ' +
           'to lie within [0, L]. Widen it and the theorem\'s hypothesis is ' +
           'false, so the guarantee stops being proven and becomes a hope ' +
           'that happens to hold on the material we tried.' },

  /* THIRD EQUIVALENT MUTANT — and the one that taught the most, because it
     survived four separate attempts to kill it and each attempt was wrong
     about why.

     The theory was that `advance()`'s snap is what lets the gain arrive at
     exactly unity, so loosening it to 1e-30 would leave the engine forever
     a hair below transparent. Measured instead:

       · a bounded-residue test could not see it — an envelope stuck at
         1e-18 dB is comfortably inside any sane relative bound;
       · a bit-exactness test on pine and oak could not see it either;
       · a time-to-exact sweep found both versions transparent again within
         0.25 s, which was the attempt that finally explained it.

     The snap is not what produces exactness. Two other things do, and they
     do it first. `ND.dbToLin` returns EXACTLY 1.0 for any magnitude below
     4.82e-16 dB, so the last fraction of a dB rounds away on its own; and
     the sliding minimum emits exact zero as soon as its window holds only
     zeros, which for a 1 ms vigil is a millisecond after the signal stops.
     The snap is belt and braces behind both.

     Kept, marked, and pinned by casket_test.js §5a-v, because "defensive
     code that is currently unreachable" is one shared-module change away
     from being load-bearing again. */
  { name: 'the release snap loosened to 1e-30', equivalent: true,
    find: 'if (gr === 0 && n > -1e-12) return 0;',
    repl: 'if (gr === 0 && n > -1e-30) return 0;',
    means: 'nothing observable. dbToLin rounds to exactly 1.0 below 4.82e-16 dB ' +
           'and the sliding minimum emits exact zero within one vigil, so both ' +
           'reach transparency inside 0.25 s. Expected to survive.' },

  /* SECOND EQUIVALENT MUTANT, and it did not look like one.
     This reads exactly like the LAW 5 bugs — a legal value that is also a
     boundary value, taking the wrong branch. It survived, and the first
     instinct was to call it a hole and write a boundary test.
     Measured instead: `ND.kneeGain` returns EXACTLY zero at the knee start
     for every knee/threshold pair tried, so both spellings compute the same
     number and the guard is a speed optimisation, not a correctness one.
     Kept because the equivalence is a property of ND, which is shared and
     could change — casket_test.js §5a-iv now pins kneeGain's exact zero, so
     the equivalence is guaranteed rather than lucky. If that assertion ever
     goes, this mutant becomes a real hole again and will say so. */
  { name: 'the knee boundary flips to strict', equivalent: true,
    find: 'if (a <= kneeStartLin) return 0;',
    repl: 'if (a < kneeStartLin) return 0;',
    means: 'nothing, because kneeGain is exactly zero at the knee start — ' +
           'pinned by casket_test.js §5a-iv. Expected to survive.' },

  { name: 'M/S stops short-circuiting at unity',
    find: 'if (msOn && !(msMidLin === 1 && msSideLin === 1)) {',
    repl: 'if (msOn) {',
    means: 'the encode/decode round trip is NOT bit-exact — fl(L+R) and ' +
           'fl(L−R) each round — so merely ARMING mid/side with nothing ' +
           'dialled in would cost a bit. The null test would then depend on ' +
           'the position of a checkbox, which is the same class of defect as ' +
           'a bypass that is not a bypass.' },

  { name: 'the bypass line stops being fed',
    find: 'var byl = bypL.push(xl), byr = bypR.push(xr);',
    repl: 'var byl = st.bypass ? bypL.push(xl) : xl, byr = st.bypass ? bypR.push(xr) : xr;',
    means: 'this is the round-5 bug, restored. The delay line would hold ' +
           'stale samples across a toggle, so leaving bypass would emit the ' +
           'audio from before you pressed it. RIGOR shipped the same defect ' +
           'and its second half was a burst of digital silence.' },

  { name: 'quantize switches to the divide-by-grid spelling',
    find: 'return Math.round(x * inv) / inv;',
    repl: 'return Math.round(x / g) * g;',
    means: 'the two spellings disagree at exact halves — 0.35 rounds to 0.3 ' +
           'one way and 0.4 the other — and bisection midpoints over a dB ' +
           'range land on exact halves constantly. §7 records that while this ' +
           'was inline the parity gate could not see the difference at all.' },

  /* EQUIVALENT MUTANT — deliberate, and marked.
     Multiplying by exactly 1.0 is bit-exact in IEEE, so removing the guard
     produces the same program. It stays in the list because a surviving
     mutant has two possible meanings and the FIRST thing to check is whether
     the mutation was a real change at all. If the suite ever kills this one,
     a test is asserting something false. */
  { name: 'drive applied unconditionally', equivalent: true,
    find: 'if (driveLin !== 1) { xl *= driveLin; xr *= driveLin; }',
    repl: 'xl *= driveLin; xr *= driveLin;',
    means: 'nothing — multiplying by exactly 1.0 is bit-exact, so this mutant ' +
           'IS the original program. Expected to survive.' },

  /* THE FIRST MUTANT JUDGED BY A DIFFERENT HARNESS — added 2026-08-18.
     Until now every mutant was tried before casket_test.js alone, which
     means the whole exercise only ever measured ONE harness's teeth. A
     mutation in album/batch territory would sail past casket_test.js —
     not because the suite is weak but because that suite does not watch
     that code — and be reported as a hole that is really a wrong courtroom.
     `suite` sends a mutant to the harness that owns its territory. */
  { name: 'gapless forgets to force continuous dither', suite: 'casket_album.js',
    find: "if (gapless) policy = 'continuous';",
    repl: "/* mutant: interlock removed */",
    means: 'the gapless/dither interlock is decoration — a seamless record ' +
           'would carry a dither restart at every join, in the one layer ' +
           'nobody checks by ear, and no test would say so.' },

  /* THE ALBUM SUITE'S TWO MARQUEE CLAIMS, each given a mutant 2026-08-19.
     Both are things CASKET says about itself in prose — in the README, in
     MASTERING §10 — and a claim a program makes about its own behaviour
     deserves a test that would notice it becoming false. */
  { name: 'the album figure becomes the arithmetic mean', suite: 'casket_album.js',
    find: 'var m = meterBuffer(aL, aR, fs);',
    repl: 'var m = { integrated: rendered.reduce(function (a, t) { ' +
          'return a + meterBuffer(t.L, t.R, fs).integrated; }, 0) / rendered.length, ' +
          'lra: meterBuffer(aL, aR, fs).lra, truePeakDb: meterBuffer(aL, aR, fs).truePeakDb };',
    means: 'THE headline claim of §10 is unguarded — "it is NOT the mean of ' +
           'the per-track figures", measured at −6.51 vs −10.56 on the test ' +
           'record. Averaging logarithms is the exact mistake the section ' +
           'exists to warn against, and it would ship silently.' },

  { name: 'album mode masters each track to its own drive', suite: 'casket_album.js',
    find: 'var b = batchRender(st, tracks, fs, bopts);\n      /* gapless already metered',
    repl: 'var b = batchRender(st, tracks, fs, bopts);\n      ' +
          'b.tracks.forEach(function (t, i) { var s2 = sanitizeState(state); ' +
          's2.drive = d + i * 0.75; s2.unity = false; ' +
          'var one = renderOffline(s2, tracks[i].L, tracks[i].R, fs); ' +
          't.L = one.L; t.R = one.R; });\n      /* gapless already metered',
    /* WHAT KILLED IT WAS NOT WHAT I PREDICTED, and the difference is worth
       recording. The obvious guard for "one drive per record" is the spread
       assertion — and it stayed GREEN. What went red was "the album figure
       is MEASURED at the drive returned" plus "it is the WHOLE record that
       was measured". The reason: this mutant rewrites each track's AUDIO
       after the search but leaves the reported per-track `lufs` untouched,
       so the spread still reads as preserved while the delivered audio no
       longer matches any of it.
       That is a better kill than the one I was aiming for. It means the
       suite's real guarantee here is not "the spread looks right" — a
       number can look right about audio it no longer describes — but
       "every figure reported was measured on the audio you are getting".
       Kept exactly as written, mismatched prediction and all, because the
       verdict is more useful than my guess was. */
    means: 'ONE DRIVE FOR THE WHOLE RECORD is the entire premise of album ' +
           'mode — "not one per track", because normalising each song ' +
           'equally is the same as saying the quiet song is no longer the ' +
           'quiet song. Killed by the measured-not-predicted assertions ' +
           'rather than the spread one; see the note above.' },

  /* THE RANGE's ARITHMETIC — added 2026-08-19, and worth being precise
     about what these can and cannot reach. The audio/UI SEAM itself is C++
     (Handoff, foldTrace, the throttle) and this tester only mutates
     casket_core.js, so the seam's own machinery is covered by
     tests/handoff_stress.cpp and the static gates in casket_plugin_test.js
     instead. What IS reachable from here is the rule the seam carries: the
     EBU Tech 3342 gate and percentiles that both faces now compute through
     one shortTermStats(), and that the parity gate compares bin for bin.
     Both constants below are SPEC values. Getting either wrong produces a
     plausible number, a plausible-looking chart, and a published figure
     that is quietly not loudness range at all. */
  { name: 'the LRA relative gate becomes the integrated one (-20 → -10)',
    suite: 'casket_conformance.js',
    find: 'var gate = loudnessOf(sum / cnt) - 20;',
    repl: 'var gate = loudnessOf(sum / cnt) - 10;',
    means: 'EBU 3342 gates loudness range 20 LU below the mean; BS.1770 gates ' +
           'INTEGRATED loudness at 10. They are different numbers for different ' +
           'measurements and the doc calls the distinction out. Confusing them ' +
           'throws away quiet material that belongs in the range, and the answer ' +
           'stays entirely believable.' },

  { name: 'the LRA percentiles widen to min/max (10th/95th → 0th/100th)',
    suite: 'casket_conformance.js',
    find: 'var lo = kept * 0.10, hi = kept * 0.95;',
    repl: 'var lo = kept * 0.00, hi = kept * 1.00;',
    means: 'the 10th/95th percentiles are what stop one loud stab or one silent ' +
           'bar from defining a whole record\'s range — the README says so in as ' +
           'many words. Min-to-max is the naive reading of "range" and would ' +
           'inflate the figure on exactly the material people care about.' }
];

/* The suite run against a mutant. casket_test.js is the guarantee, the null
   test, BS.1770 and latency — the four properties every mutation above is
   aimed at. Running the whole battery per mutant would cost ten minutes each
   and would not change a single verdict.

   WHERE THE COST ACTUALLY IS — profiled 2026-08-18, because this file pays
   casket_test.js's runtime twelve times over and nobody had ever asked.
   52 s total, and it is NOT evenly spread: "the offline tools" section is
   26.0 s (49.8%) by itself — autoDrive/autoMargin/matchReference each
   render full audio repeatedly — with "every rate" next at 7.4 s (14.2%)
   and everything else in single digits. So a 12-mutant sweep spends about
   five of its ten minutes re-proving offline-tools behaviour for mutants
   aimed at the gain path. The OBVIOUS fix — skip that section for
   non-tools mutants — is deliberately not taken: a mutant's kill can come
   from an unexpected direction (several here die first in the smoother-
   residue check, nowhere near their target), and trimming the courtroom
   to the expected witnesses is how a suite stops being worth what it
   claims. If this ever needs to be faster, speed up the section itself
   (fewer autoDrive passes on a shorter buffer would keep every assertion),
   not the sweep. */
function runSuiteAgainst(mutantSrc, suite) {
  fs.writeFileSync(MUT_CORE, mutantSrc);
  var t = fs.readFileSync(path.join(__dirname, suite || 'casket_test.js'), 'utf8')
            .replace(/require\('\.\.\/casket_core\.js'\)/g, "require('../casket_core.__mut.js')");
  fs.writeFileSync(MUT_TEST, t);
  var r = cp.spawnSync(process.execPath, [MUT_TEST],
                       { encoding: 'utf8', timeout: 180000, cwd: ROOT });
  var out = (r.stdout || '') + (r.stderr || '');
  var m = out.match(/(\d+) passed, (\d+) failed/);
  return {
    died: r.status !== 0 || (m && +m[2] > 0),
    crashed: !m,
    failed: m ? parseInt(m[2], 10) : -1,
    firstFail: (out.match(/[✗x] [^\n]*/) || [''])[0].slice(0, 76)
  };
}

function cleanup() {
  [MUT_CORE, MUT_TEST].forEach(function (f) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { /* best effort */ }
  });
}

/* --list — added 2026-08-19. Thirteen mutants with jurisdictions and
   expectations is past the point where reading the array is the fastest
   way to answer "what does this cover, and who judges it?". Also the
   quickest way to spot a mutant whose target line has drifted out of the
   core: NOT APPLIED shows up here in a second instead of after a
   ten-minute sweep. */
if (process.argv.indexOf('--list') >= 0) {
  console.log('CASKET mutants — ' + MUTANTS.length + ' deliberate breaks\n');
  console.log('  #   applies  judged by            expectation   name');
  MUTANTS.forEach(function (mu, i) {
    var n = SRC.split(mu.find).length - 1;
    var applies = n === 1 ? 'yes' : (n === 0 ? 'GONE' : 'AMBIG');
    console.log('  ' + String(i).padStart(2, ' ') + '  ' +
                applies.padEnd(8) + ' ' +
                (mu.suite || 'casket_test.js').padEnd(20) + ' ' +
                (mu.equivalent ? 'survives' : 'dies').padEnd(13) + ' ' +
                mu.name);
  });
  var broken = MUTANTS.filter(function (mu) { return SRC.split(mu.find).length - 1 !== 1; });
  console.log('\n' + (MUTANTS.length - broken.length) + ' of ' + MUTANTS.length +
              ' still find their target line in the core.');
  if (broken.length) {
    console.log('GONE/AMBIG means the mutant tests nothing — the core moved under it:');
    broken.forEach(function (mu) { console.log('  · ' + mu.name + '\n      looked for: ' + mu.find); });
  }
  console.log('\nrun a subset:  node tests/casket_mutate.js N   or   N-M');
  process.exit(broken.length ? 1 : 0);
}

var lo = 0, hi = MUTANTS.length - 1;
if (process.argv[2]) {
  var m = /^(\d+)(?:-(\d+))?$/.exec(process.argv[2]);
  if (!m) { console.error('argument must be N or N-M'); process.exit(2); }
  lo = +m[1]; hi = m[2] === undefined ? lo : +m[2];
  if (hi >= MUTANTS.length) hi = MUTANTS.length - 1;
  /* AN EMPTY RANGE IS NOT A PASS — added 2026-08-18. `node tests/casket_mutate.js 12`
     on a 12-mutant file (valid indices 0–11) clamped hi to 11, left lo at 12,
     selected nothing, and still printed "every deliberate break was caught."
     A run that exercised zero mutants reporting the same success line as a
     full sweep is the worst kind of green: it is indistinguishable, in a CI
     log or over a shoulder, from the real thing. Same shape as the partial-run
     problem in casket_tools_fuzz.js's time budget — say what did not happen. */
  if (lo > hi) {
    console.error('range ' + process.argv[2] + ' selects no mutants — ' +
                  'valid indices are 0-' + (MUTANTS.length - 1) + '.');
    process.exit(2);
  }
}
console.log('CASKET mutation tester — breaking the box on purpose\n');
console.log('A mutant that DIES means the suite would have caught that bug.');
console.log('A mutant that SURVIVES is a hole, and is reported as one.\n');

var killed = 0, survived = 0, notFound = 0, equiv = 0, holes = [];

MUTANTS.forEach(function (mu, i) {
  if (i < lo || i > hi) return;
  var label = String(i).padStart(2, ' ') + '. ' + mu.name;

  /* A mutation that cannot be applied is NOT a pass. It means the core moved
     and this mutant now tests nothing — the silent rot that turns a suite
     into decoration. */
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

  if (mu.suite) label += '  [judged by ' + mu.suite + ']';
  var r = runSuiteAgainst(SRC.replace(mu.find, mu.repl), mu.suite);

  if (r.died && mu.equivalent) {
    survived++;
    holes.push({ name: mu.name + ' (EQUIVALENT MUTANT KILLED)',
                 means: 'this mutation changes nothing, so a test going red for ' +
                        'it is asserting something false. Find that test.' });
    console.log(label + '\n    *** an EQUIVALENT mutant was killed — a test is lying. ***');
  } else if (r.died) {
    killed++;
    console.log(label + '\n    killed' +
      (r.crashed ? ' (the mutant crashed outright)'
                 : ' — ' + r.failed + ' assertion' + (r.failed === 1 ? '' : 's') + ' went red') +
      (r.firstFail && !r.crashed ? '\n    first: ' + r.firstFail : ''));
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

if (notFound) {
  console.log('\n' + notFound + ' mutation(s) could not be applied. The core has moved ' +
              'and those mutants are testing nothing — repair them or the suite is ' +
              'quietly smaller than it looks.');
}
if (holes.length) {
  console.log('\nHOLES:');
  holes.forEach(function (h) { console.log('  · ' + h.name + '\n    ' + h.means); });
  process.exit(1);
}
if (notFound) process.exit(1);
console.log('\nevery deliberate break was caught. the suite is worth what it claims.');
