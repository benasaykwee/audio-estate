#!/usr/bin/env bash
# RIGOR — JUCE front-end syntax gate.
#
# WHY THIS EXISTS
# ---------------
# `rigor_plugin_test.js` opens by saying "there is no JUCE in the sandbox, so
# the first real build happens on CI". That sentence was true when it was
# written and it is what made 2026-08-22 possible: a one-token error,
# `(juce_wchar)` for `juce::juce_wchar`, sat in PluginEditor.cpp through a
# green suite and cost RIGOR the first compiled binary in the estate.
#
# JUCE is a git clone away and the C++ FRONT END runs perfectly well here.
# Name lookup, overload resolution and type checking are the compiler's
# portable half, and that is exactly the half that broke. So this closes the
# gap the lint was invented to paper over.
#
# WHAT IT CANNOT TELL YOU
# -----------------------
# This sandbox is aarch64 Linux. Anything green here is an ARM result and
# CANNOT speak for the macOS runners. It proves the sources PARSE and NAME
# things that exist. It says nothing about codegen, linking, Objective-C++
# glue, AU wrappers, or floating-point contraction. A green run here is a
# reason to push, never a reason to skip reading the CI log.
#
# Usage:  bash tests/rigor_juce_syntax.sh
#         JUCE_DIR=/path/to/JUCE bash tests/rigor_juce_syntax.sh
set -uo pipefail

cd "$(dirname "$0")/.."
CMAKE=rigor-juce/CMakeLists.txt

# DERIVED, not restated. If the pin in CMake moves and this file names an
# older tag, the gate quietly checks against headers the runners will never
# see — which is the same species of lie as an assertion that names its own
# expected value.
TAG=$(sed -n 's/.*GIT_TAG[[:space:]]\+\([^[:space:]]*\).*/\1/p' "$CMAKE" | head -1)
if [ -z "$TAG" ]; then
  echo "FAIL: could not read GIT_TAG from $CMAKE — refusing to guess a JUCE version."
  exit 3
fi
echo "JUCE tag pinned in CMake: $TAG"

JUCE_DIR="${JUCE_DIR:-/tmp/juce-$TAG}"
if [ ! -f "$JUCE_DIR/modules/juce_core/juce_core.h" ]; then
  echo "Fetching JUCE $TAG into $JUCE_DIR ..."
  rm -rf "$JUCE_DIR"
  git clone --depth 1 --branch "$TAG" https://github.com/juce-framework/JUCE.git \
      "$JUCE_DIR" >/dev/null 2>&1 || {
    echo "SKIP: could not fetch JUCE $TAG (no network?). This gate is advisory;"
    echo "      the lint and the CI build still stand."
    exit 0
  }
fi

# Confirm the headers on disk really are the pinned version rather than
# whatever a previous run happened to leave in /tmp.
HAVE=$(sed -n 's/^[[:space:]]*version:[[:space:]]*\(.*\)$/\1/p' \
       "$JUCE_DIR/modules/juce_core/juce_core.h" | head -1 | tr -d ' \r')
if [ "$HAVE" != "$TAG" ]; then
  echo "FAIL: $JUCE_DIR contains JUCE '$HAVE' but CMake pins '$TAG'."
  echo "      Checking against the wrong headers is worse than not checking."
  exit 3
fi
echo "JUCE headers on disk: $HAVE  ✓ matches the pin"

DEFS=(
  -DJUCE_MODULE_AVAILABLE_juce_core=1 -DJUCE_MODULE_AVAILABLE_juce_events=1
  -DJUCE_MODULE_AVAILABLE_juce_graphics=1 -DJUCE_MODULE_AVAILABLE_juce_data_structures=1
  -DJUCE_MODULE_AVAILABLE_juce_gui_basics=1 -DJUCE_MODULE_AVAILABLE_juce_gui_extra=1
  -DJUCE_MODULE_AVAILABLE_juce_audio_basics=1 -DJUCE_MODULE_AVAILABLE_juce_audio_processors=1
  -DJUCE_MODULE_AVAILABLE_juce_audio_formats=1 -DJUCE_MODULE_AVAILABLE_juce_audio_devices=1
  -DJUCE_MODULE_AVAILABLE_juce_audio_utils=1
  -DJUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1 -DJUCE_STANDALONE_APPLICATION=0
  -DJUCE_WEB_BROWSER=0 -DJUCE_USE_CURL=0
  -DJucePlugin_Name=\"Rigor\" -DJucePlugin_Desc=\"Rigor\" -DJucePlugin_IsSynth=0
)

FT=""
[ -d /usr/include/freetype2 ] && FT="-I/usr/include/freetype2"

fails=0
for f in rigor-juce/Source/PluginProcessor.cpp rigor-juce/Source/PluginEditor.cpp; do
  printf '  %-44s' "$f"
  # -fmax-errors well above 1: "a single compile error" was an assumption
  # until someone counted, and one error hiding nine is the ordinary case.
  out=$(g++ -std=c++17 -fsyntax-only -fmax-errors=50 \
        -I"$JUCE_DIR/modules" $FT -Irigor-juce/Source \
        "${DEFS[@]}" "$f" 2>&1)
  n=$(printf '%s' "$out" | grep -c 'error:')
  if [ "$n" -eq 0 ]; then
    echo "clean"
  else
    echo "$n error(s)"
    printf '%s\n' "$out" | grep -A3 'error:' | sed 's/^/      /'
    fails=$((fails + n))
  fi
done

echo
if [ "$fails" -ne 0 ]; then
  echo "JUCE SYNTAX GATE: $fails error(s). The macOS build will fail on these."
  exit 1
fi
echo "JUCE syntax gate: both translation units parse against JUCE $TAG."
echo "  (aarch64 Linux front end only — not a substitute for reading the CI log.)"
exit 0
