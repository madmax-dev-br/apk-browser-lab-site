// Background render of a screen variant (Worker request `render-variant`, APKWorkerClient.renderVariant, lab.renderVariant; docs/RENDER-VARIANT.md): a second instance of the
// Activity on top is started inside the running VM with the same Intent, a set of endpoint mocks is put in front of the lab's for as long as it lives, it runs until its
// screen is still (or a timeout), its window is composed into one RGBA image from the content rasters the page would draw, and it is destroyed. The process is reused: the
// Application, the loaded classes, every singleton and static are the ones the visible screen uses. Nothing here runs unless the request is made.
//
// What the app sees is one of two things Android itself does (the caller chooses):
//   'display' (default)  the instance is the only Activity of a new task that is not on the screen the user sees, as a start with ActivityOptions.setLaunchDisplayId on a
//                        secondary display: since Android 10 (multi-resume) the Activity on the default display stays resumed, so the visible Activity gets no callback at all.
//                        The instance is created with onCreate(null). The lab models no second Display object: the instance's Context reports the device's display and metrics.
//   'cover'              the visible Activity is left as when its task goes to the background: onPause, onSaveInstanceState and onStop (in the order of its targetSdk), then the
//                        instance runs in its own task, and after it is destroyed the visible Activity gets onRestart, onStart, onResume. With restoreState the instance is
//                        created with the Bundle the visible Activity just saved (onCreate(saved), onRestoreInstanceState), as an Activity is after its process was recreated:
//                        in-Activity navigation and saveable state are where the user is; ViewModels are new and load again.
// Limits that come from running in the same process (stated in the result and the docs, not hidden):
//   - requests cannot be attributed to an Activity instance (they are made by pool threads): the variant's mocks answer every matching request of the app while the instance
//     lives, and what a mocked answer writes into shared state (a repository cache, a StateFlow, a database, preferences) stays there and reaches the visible screen;
//   - host code that asks for "the current Activity" gets the background instance while it lives; the visible window is not drawn in that time and is redrawn afterwards;
//   - a startActivity made by the background instance is dropped (reported in droppedStarts); one made by an Activity of the visible stack waits for the end of the render;
//   - page input is not processed while the render runs (the Worker holds its one-operation slot, as during a launch or a click).
// DOM-free, no process.*.
import { validateMock, mockLabel, MAX_MOCKS } from './endpoint-mocks.js?v=a9e9656b8d6c';
import { readinessProbe, waitingFor, READY_QUIET_MS } from './screen-ready.js?v=a9e9656b8d6c';

const ACTIVITY = 'Landroid/app/Activity;', BUNDLE = 'Landroid/os/Bundle;';
export const VARIANT_MODES = Object.freeze(['display', 'cover']);
export const VARIANT_TIMEOUT_MS = 5000, VARIANT_MIN_TIMEOUT_MS = 50, VARIANT_MAX_TIMEOUT_MS = 15000, VARIANT_MAX_QUIET_MS = 2000, VARIANT_MAX_SIDE = 4096, VARIANT_MAX_LIST = 400, VARIANT_MAX_CROPS = 24, VARIANT_MAX_IMAGES = 32;
// The selector of a crop: the words the lab's own queries use for an element (lab.composeTree nodes and lab.layoutBounds elements): the composable's name, its semantics, or a View's resource id.
export const SELECTOR_KEYS = Object.freeze(['name', 'testTag', 'text', 'contentDescription', 'role', 'viewId']);
export class RenderVariantError extends Error { constructor(code, message) { super(message); this.name = 'RenderVariantError'; this.code = code; } }
const fail = (code, message) => { throw new RenderVariantError(code, message); };
const dotted = type => String(type ?? '').slice(1, -1).replaceAll('/', '.');
const finite = values => values.every(Number.isFinite);
let serial = 0;

