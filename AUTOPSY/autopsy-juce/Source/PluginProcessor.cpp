#include "PluginProcessor.h"
#include "PluginEditor.h"

using namespace autopsy;

static juce::String bandId(int b, const char* p) {
    return "b" + juce::String(b + 1) + "_" + p;
}

juce::AudioProcessorValueTreeState::ParameterLayout AutopsyProcessor::createLayout() {
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    juce::StringArray typeNames;
    for (int t = 0; t < NUM_TYPES; t++) typeNames.add(TYPE_NAMES[t]);

    auto freqRange = juce::NormalisableRange<float>(10.0f, 24000.0f,
        [](float lo, float hi, float norm) { return lo * std::pow(hi / lo, norm); },
        [](float lo, float hi, float val) { return std::log(val / lo) / std::log(hi / lo); });
    auto qRange = juce::NormalisableRange<float>(0.05f, 40.0f,
        [](float lo, float hi, float norm) { return lo * std::pow(hi / lo, norm); },
        [](float lo, float hi, float val) { return std::log(val / lo) / std::log(hi / lo); });

    juce::StringArray slopeNames { "6", "12", "18", "24", "36", "48" };
    juce::StringArray placeNames;
    for (int p = 0; p < NUM_PLACES; p++) placeNames.add(PLACE_NAMES[p]);

    for (int b = 0; b < MAX_BANDS; b++) {
        auto num = juce::String(b + 1);
        layout.add(std::make_unique<juce::AudioParameterBool>(
            juce::ParameterID(bandId(b, "on"), 1), "Incision " + num + " On", false));
        layout.add(std::make_unique<juce::AudioParameterChoice>(
            juce::ParameterID(bandId(b, "type"), 1), "Incision " + num + " Type", typeNames, 0));
        layout.add(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID(bandId(b, "freq"), 1), "Incision " + num + " Freq", freqRange, 1000.0f));
        layout.add(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID(bandId(b, "gain"), 1), "Incision " + num + " Gain",
            juce::NormalisableRange<float>(-30.0f, 30.0f, 0.01f), 0.0f));
        layout.add(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID(bandId(b, "q"), 1), "Incision " + num + " Q", qRange, 1.0f));
        layout.add(std::make_unique<juce::AudioParameterChoice>(
            juce::ParameterID(bandId(b, "slope"), 1), "Incision " + num + " Slope", slopeNames, 1));
        layout.add(std::make_unique<juce::AudioParameterChoice>(
            juce::ParameterID(bandId(b, "place"), 1), "Incision " + num + " Place", placeNames, 0));
        layout.add(std::make_unique<juce::AudioParameterBool>(
            juce::ParameterID(bandId(b, "dyn_on"), 1), "Incision " + num + " Dynamic", false));
        layout.add(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID(bandId(b, "dyn_range"), 1), "Incision " + num + " Dyn Range",
            juce::NormalisableRange<float>(-24.0f, 24.0f, 0.1f), 0.0f));
        layout.add(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID(bandId(b, "dyn_thresh"), 1), "Incision " + num + " Dyn Threshold",
            juce::NormalisableRange<float>(-60.0f, 0.0f, 0.1f), -30.0f));
        layout.add(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID(bandId(b, "dyn_att"), 1), "Incision " + num + " Dyn Attack",
            juce::NormalisableRange<float>(0.1f, 500.0f, 0.1f, 0.35f), 10.0f));
        layout.add(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID(bandId(b, "dyn_rel"), 1), "Incision " + num + " Dyn Release",
            juce::NormalisableRange<float>(1.0f, 2000.0f, 1.0f, 0.35f), 150.0f));
    }
    layout.add(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID("out_gain", 1), "Output Gain",
        juce::NormalisableRange<float>(-24.0f, 24.0f, 0.01f), 0.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID("out_pan", 1), "Output Pan",
        juce::NormalisableRange<float>(-1.0f, 1.0f, 0.01f), 0.0f));
    return layout;
}

