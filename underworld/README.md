# underworld/

The Underworld's own code — Masterbox's brain auto-driving the AUTOPSY/RIGOR/CASKET
trilogy. This directory is the **consumer** side; it drives the trilogy cores' public API
and never touches their source.

**Governance (do not restate here — cite):**
- `../UNDERWORLD_CHARTER.md` — **LAW 0**: connect at the preset+signal boundary only,
  never merge into the sealed cores, one-way (Masterbox consumes the trilogy).
- `../UNDERWORLD_INTERCHANGE.md` — **how**: preset schema (§2), the three translator
  assertions (§3.2), build-flag boundary (§4), Masterbox-side bypass rules (§5), latency
  ownership (§6), write territory (§8).

## What's here
| File | What |
|---|---|
| `spike.js` | The chaining spike. Proves the signal/preset contract end-to-end: AUTOPSY → RIGOR → CASKET holds the ceiling exactly, and the idle chain nulls to 1 ULP. |
| `translate.js` | The translator (step 2). Masterbox `MasteringSettings` → an `underworld.chain` preset (§2). **All three cores mapped** — AUTOPSY (tone shelves + 10-band Match-EQ, mid bells folded), RIGOR (3-band comp mirroring Masterbox's exact formulas), CASKET (ceiling/drive). The full vocabulary map with reasons is the header comment. |
| `translate.test.js` | The three §3.2 assertions — fixpoint, clamping-reported, rendered + null — PLUS render proofs that each mapping does what it claims (EQ boosts the right band, comp reduces level), each with a control that proves it bites. |
| `diagnostics/casket_null.js` | Repro for the §10 finding: CASKET's DC blocker + soft knee break a bit-exact null even below the lid. |

## Run
```bash
node underworld/spike.js
node underworld/translate.test.js
```

## Per-core "idle / do nothing" (discovered by the spike)
- **AUTOPSY** — default state (no bands on) is passthrough.
- **RIGOR** — `ratio:1` (or `mix:0`) is unity (`AUDIO_INTERCHANGE.md §4`).
- **CASKET** — lid **above** signal **+ `knee:0` + `dc:false`**. Lid-above-signal alone is
  *not* enough: the DC blocker and the soft knee each perturb the signal below the lid.
  See `../UNDERWORLD_INTERCHANGE.md §10`.

## Status
JS prototype against the trilogy's **reference** cores. This is exploration, not the
product. The C++/plugin seam is gated on interchange **§7** (build the seam after the
trilogy's first compile) and **§9.1** (link the cores vs. host them as plugins) — not
started, and both are Ben's calls.
