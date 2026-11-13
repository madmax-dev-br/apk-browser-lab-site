// HTML of a plugin next to or over the simulated device (docs/PLUGINS.md "Sobreposições"): lab.on('frame') / lab.frame() (where the device's screen is on the page and how big),
// lab.track (where a component of the app is on the page, frame by frame) and lab.overlay.open (a sandboxed iframe of the plugin placed beside or over the screen, the app's
// window or a component, and kept there while the device moves, zooms or the component scrolls). Everything here is the page's own geometry: getBoundingClientRect of the
// screen and the lab.layoutBounds() elements of the frame the page already drew (window dp). Nothing is asked of the VM and the app never sees the overlays.
// Cost: nothing without overlays, tracks or frame listeners (no animation-frame loop, no listener). With them, one animation-frame loop reads the screen's rectangle (one
// getBoundingClientRect) and does the rest only when the rectangle changed or a new frame was drawn; tracks and 'frame' reach the plugin only when their value changed.
// No process.*.
import { matchTargets } from './lab-target.js?v=e0da55c6005f';

export const OVERLAY_PLACEMENTS = ['over', 'top', 'bottom', 'left', 'right', 'center'];
export const OVERLAY_ALIGNS = ['start', 'center', 'end'];
export const OVERLAY_LIMITS = Object.freeze({ perOwner: 8, total: 32, html: 1_000_000, minPx: 8, maxPx: 4000, maxOffset: 400, defaultMaxWidth: 320, tracksPerOwner: 16, elements: 32 });
const fail = (code, message) => Object.assign(new Error(message), { code });
const clip = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').slice(0, max);
const clamp = (value, min, max, fallback) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };
const round = value => Math.round(value * 100) / 100;

/** A size of an overlay: px (8–4000), 'anchor' (the anchor's own size) or 'auto' (the size of the overlay's content, reported by its document). */
export function sanitizeOverlaySize(value, fallback) {
  if (value === 'anchor' || value === 'auto') return value;
  const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.round(clamp(n, OVERLAY_LIMITS.minPx, OVERLAY_LIMITS.maxPx, fallback)) : fallback;
}
/**
 * A plugin's options -> { anchor: 'screen' | 'window' | 'target', placement, align, offset, width, height, maxWidth, interactive, flip, title }. `previous` keeps what is not
 * given (an update). The target itself is resolved by the plugin host (src/lab-target.js) and kept by the overlay, not here.
 */
export function sanitizeOverlayConfig(raw = {}, previous = null) {
  const o = raw && typeof raw === 'object' ? raw : {}, base = previous ?? { anchor: 'screen', placement: 'right', align: 'start', offset: 12, width: 'auto', height: 'auto', maxWidth: OVERLAY_LIMITS.defaultMaxWidth, interactive: true, flip: true, title: 'Plugin' };
  const anchor = o.anchor === undefined ? base.anchor : o.anchor === 'screen' || o.anchor === 'window' ? o.anchor : 'target';
  const placement = o.placement === undefined ? (previous ? base.placement : anchor === 'target' ? 'top' : base.placement) : OVERLAY_PLACEMENTS.includes(o.placement) ? o.placement : base.placement;
  const over = placement === 'over' || placement === 'center';
  const align = o.align === undefined ? (previous ? base.align : anchor === 'target' || over ? 'center' : base.align) : OVERLAY_ALIGNS.includes(o.align) ? o.align : base.align;
  const sizeDefault = over && placement === 'over' ? 'anchor' : 'auto';
  return { anchor, placement, align,
    offset: o.offset === undefined ? (previous ? base.offset : over ? 0 : anchor === 'target' ? 6 : base.offset) : Math.round(clamp(o.offset, -OVERLAY_LIMITS.maxOffset, OVERLAY_LIMITS.maxOffset, base.offset)),
    width: o.width === undefined ? (previous ? base.width : sizeDefault) : sanitizeOverlaySize(o.width, base.width), height: o.height === undefined ? (previous ? base.height : sizeDefault) : sanitizeOverlaySize(o.height, base.height),
    maxWidth: o.maxWidth === undefined ? base.maxWidth : Math.round(clamp(o.maxWidth, OVERLAY_LIMITS.minPx, OVERLAY_LIMITS.maxPx, base.maxWidth)),
    interactive: o.interactive === undefined ? base.interactive : o.interactive !== false, flip: o.flip === undefined ? base.flip : o.flip !== false, title: o.title === undefined ? base.title : clip(o.title, 80) || base.title };
}

