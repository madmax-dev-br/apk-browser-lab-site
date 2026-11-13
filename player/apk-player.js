// Embeddable APK runner. Usage: <script type="module" src="…/player/apk-player.js"></script> then <apk-player src="app.apk" device="phone" locale="pt-BR" theme="dark">.
// The APK runs inside an iframe (player/frame.html) served from the runtime's origin; this script only talks to it through versioned postMessage.
// Reference: docs/PLAYER.md (API) and player/example.html (the same reference, with a live demo).
import { ATTRIBUTES, configFromAttributes, parseConfig, flattenConfig, envelope, validateFrameMessage, STREAMS } from './protocol.js?v=92e21e72be68';

const FRAME_TIMEOUT_MS = 20000, CALL_TIMEOUT_MS = 60000, INTENT_TIMEOUT_MS = 120000, CONFIG_TIMEOUT_MS = 60000;
const DEFAULT_ASSETS_BASE = new URL('../', import.meta.url).href;
const sleepless = () => {};
const failure = (code, message) => Object.assign(new Error(message), { code });

/** One running player. `target` is any element the iframe is appended to; events are dispatched on `eventTarget` (default: target). */
export class ApkPlayer extends EventTarget {
  /** ApkPlayer.mount(element, { apk: File|Blob|ArrayBuffer|URL string, config, assetsBase, name, activity, lazy, transfer, plugins }) */
  static mount(element, options = {}) { return new ApkPlayer(element, options); }
  constructor(target, { apk = null, config = {}, assetsBase = DEFAULT_ASSETS_BASE, name = '', activity = '', lazy = false, transfer = true, title = 'Android app (APK player)', eventTarget = null, scale = 'fit', pointerClicks = null, raster = null, keepData = false, clearData = false, plugins = null } = {}) {
    super();
    this.target = target; this.eventTarget = eventTarget; this.options = { apk, name, activity, transfer, title, scale, pointerClicks, raster, keepData: !!keepData, clearData: !!clearData }; this.config = {}; this.destroyed = false; this.helloReceived = false; this.ready = false; this.outbox = []; this.diagnosticRequests = new Map(); this.diagnosticId = 0;
    this.revision = 0; this.capabilities = new Set(); this.calls = new Map(); this.callId = 0; this.configWaits = new Map(); this.configId = 0;
    this.helloWaiters = []; this.streamListeners = Object.fromEntries(STREAMS.map(stream => [stream, new Set()])); this.pluginListeners = new Set(); this.pluginOutputs = new Map(); this.lastScreen = null;
    const base = new URL(assetsBase, globalThis.location?.href); this.frameURL = new URL('player/frame.html', base.href.endsWith('/') ? base.href : base.href + '/');
    this.frameOrigin = this.frameURL.origin;
    this.onMessage = event => this.receive(event);
    globalThis.addEventListener('message', this.onMessage);
    this.pendingConfig = { ...parseConfig(flattenConfig(config)).config };
    /** logcat.subscribe(fn) / network.subscribe(fn): the stream runs in the VM only while at least one listener is subscribed; each returns its unsubscribe function. */
    this.logcat = { subscribe: fn => this.subscribeStream('logcat', fn) };
    this.network = { subscribe: fn => this.subscribeStream('network', fn) };
    this.plugins = {
      /** Replace the plugin list ([{ id?, name, code, enabled = true, packageFilter }]). Resolves { plugins: [summary], rejected: [reason] }. */
      set: list => this.call('pluginsSet', { plugins: Array.isArray(list) ? list.map(item => ({ ...item })) : list }),
      stop: id => this.call('pluginsStop', { id }), restart: id => this.call('pluginsRestart', { id }), list: () => this.call('pluginsList'),
      /** fn(summary) for every output change of any plugin ({ id, name, status, badge, blocks, console, errors }); returns its unsubscribe function. */
      subscribe: fn => { if (typeof fn !== 'function') throw new TypeError('plugins.subscribe needs a function'); this.pluginListeners.add(fn); for (const output of this.pluginOutputs.values()) fn(output); return () => this.pluginListeners.delete(fn); },
      get outputs() { return outputs(); },
    };
    const outputs = () => [...this.pluginOutputs.values()];
    if (plugins) this.plugins.set(plugins).catch(error => this.emit('error', { kind: 'plugins', message: String(error?.message ?? error), phase: 'mount', frontier: null }));
    if (lazy && typeof IntersectionObserver !== 'undefined') { this.observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { this.observer.disconnect(); this.createFrame(); } }); this.observer.observe(target); }
    else this.createFrame();
  }
  emit(type, detail) {
    const event = new CustomEvent(type, { detail }); super.dispatchEvent(event);
    if (this.eventTarget) this.eventTarget.dispatchEvent(new CustomEvent(type, { detail }));
  }
  createFrame() {
    if (this.destroyed || this.iframe) return;
    const hostOrigin = globalThis.location?.origin;
    if (!hostOrigin || hostOrigin === 'null') { this.emit('error', { kind: 'opaque-host-origin', message: 'The embedding page has an opaque origin (file:// or sandbox without allow-same-origin); serve it over http(s).', phase: 'mount', frontier: null }); return; }
    const url = new URL(this.frameURL.href); url.searchParams.set('parent', hostOrigin); if (this.options.scale === 'actual') url.searchParams.set('scale', 'actual'); if (this.options.pointerClicks) url.searchParams.set('pointerClicks', this.options.pointerClicks); if (this.options.raster === 'full') url.searchParams.set('raster', 'full');   // measurement: every frame at full density
    const iframe = document.createElement('iframe');
    iframe.src = url.href; iframe.title = this.options.title; iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin'); iframe.setAttribute('allow', ''); iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.style.cssText = 'border:0;width:100%;height:100%;display:block;background:transparent;color-scheme:normal';
    this.iframe = iframe; this.target.append(iframe);
    this.helloTimer = setTimeout(() => { if (!this.helloReceived) this.emit('error', { kind: 'frame-unreachable', message: `The player frame at ${this.frameURL.href} did not answer in ${FRAME_TIMEOUT_MS / 1000} s (wrong assetsBase, blocked by CSP/X-Frame-Options, or the build is missing player/).`, phase: 'mount', frontier: null }); }, FRAME_TIMEOUT_MS);
  }
  post(message, transfer = []) {
    if (this.destroyed) return;
    if (!this.helloReceived) { this.outbox.push([message, transfer]); return; }
    this.iframe.contentWindow.postMessage(message, this.frameOrigin, transfer);
  }
  receive(event) {
    // Only our own iframe, only from the runtime origin we expect, only validated versioned messages.
    if (!this.iframe || event.source !== this.iframe.contentWindow || event.origin !== this.frameOrigin) return;
    const result = validateFrameMessage(event.data);
    if (!result.ok) { this.emit('error', { kind: 'protocol', message: result.error, phase: 'message', frontier: null }); return; }
    const message = result.message;
    if (message.type === 'hello') {
      clearTimeout(this.helloTimer); this.helloReceived = true; this.revision = message.revision ?? 1; this.capabilities = new Set(message.capabilities ?? []);
      this.sendInit(); for (const [pending, transfer] of this.outbox.splice(0)) this.post(pending, transfer);
      for (const resolve of this.helloWaiters.splice(0)) resolve();
      if (this.capabilities.has('screen-events')) this.call('subscribe', { stream: 'screen', on: true }).catch(sleepless);   // the 'screen' event: a few bytes per screen change
      return;
    }
    if (message.type === 'diagnostics') { const request = this.diagnosticRequests.get(message.id); if (request) { this.diagnosticRequests.delete(message.id); clearTimeout(request.timer); const { protocol, version, type, id, ...result } = message; request.resolve(result); } return; }
    if (message.type === 'reply') {
      const call = this.calls.get(message.id); if (!call) return;
      this.calls.delete(message.id); clearTimeout(call.timer);
      if (message.ok) call.resolve(message.value); else call.reject(failure(message.error.code, message.error.message));
      return;
    }
    if (message.type === 'ready') { this.ready = true; this.activity = message.activity; }
    if (message.type === 'activity-changed') this.activity = message.activity;
    if (message.type === 'config-applied') {
      this.config = message.config;
      const key = message.id !== undefined && this.configWaits.has(message.id) ? message.id : message.id === undefined ? this.configWaits.keys().next().value : undefined;   // a revision-1 frame echoes no id: the oldest waiter
      const wait = key === undefined ? null : this.configWaits.get(key); if (wait) { this.configWaits.delete(key); clearTimeout(wait.timer); const { protocol, version, type, id, ...detail } = message; wait.resolve(detail); }
    }
    if (message.type === 'screen') this.lastScreen = message.screen;
    if (message.type === 'logcat' || message.type === 'network') { const { protocol, version, type, ...batch } = message; for (const fn of this.streamListeners[type]) { try { fn(batch); } catch (error) { queueMicrotask(() => { throw error; }); } } }
    if (message.type === 'plugin-output') {
      const plugin = message.plugin; if (plugin.removed) this.pluginOutputs.delete(plugin.id); else this.pluginOutputs.set(plugin.id, plugin);
      for (const fn of this.pluginListeners) { try { fn(plugin); } catch (error) { queueMicrotask(() => { throw error; }); } }
    }
    const { protocol, version, type, ...detail } = message; this.emit(type, detail);
  }
  async sendInit() {
    const { apk, name, activity, transfer, keepData, clearData } = this.options;
    try {
      const base = { config: this.pendingConfig, name, activity: activity || undefined, keepData, clearData };
      if (typeof apk === 'string') { this.post(envelope('init', { ...base, url: new URL(apk, globalThis.location.href).href })); return; }
      let buffer;
      if (apk instanceof ArrayBuffer) buffer = transfer ? apk : apk.slice(0);
      else if (apk && typeof apk.arrayBuffer === 'function') buffer = await apk.arrayBuffer();
      else throw new Error('ApkPlayer needs an APK: a URL string, File/Blob or ArrayBuffer.');
      this.post(envelope('init', { ...base, name: name || apk.name || '', apk: buffer }), [buffer]);
    } catch (error) { this.emit('error', { kind: 'apk-source', message: String(error?.message || error), phase: 'mount', frontier: null }); }
  }
  /** Merge a config patch (same keys as the attributes, camelCase). Resolves immediately; the `config-applied` event reports the effective result. */
  setConfig(patch = {}) {
    const { config } = parseConfig(flattenConfig(patch));
    if (!this.helloReceived || !this.ready) this.pendingConfig = { ...this.pendingConfig, ...config };
    this.post(envelope('config', { config })); return this;
  }
  /** setConfig that waits: resolves with the `config-applied` detail of this patch ({ config, rejected, live, outcome, statuses }). Keys the host-side parser refuses are in `rejected` too. */
  configure(patch = {}, { timeoutMs = CONFIG_TIMEOUT_MS } = {}) {
    if (this.destroyed) return Promise.reject(failure('destroyed', 'The player was destroyed.'));
    const { config, rejected } = parseConfig(flattenConfig(patch));
    if (!this.helloReceived || !this.ready) this.pendingConfig = { ...this.pendingConfig, ...config };
    const id = ++this.configId;
    const promise = new Promise((resolve, reject) => { const timer = setTimeout(() => { this.configWaits.delete(id); reject(failure('timeout', 'The player frame did not answer configure().')); }, timeoutMs); this.configWaits.set(id, { resolve, reject, timer }); });
    this.post(envelope('config', { config, id }));
    return rejected.length ? promise.then(detail => ({ ...detail, rejected: [...rejected, ...detail.rejected] })) : promise;
  }
  whenHello() { return this.helloReceived ? Promise.resolve() : new Promise(resolve => this.helloWaiters.push(resolve)); }
  /** One `call` of the revision-2 protocol; rejects with { code: 'unsupported' } on an older frame. */
  async call(method, args = {}, timeoutMs = CALL_TIMEOUT_MS) {
    if (this.destroyed) throw failure('destroyed', 'The player was destroyed.');
    await this.whenHello();
    if (this.destroyed) throw failure('destroyed', 'The player was destroyed.');
    if (!this.capabilities.has('call')) throw failure('unsupported', `The player frame (protocol revision ${this.revision}) does not support ${method}(); update the runtime build.`);
    const id = ++this.callId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.calls.delete(id); reject(failure('timeout', `The player frame did not answer ${method}() in ${Math.round(timeoutMs / 1000)} s.`)); }, timeoutMs);
      this.calls.set(id, { resolve, reject, timer }); this.post(envelope('call', { id, method, args }));
    });
  }
  subscribeStream(stream, fn) {
    if (typeof fn !== 'function') throw new TypeError(`${stream}.subscribe needs a function`);
    const listeners = this.streamListeners[stream]; listeners.add(fn);
    if (listeners.size === 1) this.call('subscribe', { stream, on: true }).catch(error => this.emit('error', { kind: 'stream', message: String(error?.message ?? error), phase: stream, frontier: null }));
    let active = true;
    return () => { if (!active) return; active = false; listeners.delete(fn); if (!listeners.size && !this.destroyed) this.call('subscribe', { stream, on: false }).catch(sleepless); };
  }
  /** The stub lists of the running app at this moment: Promise<{ stubs: { void, returns, classes }, tolerateMissing, packageName, report }> (`key xN` strings). Same data as `error.detail.stubs`. */
  diagnostics(timeoutMs = 5000) {
    if (this.destroyed) return Promise.reject(new Error('The player was destroyed.'));
    return new Promise((resolve, reject) => {
      const id = ++this.diagnosticId, timer = setTimeout(() => { this.diagnosticRequests.delete(id); reject(new Error('The player frame did not answer diagnostics().')); }, timeoutMs);
      this.diagnosticRequests.set(id, { resolve, reject, timer }); this.post(envelope('diagnostics', { id }));
    });
  }
  /** The lab's "Copiar diagnóstico" text: cause, stack, stubs, active debugging features, log tail, screen state and API estimate. Resolves a string. */
  async diagnostic() { return (await this.call('diagnostic')).text; }
  /** A deep link or explicit Intent ({ data | link, action, component, type, category, extras }), resolved against the manifest like `am start`. Resolves { deepLink, state, message, detail }. */
  openIntent(intent = {}) { return this.call('openIntent', intent, INTENT_TIMEOUT_MS); }
  /** The lab's "Recriar" ({ mode: 'recreate' }, default: Activity.recreate(), state and ViewModels kept) or "Reabrir" ({ mode: 'reopen' }: a fresh instance with the same Intent, content loaded again); resolves { activity }. */
  reloadActivity({ mode = 'recreate' } = {}) { return this.call('reloadActivity', { mode }, INTENT_TIMEOUT_MS); }
  /** One inspection of the Compose layout tree on screen (the "Compose" panel). */
  inspectCompose({ maxNodes } = {}) { return this.call('inspectCompose', maxNodes === undefined ? {} : { maxNodes }); }
  /** The boxes "Mostrar limites de layout" draws, as data ([{ key, kind, name, bounds, texts, role, testTag, actions, … }]). */
  layoutBounds({ names } = {}) { return this.call('layoutBounds', names === undefined ? {} : { names }); }
  /** An image of the screen, or of one box (key from layoutBounds()): Promise<{ blob, width, height, notes }>. */
  screenshot({ key, maxWidth, type } = {}) { return this.call('screenshot', Object.fromEntries(Object.entries({ key, maxWidth, type }).filter(([, value]) => value !== undefined))); }
  /** "Estado da tela": the VM's description of the screen ({ text, blank, reasons }) or null without an APK. */
  screenState() { return this.call('screenState'); }
  /** Statuses and hit counters of overrides, ignored Activities, mocks and host redirects; permission state; streams. */
  status() { return this.call('status'); }
  /** The answer to a `permission-request` event (permissionDialog: 'host'): 'allow' | 'once' | 'deny' per dialog (or one for all), null = dismissed. */
  answerPermission(id, answers) { return this.call('answerPermission', { id, answers }); }
  /** "Parar VM": terminates the VM Worker now; restart() starts the app again. */
  stop() { return this.call('stop'); }
  back() { this.post(envelope('back')); return this; }
  restart() { this.post(envelope('restart')); return this; }
  /** Wipe the app's stored data (Settings > Apps > Clear storage) and restart it from empty storage. Resolves via the `data-cleared` event. */
  clearData() { this.post(envelope('clear-data')); return this; }
  destroy() {
    if (this.destroyed) return; try { if (this.helloReceived) this.iframe.contentWindow.postMessage(envelope('destroy'), this.frameOrigin); } catch { sleepless(); }
    this.destroyed = true; clearTimeout(this.helloTimer); this.observer?.disconnect(); globalThis.removeEventListener('message', this.onMessage); this.iframe?.remove(); this.iframe = null; this.outbox.length = 0; for (const [, request] of this.diagnosticRequests) { clearTimeout(request.timer); request.reject(new Error('The player was destroyed.')); } this.diagnosticRequests.clear();
    for (const [, call] of [...this.calls, ...this.configWaits]) { clearTimeout(call.timer); call.reject(failure('destroyed', 'The player was destroyed.')); } this.calls.clear(); this.configWaits.clear();
    for (const resolve of this.helloWaiters.splice(0)) resolve();
    for (const listeners of Object.values(this.streamListeners)) listeners.clear(); this.pluginListeners.clear();
  }
}

