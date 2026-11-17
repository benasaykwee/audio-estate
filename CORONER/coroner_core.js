/* ===================================================================
   CORONER — determines what the body was made of
   coroner_core.js · the ANALYSIS · SINGLE SOURCE OF TRUTH
   v0.1

   Sixth member of the estate, and the first that listens instead of
   speaking. Everything else here makes sound. This one takes sound
   apart and writes down what it found.

   THE THREE LAYERS, AND WHY THEY ARE SEPARATE
     1. THE EXAMINATION  — pure measurement. Produces a versioned
        feature vector and nothing else. Has no opinions.
     2. THE VERDICT      — an opinion about the measurements. Thin,
        transparent, and DELIBERATELY REPLACEABLE.
     3. THE ROUTING SLIP — where the body goes, and what patch is
        waiting for it when it gets there.

   The separation is the entire architectural argument. A neural
   classifier, when one arrives, replaces layer 2 ONLY: it reads the
   same `features` object this file already emits and returns the same
   `{klass, confidence, evidence}` shape. Layer 1 becomes its training
   input rather than being thrown away, and layer 3 never notices the
   swap. Anything that would make layer 2 hard to replace — a verdict
   that reaches back into the raw samples, a routing rule that reads a
   spectrum instead of a feature — is a bug in this file, not a
   shortcut.

   That is also why FEATURES below is a registry rather than a loose
   object literal: a model needs to enumerate its own input vector,
   know each field's range, and fail loudly when the vector version it
   was trained on stops matching the one it is handed.

   ESTATE LAWS OBSERVED
     LAW 1 — the future C++ twin compiles at -ffp-contract=off. Nothing
             in here may depend on a fused multiply-add.
     LAW 2 — every transcendental goes through NM. Math.sqrt stays
             native (IEEE requires correct rounding, so v8 and libm
             already agree) and so does Math.atan2, which is used only
             for a phase that never reaches a verdict.
     LAW 3 — no literal closing script tag anywhere in this file,
             comments included. This file is embedded verbatim in HTML.
     LAW 5 — sanitisers are `isFinite(n) ? n : def`, never `+x || def`.
             0 is a legal value for almost every feature here.

   DETERMINISM. There is no Math.random below and no wall-clock read.
   The same samples must produce the same report byte for byte, or
   there can be no regression baseline and no parity gate — and a
   classifier that cannot reproduce its own verdict cannot be trusted
   to have one.

   ARITHMETIC. Every buffer is Float64Array and every intermediate is
   a double, so the C++ twin can be bit-exact rather than merely close.
   =================================================================== */

