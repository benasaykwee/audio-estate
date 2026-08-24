# The Listening Log

### What CASKET sounded like, session by session

Every other record in this project is generated: the parity gate, the
assertion counts, the byte-stable hashes. This one cannot be. It is the only
evidence here that a machine did not produce, and the only kind that has ever
found a bug the harnesses could not see.

The template and the reasoning behind it live in
[`LISTENING_PROTOCOL.md`](LISTENING_PROTOCOL.md) §9. New entries go at the
top. Keep them in the repository rather than in a chat window, and write them
while the sound is still in your ears.

**A note on tone.** These entries are allowed to be uncertain. "Something
sounded off in the chorus and I could not pin it down" is a legitimate and
useful entry; a log that only records confirmed findings will quietly teach
you to stop writing down the ones you are unsure of, which are exactly the
ones worth keeping.

---

## Session 1 — 2026-08-23

**Material:** a simple vocal recording, plus a deliberate volume ramp.
**Rig:** GarageBand, Scarlett 2i2 at 44.1 kHz, on the Master Track.
**Build:** the CI build, then rebuilt locally at 15:49 and re-auditioned.
**Level-matched:** partly, and the part that was not is the story below.

### WORKED

- Records and plays clean as a Master Track insert. No crashes, no dropouts,
  no host complaints across roughly forty minutes.
- **The lid is the control that needs no explanation.** Ben's words: "SUPER
  useful and easy." It was the first thing reached for and the one that
  behaved exactly as expected on first contact.
- **The ramp test came back silent.** A volume ramp swept the material up
  through the lid and back down, engaging and releasing the limiter
  continuously, up to −6.85 dB of weight. No zipper noise, no clicks, no
  audible pumping on the vocal. That sweep is precisely where a lumpy gain
  path would announce itself.
- Arrangement files saved and reloaded through the host as `.aupreset`,
  surviving a plugin swap.
- **THE RANGE drew real music for the first time** and showed two humps, a
  quiet stretch and a loud one. It correctly pointed the ears at the loud
  section, which is the only place a limiter has a personality.
- After the rebuild: five arrangements, five distinct characters, five
  different reported latencies. "Definitely could tell a difference this
  time."

### SUSPECT → CONFIRMED BUG

- **The five arrangements were indistinguishable.** They were. The plugin's
  dropdown moved the style label and the two traits the engine derives from
  it, while the whole audible recipe stayed at Velvet's numbers — so every
  arrangement was Velvet in costume, and Lead in particular was Lead with its
  seal switched off.
- Diagnosed from the session's own screenshots (knee 4.3, release 150 ms and
  vigil 2.00 ms identical across four different arrangements, SEAL dark on
  Lead), fixed, gated, rebuilt and re-auditioned inside 42 minutes.
- What it cost is now measured rather than described, in `casket_test.js`
  under *the arrangements are not the same limiter*. Iron was hit hardest.

### LESSON

- **Unity has two lives, and nothing said so.** Told to leave Unity armed for
  an honest A/B, Ben found that drive made things quieter and the lid seemed
  stuck in the middle. Both are correct behaviour: Unity trims the output by
  the drive amount, so drive buys more limiting at a fixed loudness, and what
  you hear is the lid minus the drive. Twenty minutes went to a working
  limiter looking broken. Now §8 of the protocol, §4 of
  `MASTERING_WITH_CASKET.md`, and a line in the README.
- **A max-hold meter needs a visible way to forget.** The header's true peak
  held one figure across minutes of playing and read as frozen. The browser
  face has had a Reset Plot button since the beginning; the plugin face had no
  control at all. THE REST now exists on both.
- **Confirm you are auditioning the build you think you are.** Change the
  arrangement and watch the knobs jump. A whole session's findings were made
  against a build where they never moved.

### OPEN

- **Lead's seal cost**, hunted deliberately on headphones in a quiet passage
  (§3). The idle error is a stationary-noise-floor artifact and quiet material
  is where it has the best chance of surfacing. Failing to find it while
  actively looking is a much stronger result than not noticing it in passing.
- **The polarity-flip null test** (§2) on all four unsealed arrangements. Do
  not expect Lead to null; expect everything else to.
- Neither was skipped for lack of time so much as held back deliberately: both
  deserve fresh ears rather than the tail of a session that had already found
  its bug.