AutopsyProcessor::AutopsyProcessor()
    : juce::AudioProcessor(BusesProperties()
          .withInput("Input", juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "AUTOPSY", createLayout()) {
    for (int b = 0; b < MAX_BANDS; b++) {
        bandParams[b].on = apvts.getRawParameterValue(bandId(b, "on"));
        bandParams[b].type = apvts.getRawParameterValue(bandId(b, "type"));
        bandParams[b].freq = apvts.getRawParameterValue(bandId(b, "freq"));
        bandParams[b].gain = apvts.getRawParameterValue(bandId(b, "gain"));
        bandParams[b].q = apvts.getRawParameterValue(bandId(b, "q"));
        bandParams[b].slope = apvts.getRawParameterValue(bandId(b, "slope"));
        bandParams[b].place = apvts.getRawParameterValue(bandId(b, "place"));
        bandParams[b].dynOn = apvts.getRawParameterValue(bandId(b, "dyn_on"));
        bandParams[b].dynRange = apvts.getRawParameterValue(bandId(b, "dyn_range"));
        bandParams[b].dynThresh = apvts.getRawParameterValue(bandId(b, "dyn_thresh"));
        bandParams[b].dynAtt = apvts.getRawParameterValue(bandId(b, "dyn_att"));
        bandParams[b].dynRel = apvts.getRawParameterValue(bandId(b, "dyn_rel"));
    }
    outGainParam = apvts.getRawParameterValue("out_gain");
    outPanParam = apvts.getRawParameterValue("out_pan");
}

State AutopsyProcessor::buildState() const {
    State s;
    for (int b = 0; b < MAX_BANDS; b++) {
        s.bands[b].on = bandParams[b].on->load() >= 0.5f;
        int t = (int)bandParams[b].type->load();
        s.bands[b].type = (t >= 0 && t < NUM_TYPES) ? (BandType)t : BELL;
        s.bands[b].freq = (double)bandParams[b].freq->load();
        s.bands[b].gain = (double)bandParams[b].gain->load();
        s.bands[b].q = (double)bandParams[b].q->load();
        int sl = (int)bandParams[b].slope->load();
        s.bands[b].slope = (sl >= 0 && sl < 6) ? SLOPES[sl] : 12;
        int pl = (int)bandParams[b].place->load();
        s.bands[b].place = (pl >= 0 && pl < NUM_PLACES) ? (Place)pl : P_ST;
        s.bands[b].dyn.on = bandParams[b].dynOn->load() >= 0.5f;
        s.bands[b].dyn.range = (double)bandParams[b].dynRange->load();
        s.bands[b].dyn.thresh = (double)bandParams[b].dynThresh->load();
        s.bands[b].dyn.att = (double)bandParams[b].dynAtt->load();
        s.bands[b].dyn.rel = (double)bandParams[b].dynRel->load();
    }
    s.outGain = (double)outGainParam->load();
    s.outPan = (double)outPanParam->load();
    return s;
}

void AutopsyProcessor::prepareToPlay(double sampleRate, int) {
    sr = sampleRate;
    engine = std::make_unique<Engine>(sampleRate);
    engine->setState(buildState());
}

bool AutopsyProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    auto in = layouts.getMainInputChannelSet();
    auto out = layouts.getMainOutputChannelSet();
    if (in != out) return false;
    return in == juce::AudioChannelSet::mono() || in == juce::AudioChannelSet::stereo();
}

void AutopsyProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) {
    juce::ScopedNoDenormals noDenormals;
    if (!engine) return;
    engine->setState(buildState());

    int n = buffer.getNumSamples();
    const float* inL = buffer.getReadPointer(0);
    const float* inR = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : inL;
    float* outL = buffer.getWritePointer(0);
    float* outR = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : outL;
    engine->processFloat(inL, inR, outL, outR, n);
}

void AutopsyProcessor::getStateInformation(juce::MemoryBlock& destData) {
    if (auto xml = apvts.copyState().createXml())
        copyXmlToBinary(*xml, destData);
}

void AutopsyProcessor::setStateInformation(const void* data, int sizeInBytes) {
    if (auto xml = getXmlFromBinary(data, sizeInBytes))
        if (xml->hasTagName(apvts.state.getType()))
            apvts.replaceState(juce::ValueTree::fromXml(*xml));
}

juce::AudioProcessorEditor* AutopsyProcessor::createEditor() {
    return new AutopsyEditor(*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new AutopsyProcessor();
}
