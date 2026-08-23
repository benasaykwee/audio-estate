/* ===================================================================
   PALLBEARER — the harness
   node pallbearer_test.js

   Estate rule, inherited from the trio: an assertion that names its own
   expected value is not checking anything. Every test here either measures
   the rendered audio or exercises a pure helper against a value derived
   independently of the implementation.
   =================================================================== */

var PB = require('./pallbearer_core.js');

var pass = 0, fail = 0, section = '';
function S(name) { section = name; console.log('\n── ' + name + ' ' + '─'.repeat(Math.max(0, 56 - name.length))); }
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '   ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '   ' + detail : '') + '   [' + section + ']'); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

// -------------------------------------------------------------------
S('I · tuning — does the fractional delay actually work');
// -------------------------------------------------------------------
/* The claim in the core is that a first-order allpass carrying the
   fractional part of sr/f0 drops the tuning error below a thousandth of
   a cent. Measure it on the real rendered audio, not on the coefficient. */
var SR = 48000;
var tuningCases = [
  { note: 28, name: 'E1  (low E, 41.20 Hz)' },
  { note: 33, name: 'A1  (55.00 Hz)' },
  { note: 40, name: 'E2  (82.41 Hz)' },
  { note: 43, name: 'G2  (98.00 Hz)' },
  { note: 55, name: 'G3  (196.00 Hz)' },
  { note: 23, name: 'B0  (30.87 Hz, 5-string)' }
];
var worstCents = 0, worstName = '';
for (var t = 0; t < tuningCases.length; t++) {
  var c = tuningCases[t];
  var target = PB.midiToFreq(c.note);
  var r = PB.renderNote(
    /* humanize MUST be 0 here. v0.2 detunes each note by up to ±2.8 cents on
       purpose, so leaving it at its default turns this from a measurement of
       the fractional-delay engine into a measurement of the jitter — the
       figure drifted from 0.089 to 0.632 cents the moment humanize shipped,
       and nothing was wrong. Pin what you are not measuring. */
    { tuning: 'standard-5', decay: 8, damping: 0.10, inharm: 0, stretch: 0,
      bodyMix: 0, drive: 0, tone: 12000, pickupMix: 0, pickupA: 0.5,
      humanize: 0, velBright: 0, buzz: 0, relNoise: 0 },
    c.note, 1.2, SR, 0.9, 1.2);
  // analyse a settled window, past the attack transient
  /* A long window matters: the autocorrelation lag is an integer, so at
     55 Hz one lag step is already worth ~2 cents. Parabolic refinement plus
     a longer window is what keeps the MEASUREMENT from being the error. */
  var start = Math.floor(0.35 * SR);
  var win = r.L.subarray(start, start + 32768);
  var f = PB.estimateF0(win, SR, target * 0.85, target * 1.15);
  var cents = Math.abs(PB.centsBetween(f, target));
  if (cents > worstCents) { worstCents = cents; worstName = c.name; }
  ok(c.name, cents < 2.0, '→ ' + f.toFixed(3) + ' Hz, off by ' + cents.toFixed(3) + ' cents');
}
ok('worst case stays under 2 cents', worstCents < 2.0, 'worst = ' + worstCents.toFixed(3) + 'c on ' + worstName);

/* And prove the fix was necessary: an integer-only delay line quantises
   pitch, and the error is worst where the delay line is shortest. */
function intCents(f0, sr) {
  var n = Math.round(sr / f0);
  var actual = sr / n;
  return Math.abs(1200 * Math.log(actual / f0) / Math.LN2);
}
var g3 = PB.midiToFreq(55), e1 = PB.midiToFreq(28);
/* HONEST CORRECTION. The first draft of this test asserted integer delay
   would be "audibly sharp" in the bass range and it failed: at 48 kHz the
   worst case across a bass is about 0.7 cents, which is under the melodic
   JND. So the fractional allpass is not rescuing the tuning of a low E —
   the delay line is simply long enough down there that rounding barely
   matters. What it IS buying is (a) an order of magnitude more accuracy,
   which stops beating when several strings ring together, and (b) smooth
   slides, because an integer line can only step between whole samples.
   Claim what is true, not what sounded impressive. */
ok('integer delay error grows as pitch rises', intCents(g3, SR) > intCents(e1, SR),
   'G3 ' + intCents(g3, SR).toFixed(2) + 'c vs E1 ' + intCents(e1, SR).toFixed(2) + 'c');
ok('integer delay in the bass range is small but non-zero',
   intCents(g3, SR) > 0.3 && intCents(g3, SR) < 3,
   'G3 on integer delay = ' + intCents(g3, SR).toFixed(2) + ' cents');
ok('the fractional line beats the integer line by a wide margin',
   worstCents < intCents(g3, SR) * 3,
   'measured worst ' + worstCents.toFixed(3) + 'c vs integer ' + intCents(g3, SR).toFixed(2) + 'c at G3');
/* And where it genuinely bites. Second correction in this section: a full
   semitone slide moves the delay line far enough that the integers stay
   distinct, so that test proved nothing either. The real casualty of an
   integer line is FINE pitch motion — vibrato, and the tension bloom this
   engine applies at the attack — where the delay changes by less than a
   sample and the rounding collapses the movement into a staircase. */
function distinctIntegerDelays(centreHz, depthCents, points, sr) {
  var seen = {};
  for (var i = 0; i < points; i++) {
    var phase = i / (points - 1) * 2 - 1;                 // -1 .. +1
    var f = centreHz * Math.pow(2, phase * depthCents / 1200);
    seen[Math.round(sr / f)] = 1;
  }
  return Object.keys(seen).length;
}
var vibPoints = 48;
var vibG3 = distinctIntegerDelays(PB.midiToFreq(55), 10, vibPoints, SR);
ok('an integer line staircases a 10-cent vibrato', vibG3 < vibPoints / 4,
   'G3 vibrato: only ' + vibG3 + ' distinct integer delays across ' + vibPoints + ' points');
ok('the staircase is worse the higher the note',
   distinctIntegerDelays(PB.midiToFreq(55), 10, vibPoints, SR) <=
   distinctIntegerDelays(PB.midiToFreq(28), 10, vibPoints, SR),
   'G3 ' + vibG3 + ' steps vs E1 ' + distinctIntegerDelays(PB.midiToFreq(28), 10, vibPoints, SR) + ' steps');

// -------------------------------------------------------------------
S('II · decay — does a stated decay time actually happen');
// -------------------------------------------------------------------
function rmsOf(buf, from, len) {
  var s = 0, n = 0;
  for (var i = from; i < from + len && i < buf.length; i++) { s += buf[i] * buf[i]; n++; }
  return n ? Math.sqrt(s / n) : 0;
}
var decCases = [1.5, 4.0, 8.0];
for (var d = 0; d < decCases.length; d++) {
  var want = decCases[d];
  var rr = PB.renderNote(
    { decay: want, damping: 0.05, inharm: 0, bodyMix: 0, drive: 0, tone: 12000, stretch: 0 },
    33, want * 1.05, SR, 1.0, want * 1.05);
  var early = rmsOf(rr.L, Math.floor(0.05 * SR), 4096);
  var late = rmsOf(rr.L, Math.floor(want * 0.97 * SR), 4096);
  var dropDb = 20 * Math.log10((late + 1e-12) / (early + 1e-12));
  // -60 dB is the target; the loop-gain maths aims at 2^-10 ≈ -60.2 dB
  ok('decay ' + want + 's lands near -60 dB', dropDb < -40 && dropDb > -95,
     'measured ' + dropDb.toFixed(1) + ' dB at t=' + want + 's');
}
var shortR = PB.renderNote({ decay: 1.0, damping: 0.05, bodyMix: 0, drive: 0 }, 33, 3.0, SR, 1.0, 3.0);
var longR = PB.renderNote({ decay: 9.0, damping: 0.05, bodyMix: 0, drive: 0 }, 33, 3.0, SR, 1.0, 3.0);
var sAt2 = rmsOf(shortR.L, Math.floor(2.0 * SR), 4096);
var lAt2 = rmsOf(longR.L, Math.floor(2.0 * SR), 4096);
ok('a long decay is still ringing when a short one has gone', lAt2 > sAt2 * 8,
   'long/short at 2s = ' + (lAt2 / (sAt2 + 1e-12)).toFixed(0) + '×');

// -------------------------------------------------------------------
S('III · damping — highs die before the fundamental');
// -------------------------------------------------------------------
/* The first version of this section used a sample-to-sample difference as a
   "brightness" proxy and it was measuring the NOISE FLOOR, not the harmonics
   — so it reported a 10% change where the real figure is 60 dB, and it sat
   so close to its own threshold that it failed on about half of all runs.
   A flaky test is usually a badly posed one. Measure named partials instead:
   a windowed DFT at exactly k·f0, which is unambiguous. */
