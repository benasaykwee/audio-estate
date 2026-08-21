/* RIGOR — PluginEditor.h
   A bespoke face, not a generic parameter list. The stiffening curve and
   the chart are drawn from the SAME rigor::transferAt the browser
   instrument uses, so the two bodies cannot disagree about what the
   compressor is doing. */
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "PluginProcessor.h"
#include <vector>

/* ---- house look ---- */
struct MorgueLNF : juce::LookAndFeel_V4
{
    MorgueLNF();
    void drawRotarySlider(juce::Graphics&, int x, int y, int w, int h,
                          float pos, float startAngle, float endAngle,
                          juce::Slider&) override;
    void drawToggleButton(juce::Graphics&, juce::ToggleButton&,
                          bool highlighted, bool down) override;
    juce::Font getLabelFont(juce::Label&) override;
};

/* the stiffening curve + the live dot */
class CurveView : public juce::Component, private juce::Timer
{
public:
    explicit CurveView(RigorAudioProcessor& p) : proc(p) { startTimerHz(30); }
    void paint(juce::Graphics&) override;
private:
    void timerCallback() override { repaint(); }
    RigorAudioProcessor& proc;
};

/* the chart: scrolling in/out levels with the flatline hanging from the top */
class ChartView : public juce::Component, private juce::Timer
{
public:
    explicit ChartView(RigorAudioProcessor& p) : proc(p) { startTimerHz(30); }
    void paint(juce::Graphics&) override;
private:
    void timerCallback() override;
    RigorAudioProcessor& proc;
    struct Pt { float in, out, gr; };
    std::vector<Pt> hist;
    static constexpr int HN = 260;
};

/* a knob with its caption and readout, bound to one parameter */
class Dial : public juce::Component
{
public:
    Dial(juce::AudioProcessorValueTreeState&, const juce::String& id, const juce::String& caption);
    void resized() override;
    void paint(juce::Graphics&) override;
private:
    juce::Slider slider;
    juce::Label cap;
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> att;
    juce::String caption;
};

class RigorAudioProcessorEditor : public juce::AudioProcessorEditor,
                                  private juce::Timer
{
public:
    explicit RigorAudioProcessorEditor(RigorAudioProcessor&);
    ~RigorAudioProcessorEditor() override;
    void paint(juce::Graphics&) override;
    void resized() override;
private:
    /* The undo transaction boundary. Every tick where something has
       changed closes the current step, so a knob sweep or an automation
       ramp collapses into one undoable move rather than several hundred.
       Also the only place the undo/redo buttons learn to grey out. */
    void timerCallback() override;
    RigorAudioProcessor& proc;
    MorgueLNF lnf;
    CurveView curve;
    ChartView chart;

    juce::TextButton styleBtn[4];
    /* sized from the processor's own count — the editor cannot be wired
       for a different number of slots than the processor holds */
    juce::TextButton caseBtn[RigorAudioProcessor::NUM_CASES];
    juce::TextButton copyBtn{ "COPY >" };
    juce::TextButton undoBtn{ "UNDO" }, redoBtn{ "REDO" };
    juce::ToggleButton deltaBtn{ "Delta" },
                       scBtn{ "Sidechain" }, listenBtn{ "Listen" },
                       autoRelBtn{ "Auto rel" }, autoMkBtn{ "Auto makeup" },
                       bypassBtn{ "Bypass" }, detOsBtn{ "True peak" };
    /* placement is a CHOICE parameter, so it gets a combo box — binding a
       ToggleButton to it would silently write 0/1 into the wrong parameter,
       which is exactly the mistake this comment exists to prevent. */
    juce::ComboBox placeBox, bandsBox, syncBox;
    std::vector<std::unique_ptr<Dial>> dials;
    std::vector<std::unique_ptr<juce::AudioProcessorValueTreeState::ButtonAttachment>> btnAtt;
    std::unique_ptr<juce::AudioProcessorValueTreeState::ComboBoxAttachment> placeAtt, bandsAtt, syncAtt;

    void syncStyleButtons();
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(RigorAudioProcessorEditor)
};
