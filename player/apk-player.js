// Embeddable APK runner. Usage: <script type="module" src="…/player/apk-player.js"></script> then <apk-player src="app.apk" device="phone" locale="pt-BR" theme="dark">.
// The APK runs inside an iframe (player/frame.html) served from the runtime's origin; this script only talks to it through versioned postMessage.
import { ATTRIBUTES, configFromAttributes, parseConfig, envelope, validateFrameMessage } from './protocol.js?v=f2127a72f766';

const FRAME_TIMEOUT_MS = 20000;
const DEFAULT_ASSETS_BASE = new URL('../', import.meta.url).href;
const sleepless = () => {};

/** One running player. `target` is any element the iframe is appended to; events are dispatched on `eventTarget` (default: target). */
export class ApkPlayer extends EventTarget {
  /** ApkPlayer.mount(element, { apk: File|Blob|ArrayBuffer|URL string, config, assetsBase, name, activity, lazy, transfer }) */
  static mount(element, options = {}) { return new ApkPlayer(element, options); }
  constructor(target, { apk = null, config = {}, assetsBase = DEFAULT_ASSETS_BASE, name = '', activity = '', lazy = false, transfer = true, title = 'Android app (APK player)', eventTarget = null, scale = 'fit' } = {}) {
    super();
    this.target = target; this.eventTarget = eventTarget; this.options = { apk, name, activity, transfer, title, scale }; this.config = {}; this.destroyed = false; this.helloReceived = false; this.ready = false; this.outbox = [];
    const base = new URL(assetsBase, globalThis.location?.href); this.frameURL = new URL('player/frame.html', base.href.endsWith('/') ? base.href : base.href + '/');
    this.frameOrigin = this.frameURL.origin;
    this.onMessage = event => this.receive(event);
    globalThis.addEventListener('message', this.onMessage);
    this.pendingConfig = { ...parseConfig(config).config };
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
    const url = new URL(this.frameURL.href); url.searchParams.set('parent', hostOrigin); if (this.options.scale === 'actual') url.searchParams.set('scale', 'actual');
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
    if (message.type === 'hello') { clearTimeout(this.helloTimer); this.helloReceived = true; this.sendInit(); for (const [pending, transfer] of this.outbox.splice(0)) this.post(pending, transfer); return; }
    if (message.type === 'ready') { this.ready = true; this.activity = message.activity; }
    if (message.type === 'activity-changed') this.activity = message.activity;
    if (message.type === 'config-applied') this.config = message.config;
    const { protocol, version, type, ...detail } = message; this.emit(type, detail);
  }
  async sendInit() {
    const { apk, name, activity, transfer } = this.options;
    try {
      const base = { config: this.pendingConfig, name, activity: activity || undefined };
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
    const { config } = parseConfig(patch);
    if (!this.helloReceived || !this.ready) this.pendingConfig = { ...this.pendingConfig, ...config };
    this.post(envelope('config', { config })); return this;
  }
  back() { this.post(envelope('back')); return this; }
  restart() { this.post(envelope('restart')); return this; }
  destroy() {
    if (this.destroyed) return; try { if (this.helloReceived) this.iframe.contentWindow.postMessage(envelope('destroy'), this.frameOrigin); } catch { sleepless(); }
    this.destroyed = true; clearTimeout(this.helloTimer); this.observer?.disconnect(); globalThis.removeEventListener('message', this.onMessage); this.iframe?.remove(); this.iframe = null; this.outbox.length = 0;
  }
}

/** <apk-player src="app.apk" device="phone" locale="pt-BR" theme="dark" font-scale="1.1" orientation="portrait" …> */
export class ApkPlayerElement extends HTMLElement {
  static get observedAttributes() { return ['src', 'activity', 'assets-base', 'scale', ...Object.keys(ATTRIBUTES)]; }
  constructor() { super(); this.player = null; this.mounted = false; }
  connectedCallback() {
    if (this.mounted) return; this.mounted = true;
    if (!this.style.display) this.style.display = 'block'; if (!this.style.height && !this.hasAttribute('height')) this.style.height = '640px';
    const root = this.attachShadow({ mode: 'open' }); const host = document.createElement('div'); host.style.cssText = 'width:100%;height:100%'; root.append(host);
    if (this.hasAttribute('src')) this.start(host);
    this.host = host;
  }
  start(host = this.host) {
    const { config, rejected } = configFromAttributes(name => this.getAttribute(name));
    this.player = new ApkPlayer(host, { apk: this.getAttribute('src'), config, assetsBase: this.getAttribute('assets-base') || DEFAULT_ASSETS_BASE, activity: this.getAttribute('activity') || '', lazy: this.getAttribute('loading') === 'lazy', title: this.getAttribute('title') || 'Android app (APK player)', eventTarget: this, scale: this.getAttribute('scale') === 'actual' ? 'actual' : 'fit' });
    if (rejected.length) queueMicrotask(() => this.dispatchEvent(new CustomEvent('error', { detail: { kind: 'config', message: `Ignored invalid attributes: ${rejected.join(', ')}`, phase: 'mount', frontier: null } })));
  }
  attributeChangedCallback(name, oldValue, value) {
    if (!this.mounted || oldValue === value) return;
    if (name === 'src' || name === 'assets-base' || name === 'activity' || name === 'scale') { this.player?.destroy(); this.player = null; if (this.hasAttribute('src')) this.start(); return; }
    if (this.player && ATTRIBUTES[name]) this.player.setConfig(configFromAttributes(attribute => this.getAttribute(attribute)).config);
  }
  disconnectedCallback() { this.player?.destroy(); this.player = null; this.mounted = false; }
  setConfig(patch) { this.player?.setConfig(patch); return this; }
  back() { this.player?.back(); return this; }
  restart() { this.player?.restart(); return this; }
  destroy() { this.player?.destroy(); this.player = null; return this; }
  /** Mount a File/ArrayBuffer programmatically (the `src` attribute only takes URLs). */
  load(apk, options = {}) { this.player?.destroy(); const config = configFromAttributes(name => this.getAttribute(name)).config; this.player = new ApkPlayer(this.host ?? this.shadowRoot.firstChild, { apk, config, assetsBase: this.getAttribute('assets-base') || DEFAULT_ASSETS_BASE, eventTarget: this, ...options }); return this.player; }
}
if (globalThis.customElements && !customElements.get('apk-player')) customElements.define('apk-player', ApkPlayerElement);
globalThis.ApkPlayer = ApkPlayer;
