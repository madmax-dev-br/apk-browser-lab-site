// Side tabs of the lab page ("linguetas"): a plugin's own surface behind a small tab on the left or right edge (lab.tab.open of src/plugin-runtime.js). The tab is a
// button with the plugin's icon and name; it expands into a panel with the plugin's HTML, CSS and JavaScript in a sandboxed iframe (opaque origin, scripts only: no
// access to this page, its storage or the VM), which talks to the plugin by messages (window.lab.post / window.lab.on inside the iframe) exactly like a modal
// (src/lab-modal.js). The plugin chooses the opened size (px or % of the viewport), the side, whether the panel lies over the page or pushes it, whether the tab opens
// on click or on hover, whether it starts open and whether the last state is remembered. Tabs of one side stack in a column next to the panel, so they never overlap;
// one panel per side is open at a time. Inside the surface, window.lab.draggable(element, data) starts a drag onto the simulated device (src/lab-drag.js). No process.*.

export const TAB_SIDES = ['left', 'right'], TAB_MODES = ['overlay', 'push'], TAB_TRIGGERS = ['click', 'hover'];
export const TAB_LIMITS = { minPx: 160, maxPx: 2000, minPercent: 10, maxPercent: 100, perOwner: 4, total: 16, html: 1_000_000, payloadChars: 20_000, railPx: 34 };
export const TAB_MEMORY_KEY = 'apkweb.plugin-tabs.v1';
const DEFAULT_WIDTH = { value: 320, unit: 'px' }, DEFAULT_HEIGHT = { value: 70, unit: '%' };
const fail = (code, message) => Object.assign(new Error(message), { code });
const clip = (value, max) => { const text = String(value ?? '').trim(); return text.length > max ? text.slice(0, max - 1) + '…' : text; };

/** A size a plugin wrote (320, '320px', '40%') -> { value, unit: 'px' | '%' } within the limits; anything else is the fallback. */
export function sanitizeTabSize(value, fallback = DEFAULT_WIDTH) {
  let number = NaN, unit = 'px';
  if (typeof value === 'number') number = value;
  else if (value && typeof value === 'object') { number = Number(value.value); unit = value.unit === '%' ? '%' : 'px'; }   // an already sanitized size
  else if (typeof value === 'string') { const match = /^\s*(\d+(?:\.\d+)?)\s*(px|%)?\s*$/.exec(value); if (match) { number = Number(match[1]); unit = match[2] ?? 'px'; } }
  if (!Number.isFinite(number) || number <= 0) return { ...fallback };
  return unit === '%' ? { value: Math.max(TAB_LIMITS.minPercent, Math.min(TAB_LIMITS.maxPercent, Math.round(number * 10) / 10)), unit } : { value: Math.max(TAB_LIMITS.minPx, Math.min(TAB_LIMITS.maxPx, Math.round(number))), unit };
}
/** What a plugin passed to lab.tab.open -> the configuration the page uses. Unknown values fall back to the defaults; nothing here is HTML. */
export function sanitizeTabConfig(raw = {}, { name = 'Plugin' } = {}) {
  const item = raw && typeof raw === 'object' ? raw : {}, title = clip(item.title ?? name, 60) || 'Plugin';
  const icon = [...clip(item.icon ?? '', 16)].slice(0, 2).join('') || [...title][0].toUpperCase();
  return { key: String(item.id ?? 'tab').replace(/[^\w-]+/g, '-').slice(0, 40) || 'tab', title, icon,
    side: TAB_SIDES.includes(item.side) ? item.side : 'right', width: sanitizeTabSize(item.width, DEFAULT_WIDTH), height: sanitizeTabSize(item.height, DEFAULT_HEIGHT),
    mode: TAB_MODES.includes(item.mode) ? item.mode : 'overlay', trigger: TAB_TRIGGERS.includes(item.trigger) ? item.trigger : 'click', startOpen: item.open === true, remember: item.remember === true };
}
/** A sanitized size in CSS px for a viewport extent: a percentage is of the viewport, and the panel always leaves `margin` px (the tabs' column, a gap) on screen. */
export function resolveTabPx(size, extent, margin = 0) {
  const room = Math.max(120, (Number(extent) || 0) - margin), wanted = size.unit === '%' ? (Number(extent) || 0) * size.value / 100 : size.value;
  return Math.round(Math.max(Math.min(120, room), Math.min(room, wanted)));
}
/** The remembered open/closed states: { 'pluginId:tabKey': boolean } (bounded), every storage access guarded. */
export function readTabMemory(storage) { try { const data = JSON.parse(storage?.getItem(TAB_MEMORY_KEY) ?? '{}'); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; } }
export function writeTabMemory(storage, key, open) {
  try { const data = readTabMemory(storage); delete data[key]; data[key] = !!open; const keys = Object.keys(data); for (const old of keys.slice(0, Math.max(0, keys.length - 64))) delete data[old]; storage?.setItem(TAB_MEMORY_KEY, JSON.stringify(data)); } catch { /* the state lasts for the page */ }
}

