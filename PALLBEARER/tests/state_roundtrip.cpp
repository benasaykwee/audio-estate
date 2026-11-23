/* PALLBEARER: does a session save carry the attack layer?
   tests/state_roundtrip.cpp

   The real processor, not a model of it: PluginProcessor.cpp compiled
   against real JUCE, driven through the exact calls a host makes.

     A  load a layer, set the sampled path (strGain 0, atkGain 0.8)
     A  getStateInformation      (the host saves the session)
     B  a fresh processor, setStateInformation   (the host reopens it)
     A and B each play the same note; the two renders must be bit-identical
     and not silent.

   Before the fix, B reopened with no layer and the sampled patch was
   silent, which is the README's "reloads silent", reproduced rather than
   described.

   SECTION V (2026-11-23): a save DURING a note. processBlock only ever
   tries the layer lock. This test is the host that holds it at the worst
   moment, deterministically, through PallbearerTestAccess (a friend of the
   processor that nothing in the plugin uses). The note must render
   bit-identical to one nobody interrupted. Against the code before the fix
   this section fails: the first contended block ended the sampled attack
   for good.

   BUILD (no host, no listening; about two minutes the first time):
     cmake -S PALLBEARER/pallbearer-juce -B <dir> -DPALLBEARER_TESTS=ON \
           -DFETCHCONTENT_SOURCE_DIR_JUCE=<a JUCE 7.0.12 checkout>
     cmake --build <dir> --target PallbearerStateTest
     <dir>/PallbearerStateTest_artefacts/PallbearerStateTest
   (under Release/ or Debug/ when a build type is given, which is why CI
   finds the binary rather than naming it). CI runs exactly this in the
   macOS job of .github/workflows/pallbearer.yml.                      */
#include <juce_audio_processors/juce_audio_processors.h>
#include "../pallbearer-juce/Source/PluginProcessor.h"
#include <cmath>
#include <cstdio>
#include <functional>
#include <vector>

/* The test's hand on the processor's private lock and its keep list. */
struct PallbearerTestAccess {
    static void lock(PallbearerAudioProcessor& p)   { p.layerLock.enter(); }
    static void unlock(PallbearerAudioProcessor& p) { p.layerLock.exit(); }
    static int kept(PallbearerAudioProcessor& p)    { return (int)p.layerKeep.size(); }
    static long audioRefs(PallbearerAudioProcessor& p) { return p.layerAudio ? p.layerAudio.use_count() : 0; }
};

static int pass = 0, fail = 0;
static void ok(const char* name, bool cond, const juce::String& detail = {})
{
    if (cond) ++pass; else ++fail;
    std::printf("  %s %s%s%s\n", cond ? "\xE2\x9C\x93" : "\xE2\x9C\x97", name,
                detail.isEmpty() ? "" : "   ", detail.toRawUTF8());
}

static void setParam(PallbearerAudioProcessor& p, const char* id, float value)
{
    auto* prm = p.apvts.getParameter(id);
    jassert(prm != nullptr);
    prm->setValueNotifyingHost(prm->convertTo0to1(value));
}

/* a deterministic struck-wire transient: decaying partials plus a click */
static std::vector<double> makeLayer(int n, double sr)
{
    std::vector<double> d((size_t)n);
    std::uint32_t s = 0x2545F491u;
    for (int i = 0; i < n; ++i) {
        s ^= s << 13; s ^= s >> 17; s ^= s << 5;
        const double t = i / sr, noise = (double)(s & 0xFFFF) / 32768.0 - 1.0;
        d[(size_t)i] = std::exp(-t * 9.0) * (0.5 * std::sin(6.283185307179586 * 82.4 * t)
                     + 0.25 * std::sin(6.283185307179586 * 164.8 * t))
                     + std::exp(-t * 120.0) * 0.3 * noise;
    }
    return d;
}

/* `contended(b)` true: block b is rendered while somebody else holds the
   layer lock, so processBlock's try fails. `between(b)` runs after block b,
   on this thread, the way a host calls into a plugin between callbacks. */
static std::vector<float> playNote(PallbearerAudioProcessor& p, int blocks,
                                   const std::function<bool(int)>& contended = {},
                                   const std::function<void(int)>& between = {})
{
    const int bs = 256;
    juce::AudioBuffer<float> buf(2, bs);
    std::vector<float> out;
    for (int b = 0; b < blocks; ++b) {
        juce::MidiBuffer midi;
        if (b == 0) midi.addEvent(juce::MidiMessage::noteOn(1, 40, (juce::uint8)110), 0);
        const bool held = contended && contended(b);
        if (held) PallbearerTestAccess::lock(p);
        p.processBlock(buf, midi);
        if (held) PallbearerTestAccess::unlock(p);
        if (between) between(b);
        const float* L = buf.getReadPointer(0);
        out.insert(out.end(), L, L + bs);
    }
    return out;
}

