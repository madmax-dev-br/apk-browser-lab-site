import { checkCoreMemory, sanitizeCoreMemory, coreStartMessage } from './core-memory.js?v=d1b40b8dc64a';
import { launcherInfo } from './launcher-info.js?v=d1b40b8dc64a';
import { buildScreenState } from './screen-state.js?v=d1b40b8dc64a';
import { createLogcat } from './logcat.js?v=d1b40b8dc64a';
import { createNetlog } from './netlog.js?v=d1b40b8dc64a';
import { reportSummary } from './report-summary.js?v=d1b40b8dc64a';
import { applyMethodOverrides, describeMethodOverrides, searchMethods, returnTypesOf } from './method-overrides.js?v=d1b40b8dc64a';
import { applyIgnoredActivities, describeIgnoredActivities } from './ignored-activities.js?v=d1b40b8dc64a';
import { applyTimeLimits, timeLimitsFor } from './time-limits.js?v=d1b40b8dc64a';
import { applyEndpointMocks, describeEndpointMocks } from './endpoint-mocks.js?v=d1b40b8dc64a';
import { describeRedirects } from './host-map.js?v=d1b40b8dc64a';
import { TimeBreakdown, createLoadTiming } from './time-breakdown.js?v=d1b40b8dc64a';
import { createAppStorage } from './app-storage.js?v=d1b40b8dc64a';
import { listMethods, invokeAppMethod } from './app-invoke.js?v=d1b40b8dc64a';
import { createMessageSink } from './audio-native.js?v=d1b40b8dc64a';
import { loadAPK } from './apk-loader.js?v=d1b40b8dc64a';
import { heapLimitFor, BYTES_PER_OBJECT } from './memory-budget.js?v=d1b40b8dc64a';
import { scanApiGaps, compactApiGapReport } from './api-gap-scan.js?v=d1b40b8dc64a';
import { createWebViewBackend } from './webview-backend.js?v=d1b40b8dc64a';
import { FrameworkProvider } from './framework-provider.js?v=d1b40b8dc64a';
import { createRasterSender } from './raster-cache.js?v=d1b40b8dc64a';
import { isFreedId, collectGarbage, createMarker } from './heap-gc.js?v=d1b40b8dc64a';
import { dispatchPointer } from './pointer-input-host.js?v=d1b40b8dc64a';
import { resolveDevice } from './device-profile.js?v=d1b40b8dc64a';
import { FrameworkResourceProvider } from './framework-resource-provider.js?v=d1b40b8dc64a';
import { ResourceConfigProvider } from './resource-config-provider.js?v=d1b40b8dc64a';
import { SkiaProvider } from './skia-provider.js?v=d1b40b8dc64a';
import { inspectCompose } from './compose-inspector.js?v=d1b40b8dc64a';
import { runPluginQuery, compactComposeTree, attachCompositionLocals, PluginQueryError, handleOf } from './plugin-queries.js?v=d1b40b8dc64a';
import { createComposeSemanticsDriver, STALE_NODE_KIND } from './compose-semantics.js?v=d1b40b8dc64a';
import { readScrollInfo } from './scroll-info.js?v=d1b40b8dc64a';
import { SemanticsPacer } from './semantics-pacing.js?v=d1b40b8dc64a';
import { MOTION_SCALE_STEPS, SETTLED_SCALE_STEPS, MotionRasterPolicy, GESTURE_STALE_MS } from './motion-raster.js?v=d1b40b8dc64a';
import { GpuRasterController, sanitizeRenderer } from './gpu-raster.js?v=d1b40b8dc64a';
import { readinessProbe, ScreenReadyTracker } from './screen-ready.js?v=d1b40b8dc64a';
import { WarmupTracker, firstTimeWork } from './warmup.js?v=d1b40b8dc64a';
import { disposeTextLayout } from './text-layout-native.js?v=d1b40b8dc64a';
import { IcuBreakProvider } from './icu-break-provider.js?v=d1b40b8dc64a';
import { SqliteProvider } from './sqlite-native.js?v=d1b40b8dc64a';
import { SqlcipherProvider } from './sqlcipher-native.js?v=d1b40b8dc64a';
import { TzdataProvider } from './java-time-native.js?v=d1b40b8dc64a';
import { ZlibProvider } from './zip-native.js?v=d1b40b8dc64a';
import { IcuConverterProvider } from './icu-converter-native.js?v=d1b40b8dc64a';
import { LazyNativeLibraryProvider } from './native-library-fetch.js?v=d1b40b8dc64a';
import { JavacryptoProvider } from './javacrypto-native.js?v=d1b40b8dc64a';
import { disposeColorFilters } from './color-filter-native.js?v=d1b40b8dc64a';
import { disposeRegex } from './regex-native.js?v=d1b40b8dc64a';
import { disposeRenderNodes } from './rendernode-native.js?v=d1b40b8dc64a';
import { startDeepLink } from './deep-link-host.js?v=d1b40b8dc64a';
import { attachAppData, defaultBackend, appKeyFor } from './app-data-store.js?v=d1b40b8dc64a';
import { renderVariant, RenderVariantError } from './render-variant.js?v=d1b40b8dc64a';
import { probeWebCodecs } from './media-codec-backend.js?v=d1b40b8dc64a';
const hostCodecs = probeWebCodecs(self).catch(() => null);   // the device's video codecs are this Worker's WebCodecs (null: none); asked once, when the Worker starts
const CONFIGURATION_PROFILE_URL = '../framework-aosp/profiles/configuration/framework.dex?v=d1b40b8dc64a';
const LAYOUT_PROFILE_URL = '../framework-aosp/profiles/layouts/framework.dex?v=d1b40b8dc64a';
const SKIA_ASSET_URL = '../vendor/canvaskit/0.42.0/';
const RESOURCE_CONFIG_URL = '../framework-aosp/native-config/resource-config.wasm?v=d1b40b8dc64a';
const FRAMEWORK_RESOURCE_URL = '../framework-resources/framework-resources.json.gz?v=d1b40b8dc64a';
const FRAMEWORK_ASSET_URL = '../framework-aosp/framework.dex?v=d1b40b8dc64a';
const NATIVE_LIBS_URL = '../vendor/native-libs/wasm32/', NATIVE_LIBS_REVISION = 'd1b40b8dc64a';