/**
 * The script at the top of a surface's HTML (serialized with toString: no closure). window.lab there:
 *   post(data) / on(fn)                  messages to and from the plugin (lab.tab's handle: onMessage / post);
 *   draggable(element, data, options)    makes an element draggable onto the device. `data` (JSON, or a function returning it) comes back in the drag and drop events;
 *                                        options: { label, image } for the ghost the lab draws (image: a data:image URL; by default the element's own <img>). Returns the undo function;
 *   onDrag(fn) / onDrop(fn)              the same events the plugin gets, for a surface that shows them itself.
 * A drag is pointer events: the element captures the pointer and each move is posted to the page. A browser may stop delivering the pointer to a sandboxed frame once
 * it leaves the frame, so from the start of the drag the page also listens on a shield it lays over itself (createSideTabHost): whichever side sees the pointer feeds
 * the same drag, and its end (the drop or the cancel event sent back here) clears the state kept here.
 */
export function surfaceBridgeMain(win, token) {
  const handlers = { message: [], drag: [], drop: [] }, doc = win.document;
  const send = message => win.parent.postMessage(Object.assign({ __labSurface: token }, message), '*');
  const add = name => fn => { if (typeof fn === 'function') handlers[name].push(fn); return () => { const at = handlers[name].indexOf(fn); if (at >= 0) handlers[name].splice(at, 1); }; };
  let cancelActive = null, resetActive = null;
  function draggable(element, data, options) {
    if (!element || typeof element.addEventListener !== 'function') throw new TypeError('lab.draggable(elemento, dados)');
    const settings = options || {}; let state = null, suppressClick = false;
    if (element.style) { element.style.touchAction = 'none'; element.style.userSelect = 'none'; element.style.webkitUserSelect = 'none'; if (!element.style.cursor) element.style.cursor = 'grab'; }
    const payload = () => { const value = typeof data === 'function' ? data(element) : data; try { return JSON.parse(JSON.stringify(value === undefined ? null : value)); } catch (error) { return null; } };
    const image = () => { const source = settings.image; if (typeof source === 'string') return source; if (source && typeof source.src === 'string') return source.src; const inner = element.querySelector ? element.querySelector('img') : null; return inner && typeof inner.src === 'string' ? inner.src : null; };
    const release = id => { try { element.releasePointerCapture(id); } catch (error) { /* not captured */ } };
    const reset = () => { const was = state; state = null; cancelActive = null; resetActive = null; if (was) release(was.id); return was; };
    const cancel = () => { const was = reset(); if (was && was.dragging) send({ drag: 'cancel' }); };
    const down = event => {
      if (state || (event.pointerType === 'mouse' && event.button !== 0)) return;
      state = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
      try { element.setPointerCapture(event.pointerId); } catch (error) { /* a synthetic pointer */ }
    };
    const move = event => {
      if (!state || event.pointerId !== state.id) return;
      if (!state.dragging) {
        if (Math.hypot(event.clientX - state.x, event.clientY - state.y) < 4) return;
        state.dragging = true; cancelActive = cancel; resetActive = reset;
        const rect = element.getBoundingClientRect(), label = String(settings.label !== undefined ? settings.label : element.textContent || '').trim().slice(0, 80);
        send({ drag: 'start', payload: payload(), label, image: image(), x: event.clientX, y: event.clientY, width: rect.width, height: rect.height });
      }
      if (event.preventDefault) event.preventDefault();
      send({ drag: 'move', x: event.clientX, y: event.clientY });
    };
    const up = event => {
      if (!state || event.pointerId !== state.id) return;
      const was = reset();
      if (was.dragging) { suppressClick = true; win.setTimeout(() => { suppressClick = false; }, 0); send({ drag: 'end', x: event.clientX, y: event.clientY }); }
    };
    const click = event => { if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopPropagation(); } };
    const native = event => event.preventDefault();
    const listeners = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', cancel], ['dragstart', native]];
    for (const [name, fn] of listeners) element.addEventListener(name, fn);
    element.addEventListener('click', click, true);
    return () => { cancel(); for (const [name, fn] of listeners) element.removeEventListener(name, fn); element.removeEventListener('click', click, true); };
  }
  win.lab = Object.freeze({ post: data => send({ data }), on: add('message'), onDrag: add('drag'), onDrop: add('drop'), draggable });
  win.addEventListener('message', event => {
    const message = event.data; if (event.source !== win.parent || !message || message.__labSurface !== token) return;
    const list = message.event === 'drop' ? handlers.drop : message.event === 'drag' ? handlers.drag : handlers.message, value = message.event ? message.detail : message.data;
    if (resetActive && (message.event === 'drop' || (message.event === 'drag' && value && value.type === 'cancel'))) resetActive();   // the page ended the drag (it saw the release)
    for (const fn of list.slice()) { try { fn(value); } catch (error) { win.console.error(error); } }
  });
  win.addEventListener('keydown', event => { if (event.key !== 'Escape' || event.defaultPrevented) return; if (cancelActive) cancelActive(); else send({ key: 'Escape' }); });
  if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', () => { if (doc.hidden && cancelActive) cancelActive(); });
}
export const surfaceBridgeScript = token => `<script>(${surfaceBridgeMain.toString()})(window, ${JSON.stringify(token)});<\/script>`;

