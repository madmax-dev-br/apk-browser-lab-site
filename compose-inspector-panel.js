// The "Compose" panel of the lab page: a one-shot inspection of the screen's Compose layout tree (src/compose-inspector.js, run in the Worker) and of its Views, with a
// carousel of every element cut out of the frame the page shows, by the element's bounds, its details, a highlight on the device screen and a filterable table.
// Nothing runs while the panel is closed: no Worker message, no DOM, no images. Opening captures once; "Capturar" takes a new capture; "Atualizar ao navegar" (off by
// default) captures again after the screen navigates. Closing drops the DOM, the frozen frame and every crop.
// By default the elements are the boxes "Mostrar limites de layout" draws (src/layout-bounds.js: Views and Compose semantics nodes), each crop outlined like that overlay and named from
// the inspected LayoutNode with the same semanticsId; "Árvore completa" lists every LayoutNode of the inspection instead.
// The pure functions (element list, crop rectangles, bounds text, filter, JSON) are exported and tested without a DOM; createComposeInspectorPanel() wires them to the page.

import { LAYOUT_BOUNDS_COLORS } from './layout-bounds.js?v=c6940189447d';

export const MAX_CROPS = 300;   // cards with an image in the carousel; the table lists every element
export const EAGER_CROPS = 12;   // without IntersectionObserver, the first cards are cut at once and the others when chosen
const NO_RASTER = 'o quadro exibido não tem raster de conteúdo para este elemento';
const THUMB_W = 200, THUMB_H = 120, DETAIL_W = 360, DETAIL_H = 260;
const NAME_SOURCES = { composable: 'nome do composable (informação de fonte do slot table)', semantics: 'semântica (Role, texto ou ação do nó)', layout: 'classe da measure policy e modificadores (sem nome de composable no APK)', view: 'classe da View' };

const round = value => Math.round(value * 100) / 100;
const simple = type => { const name = String(type ?? '').replace(/^L|;$/g, '').replaceAll('/', '.'); return name.slice(name.lastIndexOf('.') + 1) || name; };
const sizeOf = b => b ? { width: round(b.right - b.left), height: round(b.bottom - b.top) } : { width: 0, height: 0 };

/** Views of a page snapshot, flattened in drawing order, with bounds relative to the nearest ancestor-or-self that has a content raster (where their pixels can be cut from). */
export function flattenViews(snapshot) {
  const out = [];
  const visit = (view, parent, depth, offset, raster, shown) => {
    if (!view || typeof view !== 'object' || out.length >= 4096 || depth > 96) return;
    const b = view.laidOut && view.bounds ? view.bounds : null, own = b ? { x: offset.x + b.left, y: offset.y + b.top } : offset;
    const visible = shown && view.visibility !== 4 && view.visibility !== 8, hasRaster = !!view.contentRaster;
    const base = hasRaster ? { hostId: view.id, x: own.x, y: own.y } : raster;
    const local = b && base ? { left: round(own.x - base.x), top: round(own.y - base.y), right: round(own.x - base.x + b.right - b.left), bottom: round(own.y - base.y + b.bottom - b.top) } : null;
    out.push({ id: view.id, parentId: parent?.id ?? null, depth, type: view.type ?? null, kind: view.kind ?? null, text: typeof view.text === 'string' ? view.text : null, contentDescription: view.contentDescription ?? null,
      androidId: view.androidId ?? null, visibility: view.visibility ?? 0, visible, clickable: !!(view.hasClickListener ?? view.clickable), compose: /AndroidComposeView;$/.test(String(view.type ?? '')),
      window: view.windowSurface ? { id: view.windowSurface.id, kind: view.windowSurface.kind ?? null, modal: !!view.windowSurface.modal } : null,
      bounds: b ? { left: round(own.x), top: round(own.y), right: round(own.x + b.right - b.left), bottom: round(own.y + b.bottom - b.top) } : null,
      rasterHostId: base?.hostId ?? null, rasterBounds: local });
    for (const child of view.children ?? []) visit(child, view, depth + 1, own, base, visible);
  };
  for (const root of snapshot?.views ?? []) visit(root, null, 0, { x: root.windowSurface?.x ?? 0, y: root.windowSurface?.y ?? 0 }, null, root.windowSurface?.visible !== false);
  return out;
}

