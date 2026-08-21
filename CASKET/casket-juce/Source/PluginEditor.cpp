/* CASKET — PluginEditor.cpp — the bespoke face. */
#include "PluginEditor.h"

static const double TOP = 6.0, BOT = -60.0, GRMAX = 24.0;

static const juce::Colour C_SLAB   { 0xff0b0a0d };
static const juce::Colour C_CRYPT  { 0xff08070a };
static const juce::Colour C_PANEL  { 0xff130f1d };
static const juce::Colour C_LINE   { 0xff2a2433 };
static const juce::Colour C_BONE   { 0xffd8d2c4 };
static const juce::Colour C_DIM    { 0xff8a8494 };
static const juce::Colour C_GOLD   { 0xffc9a227 };
static const juce::Colour C_BLOOD  { 0xffd2405a };

/* the browser's UIH.dbToY / grToPx / meterFrac, so both faces map
   identically. If these two ever disagree, a screenshot from one instrument
   stops being evidence about the other.
   THE BODIES MOVED TO CasketCore.h on 2026-08-19 — they were `static` here,
   which meant no test could reach them while the browser's copies were
   asserted headlessly. These are thin casts now; the mapping itself is
   tested in tests/handoff_stress.cpp against the same cases UIH passes. */
static float dbToY(double d, float h)                { return (float)casket::dbToY(d, h, TOP, BOT); }
static float grToPx(double gr, float h)              { return (float)casket::grToPx(gr, h, GRMAX); }
static float meterFrac(double v, double lo, double hi) { return (float)casket::meterFrac(v, lo, hi); }

/* ======================= the house look ======================= */
CasketLook::CasketLook() {
    setColour(juce::Slider::textBoxTextColourId, C_BONE);
    setColour(juce::Slider::textBoxOutlineColourId, C_LINE);
    setColour(juce::Slider::textBoxBackgroundColourId, C_CRYPT);
    setColour(juce::ComboBox::backgroundColourId, C_CRYPT);
    setColour(juce::ComboBox::textColourId, C_BONE);
    setColour(juce::ComboBox::outlineColourId, C_LINE);
    setColour(juce::ComboBox::arrowColourId, C_GOLD);
    setColour(juce::PopupMenu::backgroundColourId, C_PANEL);
    setColour(juce::PopupMenu::textColourId, C_BONE);
    setColour(juce::PopupMenu::highlightedBackgroundColourId, C_BLOOD.withAlpha(0.35f));
    setColour(juce::Label::textColourId, C_DIM);
}

juce::Font CasketLook::getLabelFont(juce::Label&) {
    return juce::Font(11.0f);
}

void CasketLook::drawRotarySlider(juce::Graphics& g, int x, int y, int w, int h,
                                  float pos, float start, float end, juce::Slider& s) {
    auto r = juce::Rectangle<float>((float)x, (float)y, (float)w, (float)h).reduced(4.0f);
    const float rad = juce::jmin(r.getWidth(), r.getHeight()) * 0.5f;
    const auto c = r.getCentre();
    const float ang = start + pos * (end - start);

    g.setColour(C_CRYPT);
    g.fillEllipse(c.x - rad, c.y - rad, rad * 2, rad * 2);

    juce::Path track;
    track.addCentredArc(c.x, c.y, rad - 3.0f, rad - 3.0f, 0.0f, start, end, true);
    g.setColour(C_LINE);
    g.strokePath(track, juce::PathStrokeType(3.0f, juce::PathStrokeType::curved,
                                             juce::PathStrokeType::rounded));
    juce::Path fill;
    fill.addCentredArc(c.x, c.y, rad - 3.0f, rad - 3.0f, 0.0f, start, ang, true);
    g.setColour(s.isEnabled() ? C_GOLD : C_DIM);
    g.strokePath(fill, juce::PathStrokeType(3.0f, juce::PathStrokeType::curved,
                                            juce::PathStrokeType::rounded));

    juce::Path pointer;
    pointer.startNewSubPath(c.x, c.y - rad * 0.30f);
    pointer.lineTo(c.x, c.y - rad + 5.0f);
    g.setColour(C_BONE);
    g.strokePath(pointer, juce::PathStrokeType(2.0f),
                 juce::AffineTransform::rotation(ang, c.x, c.y));
    g.setColour(C_LINE);
    g.drawEllipse(c.x - rad, c.y - rad, rad * 2, rad * 2, 1.0f);
}

