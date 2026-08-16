# THE UNDERWORLD — Interchange
### The engineering contract for the seam between Masterbox and the trilogy

*Companion to `UNDERWORLD_CHARTER.md`. The Charter says **whether** the two may touch
and in which direction. This says **how**, at the level a compiler and a test can check.*

**Status:** proposed. Nothing here has been built. Written 2026-08-16 so that both
working sessions code against one written seam instead of two remembered conversations.

---

## 0. Three documents, three jobs — do not restate each other

| Document | Owns | Never duplicate here |
|---|---|---|
| `UNDERWORLD_CHARTER.md` | **LAW 0.** The boundary, its direction, what is permitted and forbidden. | The boundary rule itself. Cite it; do not re-word it. |
| `AUDIO_INTERCHANGE.md` | The trilogy's own contract: the five laws, `shared/`, the signal chaining rules (§5), the invariants (§4). | Sample format, chaining, sanitise-on-the-way-in, order-is-EQ-comp-limiter. All settled there. |
| **This file** | The seam's mechanics: preset schema, translator verification, build flags, module collision, latency ownership, who writes where. | — |

**This is not stylistic tidiness.** RIGOR's ninth round found a safety rule with two
copies where only one was reachable, and recorded the lesson: *a rule with two copies
needs two tests, or the second is decoration.* Three overlapping documents would be the
same defect in prose. When a rule here depends on one over there, **cite the section
number rather than copying the sentence.**

---

## 1. What crosses the seam

Exactly two things, per LAW 0:

1. **A chain preset** — a document, defined in §2 below.
2. **Audio** — via the trilogy cores' public `process()`, under `AUDIO_INTERCHANGE.md §5`.

Nothing else. No headers copied in either direction, no shared state object, no callback
from a trilogy core back into Masterbox.

---

## 2. The chain preset — the actual interface

The Charter names it `{ version, autopsy, rigor, casket }` and stops there, correctly,
because it is a constitution. This is the definition both sides code against.

```jsonc
{
  "format": "underworld.chain",
  "version": 1,
  "generatedBy": "masterbox/<version>",     // provenance, never behaviour
  "fs": 48000,                              // the rate the brain analysed at
  "target": { "lufs": -14.0, "ceilingDbTp": -1.0 },
  "autopsy": { /* exactly AUTOPSY.sanitizeState output */ },
  "rigor":   { /* exactly RIGOR.sanitizeState output   */ },
  "casket":  { /* exactly CASKET.sanitizeState output  */ },
  "report":  { /* optional, human-facing; see §3.3 */ }
}
```

**Rules that make it safe:**

1. **Each slab's sub-object is that core's own `sanitizeState` output and nothing else.**
   Not a Masterbox-shaped description of it. The trilogy already defines these formats
   (`.autopsy.json`, `.rigor.json`, `.casket.json`) and already loads them from file,
   drop and URL hash. The seam reuses a road that exists.
2. **`version` is on the envelope, not the slabs.** Each core owns its own migration
   (RIGOR has `migrateCase` and learned the hard way to key on *structure*, not on a
   sniffed value — see `AUDIO_INTERCHANGE.md §7`). The envelope version governs only
   the envelope.
3. **Unknown envelope fields are preserved, not dropped**, so an older reader does not
   silently destroy a newer writer's work on round-trip.
4. **`fs` is advisory.** Nothing in the trilogy assumes a sample rate; a preset generated
   at 44.1 k must load and behave at 96 k. `fs` records where the analysis happened so a
   report can say so, and so a mismatch can be *mentioned* rather than hidden.
5. **`target` is what the brain was asked for**, not what was achieved. What was achieved
   is measured after the render and belongs in `report`.

---

## 3. The translator, and how it is verified

The translator is the only genuinely new code the Underworld needs: brain vocabulary in,
three sanitised states out. It is also the only place a mistake can quietly waste the
trilogy's guarantees, so it gets the trilogy's own idiom of proof.

### 3.1 The vocabularies do not match, and that is the work

Masterbox's `MasteringSettings` is a mastering-desk vocabulary: `eqLow`, `eqLowMid`,
`eqHighMid`, `eqHigh`, `compAmount`, `punch`, `width`, `makeupDb`, `ceilingDb`. The
trilogy speaks in twelve free bands with types and slopes, four compressor topologies
with per-sample envelopes, and five limiter arrangements. **The mapping is lossy in one
direction and under-determined in the other.** Write it down as a table in the translator's
own doc when it is built, and treat every choice as a decision with a reason, not a default.

