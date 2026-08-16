# MASTERING WITH CASKET

*Nothing gets out.*

---

CASKET has more tools than explanation, and that gap is its own kind of debt.
This pays some of it. It is not a manual — the README lists what every control
does. This is about **when to reach for a thing and what it costs you**, which
is the part a control list cannot tell you.

Everything here is a measured claim. Where a number appears, the harness that
produced it is named, so you can check rather than trust.

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
0.554 dB over the ceiling.

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

What the seal actually buys, measured:

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
exceeded it by +2.37 dB for a dozen control blocks, because the gain computer
was still working to the old, higher threshold.

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
12 of the first 400 fuzz states exceeded the lid by 0.005 dB.

---

## 10. Mastering a record rather than a track

**Album mode finds ONE drive for the whole record.** Not one per track.

Normalising each song to the same LUFS makes every song equally loud, which is
the same as saying the quiet song is no longer the quiet song. The running
order carries meaning. On the test record the spread was 13.82 LU before
mastering and 13.99 LU after — preserved, not flattened.

The album's own figure is the **gated measure across every track concatenated**,
which is what BS.1770 asks for and what streaming services compute. It is *not*
the mean of the per-track figures. On the test record the correct album figure
is −6.51 LUFS while the arithmetic mean of the three tracks is −10.56. Four LU
is the size of that mistake, and it happens because LUFS is a logarithm.

Two options worth knowing:

- **Gapless.** For a record whose tracks run into each other — live, a mix, a
  concept record with crossfades. Renders the whole thing through one engine
  and cuts it back up, so the limiter's state crosses every join the way the
  music does. Rendered a track at a time instead, the release envelope
  restarts at every join; measured, the difference reaches **−19.4 dB** and is
  concentrated at the *start* of each track, which is exactly where you would
  hear it.

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

## 12. A working order

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

## 13. What CASKET will not do

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
