/* CASKET — PluginProcessor.cpp */
#include "PluginProcessor.h"
#include "PluginEditor.h"

using APVTS = juce::AudioProcessorValueTreeState;

static juce::String msText(float v, int) {
    return v < 10.0f ? juce::String(v, 2) + " ms" : juce::String((int)(v + 0.5f)) + " ms";
}
static juce::String dbText(float v, int) {
    return (v > 0 ? "+" : "") + juce::String(v, 1) + " dB";
}

APVTS::ParameterLayout CasketProcessor::layout() {
    APVTS::ParameterLayout l;
    using FP = juce::AudioParameterFloat;
    using CP = juce::AudioParameterChoice;
    using BP = juce::AudioParameterBool;
    auto id = [](const char* s) { return juce::ParameterID(s, 1); };

    l.add(std::make_unique<BP>(id("bypass"), "Bypass", false));
    l.add(std::make_unique<CP>(id("style"), "Arrangement",
          juce::StringArray{ "Pine", "Velvet", "Oak", "Iron", "Lead" }, 1));

    l.add(std::make_unique<FP>(id("drive"), "Drive",
          juce::NormalisableRange<float>(-12.0f, 24.0f, 0.1f), 0.0f,
          juce::AudioParameterFloatAttributes().withStringFromValueFunction(dbText)));
    l.add(std::make_unique<FP>(id("lid"), "Lid",
          juce::NormalisableRange<float>(-20.0f, 0.0f, 0.1f), -1.0f,
          juce::AudioParameterFloatAttributes().withStringFromValueFunction(
              [](float v, int) { return juce::String(v, 1) + " dBTP"; })));
    l.add(std::make_unique<FP>(id("margin"), "Margin",
          juce::NormalisableRange<float>(-1.0f, 0.0f, 0.05f), 0.0f));
    l.add(std::make_unique<FP>(id("knee"), "Knee",
          juce::NormalisableRange<float>(0.0f, 12.0f, 0.1f), 3.0f));

    /* 0.35 skew on the time constants — the same shape AUTOPSY's dynamic
       EQ uses, so a knob position means the same thing across the trilogy */
    l.add(std::make_unique<FP>(id("vigil"), "Vigil",
          juce::NormalisableRange<float>(0.1f, 20.0f, 0.01f, 0.35f), 2.0f,
          juce::AudioParameterFloatAttributes().withStringFromValueFunction(msText)));
    l.add(std::make_unique<FP>(id("release"), "Release",
          juce::NormalisableRange<float>(1.0f, 1000.0f, 1.0f, 0.35f), 150.0f,
          juce::AudioParameterFloatAttributes().withStringFromValueFunction(msText)));
    l.add(std::make_unique<BP>(id("auto_rel"), "Program Release", true));
    l.add(std::make_unique<FP>(id("hold"), "Hold",
          juce::NormalisableRange<float>(0.0f, 500.0f, 1.0f), 0.0f,
          juce::AudioParameterFloatAttributes().withStringFromValueFunction(msText)));

    l.add(std::make_unique<FP>(id("link"), "Link",
          juce::NormalisableRange<float>(0.0f, 100.0f, 1.0f), 100.0f));
    l.add(std::make_unique<CP>(id("lining"), "Lining",
          juce::StringArray{ "1x", "2x", "4x", "8x", "16x" }, 2));
    /* THE SEAL. Structural: it changes the latency and what CASKET
       guarantees, so the host is told about the new latency the moment it
       moves. See CasketCore.h and the architecture doc §6.3. */
    l.add(std::make_unique<BP>(id("seal"), "Seal", false));
    l.add(std::make_unique<FP>(id("sat"), "Saturate",
          juce::NormalisableRange<float>(0.0f, 100.0f, 1.0f), 0.0f));
    /* MID/SIDE. Three fields the JS core, the C++ twin, the fuzzer and the
       parity gate have all carried since the day M/S landed — and which no
       DAW could reach, because nobody added the parameters. It is not a
       compile error to omit a parameter; it is a feature that silently does
       not exist. `casket_plugin_test.js` now asserts the reverse direction
       (every core control is reachable) precisely because of this. */
    l.add(std::make_unique<BP>(id("ms"), "Mid/Side", false));
    l.add(std::make_unique<FP>(id("ms_mid"), "Mid Trim",
          juce::NormalisableRange<float>(-12.0f, 12.0f, 0.1f), 0.0f,
          juce::AudioParameterFloatAttributes().withStringFromValueFunction(dbText)));
    l.add(std::make_unique<FP>(id("ms_side"), "Side Trim",
          juce::NormalisableRange<float>(-12.0f, 12.0f, 0.1f), 0.0f,
          juce::AudioParameterFloatAttributes().withStringFromValueFunction(dbText)));
    l.add(std::make_unique<BP>(id("dc"), "DC Filter", true));
    l.add(std::make_unique<BP>(id("unity"), "Unity", false));

    l.add(std::make_unique<CP>(id("dust"), "Dither",
          juce::StringArray{ "Off", "Flat TPDF", "Shaped" }, 0));
    l.add(std::make_unique<CP>(id("dust_bits"), "Depth",
          juce::StringArray{ "16-bit", "20-bit", "24-bit" }, 0));
    l.add(std::make_unique<FP>(id("target_lufs"), "Target",
          juce::NormalisableRange<float>(-30.0f, -5.0f, 0.5f), -14.0f));
    return l;
}

