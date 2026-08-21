# MASTERING WITH CASKET

*Nothing gets out.*

---

CASKET has more tools than explanation, and that gap is its own kind of debt.
This pays some of it. It is not a manual — the README lists what every control
does. This is about **when to reach for a thing and what it costs you**, which
is the part a control list cannot tell you.

Everything here is a measured claim. Where a number appears, the harness that
produced it is named, so you can check rather than trust. `tools/check_mastering_citations.js`
re-runs every one of those harnesses and confirms the cited number still
appears in its output, so a figure here going stale is a thing that gets
caught rather than a thing you find out about later.

**One deliberate exception, flagged so it does not read as an oversight.** A
few figures here describe **a bug that used to exist and no longer does** —
they are marked *(historical)* where they appear. Those carry no citation on
purpose: no current harness can produce them, because the behaviour they
measure was removed. They are kept because *why* a thing is built the way it
is often only makes sense next to what it replaced.

**The other three documents, and when to reach for each:**

| | |
|---|---|
| [`README.md`](README.md) | what every control *is*. Start there if a word here is unfamiliar. |
| [`docs/LISTENING_PROTOCOL.md`](docs/LISTENING_PROTOCOL.md) | how to verify by ear what the numbers here claim — level-matching, the null test, what to listen for per arrangement. |
| [`docs/CASE_FORMAT.md`](docs/CASE_FORMAT.md) | the `.casket.json` arrangement file, field by field. For scripting or hand-editing. |

---

## The one sentence

Put CASKET last, set the lid where the delivery target says, and turn the drive
up until it sounds like it is working slightly harder than you want. Then turn
it back down two decibels.

The rest of this document is that sentence with its reasons attached.

---

## 1. Where CASKET goes

**Last. Always last.** Nothing with output gain may follow it.

This is not a preference. CASKET's guarantee is a theorem: no output sample
exceeds the lid, zero epsilon, proved by construction rather than by tuning.
Anything downstream that touches level — a trim, a fader, a converter with
makeup, another limiter — invalidates the proof. It is also why CASKET has no
output trim of its own. There is nowhere to put one that would not undo the
thing the program is for.

The suite's order is **EQ → compressor → limiter**: AUTOPSY, then RIGOR, then
CASKET. Their latencies add. Sum `latencySamples()` across the chain and
compensate once at the end.

---

## 2. Choosing an arrangement

Five arrangements. They are not five flavours of the same thing; they sit at
different points on one trade — **how hard it grabs against how much it costs
you in CPU and transparency.**

| | reach for it when | it costs |
|---|---|---|
| **Pine** | you want the limiter to be a safety net and nothing else. Classical, jazz, anything where the peaks *are* the performance. | almost nothing. ×3.3 the cost of bypass. |
| **Velvet** | the default, and the right default. Most records. Fast enough to catch transients, slow enough not to pump. | ×3.7 |
| **Oak** | denser material that wants a little weight put on it. Rock, guitars, drums that are already compressed. | ×3.6 |
| **Iron** | loud, and you have decided to be loud. Electronic music, anything where the limiter is an instrument. | ×5.7 |
| **Lead** | the loudest thing here, and **the only sealed arrangement.** Read §5 before you use it. | ×7.6 |

Those ratios are measured against a same-machine bypass calibration by
`tests/casket_cpu_gate.js`. They are ratios rather than milliseconds on
purpose: your machine is not the machine they were measured on, but the
*shape* of the cost travels.

**To measure your own,** run `tests/casket_bench.js`. Its `×bypass` column is
the same unit as the table above — bypass is calibrated first, on whatever
machine you are on, and everything after is stated against it. Its
milliseconds and realtime factors are the numbers that do *not* travel; the
ratio is the one you can compare with anybody else's. The bench also reports
what oversampling actually costs (sealing adds ~1.7× at 2× lining and ~2.3×
at 16×, so the penalty for sealing grows with the lining) and what the
meter-to-editor handoff costs the audio thread — about 0.11% of a
512-sample block period, which is the sort of claim worth having a number
for rather than a reassurance.

---

## 3. The lid, and why the margin exists

The **lid** is the ceiling, in dBTP — true peak, measured through a 4×
reconstruction the way BS.1770 asks, not sample peak.

Set it to what you are delivering to:

- **−1.0 dBTP** — the usual answer. Streaming platforms recommend −1.0 and
  every lossy encoder needs headroom, because the decoded signal is not the
  signal you encoded and it can be louder.
