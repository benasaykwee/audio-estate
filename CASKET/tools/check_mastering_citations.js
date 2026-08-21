/* MASTERING_WITH_CASKET.md citation checker — added 2026-08-18, rebuilt same day
   after its first pass turned out to miss half the citations and mis-score
   the other half. node tools/check_mastering_citations.js

   That document's own stated policy: "Everything here is a measured claim.
   Where a number appears, the harness that produced it is named, so you can
   check rather than trust." Good discipline — but nothing before this
   script ever actually DID the checking. A citation is not evidence until
   something re-runs it.

   WHAT THIS DOES: finds every backtick-quoted `casket_X.js` mention (with or
   without a `tests/` prefix, with or without surrounding parens — the doc is
   not consistent about either), gathers the numbers in its immediate
   vicinity, runs that harness fresh (once per file even if cited several
   times), and checks whether each cited number still shows up in the
   harness's own current output — not by exact string match, but by rounding
   every number the harness prints to the same precision as the doc's number
   and comparing. That single change is why this rewrite exists: a first
   version used plain substring matching, and it went wrong in both
   directions on real citations in this very doc — "2.59" failed to credit
   against a harness that now prints the more precise "2.592" would have been
   fine (2.59 IS a substring of 2.592), but "7.6" against a harness printing
   "7.56" is NOT a substring match even though 7.56 rounds to exactly 7.6.
   Round-and-compare catches both; substring only catches one.

   WHERE THE NUMBERS COME FROM: the block of text immediately before, the
   block containing, and the block immediately after the citation itself
   (blocks = paragraphs/tables split on a blank line). Checked against this
   doc's real citations: some name their number in the same sentence
   (`casket_rate.js`, `casket_dither.js`, `casket_conformance.js`), some cite
   a table that FOLLOWS the citation (`casket_seal_margin.js`), and one cites
   a table that PRECEDES it (the cost-ratio table before `casket_cpu_gate.js`
   in §2). One block each side covers all of them without pulling in the
   next section's unrelated numbers.

   Numbers with a decimal point are preferred over bare integers, because
   that is how this doc distinguishes a measured claim (2.59, −96.2, ×3.7)
   from incidental context (24-bit, a −23 LUFS test tone, 16× oversampling).
   If a citation's window has no decimal number at all — e.g. §4's "it costs
   about **ten renders**", spelled as a word, not a digit — there is nothing
   to check, and this says so explicitly rather than either inventing a
   false pass or a false "STALE."

   Still deliberately permissive, not a structured re-derivation: a number
   that moved from a table into a different shape of sentence could still
   slip past both this version and the last one. A miss here is a prompt to
   go read the doc and the harness side by side, same spirit as
   casket_coverage.js's own caveat — a red row is a question, not a verdict
   on its own.

   WHAT IT COSTS, measured 2026-08-19 after it widened from one document to
   four: about three minutes, because it runs seven real harnesses and two
   of them are slow by design (casket_cpu_gate ~64 s is a wall-clock
   benchmark; casket_album ~43 s masters a record several times; casket_test
   ~52 s is the whole core suite, pulled in when the README's residual table
   started citing it). Each harness runs ONCE however many times it is
   cited — that cache is the only reason this is three minutes rather than
   ten.
   That cost is why this belongs in the nightly and not the push path. It is
   also why it exits 0 regardless of verdict: a doc figure going stale is
   worth a line in a log, not a red build three minutes after the code was
   already proven green by the same harnesses running standalone. */
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..'); // this file lives in CASKET/tools/ — ROOT is CASKET/ itself
var DOC = path.join(ROOT, 'MASTERING_WITH_CASKET.md');

/* every backtick-quoted casket_*.js mention, tests/ prefix optional, parens
   optional (the doc uses both shapes and this checker should not care) */
var CITE = /`(?:tests\/)?(casket_[A-Za-z0-9_]+\.js)`/g;
var NUMBER = /[−-]?\d[\d,]*(?:\.\d+)?/g;

function norm(s) { return s.replace(/−/g, '-').replace(/,/g, ''); }
function decimalPlaces(s) { var i = s.indexOf('.'); return i === -1 ? 0 : (s.length - i - 1); }

/* split a document into blocks on blank lines, remembering each block's start
   offset so a citation's byte index can be mapped back to "which block" */
