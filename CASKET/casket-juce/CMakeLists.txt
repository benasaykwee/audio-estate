# CASKET — JUCE plugin build (compile-first: full builds happen on CI runners)
cmake_minimum_required(VERSION 3.22)
project(CASKET VERSION 0.1.0)

include(FetchContent)
FetchContent_Declare(JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 7.0.12
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(JUCE)

juce_add_plugin(Casket
  COMPANY_NAME "Ben Asaykwee"
  PLUGIN_MANUFACTURER_CODE Basy
  PLUGIN_CODE Cskt
  FORMATS AU VST3 Standalone
  PRODUCT_NAME "CASKET"
  IS_SYNTH FALSE
  NEEDS_MIDI_INPUT FALSE
  NEEDS_MIDI_OUTPUT FALSE
  IS_MIDI_EFFECT FALSE
  COPY_PLUGIN_AFTER_BUILD FALSE)

target_sources(Casket PRIVATE
  Source/PluginProcessor.cpp
  Source/PluginEditor.cpp)

target_compile_definitions(Casket PRIVATE
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_VST3_CAN_REPLACE_VST2=0)

target_link_libraries(Casket
  PRIVATE juce::juce_audio_utils
  PUBLIC juce::juce_recommended_config_flags
         juce::juce_recommended_lto_flags
         juce::juce_recommended_warning_flags)

# PARITY LAW: no FMA contraction. The C++ core must round every multiply
# and add separately, exactly like the JS engine does. This is not
# belt-and-braces — compiling the parity gate without it produces 8,351
# mismatches out of 11,164, the worst at 9,805 ulp. The polyphase inner
# loop is a long multiply-accumulate chain, which is precisely the shape
# GCC most wants to fuse.
if (NOT MSVC)
  target_compile_options(Casket PRIVATE -ffp-contract=off)
  # AND at link time. This target links juce_recommended_lto_flags, so the
  # real codegen happens during the link, not the compile. A compile-only
  # flag would be a law enforced on an intermediate the user never runs.
  target_link_options(Casket PRIVATE -ffp-contract=off)
endif()

# The parity gate itself — no JUCE needed, so it builds anywhere.
add_executable(casket_parity ${CMAKE_CURRENT_SOURCE_DIR}/../tests/core_parity.cpp)
set_target_properties(casket_parity PROPERTIES CXX_STANDARD 17)
if (NOT MSVC)
  target_compile_options(casket_parity PRIVATE -ffp-contract=off)
endif()

# ---------------------------------------------------------------------------
# The SAME gate, built with the plugin's exact flag set — LTO included.
#
# Why this target exists. `casket_parity` above proves bit-exactness for a
# binary nobody ships: no LTO, and until 2026-08-16 no link-time contraction
# flag either. The plugin links juce_recommended_lto_flags, so its arithmetic
# is generated at link time under a different flag set from the one the gate
# was measuring. That made the parity law the only claim in this project
# asserted rather than measured.
#
# Measured 2026-08-16 on GCC/Linux before adding this: `-O2 -flto
# -ffp-contract=off` passes all 22,861 checks, and the control `-O2 -flto`
# with no flag BREAKS parity — worst case quantize(-0.05, 0.1), which is the
# negative exact half that §7 of the interchange already records as the place
# the two spellings of rounding diverge. So LTO is survivable, the flag is
# what makes it survivable, and the test is capable of going red. The shipping
# plugin is built by Clang on macOS rather than GCC, which is exactly why this
# runs on CI instead of being taken on trust from one machine.
# ---------------------------------------------------------------------------
add_executable(casket_parity_lto ${CMAKE_CURRENT_SOURCE_DIR}/../tests/core_parity.cpp)
set_target_properties(casket_parity_lto PROPERTIES CXX_STANDARD 17)
target_link_libraries(casket_parity_lto PRIVATE juce::juce_recommended_lto_flags)
if (NOT MSVC)
  target_compile_options(casket_parity_lto PRIVATE -ffp-contract=off)
  target_link_options(casket_parity_lto PRIVATE -ffp-contract=off)
endif()
