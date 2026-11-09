import { buildScreenState } from './screen-state.js?v=59a9b4dd227f';
import { createLogcat } from './logcat.js?v=59a9b4dd227f';
import { createNetlog } from './netlog.js?v=59a9b4dd227f';
import { reportSummary } from './report-summary.js?v=59a9b4dd227f';
import { applyMethodOverrides, describeMethodOverrides, searchMethods, returnTypesOf } from './method-overrides.js?v=59a9b4dd227f';
import { applyIgnoredActivities, describeIgnoredActivities } from './ignored-activities.js?v=59a9b4dd227f';
import { applyTimeLimits, timeLimitsFor } from './time-limits.js?v=59a9b4dd227f';
import { applyEndpointMocks, describeEndpointMocks } from './endpoint-mocks.js?v=59a9b4dd227f';
import { describeRedirects } from './host-map.js?v=59a9b4dd227f';
import { TimeBreakdown } from './time-breakdown.js?v=59a9b4dd227f';
import { createMessageSink } from './audio-native.js?v=59a9b4dd227f';
import { loadAPK } from './apk-loader.js?v=59a9b4dd227f';
import { heapLimitFor, BYTES_PER_OBJECT } from './memory-budget.js?v=59a9b4dd227f';
import { scanApiGaps, compactApiGapReport } from './api-gap-scan.js?v=59a9b4dd227f';
import { createWebViewBackend } from './webview-backend.js?v=59a9b4dd227f';
import { FrameworkProvider } from './framework-provider.js?v=59a9b4dd227f';
import { createRasterSender } from './raster-cache.js?v=59a9b4dd227f';
import { isFreedId, collectGarbage, createMarker } from './heap-gc.js?v=59a9b4dd227f';
import { dispatchPointer } from './pointer-input-host.js?v=59a9b4dd227f';
import { resolveDevice } from './device-profile.js?v=59a9b4dd227f';
import { FrameworkResourceProvider } from './framework-resource-provider.js?v=59a9b4dd227f';
import { ResourceConfigProvider } from './resource-config-provider.js?v=59a9b4dd227f';
import { SkiaProvider } from './skia-provider.js?v=59a9b4dd227f';
import { inspectCompose } from './compose-inspector.js?v=59a9b4dd227f';
import { runPluginQuery, compactComposeTree, PluginQueryError } from './plugin-queries.js?v=59a9b4dd227f';
import { createComposeSemanticsDriver, STALE_NODE_KIND } from './compose-semantics.js?v=59a9b4dd227f';
import { SemanticsPacer } from './semantics-pacing.js?v=59a9b4dd227f';
import { MotionRasterPolicy, GESTURE_STALE_MS } from './motion-raster.js?v=59a9b4dd227f';
import { disposeTextLayout } from './text-layout-native.js?v=59a9b4dd227f';
import { IcuBreakProvider } from './icu-break-provider.js?v=59a9b4dd227f';
import { SqliteProvider } from './sqlite-native.js?v=59a9b4dd227f';
import { SqlcipherProvider } from './sqlcipher-native.js?v=59a9b4dd227f';
import { TzdataProvider } from './java-time-native.js?v=59a9b4dd227f';
import { ZlibProvider } from './zip-native.js?v=59a9b4dd227f';
import { IcuConverterProvider } from './icu-converter-native.js?v=59a9b4dd227f';
import { LazyNativeLibraryProvider } from './native-library-fetch.js?v=59a9b4dd227f';
import { JavacryptoProvider } from './javacrypto-native.js?v=59a9b4dd227f';
import { disposeColorFilters } from './color-filter-native.js?v=59a9b4dd227f';
import { disposeRegex } from './regex-native.js?v=59a9b4dd227f';
import { disposeRenderNodes } from './rendernode-native.js?v=59a9b4dd227f';
import { startDeepLink } from './deep-link-host.js?v=59a9b4dd227f';
import { attachAppData, defaultBackend, appKeyFor } from './app-data-store.js?v=59a9b4dd227f';
const CONFIGURATION_PROFILE_URL = '../framework-aosp/profiles/configuration/framework.dex?v=59a9b4dd227f';
const LAYOUT_PROFILE_URL = '../framework-aosp/profiles/layouts/framework.dex?v=59a9b4dd227f';
const SKIA_ASSET_URL = '../vendor/canvaskit/0.42.0/';
const RESOURCE_CONFIG_URL = '../framework-aosp/native-config/resource-config.wasm?v=59a9b4dd227f';
const FRAMEWORK_RESOURCE_URL = '../framework-resources/framework-resources.json.gz?v=59a9b4dd227f';
const FRAMEWORK_ASSET_URL = '../framework-aosp/framework.dex?v=59a9b4dd227f';
const NATIVE_LIBS_URL = '../vendor/native-libs/wasm32/', NATIVE_LIBS_REVISION = '59a9b4dd227f';

