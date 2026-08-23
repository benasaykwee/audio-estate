/* CASKET — PluginEditor.h

   THE BESPOKE FACE. This replaces juce::GenericAudioProcessorEditor, which
   had stood in for three rounds behind the note "deferred to the CI build
   loop, where a real compiler keeps us honest".

   That note was half right and half an excuse. There is still no JUCE in
   the sandbox, so this file has never been compiled here. What changed is
   that `tests/casket_plugin_test.js` now reads these sources statically and
   asserts the things a compiler would catch late and a regex catches now:
   that every control names a parameter that exists, that every parameter
   the core defines is reachable from a host, that every proc.*() called
   here is declared there, that no two history traces are fed from the same
   value, and that nothing is written to a ring that is never drawn.

   The last two of those exist because the generic-editor stand-in was
   quietly broken in both ways at once, and had been for three rounds.

   The layout is the browser's, deliberately: the viewing across the top
   left, the plot down the right, the rack of controls beneath. Two faces on
   one instrument should not need separate learning. */
#pragma once
#include <juce_audio_utils/juce_audio_utils.h>
#include "PluginProcessor.h"

/* ---- the house look ---- */
struct CasketLook : juce::LookAndFeel_V4 {
    CasketLook();
    void drawRotarySlider(juce::Graphics&, int x, int y, int w, int h,
                          float pos, float start, float end,
                          juce::Slider&) override;
    void drawToggleButton(juce::Graphics&, juce::ToggleButton&,
                          bool over, bool down) override;
    void drawComboBox(juce::Graphics&, int w, int h, bool down,
                      int bx, int by, int bw, int bh, juce::ComboBox&) override;
    juce::Font getLabelFont(juce::Label&) override;
};

/* a knob and its caption, bound to one parameter */
class Dial : public juce::Component {
public:
    Dial(juce::AudioProcessorValueTreeState&, const juce::String& pid,
         const juce::String& caption);
    void resized() override;
    void paint(juce::Graphics&) override;
private:
    juce::Slider slider;
    juce::String cap;
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> att;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Dial)
};

/* a latching switch, bound to one parameter */
class Latch : public juce::Component {
public:
    Latch(juce::AudioProcessorValueTreeState&, const juce::String& pid,
          const juce::String& caption);
    void resized() override;
private:
    juce::ToggleButton button;
    std::unique_ptr<juce::AudioProcessorValueTreeState::ButtonAttachment> att;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Latch)
};

/* a chooser and its caption, bound to one parameter.

   Two wirings. The attached form is the ordinary one: the box IS the
   parameter, via a ComboBoxAttachment. The callback form exists for the
   arrangement box alone, and deliberately has NO attachment: a user pick
   is a gesture with consequences beyond one parameter (see
   CasketEditor::applyArrangement), and an attachment cannot tell a user's
   pick from the host moving the parameter — automation or a preset load
   arriving through the same onChange would stomp every knob the session
   had saved. So the callback form reports the pick, displays the
   parameter via reflect(), and wires nothing automatically. */
class Chooser : public juce::Component {
public:
    Chooser(juce::AudioProcessorValueTreeState&, const juce::String& pid,
            const juce::String& caption);
    Chooser(juce::AudioProcessorValueTreeState&, const juce::String& pid,
            const juce::String& caption, std::function<void(int)> onUserPick);
    void reflect(int idx);   /* quiet display update; never fires the callback */
    void resized() override;
    void paint(juce::Graphics&) override;
private:
    juce::ComboBox box;
    juce::String cap;
    std::unique_ptr<juce::AudioProcessorValueTreeState::ComboBoxAttachment> att;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Chooser)
};

class CasketEditor : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit CasketEditor(CasketProcessor&);
    ~CasketEditor() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;
    void applyArrangement(int styleIndex);
    void drawViewing(juce::Graphics&, juce::Rectangle<int>);
    void drawPlot(juce::Graphics&, juce::Rectangle<int>);
    void drawRange(juce::Graphics&, juce::Rectangle<int>);
    void drawHeader(juce::Graphics&, juce::Rectangle<int>);

    CasketProcessor& proc;
    CasketLook look;

    juce::OwnedArray<Dial> dials;
    juce::OwnedArray<Latch> latches;
    juce::OwnedArray<Chooser> choosers;
    juce::Label groupA, groupB, groupC, groupD;

    /* THE VIEWING. Three rings, three sources, all three drawn.
       The stand-in fed hIn and hOut from the same m.peakDb and then never
       drew hIn — an input trace that was the output trace, invisible. The
       core now exposes a real per-frame input peak so this can be honest. */
    static const int HIST = 480;
    float hIn[HIST] = {}, hOut[HIST] = {}, hGr[HIST] = {};
    int hIdx = 0;
    casket::Meters m{};
    casket::Trace tr{};
    /* THE RANGE's latest snapshot, and whether it has anything in it yet —
       the 3 s short-term window has to fill before the chart means anything,
       and drawing an empty axis reads as a broken meter rather than a
       waiting one. */
    casket::Hist hist{};
    bool hasHist = false;

    /* palette lifted from the browser so the two faces look like one object */
    const juce::Colour slab   { 0xff0b0a0d };
    const juce::Colour crypt  { 0xff08070a };
    const juce::Colour panel  { 0xff130f1d };
    const juce::Colour line   { 0xff2a2433 };
    const juce::Colour bone   { 0xffd8d2c4 };
    const juce::Colour dim    { 0xff8a8494 };
    const juce::Colour gold   { 0xffc9a227 };
    const juce::Colour blood  { 0xffd2405a };
    const juce::Colour jewel  { 0xff37c48f };
    const juce::Colour violet { 0xff9d6bff };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(CasketEditor)
};
