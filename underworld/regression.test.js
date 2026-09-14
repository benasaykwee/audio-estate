// Three guards in the trilogy's own idiom:
//   (11) golden render — the chain hits its target and holds its ceiling across program types
//   (12) stable mapping baselines — a fixed settings object -> the same DECISIONS (§9.4).
//        Rebuilt 2026-08-22: it used to hash the cores' whole sanitized state, which made
//        it a cross-project canary and left it stuck red. See the long note at §12.
//   (17) null-control matrix — each core's idle nulls AND each working config does not
const T = require('./translate.js');
const { renderChain } = require('./chain.js');
const { calibrate } = require('./calibrate.js');
const { AUTOPSY, RIGOR, CASKET } = T.cores;
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const fnv = (s) => { let h = 0x811c9dc5 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('0000000' + (h >>> 0).toString(16)).slice(-8); };
const dbtp = (a, b) => 20 * Math.log10(Math.max(CASKET.truePeakOf(a, 16), CASKET.truePeakOf(b, 16)));

// ---- signal generators (deterministic) --------------------------------------
function norm(L, R, peak) { let pk = 0; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); const g = peak / pk; for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; } }
function signal(kind, n, peak) {
  const L = new Float64Array(n), R = new Float64Array(n); let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  for (let i = 0; i < n; i++) {
    const t = i / FS;
    if (kind === 'tone') { L[i] = Math.sin(2 * Math.PI * 440 * t); R[i] = Math.sin(2 * Math.PI * 440 * t + 0.1); }
    else if (kind === 'noise') { L[i] = rnd(); R[i] = rnd(); }
    else if (kind === 'dense') { L[i] = Math.sin(2 * Math.PI * 70 * t) + 0.7 * Math.sin(2 * Math.PI * 520 * t) + 0.5 * Math.sin(2 * Math.PI * 2600 * t) + 0.3 * Math.sin(2 * Math.PI * 9000 * t); R[i] = Math.sin(2 * Math.PI * 70 * t + 0.2) + 0.7 * Math.sin(2 * Math.PI * 610 * t) + 0.5 * Math.sin(2 * Math.PI * 3100 * t); }
    else if (kind === 'mono') { L[i] = Math.sin(2 * Math.PI * 300 * t) + 0.5 * Math.sin(2 * Math.PI * 1500 * t); R[i] = L[i]; }
  }
  norm(L, R, peak == null ? 0.9 : peak);
  return { L, R };
}

// ---- (11) golden render across program material -----------------------------
console.log('(11) Golden render — hits -14 LUFS and holds the ceiling on every program type');
for (const kind of ['tone', 'noise', 'dense', 'mono']) {
  const s = signal(kind, FS);
  const { out } = calibrate({ compAmount: 0.35, ceilingDbTp: -1, makeupDb: 0, targetLufs: -14 }, s.L, s.R, FS, { passes: 6 });
  check(`${kind}: reaches -14 LUFS`, Math.abs(out.meters.integrated - (-14)) < 0.5, `${out.meters.integrated.toFixed(2)}`);
  // The ceiling CASKET GUARANTEES is what its own limiter/meter enforce; an independent
  // meter (truePeakOf) can read ~0.15 dB higher on noise — that divergence is task 18 / §9.3.
  check(`${kind}: holds -1 dBTP (CASKET meter)`, 20 * Math.log10(out.meters.truePeak) <= -1 + 0.05, `${(20 * Math.log10(out.meters.truePeak)).toFixed(3)}`);
}