let sharedSkiaProvider = null;
let sharedSqlcipherProvider = null, sharedICUBreakProvider = null, sharedSqliteProvider = null, sharedTzdataProvider = null, sharedZlibProvider = null, sharedIcuConverterProvider = null;
let sharedLayoutProvider = null, sharedNativeLibraryProvider = null, sharedJavacryptoProvider = null;
let sharedConfigurationProvider = null;
let lastLoadTiming = null;   // the phases of the last load (src/time-breakdown.js createLoadTiming)
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
const workerTiming = { snapshots: 0, snapshotMs: 0, semanticsWalks: 0, semanticsReused: 0, semanticsMs: 0, scheduledBatches: 0, scheduledMs: 0, pacing: { edges: [2, 4, 8, 12, 17, 25, 34, 50], timerLate: new Array(9).fill(0), batch: new Array(9).fill(0), snapshot: new Array(9).fill(0), gap: new Array(9).fill(0) } };
// Histograms of the frame loop (ms, upper edges in pacing.edges, last bucket = the rest): how late a timer fired, how long a batch of events and a snapshot took, and the time between two batches that ran events.
const pace = (name, ms) => { const { edges } = workerTiming.pacing; let i = 0; while (i < edges.length && ms >= edges[i]) i++; workerTiming.pacing[name][i]++; }; let lastBatchAt = 0;   // cumulative host time of the Worker's own work per snapshot, reported in vmHealth for the page and the benchmarks
let lastComposeSemantics = null;   // the tree of the last walk, reused by scheduled events inside the pacing gap (src/semantics-pacing.js)
// Progressive raster (src/motion-raster.js): display rasters are replayed at a reduced scale while the screen is moving and at full density once it is still. `load { motionRaster: false }` turns it off.
let motionRaster = new MotionRasterPolicy(), lastPointerAt = 0;
let warmTracker = new WarmupTracker();   // "Aquecendo" (src/warmup.js): snapshot.warmup, and a wake while warming so the flip to warm is posted when the app is idle
let readyTracker = new ScreenReadyTracker();   // "Tela pronta" (src/screen-ready.js): snapshot.screenReady, and a wake when the quiet period ends
/** What the VM knows about motion when a snapshot is taken: a pending Choreographer frame, a live pointer gesture, the request being answered (`'pointer-motion'`, `'scrollby'`). */
// Renderer ("Renderização", src/gpu-raster.js): CPU unless the page asked for the experimental GPU replay. With CPU no controller exists and nothing below runs.
const CPU_RENDERER = Object.freeze({ requested: 'cpu', active: 'cpu', reason: null });
let rendererNote = null;   // a GPU request that could not even create the controller (an app that never loaded Skia): reported like a fallback
const rendererStatus = () => runtime?.gpuRaster ? runtime.gpuRaster.status() : rendererNote ?? CPU_RENDERER;
/** Applies a renderer choice to the loaded runtime (at load, or live between two VM events). A GPU that cannot start or fails later falls back to CPU, reported. */
function selectRenderer(mode) {
  const wanted = sanitizeRenderer(mode); rendererNote = null;
  if (!runtime || (wanted === 'cpu' && !runtime.gpuRaster)) return rendererStatus();
  const CanvasKit = runtime.skia?.CanvasKit;
  if (!runtime.gpuRaster) {
    if (!CanvasKit) { rendererNote = { requested: wanted, active: 'cpu', reason: 'o Skia não foi carregado para este app (nada para a GPU desenhar)' }; try { runtime.record(`LOG W ApkLabRender: GPU indisponível: ${rendererNote.reason} — usando CPU`); } catch { /* logcat detached */ } return rendererNote; }
    const target = runtime;
    runtime.gpuRaster = new GpuRasterController({ CanvasKit, onFallback: reason => { try { target.record(`LOG W ApkLabRender: GPU indisponível: ${reason} — usando CPU`); } catch { /* logcat detached */ } } });
    runtime.displayRasterHeld = id => rasterSender.holds(id);   // a GPU raster whose ImageBitmap left the Worker is drawable while the page holds its id
  }
  return runtime.gpuRaster.select(wanted, runtime);
}
const motionSignal = (request = null) => ({ navigation: motionRaster.navigating(), pendingFrames: runtime.platform.viewWindowHost?.frameState?.().pendingFrames ?? 0, gestureActive: !!runtime.pointerGesture && performance.now() - lastPointerAt < GESTURE_STALE_MS, inputMotion: request === 'pointer-motion' || request === 'scrollby' });
/** `paced`: a scheduled VM event may reuse the last semantics tree while the pacer says a fresh one is not due yet. Replies to page requests carry a fresh tree, except the
 * ones of input in flight (`pacedSemantics`: a pointer MOVE of a drag, a wheel step), which come at the rate of the pointer and are followed by the gesture's end or by the
 * refresh the pacer owes. `request`: the page request this snapshot answers, for the motion signal. */
