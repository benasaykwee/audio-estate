// The local app's server: serves the page and masters a POSTed mix through the tested pipeline.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { createServer } = require('./server.js');
const { writeWav, readAudio } = require('./wav.js');
const T = require('./translate.js');
const { CASKET } = T.cores;
const FS = 48000;
let pass = 0, fail = 0;
const check = (n, c, d) => (c ? (pass++, console.log(`  [PASS] ${n}  ${d || ''}`)) : (fail++, console.log(`  [FAIL] ${n}  ${d || ''}`)));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uw-srvtest-'));
const N = FS, L = new Float64Array(N), R = new Float64Array(N);
for (let i = 0; i < N; i++) { const t = i / FS; L[i] = 0.55 * Math.sin(2 * Math.PI * 90 * t) + 0.3 * Math.sin(2 * Math.PI * 800 * t); R[i] = 0.55 * Math.sin(2 * Math.PI * 90 * t + 0.2) + 0.3 * Math.sin(2 * Math.PI * 1000 * t); }
let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); const g = 0.7 / pk; for (let i = 0; i < N; i++) { L[i] *= g; R[i] *= g; }
const inP = path.join(dir, 'in.wav'); writeWav(inP, L, R, FS, 24);
const wavBuf = fs.readFileSync(inP);

const b64ToBuf = (b64) => Buffer.from(b64, 'base64');
const server = createServer();

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ port: server.address().port, method, path: urlPath }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
}

server.listen(0, async () => {
  try {
    console.log('Local app server — serves the page, masters a POSTed mix');
    const page = await req('GET', '/');
    check('GET / serves the app HTML', page.status === 200 && /THE.*Underworld/s.test(page.body.toString()));

    const resp = await req('POST', '/master?delivery=spotify&comp=0.3', wavBuf);
    const j = JSON.parse(resp.body.toString());
    check('POST /master returns target + achieved', resp.status === 200 && j.target.lufs === -14 && typeof j.report.achieved.lufs === 'number', `achieved ${j.report && j.report.achieved && j.report.achieved.lufs}`);
    check('achieved hit the delivery target', Math.abs(j.report.achieved.lufs - (-14)) < 0.5);

    const mP = path.join(dir, 'm.wav'); fs.writeFileSync(mP, b64ToBuf(j.masteredWav));
    const m = readAudio(mP);
    const tp = 20 * Math.log10(Math.max(CASKET.truePeakOf(m.L, 16), CASKET.truePeakOf(m.R, 16)));
    check('returned master is a valid WAV that holds ~ceiling', m.sampleRate === FS && tp <= -1 + 0.2, `${tp.toFixed(3)} dBTP`);
    check('an A/B matched original is returned too', b64ToBuf(j.abOriginalWav).length > 44 && typeof j.matchGainDb === 'number', `match ${j.matchGainDb} dB`);

    const bad = await req('POST', '/master', Buffer.from('not audio'));
    check('a non-audio POST fails cleanly (control)', bad.status === 500 && /error/.test(bad.body.toString()));
  } catch (e) { console.log('  [FAIL] threw ' + e.message); fail++; }
  server.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
});
