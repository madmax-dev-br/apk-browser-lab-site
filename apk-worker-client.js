import { createWebAudioPlayer } from './web-audio-player.js?v=96c9de77f557';
import { createRasterReceiver } from './raster-cache.js?v=96c9de77f557';
export class APKWorkerClient {
  constructor({ workerURL = new URL('./runtime/apk-worker.js?v=96c9de77f557', import.meta.url), workerFactory, loadTimeoutMs = 120000, eventTimeoutMs = 45000 } = {}) {
    this.workerURL = workerURL;
    this.workerFactory = workerFactory || ((url) => {
      if (typeof Worker === 'undefined') throw new Error('Web Workers não estão disponíveis neste navegador. Use um navegador com suporte a module Workers; o APK não será processado na interface principal.');
      return new Worker(url, { type: 'module', name: 'apk-dex-vm' });
    });
    this.loadTimeoutMs = loadTimeoutMs; this.eventTimeoutMs = eventTimeoutMs;
    this.worker = null; this.pending = null; this.sequence = 0; this.rasters = createRasterReceiver();
  }
  ensureWorker() {
    if (this.worker) return;
    this.rasters.reset(); const worker = this.workerFactory(this.workerURL);
    this.worker = worker;
    worker.onmessage = ({ data }) => {
      if (worker !== this.worker) return;
      // Every snapshot, delivered or not, passes the raster cache in order so Worker and page LRUs stay identical.
      if (data?.snapshot) { try { this.rasters.resolve(data.snapshot); } catch (error) { this.cancel(error); return; } }
      if (data?.type === 'heartbeat') { this.lastHeartbeat = { ...data, receivedAt: Date.now() }; this.onHeartbeat?.(data); this.rearm?.(); return; }   // a Worker that keeps heartbeating is alive: the request timeout measures silence   // posted by the VM from inside its loops: the last one explains a timeout
      if (data?.type === 'screen-snapshot') { this.lastScreenSnapshot = { text: data.text, receivedAt: Date.now() }; return; }
      if (data?.type === 'permission-request') { this.onPermissionRequest?.(data.request); return; }   // Activity.requestPermissions that needs the user's answer
      if (data?.type === 'permission-config') { this.onPermissionConfig?.(data.config); return; }
      const call = this.sideCalls?.get(data?.requestId);
      if (call && (data.type === 'result' || data.type === 'error')) { clearTimeout(call.timer); this.sideCalls.delete(data.requestId); if (data.type === 'result') call.resolve(data); else call.reject(Object.assign(new Error(data.error?.message || 'Falha na VM.'), data.error || {})); return; }
      const side = this.sideRequests?.get(data?.requestId);
      if (side && (data.type === 'result' || data.type === 'error')) { clearTimeout(side.timer); this.sideRequests.delete(data.requestId); side.resolve(data.type === 'result' ? data.screenState : this.cachedScreenState()); return; }
      if (data?.type === 'app-data') { this.appData = data.status; this.onAppData?.(data.status); return; }
      if (data?.type === 'logcat') { this.onLogcat?.(data); return; }   // a batch of the app's logcat lines (src/logcat.js), never part of a request
      if (data?.type === 'netlog') { this.onNetlog?.(data); return; }   // a batch of the app's network requests (src/netlog.js), never part of a request
      if (data?.type === 'webview') { this.onWebView?.(data); return; }   // a WebView command for the page's iframes (src/webview-frame.js)
      if (data?.type === 'api-gaps') { this.apiGaps = data.report ?? null; this.onApiGaps?.(this.apiGaps); return; }   // static estimate, posted once after a launch; never part of a request
      if (data?.type === 'audio') { (this.audioPlayer ??= createWebAudioPlayer()).handle(data); return; }   // PCM from android.media.AudioTrack for the page's Web Audio output
      if (data?.type === 'runtime-busy') { this.onRuntimeBusy?.(true); return; }
      if (data?.type === 'runtime-idle') { this.onRuntimeBusy?.(false); return; }
      if (data?.type === 'runtime-event') { this.onRuntimeSnapshot?.(data.snapshot, data.seq); return; }
      if (data?.type === 'runtime-error') this.onRuntimeBusy?.(false);
      if (data?.type === 'runtime-error') { const error = new Error(data.error?.message || 'Falha em callback assíncrono da VM.'); Object.assign(error, data.error || {}); this.onRuntimeError?.(error); return; }
      const pending = this.pending;
      if (worker !== this.worker || !pending || data?.requestId !== pending.requestId) return;
      if (data.type === 'progress') { pending.onProgress?.(data.progress); return; }
      clearTimeout(pending.timer); this.pending = null;
      if (data.type === 'result') pending.resolve(data);
      else {
        const error = new Error(data.error?.message || 'Resposta inválida do Worker.');
        Object.assign(error, data.error || {}); pending.reject(error);
      }
    };
    worker.onerror = (event) => {
      if (worker !== this.worker) return;
      event.preventDefault?.();
      this.cancel(new Error(`Falha no Web Worker: ${event.message || 'verifique o carregamento dos módulos locais'}. Reabra o APK para tentar novamente.`));
    };
    worker.onmessageerror = () => { if (worker === this.worker) this.cancel(new Error('Não foi possível receber os dados da VM. Reabra o APK.')); };
  }
  /** "Último sinal da VM ...": what the last heartbeat said, and whether the VM went silent after it (a long synchronous host call or a loop that never reaches a tick). */
  describeLastSignal(type) {
    const beat = this.lastHeartbeat;
    if (!beat) return { heartbeat: null, silentSeconds: null, text: `Nenhum sinal da VM foi recebido durante a operação ${type}; o Worker não chegou a executar código da VM.` };
    const silent = Math.max(0, (Date.now() - beat.receivedAt) / 1000), seconds = Math.round(silent * 10) / 10;
    let text = `Último sinal da VM há ${seconds} s: ${beat.operation ?? type}, ${beat.thread ?? 'sem thread'}, ${(beat.stack ?? []).join(' < ') || 'sem pilha'}, chamada do host: ${beat.hostCall ?? 'nenhuma'}, eventos nesta operação: ${beat.events ?? 0}, instruções: ${beat.instructions ?? 0}`;
    if (beat.busiest?.length) text += `, mais ocupados: ${beat.busiest.join(', ')}`;
    if (beat.queueDepth !== null && beat.queueDepth !== undefined) text += `, fila: ${beat.queueDepth}${beat.nextDelay === null || beat.nextDelay === undefined ? '' : ` (próximo em ${Math.round(beat.nextDelay)} ms)`}`;
    text += '.';
    if (silent > 2) text += ` A VM não respondeu desde esse sinal${beat.hostCall ? ` (última chamada do host em andamento: ${beat.hostCall})` : ''}.`;
    return { heartbeat: beat, silentSeconds: seconds, text };
  }
  request(type, payload = {}, { onProgress, timeoutMs, transfer = [] } = {}) {
    if (this.pending) return Promise.reject(Object.assign(new Error('Uma operação da VM já está em andamento.'), { kind: 'vm-busy', operation: this.pending.type ?? null }));
    try { this.ensureWorker(); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const requestId = ++this.sequence; if (type !== 'screen-state') this.lastHeartbeat = null;   // a state request must not forget the signals of the work the VM is busy with
      const timer = setTimeout(() => {
        const signal = this.describeLastSignal(type), error = new Error(`A operação ${type} excedeu ${Math.round(timeoutMs / 1000)} s. O Worker foi encerrado; reabra o APK para continuar.${signal ? ' ' + signal.text : ''}`);
        error.name = 'TimeoutError'; if (signal) error.details = { kind: 'vm-timeout', operation: type, heartbeat: signal.heartbeat, silentSeconds: signal.silentSeconds, heartbeatText: signal.text }; this.cancel(error);
      }, timeoutMs);
      this.pending = { requestId, resolve, reject, timer, onProgress, type, startedAt: Date.now() };
      const fire = () => {
        const signal = this.describeLastSignal(type), error = new Error(`A operação ${type} excedeu ${Math.round(timeoutMs / 1000)} s. O Worker foi encerrado; reabra o APK para continuar.${signal ? ' ' + signal.text : ''}`);
        error.name = 'TimeoutError'; if (signal) error.details = { kind: 'vm-timeout', operation: type, heartbeat: signal.heartbeat, silentSeconds: signal.silentSeconds, heartbeatText: signal.text }; this.cancel(error);
      };
      // Silence, not total time: every heartbeat of this operation re-arms the timer (up to 5x the timeout in all); without heartbeats the original timeout stands.
      this.rearm = () => { const pending = this.pending; if (!pending || pending.requestId !== requestId || Date.now() - pending.startedAt > timeoutMs * 8) return; clearTimeout(pending.timer); pending.timer = setTimeout(fire, timeoutMs); };
      try { this.worker.postMessage({ type, requestId, ...payload }, transfer); }
      catch (error) { this.cancel(error); }
    });
  }
  async load(buffer, { onProgress, device = null, frameworkDex = null, frameworkResources = null, resourceConfigBytes = null, resourceConfigMetadata = null, tolerateMissing = 'off', strictCrash = false, keepData = true, clearData = false, webview = true, memoryMiB = 0, methodOverrides = [], ignoredActivities = [], endpointMocks = [], eventSeconds = 0, permissions = null, motionRaster = true, rasterScale = undefined, rasterNavigation = true, logcatStreaming = false } = {}) {
    this.cancel(); this.rasters.reset(); this.apiGaps = null;
    const response = await this.request('load', { buffer, device, frameworkDex, frameworkResources, resourceConfigBytes, resourceConfigMetadata, tolerateMissing, strictCrash, keepData, clearData, webview, memoryMiB, methodOverrides, ignoredActivities, endpointMocks, eventSeconds, permissions, motionRaster, rasterScale, rasterNavigation, logcatStreaming }, { onProgress, timeoutMs: this.loadTimeoutMs, transfer: [buffer, ...(frameworkDex ? [frameworkDex] : []), ...(resourceConfigBytes ? [resourceConfigBytes] : [])] });
    this.appData = response.appData ?? null;
    return { inventory: response.inventory, appData: this.appData };
  }
  /** Settings > Apps > Clear storage for the loaded app: wipes its stored data; the caller restarts the app. Resolves with the new usage status. */
  async clearAppData() { const response = await this.request('app-data-clear', {}, { timeoutMs: this.eventTimeoutMs }); this.appData = response.appData ?? null; return this.appData; }
  /** Fire-and-forget: ask the Worker to store the app data now (page hidden or closing). Works while the VM is busy. */
  /** An event from a WebView iframe (loaded, failed) for the Worker's backend; fire and forget. */
  webViewEvent(event) { try { this.worker?.postMessage({ ...event, requestId: ++this.sequence }); } catch { /* worker already gone */ } }
  flushAppData() { try { this.worker?.postMessage({ type: 'app-data-flush', requestId: ++this.sequence }); } catch { /* worker already gone */ } }
  /** "Estado da tela": the VM's picture of the screen (activity stack, view tree, Compose, frames, queue, threads, memory, swallowed exceptions) as { text, blank, reasons }. */
  /** The last screen-state text captured during an operation, marked as such: the Worker cannot answer while it executes VM code. */
  cachedScreenState() {
    const last = this.lastScreenSnapshot; if (!last) return null;
    return { text: `${last.text}\n(captura feita há ${Math.round((Date.now() - last.receivedAt) / 100) / 10} s durante uma operação da VM: o Worker não responde enquanto executa código da VM; a semântica do Compose não está incluída)`, blank: false, reasons: [], stale: true };
  }
  /** Tells the Worker that the page has drawn the scheduled-event snapshot `seq` (back-pressure: the Worker does not take the next one while one is undrawn, src/apk-worker.js). */
  ackFrame(seq) { try { this.worker?.postMessage({ type: 'frame-ack', seq }); } catch { /* the Worker is gone */ } }
  /** A request answered from the Worker's message loop between two VM events, outside the one-operation slot (method overrides, permission state): resolves with the reply, rejects when there is no Worker or it stays silent. */
  sideCall(type, payload = {}, timeoutMs = 8000) {
    if (!this.worker) return Promise.reject(new Error('Nenhum APK está carregado na VM.'));
    return new Promise((resolve, reject) => {
      const requestId = ++this.sequence, calls = this.sideCalls ??= new Map();
      const timer = setTimeout(() => { calls.delete(requestId); reject(new Error(`A VM não respondeu a "${type}" em ${Math.round(timeoutMs / 1000)} s (ocupada com uma operação).`)); }, timeoutMs);
      calls.set(requestId, { resolve, reject, timer });
      try { this.worker.postMessage({ ...payload, type, requestId }); } catch (error) { clearTimeout(timer); calls.delete(requestId); reject(error); }
    });
  }
  /** Debugging tool: installs the return-value overrides ([{ method, value, enabled }]) in the running VM; resolves with one status per entry. */
  async setMethodOverrides(overrides) { return (await this.sideCall('method-overrides', { overrides })).statuses; }
  /** "Resolução no movimento" (1 = always full density, or 0.75 / 0.5 / 0.35 / 0.25) and "Tela nova em baixa resolução", applied live. */
  async setRasterSettings({ scale, navigation }) { return (await this.sideCall('raster-settings', { scale, navigation })).raster; }
  async setTimeLimits(seconds) { return (await this.sideCall('time-limits', { seconds })).limits; }
  /** The Logcat panel opened (the Worker posts its recent lines, then streams) or closed (only a counter, src/logcat.js). Without a Worker there is nothing to stream. */
  async setLogcatStreaming(open) { if (!this.worker) return { streaming: false, total: 0 }; return this.sideCall('logcat-stream', { open: !!open }); }
  /** One inspection of the Compose layout tree on the screen (src/compose-inspector.js), answered between two VM events; null when no APK is loaded. */
  async inspectCompose({ maxNodes = 2000 } = {}) { if (!this.worker) return null; return (await this.sideCall('compose-inspect', { maxNodes }, 15000)).inspection ?? null; }
  /** A page plugin's read-only query (src/plugin-queries.js; queued and served at low priority by the Worker). Rejects with `code` 'no-apk' when no APK is loaded. */
  async pluginQuery(query, args = {}) { if (!this.worker) throw Object.assign(new Error('Nenhum APK em execução.'), { code: 'no-apk' }); const reply = await this.sideCall('plugin-query', { query, args }, 10000); return { value: reply.value, ms: reply.ms }; }
  async setEndpointMocks(mocks) { return (await this.sideCall('endpoint-mocks', { mocks })).statuses; }
  async setIgnoredActivities(entries) { return (await this.sideCall('ignored-activities', { entries })).statuses; }
  /** The permission states and the simulated location ({ config, location }), applied between two VM events; either part may be left out. */
  async setPermissions(payload) { return this.sideCall('permissions-config', payload); }
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
  async scrollBy(id, dx, dy) { return (await this.request('scrollby', { id, dx, dy }, { timeoutMs: this.eventTimeoutMs })).snapshot; }
  async press(id, pressed) { return (await this.request('press', { id, pressed }, { timeoutMs: this.eventTimeoutMs })).snapshot; }
  async focus(id, focused) { return (await this.request('focus', { id, focused }, { timeoutMs: this.eventTimeoutMs })).snapshot; }
  async input(id, text) { return (await this.request('input', { id, text }, { timeoutMs: this.eventTimeoutMs })).snapshot; }
  async check(id, checked) { return (await this.request('check', { id, checked }, { timeoutMs: this.eventTimeoutMs })).snapshot; }
  async scroll(id, x, y) { return (await this.request('scroll', { id, x, y }, { timeoutMs: this.eventTimeoutMs })).snapshot; }
  async composeAction(ownerViewId, nodeId, action, args = []) { return (await this.request('compose-action', {ownerViewId,nodeId,action,args}, {timeoutMs:this.eventTimeoutMs})).snapshot; }
  /** "Recriar" (mode recreate: Activity.recreate(), state kept) or "Reabrir" (mode reopen: a fresh instance with the same Intent); answers the snapshot after the relaunch. */
  async reloadActivity({ mode = 'recreate', onProgress } = {}) {
    return (await this.request('reload-activity', { mode }, { onProgress, timeoutMs: this.eventTimeoutMs })).snapshot;
  }
  async back({ onProgress } = {}) {
    return (await this.request('back', {}, { onProgress, timeoutMs: this.eventTimeoutMs })).snapshot;
  }
  async inspectNative(paths, limits, { onProgress } = {}) {
    return this.request('inspect-native', { paths, limits }, { onProgress, timeoutMs: this.loadTimeoutMs });
  }
  cancel(error) {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    for (const side of this.sideRequests?.values() ?? []) { clearTimeout(side.timer); side.resolve(this.cachedScreenState()); }
    this.sideRequests?.clear();
    for (const call of this.sideCalls?.values() ?? []) { clearTimeout(call.timer); call.reject(new Error('A VM foi encerrada.')); }
    this.sideCalls?.clear();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      const reject = this.pending.reject; this.pending = null;
      if (!error) { error = new Error('Operação cancelada. O Worker foi encerrado; reabra o APK para continuar.'); error.name = 'AbortError'; }
      reject(error);
    }
  }
}