- **−0.3 dBTP** — CD, or anything going to a lossless master with no encoder
  downstream.
- **−2.0 dBTP** — if you know the file will be transcoded more than once.

The **margin** is a second, smaller trim beneath the lid, and it exists for a
narrow reason. CASKET's guarantee is exact at the *reconstruction it computes*.
A different reconstructor — a converter, a codec, somebody else's meter — may
find a slightly higher inter-sample peak than ours did. The margin buys room
for that disagreement.

How much room? Measured, on a hard-clipped worst case
(`tests/casket_seal_margin.js`):

| material | residual above the lid at a denser reconstruction |
|---|---|
| harmonic content, loud sine pair | 0.0002 dB |
| band-limited noise at full tilt | 0.837 dB |
| hard-clipped noise, the worst case | 0.974 dB |

So on ordinary musical material the margin buys you nothing and costs you
loudness. On dense, clipped, maximally hostile material it is worth up to a
decibel. **Do not set a margin by default.** Use **Auto Margin**, which renders,
measures, adjusts and *re-renders to verify* — and reports `covered` as a
statement about a measurement rather than a prediction. It earned that
behaviour: an earlier version estimated, and claimed `covered` on a render
0.554 dB over the ceiling *(historical)*.

---

## 4. Drive, and the honest way to set it

Drive is gain into the limiter. Loudness is **monotone but not linear** in it:
past the point where limiting starts, six more decibels of drive buys far less
than six LU.

Three ways to set it, in increasing order of honesty:

1. **By ear.** Turn it up until it is working slightly harder than you want,
   then back off two decibels. This is not a joke; the point at which you
   notice a limiter is roughly the point at which a listener stops enjoying
   the record.

2. **Hit Target.** Give it a LUFS figure and it bisects, quantises to the grid
   the UI will actually use, renders once more at that exact value, and reports
   what *that* render measured plus a `reached` flag. If the target is
   unreachable it says so instead of returning its closest miss. It costs about
   **ten renders** (`casket_cpu_gate.js`), so on a long piece, go and make tea.

3. **Reference matching.** Measure a record you like, measure yours, get the
   gap and the drive that closes it. It reports rather than applies, on
   purpose — the number is advice, and matching a reference's loudness does not
   match its arrangement.

**Unity** trims the output by the drive amount so you can A/B without the
louder version winning automatically. Use it. Loudness bias is real and it is
not subtle: two decibels is enough to make a worse master sound better.

---

## 5. The seal — the one real trade in this program

Every other arrangement is **bit-transparent when idle.** Lid above the signal,
nothing happening: the output is bit-identical to the delayed input. Not
"transparent", not "−140 dB of difference" — identical, asserted in the
harness.

**Lead is sealed, and gives that up.** A sealed arrangement applies its gain in
the oversampled domain, where the modulation sidebands still fit under Nyquist
instead of folding back across it. It buys true-peak accuracy and costs exact
transparency: an idle sealed arrangement differs from its input by up to
**−76.8 dBFS**. Inaudible. Not zero. And zero is what the null test means.

What the seal actually buys, measured (`tests/casket_seal_margin.js`):

| material | seal buys you |
|---|---|
| harmonic content | **nothing at all** |
| band-limited noise | 0.20 dB of true-peak accuracy |
| hard-clipped noise | 0.53 dB |

So: **the seal and the margin are two answers to one question.** The seal is
worth most exactly where the margin costs most. On harmonic material you are
paying the null test for no return whatsoever. On dense clipped material it
halves the residual and is the better deal.

It also costs 64 samples of extra latency, reported to the host up front.

---

## 6. Vigil, release and hold

**Vigil** is lookahead, in milliseconds. Longer means the limiter sees a
transient coming and can duck into it gently rather than clamping it. Longer
also means more latency and a softer, less punchy result.

- **0.5–1 ms** — transient-forward. Drums keep their attack; the limiter is
  more audible.
- **2 ms** — the default, and right most of the time.
- **5–10 ms** — smooth and invisible on sustained material. Kills snare attack.

**Release** is how quickly the gain comes back. **Program Release** (`autoRel`)
adapts it to the material and is on by default in most arrangements; it is
almost always better than a fixed number, and the exception is when you want
the pumping as an effect.

**Hold** keeps the reduction in place before release begins. Useful on material
with fast repeated transients where the release would otherwise be re-triggered
into a flutter.

