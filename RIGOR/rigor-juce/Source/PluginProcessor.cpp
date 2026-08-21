/* RIGOR — PluginProcessor.cpp */
#include "PluginProcessor.h"
#include "PluginEditor.h"

using APVTS = juce::AudioProcessorValueTreeState;

static juce::NormalisableRange<float> skewed(float lo, float hi, float centreFrac)
{
    juce::NormalisableRange<float> r(lo, hi);
    r.setSkewForCentre(lo + (hi - lo) * centreFrac);
    return r;
}

APVTS::ParameterLayout RigorAudioProcessor::createLayout()
{
    using P = juce::AudioParameterFloat;
    using B = juce::AudioParameterBool;
    using C = juce::AudioParameterChoice;
    APVTS::ParameterLayout L;

    L.add(std::make_unique<B>(juce::ParameterID{ "bypass", 1 }, "Bypass", false));
    /* What bypass MEANS when a crossover exists. Off = dry and
       bit-transparent; on = still split and re-summed, uncompressed,
       so an A/B isolates the compression instead of the whole plugin.
       Inert at 1 band. */
    L.add(std::make_unique<B>(juce::ParameterID{ "bypass_split", 1 }, "Bypass Keeps Crossover", false));
    L.add(std::make_unique<C>(juce::ParameterID{ "style", 1 }, "Style",
                              juce::StringArray{ "Fresh", "Settling", "Spasm", "Repose" }, 0));
    L.add(std::make_unique<P>(juce::ParameterID{ "in_gain", 1 }, "Input Gain",
                              juce::NormalisableRange<float>(-24.f, 24.f, 0.1f), 0.f));
    L.add(std::make_unique<P>(juce::ParameterID{ "thresh", 1 }, "Threshold",
                              juce::NormalisableRange<float>(-60.f, 0.f, 0.1f), -18.f));
    /* 1000 is the infinity marker; the core turns it into an EXACT zero
       invR rather than 0.001, so infinity really is infinity. */
    L.add(std::make_unique<P>(juce::ParameterID{ "ratio", 1 }, "Ratio",
                              skewed(1.f, 1000.f, 0.06f), 4.f));
    L.add(std::make_unique<P>(juce::ParameterID{ "knee", 1 }, "Knee",
                              juce::NormalisableRange<float>(0.f, 30.f, 0.1f), 6.f));
    L.add(std::make_unique<P>(juce::ParameterID{ "attack", 1 }, "Attack",
                              skewed(0.02f, 500.f, 0.06f), 10.f));
    L.add(std::make_unique<P>(juce::ParameterID{ "release", 1 }, "Release",
                              skewed(1.f, 2500.f, 0.08f), 200.f));
    L.add(std::make_unique<B>(juce::ParameterID{ "auto_rel", 1 }, "Auto Release", false));
    L.add(std::make_unique<C>(juce::ParameterID{ "rel_sync", 1 }, "Release Sync",
                              juce::StringArray{ "Off", "1/32", "1/16", "1/8", "1/8.",
                                                 "1/4", "1/4.", "1/2", "1/2.", "1 bar", "2 bars" }, 0));
    L.add(std::make_unique<P>(juce::ParameterID{ "curve", 1 }, "Release Curve",
                              juce::NormalisableRange<float>(0.f, 100.f, 1.f), 0.f));
    L.add(std::make_unique<P>(juce::ParameterID{ "hold", 1 }, "Hold",
                              juce::NormalisableRange<float>(0.f, 500.f, 1.f), 0.f));
    /* 0 = the old cliff, and the core SKIPS the taper branch entirely
       there, so an un-set plugin renders like every existing baseline. */
    L.add(std::make_unique<P>(juce::ParameterID{ "hold_taper", 1 }, "Hold Taper",
                              juce::NormalisableRange<float>(0.f, 100.f, 1.f), 0.f));
    L.add(std::make_unique<P>(juce::ParameterID{ "range", 1 }, "Range",
                              juce::NormalisableRange<float>(0.f, 60.f, 0.5f), 60.f));
    L.add(std::make_unique<P>(juce::ParameterID{ "look", 1 }, "Lookahead",
                              juce::NormalisableRange<float>(0.f, 20.f, 0.1f), 0.f));
    L.add(std::make_unique<C>(juce::ParameterID{ "detect", 1 }, "Detection",
                              juce::StringArray{ "Auto", "Peak", "RMS" }, 0));
    L.add(std::make_unique<B>(juce::ParameterID{ "det_os", 1 }, "True-Peak Detection", false));
    /* A CHOICE, not a float: the legal phase counts are 2, 4 and 8, and a
       host automating a continuous 2..8 would ask for 5.3. Index 1 is the
       default so an un-set plugin renders like every existing baseline. */
    L.add(std::make_unique<C>(juce::ParameterID{ "det_os_x", 1 }, "True-Peak Phases",
                              juce::StringArray{ "2x", "4x", "8x" }, 1));
    L.add(std::make_unique<B>(juce::ParameterID{ "sc_on", 1 }, "Sidechain Filter", false));
    L.add(std::make_unique<P>(juce::ParameterID{ "sc_hp", 1 }, "SC Highpass",
                              skewed(10.f, 1000.f, 0.25f), 100.f));
    L.add(std::make_unique<P>(juce::ParameterID{ "sc_lp", 1 }, "SC Lowpass",
                              skewed(1000.f, 20000.f, 0.3f), 12000.f));
    L.add(std::make_unique<B>(juce::ParameterID{ "sc_listen", 1 }, "SC Listen", false));
    L.add(std::make_unique<P>(juce::ParameterID{ "link", 1 }, "Stereo Link",
                              juce::NormalisableRange<float>(0.f, 100.f, 1.f), 100.f));
    L.add(std::make_unique<C>(juce::ParameterID{ "place", 1 }, "Placement",
                              juce::StringArray{ "Left / Right", "Mid / Side" }, 0));
    L.add(std::make_unique<P>(juce::ParameterID{ "mix", 1 }, "Mix",
                              juce::NormalisableRange<float>(0.f, 100.f, 1.f), 100.f));
    L.add(std::make_unique<B>(juce::ParameterID{ "delta", 1 }, "Delta", false));
    /* Round 9 added these three to the core, the twin and the browser
       instrument, and never to the host. The coverage audit caught it;
       the plugin lint did not, because it asserted "at least 25 parameters"
       instead of deriving the number from the state. A floor cannot notice
       something missing. */
    L.add(std::make_unique<C>(juce::ParameterID{ "delta_band", 1 }, "Delta Band",
                              juce::StringArray{ "All", "Band 1", "Band 2", "Band 3" }, 0));
    L.add(std::make_unique<C>(juce::ParameterID{ "sc_band", 1 }, "Sidechain Band",
                              juce::StringArray{ "Off", "Band 1", "Band 2", "Band 3" }, 0));
    L.add(std::make_unique<P>(juce::ParameterID{ "ts_split", 1 }, "Transient Split",
                              juce::NormalisableRange<float>(0.f, 100.f, 1.f), 0.f));
    L.add(std::make_unique<P>(juce::ParameterID{ "makeup", 1 }, "Makeup",
                              juce::NormalisableRange<float>(-24.f, 24.f, 0.1f), 0.f));
    L.add(std::make_unique<B>(juce::ParameterID{ "auto_makeup", 1 }, "Auto Makeup", false));

    /* ---- multiband ---- */
    L.add(std::make_unique<C>(juce::ParameterID{ "bands", 1 }, "Bands",
                              juce::StringArray{ "1", "2", "3" }, 0));
    L.add(std::make_unique<P>(juce::ParameterID{ "xover1", 1 }, "Crossover 1",
                              skewed(20.f, 20000.f, 0.12f), 200.f));
    L.add(std::make_unique<P>(juce::ParameterID{ "xover2", 1 }, "Crossover 2",
                              skewed(20.f, 20000.f, 0.12f), 2000.f));
    for (int b = 0; b < rigor::MAX_BANDS; ++b) {
        auto n = juce::String(b + 1);
        L.add(std::make_unique<P>(juce::ParameterID{ "b" + n + "_off", 1 }, "Band " + n + " Threshold",
                                  juce::NormalisableRange<float>(-24.f, 24.f, 0.1f), 0.f));
        L.add(std::make_unique<P>(juce::ParameterID{ "b" + n + "_gain", 1 }, "Band " + n + " Gain",
                                  juce::NormalisableRange<float>(-24.f, 24.f, 0.1f), 0.f));
        L.add(std::make_unique<B>(juce::ParameterID{ "b" + n + "_mute", 1 }, "Band " + n + " Mute", false));
        L.add(std::make_unique<B>(juce::ParameterID{ "b" + n + "_solo", 1 }, "Band " + n + " Solo", false));
    }
    return L;
}