/** The request's options, checked: { mode, restoreState, timeoutMs, quietMs, mocks [{ mock, compiled }], crops [{ rect } | { selector, all, index }], tree, image }. Throws RenderVariantError('bad-args'). */
export function variantOptions(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const mode = o.mode === undefined || o.mode === null ? 'display' : String(o.mode);
  if (mode === 'worker') fail('unsupported', 'mode "worker" (uma segunda VM do mesmo APK) não existe: o estado em memória do processo não pode ser copiado para outra VM. Use "display" ou "cover".');
  if (!VARIANT_MODES.includes(mode)) fail('bad-args', `mode inválido: use ${VARIANT_MODES.join(' ou ')}.`);
  const restoreState = o.restoreState === true;
  if (restoreState && mode !== 'cover') fail('bad-args', 'restoreState só existe com mode "cover": o estado só é salvo por onSaveInstanceState quando a Activity visível sai da frente.');
  const number = (value, fallback, min, max, name) => { if (value === undefined || value === null) return fallback; const n = Number(value); if (!Number.isFinite(n)) fail('bad-args', `${name} precisa ser um número.`); return Math.min(max, Math.max(min, n)); };
  const timeoutMs = number(o.timeoutMs, VARIANT_TIMEOUT_MS, VARIANT_MIN_TIMEOUT_MS, VARIANT_MAX_TIMEOUT_MS, 'timeoutMs'), quietMs = number(o.quietMs, READY_QUIET_MS, 0, VARIANT_MAX_QUIET_MS, 'quietMs');
  const list = o.endpointMocks === undefined || o.endpointMocks === null ? [] : o.endpointMocks;
  if (!Array.isArray(list) || list.length > MAX_MOCKS) fail('bad-args', `endpointMocks precisa ser uma lista de até ${MAX_MOCKS} mocks.`);
  const mocks = [];
  list.forEach((item, index) => {
    const { errors, compiled, mock } = validateMock(item);
    if (errors.length) fail('bad-args', `endpointMocks[${index}]: ${errors.map(e => e.message).join(' ')}`);
    if (mock.enabled) mocks.push({ mock: { ...mock, id: typeof item?.id === 'string' ? mock.id : `v${index}` }, compiled });
  });
  // crops: boxes or elements of the variant's screen, each cut from the one render. `crop` is the same with one entry.
  const wanted = o.crops !== undefined && o.crops !== null ? o.crops : o.crop !== undefined && o.crop !== null ? [o.crop] : [];
  if (!Array.isArray(wanted) || wanted.length > VARIANT_MAX_CROPS) fail('bad-args', `crops precisa ser uma lista de até ${VARIANT_MAX_CROPS} recortes.`);
  const crops = wanted.map((c, index) => {
    const rect = c?.rect, selector = c?.selector;
    if (rect && typeof rect === 'object') {
      if (!finite([rect.left, rect.top, rect.right, rect.bottom]) || !(rect.right > rect.left && rect.bottom > rect.top)) fail('bad-args', `crops[${index}].rect precisa de { left, top, right, bottom } com área (coordenadas da janela).`);
      return { rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } };
    }
    if (selector && typeof selector === 'object') {
      const keys = SELECTOR_KEYS.filter(key => selector[key] !== undefined && selector[key] !== null);
      if (!keys.length || Object.keys(selector).some(key => !SELECTOR_KEYS.includes(key))) fail('bad-args', `crops[${index}].selector aceita ${SELECTOR_KEYS.join(', ')} (ao menos um; todos os informados precisam casar).`);
      const nth = c.index === undefined || c.index === null ? null : Number(c.index);
      if (nth !== null && !(Number.isInteger(nth) && nth >= 0)) fail('bad-args', `crops[${index}].index precisa ser um inteiro >= 0.`);
      return { selector: Object.fromEntries(keys.map(key => [key, key === 'viewId' && Number.isInteger(selector.viewId) ? selector.viewId : String(selector[key]).slice(0, 400)])), all: c.all === true, index: nth };
    }
    return fail('bad-args', `crops[${index}] precisa de { rect } ou { selector }.`);
  });
  const tree = o.tree === true || crops.some(crop => crop.selector?.name !== undefined), image = o.image === undefined || o.image === null ? !crops.length : o.image === true;
  return { mode, restoreState, timeoutMs, quietMs, mocks, crops, tree, treeAsked: o.tree === true, image };
}

// ---- the window as one image ---------------------------------------------------------------------------------------------------------------------------------------------------

/** The Views of one window of a snapshot, flattened with window coordinates (dp): { view, left, top, right, bottom, visible }. */
function flattenWindow(root) {
  const out = [], visit = (view, x, y, shown, depth) => {
    if (!view || out.length >= 4096 || depth > 96) return;
    const b = view.bounds ?? null, left = b ? x + b.left : x, top = b ? y + b.top : y, visible = shown && (view.visibility ?? 0) === 0;
    out.push({ view, left, top, right: b ? left + (b.right - b.left) : left, bottom: b ? top + (b.bottom - b.top) : top, laidOut: !!b, visible });
    for (const child of view.children ?? []) visit(child, left, top, visible, depth + 1);
  };
  visit(root, 0, 0, true, 0); return out;
}
/** Source-over of unpremultiplied RGBA8 `source` (sw x sh) into `target` (tw x th) at the destination box (nearest sampling when the sizes differ). */
function blit(target, tw, th, source, sw, sh, dx, dy, dw, dh) {
  const x0 = Math.max(0, Math.round(dx)), y0 = Math.max(0, Math.round(dy)), x1 = Math.min(tw, Math.round(dx + dw)), y1 = Math.min(th, Math.round(dy + dh));
  if (!(dw > 0 && dh > 0)) return;
  const fx = sw / dw, fy = sh / dh;
  for (let y = y0; y < y1; y++) {
    const sy = Math.min(sh - 1, Math.max(0, Math.floor((y + 0.5 - dy) * fy))), row = sy * sw * 4, out = y * tw * 4;
    for (let x = x0; x < x1; x++) {
      const s = row + Math.min(sw - 1, Math.max(0, Math.floor((x + 0.5 - dx) * fx))) * 4, a = source[s + 3]; if (a === 0) continue;
      const t = out + x * 4;
      if (a === 255) { target[t] = source[s]; target[t + 1] = source[s + 1]; target[t + 2] = source[s + 2]; target[t + 3] = 255; continue; }
      const ta = target[t + 3], sa = a / 255, da = ta / 255 * (1 - sa), oa = sa + da;
      target[t] = Math.round((source[s] * sa + target[t] * da) / oa); target[t + 1] = Math.round((source[s + 1] * sa + target[t + 1] * da) / oa); target[t + 2] = Math.round((source[s + 2] * sa + target[t + 2] * da) / oa); target[t + 3] = Math.round(oa * 255);
    }
  }
}
/**
 * One RGBA8 image of the windows `roots` (snapshot views: the Activity window first, then its dialogs), cut to `area` (dp, window coordinates; null = the Activity window):
 * the window background colour and every content raster, as the page layers them. Views the page draws with its own DOM (plain widgets: text, backgrounds) have no raster and
 * are not in the image; `notes` says how many. Returns { image: { width, height, scale, pixels: Uint8ClampedArray } | null, area, window, notes }.
 */