void CasketLook::drawToggleButton(juce::Graphics& g, juce::ToggleButton& b,
                                  bool over, bool) {
    auto r = b.getLocalBounds().toFloat().reduced(1.0f);
    const bool on = b.getToggleState();
    g.setColour(on ? C_BLOOD.withAlpha(0.22f) : C_CRYPT);
    g.fillRoundedRectangle(r, 4.0f);
    g.setColour(on ? C_BLOOD : (over ? C_DIM : C_LINE));
    g.drawRoundedRectangle(r, 4.0f, 1.0f);
    g.setColour(on ? C_BONE : C_DIM);
    g.setFont(juce::Font(10.5f));
    g.drawText(b.getButtonText(), b.getLocalBounds(), juce::Justification::centred);
}

void CasketLook::drawComboBox(juce::Graphics& g, int w, int h, bool,
                              int, int, int, int, juce::ComboBox&) {
    auto r = juce::Rectangle<float>(0, 0, (float)w, (float)h).reduced(1.0f);
    g.setColour(C_CRYPT);
    g.fillRoundedRectangle(r, 4.0f);
    g.setColour(C_LINE);
    g.drawRoundedRectangle(r, 4.0f, 1.0f);
    juce::Path a;
    a.addTriangle((float)w - 15, (float)h * 0.42f, (float)w - 7, (float)h * 0.42f,
                  (float)w - 11, (float)h * 0.62f);
    g.setColour(C_GOLD);
    g.fillPath(a);
}

/* ======================= the controls ======================= */
Dial::Dial(juce::AudioProcessorValueTreeState& apvts, const juce::String& pid,
           const juce::String& caption) : cap(caption) {
    slider.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
    slider.setTextBoxStyle(juce::Slider::TextBoxBelow, false, 66, 15);
    slider.setDoubleClickReturnValue(true, 0.0);
    addAndMakeVisible(slider);
    att = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(
        apvts, pid, slider);
}
void Dial::resized() {
    auto r = getLocalBounds();
    r.removeFromTop(13);
    slider.setBounds(r);
}
void Dial::paint(juce::Graphics& g) {
    g.setColour(C_DIM);
    g.setFont(juce::Font(9.5f));
    g.drawText(cap.toUpperCase(), getLocalBounds().removeFromTop(13),
               juce::Justification::centred);
}

Latch::Latch(juce::AudioProcessorValueTreeState& apvts, const juce::String& pid,
             const juce::String& caption) {
    button.setButtonText(caption.toUpperCase());
    addAndMakeVisible(button);
    att = std::make_unique<juce::AudioProcessorValueTreeState::ButtonAttachment>(
        apvts, pid, button);
}
void Latch::resized() { button.setBounds(getLocalBounds().reduced(2, 6)); }

Chooser::Chooser(juce::AudioProcessorValueTreeState& apvts, const juce::String& pid,
                 const juce::String& caption) : cap(caption) {
    if (auto* p = dynamic_cast<juce::AudioParameterChoice*>(apvts.getParameter(pid)))
        box.addItemList(p->choices, 1);
    addAndMakeVisible(box);
    att = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment>(
        apvts, pid, box);
}
void Chooser::resized() {
    auto r = getLocalBounds();
    r.removeFromTop(13);
    box.setBounds(r.removeFromTop(24).reduced(2, 0));
}
void Chooser::paint(juce::Graphics& g) {
    g.setColour(C_DIM);
    g.setFont(juce::Font(9.5f));
    g.drawText(cap.toUpperCase(), getLocalBounds().removeFromTop(13),
               juce::Justification::centred);
}

