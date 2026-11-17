# CORONER

### *determines what the body was made of*

Sixth member of the estate, and the first that listens instead of speaking.
Everything else here makes sound. This one takes sound apart, writes down what it
found, and says which instrument should take the body.

    open coroner.html · drop an audio file on the slab · read the report
    click through to NECROPHONE or PALLBEARER with a patch already waiting

---

## The three layers, and why they are separate

**1 · THE EXAMINATION** — pure measurement. Thirty-one features, no opinions.
Pitch and how steadily it is held, how the partials sit, colour, shape in time.
Emits a versioned, fixed-order feature vector and nothing else.

**2 · THE VERDICT** — an opinion about those measurements. Thin, transparent,
and deliberately replaceable. It reads only the feature object and returns
`{klass, confidence, register, evidence}`.

**3 · THE ROUTING SLIP** — where the body goes, and what patch is waiting when it
gets there. Reads the verdict and the features, writes real parameter ids for the
real instruments.

**The separation is the whole architectural argument.** When a neural classifier
arrives it replaces layer 2 and *only* layer 2: same input object, same output
shape, handed to `setVerdictEngine()`. Layer 1 becomes its training input rather
than being thrown away, and layer 3 never notices the swap. Anything that would
make layer 2 hard to replace — a verdict reaching into raw samples, a routing rule
reading a spectrum instead of a feature — is a bug, not a shortcut.

That is also why the feature registry is a registry and not a loose object: a
model needs to enumerate its own input vector, know each field's range, and fail
loudly when the version it trained on stops matching the one it is handed.

---

## The files

| file | what it is |
|---|---|
| `coroner_core.js` | the analysis · **single source of truth** · portable, no dependencies but shared NM |
| `coroner.html` | self-contained test bed · embeds NM + core verbatim · opens from a double-click |
| `coroner_sync.js` | writes that embed · `--check` for CI · also enforces LAW 3 and LAW 4 |
| `coroner_test.js` | **163 checks** against bodies whose nature is known by construction |

    node coroner_test.js        # the harness
    node coroner_sync.js        # re-embed after any core edit
    node coroner_sync.js --check

---

## What it measures

Thirty-one features. The ones that carry the verdict:

- **Pitch jitter** — short-term instability *within notes*, vibrato and drift removed
  first. The strongest synthetic tell: an oscillator holds a pitch far more
  perfectly than a hand can. Reliable to about 30 cents.
- **Inharmonicity B** — stiffness, from `f_n = n·f0·√(1+Bn²)`. Strings stretch;
  oscillators do not. Reported with its **goodness of fit**, because unison detune
  imitates stiffness convincingly and only the fit tells them apart.
- **Noise fraction** — what is left after the harmonic series is removed. Breath,
  bow and finger noise live here. Oscillators are suspiciously clean.
- **Envelope** — attack, sustain, decay rate. How the energy got in, and whether
  anything is still putting it in.
- **Note count** — how many separate held pitches were found. Every harmonic
  measurement comes from the longest of them, not from the whole file.

Pitch and stiffness are solved **together**, by least squares, because they cannot
be solved in sequence — see the long comment in the core if you want the reason.

---

## Where the body goes

| what it heard | where it goes |
|---|---|
| flat, textural, unpitched | NECROPHONE · **Dust & Ashes** |
| stiff, decaying partials | NECROPHONE · **Bone & Sinew** |
| timbre moving while pitch holds | NECROPHONE · **Chorus of Breath** |
| stable and harmonic | NECROPHONE · **The Revenant** |
| low, **and physical** | **PALLBEARER** |

**Low pitch alone does not route to PALLBEARER.** It models a physical instrument
and only that — a vibrating string with stiffness, a body, pickups. A clean
synthetic sub asks it for a sound it has no mechanism for, and NECROPHONE's
Revenant makes that sound directly. So the question at the fork is not *is it low*
but *is it physical*.

The handoff to NECROPHONE uses its own task-17 share format (`#p=` plus base64url
of a delta-from-defaults patch), so **nothing in NECROPHONE had to change** for
this to work. The link is round-tripped in the harness through the same decode
NECROPHONE performs.

---

## What this cannot do

Stated here rather than discovered later.

- **It has not met a room.** Reverb smears the attack and raises the noise floor,
  and both feed the synthetic tell directly. A dry synth in a hall may read as
  acoustic.
- **It has not met a mix bus.** Compression and limiting rewrite the envelope the
  routing slip reads.
- **A full mix is not tested at all.** Source separation would have to come first
  and has not been built.
- **Bowed against blown** rests on a small difference in stiffness and is the
  weakest confident call in the machine.
- **On real material, confidence is low.** Ten real files were measured while
  building this. The eight NECROPHONE renders — every one an oscillator by
  construction — span 0.9 to 23.4 cents of jitter; two of Ben's own recordings
  read 3.2 and 12.0. **Those ranges overlap, and no threshold here separates them
  cleanly.** Treat the synthetic call on real audio as a hint.

That last one is the case for the swap point. Boundaries this blurred are exactly
what a model trained on thousands of examples places better than a person placing
them by hand.

---

## What real audio changed

Every one of these was invisible to a harness of single held notes, and every one
was found by feeding it actual files:

- **Jitter measured the melody, not the note.** All eight renders reported 250 to
  435 cents. Nothing was unstable — it was reading the tune. Fixed by measuring
  within notes and taking a median across them.
- **Harmonic analysis averaged a whole phrase**, so partial tracking found nothing
  and B came back exactly 0.00 for everything, bells included.
- **Unison detune imitated stiffness.** An oscillator pad fitted B=3.09e-4 and got
  routed to the physical engine.
- **A vibrato smeared its own evidence**, throwing away a genuine stiffness
  measurement (fit 0.495 against 0.999 for the same body held still).
- **YIN reports a stiff string sharp** — 112 Hz for a 110 Hz body — which poisoned
  every deviation measured against it.

And three more found by **mutation testing** rather than by writing tests forwards:
a steady tone fragmenting into six notes, a jitter figure that *fell* as real
instability rose, and a glide fusing into a single note.

The harness now covers all of them. Seventeen deliberate sabotages of the core
were checked; every one is caught.

---

*Sixth of the estate. Nothing leaves the page.*
