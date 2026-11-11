// The page side of the plugins (docs/PLUGINS.md): one dedicated Worker per running plugin (src/plugin-runtime.js), the `lab` API served from what the page already has
// and a broker for the read-only VM queries (src/plugin-queries.js through APKWorkerClient.pluginQuery). Costs are bounded here:
//   - nothing runs while no plugin runs: no Worker, no timer, no VM message; `snapshot()` keeps one reference and returns;
//   - 'screen' is derived from the frame the page just drew (activity, stack, windows): no VM work;
//   - 'log' / 'network' are batches of what the page receives anyway, flushed every EVENT_MS; Logcat lines are streamed by the Worker only while a plugin listens to 'log';
//   - VM queries go one at a time, at most one every VM_QUERY_GAP_MS, answered from a per-frame cache when the same question was asked since the last drawn frame (the VM
//     state only changes through events, and every processed event draws a frame), composeTree at most once per COMPOSE_TREE_MS per plugin; the Worker serves them at a low
//     priority with its own time budget;
//   - a plugin's output is applied to a bounded model and rendered by the panel at most every RENDER_MS; console lines, errors and blocks are bounded.
import { pluginWorkerSource } from './plugin-runtime.js?v=5ce2bd9b7452';
import { buildLayoutBoundsElements } from './compose-inspector-panel.js?v=5ce2bd9b7452';
import { encodeVariantImages } from './render-variant-image.js?v=5ce2bd9b7452';
import { BUTTON_LIMITS, buttonId, buttonOut, sanitizeButtonConfig } from './plugin-buttons.js?v=5ce2bd9b7452';
import { targetSelector, selectorResourceNames, resolveSelector, matchTargets, chooseTarget, targetNotFound } from './lab-target.js?v=5ce2bd9b7452';

export const EVENT_MS = 250, RENDER_MS = 100, COMPOSE_TREE_MS = 1000, SCREENSHOT_MS = 500, MAX_IMAGE_BYTES = 8 * 1024 * 1024, VM_QUERY_GAP_MS = 25, MAX_CONSOLE = 200, MAX_ERRORS = 20, MAX_BLOCKS = 50, MAX_LOG_BATCH = 2000;
export const MAX_PENDING_CALLS = 16, MAX_MESSAGES_PER_SECOND = 1000, MAX_TEXT = 10000, MAX_TABLE_ROWS = 500, MAX_TABLE_COLUMNS = 20, MAX_JSON_CHARS = 50000;
const ACTION_METHODS = new Set(['reload', 'mock', 'unmock', 'mocks', 'modal']);
for (const method of ['scrollTo', 'scrollInfo', 'tab']) ACTION_METHODS.add(method);   // scrolling the app to a position / percentage (src/lab-scroll.js) and the side tabs (src/lab-side-tabs.js)
const UNCACHED_VM_METHODS = new Set(['scrollState']);   // read again on every call: lab.scrollTo steers by it between two scroll steps, and an animated scroll moves without a new answer of the cache's frame
const VM_METHODS = new Set(['scrollState', 'resourceIds', 'viewModels', 'fragments', 'activity', 'inspect', 'field', 'composeTree', 'statics', 'staticField', 'classes', 'instances', 'referrers', 'compositionLocals', 'findCompositionLocal']);