/* ======================= the editor ======================= */
CasketEditor::CasketEditor(CasketProcessor& p)
    : AudioProcessorEditor(&p), proc(p) {
    setLookAndFeel(&look);
    for (int i = 0; i < HIST; i++) { hIn[i] = -120.0f; hOut[i] = -120.0f; hGr[i] = 0.0f; }

    auto dial = [this](const char* pid, const char* cap) {
        auto* d = new Dial(proc.apvts, pid, cap);
        dials.add(d); addAndMakeVisible(d);
    };
    auto latch = [this](const char* pid, const char* cap) {
        auto* l = new Latch(proc.apvts, pid, cap);
        latches.add(l); addAndMakeVisible(l);
    };
    auto chooser = [this](const char* pid, const char* cap) {
        auto* c = new Chooser(proc.apvts, pid, cap);
        choosers.add(c); addAndMakeVisible(c);
    };

    /* THE RACK, in the browser's order. Every id below is asserted to
       exist by casket_plugin_test.js, and every parameter the core defines
       is asserted to appear somewhere in this constructor. */
    dial("drive", "Drive");        // 0
    dial("lid", "Lid");            // 1
    dial("margin", "Margin");      // 2
    dial("knee", "Knee");          // 3
    dial("vigil", "Vigil");        // 4
    dial("release", "Release");    // 5
    dial("hold", "Hold");          // 6
    dial("link", "Link");          // 7
    dial("sat", "Saturate");       // 8
    dial("ms_mid", "Mid");         // 9
    dial("ms_side", "Side");       // 10
    dial("target_lufs", "Target"); // 11

    chooser("style", "Arrangement");  // 0
    chooser("lining", "Lining");      // 1
    chooser("dust", "Dust");          // 2
    chooser("dust_bits", "Depth");    // 3

    latch("auto_rel", "Program");  // 0
    latch("seal", "Seal");         // 1
    latch("ms", "Mid/Side");       // 2
    latch("dc", "DC");             // 3
    latch("unity", "Unity");       // 4
    latch("bypass", "Bypass");     // 5

    auto grp = [this](juce::Label& l, const char* t) {
        l.setText(t, juce::dontSendNotification);
        l.setJustificationType(juce::Justification::centredLeft);
        l.setColour(juce::Label::textColourId, C_GOLD);
        l.setFont(juce::Font(9.5f));
        addAndMakeVisible(l);
    };
    grp(groupA, "THE LID");
    grp(groupB, "THE VIGIL");
    grp(groupC, "THE LINING");
    grp(groupD, "THE DUST");

    /* THE MINIMUM HEIGHT WAS TOO SMALL, and had been since before THE RANGE
       existed — found 2026-08-19 by arithmetic rather than by looking, which
       is the only way it could be found here.
       The top 340 px is a FIXED band (header + the three panes); `resized()`
       skips it entirely and lays out only the rack beneath. The rack needs
       four rows of 74 px plus four 14 px group labels = 352 px, and a 620 px
       window leaves it 620 − 340 − 12 = 268. The bottom row — THE DUST — was
       being laid out below the window edge at the smallest permitted size.
       704 is the exact fit; 720 leaves a little slack so a host that rounds
       a DPI scale down cannot reintroduce it. Nothing to do with the third
       pane: THE RANGE subdivides the fixed band and takes nothing from the
       rack. */
    setResizable(true, true);
    setResizeLimits(880, 720, 1800, 1200);
    setSize(940, 720);
    startTimerHz(30);
}

CasketEditor::~CasketEditor() { setLookAndFeel(nullptr); }