A property worth knowing: **the threshold tightens instantly and loosens
smoothly.** Automating the ceiling downward snaps; upward glides. That
asymmetry is not a nicety — before it existed, sweeping the ceiling down
exceeded it by +2.37 dB for a dozen control blocks *(historical)*, because the
gain computer was still working to the old, higher threshold.

---

## 7. Lining (oversampling)

How many times the gain path runs above base rate. 1×, 2×, 4×, 8×, 16×.

**4× is the default and is almost always enough.** The reconstruction ladder in
`tests/casket_conformance.js` measures the same hard-clipped square at 4×, 8×
and 16× and reads 1.9143 → 1.9600 → 1.9730 dB: steps of 0.046 then 0.013. It is
genuinely settling, which means 4× is already close and 16× buys you a
hundredth of a decibel for **three times the CPU** (×10.7 versus ×3.7).

Go to 16× when you are mastering something pathological and you have the time.
Go to 1× when you are tracking and want the latency down. Latency does **not**
depend on the lining — 4× and 16× report the same figure.

---

## 8. Mid/side

A **pre-stage**, never a limiter mode, and the distinction is the whole design.

Independent M and S gains do not bound L = M+S, so a limiter with genuine
mid/side modes cannot make CASKET's guarantee. Putting the M/S trim *before*
the limiter means the limiter still runs last and the ceiling proof carries
over verbatim.

Use it to widen or narrow, gently. It short-circuits completely at unity, so
arming it with nothing dialled in cannot cost you a bit — the null test does
not quietly depend on a checkbox.

---

## 9. Dust (dither)

Only when you are **reducing bit depth on the way out**. 24-bit deliverable:
leave it off. 16-bit CD master: turn it on.

- **Flat TPDF** — correct, boring, always safe.
- **Shaped** — pushes the noise where the ear cares less. Quieter where it
  matters, louder in absolute terms. Measured: 16-bit shaped sits at −144.4 dB
  in the band that counts against −96.2 dB for flat 24-bit
  (`tests/casket_dither.js`).

The dithered output is clamped to **the largest quantisation step at or below
the true lid** — on the grid — so the guarantee holds by construction and not
by budget. This matters because the first version budgeted for it and was
wrong: the shaped shaper's own error feedback needed 6 LSB of trim, not 2, and
12 of the first 400 fuzz states exceeded the lid by 0.005 dB *(historical)*.

---

## 10. Mastering a record rather than a track

**Album mode finds ONE drive for the whole record.** Not one per track.

Normalising each song to the same LUFS makes every song equally loud, which is
the same as saying the quiet song is no longer the quiet song. The running
order carries meaning. On the test record the spread was 13.82 LU before
mastering and 13.99 LU after (`tests/casket_album.js`) — preserved, not
flattened.

The album's own figure is the **gated measure across every track concatenated**,
which is what BS.1770 asks for and what streaming services compute. It is *not*
the mean of the per-track figures. On the test record the correct album figure
is −6.51 LUFS while the arithmetic mean of the three tracks is −10.56
(`tests/casket_album.js`). Four LU is the size of that mistake, and it happens
because LUFS is a logarithm.

Two options worth knowing:

- **Gapless.** For a record whose tracks run into each other — live, a mix, a
  concept record with crossfades. Renders the whole thing through one engine
  and cuts it back up, so the limiter's state crosses every join the way the
  music does. Rendered a track at a time instead, the release envelope
  restarts at every join; measured, the difference reaches **−19.4 dB**
  (`tests/casket_album.js`) and is concentrated at the *start* of each track,
  which is exactly where you would hear it.

- **Dither seeding.** `perTrack` by default, because a track is a file and a
  file should carry its own noise. `same` stamps the identical noise print on
  every track. **Gapless forces `continuous`** and overrides whatever you
  asked for — restarting the noise generator at a join you just went to
  trouble to make seamless puts the seam back in the one layer nobody thinks
  to check.

`albumReport()` writes the per-track table out as plain text you can hand to a
client. Plain text on purpose: it has to survive email, a print-out, a delivery
portal and being pasted into a message, and still be readable in five years by
somebody who does not have this program.

---

## 11. Rates

If the file's rate is not the session's rate, **conform it first.**

