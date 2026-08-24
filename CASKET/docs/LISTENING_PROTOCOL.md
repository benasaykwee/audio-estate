# Listening to CASKET

### A protocol for verifying, by ear, what the numbers already claim

`MASTERING_WITH_CASKET.md` measures everything it can. This document is for
the part it can't: whether a measured −76.8 dBFS idle error is actually
inaudible *on your monitors, in your room, to your ears* — not in the
abstract, but tonight, on this mix. A number is not a substitute for
listening. It is something to listen *against*.

Every check below is designed so you can find out you were wrong. That is
the point. A listening test that can only confirm what you already believe
is not a test.

**Related:** [`../README.md`](../README.md) for what each control does ·
[`../MASTERING_WITH_CASKET.md`](../MASTERING_WITH_CASKET.md) for the measured
claims this document asks you to check · [`CASE_FORMAT.md`](CASE_FORMAT.md) for
the arrangement file, if you want to script the A/B rather than click it.

---

## 1. Before anything else: match the level

**This is the one rule that breaks every other rule if you skip it.**
`MASTERING_WITH_CASKET.md` §4 says it plainly: two decibels is enough to
make a worse master sound better. Every comparison below — arrangement
against arrangement, CASKET against no limiter, CASKET against a different
plugin — is worthless until both sides play back at the same perceived
loudness.

**Use Unity.** It exists for exactly this. Drive the signal, then trim the
output by the drive amount, and the A/B stops being a contest the loud one
always wins. If you are comparing against something outside CASKET, match
LUFS by ear-and-meter both: get the integrated loudness within 0.3 LU
before you trust anything else you hear.

If you only take one thing from this document, take this: **if you didn't
level-match, you didn't run a listening test. You ran a loudness test and
mistook it for one.**

---

## 2. The null test, done at home

The bit-exact guarantee — "identical to the delayed input, lid above the
signal" — is asserted in the harness. You can also just check it yourself,
which is worth doing once, so the claim stops being something you were told
and becomes something you know.

1. Render the same passage twice: once through CASKET with the lid well
   above the material (so nothing limits), once bypassed entirely.
2. Line them up sample-for-sample. CASKET's latency is reported exactly
   (`OS_Q + vigil + 1` samples) — use it, don't eyeball the alignment.
3. Invert the polarity of one and sum both to a single file.
4. Listen to the sum at a loud, careful level. Silence, or something so far
   below the material that it takes real effort to hear, confirms the null
   test. Anything else means either the alignment is off by a sample (check
   this first — it is the far more likely explanation) or something is
   genuinely wrong, and the harness should hear about it.

Do this once per arrangement that claims bit-transparency — that's every
arrangement except **Lead**, which trades it away on purpose (§5). Do not
expect Lead to null. Expect it to null on **everything else**, and be
suspicious of yourself, not the software, if it doesn't.

---

## 3. What to listen for, arrangement by arrangement

Audition each arrangement on the material `MASTERING_WITH_CASKET.md` §2
says it's for — a limiter's flaws mostly hide on the wrong program material
and only show up on the right one.

- **Pine**, on a quiet acoustic passage with real dynamic peaks. Listen for
  the peaks staying peaks. If a transient sounds rounded off or thickened,
  something is catching material Pine is supposed to leave alone.
- **Velvet**, on a full mix with normal drum transients. Listen through a
  loud section for **pumping** — an audible breathing where the gain
  visibly rides with the kick or snare. Some is inherent to any limiter
  working hard; the question is whether it sits under the music or on top
  of it.
- **Oak**, on already-compressed material — the doc's own example is rock
  with compressed drums. Listen for whether it's adding weight or just
  adding fatigue. Those can sound similar for the first ten seconds and
  different for the whole rest of the song.
- **Iron**, pushed hard enough that it's meant to be heard. The question
  here isn't "is it transparent" — it isn't supposed to be — it's whether
  it's doing the *kind* of work you asked for, or just getting loud in a
  way that could be any limiter.
- **Lead**, specifically on dense, hot, clipped-adjacent material — the
  case it exists for. This is the one arrangement where you should actively
  try to hear the seal's cost, not just its benefit. Listen on headphones,
  quiet passage first (the −76.8 dBFS idle error is a stationary-noise-floor
  kind of artifact, and quiet material is where a noise floor has the best
  chance of surfacing) — if you can't find it there, on purpose, looking
  for it, that is a much stronger confirmation than not noticing it in
  passing.

### Let THE RANGE tell you where to listen

The loudness-distribution pane is a map of the material you're auditioning,
and it's most useful *before* you start rather than after.

- **Two humps** means two kinds of material — quiet verses and loud choruses,
  or an intro that behaves differently. Audition both, not just whichever
  one you happened to scrub to. A limiter can be transparent on one and
  audible on the other.
- **Everything piled left of the gate line** means most of the record is
  quiet enough to be excluded from the reported range. That's the case where
  the `range` number is describing a smaller slice of the music than you'd
  assume from glancing at it.
- **Watch it move as you drive.** If the distribution narrows sharply, you're
  compressing the shape of the record, not just catching its peaks — and
  §1's level-matched A/B is the only honest way to decide whether you like
  the result. That's a judgment call the chart can inform but not make.

The chart is a diagnostic, not a verdict. It tells you where to point your
ears; §6's rule about which to trust when they disagree still applies.

---

## 4. Translate before you trust it

A decision made on one system is a guess about every other system. Before
calling a master finished:

