// THE UNDERWORLD — translator.
// Masterbox MasteringSettings -> an `underworld.chain` preset (UNDERWORLD_INTERCHANGE §2).
// LAW 0: emits the trilogy cores' own sanitizeState output; drives nothing here.
//
// The vocabulary map (§3.1) — every line a decision with a reason:
//
//   AUTOPSY (EQ, 12 bands max):
//     eqLow      -> low shelf  @ 100 Hz   (Masterbox FourBandEq.lowShelf)
//     eqHigh     -> high shelf @ 8000 Hz  (Masterbox FourBandEq.highShelf)
//     matchGains[10]*matchStrength -> 10 bells at the Match-EQ freqs (50..14k, Q2)
//     eqLowMid   -> FOLDED into the match bell nearest 400 Hz  (the two mid tone bells
//     eqHighMid  -> FOLDED into the match bell nearest 3000 Hz  are Q1 and broad; folding
//                   them into the nearest Q2 bell is the lossy step §3.1 warns of, chosen
//                   so all 10 match bands survive within AUTOPSY's 12-band budget.)
//     A band is `on` only if |gain| > 0.01, so a flat EQ = all-off = passthrough.
//
//   RIGOR (3-band comp) — mirrors Masterbox MultibandCompressor exactly:
//     bands:3, xover:[200,3000]           (Masterbox xLow=200, xHigh=3000)
//     thresh  = -12 - compAmount*24       (setAmount)
//     ratio   = 1.5 + compAmount*3        (setAmount)
//     attack  = 1 + punch*29 ms           (setPunch: 1..30 ms)
//     release = 150 ms, knee = 6          (Masterbox defaults)
//
//   CASKET (limiter):
//     ceilingDbTp -> lid ; makeupDb -> drive (§5.2: gain can't follow CASKET) ; targetLufs advisory
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const AUTOPSY = require(path.join(ROOT, 'AUTOPSY', 'autopsy_core.js'));
const RIGOR   = require(path.join(ROOT, 'RIGOR', 'rigor_core.js'));
const CASKET  = require(path.join(ROOT, 'CASKET', 'casket_core.js'));

const MATCH_FREQS = Array.from({ length: 10 }, (_, b) => 50 * Math.pow(14000 / 50, b / 9));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const offDyn = () => ({ on: false, range: 0, thresh: -30, att: 10, rel: 150 });

// ---- per-core idle / "do nothing" states (spike-verified) -------------------
function autopsyIdle() { return AUTOPSY.sanitizeState(AUTOPSY.defaultState()); }              // no bands = passthrough
function rigorIdle()   { const s = RIGOR.defaultState(); s.bands = 1; s.ratio = 1; s.look = 0; return RIGOR.sanitizeState(s); } // unity (§4)
function casketIdle()  { const s = CASKET.defaultState(); s.lid = 0; s.knee = 0; s.dc = false; s.drive = 0; return CASKET.sanitizeState(s); }

// ---- AUTOPSY (EQ) ------------------------------------------------------------
function translateAutopsy(ms) {
  const nearest = (target) => {
    let bi = 0, bd = 1e9;
    MATCH_FREQS.forEach((f, i) => { const d = Math.abs(Math.log(f) - Math.log(target)); if (d < bd) { bd = d; bi = i; } });
    return bi;
  };
  const strength = ms.matchStrength == null ? 1 : ms.matchStrength;
  const mg = ms.matchGains || [];
  const bell = MATCH_FREQS.map((_, b) => (mg[b] || 0) * strength);
  bell[nearest(400)]  += ms.eqLowMid  || 0;   // fold the two mid tone bells in
  bell[nearest(3000)] += ms.eqHighMid || 0;

  const bands = [
    { on: false, type: 'lowshelf',  freq: 100,  gain: ms.eqLow || 0,  q: 0.7, slope: 12, place: 'st', dyn: offDyn() },
    { on: false, type: 'highshelf', freq: 8000, gain: ms.eqHigh || 0, q: 0.7, slope: 12, place: 'st', dyn: offDyn() },
    ...MATCH_FREQS.map((f, b) => ({ on: false, type: 'bell', freq: f, gain: bell[b], q: 2.0, slope: 12, place: 'st', dyn: offDyn() })),
  ];
  bands.forEach((b) => { b.on = Math.abs(b.gain) > 0.01; });   // flat bands stay off -> passthrough

  // Dynamic EQ (dqAmount/dqThr*) -> AUTOPSY per-band dynamics on three representative bells.
  // A dynamic cut (negative range) tames resonances the way Masterbox's DynEq does. Only
  // engaged when the brain asks, so a preset without it is byte-identical to before.
  if (ms.dqAmount > 0) {
    const range = -Math.max(0, Math.min(24, 6 * clamp01(ms.dqAmount)));   // dynamic cut, up to 6 dB
    const setDyn = (hz, thr) => { const bi = 2 + nearest(hz); bands[bi].on = true; bands[bi].dyn = { on: true, range, thresh: thr == null ? -32 : thr, att: 10, rel: 150 }; };
    setDyn(120, ms.dqThrLow); setDyn(1000, ms.dqThrMid); setDyn(6000, ms.dqThrHigh);
  }

  // M/S EQ (§9.2, resolved here): side "air" -> a side-placed high shelf; mid "body" -> a
  // mid-placed bell. AUTOPSY carries M/S per band, so they consume the least-active (off)
  // stereo slots — the trade the band budget forces, made explicit.
  const placeMS = (want, band) => { if (!want) return true; const slot = bands.findIndex((b) => !b.on); if (slot < 0) return false; bands[slot] = band; return true; };
  const airOk = placeMS(ms.sideAir, { on: true, type: 'highshelf', freq: 10000, gain: ms.sideAir, q: 0.7, slope: 12, place: 's', dyn: offDyn() });
  const bodyOk = placeMS(ms.midBody, { on: true, type: 'bell', freq: 250, gain: ms.midBody, q: 1.0, slope: 12, place: 'm', dyn: offDyn() });

  const raw = AUTOPSY.defaultState(); raw.bands = bands;
  const state = AUTOPSY.sanitizeState(raw);
  const clamped = [];
  bands.forEach((b, i) => { if (b.on && state.bands[i].gain !== b.gain) clamped.push({ core: 'autopsy', field: `band${i}.gain`, asked: b.gain, got: state.bands[i].gain }); });
  if (!airOk) clamped.push({ core: 'autopsy', field: 'sideAir', asked: ms.sideAir, got: 'dropped — no free band' });
  if (!bodyOk) clamped.push({ core: 'autopsy', field: 'midBody', asked: ms.midBody, got: 'dropped — no free band' });
  return { state, clamped };
}