/**
 * Where the device is on the page, in CSS px of the viewport (getBoundingClientRect: page zoom, the device's own scale and fullscreen included) and in the app's dp:
 * { visible, screen: { x, y, width, height }, window: { x, y, width, height }, scale, device: { width, height }, windowDp: { left, top, right, bottom }, viewport: { width, height }, orientation }.
 * `rect`: the screen element's rectangle; `size`: its own (untransformed) size in dp; `frame`: the app window inside the screen (dp, src/system-bars-host.js contentFrame).
 */
export function frameGeometry({ rect, size, frame = null, viewport, orientation = null, visible = true }) {
  if (!rect || !size || !(size.width > 0) || !(size.height > 0)) return null;
  const scale = rect.width / size.width, f = frame ?? { left: 0, top: 0, right: size.width, bottom: size.height };
  return { visible: !!visible && rect.width > 0 && rect.height > 0, screen: { x: round(rect.left), y: round(rect.top), width: round(rect.width), height: round(rect.height) },
    window: { x: round(rect.left + f.left * scale), y: round(rect.top + f.top * scale), width: round((f.right - f.left) * scale), height: round((f.bottom - f.top) * scale) },
    scale: Math.round(scale * 10000) / 10000, device: { width: size.width, height: size.height }, windowDp: { left: f.left, top: f.top, right: f.right, bottom: f.bottom },
    viewport: { width: viewport?.width ?? 0, height: viewport?.height ?? 0 }, orientation: orientation ?? (size.width > size.height ? 'landscape' : 'portrait') };
}
/** A lab.layoutBounds() rectangle (window dp) on the page: { x, y, width, height } in CSS px of the viewport. */
export function pageRect(geometry, bounds) {
  const s = geometry.scale, x = geometry.screen.x + (geometry.windowDp.left + bounds.left) * s, y = geometry.screen.y + (geometry.windowDp.top + bounds.top) * s;
  return { x: round(x), y: round(y), width: round((bounds.right - bounds.left) * s), height: round((bounds.bottom - bounds.top) * s) };
}

/**
 * Places a box of `size` against an `anchor` rectangle (both page px): placement 'over' covers the anchor, 'center' centers in it, 'top' | 'bottom' | 'left' | 'right'
 * put it outside that side, `offset` px away, aligned to the anchor's start, center or end. With `flip`, a side the viewport has no room for is swapped for the opposite one
 * when that one has room; the box is then kept inside the viewport. -> { x, y, placement } (the placement used).
 */
export function placeOverlay(anchor, size, { placement = 'right', align = 'start', offset = 0, flip = true } = {}, viewport = null) {
  const along = (start, extent, length) => align === 'start' ? start : align === 'end' ? start + extent - length : start + (extent - length) / 2;
  const at = side => {
    switch (side) {
      case 'over': return { x: along(anchor.x, anchor.width, size.width), y: along(anchor.y, anchor.height, size.height) };
      case 'center': return { x: anchor.x + (anchor.width - size.width) / 2, y: anchor.y + (anchor.height - size.height) / 2 };
      case 'top': return { x: along(anchor.x, anchor.width, size.width), y: anchor.y - offset - size.height };
      case 'bottom': return { x: along(anchor.x, anchor.width, size.width), y: anchor.y + anchor.height + offset };
      case 'left': return { x: anchor.x - offset - size.width, y: along(anchor.y, anchor.height, size.height) };
      default: return { x: anchor.x + anchor.width + offset, y: along(anchor.y, anchor.height, size.height) };
    }
  };
  let side = placement, point = at(side);
  if (viewport && flip && !['over', 'center'].includes(side)) {
    const fits = p => p.x >= 0 && p.y >= 0 && p.x + size.width <= viewport.width && p.y + size.height <= viewport.height;
    const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[side], other = at(opposite);
    const outside = { top: point.y < 0, bottom: point.y + size.height > viewport.height, left: point.x < 0, right: point.x + size.width > viewport.width }[side];
    if (outside && fits(other)) { side = opposite; point = other; }
  }
  if (viewport && flip) {   // kept inside the viewport along the free axis (a tooltip near an edge slides instead of leaving the page)
    point.x = Math.min(Math.max(0, point.x), Math.max(0, viewport.width - size.width)); point.y = Math.min(Math.max(0, point.y), Math.max(0, viewport.height - size.height));
  }
  return { x: round(point.x), y: round(point.y), placement: side };
}