// ---- (12) stable MAPPING baselines ------------------------------------------
//
// REBUILT 2026-08-22, and the reason matters more than the code.
//
// This check used to hash the whole preset object, which embeds `a.state`,
// `r.state` and `c.state` — the FULLY SANITIZED states of AUTOPSY, RIGOR and
// CASKET. That made it a cross-project canary wearing an UNDERWORLD label: any
// field added to any core moved the hash, whether or not UNDERWORLD's mapping
// had changed at all.
//
// It duly went red and stayed red. It was UNDERWORLD's only failing check
// (225 of 228 green), and because the message said "re-bless if the mapping
// changed on purpose" while the mapping had NOT changed, nobody could act on
// it. It sat undiagnosed from its first run on 21 Aug.
//
// HOW THAT WAS ESTABLISHED, rather than argued: translate.js was pulled out of
// git exactly as it stood at d285fe7, the commit that blessed the old numbers,
// pointed at today's cores, and run. It produced TODAY'S hashes, not the
// blessed ones. Same file, different answer, so the file was never the cause.
//
// WHAT IT HASHES NOW: the DELTA between the state UNDERWORLD produces and that
// core's own sanitized default. That is precisely the set of decisions
// UNDERWORLD made and nothing else. Case A's RIGOR delta, for instance, reads
// { attack:15.5, bands:3, ratio:2.7, release:150, thresh:-21.6, xover:[,3000] },
// which is 86 characters of actual mapping in place of 670 characters of state.
//
// The property this buys, stated plainly: a core may GROW without turning
// UNDERWORLD red, because the new field lands identically in the produced state
// and in the default, so the delta drops it. A core changing a default that
// UNDERWORLD overrides, or UNDERWORLD changing its own mapping, still moves the
// hash — which is the whole point. There is a control below that proves the
// growth immunity rather than asserting it.
//
// The house rule in AUDIO_INTERCHANGE.md — a drifted hash is evidence of a
// regression, never a reason to re-bless — is exactly right for CASKET's Lead
// arrangement, whose inputs it owns. It could not hold for a gate whose input
// was three sibling projects. Narrowing the gate is what makes the rule apply
// here honestly.
console.log('(12) Stable mapping — a fixed settings object yields the same DECISIONS');
{
  // Deep delta against a reference. Returns undefined when everything matches,
  // so an unchanged subtree disappears entirely. Keys are sorted, which also
  // removes insertion order as a source of spurious drift.
  const delta = (cur, def) => {
    if (Array.isArray(cur) || Array.isArray(def)) {
      if (!Array.isArray(cur) || !Array.isArray(def)) return cur === undefined ? '<absent>' : cur;
      const n = Math.max(cur.length, def.length); const out = []; let any = false;
      for (let i = 0; i < n; i++) { const d = delta(cur[i], def[i]); if (d === undefined) out.push(null); else { out.push(d); any = true; } }
      return any ? out : undefined;
    }
    if ((cur && typeof cur === 'object') || (def && typeof def === 'object')) {
      if (!cur || typeof cur !== 'object') return cur === undefined ? '<absent>' : cur;
      if (!def || typeof def !== 'object') return cur;
      const keys = Array.from(new Set([...Object.keys(cur), ...Object.keys(def)])).sort();
      const out = {}; let any = false;
      for (const k of keys) { const d = delta(cur[k], def[k]); if (d !== undefined) { out[k] = d; any = true; } }
      return any ? out : undefined;
    }
    if (cur === undefined && def !== undefined) return '<absent>';
    return cur === def ? undefined : cur;
  };
  const sane = (C) => (C.sanitizeState ? C.sanitizeState(C.defaultState()) : C.defaultState());
  const DEFAULTS = { autopsy: () => sane(AUTOPSY), rigor: () => sane(RIGOR), casket: () => sane(CASKET) };
  const decisions = (ms) => {
    const p = T.toChainPreset(ms);
    return {
      format: p.format, version: p.version, fs: p.fs, target: p.target,
      autopsy: delta(p.autopsy, DEFAULTS.autopsy()) || {},
      rigor: delta(p.rigor, DEFAULTS.rigor()) || {},
      casket: delta(p.casket, DEFAULTS.casket()) || {},
      report: p.report,
    };
  };

  const cases = {
    A: { eqLow: 2, eqHigh: -1, eqLowMid: 1, compAmount: 0.4, punch: 0.5, width: 1.2, ceilingDbTp: -1, makeupDb: 0, targetLufs: -14 },
    B: T.fromDelivery('club', { compAmount: 0.6, eqHigh: 2 }),
    C: { matchGains: [3, 2, 0, -1, -2, 0, 1, 2, 3, 4], matchStrength: 0.8, compAmount: 0.2, ceilingDbTp: -0.3, targetLufs: -9 },
  };
  // Blessed 2026-09-13, and the previous blessing is worth recording because it
  // is the reason this gate sat red for three weeks.
  //
  // The 2026-08-22 rebuild was RIGHT about the mechanism and wrong about the
  // numbers. It recorded A 67ed3ebd / B 6971fb8b / C 2209a6a3, and those hashes
  // correspond to no state this code has ever been in. Checked, rather than
  // assumed: `git archive` of a8119ef (the commit they claim to be blessed
  // against) and of 9a9e74a (the commit that WROTE them) both compute
  // A 020b304e / B 5f574a34 / C dce8e5ca, which is exactly what runs today.
  // They are not the pre-rebuild numbers either, which were 03bdc20a / 1f6e4cc8 /
  // d5a3aec3 and which this file still reproduces if you hash the whole preset
  // instead of the delta. Six plausible shapes of the decisions object were tried
  // and none of them yields 67ed3ebd. So the constants were written down without
  // ever being measured, and THE GATE HAS NEVER ONCE BEEN GREEN.
  //
  // That is the estate's own rule failing in its own words: a restated number is
  // not a measured one. The mechanism was never the problem, and the four
  // controls below have passed throughout, which is what makes re-blessing the
  // right move here rather than a cover-up.
  //
  // What this re-bless does NOT mean: it is not evidence the mapping moved. The
  // decisions object is byte-identical between a8119ef and today, and
  // translate.js has no commits at all in that range.
  const BASELINE = { A: '020b304e', B: '5f574a34', C: 'dce8e5ca' };
  for (const k of Object.keys(cases)) {
    const h1 = fnv(JSON.stringify(decisions(cases[k]))), h2 = fnv(JSON.stringify(decisions(cases[k])));
    check(`case ${k} matches baseline ${BASELINE[k]}`, h1 === BASELINE[k], h1 === BASELINE[k] ? '' : `got ${h1} — UNDERWORLD's OWN mapping moved, so read the diff before re-blessing`);
    check(`case ${k} is deterministic (control)`, h1 === h2);
  }

  // CONTROL 1 — the gate bites. Nudge one input and the hash must move,
  // otherwise the three checks above are three ways of proving nothing.
  const nudged = fnv(JSON.stringify(decisions(Object.assign({}, cases.A, { compAmount: 0.4001 }))));
  check('a changed mapping input moves the hash (control)', nudged !== BASELINE.A, `${nudged}`);

  // CONTROL 2 — the property this rebuild exists for. A core growing a field it
  // sets identically in its default and its output must NOT move the hash. This
  // is the exact failure the old gate had, tested at the level it happens.
  const grownCur = { a: 1, b: { c: 2 }, NEW_FIELD: 'added by a sibling project' };
  const grownDef = { a: 1, b: { c: 9 }, NEW_FIELD: 'added by a sibling project' };
  const grown = JSON.stringify(delta(grownCur, grownDef));
  check('a core growing a field does not move the hash (control)', grown === '{"b":{"c":2}}', `${grown}`);

  // Diagnostic, not a check: a sibling changing its own defaults is legitimate and
  // must not fail UNDERWORLD. But it now compares against RECORDED values rather
  // than just printing, because printing a number nobody can compare to is how the
  // last diagnosis cost three weeks. Measured 2026-09-13, same run as the
  // baselines above. If one of these says MOVED, that is the first thing to read.
  const FINGERPRINTS = { autopsy: 'c1be1afe', rigor: '9972bfd9', casket: '11ae4624' };
  const fp = Object.entries(DEFAULTS).map(([n, f]) => {
    const h = fnv(JSON.stringify(f()));
    return `${n} ${h}${h === FINGERPRINTS[n] ? '' : ` MOVED (was ${FINGERPRINTS[n]})`}`;
  }).join('   ');
  console.log(`  [note ] core default fingerprints:  ${fp}`);
}

