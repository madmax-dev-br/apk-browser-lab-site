// The runtime of a page plugin (docs/PLUGINS.md). Each enabled plugin runs in its own dedicated module Worker made from a Blob of `pluginWorkerSource()`: this runtime plus
// nothing else; the user's code arrives in the 'start' message and is compiled there as the body of an async function. A slow or looping plugin blocks only its own
// Worker (the page terminates it with Parar), never the page or the VM Worker. The plugin sees the global `lab` object below; everything it asks goes to the page
// (src/plugin-host.js), which answers from what it already has (the screen of the last drawn frame, Logcat and network batches) or with a read-only, rate-limited query
// of the VM (src/plugin-queries.js). It is the user's own code with the page's origin: it can use fetch like any script of the page; the lab adds no network permission.
//
/**
 * @typedef {object} Lab  The `lab` global of a plugin.
 * @property {(name: 'screen'|'ready'|'log'|'network'|'refresh', fn: Function) => () => void} on   Subscribes; returns the unsubscribe function. 'screen': the active screen changed
 *   ({ activity, activityStack, windows: [{ id, kind, modal, visible, focused }], dialogs, canGoBack, closed, packageName, frame }). 'log': a batch (array) of Logcat
 *   entries { seq, uptime, wall, pid, tid, thread, level, tag, message }. 'network': a batch of network log entries (src/netlog.js), new or updated. Batches come at most
 *   every 250 ms, and Logcat lines reach the page only while some plugin listens to 'log' (or the Logcat panel is open). 'refresh': the user clicked Atualizar on the plugin's card.
 * @property {(name: string, fn?: Function) => void} off
 * @property {() => Promise<object>} screen          The current screen (same shape as the 'screen' event); no VM work. `screen.ready` is "Tela pronta" (src/screen-ready.js):
 *   { ready, activity, readySince, waitingFor: [motivos], fragments: [{ className, state, hidden, ready }] } — the Activity and its fragments loaded and the screen is still.
 *   lab.on('ready', fn) calls fn(screen) each time it turns ready (a new Activity, a reload, a navigation that settles).
 * @property {(options?: { timeoutMs?: number }) => Promise<object>} waitReady   Resolves with the screen once it is ready (rejects with code 'timeout', 15 s by default).
 * @property {(options?: { maxNodes?: number }) => Promise<object>} composeTree   The Compose layout tree: { owners: [{ nodes: [{ id, parentId, depth, name, bounds, texts,
 *   editableText, role, testTag, actions, ... }] }], totalNodes, truncated }. At most once per second per plugin; the same frame answers from a cache.
 * @property {(options?: { names?: boolean }) => Promise<object[]>} layoutBounds   The boxes "Mostrar limites de layout" draws: [{ key, kind: 'compose'|'view', name, nameSource,
 *   bounds (window px), size, texts, editableText, role, testTag, contentDescriptions, actions, modifiers, measurePolicy, type, hasImage }]. Names come from one composeTree (same rate limit).
 * @property {(options?: { endpointMocks?: object[], crops?: object[], crop?: object, tree?: boolean, image?: boolean, mode?: 'display'|'cover', restoreState?: boolean, timeoutMs?: number, quietMs?: number, type?: string, pixels?: boolean }) => Promise<object>} renderVariant
 *   Another instance of the current screen, rendered in the background with `endpointMocks` in front of the lab's and destroyed afterwards (docs/RENDER-VARIANT.md): { image, images
 *   (one per crop: { selector: { name | testTag | text | contentDescription | role | viewId }, all, index } or { rect }), views, semantics, composeTree (with tree: true), requests,
 *   mocks, settled, timedOut, waitingFor, droppedStarts, visible, notes, ms }. Images are { width, height, scale, type, blob }. It runs in the app's process: shared state a mocked
 *   answer writes stays; user input waits while it runs.
 * @property {(options?: { key?: string, bounds?: object, element?: object, node?: object, maxWidth?: number, type?: string }) => Promise<{ blob: Blob, width: number, height: number, type: string, notes: string[] }>} screenshot
 *   An image of the screen, of one element (`key` from layoutBounds), or of any box: `bounds` (or `element` / `node`) takes a rectangle in window coordinates, a layoutBounds
 *   element or a composeTree node (its boundsInWindow), cut from the frame the page shows at the rasters' own resolution. At most one every 500 ms per plugin.
 * @property {(target: string|number|object) => Promise<object[]>} find   The components a target names, as layoutBounds elements (a View also carries `viewId` and `viewIdName`). A target
 *   is an id (a Compose testTag, a View's android:id as 'nome' / 'id/nome' / the number, a layoutBounds key, a Compose node id) or { testTag | viewId | nodeId | key | text |
 *   contentDescription | name | role, kind?, index? } (every field given has to match), or an element of layoutBounds / find.
 * @property {(target: string|number|object, options?: { padding?: number, maxWidth?: number, type?: string }) => Promise<object>} capture   The image of the component a target
 *   names (the first match, or `index`): { blob, width, height, type, notes, element, matches }. Same as screenshot({ target, ... }) and its rate limit.
 * @property {(target: string|number|object, options?: { id?: string, color?: string, label?: string|boolean, fill?: boolean, width?: number, padding?: number, all?: boolean, durationMs?: number, required?: boolean }) => Promise<object>} highlight
 *   Draws the component's limit over the simulated device (a page overlay; the app does not see it) and keeps it on the component frame by frame: hidden while it is off
 *   screen. -> { id, state: { matches, visible, elements, bounds, ... }, update(changes), remove() }. At most 32 per plugin; they go when the plugin stops.
 * @property {{ list(): Promise<object[]>, clear(): Promise<{ removed: number }> }} highlights
 * @property {() => Promise<object[]>} viewModels    ViewModels of the active screen: [{ handle, className, key, library, owner: { kind, label, className, handle } }].
 * @property {() => Promise<object[]>} fragments     androidx fragments on the screen: [{ handle, className, who, tag, id, hidden, state, children }].
 * @property {() => Promise<{handle: string, className: string}|null>} activity   The current Activity object.
 * @property {(handle: string, options?: { depth?: number, maxFields?: number, maxItems?: number, maxString?: number }) => Promise<any>} inspect
 *   Read-only JSON view of an object's fields (depth 2, 200 fields by default). Nested objects carry `$handle`; StateFlow / LiveData / MutableState show `value`.
 * @property {(handle: string, path: string, options?: object) => Promise<any>} field   One value by path ('orders.0.title', 'reviewer', 'count.size').
 *   `path` may be an array when a part has dots (a map key): ['registry', 'a.b.Tipo::escopo', 'value']. Holders are looked through: StateFlow / LiveData / MutableState
 *   / atomics, Weak/SoftReference (`ref.get`), Kotlin `by lazy` and ThreadLocal.
 * @property {(className: string, options?: object) => Promise<{ className, status, fields, note? }>} statics   The static fields of a class the app already initialized
 *   (a Kotlin object, a companion, a singleton holder, a dependency-injection container kept globally). A class not initialized answers status 'not-initialized': a query never runs <clinit>.
 * @property {(className: string, path: string|string[], options?: object) => Promise<any>} staticField   One value by path from a static field: staticField('a.b.Holder', 'instance.state.value').
 * @property {(match: string, options?: { limit?: number, initialized?: boolean }) => Promise<{ items: [{ className, status, staticFields }], matched }>} classes
 *   Classes of the APK whose name contains `match` (or matches '/regex/'), to find the holder of a static.
 * @property {(className: string, options?: { subclasses?: boolean, limit?: number, after?: number, maxPages?: number }) => Promise<{ items: [{ handle, className }], scanned, done, next }>} instances
 *   Live objects of a class (subclasses and implementors included by default), found by scanning the heap in short pages. `next` continues an unfinished scan (`after`).
 * @property {(handle: string, options?: { limit?: number, after?: number, maxPages?: number }) => Promise<{ items: [{ kind: 'static', className, field } | { kind: 'object', handle, className, via }], done, next }>} referrers
 *   Who holds an object: static fields and objects whose field (`via`), array cell or host slot points to it.
 * @property {(handle: string, options?: { only?: string[], depth?: number }) => Promise<{ handle, count, locals: [{ name, declaredIn, kind, value, key }], values: object }>} compositionLocals
 *   The CompositionLocals of one Compose component (a node handle from composeTree): what LocalX.current answers there. `values.LocalX` is the value; kind 'static',
 *   'dynamic' (a MutableState: its current value) or 'computed' (not evaluated). Only the Locals provided on the way to that node are listed (the others have their default).
 * @property {(match: string|string[], options?: { limit?: number, budgetMs?: number, depth?: number }) => Promise<{ matches: [{ name, declaredIn, kind, valueType, value, nodes, node }], scannedNodes, done }>} findCompositionLocal
 *   Where a Local is provided on the screen, without choosing a node: each distinct provided value, how many components see it and the handle of one of them.
 * @property {(handle: string|{ static: string }, path: string|string[], fn: (value: any, previous: any) => void, options?: { intervalMs?: number, depth?: number, onError?: Function }) => () => void} watch
 *   Polls `field(handle, path)` every intervalMs (>= 250) and calls fn only when the value changed; returns the stop function. A collected object stops the watch.
 * @property {{ text(s: string, o?: {id?: string}): void, kv(obj: object, o?: {id?: string}): void, table(rows: object[], columns?: string[], o?: {id?: string}): void,
 *   json(value: any, o?: {id?: string}): void, image(blobOrScreenshot: Blob|{blob: Blob}, o?: {id?: string, caption?: string}): void, clear(): void, badge(s: string): void }} ui   Output of the plugin's panel. Each call adds a block; a block with the same `id`
 *   is replaced in place. Rendered as text only (no HTML), at most ~10 times a second.
 * @property {(options: number|{ x?: number, y?: number, target?: object|string }) => Promise<object>} scrollTo   Scrolls a scrollable of the app to a position in px
 *   (1 px = 1 dp in the lab) through the app's own scrolling (the ScrollBy semantics action of Compose, View.scrollBy of a View); `target` is { testTag }, { text }, { key },
 *   { x, y } or nothing (the largest scrollable on screen). -> { element, key, kind, x, y, maxX, maxY, percentX, percentY, unit: 'px', estimated, reached, steps, via }.
 * @property {(options: number|{ x?: number, y?: number, target?: object|string }) => Promise<object>} scrollToPercent   The same to a percentage (0–100) of the scroll range.
 * @property {(target?: object|string) => Promise<object>} scrollInfo   Where a scrollable is, without moving it.
 * @property {{ open(options: { html: string, title?: string, icon?: string, side?: 'left'|'right', width?: number|string, height?: number|string, mode?: 'overlay'|'push',
 *   trigger?: 'click'|'hover', open?: boolean, remember?: boolean, id?: string }): Promise<object> }} tab   A side tab ("lingueta") of the lab with the plugin's HTML in an
 *   isolated iframe (window.lab.post / on / draggable / onDrag / onDrop inside). The handle: { id, isOpen, update, post, setOpen, expand, collapse, close, onMessage, onToggle,
 *   onClose, onDrag, onDrop }. A drag started in the surface with window.lab.draggable(element, data) reports where it is over the simulated device: onDrag / onDrop get
 *   { type: 'start'|'over'|'cancel'|'drop', payload, inside, x, y (device px), dpX, dpY, percentX, percentY, windowX, windowY, screen: { width, height, density }, element }.
 * @property {(options: string|{ label?: string, icon?: string, title?: string, id?: string, variant?: 'default'|'primary'|'danger', disabled?: boolean, placement?: 'plugin'|'toolbar' }, onClick?: Function) => Promise<object>} button
 *   A button of the plugin that the lab renders (src/plugin-buttons.js): 'plugin' (default) in the plugin's output card and its row in Controles › Plugins, 'toolbar' in the
 *   device preview's bar. onClick(event: { id, by: 'user'|'mcp', button }) runs here and may be async; the button is busy until it finishes. The same `id` again updates
 *   that button (and replaces its handler when one is given). At most 12 per plugin. -> { id, state, update(changes), remove(), onClick(fn) -> off }.
 * @property {{ list(): Promise<object[]>, clear(): Promise<{ removed: number }> }} buttons   The plugin's buttons as the page shows them ({ id, label, icon, title, variant,
 *   disabled, placement, busy, clicks }); clear removes them all. They also go away when the plugin stops.
 * @property {(ms: number) => Promise<void>} sleep
 * @property {{ id: string, name: string, packageName: string|null }} info
 */