// ---- RIGOR (compression) -----------------------------------------------------
function translateRigor(ms) {
  const a = clamp01(ms.compAmount || 0), p = clamp01(ms.punch == null ? 0.3 : ms.punch);
  const desired = {
    bands: 3, xover: [200, 3000],
    thresh: -12 - a * 24,
    ratio: 1.5 + a * 3,
    attack: 1 + p * 29,
    release: 150, knee: 6, look: 0, mix: 100, makeup: 0, autoMakeup: false, place: 'lr',
    band: [{ threshOff: 0, gain: 0, mute: false, solo: false },
           { threshOff: 0, gain: 0, mute: false, solo: false },
           { threshOff: 0, gain: 0, mute: false, solo: false }],
  };
  // Optional, only when the brain/analysis asks (so a plain preset stays byte-stable):
  if (Array.isArray(ms.xover)) desired.xover = ms.xover;                          // adaptive crossovers
  if (ms.scHp != null) { desired.scOn = true; desired.scHp = ms.scHp; }           // sidechain HP (avoid bass pumping)
  if (ms.scLp != null) { desired.scOn = true; desired.scLp = ms.scLp; }
  if (ms.detect) desired.detect = ms.detect;                                      // peak vs rms detector
  if (Array.isArray(ms.bandThreshOff)) desired.band = desired.band.map((b, i) => Object.assign({}, b, { threshOff: ms.bandThreshOff[i] || 0 }));
  const state = RIGOR.sanitizeState(Object.assign(RIGOR.defaultState(), desired));
  const clamped = [];
  for (const k of ['thresh', 'ratio', 'attack', 'release', 'knee']) if (state[k] !== desired[k]) clamped.push({ core: 'rigor', field: k, asked: desired[k], got: state[k] });
  return { state, clamped };
}

// ---- CASKET (limiter) --------------------------------------------------------
//   width -> CASKET's M/S side trim (msSide), engaged only when width departs neutral so
//   width==1 keeps the null. This is the one width control the seam decides; the M/S *EQ*
//   moves (sideAir, midBody, bassMono) are left to §9.2 "where should M/S live" — genuinely
//   under-determined, and not mine to settle from outside.
function translateCasket(ms) {
  const desired = { lid: ms.ceilingDbTp, drive: Math.max(0, ms.makeupDb || 0), targetLufs: ms.targetLufs };
  if (ms.width != null && Math.abs(ms.width - 1) > 1e-4) {
    desired.ms = true;
    desired.msSide = Math.max(-12, Math.min(12, 20 * Math.log10(Math.max(ms.width, 1e-3))));
  }
  const state = CASKET.sanitizeState(Object.assign(CASKET.defaultState(), desired));
  const clamped = [];
  for (const k of ['lid', 'drive', 'targetLufs', 'msSide']) if (desired[k] !== undefined && state[k] !== desired[k]) clamped.push({ core: 'casket', field: k, asked: desired[k], got: state[k] });
  return { state, clamped };
}

// ---- delivery presets (mirror Masterbox's DELIVERY table exactly) ------------
const DELIVERY = {
  spotify: { lufs: -14, ceil: -1 }, apple: { lufs: -16, ceil: -1 }, youtube: { lufs: -14, ceil: -1 },
  tidal: { lufs: -14, ceil: -1 }, amazon: { lufs: -14, ceil: -2 }, soundcloud: { lufs: -14, ceil: -1 },
  club: { lufs: -8, ceil: -0.3 }, cd: { lufs: -9, ceil: -0.3 }, broadcast: { lufs: -23, ceil: -1 }, podcast: { lufs: -16, ceil: -1 },
};
function fromDelivery(key, ms) {
  const d = DELIVERY[key];
  if (!d) throw new Error('unknown delivery target: ' + key);
  return Object.assign({}, ms || {}, { targetLufs: d.lufs, ceilingDbTp: d.ceil });
}

// ---- the envelope (§2) -------------------------------------------------------
function toChainPreset(ms) {
  const a = translateAutopsy(ms), r = translateRigor(ms), c = translateCasket(ms);
  return {
    format: 'underworld.chain',
    version: 1,
    generatedBy: 'masterbox/prototype',
    fs: ms.fs || 48000,
    target: { lufs: ms.targetLufs, ceilingDbTp: ms.ceilingDbTp },
    autopsy: a.state,
    rigor: r.state,
    casket: c.state,
    report: { clamped: [...a.clamped, ...r.clamped, ...c.clamped] },
  };
}

module.exports = {
  toChainPreset, translateAutopsy, translateRigor, translateCasket,
  autopsyIdle, rigorIdle, casketIdle, MATCH_FREQS,
  DELIVERY, fromDelivery, cores: { AUTOPSY, RIGOR, CASKET },
};
