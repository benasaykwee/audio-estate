# The case file — `.casket.json`

### What an arrangement actually is, on disk

An arrangement is CASKET's save file: every knob position, nothing else.
No audio, no undo history, no window layout — just the state object the
engine already runs on, written out exactly as it exists in memory. This
document describes that shape field by field, grounded directly in
`casket_core.js`'s `defaultState()` and `sanitizeState()` — not a separate
spec that could drift from what the code actually does, but a description
of it. If this document and `casket_core.js` ever disagree, `casket_core.js`
is correct and this document is stale; it was written by reading that file,
not the other way around.

**Related:** [`../README.md`](../README.md) for what each control does ·
[`../MASTERING_WITH_CASKET.md`](../MASTERING_WITH_CASKET.md) for when to reach
for it and what it costs · [`LISTENING_PROTOCOL.md`](LISTENING_PROTOCOL.md) for
checking any of it by ear.

---

## 1. There is no envelope

Saving (`casket.html`'s **Save** button) does exactly this:

```js
JSON.stringify(state, null, 2)
```

The file's top level *is* the state object. No `{"version": ..., "data":
{...}}` wrapper, no metadata alongside it — the arrangement's own fields
carry everything, including the one field (`version`, below) that exists
for future format changes. The download name is the arrangement's own
`meta.name`, sanitised and suffixed: `My_Master.casket.json`.

Loading does the reverse and then some — every field is passed through
`sanitizeState()`, never trusted as-is. That single fact is most of what
makes this format worth documenting: a case file is not a serialization
that must round-trip perfectly to be safe. It's closer to a *request*,
which the loader is free to correct.

---

## 2. Field by field

Every field below is read from `defaultState()`. The **fallback** column is
what a missing or invalid value becomes — not a guess, but the literal
value `sanitizeState()` substitutes, read from the source.

| field | type | range / values | fallback if missing or invalid |
|---|---|---|---|
| `version` | integer | — | `1` — see §5, this does not yet drive migration logic |
| `bypass` | boolean | — | `false` |
| `style` | string | `pine` \| `velvet` \| `oak` \| `iron` \| `lead` | `velvet` |
| `drive` | number | −12 to 24 (dB) | `0` |
| `lid` | number | −20 to 0 (dBTP) | `−1` |
| `margin` | number | −1 to 0 (dB) | `0` |
| `vigil` | number | 0.1 to 20 (ms) | `2` |
| `release` | number | 1 to 1000 (ms) | `150` |
| `autoRel` | boolean | — | `false` |
| `knee` | number | 0 to 12 (dB) | `0` |
| `hold` | number | 0 to 500 (ms) | `0` |
| `link` | number | 0 to 100 (%) | `100` |
| `lining` | integer | `1` \| `2` \| `4` \| `8` \| `16` | `4` |
| `seal` | boolean | — | `false` |
| `sat` | number | 0 to 100 (%) | `0` |
| `ms` | boolean | — | `false` |
| `msMid` | number | −12 to 12 (dB) | `0` |
| `msSide` | number | −12 to 12 (dB) | `0` |
| `dc` | boolean | — | `true` |
| `unity` | boolean | — | `false` |
| `dust` | string | `off` \| `flat` \| `shaped` | `off` |
| `dustBits` | integer | `16` \| `20` \| `24` | `16` |
| `dustSeed` | integer | positive, coerced to uint32 | `1848` |
| `targetLufs` | number | −30 to −5 (LUFS) | `−14` |
| `meta.name` | string | — | `"Fresh Arrangement"` |
| `meta.note` | string | — | `""` |

Every numeric field is read with `+s.field` (coerced to a number) and
checked with `isFinite`, never `truthy`-checked with `||` — that distinction
matters because several legal values here are `0` (`bypass`'s numeric
cousins, `sat` at its minimum, `msMid`/`msSide` at unity), and `0 || fallback`
would silently replace every one of them. This is the same rule
`AUDIO_INTERCHANGE.md` documents for the whole estate; `casket_coverage.js`
checks that it's actually followed here, not just claimed.

---

## 3. What the loader corrects rather than rejects

A hand-edited or partially garbled file does not fail to load. Every field
degrades independently to the table above — a typo in `dust` doesn't take
`drive` down with it. Two corrections are worth knowing by name because
they're not simple clamps:

- **Sealed at 1× lining is corrected to 2×.** `seal: true` with
  `lining: 1` isn't a smaller version of sealed mode — there's no
  oversampled domain for the gain product to exist in, so it aliases
  exactly as the unsealed path would while still paying the decimator's
  rolloff. Measured at +7.2 dB overshoot, driving the safety clamp to 62%
  — i.e. it clips (`casket_core.js`, next to the correction itself).
  `casket_test.js` asserts the correction directly: sealed at 1× loads as
  2×, unsealed at 1× is left alone. The loader treats this combination as a
  contradiction to fix, not a setting to honour.
- **An unrecognised `style` becomes `velvet`,** CASKET's own stated default
  arrangement — not `pine`, not whatever the enum's first entry happens to
  be. If you're generating case files programmatically and the style name
  has a typo, this is the value you'll get back.

Neither correction is silent in the sense of being hidden — both live in
`sanitizeState()`, in plain sight, and `casket_test.js` asserts the sealed/1×
case specifically. "Silent" here just means: the file still loads, with
opinions, instead of refusing to.

---

## 4. Picking a style vs. loading a case file

These look similar and neither one is what loading a bare `{"style": ...}`
case file does — worth being precise here, because the UI actually has
*two* different "apply a style" mechanisms, and a case file's `style`
field triggers neither of them.

- **The style rack (keys 1–5, `pickStyle`)** overlays exactly the fields
  under `d` in `casket_core.js`'s `STYLE` table — `vigil`, `release`,
  `knee`, `lining`, `margin`, `autoRel`, `sat`, `seal` — onto whatever else
  the state currently holds, and sets `style`. It does **not** touch
  `meta`, `drive`, `lid`, or anything outside that field list. Picking
  **Iron** sets `sat: 60` as a starting point, not a floor — every one of
  those fields is freely overridable afterwards.
- **The factory-preset dropdown (`UIH.FACTORY`)** is a different, smaller
  set of six hand-tuned, named presets — not a mechanical reading of the
  `STYLE` table. "Sealed for Delivery" (styled `lead`) sets `lining: 16`,
  not `STYLE.lead.d.lining`'s `4`. It also resets `meta` to the preset's
  own name and note, which `pickStyle` never does. §3's sealed/1× and
  lead/seal notes both apply here too — a factory preset goes through
  `sanitizeState()` exactly like a loaded file does, no special-cased path.

**A case file triggers neither.** Loading one calls `sanitizeState()`
directly on the parsed JSON — never `pickStyle`, never the FACTORY table.
Its `style` field is validated as a legal name and nothing more; no
matching defaults get cascaded in from `STYLE[style].d`. Two arrangements
both saved as `style: "iron"` can differ in every other field, and a file
that sets only `style` will NOT pick up that style's characteristic
`vigil`/`release`/`seal`/etc. — see §6. `style` here is closer to "which
section of `MASTERING_WITH_CASKET.md` this was tuned against" than a live
link back to a template.

---

## 5. `version`, honestly

`defaultState()` sets `version: 1`. `sanitizeState()` reads every other
field from the incoming file and **never reads or branches on
`s.version`** — today, every case file is sanitised the same way regardless
of what its own `version` claims. The field exists for the day the shape
above needs to change in a way `sanitizeState()`'s per-field fallbacks
can't absorb on their own (a renamed field, a changed unit, a control that
splits into two) — at which point something will need to read `s.version`
and branch. That day hasn't come. Writing this down here rather than
implying otherwise: **`version` is a placeholder for migration logic that
does not exist yet**, not a claim that migration is already handled.

---

## 6. A minimal file

Every field is optional on load — `sanitizeState()` fills in anything
missing from the table in §2. This is a complete, valid case file:

```json
{
  "style": "lead",
  "drive": 6,
  "meta": { "name": "Hot and Sealed" }
}
```

This is the sharpest version of §4's point, confirmed by actually running
it through `sanitizeState()` rather than assumed: it does **not** produce
Lead's characteristic sound. `style` comes back `"lead"` and `drive` comes
back `6` as written, but `seal` comes back **`false`** — Lead's one
structural, guarantee-changing trait — along with `vigil: 2`, `release:
150`, `knee: 0`, `margin: 0`, `lining: 4`, `autoRel: false`: the plain
`defaultState()` baseline for every field this file didn't mention, because
`style` doesn't retroactively populate the fields the rack or the dropdown
would have. What you get is an arrangement labelled `lead` that behaves
like an unsealed, un-tuned one wearing that label. A case file is a flat
record, not a style reference — see §4 above. If you want "Lead, properly
sealed" from a minimal file, say so: add `seal: true` (and, if it matters
to you, the rest of `STYLE.lead.d` from §2) rather than relying on `style`
to imply them.

---

## 7. A full file, as actually saved

This is the shape `casket.html`'s **Save** button writes — every field in
§2, present and explicit, exactly as `JSON.stringify(state, null, 2)`
produces it:

```json
{
  "version": 1,
  "bypass": false,
  "style": "velvet",
  "drive": 3.5,
  "lid": -1,
  "margin": 0,
  "vigil": 2,
  "release": 150,
  "autoRel": true,
  "knee": 3,
  "hold": 0,
  "link": 100,
  "lining": 4,
  "seal": false,
  "sat": 0,
  "ms": false,
  "msMid": 0,
  "msSide": 0,
  "dc": true,
  "unity": false,
  "dust": "off",
  "dustBits": 16,
  "dustSeed": 1848,
  "targetLufs": -14,
  "meta": { "name": "Fresh Arrangement", "note": "" }
}
```

---

## 8. Hand-editing is a supported use, not a workaround

Because loading always goes through `sanitizeState()`, editing a `.casket.json`
in a text editor is exactly as safe as editing it in the UI — there is no
separate, less-defended code path for files that didn't come from CASKET's
own Save button. That makes the format a reasonable thing to generate from
a script (batch-creating variations of one arrangement, for instance) as
long as the generator sticks to the field names and value shapes in §2.

---

## 9. The same object also travels in a URL

The **Share** button encodes the live state into the page's URL hash, and
opening a link with a hash loads it back. That is not a second format — it is
this one, `JSON.stringify`'d and `encodeURIComponent`'d:

```js
encodeArrangement: function (s) { return encodeURIComponent(JSON.stringify(s)); },
decodeArrangement: function (h) {
  try { return JSON.parse(decodeURIComponent(h)); } catch (e) { return null; }
}
```

So everything in §2 applies unchanged to a shared link, and the same
corrections in §3 happen on the way in — the boot path decodes the hash and
then hands the result to `sanitizeState()` exactly as the file loader does. A
mangled hash decodes to `null` rather than throwing, and the arrangement is
simply left at its default.

Two practical consequences:

- **A share link is as hand-editable as the file**, with the same safety, and
  round-trips through the sanitiser — `casket_ui_test.js` asserts the round
  trip preserves style, lid, lining and sat exactly.
- **A link carries no audio and no `meta` guarantees beyond what you set** — it
  is the knob positions and nothing else, same as the file. Sending someone a
  link reproduces your *settings*, not your session.
