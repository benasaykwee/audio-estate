/* ===================================================================
   CORONER — the dependency preamble for cross-project gates
   tests/_requires.js

   WHY THIS EXISTS.

   Four of CORONER's six harnesses measure against NECROPHONE: they lift
   its real encoder, its real decoder, its real parameter registry and its
   real pitch detector out of its own source and run them unmodified. That
   is the right way to gate a seam, and it means those four cannot run
   where NECROPHONE is absent.

   NECROPHONE is deliberately absent from the estate repository. The root
   `.gitignore` is an allowlist, and its own comment explains why
   NECROPHONE's `build.yml` is excluded: its sources are scattered across
   the CLAUDE root and NECROPHONE-repo/, neither of which is in that
   repository, so committing the workflow "would add a job that could only
   ever fail."

   Measured on a simulated fresh clone, CORONER had exactly that shape:

       coroner_test.js           exit 0   173 passed
       tests/pluck_position.js   exit 0    20 passed
       tests/necrophone_pack.js  exit 1   necrophone.html not found
       tests/closed_loop.js      exit 1   necrophone_core.js not found
       tests/param_contract.js   exit 1   necrophone_core.js not found
       tests/root_detect.js      exit 1   necrophone.html not found

   So: a gate that cannot reach what it measures SKIPS rather than fails.

   ⚠ AND THE SKIP IS LOUD, WHICH IS THE WHOLE POINT.

   A silent skip is worse than a failure. It is the vacuous pass this
   project has caught four separate times — a parameter range nothing ever
   approached, a stiffness gate passing because the fit was poor, a
   detune body that never reproduced the confound, a text parser reading
   92 of 124 parameters and looking like it worked. Every one of those read
   as green while checking nothing.

   So this prints an unmistakable banner, NAMES what is now unverified, and
   exits 0 only after saying so. A reader of a green CI log is told exactly
   which four gates did not run and what that leaves uncovered.
   =================================================================== */

'use strict';

var fs = require('fs');
var path = require('path');

/* Call at the top of a gate, before any work.

     requires({
       name: 'the pack codec gate',
       files: [path.join(ROOT, 'necrophone.html')],
       gates: ['the corpse codec is byte-exact against NECROPHONE\'s own',
               'a CORONER pack is accepted by NECROPHONE\'s real decoder'],
       because: 'NECROPHONE is not in the estate repository, by design.'
     });

   Returns if everything is present. Prints the banner and exits 0 if not. */
function requires(spec) {
  var missing = (spec.files || []).filter(function (f) { return !fs.existsSync(f); });
  if (!missing.length) return;

  var line = '='.repeat(70);
  console.log('');
  console.log(line);
  console.log('  SKIPPED — ' + (spec.name || 'this gate') + ' did NOT run.');
  console.log(line);
  console.log('');
  console.log('  This is NOT a pass. Nothing below was checked.');
  console.log('');
  console.log('  Missing:');
  missing.forEach(function (f) { console.log('    · ' + path.relative(process.cwd(), f)); });
  if (spec.because) {
    console.log('');
    console.log('  Why: ' + spec.because);
  }
  if (spec.gates && spec.gates.length) {
    console.log('');
    console.log('  WHAT IS THEREFORE UNVERIFIED in this run:');
    spec.gates.forEach(function (g) { console.log('    · ' + g); });
  }
  console.log('');
  console.log('  To run it, work in a tree that has the whole CLAUDE folder,');
  console.log('  where NECROPHONE sits beside CORONER. All six harnesses pass');
  console.log('  there, and that is the run that counts before a release.');
  console.log('');
  console.log(line);
  console.log('');

  /* Exit 0 deliberately. A missing sibling project is not a CORONER fault
     and must not turn a CI board red — but the banner above means it
     cannot be mistaken for coverage either. */
  process.exit(0);
}

module.exports = { requires: requires };
