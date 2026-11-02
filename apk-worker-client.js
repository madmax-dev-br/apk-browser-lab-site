import { createWebAudioPlayer } from './web-audio-player.js?v=75f101f3827d';
import { createRasterReceiver } from './raster-cache.js?v=75f101f3827d';
export class APKWorkerClient {
  constructor({ workerURL = new URL('./runtime/apk-worker.js?v=75f101f3827d', import.meta.url), workerFactory, loadTimeoutMs = 120000, eventTimeoutMs = 45000 } = {}) {
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
      if (data?.type === 'heartbeat') { this.lastHeartbeat = { ...data, receivedAt: Date.now() }; this.onHeartbeat?.(data); return; }   // posted by the VM from inside its loops: the last one explains a timeout
      if (data?.type === 'app-data') { this.appData = data.status; this.onAppData?.(data.status); return; }
      if (data?.type === 'webview') { this.onWebView?.(data); return; }   // a WebView command for the page's iframes (src/webview-frame.js)
      if (data?.type === 'api-gaps') { this.apiGaps = data.report ?? null; this.onApiGaps?.(this.apiGaps); return; }   // static estimate, posted once after a launch; never part of a request
      if (data?.type === 'audio') { (this.audioPlayer ??= createWebAudioPlayer()).handle(data); return; }   // PCM from android.media.AudioTrack for the page's Web Audio output
      if (data?.type === 'runtime-busy') { this.onRuntimeBusy?.(true); return; }
      if (data?.type === 'runtime-idle') { this.onRuntimeBusy?.(false); return; }
      if (data?.type === 'runtime-event') { this.onRuntimeSnapshot?.(data.snapshot); return; }
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
      try { this.worker.postMessage({ type, requestId, ...payload }, transfer); }
      catch (error) { this.cancel(error); }
    });
  }
  async load(buffer, { onProgress, device = null, frameworkDex = null, frameworkResources = null, resourceConfigBytes = null, resourceConfigMetadata = null, tolerateMissing = 'off', keepData = true, clearData = false, webview = true } = {}) {
    this.cancel(); this.rasters.reset(); this.apiGaps = null;
    const response = await this.request('load', { buffer, device, frameworkDex, frameworkResources, resourceConfigBytes, resourceConfigMetadata, tolerateMissing, keepData, clearData, webview }, { onProgress, timeoutMs: this.loadTimeoutMs, transfer: [buffer, ...(frameworkDex ? [frameworkDex] : []), ...(resourceConfigBytes ? [resourceConfigBytes] : [])] });
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
  async screenState() { return (await this.request('screen-state', {}, { timeoutMs: 10000 })).screenState; }
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
  async back({ onProgress } = {}) {
    return (await this.request('back', {}, { onProgress, timeoutMs: this.eventTimeoutMs })).snapshot;
  }
  async inspectNative(paths, limits, { onProgress } = {}) {
    return this.request('inspect-native', { paths, limits }, { onProgress, timeoutMs: this.loadTimeoutMs });
  }
  cancel(error) {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      const reject = this.pending.reject; this.pending = null;
      if (!error) { error = new Error('Operação cancelada. O Worker foi encerrado; reabra o APK para continuar.'); error.name = 'AbortError'; }
      reject(error);
    }
  }
}
