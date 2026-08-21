# PALLBEARER

### The bass that carries the weight — fifth of the estate

*Six carry the box. Four carry the song.*

A physically modelled bass instrument. There are no samples in the string: every note
is computed from a vibrating string, a pair of pickups and a resonant body. The whole
instrument is 32 KB of arithmetic where Trilian is 34 GB of recordings.

---

## Why this shape

The obvious target was Spectrasonics Trilian — 21,000 samples, 60-plus basses, the
category benchmark since 2009. It cannot be cloned. It is a recording project needing
instruments nobody here owns and a player nobody here is.

MODO Bass reaches a comparable place from the opposite direction: physics instead of
recordings. That path is pure DSP, which is the thing this estate has already shipped
three times. So PALLBEARER takes the modelled route — and then keeps the door open for
the other two, because the interesting part turned out to be the brain rather than the
sound source.

**The three paths, one instrument:**

| Path | What makes the sound | Status |
|---|---|---|
| **Modelled** | The waveguide alone. Zero megabytes. | Running today |
| **Hybrid** | Waveguide sustain + a short recorded attack layer | **Live** — drop a .wav on the test bed |
| **Sampled** | The attack layer with `strGain` at 0 | **Live** — root pitch detected from the file |

All three share the fingering brain, the voice allocation and the string-stealing rule.
That sharing is the whole argument for doing it this way — the part that makes modelled
bass read as *played* is not the string model, it is the decision about which string.

---

## Files

| File | What it is |
|---|---|
| `pallbearer_core.js` | The DSP. **Single source of truth.** |
| `pallbearer-juce/Source/PallbearerCore.h` | The C++ twin. Follows the JS, never leads it. |
| `pallbearer.html` | The test bed. Self-contained — carries a verbatim copy of NM + core. |
| `pallbearer_sync.js` | Writes that copy. `--check` verifies it and exits 1 on drift. |
| `pallbearer-juce/` | The plugin: CMake, `Parameters.h`, processor, editor. First build happens on CI. |
| `pallbearer_test.js` | The harness. **188 checks, 22 sections.** |
| `tests/parity_emit.js` · `tests/core_parity.cpp` | The parity gate. **<!--c:pallbearer.parity-->13,335<!--/c--> checks, bit-exact.** |
| `tests/pallbearer_plugin_test.js` | **38 checks** that the DAW parameter list matches the core. |
| `tests/pallbearer_regression.js` | **11 byte-stable baselines.** |
| `tests/pallbearer_fuzz.js` | **94,241 hostile cases.** |
| `tests/pallbearer_cpu.js` | Cost gate. Ratios, minimum-of-seven, 50% tolerance. |
| `tests/underworld_handoff.js` | **25 checks** through the real mastering chain. |
| `tools/build_report.js` | Runs every gate and writes `THE_CARRY.html`. |
| `tools/compile_check.sh` | Compiles the plugin sources against real JUCE headers. Seconds, any platform. |

```
node pallbearer_test.js                    # the harness
node tests/pallbearer_plugin_test.js       # DAW parameter list vs the core
node tests/pallbearer_regression.js        # byte-stable baselines  (--bless to re-record)
node tests/pallbearer_fuzz.js              # hostile input
node tests/pallbearer_cpu.js               # cost gate            (--bless to re-record)
node tests/underworld_handoff.js           # the seam into AUTOPSY/RIGOR/CASKET
node pallbearer_sync.js --check            # verify the embed
node tools/build_report.js                 # run everything, write THE_CARRY.html

# the parity gate — LAW 1, always
node tests/parity_emit.js
g++ -std=c++17 -O2 -ffp-contract=off -o build/pb_parity tests/core_parity.cpp && ./build/pb_parity
```

Open `pallbearer.html`, press **Wake it up**, then **Connect MIDI** for the P-155.

---

## What the model actually does

