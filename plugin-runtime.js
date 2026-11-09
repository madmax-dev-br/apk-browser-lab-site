// The runtime of a page plugin (docs/PLUGINS.md). Each enabled plugin runs in its own dedicated module Worker made from a Blob of `pluginWorkerSource()`: this runtime plus
// nothing else; the user's code arrives in the 'start' message and is compiled there as the body of an async function. A slow or looping plugin blocks only its own
// Worker (the page terminates it with Parar), never the page or the VM Worker. The plugin sees the global `lab` object below; everything it asks goes to the page
// (src/plugin-host.js), which answers from what it already has (the screen of the last drawn frame, Logcat and network batches) or with a read-only, rate-limited query
// of the VM (src/plugin-queries.js). It is the user's own code with the page's origin: it can use fetch like any script of the page; the lab adds no network permission.
//
/**
 * @typedef {object} Lab  The `lab` global of a plugin.
 * @property {(name: 'screen'|'log'|'network', fn: Function) => () => void} on   Subscribes; returns the unsubscribe function. 'screen': the active screen changed
 *   ({ activity, activityStack, windows: [{ id, kind, modal, visible, focused }], dialogs, canGoBack, closed, packageName, frame }). 'log': a batch (array) of Logcat
 *   entries { seq, uptime, wall, pid, tid, thread, level, tag, message }. 'network': a batch of network log entries (src/netlog.js), new or updated. Batches come at most
 *   every 250 ms, and Logcat lines reach the page only while some plugin listens to 'log' (or the Logcat panel is open).
 * @property {(name: string, fn?: Function) => void} off
 * @property {() => Promise<object>} screen          The current screen (same shape as the 'screen' event); no VM work. `screen.ready` is "Tela pronta" (src/screen-ready.js):
 *   { ready, activity, readySince, waitingFor: [motivos], fragments: [{ className, state, hidden, ready }] } — the Activity and its fragments loaded and the screen is still.
 *   lab.on('ready', fn) calls fn(screen) each time it turns ready (a new Activity, a reload, a navigation that settles).
 * @property {(options?: { timeoutMs?: number }) => Promise<object>} waitReady   Resolves with the screen once it is ready (rejects with code 'timeout', 15 s by default).
 * @property {(options?: { maxNodes?: number }) => Promise<object>} composeTree   The Compose layout tree: { owners: [{ nodes: [{ id, parentId, depth, name, bounds, texts,
 *   editableText, role, testTag, actions, ... }] }], totalNodes, truncated }. At most once per second per plugin; the same frame answers from a cache.
 * @property {(options?: { names?: boolean }) => Promise<object[]>} layoutBounds   The boxes "Mostrar limites de layout" draws: [{ key, kind: 'compose'|'view', name, nameSource,
 *   bounds (window px), size, texts, editableText, role, testTag, contentDescriptions, actions, modifiers, measurePolicy, type, hasImage }]. Names come from one composeTree (same rate limit).
 * @property {(options?: { key?: string, maxWidth?: number, type?: string }) => Promise<{ blob: Blob, width: number, height: number, type: string, notes: string[] }>} screenshot
 *   An image of the screen, or of one element (`key` from layoutBounds), cut from the frame the page shows. At most one every 500 ms per plugin.
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
 * @property {(handle: string|{ static: string }, path: string|string[], fn: (value: any, previous: any) => void, options?: { intervalMs?: number, depth?: number, onError?: Function }) => () => void} watch
 *   Polls `field(handle, path)` every intervalMs (>= 250) and calls fn only when the value changed; returns the stop function. A collected object stops the watch.
 * @property {{ text(s: string, o?: {id?: string}): void, kv(obj: object, o?: {id?: string}): void, table(rows: object[], columns?: string[], o?: {id?: string}): void,
 *   json(value: any, o?: {id?: string}): void, image(blobOrScreenshot: Blob|{blob: Blob}, o?: {id?: string, caption?: string}): void, clear(): void, badge(s: string): void }} ui   Output of the plugin's panel. Each call adds a block; a block with the same `id`
 *   is replaced in place. Rendered as text only (no HTML), at most ~10 times a second.
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
  const wrapError = error => Object.assign(new Error(error?.message ?? 'Falha na consulta.'), { code: error?.code ?? 'failed' });
  const watches = new Set(), readyWrappers = new Map();
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
      if (!['screen', 'log', 'network'].includes(name)) throw new TypeError(`Evento desconhecido: ${name} (use 'screen', 'ready', 'log' ou 'network')`);
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
    async waitReady(options = {}) {   // resolves with the screen once "Tela pronta" holds; rejects with code 'timeout' (default 15 s)
      const until = Date.now() + Math.max(100, Number(options?.timeoutMs) || 15000);
      for (;;) { const screen = await lab.screen(); if (screen?.ready?.ready) return screen; if (Date.now() >= until) throw Object.assign(new Error(`A tela não ficou pronta: ${(screen?.ready?.waitingFor ?? ['sem informação']).join('; ')}`), { code: 'timeout', screen }); await new Promise(resolve => setTimeout(resolve, 100)); }
    },
    composeTree: (options = {}) => call('composeTree', { maxNodes: options?.maxNodes }),
    layoutBounds: (options = {}) => call('layoutBounds', { names: options?.names !== false }),
    screenshot: (options = {}) => call('screenshot', { key: options?.key ?? null, maxWidth: options?.maxWidth, type: options?.type }),
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
    sleep: ms => new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0))),
    ui,
    info: Object.freeze({ id: '', name: '', packageName: null }),
  };
  scope.lab = lab;
  scope.onmessage = async ({ data }) => {
    if (!data || typeof data !== 'object') return;
    if (data.t === 'reply') { const waiter = pending.get(data.id); if (!waiter) return; pending.delete(data.id); if (data.ok) waiter.resolve(data.value); else waiter.reject(wrapError(data.error)); return; }
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

/** Starting points of "+ Adicionar". The code is plain plugin code (the body of an async function with `lab` in scope). */
export const PLUGIN_TEMPLATES = [
  { id: 'screen', name: 'Tela atual', description: 'Mostra a Activity, as janelas e os fragments a cada mudança de tela.', code: `// Tela atual: mostra a tela ativa a cada mudança (sem custo na VM; os fragments são uma leitura de campos).
async function mostrar(tela) {
  lab.ui.badge(tela.activity ? tela.activity.split('.').pop() : '—');
  lab.ui.kv({
    Activity: tela.activity ?? '—',
    Pilha: tela.activityStack.join(' › ') || '—',
    Janelas: tela.windows.map(j => j.kind + (j.modal ? ' (modal)' : '')).join(', ') || 'só a Activity',
    Voltar: tela.canGoBack ? 'sim' : 'não',
  }, { id: 'tela' });
  try {
    const fragments = await lab.fragments(), linhas = [];
    const percorrer = (lista, nivel) => { for (const f of lista) { linhas.push({ nível: nivel, classe: f.className.split('.').pop(), tag: f.tag ?? '', oculto: f.hidden ? 'sim' : '' }); percorrer(f.children, nivel + 1); } };
    percorrer(fragments, 0);
    if (linhas.length) lab.ui.table(linhas, ['nível', 'classe', 'tag', 'oculto'], { id: 'fragments' }); else lab.ui.text('Sem fragments androidx nesta tela.', { id: 'fragments' });
  } catch (erro) { lab.ui.text('Fragments: ' + erro.message, { id: 'fragments' }); }
}
lab.on('screen', mostrar);
mostrar(await lab.screen());
` },
  { id: 'logs', name: 'Logs filtrados', description: 'Linhas do Logcat que casam com uma expressão regular.', code: `// Logs filtrados: as linhas do Logcat cuja tag ou mensagem casam com FILTRO.
const FILTRO = /erro|error|exception|warn/i;   // edite a expressão
const MAXIMO = 100;
const linhas = []; let total = 0;
lab.on('log', lote => {
  for (const linha of lote) {
    if (!FILTRO.test(linha.tag + ' ' + linha.message)) continue;
    total++; linhas.push({ hora: new Date(linha.wall).toLocaleTimeString(), nível: linha.level, tag: linha.tag, mensagem: linha.message });
  }
  if (linhas.length > MAXIMO) linhas.splice(0, linhas.length - MAXIMO);
  lab.ui.badge(String(total));
  lab.ui.table(linhas.slice().reverse(), ['hora', 'nível', 'tag', 'mensagem'], { id: 'linhas' });
});
lab.ui.text('Esperando linhas que casem com ' + FILTRO + '…', { id: 'linhas' });
` },
  { id: 'viewmodel', name: 'Observar ViewModel', description: 'O primeiro ViewModel do app na tela, com um campo (ou todos) ao vivo.', code: `// Observar ViewModel: o primeiro ViewModel do app na tela ativa (Activity, fragments, destinos de navegação) e um campo ao vivo.
const CAMPO = '';          // vazio: todos os campos; ou um caminho, como 'contador', 'estado.value' ou 'itens.size'
const INTERVALO_MS = 250;  // leitura a cada 250 ms (só o que mudou é mostrado)
let parar = null, atual = null;
const resumo = valor => valor === null || typeof valor !== 'object' ? valor
  : valor.$kind === 'MutableState' || valor.$kind === 'StateFlow' || valor.$kind === 'LiveData' || valor.$kind === 'Atomic' ? resumo(valor.value)
  : valor.$kind === 'list' || valor.$kind === 'set' || valor.$kind === 'array' ? \`[\${valor.size}] \` + valor.items.slice(0, 5).map(item => JSON.stringify(resumo(item))).join(', ')
  : valor.$kind === 'map' ? \`{\${valor.size}}\` : valor.$kind === 'enum' ? valor.name
  : valor.fields ? Object.fromEntries(Object.entries(valor.fields).map(([nome, item]) => [nome, resumo(item)])) : valor.$type;
async function conectar() {
  const lista = await lab.viewModels();
  const escolhido = lista.find(vm => !vm.library) ?? lista[0];
  if (escolhido?.handle === atual) return;
  parar?.(); parar = null; atual = escolhido?.handle ?? null;
  if (!escolhido) { lab.ui.clear(); lab.ui.text('Nenhum ViewModel na tela ativa.'); lab.ui.badge('—'); return; }
  lab.ui.clear(); lab.ui.badge(escolhido.className.split('.').pop());
  lab.ui.kv({ ViewModel: escolhido.className, Dono: escolhido.owner.label, Outros: lista.filter(vm => vm !== escolhido).map(vm => vm.className.split('.').pop()).join(', ') || '—' }, { id: 'cabecalho' });
  parar = lab.watch(escolhido.handle, CAMPO, valor => {
    if (CAMPO) lab.ui.json(resumo(valor), { id: 'valor' });
    else lab.ui.kv(Object.fromEntries(Object.entries(valor.fields ?? {}).map(([nome, item]) => [nome.replace(/\\$delegate$/, ''), resumo(item)])), { id: 'valor' });
  }, { intervalMs: INTERVALO_MS, depth: CAMPO ? 2 : 3, onError: erro => { if (erro.code === 'collected') { atual = null; conectar(); } } });
}
lab.on('screen', () => conectar().catch(erro => lab.ui.text(erro.message, { id: 'erro' })));
setInterval(() => conectar().catch(() => {}), 2000);   // um destino do Navigation na mesma Activity traz os seus ViewModels
await conectar();
` },
  { id: 'components', name: 'Componentes da tela', description: 'As caixas de "Mostrar limites de layout" com nome, posição e o recorte de cada uma.', code: `// Componentes da tela: as caixas de "Mostrar limites de layout", com o recorte de cada uma
// (lab.screenshot corta do quadro que a página mostra; no máximo um recorte a cada 500 ms, então só os primeiros LIMITE ganham imagem).
const LIMITE = 8;
let rodada = 0;
async function mostrar() {
  const minha = ++rodada;
  const caixas = (await lab.layoutBounds()).filter(caixa => caixa.kind === 'compose');
  lab.ui.clear(); lab.ui.badge(String(caixas.length));
  lab.ui.table(caixas.map(caixa => ({ nome: caixa.name, x: caixa.bounds.left, y: caixa.bounds.top, largura: caixa.size.width, altura: caixa.size.height, tag: caixa.testTag ?? '' })), ['nome', 'x', 'y', 'largura', 'altura', 'tag'], { id: 'lista' });
  for (const caixa of caixas.slice(0, LIMITE)) {
    if (minha !== rodada) return;   // a tela mudou: a próxima rodada recomeça
    try { lab.ui.image(await lab.screenshot({ key: caixa.key, maxWidth: 360 }), { id: caixa.key, caption: caixa.name }); }
    catch (erro) { lab.ui.text(caixa.name + ': ' + erro.message, { id: caixa.key }); }
  }
}
lab.on('screen', () => mostrar().catch(erro => lab.ui.text(erro.message, { id: 'erro' })));
await mostrar();
` },
  { id: 'compose', name: 'Árvore Compose resumida', description: 'Os elementos do Compose com texto, papel ou testTag.', code: `// Árvore Compose resumida: só os nós com texto, papel (Role) ou testTag. A árvore custa algumas dezenas de ms na VM: no máximo uma leitura por segundo.
async function mostrar() {
  const arvore = await lab.composeTree();
  const nos = arvore.owners.flatMap(dono => dono.nodes).filter(no => no.texts.length || no.editableText !== null || no.role || no.testTag);
  lab.ui.badge(\`\${nos.length}/\${arvore.totalNodes} nós\`);
  if (!arvore.owners.length) { lab.ui.text('A tela não tem Compose.', { id: 'arvore' }); return; }
  lab.ui.table(nos.slice(0, 150).map(no => ({ nível: no.depth, nome: no.name, texto: (no.editableText ?? no.texts.join(' ')).slice(0, 60), tag: no.testTag ?? '', ações: no.actions.join(' ') })), ['nível', 'nome', 'texto', 'tag', 'ações'], { id: 'arvore' });
}
lab.on('screen', () => mostrar().catch(() => {}));
setInterval(() => mostrar().catch(() => {}), 2000);
await mostrar();
` },
];