// ---- (17) null-control matrix ------------------------------------------------
console.log('(17) Null matrix — each core idle nulls, each working config does not');
{
  const s = signal('dense', 16384, 0.4);   // below any lid so CASKET idle can null
  const L = s.L, R = s.R;
  const runA = (st) => { const e = AUTOPSY.createEngine(FS); e.setState(st); const o1 = new Float64Array(L.length), o2 = new Float64Array(R.length); e.process(L, R, o1, o2); return { L: o1, R: o2 }; };
  const runR = (st) => { const e = RIGOR.createMulti(FS); e.setState(st); const o1 = new Float64Array(L.length), o2 = new Float64Array(R.length); e.process(L, R, o1, o2); return { L: o1, R: o2 }; };
  const runC = (st) => CASKET.renderOffline(st, L, R, FS);
  const rows = [
    ['AUTOPSY', runA, T.autopsyIdle(), T.translateAutopsy({ eqLow: 6 }).state],
    ['RIGOR', runR, T.rigorIdle(), T.translateRigor({ compAmount: 1 }).state],
    ['CASKET', runC, T.casketIdle(), T.translateCasket({ ceilingDbTp: -12, makeupDb: 12 }).state],
  ];
  for (const [name, run, idle, work] of rows) {
    const ni = Math.max(maxDiff(run(idle).L, L), maxDiff(run(idle).R, R));
    const nw = maxDiff(run(work).L, L);
    check(`${name} idle nulls (<= 1 ULP)`, ni <= Number.EPSILON, `${ni.toExponential(1)}`);
    check(`${name} working is not a null (control)`, nw > 0.001, `${nw.toExponential(2)}`);
  }
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
