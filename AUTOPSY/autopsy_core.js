/* ============================================================
   AUTOPSY — DSP core (single source of truth)
   "every frequency examined."
   v0.1 · Phase 1 · 2026-08-11
   This file is embedded VERBATIM into autopsy.html by
   autopsy_sync.js and ported to C++ in AutopsyCore.h (Phase 2).
   DEPENDS ON: shared/necromath.js (NM) — injected as the IIFE arg.
   RULES: doubles everywhere · no host APIs · deterministic ·
   never a literal closing script tag, even in comments.
   ============================================================ */
var AUTOPSY = (function (NM) {
  'use strict';

  var VERSION = '0.4';
  var MAX_BANDS = 12;
  var MAX_SECTIONS = 4; // slope 48 = 4 cascaded biquads
  var CTRL = 32; // control-rate block (samples) — smoothing + coeff recompute
  var SMOOTH = 0.25; // per-control-block one-pole factor
  var SNAP = 1e-6;

  var TYPES = ['bell', 'lowshelf', 'highshelf', 'lowcut', 'highcut', 'notch', 'bandpass', 'tilt'];
  var SLOPES = [6, 12, 18, 24, 36, 48]; // dB/oct for cut types
  var PLACES = ['st', 'l', 'r', 'm', 's'];

  /* ---------- limits ---------- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clampFreq(f, fs) { return clamp(f, 10, fs * 0.49); }
  function clampGain(g) { return clamp(g, -30, 30); }
  function clampQ(q) { return clamp(q, 0.05, 40); }

  /* ---------- state model ---------- */
  function defaultDyn() {
    return { on: false, range: 0, thresh: -30, att: 10, rel: 150 };
  }
  function defaultBand() {
    return { on: false, type: 'bell', freq: 1000, gain: 0, q: 1.0,
             slope: 12, place: 'st', dyn: defaultDyn() };
  }
  /* dynamics only make sense on gain-bearing types */
  function hasGainType(t) {
    return t === 'bell' || t === 'lowshelf' || t === 'highshelf' || t === 'tilt';
  }
  function defaultState() {
    var bands = [];
    for (var i = 0; i < MAX_BANDS; i++) bands.push(defaultBand());
    return {
      version: 1,
      bands: bands,
      out: { gain: 0, pan: 0 },
      meta: { name: 'Fresh Slab', note: '' }
    };
  }
  function sanitizeState(s) {
    var d = defaultState();
    if (!s || typeof s !== 'object') return d;
    var out = defaultState();
    if (Array.isArray(s.bands)) {
      for (var i = 0; i < MAX_BANDS; i++) {
        var b = s.bands[i];
        if (!b) continue;
        var t = TYPES.indexOf(b.type) >= 0 ? b.type : 'bell';
        out.bands[i] = {
          on: !!b.on, type: t,
          freq: clamp(+b.freq || 1000, 10, 30000),
          gain: clampGain(+b.gain || 0),
          q: clampQ(+b.q || 1),
          slope: SLOPES.indexOf(+b.slope) >= 0 ? +b.slope : 12,
          place: PLACES.indexOf(b.place) >= 0 ? b.place : 'st',
          dyn: (function (d) {
            if (!d || typeof d !== 'object') return defaultDyn();
            var th = +d.thresh; if (!isFinite(th)) th = -30; // 0 dB is a legal threshold
            return {
              on: !!d.on,
              range: clamp(+d.range || 0, -24, 24),
              thresh: clamp(th, -60, 0),
              att: clamp(+d.att || 10, 0.1, 500),
              rel: clamp(+d.rel || 150, 1, 2000)
            };
          })(b.dyn)
        };
      }
    }
    if (s.out) {
      out.out.gain = clamp(+s.out.gain || 0, -36, 36);
      out.out.pan = clamp(+s.out.pan || 0, -1, 1);
    }
    if (s.meta) {
      out.meta.name = String(s.meta.name || d.meta.name);
      out.meta.note = String(s.meta.note || '');
    }
    return out;
  }

  /* ---------- RBJ cookbook coefficient design ----------
     Section designers return one a0-normalized section {b0,b1,b2,a1,a2}.
     designBand() returns an ARRAY of 1..MAX_SECTIONS sections:
       single-section: bell, shelves, notch, bandpass
       two-section:    tilt (complementary ∓g/2 shelves)
       cascades:       lowcut/highcut at 6..48 dB/oct (Butterworth) */
  function norm(b0, b1, b2, a0, a1, a2) {
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }
  function secBell(f, g, q, fs) {
    var w0 = 2 * Math.PI * f / fs;
    var cw = NM.cos(w0), sw = NM.sin(w0);
    var alpha = sw / (2 * q);
    var A = NM.pow10(g / 40);
    return norm(1 + alpha * A, -2 * cw, 1 - alpha * A,
                1 + alpha / A, -2 * cw, 1 - alpha / A);
  }
  function secLowShelf(f, g, q, fs) {
    var w0 = 2 * Math.PI * f / fs;
    var cw = NM.cos(w0), sw = NM.sin(w0);
    var alpha = sw / (2 * q);
    var A = NM.pow10(g / 40);
    var sA = 2 * Math.sqrt(A) * alpha;
    return norm(
      A * ((A + 1) - (A - 1) * cw + sA),
      2 * A * ((A - 1) - (A + 1) * cw),
      A * ((A + 1) - (A - 1) * cw - sA),
      (A + 1) + (A - 1) * cw + sA,
      -2 * ((A - 1) + (A + 1) * cw),
      (A + 1) + (A - 1) * cw - sA);
  }
  function secHighShelf(f, g, q, fs) {
    var w0 = 2 * Math.PI * f / fs;
    var cw = NM.cos(w0), sw = NM.sin(w0);
    var alpha = sw / (2 * q);
    var A = NM.pow10(g / 40);
    var sA = 2 * Math.sqrt(A) * alpha;
    return norm(
      A * ((A + 1) + (A - 1) * cw + sA),
      -2 * A * ((A - 1) + (A + 1) * cw),
      A * ((A + 1) + (A - 1) * cw - sA),
      (A + 1) - (A - 1) * cw + sA,
      2 * ((A - 1) - (A + 1) * cw),
      (A + 1) - (A - 1) * cw - sA);
  }
  function secNotch(f, q, fs) {
    var w0 = 2 * Math.PI * f / fs;
    var cw = NM.cos(w0), sw = NM.sin(w0);
    var alpha = sw / (2 * q);
    return norm(1, -2 * cw, 1, 1 + alpha, -2 * cw, 1 - alpha);
  }
  function secBandpass(f, q, fs) { // constant 0 dB peak gain
    var w0 = 2 * Math.PI * f / fs;
    var cw = NM.cos(w0), sw = NM.sin(w0);
    var alpha = sw / (2 * q);
    return norm(alpha, 0, -alpha, 1 + alpha, -2 * cw, 1 - alpha);
  }
  function secSosHP(f, q, fs) { // 2nd-order highpass, arbitrary (structural) Q
    var w0 = 2 * Math.PI * f / fs;
    var cw = NM.cos(w0), sw = NM.sin(w0);
    var alpha = sw / (2 * q);
    return norm((1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
  }
  function secSosLP(f, q, fs) {
    var w0 = 2 * Math.PI * f / fs;
    var cw = NM.cos(w0), sw = NM.sin(w0);
    var alpha = sw / (2 * q);
    return norm((1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
  }
  function secFoHP(f, fs) { // 1st order via bilinear; tan(w0/2) = sin/(1+cos)
    var w0 = 2 * Math.PI * f / fs;
    var cw = NM.cos(w0), sw = NM.sin(w0);
    var K = sw / (1 + cw);
    return { b0: 1 / (K + 1), b1: -1 / (K + 1), b2: 0, a1: (K - 1) / (K + 1), a2: 0 };
  }
  function secFoLP(f, fs) {
    var w0 = 2 * Math.PI * f / fs;
    var cw = NM.cos(w0), sw = NM.sin(w0);
    var K = sw / (1 + cw);
    return { b0: K / (K + 1), b1: K / (K + 1), b2: 0, a1: (K - 1) / (K + 1), a2: 0 };
  }
  /* Butterworth cascade for order n = slope/6:
     even n: Q_k = 1/(2 cos(pi(2k-1)/(2n))), k = 1..n/2
     odd n:  one 1st-order section + Q_k = 1/(2 cos(pi k/n)), k = 1..(n-1)/2 */
  function cutCascade(f, slope, fs, isHP) {
    var s = SLOPES.indexOf(slope) >= 0 ? slope : 12;
    var n = s / 6;
    var out = [];
    if (n % 2 === 1) out.push(isHP ? secFoHP(f, fs) : secFoLP(f, fs));
    var pairs = Math.floor(n / 2);
    for (var k = 1; k <= pairs; k++) {
      var phi = (n % 2 === 0) ? Math.PI * (2 * k - 1) / (2 * n) : Math.PI * k / n;
      var qk = 1 / (2 * NM.cos(phi));
      out.push(isHP ? secSosHP(f, qk, fs) : secSosLP(f, qk, fs));
    }
    return out;
  }
  function designBand(band, fs) {
    var f = clampFreq(band.freq, fs);
    var q = clampQ(band.q);
    var g = clampGain(band.gain);
    switch (band.type) {
      case 'bell': return [secBell(f, g, q, fs)];
      case 'lowshelf': return [secLowShelf(f, g, q, fs)];
      case 'highshelf': return [secHighShelf(f, g, q, fs)];
      case 'notch': return [secNotch(f, q, fs)];
      case 'bandpass': return [secBandpass(f, q, fs)];
      case 'tilt': return [secLowShelf(f, -g / 2, q, fs), secHighShelf(f, g / 2, q, fs)];
      case 'lowcut': return cutCascade(f, band.slope, fs, true);
      case 'highcut': return cutCascade(f, band.slope, fs, false);
      default: return [{ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }];
    }
  }

  /* ---------- analytic magnitude response ----------
     |H| of one section at frequency f (Hz). z^-1 = e^-jw. */
  function sectionMagAt(c, fs, f) {
    var w = 2 * Math.PI * f / fs;
    var c1 = NM.cos(w), s1 = NM.sin(w);
    var c2 = NM.cos(2 * w), s2 = NM.sin(2 * w);
    var nr = c.b0 + c.b1 * c1 + c.b2 * c2;
    var ni = -(c.b1 * s1 + c.b2 * s2);
    var dr = 1 + c.a1 * c1 + c.a2 * c2;
    var di = -(c.a1 * s1 + c.a2 * s2);
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  }

  /* linear magnitude of one band = product over its sections */
  function bandLinMagAt(band, fs, f) {
    var secs = designBand(band, fs);
    var m = 1;
    for (var i = 0; i < secs.length; i++) m *= sectionMagAt(secs[i], fs, f);
    return m;
  }

  /* Composite curve in dB at f, from TARGET (unsmoothed) state —
     this one function drives BOTH UIs. Includes output gain.
     NOTE: bands placed off-stereo still contribute their full curve;
     the composite is the "everything audible somewhere" view. */
  function magnitudeAt(state, fs, f) {
    var db = state.out.gain;
    for (var i = 0; i < MAX_BANDS; i++) {
      var b = state.bands[i];
      if (!b.on) continue;
      var m = bandLinMagAt(b, fs, f);
      db += 20 * NM.log10(m > 1e-12 ? m : 1e-12);
    }
    return db;
  }
  /* Single band curve in dB (for per-band overlays). */
  function bandMagAt(band, fs, f) {
    var m = bandLinMagAt(band, fs, f);
    return 20 * NM.log10(m > 1e-12 ? m : 1e-12);
  }

  /* ---------- engine ----------
     Stereo. TDF2 per section per channel. Smoothing at control rate:
     freq in log domain, gain in dB, q in log domain, out gain in dB,
     pan linear. Deterministic: pure function of (state msgs, input). */
  function createEngine(fs) {
    var target = defaultState();
    var cur = []; // per band: {fl, g, ql, on, plc}
    var coeffs = []; // per band: ARRAY of sections (recomputed at control rate)
    var zs = []; // per band: MAX_SECTIONS x [z1L,z2L,z1R,z2R] flattened
    var outG = { cur: 0, tgt: 0 }; // dB
    var pan = { cur: 0, tgt: 0 };
    var ctrlPhase = 0; // position inside the current control block — STREAM time,
                       // carried across process() calls so host buffer size cannot
                       // change the sound (Interchange §7 2026-08-15, CASKET's bug)
    var primed = false; // first setState SNAPS smoothing; later ones glide.
                        // Without this a fresh engine fades its output gain in
                        // from 0 dB over the first control blocks — found by the
                        // fuzzer's reset() byte-identity check, same trap CASKET
                        // hit in its constructor.
    /* dynamics state */
    var detC = [];   // detector bandpass coeffs per band
    var detZ = [];   // detector biquad state per band [z1, z2]
    var env = [];    // envelope (linear, abs domain)
    var dynG = [];   // current dynamic gain offset (dB)
    var dynAct = []; // dyn active this control block
    var attC = [], relC = [];

    var i, j;
    for (i = 0; i < MAX_BANDS; i++) {
      cur.push({ fl: NM.log(1000), g: 0, ql: 0, on: false, plc: 'st' });
      coeffs.push([{ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }]);
      var z = [];
      for (j = 0; j < MAX_SECTIONS * 4; j++) z.push(0);
      zs.push(z);
      detC.push({ b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 });
      detZ.push([0, 0]);
      env.push(0);
      dynG.push(0);
      dynAct.push(false);
      attC.push(0);
      relC.push(0);
    }

    function zeroZ(k) {
      for (var j2 = 0; j2 < MAX_SECTIONS * 4; j2++) zs[k][j2] = 0;
      detZ[k][0] = detZ[k][1] = 0;
      env[k] = 0;
      dynG[k] = 0;
    }

    function smooth(c, t) {
      var n = c + (t - c) * SMOOTH;
      return Math.abs(t - n) < SNAP ? t : n;
    }

    function control() {
      var dirty = false;
      for (var k = 0; k < MAX_BANDS; k++) {
        var tb = target.bands[k], cb = cur[k];
        if (cb.on !== tb.on) { cb.on = tb.on; zeroZ(k); dirty = true; }
        if (cb.plc !== tb.place) { cb.plc = tb.place; zeroZ(k); dirty = true; }
        if (!cb.on) continue;
        var tf = NM.log(clampFreq(tb.freq, fs));
        var tq = NM.log(clampQ(tb.q));
        var tg = clampGain(tb.gain);
        var nf = smooth(cb.fl, tf), ng = smooth(cb.g, tg), nq = smooth(cb.ql, tq);

        /* dynamics: envelope -> gain offset, evaluated at control rate */
        var dyn = tb.dyn;
        dynAct[k] = !!(dyn && dyn.on && hasGainType(tb.type));
        if (dynAct[k]) {
          attC[k] = NM.exp(-1 / (clamp(dyn.att, 0.1, 500) * 0.001 * fs));
          relC[k] = NM.exp(-1 / (clamp(dyn.rel, 1, 2000) * 0.001 * fs));
          var envDb = 20 * NM.log10(env[k] + 1e-9);
          var over = envDb - clamp(dyn.thresh, -60, 0);
          dynG[k] = over <= 0 ? 0 : clamp(dyn.range, -24, 24) * (over / (over + 6));
        } else {
          dynG[k] = 0;
        }

        if (nf !== cb.fl || ng !== cb.g || nq !== cb.ql || dirty || dynAct[k]) {
          cb.fl = nf; cb.g = ng; cb.ql = nq;
          coeffs[k] = designBand(
            { type: tb.type, freq: NM.exp(nf), gain: ng + dynG[k], q: NM.exp(nq),
              slope: tb.slope, place: tb.place }, fs);
          if (dynAct[k]) {
            detC[k] = secBandpass(clampFreq(NM.exp(nf), fs),
                                  clamp(NM.exp(nq), 0.3, 8), fs);
          }
        }
        // else: params at rest, coefficients already current
      }
      outG.cur = smooth(outG.cur, outG.tgt);
      pan.cur = smooth(pan.cur, pan.tgt);
    }

    /* force coefficients current for freshly-enabled bands */
    function refreshBand(k) {
      var tb = target.bands[k], cb = cur[k];
      coeffs[k] = designBand(
        { type: tb.type, freq: NM.exp(cb.fl), gain: cb.g, q: NM.exp(cb.ql),
          slope: tb.slope, place: tb.place }, fs);
    }

    function setState(s) {
      target = sanitizeState(s);
      outG.tgt = target.out.gain;
      pan.tgt = target.out.pan;
      for (var k = 0; k < MAX_BANDS; k++) refreshBandTargetsOnEnable(k);
      if (!primed) { // first state ever: arrive, don't fade in
        outG.cur = outG.tgt;
        pan.cur = pan.tgt;
        primed = true;
      }
    }
    function refreshBandTargetsOnEnable(k) {
      var tb = target.bands[k], cb = cur[k];
      if (tb.on && !cb.on) {
        // snap params on enable so a new incision doesn't glide in from stale values
        cb.fl = NM.log(clampFreq(tb.freq, fs));
        cb.g = clampGain(tb.gain);
        cb.ql = NM.log(clampQ(tb.q));
        refreshBand(k);
      }
    }

    /* reset() = start the stream over, equivalent to a fresh engine given the
       same state. Byte-identity between render/reset/render is asserted by the
       fuzzer, so every piece of runtime state must return to its post-first-
       setState value — smoothing included, in the fresh engine's exact order. */
    function reset() {
      for (var k = 0; k < MAX_BANDS; k++) {
        var cb = cur[k];
        cb.fl = NM.log(1000); cb.g = 0; cb.ql = 0; cb.on = false; cb.plc = 'st';
        coeffs[k] = [{ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }];
        zeroZ(k);
      }
      ctrlPhase = 0;
      for (var k2 = 0; k2 < MAX_BANDS; k2++) refreshBandTargetsOnEnable(k2);
      outG.cur = outG.tgt;
      pan.cur = pan.tgt;
    }

    /* denormal flush — part of the ARITHMETIC contract, not an optimisation.
       Without it the JS worklet grinds through subnormals in silent tails
       (measured: 178k subnormal samples after 9.5 s of silence) while the
       plugin's ScopedNoDenormals flushes them — two deployments, two sounds.
       Mirrored operation-for-operation in the twin, per RIGOR's precedent. */
    function dn(x) { return x < 1e-300 && x > -1e-300 ? 0 : x; }

    /* one biquad section, single channel; z offset o uses slots [o, o+1].
       y is flushed too: two tiny-but-normal terms can SUM subnormal, and the
       section output is the next section's input — guard the chain, not just
       the recursion. */
    function tick(c, z, o, x) {
      var y = dn(c.b0 * x + z[o]);
      z[o] = dn(c.b1 * x - c.a1 * y + z[o + 1]);
      z[o + 1] = dn(c.b2 * x - c.a2 * y);
      return y;
    }

    /* inL/inR/outL/outR: Float32Array-likes of equal length */
    function process(inL, inR, outL, outR) {
      var n = inL.length;
      var pos = 0;
      while (pos < n) {
        if (ctrlPhase === 0) control();
        var run = Math.min(CTRL - ctrlPhase, n - pos);
        var end = pos + run;
        var amp = NM.pow10(outG.cur / 20);
        // constant-power pan, unity at center (cos/sin scaled by sqrt(2))
        var th = (pan.cur + 1) * Math.PI / 4;
        var gL = amp * NM.cos(th) * Math.SQRT2;
        var gR = amp * NM.sin(th) * Math.SQRT2;
        for (var s = pos; s < end; s++) {
          var xL = inL[s], xR = inR[s];
          for (var k = 0; k < MAX_BANDS; k++) {
            if (!cur[k].on) continue;
            if (dynAct[k]) { // detector listens to this band's chain input, mono mix
              var dv = tick(detC[k], detZ[k], 0, (xL + xR) * 0.5);
              var ad = Math.abs(dv);
              env[k] = dn(ad > env[k]
                ? attC[k] * env[k] + (1 - attC[k]) * ad
                : relC[k] * env[k] + (1 - relC[k]) * ad);
            }
            var secs = coeffs[k], z = zs[k], plc = cur[k].plc;
            var ns = secs.length, si, o;
            if (plc === 'st') {
              for (si = 0; si < ns; si++) {
                o = si * 4;
                xL = tick(secs[si], z, o, xL);
                xR = tick(secs[si], z, o + 2, xR);
              }
            } else if (plc === 'l') {
              for (si = 0; si < ns; si++) xL = tick(secs[si], z, si * 4, xL);
            } else if (plc === 'r') {
              for (si = 0; si < ns; si++) xR = tick(secs[si], z, si * 4 + 2, xR);
            } else { // 'm' or 's' — exact matrix: reconstruction is (m+s, m-s)
              var mid = (xL + xR) * 0.5;
              var sd = (xL - xR) * 0.5;
              if (plc === 'm') {
                for (si = 0; si < ns; si++) mid = tick(secs[si], z, si * 4, mid);
              } else {
                for (si = 0; si < ns; si++) sd = tick(secs[si], z, si * 4, sd);
              }
              xL = mid + sd;
              xR = mid - sd;
            }
          }
          outL[s] = xL * gL;
          outR[s] = xR * gR;
        }
        ctrlPhase = (ctrlPhase + run) % CTRL;
        pos = end;
      }
    }

    function dynGains() { return dynG.slice(); }

    return { setState: setState, process: process, reset: reset, dynGains: dynGains,
             _debug: { cur: cur, coeffs: coeffs } };
  }

  /* ---------- deterministic test signal (shared with tests) ----------
     Park–Miller LCG; products stay under 2^53 so JS doubles are exact. */
  function makeNoise(seed, n) {
    var x = (seed >>> 0) || 1;
    var out = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      x = (x * 16807) % 2147483647;
      out[i] = (x / 2147483647) * 2 - 1;
    }
    return out;
  }

  return {
    VERSION: VERSION, MAX_BANDS: MAX_BANDS, MAX_SECTIONS: MAX_SECTIONS,
    TYPES: TYPES, SLOPES: SLOPES, PLACES: PLACES, CTRL: CTRL,
    defaultBand: defaultBand, defaultState: defaultState, sanitizeState: sanitizeState,
    designBand: designBand, magnitudeAt: magnitudeAt, bandMagAt: bandMagAt,
    createEngine: createEngine, makeNoise: makeNoise,
    clampFreq: clampFreq, clampGain: clampGain, clampQ: clampQ,
    _nm: NM
  };
})(typeof module !== 'undefined' && module.exports
     ? require('../shared/necromath.js') : NM);
if (typeof module !== 'undefined' && module.exports) module.exports = AUTOPSY;