/**
 * The script at the top of an overlay's HTML (serialized with toString: no closure). window.lab there: post(data) / on(fn) (messages to and from the plugin: the overlay
 * handle's onMessage / post), onAnchor(fn) and anchor (where the overlay's anchor is: { visible, rect, placement, element }, on every move). It reports the size of its body
 * so a size 'auto' follows the content (the body is laid out at its max-content width, up to the overlay's maxWidth).
 */
export function overlayBridgeMain(win, token, maxWidth) {
  const handlers = { message: [], anchor: [] }, doc = win.document;
  const send = message => win.parent.postMessage(Object.assign({ __labOverlay: token }, message), '*');
  const add = name => fn => { if (typeof fn === 'function') handlers[name].push(fn); return () => { const at = handlers[name].indexOf(fn); if (at >= 0) handlers[name].splice(at, 1); }; };
  let anchor = null;
  win.lab = Object.freeze({ post: data => send({ data }), on: add('message'), onAnchor: add('anchor'), get anchor() { return anchor; } });
  win.addEventListener('message', event => {
    const message = event.data; if (event.source !== win.parent || !message || message.__labOverlay !== token) return;
    if (message.anchor !== undefined) anchor = message.anchor;
    const list = message.anchor !== undefined ? handlers.anchor : handlers.message, value = message.anchor !== undefined ? message.anchor : message.data;
    for (const fn of list.slice()) { try { fn(value); } catch (error) { win.console.error(error); } }
  });
  const style = doc.createElement('style'); style.textContent = `html{background:transparent}body{margin:0;width:max-content;max-width:${Number(maxWidth) || 320}px}`;
  (doc.head || doc.documentElement).prepend(style);   // before the plugin's own styles, which can override it
  let last = '';
  const measure = () => { const body = doc.body; if (!body) return; const r = body.getBoundingClientRect(), w = Math.ceil(Math.max(r.width, body.scrollWidth)), h = Math.ceil(Math.max(r.height, body.scrollHeight)), key = w + 'x' + h; if (key !== last) { last = key; send({ size: { width: w, height: h } }); } };
  const start = () => { measure(); if (typeof win.ResizeObserver === 'function' && doc.body) new win.ResizeObserver(measure).observe(doc.body); else win.setInterval(measure, 250); };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
  win.addEventListener('load', measure);
}
export const overlayBridgeScript = (token, maxWidth) => `<script>(${overlayBridgeMain.toString()})(window, ${JSON.stringify(token)}, ${Number(maxWidth) || 320});<\/script>`;

const geometryKey = g => g ? `${g.visible}|${g.screen.x}|${g.screen.y}|${g.screen.width}|${g.screen.height}|${g.window.x}|${g.window.y}|${g.window.width}|${g.window.height}|${g.viewport.width}|${g.viewport.height}` : 'none';
const elementOut = (geometry, element) => ({ key: element.key, kind: element.kind, name: element.name ?? null, testTag: element.testTag ?? null, viewId: element.viewId ?? null, texts: (element.texts ?? []).slice(0, 4),
  bounds: element.bounds ? { ...element.bounds } : null, rect: geometry && element.bounds ? pageRect(geometry, element.bounds) : null });

