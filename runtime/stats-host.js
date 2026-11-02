import { createHostRegistry } from './host-contract.js?v=ab5660c71041';

// android.util.StatsLog (packages/modules/StatsD framework/java/android/util/StatsLog.java, android-13.0.0_r1) over an in-memory sink. The device writes events to the statsd socket from
// libstats_jni; the browser VM has no statsd, so every accepted event is kept in platform.statsEvents ({ atomId, bytes }) and nothing is sent anywhere. StatsEvent itself is the original
// class in the framework DEX: write(StatsEvent) reads its encoded bytes exactly as the Java body does and releases it.
const STATS_LOG = 'Landroid/util/StatsLog;', STATS_EVENT = 'Landroid/util/StatsEvent;';
const APP_BREADCRUMB_REPORTED = 47, BINARY_PUSH_STATE_CHANGED = 102;   // StatsdStatsLog atom ids
const STATE_UNSPECIFIED = 1, STATE_STOP = 2, STATE_START = 3;           // APP_BREADCRUMB_REPORTED__STATE__* (UNKNOWN = 0)
const LIMIT = 10000;

export function createStatsHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  registry.type(STATS_LOG, 'Ljava/lang/Object;', [], { allocatable: false });
  const sink = () => (platform.statsEvents ??= []);
  const record = (atomId, bytes, fields = null) => { const events = sink(); if (events.length >= LIMIT) events.shift(); events.push({ atomId, bytes, fields }); };
  const statics = (name, signature, fn) => def(STATS_LOG, name, signature, fn, { static: true });
  const breadcrumb = state => (_r, _m, [label]) => { record(APP_BREADCRUMB_REPORTED, null, [platform.virtualProcess.uid, label, state]); return 1; };   // Process.myUid(), label, state
  statics('logStart', '(I)Z', breadcrumb(STATE_START)); statics('logStop', '(I)Z', breadcrumb(STATE_STOP)); statics('logEvent', '(I)Z', breadcrumb(STATE_UNSPECIFIED));
  statics('logBinaryPushStateChanged', '(Ljava/lang/String;JII[J)Z', (r, _m, [trainName, versionCode, options, state, experimentIds]) => {
    if (experimentIds === null) r.throwJava('Ljava/lang/NullPointerException;', 'Attempt to get length of null array');
    record(BINARY_PUSH_STATE_CHANGED, null, [r.stringCharacters(trainName), versionCode, options, state, r.array(experimentIds).elements.slice()]);
    return 1;
  });
  statics('write', `(${STATS_EVENT})V`, (r, _m, [event]) => {   // writeImpl(event.getBytes(), event.getNumBytes(), event.getAtomId()); event.release();
    const call = (name, result) => r.dispatch({ owner: STATS_EVENT, name, parameters: [], result, signature: `()${result}` }, [event], 'virtual');
    const bytes = call('getBytes', '[B'), size = call('getNumBytes', 'I'), atomId = call('getAtomId', 'I');
    record(atomId, Uint8Array.from(r.array(bytes).elements.slice(0, size), value => value & 0xff));
    r.dispatch({ owner: STATS_EVENT, name: 'release', parameters: [], result: 'V', signature: '()V' }, [event], 'virtual');
  });
  statics('writeRaw', '([BI)V', (r, _m, [buffer, size]) => record(0, Uint8Array.from(r.array(buffer).elements.slice(0, size), value => value & 0xff)));
  return { ...registry };
}