**Fractional-delay waveguide.** A plain Karplus-Strong line can only tune to `sr/N`,
so pitch comes out quantised — this is the flaw in NECROPHONE's Bone & Sinew engine,
where `N = round(sr/freq)`. A first-order allpass carries the fractional part.
**Measured worst-case tuning error across the whole range: 0.085 cents.**

Honest note on that: at 48 kHz in the *bass* register, an integer line is only about
0.7 cents off at the top, which is under the melodic JND. The fractional line's real
payoff is elsewhere — fine pitch motion. A 10-cent vibrato at G3 collapses to **4
distinct integer delays across 48 points**; the fractional line moves smoothly. That
is what the harness asserts, because it is what is true.

**Delay budgeting.** The loop is not just the delay line. The fractional allpass, four
dispersion allpasses and the damping one-pole each contribute delay — about ten samples
together, which detunes a high note by tens of cents if ignored. All of them are budgeted
at DC, which pins the fundamental while still letting dispersion stretch the upper
partials. That stretch *is* the inharmonicity a thick wound string is supposed to have.

**Frequency-dependent decay.** Highs die before the fundamental, as on a real string.
Measured over two seconds on an open A: **h1 falls 19.6 dB, h8 falls 24.3 dB, h20 falls
48.9 dB, h30 falls 83.1 dB.** Monotonic in partial number, and asserted as such.

**Pickup comb filtering.** A pickup at fraction *p* from the bridge cannot hear a
harmonic with a node there, so the response has nulls at `k·f0/(2p)`. At p = 0.25 that
erases every even harmonic — which is precisely why a P-Bass in that position sounds
hollow in the mids. This is where instrument character actually lives, more than the
string model. Two pickups, blendable, with switchable polarity for the out-of-phase
J-Bass sound.

**The fingering brain.** `chooseString` picks the way a player would: stay near the
last hand position, take an open string when offered, avoid stealing a ringing string,
lean slightly toward the lower strings. Then the physical rule a sample library cannot
honour — **one string cannot sound two notes.** Play a low E and then the F above it
and the E stops, because on a real bass it must.

**Also modelled:** triangular pluck excitation with the apex at the plucking point,
tension bloom (a hard pluck goes sharp then settles), sympathetic string coupling,
body resonance, five playing styles that fold onto real parameters rather than
branching the DSP.

---

## Interchange

PALLBEARER is standalone but speaks to the rest of the estate.

- **Out, as audio** — *Render .wav* writes 48 kHz stereo. Feed it straight to the
  Underworld, which chains AUTOPSY → RIGOR → CASKET.
- **Out, as a patch** — *Export patch* writes `{instrument, version, patch}`. The patch
  is the flat sanitised parameter object, which is also the unit `setPatch` accepts.
- **In** — `setAttackLayer({data, sr, root})` is the hybrid/sampled hook.
- **Shared** — consumes `shared/necromath.js` (NM). Does **not** yet use ND; it has no
  dynamics stage of its own, deliberately, because RIGOR and CASKET exist.

---

## Estate laws

- **LAW 2** — every transcendental through NM. Asserted by the harness against the
  comment-stripped source, so a mention of the rule cannot pass for the rule.
- **LAW 3** — no literal closing script tag. Checked in the core, in NM, and by sync.
- **LAW 4** — `nm-src` precedes `core-src`, asserted by byte position.
- **LAW 5** — `isFinite(n) ? n : def`, never `+x || def`. Zero is legal for nearly
  every parameter here and the harness proves it survives.

Both law gates are proved to bite by feeding them a deliberately broken sample.

---

## Three bugs the harness caught, kept as gates

1. **The excitation was written to the wrong end of the ring buffer.** The triangle
   sat at `[0, D)` while the read pointer started at `(size − D)`. Every style rendered
   silence. Now `w` starts at `D` and the test asserts non-silent output per style.

2. **The loop delay ignored its own filters.** Ten samples of uncounted delay, worth
   tens of cents up high. Now budgeted; worst-case error 0.089 cents.

