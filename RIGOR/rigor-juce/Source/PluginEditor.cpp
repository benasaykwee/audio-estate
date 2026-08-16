/* RIGOR — PluginEditor.cpp
   Written compile-first: there is no JUCE in the sandbox, so the first
   build happens on the CI runners, per house rules. */
#include "PluginEditor.h"

static const juce::Colour BG    (0xff08070c);
static const juce::Colour PANEL (0xff100e17);
static const juce::Colour PLOT  (0xff0a0810);
static const juce::Colour LINEC (0xff2a2433);
static const juce::Colour GRIDC (0xff1b1726);
static const juce::Colour GOLD  (0xffc9a227);
static const juce::Colour GOLDD (0xff8a7222);
static const juce::Colour ARTERY(0xffe05561);
static const juce::Colour SAPPH (0xff5aa8e0);
static const juce::Colour BONE  (0xffd8d2c4);
static const juce::Colour DIM   (0xff8a8494);

/* ============================== look ============================== */
MorgueLNF::MorgueLNF()
{
    setColour(juce::ResizableWindow::backgroundColourId, BG);
    setColour(juce::Slider::rotarySliderFillColourId, GOLD);
    setColour(juce::Slider::rotarySliderOutlineColourId, LINEC);
    setColour(juce::Label::textColourId, BONE);
    setColour(juce::TextButton::buttonColourId, PANEL);
    setColour(juce::TextButton::buttonOnColourId, juce::Colour(0xff2a2010));
    setColour(juce::TextButton::textColourOffId, DIM);
    setColour(juce::TextButton::textColourOnId, GOLD);
    setColour(juce::ToggleButton::textColourId, DIM);
    setColour(juce::ToggleButton::tickColourId, GOLD);
    setColour(juce::ComboBox::backgroundColourId, PANEL);
    setColour(juce::ComboBox::textColourId, BONE);
    setColour(juce::ComboBox::outlineColourId, LINEC);
}

juce::Font MorgueLNF::getLabelFont(juce::Label&)
{
    return juce::Font(juce::FontOptions(12.0f));
}

void MorgueLNF::drawRotarySlider(juce::Graphics& g, int x, int y, int w, int h,
                                 float pos, float a0, float a1, juce::Slider&)
{
    auto b = juce::Rectangle<int>(x, y, w, h).toFloat().reduced(4.0f);
    auto r = juce::jmin(b.getWidth(), b.getHeight()) * 0.5f;
    auto cx = b.getCentreX(), cy = b.getCentreY();
    auto ang = a0 + pos * (a1 - a0);

    g.setColour(LINEC);
    juce::Path track;
    track.addCentredArc(cx, cy, r - 3.0f, r - 3.0f, 0.0f, a0, a1, true);
    g.strokePath(track, juce::PathStrokeType(3.0f, juce::PathStrokeType::curved,
                                             juce::PathStrokeType::rounded));
    g.setColour(GOLD);
    juce::Path val;
    val.addCentredArc(cx, cy, r - 3.0f, r - 3.0f, 0.0f, a0, ang, true);
    g.strokePath(val, juce::PathStrokeType(3.0f, juce::PathStrokeType::curved,
                                           juce::PathStrokeType::rounded));

    juce::Path pointer;
    pointer.addRectangle(-1.0f, -r + 3.0f, 2.0f, r * 0.52f);
    g.setColour(BONE);
    g.fillPath(pointer, juce::AffineTransform::rotation(ang).translated(cx, cy));

    g.setColour(PANEL);
    g.fillEllipse(cx - r * 0.34f, cy - r * 0.34f, r * 0.68f, r * 0.68f);
    g.setColour(LINEC);
    g.drawEllipse(cx - r * 0.34f, cy - r * 0.34f, r * 0.68f, r * 0.68f, 1.0f);
}