void CasketEditor::timerCallback() {
    proc.latestMeters(m);
    proc.latestTrace(tr);
    /* three rings, three sources. The input figure is measured before the
       drive, the output after the dither, and the weight is the deepest
       reduction inside the frame rather than whichever instant the timer
       happened to land on. */
    hIn[hIdx]  = (float)tr.inPeakDb;
    hOut[hIdx] = (float)tr.outPeakDb;
    hGr[hIdx]  = (float)tr.gr;
    hIdx = (hIdx + 1) % HIST;
    /* the processor republishes this about once a second; reading it at
       30 Hz just means most reads return the same snapshot, which costs a
       struct copy and keeps the draw path uniform */
    hasHist = proc.latestHistogram(hist);
    repaint();
}

void CasketEditor::resized() {
    auto r = getLocalBounds();
    r.removeFromTop(340);           /* header + viewing + plot are painted */
    auto rack = r.reduced(14, 6);

    const int rowH = 74;
    auto rowOf = [&rack, rowH]() { return rack.removeFromTop(rowH); };

    auto place = [](juce::Rectangle<int>& row, juce::Component* c, int w) {
        c->setBounds(row.removeFromLeft(w));
    };

    /* row 1 — the lid */
    auto lab1 = rack.removeFromTop(14);
    groupA.setBounds(lab1.removeFromLeft(200));
    auto r1 = rowOf();
    place(r1, dials[0], 84); place(r1, dials[1], 84);
    place(r1, dials[2], 84); place(r1, dials[3], 84);
    r1.removeFromLeft(18);
    place(r1, choosers[0], 116);
    r1.removeFromLeft(10);
    place(r1, latches[5], 78);

    /* row 2 — the vigil */
    auto lab2 = rack.removeFromTop(14);
    groupB.setBounds(lab2.removeFromLeft(200));
    auto r2 = rowOf();
    place(r2, dials[4], 84); place(r2, dials[5], 84);
    place(r2, dials[6], 84); place(r2, dials[7], 84);
    r2.removeFromLeft(18);
    place(r2, latches[0], 88);

    /* row 3 — the lining */
    auto lab3 = rack.removeFromTop(14);
    groupC.setBounds(lab3.removeFromLeft(200));
    auto r3 = rowOf();
    place(r3, choosers[1], 96);
    r3.removeFromLeft(8);
    place(r3, latches[1], 74);
    r3.removeFromLeft(14);
    place(r3, dials[8], 84);
    r3.removeFromLeft(14);
    place(r3, latches[2], 84);
    place(r3, dials[9], 84); place(r3, dials[10], 84);

    /* row 4 — the dust */
    auto lab4 = rack.removeFromTop(14);
    groupD.setBounds(lab4.removeFromLeft(200));
    auto r4 = rowOf();
    place(r4, choosers[2], 110);
    r4.removeFromLeft(8);
    place(r4, choosers[3], 96);
    r4.removeFromLeft(14);
    place(r4, dials[11], 84);
    r4.removeFromLeft(14);
    place(r4, latches[3], 66);
    place(r4, latches[4], 74);
}

void CasketEditor::paint(juce::Graphics& g) {
    g.fillAll(slab);
    auto r = getLocalBounds();
    auto top = r.removeFromTop(340);

    drawHeader(g, top.removeFromTop(44));

    /* Three panes now, as in the browser. THE RANGE is a distribution
       rather than a level, so it wants width more than height: it sits
       UNDER the plot, sharing the right-hand column, instead of stealing
       another 280 px from the viewing — which is the pane a user actually
       drags. */
    auto body = top.reduced(14, 6);
    auto rightCol = body.removeFromRight(280);
    body.removeFromRight(10);
    auto rangeArea = rightCol.removeFromBottom(rightCol.getHeight() / 2 - 3);
    rightCol.removeFromBottom(6);
    drawViewing(g, body);
    drawPlot(g, rightCol);
    drawRange(g, rangeArea);

    /* the rack's ground */
    g.setColour(panel.withAlpha(0.45f));
    g.fillRect(r);
    g.setColour(line);
    g.drawHorizontalLine(r.getY(), (float)r.getX(), (float)r.getRight());
}