/** The screen as the 'screen' event and lab.screen() give it, from the snapshot the page drew. */
export function screenFromSnapshot(snapshot, { packageName = null, frame = 0 } = {}) {
  if (!snapshot) return { activity: null, activityStack: [], tasks: [], windows: [], dialogs: 0, canGoBack: false, closed: false, packageName, frame, ready: null };
  const windows = (snapshot.views ?? []).filter(view => view?.windowSurface).map(view => { const w = view.windowSurface; return { id: w.id ?? null, kind: String(w.kind ?? 'window'), modal: !!w.modal, visible: w.visible !== false, focused: !!w.focused }; });
  const navigation = snapshot.navigation ?? {};
  return { activity: snapshot.activityName ?? null, activityStack: Array.isArray(navigation.activityStack) ? [...navigation.activityStack] : [], tasks: Array.isArray(navigation.tasks) ? navigation.tasks.map(task => ({ id: task.id ?? null, activityStack: [...(task.activityStack ?? [])] })) : [],
    windows, dialogs: windows.filter(w => w.kind === 'dialog').length, canGoBack: !!(snapshot.canGoBack ?? navigation.canGoBack), closed: !!snapshot.closed, packageName, frame,
    ready: snapshot.screenReady ? { ready: !!snapshot.screenReady.ready, activity: snapshot.screenReady.activity ?? null, readySince: snapshot.screenReady.readySince ?? null, waitingFor: [...(snapshot.screenReady.waitingFor ?? [])], fragments: (snapshot.screenReady.fragments ?? []).map(f => ({ ...f })) } : null };
}
/** What makes two screens different (the frame counter does not). */
export const screenKey = screen => JSON.stringify([screen.activity, screen.activityStack, screen.windows, screen.closed, screen.packageName, screen.ready?.ready ?? null]);   // the flip to "Tela pronta" is a screen change
/** '' or '*' = every package; otherwise package ids separated by commas or spaces, `*` as a wildcard. */
export function packageMatches(filter, packageName) {
  const patterns = String(filter ?? '').split(/[\s,]+/).map(item => item.trim()).filter(Boolean);
  if (!patterns.length || patterns.includes('*')) return true;
  if (!packageName) return false;
  return patterns.some(pattern => new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*') + '$').test(packageName));
}
const clipText = (value, max = MAX_TEXT) => { const text = String(value ?? ''); return text.length > max ? text.slice(0, max) + '…' : text; };
/** A ui op from the plugin -> a bounded block (or null). Only plain data survives: the panel renders it with textContent. */
export function sanitizeBlock(op) {
  if (!op || typeof op !== 'object') return null;
  const id = op.id === undefined || op.id === null ? null : clipText(op.id, 80);
  switch (op.op) {
    case 'text': return { id, kind: 'text', text: clipText(op.text) };
    case 'kv': return { id, kind: 'kv', entries: (Array.isArray(op.entries) ? op.entries : []).slice(0, 200).map(pair => [clipText(pair?.[0], 200), clipText(pair?.[1], 2000)]) };
    case 'table': {
      const columns = (Array.isArray(op.columns) ? op.columns : []).slice(0, MAX_TABLE_COLUMNS).map(column => clipText(column, 100));
      return { id, kind: 'table', columns, rows: (Array.isArray(op.rows) ? op.rows : []).slice(0, MAX_TABLE_ROWS).map(row => columns.map((_, index) => clipText(Array.isArray(row) ? row[index] : '', 500))) };
    }
    case 'image': {   // a Blob from lab.screenshot (or any image Blob the plugin made); the panel shows it through an object URL it revokes
      const blob = op.blob; if (typeof Blob === 'undefined' || !(blob instanceof Blob) || !/^image\//.test(blob.type) || blob.size > MAX_IMAGE_BYTES) return { id, kind: 'text', text: `imagem recusada: ${!(typeof Blob !== 'undefined' && blob instanceof Blob) ? 'não é um Blob' : blob.size > MAX_IMAGE_BYTES ? 'maior que 8 MiB' : 'tipo não é image/*'}` };
      return { id, kind: 'image', blob, caption: clipText(op.caption ?? '', 300), width: Number.isFinite(op.width) ? op.width : null, height: Number.isFinite(op.height) ? op.height : null };
    }
    case 'json': { let text; try { text = JSON.stringify(op.value, null, 2) ?? 'undefined'; } catch { text = String(op.value); } return { id, kind: 'json', text: clipText(text, MAX_JSON_CHARS) }; }
    default: return null;
  }
}
/** One element of buildLayoutBoundsElements as lab.layoutBounds() (and the embedded player's layoutBounds()) gives it: plain data, window coordinates in dp. */
export function layoutBoundsElementOut(element) {
  const s = element.semantics ?? null, b = element.windowBounds ?? element.bounds ?? null;
  return { key: element.key, kind: element.kind, name: element.name, nameSource: element.nameSource, id: element.id, viewId: element.kind === 'view' && Number.isFinite(element.androidId) && element.androidId > 0 ? element.androidId : null, bounds: b, size: b ? { width: b.right - b.left, height: b.bottom - b.top } : null,
    texts: s?.texts ?? (element.text ? [element.text] : []), editableText: s?.editableText ?? null, role: s?.role ?? null, testTag: s?.testTag ?? null, contentDescriptions: s?.contentDescriptions ?? (element.contentDescription ? [element.contentDescription] : []),
    actions: s?.actions ?? [], enabled: s ? s.enabled !== false : true, modifiers: (element.modifiers ?? []).map(m => m.label), measurePolicy: element.measurePolicy ?? null, type: element.type ?? null, hasImage: element.hostId !== null && element.hostId !== undefined };
}
/** Applies ui ops to a plugin's output model { blocks, badge } (bounded). */
export function applyUiOps(model, ops) {
  for (const op of Array.isArray(ops) ? ops.slice(0, 500) : []) {
    if (op?.op === 'clear') { model.blocks = []; continue; }
    if (op?.op === 'badge') { model.badge = clipText(op.text, 40); continue; }
    const block = sanitizeBlock(op); if (!block) continue;
    const at = block.id !== null ? model.blocks.findIndex(other => other.id === block.id) : -1;
    if (at >= 0) model.blocks[at] = block; else model.blocks.push(block);
    if (model.blocks.length > MAX_BLOCKS) model.blocks.splice(0, model.blocks.length - MAX_BLOCKS);
  }
  return model;
}

function defaultCreateWorker(name) {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') throw new Error('Este navegador não oferece Web Workers de módulo: plugins indisponíveis.');
  const url = URL.createObjectURL(new Blob([pluginWorkerSource()], { type: 'text/javascript' }));
  const worker = new Worker(url, { type: 'module', name: `apk-lab-plugin:${String(name).slice(0, 40)}` });
  return { worker, release: () => URL.revokeObjectURL(url) };
}

/**
 * @param vm             { pluginQuery(query, args) -> Promise<{ value }>, worker } (APKWorkerClient)
 * @param createWorker   (name) -> { worker, release() }: a Worker running src/plugin-runtime.js (tests pass an in-process one)
 * @param onLogStreaming (wanted: boolean) -> void: some running plugin listens to 'log' (the page then keeps the Worker's Logcat streaming)
 * @param onChange       (pluginId) -> void: a plugin's status or output changed (the panel coalesces renders)
 */
export function createPluginHost({ vm = null, createWorker = defaultCreateWorker, now = () => performance.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id),
  onLogStreaming = () => {}, onChange = () => {}, getPackage = () => null, captureImage = null, actions = null } = {}) {
  const plugins = new Map();   // id -> runtime record of a plugin the panel knows
  let lastSnapshot = null, frame = 0, screen = null, screenSig = null, wantsLogs = false, lastLogSeq = -1;
  let logBuffer = [], logDropped = 0, netPending = new Map(), eventTimer = null;
  const cache = new Map(); let cacheFrame = -1;   // VM answers of the current frame: key -> Promise
  const vmQueue = []; let vmBusy = false, vmLastAt = -Infinity, vmTimer = null;
  const stats = { vmQueries: 0, cacheHits: 0, vmMs: 0, events: 0, workersStarted: 0 };
  const running = () => [...plugins.values()].filter(plugin => plugin.worker);
  const subscribed = name => running().filter(plugin => plugin.subs.has(name));
  const changed = plugin => { try { onChange(plugin.id); } catch { /* the panel's problem */ } };
  const currentScreen = () => { if (!screen || screen.frame !== frame) { screen = screenFromSnapshot(lastSnapshot, { packageName: getPackage() ?? null, frame }); } return screen; };
  const updateLogWanted = () => { const wanted = subscribed('log').length > 0; if (wanted !== wantsLogs) { wantsLogs = wanted; if (!wanted) { logBuffer = []; logDropped = 0; } try { onLogStreaming(wanted); } catch { /* best effort */ } } };
  const send = (plugin, message) => { try { plugin.worker?.postMessage(message); } catch { /* terminated */ } };
  const record = (plugin, list, item, max) => { list.push(item); if (list.length > max) list.splice(0, list.length - max); };

  function scheduleEvents() { if (eventTimer === null) eventTimer = setTimer(flushEvents, EVENT_MS); }
  function flushEvents() {
    eventTimer = null;
    if (logBuffer.length) { const batch = logBuffer; logBuffer = []; const dropped = logDropped; logDropped = 0; for (const plugin of subscribed('log')) { plugin.stats.logLines += batch.length; plugin.stats.logDropped += dropped; send(plugin, { t: 'event', name: 'log', data: batch }); } stats.events++; }
    if (netPending.size) { const batch = [...netPending.values()]; netPending = new Map(); for (const plugin of subscribed('network')) send(plugin, { t: 'event', name: 'network', data: batch }); stats.events++; }
  }

  // ---- VM queries ---------------------------------------------------------------------------------------------------------------------------------------------------
  function pumpVm() {
    if (vmBusy || vmTimer !== null || !vmQueue.length) return;
    const wait = vmLastAt + VM_QUERY_GAP_MS - now(); if (wait > 0) { vmTimer = setTimer(() => { vmTimer = null; pumpVm(); }, wait); return; }
    const job = vmQueue.shift(); vmBusy = true; vmLastAt = now(); stats.vmQueries++;
    const started = now();
    Promise.resolve().then(() => { if (!vm?.worker || typeof vm.pluginQuery !== 'function') throw Object.assign(new Error('Nenhum APK em execução.'), { code: 'no-apk' }); return vm.pluginQuery(job.method, job.args); })
      .then(reply => job.resolve(reply?.value ?? null), error => job.reject(error))
      .finally(() => { stats.vmMs += now() - started; vmBusy = false; vmLastAt = now(); pumpVm(); });
  }
  const vmCall = (method, args) => new Promise((resolve, reject) => { vmQueue.push({ method, args, resolve, reject }); pumpVm(); });
  function cached(key, run) {
    if (cacheFrame !== frame) { cache.clear(); cacheFrame = frame; }
    const hit = cache.get(key); if (hit) { stats.cacheHits++; return hit; }
    const promise = run(); cache.set(key, promise); promise.catch(() => { if (cache.get(key) === promise) cache.delete(key); });   // a failure is not cached
    return promise;
  }
  // Without a running APK the questions about "the screen" have an empty answer (a plugin may start before any APK); questions about an object are an error.
  const EMPTY = { viewModels: () => [], fragments: () => [], activity: () => null, composeTree: () => ({ owners: [], totalNodes: 0, truncated: false, notes: ['nenhum APK em execução'] }) };
  /** "Mostrar limites de layout" as data: the boxes the overlay draws (Views and Compose semantics nodes), named from the Compose tree (one composeTree, rate-limited) unless names: false. */
  async function layoutBoundsFor(plugin, { names = true } = {}) {
    if (!lastSnapshot) return [];
    let tree = null; if (names) { try { tree = await ask(plugin, 'composeTree', {}); } catch { tree = null; } }
    return buildLayoutBoundsElements(tree, lastSnapshot);
  }
  const elementOut = layoutBoundsElementOut;
  /**
   * The components a target names (src/lab-target.js): a testTag, an android:id (its resource name is turned into the number by the VM's resource table, one cached
   * question), a Compose node id, a layoutBounds key, or what the component shows. -> { selector (resolved), raw (elements of buildLayoutBoundsElements), elements (the
   * lab.layoutBounds() form), matches (the ones named, in drawing order) }. Composable names are read (one composeTree, rate-limited) only for a selector by name.
   */
  async function targetsFor(plugin, target) {
    const selector = targetSelector(target), names = selectorResourceNames(selector); let ids = {};
    if (names.length && vm?.worker) { try { ids = (await ask(plugin, 'resourceIds', { names }))?.ids ?? {}; } catch (error) { if (error?.code !== 'no-apk') throw error; } }
    const resolved = resolveSelector(selector, ids), raw = await layoutBoundsFor(plugin, { names: selector.name !== null }), elements = raw.map(elementOut);
    return { selector: resolved, raw, elements, matches: matchTargets(elements, resolved) };
  }
  /** View elements with the resource name of their android:id (`viewIdName`: 'pacote:id/nome'), from one cached question to the VM. */
  async function withViewIdNames(plugin, list) {
    const ids = [...new Set(list.map(element => element.viewId).filter(Number.isFinite))].slice(0, 256); if (!ids.length || !vm?.worker) return list;
    let names = {}; try { names = (await ask(plugin, 'resourceIds', { ids }))?.names ?? {}; } catch { return list; }
    return list.map(element => Number.isFinite(element.viewId) ? { ...element, viewIdName: names[element.viewId] ?? null } : element);
  }
  const pageCaller = { id: 'page', name: 'página (MCP)', worker: {}, stats: { queries: 0, logLines: 0, logDropped: 0, droppedMessages: 0 }, lastComposeAt: -Infinity, lastShotAt: -Infinity };
  // ---- the plugin's own buttons (lab.button, src/plugin-buttons.js): state kept here, rendered by the panel (card, Controles row) and the preview bar --------------------
  function buttonCall(plugin, args) {
    const op = String(args?.op ?? ''), list = plugin.buttons;
    const find = id => list.find(button => button.id === String(id ?? '')) ?? null;
    if (op === 'add') {
      const wanted = buttonId(args.config?.id), existing = wanted ? find(wanted) : null;
      if (existing) { Object.assign(existing, sanitizeButtonConfig(args.config, existing)); changed(plugin); return { id: existing.id, replaced: true, button: buttonOut(existing) }; }
      if (list.length >= BUTTON_LIMITS.perPlugin) throw Object.assign(new Error(`No máximo ${BUTTON_LIMITS.perPlugin} botões por plugin.`), { code: 'limit' });
      let id = wanted; while (!id || find(id)) id = `b${++plugin.buttonSeq}`;
      const button = { id, ...sanitizeButtonConfig(args.config), busy: false, clicks: 0 }; list.push(button); changed(plugin);
      return { id, replaced: false, button: buttonOut(button) };
    }
    if (op === 'list') return list.map(buttonOut);
    if (op === 'clear') { const removed = list.length; list.splice(0); finishClicks(plugin, null, { ok: false, reason: 'removed' }); changed(plugin); return { removed }; }
    const button = find(args.id); if (!button) throw Object.assign(new Error('Botão removido ou desconhecido.'), { code: 'not-found' });
    if (op === 'update') { Object.assign(button, sanitizeButtonConfig(args.config, button)); changed(plugin); return buttonOut(button); }
    if (op === 'remove') { list.splice(list.indexOf(button), 1); finishClicks(plugin, button.id, { ok: false, reason: 'removed' }); changed(plugin); return { removed: 1 }; }
    throw Object.assign(new Error(`Operação de botão desconhecida: ${op.slice(0, 20)}`), { code: 'bad-args' });
  }
  /** Resolves the waiters of a click (one button, or every one with id null). */
  function finishClicks(plugin, id, result) {
    for (const [key, waiters] of plugin.clickWaiters) { if (id !== null && key !== id) continue; plugin.clickWaiters.delete(key); for (const resolve of waiters) resolve(result); }
  }
  async function serve(plugin, method, args) {
    if (method === 'screen') return currentScreen();
    if (method === 'button') { if (plugin === pageCaller) throw Object.assign(new Error('Botões são de um plugin.'), { code: 'unsupported' }); return buttonCall(plugin, args ?? {}); }
    if (ACTION_METHODS.has(method)) {   // the lab's own controls (reload, endpoint mocks, modals): only where the page provides them (not in the embedded player or a backend)
      const action = actions?.[method]; if (typeof action !== 'function') throw Object.assign(new Error(`lab.${method} não está disponível aqui.`), { code: 'unsupported' });
      return action({ id: plugin.id, name: plugin.name }, args ?? {});
    }
    if (method === 'find') {   // lab.find: the components a target names, as lab.layoutBounds() elements (Views with the resource name of their android:id)
      const found = await targetsFor(plugin, args?.target), index = found.selector.index;
      return withViewIdNames(plugin, index === null ? found.matches.slice(0, 200) : found.matches.slice(index, index + 1));
    }
    if (method === 'highlight') {   // lab.highlight: an outline on the device around the component(s) a target names (src/lab-highlight.js), following them frame by frame
      const action = actions?.highlight; if (typeof action !== 'function') throw Object.assign(new Error('lab.highlight não está disponível aqui.'), { code: 'unsupported' });
      const caller = { id: plugin.id, name: plugin.name }, op = String(args?.op ?? 'show');
      if (op !== 'show') return action(caller, { op, id: args?.id, options: args?.options });
      const found = await targetsFor(plugin, args?.target);
      if (!found.matches.length && args?.options?.required !== false) throw targetNotFound(found.selector);
      return action(caller, { op: 'show', id: args?.options?.id, selector: found.selector, elements: found.elements, options: args?.options });
    }
    if (method === 'layoutBounds') return (await layoutBoundsFor(plugin, { names: args?.names !== false })).map(elementOut);
    // ---- lab.renderVariant (src/render-variant.js, docs/RENDER-VARIANT.md): begin ---------------------------------------------------------------------------------------
    // The only way a background render starts. The page's own operation slot when it provides one (actions.renderVariant: user input waits), else the VM client's.
    if (method === 'renderVariant') {
      const run = typeof actions?.renderVariant === 'function' ? actions.renderVariant : typeof vm?.renderVariant === 'function' ? (_caller, options) => vm.renderVariant(options) : null;
      if (!run) throw Object.assign(new Error('lab.renderVariant não está disponível aqui.'), { code: 'unsupported' });
      const options = JSON.parse(JSON.stringify(args ?? {}));
      let result; try { result = await run({ id: plugin.id, name: plugin.name }, options); } catch (error) { throw Object.assign(error, { code: error?.code ?? (error?.kind === 'vm-busy' ? 'busy' : 'failed') }); }
      return encodeVariantImages(result, { type: options.type, pixels: options.pixels === true });
    }
    // ---- lab.renderVariant: end ------------------------------------------------------------------------------------------------------------------------------------------
    if (method === 'screenshot') {
      if (typeof captureImage !== 'function') throw Object.assign(new Error('Captura de imagem indisponível nesta página.'), { code: 'unsupported' });
      const wait = (plugin.lastShotAt ?? -Infinity) + SCREENSHOT_MS - now(); if (wait > 0) await new Promise(resolve => setTimer(resolve, wait));
      if (!plugin.worker) throw Object.assign(new Error('Plugin parado.'), { code: 'stopped' });
      plugin.lastShotAt = now();
      let element = null, named = null;
      if (args?.target !== undefined && args?.target !== null) {   // a component by id (src/lab-target.js): src/screen-capture.js cuts it from its raster (with `padding`, from every raster under the enlarged box) or, for a View the page draws with its DOM, images the page's element
        const found = await targetsFor(plugin, args.target), chosen = chooseTarget(found.matches, found.selector); if (!chosen) throw targetNotFound(found.selector);
        named = { element: chosen, matches: found.matches.length }; element = found.raw.find(item => item.key === chosen.key);
      } else if (args?.key) { element = (await layoutBoundsFor(plugin, { names: false })).find(item => item.key === String(args.key)) ?? null; if (!element) throw Object.assign(new Error(`Elemento ${String(args.key).slice(0, 60)} não está na tela (use lab.layoutBounds() para as chaves atuais).`), { code: 'not-found' }); }
      let region = null;
      if (args?.bounds !== undefined && args?.bounds !== null) {   // a box of the window: a layoutBounds element's bounds, a composeTree node's boundsInWindow, or a rectangle
        const b = args.bounds; if (![b?.left, b?.top, b?.right, b?.bottom].every(Number.isFinite) || !(b.right > b.left && b.bottom > b.top)) throw Object.assign(new Error('bounds precisa de { left, top, right, bottom } com área (coordenadas da janela).'), { code: 'bad-args' });
        region = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      }
      const shot = await captureImage({ snapshot: lastSnapshot, element: region ? null : element, region, padding: named ? args?.padding : 0, maxWidth: args?.maxWidth, type: args?.type });
      return named ? { ...shot, element: named.element, matches: named.matches } : shot;
    }
    if (!VM_METHODS.has(method)) throw Object.assign(new Error(`Método desconhecido: ${String(method).slice(0, 40)}`), { code: 'bad-query' });
    try { return await ask(plugin, method, args); }
    catch (error) { if (error?.code === 'no-apk' && EMPTY[method]) return EMPTY[method](); throw error; }
  }
  async function ask(plugin, method, args) {
    if (!vm?.worker && EMPTY[method]) return EMPTY[method]();
    plugin.stats.queries++;
    const safeArgs = JSON.parse(JSON.stringify(args ?? {}));
    if (method === 'composeTree') {
      const key = `composeTree:${safeArgs.maxNodes ?? ''}:${(safeArgs.locals ?? []).join(',')}`;
      if (cacheFrame === frame && cache.has(key)) { stats.cacheHits++; return cache.get(key); }
      const wait = plugin.lastComposeAt + COMPOSE_TREE_MS - now();
      if (wait > 0) await new Promise(resolve => setTimer(resolve, wait));
      if (!plugin.worker) throw Object.assign(new Error('Plugin parado.'), { code: 'stopped' });
      plugin.lastComposeAt = now();
      return cached(key, () => vmCall('composeTree', safeArgs));
    }
    if (UNCACHED_VM_METHODS.has(method)) return vmCall(method, safeArgs);
    return cached(`${method}:${JSON.stringify(safeArgs)}`, () => vmCall(method, safeArgs));
  }

  // ---- plugin Workers ---------------------------------------------------------------------------------------------------------------------------------------------
  function onMessage(plugin, data) {
    if (!data || typeof data !== 'object' || !plugin.worker) return;
    const t = now(); if (t - plugin.rate.at >= 1000) { plugin.rate.at = t; plugin.rate.count = 0; }
    if (++plugin.rate.count > MAX_MESSAGES_PER_SECOND) { plugin.stats.droppedMessages++; return; }
    switch (data.t) {
      case 'ready': plugin.release?.(); plugin.release = null; send(plugin, { t: 'start', id: plugin.id, name: plugin.name, code: plugin.code, info: { packageName: getPackage() ?? null } }); return;
      case 'started': plugin.status = 'rodando'; changed(plugin); return;
      case 'done': if (!data.ok) { plugin.status = 'erro'; if (data.phase === 'compile') stopWorker(plugin, 'erro'); } plugin.finished = true; changed(plugin); return;
      case 'error': record(plugin, plugin.errors, { phase: clipText(data.phase, 40), message: clipText(data.message, 2000), stack: clipText(data.stack, 4000), at: Date.now() }, MAX_ERRORS); plugin.errorCount++; if (data.phase === 'compile' || data.phase === 'run') plugin.status = 'erro'; changed(plugin); return;
      case 'console': record(plugin, plugin.console, { level: ['log', 'info', 'warn', 'error', 'debug'].includes(data.level) ? data.level : 'log', text: clipText(data.text, 2000), at: Date.now() }, MAX_CONSOLE); changed(plugin); return;
      case 'ui': applyUiOps(plugin.output, data.ops); changed(plugin); return;
      case 'clicked': {   // a button's handlers finished (errors were reported as 'error' messages before this)
        const id = String(data.id ?? ''), button = plugin.buttons.find(item => item.id === id), started = plugin.clickStarted.get(id) ?? now(); plugin.clickStarted.delete(id);
        if (button) button.busy = false;
        finishClicks(plugin, id, { ok: data.ok !== false, handlers: Number(data.handlers) || 0, ms: Math.round(now() - started), ...(data.ok === false ? { error: clipText(data.error, 400) } : {}) }); changed(plugin); return;
      }
      case 'sub': {
        const name = String(data.name); if (!['screen', 'log', 'network', 'refresh', 'modal', 'tab'].includes(name)) return;
        if (data.on) plugin.subs.add(name); else plugin.subs.delete(name);
        if (name === 'log') updateLogWanted();
        return;
      }
      case 'call': {
        const id = data.id; if (!Number.isSafeInteger(id)) return;
        if (plugin.pendingCalls >= MAX_PENDING_CALLS) { send(plugin, { t: 'reply', id, ok: false, error: { code: 'busy', message: `Mais de ${MAX_PENDING_CALLS} consultas pendentes neste plugin; aguarde as respostas.` } }); return; }
        plugin.pendingCalls++;
        serve(plugin, String(data.method), data.args).then(value => send(plugin, { t: 'reply', id, ok: true, value }), error => send(plugin, { t: 'reply', id, ok: false, error: { code: error?.code ?? 'failed', message: clipText(error?.message ?? error, 400) } }))
          .finally(() => { plugin.pendingCalls--; });
        return;
      }
      default: return;
    }
  }
  function startWorker(plugin) {
    if (plugin.worker) return;
    let created;
    try { created = createWorker(plugin.name); } catch (error) { plugin.status = 'erro'; record(plugin, plugin.errors, { phase: 'worker', message: clipText(error?.message ?? error, 2000), stack: '', at: Date.now() }, MAX_ERRORS); changed(plugin); return; }
    Object.assign(plugin, { worker: created.worker, release: created.release ?? null, status: 'iniciando', subs: new Set(), pendingCalls: 0, finished: false, lastComposeAt: -Infinity, startedAt: Date.now(), rate: { at: now(), count: 0 } });
    plugin.output = { blocks: [], badge: '' }; plugin.buttons = []; plugin.buttonSeq = 0; plugin.clickStarted = new Map(); stats.workersStarted++;
    const worker = created.worker;
    worker.onmessage = event => { if (plugin.worker === worker) onMessage(plugin, event.data); };
    worker.onerror = event => { if (plugin.worker !== worker) return; event?.preventDefault?.(); record(plugin, plugin.errors, { phase: 'worker', message: clipText(event?.message || 'O Worker do plugin falhou (erro de módulo ou de memória).', 2000), stack: '', at: Date.now() }, MAX_ERRORS); plugin.errorCount++; stopWorker(plugin, 'erro'); };
    worker.onmessageerror = () => { if (plugin.worker === worker) { plugin.stats.droppedMessages++; } };
    changed(plugin);
  }
  function stopWorker(plugin, status = 'parado') {
    const worker = plugin.worker;
    if (worker) { plugin.worker = null; try { worker.terminate(); } catch { /* already gone */ } plugin.release?.(); plugin.release = null; }
    plugin.subs = new Set(); plugin.pendingCalls = 0; plugin.status = status;
    plugin.buttons = []; plugin.clickStarted = new Map(); finishClicks(plugin, null, { ok: false, reason: 'stopped' });   // a stopped plugin offers no button
    updateLogWanted(); changed(plugin);
  }
  const normalize = item => ({ id: String(item.id), name: String(item.name ?? 'Plugin').slice(0, 120), code: String(item.code ?? ''), enabled: !!item.enabled, packageFilter: String(item.packageFilter ?? '') });
  function blank(item) {
    return { ...normalize(item), worker: null, release: null, status: 'parado', reason: '', subs: new Set(), output: { blocks: [], badge: '' }, buttons: [], buttonSeq: 0, clickWaiters: new Map(), clickStarted: new Map(), console: [], errors: [], errorCount: 0, pendingCalls: 0, finished: false, userStopped: false,
      lastComposeAt: -Infinity, startedAt: null, rate: { at: 0, count: 0 }, stats: { queries: 0, logLines: 0, logDropped: 0, droppedMessages: 0 } };
  }
  /** Starts / stops the plugins so that exactly the enabled ones whose package filter matches the open package run (unless the user stopped one on its card). */
  function reconcile() {
    const pkg = getPackage() ?? null;
    for (const plugin of plugins.values()) {
      const should = plugin.enabled && !plugin.userStopped && packageMatches(plugin.packageFilter, pkg);
      plugin.reason = !plugin.enabled ? 'desligado' : plugin.userStopped ? 'parado no painel' : !packageMatches(plugin.packageFilter, pkg) ? (pkg ? `só para ${plugin.packageFilter}` : 'aguardando um APK do pacote') : '';
      if (should && !plugin.worker && plugin.status !== 'erro') startWorker(plugin);
      else if (!should && plugin.worker) stopWorker(plugin);
      else changed(plugin);
    }
  }

  return {
    /** The panel's list ([{ id, name, code, enabled, packageFilter }], in order): new plugins are added, removed ones stopped, edited code restarts a running plugin. */
    setPlugins(list) {
      const next = new Map();
      for (const item of Array.isArray(list) ? list : []) {
        if (!item?.id) continue; const data = normalize(item); let plugin = plugins.get(data.id);
        if (!plugin) plugin = blank(data);
        else {
          const restart = plugin.worker && (plugin.code !== data.code || plugin.name !== data.name);
          if (plugin.enabled !== data.enabled || plugin.code !== data.code) { plugin.userStopped = false; if (plugin.status === 'erro' && !plugin.worker) plugin.status = 'parado'; }
          Object.assign(plugin, data); if (restart) stopWorker(plugin);
        }
        next.set(data.id, plugin);
      }
      for (const [id, plugin] of plugins) if (!next.has(id)) { stopWorker(plugin); }
      plugins.clear(); for (const [id, plugin] of next) plugins.set(id, plugin);
      reconcile();
    },
    /** Parar on the card: stays stopped until Reiniciar (or the plugin is edited / toggled). */
    stop(id) { const plugin = plugins.get(id); if (!plugin) return; plugin.userStopped = true; stopWorker(plugin); plugin.reason = 'parado no painel'; changed(plugin); },
    /** A query from the page itself (the MCP bridge, src/mcp-tools.js): the same broker, cache and limits as a plugin's lab.* calls, as a plugin of its own that never stops. */
    query(method, args = {}) { return serve(pageCaller, String(method), args ?? {}); },
    /** Atualizar on the card: the plugin's lab.on('refresh') handlers run (a plugin that reads on demand recomputes). Returns whether the plugin listens. */
    refresh(id) { const plugin = plugins.get(id); if (!plugin?.worker || !plugin.subs.has('refresh')) return false; send(plugin, { t: 'event', name: 'refresh', data: { at: Date.now() } }); stats.events++; return true; },
    /** An event for one plugin (a modal's message or its closing): delivered only while the plugin listens. */
    emit(id, name, data) { const plugin = plugins.get(id); if (!plugin?.worker || !plugin.subs.has(name)) return false; send(plugin, { t: 'event', name, data }); stats.events++; return true; },
    /**
     * A click on a plugin's button (the panel, the preview bar, the MCP click_plugin_button tool): the plugin's handlers run in its Worker; the button is busy until they
     * finish and a click on a busy, disabled or unknown button is ignored. -> Promise<{ ok, handlers, ms, error? } | { ok: false, reason: 'not-found'|'stopped'|'busy'|'disabled'|'removed' }>.
     */
    clickButton(id, buttonKey, { by = 'user' } = {}) {
      const plugin = plugins.get(String(id)); if (!plugin) return Promise.resolve({ ok: false, reason: 'not-found' });
      if (!plugin.worker) return Promise.resolve({ ok: false, reason: 'stopped' });
      const button = plugin.buttons.find(item => item.id === String(buttonKey)); if (!button) return Promise.resolve({ ok: false, reason: 'not-found' });
      if (button.disabled) return Promise.resolve({ ok: false, reason: 'disabled' });
      if (button.busy) return Promise.resolve({ ok: false, reason: 'busy' });
      button.busy = true; button.clicks = (button.clicks ?? 0) + 1; plugin.clickStarted.set(button.id, now());
      const done = new Promise(resolve => { const list = plugin.clickWaiters.get(button.id) ?? []; list.push(resolve); plugin.clickWaiters.set(button.id, list); });
      send(plugin, { t: 'click', id: button.id, by: by === 'mcp' ? 'mcp' : 'user' }); stats.events++; changed(plugin);
      return done;
    },
    /** Reiniciar: a fresh Worker with empty output (also after an error). */
    restart(id) { const plugin = plugins.get(id); if (!plugin) return; stopWorker(plugin); plugin.userStopped = false; plugin.status = 'parado'; plugin.console = []; plugin.errors = []; plugin.errorCount = 0; reconcile(); },
    /** The page drew a snapshot (device-view `rendered`). Without running plugins this only keeps the reference. */
    snapshot(snapshot) {
      lastSnapshot = snapshot ?? null;
      if (!plugins.size) return;
      frame++; if (!running().length) return;
      const next = currentScreen(), sig = screenKey(next);
      if (sig !== screenSig) { screenSig = sig; for (const plugin of subscribed('screen')) send(plugin, { t: 'event', name: 'screen', data: next }); stats.events++; }
    },
    /** A Logcat batch from the Worker (the same message the Logcat panel gets). */
    logcat(message) {
      if (!wantsLogs || !Array.isArray(message?.rows) || message.count) return;
      if (message.reset && Number.isFinite(message.total) && message.total <= lastLogSeq) lastLogSeq = -1;   // a cleared log (another APK): sequence numbers restart; a reset that re-sends the ring tail (the Logcat panel opened) keeps them
      for (const row of message.rows) {
        const seq = Number(row?.[0]); if (!(seq > lastLogSeq)) continue; lastLogSeq = seq;
        logBuffer.push({ seq, uptime: row[1], wall: row[2], pid: row[3], tid: row[4], thread: row[5], level: row[6], tag: row[7], message: row[8] });
      }
      if (logBuffer.length > MAX_LOG_BATCH) { logDropped += logBuffer.length - MAX_LOG_BATCH; logBuffer = logBuffer.slice(logBuffer.length - MAX_LOG_BATCH); }
      if (logBuffer.length) scheduleEvents();
    },
    /** A network-log batch from the Worker (src/netlog.js): new and updated entries, merged by seq until the next flush. */
    netlog(message) {
      if (!Array.isArray(message?.rows) || !message.rows.length) return;
      if (!plugins.size || !subscribed('network').length) return;
      for (const row of message.rows) { if (row && Number.isFinite(row.seq)) netPending.set(row.seq, row); }
      if (netPending.size > MAX_LOG_BATCH) netPending = new Map([...netPending].slice(-MAX_LOG_BATCH));
      scheduleEvents();
    },
    /** A new APK / VM (or the VM ended): caches go, the log sequence restarts, plugins with a package filter are started or stopped, and listeners get the new screen. */
    vmChanged() {
      lastLogSeq = -1; cache.clear(); cacheFrame = -1; frame++; lastSnapshot = null; screenSig = null; reconcile();
      if (wantsLogs) { try { onLogStreaming(true); } catch { /* best effort */ } }
    },
    get wantsLogs() { return wantsLogs; },
    /** Read model for the panel: [{ id, name, enabled, packageFilter, status, reason, output, console, errors, errorCount, subs, stats }]. */
    list() { return [...plugins.values()]; },
    get(id) { return plugins.get(id) ?? null; },
    get runningCount() { return running().length; },
    get stats() { return { ...stats, queued: vmQueue.length, running: running().length }; },
    dispose() { for (const plugin of plugins.values()) stopWorker(plugin); plugins.clear(); if (eventTimer !== null) clearTimer(eventTimer); eventTimer = null; if (vmTimer !== null) clearTimer(vmTimer); vmTimer = null; },
  };
}
