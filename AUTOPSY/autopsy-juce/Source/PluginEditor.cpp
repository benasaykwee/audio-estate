#include "PluginEditor.h"

using namespace autopsy;

static const juce::Colour SLAB(0xff0b0a0d);
static const juce::Colour PANEL(0xff141218);
static const juce::Colour GOLD(0xffc9a227);
static const juce::Colour BONE(0xffd8d2c4);
static const juce::Colour DIMC(0xff5a5464);
static const juce::Colour GRID(0xff17131d);

static const juce::Colour JEWELS[MAX_BANDS] = {
    juce::Colour(0xff2e8b57), juce::Colour(0xff7d5ba6), juce::Colour(0xffa12d3f),
    juce::Colour(0xff2f5f9e), juce::Colour(0xffc98a27), juce::Colour(0xff7a1f2b),
    juce::Colour(0xff3aa17e), juce::Colour(0xff5661a8), juce::Colour(0xffd4b02a),
    juce::Colour(0xff3f7a6a), juce::Colour(0xffb04a6e), juce::Colour(0xff7fa8a0)
};

static juce::String bandParamId(int b, const char* p) {
    return "b" + juce::String(b + 1) + "_" + p;
}
static double freqToX(double f, double w) {
    double l0 = std::log10(20.0), l1 = std::log10(20000.0);
    f = juce::jlimit(20.0, 20000.0, f);
    return (std::log10(f) - l0) / (l1 - l0) * w;
}
static double xToFreq(double x, double w) {
    double l0 = std::log10(20.0), l1 = std::log10(20000.0);
    x = juce::jlimit(0.0, w, x);
    return std::pow(10.0, l0 + (x / w) * (l1 - l0));
}
static double dbToY(double db, double h) {
    db = juce::jlimit(-24.0, 24.0, db);
    return h / 2 - (db / 24.0) * (h / 2);
}
static double yToDb(double y, double h) {
    y = juce::jlimit(0.0, h, y);
    return -((y - h / 2) / (h / 2)) * 24.0;
}
static bool gainlessType(BandType t) {
    return t == LOWCUT || t == HIGHCUT || t == NOTCH || t == BANDPASS;
}

AutopsyEditor::AutopsyEditor(AutopsyProcessor& p)
    : juce::AudioProcessorEditor(p), proc(p) {

    auto styleSlider = [this](juce::Slider& s, bool rotary) {
        s.setSliderStyle(rotary ? juce::Slider::RotaryHorizontalVerticalDrag
                                 : juce::Slider::LinearHorizontal);
        s.setTextBoxStyle(juce::Slider::TextBoxBelow, false, 64, 16);
        s.setColour(juce::Slider::rotarySliderFillColourId, GOLD);
        s.setColour(juce::Slider::trackColourId, GOLD.withAlpha(0.6f));
        s.setColour(juce::Slider::textBoxTextColourId, BONE);
        s.setColour(juce::Slider::textBoxOutlineColourId, juce::Colours::transparentBlack);
        addAndMakeVisible(s);
    };
    styleSlider(freqSl, true);
    styleSlider(gainSl, true);
    styleSlider(qSl, true);
    styleSlider(dynRangeSl, true);
    styleSlider(dynThreshSl, true);
    styleSlider(dynAttSl, true);
    styleSlider(dynRelSl, true);
    styleSlider(outGainSl, true);
    styleSlider(outPanSl, true);

    for (int t = 0; t < NUM_TYPES; t++) typeBox.addItem(TYPE_NAMES[t], t + 1);
    slopeBox.addItemList({ "6", "12", "18", "24", "36", "48" }, 1);
    for (int pl = 0; pl < NUM_PLACES; pl++) placeBox.addItem(PLACE_NAMES[pl], pl + 1);
    addAndMakeVisible(typeBox);
    addAndMakeVisible(slopeBox);
    addAndMakeVisible(placeBox);
    addAndMakeVisible(onBtn);
    addAndMakeVisible(dynBtn);

    inspectorLabel.setColour(juce::Label::textColourId, DIMC);
    inspectorLabel.setText("right-click nothing — click a handle, or double-click the table to cut",
                           juce::dontSendNotification);
    addAndMakeVisible(inspectorLabel);
    outLabel.setColour(juce::Label::textColourId, DIMC);
    outLabel.setText("output / pan", juce::dontSendNotification);
    addAndMakeVisible(outLabel);

    outGainAtt = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(
        proc.apvts, "out_gain", outGainSl);
    outPanAtt = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(
        proc.apvts, "out_pan", outPanSl);

    selectBand(-1);
    setResizable(true, true);
    setSize(820, curveHeight + inspectorHeight);
    startTimerHz(20);
}