void CasketEditor::drawHeader(juce::Graphics& g, juce::Rectangle<int> h) {
    auto header = h.reduced(14, 6);
    g.setColour(gold);
    g.setFont(juce::Font(24.0f));
    g.drawText("CASKET", header.removeFromLeft(140), juce::Justification::centredLeft);
    g.setColour(dim);
    g.setFont(juce::Font(12.5f));
    g.drawText("nothing gets out.", header.removeFromLeft(150),
               juce::Justification::centredLeft);

    juce::String tp = std::isfinite(m.truePeakDb)
        ? juce::String(m.truePeakDb, 2) + " dBTP" : juce::String("-inf");
    juce::String il = std::isfinite(m.integrated)
        ? juce::String(m.integrated, 1) + " LUFS" : juce::String("-inf LUFS");
    g.setColour(bone);
    g.setFont(juce::Font(12.0f));
    g.drawText("true peak " + tp + "     integrated " + il +
               "     weight " + juce::String(m.gr, 2) + " dB" +
               "     latency " + juce::String(m.latency) + " smp",
               header, juce::Justification::centredRight);
}

void CasketEditor::drawViewing(juce::Graphics& g, juce::Rectangle<int> area) {
    g.setColour(crypt);
    g.fillRect(area);
    g.setColour(line);
    g.drawRect(area, 1);

    const float x0 = (float)area.getX(), y0 = (float)area.getY();
    const float w = (float)area.getWidth(), h = (float)area.getHeight();

    g.setColour(juce::Colour(0xff1c1826));
    for (int db = 0; db >= -60; db -= 12) {
        float y = y0 + dbToY(db, h);
        g.drawHorizontalLine((int)y, x0, x0 + w);
    }

    const float step = w / (float)HIST;
    auto at = [this](const float* ring, int back) {
        int p = hIdx - 1 - back;
        while (p < 0) p += HIST;
        return ring[p];
    };
    auto trace = [&](const float* ring, juce::Colour c, float thick, bool fill) {
        juce::Path pth;
        for (int i = 0; i < HIST; i++) {
            float y = y0 + dbToY(at(ring, HIST - 1 - i), h);
            if (i == 0) pth.startNewSubPath(x0, y); else pth.lineTo(x0 + i * step, y);
        }
        if (fill) {
            juce::Path f(pth);
            f.lineTo(x0 + w, y0 + h);
            f.lineTo(x0, y0 + h);
            f.closeSubPath();
            g.setColour(c.withAlpha(0.13f));
            g.fillPath(f);
        }
        g.setColour(c);
        g.strokePath(pth, juce::PathStrokeType(thick));
    };

    /* the input, behind — dimmer and thinner, because it is context */
    trace(hIn, violet.withAlpha(0.55f), 1.0f, false);
    /* the output, in front */
    trace(hOut, jewel, 1.4f, true);

    /* the weight — hangs from the top of the frame in arterial red */
    juce::Path weight;
    weight.startNewSubPath(x0, y0);
    for (int i = 0; i < HIST; i++)
        weight.lineTo(x0 + i * step, y0 + grToPx(at(hGr, HIST - 1 - i), h * 0.42f));
    weight.lineTo(x0 + w, y0);
    weight.closeSubPath();
    g.setColour(blood.withAlpha(0.30f));
    g.fillPath(weight);

    /* the lid */
    casket::State st = proc.buildState();
    float ly = y0 + dbToY(st.lid + st.margin, h);
    g.setColour(gold);
    juce::Path lid, dashed;
    lid.startNewSubPath(x0, ly);
    lid.lineTo(x0 + w, ly);
    float dashes[] = { 6.0f, 4.0f };
    juce::PathStrokeType(1.6f).createDashedStroke(dashed, lid, dashes, 2);
    g.strokePath(dashed, juce::PathStrokeType(1.6f));
    g.setFont(juce::Font(11.0f));
    g.drawText("LID " + juce::String(st.lid, 1) + " dBTP",
               juce::Rectangle<float>(x0, ly - 16.0f, w - 6.0f, 14.0f),
               juce::Justification::centredRight);

    /* the key, so the two traces are not a guessing game */
    g.setFont(juce::Font(10.0f));
    g.setColour(violet);
    g.drawText("in", juce::Rectangle<float>(x0 + 8, y0 + 4, 40, 12),
               juce::Justification::centredLeft);
    g.setColour(jewel);
    g.drawText("out", juce::Rectangle<float>(x0 + 30, y0 + 4, 40, 12),
               juce::Justification::centredLeft);
    g.setColour(blood);
    g.drawText("weight", juce::Rectangle<float>(x0 + 60, y0 + 4, 60, 12),
               juce::Justification::centredLeft);
}

