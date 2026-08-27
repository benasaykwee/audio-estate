# THE INTERCHANGE
### The shared contract for the audio suite — NECROPHONE · AUTOPSY · RIGOR · CASKET

**What this is.** Four separate programs now depend on the same handful of files and the same handful of rules. Nothing enforces those rules except the tests, and the tests only fail *after* someone has already broken something. This document is where the contract lives: what is shared, what may never change quietly, what breaks if it does, and a dated log of every change that crossed a project boundary.

Read this before touching anything in `shared/`. Add to §7 whenever you do.

**Last updated:** 2026-08-27

*This line was itself four §7 entries stale when it was checked on 2026-08-27,
which is the least surprising defect in the document and the reason §6 now gets
audited rather than appended to. If you add an entry, move this date.*

---

## 1. The map

```
CLAUDE/
  AUDIO_INTERCHANGE.md      ← you are here
  shared/
    necromath.js  .h        NM — portable transcendentals
    necrodyn.js   .h        ND — the dynamics DNA
  AUTOPSY/                  surgical parametric EQ      (Pro-Q lineage)
  RIGOR/                    compressor                  (Pro-C lineage)
  CASKET/                   true-peak brickwall limiter (Pro-L lineage)
  NECROPHONE-repo/          four-engine synthesizer
  PALLBEARER/               physically modelled bass    (MODO Bass lineage)
  CORONER/                  listens, and says what made the sound
```

*CORONER is the odd one out and stays that way: every other project here MAKES
sound, and it is the only one that takes sound apart. It consumes shared NM,
deliberately does not consume ND (it measures dynamics, it does not impose
them), and has no C++ twin yet — it earns one when its feature set stops
moving, not before. **Its feature set has not stopped moving: `FEATURE_VERSION`
went 1 → 2 → 3 inside a single day**, which is both the reason there is no twin
yet and the reason the stamp exists. Check it before trusting any figure it
emits, and never compare vectors across versions; see §9.3.*

| | depends on NM | depends on ND | C++ twin | parity checks |
|---|---|---|---|---|
| NECROPHONE | own copy | — | yes | (its own gate) |
| AUTOPSY | **shared** | own copies (sealed) | yes | **<!--c:autopsy.parity-->9,292<!--/c-->** |
| RIGOR | **shared** | **shared** | yes | **<!--c:rigor.parity-->62,642<!--/c-->** |
| CASKET | **shared** | **shared** | yes | **<!--c:casket.parity-->23,013<!--/c-->** |
| PALLBEARER | **shared** | — *(no dynamics stage, deliberately)* | yes | **<!--c:pallbearer.parity-->13,335<!--/c-->** |
| CORONER | **shared** | — *(measures dynamics, does not impose them)* | **no** | — *(harness only: 168 checks, 19 sabotages)* |

*CORONER's row is the only one with no twin and no parity figure, and that is a
statement of fact rather than a gap to be tidied away. A parity gate proves two
implementations agree; there is only one implementation. It earns a twin when
the feature set stops moving — and `FEATURE_VERSION` moved twice on the day the
project was created, so that moment is not close. **This row is NOT derived**:
`tools/counts.js` does not know about CORONER, so the 168 is hand-typed and will
go stale exactly the way §1 says hand-typed numbers do. Measure the harness,
do not quote this.*

*PALLBEARER joined 2026-08-16, got its twin the same day, and is **now DERIVED like the
other three** — `tools/counts.js` compiles its gate at `-O2 -ffp-contract=off`, runs it,
and rewrites the figure above. The previous edition of this row carried 9,095 as a
hand-typed number with a footnote admitting it could go stale; it went stale within a
day, exactly as §1 predicts, when the v0.3 DSP round took it to 13,335. That is the
whole argument for the generator, demonstrated on the newest project rather than
recounted about an old one. It has no ND dependency on purpose: an instrument that needs
compression should be handed to RIGOR, not grow a second compressor.*

*This row is **DERIVED**, as of 2026-08-16. `tools/counts.js` compiles and runs
all three gates at `-O2 -ffp-contract=off` and rewrites the figures between the
markers above; CI runs it and fails on any diff, exactly as the parity gate
emits its header and then proves it did not move. A number here is now either
current or the build is red.*

*The previous note asked for this and recorded why. **The table had gone stale
twice in two days**: RIGOR read 24,833, was corrected to 36,998, was already
50,718 by the evening, and the gate itself reported 61,694 — four values for one
fact. CASKET drifted 22,563 → 22,861 in the same window. The numbers were never
the problem; the format was. **A restated number is not a measured one**, which
is the same lesson as "an assertion that names its expected value is not
checking anything."*

*What the script deliberately leaves alone: historical measurements. "8,351
mismatches out of 11,164" records what FMA contraction did on the day it was
measured, and updating it to today's total would invent an experiment nobody
ran. Those carry no marker. The rule is that a number describing **now** is
generated, and a number describing **then** is evidence — and evidence is not
maintenance.*

### 1.1 The JUCE split — Linux build advice is no longer uniform

*Added 2026-08-23. The estate is no longer on one JUCE, and the difference is
not cosmetic: it changes what a Linux runner must install.*

| project | JUCE pin | `juce_graphics` linuxPackages | Linux apt needs |
|---|---|---|---|
| AUTOPSY · RIGOR · CASKET · PALLBEARER | 7.0.12 | `freetype2` | freetype only |
| SÉANCE | 8.0.4 | `freetype2 fontconfig` | **+ fontconfig** |
| NECROPHONE | 8.0.6 | `freetype2 fontconfig` | **+ fontconfig** |

**The mechanism, read from both source trees rather than assumed.** Each JUCE
module declares its Linux dependencies in its own header; `juce_graphics.h`
line 48 under 7.0.12 says `freetype2`, and line 57 under 8.0.4 says
`freetype2 fontconfig`. CMake passes that whole list to **one** `pkg_check_modules`
query, so a missing *second* package fails the *whole* query and **no cflags flow
at all** — including freetype's include path. The symptom is therefore a lie:
the build dies on `ft2build.h: No such file or directory` while
`libfreetype6-dev` is installed and correct. pkg-config names the real culprit
one line earlier, as `Package 'fontconfig', required by 'virtual:world', not found`.

**The corollary matters more than the fix.** The estate's `build.yml` installs
freetype without fontconfig and is **not** broken by this — the four plugins it
builds are on JUCE 7, which never asks for fontconfig. It is a **conditional**
fault, not a latent one: it fires the day any trilogy project takes a JUCE 8
upgrade, and it will present as a freetype error rather than a fontconfig one.
Whoever performs that upgrade adds `libfontconfig1-dev` in the same commit.

---

## 2. The five laws

These are not style preferences. Each one exists because breaking it cost real time.

**LAW 1 — `-ffp-contract=off`, always.**
Every C++ target that touches DSP compiles with it. GCC otherwise fuses `a*b+c` into a single FMA with one rounding where the JS engine performs two. This is measured, not theoretical: compiling CASKET's parity gate without the flag produces **8,351 mismatches out of 11,164, the worst at 9,805 ulp.** The first things to break are the oversampler taps, because a long multiply-accumulate chain is exactly what the compiler most wants to fuse.

**LAW 2 — every transcendental goes through NM.**
`Math.sin`/`std::sin` and friends disagree between v8 and libm by 1–2 ulp. In an IIR or a feedback path that compounds into audible-in-the-hash drift. `Math.sqrt`/`std::sqrt` are the exception and stay native — IEEE requires them to be correctly rounded, so they already agree.

**LAW 3 — never a literal closing script tag in an embedded file.**
`necromath.js`, `necrodyn.js` and every `*_core.js` are embedded verbatim into their HTML. A literal `</` + `script>` anywhere, comments included, severs the embed. Every sync script checks and refuses.

**LAW 4 — the embed order is load-bearing.**
`nm-src` → `nd-src` → `core-src`. ND closes over NM; the core closes over both. The UI harnesses assert the order by byte position in the file, not by hope.

**LAW 5 — a legal value that is also a boundary value is where these break.**
Every bug this suite has produced lives there. AUTOPSY's `isFinite` threshold (0 dB is a legal threshold; `||` treated it as absent). CASKET's knee branch. The `y < x` guard in `kneeGain`. Sanitisers use `isFinite(n) ? n : default`, never `+x || default`. Harnesses sweep boundaries on purpose — RIGOR's is 230,560 points.

---

## 3. What `shared/` guarantees

### necromath (NM / `nm::`)
`exp` `log` `log10` `pow10` `sin` `cos` and `LN10`, built from IEEE `+ - * /` in a **fixed operation order**. Accuracy ~1e-15 relative. The order is the entire value: it is what makes the JS↔C++ parity gates bit-exact rather than "within a few ulp".

**Do not reorder, simplify, or "optimise" anything in this file.** If you need a new transcendental, add it — do not reach for libm.

**One trap, documented in `necrodyn`'s `softClip` and repeated here:** `NM.exp` scales by repeated doubling. A large argument does not merely overflow, it spins for billions of iterations first. Never hand it an unbounded input.

### necrodyn (ND / `nd::`)
| what | contract |
|---|---|
| `dbToLin` / `linToDb` | floor at 1e-30 so `log` never sees zero |
| `onePole(ms, fs)` | reaches 1−1/e of a step in exactly `ms` |
| `blend(d, k)` | `d/(d+k)` — the shape, third appearance in this codebase |
| `kneeOut` / `kneeGain` | soft knee, `invR = 1/ratio`; **`kneeGain` computes the reduction directly and returns EXACTLY 0 when idle** |
| `softClip(x, t)` | `t >= 1` is an exact passthrough |
| `lcg` / `makeNoise` | Park–Miller; deterministic test signals |
| `slidingMin` | monotonic deque; performs **no arithmetic** on samples, so it cannot drift |
| `boxcar` | running sum; error is a RANDOM WALK — **relative** drift stays ~1e-13 to 1e-11 and does not grow with length. Assert it relative, never absolute |
| `delay` `dcBlocker` `biquad` | plumbing |
| `secSosHP` / `secSosLP` | RBJ sections for sidechain filtering |

### The deliberate duplications
Two things exist in more than one place **on purpose**, each with a test holding the copies together:

- **`makeNoise`** — canonical in ND; AUTOPSY keeps its own verbatim copy. `casket_test.js` asserts they agree bit-for-bit.
- **`secSosHP` / `secSosLP`** — canonical in ND; AUTOPSY keeps its own. `rigor_test.js` asserts they agree bit-for-bit at four frequencies.

**Why not just refactor AUTOPSY?** Because AUTOPSY is a **sealed artifact**: five byte-stable regression hashes and 5,176 bit-exact parity checks, all blessed. Editing it for tidiness risks all of that to save six lines. The rule is: *AUTOPSY does not get edited for elegance. It gets edited for correctness, and then everything is re-verified.*

---

## 4. Shared invariants worth knowing before you connect anything

**The null test.** Every dynamics processor here must pass its input through **bit-identically** when it is not working. CASKET: lid above signal (unsealed arrangements only — see below). RIGOR: 1:1, or threshold above signal, or mix 0 %. Not "transparent", not "−140 dB of difference" — identical. This is the single most valuable assertion in the suite and it constrains architecture: it is why CASKET's audio path never leaves the base sample rate, and why `kneeGain` computes the reduction directly instead of by subtraction.

**Latency is a pure function.** `latencySamples(state, fs)` is computed by the same function the browser draws from, the harness asserts, and the plugin reports to the host. Three consumers, one source. A plugin whose reported latency is a lie smears every parallel path in a session.

**Byte-stable regression.** FNV-1a over `%.17g` of rendered samples. Any numeric drift anywhere — including in `shared/` — fails the gate. **Re-blessing a baseline is a deliberate act that gets written down in §7,** never a shrug.

**One documented exception, and it is a choice rather than a slip.** CASKET's sealed arrangements apply their gain in the oversampled domain and therefore *cannot* be bit-identical when idle — their output is `decimate(upsample(x))`. Four of five arrangements stay exact; Lead trades it for ~0.7 dB of true-peak accuracy. The principle the suite takes from this: **when a guarantee and a measurement genuinely conflict, expose the choice instead of picking silently — and assert the trade in the harness so it cannot rot into an accident.**

**Sanitise on the way in.** Every core exports `sanitizeState`. Anything crossing a boundary — a saved file, a URL hash, another program's output — goes through it.

**Parameter display is not parameter value.** A JUCE float parameter with no
string-from-value function and a zero step interval displays **seven decimal
places** — `Attack 0.9001075`. The tempting fix is a step interval, and it is the
wrong one *when reached for as a formatting tool*: an interval quantizes the real
value, coarsening automation and moving the number away from whatever the twin
computes. **Format the string; only quantize when quantizing is what you mean.**
AUTOPSY's 0.01 dB gain step is a deliberate, musically-irrelevant grid and is
fine; NECROPHONE cannot use one at all, because its values must match a
continuous browser engine bit for bit. **CASKET is the house exemplar** — seven
formatters (`dbText`, `msText`) attached via `AudioParameterFloatAttributes`.
Sliders that own their text boxes need `setNumDecimalPlacesToDisplay` *as well*,
called **after** any `SliderAttachment`, whose constructor calls `setRange` and
resets the count.

---

## 5. If you want to connect these to each other

The signal-level contract is deliberately boring, which is what makes it safe:

- **Sample format:** `Float64Array`, one per channel, stereo. `process(inL, inR, outL, outR)`.
- **Doubles all the way.** Convert to float only at the host boundary.
- **No allocation inside `process`.** All buffers are sized in `rebuild()`.
- **Chaining:** feed one core's output arrays straight into the next core's input. Latencies **add**; sum `latencySamples()` across the chain and compensate once at the end.
- **Sample rate:** every core takes `fs` at construction. Nothing assumes 48 k — K-weighting, filter design and time constants all derive from it.
- **State files:** `.autopsy.json`, `.rigor.json`, `.casket.json`. Each is its own core's `sanitizeState` output. A chain preset is just an object holding one of each.

**The order is EQ → compressor → limiter** and it is not arbitrary. The limiter must be last because it is the only one that guarantees a ceiling, and anything after it can undo that guarantee. Nothing with output gain may follow CASKET — this is also why CASKET has no `out_trim`.

### 5.1 Something outside this suite now connects here

There is an external consumer: **Masterbox**, a separate mastering tool with an auto-master brain, built in its own session and living at `DRAWING PROGRAM/masterbox-plugin/`. The proposed integration is **THE UNDERWORLD** — its brain analyses material, emits a chain preset, and drives AUTOPSY → RIGOR → CASKET. Governing documents: `UNDERWORLD_CHARTER.md` (the boundary) and `UNDERWORLD_INTERCHANGE.md` (the mechanics). ~~Neither is built yet.~~

> **FLAGGED, NOT REWRITTEN — 2026-08-27, from a CASKET session.** "Neither is built yet" is not true and has not been for some time. `CLAUDE/underworld/` holds **63 files**, of which **21 are `.test.js`**, plus a CLI, a server, a `translate.js` and a `chain.js` that renders AUTOPSY → RIGOR → CASKET end to end with real latency-compensation arithmetic. That was noticed in passing on 2026-08-18 and flagged then; it is still here nine days later.
>
> **It is flagged rather than fixed on purpose.** LAW 0 puts the Underworld's status and scope on Ben's side of the boundary, not a trilogy session's, and rewriting a sentence about what the Underworld *is* would be exactly the inversion this section exists to prevent. What is recorded above is only what is countable from outside: file names on disk. Nothing here was opened. **`UNDERWORLD_CHARTER.md` carries its own copy of this claim and it is stale too** — two copies of one sentence, both wrong, which is the defect this whole document is otherwise built to prevent. **Ben's word, one line, closes both.**

**LAW 0, quoted because it is the whole of your obligation:**

