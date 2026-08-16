// THE UNDERWORLD — translator (step 2).
// Masterbox MasteringSettings -> an `underworld.chain` preset (UNDERWORLD_INTERCHANGE §2).
// LAW 0: emits the trilogy cores' own sanitizeState output; drives nothing here.
//
// Scope: CASKET is mapped from the brain vocabulary. AUTOPSY and RIGOR are emitted in
// their IDLE (passthrough) states for now — translating the EQ and compressor vocabularies
// is the next increment (§3.1: "the mapping is the work"). The envelope is already valid
// and renders as CASKET-only processing.
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const AUTOPSY = require(path.join(ROOT, 'AUTOPSY', 'autopsy_core.js'));
const RIGOR   = require(path.join(ROOT, 'RIGOR', 'rigor_core.js'));
const CASKET  = require(path.join(ROOT, 'CASKET', 'casket_core.js'));

// ---- per-core idle / "do nothing" states (spike-verified) -------------------
function autopsyIdle() { return AUTOPSY.sanitizeState(AUTOPSY.defaultState()); }              // no bands = passthrough
function rigorIdle()   { const s = RIGOR.defaultState(); s.ratio = 1; s.look = 0; return RIGOR.sanitizeState(s); } // unity (§4)
function casketIdle()  { const s = CASKET.defaultState(); s.lid = 0; s.knee = 0; s.dc = false; s.drive = 0; return CASKET.sanitizeState(s); }

// ---- CASKET translation ------------------------------------------------------
// Vocabulary map (§3.1 — decisions with reasons, not defaults):
//   ceilingDbTp -> lid      the dBTP ceiling; CASKET's whole job. Direct.
//   makeupDb    -> drive    §5.2 forbids gain AFTER CASKET, so a loudness push becomes
//                           drive INTO the limiter (only positive; a cut is not a push).
//   targetLufs  -> targetLufs   advisory; the brain's calibration loop refines drive by render.
// Everything else stays at CASKET's own defaults until the brain has an opinion about it.
function translateCasket(ms) {
  const desired = {
    lid: ms.ceilingDbTp,
    drive: Math.max(0, ms.makeupDb || 0),
    targetLufs: ms.targetLufs,
  };
  const state = CASKET.sanitizeState(Object.assign(CASKET.defaultState(), desired));
  const clamped = [];
  for (const k of Object.keys(desired)) {
    if (desired[k] !== undefined && state[k] !== desired[k])
      clamped.push({ core: 'casket', field: k, asked: desired[k], got: state[k] });
  }
  return { state, clamped };
}

// ---- the envelope (§2) -------------------------------------------------------
function toChainPreset(ms) {
  const c = translateCasket(ms);
  return {
    format: 'underworld.chain',
    version: 1,
    generatedBy: 'masterbox/prototype',
    fs: ms.fs || 48000,
    target: { lufs: ms.targetLufs, ceilingDbTp: ms.ceilingDbTp },
    autopsy: autopsyIdle(),   // TODO: translate from ms.eqLow/eqLowMid/eqHighMid/eqHigh
    rigor:   rigorIdle(),     // TODO: translate from ms.compAmount/punch/width
    casket:  c.state,
    report:  { clamped: c.clamped },
  };
}

module.exports = { toChainPreset, translateCasket, autopsyIdle, rigorIdle, casketIdle, cores: { AUTOPSY, RIGOR, CASKET } };
