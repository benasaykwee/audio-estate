// THE UNDERWORLD — a standalone HTML mastering report per master (task 12).
// Self-contained gothic page built from a fullReport(): key figures, the before/after tonal
// balance, a loudness-over-time trace, gain reduction, and stereo health.
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function specBars(spec, color) {
  const min = -60, max = 6;
  return spec.map((b) => { const h = Math.max(1, ((Math.min(max, Math.max(min, b.db)) - min) / (max - min)) * 100); return `<div class="sb" title="${b.hz}Hz ${b.db}dB" style="height:${h}%;background:${color}"></div>`; }).join('');
}
function historySvg(hist) {
  if (hist.length < 2) return '';
  const w = 560, h = 90, lu = hist.map((p) => p.lufs), lo = Math.min(...lu) - 1, hi = Math.max(...lu) + 1;
  const pts = hist.map((p, i) => `${(i / (hist.length - 1) * w).toFixed(1)},${(h - (p.lufs - lo) / (hi - lo) * h).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:90px"><polyline points="${pts}" fill="none" stroke="#54d2c6" stroke-width="2"/></svg>`;
}

function renderReportHtml(report, name) {
  const r = report, a = r.achieved || {}, s = r.stereo || {}, g = r.gr || {}, mc = r.meterCheck || { readings: {} };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)} — Master Report</title>
<style>
:root{--void:#0a0710;--crypt:#150e22;--gild:#e8b04b;--gild-b:#f6cd6e;--styx:#54d2c6;--ox:#c6455a;--bone:#f1ebf7;--ash:#b6aac9;--ash2:#7d7196;--rule:rgba(232,176,75,.16);
--serif:"Hoefler Text",Palatino,Georgia,serif;--sans:"Avenir Next","Segoe UI",system-ui,sans-serif;--mono:"SF Mono",ui-monospace,Menlo,monospace;}
*{box-sizing:border-box}body{margin:0;background:var(--void);color:var(--bone);font-family:var(--sans);background-image:radial-gradient(120% 55% at 50% -10%,rgba(232,176,75,.10),transparent 60%);}
.wrap{max-width:640px;margin:0 auto;padding:46px 24px 70px}h1{font-family:var(--serif);font-size:34px;margin:0 0 2px;color:var(--gild-b)}
.sub{font-family:var(--mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--ash2);margin-bottom:28px}
.card{background:var(--crypt);border:1px solid var(--rule);border-radius:12px;padding:18px 20px;margin-bottom:14px}
.card h2{font-family:var(--mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--ash2);margin:0 0 12px}
.rows{display:grid;grid-template-columns:auto 1fr;gap:5px 16px;font-size:15px}.rows .k{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ash2);align-self:center}
.rows .v{font-family:var(--mono);color:var(--bone);font-variant-numeric:tabular-nums}.v.ok{color:var(--styx)}.v.warn{color:var(--gild)}
.spec{display:flex;gap:20px}.col{flex:1}.bars{display:flex;align-items:flex-end;gap:2px;height:80px}.sb{flex:1;border-radius:2px 2px 0 0;min-height:1px}
.lab{font-family:var(--mono);font-size:10px;color:var(--ash2);margin-top:6px;letter-spacing:.1em}
</style></head><body><div class="wrap">
<h1>${esc(name)}</h1><div class="sub">The Underworld · Master Report</div>

<div class="card"><h2>Loudness &amp; ceiling</h2><div class="rows">
<div class="k">Target</div><div class="v">${r.target ? r.target.lufs : '?'} LUFS / ${r.target ? r.target.ceilingDbTp : '?'} dBTP</div>
<div class="k">Achieved</div><div class="v ok">${a.lufs} LUFS / ${a.truePeakDb} dBTP</div>
<div class="k">Gain reduction</div><div class="v">RIGOR ${g.rigor} dB · CASKET ${g.casket} dB</div>
<div class="k">Meters</div><div class="v ${mc.agree ? 'ok' : 'warn'}">${mc.agree ? 'agree' : 'diverge'} ${mc.spreadDb} dB (${mc.readings.casketMeter} / ${mc.readings.independent})</div>
<div class="k">Latency</div><div class="v">${r.latencySamples} smp</div>
</div></div>

<div class="card"><h2>Tonal balance — before / after</h2><div class="spec">
<div class="col"><div class="bars">${specBars(r.spectrum.in, 'linear-gradient(180deg,#7d7196,#4a4258)')}</div><div class="lab">INPUT</div></div>
<div class="col"><div class="bars">${specBars(r.spectrum.out, 'linear-gradient(180deg,#f6cd6e,#b9832f)')}</div><div class="lab">MASTERED · 50Hz → 14kHz</div></div>
</div></div>

<div class="card"><h2>Loudness over time</h2>${historySvg(r.loudnessHistory)}</div>

<div class="card"><h2>Stereo &amp; input health</h2><div class="rows">
<div class="k">Correlation</div><div class="v">${s.correlationIn} → ${s.correlationOut}</div>
<div class="k">Mono fold</div><div class="v ${s.monoCompatOutDb < -3 ? 'warn' : 'ok'}">${s.monoCompatOutDb} dB</div>
<div class="k">Input peak</div><div class="v ${r.input.clipping ? 'warn' : ''}">${r.input.peakDb} dBFS${r.input.clipping ? ' · CLIPPED' : ''}</div>
<div class="k">Safety trim</div><div class="v">${r.safety && r.safety.trimmedDb ? r.safety.trimmedDb + ' dB' : 'none'}</div>
</div></div>
</div></body></html>`;
}

module.exports = { renderReportHtml };
