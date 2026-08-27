/* ============================================================
   CASKET — DSP core (single source of truth)
   "nothing gets out."
   v0.1 · Phase 1 · 2026-08-15
   Embedded VERBATIM into casket.html by casket_sync.js and ported to
   C++ in CasketCore.h (Phase 2).
   DEPENDS ON: shared/necromath.js (NM), shared/necrodyn.js (ND) —
   both injected as IIFE args.
   RULES: doubles everywhere · no host APIs · deterministic ·
   never a literal closing script tag, even in comments.
   ============================================================ */
var CASKET = (function (NM, ND) {
  'use strict';

  var VERSION = '0.1';
  var CTRL = 32;          // control-rate block (samples)
  var SMOOTH = 0.25;      // per-control-block one-pole factor
  var SNAP = 1e-9;
  var OS_Q = 16;          // oversampler taps per side per phase -> latency = 16 base samples
  var METER_OS = 4;       // BS.1770-4 true-peak minimum
  /* THE SEAL's decimator. half = DEC_Q * M, so its group delay is DEC_Q
     BASE samples at every lining, exactly as the upsampler's is OS_Q.
     0.96 is the cutoff as a fraction of base Nyquist — 23.04 kHz at 48 k.
     Content above that is attenuated, and that rolloff is the honest
     price of the sealed path (see the architecture doc §6.3). */
  var DEC_Q = 64;
  var DEC_CUT = 0.96;

  var STYLES = ['pine', 'velvet', 'oak', 'iron', 'lead'];
  var LININGS = [1, 2, 4, 8, 16];
  var DUSTS = ['off', 'flat', 'shaped'];
  var DUST_BITS = [16, 20, 24];
  /* MID/SIDE, and why it is a PRE-STAGE rather than a limiter mode.
     Limiting M and S with independent GAINS does not bound L = M+S: two
     signals each under the ceiling can reconstruct to twice it. That is
     why there is no M/S limiting mode and never will be.
     What is safe — and genuinely useful — is M/S *shaping* that happens
     BEFORE the limiter. The limiter then runs last on L/R exactly as it
     always did, on whatever signal arrives, so §5's proof carries over
     verbatim instead of needing to be re-derived. This is the same
     reasoning AUDIO_INTERCHANGE.md §5 gives for why the limiter must be
     last in any chain: it is the only stage that guarantees a ceiling,
     so nothing may follow it — but anything may precede it. */

  /* ---------- the five arrangements ----------
     Two axes are STRUCTURAL — they change the code path and no knob
     exposes them:
       smoothFrac : the triangular smoother's span as a fraction of the
                    vigil. Shorter = the gain corner at a transient is
                    harder, which is what "punchy" actually names.
                    The overshoot theorem survives any value <= 1
                    because its hypothesis is "support within [0, L]".
       relShape   : 0 = exponential toward unity (classic),
                    1 = linear in dB at 20 dB per release time (even,
                    mastering-style recovery).
     Everything under `d` is a DEFAULT written into the state when the
     arrangement is chosen, and freely overridable afterwards. */
  /* `seal` — the third structural axis, and the only one that changes
     what CASKET GUARANTEES rather than how it sounds.
       false : the gain is applied at base rate. Output is BIT-IDENTICAL
               to the delayed input when idle; the true-peak residual is
               up to ~1 dB on full-band non-musical material.
       true  : the gain is applied in the oversampled domain and the
               result is properly decimated. Roughly halves the residual;
               ends bit-exactness permanently, because idle output becomes
               decimate(upsample(x)), which is not x.
     Note this is the FULL oversampled path, NOT the residual-correction
     scheme once sketched in §6.2 — that version was built, measured and
     reverted for being ill-conditioned exactly where it was needed.
     tests/seal_experiment.js is the evidence and §6.3 the write-up. */
  var STYLE = {
    pine:   { smoothFrac: 1.0,   relShape: 1,
              d: { vigil: 3.0, release: 200, knee: 0,   lining: 4,  margin: 0,    autoRel: false, sat: 0,  seal: false } },
    velvet: { smoothFrac: 1.0,   relShape: 0,
              d: { vigil: 2.0, release: 150, knee: 3,   lining: 4,  margin: 0,    autoRel: true,  sat: 0,  seal: false } },
    oak:    { smoothFrac: 0.375, relShape: 0,
              d: { vigil: 1.0, release: 60,  knee: 0,   lining: 4,  margin: 0,    autoRel: true,  sat: 0,  seal: false } },
    iron:   { smoothFrac: 0.625, relShape: 0,
              d: { vigil: 1.5, release: 40,  knee: 1.5, lining: 8,  margin: 0,    autoRel: false, sat: 60, seal: false } },
    /* Lead is the sealed casket, and now literally so: it is the one
       arrangement that trades the bit-exact null test for tighter
       inter-sample control. 4x lining, because in sealed mode the lining
       is the PROCESSING rate as well as the detection rate and detection
       is already exact at 4x — see the doc §6.3. */
    lead:   { smoothFrac: 1.0,   relShape: 1,
              d: { vigil: 5.0, release: 400, knee: 6,   lining: 4,  margin: -0.3, autoRel: true,  sat: 0,  seal: true } }
  };
  function styleDefaults(name) {
    var s = STYLE[name] || STYLE.pine;
    var d = s.d, o = {};
    for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) o[k] = d[k];
    return o;
  }

  var clamp = ND.clamp;

  /* ---------- state ---------- */
  function defaultState() {
    var d = styleDefaults('velvet');
    return {
      version: 1,
      bypass: false,
      style: 'velvet',
      drive: 0,          // dB into the limiter
      lid: -1.0,         // dBTP ceiling
      margin: d.margin,  // dB, <= 0, trimmed off the lid
      vigil: d.vigil,    // ms lookahead
      release: d.release,
      autoRel: d.autoRel,
      knee: d.knee,      // dB
      hold: 0,           // ms
      link: 100,         // % channel linking
      lining: d.lining,  // oversampling factor
      seal: d.seal,      // gain applied in the oversampled domain (doc §6.3)
      sat: d.sat,        // % pre-limiter soft clip
      ms: false,         // mid/side shaping PRE-STAGE (never a limiter mode)
      msMid: 0,          // dB trim on the mid
      msSide: 0,         // dB trim on the side — i.e. stereo width
      dc: true,
      unity: false,      // trim output by the drive amount for honest A/B
      dust: 'off',
      dustBits: 16,
      dustSeed: 1848,
      targetLufs: -14,
      meta: { name: 'Fresh Arrangement', note: '' }
    };
  }
  function sanitizeState(s) {
    var out = defaultState();
    if (!s || typeof s !== 'object') return out;
    out.bypass = !!s.bypass;
    out.style = STYLES.indexOf(s.style) >= 0 ? s.style : 'velvet';
    /* isFinite, not ||, everywhere a zero is legal — the AUTOPSY v0.4 lesson */
    var n;
    n = +s.drive;      out.drive = clamp(isFinite(n) ? n : 0, -12, 24);
    n = +s.lid;        out.lid = clamp(isFinite(n) ? n : -1, -20, 0);
    n = +s.margin;     out.margin = clamp(isFinite(n) ? n : 0, -1, 0);
    n = +s.vigil;      out.vigil = clamp(isFinite(n) ? n : 2, 0.1, 20);
    n = +s.release;    out.release = clamp(isFinite(n) ? n : 150, 1, 1000);
    n = +s.knee;       out.knee = clamp(isFinite(n) ? n : 0, 0, 12);
    n = +s.hold;       out.hold = clamp(isFinite(n) ? n : 0, 0, 500);
    n = +s.link;       out.link = clamp(isFinite(n) ? n : 100, 0, 100);
    n = +s.sat;        out.sat = clamp(isFinite(n) ? n : 0, 0, 100);
    n = +s.targetLufs; out.targetLufs = clamp(isFinite(n) ? n : -14, -30, -5);
    n = +s.msMid;      out.msMid = clamp(isFinite(n) ? n : 0, -12, 12);
    n = +s.msSide;     out.msSide = clamp(isFinite(n) ? n : 0, -12, 12);
    out.ms = !!s.ms;
    out.autoRel = !!s.autoRel;
    out.seal = !!s.seal;
    out.lining = LININGS.indexOf(+s.lining) >= 0 ? +s.lining : 4;
    /* Sealed at 1x is not a mode, it is a contradiction: there is no
       oversampled domain to form the product in, so the sidebands alias
       exactly as they would unsealed AND the decimator lowpasses the
       result. Measured, it overshoots by +7.2 dB and drives the safety
       clamp to 62% — i.e. it clips. The state is corrected rather than
       obeyed, so that `latencySamples` and the engine cannot disagree. */
    if (out.seal && out.lining === 1) out.lining = 2;
    out.dc = s.dc === undefined ? true : !!s.dc;
    out.unity = !!s.unity;
    out.dust = DUSTS.indexOf(s.dust) >= 0 ? s.dust : 'off';
    out.dustBits = DUST_BITS.indexOf(+s.dustBits) >= 0 ? +s.dustBits : 16;
    n = +s.dustSeed;   out.dustSeed = (isFinite(n) && n > 0) ? (n >>> 0) : 1848;
    if (s.meta) {
      out.meta.name = String(s.meta.name || out.meta.name);
      out.meta.note = String(s.meta.note || '');
    }
    return out;
  }

  /* ---------- the oversampler (the lining) ----------
     An Mth-band (Nyquist-M) FIR: windowed sinc with cutoff exactly at
     fs/2M, length L = 2Mq+1, centre c = Mq.
     Two properties fall out of that construction, and both are load-bearing:
       (1) h[c +- nM] = 0 for n != 0, so polyphase branch 0 is a PURE
           DELAY — the oversampled sequence contains the true sample
           values, unfiltered, with reconstructed values between them.
       (2) latency is exactly q BASE samples at every M, so changing the
           lining never shifts the plugin's reported latency.
     We force the analytically-zero taps to exact 0 and the centre tap to
     exact 1 rather than accept 1-ulp window noise there. That is not a
     fudge: we know those values in closed form, and property (1) is
     asserted bit-exactly by the harness.
     Each phase is then normalised to unit sum, which makes DC
     reconstruction exact — the property peak detection cares about. */
  function designOversampler(M, q) {
    var m = M | 0, L = 2 * m * q + 1, c = m * q;
    var h = new Float64Array(L);
    var i, k;
    if (m === 1) {
      return { M: 1, q: q, len: 1, center: 0, taps: new Float64Array([1]),
               phases: [new Float64Array([1])], histLen: 2 * q + 1 };
    }
    var a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
    var den = L - 1;
    for (k = 0; k < L; k++) {
      var u = 2 * Math.PI * k / den;
      var w = a0 - a1 * NM.cos(u) + a2 * NM.cos(2 * u) - a3 * NM.cos(3 * u);
      var t = (k - c) / m;
      var st;
      if (t === 0) st = 1;
      else { var pt = Math.PI * t; st = NM.sin(pt) / pt; }
      h[k] = st * w;
    }
    /* exact Mth-band correction */
    for (k = 0; k < L; k++) if ((k - c) % m === 0) h[k] = (k === c) ? 1 : 0;
    /* polyphase split: y[pM+i] = sum_j h[jM+i] * x[p-j] */
    var phases = [];
    for (i = 0; i < m; i++) {
      var taps = [];
      for (var j = 0; j * m + i < L; j++) taps.push(h[j * m + i]);
      var sum = 0;
      for (k = 0; k < taps.length; k++) sum += taps[k];
      if (sum !== 0 && sum !== 1) for (k = 0; k < taps.length; k++) taps[k] /= sum;
      phases.push(Float64Array.from ? Float64Array.from(taps) : new Float64Array(taps));
    }
    return { M: m, q: q, len: L, center: c, taps: h, phases: phases, histLen: 2 * q + 1 };
  }

  /* ---------- the decimator (the seal) ----------
     A DIFFERENT filter from the interpolator above, and the difference is
     the whole lesson of the first attempt. The Mth-band interpolator is
     -6 dB AT Nyquist by construction — that is precisely what forces
     h[kM] = 0 and buys branch-0-as-pure-delay — which makes it excellent
     at reconstruction and poor at decimation. A decimator wants its
     cutoff BELOW Nyquist with a real transition band to sit in. Reusing
     the interpolator here cost about a decibel before it was noticed.
     Normalised to unit DC gain, so a constant passes through unchanged. */
  function designDecimator(M, decQ, cutFrac) {
    var half = decQ * M, L = 2 * half + 1;
    var h = new Float64Array(L);
    var a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
    var den = L - 1, fc = cutFrac / M, k;
    for (k = 0; k < L; k++) {
      var u = 2 * Math.PI * k / den;
      var w = a0 - a1 * NM.cos(u) + a2 * NM.cos(2 * u) - a3 * NM.cos(3 * u);
      var t = (k - half) * fc;
      var st;
      if (t === 0) st = 1;
      else { var pt = Math.PI * t; st = NM.sin(pt) / pt; }
      h[k] = st * w;
    }
    var sum = 0;
    for (k = 0; k < L; k++) sum += h[k];
    for (k = 0; k < L; k++) h[k] /= sum;
    return { taps: h, len: L, half: half, decQ: decQ };
  }

  /* ---------- ITU-R BS.1770-4 K-weighting ----------
     The spec tabulates coefficients at 48 kHz only. These are the analog
     prototype constants, bilinear-transformed at any rate — the same
     derivation libebur128 uses, and at 48 kHz it reproduces the
     published table to the last digit (harness assertion). */
  function kWeight(fs) {
    var f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    var K = NM.sin(Math.PI * f0 / fs) / NM.cos(Math.PI * f0 / fs); // tan
    var Vh = NM.pow10(G / 20);
    var Vb = NM.exp(NM.log(Vh) * 0.4996667741545416);
    var a0 = 1 + K / Q + K * K;
    var shelf = {
      b0: (Vh + Vb * K / Q + K * K) / a0,
      b1: 2 * (K * K - Vh) / a0,
      b2: (Vh - Vb * K / Q + K * K) / a0,
      a1: 2 * (K * K - 1) / a0,
      a2: (1 - K / Q + K * K) / a0
    };
    var f1 = 38.13547087602444, Q1 = 0.5003270373238773;
    var K1 = NM.sin(Math.PI * f1 / fs) / NM.cos(Math.PI * f1 / fs);
    var d1 = 1 + K1 / Q1 + K1 * K1;
    var hp = {
      b0: 1, b1: -2, b2: 1,
      a1: 2 * (K1 * K1 - 1) / d1,
      a2: (1 - K1 / Q1 + K1 * K1) / d1
    };
    return { shelf: shelf, hp: hp };
  }
  /* BS.1770 loudness of a summed weighted mean-square. The -0.691 offset
     is what makes a 1 kHz sine read back its own dBFS level. */
  function loudnessOf(z) {
    return z > 1e-30 ? -0.691 + 10 * NM.log10(z) : -Infinity;
  }

  /* ---------- derived sizes (pure — the plugin reports latency from these) ---------- */
  function vigilSamples(st, fs) {
    return Math.round(clamp(st.vigil, 0.1, 20) * 0.001 * fs);
  }
  /* Sealed mode adds the decimator's group delay on top of the
     upsampler's. Both are whole base samples at every lining, so the
     reported latency stays independent of the lining either way. */
  function latencySamples(state, fs) {
    var st = sanitizeState(state);
    return OS_Q + vigilSamples(st, fs) + 1 + (st.seal ? DEC_Q : 0);
  }
  /* smoother half-length: two boxcars of B, triangle support 2B-2 <= M*Lb,
     which is what keeps the overshoot theorem's hypothesis true. */
  function boxLen(st, fs) {
    var Lb = vigilSamples(st, fs), M = st.lining;
    var span = Math.floor(STYLE[st.style].smoothFrac * M * Lb);
    var B = Math.floor(span / 2) + 1;
    return B < 1 ? 1 : B;
  }

  /* ---------- static transfer function (pure; drives both UIs) ----------
     inDb -> outDb through drive, knee, lid, margin, unity. */
  function transferAt(state, inDb) {
    var st = sanitizeState(state);
    var T = st.lid + st.margin;
    /* THE NaN AUDIT FOUND THIS, AND THE SOURCE IS NOW FIXED.
       ND.kneeOut's above-knee branch was `T + d * invR`, and a limiter is
       invR = 0 — so an infinite input gave Infinity * 0, which is NaN, and
       a NaN in a canvas path makes the transfer curve silently vanish
       rather than draw wrong.

       Last round this was guarded HERE, by substituting ±1e300 for an
       infinite input, because AUTOPSY is sealed and a shared change
       deserved its own deliberate act. It has now had one:
       `shared/necrodyn.js` short-circuits invR === 0 to T, which is
       bit-exact for every finite input (841,100 points checked) and
       correct for the infinite one.

       So the substitution is GONE, on purpose. A fix at the source that
       nothing reaches is a fix nobody has verified — leaving the local
       workaround in place would have kept the shared code permanently
       untested from the one program that can exercise it. What remains is
       the NaN case, which is a caller's error and is said plainly rather
       than swallowed. */
    if (inDb !== inDb) return NaN;
    var x = inDb + st.drive;
    var y = ND.kneeOut(x, T, st.knee, 0);
    if (st.unity) y += st.drive < 0 ? 0 : -st.drive;
    return y;
  }

  /* ============================================================
     THE ENGINE
     ============================================================ */
  function createEngine(fs) {
    var st = defaultState();
    var first = true;

    /* structural (rebuilt on setState) */
    var os = null, M = 1, Lb = 0, W = 1, B = 1, lat = 0;
    var histL = null, histR = null, hp = 0, histN = 0;
    var delL = null, delR = null;
    var sminL = null, sminR = null;
    var boxL1 = null, boxL2 = null, boxR1 = null, boxR2 = null;
    var ringL = null, ringR = null, ringN = 1, rp = 0;
    var relShape = 0;
    /* CONTROL-BLOCK PHASE, carried across process() calls.
       Without it the control counter restarts at every call, so
       control() fires at different points in the stream depending on
       the host's buffer size — and the output of a parameter glide
       then DEPENDS ON THE BUFFER SIZE. Measured before this existed:
       240- and 1200-sample buffers diverged from 4800-sample ones by
       -37 dB during a drive glide, while every multiple of 32 agreed
       bit-for-bit. A plugin whose audio changes when the host changes
       its buffer size is a plugin nobody can A/B. */
    var ctrlPhase = 0;
    /* the seal: x4 delayed to meet its own gain, the product awaiting
       decimation, and the decimator itself */
    var sealOn = false, dec = null, decTaps = null, decLen = 1;
    var x4L = null, x4R = null, xw = 0, xn = 1;
    var y4L = null, y4R = null, yw = 0, yn = 1;

    /* smoothed continuous params */
    var pT = { c: 0, t: 0 };        // threshold (lid + margin), dB
    var pW = { c: 0, t: 0 };        // knee, dB
    var pDrive = { c: 0, t: 0 };    // dB
    var pLink = { c: 1, t: 1 };     // 0..1
    var pSat = { c: 1, t: 1 };      // soft-clip knee position (1 = off)

    /* derived at control rate */
    var driveLin = 1, unityLin = 1, kneeStartLin = 0, Tdb = 0, Wdb = 0, lidLin = 1;
    var trueLidLin = 1, dustCeil = 1;
    var msOn = false, msMidLin = 1, msSideLin = 1;
    var clampWorst = 0, clampHits = 0;
    var linkA = 1, linkB = 0;
    var cF = 0, cS = 0, stepF = 0, stepS = 0, holdN = 0, autoRel = false;
    var dustOn = false, dustShape = false, dustLsb = 0, dustRand = null;
    var e1 = 0, e2 = 0, e1r = 0, e2r = 0;

    /* per-channel dynamics */
    var envLf = 0, envLs = 0, holdL = 0;
    var envRf = 0, envRs = 0, holdR = 0;

    var dcL = ND.dcBlocker(5, fs), dcR = ND.dcBlocker(5, fs);

    /* THE BYPASS DELAY — latency-compensated bypass.
       Found while chasing the last of the latency-pad bias, and worse than
       the thing it was hiding behind: bypass used to pass audio through
       with ZERO delay while latencySamples() still reported the full
       figure. The host compensates by the reported number either way, so
       toggling bypass moved the audio 113 samples EARLIER at 48 k. Two and
       a third milliseconds.
       That breaks the one thing bypass is for. An A/B where the two sides
       are not time-aligned is not an A/B — against a parallel path it is a
       comb filter, and on its own it reads as "the bypassed version sounds
       tighter", which is a timing shift wearing a tone control's clothes.
       This line is pushed on EVERY sample, bypassed or not, so that
       toggling mid-stream finds it already primed with the right history
       instead of clicking through `lat` samples of silence. */
    var bypL = null, bypR = null;

    /* metering */
    var mtr = makeMeter(fs);
    var grNow = 0, grPeak = 0;
    /* THE TRACE — peaks since the last read, for a scrolling display.
       Distinct from the meter's `peak`, which is a running maximum since
       the last resetMeters(). The plugin editor sampled that running
       maximum 30 times a second and drew it as a scrolling level, which
       can only ever climb to a plateau and then sit there: a flat line
       that looks like a working display. A scrolling view needs the peak
       WITHIN each frame, so these reset on read.
       There is an input trace here for the same reason. Every figure the
       meter produces is measured AFTER the limiter, so a face that wants
       to show what went in has nothing to draw and has to either invent
       it or draw the output twice. */
    var tIn = 0, tOut = 0, tGr = 0;

    function rebuild() {
      M = st.lining;
      Lb = vigilSamples(st, fs);
      sealOn = !!st.seal;
      lat = OS_Q + Lb + 1 + (sealOn ? DEC_Q : 0);
      bypL = ND.delay(lat); bypR = ND.delay(lat);
      relShape = STYLE[st.style].relShape;
      os = designOversampler(M, OS_Q);
      histN = os.histLen;
      histL = new Float64Array(histN); histR = new Float64Array(histN); hp = 0;
      delL = ND.delay(lat); delR = ND.delay(lat);
      /* W = M(Lb+1)+1 makes the decimated gain land exactly on base
         sample p-Lb-1 — see the alignment derivation in the doc. */
      W = M * (Lb + 1) + 1;
      sminL = ND.slidingMin(W, 0); sminR = ND.slidingMin(W, 0);
      B = boxLen(st, fs);
      boxL1 = ND.boxcar(B, 0); boxL2 = ND.boxcar(B, 0);
      boxR1 = ND.boxcar(B, 0); boxR2 = ND.boxcar(B, 0);
      ringN = 2 * M - 1;
      ringL = new Float64Array(ringN); ringR = new Float64Array(ringN); rp = 0;
      /* the seal's rings. x4 is held W-1 oversampled samples so it can
         meet the gain computed FROM it; y4 holds the product until the
         decimator's window is full. Only allocated when sealed. */
      if (sealOn) {
        dec = designDecimator(M, DEC_Q, DEC_CUT);
        decTaps = dec.taps; decLen = dec.len;
        xn = W; x4L = new Float64Array(xn); x4R = new Float64Array(xn); xw = 0;
        yn = decLen + M; y4L = new Float64Array(yn); y4R = new Float64Array(yn); yw = 0;
      } else {
        dec = null; decTaps = null; decLen = 1;
        xn = yn = 1; x4L = x4R = y4L = y4R = null; xw = yw = 0;
      }
      envLf = envLs = envRf = envRs = 0; holdL = holdR = 0;
      ctrlPhase = 0;
      e1 = e2 = e1r = e2r = 0;
      dcL.clear(); dcR.clear();
      dustRand = ND.lcg(st.dustSeed);
    }

    function smooth(p) {
      var n = p.c + (p.t - p.c) * SMOOTH;
      p.c = Math.abs(p.t - n) < SNAP ? p.t : n;
    }
    function snapAll() {
      pT.c = pT.t; pW.c = pW.t; pDrive.c = pDrive.t; pLink.c = pLink.t; pSat.c = pSat.t;
    }

    function control() {
      /* THE THRESHOLD TIGHTENS INSTANTLY AND LOOSENS SMOOTHLY.
         Every other parameter can glide in both directions, but the lid
         cannot: if you automate the ceiling downward, a smoothed threshold
         lags behind it for a dozen control blocks and the output sits
         ABOVE the ceiling you just asked for. Measured before this fix,
         sweeping the lid every 64 samples: +2.37 dB over.
         This is the same asymmetry the release envelope uses, for the same
         reason — the safe direction may be slow, the unsafe direction may
         not. Sweeping a ceiling down IS a gain change, so snapping it
         introduces no artefact the user did not ask for. */
      if (pT.t < pT.c) pT.c = pT.t; else smooth(pT);
      smooth(pW); smooth(pDrive); smooth(pLink); smooth(pSat);
      Tdb = pT.c; Wdb = pW.c;
      driveLin = pDrive.c === 0 ? 1 : ND.dbToLin(pDrive.c);
      unityLin = (st.unity && pDrive.c > 0) ? ND.dbToLin(-pDrive.c) : 1;
      kneeStartLin = ND.dbToLin(Tdb - Wdb / 2);
      lidLin = ND.dbToLin(Tdb);
      /* the TRUE lid, before the dust trim — the dithered output is
         clamped to the largest quantisation step at or below it, so
         the guarantee holds by construction rather than by budget */
      trueLidLin = ND.dbToLin(st.lid + st.margin);
      dustCeil = dustLsb > 0 ? Math.floor(trueLidLin / dustLsb) * dustLsb : trueLidLin;
      linkA = pLink.c; linkB = 1 - pLink.c;
      msOn = st.ms;
      msMidLin = st.msMid === 0 ? 1 : ND.dbToLin(st.msMid);
      msSideLin = st.msSide === 0 ? 1 : ND.dbToLin(st.msSide);
      cF = ND.onePole(st.release, fs);
      cS = ND.onePole(st.release * 8, fs);
      stepF = 20 / (st.release * 0.001 * fs);
      stepS = stepF / 8;
      holdN = Math.round(st.hold * 0.001 * fs);
      autoRel = st.autoRel;
    }

    function applyTargets() {
      /* the dust ceiling: TPDF can add up to one LSB, so when dither is
         armed the gain computer aims two LSB below the stated lid. It is
         the only way "nothing gets out" survives quantisation, and it
         costs 0.0005 dB at 16 bits. */
      /* THE DUST CEILING, corrected 2026-08-15 after the fuzzer found it.
         Flat TPDF adds at most 1 LSB of dither plus 0.5 LSB of rounding.
         SHAPED dither also feeds its own error back — f = 2·e1 − e2, and
         each e is itself bounded by 1.5 LSB — so the excursion is up to
         2(1.5) + 1.5 = 4.5 LSB of feedback on top, ~6 LSB all told.
         Trimming 2 LSB covered the flat case and quietly did not cover
         the shaped one: measured overshoots of ~0.005 dB on 12 of 400
         random states, every single one with shaped dust armed. */
      var lsb = NM.pow10((1 - st.dustBits) * NM.log10(2));
      var trimLsb = st.dust === 'shaped' ? 6 : 2;
      var dustTrim = st.dust === 'off' ? 0 : 20 * NM.log10(1 - trimLsb * lsb);
      pT.t = st.lid + st.margin + dustTrim;
      pW.t = st.knee;
      pDrive.t = st.drive;
      pLink.t = st.link / 100;
      pSat.t = 1 - (st.sat / 100) * 0.6;
      dustOn = st.dust !== 'off';
      dustShape = st.dust === 'shaped';
      dustLsb = lsb;
    }

    function setState(s) {
      var prev = st;
      st = sanitizeState(s);
      var structural = first ||
        st.lining !== prev.lining || st.vigil !== prev.vigil ||
        st.style !== prev.style || st.dustSeed !== prev.dustSeed;
      applyTargets();
      if (structural) rebuild();
      /* The FIRST state a caller hands us snaps; every one after glides.
         Note that the constructor deliberately does NOT consume this flag
         — if it did, "new engine, set state, render" would ramp its
         parameters in from the defaults while "reset, render" would not,
         and the two would disagree. That asymmetry is exactly what the
         reset() regression assertion exists to catch. */
      if (first) { snapAll(); first = false; }
      control();
    }

    function reset() {
      rebuild();
      mtr.reset();
      grNow = 0; grPeak = 0;
      clampWorst = 0; clampHits = 0;
      snapAll();
      control();
    }

    /* the required gain in dB (<= 0) for a reconstructed magnitude.
       The fast path matters: below the knee we return an exact 0 without
       touching a logarithm, which is both most of the CPU saving and the
       reason the null test is bit-exact. */
    function requiredGr(a) {
      if (a <= kneeStartLin) return 0;
      return ND.kneeGain(ND.linToDb(a), Tdb, Wdb, 0);
    }

    function advance(e, gr, c, step) {
      var n = relShape === 1 ? e + step : e * c;
      if (n > gr) n = gr;
      if (gr === 0 && n > -1e-12) return 0;
      return n;
    }

    function tickL(gr) {
      if (gr <= envLf) { envLf = gr; holdL = holdN; }
      else if (holdL > 0) { holdL--; }
      else { envLf = advance(envLf, gr, cF, stepF); }
      if (!autoRel) { envLs = envLf; return envLf; }
      if (gr <= envLs) envLs = gr;
      else if (holdL <= 0) envLs = advance(envLs, gr, cS, stepS);
      var d = envLf - envLs; if (d < 0) d = -d;
      var w = ND.blend(d, 3);
      return w * envLf + (1 - w) * envLs;
    }
    function tickR(gr) {
      if (gr <= envRf) { envRf = gr; holdR = holdN; }
      else if (holdR > 0) { holdR--; }
      else { envRf = advance(envRf, gr, cF, stepF); }
      if (!autoRel) { envRs = envRf; return envRf; }
      if (gr <= envRs) envRs = gr;
      else if (holdR <= 0) envRs = advance(envRs, gr, cS, stepS);
      var d = envRf - envRs; if (d < 0) d = -d;
      var w = ND.blend(d, 3);
      return w * envRf + (1 - w) * envRs;
    }

    /* polyphase branch i, reading the circular history backwards */
    function phase(hist, ph) {
      var taps = os.phases[ph], nt = taps.length, s = 0, idx = hp - 1;
      for (var j = 0; j < nt; j++) {
        if (idx < 0) idx += histN;
        s += taps[j] * hist[idx];
        idx--;
      }
      return s;
    }

    /* TPDF (difference of two uniforms) at +-1 LSB, i.e. 2 LSB peak-to-peak
       — the amplitude that both decorrelates the error AND removes noise
       modulation; rectangular dither does neither properly.
       Rounding is floor(x + 0.5), not Math.round: JS and C++ disagree on
       Math.round's tie behaviour for negatives, and floor does not. */
    function dither(x, isR) {
      var f = dustShape ? (isR ? 2 * e1r - e2r : 2 * e1 - e2) : 0;
      var v = x - f;
      var d = (dustRand() - dustRand()) * dustLsb;
      var w2 = v + d;
      var q = Math.floor(w2 / dustLsb + 0.5) * dustLsb;
      /* Clamp to the grid, not to an arbitrary value: the largest
         quantisation step at or below the true lid is still ON the grid,
         so the output stays exactly representable at the target depth. */
      if (q > dustCeil) q = dustCeil;
      else if (q < -dustCeil) q = -dustCeil;
      if (dustShape) {
        var er = q - v;
        if (isR) { e2r = e1r; e1r = er; } else { e2 = e1; e1 = er; }
      }
      return q;
    }

    /* inL/inR/outL/outR: Float64Array-likes of equal length */
    function process(inL, inR, outL, outR) {
      var n = inL.length, pos = 0;
      while (pos < n) {
        /* fire control() every CTRL samples of STREAM time, not of call
           time — see ctrlPhase above */
        if (ctrlPhase === 0) control();
        var end = pos + (CTRL - ctrlPhase); if (end > n) end = n;
        for (var s = pos; s < end; s++) {
          var xl = inL[s], xr = inR[s];
          /* the input trace, taken before ANYTHING — including drive and
             bypass — because "what arrived" is the one thing no other
             meter in this core can tell you */
          var tl = xl < 0 ? -xl : xl, tr = xr < 0 ? -xr : xr;
          if (tl > tIn) tIn = tl;
          if (tr > tIn) tIn = tr;
          /* always pushed — see the note at bypL's declaration */
          var byl = bypL.push(xl), byr = bypR.push(xr);
          if (st.bypass) {
            outL[s] = byl; outR[s] = byr;
            grNow = 0;
            var bl2 = byl < 0 ? -byl : byl, br2 = byr < 0 ? -byr : byr;
            if (bl2 > tOut) tOut = bl2;
            if (br2 > tOut) tOut = br2;
            mtr.push(byl, byr);
            continue;
          }
          if (driveLin !== 1) { xl *= driveLin; xr *= driveLin; }
          if (st.dc) { xl = dcL.tick(xl); xr = dcR.tick(xr); }
          /* M/S PRE-STAGE. Encode m=(L+R)/2, s=(L-R)/2, trim, decode
             L=m+s, R=m-s.
             The round trip is NOT bit-exact and it is worth saying why,
             because the obvious comment here is wrong: multiplying by 0.5
             is exact, but fl(L+R) and fl(L-R) each round, so
             (fl(L+R) + fl(L-R))/2 need not return L. Measured, it misses
             by an ulp on ordinary material.
             So the stage SHORT-CIRCUITS when both trims sit at unity —
             the same discipline softClip uses at t >= 1 and dbToLin at
             0 dB. Arming M/S with nothing dialled in must not cost a bit,
             or the null test would quietly depend on a checkbox. */
          if (msOn && !(msMidLin === 1 && msSideLin === 1)) {
            var mm = (xl + xr) * 0.5, ss = (xl - xr) * 0.5;
            mm *= msMidLin; ss *= msSideLin;
            xl = mm + ss; xr = mm - ss;
          }
          if (pSat.c < 1) { xl = ND.softClip(xl, pSat.c); xr = ND.softClip(xr, pSat.c); }

          var dl = delL.push(xl), dr = delR.push(xr);

          histL[hp] = xl; histR[hp] = xr;
          hp = hp + 1 === histN ? 0 : hp + 1;


          var gStepL = 0, gStepR = 0;
          for (var i = 0; i < M; i++) {
            var sl, sr;
            if (i === 0) {
              /* branch 0 is a pure delay by construction — no MACs, and
                 the value is the true sample, not a reconstruction */
              var z = hp - 1 - OS_Q; if (z < 0) z += histN;
              sl = histL[z]; sr = histR[z];
            } else {
              sl = phase(histL, i); sr = phase(histR, i);
            }
            var al = sl < 0 ? -sl : sl, ar = sr < 0 ? -sr : sr;
            var gl = requiredGr(al), gr2 = requiredGr(ar);
            var mn = gl < gr2 ? gl : gr2;
            var ll = linkA * mn + linkB * gl;
            var lr = linkA * mn + linkB * gr2;
            var bl = boxL2.push(boxL1.push(sminL.push(tickL(ll))));
            var br = boxR2.push(boxR1.push(sminR.push(tickR(lr))));
            if (sealOn) {
              /* THE SEAL. Pair each oversampled gain with the oversampled
                 sample it was computed FOR — the gain chain runs exactly
                 W−1 oversampled samples behind — and form the product up
                 here, where the modulation sidebands still fit under
                 Nyquist instead of folding back across it. */
              var nx = xw + 1 === xn ? 0 : xw + 1;
              var oldL = x4L[nx], oldR = x4R[nx];
              x4L[xw] = sl; x4R[xw] = sr;
              xw = nx;
              y4L[yw] = oldL * (bl === 0 ? 1 : ND.dbToLin(bl));
              y4R[yw] = oldR * (br === 0 ? 1 : ND.dbToLin(br));
              yw = yw + 1 === yn ? 0 : yw + 1;
              if (bl < gStepL) gStepL = bl;
              if (br < gStepR) gStepR = br;
            } else {
              ringL[rp] = bl; ringR[rp] = br;
              rp = rp + 1 === ringN ? 0 : rp + 1;
            }
          }

          var yl, yr;
          if (sealOn) {
            /* Decimate the PRODUCT. The window ends at the first of this
               step's writes — the one oversampled index in the group that
               is a multiple of M — so the filter's centre lands exactly on
               the base-rate grid and the latency stays a whole number. */
            var idx = yw - M; if (idx < 0) idx += yn;
            var F1 = 0, F2 = 0;
            for (var k3 = 0; k3 < decLen; k3++) {
              var tp3 = decTaps[k3];
              F1 += tp3 * y4L[idx];
              F2 += tp3 * y4R[idx];
              idx = idx === 0 ? yn - 1 : idx - 1;
            }
            yl = F1; yr = F2;
            grNow = gStepL < gStepR ? gStepL : gStepR;
          } else {
            /* decimate the GAIN by MINIMUM over the 2M-1 window centred on
               this base sample. Centred, not trailing: it is what makes the
               bound cover the inter-sample regions on BOTH sides. */
            var gL = ringL[0], gR = ringR[0], k2;
            for (k2 = 1; k2 < ringN; k2++) {
              if (ringL[k2] < gL) gL = ringL[k2];
              if (ringR[k2] < gR) gR = ringR[k2];
            }
            grNow = gL < gR ? gL : gR;
            yl = dl * (gL === 0 ? 1 : ND.dbToLin(gL));
            yr = dr * (gR === 0 ? 1 : ND.dbToLin(gR));
          }
          if (grNow < grPeak) grPeak = grNow;
          /* The rounding clamp. By the theorem the gain is always at
             least as much as required, so this can only ever fire on the
             last ulp of dbToLin() and the multiply — never on real
             overshoot. It is not a clipper; it is what turns "under the
             lid to within floating-point" into "under the lid". The
             harness watches clampWorst to prove it stays that way: if the
             design were wrong, this counter would be doing real work. */
          if (yl > lidLin || yl < -lidLin) {
            var ex = (yl < 0 ? -yl : yl) / lidLin - 1;
            if (ex > clampWorst) clampWorst = ex;
            clampHits++;
            yl = yl < 0 ? -lidLin : lidLin;
          }
          if (yr > lidLin || yr < -lidLin) {
            var ex2 = (yr < 0 ? -yr : yr) / lidLin - 1;
            if (ex2 > clampWorst) clampWorst = ex2;
            clampHits++;
            yr = yr < 0 ? -lidLin : lidLin;
          }
          if (unityLin !== 1) { yl *= unityLin; yr *= unityLin; }
          if (dustOn) { yl = dither(yl, false); yr = dither(yr, true); }
          outL[s] = yl; outR[s] = yr;
          var ol = yl < 0 ? -yl : yl, or_ = yr < 0 ? -yr : yr;
          if (ol > tOut) tOut = ol;
          if (or_ > tOut) tOut = or_;
          if (grNow < tGr) tGr = grNow;
          mtr.push(yl, yr);
        }
        ctrlPhase += end - pos;
        if (ctrlPhase >= CTRL) ctrlPhase = 0;
        pos = end;
      }
    }

    function meters() {
      var m = mtr.read();
      m.gr = grNow;
      m.grPeak = grPeak;
      m.latency = lat;
      return m;
    }
    /* READ AND RESET. Deliberately not folded into meters(): a read with
       a side effect surprises everybody eventually, and half this
       project's harnesses call meters() twice in a row and compare. */
    function trace() {
      var t = {
        inPeak: tIn, outPeak: tOut, gr: tGr,
        inPeakDb: ND.linToDb(tIn), outPeakDb: ND.linToDb(tOut)
      };
      tIn = 0; tOut = 0; tGr = 0;
      return t;
    }
    function resetMeters() { mtr.reset(); grPeak = 0; tIn = 0; tOut = 0; tGr = 0; }

    /* stand the engine up without consuming `first` */
    applyTargets();
    rebuild();
    snapAll();
    control();

    return {
      setState: setState, process: process, reset: reset,
      meters: meters, trace: trace, resetMeters: resetMeters,
      /* Separate from meters() on purpose — meters() runs at the UI's 30 Hz
         timer and the histogram is a bar per 0.1 LU bin over the whole
         3 s ring, cheap but pointless to rebuild 30 times a second when a
         chart only needs to redraw when it's actually visible. */
      histogramS: function () { return mtr.histogramS(); },
      latency: function () { return lat; },
      gr: function () { return grNow; },
      _debug: function () {
        return { M: M, Lb: Lb, W: W, B: B, lat: lat, os: os,
                 Tdb: Tdb, Wdb: Wdb, lidLin: lidLin,
                 clampWorst: clampWorst, clampHits: clampHits,
                 boxSums: [boxL1.sum(), boxL2.sum()],
                 boxRecomputed: [boxL1.recompute(), boxL2.recompute()] };
      }
    };
  }

  /* ============================================================
     THE PLOT — ITU-R BS.1770-4 metering
     ============================================================ */
  var BIN_LO = -70, BIN_W = 0.1, NBINS = 751;

  function makeMeter(fs) {
    var kc = kWeight(fs);
    var kl1 = ND.biquad(), kl2 = ND.biquad(), kr1 = ND.biquad(), kr2 = ND.biquad();
    var subN = Math.round(fs * 0.1);            // 100 ms sub-block
    var subI = 0, accL = 0, accR = 0;
    var RING = 30;                              // 3 s of sub-blocks
    var rL = new Float64Array(RING), rR = new Float64Array(RING);
    var rp = 0, filled = 0;
    /* Bounded-memory gating. The histogram decides WHICH blocks survive
       the relative gate; a parallel array carries their EXACT energy, so
       the reported number is not quantised to the bin grid. Using bin
       centres for the energy too (the obvious shortcut) puts a
       systematic +0.05 LU bias on every reading. */
    var hist = new Float64Array(NBINS);
    var histE = new Float64Array(NBINS);
    /* LOUDNESS RANGE (EBU Tech 3342) is a SECOND distribution, over
       SHORT-TERM (3 s) loudness rather than the 400 ms blocks integrated
       loudness uses — different window, different gate (-20 LU, not -10),
       different answer. Sharing one histogram between them would be
       quietly wrong, so there are two. */
    var histS = new Float64Array(NBINS);
    var histSE = new Float64Array(NBINS);
    var peak = 0, tp = 0, tpOver = false;
    /* true peak measured through its own 4x reconstruction, per spec */
    var tos = designOversampler(METER_OS, OS_Q);
    var thN = tos.histLen;
    var thL = new Float64Array(thN), thR = new Float64Array(thN), thp = 0;

    function tpPhase(hist2, ph) {
      var taps = tos.phases[ph], nt = taps.length, s = 0, idx = thp - 1;
      for (var j = 0; j < nt; j++) {
        if (idx < 0) idx += thN;
        s += taps[j] * hist2[idx];
        idx--;
      }
      return s;
    }

    function windowLoud(k) {
      if (filled < k) k = filled;
      if (k <= 0) return -Infinity;
      var zl = 0, zr = 0;
      for (var i = 0; i < k; i++) {
        var p = rp - 1 - i; while (p < 0) p += RING;
        zl += rL[p]; zr += rR[p];
      }
      return loudnessOf(zl / k + zr / k);
    }

    /* The gate-and-percentile pass EBU Tech 3342 LRA needs, extracted so
       lra() and histogramS() (below) compute it once, the same way, rather
       than risk two copies of "-20 LU below the mean of what survived"
       drifting apart under a future edit. */
    function shortTermStats() {
      var i, sum = 0, cnt = 0;
      for (i = 0; i < NBINS; i++) {
        if (!histS[i]) continue;
        sum += histSE[i]; cnt += histS[i];
      }
      if (cnt < 1) return { gate: -Infinity, p10: null, p95: null, lra: 0 };
      var gate = loudnessOf(sum / cnt) - 20;
      var kept = 0;
      for (i = 0; i < NBINS; i++) {
        if (!histS[i]) continue;
        if (BIN_LO + (i + 0.5) * BIN_W <= gate) continue;
        kept += histS[i];
      }
      if (kept < 1) return { gate: gate, p10: null, p95: null, lra: 0 };
      var lo = kept * 0.10, hi = kept * 0.95;
      var run = 0, p10 = null, p95 = null;
      for (i = 0; i < NBINS; i++) {
        if (!histS[i]) continue;
        var l = BIN_LO + (i + 0.5) * BIN_W;
        if (l <= gate) continue;
        run += histS[i];
        if (p10 === null && run >= lo) p10 = l;
        if (p95 === null && run >= hi) { p95 = l; break; }
      }
      var lraV = (p10 === null || p95 === null) ? 0 : p95 - p10;
      return { gate: gate, p10: p10, p95: p95, lra: lraV };
    }

    return {
      push: function (l, r) {
        var a = l < 0 ? -l : l, b = r < 0 ? -r : r;
        if (a > peak) peak = a;
        if (b > peak) peak = b;
        thL[thp] = l; thR[thp] = r;
        thp = thp + 1 === thN ? 0 : thp + 1;
        for (var i = 0; i < METER_OS; i++) {
          var vl, vr;
          if (i === 0) {
            var z = thp - 1 - OS_Q; if (z < 0) z += thN;
            vl = thL[z]; vr = thR[z];
          } else { vl = tpPhase(thL, i); vr = tpPhase(thR, i); }
          if (vl < 0) vl = -vl;
          if (vr < 0) vr = -vr;
          if (vl > tp) tp = vl;
          if (vr > tp) tp = vr;
        }
        var wl = kl2.tick(kc.hp, kl1.tick(kc.shelf, l));
        var wr = kr2.tick(kc.hp, kr1.tick(kc.shelf, r));
        accL += wl * wl; accR += wr * wr;
        subI++;
        if (subI >= subN) {
          rL[rp] = accL / subN; rR[rp] = accR / subN;
          rp = rp + 1 === RING ? 0 : rp + 1;
          if (filled < RING) filled++;
          accL = 0; accR = 0; subI = 0;
          /* 400 ms block at 75% overlap = one per sub-block */
          if (filled >= 4) {
            var bl = windowLoud(4);
            if (bl >= BIN_LO) {
              var bi = Math.floor((bl - BIN_LO) / BIN_W);
              if (bi >= NBINS) bi = NBINS - 1;
              if (bi >= 0) { hist[bi] += 1; histE[bi] += NM.pow10((bl + 0.691) / 10); }
            }
          }
          /* short-term needs a full 3 s before it means anything */
          if (filled >= RING) {
            var sl2 = windowLoud(RING);
            if (sl2 >= BIN_LO) {
              var si = Math.floor((sl2 - BIN_LO) / BIN_W);
              if (si >= NBINS) si = NBINS - 1;
              if (si >= 0) { histS[si] += 1; histSE[si] += NM.pow10((sl2 + 0.691) / 10); }
            }
          }
        }
      },
      /* EBU Tech 3342. Absolute gate at -70 LUFS (the histogram's floor),
         then a RELATIVE gate 20 LU below the mean of what survived — note
         20, where integrated loudness uses 10. LRA is then the spread
         between the 10th and 95th percentiles of what is left.
         Factored out as shortTermStats() (added 2026-08-18) so histogramS()
         below can return the gate and percentile markers a chart needs
         without re-deriving them by hand — one gate computation, two
         callers, rather than a second copy that could quietly drift from
         this one. lra()'s return type (a plain number) is unchanged; every
         existing caller of m.lra keeps working exactly as before. */
      lra: function () { return shortTermStats().lra; },
      /* Diagnostic only — not part of any guarantee the parity gate proves,
         same footing as the GR trace. Returns the SHORT-TERM histogram
         (the one LRA is computed from, not the 400 ms one integrated
         loudness uses) as sparse {loudness, count} bins, plus the gate and
         the p10/p95 markers lra() itself used, so a chart can show exactly
         what was kept, what was gated out, and where the reported LRA
         number actually came from — rather than a bar chart that LOOKS
         authoritative but was drawn from different numbers than the LRA
         figure sitting next to it. */
      histogramS: function () {
        var st = shortTermStats(), bins = [];
        for (var i = 0; i < NBINS; i++) {
          if (!histS[i]) continue;
          bins.push({ loudness: BIN_LO + (i + 0.5) * BIN_W, count: histS[i] });
        }
        return { bins: bins, gate: st.gate, p10: st.p10, p95: st.p95, lra: st.lra };
      },
      read: function () {
        /* integrated: absolute gate at -70 (the histogram's floor), then
           a relative gate 10 LU below the mean of what survived. Both
           gates, in that order, or it is not integrated loudness. */
        var i, l, sum = 0, cnt = 0;
        for (i = 0; i < NBINS; i++) {
          if (!hist[i]) continue;
          sum += histE[i]; cnt += hist[i];
        }
        var integ = -Infinity;
        if (cnt > 0) {
          var g2 = loudnessOf(sum / cnt) - 10;
          var sum2 = 0, cnt2 = 0;
          for (i = 0; i < NBINS; i++) {
            if (!hist[i]) continue;
            l = BIN_LO + (i + 0.5) * BIN_W;
            if (l <= g2) continue;
            sum2 += histE[i]; cnt2 += hist[i];
          }
          if (cnt2 > 0) integ = loudnessOf(sum2 / cnt2);
        }
        return {
          momentary: windowLoud(4), shortTerm: windowLoud(30), integrated: integ,
          lra: this.lra(),
          peakDb: ND.linToDb(peak), truePeakDb: ND.linToDb(tp), tpOver: tpOver,
          peak: peak, truePeak: tp
        };
      },
      overAt: function (ceilLin) { tpOver = tpOver || tp > ceilLin; return tpOver; },
      reset: function () {
        subI = 0; accL = 0; accR = 0; rp = 0; filled = 0;
        for (var i = 0; i < NBINS; i++) { hist[i] = 0; histE[i] = 0; histS[i] = 0; histSE[i] = 0; }
        for (i = 0; i < RING; i++) { rL[i] = 0; rR[i] = 0; }
        peak = 0; tp = 0; tpOver = false;
        kl1.clear(); kl2.clear(); kr1.clear(); kr2.clear();
        for (i = 0; i < thN; i++) { thL[i] = 0; thR[i] = 0; }
        thp = 0;
      }
    };
  }

  /* ---------- offline true-peak measurement (harness + file analysis) ----------
     Deliberately uses a LONGER filter than the live meter so the test is
     an independent check rather than the same code marking its own work.
     `skip` ignores that many samples at each end. It exists because a
     buffer that begins mid-signal presents the reconstructor with a step
     from silence, and the ringing on that step is a real true peak OF THE
     STEP — an artefact of where the slice was taken, not of the audio.
     Analysing a whole file (which starts and ends at zero) wants skip 0;
     analysing a slice out of the middle wants skip >= the filter's half
     length. Getting this wrong reads as ~1 dB of phantom overshoot. */
  function truePeakOf(buf, factor, skip) {
    var m = factor || 16;
    var o = designOversampler(m, 32);
    var n = buf.length, histN2 = o.histLen;
    var sk = skip || 0;
    var h = new Float64Array(histN2), p = 0, mx = 0;
    for (var s = 0; s < n; s++) {
      h[p] = buf[s];
      p = p + 1 === histN2 ? 0 : p + 1;
      if (s < sk + 32 || s >= n - sk) continue;
      for (var i = 0; i < m; i++) {
        var v;
        if (i === 0) { var z = p - 1 - 32; if (z < 0) z += histN2; v = h[z]; }
        else {
          var taps = o.phases[i], nt = taps.length, acc = 0, idx = p - 1;
          for (var j = 0; j < nt; j++) {
            if (idx < 0) idx += histN2;
            acc += taps[j] * h[idx];
            idx--;
          }
          v = acc;
        }
        if (v < 0) v = -v;
        if (v > mx) mx = v;
      }
    }
    return mx;
  }

  /* ---------- sample-rate conversion ----------
     A 44.1 kHz file dropped into a 96 kHz session used to be the user's
     problem. It is a limiter's problem too: EVERY figure this instrument
     reports is derived from fs. K-weighting is designed at fs, the vigil
     is milliseconds converted to samples at fs, the true-peak
     reconstruction oversamples fs. Metering a 44.1 kHz buffer as though it
     were 96 kHz does not merely sound wrong, it reports wrong — the
     loudness of a file played at 2.18× speed.

     Bandlimited windowed-sinc, arbitrary ratio, no state, no latency.
     Symmetric taps centred on the fractional position, so output sample j
     corresponds to input time j/ratio exactly and nothing needs
     compensating downstream.

     Three decisions worth the ink:

     · THE CUTOFF MOVES WITH THE DIRECTION. Going up, the input's Nyquist
       is the binding one and the cutoff stays at 1. Going DOWN, the
       OUTPUT's Nyquist binds, so the cutoff drops to the ratio — this is
       the anti-aliasing, and leaving it at 1 is the single mistake that
       makes a resampler sound like a broken one.

     · THE WINDOW WIDENS WHEN THE CUTOFF NARROWS. A fixed tap count at a
       lower cutoff is a shorter filter in cycles of the passband, which
       means a softer transition exactly where it matters most. Half-width
       is Q/cut, not Q.

     · THE TAPS ARE NORMALISED TO SUM TO ONE. The window's truncation
       error would otherwise put a small, level-dependent gain error on
       every conversion. Normalising makes DC gain exactly 1 by
       construction rather than by budget — the same discipline the dither
       clamp uses. It is asserted, not assumed.

     NM for the transcendentals per LAW 2. Nothing here touches shared/. */
  var RS_Q = 32;

  function resample(inL, inR, fsIn, fsOut, quality) {
    var Q = isFinite(quality) && quality > 3 ? Math.floor(quality) : RS_Q;
    var n = inL ? inL.length : 0;
    var stereo = !!inR;
    if (!isFinite(fsIn) || !isFinite(fsOut) || fsIn <= 0 || fsOut <= 0) {
      return { L: new Float64Array(0), R: new Float64Array(0),
               fs: fsIn, ratio: 1, taps: 0, converted: false };
    }
    /* THE NULL TEST FOR THE RESAMPLER. Same rate in and out must be a
       copy, not a filter run at ratio 1 — a windowed sinc at unity is very
       nearly the identity and "very nearly" is how a bit-exact project
       loses its bit-exactness. */
    if (fsIn === fsOut || n === 0) {
      return {
        L: Float64Array.prototype.slice.call(inL || new Float64Array(0)),
        R: stereo ? Float64Array.prototype.slice.call(inR)
                  : Float64Array.prototype.slice.call(inL || new Float64Array(0)),
        fs: fsOut, ratio: 1, taps: 0, converted: false
      };
    }

    var ratio = fsOut / fsIn;
    var cut = ratio < 1 ? ratio : 1;
    var half = Math.ceil(Q / cut);
    var m = Math.floor(n * ratio);
    if (m < 1) m = 1;
    var outL = new Float64Array(m), outR = new Float64Array(m);
    var TWO_PI = 6.283185307179586;
    var W = 2 * half;

    for (var j = 0; j < m; j++) {
      var pos = j / ratio;
      var i0 = Math.floor(pos);
      var frac = pos - i0;
      var accL = 0, accR = 0, gain = 0;
      for (var k = -half + 1; k <= half; k++) {
        var x = k - frac;                 /* distance in input samples */
        var a = cut * x;
        var s;
        if (a === 0) s = 1;
        else { var t = TWO_PI * 0.5 * a; s = NM.sin(t) / t; }
        /* Blackman, in the window's own coordinates */
        var u = (x + half) / W;
        if (u < 0 || u > 1) continue;
        var w = 0.42 - 0.5 * NM.cos(TWO_PI * u) + 0.08 * NM.cos(2 * TWO_PI * u);
        var tap = s * w;
        gain += tap;
        var src = i0 + k;
        if (src < 0) src = 0; else if (src >= n) src = n - 1;
        accL += tap * inL[src];
        if (stereo) accR += tap * inR[src];
      }
      /* gain can only be zero for a degenerate window; guard it rather
         than emit NaN, because silence is a legal input everywhere here */
      if (gain === 0) gain = 1;
      outL[j] = accL / gain;
      outR[j] = stereo ? accR / gain : outL[j];
    }
    return { L: outL, R: outR, fs: fsOut, ratio: ratio,
             taps: W, converted: true };
  }

  /* What a loader actually wants: hand it a file's rate and the session's
     rate and get back audio that belongs in the session, plus a sentence
     it can put on screen. The sentence matters — a silent conversion is
     how somebody masters at the wrong rate for an hour. */
  function conformToRate(inL, inR, fsIn, fsSession) {
    var r = resample(inL, inR, fsIn, fsSession, RS_Q);
    var note;
    if (!isFinite(fsIn) || fsIn <= 0) note = 'unknown source rate — nothing loaded';
    else if (!r.converted) note = 'source is already at ' + fsSession + ' Hz';
    else note = 'converted ' + fsIn + ' Hz → ' + fsSession + ' Hz (' +
                (r.ratio > 1 ? 'up' : 'down') + ', ' + r.taps + '-tap sinc' +
                (r.ratio < 1 ? ', anti-aliased at ' + Math.round(fsSession / 2) + ' Hz' : '') + ')';
    r.note = note;
    return r;
  }

  /* ---------- offline analysis helpers ----------
     These exist because an offline render has no real-time deadline, so
     it can afford to render the same audio several times and pick the
     best answer. Nothing here runs on the audio thread. */

  /* Render a buffer through a state and return the output plus meters.
     Latency-compensated: the result lines up sample-for-sample with the
     source, which is what makes an A/B in a DAW mean anything. */
  /* METER EXACTLY WHAT IS RETURNED.
     For four rounds every LUFS this project reported was measured over
     renderOffline's PADDED buffer — the returned audio with `lat` samples
     of leading silence stapled to the front. The audio was right; the
     number was the loudness of a slightly different recording.

     It survived so long because it is identical everywhere. Every render
     pads, every meter reads the padded thing, so every comparison between
     two of our own numbers is correct and the bias cancels. It became
     visible only when album mode metered the same audio twice with the pad
     sitting in two different places: a one-track album's offset from
     itself came out as −1.37e-3 LU instead of the zero it must be.

     Why leading silence moves the number at all, since silence is gated
     out: BS.1770 integrates 400 ms blocks built from 100 ms sub-blocks,
     and `lat` samples of silence SHIFT EVERY BLOCK BOUNDARY relative to
     the music. Different boundaries mean different block energies, a
     different set of blocks surviving the relative gate, and a different
     final partial block. The magnitude is small; the mechanism is not
     subtle once you look at it.

     The fix is a second pass with a fresh meter over the exact samples the
     caller receives. It costs one more walk of the buffer, which an
     offline render can plainly afford, and it makes the reported figure a
     statement about the returned audio rather than about scaffolding.
     `grPeak` and `latency` still come from the engine, because those ARE
     properties of the run rather than of the buffer. */
  function meterBuffer(L, R, fs) {
    var mt = makeMeter(fs), i, n = L.length;
    for (i = 0; i < n; i++) mt.push(L[i], R[i]);
    return mt.read();
  }

  function renderOffline(state, inL, inR, fs) {
    var st = sanitizeState(state);
    var lat = latencySamples(st, fs), n = inL.length, N = n + lat, i;
    var dL = new Float64Array(N), dR = new Float64Array(N);
    for (i = 0; i < n; i++) { dL[i] = inL[i]; dR[i] = inR[i]; }
    var e = createEngine(fs);
    e.setState(st);
    var oL = new Float64Array(N), oR = new Float64Array(N);
    e.process(dL, dR, oL, oR);
    var outL = oL.subarray(lat, lat + n), outR = oR.subarray(lat, lat + n);
    var m = meterBuffer(outL, outR, fs);
    /* the two figures that belong to the RUN, not to the buffer */
    var eng = e.meters();
    m.gr = eng.gr; m.grPeak = eng.grPeak; m.latency = lat;
    return { L: outL, R: outR, meters: m, latency: lat };
  }

  /* LOUDNESS-TARGET AUTO-DRIVE.
     Bisection on drive, because loudness is monotone in drive but NOT
     linear in it: past the point where the limiter starts working, adding
     6 dB of drive buys far less than 6 LU. A single measure-and-offset
     step therefore overshoots badly on dense material, and bisection does
     not care about the shape of the curve, only that it rises.
     Deterministic — same input, same answer, every time. */
  /* THE SECOND ESTIMATE-AND-CLAIM BUG, found by auditing autoMargin's
     sibling. The bisection was honest — every `lufs` it tracked came from a
     real render — but it reported the figure measured at a RAW bisection
     midpoint, and the browser then did `state.drive = Math.round(r.drive*10)/10`
     before applying it. So the number shown to the user was the loudness of a
     drive setting that was never the drive setting in force. Small (the grid
     is 0.1 dB) but exactly the same shape as autoMargin: a figure reported
     for a state nobody rendered.
     It also never said whether it had SUCCEEDED. On material the limiter is
     already flattening, loudness barely moves with drive, and the target can
     be unreachable — the old return value looked identical either way.

     So: quantise FIRST to the grid the caller will really use, then render
     once more at that exact value, and report only what that render measured.
     `reached` is a statement about that measurement. */
  /* QUANTISE A CONTROL TO ITS GRID.
     Named, exported and parity-gated because it is the one expression the
     core and the browser and the C++ twin must all agree on exactly, and
     because the two obvious spellings are NOT the same function:

       Math.round(x / 0.1) * 0.1   and   Math.round(x * 10) / 10

     disagree at exact halves — 0.35 becomes 0.3 by the first and 0.4 by
     the second — and they disagree in the last bits far more often than
     that (-9.75 gives -9.700000000000001 versus -9.7). Bisection midpoints
     over a 36 dB range are dyadic and land on exact halves regularly, so
     this is not a hypothetical.
     A mutation test proved the parity gate could not see the difference
     while the expression was inline: swapping one form for the other in
     the C++ twin passed 22,848 checks. Giving it a name is what made it
     gateable. */
  function quantize(x, grid) {
    var g = (isFinite(grid) && grid > 0) ? grid : 0.1;
    var inv = 1 / g;
    return Math.round(x * inv) / inv;
  }

  /* CANONICALISE THE BISECTION BRANCH — added 2026-08-18, LAW-5 shape.
     -O3 on the C++ twin can reorder the summation inside renderOffline's
     LUFS gate (auto-vectorisation; legal even under -ffp-contract=off,
     which only forbids FMA fusion) and return a `got` that differs from
     -O0/-O2 by about one ulp. Harmless on its own, but autoDrive is a
     BISECTION: one flipped branch early in the search sends every later
     probe into a different half of the 36 dB range, and the two builds can
     converge on genuinely different grid points (measured up to 2.25 dB
     apart on CI). Same shape as the defence already proven in
     underworld/calibrate.js, which hardened its search variable onto a
     grid. Here the search variable (LUFS) is the output of a full render
     and cannot be put on a grid, so instead the COMPARISON is desensitised:
     round to 1e-9 LU before branching — nine orders of magnitude coarser
     than compiler-reordering noise (~1e-15 relative) and eight orders
     tighter than the 0.1 LU this function already calls "reached". Applied
     only where it decides direction; the returned lufs/error stay exact.

     CORRECTED 2026-08-21, AFTER THE FIRST CI RUN ON x86-64. Two claims above
     are now known to be wrong, and this fix did not hold.

     (1) "compiler-reordering noise (~1e-15 relative)". CI's own -O3 log
         reports residuals of 19,212 and 34,148 ulp, i.e. ~1e-11 relative.
         canon9's margin over the real noise floor is therefore about 30x,
         not the 1e6x this paragraph claims.
     (2) "auto-vectorisation reordering the summation". `g++ -O3 -Q
         --help=optimizers` reports -fassociative-math DISABLED at -O3, and
         GCC will not reassociate a floating-point reduction without it. So
         the named mechanism cannot be what happens. The cause is UNMEASURED.

     What IS measured (tests/autodrive_probe.cpp reproduces it): the -O3
     twin's reported lufs for [noise][pine], [noise][lead] and [sine][pine]
     are, to all 17 digits, the LUFS at drive exactly -9.75 — the last
     bisection midpoint, unquantised. quantize(-9.75, 0.1) returns -9.7 in
     both twins, so a merely flipped branch cannot produce it: a flipped
     branch still goes through the quantiser. Injecting BOTH a dead lo-rail
     probe AND a skipped quantise into this file reproduces all three values
     bit-exactly. So there are at least two faults, not one.

     Keep canon9 — desensitising a branch is still right — but do not read
     it as the fix, and do not read the paragraph above as a diagnosis. */
  function canon9(x) { return Math.round(x * 1e9) / 1e9; }

  function autoDrive(state, inL, inR, fs, targetLufs, iters, step) {
    var lo = -12, hi = 24, best = null;
    var passes = iters || 9;
    /* inv rather than dividing by the grid: Math.round(x/0.1)*0.1 and
       Math.round(x*10)/10 disagree at exact halves (0.35 → 0.3 vs 0.4).
       The browser uses the *10/10 form, so the core must too, or the two
       quantise to different values and the whole point is lost. */
    var grid = (isFinite(step) && step > 0) ? step : 0.1;
    var inv = 1 / grid;
    var targetC = canon9(targetLufs);

    /* ONE RENDER PATH. Mirrors the C++ twin, changed 2026-08-23.
       This returned only `integrated`, and the verification pass at the end
       of the function was a SEPARATE inlined copy of these four lines. In
       JavaScript that duplicate is harmless, because nothing here reorders
       or elides a call. In the C++ twin at -O3 on x86-64 it returned the
       PREVIOUS render's meters, so autoDrive reported the LUFS of whatever
       midpoint it happened to probe last while correctly reporting the
       drive it had chosen. Three handoffs recorded that `drive` never
       mismatches while lufs, truePeak and error always do, and filed it as
       a curiosity; it was the whole answer.

       Mirrored here even though JS cannot exhibit the fault, because this
       file is the TRUTH the twin is measured against, and leaving the
       reference implementation carrying the shape that broke its twin is
       how somebody ports the bug into a third language later. */
    function renderAt(d) {
      var s = sanitizeState(state);
      s.drive = d;
      s.unity = false;              // unity would defeat the measurement
      return renderOffline(s, inL, inR, fs).meters;
    }
    function lufsAt(d) { return renderAt(d).integrated; }
    function consider(d, got) {
      if (!isFinite(got)) return;
      if (best === null || Math.abs(canon9(got) - targetC) < Math.abs(canon9(best.lufs) - targetC)) {
        best = { drive: d, lufs: got };
      }
    }
    /* PROBE THE RAILS FIRST. Bisection computes midpoints and therefore
       NEVER evaluates its own endpoints — after eight halvings toward the
       floor the closest probe is -11.86, not -12. So whenever the honest
       answer is "as far as this control goes", the old code returned a
       value short of the rail and quietly left up to a third of a dB
       unused. Two extra renders buy the boundary, and boundary values are
       where everything in this suite breaks. */
    consider(lo, lufsAt(lo));
    consider(hi, lufsAt(hi));

    for (var k = 0; k < passes; k++) {
      var mid = (lo + hi) / 2;
      var got = lufsAt(mid);
      if (!isFinite(got)) { lo = mid; continue; }
      consider(mid, got);
      if (canon9(got) < targetC) lo = mid; else hi = mid;
    }
    /* nothing measurable at any drive — silence, or so quiet the gate never
       opens. Say so; do not invent a drive. */
    if (best === null) {
      return { drive: 0, lufs: -Infinity, truePeak: -Infinity, gr: 0,
               target: targetLufs, error: Infinity, reached: false, grid: grid };
    }
    var drive = clamp(quantize(best.drive, grid), -12, 24);
    /* THE VERIFICATION PASS. Everything returned below comes from this
       render and no other. */
    var v = renderAt(drive);
    var err = isFinite(v.integrated) ? v.integrated - targetLufs : Infinity;
    return {
      drive: drive,                 // already on the grid; callers must not re-round
      lufs: v.integrated,           // MEASURED at exactly that drive
      truePeak: v.truePeakDb,
      gr: v.grPeak,
      target: targetLufs,
      error: err,
      /* quantising to the grid costs up to half a step of drive, and
         bisection over 36 dB in 9 passes resolves to ~0.07 dB. 0.1 LU is
         therefore the honest floor, and anything worse means the target is
         genuinely out of reach on this material. */
      reached: isFinite(err) && Math.abs(err) <= 0.1,
      grid: grid
    };
  }

  /* THE DIFFERENCE. Render the same source through two arrangements and
     return what changed — so an arrangement can be HEARD rather than
     inferred from a description. Both renders are latency-compensated
     first, so the subtraction is meaningful even when the two states have
     different latencies (sealed vs unsealed differ by DEC_Q). */
  function difference(stateA, stateB, inL, inR, fs) {
    var a = renderOffline(stateA, inL, inR, fs);
    var b = renderOffline(stateB, inL, inR, fs);
    var n = inL.length, dL = new Float64Array(n), dR = new Float64Array(n), i;
    var peak = 0, sum = 0;
    for (i = 0; i < n; i++) {
      dL[i] = a.L[i] - b.L[i];
      dR[i] = a.R[i] - b.R[i];
      var m = Math.abs(dL[i]); if (m > peak) peak = m;
      m = Math.abs(dR[i]); if (m > peak) peak = m;
      sum += dL[i] * dL[i] + dR[i] * dR[i];
    }
    return { L: dL, R: dR,
             peakDb: ND.linToDb(peak),
             rmsDb: ND.linToDb(Math.sqrt(sum / (2 * n))),
             identical: peak === 0,
             latencyA: a.latency, latencyB: b.latency };
  }

  /* THE WAKE — viewing the body beside the living, at matched light.
     ===================================================================
     A PROTOTYPE, and deliberately a measurement rather than a mode. It
     reports; nothing here changes what CASKET renders.

     WHY IT EXISTS. Unity already compensates for drive: it trims the
     output by exactly the gain you put in, so an A/B is not decided by
     whichever side is louder. That is arithmetic, and arithmetic is not
     the whole story. Unity gives back the drive, but the LIMITER has also
     taken something — every decibel of gain reduction it applied is
     loudness that never comes back — so at the moment the limiter is
     working hardest, which is exactly the moment you most want to judge
     it, the processed side still plays quieter than the bypassed one. A
     listener hears the quieter side as the worse one and reaches the
     wrong verdict about the software. That happened, to the person who
     wrote it, on 2026-08-23.

     WHAT IT MEASURES. Render both sides, measure both, and report the
     trim that would make them equally loud — plus, and this is the part
     worth having, what that trim would COST if anyone were ever tempted
     to apply it to the processed side: the true peak it lands on, and
     whether that clears the lid.

     WHY IT CANNOT SIMPLY BE APPLIED. The answer is almost always no, and
     the reason is a law rather than a preference: the lid is a theorem,
     and nothing with gain may follow CASKET (AUDIO_INTERCHANGE §5). The
     honest form of loudness-matching is therefore to attenuate the
     BYPASSED side down to the processed one, never to lift the processed
     side into its own ceiling. `matchOnBypass` is that number, and it is
     the one a monitoring path should use.

     Browser-only, like matchReference and for the same reason: it renders
     twice and is never on an audio thread. Registered as DIAGNOSTIC_ONLY
     in casket_plugin_test.js. */
  function wake(state, inL, inR, fs) {
    var st = sanitizeState(state);
    var live = renderOffline(st, inL, inR, fs);
    /* the body untouched — bypass is the delayed input, bit-exact */
    var b = sanitizeState(state);
    b.bypass = true;
    var dead = renderOffline(b, inL, inR, fs);

    var lufsLive = live.meters.integrated, lufsDead = dead.meters.integrated;
    var gap = lufsDead - lufsLive;           /* > 0 means the processed side is quieter */
    var lid = st.lid + st.margin;

    /* what lifting the processed side would land on, measured rather than
       predicted: scale the render and re-measure its true peak through the
       same reconstruction the lid is defined against. */
    var over = NaN, peakAfter = NaN;
    if (isFinite(gap)) {
      var g = ND.dbToLin(gap), n = live.L.length, i;
      var sL = new Float64Array(n), sR = new Float64Array(n);
      for (i = 0; i < n; i++) { sL[i] = live.L[i] * g; sR[i] = live.R[i] * g; }
      /* truePeakOf takes ONE buffer and an oversampling factor, not a
         stereo pair — measure each side and take the worse. 16x by
         default, deliberately a longer reconstruction than the engine's
         own detector, exactly as autoMargin does. */
      peakAfter = ND.linToDb(Math.max(truePeakOf(sL), truePeakOf(sR)));
      over = peakAfter - lid;
    }

    return {
      liveLufs: lufsLive,
      bypassLufs: lufsDead,
      /* the trim that matches them. Positive = the processed side is
         quieter by this much. */
      gapDb: gap,
      /* the number a monitoring path should actually use: attenuate the
         BYPASSED side by this, and no gain follows the lid. */
      matchOnBypass: isFinite(gap) ? -gap : NaN,
      unityWasOn: !!st.unity,
      /* and the reason not to do it the other way round */
      truePeakIfLifted: peakAfter,
      liftClearsLid: isFinite(over) ? over <= 0 : true,
      lidDb: lid
    };
  }

  /* AUTO-MARGIN. Lead ships a fixed -0.3 dB margin, chosen because it
     covers the true-peak residual on most material. But the residual is a
     property of the MATERIAL, not of the limiter — §6.3 measures it from
     +0.000 dB on harmonic content to +1.19 dB on full-band clipped noise.
     Offline there is no reason to guess: render once with no margin,
     measure the true peak the render actually produced, and report the
     margin that would have covered it. Reports rather than applies, for
     the same reason matchReference does. */
  function autoMargin(state, inL, inR, fs, passes) {
    var probe = sanitizeState(state);
    /* measure with a longer, independent reconstruction than the live
       meter uses, so this is a check rather than the same code marking
       its own work */
    function peakAt(margin) {
      var p = sanitizeState(state);
      p.margin = margin;
      var r = renderOffline(p, inL, inR, fs);
      var a = ND.linToDb(truePeakOf(r.L, 16, 64));
      var b = ND.linToDb(truePeakOf(r.R, 16, 64));
      return a > b ? a : b;
    }
    /* THE FIRST VERSION ESTIMATED AND CLAIMED. It rendered once at margin
       0, measured the overshoot, and returned -overshoot as the answer —
       which assumes the residual shrinks one-for-one with the margin. It
       does not: lowering the threshold changes WHERE the limiter engages,
       so the gain trajectory changes and the true peak moves nonlinearly.
       The offline-tools fuzzer caught it saying "covered" on a render that
       was still 0.554 dB over.
       Now it ITERATES and then VERIFIES, and `covered` means "I re-rendered
       with this margin and checked", not "I estimated and it ought to
       work". An offline tool has the time; there is no excuse for guessing. */
    var tp0 = peakAt(0);
    var lid = probe.lid;
    var margin = 0, tp = tp0;
    var n = passes || 4;
    for (var k = 0; k < n; k++) {
      var over = tp - lid;
      if (over <= 0) break;
      /* step by the observed overshoot, rounded to a value a human would
         type, and never rounded toward the unsafe side */
      var step = Math.ceil(over / 0.05) * 0.05;
      var next = clamp(margin - step, -1, 0);
      if (next === margin) break;            // at the rail; cannot do more
      margin = next;
      tp = peakAt(margin);
    }
    return {
      truePeak: tp0,             // what it did with no margin at all
      verifiedPeak: tp,          // what it does with the suggestion applied
      lid: lid,
      residual: tp0 - lid,
      margin: margin,
      /* VERIFIED, not predicted */
      covered: tp <= lid + 1e-6
    };
  }

  /* ---------- BATCH AND ALBUM ----------
     A limiter that can only see one file at a time is a track tool. What
     makes it a mastering tool is being able to hold a whole record in
     view at once. */

  /* BATCH. The same arrangement across many files, with each file's own
     numbers reported so the outliers are visible. Deliberately applies
     ONE state to everything: the point of a batch is consistency, and a
     tool that quietly retunes itself per file is not giving you that. */
  /* BATCH. Every track through one setting.

     TWO THINGS A RECORD NEEDS THAT A TRACK DOES NOT, and they turn out to
     be the same thing viewed twice.

     · GAPLESS. A live album, a DJ set, a record whose songs run into each
       other. Rendered a track at a time, every join gets a fresh engine:
       the release envelope restarts from rest, the lookahead line starts
       empty, and the limiter spends the first few milliseconds of every
       track deciding what to do about audio it has not been shown. On a
       crossfade that is a level step exactly where a level step is most
       audible, because the material either side of it is continuous.
       `gapless: true` renders the whole record through ONE engine and
       cuts the result back into tracks afterwards, so the state crosses
       every join the way the music does.

     · DITHER ACROSS A RECORD. Nobody had asked what the right policy is,
       so here are the three and why the default is what it is:
         'same'       — one seed, so every track carries the IDENTICAL
                        noise print. Reproducible, and wrong: it is the
                        same non-random noise stamped eleven times.
         'perTrack'   — seed derived from the base seed and the track
                        index. Each track its own noise, still fully
                        deterministic. THE DEFAULT, because a track is a
                        file and a file should carry its own dither.
         'continuous' — one unbroken dither stream across the record.
       And the interlock: GAPLESS FORCES CONTINUOUS. At 16 bits the noise
       floor is audible in a quiet passage, and restarting the generator
       at a join you have just gone to the trouble of making seamless puts
       a seam back in the one layer nobody thought to look at. The code
       does not offer the combination; it overrides it, and says so in the
       returned `dust` field. */
  function batchRender(state, tracks, fs, opts) {
    opts = opts || {};
    var st = sanitizeState(state);
    var gapless = !!opts.gapless;
    var policy = opts.dust === 'same' ? 'same'
               : opts.dust === 'continuous' ? 'continuous'
               : 'perTrack';
    if (gapless) policy = 'continuous';
    var i, out = [];

    if (gapless) {
      /* ONE ENGINE, ONE PASS. The latency is compensated once for the
         whole record rather than once per track, which is also the only
         way the joins can stay sample-accurate: per-track compensation
         would trim `lat` samples out of the middle of the music. */
      var total = 0;
      for (i = 0; i < tracks.length; i++) total += tracks[i].L.length;
      var aL = new Float64Array(total), aR = new Float64Array(total), p = 0;
      for (i = 0; i < tracks.length; i++) {
        aL.set(tracks[i].L, p); aR.set(tracks[i].R, p);
        p += tracks[i].L.length;
      }
      var whole = renderOffline(st, aL, aR, fs);
      p = 0;
      for (i = 0; i < tracks.length; i++) {
        var len = tracks[i].L.length;
        /* copy rather than subarray: a caller who writes a file per track
           should not be holding eleven views into one buffer the size of
           the record */
        var cl = new Float64Array(len), cr = new Float64Array(len);
        cl.set(whole.L.subarray(p, p + len));
        cr.set(whole.R.subarray(p, p + len));
        var mm = meterBuffer(cl, cr, fs);
        out.push({
          name: tracks[i].name || ('track ' + (i + 1)),
          L: cl, R: cr, latency: whole.latency,
          lufs: mm.integrated, lra: mm.lra,
          truePeak: mm.truePeakDb, samplePeak: mm.peakDb,
          gr: whole.meters.grPeak      /* the record's, not the track's */
        });
        p += len;
      }
      return { state: st, tracks: out, gapless: true, dust: policy,
               album: { integrated: whole.meters.integrated,
                        lra: whole.meters.lra,
                        truePeak: whole.meters.truePeakDb,
                        samples: total } };
    }

    for (i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      var ts = st;
      if (policy !== 'same') {
        ts = sanitizeState(st);
        /* keep it inside Park–Miller's legal range: 1 .. 2^31−2 */
        ts.dustSeed = 1 + ((st.dustSeed + i * 2654435761) % 2147483646);
      }
      var r = renderOffline(ts, t.L, t.R, fs);
      out.push({
        name: t.name || ('track ' + (i + 1)),
        L: r.L, R: r.R, latency: r.latency,
        lufs: r.meters.integrated,
        lra: r.meters.lra,
        truePeak: r.meters.truePeakDb,
        samplePeak: r.meters.peakDb,
        gr: r.meters.grPeak
      });
    }
    return { state: st, tracks: out, gapless: false, dust: policy };
  }

  /* ALBUM. One target for the whole record.

     THE DECISION THAT MATTERS, and it is a musical one rather than a
     technical one: this finds a SINGLE drive for every track, not a
     per-track drive. Normalising each track to the same LUFS flattens the
     record — the quiet song stops being the quiet song, and the running
     order stops meaning anything. Album normalisation moves the whole
     thing by one amount and preserves every relationship inside it. This
     is also how streaming services compute album loudness, so matching
     that behaviour is the honest default.

     The album's own loudness is the GATED measure across all tracks
     together, not the mean of the per-track figures — those are different
     numbers, and averaging LUFS values is meaningless because they are
     logarithmic. Concatenating and metering once is what the standard
     actually asks for. (The joins add a sample-level discontinuity, which
     can nudge the true peak but is far below the gate's resolution for
     loudness, so it does not move the number this is solving for.) */
  function albumLoudness(rendered, fs) {
    var total = 0, i;
    for (i = 0; i < rendered.length; i++) total += rendered[i].L.length;
    var aL = new Float64Array(total), aR = new Float64Array(total), p = 0;
    for (i = 0; i < rendered.length; i++) {
      var t = rendered[i];
      aL.set(t.L, p); aR.set(t.R, p);
      p += t.L.length;
    }
    /* METER, DO NOT RENDER. This used to push the entire concatenated
       record through a BYPASSED engine purely to read its meters — a full
       album-length pass through the delay lines, the oversampler and the
       gain path, all of it discarded. Bypass is bit-identical to its input
       (verified: 0 of 96,000 samples differ), so the render was provably
       doing nothing except taking time. albumMaster calls this once per
       bisection step, so removing it halves the cost of mastering a
       record. */
    var m = meterBuffer(aL, aR, fs);
    return { integrated: m.integrated, lra: m.lra, truePeak: m.truePeakDb,
             samples: total };
  }

  function albumMaster(state, tracks, fs, targetLufs, opts) {
    opts = opts || {};
    var grid = (isFinite(opts.step) && opts.step > 0) ? opts.step : 0.1;
    var inv = 1 / grid;
    var passes = opts.passes || 8;

    /* the batch options travel with the search, or the record you AUDITION
       is not the record you MEASURED — the drive would be chosen against a
       gapped render and then applied to a gapless one */
    var bopts = { gapless: !!opts.gapless, dust: opts.dust };

    function atDrive(d) {
      var st = sanitizeState(state);
      st.drive = d;
      st.unity = false;
      var b = batchRender(st, tracks, fs, bopts);
      /* gapless already metered the record in one piece, which is the same
         thing albumLoudness would recompute — and cheaper by a full pass */
      return { batch: b, album: b.album || albumLoudness(b.tracks, fs) };
    }

    /* ---- THE PROXY ----
       A forty-minute record is over twenty hours of audio through the
       limiter per invocation, because every bisection step renders the
       whole thing. But the SEARCH does not need the whole thing: it needs
       a signal whose loudness-versus-drive curve has the same shape. A
       representative slice has that, and it is a hundredth of the size.

       So: bisect on the proxy to get close, then bracket the answer
       narrowly and finish at FULL rate, then verify at full rate. The
       verification contract is untouched — every figure returned is still
       measured on the entire record at the drive returned — but the
       expensive passes drop from eleven to about six.

       The proxy is the CENTRE of each track, not the head: heads are
       fade-ins, count-ins and silence, and a proxy built from them
       measures quieter than the record and biases the drive upward. */
    function proxyOf() {
      var budget = Math.floor(fs * (opts.proxySeconds || 24));
      var totalLen = 0, i;
      for (i = 0; i < tracks.length; i++) totalLen += tracks[i].L.length;
      if (totalLen <= budget) return null;         // short record: no proxy needed
      var per = Math.floor(budget / tracks.length);
      /* never shorter than a gated block, or the proxy measures -Infinity
         and the search has nothing to bisect on */
      var minLen = Math.floor(fs * 0.5);
      if (per < minLen) per = minLen;
      var out = [];
      for (i = 0; i < tracks.length; i++) {
        var n = tracks[i].L.length;
        var take = per > n ? n : per;
        var start = Math.floor((n - take) / 2);
        var cl = new Float64Array(take), cr = new Float64Array(take);
        cl.set(tracks[i].L.subarray(start, start + take));
        cr.set(tracks[i].R.subarray(start, start + take));
        out.push({ name: tracks[i].name, L: cl, R: cr });
      }
      return out;
    }

    function atDriveOn(trks, d) {
      var st = sanitizeState(state);
      st.drive = d;
      st.unity = false;
      var b = batchRender(st, trks, fs, bopts);
      return b.album || albumLoudness(b.tracks, fs);
    }

    var proxy = opts.proxy === false ? null : proxyOf();
    var lo = -12, hi = 24, best = null;
    function consider(d, got) {
      if (!isFinite(got)) return;
      if (best === null || Math.abs(got - targetLufs) < Math.abs(best.lufs - targetLufs)) {
        best = { drive: d, lufs: got };
      }
    }
    /* the rails, for the same reason autoDrive probes them: a record
       already louder than the target needs the floor, and bisection never
       visits its own endpoints */
    var searchOn = proxy || tracks, k, mid, got;
    consider(lo, atDriveOn(searchOn, lo).integrated);
    consider(hi, atDriveOn(searchOn, hi).integrated);
    for (k = 0; k < passes; k++) {
      mid = (lo + hi) / 2;
      got = atDriveOn(searchOn, mid).integrated;
      if (!isFinite(got)) { lo = mid; continue; }
      consider(mid, got);
      if (got < targetLufs) lo = mid; else hi = mid;
    }

    /* REFINE AT FULL RATE. The proxy got us close; it cannot be trusted
       for the last fraction of a dB because the material it left out has
       its own peaks. Re-bisect the WHOLE record inside a narrow bracket
       around the proxy's answer, discarding the proxy's `best` entirely —
       a figure measured on part of a record has no business being reported
       as the record's. */
    if (proxy && best !== null) {
      /* THE FUZZER CAUGHT THE FIRST VERSION OF THIS ON ITS THIRD STATE.
         It bracketed the proxy's answer by a fixed +/-1.5 dB and refined
         inside it, which quietly assumed two things that are not true:
         that the proxy is within 1.5 dB of the right answer, and that a
         3 dB bracket refined three times resolves as finely as a 36 dB
         range bisected eight times. Neither holds — the fuzzer found
         7.1 against 6.0, and 3.0 against 1.5 — and the result was a
         cheaper search that returned a DIFFERENT drive. A cheaper answer
         that differs is not a cheaper answer, it is a wrong one.

         Loudness is monotone in drive, so a bracket is provably correct
         when the target lies between its endpoints. Expand until that
         holds (or a rail stops us), THEN bisect. Usually zero expansions,
         because the proxy really is close; correctness no longer depends
         on it being close. */
      var centre = best.drive, halfW = 1.5, ex;
      lo = centre - halfW; if (lo < -12) lo = -12;
      hi = centre + halfW; if (hi > 24) hi = 24;
      var loV = atDriveOn(tracks, lo).integrated;
      var hiV = atDriveOn(tracks, hi).integrated;
      for (ex = 0; ex < 4; ex++) {
        var below = !isFinite(loV) || loV <= targetLufs;
        var above = isFinite(hiV) && hiV >= targetLufs;
        if (below && above) break;                 // the target is inside
        if (!below && lo > -12) {                  // whole bracket too loud
          halfW *= 2;
          hi = lo; hiV = loV;
          lo = centre - halfW; if (lo < -12) lo = -12;
          loV = atDriveOn(tracks, lo).integrated;
        } else if (!above && hi < 24) {            // whole bracket too quiet
          halfW *= 2;
          lo = hi; loV = hiV;
          hi = centre + halfW; if (hi > 24) hi = 24;
          hiV = atDriveOn(tracks, hi).integrated;
        } else break;                              // pinned at a rail; this is the answer
      }
      /* discard the proxy's `best` entirely — a figure measured on part of
         a record has no business being reported as the record's */
      best = null;
      consider(lo, loV);
      consider(hi, hiV);
      /* enough passes that the bracket resolves at least as finely as the
         full search it replaces: 36/2^passes >= width/2^k */
      var need = passes - 2; if (need < 3) need = 3;
      for (k = 0; k < need; k++) {
        mid = (lo + hi) / 2;
        got = atDriveOn(tracks, mid).integrated;
        if (!isFinite(got)) { lo = mid; continue; }
        consider(mid, got);
        if (got < targetLufs) lo = mid; else hi = mid;
      }
    }
    if (best === null) {
      return { drive: 0, album: null, tracks: [], target: targetLufs,
               error: Infinity, reached: false, grid: grid };
    }
    /* quantise, THEN verify — the same contract autoDrive and autoMargin
       now hold to. Everything below is measured at the drive returned. */
    var drive = clamp(quantize(best.drive, grid), -12, 24);
    var v = atDrive(drive);
    var err = isFinite(v.album.integrated) ? v.album.integrated - targetLufs : Infinity;

    /* per-track offsets from the album figure: this is the table that
       tells you whether the record hangs together, and it is the reason
       to do this in one pass rather than one file at a time */
    var rows = [], i;
    for (i = 0; i < v.batch.tracks.length; i++) {
      var t = v.batch.tracks[i];
      rows.push({
        name: t.name,
        lufs: t.lufs,
        offset: (isFinite(t.lufs) && isFinite(v.album.integrated))
                  ? t.lufs - v.album.integrated : null,
        lra: t.lra, truePeak: t.truePeak, gr: t.gr,
        L: t.L, R: t.R, latency: t.latency
      });
    }
    return {
      drive: drive,
      album: v.album,
      tracks: rows,
      target: targetLufs,
      error: err,
      reached: isFinite(err) && Math.abs(err) <= 0.1,
      grid: grid,
      gapless: !!v.batch.gapless,
      dust: v.batch.dust
    };
  }

  /* THE ALBUM REPORT.
     A mastering session ends with somebody having to say what was done.
     The per-track table exists in memory the moment albumMaster returns
     and then evaporates, so this turns it into a file you can hand to a
     client or keep with the session.

     Plain text on purpose. It has to survive email, a print-out, a text
     field in a delivery portal and being pasted into a message — and it
     has to still be readable in five years by someone who does not have
     this program. A JSON blob or an HTML page fails at least two of
     those. Fixed-width columns, no dependencies, no styling.

     Every figure here is one the harness has already checked. This
     function formats; it does not compute, and it must not, because a
     report that does its own arithmetic is a second implementation that
     can disagree with the first. The single exception is the delta
     column, which is a subtraction of two numbers printed beside it. */
  function albumReport(res, opts) {
    opts = opts || {};
    var title = opts.title || 'UNTITLED RECORD';
    var fs = opts.fs;
    var L = [];
    function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + Array(n - s.length + 1).join(' '); }
    function rp(s, n) { s = String(s); return s.length >= n ? s : Array(n - s.length + 1).join(' ') + s; }
    function num(v, d) { return (v === null || v === undefined || !isFinite(v)) ? '—' : v.toFixed(d); }

    L.push('CASKET — ALBUM REPORT');
    L.push('nothing gets out.');
    L.push('');
    L.push(title);
    L.push(Array(Math.max(title.length, 21) + 1).join('='));
    L.push('');

    var st = res.state || {};
    L.push('ARRANGEMENT   ' + (st.style || '—') +
           (st.seal ? ' (sealed)' : '') +
           '   lid ' + num(st.lid, 2) + ' dBTP' +
           (st.margin ? '   margin ' + num(st.margin, 2) + ' dB' : ''));
    L.push('DRIVE         ' + num(res.drive, 2) + ' dB, chosen on a ' +
           num(res.grid, 2) + ' dB grid');
    L.push('TARGET        ' + num(res.target, 1) + ' LUFS' +
           (res.reached ? '  — reached' : '  — NOT REACHED, off by ' + num(res.error, 2) + ' LU'));
    L.push('JOINS         ' + (res.gapless ? 'gapless — one engine across the whole record'
                                           : 'gapped — each track rendered on its own'));
    L.push('DUST          ' + (st.dust && st.dust !== 'off'
             ? st.dust + ' at ' + st.dustBits + '-bit, ' + (res.dust || 'perTrack') + ' seeding'
             : 'off'));
    if (isFinite(fs)) L.push('RATE          ' + fs + ' Hz');
    L.push('');

    var a = res.album || {};
    L.push('THE RECORD');
    L.push('  integrated   ' + num(a.integrated, 2) + ' LUFS   (gated across every track at once,');
    L.push('                              not the mean of the rows below — LUFS is a logarithm)');
    L.push('  range        ' + num(a.lra, 2) + ' LU');
    L.push('  true peak    ' + num(a.truePeak, 2) + ' dBTP');
    if (isFinite(a.samples) && isFinite(fs)) {
      var sec = a.samples / fs;
      var mm = Math.floor(sec / 60), ss = sec - mm * 60;
      L.push('  duration     ' + mm + ':' + (ss < 10 ? '0' : '') + ss.toFixed(1));
    }
    L.push('');

    var rows = res.tracks || [];
    L.push('THE RUNNING ORDER');
    L.push('  ' + pad('#', 3) + pad('TRACK', 26) + rp('LUFS', 9) + rp('Δ ALBUM', 10) +
           rp('LRA', 8) + rp('dBTP', 9) + rp('WEIGHT', 9));
    L.push('  ' + Array(75).join('-'));
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i];
      L.push('  ' + pad(i + 1, 3) + pad(t.name, 26) +
             rp(num(t.lufs, 2), 9) + rp(num(t.offset, 2), 10) +
             rp(num(t.lra, 1), 8) + rp(num(t.truePeak, 2), 9) +
             rp(num(t.gr, 2), 9));
    }
    L.push('');
    /* THE SENTENCE THE TABLE IS FOR. A mastering client does not read a
       column of deltas; they want to know whether the record still has
       its shape. Spread is the thing that answers that. */
    var lo = Infinity, hi = -Infinity, n = 0;
    for (i = 0; i < rows.length; i++) {
      if (!isFinite(rows[i].lufs)) continue;
      if (rows[i].lufs < lo) lo = rows[i].lufs;
      if (rows[i].lufs > hi) hi = rows[i].lufs;
      n++;
    }
    if (n > 1) {
      L.push('SPREAD        ' + num(hi - lo, 2) + ' LU from the loudest track to the quietest.');
      L.push('              One drive was applied to the whole record, so this spread is the');
      L.push('              one the mixes arrived with. It has not been flattened.');
    } else if (n === 1) {
      L.push('SPREAD        a single track has no spread.');
    }
    L.push('');
    L.push('Every figure above was measured on the rendered audio, not predicted from it.');
    return L.join('\n');
  }

  /* REFERENCE MATCHING. Measure a reference, measure your mix, and report
     the gap plus the drive that closes it. Deliberately reports rather
     than applies: the numbers are the useful part, and a mastering tool
     that silently moves your gain is a tool you stop trusting. */
  /* `iters` added 2026-08-19, defaulting to autoDrive's own default so
     every existing caller is bit-for-bit unaffected. It exists because
     matchReference was the single most expensive call in the offline-tools
     fuzzer — 36% of the whole budget, measured — for a reason nobody had
     noticed: it calls autoDrive WITHOUT a pass count, so it silently runs
     the full nine-pass search plus the two rail probes. That is correct for
     a user asking "what drive matches this record", and wasteful for a
     fuzzer asking "does this return a finite number and a sane gap".
     Safe to add: matchReference has no C++ twin (it is browser-only, see
     casket_coverage.js's API_EXEMPT) and appears zero times in
     parity_emit.js and core_parity.cpp, so no blessed value can move. */
  function matchReference(state, inL, inR, refL, refR, fs, iters) {
    /* Two bypassed renders used to live here for the same bad reason
       albumLoudness had one: measuring an UNPROCESSED buffer needs a
       meter, not an engine. */
    var mine = meterBuffer(inL, inR, fs);
    var theirs = meterBuffer(refL, refR, fs);
    var target = theirs.integrated;
    var found = isFinite(target) ? autoDrive(state, inL, inR, fs, target, iters) : null;
    /* Subtracting two dB figures gives NaN when BOTH are -Infinity, which
       is what silence measures. The fuzzer found it by handing the tool
       two silent buffers — a case a person hits by dragging in the wrong
       file. A gap that cannot be computed is reported as null, which the
       caller can render as an em-dash; NaN would print as "NaN dB". */
    function gapOf(a, b) {
      if (!isFinite(a) || !isFinite(b)) return null;
      return a - b;
    }
    return {
      reference: { lufs: theirs.integrated, lra: theirs.lra, truePeak: theirs.truePeakDb },
      mine: { lufs: mine.integrated, lra: mine.lra, truePeak: mine.truePeakDb },
      gap: {
        lufs: gapOf(mine.integrated, theirs.integrated),
        lra: gapOf(mine.lra, theirs.lra),
        truePeak: gapOf(mine.truePeakDb, theirs.truePeakDb)
      },
      suggest: found
    };
  }

  /* ==================================================================
     THE INTAKE — CASKET's side of the CORONER seam
     Added 2026-08-27. JS-only by design; see DIAGNOSTIC_ONLY in
     casket_plugin_test.js and API_EXEMPT in casket_coverage.js.
     ==================================================================

     CORONER listens to a recording and writes down what it found. For
     NECROPHONE and PALLBEARER that report becomes a PATCH, because those
     two recreate the sound. CASKET recreates nothing, it is the lid
     coming down, so the handoff here is a different shape, and getting
     that shape wrong is the whole risk.

     THE DIVISION OF LABOUR, and it is the load-bearing decision:
       CORONER says what the MATERIAL IS.   It has the ears.
       CASKET says what the SETTINGS ARE.   It has the meters.

     Concretely: the drive is not inferred from a crest factor, it is
     MEASURED by autoDrive against a loudness target. The margin is not a
     style default, it is MEASURED by autoMargin on this exact audio, and
     autoMargin re-renders to verify rather than estimating, because the
     offline fuzzer once caught its predecessor calling a render "covered"
     while it was still 0.554 dB over. Both of those tools were already
     here and both already refuse to guess. What CORONER genuinely
     contributes is the one thing no meter can report, namely what KIND of
     thing this is, and that chooses the ARRANGEMENT.

     A NOTE ON THE COUPLING. This takes a plain object and never imports
     CORONER. That is deliberate. A hard dependency would put CASKET's
     suite at the mercy of a file another session is still writing, and
     the seam is meant to be a contract rather than a shared build.
     Anything shaped like a feature vector works, absent fields fall back
     to neutral defaults, and those fallbacks are why a partial report
     degrades instead of throwing.

     WHAT THE INTAKE MUST NOT SET, each with its reason:
       lid              a delivery ceiling is a contract with a platform
                        or a plant, and no amount of listening reveals it
       dust, dustBits,  dither belongs to the OUTPUT FORMAT, never to the
       dustSeed         input material
       ms, msMid,       stereo shaping is an artistic decision; CORONER
       msSide           can report a width, and reporting is where it stops
       hold, link, dc,  session settings, not properties of the audio
       unity, bypass
     `opts.base` carries every one of them through untouched and
     casket_intake.js asserts it field by field. This is §16's rule, that
     an arrangement is a gesture rather than a parameter, extended one
     layer outward: a report is ADVICE, not a session reset.

     THE ARRANGEMENT IS APPLIED WHOLE. Naming a style without applying its
     recipe is precisely the bug Ben's ears found on 2026-08-23, when all
     five arrangements turned out to be Velvet in costume and Lead was
     Lead with its seal switched off. chooseArrangement names a style; the
     eight recipe fields then come out of styleDefaults, which is the
     engine's own table and never a second copy of it.

     LAYER 2 IS DELIBERATELY REPLACEABLE, mirroring CORONER's own
     architecture. chooseArrangement reads a features object and returns
     {style, confidence, evidence}. A better chooser, whether a model or a
     table learned from real masters, replaces that one function and
     nothing else notices. Anything in here that reached back into the raw
     samples to pick a style would destroy that property, which is why the
     chooser is handed features and never buffers.

     DETERMINISM. No Math.random, no clock, no transcendental outside NM.
     The same report and the same audio produce the same state, which is
     what lets a regression baseline exist for this at all. */

  /* Written against CORONER's FEATURE_VERSION 2. A different version is
     REPORTED rather than refused: a limiter that stops working because an
     analysis tool grew a feature is worse than one that says which vector
     it was handed and carries on with neutral defaults. */
  var INTAKE_FEATURE_VERSION = 2;

  /* The features THE INTAKE reads, each with the question it is asked and
     the value assumed when it is absent. A registry rather than inline
     lookups, for the reason CORONER gives for having one of its own: a
     consumer of a versioned vector should be able to ENUMERATE what it
     depends on, so a vector change can be checked against it
     mechanically instead of by somebody reading code. casket_intake.js
     asserts both directions — the chooser reads nothing outside this
     list, and every entry in it is actually read.

     Each default is NEUTRAL rather than typical: it is the value that
     casts no vote, so a missing field cannot quietly swing the choice. */
  var INTAKE_READS = {
    crest:     { def: 12,   asks: 'how far the transients stand above the body' },
    onsetRate: { def: 3,    asks: 'how often the limiter will be asked to act' },
    attack:    { def: 0.02, asks: 'how fast the fastest thing here arrives' },
    sustain:   { def: 0.5,  asks: 'how much of a note is body rather than edge' },
    flatness:  { def: 0.2,  asks: 'noise-like, or tonal' },
    highRatio: { def: 0.06, asks: 'energy up where the inter-sample peaks are made' },
    dur:       { def: 0,    asks: 'how much material there is to judge from' }
  };

  function readFeature(f, id) {
    var n = f ? +f[id] : NaN;
    /* LAW 5: isFinite, never `|| def`. Zero is a legal value for
       onsetRate, highRatio, flatness and sustain alike, and `0 || 3`
       is 3 — a silent, plausible, wrong answer. */
    return isFinite(n) ? n : INTAKE_READS[id].def;
  }

  /* LAYER 2. Reads features, returns an opinion. Replaceable whole. */
  function chooseArrangement(features) {
    var f = features || {};
    var crest = readFeature(f, 'crest');
    var onset = readFeature(f, 'onsetRate');
    var atk   = readFeature(f, 'attack');
    var sus   = readFeature(f, 'sustain');
    var flat  = readFeature(f, 'flatness');
    var high  = readFeature(f, 'highRatio');
    var dur   = readFeature(f, 'dur');

    var score = { pine: 0, velvet: 0, oak: 0, iron: 0, lead: 0 };
    var ev = [];
    /* Additive only, deliberately. A rule that could subtract can drive a
       total negative, and a confidence computed from a negative total
       reads as certainty when it is the opposite. */
    function say(styles, weight, id, value, reads) {
      for (var i = 0; i < styles.length; i++) score[styles[i]] += weight;
      ev.push({ styles: styles.slice(), feature: id, value: value,
                weight: weight, reads: reads });
    }

    /* NO FLOOR, AND THE FIRST DRAFT HAD ONE. Velvet started with a free
       point so that an empty report would land on the same arrangement a
       fresh session does — correct instinct, wrong mechanism. It made
       velvet score 1 against a field of 0, and a confidence computed as
       the margin over the runner-up then read 1.00: MAXIMUM CERTAINTY ON
       ZERO EVIDENCE, which is worse than being wrong because it is wrong
       and convincing. The default now lives in the tie-break below, where
       it decides the answer without pretending to be a reason for it. */

    if (onset > 6) {
      say(['oak', 'iron'], 2, 'onsetRate', onset,
          'onsets arrive faster than a long release can recover from');
    } else if (onset < 1.5) {
      say(['pine', 'velvet'], 2, 'onsetRate', onset,
          'sparse events, so a long release stays out of the way between them');
    }

    if (crest > 14) {
      say(['oak'], 2, 'crest', crest,
          'sharp transients over a quiet body — the short vigil catches them without leaning on the rest');
    } else if (crest < 6) {
      say(['velvet', 'lead'], 1, 'crest', crest,
          'already dense, so there is little left to pump and a slow release costs nothing');
    }

    if (atk < 0.005) {
      say(['iron'], 2, 'attack', atk,
          'percussive onsets — the saturation and the heavier lining are built for exactly this');
    } else if (atk > 0.05) {
      say(['pine'], 2, 'attack', atk,
          'nothing here arrives fast enough to need a short vigil');
    }

    if (sus > 0.7) {
      say(['pine', 'velvet'], 1, 'sustain', sus,
          'held tones rather than events');
    } else if (sus < 0.2) {
      say(['iron', 'oak'], 1, 'sustain', sus,
          'short, damped events');
    }

    /* The two rules that reach for the seal, and both are about the peaks
       BETWEEN the samples rather than on them. §6.3 measures the
       true-peak residual from +0.000 dB on harmonic content to +1.19 dB
       on full-band clipped noise; Lead is the one arrangement that
       controls it, and it pays latency for the privilege. */
    if (high > 0.12) {
      say(['lead'], 3, 'highRatio', high,
          'a lot of air, which is where inter-sample peaks are made — the seal is the only arrangement that controls them');
    }
    if (flat > 0.5) {
      say(['lead'], 2, 'flatness', flat,
          'noise-like and full-band, which is where the true-peak residual is worst');
    }

    var best = 'velvet', top = 0, second = 0;
    /* STYLES, not Object.keys(score), so the iteration order is the
       engine's own declared order rather than an insertion accident. */
    for (var i = 0; i < STYLES.length; i++) {
      var s = STYLES[i], v = score[s];
      if (v > top) { second = top; top = v; best = s; }
      else if (v > second) { second = v; }
    }
    /* THE TIE-BREAK IS THE DEFAULT. On an equal score velvet wins, for
       the same reason sanitizeState defaults to it: a tie is not a reason
       to move somebody off the arrangement a fresh session would give
       them. When nothing scored at all, `top` is 0 and velvet stands. */
    if (score.velvet === top) best = 'velvet';

    /* Margin over the runner-up, not share of the total: a report that
       lit every rule would score high everywhere and mean nothing. And an
       unvoted choice is confidence ZERO, never the 1.00 that a lone
       default point used to buy it. */
    var conf = top > 0 ? clamp((top - second) / top, 0, 1) : 0;
    /* Too little material is a reason to be less sure, and only when the
       duration was actually reported — an absent `dur` is unknown, not
       short, and must not be punished as though it were. */
    if (dur > 0 && dur < 3) conf = conf * (dur / 3);

    /* Evidence ordered heaviest first, so a face can print the top line
       and be printing the reason. Ties keep their discovery order, which
       is what a stable sort gives and what makes this reproducible. */
    ev.sort(function (a, b) { return b.weight - a.weight; });

    return { style: best, confidence: conf, scores: score, evidence: ev };
  }

  /* LAYER 3. Turns the opinion into a state, and measures the two numbers
     that must never be opinions. */
  function intake(report, inL, inR, fs, opts) {
    opts = opts || {};
    var warnings = [];

    /* A whole CORONER report, a bare features object, or nothing at all.
       Three accepted shapes cost one expression and save every caller a
       conditional. */
    var features = (report && typeof report === 'object' && report.features)
                     ? report.features
                     : (report && typeof report === 'object') ? report : {};
    var ver = null;
    if (report && typeof report === 'object') {
      if (isFinite(+report.version)) ver = +report.version;
      else if (isFinite(+report.featureVersion)) ver = +report.featureVersion;
    }
    if (ver !== null && ver !== INTAKE_FEATURE_VERSION) {
      warnings.push('feature vector version ' + ver + ', and THE INTAKE was written against ' +
                    INTAKE_FEATURE_VERSION + '. Unknown fields are ignored and missing ones ' +
                    'fall back to neutral defaults.');
    }
    var missing = [], keys = Object.keys(INTAKE_READS);
    for (var mi = 0; mi < keys.length; mi++) {
      if (!isFinite(+features[keys[mi]])) missing.push(keys[mi]);
    }
    if (missing.length === keys.length) {
      warnings.push('no usable feature vector — every field defaulted, so this is a fresh ' +
                    'arrangement rather than a diagnosis.');
    } else if (missing.length) {
      warnings.push('no value for ' + missing.join(', ') + '; neutral defaults used.');
    }

    /* The base carries everything THE INTAKE has no business deciding. */
    var st = sanitizeState(opts.base || defaultState());

    var chooser = (typeof opts.chooser === 'function') ? opts.chooser : chooseArrangement;
    var chosen = chooser(features) || {};
    var style = (STYLES.indexOf(chosen.style) >= 0) ? chosen.style : 'velvet';
    if (chosen.style !== style) {
      warnings.push('the chooser named an arrangement CASKET does not have (' +
                    String(chosen.style) + '); fell back to velvet.');
    }

    /* THE RECIPE, WHOLE. styleDefaults is the engine's own table. */
    st.style = style;
    var d = styleDefaults(style);
    for (var k in d) {
      if (Object.prototype.hasOwnProperty.call(d, k)) st[k] = d[k];
    }

    /* Only on the caller's explicit instruction: a loudness target is a
       delivery decision like the lid, not something the audio reveals. */
    if (isFinite(+opts.targetLufs)) st.targetLufs = +opts.targetLufs;
    st = sanitizeState(st);

    var measured = null;
    var haveAudio = !!(inL && inL.length);
    if (haveAudio && opts.measure !== false) {
      var R = inR && inR.length === inL.length ? inR : inL;

      /* Drive first, margin second, and the order is not cosmetic: the
         true-peak residual is a property of what the limiter actually
         did, so measuring the margin before the drive is set measures a
         render nobody is going to hear. */
      var dr = autoDrive(st, inL, R, fs, st.targetLufs, opts.iters);
      if (dr && isFinite(dr.drive)) st.drive = dr.drive;
      if (dr && dr.reached === false) {
        warnings.push('the loudness target was not reached; the drive is at the rail it stopped on.');
      }
      st = sanitizeState(st);

      var am = autoMargin(st, inL, R, fs, opts.passes);
      /* THE MARGIN ONLY EVER TIGHTENS. autoMargin verifies against THIS
         material, so its answer is true for this master — but an
         arrangement's shipped margin (Lead's -0.3) was chosen to cover
         material in general, and letting a measurement RELAX it would
         mean the intake quietly removing a safety allowance on the one
         path where nobody is watching the knob. It may only take the
         more conservative of the two. */
      if (am && isFinite(am.margin)) {
        st.margin = am.margin < st.margin ? am.margin : st.margin;
      }
      if (am && am.covered === false) {
        warnings.push('even at the widest margin the render still exceeds the lid; ' +
                      'lower the lid or accept the overshoot knowingly.');
      }
      st = sanitizeState(st);

      measured = {
        drive: st.drive,
        margin: st.margin,
        targetLufs: st.targetLufs,
        lufs: dr ? dr.lufs : NaN,
        truePeak: dr ? dr.truePeak : NaN,
        reachedTarget: dr ? !!dr.reached : false,
        residual: am ? am.residual : NaN,
        verifiedPeak: am ? am.verifiedPeak : NaN,
        marginCovers: am ? !!am.covered : false
      };
    } else if (!haveAudio) {
      warnings.push('no audio was handed over, so the drive and the margin are the ' +
                    'arrangement\'s own and nothing has been measured.');
    }

    return {
      /* a .casket.json state, already through the sanitiser */
      state: st,
      arrangement: style,
      confidence: isFinite(+chosen.confidence) ? +chosen.confidence : 0,
      evidence: chosen.evidence || [],
      scores: chosen.scores || null,
      measured: measured,
      featureVersion: ver,
      reads: keys,
      warnings: warnings
    };
  }

  /* ---------- deterministic test signals ---------- */
  function makeNoise(seed, n) { return ND.makeNoise(seed, n); }
  function makeSine(freq, fs, n, amp) {
    var out = new Float64Array(n), w = 2 * Math.PI * freq / fs;
    for (var i = 0; i < n; i++) out[i] = amp * NM.sin(w * i);
    return out;
  }
  function makeSquare(freq, fs, n, amp) {
    var out = new Float64Array(n), per = fs / freq;
    for (var i = 0; i < n; i++) out[i] = (i % per) < per / 2 ? amp : -amp;
    return out;
  }
  function makeImpulses(period, n, amp) {
    var out = new Float64Array(n);
    for (var i = 0; i < n; i += period) out[i] = amp;
    return out;
  }

  return {
    VERSION: VERSION, CTRL: CTRL, OS_Q: OS_Q,
    STYLES: STYLES, STYLE: STYLE, LININGS: LININGS,
    DUSTS: DUSTS, DUST_BITS: DUST_BITS,
    styleDefaults: styleDefaults,
    defaultState: defaultState, sanitizeState: sanitizeState,
    designOversampler: designOversampler, designDecimator: designDecimator,
    DEC_Q: DEC_Q, DEC_CUT: DEC_CUT,
    kWeight: kWeight, loudnessOf: loudnessOf,
    latencySamples: latencySamples, vigilSamples: vigilSamples, boxLen: boxLen,
    transferAt: transferAt, quantize: quantize, meterBuffer: meterBuffer, createEngine: createEngine, truePeakOf: truePeakOf,
    RS_Q: RS_Q, resample: resample, conformToRate: conformToRate,
    renderOffline: renderOffline, autoDrive: autoDrive, difference: difference, wake: wake,
    matchReference: matchReference, autoMargin: autoMargin,
    intake: intake, chooseArrangement: chooseArrangement,
    INTAKE_READS: INTAKE_READS, INTAKE_FEATURE_VERSION: INTAKE_FEATURE_VERSION,
    batchRender: batchRender, albumMaster: albumMaster, albumLoudness: albumLoudness,
    albumReport: albumReport,
    makeNoise: makeNoise, makeSine: makeSine, makeSquare: makeSquare,
    makeImpulses: makeImpulses,
    _nm: NM, _nd: ND
  };
})(typeof module !== 'undefined' && module.exports
     ? require('../shared/necromath.js') : NM,
   typeof module !== 'undefined' && module.exports
     ? require('../shared/necrodyn.js') : ND);
if (typeof module !== 'undefined' && module.exports) module.exports = CASKET;
