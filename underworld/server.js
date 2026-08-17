#!/usr/bin/env node
// THE UNDERWORLD — local web app (task 1). A thin server over the SAME tested pipeline the
// CLI uses (LAW 0 unchanged): drop a mix in the browser, it's mastered here in Node and sent
// back with a loudness-matched original for honest A/B. Run: node underworld/server.js
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { readAudio, writeWav } = require('./wav.js');
const { runPipeline } = require('./cli.js');
const { guardTruePeak } = require('./safety.js');
const { abPair } = require('./ab.js');
const { fullReport } = require('./report.js');

function masterBuffer(wavBuf, opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uw-srv-'));
  try {
    const inP = path.join(dir, 'in'); fs.writeFileSync(inP, wavBuf);
    const { L, R, sampleRate } = readAudio(inP);
    const { preset, out } = runPipeline(L, R, sampleRate, opts);
    const guard = guardTruePeak(out.L, out.R, preset.target.ceilingDbTp);
    preset.report = fullReport(L, R, guard.L, guard.R, preset, out, sampleRate);   // rich report for the viz
    const ab = abPair(L, R, guard.L, guard.R, sampleRate);
    const mP = path.join(dir, 'm.wav'), aP = path.join(dir, 'a.wav');
    writeWav(mP, guard.L, guard.R, sampleRate, opts.bits === 16 ? 16 : 24);
    writeWav(aP, ab.originalMatched.L, ab.originalMatched.R, sampleRate, 16);
    return {
      report: preset.report, target: preset.target, sampleRate,
      matchGainDb: ab.matchGainDb,
      masteredWav: fs.readFileSync(mP).toString('base64'),
      abOriginalWav: fs.readFileSync(aP).toString('base64'),
    };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'app.html'))); return;
    }
    if (req.method === 'POST' && req.url.startsWith('/master')) {
      const u = new URL(req.url, 'http://x'); const opts = {};
      for (const [k, v] of u.searchParams) opts[k] = (v === '' || isNaN(+v)) ? v : +v;
      const chunks = []; let size = 0;
      req.on('data', (c) => { chunks.push(c); size += c.length; if (size > 200e6) req.destroy(); });
      req.on('end', () => {
        try { const out = masterBuffer(Buffer.concat(chunks), opts); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); }
        catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e) })); }
      });
      return;
    }
    res.writeHead(404); res.end('not found');
  });
}

if (require.main === module) {
  const port = process.env.PORT || 8799;
  createServer().listen(port, () => console.log(`\n  THE UNDERWORLD — open http://localhost:${port}\n`));
}
module.exports = { createServer, masterBuffer };
