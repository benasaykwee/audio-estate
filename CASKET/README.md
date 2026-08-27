# CASKET

**A true-peak brickwall limiter — browser instrument + (Phase 2) JUCE plugin.**
*"Nothing gets out."*

Third of the trilogy: [AUTOPSY](../AUTOPSY) opens the body, RIGOR stiffens it, CASKET is the box it goes in and the lid coming down. Built out of order — the limiter came before the compressor — which is why `shared/necrodyn.js` exists and why RIGOR will inherit it already proven.

Design: [`../CASKET_ARCHITECTURE.md`](../CASKET_ARCHITECTURE.md).

**The rest of the writing, and what each is for:**

| | |
|---|---|
| [`MASTERING_WITH_CASKET.md`](MASTERING_WITH_CASKET.md) | when to reach for a thing and what it costs. Every figure cited to the harness that measured it. |
| [`docs/LISTENING_PROTOCOL.md`](docs/LISTENING_PROTOCOL.md) | how to check any of those claims by ear — level-matching, the null test at home, per-arrangement listening. |
| [`docs/LISTENING_LOG.md`](docs/LISTENING_LOG.md) | what it actually sounded like, session by session. The only evidence here no harness can generate. |
| [`docs/CASE_FORMAT.md`](docs/CASE_FORMAT.md) | the `.casket.json` arrangement file and the share-link hash, field by field. |

## Run it

Open `casket.html`. No build, no server, no dependencies.

Press **Slab Noise** (deliberately clipped and loud — a limiter with nothing to do is a boring demo), drag the gold **lid** line down, and watch the weight hang from it.

Keys: `1`–`5` pick an arrangement · `B` bypass · `U` unity · `R` reset the plot · `?` shortcuts.

**Unity has two lives.** On, it trims the output by the drive amount so an A/B compares character instead of loudness — which means turning the drive up makes things *quieter*, because you are buying more limiting at a fixed level. Off, drive is the loudness lever and the lid is the real ceiling. **Unity on to compare, Unity off to commit**; `MASTERING_WITH_CASKET.md` §4 explains why mixing them up makes a working limiter look broken.

## Render a real file

Drop an audio file anywhere, then press **Render to WAV**. CASKET renders it offline at full quality — no real-time deadline, no dropouts — and hands back a **24-bit WAV plus a before/after measurement**: true peak, sample peak, and integrated LUFS, with the lid marked `under` or `OVER`.

The render is **latency-compensated**, so it drops straight back into a session lined up with the source and A/Bs honestly. It was built as the bridge before either of these was an AU; both are now, and it has outlived that job — offline rendering has no real-time deadline, so it stays the honest way to measure a master rather than merely hear one.

## Run the suite

<!--c:casket.harnesses-->13<!--/c--> asserting harnesses,
**<!--c:casket.assertions-->781<!--/c--> assertions**, plus
<!--c:casket.baselines-->16<!--/c--> byte-stable render baselines —
**<!--c:casket.suite-->797<!--/c--> checks**, last changed
<!--c:casket.measured-->2026-08-27<!--/c-->.
<!-- The marker above is casket.measured, NOT the bare `measured` — fixed
     2026-08-18. The bare key is the OLDEST last-change date across the
     whole estate (counts.js takes dates[0], deliberately, as an estate-wide
     "true since"), so this file spent two days announcing its own vitals
     under a sibling's older date while its numbers moved twice in a day.
     Per-project vitals want the per-project key. -->


Those figures are generated. `tools/counts.js` runs the gates and rewrites what
sits between the markers in this file, so a number here is either current or CI
is red. Per-harness counts are deliberately absent below: a fenced code block
cannot carry a marker, and a hand-typed count inside one is a number with no
gate behind it.

Run them in this order; the first four are the ones to run after any edit.

```bash
node tests/casket_test.js           # the guarantee, BS.1770, the null test, latency
node tests/casket_ui_test.js        # UIH, the three embeds, boot path, WAV writer
node tests/casket_regression.js     # byte-stable render baselines
node casket_sync.js                 # re-embed after ANY edit to the core or shared/

node tests/casket_fuzz.js 1500      # random legal states x 5 rates x 10 chunk sizes
node tests/casket_automation.js 150 # setState between every block
node tests/casket_edge.js           # subnormals, signed zero, degenerate buffers
node tests/casket_dither.js         # the shaping must actually shape
node tests/casket_conformance.js    # BS.1770, EBU 3341/3342, the ladder
node tests/casket_nan_audit.js      # silence is legal everywhere
node tests/casket_seal_margin.js    # the seal and the margin, on one axis
node tests/casket_album.js          # one drive, gapless joins, the dust policy
node tests/casket_plugin_test.js    # the wrapper, without a compiler
node tests/casket_host.js           # block size, chunking, latency, the mono bus
node tests/casket_rate.js           # sample-rate conversion and its anti-aliasing
node tests/casket_tools_fuzz.js 25  # the offline tools, random states
node tests/casket_cpu_gate.js       # ratios, never milliseconds. --bless is deliberate
node tests/casket_soak.js 12        # 12 min per arrangement — nightly, not per-push
node tests/seal_experiment.js       # evidence for §6.3 — reports, does not assert

# the parity gate — JS truth vs the C++ twin, bit-exact
node tests/parity_emit.js
g++ -std=c++17 -O2 -ffp-contract=off -o core_parity tests/core_parity.cpp && ./core_parity

# and the numbers in this file, re-derived from all of the above
node ../tools/counts.js
```

