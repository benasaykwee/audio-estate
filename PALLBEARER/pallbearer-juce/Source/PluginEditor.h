/* PALLBEARER — PluginEditor.h
   Deliberately plain. The bespoke face is a CI-loop job: writing a rich
   editor without a compiler is exactly how NECROPHONE's round-15 note says
   not to spend a session. This one is generic sliders plus a neck diagram,
   which is enough to play and enough to see the fingering brain working. */
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "PluginProcessor.h"

class PallbearerAudioProcessorEditor : public juce::AudioProcessorEditor,
                                       private juce::Timer
{
public:
    explicit PallbearerAudioProcessorEditor(PallbearerAudioProcessor&);
    ~PallbearerAudioProcessorEditor() override = default;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;

    PallbearerAudioProcessor& proc;
    juce::GenericAudioProcessorEditor generic;
    int shownString = -1, shownFret = -1;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PallbearerAudioProcessorEditor)
};
