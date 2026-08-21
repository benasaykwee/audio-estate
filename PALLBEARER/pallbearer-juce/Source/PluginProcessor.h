/* PALLBEARER — PluginProcessor.h
   The processor owns no DSP of its own: it translates parameters and MIDI
   into calls on pallbearer::PallbearerCore, which is the same code the
   browser instrument runs and the same code the parity gate proves.

   The estate's first INSTRUMENT rather than effect, so three things differ
   from AUTOPSY/RIGOR/CASKET: it accepts MIDI, it has no input bus, and its
   state carries a version stamp from day one — NECROPHONE's round-15 note
   is emphatic that a stamp cannot be added retroactively once anyone has
   saved a real session, so it goes in before the first save, not after. */
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "PallbearerCore.h"
#include "Parameters.h"
#include <memory>
#include <vector>
#include <atomic>

class PallbearerAudioProcessor : public juce::AudioProcessor
{
public:
    PallbearerAudioProcessor();
    ~PallbearerAudioProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout&) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "PALLBEARER"; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }

    /* A string set to a twelve-second decay is genuinely still sounding
       twelve seconds after the last note, and a host that trims the tail
       will cut it off. Report the worst case the parameter range allows. */
    double getTailLengthSeconds() const override { return 12.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return "Bearer"; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock&) override;
    void setStateInformation(const void*, int) override;

    juce::AudioProcessorValueTreeState apvts;

    /* The editor reads these to draw the neck. Written on the audio thread,
       read on the message thread, so they are atomics rather than a struct —
       a torn read here is a wrong dot on a diagram, not a click, but there
       is no reason to tolerate it. */
    std::atomic<int> lastString{ -1 };
    std::atomic<int> lastFret{ -1 };
    std::atomic<int> lastNote{ -1 };
    std::atomic<int> soundingCount{ 0 };

private:
    std::unique_ptr<pallbearer::PallbearerCore> core;
    double currentSr = 48000.0;

    /* Scratch in double, because the core is a double engine and converting
       per sample inside the render loop would both cost more and put a
       float rounding step in the middle of a parity-proven signal path. */
    std::vector<double> scratchL, scratchR;

    void pushParameters();
    void handleMidi(const juce::MidiMessage& m);

    /* Cached so we only rebuild filters and re-prime strings when something
       that actually needs it has moved. Comparing floats for equality is
       correct here: these are the exact values the host last gave us. */
    float lastTuningIdx = -1.f, lastBodyF = -1.f, lastBodyQ = -1.f, lastWood = -1.f;
    float lastCoilF = -1.f, lastCoilQ = -1.f, lastTone = -1.f;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PallbearerAudioProcessor)
};