3. **The worklet-scope trap.** `addModule` loads the concatenated NM+core as a *module*,
   where top-level `var` never reaches `globalThis` and there is no `require`. A
   `var NM` in the core would have hoisted a local undefined, shadowed the real one and
   left the engine holding null — **passing every test under node and producing silence
   only in the browser.** Section XII runs the core inside a function body to reproduce
   module scope exactly, and mutation-tests the fix.

A fourth was a *test* fault worth recording: the original brightness check used a
sample-to-sample difference proxy that was measuring the noise floor, reported a 10%
change where the truth was 60 dB, and failed on roughly half of all runs. A flaky test
is usually a badly posed one.

---

## v0.3 — the third pass

Sympathetic coupling through a bridge bus · hand momentum in the fingering brain ·
pickup coil resonance · position-shift noise · a mean-reverting drift walk · dead notes ·
the JUCE plugin body · a plugin-parameter parity gate · a WAV sample loader for the
hybrid path · a CPU cost gate · `THE_CARRY.html`.

**Coupling was wrong the first time, instructively.** v0.2 nudged an envelope. v0.3 routes
each string's bridge output into every other string's delay line — and the first attempt
still measured nothing, because the render loop skips silent strings and **a skipped
string cannot receive anything**. An idle string on a real bass is not absent; it is tuned,
undamped and waiting. `prime()` sets one up at its open pitch without exciting it. That is
also why coupling is the expensive feature: **2.6× the single-string reference**, because
every string now computes every sample whether it was played or not.

**Measured v0.3:** 13,335 parity checks bit-exact at -O0, -O2 and -O3 · without LAW 1,
**8,693 fail, worst 14,301,684 ulp** · 188 assertions · 38 plugin-parity checks ·
94,241 fuzz cases · reference case runs **750× faster than realtime**, heaviest **109×**.

---

## v0.2 — what the second pass added

Attack-layer renderer (all three paths now make sound) · velocity brightness ·
deterministic humanization on a portable xorshift · fret buzz and release noise ·
a three-mode body (air + two wood modes at fixed ratios) · playable articulations
(harmonic / ghost / palm) · the C++ twin · the parity gate · regression baselines ·
the fuzz harness · the Underworld handoff.

**Measured:** worst tuning error **0.085 cents**. Humanize detune **±2.1 cents at full,
mean zero** across 14 notes. Body gain **3.17×** at the first wood ratio, **4.38×** at the
second, **1.01×** at the air mode. Harmonics land **within 40 cents of a true octave**.

**LAW 1, measured here rather than quoted:** without `-ffp-contract=off`, **6,379 of
9,095 parity checks fail, worst 825,202 ulp** — and the first mismatch is `midiToFreq`
at 1 ulp, so the error enters at the very first transcendental and compounds through
the feedback loop. With the flag it is bit-exact at **-O0, -O2 and -O3 alike**. The flag,
not the optimisation level, is what matters.

---

## Still in the ground

- **The plugin has been COMPILED but never BUILT.** Both translation units compile to
  object code against JUCE 7.0.12 — the version CI pins — via `tools/compile_check.sh`.
  That rules out the whole class of first-build failure (missing includes, wrong
  signatures, API drift). What it does **not** do is produce a loadable plugin: Audio
  Unit is a macOS format requiring Apple frameworks, and this sandbox is Linux aarch64.
  The `.component` comes from the `macos-14` job in `.github/workflows/pallbearer.yml`,
  and only a host proves it actually runs.
- **The attack layer does not survive a session save.** State carries a version stamp but
  not the audio, so a sampled or hybrid patch reloads silent. Saving a file path instead
  would break the moment the file moved, which is worse.
- **No bespoke editor.** Generic sliders plus a neck diagram, deliberately — writing a
  rich JUCE editor without a compiler is how a session gets spent for nothing.
- **Mono out.** Both channels are identical.
- **The drive stage aliases** at high settings; it wants oversampling, and the
  Interchange warns that oversampler taps are the first thing the compiler wants to fuse.
- **No patch library.** Nine presets live in the HTML as a literal.