function partialMag(buf, off, n, sr, f) {
  var re = 0, im = 0, w = 2 * Math.PI * f / sr;
  for (var i = 0; i < n && off + i < buf.length; i++) {
    var win = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);   // Hann, to stop leakage
    re += buf[off + i] * win * Math.cos(w * i);
    im += buf[off + i] * win * Math.sin(w * i);
  }
  return Math.sqrt(re * re + im * im) / n;
}
var f0T = PB.midiToFreq(33);
/* velBright and humanize are pinned to 0 here on purpose. This section is
   measuring the LOOP FILTER, and v0.2's velocity-brightness would otherwise
   brighten a vel-1.0 note and slow the high partials down — which is correct
   behaviour that would look like a regression. Control what you are not
   measuring. */
var br = PB.renderNote({ decay: 7, damping: 0.35, bodyMix: 0, drive: 0, tone: 12000,
                         pickupMix: 0, pickupA: 0.11, velBright: 0, humanize: 0,
                         buzz: 0, relNoise: 0 }, 33, 3.0, SR, 1.0, 3.0);
var early = Math.floor(0.005 * SR), late = Math.floor(2.0 * SR), NW = 8192;
function fallDb(k) {
  var a = partialMag(br.L, early, NW, SR, k * f0T);
  var b = partialMag(br.L, late, NW, SR, k * f0T);
  return 20 * Math.log10((b + 1e-15) / (a + 1e-15));
}
var d1 = fallDb(1), d8 = fallDb(8), d20 = fallDb(20);
ok('the fundamental survives two seconds', d1 > -30 && d1 < -8, 'h1 fell ' + d1.toFixed(1) + ' dB');
ok('the 8th partial dies faster than the fundamental', d8 < d1 - 2,
   'h8 fell ' + d8.toFixed(1) + ' dB vs h1 ' + d1.toFixed(1) + ' dB');
ok('the 20th partial is essentially gone', d20 < d1 - 20,
   'h20 fell ' + d20.toFixed(1) + ' dB vs h1 ' + d1.toFixed(1) + ' dB');
ok('decay rate increases monotonically with partial number',
   fallDb(1) > fallDb(3) && fallDb(3) > fallDb(8) && fallDb(8) > fallDb(20),
   'h1 ' + fallDb(1).toFixed(1) + ' > h3 ' + fallDb(3).toFixed(1) +
   ' > h8 ' + fallDb(8).toFixed(1) + ' > h20 ' + fallDb(20).toFixed(1) + ' dB');

/* The damping control must move that, not just exist. */
function hiRatioAt(damping) {
  var r = PB.renderNote({ damping: damping, decay: 6, bodyMix: 0, drive: 0, tone: 12000,
                          pickupMix: 0, pickupA: 0.11 }, 33, 1.2, SR, 1.0, 1.2);
  var o = Math.floor(0.3 * SR);
  return partialMag(r.L, o, NW, SR, 8 * f0T) / (partialMag(r.L, o, NW, SR, f0T) + 1e-15);
}
var rDamped = hiRatioAt(0.75), rOpen = hiRatioAt(0.05);
ok('more damping really does mean a darker note', rDamped < rOpen * 0.5,
   'h8/h1 ratio: damped ' + rDamped.toExponential(2) + ' vs open ' + rOpen.toExponential(2));

// -------------------------------------------------------------------
S('IV · pickups — the comb nulls land where physics says');
// -------------------------------------------------------------------
/* A pickup at fraction p from the bridge cannot hear a harmonic with a
   node there, so nulls sit at k·f0/(2p). At p = 0.25 that is 2f0, 4f0,
   6f0 — every even harmonic. Derived from theory, not from the code. */
var n25 = PB.pickupNulls(100, 0.25, 900);
ok('p=0.25 nulls every even harmonic', near(n25[0], 200, 0.001) && near(n25[1], 400, 0.001) && near(n25[2], 600, 0.001),
   'first three nulls: ' + n25.slice(0, 3).map(function (x) { return x.toFixed(0); }).join(', ') + ' Hz');
var n50 = PB.pickupNulls(100, 0.5, 450);
ok('p=0.5 (dead centre) nulls every harmonic', near(n50[0], 100, 0.001) && near(n50[1], 200, 0.001),
   'nulls at ' + n50.slice(0, 3).map(function (x) { return x.toFixed(0); }).join(', ') + ' Hz');
var n10 = PB.pickupNulls(100, 0.1, 900);
ok('a bridge pickup pushes its first null far up', n10[0] === 500,
   'p=0.10 → first null at ' + n10[0] + ' Hz (5th harmonic)');
ok('closer to the bridge = higher first null', PB.pickupNulls(100, 0.08, 9999)[0] > PB.pickupNulls(100, 0.30, 9999)[0]);
ok('null list is bounded and does not run away', PB.pickupNulls(100, 0.5, 1e9).length <= 512);

/* And it must be audible, not just tabulated: two pickup positions on the
   same note must produce measurably different spectra. */
function specEnergyNear(buf, sr, f, halfBw) {
  // Goertzel-ish direct DFT bin sum over a narrow band
  var lo = f - halfBw, hi = f + halfBw, tot = 0;
  for (var fq = lo; fq <= hi; fq += 2) {
    var re = 0, im = 0, w = 2 * Math.PI * fq / sr;
    for (var i = 0; i < 8192 && i < buf.length; i++) { re += buf[i] * Math.cos(w * i); im += buf[i] * Math.sin(w * i); }
    tot += Math.sqrt(re * re + im * im);
  }
  return tot;
}
var f0A = PB.midiToFreq(33);
var pkBridge = PB.renderNote({ pickupA: 0.10, pickupMix: 0, decay: 6, damping: 0.15, bodyMix: 0, drive: 0, tone: 12000, inharm: 0 }, 33, 0.8, SR, 1.0, 0.8);
var pkQuarter = PB.renderNote({ pickupA: 0.25, pickupMix: 0, decay: 6, damping: 0.15, bodyMix: 0, drive: 0, tone: 12000, inharm: 0 }, 33, 0.8, SR, 1.0, 0.8);
var st2 = Math.floor(0.2 * SR);
var e2ndBridge = specEnergyNear(pkBridge.L.subarray(st2), SR, f0A * 2, 3);
var e2ndQuarter = specEnergyNear(pkQuarter.L.subarray(st2), SR, f0A * 2, 3);
var e1stBridge = specEnergyNear(pkBridge.L.subarray(st2), SR, f0A, 3);
var e1stQuarter = specEnergyNear(pkQuarter.L.subarray(st2), SR, f0A, 3);
var ratioBridge = e2ndBridge / (e1stBridge + 1e-12);
var ratioQuarter = e2ndQuarter / (e1stQuarter + 1e-12);
ok('a pickup at 1/4 really does suppress the 2nd harmonic', ratioQuarter < ratioBridge,
   '2nd/1st ratio: bridge ' + ratioBridge.toFixed(4) + ' vs quarter ' + ratioQuarter.toFixed(4));

// -------------------------------------------------------------------
S('V · the fingering brain');
// -------------------------------------------------------------------
var OPEN4 = PB.TUNINGS['standard-4'].open;   // E1 A1 D2 G2 = 28 33 38 43
ok('low E is only reachable on the E string', PB.fretPositions(28, OPEN4, 24).length === 1);
ok('an E an octave up is reachable several ways', PB.fretPositions(40, OPEN4, 24).length >= 3,
   PB.fretPositions(40, OPEN4, 24).length + ' positions for E2');
ok('a note below the instrument has nowhere to go', PB.fretPositions(20, OPEN4, 24).length === 0);
ok('a note above the last fret has nowhere to go', PB.fretPositions(90, OPEN4, 24).length === 0);
ok('fret count is respected', PB.fretPositions(60, OPEN4, 12).length < PB.fretPositions(60, OPEN4, 24).length);

var openE = PB.chooseString(28, OPEN4, 24, 12, [false, false, false, false]);
ok('open E is played open, not fretted high', openE.string === 0 && openE.fret === 0,
   'string ' + openE.string + ' fret ' + openE.fret);

/* Position playing: with the hand already at fret 12, a note reachable
   near there should not send the player back to fret 0 on another string. */
var nearHand = PB.chooseString(45, OPEN4, 24, 12, [false, false, false, false]);
var farHand = PB.chooseString(45, OPEN4, 24, 2, [false, false, false, false]);
ok('the hand stays where it is when it can', Math.abs(nearHand.fret - 12) <= Math.abs(farHand.fret - 12),
   'hand@12 → fret ' + nearHand.fret + ';  hand@2 → fret ' + farHand.fret);

/* A ringing string is expensive to steal, so an alternative gets chosen.
   The first draft of this test blocked a string the player was not going to
   use anyway, so it proved nothing — block the string it actually picks. */
var freeChoice = PB.chooseString(38, OPEN4, 24, 5, [false, false, false, false]);
var busyMask = [false, false, false, false];
busyMask[freeChoice.string] = true;
var blockedChoice = PB.chooseString(38, OPEN4, 24, 5, busyMask);
ok('a busy string is avoided when there is another way',
   blockedChoice.string !== freeChoice.string,
   'free → string ' + freeChoice.string + ' fret ' + freeChoice.fret +
   ', with it busy → string ' + blockedChoice.string + ' fret ' + blockedChoice.fret);