static double rms(const std::vector<float>& v)
{
    double s = 0; for (float x : v) s += (double)x * x;
    return std::sqrt(s / juce::jmax<size_t>(1, v.size()));
}

int main()
{
    juce::ScopedJuceInitialiser_GUI juce;   // apvts wants a message manager
    const double SR = 48000.0, LAYER_SR = 44100.0, ROOT = 40.0;
    const auto data = makeLayer(26460, LAYER_SR);

    std::printf("\n-- I . the seam itself\n");
    PallbearerAudioProcessor a;
    a.prepareToPlay(SR, 256);
    ok("a fresh processor has no attack layer", !a.hasAttackLayer());
    ok("a layer with a NaN in it is refused", !a.setAttackLayer({ 0.1, std::nan(""), 0.2 }, LAYER_SR, ROOT));
    ok("a layer at an absurd rate is refused", !a.setAttackLayer(data, 10.0, ROOT));
    ok("a refused layer leaves the processor without one", !a.hasAttackLayer());
    ok("a real layer is accepted", a.setAttackLayer(data, LAYER_SR, ROOT));
    setParam(a, "strGain", 0.0f);
    setParam(a, "atkGain", 0.8f);

    std::printf("\n-- II . the session round trip\n");
    juce::MemoryBlock saved;
    a.getStateInformation(saved);
    ok("the saved state is not empty", saved.getSize() > 0, juce::String((int)saved.getSize()) + " bytes");

    PallbearerAudioProcessor b;
    b.prepareToPlay(SR, 256);
    b.setStateInformation(saved.getData(), (int)saved.getSize());

    std::vector<double> bd; double bsr = 0, broot = 0;
    b.copyAttackLayer(bd, bsr, broot);
    ok("the reopened session HAS the attack layer", b.hasAttackLayer());
    ok("every sample came back bit-exact", bd == data,
       juce::String((int)bd.size()) + " of " + juce::String((int)data.size()));
    ok("its own sample rate came back", bsr == LAYER_SR, juce::String(bsr));
    ok("its root note came back", broot == ROOT, juce::String(broot));
    ok("the parameters came back too",
       b.apvts.getRawParameterValue("atkGain")->load() == a.apvts.getRawParameterValue("atkGain")->load()
       && b.apvts.getRawParameterValue("strGain")->load() == 0.0f);

    std::printf("\n-- III . and it SOUNDS the same\n");
    const auto ra = playNote(a, 120), rb = playNote(b, 120);
    ok("the saved patch is not silent (the sampled path is live)", rms(ra) > 1e-4, juce::String(rms(ra), 6));
    ok("the reopened patch is not silent", rms(rb) > 1e-4, juce::String(rms(rb), 6));
    ok("the two renders are bit-identical", ra == rb);

    std::printf("\n-- IV . what must NOT come back\n");
    PallbearerAudioProcessor c;
    c.prepareToPlay(SR, 256);
    juce::MemoryBlock plain;
    c.getStateInformation(plain);
    PallbearerAudioProcessor d2;
    d2.prepareToPlay(SR, 256);
    d2.setAttackLayer(data, LAYER_SR, ROOT);
    d2.setStateInformation(plain.getData(), (int)plain.getSize());
    ok("a session saved WITHOUT a layer clears one on load", !d2.hasAttackLayer());
    {
        auto xml = juce::AudioProcessor::getXmlFromBinary(plain.getData(), (int)plain.getSize());
        ok("a layer-less session is still stamped version 1, readable by every build",
           xml != nullptr && (int)xml->getIntAttribute("pallbearerVersion") == 1);
        auto xl = juce::AudioProcessor::getXmlFromBinary(saved.getData(), (int)saved.getSize());
        ok("a session WITH a layer is stamped version 2", xl != nullptr && xl->getIntAttribute("pallbearerVersion") == 2);
    }
    {
        /* the stored layer is a child of the saved tree; it must not leak into
           apvts' own state, or every later save would carry two */
        juce::MemoryBlock again;
        b.getStateInformation(again);
        auto xml = juce::AudioProcessor::getXmlFromBinary(again.getData(), (int)again.getSize());
        int layers = 0;
        if (xml) for (auto* e : xml->getChildIterator()) if (e->hasTagName("AttackLayer")) ++layers;
        ok("saving a reopened session writes exactly one layer", layers == 1, juce::String(layers));
    }
    {
        /* a corrupt layer in a saved session is dropped, the parameters kept */
        auto xml = juce::AudioProcessor::getXmlFromBinary(saved.getData(), (int)saved.getSize());
        if (xml) if (auto* e = xml->getChildByName("AttackLayer")) e->setAttribute("sr", 3.0);
        juce::MemoryBlock bad;
        if (xml) juce::AudioProcessor::copyXmlToBinary(*xml, bad);
        PallbearerAudioProcessor e2;
        e2.prepareToPlay(SR, 256);
        e2.setStateInformation(bad.getData(), (int)bad.getSize());
        ok("a corrupt stored layer is refused, not played", !e2.hasAttackLayer());
        ok("and the rest of that session still loads", e2.apvts.getRawParameterValue("strGain")->load() == 0.0f);
    }

    std::printf("\n-- V . a save during a note changes nothing that is heard\n");
    {
        auto fresh = [&](PallbearerAudioProcessor& p) {
            p.prepareToPlay(SR, 256);
            p.setAttackLayer(data, LAYER_SR, ROOT);
            setParam(p, "strGain", 0.0f);
            setParam(p, "atkGain", 0.8f);
        };
        PallbearerAudioProcessor q0; fresh(q0);
        const auto ref = playNote(q0, 120);
        ok("the uninterrupted note is not silent", rms(ref) > 1e-4, juce::String(rms(ref), 6));
        /* the attack is still sounding in the blocks about to be contended,
           or this section would prove nothing */
        double mid = 0; for (int i = 256 * 3; i < 256 * 9; ++i) mid += (double)ref[(size_t)i] * ref[(size_t)i];
        ok("the attack is still sounding where the lock will be held", mid > 1e-6, juce::String(mid, 6));

        PallbearerAudioProcessor q1; fresh(q1);
        const auto r1 = playNote(q1, 120, [](int b) { return b >= 3 && b < 9; });
        ok("blocks rendered while the lock is HELD ELSEWHERE are bit-identical", r1 == ref);

        PallbearerAudioProcessor q2; fresh(q2);
        int saves = 0; size_t savedBytes = 0;
        const auto r2 = playNote(q2, 120, {}, [&](int b) {
            if (b % 2 == 0 && b < 40) { juce::MemoryBlock m; q2.getStateInformation(m); ++saves; savedBytes = m.getSize(); }
        });
        ok("twenty real saves between blocks of the note are bit-identical", r2 == ref,
           juce::String(saves) + " saves, " + juce::String((int)savedBytes) + " bytes each");
        ok("and a save made mid-note is the same session as one made at rest", savedBytes == saved.getSize());

        /* contended from the very first block: prepareToPlay has already put
           the layer in the audio thread's hand, so even that note has it */
        PallbearerAudioProcessor q3;
        q3.setAttackLayer(data, LAYER_SR, ROOT);
        setParam(q3, "strGain", 0.0f);
        setParam(q3, "atkGain", 0.8f);
        q3.prepareToPlay(SR, 256);
        const auto r3 = playNote(q3, 120, [](int) { return true; });
        ok("a session loaded before playback plays its layer even if the lock is NEVER free", r3 == ref);

        /* the one case a try-lock cannot rescue, stated rather than hidden:
           a layer loaded while audio is running reaches the audio thread at
           the first block whose try succeeds, and not before */
        PallbearerAudioProcessor q4; fresh(q4);
        const auto r4 = playNote(q4, 120, [](int b) { return b == 0; });
        ok("(known limit) a layer loaded DURING playback is not heard until one try succeeds",
           rms(r4) < rms(ref) * 0.01, juce::String(rms(r4), 6));
    }

    std::printf("\n-- VI . the audio thread never frees a layer\n");
    {
        PallbearerAudioProcessor r;
        r.prepareToPlay(SR, 256);
        juce::AudioBuffer<float> buf(2, 256);
        auto block = [&] { juce::MidiBuffer m; r.processBlock(buf, m); };
        const auto other = makeLayer(4000, LAYER_SR);

        r.setAttackLayer(data, LAYER_SR, ROOT);
        block();                                         // the audio thread now plays layer 1
        ok("a loaded layer is kept alive off the audio thread", PallbearerTestAccess::kept(r) == 1);
        r.setAttackLayer(other, LAYER_SR, ROOT);          // layer 1 replaced while still being played
        ok("a replaced layer the audio thread still plays is NOT freed", PallbearerTestAccess::kept(r) == 2);
        block();                                         // the audio thread lets go of layer 1
        ok("when the audio thread moves on, it was not the last holder",
           PallbearerTestAccess::kept(r) == 2 && PallbearerTestAccess::audioRefs(r) >= 2,
           juce::String((int)PallbearerTestAccess::audioRefs(r)) + " holders of the one it plays");
        r.setAttackLayer({}, LAYER_SR, ROOT);             // cleared: layer 1 can go, layer 2 is still played
        ok("the next load frees the abandoned layer, on the calling thread", PallbearerTestAccess::kept(r) == 1);
        ok("clearing reports no layer at once", !r.hasAttackLayer());
        block();
        r.setAttackLayer({}, LAYER_SR, ROOT);
        ok("and once nothing plays the last one, nothing is kept", PallbearerTestAccess::kept(r) == 0);
    }

    std::printf("\n%d passed, %d failed\n", pass, fail);
    return fail ? 1 : 0;
}