RigorAudioProcessor::RigorAudioProcessor()
    : AudioProcessor(BusesProperties()
        .withInput("Input", juce::AudioChannelSet::stereo(), true)
        .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, &undoMgr, "RIGOR", createLayout())
{
    for (int i = 0; i < rigor::MAX_BANDS; ++i) bGr[(size_t)i].store(0.f);
}

static float pv(const APVTS& a, const char* id)
{
    if (auto* p = a.getRawParameterValue(id)) return p->load();
    return 0.f;
}

rigor::State RigorAudioProcessor::buildState() const
{
    rigor::State s = rigor::defaultState();
    s.bypass    = pv(apvts, "bypass") > 0.5f;
    s.bypassSplit = pv(apvts, "bypass_split") > 0.5f;
    s.style     = (int)pv(apvts, "style");
    s.inGain    = pv(apvts, "in_gain");
    s.thresh    = pv(apvts, "thresh");
    s.ratio     = pv(apvts, "ratio");
    s.knee      = pv(apvts, "knee");
    s.attack    = pv(apvts, "attack");
    s.release   = pv(apvts, "release");
    s.autoRel   = pv(apvts, "auto_rel") > 0.5f;
    s.relSync   = (int)pv(apvts, "rel_sync");
    s.curve     = pv(apvts, "curve");
    s.hold      = pv(apvts, "hold");
    s.holdTaper = pv(apvts, "hold_taper");
    s.range     = pv(apvts, "range");
    s.look      = pv(apvts, "look");
    s.detect    = (int)pv(apvts, "detect");
    s.detOs     = pv(apvts, "det_os") > 0.5f;
    /* choice index -> the value the core wants. Table, not arithmetic:
       2 << index would work today and break the moment a 16x arrives. */
    {
        static const int OSX[3] = { 2, 4, 8 };
        int ix = (int)pv(apvts, "det_os_x");
        s.detOsX = (ix >= 0 && ix < 3) ? OSX[ix] : 4;
    }
    s.scOn      = pv(apvts, "sc_on") > 0.5f;
    s.scHp      = pv(apvts, "sc_hp");
    s.scLp      = pv(apvts, "sc_lp");
    s.scListen  = pv(apvts, "sc_listen") > 0.5f;
    s.link      = pv(apvts, "link");
    s.place     = (int)pv(apvts, "place");
    s.mix       = pv(apvts, "mix");
    s.delta     = pv(apvts, "delta") > 0.5f;
    s.deltaBand = (int)pv(apvts, "delta_band");
    s.scBand    = (int)pv(apvts, "sc_band");
    s.tsSplit   = pv(apvts, "ts_split");
    s.makeup    = pv(apvts, "makeup");
    s.autoMakeup= pv(apvts, "auto_makeup") > 0.5f;
    s.bands     = (int)pv(apvts, "bands") + 1;
    s.xover[0]  = pv(apvts, "xover1");
    s.xover[1]  = pv(apvts, "xover2");
    for (int b = 0; b < rigor::MAX_BANDS; ++b) {
        auto n = juce::String(b + 1);
        s.band[b].threshOff = pv(apvts, ("b" + n + "_off").toRawUTF8());
        s.band[b].gain      = pv(apvts, ("b" + n + "_gain").toRawUTF8());
        s.band[b].mute      = pv(apvts, ("b" + n + "_mute").toRawUTF8()) > 0.5f;
        s.band[b].solo      = pv(apvts, ("b" + n + "_solo").toRawUTF8()) > 0.5f;
    }
    /* Tempo comes from the host but lands in the STATE, so a synced
       release stays a pure function of the case file. */
    if (auto* ph = getPlayHead()) {
        if (auto pos = ph->getPosition())
            if (auto bpm = pos->getBpm())
                s.bpm = (double)*bpm;
    }
    return s;
}

void RigorAudioProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    engine = std::make_unique<rigor::Multi>(sampleRate);
    engine->setState(buildState());
    const size_t n = (size_t)juce::jmax(samplesPerBlock, 1);
    bL.assign(n, 0.0); bR.assign(n, 0.0);
    oL.assign(n, 0.0); oR.assign(n, 0.0);
    lastLatency = -1;
}

bool RigorAudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    const auto& main = layouts.getMainOutputChannelSet();
    if (main != juce::AudioChannelSet::stereo() && main != juce::AudioChannelSet::mono())
        return false;
    return layouts.getMainInputChannelSet() == main;
}

void RigorAudioProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    const int n = buffer.getNumSamples();
    if (!engine || n <= 0) return;

    if ((int)bL.size() < n) {
        bL.resize((size_t)n); bR.resize((size_t)n);
        oL.resize((size_t)n); oR.resize((size_t)n);
    }

    engine->setState(buildState());

    const int lat = engine->latency();
    if (lat != lastLatency) { lastLatency = lat; setLatencySamples(lat); }

    const int nIn = buffer.getNumChannels();
    const float* mL = buffer.getReadPointer(0);
    const float* mR = buffer.getReadPointer(nIn > 1 ? 1 : 0);
    float pk = 0.f;
    for (int i = 0; i < n; ++i) {
        bL[(size_t)i] = mL[i]; bR[(size_t)i] = mR[i];
        pk = juce::jmax(pk, std::abs(mL[i]));
    }
    inPk.store(pk);

    engine->process(bL.data(), bR.data(), oL.data(), oR.data(), n);

    float* wL = buffer.getWritePointer(0);
    float* wR = nIn > 1 ? buffer.getWritePointer(1) : nullptr;
    for (int i = 0; i < n; ++i) {
        wL[i] = (float)oL[(size_t)i];
        if (wR) wR[i] = (float)oR[(size_t)i];
    }

    auto m = engine->meters();
    grNow.store((float)m.gr);
    tpPk.store((float)juce::jmax(m.tpL, m.tpR));
    lufsS.store((float)m.lufsS);
    lufsI.store((float)m.lufsI);
    corr.store((float)m.corr);
    for (int i = 0; i < rigor::MAX_BANDS; ++i) bGr[(size_t)i].store((float)m.bandGr[i]);
}

void RigorAudioProcessor::recallCase(int slot)
{
    if (slot < 0 || slot >= NUM_CASES) return;
    /* a case recall is one discrete action and must be one undo step, not
       however many parameters happened to differ between the two slots */
    undoMgr.beginNewTransaction("recall case");
    caseSlot[curCase] = apvts.copyState().createCopy();
    caseValid[curCase] = true;
    if (caseValid[slot]) apvts.replaceState(caseSlot[slot].createCopy());
    curCase = slot;
}

juce::AudioProcessorEditor* RigorAudioProcessor::createEditor()
{
    return new RigorAudioProcessorEditor(*this);
}

void RigorAudioProcessor::getStateInformation(juce::MemoryBlock& dest)
{
    if (auto xml = apvts.copyState().createXml())
        copyXmlToBinary(*xml, dest);
}

void RigorAudioProcessor::setStateInformation(const void* data, int size)
{
    if (auto xml = getXmlFromBinary(data, size))
        if (xml->hasTagName(apvts.state.getType()))
            apvts.replaceState(juce::ValueTree::fromXml(*xml));
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new RigorAudioProcessor();
}
