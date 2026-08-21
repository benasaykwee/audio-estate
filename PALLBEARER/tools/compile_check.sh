#!/usr/bin/env bash
# PALLBEARER — compile the plugin translation units against real JUCE headers.
#   bash tools/compile_check.sh /path/to/JUCE/modules
#
# WHAT THIS IS. A fast, cheap proof that PluginProcessor.cpp and
# PluginEditor.cpp are sound C++ against the JUCE version CI pins. It runs on
# any platform in seconds and catches the whole class of first-build failure —
# missing includes, wrong signatures, API that moved between JUCE versions.
#
# WHAT THIS IS NOT. It does not link, and it cannot produce an AU: Audio Unit
# is a macOS format requiring Apple frameworks. A green run here means the
# code compiles; it does not mean the plugin loads. Only a macOS build says that.
set -euo pipefail

J="${1:-}"
if [ -z "$J" ] || [ ! -d "$J/juce_audio_processors" ]; then
  echo "usage: bash tools/compile_check.sh /path/to/JUCE/modules" >&2
  exit 2
fi

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HERE/pallbearer-juce/Source"
OUT="$HERE/build"
mkdir -p "$OUT"

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
  -DJucePlugin_Name='"PALLBEARER"'
  -DJucePlugin_IsSynth=1
  -DJucePlugin_WantsMidiInput=1
  -DJucePlugin_ProducesMidiOutput=0
  -DJucePlugin_IsMidiEffect=0
)

# LAW 1 here too. Compiling the check without it would be checking a
# different program from the one the build produces.
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

if [ "$fail" -ne 0 ]; then
  echo "✗ the plugin sources do not compile against this JUCE."
  exit 1
fi
echo "✓ both translation units compile. This does NOT prove the plugin loads —"
echo "  only a macOS build produces an AU, and only a host proves it runs."
