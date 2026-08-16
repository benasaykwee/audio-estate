# underworld/

The Underworld's own code — Masterbox's brain auto-driving the AUTOPSY/RIGOR/CASKET
trilogy. This directory is the **consumer** side; it drives the trilogy cores' public API
and never touches their source.

**Governance (do not restate here — cite):**
- `../UNDERWORLD_CHARTER.md` — **LAW 0**: connect at the preset+signal boundary only,
  never merge into the sealed cores, one-way (Masterbox consumes the trilogy).
- `../UNDERWORLD_INTERCHANGE.md` — **how**: preset schema (§2), the three translator
  assertions (§3.2), build-flag boundary (§4), Masterbox-side bypass rules (§5), latency
  ownership (§6), write territory (§8).

## Modules
| File | What |
|---|---|
| `translate.js` | The translator. Masterbox `MasteringSettings` → an `underworld.chain` preset (§2). All three cores mapped — AUTOPSY (tone shelves + 10-band Match-EQ + DynEq→per-band dynamics), RIGOR (3-band comp mirroring Masterbox's formulas), CASKET (ceiling/drive/width). Plus the DELIVERY table and `fromDelivery`. Full vocabulary map with reasons is the header comment. |
| `chain.js` | The orchestrator — renders AUTOPSY→RIGOR→CASKET, compensates each core's latency once, reports the total (§6). Masterbox's own DSP is absent by construction (§5). |
| `calibrate.js` | Drives CASKET to a target LUFS through the real chain (damped passes, Masterbox `learnMaster` shape); records what was achieved in `report`. |
| `explain.js` | `report.explain[]` — every claim carries measured evidence (§3.3). |
| `describe.js` | Plain language ("warm, wide, punchy, lo-fi, club") → settings. |
| `album.js` | Master a set of tracks to one consistent loudness and tone. |
| `preset-io.js` | Read/write `.underworld.chain` — sanitise slabs on read (§2.1), preserve unknown fields (§2.3). |
| `meter-reconcile.js` | Surfaces when two BS.1770 meters disagree, never silently picks one (§9.3). |
| `wav.js` + `cli.js` | Offline CLI: a WAV in → mastered WAV + preset + report. |
| `spike.js` | The original contract proof (kept as a smoke test). |
| `*.test.js` | 99 assertions, every check paired with a control that proves it bites. |
| `diagnostics/` | Repro scripts for findings (e.g. the CASKET-null knee/dc probe). |

## More modules (second round of solo tasks)
| File | What |
|---|---|
| `chain.js` `calibrate.js` | orchestrator + loudness calibration (grid-quantised exit, LAW 5) |
| `analyze.js` `auto.js` | FFT/log-band spectrum; reference matching, LRA targeting, auto dynamic-EQ |
| `describe.js` | plain-language + genre presets → settings |
| `explain.js` `diff.js` | verified explanations; preset diff |
| `ab.js` `session.js` `album.js` | loudness-matched A/B; re-render/re-tweak; album batch |
| `wav.js` `safety.js` | WAV/AIFF I/O + TPDF dither; final true-peak guard |
| `meter-reconcile.js` | surfaces §9.3 meter divergence |
| `corpus.js` | golden-master corpus |
| `selftest.js` | latency / PDC honesty test |
| `cli.js` `server.js` `app.html` | offline CLI + local web app (drop-a-mix, A/B) |
| `cpp/translator.h` | self-contained C++ port of the mapping for the host path (no trilogy linked) |
| `run-tests.js` | runs the whole suite as one job (173 assertions) |

## Run
```bash
node underworld/cli.js mix.wav --delivery club --comp 0.4     # master a file (CLI)
node underworld/server.js                                      # local web app -> localhost:8799
node underworld/run-tests.js                                   # the whole suite (173 assertions)
```

## Per-core "idle / do nothing" (spike-verified)
- **AUTOPSY** — default state (no bands on) is passthrough.
- **RIGOR** — `bands:1, ratio:1` is unity (`AUDIO_INTERCHANGE.md §4`).
- **CASKET** — lid **above** signal **+ `knee:0` + `dc:false`** (`../UNDERWORLD_INTERCHANGE.md §10`).

## Status
JS prototype against the trilogy's **reference** cores — exploration, not the product. It
masters a real WAV to a delivery target today. The C++/plugin seam is still gated on
interchange **§7** (build after the trilogy's first compile) and **§9.1** (link the cores
vs. host them as plugins) — both Ben's calls.