void AutopsyEditor::selectBand(int idx) {
    selected = idx;
    sliderAtt.clear();
    comboAtt.clear();
    buttonAtt.clear();
    bool have = idx >= 0;
    onBtn.setVisible(have); typeBox.setVisible(have); slopeBox.setVisible(have);
    placeBox.setVisible(have); freqSl.setVisible(have); gainSl.setVisible(have);
    qSl.setVisible(have); dynBtn.setVisible(have); dynRangeSl.setVisible(have);
    dynThreshSl.setVisible(have); dynAttSl.setVisible(have); dynRelSl.setVisible(have);
    if (!have) {
        inspectorLabel.setText("click a handle to inspect it, or double-click the table to cut",
                               juce::dontSendNotification);
        return;
    }
    inspectorLabel.setText("incision " + juce::String(idx + 1), juce::dontSendNotification);
    using SA = juce::AudioProcessorValueTreeState::SliderAttachment;
    using CA = juce::AudioProcessorValueTreeState::ComboBoxAttachment;
    using BA = juce::AudioProcessorValueTreeState::ButtonAttachment;
    buttonAtt.push_back(std::make_unique<BA>(proc.apvts, bandParamId(idx, "on"), onBtn));
    comboAtt.push_back(std::make_unique<CA>(proc.apvts, bandParamId(idx, "type"), typeBox));
    comboAtt.push_back(std::make_unique<CA>(proc.apvts, bandParamId(idx, "slope"), slopeBox));
    comboAtt.push_back(std::make_unique<CA>(proc.apvts, bandParamId(idx, "place"), placeBox));
    sliderAtt.push_back(std::make_unique<SA>(proc.apvts, bandParamId(idx, "freq"), freqSl));
    sliderAtt.push_back(std::make_unique<SA>(proc.apvts, bandParamId(idx, "gain"), gainSl));
    sliderAtt.push_back(std::make_unique<SA>(proc.apvts, bandParamId(idx, "q"), qSl));
    buttonAtt.push_back(std::make_unique<BA>(proc.apvts, bandParamId(idx, "dyn_on"), dynBtn));
    sliderAtt.push_back(std::make_unique<SA>(proc.apvts, bandParamId(idx, "dyn_range"), dynRangeSl));
    sliderAtt.push_back(std::make_unique<SA>(proc.apvts, bandParamId(idx, "dyn_thresh"), dynThreshSl));
    sliderAtt.push_back(std::make_unique<SA>(proc.apvts, bandParamId(idx, "dyn_att"), dynAttSl));
    sliderAtt.push_back(std::make_unique<SA>(proc.apvts, bandParamId(idx, "dyn_rel"), dynRelSl));
}

void AutopsyEditor::resized() {
    auto strip = getLocalBounds().removeFromBottom(inspectorHeight).reduced(10, 6);
    auto top = strip.removeFromTop(18);
    inspectorLabel.setBounds(top.removeFromLeft(300));
    outLabel.setBounds(top.removeFromRight(140));
    auto row1 = strip.removeFromTop(76);
    onBtn.setBounds(row1.removeFromLeft(52).reduced(2));
    typeBox.setBounds(row1.removeFromLeft(104).withHeight(24).translated(0, 24));
    slopeBox.setBounds(row1.removeFromLeft(76).withHeight(24).translated(0, 24));
    placeBox.setBounds(row1.removeFromLeft(84).withHeight(24).translated(0, 24));
    freqSl.setBounds(row1.removeFromLeft(84).reduced(2));
    gainSl.setBounds(row1.removeFromLeft(84).reduced(2));
    qSl.setBounds(row1.removeFromLeft(84).reduced(2));
    auto outCol = row1.removeFromRight(168);
    outGainSl.setBounds(outCol.removeFromLeft(84).reduced(2));
    outPanSl.setBounds(outCol.reduced(2));
    auto row2 = strip.removeFromTop(76);
    dynBtn.setBounds(row2.removeFromLeft(52).reduced(2));
    dynRangeSl.setBounds(row2.removeFromLeft(84).reduced(2));
    dynThreshSl.setBounds(row2.removeFromLeft(84).reduced(2));
    dynAttSl.setBounds(row2.removeFromLeft(84).reduced(2));
    dynRelSl.setBounds(row2.removeFromLeft(84).reduced(2));
}

