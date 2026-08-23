#!/usr/bin/env bash
# CASKET — compile the plugin translation units against real JUCE headers.
#   bash tools/compile_check.sh [/path/to/JUCE/modules]
#
# ADDED 2026-08-18, after PALLBEARER proved the shape out (its
# tools/compile_check.sh is the pattern; this is CASKET's own copy of the
# idea, not a shared tool — the DEFS below are CASKET's plugin identity and
# would be wrong for any sibling).
#
# HARDENED 2026-08-22 against _HANDOFF/PLUGIN_BUILD_RECIPE.md §2, which lists
# four load-bearing properties of a gate like this. Three were missing here:
#
#   1. DERIVE the pin, never restate it. This script used to say "7.0.12" in
#      four places and carried a comment telling a human to update them by
#      hand. That is the same lie as an assertion naming its own expected
#      value: when CMakeLists moves the pin, a hardcoded gate quietly checks
#      headers the runners will never see and reports success. The tag is now
#      read out of casket-juce/CMakeLists.txt, which is where the build gets
#      it from too.
#   2. REFUSE on a pin mismatch. It used to accept any directory containing
#      juce_audio_processors — including a JUCE 8 checkout, or a stale /tmp
#      clone from a different tag, or whatever $JUCE_MODULES happened to point
#      at. Checking against the wrong JUCE is worse than not checking, because
#      it produces a green nobody questions. It now reads JUCE's own version
#      defines off disk and stops if they disagree with the pin.
#   3. -fmax-errors=50, and print the WHOLE error log. The old budget was the
#      compiler default and the output was piped through `head -15`. One error
#      hiding nine is the ordinary case, not the unusual one.
#
# WHAT THIS IS. A fast, cheap proof that PluginProcessor.cpp and
# PluginEditor.cpp are sound C++ against the JUCE version CI pins. It runs on
# any platform in seconds and catches the whole class of first-build failure:
# missing includes, wrong signatures, API that moved between JUCE versions,
# and unqualified names that only resolve inside `namespace juce` (the token
# that cost RIGOR four failed macOS builds).
#
# WHAT THIS CANNOT PROVE — say it out loud, because a green here is a reason
# to push and never a reason to skip reading the CI log:
#   * The sandbox is aarch64 Linux. The runners are x86-64 Linux, ARM macOS
#     and Windows. This checks the compiler's PORTABLE half — name lookup,
#     overload resolution, type checking. It says nothing about codegen.
#   * It does not link, so a missing symbol survives it.
#   * It cannot produce an AU. Audio Unit is a macOS format needing Apple
#     frameworks and Objective-C++ glue that never compiles here.
#   * Floating-point contraction and optimiser behaviour on the real target
#     are out of reach. CASKET currently has an -O3 parity fault that is
#     translation-unit dependent and invisible on this architecture; see
#     _HANDOFF/CASKET_CI_RESOLVED_2026-08-21.md.
#   * A green run does not mean the plugin LOADS. Only a host says that.
#     auval is the real verdict: `auval -v aufx Cskt Basy` on macOS.
#
# JUCE DISCOVERY, in order:
#   1. an explicit argument:            bash tools/compile_check.sh ~/JUCE/modules
#   2. $JUCE_MODULES if set
#   3. /tmp/juce-<TAG>/modules          (cloned there if absent — /tmp on
#                                        purpose, so a checkout never lands
#                                        inside the repo or Ben's folder)
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HERE/casket-juce/Source"
CML="$HERE/casket-juce/CMakeLists.txt"

# --- 1. DERIVE the pin from the file the build itself reads ------------------
if [ ! -f "$CML" ]; then
  echo "cannot find $CML — the pin has no source of truth" >&2
  exit 2
fi
TAG="$(grep -Eo 'GIT_TAG[[:space:]]+[0-9]+\.[0-9]+\.[0-9]+' "$CML" | head -1 | awk '{print $2}')"
if [ -z "$TAG" ]; then
  echo "no 'GIT_TAG <x.y.z>' in $CML — cannot derive the JUCE pin" >&2
  echo "if the build moved to a different mechanism, this gate must follow it" >&2
  exit 2
fi
echo "  pin derived from casket-juce/CMakeLists.txt: JUCE $TAG"

# Objects go to a scratch dir, NOT into the tree. The Cowork sandbox cannot
# delete files it creates under CLAUDE/, so anything written there is
# permanent litter even when it is gitignored.
OUT="$(mktemp -d "${TMPDIR:-/tmp}/casket-compile-check.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

J="${1:-${JUCE_MODULES:-}}"
if [ -z "$J" ]; then
  CACHE="/tmp/juce-$TAG"
  if [ ! -d "$CACHE/modules/juce_audio_processors" ]; then
    echo "  fetching JUCE $TAG (shallow) into $CACHE …"
    git clone --depth 1 --branch "$TAG" \
      https://github.com/juce-framework/JUCE "$CACHE" 2>&1 | tail -1
  fi
  J="$CACHE/modules"
