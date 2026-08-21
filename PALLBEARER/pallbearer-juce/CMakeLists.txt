# PALLBEARER — JUCE plugin build (compile-first: full builds happen on CI runners)
cmake_minimum_required(VERSION 3.22)
project(PALLBEARER VERSION 0.3.0)

include(FetchContent)
FetchContent_Declare(JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 7.0.12
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(JUCE)

# IS_SYNTH TRUE and NEEDS_MIDI_INPUT TRUE — this is the estate's first
# instrument rather than an effect, so the plugin category, the bus layout
# and the MIDI plumbing all differ from AUTOPSY, RIGOR and CASKET.
juce_add_plugin(Pallbearer
  COMPANY_NAME "Ben Asaykwee"
  BUNDLE_ID "com.benasaykwee.pallbearer"
  PLUGIN_MANUFACTURER_CODE Basy
  PLUGIN_CODE Pbrr
  FORMATS AU VST3 Standalone
  PRODUCT_NAME "PALLBEARER"
  IS_SYNTH TRUE
  NEEDS_MIDI_INPUT TRUE
  NEEDS_MIDI_OUTPUT FALSE
  IS_MIDI_EFFECT FALSE
  COPY_PLUGIN_AFTER_BUILD FALSE)

target_sources(Pallbearer PRIVATE
  Source/PluginProcessor.cpp
  Source/PluginEditor.cpp)

target_compile_definitions(Pallbearer PRIVATE
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_VST3_CAN_REPLACE_VST2=0)

target_link_libraries(Pallbearer
  PRIVATE juce::juce_audio_utils
  PUBLIC juce::juce_recommended_config_flags
         juce::juce_recommended_lto_flags
         juce::juce_recommended_warning_flags)

# PARITY LAW 1: no FMA contraction. The C++ core must round every multiply
# and add separately, exactly as the JS engine does. PALLBEARER is the
# strictest case in the estate so far — a waveguide feeds its own output
# back through a fractional-delay allpass, four dispersion stages and a
# damping pole every single sample, so one fused rounding does not stay
# small. Measured on this project: without the flag, 8,693 of 13,335 parity
# checks fail and the worst error reaches 14,301,684 ulp.
if (NOT MSVC)
  target_compile_options(Pallbearer PRIVATE -ffp-contract=off)
endif()