function blocksOf(text) {
  var blocks = [], pos = 0;
  text.split(/\n\s*\n/).forEach(function (b) {
    var start = text.indexOf(b, pos);
    blocks.push({ start: start, end: start + b.length, text: b });
    pos = start + b.length;
  });
  return blocks;
}
/* Sentence boundaries within the citation's OWN block only — a "." or "!" or
   "?" followed by whitespace. The before/after blocks stay whole (tables and
   short paragraphs are one atomic citable unit), but a citation's own block
   is sometimes a multi-sentence paragraph carrying a SECOND, unrelated claim
   with its own number — §7 cites casket_conformance.js for its 4×/8×/16×
   dB figures, then the very next sentence in the same paragraph quotes a
   *different* harness's CPU ratio (×10.7 versus ×3.7). Whole-block matching
   attributed that ratio to conformance.js and reported it "stale" — it
   isn't stale, it's just not conformance.js's number. Same story in §9,
   where the sentence after the dither citation recounts a fixed HISTORICAL
   bug's 0.005 dB, and in §11, where the sentence before the rate citation
   describes the test setup (a file "played at 2.18× speed") rather than the
   measured result. Scoping down to just the sentence touching the citation
   fixed all three without needing to touch the before/after table cases. */
function sentenceAround(blockText, localIdx) {
  var bounds = [0], re = /[.!?]\s+/g, mm;
  while ((mm = re.exec(blockText))) bounds.push(mm.index + mm[0].length);
  bounds.push(blockText.length);
  for (var k = 0; k < bounds.length - 1; k++) {
    if (localIdx >= bounds[k] && localIdx < bounds[k + 1]) return blockText.slice(bounds[k], bounds[k + 1]);
  }
  return blockText;
}
/* An adjacent block is only pulled in whole when it is a markdown table
   (leading `|`) — §2 and §3 each cite a harness for a table one block away
   and need the whole thing. An adjacent PROSE block is skipped rather than
   included, because §9 showed the opposite failure: the paragraph right
   after the dither citation goes on to recount an already-fixed historical
   bug ("...12 of the first 400 fuzz states exceeded the lid by 0.005 dB"),
   and that number got credited to the dither citation even after sentence-
   scoping the citation's own block, since it lives one block further out. */
function isTable(blockText) { return /^\s*\|/.test(blockText); }
function blockWindow(blocks, idx, useTables) {
  var i = 0;
  while (i < blocks.length && !(idx >= blocks[i].start && idx <= blocks[i].end)) i++;
  if (i >= blocks.length) return '';
  var take = useTables !== false;
  var before = (take && i > 0 && isTable(blocks[i - 1].text)) ? blocks[i - 1].text : '';
  var after = (take && i < blocks.length - 1 && isTable(blocks[i + 1].text)) ? blocks[i + 1].text : '';
  var here = sentenceAround(blocks[i].text, idx - blocks[i].start);
  return before + '\n\n' + here + '\n\n' + after;
}

/* THE WHOLE EXTRACTION, as one pure function of the document text —
   refactored out 2026-08-18 so `--self-test` can drive it with synthetic
   markdown. Every rule above (paren-optional citations, sentence scoping,
   tables-only adjacency, decimals-over-integers) was derived from ONE
   document by trial and error, and rules derived that way tend to encode
   accidents of that document's prose. A fixture set is how they stop being
   accidents: change the doc's writing style and the self-test still says
   whether the extractor's rules survived it. */
