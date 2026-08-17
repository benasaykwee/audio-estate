# underworld/cpp — the host path

A self-contained C++ port of the Underworld translator, for the eventual **hosting** plugin
(the recommended answer to `UNDERWORLD_INTERCHANGE.md` §9.1). It links **no trilogy code** —
LAW 0 holds in C++ exactly as in JS: this computes the *settings*, a host drives the real
cores.

## What's here
| File | Role |
|---|---|
| `translator.h` | `MasteringSettings` → `ChainPreset`. The whole mapping (EQ shelves + 10-band match + DynEq + M/S, RIGOR 3-band, CASKET ceiling/drive/width), byte-exact with the JS where the arithmetic is pure. |
| `presets.h` | delivery / genre tables + `describe()`. |
| `serialize.h` | `toPresetJson()` — the `underworld.chain` §2 document, `%.17g` for value parity. |
| `host.h` | **`ICore`** (the host implements it to wrap AUTOPSY/RIGOR/CASKET) + **`Chain`** (drives the three in order, sums latency once, §6). |
| `calibrate.h` | `calibrateDrive()` — the loudness loop with the **0.1 dB grid + discrete exit** (LAW 5; pre-empts CASKET's autoDrive −O3 bug), measure-callback driven so it needs no cores. |
| `main.cpp` | flags → preset JSON on stdout. |
| `test.cpp` | 20 unit tests. |

## How a host consumes it
1. Implement `ICore` three times, each wrapping a real trilogy core (`setState` takes the
   slab JSON this library emits; `process` runs the core; `latencySamples` reports its delay).
2. Build a `ChainPreset` from `MasteringSettings` via `toChainPreset()`; `Chain::applyPreset()`
   pushes each slab into the matching core.
3. Drive audio with `Chain::process()`; report `Chain::latencySamples()` to the host once.
4. Hit a target loudness with `calibrateDrive()`, passing a lambda that renders at a drive and
   returns the achieved LUFS.

## Build & test
```bash
cmake -S underworld/cpp -B build && cmake --build build && ctest --test-dir build
# or directly:
c++ -std=c++17 -ffp-contract=off underworld/cpp/test.cpp -o /tmp/uw_test && /tmp/uw_test
```

## Two rules that travel with the header
- **`-ffp-contract=off`** on every translation unit (§4 LAW 1). The CMake sets it.
- **Byte-exact parity has a ceiling.** Pure arithmetic (thresholds, ratios, gains) is bit-exact
  with the JS; transcendental-derived values (log-spaced freqs, `msSide` via `log10`) agree to
  within a ULP. Closing that last ULP would mean using `necromath`, and **`shared/` must not be
  forked** — so the parity harness (`../parity.test.js`) asserts exact where it can and a ULP
  where it can't, on purpose.