export function composeWindows(roots, area = null) {
  const notes = [], main = roots[0] ?? null, bounds = main?.bounds ?? null;
  if (!bounds || !(bounds.right > bounds.left && bounds.bottom > bounds.top)) return { image: null, area: null, window: null, notes: ['a janela ainda não foi medida: sem imagem'] };
  const window = { width: bounds.right - bounds.left, height: bounds.bottom - bounds.top };
  const layers = []; let background = null, domViews = 0, unsupported = 0;
  for (const root of roots) {
    const surface = root.windowSurface ?? null; if (surface && surface.visible === false) continue;
    const ox = (surface?.x ?? 0) - (root.bounds?.left ?? 0), oy = (surface?.y ?? 0) - (root.bounds?.top ?? 0);
    if (root === main) { const color = root.windowBackground; if (color?.kind === 'color' && Number.isFinite(color.argb)) background = color.argb >>> 0; else if (color) notes.push('o fundo da janela não é uma cor sólida e não foi desenhado'); }
    let covered = null;
    for (const item of flattenWindow(root)) {
      if (!item.visible || !item.laidOut) continue;
      const raster = item.view.contentRaster;
      if (raster) {
        if (raster.kind === 'rgba-raster' && raster.pixels && raster.width > 0 && raster.height > 0) layers.push({ raster, left: item.left + ox, top: item.top + oy, right: item.right + ox, bottom: item.bottom + oy });
        else unsupported++;
        if (/AndroidComposeView;$/.test(String(item.view.type ?? ''))) covered = item;
        continue;
      }
      const inside = covered && item.left >= covered.left && item.top >= covered.top && item.right <= covered.right && item.bottom <= covered.bottom;
      if (!inside && item.view !== root && ((typeof item.view.text === 'string' && item.view.text) || item.view.background || item.view.drawableSVG || item.view.textRaster)) domViews++;
    }
  }
  if (unsupported) notes.push(`${unsupported} ${unsupported === 1 ? 'raster não está' : 'rasters não estão'} em RGBA na VM e não ${unsupported === 1 ? 'aparece' : 'aparecem'} na imagem`);
  if (domViews) notes.push(`${domViews} ${domViews === 1 ? 'View desenhada' : 'Views desenhadas'} pelo DOM da página não ${domViews === 1 ? 'aparece' : 'aparecem'} na imagem`);
  const full = { left: 0, top: 0, right: window.width, bottom: window.height };
  const box = area ? { left: Math.max(full.left, area.left), top: Math.max(full.top, area.top), right: Math.min(full.right, area.right), bottom: Math.min(full.bottom, area.bottom) } : full;
  if (!(box.right > box.left && box.bottom > box.top)) return { image: null, area: null, window, notes: [...notes, 'a área pedida está fora da janela'] };
  if (!layers.length) return { image: null, area: box, window, notes: [...notes, 'nenhum raster de conteúdo nesta tela (ela é desenhada pelo DOM da página): sem imagem'] };
  if (area && !layers.some(layer => layer.right > box.left && layer.left < box.right && layer.bottom > box.top && layer.top < box.bottom)) return { image: null, area: box, window, notes: [...notes, 'nenhum raster cobre essa área (ela é desenhada pelo DOM da página): sem imagem'] };
  let scale = Math.max(1, ...layers.map(layer => layer.raster.width / Math.max(1, layer.right - layer.left)));
  scale = Math.min(scale, VARIANT_MAX_SIDE / (box.right - box.left), VARIANT_MAX_SIDE / (box.bottom - box.top));
  const width = Math.max(1, Math.round((box.right - box.left) * scale)), height = Math.max(1, Math.round((box.bottom - box.top) * scale)), pixels = new Uint8ClampedArray(width * height * 4);
  if (background !== null) { const a = background >>> 24, r = (background >>> 16) & 255, g = (background >>> 8) & 255, b = background & 255; for (let i = 0; i < pixels.length; i += 4) { pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a; } }
  for (const { raster, left, top, right, bottom } of layers) {
    if (right <= box.left || left >= box.right || bottom <= box.top || top >= box.bottom) continue;
    blit(pixels, width, height, raster.pixels, raster.width, raster.height, (left - box.left) * scale, (top - box.top) * scale, (right - left) * scale, (bottom - top) * scale);
  }
  return { image: { width, height, scale, pixels }, area: box, window, notes };
}

