// Reference matching (4), LRA targeting (9), M/S EQ placement (8).
const T = require('./translate.js');
const { matchReference, withLraTarget } = require('./auto.js');
const { renderChain } = require('./chain.js');
const { AUTOPSY, CASKET } = T.cores;
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));
const rndGen = (seed) => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };

// ---- (4) reference matching -------------------------------------------------
console.log('(4) Reference — matches the mix tone toward a brighter reference');
{
  const N = FS, dullL = new Float64Array(N), dullR = new Float64Array(N), briL = new Float64Array(N), briR = new Float64Array(N);
  const rn = rndGen(1); let lp = 0;
  for (let i = 0; i < N; i++) { const w = rn(); lp = lp * 0.85 + w * 0.15; dullL[i] = lp * 3; dullR[i] = lp * 3; briL[i] = w * 0.5; briR[i] = rn() * 0.5; }   // dull = lowpassed, bright = white
  const { ms } = matchReference(dullL, dullR, briL, briR, FS, { strength: 0.9 });
  const hi = ms.matchGains[9] + ms.matchGains[8], lo = ms.matchGains[0] + ms.matchGains[1];
  check('curve asks highs up relative to lows', hi > lo + 3, `hi ${hi.toFixed(1)} vs lo ${lo.toFixed(1)}`);
  // control: matching a signal to itself asks for ~nothing
  const { ms: self } = matchReference(dullL, dullR, dullL, dullR, FS, { strength: 0.9 });
  check('matching to itself is ~flat (control)', Math.max(...self.matchGains.map(Math.abs)) < 0.5, `max ${Math.max(...self.matchGains.map(Math.abs)).toFixed(2)}`);
}

// ---- (9) LRA targeting ------------------------------------------------------
console.log('(9) LRA — a dynamic mix gets more compression; a steady one does not');
{
  // LRA uses a 3 s short-term window, so the loud/quiet sections must be several seconds long.
  const N = FS * 24, dyn = { L: new Float64Array(N), R: new Float64Array(N) }, steady = { L: new Float64Array(N), R: new Float64Array(N) };
  for (let i = 0; i < N; i++) { const t = i / FS; const env = (Math.floor(t / 4) % 2) ? 0.8 : 0.09; const s = Math.sin(2 * Math.PI * 220 * t); dyn.L[i] = env * s; dyn.R[i] = env * s; steady.L[i] = 0.4 * s; steady.R[i] = 0.4 * s; }
  const d = withLraTarget({ compAmount: 0.2 }, dyn.L, dyn.R, FS, 6);
  const s = withLraTarget({ compAmount: 0.2 }, steady.L, steady.R, FS, 6);
  check('dynamic mix reads a wide LRA', d.measuredLra > s.measuredLra + 2, `dyn ${d.measuredLra} vs steady ${s.measuredLra}`);
  check('dynamic -> more compression', d.ms.compAmount > 0.2, `${d.ms.compAmount.toFixed(2)}`);
  check('steady -> compression unchanged (control)', Math.abs(s.ms.compAmount - 0.2) < 1e-9, `${s.ms.compAmount.toFixed(2)}`);
}

// ---- (8) M/S EQ placement ---------------------------------------------------
console.log('(8) M/S EQ — sideAir / midBody land as side/mid bands');
{
  const air = T.translateAutopsy({ sideAir: 6 }).state;
  const sb = air.bands.find((b) => b.on && b.place === 's' && b.type === 'highshelf');
  check('sideAir -> a side-placed high shelf', !!sb && Math.abs(sb.gain - 6) < 0.01, sb ? `gain ${sb.gain} @${Math.round(sb.freq)}` : 'MISSING');
  const body = T.translateAutopsy({ midBody: 3 }).state;
  const mb = body.bands.find((b) => b.on && b.place === 'm' && b.type === 'bell');
  check('midBody -> a mid-placed bell', !!mb && Math.abs(mb.gain - 3) < 0.01, mb ? `gain ${mb.gain} @${Math.round(mb.freq)}` : 'MISSING');
  check('emitted state is a fixpoint', JSON.stringify(AUTOPSY.sanitizeState(air)) === JSON.stringify(air));

  // render effect: sideAir boosts side high-frequency energy
  const N = 16384, L = new Float64Array(N), R = new Float64Array(N);
  for (let i = 0; i < N; i++) { const t = i / FS; const mid = 0.3 * Math.sin(2 * Math.PI * 300 * t), side = 0.2 * Math.sin(2 * Math.PI * 12000 * t); L[i] = mid + side; R[i] = mid - side; }
  const sideRms = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = (a[i] - b[i]) * 0.5; s += d * d; } return Math.sqrt(s / a.length); };
  const e = AUTOPSY.createEngine(FS); e.setState(air); const oL = new Float64Array(N), oR = new Float64Array(N); e.process(L, R, oL, oR);
  check('sideAir boosts side HF energy', sideRms(oL, oR) / sideRms(L, R) > 1.3, `${(sideRms(oL, oR) / sideRms(L, R)).toFixed(2)}x`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
