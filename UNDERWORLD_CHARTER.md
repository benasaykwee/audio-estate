# THE UNDERWORLD — Charter

*The auto-mastering conductor for the Recording Parlour trilogy: Masterbox's brain
listens, decides, and drives **AUTOPSY** (EQ) → **RIGOR** (comp) → **CASKET** (limiter)
by emitting a chain preset and orchestrating a render. One button lays out the tools;
the user can still open any slab and carve by hand.*

**Status:** proposed — not yet built. This document exists so its founding constraint
cannot be lost before the first line of code.

---

## LAW 0 — The boundary is one-way and it is at the preset + signal only

> **Masterbox is not bit-exact/parity-gated; the trilogy is sealed and bit-exact.
> The Underworld must connect at the preset + signal boundary only — never by
> merging code into their sealed cores, or it threatens the guarantees that make
> them worth using. Direction stays one-way: Masterbox consumes them.**

This is the first law because breaking it is the one mistake that cannot be undone by
re-verification: it dissolves the very thing being consumed.

**What this permits.** The Underworld may:
1. read Masterbox's analysis / brain output;
2. translate that into each core's `sanitizeState` vocabulary;
3. drive the cores' *public* API only — `setState`, `process(inL,inR,outL,outR)`,
   `latencySamples(state, fs)` — and chain their outputs (doubles, latencies add,
   compensate once at the end), exactly as `AUDIO_INTERCHANGE.md §5` specifies;
4. emit a chain preset `{ version, autopsy, rigor, casket }` and/or a rendered file.

**What this forbids.** The Underworld may **never**:
- edit `shared/` (`necromath`, `necrodyn`) or any `*_core` / sealed C++ in the trilogy;
- copy Masterbox DSP *into* a trilogy core, or a trilogy core *into* Masterbox;
- make a trilogy core depend on Masterbox in any direction.

**Why (the short version).** The trilogy is JS↔C++ bit-exact, parity-gated (80k+ checks),
with sealed regression hashes — AUTOPSY is edited only for correctness, never elegance.
Masterbox is unit-tested "close," not bit-exact, and rides a different DSP foundation.
A code merge is therefore both risky (it can silently break a seal) and unnecessary (the
trilogy already ships a clean signal/preset contract). Keep them separate and let the
brain speak to the scalpels only in *presets*.

---

## Enforcement / how to keep this from rotting
- Any Underworld work reads this file first (and the mirrored memory note
  `underworld-boundary-rule`).
- The translator is verified in the trilogy's own idiom: every emitted state is a
  `sanitizeState` fixpoint, and the rendered chain is asserted to hit its loudness
  target and hold its ceiling — plus a null/bypass control.
- **When The Underworld actually exists, echo LAW 0 into `AUDIO_INTERCHANGE.md §5`**
  so the trilogy sessions see it too. As of this writing those projects have *zero*
  knowledge that Masterbox exists; that edit crosses their boundary and needs Ben's word.

## Pointers
- Consumer: `DRAWING PROGRAM/masterbox-plugin` (JUCE-free core in `core/include/masterbox/`).
- Producers: `AUTOPSY/`, `RIGOR/`, `CASKET/` (+ `shared/`), governed by `AUDIO_INTERCHANGE.md`.
- Signal/preset contract: `AUDIO_INTERCHANGE.md §5`.