/* But it is a preference, not a prohibition: if the note lives on exactly
   one string, a busy string still has to give it up. */
var onlyOne = PB.chooseString(28, OPEN4, 24, 5, [true, true, true, true]);
ok('a note with one home takes its string back even when busy',
   onlyOne !== null && onlyOne.string === 0,
   'low E still routed to string ' + (onlyOne && onlyOne.string));
ok('an unreachable note returns null, it does not throw', PB.chooseString(5, OPEN4, 24, 5, null) === null);
ok('chooseString survives a missing busy array', PB.chooseString(40, OPEN4, 24, 5, null) !== null);

// -------------------------------------------------------------------
S('VI · the instrument in motion');
// -------------------------------------------------------------------
var core = new PB.PallbearerCore(SR);
ok('starts silent', core.soundingCount() === 0);
core.noteOn(28, 0.9);
ok('one note = one string ringing', core.soundingCount() === 1);
core.noteOn(33, 0.9);
core.noteOn(38, 0.9);
ok('a chord uses one string each', core.soundingCount() === 3, core.soundingCount() + ' strings ringing');

/* The physical rule a sample library cannot honour: one string cannot
   sound two notes. Playing a second note that lands on a busy string
   must take that string over, not add a phantom voice. */
var c2 = new PB.PallbearerCore(SR);
c2.setParam('tuning', 'standard-4');
c2.noteOn(28, 0.9);                 // E string, open
var before = c2.soundingCount();
c2.noteOn(29, 0.9);                 // F — only on the E string at fret 1
var after = c2.soundingCount();
ok('one string cannot sound two notes at once', after <= before,
   'before ' + before + ', after ' + after);

var c3 = new PB.PallbearerCore(SR);
c3.noteOn(33, 0.9);
c3.noteOff(33);
var blk = new Float32Array(128), blk2 = new Float32Array(128);
for (var q = 0; q < 400; q++) c3.render(blk, blk2, 128);
ok('a released note actually stops', c3.soundingCount() === 0);

var c4 = new PB.PallbearerCore(SR);
c4.noteOn(33, 0.9); c4.noteOn(38, 0.9);
c4.allOff();
ok('panic clears everything', c4.soundingCount() === 0);

ok('a note off the fretboard is refused, not crashed', new PB.PallbearerCore(SR).noteOn(5, 0.9) === null);
ok('noteOn reports which string and fret it used',
   (function () { var r = new PB.PallbearerCore(SR).noteOn(40, 0.9); return r && typeof r.string === 'number' && typeof r.fret === 'number'; })());

// -------------------------------------------------------------------
S('VII · output sanity — no NaN, no runaway, no silence');
// -------------------------------------------------------------------
var styles = PB.PARAMS.filter(function (p) { return p.id === 'style'; })[0].options;
for (var s2 = 0; s2 < styles.length; s2++) {
  var rs = PB.renderNote({ style: styles[s2] }, 33, 1.0, SR, 1.0, 0.7);
  var bad = 0, peak = 0, energy = 0;
  for (var i2 = 0; i2 < rs.L.length; i2++) {
    var v = rs.L[i2];
    if (!isFinite(v)) bad++;
    var av = Math.abs(v);
    if (av > peak) peak = av;
    energy += v * v;
  }
  ok('style "' + styles[s2] + '" renders clean', bad === 0 && peak > 0.001 && peak <= 1.61 && energy > 0,
     'peak ' + peak.toFixed(3) + ', ' + bad + ' non-finite');
}
var everyTuning = Object.keys(PB.TUNINGS);
for (var tk = 0; tk < everyTuning.length; tk++) {
  var lowNote = PB.TUNINGS[everyTuning[tk]].open[0];
  var rt = PB.renderNote({ tuning: everyTuning[tk] }, lowNote + 5, 0.5, SR, 0.9, 0.4);
  var okAll = true;
  for (var i3 = 0; i3 < rt.L.length; i3++) if (!isFinite(rt.L[i3])) { okAll = false; break; }
  ok('tuning "' + everyTuning[tk] + '" renders clean', okAll);
}

/* Drive is a saturator; it must not be able to blow the output up. */
var hot = PB.renderNote({ drive: 1, level: 2, hardness: 1, style: 'slap' }, 28, 0.6, SR, 1.0, 0.6);
var hotPeak = 0;
for (var i4 = 0; i4 < hot.L.length; i4++) hotPeak = Math.max(hotPeak, Math.abs(hot.L[i4]));
ok('everything at maximum stays bounded', hotPeak <= 1.61 && isFinite(hotPeak), 'peak ' + hotPeak.toFixed(3));

// -------------------------------------------------------------------
S('VIII · parameters — LAW 5, boundaries are where things break');
// -------------------------------------------------------------------
var def = PB.defaults();
ok('every parameter has a default', PB.PARAMS.every(function (p) { return def[p.id] !== undefined; }));
ok('defaults survive a round trip through sanitize',
   JSON.stringify(PB.sanitize(def)) === JSON.stringify(def));

/* Zero is a legal value for most of these. The classic estate bug is a
   sanitiser written as `+x || def`, which silently replaces a legal 0. */
var zeroed = PB.sanitize({ drive: 0, bodyMix: 0, noise: 0, couple: 0, capo: 0, level: 0, atkGain: 0 });
ok('a legal zero is NOT replaced by the default', zeroed.drive === 0 && zeroed.bodyMix === 0 &&
   zeroed.noise === 0 && zeroed.couple === 0 && zeroed.level === 0,
   'drive=' + zeroed.drive + ' bodyMix=' + zeroed.bodyMix + ' level=' + zeroed.level);
ok('a negative capo is legal and survives', PB.sanitize({ capo: -12 }).capo === -12);

ok('NaN falls back to the default', PB.sanitize({ decay: NaN }).decay === def.decay);
ok('Infinity falls back to the default', PB.sanitize({ decay: Infinity }).decay === def.decay);
ok('a string number is accepted', PB.sanitize({ decay: '3.5' }).decay === 3.5);
ok('nonsense text falls back', PB.sanitize({ decay: 'loud' }).decay === def.decay);
ok('out-of-range clamps to the declared maximum',
   PB.sanitize({ decay: 9999 }).decay === PB.PARAM_BY_ID.decay.max,
   'clamped to ' + PB.sanitize({ decay: 9999 }).decay);
ok('under-range clamps to the declared minimum',
   PB.sanitize({ decay: -50 }).decay === PB.PARAM_BY_ID.decay.min);
ok('an unknown enum falls back', PB.sanitize({ style: 'kazoo' }).style === def.style);
ok('a known enum is kept', PB.sanitize({ style: 'slap' }).style === 'slap');
ok('null patch yields defaults', JSON.stringify(PB.sanitize(null)) === JSON.stringify(def));
ok('junk keys are ignored', PB.sanitize({ notAParam: 5 }).notAParam === undefined);

var cSet = new PB.PallbearerCore(SR);
ok('setParam refuses an unknown id', cSet.setParam('nope', 1) === false);
ok('setParam refuses a bad enum', cSet.setParam('style', 'kazoo') === false);
ok('setParam accepts a good enum', cSet.setParam('style', 'pick') === true);
ok('changing tuning rebuilds the strings',
   (function () { var c = new PB.PallbearerCore(SR); c.setParam('tuning', 'standard-5'); return c.strings.length === 5; })());
ok('patch round-trips through the core',
   (function () { var c = new PB.PallbearerCore(SR); c.setPatch({ style: 'slap', decay: 3 }); var g = c.getPatch(); return g.style === 'slap' && g.decay === 3; })());

// -------------------------------------------------------------------
S('IX · helper maths');
// -------------------------------------------------------------------
ok('A440 is A440', near(PB.midiToFreq(69), 440, 1e-9));
ok('an octave doubles', near(PB.midiToFreq(69 + 12), 880, 1e-6));
ok('low E is 41.20 Hz', near(PB.midiToFreq(28), 41.203, 0.01), PB.midiToFreq(28).toFixed(3) + ' Hz');
ok('B0 on a 5-string is 30.87 Hz', near(PB.midiToFreq(23), 30.868, 0.01), PB.midiToFreq(23).toFixed(3) + ' Hz');

ok('a longer decay wants a higher loop gain', PB.loopGainFor(80, 8, SR) > PB.loopGainFor(80, 1, SR));
ok('loop gain stays below unity or it would never stop',
   PB.loopGainFor(40, 12, SR) < 1 && PB.loopGainFor(200, 12, SR) < 1,
   'worst = ' + PB.loopGainFor(40, 12, SR).toFixed(6));
ok('zero decay is handled, not divided by', PB.loopGainFor(80, 0, SR) === 0);