This is not fussiness. Every figure CASKET reports is derived from `fs`:
K-weighting is designed at fs, the vigil is milliseconds converted at fs, the
true-peak reconstruction oversamples fs. Metering a 44.1 kHz buffer as though
it were 96 kHz reports the loudness of a file played at 2.18× speed. Measured,
that is **2.59 LU of error** on a −23 LUFS tone (`tests/casket_rate.js`) — and
it is a silent error, because nothing about the audio looks wrong.

`conformToRate()` does the conversion and hands back a sentence saying what it
did. Read the sentence.

---

## 12. Loudness range, and THE RANGE

**Loudness range (LRA) is how far the loud parts sit above the quiet parts**,
in LU, over the whole piece. It is the number in the readout marked `range`,
and it is the one figure here that describes the *music* rather than the
limiter.

Where the other meters answer "how loud is this", LRA answers "how much does
that change". A record with LRA 3 is flat — every moment about as loud as every
other. LRA 12 has real quiet passages and real loud ones. Neither number is
good or bad on its own; what it tells you is whether the drive setting you just
chose is flattening something that was doing work.

**Watch it while you turn the drive up.** That is the whole practical use. If
LRA barely moves as you drive, the limiter is catching peaks and leaving the
shape alone. If it collapses, you are not making the record louder, you are
making it *smaller* — and that is a decision, not an accident, so make it
deliberately.

### What the number actually is

Per **EBU Tech 3342**, and worth knowing because it explains the chart:

- It is computed from **short-term (3 s)** loudness, not the 400 ms blocks
  integrated loudness uses. Different window, different answer. CASKET keeps
  two separate histograms for exactly this reason; sharing one would be quietly
  wrong.
- Blocks below **−70 LUFS** are dropped outright, then a **relative gate 20 LU**
  below the mean of what survived drops the rest. Note **20**, where integrated
  loudness uses 10 — LRA is the more forgiving of the two about quiet material.
- What is left is sorted, and LRA is the spread between the **10th and 95th
  percentiles**. Not the min and max: a single loud stab or one silent bar
  cannot define your record's range.

Measured against the spec's own construction: two levels 10 LU apart read
**10.0000 LU**, two levels 5 LU apart read **5.0000 LU**
(`tests/casket_conformance.js`).

### THE RANGE — the chart under the number

The third pane shows the distribution that produces that figure. It exists
because a single number cannot tell you *why* it is what it is.

- **Bars** are how much of the session sat at each loudness.
- **Two gold lines** are the 10th and 95th percentiles. The gap between them
  is the LRA figure — not an illustration of it, the actual thing being
  subtracted.
- **The red dashed line** is the relative gate. Bars to its left were measured
  and are drawn, but excluded from the number. They are shown rather than
  hidden on purpose: if a lot of your material sits left of that line, the
  reported range is describing a smaller piece of the record than you might
  assume, and you should know that.

A tall narrow pile means a consistent record. A wide spread means a dynamic
one. Two separate humps usually means two kinds of material — verses and
choruses, or a quiet intro — which is worth seeing before you decide the
limiter is doing something wrong.

### One thing it is not

The album report's **spread** line is a different measurement. That is the gap
between the loudest and quietest *track* on a record (§10). LRA is the range
*within* whatever is being measured. A record of eleven equally-loud but
internally dynamic songs has a small spread and a large LRA; the reverse is
also possible. `matchReference` reports both, and the gap in each, because
matching one does not match the other.

---

## 13. A working order

1. Load the mix. Conform the rate if it needs it.
2. Set the lid to the delivery target. Leave the margin at 0.
3. Pick an arrangement. Velvet unless you have a reason.
4. Bring the drive up by ear until it is working slightly too hard, then back
   off two decibels.
5. A/B with **Unity** on, so the louder one does not win by being louder.
6. Run **Auto Margin**. If it asks for more than a couple of tenths, your
   material is dense enough that Lead is worth trying.
7. If it is a record, run album mode and read the spread line in the report.
8. Dust only if the bit depth is dropping.
9. Look at the true-peak figure one last time. It is the number the outside
   world will check you on.

---

## 14. What CASKET will not do

- It will not put a gain stage after itself, so do not ask.
- It will not tell you a target was reached when it was not.
- It will not report a latency it does not have, in any state, **including
  bypass** — bypass is latency-compensated, so toggling it does not move the
  audio.
- It will not average LUFS figures.
- It will not let a sample past the lid. That one is a theorem.

---

*Every figure in this document was measured by a named harness in
`CASKET/tests/`. If one of them is wrong, the harness will say so before you
do.*