void MorgueLNF::drawToggleButton(juce::Graphics& g, juce::ToggleButton& b, bool hi, bool)
{
    auto r = b.getLocalBounds().toFloat();
    auto box = r.removeFromLeft(16.0f).withSizeKeepingCentre(14.0f, 14.0f);
    g.setColour(b.getToggleState() ? GOLD : LINEC);
    g.drawRoundedRectangle(box, 3.0f, 1.4f);
    if (b.getToggleState()) {
        g.setColour(GOLD);
        g.fillRoundedRectangle(box.reduced(3.5f), 1.5f);
    }
    g.setColour(b.getToggleState() ? BONE : (hi ? BONE : DIM));
    g.setFont(juce::FontOptions(12.0f));
    g.drawText(b.getButtonText(), r.withTrimmedLeft(6.0f), juce::Justification::centredLeft);
}

/* ============================== dial ============================== */
Dial::Dial(juce::AudioProcessorValueTreeState& s, const juce::String& id,
           const juce::String& capText) : caption(capText)
{
    slider.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
    slider.setTextBoxStyle(juce::Slider::TextBoxBelow, false, 66, 15);
    slider.setColour(juce::Slider::textBoxTextColourId, BONE);
    slider.setColour(juce::Slider::textBoxOutlineColourId, juce::Colours::transparentBlack);
    addAndMakeVisible(slider);
    att = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(s, id, slider);
}
void Dial::resized()
{
    auto r = getLocalBounds();
    r.removeFromTop(13);
    slider.setBounds(r);
}
void Dial::paint(juce::Graphics& g)
{
    g.setColour(GOLDD);
    g.setFont(juce::FontOptions(9.5f));
    g.drawText(caption.toUpperCase(), getLocalBounds().removeFromTop(13),
               juce::Justification::centred);
}

/* ========================= stiffening curve ========================= */
void CurveView::paint(juce::Graphics& g)
{
    auto all = getLocalBounds().toFloat();
    g.setColour(PLOT);
    g.fillRoundedRectangle(all, 6.0f);

    auto head = all.removeFromTop(16.0f).reduced(8.0f, 0.0f);
    g.setColour(GOLDD);
    g.setFont(juce::FontOptions(9.5f));
    g.drawText("THE STIFFENING CURVE", head, juce::Justification::centredLeft);

    auto plot = all.reduced(20.0f);
    auto X = [&](double db) { return plot.getX() + (float)((db + 60.0) / 60.0) * plot.getWidth(); };
    auto Y = [&](double db) { return plot.getBottom() - (float)((db + 60.0) / 60.0) * plot.getHeight(); };

    g.setColour(GRIDC);
    for (int db = -60; db <= 0; db += 12) {
        g.drawLine(X(db), plot.getY(), X(db), plot.getBottom(), 1.0f);
        g.drawLine(plot.getX(), Y(db), plot.getRight(), Y(db), 1.0f);
    }
    g.setColour(DIM.withAlpha(0.30f));
    g.drawLine(X(-60), Y(-60), X(0), Y(0), 1.2f);

    const auto st = proc.currentState();
    juce::Path p;
    for (int i = 0; i <= 200; ++i) {
        double xin = -60.0 + (i / 200.0) * 60.0;
        double yo = juce::jlimit(-60.0, 6.0, rigor::transferAt(st, xin));
        if (i == 0) p.startNewSubPath(X(xin), Y(yo)); else p.lineTo(X(xin), Y(yo));
    }
    g.setColour(GOLD);
    g.strokePath(p, juce::PathStrokeType(2.2f));

    g.setColour(GOLD.withAlpha(0.25f));
    g.drawLine(X(st.thresh), plot.getY(), X(st.thresh), plot.getBottom(), 1.2f);

    /* the live dot: where the signal actually sits on the curve right now */
    const float inPk = proc.inPeak();
    if (inPk > 1.0e-5f) {
        double inDb = juce::jlimit(-60.0, 0.0, 20.0 * std::log10((double)inPk));
        double outDb = juce::jlimit(-60.0, 6.0, inDb + (double)proc.gainReduction());
        g.setColour(ARTERY);
        g.fillEllipse(X(inDb) - 4.0f, Y(outDb) - 4.0f, 8.0f, 8.0f);
        g.setColour(ARTERY.withAlpha(0.30f));
        g.drawEllipse(X(inDb) - 8.0f, Y(outDb) - 8.0f, 16.0f, 16.0f, 1.2f);
    }
}

