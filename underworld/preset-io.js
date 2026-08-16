// THE UNDERWORLD — preset read/write (.underworld.chain).
// §2.1: each slab is sanitised on the way in. §2.3: unknown envelope fields are preserved,
// so an older reader never silently destroys a newer writer's work on round-trip.
const T = require('./translate.js');
const { AUTOPSY, RIGOR, CASKET } = T.cores;

function writePreset(preset) { return JSON.stringify(preset, null, 2); }

function readPreset(json) {
  const o = typeof json === 'string' ? JSON.parse(json) : json;
  const out = Object.assign({}, o);                 // shallow copy keeps unknown envelope fields
  if (o.autopsy) out.autopsy = AUTOPSY.sanitizeState(o.autopsy);
  if (o.rigor)   out.rigor   = RIGOR.sanitizeState(o.rigor);
  if (o.casket)  out.casket  = CASKET.sanitizeState(o.casket);
  return out;
}

module.exports = { writePreset, readPreset };