// ---- the screen as data ---------------------------------------------------------------------------------------------------------------------------------------------------------

function describeViews(runtime, roots) {
  const views = [];
  for (const root of roots) for (const item of flattenWindow(root)) {
    if (views.length >= VARIANT_MAX_LIST) break;
    const view = item.view;
    views.push({ type: dotted(view.type), text: typeof view.text === 'string' && view.text ? view.text : null, contentDescription: view.contentDescription ?? null, androidId: view.androidId ?? null, visible: item.visible,
      bounds: item.laidOut ? { left: item.left, top: item.top, right: item.right, bottom: item.bottom } : null, raster: !!view.contentRaster });
  }
  return views;
}
/** The Compose semantics nodes of the windows, with window coordinates; [] when the app has none or the driver cannot read them (the note says why). */
function describeSemantics(runtime, roots, semantics, notes) {
  if (!semantics) return [];
  let tree; try { runtime.steps = 0; tree = runtime.runDiagnostic ? runtime.runDiagnostic(() => semantics.snapshot(), null, error => notes.push(`semântica do Compose indisponível: ${String(error?.message ?? error).slice(0, 200)}`)) : semantics.snapshot(); } catch (error) { notes.push(`semântica do Compose indisponível: ${String(error?.message ?? error).slice(0, 200)}`); return []; }
  const where = new Map(); for (const root of roots) for (const item of flattenWindow(root)) where.set(item.view.id, item);
  const nodes = [];
  for (const owner of tree?.owners ?? []) {
    const host = where.get(owner.ownerViewId); if (!host) continue;   // an owner of another Activity's window
    for (const node of owner.nodes ?? []) {
      if (nodes.length >= VARIANT_MAX_LIST) break;
      const b = node.boundsInRoot; if (!b) continue;
      nodes.push({ testTag: node.testTag ?? null, texts: [...(node.texts ?? [])], editableText: node.editableText ?? null, contentDescriptions: [...(node.contentDescriptions ?? [])], role: node.role ?? null,
        visible: !!node.placed && !node.invisibleToUser, bounds: { left: host.left + b.left, top: host.top + b.top, right: host.left + b.right, bottom: host.top + b.bottom } });
    }
  }
  return nodes;
}
/** The elements of the variant's screen a selector can name: the composeTree nodes when the tree was read (they carry the semantics too), else the semantics nodes, and the Views. */
function elementsOf(views, nodes, tree) {
  const out = [];
  if (tree) { for (const owner of tree.owners ?? []) for (const node of owner.nodes ?? []) if (node.bounds && node.placed !== false) out.push({ kind: 'compose', name: node.name ?? null, testTag: node.testTag ?? null, texts: node.texts ?? [], editableText: node.editableText ?? null, contentDescriptions: node.contentDescriptions ?? [], role: node.role ?? null, androidId: null, bounds: node.bounds }); }
  else for (const node of nodes) if (node.visible) out.push({ kind: 'compose', name: null, testTag: node.testTag, texts: node.texts, editableText: node.editableText, contentDescriptions: node.contentDescriptions, role: node.role, androidId: null, bounds: node.bounds });
  for (const view of views) if (view.visible && view.bounds && !/AndroidComposeView$/.test(view.type)) out.push({ kind: 'view', name: view.type.split('.').pop(), testTag: null, texts: view.text ? [view.text] : [], editableText: null, contentDescriptions: view.contentDescription ? [view.contentDescription] : [], role: null, androidId: view.androidId, bounds: view.bounds });
  return out.filter(element => element.bounds.right > element.bounds.left && element.bounds.bottom > element.bounds.top);
}
/** The elements a selector names (every given key must match), in tree order. Throws RenderVariantError('crop-not-found') for a resource id the APK does not have. */
function selectElements(runtime, selector, elements) {
  let id = null;
  if (selector.viewId !== undefined) {
    id = Number.isInteger(selector.viewId) ? selector.viewId : runtime.resources?.table?.findId?.(String(selector.viewId).includes('/') ? String(selector.viewId) : 'id/' + selector.viewId) ?? null;
    if (!id) fail('crop-not-found', `o APK não tem o id ${String(selector.viewId).slice(0, 80)}.`);
  }
  return elements.filter(element => (selector.name === undefined || element.name === selector.name) && (selector.testTag === undefined || element.testTag === selector.testTag) && (selector.role === undefined || element.role === selector.role)
    && (selector.text === undefined || element.texts.includes(selector.text) || element.editableText === selector.text) && (selector.contentDescription === undefined || element.contentDescriptions.includes(selector.contentDescription)) && (id === null || element.androidId === id));
}

