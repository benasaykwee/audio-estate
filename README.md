# The audio estate

Three mastering-chain plugins that share a substrate, built by Ben Asaykwee.
Each one exists as a browser instrument and as a C++ twin held **bit-exact**
against it by a parity gate.

| | lineage | what it is | says |
|---|---|---|---|
| [**AUTOPSY**](AUTOPSY) | Pro-Q | surgical parametric EQ | *opens the body* |
| [**RIGOR**](RIGOR) | Pro-C | compressor | *the body stops moving* |
| [**CASKET**](CASKET) | Pro-L | true-peak brickwall limiter | *nothing gets out* |

The chain runs **EQ → compressor → limiter, and the limiter must be last**,
because it is the only stage that guarantees a ceiling and anything after it
can undo that. Which is also why CASKET has no output trim.

## Start here

[`AUDIO_INTERCHANGE.md`](AUDIO_INTERCHANGE.md) is the contract binding the three
together: what `shared/` guarantees, the five laws, and a dated log of every
change that crossed a project boundary. **Read it before touching `shared/`,
and add a §7 entry whenever you do.**

Then the architecture docs, one per project:
[AUTOPSY](AUTOPSY_ARCHITECTURE.md) ·
[RIGOR](RIGOR_ARCHITECTURE.md) ·
[CASKET](CASKET_ARCHITECTURE.md).

## Run something

No build, no server, no dependencies. Open `CASKET/casket.html`,
`RIGOR/rigor.html` or `AUTOPSY/autopsy.html` in a browser.

CASKET will also render a real file: drop audio on it, press **Render to WAV**,
and get back a latency-compensated 24-bit WAV plus a before/after true-peak,
sample-peak and LUFS table. That exists because none of these is compiled to an
AU yet, and bouncing is the bridge.

## What `shared/` is

```
shared/necromath.{js,h}   NM — portable transcendentals
shared/necrodyn.{js,h}    ND — the dynamics DNA
```

`NM` exists because `Math.sin` and `std::sin` disagree by one or two ulp, and an
IIR feeds that back until it shows up in a hash. Every transcendental in every
project goes through it. `sqrt` is the documented exception, because IEEE
requires it to be correctly rounded, so the two already agree.

## The gates

Every project holds its C++ twin bit-exact against its JavaScript.
<!--c:estate.parity-->108,282<!--/c--> parity checks across the four gates,
plus <!--c:estate.assertions-->1,642<!--/c--> assertions and
<!--c:estate.baselines-->67<!--/c--> byte-stable render baselines.

**Those numbers are generated, not typed.** `tools/counts.js` compiles and runs
every gate, rewrites the figures between the markers in these documents, and CI
fails on any diff. It exists because this table used to be maintained by hand
and went wrong four different ways for one project inside a single hour. Each
date below is when the figure last *changed*, not when someone last looked.

| | parity checks | last changed |
|---|---|---|
| AUTOPSY | <!--c:autopsy.parity-->9,292<!--/c--> | <!--c:autopsy.measured-->2026-08-16<!--/c--> |
| RIGOR | <!--c:rigor.parity-->62,642<!--/c--> | <!--c:rigor.measured-->2026-08-23<!--/c--> |
| CASKET | <!--c:casket.parity-->23,013<!--/c--> | <!--c:casket.measured-->2026-08-27<!--/c--> |
| PALLBEARER | <!--c:pallbearer.parity-->13,335<!--/c--> | <!--c:pallbearer.measured-->2026-09-01<!--/c--> |

<!-- THE DATE COLUMN USED TO LIE, quietly and in one direction. Every row
     carried the bare `measured` key, which counts.js defines as the OLDEST
     last-change date across the WHOLE estate — deliberately, as an
     estate-wide "true since" figure. Used per row it made every project
     look as stale as the stalest one: RIGOR and CASKET both read
     2026-08-16 here while their own gates had moved on the 23rd and the
     24th. Flagged 2026-08-19, fixed 2026-08-24. Per-project rows want
     per-project keys. PALLBEARER was simply missing, which is the same
     failure with the volume turned all the way down. -->


**All of them compile with `-ffp-contract=off`, and that flag is the whole
gate.** Without it, GCC fuses `a*b+c` into a single FMA with one rounding where
the JS engine performs two. Measured on CASKET: thousands of mismatches, the
worst at 9,805 ulp, with the oversampler taps breaking first because a long
multiply-accumulate chain is exactly what a compiler most wants to fuse.

## Three habits worth stealing

**A gate that has only ever been green is a hypothesis.** New gates get a
deliberate mutation, a confirmed red, and then a revert. One of CASKET's gates
passed 22,848 checks vacuously because its test buffers were 85 ms long and
BS.1770 integrates over 400 ms; three separate mutations passed before anyone
noticed.

**A legal value that is also a boundary value is where things break.** Nearly
every bug this suite has produced lives there — and one lived at a legal value
that was merely *large*, where a `1e308` argument asked a loop for 1.4e308
iterations and hung the audio thread.

**Measure the claim, do not restate it.** Overshoot in CASKET is a theorem
rather than a tuning. Where a number appears in these documents it was produced
by running something, and where two numbers disagreed the gate was run again.

## Licence

MIT. See [LICENSE](LICENSE).
