/* CASKET — PluginProcessor.h
   Twenty-two parameters (this comment said eighteen for months while the
   layout said twenty-two — the count is now gated by casket_plugin_test.js
   against the layout itself, so prose can no longer drift from it).
   AUTOPSY needed 146; a limiter is a knob and a promise.
   Three things here are not boilerplate:
     - latency is reported from the SAME pure function the browser and the
       parity gate use, so the host, the harness and the instrument can
       never disagree about it;
     - vigil, lining and style are STRUCTURAL. Changing them reallocates
       the gain path and moves the reported latency, so they are handled
       off the audio thread rather than per block;
     - the editor NEVER touches the engine. Meters and the trace cross to
       the message thread as whole snapshots through Handoff<T> (see the
       long comment in CasketCore.h), and the reset button crosses back as
       an atomic epoch the audio thread services. Before 2026-08-18 the
       editor's 30 Hz timer called engine.meters()/trace() directly while
       processBlock was writing the same fields — a data race over the
       Meter's ~1,500 doubles that no single-threaded harness could see. */
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "CasketCore.h"

class CasketProcessor : public juce::AudioProcessor {
public:
    CasketProcessor();
    ~CasketProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "CASKET"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    casket::State buildState() const;
    double currentSampleRate() const { return sr; }

    /* ---- the seam to the editor (message thread) ----
       All three are snapshot/request operations now; none touches the
       engine. A declined Handoff read (publishes overtook the copy —
       rare at 30 Hz against ~100 publishes/s, but possible) keeps the
       last good frame rather than handing the editor a torn one. */
    void latestMeters(casket::Meters& m) {
        metersPub.read(lastMeters);      /* on decline, lastMeters keeps the previous frame */
        m = lastMeters;
    }
    void latestTrace(casket::Trace& t) {
        /* Only a SUCCESSFUL read consumes the accumulator: the epoch bump
           asks the audio thread to clear peaks the editor has now drawn.
           Bumping on a declined read would discard peaks nobody saw. */
        if (tracePub.read(lastTrace))
            traceResetReq.fetch_add(1, std::memory_order_release);
        t = lastTrace;
    }
    /* Takes effect at the start of the next audio block rather than
       instantly — the price of the message thread never touching the
       engine, and invisible at any human timescale. */
    void resetMeters() { meterResetReq.fetch_add(1, std::memory_order_release); }
    /* THE RANGE. Same snapshot discipline as the meters; published about
       once a second rather than per block, because the chart is a
       distribution over a 3 s window and redrawing it faster shows nothing
       new. Returns false until the short-term window has filled, so the
       editor can say "listening…" instead of drawing an empty axis. */
    bool latestHistogram(casket::Hist& h) {
        histPub.read(lastHist);
        h = lastHist;
        return lastHist.any;
    }

    juce::AudioProcessorValueTreeState apvts;

private:
    static juce::AudioProcessorValueTreeState::ParameterLayout layout();
    void refreshLatency();

    /* The largest run of samples we ever hand the engine in one call.
       Anything longer is chunked. 8192 is comfortably above every host
       block size in practice while keeping the scratch under 256 kB. */
    static const int MAX_CHUNK = 8192;

    casket::Engine engine;
    double sr = 48000;
    int lastLatency = 0;
    /* scratch doubles — the core is double throughout and JUCE hands us
       floats; converting per block keeps the DSP identical to the JS */
    std::vector<double> dL, dR, oL, oR;

    /* ---- the audio→UI seam ----
       Snapshots cross via Handoff (audio publishes, editor copies).
       Requests cross back as monotonic epochs (editor bumps, audio
       services at the next block). The trace needs the extra accumulator
       because engine.trace() resets on read: reading it per block on the
       audio thread would hand the editor only the LAST block's peaks,
       when the scrolling display needs peaks since the last frame —
       so the audio thread accumulates across blocks and clears only when
       the editor says it has drawn them. */
    casket::Handoff<casket::Meters> metersPub;
    casket::Handoff<casket::Trace>  tracePub;
    casket::Handoff<casket::Hist>   histPub;
    casket::Meters lastMeters {};        /* message thread only */
    casket::Trace  lastTrace {};         /* message thread only */
    casket::Hist   lastHist {};          /* message thread only */
    casket::Trace  traceAcc {};          /* audio thread only */
    /* ~1 s between histogram publishes, counted in samples on the audio
       thread — the same throttle the browser uses, for the same reason:
       building the snapshot every block would be work nobody can see. */
    int histCount = 0;
    std::atomic<unsigned> traceResetReq {0}, meterResetReq {0};
    unsigned traceResetSeen = 0, meterResetSeen = 0;   /* audio thread only */

    /* emptyTrace() and foldTrace() moved to CasketCore.h 2026-08-19 — they
       are JUCE-free rules about what the meter shows, and living here put
       them out of reach of any test. */
    static casket::Trace emptyTrace() { return casket::emptyTrace(); }

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(CasketProcessor)
};