> *Masterbox is not bit-exact/parity-gated; the trilogy is sealed and bit-exact. The Underworld must connect at the preset + signal boundary only — never by merging code into their sealed cores, or it threatens the guarantees that make them worth using. Direction stays one-way: Masterbox consumes them.*

**What this changes for a trilogy session: almost nothing, deliberately.**

- **Do not design for it.** Do not import it, test against it, add a feature because the brain would like one, or accept a bug report that originates in it. The dependency runs one way and inverting it is the failure mode this note exists to prevent. If Masterbox needs something from a core, that is a request Ben approves as ordinary work on its merits, not a debt this suite owes.
- **Nothing here needs to know it exists at runtime.** No core imports it, references it, or behaves differently because of it. This section is documentation, not coupling.

**The one binding clause.** These are now a **published API**, not internal detail:

| Surface | Why |
|---|---|
| `sanitizeState(s)` | the seam's only validator; every preset crossing in must be its fixpoint |
| `process(inL, inR, outL, outR)` | the signal boundary, per this section |
| `latencySamples(state, fs)` | summed across the chain by an external caller |
| `.autopsy.json` · `.rigor.json` · `.casket.json` field names, ranges and scales | what an external writer emits |

**Renaming or rescaling a state field is therefore a breaking change, not housekeeping.** It requires a migration that keys on **structure, not a version number** (RIGOR proved why: the files needing migration predate versions, and a migration that sniffs *values* corrupted current files — a legal `link = 0.11` became `11`, so a saved session reopened louder than it closed; §7, sixth round), and it gets a line in §7. Adding a field is free. Changing what an existing name means is not.

---

## 6. Known open questions that touch more than one project

1. ~~**CASKET §14.5 — bit-exact null test vs true peak.**~~ **RESOLVED 2026-08-15: both, switchable.** CASKET's `seal` is now a per-arrangement structural flag — Lead sealed, the other four bit-exact. Evidence for why the *residual* form failed and the *full* form was chosen: `CASKET/tests/seal_experiment.js` and doc §6.3–6.4. Relevant to the suite because it sets the precedent: **when a guarantee and a measurement conflict, expose the choice rather than picking silently.**
2. ~~**Where should M/S live?** CASKET cut it (independent M and S gains do not bound L = M+S).~~ **CORRECTED 2026-08-27: CASKET did not cut it, and has not for some time.** `ms`, `msMid` and `msSide` are real state fields; `casket_test.js` §5e proves the unity short-circuit, the exact ±dB trim, *and* that the ceiling still holds with M/S pushed to +12/+6 on a sealed Lead; there is a `midside` case in `parity_emit.js`. The "cut it" line was corrected in CASKET's own records on 2026-08-18 and **never propagated here** — nine days of a cross-project contract describing a feature as absent while it shipped, parity-gated, in one of its three signatories. *The remaining question is the real one and stays open:* if RIGOR and AUTOPSY want M/S too, should it become a fourth `shared/` module rather than three implementations? The bounding concern that motivated the original hesitation was answered by construction — CASKET's M/S is a **pre-stage**, never a limiter mode, so the ceiling is still enforced downstream of it.
3. **Does the suite get a shared spectrum analyzer?** AUTOPSY has one; RIGOR and CASKET have both asked the question. It would be a fourth `shared/` module. *Still open — CASKET's fifth round did not reach it.*
4. **Does every program delay its BYPASSED signal?** CASKET's did not, and reported a latency anyway (§7, 2026-08-16 evening). ~~AUTOPSY and RIGOR both report latency and both have a bypass; neither has been checked.~~ **AUTOPSY checked 2026-08-16: reports zero latency and the impulse exits at sample 0 in every state (flat, working, all-12-bands-all-placements) — asserted in its core harness. Its bypass is a browser-side copy at zero latency, so alignment is structural.** ~~RIGOR remains unchecked; the test is one impulse long.~~ **RIGOR CHECKED — and this question is now CLOSED, corrected 2026-08-27.** `rigor_test.js` asserts, at look = 0, 1, 5, 10 and 20 ms, that a bypassed render is the dry signal delayed by **exactly** `latencySamples()` samples, compared bitwise rather than approximately, and it derives the expectation from the function instead of naming a number. It also asserts the delay line stays **primed** while bypassed. Both halves had been broken and both were measured before they were fixed: `latencySamples()` reported the lookahead while the bypassed impulse came out at sample 0, so a host compensating by the reported figure moved the audio up to 10 ms *earlier* the moment you pressed bypass — which invalidated every A/B with lookahead on — and leaving bypass dropped `look` milliseconds of silence into the track. **So all three programs have now answered this question, and it found real bugs in two of them.** The line above went stale because the question was answered inside RIGOR and never carried back to the document that asked it.
5. **Is "advice must be verified" being applied evenly?** CASKET's four advice functions all render to check. RIGOR's `suggestThreshold` does not, and is measurably off by a systematic 0.1–0.2 dB. ~~AUTOPSY has not been surveyed for advice functions at all.~~ **AUTOPSY surveyed 2026-08-16: it has exactly one advice function (Compensate, via `avgCurveDb`), and its audit now applies the advice and re-measures — post-advice average curve asserted at 0 to 1e-9 over 30 random states.**

---

## 7. THE LOG
*Every change that crossed a project boundary. Newest first. If you touch `shared/`, you add a line.*

### 2026-08-27 — §6 AUDITED against the code, and three of its five answers were wrong

**Nothing in `shared/` changed and no C++ twin was touched, so no parity check
and no blessed hash can have moved.** Changed: `INTAKE_FEATURE_VERSION` 2 → 3 in
`casket_core.js`, one new assertion and derived version stamps in
`casket_intake.js` (79 → **80**), and prose in §5.1, §6.2, §6.4 and §9.3 here.

**Why an audit rather than another entry.** §7 grows; §1 is generated and
therefore cannot drift; §6 is a list of *questions*, and a question that has
quietly been answered somewhere else is the most expensive kind of stale text in
this document, because it reads as work still to do. Every claim in §1–§6 that
states a number, a build state or an open question was checked against what is
on disk. **Three were wrong, two were confirmed still true, and the generated
numbers were all current.** The pattern in all three failures is identical and
worth naming: *the question was answered inside a project and never carried back
to the document that asked it.*

| § | said | actually |
|---|---|---|
| 6.2 | "CASKET cut M/S" | `ms`/`msMid`/`msSide` are real state fields with a `midside` parity case and a ceiling-holds-under-M/S test on sealed Lead. Corrected in CASKET's own records **2026-08-18** and never propagated — nine days of a contract calling a shipped, parity-gated feature absent |
| 6.4 | "RIGOR remains unchecked; the test is one impulse long" | `rigor_test.js` asserts bitwise that a bypassed render is the dry signal delayed by exactly `latencySamples()`, at five lookahead values, *and* that the line stays primed. Both halves had been broken and were measured before being fixed. The question is **closed** and it found real bugs in two of the three programs |
| 5.1 | "Neither is built yet" (the Underworld) | `underworld/` has **63 files, 21 of them `.test.js`**, plus a CLI, a server and a `chain.js` that renders the trilogy end to end. **Flagged, not rewritten** — LAW 0 puts that sentence on Ben's side. `UNDERWORLD_CHARTER.md` carries the same stale claim; one word from Ben closes both |
| 6.3 | shared spectrum analyzer still open | **confirmed** — `shared/` holds only `necromath` and `necrodyn` |
| 6.5 | RIGOR's `suggestThreshold` does not verify | **confirmed** — it returns `clamp(p90 + g/(1−iR), −60, 0)` with no re-render |

**And the seam ran end to end for the first time.** Three real signals through
`CR.autopsy()` → `CK.intake()` → `renderOffline()`: full-band noise → **lead**,
a decaying harmonic tone → **velvet**, percussive hits → **lead** at confidence
0.67. **The lid held on all three** (−7.09 / −6.94 / −2.09 dBTP against their
lids), measured with a 16× reconstruction rather than the engine's own detector.
That is the closed loop §9.8 asks for on the PALLBEARER side, run on the CASKET
side, and it is the first evidence that the two halves of §9 fit.

**One correction to my own reading, since it is the kind that matters here.** I
first saw only the middle of the three CORONER entries below and concluded the
version bump had gone unlogged. It had not — the entry directly beneath this one
records it fully and leaves an explicit instruction to bump
`INTAKE_FEATURE_VERSION` deliberately. **Reading one entry of three and
generalising is the same failure as measuring one fixture and calling a feature
dead**, which the same session had found in its own harness that morning.

### 2026-08-27 — the inverted stiffness tell, MENDED: a plausibility ceiling, and `FEATURE_VERSION` 2 → 3

**Nothing in `shared/` changed and CORONER still has no C++ twin, so no parity
check and no blessed hash can have moved.** Changed in `CORONER/coroner_core.js`
only: a ceiling on `inharm`, its declared range, and the version stamp. Harness
163 → **168 checks**, all green. This entry answers the measurement in the entry
directly below it, which was taken read-only from a NECROPHONE session.

**The fault, in one line: I guarded the SHAPE of the stiffness fit and never
guarded its MAGNITUDE.** The measuring session found NECROPHONE's grain cloud
reporting `B = 9.22e-3` at **R² = 0.999 — the best stiff-string fit in its whole
set** — and being routed to the *physical* engine, while `Bone & Sinew`, the
actual string model, measured `2.23e-6` and was sent to *granular*.

**Why CORONER's existing guard could never have caught it.** The guard reads
`bFit > 5e-5 && bR2 < 0.75 → refuse`. It refuses *poor* fits. This fit was
superb. A dense cloud of grains has partial-like structure at spacings that
happen to lie on a stretched series, and it lies on it beautifully. **The guard
was powerless by construction against the exact case it looked like it covered**
— which is a more dangerous shape than an absent guard, because the code reads
as though the question had been asked.

**The real mistake was the declared range.** `inharm` was declared `0 .. 0.01`.
Real strings run about `1e-5` (long, thin) to `1e-3` (short, thick, wound), so
the declared maximum admitted values **five times stiffer than any string that
exists** — and `9.22e-3` sat at 92% of that maximum without ever looking
unusual. A range that admits the impossible is a range in which an impossible
answer looks ordinary.

**The mend.** `B_MAX_PLAUSIBLE = 2e-3` — generous to any real string, closed to
a grain cloud — applied *before* the R² guard; declared max `0.01 → 0.002`; two
new checks proving the ceiling refuses an impossible body **on its value while
its fit is still excellent** and still passes a plausible string at an equally
good fit. Both directions, because a ceiling that rejected everything would pass
a one-sided test. Proved to bite: removing the ceiling fails 2 checks, setting it
absurdly low fails 15.

> **THE RULE THIS LEAVES BEHIND, and it is not CORONER's alone:
> A GOODNESS OF FIT ONLY TELLS YOU THE SHAPE IS RIGHT. It says nothing about
> whether the MAGNITUDE is possible. Guard both, and declare ranges that admit
> only what physics admits.**
>
> The shape to grep for anywhere in this estate: *a validity check that
> constrains how well a model fits, but not what it fits to.*

#### The version bump crossed a boundary, so it is logged here

Both the raw value and its normalisation changed, so **`FEATURE_VERSION` went
2 → 3**. A model trained on a v2 vector must not read a v3 one; that stamp is
the entire reason the feature registry exists, and it has now moved twice in one
day, exactly as §1 warns about numbers in this document.

**§9.3's contract was exercised live rather than reasoned about.** A real v3
CORONER report was built and passed to `CK.intake()`:

- version mismatch **detected and reported in `warnings`**, not refused —
  *"feature vector version 3, and THE INTAKE was written against 2"*
- **all seven** of `INTAKE_READS` present, finite and in range (none of them is
  `inharm`, and none was touched by the v1→v2 or v2→v3 changes)
- a valid state came back, arrangement `velvet`

So the seam degrades exactly the way §9.4's design intended, and **CASKET needs
no change**. Whoever next touches `INTAKE_FEATURE_VERSION` should bump it to 3
deliberately, after re-reading §9.3 — not to silence the warning, which is doing
its job.

**Still open on the NECROPHONE side, and NOT mended here:** `Bone & Sinew` has
no dispersion at all (three parameters, and the only allpasses in
`necrophone_core.js` are in the reverb), so it is an *ideal flexible string* with
zero stiffness by construction. CORONER measured it correctly; it measured a
model that is physically incomplete in the one way that defines a struck string,
and **no internal harness could ever say so** because the regression only proves
it sounds like itself. Adding dispersion is an R14 item and R14 re-records
baselines that have held for a hundred items — **it does not start without Ben's
explicit yes.** Also unmended: that wrong verdict came back at **confidence
0.94**, which is the failure mode CORONER's own notes warn about for jitter.

Report: `CLAUDE/CORONER/THE_INQUEST.html` (§IV·b covers the closed loop).

### 2026-08-27 — the CORONER→NECROPHONE half, measured: the contract is clean, the loop does not close, and the stiffness test is INVERTED

**NOTHING WAS CHANGED BY THIS ENTRY.** No `shared/` file, no core, no harness, no
test, no CI workflow, in any project. Read-only measurement only, so no parity
check and no blessed hash can have moved. **This entry is a report and a set of
PROPOSALS awaiting Ben's word** — see "what I would like to do" at the end, which
names which session owns which half. Written from a NECROPHONE session; CORONER's
files grew 62→82 KB the same morning and had been still for two hours when the
measurements were taken (see the concurrent-sessions rule in §8).

**Why this exists.** §9 specifies the CORONER↔CASKET seam and gates it from the
consumer side. The CORONER→NECROPHONE seam is older, was built from the producer
side, and **has never been gated in either direction**. The entry above records
that the handoff reuses NECROPHONE's task-17 share format so "nothing in
NECROPHONE had to change". That is true, and it is also the problem: nothing in
NECROPHONE *knows*.

#### The parameter contract holds today, and it holds well

Every one of the **19** ids `routeToNecrophone` can emit was checked against
NECROPHONE's real 124-parameter registry, and a live slip was round-tripped
through NECROPHONE's **real** hash decoder lifted out of `necrophone.html`:

- all 19 ids exist; **0** out of range, **0** illegal enum values, **0** dropped
- every clamp CORONER applies matches NECROPHONE's declared min/max **exactly**
- CORONER is current with **R14-101** — it computes `corpseRoot` as a semitone
  offset from G3 = MIDI 55, the parameter added 2026-08-23
- `CR._corpseRootOffset` vs NECROPHONE's `rootOffsetFromHz` agree on **16 of 17**
  probes, including 195.9977 Hz — the value that would have cost byte-stability
  had `corpseRoot` been defined as an absolute root instead of an offset

