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

   BUILD (no host, no listening; about two minutes the first time):
     cmake -S PALLBEARER/pallbearer-juce -B <dir> -DPALLBEARER_TESTS=ON \
           -DFETCHCONTENT_SOURCE_DIR_JUCE=<a JUCE 7.0.12 checkout>
     cmake --build <dir> --target PallbearerStateTest
     <dir>/PallbearerStateTest_artefacts/PallbearerStateTest            */
#include <juce_audio_processors/juce_audio_processors.h>
#include "../pallbearer-juce/Source/PluginProcessor.h"
#include <cmath>
#include <cstdio>
#include <vector>

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

static std::vector<float> playNote(PallbearerAudioProcessor& p, int blocks)
{
    const int bs = 256;
    juce::AudioBuffer<float> buf(2, bs);
    std::vector<float> out;
    for (int b = 0; b < blocks; ++b) {
        juce::MidiBuffer midi;
        if (b == 0) midi.addEvent(juce::MidiMessage::noteOn(1, 40, (juce::uint8)110), 0);
        p.processBlock(buf, midi);
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

    std::printf("\n%d passed, %d failed\n", pass, fail);
    return fail ? 1 : 0;
}
