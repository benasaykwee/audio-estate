// THE UNDERWORLD — latency / PDC self-test (task 17).
// The suite treats a lying latency figure as a serious defect (AUDIO_INTERCHANGE §4). This
// proves the seam's figure is honest two ways: an impulse through the RAW cores exits at
// exactly the reported latency, and after the orchestrator's compensation it lands back at
// the front. Uses a near-transparent preset so the impulse stays an impulse.
const T = require('./translate.js');
const { renderChain, chainLatency } = require('./chain.js');
const { CASKET } = T.cores;

function peakIndex(buf) { let pk = 0, at = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > pk) { pk = v; at = i; } } return at; }

function latencySelfTest(fs) {
  const N = 16384;
  // near-transparent preset: no EQ, gentle settings, quiet impulse well under the lid
  const preset = T.toChainPreset({ ceilingDbTp: 0, targetLufs: -14 });
  const reported = chainLatency(preset, fs);

  // raw CASKET: impulse should exit at exactly its latencySamples
  const iL = new Float64Array(N), iR = new Float64Array(N); iL[100] = iR[100] = 0.25;
  const e = CASKET.createEngine(fs); e.setState(preset.casket);
  const oL = new Float64Array(N), oR = new Float64Array(N); e.process(iL, iR, oL, oR);
  const casketLat = CASKET.latencySamples(preset.casket, fs);
  const rawExit = peakIndex(oL) - 100;

  // compensated chain: renderChain aligns the impulse back to its input position
  const cL = new Float64Array(N), cR = new Float64Array(N); cL[100] = cR[100] = 0.25;
  const out = renderChain(preset, cL, cR, fs);
  const compExit = peakIndex(out.L);

  return { reported, casketLat, rawExitOffset: rawExit, rawHonest: rawExit === casketLat, compExitIndex: compExit, aligned: Math.abs(compExit - 100) <= 1 };
}

module.exports = { latencySelfTest };
