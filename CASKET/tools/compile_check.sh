#!/usr/bin/env bash
# CASKET — compile the plugin translation units against real JUCE headers.
#   bash tools/compile_check.sh [/path/to/JUCE/modules]
#
# ADDED 2026-08-18, after PALLBEARER proved the shape out (its
# tools/compile_check.sh is the pattern; this is CASKET's own copy of the
# idea, not a shared tool — the DEFS below are CASKET's plugin identity and
# would be wrong for any sibling).
#
# WHAT THIS IS. A fast, cheap proof that PluginProcessor.cpp and
# PluginEditor.cpp are sound C++ against the JUCE version CI pins (7.0.12).
# It runs on any platform in seconds and catches the whole class of
# first-build failure — missing includes, wrong signatures, API that moved
# between JUCE versions. Until today, ANY change to CASKET's plugin sources
# shipped unverified from this sandbox and waited for macOS CI to find out.
#
# WHAT THIS IS NOT. It does not link, and it cannot produce an AU: Audio
# Unit is a macOS format requiring Apple frameworks. A green run here means
# the code compiles; it does not mean the plugin loads. Only a host says that.
#
# JUCE DISCOVERY, in order:
#   1. an explicit argument:            bash tools/compile_check.sh ~/JUCE/modules
#   2. $JUCE_MODULES if set
#   3. /tmp/juce-7.0.12/modules        (this script will clone it there if absent
#                                       — /tmp on purpose, so a checkout never
#                                       lands inside the repo or Ben's folder)
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HERE/casket-juce/Source"
OUT="$HERE/build"
mkdir -p "$OUT"

J="${1:-${JUCE_MODULES:-}}"
if [ -z "$J" ]; then
  CACHE="/tmp/juce-7.0.12"
  if [ ! -d "$CACHE/modules/juce_audio_processors" ]; then
    echo "fetching JUCE 7.0.12 (shallow) into $CACHE …"
    git clone --depth 1 --branch 7.0.12 https://github.com/juce-framework/JUCE "$CACHE" 2>&1 | tail -1
  fi
  J="$CACHE/modules"
fi
if [ ! -d "$J/juce_audio_processors" ]; then
  echo "no JUCE modules at '$J' — pass the path or set \$JUCE_MODULES" >&2
  exit 2
fi

# CASKET's plugin identity — an EFFECT, stereo/mono, no MIDI. These mirror
# casket-juce/CMakeLists.txt; if that file changes its identity, change this.
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
fail=0
for tu in PluginProcessor PluginEditor; do
  printf '  %-20s' "$tu.cpp"
  if g++ -std=c++17 -c -O2 -ffp-contract=off "${DEFS[@]}" \
       -I"$J" -I"$SRC" -o "$OUT/${tu}.o" "$SRC/$tu.cpp" 2> "$OUT/${tu}.log"; then
    echo "compiled  ($(wc -c < "$OUT/${tu}.o") bytes of object code)"
  else
    echo "FAILED"
    grep -E "error" "$OUT/${tu}.log" | head -15
    fail=1
  fi
done

if [ "$fail" = 0 ]; then
  echo "both translation units compile against JUCE 7.0.12."
else
  echo "the plugin would not survive its own build. fix before pushing." >&2
fi
exit $fail
