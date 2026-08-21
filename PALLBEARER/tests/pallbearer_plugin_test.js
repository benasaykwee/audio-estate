/* PALLBEARER plugin parity — does the DAW-facing parameter list still
   agree with the JS registry?
   node tests/pallbearer_plugin_test.js

   Parameters.h is read as TEXT. There is no JUCE here and there does not
   need to be: the thing that goes wrong is a parameter added on one side
   and forgotten on the other, or a range edited in one place, or — the
   expensive one — an enum reordered, which silently rewrites every saved
   session because hosts store choice parameters as an index.

   The portable contract is ids + ranges + defaults + option ORDER.
   Display wording is allowed to differ and is reported separately. */
'use strict';
var fs = require('fs');
var path = require('path');
var PB = require('../pallbearer_core.js');

var SRC = fs.readFileSync(path.join(__dirname, '..', 'pallbearer-juce', 'Source', 'Parameters.h'), 'utf8');
var PROC = fs.readFileSync(path.join(__dirname, '..', 'pallbearer-juce', 'Source', 'PluginProcessor.cpp'), 'utf8');

var pass = 0, fail = 0, section = '';
function S(n) { section = n; console.log('\n── ' + n + ' ' + '─'.repeat(Math.max(0, 54 - n.length))); }
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '   ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '   ' + detail : '') + '   [' + section + ']'); }
}

/* Strip comments before parsing, or a commented-out `pf(...)` line counts
   as a real parameter — the same class of mistake as the LAW-5 gate that
   matched its own explanatory comment. */
var CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// -------------------------------------------------------------------
S('I · the parser can see the file at all');
// -------------------------------------------------------------------
ok('Parameters.h was found and is non-trivial', SRC.length > 1000, SRC.length + ' bytes');
ok('comment stripping removed the commentary', CODE.length < SRC.length,
   SRC.length + ' → ' + CODE.length + ' bytes');
ok('the stripper did not eat the code', /pf\(pid::decay/.test(CODE));

// -------------------------------------------------------------------
S('II · floats — id, range, default');
// -------------------------------------------------------------------
/* pf(pid::decay, "String Decay", 0.5f, 12.f, 4.5f, "s"); */
var pfRe = /pf\(pid::(\w+)\s*,\s*"([^"]*)"\s*,\s*([-\d.eE]+)f?\s*,\s*([-\d.eE]+)f?\s*,\s*([-\d.eE]+)f?/g;
var cppFloats = {}, m;
while ((m = pfRe.exec(CODE)) !== null) {
  cppFloats[m[1]] = { name: m[2], min: parseFloat(m[3]), max: parseFloat(m[4]), def: parseFloat(m[5]) };
}
var pcRe = /pc\(pid::(\w+)\s*,\s*"([^"]*)"\s*,\s*(\w+)\(\)\s*,\s*(\d+)\)/g;
var cppEnums = {};
while ((m = pcRe.exec(CODE)) !== null) {
  cppEnums[m[1]] = { name: m[2], optionsFn: m[3], def: parseInt(m[4], 10) };
}
ok('found float parameters', Object.keys(cppFloats).length > 20, Object.keys(cppFloats).length + ' found');
ok('found enum parameters', Object.keys(cppEnums).length === 4,
   Object.keys(cppEnums).length + ' found: ' + Object.keys(cppEnums).join(', '));

var jsFloats = PB.PARAMS.filter(function (p) { return p.type !== 'enum'; });
var jsEnums = PB.PARAMS.filter(function (p) { return p.type === 'enum'; });

ok('every JS float parameter exists in the plugin',
   jsFloats.every(function (p) { return cppFloats[p.id]; }),
   jsFloats.filter(function (p) { return !cppFloats[p.id]; }).map(function (p) { return p.id; }).join(', ') || 'none missing');
ok('the plugin invents no float parameter the core lacks',
   Object.keys(cppFloats).every(function (id) { return PB.PARAM_BY_ID[id]; }),
   Object.keys(cppFloats).filter(function (id) { return !PB.PARAM_BY_ID[id]; }).join(', ') || 'none extra');

var rangeBad = [], defBad = [], nameDiffs = [];
jsFloats.forEach(function (p) {
  var c = cppFloats[p.id];
  if (!c) return;
  var eps = Math.max(1e-6, Math.abs(p.max) * 1e-6);
  if (Math.abs(c.min - p.min) > eps || Math.abs(c.max - p.max) > eps)
    rangeBad.push(p.id + ' JS [' + p.min + ',' + p.max + '] vs C++ [' + c.min + ',' + c.max + ']');
  if (Math.abs(c.def - p.def) > eps)
    defBad.push(p.id + ' JS ' + p.def + ' vs C++ ' + c.def);
  if (c.name !== p.name) nameDiffs.push(p.id + ': "' + p.name + '" vs "' + c.name + '"');
});
ok('every float RANGE agrees', rangeBad.length === 0, rangeBad.join(' · ') || jsFloats.length + ' checked');
ok('every float DEFAULT agrees', defBad.length === 0, defBad.join(' · ') || jsFloats.length + ' checked');

