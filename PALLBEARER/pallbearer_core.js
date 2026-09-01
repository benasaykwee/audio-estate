/* ===================================================================
   PALLBEARER — the bass that carries the weight
   pallbearer_core.js · the DSP · SINGLE SOURCE OF TRUTH
   v0.2

   Fifth member of the estate. Physically modelled bass: no samples in
   the string at all, the note is computed from a vibrating string.

   THE THREE PATHS (all three live here)
     · MODELLED — waveguide only. Zero megabytes.
     · HYBRID   — waveguide sustain + a recorded attack layer on top.
     · SAMPLED  — the attack layer with `strGain` at 0.
   The instrument brain (which string, which fret, who gets stolen) is
   shared by all three, which is the whole point of doing it this way.

   ESTATE LAWS OBSERVED
     LAW 1 — the C++ twin compiles at -ffp-contract=off. Nothing in here
             may depend on a fused multiply-add.
     LAW 2 — every transcendental goes through NM. Math.sqrt stays native
             (IEEE requires correct rounding, so v8 and libm already agree).
     LAW 3 — no literal closing script tag anywhere in this file, comments
             included. This file is embedded verbatim into the HTML.
     LAW 5 — sanitisers are `isFinite(n) ? n : def`, never `+x || def`.
             0 is a legal value for nearly every parameter here.

   DETERMINISM. There is no Math.random below. Every stochastic element
   runs off a 32-bit xorshift seeded per note, because a core that cannot
   reproduce itself can have neither a parity gate nor a regression
   baseline — and this estate runs on both.

   ARITHMETIC. Every buffer is Float64Array and every intermediate is a
   double, so the C++ twin can be bit-exact rather than merely close.
   =================================================================== */