The seventeenth probe is `hz = 0`, where NECROPHONE returns `null` ("refuse to
guess") and CORONER returns `0` ("no change"). It cannot fire — CORONER guards
`if (f.f0 > 0)` before calling — but the two are spelling *silence* differently,
which is the shape of a bug rather than a bug.

**Three faults in the seam regardless of the clean contract.**

1. **Two copies of a rule with no gate**, which is this estate's oldest defect in
   its favourite hiding place. CORONER hardcodes NECROPHONE's ranges; NECROPHONE
   has no idea CORONER exists. `loadPatchFromHash` merges with
   `if (j in patch)`, so a renamed id is **silently dropped** — no throw, no
   warning, just a patch that is not what the slip said. CORONER's own comment
   anticipates exactly this and says the release check could compare them.
2. **`corpseRoot` travels without the corpse.** The share format cannot carry
   audio and says so honestly. But NECROPHONE opens on its default built-in
   source `"relic"`, so an offset measured from a user's recording is applied to
   the relic — a confident wrong number pointed at the wrong body, which is the
   precise risk CORONER refused to take on pluck position, arriving another way.
3. **The route that most needs the audio gets it least.** Routing textural
   material to `granular` is correct; Dust & Ashes then arrives with an engine
   selection and nothing to grind.

#### THE CLOSED LOOP, run for the first time: 2 of 8 came home

The gate §9's PALLBEARER notes ask for — render a patch the instrument knows,
examine the audio, score the slip against the original — had never been run for
NECROPHONE. All four engines rendered headlessly at 44.1 kHz with a deterministic
PRNG swapped in, fed straight to `CR.autopsy()`, as a held G3 **and** as a
four-note phrase. **2/8 came home.**

**That number must not travel without its caveat.** `chooseEngine` maps *what the
material is* to *which engine suits it* — it is not trying to identify what
produced a sound. A wavetable render that holds still and stays harmonic
genuinely does suit The Revenant. **2/8 is one measurement nobody had taken, not
six bugs.** Two results inside it are wrong under any reading, and they are the
same result twice:

| rendered by | inharm `B` | fit R² | routed to |
|---|---|---|---|
| Dust & Ashes (grain cloud) | **9.22e-3** | **0.999** | physical |
| Bone & Sinew (the string model) | 2.23e-6 | 0.131 | granular |
| Revenant, unison off | 1.52e-6 | 0.092 | analog |
| Revenant, unison 14 cents | 8.79e-6 | 0.215 | analog |

**The grain cloud fits the stiff-string law better than anything else here.**
R² = 0.999 — the best fit in the set. The existing guard
(`f.inharm = (bFit > 5e-5 && (bR2 < 0.75 || bUsed < 4)) ? 0 : bFit`) is
**powerless by construction**: it was built to reject a *poor* fit, and this is a
superb one. The tell is not the fit, it is the value. `B = 9.22e-3` is roughly
**nine times the stiffest bass string on a piano** and sits at 92% of CORONER's
own declared maximum for the feature. Something in the grain spacing spreads with
partial index in a way that satisfies the same curve. This is the same family as
"unison detune imitates string stiffness" already recorded above, but it defeats
the fix that one produced.

**Bone & Sinew is invisible, and that half is NECROPHONE's fault, not CORONER's.**
Verified in `necrophone_core.js`: the physical engine has exactly three
parameters — `phHard`, `phDecay`, `phBody` — and **there is no dispersion
anywhere in it**. The only allpass filters in the file are in the reverb. Bone &
Sinew is a delay line with damping, which is physically an *ideal flexible
string*: zero stiffness, perfectly harmonic partials. It shows less stiffness
evidence than a detuned sawtooth. Its wrong verdict also carried **confidence
0.94**, which is the failure mode CORONER's own notes warn about for jitter — a
confident wrong answer is worse than an unconfident one.

**The finding under the finding, and it is the reason this entry is long.**
NECROPHONE could not have learned this from inside itself. Its regression harness
proves each engine sounds like *itself*, faithfully, and that is exactly what it
is for. It took an outside ear carrying a physics model to say what Bone & Sinew
sounds like *compared to a string*. **This is the first time anything in the
estate has been able to make that class of statement about another member**, and
it is worth more than the specific defect. Every project here now has a possible
external auditor that is not another copy of its own assumptions.

#### What I would like to do, and who owns which half

Named separately because these do not all belong to one session, and one of them
is not any session's to take.

**Mine (NECROPHONE-side, no DSP, byte-stability untouched):**

- **Make the closed loop a permanent harness.** ~40 lines; it found something on
  its first run, which is this estate's usual result for a new gate. It should
  **not** assert "came home" — that metric is contestable, per the caveat above.
  It should assert what cannot be argued: *a rendered engine never routes to a
  target that cannot make that sound*, and *confidence never exceeds 0.9 on a
  verdict that is wrong* (Bone & Sinew currently fails the second at 0.94).
- **Gate the parameter contract** from NECROPHONE's release check: compare the
  ids and ranges CORONER emits against the live registry so a rename fails loudly
  instead of vanishing. This is what CORONER's comment already asks for, and it
  costs CORONER nothing — no import in either direction, per §9's rule.
- **Close NECROPHONE's own asymmetry**, which is unrelated to CORONER and mine
  regardless: `loadPatchFromHash` does `patch[j] = o.p[j]` with **no clamp and no
  enum check**, while the pack path sieves hostile values. Not currently exposed
  because CORONER clamps correctly on its side. That is luck, not design.

**CORONER's session, offered rather than done — I did not touch its files:**

- **A plausibility ceiling on `B`.** The R² guard cannot catch the grain cloud
  and never could. The feature's declared range currently admits values no string
  has. A ceiling would; where it sits is a physics question and CORONER's call.
- **The 0.94 case** is worth a look on its own terms, separately from routing.

**Ben's, because it is engine code:**

- **Dispersion in Bone & Sinew**, an R14 item — it would give the string model
  real stiffness, make it sound like a string, and let CORONER see it. **The
  R14-101 trick may apply again**: if the zero value is a *structural identity*
  rather than a zero-coefficient filter, the baselines never move. Flagged as
  **plausible, NOT proven** — an allpass at coefficient 0 is still a delay, not
  an identity, so this needs checking before anyone promises it is free.

**Bigger, and nobody's yet:** CORONER emitting a `.necropack.json` instead of a
`#p=` URL. R15-113 already built the receiving half (`parsePackText` /
`applyPackPatch`), and the pack carries riders the URL cannot — materialA/B as
16 kHz i16, Scala cents, spectral mask, wavetable, IR. It fixes faults 2 and 3 at
once and **the slip would open in a DAW**. Cost, stated plainly: CORONER has no
dependency on NECROPHONE in either direction by design, and the pack encoder
lives inside `necrophone.html`, so reproducing it is a real lift rather than the
three lines the share format was. If it is ever taken, the contract belongs in a
**§10** beside §9, gated from the consumer side the way §9 was.

**Caveats on everything above.** The bodies are synthesised or NECROPHONE's own
output; no real instrument was involved, which is the limit CORONER names about
itself first. Four engines and two note-shapes is a probe, not a calibration —
the direction is sound, the exact numbers should not become thresholds. That
`9.22e-3` is unphysical for a string comes from published piano inharmonicity
ranges, not from anything measured here. Full read:
`CLAUDE/CORONER_NECROPHONE_SEAM.html`.

### 2026-08-27 — CORONER joined the estate: the sixth project, and the first that LISTENS

**Nothing in `shared/` changed and no C++ twin exists yet, so no parity check
and no blessed hash can have moved.** New project at `CLAUDE/CORONER/`:
`coroner_core.js` (single source of truth) · `coroner.html` (self-contained test
bed) · `coroner_sync.js` (embed writer, `--check` for CI) · `coroner_test.js`
(**163 checks**) · `README.md`. Consumes shared NM. **Deliberately does not
consume ND** — it measures dynamics, it does not impose them.

**What it is.** It takes a recording apart, says what kind of thing made the
sound, and routes it: NECROPHONE (with a specific engine chosen) or PALLBEARER,
with a starting patch already built from the measurements. The handoff to
NECROPHONE reuses its own task-17 share format (`#p=` + base64url of a
delta-from-defaults patch), so **nothing in NECROPHONE had to change**; the
harness round-trips a link through the same decode `loadPatchFromHash` performs.

**Three layers, and the separation is the point.** THE EXAMINATION (31 features,
no opinions) · THE VERDICT (thin, transparent, replaceable whole via
`setVerdictEngine()`) · THE ROUTING SLIP. A neural classifier replaces layer 2
and only layer 2. §9's `chooseArrangement()` mirrors this split on purpose.

**Compatibility with §9.3 verified from this side, 2026-08-27.** CASKET's
`intake()` was written against `FEATURE_VERSION 2` and reads seven features;
all seven are present, finite and in range, the report shape is
`{version, features}` as specified, and **none of the seven were touched by the
v1→v2 segmentation rework** — that rework changed the meaning of `f0`,
`f0jitter`, `vibRate`, `vibDepth`, `harmonicity`, `inharm`, `oddEven`,
`irregular` and `bandSlope`, which do not intersect CASKET's reads. The two
sessions agree.

> ⚠️ **CORRECTED THE SAME DAY, and the correction is the point.** Two errors
> above, both fixed in place: the feature count read **30** and is **31**, and
> the vector is no longer v2 — the entry at the top of this log took it to
> **v3**. "The two sessions agree" was true when written and was falsified a few
> hours later by my own change. The seven `INTAKE_READS` are still untouched and
> the seam still holds, now *measured* rather than reasoned about, so the
> conclusion survives even though the version in it does not.
>
> Left standing rather than rewritten, because [[verify-roadmap-against-code]]
> is about exactly this: **prose is the least-tested surface in any project
> here.** A count nobody re-derives goes stale silently, and a compatibility
> claim pinned to a version number goes stale the moment that number moves. Both
> did, within one day, in a document whose §1 already warns that its own numbers
> go stale within a day.

**The lesson worth carrying to every other project here: a harness of
single held notes cannot see what real audio does.** Every synthesized body
was one steady note, 128 checks were green, and then eight real NECROPHONE
renders reported pitch jitter of **250 to 435 cents**. Nothing was unstable —
it was measuring the melody. Since near-zero jitter is the strongest synthetic
tell in the machine, and no piece of music can show near-zero jitter under that
definition, **the tell could never fire on real material at all**: an
oscillator pad came back "Blown or Reed". Four more of the same class followed
(a whole-phrase spectrum finding no partials, unison detune imitating string
stiffness convincingly enough to misroute a pad, a vibrato smearing away a
genuine stiffness measurement, YIN reporting a stiff string 31 cents sharp).
**Mutation testing then found three more that even the real files had not
exposed** — including a jitter figure that ran BACKWARDS, falling as real
instability rose, which is worse than no measurement because it would have been
believed. Seventeen deliberate sabotages of the core are now each caught by a
named check.

**Deliberately not built:** no C++ twin yet (it earns one when the feature set
stops moving) · no source separation, so a full mix is barely tested · no
loudness metering, per §9.2 · CASKET is not in `route()`, per §9.8.

### 2026-08-27 — CASKET grew an intake for CORONER, and the seam is specified in §9

**Nothing in `shared/` changed and no C++ twin was touched, so no parity check
and no blessed hash can have moved.** CASKET gained `intake()` and
`chooseArrangement()` in `casket_core.js`, JS-only on the same footing as
`matchReference` and THE WAKE, registered in both censuses with reasons
(`API_EXEMPT` in `casket_coverage.js`, `DIAGNOSTIC_ONLY` in
`casket_plugin_test.js`). New harness `tests/casket_intake.js`, wired into CI.

**The receiving end was built before the sending end, deliberately.** CORONER
does not route to CASKET — `route()` forks two ways and CASKET appears nowhere
in its three files. Specifying and gating the consumer first means the producer
has something to aim at that is already proved, rather than two halves being
guessed at once.

**Three things worth carrying out of it:**

1. **CORONER has no BS.1770 and must not grow one.** Checked directly: `crest`
   is plain peak over RMS, no K-weighting, no LUFS, no true peak. CASKET's is
   gated against EBU 3341/3342 plus two cases added because the published
   reference programmes are blind to the gate and the percentiles they test.
   A second copy would be the estate's oldest defect in its hardest-to-see
   location. §9.2.
2. **A confidence that costs nothing is worth nothing.** The first draft of
   `chooseArrangement` gave velvet a free point so an empty report would land
   on the default. Correct instinct, wrong mechanism: velvet then scored 1
   against a field of zeros, and a confidence computed as the margin over the
   runner-up read **1.00 on an empty report**. Maximum certainty, no evidence,
   which is worse than being wrong because it is wrong and convincing. The
   default moved into the tie-break. Same family as the EBU cases above and as
   `casket_mutate.js` printing "every deliberate break was caught" after
   running zero mutants.
3. **A census that sees a feature under one condition will report the
   conditional ones as dead.** The harness's "is any declared feature dead
   code?" check swept a single fixture, and `dur` — which acts by *scaling*
   confidence — multiplied five durations by a zero and came back dead. It is
   not dead, it is conditional. The check now requires a feature to matter
   *somewhere*, and proves it can still see real deadness by running
   `centroid`, which CASKET genuinely does not read, through the same
   machinery.

**Verified:** `casket_intake` 79/0, `casket_test` 217/0, `casket_ui_test`
113/0, `casket_plugin_test` 129/0, `casket_coverage --strict` 0 unexplained
gaps, `casket_sync` byte-identical on all three embeds. The plugin test caught
the new harness's absence from `casket.yml` before a human did.

### 2026-08-24 — RIGOR has CASKET's arrangement bug, found by censusing for it rather than by waiting

**Nothing in `shared/` changed. This is a finding about a sibling, filed here
because §7 is where cross-boundary facts live, and because the entry below sets
the rule: when a fix cannot reach a consumer, the follow-up belongs in that
consumer's records the same day or it never becomes anyone's to-do.**

**What happened in CASKET.** A person played it for the first time on
2026-08-23 and reported that the five arrangements sounded identical. They
were. The editor's dropdown moved the `style` parameter, which changes only the
two traits the *engine* derives from a style, while the audible recipe — the
lookahead, the release, the knee, the oversampling, the margin, the saturation
and the seal — stayed wherever it happened to be. The browser face never had
the hole, because picking a style there merges the whole recipe over the
current state. The engine was never wrong: it rendered exactly the state it was
handed, and the state it was handed was one arrangement wearing five names.

**RIGOR HAS THE SAME HOLE.** Read directly, not inferred:
`RIGOR/rigor_core.js` defines four styles, each with a `d` block naming
**knee, attack, release, autoRel and ratio**. `PluginEditor.cpp`'s four style
buttons do exactly one thing — a gesture around `*styleParam = i` — and nothing
applies `d`. So in a DAW, FRESH · SETTLING · SPASM · REPOSE differ only by the
traits RIGOR's engine reads from the style directly (topology, detector, the
RMS and peak windows, the level-smoothing flags), while **ratio 2 against
ratio 6, knee 0 against knee 18, and attack 0.5 ms against 30 ms never happen.**
Those are not shadings; they are most of what a compressor *is*.

**AUTOPSY and PALLBEARER are clear**, and structurally rather than luckily:
AUTOPSY's choice parameters are filter type, slope and placement, which imply
no recipe, and PALLBEARER declares no choice parameter at all. **The hazard is
not "having a dropdown". It is having a dropdown whose value implies values for
OTHER parameters** — a table in the core with a defaults block hanging off each
option. Grep for that shape, not for combo boxes.

**The fix, if RIGOR's session wants it.** CASKET's was three pieces: the style
control loses its parameter attachment and becomes a callback; a user's pick
applies the recipe through proper host gestures reading the same table the
engine reads, so there is no third copy to drift; and automation, preset loads
and `setStateInformation` still move only the style parameter — deliberately,
so a restored session cannot have its knobs stomped on load. That last part is
the half that is easy to get wrong in the other direction.

**And the gate is the point.** A test that reads the recipe fields out of the
core and asserts the editor applies every one means the next field added to a
style turns the suite red until the face learns it. **Neither that gate nor the
bug's measured cost existed until a human listened**, which is the
uncomfortable part: four harnesses, twenty-three thousand parity checks and a
mutation suite all passed while every arrangement was the same limiter, because
the fault was in what the editor SENT, and every test in the building checked
what the engine did with what it was given.

**Not fixed here.** Editing a sibling's editor from a CASKET session crosses a
boundary this document exists to keep. Recorded, with the shape to grep for and
the fix that worked.

### 2026-08-24 — the parse hazard already had an answer in this estate, and the shape of it matters more than the function

**Nothing in `shared/` changed.** A reply to lesson 2 of the entry below, plus a
second instance of the same class found the same morning.