// ---- the background instance ----------------------------------------------------------------------------------------------------------------------------------------------------

/** Why the background screen is not still yet (Portuguese, like src/screen-ready.js), [] when it is. */
function unsettled(runtime, frame, earlier) {
  const platform = runtime.platform, probe = readinessProbe(runtime);
  // The frame counter is the process's (the visible screen already drew): the instance's own first draw is its attached root with no draw queued and no frame pending.
  probe.firstFrame = !!runtime.root && !!runtime.object(runtime.root).attached && !platform.drawRootsQueued?.has(runtime.root.ref);
  probe.resumed = frame.lifecycleStage === 4;
  // Exchanges that were already in flight when the render began (the visible screen's, or a destroyed instance's) are not this screen's: only the ones started since count.
  let network = runtime.network?.jobs ?? 0, delayed = 0;
  for (const op of runtime.network?.ops?.values() ?? []) { if (earlier.has(op) || op.ended || op.error !== null || op.closed) continue; if (op.executor === 'mock') delayed++; else network++; }
  probe.network = network;
  const reasons = waitingFor(probe);
  if (delayed) reasons.push(`${delayed === 1 ? 'uma resposta mockada' : `${delayed} respostas mockadas`} com atraso ainda não entregue`);
  if (runtime.multiThreaded && runtime.scheduler?.threadDelay?.() === 0) reasons.push('threads do app em execução');
  return reasons;
}
const defaultDrain = runtime => () => { let processed = 0, result; for (let round = 0; round < 32; round++) { runtime.steps = 0; result = runtime.platform.drainEvents(runtime); processed += result.processed; if (!result.processed || result.nextDelay !== 0) break; } return { ...result, processed }; };

/**
 * Runs the whole render. `env`: { drain() -> { processed, nextDelay } (one pump of the VM, default platform.drainEvents rounds), wait(ms) -> Promise (real time in the Worker; a
 * test may move the VM clock instead), semantics (a Compose semantics driver, or null) }. Resolves with the result described in docs/RENDER-VARIANT.md; the image's pixels are a
 * fresh Uint8ClampedArray the caller may transfer. Rejects with RenderVariantError (code: bad-args, no-activity, not-resumed, busy, unsupported, cleanup-failed) or with the VM's own error when the app's code failed; in every case the instance, its task and its mocks are gone before the promise settles.
 */