/** A name for a semantics node of the page snapshot that has no inspected LayoutNode with a better one: role and text, a text field, a text, a clickable, the testTag, or its id. */
export function semanticsName(node) {
  const text = [...(node.texts ?? []), ...(node.contentDescriptions ?? [])].find(value => typeof value === 'string' && value.trim()), short = value => value.length > 40 ? value.slice(0, 39) + '…' : value;
  const actions = new Set((node.actions ?? []).map(action => action.name ?? action)), tag = node.testTag ? ` #${node.testTag}` : '';
  if (node.role) return `${node.role}${text ? ` "${short(text)}"` : ''}${tag}`;
  if (actions.has('SetText')) return `Campo de texto${node.editableText ? ` "${short(node.editableText)}"` : ''}${tag}`;
  if (text) return `Texto "${short(text)}"${tag}`;
  if (actions.has('OnClick')) return `Clicável${tag}`;
  return node.testTag ? `#${node.testTag}` : `Nó semântico ${node.nodeId}`;
}

/**
 * The elements "Mostrar limites de layout" draws (src/layout-bounds.js): every laid-out View and, for Compose, each semantics node of the page snapshot (boundsInRoot of the
 * AndroidComposeView), cut by that same rectangle. A Compose element takes the name and the layout details of the inspected LayoutNode with the same semanticsId (the composable's
 * name when the APK carries source information), else a name from its semantics.
 */
export function buildLayoutBoundsElements(inspection, snapshot) {
  const density = inspection?.density ?? snapshot?.density ?? null, list = [], views = flattenViews(snapshot), viewById = new Map(views.map(view => [String(view.id), view]));
  const inspected = new Map(); for (const owner of inspection?.owners ?? []) for (const node of owner.nodes ?? []) { const key = `${owner.ownerViewId}:${node.semanticsId}`, had = inspected.get(key); if (!had || (had.nameSource !== 'composable' && node.nameSource === 'composable')) inspected.set(key, { ...node, window: owner.window }); }
  for (const owner of snapshot?.composeSemantics?.owners ?? []) {
    const ownerView = viewById.get(String(owner.ownerViewId)); if (!ownerView?.bounds || owner.attached === false) continue;
    const hostSize = sizeOf(ownerView.bounds);
    for (const node of owner.nodes ?? []) {
      const r = node.boundsInRoot; if (!r || node.invisibleToUser || node.placed === false || !(r.right > r.left && r.bottom > r.top)) continue;
      const match = inspected.get(`${owner.ownerViewId}:${node.nodeId}`), semantics = { texts: node.texts ?? [], editableText: node.editableText ?? null, role: node.role ?? null, testTag: node.testTag ?? null, contentDescriptions: node.contentDescriptions ?? [],
        actions: (node.actions ?? []).map(action => action.name ?? action), enabled: !node.disabled, focused: node.focused ?? null, selected: node.selected ?? null, toggleState: node.toggleState ?? null, textSelection: node.textSelection ?? null };
      const named = match && (match.nameSource === 'composable' || match.nameSource === 'semantics'), fromSemantics = semanticsName(node), bare = fromSemantics.startsWith('Nó semântico ');
      const name = named ? match.name : bare && match ? match.name : fromSemantics, nameSource = named ? match.nameSource : bare && match ? match.nameSource : 'semantics';   // a node with no semantics text takes its LayoutNode's description
      list.push({ key: `c:${owner.ownerViewId}:${node.nodeId}`, kind: 'compose', name, nameSource, id: node.nodeId, ownerViewId: owner.ownerViewId,
        parentName: null, depth: match?.depth ?? 0, childCount: match?.childCount ?? 0, hostId: owner.ownerViewId, hostSize, cropBounds: r, bounds: match?.bounds ?? r, visibleBounds: r, windowBounds: shift(r, ownerView.bounds),
        placed: true, attached: true, zIndex: match?.zIndex ?? null, measurePolicy: match?.measurePolicy ?? null, modifiers: match?.modifiers ?? [], semantics, calls: match?.calls ?? [], window: match?.window ?? ownerView.window, density, layoutBounds: true });
    }
  }
  for (const element of viewElements(views, viewById, density)) if (element.bounds && element.placed) list.push({ ...element, layoutBounds: true });
  return list;
}

const viewElements = (views, viewById, density) => views.map(view => {
  const label = view.text || view.contentDescription;
  return { key: `v:${view.id}`, kind: 'view', name: `${simple(view.type)}${label ? ` "${label.length > 40 ? label.slice(0, 39) + '…' : label}"` : ''}`, nameSource: 'view', id: view.id, parentName: view.parentId !== null ? simple(viewById.get(String(view.parentId))?.type) : null,
    depth: view.depth, hostId: view.rasterHostId, hostSize: view.rasterHostId === null ? null : sizeOf(viewById.get(String(view.rasterHostId))?.bounds), cropBounds: view.rasterBounds, bounds: view.bounds, visibleBounds: view.bounds, windowBounds: view.bounds, placed: view.visible,
    zIndex: null, type: view.type, viewKind: view.kind, text: view.text, contentDescription: view.contentDescription, androidId: view.androidId, visibility: view.visibility, clickable: view.clickable, compose: view.compose, window: view.window, density };
});

