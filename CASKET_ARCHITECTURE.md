# CASKET — Architecture Sketch
### A true-peak brickwall limiter (Pro-L lineage) · browser instrument + JUCE plugin
*"Nothing gets out."*

**Status:** Phases 1, 2, 2½ built; the seal landed — v0.1 · 2026-08-15
**Suite contract:** [`AUDIO_INTERCHANGE.md`](AUDIO_INTERCHANGE.md) — read before touching `shared/`.
**Pattern:** follows AUTOPSY exactly — single-source DSP core, verbatim embed, C++ parity port, byte-stable regression, `-ffp-contract=off`.
**Siblings:** [`AUTOPSY_ARCHITECTURE.md`](AUTOPSY_ARCHITECTURE.md) (EQ, built) · [`RIGOR_ARCHITECTURE.md`](RIGOR_ARCHITECTURE.md) (compressor, scoped).

---

## 1. Identity

AUTOPSY opens the body. RIGOR is the body stiffening. CASKET is the box it goes in, and the lid coming down.

The metaphor is unusually load-bearing here, because a brickwall limiter *is* a box: a hard ceiling that the signal is not permitted to exceed, no matter what you feed it. Everything else in the design is about making the lid close without a sound.

| Thing | CASKET calls it |
|---|---|
| Ceiling | **the lid** |
| Scrolling level display | **the viewing** |
| Gain-reduction trace | **the weight** — how hard the lid is pressing |
| Loudness meters (LUFS / true peak) | **the plot** |
| Oversampling factor | **the lining** — how many layers seal the box |
| Lookahead | **the vigil** — the watch kept before the burial |
| Dither | **the dust** — ashes to ashes |
| Saved preset (`.casket.json`) | **the arrangement** |
| A/B compare | **Arrangement A / Arrangement B** |
| The five algorithms | Pine · Velvet · Oak · Iron · Lead |

Palette inherits from AUTOPSY: black slab, gold instruments, jewel-toned traces. The weight is the one bright element — it hangs down from the lid in arterial red, and the whole point of a good limiter is that you watch it move and hear nothing.

## 2. Why this one is different from the other two

AUTOPSY and RIGOR both dodged the same problem, deliberately, and wrote it down at the time: **oversampling**. RIGOR's doc says it outright — *"aliasing is a problem for processes with hard corners… the limiter will need it, and that's the right project to solve it in."*

This is that project. It is also the reason the limiter is worth building even out of order: everything hard about CASKET is hard in a way that neither of the other two touches.

Three problems, none of which an EQ or a compressor has:

1. **Inter-sample peaks.** A digital signal that never exceeds 0 dBFS at its sample points can still exceed it *between* them, by a surprising amount — 3 dB is not unusual on dense masters. A limiter that only watches the samples will happily hand a converter or a lossy encoder something it cannot reproduce. Doing this properly means reconstructing the continuous waveform, which means oversampling.
2. **The guarantee.** A compressor that overshoots its target by half a decibel is a compressor with character. A limiter that overshoots its ceiling is broken. This asymmetry drives the whole architecture, and §5 is a proof rather than a description.
3. **Loudness measurement.** CASKET is the last thing in the chain, so it is where LUFS lives — ITU-R BS.1770-4 K-weighting, gated integrated loudness, true-peak. This is standards work with external, checkable answers, which makes it the most testable code in the trilogy.

## 3. What's in, what's out

**In for v1:** five limiting algorithms; oversampled true-peak detection at 1×–16×; the lookahead/sliding-minimum/triangular-smoothing gain path; program-dependent release; channel linking; unity-gain auditioning; drive and soft saturation; ITU-R BS.1770-4 loudness metering (momentary, short-term, gated integrated, true peak); TPDF dither with noise shaping; DC filter; the viewing and the plot.

**Out for v1, with reasons:**

- **Mid/side operation.** Cut *during* the build, which is the honest place to record it, and still outstanding. Limiting M and S with independent gains does not bound L = M + S: two signals each sitting under the ceiling can reconstruct to twice it. The only safe version links the two gains at 100 %, which is arithmetically identical to ordinary linked stereo and therefore pointless. A mode that breaks "nothing gets out" is worse than no mode. Phase 3 can have it properly — detector watching L/R, gain acting on M/S.
- **Multiband limiting.** A different instrument wearing the same hat. If we want it, it belongs downstream of RIGOR's crossover work, not here.
- **Loudness Range (LRA) and the EBU histogram.** Genuinely useful, genuinely a Phase 3 evening. Integrated LUFS is the number people actually act on.
- **Surround / >2 channels.** BS.1770 defines the channel weights (+1.5 dB on surrounds) and the core is written channel-agnostically enough to grow into it, but the browser instrument is stereo and so is the plugin for now.
- **Linear-phase or spectral limiting.** Out of lineage. Pro-L doesn't do it either.

## 4. Repository layout