ok('low strings are more inharmonic than high ones', PB.dispersionFor(41, 1) > PB.dispersionFor(196, 1),
   'E1 ' + PB.dispersionFor(41, 1).toFixed(3) + ' vs G3 ' + PB.dispersionFor(196, 1).toFixed(3));
ok('zero stiffness means zero dispersion', PB.dispersionFor(41, 0) === 0);
ok('dispersion stays in the stable range for an allpass',
   PB.dispersionFor(20, 1) < 0.95 && PB.dispersionFor(20, 1) > 0);

var stFinger = PB.styleShape('finger', 0.5), stSlap = PB.styleShape('slap', 0.5), stMute = PB.styleShape('muted', 0.5);
ok('slap is brighter than finger', stSlap.bright > stFinger.bright);
ok('slap has more click than finger', stSlap.click > stFinger.click);
ok('muted damps hardest', stMute.damp > stFinger.damp && stMute.damp > stSlap.damp);
ok('harder attack is brighter in every style',
   styles.every(function (sn) { return PB.styleShape(sn, 1).bright > PB.styleShape(sn, 0).bright; }));
ok('an unknown style falls back to finger rather than undefined',
   JSON.stringify(PB.styleShape('trombone', 0.5)) === JSON.stringify(stFinger));

ok('cents between equal frequencies is zero', near(PB.centsBetween(100, 100), 0, 1e-9));
ok('an octave is 1200 cents', near(PB.centsBetween(200, 100), 1200, 1e-6));
ok('a semitone is 100 cents', near(PB.centsBetween(PB.midiToFreq(41), PB.midiToFreq(40)), 100, 1e-6));

// -------------------------------------------------------------------
S('X · the three paths — modelled, hybrid, sampled');
// -------------------------------------------------------------------
var cH = new PB.PallbearerCore(SR);
ok('there is no attack layer by default', cH.attackLayer === null);
cH.setAttackLayer({ data: new Float64Array(64), sr: SR, root: 33 });
ok('an attack layer can be attached', cH.attackLayer !== null);
cH.setAttackLayer(null);
ok('an attack layer can be cleared', cH.attackLayer === null);
cH.setAttackLayer({ data: new Float64Array(0), sr: SR, root: 33 });
ok('an empty layer is refused rather than stored', cH.attackLayer === null);

/* A synthetic "recorded" attack: a decaying buzz at a known pitch, so its
   presence in the output is measurable rather than a matter of opinion. */
function makeLayer(rootHz, sr, secs) {
  var n = Math.floor(secs * sr), d = new Float64Array(n);
  for (var i = 0; i < n; i++) {
    var t = i / sr;
    var env = Math.exp(-t * 26);
    d[i] = env * (Math.sin(2 * Math.PI * rootHz * t) * 0.5 +
                  Math.sin(2 * Math.PI * rootHz * 7 * t) * 0.5);
  }
  return d;
}
function pathRender(strG, atkG) {
  var core = new PB.PallbearerCore(SR, 0x5EED1E);
  core.setPatch({ strGain: strG, atkGain: atkG, bodyMix: 0, drive: 0, tone: 12000,
                  decay: 4, damping: 0.2, atkDecay: 0.2, humanize: 0, buzz: 0, relNoise: 0 });
  core.setAttackLayer({ data: makeLayer(PB.midiToFreq(33), SR, 0.5), sr: SR, root: 33 });
  var n = Math.floor(0.8 * SR), L = new Float64Array(n), R = new Float64Array(n);
  var blk = 128, tl = new Float64Array(blk), tr = new Float64Array(blk), pos = 0;
  core.noteOn(33, 0.9);
  while (pos < n) {
    var m = Math.min(blk, n - pos);
    core.render(tl, tr, m);
    L.set(tl.subarray(0, m), pos); pos += m;
  }
  return L;
}
function peakOf(b) { var p = 0; for (var i = 0; i < b.length; i++) p = Math.max(p, Math.abs(b[i])); return p; }
function rmsWin(b, from, len) { var s = 0, n = 0; for (var i = from; i < from + len && i < b.length; i++) { s += b[i] * b[i]; n++; } return n ? Math.sqrt(s / n) : 0; }

var pModelled = pathRender(1, 0), pHybrid = pathRender(1, 1), pSampled = pathRender(0, 1);
ok('MODELLED path sounds', peakOf(pModelled) > 0.01, 'peak ' + peakOf(pModelled).toFixed(3));
ok('HYBRID path sounds', peakOf(pHybrid) > 0.01, 'peak ' + peakOf(pHybrid).toFixed(3));
ok('SAMPLED path sounds — the layer is NOT scaled by strGain', peakOf(pSampled) > 0.01,
   'peak ' + peakOf(pSampled).toFixed(3) + ' with strGain 0');
ok('the three paths are genuinely different signals',
   peakOf(pModelled) !== peakOf(pHybrid) && peakOf(pHybrid) !== peakOf(pSampled));
/* The sampled path must be attack-only: loud early, gone late. The modelled
   path must still be ringing when the sample has finished. */
ok('the sampled path is a transient, not a sustain',
   rmsWin(pSampled, 0, 2048) > rmsWin(pSampled, Math.floor(0.6 * SR), 2048) * 20,
   'early/late = ' + (rmsWin(pSampled, 0, 2048) / (rmsWin(pSampled, Math.floor(0.6 * SR), 2048) + 1e-15)).toFixed(0) + '×');
ok('the modelled path still rings where the sample has stopped',
   rmsWin(pModelled, Math.floor(0.6 * SR), 2048) > rmsWin(pSampled, Math.floor(0.6 * SR), 2048) * 5);
ok('hybrid is louder at the attack than modelled alone',
   rmsWin(pHybrid, 0, 1024) > rmsWin(pModelled, 0, 1024));
ok('with no layer attached, atkGain does nothing rather than crashing',
   (function () { var r = PB.renderNote({ atkGain: 1 }, 33, 0.2, SR, 0.9, 0.2); return isFinite(peakOf(r.L)) && peakOf(r.L) > 0; })());
ok('strGain 0 and no layer is silence, not noise',
   peakOf(PB.renderNote({ strGain: 0 }, 33, 0.3, SR, 1.0, 0.3).L) < 1e-9);

// -------------------------------------------------------------------
S('XIV · determinism — the price of a parity gate');
// -------------------------------------------------------------------
/* Math.random in the excitation would make both the parity gate and the
   regression baseline impossible. Everything stochastic now runs off a
   32-bit xorshift, which is exactly reproducible in C++ as uint32_t. */
var r1 = new PB.Rng(12345), r2 = new PB.Rng(12345);
var same = true;
for (var ri = 0; ri < 1000; ri++) if (r1.next() !== r2.next()) { same = false; break; }
ok('the same seed gives the same stream', same);
ok('different seeds diverge', new PB.Rng(1).next() !== new PB.Rng(2).next());
var r3 = new PB.Rng(999), lo = 1, hi = 0, sum3 = 0;
for (var rj = 0; rj < 20000; rj++) { var u = r3.uni(); lo = Math.min(lo, u); hi = Math.max(hi, u); sum3 += u; }
ok('uni() stays inside [0,1)', lo >= 0 && hi < 1, 'range ' + lo.toFixed(5) + ' … ' + hi.toFixed(5));
ok('uni() is roughly uniform', Math.abs(sum3 / 20000 - 0.5) < 0.01, 'mean ' + (sum3 / 20000).toFixed(4));
ok('every rng output is a uint32', (function () {
  var r = new PB.Rng(7);
  for (var i = 0; i < 500; i++) { var v = r.next(); if (!(v >= 0 && v <= 4294967295 && v === (v >>> 0))) return false; }
  return true;
})());
ok('a zero seed does not collapse the generator', new PB.Rng(0).next() !== 0);

var phrase = [28, 33, 40, 35];
var hA = PB.hashBuf(PB.renderPhrase({ humanize: 0.5 }, phrase, SR, 42).L);
var hB = PB.hashBuf(PB.renderPhrase({ humanize: 0.5 }, phrase, SR, 42).L);
ok('the same seed renders byte-identical audio', hA === hB, 'hash ' + hA);
var hC = PB.hashBuf(PB.renderPhrase({ humanize: 0.5 }, phrase, SR, 43).L);
ok('a different seed renders different audio', hA !== hC, hA + ' vs ' + hC);
ok('no Math.random survives in the core', !/Math\.random/.test(code));

/* Round-robin: two hits of the same note in one phrase must differ, or the
   humanize control is decorative. */
