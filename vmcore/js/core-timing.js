// The time accounting of the core engine (src/time-breakdown.js): where the clock is read, and where it is not.
//  - The core's runs (the run / run_nested / resume / resume_host exports) own the clock as the CORE bucket: two clock reads per run, which is a coarse boundary (a quantum, a call into Java from
//    host code), not per bridged call.
//  - A bridged crossing (the env.bridge import) is counted. One crossing in TIME_SAMPLE_CROSSINGS reads the clock at its entry and exit: what it took, minus what the bucket stack charged to
//    other buckets inside it (the host call's own time, timed by TimeBreakdown.callBegin/callEnd), is the glue of that crossing. The mean glue times the crossings counted is the glue
//    time the core bucket holds (TimeBreakdown.derive), so the default path reads the clock for 1 crossing in 32 (and the host call of each, and 1 call in 32 of each call site), not for every call. In precise mode (the survey flag) every crossing is timed.
import { BUCKET, TIME_SAMPLE_CROSSINGS, measurementOverhead, overheadNow, clockNow } from '../../runtime/time-breakdown.js?v=d0b27a2b509b';

const RUNS = ['run', 'run_nested', 'resume', 'resume_host'];
const GAP = TIME_SAMPLE_CROSSINGS / 2;   // the next sampled crossing is GAP + (0..GAP-1) crossings away (mean TIME_SAMPLE_CROSSINGS - 0.5): jittered, so a loop of fixed length cannot alias with the sampling

/** The core's exports with the runs that execute Java wrapped to own the clock as the core bucket; everything else is the original export. */
export function timedExports(exports, tb) {
  const timed = {};
  for (const name of Object.keys(exports)) {
    const original = exports[name];
    if (RUNS.includes(name)) timed[name] = (...args) => { const previous = tb.enter(BUCKET.CORE); try { return original(...args); } finally { tb.leave(previous); } };
    else timed[name] = original;
  }
  return timed;
}

/** env.bridge with the crossing count and the sampled glue measurement. */
export function timedBridge(tb, bridge) {
  let countdown = GAP, seed = 0x9e3779b9;
  const timer = setTimeout(measurementOverhead, 1000); timer?.unref?.();   // the calibration of what the measurement costs, once, a second after the core is attached (until then estimates stand in)
  return (methodId, call, thread) => {
    ++tb.crossings;
    if (--countdown > 0 && tb.precise !== true) return bridge(methodId, call, thread);
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; countdown = GAP + ((seed >>> 0) % GAP);
    if (tb.cur !== BUCKET.CORE) return bridge(methodId, call, thread);   // not a crossing out of a core run (a nested guest): its owner is not the core, nothing to calibrate
    const runs = tb.runs, t0 = clockNow(); tb.charge(t0); const nonCore = tb.nonCore; tb.sampling = true; tb.sampleTimed = false;
    try { return bridge(methodId, call, thread); }
    finally {
      tb.sampling = false; tb.sampleHolder = null;
      const t1 = clockNow(); tb.charge(t1); tb.settleDeferred();   // the sampled call's bookkeeping runs after the span
      // trusted when the host call inside was timed and no core run nested in the crossing; what is left of the span, after the host and other buckets and the measurement's own cost, is the glue
      if (tb.sampleTimed === true && tb.runs === runs && tb.cur === BUCKET.CORE) tb.noteGlue(t1 - t0 - (tb.nonCore - nonCore) - overheadNow().glue);   // signed: with a coarse clock a single measure is 0 or a step, and only the mean of many is meaningful
    }
  };
}
