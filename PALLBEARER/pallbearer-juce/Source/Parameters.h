/* PALLBEARER — Parameters.h
   The DAW-facing parameter list. Mirrors the JS registry in
   pallbearer_core.js: same ids, same ranges, same defaults, same enum
   option ORDER. Display names are flat ASCII here because they appear in
   a host's automation list without the section headings the browser has.

   The portable contract is ids + ranges + defaults + option order. Wording
   is allowed to differ and is reported separately by the parity check, the
   same convention NECROPHONE settled on after its round-11 audit.

   THIS FILE FOLLOWS pallbearer_core.js. It never leads it. */
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "PallbearerCore.h"

namespace pallbearer {

/* One place that knows the id strings, so the processor cannot typo one
   into silence. A misspelled id returns nullptr from APVTS and the
   parameter silently never moves — which looks exactly like a DSP bug. */
namespace pid {
    static const char* tuning    = "tuning";
    static const char* frets     = "frets";
    static const char* capo      = "capo";
    static const char* decay     = "decay";
    static const char* damping   = "damping";
    static const char* inharm    = "inharm";
    static const char* stretch   = "stretch";
    static const char* style     = "style";
    static const char* artic     = "artic";
    static const char* pluckPos  = "pluckPos";
    static const char* hardness  = "hardness";
    static const char* noise     = "noise";
    static const char* velBright = "velBright";
    static const char* buzz      = "buzz";
    static const char* relNoise  = "relNoise";
    static const char* fretNoise = "fretNoise";
    static const char* humanize  = "humanize";
    static const char* pickupA   = "pickupA";
    static const char* pickupB   = "pickupB";
    static const char* pickupMix = "pickupMix";
    static const char* pickupInv = "pickupInv";
    static const char* coilFreq  = "coilFreq";
    static const char* coilQ     = "coilQ";
    static const char* bodyFreq  = "bodyFreq";
    static const char* bodyQ     = "bodyQ";
    static const char* woodMix   = "woodMix";
    static const char* bodyMix   = "bodyMix";
    static const char* tone      = "tone";
    static const char* drive     = "drive";
    static const char* level     = "level";
    static const char* glide     = "glide";
    static const char* couple    = "couple";
    static const char* relDamp   = "relDamp";
    static const char* velSense  = "velSense";
    static const char* strGain   = "strGain";
    static const char* atkGain   = "atkGain";
    static const char* atkDecay  = "atkDecay";
}

/* Option orders are load-bearing: a host stores an enum parameter as an
   index, so reordering these silently rewrites every saved session. */
inline juce::StringArray tuningNames() {
    return { "Standard 4-string (EADG)", "Drop D (DADG)", "5-string (BEADG)",
             "5-string high C (EADGC)", "6-string (BEADGC)", "Tenor (ADGC)" };
}
inline juce::StringArray tuningKeys() {
    return { "standard-4", "drop-d-4", "standard-5", "high-c-5", "standard-6", "tenor-4" };
}
inline juce::StringArray styleNames() { return { "Finger", "Pick", "Slap", "Thumb", "Muted" }; }
inline juce::StringArray styleKeys()  { return { "finger", "pick", "slap", "thumb", "muted" }; }
inline juce::StringArray articNames() { return { "Normal", "Harmonic", "Ghost", "Palm Mute", "Dead" }; }
inline juce::StringArray articKeys()  { return { "normal", "harmonic", "ghost", "palm", "dead" }; }
inline juce::StringArray polarityNames() { return { "In Phase", "Out of Phase" }; }
inline juce::StringArray polarityKeys()  { return { "in", "out" }; }

inline juce::AudioProcessorValueTreeState::ParameterLayout makeLayout()
{
    using APF = juce::AudioParameterFloat;
    using APC = juce::AudioParameterChoice;
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> v;

    auto pf = [&v](const char* id, const char* name, float lo, float hi, float def,
                   const char* unit = "") {
        juce::NormalisableRange<float> r(lo, hi);
        v.push_back(std::make_unique<APF>(juce::ParameterID{ id, 1 }, name, r, def,
                                          juce::AudioParameterFloatAttributes().withLabel(unit)));
    };
    auto pc = [&v](const char* id, const char* name, juce::StringArray opts, int def) {
        v.push_back(std::make_unique<APC>(juce::ParameterID{ id, 1 }, name, opts, def));
    };

    // ---- the instrument ----
    pc(pid::tuning, "Tuning", tuningNames(), 0);
    pf(pid::frets, "Fret Count", 12.f, 36.f, 24.f);
    pf(pid::capo, "Transpose", -24.f, 24.f, 0.f, "st");

    // ---- the string ----
    pf(pid::decay, "String Decay", 0.5f, 12.f, 4.5f, "s");
    pf(pid::damping, "Damping", 0.f, 1.f, 0.28f);
    pf(pid::inharm, "Stiffness", 0.f, 1.f, 0.35f);
    pf(pid::stretch, "Tension Bloom", 0.f, 1.f, 0.30f);

    // ---- the hand ----
    pc(pid::style, "Playing Style", styleNames(), 0);
    pc(pid::artic, "Articulation", articNames(), 0);
    pf(pid::pluckPos, "Pluck Position", 0.02f, 0.5f, 0.13f);
    pf(pid::hardness, "Attack Hardness", 0.f, 1.f, 0.45f);
    pf(pid::noise, "Finger Noise", 0.f, 1.f, 0.22f);

    // ---- the noises ----
    pf(pid::velBright, "Velocity To Bright", 0.f, 1.f, 0.55f);
    pf(pid::buzz, "Fret Buzz", 0.f, 1.f, 0.16f);
    pf(pid::relNoise, "Release Noise", 0.f, 1.f, 0.20f);
    pf(pid::fretNoise, "Position Shift Noise", 0.f, 1.f, 0.30f);
    pf(pid::humanize, "Humanize", 0.f, 1.f, 0.25f);

    // ---- the pickups ----
    pf(pid::pickupA, "Bridge Pickup Pos", 0.03f, 0.45f, 0.11f);
    pf(pid::pickupB, "Neck Pickup Pos", 0.03f, 0.45f, 0.26f);
    pf(pid::pickupMix, "Pickup Blend", 0.f, 1.f, 0.42f);
    pc(pid::pickupInv, "Neck Polarity", polarityNames(), 0);
    pf(pid::coilFreq, "Coil Resonance", 1200.f, 6500.f, 3100.f, "Hz");
    pf(pid::coilQ, "Coil Q", 0.4f, 6.f, 1.35f);

    // ---- the body ----
    pf(pid::bodyFreq, "Air Resonance", 40.f, 260.f, 92.f, "Hz");
    pf(pid::bodyQ, "Air Q", 0.5f, 12.f, 3.2f);
    pf(pid::woodMix, "Wood Modes", 0.f, 1.f, 0.40f);
    pf(pid::bodyMix, "Body Amount", 0.f, 1.f, 0.30f);

    // ---- the amp end ----
    pf(pid::tone, "Tone", 200.f, 12000.f, 3800.f, "Hz");
    pf(pid::drive, "Drive", 0.f, 1.f, 0.12f);
    pf(pid::level, "Output", 0.f, 2.f, 0.9f);

    // ---- the player ----
    pf(pid::glide, "Slide Time", 0.f, 0.4f, 0.f, "s");
    pf(pid::couple, "String Coupling", 0.f, 1.f, 0.18f);
    pf(pid::relDamp, "Release Damping", 0.001f, 0.6f, 0.08f, "s");
    pf(pid::velSense, "Velocity Sense", 0.f, 1.f, 0.75f);

    // ---- the hybrid/sampled seam ----
    pf(pid::strGain, "String Level", 0.f, 1.f, 1.f);
    pf(pid::atkGain, "Attack Layer", 0.f, 1.f, 0.f);
    pf(pid::atkDecay, "Attack Decay", 0.01f, 2.f, 0.25f, "s");

    return { v.begin(), v.end() };
}

} // namespace pallbearer