/* THE RANGE — the short-term loudness distribution the LRA figure is drawn
   from. Deliberately the same picture as casket.html's third pane, down to
   the colours: two faces of one program that disagree about what it
   measures are worse than one face.

   What is drawn, and why each part is here rather than in a tooltip:
     · a bar per populated 0.1 LU bin — where the record actually sat
     · gold lines at the 10th and 95th percentiles — the gap between them
       IS the LRA number in the plot beside it, not an illustration of it
     · a dashed red gate — bars left of it were measured, are shown, and
       were then excluded from that number, per EBU Tech 3342. Showing them
       greyed rather than hiding them is the point: if most of a record
       sits left of the gate, the reported range describes a smaller slice
       of it than a reader would assume.
   The kept/gated test is `loudness > gate`, matching the core's `<= gate`
   exclusion exactly — a bin sitting ON the gate is excluded. The browser
   has the same rule in UIH.histBinKept, asserted at the boundary and swept
   either side of it in casket_ui_test.js. */
void CasketEditor::drawRange(juce::Graphics& g, juce::Rectangle<int> area) {
    g.setColour(crypt);
    g.fillRect(area);
    g.setColour(line);
    g.drawRect(area, 1);

    auto inner = area.reduced(12, 10);
    g.setColour(dim);
    g.setFont(juce::Font(10.0f));
    g.drawText("THE RANGE", inner.removeFromTop(14), juce::Justification::topLeft);

    if (!hasHist) {
        g.setColour(dim.withAlpha(0.6f));
        g.setFont(juce::Font(11.0f));
        g.drawText("listening...", inner, juce::Justification::centred);
        return;
    }

    auto foot = inner.removeFromBottom(14);
    auto plot = inner.reduced(0, 4);

    const double LO = -40.0, HI = 0.0;
    auto xOf = [&](double loud) {
        double f = (loud - LO) / (HI - LO);
        f = f < 0 ? 0 : (f > 1 ? 1 : f);
        return (float)(plot.getX() + f * plot.getWidth());
    };

    double maxCount = 0;
    for (int i = 0; i < 751; i++) if (hist.counts[i] > maxCount) maxCount = hist.counts[i];
    if (maxCount <= 0) maxCount = 1;

    const float barW = juce::jmax(1.0f, (float)plot.getWidth() / (float)((HI - LO) / 0.1));
    for (int i = 0; i < 751; i++) {
        if (hist.counts[i] == 0) continue;
        double loud = -70.0 + (i + 0.5) * 0.1;
        if (loud < LO) continue;
        bool kept = !std::isfinite(hist.gate) || loud > hist.gate;
        float h = (float)(plot.getHeight() * (hist.counts[i] / maxCount));
        g.setColour(kept ? juce::Colour(0xff6b8fd2) : line.brighter(0.15f));
        g.fillRect(xOf(loud), (float)plot.getBottom() - h, barW, h);
    }

    if (std::isfinite(hist.gate)) {
        g.setColour(blood.withAlpha(0.6f));
        float gx = xOf(hist.gate);
        for (int y = plot.getY(); y < plot.getBottom(); y += 6)
            g.fillRect(gx, (float)y, 1.0f, 3.0f);            /* dashed, by hand */
    }
    g.setColour(gold.withAlpha(0.85f));
    if (hist.p10 != 0 || hist.p95 != 0) {
        g.fillRect(xOf(hist.p10), (float)plot.getY(), 1.0f, (float)plot.getHeight());
        g.fillRect(xOf(hist.p95), (float)plot.getY(), 1.0f, (float)plot.getHeight());
    }

    g.setColour(bone);
    g.setFont(juce::Font(11.0f));
    g.drawText(juce::String(hist.lra, 1) + " LU kept", foot, juce::Justification::centredLeft);
    g.setColour(dim);
    g.setFont(juce::Font(9.0f));
    g.drawText("-40", foot, juce::Justification::centred);
    g.drawText("0 LUFS", foot, juce::Justification::centredRight);
}