int AutopsyEditor::hitTestHandle(juce::Point<float> pt) const {
    auto area = curveArea().toFloat();
    State s = proc.buildState();
    int best = -1;
    float bd = 14.0f;
    for (int b = 0; b < MAX_BANDS; b++) {
        if (!s.bands[b].on) continue;
        float hx = (float)freqToX(s.bands[b].freq, area.getWidth());
        float hy = area.getY() + (float)dbToY(gainlessType(s.bands[b].type) ? 0.0 : s.bands[b].gain,
                                              area.getHeight());
        float d = pt.getDistanceFrom({ hx, hy });
        if (d < bd) { bd = d; best = b; }
    }
    return best;
}

void AutopsyEditor::setBandParam(int band, const char* suffix, float plainValue) {
    if (auto* prm = proc.apvts.getParameter(bandParamId(band, suffix)))
        prm->setValueNotifyingHost(prm->convertTo0to1(plainValue));
}
void AutopsyEditor::beginDragGesture(int band) {
    if (auto* f = proc.apvts.getParameter(bandParamId(band, "freq"))) f->beginChangeGesture();
    if (auto* g = proc.apvts.getParameter(bandParamId(band, "gain"))) g->beginChangeGesture();
}
void AutopsyEditor::endDragGesture() {
    if (draggingBand < 0) return;
    if (auto* f = proc.apvts.getParameter(bandParamId(draggingBand, "freq"))) f->endChangeGesture();
    if (auto* g = proc.apvts.getParameter(bandParamId(draggingBand, "gain"))) g->endChangeGesture();
}

void AutopsyEditor::mouseDown(const juce::MouseEvent& e) {
    if (!curveArea().contains(e.getPosition())) return;
    int hit = hitTestHandle(e.position);
    if (hit >= 0) {
        selectBand(hit);
        draggingBand = hit;
        draggingGain = !gainlessType(proc.buildState().bands[hit].type);
        beginDragGesture(hit);
    }
}
void AutopsyEditor::mouseDrag(const juce::MouseEvent& e) {
    if (draggingBand < 0) return;
    auto area = curveArea().toFloat();
    setBandParam(draggingBand, "freq",
                 (float)xToFreq(e.position.x, area.getWidth()));
    if (draggingGain)
        setBandParam(draggingBand, "gain",
                     (float)yToDb(e.position.y - area.getY(), area.getHeight()));
}
void AutopsyEditor::mouseUp(const juce::MouseEvent&) {
    endDragGesture();
    draggingBand = -1;
}
void AutopsyEditor::mouseDoubleClick(const juce::MouseEvent& e) {
    if (!curveArea().contains(e.getPosition())) return;
    int hit = hitTestHandle(e.position);
    if (hit >= 0) { // close the incision
        if (auto* prm = proc.apvts.getParameter(bandParamId(hit, "on"))) {
            prm->beginChangeGesture();
            prm->setValueNotifyingHost(0.0f);
            prm->endChangeGesture();
        }
        if (selected == hit) selectBand(-1);
        return;
    }
    State s = proc.buildState(); // first free slot gets a bell at the click
    for (int b = 0; b < MAX_BANDS; b++) {
        if (s.bands[b].on) continue;
        auto area = curveArea().toFloat();
        setBandParam(b, "freq", (float)xToFreq(e.position.x, area.getWidth()));
        setBandParam(b, "gain", (float)yToDb(e.position.y - area.getY(), area.getHeight()));
        setBandParam(b, "type", 0.0f);
        if (auto* prm = proc.apvts.getParameter(bandParamId(b, "on"))) {
            prm->beginChangeGesture();
            prm->setValueNotifyingHost(1.0f);
            prm->endChangeGesture();
        }
        selectBand(b);
        return;
    }
}
void AutopsyEditor::mouseWheelMove(const juce::MouseEvent& e, const juce::MouseWheelDetails& wh) {
    if (!curveArea().contains(e.getPosition())) return;
    int hit = draggingBand >= 0 ? draggingBand : hitTestHandle(e.position);
    if (hit < 0) return;
    State s = proc.buildState();
    double q = s.bands[hit].q * std::pow(1.13, wh.deltaY > 0 ? 1.0 : -1.0);
    setBandParam(hit, "q", (float)juce::jlimit(0.05, 40.0, q));
}

