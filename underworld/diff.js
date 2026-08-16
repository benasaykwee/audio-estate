// THE UNDERWORLD — preset diff (task 15). What changed between two chains, and where.
function num(x) { return typeof x === 'number' ? x : 0; }

function diffPresets(a, b) {
  const changes = [];
  const push = (field, from, to) => { if (num(from) !== num(to)) changes.push({ field, from: +num(from).toFixed(2), to: +num(to).toFixed(2) }); };

  push('target LUFS', a.target && a.target.lufs, b.target && b.target.lufs);
  push('ceiling dBTP', a.target && a.target.ceilingDbTp, b.target && b.target.ceilingDbTp);
  for (const k of ['lid', 'drive', 'msSide', 'knee']) push(`CASKET.${k}`, a.casket && a.casket[k], b.casket && b.casket[k]);
  for (const k of ['thresh', 'ratio', 'attack', 'release', 'bands']) push(`RIGOR.${k}`, a.rigor && a.rigor[k], b.rigor && b.rigor[k]);

  const ba = (a.autopsy && a.autopsy.bands) || [], bb = (b.autopsy && b.autopsy.bands) || [];
  for (let i = 0; i < Math.max(ba.length, bb.length); i++) {
    const x = ba[i] || {}, y = bb[i] || {};
    const gx = x.on ? num(x.gain) : 0, gy = y.on ? num(y.gain) : 0;
    if (Math.abs(gx - gy) > 0.01) changes.push({ field: `AUTOPSY band${i} @${Math.round(x.freq || y.freq || 0)}Hz`, from: +gx.toFixed(2), to: +gy.toFixed(2) });
  }
  return changes;
}

function formatDiff(changes) {
  if (!changes.length) return 'no differences';
  return changes.map((c) => `  ${c.field.padEnd(24)} ${c.from}  ->  ${c.to}`).join('\n');
}

module.exports = { diffPresets, formatDiff };