**When something goes red, or a run will not fit.** Several harnesses grew
flags for exactly these two moments, and nothing pointed at them until now:

```bash
# REPRODUCE a reported failure without re-running everything ahead of it.
# Seeds fully describe a case, so one is enough.
node tests/casket_fuzz.js --seed=17183        # the engine fuzzer
node tests/casket_tools_fuzz.js --seed=5036   # the offline tools (~15 s, not ~95 s)

# SPLIT a long run across several windows, when one process cannot have the time.
node tests/casket_fuzz.js 20000 --from=16000
node tests/casket_tools_fuzz.js 60 300        # 60 states, or 300 seconds, whichever first
node tests/casket_soak.js 12 --only=pine,lead # the nightly duration, two arrangements

# ASK WHAT IS COVERED, without reading the source.
node tests/casket_mutate.js --list            # 19 mutants: target, judge, expectation
node tests/casket_regression.js --list        # 16 baselines: hash and what each pins
node tools/check_mastering_citations.js --self-test   # the checker's own extractor

# COMPILE the plugin sources without a build system (seconds, any platform).
bash tools/compile_check.sh
```

A partial run says so in its own summary — `casket_tools_fuzz.js` and
`casket_soak.js` both report how much of the requested sweep actually ran, so
a clipped run cannot be mistaken for a clean one a week later.

**<!--c:casket.parity-->23,013<!--/c--> parity checks, zero mismatches**, at `-O0`, `-O2` and `-O3`. Compile the same file *without* `-ffp-contract=off` and thousands fail, the worst by 9,805 ulp — the polyphase inner loop is a long multiply-accumulate chain and GCC fuses it into FMAs given the chance. That flag is not belt-and-braces; it is the whole gate.

Emit the header, then check it is **byte-identical** before trusting it. A gate generated fresh from the code it is gating proves nothing; proving the generator is deterministic first is what makes it a gate.

## The plugin

`casket-juce/` builds AU, VST3 and Standalone via CMake (JUCE 7.0.12 fetched automatically). Twenty-two parameters. The DSP underneath it is the same header the parity gate proves bit-exact against the browser, so the only untested layer is the JUCE wrapper itself.

```bash
cmake -B build -S casket-juce -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release

# or just check it is sound C++ — seconds, any platform, no build system
bash tools/compile_check.sh            # fetches JUCE 7.0.12 to /tmp on first run
```

**BUILT, VALIDATED, AND HEARD.** As of 2026-08-23 CASKET builds on CI and on a real Mac, passes `auval` and `pluginval` at strictness 10, loads in GarageBand and has been played by a person. The first listening session is written up in [`docs/LISTENING_LOG.md`](docs/LISTENING_LOG.md) — it found a bug in the first ten minutes, which is what listening is for.

*(This paragraph has been wrong twice, in the same direction both times. It said "has not been built here, because there is no JUCE in this sandbox" until someone checked whether JUCE could simply be fetched; then "COMPILES, but has not been BUILT" until the day it was built, validated and auditioned. Prose about the present tense goes stale faster than anything else in this repository.)*

`tools/compile_check.sh` remains the fast gate: it compiles both translation units against the JUCE version CI pins in about forty seconds, ruling out the whole class of first-build failure — missing includes, wrong signatures, API drift — without needing a build system or a macOS machine. It cannot produce a loadable plugin, and it is not meant to.

### The Standalone is the audition rig

The build produces `CASKET.app` alongside the plugins, and it is **the safest possible first look at a fresh build**: it touches no `Plug-Ins` folder, no AudioComponent registry and no host, so a bad build can waste a minute rather than hang a session with your work open in it.

```bash
open build/Casket_artefacts/Release/Standalone/CASKET.app
```

It is also in the CI artifact — `casket-plugins` uploads the whole `Release` directory, so the `.app` travels with the `.component` and the `.vst3` and needs no host installed to hear the box work. Use it to check that a build runs at all, then follow the order in [`../_HANDOFF/LOCAL_BUILD_FACTS.md`](../_HANDOFF/LOCAL_BUILD_FACTS.md): copy in, strip quarantine, `killall -9 AudioComponentRegistrar`, `auval`, and only then open a DAW.