/** One list for the carousel and the table: the Compose elements of the inspection (by owner), then the Views of the snapshot. */
export function buildElements(inspection, snapshot, { mode = 'tree' } = {}) {
  if (mode === 'layout') return buildLayoutBoundsElements(inspection, snapshot);
  const density = inspection?.density ?? snapshot?.density ?? null, list = [], views = flattenViews(snapshot), viewById = new Map(views.map(view => [String(view.id), view]));
  for (const owner of inspection?.owners ?? []) {
    const ownerView = viewById.get(String(owner.ownerViewId)), names = new Map(owner.nodes.map(node => [node.id, node.name]));
    for (const node of owner.nodes) {
      list.push({ key: `c:${node.id}`, kind: 'compose', name: node.name, nameSource: node.nameSource, id: node.semanticsId, ownerViewId: owner.ownerViewId, parentName: node.parentId ? names.get(node.parentId) ?? null : null,
        depth: node.depth, childCount: node.childCount, hostId: owner.ownerViewId, hostSize: { width: owner.width, height: owner.height }, cropBounds: node.visibleBounds, bounds: node.bounds, visibleBounds: node.visibleBounds,
        windowBounds: node.boundsInWindow ?? (ownerView?.bounds && node.visibleBounds ? shift(node.visibleBounds, ownerView.bounds) : null), placed: node.placed, attached: node.attached, zIndex: node.zIndex,
        measurePolicy: node.measurePolicy, modifiers: node.modifiers ?? [], semantics: node.semantics, calls: node.calls ?? [], window: owner.window, density });
    }
  }
  list.push(...viewElements(views, viewById, density));
  return list;
}
const shift = (b, origin) => ({ left: round(b.left + origin.left), top: round(b.top + origin.top), right: round(b.right + origin.left), bottom: round(b.bottom + origin.top) });

/** "16, 42 · 219 × 28 px · 219 × 28 dp" (dp only when the density is known). */
export function formatBounds(b, density = null) {
  if (!b) return 'sem limites';
  const { width, height } = sizeOf(b), px = `${round(b.left)}, ${round(b.top)} · ${width} × ${height} px`;
  return density > 0 ? `${px} · ${round(width / density)} × ${round(height / density)} dp` : px;
}

/** Why an element has no crop, or null when it has one. `hostSize` is the raster host's size in px (the Compose owner's width and height). */
export function cropProblem(element, hostSize = element.hostSize) {
  if (element.kind === 'compose' && !element.attached) return 'nó desanexado (não está na árvore)';
  if (element.kind === 'compose' && !element.placed) return 'não posicionado (isPlaced = false)';
  if (element.kind === 'view' && !element.placed) return 'View invisível (visibility GONE/INVISIBLE)';
  if (element.hostId === null || element.hostId === undefined) return 'sem raster de conteúdo (View desenhada pelo DOM da página)';
  const b = element.cropBounds; if (!b) return 'sem limites';
  const { width, height } = sizeOf(b); if (!(width > 0 && height > 0)) return 'tamanho zero (ou recortado inteiro pelos pais)';
  if (hostSize && (b.right <= 0 || b.bottom <= 0 || b.left >= hostSize.width || b.top >= hostSize.height)) return 'fora da área visível';
  return null;
}

/** The source rectangle in the frozen frame's pixels for bounds in the host's px: { sx, sy, sw, sh }, clamped to the frame; null when nothing is left. */
export function cropRect(bounds, hostSize, frameSize) {
  if (!bounds || !(hostSize?.width > 0) || !(hostSize?.height > 0) || !(frameSize?.width > 0) || !(frameSize?.height > 0)) return null;
  const kx = frameSize.width / hostSize.width, ky = frameSize.height / hostSize.height;
  const left = Math.max(0, Math.floor(bounds.left * kx)), top = Math.max(0, Math.floor(bounds.top * ky)), right = Math.min(frameSize.width, Math.ceil(bounds.right * kx)), bottom = Math.min(frameSize.height, Math.ceil(bounds.bottom * ky));
  return right > left && bottom > top ? { sx: left, sy: top, sw: right - left, sh: bottom - top } : null;
}

/** Fits w × h inside maxW × maxH (never enlarged). */
export const fit = (w, h, maxW, maxH) => { const k = Math.min(1, maxW / w, maxH / h); return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }; };

