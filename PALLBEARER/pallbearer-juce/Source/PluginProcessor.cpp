/* PALLBEARER — PluginProcessor.cpp */
#include "PluginProcessor.h"
#include "PluginEditor.h"

using namespace pallbearer;

PallbearerAudioProcessor::PallbearerAudioProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "PALLBEARER", makeLayout())
{
    core = std::make_unique<PallbearerCore>(48000.0);
}

bool PallbearerAudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    // An instrument: no input bus, stereo or mono out.
    if (layouts.getMainInputChannels() != 0) return false;
    const auto out = layouts.getMainOutputChannelSet();
    return out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono();
}

void PallbearerAudioProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    currentSr = sampleRate;
    /* Rebuilt rather than resampled. Every delay line length, every filter
       coefficient and the whole delay budget are computed from sr, so a rate
       change is a new instrument, not a retune. */
    core = std::make_unique<PallbearerCore>(sampleRate);
    scratchL.assign((size_t)juce::jmax(1, samplesPerBlock), 0.0);
    scratchR.assign((size_t)juce::jmax(1, samplesPerBlock), 0.0);
    lastTuningIdx = lastBodyF = lastBodyQ = lastWood = -1.f;
    lastCoilF = lastCoilQ = lastTone = -1.f;
    pushParameters();
}

void PallbearerAudioProcessor::pushParameters()
{
    auto g = [this](const char* id) {
        auto* p = apvts.getRawParameterValue(id);
        jassert(p != nullptr);          // a typo'd id silently never moves
        return p ? p->load() : 0.0f;
    };
    auto& p = core->p;

    const float tIdx = g(pid::tuning);
    if (tIdx != lastTuningIdx) {
        const int i = juce::jlimit(0, tuningKeys().size() - 1, (int)tIdx);
        core->setTuning(tuningKeys()[i].toStdString());
        lastTuningIdx = tIdx;
    }

    p.frets     = g(pid::frets);
    p.capo      = g(pid::capo);
    p.decay     = g(pid::decay);
    p.damping   = g(pid::damping);
    p.inharm    = g(pid::inharm);
    p.stretch   = g(pid::stretch);
    p.style     = styleKeys()[juce::jlimit(0, 4, (int)g(pid::style))].toStdString();
    p.artic     = articKeys()[juce::jlimit(0, 4, (int)g(pid::artic))].toStdString();
    p.pluckPos  = g(pid::pluckPos);
    p.hardness  = g(pid::hardness);
    p.noise     = g(pid::noise);
    p.velBright = g(pid::velBright);
    p.buzz      = g(pid::buzz);
    p.relNoise  = g(pid::relNoise);
    p.fretNoise = g(pid::fretNoise);
    p.humanize  = g(pid::humanize);
    p.pickupA   = g(pid::pickupA);
    p.pickupB   = g(pid::pickupB);
    p.pickupMix = g(pid::pickupMix);
    p.pickupInv = polarityKeys()[juce::jlimit(0, 1, (int)g(pid::pickupInv))].toStdString();
    p.bodyFreq  = g(pid::bodyFreq);
    p.bodyQ     = g(pid::bodyQ);
    p.woodMix   = g(pid::woodMix);
    p.bodyMix   = g(pid::bodyMix);
    p.coilFreq  = g(pid::coilFreq);
    p.coilQ     = g(pid::coilQ);
    p.tone      = g(pid::tone);
    p.drive     = g(pid::drive);
    p.level     = g(pid::level);
    p.glide     = g(pid::glide);
    p.couple    = g(pid::couple);
    p.relDamp   = g(pid::relDamp);
    p.velSense  = g(pid::velSense);
    p.strGain   = g(pid::strGain);
    p.atkGain   = g(pid::atkGain);
    p.atkDecay  = g(pid::atkDecay);

    /* Filters are only recomputed when their inputs move. Recomputing a
       biquad every block would call nm::sin_ and nm::cos_ 128 times a second
       for nothing, and — worse — would reset nothing while looking like it
       might, which is the sort of thing that makes a bug hard to find. */
    const float bf = p.bodyFreq, bq = p.bodyQ, wm = p.woodMix;
    if (bf != lastBodyF || bq != lastBodyQ || wm != lastWood) {
        core->setBody(); lastBodyF = bf; lastBodyQ = bq; lastWood = wm;
    }
    const float cf = p.coilFreq, cq = p.coilQ;
    if (cf != lastCoilF || cq != lastCoilQ) {
        core->setCoil(); lastCoilF = cf; lastCoilQ = cq;
    }
    const float tn = p.tone;
    if (tn != lastTone) { core->recalcTone(); lastTone = tn; }
}