```
CLAUDE/
  shared/
    necromath.js  necromath.h     ← NM: portable transcendentals (existing)
    necrodyn.js                   ← ND: the dynamics DNA (NEW — RIGOR inherits this)
  AUTOPSY/                        ← untouched by this project. On purpose.
  CASKET/
    casket_core.js                ← single source of truth: ALL DSP
    casket.html                   ← browser instrument (NM + ND + core embedded verbatim)
    casket_sync.js                ← maintains THREE verbatim embeds, order-enforced
    casket-juce/                  ← Phase 2
    tests/
      casket_test.js              ← the guarantee, the null test, BS.1770 calibration
      casket_ui_test.js           ← headless UIH helpers
      casket_regression.js        ← FNV-1a byte-stable render baselines
      casket_regression_baseline.json
    docs/
```

### The shared dynamics module, and why it exists now

You chose "limiter now, RIGOR after," which makes CASKET the *first* consumer of the dynamics primitives rather than the second. That's the good version of this ordering: the shared code gets written against a real, demanding client and RIGOR inherits something already proven, instead of CASKET being retrofitted onto whatever the compressor happened to need.

`shared/necrodyn.js` holds the pieces both instruments require — the dB/linear conversions, the one-pole coefficient formula, the soft-knee gain computer, the `d/(d+K)` program-dependence shape, the sliding minimum, the boxcar, and the delay line. It closes over NM the same way the cores do.

**One deliberate duplication.** AUTOPSY's Park–Miller test-signal generator (`makeNoise`) stays exactly where it is. Moving it would mean editing `autopsy_core.js`, and AUTOPSY was already a sealed artifact when this was decided, with five byte-stable hashes and 5,176 bit-exact parity checks at the time. (That figure is deliberately *not* generated — it records the state of the thing at the moment of the decision, and rewriting it to today's total would invent a justification nobody acted on.) The canonical copy now lives in ND; AUTOPSY keeps its own; and `casket_test.js` asserts the two produce identical output for identical seeds. Six lines duplicated with a test holding them together is cheaper than re-blessing a green suite.

## 5. The gain path — and the proof that it cannot overshoot

This is the heart of the project, so it gets stated as a theorem rather than a description.

### 5.1 The chain

```
                         ┌──────────────────────────────────┐
   x[n] ──▶ drive ──▶ DC ┤                                  │
                         │  (a) upsample ×M  ──▶  x_M        │
                         │  (b) peak, per oversampled sample │
                         │  (c) required gain, dB, ≤ 0       │
                         │  (d) release envelope             │
                         │  (e) sliding MINIMUM over vigil   │
                         │  (f) boxcar ∘ boxcar (triangle)   │
                         │  (g) channel link                 │
                         │  (h) decimate by min-of-M         │
                         └───────────────┬──────────────────┘
                                         │  g[n]  (base rate)
   x[n] ──▶ delay(vigil + filter) ───────╳──▶ lid trim ──▶ dust ──▶ out
```

The audio path never leaves the base sample rate. Only the *detector* is oversampled, and only the *gain signal* crosses back.

### 5.2 Why the audio stays at base rate

The obvious way to build a true-peak limiter is to oversample the whole audio path, limit up there, and filter back down. It's the way most descriptions do it. We don't, for four reasons, one of which is decisive:

1. **The null test survives.** With the audio path untouched, a signal that never asks for gain reduction comes out **bit-identical** to the delayed input — not "transparent," not "−140 dB of difference," identical. That assertion is the single most valuable line in AUTOPSY's suite and it is worth a great deal more here, where CASKET sits last in the chain and touches every master. An up/down conversion, however good, destroys it forever.
2. **No coloration when idle.** Follows from 1, but worth saying separately: a mastering limiter should be a piece of glass until it works.
3. **The decimation filter would reintroduce overshoot.** An FIR lowpass has Gibbs ripple; feeding it a signal clamped exactly at the ceiling produces output slightly above the ceiling. Oversampling the audio path trades one overshoot problem for another.
4. **Cost.** Base-rate audio at 16× detection is far cheaper than 16× everything.

The thing we give up: gain-modulation sidebands are created at base rate rather than at M×. That would matter if the gain signal were fast and sharp-cornered. §5.4 is precisely the argument that it is neither.

### 5.3 The theorem

Let `r[n]` be the instantaneous gain (linear, ≤ 1) required at sample `n` to keep the signal under the lid. Let `L` be the vigil length in samples.

- **Sliding minimum:** `m[n] = min{ r[k] : k ∈ [n, n+L] }`
- **Smoothing:** `g[n] = Σ_j w[j] · m[n−j]`, where `w` is non-negative, sums to 1, and is supported on `j ∈ [0, L]`.

**Claim:** `g[n] ≤ r[n]` for every `n`. Always. For any input.

