# tools

## `counts.js` — the estate's numbers, measured rather than remembered

Every count in every document here was true when someone typed it and false a
day later. On 2026-08-16 the interchange's §1 table said RIGOR's gate held
50,718 checks, a handoff note said 36,998, the table had earlier said 24,833,
and the gate itself reported **61,694**. Four numbers, one fact, one hour. The
table already carried a footnote admitting it was "a claim like any other."
This is the alternative to that footnote.

### How it works

Live numbers in the docs are wrapped in HTML comments, which GitHub renders as
nothing at all:

```markdown
<!-- keys are lowercase; PROJECT here is a placeholder, which is why
     these examples are inert and the stray-marker check ignores them -->
the gate stands at <!--c:PROJECT.parity-->22,861<!--/c--> checks
```

`counts.js` runs the gates and the harnesses and rewrites what sits between
each pair of markers. Prose stays prose; only the digits move.

```bash
node tools/counts.js                  # measure, then rewrite the docs
node tools/counts.js --check          # measure, report drift, write nothing (exit 1 if stale)
node tools/counts.js --full           # re-run the slow harnesses instead of using the cache
node tools/counts.js --only=casket    # measure one project, merge over the cache
node tools/counts.js --list           # print every available value, touch nothing
```

CI runs the plain form and then `git diff --exit-code`, which is the same shape
as the parity gate's *emit, then prove it did not move*.

### The keys

`<project>` is `autopsy`, `rigor` or `casket`. There is also an `estate.*` set
that sums all three, and a bare `measured`.

| key | is |
|---|---|
| `<project>.parity` | bit-exact checks in the C++ gate |
| `<project>.assertions` | total across the asserting harnesses |
| `<project>.baselines` | byte-stable render baselines |
| `<project>.harnesses` | how many asserting harnesses there are |
| `<project>.suite` | assertions + baselines, **excluding** parity |
| `<project>.measured` | when that project's figures last changed |
| `estate.parity`, `estate.assertions`, `estate.baselines` | all three, summed |
| `measured` | the oldest project date — "nothing here is staler than" |

`suite` excludes parity deliberately. "534 assertions plus 14 baselines" is a
claim about the harnesses; folding 22,861 parity checks in would make one big
number that answers no question anybody asked.

### Four decisions worth knowing about

**Dates record when a figure last *changed*, not when it was last confirmed.**
This is what makes the script idempotent, and idempotence is what makes it
gateable — a date that advanced on every run would put CI red every morning for
no reason and train everyone to ignore it. It is also the more useful sentence:
*these figures have been true since the 16th* beats *somebody re-ran this
today*.

**Historical measurements carry no marker and are never touched.** "8,351
mismatches out of 11,164" records what FMA contraction did on the day it was
measured. Rewriting that 11,164 to today's total would invent an experiment
nobody performed. The rule: a number describing **now** is generated, a number
describing **then** is evidence, and evidence is not maintenance.

**A red suite cannot publish a count.** If a harness reports failures, or
prints no recognisable summary at all, the script raises rather than recording
a number. Silently counting a broken harness as nought assertions is precisely
how a figure goes wrong quietly.

**Nothing is written if any marker is unrecognised.** The first version scanned
and wrote in a single pass, so an unknown key made it exit with "UNKNOWN
MARKERS — documents untouched" *after* it had already rewritten four files. It
now plans the whole edit, validates it, and only then commits it.

**A marker in a file the script does not manage is a hard error.** That is the
worst available outcome: it looks generated, so nobody checks it, and nothing
updates it. This file caused it within minutes of the guard being written,
because documentation for a generator is exactly the place someone puts a
realistic-looking example. The examples above therefore use an uppercase
`PROJECT`, which the key pattern `[a-z.]+` cannot match, so they are inert by
construction rather than by anyone remembering.

### Two harnesses are cached

`casket_album` and `casket_rate` cost about three and a half minutes between
them, which is the difference between a script people run and a script people
stop running. Their values live in `counts.json` with the date they were taken.
The nightly CI job runs `--full` so a cached number cannot rot unnoticed.

### Adding a number to a document

Wrap it, run the script, commit both. If you invent a key the script does not
produce, it will tell you and refuse to write anything.

```markdown
holds <!--c:PROJECT.parity-->0<!--/c--> checks
```

The `0` is a placeholder; the first run replaces it.
