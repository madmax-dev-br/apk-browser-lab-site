// Plugin Workers of the embedded player run in an opaque origin. On the lab page a plugin is the user's own code with the page's origin; in the player the code comes
// from the embedding page, which is another site, so it must not get the runtime origin (its IndexedDB app data of other embedders, caches, same-origin requests).
// One hidden sandboxed iframe (sandbox="allow-scripts", no allow-same-origin: an opaque origin) creates each Worker from a Blob URL of its own origin and relays the
// messages; src/plugin-host.js sees an ordinary { postMessage, onmessage, onerror, terminate } Worker. Nothing is created until the first plugin starts.
import { pluginWorkerSource } from '../plugin-runtime.js?v=c6940189447d';

export const RELAY_SOURCE = `<!doctype html><meta charset="utf-8"><title>plugins</title><script>
"use strict";
const workers = new Map();
addEventListener('message', event => {
  if (event.source !== parent) return;
  const d = event.data; if (!d || typeof d !== 'object') return;
  if (d.t === 'create' && typeof d.source === 'string' && !workers.has(d.id)) {
    let url = null, worker = null;
    try { url = URL.createObjectURL(new Blob([d.source], { type: 'text/javascript' })); worker = new Worker(url, { name: String(d.name || 'plugin').slice(0, 60) }); }   // classic: browsers refuse module Workers from a Blob URL of an opaque origin; the runtime has no imports
    catch (error) { if (url) URL.revokeObjectURL(url); parent.postMessage({ t: 'error', id: d.id, message: 'O Worker do plugin não pôde ser criado neste navegador (origem isolada): ' + String(error && error.message || error) }, '*'); return; }
    let revoked = false; const revoke = () => { if (!revoked) { revoked = true; URL.revokeObjectURL(url); } };
    worker.onmessage = e => { revoke(); parent.postMessage({ t: 'message', id: d.id, data: e.data }, '*'); };
    worker.onerror = e => { e.preventDefault(); revoke(); parent.postMessage({ t: 'error', id: d.id, message: String(e.message || 'O Worker do plugin falhou.') }, '*'); };
    worker.onmessageerror = () => parent.postMessage({ t: 'messageerror', id: d.id }, '*');
    workers.set(d.id, worker);
  } else if (d.t === 'post') { const worker = workers.get(d.id); if (worker) worker.postMessage(d.data); }
  else if (d.t === 'terminate') { const worker = workers.get(d.id); if (worker) worker.terminate(); workers.delete(d.id); }
});
parent.postMessage({ t: 'relay-ready' }, '*');
<\/script>`;

/** A createWorker(name) for src/plugin-host.js whose Workers live in the opaque-origin relay. `doc`/`win`: the frame's document and window. */
export function createSandboxedWorkerFactory({ doc = globalThis.document, win = globalThis, source = pluginWorkerSource } = {}) {
  let iframe = null, ready = null, sequence = 0;
  const adapters = new Map();
  win.addEventListener('message', event => {
    if (!iframe || event.source !== iframe.contentWindow) return;   // only our relay; everything else (the host page) is handled by frame.js
    const data = event.data; if (!data || typeof data !== 'object') return;
    if (data.t === 'relay-ready') { ready?.resolve(); return; }
    const adapter = adapters.get(data.id); if (!adapter || adapter.terminated) return;
    if (data.t === 'message') adapter.onmessage?.({ data: data.data });
    else if (data.t === 'error') adapter.onerror?.({ message: String(data.message ?? '').slice(0, 2000), preventDefault() {} });
    else if (data.t === 'messageerror') adapter.onmessageerror?.();
  });
  function relay() {
    if (ready) return ready.promise;
    let resolve; const promise = new Promise(done => { resolve = done; }); ready = { promise, resolve };
    iframe = doc.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts'); iframe.setAttribute('aria-hidden', 'true'); iframe.setAttribute('tabindex', '-1'); iframe.title = 'plugins';
    iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    iframe.srcdoc = RELAY_SOURCE; doc.body.append(iframe);
    return promise;
  }
  const to = message => iframe?.contentWindow?.postMessage(message, '*');   // an opaque origin has no name to target; the window is our own iframe
  return name => {
    const id = ++sequence, queue = []; let live = false;
    const adapter = {
      onmessage: null, onerror: null, onmessageerror: null, terminated: false,
      postMessage(data) { if (adapter.terminated) return; if (live) to({ t: 'post', id, data }); else queue.push(data); },
      terminate() { if (adapter.terminated) return; adapter.terminated = true; adapters.delete(id); if (live) to({ t: 'terminate', id }); },
    };
    adapters.set(id, adapter);
    relay().then(() => {
      if (adapter.terminated) return;
      to({ t: 'create', id, name: String(name ?? '').slice(0, 40), source: source() }); live = true;
      for (const data of queue.splice(0)) to({ t: 'post', id, data });
    });
    return { worker: adapter, release() {} };
  };
}