function extractCitations(text, useTables) {
  var blocks = blocksOf(text);
  var citations = [], m;
  CITE.lastIndex = 0;                       // module-level regex with /g — reset or the second call starts mid-string
  while ((m = CITE.exec(text))) {
    var window = blockWindow(blocks, m.index, useTables);
    var all = window.match(NUMBER) || [];
    /* integers-only windows are treated as "nothing citable" — see the header */
    var candidates = all.filter(function (n) { return n.indexOf('.') >= 0; });
    /* de-dupe while keeping the doc's own text (not the normalised form), so
       what prints matches what a human sees on the page */
    var seen = {};
    candidates = candidates.filter(function (n) {
      var k = norm(n);
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
    citations.push({ file: m[1], nums: candidates, index: m.index });
  }
  return citations;
}

/* ---------------------------------------------------------------- self-test
   node tools/check_mastering_citations.js --self-test
   Runs in about a millisecond and touches no harness — it checks the
   EXTRACTOR, not the document. Every fixture below is a shape that actually
   appears in MASTERING_WITH_CASKET.md, plus the three near-misses that cost
   real debugging time on the way here. */
if (process.argv.indexOf('--self-test') >= 0) {
  var pass = 0, failn = 0;
  function t(name, cond) {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { failn++; console.log('  ✗ FAIL: ' + name); }
  }
  function nums(md) { var c = extractCitations(md); return c.length ? c[0].nums : null; }

  console.log('check_mastering_citations — self-test of the extractor\n');

  /* --- the citation shapes the doc actually uses --- */
  t('parens + tests/ prefix is found',
    extractCitations('Measured, **1.5 dB** of it (`tests/casket_x.js`).').length === 1);
  t('bare backticks with no parens is found — §2 and §7 are written this way',
    extractCitations('The ladder in `tests/casket_x.js` measures **1.5 dB**.').length === 1);
  t('no tests/ prefix is found — §4 is written this way',
    extractCitations('It costs **1.5 dB** (`casket_x.js`), so go slowly.').length === 1);
  t('a file cited twice yields two citations',
    extractCitations('One **1.5** (`tests/casket_x.js`).\n\nTwo **2.5** (`tests/casket_x.js`).').length === 2);
  t('prose with no citation yields nothing',
    extractCitations('A paragraph about **2.59 LU** of nothing in particular.').length === 0);

  /* --- which numbers come along --- */
  t('a decimal in the citing sentence is picked up',
    JSON.stringify(nums('Measured at **2.59 LU** of error (`tests/casket_x.js`).')) === '["2.59"]');
  t('a negative/minus-sign decimal survives as written',
    JSON.stringify(nums('It sits at **−144.4 dB** (`tests/casket_x.js`).')) === '["−144.4"]');
  t('a table AFTER the citation is included — §3 cites forward',
    JSON.stringify(nums('How much? Measured (`tests/casket_x.js`):\n\n| a | b |\n|---|---|\n| x | 0.837 |')) === '["0.837"]');
  t('a table BEFORE the citation is included — §2 cites backward',
    JSON.stringify(nums('| a | b |\n|---|---|\n| x | 3.7 |\n\nThose ratios come from `tests/casket_x.js` on one machine.')) === '["3.7"]');

  /* --- the three near-misses, each of which shipped a wrong verdict once --- */
  t('a SECOND sentence in the same block is NOT credited (the §7 CPU-ratio bug)',
    JSON.stringify(nums('The ladder reads **1.9143 dB** (`tests/casket_x.js`). ' +
                        'Sixteen times buys a hundredth for **10.7** times the CPU.')) === '["1.9143"]');
  t('an adjacent PROSE block is NOT credited (the §9 historical-bug case)',
    JSON.stringify(nums('Measured at **−96.2 dB**\n(`tests/casket_x.js`).\n\n' +
                        'An older version was wrong: 12 states exceeded the lid by 0.005 dB.')) === '["−96.2"]');
  t('the preceding sentence describing SETUP is not credited (the §11 2.18x case)',
    JSON.stringify(nums('Metering it wrong reports a file played at 2.18x speed. ' +
                        'Measured, that is **2.59 LU** (`tests/casket_x.js`).')) === '["2.59"]');

  /* --- integers, and the honest "cannot check this" answer --- */
  t('an integers-only window reports NO numbers rather than guessing',
    JSON.stringify(nums('It costs about ten renders (`tests/casket_x.js`), so make tea.')) === '[]');
  t('bare integers next to a decimal are dropped, the decimal kept',
    JSON.stringify(nums('16-bit shaped sits at **−144.4 dB** (`tests/casket_x.js`).')) === '["−144.4"]');
  t('a repeated number is de-duplicated',
    JSON.stringify(nums('Both **1.5** and **1.5** again (`tests/casket_x.js`).')) === '["1.5"]');

  /* --- the regex-state bug this refactor could have introduced --- */
  t('extractCitations is re-entrant (the /g lastIndex trap)',
    extractCitations('A **1.5** (`tests/casket_x.js`).').length === 1 &&
    extractCitations('A **1.5** (`tests/casket_x.js`).').length === 1);

  /* the per-document table rule */
  var withTable = 'See (`tests/casket_x.js`):\n\n| field | range |\n|---|---|\n| vigil | 0.1 to 20 |';
  t('tables:true pulls an adjacent table in (the mastering-doc convention)',
    JSON.stringify(extractCitations(withTable, true)[0].nums) === '["0.1"]');
  t('tables:false leaves schema tables alone (the CASE_FORMAT convention)',
    JSON.stringify(extractCitations(withTable, false)[0].nums) === '[]');
  t('and the default is still tables:true, so existing behaviour is unchanged',
    JSON.stringify(extractCitations(withTable)[0].nums) === '["0.1"]');

  console.log('\n' + pass + ' passed, ' + failn + ' failed');
  process.exit(failn ? 1 : 0);
}

/* EVERY DOCUMENT THAT CITES A HARNESS, not just the mastering one — widened
   2026-08-19. The tool was built for MASTERING_WITH_CASKET.md because that
   file states the policy ("where a number appears, the harness that produced
   it is named"), but the policy is the project's, not that file's. The
   README carries a residual table, and the docs/ pair quote figures from the
   same harnesses; none of it was checked, and the README's copy of that
   table turned out to be silently the 16× column while reading as the 4×
   default. A checker pointed at one document proves that document honest and
   says nothing about the ones beside it. */
/* `tables` says whether an adjacent markdown table is EVIDENCE for the
   citation beside it. In MASTERING_WITH_CASKET.md and the README it always
   is — those tables are measurements, and pulling them in is the whole
   reason the adjacency rule exists. In CASE_FORMAT.md it never is: its
   tables are SCHEMA, listing each field's legal range, so "vigil 0.1 to 20"
   sitting next to a citation of casket_coverage.js made the checker demand
   that 0.1 appear in a census's output. It never will; 0.1 is not a
   measurement, it is a boundary.
   A rule inferred from one document's conventions does not survive contact
   with a document written to different ones — and the honest fix is to say
   which convention each file follows, not to loosen the rule until nothing
   fails. */
var DOCS = [
  { file: 'MASTERING_WITH_CASKET.md', tables: true },
  { file: 'README.md', tables: true },
  { file: path.join('docs', 'LISTENING_PROTOCOL.md'), tables: true },
  { file: path.join('docs', 'CASE_FORMAT.md'), tables: false },
  /* The architecture doc lives at the estate root by its own layout note,
     hence the ../ — added 2026-08-19, and it earned its place the hard way.
     Within one week it was found to carry: an arrangement table with the
     wrong lining, a parameter count three fields out of date, a sealed-
     lining ladder no harness could reproduce, and a §6.3 sentence
     disagreeing with §6.3's own table. It is the longest document here and
     the least checked, which is not a coincidence. */
  /* tables:false — this document is MIXED, and that is why. It has genuine
     measurement tables (§6.2's residual ladder, §6.4's lining sweep) AND
     spec tables (the arrangement defaults: vigil in ms, margin in dB).
     Its only figure-bearing harness citation sits beside the SPEC table, so
     tables:true made the checker demand that `1.5` and `−0.3` — a vigil and
     a margin, not measurements — appear in casket_ui_test.js's output.
     Turning adjacency off costs nothing here because no measurement table
     in this file currently sits next to a citation; if one ever does, the
     right answer is to cite it inline rather than to flip this flag and
     reintroduce the false alarms. */
  { file: path.join('..', 'CASKET_ARCHITECTURE.md'), tables: false }
];

var citations = [];
DOCS.forEach(function (d) {
  var full = path.join(ROOT, d.file);
  if (!fs.existsSync(full)) return;
  extractCitations(fs.readFileSync(full, 'utf8'), d.tables).forEach(function (c) {
    c.doc = d.file;
    citations.push(c);
  });
});

/* A CITATION IS ONLY A CITATION IF THE THING NAMED IS A HARNESS. The
   pattern matches any `casket_*.js`, which was fine while this read one
   document that only ever names harnesses — the moment it read the README
   and docs/ it started matching `casket_core.js`, tried to execute
   `tests/casket_core.js`, and produced MODULE_NOT_FOUND noise around a
   perfectly correct reference to the source file.
   Naming the core is not a citation; it is a pointer. Separated rather than
   silenced, so the count of "things named but not runnable" stays visible —
   if a real harness is ever renamed, it lands in this list rather than
   disappearing from the report. */
var notHarness = [];
citations = citations.filter(function (c) {
  if (fs.existsSync(path.join(ROOT, 'tests', c.file))) return true;
  notHarness.push(c);
  return false;
});

/* RUN A HARNESS ONLY IF THERE IS A NUMBER TO CHECK — added 2026-08-19, and
   it is a correctness fix as much as a speed one. The tool executed every
   harness any document NAMED, including citations with no figure attached
   ("see `tests/casket_ui_test.js`"), which is running a program to verify
   nothing. That was survivable while the docs cited six harnesses. Adding
   the architecture doc took it to fourteen — including `casket_soak.js`,
   whose DEFAULT invocation is twenty minutes per arrangement, and
   `casket_tools_fuzz.js` at sixty states. The nightly would have sat there
   for the better part of an hour re-running the estate's two longest
   harnesses in order to check zero numbers.
   A citation with no decimal figure is still REPORTED (the ○ lines) — it
   just does not need its harness executed to be reported. */
var runnable = {};
citations.forEach(function (c) { if (c.nums.length) runnable[c.file] = true; });
var skippedForNothingToCheck = citations
  .filter(function (c) { return !c.nums.length && !runnable[c.file]; })
  .map(function (c) { return c.file; })
  .filter(function (v, i, a) { return a.indexOf(v) === i; });

var byFile = {};
citations.forEach(function (c) {
  (byFile[c.file] = byFile[c.file] || []).push(c);
});

var docsSeen = {};
citations.forEach(function (c) { docsSeen[c.doc] = (docsSeen[c.doc] || 0) + 1; });
console.log('CASKET doc citations — ' + citations.length + ' across ' +
            Object.keys(docsSeen).length + ' document(s), ' +
            Object.keys(byFile).length + ' distinct harness(es)');
Object.keys(docsSeen).forEach(function (d) {
  console.log('    ' + String(docsSeen[d]).padStart(2) + '  ' + d);
});
if (notHarness.length) {
  var names = {};
  notHarness.forEach(function (c) { names[c.file] = true; });
  console.log('  (' + notHarness.length + ' reference(s) to non-harness files, not checked: ' +
              Object.keys(names).join(', ') + ')');
}
console.log('  running ' + Object.keys(runnable).length + ' of ' +
            Object.keys(byFile).length + ' cited harnesses — the rest are named ' +
            'without a figure attached, so there is nothing to run them for' +
            (skippedForNothingToCheck.length
              ? ' (' + skippedForNothingToCheck.join(', ') + ')' : ''));
console.log('');

var cache = {};
function runHarness(file) {
  if (file in cache) return cache[file];
  var rel = 'tests/' + file;
  var out;
  try {
    /* cwd MUST be CASKET/ (= ROOT here) — every harness requires its sibling
       core with a path relative to CASKET/, same as casket.yml's own
       `working-directory: CASKET` before `node tests/casket_X.js`. The
       first version of this file computed a second, nested CASKET/CASKET
       by mistake and every citation "failed" against a process that had
       never actually started — caught by tracing e.status/e.stdout by
       hand rather than trusting the FAIL output at face value. */
    /* generous timeout: casket_cpu_gate.js is a wall-clock CPU benchmark,
       not a pure-logic check, and runs slower under sandbox load than
       standalone — a kill mid-run truncates stdout after whichever items
       happened to finish first (pine/velvet/oak, alphabetically-ish early)
       and silently drops the later ones (iron/lead), which reads exactly
       like a stale citation even though nothing is actually wrong. Caught
       by re-running the same harness standalone and seeing it complete
       cleanly well under this limit. */
    out = cp.execSync('node ' + JSON.stringify(rel), { cwd: ROOT, timeout: 120000 }).toString();
  } catch (e) {
    out = (e.stdout ? e.stdout.toString() : '') + '\n[exit ' + e.status + ']';
  }
  cache[file] = out;
  return out;
}

function foundInOutput(docNum, output) {
  var docVal = parseFloat(norm(docNum));
  if (!isFinite(docVal)) return false;
  var dp = decimalPlaces(docNum);
  var scale = Math.pow(10, dp);
  var hm, re = new RegExp(NUMBER.source, 'g');
  while ((hm = re.exec(output))) {
    var hv = parseFloat(norm(hm[0]));
    if (!isFinite(hv)) continue;
    if (Math.abs(Math.round(hv * scale) / scale - docVal) < 1e-9) return true;
  }
  return false;
}

var totalNums = 0, confirmedNums = 0, uncheckable = 0;
Object.keys(byFile).forEach(function (file) {
  /* only pay for a harness that has something to prove */
  var out = runnable[file] ? runHarness(file) : '';
  byFile[file].forEach(function (c) {
    var where = file + '  (' + c.doc + ')';
    if (!c.nums.length) {
      console.log('  ○ (no decimal figure near this citation) ← ' + where);
      uncheckable++;
      return;
    }
    var lineBits = [];
    c.nums.forEach(function (n) {
      totalNums++;
      var ok = foundInOutput(n, out);
      if (ok) confirmedNums++;
      lineBits.push((ok ? '✓' : '✗') + ' ' + n);
    });
    var allOk = c.nums.every(function (n) { return foundInOutput(n, out); });
    console.log('  ' + (allOk ? '✓' : '✗') + ' ' + lineBits.join('  ') + '  ← ' + where);
  });
});

console.log('\n' + confirmedNums + ' of ' + totalNums +
            ' cited figures confirmed in their harness\'s current output' +
            (uncheckable ? ', ' + uncheckable + ' citation(s) had no decimal figure to check' : '') + '.');
if (confirmedNums < totalNums) {
  console.log('\nNot necessarily wrong — go read the doc and the harness side by side\n' +
              'before editing either. A miss here is a question, not a verdict.');
}
process.exit(0); /* reporting tool — informational, does not gate CI on its own */
