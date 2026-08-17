// THE UNDERWORLD — preset library (task 13). A starter pack + save/load of named settings.
const fs = require('fs'), path = require('path');

const STARTER_PACK = {
  'streaming-safe': { delivery: 'spotify', compAmount: 0.3 },
  'loud-and-proud': { delivery: 'club', compAmount: 0.5, eqLow: 1 },
  'warm-tape':      { describe: 'warm vintage tape', targetLufs: -14 },
  'broadcast-r128': { delivery: 'broadcast' },
  'transparent':    { compAmount: 0.15, targetLufs: -16, ceilingDbTp: -1 },
  'podcast-voice':  { delivery: 'podcast', compAmount: 0.5, eqHighMid: 1.5, width: 0.9 },
};

const fileFor = (name, dir) => path.join(dir || '.', String(name).replace(/[^\w-]/g, '_') + '.underworld.json');
function savePreset(name, obj, dir) { fs.writeFileSync(fileFor(name, dir), JSON.stringify(obj, null, 2)); return fileFor(name, dir); }
function loadPreset(name, dir) { return JSON.parse(fs.readFileSync(fileFor(name, dir), 'utf8')); }
function listPresets(dir) { return fs.readdirSync(dir || '.').filter((f) => /\.underworld\.json$/.test(f)).map((f) => f.replace(/\.underworld\.json$/, '')); }

// Library bundle — all named presets in a folder to one shareable file, and back.
function exportLibrary(dir) {
  const lib = { format: 'underworld.library', version: 1, presets: {} };
  for (const name of listPresets(dir)) lib.presets[name] = loadPreset(name, dir);
  return lib;
}
function importLibrary(bundle, dir) {
  const b = typeof bundle === 'string' ? JSON.parse(bundle) : bundle;
  const names = [];
  for (const name of Object.keys(b.presets || {})) { savePreset(name, b.presets[name], dir); names.push(name); }
  return names;
}

module.exports = { STARTER_PACK, savePreset, loadPreset, listPresets, exportLibrary, importLibrary };
