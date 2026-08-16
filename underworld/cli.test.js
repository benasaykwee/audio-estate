// WAV round-trip + the whole CLI pipeline on a real temp file.
const fs = require('fs'), os = require('os'), path = require('path');
const { writeWav, readWav } = require('./wav.js');
const cli = require('./cli.js');
const { readPreset } = require('./preset-io.js');
const T = require('./translate.js');
const { CASKET } = T.cores;
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'underworld-'));
const inPath = path.join(dir, 'mix.wav'), outPath = path.join(dir, 'out.wav'), jsonPath = path.join(dir, 'out.json');

// synth ~ -3 dBFS program
const N = FS * 2, L = new Float64Array(N), R = new Float64Array(N);
for (let i = 0; i < N; i++) { const t = i / FS; L[i] = 0.5 * Math.sin(2 * Math.PI * 90 * t) + 0.3 * Math.sin(2 * Math.PI * 800 * t) + 0.2 * Math.sin(2 * Math.PI * 4000 * t); R[i] = 0.5 * Math.sin(2 * Math.PI * 90 * t + 0.2) + 0.3 * Math.sin(2 * Math.PI * 1000 * t); }
let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
const g = 0.7 / pk; for (let i = 0; i < N; i++) { L[i] *= g; R[i] *= g; }

console.log('WAV — 24-bit round-trip within quantization');
{
  writeWav(inPath, L, R, FS, 24);
  const rd = readWav(inPath);
  let md = 0; for (let i = 0; i < N; i++) md = Math.max(md, Math.abs(rd.L[i] - L[i]), Math.abs(rd.R[i] - R[i]));
  check('round-trip within 24-bit step', md < 2e-7, `maxdiff ${md.toExponential(2)}`);
  check('sample rate + length preserved', rd.sampleRate === FS && rd.L.length === N);
}

console.log('CLI — WAV in -> mastered WAV + preset + report');
{
  const { runPipeline } = cli;
  const rd = readWav(inPath);
  const { preset, out } = runPipeline(rd.L, rd.R, rd.sampleRate, { delivery: 'spotify', comp: 0.3 });
  writeWav(outPath, out.L, out.R, rd.sampleRate, 24);
  fs.writeFileSync(jsonPath, require('./preset-io.js').writePreset(preset));

  check('delivery spotify -> target -14 / -1', preset.target.lufs === -14 && preset.target.ceilingDbTp === -1);
  check('achieved LUFS hit target', Math.abs(preset.report.achieved.lufs - (-14)) < 0.5, `${preset.report.achieved.lufs}`);

  const mastered = readWav(outPath);
  const tp = 20 * Math.log10(Math.max(CASKET.truePeakOf(mastered.L, 16), CASKET.truePeakOf(mastered.R, 16)));
  check('mastered WAV holds -1 dBTP ceiling', tp <= -1 + 0.15, `${tp.toFixed(3)} dBTP`);           // +0.1 slack for 24-bit quantization
  const back = readPreset(fs.readFileSync(jsonPath, 'utf8'));
  check('written preset reloads with fixpoint slabs', JSON.stringify(CASKET.sanitizeState(back.casket)) === JSON.stringify(back.casket));
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
