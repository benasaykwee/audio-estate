/* PALLBEARER — PluginEditor.cpp */
#include "PluginEditor.h"

namespace {
    const juce::Colour kInk   { 0xff07060a };
    const juce::Colour kSlab  { 0xff1b1522 };
    const juce::Colour kGold  { 0xffc9a227 };
    const juce::Colour kGoldHi{ 0xfff0d67a };
    const juce::Colour kBone  { 0xffe8e1d4 };
    const juce::Colour kLine  { 0xff2a2233 };
    const juce::Colour kBlood { 0xffa4161a };
    constexpr int kNeckH = 116;
    constexpr int kFrets = 15;
}

PallbearerAudioProcessorEditor::PallbearerAudioProcessorEditor(PallbearerAudioProcessor& p)
    : AudioProcessorEditor(&p), proc(p), generic(p)
{
    addAndMakeVisible(generic);
    setResizable(true, true);
    setResizeLimits(560, 420, 1400, 1100);
    setSize(760, 640);
    startTimerHz(24);
}

void PallbearerAudioProcessorEditor::timerCallback()
{
    const int s = proc.lastString.load(), f = proc.lastFret.load();
    if (s != shownString || f != shownFret) { shownString = s; shownFret = f; repaint(); }
}

void PallbearerAudioProcessorEditor::paint(juce::Graphics& g)
{
    g.fillAll(kInk);

    auto top = getLocalBounds().removeFromTop(kNeckH).reduced(10, 8);

    g.setColour(kGold);
    g.setFont(juce::Font(17.0f, juce::Font::plain));
    g.drawText("PALLBEARER", top.removeFromTop(20), juce::Justification::centredLeft);
    g.setColour(kBone.withAlpha(0.55f));
    g.setFont(juce::Font(11.0f));
    g.drawText(juce::String(proc.soundingCount.load()) + " ringing",
               top.removeFromTop(0).withHeight(20).withY(top.getY() - 20),
               juce::Justification::centredRight);

    /* The neck. Six rows at most, low string at the bottom, and a single
       gold dot where the fingering brain put the last note. It is the one
       piece of feedback that is genuinely worth having on screen: it shows
       a decision no other instrument makes. */
    auto neck = top.reduced(0, 2);
    const int rows = 4;
    const float rowH = (float)neck.getHeight() / (float)rows;
    const float nutW = 40.0f;
    const float cellW = (neck.getWidth() - nutW) / (float)(kFrets + 1);

    static const char* names[4] = { "G", "D", "A", "E" };
    for (int r = 0; r < rows; ++r) {
        const float y = neck.getY() + r * rowH + rowH * 0.5f;
        g.setColour(kGold.withAlpha(0.45f));
        g.setFont(juce::Font(10.0f));
        g.drawText(names[r], (int)neck.getX(), (int)(y - 8), (int)nutW - 6, 16,
                   juce::Justification::centredRight);
        g.setColour(kLine);
        g.drawLine(neck.getX() + nutW, y, (float)neck.getRight(), y, 1.0f);
    }
    g.setColour(kGold.withAlpha(0.7f));
    g.drawLine(neck.getX() + nutW, (float)neck.getY(), neck.getX() + nutW, (float)neck.getBottom(), 2.0f);
    for (int f = 1; f <= kFrets; ++f) {
        g.setColour(kLine.withAlpha(0.7f));
        const float x = neck.getX() + nutW + f * cellW;
        g.drawLine(x, (float)neck.getY(), x, (float)neck.getBottom(), 1.0f);
    }

    if (shownString >= 0 && shownFret >= 0 && shownFret <= kFrets) {
        const int rowFromTop = juce::jlimit(0, rows - 1, (rows - 1) - shownString);
        const float y = neck.getY() + rowFromTop * rowH + rowH * 0.5f;
        const float x = neck.getX() + nutW + (shownFret + 0.5f) * cellW - (shownFret == 0 ? cellW * 0.5f : 0.0f);
        g.setColour(kGold);
        g.fillEllipse(x - 6.0f, y - 6.0f, 12.0f, 12.0f);
        g.setColour(kGoldHi.withAlpha(0.35f));
        g.fillEllipse(x - 10.0f, y - 10.0f, 20.0f, 20.0f);
    }

    g.setColour(kBlood.withAlpha(0.5f));
    g.drawLine(0.0f, (float)kNeckH, (float)getWidth(), (float)kNeckH, 1.0f);
}

void PallbearerAudioProcessorEditor::resized()
{
    auto b = getLocalBounds();
    b.removeFromTop(kNeckH);
    generic.setBounds(b);
}