/** <apk-player src="app.apk" device="phone" locale="pt-BR" theme="dark" font-scale="1.1" orientation="portrait" …> */
export class ApkPlayerElement extends HTMLElement {
  static get observedAttributes() { return ['src', 'activity', 'assets-base', 'scale', 'keep-data', 'clear-data', ...Object.keys(ATTRIBUTES)]; }
  constructor() {
    super(); this.player = null; this.mounted = false;
    // Subscriptions and the plugin list belong to the element: a new src (a new player) gets them again.
    this.saved = { plugins: null, streams: Object.fromEntries(STREAMS.map(stream => [stream, new Set()])), unsubscribe: [] };
    const stream = name => ({ subscribe: fn => { if (typeof fn !== 'function') throw new TypeError(`${name}.subscribe needs a function`); this.saved.streams[name].add(fn); const off = this.player?.subscribeStream(name, fn); if (off) this.saved.unsubscribe.push([name, fn, off]); return () => { this.saved.streams[name].delete(fn); const at = this.saved.unsubscribe.findIndex(item => item[0] === name && item[1] === fn); if (at >= 0) this.saved.unsubscribe.splice(at, 1)[0][2](); }; } });
    this.logcat = stream('logcat'); this.network = stream('network');
    this.plugins = {
      set: list => { this.saved.plugins = Array.isArray(list) ? list.map(item => ({ ...item })) : list; return this.player ? this.player.plugins.set(list) : Promise.reject(new Error('The player is not mounted.')); },
      stop: id => this.player?.plugins.stop(id) ?? Promise.reject(new Error('The player is not mounted.')), restart: id => this.player?.plugins.restart(id) ?? Promise.reject(new Error('The player is not mounted.')),
      list: () => this.player?.plugins.list() ?? Promise.resolve([]), subscribe: fn => { if (typeof fn !== 'function') throw new TypeError('plugins.subscribe needs a function'); const listener = event => fn(event.detail.plugin); this.addEventListener('plugin-output', listener); for (const output of this.player?.plugins.outputs ?? []) fn(output); return () => this.removeEventListener('plugin-output', listener); },
    };
  }
  connectedCallback() {
    if (this.mounted) return; this.mounted = true;
    if (!this.style.display) this.style.display = 'block'; if (!this.style.height && !this.hasAttribute('height')) this.style.height = '640px';
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' }); let host = root.firstChild; if (!host) { host = document.createElement('div'); host.style.cssText = 'width:100%;height:100%'; root.append(host); }
    this.host = host;
    if (this.hasAttribute('src')) this.start(host);
  }
  /** Re-attaches the element's subscriptions and plugin list to a new player. */
  adopt(player) {
    this.player = player; this.saved.unsubscribe = [];
    for (const [name, fns] of Object.entries(this.saved.streams)) for (const fn of fns) this.saved.unsubscribe.push([name, fn, player.subscribeStream(name, fn)]);
    if (this.saved.plugins) player.plugins.set(this.saved.plugins).catch(error => this.dispatchEvent(new CustomEvent('error', { detail: { kind: 'plugins', message: String(error?.message ?? error), phase: 'mount', frontier: null } })));
    return player;
  }
  start(host = this.host) {
    const { config, rejected } = configFromAttributes(name => this.getAttribute(name));
    this.adopt(new ApkPlayer(host, { apk: this.getAttribute('src'), config, assetsBase: this.getAttribute('assets-base') || DEFAULT_ASSETS_BASE, activity: this.getAttribute('activity') || '', lazy: this.getAttribute('loading') === 'lazy', title: this.getAttribute('title') || 'Android app (APK player)', eventTarget: this, scale: this.getAttribute('scale') === 'actual' ? 'actual' : 'fit', keepData: this.flag('keep-data'), clearData: this.flag('clear-data') }));
    if (rejected.length) queueMicrotask(() => this.dispatchEvent(new CustomEvent('error', { detail: { kind: 'config', message: `Ignored invalid attributes: ${rejected.join(', ')}`, phase: 'mount', frontier: null } })));
  }
  attributeChangedCallback(name, oldValue, value) {
    if (!this.mounted || oldValue === value) return;
    if (name === 'src' || name === 'assets-base' || name === 'activity' || name === 'scale' || name === 'keep-data' || name === 'clear-data') { this.player?.destroy(); this.player = null; if (this.hasAttribute('src')) this.start(); return; }
    if (this.player && ATTRIBUTES[name]) this.player.setConfig(configFromAttributes(attribute => this.getAttribute(attribute)).config);
  }
  disconnectedCallback() { this.player?.destroy(); this.player = null; this.mounted = false; }
  setConfig(patch) { this.player?.setConfig(patch); return this; }
  configure(patch) { return this.player ? this.player.configure(patch) : Promise.reject(new Error('The player is not mounted.')); }
  diagnostics() { return this.player ? this.player.diagnostics() : Promise.reject(new Error('The player is not mounted.')); }
  back() { this.player?.back(); return this; }
  restart() { this.player?.restart(); return this; }
  clearData() { this.player?.clearData(); return this; }
  destroy() { this.player?.destroy(); this.player = null; return this; }
  /** Mount a File/ArrayBuffer programmatically (the `src` attribute only takes URLs). */
  load(apk, options = {}) { this.player?.destroy(); const config = configFromAttributes(name => this.getAttribute(name)).config; return this.adopt(new ApkPlayer(this.host ?? this.shadowRoot.firstChild, { apk, config, assetsBase: this.getAttribute('assets-base') || DEFAULT_ASSETS_BASE, eventTarget: this, keepData: this.flag('keep-data'), clearData: this.flag('clear-data'), ...options })); }
  /** Boolean attribute: present (or "true"/"") is on; "false"/"0" is off. */
  flag(name) { const value = this.getAttribute(name); return value !== null && value !== 'false' && value !== '0'; }
}
for (const method of ['reloadActivity', 'diagnostic', 'openIntent', 'inspectCompose', 'layoutBounds', 'screenshot', 'screenState', 'status', 'answerPermission', 'stop']) {
  ApkPlayerElement.prototype[method] = function (...args) { return this.player ? this.player[method](...args) : Promise.reject(new Error('The player is not mounted.')); };
}
if (globalThis.customElements && !customElements.get('apk-player')) customElements.define('apk-player', ApkPlayerElement);
globalThis.ApkPlayer = ApkPlayer;