/**
 * doc / win: the lab page. layer(): the element overlays go into (position: fixed over the viewport; its own rectangle is subtracted, so any containing block works).
 * geometry(): frameGeometry(...) of the device now, or null (no device on the page). elements(): the lab.layoutBounds() elements of the frame the page shows.
 * onFrame(geometry): the device moved or resized (only while frame listeners are on). Returns { open, get, closeOwner, track, untrack, setFrameWatch, frame, refresh, list, size }.
 */
export function createOverlayHost({ doc = globalThis.document, win = globalThis.window, layer = () => null, geometry = () => null, elements = () => [], onFrame = () => {},
  requestFrame = fn => (win?.requestAnimationFrame ?? (cb => setTimeout(cb, 16)))(fn), cancelFrame = id => (win?.cancelAnimationFrame ?? clearTimeout)(id) } = {}) {
  const overlays = new Map(), tracks = new Map(); let serial = 0, frameWatch = false, loop = null, lastKey = null, dirty = true, current = null, cachedElements = null;
  const active = () => overlays.size > 0 || tracks.size > 0 || frameWatch;
  const elementsNow = () => cachedElements ??= (() => { try { return elements() ?? []; } catch { return []; } })();
  function matchOf(entry, list) {
    if (!entry.selector) return [];
    const found = entry.keys ? list.filter(element => entry.keys.includes(element.key)) : matchTargets(list, entry.selector);
    return (entry.all ? found : [found[entry.selector.index ?? 0]].filter(Boolean)).slice(0, OVERLAY_LIMITS.elements);
  }
  function anchorOf(overlay, g) {
    if (!g || !g.visible) return { visible: false, rect: null, element: null };
    if (overlay.config.anchor === 'screen') return { visible: true, rect: { ...g.screen }, element: null };
    if (overlay.config.anchor === 'window') return { visible: true, rect: { ...g.window }, element: null };
    const [element] = matchOf(overlay, elementsNow());
    return element?.bounds ? { visible: true, rect: pageRect(g, element.bounds), element: elementOut(g, element) } : { visible: false, rect: null, element: null };
  }
  function place(overlay, g) {
    const host = layer(); if (!host) return;
    if (overlay.node.parentNode !== host) host.append(overlay.node);
    const anchor = anchorOf(overlay, g), c = overlay.config, measured = overlay.measured;
    const size = { width: c.width === 'anchor' ? anchor.rect?.width ?? 0 : c.width === 'auto' ? measured?.width ?? c.maxWidth : c.width, height: c.height === 'anchor' ? anchor.rect?.height ?? 0 : c.height === 'auto' ? measured?.height ?? 0 : c.height };
    const shown = anchor.visible && (c.width !== 'auto' && c.height !== 'auto' || !!measured);   // an 'auto' overlay waits for its first size (no flash at a wrong size)
    let placed = null;
    if (anchor.visible) {
      const origin = host.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      placed = placeOverlay(anchor.rect, size, c, g.viewport.width ? g.viewport : null);
      Object.assign(overlay.node.style, { transform: `translate(${round(placed.x - origin.left)}px, ${round(placed.y - origin.top)}px)`, width: `${Math.max(1, size.width)}px`, height: `${Math.max(1, size.height)}px` });
    }
    overlay.node.hidden = !shown; overlay.node.dataset.placement = placed?.placement ?? c.placement;
    const state = { visible: shown, rect: placed && shown ? { x: placed.x, y: placed.y, width: round(size.width), height: round(size.height) } : null, placement: placed?.placement ?? null, anchor: anchor.rect, element: anchor.element };
    const key = JSON.stringify([state.visible, state.rect, state.anchor, state.placement, state.element?.key]);
    overlay.state = state;
    if (key !== overlay.sentKey) { overlay.sentKey = key; overlay.postAnchor({ visible: state.visible, rect: state.rect, anchor: state.anchor, placement: state.placement, element: state.element }); }
  }
  function updateTracks(g) {
    for (const track of tracks.values()) {
      const matched = g && g.visible ? matchOf(track, elementsNow()) : [], value = { id: track.id, visible: matched.length > 0, matches: matched.length, elements: matched.map(element => elementOut(g, element)) };
      const key = JSON.stringify(value); if (key === track.sentKey) continue; track.sentKey = key; try { track.onChange(value); } catch { /* the plugin went away */ }
    }
  }
  function tick() {
    loop = null; if (!active()) return;
    const g = geometry(), key = geometryKey(g), moved = key !== lastKey; current = g;
    if (moved || dirty) {
      lastKey = key; cachedElements = null;
      for (const overlay of overlays.values()) place(overlay, g);
      updateTracks(g);
      if (moved && frameWatch) { try { onFrame(g); } catch { /* best effort */ } }
      dirty = false;
    }
    loop = requestFrame(tick);
  }
  const wake = () => { if (loop === null && active()) loop = requestFrame(tick); };
  const sleep = () => { if (!active() && loop !== null) { cancelFrame(loop); loop = null; lastKey = null; } };
  const owned = owner => [...overlays.values()].filter(overlay => overlay.owner === String(owner));

  function setHtml(overlay, html) {
    const source = String(html ?? ''); if (source.length > OVERLAY_LIMITS.html) throw fail('bad-args', `HTML grande demais (máximo ${OVERLAY_LIMITS.html} caracteres).`);
    const frame = doc.createElement('iframe'); frame.className = 'lab-overlay-frame'; frame.title = overlay.config.title;
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');   // opaque origin: no same-origin, no top navigation, no popups
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light">${overlayBridgeScript(overlay.token, overlay.config.maxWidth)}${source}`;
    overlay.loaded = false; overlay.queue = []; overlay.measured = null; overlay.sentKey = null;
    frame.addEventListener('load', () => { if (overlay.frame !== frame) return; overlay.loaded = true; const queue = overlay.queue; overlay.queue = []; for (const message of queue) overlay.send(message); overlay.sentKey = null; dirty = true; wake(); });
    overlay.frame = frame; overlay.node.replaceChildren(frame);
  }
  function applyConfig(overlay) {
    const c = overlay.config;
    overlay.node.style.pointerEvents = c.interactive ? 'auto' : 'none'; overlay.node.dataset.interactive = String(c.interactive);
    if (overlay.frame) { overlay.frame.title = c.title; overlay.frame.tabIndex = c.interactive ? 0 : -1; }
    overlay.node.setAttribute('aria-label', `Sobreposição do plugin: ${c.title}`);
  }
  const onMessage = event => {
    const message = event.data; if (!message || typeof message !== 'object' || typeof message.__labOverlay !== 'string') return;
    const overlay = [...overlays.values()].find(item => item.token === message.__labOverlay && item.frame?.contentWindow === event.source); if (!overlay) return;
    if (message.size) { const w = Number(message.size.width), h = Number(message.size.height); if (Number.isFinite(w) && Number.isFinite(h)) { overlay.measured = { width: Math.min(Math.max(1, w), overlay.config.maxWidth), height: Math.min(Math.max(1, h), OVERLAY_LIMITS.maxPx) }; dirty = true; wake(); } return; }
    if ('data' in message) { let data = null; try { data = JSON.parse(JSON.stringify(message.data ?? null)); } catch { data = null; } try { overlay.callbacks.onMessage?.(overlay, data); } catch { /* the plugin went away */ } }
  };
  let listening = false;
  const listen = () => { if (!listening && win?.addEventListener) { win.addEventListener('message', onMessage); listening = true; } };
  function close(overlay, reason) {
    if (overlay.closed) return; overlay.closed = true; overlays.delete(overlay.id); overlay.node.remove();
    try { overlay.callbacks.onClose?.(overlay, reason); } catch { /* the plugin went away */ }
    sleep();
  }
  return {
    /**
     * Opens an overlay: { owner, ownerName, id, config (sanitizeOverlayConfig input), selector + keys (a resolved target, for anchor 'target'), html, onMessage(overlay, data),
     * onClose(overlay, reason) }. The same owner and id replace the overlay's config and HTML. -> the overlay { id, config, state, post, update, close }.
     */
    open({ owner, ownerName = 'Plugin', id = null, config = {}, selector = null, keys = null, html = '', onMessage: messageFn = null, onClose = null } = {}) {
      owner = String(owner); listen();
      const wanted = id === null || id === undefined || id === '' ? null : clip(id, 80), existing = wanted ? overlays.get(`${owner}\n${wanted}`) : null;
      if (existing) { existing.update({ config, selector, keys, html }); return existing; }
      if (owned(owner).length >= OVERLAY_LIMITS.perOwner) throw fail('limit', `No máximo ${OVERLAY_LIMITS.perOwner} sobreposições por plugin: feche alguma.`);
      if (overlays.size >= OVERLAY_LIMITS.total) throw fail('limit', `No máximo ${OVERLAY_LIMITS.total} sobreposições na página.`);
      let local = wanted; while (!local || overlays.has(`${owner}\n${local}`)) local = `o${++serial}`;
      const node = doc.createElement('div'); node.className = 'lab-overlay'; node.hidden = true; node.dataset.owner = owner; node.dataset.overlay = local;
      const overlay = { id: `${owner}\n${local}`, localId: local, owner, node, frame: null, token: `ov${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`, config: sanitizeOverlayConfig({ title: config?.title ?? ownerName, ...(config ?? {}) }),
        selector, keys, all: false, measured: null, loaded: false, queue: [], sentKey: null, state: { visible: false, rect: null, placement: null, anchor: null, element: null }, closed: false, callbacks: { onMessage: messageFn, onClose } };
      if (overlay.config.anchor === 'target' && !selector) throw fail('bad-args', 'Uma sobreposição ancorada num componente precisa de um alvo (anchor: testTag, texto, { viewId }, ...).');
      overlay.send = message => { if (!overlay.loaded) { if (overlay.queue.length < 100) overlay.queue.push(message); return; } try { overlay.frame?.contentWindow?.postMessage(Object.assign({ __labOverlay: overlay.token }, message), '*'); } catch { /* the frame is gone */ } };
      overlay.post = data => { let copy = null; try { copy = JSON.parse(JSON.stringify(data ?? null)); } catch { throw fail('bad-args', 'post(dados): só dados JSON.'); } overlay.send({ data: copy }); };
      overlay.postAnchor = anchor => overlay.send({ anchor });
      overlay.update = ({ config: changes = null, selector: nextSelector = undefined, keys: nextKeys = undefined, html = undefined } = {}) => {
        if (changes) { const maxBefore = overlay.config.maxWidth; overlay.config = sanitizeOverlayConfig(changes, overlay.config); if (overlay.config.anchor === 'target' && !(nextSelector ?? overlay.selector)) throw fail('bad-args', 'anchor de componente sem alvo.'); if (html === undefined && overlay.config.maxWidth !== maxBefore && overlay.frame) setHtml(overlay, overlay.html); }
        if (nextSelector !== undefined && nextSelector !== null) { overlay.selector = nextSelector; overlay.keys = nextKeys ?? null; }
        if (html !== undefined && html !== null) { overlay.html = String(html); setHtml(overlay, overlay.html); }
        applyConfig(overlay); overlay.sentKey = null; dirty = true; wake(); return overlay;
      };
      overlay.close = (reason = 'code') => close(overlay, reason);
      overlay.html = String(html ?? '');
      overlays.set(overlay.id, overlay); setHtml(overlay, overlay.html); applyConfig(overlay);
      const host = layer(); if (host) host.append(node);
      dirty = true; wake(); return overlay;
    },
    get(owner, id) { return overlays.get(`${String(owner)}\n${String(id ?? '')}`) ?? null; },
    list(owner = null) { return [...overlays.values()].filter(overlay => owner === null || overlay.owner === String(owner)); },
    /** Follows the components a target names: onChange({ id, visible, matches, elements: [{ key, kind, name, testTag, viewId, texts, bounds (window dp), rect (page px) }] }) when it changed. */
    track({ owner, id = null, selector, keys = null, all = false, onChange }) {
      owner = String(owner); if (!selector) throw fail('bad-args', 'lab.track precisa de um alvo.');
      if ([...tracks.values()].filter(track => track.owner === owner).length >= OVERLAY_LIMITS.tracksPerOwner && !(id && tracks.has(`${owner}\n${id}`))) throw fail('limit', `No máximo ${OVERLAY_LIMITS.tracksPerOwner} acompanhamentos por plugin.`);
      let local = id === null || id === undefined || id === '' ? null : clip(id, 80); while (!local || (tracks.has(`${owner}\n${local}`) && id === null)) local = `t${++serial}`;
      const track = { id: local, owner, selector, keys, all: !!all, onChange, sentKey: null }; tracks.set(`${owner}\n${local}`, track);
      dirty = true; wake(); return local;
    },
    untrack(owner, id) { const removed = tracks.delete(`${String(owner)}\n${String(id ?? '')}`); sleep(); return removed; },
    /** Whether the device's geometry is watched for 'frame' listeners (only while some plugin listens). */
    setFrameWatch(on) { frameWatch = !!on; if (frameWatch) { lastKey = null; wake(); } else sleep(); },
    /** The device's geometry now (lab.frame()). */
    frame() { return geometry(); },
    /** The page drew a frame (or the device changed): overlays on components and tracks are matched again at the next animation frame. Nothing to do without them. */
    refresh() { if (!active()) return 0; dirty = true; cachedElements = null; wake(); return overlays.size + tracks.size; },
    /** A plugin stopped: its overlays close and its tracks end. */
    closeOwner(owner, reason = 'stopped') { for (const overlay of owned(owner)) close(overlay, reason); for (const [key, track] of tracks) if (track.owner === String(owner)) tracks.delete(key); sleep(); },
    get size() { return overlays.size + tracks.size; },
    get geometry() { return current; },
  };
}