void CasketEditor::drawPlot(juce::Graphics& g, juce::Rectangle<int> area) {
    g.setColour(crypt);
    g.fillRect(area);
    g.setColour(line);
    g.drawRect(area, 1);

    auto inner = area.reduced(12, 10);
    g.setColour(dim);
    g.setFont(juce::Font(10.0f));
    g.drawText("THE PLOT", inner.removeFromTop(14), juce::Justification::topLeft);

    /* LRA and true peak get words, not a bar — a range is not a level */
    auto foot = inner.removeFromBottom(16);
    juce::String lra = std::isfinite(m.lra) ? juce::String(m.lra, 1) + " LU" : juce::String("—");
    g.setColour(dim);
    g.drawText("LRA " + lra, foot, juce::Justification::centredLeft);
    g.setColour(m.truePeak > 1.0 ? blood : dim);
    g.drawText(std::isfinite(m.truePeakDb) ? juce::String(m.truePeakDb, 2) + " dBTP"
                                           : juce::String("—"),
               foot, juce::Justification::centredRight);

    auto labels = inner.removeFromBottom(28);
    const int n = 4;
    const int bw = (inner.getWidth() - (n - 1) * 8) / n;
    struct Bar { const char* l; double v; juce::Colour c; bool isGr; };
    const Bar bars[4] = {
        { "M",  m.momentary, violet, false },
        { "S",  m.shortTerm, juce::Colour(0xff6b8fd2), false },
        { "I",  m.integrated, jewel, false },
        { "GR", m.gr, blood, true }
    };
    for (int i = 0; i < n; i++) {
        auto b = inner.withX(inner.getX() + i * (bw + 8)).withWidth(bw);
        float frac = bars[i].isGr ? meterFrac(-bars[i].v, 0, GRMAX)
                                  : meterFrac(bars[i].v, -40, 0);
        g.setColour(juce::Colour(0xff15121c));
        g.fillRect(b);
        g.setColour(bars[i].c);
        g.fillRect(b.withTrimmedTop((int)(b.getHeight() * (1.0f - frac))));
        g.setColour(line);
        g.drawRect(b, 1);
        g.setColour(dim);
        g.drawText(bars[i].l, labels.withX(b.getX()).withWidth(bw).removeFromTop(12),
                   juce::Justification::topLeft);
        g.setColour(bone);
        juce::String t = std::isfinite(bars[i].v) ? juce::String(bars[i].v, 1)
                                                  : juce::String("-inf");
        g.drawText(t, labels.withX(b.getX()).withWidth(bw).removeFromBottom(14),
                   juce::Justification::bottomLeft);
    }
}
