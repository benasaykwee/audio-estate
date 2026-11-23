/* PALLBEARER — PluginProcessor.cpp */
#include "PluginProcessor.h"
#include "PluginEditor.h"
#include <cmath>
#include <cstring>

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
    /* Nothing is rendering while this runs, so the lock can be waited for.
       A layer loaded before playback starts is in the audio thread's hand
       from the first block, whoever holds the lock then. */
    layerAudio = currentLayer();
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
    /* The layer. See `layerLock` in the header: the lock is tried, never
       waited for, and a failed try changes nothing that is heard, because
       the audio thread goes on with the reference it already holds. The swap
       is a pointer copy and frees nothing (layerKeep holds every store). The
       core is handed the layer every block because prepareToPlay rebuilds
       the core and a pointer set once would not survive it. */
    {
        const juce::SpinLock::ScopedTryLockType layerHeld(layerLock);
        if (layerHeld.isLocked() && layerAudio != layerShared) layerAudio = layerShared;
    }
    core->setAttackLayer(layerAudio ? &layerAudio->view : nullptr);

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

   THE ATTACK LAYER IS SAVED AS AUDIO, NOT AS A PATH (2026-11-22). A path
   breaks the moment the file moves, which is worse than not saving at all,
   so the samples themselves go into the session: a child `AttackLayer`
   holding the raw doubles (JUCE writes a MemoryBlock property to XML as
   base64 and reads it back byte for byte), its own rate and its root. Raw
   doubles, not floats, because the reopened patch must render bit-identical
   to the saved one; the browser trims a layer to 0.6 s, about 230 KB.

   The stamp moves to 2 ONLY when a layer is present. A layer-less session
   stays version 1 and every build ever shipped reads it. A session whose
   sound depends on a layer is refused by a build that cannot carry one,
   which is the same rule as above: better refused than reopened silent.
   -------------------------------------------------------------------------- */
static const juce::Identifier kLayerTag("AttackLayer");

static bool layerIsPlayable(const std::vector<double>& d, double sr, double root);

void PallbearerAudioProcessor::getStateInformation(juce::MemoryBlock& dest)
{
    auto state = apvts.copyState();
    state.removeChild(state.getChildWithName(kLayerTag), nullptr);   // never two
    int version = 1;
    /* A reference, not a copy: the lock is held for one pointer and the
       samples are read after it is let go, which is safe because a stored
       layer is never written to again. A save during a note is inaudible. */
    if (const LayerRef saving = currentLayer()) {
        juce::ValueTree t(kLayerTag);
        t.setProperty("sr", saving->view.sr, nullptr);
        t.setProperty("root", saving->view.root, nullptr);
        t.setProperty("length", saving->view.length, nullptr);
        t.setProperty("data", juce::var(juce::MemoryBlock(saving->data.data(),
                                                          saving->data.size() * sizeof(double))), nullptr);
        state.appendChild(t, nullptr);
        version = 2;
    }
    state.setProperty("pallbearerVersion", version, nullptr);
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
    if (v > 2) return;

    /* The layer is read out and REMOVED before apvts takes the tree, so it
       never lives in apvts' own state and a later save cannot write it twice.
       A session with no layer clears any loaded one: the session is the
       truth about this patch, not whatever happened to be in memory. A
       stored layer that fails the same checks a live load must pass is
       dropped and the rest of the session still loads. */
    std::vector<double> restored;
    double lsr = 48000.0, lroot = 33.0;
    auto lt = tree.getChildWithName(kLayerTag);
    if (lt.isValid()) {
        if (auto* mb = lt.getProperty("data").getBinaryData()) {
            const int n = (int)lt.getProperty("length", 0);
            if (n > 0 && mb->getSize() == (size_t)n * sizeof(double)) {
                restored.resize((size_t)n);
                std::memcpy(restored.data(), mb->getData(), mb->getSize());
            }
        }
        lsr = (double)lt.getProperty("sr", 48000.0);
        lroot = (double)lt.getProperty("root", 33.0);
        tree.removeChild(lt, nullptr);
    }
    if (!restored.empty() && !layerIsPlayable(restored, lsr, lroot)) restored.clear();
    setAttackLayer(std::move(restored), lsr, lroot);

    apvts.replaceState(tree);
    lastTuningIdx = lastBodyF = lastBodyQ = lastWood = -1.f;
    lastCoilF = lastCoilQ = lastTone = -1.f;
    if (core) core->allOff();
}

/* ---- the attack layer ------------------------------------------------- */
static bool layerIsPlayable(const std::vector<double>& d, double sr, double root)
{
    if (d.size() < 2 || d.size() > (size_t)PallbearerAudioProcessor::kMaxLayerSamples) return false;
    if (!std::isfinite(sr) || sr < 8000.0 || sr > 384000.0) return false;
    if (!std::isfinite(root) || root < 0.0 || root > 127.0) return false;
    for (double v : d) if (!std::isfinite(v)) return false;
    return true;
}

PallbearerAudioProcessor::LayerRef PallbearerAudioProcessor::currentLayer() const
{
    const juce::SpinLock::ScopedLockType held(layerLock);
    return layerShared;
}

bool PallbearerAudioProcessor::setAttackLayer(std::vector<double> data, double sr, double root)
{
    if (!data.empty() && !layerIsPlayable(data, sr, root)) return false;

    /* Built in full before the lock is touched: the allocation, the move
       and the view all happen here, on the calling thread, unobserved. */
    LayerRef fresh;
    if (!data.empty()) {
        auto store = std::make_shared<LayerStore>();
        store->data = std::move(data);
        store->view.data = store->data.data();
        store->view.length = (int)store->data.size();
        store->view.sr = sr;
        store->view.root = root;
        fresh = std::move(store);
    }

    /* Room for both lists is made before the lock, so nothing allocates
       while it is held. Only this function writes layerKeep and it is
       message thread only, so reading its size here is reading our own. */
    std::vector<LayerRef> dead, keep;
    dead.reserve(layerKeep.size());
    keep.reserve(layerKeep.size() + 1);
    {
        const juce::SpinLock::ScopedLockType held(layerLock);
        layerShared = fresh;
        /* A store only layerKeep still holds can go. One the audio thread is
           still playing has a second holder and stays until the next call;
           the audio thread only repoints under this lock, so the count read
           here cannot be about to rise. A saver letting go late only makes
           the count read high, which keeps a store one call longer. */
        for (auto& k : layerKeep) {
            if (k.use_count() == 1) dead.push_back(std::move(k));
            else                    keep.push_back(std::move(k));
        }
        if (fresh) keep.push_back(fresh);
        layerKeep.swap(keep);
    }
    return true;                        // `dead` frees here, outside the lock, off the audio thread
}

bool PallbearerAudioProcessor::hasAttackLayer() const
{
    return currentLayer() != nullptr;
}

void PallbearerAudioProcessor::copyAttackLayer(std::vector<double>& data, double& sr, double& root) const
{
    const LayerRef l = currentLayer();
    if (l) { data = l->data; sr = l->view.sr; root = l->view.root; }
    else   { data.clear(); sr = 48000.0; root = 33.0; }
}

juce::AudioProcessorEditor* PallbearerAudioProcessor::createEditor()
{
    return new PallbearerAudioProcessorEditor(*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new PallbearerAudioProcessor();
}
