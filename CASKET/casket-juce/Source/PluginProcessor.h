/* CASKET — PluginProcessor.h
   Eighteen parameters. AUTOPSY needed 146; a limiter is a knob and a
   promise.
   Two things here are not boilerplate:
     - latency is reported from the SAME pure function the browser and the
       parity gate use, so the host, the harness and the instrument can
       never disagree about it;
     - vigil, lining and style are STRUCTURAL. Changing them reallocates
       the gain path and moves the reported latency, so they are handled
       off the audio thread rather than per block. */
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "CasketCore.h"

class CasketProcessor : public juce::AudioProcessor {
public:
    CasketProcessor();
    ~CasketProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "CASKET"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    casket::State buildState() const;
    double currentSampleRate() const { return sr; }
    void latestMeters(casket::Meters& m) { engine.meters(m); }
    void latestTrace(casket::Trace& t) { engine.trace(t); }
    void resetMeters() { engine.resetMeters(); }

    juce::AudioProcessorValueTreeState apvts;

private:
    static juce::AudioProcessorValueTreeState::ParameterLayout layout();
    void refreshLatency();

    /* The largest run of samples we ever hand the engine in one call.
       Anything longer is chunked. 8192 is comfortably above every host
       block size in practice while keeping the scratch under 256 kB. */
    static const int MAX_CHUNK = 8192;

    casket::Engine engine;
    double sr = 48000;
    int lastLatency = 0;
    /* scratch doubles — the core is double throughout and JUCE hands us
       floats; converting per block keeps the DSP identical to the JS */
    std::vector<double> dL, dR, oL, oR;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(CasketProcessor)
};