### 3.2 The three assertions that must exist before it ships

1. **Fixpoint.** Every emitted state satisfies `sanitize(sanitize(s)) === sanitize(s)`
   and `sanitize(s) === s`. Named in the Charter's enforcement section; this is where it
   is specified. Fixpoint is the cheap proof that the translator speaks the target language
   rather than something the sanitiser happens to tolerate.
2. **Clamping is reported, never silent.** If the brain asks for a value the core clamps,
   the translator records it in `report.clamped[]`. A brain that believes it applied
   −9 dB when the core allowed −6 will keep compensating in the wrong direction on the
   next pass, and the two-pass `learnMaster()` calibration is exactly the loop that would
   amplify it.
3. **The rendered chain is measured, not assumed.** Assert the render hits its loudness
   target within a stated tolerance and holds its ceiling, plus a null control: a preset
   asking for no processing must come back **bit-identical** through the whole chain
   (`AUDIO_INTERCHANGE.md §4`).

   **An unsealed arrangement is necessary but NOT sufficient — corrected 2026-08-16 by
   measurement, see §10.** CASKET's `Lead` is sealed and cannot be bit-exact by design, so
   it is disqualified; but even unsealed `velvet` fails to null with the lid merely above
   the signal. Two always-on paths perturb it, both measured 12 dB under the lid:
   `dc:true` (the DC blocker, a real sub-20 Hz high-pass whose warm-up gives ~6e-2), and
   the soft `knee`, which applies a sub-0.1 dB touch **independent of headroom** — `lid:6`
   and `lid:12` produced the identical 1.07e-2 residual, so the knee curve reaches well
   below the lid. **The idle recipe is therefore lid-above-signal + `knee:0` + `dc:false`.**
   Per-core idle states are tabulated in `underworld/README.md`.

   *Why this clause is worth its length:* a translator trusting "unsealed ⇒ null" would
   ship a null test that quietly never bites, which is this suite's most expensive defect
   class. The spike found it on its first run.

### 3.3 `report` is advice, and advice gets verified

The suite's standing rule is that an advice function must apply its own advice and
re-measure (`AUDIO_INTERCHANGE.md §6.5`). `explainSettings` output that ships in `report`
inherits that rule: if it claims a move produced an effect, something measured it.

---

## 4. The build boundary — the flag that must travel

**This is the clause neither existing document covers, and it is the one with teeth.**

LAW 0 permits the Underworld to *drive the cores' public API*. Doing that in C++ means
**compiling and linking the trilogy's headers inside Masterbox's build**, which is not a
code merge and is therefore permitted. But it moves those headers under a different
build system with different flags, and:

> **The trilogy's bit-exactness is a property of the build, not only of the source.**

Measured, not asserted: compile `CasketCore.h` without `-ffp-contract=off` and **8,351 of
11,164 parity checks fail, worst by 9,805 ulp**, with the oversampler taps breaking first
— which is CASKET's most safety-critical path. GCC and Clang fuse `a*b+c` into an FMA
given the chance, and a long multiply-accumulate chain is exactly where they take it.

**Therefore, binding on any Underworld build that compiles a trilogy header:**

1. `-ffp-contract=off` is set for those translation units. Non-negotiable, per
   `AUDIO_INTERCHANGE.md §2 LAW 1`.
2. **Both `necromath` and `necrodyn` come from `shared/`, by the same relative include
   path the trilogy uses.** No second copy. A forked substrate is a silently different
   engine that still compiles.
3. The Underworld's CI **runs the trilogy's own parity gates against the headers as it
   built them**, not merely against the trilogy's own CI. A gate that ran somewhere else
   proves something about somewhere else. RIGOR's ninth round watched its parity gate
   report success from a stale binary and recorded the lesson: *a run that proves nothing
   looks identical to a run that proves everything.*
4. If the Underworld ever hosts the trilogy as **plugins** rather than linking cores,
   clauses 1–3 fall away entirely and the seam gets cheaper. Prefer this if the product
   allows it.

---

## 5. Masterbox's own chain must yield to CASKET's theorem

`AUDIO_INTERCHANGE.md §5` states that nothing with output gain may follow CASKET, because
CASKET's ceiling is a theorem rather than a tuning and anything downstream voids it. That
rule was written for the trilogy chained to itself. Here it meets a chain that already
exists and already has its own modules.