/** A drag message of a surface is only numbers, short strings and a bounded JSON payload. */
function dragMessage(message) {
  const number = value => Number.isFinite(value) ? value : 0;
  let payload = null; try { const text = JSON.stringify(message.payload ?? null); payload = text.length <= TAB_LIMITS.payloadChars ? JSON.parse(text) : null; } catch { payload = null; }
  return { kind: String(message.drag), x: number(message.x), y: number(message.y), payload, label: clip(message.label ?? '', 80), image: typeof message.image === 'string' ? message.image : null };
}

/**
 * doc / win: the lab page. storage: where "remember" keeps the open states (localStorage by default, guarded). drag: createDragLayer(...) of src/lab-drag.js, or null
 * (then lab.draggable in a surface does nothing here). Returns { open(options) -> tab, get(id), closeOwner(owner, reason), list(), relayout() }.
 */
export function createSideTabHost({ doc = globalThis.document, win = globalThis.window, storage = undefined, drag = null, hoverCloseMs = 350, dragEventMs = 100,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id), now = () => Date.now() } = {}) {
  const tabs = new Map(), sides = new Map(); let counter = 0;
  const store = () => { if (storage !== undefined) return storage; try { return globalThis.localStorage; } catch { return null; } };
  const el = (tag, className, text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const onSide = side => [...tabs.values()].filter(tab => tab.config.side === side);
  const openOn = side => onSide(side).find(tab => tab.open) ?? null;
  const call = (fn, ...args) => { try { fn?.(...args); } catch { /* the caller's problem */ } };

  function sideOf(name) {
    let side = sides.get(name); if (side) return side;
    const root = el('div', 'lab-tabs'), rail = el('div', 'lab-tabs-rail'), panels = el('div', 'lab-tabs-panels');
    root.dataset.side = name; rail.setAttribute('role', 'group'); rail.setAttribute('aria-label', name === 'left' ? 'Abas de plugins à esquerda' : 'Abas de plugins à direita');
    root.append(rail, panels); doc.body.append(root);
    side = { name, root, rail, panels, hoverTimer: null };
    root.addEventListener('keydown', event => { if (event.key !== 'Escape') return; const tab = openOn(name); if (!tab) return; event.preventDefault(); event.stopPropagation(); setOpen(tab, false, 'user'); tab.button.focus?.(); });
    root.addEventListener('pointerenter', () => { if (side.hoverTimer !== null) { clearTimer(side.hoverTimer); side.hoverTimer = null; } });
    root.addEventListener('pointerleave', () => scheduleHoverClose(side));
    sides.set(name, side); return side;
  }
  function scheduleHoverClose(side) {
    if (side.hoverTimer !== null) clearTimer(side.hoverTimer);
    side.hoverTimer = setTimer(() => { side.hoverTimer = null; const tab = openOn(side.name); if (tab && tab.config.trigger === 'hover' && !tab.pinned && !tab.drag) setOpen(tab, false, 'hover'); }, hoverCloseMs);
  }
  /** Sizes of one side from the viewport: the panels' box takes the open panel's size (animated by CSS), and a pushing panel reserves its width on the page. */
  function layout(name) {
    const side = sides.get(name); if (!side) return;
    const viewportW = win?.innerWidth ?? doc.documentElement?.clientWidth ?? 1024, viewportH = win?.innerHeight ?? doc.documentElement?.clientHeight ?? 768, open = openOn(name);
    for (const tab of onSide(name)) {
      const width = resolveTabPx(tab.config.width, viewportW, TAB_LIMITS.railPx + 8), height = resolveTabPx(tab.config.height, viewportH, 16);
      tab.px = { width, height }; tab.panel.style.width = `${width}px`; tab.panel.style.height = `${height}px`;
    }
    side.root.dataset.open = String(!!open); side.root.hidden = !onSide(name).length;
    side.panels.style.width = open ? `${open.px.width}px` : '0px'; if (open) side.panels.style.height = `${open.px.height}px`;
    const push = open && open.config.mode === 'push' ? open.px.width + TAB_LIMITS.railPx : 0;
    doc.documentElement?.style?.setProperty(`--lab-push-${name}`, `${push}px`);
    const pushing = [...sides.keys()].some(key => { const tab = openOn(key); return tab && tab.config.mode === 'push'; });
    doc.body?.classList?.toggle('lab-tab-push', pushing);
  }
  function setOpen(tab, open, by = 'code') {
    open = !!open; if (tab.closed || tab.open === open) return;
    if (open) for (const other of onSide(tab.config.side)) if (other !== tab && other.open) setOpen(other, false, 'other');
    tab.open = open; if (!open) tab.pinned = false;
    tab.button.setAttribute('aria-expanded', String(open)); tab.panel.dataset.open = String(open); tab.panel.inert = !open; tab.panel.setAttribute('aria-hidden', String(!open));
    if (tab.config.remember) writeTabMemory(store(), tab.memoryKey, open);
    layout(tab.config.side);
    if (!open && tab.drag) cancelDrag(tab);
    call(tab.callbacks.onToggle, tab, open, by);
  }
  function setHtml(tab, html) {
    const source = String(html ?? ''); if (source.length > TAB_LIMITS.html) throw fail('bad-args', `HTML grande demais (máximo ${TAB_LIMITS.html} caracteres).`);
    const frame = el('iframe', 'lab-tab-frame'); frame.title = tab.config.title;
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');   // opaque origin: no same-origin, no top navigation, no popups
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${surfaceBridgeScript(tab.token)}${source}`;
    if (tab.drag) cancelDrag(tab);
    // what the plugin posts before the document loaded waits for it (a plugin posts right after lab.tab.open); new HTML starts from an empty queue
    tab.loaded = false; tab.queue = [];
    frame.addEventListener('load', () => { if (tab.frame !== frame) return; tab.loaded = true; const queue = tab.queue; tab.queue = []; for (const data of queue) tab.post(data); });
    tab.frame = frame; tab.body.replaceChildren(frame);
  }
  function applyConfig(tab, config) {
    const previous = tab.config; tab.config = config; tab.memoryKey = `${tab.owner}:${config.key}`;
    const side = sideOf(config.side);
    if (!previous || previous.side !== config.side) { side.rail.append(tab.button); side.panels.append(tab.panel); }
    tab.icon.textContent = config.icon; tab.name.textContent = config.title; tab.heading.textContent = config.title;
    tab.button.title = config.title; tab.button.dataset.trigger = config.trigger; tab.panel.dataset.mode = config.mode; tab.panel.setAttribute('aria-label', `Aba do plugin: ${config.title}`);
    tab.closeButton.setAttribute('aria-label', `Recolher a aba ${config.title}`); if (tab.frame) tab.frame.title = config.title;
    if (previous && previous.side !== config.side) layout(previous.side);
    layout(config.side);
  }
  // ---- drag from a surface onto the device ----------------------------------------------------------------------------------------------------------------------------
  const toPage = (tab, x, y) => { const rect = tab.frame.getBoundingClientRect(), sx = tab.frame.clientWidth ? rect.width / tab.frame.clientWidth : 1, sy = tab.frame.clientHeight ? rect.height / tab.frame.clientHeight : 1; return { x: rect.left + x * sx, y: rect.top + y * sy }; };
  function dragEvent(tab, kind, event) {
    const detail = kind === 'drop' ? { type: 'drop', ...event } : event;
    try { tab.frame?.contentWindow?.postMessage({ __labSurface: tab.token, event: kind, detail }, '*'); } catch { /* the frame is gone */ }
    call(tab.callbacks.onDrag, tab, kind, detail);
  }
  // While a drag runs the page lays a transparent shield over itself (the frame included): where the browser stops sending the pointer to the frame once it leaves it,
  // the shield sees the same pointer. Both sources feed dragStep with page coordinates; Esc on the page cancels.
  let shield = null;
  function lowerShield() { if (!shield) return; shield.node.remove(); doc.removeEventListener?.('keydown', shield.onKey, true); shield = null; }
  function raiseShield(tab) {
    lowerShield(); const node = el('div', 'lab-drag-shield'); node.setAttribute('aria-hidden', 'true');
    const feed = kind => event => { if (!tab.drag) return; event.preventDefault?.(); dragStep(tab, kind, { x: event.clientX, y: event.clientY }).catch(() => { drag?.cancel(); endDragLook(tab); }); };
    node.addEventListener('pointermove', feed('move')); node.addEventListener('pointerup', feed('end')); node.addEventListener('pointercancel', () => cancelDrag(tab));
    const onKey = event => { if (event.key !== 'Escape') return; event.preventDefault?.(); event.stopPropagation?.(); cancelDrag(tab); };
    doc.addEventListener?.('keydown', onKey, true); doc.body.append(node); shield = { node, onKey };
  }
  async function dragStep(tab, kind, at) {
    const current = tab.drag; if (!current) return;
    if (kind === 'move') {
      const point = await drag.move(at.x, at.y); if (!point || tab.drag !== current) return;
      if (now() - current.lastEventAt < dragEventMs) return; current.lastEventAt = now();
      dragEvent(tab, 'drag', { type: 'over', payload: current.payload, ...point });
    } else {
      endDragLook(tab); const point = await drag.end(at.x, at.y); if (!point) return;
      dragEvent(tab, 'drop', { payload: current.payload, ...point });
    }
  }
  function endDragLook(tab) { tab.drag = null; lowerShield(); const side = sides.get(tab.config.side); if (side) { delete side.root.dataset.dragging; if (tab.open && tab.config.trigger === 'hover' && !tab.pinned && !side.root.matches?.(':hover')) scheduleHoverClose(side); } }
  function cancelDrag(tab) { if (!tab.drag) return; const payload = tab.drag.payload; drag?.cancel(); endDragLook(tab); dragEvent(tab, 'drag', { type: 'cancel', payload }); }
  async function onDragMessage(tab, message) {
    if (!drag || !tab.open) return;
    const data = dragMessage(message), at = toPage(tab, data.x, data.y);
    if (data.kind === 'start') {
      if (tab.drag) cancelDrag(tab);
      for (const other of tabs.values()) if (other.drag) cancelDrag(other);   // one pointer drag at a time on the page
      tab.drag = { payload: data.payload, lastEventAt: now() };
      sideOf(tab.config.side).root.dataset.dragging = 'true';
      raiseShield(tab);
      dragEvent(tab, 'drag', { type: 'start', payload: data.payload, ...drag.begin({ label: data.label || tab.config.title, image: data.image, clientX: at.x, clientY: at.y }) });
      return;
    }
    if (data.kind === 'cancel') cancelDrag(tab);
    else if (data.kind === 'move' || data.kind === 'end') await dragStep(tab, data.kind, at);
  }
  function onMessage(event) {
    const data = event.data; if (!data || typeof data !== 'object' || typeof data.__labSurface !== 'string') return;
    for (const tab of tabs.values()) {
      if (!tab.frame || event.source !== tab.frame.contentWindow || data.__labSurface !== tab.token) continue;
      if (typeof data.drag === 'string') onDragMessage(tab, data).catch(() => { drag?.cancel(); endDragLook(tab); });
      else if (data.key === 'Escape') { setOpen(tab, false, 'user'); tab.button.focus?.(); }
      else if ('data' in data) call(tab.callbacks.onMessage, tab, data.data);
      return;
    }
  }
  win?.addEventListener?.('message', onMessage);
  win?.addEventListener?.('resize', () => { for (const name of sides.keys()) layout(name); });

  function closeTab(tab, reason = 'code') {
    if (tab.closed) return; if (tab.drag) cancelDrag(tab);
    tab.closed = true; tab.open = false; tabs.delete(tab.id); tab.button.remove(); tab.panel.remove(); layout(tab.config.side);
    call(tab.callbacks.onClose, tab, reason);
  }
  /**
   * options: { owner, ownerName, config (what the plugin passed: sanitized here), html, onMessage(tab, data), onToggle(tab, open, by), onClose(tab, reason), onDrag(tab, kind, detail) }.
   * A tab of the same owner with the same config.id is replaced in place (same tab id). Returns the tab: { id, owner, config, open, setOpen, update, post, close }.
   */
  function open({ owner = '', ownerName = 'Plugin', config: rawConfig = {}, html = '', onMessage: receive = null, onToggle = null, onClose = null, onDrag = null } = {}) {
    const config = sanitizeTabConfig(rawConfig, { name: ownerName }), existing = [...tabs.values()].find(tab => tab.owner === owner && tab.config.key === config.key);
    if (existing) { existing.callbacks = { onMessage: receive, onToggle, onClose, onDrag }; applyConfig(existing, config); setHtml(existing, html); return existing; }
    if ([...tabs.values()].filter(tab => tab.owner === owner).length >= TAB_LIMITS.perOwner) throw fail('bad-args', `No máximo ${TAB_LIMITS.perOwner} abas por plugin.`);
    if (tabs.size >= TAB_LIMITS.total) throw fail('busy', `No máximo ${TAB_LIMITS.total} abas de plugins na página.`);
    if (String(html ?? '').length > TAB_LIMITS.html) throw fail('bad-args', `HTML grande demais (máximo ${TAB_LIMITS.html} caracteres).`);
    const id = `lab-tab-${++counter}`, button = el('button', 'lab-tab'), icon = el('span', 'lab-tab-icon'), name = el('span', 'lab-tab-name');
    const panel = el('section', 'lab-tab-panel'), head = el('div', 'lab-tab-head'), heading = el('h2', 'lab-tab-title'), close = el('button', 'lab-tab-close', '×'), body = el('div', 'lab-tab-body');
    button.type = 'button'; button.id = `${id}-button`; button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', id); icon.setAttribute('aria-hidden', 'true'); button.append(icon, name);
    panel.id = id; panel.setAttribute('role', 'region'); panel.dataset.open = 'false'; panel.inert = true; panel.setAttribute('aria-hidden', 'true'); close.type = 'button'; heading.id = `${id}-title`;
    head.append(heading, close); panel.append(head, body);
    const tab = { id, owner, token: `${id}-${Math.random().toString(36).slice(2)}`, button, icon, name, panel, heading, closeButton: close, body, frame: null, open: false, pinned: false, closed: false, drag: null, px: null,
      config: null, memoryKey: '', callbacks: { onMessage: receive, onToggle, onClose, onDrag } };
    tab.setOpen = (value, by = 'code') => { if (value) tab.pinned = true; setOpen(tab, value, by); };
    tab.update = (changes = {}) => { if (changes.config !== undefined) applyConfig(tab, sanitizeTabConfig({ ...changes.config, id: tab.config.key }, { name: ownerName })); if (changes.html !== undefined) setHtml(tab, changes.html); };
    tab.post = data => { if (!tab.loaded) { if (tab.queue.length < 100) tab.queue.push(data); return; } try { tab.frame?.contentWindow?.postMessage({ __labSurface: tab.token, data }, '*'); } catch { /* the frame is gone */ } };
    tab.close = reason => closeTab(tab, reason);
    button.addEventListener('click', () => {
      if (tab.open && tab.config.trigger === 'hover' && !tab.pinned) { tab.pinned = true; return; }   // opened by the pointer passing over it: the click keeps it open
      if (!tab.open) tab.pinned = true; setOpen(tab, !tab.open, 'user');
    });
    button.addEventListener('pointerenter', event => { if (tab.config.trigger === 'hover' && !tab.open && event.pointerType !== 'touch') setOpen(tab, true, 'hover'); });
    close.addEventListener('click', () => { setOpen(tab, false, 'user'); button.focus?.(); });
    tabs.set(id, tab); try { applyConfig(tab, config); setHtml(tab, html); } catch (error) { closeTab(tab, 'error'); throw error; }
    const remembered = config.remember ? readTabMemory(store())[tab.memoryKey] : undefined, start = typeof remembered === 'boolean' ? remembered : config.startOpen;
    if (start) { tab.pinned = true; setOpen(tab, true, 'start'); }
    return tab;
  }
  return {
    open, get: id => tabs.get(String(id)) ?? null, list: () => [...tabs.values()],
    /** A plugin stopped: its tabs go away. */
    closeOwner(owner, reason = 'stopped') { for (const tab of [...tabs.values()]) if (tab.owner === owner) closeTab(tab, reason); },
    relayout() { for (const name of sides.keys()) layout(name); },
    get count() { return tabs.size; },
  };
}

/**
 * The `tab` action of the plugin host (src/plugin-host.js ACTION_METHODS) over a side-tab host: ops open / update / post / setOpen / close, and the tab's events sent to
 * the plugin with emit(pluginId, event): { id, type: 'message' | 'toggle' | 'closed' | 'drag' | 'drop', ... }.
 */
export function createTabAction({ tabs, emit }) {
  const callbacks = plugin => ({
    onMessage: (tab, data) => emit(plugin.id, { id: tab.id, type: 'message', data }),
    onToggle: (tab, open, by) => emit(plugin.id, { id: tab.id, type: 'toggle', open, by }),
    onClose: (tab, reason) => emit(plugin.id, { id: tab.id, type: 'closed', reason }),
    onDrag: (tab, kind, detail) => emit(plugin.id, { id: tab.id, type: kind, event: detail }),
  });
  return (plugin, args = {}) => {
    const op = String(args.op ?? '');
    if (op === 'open') { const tab = tabs.open({ owner: plugin.id, ownerName: plugin.name, config: args.config ?? {}, html: args.html ?? '', ...callbacks(plugin) }); return { id: tab.id, open: tab.open, config: tab.config }; }
    const tab = args.id ? tabs.get(String(args.id)) : null;
    if (!tab || tab.owner !== plugin.id) throw fail('not-found', 'Aba fechada ou desconhecida.');
    if (op === 'update') tab.update({ ...(args.config !== undefined ? { config: { ...tab.config, open: tab.config.startOpen, ...args.config } } : {}), ...(args.html !== undefined ? { html: args.html } : {}) });
    else if (op === 'post') tab.post(args.data);
    else if (op === 'setOpen') tab.setOpen(args.open !== false, 'code');
    else if (op === 'close') tab.close('code');
    else throw fail('bad-args', `Operação de aba desconhecida: ${op.slice(0, 20)}`);
    return { id: tab.id, open: tab.open, config: tab.config };
  };
}