- **Full-range monitors**, the primary judgment. This is where transient
  and pumping decisions belong.
- **Headphones**, closed-back if you have them. Stereo image and sibilance
  problems that hide in a treated room show up here first.
- **One deliberately bad speaker** — a laptop speaker, a phone, a cheap
  Bluetooth speaker. Not to make decisions on, but to confirm the mix
  survives being heard badly, which is how most people will actually hear
  it.
- **The car, if you have one.** Different bass response than anywhere else
  you own, and a uniquely unforgiving loudness environment.

If the limiter's presence changes character noticeably between systems —
more than the mix itself does — that's worth chasing down before it's
worth blaming on the room.

---

## 5. Session hygiene

Ears fatigue. High-frequency sensitivity in particular drops over a long
session, and a tired ear reaches for more top end and more loudness to feel
like it's hearing the same thing it heard an hour ago — which is exactly
the bias §4 already warned about, arriving from a different direction.

- **Calibrate your monitoring level and leave it alone.** Loudness bias
  doesn't stop being a bias just because you're the one riding the volume
  knob instead of the plugin.
- **Take breaks before you think you need one.** By the time fatigue is
  obvious, judgment has already been drifting for a while.
- **Keep a reference track loaded** — something you know well, ideally
  something you didn't master. Return to it periodically as a check on
  whether *your ears* have moved, not just the mix.
- **Make the A/B blind when the decision matters.** Have someone else flip
  between two options without telling you which is which, or build a
  simple switcher and don't look at it. Knowing which one is "yours" is
  enough to bias the result, even for someone who knows better.

---

## 6. When your ears and the meter disagree

This will happen. Two honest cases, and they call for different responses:

**You hear something the meter says isn't there.** Check the signal chain
before you doubt the measurement — a monitoring path has more gain stages
than the render path CASKET measured, and any one of them can be adding
something CASKET never touched. Reflow the null test in §2 on the exact
file you're listening to, not a similar one. If the null test still comes
back clean and you still hear something, that is worth writing down and
worth someone else's ears — but the harness's bit-exact assertion is a
stronger claim than one listening pass at the end of a long session, and
the honest first move is to suspect the chain, not the guarantee.

**The meter says something is wrong and you don't hear it.** Trust the
meter. This one is asymmetric on purpose. True-peak overs, a broken null
test, a limiter that's stopped limiting — these are exactly the class of
problem that is real, consequential (a decoder downstream will find the
overshoot even if you didn't), and least likely to be audible in the room
where the mistake was made. "I don't hear a problem" was never the bar;
it's the reason the meter exists.

---

## 7. What this document is not

Not a substitute for the harness. Not a claim that measurement is
optional. Not a suggestion that "if it sounds fine, ship it" — CASKET's
whole design is that a claim gets checked rather than trusted, and your
ears are one more instrument making a measurement, with their own
calibration drift and their own failure modes, not a higher court that
overrules the other ones.

The point of listening is the same as the point of the null test, the
parity gate, and every harness in `tests/`: not to feel confident, but to
find out — in a way that could have come back the other way — whether the
thing that's supposed to be true, is.

Nothing gets out. That includes past your own ears, if you actually check.

---

## 8. Before you start: two things the first session learned the hard way

Both of these cost real time on 2026-08-23, and both take ten seconds to
avoid.

**Unity is a judging tool, not a loudness tool.** With it on, the output is
trimmed by exactly the drive you added, so turning the drive up buys *more
limiting at the same loudness* — the sound gets quieter, and the lid appears
to do almost nothing because what you hear is the lid minus the drive. That
is correct behaviour and it reads exactly like a broken plugin. **Unity on
to compare, Unity off to commit.** Every A/B below assumes on; every
judgment about how loud a master should be assumes off.

**Confirm you are auditioning the build you think you are.** After any
rebuild, open the plugin and change the arrangement. The knobs should
visibly jump — the vigil, the release and the knee all move, and Lead lights
its own seal. If they sit still, the host has loaded an older component and
everything you are about to hear is about the wrong software. This check
exists because a whole session's findings were once made against a build
where the arrangements never changed anything.

---

## 9. Keep a session log

A listening session produces the only evidence in this project that no
harness can generate, and it evaporates the moment you close the laptop.
Write it down while the sound is still in your ears, in the repository
rather than in a chat window, using roughly this shape:

```
### Session N — date · material · monitoring path
Level-matched?   yes/no        Rate:  44.1 / 48 kHz
Build:           commit or "rebuilt <time>"

WORKED     — what behaved, stated plainly enough to be wrong
SUSPECT    — what sounded off, with the arrangement and the passage
LESSON     — what you now understand that the documents did not say
OPEN       — what you meant to check and did not
```

The four headings are not decoration. **WORKED** is what stops a session
being only a bug hunt. **SUSPECT** must name the arrangement and the
passage, because "something sounded odd" cannot be reproduced by anyone,
including you, next week. **LESSON** is the one that pays: two of the
three findings from the first session were documentation failures, not
software failures, and they would have been invisible to any test ever
written. **OPEN** is how a protocol item survives being skipped.

**Entries live in [`LISTENING_LOG.md`](LISTENING_LOG.md), beside this
document** — the template stays here with the reasoning, the sessions
themselves go there, newest first. Session 1 (2026-08-23) is written up in
full and is worth reading before session 2, because two of its three findings
were documentation failures rather than software ones, and its two OPEN items
are the first things to do next: **Lead's seal cost on headphones**, and the
**null test on the four unsealed arrangements**.