/* ============================== chart ============================== */
void ChartView::timerCallback()
{
    auto db = [](float lin) {
        return lin > 1.0e-7f ? 20.0f * std::log10(lin) : -70.0f;
    };
    /* the output trace is the input plus the gain reduction: the
       processor publishes GR, not a second peak meter. */
    float inDb = db(proc.inPeak());
    hist.push_back({ inDb, inDb + proc.gainReduction(), proc.gainReduction() });
    while ((int)hist.size() > HN) hist.erase(hist.begin());
    repaint();
}

void ChartView::paint(juce::Graphics& g)
{
    auto all = getLocalBounds().toFloat();
    g.setColour(PLOT);
    g.fillRoundedRectangle(all, 6.0f);

    auto head = all.removeFromTop(16.0f).reduced(8.0f, 0.0f);
    g.setColour(GOLDD);
    g.setFont(juce::FontOptions(9.5f));
    g.drawText("THE CHART", head, juce::Justification::centredLeft);

    const auto st = proc.currentState();
    auto plot = all.reduced(10.0f, 6.0f);
    auto Y = [&](float d) {
        float v = juce::jlimit(-60.0f, 0.0f, d);
        return plot.getY() + (-v / 60.0f) * plot.getHeight();
    };

    g.setColour(GRIDC);
    for (int d = 0; d >= -60; d -= 12)
        g.drawLine(plot.getX(), Y((float)d), plot.getRight(), Y((float)d), 1.0f);

    if (hist.size() > 1) {
        const float step = plot.getWidth() / (float)(HN - 1);
        juce::Path pin, pout, pgr;
        const float grScale = plot.getHeight() * 0.38f / 24.0f;
        for (size_t i = 0; i < hist.size(); ++i) {
            float x = plot.getX() + step * (float)i;
            if (i == 0) {
                pin.startNewSubPath(x, Y(hist[i].in));
                pout.startNewSubPath(x, Y(hist[i].out));
                pgr.startNewSubPath(x, plot.getY() + (-hist[i].gr) * grScale);
            } else {
                pin.lineTo(x, Y(hist[i].in));
                pout.lineTo(x, Y(hist[i].out));
                pgr.lineTo(x, plot.getY() + (-hist[i].gr) * grScale);
            }
        }
        g.setColour(DIM.withAlpha(0.55f));
        g.strokePath(pin, juce::PathStrokeType(1.2f));
        g.setColour(SAPPH);
        g.strokePath(pout, juce::PathStrokeType(1.8f));
        g.setColour(ARTERY);
        g.strokePath(pgr, juce::PathStrokeType(1.6f));
    }

    /* the line */
    g.setColour(GOLD.withAlpha(0.65f));
    const float dashes[] = { 5.0f, 4.0f };
    juce::Line<float> tl(plot.getX(), Y((float)st.thresh), plot.getRight(), Y((float)st.thresh));
    g.drawDashedLine(tl, dashes, 2, 1.2f);

    /* readouts, including the two meters a sample peak cannot give you */
    g.setFont(juce::FontOptions(11.0f));
    auto tpDb = proc.truePeak() > 1.0e-7f ? 20.0f * std::log10(proc.truePeak()) : -99.0f;
    g.setColour(ARTERY);
    g.drawText(juce::String(proc.gainReduction(), 1) + " dB GR",
               plot.reduced(4.0f), juce::Justification::topRight);
    g.setColour(BONE);
    g.drawText(juce::String(tpDb, 2) + " dBTP   " +
               juce::String(proc.lufsShort(), 1) + " LUFS-S   " +
               juce::String(proc.lufsIntegrated(), 1) + " LUFS-I   " +
               juce::String(proc.correlation(), 2) + " corr",
               plot.reduced(4.0f), juce::Justification::bottomRight);
}