**Reading CI's verdict:** `bash tools/ci_verdict.sh` prints per-job status for the newest run from the authenticated API. Use it rather than the web page — a logged-out github.com served a *cached* listing on 2026-08-23 that showed a run sixteen behind the newest as current, which is indistinguishable from good news.

Latency is reported to the host from the *same* pure function the browser and the parity gate use, so the three can never disagree about it.

`casket_sync.js` maintains three verbatim embeds in `casket.html` — `necromath`, `necrodyn`, then the core, in that order, because each closes over the one before. Run it after every edit; the UI harness fails if an embed drifts from its source file by a single byte.

## The vocabulary

| Thing | CASKET calls it |
|---|---|
| Ceiling | the **lid** |
| Scrolling display | the **viewing** |
| Gain-reduction trace | the **weight** |
| Loudness / true-peak meters | the **plot** |
| Loudness-distribution chart | **THE RANGE** |
| Oversampling factor | the **lining** |
| Lookahead | the **vigil** |
| Dither | the **dust** |
| Clearing the meters | **THE REST** (`R`, or the button) |
| Saved preset | an **arrangement** (`.casket.json`) |

## The five arrangements

| | character | vigil | smoother | release | lining |
|---|---|---|---|---|---|
| **Pine** | the plain box, most neutral | 3 ms | full | linear | 4× |
| **Velvet** | lined, forgiving | 2 ms | full | program-dependent | 4× |
| **Oak** | punchy — the transient front survives | 1 ms | ⅜ vigil | fast, program | 4× |
| **Iron** | loud and dense, soft-clip pre-stage | 1.5 ms | ⅝ vigil | fast | 8× |
| **Lead** | sealed, mastering-safe, −0.3 dB margin | 5 ms | full | slow, program | 4× |

Two of those columns are *structural* — the smoother fraction and the release shape change the code path and no knob exposes them. The rest are defaults the arrangement writes into the state when you pick it, and you can override any of them.

**Lead is 4×, not 16×, and that is deliberate.** In sealed mode the lining is the *processing* rate as well as the detection rate, and detection is already exact at 4×; more lining costs the decimator's whole filter for no accuracy gained, and measures slightly worse. This table said 16× until 2026-08-18 — a documentation error, not a code one; `casket_core.js` has always shipped 4×. The *factory preset* named "Sealed for Delivery" does use 16×, which is probably where the confusion started.

## What it guarantees, and what it doesn't

**Absolutely:** no output sample exceeds the lid. Zero epsilon, any input, all five arrangements, proven against squares, impulse trains, clipped noise, DC steps and a 19 kHz sine. This follows from a theorem rather than from tuning — see §5.3 of the architecture doc.

The last stage clamps at the lid to absorb floating-point rounding, and the harness watches how much work that clamp does (`tests/casket_test.js`):

| arrangement | worst the clamp absorbed |
|---|---|
| pine | 5.39e-13 relative |
| velvet | 2.41e-13 relative |
| oak | 6.17e-14 relative |
| iron | 9.99e-15 relative |
| **lead (sealed)** | **0.0879 dB** — a different thing entirely |

On the four unsealed arrangements the clamp has never caught anything but the last bit. **Lead is the exception and it is not a small one:** sealing means the clamp also absorbs the decimator's ripple, which is eleven orders of magnitude larger than rounding. That is documented, bounded and asserted separately — it is the price of the seal, not a defect in it.

*(This paragraph read "across the whole hostile battery, 7 × 10⁻¹³ relative. It has never caught anything but the last bit" until 2026-08-19. Two problems: the figure did not match any current measurement, and "the whole hostile battery" silently included Lead, where the sentence is false by eleven orders of magnitude. A single number standing for five arrangements will eventually be wrong about at least one of them.)*

**Very nearly:** the *true* peak — the value between samples that a converter actually reproduces.

Measured at a −1.0 dBTP lid with +12 dB of drive (`tests/casket_test.js`):

| material | at 4× lining (the default) | at 16× |
|---|---|---|
| harmonic / musical | +0.011 dB | **+0.000 dB** |
| band-limited clipped | +0.522 dB | +0.555 dB |
| full-scale full-band clipped noise | +1.194 dB | +1.194 dB |

Detection is oversampled and exact; the gain is *applied* at base rate, and a fast-moving gain aliases. **More lining does not help on the case that matters** — the full-band worst case agrees to three decimals at 4× and 16×. On the two easier rows the two linings differ in the second decimal, and not always in 16×'s favour. A longer vigil helps a little.

