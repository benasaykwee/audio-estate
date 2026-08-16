# CASKET

**A true-peak brickwall limiter — browser instrument + (Phase 2) JUCE plugin.**
*"Nothing gets out."*

Third of the trilogy: [AUTOPSY](../AUTOPSY) opens the body, RIGOR stiffens it, CASKET is the box it goes in and the lid coming down. Built out of order — the limiter came before the compressor — which is why `shared/necrodyn.js` exists and why RIGOR will inherit it already proven.

Design: [`../CASKET_ARCHITECTURE.md`](../CASKET_ARCHITECTURE.md).

## Run it

Open `casket.html`. No build, no server, no dependencies.

Press **Slab Noise** (deliberately clipped and loud — a limiter with nothing to do is a boring demo), drag the gold **lid** line down, and watch the weight hang from it.

Keys: `1`–`5` pick an arrangement · `B` bypass · `U` unity · `R` reset the plot · `?` shortcuts.

## Render a real file

Drop an audio file anywhere, then press **Render to WAV**. CASKET renders it offline at full quality — no real-time deadline, no dropouts — and hands back a **24-bit WAV plus a before/after measurement**: true peak, sample peak, and integrated LUFS, with the lid marked `under` or `OVER`.

The render is **latency-compensated**, so it drops straight back into a session lined up with the source and A/Bs honestly. This exists because neither CASKET nor AUTOPSY is compiled to an AU yet, and bouncing is the bridge until the first CI build.

## Run the suite

<!--c:casket.harnesses-->11<!--/c--> asserting harnesses,
**<!--c:casket.assertions-->545<!--/c--> assertions**, plus
<!--c:casket.baselines-->14<!--/c--> byte-stable render baselines —
**<!--c:casket.suite-->559<!--/c--> checks**, measured
<!--c:measured-->2026-08-16<!--/c-->.

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

**<!--c:casket.parity-->22,861<!--/c--> parity checks, zero mismatches**, at `-O0`, `-O2` and `-O3`. Compile the same file *without* `-ffp-contract=off` and thousands fail, the worst by 9,805 ulp — the polyphase inner loop is a long multiply-accumulate chain and GCC fuses it into FMAs given the chance. That flag is not belt-and-braces; it is the whole gate.

Emit the header, then check it is **byte-identical** before trusting it. A gate generated fresh from the code it is gating proves nothing; proving the generator is deterministic first is what makes it a gate.

## The plugin

`casket-juce/` builds AU, VST3 and Standalone via CMake (JUCE 7.0.12 fetched automatically). Eighteen parameters. Written compile-first — it has not been built here, because there is no JUCE in this sandbox — but the DSP underneath it is the same header the parity gate proves bit-exact against the browser, so the only untested layer is the JUCE wrapper itself.

```bash
cmake -B build -S casket-juce -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
```

Latency is reported to the host from the *same* pure function the browser and the parity gate use, so the three can never disagree about it.

`casket_sync.js` maintains three verbatim embeds in `casket.html` — `necromath`, `necrodyn`, then the core, in that order, because each closes over the one before. Run it after every edit; the UI harness fails if an embed drifts from its source file by a single byte.

## The vocabulary

| Thing | CASKET calls it |
|---|---|
| Ceiling | the **lid** |
| Scrolling display | the **viewing** |
| Gain-reduction trace | the **weight** |
| Loudness / true-peak meters | the **plot** |
| Oversampling factor | the **lining** |
| Lookahead | the **vigil** |
| Dither | the **dust** |
| Saved preset | an **arrangement** (`.casket.json`) |

## The five arrangements

| | character | vigil | smoother | release | lining |
|---|---|---|---|---|---|
| **Pine** | the plain box, most neutral | 3 ms | full | linear | 4× |
| **Velvet** | lined, forgiving | 2 ms | full | program-dependent | 4× |
| **Oak** | punchy — the transient front survives | 1 ms | ⅜ vigil | fast, program | 4× |
| **Iron** | loud and dense, soft-clip pre-stage | 1.5 ms | ⅝ vigil | fast | 8× |
| **Lead** | sealed, mastering-safe, −0.3 dB margin | 5 ms | full | slow, program | 16× |

Two of those columns are *structural* — the smoother fraction and the release shape change the code path and no knob exposes them. The rest are defaults the arrangement writes into the state when you pick it, and you can override any of them.

## What it guarantees, and what it doesn't

**Absolutely:** no output sample exceeds the lid. Zero epsilon, any input, all five arrangements, proven against squares, impulse trains, clipped noise, DC steps and a 19 kHz sine. This follows from a theorem rather than from tuning — see §5.3 of the architecture doc. The last stage clamps at the lid to absorb floating-point rounding, and the harness watches how much work that clamp does: across the whole hostile battery, 7 × 10⁻¹³ relative. It has never caught anything but the last bit.

**Very nearly:** the *true* peak — the value between samples that a converter actually reproduces.

| material | residual above the lid |
|---|---|
| harmonic / musical | **+0.000 dB** |
| band-limited clipped | +0.55 dB |
| full-scale full-band clipped noise | +1.19 dB |

Detection is oversampled and exact; the gain is *applied* at base rate, and a fast-moving gain aliases. More lining does not help (4× and 16× agree to three decimals); a longer vigil helps a little.

The obvious fix was tried and does not work — see §6.3 and `tests/seal_experiment.js`, which is committed so the conclusion can be re-run rather than believed. Short version: applying the gain oversampled as a *residual* preserves the bit-exact null test but is ill-conditioned exactly when limiting is heavy, and makes the overshoot worse, not better. The full oversampled path does work and roughly halves the residual, but costs the null test permanently. That trade is an open question, not a decision already taken.

Until then, the default −1.0 dBTP lid and Lead's −0.3 dB margin cover it on any real programme material.

**Bit-exactly:** with the lid above the signal, the output is **identical** to the delayed input. Not transparent, not −140 dB of difference — identical. Every arrangement, dither disarmed. That property is the reason the audio path never leaves the base sample rate, and it is the assertion worth protecting above all the others.

## Metering

ITU-R BS.1770-4, implemented to the letter because it has an external right answer. K-weighting coefficients are derived from the analog prototype at any sample rate and match the spec's published 48 kHz table to 1e-12. Momentary (400 ms), short-term (3 s), and gated integrated loudness — absolute gate at −70 LUFS, then relative at −10 LU, both, in that order. A 1 kHz sine at −23 dBFS reads −23.0 LUFS.

## Latency

`OS_Q + vigil + 1` samples, exactly, and **independent of the lining** — 4× and 16× report the same number, so changing the oversampling mid-session does not shift your timing. That falls out of building the oversampler as an `M`th-band filter; the harness asserts it at every lining × vigil combination.

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
  seal_experiment.js      the §6.3 evidence — reports, does not assert
  parity_emit.js          JS truth → parity_expected.h
  core_parity.cpp         the gate
../shared/
  necromath.{js,h}        NM — portable transcendentals (shared with AUTOPSY)
  necrodyn.{js,h}         ND — the dynamics DNA (RIGOR inherits this)
```