**Proof:** take any `j ∈ [0, L]`. Then `m[n−j] = min{ r[k] : k ∈ [n−j, n−j+L] }`, and since `0 ≤ j ≤ L`, the index `n` lies inside that window. So `m[n−j] ≤ r[n]`. Therefore `g[n]` is a convex combination of quantities each `≤ r[n]`, and a convex combination cannot exceed its largest term. ∎

That is the entire design justification. The gain reduction is *always* at least as much as required, never less — so there is no overshoot, no ringing above the lid, no "attack too slow for this transient." The limiter cannot be fooled by program material, because the bound doesn't depend on the program material.

The cost of the guarantee is that gain reduction begins *before* the peak arrives (that's what the vigil is for) and is slightly deeper than strictly necessary in the neighbourhood of a transient. That over-reduction is exactly what people mean when they call a lookahead limiter "clean."

### 5.4 The smoother

`w` is a **triangle**: two cascaded boxcar (moving-average) filters, each of length `L/2`. Convolving two rectangles gives a Bartlett window — non-negative, unit sum, support `L−1 ≤ L`. All three hypotheses of the theorem hold, so the guarantee is not an approximation.

Two consequences worth naming:

- **The gain signal is C¹.** A single boxcar gives a gain trajectory with corners, and corners in a gain signal are a distortion mechanism. Two gives continuous slope. This is the difference between a limiter that sounds "grabby" and one that doesn't, and it costs one extra running sum.
- **The gain is slow by construction.** Its spectrum is a `sinc²` whose first null is at `2·fs/L`. At the shortest vigil we allow (0.1 ms, `L ≈ 5` at 48 k) that is still a decade below Nyquist; at typical settings it's three. This is the answer to §5.2's one giveaway: base-rate gain modulation produces sidebands that are, by construction, adjacent to the carrier rather than folded across Nyquist.

Both boxcars run as running sums (`sum += new − old`), so the cost is O(1) per sample regardless of vigil length. Running sums accumulate rounding, so the harness asserts that after 60 s of full-scale noise the incremental sum still matches a freshly computed one to 1 × 10⁻⁹. (It matters for correctness, not for parity — both language implementations accumulate in the same order and therefore drift identically.)

The sliding minimum is a **monotonic deque**: amortised O(1), exactly reproducible, no floating-point arithmetic at all — it only compares and copies. The harness checks it against brute force on random data, bit-for-bit.

### 5.5 Release

The sliding minimum handles attack perfectly and says nothing about release. Release is applied to `r[n]` *before* the minimum, as an envelope that follows downward instantly and recovers upward at the release rate:

```
env = min(r, env·c + (1−c)·1)          c = ND.onePole(release_ms, fs)
```

Since `env ≤ r` pointwise, the theorem's hypothesis is untouched — the guarantee is preserved for free.

**Program-dependent release** uses the shape RIGOR specified and AUTOPSY already ships: two release constants, fast and slow (×8), blended by their own disagreement.

```
d = |env_fast − env_slow|   in dB
w = d / (d + 3)
env = w·env_fast + (1−w)·env_slow
```

Transients make the two diverge and the fast one wins; sustained material lets them converge and the slow one takes over. It's the third appearance of `x/(x+k)` in this codebase, which is a good sign — it means we found a shape rather than a hack.

## 6. Oversampling — the lining

### 6.1 The filter

An `M`th-band (Nyquist-`M`) FIR, windowed sinc, cutoff exactly at `fs/2M`:

```
L = 2·M·q + 1  taps,  c = M·q  (the centre),  q = 16
h[k] = M · sinc((k − c)/M) · blackmanHarris(k, L)
```

Two properties come out of that construction for free, and both are worth having:

- **Every `M`th tap is zero** except the centre, because `sinc(integer) = 0`. So polyphase branch 0 is a *pure delay*: the oversampled sequence contains the original sample values exactly, unfiltered, with the interpolated values sitting between them. True-peak detection is then literally "the maximum of the real samples and the reconstructed ones."
- **Latency is `q` base-rate samples, exactly, at every oversampling factor.** Because `c = M·q` upsampled samples is `q` base-rate samples. Switching the lining from 4× to 16× does not change the plugin's reported latency by one sample — which means changing it mid-session doesn't shift your session's timing, and the parity tables don't need a separate latency case per factor.

The window is 4-term Blackman–Harris (≈ −92 dB sidelobes), computed from `NM.cos` — chosen over the more usual Kaiser specifically because Kaiser needs a modified Bessel function, which would mean adding `I₀` to necromath and re-proving a new transcendental for the parity gate. Blackman–Harris needs only cosines, which are already proven. Same job, no new surface.

### 6.2 What the build actually proved, including the part I got wrong

Two claims here, and they are not equally strong. Both were measured rather than assumed, and one of them corrected the design note this section originally carried.

**The sample-domain guarantee is absolute.** No output sample exceeds the lid. Ever, for any input, at zero epsilon — five arrangements × five hostile signals × 48 000 samples, asserted with no tolerance at all. That is §5.3 doing its job.

There is one implementation detail behind the word "zero". The theorem holds in exact arithmetic; `10^(g/20)` and the multiply that follows round. So the very last thing in the signal path is a **clamp at the lid**, and the harness watches how much work it does. Across the whole hostile battery the largest excess it ever caught was 7 × 10⁻¹³ *relative* — i.e. the last bit or two of a double. It is not a clipper and it never acts as one; it is the thing that turns "under the lid to within floating point" into "under the lid", and its size is the theorem's empirical receipt. If the design were wrong, that counter would be doing real work and the test would say so.

**The true-peak guarantee is not absolute, and the reason is not where I first put it.** I originally wrote that the residual would be "bounded by the reconstruction residual of the lining" — that more oversampling would buy a tighter true peak. Measurement says otherwise:

| material | input dBTP | residual at 4× | at 16× |
|---|---|---|---|
| harmonic / musical | 0.00 | +0.011 dB | **+0.000 dB** |
| band-limited clipped | +1.95 | +0.522 dB | +0.555 dB |
| full-band clipped noise | +7.93 | +1.194 dB | +1.194 dB |

4× and 16× agree to three decimals on the hard case. The lining is **detection** — it decides how well we *see* inter-sample peaks — and we already see them perfectly well at 4×. The residual comes from somewhere else entirely: **the gain is applied at base rate.** The product of a time-varying gain and a signal has energy above Nyquist; sampling that product folds the excess back; the reconstruction a converter performs is therefore not `g(t)·x(t)`. When the gain moves slowly relative to Nyquist this costs literally nothing — the harmonic row lands *on* the lid to three decimal places. When the material demands a gain that lurches (full-scale, full-band, square-edged, 20 dB of reduction with structure at every sample) the folded energy shows up as overshoot.

So the knob that governs the residual is the **vigil**, not the lining, because the vigil is what limits how fast the gain is allowed to move:

| vigil | 0.5 ms | 1 ms | 2 ms | 5 ms | 10 ms | 20 ms |
|---|---|---|---|---|---|---|
| residual | +1.200 | +1.195 | +1.194 | +1.170 | +1.097 | +1.011 |

Monotone, and real, and nowhere near enough on its own. Which is worth saying plainly: on genuinely pathological material CASKET v0.1 misses a true-peak ceiling by about a decibel, and a longer vigil recovers a fifth of that.

**The proposed fix, and why it is not in the build.** See §6.3 — it was built, measured, and reverted.

The tool that does work today is `margin`: a fixed trim below the stated lid, 0 dB by default and −0.3 dB in Lead. Combined with the default lid of −1.0 dBTP, the delivered signal stays under 0 dBFS on any real programme material.

### 6.3 The seal: a negative result, kept

This section originally proposed a fix and called it Phase 2's first task. I built it. It does not work, and the reason is interesting enough to keep rather than quietly delete. The rig is committed as `tests/seal_experiment.js` so the conclusion can be re-checked instead of believed.

The idea was to apply the gain in the oversampled domain, but as a **residual**, so the bit-exact null test would survive:

```
RESIDUAL   y[p] = x[p − D] + decimate( (g4 − 1)·x4 )
```

When `g4 ≡ 1` the correction is exactly zero, so the output is the delayed input to the last bit. That part worked perfectly on the first try — the null test held, and the latency derivation (`2q + Lb + 1`) landed the impulse on the predicted sample with no fudging. And then the true-peak residual on band-limited clipped noise went from **+0.52 dB to +2.47 dB**, and on full-band clipped noise from **+1.19 dB to +5.84 dB**. The rounding clamp, which had never caught more than 7 × 10⁻¹³, was suddenly absorbing 120 %.

**Why.** The residual form is a difference of two large, nearly-cancelling terms, and it is worst exactly where it needs to be best. Under 13 dB of gain reduction, `g ≈ 0.22`, so the correction `(g − 1)·x4` is **78 % of the signal**. Every scrap of decimation-filter error inside that correction arrives at the output undivided, with no small factor in front of it. The harder the limiter works, the worse the conditioning gets.

Two things confirmed it was conditioning and not a bug. First, a sanity case: with the lid raised out of reach the residual path reproduces the input's true peak exactly (7.9317 vs 7.9317), so the rig is sound. Second, sharpening the decimator barely helps — 129 taps gives +12.5 dB, and quadrupling to 1025 taps only reaches +8.3 dB. A filter-quality problem would collapse under that; a conditioning problem does not.

My first version made it worse still by reusing the engine's `M`th-band interpolator as the decimator. That filter is −6 dB *at* Nyquist by construction — that is precisely what forces `h[kM] = 0` and buys us branch-0-as-pure-delay — which makes it a fine interpolator and a poor decimator. A decimator wants its cutoff below Nyquist with a real transition band. Worth writing down: **the two jobs want different filters, and the property that makes ours good at one disqualifies it from the other.**

**What does work** is the obvious thing the residual form was invented to avoid:

```
FULL       y[p] = decimate( g4·x4 )
```

| material | shipped (base-rate) | residual form | full oversampled |
|---|---|---|---|
| harmonic / musical | +0.011 | +0.011 | +0.011 |
| band-limited clip | +0.522 | +3.378 | **+0.333** |
| full-band clip | +1.194 | +10.298 | **+0.568** |

Roughly half the residual, on the two cases that have any. The price is permanent: when idle, the output is `decimate(upsample(x))`, which is *not* `x` — for full-band content the round-trip error reaches 0.196 in linear terms, about −14 dB. The bit-exact null test doesn't get weaker, it ceases to exist.

### 6.4 The resolution: both, switchable

Ben's call, and the right one: **build both and let the arrangement choose.** `seal` is now the third structural axis, alongside `smoothFrac` and `relShape`. Four arrangements keep the base-rate path and its bit-exact null test; **Lead** is sealed, which is what a lead-lined casket ought to mean.

The sealed path is the **full** form, `y = decimate(g4·x4)` — not the residual scheme §6.3 buried. What it buys, measured at 4× with +12 dB of drive against a −1 dBTP lid:

| material | unsealed | sealed | |
|---|---|---|---|
| harmonic / musical | +0.011 | +0.011 | nothing to buy — both already land on the lid |
| band-limited clip | +0.522 | **+0.318** | −0.204 dB |
| full-band clip | +1.194 | **+0.507** | −0.687 dB |

**What it costs, stated in numbers.** The up/down conversion is no longer an identity, so the bit-exact null test is gone for Lead specifically. The response is flat to 18 kHz (0.000 dB), −0.04 at 20 k, −1.06 at 22 k, −8.2 at 23 k: **the entire price lives in the top 2 kHz.** Idle error on musical content measures **−125 dB** relative to signal — inaudible by any standard. On white noise it measures −14 dB, and that number needs its context rather than a flinch: a quarter of white noise's energy sits above 18 kHz, so it is a fact about white noise, not about the filter.

Three implementation notes worth keeping:

- **The decimator is a different filter from the interpolator, and reusing one for the other is exactly the mistake §6.3 records.** The Mth-band interpolator is −6 dB *at* Nyquist by construction — precisely what forces `h[kM] = 0` and buys branch-0-as-pure-delay. That makes it excellent at reconstruction and poor at decimation. The decimator is a separate design: cutoff at 0.96 of base Nyquist with a real transition band, `half = DEC_Q · M` so its group delay is a whole `DEC_Q` base samples at every lining. **Sealed latency is therefore still independent of the lining**, exactly as unsealed latency is.
- **Sealed at 1× is a contradiction, and the sanitiser corrects it rather than obeying it.** There is no oversampled domain to form the product in, so the sidebands alias exactly as they would unsealed *and* the decimator lowpasses the result. Measured: +7.2 dB of overshoot with the safety clamp absorbing 62 % — that is clipping, not limiting. `sanitizeState` bumps a sealed 1× to 2×, so the engine and `latencySamples` can never disagree.
- **Sealed, the safety clamp stops being purely a rounding backstop.** It also absorbs the decimation filter's ripple. Measured across the whole hostile battery it fires **twice in 96,000 samples**, only on a full-scale 19 kHz sine, by 0.088 dB. The harness asserts that bound explicitly rather than reusing the unsealed `< 1e-12` claim, because reusing it would have been a lie.

More lining is very slightly *worse* sealed (2× +0.447, 4× +0.507, 16× +0.562) — a longer filter has a sharper transition, so it preserves more of the product energy sitting just under Nyquist. Lead therefore defaults to **4×**, not 16×: in sealed mode the lining is the processing rate as well as the detection rate, and detection was already exact at 4×.

Both paths are held to the same standard. Three sealed regression baselines (`sealed2x`, `sealed4x`, `sealedDust`) and four sealed render cases in the parity gate, which stood at **18,753 bit-exact checks** when the seal landed and at **<!--c:casket.parity-->22,861<!--/c-->** as of <!--c:measured-->2026-08-16<!--/c-->.

## 7. The five arrangements

Not presets. Five sets of structural choices, and each one changes what the code does.

| | **Pine** | **Velvet** | **Oak** | **Iron** | **Lead** |
|---|---|---|---|---|---|
| Character | plain box, most neutral | lined, forgiving | punchy, transient-forward | loud and dense | sealed, mastering-safe |
| Pro-L analogue | Transparent | Allround | Punchy | Aggressive | Safe |
| Vigil default | 3 ms | 2 ms | 1 ms | 1.5 ms | 5 ms |
| Smoothing window | full vigil | full vigil | **⅜ vigil** | ⅝ vigil | full vigil |
| Release | linear, user | **program-dependent** | fast, program-dependent | fast, user | slow, program-dependent |
| Knee (dB) | 0 (hard) | 3 | 0 | 1.5 | 6 |
| Saturation | none | none | none | **soft-clip pre-stage** | none |
| Lining default | 4× | 4× | 4× | 8× | **16×** |
| Margin | 0 | 0 | 0 | 0 | **−0.3 dB** |

The one that needs explaining is **Oak**. Its smoothing window is deliberately *shorter* than its sliding-minimum window. The theorem still holds — the hypothesis is that `w` is supported within `[0, L]`, and a shorter support is still within it — so Oak cannot overshoot either. What a short smoother does is let the gain drop faster and more abruptly right at the transient, which preserves the leading edge of a drum hit at the cost of a slightly harder gain corner. That's the trade "punchy" actually names.

**Iron**'s saturation is a C¹ soft clip applied *before* the limiter, so the limiter has less work to do and the density comes from harmonics rather than from gain reduction:

```
|x| ≤ t     →  x
|x| > t     →  sign(x) · (t + (1−t)·tanh((|x|−t)/(1−t)))
```

with `t = 1 − drive·0.6`. It is continuous and its derivative is continuous at `|x| = t` (both sides give slope 1), which the harness checks to 1e-9 — a soft clipper with a kink is just a clipper with extra steps.

## 8. Loudness — the plot

ITU-R BS.1770-4, implemented to the letter, because it has an external right answer and that makes it worth doing exactly.

**K-weighting** is two biquads: a high-shelf "head" stage and an RLB high-pass. The spec tabulates coefficients for 48 kHz only, so CASKET derives them at any rate from the analog prototype the way libebur128 does — `f₀ = 1681.974450955533`, `G = 3.999843853973347`, `Q = 0.7071752369554196` for the shelf; `f₀ = 38.13547087602444`, `Q = 0.5003270373238773` for the high-pass — bilinear-transformed with `K = tan(π f₀ / fs)`. At 48 kHz this reproduces the spec's published coefficients to the last digit, which is assertion #1 in the loudness section of the harness.

**Loudness** of a block is

```
LKFS = −0.691 + 10·log₁₀( Σ_ch G_ch · z_ch )
```

where `z` is the mean square of the K-weighted channel and `G = 1` for L and R. The `−0.691` offset is not arbitrary and it's a good sanity anchor: it exists so that a 1 kHz sine reads back its own dBFS value, because K-weighting has about +0.691 dB of gain at 1 kHz. So the calibration test is exact and external: **a 1 kHz sine at −23 dBFS peak in both channels must read −23.0 LUFS**, and the harness asserts it to ±0.05.

- **Momentary** — 400 ms window, ungated.
- **Short-term** — 3 s window, ungated.
- **Integrated** — 400 ms blocks at 75 % overlap; absolute gate at −70 LUFS; then a relative gate at 10 LU below the mean of the surviving blocks; mean of what's left. Both gates, in that order, or the number is not integrated loudness.

**True peak** is measured on the *output*, through the same oversampler the detector uses, so the number on screen is the number the limiter enforced rather than an independent estimate that might disagree with it.

## 9. The dust

Dither belongs here because CASKET is the last thing before the file.

- **Off** — bit-identical passthrough. Non-negotiable; it's part of the null test.
- **Flat** — TPDF, generated as the difference of two independent uniform draws, scaled to 2 LSB peak-to-peak. TPDF rather than rectangular because TPDF is the one that actually decorrelates the error *and* eliminates noise modulation; rectangular does neither properly.
- **Shaped** — TPDF plus 2nd-order error-feedback noise shaping, pushing the noise floor up out of the ear's sensitive band. Roughly 5 dB of perceived improvement for the same bit depth.

Bit depth 16 / 20 / 24. The PRNG is Park–Miller from `necrodyn`, seeded per instance, so **dithered output is fully deterministic** and can sit in the byte-stable regression suite like everything else. A dither you can't reproduce is a dither you can't test.

Two details worth recording because both are parity landmines. Rounding is `floor(x + 0.5)`, never `Math.round` — JS and C++ disagree on `round`'s tie behaviour for negative values and `floor` does not. And when the dust is armed the gain computer aims **two LSB below** the stated lid, because TPDF can add up to one LSB and quantisation another half: it is the only way "nothing gets out" survives the last stage, and it costs 0.0005 dB at 16 bits.

*(One unrelated trap found while testing the soft clipper, filed here because it applies to every future consumer of the shared library: `NM.exp` scales by repeated doubling, so a large argument does not merely overflow — it spins for billions of iterations first. Never hand it an unbounded input. `ND.softClip` now short-circuits at `tanh(20)`, which differs from 1 by 8 × 10⁻¹⁸ and is therefore exact at double precision, not an approximation.)*

## 10. Parameters

Eighteen host parameters, as built. AUTOPSY needed 146; RIGOR wants 22; a limiter is a knob and a promise.

`bypass` · `style` (5) · `drive` −12…+24 dB · `lid` (ceiling) −20…0 dBTP · `margin` −1…0 dB · `knee` 0…12 dB · `vigil` 0.1…20 ms (0.35 skew) · `release` 1…1000 ms (0.35 skew) · `auto_rel` · `hold` 0…500 ms · `link` 0…100 % · `lining` 1/2/4/8/16× · `sat` 0…100 % · `dc` on/off · `unity` · `dust` off/flat/shaped · `dust_bits` 16/20/24 · `target_lufs` −30…−5 (display only)

Three that were in the sketch and are not in the build: `stereo_mode` (see §3), `sc_listen` (a limiter has no sidechain to listen to), and `out_trim`. That last one was cut on purpose — an output gain applied *after* the limiter can push the signal back over the lid, which would make the plugin's central claim conditional on a knob position. If you want it quieter, that is what `lid` is.

`dust_seed` exists in the saved arrangement but is not a host parameter; it is there so a dithered render is reproducible and can sit in the byte-stable regression suite like everything else.

**`unity` deserves a note.** Louder always sounds better, which makes A/B-ing a limiter against itself nearly useless. With `unity` armed, the output is trimmed by exactly the drive amount, so switching bypass on and off compares *the same loudness*, and you hear what the limiter did rather than how much louder it got. It is clamped to only ever attenuate, so it cannot become an `out_trim` by the back door. This is a listening-honesty feature and it is the one I'd argue hardest for keeping.

## 11. Interface

**The viewing** — a scrolling right-to-left history. Input level in cold grey, output in jewel tone, and the weight hanging down from the lid line in arterial red. The lid is a horizontal rule you can drag vertically to set the ceiling directly. Time axis 4 s.

**The plot** — LUFS momentary / short-term / integrated as bars against a target line, true peak with a hold-and-latch readout (red once it has ever been exceeded, and it stays red until you reset it, because a peak that flashed by for one sample still happened), and a GR meter with peak-hold.

Both canvases render from pure functions in the core, so browser and plugin draw from identical math — the `magnitudeAt` discipline from AUTOPSY, applied here to the meter reducers. Both get the AUTOPSY treatment: eco-pause when the tab is hidden, `prefers-reduced-motion` respected, full keyboard access, and a mirrored panel of real form controls so nothing lives only on canvas.

## 12. Tests

Same standard as the others: green or it didn't happen. **103 core · 68 UI · 10 regression baselines · 11,164 parity checks**, all green, sync idempotent.

**`casket_test.js`** — the ones that carry weight:

- **The null test.** Lid above the signal → output **bit-identical** to the delayed input, for all five arrangements. Not near. Identical.
- **The guarantee, empirically.** Every arrangement against square waves, impulse trains, clipped noise, DC steps and a 19 kHz sine: `max|out| ≤ lid` at **zero epsilon**, plus the clamp-work assertion from §6.2 that proves the zero is earned rather than enforced.
- **The theorem itself**, on synthetic gain data, independent of the engine: 20 000 samples of sparse deep dips through sliding-min ∘ triangle, worst excess 1.4 × 10⁻¹³ dB — which is the boxcar's running-sum rounding and nothing else.
- **True-peak residual.** Independent 16× reconstruction with a longer filter than the live meter, swept across material classes and vigils. This test **reports** as well as asserts; the tables in §6.2 are its output. (Its own trap is documented in the code: a buffer that begins mid-signal presents the reconstructor with a step from silence, and the ringing on that step reads as ~1 dB of phantom overshoot. That artefact cost an hour and is now a named parameter.)
- **Latency exactness.** Reported latency equals measured impulse position, exactly, at all five linings × three vigils — and 4× and 16× report the *same* latency, which is the assertion that proves the `M`th-band construction did what §6.1 claims.
- **BS.1770 calibration.** 48 kHz K-weighting coefficients match the published table to 1e-12; 1 kHz at −23 dBFS reads −23.0 LUFS; 10 dB quieter reads exactly 10 LU quieter; 20 s of silence after 20 s of tone does not move the integrated number.
- **Sliding minimum vs. brute force**, bit-exact, over 3 000 samples.
- **`M`th-band property**: `h[c ± nM] == 0` *exactly* for `n ≠ 0` at every lining, and reconstruction accurate to 2 × 10⁻⁵ from 100 Hz to 19 kHz.
- **Soft-clip and knee C¹ continuity**, both junctions, plus the boundedness case that caught a real hang (see §9's note on `NM.exp`).
- **Dither determinism**: same seed → identical bits; different seed → different bits; output lands exactly on the bit grid; the lid still holds with 16-bit shaped dust armed.
- **`ND.makeNoise` is bit-identical to `AUTOPSY.makeNoise`** — the assertion that holds the one deliberate duplication together.
- **`reset()` returns a byte-identical engine.** This one earned its keep: it caught the constructor consuming the snap-on-first-state flag, which made "new engine, set state, render" ramp its parameters in from the defaults while "reset, render" did not.

**`casket_regression.js`** — FNV-1a over `%.17g`, stride 7, against clipped-noise sources. Ten baselines: `idle` · `pine` · `velvet` · `oak` · `iron` · `lead` · `lining16` · `linked0` · `dusted` · `saturated`.

**`casket_ui_test.js`** — UIH helpers headless; all four script blocks parse; embed order enforced (`nm-src` → `nd-src` → `core-src`); each embed byte-identical to its source file; and **the boot path**: the three embeds compiled in the page's order, with `module` and `require` shadowed to `undefined` the way a browser and a worklet provide them, must render bit-identically to the core required from disk.

**`core_parity.cpp`** — the JS↔C++ gate, **11,164 checks, bit-exact on the first compile**: oversampler taps and phase sums at all five linings, K-weighting at four sample rates, 603 gain-computer points across three knee widths, `transferAt` per arrangement, and stride-13 rendered audio plus meter readings for ten cases (all five arrangements, 1× and 16× lining, unlinked, dithered, saturated).

The prediction in this section was correct and is now measured rather than asserted. Compiling the identical file **without `-ffp-contract=off` produces 8,351 mismatches out of 11,164, the worst at 9,805 ulp** — and the first ones to go are the oversampler taps, exactly as expected: a 129-tap FIR is a long multiply-accumulate chain and GCC fuses it given the chance. With the flag, parity holds at `-O0`, `-O2` and `-O3` alike. It is not belt-and-braces; it is the gate.

The other two warnings held: NM is still mandatory for every transcendental, and nothing new was needed beyond `necrodyn.h`.

## 13. Phases

**Phase 1 — the browser instrument.** ✅ *This sitting.* `shared/necrodyn.js`, `casket_core.js`, `casket.html`, all three harnesses, ten byte-stable baselines, six factory arrangements. It makes sound and the suite is green.

**Phase 2 — the C++ twin.** ✅ *Done.* `necrodyn.h`, `CasketCore.h`, parity emit and gate, the JUCE scaffold, CI. (The seal was to have gone first; §6.3 records why it did not go at all.)

**Phase 2½ — usable now.** ✅ Offline render in the browser: drop a file, render it through CASKET at full quality with no real-time deadline, and get back a latency-compensated 24-bit WAV plus a before/after true-peak / sample-peak / LUFS report with the lid marked under or over. This exists because nothing is compiled to an AU yet, and bouncing is the bridge.

**Phase 3 — the trimmings.** LRA and the EBU histogram, mid/side done safely (detector on L/R, gain on M/S), arrangement sharing by URL, the bespoke plugin face.

**Then:** RIGOR, which now inherits `necrodyn` already proven against a harder client than it would have been.

---

## 14. Open questions for Ben

1. **Does the lid default to −1.0 dBTP or 0.0?** −1.0 is what streaming platforms and every mastering engineer will tell you to use; 0.0 is what the number on the box says. I've defaulted to −1.0 and I think that's right, but it means CASKET ships not doing the thing its name implies.
2. **Should `unity` be on by default?** It makes the plugin sound quieter than the competition on first insert, which is commercially insane and pedagogically correct.
3. **Five arrangements or three?** Pine, Velvet, and Lead cover the real ground; Oak and Iron are character. Pro-L ships eight and most people use two.
4. **Does CASKET get a spectrum analyzer behind the viewing?** Same question I asked for RIGOR, same answer either way — costs an evening, and Pro-L doesn't have one.
5. **~~The one real decision left: bit-exact null test, or half a decibel of true peak?~~** **ANSWERED 2026-08-15: both, switchable.** See §6.4. `seal` is a per-arrangement flag; Lead is sealed, the other four keep bit-exactness. The trade is now something you choose per master rather than something the plugin decided for you.
6. **Should the sealed path get its own arrangement rather than riding on Lead?** Right now sealing is a checkbox that any arrangement can tick, and Lead simply defaults it on. A dedicated sixth arrangement would be clearer to a newcomer and one more thing to maintain.

## 15. What is waiting on you

- **The listen test.** Slab Noise, then walk through Pine → Velvet → Oak → Iron → Lead with `unity` armed so the comparison is honest. Iron at 70 % saturation against Pine at the same drive is the demo that shows what an arrangement actually *is*.
- **A real master through the offline render.** Drop a track you know, press Render to WAV, and read the before/after table. Everything above was proven against synthetic material; the tables say musical content lands exactly on the lid, and a track you know well is the test that actually matters.
- **Push to GitHub.** Still the single biggest unlock in the whole estate. CI is written and will now run the JS harnesses, the parity gate at three optimisation levels, an AUTOPSY-is-undisturbed tripwire, and a macOS AU/VST3 build.
