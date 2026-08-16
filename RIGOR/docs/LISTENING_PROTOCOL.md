# RIGOR — listening protocol

**For:** the one hour where you actually sit down with it.
**Purpose:** so that hour is an hour of comparing, not an hour of setting up.

Open `rigor.html`. No build step. Every test below is reachable from the factory case list and the keyboard.

---

## Before anything: prove it is doing nothing

Set **Ratio 1:1**. The output should be *bit-identical* to the input — not "sounds the same", identical. This is asserted in the harness, but hearing an unchanged signal first calibrates your ears for everything after.

Then press **D** for delta. It should be **silent**. Not quiet — silent. If a compressor's delta is anything but silence when it is idle, the signal path is doing damage it should not be.

---

## Read this before you A/B anything

**Every A/B you ran with lookahead switched on, before 16 August 2026, was invalid.** Not subtly — the bypassed signal came out up to **480 samples early** at `look = 10 ms`, because `latencySamples()` reported the lookahead in every state and the bypass path did not delay. A host compensating by the reported figure moved the audio 10 ms earlier the instant you pressed bypass. That is enough to comb against a parallel path and far more than enough to read as a tone change. Leaving bypass also dropped `look` milliseconds of digital silence into the track, every time.

Both are fixed and both are now asserted at five lookahead settings. **If you formed an opinion about how RIGOR "sounds" by bypassing it with lookahead on, that opinion was measuring a timing error. It is worth forming again.**

**And bypass now has a second setting worth knowing about.** At 2 or more bands, "bypass" used to still run your audio through the crossover — magnitude-flat to 0.06 dB, but not the dry signal, and carrying the crossover's phase response. There are now two honest answers and you choose:

| `bypassSplit` | Bypass gives you | Use it to ask |
|---|---|---|
| **off** (default) | the dry signal, bit-identical | "what is this plugin doing to my track?" |
| **on** | split and re-summed, uncompressed | "what is the *compression* doing?" — the crossover is on both sides, so it cancels out of the comparison |

For general listening leave it off. Turn it on when you are judging multiband compression specifically and do not want the crossover's phase in the comparison.

---

## 1. Do the styles actually differ? *(20 minutes, and the question I cannot answer)*

Load **Vocal — Settling**, press play, then cycle **1 · 2 · 3 · 4**.

**This section changed, and the change matters.** An earlier version of this document told you not to bother comparing Fresh and Spasm, because measurement had shown they were the *same signal path* — identical topology, differing only in defaults. That was true when it was written. It is no longer true: Spasm now has its own peak-follower decay, 2 ms against Fresh's 15, so it tracks transients far more tightly. **All four are now genuinely different paths.** Compare all four.

| Press | Style | Path | What to listen for |
|---|---|---|---|
| **1** | Fresh | feedforward · peak 15 ms | the reference. Transparent, does what the numbers say |
| **2** | Settling | **feedback** · RMS 10 ms · level-smoothed | leans in, forgiving, grabs harder the louder it gets |
| **3** | Spasm | feedforward · **peak 2 ms** | should now *snap*. The fast follower is the whole point |
| **4** | Repose | feedforward · RMS 50 ms | slower to arrive, because its detector fills first |

**Two questions, and both need ears:**

**Does Settling feel like an optical compressor, or does it just feel slow?** If it feels like a slow Fresh rather than a different animal, the level-dependent attack is not pulling its weight and should be made stronger.

**Is Spasm's 2 ms follower right, or is it now too twitchy?** This is a change made on my judgement, without hearing it. 2 ms was chosen because it is roughly where a peak follower stops smoothing and starts tracking, but the honest answer is that I picked a plausible number. If Spasm now sounds nervous or grainy on drums, the figure is too low; if it still sounds like a fast Fresh, it is too high. **This is the single most useful thing you could tell me about this round.**

---

## 2. Delta — the fastest way to hear what a setting does *(10 minutes)*

Any case, press **D**.

You are now hearing *only what the compressor removed*. Sweep the threshold while listening to it. This teaches a compressor faster than any meter: you hear the exact moment it starts working, and on what.

Worth trying specifically on **Drum Bus — Spasm**. If the delta sounds like the whole drum kit, the attack is too fast. If it sounds like only the transient tips, it is doing what a punch compressor should.

---

## 3. Multiband *(15 minutes)*

Load **Tame the Low End** (2 bands) and **Multiband Glue** (3 bands).

Set the band count selector, then **mute** and **solo** individual bands from the band strips. Soloing tells you what each band actually contains — which is usually not where you thought the crossover was.

**The check that matters:** with all bands at 1:1, the sum should sound *unchanged*. The crossover is proven flat to 0.0007 dB on paper; your ears are checking that "flat magnitude, moved phase" is actually inaudible on real material, which is a different question.

---

## 4. True-peak detection *(5 minutes)*

Load **Inter-Sample Catcher**. Toggle **True peak** on and off while playing something bright and loud — a cymbal, a limited master, anything with content near Nyquist.

On material whose peaks fall between samples, the ordinary detector reads *nothing* while the true-peak one reads several dB. Measured: 0.000 dB against −2.46 on a synthetic worst case. The question is whether real material ever gets there. Bring a mastered file and find out.

---

## 5. Tempo sync *(5 minutes)*

Load **Synced Pump**. Set the release-sync selector to 1/4, then 1/8, then 1 bar, against something at a steady tempo.

The release should breathe *with* the track rather than near it. If 1/4 at 120 bpm feels wrong, the divisions may be off by a factor of two — they are divisions of a **bar**, not of a beat, and that is a defensible-but-arguable choice worth confirming by ear.

---

## 6. The A/B trap *(5 minutes)*

Set up two cases you think are different. Flip **A** and **B**.

Now press **A=B level** — play A, press it, play B, press it. It measures both with LUFS and puts the offset into B's makeup.

Compare again. **Most of what you preferred the first time was probably loudness.** This is the single most useful button for judging a compressor honestly, and it is worth confirming it actually does what it claims.

---

## What to write down

Only three things, and only if they are true:

1. **Does Settling feel like a different animal, or a slow Fresh?**
2. **Is Spasm's 2 ms peak follower right?** Too twitchy, too tame, or about right. I chose the number without hearing it, so this is the one where my judgement is most exposed.
3. **Anything that sounds broken** — a click, a pump that arrives late, a band that disappears. Those are bugs, and I would rather have a vague "the low band felt odd around 200 Hz" than nothing.

Everything else — parameter ranges, defaults, which factory cases are useful — can wait. Those are opinions. The three above are the questions where measurement has run out and only ears are left.

*(Question 2 used to read "should Spasm get its own detector time constant?" It now has one. If a document tells you to evaluate something that has already been decided, it is out of date and you should say so.)*
