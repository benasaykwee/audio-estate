/* AUTOPSY — PluginProcessor.h
   Static parameter layout: 12 bands x 12 params + output gain/pan = 146
   (on/type/freq/gain/q/slope/place + dyn on/range/thresh/att/rel).
   Hosts cannot grow a parameter list after instantiation, so all 12
   slots exist up front; disabled bands cost nothing in the engine. */
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "AutopsyCore.h"

class AutopsyProcessor : public juce::AudioProcessor {
public:
    AutopsyProcessor();
    ~AutopsyProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "AUTOPSY"; }
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

    /* snapshot of the APVTS as a core State — used by both the audio
       thread (per block) and the editor (curve drawing), mirroring the
       browser's single magnitudeAt() source of truth. */
    autopsy::State buildState() const;
    double currentSampleRate() const { return sr; }

    juce::AudioProcessorValueTreeState apvts;

private:
    static juce::AudioProcessorValueTreeState::ParameterLayout createLayout();

    std::unique_ptr<autopsy::Engine> engine;
    double sr = 48000.0;

    /* cached raw parameter pointers, fetched once in the ctor */
    struct BandParams {
        std::atomic<float>* on;
        std::atomic<float>* type;
        std::atomic<float>* freq;
        std::atomic<float>* gain;
        std::atomic<float>* q;
        std::atomic<float>* slope;
        std::atomic<float>* place;
        std::atomic<float>* dynOn;
        std::atomic<float>* dynRange;
        std::atomic<float>* dynThresh;
        std::atomic<float>* dynAtt;
        std::atomic<float>* dynRel;
    };
    BandParams bandParams[autopsy::MAX_BANDS] = {};
    std::atomic<float>* outGainParam = nullptr;
    std::atomic<float>* outPanParam = nullptr;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(AutopsyProcessor)
};
