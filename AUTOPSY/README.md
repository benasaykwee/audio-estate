# AUTOPSY
### a surgical parametric EQ · *every frequency examined.*

A Pro-Q-style EQ by Ben Asaykwee: browser instrument + JUCE plugin (AU/VST3),
built on one DSP core proven bit-identical across both.

## Using the browser instrument

Open `autopsy.html`. Press **Slab Noise** (flat looped noise — incisions show
plainly in the analyzer), drop any audio file onto the page, or open **Live
Input** for the interface/mic.

Double-click the table to make an incision. Drag its handle for frequency and
gain, wheel for Q, right-click to inspect it in the panel below, **S** to solo
it, **Delete** to close it, **Ctrl/Cmd+Z** to exhume your last move. **Slab
A/B** keeps two examinations for before-and-after comparison; the arrow button
copies the current slab across. **Save/Open Report** round-trips the full state
as `.autopsy.json`; **Share** stages the whole state in a copyable URL; the
**Factory Reports** menu holds ten pre-written examinations.

Eight band types: bell, low/high shelf, low/high cut (6–48 dB/oct Butterworth
slopes), notch, bandpass, and tilt. Every band can be placed stereo, left,
right, mid, or side — off-stereo bands draw dashed, with their placement letter
by the handle.

**Dynamic EQ** (v0.4): any gain-bearing band can listen. Tick "dyn" on its card
and set range (±24 dB), threshold, attack, and release — a bandpass detector at
the band's own frequency drives an envelope that pulls the band's gain toward
the range as the signal exceeds the threshold. The dotted ghost shows where the
band can reach; the bright moving curve is what the engine is doing right now.
Gain tools live next to the output slider: halve, double, invert, or flatten
every gain at once, and **Compensate** offsets the output so the average curve
rests at 0 dB. Press **?** for the full shortcut sheet.

## Architecture (the short version)

`autopsy_core.js` is the single source of truth — all DSP, all response math.
It is embedded verbatim into `autopsy.html` by `autopsy_sync.js` (run it after
ANY core edit), and mirrored in C++ as `autopsy-juce/Source/AutopsyCore.h`.

The same `magnitudeAt()` that shapes the audio draws the curve in both UIs:
what you see is provably what you hear.

### The parity law

The C++ twin is **bit-exact**, not "close". Two rules make that possible:

1. **Necromath (`NM`/`nm`)** — the core's transcendentals (sin, cos, exp, log,
   pow10) are built from raw IEEE add/multiply ops in a fixed order, identical
   in both languages. Native libm and v8 disagree in the last 1–2 ulp, and an
   IIR feeds that back until it's real drift; these don't.
2. **`-ffp-contract=off`** — no FMA contraction. The compiler must round every
   multiply and add separately, exactly like the JS engine.

`tests/core_parity.cpp` holds the gate: <!--c:autopsy.parity-->9,292<!--/c--> checks (coefficient cascades for
all 8 types and all 6 slopes, response math, rendered engine output through
every placement path AND the full dynamics path — detector, envelope, gain
modulation) compared bit-for-bit against JS truth values.

## Tests

| harness | run | checks |
|---|---|---|
| core | `node tests/autopsy_test.js` | 70 |
| UI logic | `node tests/autopsy_ui_test.js` | 68 |
| regression | `node tests/autopsy_regression.js` | 5 byte-stable baselines |
| parity | `node tests/parity_emit.js && g++ -std=c++17 -O2 -ffp-contract=off -o core_parity tests/core_parity.cpp && ./core_parity` | 9,292 bit-exact (incl. 44.1k/96k + split-buffer cases) |
| plugin lint | `node tests/autopsy_plugin_test.js` | 15 — both directions: named-exists AND exists-reachable |
| fuzzer | `node tests/autopsy_fuzz.js` | seeded; 1,600 hostile inputs + states×materials×rates |
| audits | `node tests/autopsy_audit.js` | 12 — round-trips, advice verification, embed freshness |
| bench | `node tests/autopsy_bench.js` | measured: 1 band 513×, 12 heavy 94×, 12+dyn 59× realtime |

The engine is proven **block-size independent** (17 chunk sizes incl. primes,
bit-identical), **zero-latency in every state** (impulse at sample 0),
**denormal-free in silent tails** (was 178k subnormal samples), and its first
`setState` **snaps instead of fading in from defaults**.

Regression baselines are FNV-1a hashes over `%.17g` of rendered samples — any
numeric drift anywhere in the core fails the gate. Rewrite deliberately with
`--write` only when the core is *supposed* to change, and say so in the commit.

## House rules (scar tissue)

- The JS core leads; the C++ header follows; the parity gate proves it.
- Run `node autopsy_sync.js` after any core edit (it verifies byte-identical).
- Never a literal closing script tag inside any script, even in a comment.
- Full JUCE builds happen on CI (`.github/workflows/autopsy.yml`), not locally.

## Roadmap

- **Phase 1 — browser corpse: done** (necromath core).
- **Phase 2 — JUCE port: core + parity done** (v0.4, 146-param layout); plugin
  scaffold awaits its first CI build.
- **Phase 3 — done**: variable slopes ✓, bandpass + tilt ✓, M/S + L/R
  placement ✓, A/B ✓, solo ✓, undo ✓, factory reports ✓, share-URL ✓,
  **dynamic EQ ✓** — the envelope-follower work that opens the door to the
  compressor project. Remaining nicety: plugin-side A/B.
- **Phase 4 (dark arts, optional)** — linear phase.
- **Next body on the table** — the compressor (Pro-C lineage), carrying this
  detector/envelope DNA forward.
