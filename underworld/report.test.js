// The consolidated report: gain reduction, stereo health, input health, before/after
// spectrum, loudness history — each measured, each with a control.
const T = require('./translate.js');
const { renderChain } = require('./chain.js');
const { calibrate } = require('./calibrate.js');
const { fullReport } = require('./report.js');
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));
const mk = (fn, n) => { const L = new Float64Array(n), R = new Float64Array(n); for (let i = 0; i < n; i++) { const [l, r] = fn(i / FS); L[i] = l; R[i] = r; } return { L, R }; };
const norm = (s, peak) => { let pk = 0; for (let i = 0; i < s.L.length; i++) pk = Math.max(pk, Math.abs(s.L[i]), Math.abs(s.R[i])); const g = peak / pk; for (let i = 0; i < s.L.length; i++) { s.L[i] *= g; s.R[i] *= g; } return s; };

console.log('Report — gain reduction, stereo, input health, spectrum, history');
{
  const s = norm(mk((t) => { const m = 0.5 * Math.sin(2 * Math.PI * 90 * t) + 0.3 * Math.sin(2 * Math.PI * 900 * t); return [m, m * 0.98 + 0.02 * Math.sin(2 * Math.PI * 5000 * t)]; }, FS * 3), 0.9);
  const { preset, out } = calibrate({ compAmount: 0.7, ceilingDbTp: -1, targetLufs: -12 }, s.L, s.R, FS);
  const rep = fullReport(s.L, s.R, out.L, out.R, preset, out, FS);
  check('gain reduction is reported for both stages', rep.gr.rigor > 0 && typeof rep.gr.casket === 'number', `RIGOR ${rep.gr.rigor} · CASKET ${rep.gr.casket} dB`);
  check('correlation is measured in and out', rep.stereo.correlationIn > 0.5 && typeof rep.stereo.correlationOut === 'number', `${rep.stereo.correlationIn} -> ${rep.stereo.correlationOut}`);
  check('before/after spectrum, 10 bands each', rep.spectrum.in.length === 10 && rep.spectrum.out.length === 10 && rep.spectrum.in[0].hz > 0);
  check('loudness history is a time series', rep.loudnessHistory.length >= 3 && typeof rep.loudnessHistory[0].lufs === 'number', `${rep.loudnessHistory.length} points`);
}

console.log('Stereo + input health — controls');
{
  // anti-phase input loses level when folded to mono
  const anti = norm(mk((t) => { const v = 0.5 * Math.sin(2 * Math.PI * 400 * t); return [v, -v]; }, FS), 0.5);
  const monoS = norm(mk((t) => { const v = 0.5 * Math.sin(2 * Math.PI * 400 * t); return [v, v]; }, FS), 0.5);
  const rAnti = fullReport(anti.L, anti.R, anti.L, anti.R, { target: {}, report: {} }, { latency: 0 }, FS);
  const rMono = fullReport(monoS.L, monoS.R, monoS.L, monoS.R, { target: {}, report: {} }, { latency: 0 }, FS);
  check('anti-phase flags a big mono-fold loss', rAnti.stereo.monoCompatInDb < -20, `${rAnti.stereo.monoCompatInDb} dB`);
  check('mono material folds cleanly (control)', Math.abs(rMono.stereo.monoCompatInDb) < 0.5, `${rMono.stereo.monoCompatInDb} dB`);

  // clipped input is detected
  const clip = mk((t) => { const v = 1.4 * Math.sin(2 * Math.PI * 200 * t); return [Math.max(-1, Math.min(1, v)), Math.max(-1, Math.min(1, v))]; }, FS);
  const rClip = fullReport(clip.L, clip.R, clip.L, clip.R, { target: {}, report: {} }, { latency: 0 }, FS);
  check('clipped input is flagged', rClip.input.clipping, `${rClip.input.clippedSamples} clipped, peak ${rClip.input.peakDb}`);
  check('clean input is not flagged (control)', !fullReport(monoS.L, monoS.R, monoS.L, monoS.R, { target: {}, report: {} }, { latency: 0 }, FS).input.clipping);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
