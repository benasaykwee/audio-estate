# The `.rigor.json` case file

**Status:** v0.5 · 2026-08-15

A case file is a plain JSON object holding one compressor state. It is what the Save button writes, what the share link encodes, and what the plugin stores in its host session. There is no binary format and there will not be one.

## Loading

```js
RIGOR.loadCase(obj)      // migrate, then sanitise. Use this for anything external.
RIGOR.sanitizeState(obj) // sanitise only. Internal, already-current state.
```

**Always `loadCase` for anything that came from outside this session** — a file, a drop, a URL hash. `sanitizeState` alone will silently discard fields it does not recognise and hand back defaults, which is exactly what happened to one factory case after the lineage merge: it opened, looked wrong, and said nothing.

The two internal paths — the undo stack and the A→B copy — deliberately use `sanitizeState`, because they are deserialising state this session serialised itself. Running the migration over already-current values would rescale them a second time.

## Fields

Every numeric field is clamped on load. Every unknown field is dropped. Nothing throws.

| Field | Range | Notes |
|---|---|---|
| `bypass` | bool | passes audio through, delayed by the reported latency — see `bypassSplit` |
| `bypassSplit` | bool | **what bypass MEANS at 2+ bands.** `false` (default) = bypass is dry and bit-transparent; the audio never enters the crossover. `true` = bypass still splits and re-sums, so an A/B isolates the compression rather than the whole plugin. Inert at 1 band. |
| `style` | `fresh` `settling` `spasm` `repose` | four genuinely distinct signal paths — see the note below |
| `inGain` | −24 … 24 dB | |
| `thresh` | −60 … 0 dB | 0 is legal, and is why the sanitiser uses `isFinite` rather than `\|\|` |
| `ratio` | 1 … 1000 | **1000 means infinity** and becomes an exact zero `invR`, not 0.001 |
| `knee` | 0 … 30 dB | total width |
| `attack` | 0.02 … 500 ms | time to 63.2% of the target gain reduction |
| `release` | 1 … 2500 ms | ignored when `relSync` is non-zero |
| `autoRel` | bool | program-dependent release |
| `relSync` | 0 … 10 | index into the note divisions; 0 means use `release` |
| `bpm` | 20 … 300 | written by the host, but it lives in the STATE |
| `curve` | 0 … 100 | 0 is exactly the plain one-pole |
| `hold` | 0 … 500 ms | |
| `holdTaper` | 0 … 100 % | 0 = hold switches into release; 100 = it tapers |
| `range` | 0 … 60 dB | maximum permitted reduction |
| `look` | 0 … 20 ms | lookahead; reported to the host as latency |
| `detect` | `auto` `peak` `rms` | `auto` follows the style |
| `detOs` | bool | detect on the interpolated peak rather than the sample |
| `detOsX` | **2, 4 or 8** | the interpolation factor. A SET, not a range — 3 and 16 are rejected, not clamped |
| `scOn` `scHp` `scLp` `scListen` | bool, 10…1000, 1000…20000, bool | sidechain filter |
| `link` | 0 … 100 % | |
| `place` | `lr` `ms` | |
| `mix` | 0 … 100 % | |
| `delta` | bool | monitor only what was removed |
| `makeup` `autoMakeup` | −24…24 dB, bool | auto makeup is analytic, never measured |
| `bands` | 1 … 3 | |
| `xover` | `[lo, hi]` Hz | kept ordered and 10% apart; see below |
| `band[0..2]` | `{ threshOff, gain, mute, solo }` | ±24 dB each |
| `meta` | `{ name, note }` | |

## A note on the styles, because this document was wrong about it

For seven rounds this file said "four topologies, not four presets". That was
false: Fresh and Spasm shared a signal path and rendered bit-identically on
identical settings, differing only in their defaults. Measuring them for a
documentation table is what exposed it.

It is true *now* — Spasm was given its own peak-follower decay, 2 ms against
Fresh's 15 — but it became true by being fixed, not by having been right. A
harness asserts the topology count, derived from the style table rather than
written down, so the claim cannot drift from the code again.

## Two rules that are not obvious

**The crossover pair is kept apart by pushing the LOWER one down.** If both are at the ceiling there is no room to raise the upper one, and the splitter's own separation rule then designs a filter section at 23,760 Hz — past `0.45·fs` at 48 k and past Nyquist below it. Found by the fuzzer; the sanitiser now lowers `xover[0]` to `20000/1.1` first.

**Solo beats mute**, as on every console ever built. If any band is soloed, only soloed bands are audible and mute is ignored.

## Migration

`migrateCase` translates pre-merge files by *shape*, not by a version number — the files that need migrating are exactly the ones written before anyone thought to put a version in them.

| Old | New |
|---|---|
| `lookahead` | `look` |
| `sc: { on, hp, lp, listen }` | `scOn` `scHp` `scLp` `scListen` |
| `link`, `mix`, `curve` as 0…1 | ×100 |

**The rescale is keyed on a structural marker, never on the value itself.** A file is treated as old only if it carries `lookahead` or an `sc` block — names that simply do not exist in the current shape.

The first version of this sniffed the value instead: "is it 1 or less? then it must be the old 0–1 scale." That looks reasonable and is wrong. `link: 0.11` is a perfectly legal current value meaning 0.11%, and the sniff silently turned it into 11%. The round-trip audit caught it — a saved session would have reopened louder than it was closed.

A file carrying neither marker is left exactly alone. The worst case is a very old file that happened to have no lookahead and no sidechain block, which keeps its percentages — and such a file is indistinguishable from a current one anyway, so leaving it be is the only safe choice.

Migration is idempotent: loading twice does not rescale twice, which the harness asserts.

## What is deliberately not in the file

Meter readings, gain-reduction history, and anything else derived from playback. A case file is a pure description of settings; the same file always produces the same audio from the same input. That is what makes byte-stable regression possible, and it is why auto-makeup is computed analytically rather than measured.