/* ============================== editor ============================== */
static const char* STYLE_LABEL[4] = { "FRESH", "SETTLING", "SPASM", "REPOSE" };

RigorAudioProcessorEditor::RigorAudioProcessorEditor(RigorAudioProcessor& p)
    : AudioProcessorEditor(&p), proc(p), curve(p), chart(p)
{
    setLookAndFeel(&lnf);
    addAndMakeVisible(curve);
    addAndMakeVisible(chart);

    auto* styleParam = dynamic_cast<juce::AudioParameterChoice*>(
        proc.apvts.getParameter("style"));
    for (int i = 0; i < 4; ++i) {
        styleBtn[i].setButtonText(STYLE_LABEL[i]);
        styleBtn[i].setClickingTogglesState(false);
        styleBtn[i].onClick = [this, i, styleParam] {
            if (styleParam) {
                styleParam->beginChangeGesture();
                *styleParam = i;
                styleParam->endChangeGesture();
            }
            syncStyleButtons();
        };
        addAndMakeVisible(styleBtn[i]);
    }
    syncStyleButtons();

    struct D { const char* id; const char* cap; };
    static const D DS[] = {
        { "thresh", "Threshold" }, { "ratio", "Ratio" }, { "knee", "Knee" },
        { "attack", "Attack" },    { "release", "Release" }, { "curve", "Curve" },
        { "hold", "Hold" },        { "range", "Range" },  { "look", "Lookahead" },
        { "sc_hp", "SC HP" },      { "sc_lp", "SC LP" },  { "link", "Link" },
        { "in_gain", "Input" },    { "mix", "Mix" },      { "makeup", "Makeup" },
        { "xover1", "Xover 1" },   { "xover2", "Xover 2" },
        { "b1_off", "B1 Thresh" }, { "b1_gain", "B1 Gain" },
        { "b2_off", "B2 Thresh" }, { "b2_gain", "B2 Gain" },
        { "b3_off", "B3 Thresh" }, { "b3_gain", "B3 Gain" }
    };
    for (auto& d : DS) {
        auto dl = std::make_unique<Dial>(proc.apvts, d.id, d.cap);
        addAndMakeVisible(*dl);
        dials.push_back(std::move(dl));
    }

    auto bind = [this](juce::ToggleButton& b, const char* id) {
        addAndMakeVisible(b);
        btnAtt.push_back(std::make_unique<juce::AudioProcessorValueTreeState::ButtonAttachment>(
            proc.apvts, id, b));
    };
    bind(deltaBtn, "delta");
    bind(scBtn, "sc_on");
    bind(listenBtn, "sc_listen");
    bind(autoRelBtn, "auto_rel");
    bind(autoMkBtn, "auto_makeup");
    bind(bypassBtn, "bypass");
    bind(detOsBtn, "det_os");

    bandsBox.addItem("1 band", 1); bandsBox.addItem("2 bands", 2); bandsBox.addItem("3 bands", 3);
    addAndMakeVisible(bandsBox);
    bandsAtt = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment>(
        proc.apvts, "bands", bandsBox);
    syncBox.addItem("Rel: ms", 1);
    { const char* nm[10] = { "1/32","1/16","1/8","1/8.","1/4","1/4.","1/2","1/2.","1 bar","2 bars" };
      for (int i = 0; i < 10; ++i) syncBox.addItem(nm[i], i + 2); }
    addAndMakeVisible(syncBox);
    syncAtt = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment>(
        proc.apvts, "rel_sync", syncBox);
    placeBox.addItem("Left / Right", 1);
    placeBox.addItem("Mid / Side", 2);
    addAndMakeVisible(placeBox);
    placeAtt = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment>(
        proc.apvts, "place", placeBox);

    caseA.setClickingTogglesState(false);
    caseB.setClickingTogglesState(false);
    caseA.onClick = [this] { proc.recallCase(0); syncStyleButtons(); };
    caseB.onClick = [this] { proc.recallCase(1); syncStyleButtons(); };
    copyBtn.onClick = [this] { int other = 1 - proc.activeCase();
                               proc.recallCase(other); proc.recallCase(other); };
    addAndMakeVisible(caseA);
    addAndMakeVisible(caseB);
    addAndMakeVisible(copyBtn);

    setResizable(true, true);
    setResizeLimits(700, 560, 1600, 1100);
    setSize(880, 660);
}