Masterbox's `MasteringChain::process` runs, in order:

```
tune → restore → eq → rez → dyneq → match → aeq → hpss → mb → width → mseq → sat
     → [makeup] → limiter → outMeter → specTap → gonioTap
```

**The good news, verified by reading `Chain.h`:** the limiter is already last in the audio
path, with only metering taps after it. The design is compatible today.

**The clauses that keep it compatible:**

1. When CASKET is in the chain, **Masterbox's own `limiter` is bypassed, not merely set
   wide.** Two limiters in series is not a chain, it is an argument.
2. **`makeup` and `sat` may not run after CASKET.** Both carry gain. If the brain wants
   more loudness it raises the drive *into* the limiter, which is how CASKET is designed
   to be pushed, and why it has no output trim.
3. The metering taps (`outMeter`, `specTap`, `gonioTap`) are read-only and may stay.
   **Anything added after the limiter later must be proven read-only**, and that proof is
   the null test: with the lid above the signal, output identical to delayed input.
4. If RIGOR is in the chain, Masterbox's `mb` (its own multiband compressor) is bypassed,
   by the same argument as clause 1.

---

## 6. Latency has exactly one owner

Each trilogy core exposes `latencySamples(state, fs)` as a pure function, and the suite
treats a lying latency figure as a serious defect (`AUDIO_INTERCHANGE.md §4`). Masterbox
reports its own, including a phase-vocoder path that is not cheap.

**The rule:** the Underworld sums the trilogy's `latencySamples()` across whichever cores
are active, adds Masterbox's own reported figure for whichever of *its* modules remain
active, and **reports the total to the host once**. It compensates once, at the end. No
core compensates internally for another. Any module bypassed under §5 contributes zero,
and that zero must be real: CASKET was once found reporting latency for a bypass that did
not delay (`AUDIO_INTERCHANGE.md §7`, 2026-08-16 evening).

---

## 7. Preconditions

| Precondition | State |
|---|---|
| The substrate is total: no legal argument can hang the audio thread | **MET, 2026-08-16.** `NM.log`/`log10`/`exp` fixed with Ben's permission; verified inert over 180,450 values compared by raw 64-bit pattern. Matters here because a brain computes settings from analysis, which widens the value range the DSP sees. |
| Trilogy state files exist and load from external sources | **MET.** All three sanitise on the way in. |
| Trilogy has compiled as a plugin | **NOT MET.** Nothing in the trilogy has been through a compiler. Masterbox has built AU, VST3 and Standalone. |
| The trilogy knows Masterbox exists | **NOT MET, deliberately.** Per the Charter's enforcement note, echoing LAW 0 into `AUDIO_INTERCHANGE.md §5` crosses their boundary and needs Ben's word. |

**Sequencing recommendation.** Build the seam *after* the trilogy's first successful
compile, not before. Its first build should debug one unknown, not two. Masterbox has
already crossed that river and its build is the proof that the crossing is passable.

---

## 8. Two sessions, one folder

Both working sessions edit under `CLAUDE/`. This has already cost real work twice: a
lineage collision inside RIGOR, and files moving under `CASKET/` while another session
was mid-round.

**Write territory, until Ben says otherwise:**

| Path | Owner |
|---|---|
| `DRAWING PROGRAM/masterbox-plugin/**` | the Masterbox session |
| `AUTOPSY/`, `RIGOR/`, `CASKET/`, `shared/`, `AUDIO_INTERCHANGE.md` | the trilogy sessions |
| `UNDERWORLD_CHARTER.md` | the Masterbox session (it wrote it) |
| `UNDERWORLD_INTERCHANGE.md` (this file) | either, by append; **log the edit in §10** |
| Anything else at `CLAUDE/` root | check `mtime` before writing |

**The habit, cheap and worth it:** before writing outside your own territory, check what
has moved on disk since you started. Both collisions were visible in file timestamps
before they were visible in the code.

---

## 9. Open questions

1. **Link the cores, or host them as plugins?** §4 clauses 1–3 exist only under linking.
   Hosting is architecturally cleaner and operationally heavier. Undecided.
2. **Does the Underworld drive NECROPHONE too?** It is an instrument rather than a
   processor, so it does not belong in a mastering chain, but it shares the estate and
   the patch-pack format. Probably out of scope; worth saying so on purpose.
3. **Whose meters are authoritative in the report?** Both sides implement BS.1770. CASKET's
   is conformance-tested against EBU 3341/3342; Masterbox's is unit-tested. If they
   disagree by a tenth of a LU, the report should not silently pick one.
