/* ============================================================
   RIGOR — DSP core (single source of truth)
   "the body stops moving."
   v0.1 · Phase 1 · 2026-08-15
   Embedded VERBATIM into rigor.html by rigor_sync.js and ported to
   C++ in RigorCore.h (Phase 2).
   DEPENDS ON: shared/necromath.js (NM), shared/necrodyn.js (ND) —
   both injected as IIFE args.
   RULES: doubles everywhere · no host APIs · deterministic ·
   never a literal closing script tag, even in comments.
   ============================================================ */
var RIGOR = (function (NM, ND) {
  'use strict';

  var VERSION = '0.5';
  var CTRL = 32;          // control-rate block (samples)
  var SMOOTH = 0.25;      // per-control-block param smoothing
  var SNAP = 1e-9;
  var MAX_LOOK_MS = 20;
  /* The peak follower's own decay. 15 ms is the house default; a style may
     override it via STYLE[x].pkMs, and Spasm does — see the detector, and
     see the note on the style table about why that override is the whole
     difference between Spasm and Fresh. */
  var PEAK_DECAY_MS = 15;

  var STYLES = ['fresh', 'settling', 'spasm', 'repose'];
  var DETECTS = ['auto', 'peak', 'rms'];
  var PLACES = ['lr', 'ms'];
  var MAX_BANDS = 3;
  /* Note divisions for tempo-synced release. Index 0 is "off, use ms".
     The tempo comes from state, never from a host callback, so a synced
     release is still a PURE function of the case file — which is what
     keeps byte-stable regression possible. */
  var SYNC_DIV = [0, 1 / 32, 1 / 16, 1 / 8, 3 / 16, 1 / 4, 3 / 8, 1 / 2, 3 / 4, 1, 2];
  var SYNC_NAMES = ['off', '1/32', '1/16', '1/8', '1/8.', '1/4', '1/4.', '1/2', '1/2.', '1 bar', '2 bars'];
  /* release time in ms, resolving the sync setting */
  function releaseMs(st) {
    if (!st.relSync) return st.release;
    var beats = SYNC_DIV[st.relSync] * 4;          // divisions are of a bar
    return clamp(beats * 60000 / st.bpm, 1, 2500);
  }
  var DNF = 1e-30;

  /* Flush denormals. Sub-1e-30 values in an IIR state cost 50-100x on some
     CPUs and are inaudible by many orders of magnitude. Applied IDENTICALLY
     in the C++ twin — it changes the arithmetic, so it is part of the
     contract (INTERCHANGE law 2's cousin), not an optimisation the port
     may quietly skip. */
  function dn(v) { return (v < DNF && v > -DNF) ? 0 : v; }

  /* ---------- the four topologies ----------
     Not presets. `topo`, `detect`, `smoothLevel` and `levelAttack` each
     change the signal path, and no knob exposes them.
       topo        'ff' feedforward | 'fb' feedback (detector reads the
                   output, i.e. the input scaled by the previous sample's
                   gain — one-sample delay makes it causal and stable)
       smoothLevel true  = envelope BEFORE the gain computer (classic:
                           attack time varies with overshoot, which is
                           exactly an optical cell's charm)
                   false = envelope AFTER it, on the gain itself, so
                           attack means one thing regardless of ratio
       levelAttack the attack coefficient is recomputed from the current
                   overshoot — program dependence in the attack, not just
                   the release
       pkMs        the peak follower's decay. This is a PATH property, not a
                   default: it is not on the panel and no case file carries
                   it. Spasm's 2 ms against the house 15 ms is what makes it
                   a topology rather than a preset — a short decay lets the
                   follower fall away between transients, so each new hit is
                   seen at close to its full height instead of riding a
                   partly-charged follower. That IS the punch character.
                   Measured for five rounds as bit-identical to Fresh
                   because it did not exist; see docs/STYLES_MEASURED.md.
     Everything under `d` is a DEFAULT written into the case file when
     the style is chosen, and freely overridable afterwards. */
  var STYLE = {
    fresh:    { topo: 'ff', detect: 'peak', rmsMs: 0,  pkMs: 15, smoothLevel: false, levelAttack: false,
                d: { knee: 6,  attack: 10,  release: 200, autoRel: false, ratio: 4 } },
    settling: { topo: 'fb', detect: 'rms',  rmsMs: 10, pkMs: 15, smoothLevel: true,  levelAttack: true,
                d: { knee: 9,  attack: 25,  release: 300, autoRel: true,  ratio: 3 } },
    spasm:    { topo: 'ff', detect: 'peak', rmsMs: 0,  pkMs: 2,  smoothLevel: false, levelAttack: false,
                d: { knee: 0,  attack: 0.5, release: 80,  autoRel: true,  ratio: 6 } },
    repose:   { topo: 'ff', detect: 'rms',  rmsMs: 50, pkMs: 15, smoothLevel: false, levelAttack: false,
                d: { knee: 18, attack: 30,  release: 400, autoRel: true,  ratio: 2 } }
  };
  function styleDefaults(name) {
    var s = STYLE[name] || STYLE.fresh;
    var d = s.d, o = {};
    for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) o[k] = d[k];
    return o;
  }

  var clamp = ND.clamp;

  /* Ratio is stored as a ratio and converted to invR = 1/ratio, because
     that is the form the gain computer wants and because it makes 1:1 an
     exact identity. RATIO_INF is the one magic value: at or above it we
     use an EXACT zero rather than 1/1000, so infinity really is infinity.
     (CASKET owns true brickwalling — it has true-peak detection and
     lookahead-shaped gain. This is here for completeness and for the
     limiter-ish settings people actually reach for.) */
  var RATIO_INF = 1000;
  function invRatio(r) { return r >= RATIO_INF ? 0 : 1 / r; }

  /* ---------- state ---------- */
  function defaultState() {
    var d = styleDefaults('fresh');
    return {
      version: 1,
      bypass: false,
      /* bypassSplit: what "bypass" MEANS when there is a crossover.
         false (default) — bypass is DRY. The audio never enters the
           splitter; you hear exactly what came in, delayed by the
           reported latency and nothing else. This is what the word
           means to anyone who has ever pressed one, and it is the only
           setting that satisfies the suite's null-test law at 2+ bands.
         true — bypass is CROSSOVER-ONLY. The audio is still split and
           re-summed, only nothing compresses it. Measured flat to
           0.06 dB but NOT bit-transparent, because an LR4 pair is
           magnitude-flat and emphatically not linear-phase.

         Both are worth having and that is why this is a switch rather
         than a fix. Dry answers "what is this plugin doing to my
         track?". Crossover-only answers the narrower and sometimes
         more useful "what is the COMPRESSION doing?", by putting the
         same phase response on both sides of the A/B so the only
         variable left is the gain reduction. Shipping only the second
         one, which is what RIGOR did until now, means the bypass
         button silently answered a question nobody asked it.

         Ignored at bands === 1: there is no crossover to route
         through, so the two settings are the same signal path, and
         the bands === 1 bit-identity stays load-bearing. */
      bypassSplit: false,
      style: 'fresh',
      inGain: 0,           // dB
      thresh: -18,         // dB
      ratio: d.ratio,      // 1 .. RATIO_INF
      knee: d.knee,        // dB, total width
      attack: d.attack,    // ms  (time to 63.2 % of target gain reduction)
      release: d.release,  // ms
      autoRel: d.autoRel,
      hold: 0,             // ms
      range: 60,           // dB — maximum permitted gain reduction
      look: 0,             // ms lookahead
      detect: 'auto',      // auto follows the style
      scOn: false,
      scHp: 100,           // Hz
      scLp: 12000,         // Hz
      scListen: false,
      link: 100,           // %
      mix: 100,            // % wet
      makeup: 0,           // dB
      autoMakeup: false,
      place: 'lr',         // 'lr' | 'ms' — process left/right or mid/side
      delta: false,        // monitor ONLY what was removed
      /* deltaBand: 0 = the whole thing, 1..3 = only that band's removal.
         Delta + band solo already got you here as two switches; this is
         the one control that means "play me what band 2 took away". */
      deltaBand: 0,
      /* scBand: 0 = off. Otherwise the band whose signal drives EVERY
         band's detector — band 3 ducking band 1 is the classic use, and
         the routing already existed internally with no way to reach it. */
      scBand: 0,
      /* tsSplit: 0..100. Blends the detector between a fast and a slow
         follower by which of the two is currently winning — a different
         route to punch than a fast attack, because it reacts to the SHAPE
         of the envelope rather than its level. */
      tsSplit: 0,
      curve: 0,            // 0 = exponential release, 100 = linear-in-dB
      /* ---- multiband ----
         Character and timing stay GLOBAL — style, knee, attack, release,
         curve — because that is what makes three bands sound like one
         compressor rather than three. What genuinely differs per band is
         WHEN it engages and HOW MUCH comes back, so each band gets a
         threshold offset and a gain, plus mute and solo. */
      /* HOLD TAPER, 0..100. Hold is otherwise a cliff: the envelope is
         frozen for N samples and then released at full speed, and on
         material that retriggers near the hold boundary that switch is
         audible as a stutter. At 100 the release eases in across the hold
         instead — frozen at the top, at full release speed by the time the
         hold expires. At 0 the branch is SKIPPED ENTIRELY rather than
         evaluated with a unity coefficient, so every pre-round-8 baseline
         is reproduced bit-for-bit rather than approximately. */
      holdTaper: 0,
      detOs: false,        // detect on the interpolated peak, not the sample
      /* HOW MANY phases that interpolation uses. 4 is the ITU true-peak
         convention and the default; 2 is cheaper and misses more; 8 halves
         the worst-case grid error. A PATH property once detOs is on — it
         changes rendered audio — so it is sanitised to the legal set rather
         than clamped to a range, because 3 phases is not a cheaper 4. */
      detOsX: 4,
      relSync: 0,          // 0 = ms; otherwise a note division index into SYNC_DIV
      bpm: 120,            // host tempo, so sync stays a pure function of state
      bands: 1,            // 1..3
      xover: [200, 2000],  // Hz, ascending
      band: [defaultBandCfg(), defaultBandCfg(), defaultBandCfg()],
      meta: { name: 'Fresh Case', note: '' }
    };
  }
  function defaultBandCfg() { return { threshOff: 0, gain: 0, mute: false, solo: false }; }

  function sanitizeState(s) {
    var out = defaultState();
    if (!s || typeof s !== 'object') return out;
    out.bypass = !!s.bypass;
    out.bypassSplit = !!s.bypassSplit;
    out.style = STYLES.indexOf(s.style) >= 0 ? s.style : 'fresh';
    /* isFinite, not ||, everywhere a zero is legal */
    var n;
    n = +s.inGain;  out.inGain = clamp(isFinite(n) ? n : 0, -24, 24);
    n = +s.thresh;  out.thresh = clamp(isFinite(n) ? n : -18, -60, 0);
    n = +s.ratio;   out.ratio = clamp(isFinite(n) ? n : 4, 1, RATIO_INF);
    n = +s.knee;    out.knee = clamp(isFinite(n) ? n : 6, 0, 30);
    n = +s.attack;  out.attack = clamp(isFinite(n) ? n : 10, 0.02, 500);
    n = +s.release; out.release = clamp(isFinite(n) ? n : 200, 1, 2500);
    n = +s.hold;    out.hold = clamp(isFinite(n) ? n : 0, 0, 500);
    n = +s.holdTaper; out.holdTaper = clamp(isFinite(n) ? n : 0, 0, 100);
    n = +s.range;   out.range = clamp(isFinite(n) ? n : 60, 0, 60);
    n = +s.look;    out.look = clamp(isFinite(n) ? n : 0, 0, MAX_LOOK_MS);
    n = +s.scHp;    out.scHp = clamp(isFinite(n) ? n : 100, 10, 1000);
    n = +s.scLp;    out.scLp = clamp(isFinite(n) ? n : 12000, 1000, 20000);
    n = +s.link;    out.link = clamp(isFinite(n) ? n : 100, 0, 100);
    n = +s.mix;     out.mix = clamp(isFinite(n) ? n : 100, 0, 100);
    n = +s.makeup;  out.makeup = clamp(isFinite(n) ? n : 0, -24, 24);
    out.autoRel = !!s.autoRel;
    out.scOn = !!s.scOn;
    out.scListen = !!s.scListen;
    out.autoMakeup = !!s.autoMakeup;
    out.detect = DETECTS.indexOf(s.detect) >= 0 ? s.detect : 'auto';
    out.place = PLACES.indexOf(s.place) >= 0 ? s.place : 'lr';
    out.detOs = !!s.detOs;
    /* a member of the legal set or the default — NOT clamped. An out-of-set
       value is a mistake, and rounding it to the nearest legal neighbour
       would silently render different audio than the case file asked for. */
    n = +s.detOsX;
    out.detOsX = DET_OS_CHOICES.indexOf(n) >= 0 ? n : 4;
    n = +s.relSync; out.relSync = clamp(Math.floor((isFinite(n) ? n : 0) + 0.5), 0, SYNC_DIV.length - 1);
    n = +s.bpm;     out.bpm = clamp(isFinite(n) ? n : 120, 20, 300);
    out.delta = !!s.delta;
    n = +s.deltaBand; out.deltaBand = clamp(Math.floor((isFinite(n) ? n : 0) + 0.5), 0, MAX_BANDS);
    n = +s.scBand;    out.scBand    = clamp(Math.floor((isFinite(n) ? n : 0) + 0.5), 0, MAX_BANDS);
    n = +s.tsSplit;   out.tsSplit   = clamp(isFinite(n) ? n : 0, 0, 100);
    n = +s.curve;   out.curve = clamp(isFinite(n) ? n : 0, 0, 100);
    n = +s.bands;   out.bands = clamp(Math.floor((isFinite(n) ? n : 1) + 0.5), 1, MAX_BANDS);
    if (Array.isArray(s.xover)) {
      var x0 = +s.xover[0], x1 = +s.xover[1];
      out.xover = [clamp(isFinite(x0) ? x0 : 200, 20, 20000),
                   clamp(isFinite(x1) ? x1 : 2000, 20, 20000)];
      /* Ordered and apart: a crossover pair that crosses over itself is
         not something the engine downstream should have to cope with.
         The ORDER here is load-bearing, and the fuzzer found out why.
         Push the LOWER one down first: raising the upper one and then
         clamping it back to the ceiling leaves BOTH pinned at 20 kHz with
         no separation at all, and the splitter's own `nb = na * 1.1` rule
         then designs a section at 23,760 Hz — past 0.45·fs at 48 k and
         past Nyquist below it. */
      if (out.xover[0] > 20000 / 1.1) out.xover[0] = 20000 / 1.1;
      if (out.xover[1] < out.xover[0] * 1.1) out.xover[1] = out.xover[0] * 1.1;
      if (out.xover[1] > 20000) out.xover[1] = 20000;
    }
    if (Array.isArray(s.band)) {
      for (var bi = 0; bi < MAX_BANDS; bi++) {
        var bc = s.band[bi];
        if (!bc || typeof bc !== 'object') continue;
        var t1 = +bc.threshOff, g1 = +bc.gain;
        out.band[bi] = {
          threshOff: clamp(isFinite(t1) ? t1 : 0, -24, 24),
          gain: clamp(isFinite(g1) ? g1 : 0, -24, 24),
          mute: !!bc.mute, solo: !!bc.solo
        };
      }
    }
    if (s.meta) {
      out.meta.name = String(s.meta.name || out.meta.name);
      out.meta.note = String(s.meta.note || '');
    }
    return out;
  }

  /* ---------- case-file migration ----------
     A case file saved before the lineage merge uses different names, and
     sanitizeState would silently drop every one of them and hand back
     defaults — the file would open, look wrong, and say nothing. That
     already happened to one of the factory cases. So: translate first,
     sanitise second.

     Legacy shapes handled:
       lookahead -> look
       sc: { on, hp, lp, listen }  ->  scOn / scHp / scLp / scListen
       link, mix, curve as 0..1    ->  0..100
     Detection is by shape, not by a version number, because the files
     that need migrating are exactly the ones written before anyone
     thought to put a version in them. */
  function migrateCase(o) {
    if (!o || typeof o !== 'object') return o;
    var out = {}, k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];

    /* the structural tells of a pre-merge file — names that simply do not
       exist in the current shape, so their presence is unambiguous */
    var legacy = (out.lookahead !== undefined) ||
                 (out.sc !== undefined && out.sc !== null && typeof out.sc === 'object');

    if (out.lookahead !== undefined && out.look === undefined) {
      out.look = out.lookahead;
      delete out.lookahead;
    }
    if (out.sc && typeof out.sc === 'object') {
      if (out.scOn === undefined && out.sc.on !== undefined) out.scOn = out.sc.on;
      if (out.scHp === undefined && out.sc.hp !== undefined) out.scHp = out.sc.hp;
      if (out.scLp === undefined && out.sc.lp !== undefined) out.scLp = out.sc.lp;
      if (out.scListen === undefined && out.sc.listen !== undefined) out.scListen = out.sc.listen;
      delete out.sc;
    }
    /* The 0..1 -> 0..100 rescale is keyed on a STRUCTURAL marker, never on
       the value itself. The first version sniffed for "is it <= 1?", which
       looks reasonable and is wrong: link = 0.11 is a perfectly legal
       current value meaning 0.11%, and the sniff silently turned it into
       11%. The round-trip audit caught it — a saved session reopened
       LOUDER than it was closed.
       So: only a file that carries an unambiguously old field is treated
       as old. A file with neither marker is left exactly alone, which is
       the safe default — the worst case is that a very old file with no
       markers keeps its percentages, and such a file is indistinguishable
       from a current one anyway. */
    if (legacy) {
      ['link', 'mix', 'curve'].forEach(function (f) {
        var v = +out[f];
        if (isFinite(v) && v > 0 && v <= 1) out[f] = v * 100;
      });
    }
    return out;
  }
  /* the one call a loader should make */
  function loadCase(o) { return sanitizeState(migrateCase(o)); }

  /* ---------- derived, pure ---------- */
  function lookSamples(st, fs) {
    return Math.floor(clamp(st.look, 0, MAX_LOOK_MS) * 0.001 * fs + 0.5);
  }
  function latencySamples(state, fs) { return lookSamples(sanitizeState(state), fs); }

  /* Auto makeup is ANALYTIC — the gain computer evaluated at 0 dBFS and
     negated — never measured. A signal-dependent estimator would make the
     output depend on playback history, which would end byte-stable
     regression on the spot. This stays a pure function of the params. */
  function autoMakeupDb(state) {
    var st = sanitizeState(state);
    return -ND.kneeGain(0, st.thresh, st.knee, invRatio(st.ratio));
  }
  function makeupDb(state) {
    var st = sanitizeState(state);
    return st.autoMakeup ? autoMakeupDb(st) : st.makeup;
  }

  /* The stiffening curve: input dB -> output dB, the one function both
     UIs draw from (the magnitudeAt discipline, applied to a transfer). */
  function transferAt(state, inDb) {
    var st = sanitizeState(state);
    var x = inDb + st.inGain;
    var gr = ND.kneeGain(x, st.thresh, st.knee, invRatio(st.ratio));
    if (gr < -st.range) gr = -st.range;
    /* parallel mix happens in the LINEAR domain, so the displayed curve
       has to as well or it lies about what you hear */
    var m = st.mix / 100;
    var lin = ND.dbToLin(gr);
    var blended = (1 - m) + lin * m;
    return x + ND.linToDb(blended) + makeupDb(st);
  }

  /* ============================================================
     METERING — true peak, loudness, correlation
     ONE implementation, shared by the single engine and the multiband
     wrapper. Metering is write-only with respect to the audio path, so it
     cannot move a rendered bit; the harness re-checks the hashes anyway
     rather than taking that on trust.
     ============================================================ */
  var TP_OS = 4, TP_TAPS = 8;
  var DET_OS_CHOICES = [2, 4, 8];

  /* TP_TAPS = 8, and the reason it is pinned CHANGED in round 8. Read this
     before touching it, because the old reason was wrong.

     THE OLD CLAIM: "more taps is worse — 8 taps -0.049 dB, 12 taps +0.451,
     16 taps +0.613 on the fs/4 @45 deg case." Those numbers are real. What
     they measure is not.

     They were taken by running a tone into a COLD engine and reading the
     meter. The delay line starts at zero, so a tone that begins at full
     scale is a genuine step discontinuity, and a sinc interpolator
     genuinely overshoots at a step. A longer sinc overshoots MORE. Measured
     directly, on a 0.10 fs tone starting cold:
         8 taps +0.635 dB   12 taps +0.747   16 taps +0.784   24 taps +0.810
     — and Kaiser tracks Blackman to within 0.006 dB at every length, which
     is the tell: a window barely moves it, because it is not a window
     effect. It is Gibbs at an edge, and it is arguably the CORRECT reading
     for a signal that really does start that abruptly.

     STEADY STATE — transient skipped, swept over 48 frequencies x 16 phases,
     expected value derived (a unit cosine peaks at exactly 1.0) — says the
     opposite: more taps is mildly BETTER (rms error 0.047 at 8 taps, 0.033
     at 12) and every design bottoms out at the same worst case, -0.436 dB.

     That floor is why none of this matters much. -0.436 dB is exactly
     cos(2*pi*0.40*0.125) — the error from evaluating a 0.40 fs tone on a 4x
     grid that can miss the peak by half a step. It is the arithmetic of
     TP_OS, not the quality of the filter. NO window and NO tap count moves
     it; only more oversampling does.

     So: 8 taps is kept because it has the SMALLEST edge overshoot (0.635 dB
     against 12 taps' 0.747) and because the ~0.013 dB of steady-state rms
     that 12 taps would buy is an eighth of an error the window cannot
     reach. A Kaiser window was designed, measured at beta 4/6/8/9/10/12 and
     REJECTED: at 12 taps it ties Blackman on rms (0.0334 both) and wins
     0.0009 dB of worst-case overshoot, which is not worth a second window
     function in the parity surface. See the swept assertion in
     rigor_test.js, which replaced the single-case one that could not tell
     "the filter is good" from "two errors cancelled here".

     The window is centred on the SINC, not on the array index; with an even
     tap count those differ by half a sample, and that half sample was most
     of the original error (-0.370 dB). That part of the old note stands. */
  function tpTaps(os) {
    var n = isFinite(os) ? os : TP_OS;
    var t = [], half = TP_TAPS / 2;
    for (var p = 0; p < n; p++) {
      var row = [], frac = p / n, sum = 0, i, x, s, u, w;
      for (i = 0; i < TP_TAPS; i++) {
        x = (i - (half - 1)) - frac;
        s = x === 0 ? 1 : NM.sin(Math.PI * x) / (Math.PI * x);
        u = (x + half) / (2 * half);
        w = 0.42 - 0.5 * NM.cos(2 * Math.PI * u) + 0.08 * NM.cos(4 * Math.PI * u);
        if (w < 0) w = 0;
        row.push(s * w); sum += s * w;
      }
      for (i = 0; i < TP_TAPS; i++) row[i] = row[i] / sum;
      t.push(row);
    }
    return t;
  }

  /* ITU-R BS.1770 K-weighting, designed parametrically rather than pasted
     from the standard's 48 kHz coefficient table — so the meter is correct
     at 44.1, 88.2, 96 and 192 k instead of only at one rate. */
  function tan_(x) { return NM.sin(x) / NM.cos(x); }
  function kweightHigh(fs) {
    var f0 = 1681.9744509555319, G = 3.9998438531093142, Q = 0.70717523608148132;
    var K = tan_(Math.PI * f0 / fs);
    var Vh = NM.pow10(G / 20);
    var Vb = NM.exp(NM.log(Vh) * 0.49966775916574335);
    var a0 = 1 + K / Q + K * K;
    return { b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0,
             b2: (Vh - Vb * K / Q + K * K) / a0,
             a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
  }
  function kweightLow(fs) {
    var f0 = 38.135470876002885, Q = 0.50032703732504273;
    var K = tan_(Math.PI * f0 / fs);
    var d = 1 + K / Q + K * K;
    return { b0: 1, b1: -2, b2: 1,
             a1: 2 * (K * K - 1) / d, a2: (1 - K / Q + K * K) / d };
  }
  function lkfs(msL, msR) {
    var z = msL + msR;
    return z <= 0 ? -200 : -0.691 + 10 * NM.log10(z);
  }

  function createMeter(fs) {
    var TAPS = tpTaps();
    var tpzL = new Float64Array(TP_TAPS), tpzR = new Float64Array(TP_TAPS), tpw = 0;
    var kwHi = kweightHigh(fs), kwLo = kweightLow(fs);
    var k1L = ND.biquad(), k2L = ND.biquad(), k1R = ND.biquad(), k2R = ND.biquad();
    var subN = Math.floor(fs * 0.1 + 0.5), subI = 0, subL = 0, subR = 0;
    var ringM = [], ringS = [], blocks = [];
    var corrC = ND.onePole(100, fs), cLR = 0, cLL = 0, cRR = 0;
    var blkTL = 0, blkTR = 0;
    var m = { tpL: 0, tpR: 0, lufsM: -200, lufsS: -200, lufsI: -200, corr: 1 };

    function reset() {
      for (var i = 0; i < TP_TAPS; i++) { tpzL[i] = 0; tpzR[i] = 0; }
      tpw = 0;
      k1L.clear(); k2L.clear(); k1R.clear(); k2R.clear();
      subI = 0; subL = 0; subR = 0;
      ringM = []; ringS = []; blocks = [];
      cLR = cLL = cRR = 0; blkTL = blkTR = 0;
      m.tpL = m.tpR = 0; m.lufsM = m.lufsS = m.lufsI = -200; m.corr = 1;
    }
    function truePeak(z, x) {
      z[tpw] = x;
      var best = x < 0 ? -x : x;
      for (var p = 0; p < TP_OS; p++) {
        var row = TAPS[p], acc = 0, idx = tpw;
        for (var k = 0; k < TP_TAPS; k++) {
          acc += row[k] * z[idx];
          idx = idx === 0 ? TP_TAPS - 1 : idx - 1;
        }
        var a = acc < 0 ? -acc : acc;
        if (a > best) best = a;
      }
      return best;
    }
    function meanTail(arr, k) {
      var n2 = arr.length < k ? arr.length : k, s = 0;
      for (var i = arr.length - n2; i < arr.length; i++) s += arr[i];
      return n2 ? s / n2 : 0;
    }
    function push(l, r) {
      var tL = truePeak(tpzL, l), tR = truePeak(tpzR, r);
      tpw = tpw + 1 === TP_TAPS ? 0 : tpw + 1;
      if (tL > blkTL) blkTL = tL;
      if (tR > blkTR) blkTR = tR;
      cLR = corrC * cLR + (1 - corrC) * (l * r);
      cLL = corrC * cLL + (1 - corrC) * (l * l);
      cRR = corrC * cRR + (1 - corrC) * (r * r);
      var a = k2L.tick(kwLo, k1L.tick(kwHi, l));
      var b = k2R.tick(kwLo, k1R.tick(kwHi, r));
      subL += a * a; subR += b * b;
      if (++subI < subN) return;
      ringM.push(subL / subN); ringS.push(subR / subN);
      subI = 0; subL = 0; subR = 0;
      if (ringM.length > 30) { ringM.shift(); ringS.shift(); }
      m.lufsM = lkfs(meanTail(ringM, 4), meanTail(ringS, 4));
      m.lufsS = lkfs(meanTail(ringM, 30), meanTail(ringS, 30));
      if (ringM.length >= 4 && blocks.length < 36000) {
        var bm = meanTail(ringM, 4), bs = meanTail(ringS, 4);
        var bl = lkfs(bm, bs);
        if (bl > -70) blocks.push({ l: bl, z: bm + bs });   // absolute gate
      }
      if (blocks.length) {
        var sum = 0, i2;
        for (i2 = 0; i2 < blocks.length; i2++) sum += blocks[i2].z;
        var relGate = -0.691 + 10 * NM.log10(sum / blocks.length) - 10;
        var s2 = 0, c2 = 0;
        for (i2 = 0; i2 < blocks.length; i2++)
          if (blocks[i2].l > relGate) { s2 += blocks[i2].z; c2++; }
        m.lufsI = c2 ? -0.691 + 10 * NM.log10(s2 / c2) : -200;
      }
    }
    function latch() {
      m.tpL = blkTL; m.tpR = blkTR; blkTL = 0; blkTR = 0;
      var den = Math.sqrt(cLL * cRR);
      m.corr = den > 1e-20 ? clamp(cLR / den, -1, 1) : 1;
    }
    return { reset: reset, push: push, latch: latch, read: function () { return m; } };
  }

  /* ============================================================
     LINKWITZ-RILEY CROSSOVER
     LR4 = two cascaded Butterworth sections. Its low and high branches
     sum to an ALLPASS — flat magnitude, phase shifted — which is what
     lets a multiband compressor reconstruct the signal when idle.

     Three bands need care. The naive split
         low = LP(f1), mid = HP(f1)->LP(f2), high = HP(f1)->HP(f2)
     does NOT sum flat: the low band never meets the f2 filters while the
     others do. The fix is to give the low band the same allpass, and the
     exact allpass is simply LP(f2)+HP(f2) of that band, by definition:
         sum = AP(f2)*LP(f1) + AP(f2)*HP(f1) = AP(f2)*AP(f1)
     The harness proves it to 0.01 dB rather than trusting the algebra.
     ============================================================ */
  function createSplitter(fs) {
    var nB = 1, f1 = 200, f2 = 2000;
    var lp1, hp1, lp2, hp2;
    /* RIGOR's own guarded biquad rather than ND's.
       A three-band split leaves SIX filter chains per channel ringing after
       every decay, and an unguarded IIR settles into denormals rather than
       zero — measured at ~1e-314, which is inaudible and costs 50-100x on
       some CPUs for as long as the track is silent. ND's biquad is
       CASKET's and is not guarded; this is a RIGOR-local need, so RIGOR
       carries the guard rather than changing shared code. */
    function gbq() {
      var z1 = 0, z2 = 0;
      return {
        tick: function (c, x) {
          var y = c.b0 * x + z1;
          z1 = dn(c.b1 * x - c.a1 * y + z2);
          z2 = dn(c.b2 * x - c.a2 * y);
          return y;
        },
        clear: function () { z1 = 0; z2 = 0; }
      };
    }
    function pair() { return [gbq(), gbq()]; }
    var lo1 = [pair(), pair()], hi1 = [pair(), pair()],
        lo2 = [pair(), pair()], hi2 = [pair(), pair()],
        apL = [pair(), pair()], apH = [pair(), pair()];
    function two(c, q, x) { return q[1].tick(c, q[0].tick(c, x)); }
    function design() {
      var ny = fs * 0.45;
      lp1 = ND.secSosLP(clamp(f1, 20, ny), Math.SQRT1_2, fs);
      hp1 = ND.secSosHP(clamp(f1, 20, ny), Math.SQRT1_2, fs);
      lp2 = ND.secSosLP(clamp(f2, 20, ny), Math.SQRT1_2, fs);
      hp2 = ND.secSosHP(clamp(f2, 20, ny), Math.SQRT1_2, fs);
    }
    function clear() {
      [lo1, hi1, lo2, hi2, apL, apH].forEach(function (ch) {
        ch.forEach(function (q) { q[0].clear(); q[1].clear(); });
      });
    }
    function set(n, a, b) {
      var nn = clamp(Math.floor(n + 0.5), 1, MAX_BANDS);
      /* Clamp, separate, then clamp AGAIN — the separation rule can push
         the upper crossover back over the Nyquist guard, and a section
         designed above it is not a filter, it is noise. */
      var na = clamp(a, 20, fs * 0.45), nb = clamp(b, 20, fs * 0.45);
      if (na > fs * 0.45 / 1.1) na = fs * 0.45 / 1.1;
      if (nb < na * 1.1) nb = na * 1.1;
      nb = clamp(nb, 20, fs * 0.45);
      if (nn !== nB || na !== f1 || nb !== f2) { nB = nn; f1 = na; f2 = nb; design(); clear(); }
    }
    /* out: [b0L,b0R, b1L,b1R, b2L,b2R] */
    function split(xL, xR, out) {
      if (nB === 1) { out[0] = xL; out[1] = xR; return; }
      var aL = two(lp1, lo1[0], xL), aR = two(lp1, lo1[1], xR);
      var bL = two(hp1, hi1[0], xL), bR = two(hp1, hi1[1], xR);
      if (nB === 2) { out[0] = aL; out[1] = aR; out[2] = bL; out[3] = bR; return; }
      out[0] = two(lp2, apL[0], aL) + two(hp2, apH[0], aL);
      out[1] = two(lp2, apL[1], aR) + two(hp2, apH[1], aR);
      out[2] = two(lp2, lo2[0], bL); out[3] = two(lp2, lo2[1], bR);
      out[4] = two(hp2, hi2[0], bL); out[5] = two(hp2, hi2[1], bR);
    }
    design();
    return { set: set, split: split, clear: clear, count: function () { return nB; } };
  }

  /* ---------- deterministic radix-2 FFT + spectrum ----------
     Twiddles from NM so the C++ twin lands on the same bits. */
  function fft(re, im) {
    var n = re.length, i, j = 0, k, m, t, bit;
    for (i = 1; i < n; i++) {
      bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { t = re[i]; re[i] = re[j]; re[j] = t;
                   t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (m = 2; m <= n; m <<= 1) {
      var ang = -2 * Math.PI / m, wr = NM.cos(ang), wi = NM.sin(ang);
      for (i = 0; i < n; i += m) {
        var cr = 1, ci = 0, h = m >> 1;
        for (k = 0; k < h; k++) {
          var ur = re[i + k], ui = im[i + k];
          var vr = re[i + k + h] * cr - im[i + k + h] * ci;
          var vi = re[i + k + h] * ci + im[i + k + h] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + h] = ur - vr; im[i + k + h] = ui - vi;
          var nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }
  function spectrum(sig, out) {
    var n = out.length * 2, i;
    var re = new Float64Array(n), im = new Float64Array(n);
    var take = sig.length < n ? sig.length : n;
    for (i = 0; i < take; i++) {
      var w = 0.5 - 0.5 * NM.cos(2 * Math.PI * i / (n - 1));
      re[i] = sig[sig.length - take + i] * w;
    }
    fft(re, im);
    for (i = 0; i < out.length; i++) {
      var mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * 2 / n;
      out[i] = ND.linToDb(mag);
    }
  }

  /* Analytic makeup for one band of a multiband setup: the gain computer
     at 0 dBFS for THAT band's effective threshold, negated. Pure, so it
     cannot make the output depend on playback history. */
  function bandMakeupDb(state, k) {
    var st = sanitizeState(state);
    var t = clamp(st.thresh + st.band[k].threshOff, -60, 0);
    return -ND.kneeGain(0, t, st.knee, invRatio(st.ratio));
  }

  /* ---------- loudness-matched comparison ----------
     The only honest way to compare two compressor settings by ear:
     without it the louder one wins every time, regardless of merit. */
  function loudnessMatch(lufsA, lufsB) {
    if (!isFinite(lufsA) || !isFinite(lufsB) || lufsA < -100 || lufsB < -100) return 0;
    return clamp(lufsA - lufsB, -24, 24);
  }

  /* ---------- auto threshold ----------
     From the level DISTRIBUTION, not the peak, so one stray transient
     does not decide the answer. Pure: same material, same number. */
  function suggestThreshold(samples, ratio, targetGr) {
    var n = samples.length;
    if (!n) return -20;
    var iR = invRatio(clamp(ratio, 1, RATIO_INF));
    if (iR >= 1) return 0;
    var BINS = 200, hist = [], i;
    for (i = 0; i < BINS; i++) hist.push(0);
    var counted = 0;
    for (i = 0; i < n; i++) {
      var a = samples[i] < 0 ? -samples[i] : samples[i];
      if (a < 1e-6) continue;
      var db = 20 * NM.log10(a);
      if (db < -80) continue;
      var b = Math.floor((db + 80) / 80 * BINS);
      if (b < 0) b = 0; if (b >= BINS) b = BINS - 1;
      hist[b]++; counted++;
    }
    if (!counted) return -20;
    /* INTERPOLATE WITHIN THE BIN, do not take its centre.
       This used to return `(i + 0.5)`, i.e. the middle of whichever bin
       the 90th percentile landed in. 200 bins across 80 dB is 0.4 dB
       wide, so that carried up to 0.2 dB of bias, and the bias fed
       straight through to the threshold.

       That is not a hypothetical. The interchange log recorded this
       function's advice as off by a "systematic and monotone in ratio"
       -0.10 dB at 2:1, -0.15 at 4:1, -0.17 at 8:1 and -0.19 at 20:1,
       and could not account for the shape. The shape is the giveaway:
       a threshold error of e shows up as a gain-reduction error of
       e * (1 - invR), and (1 - invR) runs 0.50, 0.75, 0.875, 0.95 across
       those four ratios. Normalise either row by its first entry and
       both read 1.00, 1.50, 1.75, 1.90. It was one 0.2 dB quantisation
       error wearing four different hats.

       Interpolating by how far into the bin the percentile actually
       falls is the standard estimator and costs one divide. */
    var want = counted * 0.9, acc = 0, p90 = -20;
    for (i = 0; i < BINS; i++) {
      var before = acc;
      acc += hist[i];
      if (acc >= want) {
        var frac = hist[i] > 0 ? (want - before) / hist[i] : 0.5;
        p90 = -80 + (i + frac) / BINS * 80;
        break;
      }
    }
    var g = targetGr < 0 ? targetGr : -targetGr;
    return clamp(p90 + g / (1 - iR), -60, 0);
  }

  /* ============================================================
     THE ENGINE
     ============================================================ */
  function createEngine(fs) {
    var st = defaultState();
    var first = true;

    /* structural */
    var lookN = 0, delL = null, delR = null;
    var topo = 'ff', smoothLevel = false, levelAttack = false, rmsMs = 0, useRms = false;
    var pkMs = PEAK_DECAY_MS;   // per-style peak-follower decay

    /* smoothed continuous params */
    var pT = { c: 0, t: 0 };      // threshold
    var pW = { c: 0, t: 0 };      // knee
    var pR = { c: 1, t: 1 };      // invR
    var pIn = { c: 0, t: 0 };     // input gain dB
    var pMk = { c: 0, t: 0 };     // makeup dB
    var pLink = { c: 1, t: 1 };
    var pMix = { c: 1, t: 1 };

    /* derived at control rate */
    var inLin = 1, mkLin = 1, Tdb = 0, Wdb = 0, invR = 1, rangeDb = 60;
    var linkA = 1, linkB = 0, mixW = 1, mixD = 0;
    var attC = 0, relF = 0, relS = 0, holdN = 0, holdW = 0, autoRel = false, msC = 0, pkC = 0;

    /* The release coefficient to use while HOLD is still counting down.
       `rem` is the samples left, so rem/holdN runs 1 -> 0 across the hold.
         holdW = 0  -> returns exactly 1, but the CALLER skips this entirely
                       at holdW === 0, which is what preserves the bits.
         rem = holdN -> 1, fully frozen, the old behaviour at the top
         rem = 0     -> relF, at full release speed as the hold expires
       Linear in the coefficient rather than in dB: the coefficient is what
       the one-pole consumes, and easing it is what makes the corner vanish. */
    function holdCoef(rem) {
      var frac = holdN > 0 ? rem / holdN : 0;
      return 1 - (1 - relF) * (1 - frac) * holdW;
    }
    var scHpC = ND.BYPASS_SECTION, scLpC = ND.BYPASS_SECTION, scOn = false;

    /* per-channel running state */
    var msL = 0, msR = 0;                 // mean square (RMS detection)
    var pkL = 0, pkR = 0;                 // peak follower (peak detection)
    var gLf = 0, gLs = 0, gRf = 0, gRs = 0;  // gain envelopes, dB
    var eLf = 0, eLs = 0, eRf = 0, eRs = 0;  // level envelopes, dB (smoothLevel styles)
    var holdL = 0, holdR = 0;
    var fbL = 1, fbR = 1;                 // previous sample's linear gain (feedback topo)
    var hpL = ND.biquad(), hpR = ND.biquad(), lpL = ND.biquad(), lpR = ND.biquad();
    var grNow = 0, grPeak = 0;
    var meter = createMeter(fs);
    var scRing = new Float64Array(4096), scw = 0;
    /* OUTPUT ring — the second half of the analyser. scRing shows what the
       detector hears; this shows what left the engine, so the two traces
       together answer "what did the compressor do to the spectrum?".
       Deliberately a SEPARATE ring rather than a hook inside createMeter:
       the meter is not pushed while bypassed, and an output spectrum that
       goes blank on the one comparison you most want to make (bypass on
       versus off) would be a feature that fails exactly when used. It is
       written at all three points the engine emits a sample, bypass
       included. Writing a ring changes no arithmetic on the audio path,
       which is why every hash and every parity check must be unmoved —
       asserted, not assumed. */
    var outRing = new Float64Array(4096), outw = 0;
    var msPlace = false, deltaOn = false, curveW = 0, linRate = 0, detOs = false;
    /* transient/sustain split: two followers on the same detector signal,
       one fast one slow. When they DISAGREE the material is transient; when
       they converge it is sustained. Same d/(d+k) shape as the auto-release
       blend, which is the third place that shape earns its keep. */
    var tsW = 0, tsFastC = 0, tsSlowC = 0;
    var tsFL = 0, tsSL = 0, tsFR = 0, tsSR = 0;
    /* Interpolation state for oversampled detection — the same taps the
       true-peak meter uses, applied to the DETECTOR so the compressor can
       react to an inter-sample peak BEFORE it becomes a sample peak.

       The phase count is selectable (2/4/8) as of round 8. Phase 0 of an
       N-phase bank is NOT the identity — it is the windowed sinc evaluated
       at zero fractional delay, which is a near-unity but not unity kernel —
       so 2, 4 and 8 phases genuinely disagree and each one is its own
       rendered result. detOsX = 4 reproduces every pre-round-8 baseline
       bit-for-bit, which is asserted rather than assumed. */
    var detOsN = 4;
    var dTAPS = tpTaps(detOsN);
    var dzL = new Float64Array(TP_TAPS), dzR = new Float64Array(TP_TAPS), dzw = 0;
    function ipeak(z, x) {
      z[dzw] = x;
      var best = x < 0 ? -x : x;
      for (var p = 0; p < detOsN; p++) {
        var row = dTAPS[p], acc = 0, idx = dzw;
        for (var k = 0; k < TP_TAPS; k++) {
          acc += row[k] * z[idx];
          idx = idx === 0 ? TP_TAPS - 1 : idx - 1;
        }
        var a = acc < 0 ? -acc : acc;
        if (a > best) best = a;
      }
      return best;
    }
    var gPrevL = 0, gPrevR = 0;   // previous sample's gain, for the release curve

    function rebuild() {
      var sd = STYLE[st.style];
      topo = sd.topo;
      smoothLevel = sd.smoothLevel;
      levelAttack = sd.levelAttack;
      rmsMs = sd.rmsMs;
      /* isFinite, not `||` — a style declaring pkMs: 0 would be a legal
         (if silly) instant-decay follower, and `||` would silently
         promote it to 15. Same rule as every other sanitiser here. */
      pkMs = isFinite(sd.pkMs) ? sd.pkMs : PEAK_DECAY_MS;
      /* the tap bank is rebuilt, not reselected: a different phase count is
         a different filter, and rebuild() is the only place allowed to
         allocate. Same rule as the delay line above. */
      detOsN = DET_OS_CHOICES.indexOf(st.detOsX) >= 0 ? st.detOsX : 4;
      dTAPS = tpTaps(detOsN);
      useRms = st.detect === 'auto' ? (sd.detect === 'rms') : (st.detect === 'rms');
      lookN = lookSamples(st, fs);
      /* the delay line exists even at 0 ms. It was in the first commit on
         purpose: adding one later shifts every output sample and
         invalidates every baseline and parity table built before it. */
      delL = ND.delay(lookN > 0 ? lookN : 1);
      delR = ND.delay(lookN > 0 ? lookN : 1);
      msL = msR = 0;
      pkL = pkR = 0;
      gLf = gLs = gRf = gRs = 0;
      eLf = eLs = eRf = eRs = -120;
      holdL = holdR = 0;
      fbL = fbR = 1;
      hpL.clear(); hpR.clear(); lpL.clear(); lpR.clear();
      gPrevL = gPrevR = 0;
      tsFL = tsSL = tsFR = tsSR = 0;
      for (var di = 0; di < TP_TAPS; di++) { dzL[di] = 0; dzR[di] = 0; }
      dzw = 0;
      meter.reset();
      for (var i = 0; i < 4096; i++) { scRing[i] = 0; outRing[i] = 0; }
      scw = 0; outw = 0;
    }

    function smooth(p) {
      var n = p.c + (p.t - p.c) * SMOOTH;
      p.c = Math.abs(p.t - n) < SNAP ? p.t : n;
    }
    function snapAll() {
      pT.c = pT.t; pW.c = pW.t; pR.c = pR.t; pIn.c = pIn.t;
      pMk.c = pMk.t; pLink.c = pLink.t; pMix.c = pMix.t;
    }

    function control() {
      smooth(pT); smooth(pW); smooth(pR); smooth(pIn);
      smooth(pMk); smooth(pLink); smooth(pMix);
      Tdb = pT.c; Wdb = pW.c; invR = pR.c;
      inLin = pIn.c === 0 ? 1 : ND.dbToLin(pIn.c);
      mkLin = pMk.c === 0 ? 1 : ND.dbToLin(pMk.c);
      rangeDb = st.range;
      linkA = pLink.c; linkB = 1 - pLink.c;
      mixW = pMix.c; mixD = 1 - pMix.c;
      attC = ND.onePole(st.attack, fs);
      var relMs = releaseMs(st);
      relF = ND.onePole(relMs, fs);
      relS = ND.onePole(relMs * 8, fs);
      holdN = Math.floor(st.hold * 0.001 * fs + 0.5);
      holdW = st.holdTaper / 100;
      autoRel = st.autoRel;
      msC = rmsMs > 0 ? ND.onePole(rmsMs, fs) : 0;
      pkC = ND.onePole(pkMs, fs);
      msPlace = (st.place === 'ms');
      deltaOn = !!st.delta;
      tsW = st.tsSplit / 100;
      tsFastC = ND.onePole(1.5, fs);
      tsSlowC = ND.onePole(60, fs);
      curveW = st.curve / 100;
      /* linear release rate in dB/sample: 20 dB in one release time */
      linRate = 20 / (releaseMs(st) * 0.001 * fs);
      detOs = !!st.detOs;
      scOn = st.scOn;
      if (scOn) {
        scHpC = ND.secSosHP(clamp(st.scHp, 10, fs * 0.45), Math.SQRT1_2, fs);
        scLpC = ND.secSosLP(clamp(st.scLp, 1000, fs * 0.45), Math.SQRT1_2, fs);
      }
    }

    function applyTargets() {
      pT.t = st.thresh;
      pW.t = st.knee;
      pR.t = invRatio(st.ratio);
      pIn.t = st.inGain;
      pMk.t = makeupDb(st);
      pLink.t = st.link / 100;
      pMix.t = st.mix / 100;
    }

    function setState(s) {
      var prev = st;
      st = sanitizeState(s);
      var structural = first || st.style !== prev.style ||
        st.look !== prev.look || st.detect !== prev.detect ||
        st.place !== prev.place || st.detOs !== prev.detOs ||
        st.detOsX !== prev.detOsX;
      applyTargets();
      if (structural) rebuild();
      if (first) { snapAll(); first = false; }
      control();
    }

    function reset() {
      rebuild();
      grNow = 0; grPeak = 0;
      snapAll();
      control();
    }

    /* ---- the envelopes ----
       Attack is DEFINED as time to 63.2 % of the target, which is what a
       one-pole reaches in exactly tau seconds. Vendors differ here (10-90 %
       is also common) so our numbers will not match Pro-C's. Ours are
       self-consistent and testable, which is the property that matters. */
    function moveTo(cur, target, coef) {
      return coef * cur + (1 - coef) * target;
    }

    /* Level-dependent attack for the optical styles: the further over
       threshold, the faster the cell grabs. Recomputed from the current
       envelope, so it is program dependent in the attack and not only in
       the release. */
    function attackFor(overDb) {
      if (!levelAttack) return attC;
      var o = overDb > 0 ? overDb : 0;
      if (o > 30) o = 30;
      return ND.onePole(st.attack / (1 + o / 8), fs);
    }

    /* Release curve: blend the exponential recovery toward a constant
       dB-per-sample ramp. An exponential release spends most of its time
       crawling through the last decibel; the linear one does not, which is
       what people mean by an "analogue" release. curve = 0 returns the
       one-pole result untouched, so it costs nothing when unused. */
    function shape(g, prev, target) {
      if (curveW <= 0 || g <= prev) return g;
      var lin = prev + linRate;
      if (lin > 0) lin = 0;
      if (lin > target) lin = target;
      return g * (1 - curveW) + lin * curveW;
    }

    /* PROGRAM-DEPENDENT KNEE — BUILT IN ROUND 8, MEASURED, AND REMOVED.
       Recorded here so nobody proposes it a third time.

       The idea: widen the knee as the compressor works harder, driven by the
       previous sample's gain. It was implemented, and it did nothing. The
       reason is arithmetic, not a bug in the implementation.

       A soft knee only has influence within W/2 either side of the
       threshold. Outside that band the gain computer is in its linear
       branch and the knee width has cancelled out of the expression
       entirely. Measured against ND.kneeGain at T = -30, 8:1:

           level    knee 6    knee 16    knee 30
            -30    -0.6563    -1.7500    -3.2813    <- knee matters here
            -24    -5.2500    -5.3594    -6.4313
            -20    -8.7500    -8.7500    -9.1146
            -15   -13.1250   -13.1250   -13.1250    <- and not at all here
            -10   -17.5000   -17.5000   -17.5000
             -3   -23.6250   -23.6250   -23.6250

       So "widen it under heavy reduction" is self-defeating: heavy reduction
       means the level is far ABOVE the threshold, which is exactly where the
       knee has no influence left to give. To reach a level 27 dB over at 8:1
       the knee would have to open to about 54 dB — past the 30 dB ceiling,
       and at that width "knee" has stopped describing a corner and become a
       second, softer ratio. Which is a ratio control, not a knee control,
       and should be proposed as one if anybody wants it. */
    function gainComp(x) {
      var gr = ND.kneeGain(x, Tdb, Wdb, invR);
      return gr < -rangeDb ? -rangeDb : gr;
    }

    /* scL/scR are OPTIONAL. When present they replace the detector source
       entirely — which is what the multiband wrapper needs for band
       sidechaining, and what a host bus would need later. Added in round 9
       after a comment in the wrapper claimed this already existed; it did
       not, and asserting it without checking is the exact failure this
       project keeps producing. */
    function process(inL, inR, outL, outR, scL, scR) {
      var n = inL.length, pos = 0;
      var useExt = !!(scL && scR);
      while (pos < n) {
        control();
        var end = pos + CTRL; if (end > n) end = n;
        for (var s = pos; s < end; s++) {
          /* ---- THE INPUT GUARD ----
             A host can hand us anything. A ±Infinity sample used to LOCK
             THE AUDIO THREAD: it reaches the peak follower, then
             ND.linToDb, then NM.log10, which iterates and never converges
             on a non-finite argument. Not a glitch — a hung DAW needing a
             force quit, from one bad sample produced by any upstream
             plugin.

             ND.linToDb already guards the LOW end (0, negative and
             denormal all clamp to -600 dB), which is why digital silence
             has always been safe. Nothing guarded the high end.

             The real defect is in shared/, which RIGOR is not permitted to
             change — and the guard belongs here anyway. A plugin is
             responsible for the values it lets into its own state, because
             an Inf that reaches a filter or a follower stays there
             forever: the instance is dead until it is reconstructed.

             Non-finite becomes silence. Not a clamp to some large finite
             value — there is no honest magnitude to assign to NaN, and a
             huge one would slam the detector and duck the whole track for
             the length of the release. Zero is the only reading that does
             not invent information.

             Cost: two finite tests per sample. Every legal sample is
             finite, so no baseline moves — verified against all 35. */
          var xl = inL[s], xr = inR[s];
          if (!isFinite(xl)) xl = 0;
          if (!isFinite(xr)) xr = 0;
          /* ---- BYPASS RUNS THROUGH THE DELAY LINE ----
             This used to write the input straight out and `continue`,
             which was wrong twice over, and both were measured before
             this was changed:

             1. `latencySamples()` reports the lookahead in EVERY state,
                and bypass is a state. At look = 10 ms the promise is 480
                samples and the bypassed impulse came out at sample 0. A
                host compensating by the reported figure therefore shifts
                the audio 10 ms EARLIER the instant you press bypass —
                enough to comb against a parallel path, and more than
                enough to read as a tone change. Which means every A/B a
                user performed with lookahead on was invalid, including
                every A/B in the listening protocol.

             2. The line was not being FED while bypassed, so it held
                stale samples from before the toggle. Measured: after
                un-bypassing with look = 10 ms, the first 480 samples out
                were digital silence. A dropout, every time you leave
                bypass.

             Pushing through the line fixes both — the output stays where
             the reported latency promises, and the line is primed the
             moment you come back. CASKET shipped this exact defect and
             fixed it the same way in its fifth round.

             At look = 0 this is bit-identical to the old code, which is
             why only the lookahead baselines move.

             THE RULE: reported latency is a promise about every state,
             and a bypass that does not delay is a bypass that lies. The
             lie is invisible until somebody trusts it. */
          if (st.bypass) {
            outL[s] = lookN > 0 ? delL.push(xl) : xl;
            outR[s] = lookN > 0 ? delR.push(xr) : xr;
            outRing[outw] = outL[s]; outw = (outw + 1) & 4095;
            grNow = 0;
            continue;
          }
          if (inLin !== 1) { xl *= inLin; xr *= inLin; }

          /* Placement: in mid/side the two "channels" ARE M and S. Exact
             matrix; reconstruction is (m+s, m-s), the same algebra AUTOPSY
             proved. Everything downstream is untouched, which is why
             placement is a matrix and not a mode. */
          if (msPlace) {
            var mm = (xl + xr) * 0.5, ss = (xl - xr) * 0.5;
            xl = mm; xr = ss;
          }

          /* the dry tap sits AFTER the delay line — tapping before it
             would comb-filter the parallel blend instead of mixing it */
          var dl = lookN > 0 ? delL.push(xl) : xl;
          var dr = lookN > 0 ? delR.push(xr) : xr;

          /* detector source: feedforward reads the input, feedback reads
             the output (the input scaled by the previous sample's gain) */
          var sl, sr;
          if (useExt) {
            /* an external detector source is used AS GIVEN — feedback
               topology has nothing to feed back from when the detector is
               not listening to this band's own output */
            sl = scL[s]; sr = scR[s];
          } else {
            sl = topo === 'fb' ? xl * fbL : xl;
            sr = topo === 'fb' ? xr * fbR : xr;
          }

          if (scOn) {
            sl = lpL.tick(scLpC, hpL.tick(scHpC, sl));
            sr = lpR.tick(scLpC, hpR.tick(scHpC, sr));
          }
          scRing[scw] = sl; scw = (scw + 1) & 4095;

          var al, ar;
          if (useRms) {
            msL = msC * msL + (1 - msC) * (sl * sl);
            msR = msC * msR + (1 - msC) * (sr * sr);
            al = Math.sqrt(msL); ar = Math.sqrt(msR);   // sqrt is IEEE-exact
          } else {
            /* PEAK FOLLOWER, not a bare rectifier.
               |x| alone is not a detector: on any periodic signal it dives
               to zero twice a cycle, the gain computer follows it below
               threshold, and smoothing that ripple lands the steady state
               well above the transfer curve — measured 1.24 dB high at
               4:1 on a 200 Hz sine before this existed. Instant attack, a
               fixed short decay. The decay is deliberately NOT tied to the
               release knob: "peak" has to mean the same thing at every
               release setting or the ratio stops being a ratio. */
            var apl, apr;
            if (detOs) {
              apl = ipeak(dzL, sl); apr = ipeak(dzR, sr);
              dzw = dzw + 1 === TP_TAPS ? 0 : dzw + 1;
            } else {
              apl = sl < 0 ? -sl : sl; apr = sr < 0 ? -sr : sr;
            }
            /* max(|x|, decayed) — NOT a conditional on |x| > pk. Written
               the conditional way, a level that merely HOLDS (a square
               wave, a sustained tone at its peak) takes the decay branch
               and droops, which put the steady state 0.001 dB under the
               transfer curve. Small, but it is the difference between a
               follower that tracks and one that always leaks. */
            pkL *= pkC; if (apl > pkL) pkL = apl;
            pkR *= pkC; if (apr > pkR) pkR = apr;
            al = pkL; ar = pkR;
          }

          if (tsW > 0) {
            /* the fast follower leads on a transient; weight toward it by
               how far the two have separated */
            tsFL = tsFastC * tsFL + (1 - tsFastC) * al;
            tsSL = tsSlowC * tsSL + (1 - tsSlowC) * al;
            tsFR = tsFastC * tsFR + (1 - tsFastC) * ar;
            tsSR = tsSlowC * tsSR + (1 - tsSlowC) * ar;
            var dL2 = tsFL - tsSL; if (dL2 < 0) dL2 = -dL2;
            var dR2 = tsFR - tsSR; if (dR2 < 0) dR2 = -dR2;
            var wL2 = ND.blend(dL2, 0.02), wR2 = ND.blend(dR2, 0.02);
            al = al * (1 - tsW) + (wL2 * tsFL + (1 - wL2) * tsSL) * tsW;
            ar = ar * (1 - tsW) + (wR2 * tsFR + (1 - wR2) * tsSR) * tsW;
          }
          var lvL = ND.linToDb(al), lvR = ND.linToDb(ar);
          var mx = lvL > lvR ? lvL : lvR;
          var vL = linkA * mx + linkB * lvL;
          var vR = linkA * mx + linkB * lvR;

          var gl, gr2, tgtL = 0, tgtR = 0;
          if (smoothLevel) {
            /* classic: smooth the LEVEL, then compute the gain from it */
            var aL = attackFor(vL - Tdb), aR = attackFor(vR - Tdb);
            if (vL > eLf) { eLf = moveTo(eLf, vL, aL); holdL = holdN; }
            else if (holdL > 0) { holdL--; if (holdW > 0) eLf = moveTo(eLf, vL, holdCoef(holdL)); }
            else { eLf = moveTo(eLf, vL, relF); }
            if (autoRel) {
              if (vL > eLs) eLs = moveTo(eLs, vL, aL);
              else if (holdL <= 0) eLs = moveTo(eLs, vL, relS);
              var dL = eLf - eLs; if (dL < 0) dL = -dL;
              var wL = ND.blend(dL, 3);
              gl = gainComp(wL * eLf + (1 - wL) * eLs);
            } else { eLs = eLf; gl = gainComp(eLf); }
            tgtL = gainComp(vL);

            if (vR > eRf) { eRf = moveTo(eRf, vR, aR); holdR = holdN; }
            else if (holdR > 0) { holdR--; if (holdW > 0) eRf = moveTo(eRf, vR, holdCoef(holdR)); }
            else { eRf = moveTo(eRf, vR, relF); }
            if (autoRel) {
              if (vR > eRs) eRs = moveTo(eRs, vR, aR);
              else if (holdR <= 0) eRs = moveTo(eRs, vR, relS);
              var dR = eRf - eRs; if (dR < 0) dR = -dR;
              var wR = ND.blend(dR, 3);
              gr2 = gainComp(wR * eRf + (1 - wR) * eRs);
            } else { eRs = eRf; gr2 = gainComp(eRf); }
            tgtR = gainComp(vR);
          } else {
            /* modern: compute the gain, then smooth THE GAIN — so attack
               time means one thing regardless of ratio and overshoot */
            var tL = gainComp(vL), tR = gainComp(vR);
            tgtL = tL; tgtR = tR;
            if (tL < gLf) { gLf = moveTo(gLf, tL, attC); holdL = holdN; }
            else if (holdL > 0) { holdL--; if (holdW > 0) gLf = moveTo(gLf, tL, holdCoef(holdL)); }
            else { gLf = moveTo(gLf, tL, relF); }
            if (autoRel) {
              if (tL < gLs) gLs = moveTo(gLs, tL, attC);
              else if (holdL <= 0) gLs = moveTo(gLs, tL, relS);
              var d2 = gLf - gLs; if (d2 < 0) d2 = -d2;
              var w2 = ND.blend(d2, 3);
              gl = w2 * gLf + (1 - w2) * gLs;
            } else { gLs = gLf; gl = gLf; }

            if (tR < gRf) { gRf = moveTo(gRf, tR, attC); holdR = holdN; }
            else if (holdR > 0) { holdR--; if (holdW > 0) gRf = moveTo(gRf, tR, holdCoef(holdR)); }
            else { gRf = moveTo(gRf, tR, relF); }
            if (autoRel) {
              if (tR < gRs) gRs = moveTo(gRs, tR, attC);
              else if (holdR <= 0) gRs = moveTo(gRs, tR, relS);
              var d3 = gRf - gRs; if (d3 < 0) d3 = -d3;
              var w3 = ND.blend(d3, 3);
              gr2 = w3 * gRf + (1 - w3) * gRs;
            } else { gRs = gRf; gr2 = gRf; }
          }

          gl = dn(shape(gl, gPrevL, tgtL));
          gr2 = dn(shape(gr2, gPrevR, tgtR));
          gPrevL = gl; gPrevR = gr2;

          grNow = gl < gr2 ? gl : gr2;
          if (grNow < grPeak) grPeak = grNow;

          var lgL = gl === 0 ? 1 : ND.dbToLin(gl);
          var lgR = gr2 === 0 ? 1 : ND.dbToLin(gr2);
          fbL = lgL; fbR = lgR;

          if (st.scListen) {
            var ll = sl, rr = sr;
            if (msPlace) { var q = ll + rr; rr = ll - rr; ll = q; }
            outL[s] = ll; outR[s] = rr;
            outRing[outw] = ll; outw = (outw + 1) & 4095;
            meter.push(ll, rr);
            continue;
          }

          /* parallel mix, dry tapped after the delay.
             DELTA: y - y*g, which is EXACTLY zero when the compressor is
             idle because g is then exactly 1. Silence is the correct sound
             of a compressor doing nothing, and here it is audibly silent
             rather than nearly so. */
          var yl, yr;
          if (deltaOn) {
            yl = dl - dl * lgL;
            yr = dr - dr * lgR;
          } else {
            yl = dl * (mixD + lgL * mixW);
            yr = dr * (mixD + lgR * mixW);
          }
          if (mkLin !== 1) { yl *= mkLin; yr *= mkLin; }

          /* back out of mid/side */
          if (msPlace) { var rl = yl + yr; yr = yl - yr; yl = rl; }

          outL[s] = yl; outR[s] = yr;
          outRing[outw] = yl; outw = (outw + 1) & 4095;
          meter.push(yl, yr);
        }
        pos = end;
      }
      meter.latch();
    }

    function meters() {
      var m = meter.read();
      return { gr: grNow, grPeak: grPeak, latency: lookN,
               makeup: pMk.c, thresh: Tdb,
               tpL: m.tpL, tpR: m.tpR,
               lufsM: m.lufsM, lufsS: m.lufsS, lufsI: m.lufsI, corr: m.corr };
    }
    /* most recent sidechain-filtered samples, oldest first — analyser feed */
    function scTap(out) {
      var n = out.length < 4096 ? out.length : 4096;
      for (var i = 0; i < n; i++) out[i] = scRing[(scw - n + i + 4096) & 4095];
      return n;
    }
    /* most recent OUTPUT samples, oldest first — the same contract as
       scTap, deliberately, so the analyser can hold both with one code
       path and the two traces are always the same length and alignment */
    function outTap(out) {
      var n = out.length < 4096 ? out.length : 4096;
      for (var i = 0; i < n; i++) out[i] = outRing[(outw - n + i + 4096) & 4095];
      return n;
    }
    function resetMeters() { grPeak = 0; }

    applyTargets();
    rebuild();
    snapAll();
    control();

    return {
      setState: setState, process: process, reset: reset,
      meters: meters, resetMeters: resetMeters, scTap: scTap, outTap: outTap,
      latency: function () { return lookN; },
      gr: function () { return grNow; },
      _debug: function () {
        return { topo: topo, smoothLevel: smoothLevel, useRms: useRms,
                 lookN: lookN, Tdb: Tdb, Wdb: Wdb, invR: invR,
                 attC: attC, relF: relF, relS: relS, holdN: holdN };
      }
    };
  }

  /* ============================================================
     MULTIBAND
     N independent engines behind a Linkwitz-Riley splitter.

     THE LOAD-BEARING CONSTRAINT: at bands === 1 the splitter is bypassed
     entirely and the single engine is handed the caller's own buffers, so
     the output is BIT-IDENTICAL to the single-engine path. That is what
     lets every pre-multiband regression baseline stay blessed rather than
     re-blessed on trust. It is asserted, not assumed.
     ============================================================ */
  function createMulti(fs) {
    var eng = [createEngine(fs), createEngine(fs), createEngine(fs)];
    var sp = createSplitter(fs);
    var meter = createMeter(fs);
    var st = defaultState();
    var cap = 0, bL = [], bR = [], oL = [], oR = [], i;
    for (i = 0; i < MAX_BANDS; i++) { bL.push(null); bR.push(null); oL.push(null); oR.push(null); }
    var frame = new Float64Array(MAX_BANDS * 2);
    var bandGr = [0, 0, 0];
    /* The wrapper's own dry path, for bypassSplit === false. It has to
       live out here rather than being borrowed from a band engine,
       because the whole point is audio that never touched the splitter.
       Fed on EVERY sample whether bypassed or not — the engine-level
       bypass bug was half "does not delay" and half "is not primed", and
       repeating the second half one level up would be a poor showing. */
    var dryL = ND.delay(1), dryR = ND.delay(1), dryN = 0;
    var dryBufL = null, dryBufR = null;
    /* the wrapper keeps its OWN output ring, because at 2+ bands the sum
       happens here and eng[0] has only ever seen band 0. At bands === 1
       outTap delegates downward instead of duplicating the write — that
       path returns before this loop, and eng[0]'s output IS the wrapper's
       output there, so delegation is not an approximation. */
    var outRingM = new Float64Array(4096), outwM = 0;

    function grow(n) {
      if (n <= cap) return;
      cap = n;
      for (var k = 0; k < MAX_BANDS; k++) {
        bL[k] = new Float64Array(cap); bR[k] = new Float64Array(cap);
        oL[k] = new Float64Array(cap); oR[k] = new Float64Array(cap);
      }
      dryBufL = new Float64Array(cap); dryBufR = new Float64Array(cap);
    }
    /* per-band state: everything global, with this band's threshold offset
       folded in. Character stays shared; only when-and-how-much differs. */
    function bandState(k) {
      var b = sanitizeState(st);
      b.thresh = clamp(b.thresh + st.band[k].threshOff, -60, 0);
      b.bands = 1;
      /* PER-BAND DELTA. deltaBand 0 means the whole thing, so every band
         renders its own removal and they sum to the total removal — which
         is what delta has always meant. deltaBand k means ONLY band k
         renders its removal and the rest fall silent, so what you hear is
         exactly what that one band took away. The inner engines already
         know how to produce a removal; this only chooses which of them
         are asked for one. */
      if (st.delta && st.deltaBand > 0) b.delta = (st.deltaBand === k + 1);
      return b;
    }
    /* which band drives everyone's detector, or -1 for "each its own" */
    function scBandIndex() {
      var b = st.scBand - 1;
      return (b >= 0 && b < st.bands) ? b : -1;
    }
    function setState(s) {
      st = sanitizeState(s);
      sp.set(st.bands, st.xover[0], st.xover[1]);
      /* Rebuilt only when the length actually changes, for the same
         reason the engine guards its own: re-allocating a delay line
         empties it, and emptying it mid-stream is a dropout. */
      var want = lookSamples(st, fs);
      if (want !== dryN) {
        dryN = want;
        dryL = ND.delay(dryN > 0 ? dryN : 1);
        dryR = ND.delay(dryN > 0 ? dryN : 1);
      }
      if (st.bands === 1) eng[0].setState(sanitizeState(st));
      else for (var k = 0; k < st.bands; k++) eng[k].setState(bandState(k));
    }
    function reset() {
      for (var k = 0; k < MAX_BANDS; k++) eng[k].reset();
      sp.clear(); meter.reset();
      for (var ri = 0; ri < 4096; ri++) outRingM[ri] = 0;
      outwM = 0;
    }
    function process(inL, inR, outL, outR) {
      var n = inL.length, k, i2;
      if (st.bands === 1) {
        eng[0].process(inL, inR, outL, outR);
        bandGr[0] = eng[0].meters().gr; bandGr[1] = 0; bandGr[2] = 0;
        return;
      }
      grow(n);
      var nb = st.bands;
      for (i2 = 0; i2 < n; i2++) {
        /* The multiband wrapper needs its OWN guard, and it has to sit
           here rather than being left to the inner engines. The splitter
           runs FIRST: an Inf entering a crossover biquad becomes part of
           that filter's state, and a filter whose state is Inf outputs Inf
           for the rest of the session. By the time the band engines saw
           it, the damage would already be permanent and their guards would
           be guarding the wrong side of the wound. */
        var gl2 = inL[i2], gr3 = inR[i2];
        if (!isFinite(gl2)) gl2 = 0;
        if (!isFinite(gr3)) gr3 = 0;
        /* the dry tap is taken from the GUARDED input and before the
           splitter — the only point in the wrapper where the signal is
           both safe and untouched */
        dryBufL[i2] = dryN > 0 ? dryL.push(gl2) : gl2;
        dryBufR[i2] = dryN > 0 ? dryR.push(gr3) : gr3;
        sp.split(gl2, gr3, frame);
        for (k = 0; k < nb; k++) { bL[k][i2] = frame[k * 2]; bR[k][i2] = frame[k * 2 + 1]; }
      }
      /* BAND SIDECHAIN. If a band is nominated, its split signal drives
         every band's detector — band 3 ducking band 1 is the classic use.
         The engine gained a real external-sidechain input for this; an
         earlier version of this comment claimed it already had one, which
         was untrue and unchecked. */
      var scb = scBandIndex();
      for (k = 0; k < nb; k++) {
        if (scb >= 0)
          eng[k].process(bL[k].subarray(0, n), bR[k].subarray(0, n),
                         oL[k].subarray(0, n), oR[k].subarray(0, n),
                         bL[scb].subarray(0, n), bR[scb].subarray(0, n));
        else
          eng[k].process(bL[k].subarray(0, n), bR[k].subarray(0, n),
                         oL[k].subarray(0, n), oR[k].subarray(0, n));
      }

      /* solo wins over mute, as it does on every console ever built */
      var anySolo = false;
      for (k = 0; k < nb; k++) if (st.band[k].solo) anySolo = true;
      var g = [0, 0, 0];
      for (k = 0; k < nb; k++) {
        var audible = anySolo ? st.band[k].solo : !st.band[k].mute;
        /* per-band delta overrides mute and solo both: if you asked to
           hear what band 2 removed, hearing band 1 as well is not an
           answer to that question */
        if (st.delta && st.deltaBand > 0) audible = (st.deltaBand === k + 1);
        g[k] = audible ? ND.dbToLin(st.band[k].gain) : 0;
      }
      /* DRY BYPASS. The bands were still processed above and the splitter
         was still fed, so every filter and every delay line in the
         instance stays primed and the toggle back is seamless; their
         output is simply not what leaves. Paying that CPU while bypassed
         is the ordinary price of a bypass that does not click. */
      var bypassDry = st.bypass && !st.bypassSplit;
      for (i2 = 0; i2 < n; i2++) {
        var yl, yr;
        if (bypassDry) { yl = dryBufL[i2]; yr = dryBufR[i2]; }
        else {
          yl = 0; yr = 0;
          for (k = 0; k < nb; k++) { yl += oL[k][i2] * g[k]; yr += oR[k][i2] * g[k]; }
        }
        outL[i2] = yl; outR[i2] = yr;
        outRingM[outwM] = yl; outwM = (outwM + 1) & 4095;
        meter.push(yl, yr);
      }
      meter.latch();
      for (k = 0; k < MAX_BANDS; k++) bandGr[k] = k < nb ? eng[k].meters().gr : 0;
    }
    function meters() {
      if (st.bands === 1) {
        var m1 = eng[0].meters();
        m1.bandGr = bandGr.slice();
        return m1;
      }
      var m = meter.read(), worst = 0;
      for (var k = 0; k < st.bands; k++) if (bandGr[k] < worst) worst = bandGr[k];
      return { gr: worst, grPeak: worst, latency: eng[0].latency(),
               makeup: 0, thresh: st.thresh,
               tpL: m.tpL, tpR: m.tpR, lufsM: m.lufsM, lufsS: m.lufsS,
               lufsI: m.lufsI, corr: m.corr, bandGr: bandGr.slice() };
    }
    /* Deliberately NOT calling setState here. The inner engines snap on
       their FIRST setState and glide on every one after; priming them with
       the defaults at construction would make the caller's first real state
       glide in from those defaults instead of snapping to it — which is
       both audibly wrong and enough to break the bands === 1 bit-identity.
       Only the splitter needs configuring up front. */
    sp.set(st.bands, st.xover[0], st.xover[1]);
    return { setState: setState, process: process, reset: reset,
             meters: meters,
             latency: function () { return eng[0].latency(); },
             scTap: function (o) { return eng[0].scTap(o); },
             outTap: function (o) {
               if (st.bands === 1) return eng[0].outTap(o);
               var n = o.length < 4096 ? o.length : 4096;
               for (var i = 0; i < n; i++) o[i] = outRingM[(outwM - n + i + 4096) & 4095];
               return n;
             },
             _debug: { eng: eng, sp: sp } };
  }

  /* ---------- deterministic test signals ---------- */
  function makeNoise(seed, n) { return ND.makeNoise(seed, n); }
  function makeSine(freq, fs, n, amp) {
    var out = new Float64Array(n), w = 2 * Math.PI * freq / fs;
    for (var i = 0; i < n; i++) out[i] = amp * NM.sin(w * i);
    return out;
  }
  /* a step from `lo` to `hi` at the halfway point — the envelope-timing
     harness needs a signal whose target gain reduction is exactly known */
  function makeStep(fs, n, lo, hi, atFrac) {
    var out = new Float64Array(n), at = Math.floor(n * (atFrac || 0.5));
    for (var i = 0; i < n; i++) out[i] = i < at ? lo : hi;
    return out;
  }

  return {
    VERSION: VERSION, CTRL: CTRL, STYLES: STYLES, STYLE: STYLE,
    DETECTS: DETECTS, RATIO_INF: RATIO_INF, MAX_LOOK_MS: MAX_LOOK_MS,
    styleDefaults: styleDefaults, invRatio: invRatio,
    defaultState: defaultState, sanitizeState: sanitizeState,
    migrateCase: migrateCase, loadCase: loadCase,
    lookSamples: lookSamples, latencySamples: latencySamples,
    autoMakeupDb: autoMakeupDb, makeupDb: makeupDb, transferAt: transferAt,
    createEngine: createEngine, createMulti: createMulti,
    createMeter: createMeter, createSplitter: createSplitter,
    PLACES: PLACES, MAX_BANDS: MAX_BANDS, TP_OS: TP_OS, TP_TAPS: TP_TAPS,
    DET_OS_CHOICES: DET_OS_CHOICES,
    dn: dn, tpTaps: tpTaps, kweightHigh: kweightHigh, kweightLow: kweightLow,
    lkfs: lkfs, fft: fft, spectrum: spectrum,
    SYNC_DIV: SYNC_DIV, SYNC_NAMES: SYNC_NAMES, releaseMs: releaseMs,
    bandMakeupDb: bandMakeupDb,
    loudnessMatch: loudnessMatch, suggestThreshold: suggestThreshold,
    defaultBandCfg: defaultBandCfg,
    makeNoise: makeNoise, makeSine: makeSine, makeStep: makeStep,
    _nm: NM, _nd: ND
  };
})(typeof module !== 'undefined' && module.exports
     ? require('../shared/necromath.js') : NM,
   typeof module !== 'undefined' && module.exports
     ? require('../shared/necrodyn.js') : ND);
if (typeof module !== 'undefined' && module.exports) module.exports = RIGOR;
