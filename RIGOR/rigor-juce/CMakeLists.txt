# RIGOR — JUCE plugin build (compile-first: full builds happen on CI runners)
cmake_minimum_required(VERSION 3.22)
project(RIGOR VERSION 0.1.0)

include(FetchContent)
FetchContent_Declare(JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 7.0.12
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(JUCE)

juce_add_plugin(Rigor
  COMPANY_NAME "Ben Asaykwee"
  BUNDLE_ID "com.benasaykwee.rigor"
  PLUGIN_MANUFACTURER_CODE Basy
  PLUGIN_CODE Rgor
  FORMATS AU VST3 Standalone
  PRODUCT_NAME "RIGOR"
  IS_SYNTH FALSE
  NEEDS_MIDI_INPUT FALSE
  NEEDS_MIDI_OUTPUT FALSE
  IS_MIDI_EFFECT FALSE
  COPY_PLUGIN_AFTER_BUILD FALSE)

target_sources(Rigor PRIVATE
  Source/PluginProcessor.cpp
  Source/PluginEditor.cpp)

target_compile_definitions(Rigor PRIVATE
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_VST3_CAN_REPLACE_VST2=0)

target_link_libraries(Rigor
  PRIVATE juce::juce_audio_utils juce::juce_dsp
  PUBLIC juce::juce_recommended_config_flags
         juce::juce_recommended_lto_flags
         juce::juce_recommended_warning_flags)

# PARITY LAW: no FMA contraction. The C++ core must round every
# multiply and add separately, exactly like the JS engine does.
# RIGOR is stricter about this than AUTOPSY was: the Settling topology
# feeds each sample's gain back into the next sample's detector, so a
# single fused rounding compounds through a nonlinear gain computer.
if (NOT MSVC)
  target_compile_options(Rigor PRIVATE -ffp-contract=off)
endif()
