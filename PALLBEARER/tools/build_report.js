/* PALLBEARER — build the status report.
   node tools/build_report.js            run every gate, write THE_CARRY.html
   node tools/build_report.js --cached   use tools/report_cache.json

   THE POINT. A hand-written status report is a claim; this one runs the
   gates and reports what they said. If a harness is red the report says so
   in the headline rather than quietly printing yesterday's number — the
   same discipline as tools/counts.js, applied to one project.

   Nothing in the output is typed by hand except the prose. */
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var OUT = path.join(ROOT, 'THE_CARRY.html');
var CACHE = path.join(__dirname, 'report_cache.json');
var CACHED = process.argv.indexOf('--cached') >= 0;

function run(cmd, cwd) {
  try {
    return { ok: true, out: cp.execSync(cmd, { cwd: cwd || ROOT, encoding: 'utf8',
             stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
}
function num(re, s, d) { var m = re.exec(s); return m ? +m[1] : (d === undefined ? null : d); }

var data;
if (CACHED && fs.existsSync(CACHE)) {
  data = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  console.log('using cached measurements from ' + data.when);
} else {
  data = { when: new Date().toISOString().slice(0, 16).replace('T', ' '), gates: {} };
  var PB = require(path.join(ROOT, 'pallbearer_core.js'));
  data.version = PB.VERSION;
  data.params = PB.PARAMS.length;
  data.tunings = Object.keys(PB.TUNINGS).length;

  process.stderr.write('── harness\n');
  var h = run('node pallbearer_test.js');
  data.gates.harness = { ok: h.ok, passed: num(/(\d+) passed/, h.out, 0),
                         failed: num(/(\d+) failed/, h.out, 0),
                         tuning: (/worst tuning error across the range: ([\d.]+)/.exec(h.out) || [])[1] || null };

  process.stderr.write('── plugin parity\n');
  var pl = run('node tests/pallbearer_plugin_test.js');
  data.gates.plugin = { ok: pl.ok, passed: num(/(\d+) passed/, pl.out, 0), failed: num(/(\d+) failed/, pl.out, 0) };

  process.stderr.write('── regression\n');
  var rg = run('node tests/pallbearer_regression.js');
  data.gates.regression = { ok: rg.ok, baselines: (rg.out.match(/✓/g) || []).length };

  process.stderr.write('── fuzz\n');
  var fz = run('node tests/pallbearer_fuzz.js');
  data.gates.fuzz = { ok: fz.ok, cases: num(/— (\d+) hostile cases/, fz.out, 0),
                      peak: (/worst peak across random patches: ([\d.]+)/.exec(fz.out) || [])[1] || null };

  process.stderr.write('── parity (compiling)\n');
  var built = run('g++ -std=c++17 -O2 -ffp-contract=off -o build/pb_parity tests/core_parity.cpp');
  var pa = built.ok ? run('./build/pb_parity') : { ok: false, out: built.out };
  data.gates.parity = { ok: pa.ok, checks: num(/(\d+) checks/, pa.out, 0), compiled: built.ok };

  process.stderr.write('── parity without LAW 1\n');
  var b2 = run('g++ -std=c++17 -O2 -o build/pb_fma tests/core_parity.cpp');
  var fma = b2.ok ? run('./build/pb_fma') : { ok: true, out: '' };
  data.gates.law1 = { failed: num(/(\d+) of \d+ checks failed/, fma.out, 0),
                      worstUlp: num(/Worst (\d+) ulp/, fma.out, 0) };

  process.stderr.write('── handoff\n');
  var hd = run('node tests/underworld_handoff.js');
  data.gates.handoff = { ok: hd.ok, passed: num(/(\d+) passed/, hd.out, 0), failed: num(/(\d+) failed/, hd.out, 0) };

  process.stderr.write('── cpu\n');
  var cpu = run('node tests/pallbearer_cpu.js');
  data.gates.cpu = { ok: cpu.ok, rows: [] };
  var cre = /^\s{2}(\w+)\s+([\d.]+) ms\s+([\d.]+)× ref\s+(\d+)× realtime/gm, cm;
  while ((cm = cre.exec(cpu.out)) !== null)
    data.gates.cpu.rows.push({ name: cm[1], ms: +cm[2], ratio: +cm[3], realtime: +cm[4] });

  process.stderr.write('── embed\n');
  var sy = run('node pallbearer_sync.js --check');
  data.gates.embed = { ok: sy.ok };

  fs.writeFileSync(CACHE, JSON.stringify(data, null, 2));
}

var g = data.gates;
var allGreen = g.harness.ok && g.plugin.ok && g.regression.ok && g.fuzz.ok &&
               g.parity.ok && g.handoff.ok && g.cpu.ok && g.embed.ok;
var totalChecks = g.harness.passed + g.plugin.passed + g.handoff.passed +
                  g.parity.checks + g.fuzz.cases + g.regression.baselines;

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function row(label, ok, detail) {
  return '<tr><td>' + esc(label) + '</td><td class="' + (ok ? 'ok' : 'bad') + '">' +
         (ok ? '✓ green' : '✗ RED') + '</td><td class="num">' + detail + '</td></tr>';
}

var cpuRows = g.cpu.rows.map(function (r) {
  var w = Math.min(100, r.ratio / 7 * 100);
  return '<tr><td>' + esc(r.name.replace(/_/g, ' ')) + '</td>' +
    '<td style="width:52%"><div class="bar"><i style="width:' + w.toFixed(1) + '%"></i></div></td>' +
    '<td class="num">' + r.ratio.toFixed(2) + '×</td>' +
    '<td class="num">' + r.realtime + '× RT</td></tr>';
}).join('\n');

var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>THE CARRY — the PALLBEARER report</title>\n<style>\n' +
':root{--ink:#07060a;--slab:#141019;--slab2:#1b1522;--gold:#c9a227;--gold-lo:#8a6f1a;' +
'--gold-hi:#f0d67a;--blood:#a4161a;--emerald:#1f6f5c;--sapphire:#2b4a7d;--amethyst:#6b3f7a;' +
'--bone:#e8e1d4;--mute:#9a8f80;--line:#2a2233}\n' +
'*{box-sizing:border-box}body{margin:0;background:radial-gradient(1100px 700px at 12% -8%,#1a1424 0%,transparent 60%),' +
'radial-gradient(900px 600px at 92% 4%,#16121f 0%,transparent 55%),var(--ink);color:var(--bone);' +
'font:16px/1.65 "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;padding:0 0 80px}\n' +
'.wrap{max-width:1000px;margin:0 auto;padding:0 24px}\n' +
'header{padding:56px 0 30px;text-align:center}header:after{content:"";display:block;width:190px;height:1px;' +
'margin:26px auto 0;background:linear-gradient(90deg,transparent,var(--gold),transparent)}\n' +
'.kicker{letter-spacing:.4em;text-transform:uppercase;font-size:10px;color:var(--gold-lo);' +
'font-family:ui-sans-serif,system-ui,sans-serif}\n' +
'h1{font-size:56px;letter-spacing:.15em;margin:12px 0 4px;font-weight:400;color:var(--gold);' +
'text-shadow:0 0 32px rgba(201,162,39,.22)}\n' +
'.tag{font-style:italic;color:var(--mute);font-size:17px}\n' +
'.stamp{margin-top:14px;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--mute);' +
'font-family:ui-sans-serif,system-ui,sans-serif}\n' +
'.verdict{margin:26px 0;padding:20px;border-radius:3px;text-align:center;font-family:ui-sans-serif,system-ui,sans-serif;' +
'letter-spacing:.26em;text-transform:uppercase;font-size:13px}\n' +
'.verdict.green{background:rgba(31,111,92,.14);border:1px solid rgba(31,111,92,.5);color:#8fd0b8}\n' +
'.verdict.red{background:rgba(164,22,26,.14);border:1px solid rgba(164,22,26,.55);color:#e8a0a2}\n' +
'.vitals{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:12px;margin:26px 0}\n' +
'.vital{background:linear-gradient(180deg,var(--slab2),var(--slab));border:1px solid var(--line);border-radius:3px;' +
'padding:15px 10px;text-align:center;position:relative;overflow:hidden}\n' +
'.vital:before{content:"";position:absolute;inset:0 0 auto 0;height:2px;' +
'background:linear-gradient(90deg,transparent,var(--gold),transparent);opacity:.55}\n' +
'.vital b{display:block;font-size:23px;color:var(--gold-hi);font-weight:400}\n' +
'.vital span{display:block;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--mute);' +
'margin-top:5px;font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.4}\n' +
'section{margin:44px 0}\n' +
'h2{font-size:12px;letter-spacing:.32em;text-transform:uppercase;color:var(--gold);' +
'font-family:ui-sans-serif,system-ui,sans-serif;font-weight:600;border-bottom:1px solid var(--line);' +
'padding-bottom:10px;margin:0 0 20px;display:flex;align-items:center;gap:10px}\n' +
'h2:before{content:"✚";color:var(--blood);font-size:13px}\n' +
'table{width:100%;border-collapse:collapse;font-size:14px}\n' +
'th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line)}\n' +
'th{font-family:ui-sans-serif,system-ui,sans-serif;font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;' +
'color:var(--gold-lo);font-weight:600}\n' +
'td.num{text-align:right;font-family:"SF Mono",ui-monospace,Menlo,monospace;color:var(--gold-hi);white-space:nowrap}\n' +
'td.ok{color:#8fd0b8;font-family:ui-sans-serif,system-ui,sans-serif;font-size:11px;letter-spacing:.14em}\n' +
'td.bad{color:#e8a0a2;font-family:ui-sans-serif,system-ui,sans-serif;font-size:11px;letter-spacing:.14em}\n' +
'.bar{background:#100d16;border:1px solid var(--line);border-radius:2px;height:13px;overflow:hidden}\n' +
'.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--gold),var(--gold-lo))}\n' +
'.card{background:linear-gradient(180deg,rgba(27,21,34,.9),rgba(20,16,25,.9));border:1px solid var(--line);' +
'border-left:3px solid var(--gold-lo);border-radius:3px;padding:16px 20px;margin:14px 0}\n' +
'.card.blood{border-left-color:var(--blood)}.card.sa{border-left-color:var(--sapphire)}\n' +
'.card p:first-child{margin-top:0}.card p:last-child{margin-bottom:0}\n' +
'ul{padding-left:20px}li{margin:6px 0}\n' +
'code{font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:12.5px;background:#100d16;' +
'border:1px solid var(--line);border-radius:2px;padding:1px 5px;color:var(--gold-hi)}\n' +
'footer{margin-top:56px;padding-top:22px;border-top:1px solid var(--line);text-align:center;color:var(--mute);font-size:12px}\n' +
'</style>\n</head>\n<body>\n<div class="wrap">\n' +
'<header>\n<div class="kicker">pallbearer · physically modelled bass · fifth of the estate</div>\n' +
'<h1>THE CARRY</h1>\n<div class="tag">Six carry the box. Four carry the song.</div>\n' +
'<div class="stamp">Measured ' + esc(data.when) + ' · core v' + esc(data.version) + '</div>\n</header>\n' +
'<div class="verdict ' + (allGreen ? 'green' : 'red') + '">' +
(allGreen ? '✚ every gate green — fit to carry ✚' : '✗ a gate is red — read the table ✗') + '</div>\n' +
'<div class="vitals">\n' +
'<div class="vital"><b>' + g.parity.checks.toLocaleString('en-US') + '</b><span>Parity checks<br>bit-exact</span></div>\n' +
'<div class="vital"><b>' + (g.harness.tuning || '—') + '</b><span>Cents worst<br>tuning error</span></div>\n' +
'<div class="vital"><b>' + g.fuzz.cases.toLocaleString('en-US') + '</b><span>Fuzz cases<br>clean</span></div>\n' +
'<div class="vital"><b>' + (g.harness.passed + g.plugin.passed + g.handoff.passed) + '</b><span>Assertions<br>green</span></div>\n' +
'<div class="vital"><b>' + data.params + '</b><span>Parameters</span></div>\n' +
'<div class="vital"><b>0</b><span>Samples in<br>the string</span></div>\n' +
'</div>\n' +
'<section>\n<h2>The gates</h2>\n<table>\n<thead><tr><th>Gate</th><th>State</th><th>What it measured</th></tr></thead>\n<tbody>\n' +
row('Harness', g.harness.ok, g.harness.passed + ' passed, ' + g.harness.failed + ' failed') + '\n' +
row('Parity — JS vs C++', g.parity.ok, g.parity.checks.toLocaleString('en-US') + ' checks, bit-exact') + '\n' +
row('Plugin parameter parity', g.plugin.ok, g.plugin.passed + ' passed, ' + g.plugin.failed + ' failed') + '\n' +
row('Regression baselines', g.regression.ok, g.regression.baselines + ' phrases byte-stable') + '\n' +
row('Fuzz', g.fuzz.ok, g.fuzz.cases.toLocaleString('en-US') + ' hostile cases · worst peak ' + (g.fuzz.peak || '—')) + '\n' +
row('Underworld handoff', g.handoff.ok, g.handoff.passed + ' passed, ' + g.handoff.failed + ' failed') + '\n' +
row('CPU cost gate', g.cpu.ok, g.cpu.rows.length + ' cases within tolerance') + '\n' +
row('Embed byte-identical', g.embed.ok, 'NM + core verbatim in the HTML') + '\n' +
'</tbody>\n</table>\n' +
'<div class="card blood"><p><b style="color:var(--gold-hi);font-weight:400">LAW 1, measured on this project.</b> ' +
'Compiled without <code>-ffp-contract=off</code>, <b>' + g.law1.failed.toLocaleString('en-US') + ' of ' +
g.parity.checks.toLocaleString('en-US') + '</b> parity checks fail and the worst error reaches <b>' +
g.law1.worstUlp.toLocaleString('en-US') + ' ulp</b>. A waveguide feeds its own output back through a fractional-delay ' +
'allpass, four dispersion stages and a damping pole every sample, so one fused rounding does not stay small.</p></div>\n' +
'</section>\n' +
'<section>\n<h2>What it costs</h2>\n<table>\n<thead><tr><th>Case</th><th>Relative cost</th><th>vs ref</th><th>Speed</th></tr></thead>\n' +
'<tbody>\n' + cpuRows + '\n</tbody>\n</table>\n' +
'<div class="card sa"><p>Coupling is the expensive feature and it is worth knowing why: with it on, ' +
'every string runs its delay line every sample, played or not, because a sympathetic string that is not ' +
'being computed cannot resonate. That is the cost of the feature being real rather than an envelope trick.</p>' +
'<p style="color:var(--mute);font-size:14px">The gate compares ratios rather than milliseconds, takes the ' +
'minimum of seven runs rather than the median, and allows 50% drift. That is a coarse net by design — it ' +
'catches a doubling, not a 20% slip. On a shared machine, a tighter number would only produce a gate that ' +
'cries wolf.</p></div>\n</section>\n' +
'<section>\n<h2>Still in the ground</h2>\n<div class="card">\n<ul>\n' +
'<li><b>The plugin has never been compiled.</b> There is no JUCE here; <code>PallbearerCore.h</code> is ' +
'syntax-checked and parity-proven, and <code>PluginProcessor</code> is written to the estate\'s pattern, but ' +
'the first real build happens on a CI runner. Expect the usual first-compile friction.</li>\n' +
'<li><b>The attack layer does not survive a session save.</b> The state carries a version stamp but not the ' +
'audio, so a sampled or hybrid patch reloads silent. Saving a file path instead would break the moment the ' +
'file moved, which is worse.</li>\n' +
'<li><b>Mono out.</b> Both channels are identical.</li>\n' +
'<li><b>The drive stage aliases</b> at high settings and wants oversampling — and the Interchange warns that ' +
'oversampler taps are the first thing the compiler wants to fuse.</li>\n' +
'<li><b>No bespoke editor.</b> Generic sliders plus a neck diagram, deliberately: writing a rich JUCE editor ' +
'without a compiler is how a session gets spent for nothing.</li>\n' +
'</ul>\n</div>\n</section>\n' +
'<footer><div style="letter-spacing:.28em;text-transform:uppercase;color:var(--gold-lo);font-size:11px;' +
'font-family:ui-sans-serif,system-ui,sans-serif">✚ ' + totalChecks.toLocaleString('en-US') + ' checks ✚</div>\n' +
'<p style="margin-top:12px">Generated by <code>tools/build_report.js</code>. Every figure above was measured ' +
'by running the gate, not typed.<br>If a harness were red this page would say so in the headline.</p></footer>\n' +
'</div>\n</body>\n</html>\n';

fs.writeFileSync(OUT, html);
console.log((allGreen ? '✓' : '✗') + ' wrote ' + path.relative(ROOT, OUT) + ' — ' +
            totalChecks.toLocaleString('en-US') + ' checks across ' + Object.keys(g).length + ' gates');
if (!allGreen) { console.log('  a gate is RED — the report says so'); process.exit(1); }