CasketProcessor::CasketProcessor()
    : AudioProcessor(BusesProperties()
        .withInput("Input", juce::AudioChannelSet::stereo(), true)
        .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "CASKET", layout()) {}

casket::State CasketProcessor::buildState() const {
    casket::State s;
    auto f = [this](const char* n) { return apvts.getRawParameterValue(n)->load(); };
    s.bypass = f("bypass") > 0.5f;
    s.style = (int)f("style");
    s.drive = f("drive");
    s.lid = f("lid");
    s.margin = f("margin");
    s.knee = f("knee");
    s.vigil = f("vigil");
    s.release = f("release");
    s.autoRel = f("auto_rel") > 0.5f;
    s.hold = f("hold");
    s.link = f("link");
    static const int LIN[5] = { 1, 2, 4, 8, 16 };
    s.lining = LIN[juce::jlimit(0, 4, (int)f("lining"))];
    s.seal = f("seal") > 0.5f;
    s.sat = f("sat");
    s.ms = f("ms") > 0.5f;
    s.msMid = f("ms_mid");
    s.msSide = f("ms_side");
    s.dc = f("dc") > 0.5f;
    s.unity = f("unity") > 0.5f;
    s.dust = (int)f("dust");
    static const int BITS[3] = { 16, 20, 24 };
    s.dustBits = BITS[juce::jlimit(0, 2, (int)f("dust_bits"))];
    s.targetLufs = f("target_lufs");
    return casket::sanitize(s);
}

void CasketProcessor::refreshLatency() {
    int lat = casket::latencySamples(buildState(), sr);
    if (lat != lastLatency) {
        lastLatency = lat;
        setLatencySamples(lat);
    }
}

void CasketProcessor::prepareToPlay(double sampleRate, int samplesPerBlock) {
    sr = sampleRate;
    engine.prepare(sr);
    engine.setState(buildState());
    /* Size the scratch for the block the host promised OR the largest
       chunk we will ever hand the engine, whichever is bigger. After this
       point processBlock allocates nothing, ever — see the note there. */
    size_t cap = (size_t)juce::jmax(samplesPerBlock, MAX_CHUNK);
    dL.assign(cap, 0.0); dR.assign(cap, 0.0);
    oL.assign(cap, 0.0); oR.assign(cap, 0.0);
    lastLatency = -1;
    refreshLatency();

    /* Seed the editor-facing snapshots while the audio thread is not yet
       running (prepareToPlay is a safe point — the host guarantees no
       concurrent processBlock). Without this, an editor opened before the
       first block would read zero-initialised structs and briefly show
       0.0 LUFS / 0 dB instead of silence's honest −inf. */
    engine.meters(lastMeters);
    metersPub.publish(lastMeters);
    traceAcc = emptyTrace();
    lastTrace = traceAcc;
    tracePub.publish(traceAcc);

    /* histPub was the one publisher this seeding did not cover — added
       2026-08-21. Benign in itself: an unpublished Hist reads as zero bins,
       which is exactly what draws "listening...", and casket_host.js already
       asserts that. It is here for symmetry, because the same asymmetry in
       tests/handoff_stress.cpp (every arm seeded except the Hist-sized one)
       is what put a startup artefact on CI's books as a torn 6 KB payload
       and sent a session hunting a memory-ordering bug that did not exist.
       Three publishers, three seeds, no reader ever sees an empty slot. */
    {
        casket::Hist h;
        engine.histogram(h);
        histPub.publish(h);
    }
}

bool CasketProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    const auto& out = layouts.getMainOutputChannelSet();
    if (out != juce::AudioChannelSet::stereo() && out != juce::AudioChannelSet::mono())
        return false;
    return layouts.getMainInputChannelSet() == out;
}

void CasketProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) {
    juce::ScopedNoDenormals noDenormals;
    const int n = buffer.getNumSamples();
    const int nCh = buffer.getNumChannels();
    if (n == 0 || nCh == 0) return;

    /* Structural parameter changes reallocate inside the engine. That is
       not real-time safe, so it happens here only when something actually
       moved — and the host is told about the new latency the same way the
       browser tells the user. A limiter whose reported latency is a lie
       will smear every parallel path in the session. */
    engine.setState(buildState());
    refreshLatency();

    /* Service the editor's reset request here, on the thread that owns the
       meter — the button used to call engine.resetMeters() directly from
       the message thread, which raced every field the reset clears. */
    {
        unsigned req = meterResetReq.load(std::memory_order_acquire);
        if (meterResetSeen != req) { meterResetSeen = req; engine.resetMeters(); }
    }

    /* NO ALLOCATION HERE. The previous version resized the scratch
       vectors whenever the host sent more samples than it had promised in
       prepareToPlay — which is a heap allocation on the audio thread, and
       hosts do exactly that: pluginval at strictness 10 varies the block
       size between calls on purpose, and several hosts send a longer block
       during offline bounce than they prepared for.
       The fix is to CHUNK instead. The engine is block-size independent by
       construction (the control phase is carried across calls, which is why
       that bug was worth fixing properly rather than papering over), so
       feeding it in pieces of at most MAX_CHUNK is bit-identical to feeding
       it the whole block at once. `casket_test.js` asserts that identity
       rather than assuming it. */
    const float* inL = buffer.getReadPointer(0);
    const float* inR = buffer.getReadPointer(nCh > 1 ? 1 : 0);
    float* wL = buffer.getWritePointer(0);
    float* wR = nCh > 1 ? buffer.getWritePointer(1) : nullptr;
    const int cap = (int)dL.size();

    for (int off = 0; off < n; ) {
        const int take = juce::jmin(cap, n - off);
        for (int i = 0; i < take; i++) {
            dL[(size_t)i] = inL[off + i];
            dR[(size_t)i] = inR[off + i];
        }
        engine.process(&dL[0], &dR[0], &oL[0], &oR[0], take);
        for (int i = 0; i < take; i++) wL[off + i] = (float)oL[(size_t)i];
        if (wR) for (int i = 0; i < take; i++) wR[off + i] = (float)oR[(size_t)i];
        off += take;
    }

    /* ---- publish the editor's view, from the thread that owns the data ----
       No allocation, no locks: meters() walks arrays the engine owns, the
       Handoff publish is a struct copy and one release store. This is what
       makes latestMeters()/latestTrace() safe to call from the editor's
       timer — the message thread now reads a snapshot, never the engine.

       MEASURED, not assumed (casket_bench.js, 2026-08-19): meters() + trace()
       cost 12.2 µs per 512-sample block — ×1.023 of the render itself, or
       0.11% of the block period at 48 kHz. Worth measuring because this work
       is NEW in the real-time path: before the seam rewrite the editor did
       it on its own thread, and "we fixed a race and quietly bought a
       performance problem" is exactly the trade that ships unnoticed. It
       did not happen; the number is here so the next person does not have to
       take that on faith either. */
    casket::Meters m;
    engine.meters(m);
    metersPub.publish(m);

    /* trace: engine.trace() resets on read, and that is now harmless
       because the read happens HERE. Accumulate across blocks so the
       editor's 30 Hz frame sees every peak since its last frame, not just
       the final block's; clear only after the editor confirms a frame. */
    casket::Trace t;
    engine.trace(t);
    {
        unsigned req = traceResetReq.load(std::memory_order_acquire);
        if (traceResetSeen != req) { traceResetSeen = req; traceAcc = emptyTrace(); }
    }
    /* the fold rule lives in CasketCore.h so tests/handoff_stress.cpp can
       exercise it without JUCE — peaks as maxima, gr as a minimum */
    casket::foldTrace(traceAcc, t);
    tracePub.publish(traceAcc);

    /* THE RANGE, about once a second. Not per block: the chart describes a
       3 s short-term window, so a faster cadence redraws the same picture. */
    histCount += n;
    if (histCount >= (int)sr) {
        histCount = 0;
        casket::Hist h;
        engine.histogram(h);
        histPub.publish(h);
    }
}

juce::AudioProcessorEditor* CasketProcessor::createEditor() { return new CasketEditor(*this); }

void CasketProcessor::getStateInformation(juce::MemoryBlock& destData) {
    if (auto xml = apvts.copyState().createXml()) copyXmlToBinary(*xml, destData);
}
void CasketProcessor::setStateInformation(const void* data, int sizeInBytes) {
    if (auto xml = getXmlFromBinary(data, sizeInBytes))
        apvts.replaceState(juce::ValueTree::fromXml(*xml));
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new CasketProcessor(); }
