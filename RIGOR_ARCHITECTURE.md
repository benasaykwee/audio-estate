# RIGOR — Architecture
### A dynamics processor (Pro-C lineage) · browser instrument + JUCE plugin
*"The body stops moving."*

**Status:** v0.5 — 2026-08-16
**Supersedes** the v0.1 design sketch entirely. That document described a lineage that no longer exists; leaving it in place was worse than having no document, because it read as current.

**Contract:** [`AUDIO_INTERCHANGE.md`](AUDIO_INTERCHANGE.md) — the five laws and the shared-file log.

---

## 1. What it is

Second of three. AUTOPSY opens the body, RIGOR holds it still, CASKET closes the lid.

One DSP core, two bodies — a browser instrument and a JUCE plugin — proven identical to the last bit by a parity gate that currently stands at **<!--c:rigor.parity-->62,642<!--/c--> checks**.

## 2. Layout

```
../shared/necromath.{js,h}    NM — portable transcendentals. Shared, never forked.
../shared/necrodyn.{js,h}     ND — the dynamics DNA. Shared with CASKET.
rigor_core.js                 single source of truth: ALL DSP
rigor.html                    browser instrument (NM + ND + core embedded verbatim)
rigor_sync.js                 embeds all three; run after ANY edit to any of them
rigor-juce/Source/RigorCore.h  parity-checked C++ twin
rigor-juce/Source/Plugin*.{h,cpp}  43-parameter APVTS, bespoke editor
tests/                        core · UI · plugin lint · fuzzer · regression · parity · bench
docs/chart.html               the progress chart
docs/CASE_FORMAT.md           the .rigor.json format
```

## 3. Signal flow

```
in → inGain → [mid/side matrix] → delay(look) ─┬─────────────── dry
                                               │
        detector source ─────────────────────► │
        (input, or output×prev gain for the    │
         feedback topology, or the sidechain)  │
                ↓                              │
        [sidechain HP/LP] → [tap for analyser] │
                ↓                              │
        peak follower or RMS                   │
                ↓                              │
        stereo link                            │
                ↓                              │
        gain computer (soft knee, range)       │
                ↓                              │
        envelope: attack / hold / release      │
        + auto-release + release curve         │
        + hold taper (holdTaper)               │
                ↓                              │
              gain ───────────────────────────►╳ wet
                                               │
                              mix, or delta ───┤
                                               ↓
                                    makeup → [un-matrix] → out
```

With `bands > 1` this whole chain runs once per band behind a Linkwitz-Riley splitter, and the outputs are summed with per-band gain, mute and solo.

## 4. The decisions that carry weight

**The dry tap sits after the delay line.** Tap it before and parallel mix comb-filters instead of mixing.

**The envelope smooths the gain, not the level** — so attack time means one thing regardless of ratio and overshoot. Settling deliberately does the opposite, because level-dependent attack is what makes an optical cell behave like one.

**Attack is *defined* as time to 63.2% of the target gain reduction.** Stating the definition is what makes the harness assertion mean anything. Our numbers will not match Pro-C's, and that is fine.

**Auto makeup is analytic** — the gain computer evaluated at 0 dBFS, negated. A measured estimator would make the output depend on playback history and end byte-stable regression on the spot. Per-band makeup follows each band's *shifted* threshold.

**Tempo lives in the state, not in a host callback.** The processor reads the playhead and writes BPM into `rigor::State`; the DSP never asks anyone for the time. That is the only reason a tempo feature can coexist with byte-stable regression.

**At one band the multiband splitter is bypassed entirely** and the caller's own buffers go to engine 0, so the result is bit-identical to the single engine. That is what let every pre-multiband baseline stay blessed. Asserted for all four styles.

**The multiband wrapper does not prime its inner engines at construction.** Engines snap on their first `setState` and glide afterwards; priming with defaults made the first real state glide in from them, which alone broke the bit-identity.

## 5. The four styles

Four signal paths, not four presets. Nothing on the panel exposes the topology.

| | **Fresh** | **Settling** | **Spasm** | **Repose** |
|---|---|---|---|---|
| | Clean | Opto | Punch | Bus |
| Topology | feedforward | **feedback** | feedforward | feedforward |
| Detection | peak | RMS 10 ms | peak | RMS 50 ms |
| Envelope on | gain | **level** | gain | gain |
| Peak follower | 15 ms | — | **2 ms** | — |
| Attack | as set | **scales with overshoot** | as set | as set |
| Release | as set ± auto | auto, always | auto, fast | auto, slow |

