# AUTOPSY — Architecture
### a surgical parametric EQ · browser instrument + JUCE plugin
*"every frequency examined."*

**Status:** v0.4+, current as of 2026-08-16 (fourth sitting). Rewritten from
scratch — the previous version of this file described the v0.1 sketch and a
stale doc that reads as current is worse than none (RIGOR's lesson, applied).

---

## 1. What exists

One DSP core, two bodies, proven identical to the last bit.

```
CLAUDE/
  shared/necromath.js /.h     NM — portable transcendentals (extracted FROM this core)
  AUTOPSY/
    autopsy_core.js           the single source of truth (closes over NM)
    autopsy.html              browser instrument — two embeds: nm-src → core-src
    autopsy_sync.js           embeds both files verbatim; verifies; refuses </script>
    autopsy-juce/
      Source/AutopsyCore.h    C++ twin (includes ../../../shared/necromath.h)
      Source/PluginProcessor  146-param static APVTS
      Source/PluginEditor     bespoke face: table + handles + inspector strip
    tests/                    seven harnesses + bench (see §5)
    docs/autopsy_report.html  the coroner's report
```

## 2. The DSP, as built

**Bands.** 12 fixed slots. Types: bell, low/high shelf, low/high cut, notch,
bandpass, tilt. Cuts cascade true Butterworth sections at 6–48 dB/oct (even
order: Q_k = 1/(2cos(π(2k−1)/2n)); odd: first-order section + Q_k =
1/(2cos(πk/n)); first-order via K = sin/(1+cos)). Tilt is complementary ∓g/2
shelves. Max 4 sections per band; TDF2; coefficients RBJ, all transcendentals
through NM.

**Placement.** Any band runs stereo / left / right / mid / side. Exact matrix:
m = (L+R)/2, s = (L−R)/2, reconstruct (m+s, m−s). Filter states zero on
placement change. Proven: mid ≡ stereo on mono material bit-exactly; side on
mono is a perfect passthrough.

**Dynamics.** Per gain-bearing band: bandpass detector (band's own frequency,
Q clamped 0.3–8) on the mono mix of that band's chain input, per-sample
attack/release envelope, control-rate gain offset `range·(over/(over+6))`.
Below threshold the output is **bitwise identical** to the static band —
asserted, not hoped.

**The engine's timing contract.**
- `CTRL = 32` — smoothing and coefficient recompute at control rate; audio per-sample.
- `ctrlPhase` is **stream time, carried across `process()` calls** — host
  buffer size cannot change the sound. Proven across 17 chunk sizes including
  primes, and pinned in the parity gate by a split-buffer case.
- **First `setState` snaps; later ones glide** (`primed` flag). A fresh engine
  arrives at its state instead of fading in from defaults.
- `reset()` = fresh-engine equivalence, byte-identity asserted by the fuzzer.
- **Denormals are flushed by contract** (`dn()` at every section output and
  state write, and on the envelope). Measured before the guard: 178k subnormal
  samples in a long silent tail. The flush is arithmetic, not optimisation —
  the twin mirrors it operation-for-operation, because the plugin's
  `ScopedNoDenormals` would otherwise make the two deployments disagree.
- Zero latency, and that claim is tested in every state (impulse at sample 0).

**Response math.** One `magnitudeAt()` drives the browser canvas, the plugin
editor, and the parity gate. What you see is provably what you hear.

## 3. The parity law (why two languages agree to the bit)

1. Every transcendental goes through **NM** — fixed-order IEEE ops, identical
   in JS and C++. `sqrt` stays native (IEEE-exact already).
2. **`-ffp-contract=off`** on every C++ target — no FMA fusion.
3. The gate (`tests/core_parity.cpp` vs `tests/parity_emit.js`) holds
   **<!--c:autopsy.parity-->9,292<!--/c--> bit-exact checks**: all 52 coefficient cases (8 types × settings +
   both cuts × all 6 slopes), response probes, and six rendered cases —
   surgical, placed (true stereo), dynamic, placed@44.1k, dynamic@96k, and
   the split-buffer glide that forces the twin to carry `ctrlPhase`.

## 4. State, files, compatibility

`sanitizeState` is the only door in: file picker, drag-drop, URL hash, host —
everything passes through it, it is idempotent (audited on random states), and
**a legal value that is also a boundary value survives it untouched** (LAW 5;
0 dB threshold is the canonical example, `isFinite` not `||`).

`.autopsy.json` reports round-trip byte-stably. v0.1-shaped files (no
slope/place/dyn) open with correct defaults — asserted, forward-compatible.

## 5. The harnesses

| harness | checks | what it holds |
|---|---|---|
| `autopsy_test.js` | 70 | DSP analytics, placement algebra, dynamics, block-size invariance, latency promise, denormal stress, 5 sample rates |
| `autopsy_ui_test.js` | 68 | pure UIH helpers, embed order (LAW 4), factory reports vs core, script parsing |
| `autopsy_regression.js` | 5 baselines | FNV-1a over %.17g — any drift fails |
| `core_parity.cpp` | 9,292 | JS↔C++ bit-exactness incl. rates + split buffers |
| `autopsy_plugin_test.js` | 15 | two-direction lint: named-exists AND exists-reachable; laws in CMake/CI; versions DERIVED |
| `autopsy_fuzz.js` | 9 suites | 1,600 hostile sanitizer inputs, states × materials × rates, null tests, reset() byte-identity, no fade-in |
| `autopsy_audit.js` | 12 | round-trips, advice verification (§6.5), embed freshness, motion guards |
| `autopsy_bench.js` | — | measured: 1 band 513×, 12 heavy 94×, 12+dyn 59× realtime |

CI runs all of them, plus the parity gate, plus AU/VST3 builds on macOS.

## 6. Design rules this project obeys (and where they came from)

- **The core is edited for correctness, never for elegance** — it is a sealed
  artifact behind blessed hashes (Interchange §3).
- **Re-blessing a baseline is a deliberate act that gets written down.** Done
  once this sitting: the primed-snap fix moved 3 of 5 hashes, understood and
  recorded. The other two survived, which is its own evidence.
- **Advice must verify itself** — Compensate is asserted to land the average
  curve at exactly 0 (§6.5's survey answer: AUTOPSY has one advice function).
- **An assertion that names its expected value is restating, not checking** —
  versions and surfaces are derived from the artifacts themselves.
- **A legal value that is also a boundary value is where everything breaks** —
  the fuzzer sweeps boundaries on purpose.

## 7. What remains

Plugin-side A/B (the browser has Slab A/B; the processor doesn't yet), the
first real CI compile of the AU/VST3 (needs the GitHub push), and linear phase
— still Phase 4, still optional, still an FIR/latency project wearing an EQ
costume. The compressor (RIGOR) and limiter (CASKET) are their own slabs with
their own documents.