void PallbearerAudioProcessor::handleMidi(const juce::MidiMessage& m)
{
    if (m.isNoteOn()) {
        const int si = core->noteOn(m.getNoteNumber(), m.getFloatVelocity());
        if (si >= 0) {
            lastString.store(si);
            lastFret.store((int)core->handPos);
            lastNote.store(m.getNoteNumber());
        }
    } else if (m.isNoteOff()) {
        core->noteOff(m.getNoteNumber());
    } else if (m.isAllNotesOff() || m.isAllSoundOff()) {
        core->allOff();
        lastString.store(-1); lastFret.store(-1); lastNote.store(-1);
    }
}

void PallbearerAudioProcessor::processBlock(juce::AudioBuffer<float>& buffer,
                                            juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    const int n = buffer.getNumSamples();
    const int outCh = buffer.getNumChannels();
    buffer.clear();
    if (n <= 0) return;

    pushParameters();

    if ((int)scratchL.size() < n) { scratchL.assign((size_t)n, 0.0); scratchR.assign((size_t)n, 0.0); }

    /* Sample-accurate MIDI. Render up to each event, apply it, continue —
       a whole-block approximation would quantise every note to the block
       boundary, which at 512 samples is 10 ms of slop and audible on
       anything fast. */
    int pos = 0;
    for (const auto meta : midi) {
        const int at = juce::jlimit(0, n, meta.samplePosition);
        if (at > pos) {
            core->render(scratchL.data() + pos, scratchR.data() + pos, at - pos);
            pos = at;
        }
        handleMidi(meta.getMessage());
    }
    if (pos < n) core->render(scratchL.data() + pos, scratchR.data() + pos, n - pos);

    auto* L = buffer.getWritePointer(0);
    for (int i = 0; i < n; ++i) L[i] = (float)scratchL[(size_t)i];
    if (outCh > 1) {
        auto* R = buffer.getWritePointer(1);
        for (int i = 0; i < n; ++i) R[i] = (float)scratchR[(size_t)i];
    }

    soundingCount.store(core->soundingCount());
    midi.clear();
}

/* ---- state ---------------------------------------------------------------
   VERSION STAMP FROM DAY ONE. NECROPHONE's round-15 groundwork is blunt
   about this: a version cannot be added retroactively, because by the time
   you want it there are already sessions in the wild whose state has no
   version to read. Stamping an empty format costs nothing today and is
   impossible to arrange later.

   What is NOT saved yet: the attack layer's audio. A sampled or hybrid
   patch will not survive a session reload until that lands, and pretending
   otherwise by saving a file path would break the moment the file moved.
   -------------------------------------------------------------------------- */
void PallbearerAudioProcessor::getStateInformation(juce::MemoryBlock& dest)
{
    auto state = apvts.copyState();
    state.setProperty("pallbearerVersion", 1, nullptr);
    state.setProperty("coreVersion", juce::String(pallbearer::VERSION), nullptr);
    if (auto xml = state.createXml()) copyXmlToBinary(*xml, dest);
}

void PallbearerAudioProcessor::setStateInformation(const void* data, int size)
{
    auto xml = getXmlFromBinary(data, size);
    if (!xml) return;
    if (!xml->hasTagName(apvts.state.getType())) return;
    auto tree = juce::ValueTree::fromXml(*xml);
    if (!tree.isValid()) return;

    /* An unknown FUTURE version is refused rather than half-loaded: a newer
       plugin may have written parameters this build does not understand, and
       silently keeping the ones it recognises produces a patch that is
       neither the saved one nor the default. */
    const int v = (int)tree.getProperty("pallbearerVersion", 1);
    if (v > 1) return;

    apvts.replaceState(tree);
    lastTuningIdx = lastBodyF = lastBodyQ = lastWood = -1.f;
    lastCoilF = lastCoilQ = lastTone = -1.f;
    if (core) core->allOff();
}

juce::AudioProcessorEditor* PallbearerAudioProcessor::createEditor()
{
    return new PallbearerAudioProcessorEditor(*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new PallbearerAudioProcessor();
}
