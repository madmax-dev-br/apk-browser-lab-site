import { tunnelEndpoint } from './tcp-tunnel.js?v=8411deb8def1';

// The Worker's end of the relay's WebView channel (protocol in scripts/relay-webview.cjs, docs/NETWORK.md "WebView documents through the relay"). With the device's Proxy set to an APK
// Lab Relay address, a WebView's http(s) documents are served to its iframe by the relay (http://<label>.localhost:<port>/...) and every request of those documents is decided here:
// the backend (src/webview-backend.js) answers `request` and `call` messages, this class only carries them, keeps the slot table (label -> view, origin) and knows whether the relay
// has the channel at all.

export const WEBVIEW_RELAY_VERSION = 1;
/** ws(s)://host:port/webview for the device's Proxy, or null when the Proxy is not an APK Lab Relay address (`policy.webviewRelayUrl` in tests). */
export function webviewRelayEndpoint(policy) {
  if (policy?.webviewRelayUrl) return String(policy.webviewRelayUrl);
  const tcp = tunnelEndpoint({ proxyUrl: policy?.proxyUrl });
  return tcp ? tcp.replace(/\/tcp$/, '/webview') : null;
}
const SLOT_HOST = /^([a-f0-9]{20})\.localhost(?::\d{1,5})?$/i;

export class WebViewRelayChannel {
  /** `create(url)` makes this realm's WebSocket; `onMessage(message)` hears the relay's requests and calls; `onEvent(kind, detail)` hears 'open' and 'unavailable' ({ reason }). */
  constructor({ endpoint, create = url => new globalThis.WebSocket(url), onMessage = () => {}, onEvent = () => {}, helloTimeoutMs = 3000, retryMs = 15000, now = () => Date.now() }) {
    Object.assign(this, { endpoint, create, onMessage, onEvent, helloTimeoutMs, retryMs, now });
    this.state = 'idle'; this.socket = null; this.opening = null; this.retryAt = 0; this.reason = null; this.slots = new Map(); this.opens = new Map(); this.nextOpen = 1; this.hello = null;
  }
  get open() { return this.state === 'open'; }
  /** A promise of true once the relay greeted the channel, false when it cannot be had (the reason is in `reason`); asked again `retryMs` after a failure. */
  ready() {
    if (this.state === 'open') return Promise.resolve(true);
    if (this.state === 'connecting') return this.opening;
    if (this.state === 'closed' || this.now() < this.retryAt) return Promise.resolve(false);
    this.state = 'connecting';
    this.opening = new Promise(resolve => {
      let socket = null, settled = false, timer = null;
      const fail = reason => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (this.state === 'connecting') this.state = 'idle';
        this.reason = reason; this.retryAt = this.now() + this.retryMs; this.opening = null;
        try { socket?.close(); } catch { /* never opened */ }
        this.onEvent('unavailable', { reason }); resolve(false);
      };
      if (typeof this.create !== 'function') { fail('this realm has no WebSocket'); return; }
      try { socket = this.create(this.endpoint); } catch (error) { fail(`the channel could not be opened (${error?.message ?? error})`); return; }
      timer = setTimeout(() => fail('the relay did not greet the WebView channel (a relay from before 0.5.0, or another proxy?)'), this.helloTimeoutMs);
      timer?.unref?.();
      socket.onmessage = event => {
        let message = null; if (typeof event.data === 'string') { try { message = JSON.parse(event.data); } catch { /* not ours */ } }
        if (!settled) {
          if (message?.t !== 'hello' || message.v !== WEBVIEW_RELAY_VERSION) { fail(`the relay answered with another WebView protocol (${String(event.data).slice(0, 80)})`); return; }
          settled = true; clearTimeout(timer); this.socket = socket; this.hello = message; this.state = 'open'; this.reason = null; this.opening = null;
          this.onEvent('open', { port: message.port }); resolve(true); return;
        }
        if (this.socket === socket && message) this.receive(message);
      };
      socket.onerror = () => { if (!settled) fail('the relay refused the WebView channel (no relay at this address, or this page is not one of its allowed origins)'); };
      socket.onclose = () => {
        if (!settled) { fail('the relay closed the WebView channel'); return; }
        if (this.socket !== socket) return;
        this.socket = null; if (this.state === 'open') this.state = 'idle';
        this.slots.clear(); for (const resolve of this.opens.values()) resolve({ error: 'the WebView channel closed' }); this.opens.clear();
        this.onEvent('dropped', { reason: 'the relay closed the WebView channel' });
      };
    });
    return this.opening;
  }
  receive(message) {
    if (message.t === 'opened') { const resolve = this.opens.get(message.id); if (resolve) { this.opens.delete(message.id); resolve(message); } return; }
    if (message.t === 'slot') { if (typeof message.label === 'string') this.slots.set(message.label.toLowerCase(), { view: message.view, origin: String(message.origin) }); return; }
    this.onMessage(message);
  }
  send(message) { if (this.state !== 'open' || !this.socket) return false; try { this.socket.send(JSON.stringify(message)); return true; } catch { return false; } }
  /** The frame address of real URL `url` in WebView `view`: { frameUrl } or { error }. */
  openDocument(view, url) {
    if (this.state !== 'open') return Promise.resolve({ error: this.reason ?? 'the WebView channel is not open' });
    const id = this.nextOpen++;
    return new Promise(resolve => { this.opens.set(id, resolve); if (!this.send({ t: 'open', id, view, url })) { this.opens.delete(id); resolve({ error: 'the WebView channel is not open' }); } });
  }
  /** The real URL behind a slot address (http://<label>.localhost:<port>/path), or null when `url` is not one of this channel's slots. */
  realUrl(url) {
    let parsed; try { parsed = new URL(url); } catch { return null; }
    const match = SLOT_HOST.exec(parsed.host); if (!match || parsed.protocol !== 'http:') return null;
    const slot = this.slots.get(match[1].toLowerCase()); if (!slot) return null;
    return slot.origin + parsed.pathname + parsed.search + parsed.hash;
  }
  isSlot(url) { try { return SLOT_HOST.test(new URL(url).host); } catch { return false; } }
  forget(view) { for (const [label, slot] of [...this.slots]) if (slot.view === view) this.slots.delete(label); this.send({ t: 'forget', view }); }
  close() { this.state = 'closed'; try { this.socket?.close(); } catch { /* already closed */ } this.socket = null; this.slots.clear(); }
}
