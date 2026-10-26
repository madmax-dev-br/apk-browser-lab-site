import { createRasterReceiver } from './raster-cache.js?v=b08d65940904';
export class APKWorkerClient {
  constructor({ workerURL = new URL('./runtime/apk-worker.js?v=b08d65940904', import.meta.url), workerFactory, loadTimeoutMs = 120000, eventTimeoutMs = 30000 } = {}) {
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
  request(type, payload = {}, { onProgress, timeoutMs, transfer = [] } = {}) {
    if (this.pending) return Promise.reject(new Error('Uma operação da VM já está em andamento.'));
    try { this.ensureWorker(); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const requestId = ++this.sequence;
      const timer = setTimeout(() => {
        const error = new Error(`A operação ${type} excedeu ${Math.round(timeoutMs / 1000)} s. O Worker foi encerrado; reabra o APK para continuar.`);
        error.name = 'TimeoutError'; this.cancel(error);
      }, timeoutMs);
      this.pending = { requestId, resolve, reject, timer, onProgress };
      try { this.worker.postMessage({ type, requestId, ...payload }, transfer); }
      catch (error) { this.cancel(error); }
    });
  }
  async load(buffer, { onProgress, device = null, frameworkDex = null, frameworkResources = null, resourceConfigBytes = null, resourceConfigMetadata = null, tolerateMissingVoid = false } = {}) {
    this.cancel(); this.rasters.reset();
    const response = await this.request('load', { buffer, device, frameworkDex, frameworkResources, resourceConfigBytes, resourceConfigMetadata, tolerateMissingVoid }, { onProgress, timeoutMs: this.loadTimeoutMs, transfer: [buffer, ...(frameworkDex ? [frameworkDex] : []), ...(resourceConfigBytes ? [resourceConfigBytes] : [])] });
    return { inventory: response.inventory };
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