fi
if [ ! -d "$J/juce_audio_processors" ]; then
  echo "no JUCE modules at '$J' — pass the path or set \$JUCE_MODULES" >&2
  exit 2
fi

# --- 2. REFUSE if the headers on disk are not the pinned version -------------
# JUCE states its own version in juce_StandardHeader.h. Read it rather than
# trusting the directory name: /tmp/juce-7.0.12 can perfectly well contain a
# checkout of something else, and $JUCE_MODULES can point anywhere.
STDH="$J/juce_core/system/juce_StandardHeader.h"
if [ ! -f "$STDH" ]; then
  echo "cannot read $STDH — refusing to check against an unidentifiable JUCE" >&2
  exit 2
fi
# `tr -d '\r'` is NOT optional. JUCE ships juce_StandardHeader.h with CRLF
# line endings, so awk's $3 comes back as "7\r" and every comparison below
# fails against a plain "7" — the gate then refuses every run while printing
# two strings that look identical on screen. Caught by running the control
# before trusting it, which is the whole reason the recipe says to.
ver() { grep -E "^#define $1" "$STDH" | head -1 | awk '{print $3}' | tr -d '\r'; }
ON_DISK="$(ver JUCE_MAJOR_VERSION).$(ver JUCE_MINOR_VERSION).$(ver JUCE_BUILDNUMBER)"
if [ "$ON_DISK" != "$TAG" ]; then
  echo "" >&2
  echo "  REFUSING TO RUN: JUCE version mismatch" >&2
  echo "    CMakeLists pins : $TAG" >&2
  echo "    headers at '$J' : $ON_DISK" >&2
  echo "" >&2
  echo "  Checking against the wrong JUCE is worse than not checking — it" >&2
  echo "  produces a green that nobody questions. Point \$JUCE_MODULES at a" >&2
  echo "  $TAG checkout, or delete the stale clone and let this script fetch." >&2
  exit 2
fi
echo "  headers on disk report JUCE $ON_DISK — matches the pin"

# CASKET's plugin identity — an EFFECT, stereo/mono, no MIDI. These mirror
# casket-juce/CMakeLists.txt. Its auval identity is `aufx Cskt Basy`.
DEFS=(
  -DJUCE_MODULE_AVAILABLE_juce_core=1
  -DJUCE_MODULE_AVAILABLE_juce_events=1
  -DJUCE_MODULE_AVAILABLE_juce_audio_basics=1
  -DJUCE_MODULE_AVAILABLE_juce_audio_processors=1
  -DJUCE_MODULE_AVAILABLE_juce_audio_devices=1
  -DJUCE_MODULE_AVAILABLE_juce_audio_formats=1
  -DJUCE_MODULE_AVAILABLE_juce_audio_utils=1
  -DJUCE_MODULE_AVAILABLE_juce_graphics=1
  -DJUCE_MODULE_AVAILABLE_juce_gui_basics=1
  -DJUCE_MODULE_AVAILABLE_juce_gui_extra=1
  -DJUCE_MODULE_AVAILABLE_juce_data_structures=1
  -DJUCE_STANDALONE_APPLICATION=0
  -DJUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1
  -DJUCE_WEB_BROWSER=0 -DJUCE_USE_CURL=0 -DJUCE_DISPLAY_SPLASH_SCREEN=0
  -DJucePlugin_Name='"CASKET"'
  -DJucePlugin_IsSynth=0
  -DJucePlugin_WantsMidiInput=0
  -DJucePlugin_ProducesMidiOutput=0
  -DJucePlugin_IsMidiEffect=0
)

# LAW 1 here too. Compiling the check without -ffp-contract=off would be
# checking a different program from the one the build produces.
#
# -c rather than -fsyntax-only is deliberate and is MORE than the recipe asks
# for: it runs the back end as well, so it also catches anything that only
# fails at instantiation or codegen time on this architecture.
#
# --- 3. a real error budget, and the whole log ------------------------------
fail=0
for tu in PluginProcessor PluginEditor; do
  printf '  %-20s' "$tu.cpp"
  if g++ -std=c++17 -c -O2 -ffp-contract=off -fmax-errors=50 "${DEFS[@]}" \
       -I"$J" -I"$SRC" -o "$OUT/${tu}.o" "$SRC/$tu.cpp" 2> "$OUT/${tu}.log"; then
    echo "compiled  ($(wc -c < "$OUT/${tu}.o") bytes of object code)"
  else
    echo "FAILED"
    echo "  ---- every error from $tu.cpp, not the first few ----"
    grep -E "error:" "$OUT/${tu}.log" || cat "$OUT/${tu}.log"
    echo "  ---- $(grep -c "error:" "$OUT/${tu}.log" || echo 0) error(s) ----"
    fail=1
  fi
done

if [ "$fail" = 0 ]; then
  echo "both translation units compile against JUCE $TAG on $(uname -m)."
  echo "that is the portable half of the compiler agreeing. it is not a build,"
  echo "not a link, and not a load — read the CI log anyway."
else
  echo "the plugin would not survive its own build. fix before pushing." >&2
fi
exit $fail
