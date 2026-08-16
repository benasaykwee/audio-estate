// THE UNDERWORLD — the orchestrator.
// Renders a chain preset through AUTOPSY -> RIGOR -> CASKET and reports the total
// latency once (UNDERWORLD_INTERCHANGE §6). LAW 0: drives public APIs only.
//
// §5 is satisfied by construction: this path runs ONLY the three trilogy cores, so
// Masterbox's own limiter / makeup / sat / mb never run after CASKET — there is nothing
// of Masterbox's in the audio path at all. When this becomes a real plugin, those
// Masterbox modules get bypassed explicitly; here they are simply absent.
//
// Latency ownership (§6): AUTOPSY = 0; RIGOR = its lookahead; CASKET = its own. Each is
// compensated ONCE here (offline: feed the tail, trim the front), so the returned audio
// is aligned to the input and `latency` is the single figure a host would compensate live.
const T = require('./translate.js');
const { AUTOPSY, RIGOR, CASKET } = T.cores;

function chainLatency(preset, fs) {
  return 0 /* AUTOPSY */ + RIGOR.latencySamples(preset.rigor, fs) + CASKET.latencySamples(preset.casket, fs);
}

function renderChain(preset, inL, inR, fs) {
  const n = inL.length;

  // AUTOPSY — zero latency, aligned already.
  const ae = AUTOPSY.createEngine(fs); ae.setState(preset.autopsy);
  const aL = new Float64Array(n), aR = new Float64Array(n);
  ae.process(inL, inR, aL, aR);

  // RIGOR — compensate its lookahead offline: pad the tail, trim the front.
  const rl = RIGOR.latencySamples(preset.rigor, fs), RN = n + rl;
  const re = RIGOR.createMulti(fs); re.setState(preset.rigor);
  const rInL = new Float64Array(RN), rInR = new Float64Array(RN); rInL.set(aL); rInR.set(aR);
  const rOutL = new Float64Array(RN), rOutR = new Float64Array(RN);
  re.process(rInL, rInR, rOutL, rOutR);
  const rL = rOutL.subarray(rl, rl + n), rR = rOutR.subarray(rl, rl + n);

  // CASKET — renderOffline compensates its own latency and returns aligned audio + meters.
  const out = CASKET.renderOffline(preset.casket, rL, rR, fs);
  return { L: out.L, R: out.R, meters: out.meters, latency: chainLatency(preset, fs) };
}

module.exports = { renderChain, chainLatency };