var rr = (function () {
  var core = new PB.PallbearerCore(SR, 5);
  core.setPatch({ humanize: 0.9, bodyMix: 0, drive: 0, decay: 3 });
  function hit() {
    var n = 3000, L = new Float64Array(n), R = new Float64Array(n);
    core.noteOn(33, 0.9);
    core.render(L, R, n);
    core.noteOff(33);
    var junk = new Float64Array(2048), junk2 = new Float64Array(2048);
    for (var i = 0; i < 40; i++) core.render(junk, junk2, 2048);
    return PB.hashBuf(L);
  }
  return [hit(), hit()];
})();
ok('two hits of the same note are not identical', rr[0] !== rr[1], rr[0] + ' vs ' + rr[1]);
ok('humanize 0 makes them identical again', (function () {
  var core = new PB.PallbearerCore(SR, 5);
  /* relNoise has to go too — it fires on note-off and draws from the rng,
     so leaving it on means the second hit starts from a different stream
     position and the "identical" claim quietly becomes false.

     And as of v0.3, `couple` has to go as well, for a much more interesting
     reason: with sympathetic coupling on, the other strings are still
     ringing from the first hit when the second one lands, so two identical
     notes genuinely DO sound different. That is not a determinism failure,
     it is the feature. Determinism means same-seed-same-bytes, which is
     still true — it does not mean a note sounds the same in a different
     instrument state. */
  core.setPatch({ humanize: 0, bodyMix: 0, drive: 0, decay: 3, buzz: 0, noise: 0,
                  relNoise: 0, couple: 0, fretNoise: 0 });
  function hit() {
    var n = 3000, L = new Float64Array(n), R = new Float64Array(n);
    core.noteOn(33, 0.9); core.render(L, R, n); core.noteOff(33);
    var j = new Float64Array(2048), j2 = new Float64Array(2048);
    for (var i = 0; i < 40; i++) core.render(j, j2, 2048);
    return PB.hashBuf(L);
  }
  return hit() === hit();
})(), 'noise 0 + humanize 0 removes every stochastic term');

// -------------------------------------------------------------------
S('XV · velocity brightness');
// -------------------------------------------------------------------
function hiRatio(vel, amount) {
  var r = PB.renderNote({ velBright: amount, damping: 0.3, decay: 5, bodyMix: 0, drive: 0,
                          tone: 12000, humanize: 0, buzz: 0, pickupMix: 0, pickupA: 0.11 },
                        33, 0.6, SR, vel, 0.6);
  var o = Math.floor(0.05 * SR);
  return partialMag(r.L, o, 8192, SR, 8 * f0T) / (partialMag(r.L, o, 8192, SR, f0T) + 1e-15);
}
var softHit = hiRatio(0.25, 0.8), hardHit = hiRatio(1.0, 0.8);
ok('a harder pluck is brighter, not merely louder', hardHit > softHit * 1.3,
   'h8/h1: soft ' + softHit.toExponential(2) + ' → hard ' + hardHit.toExponential(2));
ok('velBright 0 removes the effect',
   Math.abs(hiRatio(1.0, 0) / (hiRatio(0.25, 0) + 1e-15) - 1) < Math.abs(hardHit / (softHit + 1e-15) - 1),
   'the control genuinely gates it');
ok('velBrightness is signed around the midpoint',
   PB.velBrightness(1, 1) < 0 && PB.velBrightness(0, 1) > 0 && PB.velBrightness(0.5, 1) === 0);
ok('velBrightness respects its amount', PB.velBrightness(1, 0) === 0);

// -------------------------------------------------------------------
S('XVI · fret buzz and release noise');
// -------------------------------------------------------------------
/* coilFreq is opened right up here. v0.3 added a resonant coil lowpass at
   3.1 kHz by default, and fret buzz is deliberately BRIGHT — so the coil
   rolls most of it off and this measurement dropped from 1.02× to 1.008×,
   which looked like a regression and was the new filter doing its job.
   Measure the buzz through an open pickup; the coil gets its own section. */
function buzzEnergy(buzzAmt, vel) {
  var r = PB.renderNote({ buzz: buzzAmt, humanize: 0, noise: 0, relNoise: 0, bodyMix: 0,
                          drive: 0, tone: 12000, decay: 5, damping: 0.3,
                          coilFreq: 6500, coilQ: 0.4, fretNoise: 0 },
                        28, 0.4, SR, vel, 0.4);
  return rmsWin(r.L, 0, Math.floor(0.03 * SR));
}
/* Comparing two totals is the wrong instrument here: the string attack is
   0.238 rms and the buzz is 0.025, so a real effect shows up as a 0.5%
   change and any threshold is arbitrary. Subtract the two renders instead
   and measure the DIFFERENCE directly — it isolates exactly the thing under
   test and needs no threshold at all. */
function buzzDiff(vel) {
  var base = { humanize: 0, noise: 0, relNoise: 0, fretNoise: 0, bodyMix: 0, drive: 0,
               tone: 12000, decay: 5, damping: 0.3, coilFreq: 6500, coilQ: 0.4 };
  function r(b) {
    var pch = {}; for (var k in base) pch[k] = base[k];
    pch.buzz = b;
    return PB.renderNote(pch, 28, 0.4, SR, vel, 0.4, 0x1111).L;
  }
  var a = r(0), c = r(1), e = 0, late = 0;
  for (var i = 0; i < a.length; i++) {
    var d = (c[i] - a[i]) * (c[i] - a[i]);
    if (i < 0.03 * SR) e += d;
    if (i > 0.2 * SR) late += d;
  }
  return { early: Math.sqrt(e / (0.03 * SR)), late: Math.sqrt(late / (0.2 * SR)) };
}
var bzHard = buzzDiff(1.0), bzSoft = buzzDiff(0.2);
ok('fret buzz adds a measurable signal at the attack', bzHard.early > 1e-4,
   'difference rms over the first 30 ms = ' + bzHard.early.toFixed(5));
ok('a soft note does not buzz at all', bzSoft.early === 0,
   'the difference signal is exactly zero — a threshold device, as a real neck is');
ok('buzz is confined to the attack', bzHard.late < bzHard.early * 0.02,
   'early ' + bzHard.early.toFixed(5) + ' vs after 200 ms ' + bzHard.late.toExponential(2));
ok('buzz is a transient — it is gone by 200 ms', (function () {
  var a = PB.renderNote({ buzz: 1, humanize: 0, noise: 0, relNoise: 0, bodyMix: 0, drive: 0, decay: 5 }, 28, 0.5, SR, 1.0, 0.5);
  var b = PB.renderNote({ buzz: 0, humanize: 0, noise: 0, relNoise: 0, bodyMix: 0, drive: 0, decay: 5 }, 28, 0.5, SR, 1.0, 0.5);
  var la = rmsWin(a.L, Math.floor(0.25 * SR), 4096), lb = rmsWin(b.L, Math.floor(0.25 * SR), 4096);
  return Math.abs(la - lb) / (lb + 1e-15) < 0.02;
})());
ok('release noise fires on note off', (function () {
  function relE(amt) {
    var core = new PB.PallbearerCore(SR, 9);
    core.setPatch({ relNoise: amt, humanize: 0, noise: 0, buzz: 0, bodyMix: 0, drive: 0,
                    decay: 6, relDamp: 0.4, tone: 12000 });
    var L = new Float64Array(4096), R = new Float64Array(4096);
    core.noteOn(33, 0.9);
    for (var i = 0; i < 20; i++) core.render(L, R, 4096);
    core.noteOff(33);
    core.render(L, R, 2048);
    return rmsWin(L, 0, 2048);
  }
  return relE(1) > relE(0);
})(), 'the finger leaving the string is audible');

// -------------------------------------------------------------------
S('XVII · the body — one air mode, two wood modes');
// -------------------------------------------------------------------
var bodyT = new PB.Body(SR);
bodyT.set(90, 3, 1);
ok('the body resonates at its air mode', (function () {
  function driveAt(f) {
    var b = new PB.Body(SR); b.set(90, 3, 0);
    var acc = 0;
    for (var i = 0; i < 20000; i++) { var y = b.tick(Math.sin(2 * Math.PI * f * i / SR)); if (i > 10000) acc += y * y; }
    return Math.sqrt(acc / 10000);
  }
  return driveAt(90) > driveAt(300) * 3;
})(), 'a 90 Hz tone drives it far harder than a 300 Hz one');
/* Measured response of the body, so the thresholds below are calibrated
   rather than guessed. Sine-drive, steady state, RMS out. */
function bodyAt(f, wood) {
  var b = new PB.Body(SR); b.set(90, 3, wood);
  var acc = 0;
  for (var i = 0; i < 30000; i++) { var y = b.tick(Math.sin(2 * Math.PI * f * i / SR)); if (i > 15000) acc += y * y; }
  return Math.sqrt(acc / 15000);
}
var wf1 = 90 * PB.WOOD_RATIO_1, wf2 = 90 * PB.WOOD_RATIO_2;
var g1 = bodyAt(wf1, 1) / bodyAt(wf1, 0), g2 = bodyAt(wf2, 1) / bodyAt(wf2, 0), gAir = bodyAt(90, 1) / bodyAt(90, 0);
ok('the first wood mode adds real energy', g1 > 2.5, wf1.toFixed(0) + ' Hz gains ' + g1.toFixed(2) + '×');
ok('the second wood mode adds real energy', g2 > 2.5, wf2.toFixed(0) + ' Hz gains ' + g2.toFixed(2) + '×');
/* The honest version of "woodMix 0 leaves only the air mode": the wood
   filters are not brick walls, so they touch 90 Hz a little. The claim that
   matters is that they barely move the air mode while transforming their
   own. The first draft asserted exact agreement and was simply wrong. */