**CASKET solved this in August and never told anyone.** `casket_plugin_test.js`
reads both plugin translation units as text, and its first version reported that
`processBlock` called `realloc` and `new`. It does neither. It has a *comment*
containing the words "reallocate" and "new latency". The fix was a four-line
`decomment()` — strip block and line comments, then scan — and the note left
beside it is the part worth copying: *a linter that reads prose as code is a
linter that will be switched off by its third false positive.* The precedent is
free for NECROPHONE's parameter gate to take.

**But `decomment()` is not a universal answer, and CASKET is also the proof of
that.** The same harness deliberately reads the **raw** file for one check,
because the thing it verifies — that the parameter count stated in
`PluginProcessor.h`'s header comment matches the count declared in code — *lives
in a comment*. Strip comments there and the check silently passes on nothing.

**So the rule is not "strip comments." It is: every text-matching check must
declare which view of the file it wants**, and a file scanned by more than one
check may need both. Code checks read the stripped view; checks on documentation
read the raw one. Getting that backwards is silent in exactly one direction —
the stripped view makes a prose check vacuous, and a vacuous check is
indistinguishable from a passing one.

**The same class, found twice in one morning.** `casket_mutate.js` reported which
assertion a killed mutant died on by matching a failure glyph *or* a bare
lowercase `x` followed by a space — the ASCII fallback. Two new mutants both
reported dying on "x table is the inverse of buildState's", which is the tail of
the word **inde·x table** inside a line that had *passed*. Anchored to the
literal failure prefix the harnesses print, and both mutants now name the
assertion that actually went red. **A diagnostic that misreports sends the next
reader to the wrong part of the suite, which is worse than printing nothing** —
and an over-broad alternative in a matcher is the cheapest way to build one.

### 2026-08-23 (evening) — a file that a tool parses has no comments, and half the estate shows seven decimals

**Nothing in `shared/` changed.** Two findings from the first hour anyone had
ever *played* one of these plugins, both of which apply to every project here.

**1. Seven decimal places, and the fix that would have been worse.** The first
NECROPHONE build in a DAW showed `Attack 0.9001075`, `Master Width 1.9218490` —
every float, seven places. That is JUCE's widest fallback, reached when a
parameter has neither a string-from-value function nor a step interval, and all
123 had neither. **The obvious fix is a step interval and it would have been a
real defect:** an interval quantizes the *value*, not the display, which coarsens
automation and — for NECROPHONE specifically — would push values off the
continuous browser engine its parity gate compares against. The fix is a
display-only formatter, proven display-only by running the browser's own
`parseCppParams` over the file before and after: 123 parameters both times,
every id, range, default and option list byte-identical. There is a second
mechanism worth knowing: a `Slider` that owns its text box derives decimals from
its *own* interval and never sees the parameter's formatter, so it needs
`setNumDecimalPlacesToDisplay` — **after** the `SliderAttachment`, because that
constructor calls `setRange` and resets the count. Standing rule now in §4.

**Where the estate actually stands, measured today:** **CASKET is the exemplar**
(seven formatters — `dbText`, `msText` — via `AudioParameterFloatAttributes`).
**AUTOPSY** uses explicit intervals, deliberately and defensibly (0.01 dB on
band gain). **RIGOR, PALLBEARER and SÉANCE have no formatters at all** and will
be showing the same seven places to anyone who opens them. Cheap to fix, and the
pattern to copy is already in this estate.

**2. A file that a tool parses has no comments.** NECROPHONE's parameter-parity
gate reads `Parameters.h` **as text**, finding parameters by regex on a helper
name followed by a bracket. While fixing the above, a comment was added warning
future editors not to introduce that pattern — and the comment **spelled the
pattern out**, so the parser matched the warning and reported two malformed
parameters. Caught in seconds, because the gate was run before and after rather
than trusted; it was invisible to the compiler, which sees a comment.

**The general form, and it has teeth here.** Any file consumed by a text-matching
tool has no inert regions: prose, comments and examples are all input.
**This document is an instance.** §1's parity figures sit between
`<!--c:…-->` markers that `tools/counts.js` rewrites and CI fails on, so writing
*about* those markers in ordinary prose can corrupt the table the same way. When
documenting a pattern that a tool matches, **describe it rather than quote it**,
or the documentation becomes the bug.

---

### 2026-08-23 — the estate immunised itself against `M_PI` and NECROPHONE caught it anyway

**Nothing in `shared/` changed.** This entry is here because the exposure was
already known, already written down, and still cost a red run.

NECROPHONE's first three-platform CI run died on Windows with **six `C2065:
'M_PI': undeclared identifier`** in `NecrophoneCore.h` — the *same wound*, in the
same compiler, that this log recorded as closed on **2026-08-21**, when
`shared/necromath.h` gained its guarded `#define`. That fix could not reach
NECROPHONE, because NECROPHONE's row in §1 reads **"own copy"** for NM and its
core includes `<cmath>` and four other standard headers, never `necromath.h`.

**And it was predicted, in writing, by the session that did the fixing.** The
2026-08-21 work left an explicit note that `NecrophoneCore.h` uses `M_PI` without
including `necromath.h`, that the fix therefore would not reach it, and that this
was being left alone deliberately as outside the trilogy's business. Every word
of that was correct. It still cost a red CI run two days later.

**So the finding is not "we forgot" — it is that the note was filed in the wrong
place.** A "still exposed" line lodged in the *fixer's* records never became a
to-do in the *exposed project's* work queue, and NECROPHONE's own docs, memory
and roadmap said nothing about it. Deferring a cross-project fix is legitimate;
deferring it without writing the item where the other project will trip over it
is how a known issue gets rediscovered by a compiler. **When a `shared/` fix
cannot reach a consumer, the follow-up goes into that consumer's own docs the
same day** — and "own copy" in the §1 table should be read as *this project
inherits none of our repairs*, not as a neutral implementation note.

The guard is now duplicated in `NecrophoneCore.h` with the identical literal;
smoke, blend, tunefx and the new codec gate were all re-proven byte-identical
after the change, so no computed value moved. The longer-term choice — whether
NECROPHONE eventually consumes `shared/` — is a real DSP decision that can
re-bless baselines, and belongs to a round, not to a CI hotfix.

*Also fixed in the same run, and written up in §1.1 rather than here because it
is standing advice rather than an event: **JUCE 8 requires `fontconfig` on Linux
and JUCE 7 does not**, so the estate's apt list and NECROPHONE's can no longer be
the same list. The estate's is correct for JUCE 7 and becomes wrong the moment
anything there upgrades.*

### 2026-08-22 — CASKET's CPU gate could not see `NM.sin`, so a Node upgrade read as a 40% regression

**Nothing in `shared/` changed.** This entry is here anyway, because the finding is
about `shared/necromath.js` and the next project to build a performance gate needs it.

CASKET's CPU gate failed on run #18 with **exactly two of seventeen entries regressed**:
both resamplers, at +38% and +41%. Everything else moved by 3% or less. A loaded runner
slows everything, so that shape ruled out noise immediately.

**Measured, not argued.** Neither commit since the baseline was blessed touches
`resample`, zero lines in either diff, and `shared/necromath.js` has not changed since
the estate's founding commit `74bc832`. The resampler's code was byte-identical to what
was blessed. The only thing that changed was the runner's Node, via
`actions/setup-node@v4` to `@v5`.

**Why only those two.** The resampler is a windowed sinc: per tap per output sample it
calls `NM.sin` once for the sinc and `NM.cos` twice for the Blackman window. `NM.sin` is
not a library call. It is `sincos_`, a hand-rolled Taylor polynomial, eight terms for sine
and nine for cosine, plus quadrant reduction. Pure arithmetic, so its speed is entirely a
question of how V8 chose to compile it that day.

**The blast radius is every future performance gate in the estate.** Any harness that
scores transcendental-bound work against a memory-bound calibration has this hole. CASKET's
gate had two calibrations, a bypass render and a real render, and both are dominated by
memory traffic and the limiter:

```
resample / bypass calibration     x5424
resample / NM.sin+cos throughput   x119
```

**The fix** adds a third calibration running the resampler's own inner shape through
`C._nm`, so it is provably the same NM instance and not a second copy that could drift.
A V8 change now moves calibration and measurement together.

**The size of that loop is measured, not chosen**, and the first draft was wrong:

```
  120,000 taps ->  calibration   2.7 ms   ratio spread 24.3%
1,200,000 taps ->  calibration  47.0 ms   ratio spread  0.6%
3,000,000 taps ->  calibration 121.0 ms   ratio spread  1.9%
```

At 120k the calibration was so short that timer noise swamped it and the gate would have
wobbled worse than the problem it fixed. 1.2M settles at 0.6%, steadier than the 1.8% of
the render yardstick it replaces.

**Verified:** 15 within tolerance, 0 regressed, exit 0. Estate lint 31 passed, 0 failed.
The two resampler entries were **renamed**, not re-blessed, because ms/render and ms/trig
are different quantities and reusing the key would have produced a confident, meaningless
percentage. Their old keys were removed from `casket_cpu_baseline.json`. They now report
as new and **still need blessing from a real runner** — nothing on aarch64 should be
written into that file as x86-64 truth.

**Lesson recorded, and it is the same one §7 keeps learning:** a gate is only as honest as
what it compares against. This is the twin of the UNDERWORLD gate rebuilt the same night,
which hashed three sibling projects' full state and called the result an UNDERWORLD
regression. Both were measuring something other than what their label claimed.

**Not fixed, deliberately:** if `NM.sin` itself gets slower and nothing else does, this
gate will now stay quiet. That belongs to `shared/`, not to CASKET, and would want its own
harness watching NM against `Math`. Recorded here rather than left as a silent hole.

### 2026-08-21 — `M_PI` was never ours to assume, and it cost a day of chasing the wrong bug

`shared/necromath.h` gains a guarded `#define M_PI`. Blast radius: every C++
core in the estate. **No computed value moves on any platform that was already
building** — the guard is a no-op wherever `M_PI` already exists, and the
literal is the same one glibc uses, verified bit-identical:

```
glibc M_PI  = 3.1415926535897931  0x400921FB54442D18
our literal = 3.1415926535897931  0x400921FB54442D18   BIT-IDENTICAL
```

**Why it was needed.** `M_PI` is POSIX, not ISO C++. glibc and libc++ hand it
out through `<cmath>`, so Linux and macOS never noticed; MSVC and MinGW do not,
unless `_USE_MATH_DEFINES` is set *before* `<cmath>` is first pulled in — which
no TU here can guarantee, since JUCE and the standard library both include it
ahead of us. **33 uses across five shipped headers were resting on a platform
accident.** Any Windows build of any plugin in this estate could not compile.

**How it hid.** CASKET's `windows-latest` cells failed at the audio/UI seam
step, which runs `g++ … handoff_stress.cpp` and then `./build/handoff`. That
step had no `shell: bash`, so Windows ran it in PowerShell, where a failed
compile does not stop the script. The visible error was:

```
The term './build/handoff' is not recognized as a name of a cmdlet…
```

A compile error wearing a runtime error's clothes. It was read as a threading
fault in the seam and hunted as a memory-ordering bug for a day. The step now
sets `shell: bash` so the compile failure aborts and prints as itself.

**Checked before landing:** AUTOPSY's regression baselines unmoved (the
tripwire's whole purpose), CASKET parity bit-exact at -O0/-O2/-O3, and a
bites-proof both ways — a TU that `#undef`s `M_PI` compiles with the guard and
fails with `'M_PI' was not declared in this scope` without it.

**Still open:** `NECROPHONE-repo/necrophone-juce/Source/NecrophoneCore.h` uses
`M_PI` but does **not** include `necromath.h`, so it is not covered by this fix
and will still fail a Windows build. NECROPHONE is outside the trilogy and was
left alone rather than edited from a CASKET session.

### 2026-08-18 — the nightly said 1,076 samples got out; the harness was wrong about the lid

`shared/` untouched; blast radius CASKET's harnesses, with a new LAW 2 rule for
all of them. **The engine was innocent and the test was broken**, which is the
better outcome and the more embarrassing one.

**What the first-ever nightly run reported:**

```
✗ 1076 samples over the lid (peak -0.7562 vs -0.76)
  seed 17183 style velvet lid -0.30 margin -0.46 drive 8.4
  lining 1 vigil 7.42 dust off @ 44100 Hz blk 7
```

**What was actually true**, from the reproduction:

```
Tdb                 -0.7562227341142583
engine lidLin       0x3fed54f167a58519   ← ND.dbToLin
harness Math.pow    0x3fed54f167a58518   ← one ulp LOWER
max |output|        0x3fed54f167a58519   ← exactly the engine's lid
output === engine lid ?  true
```

Every one of those 1,076 samples was the safety clamp doing its job perfectly.
The harness derived its ceiling with `Math.pow(10, dB/20)` while the engine
clamps with `ND.dbToLin` — **a LAW 2 violation in a test rather than in an
engine**, and nobody had thought to apply the law there.