void AutopsyEditor::paint(juce::Graphics& g) {
    g.fillAll(SLAB);
    auto area = curveArea().toFloat();
    double w = area.getWidth(), h = area.getHeight(), y0 = area.getY();

    g.setColour(GOLD);
    g.setFont(juce::Font(juce::Font::getDefaultSerifFontName(), 22.0f, juce::Font::plain));
    g.drawText("A U T O P S Y", 12, 4, 300, 24, juce::Justification::left);
    g.setColour(DIMC);
    g.setFont(juce::Font(juce::Font::getDefaultSerifFontName(), 12.0f, juce::Font::italic));
    g.drawText("every frequency examined.  v" + juce::String(VERSION),
               12, 26, 340, 14, juce::Justification::left);

    g.setColour(GRID);
    const double gridF[] = { 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000 };
    for (double f : gridF)
        g.drawVerticalLine((int)freqToX(f, w), (float)y0, (float)(y0 + h));
    for (int d = -18; d <= 18; d += 6)
        g.drawHorizontalLine((int)(y0 + dbToY(d, h)), 0.0f, (float)w);

    State s = proc.buildState();
    double fs = proc.currentSampleRate();

    for (int b = 0; b < MAX_BANDS; b++) {
        if (!s.bands[b].on) continue;
        juce::Path bp;
        for (int x = 0; x <= (int)w; x += 3) {
            float y = (float)(y0 + dbToY(bandMagAt(s.bands[b], fs, xToFreq(x, w)), h));
            if (x == 0) bp.startNewSubPath(0, y); else bp.lineTo((float)x, y);
        }
        bool offStereo = s.bands[b].place != P_ST;
        g.setColour(JEWELS[b].withAlpha(0.5f));
        if (offStereo) {
            juce::Path dashed;
            const float dashes[2] = { 5.0f, 4.0f };
            juce::PathStrokeType(1.0f).createDashedStroke(dashed, bp, dashes, 2);
            g.fillPath(dashed);
        } else {
            g.strokePath(bp, juce::PathStrokeType(1.0f));
        }
    }

    juce::Path curve;
    for (int x = 0; x <= (int)w; x += 2) {
        float y = (float)(y0 + dbToY(magnitudeAt(s, fs, xToFreq(x, w)), h));
        if (x == 0) curve.startNewSubPath(0, y); else curve.lineTo((float)x, y);
    }
    g.setColour(GOLD);
    g.strokePath(curve, juce::PathStrokeType(2.0f));

    for (int b = 0; b < MAX_BANDS; b++) {
        if (!s.bands[b].on) continue;
        float x = (float)freqToX(s.bands[b].freq, w);
        float y = (float)(y0 + dbToY(gainlessType(s.bands[b].type) ? 0.0 : s.bands[b].gain, h));
        g.setColour(JEWELS[b]);
        g.fillEllipse(x - 6, y - 6, 12, 12);
        if (b == selected) {
            g.setColour(GOLD);
            g.drawEllipse(x - 8, y - 8, 16, 16, 1.5f);
        }
        g.setColour(SLAB);
        g.setFont(9.0f);
        g.drawText(juce::String(b + 1), (int)x - 6, (int)y - 6, 12, 12, juce::Justification::centred);
    }

    g.setColour(PANEL);
    g.fillRect(0, curveHeight, getWidth(), 1);
}