4. **Does the translator get its own regression baselines?** Brain output is
   deterministic given an analysis, so it could be byte-stable in the trilogy's idiom.
   That would be the strongest possible seam test, and it is not free.

---

## 10. THE LOG
*Every change to the seam. Newest first. If you edit this file, add a line.*

### 2026-08-16 (Cowork side) — §3.2 assertion 3 tightened, as the entry below asked

Accepted the refinement below and rewrote §3.2(3): the idle recipe is now stated as
lid-above-signal **+ `knee:0` + `dc:false`**, with the two measured residuals and the
reason the clause earns its length. The knee's sub-lid reach is recorded as measured
behaviour rather than judged — **whether the knee SHOULD reach below the lid is still
CASKET's question, not the seam's**, and nothing in `AUDIO_INTERCHANGE.md` or `CASKET/`
was touched. Documentation only; no code, no gate, no hash.

### 2026-08-16 (Masterbox side) — first chaining spike run; a refinement to the §3.2 null test

The seam's first code ran — a JS spike (in `underworld/`) that drives the three cores'
public API only (`createEngine`/`setState`/`process`, `CASKET.renderOffline`), chaining
their outputs. LAW 0 respected: no trilogy code touched, observation only. **The
signal/preset contract holds end-to-end.** A hot −0.716 dBTP signal through AUTOPSY →
RIGOR → CASKET(lid −1, drive +8) comes out at **exactly −1.000 dBTP** with the limiter
actively riding to the ceiling; and an idle chain is **bit-exact to 1 ULP** (2.22e-16 —
one stage's non-identity multiply, unreachable from outside).

**The finding that belongs to you, because it refines §3.2 assertion 3.** That clause says
to use an unsealed arrangement for the null test. Necessary but **not sufficient**: even
unsealed `velvet`, the idle null is broken by two always-on paths, both measured on a
0.92-peak signal 12 dB under the lid:

- **`dc:true`** (default DC blocker) — a real sub-20 Hz high-pass; its warm-up transient
  gives ~6e-2 max diff. Correct behaviour, not a bug — but not bit-exact.
- **the soft `knee`** — applies a sub-0.1 dB gain touch **independent of headroom**:
  `lid:6` and `lid:12` gave the *identical* 1.07e-2 residual, and only `knee:0` zeroed it.
  So the knee curve reaches well below the lid.

A bit-exact CASKET null therefore needs **lid-above-signal + `knee:0` + `dc:false`**, not
lid-above-signal alone. Repro: `underworld/` diagnostics. **Whether to tighten §3.2's
wording (or whether the knee's reach is intended) is your call** — I did not edit §3 or
`AUDIO_INTERCHANGE.md` (your territory, §8). Flagging it because a translator that trusts
"unsealed ⇒ null" would ship a null test that quietly never bites.

### 2026-08-16 — this document created
Written from the Cowork side after reading `UNDERWORLD_CHARTER.md`, `AUDIO_INTERCHANGE.md`,
and Masterbox's `Chain.h` / `Brain.h` / `Meters.h` directly. Deliberately covers only what
the other two do not. Three findings that came out of the reading rather than the
conversation: Masterbox's limiter is **already last** in its chain with only metering after
it, so the designs are compatible today (§5); linking trilogy headers moves them under a
different build system, where the parity law is a **build** property and can be silently
lost (§4); and the substrate hang that would have been a precondition was **already fixed**
earlier the same day, verified inert over 180,450 values (§7). Nothing was built and no
code outside this file was touched.

---

## 11. Before writing a line of Underworld code

- [ ] Read `UNDERWORLD_CHARTER.md`. LAW 0 governs; this file only says how.
- [ ] Read `AUDIO_INTERCHANGE.md` §4 and §5. The invariants and the signal contract are settled there.
- [ ] Decide §9.1 (link vs host). It changes §4 entirely.
- [ ] If linking: `-ffp-contract=off`, `shared/` by relative path, parity gates re-run **in this build**.
- [ ] Bypass Masterbox's `limiter`, `makeup`, `sat` and `mb` as §5 requires, and assert the bypass.
- [ ] Write the translator's vocabulary map as a table with reasons, not defaults.
- [ ] Three assertions from §3.2 exist and fail when broken. Prove each bites by breaking it once.
- [ ] Sum latency once, report once, compensate once.
- [ ] Add a line to §10.