**Why it took a 20,000-state nightly to surface.** The two spellings differ by
an ulp roughly seven times in ten across the fuzzer's lid range, and in only 29
of 20,000 probes does the engine's value land ABOVE the harness's — the only
direction that produces a false alarm. That rare direction then has to coincide
with an output sitting exactly ON the lid, which needs **`lining 1`** (no
oversampling, so the detector is exact on the samples themselves and the
limiter can land precisely on the ceiling) and **partial channel linking**
(`link 83`; at 100 the deeper channel's reduction pushes the other one under).
Change either and it vanishes. The push path's 1,500 states never reached it.

**This is LAW 5 with the boundary being the entire point of the program.** A
limiter's job is to land on the lid. "A legal value that is also a boundary
value" is not an edge case here, it is the design target, so any comparison
against the ceiling must use the ceiling's own arithmetic.

**Fixed:** eleven lid thresholds across seven CASKET harnesses now take their
ceiling from `ND.dbToLin`. Deliberately NOT changed: `Math.pow(10, -23/20)` and
friends that generate a test signal at some level — those are not thresholds,
and rewriting them would change generated material and move blessed hashes.

**Guarded:** `tools/estate_lint.js` now fails if any harness in any project
derives something named like a ceiling from `Math.pow`. All three pass.

**Also fixed, because a fuzzer nobody can re-run is decoration:** seeds are
`1000 + iteration`, so reproducing the reported seed 17183 meant re-running the
16,183 cases ahead of it — about three minutes to reach a case that takes
milliseconds. `casket_fuzz.js` gained `--seed=N[,N]` and `--from=N`. The
reproduction then took one command, and the whole 20,000 now pass.

**And the lint caught something none of this was looking for:** PALLBEARER had
arrived with a root workflow, and neither the workflow nor `PALLBEARER/` was in
the allowlist — so its sources were not in the repository AND its job could
never run. Half-done in both directions. Both admitted, and the lint now
asserts that a workflow and the directory it runs in are admitted *together*,
which is the invariant NECROPHONE's excluded `build.yml` is the deliberate
exception to.

**The rule:** *the laws apply to the test as well as to the thing under test.*
LAW 2 was written about engines. The one place it was never applied is the one
place that decides whether an engine is judged correct.

---

### 2026-08-17 — PALLBEARER v0.3: the twin keeps up, and the newest number becomes DERIVED

`shared/` untouched again. Ten more solo items on the fifth member.

**The five DSP changes, done as ONE round on purpose** so the baselines were re-blessed
once rather than five times: sympathetic coupling through a bridge bus, hand momentum in
the fingering brain, pickup coil resonance, position-shift noise, and a mean-reverting
drift walk under the per-note jitter. All eleven regression hashes moved, deliberately,
and the before/after is in `tests/regression_baseline.json`'s history.

**The coupling model was wrong the first time, in an instructive way.** v0.2 nudged an
envelope; v0.3 routes each string's bridge output into every other string's delay line.
The first attempt still measured nothing, because the render loop skips silent strings
and **a skipped string cannot receive anything.** An idle string on a real bass is not
absent — it is tuned, undamped and waiting. `prime()` sets a string up at its open pitch
without exciting it, and idle strings now run whenever coupling is on. That is also why
coupling is the expensive feature: measured at **2.6× the single-string reference**,
because every string computes every sample whether it was played or not.

**§1's PALLBEARER row is now DERIVED.** `tools/counts.js` gained a `pallbearer` entry and
rewrites the figure between markers like the other three. The previous edition of that row
carried **9,095** hand-typed with a footnote admitting it could go stale — and it went
stale inside a day, to **13,335**, exactly as §1 predicts. The argument for the generator,
demonstrated on the newest project rather than recounted about an old one. Estate totals
as measured today: **107,182** parity checks, **1,324** assertions, **65** baselines.

**The estate's first instrument-shaped plugin.** `IS_SYNTH TRUE`, `NEEDS_MIDI_INPUT TRUE`,
no input bus, sample-accurate MIDI, and a **version stamp in the state from day one** —
NECROPHONE's round-15 note is emphatic that a stamp cannot be added retroactively, so it
costs nothing now and is impossible later. A future state version is refused rather than
half-loaded. `tests/pallbearer_plugin_test.js` reads `Parameters.h` as TEXT and proves all
**37** parameters agree on id, range, default and — the dangerous one — **enum option
order**, since hosts store choice parameters as an index and a reorder silently rewrites
every saved session. It also checks each parameter is actually READ by the processor, a
failure no other gate can see: a parameter can exist, appear in the host, be automated,
and do nothing.

**A cost gate that does not cry wolf.** The first version took the median of five and
failed one run in three on a shared box for no reason. It now takes the **minimum of
seven** — noise on a shared machine is strictly additive, so the fastest observation is
the closest estimate of true cost — warms every case rather than only the reference, and
allows 50% drift. That is a coarse net by design: it catches a doubling, not a 20% slip,
and saying so is better than a tight number nobody trusts.

**Verified:** 188 assertions · 38 plugin-parity · 11 baselines byte-stable · 94,241 fuzz
cases · 13,335 parity checks bit-exact at **-O0, -O2 AND -O3** · 25 handoff checks · CPU
gate clean over five consecutive runs · embed byte-identical. Without LAW 1: **8,693 of
13,335 fail, worst 14,301,684 ulp.** AUTOPSY, RIGOR and CASKET regressions all still clean.

### 2026-08-16 (later the same day) — PALLBEARER gets its twin, and the fixture breaks LAW 2

`shared/` still untouched. PALLBEARER went from "no C++ twin, 120 assertions instead"
to a full member in one pass: `pallbearer-juce/Source/PallbearerCore.h`, an emitter, and
a gate. **9,095 parity checks, bit-exact**, including **3,822 samples of rendered audio**
across seven patch configurations — not just isolated arithmetic but the whole instrument
running: fingering, excitation, dice, loop filter, dispersion, pickups, buzz, body, drive.

**LAW 1 measured on this project, not quoted from another.** Compiled without
`-ffp-contract=off`: **6,379 of 9,095 checks fail, worst 825,202 ulp**, and the first
mismatch is `midiToFreq` at 1 ulp — the error enters at the very first transcendental and
compounds through the feedback loop from there. With the flag it is bit-exact at **-O0,
-O2 and -O3 alike**, which is the useful half of the result: the flag, not the
optimisation level, is what matters.

**Determinism had to come first.** `Math.random` in the excitation made a parity gate
impossible, so every stochastic term now runs off a 32-bit xorshift seeded per note.
JS bitwise ops coerce to int32 and `>>> 0` yields uint32, so `uint32_t` in C++ has
exactly those bits. This also bought round-robin variation for free — two hits of one
note differ, which is what a sample library spends disk space on.

**The finding worth carrying: THE FIXTURE ITSELF BROKE LAW 2.** On the first run 1,108
checks failed, every one of them in the attack-layer section, while all 3,822 rendered
audio samples were already bit-exact. The core was fine. The *test data* was built with
`Math.exp`/`Math.sin` on the JS side and `std::exp`/`std::sin` on the C++ side — 1–2 ulp
of v8-versus-libm drift, precisely what LAW 2 forbids. Rebuilt with no transcendental at
all: waveform from the portable xorshift, envelope from repeated multiplication by a
plain double literal. **A parity fixture must be at least as portable as the thing it
tests**, and that belongs in §8's checklist as much as anything about `shared/`.

**Porting is a code review.** Transcribing the JS into C++ surfaced a real bug the JS
harness had missed: `hardJit` was computed from the humanize amount and then never used,
so attack hardness never varied note to note. An unused local is easy to skim past in JS
and impossible to ignore when you are writing the same lines in a language that warns
about it. Fixed in the JS first, then mirrored — the direction the rule requires.

**Also landed:** attack-layer renderer (the hybrid and sampled paths now make sound),
velocity-brightness, fret buzz and release noise, a three-mode body (air + two wood
modes), playable articulations, 11 byte-stable regression baselines, an 86,648-case fuzz
harness, and a handoff test that runs the instrument through `chain.js` into all ten
delivery targets.

**Verified:** 160 assertions · 11 baselines byte-stable · 86,648 fuzz cases clean ·
9,095 parity checks bit-exact at -O0/-O2/-O3 · 25 handoff checks · embed byte-identical.

⚠️ **One correction to the entry below.** It said the C++ gates "were not executed" here
because there is no toolchain. **There is** — `g++ 11.4.0` at `/usr/bin/g++`. The earlier
check ran `which g++ clang++`, and `which` returns non-zero when *any* argument is
missing, so the absent `clang++` masked a present `g++`. The claim was honestly made and
wrong; the tool was the liar. Worth knowing before anyone else concludes this sandbox
cannot compile.

### 2026-08-16 — PALLBEARER joins as a fifth consumer of NM

`shared/` **untouched** — this is additive, a new reader of `necromath.js`, nothing
written. Blast radius therefore nil, and the §8 checklist was worked rather than
assumed. **Measured, not restated:** `autopsy_test.js` 70/70; the regression baselines
for all three re-run and byte-stable — AUTOPSY `placed 37eaf519` / `dynamic 61ee467f`,
RIGOR `factory_Synced_Pump 9546323d` / `factory_Inter_Sample_Catcher 6dce7f6d`, CASKET
`sealedDust 632de9e6` / `midside e3938d5d`.

**What was NOT run, and why the distinction matters here.** The C++ parity gates were
not executed: this sandbox has no toolchain, and running them is what CI is for. They
are unaffected because `shared/` was not written and no existing core was touched — but
"unaffected by reasoning" and "measured green" are different claims, and §1's whole
thirteenth-round lesson was that restating a number is not measuring it. Anyone wanting
the parity figures should take them from CI, not from this entry.

**What it is.** A physically modelled bass. Waveguide string with fractional-delay
tuning, stiffness dispersion, pickup-position comb filtering, body resonance, and a
fingering brain that chooses strings the way a player would. Lineage is MODO Bass
rather than Trilian, because a 34 GB sample library is a recording project and a
physics engine is a DSP project — and this estate does DSP.

**Its position in the contract, stated plainly rather than aspirationally:**

- **Consumes NM, shared.** Same reason as everyone else: bit-identical JS↔C++ output is
  the entire value, and a fork would drift. `pallbearer_sync.js` embeds NM ahead of the
  core and the harness asserts LAW 4 by byte position.
- **Does not consume ND, and should not.** It has no dynamics stage. An instrument that
  wants compression gets handed to RIGOR. Adding a second compressor to the estate to
  save one hop would be the kind of duplication §8 exists to prevent.
- **Has no C++ twin yet, so it has no parity gate.** §1's row says so. In its place are
  **120 assertions**, including measured tuning error (worst 0.089 cents across the
  range) and measured per-partial decay. That is not equivalent to parity and is not
  claimed to be — it is what exists until `PallbearerCore.h` does.
- **Interchanges as audio and as JSON.** Renders 48 kHz stereo WAV straight into the
  Underworld's chain; exports its patch as the flat sanitised parameter object.

**One finding worth carrying to the other projects.** The AudioWorklet loads a
concatenated NM+core via `addModule` as a **module**, where a top-level `var NM` is
module-scoped and never reaches `globalThis`, and there is no `require`. A core that
declares `var NM = globalThis.NM || require(...)` hoists a local undefined, shadows the
real NM, and holds null — **passing every node test and producing silence only in the
browser.** PALLBEARER names its local `_NM` so `typeof NM` can walk up the scope chain,
and its harness reproduces module scope inside a function body to gate it. NECROPHONE
uses its own NM copy and a different embed path so it is not exposed today, but anyone
moving a `*_core.js` onto shared NM inside a worklet will meet this.

**Verified:** 120/120 assertions green across three consecutive runs (the suite has
randomised excitation, so a single green run proves less than it appears to);
`pallbearer_sync.js --check` byte-identical; both embedded blocks parse under
`vm.Script`; AUTOPSY/RIGOR/CASKET suites unchanged.

### 2026-08-16 (thirteenth round) — the counts are DERIVED now, and the tool found two bugs in itself

`shared/` untouched; blast radius every document in the estate. This closes the
request the previous §1 footnote made in writing.

**`tools/counts.js` generates every live number in these documents.** Figures
are wrapped in HTML comments, which render as nothing:
`<!--c:casket.parity-->23,013<!--/c-->`. The script compiles and runs all three
gates at `-O2 -ffp-contract=off`, runs the asserting harnesses, and rewrites
what sits between the markers. CI regenerates and then runs
`git diff --exit-code` — the same shape as the parity gate emitting its header
and proving it did not move. Estate totals as of this round:
**93,847** parity checks, **1,062** assertions, **54** byte-stable baselines.

**Four decisions, each of which is the reason it works:**

- **Dates record when a figure last CHANGED, not when it was last confirmed.**
  Otherwise every run advances a timestamp, `git diff` finds it, and CI is red
  every morning for no reason — which trains people to ignore it. Idempotence
  is what makes a regenerator gateable at all. Verified: two consecutive runs
  produce a byte-identical cache.
- **Historical measurements carry no marker and are never touched.** "8,351
  mismatches out of 11,164" records what contraction did the day it was
  measured; rewriting it to today's total would invent an experiment nobody
  ran. **A number describing *now* is generated; a number describing *then* is
  evidence, and evidence is not maintenance.**
- **A red suite cannot publish a count.** A harness reporting failures, or
  printing no recognisable summary at all, raises instead of recording. Quietly
  counting a broken harness as nought assertions is exactly how a figure goes
  wrong without anyone noticing.
- **Partial runs merge rather than overwrite.** A full pass takes about ten
  minutes, which is longer than some environments let one process live.
  `--only=casket` measures one project and keeps the others' values *and their
  dates*, saying so on stderr.

**Two bugs, both found by the project's own rule that a gate is untrustworthy
until you have watched it fail.**

1. The unknown-marker path exited 2 with "documents untouched" **after
   rewriting four files**, because it scanned and wrote in a single pass. Now
   it plans the whole edit, validates it, and only then commits it. There is a
   regression test: corrupt a number *and* add a bogus key, and the corrupted
   number must still be corrupted afterwards.
2. The first CI step drafted for this would have gone red every day, for the
   date reason above. Caught before it shipped, by asking what the second run
   would do rather than what the first one did.

**Corrections this shook out**, all measured rather than reasoned:
`RIGOR_ARCHITECTURE.md` read **36,998** against a gate reporting **61,694**;
`AUTOPSY/README.md` read **5,176** against **9,292**. Both had been wrong for
rounds. Neither would have survived a day with the marker in place.

**The rule:** *a restated number is not a measured one.* Same lesson as "an
assertion that names its expected value is not checking anything" — the figure
and the thing it describes have to be connected by something that runs.

---

### 2026-08-16 — the suite is told that something consumes it, and told not to care

Until now these four projects had **zero** knowledge that Masterbox exists. New §5.1 records the external consumer, quotes LAW 0, and states the single obligation it creates: the public surface (`sanitizeState`, `process`, `latencySamples`, and the three state-file formats) is now a **published API**, so renaming or rescaling a state field is a breaking change needing a structural migration and a line here. Adding a field stays free.

**Written with Ben's explicit permission**, which the Charter's enforcement note required, because the edit crosses into the trilogy's territory from outside it.

**The framing is the point, and it was the reason to think before writing.** The risk of making these projects "aware" is not that they learn a fact; it is that a session starts *designing for* the consumer, at which point the dependency has inverted and LAW 0 is broken in spirit while every line of code still obeys it. §5.1 therefore leads with the prohibition (do not design for it, do not test against it, do not accept its bug reports as debt) and only then states the obligation. **A one-way boundary has to be defended from the consumed side too, not only by the consumer's good manners.**

**Blast radius: documentation only.** No code, no `shared/`, no hashes, no parity file, no test touched in any project. Nothing in any core imports, references, or behaves differently because of Masterbox, and §5.1 says so explicitly so a future reader does not infer coupling that is not there. AUTOPSY, RIGOR, CASKET and NECROPHONE were not run, because nothing was changed that could move them.

Companion documents, both outside this suite's folders: `UNDERWORLD_CHARTER.md` (LAW 0, written by the Masterbox session) and `UNDERWORLD_INTERCHANGE.md` (the seam's mechanics — preset schema, translator verification, the build-flag boundary, module collision, write territory).

**One finding from that work belongs here rather than there,** because it constrains anyone who ever links these cores into another build: **the parity law is a property of the BUILD, not only of the source.** LAW 0 permits an external caller to drive the cores' public API, which in C++ means compiling these headers under someone else's build system. Compile `CasketCore.h` without `-ffp-contract=off` and 8,351 of 11,164 parity checks fail, worst 9,805 ulp, oversampler taps first. LAW 1 does not travel with the header on its own; it has to be carried deliberately, `shared/` must not be forked into the consuming build, and the parity gate must be re-run **in that build** rather than trusted from ours.

---

### 2026-08-16 (twelfth round) — CASKET: the estate is a git repository, and five CI defects that had never run

`shared/` untouched; blast radius CASKET plus the repository root. Logged because
the repository boundary is now an estate-wide fact and because the parity law
turned out to be enforced on a binary nobody ships.

**The estate is a git repository rooted at the CLAUDE folder,** with an allowlist
`.gitignore` that denies everything and then admits `shared/`, the three project
directories and their documents. Rooting here rather than inside `CASKET/` is
forced, not chosen: GitHub reads workflows only from the repository root, and
CASKET reaches outside itself three ways (`../shared/necromath.js`,
`../shared/necrodyn.js`, and `../AUTOPSY` for the tripwire). The allowlist form
matters because the root also holds 2.9 GB of unrelated work including browser
captures with live session credentials. A denylist is a list of the mistakes
somebody thought of in advance.

**Five defects in a workflow that had never executed.** Each would have failed on
the first run, and four of them at the last step of an expensive job:

| defect | consequence |
|---|---|
| `auval -v aufx Cskt Necr` | CMakeLists declares `PLUGIN_MANUFACTURER_CODE Basy`. Asked macOS for a component that does not exist. |
| tripwire opened `cd ../AUTOPSY` | Walked out of the checkout. Broken under every possible repository layout. |
| soak invoked with no argument | Default is 20 minutes **per arrangement** and there are five; the step needed 100 under a `timeout-minutes: 90`. Could only go red. |
| `Casket.vst3` / `Casket.component` | Artefact *directory* takes the CMake target name, artefact *files* take `PRODUCT_NAME`, which is `CASKET`. Passed only by the runner's case-insensitive APFS. |
| `casket_tools_fuzz.js 60` | Past 200 s on a machine where the whole rest of the suite finishes inside 300. Trimmed to 25 on the push path, full strength nightly. |

