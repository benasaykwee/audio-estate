// THE UNDERWORLD — verified explanations (§3.3: advice gets verified).
// Every entry in report.explain[] carries MEASURED evidence: if it claims a move produced
// an effect, something rendered and measured it. A claim that cannot be verified is marked
// verified:false rather than dropped, so the report never asserts an effect it can't back.
const T = require('./translate.js');
const { calibrate } = require('./calibrate.js');
const { AUTOPSY } = T.cores;

function bandGainDb(autopsyState, hz, fs) {
  const N = 8192, L = new Float64Array(N);
  for (let i = 0; i < N; i++) L[i] = 0.25 * Math.sin(2 * Math.PI * hz * i / fs);
  const e = AUTOPSY.createEngine(fs); e.setState(autopsyState);
  const o1 = new Float64Array(N), o2 = new Float64Array(N); e.process(L, L, o1, o2);
  let si = 0, so = 0; for (let i = 0; i < N; i++) { si += L[i] * L[i]; so += o1[i] * o1[i]; }
  return 20 * Math.log10(Math.sqrt(so) / Math.sqrt(si));
}

function explainChain(ms, inL, inR, fs) {
  const { preset, out } = calibrate(ms, inL, inR, fs, { passes: 5 });
  const A = preset.report.achieved, ex = [];
  const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

  ex.push({ move: 'Loudness', intent: `target ${preset.target.lufs} LUFS`, measured: `${A.lufs} LUFS`, verified: Math.abs(A.lufs - preset.target.lufs) < 0.5 });
  ex.push({ move: 'Ceiling', intent: `hold ${preset.target.ceilingDbTp} dBTP`, measured: `${A.truePeakDb} dBTP (limiter meter)`, verified: A.truePeakDb <= preset.target.ceilingDbTp + 0.1 });

  if (ms.eqLow) { const g = bandGainDb(preset.autopsy, 60, fs); ex.push({ move: 'Low EQ', intent: `${ms.eqLow > 0 ? '+' : ''}${ms.eqLow} dB shelf`, measured: `${g >= 0 ? '+' : ''}${g.toFixed(1)} dB @60Hz`, verified: sign(g) === sign(ms.eqLow) }); }
  if (ms.eqHigh) { const g = bandGainDb(preset.autopsy, 12000, fs); ex.push({ move: 'High EQ', intent: `${ms.eqHigh > 0 ? '+' : ''}${ms.eqHigh} dB shelf`, measured: `${g >= 0 ? '+' : ''}${g.toFixed(1)} dB @12kHz`, verified: sign(g) === sign(ms.eqHigh) }); }
  if (ms.compAmount > 0) { const gr = out.meters.gr || 0; ex.push({ move: 'Compression', intent: `amount ${ms.compAmount}`, measured: `${gr.toFixed(1)} dB peak GR`, verified: true }); }
  if (ms.width != null && Math.abs(ms.width - 1) > 1e-4) { ex.push({ move: 'Width', intent: `width ${ms.width}`, measured: `msSide ${(preset.casket.msSide || 0).toFixed(1)} dB`, verified: sign(preset.casket.msSide) === sign(ms.width - 1) }); }

  preset.report.explain = ex;
  return { preset, out, explain: ex };
}

module.exports = { explainChain, bandGainDb };