*(This table carried a single unlabelled column until 2026-08-19, and its figures were the 16× ones — so a reader would have taken them for the 4× default, which ships +0.011 rather than +0.000 on musical material. The sentence beneath it also generalised "agree to three decimals" from the one row where that is true; `CASKET_ARCHITECTURE.md` §6.2 always said "on the hard case" and always showed both columns. Summary documents drift from detailed ones in exactly this direction.)*

The obvious fix was tried and does not work — see §6.3 and `tests/seal_experiment.js`, which is committed so the conclusion can be re-run rather than believed. Short version: applying the gain oversampled as a *residual* preserves the bit-exact null test but is ill-conditioned exactly when limiting is heavy, and makes the overshoot worse, not better. The full oversampled path does work and roughly halves the residual, but costs the null test permanently. That trade is an open question, not a decision already taken.

Until then, the default −1.0 dBTP lid and Lead's −0.3 dB margin cover it on any real programme material.

**Bit-exactly:** with the lid above the signal, the output is **identical** to the delayed input. Not transparent, not −140 dB of difference — identical. Every arrangement, dither disarmed. That property is the reason the audio path never leaves the base sample rate, and it is the assertion worth protecting above all the others.

## Metering

ITU-R BS.1770-4, implemented to the letter because it has an external right answer. K-weighting coefficients are derived from the analog prototype at any sample rate and match the spec's published 48 kHz table to 1e-12. Momentary (400 ms), short-term (3 s), and gated integrated loudness — absolute gate at −70 LUFS, then relative at −10 LU, both, in that order. A 1 kHz sine at −23 dBFS reads −23.0 LUFS.

## Latency

`OS_Q + vigil + 1` samples unsealed, plus `DEC_Q` when the seal is on — and **independent of the lining** either way, so 4× and 16× report the same number and changing the oversampling mid-session does not shift your timing. That falls out of building the oversampler as an `M`th-band filter; the harness asserts it at every lining × vigil combination.

The seal's extra samples are the decimator's group delay, and Lead is the only arrangement that pays them. Because each arrangement names its own vigil, each reports its own latency — measured in a host at 44.1 kHz, that is Oak 61, Iron 83, Velvet 105, Pine 149 and Lead 302 samples, and `casket_plugin_test.js` re-derives all five from the recipes so the table cannot drift away from the code.

## Layout

```
casket_core.js            single source of truth — ALL the DSP
casket.html               the browser instrument (three verbatim embeds + the app)
casket_sync.js            maintains the embeds, order-enforced, byte-verified
casket-juce/
  Source/CasketCore.h     the C++ twin — bit-exact against the JS
  Source/Plugin*.{h,cpp}  AU / VST3 wrapper + bespoke face, 22 parameters
  CMakeLists.txt          fetches JUCE; also builds the parity gate
MASTERING_WITH_CASKET.md  when to reach for a thing and what it costs
docs/
  LISTENING_PROTOCOL.md  how to verify what the numbers claim, by ear
  CASE_FORMAT.md          the .casket.json arrangement file, field by field
tools/
  check_mastering_citations.js  checks the doc's own cited numbers against a fresh run
tests/
  casket_test.js          the guarantee, BS.1770, the null test, latency
  casket_ui_test.js       UIH, the three embeds, the boot path, the WAV writer
  casket_regression.js    byte-stable render baselines
  casket_fuzz.js          random legal states against hostile material
  casket_automation.js    setState between every block
  casket_edge.js          subnormals, signed zero, degenerate buffers
  casket_dither.js        the shaping must actually shape
  casket_conformance.js   BS.1770, EBU 3341/3342, the reconstruction ladder
  casket_nan_audit.js     silence is legal everywhere; no NaN escapes
  casket_seal_margin.js   the seal and the margin, measured against each other
  casket_album.js         batch, album, gapless, the dither policy, the report
  casket_plugin_test.js   the JUCE sources, statically — both directions
  casket_host.js          the plugin boundary: block size, chunking, mono
  casket_rate.js          sample-rate conversion and its anti-aliasing
  casket_tools_fuzz.js    the offline tools, random states
  casket_cpu_gate.js      the SHAPE of the cost, as ratios
  casket_soak.js          long-run drift — nightly
  casket_bench.js         absolute figures, for the record not for a gate
  casket_audit.js         autoDrive/autoMargin/matchReference, re-derived independently
  casket_coverage.js      state-field census — what does nothing watch?
  casket_mutate.js        breaks the core on purpose; the suite must notice
  seal_experiment.js      the §6.3 evidence — reports, does not assert
  parity_emit.js          JS truth → parity_expected.h
  core_parity.cpp         the gate
../shared/
  necromath.{js,h}        NM — portable transcendentals (shared with AUTOPSY)
  necrodyn.{js,h}         ND — the dynamics DNA (RIGOR inherits this)
```
