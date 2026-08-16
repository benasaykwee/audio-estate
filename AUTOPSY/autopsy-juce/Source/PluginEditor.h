/* AUTOPSY — PluginEditor.h
   The bespoke face (third sitting): the examination table with clickable
   incision handles, a selected-incision inspector strip, and the output row.
   Replaces the GenericAudioProcessorEditor viewport. Compile-first per house
   rules — the static plugin lint checks every binding without a compiler.
   Interaction contract mirrors the browser: drag = freq/gain, wheel = Q,
   double-click empty = new incision, double-click handle = close it. */
#pragma once
#include <juce_audio_utils/juce_audio_utils.h>
#include "PluginProcessor.h"

class AutopsyEditor : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit AutopsyEditor(AutopsyProcessor&);
    ~AutopsyEditor() override = default;

    void paint(juce::Graphics&) override;
    void resized() override;

    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
    void mouseUp(const juce::MouseEvent&) override;
    void mouseDoubleClick(const juce::MouseEvent&) override;
    void mouseWheelMove(const juce::MouseEvent&, const juce::MouseWheelDetails&) override;

private:
    void timerCallback() override { repaint(0, 0, getWidth(), curveHeight); }

    juce::Rectangle<int> curveArea() const { return { 0, headerHeight, getWidth(), curveHeight - headerHeight }; }
    int hitTestHandle(juce::Point<float> p) const;
    void selectBand(int idx);
    void beginDragGesture(int band);
    void endDragGesture();
    void setBandParam(int band, const char* suffix, float plainValue);

    static constexpr int headerHeight = 44;
    static constexpr int curveHeight = 280;
    static constexpr int inspectorHeight = 176;

    AutopsyProcessor& proc;
    int selected = -1;
    int draggingBand = -1;
    bool draggingGain = false;

    /* inspector strip — rebound to the selected incision */
    juce::ToggleButton onBtn { "on" };
    juce::ComboBox typeBox, slopeBox, placeBox;
    juce::Slider freqSl, gainSl, qSl;
    juce::ToggleButton dynBtn { "dyn" };
    juce::Slider dynRangeSl, dynThreshSl, dynAttSl, dynRelSl;
    juce::Slider outGainSl, outPanSl;
    juce::Label inspectorLabel, outLabel;

    std::vector<std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment>> sliderAtt;
    std::vector<std::unique_ptr<juce::AudioProcessorValueTreeState::ComboBoxAttachment>> comboAtt;
    std::vector<std::unique_ptr<juce::AudioProcessorValueTreeState::ButtonAttachment>> buttonAtt;
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> outGainAtt, outPanAtt;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(AutopsyEditor)
};