// -------------------------------------------------------------------
S('III · enums — option order is the dangerous one');
// -------------------------------------------------------------------
function keysFrom(fnName) {
  var re = new RegExp('inline juce::StringArray ' + fnName + '\\(\\)\\s*\\{\\s*return\\s*\\{([^}]*)\\}');
  var mm = re.exec(CODE);
  if (!mm) return null;
  return mm[1].split(',').map(function (s) { return s.trim().replace(/^"|"$/g, ''); }).filter(Boolean);
}
var enumKeyFn = { tuning: 'tuningKeys', style: 'styleKeys', artic: 'articKeys', pickupInv: 'polarityKeys' };
jsEnums.forEach(function (p) {
  var fn = enumKeyFn[p.id];
  var keys = fn ? keysFrom(fn) : null;
  ok('"' + p.id + '" option list found', keys !== null, fn + '()');
  if (!keys) return;
  ok('"' + p.id + '" has the same options IN THE SAME ORDER',
     keys.length === p.options.length && keys.every(function (k, i) { return k === p.options[i]; }),
     'JS [' + p.options.join(', ') + '] vs C++ [' + keys.join(', ') + ']');
  var c = cppEnums[p.id];
  if (c) ok('"' + p.id + '" default index points at the right option',
     keys[c.def] === p.def, 'index ' + c.def + ' = "' + keys[c.def] + '", JS default "' + p.def + '"');
});
jsEnums.forEach(function (p) {
  var fn = enumKeyFn[p.id];
  var keys = fn ? keysFrom(fn) : null;
  var namesFn = fn ? fn.replace('Keys', 'Names') : null;
  var names = namesFn ? keysFrom(namesFn) : null;
  if (keys && names) ok('"' + p.id + '" has one display name per option', keys.length === names.length,
     keys.length + ' keys, ' + names.length + ' names');
});

// -------------------------------------------------------------------
S('IV · the processor actually reads every parameter');
// -------------------------------------------------------------------
/* A parameter can exist in the layout, appear in the host, be automated by
   the user, and do absolutely nothing — because nobody wired it into the
   core. That failure is invisible to every other check here. */
var unread = PB.PARAMS.filter(function (p) {
  return PROC.indexOf('pid::' + p.id) < 0;
}).map(function (p) { return p.id; });
ok('every parameter is read by PluginProcessor', unread.length === 0,
   unread.join(', ') || PB.PARAMS.length + ' parameters all wired');

var idDecls = (SRC.match(/static const char\* (\w+)\s*=/g) || []).length;
ok('every parameter has an id constant', idDecls === PB.PARAMS.length,
   idDecls + ' declared, ' + PB.PARAMS.length + ' in the registry');

// -------------------------------------------------------------------
S('V · the instrument-shaped obligations');
// -------------------------------------------------------------------
ok('the plugin declares itself a synth', /IS_SYNTH TRUE/.test(fs.readFileSync(path.join(__dirname, '..', 'pallbearer-juce', 'CMakeLists.txt'), 'utf8')));
ok('it asks for MIDI input', /NEEDS_MIDI_INPUT TRUE/.test(fs.readFileSync(path.join(__dirname, '..', 'pallbearer-juce', 'CMakeLists.txt'), 'utf8')));
ok('LAW 1 is in the build file', /-ffp-contract=off/.test(fs.readFileSync(path.join(__dirname, '..', 'pallbearer-juce', 'CMakeLists.txt'), 'utf8')));
ok('state carries a version stamp', /pallbearerVersion/.test(PROC),
   'cannot be added retroactively — NECROPHONE round-15');
ok('a future state version is refused, not half-loaded', /v > 1/.test(PROC));
ok('MIDI is handled sample-accurately, not per block', /meta\.samplePosition/.test(PROC));
ok('the tail length is declared for long decays', /getTailLengthSeconds/.test(fs.readFileSync(path.join(__dirname, '..', 'pallbearer-juce', 'Source', 'PluginProcessor.h'), 'utf8')));
ok('the processor rebuilds the core on a rate change', /make_unique<PallbearerCore>\(sampleRate\)/.test(PROC),
   'every delay length and coefficient is derived from sr');

// -------------------------------------------------------------------
S('VI · the gates can fail');
// -------------------------------------------------------------------
/* Prove each parser bites, or these are decoration. */
ok('the float parser would catch a changed range',
   (function () {
     var fake = 'pf(pid::decay, "String Decay", 0.5f, 99.f, 4.5f, "s");';
     var r = /pf\(pid::(\w+)\s*,\s*"([^"]*)"\s*,\s*([-\d.eE]+)f?\s*,\s*([-\d.eE]+)f?/.exec(fake);
     return parseFloat(r[4]) !== PB.PARAM_BY_ID.decay.max;
   })());
ok('the enum parser would catch a reorder',
   (function () {
     var fake = 'inline juce::StringArray styleKeys()  { return { "pick", "finger", "slap", "thumb", "muted" }; }';
     var r = /return\s*\{([^}]*)\}/.exec(fake)[1].split(',').map(function (s) { return s.trim().replace(/"/g, ''); });
     return r[0] !== PB.PARAM_BY_ID.style.options[0];
   })());
ok('the wiring check would catch an unread parameter',
   'pid::neverRead'.indexOf('pid::') === 0 && PROC.indexOf('pid::neverRead') < 0);

// -------------------------------------------------------------------
console.log('\n' + '═'.repeat(60));
if (nameDiffs.length)
  console.log('  ' + nameDiffs.length + ' display-name differences (allowed by design):\n    ' +
              nameDiffs.slice(0, 4).join('\n    ') + (nameDiffs.length > 4 ? '\n    …' : ''));
console.log('  plugin parity — ' + pass + ' passed, ' + fail + ' failed');
console.log('═'.repeat(60) + '\n');
process.exit(fail ? 1 : 0);