function currentSnapshot({ paced = false, pacedSemantics = paced, request = null } = {}) {
  appData?.touch(); const snapshotStarted = performance.now();
  if (!paced) snapshotOwed = false;   // a reply to a page request carries the newest state: nothing is owed to the page anymore
  runtime.steps = 0; // A bounded inspection event, separate from the APK callback that just finished.
  try { motionRaster.noteScreen(`${runtime.activity?.ref ?? 0}:${runtime.platform.viewRoots?.(runtime)?.length ?? 0}`); } catch { /* no screen yet */ }   // "tela nova": a new Activity instance or window
  const signal = motionSignal(request); runtime.displayRasterScale = motionRaster.scaleFor(signal); runtime.displayRasterSettledScale = motionRaster.settledScale(); runtime.displayRasterReducedServed = [];
  const rasterizedBefore = runtime.rasterStats?.rasterized ?? 0;
  let snapshot; try { snapshot = runtime.snapshot(); } finally { runtime.displayRasterScale = 1; }   // only the page's snapshot is ever replayed reduced
  motionRaster.noteContent((runtime.rasterStats?.rasterized ?? 0) > rasterizedBefore);   // new content (not a cache hit): the cadence of the motion signal
  const reducedIds = runtime.displayRasterReducedServed; runtime.displayRasterReducedServed = null;
  const rasterReduced = reducedIds.length > 0; motionRaster.noteSnapshot(reducedIds); snapshot.rasterReduced = rasterReduced;   // the page's idle rule waits for the full-density refinement
  if (!snapshot.closed && composeSemantics) {
    const reuse = pacedSemantics && lastComposeSemantics && !semanticsPacer.take(signal.pendingFrames > 0 || signal.gestureActive || signal.inputMotion);
    if (!reuse) { const startedAt = performance.now(); try { lastComposeSemantics = composeSemantics.snapshot(); } finally { semanticsPacer.taken(startedAt); workerTiming.semanticsWalks++; workerTiming.semanticsMs += performance.now() - startedAt; } } else workerTiming.semanticsReused++;
    snapshot.composeSemantics = lastComposeSemantics;
  }
  if (!snapshot.closed) try { snapshot.ime = runtime.platform.inputMethodService?.imeState?.(runtime) ?? null; } catch { snapshot.ime = null; }   // where the page's keyboard types: the served view and whether it has an InputConnection
  Object.assign(snapshot, runtime.executionSnapshot());
  try { snapshot.screenReady = readyTracker.observe(readinessProbe(runtime), performance.now()); } catch { snapshot.screenReady = null; }
  try { snapshot.warmup = warmTracker.observe(firstTimeWork(runtime), performance.now()); } catch { snapshot.warmup = null; }   // read-only: field reads, no bytecode
  if (runtime.methodOverridesAll?.size) snapshot.methodOverrides = describeMethodOverrides(runtime);
  if (runtime.platform?.endpointMocksAll?.size) snapshot.endpointMocks = describeEndpointMocks(runtime);
  if (runtime.network?.redirectTable?.size) snapshot.hostMap = describeRedirects(runtime.network.redirectTable);   // live counts for the "Redirecionar hosts" rows (src/host-map.js)   // live hit counts for the "Mock de endpoints" section (src/endpoint-mocks.js)
  if (runtime.platform?.ignoredActivitiesAll?.size) snapshot.ignoredActivities = describeIgnoredActivities(runtime);   // live counts for the "Activities ignoradas" section (src/ignored-activities.js)   // live hit counts for the "Retornos de métodos" section (src/method-overrides.js)
  // VM health the page can show: live Java objects, collections, and any OutOfMemoryError the VM raised (even if the app caught it).
  snapshot.pendingEventDelay = runtime.platform.nextEventDelay?.() ?? null;   // ms until the VM's next scheduled event (frame, timer); null when nothing is scheduled
  if (rasterReduced) snapshot.pendingEventDelay = Math.min(snapshot.pendingEventDelay ?? Infinity, motionRaster.quietMs);   // the refinement is due within the quiet period
  snapshot.vmHealth = { engine: runtime.engine, core: runtime.wasm ? (m => ({ metaBytes: m.metaBytes, metaCapacity: m.metaCapacity, threads: m.threadRecords - m.threadRecordsFree, threadCapacity: m.threadCapacity, heapBytes: m.heapBytes, liveBytes: m.liveBytes }))(runtime.wasm.memoryInfo()) : null, framesSkipped: runtime.platform.framesSkipped ?? 0, framesConsecutive: runtime.platform.framesConsecutive ?? 0, workerHeapBytes: self.performance?.memory?.usedJSHeapSize ?? null, skiaHeapBytes: runtime.skia?.CanvasKit?.HEAPU8?.buffer?.byteLength ?? null, raster: runtime.rasterStats ? { ...runtime.rasterStats, keyMs: Math.round(runtime.rasterStats.keyMs), replayMs: Math.round(runtime.rasterStats.replayMs), encodeMs: Math.round(runtime.rasterStats.encodeMs), reducedMs: Math.round(runtime.rasterStats.reducedMs ?? 0), refinedMs: Math.round(runtime.rasterStats.refinedMs ?? 0) } : null, motionRaster: { enabled: motionRaster.enabled, scale: motionRaster.scale, ...motionRaster.stats }, renderer: rendererStatus(), framesProduced: runtime.platform.viewWindowHost?.frameState?.().framesRun ?? 0, liveObjects: runtime.heap.size, limit: runtime.maxHeapObjects, bytesPerObject: BYTES_PER_OBJECT, lastEventMs, workerTiming: { ...workerTiming, snapshotMs: Math.round(workerTiming.snapshotMs), semanticsMs: Math.round(workerTiming.semanticsMs), scheduledMs: Math.round(workerTiming.scheduledMs) }, collections: runtime.gcStats?.collections ?? 0, freedObjects: runtime.gcStats?.freed ?? 0, gcMs: Math.round(runtime.gcStats?.totalMs ?? 0), oomCount: runtime.oomCount ?? 0, lastOom: runtime.lastOom ? { ...runtime.lastOom, census: undefined } : null, heapCensus: runtime.lastOom?.census && runtime.lastOom.count !== reportedCensus ? (reportedCensus = runtime.lastOom.count, runtime.lastOom.census) : undefined };
  workerTiming.snapshots++; workerTiming.snapshotMs += performance.now() - snapshotStarted; pace('snapshot', performance.now() - snapshotStarted);
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
/** The page's keyboard on a Compose text field (src/device-view.js): each key goes to the served view's InputConnection as a soft keyboard sends it (src/input-method-service-host.js
 * imeEdit), and the frame it schedules (recomposition, the field's new state reported back to the connection) runs before the next key, as it does between a person's keystrokes.
 * A view with no InputConnection (no input session, or a framework profile without EditorInfo) gets what the page did before, the semantics SetText of the text the browser control
 * would hold, and the reason is recorded: never silently. Returns that fallback (reason and how many keys used it) or null. */
const IME_MAX_OPS = 64, IME_FRAME_WAIT_MS = 20, IME_KEY_SETTLE_MS = 60;
async function typeWithIme(data) {
  const ops = data.ops;
  if (!Array.isArray(ops) || !ops.length || ops.length > IME_MAX_OPS) throw new TypeError(`A digitação requer de 1 a ${IME_MAX_OPS} teclas por pedido.`);
  const ims = runtime.platform.inputMethodService, view = { ref: data.ownerViewId };
  let fallback = null;
  for (const op of ops) {
    runtime.steps = 0;
    const outcome = ims ? ims.imeEdit(runtime, view, op) : { handled: false, reason: 'the platform has no InputMethodManager' };
    if (!outcome.handled) {
      const via = typeof op.fallbackText === 'string' && Number.isInteger(data.nodeId) ? 'SetText' : 'nenhum';
      runtime.record(`WEB InputMethod: no InputConnection for ${op.kind} (${outcome.reason}); ${via === 'SetText' ? 'semantics SetText of the browser control text instead' : 'key dropped'}`);
      if (via === 'SetText') {
        try { composeSemantics.performAction({ ownerViewId: data.ownerViewId, nodeId: data.nodeId, action: 'SetText', args: [op.fallbackText] }); }
        catch (error) { if (error?.details?.kind !== STALE_NODE_KIND) throw error; runtime.record(`COMPOSE-ACTION dropped (stale node ${data.ownerViewId}:${data.nodeId} SetText): ${error.message}`); }
      }
      fallback ??= { reason: outcome.reason, via, keys: 0 }; fallback.keys++;
    }
    // A person's next key comes after the frame this one scheduled: wait for it (real time; the VM clock is not moved) up to IME_KEY_SETTLE_MS.
    let result = drainReadyEvents(); const started = performance.now();
    while (Number.isFinite(result.nextDelay) && result.nextDelay > 0 && result.nextDelay <= IME_FRAME_WAIT_MS && performance.now() - started < IME_KEY_SETTLE_MS) {
      await new Promise(resolve => setTimeout(resolve, Math.ceil(result.nextDelay))); runtime.steps = 0; result = drainReadyEvents();
    }
  }
  return fallback;
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
let lastFramePostedAt = 0;   // when the page was last sent a frame (the API-gap scan waits for a quiet moment: startApiGapScan)
function postRuntimeEvent() {
  lastFramePostedAt = performance.now(); snapshotOwed = false; clearTimeout(owedTimer); owedTimer = null;
  // An APK that was opened but not started has no screen yet (no Activity called setContentView, none is queued, no task ended): a scheduled wake-up (warm-up or
  // screen-ready sampling, a timer of the Application) has nothing to show, and asking for a snapshot was reported to the page as an interrupted callback ("No content view").
  if (!runtime.root && !runtime.platform?.taskClosed && !runtime.platform?.launchPending?.()) { self.postMessage({ type: 'runtime-idle' }); return; }
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
/** A lab error ended a background thread (runtime.noteThreadFailure): the page is told on its own message, whatever became of the JavaScript exception -- the reply to the page
 * request that happened to be pumping, a scheduled event, or a catch that dropped it. Posted after that reply, so the page shows one error, and keeps this one on screen. */
function surfaceThreadFailure() {
  const failure = runtime?.pendingThreadFailure; if (!failure) return;
  runtime.pendingThreadFailure = null; logcat.flush();
  self.postMessage({ type: 'thread-failure', failure: { thread: failure.thread, kind: failure.kind, atMs: failure.atMs, message: failure.full.length > 6000 ? failure.full.slice(0, 1500) + ' ... ' + failure.full.slice(-4000) : failure.full } });
}
function scheduleEvents() {
  clearTimeout(eventTimer); eventTimer = null; surfaceThreadFailure();
  if (!runtime?.platform?.nextEventDelay) return;
  const eventDelay = runtime.platform.nextEventDelay(), threadDelay = runtime.multiThreaded ? runtime.scheduler.threadDelay() : null;   // parked and sleeping threads wake by timer too: an idle pool costs nothing between deadlines
  let delay = eventDelay === null ? threadDelay : threadDelay === null ? eventDelay : Math.min(eventDelay, threadDelay);
  const owed = semanticsPacer.refreshDelay();   // a scheduled event reused the last semantics tree: a fresh one is owed even if no VM event is due (src/semantics-pacing.js)
  if (owed !== null) delay = delay == null ? owed : Math.min(delay, owed);
  const gcWake = runtime.platform.gcIdleWakeDelay?.() ?? null;   // a collection deferred while input was arriving runs once the input window closes (heap-gc.js deferral)
  if (gcWake !== null) delay = delay == null ? gcWake : Math.min(delay, gcWake);
  const readyWake = readyTracker.wakeDelay(performance.now());   // the screen is settled: post the flip to "Tela pronta" when the quiet period ends
  if (readyWake !== null) delay = delay == null ? readyWake : Math.min(delay, readyWake);
  const warmWake = warmTracker.wakeDelay();   // still warming: sample again soon, so "aquecido" is posted even when nothing else is due
  if (warmWake !== null) delay = delay == null ? warmWake : Math.min(delay, warmWake);
  const refine = motionRaster.refineDelay(motionSignal());   // the last snapshot carried a reduced raster: a full-density one is owed once the screen is still (src/motion-raster.js)
  if (refine !== null) delay = delay == null ? refine : Math.min(delay, refine);
  if (delay == null) return;
  const dueAt = performance.now() + Math.max(0, delay);
  eventTimer = setTimeout(() => {
    if (busy) { scheduleEvents(); return; }
    pace('timerLate', performance.now() - dueAt);
    busy = true; let succeeded = false;
    self.postMessage({ type: 'runtime-busy' });   // the page must not treat the screen as settled while a scheduled VM event is being processed
    try {
      const started = performance.now(), drained = monitored('evento agendado', () => drainReadyEvents()); lastEventMs = Math.round(performance.now() - started); if (drained.processed) { workerTiming.scheduledBatches++; workerTiming.scheduledMs += performance.now() - started; pace('batch', performance.now() - started); if (lastBatchAt) pace('gap', started - lastBatchAt); lastBatchAt = started; }
      logcat.flush(); netlog.flush();
      const refining = !drained.processed && !snapshotOwed && motionRaster.refinementDue(motionSignal()); if (refining) motionRaster.noteRefinement();   // the quiet period passed with the screen still: replay the last frame at full density
      const readyFlip = !drained.processed && readyTracker.flipDue(performance.now());   // nothing ran and the quiet period passed: a fresh snapshot carries screenReady.ready = true
      const warmFlip = !drained.processed && warmTracker.flipDue(firstTimeWork(runtime), performance.now());   // the window passed with almost no first-time work: a fresh snapshot carries warmup.warming = false
      if (drained.processed || snapshotOwed || refining || readyFlip || warmFlip || (semanticsPacer.stale && semanticsPacer.wait() <= 0)) { if (pageBehind()) holdSnapshot(); else postRuntimeEvent(); } else self.postMessage({ type: 'runtime-idle' });
      succeeded = true;
    } catch (error) { self.postMessage({ type: 'runtime-error', error: errorData(error) }); }
    finally { busy = false; surfaceThreadFailure(); if (succeeded) scheduleEvents(); }
  }, Math.min(2147483647, Math.max(0, delay)));
}
// The static API-gap estimate (src/api-gap-scan.js) runs once per opened APK, after its first launch attempt (successful or not), in slices that yield to the event loop so
// VM events and page requests are served in between. Read-only on the VM; its result only feeds "Copiar diagnóstico". A failure here never reaches the run.
// It started right after the first frame and took the Worker for ~130 ms in the first second of a large app, when the user starts scrolling the screen that just appeared:
// now every slice waits for a quiet moment (no input and no frame for SCAN_QUIET_MS), so the scan fills the pauses instead of the first scroll.
const SCAN_QUIET_MS = 400, SCAN_POLL_MS = 100, SCAN_MAX_WAIT_MS = 250;   // an app that never stops animating still gets its scan: one slice (about 8 ms) at most every SCAN_MAX_WAIT_MS, a few percent of the Worker
const quietForScan = () => { const now = performance.now(); return now - lastOperationAt >= SCAN_QUIET_MS && now - lastFramePostedAt >= SCAN_QUIET_MS && now - lastPointerAt >= SCAN_QUIET_MS; };
const waitQuietForScan = cancelled => new Promise(resolve => { const since = performance.now(), check = () => (cancelled() || (!busy && (quietForScan() || performance.now() - since >= SCAN_MAX_WAIT_MS)) ? resolve() : setTimeout(check, SCAN_POLL_MS)); setTimeout(check, 0); });
function startApiGapScan() {
  const target = runtime; if (!target || !inventory || target.apiGapScanStarted) return;
  target.apiGapScanStarted = true;
  const cancelled = () => runtime !== target;
  setTimeout(async () => {
    try {
      await waitQuietForScan(cancelled);
      const report = await scanApiGaps(target, { archive, nativeLibraries: inventory.nativeByABI, yieldFn: () => waitQuietForScan(cancelled), cancelled });
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
      value = compactComposeTree(inspection, { maxNodes, handle: id => handleOf(runtime, id) }); value.notes = [...value.notes, ...notes];
      value.activityName = runtime.activityType ? runtime.activityType.slice(1, -1).replaceAll('/', '.') : null;
      const locals = Array.isArray(args.locals) ? args.locals.map(String).filter(Boolean).slice(0, 32) : [];
      if (locals.length) runtime.runDiagnostic(() => attachCompositionLocals(runtime, value, locals), null, error => value.notes.push(`CompositionLocals indisponíveis: ${String(error?.message ?? error).slice(0, 200)}`));
    } else if (data.query === 'scrollState') {   // where a scrollable is and how far it goes (src/scroll-info.js): what lab.scrollTo / scroll_to steer by
      value = runtime.runDiagnostic(() => readScrollInfo(runtime, composeSemantics, args), null, error => { failure = error; });
      if (failure) throw failure;
    } else {
      value = runtime.runDiagnostic(() => data.query === 'methods' ? listMethods(runtime, args) : runPluginQuery(runtime, data.query, args), null, error => { failure = error; });   // 'methods': the DEX's method table (src/app-invoke.js), read-only like the rest
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
/** The page is the device's camera hardware (src/camera-host.js): `attach` gives the VM its cameras, a frame or a capture result queues the app's callbacks for the next pump. */
function cameraMessage(message) {
  const camera = runtime?.platform?.camera; if (!camera || !message) return;
  try {
    if (message.op === 'attach') camera.attach({ captureUi: message.captureUi === true, captureVideo: message.captureVideo === true, post: (reply, transfer) => self.postMessage({ type: 'camera', message: reply }, transfer ?? []) });
    else if (message.op === 'detach') camera.detach(runtime);
    else camera.handle(runtime, message);
  } catch (error) { self.postMessage({ type: 'runtime-error', error: errorData(error) }); }
  scheduleEvents();
}
// The providers of the lab's own assets (framework DEX and resources, Skia, ICU, SQLite, tzdata, zlib, the platform's native libraries) for the next load. Their load() is memoized, so
// warming them (`warmAssets`) and the load that follows share one fetch, check and compile. The page starts a new Worker for every APK; should one Worker load twice, the second load
// gets new framework, framework-resource and resource-configuration providers (the load clears this), while Skia, ICU, SQLite, tzdata, zlib and the native libraries stay shared.
let assetProviders = null;   // a promise: the prewarm and the load can ask at the same time, and must get the same providers
function urlAssetProviders() { return assetProviders ??= createAssetProviders().catch(error => { assetProviders = null; throw error; }); }
async function createAssetProviders() {
  const at = url => new URL(url, import.meta.url);
  const providers = {
    framework: FRAMEWORK_ASSET_URL ? new FrameworkProvider({ url: at(FRAMEWORK_ASSET_URL), provenanceURL: at(FRAMEWORK_ASSET_URL.replace('framework.dex', 'manifestprovenance.json')) }) : null,
    frameworkResources: FRAMEWORK_RESOURCE_URL ? new FrameworkResourceProvider({ url: at(FRAMEWORK_RESOURCE_URL), provenanceURL: at(FRAMEWORK_RESOURCE_URL.replace('framework-resources.json.gz', 'provenance.json')), xmlIndexURL: at(FRAMEWORK_RESOURCE_URL.replace('framework-resources.json.gz', 'framework-xml-index.json')), xmlDataURL: at(FRAMEWORK_RESOURCE_URL.replace('framework-resources.json.gz', 'framework-xml.bin.gz')) }) : null,
    resourceConfig: RESOURCE_CONFIG_URL ? new ResourceConfigProvider({ url: at(RESOURCE_CONFIG_URL), provenanceURL: at(RESOURCE_CONFIG_URL.replace('resource-config.wasm', 'provenance.json')) }) : null,
    skia: SKIA_ASSET_URL ? (sharedSkiaProvider ??= new SkiaProvider({ baseURL: at(SKIA_ASSET_URL) })) : null,
    layouts: LAYOUT_PROFILE_URL ? (sharedLayoutProvider ??= new FrameworkProvider({ url: at(LAYOUT_PROFILE_URL), filename: 'framework-aosp/profiles/layouts/framework.dex', provenanceURL: at(LAYOUT_PROFILE_URL.replace('framework.dex', 'framework-provenance.json')) })) : null,
    configuration: CONFIGURATION_PROFILE_URL ? (sharedConfigurationProvider ??= new FrameworkProvider({ url: at(CONFIGURATION_PROFILE_URL), filename: 'framework-aosp/profiles/configuration/framework.dex', provenanceURL: at(CONFIGURATION_PROFILE_URL.replace('framework.dex', 'framework-provenance.json')) })) : null,
    icuBreak: sharedICUBreakProvider ??= new IcuBreakProvider(), sqlite: sharedSqliteProvider ??= new SqliteProvider(), tzdata: sharedTzdataProvider ??= new TzdataProvider(),
    zlib: sharedZlibProvider ??= new ZlibProvider(), icuConverter: sharedIcuConverterProvider ??= new IcuConverterProvider(),
    ...(NATIVE_LIBS_URL ? await Promise.all([   // the two provenance files, read together
      sharedNativeLibraryProvider ??= LazyNativeLibraryProvider.fromURL(at(NATIVE_LIBS_URL), { revision: NATIVE_LIBS_REVISION }).catch(error => { sharedNativeLibraryProvider = null; throw error; }),
      sharedJavacryptoProvider ??= JavacryptoProvider.fromURL(at(NATIVE_LIBS_URL), { revision: NATIVE_LIBS_REVISION }).catch(error => { sharedJavacryptoProvider = null; throw error; }),
    ]).then(([nativeLibraries, javacrypto]) => ({ nativeLibraries, javacrypto })) : { nativeLibraries: undefined, javacrypto: undefined }),
  };
  return providers;
}
/** Starts every asset load at once (they download, verify and compile in parallel; loadAPK then awaits them one by one) and the WebAssembly core's modules. Called when the page
 *  opens ('prewarm'), before an APK is chosen, so the downloads overlap the choice, and again at the load (every load() is memoized). Failures are left to the load to report. */
async function warmAssets(wanted = {}) {   // wanted: { framework: false, ... } skips an asset the load brings its own bytes for
  const providers = await urlAssetProviders();
  for (const name of ['framework', 'layouts', 'configuration', 'skia', 'frameworkResources', 'resourceConfig', 'icuBreak', 'sqlite', 'tzdata', 'zlib', 'icuConverter']) if (wanted[name] !== false) providers[name]?.load?.()?.catch?.(() => {});
  providers.javacrypto?.prefetch(providers.nativeLibraries).catch(() => {});   // every launch links javacrypto (src/javacrypto-native.js prefetch): fetched, verified and compiled ahead, not inside the interpreter
  import('../vmcore/js/attach.js?v=d1b40b8dc64a').catch(() => {});
  return providers;
}

self.onmessage = async ({ data }) => {
  if (data?.type === 'frame-ack') { frameAcked(data.seq); return; }
  if (data?.type === 'camera') { cameraMessage(data.message); return; }   // the page's camera source (src/camera-lab.js): frames and the camera screen's answers only queue VM tasks
  if (data?.type === 'prewarm') { warmAssets().catch(() => {}); return; }   // the page opened: fetch and compile the lab's assets while the user picks an APK
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
  if (type === 'renderer') {   // "Renderização" (Controles) / player `renderer`: applied between two VM events; the next snapshot replays the screen with the new backend
    try {
      const status = selectRenderer(data.renderer); send({ type: 'result', renderer: status, loaded: !!runtime });
      if (runtime?.activity) { if (busy) snapshotOwed = true; else { busy = true; try { postRuntimeEvent(); } catch { snapshotOwed = true; } finally { busy = false; scheduleEvents(); } } }
    } catch (error) { send({ type: 'error', error: errorData(error) }); }
    return;
  }
  if (type === 'raster-settings') {   // "Resolução no movimento" / "Tela nova em baixa resolução" (Controles): the next snapshot uses them
    try { send({ type: 'result', raster: motionRaster.configure({ scale: Number(data.scale), navigation: data.navigation !== false, ...(SETTLED_SCALE_STEPS.includes(Number(data.settled)) ? { settled: Number(data.settled) } : {}) }) }); } catch (error) { send({ type: 'error', error: errorData(error) }); }
    return;
  }
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
  if (type === 'shared-files') {   // "Arquivos do dispositivo": the files of the virtual device's shared storage (src/shared-storage-host.js); the page keeps the originals, the VM gets copies
    try {
      const host = runtime?.platform?.sharedStorage;
      if (host && data.dialogs !== undefined) runtime.platform.systemPickerDialogs = data.dialogs === true;
      send({ type: 'result', loaded: !!host, files: host ? (data.files || data.remove || data.replace ? host.setFiles(runtime, data) : host.list()) : [], pending: host?.pendingIds() ?? [] }); scheduleEvents();
    } catch (error) { send({ type: 'error', error: errorData(error) }); }
    return;
  }
  if (type === 'system-picker-response') {   // the page's answer to a `system-picker-request`: the chosen file ids (null = dismissed); delivers onActivityResult through the pump
    try { runtime?.platform?.sharedStorage?.respondPicker(runtime, data.id, data.selected ?? null); } catch (error) { self.postMessage({ type: 'runtime-error', error: errorData(error) }); }
    scheduleEvents(); return;
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
    send({ type: 'result', loadTiming: lastLoadTiming, breakdown: biggest, text: biggest ? TimeBreakdown.text(biggest) : null, execution: runtime?.executionByOrigin ?? null, callStats: runtime?.callStats ?? null, jitCompiled: runtime?.jitCompiled ?? null });
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
      // Then the same amount of fresh garbage and a minor collection over it (heap-gc.js, "Young generation"): the live set is old now, so it marks only the roots and the young objects.
      let minor = null;
      if (data.minor !== false) { for (let i = 0; i < garbage; i++) runtime.makeObject('Ljava/lang/StringBuilder;'); const at = performance.now(); collectGarbage(runtime, { reason: 'debug-gc', generation: 'minor' }); minor = { ms: performance.now() - at, entry: runtime.gcMinorStats?.recent.at(-1) ?? null }; }
      send({ type: 'result', ms, minor, phases: runtime.gcPhases?.[0] ?? null, heapSize: runtime.heap.size, rootProbe, memory: self.performance?.memory ? { used: self.performance.memory.usedJSHeapSize, total: self.performance.memory.totalJSHeapSize, limit: self.performance.memory.jsHeapSizeLimit } : null, maxHeapObjects: runtime.maxHeapObjects });
    } catch (error) { send({ type: 'error', error: errorData(error) }); }
    return;
  }
  if (busy) { send({ type: 'error', error: { name: 'ProtocolError', message: 'A VM já está processando outra operação.' } }); return; }
  busy = true; activeRequestId = requestId; let succeeded = false; clearTimeout(eventTimer);
  try {
    if (type === 'load') {
      const loadTiming = createLoadTiming();   // where the time of this load went, by progress phase (the diagnostic summary and debug-exec report it)
      rasterSender.reset();
      runtime?.fileMappings?.flushAll();   // the VM stops: nothing else writes a mapping back
      if (appData) { await appData.close().catch(() => {}); } appData = null; appDataInfo = null;
      if (runtime) { disposeRegex(runtime); disposeRenderNodes(runtime); disposeTextLayout(runtime); disposeColorFilters(runtime); } runtime?.skiaHost?.dispose?.(); runtime?.gpuRaster?.dispose(); runtime = null; rendererNote = null; reportedCensus = 0; composeSemantics = null; lastComposeSemantics = null; semanticsPacer.stale = false;
      if (!(data.buffer instanceof ArrayBuffer)) throw new TypeError('O Worker precisa receber um ArrayBuffer de APK.');
      // the lab's own assets: this Worker's providers, all started at once by warmAssets (already when the page opened, if it sent 'prewarm'), unless the caller sent its own bytes
      const shared = await warmAssets({ framework: !data.frameworkDex, frameworkResources: !data.frameworkResources, resourceConfig: !data.resourceConfigBytes, layouts: !data.layoutProfileDex });
      assetProviders = null;   // taken by this load: another load in this Worker gets its own framework, framework resources and resource configuration (as before warming existed); Skia, ICU and the rest stay shared
      const frameworkProvider = data.frameworkDex ? new FrameworkProvider({ bytes: data.frameworkDex }) : shared.framework;
      const frameworkResourceProvider = data.frameworkResources ? new FrameworkResourceProvider({ data: data.frameworkResources }) : shared.frameworkResources;
      const resourceConfigProvider = data.resourceConfigBytes ? new ResourceConfigProvider({ bytes: data.resourceConfigBytes, metadata: data.resourceConfigMetadata }) : shared.resourceConfig;
      const skiaProvider = shared.skia, layouts = data.layoutProfileDex ? new FrameworkProvider({ bytes: data.layoutProfileDex, filename: 'framework-aosp/profiles/layouts/framework.dex', metadata: data.layoutProfileMetadata }) : shared.layouts, configuration = shared.configuration;
      const frameworkProfileProviders = { ...(layouts ? { layouts } : {}), ...(configuration ? { configuration } : {}) };
      const icuBreakProvider = shared.icuBreak, sqliteProvider = shared.sqlite, tzdataProvider = shared.tzdata, zlibProvider = shared.zlib, icuConverterProvider = shared.icuConverter;
      // The browser product lays every APK's Views out in the VM (original AOSP LinearLayout/FrameLayout/ScrollView + Skia text), never with page CSS.
      // Lab-built wasm32 native libraries (libreactnative, Hermes, ...): provenance now, each module only when the app's SoLoader links it (javacrypto's, which every launch links, prefetched)
      const nativeLibraryProvider = shared.nativeLibraries, javacryptoProvider = shared.javacrypto;
      const result = await loadAPK(data.buffer, { maxEventWallMs: timeLimitsFor(data.eventSeconds).eventWallMs ?? EVENT_WALL_LIMIT_MS, maxHeapObjects: heapLimitFor(data), nativeLibraryProvider, javacryptoProvider, device: resolveDevice(data.device || {}), engine: data.engine === 'wasm' ? 'wasm' : 'js', tolerateMissing: ['void', 'primitives', 'all'].includes(data.tolerateMissing) ? data.tolerateMissing : 'off', strictCrash: data.strictCrash === true, enableLayoutProfile: layouts ? true : undefined, forceSkia: skiaProvider ? true : undefined, frameworkProfileProviders, frameworkProvider, frameworkResourceProvider, resourceConfigProvider, skiaProvider, icuBreakProvider, sqliteProvider, sqlcipherProvider: sharedSqlcipherProvider ??= new SqlcipherProvider(), tzdataProvider, zlibProvider, icuConverterProvider, onProgress: (progress) => { loadTiming.mark(progress?.phase); self.postMessage({ type: 'progress', requestId: activeRequestId, progress }); } });
      runtime = result.runtime; archive = result.archive;
      runtime.platform.glPresent = frame => self.postMessage({ type: 'gl-frame', frame }, frame.bitmap ? [frame.bitmap] : []);   // eglSwapBuffers of a window surface (src/gles-native.js): the picture goes to the page as it is, transferred loadTiming.mark('core'); runtime.platform.camera?.attachCodecs(await hostCodecs);
      if (runtime.engine === 'wasm') {   // the WebAssembly core (docs/WASM-CORE-PLANO.md), before anything runs. A core that cannot start fails the load naming the other engine; the JavaScript VM is never substituted silently
        try { await (await import('../vmcore/js/attach.js?v=d1b40b8dc64a')).attachCore(runtime, { memory: checkCoreMemory(data.coreMemory).error ? null : sanitizeCoreMemory(data.coreMemory) }); }
        catch (error) { error.message = `${coreStartMessage(error)}`; throw error; }
      }
      if (Array.isArray(data.methodOverrides) && data.methodOverrides.length) applyMethodOverrides(result.runtime, data.methodOverrides); if (Array.isArray(data.ignoredActivities) && data.ignoredActivities.length) applyIgnoredActivities(result.runtime, data.ignoredActivities); if (Array.isArray(data.endpointMocks) && data.endpointMocks.length) applyEndpointMocks(result.runtime, data.endpointMocks); /* before any app code runs */
      inventory = result.inventory; logcat.clear(); logcat.setStreaming(data.logcatStreaming === true); logcat.attach(runtime); netlog.clear(); netlog.attach(runtime);
      runtime.contentRasterOptions = { transport: 'rgba' };   // Compose/Canvas content reaches the page as raw RGBA8 (src/raster-cache.js), not as a PNG
      if (sanitizeRenderer(data.renderer) === 'gpu') selectRenderer('gpu');   // opt-in experimental GPU replay (src/gpu-raster.js); CPU (the default) leaves everything as above
      motionRaster = new MotionRasterPolicy({ enabled: data.motionRaster !== false, scale: MOTION_SCALE_STEPS.includes(data.rasterScale) && data.rasterScale < 1 ? data.rasterScale : 1, navigation: data.rasterNavigation === true }); if (data.rasterScale === 1) motionRaster.configure({ scale: 1 }); if (SETTLED_SCALE_STEPS.includes(data.rasterSettled)) motionRaster.configure({ settled: data.rasterSettled }); lastPointerAt = 0; readyTracker = new ScreenReadyTracker(); warmTracker = new WarmupTracker(); warmTracker.observe(firstTimeWork(runtime), performance.now());   // the clock of "aquecendo" starts at the load: the launch is part of it   // progressive raster while the screen moves (src/motion-raster.js); ?raster=full on the page turns it off
      runtime.monitor.configure({ sink: message => { logcat.flush(); self.postMessage({ ...message, requestId: activeRequestId }); snapshotScreenDuringOperation(message); }, budgetMs: OPERATION_WALL_LIMIT_MS });   // heartbeats to the page + the operation wall budget
      applyTimeLimits(runtime, data.eventSeconds);   // "Tempo máximo por evento" (src/time-limits.js): the per-event watchdog, the operation budget and the main-event caps
      runtime.platform.onPermissionRequest = request => self.postMessage({ type: 'permission-request', request });   // Activity.requestPermissions that needs the user: the page shows the dialog
      runtime.platform.permissionDialogs = false;   // until the page says it can show the permission dialog (permissions-config { dialogs: true }), a request is dismissed like a closed dialog
      runtime.platform.onPermissionConfig = config => self.postMessage({ type: 'permission-config', config });
      runtime.platform.onSystemPickerRequest = request => self.postMessage({ type: 'system-picker-request', request }); runtime.platform.systemPickerDialogs = false;   // a file picker Intent: the page shows the system picker once it said it can (shared-files { dialogs: true })
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
      appData = attached.persistence; appDataInfo = attached.status; lastLoadTiming = loadTiming.finish(); runtime.loadTiming = lastLoadTiming;
      send({ type: 'result', inventory: result.inventory, appData: appDataInfo, renderer: rendererStatus(), loadTiming: lastLoadTiming });
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
    } else if (type === 'app-data') {
      // "Dados do app" (src/app-storage.js): the app's SharedPreferences and SQLite databases, read and edited through the app's own stack, between VM events. A change runs what it
      // makes due (a SharedPreferences listener the app registered) and answers a fresh snapshot.
      if (!runtime) throw new Error('Abra um APK antes de ver os dados do app.');
      const storage = createAppStorage(runtime), op = String(data.op ?? 'overview'), changing = op === 'edit-prefs' || op === 'edit-row' || (op === 'sql' && !/^\s*(select|pragma|with|explain|values)\b/i.test(String(data.sql ?? '')));
      runtime.steps = 0;
      const output = monitored('app-data', () => {
        if (op === 'overview') return storage.overview();
        if (op === 'prefs') return storage.prefs(data.name);
        if (op === 'edit-prefs') return storage.editPrefs(data.name, data.changes);
        if (op === 'rows') return storage.tableRows(data.db, data.table, { offset: data.offset, limit: data.limit });
        if (op === 'edit-row') return storage.editRow(data.db, data.table, data.change ?? {});
        if (op === 'sql') return storage.sql(data.db, data.sql, Array.isArray(data.params) ? data.params : [], { limit: data.limit });
        throw new Error(`Operação de dados do app desconhecida: ${op}`);
      });
      if (changing) drainReadyEvents();
      send({ type: 'result', appData: output, ...(changing && runtime.activity ? { snapshot: currentSnapshot() } : {}) });
    } else if (type === 'invoke-method') {
      // lab.invoke (src/app-invoke.js): one of the app's methods, called on the VM's main thread as an operation of the page (like a click). What it schedules and is due
      // (a Handler message, a coroutine resumed on the main dispatcher, a recomposition) runs before the answer, which carries a fresh snapshot.
      if (!runtime) throw new Error('Abra um APK antes de chamar um método do app.');
      runtime.steps = 0; lastOperationAt = performance.now();
      let invocation;
      try { invocation = monitored('invoke', () => invokeAppMethod(runtime, data)); }
      catch (error) { if (error?.name !== 'PluginQueryError') throw error; send({ type: 'result', invocation: { error: { code: error.code, message: error.message } } }); succeeded = true; return; }   // a refused call (no such method, bad argument): nothing ran
      drainReadyEvents();
      send({ type: 'result', invocation, ...(runtime.activity ? { snapshot: currentSnapshot() } : {}) });
    } else if (type === 'inspect-native') {
      if (!runtime || typeof inspectNativeLibraries !== 'function') throw new Error('Reabra o APK para disponibilizar a inspeção ELF.');
      const libraries = await inspectNativeLibraries(data.paths, data.limits);
      send({ type: 'result', libraries, nativeInspection: inventory.nativeInspection });
    } else if (type === 'launcher-info') {
      // What the device's launcher shows for this app: label and icon read through the app's PackageManager (src/launcher-info.js).
      if (!runtime) throw new Error('Reabra um APK antes de executar a VM.');
      const info = launcherInfo(runtime); send({ type: 'result', launcher: info });
    } else if (type === 'render-variant') {
      // lab.renderVariant (src/render-variant.js, docs/RENDER-VARIANT.md): a second instance of the Activity on top runs in the background with its own endpoint mocks, its window
      // is returned as RGBA images (transferred) and it is destroyed. It holds the one-operation slot: page input waits, no snapshot of the background instance reaches the page.
      if (!runtime) throw new Error('Reabra um APK antes de executar a VM.');
      lastOperationAt = performance.now();
      const refresh = () => { try { if (runtime?.activity) postRuntimeEvent(); } catch { snapshotOwed = true; } };   // the visible windows were redrawn: the page gets a fresh frame of them
      let variant;
      try {
        variant = await renderVariant(runtime, data.options, { drain: () => monitored('render-variant', () => drainReadyEvents()), semantics: composeSemantics,
          composeTree: () => { const maxNodes = 2000, tree = compactComposeTree(inspectCompose(runtime, { maxNodes }), { maxNodes }); tree.activityName = runtime.activityType ? runtime.activityType.slice(1, -1).replaceAll('/', '.') : null; return tree; } });
      } catch (error) {
        if (!(error instanceof RenderVariantError)) throw error;
        send({ type: 'error', error: { name: error.name, code: error.code, message: error.message } }); refresh(); succeeded = true; return;
      }
      const pixels = []; for (const entry of [variant, ...variant.images]) if (entry.image) { entry.image.pixels = entry.image.pixels.buffer; pixels.push(entry.image.pixels); }
      logcat.flush(); netlog.flush(); lastOperationAt = performance.now();
      self.postMessage({ requestId, type: 'result', variant }, [...rasterSender.takeTransfers(), ...pixels]); refresh();
    } else if (type === 'launch' || type === 'intent' || type === 'click' || type === 'back' || type === 'home' || type === 'resume-task' || type === 'reload-activity' || type === 'input' || type === 'check' || type === 'focus' || type === 'press' || type === 'scroll' || type === 'compose-action' || type === 'ime' || type === 'pointer' || type === 'scrollby' || type === 'action-item') {
      if (!runtime) throw new Error('Reabra um APK antes de executar a VM.');
      send({ type: 'progress', progress: { phase: type, completed: 0, total: 1 } });
      lastOperationAt = performance.now(); runtime.monitor.begin(type); if (type !== 'launch' && type !== 'intent') runtime.platform.noteInput?.();   // scroll, focus, press and the rest reach the View directly below: the collector's input signal (heap-gc.js deferral)
      runtime.steps = 0; let droppedComposeAction = null, droppedEvent = null, deepLink = null, imeFallback = null;
      // An id the page took from an older snapshot can name a View that has since been collected (it was removed from the hierarchy): Android would not deliver the event either.
      const staleId = ['click', 'input', 'check', 'focus', 'press', 'scroll', 'scrollby'].includes(type) ? data.id : type === 'compose-action' || type === 'ime' || type === 'pointer' ? data.ownerViewId : null;
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
      else if (type === 'action-item') {
        // A click on an item of a floating action-mode toolbar the page drew from the snapshot: what the toolbar's OnMenuItemClickListener does (MenuBuilder.performItemAction).
        if (!Number.isSafeInteger(data.modeId) || !Number.isSafeInteger(data.itemId)) throw new TypeError('O item da barra de ação requer ids inteiros.');
        const outcome = isFreedId(runtime, data.modeId) || isFreedId(runtime, data.itemId) ? null : runtime.platform.actionModes.performToolbarItem(runtime, data.modeId, data.itemId);
        if (!outcome) { droppedEvent = { kind: 'stale-action-mode', type, id: data.modeId }; runtime.record(`EVENT dropped (action item ${data.itemId} of an action mode ${data.modeId} that is no longer shown)`); }
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
      else if (type === 'ime') imeFallback = await typeWithIme(data);
      else if (type === 'focus') runtime.dispatch({ owner: 'Landroid/view/View;', name: data.focused ? 'requestFocus' : 'clearFocus', signature: data.focused ? '()Z' : '()V', parameters: [], result: data.focused ? 'Z' : 'V' }, [{ ref: data.id }], 'virtual');
      else if (type === 'press') runtime.dispatch({ owner: 'Landroid/view/View;', name: 'setPressed', signature: '(Z)V', parameters: ['Z'], result: 'V' }, [{ ref: data.id }, data.pressed ? 1 : 0], 'virtual');
      else if (type === 'input') runtime.platform.setInput(runtime, data.id, data.text);
      else if (type === 'check') runtime.platform.checkInput(runtime, data.id, data.checked);
      else if (type === 'intent') {
        // A deep link / Intent the page describes: resolved against the manifest's intent filters and started like `am start` (see src/deep-link-host.js).
        deepLink = startDeepLink(runtime, data.intent || {});
      }
      else await (type === 'launch' ? runtime.launch(data.activity) : type === 'back' ? runtime.back() : type === 'home' ? runtime.home() : type === 'resume-task' ? runtime.resumeTask() : type === 'reload-activity' ? runtime.reloadActivity({ mode: data.mode === 'reopen' ? 'reopen' : 'recreate' }) : runtime.click(data.id));
      drainReadyEvents();
      if (deepLink && !deepLink.ok && !runtime.activity) { send({ type: 'result', deepLink }); succeeded = true; return; }   // nothing matched and no Activity runs yet: there is no screen to snapshot
      const motionRequest = type === 'scrollby' ? 'scrollby' : type === 'pointer' && data.action !== 1 && data.action !== 3 ? 'pointer-motion' : null;   // input in flight: a wheel step, a pointer DOWN/MOVE (UP/CANCEL end the gesture)
      const resultSnapshot = currentSnapshot({ request: motionRequest, pacedSemantics: type === 'scrollby' || (type === 'pointer' && data.action === 2) }); if (deepLink) resultSnapshot.deepLink = deepLink; if (droppedComposeAction) resultSnapshot.droppedComposeAction = droppedComposeAction; if (droppedEvent) resultSnapshot.droppedEvent = droppedEvent; if (imeFallback) resultSnapshot.imeFallback = imeFallback;
      send({ type: 'result', snapshot: resultSnapshot });
    } else throw new Error(`Operação de Worker desconhecida: ${type}`);
    succeeded = true;
  } catch (error) {
    send({ type: 'error', error: errorData(error) });
  } finally {
    // The request cleared the event timer when it started. A request that failed against a running app (a click whose listener raised an error the page now shows, a refused
    // argument) leaves the VM as alive as it was: what was already due still is (Handler messages, animation frames, the full-density replay owed for a frame shown reduced,
    // src/motion-raster.js), and the next request would wake it anyway. Only a failed start (load, launch, intent, restart) leaves nothing to resume.
    const resumable = !['load', 'launch', 'intent', 'reload-activity', 'resume-task'].includes(type) && !!runtime?.activity;
    runtime?.monitor?.end(); busy = false; surfaceThreadFailure(); if (succeeded || resumable) scheduleEvents(); if (type === 'launch' || type === 'intent') startApiGapScan();
  }
};