var CR = (function () {
  'use strict';

  /* NM comes from the embed in the browser (nm-src precedes core-src, LAW 4)
     and from shared/ under node. Never a third copy.

     NOTE THE NAME — `_NM`, not `NM`. See PALLBEARER's worklet-scope trap:
     a top-level `var NM` inside a module-loaded concatenation hoists a local
     undefined, shadows the real one, and leaves the engine holding null while
     passing every node test. Naming it `_NM` lets `typeof NM` walk up the
     scope chain and find the real thing. CORONER does not run in a worklet
     today, but it is one drag-and-drop away from doing so. */
  var _NM = (typeof NM !== 'undefined' && NM) ? NM
          : (typeof globalThis !== 'undefined' && globalThis.NM) ? globalThis.NM
          : (typeof require === 'function' ? require('../shared/necromath.js') : null);

  var TWO_PI = 6.2831853071795865;
  var LN2 = 0.69314718055994531;

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function san(n, def) { return isFinite(n) ? n : def; }
  function log2_(x) { return _NM.log(x) / LN2; }
  function db(x) { return 20 * _NM.log10(x > 1e-12 ? x : 1e-12); }

  /* Cents between two frequencies. Returns 0 rather than +-Infinity when
     either side is silent, because a cents distance from nothing is not a
     large number, it is an absent measurement. */
  function cents(a, b) {
    if (!(a > 0) || !(b > 0)) return 0;
    return 1200 * log2_(a / b);
  }

  // ==================================================================
  // 0. THE GLASS — FFT and windows
  // ==================================================================

  /* Radix-2 iterative FFT with precomputed twiddles. Tables are built once
     per size and cached, which matters: a 4-second file at 2048/512 is ~340
     frames, and rebuilding 1024 sin/cos pairs per frame would put NM's
     polynomial evaluation in the hot loop for no reason.

     The twiddles go through NM (LAW 2). This is not pedantry — the C++ twin
     compares FFT magnitudes against these, and std::cos and v8's Math.cos
     disagree in the last ulp often enough that a bit-exact gate would fail
     on the window function alone. PALLBEARER learned this the expensive way
     when its parity FIXTURE broke the law it was testing. */
  var _twiddle = {};
  var _revbits = {};

  function twiddlesFor(n) {
    var t = _twiddle[n];
    if (t) return t;
    var cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (var i = 0; i < n / 2; i++) {
      var a = -TWO_PI * i / n;
      cos[i] = _NM.cos(a);
      sin[i] = _NM.sin(a);
    }
    t = { cos: cos, sin: sin };
    _twiddle[n] = t;
    return t;
  }

  function revBitsFor(n) {
    var r = _revbits[n];
    if (r) return r;
    var bits = Math.round(log2_(n));
    r = new Int32Array(n);
    for (var i = 0; i < n; i++) {
      var x = i, y = 0;
      for (var b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; }
      r[i] = y;
    }
    _revbits[n] = r;
    return r;
  }

  /* In-place complex FFT. re/im are Float64Array of length n (a power of 2). */
  function fft(re, im) {
    var n = re.length;
    var rev = revBitsFor(n), tw = twiddlesFor(n);
    var i, j, tmp;
    for (i = 0; i < n; i++) {
      j = rev[i];
      if (j > i) {
        tmp = re[i]; re[i] = re[j]; re[j] = tmp;
        tmp = im[i]; im[i] = im[j]; im[j] = tmp;
      }
    }
    for (var size = 2; size <= n; size <<= 1) {
      var half = size >> 1, step = n / size;
      for (i = 0; i < n; i += size) {
        for (j = 0; j < half; j++) {
          var k = j * step;
          var wr = tw.cos[k], wi = tw.sin[k];
          var a = i + j, b = a + half;
          var xr = re[b] * wr - im[b] * wi;
          var xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] = re[a] + xr; im[a] = im[a] + xi;
        }
      }
    }
  }

  /* Hann window, cached per size. Periodic (n, not n-1) so that overlapping
     frames sum flat at 50% hop. */
  var _windows = {};
  function hann(n) {
    var w = _windows[n];
    if (w) return w;
    w = new Float64Array(n);
    for (var i = 0; i < n; i++) w[i] = 0.5 - 0.5 * _NM.cos(TWO_PI * i / n);
    _windows[n] = w;
    return w;
  }

  /* Magnitude spectrum of one frame. Returns length n/2+1. */
  function magSpectrum(frame, n) {
    var re = new Float64Array(n), im = new Float64Array(n);
    var w = hann(n);
    var i, lim = frame.length < n ? frame.length : n;
    for (i = 0; i < lim; i++) re[i] = frame[i] * w[i];
    fft(re, im);
    var half = (n >> 1) + 1;
    var mag = new Float64Array(half);
    for (i = 0; i < half; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    return mag;
  }

  // ==================================================================
  // 1. THE FEATURE REGISTRY
  // ==================================================================

  /* Bump FEATURE_VERSION whenever a feature is added, removed, or has its
     meaning changed. A model trained on one version must refuse a vector
     from another rather than quietly reading `flatness` out of the slot
     that used to hold `flux`. Adding a field at the END is still a version
     bump, because a fixed-order vector is exactly what a model consumes.

     v2 — added `noteCount`, and CHANGED THE MEANING of f0, f0jitter,
     vibRate, vibDepth, harmonicity, inharm, oddEven, irregular and
     bandSlope: all are now measured on the representative note segment
     rather than across the whole file. A v1 vector and a v2 vector are not
     comparable, which is exactly what the stamp exists to say.

     v3 — `inharm` gained a plausibility ceiling and its declared maximum
     dropped from 0.01 to 0.002. Both the raw value and its normalisation
     change, so a model trained on a v2 vector must not read a v3 one.
     CASKET's intake (Interchange §9.3) was written against v2 and reads
     seven features, none of which is `inharm`; by its own design a version
     mismatch is reported in `warnings` and never refused.

     v4 — added `pluckPos` and `pluckFit`. Additions at the END of the
     registry, so nothing already in the vector shifts slot; the bump is
     still required, because a fixed-order vector's LENGTH is part of its
     contract and a model handed a longer one must refuse rather than read
     past what it knows. None of CASKET's seven reads is affected. */
  var FEATURE_VERSION = 4;

  var FEATURES = [
    // ---- pitch, and the steadiness of it ----
    { id: 'f0',        name: 'Fundamental',        min: 0,   max: 8000, unit: 'Hz',
      note: 'YIN estimate, median across voiced frames. 0 means nothing periodic was found.' },
    { id: 'f0conf',    name: 'Pitch Confidence',   min: 0,   max: 1,
      note: 'Fraction of frames that agreed on a pitch at all.' },
    { id: 'f0jitter',  name: 'Pitch Jitter',       min: 0,   max: 200,  unit: 'c',
      note: 'Short-term pitch instability WITHIN notes, with vibrato and drift removed first. The strongest synthetic tell: an oscillator holds a pitch far more perfectly than a hand can. Reliable up to about 30 cents; above that read it as "very unstable" rather than as a number.' },
    { id: 'vibRate',   name: 'Vibrato Rate',       min: 0,   max: 14,   unit: 'Hz' },
    { id: 'vibDepth',  name: 'Vibrato Depth',      min: 0,   max: 200,  unit: 'c' },

    // ---- how the partials sit ----
    { id: 'harmonicity', name: 'Harmonicity',      min: 0,   max: 1,
      note: 'Share of spectral energy sitting on integer multiples of f0.' },
    { id: 'inharm',    name: 'Inharmonicity B',    min: 0,   max: 0.002,
      note: 'Stiffness coefficient from f_n = n*f0*sqrt(1+B*n^2). Struck and plucked strings stretch (B>0); oscillators do not (B~0). Withheld when the fit below is poor, AND when the value exceeds what any real string can produce. The declared maximum used to be 0.01, which admitted values five times stiffer than the stiffest piano string and let a grain cloud pass as one.' },
    { id: 'inharmFit', name: 'Stiffness Fit',      min: 0,   max: 1,
      note: 'How well the stiff-string law explains the partials, as R-squared. Low means the partials are displaced by something else — unison detune does this convincingly — so the B above should not be trusted.' },
    { id: 'oddEven',   name: 'Odd/Even Balance',   min: 0,   max: 1,
      note: '1 = odd harmonics only (square, clarinet). 0.5 = an even saw-like spread.' },
    { id: 'irregular', name: 'Partial Irregularity', min: 0, max: 1,
      note: 'Jaggedness of the partial amplitudes. Smooth = analogue oscillator; jagged = a resonant body.' },
    { id: 'bandSlope', name: 'Spectral Slope',     min: -60, max: 6,    unit: 'dB/oct' },

    // ---- colour ----
    { id: 'centroid',  name: 'Brightness',         min: 0,   max: 12000, unit: 'Hz' },
    { id: 'centroidVar', name: 'Timbral Motion',   min: 0,   max: 1,
      note: 'Normalised movement of the centroid over time. A held wavetable morph is high; a static oscillator is near zero.' },
    { id: 'rolloff',   name: 'Rolloff (85%)',      min: 0,   max: 20000, unit: 'Hz' },
    { id: 'flatness',  name: 'Spectral Flatness',  min: 0,   max: 1,
      note: 'Wiener entropy. 0 = a pure tone, 1 = white noise.' },
    { id: 'flux',      name: 'Spectral Flux',      min: 0,   max: 1 },
    { id: 'subRatio',  name: 'Sub Energy',         min: 0,   max: 1,
      note: 'Share of energy below 120 Hz.' },
    { id: 'highRatio', name: 'Air Energy',         min: 0,   max: 1,
      note: 'Share of energy above 5 kHz.' },
    { id: 'noiseRatio', name: 'Noise Fraction',    min: 0,   max: 1,
      note: 'Residual after the harmonic series is removed. Breath, bow and finger noise live here; oscillators are suspiciously clean.' },

    // ---- shape in time ----
    { id: 'attack',    name: 'Attack Time',        min: 0,   max: 4,    unit: 's',
      note: '10% to 90% of the envelope peak.' },
    { id: 'decayRate', name: 'Decay Rate',         min: -80, max: 0,    unit: 'dB/s' },
    { id: 'sustain',   name: 'Sustain Ratio',      min: 0,   max: 1,
      note: 'Level three-quarters of the way through, against the peak. Near 0 = it rang out and died; near 1 = something held it.' },
    { id: 'tremRate',  name: 'Tremolo Rate',       min: 0,   max: 20,   unit: 'Hz' },
    { id: 'tremDepth', name: 'Tremolo Depth',      min: 0,   max: 1 },
    { id: 'onsetRate', name: 'Onset Density',      min: 0,   max: 40,   unit: '/s' },

    // ---- gross ----
    { id: 'crest',     name: 'Crest Factor',       min: 1,   max: 40 },
    { id: 'zcr',       name: 'Zero-Cross Rate',    min: 0,   max: 1 },
    { id: 'polyphony', name: 'Voice Estimate',     min: 0,   max: 8,
      note: 'Count of strong spectral peaks that do NOT belong to the detected harmonic series. Coarse, and honest about it.' },
    { id: 'dur',       name: 'Duration',           min: 0,   max: 3600, unit: 's' },
    { id: 'stereoWidth', name: 'Stereo Width',     min: 0,   max: 1,
      note: '0 for mono input, and 0 is also the correct answer for a dual-mono file.' },
    { id: 'noteCount', name: 'Stable Notes',       min: 0,   max: 200,
      note: 'How many separate held pitches were found. 1 is a single note; more means a phrase, and every harmonic measurement above was taken from the longest of them rather than from the whole file.' },
    { id: 'pluckPos',  name: 'Pluck Position',     min: 0,   max: 0.5,
      note: 'EXPERIMENTAL. Where along the string it was excited, as a fraction of the length, from the comb of missing harmonics at n = k/p. 0 means it was not measurable. Reported but NOT routed on: a comb at p shares half its nulls with one at p/2, so when only some nulls are in range two positions explain the same evidence. Weigh it with the fit below and do not act on it alone.' },
    { id: 'pluckFit',  name: 'Pluck Comb Fit',      min: 0,   max: 1,
      note: 'How well the comb model explains the partial pattern. Low means the position above is not determined, however plausible it looks.' }
  ];

  var FEATURE_BY_ID = {};
  for (var _fi = 0; _fi < FEATURES.length; _fi++) FEATURE_BY_ID[FEATURES[_fi].id] = FEATURES[_fi];

  /* The fixed-order vector a model consumes. Order is FEATURES order, and
     that order is part of the contract FEATURE_VERSION protects. */
  function featureVector(f) {
    var v = new Float64Array(FEATURES.length);
    for (var i = 0; i < FEATURES.length; i++) v[i] = san(f[FEATURES[i].id], 0);
    return v;
  }

  /* Each feature scaled to roughly 0..1 by its declared range. This is what
     a neural layer actually wants; the raw vector is what a human reads. */
  function normalizedVector(f) {
    var v = new Float64Array(FEATURES.length);
    for (var i = 0; i < FEATURES.length; i++) {
      var d = FEATURES[i], x = san(f[d.id], 0);
      v[i] = clamp((x - d.min) / (d.max - d.min), 0, 1);
    }
    return v;
  }

  // ==================================================================
  // 2. PITCH — YIN
  // ==================================================================

  /* Cumulative mean normalised difference, i.e. YIN.

     NECROPHONE's detectPitchHz uses plain autocorrelation and its tests
     caught two real bugs on the way in: dividing by (N-lag) inflates long
     lags and produces octave-down errors, and short lags form a false
     plateau that peak-picking walks straight into. YIN was designed against
     exactly those two failures — the cumulative normalisation flattens the
     lag bias, and starting the search after d'[tau] first dips below the
     threshold skips the plateau by construction. This is not a better guess
     at the same algorithm, it is the algorithm that already knows.

     Returns 0 when nothing is periodic enough. 0 is a real answer here and
     must not be confused with "quiet". */
  function yinF0(frame, sr, fmin, fmax, thresh) {
    fmin = fmin || 40; fmax = fmax || 4000; thresh = thresh === undefined ? 0.15 : thresh;
    var n = frame.length;
    var tauMin = Math.max(2, Math.floor(sr / fmax));
    var tauMax = Math.min(n >> 1, Math.floor(sr / fmin));
    if (tauMax <= tauMin) return { hz: 0, conf: 0 };

    var d = new Float64Array(tauMax + 1);
    var tau, i;
    for (tau = tauMin; tau <= tauMax; tau++) {
      var s = 0;
      for (i = 0; i < n - tauMax; i++) {
        var diff = frame[i] - frame[i + tau];
        s += diff * diff;
      }
      d[tau] = s;
    }

    // cumulative mean normalisation
    var cmnd = new Float64Array(tauMax + 1);
    cmnd[0] = 1;
    var run = 0;
    for (tau = tauMin; tau <= tauMax; tau++) {
      run += d[tau];
      cmnd[tau] = run > 0 ? d[tau] * (tau - tauMin + 1) / run : 1;
    }

    // first dip below threshold, then walk to its local minimum
    var best = -1;
    for (tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < thresh) {
        while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
        best = tau;
        break;
      }
    }
    // nothing crossed: take the global minimum but report low confidence
    if (best < 0) {
      var mv = Infinity;
      for (tau = tauMin; tau <= tauMax; tau++) if (cmnd[tau] < mv) { mv = cmnd[tau]; best = tau; }
      if (best < 0 || mv > 0.6) return { hz: 0, conf: 0 };
    }

    // parabolic interpolation around the minimum, for sub-bin pitch
    var t = best, refined = t;
    if (t > tauMin && t < tauMax) {
      var y0 = cmnd[t - 1], y1 = cmnd[t], y2 = cmnd[t + 1];
      var denom = 2 * (2 * y1 - y0 - y2);
      if (denom !== 0) refined = t + (y2 - y0) / denom;
    }
    if (!(refined > 0)) return { hz: 0, conf: 0 };
    var conf = clamp(1 - cmnd[best], 0, 1);
    return { hz: sr / refined, conf: conf };
  }

  // ==================================================================
  // 3. THE EXAMINATION
  // ==================================================================

  function median(arr) {
    if (!arr.length) return 0;
    var a = Array.prototype.slice.call(arr).sort(function (x, y) { return x - y; });
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : 0.5 * (a[m - 1] + a[m]);
  }

  function mean(arr) {
    if (!arr.length) return 0;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  function stddev(arr) {
    if (arr.length < 2) return 0;
    var m = mean(arr), s = 0;
    for (var i = 0; i < arr.length; i++) { var dd = arr[i] - m; s += dd * dd; }
    return Math.sqrt(s / (arr.length - 1));
  }

  /* Dominant modulation rate and depth in a slow-moving series (a pitch
     track, or an amplitude envelope). Used for both vibrato and tremolo,
     because they are the same measurement pointed at different signals.

     The DC term is removed first, so a loud steady tone does not read as a
     0 Hz tremolo of enormous depth. */
  function modulation(series, rateHz, loHz, hiHz) {
    var n = series.length;
    if (n < 8) return { rate: 0, depth: 0 };
    var m = mean(series);
    var size = 1; while (size < n) size <<= 1;
    var re = new Float64Array(size), im = new Float64Array(size);
    var w = hann(size);
    for (var i = 0; i < n; i++) re[i] = (series[i] - m) * w[i];
    fft(re, im);
    var loBin = Math.max(1, Math.floor(loHz * size / rateHz));
    var hiBin = Math.min((size >> 1) - 1, Math.ceil(hiHz * size / rateHz));
    var bestBin = -1, bestMag = 0;
    for (var b = loBin; b <= hiBin; b++) {
      var mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      if (mag > bestMag) { bestMag = mag; bestBin = b; }
    }
    if (bestBin < 0) return { rate: 0, depth: 0 };
    /* Depth as a peak deviation in the series' own units. The window halves
       the amplitude of a sinusoid and the FFT scales by n/2, hence 4/n. */
    var depth = bestMag * 4 / n;
    return { rate: bestBin * rateHz / size, depth: depth };
  }

  /* Remove a sinusoid of KNOWN frequency from a series by least squares.
     Two dot products, and exact regardless of how the period divides into
     frames — which a moving average is not. See the jitter note below. */
  function detrendSinusoid(track, frameRate, rateHz) {
    if (!(rateHz > 0) || track.length < 4) return track;
    var w0 = TWO_PI * rateHz / frameRate;
    var sc = 0, ss = 0, scc = 0, sss = 0, scs = 0, i;
    for (i = 0; i < track.length; i++) {
      var cw = _NM.cos(w0 * i), sw = _NM.sin(w0 * i);
      sc += track[i] * cw; ss += track[i] * sw;
      scc += cw * cw; sss += sw * sw; scs += cw * sw;
    }
    var detr = scc * sss - scs * scs;
    if (!(Math.abs(detr) > 1e-9)) return track;
    var aC = (sc * sss - ss * scs) / detr;
    var bS = (ss * scc - sc * scs) / detr;
    var out = [];
    for (i = 0; i < track.length; i++) {
      out.push(track[i] - (aC * _NM.cos(w0 * i) + bS * _NM.sin(w0 * i)));
    }
    return out;
  }

  /* Remove a straight line. A player's slow pitch sag across a held note is
     drift, not jitter, and leaving it in inflates every acoustic reading. */
  function detrendLine(track) {
    var n = track.length;
    if (n < 3) return track;
    var sx = 0, sy = 0, sxx = 0, sxy = 0, i;
    for (i = 0; i < n; i++) { sx += i; sy += track[i]; sxx += i * i; sxy += i * track[i]; }
    var den = n * sxx - sx * sx;
    if (!(Math.abs(den) > 1e-9)) return track;
    var m = (n * sxy - sx * sy) / den, b = (sy - m * sx) / n;
    var out = [];
    for (i = 0; i < n; i++) out.push(track[i] - (m * i + b));
    return out;
  }

  /* Deinterleave / downmix. Accepts a Float32Array or Float64Array (mono),
     or {left, right}, or an array of channel arrays. */
  function toMono(input) {
    if (!input) return { mono: new Float64Array(0), width: 0 };
    var chans;
    if (input.left && input.right) chans = [input.left, input.right];
    else if (Array.isArray(input) && input.length && input[0] && input[0].length !== undefined) chans = input;
    else return { mono: Float64Array.from(input), width: 0 };

    if (chans.length === 1) return { mono: Float64Array.from(chans[0]), width: 0 };
    var n = chans[0].length, l = chans[0], r = chans[1];
    var mono = new Float64Array(n);
    var sumM = 0, sumS = 0;
    for (var i = 0; i < n; i++) {
      var mid = 0.5 * (l[i] + r[i]);
      var side = 0.5 * (l[i] - r[i]);
      mono[i] = mid;
      sumM += mid * mid;
      sumS += side * side;
    }
    /* Width as side energy against total. A dual-mono file has zero side
       energy and correctly reports 0, which is why this is not phrased as
       "is it stereo" — a stereo file carrying identical channels is not
       wide, it is two copies of a mono recording. */
    var width = (sumM + sumS) > 1e-20 ? Math.sqrt(sumS / (sumM + sumS)) : 0;
    return { mono: mono, width: clamp(width, 0, 1) };
  }

  /* THE EXAMINATION. Measurement only, no opinions.

     opts.fftSize   (default 2048)
     opts.hop       (default fftSize/4)
     opts.maxSeconds(default 30 — a long file is trimmed, and the report says so) */
  function examine(input, sr, opts) {
    opts = opts || {};
    sr = san(sr, 44100);
    var N = opts.fftSize || 2048;
    var hop = opts.hop || (N >> 2);
    var maxSec = san(opts.maxSeconds, 30);

    var dm = toMono(input);
    var x = dm.mono;
    var trimmed = false;
    if (x.length > maxSec * sr) { x = x.subarray(0, Math.floor(maxSec * sr)); trimmed = true; }

    var f = {};
    for (var fi = 0; fi < FEATURES.length; fi++) f[FEATURES[fi].id] = 0;
    f.dur = x.length / sr;
    f.stereoWidth = dm.width;

    if (x.length < N * 2) {
      return { version: FEATURE_VERSION, sr: sr, samples: x.length, trimmed: trimmed,
               tooShort: true, features: f, frames: null };
    }

    // ---------------- frame loop ----------------
    var nFrames = 1 + Math.floor((x.length - N) / hop);
    var centroids = new Float64Array(nFrames);
    var flatnesses = new Float64Array(nFrames);
    var rolloffs = new Float64Array(nFrames);
    var energies = new Float64Array(nFrames);
    var fluxes = new Float64Array(nFrames);
    var pitchHz = new Float64Array(nFrames);
    var pitchConf = new Float64Array(nFrames);

    var half = (N >> 1) + 1;
    var binHz = sr / N;
    var prevMag = null;
    var avgMag = new Float64Array(half);
    var frameBuf = new Float64Array(N);
    var fr, i, k;

    for (fr = 0; fr < nFrames; fr++) {
      var off = fr * hop;
      for (i = 0; i < N; i++) frameBuf[i] = x[off + i];

      var mag = magSpectrum(frameBuf, N);

      var tot = 0, wsum = 0, logSum = 0, nz = 0, e = 0;
      for (k = 1; k < half; k++) {
        var m = mag[k];
        tot += m;
        wsum += m * k * binHz;
        e += m * m;
        if (m > 1e-12) { logSum += _NM.log(m); nz++; }
        avgMag[k] += m;
      }
      energies[fr] = e;
      centroids[fr] = tot > 1e-12 ? wsum / tot : 0;

      /* Wiener entropy: geometric mean over arithmetic mean. Computed in the
         log domain because the geometric mean of 1024 numbers under 1 will
         underflow a double long before the division happens. */
      if (nz > 0 && tot > 1e-12) {
        var geo = _NM.exp(logSum / nz);
        var ari = tot / (half - 1);
        flatnesses[fr] = ari > 1e-12 ? clamp(geo / ari, 0, 1) : 0;
      }

      // 85% rolloff
      var acc = 0, target = 0.85 * tot;
      for (k = 1; k < half; k++) { acc += mag[k]; if (acc >= target) break; }
      rolloffs[fr] = k * binHz;

      // spectral flux, positive-going only, normalised by frame energy
      if (prevMag) {
        var fl = 0;
        for (k = 1; k < half; k++) { var dd = mag[k] - prevMag[k]; if (dd > 0) fl += dd; }
        fluxes[fr] = tot > 1e-12 ? fl / tot : 0;
      }
      prevMag = mag;

      var y = yinF0(frameBuf, sr, 40, Math.min(4000, sr * 0.4), 0.15);
      pitchHz[fr] = y.hz;
      pitchConf[fr] = y.conf;
    }

    // ---------------- pitch aggregate ----------------
    /* A frame counts as voiced only if it has both confidence AND audible
       energy. Confidence alone will happily find a strong period in the
       noise floor of a silent tail. */
    var eMax = 0;
    for (fr = 0; fr < nFrames; fr++) if (energies[fr] > eMax) eMax = energies[fr];

    /* ⚠ CONFIDENCE IS MEASURED OVER THE AUDIBLE FRAMES, NOT ALL OF THEM.

       The first version divided by `nFrames` — every frame in the file,
       silence included. That structurally punishes exactly the sounds that
       DECAY, because a fast-decaying note is mostly tail, and the tail is
       silence that was never going to be voiced.

       Measured by the closed loop, on a real Bone & Sinew render: the pitch
       was found and it was RIGHT — 195.7 Hz against a G3 played at 195.998
       — and then thrown away, because only 20% of the file's frames were
       audible enough to track. `f0conf` came in at 0.20, under the 0.25 bar
       for `pitched`, so the whole verdict fell through to the unpitched
       branch and a ringing string was called **"Percussive" at 94%
       confidence**. A correct measurement, discarded by a denominator, and
       then reported with conviction.

       Silence is not a failure to find a pitch. It is the absence of
       anything to find one in, and it does not get a vote. */
    var audibleFrames = 0, voicedCount = 0;
    for (fr = 0; fr < nFrames; fr++) {
      if (energies[fr] <= eMax * 0.02) continue;
      audibleFrames++;
      if (pitchConf[fr] > 0.5 && pitchHz[fr] > 0) voicedCount++;
    }
    f.f0conf = audibleFrames ? voicedCount / audibleFrames : 0;

    /* ==============================================================
       SEGMENTATION — the correction that real audio forced.

       The first version of this treated the whole file as ONE note:
       it took the median of every voiced frame as "the" pitch and the
       standard deviation of the whole track as "the" jitter. On a
       single held tone that is exactly right, and every synthesized
       test body in the harness is a single held tone, so it passed
       everything.

       Then it met eight real NECROPHONE renders and reported pitch
       jitter of 250 to 435 CENTS on all of them. Nothing was unstable.
       They are musical phrases, and it was measuring the MELODY: the
       spread of the tune, not the steadiness of any note in it. Since
       near-zero jitter is the strongest synthetic tell in the machine,
       and no real music can ever show near-zero jitter under that
       definition, the tell could never fire on real material. A pad
       rendered by an oscillator came back "Blown or Reed".

       No amount of threshold tuning fixes a measurement pointed at the
       wrong thing. Jitter is a SHORT-TERM property — instability
       within a note — so it has to be measured within notes and
       aggregated, which is also how jitter is defined in voice
       analysis, and which the single-note assumption had quietly
       thrown away.

       The same correction applies to the harmonic analysis below. An
       average spectrum over a whole phrase is a smear of every pitch
       in it, so partial tracking against one f0 finds almost nothing
       — which is why B came back at exactly 0.00 for all eight
       renders, bells included. A coroner examines a representative
       sample of tissue. It does not grind up the whole body and
       measure the paste.
       ============================================================== */

    var frameRate = sr / hop;
    var NOTE_BREAK_CENTS = 60;      // a step this large is a new note, not a wobble
    var MAX_SEG_SPAN_CENTS = 150;   // and a note never wanders further than this from where it began
    var MIN_SEG_FRAMES = Math.max(4, Math.round(frameRate * 0.08));

    /* ONSETS, computed once and used twice.

       PALLBEARER's and NECROPHONE's shared lesson applies: an adaptive
       threshold ALONE is a lie, because on a steady drone the mean and the
       spread both collapse toward zero and every speck of float noise reads
       as an onset. The rise must ALSO clear a fixed fraction of the loudest
       frame. */
    var fluxArrAll = Array.prototype.slice.call(fluxes);
    var fMeanAll = mean(fluxArrAll), fSdAll = stddev(fluxArrAll);
    var fluxPkAll = 0;
    for (fr = 0; fr < nFrames; fr++) if (fluxes[fr] > fluxPkAll) fluxPkAll = fluxes[fr];
    /* BOTH of these are relative, and that is not enough.

       `mean + 1.5*sd` collapses toward zero on a steady tone, and so does
       `peak * 0.25`, because the peak of an almost-flat flux signal is
       itself almost nothing. Two relative thresholds do not add up to an
       absolute one: a perfectly steady 277 Hz tone with no attacks in it
       at all was being cut into SIX notes by float noise crossing a bar
       that had collapsed to meet it.

       This is the exact lesson quoted three lines above, and it still got
       written wrong the first time — which is worth leaving on the record,
       since knowing the rule and applying it turn out to be different
       things. ONSET_FLOOR is the absolute half: the flux here is already
       normalised by frame energy, so 0.08 means "eight percent of this
       frame's spectrum is newly arrived", and no steady tone does that. */
    var ONSET_FLOOR = 0.08;
    var onsetThr = Math.max(fMeanAll + fSdAll * 1.5, fluxPkAll * 0.25, ONSET_FLOOR);

    var isOnset = new Uint8Array(nFrames);
    var onsetCount = 0, lastOn = -99;
    for (fr = 1; fr < nFrames - 1; fr++) {
      if (fluxes[fr] > onsetThr && fluxes[fr] >= fluxes[fr - 1] && fluxes[fr] > fluxes[fr + 1]
          && (fr - lastOn) * hop / sr > 0.05) {
        isOnset[fr] = 1; onsetCount++; lastOn = fr;
      }
    }

    /* SEGMENTATION BREAKS ON PITCH JUMPS **AND** ON ONSETS.

       Pitch alone is not enough, and the harness caught it: four repeated
       strikes of the same note have no pitch jump between them, so a
       pitch-only splitter fuses all four into one long segment. Everything
       measured per-note then silently becomes per-phrase again for exactly
       the material — a repeated figure — where that is least obvious.

       An onset is the other half of the definition of a note. A new note is
       a new pitch OR a new attack, and it takes both tests to see one. */
    /* A PITCH CHANGE ONLY COUNTS IF IT STAYS.

       Comparing each frame to the one before it, and breaking on any jump
       over the threshold, makes the segmenter and the jitter measurement
       fight each other — and the jitter measurement loses. Heavy
       instability throws individual frames past 60 cents constantly, so the
       segmenter chops the note into fragments, each fragment spans only the
       moments the pitch happened to be still, and the reported jitter goes
       DOWN as the real instability goes UP. Measured on bodies built with
       increasing wobble, the figure came back 12.3, then 7.1, then 0.8
       cents. A measurement that runs backwards is worse than no
       measurement, because it will be believed.

       The fix is to define a note change the way a listener hears one: the
       pitch moves AND STAYS moved. A single frame flung 80 cents and back
       is a wobble in one note. A change that persists is a new note. The
       comparison is also against the segment's recent median rather than
       the single previous frame, so one badly-tracked frame cannot start a
       spurious segment on its own. */
    function isNoteChange(fr, cur) {
      if (!cur) return true;

      /* A GLIDE IS NOT ONE NOTE, however smoothly it moves.

         The persistence rule above fixed frames being flung past the
         threshold and back, and immediately opened the opposite hole: a
         slow portamento never moves 60 cents between adjacent frames, so
         nothing ever triggers a change and the entire sweep becomes a
         single "note" whose spread is the width of the glide. Two real
         NECROPHONE pads went straight to the 200-cent jitter ceiling that
         way — the same wrong answer as the original whole-file bug, now
         arriving by a different road.

         So a segment also ends when it has wandered too far from where it
         started, whatever route it took to get there. 150 cents is well
         clear of any vibrato and comfortably inside a semitone-and-a-half,
         which is more than a single sustained pitch should ever cover. */
      var anchor = median(cur.hz.slice(0, Math.min(5, cur.hz.length)));
      if (Math.abs(cents(pitchHz[fr], anchor)) > MAX_SEG_SPAN_CENTS) return true;

      var tail = cur.hz.slice(Math.max(0, cur.hz.length - 5));
      var ref = median(tail);
      var d0 = cents(pitchHz[fr], ref);
      if (Math.abs(d0) < NOTE_BREAK_CENTS) return false;

      /* THE CONFIRMATION WINDOW MUST OUTLAST A VIBRATO HALF-CYCLE.

         With a three-frame window a wide vibrato fragments: at 5.5 Hz and
         43 frames per second a sweep from one extreme to the other takes
         about four frames, so the excursion "persists" for the whole
         window and every half-cycle registers as a new note. A 55-cent
         vibrato came apart into six.

         CONFIRM_SEC is set from that: 130 ms is longer than a half-cycle
         of any vibrato at or above 4 Hz, so a pitch that is coming back
         gets caught coming back. Expressed in seconds and converted, not
         hard-coded in frames, so a different hop or sample rate does not
         quietly change what a note is.

         The cost is honest and worth naming: notes shorter than about
         130 ms will not be separated by PITCH. They are still separated by
         their attacks, which is what the onset half of the test is for,
         and a fast run of short notes has attacks. */
      var CONFIRM_SEC = 0.13;
      var confirmFrames = Math.max(3, Math.round(frameRate * CONFIRM_SEC));
      var agree = 0, looked = 0;
      for (var q = fr + 1; q <= fr + confirmFrames && q < nFrames; q++) {
        if (!(pitchHz[q] > 0)) continue;
        looked++;
        var dq = cents(pitchHz[q], ref);
        if (Math.abs(dq) >= NOTE_BREAK_CENTS && (dq > 0) === (d0 > 0)) agree++;
      }
      /* At the very end of a file there is nothing left to confirm with, so
         a lone trailing excursion is treated as a wobble rather than a new
         note nobody can check. */
      if (looked === 0) return false;
      return agree >= Math.max(2, Math.round(looked * 0.7));
    }

    var segments = [], cur = null;
    for (fr = 0; fr < nFrames; fr++) {
      var voicedHere = pitchConf[fr] > 0.5 && pitchHz[fr] > 0 && energies[fr] > eMax * 0.02;
      if (!voicedHere) { if (cur) { segments.push(cur); cur = null; } continue; }
      var continues = cur && !isOnset[fr] && !isNoteChange(fr, cur);
      if (continues) {
        cur.hz.push(pitchHz[fr]); cur.end = fr; cur.energy += energies[fr];
      } else {
        if (cur) segments.push(cur);
        cur = { start: fr, end: fr, hz: [pitchHz[fr]], energy: energies[fr] };
      }
    }
    if (cur) segments.push(cur);

    var usable = segments.filter(function (sg) { return sg.hz.length >= MIN_SEG_FRAMES; });
    f.noteCount = clamp(usable.length, 0, 200);

    if (usable.length) {
      /* Per-segment vibrato and jitter, then the MEDIAN across segments.
         Median rather than mean so one badly-tracked note cannot drag the
         figure the way one octave-error frame used to. */
      var jits = [], vibRates = [], vibDepths = [];

      usable.forEach(function (sg) {
        var mid = median(sg.hz);
        var track = [];
        for (var q = 0; q < sg.hz.length; q++) track.push(cents(sg.hz[q], mid));

        var rate = 0, depth = 0;
        if (track.length >= 12) {
          var vv = modulation(track, frameRate, 3, 12);
          if (vv.depth > 3) { rate = vv.rate; depth = vv.depth; }
        }
        if (rate > 0) { vibRates.push(rate); vibDepths.push(depth); }

        var resid = rate > 0 ? detrendSinusoid(track, frameRate, rate) : track;
        resid = detrendLine(resid);
        jits.push(stddev(resid));
      });

      f.f0jitter = clamp(median(jits), 0, 200);
      f.vibRate = vibRates.length >= Math.max(1, usable.length * 0.4) ? clamp(median(vibRates), 0, 14) : 0;
      f.vibDepth = f.vibRate > 0 ? clamp(median(vibDepths), 0, 200) : 0;
    }

    /* THE REPRESENTATIVE SEGMENT — the tissue sample.
       Longest wins, because a long stable note gives the partial tracker
       the most to work with and is the least likely to be a passing tone.
       Energy breaks ties, so a long quiet tail cannot outvote the note the
       phrase is actually about. */
    var repSeg = null;
    usable.forEach(function (sg) {
      if (!repSeg) { repSeg = sg; return; }
      if (sg.hz.length > repSeg.hz.length) { repSeg = sg; return; }
      if (sg.hz.length === repSeg.hz.length && sg.energy > repSeg.energy) repSeg = sg;
    });

    if (repSeg) {
      var segMed = median(repSeg.hz);
      /* Octave-error guard: YIN occasionally halves or doubles on a single
         frame. Fold outliers onto the median's octave before averaging, or
         one bad frame drags f0 by 300 cents. */
      var folded = [];
      for (i = 0; i < repSeg.hz.length; i++) {
        var vf = repSeg.hz[i];
        while (vf > segMed * 1.5) vf *= 0.5;
        while (vf < segMed * 0.67) vf *= 2;
        folded.push(vf);
      }
      f.f0 = median(folded);
    }

    // ---------------- the spectra ----------------
    /* TWO spectra, for two different jobs.

       avgMag is the whole file, and stays whole-file on purpose: broadband
       colour, sub and air content are properties of the material as a
       whole and a listener hears them that way.

       segMag covers ONLY the representative segment, and every harmonic
       measurement is taken from it. Averaging a spectrum across changing
       pitches destroys exactly the structure those measurements read. */
    for (k = 1; k < half; k++) avgMag[k] /= nFrames;

    var totAvg = 0;
    for (k = 1; k < half; k++) totAvg += avgMag[k];

    var harmMag = avgMag, harmTot = totAvg;
    if (repSeg && repSeg.end > repSeg.start) {

      /* VIBRATO SMEARS ITS OWN EVIDENCE, so the still frames are used.

         Averaging magnitude spectra across a vibrato averages across every
         pitch the vibrato visited. At partial 18 a +-30 cent wobble drags
         the peak across many bins, the peak location stops meaning
         anything, and the stiffness fit falls apart: a synthesized bowed
         string with a genuine B=1.5e-4 fitted at R-squared 0.495 and had
         its real stiffness thrown away by the guard below. Meanwhile the
         same measurement on the same body WITHOUT vibrato fits at 0.999.

         The vibrato was never the problem — the frames chosen to average
         were. Restricting the average to frames whose pitch sits near the
         segment median samples the note where it is momentarily still,
         which is where its partials are actually where they belong.

         The fallback matters as much as the rule: if too few frames
         survive, the whole segment is used rather than a fit built on two
         frames, because a confident answer from almost no data is the
         failure mode this file is most keen to avoid. */
      var segMed2 = median(repSeg.hz);
      var STILL_CENTS = 15, MIN_STILL = 4;

      function buildSegMag(stillOnly) {
        var mg = new Float64Array(half), used = 0;
        for (var ff = repSeg.start; ff <= repSeg.end; ff++) {
          if (stillOnly) {
            var ph2 = repSeg.hz[ff - repSeg.start];
            if (!(ph2 > 0) || Math.abs(cents(ph2, segMed2)) > STILL_CENTS) continue;
          }
          var offS = ff * hop;
          if (offS + N > x.length) break;
          for (var q2 = 0; q2 < N; q2++) frameBuf[q2] = x[offS + q2];
          var sm = magSpectrum(frameBuf, N);
          for (var k2 = 1; k2 < half; k2++) mg[k2] += sm[k2];
          used++;
        }
        return { mag: mg, used: used };
      }

      var built = buildSegMag(true);
      if (built.used < MIN_STILL) built = buildSegMag(false);

      if (built.used > 0) {
        var segTot = 0;
        for (k = 1; k < half; k++) { built.mag[k] /= built.used; segTot += built.mag[k]; }
        if (segTot > 1e-12) { harmMag = built.mag; harmTot = segTot; }
      }
    }

    if (f.f0 > 0 && harmTot > 1e-12) {
      var maxPart = Math.min(32, Math.floor((sr * 0.5) / f.f0));

      /* PARTIAL TRACKING — and why pitch and stiffness must be solved
         TOGETHER rather than one after the other.

         Two facts collide here, and the first one is not a bug in anything:

         (1) YIN REPORTS A STIFF STRING SHARP. Measured on a synthetic
             B=8e-4 body at 110 Hz, the detector returns 112.00 Hz — 31
             cents high. That is not a detector fault, it is what stretched
             partials do to any period-based estimate: there is no period
             that fits all of them, so the answer is a compromise pulled
             upward by the sharp upper partials. A real piano does this to
             human ears too.

         (2) EVERY DEVIATION IS MEASURED AGAINST f0. So a fundamental that
             is 31 cents wrong does not merely add noise to B, it poisons
             it. Against 112, the low partials of that same body read as
             FLAT, get rejected as negative stiffness, and the survivors
             disagree wildly. The first version of this code measured
             B=1.97e-5 on a body built with B=8.00e-4: forty times low, and
             confidently so.

         Sequencing the two makes it worse, not better. Estimating B from a
         wrong f0 gives a wrong B; predicting partial positions from that
         wrong B then places the search window past the real peak (187 Hz
         off by partial 20, where the window is 47 Hz wide), so the tracker
         finds noise and the estimate collapses toward zero. That is exactly
         the failure the two-pass version produced.

         THE FIX IS TO STOP TREATING THEM AS TWO QUESTIONS. Square the
         stiff-string relation f_n = n*f0*sqrt(1 + B*n^2) and divide by n:

             (f_n / n)^2  =  f0^2  +  (f0^2 * B) * n^2

         which is a STRAIGHT LINE in n^2. A least-squares fit returns the
         intercept and the slope, and those give both unknowns at once:

             f0 = sqrt(intercept)          B = slope / intercept

         The regression also weights the measurement correctly for free.
         Stiffness deviation grows as roughly n^3, so the high partials
         carry nearly all the signal while the low ones carry mostly
         interpolation noise — and a fit against n^2 is dominated by its
         widest-spread points, which are precisely those high partials. A
         median over per-partial estimates, which is what the first version
         used, gives the noisy low partials equal say and is the wrong
         estimator for this shape of data.

         Iterating three times, extending the partial count each round as
         the model gets good enough to predict where to look, locks on from
         a starting point 31 cents wrong. */

      function findPartial(nH, f0g, bg) {
        var predicted = nH * f0g * Math.sqrt(1 + bg * nH * nH);
        // never search more than half a partial-spacing either way
        var halfSpan = Math.min(0.45 * f0g, Math.max(3 * binHz, 0.03 * predicted));
        var lo2 = Math.max(1, Math.round((predicted - halfSpan) / binHz));
        var hi2 = Math.min(half - 1, Math.round((predicted + halfSpan) / binHz));
        if (hi2 < lo2) return null;
        var pk = 0, pkBin = lo2, bandSum = 0;
        for (var kk = lo2; kk <= hi2; kk++) {
          bandSum += harmMag[kk];
          if (harmMag[kk] > pk) { pk = harmMag[kk]; pkBin = kk; }
        }
        /* Parabolic peak refinement — the true partial rarely sits on a bin,
           and inharmonicity is measured in fractions of a bin. Without this
           the estimate is quantised into uselessness. */
        var trueBin = pkBin;
        if (pkBin > 0 && pkBin < half - 1) {
          var a0 = harmMag[pkBin - 1], a1 = harmMag[pkBin], a2 = harmMag[pkBin + 1];
          var den = 2 * (2 * a1 - a0 - a2);
          if (den !== 0) trueBin = pkBin + (a2 - a0) / den;
        }
        return { n: nH, amp: pk, hz: trueBin * binHz, band: bandSum };
      }

      /* Fit (f_n/n)^2 = f0^2 + f0^2*B*n^2 by least squares.
         Returns null when the data cannot support a fit, rather than
         returning a number nobody should trust. */
      function fitStiffLine(parts) {
        var mx = 0, ii;
        for (ii = 0; ii < parts.length; ii++) if (parts[ii].amp > mx) mx = parts[ii].amp;
        if (!(mx > 0)) return null;
        var xs = [], ys = [];
        for (ii = 0; ii < parts.length; ii++) {
          var p = parts[ii];
          if (p.amp < mx * 0.02 || !(p.hz > 0)) continue;
          var fn = p.hz / p.n;
          xs.push(p.n * p.n);
          ys.push(fn * fn);
        }
        if (xs.length < 3) return null;
        var mx2 = mean(xs), my = mean(ys), num = 0, den2 = 0;
        for (ii = 0; ii < xs.length; ii++) {
          num += (xs[ii] - mx2) * (ys[ii] - my);
          den2 += (xs[ii] - mx2) * (xs[ii] - mx2);
        }
        if (!(den2 > 1e-9)) return null;
        var slope = num / den2;
        var intercept = my - slope * mx2;
        if (!(intercept > 1)) return null;

        /* HOW WELL DOES THE STIFF-STRING MODEL ACTUALLY EXPLAIN THIS?

           Measured on a real NECROPHONE pad render, the fit returned
           B=3.09e-4 — solidly "stiff string" — for a sound made entirely of
           oscillators. The cause is unison detune. Several detuned copies
           of a partial broaden and shift it, the tracker reports a
           displaced peak, and displaced peaks are what stiffness looks
           like. That verdict then routed an analogue pad to the PHYSICAL
           engine, which is the wrong instrument for it.

           Detune and stiffness are separable, but not by looking at any one
           partial. Stiffness follows a LAW: the deviation grows with n in
           one specific way, so a stiff string's partials fall on a straight
           line in this coordinate system. Detune scatters them. So the
           honest question is not "how big is B" but "does the model fit",
           and R-squared answers it directly.

           Reported alongside B rather than hidden, because a stiffness
           figure without its goodness of fit is a number with no way to
           tell whether it means anything. */
        var ssRes = 0, ssTot = 0;
        for (ii = 0; ii < xs.length; ii++) {
          var predY = intercept + slope * xs[ii];
          ssRes += (ys[ii] - predY) * (ys[ii] - predY);
          ssTot += (ys[ii] - my) * (ys[ii] - my);
        }
        var r2 = ssTot > 1e-9 ? clamp(1 - ssRes / ssTot, 0, 1) : 0;

        return { f0: Math.sqrt(intercept), B: slope / intercept, r2: r2, used: xs.length };
      }

      var f0Yin = f.f0;
      var f0Fit = f.f0, bFit = 0, bR2 = 0, bUsed = 0;
      var partials = null;
      var ROUNDS = [6, 12, 20, 32];

      for (var it = 0; it < ROUNDS.length; it++) {
        var nUpTo = Math.min(ROUNDS[it], maxPart);
        var found = [];
        for (var nH = 1; nH <= nUpTo; nH++) {
          var pr = findPartial(nH, f0Fit, bFit);
          if (pr) found.push(pr);
        }
        if (!found.length) break;
        partials = found;
        var fit = fitStiffLine(found);
        if (!fit) break;
        /* Refuse a refinement that has wandered off onto a neighbouring
           harmonic. YIN can be 31 cents wrong on a stiff string; it is not
           going to be an octave wrong on one that got this far, so a fit
           that says so has locked onto the wrong series and the old value
           is the better answer. */
        if (Math.abs(cents(fit.f0, f0Yin)) > 120) break;
        f0Fit = fit.f0;
        bFit = clamp(fit.B, 0, 0.01);
        bR2 = fit.r2;
        bUsed = fit.used;
      }

      /* The fitted fundamental is the better one and replaces YIN's. It is
         also the one corpseRoot will be built from, so a stiff piano sample
         now arrives at NECROPHONE in tune rather than 31 cents sharp.

         Note that f0 keeps the fitted value even when the STIFFNESS is
         rejected below. The two are not the same claim: the fit locates the
         harmonic series well regardless, and it is only the assertion
         "these partials are stretched by stiffness specifically" that needs
         the model to hold. */
      f.f0 = f0Fit;
      f.inharmFit = bR2;

      /* ⚠ GUARD ONE — A PLAUSIBILITY CEILING, and why guard two could
         never have caught what it was aimed at.

         Found by a parallel session running the closed loop for the first
         time: render each NECROPHONE engine, feed the audio back in, see
         where it routes. The GRAIN CLOUD measured B=9.22e-3 at R²=0.999 —
         the best stiff-string fit in the entire set — and was routed to
         the physical engine, while Bone & Sinew, the actual string model,
         measured 2.23e-6 and was sent to the granular one. The strongest
         physical tell in this file was running exactly backwards.

         Guard two below is POWERLESS BY CONSTRUCTION against this. It
         refuses poor fits, and this fit is superb: a dense cloud of grains
         has partial-like structure at spacings that happen to lie on a
         stretched series, and it lies on it beautifully.

         The tell was never the fit. It was the VALUE. B=9.22e-3 is roughly
         NINE TIMES the stiffest piano bass string in existence, and 92% of
         the maximum this very file declared for the feature — which is the
         actual mistake. A declared range that admits values no physical
         string can produce is a range in which an impossible answer never
         looks out of place. Real strings run about 1e-5 (long and thin) to
         1e-3 (short, thick, wound); 2e-3 is generous to any of them and
         closed to a grain cloud.

         THE GENERAL LESSON, worth more than the fix: A GOODNESS OF FIT
         ONLY TELLS YOU THE SHAPE IS RIGHT. It says nothing about whether
         the magnitude is possible. Both need guarding, and only one was. */
      var B_MAX_PLAUSIBLE = 2e-3;
      if (bFit > B_MAX_PLAUSIBLE) bFit = 0;

      /* GUARD TWO. Only claim stiffness when the stiffness model actually
         explains the partials. A small B is reported as measured — noise
         around zero is honest and harmless — but a LARGE B on a scattered
         fit is the detuned-oscillator confound, and reporting it sends the
         wrong instrument the body.

         0.75 is placed in the MIDDLE OF AN OBSERVED GAP rather than at the
         edge of one. Measured fits, on bodies whose stiffness is known:

           genuine stiff string, clean          0.999
           genuine stiff string, plucked        1.000
           genuine stiff string, with vibrato   0.849
           ------------------------- the gap -------------------------
           oscillator pad with unison detune    0.416
           harmonic body with heavy jitter      0.600
           everything else measured             below 0.2

         The first bar tried was 0.85, which is a real number from the data
         and still the wrong place for it: it sat directly on top of the
         0.849 case and rejected a genuine string by a thousandth. A
         threshold resting on a sample is a threshold that will move the
         next time anything is measured. */
      f.inharm = (bFit > 5e-5 && (bR2 < 0.75 || bUsed < 4)) ? 0 : bFit;

      var partAmp = [], partHz = [], harmSum = 0;
      if (partials) {
        for (i = 0; i < partials.length; i++) {
          partAmp.push(partials[i].amp);
          partHz.push(partials[i].hz);
          harmSum += partials[i].band;
        }
      }

      f.harmonicity = clamp(harmSum / harmTot, 0, 1);
      f.noiseRatio = clamp(1 - f.harmonicity, 0, 1);

      // odd vs even
      var oddE = 0, evenE = 0;
      for (i = 0; i < partAmp.length; i++) {
        if ((i + 1) % 2) oddE += partAmp[i] * partAmp[i]; else evenE += partAmp[i] * partAmp[i];
      }
      f.oddEven = (oddE + evenE) > 1e-20 ? oddE / (oddE + evenE) : 0;

      /* Inharmonicity B from f_n = n*f0*sqrt(1 + B*n^2), so
         B = ((f_n/(n*f0))^2 - 1) / n^2.
         Median across partials, and only partials that actually carry energy
         — a peak found in a band that holds nothing is a peak in the noise
         floor, and its position is meaningless. Higher partials say the most
         about stiffness, which is exactly why they must be the best measured. */
      var pkAmpMax = 0;
      for (i = 0; i < partAmp.length; i++) if (partAmp[i] > pkAmpMax) pkAmpMax = partAmp[i];

      /* THE PLUCK COMB. Measured on the same tracked partials the
         stiffness fit used, because both are patterns across the harmonic
         series of one note and neither can be read from a single number.
         Reported as 0 when it is not determined — an unmeasured position
         and a position of zero are the same value here, which is why
         `pluckFit` travels beside it. */
      var pluck = pluckPosition(
        partAmp.map(function (a, ix) { return { n: ix + 1, amp: a, hz: partHz[ix] }; }),
        partAmp.length);
      if (pluck) {
        f.pluckFit = pluck.fit;
        f.pluckPos = pluck.measurable ? pluck.p : 0;
      }
      // f.inharm was set by the joint fit above; nothing to re-derive here.

      /* Irregularity: mean absolute difference between each partial and the
         average of its neighbours, normalised. A smooth analogue spectrum
         scores low; a body with formants and notches scores high. */
      if (partAmp.length >= 3) {
        var irrSum = 0, ampSum = 0;
        for (i = 1; i < partAmp.length - 1; i++) {
          irrSum += Math.abs(partAmp[i] - (partAmp[i - 1] + partAmp[i + 1]) / 2);
          ampSum += partAmp[i];
        }
        f.irregular = ampSum > 1e-12 ? clamp(irrSum / ampSum, 0, 1) : 0;
      }

      /* Spectral slope in dB per octave, least squares over the partials
         that carry energy. */
      var xs = [], ys = [];
      for (i = 0; i < partAmp.length; i++) {
        if (partAmp[i] < pkAmpMax * 0.001 || partHz[i] <= 0) continue;
        xs.push(log2_(partHz[i] / f.f0));
        ys.push(db(partAmp[i] / pkAmpMax));
      }
      if (xs.length >= 3) {
        var mx = mean(xs), my = mean(ys), num = 0, den2 = 0;
        for (i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den2 += (xs[i] - mx) * (xs[i] - mx); }
        f.bandSlope = den2 > 1e-12 ? clamp(num / den2, -60, 6) : 0;
      }

      /* Polyphony estimate. Count spectral peaks well above the local floor
         that are NOT within tolerance of any harmonic of f0. Coarse — a
         single instrument with strong formants can fool it, and a unison
         chord in octaves will hide inside the harmonic series entirely. The
         feature note says so, and the verdict layer treats it as a hint. */
      var extra = 0;
      var floorMag = median(harmMag) * 6 + 1e-9;
      for (k = 3; k < half - 1; k++) {
        if (harmMag[k] <= floorMag) continue;
        if (!(harmMag[k] > harmMag[k - 1] && harmMag[k] >= harmMag[k + 1])) continue;
        var hz = k * binHz, nearest = Math.round(hz / f.f0);
        if (nearest < 1) { extra++; continue; }
        if (Math.abs(cents(hz, nearest * f.f0)) > 60) extra++;
      }
      f.polyphony = clamp(1 + Math.floor(extra / 8), 0, 8);
    } else {
      /* No pitch at all. Harmonicity is 0 and noise is 1 by definition, and
         polyphony is 0 rather than 1 — an unpitched crash has no voices in
         the sense this feature means. */
      f.harmonicity = 0;
      f.noiseRatio = 1;
      f.polyphony = 0;
    }

    // ---------------- broadband ratios from the average spectrum ----------------
    if (totAvg > 1e-12) {
      var subE = 0, hiE = 0;
      for (k = 1; k < half; k++) {
        var hz2 = k * binHz;
        if (hz2 < 120) subE += avgMag[k];
        if (hz2 > 5000) hiE += avgMag[k];
      }
      f.subRatio = clamp(subE / totAvg, 0, 1);
      f.highRatio = clamp(hiE / totAvg, 0, 1);
    }

    f.centroid = mean(centroids);
    f.rolloff = mean(rolloffs);
    f.flatness = mean(flatnesses);
    f.flux = mean(fluxes);
    /* Timbral motion normalised by the centroid itself, so a bright sound
       is not automatically judged to be moving more than a dark one. */
    f.centroidVar = f.centroid > 1 ? clamp(stddev(centroids) / f.centroid, 0, 1) : 0;

    // ---------------- envelope in time ----------------
    var env = new Float64Array(nFrames);
    var envPk = 0;
    for (fr = 0; fr < nFrames; fr++) {
      env[fr] = Math.sqrt(energies[fr] / half);
      if (env[fr] > envPk) envPk = env[fr];
    }

    if (envPk > 1e-9) {
      var pkIdx = 0;
      for (fr = 0; fr < nFrames; fr++) if (env[fr] >= envPk) { pkIdx = fr; break; }

      // attack: 10% -> 90% of peak, before the peak
      var i10 = 0, i90 = pkIdx;
      for (fr = 0; fr <= pkIdx; fr++) { if (env[fr] >= 0.1 * envPk) { i10 = fr; break; } }
      for (fr = i10; fr <= pkIdx; fr++) { if (env[fr] >= 0.9 * envPk) { i90 = fr; break; } }
      f.attack = clamp((i90 - i10) * hop / sr, 0, 4);

      // decay: dB/s from peak to the end, over whatever is left
      if (pkIdx < nFrames - 2) {
        var tailSec = (nFrames - 1 - pkIdx) * hop / sr;
        var endLvl = env[nFrames - 1];
        f.decayRate = tailSec > 0.05 ? clamp((db(endLvl) - db(envPk)) / tailSec, -80, 0) : 0;
      }

      var q = Math.floor(nFrames * 0.75);
      f.sustain = clamp(env[q] / envPk, 0, 1);

      var trem = modulation(Array.prototype.slice.call(env), sr / hop, 0.5, 18);
      var relDepth = envPk > 1e-9 ? trem.depth / envPk : 0;
      f.tremRate = relDepth > 0.05 ? trem.rate : 0;
      f.tremDepth = clamp(relDepth, 0, 1);

      /* Onsets were detected once, up with the segmentation that also needs
         them. One detector, two consumers — a second copy here would drift
         from that one and the two would disagree about how many notes there
         are, which is the sort of split-brain the estate's interchange
         document exists to prevent. */
      f.onsetRate = f.dur > 0.2 ? clamp(onsetCount / f.dur, 0, 40) : 0;
    }

    // ---------------- gross time-domain ----------------
    var peak = 0, sq = 0, zc = 0;
    for (i = 0; i < x.length; i++) {
      var ax = x[i] < 0 ? -x[i] : x[i];
      if (ax > peak) peak = ax;
      sq += x[i] * x[i];
      if (i > 0 && ((x[i] > 0) !== (x[i - 1] > 0))) zc++;
    }
    var rms = Math.sqrt(sq / x.length);
    f.crest = rms > 1e-12 ? clamp(peak / rms, 1, 40) : 1;
    f.zcr = clamp(zc / x.length, 0, 1);

    return {
      version: FEATURE_VERSION,
      sr: sr,
      samples: x.length,
      trimmed: trimmed,
      tooShort: false,
      features: f,
      /* The downmix, kept for anything that needs to look at the audio
         again rather than at a feature — `detectRoot` checks whether the
         pitch it found has any energy of its own. Underscored because it
         is NOT part of the feature contract and no model should read it. */
      _mono: x,
      /* WHERE the representative note is, in samples. Anything re-examining
         the audio must look HERE and not at the middle of the file: on a
         phrase the middle is a different note, and after a decaying pluck
         the middle is silence. Both produced false refusals before this
         existed — the same whole-file mistake this core has now made three
         times in three different places. */
      _repRange: repSeg ? { start: repSeg.start * hop, end: Math.min(x.length, repSeg.end * hop + N) } : null,
      /* The tracked partials of the representative note: amplitude and the
         REFINED frequency of each. Kept because the pluck-position comb is
         a pattern ACROSS partials and cannot be read from any single
         feature. Underscored — not part of the vector contract. */
      /* Guarded, because `partAmp` only exists when a pitch was found —
         it is declared inside the harmonic branch, so on a drum or a noise
         bed it is hoisted and undefined rather than empty. An unpitched
         body has no partials, and the honest value for that is an empty
         list rather than a crash. */
      _partials: (partAmp && partHz)
        ? partAmp.map(function (a, ix) { return { n: ix + 1, amp: a, hz: partHz[ix] }; })
        : [],
      frames: { count: nFrames, hop: hop, fftSize: N, env: env, pitch: pitchHz, centroid: centroids }
    };
  }

  // ==================================================================
  // 4. THE VERDICT — replaceable by design
  // ==================================================================

  /* WHY THERE IS NO "BASS" CLASS.

     There was one, and it was a category error the harness caught. A bass
     note scored 3 for "bass" and 5 for "plucked" and the winner-take-all
     pick called it plucked — which is correct, because a bass note IS a
     plucked string. The two labels were never alternatives. Register is
     orthogonal to family: a bass can be plucked, bowed, blown or
     synthesized, and forcing "low" to compete against "plucked" for the
     same slot means whichever wins, real information is thrown away.

     So register comes out as its OWN field. The verdict says what kind of
     thing it is; the register says where it sits. Routing reads both,
     which is what lets a plucked bass reach PALLBEARER while a synthetic
     sub at the same pitch does not.

     There is a second reason, pointing forward. Register is trivially
     derivable from f0 — a lookup, not a judgement. Leaving it in the
     classification pool would spend a future model's capacity teaching it
     something arithmetic already knows. */
  var CLASSES = [
    { id: 'synthetic',  name: 'Synthetic',            note: 'An oscillator. Nothing physical made this.' },
    { id: 'plucked',    name: 'Plucked or Struck',    note: 'Excited once, then left to ring.' },
    { id: 'bowed',      name: 'Bowed or Sustained String', note: 'Energy kept going in.' },
    { id: 'blown',      name: 'Blown or Reed',        note: 'Air is doing the work.' },
    { id: 'voice',      name: 'Voice',                note: 'Formants that move like a mouth.' },
    { id: 'percussive', name: 'Percussive',           note: 'A hit. Little or no pitch.' },
    { id: 'noise',      name: 'Noise or Texture',     note: 'No periodicity worth the name.' },
    { id: 'ensemble',   name: 'Ensemble or Mix',      note: 'More than one thing at once.' }
  ];

  /* THE SWAP POINT.

     A verdict function takes ONLY a features object and returns
       { klass, confidence, scores, evidence:[{feature, value, reads}] }
     It may not touch samples, spectra, or the report wrapper. Any future
     model — a small MLP over normalizedVector(), a downloaded classifier,
     an inverse-parameter network — implements this signature, is handed to
     setVerdictEngine(), and everything downstream keeps working.

     The rule-based engine below is deliberately written as weighted evidence
     rather than a decision tree, for two reasons. It degrades gracefully
     when one feature is unreliable, and it can SHOW ITS WORKING, which a
     tree cannot and most nets will not. When the neural verdict arrives,
     this stays as the fallback and as the thing its disagreements get
     argued against. */

  function ev(list, feature, value, reads, weight) {
    list.push({ feature: feature, value: value, reads: reads, weight: weight });
  }

  function className(id) {
    for (var i = 0; i < CLASSES.length; i++) if (CLASSES[i].id === id) return CLASSES[i].name;
    return id;
  }

  /* Register — orthogonal to family, and derived rather than judged.

     'sub' and 'bass' both require WEIGHT as well as a low fundamental,
     because a thin 60 Hz buzz with no energy under 120 Hz is not doing a
     bass's job however low its nominal pitch is, and routing it to a bass
     instrument would produce something that sounds nothing like it. */
  function registerOf(f) {
    if (!(f.f0 > 0)) return 'unpitched';
    if (f.f0 < 60 && f.subRatio > 0.2) return 'sub';
    if (f.f0 < 130 && f.subRatio > 0.15) return 'bass';
    if (f.f0 < 130) return 'low';
    if (f.f0 < 520) return 'mid';
    if (f.f0 < 2100) return 'high';
    return 'top';
  }

  function ruleVerdict(f) {
    var s = {};
    for (var i = 0; i < CLASSES.length; i++) s[CLASSES[i].id] = 0;
    var evidence = [];

    var pitched = f.f0 > 0 && f.f0conf > 0.25;

    // ---- unpitched first: it disqualifies most of the rest ----
    if (!pitched) {
      /* Flatness carries LESS weight here than it first appears to deserve.
         Reaching this branch already establishes that nothing periodic was
         found, so a flat spectrum is largely restating the thing we know
         rather than adding to it. Weighted at 3 it tied with the envelope
         evidence on a drum hit — both "noise" and "percussive" scored 3,
         the margin went to zero, and a perfectly obvious snare came back at
         18% confidence. A tie between two readings is a real thing to
         report, but not when one of them is a tautology. */
      if (f.flatness > 0.35) {
        s.noise += 1.5; ev(evidence, 'flatness', f.flatness, 'a flat spectrum with no periodicity in it', 1.5);
      }

      /* THE ACTUAL QUESTION for an unpitched body: did it die, or is it
         still going? That is what separates a hit from a texture, and it
         is a property neither one can fake. */
      if (f.sustain < 0.2 && f.decayRate < -8) {
        s.percussive += 3; ev(evidence, 'sustain', f.sustain, 'it rang out and stopped — a hit, not a texture', 3);
      } else if (f.sustain > 0.4) {
        s.noise += 3; ev(evidence, 'sustain', f.sustain, 'it keeps going — this is texture, not an event', 3);
      }

      if (f.attack < 0.02 && f.decayRate < -12) {
        s.percussive += 2; ev(evidence, 'attack', f.attack, 'instant attack into a fast decay — something was struck', 2);
      }
      if (f.onsetRate > 3) {
        s.percussive += 2; ev(evidence, 'onsetRate', f.onsetRate, f.onsetRate.toFixed(1) + ' hits per second', 2);
      }
    } else {
      /* ---- THE SYNTHETIC TELL ----
         Three things almost never co-occur in an acoustic recording: a pitch
         held to within a few cents, partials that do not stretch at all, and
         a spectrum with essentially no residual noise. Each alone is weak —
         a well-played flute is steady, a nylon string is nearly harmonic, a
         close-mic'd tone can be clean. Together they are close to proof,
         because the physical mechanisms that produce them are different and
         nothing physical suppresses all three at once. */
      /* THE THRESHOLDS, AND WHAT THEY ARE ACTUALLY CALIBRATED ON.

         4 cents was the original bar, set against synthesized bodies with
         no analysis noise in them at all. Real material does not reach it:
         eight NECROPHONE renders — every one of them an oscillator by
         construction — measured 0.9 to 8.1 cents, because frame-to-frame
         tracking noise on real audio costs several cents before the source
         contributes anything. A bar no real synthesizer can clear is not a
         synthetic detector.

         7 and 14 are set from that render set plus two of Ben's own
         recordings at 3.2 and 23.6 cents. That is TEN FILES, which is
         enough to correct an obviously wrong bar and nowhere near enough to
         call these numbers calibrated. The two classes overlap in the real
         data and no threshold here separates them cleanly. Treat the
         synthetic call on real material as a hint rather than a finding —
         and note that this is precisely the sort of boundary a model
         trained on thousands of examples would place better than a person
         placing it by hand, which is the case for the swap point. */
      var synth = 0;
      if (f.f0jitter < 7) {
        synth += 2; ev(evidence, 'f0jitter', f.f0jitter, 'pitch holds to ' + f.f0jitter.toFixed(1) + ' cents — steadier than a hand', 2);
      } else if (f.f0jitter < 14) {
        synth += 0.5;
      } else {
        s.bowed += 1; s.voice += 1; s.blown += 1;
        ev(evidence, 'f0jitter', f.f0jitter, 'pitch wanders ' + f.f0jitter.toFixed(1) + ' cents — a player, not an oscillator', 1);
      }
      if (f.inharm < 0.00005) {
        synth += 1.5; ev(evidence, 'inharm', f.inharm, 'partials are exact multiples — no stiffness, so no string', 1.5);
      }
      if (f.noiseRatio < 0.18) {
        synth += 1.5; ev(evidence, 'noiseRatio', f.noiseRatio, 'almost no residual noise — nothing is breathing or scraping', 1.5);
      }
      if (f.irregular < 0.12 && f.harmonicity > 0.7) {
        synth += 1; ev(evidence, 'irregular', f.irregular, 'partial amplitudes fall smoothly — a waveform, not a body', 1);
      }
      /* CONFIRMED STIFFNESS IS EVIDENCE AGAINST AN OSCILLATOR, not merely
         the absence of evidence for one.

         The scoring originally treated it as absence — B below a threshold
         added to the synthetic case, and B above it simply did not — so a
         plucked string with a clean B=9e-4 fit could still win "synthetic"
         on the strength of its steady pitch and clean spectrum. Plucked
         strings ARE steady and clean; that is not the question. Nothing
         made of oscillators produces partials that stretch according to the
         stiff-string law, so a confirmed fit rules the oscillator out and
         should be allowed to say so.

         Gated on the fit, not on B alone, or the detuned-pad confound would
         come straight back in through this door. */
      if (f.inharm > 0.0002 && f.inharmFit > 0.75) {
        synth -= 2;
      }
      s.synthetic += synth;

      // ---- stiffness says string ----
      if (f.inharm > 0.0002) {
        s.plucked += 2.5; ev(evidence, 'inharm', f.inharm, 'partials stretch sharp — a stiff string under tension', 2.5);
      }

      // ---- envelope says how the energy got in ----
      if (f.attack < 0.03 && f.sustain < 0.35 && f.decayRate < -6) {
        s.plucked += 2.5; ev(evidence, 'sustain', f.sustain, 'struck once and left to die away', 2.5);
      }
      if (f.sustain > 0.55 && f.attack > 0.02) {
        s.bowed += 2; s.blown += 2; s.synthetic += 0.5;
        ev(evidence, 'sustain', f.sustain, 'the note is being held — energy is still going in', 2);

        /* BOWED AGAINST BLOWN, which is the hardest pair here.
           Both are sustained, both carry a bed of noise, both take vibrato,
           and every feature that separates the held family from the struck
           one says the same thing about each. The one honest separator is
           that a bowed string IS a string: it has mass and stiffness, so
           its partials stretch, however slightly. An air column has no
           stiffness to stretch. So a little inharmonicity under a held note
           means something solid is vibrating, and none at all means the
           vibrating thing is air.

           Small numbers on both sides of a small threshold, so this is the
           weakest confident claim in the file, and the pair it decides is
           the one most likely to need the neural verdict. */
        if (f.inharm > 0.00004) {
          s.bowed += 2;
          ev(evidence, 'inharm', f.inharm, 'held, and the partials stretch slightly — something solid is vibrating, not a column of air', 2);
        } else if (f.noiseRatio > 0.12) {
          s.blown += 1.5;
          ev(evidence, 'inharm', f.inharm, 'held, with no stiffness in the partials — and breath under the tone, so air rather than a string', 1.5);
        }
        /* NO STIFFNESS **AND** NO BREATH IS NOT AIR, and this branch used
           to say it was.

           "Held, with no stiffness, therefore an air column" fired on a
           NECROPHONE pad whose noise fraction was EXACTLY 0.00, beat the
           synthetic reading 5.0 to 4.5, and sent an analogue pad to the
           wrong engine. The conclusion contradicted its own evidence: air
           moving through a tube is what makes a wind instrument a wind
           instrument, and there is no such thing as a silent one. A
           perfectly clean spectrum is not weak evidence for a flute, it is
           evidence against any physical source at all — and it is already
           counted, correctly, toward the synthetic case above.

           Absence of stiffness on its own says only "not a string". It
           does not get to name what the thing IS. */
      }

      // ---- vibrato is a hand ----
      if (f.vibRate > 3.5 && f.vibRate < 9 && f.vibDepth > 8) {
        s.bowed += 2; s.voice += 2; s.blown += 1.5; s.synthetic -= 1;
        ev(evidence, 'vibRate', f.vibRate, 'vibrato at ' + f.vibRate.toFixed(1) + ' Hz, ' + Math.round(f.vibDepth) + ' cents deep — played, not programmed', 2);
      }

      // ---- breath ----
      if (f.noiseRatio > 0.3 && f.noiseRatio < 0.7 && f.highRatio > 0.05) {
        s.blown += 2; s.voice += 1;
        ev(evidence, 'noiseRatio', f.noiseRatio, 'a steady bed of noise under the tone — breath or bow', 2);
      }

      // ---- odd-harmonic dominance ----
      if (f.oddEven > 0.75) {
        s.blown += 1.5; ev(evidence, 'oddEven', f.oddEven, 'odd harmonics dominate — a closed pipe, or a square wave', 1.5);
        s.synthetic += 0.5;
      }

      // ---- voice: formants make an irregular but harmonic spectrum that MOVES ----
      if (f.irregular > 0.25 && f.harmonicity > 0.5 && f.centroidVar > 0.12) {
        s.voice += 2.5; ev(evidence, 'centroidVar', f.centroidVar, 'the timbre moves while the pitch holds — formants shifting, like a mouth', 2.5);
      }

      // ---- more than one voice ----
      if (f.polyphony >= 3) {
        s.ensemble += 2; ev(evidence, 'polyphony', f.polyphony, 'strong partials that belong to no single harmonic series', 2);
      }
    }

    // ---- pick a winner ----
    var bestId = 'noise', best = -1, second = -1;
    for (var ci = 0; ci < CLASSES.length; ci++) {
      var id = CLASSES[ci].id;
      if (s[id] > best) { second = best; best = s[id]; bestId = id; }
      else if (s[id] > second) second = s[id];
    }

    /* Confidence is the MARGIN, not the score. A body scoring 9 for plucked
       and 8.5 for bowed is not a confident verdict just because 9 is large;
       it is a coin toss between two readings, and saying so is the whole
       job. Absolute score only sets a floor — a winner scoring 1.5 out of
       nothing is a guess however lonely it is. */
    var margin = best > 0 ? (best - Math.max(second, 0)) / best : 0;
    var floor = clamp(best / 6, 0, 1);
    var confidence = clamp(0.35 * floor + 0.65 * margin, 0, 1);
    if (best <= 0) confidence = 0;

    evidence.sort(function (a, b) { return b.weight - a.weight; });

    return {
      klass: bestId,
      name: className(bestId),
      register: registerOf(f),
      confidence: confidence,
      scores: s,
      evidence: evidence,
      engine: 'rules-v1'
    };
  }

  var _verdictEngine = ruleVerdict;
  function setVerdictEngine(fn) { _verdictEngine = (typeof fn === 'function') ? fn : ruleVerdict; }
  function verdict(f) { return _verdictEngine(f); }

  // ==================================================================
  // 5. THE ROUTING SLIP
  // ==================================================================

  /* Which NECROPHONE engine should take the body.

     The mapping is not arbitrary, it follows what each engine is FOR:
       analog    (The Revenant)      — stable, harmonic, oscillator-shaped
       wavetable (Chorus of Breath)  — harmonic but MOVING in timbre
       granular  (Dust & Ashes)      — noisy, textural, unpitched, or a cloud
       physical  (Bone & Sinew)      — struck or plucked, stiff, decaying */
  function chooseEngine(f, klass) {
    if (klass === 'noise' || klass === 'percussive' || f.flatness > 0.4) return 'granular';
    if (klass === 'plucked' || f.inharm > 0.0002) return 'physical';
    if (f.centroidVar > 0.18 || f.flux > 0.12) return 'wavetable';
    if (klass === 'voice' || klass === 'blown') return 'wavetable';
    return 'analog';
  }

  var MIDI_A4 = 69, A4_HZ = 440;
  function hzToMidi(hz) { return hz > 0 ? MIDI_A4 + 12 * log2_(hz / A4_HZ) : 0; }
  function noteName(hz) {
    if (!(hz > 0)) return '—';
    var names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    var m = Math.round(hzToMidi(hz));
    return names[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  /* NECROPHONE's Dust & Ashes assumed every corpse already sings G3 until
     R14-101 added corpseRoot as a semitone OFFSET. G3 is MIDI 55. The offset
     we want is therefore (detected - 55), which is exactly the quantity
     rootOffsetFromHz computes in the browser. Recomputed here rather than
     imported because this core cannot reach into necrophone.html — and if
     the two ever disagree, the parity gate is the place that should say so,
     not a silent drift in a patch. */
  var CORPSE_REF_MIDI = 55;
  function corpseRootOffset(hz) {
    if (!(hz > 0)) return 0;
    return clamp(Math.round(hzToMidi(hz) - CORPSE_REF_MIDI), -48, 48);
  }

  function routeToNecrophone(f, v) {
    var engine = chooseEngine(f, v.klass);
    var p = {};

    p.engine = engine;

    // pitch of the source material, so a loaded corpse plays in tune
    if (f.f0 > 0) p.corpseRoot = corpseRootOffset(f.f0);

    /* Filter from measured brightness. The rolloff is a better target than
       the centroid for a lowpass corner — the centroid is a balance point
       with half the energy above it, so setting a corner there audibly
       darkens the sound relative to the source. */
    if (f.rolloff > 0) p.cut = clamp(Math.round(f.rolloff), 60, 14000);

    // envelope, straight off the measurements
    p.atk = clamp(san(f.attack, 0.01), 0.001, 2);
    p.sus = clamp(san(f.sustain, 0.7), 0, 1);
    if (f.decayRate < 0) {
      // time to fall 60 dB at the measured rate, as a decay length
      p.dec = clamp(60 / Math.abs(f.decayRate), 0.01, 3);
    }

    // vibrato becomes an LFO, at the rate that was actually measured
    if (f.vibRate > 0) {
      p.lfo1Rate = clamp(f.vibRate, 0.01, 20);
    }

    // noise and motion push the engine's own controls
    if (engine === 'granular') {
      p.grSpray = clamp(f.flatness, 0, 1);
      p.grDrift = clamp(f.centroidVar, 0, 1);
      p.grDens = clamp(Math.round(8 + f.onsetRate * 2), 4, 60);
    } else if (engine === 'physical') {
      p.phDecay = clamp(0.9 + f.sustain * 0.09, 0.8, 0.999);
      p.phHard = clamp(1 - f.attack * 8, 0, 1);
      p.phBody = clamp(Math.round(f.centroid * 1.5), 600, 9000);
    } else if (engine === 'analog') {
      p.anWave = f.oddEven > 0.7 ? 'square' : 'sawtooth';
      p.anDet = clamp(Math.round(f.f0jitter * 1.5), 0, 40);
      p.anSub = clamp(f.subRatio, 0, 1);
    } else if (engine === 'wavetable') {
      p.wtMor = clamp(f.centroidVar * 3, 0, 1);
      p.wtBlm = clamp(Math.round(4 + f.highRatio * 60), 2, 40);
    }

    // a voice-like source gets the formant stage opened
    if (v.klass === 'voice') p.formant = clamp(0.4 + f.irregular, 0, 1);

    return { target: 'NECROPHONE', engine: engine, params: p };
  }

  function routeToPallbearer(f, v) {
    var p = {};

    /* Style from the attack. A slap has a violent transient and a lot of
       high energy; a finger pluck does not; a pick sits between. These
       thresholds are honest guesses calibrated against PALLBEARER's own
       rendered styles in the harness, not against a library of real basses,
       and that limitation belongs in the report. */
    if (f.attack < 0.006 && f.highRatio > 0.12) p.style = 'slap';
    else if (f.attack < 0.012 && f.highRatio > 0.06) p.style = 'pick';
    else if (f.sustain < 0.12) p.style = 'muted';
    else p.style = 'finger';

    p.inharm = clamp(f.inharm * 400, 0, 1);
    p.decay = clamp(f.decayRate < -0.5 ? 60 / Math.abs(f.decayRate) : 4.5, 0.5, 12);
    p.damping = clamp(1 - f.sustain, 0, 1);
    p.hardness = clamp(1 - f.attack * 40, 0, 1);
    p.tone = clamp(Math.round(f.rolloff), 200, 12000);
    p.noise = clamp(f.noiseRatio * 1.2, 0, 1);
    p.drive = clamp(Math.max(0, f.crest < 6 ? (6 - f.crest) * 0.08 : 0), 0, 1);

    /* PLUCK POSITION — measured now, and emitted ONLY when it was.

       The earlier note here said a wrong answer moves the sound's whole
       character and left the default alone. That instinct was right and it
       survives: `pluckPos` is written only when the comb actually
       determined it. When the first null falls beyond the trackable
       partials — a pluck near the bridge — there is nothing to measure,
       and PALLBEARER's own default is a better answer than a confident
       guess. Silence is the correct output of an undetermined
       measurement. */
    /* NOT EMITTED. The measurement exists and is reported as a feature;
       it is deliberately NOT written into the patch. See `pluckPosition`
       for the measured reason — the estimate has real ambiguities that no
       threshold separates, and PALLBEARER's `sanitize()` cannot report, so
       a wrong value would arrive, be accepted, and silently change the
       character of the sound.

       The original note here declined to guess. It was right, and the only
       thing that has changed is that the decline is now backed by a
       measurement instead of an instinct. */

    /* ⚠ `couple` IS DELIBERATELY NOT EMITTED, and this comment is the
       guard rail.

       PALLBEARER's seam document records that String Coupling can
       self-oscillate, and that the slip is safe today "by omission rather
       than by design" — with the warning that a stiffness measurement is
       exactly the feature that would tempt someone to add coupling next.
       That temptation is now real: this function measures stiffness AND
       pluck position, which is precisely the pair that makes `couple` look
       like the obvious third.

       Do not add it here. Fix the self-oscillation in PALLBEARER first,
       then add it — in that order, before the line is written rather than
       after a patch that drones. */

    return { target: 'PALLBEARER', engine: 'modelled', params: p };
  }

  /* THE DELIBERATE SPLIT — worth reading before "why didn't my bass go to
     PALLBEARER".

     Low pitch does NOT route to PALLBEARER on its own. PALLBEARER models a
     physical instrument and only a physical instrument: a vibrating string
     with stiffness, a body, pickups. Handing it a clean synthetic sub asks
     it to make a sound it has no mechanism for, and it will return
     something plausible and wrong. NECROPHONE's Revenant makes that sound
     directly.

     So the question at this fork is not "is it low" but "is it physical".
     A low note that is dead steady, exactly harmonic and silent between
     the partials is an oscillator that happens to be low, and it goes to
     the synthesizer. A low note with stiffness, finger noise and a hand's
     worth of pitch wobble goes to the bass. */
  /* PHYSICAL families only. A synthetic sub and an unpitched rumble are
     both low, and neither is something PALLBEARER has a mechanism for. */
  var PHYSICAL_STRING = { plucked: 1, bowed: 1 };

  function route(features, v) {
    v = v || verdict(features);
    /* A replacement verdict engine is not obliged to report a register, so
       derive it when it is missing rather than treating absence as 'not
       bass'. Routing must not depend on which classifier is installed. */
    var reg = v.register || registerOf(features);
    var toBass = (reg === 'bass' || reg === 'sub') && !!PHYSICAL_STRING[v.klass];

    var slip = toBass ? routeToPallbearer(features, v) : routeToNecrophone(features, v);
    slip.why = toBass
      ? 'A ' + reg + '-register note with stiffness and a real attack — PALLBEARER models this from physics rather than resynthesising it.'
      : 'Routed to NECROPHONE\'s ' + slip.engine + ' engine: ' + engineReason(features, slip.engine) + '.';
    slip.klass = v.klass;
    slip.register = reg;
    slip.confidence = v.confidence;
    return slip;
  }

  function engineReason(f, engine) {
    if (engine === 'granular') return 'the spectrum is flat and textural, which is what Dust & Ashes is for';
    if (engine === 'physical') return 'stiff, decaying partials — Bone & Sinew models exactly this';
    if (engine === 'wavetable') return 'the timbre moves while the pitch holds, which is Chorus of Breath\'s whole business';
    return 'stable and harmonic, which The Revenant does most directly';
  }

  // ==================================================================
  // 6. THE HANDOFF — a link the target already knows how to open
  // ==================================================================

  /* NECROPHONE's task-17 share format, reproduced exactly:
       #p= + base64url( JSON({v:1, p:<params that differ from default>}) )
     Reproduced rather than imported because that encoder lives inside
     necrophone.html and this core must stay portable. The format is three
     lines long and frozen by a `v:1` stamp; the risk of drift is small and
     the release check can be taught to compare them.

     Deliberately NOT included: loaded audio. The share format leaves corpse
     audio out because a URL cannot carry it, and a routing slip that
     silently dropped the sample it was derived from would be worse than one
     that never claimed to carry it. */
  function b64urlEncode(s) {
    var b;
    if (typeof btoa === 'function') b = btoa(unescape(encodeURIComponent(s)));
    else b = Buffer.from(s, 'utf8').toString('base64');
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function shareLink(params, baseUrl) {
    return (baseUrl || '') + '#p=' + b64urlEncode(JSON.stringify({ v: 1, p: params }));
  }

  function necrophoneLink(slip, baseUrl) {
    if (!slip || slip.target !== 'NECROPHONE') return null;
    return shareLink(slip.params, baseUrl || 'necrophone.html');
  }

  /* PALLBEARER'S HALF OF THE PROMISE, kept at last.

     CORONER's README has always said: drop a file on the slab, read the
     report, click through to NECROPHONE **or PALLBEARER** with a patch
     already waiting. For months that was true of one of the two names.
     PALLBEARER had no hash reader at all — no `location.hash`, no `atob`,
     nothing — so a correct, in-range, fully measured PALLBEARER patch was
     computed and then had nowhere to go. CORONER handed the user JSON to
     paste into a console.

     PALLBEARER built the reader on 2026-09-01 and said so in the
     Interchange. It takes the same shape NECROPHONE does — `#p=` plus
     base64url of `{v:1, p:<delta from defaults>}` — and refuses an unknown
     major `v` rather than half-loading it, which is the same reasoning its
     plugin already applied to saved state. So one encoder serves both
     instruments, which is why `shareLink` above is now shared rather than
     duplicated per target.

     Gated against their REAL decoder, not against this description of it:
     `tests/pallbearer_link.js` lifts `loadPatchFromHash` and `b64urlDecode`
     out of `pallbearer.html` and round-trips a live slip through them. */
  function pallbearerLink(slip, baseUrl) {
    if (!slip || slip.target !== 'PALLBEARER') return null;
    return shareLink(slip.params, baseUrl || 'PALLBEARER/pallbearer.html');
  }

  /* One call that does not care which instrument won the fork. The test bed
     uses this so the two branches stop being special cases. */
  function handoffLink(slip, opts) {
    opts = opts || {};
    if (!slip) return null;
    if (slip.target === 'NECROPHONE') return necrophoneLink(slip, opts.necrophone);
    if (slip.target === 'PALLBEARER') return pallbearerLink(slip, opts.pallbearer);
    return null;
  }

  // ------------------------------------------------------------------
  // 6b. THE PACK — the handoff that carries the body with it
  // ------------------------------------------------------------------

  /* WHY A PACK AND NOT A LINK.

     The `#p=` link above works and is measured clean — 19 ids, every clamp
     matching, nothing dropped in transit. It also cannot carry audio, and
     that turns out to matter more than it sounds:

       · `corpseRoot` is a semitone offset measured from THIS sample, and it
         arrives at a NECROPHONE that opened on its own default source. The
         offset is correct and lands on the wrong material.
       · Dust & Ashes is chosen precisely when the material is textural, so
         the granular route is the one that needs the audio MOST and, over a
         URL, is the one that gets it least. It arrives with an engine
         selected and nothing to grind.

     A pack carries the sample. Both faults close at once, and it opens in
     the DAW, because NECROPHONE's R15 work already built the receiving half
     (`parsePackText` / `applyPackPatch`) and the plugin reads `material`,
     `materialEnc`, `materialRate` and `materialName` straight off the patch.

     REPRODUCED, NOT IMPORTED. The encoder lives inside `necrophone.html`
     and this core stays portable, so the codec below is a byte-exact port
     rather than a call. That is only safe because it is GATED: the harness
     lifts NECROPHONE's real `compressCorpseArr` out of the HTML and proves
     the two agree byte for byte, and feeds the result to its real
     `decodePack`. A reproduced format with no gate is two copies of a rule
     drifting apart, which is this estate's oldest defect. */

  function b64Standard(u8) {
    if (typeof btoa === 'function') {
      var bin = '', CH = 0x8000;
      for (var j = 0; j < u8.length; j += CH) {
        bin += String.fromCharCode.apply(null, u8.subarray(j, j + CH));
      }
      return btoa(bin);
    }
    return Buffer.from(u8).toString('base64');
  }

  /* Byte-exact port of NECROPHONE's `compressCorpseArr`. Every oddity here
     is deliberate and load-bearing for parity:

       · the target rate is 16 kHz, and the decimation is a naive
         `floor(i * ratio)` pick — NOT a resample. Averaging or filtering
         would sound better and would not be the same bytes.
       · `|| 0` catches NaN, undefined and a read past the end. It also maps
         -0 to 0, which is correct here and is why it is not `isFinite`.
       · the i16 scale is ASYMMETRIC — `*32768` below zero, `*32767` at or
         above — so the full negative rail is reachable and the positive one
         is not. This is the single most copied-wrong line in any audio
         codec, and NECROPHONE's C++ twin already had to match it once. */
  function compressCorpse(m, srcRate) {
    if (!m || !m.length) return null;
    var dstRate = 16000;
    var srcR = srcRate || 48000;
    var ratio = srcR / dstRate;
    var outLen = Math.max(1, Math.floor(m.length / ratio));
    var i16 = new Int16Array(outLen);
    for (var i = 0; i < outLen; i++) {
      var v = m[Math.floor(i * ratio)] || 0;
      if (v > 1) v = 1; else if (v < -1) v = -1;
      i16[i] = v < 0 ? v * 32768 : v * 32767;
    }
    return { data: b64Standard(new Uint8Array(i16.buffer)), rate: dstRate, enc: 'i16' };
  }

  function clipStr(v, cap, dflt) {
    var t = ('' + (v == null ? '' : v)).replace(/\s+/g, ' ').trim().slice(0, cap);
    return t || dflt;
  }

  /* Build a `pack-1.0` document around a routing slip.

     opts.samples  — the mono audio the report was taken from (optional)
     opts.sr       — its sample rate
     opts.name     — what to call the sound
     opts.report   — the full report, so the note can quote the verdict

     `created` is deliberately 0 rather than a timestamp. This core reads no
     clock anywhere, because the same input must produce the same bytes or
     there can be no regression baseline — and `normalizePackMeta` already
     treats 0 as "unset" rather than as 1970.

     No `sigil` is emitted. NECROPHONE's decoder mints one from the pack name
     when it is absent, so reproducing `packSigil` would add a second copy of
     a rule for no gain. Omission is the honest option here. */
  function necrophonePack(slip, opts) {
    if (!slip || slip.target !== 'NECROPHONE') return null;
    opts = opts || {};

    var name = clipStr(opts.name, 72, 'An Examined Sound');
    var patch = { name: name, params: slip.params };

    var v = opts.report && opts.report.verdict;
    var note = v
      ? clipStr(v.name + ' at ' + Math.round((v.confidence || 0) * 100) + '% — ' + (slip.why || ''), 300, '')
      : clipStr(slip.why, 300, '');
    if (note) patch.note = note;

    var tags = ['coroner'];
    if (slip.klass) tags.push(slip.klass);
    if (slip.register && slip.register !== 'unpitched') tags.push(slip.register);
    if (slip.engine) tags.push(slip.engine);
    patch.tags = tags;

    var carried = false;
    if (opts.samples && opts.samples.length) {
      var c = compressCorpse(opts.samples, opts.sr);
      if (c) {
        patch.material = c.data;
        patch.materialEnc = c.enc;
        patch.materialRate = c.rate;
        patch.materialName = name;
        carried = true;
      }
    }

    return {
      necrophone: 'pack-1.0',
      name: 'CORONER — ' + name,
      author: 'CORONER',
      description: clipStr(
        carried
          ? 'Examined and routed by CORONER. The sample travels with the patch, so the corpse root lands on the material it was measured from.'
          : 'Examined and routed by CORONER. No audio was carried, so the corpse root refers to material NECROPHONE does not have.',
        900, ''),
      created: 0,
      patches: [patch],
      corpses: []
    };
  }

  // ==================================================================
  // 6c. THE ROOT — what a corpse actually sings
  // ==================================================================

  /* A detector built for one job: NECROPHONE needs to know what pitch a
     loaded sample sings, so `corpseRoot` can be set for the user instead
     of found by ear.

     NECROPHONE has its own (`detectPitchHz`), and it is honest about what
     it is: plain autocorrelation over a FIXED QUARTER-SECOND taken from
     the middle of the buffer, on the reasoning that attacks and tails are
     the least tonal parts. That reasoning is sound and the implementation
     has three problems it cannot see from inside:

       1. IT HOPES THE WINDOW LANDS INSIDE ONE NOTE. On a phrase, a riff,
          or any sample with more than one pitch in it, the middle quarter
          second may straddle a note boundary — and a window containing two
          pitches has no period that fits either.
       2. AUTOCORRELATION READS A STIFF STRING SHARP. Measured here at 31
          cents on a synthetic B=8e-4 body. That is real physics rather
          than a coding fault — stretched partials have no common period —
          but a piano sample tuned 31 cents sharp is out of tune with
          everything else in the session.
       3. A QUARTER SECOND IS ALL THE EVIDENCE IT EVER SEES, however long
          the sample is and however much better some other part of it is.

     This one segments the whole file into notes, picks the longest stable
     one, and solves pitch and stiffness TOGETHER so the stretch is fitted
     rather than absorbed into the pitch. It also refuses out loud.

     Returns `{ hz, note, corpseRoot, confidence, refused, why }` — and
     `refused` is the field a caller must read. A wrong confident answer
     is worse than none, which is NECROPHONE's own stated rule for its
     detector and is inherited here deliberately. */
  // ------------------------------------------------------------------
  // 6d. PLUCK POSITION — where the string was excited
  // ------------------------------------------------------------------

  /* Pluck a string at fraction p of its length and the initial shape is a
     triangle with its apex there. Its harmonic amplitudes are

         A_n  ∝  |sin(n·π·p)| / n²

     so every harmonic whose number is a multiple of 1/p is MISSING. That
     comb of nulls is where an instrument's character largely lives —
     PALLBEARER's own notes say the pickup comb matters more than the
     string model — and it is measurable, which is why the slip no longer
     has to decline to guess.

     THE METHOD IS A MATCHED FILTER, not a search for individual nulls.
     Any one partial can be weak for a dozen reasons; the pattern across
     all of them is what carries p. The measured amplitudes have their own
     smooth spectral envelope removed first (a moving median in the log
     domain), because that envelope belongs to the source and the comb is
     the residual riding on it — and the SAME removal is applied to each
     candidate prediction, so the two are compared on equal terms.

     WHAT IT CANNOT DO, and this is physics rather than a limitation to be
     tuned away: nulls appear at n = k/p, so a pluck very close to the
     bridge puts its FIRST null beyond the partials that can be tracked at
     all. Measured on ideal plucks, p = 0.05 has a single null at partial
     20 and is recovered as 0.38 — confidently wrong, if allowed to be.
     Fewer than two nulls in range means p is not determined, and that is
     refused rather than reported. */
  function pluckPosition(parts, maxN) {
    if (!parts || parts.length < 8) return null;

    var used = [], mx = 0, i, j;
    for (i = 0; i < parts.length; i++) {
      if (parts[i].amp > 0 && parts[i].hz > 0) { used.push(parts[i]); if (parts[i].amp > mx) mx = parts[i].amp; }
    }
    if (mx <= 0) return null;
    /* FIT ONLY OVER PARTIALS THAT CARRY SIGNAL.

       The first floor here was 1e-4 of the peak, which on a real decaying
       bass admits twenty partials of pure noise floor — and the matched
       filter then correlates the comb against noise. Measured: a 49 Hz
       body plucked at 0.16 came back 0.300 at a fit of 0.77, because the
       garbage partials happened to favour a different period.

       1e-3 is where a 1/n² series still has real content (partial 31 sits
       at 1/961 ≈ 0.001) and where the measurement noise on these bodies
       begins. Partials below it are not weak evidence, they are no
       evidence. */
    used = used.filter(function (q) { return q.amp > mx * 1e-3; });
    if (used.length < 10) return null;

    function deTrend(arr) {
      var out = [];
      for (var a = 0; a < arr.length; a++) {
        var lo = Math.max(0, a - 3), hi = Math.min(arr.length - 1, a + 3), w = [];
        for (var b = lo; b <= hi; b++) w.push(arr[b]);
        w.sort(function (x, y) { return x - y; });
        out.push(arr[a] - w[w.length >> 1]);
      }
      return out;
    }

    var resid = deTrend(used.map(function (q) { return _NM.log(q.amp / mx); }));

    var best = null;
    for (var p = 0.02; p <= 0.5001; p += 0.001) {
      var pred = [];
      for (i = 0; i < used.length; i++) {
        var sv = Math.abs(_NM.sin(used[i].n * Math.PI * p));
        pred.push(_NM.log(sv < 1e-4 ? 1e-4 : sv));
      }
      var pres = deTrend(pred);
      var ma = 0, mb = 0;
      for (i = 0; i < resid.length; i++) { ma += resid[i]; mb += pres[i]; }
      ma /= resid.length; mb /= pres.length;
      var num = 0, da = 0, db = 0;
      for (i = 0; i < resid.length; i++) {
        var A = resid[i] - ma, B = pres[i] - mb;
        num += A * B; da += A * A; db += B * B;
      }
      var r = (da > 1e-12 && db > 1e-12) ? num / Math.sqrt(da * db) : 0;
      if (!best || r > best.r) best = { p: p, r: r };
    }
    if (!best) return null;

    /* HOW MUCH COMB IS ACTUALLY IN VIEW — and this must be counted over
       partials that CARRY ENERGY, not over partials that were tracked.

       The tracker returns a slot for every harmonic it looked for, so a
       body with eight real partials still reports thirty-two, most of them
       noise floor. Counting nulls across those thirty-two says the comb is
       well sampled when it is not, and the result is the same confidently
       wrong answer the near-bridge case gives, arriving by a different
       road. Measured: an eight-partial body plucked at 0.16 recovers as
       0.444 at a fit of 0.89, and a real low bass with only twelve
       energetic partials recovers 0.16 as 0.300 at 0.77.

       ⚠ AND THE HONEST LIMIT, which is why this does not reach the patch.

       Swept across pluck positions and partial counts on ideal bodies,
       the error is NOT a clean function of how much comb is visible:

           partials |  p=0.11   p=0.16   p=0.22   p=0.30   p=0.40
                 12 |    X        ok       ok       ok       ok
                 20 |    ok       ok       ok       ok       ok
                 32 |    ok       ok       ok       X        ok

       The failures are ALIASES. A comb at p and one at p/2 share half
       their nulls, so when only some nulls fall inside the trackable
       range, two positions explain the same evidence and the correlation
       picks whichever noise favours. That is an identifiability problem,
       not a tuning problem, and no threshold on partial count separates
       it — a bar that made p=0.11 safe would still let p=0.30 through.

       So the guard below makes the measurement STRICT rather than
       correct: when it speaks it is usually right, and it is reported with
       its fit so a reader can weigh it. It is not written into the
       PALLBEARER patch, because `sanitize()` there cannot report, and a
       confident wrong pluck position would be accepted in silence and move
       the whole character of the sound. Reporting a measurement and
       ACTING on it are different bars, and this clears the first. */
    var useful = used.length, topN = used[used.length - 1].n;
    var nullsInView = Math.floor(topN * best.p);

    return {
      p: clamp(best.p, 0.02, 0.5),
      fit: clamp(best.r, 0, 1),
      nulls: nullsInView,
      usefulPartials: useful,
      measurable: useful >= 20 && nullsInView >= 2 && best.r >= 0.6
    };
  }

  /* How much energy sits at the claimed fundamental, against the strongest
     partial of its own series. Taken from a window in the middle of the
     material — the same place NECROPHONE's detector looks, deliberately,
     so the two are judged on the same evidence.

     The band is +-3%, wide enough to hold a partial that has drifted or
     been stretched and narrow enough not to reach its neighbours. */
  function fundamentalStrength(rep, f0, sr) {
    if (!(f0 > 0) || !rep || !rep.frames) return 1;
    var mono = rep._mono;
    if (!mono || !mono.length) return 1;

    /* Look at the note the pitch CAME from, not at the middle of the file. */
    var lo = 0, hi = mono.length;
    if (rep._repRange) { lo = rep._repRange.start; hi = rep._repRange.end; }
    var span = hi - lo;
    if (span < 256) { lo = 0; hi = mono.length; span = hi - lo; }

    var N = 4096;
    if (span < N) N = 1 << Math.floor(log2_(span));
    if (N < 256) return 1;
    var off = lo + Math.floor(span / 2 - N / 2);
    if (off < lo) off = lo;
    if (off + N > mono.length) off = Math.max(0, mono.length - N);
    var frame = new Float64Array(N);
    for (var i = 0; i < N && off + i < mono.length; i++) frame[i] = mono[off + i];

    var mag = magSpectrum(frame, N), binHz = sr / N;
    function band(hz) {
      var lo = Math.max(1, Math.round((hz * 0.97) / binHz));
      var hi = Math.min(mag.length - 1, Math.round((hz * 1.03) / binHz));
      var s = 0;
      for (var k = lo; k <= hi; k++) s += mag[k];
      return s;
    }
    var first = band(f0), strongest = 0;
    for (var n = 1; n <= 16; n++) {
      if (n * f0 > sr * 0.45) break;
      var b = band(n * f0);
      if (b > strongest) strongest = b;
    }
    return strongest > 1e-12 ? first / strongest : 0;
  }

  function detectRoot(input, sr, opts) {
    opts = opts || {};
    var rep = examine(input, sr, { fftSize: opts.fftSize || 2048, maxSeconds: opts.maxSeconds || 20 });
    var f = rep.features;

    function refuse(why) {
      return { hz: 0, note: '—', corpseRoot: 0, confidence: 0, refused: true, why: why,
               noteCount: f.noteCount || 0 };
    }

    if (rep.tooShort) return refuse('too short to examine');
    if (!(f.f0 > 0)) return refuse('nothing periodic — a drum, a texture, or silence');

    /* FLATNESS ALONE IS NOT NOISE, and reading it that way over-refused.
       A breathy note measured flatness 0.497 and was thrown out, while its
       pitch was dead right — because breath IS broadband, and a flute is
       not a cymbal. What separates them is whether anything harmonic is
       left underneath: measured, a breathy note holds harmonicity 0.655
       and white noise holds 0.000. */
    if (f.flatness > 0.42 && f.harmonicity < 0.4) {
      return refuse('the spectrum is flat with nothing harmonic under it — noise, not a note');
    }

    /* Not enough of the audible material agreed on a pitch. Note this is
       measured over AUDIBLE frames, not all of them, so a note followed by
       silence is not punished for the silence. */
    if (f.f0conf < 0.35) return refuse('only ' + Math.round(f.f0conf * 100) + '% of the audible material held a pitch');

    /* ⚠ THE PHANTOM SUBHARMONIC — how a chord gets a confident wrong root.

       Given a chord, a period-based tracker does not fail. It succeeds, at
       a frequency that is not in the sound. Handed 220 + 277 + 330 Hz it
       returned **53.9 Hz** with full confidence and harmonicity 0.842,
       because a period four times too long fits all three notes at once.
       NECROPHONE's own detector returned 55.1 Hz on the same body. Nothing
       about the answer looks wrong except that there is no 54 Hz in the
       recording.

       Counting extra spectral peaks does not catch it — `polyphony` read 1,
       because once you accept the subharmonic every one of those notes IS
       a harmonic of it. The tell is simpler and physical: **is there any
       energy at the pitch it claims?** A real fundamental has some, even a
       deliberately weak one. A phantom has none.

       Measured, with the threshold in the middle of the gap rather than on
       a sample:

         a clean note                 1.0000
         a breathy note               1.0000
         a stiff string               1.0000
         a low bass at 45 Hz          1.0000
         a note with a WEAK           0.2562
           fundamental (rising slope)
         ------------------- 0.03 ---------------------
         a two-note chord             0.0003
         a three-note chord           0.0000                                */
    var fs = fundamentalStrength(rep, f.f0, sr);
    if (fs < 0.03) {
      return refuse('the pitch that fits is ' + f.f0.toFixed(1) + ' Hz, and there is no energy there — ' +
                    'a period that fits several notes at once, which is what a chord produces');
    }

    /* CONFIDENCE, and what it is built from. Not the raw pitch-tracker
       score: how much of the material agreed, how harmonic it turned out
       to be, and — reported rather than hidden — how much of the file was
       ONE note rather than many. A sample containing a whole riff can have
       a perfectly well-measured root and still be a poor thing to set a
       single `corpseRoot` from. */
    var agree = clamp(f.f0conf, 0, 1);
    var harm = clamp(f.harmonicity, 0, 1);
    var single = f.noteCount <= 1 ? 1 : clamp(1.4 / f.noteCount, 0, 1);
    var conf = clamp(0.45 * agree + 0.35 * harm + 0.20 * single, 0, 1);

    var why = f.noteCount > 1
      ? ('measured on the longest of ' + f.noteCount + ' notes')
      : 'measured on a single held note';
    if (f.inharm > 2e-4 && f.inharmFit > 0.75) {
      why += ', with stiffness fitted rather than absorbed into the pitch';
    }

    return {
      hz: f.f0,
      note: noteName(f.f0),
      corpseRoot: corpseRootOffset(f.f0),
      confidence: conf,
      refused: false,
      why: why,
      noteCount: f.noteCount,
      inharm: f.inharm,
      inharmFit: f.inharmFit
    };
  }

  // ==================================================================
  // 7. THE WHOLE AUTOPSY
  // ==================================================================

  function autopsy(input, sr, opts) {
    var rep = examine(input, sr, opts);
    if (rep.tooShort) {
      rep.verdict = { klass: 'noise', name: 'Too short to examine', confidence: 0, scores: {}, evidence: [], engine: 'none' };
      rep.slip = null;
      return rep;
    }
    rep.verdict = verdict(rep.features);
    rep.slip = route(rep.features, rep.verdict);
    rep.vector = featureVector(rep.features);
    rep.normalized = normalizedVector(rep.features);
    return rep;
  }

  return {
    VERSION: '0.1',
    FEATURE_VERSION: FEATURE_VERSION,
    FEATURES: FEATURES,
    FEATURE_BY_ID: FEATURE_BY_ID,
    CLASSES: CLASSES,

    // layer 1
    examine: examine,
    featureVector: featureVector,
    normalizedVector: normalizedVector,

    // layer 2
    verdict: verdict,
    ruleVerdict: ruleVerdict,
    setVerdictEngine: setVerdictEngine,

    // layer 3
    route: route,
    chooseEngine: chooseEngine,
    necrophoneLink: necrophoneLink,
    pallbearerLink: pallbearerLink,
    handoffLink: handoffLink,
    necrophonePack: necrophonePack,
    compressCorpse: compressCorpse,
    detectRoot: detectRoot,

    // the lot
    autopsy: autopsy,

    // exposed because the harness tests them directly, and because a future
    // twin needs them addressable one at a time
    _fft: fft,
    _magSpectrum: magSpectrum,
    _yinF0: yinF0,
    _modulation: modulation,
    _toMono: toMono,
    _hann: hann,
    _cents: cents,
    _median: median,
    _stddev: stddev,
    _corpseRootOffset: corpseRootOffset,
    _hzToMidi: hzToMidi,
    _noteName: noteName,
    _b64urlEncode: b64urlEncode
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CR;