**The parity law was compile-only, and the plugin links LTO.** `target_compile_options(Casket PRIVATE -ffp-contract=off)` governs an intermediate; with
`juce_recommended_lto_flags` the arithmetic is generated at link time under flags
the gate never measured. `casket_parity` builds without LTO, so **the gate was
proving bit-exactness for a binary nobody runs.** Fixed at the source
(`target_link_options` as well) and gated by a new `casket_parity_lto` target
that links the plugin's own LTO interface, so the gate and the product share a
flag set by construction.

**Measured before believing, and the control was run first.** On GCC/Linux,
`-O2 -flto -ffp-contract=off` passes all 22,861 checks; `-O2 -flto` with no
contraction flag **breaks parity outright**, worst case `quantize(-0.05, 0.1)` —
the negative exact half this log already records as where the two spellings of
rounding diverge. So LTO is survivable, the flag is what makes it survivable, and
the check is capable of going red. The shipping plugin is built by Clang on
macOS, which is why the measurement belongs on CI rather than on one machine.

**§1 corrections, both measured by running the gates rather than reading the
table:** CASKET 22,563 → **22,861**; RIGOR's row read **50,718** and the gate
reports **61,694**. Two different stale numbers for RIGOR were in circulation in
the same hour.

**The rule:** *a workflow that has never run is not a gate, it is a wish.* Five
first-run failures sat in a file that read as finished, and the only reason they
were cheap is that nobody had pushed yet.

---

### 2026-08-16 (eleventh round) — the substrate hang is fixed, and it was never only about infinity

`NM.log`, `NM.log10` and `NM.exp` looped forever rather than returning, so
`ND.linToDb(±Inf)` and `ND.dbToLin(±Inf)` hung the audio thread — a frozen DAW
needing a force quit, from one bad sample any upstream plugin can produce.
Referred out by RIGOR's tenth-course audit; fixed here with Ben's permission.

**The referral understated the defect.** It described non-finite arguments. But
`twoPow` loops `k = floor(x/LN2)` times, so a **legal, finite** `1e308` asks it
for 1.4e308 iterations. That is the same hang with no infinity anywhere in
sight, and `±Infinity` is merely its obvious face (`k--` on an infinity is still
that infinity). Found because the snapshot written to *prove the fix inert* hung
on its own first run.

Also fixed: `NM.log`/`log10` looped on `0` and on negatives (ND guarded those two
before they arrived, which is why nobody had seen it), and `sincos_` in the C++
twin cast a non-finite double to `long long` — **undefined behaviour**, not
merely a wrong answer, where the JS returned NaN. The two languages now agree on
purpose rather than by luck.

**NaN was always fine in all of them, purely by accident:** every comparison
against NaN is false, so it fell straight through every loop. That accident is
exactly why the suite's many NaN assertions never caught any of this, and why
the fuzzers didn't either — they hammer the STATE and had never once handed the
substrate a bad ARGUMENT.

**Every guard is a comparison; no arithmetic changed.** For any argument that was
already legal, all guards are false and the original op order runs untouched.
Demonstrated rather than claimed: **30,075 arguments × 6 functions = 180,450
values**, snapshotted before the edit and compared bit-for-bit after, by raw
64-bit pattern rather than `===` (which cannot distinguish −0 from 0 and calls
NaN unequal to itself). All identical. JS and C++ then agreed bit-for-bit on all
20 guard cases.

**Blast radius, verified read-only across every consumer:**

| | verified |
|---|---|
| RIGOR | core 233 · UI 114 · lint 28 · fuzz 18 · audits 46 · stress 50 · 35 hashes unmoved · **parity 61,694 bit-exact** · mutation 11/0/1 · coverage `--strict` clean |
| AUTOPSY | core 70 · UI 68 · hashes unmoved · **parity 9,292 bit-exact, recompiled against the modified header** |
| CASKET | core 186 · UI 76 · hashes unmoved |
| NECROPHONE | **was never exposed** — zero `shared/` references and no hand-rolled transcendental of its own |

That last row **corrects the audit's guess**, which had assumed all three
siblings shared the exposure.

Nothing outside `RIGOR/` and `shared/` was written. AUTOPSY, CASKET and
NECROPHONE were only *run*.

**The rule:** *a total function is not one that handles the values you thought
of — it is one that returns.* Every previous bug in this suite lived at a legal
value that was also a boundary value (LAW 5). This one lived at a legal value
that was merely **large**, which is a boundary nobody had drawn.

---

### 2026-08-16 (eleventh round) — RIGOR: the bypass that lied has been fixed, and it had a second half

Reported by CASKET's round 6 and left as out of its remit. Both halves were
measured before either was touched.

1. `latencySamples()` reports the lookahead in **every** state, and bypass is a
   state. At `look = 10 ms` the promise was 480 samples and the bypassed impulse
   came out at **sample 0**. A host compensating by the reported figure moved
   the audio 10 ms *earlier* the instant you pressed bypass — enough to comb
   against a parallel path, more than enough to read as a tone change. **Every
   A/B a RIGOR user performed with lookahead on was invalid.**
2. **The half nobody had noticed:** the delay line was not being *fed* while
   bypassed, so it held stale samples across the toggle. After un-bypassing at
   `look = 10 ms`, the first 480 samples out were **digital silence**. A dropout,
   every time you left bypass.

Both fixed by pushing bypassed audio through the line, the same shape as
CASKET's round 5 fix. Asserted at five lookahead settings, with the expectation
**derived from `latencySamples()`** rather than named.

**And a new finding underneath it: multiband bypass was not a bypass.** At 2+
bands the "bypassed" signal still ran the crossover and was re-summed —
magnitude-flat to 0.06 dB but not bit-transparent, which breaks §4's null-test
law. Shipped as a switch rather than a fix, on Ben's call, because both answers
are useful: `bypassSplit` off (default) gives the dry signal bit-identically
("what is this plugin doing to my track?"), on gives split-and-re-summed
("what is the *compression* doing?", with the crossover on both sides of the A/B
so it cancels out). Inert at 1 band and inert while compressing, both pinned by
parity cases rather than trusted.

**Relevance to the suite:** AUTOPSY exports no `latencySamples` so the question
does not arise there, and CASKET fixed its own version in round 5. **This closes
§6 question 4 for all three.**

---

### 2026-08-16 (eleventh round) — RIGOR: the advice function now verifies itself, and the error had a shape

§7's evening entry recorded `suggestThreshold` as off by a "systematic and
monotone in ratio" −0.10 dB at 2:1, −0.15 at 4:1, −0.17 at 8:1, −0.19 at 20:1,
and could not account for the shape.

**The shape is the whole answer.** It took the *centre* of whichever histogram
bin held the 90th percentile. 200 bins across 80 dB is 0.4 dB wide, so up to
0.2 dB of bias fed straight into the threshold — and a threshold error `e`
becomes a gain-reduction error of `e × (1 − invR)`, which runs 0.50, 0.75,
0.875, 0.95 across those four ratios. Normalise either row by its first entry
and both read **1.00, 1.50, 1.75, 1.90**. It was one quantisation error wearing
four hats.

Interpolating within the bin takes the worst error to **0.0032 dB** across three
materials and four ratios. The assertion checks against a p90 computed by
**sorting the raw samples**, not by the histogram under test, so it cannot pass
by agreeing with itself.

**This closes §6 question 5.** RIGOR was the last program applying "advice must
be verified" unevenly.

**The rule:** *an error with a shape has a cause; an error you call noise is one
you have not looked at yet.*

---

### 2026-08-16 (eleventh round) — RIGOR does NOT need the falling-ceiling asymmetry, and the reason is structural

CASKET's smoothed lid could not track a ceiling automated downward and was given
tighten-instantly/loosen-smoothly. The log passed the question to RIGOR, which
smooths `thresh` the same way. **Checked, and the answer is no.**

The law §7 already states is the right one: *a smoothed parameter that BOUNDS
something needs the asymmetry; one that merely COLOURS something does not.*

- `thresh` is smoothed and **bounds nothing**. A compressor threshold is where
  reduction begins, not a ceiling it promises. Glide it and you get slightly
  less compression for a few milliseconds; nothing is exceeded because nothing
  was guaranteed. Measured symmetric: 30 control blocks down, 30 up.
- `range` **does** bound something (maximum reduction) and is therefore the one
  that would matter — and it is **not smoothed at all**. 74% of a range move
  lands in the first control block, where `SMOOTH = 0.25` would cap it at 25%.
  Immune by construction rather than by care.

There *is* a residual overshoot when `range` is automated downward, and it is
not this bug: it scales with the **release** time (0.52 dB at 1 ms, 7.46 dB at
800 ms), because the gain computer clamps instantly while the envelope has to
release up to the new clamp. An envelope that lags is what an envelope is.
Snapping it would trade a controlled release for a click.

**Relevance to the suite:** CASKET remains the only program that guarantees a
ceiling, which is why it is the only one that needed the fix — and why §5's
ordering rule (limiter last, and CASKET has no output trim) is the same fact
seen from another angle.

---

### 2026-08-16 — AUTOPSY hardened: the two checks this document ordered both found bugs
`shared/` untouched; blast radius AUTOPSY only — logged because two §6 questions closed and the §1 parity count moved.

**Block-size independence (the "highest-value thing to check in both"): AUTOPSY had it.** Same disease as CASKET's, same signature — every multiple of 32 bit-identical, primes diverging to **−16.9 dBFS** during a glide, −59 dBFS at the 441-sample buffers real 44.1 k hosts use. Same fix (`ctrlPhase` carried across calls), proven over 17 chunkings, pinned in the parity gate by a split-buffer render the twin can only pass by carrying the phase. Zero hashes moved (single-call renders keep their schedule).

**And a second bug the new fuzzer found on its first run, keeping the suite's streak alive:** fresh engines had no snap-on-first-setState — output gain/pan FADED IN from defaults over the first control blocks, and `reset()` could not reproduce a first render. First setState now snaps; `reset()` is asserted fresh-engine-equivalent. **Three of five hashes moved and were re-blessed deliberately** (extremes/placed/dynamic — the three with nonzero output trim; flat and surgical survived untouched, which is its own evidence the change did exactly what it claims and nothing else).