/** The Worker side. Self-contained (it is serialized with Function.prototype.toString into the Blob): no closure over this module. `scope` is the Worker global. */
export function pluginWorkerMain(scope) {
  const post = message => { try { scope.postMessage(message); } catch { /* the page is gone */ } };
  const MAX_TEXT = 4000, UI_FLUSH_MS = 100, UI_MAX_OPS = 200;
  const pending = new Map(), handlers = new Map(); let nextCall = 1, started = false;
  const textOf = value => { if (typeof value === 'string') return value; try { const seen = new WeakSet(); return JSON.stringify(value, (key, item) => { if (typeof item === 'bigint') return String(item); if (item && typeof item === 'object') { if (seen.has(item)) return '[ciclo]'; seen.add(item); } return item; }); } catch { return String(value); } };
  const clip = text => { text = String(text); return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '…' : text; };
  // console.* of the plugin goes to its panel (bounded there)
  const consoleOut = {}; for (const level of ['log', 'info', 'warn', 'error', 'debug']) consoleOut[level] = (...args) => post({ t: 'console', level, text: clip(args.map(textOf).join(' ')) });
  try { scope.console = Object.assign(Object.create(scope.console ?? null), consoleOut); } catch { /* read-only console */ }
  const reportError = (error, phase) => post({ t: 'error', phase, message: clip(error?.message ?? String(error)), stack: clip(String(error?.stack ?? '')).split('\n').slice(0, 12).join('\n') });
  scope.addEventListener?.('error', event => { event.preventDefault?.(); reportError(event.error ?? { message: event.message }, 'uncaught'); });
  scope.addEventListener?.('unhandledrejection', event => { event.preventDefault?.(); reportError(event.reason, 'promise'); });
  const call = (method, args) => new Promise((resolve, reject) => { const id = nextCall++; pending.set(id, { resolve, reject }); post({ t: 'call', id, method, args }); });
  // ui: operations are coalesced here (a clear drops what came before it, a block id keeps only its last value) and posted at most every UI_FLUSH_MS
  let uiOps = [], uiTimer = null;
  const flushUi = () => { uiTimer = null; if (!uiOps.length) return; const ops = uiOps; uiOps = []; post({ t: 'ui', ops }); };
  const pushUi = op => {
    if (op.op === 'clear') uiOps = [];
    else if (op.id !== undefined) uiOps = uiOps.filter(other => other.id !== op.id || other.op === 'clear');
    else if (op.op === 'badge') uiOps = uiOps.filter(other => other.op !== 'badge');
    uiOps.push(op); if (uiOps.length > UI_MAX_OPS) uiOps = uiOps.slice(uiOps.length - UI_MAX_OPS);
    if (uiTimer === null) uiTimer = setTimeout(flushUi, UI_FLUSH_MS);
  };
  const blockId = options => options && options.id !== undefined && options.id !== null ? String(options.id).slice(0, 80) : undefined;
  const plain = value => { try { return JSON.parse(textOf(value)); } catch { return String(value); } };
  const ui = Object.freeze({
    text: (text, options) => pushUi({ op: 'text', id: blockId(options), text: clip(textOf(text)) }),
    kv: (object, options) => pushUi({ op: 'kv', id: blockId(options), entries: Object.entries(object ?? {}).slice(0, 200).map(([key, value]) => [clip(key), clip(typeof value === 'string' ? value : textOf(value))]) }),
    table: (rows, columns, options) => {
      if (columns && !Array.isArray(columns) && typeof columns === 'object') { options = columns; columns = null; }
      const list = Array.isArray(rows) ? rows.slice(0, 500) : [], cols = (Array.isArray(columns) && columns.length ? columns : [...new Set(list.flatMap(row => row && typeof row === 'object' ? Object.keys(row) : []))]).slice(0, 20).map(String);
      pushUi({ op: 'table', id: blockId(options), columns: cols, rows: list.map(row => cols.map(col => { const value = Array.isArray(row) ? row[cols.indexOf(col)] : row?.[col]; return value === undefined || value === null ? '' : clip(typeof value === 'string' ? value : textOf(value)).slice(0, 500); })) });
    },
    json: (value, options) => pushUi({ op: 'json', id: blockId(options), value: plain(value) }),
    image: (image, options) => { const blob = image && typeof image === 'object' && 'blob' in image ? image.blob : image; pushUi({ op: 'image', id: blockId(options), blob, caption: clip(textOf(options?.caption ?? '')), width: image?.width, height: image?.height }); },
    clear: () => pushUi({ op: 'clear' }),
    badge: text => pushUi({ op: 'badge', text: clip(textOf(text ?? '')).slice(0, 40) }),
  });
  const wrapError = error => Object.assign(new Error(error?.message ?? 'Falha na consulta.'), { code: error?.code ?? 'failed' }, error?.exception ? { exception: error.exception } : {});
  const watches = new Set(), readyWrappers = new Map(), modals = new Map(); let modalSubscribed = false;
  const tabs = new Map(); let tabSubscribed = false;
  const overlays = new Map(); let overlaySubscribed = false;   // lab.overlay: id -> { message: Set, close: Set, state }
  const tracks = new Map(); let trackSubscribed = false;       // lab.track: id -> fn
  const overlayConfig = options => { const out = {}; for (const key of ['anchor', 'placement', 'align', 'offset', 'width', 'height', 'maxWidth', 'interactive', 'flip', 'title']) if (options?.[key] !== undefined) out[key] = options[key]; if (out.anchor !== undefined && out.anchor !== 'screen' && out.anchor !== 'window') out.anchor = 'target'; return out; };
  // an argument of lab.invoke: JSON values, a handle ('h12.x'), { handle } / an element of lab.viewModels(), or { long: '123' } / BigInt for a long beyond 2^53
  const invokeArg = value => typeof value === 'bigint' ? { long: String(value) } : value && typeof value === 'object' && !Array.isArray(value) && typeof value.handle === 'string' && value.long === undefined ? { handle: value.handle } : value;
  const buttons = new Map();   // button id -> { handlers: Set, handle }: the plugin's buttons (lab.button); the page keeps their state and sends { t: 'click', id }
  const buttonConfig = options => { const out = {}; for (const key of ['id', 'label', 'icon', 'title', 'variant', 'disabled', 'placement']) if (options?.[key] !== undefined) out[key] = options[key]; return out; };
  async function runClick(data) {
    const id = String(data.id ?? ''), entry = buttons.get(id), handlers = entry ? [...entry.handlers] : [];
    let ok = true, message = '';
    await Promise.all(handlers.map(async fn => {
      try { await fn({ id, by: data.by === 'mcp' ? 'mcp' : 'user', button: entry.handle }); }
      catch (error) { ok = false; message = clip(error?.message ?? String(error)).slice(0, 400); reportError(error, `button('${id}')`); }
    }));
    post({ t: 'clicked', id, ok, handlers: handlers.length, ...(ok ? {} : { error: message }) });
  }
  function buttonHandle(id) {
    let entry = buttons.get(id); if (entry) return entry;
    entry = { handlers: new Set(), state: null, handle: null };
    const listen = fn => { if (typeof fn !== 'function') throw new TypeError('button.onClick(função)'); entry.handlers.add(fn); return () => entry.handlers.delete(fn); };
    entry.handle = Object.freeze({ id, get state() { return entry.state; },
      update: async (changes = {}) => { entry.state = await call('button', { op: 'update', id, config: buttonConfig(changes) }); return entry.state; },
      remove: async () => { buttons.delete(id); return call('button', { op: 'remove', id }); },
      onClick: listen });
    buttons.set(id, entry); return entry;
  }
  const fire = (set, phase, ...args) => { for (const fn of [...set]) { try { const result = fn(...args); if (result && typeof result.then === 'function') result.then(undefined, error => reportError(error, phase)); } catch (error) { reportError(error, phase); } } };
  const tabConfig = options => { const out = {}; for (const key of ['id', 'title', 'icon', 'side', 'width', 'height', 'mode', 'trigger', 'open', 'remember']) if (options?.[key] !== undefined) out[key] = options[key]; return out; };
  // a scroll target: a testTag (string), { testTag }, { text }, { key } or a layoutBounds element, { x, y } (a point of the window); nothing = the largest scrollable on screen
  const scrollTarget = target => target === undefined || target === null ? null : typeof target === 'string' ? { testTag: target } : { key: target.key ?? undefined, testTag: target.key ? undefined : target.testTag ?? undefined, text: target.key ? undefined : target.text ?? undefined, x: target.key ? undefined : target.x, y: target.key ? undefined : target.y };
  // a component by id: a string or number (testTag, android:id, layoutBounds key, node id), a selector object, or an element of lab.layoutBounds() / lab.find()
  const targetArg = target => { if (target === undefined || target === null || typeof target !== 'object') return target ?? null; if (target.key !== undefined && target.bounds) return { key: target.key, bounds: {} }; const out = {}; for (const key of ['id', 'key', 'testTag', 'viewId', 'nodeId', 'text', 'contentDescription', 'name', 'role', 'kind', 'index']) if (target[key] !== undefined) out[key] = target[key]; return out; };
  const highlightOptions = options => { const out = {}; for (const key of ['id', 'color', 'label', 'fill', 'width', 'padding', 'all', 'durationMs', 'required']) if (options?.[key] !== undefined) out[key] = options[key]; return out; };
  const viewOptions = options => ({ depth: options?.depth, maxFields: options?.maxFields, maxItems: options?.maxItems, maxString: options?.maxString });
  const pathArg = path => Array.isArray(path) ? path.map(part => String(part ?? '')) : String(path ?? '');
  // A heap scan is served in short pages (each one a bounded query between two VM events); this walks the pages until `limit` items, the end of the heap or `maxPages`.
  async function pages(query, args, options) {
    const limit = Math.max(1, Math.min(500, Number(options?.limit) || 50)), maxPages = Math.max(1, Math.min(500, Number(options?.maxPages) || 100)), items = [];
    let after = Number(options?.after) || 0, scanned = 0, done = false, page = 0;
    for (; page < maxPages && items.length < limit && !done; page++) {
      const result = await call(query, { ...args, limit: limit - items.length, after, budgetMs: options?.budgetMs });
      items.push(...(result?.items ?? [])); scanned += result?.scanned ?? 0; done = !!result?.done; after = result?.next ?? after;
      if (result?.next === null || result?.next === undefined) done = true;
    }
    return { items, scanned, done, next: done ? null : after, pages: page };
  }
  const lab = {
    on(name, fn) {
      name = String(name); if (typeof fn !== 'function') throw new TypeError('lab.on(nome, função)');
      if (name === 'ready') {   // "Tela pronta": derived from 'screen' (screen.ready.ready turning true: the Activity and its fragments loaded and the screen is still)
        let was = false; const wrapped = screen => { const now = !!screen?.ready?.ready; if (now && !was) fn(screen); was = now; };
        readyWrappers.set(fn, wrapped); const off = lab.on('screen', wrapped);
        lab.screen().then(screen => { if (screen?.ready?.ready && !was) { was = true; fn(screen); } }).catch(() => {});
        return () => { readyWrappers.delete(fn); off(); };
      }
      if (!['screen', 'log', 'network', 'refresh', 'frame', 'modal', 'tab', 'overlay', 'track'].includes(name)) throw new TypeError(`Evento desconhecido: ${name} (use 'screen', 'ready', 'log', 'network', 'refresh' ou 'frame')`);
      let set = handlers.get(name); if (!set) { set = new Set(); handlers.set(name, set); post({ t: 'sub', name, on: true }); }
      set.add(fn); return () => lab.off(name, fn);
    },
    off(name, fn) {
      if (String(name) === 'ready') { if (fn) { const wrapped = readyWrappers.get(fn); readyWrappers.delete(fn); if (wrapped) lab.off('screen', wrapped); } else { for (const wrapped of readyWrappers.values()) lab.off('screen', wrapped); readyWrappers.clear(); } return; }
      const set = handlers.get(String(name)); if (!set) return;
      if (fn) set.delete(fn); else set.clear();
      if (!set.size) { handlers.delete(String(name)); post({ t: 'sub', name: String(name), on: false }); }
    },
    screen: () => call('screen', {}),
    // ---- actions on the lab (the page's own controls; they show in Controles and in the Logcat like the user's) ----
    reload: (mode = 'recreate') => call('reload', { mode: mode === 'reopen' ? 'reopen' : 'recreate' }),
    mock: (spec = {}) => call('mock', { ...spec, headers: spec?.headers, body: typeof spec?.body === 'string' || spec?.body === undefined ? spec?.body : JSON.stringify(spec.body) }),
    unmock: id => call('unmock', { id: String(id ?? '') }),
    mocks: () => call('mocks', {}),
    /** A Blob (a screenshot) as a data: URL, to put in a modal's HTML. */
    async dataUrl(image) { const blob = image && typeof image === 'object' && 'blob' in image ? image.blob : image; const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`; },
    modal: Object.freeze({
      /** Opens a modal on the page with HTML of the plugin (any layout; it runs isolated in the modal). -> { id, update, post, close, onMessage, onClose } */
      async open(options = {}) {
        if (!modalSubscribed) { modalSubscribed = true; lab.on('modal', event => { const entry = modals.get(event?.id); if (!entry) return; if (event.type === 'closed') { modals.delete(event.id); for (const fn of entry.close) fn(event.reason); } else if (event.type === 'message') for (const fn of entry.message) fn(event.data); }); }
        const { id } = await call('modal', { op: 'open', title: String(options?.title ?? ''), size: String(options?.size ?? 'medium'), html: String(options?.html ?? '') });
        const entry = { message: new Set(), close: new Set() }; modals.set(id, entry);
        return Object.freeze({ id,
          update: (changes = {}) => call('modal', { op: 'update', id, ...(changes.title !== undefined ? { title: String(changes.title) } : {}), ...(changes.size !== undefined ? { size: String(changes.size) } : {}), ...(changes.html !== undefined ? { html: String(changes.html) } : {}) }),
          post: data => call('modal', { op: 'post', id, data }),
          close: () => call('modal', { op: 'close', id }),
          onMessage: fn => { entry.message.add(fn); return () => entry.message.delete(fn); },
          onClose: fn => { entry.close.add(fn); return () => entry.close.delete(fn); } });
      },
    }),
    // ---- a side tab ("lingueta") of the page with the plugin's own HTML (src/lab-side-tabs.js) ----
    tab: Object.freeze({
      /** Adds a tab to the side of the lab that expands into a panel with the plugin's HTML. -> { id, isOpen, update, post, setOpen, expand, collapse, close, onMessage, onToggle, onClose, onDrag, onDrop } */
      async open(options = {}) {
        if (!tabSubscribed) {
          tabSubscribed = true;
          lab.on('tab', event => {
            const entry = tabs.get(event?.id); if (!entry) return;
            if (event.type === 'closed') { tabs.delete(event.id); fire(entry.close, 'tab.onClose', event.reason); }
            else if (event.type === 'message') fire(entry.message, 'tab.onMessage', event.data);
            else if (event.type === 'toggle') { entry.open = !!event.open; fire(entry.toggle, 'tab.onToggle', !!event.open, event.by); }
            else if (event.type === 'drag') fire(entry.drag, 'tab.onDrag', event.event);
            else if (event.type === 'drop') fire(entry.drop, 'tab.onDrop', event.event);
          });
        }
        const reply = await call('tab', { op: 'open', config: tabConfig(options), html: String(options?.html ?? '') }), id = reply.id;
        let entry = tabs.get(id); if (!entry) { entry = { open: false, message: new Set(), toggle: new Set(), close: new Set(), drag: new Set(), drop: new Set() }; tabs.set(id, entry); }
        entry.open = !!reply.open;
        const listen = set => fn => { if (typeof fn !== 'function') throw new TypeError('Passe uma função.'); set.add(fn); return () => set.delete(fn); };
        const setOpen = async open => { const answer = await call('tab', { op: 'setOpen', id, open: open !== false }); entry.open = !!answer.open; return entry.open; };
        return Object.freeze({ id, get isOpen() { return entry.open; },
          update: (changes = {}) => call('tab', { op: 'update', id, ...(Object.keys(tabConfig(changes)).length ? { config: tabConfig(changes) } : {}), ...(changes?.html !== undefined ? { html: String(changes.html) } : {}) }),
          post: data => call('tab', { op: 'post', id, data }),
          setOpen, expand: () => setOpen(true), collapse: () => setOpen(false),
          close: () => call('tab', { op: 'close', id }),
          onMessage: listen(entry.message), onToggle: listen(entry.toggle), onClose: listen(entry.close), onDrag: listen(entry.drag), onDrop: listen(entry.drop) });
      },
    }),
    // ---- scrolling a scrollable of the app (src/lab-scroll.js): the app's own scroll (ScrollBy / View.scrollBy), steered until the position is reached ----
    /** Where a scrollable is: { element, key, kind, x, y, maxX, maxY, percentX, percentY, unit: 'px', estimated, horizontal, vertical }. target: see scrollTo. */
    scrollInfo: target => call('scrollInfo', { target: scrollTarget(target) }),
    /** Scrolls to a position in px (= dp in the lab): scrollTo(300), scrollTo({ y: 300 }), scrollTo({ x: 0, y: 1200, target: { testTag: 'lista' } }). target: { testTag }, { text },
     * { key } (or a layoutBounds element), { x, y } (a point of the window), or nothing for the largest scrollable on screen. -> scrollInfo plus { reached, steps, via }. */
    scrollTo: (options = {}) => { const o = typeof options === 'number' ? { y: options } : options ?? {}; return call('scrollTo', { target: scrollTarget(o.target), x: o.x, y: o.y }); },
    /** Scrolls to a percentage (0 to 100) of the scroll range: scrollToPercent(50), scrollToPercent({ y: 50 }), scrollToPercent({ x: 100, target: 'carrossel' }). */
    scrollToPercent: (options = {}) => { const o = typeof options === 'number' ? { y: options } : options ?? {}; return call('scrollTo', { target: scrollTarget(o.target), percentX: o.x, percentY: o.y }); },
    async waitReady(options = {}) {   // resolves with the screen once "Tela pronta" holds; rejects with code 'timeout' (default 15 s)
      const until = Date.now() + Math.max(100, Number(options?.timeoutMs) || 15000);
      for (;;) { const screen = await lab.screen(); if (screen?.ready?.ready) return screen; if (Date.now() >= until) throw Object.assign(new Error(`A tela não ficou pronta: ${(screen?.ready?.waitingFor ?? ['sem informação']).join('; ')}`), { code: 'timeout', screen }); await new Promise(resolve => setTimeout(resolve, 100)); }
    },
    composeTree: (options = {}) => call('composeTree', { maxNodes: options?.maxNodes, locals: Array.isArray(options?.locals) ? options.locals.map(String) : options?.locals ? [String(options.locals)] : undefined }),
    layoutBounds: (options = {}) => call('layoutBounds', { names: options?.names !== false }),
    screenshot: (options = {}) => {
      // bounds: a rectangle, a layoutBounds element ({ bounds }) or a composeTree node ({ boundsInWindow }); key: a layoutBounds element by its key
      const source = options?.bounds ?? options?.element ?? options?.node ?? null, box = source ? (source.boundsInWindow ?? source.bounds ?? source) : null;
      if (options?.target !== undefined && options?.target !== null) return lab.capture(options.target, options);
      return call('screenshot', { key: options?.key ?? null, bounds: box ? { left: Number(box.left), top: Number(box.top), right: Number(box.right), bottom: Number(box.bottom) } : null, maxWidth: options?.maxWidth, type: options?.type });
    },
    // ---- a component by its id (src/lab-target.js): find it, outline it on the device, image it ----
    /** The components a target names, as lab.layoutBounds() elements: find('salvar'), find({ testTag }), find({ viewId: 'titulo' }), find({ nodeId }), find({ text }), find({ role, index }). */
    find: target => call('find', { target: targetArg(target) }),
    /** The image of one component by id: capture('salvar'), capture({ viewId: 'titulo' }, { padding: 8, maxWidth, type }) -> { blob, width, height, type, notes, element, matches }. */
    capture: (target, options = {}) => call('screenshot', { target: targetArg(target), padding: options?.padding, maxWidth: options?.maxWidth, type: options?.type }),
    /** Outlines a component on the device and follows it: highlight('salvar', { color, label, fill, width, padding, all, durationMs, id, required }) -> { id, state, update, remove }. */
    async highlight(target, options = {}) {
      const state = await call('highlight', { op: 'show', target: targetArg(target), options: highlightOptions(options) }), id = state.id; let last = state;
      return Object.freeze({ id, get state() { return last; },
        update: async (changes = {}) => { last = await call('highlight', { op: 'update', id, options: highlightOptions(changes) }); return last; },
        remove: () => call('highlight', { op: 'remove', id }) });
    },
    highlights: Object.freeze({ list: () => call('highlight', { op: 'list' }), clear: () => call('highlight', { op: 'clear' }) }),
    // ---- the device on the page (src/lab-overlays.js): its position and size, components followed frame by frame, the plugin's HTML beside or over it ----
    /** Where the device's screen is on the page and its size: { visible, screen, window, scale, device, windowDp, viewport, orientation } (page px; device and windowDp in dp). */
    frame: () => call('frame', {}),
    /**
     * Follows the components a target names, frame by frame: fn({ id, visible, matches, elements: [{ key, kind, name, testTag, viewId, texts, bounds (window dp), rect (page px) }] })
     * each time one moved, resized, appeared or left the screen (and when the device moved on the page). -> the stop function (with .id).
     */
    async track(target, fn, options = {}) {
      if (typeof fn !== 'function') throw new TypeError('lab.track(alvo, função)');
      if (!trackSubscribed) { trackSubscribed = true; lab.on('track', event => { const handler = tracks.get(event?.id); if (handler) handler(event); }); }
      const { id } = await call('track', { op: 'start', target: targetArg(target), id: options?.id ?? null, all: options?.all === true });
      tracks.set(id, value => { try { const result = fn(value); if (result && typeof result.then === 'function') result.then(undefined, error => reportError(error, 'track')); } catch (error) { reportError(error, 'track'); } });
      const stop = () => { if (!tracks.delete(id)) return Promise.resolve({ removed: false }); return call('track', { op: 'stop', id }); };
      return Object.assign(stop, { id });
    },
    overlay: Object.freeze({
      /**
       * HTML of the plugin beside or over the device, in an isolated frame the lab keeps in place: open({ html, anchor: 'screen' | 'window' | alvo, placement: 'over' | 'top' |
       * 'bottom' | 'left' | 'right' | 'center', align: 'start' | 'center' | 'end', offset, width, height ('auto' | 'anchor' | px), maxWidth, interactive, flip, title, id })
       * -> { id, state, update, post, close, onMessage, onClose }. Inside the frame: window.lab.post / on / onAnchor / anchor.
       */
      async open(options = {}) {
        if (!overlaySubscribed) {
          overlaySubscribed = true;
          lab.on('overlay', event => {
            const entry = overlays.get(event?.id); if (!entry) return;
            if (event.type === 'closed') { overlays.delete(event.id); fire(entry.close, 'overlay.onClose', event.reason); }
            else if (event.type === 'message') fire(entry.message, 'overlay.onMessage', event.data);
          });
        }
        const anchor = options?.anchor ?? 'screen', target = anchor === 'screen' || anchor === 'window' ? null : targetArg(anchor);
        const reply = await call('overlay', { op: 'open', id: options?.id ?? null, config: overlayConfig({ ...options, anchor }), target, html: String(options?.html ?? ''), required: options?.required === true });
        const id = reply.id; let entry = overlays.get(id); if (!entry) { entry = { message: new Set(), close: new Set(), state: null }; overlays.set(id, entry); }
        entry.state = reply.state;
        const listen = set => fn => { if (typeof fn !== 'function') throw new TypeError('Passe uma função.'); set.add(fn); return () => set.delete(fn); };
        return Object.freeze({ id, get state() { return entry.state; },
          /** Changes the anchor, placement, size or HTML: update({ html, anchor, placement, ... }). */
          update: async (changes = {}) => {
            const next = changes?.anchor, config = overlayConfig(changes);
            const reply = await call('overlay', { op: 'update', id, ...(Object.keys(config).length ? { config } : {}), ...(next !== undefined && next !== 'screen' && next !== 'window' ? { target: targetArg(next) } : {}), ...(changes?.html !== undefined ? { html: String(changes.html) } : {}) });
            entry.state = reply.state; return reply.state;
          },
          /** Where the overlay is now: { visible, rect, placement, anchor, element }. */
          refresh: async () => { const reply = await call('overlay', { op: 'state', id }); entry.state = reply.state; return reply.state; },
          post: data => call('overlay', { op: 'post', id, data }),
          close: () => call('overlay', { op: 'close', id }),
          onMessage: listen(entry.message), onClose: listen(entry.close) });
      },
      list: () => call('overlay', { op: 'list' }),
    }),
    // ---- the app's own methods (src/app-invoke.js) ----
    /**
     * The methods of an object's class (and its superclasses) or of a class: methods(handle | { static: 'pacote.Classe' } | 'pacote.Classe', { match, parameters, static, inherited, limit })
     * -> { className, methods: [{ name, signature, parameters, returns, static, visibility, declaredIn, abstract }] }. Read from the DEX; nothing runs.
     */
    methods: (target, options = {}) => call('methods', { ...(typeof target === 'string' && !/^h\d+\./.test(target) ? { className: target } : target && typeof target === 'object' && target.static ? { className: String(target.static) } : { handle: String(target?.handle ?? target ?? '') }),
      match: options?.match === undefined ? undefined : String(options.match), parameters: Number.isFinite(options?.parameters) ? options.parameters : undefined, static: options?.static, inherited: options?.inherited, limit: options?.limit }),
    /**
     * Calls a method of the app on its main thread, as one operation of the lab (like a click): invoke(handle | { static: 'pacote.Classe' }, 'nome', [args], { signature: '(I)V' })
     * -> { value, returns, method, ms }. What it schedules (a coroutine, a Handler message, a recomposition) runs and the device shows the result. A Java exception rejects
     * with code 'exception' (and `exception: { type, message, stack }`).
     */
    invoke: (target, name, args = [], options = {}) => call('invoke', { ...(target && typeof target === 'object' && target.static ? { className: String(target.static) } : { handle: String(target?.handle ?? target ?? '') }),
      method: String(name ?? ''), args: (Array.isArray(args) ? args : [args]).map(invokeArg), signature: options?.signature === undefined ? undefined : String(options.signature) }),
    renderVariant: (options = {}) => call('renderVariant', options ?? {}),   // a background instance of the current screen with other endpoint mocks, as images and data (docs/RENDER-VARIANT.md)
    viewModels: () => call('viewModels', {}),
    fragments: () => call('fragments', {}),
    activity: () => call('activity', {}),
    inspect: (handle, options = {}) => call('inspect', { handle: String(handle ?? ''), options: { depth: options?.depth, maxFields: options?.maxFields, maxItems: options?.maxItems, maxString: options?.maxString } }),
    field: (handle, path = '', options = {}) => call('field', { handle: String(handle ?? ''), path: pathArg(path), options: viewOptions(options) }),
    statics: (className, options = {}) => call('statics', { className: String(className ?? ''), options: viewOptions(options) }),
    staticField: (className, path = '', options = {}) => call('staticField', { className: String(className ?? ''), path: pathArg(path), options: viewOptions(options) }),
    classes: (match, options = {}) => call('classes', { match: String(match ?? ''), limit: options?.limit, initialized: !!options?.initialized }),
    instances: (className, options = {}) => pages('instances', { className: String(className ?? ''), subclasses: options?.subclasses !== false }, options),
    referrers: (handle, options = {}) => pages('referrers', { handle: String(handle ?? '') }, options),
    compositionLocals: (handle, options = {}) => call('compositionLocals', { handle: String(handle ?? ''), only: Array.isArray(options?.only) ? options.only.map(String) : options?.only ? [String(options.only)] : null, options: viewOptions(options) }),
    findCompositionLocal: (match, options = {}) => call('findCompositionLocal', { match: Array.isArray(match) ? match.map(String) : String(match ?? ''), limit: options?.limit, budgetMs: options?.budgetMs, options: viewOptions(options) }),
    watch(handle, path, fn, options = {}) {   // handle: a handle, or { static: 'pacote.Classe' } to follow a static field
      if (typeof fn !== 'function') throw new TypeError('lab.watch(handle, caminho, função)');
      const interval = Math.max(250, Number(options?.intervalMs) || 500); let last, first = true, busy = false, stopped = false;
      const tick = async () => {
        if (busy || stopped) return; busy = true;
        try {
          const read = handle && typeof handle === 'object' && handle.static ? lab.staticField(handle.static, path, options) : lab.field(handle, path, options);
          const value = await read, text = textOf(value);
          if (!stopped && (first || text !== last)) { const previous = first || last === undefined ? undefined : JSON.parse(last); first = false; last = text; await fn(value, previous); }
        } catch (error) {
          if (error?.code === 'collected' || error?.code === 'bad-handle') { stop(); }
          if (typeof options?.onError === 'function') { try { options.onError(error); } catch (inner) { reportError(inner, 'watch'); } }
          else if (error?.code === 'collected') consoleOut.warn(`watch parado: ${error.message}`);
          else if (error?.code !== 'busy' && error?.code !== 'no-apk') reportError(error, 'watch');
        } finally { busy = false; }
      };
      const timer = setInterval(tick, interval); const stop = () => { if (stopped) return; stopped = true; clearInterval(timer); watches.delete(stop); };
      watches.add(stop); tick(); return stop;
    },
    /** A button of the plugin rendered by the lab: lab.button({ label, icon, title, id, variant, disabled, placement }, onClick) -> { id, state, update, remove, onClick }. */
    async button(options = {}, onClick) {
      if (typeof options === 'string') options = { label: options };
      if (onClick !== undefined && typeof onClick !== 'function') throw new TypeError('lab.button(opções, função)');
      const reply = await call('button', { op: 'add', config: buttonConfig(options) }), entry = buttonHandle(reply.id);
      if (onClick) { if (reply.replaced) entry.handlers.clear(); entry.handlers.add(onClick); }
      entry.state = reply.button; return entry.handle;
    },
    buttons: Object.freeze({
      list: () => call('button', { op: 'list' }),
      clear: async () => { buttons.clear(); return call('button', { op: 'clear' }); },
    }),
    sleep: ms => new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0))),
    ui,
    info: Object.freeze({ id: '', name: '', packageName: null }),
  };
  scope.lab = lab;
  scope.onmessage = async ({ data }) => {
    if (!data || typeof data !== 'object') return;
    if (data.t === 'reply') { const waiter = pending.get(data.id); if (!waiter) return; pending.delete(data.id); if (data.ok) waiter.resolve(data.value); else waiter.reject(wrapError(data.error)); return; }
    if (data.t === 'click') { runClick(data); return; }
    if (data.t === 'event') {
      const set = handlers.get(data.name); if (!set) return;
      for (const fn of [...set]) { try { const result = fn(data.data); if (result && typeof result.then === 'function') result.then(undefined, error => reportError(error, `on('${data.name}')`)); } catch (error) { reportError(error, `on('${data.name}')`); } }
      return;
    }
    if (data.t === 'start' && !started) {
      started = true; lab.info = Object.freeze({ id: String(data.id ?? ''), name: String(data.name ?? ''), packageName: data.info?.packageName ?? null });
      let body;
      try { const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor; body = new AsyncFunction('lab', String(data.code ?? '')); }
      catch (error) { reportError(error, 'compile'); post({ t: 'done', ok: false, phase: 'compile' }); return; }
      post({ t: 'started' });
      try { await body.call(undefined, lab); post({ t: 'done', ok: true }); } catch (error) { reportError(error, 'run'); post({ t: 'done', ok: false, phase: 'run' }); }
    }
  };
  post({ t: 'ready' });
}

/** The source of a plugin Worker (a module): the runtime above, started on the Worker global. */
export const pluginWorkerSource = () => `(${pluginWorkerMain.toString()})(self);\n`;

