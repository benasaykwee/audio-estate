// Repro for the UNDERWORLD_INTERCHANGE §10 finding: a bit-exact CASKET null needs
// lid-above-signal AND knee:0 AND dc:false — not lid-above-signal alone.
// The soft knee perturbs the signal INDEPENDENT of headroom (lid=6 and lid=12 identical).
const path = require('path');
const CASKET = require(path.join(path.resolve(__dirname, '..', '..'), 'CASKET', 'casket_core.js'));
const FS = 48000, N = FS;
const L = new Float64Array(N), R = new Float64Array(N);
for (let i = 0; i < N; i++) { const t = i/FS;
  L[i] = 0.6*Math.sin(2*Math.PI*110*t) + 0.4*Math.sin(2*Math.PI*1320*t) + 0.3*Math.sin(2*Math.PI*60*t);
  R[i] = 0.6*Math.sin(2*Math.PI*110*t+0.15) + 0.4*Math.sin(2*Math.PI*1760*t) + 0.3*Math.sin(2*Math.PI*60*t); }
let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
const g = 0.92/pk; for (let i = 0; i < N; i++) { L[i] *= g; R[i] *= g; }
const tp = 20*Math.log10(Math.max(CASKET.truePeakOf(L,16), CASKET.truePeakOf(R,16)));
console.log('signal true peak =', tp.toFixed(3), 'dBTP (well under any lid tested)');
const md = (a,b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]-b[i])); return m; };
const t = (over) => { const s = CASKET.defaultState(); s.dc = false; Object.assign(s, over); const r = CASKET.renderOffline(s, L, R, FS); return md(r.L, L); };
console.log('lid=6  knee=3 (default velvet):', t({lid:6}).toExponential(3), '  <- NOT null');
console.log('lid=6  knee=0               :', t({lid:6,knee:0}).toExponential(3), '  <- null');
console.log('lid=12 knee=3               :', t({lid:12}).toExponential(3), '  <- same as lid=6: knee ignores headroom');
console.log('lid=24 knee=0 (dc default on):', (function(){const s=CASKET.defaultState();s.lid=24;s.knee=0;const r=CASKET.renderOffline(s,L,R,FS);return md(r.L,L);})().toExponential(3), '  <- dc:true breaks it');
process.exit(0);
