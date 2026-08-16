// THE UNDERWORLD — golden-master corpus (task 14).
// Representative synthetic programs with the settings they'd be mastered with. A real-mix
// corpus drops in the same shape once Ben supplies files; the framework and the assertions
// (hits target, holds ceiling, byte-stable preset) are what matter.
const FS = 48000;

function norm(L, R, peak) { let pk = 0; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); const g = peak / pk; for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; } }

function make(kind, seconds) {
  const n = Math.round(FS * (seconds || 4)), L = new Float64Array(n), R = new Float64Array(n);
  let seed = 4242; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  for (let i = 0; i < n; i++) {
    const t = i / FS;
    if (kind === 'kick-bass') { L[i] = Math.sin(2 * Math.PI * 55 * t) + 0.6 * Math.sin(2 * Math.PI * 110 * t) + 0.2 * (Math.floor(t * 2) % 2); R[i] = L[i] * 0.99; }
    else if (kind === 'vocal-air') { L[i] = 0.5 * Math.sin(2 * Math.PI * 350 * t) + 0.3 * Math.sin(2 * Math.PI * 2500 * t) + 0.2 * Math.sin(2 * Math.PI * 9000 * t); R[i] = 0.5 * Math.sin(2 * Math.PI * 350 * t + 0.1) + 0.25 * Math.sin(2 * Math.PI * 3000 * t); }
    else if (kind === 'dense-mix') { L[i] = Math.sin(2 * Math.PI * 70 * t) + 0.7 * Math.sin(2 * Math.PI * 500 * t) + 0.5 * Math.sin(2 * Math.PI * 2500 * t) + 0.4 * rnd(); R[i] = Math.sin(2 * Math.PI * 70 * t + 0.2) + 0.6 * Math.sin(2 * Math.PI * 650 * t) + 0.4 * rnd(); }
    else if (kind === 'sparse-acoustic') { L[i] = 0.4 * Math.sin(2 * Math.PI * 196 * t) * Math.exp(-2 * (t % 0.5)); R[i] = 0.4 * Math.sin(2 * Math.PI * 294 * t) * Math.exp(-2 * (t % 0.5)); }
  }
  norm(L, R, 0.9);
  return { L, R, sampleRate: FS };
}

// each entry: name, program, and the settings it is mastered with
const CORPUS = [
  { name: 'kick-bass',       ms: { eqLow: -1, compAmount: 0.4, ceilingDbTp: -1, targetLufs: -14 } },
  { name: 'vocal-air',       ms: { eqHigh: 1, compAmount: 0.3, ceilingDbTp: -1, targetLufs: -14 } },
  { name: 'dense-mix',       ms: { compAmount: 0.35, ceilingDbTp: -1, targetLufs: -12 } },
  { name: 'sparse-acoustic', ms: { compAmount: 0.15, width: 1.1, ceilingDbTp: -1, targetLufs: -16 } },
].map((e) => Object.assign(e, { audio: make(e.name) }));

module.exports = { CORPUS, make };