let sharedSkiaProvider = null;
let sharedSqlcipherProvider = null, sharedICUBreakProvider = null, sharedSqliteProvider = null, sharedTzdataProvider = null, sharedZlibProvider = null, sharedIcuConverterProvider = null;
let sharedLayoutProvider = null, sharedNativeLibraryProvider = null, sharedJavacryptoProvider = null;
let sharedConfigurationProvider = null;
const netlog = createNetlog({ post: message => self.postMessage(message) });   // the app's network requests (src/netlog.js), batched to the page like the logcat
const logcat = createLogcat({ post: message => self.postMessage(message), streaming: false });   // the app's logcat (src/logcat.js): batches go to the page on a 100 ms timer and at the end of every event batch / request, but only while the page's Logcat panel is open (logcat-stream); closed, a counter once a second
let runtime = null, reportedCensus = 0;   // reportedCensus: the OutOfMemoryError whose heap census already reached the page
let appData = null, appDataInfo = null;   // per-app private data persistence (src/app-data-store.js): the live persistence object (null when disabled) and the last status
let composeSemantics = null;
let inspectNativeLibraries = null;
let inventory = null, archive = null;
let activeRequestId = null;
let busy = false;
let eventTimer = null, lastEventMs = 0;
function errorData(error) { const summary = (() => { try { return runtime ? reportSummary(runtime, { tela: (() => { try { return runtime.runDiagnostic(() => buildScreenState(runtime, { semantics: null }).tela, null); } catch { return null; } })(), error: { message: error.message, details: { jsStack: error.details?.jsStack ?? (!error.details && /^(TypeError|RangeError|ReferenceError|SyntaxError|EvalError)$/.test(error.name ?? '') ? String(error.stack ?? '') : null) } } }).join('\n') : null; } catch { return null; } })(); const uncaught = (() => { try { return runtime?.uncaughtText?.() || null; } catch { return null; } })(); const internal = !error.details && /^(TypeError|RangeError|ReferenceError|SyntaxError|EvalError)$/.test(error.name ?? ''); return { summary, uncaught, name: error.name || 'Error', message: error.message || String(error), stack: error.stack, details: internal ? { kind: 'internal-js-error', jsStack: String(error.stack ?? '').split('\n').slice(0, 13).join('\n'), vmContext: runtime?.monitor?.context?.() ?? null } : error.details, navigation: runtime?.platform?.navigationState?.(runtime), trace: Array.isArray(runtime?.trace) ? runtime.trace.slice(-512) : [], stubs: runtime ? [...[...(runtime.missingLibraries ?? [])].map(([key, count]) => [`lib${key}.so`, count]), ...(runtime.missingClasses ?? []), ...(runtime.missingReturns ?? []), ...(runtime.missingVoid ?? [])].map(([key, count]) => `${key} x${count}`) : [], stubLists: runtime ? { void: [...(runtime.missingVoid ?? [])].map(([key, count]) => `${key} x${count}`), returns: [...(runtime.missingReturns ?? [])].map(([key, count]) => `${key} x${count}`), classes: [...(runtime.missingClasses ?? [])].map(([key, count]) => `${key} x${count}`) } : null }; }
const rasterSender = createRasterSender();
const semanticsPacer = new SemanticsPacer();
const workerTiming = { snapshots: 0, snapshotMs: 0, semanticsWalks: 0, semanticsReused: 0, semanticsMs: 0, scheduledBatches: 0, scheduledMs: 0 };   // cumulative host time of the Worker's own work per snapshot, reported in vmHealth for the page and the benchmarks
let lastComposeSemantics = null;   // the tree of the last walk, reused by scheduled events inside the pacing gap (src/semantics-pacing.js)
// Progressive raster (src/motion-raster.js): display rasters are replayed at a reduced scale while the screen is moving and at full density once it is still. `load { motionRaster: false }` turns it off.
let motionRaster = new MotionRasterPolicy(), lastPointerAt = 0;
/** What the VM knows about motion when a snapshot is taken: a pending Choreographer frame, a live pointer gesture, the request being answered (`'pointer-motion'`, `'scrollby'`). */
const motionSignal = (request = null) => ({ pendingFrames: runtime.platform.viewWindowHost?.frameState?.().pendingFrames ?? 0, gestureActive: !!runtime.pointerGesture && performance.now() - lastPointerAt < GESTURE_STALE_MS, inputMotion: request === 'pointer-motion' || request === 'scrollby' });
/** `paced`: a scheduled VM event may reuse the last semantics tree while the pacer says a fresh one is not due yet; replies to page requests are never paced. `request`: the page request this snapshot answers, for the motion signal. */
function currentSnapshot({ paced = false, request = null } = {}) {
  appData?.touch(); const snapshotStarted = performance.now();
  if (!paced) snapshotOwed = false;   // a reply to a page request carries the newest state: nothing is owed to the page anymore
  runtime.steps = 0; // A bounded inspection event, separate from the APK callback that just finished.
  const signal = motionSignal(request); runtime.displayRasterScale = motionRaster.scaleFor(signal); runtime.displayRasterReducedServed = [];
  const rasterizedBefore = runtime.rasterStats?.rasterized ?? 0;
  let snapshot; try { snapshot = runtime.snapshot(); } finally { runtime.displayRasterScale = 1; }   // only the page's snapshot is ever replayed reduced
  motionRaster.noteContent((runtime.rasterStats?.rasterized ?? 0) > rasterizedBefore);   // new content (not a cache hit): the cadence of the motion signal
  const reducedIds = runtime.displayRasterReducedServed; runtime.displayRasterReducedServed = null;
  const rasterReduced = reducedIds.length > 0; motionRaster.noteSnapshot(reducedIds); snapshot.rasterReduced = rasterReduced;   // the page's idle rule waits for the full-density refinement
  if (!snapshot.closed && composeSemantics) {
    const reuse = paced && lastComposeSemantics && !semanticsPacer.take();
    if (!reuse) { const startedAt = performance.now(); try { lastComposeSemantics = composeSemantics.snapshot(); } finally { semanticsPacer.taken(startedAt); workerTiming.semanticsWalks++; workerTiming.semanticsMs += performance.now() - startedAt; } } else workerTiming.semanticsReused++;
    snapshot.composeSemantics = lastComposeSemantics;
  }
  Object.assign(snapshot, runtime.executionSnapshot());
  if (runtime.methodOverridesAll?.size) snapshot.methodOverrides = describeMethodOverrides(runtime);
  if (runtime.platform?.endpointMocksAll?.size) snapshot.endpointMocks = describeEndpointMocks(runtime);
  if (runtime.network?.redirectTable?.size) snapshot.hostMap = describeRedirects(runtime.network.redirectTable);   // live counts for the "Redirecionar hosts" rows (src/host-map.js)   // live hit counts for the "Mock de endpoints" section (src/endpoint-mocks.js)
  if (runtime.platform?.ignoredActivitiesAll?.size) snapshot.ignoredActivities = describeIgnoredActivities(runtime);   // live counts for the "Activities ignoradas" section (src/ignored-activities.js)   // live hit counts for the "Retornos de métodos" section (src/method-overrides.js)
  // VM health the page can show: live Java objects, collections, and any OutOfMemoryError the VM raised (even if the app caught it).
  snapshot.pendingEventDelay = runtime.platform.nextEventDelay?.() ?? null;   // ms until the VM's next scheduled event (frame, timer); null when nothing is scheduled
  if (rasterReduced) snapshot.pendingEventDelay = Math.min(snapshot.pendingEventDelay ?? Infinity, motionRaster.quietMs);   // the refinement is due within the quiet period
  snapshot.vmHealth = { workerHeapBytes: self.performance?.memory?.usedJSHeapSize ?? null, raster: runtime.rasterStats ? { ...runtime.rasterStats, keyMs: Math.round(runtime.rasterStats.keyMs), replayMs: Math.round(runtime.rasterStats.replayMs), encodeMs: Math.round(runtime.rasterStats.encodeMs), reducedMs: Math.round(runtime.rasterStats.reducedMs ?? 0), refinedMs: Math.round(runtime.rasterStats.refinedMs ?? 0) } : null, motionRaster: { enabled: motionRaster.enabled, scale: motionRaster.scale, ...motionRaster.stats }, framesProduced: runtime.platform.viewWindowHost?.frameState?.().framesRun ?? 0, liveObjects: runtime.heap.size, limit: runtime.maxHeapObjects, bytesPerObject: BYTES_PER_OBJECT, lastEventMs, workerTiming: { ...workerTiming, snapshotMs: Math.round(workerTiming.snapshotMs), semanticsMs: Math.round(workerTiming.semanticsMs), scheduledMs: Math.round(workerTiming.scheduledMs) }, collections: runtime.gcStats?.collections ?? 0, freedObjects: runtime.gcStats?.freed ?? 0, gcMs: Math.round(runtime.gcStats?.totalMs ?? 0), oomCount: runtime.oomCount ?? 0, lastOom: runtime.lastOom ? { ...runtime.lastOom, census: undefined } : null, heapCensus: runtime.lastOom?.census && runtime.lastOom.count !== reportedCensus ? (reportedCensus = runtime.lastOom.count, runtime.lastOom.census) : undefined };
  workerTiming.snapshots++; workerTiming.snapshotMs += performance.now() - snapshotStarted;
  return rasterSender.intern(snapshot); // repeated PNGs travel once; the page resolves rasterId to a cached Blob URL
}
// Host-time limit of one VM event in the Worker. The instruction fuse (100M per thread: a React Native startup needs ~3.4M-85M in one dispatch, see the comment at
// APKRuntime.maxInstructionsPerEvent) bounds work, this bounds time: a hot loop that is cheap per instruction can never freeze the page for more than this.
// The Worker reports a runaway event itself (with the execution profile) before the page gives up on it: the page-side timeout is the backstop for a Worker that cannot answer (a long native call).
const EVENT_WALL_LIMIT_MS = 25000;
// Host time of one whole operation (launch, click, back, ...): the per-event limit restarts with every short event, so a pump that keeps scheduling work (a self-rescheduling Handler loop, a polling
// thread, a Timer) is only ended by this budget, with the profile and the list of what kept being scheduled. It must stay below the page's request timeout.
const OPERATION_WALL_LIMIT_MS = 20000;
// After the first frame of an operation is committed the Worker settles at most this long on work that is due right now; whatever is still scheduled (animations, polling, timers) continues as
// ordinary events in later pumps (scheduleEvents), exactly as on a device, where nothing ever "waits for idle".
const SETTLE_WINDOW_MS = 1500, FIRST_FRAME_SETTLE_MS = 8000;   // until the first frame is committed the settle window is longer: a launch returns with something drawn, not with the layout still queued
function drainReadyEvents(maxMs = SETTLE_WINDOW_MS) {
  let processed = 0, result; const started = performance.now();
  for (let round = 0; round < 32; round++) {
    result = runtime.platform.drainEvents(runtime); processed += result.processed;
    if (!result.processed || result.nextDelay !== 0) break;
    if (performance.now() - started > ((runtime.platform.viewWindowHost?.frameState?.().framesRun ?? 1) > 0 ? maxMs : Math.max(maxMs, FIRST_FRAME_SETTLE_MS))) break;   // the rest is left queued for the next pump
  }
  return {...result, processed};
}
/** Runs `body` as a named operation of the VM monitor (heartbeats, operation wall budget, pump accounting). */
function monitored(name, body) {
  const monitor = runtime?.monitor; if (!monitor) return body();
  monitor.begin(name);
  try { return body(); } finally { monitor.end(); }
}
// Page back-pressure (frame coalescing): every scheduled-event snapshot carries a sequence number and the page acknowledges the newest one it has drawn
// (src/device-view.js flushRuntimeSnapshot). While the previous snapshot is still unacknowledged the Worker does not take the next one (that would replay and
// encode a frame the page would only replace before drawing it); the screen is owed one and it is sent when the ack arrives, or after FRAME_ACK_WAIT_MS
// (a hidden tab or a page that dropped it never blocks the screen). Replies to page requests are never held back.
const FRAME_ACK_WAIT_MS = 250;
let eventSeq = 0, ackedSeq = 0, lastEventPostAt = 0, snapshotOwed = false, owedTimer = null;
const frameStats = { sent: 0, held: 0, acks: 0, ackSent: 0, ackBusy: 0 };
const pageBehind = () => eventSeq > ackedSeq && performance.now() - lastEventPostAt < FRAME_ACK_WAIT_MS;
function postRuntimeEvent() {
  snapshotOwed = false; clearTimeout(owedTimer); owedTimer = null;
  const snapshot = currentSnapshot({ paced: true }); snapshot.vmHealth.frames = { ...frameStats };
  lastEventPostAt = performance.now(); frameStats.sent++;
  self.postMessage({ type: 'runtime-event', snapshot, seq: ++eventSeq }, rasterSender.takeTransfers());
}
function holdSnapshot() {
  snapshotOwed = true; frameStats.held++;
  if (owedTimer === null) owedTimer = setTimeout(() => { owedTimer = null; if (snapshotOwed && !busy && runtime) { busy = true; try { postRuntimeEvent(); } catch (error) { self.postMessage({ type: 'runtime-error', error: errorData(error) }); } finally { busy = false; scheduleEvents(); } } }, FRAME_ACK_WAIT_MS);
}
function frameAcked(seq) {
  frameStats.acks++; if (snapshotOwed && busy) frameStats.ackBusy++;
  if (Number.isSafeInteger(seq) && seq > ackedSeq) ackedSeq = Math.min(seq, eventSeq);
  if (snapshotOwed && !busy && runtime && ackedSeq >= eventSeq) { frameStats.ackSent++; busy = true; try { postRuntimeEvent(); } catch (error) { self.postMessage({ type: 'runtime-error', error: errorData(error) }); } finally { busy = false; scheduleEvents(); } }
}
function scheduleEvents() {
  clearTimeout(eventTimer); eventTimer = null;
  if (!runtime?.platform?.nextEventDelay) return;
  const eventDelay = runtime.platform.nextEventDelay(), threadDelay = runtime.multiThreaded ? runtime.scheduler.threadDelay() : null;   // parked and sleeping threads wake by timer too: an idle pool costs nothing between deadlines
  let delay = eventDelay === null ? threadDelay : threadDelay === null ? eventDelay : Math.min(eventDelay, threadDelay);
  const owed = semanticsPacer.refreshDelay();   // a scheduled event reused the last semantics tree: a fresh one is owed even if no VM event is due (src/semantics-pacing.js)
  if (owed !== null) delay = delay == null ? owed : Math.min(delay, owed);
  const gcWake = runtime.platform.gcIdleWakeDelay?.() ?? null;   // a collection deferred while input was arriving runs once the input window closes (heap-gc.js deferral)
  if (gcWake !== null) delay = delay == null ? gcWake : Math.min(delay, gcWake);
  const refine = motionRaster.refineDelay(motionSignal());   // the last snapshot carried a reduced raster: a full-density one is owed once the screen is still (src/motion-raster.js)
  if (refine !== null) delay = delay == null ? refine : Math.min(delay, refine);
  if (delay == null) return;
  eventTimer = setTimeout(() => {
    if (busy) { scheduleEvents(); return; }
    busy = true; let succeeded = false;
    self.postMessage({ type: 'runtime-busy' });   // the page must not treat the screen as settled while a scheduled VM event is being processed
    try {
      const started = performance.now(), drained = monitored('evento agendado', () => drainReadyEvents()); lastEventMs = Math.round(performance.now() - started); if (drained.processed) { workerTiming.scheduledBatches++; workerTiming.scheduledMs += performance.now() - started; }
      logcat.flush(); netlog.flush();
      const refining = !drained.processed && !snapshotOwed && motionRaster.refinementDue(motionSignal()); if (refining) motionRaster.noteRefinement();   // the quiet period passed with the screen still: replay the last frame at full density
      if (drained.processed || snapshotOwed || refining || (semanticsPacer.stale && semanticsPacer.wait() <= 0)) { if (pageBehind()) holdSnapshot(); else postRuntimeEvent(); } else self.postMessage({ type: 'runtime-idle' });
      succeeded = true;
    } catch (error) { self.postMessage({ type: 'runtime-error', error: errorData(error) }); }
    finally { busy = false; if (succeeded) scheduleEvents(); }
  }, Math.min(2147483647, Math.max(0, delay)));
}
// The static API-gap estimate (src/api-gap-scan.js) runs once per opened APK, after its first launch attempt (successful or not), in slices that yield to the event loop so
// VM events and page requests are served in between. Read-only on the VM; its result only feeds "Copiar diagnóstico". A failure here never reaches the run.
function startApiGapScan() {
  const target = runtime; if (!target || !inventory || target.apiGapScanStarted) return;
  target.apiGapScanStarted = true;
  setTimeout(async () => {
    try {
      const report = await scanApiGaps(target, { archive, nativeLibraries: inventory.nativeByABI, yieldFn: () => new Promise(resolve => setTimeout(resolve, 0)), cancelled: () => runtime !== target });
      if (report && runtime === target) self.postMessage({ type: 'api-gaps', report: compactApiGapReport(report) });
    } catch { /* an estimate: nothing to report */ }
  }, 0);
}
// A Worker running VM code cannot answer a "screen-state" request until the operation ends. While an operation runs, a heartbeat at most every 4 s also carries a text snapshot of the screen
// state (no Java code is run for it: no Compose semantics), which the page keeps so that "Copiar estado da tela" still has something when the VM is stuck.
let lastScreenSnapshotAt = 0;
function snapshotScreenDuringOperation(message) {
  if (message?.type !== 'heartbeat' || !runtime) return;
  const now = performance.now(); if (now - lastScreenSnapshotAt < 4000) return; lastScreenSnapshotAt = now;
  try { self.postMessage({ type: 'screen-snapshot', text: buildScreenState(runtime, { semantics: null, heartbeat: null }).text, at: Date.now() }); } catch { /* best effort */ }
}
// Plugin queries (src/plugin-host.js -> src/plugin-queries.js). Nothing here runs unless a page plugin asks: no hook in the VM's paths. Each query waits in a FIFO and is served
// alone in its own task, never while an operation or a scheduled VM event runs, never within PLUGIN_INPUT_QUIET_MS of the page's last input or operation, and with at most
// PLUGIN_MS_PER_SECOND ms of query time per second (a Compose tree costs tens of ms: the next query then waits for the next window). A query that cannot be served within
// PLUGIN_WAIT_MS answers 'busy'; the page retries later.
const PLUGIN_MS_PER_SECOND = 40, PLUGIN_INPUT_QUIET_MS = 120, PLUGIN_RETRY_MS = 16, PLUGIN_WAIT_MS = 6000, PLUGIN_QUEUE_MAX = 64;
const pluginJobs = []; let pluginTimer = null, pluginWindowAt = 0, pluginWindowMs = 0, lastOperationAt = 0;
const pluginStats = { served: 0, ms: 0, deferred: 0, rejected: 0, maxMs: 0 };
const pluginError = (requestId, code, message) => self.postMessage({ requestId, type: 'error', error: { name: 'PluginQueryError', code, message } });
function queuePluginQuery(requestId, data) {
  if (pluginJobs.length >= PLUGIN_QUEUE_MAX) { pluginStats.rejected++; pluginError(requestId, 'busy', 'Fila de consultas de plugins cheia; tente de novo.'); return; }
  pluginJobs.push({ requestId, data, at: performance.now() }); armPluginTimer(0);
}
function armPluginTimer(delay) { if (pluginTimer === null) pluginTimer = setTimeout(servePluginQuery, delay); }
function servePluginQuery() {
  pluginTimer = null; if (!pluginJobs.length) return;
  const now = performance.now(), job = pluginJobs[0];
  if (now - job.at > PLUGIN_WAIT_MS) { pluginJobs.shift(); pluginStats.rejected++; pluginError(job.requestId, 'busy', 'A VM ficou ocupada; a consulta do plugin não foi atendida a tempo.'); armPluginTimer(0); return; }
  if (now - pluginWindowAt >= 1000) { pluginWindowAt = now; pluginWindowMs = 0; }
  const quietLeft = PLUGIN_INPUT_QUIET_MS - (now - Math.max(lastOperationAt, lastPointerAt)), spent = pluginWindowMs >= PLUGIN_MS_PER_SECOND;
  if (busy || quietLeft > 0 || spent) { pluginStats.deferred++; armPluginTimer(busy ? PLUGIN_RETRY_MS : Math.max(PLUGIN_RETRY_MS, quietLeft, spent ? pluginWindowAt + 1000 - now : 0)); return; }
  pluginJobs.shift();
  const { requestId, data } = job, started = performance.now();
  try {
    if (!runtime) throw new PluginQueryError('no-apk', 'Nenhum APK em execução.');
    const args = data.args && typeof data.args === 'object' ? data.args : {};
    let value, failure = null;
    if (data.query === 'composeTree') {
      const notes = [], maxNodes = Math.min(4000, Math.max(1, Number(args.maxNodes) || 2000));
      const inspection = runtime.runDiagnostic(() => inspectCompose(runtime, { maxNodes }), null, error => notes.push(`inspeção do Compose indisponível: ${String(error?.message ?? error).slice(0, 240)}`));
      value = compactComposeTree(inspection, { maxNodes }); value.notes = [...value.notes, ...notes];
      value.activityName = runtime.activityType ? runtime.activityType.slice(1, -1).replaceAll('/', '.') : null;
    } else {
      value = runtime.runDiagnostic(() => runPluginQuery(runtime, data.query, args), null, error => { failure = error; });
      if (failure) throw failure;
    }
    self.postMessage({ requestId, type: 'result', value, ms: Math.round((performance.now() - started) * 100) / 100 });
  } catch (error) {
    const code = error?.name === 'PluginQueryError' ? error.code : error?.details?.kind === 'invalid-object-reference' ? 'collected' : 'failed';
    pluginError(requestId, code, String(error?.message ?? error).slice(0, 400));
  } finally {
    const ms = performance.now() - started; pluginWindowMs += ms; pluginStats.served++; pluginStats.ms += ms; pluginStats.maxMs = Math.max(pluginStats.maxMs, ms);
    if (pluginJobs.length) armPluginTimer(0);
  }
}
self.onmessage = async ({ data }) => {
  if (data?.type === 'frame-ack') { frameAcked(data.seq); return; }
  if (!data || !Number.isSafeInteger(data.requestId)) return;
  const { requestId, type } = data;
  const send = (message) => { logcat.flush(); netlog.flush(); self.postMessage({ requestId, ...message }, rasterSender.takeTransfers()); };   // log lines first, so the page has them when the reply arrives; raw pixel rasters first seen by the page travel as transferred buffers
  if (type === 'webview-event') { try { runtime?.platform?.webViewBackend?.handleEvent(runtime, data); } finally { scheduleEvents(); } return; }   // an iframe finished or failed: only queues VM tasks
  if (type === 'app-data-flush') { runtime?.fileMappings?.flushAll(); appData?.syncPoint('page-hide'); return; }   // shared native file mappings reach their files before the data is stored   // the page is being hidden/closed: store now, even while the VM is busy (no reply)
  if (type === 'screen-state') {   // read-only picture of the screen for "Copiar estado da tela"; answered even while the VM is between operations, always with whatever could be read
    try {
      if (!runtime) { send({ type: 'result', screenState: { text: 'Estado da tela\nNenhum APK carregado.', blank: false, reasons: [] } }); return; }
      const notes = [];
      const semantics = runtime.runDiagnostic(() => composeSemantics?.snapshot?.() ?? null, null, error => notes.push(`semântica do Compose indisponível: ${String(error?.message ?? error).slice(0, 200)}`));
      const state = runtime.runDiagnostic(() => buildScreenState(runtime, { semantics, heartbeat: runtime.monitor.snapshot(performance.now(), 'screen-state') }), null, error => notes.push(`parte do estado indisponível: ${String(error?.message ?? error).slice(0, 200)}`));
      const result = state ?? { text: 'Estado da tela\nNão foi possível montar o estado da tela.', blank: false, reasons: [] };
      if (notes.length) result.text += '\nAvisos do relatório: ' + notes.join('; ');
      send({ type: 'result', screenState: result });
    } catch (error) { send({ type: 'result', screenState: { text: `Estado da tela\nNão foi possível montar o estado da tela: ${String(error?.message ?? error).slice(0, 300)}`, blank: false, reasons: [] } }); }
    return;
  }
  if (type === 'logcat-stream') {   // the page's Logcat panel opened (the ring's recent lines are posted first, then the rows stream) or closed (only a counter): src/logcat.js setStreaming
    try { logcat.setStreaming(data.open === true); send({ type: 'result', streaming: logcat.streaming, total: logcat.snapshot().total }); } catch (error) { send({ type: 'error', error: errorData(error) }); }
    return;
  }
  if (type === 'compose-inspect') {   // the page's "Compose" panel asked for one inspection of the screen (src/compose-inspector.js): read-only, between two VM events, never paced or repeated
    try {
      if (!runtime) { send({ type: 'result', loaded: false, inspection: null }); return; }
      if (busy) { send({ type: 'error', error: { name: 'ProtocolError', message: 'A VM está processando uma operação; tente Capturar de novo.' } }); return; }
      const notes = [], startedAt = performance.now();
      const inspection = runtime.runDiagnostic(() => inspectCompose(runtime, { maxNodes: Math.min(4000, Math.max(1, Number(data.maxNodes) || 2000)) }), null, error => notes.push(`inspeção do Compose indisponível: ${String(error?.message ?? error).slice(0, 240)}`));
      const result = inspection ?? { schemaVersion: 1, owners: [], totalNodes: 0, truncated: false, notes: [] };
      result.notes = [...(result.notes ?? []), ...notes]; result.ms = Math.round(performance.now() - startedAt); result.activityName = runtime.activityType ? runtime.activityType.slice(1, -1).replaceAll('/', '.') : null; result.uptimeMs = Math.round(runtime.clock?.now?.() ?? 0);
      send({ type: 'result', loaded: true, inspection: result });
    } catch (error) { send({ type: 'error', error: errorData(error) }); }
    return;
  }
  if (type === 'plugin-query') { queuePluginQuery(requestId, data); return; }   // a page plugin's read-only query (src/plugin-queries.js): low priority, served between VM events within a time budget
  if (type === 'time-limits') {   // "Tempo máximo por evento": applied between two events, takes effect at the next budget check
    try { send({ type: 'result', limits: runtime ? applyTimeLimits(runtime, data.seconds) : timeLimitsFor(data.seconds), loaded: !!runtime }); } catch (error) { send({ type: 'error', error: errorData(error) }); }
    return;
  }
  if (type === 'ignored-activities') {   // debugging tool (src/ignored-activities.js): the Activities whose starts are dropped; takes effect on the next start
    try { send({ type: 'result', statuses: runtime ? applyIgnoredActivities(runtime, data.entries) : [], loaded: !!runtime }); } catch (error) { send({ type: 'error', error: errorData(error) }); }
    return;
  }
  if (type === 'endpoint-mocks') {   // debugging tool (src/endpoint-mocks.js): the mocked endpoints; takes effect on the next request
    try { send({ type: 'result', statuses: runtime ? applyEndpointMocks(runtime, data.mocks) : [], loaded: !!runtime }); } catch (error) { send({ type: 'error', error: errorData(error) }); }
    return;
  }
  if (type === 'method-overrides') {   // debugging tool (src/method-overrides.js): the set of overridden return values, applied between two VM events; takes effect on the next call
    try { send({ type: 'result', statuses: runtime ? applyMethodOverrides(runtime, data.overrides) : [], loaded: !!runtime }); } catch (error) { send({ type: 'error', error: errorData(error) }); }
    return;
  }
  if (type === 'permissions-config') {   // the "Permissões" section: the permission states and the simulated location (src/runtime-permissions.js, src/permission-host.js); takes effect on the next permission check
    try {
      const host = runtime?.platform?.runtimePermissions;
      if (host) { if (data.dialogs !== undefined) runtime.platform.permissionDialogs = data.dialogs === true; if (data.config) host.setConfig(data.config); if ('location' in data) host.setLocation(runtime, data.location); }
      send({ type: 'result', loaded: !!host, pending: host?.pendingIds() ?? [] }); scheduleEvents();
    } catch (error) { send({ type: 'error', error: errorData(error) }); }
    return;
  }
  if (type === 'permission-response') {   // the page's answer to a `permission-request`: the new state after the dialog (null = dismissed); delivers onRequestPermissionsResult later through the pump
    try { runtime?.platform?.runtimePermissions?.respond(runtime, data.id, data.config ?? null); } catch (error) { self.postMessage({ type: 'runtime-error', error: errorData(error) }); }
    scheduleEvents(); return;
  }
  if (type === 'method-search') {   // methods of the loaded APK's DEX files matching a query, or the return types of a Java-form name
    try {
      if (!runtime) { send({ type: 'result', methods: [], returnTypes: [], loaded: false }); return; }
      send({ type: 'result', loaded: true, methods: data.query ? searchMethods(runtime, data.query, 40) : [], returnTypes: data.owner ? returnTypesOf(runtime, data.owner, data.name, data.parameters ?? []) : [] });
    } catch (error) { send({ type: 'error', error: errorData(error) }); }
    return;
  }
  if (type === 'debug-static') {   // measurement aid (scripts/validation/bench-worker.mjs): runs one static method of the loaded APK and reports wall time, instructions and the host's clock cost
    if (!runtime) { send({ type: 'error', error: { name: 'ProtocolError', message: 'Nenhum APK carregado.' } }); return; }
    try {
      const { owner, name, argument } = data, signature = '(Ljava/lang/String;)Ljava/lang/String;', counted = () => runtime.executionByOrigin.apk.instructions + runtime.executionByOrigin.framework.instructions;
      const before = counted(), start = performance.now();
      const value = runtime.dispatch({ owner, name, parameters: ['Ljava/lang/String;'], result: 'Ljava/lang/String;', signature }, runtime.argumentWords(['Ljava/lang/String;'], [runtime.javaString(argument)]), 'static');
      send({ type: 'result', ms: performance.now() - start, instructions: counted() - before, value: runtime.stringCharacters(value) });
    } catch (error) { send({ type: 'error', error: errorData(error) }); }
    return;
  }
  if (type === 'debug-exec') {   // measurement aid (scripts/validation/bench-launch.mjs): the time breakdown of the last operation and the execution counters
    const biggest = runtime?.monitor?.biggestBreakdown ?? null;
    send({ type: 'result', breakdown: biggest, text: biggest ? TimeBreakdown.text(biggest) : null, execution: runtime?.executionByOrigin ?? null, callStats: runtime?.callStats ?? null, jitCompiled: runtime?.jitCompiled ?? null });
    return;
  }
  if (type === 'debug-gc') {   // measurement aid (scripts/validation/bench-gc.mjs): keeps `live` small objects of mixed shapes reachable, then collects and reports the phase timings
    if (!runtime) { send({ type: 'error', error: { name: 'ProtocolError', message: 'Nenhum APK carregado.' } }); return; }
    try {
      const { live = 100000, garbage = 100000, big = false } = data;
      if (big && !runtime.platform.fakeResourceTable) {   // the pure data a large app keeps on the platform (see scripts/validation/bench-gc-node.mjs)
        const table = new Map(); for (let i = 0; i < 2_000_000; i++) table.set(`res/${i}`, { id: 0x7f000000 + i, type: 'string', value: 'v' + i, config: 'default', flags: i & 7 });
        const classes = new Map(); for (let i = 0; i < 200_000; i++) classes.set(`Lfake/C${i};`, { name: `C${i}`, access: 1, methods: [{ name: 'a', sig: '()V', flags: 1 }, { name: 'b', sig: '(I)I', flags: 2 }], fields: [{ name: 'f', type: 'I' }] });
        const index = []; for (let i = 0; i < 500_000; i++) index.push({ key: 'k' + i, offset: i, length: 4 });
        runtime.platform.fakeResourceTable = { entries: table, classes, index, strings: Array.from({ length: 300_000 }, (_, i) => 's' + i) };
      }
      const holder = runtime.makeObject('Ljava/util/ArrayList;'), list = runtime.object(holder); list.list = [];
      for (let i = 0; i < live; i++) { const k = i % 4; list.list.push(k === 0 ? runtime.makeObject('Ljava/lang/StringBuilder;') : k === 1 ? runtime.newArray('[B', 24) : k === 2 ? runtime.javaString('value-' + i) : runtime.makeObject('Ljava/util/ArrayList;')); }
      for (let i = 0; i < garbage; i++) runtime.makeObject('Ljava/lang/StringBuilder;');
      (runtime.debugKeep ??= []).push(holder);
      let rootProbe = null;
      if (data.probeRoots) {   // cold timing of every property read and key listing while walking the platform root once: finds a lazily computed accessor
        const seen = new WeakSet(), slow = [], walk = (value, path, depth) => {
          if (value === null || typeof value !== 'object' || seen.has(value) || depth > 12) return; seen.add(value);
          if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof WeakMap || value instanceof WeakSet || value instanceof Promise) return;
          if (value instanceof Map || value instanceof Set) { for (const item of value) { if (value instanceof Map) { walk(item[0], path + '<k>', depth + 1); walk(item[1], path + '<v>', depth + 1); } else walk(item, path + '<e>', depth + 1); } return; }
          const t0 = performance.now(); const keys = Object.keys(value); const dKeys = performance.now() - t0;
          if (dKeys > 5) slow.push({ path, op: 'keys', ms: Math.round(dKeys), count: keys.length, kind: value?.constructor?.name });
          if (Array.isArray(value)) { for (let i = 0; i < Math.min(value.length, 2000); i++) walk(value[i], path + '[]', depth + 1); return; }
          for (const key of keys) { const t1 = performance.now(); const item = value[key]; const d = performance.now() - t1; if (d > 5) slow.push({ path: path + '.' + key, op: 'get', ms: Math.round(d), kind: item?.constructor?.name }); walk(item, path + '.' + key, depth + 1); }
        };
        walk(runtime.platform, 'platform', 0); rootProbe = slow.slice(0, 12);
      }
      const before = performance.now(); collectGarbage(runtime, { reason: 'debug-gc' }); const ms = performance.now() - before;
      send({ type: 'result', ms, phases: runtime.gcPhases?.[0] ?? null, heapSize: runtime.heap.size, rootProbe, memory: self.performance?.memory ? { used: self.performance.memory.usedJSHeapSize, total: self.performance.memory.totalJSHeapSize, limit: self.performance.memory.jsHeapSizeLimit } : null, maxHeapObjects: runtime.maxHeapObjects });
    } catch (error) { send({ type: 'error', error: errorData(error) }); }
    return;
  }
  if (busy) { send({ type: 'error', error: { name: 'ProtocolError', message: 'A VM já está processando outra operação.' } }); return; }
  busy = true; activeRequestId = requestId; let succeeded = false; clearTimeout(eventTimer);
  try {
    if (type === 'load') {
      rasterSender.reset();
      runtime?.fileMappings?.flushAll();   // the VM stops: nothing else writes a mapping back
      if (appData) { await appData.close().catch(() => {}); } appData = null; appDataInfo = null;
      if (runtime) { disposeRegex(runtime); disposeRenderNodes(runtime); disposeTextLayout(runtime); disposeColorFilters(runtime); } runtime?.skiaHost?.dispose?.(); runtime = null; reportedCensus = 0; composeSemantics = null; lastComposeSemantics = null; semanticsPacer.stale = false;
      if (!(data.buffer instanceof ArrayBuffer)) throw new TypeError('O Worker precisa receber um ArrayBuffer de APK.');
      const frameworkProvider = data.frameworkDex ? new FrameworkProvider({ bytes: data.frameworkDex }) : FRAMEWORK_ASSET_URL ? new FrameworkProvider({ url: new URL(FRAMEWORK_ASSET_URL, import.meta.url), provenanceURL: new URL(FRAMEWORK_ASSET_URL.replace('framework.dex', 'manifestprovenance.json'), import.meta.url) }) : null;
      const frameworkResourceProvider = data.frameworkResources ? new FrameworkResourceProvider({ data: data.frameworkResources }) : FRAMEWORK_RESOURCE_URL ? new FrameworkResourceProvider({ url: new URL(FRAMEWORK_RESOURCE_URL, import.meta.url), provenanceURL: new URL(FRAMEWORK_RESOURCE_URL.replace('framework-resources.json.gz', 'provenance.json'), import.meta.url), xmlIndexURL: new URL(FRAMEWORK_RESOURCE_URL.replace('framework-resources.json.gz', 'framework-xml-index.json'), import.meta.url), xmlDataURL: new URL(FRAMEWORK_RESOURCE_URL.replace('framework-resources.json.gz', 'framework-xml.bin.gz'), import.meta.url) }) : null;
      const resourceConfigProvider = data.resourceConfigBytes ? new ResourceConfigProvider({ bytes: data.resourceConfigBytes, metadata: data.resourceConfigMetadata }) : RESOURCE_CONFIG_URL ? new ResourceConfigProvider({ url: new URL(RESOURCE_CONFIG_URL, import.meta.url), provenanceURL: new URL(RESOURCE_CONFIG_URL.replace('resource-config.wasm', 'provenance.json'), import.meta.url) }) : null;
      const skiaProvider = SKIA_ASSET_URL ? (sharedSkiaProvider ??= new SkiaProvider({ baseURL: new URL(SKIA_ASSET_URL, import.meta.url) })) : null;
      const layouts = data.layoutProfileDex ? new FrameworkProvider({ bytes: data.layoutProfileDex, filename: 'framework-aosp/profiles/layouts/framework.dex', metadata: data.layoutProfileMetadata }) : LAYOUT_PROFILE_URL ? (sharedLayoutProvider ??= new FrameworkProvider({ url: new URL(LAYOUT_PROFILE_URL, import.meta.url), filename: 'framework-aosp/profiles/layouts/framework.dex', provenanceURL: new URL(LAYOUT_PROFILE_URL.replace('framework.dex', 'framework-provenance.json'), import.meta.url) })) : null;
      const configuration = CONFIGURATION_PROFILE_URL ? (sharedConfigurationProvider ??= new FrameworkProvider({ url: new URL(CONFIGURATION_PROFILE_URL, import.meta.url), filename: 'framework-aosp/profiles/configuration/framework.dex', provenanceURL: new URL(CONFIGURATION_PROFILE_URL.replace('framework.dex', 'framework-provenance.json'), import.meta.url) })) : null;
      const frameworkProfileProviders = { ...(layouts ? { layouts } : {}), ...(configuration ? { configuration } : {}) };
      const icuBreakProvider = sharedICUBreakProvider ??= new IcuBreakProvider();
      const sqliteProvider = sharedSqliteProvider ??= new SqliteProvider(), tzdataProvider = sharedTzdataProvider ??= new TzdataProvider(), zlibProvider = sharedZlibProvider ??= new ZlibProvider(), icuConverterProvider = sharedIcuConverterProvider ??= new IcuConverterProvider();
      // The browser product lays every APK's Views out in the VM (original AOSP LinearLayout/FrameLayout/ScrollView + Skia text), never with page CSS.
      // Lab-built wasm32 native libraries (libreactnative, Hermes, ...): provenance now, each module only when the app's SoLoader links it
      const nativeLibraryProvider = NATIVE_LIBS_URL ? (sharedNativeLibraryProvider ??= await LazyNativeLibraryProvider.fromURL(new URL(NATIVE_LIBS_URL, import.meta.url), { revision: NATIVE_LIBS_REVISION })) : undefined;
      const javacryptoProvider = NATIVE_LIBS_URL ? (sharedJavacryptoProvider ??= await JavacryptoProvider.fromURL(new URL(NATIVE_LIBS_URL, import.meta.url), { revision: NATIVE_LIBS_REVISION })) : undefined;
      const result = await loadAPK(data.buffer, { maxEventWallMs: timeLimitsFor(data.eventSeconds).eventWallMs ?? EVENT_WALL_LIMIT_MS, maxHeapObjects: heapLimitFor(data), nativeLibraryProvider, javacryptoProvider, device: resolveDevice(data.device || {}), tolerateMissing: ['void', 'primitives', 'all'].includes(data.tolerateMissing) ? data.tolerateMissing : 'off', strictCrash: data.strictCrash === true, enableLayoutProfile: layouts ? true : undefined, forceSkia: skiaProvider ? true : undefined, frameworkProfileProviders, frameworkProvider, frameworkResourceProvider, resourceConfigProvider, skiaProvider, icuBreakProvider, sqliteProvider, sqlcipherProvider: sharedSqlcipherProvider ??= new SqlcipherProvider(), tzdataProvider, zlibProvider, icuConverterProvider, onProgress: (progress) => self.postMessage({ type: 'progress', requestId: activeRequestId, progress }) });
      runtime = result.runtime; archive = result.archive; if (Array.isArray(data.methodOverrides) && data.methodOverrides.length) applyMethodOverrides(result.runtime, data.methodOverrides); if (Array.isArray(data.ignoredActivities) && data.ignoredActivities.length) applyIgnoredActivities(result.runtime, data.ignoredActivities); if (Array.isArray(data.endpointMocks) && data.endpointMocks.length) applyEndpointMocks(result.runtime, data.endpointMocks); /* before any app code runs */
      inventory = result.inventory; logcat.clear(); logcat.setStreaming(data.logcatStreaming === true); logcat.attach(runtime); netlog.clear(); netlog.attach(runtime);
      runtime.contentRasterOptions = { transport: 'rgba' };   // Compose/Canvas content reaches the page as raw RGBA8 (src/raster-cache.js), not as a PNG
      motionRaster = new MotionRasterPolicy({ enabled: data.motionRaster !== false }); lastPointerAt = 0;   // progressive raster while the screen moves (src/motion-raster.js); ?raster=full on the page turns it off
      runtime.monitor.configure({ sink: message => { logcat.flush(); self.postMessage({ ...message, requestId: activeRequestId }); snapshotScreenDuringOperation(message); }, budgetMs: OPERATION_WALL_LIMIT_MS });   // heartbeats to the page + the operation wall budget
      applyTimeLimits(runtime, data.eventSeconds);   // "Tempo máximo por evento" (src/time-limits.js): the per-event watchdog, the operation budget and the main-event caps
      runtime.platform.onPermissionRequest = request => self.postMessage({ type: 'permission-request', request });   // Activity.requestPermissions that needs the user: the page shows the dialog
      runtime.platform.permissionDialogs = false;   // until the page says it can show the permission dialog (permissions-config { dialogs: true }), a request is dismissed like a closed dialog
      runtime.platform.onPermissionConfig = config => self.postMessage({ type: 'permission-config', config });
      if (data.permissions) { runtime.platform.runtimePermissions.setConfig(data.permissions.config); if (data.permissions.location) runtime.platform.runtimePermissions.setLocation(runtime, data.permissions.location); }   // before any app code runs
      runtime.platform.audioSink = createMessageSink((message, transfer) => self.postMessage(message, transfer));   // android.media.AudioTrack PCM goes to the page's Web Audio output
      // WebView content lives in iframes of the page: without a page that wants them (the embedded player's default) the WebView has no backend and fails explicitly
      if (data.webview !== false) runtime.platform.webViewBackend = createWebViewBackend({ platform: runtime.platform, post: message => self.postMessage(message), labOrigin: self.location?.origin ?? '' }); inspectNativeLibraries = result.inspectNativeLibraries;
      if (self.location?.origin) runtime.javaProperties.set('apkweb.origin', self.location.origin);   // the page origin (same as this worker's): lets sample apps address documents the lab serves itself
      runtime.platform.onExternalActivity = () => { if (!busy) scheduleEvents(); };   // network exchanges finishing wake the event pump
      composeSemantics = createComposeSemanticsDriver(runtime); lastComposeSemantics = null; semanticsPacer.stale = false;
      runtime.gcEnabled = data.gc !== false;   // unreachable Java objects are reclaimed between events (src/heap-gc.js)
      // Stored app data goes back into the virtual filesystem before any app code runs (Application.onCreate happens at launch).
      const attached = await attachAppData(runtime, { keep: data.keepData !== false, clear: data.clearData === true, onStatus: status => self.postMessage({ type: 'app-data', status }) });
      appData = attached.persistence; appDataInfo = attached.status;
      send({ type: 'result', inventory: result.inventory, appData: appDataInfo });
    } else if (type === 'app-data-clear') {
      // Settings > Apps > Clear storage: the stored data is wiped and this process stops persisting; the page restarts the app.
      if (!runtime) throw new Error('Abra um APK antes de limpar os dados do app.');
      if (appData) appDataInfo = await appData.clear();
      else { const backend = defaultBackend(); if (backend) { const { key } = await appKeyFor(runtime.platform.packageName, runtime.apkSigningCertificates?.() ?? []); await backend.clear(key); } appDataInfo = { ...(appDataInfo ?? {}), bytes: 0, files: 0 }; }
      send({ type: 'result', appData: appDataInfo });
    } else if (type === 'device') {
      // Virtual-device settings changed while an APK runs: Configuration/resources/lifecycle exactly like ActivityThread.handleConfigurationChanged.
      if (!runtime) { send({ type: 'result', outcome: { changed: 0, applied: false } }); }
      else { runtime.steps = 0; const outcome = monitored('device', () => { const applied = runtime.platform.deviceState.apply(runtime, resolveDevice(data.device || {})); drainReadyEvents(); return applied; }); send({ type: 'result', outcome, snapshot: currentSnapshot() }); }
    } else if (type === 'inspect-native') {
      if (!runtime || typeof inspectNativeLibraries !== 'function') throw new Error('Reabra o APK para disponibilizar a inspeção ELF.');
      const libraries = await inspectNativeLibraries(data.paths, data.limits);
      send({ type: 'result', libraries, nativeInspection: inventory.nativeInspection });
    } else if (type === 'launch' || type === 'intent' || type === 'click' || type === 'back' || type === 'input' || type === 'check' || type === 'focus' || type === 'press' || type === 'scroll' || type === 'compose-action' || type === 'pointer' || type === 'scrollby') {
      if (!runtime) throw new Error('Reabra um APK antes de executar a VM.');
      send({ type: 'progress', progress: { phase: type, completed: 0, total: 1 } });
      lastOperationAt = performance.now(); runtime.monitor.begin(type); if (type !== 'launch' && type !== 'intent') runtime.platform.noteInput?.();   // scroll, focus, press and the rest reach the View directly below: the collector's input signal (heap-gc.js deferral)
      runtime.steps = 0; let droppedComposeAction = null, droppedEvent = null, deepLink = null;
      // An id the page took from an older snapshot can name a View that has since been collected (it was removed from the hierarchy): Android would not deliver the event either.
      const staleId = ['click', 'input', 'check', 'focus', 'press', 'scroll', 'scrollby'].includes(type) ? data.id : type === 'compose-action' || type === 'pointer' ? data.ownerViewId : null;
      if (staleId !== null && isFreedId(runtime, staleId)) {
        droppedEvent = { kind: 'stale-view-id', type, id: staleId };
        runtime.record(`EVENT dropped (${type} on View ${staleId} that no longer exists)`);
      }
      else if (type === 'scroll') {
        if (![data.x,data.y].every(value=>Number.isInteger(value)&&value>=-2147483648&&value<=2147483647)) throw new TypeError('A rolagem requer coordenadas inteiras Android.');
        const receiver={ref:data.id};
        if(!runtime.isSubtype(runtime.object(receiver).type,'Landroid/view/View;'))throw new TypeError('O alvo de rolagem precisa ser uma View real.');
        runtime.dispatch({owner:'Landroid/view/View;',name:'scrollTo',parameters:['I','I'],result:'V',signature:'(II)V'},[receiver,data.x,data.y],'virtual');
      }
      else if (type === 'scrollby') { if (![data.dx, data.dy].every(value => Number.isFinite(value) && Math.abs(value) < 100000)) throw new TypeError('Invalid scrollBy'); runtime.dispatch({ owner: 'Landroid/view/View;', name: 'scrollBy', signature: '(II)V', parameters: ['I', 'I'], result: 'V' }, [{ ref: data.id }, Math.round(data.dx), Math.round(data.dy)], 'virtual'); }
      else if (type === 'pointer') { lastPointerAt = performance.now(); const outcome = dispatchPointer(runtime, data); if (outcome.dropped && outcome.dropped !== 'unchanged') { droppedEvent = { kind: 'pointer-' + outcome.dropped, type, id: data.ownerViewId }; runtime.record(`EVENT dropped (pointer ${data.action}: ${outcome.dropped})`); } }
      else if (type === 'compose-action') {
        try { composeSemantics.performAction({ownerViewId:data.ownerViewId,nodeId:data.nodeId,action:data.action,args:data.args}); }
        catch (error) {
          // Only a vanished target is dropped; every other semantics failure (unsupported action, bad args, VM error) still aborts.
          if (error?.details?.kind !== STALE_NODE_KIND) throw error;
          // A wheel/scroll aimed at a list whose semantics node was replaced meanwhile (navigation, recomposition): scroll the list that is under the pointer now, as a real wheel would.
          let retargeted = false;
          if (data.action === 'ScrollBy') {
            try {
              const owner = composeSemantics.snapshot().owners.find(value => value.ownerViewId === data.ownerViewId), area = node => (node.boundsInRoot.right - node.boundsInRoot.left) * (node.boundsInRoot.bottom - node.boundsInRoot.top);
              const target = owner?.nodes.filter(node => node.placed && !node.invisibleToUser && node.actions.some(action => action.name === 'ScrollBy')).sort((a, b) => area(b) - area(a))[0];
              if (target) { composeSemantics.performAction({ ownerViewId: data.ownerViewId, nodeId: target.nodeId, action: 'ScrollBy', args: data.args }); runtime.record(`COMPOSE-ACTION ScrollBy retargeted ${data.nodeId} -> ${target.nodeId}`); retargeted = true; }
            } catch (retryError) { if (retryError?.details?.kind !== STALE_NODE_KIND) throw retryError; }
          }
          if (!retargeted) {
            droppedComposeAction = { kind: STALE_NODE_KIND, ownerViewId: data.ownerViewId, nodeId: data.nodeId, action: data.action, message: error.message };
            runtime.record(`COMPOSE-ACTION dropped (stale node ${data.ownerViewId}:${data.nodeId} ${data.action}): ${error.message}`);
          }
        }
      }
      else if (type === 'focus') runtime.dispatch({ owner: 'Landroid/view/View;', name: data.focused ? 'requestFocus' : 'clearFocus', signature: data.focused ? '()Z' : '()V', parameters: [], result: data.focused ? 'Z' : 'V' }, [{ ref: data.id }], 'virtual');
      else if (type === 'press') runtime.dispatch({ owner: 'Landroid/view/View;', name: 'setPressed', signature: '(Z)V', parameters: ['Z'], result: 'V' }, [{ ref: data.id }, data.pressed ? 1 : 0], 'virtual');
      else if (type === 'input') runtime.platform.setInput(runtime, data.id, data.text);
      else if (type === 'check') runtime.platform.checkInput(runtime, data.id, data.checked);
      else if (type === 'intent') {
        // A deep link / Intent the page describes: resolved against the manifest's intent filters and started like `am start` (see src/deep-link-host.js).
        deepLink = startDeepLink(runtime, data.intent || {});
      }
      else await (type === 'launch' ? runtime.launch(data.activity) : type === 'back' ? runtime.back() : runtime.click(data.id));
      drainReadyEvents();
      if (deepLink && !deepLink.ok && !runtime.activity) { send({ type: 'result', deepLink }); succeeded = true; return; }   // nothing matched and no Activity runs yet: there is no screen to snapshot
      const motionRequest = type === 'scrollby' ? 'scrollby' : type === 'pointer' && data.action !== 1 && data.action !== 3 ? 'pointer-motion' : null;   // input in flight: a wheel step, a pointer DOWN/MOVE (UP/CANCEL end the gesture)
      const resultSnapshot = currentSnapshot({ request: motionRequest }); if (deepLink) resultSnapshot.deepLink = deepLink; if (droppedComposeAction) resultSnapshot.droppedComposeAction = droppedComposeAction; if (droppedEvent) resultSnapshot.droppedEvent = droppedEvent;
      send({ type: 'result', snapshot: resultSnapshot });
    } else throw new Error(`Operação de Worker desconhecida: ${type}`);
    succeeded = true;
  } catch (error) {
    send({ type: 'error', error: errorData(error) });
  } finally { runtime?.monitor?.end(); busy = false; if (succeeded) scheduleEvents(); if (type === 'launch' || type === 'intent') startApiGapScan(); }
};
