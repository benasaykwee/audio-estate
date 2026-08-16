// THE UNDERWORLD — "describe the sound you want" -> settings.
// A lightweight word->delta mapper in the spirit of Masterbox's describeReference: plain
// language becomes MasteringSettings deltas, which the translator turns into a chain preset.
// (The full spectral-target synthesis lives in Masterbox's brain; this is the seam-side
// convenience so a preset can be typed, not just dialed.)
const RULES = [
  // word(s)                       -> settings deltas
  [/\b(warm|warmth|round|smooth)\b/,       { eqLow: +2, eqHigh: -1.5 }],
  [/\b(bright|air|airy|crisp|sparkl)\w*/,  { eqHigh: +3 }],
  [/\b(dark|dull|muffled)\b/,              { eqHigh: -3 }],
  [/\b(punch|punchy|snappy|tight)\w*/,     { compAmount: +0.25, punch: +0.2 }],
  [/\b(smooth|gentle|glue|glued)\b/,       { compAmount: +0.2, punch: -0.15 }],
  [/\b(wide|wider|spacious|huge)\b/,       { width: +0.3 }],
  [/\b(narrow|mono|focused|tight)\b/,      { width: -0.3 }],
  [/\b(loud|hot|slamm\w*|aggressive)\b/,   { targetLufs: +5 }],   // toward -9
  [/\b(quiet|gentle|dynamic|open)\b/,      { targetLufs: -3 }],   // toward -17
  [/\b(boomy|bass|fat|thick|sub)\b/,       { eqLow: +3 }],
  [/\b(thin|weak|light)\b/,                { eqLow: -2 }],
  [/\b(scoop\w*|smiley)\b/,                { eqLowMid: -2, eqHighMid: +2 }],
  [/\b(present|clear|forward|vocal)\b/,    { eqHighMid: +2 }],
  [/\b(harsh|brittle|fatiguing)\b/,        { eqHighMid: -2.5 }],
  [/\b(lo-?fi|vintage|tape|retro)\b/,      { eqHigh: -2, eqLow: +1, compAmount: +0.15 }],
  [/\b(club|dj|festival)\b/,               { targetLufs: +6, ceilingDbTp: +0.7 }], // toward -8 / -0.3
  [/\b(muddy|boxy|congested)\b/,           { eqLowMid: -2.5 }],
  [/\b(glassy|shimmer\w*|silky)\b/,        { eqHigh: +2, eqHighMid: +1 }],
  [/\b(crunch\w*|gritty|driven)\b/,        { compAmount: +0.3, eqHighMid: +1 }],
  [/\b(deep|weighty|powerful)\b/,          { eqLow: +2, targetLufs: +2 }],
  [/\b(polished|radio-?ready|commercial)\b/,{ compAmount: +0.3, eqHigh: +1.5, targetLufs: +3 }],
];

// Genre presets — a bundle of settings as a starting point (over Custom defaults).
const GENRE = {
  motown:    { eqLow: 1.5, eqHighMid: 1.5, compAmount: 0.4, punch: 0.6, width: 1.1, targetLufs: -12 },
  disco:     { eqLow: 2, eqHigh: 2, compAmount: 0.35, punch: 0.4, width: 1.3, targetLufs: -10 },
  'lo-fi':   { eqHigh: -3, eqLow: 1, compAmount: 0.5, punch: 0.2, targetLufs: -14 },
  hiphop:    { eqLow: 3, compAmount: 0.3, punch: 0.5, targetLufs: -9, ceilingDbTp: -0.3 },
  jazz:      { compAmount: 0.15, punch: -0.1, width: 1.1, targetLufs: -16 },
  classical: { compAmount: 0.05, width: 1.15, targetLufs: -18 },
  rock:      { eqHighMid: 1, compAmount: 0.45, punch: 0.5, targetLufs: -10 },
  edm:       { eqLow: 2.5, eqHigh: 1.5, compAmount: 0.4, targetLufs: -8, ceilingDbTp: -0.3 },
  folk:      { compAmount: 0.2, eqHighMid: 1, width: 1.05, targetLufs: -15 },
  soul:      { eqLow: 1.5, eqHighMid: 1, compAmount: 0.3, width: 1.1, targetLufs: -13 },
};
function genre(name) {
  const g = GENRE[String(name).toLowerCase()];
  if (!g) throw new Error('unknown genre: ' + name);
  return Object.assign({ targetLufs: -14, ceilingDbTp: -1, width: 1 }, g);
}

function describe(text, baseMs) {
  const ms = Object.assign({ targetLufs: -14, ceilingDbTp: -1, width: 1 }, baseMs || {});
  const matched = [];
  for (const [re, delta] of RULES) {
    if (re.test(text)) {
      matched.push(re.source);
      for (const k of Object.keys(delta)) ms[k] = (ms[k] || 0) + delta[k];
    }
  }
  // keep values sane
  if (ms.compAmount != null) ms.compAmount = Math.max(0, Math.min(1, ms.compAmount));
  if (ms.punch != null) ms.punch = Math.max(0, Math.min(1, ms.punch));
  if (ms.width != null) ms.width = Math.max(0, ms.width);
  if (ms.targetLufs != null) ms.targetLufs = Math.max(-24, Math.min(-6, ms.targetLufs));
  if (ms.ceilingDbTp != null) ms.ceilingDbTp = Math.max(-6, Math.min(-0.1, ms.ceilingDbTp));
  return { ms, matched };
}

module.exports = { describe, genre, RULES, GENRE };