**Also:** denormals flushed by contract in both bodies (178k subnormal samples measured in a silent tail; the plugin's `ScopedNoDenormals` was already making the two deployments disagree — dn() makes the flush arithmetic, not environment); parity gate now covers 44.1 k and 96 k renders (**5,176 → 9,292**, bit-exact); AUTOPSY gained the two-direction plugin lint this document said it lacked (15 checks, found CI missing three harnesses), a seeded fuzzer, audits (incl. §6.5 advice verification), a bench (worst case 59× realtime), a bespoke plugin editor, and a from-scratch architecture doc replacing the v0.1 sketch.

**Verified per §8:** AUTOPSY full battery green (core 70, UI 68, regression 5, parity 9,292, lint 15, fuzz, audits). RIGOR, CASKET and NECROPHONE harnesses re-run and unchanged — read-only verification, nothing of theirs was touched.

### 2026-08-16 (round 6) — RIGOR does not delay its bypassed signal, and it has lookahead
**Answering question 4, which CASKET raised after fixing the same bug in itself.** One impulse, bypass on, lookahead swept:

| RIGOR `look` | reports latency | bypassed impulse delayed by | verdict |
|---|---|---|---|
| 0 ms | 0 | 0 | honest |
| 1 ms | 48 | **0** | **lies by 48 samples** |
| 5 ms | 240 | **0** | **lies by 240 samples** |
| 10 ms | 480 | **0** | **lies by 480 samples** |

A host compensating by the reported figure moves the audio up to **10 ms EARLIER** the instant you press bypass. That is enough to comb against a parallel path and more than enough to read as a tone change, which means **every A/B a user performs in RIGOR is invalid whenever lookahead is on.** CASKET shipped this exact defect and fixed it in round 5 with a delay line pushed on every sample so that toggling mid-stream finds it primed.

**Reported, not fixed** — RIGOR is out of CASKET's remit. **Blast radius:** RIGOR only; AUTOPSY exports no `latencySamples` at all, so the question does not arise there. **The rule:** *a bypass that does not delay is a bypass that lies, and the lie is invisible until somebody trusts it.*

### 2026-08-16 (round 6) — the offline tools are in the C++ twin, and the gate that guards them was vacuous
All seven offline tools (`renderOffline`, `autoDrive`, `autoMargin`, `difference`, plus `meterBuffer`, `truePeakOf`, `quantize`) now exist in `CasketCore.h`, bit-exact against JS across 285 new parity checks.

**The part worth recording is that the new gate did not work at first and looked like it did.** The parity cases used 4,096-sample buffers — 85 ms. BS.1770 integrates 400 ms blocks, so `integrated` was `-Infinity` at every drive, `autoDrive` took its "nothing measurable" early-out six times out of six, and every check passed **vacuously**. A mutation test proved it: deleting the rail probes from the C++ twin changed **not one of 22,848 checks**. Three separate mutations passed. Moving the cases to 24,000 samples made the same mutation produce 49 mismatches.

**The rule, which generalises past this project:** *a new gate is not trustworthy until you have watched it fail.* Write the mutation, run it, confirm the red, then revert. A gate that has only ever been green is a hypothesis.

### 2026-08-16 (round 6) — `quantize` is now a named, gated function in both twins
The expression that rounds a control to its grid was inline in three places. The two obvious spellings are **not the same function**: `round(x/0.1)*0.1` and `round(x*10)/10` disagree at exact halves (0.35 → 0.3 versus 0.4) and in the last bits elsewhere (−9.75 → −9.700000000000001 versus −9.7). Bisection midpoints over a 36 dB range are dyadic and land on exact halves regularly.

While it was inline **the parity gate could not see the difference** — swapping one spelling for the other in the C++ twin passed all 22,848 checks. Giving it a name is what made it gateable; it now has 13 dedicated checks over the values where the spellings diverge, and both the wrong-spelling and `std::round` mutations are caught.

Note for anyone porting: `std::round` rounds halves **away from zero**, JS `Math.round` rounds them **toward +Infinity**. They disagree on every negative half. Use `std::floor(x + 0.5)`.
**Blast radius:** CASKET; RIGOR and AUTOPSY both quantise controls inline and neither is gated on it.

### 2026-08-16 (evening) — ND.kneeOut FIXED at the source, and what made it safe to touch
The latent defect logged this morning is closed. `kneeOut`'s two above-knee branches now short-circuit `invR === 0` to `T` instead of computing `T + d * invR`, in both `necrodyn.js` and `necrodyn.h`.

**Why this could be done to a file with three sealed suites behind it:** the short circuit is *provably bit-exact on the whole finite domain*. For any finite `d`, `T + d * 0` is `T + 0` is `T` — the same double, not a near one. Verified across **841,100 points** sweeping T, W and x before the change was committed, and that sweep now lives permanently in `casket_nan_audit.js`. It is also unreachable for NaN, because NaN fails `d > W/2` and still falls through to the knee branch and still comes out NaN, so a caller's error is still reported rather than swallowed by the guard.

**Verified across every consumer, per §8.** AUTOPSY: 56 core / 59 UI / 5 hashes unmoved / **5,176 parity bit-exact** / `parity_expected.h` byte-identical on re-emit. RIGOR: 198 core / 114 UI / 27 plugin lint / hashes unmoved / **36,998 parity bit-exact**. CASKET: full suite, **22,563 parity bit-exact at −O0, −O2 and −O3**. All three `*_sync.js` re-run; RIGOR's UI harness caught its stale embed immediately, which is LAW 4 doing its job for the second time.

**CASKET's local workaround was REMOVED in the same pass, on purpose.** `transferAt` had been substituting ±1e300 for an infinite input. Leaving that in place would have meant the shared fix was never reached by the only program in the suite that can exercise it. **A fix at the source that nothing reaches is a fix nobody has verified** — when you repair something in `shared/`, delete the workaround that was standing in for it, or you have two untested code paths instead of one.

**Blast radius:** `shared/` — every consumer. **The general rule:** *a change to shared code is safe in proportion to how large a domain you can prove unchanged.* Not "it looks equivalent". A sweep with a number attached is what buys the right to edit a sealed file.

### 2026-08-16 (evening) — bypass had no delay and reported one anyway
Found while chasing the last four ten-thousandths of the latency-pad bias, and much worse than the thing it was hiding behind. CASKET's `process()` wrote `outL[s] = xl` when bypassed — **zero delay** — while `latencySamples()` went on reporting the full figure, 113 samples at 48 k. A host compensates by the reported number in both states, so **toggling bypass moved the audio 2.35 ms earlier.**

That breaks the one thing bypass is for. An A/B whose two sides are not time-aligned is not an A/B: against a parallel path it is a comb filter, and on its own it reads as "the bypassed version sounds tighter", which is a timing shift wearing a tone control's clothes. Fixed with a dedicated `nd::Delay` of exactly `lat`, **pushed on every sample whether bypassed or not**, so toggling mid-stream finds the line already primed instead of clicking through 113 samples of silence.

**Blast radius:** CASKET, plus one deliberately re-blessed parity value (see below). **But the question generalises immediately, and neither has been checked:** AUTOPSY and RIGOR both report latency and both have a bypass. *Does either of them delay its bypassed signal?* This is the highest-value thing to look at in both, and it is cheap: feed an impulse, bypass, and see whether it comes out where `latencySamples()` says it will. **The rule: reported latency is a promise about EVERY state, and bypass is a state.**

**One parity value re-blessed, deliberately.** `EXP_LRA[1]` and `[3]` moved by ~3e-4 LU because that case meters a two-level programme *through a bypassed engine*, which now carries leading silence. Understood, correct, and written down here rather than shrugged at. Two explicit `bypassed` / `bypassSealed` render cases were added to the gate in the same pass so the twin has to reproduce the delayed samples themselves rather than only a fourth decimal of LRA — the count went 20,615 → 22,473, then → 22,563 with the new display trace.

### 2026-08-16 (evening) — the latency-pad bias is closed, and it took two bugs
`renderOffline` now meters the samples it RETURNS, with a fresh meter, instead of letting the engine's meter run over the padded buffer. That took the one-track-album self-offset from **−1.37e-3 LU to −4.24e-4** — and stopped there, because the remainder was the bypass bug above wearing the first one's coat: `albumLoudness` measures through a bypassed probe, so `renderOffline`'s unconditional latency compensation was trimming 113 real samples off the front of the record. With both fixed the offset is **exactly 0**, and the harness now asserts exact zero rather than an epsilon.

**Why leading silence moves a gated measurement at all**, since silence is gated out: BS.1770 integrates 400 ms blocks built from 100 ms sub-blocks, and `lat` samples of silence shift *every block boundary* relative to the music. Different boundaries, different block energies, a different set of blocks surviving the relative gate.

**Blast radius:** every loudness figure CASKET reports moved by ~1.5e-3 LU. No regression hash moved, because the audio never changed — only the number describing it. **The rule, now demonstrated twice in two days:** *an epsilon in an assertion is a place a second bug can hide.* The first fix reduced the residue and a looser threshold would have called that done.

### 2026-08-16 (evening) — RIGOR has no bisection, and being wrong is the finding
The Fourth Sitting predicted RIGOR carried the same rails bug and told this round to audit it. **The prediction was wrong.** There is no bisection anywhere in `rigor_core.js` — `grep` for midpoint arithmetic returns nothing. Its two advice functions take entirely different shapes: `autoMakeupDb` is **analytic** (the gain computer evaluated at 0 dBFS and negated, deliberately, so it stays a pure function of the params and byte-stable regression survives), and `suggestThreshold` is a **histogram percentile**, not a search.

**But there is a real cross-project finding underneath it, and it is the OTHER rule.** `suggestThreshold` returns advice and never verifies it. So it was verified here, read-only, on three seconds of clipped noise: it lands within **0.10–0.19 dB** of the requested gain reduction — better than expected — but the error is **systematic and monotone in ratio** (−0.10 at 2:1, −0.15 at 4:1, −0.17 at 8:1, −0.19 at 20:1), not noise. A systematic error is correctable; the reason nobody has corrected it is that nobody has measured it. **No RIGOR code was changed.**

**The rule this reinforces:** *the suite has an "advice must be verified" law and it is being applied unevenly.* CASKET's `autoMargin`, `autoDrive` and `albumMaster` all render to check. RIGOR's `suggestThreshold` does not. An offline helper has the time; there is no excuse for guessing.

### 2026-08-16 (evening) — a wrapper can hide a whole feature, and a compiler will not tell you
CASKET gained `tests/casket_plugin_test.js`, modelled on RIGOR's lint but with **one check RIGOR's does not have, and it is the one that found things.** RIGOR's lint verifies that everything the plugin *names* exists. CASKET's also verifies the reverse: **that everything the CORE offers is reachable from a host.**

That direction found `ms`, `msMid` and `msSide` — mid/side, fully implemented in the JS core, fully mirrored in the C++ twin's `State`, fuzzed, parity-checked, carried through four rounds of reports — **and with no APVTS parameter, so no DAW could reach any of it.** Omitting a parameter is not a compile error. It is a feature that silently does not exist.

Four more came out of the same file on its first run: an editor writing two history rings from one value and drawing neither honestly; a "scrolling" display that was actually sampling a running maximum at 30 Hz, so it could only ever climb to a plateau; `.resize()` on the audio thread whenever a host sent a longer block than it promised; and a CI workflow that had not been told about a harness.

**Blast radius:** the pattern, not the code. **The rule: every completeness check has two directions and the boring one is the one that finds things.** "Does everything named exist" catches typos. "Is everything that exists reachable" catches whole missing features. AUTOPSY has 146 parameters and no lint of either kind.

### 2026-08-16 — ND.kneeOut returns NaN at infinite ratio, and only CASKET can reach it
A NaN sweep of CASKET's whole public API found `transferAt(state, Infinity)` returning NaN. The cause is in **shared/necrodyn.js**, not in CASKET:

```
function kneeOut(x, T, W, invR) { ... if (d > W/2) return T + d * invR; ... }
```

With `d = Infinity` and `invR = 0` that is `T + (Infinity * 0)` — and `Infinity * 0` is NaN. A **limiter is invR = 0 by definition**, so CASKET is the only program in the suite that can trigger it; `kneeOut(Infinity, …, 0.25)` returns Infinity, which is ugly but survivable, which is why RIGOR has never seen it.

Guarded on CASKET's side (an infinite decibel is not a legal point on a transfer curve) rather than in `shared/`, because AUTOPSY is sealed and the shared fix deserves its own deliberate change with all three suites re-run.
**Blast radius:** the latent defect is in `shared/`; only an infinite-ratio caller reaches it. **The rule:** this is the second entry in this document about handing an unbounded input to a shared helper — the first was `NM.exp` spinning on a large argument. **Assume every shared helper has a domain, and that nobody wrote it down.**

### 2026-08-16 — bisection never evaluates its own rails
`autoDrive` and `albumMaster` both search a drive range of −12…+24 dB by bisection, and bisection computes **midpoints** — so after eight halvings toward the floor the closest probe is −11.86, and the endpoints are never visited at all. Whenever the honest answer was "as far as this control goes", both returned a value short of the rail and silently left up to a third of a dB unused. Both now probe `lo` and `hi` before bisecting, at a cost of two extra offline renders.
**Blast radius:** CASKET only, but RIGOR bisects for its own auto-makeup and should be checked. **The rule, which is LAW 5 wearing a different hat:** *a search that never evaluates its own boundaries cannot return a boundary answer* — and the boundary is where every bug in this suite has lived.

### 2026-08-16 — autoDrive reported a figure for a state nobody rendered
Companion to the autoMargin bug logged the day before. The bisection was honest — every loudness it tracked came from a real render — but it returned the figure measured at a **raw bisection midpoint**, and the browser then did `state.drive = Math.round(r.drive*10)/10` before applying it. The number shown to the user was therefore the loudness of a drive setting that was never in force. It also had no way to say it had **failed**: on material the limiter is already flattening, the target can be unreachable and the old return value looked identical either way.

Now it quantises to the caller's grid **first**, renders once more at that exact value, and reports only what that render measured, plus `reached`. One trap worth recording: `Math.round(x/0.1)*0.1` and `Math.round(x*10)/10` **disagree at exact halves** (0.35 → 0.3 versus 0.4), so the core and the UI must quantise by the same expression or the whole exercise is undone.
**Blast radius:** CASKET only. **The rule:** *quantise before you verify, and verify at the value the caller will actually use* — verifying a number you are about to round is verifying the wrong number.

### 2026-08-16 — every loudness figure in the suite is measured with the latency pad attached
`renderOffline` pads its input by the plugin latency and the **meter runs over the padded buffer**, so every LUFS this project reports is the loudness of the signal with a few milliseconds of leading silence stapled to it. It is systematic, about **1.5e-3 LU**, and identical everywhere — which is exactly why nothing has ever caught it. It only became visible when album mode metered the same audio twice with the pad in two different places.

Not fixed. Teaching the meter to skip the pad moves every reported LUFS in the project and belongs in its own round with fresh baselines. Asserted at its measured size in `casket_album.js` so that if it ever **grows**, something fails.
**Blast radius:** every loudness number in CASKET; RIGOR and NECROPHONE meter differently and are unaffected. **The rule:** *a bias that is the same everywhere is invisible everywhere* — it takes measuring one thing two ways to see it at all.

### 2026-08-15 — CASKET: two bugs in the offline tools, found the day they were first fuzzed
`autoDrive`, `difference`, `matchReference` and `autoMargin` all do arithmetic on user audio, were added quickly, and had never seen a random state. A tools fuzzer found two failures in its first 40:
1. **`matchReference` returned NaN** when both inputs measured `-Infinity` — i.e. two silent buffers, which is what dragging in the wrong file looks like. `-Inf − (-Inf)` is NaN. A gap that cannot be computed is now `null`, which a UI renders as an em-dash; NaN prints as "NaN dB".
2. **`autoMargin` claimed `covered` on a render still 0.554 dB over.** It estimated the margin from a single render at margin 0, assuming the residual shrinks one-for-one with the margin. It does not — lowering the threshold changes *where* the limiter engages, so the true peak moves nonlinearly. It now iterates and **re-renders to verify**, and `covered` is a statement about a measurement rather than a prediction.
**Blast radius:** CASKET only. **The transferable rule:** *any function that returns advice should verify the advice before calling it advice* — an offline tool has the time, so there is no excuse for guessing. And **dB arithmetic must guard `-Infinity` at every subtraction**, because silence is a legal input everywhere in this suite.

### 2026-08-15 — CASKET: the control-block phase must cross `process()` calls
`control()` fired every `CTRL` samples **of call time** rather than of stream time, so its boundaries landed at different points depending on the host's buffer size. Measured: 240- and 1200-sample buffers diverged from 4800-sample ones by **−37 dB** during a parameter glide, while every multiple of 32 agreed bit-for-bit — which is exactly why nothing caught it, since every test and every plausible buffer size people reach for first is a power of two.
**Fix:** a persistent `ctrlPhase` carried across calls. Seventeen buffer sizes including primes now render bit-identically, and the parity gate gained a `split` case rendered in 111/333/7/1024/240-sample chunks so the C++ twin has to carry the phase too.
**Relevance to the suite:** **every core here blocks at `CTRL = 32` the same way.** AUTOPSY and RIGOR both restart their control counter per call. Neither is proven block-size independent, and a plugin whose audio changes when the host changes its buffer size cannot be A/B'd against itself. This is the highest-value thing to check in both.

### 2026-08-15 — CASKET: a smoothed threshold cannot track a falling ceiling
Automation stress (`tests/casket_automation.js`, setState between every 64-sample block) found the lid exceeded by **+2.37 dB** when the ceiling itself is automated downward. Cause: `lid` was smoothed symmetrically, so for a dozen control blocks the gain computer was still working to the *old*, higher threshold while the user had already asked for a lower one.
**Fix:** the threshold now **tightens instantly and loosens smoothly** — `if (target < current) current = target; else smooth()`. Same asymmetry the release envelope uses, same reason: the safe direction may be slow, the unsafe direction may not. Sweeping a ceiling downward *is* a gain change, so snapping it introduces no artefact the user did not ask for.
**Relevance to the suite:** RIGOR smooths its threshold too, and its `thresh` is equally automatable. **Any smoothed parameter that bounds something needs this asymmetry**; a smoothed parameter that merely colours something does not. Worth checking RIGOR's `thresh` and `range` against this.
**Verified:** static-state hashes unmoved (they snap on first setState), 19,686 parity checks still bit-exact, 176 core / 69 UI green.

### 2026-08-15 — ND.boxcar drift is a random walk, and must be asserted RELATIVE
A soak over 8.6 M samples per arrangement showed the running sum's error scaling with the **magnitude of the sum**, not with the number of pushes: measured 3.4e-13 to 1.2e-11 relative across the five CASKET arrangements, and flat from 100 k to 6.4 M pushes. An absolute threshold therefore passes at one boxcar length and fails at another for no reason connected to correctness — which is exactly what happened, twice, at 1e-9 and again at 1e-11.
**No code changed.** The threshold was wrong, not the boxcar. Every consumer should assert `|sum − recompute| / |recompute|`, and in gain terms 1e-11 relative on a 193-tap window is ~1e-13 dB.
**Blast radius:** any ND consumer that soaks. RIGOR's harness should adopt the same form.

### 2026-08-15 — RIGOR: the plugin reconnects, and a lint that needs no compiler

The JUCE sources had gone stale against the ND lineage — the processor was
still writing `s.sc.on` and `s.lookahead`, fields this core does not have, so
the plugin could not have compiled. Rebuilt onto `rigor::Multi` with a
41-parameter APVTS including the multiband set.

New: `tests/rigor_plugin_test.js`, a **static lint on the JUCE sources**. There
is no JUCE in the sandbox, so the first real build happens on CI — but the
failures this project has actually produced do not need a compiler to catch.
It checks that every parameter the editor binds exists in the layout, that no
parameter is wired to two controls, that every state field the processor writes
exists on the core, that every `proc.*()` the editor calls is declared, that the
twin mirrors the core's surface, and that laws 1 and 2 hold in CMake, CI and the
header. It found six real gaps on its first run.

Also added: tempo-synced release, oversampled (true-peak) detection, analytic
per-band makeup, and `tests/rigor_bench.js` for a measured CPU figure. Parity
now **24,833 bit-exact**.

**Worth carrying: tempo lives in the STATE, not in a host callback.** The
processor reads the playhead and writes BPM into `rigor::State`; the DSP never
asks anyone for the time. A synced release therefore stays a pure function of
the case file, which is the only reason byte-stable regression can survive a
feature that is nominally about the host's clock.

**Measured budget** (JS, single thread, 20 s at 48 k, 512-sample blocks): one
band 70x realtime, three bands 16x, three bands with everything on 13x — about
9 instances of the heaviest configuration in a 70%-loaded session.

### 2026-08-15 — RIGOR: the parity gate exists, and multiband arrives

RIGOR's C++ twin was rebuilt onto the ND lineage and the gate now closes at
**22,036 bit-exact checks** — gain computer, one-poles, sidechain sections,
K-weighting at five sample rates, true-peak taps, transfer curves, auto
threshold, the crossover, ten rendered cases with their meters, and three
multiband cases with per-band gain reduction. The `in progress` row in §1 is
retired.

Added to the core in the same pass: delta listening, mid/side placement, a
release-curve control, a denormal guard, true-peak and LUFS (M/S/I with the
two-stage BS.1770 gate) and correlation metering, a deterministic FFT, an
auto-threshold helper, a loudness-match helper, and a 1–3 band Linkwitz-Riley
multiband wrapper.

**Two findings worth carrying:**

*The peak follower's operation order is load-bearing.* The JS writes
`pk *= c; if (|x| > pk) pk = |x|` — decay first, then take the max. The first
C++ port wrote the equivalent-looking `pk = |x| > pk ? |x| : c*pk`, which
takes the decay branch whenever the sample merely holds. That cost **7,507 of
22,036 checks**, worst 9.2e13 ulp, and every mismatch appeared only after the
first transient. Law 5's cousin: two expressions that are algebraically the
same are not the same when a comparison sits between them.

*Denormal flushing is part of the contract.* `dn()` changes the arithmetic,
so it is mirrored operation-for-operation rather than treated as an
optimisation the port may skip.

**The multiband constraint worth copying elsewhere:** at `bands === 1` the
splitter is bypassed and the caller's own buffers go straight to engine 0, so
the result is bit-identical to the single engine. Every pre-multiband baseline
stayed blessed. It is asserted for all four styles, not assumed. Related: the
wrapper deliberately does NOT prime its inner engines at construction —
engines snap on their first `setState` and glide afterwards, so priming with
defaults made the first real state glide in from them and broke the
bit-identity.

### 2026-08-15 — CASKET: a fuzzer, and the bug it found on its first run
`tests/casket_fuzz.js` pushes thousands of random legal states through hostile material asserting four invariants: finite output, ceiling held, latency honest, and idle-unsealed bit-identical. Seeded, so a failure reports a seed that reproduces it.
**It failed immediately.** Shaped dither could exceed the stated lid by ~0.005 dB — 12 of the first 400 states, every one with shaped dust armed. The dust trim allowed 2 LSB, which covers flat TPDF (1 dither + 0.5 rounding) but not the shaped shaper's own error feedback (`f = 2·e1 − e2`, each `e` bounded by 1.5 LSB, so ~4.5 LSB more). Fixed two ways: the trim is now 6 LSB when shaped, and the dithered output is clamped to **the largest quantisation step at or below the true lid** — on the grid, so the guarantee holds by construction rather than by budget. The fuzzer now runs at **zero tolerance** and 1,500 states pass.
**Blast radius:** CASKET only. **Lesson for the suite:** a budget-based guarantee is a guarantee you have to keep re-deriving every time you add a stage. Prefer construction.

### 2026-08-15 — CASKET: mid/side, loudness range, and offline tools
M/S added as a **pre-stage** (never a limiter mode) so the limiter still runs last and §5's ceiling proof carries over verbatim — this is §5 of this document being used as a design rule rather than a description. LRA per EBU Tech 3342 on its own short-term histogram with a −20 LU gate. Offline: `renderOffline`, `autoDrive` (bisection on drive, because loudness is monotone but not linear in it), `difference` (both sides latency-compensated first, so arrangements with different latencies can still be subtracted).
**Verified:** 153 core / 69 UI / 14 hashes / 19,686 parity / 1,500 fuzz states.

### 2026-08-15 — CASKET gains a second signal path (`seal`)
The limiter can now apply its gain in the oversampled domain instead of at base rate, chosen per arrangement. Nothing in `shared/` changed.
**Blast radius:** CASKET only — but worth logging because it changes what CASKET *guarantees*, and §5 of this document tells you to put the limiter last precisely because of that guarantee. Sealed, CASKET is no longer bit-transparent when idle; unsealed it still is, and four of five arrangements are unsealed.
**Verified:** 133 core / 69 UI / 13 byte-stable hashes / **18,753 parity checks bit-exact**. Exactly one existing hash moved (`lead`, now sealed) and it was re-blessed deliberately per §8.4. AUTOPSY and RIGOR re-run and unchanged.

### 2026-08-15 — `rigor.html` gained the `nd-src` embed
RIGOR's core now closes over ND, so its HTML needed a third embed block and its boot bundle needed the third term. It had been written for a two-embed core (`nm-src` → `core-src`) and `rigor_sync.js` refused outright — LAW 4 catching a real mismatch rather than a hypothetical one.
**Blast radius:** RIGOR only.
**Verified:** sync idempotent; the embedded bundle renders **bit-identically** to the file core (settling, lookahead 3 ms, mix 60 %).

### 2026-08-15 — `necrodyn` gains RBJ sidechain sections
`secSosHP`, `secSosLP`, `BYPASS_SECTION` added to `.js` and `.h` for RIGOR's sidechain filter.
**Blast radius:** `necrodyn.js` is embedded in `casket.html`, so CASKET's HTML changed and `casket_sync.js` had to re-run. Additive only — no existing function touched.
**Verified:** CASKET 103 core / 68 UI / 10 hashes unchanged / 11,164 parity unchanged. AUTOPSY untouched.

### 2026-08-15 — `kneeGain` rewritten to compute the reduction directly
Was `kneeOut(x) − x` with a `y < x` guard. Two failure modes: cancellation residue ~5e-15 dB at 1:1, and — far worse — when the true reduction was smaller than one ulp of `x`, `x + c` rounded back to `x`, the guard read false, and **the whole reduction was discarded**.
**Blast radius:** every consumer of ND's gain computer. CASKET's `lead` style (6 dB knee, the widest) was overshooting its lid and firing its safety clamp instead of limiting.
**Verified:** fixing it restored CASKET's `lead` regression hash to its originally blessed value, and current measurement shows **zero clamp hits and zero overs across all five arrangements**. RIGOR's bit-exact null test at 1:1 depends on this fix.
**Lesson recorded:** an earlier note here claimed CASKET was unaffected "because it only uses invR = 0". That was wrong — invR = 0 makes the *linear* branch exact, not the *knee* branch. **"That branch is exact" is a claim about one branch.**

### 2026-08-15 — `softClip` given a `tanh(20)` short circuit
A large argument sent `NM.exp` into a multi-billion-iteration doubling loop before overflowing.
**Blast radius:** anything calling `NM.exp` with unbounded input. Now flagged as LAW-adjacent in §3.

### 2026-08-15 — `shared/necrodyn.js` and `.h` created (CASKET Phase 1 / 2)
The dynamics DNA, written against CASKET as its first consumer so RIGOR would inherit something already proven rather than the reverse.
**Verified:** AUTOPSY's 5 hashes and 5,176 parity checks unmoved.

### 2026-08-15 — `shared/necromath.js` and `.h` created (RIGOR Phase 0)
NM extracted verbatim out of `autopsy_core.js`. Shared, not forked, because NM's whole value is bit-identical JS↔C++ output and two copies would drift.
**Verified:** all 5 AUTOPSY hashes unchanged, 5,176 parity checks still bit-exact, `parity_expected.h` byte-identical after regeneration.

---

## 8. The checklist for touching `shared/`

1. Make the change **additive** if at all possible.
2. Re-run **every** consumer's full suite, not just the one you were working on.
3. Re-run every `*_sync.js` — the shared files are embedded in the HTML.
4. If any regression hash moved, **stop.** Either it was not additive, or you found a real bug. Both need §7 entries.
5. If a hash moved and the change was correct, re-bless deliberately and write down what moved and why.
6. Add a §7 entry with blast radius and what you verified.

---

## 9. THE CORONER SEAM — how a report becomes a state

*Added 2026-08-27 by a CASKET session, written from CASKET's side and
deliberately readable without opening CASKET's source. CORONER is the sixth
member of the estate and the first that listens instead of speaking. This
section is the contract for what happens when it hands its findings to a
limiter. The NECROPHONE and PALLBEARER halves of CORONER's routing are that
project's business and are not described here.*

### 9.1 The division of labour, and it is not negotiable

> **CORONER says what the MATERIAL IS. It has the ears.**
> **CASKET says what the SETTINGS ARE. It has the meters.**

For NECROPHONE and PALLBEARER a CORONER report becomes a **patch**, because
those two recreate the sound. CASKET recreates nothing — it is the lid coming
down — so the handoff is a different shape, and getting that shape wrong is the
whole risk. A report that arrived carrying a knee and a release would be
CORONER guessing at numbers CASKET can measure exactly.

Concretely, inside `intake()`:

| Number | Where it comes from | Why |
|---|---|---|
| `drive` | `autoDrive`, bisecting against a loudness target | measured, and the search verifies its own render |
| `margin` | `autoMargin`, rendering and re-measuring | the true-peak residual is a property of the **material**, from +0.000 dB on harmonic content to +1.19 dB on full-band clipped noise |
| the arrangement | CORONER's features | the one thing no meter can report: what **kind** of thing this is |

### 9.2 Do not grow a second BS.1770

As of 2026-08-27 CORONER has **no** loudness metering: `crest` is plain peak
over RMS, and there is no K-weighting, no LUFS and no true-peak anywhere in
`coroner_core.js`. **That is correct and it should stay that way.** CASKET
implements ITU-R BS.1770-4 to the letter, matches the published 48 kHz table to
1e-12, and is gated against EBU Tech 3341 and 3342 — plus two extra
discriminating cases, added because the published reference programmes turned
out to be blind to the relative gate and the percentiles they are supposed to
test. A second implementation would be **a rule with two copies**, this
estate's most-repeated defect, in the one place where the two copies would be
hardest to tell apart. If CORONER needs a LUFS figure, ask CASKET's
`meterBuffer()` for it.

### 9.3 What CORONER sends

A plain object. **CASKET does not import CORONER and CORONER need not import
CASKET** — a hard dependency would put each project's suite at the mercy of a
file the other is still writing, and the seam is meant to be a contract rather
than a shared build. Three shapes are accepted: a whole report (`{version,
features}`), a bare feature bag, or nothing at all.

CASKET reads **seven** features and declares them in `INTAKE_READS`:

| feature | what CASKET asks it |
|---|---|
| `crest` | how far the transients stand above the body |
| `onsetRate` | how often the limiter will be asked to act |
| `attack` | how fast the fastest thing here arrives |
| `sustain` | how much of a note is body rather than edge |
| `flatness` | noise-like, or tonal |
| `highRatio` | energy up where the inter-sample peaks are made |
| `dur` | how much material there is to judge from |

Everything else CORONER measures is welcome and ignored. A missing field falls
back to a **neutral** value — one that casts no vote — so a partial report
degrades rather than swinging the answer. A version other than the one CASKET
declares is **reported in `warnings`, never refused**, because a limiter that
stops working when an analysis tool grows a feature is worse than one that says
which vector it was handed.

**On the version stamp, and the handoff that moved it. NOW 3.** This section was
written against `FEATURE_VERSION 2` at 08:56 on 2026-08-27; CORONER reached **3**
by 10:45 the same morning. The CORONER session did not let that drift: it built
a real v3 report, passed it to `intake()`, confirmed the mismatch was *reported
and not refused*, confirmed all seven fields present, finite and in range, and
then wrote the instruction into §7 — *"whoever next touches
`INTAKE_FEATURE_VERSION` should bump it to 3 deliberately, after re-reading
§9.3 — not to silence the warning, which is doing its job."* **That is this
document working as designed**, and it is worth pointing at, because the usual
entry in §7 is a record of something that had already gone wrong.

Bumped 11:10, and **checked rather than waved through**: v1→v2 added `noteCount`
and re-based nine features onto the representative note segment (`f0`,
`f0jitter`, `vibRate`, `vibDepth`, `harmonicity`, `inharm`, `oddEven`,
`irregular`, `bandSlope`); v2→v3 gave `inharm` a plausibility ceiling and
dropped its declared maximum from 0.01 to 0.002. **None of the seven fields
above appears in either list, and all seven still declare the same ranges.**

The reason not to just leave the warning firing: *a warning that always fires is
a warning nobody reads*, which turns a genuine signal into furniture.
`casket_intake.js` now asserts **both** directions — a mismatch warns, *and* a
report at the declared version does not, which is the half that had no gate and
the half that actually broke. Its fixtures read the constant rather than
carrying a typed number, because a file written to catch version drift was
itself carrying a drifted version within hours of being written.

> **CORONER IS NOW v3, AND THIS CLAUSE HAS BEEN EXERCISED FOR REAL** (2026-08-27,
> logged at the top of §7). A live v3 report was passed to `CK.intake()`:
> the mismatch was **detected and warned, not refused**; all seven
> `INTAKE_READS` were present, finite and in range; a valid state came back.
> None of the seven is `inharm`, which is the field v3 changed, so **CASKET
> needs no change and the seam holds**.
>
> This clause is the reason nothing broke. It was designed before it was needed
> and it worked the first time it was needed, which is the argument for
> specifying a consumer before a producer exists — §9.8's point, demonstrated
> rather than restated.
>
> Whoever next moves `INTAKE_FEATURE_VERSION` to 3 should do it **deliberately,
> after re-reading this section** — not to silence the warning. The warning is
> doing its job, and a version stamp that is bumped reflexively to quiet a
> message stops being a stamp at all.

### 9.4 What CASKET sends back

A `.casket.json` state, already through `sanitizeState()`, documented field by
field in `CASKET/docs/CASE_FORMAT.md`. Use that format rather than inventing
one: it inherits the sanitiser's clamping and the save/load **fixpoint** the
suite already proves over 200 random states. Alongside it: the arrangement
name, a confidence, ordered **evidence** in the same `{feature, reads, weight}`
shape CORONER's own verdicts use, the measured block, and warnings.

### 9.5 What a report may never set, and why

`lid` · `dust` · `dustBits` · `dustSeed` · `ms` · `msMid` · `msSide` · `hold` ·
`link` · `dc` · `unity` · `bypass` · `version` · `meta`

A delivery ceiling is a contract with a platform or a plant and no amount of
listening reveals it. Dither belongs to the **output format**, not the input
material. Stereo shaping is an artistic decision; CORONER can report a width,
and reporting is where it stops. The rest are session settings, not properties
of the audio. **A report is advice, not a session reset.** All fourteen are
asserted field by field in `CASKET/tests/casket_intake.js`, against a probe
state that differs from default on every one of them so the check cannot pass
by accident.

### 9.6 An arrangement is a gesture, not a parameter

If anything in this seam ever names an arrangement, it must apply the **whole
recipe** — all eight fields, read from the engine's own `styleDefaults()` table
— and never the style label alone. Setting the label alone is exactly the bug
Ben's ears found on 2026-08-23, when all five arrangements turned out to be
Velvet in costume and Lead was Lead with its seal switched off, after 23,013
parity checks had missed it. See `CASKET_ARCHITECTURE.md` §16. **The shape to
grep for anywhere in this estate: a value whose setting implies values for
OTHER settings.** RIGOR still carries it (§7, 2026-08-24).

### 9.7 One rule that is CASKET's alone: the margin only ever tightens

`autoMargin` verifies against the material in front of it, so on a master that
overshoots by nothing its honest answer is `0`. Lead nonetheless ships `−0.3`,
chosen to cover material in general. `intake()` may only take **the more
conservative of the two**. Letting a measurement relax a shipped safety
allowance would mean quietly removing it on the one path where nobody is
watching the knob.

### 9.8 Deliberately not built

- **CASKET is not in CORONER's `route()`.** As of this writing `route()` forks
  two ways, NECROPHONE or PALLBEARER, and CASKET appears nowhere in CORONER's
  three files. `intake()` is CASKET's half of a seam whose other half does not
  exist yet, which is the right order: the receiving end can be specified,
  gated and proved before anything is sent.
- **No chain-level handoff.** One report, one limiter. The
  AUTOPSY→RIGOR→CASKET chain is §5's business and the Underworld's, not this.
- **No learned chooser.** `chooseArrangement()` is thin, transparent and
  replaceable whole — it reads a features object and returns
  `{style, confidence, evidence}`, mirroring CORONER's own layer-2/layer-3
  split so that a model can replace exactly that function and nothing else.
  The thresholds in it are honest guesses, not measurements against a library
  of real masters, and that limitation belongs in any report that quotes them.