/**
 * The `overlay` and `track` actions of the plugin host (src/plugin-host.js resolves a target first: args.selector / args.keys): ops open / update / post / close / list, and
 * start / stop; events go to the plugin with emit(pluginId, name, data): 'overlay' { id, type: 'message' | 'closed', ... } and 'track' { id, visible, matches, elements }.
 */
export function createOverlayAction({ host, emit }) {
  const out = overlay => ({ id: overlay.localId, config: overlay.config, state: overlay.state });
  const overlay = (plugin, args = {}) => {
    const op = String(args.op ?? '');
    if (op === 'open') {
      const opened = host.open({ owner: plugin.id, ownerName: plugin.name, id: args.id ?? null, config: args.config ?? {}, selector: args.selector ?? null, keys: args.keys ?? null, html: args.html ?? '',
        onMessage: (item, data) => emit(plugin.id, 'overlay', { id: item.localId, type: 'message', data }), onClose: (item, reason) => emit(plugin.id, 'overlay', { id: item.localId, type: 'closed', reason }) });
      return out(opened);
    }
    if (op === 'list') return host.list(plugin.id).map(out);
    const item = host.get(plugin.id, args.id); if (!item) throw fail('not-found', 'Sobreposição fechada ou desconhecida.');
    if (op === 'update') item.update({ config: args.config ?? null, selector: args.selector, keys: args.keys, html: args.html });
    else if (op === 'post') item.post(args.data);
    else if (op === 'close') { item.close('code'); return { id: item.localId, closed: true }; }
    else if (op !== 'state') throw fail('bad-args', `Operação de sobreposição desconhecida: ${op.slice(0, 20)}`);
    return out(item);
  };
  const track = (plugin, args = {}) => {
    const op = String(args.op ?? 'start');
    if (op === 'start') return { id: host.track({ owner: plugin.id, id: args.id ?? null, selector: args.selector, keys: args.keys ?? null, all: args.all === true, onChange: value => emit(plugin.id, 'track', value) }) };
    if (op === 'stop') return { removed: host.untrack(plugin.id, args.id) };
    throw fail('bad-args', `Operação de acompanhamento desconhecida: ${op.slice(0, 20)}`);
  };
  return { overlay, track, frame: () => host.frame() };
}