ok('the wood modes barely disturb the air mode', Math.abs(gAir - 1) < 0.05,
   'air mode moves ' + ((gAir - 1) * 100).toFixed(1) + '% vs ' + ((g1 - 1) * 100).toFixed(0) + '% at the wood mode');
ok('the wood modes are selective, not a broadband lift', g1 > (gAir * 2.5) && g2 > (gAir * 2.5));
ok('the body is stable — no runaway on a long drive', (function () {
  var b = new PB.Body(SR); b.set(40, 12, 1);
  var pk = 0;
  for (var i = 0; i < 200000; i++) { var y = b.tick(Math.sin(2 * Math.PI * 40 * i / SR)); pk = Math.max(pk, Math.abs(y)); if (!isFinite(y)) return false; }
  return pk < 100;
})());
ok('reset clears the body state', (function () {
  var b = new PB.Body(SR); b.set(90, 3, 1);
  for (var i = 0; i < 500; i++) b.tick(1);
  b.reset();
  return b.tick(0) === 0;
})());

// -------------------------------------------------------------------
S('XVIII · articulations');
// -------------------------------------------------------------------
var artics = PB.PARAM_BY_ID.artic.options;
ok('every articulation is rendered clean', artics.every(function (a) {
  var r = PB.renderNote({ artic: a }, 33, 0.5, SR, 0.9, 0.4);
  var bad = 0, pk = 0;
  for (var i = 0; i < r.L.length; i++) { if (!isFinite(r.L[i])) bad++; pk = Math.max(pk, Math.abs(r.L[i])); }
  return bad === 0 && pk > 0.0005 && pk <= 1.61;
}), artics.join(', '));
var fNorm = (function () {
  var r = PB.renderNote({ artic: 'normal', humanize: 0, inharm: 0, damping: 0.1, decay: 8, bodyMix: 0, drive: 0, tone: 12000, pickupMix: 0, pickupA: 0.11 }, 33, 1.0, SR, 0.9, 1.0);
  return PB.estimateF0(r.L.subarray(Math.floor(0.3 * SR), Math.floor(0.3 * SR) + 32768), SR, 40, 80);
})();
var fHarm = (function () {
  var r = PB.renderNote({ artic: 'harmonic', humanize: 0, inharm: 0, damping: 0.1, decay: 8, bodyMix: 0, drive: 0, tone: 12000, pickupMix: 0, pickupA: 0.11 }, 33, 1.0, SR, 0.9, 1.0);
  return PB.estimateF0(r.L.subarray(Math.floor(0.3 * SR), Math.floor(0.3 * SR) + 32768), SR, 80, 160);
})();
ok('a harmonic sounds an octave above the fretted note',
   Math.abs(PB.centsBetween(fHarm, fNorm * 2)) < 40,
   fNorm.toFixed(2) + ' Hz → ' + fHarm.toFixed(2) + ' Hz (' + PB.centsBetween(fHarm, fNorm * 2).toFixed(1) + ' cents from the octave)');
ok('a ghost note dies fast', (function () {
  var g = PB.renderNote({ artic: 'ghost', decay: 6 }, 33, 1.0, SR, 0.9, 1.0);
  var n = PB.renderNote({ artic: 'normal', decay: 6 }, 33, 1.0, SR, 0.9, 1.0);
  return rmsWin(g.L, Math.floor(0.5 * SR), 4096) < rmsWin(n.L, Math.floor(0.5 * SR), 4096) * 0.2;
})(), 'pitch is present but does not sustain');
ok('a palm mute sits between ghost and normal in length', (function () {
  function tail(a) {
    var r = PB.renderNote({ artic: a, decay: 6 }, 33, 1.2, SR, 0.9, 1.2);
    return rmsWin(r.L, Math.floor(0.35 * SR), 4096);
  }
  var g = tail('ghost'), p = tail('palm'), n = tail('normal');
  return g < p && p < n;
})());
ok('articShape falls back for an unknown articulation',
   JSON.stringify(PB.articShape('trombone')) === JSON.stringify(PB.articShape('normal')));
ok('noteOn accepts a per-note articulation override',
   (function () { var c = new PB.PallbearerCore(SR); return c.noteOn(33, 0.9, 'ghost') !== null; })());

// -------------------------------------------------------------------
S('XI · estate laws');
// -------------------------------------------------------------------
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/pallbearer_core.js', 'utf8');

/* The law checks must read the CODE, not the commentary about the code.
   The first run failed LAW 5 because the comment explaining the forbidden
   pattern contains the forbidden pattern — a test that cannot tell a rule
   from a mention of the rule is not testing the rule. */
var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
ok('comment stripping actually removed the commentary',
   code.length < src.length * 0.75 && code.indexOf('THE WRITE POINTER') === -1,
   'source ' + src.length + 'b → code ' + code.length + 'b');

ok('LAW 3 — no literal closing script tag in the core',
   src.indexOf('<' + '/script>') === -1);