var PB = (function () {
  'use strict';

  /* NM comes from the embed in the browser (nm-src precedes core-src, LAW 4)
     and from shared/ under node. Never a third copy.

     NOTE THE NAME. This must NOT be `var NM`, because in the AudioWorklet the
     concatenated nm+core is loaded by addModule as a MODULE, where a top-level
     `var NM` from necromath.js is module-scoped and never reaches globalThis.
     Declaring `var NM` here would hoist a local undefined, shadow the real one,
     fall through to a require that does not exist in a worklet, and leave the
     engine holding null. Naming it `_NM` lets `typeof NM` walk up the scope
     chain and find the real thing. Covered by the worklet-scope test. */
  var _NM = (typeof NM !== 'undefined' && NM) ? NM
          : (typeof globalThis !== 'undefined' && globalThis.NM) ? globalThis.NM
          : (typeof require === 'function' ? require('../shared/necromath.js') : null);

  var LN2 = 0.69314718055994531;
  var TWO_PI = 6.2831853071795865;

  function pow2(x) { return _NM.exp(x * LN2); }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function san(n, def) { return isFinite(n) ? n : def; }

  // ------------------------------------------------------------------
  // 0. THE DICE — 32-bit xorshift, exactly portable to uint32_t
  // ------------------------------------------------------------------
  /* JS bitwise ops coerce to int32 and `>>> 0` yields uint32, so every step
     below has an identical bit pattern in C++ using uint32_t. This is the
     only reason the parity gate is possible at all. */
  function Rng(seed) { this.s = (seed >>> 0) || 0x9E3779B9; }
  Rng.prototype.next = function () {
    var x = this.s;
    x ^= (x << 13); x = x >>> 0;
    x ^= (x >>> 17);
    x ^= (x << 5);  x = x >>> 0;
    this.s = x;
    return x;
  };
  Rng.prototype.uni = function () { return this.next() / 4294967296; };   // [0,1)
  Rng.prototype.bi = function () { return this.uni() * 2 - 1; };          // [-1,1)

  /* Mix a note event into a reproducible seed: same instrument, same note
     sequence, same sound — but two hits of one note differ, which is the
     round-robin variation a sample library buys with disk space. */
  function seedFor(base, note, stringIdx, counter) {
    var h = (base >>> 0);
    h = (h ^ (note * 2654435761)) >>> 0;
    h = (h ^ (stringIdx * 40503 + 0x85EBCA6B)) >>> 0;
    h = (h ^ (counter * 2246822519)) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    return h || 1;
  }

  // ------------------------------------------------------------------
  // 1. THE INSTRUMENT — tunings, in MIDI note numbers, low string first
  // ------------------------------------------------------------------
  var TUNINGS = {
    'standard-4':  { name: 'Standard 4-string (EADG)',  open: [28, 33, 38, 43] },
    'drop-d-4':    { name: 'Drop D (DADG)',             open: [26, 33, 38, 43] },
    'standard-5':  { name: '5-string (BEADG)',          open: [23, 28, 33, 38, 43] },
    'high-c-5':    { name: '5-string high C (EADGC)',   open: [28, 33, 38, 43, 48] },
    'standard-6':  { name: '6-string (BEADGC)',         open: [23, 28, 33, 38, 43, 48] },
    'tenor-4':     { name: 'Tenor (ADGC)',              open: [33, 38, 43, 48] }
  };

  // ------------------------------------------------------------------
  // 2. PARAMETER REGISTRY — flat, JSON-serialisable, the interchange unit
  // ------------------------------------------------------------------
  var PARAMS = [
    // ---- the instrument ----
    { id: 'tuning',    name: 'Tuning',            type: 'enum', options: Object.keys(TUNINGS), def: 'standard-4' },
    { id: 'frets',     name: 'Fret Count',        min: 12,   max: 36,   def: 24 },
    { id: 'capo',      name: 'Transpose',         min: -24,  max: 24,   def: 0, unit: 'st' },

    // ---- the string ----
    { id: 'decay',     name: 'String Decay',      min: 0.5,  max: 12,   def: 4.5, unit: 's' },
    { id: 'damping',   name: 'Damping',           min: 0,    max: 1,    def: 0.28, unit: '%' },
    { id: 'inharm',    name: 'Stiffness',         min: 0,    max: 1,    def: 0.35, unit: '%' },
    { id: 'stretch',   name: 'Tension Bloom',     min: 0,    max: 1,    def: 0.30, unit: '%' },

    // ---- the hand ----
    { id: 'style',     name: 'Playing Style',     type: 'enum',
      options: ['finger', 'pick', 'slap', 'thumb', 'muted'], def: 'finger' },
    { id: 'artic',     name: 'Articulation',      type: 'enum',
      options: ['normal', 'harmonic', 'ghost', 'palm', 'dead'], def: 'normal' },
    { id: 'pluckPos',  name: 'Pluck Position',    min: 0.02, max: 0.5,  def: 0.13, unit: '%' },
    { id: 'hardness',  name: 'Attack Hardness',   min: 0,    max: 1,    def: 0.45, unit: '%' },
    { id: 'noise',     name: 'Finger Noise',      min: 0,    max: 1,    def: 0.22, unit: '%' },

    // ---- the noises that sell it ----
    { id: 'velBright', name: 'Velocity → Bright', min: 0,    max: 1,    def: 0.55, unit: '%' },
    { id: 'buzz',      name: 'Fret Buzz',         min: 0,    max: 1,    def: 0.16, unit: '%' },
    { id: 'relNoise',  name: 'Release Noise',     min: 0,    max: 1,    def: 0.20, unit: '%' },
    { id: 'fretNoise', name: 'Position Shift Noise', min: 0, max: 1,    def: 0.30, unit: '%' },
    { id: 'humanize',  name: 'Humanize',          min: 0,    max: 1,    def: 0.25, unit: '%' },

    // ---- the pickups ----
    { id: 'pickupA',   name: 'Bridge Pickup Pos', min: 0.03, max: 0.45, def: 0.11, unit: '%' },
    { id: 'pickupB',   name: 'Neck Pickup Pos',   min: 0.03, max: 0.45, def: 0.26, unit: '%' },
    { id: 'pickupMix', name: 'Pickup Blend',      min: 0,    max: 1,    def: 0.42, unit: '%' },
    { id: 'pickupInv', name: 'Neck Polarity',     type: 'enum', options: ['in', 'out'], def: 'in' },
    /* A pickup is not only a position, it is a coil: an inductor whose
       self-capacitance and the cable's put a resonant peak somewhere between
       about 2 and 5 kHz. That peak is a large part of what separates a Jazz
       from a Precision beyond geometry alone, and the comb model cannot
       produce it because the comb describes where the pickup sits, not what
       it is made of. */
    { id: 'coilFreq',  name: 'Coil Resonance',    min: 1200, max: 6500, def: 3100, unit: 'Hz' },
    { id: 'coilQ',     name: 'Coil Q',            min: 0.4,  max: 6,    def: 1.35 },

    // ---- the body: an air mode and two wood modes ----
    { id: 'bodyFreq',  name: 'Air Resonance',     min: 40,   max: 260,  def: 92, unit: 'Hz' },
    { id: 'bodyQ',     name: 'Air Q',             min: 0.5,  max: 12,   def: 3.2 },
    { id: 'woodMix',   name: 'Wood Modes',        min: 0,    max: 1,    def: 0.40, unit: '%' },
    { id: 'bodyMix',   name: 'Body Amount',       min: 0,    max: 1,    def: 0.30, unit: '%' },

    // ---- the amp end ----
    { id: 'tone',      name: 'Tone',              min: 200,  max: 12000, def: 3800, unit: 'Hz' },
    { id: 'drive',     name: 'Drive',             min: 0,    max: 1,    def: 0.12, unit: '%' },
    { id: 'level',     name: 'Output',            min: 0,    max: 2,    def: 0.9, unit: '%' },

    // ---- the player ----
    { id: 'glide',     name: 'Slide Time',        min: 0,    max: 0.4,  def: 0, unit: 's' },
    { id: 'couple',    name: 'String Coupling',   min: 0,    max: 1,    def: 0.18, unit: '%' },
    { id: 'relDamp',   name: 'Release Damping',   min: 0.001, max: 0.6, def: 0.08, unit: 's' },
    { id: 'velSense',  name: 'Velocity Sense',    min: 0,    max: 1,    def: 0.75, unit: '%' },

    // ---- the hybrid/sampled seam ----
    { id: 'strGain',   name: 'String Level',      min: 0,    max: 1,    def: 1, unit: '%' },
    { id: 'atkGain',   name: 'Attack Layer',      min: 0,    max: 1,    def: 0, unit: '%' },
    { id: 'atkDecay',  name: 'Attack Decay',      min: 0.01, max: 2,    def: 0.25, unit: 's' }
  ];

  var PARAM_BY_ID = {};
  for (var pi = 0; pi < PARAMS.length; pi++) PARAM_BY_ID[PARAMS[pi].id] = PARAMS[pi];

  function defaults() {
    var o = {};
    for (var i = 0; i < PARAMS.length; i++) o[PARAMS[i].id] = PARAMS[i].def;
    return o;
  }

  function sanitize(patch) {
    var o = defaults();
    if (!patch || typeof patch !== 'object') return o;
    for (var i = 0; i < PARAMS.length; i++) {
      var p = PARAMS[i], v = patch[p.id];
      if (v === undefined || v === null) continue;
      if (p.type === 'enum') {
        if (p.options.indexOf(v) >= 0) o[p.id] = v;
      } else {
        var n = san(Number(v), p.def);
        o[p.id] = clamp(n, p.min, p.max);
      }
    }
    return o;
  }

  // ------------------------------------------------------------------
  // 3. PURE HELPERS — the testable surface
  // ------------------------------------------------------------------
  function midiToFreq(n) { return 440 * pow2((n - 69) / 12); }

  function fretPositions(note, openNotes, frets) {
    var out = [];
    for (var s = 0; s < openNotes.length; s++) {
      var fret = note - openNotes[s];
      if (fret >= 0 && fret <= frets) out.push({ string: s, fret: fret });
    }
    return out;
  }

  /* THE FINGERING BRAIN. A sample library cannot do this and it is most of
     why modelled bass reads as real. */
  function chooseString(note, openNotes, frets, handPos, busy, handVel) {
    var cands = fretPositions(note, openNotes, frets);
    if (!cands.length) return null;
    var hv = isFinite(handVel) ? handVel : 0;
    var best = null, bestCost = Infinity;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      var cost = 0;
      var move = c.fret - handPos;
      cost += c.fret === 0 ? 0 : Math.abs(move) * 1.0;
      cost += c.fret > 17 ? (c.fret - 17) * 1.6 : 0;
      if (busy && busy[c.string]) cost += 6;
      cost += c.string * 0.55;
      /* HAND MOMENTUM. A hand already travelling up the neck continues up
         more cheaply than it reverses — this is why a real bassist walking
         a line does not ping-pong between positions the way a pure
         nearest-fret cost function does. Small term on purpose: it breaks
         ties and biases runs, it does not override distance. */
      if (hv !== 0 && move !== 0 && c.fret !== 0) {
        var withGrain = (move > 0) === (hv > 0);
        cost += withGrain ? -Math.min(Math.abs(hv), 4) * 0.22
                          :  Math.min(Math.abs(hv), 4) * 0.30;
      }
      if (cost < bestCost) { bestCost = cost; best = c; }
    }
    return best;
  }

  /* Pickup comb nulls at k·f0/(2p). p = 0.25 erases every even harmonic. */
  function pickupNulls(f0, pos, upTo) {
    var out = [], k = 1;
    for (;;) {
      var f = k * f0 / (2 * pos);
      if (f > upTo) break;
      out.push(f); k++;
      if (k > 512) break;
    }
    return out;
  }

  function loopGainFor(f0, decaySec, sr) {
    if (!(decaySec > 0) || !(f0 > 0)) return 0;
    var trips = decaySec * f0;
    if (trips < 1) trips = 1;
    return pow2(-10 / trips);
  }

  function dispersionFor(f0, inharm) {
    var lowness = clamp((120 - f0) / 100, 0, 1);
    return clamp(inharm * (0.25 + 0.75 * lowness), 0, 1) * 0.42;
  }

  function styleShape(style, hardness) {
    var h = clamp(hardness, 0, 1);
    if (style === 'pick')   return { bright: 0.72 + 0.28 * h, burst: 0.18, click: 0.55, damp: 0.10, posBias: -0.03 };
    if (style === 'slap')   return { bright: 0.88 + 0.12 * h, burst: 0.09, click: 0.95, damp: 0.04, posBias: -0.05 };
    if (style === 'thumb')  return { bright: 0.22 + 0.20 * h, burst: 0.55, click: 0.12, damp: 0.26, posBias: 0.14 };
    if (style === 'muted')  return { bright: 0.18 + 0.16 * h, burst: 0.40, click: 0.20, damp: 0.72, posBias: 0.05 };
    return                         { bright: 0.42 + 0.34 * h, burst: 0.34, click: 0.22, damp: 0.14, posBias: 0 };
  }

  /* ARTICULATION — what happens to THIS note, orthogonal to the hand.
     Returns multipliers folded onto the string rather than DSP branches,
     so nothing here is a special case in the render loop.
       harmonic — touch a node: the fundamental dies, an upper partial rings
       ghost    — pitch is present but unreadable; almost all noise
       palm     — heel on the strings by the bridge; short and thick */
  function articShape(artic) {
    if (artic === 'harmonic') return { mult: 2, damp: -0.16, decay: 1.35, amp: 0.62, noise: 0.4, buzz: 0 };
    if (artic === 'ghost')    return { mult: 1, damp: 0.55,  decay: 0.10, amp: 0.75, noise: 3.2, buzz: 1.6 };
    if (artic === 'palm')     return { mult: 1, damp: 0.30,  decay: 0.28, amp: 0.90, noise: 0.7, buzz: 0.5 };
    /* dead — the string is touched, not pressed. There is a pitch in there
       somewhere but nobody can name it: almost all attack, nearly no tail. */
    if (artic === 'dead')     return { mult: 1, damp: 0.82,  decay: 0.035, amp: 0.85, noise: 5.0, buzz: 2.2 };
    return                           { mult: 1, damp: 0,     decay: 1,    amp: 1,    noise: 1,   buzz: 1 };
  }

  /* Velocity does not only make a string louder, it makes it brighter —
     a hard pluck displaces further and the corner of the triangle is
     sharper. Returns the damping OFFSET, negative meaning brighter. */
  function velBrightness(vel, amount) {
    return -clamp(amount, 0, 1) * (clamp(vel, 0, 1) - 0.5) * 0.34;
  }

  // ------------------------------------------------------------------
  // 4. FRACTIONAL DELAY — the fix that makes it play in tune
  // ------------------------------------------------------------------
  function Allpass1() { this.c = 0; this.x1 = 0; this.y1 = 0; }
  Allpass1.prototype.setFrac = function (frac) {
    var f = clamp(frac, 0.0001, 0.9999);
    this.c = (1 - f) / (1 + f);
  };
  Allpass1.prototype.setCoeff = function (c) { this.c = clamp(c, -0.999, 0.999); };
  Allpass1.prototype.tick = function (x) {
    var y = this.c * x + this.x1 - this.c * this.y1;
    this.x1 = x; this.y1 = y;
    return y;
  };
  Allpass1.prototype.reset = function () { this.x1 = 0; this.y1 = 0; };

  // ------------------------------------------------------------------
  // 5. THE STRING
  // ------------------------------------------------------------------
  var DISPERSION_STAGES = 4;

  function String_(sr) {
    this.sr = sr;
    var need = Math.ceil(sr / 25) + 8;
    var size = 256;
    while (size < need) size *= 2;
    this.buf = new Float64Array(size);
    this.mask = size - 1;
    this.w = 0;
    this.delay = 100;
    this.frac = new Allpass1();
    this.disp = [];
    for (var i = 0; i < DISPERSION_STAGES; i++) this.disp.push(new Allpass1());
    this.lp = 0;
    this.gain = 0.999;
    this.damp = 0.3;
    this.sounding = false;
    this.note = -1;
    this.env = 0;
    this.relCoef = 0;
    this.releasing = false;
    this.f0 = 0;
    this.targetDelay = 100;
    this.glideCoef = 1;
    this.pickA = 0; this.pickB = 0;
    this.bloom = 0; this.bloomDec = 0;
    this._a = 0; this._b = 0;
    // transient noises
    this.buzzAmt = 0; this.buzzDec = 0; this.buzzLp = 0;
    this.relAmt = 0; this.relDec = 0; this.relLp = 0;
    this.shiftAmt = 0; this.shiftDec = 0; this.shiftLp = 0;
    this.primed = false; this.passive = false;
    /* last sample's bridge output, for the coupling bus. A string has to
       remember what it radiated so the others can be driven by it WITHOUT
       an instantaneous feedback path — see the render loop. */
    this._bridge = 0;
    // attack layer
    this.atkPos = 0; this.atkRate = 0; this.atkOn = false; this.atkEnv = 0; this.atkDec = 0;
    this.rng = new Rng(1);
  }

  String_.prototype.reset = function () {
    this.buf.fill(0);
    this.w = 0; this.lp = 0; this.env = 0;
    this.sounding = false; this.releasing = false; this.note = -1;
    this.buzzAmt = 0; this.relAmt = 0; this.buzzLp = 0; this.relLp = 0;
    this.shiftAmt = 0; this.shiftLp = 0; this._bridge = 0;
    this.primed = false; this.passive = false;
    this.atkOn = false; this.atkEnv = 0; this.atkPos = 0;
    this.frac.reset();
    for (var i = 0; i < this.disp.length; i++) this.disp[i].reset();
  };

  String_.prototype.read = function (d) {
    var i = (this.w - d) & this.mask;
    return this.buf[i];
  };

  /* PRIME — set the delay line up for an open string WITHOUT exciting it.
     This is what an idle string on a real bass is: tuned, undamped, and
     waiting. Without it, sympathetic coupling cannot work at all, because
     the render loop skips silent strings and a skipped string can never
     receive anything. That was the flaw in the first version of the
     coupling model — the bus was correct and there was nothing listening.

     A primed string has no hand on it, so it takes the instrument's damping
     with a neutral shape rather than the playing style's. */
  String_.prototype.prime = function (f0, p) {
    var sr = this.sr;
    var total = sr / f0;
    if (total < 4) total = 4;
    if (total > 4000) total = 4000;

    this.damp = clamp(p.damping + 0.20, 0.02, 0.985);
    var disp = dispersionFor(f0, p.inharm);
    for (var s = 0; s < this.disp.length; s++) this.disp[s].setCoeff(-disp);

    var dDisp = (1 + disp) / (1 - disp);
    var aDamp = 1 - this.damp;
    var dDamp = (1 - aDamp) / aDamp;
    var rem = total - DISPERSION_STAGES * dDisp - dDamp;
    if (rem < 4) rem = 4;
    var D = Math.floor(rem), frac = rem - D;
    if (frac < 0.1) { D -= 1; frac += 1; }
    if (D < 2) { D = 2; frac = 0.5; }

    this.delay = D; this.targetDelay = D;
    this.frac.setFrac(frac);
    this.f0 = f0;
    this.gain = loopGainFor(f0, p.decay, sr);
    this.buf.fill(0);
    this.w = D;
    this.lp = 0;
    this.bloom = 0;
    this.frac.reset();
    for (var z = 0; z < this.disp.length; z++) this.disp[z].reset();
    this.pickA = clamp(p.pickupA, 0.03, 0.45);
    this.pickB = clamp(p.pickupB, 0.03, 0.45);
    this.primed = true;
    this.passive = true;
    this.sounding = false;
    this.releasing = false;
    this.env = 0;
  };

  String_.prototype.pluck = function (f0, vel, p, shape, art, seed, layer, style, drift, shiftDist) {
    var sr = this.sr;
    this.rng = new Rng(seed);
    var rng = this.rng;

    /* Humanize BEFORE anything is computed from these, so the whole note
       is consistent with its own jitter rather than half-jittered.

       ROUND-ROBIN DEPTH. `drift` is a slow random WALK owned by the
       instrument, not an independent draw per note. A real player's hand
       wanders: three notes land near each other and then the whole
       neighbourhood moves. White noise per note sounds busy and characterless
       — a walk sounds like someone playing. The per-note draw is still here
       and still independent; the walk rides underneath it. */
    var hum = clamp(p.humanize, 0, 1);
    var dr = isFinite(drift) ? drift : 0;
    var posJit = (rng.bi() * 0.45 + dr * 0.85) * hum * 0.045;
    var hardJit = rng.bi() * hum * 0.12;
    var ampJit = 1 + rng.bi() * hum * 0.10;
    var tuneJit = rng.bi() * hum * 0.0016;          // ±2.8 cents at full

    f0 = f0 * art.mult * (1 + tuneJit);
    var total = sr / f0;
    if (total < 4) total = 4;
    if (total > 4000) total = 4000;

    /* DELAY BUDGET. The loop is not just the delay line: the fractional
       allpass, the four dispersion allpasses and the one-pole damping filter
       each contribute their own delay, and together they are worth about ten
       samples. Ignoring them detunes a high note by tens of cents — this was
       the second bug the harness caught. Budget them all at DC, then give the
       delay line whatever is left.

       Compensating at DC is not a fudge: it pins the FUNDAMENTAL while the
       dispersion still stretches the upper partials, which is exactly the
       inharmonicity a thick wound string is supposed to have. */
    /* WRITING THE C++ TWIN FOUND THIS. The first version computed `hard`
       from hardJit and then never used it — the humanize control was drawing
       a random number and throwing it away, so attack hardness never varied
       note to note. Recompute the shape from the jittered hardness instead.
       Transcribing code into another language is a surprisingly good code
       review: an unused local is easy to skim past in JS and impossible to
       ignore when the compiler warns about it. */
    var hard = clamp(p.hardness + hardJit, 0, 1);
    if (style) shape = styleShape(style, hard);
    var bright = shape.bright;
    this.damp = clamp(p.damping + shape.damp * 0.5 + (1 - bright) * 0.35
                      + velBrightness(vel, p.velBright) + art.damp, 0.02, 0.985);

    var disp = dispersionFor(f0, p.inharm);
    for (var s = 0; s < this.disp.length; s++) this.disp[s].setCoeff(-disp);

    var dDisp = (1 + disp) / (1 - disp);
    var aDamp = 1 - this.damp;
    var dDamp = (1 - aDamp) / aDamp;

    var rem = total - DISPERSION_STAGES * dDisp - dDamp;
    if (rem < 4) rem = 4;

    var D = Math.floor(rem);
    var frac = rem - D;
    if (frac < 0.1) { D -= 1; frac += 1; }
    if (D < 2) { D = 2; frac = 0.5; }

    this.delay = D;
    this.targetDelay = D;
    this.frac.setFrac(frac);
    this.f0 = f0;

    this.gain = loopGainFor(f0, p.decay * art.decay * (1 - shape.damp * 0.85), sr);
    this.bloom = p.stretch * vel * 0.035;
    this.bloomDec = pow2(-1 / (0.05 * sr / 64));

    var pos = clamp(p.pluckPos + shape.posBias + posJit, 0.02, 0.5);
    var apex = Math.floor(D * pos);
    if (apex < 1) apex = 1;
    if (apex > D - 2) apex = D - 2;

    var amp = vel * (0.55 + 0.45 * shape.click) * art.amp * ampJit;
    var nAmt = p.noise * shape.burst * art.noise;
    var i, v;
    this.buf.fill(0);
    for (i = 0; i < D; i++) {
      v = i < apex ? (i / apex) : ((D - i) / (D - apex));
      v = v * amp;
      if (nAmt > 0) v += rng.bi() * nAmt * amp * 0.5;
      this.buf[i] = v;
    }
    /* Band-limit the corner. A harder pluck keeps the corner sharper, which
       is the other half of velocity-brightness — the first half is damping. */
    var passes = 1 + Math.floor((1 - bright) * 7 * (1 - clamp(p.velBright, 0, 1) * (vel - 0.5)));
    if (passes < 1) passes = 1;
    if (passes > 12) passes = 12;
    for (var k = 0; k < passes; k++) {
      var prev = this.buf[D - 1];
      for (i = 0; i < D; i++) { var cur = this.buf[i]; this.buf[i] = 0.5 * (cur + prev); prev = cur; }
    }
    if (shape.click > 0.3) this.buf[0] += amp * shape.click * 0.6;

    /* HARMONIC. Touching a node kills the fundamental. Rather than fake it
       with an EQ, remove it from the initial condition: subtract the mean so
       the loop starts with no DC-like component, then let the shortened
       delay line carry the partial that survives. */
    if (art.mult > 1) {
      var mean = 0;
      for (i = 0; i < D; i++) mean += this.buf[i];
      mean /= D;
      for (i = 0; i < D; i++) this.buf[i] -= mean;
    }

    /* THE WRITE POINTER MUST TRAIL THE EXCITATION, not sit on top of it.
       The triangle occupies [0, D). A read at distance D from w lands on
       (w - D) & mask, so w must start at D for the first read to find
       buf[0] and then walk forward through the shape. Starting w at 0 makes
       the first read land at (size - D), which is silence — the harness
       caught this as "peak 0.000" on every style. */
    this.w = D;
    this.lp = 0;
    this.frac.reset();
    for (var z = 0; z < this.disp.length; z++) this.disp[z].reset();

    this.sounding = true;
    this.releasing = false;
    this.env = 1;
    this.pickA = clamp(p.pickupA, 0.03, 0.45);
    this.pickB = clamp(p.pickupB, 0.03, 0.45);

    /* FRET BUZZ. A hard attack drives the string into the frets and it
       rattles for a few tens of milliseconds. Loudest on low notes struck
       hard near the bridge, which is exactly when it happens in the room. */
    /* The velocity gate is deliberately steep. With the first curve
       (vel*1.35 − 0.45) a soft note still produced a trace of rattle,
       because velSense lifts a MIDI 25 up to about 0.4 before it gets here.
       A real neck is a threshold device — below a certain drive the string
       simply never reaches the fret — so the gate has to actually reach
       zero, not merely get small. The harness asserts silence, not smallness. */
    var bz = p.buzz * art.buzz * clamp(vel * 1.8 - 0.9, 0, 1);
    if (f0 < 60) bz *= 1.5; else if (f0 > 150) bz *= 0.55;
    this.buzzAmt = bz * 0.5;
    this.buzzDec = pow2(-1 / (0.028 * sr));
    this.buzzLp = 0;

    /* POSITION-SHIFT NOISE. When the hand travels a real distance the
       fingertips drag across wound windings and it is plainly audible on
       any close-mic'd bass record. The fingering brain already knows the
       distance — it computed it to choose this fret — so the noise costs
       nothing to derive and is tied to an actual playing decision rather
       than sprinkled on at random. Longer and softer than fret buzz. */
    var sd = isFinite(shiftDist) ? Math.abs(shiftDist) : 0;
    var shiftAmt = p.fretNoise * clamp((sd - 1.5) / 9, 0, 1);
    this.shiftAmt = shiftAmt * 0.05;
    this.shiftDec = pow2(-1 / (0.075 * sr));
    this.shiftLp = 0;

    // hybrid/sampled attack layer
    this.atkOn = false;
    if (layer && p.atkGain > 0.0005) {
      this.atkOn = true;
      this.atkPos = 0;
      var root = layer.root === undefined ? 33 : layer.root;
      this.atkRate = (f0 / midiToFreq(root)) * (layer.sr / sr);
      this.atkEnv = amp;
      this.atkDec = pow2(-1 / (clamp(p.atkDecay, 0.01, 2) * sr));
    }
  };

  String_.prototype.slideTo = function (f0, glideSec) {
    var total = this.sr / f0;
    this.targetDelay = Math.floor(total) - 1;
    this.f0 = f0;
    this.glideCoef = glideSec > 0.0005 ? (1 - _NM.exp(-1 / (glideSec * this.sr / 64))) : 1;
  };

  String_.prototype.release = function (relDampSec, relNoiseAmt) {
    if (!this.sounding) return;
    this.releasing = true;
    this.relCoef = pow2(-1 / (Math.max(0.001, relDampSec) * this.sr / 64));
    /* The finger coming off a wound string is a real, audible noise and one
       of the cheapest realism wins available. */
    this.relAmt = relNoiseAmt * 0.06;
    this.relDec = pow2(-1 / (0.035 * this.sr));
    this.relLp = 0;
  };

  String_.prototype.mute = function () { this.sounding = false; this.env = 0; };

  /* One sample of string. Returns the bridge signal; the two pickup taps
     are left in _a and _b for the caller to blend. */
  String_.prototype.tick = function (inject, layerData) {
    this._atk = 0;
    /* A passive string is tuned and undamped but unplayed. It runs the loop
       so it can be driven by the coupling bus — that ringing is the whole
       point of sympathetic resonance — but it has no envelope and never
       releases, because nobody let go of anything. */
    if (!this.sounding && this.passive) {
      var pd = this.delay | 0;
      if (pd < 2) pd = 2;
      var px = this.read(pd);
      px = this.frac.tick(px);
      for (var ps = 0; ps < this.disp.length; ps++) px = this.disp[ps].tick(px);
      this.lp = this.lp + (1 - this.damp) * (px - this.lp);
      var py = this.lp * this.gain;
      if (inject) py += inject;
      this.buf[this.w] = py;
      this.w = (this.w + 1) & this.mask;
      var pA = (2 * this.pickA * this.delay) | 0;
      var pB = (2 * this.pickB * this.delay) | 0;
      if (pA < 1) pA = 1;
      if (pB < 1) pB = 1;
      this._a = py - this.read(pA);
      this._b = py - this.read(pB);
      if (this.atkOn) this._atk = this.tickAttack(layerData);
      return py;
    }
    if (!this.sounding) {
      /* The layer can outlive the string — in the sampled path there is no
         string at all — so it gets its own accumulator rather than riding
         on the pickups. Keeping them separate is what lets strGain go to
         zero without taking the sample down with it. */
      this._a = 0; this._b = 0;
      if (this.atkOn) this._atk = this.tickAttack(layerData);
      return 0;
    }

    if (this.delay !== this.targetDelay) {
      this.delay += (this.targetDelay - this.delay) * this.glideCoef;
      if (Math.abs(this.delay - this.targetDelay) < 0.01) this.delay = this.targetDelay;
    }

    var d = this.delay;
    if (this.bloom > 0.000001) { d = d / (1 + this.bloom); this.bloom *= this.bloomDec; }
    var di = d | 0;
    if (di < 2) di = 2;

    var x = this.read(di);
    x = this.frac.tick(x);
    for (var s = 0; s < this.disp.length; s++) x = this.disp[s].tick(x);

    this.lp = this.lp + (1 - this.damp) * (x - this.lp);
    var y = this.lp * this.gain;

    if (this.releasing) {
      this.env *= this.relCoef;
      y *= this.env;
      if (this.env < 0.0002) { this.sounding = false; this.env = 0; }
    }

    if (inject) y += inject;

    this.buf[this.w] = y;
    this.w = (this.w + 1) & this.mask;

    var dA = (2 * this.pickA * d) | 0;
    var dB = (2 * this.pickB * d) | 0;
    if (dA < 1) dA = 1;
    if (dB < 1) dB = 1;
    var a = y - this.read(dA);
    var b = y - this.read(dB);

    // transient noises sit outside the loop so they never feed back
    if (this.buzzAmt > 0.000001) {
      var bn = this.rng.bi() * this.buzzAmt;
      this.buzzLp = this.buzzLp + 0.55 * (bn - this.buzzLp);
      var bv = bn - this.buzzLp;                  // bright rattle, not rumble
      a += bv; b += bv;
      this.buzzAmt *= this.buzzDec;
    }
    if (this.relAmt > 0.000001) {
      var rn = this.rng.bi() * this.relAmt;
      this.relLp = this.relLp + 0.30 * (rn - this.relLp);
      var rv = rn - this.relLp;
      a += rv; b += rv;
      this.relAmt *= this.relDec;
    }
    if (this.shiftAmt > 0.000001) {
      // narrower and duller than buzz — skin on winding, not metal on fret
      var sn2 = this.rng.bi() * this.shiftAmt;
      this.shiftLp = this.shiftLp + 0.18 * (sn2 - this.shiftLp);
      var sv = this.shiftLp;
      a += sv; b += sv;
      this.shiftAmt *= this.shiftDec;
    }

    if (this.atkOn) this._atk = this.tickAttack(layerData);

    this._a = a; this._b = b;
    return y;
  };

  /* ATTACK LAYER — the hybrid and sampled paths. Linear interpolation is
     deliberate: it is exactly reproducible in C++, and the layer is a short
     transient where the artefacts of better interpolation are inaudible. */
  String_.prototype.tickAttack = function (data) {
    if (!data) { this.atkOn = false; return 0; }
    var p0 = this.atkPos | 0;
    if (p0 >= data.length - 1) { this.atkOn = false; return 0; }
    var f = this.atkPos - p0;
    var v = data[p0] * (1 - f) + data[p0 + 1] * f;
    this.atkPos += this.atkRate;
    v *= this.atkEnv;
    this.atkEnv *= this.atkDec;
    if (this.atkEnv < 0.00002) this.atkOn = false;
    return v;
  };

  // ------------------------------------------------------------------
  // 6. BODY — an air mode and two wood modes
  // ------------------------------------------------------------------
  function Biquad() { this.b0 = 0; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
                      this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  Biquad.prototype.bandpass = function (f, q, sr) {
    var w = TWO_PI * clamp(f, 20, sr * 0.45) / sr;
    var sn = _NM.sin(w), cs = _NM.cos(w);
    var al = sn / (2 * clamp(q, 0.3, 20));
    var a0 = 1 + al;
    this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0;
    this.a1 = -2 * cs / a0; this.a2 = (1 - al) / a0;
  };
  /* Resonant lowpass — the RLC a pickup coil actually is. */
  Biquad.prototype.lowpassRes = function (f, q, sr) {
    var w = TWO_PI * clamp(f, 20, sr * 0.45) / sr;
    var sn = _NM.sin(w), cs = _NM.cos(w);
    var al = sn / (2 * clamp(q, 0.1, 20));
    var a0 = 1 + al;
    this.b0 = ((1 - cs) / 2) / a0; this.b1 = (1 - cs) / a0; this.b2 = this.b0;
    this.a1 = -2 * cs / a0; this.a2 = (1 - al) / a0;
  };
  Biquad.prototype.tick = function (x) {
    var y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  };
  Biquad.prototype.reset = function () { this.x1 = this.x2 = this.y1 = this.y2 = 0; };

  /* A real instrument body is not one resonance. The air mode does the
     thump; the wood modes are what stop it sounding like a filter sweep.
     Ratios are fixed rather than exposed because they describe a shape of
     object, not a taste — the user moves the air mode and the rest follows. */
  var WOOD_RATIO_1 = 2.16, WOOD_RATIO_2 = 4.42;
  function Body(sr) {
    this.sr = sr;
    this.air = new Biquad(); this.w1 = new Biquad(); this.w2 = new Biquad();
    this.woodMix = 0.4;
    this.set(92, 3.2, 0.4);
  }
  Body.prototype.set = function (f, q, woodMix) {
    this.air.bandpass(f, q, this.sr);
    this.w1.bandpass(f * WOOD_RATIO_1, clamp(q * 1.7, 0.3, 20), this.sr);
    this.w2.bandpass(f * WOOD_RATIO_2, clamp(q * 2.3, 0.3, 20), this.sr);
    this.woodMix = clamp(woodMix, 0, 1);
  };
  Body.prototype.tick = function (x) {
    var a = this.air.tick(x);
    var b = this.w1.tick(x) * 0.55 + this.w2.tick(x) * 0.30;
    return a + b * this.woodMix;
  };
  Body.prototype.reset = function () { this.air.reset(); this.w1.reset(); this.w2.reset(); };

  // ------------------------------------------------------------------
  // 7. THE INSTRUMENT
  // ------------------------------------------------------------------
  function PallbearerCore(sampleRate, seed) {
    this.sr = sampleRate || 48000;
    this.seed = (seed === undefined ? 0x5EED1E : seed) >>> 0;
    this.noteCounter = 0;
    this.p = defaults();
    this.tuningKey = this.p.tuning;
    this.open = TUNINGS[this.tuningKey].open.slice();
    this.strings = [];
    this.handPos = 5;
    this.handVel = 0;              // smoothed direction of travel along the neck
    this.drift = 0;                // the slow walk under the per-note jitter
    this.driftRng = new Rng(this.seed ^ 0x9E3779B9);
    this.coupleBus = 0;            // last sample's summed bridge radiation
    this.body = new Body(this.sr);
    this.body.set(this.p.bodyFreq, this.p.bodyQ, this.p.woodMix);
    this.coil = new Biquad();
    this.coil.lowpassRes(this.p.coilFreq, this.p.coilQ, this.sr);
    this.tonez = 0;
    this.toneCoef = 0.3;
    this.attackLayer = null;
    this._rebuild();
    this._recalcTone();
  }

  PallbearerCore.prototype._rebuild = function () {
    var want = this.open.length;
    while (this.strings.length < want) this.strings.push(new String_(this.sr));
    while (this.strings.length > want) this.strings.pop();
    this.busy = new Array(want);
    for (var i = 0; i < want; i++) this.busy[i] = false;
  };

  PallbearerCore.prototype._recalcTone = function () {
    var w = TWO_PI * clamp(this.p.tone, 50, this.sr * 0.45) / this.sr;
    this.toneCoef = clamp(w / (w + 1), 0.001, 0.999);
  };

  PallbearerCore.prototype.setParam = function (id, value) {
    var def = PARAM_BY_ID[id];
    if (!def) return false;
    if (def.type === 'enum') {
      if (def.options.indexOf(value) < 0) return false;
      this.p[id] = value;
    } else {
      this.p[id] = clamp(san(Number(value), def.def), def.min, def.max);
    }
    if (id === 'tuning') {
      this.tuningKey = this.p.tuning;
      this.open = TUNINGS[this.tuningKey].open.slice();
      this._rebuild();
      this.allOff();
    }
    if (id === 'bodyFreq' || id === 'bodyQ' || id === 'woodMix')
      this.body.set(this.p.bodyFreq, this.p.bodyQ, this.p.woodMix);
    if (id === 'coilFreq' || id === 'coilQ')
      this.coil.lowpassRes(this.p.coilFreq, this.p.coilQ, this.sr);
    if (id === 'tone') this._recalcTone();
    return true;
  };

  PallbearerCore.prototype.setPatch = function (patch) {
    var clean = sanitize(patch);
    for (var k in clean) if (Object.prototype.hasOwnProperty.call(clean, k)) this.setParam(k, clean[k]);
    return this.p;
  };

  PallbearerCore.prototype.getPatch = function () {
    var o = {};
    for (var k in this.p) if (Object.prototype.hasOwnProperty.call(this.p, k)) o[k] = this.p[k];
    return o;
  };

  /* Hybrid/sampled seam. {data:Float64Array|Float32Array, sr, root:midi}. */
  PallbearerCore.prototype.setAttackLayer = function (layer) {
    this.attackLayer = (layer && layer.data && layer.data.length) ? layer : null;
  };

  PallbearerCore.prototype.noteOn = function (note, velocity, artic) {
    var p = this.p;
    var n = (note | 0) + (p.capo | 0);
    var vel = clamp(san(Number(velocity), 0.8), 0, 1);
    vel = 1 - p.velSense + p.velSense * vel;

    var pick = chooseString(n, this.open, p.frets, this.handPos, this.busy, this.handVel);
    if (!pick) return null;

    var st = this.strings[pick.string];
    var f0 = midiToFreq(n);
    var shape = styleShape(p.style, p.hardness);
    var art = articShape(artic === undefined ? p.artic : artic);

    /* THE HAND, as a thing with a position and a direction. `shift` is how
       far it actually travelled to reach this note; handVel is a smoothed
       memory of which way it has been going, which chooseString reads back
       so that a run up the neck keeps going up. An open string costs no
       travel, which is exactly why players reach for them. */
    var shift = (pick.fret === 0) ? 0 : (pick.fret - this.handPos);
    this.handVel = this.handVel * 0.55 + shift * 0.45;
    this.handPos = pick.fret;

    if (st.sounding && !st.releasing && p.glide > 0.0005) {
      st.slideTo(f0 * art.mult, p.glide);
      st.note = n;
      return { string: pick.string, fret: pick.fret, slid: true, shift: shift };
    }

    /* Advance the walk once per note, from the instrument's own generator
       rather than the note's, so it is a property of the performance and
       not of any single pluck. Mean-reverting so it wanders without
       escaping — a hand that drifts forever is not a hand. */
    this.drift = clamp(this.drift * 0.82 + this.driftRng.bi() * 0.38, -1, 1);

    this.noteCounter = (this.noteCounter + 1) >>> 0;
    var seed = seedFor(this.seed, n, pick.string, this.noteCounter);
    st.pluck(f0, vel, p, shape, art, seed, this.attackLayer, p.style, this.drift, shift);
    st.note = n;
    this.busy[pick.string] = true;

    return { string: pick.string, fret: pick.fret, slid: false, shift: shift };
  };

  PallbearerCore.prototype.noteOff = function (note) {
    var n = (note | 0) + (this.p.capo | 0);
    for (var i = 0; i < this.strings.length; i++) {
      if (this.strings[i].sounding && this.strings[i].note === n) {
        this.strings[i].release(this.p.relDamp, this.p.relNoise);
        this.busy[i] = false;
      }
    }
  };

  PallbearerCore.prototype.allOff = function () {
    for (var i = 0; i < this.strings.length; i++) { this.strings[i].reset(); this.busy[i] = false; }
    this.tonez = 0;
    this.coupleBus = 0;
    this.handVel = 0;
    this.body.reset();
    this.coil.reset();
  };

  PallbearerCore.prototype.soundingCount = function () {
    var c = 0;
    for (var i = 0; i < this.strings.length; i++) if (this.strings[i].sounding) c++;
    return c;
  };

  PallbearerCore.prototype.render = function (outL, outR, n) {
    var p = this.p;
    var inv = p.pickupInv === 'out' ? -1 : 1;
    var mix = p.pickupMix;
    var drive = p.drive;
    var lvl = p.level;
    var bodyMix = p.bodyMix;
    var strGain = p.strGain;
    var atkGain = p.atkGain;
    var layerData = this.attackLayer ? this.attackLayer.data : null;
    var nStr = this.strings.length;

    /* SYMPATHETIC COUPLING, properly. v0.2 nudged an envelope, which was a
       gesture rather than a model. The real mechanism is the bridge: every
       string is bolted to the same lump of metal, so each one is driven by
       what all the others radiate. That is why an undamped bass rings
       differently from a muted one even on notes you did not play.

       The bus carries LAST sample's total, not this one's. Feeding a string
       the sum that includes its own present output would close a delay-free
       loop, which is not a model of anything — it is an oscillator. */
    var couple = p.couple;
    var bus = this.coupleBus;
    var COUPLE_K = 0.018;          // small: this path is inside the feedback loop

    /* THE OSCILLATION FIX (2026-09-01). `bus` was the raw SUM of every other
       string's bridge output, so the loop gain seen by any one string scaled
       with how many strings were feeding it: a six-string got roughly 1.5x
       the injection a four-string did at the same `couple` value, which is
       why the self-oscillation threshold measured differently per tuning
       (0.42 / 0.34 / 0.27 for four / five / six strings) instead of being one
       property of the parameter. Multiplying each threshold by (N-1) collapsed
       them to 1.26 / 1.36 / 1.35 — confirmation the missing term was a plain
       divisor. Diagnosed in THE_VIEWING.html, applied here: divide by the
       number of OTHER strings actually contributing, so `couple` means the
       same thing regardless of tuning. Guarded at 1 for the degenerate case
       so a future single-string patch cannot divide by zero. */
    var coupleDiv = nStr > 1 ? (nStr - 1) : 1;

    /* Prime the idle strings on demand. Doing it here rather than eagerly
       means the cost is only paid when coupling is actually switched on,
       and it cannot be got wrong by a parameter change arriving in the
       wrong order. */
    var coupling = couple > 0.001;
    if (coupling) {
      for (var ps2 = 0; ps2 < nStr; ps2++) {
        var pst = this.strings[ps2];
        if (!pst.primed && !pst.sounding) pst.prime(midiToFreq(this.open[ps2]), p);
      }
    }

    for (var i = 0; i < n; i++) {
      var sum = 0;
      var newBus = 0;
      for (var s = 0; s < nStr; s++) {
        var st = this.strings[s];
        var runs = st.sounding || st.atkOn || (coupling && st.passive);
        if (!runs) { st._bridge = 0; continue; }
        var inject = 0;
        if (coupling) inject = COUPLE_K * couple * (bus - st._bridge) / coupleDiv;
        var bridge = st.tick(inject, layerData);
        st._bridge = bridge;
        newBus += bridge;
        /* strGain scales the modelled string; the attack layer rides at its
           OWN gain on a separate accumulator. That separation is the whole
           three-path architecture in one line: strGain 1 / atkGain 0 is
           modelled, both non-zero is hybrid, strGain 0 / atkGain 1 is the
           pure sampled path. Scaling the layer by strGain — which the first
           draft did — silences exactly the case the seam exists for. */
        sum += (st._a * (1 - mix) + st._b * mix * inv) * strGain + st._atk * atkGain;
      }
      bus = newBus;

      /* The coil sits between the pickups and everything else, because that
         is where it is: the resonance is a property of the transducer, so it
         colours what the pickups produced and not what the body adds. */
      sum = this.coil.tick(sum);

      if (bodyMix > 0.001) sum = sum * (1 - bodyMix) + this.body.tick(sum) * bodyMix * 2.2;

      this.tonez += this.toneCoef * (sum - this.tonez);
      var y = this.tonez;

      if (drive > 0.001) {
        var g = 1 + drive * 6;
        var xg = y * g;
        y = xg / (1 + Math.abs(xg));
        y *= (1 + drive * 0.5);
      }

      y *= lvl;
      if (y > 1.6) y = 1.6; else if (y < -1.6) y = -1.6;
      outL[i] = y;
      outR[i] = y;
    }
    this.coupleBus = bus;
    return n;
  };

  // ------------------------------------------------------------------
  // 8. OFFLINE RENDER
  // ------------------------------------------------------------------
  function renderNote(patch, note, seconds, sampleRate, velocity, holdSec, seed, artic) {
    var sr = sampleRate || 48000;
    var core = new PallbearerCore(sr, seed === undefined ? 0x5EED1E : seed);
    core.setPatch(patch);
    var n = Math.floor(seconds * sr);
    var L = new Float64Array(n), R = new Float64Array(n);
    var hold = Math.floor((holdSec === undefined ? seconds : holdSec) * sr);
    core.noteOn(note, velocity === undefined ? 0.9 : velocity, artic);
    var block = 128, done = 0;
    var tmpL = new Float64Array(block), tmpR = new Float64Array(block);
    var released = false;
    while (done < n) {
      if (!released && done >= hold) { core.noteOff(note); released = true; }
      var m = Math.min(block, n - done);
      core.render(tmpL, tmpR, m);
      L.set(tmpL.subarray(0, m), done);
      R.set(tmpR.subarray(0, m), done);
      done += m;
    }
    return { L: L, R: R, sr: sr };
  }

  /* A short scripted phrase — the regression unit. Same patch, same seed,
     same notes, same bytes, forever, unless someone changes the DSP. */
  function renderPhrase(patch, notes, sr, seed, noteSec) {
    sr = sr || 48000;
    var ns = noteSec || 0.35;
    var core = new PallbearerCore(sr, seed === undefined ? 0x5EED1E : seed);
    core.setPatch(patch);
    var total = Math.floor((notes.length * ns + 0.9) * sr);
    var L = new Float64Array(total), R = new Float64Array(total);
    var blk = 64, tl = new Float64Array(blk), tr = new Float64Array(blk);
    var pos = 0, ni = 0, nextOn = 0, offAt = -1, cur = -1;
    while (pos < total) {
      while (ni < notes.length && pos >= nextOn) {
        if (cur >= 0) { core.noteOff(cur); cur = -1; }
        cur = notes[ni]; core.noteOn(cur, 0.88);
        offAt = pos + Math.floor(ns * 0.85 * sr);
        nextOn += Math.floor(ns * sr); ni++;
      }
      if (offAt > 0 && pos >= offAt && cur >= 0) { core.noteOff(cur); cur = -1; offAt = -1; }
      var m = Math.min(blk, total - pos);
      core.render(tl, tr, m);
      L.set(tl.subarray(0, m), pos); R.set(tr.subarray(0, m), pos);
      pos += m;
    }
    return { L: L, R: R, sr: sr };
  }

  /* FNV-1a over the raw bytes. Same hash the other three use in spirit:
     a byte-stable baseline is the cheapest possible proof that a change
     which was supposed to be inaudible actually was. */
  function hashBuf(buf) {
    var h = 0x811c9dc5;
    var view = new Float64Array(buf.length);
    view.set(buf);
    var bytes = new Uint8Array(view.buffer);
    for (var i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  function estimateF0(buf, sr, loHz, hiHz) {
    var lo = Math.floor(sr / (hiHz || 400));
    var hi = Math.floor(sr / (loHz || 25));
    if (hi > buf.length - 2) hi = buf.length - 2;
    var best = -1, bestLag = -1;
    for (var lag = lo; lag <= hi; lag++) {
      var s = 0;
      for (var i = 0; i + lag < buf.length; i++) s += buf[i] * buf[i + lag];
      if (s > best) { best = s; bestLag = lag; }
    }
    if (bestLag < 1) return 0;
    function corr(L) { var s = 0; for (var i = 0; i + L < buf.length; i++) s += buf[i] * buf[i + L]; return s; }
    var y0 = corr(bestLag - 1), y1 = best, y2 = corr(bestLag + 1);
    var denom = (y0 - 2 * y1 + y2);
    var d = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
    return sr / (bestLag + d);
  }

  function centsBetween(a, b) { return 1200 * (_NM.log(a / b) / LN2); }

  // ------------------------------------------------------------------
  // 9. API
  // ------------------------------------------------------------------
  var api = {
    VERSION: '0.3',
    PARAMS: PARAMS,
    PARAM_BY_ID: PARAM_BY_ID,
    TUNINGS: TUNINGS,
    PallbearerCore: PallbearerCore,
    String_: String_,
    Allpass1: Allpass1,
    Biquad: Biquad,
    Body: Body,
    Rng: Rng,
    defaults: defaults,
    sanitize: sanitize,
    seedFor: seedFor,
    midiToFreq: midiToFreq,
    fretPositions: fretPositions,
    chooseString: chooseString,
    pickupNulls: pickupNulls,
    loopGainFor: loopGainFor,
    dispersionFor: dispersionFor,
    styleShape: styleShape,
    articShape: articShape,
    velBrightness: velBrightness,
    renderNote: renderNote,
    renderPhrase: renderPhrase,
    hashBuf: hashBuf,
    estimateF0: estimateF0,
    centsBetween: centsBetween,
    clamp: clamp,
    WOOD_RATIO_1: WOOD_RATIO_1,
    WOOD_RATIO_2: WOOD_RATIO_2
  };

  return api;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PB;

/* ===================================================================
   THE ONLY FRAMEWORK-SPECIFIC CODE IN THIS FILE
   AudioWorklet wrapper. It lives at the bottom, it has no C++
   counterpart, and it touches nothing above.
   =================================================================== */
if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor === 'function') {
  /* eslint-disable no-undef */
  class PallbearerProcessor extends AudioWorkletProcessor {
    constructor(opts) {
      super();
      this.core = new PB.PallbearerCore(sampleRate);
      this.tmpL = new Float64Array(256);
      this.tmpR = new Float64Array(256);
      var self = this;
      this.port.onmessage = function (e) {
        var m = e.data;
        if (!m) return;
        if (m.type === 'noteOn') {
          var r = self.core.noteOn(m.note, m.vel, m.artic);
          self.port.postMessage({ type: 'played', note: m.note, hit: r });
        } else if (m.type === 'noteOff') self.core.noteOff(m.note);
        else if (m.type === 'param') self.core.setParam(m.id, m.value);
        else if (m.type === 'patch') self.core.setPatch(m.patch);
        else if (m.type === 'panic') self.core.allOff();
        else if (m.type === 'layer') {
          self.core.setAttackLayer(m.layer ? { data: m.layer.data, sr: m.layer.sr, root: m.layer.root } : null);
          self.port.postMessage({ type: 'layerOk', have: !!self.core.attackLayer });
        }
      };
    }
    process(inputs, outputs) {
      var out = outputs[0];
      if (!out || !out.length) return true;
      var n = out[0].length;
      if (this.tmpL.length < n) { this.tmpL = new Float64Array(n); this.tmpR = new Float64Array(n); }
      this.core.render(this.tmpL, this.tmpR, n);
      var L = out[0], R = out.length > 1 ? out[1] : null;
      for (var i = 0; i < n; i++) { L[i] = this.tmpL[i]; if (R) R[i] = this.tmpL[i]; }
      return true;
    }
  }
  registerProcessor('pallbearer', PallbearerProcessor);
}