RigorAudioProcessorEditor::~RigorAudioProcessorEditor()
{
    setLookAndFeel(nullptr);
}

void RigorAudioProcessorEditor::syncStyleButtons()
{
    const int cur = (int)proc.currentState().style;
    for (int i = 0; i < 4; ++i)
        styleBtn[i].setToggleState(i == cur, juce::dontSendNotification);
    caseA.setToggleState(proc.activeCase() == 0, juce::dontSendNotification);
    caseB.setToggleState(proc.activeCase() == 1, juce::dontSendNotification);
}

void RigorAudioProcessorEditor::paint(juce::Graphics& g)
{
    g.fillAll(BG);
    auto top = getLocalBounds().removeFromTop(38).reduced(14, 0);
    g.setColour(GOLD);
    g.setFont(juce::FontOptions(19.0f));
    g.drawText("R I G O R", top, juce::Justification::centredLeft);
    g.setColour(DIM);
    g.setFont(juce::FontOptions(11.5f));
    g.drawText("the body stops moving", top, juce::Justification::centredRight);
}

void RigorAudioProcessorEditor::resized()
{
    auto r = getLocalBounds().reduced(10);
    r.removeFromTop(30);

    auto styles = r.removeFromTop(28);
    const int sw = styles.getWidth() / 4;
    for (int i = 0; i < 4; ++i)
        styleBtn[i].setBounds(styles.removeFromLeft(sw).reduced(2));
    r.removeFromTop(8);

    auto disp = r.removeFromTop(juce::jmax(200, r.getHeight() / 2));
    curve.setBounds(disp.removeFromLeft(disp.getWidth() / 3).reduced(0, 0));
    disp.removeFromLeft(8);
    chart.setBounds(disp);
    r.removeFromTop(10);

    auto sw2 = r.removeFromBottom(26);
    const int bw = sw2.getWidth() / 13;
    deltaBtn.setBounds(sw2.removeFromLeft(bw));
    scBtn.setBounds(sw2.removeFromLeft(bw));
    listenBtn.setBounds(sw2.removeFromLeft(bw));
    autoRelBtn.setBounds(sw2.removeFromLeft(bw));
    autoMkBtn.setBounds(sw2.removeFromLeft(bw));
    bypassBtn.setBounds(sw2.removeFromLeft(bw));
    detOsBtn.setBounds(sw2.removeFromLeft(bw));
    placeBox.setBounds(sw2.removeFromLeft(bw).reduced(2));
    bandsBox.setBounds(sw2.removeFromLeft(bw).reduced(2));
    syncBox.setBounds(sw2.removeFromLeft(bw).reduced(2));
    caseA.setBounds(sw2.removeFromLeft(bw).reduced(2));
    caseB.setBounds(sw2.removeFromLeft(bw).reduced(2));
    copyBtn.setBounds(sw2.reduced(2));
    r.removeFromBottom(8);

    /* dials on a grid that reflows with the window */
    const int cols = juce::jmax(5, r.getWidth() / 108);
    const int rows = (int)((dials.size() + cols - 1) / cols);
    const int cw = r.getWidth() / cols;
    const int chh = juce::jmax(64, r.getHeight() / juce::jmax(1, rows));
    for (size_t i = 0; i < dials.size(); ++i) {
        const int cx = (int)(i % (size_t)cols), cy = (int)(i / (size_t)cols);
        dials[i]->setBounds(r.getX() + cx * cw, r.getY() + cy * chh, cw, chh);
    }
}