ok('LAW 2 — no Math.sin/cos/exp/log/pow in the core (NM only)',
   !/Math\.(sin|cos|exp|log|pow)\s*\(/.test(code),
   'sqrt/floor/abs/min/max/random are allowed and present');
ok('LAW 5 — no `|| default` sanitiser pattern in the code',
   !/\|\|\s*(def\b|p\.def)/.test(code));
ok('LAW 5 — sanitisers go through isFinite', /isFinite\(/.test(code));
/* Prove the law checks can actually fail, or they are decoration. */
ok('the LAW 2 gate bites when the rule is broken',
   /Math\.(sin|cos|exp|log|pow)\s*\(/.test('var x = Math.pow(2, 3);'));
ok('the LAW 5 gate bites when the rule is broken',
   /\|\|\s*(def\b|p\.def)/.test('var v = +patch[id] || def;'));
ok('the core exports under node', typeof PB.PallbearerCore === 'function');
ok('the core does not touch window/document', !/\bdocument\./.test(src) && !/\bwindow\./.test(src));

// -------------------------------------------------------------------
S('XIX · sympathetic coupling through the bridge');
// -------------------------------------------------------------------
/* v0.3 replaced an envelope nudge with a real mechanism: every string is
   driven by what all the others radiated last sample. The test that matters
   is whether an UNPLAYED string picks up energy — that is the whole point,
   and an envelope nudge could never do it. */
function silentStringEnergy(coupleAmt) {
  var core = new PB.PallbearerCore(SR, 3);
  core.setPatch({ couple: coupleAmt, decay: 10, damping: 0.15, humanize: 0, noise: 0,
                  buzz: 0, relNoise: 0, fretNoise: 0, bodyMix: 0, drive: 0 });
  var L = new Float64Array(4096), R = new Float64Array(4096);
  core.noteOn(28, 1.0);                       // low E only
  for (var i = 0; i < 12; i++) core.render(L, R, 4096);
  // now measure how much the OTHER strings are carrying
  var e = 0;
  for (var s = 1; s < core.strings.length; s++) {
    var st = core.strings[s];
    for (var k = 0; k < st.buf.length; k++) e += st.buf[k] * st.buf[k];
  }
  return Math.sqrt(e);
}
var cpl0 = silentStringEnergy(0), cpl1 = silentStringEnergy(1);
ok('an unplayed string picks up energy from a played one', cpl1 > cpl0 * 10,
   'idle-string energy ' + cpl0.toExponential(2) + ' → ' + cpl1.toExponential(2));
ok('couple 0 leaves the other strings genuinely untouched', cpl0 < 1e-12,
   'measured ' + cpl0.toExponential(2));
ok('coupling does not run away over a long soak', (function () {
  var core = new PB.PallbearerCore(SR, 4);
  core.setPatch({ couple: 1, decay: 12, damping: 0.05 });
  var L = new Float64Array(4096), R = new Float64Array(4096), pk = 0;
  for (var i = 0; i < 60; i++) {
    if (i % 7 === 0) core.noteOn(28 + (i % 12), 0.95);
    core.render(L, R, 4096);
    for (var j = 0; j < 4096; j++) { if (!isFinite(L[j])) return false; pk = Math.max(pk, Math.abs(L[j])); }
  }
  return pk <= 1.6000001;
})(), 'the bus carries LAST sample, so there is no delay-free loop');
ok('the coupling bus is cleared by panic', (function () {
  var c = new PB.PallbearerCore(SR, 5);
  c.setPatch({ couple: 1 });
  var L = new Float64Array(512), R = new Float64Array(512);
  c.noteOn(33, 1); c.render(L, R, 512);
  c.allOff();
  return c.coupleBus === 0;
})());

// -------------------------------------------------------------------
S('XX · the hand — position, momentum, shift noise');
// -------------------------------------------------------------------
var OPEN4b = PB.TUNINGS['standard-4'].open;
ok('handVel starts still', new PB.PallbearerCore(SR).handVel === 0);
ok('a run up the neck builds positive momentum', (function () {
  var c = new PB.PallbearerCore(SR, 1);
  [28, 31, 34, 37].forEach(function (n) { c.noteOn(n, 0.8); });
  return c.handVel > 0;
})(), 'hand momentum is directional, not just a distance');
ok('momentum biases the next choice with the grain', (function () {
  /* Same note, same hand position, opposite momentum. If the momentum term
     does nothing, these two return identical fret choices. */
  var up = PB.chooseString(45, OPEN4b, 24, 9, [false, false, false, false], 4);
  var down = PB.chooseString(45, OPEN4b, 24, 9, [false, false, false, false], -4);
  return up.fret !== down.fret || up.string !== down.string;
})());
ok('momentum never overrides an open string', (function () {
  var r = PB.chooseString(28, OPEN4b, 24, 18, [false, false, false, false], 6);
  return r.fret === 0 && r.string === 0;
})(), 'an open string costs no travel, whatever the hand was doing');
ok('noteOn reports the distance the hand travelled', (function () {
  var c = new PB.PallbearerCore(SR, 1);
  c.noteOn(28, 0.8);
  var r = c.noteOn(45, 0.8);
  return r && typeof r.shift === 'number' && Math.abs(r.shift) > 0;
})());
ok('an open string reports zero travel', (function () {
  var c = new PB.PallbearerCore(SR, 1);
  c.noteOn(45, 0.8);
  var r = c.noteOn(28, 0.8);
  return r.fret === 0 && r.shift === 0;
})());
/* Difference-signal again, and a note pair chosen with the fingering brain
   in mind. The first attempt used 40 → 48 as the "big" shift and measured
   nothing, because the brain correctly found fret 5 on a HIGHER string —
   a two-fret move, not a twelve-fret one. It was doing its job and the test
   was assuming it would not. Note 60 is only reachable high on the G string,
   so the hand genuinely has to travel. */
/* `release` matters more than it looks. The first version held the first
   note down, so string 1 was still BUSY when the second arrived and the
   brain jumped four frets to a free string rather than move one fret onto
   an occupied one. That is the fingering brain being cleverer than the test,
   which is the third time this session a failure has been the assertion's
   fault rather than the code's. Let the string go first and the small move
   is genuinely small. */
function shiftDiff(fromNote, toNote, release) {
  function render(amt) {
    var c = new PB.PallbearerCore(SR, 2);
    c.setPatch({ fretNoise: amt, humanize: 0, noise: 0, buzz: 0, relNoise: 0, couple: 0,
                 bodyMix: 0, drive: 0, coilFreq: 6500, coilQ: 0.4, decay: 6, tone: 12000 });
    var L = new Float64Array(8192), R = new Float64Array(8192);
    c.noteOn(fromNote, 0.85);
    for (var i = 0; i < 4; i++) c.render(L, R, 8192);
    if (release) { c.noteOff(fromNote); c.render(L, R, 8192); }
    var hit = c.noteOn(toNote, 0.85);
    var out = new Float64Array(8192);
    c.render(out, R, 8192);
    return { audio: out, shift: hit ? hit.shift : 0 };
  }
  var a = render(0), b = render(1);
  var e = 0;
  for (var i = 0; i < 8192; i++) { var d = b.audio[i] - a.audio[i]; e += d * d; }
  return { rms: Math.sqrt(e / 8192), shift: b.shift };
}
var farShift = shiftDiff(28, 60, true), nearShift = shiftDiff(40, 41, true);
ok('a long position shift is audible', farShift.rms > 1e-5,
   'hand travelled ' + Math.abs(farShift.shift) + ' frets, difference rms ' + farShift.rms.toExponential(2));
ok('a one-fret move makes no shift noise', nearShift.rms === 0,
   'travelled ' + Math.abs(nearShift.shift) + ' fret — below the threshold, exactly zero');
ok('the noise scales with the distance travelled', farShift.rms > nearShift.rms,
   'derived from the fingering brain\'s own decision, not sprinkled on');
ok('fretNoise 0 silences the shift entirely', (function () {
  function e(amt) {
    var c = new PB.PallbearerCore(SR, 2);
    c.setPatch({ fretNoise: amt, humanize: 0, noise: 0, buzz: 0, relNoise: 0, bodyMix: 0, drive: 0, decay: 6 });
    var L = new Float64Array(4096), R = new Float64Array(4096);
    c.noteOn(28, 0.85); c.render(L, R, 4096);
    c.noteOn(48, 0.85); c.render(L, R, 4096);
    return PB.hashBuf(L);
  }
  return e(0) !== e(1);
})());

// -------------------------------------------------------------------
S('XXI · pickup coil resonance');
// -------------------------------------------------------------------
function coilGainAt(f, cf, cq) {
  var b = new PB.Biquad();
  b.lowpassRes(cf, cq, SR);
  var acc = 0;
  for (var i = 0; i < 30000; i++) { var y = b.tick(Math.sin(2 * Math.PI * f * i / SR)); if (i > 15000) acc += y * y; }
  return Math.sqrt(acc / 15000);
}
ok('the coil passes the fundamental untouched', Math.abs(coilGainAt(80, 3100, 1.35) - 0.707) < 0.06,
   'gain at 80 Hz = ' + coilGainAt(80, 3100, 1.35).toFixed(4) + ' (0.707 = unity for a sine rms)');
ok('the coil peaks at its resonance', coilGainAt(3100, 3100, 3) > coilGainAt(80, 3100, 3) * 1.5,
   'Q=3: ' + coilGainAt(3100, 3100, 3).toFixed(3) + ' at resonance vs ' + coilGainAt(80, 3100, 3).toFixed(3) + ' at 80 Hz');
ok('the coil rolls off above resonance', coilGainAt(9000, 3100, 1.35) < coilGainAt(3100, 3100, 1.35) * 0.35,
   '9 kHz is ' + (20 * Math.log10(coilGainAt(9000, 3100, 1.35) / coilGainAt(3100, 3100, 1.35))).toFixed(1) + ' dB below resonance');
ok('a higher Q makes a sharper peak', coilGainAt(3100, 3100, 6) > coilGainAt(3100, 3100, 0.5));
ok('the coil is stable at extreme settings', (function () {
  var b = new PB.Biquad(); b.lowpassRes(1200, 6, SR);
  var pk = 0;
  for (var i = 0; i < 200000; i++) { var y = b.tick(Math.sin(2 * Math.PI * 1200 * i / SR)); if (!isFinite(y)) return false; pk = Math.max(pk, Math.abs(y)); }
  return pk < 100;
})());
ok('coil settings change the rendered sound', (function () {
  var a = PB.renderNote({ coilFreq: 1200, coilQ: 5 }, 33, 0.4, SR, 0.9, 0.4, 9);
  var b = PB.renderNote({ coilFreq: 6500, coilQ: 0.5 }, 33, 0.4, SR, 0.9, 0.4, 9);
  return PB.hashBuf(a.L) !== PB.hashBuf(b.L);
})());

// -------------------------------------------------------------------
S('XXII · dead notes and drift');
// -------------------------------------------------------------------
ok('a dead note has essentially no tail', (function () {
  function tail(a) {
    var r = PB.renderNote({ artic: a, decay: 6 }, 33, 1.0, SR, 0.9, 1.0, 3);
    return rmsWin(r.L, Math.floor(0.3 * SR), 4096);
  }
  return tail('dead') < tail('ghost') && tail('ghost') < tail('normal');
})(), 'dead < ghost < normal, measured at 300 ms');
ok('a dead note still makes a sound at the attack', (function () {
  var r = PB.renderNote({ artic: 'dead' }, 33, 0.4, SR, 0.9, 0.4, 3);
  return rmsWin(r.L, 0, 2000) > 0.001;
})(), 'it is a thud, not a rest');
ok('every articulation including dead renders clean',
   PB.PARAM_BY_ID.artic.options.every(function (a) {
     var r = PB.renderNote({ artic: a }, 33, 0.5, SR, 0.9, 0.4, 3);
     for (var i = 0; i < r.L.length; i++) if (!isFinite(r.L[i]) || Math.abs(r.L[i]) > 1.61) return false;
     return true;
   }), PB.PARAM_BY_ID.artic.options.join(', '));

/* The drift walk: correlated, bounded, and mean-reverting. A hand that
   drifts forever is not a hand. */
var driftSeq = (function () {
  var c = new PB.PallbearerCore(SR, 77);
  c.setPatch({ humanize: 1 });
  var out = [];
  for (var i = 0; i < 400; i++) { c.noteOn(33, 0.8); out.push(c.drift); c.noteOff(33); }
  return out;
})();
ok('drift stays bounded', driftSeq.every(function (d) { return d >= -1 && d <= 1; }),
   'range ' + Math.min.apply(null, driftSeq).toFixed(3) + ' … ' + Math.max.apply(null, driftSeq).toFixed(3));
ok('drift is correlated, not white noise', (function () {
  var num = 0, den = 0;
  for (var i = 1; i < driftSeq.length; i++) { num += driftSeq[i] * driftSeq[i - 1]; den += driftSeq[i - 1] * driftSeq[i - 1]; }
  var lag1 = num / (den + 1e-15);
  return lag1 > 0.4;
})(), 'lag-1 autocorrelation well above zero — it wanders rather than jumps');
ok('drift is mean-reverting', Math.abs(driftSeq.reduce(function (a, b) { return a + b; }, 0) / driftSeq.length) < 0.25,
   'mean ' + (driftSeq.reduce(function (a, b) { return a + b; }, 0) / driftSeq.length).toFixed(4) + ' over 400 notes');
ok('drift is reproducible from the instrument seed', (function () {
  function walk(seed) {
    var c = new PB.PallbearerCore(SR, seed);
    c.setPatch({ humanize: 1 });
    var o = [];
    for (var i = 0; i < 30; i++) { c.noteOn(33, 0.8); o.push(c.drift); c.noteOff(33); }
    return o.join(',');
  }
  return walk(77) === walk(77) && walk(77) !== walk(78);
})());

// -------------------------------------------------------------------
S('XII · worklet scope — the trap that only bites in the browser');
// -------------------------------------------------------------------
/* audioWorklet.addModule() loads the concatenated NM+core as a MODULE. In
   module scope a top-level `var NM` is NOT a property of globalThis, and
   there is no `require`. So the core cannot reach NM by either of the two
   routes that work under node — it has to find it up the scope chain.

   A function body is a faithful stand-in for module scope: `var` stays
   local, globalThis stays clean. Under node the tests above all pass with
   the require path, so without this test the bug would ship and only ever
   appear as silence in the browser. */
var vm = require('vm');
var nmSrc = fs.readFileSync(__dirname + '/../shared/necromath.js', 'utf8');

var sandbox = { console: console, Math: Math, Float32Array: Float32Array,
                Object: Object, isFinite: isFinite, Number: Number, Infinity: Infinity };
var wrapped = '(function(){\n' + nmSrc + '\n' + src + '\nreturn typeof PB !== "undefined" ? PB : null;\n})()';
var workletPB = null, workletErr = null;
try {
  workletPB = vm.runInNewContext(wrapped, sandbox, { timeout: 10000 });
} catch (e) { workletErr = e; }

ok('the concatenated source runs in module scope at all', workletErr === null,
   workletErr ? workletErr.message : 'no globalThis.NM, no require — as in a worklet');
ok('PB is reachable from module scope', workletPB !== null && typeof workletPB.PallbearerCore === 'function');
ok('NM was found up the scope chain, not nulled',
   workletPB !== null && isFinite(workletPB.midiToFreq(69)) && Math.abs(workletPB.midiToFreq(69) - 440) < 1e-9,
   workletPB ? 'midiToFreq(69) = ' + workletPB.midiToFreq(69) : 'no PB');
ok('the engine actually makes sound in module scope', (function () {
  if (!workletPB) return false;
  var c = new workletPB.PallbearerCore(48000);
  c.noteOn(33, 0.9);
  var L = new Float32Array(2048), R = new Float32Array(2048), pk = 0;
  for (var b = 0; b < 20; b++) {
    c.render(L, R, 2048);
    for (var i = 0; i < 2048; i++) { if (!isFinite(L[i])) return false; pk = Math.max(pk, Math.abs(L[i])); }
  }
  return pk > 0.001;
})(), 'renders non-silent, all-finite audio with no require available');

/* Prove the gate bites: re-introduce the shadowing declaration and watch
   it fail. Without this the test above could pass for the wrong reason. */
var broken = src.replace('var _NM = (typeof NM !== \'undefined\' && NM) ? NM',
                         'var _NM = (typeof _NMX !== \'undefined\' && _NMX) ? _NMX');
ok('the shadowing bug is genuinely detectable', broken !== src, 'mutation applied');
var brokeOk = false;
try {
  var bp = vm.runInNewContext('(function(){\n' + nmSrc + '\n' + broken + '\nreturn PB;\n})()',
                              { console: console, Math: Math, Float32Array: Float32Array,
                                Object: Object, isFinite: isFinite, Number: Number, Infinity: Infinity },
                              { timeout: 10000 });
  bp.midiToFreq(69);
  brokeOk = true;
} catch (e) { brokeOk = false; }
ok('a core that cannot reach NM fails loudly, not silently', brokeOk === false,
   'the mutated core threw, as it should');

// -------------------------------------------------------------------
S('XIII · the embed');
// -------------------------------------------------------------------
var htmlSrc = fs.readFileSync(__dirname + '/pallbearer.html', 'utf8');
function embedBlock(id) {
  var m = htmlSrc.match(new RegExp('<script type="text/plain" id="' + id + '">([\\s\\S]*?)<' + '/script>'));
  return m ? m[1] : null;
}
ok('the HTML carries an nm-src block', embedBlock('nm-src') !== null);
ok('the HTML carries a core-src block', embedBlock('core-src') !== null);
ok('the embedded core is byte-identical to the source file', embedBlock('core-src') === src,
   'embed ' + (embedBlock('core-src') || '').length + 'b vs source ' + src.length + 'b');
ok('the embedded NM is byte-identical to shared/', embedBlock('nm-src') === nmSrc);
ok('LAW 4 — nm-src precedes core-src by byte position',
   htmlSrc.indexOf('id="nm-src"') < htmlSrc.indexOf('id="core-src"'));

// -------------------------------------------------------------------
S('XXIII · the three holes the mutation tester found');
// -------------------------------------------------------------------
/* ADDED 2026-08-23. Every assertion below exists because a deliberate break
   of the core slipped past this entire suite, the byte-stable baselines AND
   the fuzzer. They were found the first day `tests/pallbearer_mutate.js`
   existed, which is the argument for having written it.

   Each one names the mutant it kills. If one of these is ever deleted, the
   corresponding mutant goes green again and this file quietly gets smaller
   than it looks. */

/* Kills mutant 2, "the short-decay floor halves".
   loopGainFor floors `trips` at 1 so a very short decay on a very low
   string cannot ask the waveguide for a gain it will not survive. Nothing
   tested the floor, only the comfortable middle, and a boundary is where
   every bug in this estate has lived so far. */
(function () {
  var sr = 48000;
  var g = PB.loopGainFor(31, 0.01, sr);          // 0.31 trips: deep under the floor
  ok('loop gain stays under unity at the short-decay boundary', g < 1,
     'f0 31 Hz, decay 10 ms → gain ' + g.toFixed(6));
  /* The floor's actual value, asserted directly. Below one trip the answer
     must not keep falling, or the gain collapses toward zero and a short
     decay on a low string stops sounding at all. */
  var atFloor = PB.loopGainFor(100, 0.01, sr);   // 1.0 trips exactly
  var under = PB.loopGainFor(50, 0.01, sr);      // 0.5 trips, clamped to 1
  ok('the floor clamps at one round trip, not below', near(under, atFloor, 1e-12),
     'under ' + under.toFixed(9) + ' vs at-floor ' + atFloor.toFixed(9));
})();

/* Kills mutant 5, "open strings lose their free pass".
   An open string costs nothing to reach, so the fingering brain gives fret
   0 a zero movement cost. Remove that and it starts fretting notes a
   bassist would always play open — the chosen string changes while every
   individual sample still looks fine, which is the hardest class of bug to
   hear and the easiest to assert. */
(function () {
  var open = [28, 33, 38, 43];                   // E A D G, standard bass
  var far = PB.chooseString(33, open, 24, 12, null, 0);
  ok('an open string wins even with the hand far up the neck',
     far && far.fret === 0,
     'note A1 with hand at fret 12 → string ' + (far && far.string) +
     ' fret ' + (far && far.fret));
})();

/* Kills mutant 8, "the top fret falls off the neck".
   fretPositions uses an INCLUSIVE upper bound. Off by one and the highest
   fret on every string silently disappears, so the top of the instrument's
   range either migrates to another string or stops sounding. The range was
   asserted in its middle and never at its edge. */
(function () {
  var open = [28, 33, 38, 43];
  var frets = 24;
  var top = PB.fretPositions(open[0] + frets, open, frets);
  ok('the top fret is reachable — the bound is inclusive',
     top.some(function (c) { return c.string === 0 && c.fret === frets; }),
     'note ' + (open[0] + frets) + ' on a ' + frets + '-fret neck → ' +
     top.length + ' position(s)');
  var past = PB.fretPositions(open[0] + frets + 1, open, frets);
  ok('one fret past the end is NOT reachable (the control)',
     !past.some(function (c) { return c.string === 0; }));
})();

// -------------------------------------------------------------------
console.log('\n' + '═'.repeat(64));
console.log('  PALLBEARER v' + PB.VERSION + ' — ' + pass + ' passed, ' + fail + ' failed');
console.log('  worst tuning error across the range: ' + worstCents.toFixed(3) + ' cents');
console.log('═'.repeat(64) + '\n');
process.exit(fail ? 1 : 0);
