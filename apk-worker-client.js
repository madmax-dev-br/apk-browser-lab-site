import { createWebAudioPlayer } from './web-audio-player.js?v=df19921e3eea';
import { createRasterReceiver } from './raster-cache.js?v=df19921e3eea';
import { sanitizePower, DEFAULT_POWER } from './plugin-power.js?v=df19921e3eea';
import { createDebugChannelBuffer, sendDebugCommand } from './debug-channel.js?v=df19921e3eea';
export class APKWorkerClient {
  constructor({ workerURL = new URL('./runtime/apk-worker.js?v=df19921e3eea', import.meta.url), workerFactory, loadTimeoutMs = 120000, eventTimeoutMs = 45000 } = {}) {
    this.workerURL = workerURL;
    this.workerFactory = workerFactory || ((url) => {
      if (typeof Worker === 'undefined') throw new Error('Web Workers are not available in this browser. Use a browser that supports module Workers; the APK will not be processed on the main thread.');
      return new Worker(url, { type: 'module', name: 'apk-dex-vm' });
    });
    this.loadTimeoutMs = loadTimeoutMs; this.eventTimeoutMs = eventTimeoutMs;
    this.worker = null; this.pending = null; this.sequence = 0; this.rasters = createRasterReceiver(); this.pluginPower = DEFAULT_POWER;
  }
  /** Starts the Worker ahead of the first load and has it fetch, verify and compile the lab's assets (framework, Skia, ICU, the core...) while the user picks an APK: the next
   *  load() uses this Worker instead of starting another. Does nothing when a Worker already exists. Errors are left to the load, which reports them. */
  prewarm() {
    if (this.worker) return false;
    try { this.ensureWorker(); this.worker.postMessage({ type: 'prewarm' }); this.fresh = true; return true; } catch { return false; }
  }
  ensureWorker() {
    if (this.worker) return;
    this.rasters.reset(); const worker = this.workerFactory(this.workerURL);
    this.worker = worker; this.fresh = false;
    worker.onmessage = ({ data }) => {
      if (worker !== this.worker) return;
      // Every snapshot, delivered or not, passes the raster cache in order so Worker and page LRUs stay identical.
      if (data?.snapshot) { try { this.rasters.resolve(data.snapshot); } catch (error) { this.cancel(error); return; } }
      if (data?.type === 'heartbeat') { this.lastHeartbeat = { ...data, receivedAt: Date.now() }; this.onHeartbeat?.(data); this.rearm?.(); return; }   // a Worker that keeps heartbeating is alive: the request timeout measures silence   // posted by the VM from inside its loops: the last one explains a timeout
      if (data?.type === 'screen-snapshot') { this.lastScreenSnapshot = { text: data.text, receivedAt: Date.now() }; return; }
      if (data?.type === 'permission-request') { this.onPermissionRequest?.(data.request); return; }   // Activity.requestPermissions that needs the user's answer
      if (data?.type === 'permission-config') { this.onPermissionConfig?.(data.config); return; }
      if (data?.type === 'system-picker-request') { this.onSystemPickerRequest?.(data.request); return; }   // a file picker Intent (GET_CONTENT, OPEN_DOCUMENT, PICK, PICK_IMAGES) waits for the user's choice
      if (data?.type === 'camera') { this.onCamera?.(data.message); return; }   // the VM's cameras asking the page for frames or for the camera screen (src/camera-lab.js)
      const call = this.sideCalls?.get(data?.requestId);
      if (call && (data.type === 'result' || data.type === 'error')) { clearTimeout(call.timer); this.sideCalls.delete(data.requestId); if (data.type === 'result') call.resolve(data); else call.reject(Object.assign(new Error(data.error?.message || 'VM failure.'), data.error || {})); return; }
      const side = this.sideRequests?.get(data?.requestId);
      if (side && (data.type === 'result' || data.type === 'error')) { clearTimeout(side.timer); this.sideRequests.delete(data.requestId); side.resolve(data.type === 'result' ? data.screenState : this.cachedScreenState()); return; }
      if (data?.type === 'app-data') { this.appData = data.status; this.onAppData?.(data.status); return; }
      if (data?.type === 'microg-data') { this.microgData = data.status; this.onMicrogData?.(data.status); return; }
      if (data?.type === 'microg-account') { this.onMicrogAccount?.(data.outcome); return; }   // the answer of "Add Google account (microG)": { ok, accountName, accountType, error }   // the stored microG (device) data, per package (src/app-data-store.js attachDeviceData)
      if (data?.type === 'logcat') { this.onLogcat?.(data); return; }   // a batch of the app's logcat lines (src/logcat.js), never part of a request
      if (data?.type === 'netlog') { this.onNetlog?.(data); return; }   // a batch of the app's network requests (src/netlog.js), never part of a request
      if (data?.type === 'recompositions') { this.onRecompositions?.(data.update); return; }   // src/compose-recompositions.js, only while the Layout panel counts
      if (data?.type === 'method-hook-calls') { this.onMethodHookCalls?.(data); return; }
      if (data?.type === 'net-route') { this.onNetRoute?.(data); return; }   // a request a plugin's route holds, or the outcome of its decision (src/network-routes.js)
      if (data?.type === 'debug-event' || data?.type === 'debug-held' || data?.type === 'debug-reply') { this.debugMessage(data); return; }   // the Java debugger (src/debugger.js, docs/DEBUGGER.md)   // calls of the methods plugins observe (lab.hook { observe }, src/method-hooks.js), one batch per message, never part of a request
      if (data?.type === 'webview') { this.onWebView?.(data); return; }
      if (data?.type === 'gl-frame') { this.onGlFrame?.(data.frame); return; }   // a frame of an OpenGL ES window surface (src/gles-native.js, drawn by src/gl-surfaces.js)   // a WebView command for the page's iframes (src/webview-frame.js)
      if (data?.type === 'api-gaps') { this.apiGaps = data.report ?? null; this.onApiGaps?.(this.apiGaps); const waiting = this.apiGapWaiters; this.apiGapWaiters = null; for (const resolve of waiting ?? []) resolve(this.apiGaps); return; }   // static estimate, posted once per `requestApiGaps()`; never part of a request
      if (data?.type === 'audio') { (this.audioPlayer ??= createWebAudioPlayer()).handle(data); return; }   // PCM from android.media.AudioTrack for the page's Web Audio output
      if (data?.type === 'runtime-busy') { this.onRuntimeBusy?.(true); return; }
      if (data?.type === 'runtime-idle') { this.onRuntimeBusy?.(false); return; }
      if (data?.type === 'runtime-event') { this.onRuntimeSnapshot?.(data.snapshot, data.seq); return; }
      if (data?.type === 'thread-failure') { this.onThreadFailure?.(data.failure ?? {}); return; }   // a lab error ended a background thread of the app (src/apk-worker.js surfaceThreadFailure), never part of a request
      if (data?.type === 'runtime-error') this.onRuntimeBusy?.(false);
      if (data?.type === 'runtime-error') { const error = new Error(data.error?.message || 'Failure in an asynchronous VM callback.'); Object.assign(error, data.error || {}); this.onRuntimeError?.(error); return; }
      const pending = this.pending;
      if (worker !== this.worker || !pending || data?.requestId !== pending.requestId) return;
      if (data.type === 'progress') { pending.onProgress?.(data.progress); return; }
      clearTimeout(pending.timer); this.pending = null;
      if (data.type === 'result') pending.resolve(data);
      else {
        const error = new Error(data.error?.message || 'Invalid response from the Worker.');
        Object.assign(error, data.error || {}); pending.reject(error);
      }
    };
    worker.onerror = (event) => {
      if (worker !== this.worker) return;
      event.preventDefault?.();
      this.cancel(new Error(`Web Worker failure: ${event.message || 'check the loading of the local modules'}. Reopen the APK to try again.`));
    };
    worker.onmessageerror = () => { if (worker === this.worker) this.cancel(new Error('Could not receive the data from the VM. Reopen the APK.')); };
  }
  /** "Último sinal da VM ...": what the last heartbeat said, and whether the VM went silent after it (a long synchronous host call or a loop that never reaches a tick). */
  describeLastSignal(type) {
    const beat = this.lastHeartbeat;
    if (!beat) {
      // Nothing since the request: the Worker never took it, because it was still inside earlier work (a scheduled pump, a long main-thread event) that sent no signal since.
      const before = this.beforeRequest, ago = before ? Math.round((before.requestAt - before.receivedAt) / 100) / 10 : null;
      const text = before
        ? `No signal from the VM was received during the ${type} operation: the Worker did not start it, it was still busy with earlier work. Its last signal came ${ago} s before the request: ${before.operation ?? 'scheduled work between requests'}, ${before.thread ?? 'no thread'}, ${(before.stack ?? []).join(' < ') || 'no stack'}, host call: ${before.hostCall ?? 'none'}${before.queueDepth !== null && before.queueDepth !== undefined ? `, queue: ${before.queueDepth}` : ''}.`
        : `No signal from the VM was received during the ${type} operation, and none before it: the Worker was busy with earlier work and did not start it.`;
      return { heartbeat: before ?? null, silentSeconds: null, text };
    }
    const silent = Math.max(0, (Date.now() - beat.receivedAt) / 1000), seconds = Math.round(silent * 10) / 10;
    let text = `Last VM signal ${seconds} s ago: ${beat.operation ?? type}, ${beat.thread ?? 'no thread'}, ${(beat.stack ?? []).join(' < ') || 'no stack'}, host call: ${beat.hostCall ?? 'none'}, events in this operation: ${beat.events ?? 0}, instructions: ${beat.instructions ?? 0}`;
    if (beat.busiest?.length) text += `, busiest: ${beat.busiest.join(', ')}`;
    if (beat.queueDepth !== null && beat.queueDepth !== undefined) text += `, queue: ${beat.queueDepth}${beat.nextDelay === null || beat.nextDelay === undefined ? '' : ` (next in ${Math.round(beat.nextDelay)} ms)`}`;
    text += '.';
    if (silent > 2) text += ` The VM has not responded since that signal${beat.hostCall ? ` (last host call in progress: ${beat.hostCall})` : ''}.`;
    return { heartbeat: beat, silentSeconds: seconds, text };
  }
  request(type, payload = {}, { onProgress, timeoutMs, transfer = [] } = {}) {
    if (this.pending) return Promise.reject(Object.assign(new Error('A VM operation is already in progress.'), { kind: 'vm-busy', operation: this.pending.type ?? null }));
    try { this.ensureWorker(); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const requestId = ++this.sequence; if (type !== 'screen-state') { if (this.lastHeartbeat) this.beforeRequest = { ...this.lastHeartbeat, requestAt: Date.now() }; this.lastHeartbeat = null; }   // what the Worker last said before this request: the explanation when it never starts it   // a state request must not forget the signals of the work the VM is busy with
      const timer = setTimeout(() => {
        const signal = this.describeLastSignal(type), error = new Error(`The ${type} operation exceeded ${Math.round(timeoutMs / 1000)} s. The Worker was terminated; reopen the APK to continue.${signal ? ' ' + signal.text : ''}`);
        error.name = 'TimeoutError'; if (signal) error.details = { kind: 'vm-timeout', operation: type, heartbeat: signal.heartbeat, silentSeconds: signal.silentSeconds, heartbeatText: signal.text }; this.cancel(error);
      }, timeoutMs);
      this.pending = { requestId, resolve, reject, timer, onProgress, type, startedAt: Date.now() };
      const fire = () => {
        const signal = this.describeLastSignal(type), error = new Error(`The ${type} operation exceeded ${Math.round(timeoutMs / 1000)} s. The Worker was terminated; reopen the APK to continue.${signal ? ' ' + signal.text : ''}`);
        error.name = 'TimeoutError'; if (signal) error.details = { kind: 'vm-timeout', operation: type, heartbeat: signal.heartbeat, silentSeconds: signal.silentSeconds, heartbeatText: signal.text }; this.cancel(error);
      };
      // Silence, not total time: every heartbeat of this operation re-arms the timer (up to 5x the timeout in all); without heartbeats the original timeout stands.
      this.rearm = () => { const pending = this.pending; if (!pending || pending.requestId !== requestId || Date.now() - pending.startedAt > timeoutMs * 8) return; clearTimeout(pending.timer); pending.timer = setTimeout(fire, timeoutMs); };
      try { this.worker.postMessage({ type, requestId, ...payload }, transfer); }
      catch (error) { this.cancel(error); }
    });
  }
  async load(buffer, { onProgress, arm64Native = false, arm64Translate = true, glesCpu = false, hardwareWindow = true, schedulingOf25 = false, prepareFromLastRun = true, nativeVersionMismatch = false, device = null, frameworkDex = null, frameworkResources = null, resourceConfigBytes = null, resourceConfigMetadata = null, tolerateMissing = 'off', strictCrash = false, keepData = true, clearData = false, webview = true, memoryMiB = 0, methodOverrides = [], ignoredActivities = [], endpointMocks = [], eventSeconds = 0, permissions = null, motionRaster = true, rasterScale = undefined, rasterNavigation = false, rasterSettled = 1, logcatStreaming = false, renderer = 'cpu', engine = 'js', coreMemory = null, microg = false, microgServices = null, customIdentity = null, textScale = 1, loadImage = false } = {}) {
    this.cancel(null, { keepFresh: true }); this.rasters.reset(); this.apiGaps = null; this.apiGapWaiters = null; this.fresh = false;   // a Worker started by prewarm() that has run nothing yet is kept: its assets are loading or loaded
    const response = await this.request('load', { buffer, nativeVersionMismatch: nativeVersionMismatch === true, device, frameworkDex, frameworkResources, resourceConfigBytes, resourceConfigMetadata, tolerateMissing, strictCrash, keepData, clearData, webview, memoryMiB, methodOverrides, ignoredActivities, endpointMocks, eventSeconds, permissions, motionRaster, rasterScale, rasterNavigation, rasterSettled, logcatStreaming, renderer: renderer === 'gpu' ? 'gpu' : 'cpu', engine: engine === 'wasm' ? 'wasm' : 'js', coreMemory, arm64Native: arm64Native === true, arm64Translate: arm64Translate !== false, glesCpu: glesCpu === true, hardwareWindow: hardwareWindow !== false, schedulingOf25: schedulingOf25 === true, prepareFromLastRun: prepareFromLastRun !== false, microg: microg === true, microgServices: microgServices && typeof microgServices === 'object' ? { ...microgServices } : null, customIdentity: customIdentity && typeof customIdentity === 'object' ? { ...customIdentity } : null, textScale: [1, 2, 3, 4].includes(textScale) ? textScale : 1, loadImage: loadImage === true }, { onProgress, timeoutMs: this.loadTimeoutMs, transfer: [buffer, ...(frameworkDex ? [frameworkDex] : []), ...(resourceConfigBytes ? [resourceConfigBytes] : [])] });
    this.appData = response.appData ?? null; this.microgData = response.microgData ?? null; this.renderer = response.renderer ?? null;
    return { inventory: response.inventory, appData: this.appData, microgData: this.microgData, renderer: this.renderer };
  }
  /** Settings > Apps > Clear storage for the loaded app: wipes its stored data; the caller restarts the app. Resolves with the new usage status. */
  async clearAppData() { const response = await this.request('app-data-clear', {}, { timeoutMs: this.eventTimeoutMs }); this.appData = response.appData ?? null; return this.appData; }
  /** "Clear microG data": wipes the stored data of the device option's packages (device data, shared by every app); the running device keeps what it has until the APK is reopened. Resolves with the statuses per package. */
  async clearMicrogData() { const response = await this.request('microg-data-clear', {}, { timeoutMs: this.eventTimeoutMs }); this.microgData = response.microgData ?? null; return this.microgData; }
  /** Fire-and-forget: ask the Worker to store the app data now (page hidden or closing). Works while the VM is busy. */
  /** An event from a WebView iframe (loaded, failed) for the Worker's backend; fire and forget. */
  webViewEvent(event) { try { this.worker?.postMessage({ ...event, requestId: ++this.sequence }); } catch { /* worker already gone */ } }
  flushAppData() { try { this.worker?.postMessage({ type: 'app-data-flush', requestId: ++this.sequence }); } catch { /* worker already gone */ } }
  /** "Estado da tela": the VM's picture of the screen (activity stack, view tree, Compose, frames, queue, threads, memory, swallowed exceptions) as { text, blank, reasons }. */
  /** The last screen-state text captured during an operation, marked as such: the Worker cannot answer while it executes VM code. */
  cachedScreenState() {
    const last = this.lastScreenSnapshot; if (!last) return null;
    return { text: `${last.text}\n(captured ${Math.round((Date.now() - last.receivedAt) / 100) / 10} s ago during a VM operation: the Worker does not respond while it runs VM code; the Compose semantics are not included)`, blank: false, reasons: [], stale: true };
  }
  /** Tells the Worker that the page has drawn the scheduled-event snapshot `seq` (back-pressure: the Worker does not take the next one while one is undrawn, src/apk-worker.js). */
  /** The static API-gap estimate (src/api-gap-scan.js) of the loaded APK, for the diagnostics: the Worker scans on this request, in its idle time. Resolves with the report, or null when there is none (no APK, a scan that failed) or after `timeoutMs`. */
  requestApiGaps(timeoutMs = 8000) {
    if (this.apiGaps) return Promise.resolve(this.apiGaps);
    if (!this.worker) return Promise.resolve(null);
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(this.apiGaps ?? null), timeoutMs); const first = !this.apiGapWaiters; (this.apiGapWaiters ??= []).push(report => { clearTimeout(timer); resolve(report); });
      if (first) { try { this.worker.postMessage({ type: 'api-gaps-request' }); } catch { /* the Worker is gone */ } }
    });
  }
  ackFrame(seq) { try { this.worker?.postMessage({ type: 'frame-ack', seq }); } catch { /* the Worker is gone */ } }
  /** A request answered from the Worker's message loop between two VM events, outside the one-operation slot (method overrides, permission state): resolves with the reply, rejects when there is no Worker or it stays silent. */
  sideCall(type, payload = {}, timeoutMs = 8000) {
    if (!this.worker) return Promise.reject(new Error('No APK is loaded in the VM.'));
    return new Promise((resolve, reject) => {
      const requestId = ++this.sequence, calls = this.sideCalls ??= new Map();
      const timer = setTimeout(() => { calls.delete(requestId); reject(new Error(`The VM did not respond to "${type}" in ${Math.round(timeoutMs / 1000)} s (busy with an operation).`)); }, timeoutMs);
      calls.set(requestId, { resolve, reject, timer });
      try { this.worker.postMessage({ ...payload, type, requestId }); } catch (error) { clearTimeout(timer); calls.delete(requestId); reject(error); }
    });
  }
  // ---- the Java debugger (docs/DEBUGGER.md). debug(name, args) sends one command ("debug-" + name in the Worker); its result is the command's. Events arrive at
  // onDebugEvent(event). While the Worker is held in place (a stop inside host code, event.mode 'in-place') it cannot take messages: commands go through the shared channel,
  // and the operation the stop interrupted (an input, lab.invoke) waits without its timeout.
  /** Attaches the debugger to the loaded VM ({ suspend: 'all' | 'thread' }); shares the synchronous channel where SharedArrayBuffer is available. */
  async debugAttach(options = {}) {
    this.debugChannel ??= createDebugChannelBuffer();
    return (await this.sideCall('debug-attach', { ...options, ...(this.debugChannel ? { channel: this.debugChannel } : {}) })).debug;
  }
  async debug(name, args = {}, timeoutMs = 30000) {
    const command = String(name).replace(/^debug-/, '');
    if (command === 'attach') return this.debugAttach(args);
    if (this.debugHeld) return this.debugInPlace(command, args, timeoutMs);
    return (await this.sideCall(`debug-${command}`, args, timeoutMs)).debug;
  }
  debugInPlace(name, args, timeoutMs) {
    const id = `c${++this.sequence}`, replies = this.debugReplies ??= new Map();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { replies.delete(id); reject(new Error(`The held VM did not answer "${name}" in ${Math.round(timeoutMs / 1000)} s.`)); }, timeoutMs);
      replies.set(id, { resolve, reject, timer });
      const queue = this.debugQueue ??= [];
      queue.push({ id, name, args }); this.flushDebugQueue();
    });
  }
  flushDebugQueue() {
    const queue = this.debugQueue; if (!queue?.length || !this.debugHeld || this.debugBusy) return;
    if (!sendDebugCommand(this.debugChannel, queue[0])) return;
    queue.shift(); this.debugBusy = true;
  }
  debugMessage(data) {
    if (data.type === 'debug-held') { this.debugHeld = true; this.debugBusy = false; const pending = this.pending; if (pending) clearTimeout(pending.timer); this.flushDebugQueue(); this.onDebugHeld?.(data.state); return; }
    if (data.type === 'debug-reply') {
      const call = this.debugReplies?.get(data.id); this.debugBusy = false;
      if (call) { clearTimeout(call.timer); this.debugReplies.delete(data.id); if (data.error) call.reject(Object.assign(new Error(data.error.message), data.error)); else call.resolve(data.result); }
      return;
    }
    const event = data.event;
    if (event?.type === 'resumed' || event?.type === 'detached') { if (this.debugHeld) { this.debugHeld = false; this.rearm?.(); } }
    // a stop held in place: the Worker waits on the channel from now on (its 'debug-held' message comes next), so a command sent by a listener of this very event goes there
    if (event?.type === 'paused' && event.mode === 'in-place' && event.held !== false && this.debugChannel) this.debugHeld = true;
    this.onDebugEvent?.(event);
  }
  /** Debugging tool: installs the return-value overrides ([{ method, value, enabled }]) in the running VM; resolves with one status per entry. */
  /** The device's radio receives an SMS from `from` with text `body` (src/telephony-sms.js): SMS_RECEIVED goes to the holders of RECEIVE_SMS. */
  async receiveSms(from, body) { return this.sideCall('incoming-sms', { from, body }); }
  /** "Add Google account (microG)": the device opens microG's sign-in screen (Settings > Accounts > Add); resolves { started, reason }, the outcome arrives through onMicrogAccount. */
  async addMicrogAccount() { return this.sideCall('microg-add-account', {}); }
  async setMethodOverrides(overrides) { return (await this.sideCall('method-overrides', { overrides })).statuses; }
  /** "Resolução no movimento" (1 = always full density, or 0.75 / 0.5 / 0.35 / 0.25) and "Tela nova em baixa resolução", applied live. */
  /** "Renderização" (src/gpu-raster.js): 'cpu' (default) or 'gpu' (experimental), applied live; resolves the renderer status (requested, active, fallback reason). */
  async setRenderer(renderer) { const response = await this.sideCall('renderer', { renderer: renderer === 'gpu' ? 'gpu' : 'cpu' }); this.renderer = response.renderer ?? null; return response.renderer; }
  async setRasterSettings({ scale, navigation, settled }) { return (await this.sideCall('raster-settings', { scale, navigation, settled })).raster; }
  /** "Show layout bounds": with `on`, the Worker's snapshots carry the rectangles Compose draws for debug.layout (src/compose-layout-bounds.js). Sent only when it changes for the
   * current Worker (a new Worker starts with it off); resolves false when there is no Worker or the call fails. */
  syncLayoutBounds(on) {
    const worker = this.worker, wanted = !!on; if (!worker) return Promise.resolve(false);
    if ((this.layoutBoundsWorker === worker) === wanted) return Promise.resolve(wanted);
    this.layoutBoundsWorker = wanted ? worker : null;
    return this.sideCall('layout-bounds', { on: wanted }).then(reply => !!reply.layoutBounds, () => { if (this.layoutBoundsWorker === worker) this.layoutBoundsWorker = null; return false; });
  }
  /** "Show frame rate": with `on`, the Worker adds what it measured for each frame to its snapshots (src/frame-meter.js); sent only when it changes for the current Worker (a new Worker starts
   * with it off); resolves false when there is no Worker or the call fails. */
  syncFrameTiming(on) {
    const worker = this.worker, wanted = !!on; if (!worker) return Promise.resolve(false);
    if ((this.frameTimingWorker === worker) === wanted) return Promise.resolve(wanted);
    this.frameTimingWorker = wanted ? worker : null;
    return this.sideCall('frame-timing', { on: wanted }).then(reply => !!reply.frameTiming, () => { if (this.frameTimingWorker === worker) this.frameTimingWorker = null; return false; });
  }
  async setTimeLimits(seconds) { return (await this.sideCall('time-limits', { seconds })).limits; }
  /** The Logcat panel opened (the Worker posts its recent lines, then streams) or closed (only a counter, src/logcat.js). Without a Worker there is nothing to stream. */
  async setLogcatStreaming(open) { if (!this.worker) return { streaming: false, total: 0 }; return this.sideCall('logcat-stream', { open: !!open }); }
  /** One inspection of the Compose layout tree on the screen (src/compose-inspector.js), answered between two VM events; null when no APK is loaded. */

  async inspectCompose({ maxNodes = 2000 } = {}) { if (!this.worker) return null; return (await this.sideCall('compose-inspect', { maxNodes }, 15000)).inspection ?? null; }
  /** "Count recompositions" of the Layout panel (src/compose-recompositions.js): sent only when it changes for the current Worker (a new Worker starts with it off); resolves the
   * counting status, or null when nothing was sent. The counts then arrive through onRecompositions. */
  syncRecompositions(on) {
    const worker = this.worker, wanted = !!on; if (!worker || (this.recompositionsWorker === worker) === wanted) return Promise.resolve(null);
    this.recompositionsWorker = wanted ? worker : null;
    return this.sideCall('compose-recompositions', { on: wanted }).then(reply => reply.recompositions ?? null, () => { if (this.recompositionsWorker === worker) this.recompositionsWorker = null; return null; });
  }
  /** The counters go back to 0; resolves the status. */
  async resetRecompositions() { if (!this.worker) return null; return (await this.sideCall('compose-recompositions', { reset: true })).recompositions ?? null; }
  /** A page plugin's read-only query (src/plugin-queries.js; queued and served at low priority by the Worker). Rejects with `code` 'no-apk' when no APK is loaded. */
  async pluginQuery(query, args = {}) { if (!this.worker) throw Object.assign(new Error('No APK is running.'), { code: 'no-apk' }); const reply = await this.sideCall('plugin-query', { query, args, power: this.pluginPower }, 10000); return { value: reply.value, ms: reply.ms }; }
  /** "Plugin power" (src/plugin-power.js): the level every later plugin query carries, and, with a Worker, the level applied at once. Resolves with { level, stats } (the Worker's serving stats), or null without a Worker. */
  async setPluginPower(level) { this.pluginPower = sanitizePower(level); if (!this.worker) return null; const reply = await this.sideCall('plugin-power', { level: this.pluginPower }, 4000); return { level: reply.level, stats: reply.stats }; }
  /** The Worker's plugin serving stats { served, ms, deferred, rejected, maxMs, batches, batched, queued } and its level; null without a Worker. */
  async pluginPowerStatus() { if (!this.worker) return null; const reply = await this.sideCall('plugin-power', {}, 2000); return { level: reply.level, stats: reply.stats }; }
  async setEndpointMocks(mocks) { return (await this.sideCall('endpoint-mocks', { mocks })).statuses; }
  /** "Blocked calls" (src/blocked-calls.js): replaces the VM's rules; one status per rule. */
  /** An import of the Controls' configuration carried plugins: the VM keeps the note for its trace and the Resumo (src/config-import-note.js). */
  async noteConfigImport(note) { return (await this.sideCall('config-import-note', { note })).count; }
  async setBlockedCalls(rules) { return (await this.sideCall('blocked-calls', { rules })).statuses; }
  /** Plugin network routes (lab.route): replaces the VM's list ([{ id, owner, ownerName, name, filter }]); one status per route. */
  async setNetworkRoutes(routes) { return (await this.sideCall('net-routes', { routes })).statuses; }
  /** A plugin's decision for a held request (no reply: the outcome arrives at onNetRoute). */
  netRouteDecision(rid, decision) { try { this.worker?.postMessage({ type: 'net-route-decision', rid, decision }); } catch { /* the Worker is gone */ } }
  /** The plugins' method changes (lab.hook, src/method-hooks.js), answered between two VM events: op 'add' ({ spec, owner: { id, name }, id }), 'remove' ({ id, owner }),
   *  'remove-owner' ({ owner }) or 'list'. Resolves { loaded, hook?, removed?, hooks } (hooks: every change of the VM); rejects with `code` (and `errors` for a smali body). */
  async methodHooks(op, payload = {}) { if (!this.worker) throw Object.assign(new Error('No APK is running.'), { code: 'no-apk' }); return this.sideCall('method-hooks', { ...payload, op, power: this.pluginPower }, 15000); }
  /** The Code browser's reads and file edits (src/code-service.js), answered between two VM events: op 'search' | 'class-tree' | 'class-info' | 'disassemble' | 'java-outline' |
   *  'read-file' | 'check-smali' | 'edit-file' | 'revert-file' | 'file-edits' with its `args`. Resolves the operation's value; rejects with `code` ('no-apk' without a VM). */
  async codeService(op, args = {}) {
    if (!this.worker) throw Object.assign(new Error('No APK is running.'), { code: 'no-apk' });
    if (this.debugHeld) return this.debugInPlace('code', { op, args }, 20000);   // held in place at a breakpoint: the debugger serves the reads through its channel (src/debugger.js CODE_READS)
    const reply = await this.sideCall('code-service', { op, args }, 20000);
    if (!reply.loaded) throw Object.assign(new Error('No APK is running.'), { code: 'no-apk' });
    return reply.value;
  }
  /** The "com microG" entry points (src/microg-entry-points.js): sets the page's constant-value mocks ([{ id, value }]; an id left out is unmocked) and resolves the entry-point rows. */
  async setMicrogMocks(mocks) { return (await this.sideCall('microg-mocks', { mocks })).entryPoints ?? []; }
  /** "microG services" (src/microg-services.js): the user's choice of microG's online services, applied to a running microG as its settings screen applies a switch; resolves microG's state ({ chosen, effective, ... }) or null without microG. */
  async setMicrogServices(services) { return (await this.sideCall('microg-services', { services })).services ?? null; }
  async setIgnoredActivities(entries) { return (await this.sideCall('ignored-activities', { entries })).statuses; }
  /** The permission states and the simulated location ({ config, location }), applied between two VM events; either part may be left out. */
  async setPermissions(payload) { return this.sideCall('permissions-config', payload); }
  /** The files of the device's shared storage ({ replace, remove: [id], files: [{ id, name, mime, size, modified, width, height, duration, bytes }], dialogs }); resolves with the device's list. */
  async setSharedFiles(payload) { return this.sideCall('shared-files', payload, 30000); }
  /** The answer to a `system-picker-request` (onSystemPickerRequest): the chosen file ids in order, or null when the picker was dismissed. */
  systemPickerResponse(id, selected) { try { this.worker?.postMessage({ type: 'system-picker-response', requestId: ++this.sequence, id, selected }); } catch { /* the Worker is gone */ } }
  /** A message of the page's camera source to the VM's cameras (src/camera-host.js): attach, a frame (its pixel buffers are transferred), the camera screen's result. Never part of a request. */
  cameraMessage(message, transfer = []) { try { this.worker?.postMessage({ type: 'camera', message }, transfer); } catch { /* the Worker is gone */ } }
  /** The answer to a `permission-request` (onPermissionRequest): the config after the user's dialog, or null when it was dismissed. */
  permissionResponse(id, config) { try { this.worker?.postMessage({ type: 'permission-response', requestId: ++this.sequence, id, config }); } catch { /* the Worker is gone */ } }
  /** Methods of the loaded APK matching `query`, and the return types of owner->name(parameters) for a Java-form text. */
  async searchMethods({ query = '', owner = null, name = null, parameters = [] } = {}) { const reply = await this.sideCall('method-search', { query, owner, name, parameters }); return { methods: reply.methods, returnTypes: reply.returnTypes }; }
  /** Side channel: independent of the one-operation-at-a-time request slot, so it works while a click or launch is running (and then answers from the last snapshot). */
  screenState() {
    if (!this.worker) return Promise.resolve(this.cachedScreenState());
    return new Promise(resolve => {
      const requestId = ++this.sequence, sides = this.sideRequests ??= new Map();
      const timer = setTimeout(() => { sides.delete(requestId); resolve(this.cachedScreenState()); }, this.pending ? 1500 : 10000);
      sides.set(requestId, { resolve, timer });
      try { this.worker.postMessage({ type: 'screen-state', requestId }); } catch { clearTimeout(timer); sides.delete(requestId); resolve(this.cachedScreenState()); }
    });
  }
  /** Starts an Activity from an Intent description ({ action, data, category, extras, type, component }). Resolves with { deepLink: { ok, activity, filter, alternatives, error, considered }, snapshot } (snapshot is null when nothing matched and no Activity runs). */
  async startIntent(intent, { onProgress } = {}) {
    const response = await this.request('intent', { intent }, { onProgress, timeoutMs: this.eventTimeoutMs });
    return { deepLink: response.snapshot?.deepLink ?? response.deepLink, snapshot: response.snapshot ?? null };
  }
  async launch(activity, { onProgress } = {}) {
    return (await this.request('launch', { activity }, { onProgress, timeoutMs: this.eventTimeoutMs })).snapshot;
  }
  async click(id, { onProgress } = {}) {
    return (await this.request('click', { id }, { onProgress, timeoutMs: this.eventTimeoutMs })).snapshot;
  }
  async setDevice(device) { const response = await this.request('device', { device }, { timeoutMs: this.eventTimeoutMs }); return { outcome: response.outcome, snapshot: response.snapshot ?? null }; }
  /** One pointer sample for a Compose view: { ownerViewId, action (0 down,1 up,2 move,3 cancel), x, y (dp inside the view), t (ms, page clock) }. */
  async pointer(sample) { return (await this.request('pointer', sample, { timeoutMs: this.eventTimeoutMs })).snapshot; }
  /** Wheel/trackpad scrolling of a RecyclerView (View.scrollBy, dispatched to the original RecyclerView code), in dp. */
  /** A snapshot of the screen as it is now with a freshly walked Compose semantics tree (the one the page holds may be paced behind the screen: src/semantics-pacing.js); null without a running Activity. */
  async refreshSemantics() { return (await this.request('semantics-refresh', {}, { timeoutMs: this.eventTimeoutMs })).snapshot ?? null; }
  async scrollBy(id, dx, dy) { return (await this.request('scrollby', { id, dx, dy }, { timeoutMs: this.eventTimeoutMs })).snapshot; }
  async press(id, pressed, x, y) { return (await this.request('press', { id, pressed, x, y }, { timeoutMs: this.eventTimeoutMs })).snapshot; }
  async focus(id, focused) { return (await this.request('focus', { id, focused }, { timeoutMs: this.eventTimeoutMs })).snapshot; }
  async input(id, text) { return (await this.request('input', { id, text }, { timeoutMs: this.eventTimeoutMs })).snapshot; }
  async check(id, checked) { return (await this.request('check', { id, checked }, { timeoutMs: this.eventTimeoutMs })).snapshot; }
  async scroll(id, x, y) { return (await this.request('scroll', { id, x, y }, { timeoutMs: this.eventTimeoutMs })).snapshot; }
  /** Keys of the page's keyboard for a Compose text field, sent through the served view's InputConnection (src/input-method-service-host.js imeEdit); each op may carry the
   *  browser control's resulting text as `fallbackText`, used (and recorded) only when the view has no InputConnection. */
  async ime(ownerViewId, nodeId, ops) { return (await this.request('ime', { ownerViewId, nodeId, ops }, { timeoutMs: this.eventTimeoutMs })).snapshot; }
  /** A click on an item of a floating action-mode toolbar (snapshot.actionModes): the VM performs MenuBuilder.performItemAction on it. */
  async actionItem(modeId, itemId) { return (await this.request('action-item', { modeId, itemId }, { timeoutMs: this.eventTimeoutMs })).snapshot; }
  async composeAction(ownerViewId, nodeId, action, args = []) { return (await this.request('compose-action', {ownerViewId,nodeId,action,args}, {timeoutMs:this.eventTimeoutMs})).snapshot; }
  /** "Recriar" (mode recreate: Activity.recreate(), state kept) or "Reabrir" (mode reopen: a fresh instance with the same Intent); answers the snapshot after the relaunch. */
  async reloadActivity({ mode = 'recreate', onProgress } = {}) {
    return (await this.request('reload-activity', { mode }, { onProgress, timeoutMs: this.eventTimeoutMs })).snapshot;
  }
  /** lab.renderVariant (src/render-variant.js, docs/RENDER-VARIANT.md): renders a second, background instance of the Activity on top with `endpointMocks` in front of the lab's and
   *  resolves with its screen ({ image, images, views, semantics, composeTree, requests, mocks, timedOut, ... }; each image is { width, height, scale, pixels: ArrayBuffer RGBA8 }).
   *  It takes the one-operation slot like a click; rejects with `code` (bad-args, no-activity, not-resumed, busy, unsupported, cleanup-failed). */
  async renderVariant(options = {}) {
    const timeoutMs = Math.max(this.eventTimeoutMs, 2 * (Number(options?.timeoutMs) || 0) + 15000);
    return (await this.request('render-variant', { options }, { timeoutMs })).variant;
  }
  async home({ onProgress } = {}) { return (await this.request('home', {}, { onProgress, timeoutMs: this.eventTimeoutMs })).snapshot; }
  async resumeTask({ onProgress } = {}) { return (await this.request('resume-task', {}, { onProgress, timeoutMs: this.eventTimeoutMs })).snapshot; }
  /** "Dados do app" (src/app-storage.js): { op: 'overview' | 'prefs' | 'edit-prefs' | 'rows' | 'edit-row' | 'sql', ... } -> { appData, snapshot? } (a change answers a fresh snapshot). */
  /** lab.invoke (src/app-invoke.js): { handle | className, method, signature, args } -> { invocation, snapshot }. */
  async invokeMethod(payload) { const response = await this.request('invoke-method', payload, { timeoutMs: this.eventTimeoutMs }); return { invocation: response.invocation, snapshot: response.snapshot ?? null }; }
  async appStorage(payload) { const response = await this.request('app-data', payload, { timeoutMs: this.eventTimeoutMs }); return { appData: response.appData, snapshot: response.snapshot ?? null }; }
  async launcherInfo() { return (await this.request('launcher-info', {}, { timeoutMs: this.eventTimeoutMs })).launcher; }
  async back({ onProgress } = {}) {
    return (await this.request('back', {}, { onProgress, timeoutMs: this.eventTimeoutMs })).snapshot;
  }
  async inspectNative(paths, limits, { onProgress } = {}) {
    return this.request('inspect-native', { paths, limits }, { onProgress, timeoutMs: this.loadTimeoutMs });
  }
  cancel(error, { keepFresh = false } = {}) {
    if (this.worker && !(keepFresh && this.fresh)) { this.worker.terminate(); this.worker = null; }
    for (const side of this.sideRequests?.values() ?? []) { clearTimeout(side.timer); side.resolve(this.cachedScreenState()); }
    this.sideRequests?.clear();
    for (const call of this.sideCalls?.values() ?? []) { clearTimeout(call.timer); call.reject(new Error('The VM was terminated.')); }
    this.sideCalls?.clear();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      const reject = this.pending.reject; this.pending = null;
      if (!error) { error = new Error('Operation canceled. The Worker was terminated; reopen the APK to continue.'); error.name = 'AbortError'; }
      reject(error);
    } else if (error) this.onRuntimeError?.(error);   // the Worker died between requests (a module or memory failure): the page hears of it as of any asynchronous VM error
  }
}