export async function renderVariant(runtime, rawOptions = {}, env = {}) {
  const platform = runtime?.platform;
  if (!platform || !runtime.activity || platform.taskClosed) fail('no-activity', 'Nenhuma Activity em execução.');
  if (platform.backgroundRender) fail('busy', 'Outra renderização de variante está em andamento.');
  const options = variantOptions(rawOptions);
  platform.syncCurrent(runtime);
  const visible = platform.frame(runtime), home = platform.taskOf(visible);
  if (!home || visible.finished || visible.finishing || visible.finishRequested) fail('not-resumed', 'A Activity atual está sendo encerrada.');
  if (visible.lifecycleStage !== 4 || visible.lifecycleDepth > 0 || visible.recreationPending) fail('not-resumed', 'A Activity atual não está em onResume (ainda abrindo ou sendo recriada); tente quando a tela estiver pronta.');
  if (platform.launchPending()) fail('busy', 'Há uma Activity sendo aberta; tente quando a tela estiver pronta.');
  if (nullish(visible.intent)) fail('unsupported', 'A Activity atual não tem o Intent com que foi aberta.');
  if (options.mode === 'cover' && visible.noHistory) fail('unsupported', 'mode "cover" numa Activity noHistory a encerraria (ela sai do histórico quando o usuário a deixa); use "display".');
  const drain = env.drain ?? defaultDrain(runtime), wait = env.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))), clock = platform.clock, type = visible.type, id = ++serial;
  const timing = { startedAt: performance.now(), startMs: 0, settleMs: 0, captureMs: 0, teardownMs: 0 }, heapBefore = runtime.heap?.size ?? null, vmStart = clock.now();
  const records = options.mocks.map(({ mock, compiled }) => ({ id: `variant-${id}-${mock.id}`, mockId: mock.id, variant: true, hits: 0, warned: false, label: mockLabel(mock), method: mock.method, url: mock.url, status: compiled.response.status, compiled, enabled: true }));
  const withMocks = () => { if (records.length && !platform.endpointMocks?.includes(records[0])) platform.endpointMocks = [...records, ...(platform.endpointMocks ?? []).filter(record => !records.includes(record))]; };
  const requests = [], droppedStarts = [], notes = [], lifecycle = [];
  const session = { id, task: null, frame: null, deferredStarts: 0,
    /** platform.startActivity asks before it runs a queued start: 'drop' (made by the background instance, or by no Activity: it cannot be told apart), 'defer' (an Activity of the visible stack), null (run it). */
    holdStart: (rt, target, caller) => {
      let owner = null;
      for (let at = caller, depth = 0; at && !nullish(at) && depth < 16; depth++) { const object = rt.object(at); if (rt.isSubtype(object.type, ACTIVITY)) { owner = at; break; } at = object.baseContext; }
      const ownerFrame = owner ? platform.allFrames().find(frame => frame.activity.ref === owner.ref) ?? null : null;
      if (ownerFrame && !session.task?.frames.includes(ownerFrame)) { if (!session.held?.has(target)) { (session.held ??= new Set()).add(target); session.deferredStarts++; } return 'defer'; }
      droppedStarts.push(dotted(target)); rt.record(`ACTIVITY start of ${dotted(target)} dropped: made during a background render (render-variant ${id})`); return 'drop';
    } };
  const bridge = runtime.network ?? null, observerBefore = bridge?.requestObserver ?? null, earlier = new Set(bridge?.ops?.values() ?? []);
  const observe = (request, mock) => { if (requests.length < VARIANT_MAX_LIST) requests.push({ method: String(request?.method ?? 'GET'), url: String(request?.url ?? '').slice(0, 2000), mock: mock ? (records.includes(mock) ? mock.mockId : null) : null, answeredBy: mock ? (records.includes(mock) ? 'variant-mock' : 'lab-mock') : 'network' }); };
  const call = (frame, name, parameters = [], values = []) => { lifecycle.push(name); platform.lifecycleCall(runtime, frame.activity, name, parameters, values); };
  let result = null, failure = null, covered = false, saved = null;
  try {
    runtime.record(`RENDER-VARIANT ${id} start ${dotted(type)} (${options.mode}${options.restoreState ? ', restoreState' : ''}, ${records.length} mocks)`);
    if (options.mode === 'cover') {
      // The visible Activity's task goes to the background: onPause, then onSaveInstanceState / onStop in the order of the app's targetSdk (after onStop since P).
      runtime.steps = 0; covered = true; saved = platform.bundle(runtime);
      const targetSdk = Number(platform.manifest?.usesSdk?.targetSdkVersion ?? platform.manifest?.usesSdk?.minSdkVersion ?? 1);
      call(visible, 'onPause');
      if (targetSdk < 28) { call(visible, 'onSaveInstanceState', [BUNDLE], [saved]); call(visible, 'onStop'); } else { call(visible, 'onStop'); call(visible, 'onSaveInstanceState', [BUNDLE], [saved]); }
    }
    if (bridge) bridge.requestObserver = observe; else notes.push('o app ainda não usou a rede: as requisições desta renderização não foram listadas');
    withMocks(); platform.backgroundRender = session;
    session.task = platform.newTask(type, platform.activityInfo(type), { intentKey: home.intentKey ?? null, exclude: true }); session.task.pinned++; session.task.background = true;
    const flags = visible.launchFlags ?? 0, delivered = platform.copyIntent(runtime, runtime.object(visible.intent), flags);
    runtime.steps = 0;
    try { session.frame = platform.createInstance(runtime, type, delivered, session.task, { flags, savedState: options.restoreState ? saved : null }); } finally { session.frame ??= session.task.frames.at(-1) ?? null; }
    if (!bridge && runtime.network) runtime.network.requestObserver = observe;
    timing.startMs = performance.now() - timing.startedAt;
    // Until the screen is still for quietMs of the VM clock, or the timeout (VM clock, and real time as a backstop for a VM that computes without the clock moving).
    const frame = session.frame, alive = () => platform.launchAlive(frame) && session.task.frames.includes(frame);
    let settledSince = null, reasons = [], timedOut = false, rounds = 0; const settleStart = performance.now();
    for (;;) {
      withMocks();   // a mock list applied by the page meanwhile keeps the variant's mocks in front
      const pump = drain(); rounds++;
      if (!alive()) break;
      const now = clock.now(); reasons = unsettled(runtime, frame, earlier);
      if (!reasons.length) { settledSince ??= now; if (now - settledSince >= options.quietMs) break; } else settledSince = null;
      if (now - vmStart >= options.timeoutMs || performance.now() - timing.startedAt >= options.timeoutMs * 2) { timedOut = true; if (!reasons.length) reasons = [`tela parada há ${Math.round(now - settledSince)} ms (pronta após ${options.quietMs} ms)`]; break; }
      const next = Number.isFinite(pump?.nextDelay) && pump.nextDelay !== null ? pump.nextDelay : 50, quietLeft = settledSince === null ? 50 : Math.max(1, options.quietMs - (now - settledSince));
      await wait(Math.max(1, Math.min(50, next || 1, quietLeft, options.timeoutMs - (now - vmStart) + 1)));
    }
    timing.settleMs = performance.now() - settleStart;
    const finishedItself = !alive(), captureStart = performance.now();
    let image = null, area = null, window = null, texts = [], views = [], semantics = [], tree = null; const images = [];
    if (!finishedItself) {
      // The instance's windows as the page would get them: its content rasters replayed on the CPU at full density, whatever the renderer and the motion policy of the page are.
      const scale = runtime.displayRasterScale, served = runtime.displayRasterReducedServed, rasterOptions = runtime.contentRasterOptions;
      runtime.displayRasterScale = 1; runtime.displayRasterReducedServed = null; if (runtime.gpuRaster) runtime.contentRasterOptions = { ...(rasterOptions ?? {}), transport: 'rgba' };
      let snapshot; try { runtime.steps = 0; snapshot = runtime.snapshot(); } finally { runtime.displayRasterScale = scale; runtime.displayRasterReducedServed = served; runtime.contentRasterOptions = rasterOptions; }
      const owned = view => { if (!view.windowSurface) return true; try { const record = platform.dialogWindowHost?.recordFor?.(runtime, { ref: view.id }); return !record || !record.ownerActivity || record.ownerActivity.ref === frame.activity.ref; } catch { return false; } };
      const roots = (snapshot.views ?? []).filter((view, index) => index === 0 ? !view.windowSurface : owned(view));
      texts = [...(snapshot.texts ?? [])].filter(text => typeof text === 'string').slice(0, VARIANT_MAX_LIST);
      views = describeViews(runtime, roots); semantics = describeSemantics(runtime, roots, env.semantics ?? null, notes);
      if (options.tree) { if (typeof env.composeTree === 'function') { try { runtime.steps = 0; tree = env.composeTree(); } catch (error) { notes.push(`árvore do Compose indisponível: ${String(error?.message ?? error).slice(0, 200)}`); } } else if (options.treeAsked) notes.push('árvore do Compose indisponível neste ambiente'); }
      const whole = composeWindows(roots, null); window = whole.window; notes.push(...whole.notes);
      if (options.image) { image = whole.image; area = whole.area; }
      // Every crop is cut from this one render: a box, or the elements a selector names (one image per match with `all`, else exactly one match or the `index`-th).
      const elements = options.crops.some(crop => crop.selector) ? elementsOf(views, semantics, tree) : [], budget = () => images.reduce((sum, entry) => sum + (entry.image ? 1 : 0), 0) < VARIANT_MAX_IMAGES;
      options.crops.forEach((crop, index) => {
        const cut = (box, extra) => { if (!budget()) { images.push({ crop: index, ...extra, bounds: box, image: null, error: { code: 'too-many', message: `mais de ${VARIANT_MAX_IMAGES} imagens numa renderização` } }); return; } const composed = composeWindows(roots, box); images.push({ crop: index, ...extra, bounds: composed.area, image: composed.image, ...(composed.image ? {} : { error: { code: 'no-image', message: composed.notes.at(-1) ?? 'sem imagem' } }) }); };
        if (crop.rect) { cut(crop.rect, {}); return; }
        let found; try { found = selectElements(runtime, crop.selector, elements); } catch (error) { if (!(error instanceof RenderVariantError)) throw error; images.push({ crop: index, selector: crop.selector, matches: 0, bounds: null, image: null, error: { code: error.code, message: error.message } }); return; }
        const describe = element => ({ kind: element.kind, name: element.name, testTag: element.testTag, texts: element.texts, role: element.role });
        if (!found.length) { images.push({ crop: index, selector: crop.selector, matches: 0, bounds: null, image: null, error: { code: 'crop-not-found', message: `nenhum elemento da tela da variante casa com ${JSON.stringify(crop.selector).slice(0, 160)}${timedOut ? ' (a tela não ficou pronta no tempo dado)' : ''}` } }); return; }
        if (crop.all) { found.forEach((element, match) => cut(element.bounds, { selector: crop.selector, matches: found.length, match, element: describe(element) })); return; }
        if (crop.index === null && found.length > 1) { images.push({ crop: index, selector: crop.selector, matches: found.length, bounds: null, image: null, error: { code: 'crop-ambiguous', message: `${found.length} elementos casam com ${JSON.stringify(crop.selector).slice(0, 160)}: use index ou all` } }); return; }
        const element = found[crop.index ?? 0];
        if (!element) { images.push({ crop: index, selector: crop.selector, matches: found.length, bounds: null, image: null, error: { code: 'crop-not-found', message: `index ${crop.index} fora dos ${found.length} elementos que casam` } }); return; }
        cut(element.bounds, { selector: crop.selector, matches: found.length, match: crop.index ?? 0, element: describe(element) });
      });
    } else notes.push('a instância em segundo plano se encerrou sozinha (finish()) antes de a tela ficar pronta: sem imagem');
    timing.captureMs = performance.now() - captureStart;
    result = { mode: options.mode, restoreState: options.restoreState, activity: dotted(type), timedOut, settled: !timedOut && !finishedItself, finishedItself, waitingFor: timedOut ? reasons : [], image, bounds: area, images, window, texts, views, semantics, composeTree: options.treeAsked ? tree : null,
      requests, mocks: records.map(record => ({ id: record.mockId, label: record.label, hits: record.hits })), droppedStarts, notes, rounds };
  } catch (error) { failure = error; }
  // Teardown, whatever happened: the instance and anything it left in its task are destroyed (onPause, onStop, onDestroy), the task and the mocks are removed, the visible Activity is current again.
  const teardownStart = performance.now(), problems = [], step = (name, body) => { try { body(); } catch (error) { problems.push(`${name}: ${String(error?.message ?? error).slice(0, 300)}`); } };
  const background = session.task ? [...session.task.frames] : [];
  step('destroy', () => {
    for (const frame of [...background].reverse()) {
      if (!platform.allFrames().includes(frame)) continue;
      // An instance whose onCreate did not complete gets no further callback (on a device that exception ends the process); one whose teardown throws is removed all the same.
      if (frame.lifecycleStage >= 2) { try { runtime.steps = 0; platform.retireFrame(runtime, frame); continue; } catch (error) { failure ??= error; } }
      frame.finishing = true; frame.finished = true; frame.destroyed = true; platform.finishedActivities.add(frame.activity.ref); platform.removeFrame(frame);
      if (frame.root) { try { platform.viewWindowHost.unfocusSubtree(runtime, frame.root); platform.attachTree(runtime, frame.root, false); } catch (error) { failure ??= error; } }
      try { platform.dialogWindowHost.activityDestroyed(runtime, frame.activity); } catch (error) { failure ??= error; }
      runtime.record(`ACTIVITY removed ${frame.type} (background render ${id}: its code failed)`);
    }
  });
  step('task', () => { if (session.task) { session.task.pinned = 0; session.task.frames.length = 0; const at = platform.tasks.indexOf(session.task); if (at >= 0) platform.tasks.splice(at, 1); } });
  step('mocks', () => { const rest = (platform.endpointMocks ?? []).filter(record => !records.includes(record)); platform.endpointMocks = rest.length ? rest : null; if (runtime.network) runtime.network.requestObserver = observerBefore; });
  platform.backgroundRender = null;
  step('restore', () => {
    const front = platform.tasks.at(-1)?.frames.at(-1) ?? null;
    if (!front) { runtime.activity = null; runtime.activityType = null; runtime.root = null; platform.taskClosed = true; return; }   // the app finished its own Activities meanwhile
    platform.makeCurrent(runtime, front); platform.taskClosed = false; runtime.steps = 0;   // an instance that finished itself left the (then empty) foreground task marked closed
    if (front.lifecycleStage !== 4) { if (covered && front === visible) lifecycle.push(...(front.lifecycleStage === 2 ? ['onRestart', 'onStart', 'onResume'] : ['onResume'])); platform.resumeFrame(runtime, front); }
    for (const { root } of platform.viewRoots(runtime)) platform.requestDraw(runtime, root);   // what the visible windows invalidated while they were not the ones being drawn
  });
  step('drain', () => { drain(); });
  timing.teardownMs = performance.now() - teardownStart;
  const leaked = background.filter(frame => platform.allFrames().includes(frame)).length + (session.task && platform.tasks.includes(session.task) ? 1 : 0);
  runtime.record(`RENDER-VARIANT ${id} end${failure ? ' (failed)' : ''}${problems.length ? ` cleanup problems: ${problems.join('; ')}` : ''}`);
  if (problems.length || leaked) { const error = new RenderVariantError('cleanup-failed', `A instância em segundo plano não foi desfeita por completo (${[...problems, leaked ? `${leaked} registros restantes` : ''].filter(Boolean).join('; ')}); reabra o APK.`); error.cause = failure ?? undefined; throw error; }
  if (failure) throw failure;
  const current = runtime.activity ? platform.frame(runtime) : null;   // null: the app finished every Activity of its own while the render ran
  return { ...result, deferredStarts: session.deferredStarts, visible: { activity: current ? dotted(current.type) : null, same: current === visible, resumed: current?.lifecycleStage === 4, lifecycle },
    destroyed: { activities: background.length, instance: session.frame ? session.frame.activity.ref : null },
    ms: { total: Math.round(performance.now() - timing.startedAt), start: Math.round(timing.startMs), settle: Math.round(timing.settleMs), capture: Math.round(timing.captureMs), teardown: Math.round(timing.teardownMs), vmClock: Math.round(clock.now() - vmStart) },
    heap: { objectsBefore: heapBefore, objectsAfter: runtime.heap?.size ?? null } };
}
function nullish(value) { return value === null || value === undefined || value.ref === 0 || value.ref === null || value.ref === undefined; }
