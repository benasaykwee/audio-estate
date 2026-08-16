#!/usr/bin/env node
// THE UNDERWORLD — run the whole suite as one job (task 20). Estate CI can call this.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const dir = __dirname;
const tests = fs.readdirSync(dir).filter((f) => /\.test\.js$/.test(f)).sort();
let P = 0, F = 0; const failedFiles = [];
console.log('THE UNDERWORLD — full seam suite\n');
for (const t of tests) {
  let out = '';
  try { out = execFileSync('node', [path.join(dir, t)], { encoding: 'utf8' }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); failedFiles.push(t); }
  const m = out.match(/(\d+) passed, (\d+) failed/);
  if (m) { P += +m[1]; F += +m[2]; }
  const ok = m && +m[2] === 0 && !failedFiles.includes(t);
  console.log(`  ${ok ? '✓' : '✗'} ${t.padEnd(30)} ${m ? m[0] : 'no result'}`);
}
console.log(`\n=== TOTAL: ${P} passed, ${F} failed across ${tests.length} files ===`);
process.exit(F > 0 || failedFiles.length ? 1 : 0);