**Four is a recent number.** Until round 8 there were three: Fresh and Spasm
shared a path and rendered bit-identically on identical settings, differing
only in their defaults, while the documentation claimed four. Measuring the
styles for a table is what exposed it. Spasm now has its own peak-follower
decay — 2 ms against Fresh's 15, so it tracks transients rather than smoothing
them — and a harness asserts the topology *count*, derived from the style table
rather than written down, so the claim cannot drift from the code again.

Settling is the parity canary: its feedback path compounds a one-ulp disagreement through a nonlinear gain computer, so if parity ever breaks it breaks there first.

## 6. Metering

**True peak**, polyphase at **2×, 4× or 8×** (`detOsX`; a set, not a range — 3
and 16 are rejected rather than clamped). The same interpolator optionally
drives the *detector*, so the compressor can react to an inter-sample peak
before it becomes a sample peak. `TP_TAPS = 8` is empirical and load-bearing — raising it without redesigning the window makes the meter *worse* (8 taps −0.049 dB, 12 taps +0.451, 16 taps +0.613), because a Blackman window over a short span narrows the passband and the unity-DC normalisation then overshoots near fs/4. Pinned by assertion.

**LUFS** momentary / short-term / integrated with the two-stage BS.1770 gate. K-weighting is designed parametrically rather than copied from the standard's 48 kHz table, so it is correct at 44.1, 88.2, 96 and 192 k. EBU Tech 3341 case 1 reads −22.99 against a −23.0 target, at every rate.

**Correlation** for mono compatibility. **Spectrum** of the sidechain, so what the detector hears is visible rather than only audible.

## 7. How it is proven

| Harness | What it is for |
|---|---|
| `rigor_test.js` | analytic truth — knee continuity, envelope timing, the null tests |
| `rigor_ui_test.js` | the embed laws, UIH helpers, and that every control names real state |
| `rigor_plugin_test.js` | static lint on the JUCE sources; no compiler needed |
| `rigor_fuzz.js` | what I did not think to test |
| `rigor_audit.js` | what a HOST does to it — latency, automation, transitions, extremes |
| `rigor_regression.js` | byte-stable rendered-buffer baselines, every factory case included |
| `core_parity.cpp` | the C++ twin, bit-exact |
| `rigor_bench.js` | a measured CPU figure |

**The null test is the single most valuable assertion here.** At 1:1, or below threshold, or at `mix = 0`, or bypassed, or with `range = 0`, the output must be *bit-identical* to the input. It proves the signal path does no damage when idle, and it is checked under fuzzing across every other setting.

## 8. Lessons this project has actually paid for

**A legal value that is also a boundary value is where these break.** AUTOPSY's `isFinite` threshold of 0. The knee branch's `>=`. The `y < x` guard in `kneeGain`. The crossover pair at the top of its range. Sanitisers use `isFinite(n) ? n : default`, never `+x || default`, and the harnesses sweep boundaries on purpose.

**Algebraically identical is not identical.** The gain computer's linear branch is `d*(invR-1)`, not `(T + d*invR) - x`, because the second form's round trip does not always return exactly `x` and a 1:1 ratio then produces 1e-15 of reduction. The peak follower is `pk *= c; if (|x| > pk) pk = |x|`, and writing the equivalent-looking conditional cost 7,507 parity mismatches.

**An assertion that names its expected value is not checking anything.** The plugin lint asserted a hardcoded `"0.3"` while claiming it matched the JS core, which said `0.1`. It passed for two rounds while the two disagreed. Assertions derive; they do not restate.

**A bound that re-derives the signal path is a second implementation of it,** with its own bugs and none of the tests. Six attempts at an analytic output bound in the fuzzer were all wrong, and the engine was right every time.

**A harness only checks what it was told to check.** The browser control rack pointed at dead field names for a whole round with every test green.

## 9. Not here, deliberately

**Oversampling of the audio path.** RIGOR has no hard corners — its gain moves through a smoothed envelope — so there is nothing to alias. CASKET, which brickwalls, needs it and has it.

**Linear-phase crossovers.** An FIR project wearing a compressor's costume, and the latency would undo the point of lookahead.

**External sidechain in the browser.** The core accepts one and the plugin has the bus; the browser has nowhere to get a second input from.