/** The element passes when every word of `text` is part of its name, texts, testTag, class names or modifiers (case-insensitive). */
export function matchesElement(element, text) {
  const words = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return true;
  const s = element.semantics, hay = [element.name, element.measurePolicy, element.type, element.text, element.contentDescription, element.kind, ...(element.modifiers ?? []).flatMap(m => [m.label, m.className]),
    ...(s ? [...(s.texts ?? []), s.editableText, s.testTag, s.role, ...(s.contentDescriptions ?? []), ...(s.actions ?? [])] : []), ...(element.calls ?? [])].filter(Boolean).join('\n').toLowerCase();
  return words.every(word => hay.includes(word));
}

/** The JSON "Copiar JSON" writes: the inspection and the Views, no images. */
export function exportJSON(capture) {
  return JSON.stringify({ capturedAt: capture?.capturedAt ?? null, activityName: capture?.inspection?.activityName ?? capture?.snapshot?.activityName ?? null, fullDensity: capture?.fullDensity ?? null,
    compose: capture?.inspection ?? null, views: flattenViews(capture?.snapshot) }, null, 2);
}

/** Label/value rows of the details pane for one element. */
export function detailRows(element) {
  const rows = [['Nome', element.name], ['Origem do nome', NAME_SOURCES[element.nameSource] ?? element.nameSource]];
  if (element.calls?.length) rows.push(['Chamadas', element.calls.join(' › ')]);
  rows.push([element.kind === 'compose' ? 'Id (semanticsId)' : 'Id da View', String(element.id)], ['Profundidade', `${element.depth}${element.parentName ? ` · pai: ${element.parentName}` : ''}`]);
  if (element.kind === 'compose') {
    rows.push(['Na janela (visível)', formatBounds(element.windowBounds, element.density)], ['No AndroidComposeView', formatBounds(element.bounds, element.density)]);
    if (element.visibleBounds && element.bounds && JSON.stringify(element.visibleBounds) !== JSON.stringify(element.bounds)) rows.push(['Recortado pelos pais', formatBounds(element.visibleBounds, element.density)]);
    rows.push(['z-index', String(element.zIndex)], ['Posicionado', element.placed ? 'sim (isPlaced)' : 'não'], ['Filhos', String(element.childCount)], ['Measure policy', element.measurePolicy ?? '—'],
      ['Modificadores', element.modifiers.length ? element.modifiers.map(m => m.label === simple(m.className) ? m.label : `${m.label} (${simple(m.className)})`).join(', ') : '—']);
    const s = element.semantics;
    if (s) {
      if (s.texts?.length) rows.push(['Texto', s.texts.join(' · ')]);
      if (s.editableText !== null && s.editableText !== undefined) rows.push(['Texto editável', s.editableText]);
      if (s.role) rows.push(['Role', s.role]);
      if (s.testTag) rows.push(['testTag', s.testTag]);
      if (s.contentDescriptions?.length) rows.push(['contentDescription', s.contentDescriptions.join(' · ')]);
      rows.push(['Ações', s.actions?.length ? s.actions.join(', ') : '—'], ['Habilitado', s.enabled ? 'sim' : 'não']);
      if (s.focused !== null && s.focused !== undefined) rows.push(['Focado', s.focused ? 'sim' : 'não']);
      if (s.selected !== null && s.selected !== undefined) rows.push(['Selecionado', s.selected ? 'sim' : 'não']);
      if (s.toggleState) rows.push(['Estado', s.toggleState]);
      if (Array.isArray(s.textSelection)) rows.push(['Seleção', s.textSelection.join('–')]);
    } else rows.push(['Semântica', 'nenhuma neste nó']);
  } else {
    rows.push(['Classe', String(element.type ?? '').replace(/^L|;$/g, '').replaceAll('/', '.')], ['Tipo no renderizador', element.viewKind ?? '—'], ['Na janela', formatBounds(element.windowBounds, element.density)]);
    if (element.text) rows.push(['Texto', element.text]);
    if (element.contentDescription) rows.push(['contentDescription', element.contentDescription]);
    rows.push(['Visível', element.placed ? 'sim' : `não (visibility ${element.visibility})`], ['Clicável', element.clickable ? 'sim' : 'não']);
    if (element.compose) rows.push(['Compose', 'hospeda uma composição: veja os elementos Compose']);
  }
  if (element.window && element.window.id !== null) rows.push(['Janela', `${element.window.kind ?? 'janela'} ${element.window.id}${element.window.modal ? ' · modal' : ''}`]);
  const problem = cropProblem(element); rows.push(['Recorte', problem ? `sem recorte: ${problem}` : 'cortado do quadro exibido pela página']);
  return rows;
}

/**
 * root: the <details id="compose-inspector"> element (see index.html).
 * inspect(): Promise of the Worker's inspection (APKWorkerClient.inspectCompose). getSnapshot(): the snapshot the device shows. getHost(viewId): the element of a View on the
 * device (its _contentLayer is the raster to cut). getScreen(): the #android-screen element (the highlight's parent). copyText(text): Promise (clipboard).
 * Returns { rendered(snapshot), reset(), capture(), state }.
 */
