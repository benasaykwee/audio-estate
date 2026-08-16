/* RIGOR — PluginProcessor.h
   The processor owns no DSP of its own: it translates parameters into a
   rigor::State and hands it to rigor::Multi, which is the same code the
   browser instrument runs and the same code the parity gate proves. */
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "RigorCore.h"
#include <memory>
#include <vector>
#include <atomic>

class RigorAudioProcessor : public juce::AudioProcessor
{
public:
    RigorAudioProcessor();
    ~RigorAudioProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout&) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "RIGOR"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return "Case"; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock&) override;
    void setStateInformation(const void*, int) override;

    juce::AudioProcessorValueTreeState apvts;
    static juce::AudioProcessorValueTreeState::ParameterLayout createLayout();

    /* the editor draws from these */
    rigor::State currentState() const { return buildState(); }
    float gainReduction() const { return grNow.load(); }
    float bandGr(int i) const { return bGr[(size_t)juce::jlimit(0, rigor::MAX_BANDS - 1, i)].load(); }
    float truePeak() const { return tpPk.load(); }
    float lufsShort() const { return lufsS.load(); }
    float lufsIntegrated() const { return lufsI.load(); }
    float correlation() const { return corr.load(); }
    float inPeak() const { return inPk.load(); }

    /* Case A / B lives in the PROCESSOR, so a comparison survives the
       window being closed — which is the entire point of an A/B. */
    void recallCase(int slot);
    int activeCase() const { return curCase; }

private:
    rigor::State buildState() const;
    std::unique_ptr<rigor::Multi> engine;
    int lastLatency = -1;
    std::vector<double> bL, bR, oL, oR;
    std::atomic<float> grNow{ 0 }, tpPk{ 0 }, lufsS{ -200 }, lufsI{ -200 },
                       corr{ 1 }, inPk{ 0 };
    std::atomic<float> bGr[rigor::MAX_BANDS];
    juce::ValueTree caseSlot[2]{ juce::ValueTree("A"), juce::ValueTree("B") };
    bool caseValid[2]{ false, false };
    int curCase = 0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(RigorAudioProcessor)
};