export function createComposeInspectorPanel({ root, inspect, getSnapshot = () => null, getHost = () => null, getScreen = () => null, copyText = text => navigator.clipboard.writeText(text), fullDensityWaitMs = 2000 } = {}) {
  const q = selector => root.querySelector(selector), body = q('.ci-body'), count = q('.ci-count'), captureButton = q('.ci-capture'), follow = q('.ci-follow'), filterInput = q('.ci-filter'), copyButton = q('.ci-copy');
  const el = (tag, className = '', text = null) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== null) node.textContent = text; return node; };
  // "Árvore completa" (off by default): every LayoutNode of the inspection instead of the boxes "Mostrar limites de layout" draws
  let treeToggle = q('.ci-tree');
  if (!treeToggle && follow?.parentElement?.parentElement) { const label = document.createElement('label'); label.className = 'logcat-auto'; label.title = 'Mostra cada LayoutNode da árvore do Compose, não só as caixas de \'Mostrar limites de layout\''; treeToggle = document.createElement('input'); treeToggle.type = 'checkbox'; treeToggle.className = 'ci-tree'; label.append(treeToggle, ' Árvore completa'); follow.parentElement.after(label); }
  const mode = () => treeToggle?.checked ? 'tree' : 'layout';
  const S = { capture: null, elements: [], visible: [], selected: null, frames: new Map(), thumbs: [], waitingRaster: new Set(), observer: null, highlight: null, token: 0, waiters: [], followKey: null, followTimer: null, busy: false };
  const setCount = text => { count.textContent = text; };
  setCount('fechado');

  const navigationKey = snapshot => {
    if (!snapshot) return null; const owner = snapshot.composeSemantics?.owners?.[0];
    return `${snapshot.activityName ?? ''}|${JSON.stringify(snapshot.navigation ?? null).slice(0, 400)}|${(owner?.nodes ?? []).slice(0, 24).map(node => node.nodeId).join(',')}`;
  };
  const release = () => {
    S.token++; S.observer?.disconnect(); S.observer = null; clearTimeout(S.followTimer); S.followTimer = null;
    for (const canvas of S.thumbs) { canvas.width = 0; canvas.height = 0; } S.thumbs = [];
    for (const frame of S.frames.values()) { if (frame.canvas) { frame.canvas.width = 0; frame.canvas.height = 0; } } S.frames.clear();
    S.waitingRaster.clear(); S.highlight?.remove(); S.highlight = null; S.capture = null; S.elements = []; S.visible = []; S.selected = null;
    for (const resolve of S.waiters.splice(0)) resolve(null);
    body.replaceChildren();
  };
  /** The frame the page shows now: once at full density (a reduced motion raster is refined by the Worker when the screen is still), or the reduced one after the wait. */
  const fullDensity = () => {
    const now = getSnapshot(); if (!now?.rasterReduced) return Promise.resolve(now);
    return new Promise(resolve => { const timer = setTimeout(() => { S.waiters = S.waiters.filter(entry => entry !== done); resolve(getSnapshot()); }, fullDensityWaitMs); const done = snapshot => { clearTimeout(timer); resolve(snapshot); }; S.waiters.push(done); });
  };
  /** Copies the content raster of a host View now, so every crop of this capture comes from the same frame even if the screen changes later. */
  const freeze = hostId => {
    const key = String(hostId); if (S.frames.has(key)) return S.frames.get(key);
    const layer = getHost(hostId)?._contentLayer; let frame = { canvas: null, width: 0, height: 0, reduced: false };
    try {
      const width = layer?.tagName === 'CANVAS' ? layer.width : layer?.naturalWidth ?? 0, height = layer?.tagName === 'CANVAS' ? layer.height : layer?.naturalHeight ?? 0;
      if (width > 0 && height > 0) { const canvas = el('canvas'); canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(layer, 0, 0); frame = { canvas, width, height, reduced: !!layer.dataset?.rasterScale }; }
    } catch { frame = { canvas: null, width: 0, height: 0, reduced: false }; }
    if (frame.canvas) S.frames.set(key, frame);   // a layer caught empty (a canvas being resized for the next frame) is copied again at the next crop, never cached as "no raster"
    return frame;
  };
  /** Draws the element's crop on `canvas`, at most maxW × maxH CSS px; returns the reason when there is none. */
  const paint = (element, canvas, maxW, maxH) => {
    const size = element.hostSize, problem = cropProblem(element, size); if (problem) return problem;
    const frame = freeze(element.hostId); if (!frame.canvas) return NO_RASTER;
    const r = cropRect(element.cropBounds, size, frame); if (!r) return 'fora da área visível';
    const css = fit(r.sw, r.sh, maxW, maxH), ratio = Math.min(2, globalThis.devicePixelRatio || 1), px = fit(r.sw, r.sh, css.width * ratio, css.height * ratio);
    canvas.width = px.width; canvas.height = px.height; canvas.style.width = `${css.width}px`; canvas.style.height = "auto";   // height follows the canvas aspect, also when max-width narrows it
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(frame.canvas, r.sx, r.sy, r.sw, r.sh, 0, 0, px.width, px.height);
    if (element.layoutBounds) { const line = Math.max(1, Math.round(ratio)); ctx.strokeStyle = LAYOUT_BOUNDS_COLORS.bounds; ctx.lineWidth = line; ctx.strokeRect(line / 2, line / 2, px.width - line, px.height - line); }   // the box as "Mostrar limites de layout" draws it
    return null;
  };
  const drawThumb = card => {
    if (card._drawn) return; card._drawn = true; const element = card._element, canvas = card.querySelector('canvas'), note = card.querySelector('.ci-noimage');
    const problem = card._index >= MAX_CROPS ? `limite de ${MAX_CROPS} recortes por captura` : paint(element, canvas, THUMB_W, THUMB_H);
    S.waitingRaster.delete(card);
    if (problem === NO_RASTER) { card._drawn = false; S.waitingRaster.add(card); }   // the host's layer was empty (the app had not drawn yet, or a canvas being resized): cut again on the next frame
    if (problem) { canvas.hidden = true; note.textContent = `sem recorte: ${problem}`; note.hidden = false; } else { canvas.hidden = false; note.hidden = true; S.thumbs.push(canvas); }
  };

  const highlight = element => {
    S.highlight?.remove(); S.highlight = null; if (!element || !element.placed) return;   // nothing on the screen to point at
    const screen = getScreen(), host = getHost(element.kind === 'compose' ? element.hostId : element.id); if (!screen || !host?.getBoundingClientRect || !screen.getBoundingClientRect) return;
    const sr = screen.getBoundingClientRect(), hr = host.getBoundingClientRect(), scale = screen.offsetWidth > 0 ? sr.width / screen.offsetWidth : 1;
    let box;
    if (element.kind === 'compose') { const b = element.visibleBounds; if (!b || !(b.right > b.left && b.bottom > b.top)) return; const k = host.offsetWidth > 0 ? hr.width / host.offsetWidth : scale; box = { left: (hr.left - sr.left) / scale + b.left * k / scale, top: (hr.top - sr.top) / scale + b.top * k / scale, width: (b.right - b.left) * k / scale, height: (b.bottom - b.top) * k / scale }; }
    else box = { left: (hr.left - sr.left) / scale, top: (hr.top - sr.top) / scale, width: hr.width / scale, height: hr.height / scale };
    if (!(box.width > 0 && box.height > 0)) return;
    const mark = el('div', 'ci-highlight'); mark.setAttribute('aria-hidden', 'true'); mark.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
    screen.append(mark); S.highlight = mark;
  };

  const select = (key, { focus = false } = {}) => {
    const element = S.elements.find(item => item.key === key); if (!element) return; S.selected = key;
    for (const card of body.querySelectorAll('.ci-card')) { const on = card._element?.key === key; card.setAttribute('aria-selected', String(on)); card.classList.toggle('selected', on); if (on && focus) { card.focus(); card.scrollIntoView?.({ block: 'nearest', inline: 'center' }); } if (on) drawThumb(card); }
    for (const row of body.querySelectorAll('.ci-row')) row.classList.toggle('selected', row._key === key);
    const details = body.querySelector('.ci-details'); if (details) renderDetails(details, element);
    highlight(element);
  };
  const renderDetails = (pane, element) => {
    const canvas = el('canvas', 'ci-detail-image'), note = el('p', 'ci-noimage'), problem = paint(element, canvas, DETAIL_W, DETAIL_H);
    if (problem) { canvas.hidden = true; note.textContent = `sem recorte: ${problem}`; } else { note.hidden = true; S.thumbs.push(canvas); }
    for (const old of pane.querySelectorAll('canvas')) { old.width = 0; old.height = 0; }
    const list = el('dl', 'ci-props'); for (const [label, value] of detailRows(element)) list.append(el('dt', '', label), el('dd', '', String(value ?? '—')));
    pane.replaceChildren(el('h4', '', element.name), canvas, note, list);
  };

  const renderList = () => {
    const capture = S.capture; if (!capture) return;
    S.observer?.disconnect(); S.observer = null; for (const canvas of S.thumbs) { canvas.width = 0; canvas.height = 0; } S.thumbs = []; S.waitingRaster.clear();
    S.visible = S.elements.filter(element => matchesElement(element, filterInput.value));
    const compose = S.elements.filter(element => element.kind === 'compose').length, views = S.elements.length - compose;
    const status = el('p', 'ci-status'), notes = [...(capture.inspection?.notes ?? [])];
    for (const owner of capture.inspection?.owners ?? []) if (owner.names?.note) notes.push(owner.names.note);
    if (!capture.fullDensity) notes.push('o quadro ainda estava em densidade reduzida (tela em movimento): recortes menos nítidos');
    status.textContent = `${mode() === 'layout' ? 'Limites de layout: ' : 'Árvore completa: '}${compose} elementos Compose · ${views} Views${capture.inspection?.ms !== undefined ? ` · inspeção em ${capture.inspection.ms} ms` : ''}${S.visible.length !== S.elements.length ? ` · ${S.visible.length} passam pelo filtro` : ''}${notes.length ? ' · ' + [...new Set(notes)].join(' · ') : ''}`;
    // carousel
    const strip = el('div', 'ci-strip'), track = el('div', 'ci-track'); track.setAttribute('role', 'listbox'); track.setAttribute('aria-label', 'Elementos da tela'); track.setAttribute('aria-orientation', 'horizontal');
    const shown = S.visible.slice(0, MAX_CROPS), cards = shown.map((element, index) => {
      const card = el('div', 'ci-card'); card.tabIndex = index === 0 ? 0 : -1; card.setAttribute('role', 'option'); card.setAttribute('aria-selected', 'false'); card._element = element; card._index = index;
      const image = el('div', 'ci-thumb'), canvas = el('canvas'), noimage = el('span', 'ci-noimage'); canvas.width = 0; canvas.height = 0; noimage.hidden = true; image.append(canvas, noimage);   // no pixels until the card is cut
      card.append(image, el('strong', '', element.name), el('small', '', `${element.kind === 'compose' ? 'Compose' : 'View'} · ${formatBounds(element.windowBounds ?? element.bounds, element.density)}`));
      card.addEventListener('click', () => select(element.key, { focus: true }));
      card.addEventListener('keydown', event => {
        const at = cards.indexOf(card), to = event.key === 'ArrowRight' ? at + 1 : event.key === 'ArrowLeft' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : null;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(element.key, { focus: true }); return; }
        if (to === null || !cards[to]) return; event.preventDefault(); card.tabIndex = -1; cards[to].tabIndex = 0; select(cards[to]._element.key, { focus: true });
      });
      return card;
    });
    track.append(...cards);
    const step = delta => { const at = Math.max(0, cards.findIndex(card => card._element.key === S.selected)), to = Math.min(cards.length - 1, Math.max(0, at + delta)); if (cards[to]) { for (const card of cards) card.tabIndex = -1; cards[to].tabIndex = 0; select(cards[to]._element.key, { focus: true }); } };
    const prev = el('button', 'ci-nav', '‹'), next = el('button', 'ci-nav', '›'); prev.type = next.type = 'button'; prev.setAttribute('aria-label', 'Elemento anterior'); next.setAttribute('aria-label', 'Próximo elemento');
    prev.addEventListener('click', () => step(-1)); next.addEventListener('click', () => step(1));
    strip.append(prev, track, next);
    const more = S.visible.length > MAX_CROPS ? el('p', 'ci-status', `O carrossel mostra os primeiros ${MAX_CROPS} de ${S.visible.length} elementos (limite de recortes); a tabela lista todos. Filtre para ver outros.`) : null;
    if (!cards.length) strip.replaceChildren(el('p', 'logcat-empty', S.elements.length ? 'Nenhum elemento passa pelo filtro.' : 'Nenhum elemento na tela.'));
    // details + table
    const details = el('div', 'ci-details'); details.append(el('p', 'logcat-empty', 'Escolha um elemento no carrossel ou na tabela para ver os detalhes e destacá-lo na tela.'));
    const table = el('table', 'ci-table'), head = el('thead'), headRow = el('tr'); for (const title of ['Elemento', 'Origem', 'Limites na janela', 'z', 'Modificadores / tipo']) headRow.append(el('th', '', title)); head.append(headRow);
    const tbody = el('tbody');
    for (const element of S.visible) {
      const row = el('tr', 'ci-row'); row._key = element.key; row.tabIndex = 0;
      const name = el('td', 'ci-name', `${'· '.repeat(Math.min(element.depth, 12))}${element.name}`);
      row.append(name, el('td', '', element.kind === 'compose' ? element.nameSource : 'view'), el('td', '', formatBounds(element.windowBounds ?? element.bounds, element.density)), el('td', '', element.zIndex === null || element.zIndex === undefined ? '—' : String(element.zIndex)),
        el('td', '', element.kind === 'compose' ? element.modifiers.map(m => m.label).join(', ') || simple(element.measurePolicy) : simple(element.type)));
      row.addEventListener('click', () => select(element.key)); row.addEventListener('keydown', event => { if (event.key === 'Enter') select(element.key); });
      tbody.append(row);
    }
    table.append(head, tbody); const wrap = el('div', 'ci-table-wrap'); wrap.append(table);
    body.replaceChildren(...[status, strip, more, details, wrap].filter(Boolean));
    setCount(`${compose} Compose · ${views} Views`);
    // lazy crops: only the cards scrolled into view
    if (typeof IntersectionObserver === 'function') {
      S.observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { drawThumb(entry.target); S.observer?.unobserve(entry.target); } }, { root: track, rootMargin: '0px 240px' });
      for (const card of cards) S.observer.observe(card);
    } else cards.slice(0, EAGER_CROPS).forEach(drawThumb);
    if (S.selected && S.visible.some(element => element.key === S.selected)) select(S.selected); else highlight(null);
  };

  const capture = async () => {
    if (!root.open || S.busy) return; S.busy = true; const token = ++S.token; captureButton.disabled = true; setCount('capturando…');
    if (!S.capture) body.replaceChildren(el('p', 'logcat-empty', 'Capturando a tela…'));
    try {
      const snapshot = await fullDensity(); if (token !== S.token || !root.open) return;
      if (!snapshot) { body.replaceChildren(el('p', 'logcat-empty', 'Nenhum aplicativo em execução. Execute um APK e capture de novo.')); setCount('sem tela'); return; }
      const inspection = await inspect(); if (token !== S.token || !root.open) return;
      const shownNow = getSnapshot() ?? snapshot;
      for (const frame of S.frames.values()) if (frame.canvas) { frame.canvas.width = 0; frame.canvas.height = 0; } S.frames.clear();
      S.capture = { inspection, snapshot: shownNow, fullDensity: !shownNow.rasterReduced, capturedAt: new Date().toISOString() }; S.followKey = navigationKey(shownNow);
      S.elements = buildElements(inspection, shownNow, { mode: mode() });
      for (const element of S.elements) if (element.hostId !== null && element.hostId !== undefined) freeze(element.hostId);   // the frame of this capture, before the screen moves on
      renderList();
    } catch (error) {
      if (token !== S.token) return;
      body.replaceChildren(el('p', 'logcat-empty', `Não foi possível inspecionar a tela: ${String(error?.message ?? error).slice(0, 300)}`)); setCount('erro');
    } finally { if (token === S.token) { S.busy = false; captureButton.disabled = false; } else S.busy = false; }
  };

  root.addEventListener('toggle', () => { if (root.open) capture(); else { release(); setCount('fechado'); } });
  captureButton.addEventListener('click', () => capture());
  filterInput.addEventListener('input', () => { if (S.capture) renderList(); });
  treeToggle?.addEventListener('change', () => { if (S.capture) { S.elements = buildElements(S.capture.inspection, S.capture.snapshot, { mode: mode() }); S.selected = null; renderList(); } });
  copyButton.addEventListener('click', async () => {
    if (!S.capture) return; const label = copyButton.textContent;
    try { await copyText(exportJSON(S.capture)); copyButton.textContent = 'Copiado'; } catch { copyButton.textContent = 'Falhou'; }
    setTimeout(() => { copyButton.textContent = label; }, 1800);
  });
  return {
    state: S,
    capture,
    /** Every snapshot the device draws: free while closed; open, it resolves a full-density wait, keeps the highlight on its element and follows navigation when asked. */
    rendered(snapshot) {
      if (!root.open) return;
      if (!snapshot?.rasterReduced && S.waiters.length) for (const resolve of S.waiters.splice(0)) resolve(snapshot);
      if (S.selected) highlight(S.elements.find(element => element.key === S.selected));
      if (S.waitingRaster.size) { for (const card of [...S.waitingRaster]) drawThumb(card); const pane = body.querySelector('.ci-details'), chosen = S.elements.find(element => element.key === S.selected); if (pane && chosen && pane.querySelector('.ci-noimage')?.textContent.includes(NO_RASTER)) renderDetails(pane, chosen); }   // the app drew: cut what was waiting
      if (follow?.checked && S.capture && !S.busy && navigationKey(snapshot) !== S.followKey) { clearTimeout(S.followTimer); S.followTimer = setTimeout(() => { S.followTimer = null; capture(); }, 600); }
    },
    /** A new run: what the panel shows belongs to the previous one. */
    reset() { const open = root.open; release(); setCount(open ? 'sem captura' : 'fechado'); if (open) body.replaceChildren(el('p', 'logcat-empty', 'Execute o APK e use Capturar.')); },
  };
}
