// The "Compose" panel of the lab page: a one-shot inspection of the screen's Compose layout tree (src/compose-inspector.js, run in the Worker) and of its Views.
// After a capture the panel shows the status line and a two-column split: on the left the elements as a tree (one row per element, indented by depth, with its name, kind and
// size; a filterable list that scrolls inside its column), on the right the details of the clicked element (its crop cut from the frame the page shows, name, properties). Until an
// element is clicked the right column is an empty state and no crop is cut; selecting an element cuts exactly one crop and highlights the element on the device screen.
// Nothing runs while the panel is closed: no Worker message, no DOM, no images. Opening captures once; "Capture" takes a new capture (keeping the selection when the same element
// is still there); "Update on navigation" (off by default) captures again after the screen navigates. Closing drops the DOM, the frozen frame and every crop.
// "Full tree" is on by default: every LayoutNode of the inspection. Off, the elements are the boxes of lab.layoutBounds() (Views and Compose semantics nodes; the overlay of
// src/layout-bounds.js also outlines the LayoutNodes and layout modifiers without semantics), each crop outlined and named from the inspected LayoutNode with the same semanticsId.
// The tree is a role="tree" of role="treeitem" rows (aria-level = depth + 1): ArrowUp / ArrowDown move the selection, Home / End jump, Enter / Space select.
// The pure functions (element list, crop rectangles, bounds text, filter, JSON) are exported and tested without a DOM; createComposeInspectorPanel() wires them to the page.

import { LAYOUT_BOUNDS_COLORS } from './layout-bounds.js?v=f44ff036c903';

const NO_RASTER = 'the displayed frame has no content raster for this element';
const DETAIL_W = 360, DETAIL_H = 260;
const NAME_SOURCES = { composable: 'composable name (source information from the slot table)', semantics: 'semantics (Role, text or action of the node)', layout: 'measure policy class and modifiers (no composable name in the APK)', view: 'View class' };

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
  if (actions.has('SetText')) return `Text field${node.editableText ? ` "${short(node.editableText)}"` : ''}${tag}`;
  if (text) return `Text "${short(text)}"${tag}`;
  if (actions.has('OnClick')) return `Clickable${tag}`;
  return node.testTag ? `#${node.testTag}` : `Semantic node ${node.nodeId}`;
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
      const named = match && (match.nameSource === 'composable' || match.nameSource === 'semantics'), fromSemantics = semanticsName(node), bare = fromSemantics.startsWith('Semantic node ');
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
  if (!b) return 'no bounds';
  const { width, height } = sizeOf(b), px = `${round(b.left)}, ${round(b.top)} · ${width} × ${height} px`;
  return density > 0 ? `${px} · ${round(width / density)} × ${round(height / density)} dp` : px;
}

/** Why an element has no crop, or null when it has one. `hostSize` is the raster host's size in px (the Compose owner's width and height). */
export function cropProblem(element, hostSize = element.hostSize) {
  if (element.kind === 'compose' && !element.attached) return 'detached node (not in the tree)';
  if (element.kind === 'compose' && !element.placed) return 'not placed (isPlaced = false)';
  if (element.kind === 'view' && !element.placed) return 'invisible View (visibility GONE/INVISIBLE)';
  if (element.hostId === null || element.hostId === undefined) return 'no content raster (View drawn by the page DOM)';
  const b = element.cropBounds; if (!b) return 'no bounds';
  const { width, height } = sizeOf(b); if (!(width > 0 && height > 0)) return 'zero size (or fully clipped by its parents)';
  if (hostSize && (b.right <= 0 || b.bottom <= 0 || b.left >= hostSize.width || b.top >= hostSize.height)) return 'outside the visible area';
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
  const rows = [['Name', element.name], ['Name source', NAME_SOURCES[element.nameSource] ?? element.nameSource]];
  if (element.calls?.length) rows.push(['Calls', element.calls.join(' › ')]);
  rows.push([element.kind === 'compose' ? 'Id (semanticsId)' : 'View id', String(element.id)], ['Depth', `${element.depth}${element.parentName ? ` · parent: ${element.parentName}` : ''}`]);
  if (element.kind === 'compose') {
    rows.push(['In the window (visible)', formatBounds(element.windowBounds, element.density)], ['In the AndroidComposeView', formatBounds(element.bounds, element.density)]);
    if (element.visibleBounds && element.bounds && JSON.stringify(element.visibleBounds) !== JSON.stringify(element.bounds)) rows.push(['Clipped by parents', formatBounds(element.visibleBounds, element.density)]);
    rows.push(['z-index', String(element.zIndex)], ['Placed', element.placed ? 'yes (isPlaced)' : 'no'], ['Children', String(element.childCount)], ['Measure policy', element.measurePolicy ?? '—'],
      ['Modifiers', element.modifiers.length ? element.modifiers.map(m => m.label === simple(m.className) ? m.label : `${m.label} (${simple(m.className)})`).join(', ') : '—']);
    const s = element.semantics;
    if (s) {
      if (s.texts?.length) rows.push(['Text', s.texts.join(' · ')]);
      if (s.editableText !== null && s.editableText !== undefined) rows.push(['Editable text', s.editableText]);
      if (s.role) rows.push(['Role', s.role]);
      if (s.testTag) rows.push(['testTag', s.testTag]);
      if (s.contentDescriptions?.length) rows.push(['contentDescription', s.contentDescriptions.join(' · ')]);
      rows.push(['Actions', s.actions?.length ? s.actions.join(', ') : '—'], ['Enabled', s.enabled ? 'yes' : 'no']);
      if (s.focused !== null && s.focused !== undefined) rows.push(['Focused', s.focused ? 'yes' : 'no']);
      if (s.selected !== null && s.selected !== undefined) rows.push(['Selected', s.selected ? 'yes' : 'no']);
      if (s.toggleState) rows.push(['State', s.toggleState]);
      if (Array.isArray(s.textSelection)) rows.push(['Selection', s.textSelection.join('–')]);
    } else rows.push(['Semantics', 'none on this node']);
  } else {
    rows.push(['Class', String(element.type ?? '').replace(/^L|;$/g, '').replaceAll('/', '.')], ['Renderer type', element.viewKind ?? '—'], ['In the window', formatBounds(element.windowBounds, element.density)]);
    if (element.text) rows.push(['Text', element.text]);
    if (element.contentDescription) rows.push(['contentDescription', element.contentDescription]);
    rows.push(['Visible', element.placed ? 'yes' : `no (visibility ${element.visibility})`], ['Clickable', element.clickable ? 'yes' : 'no']);
    if (element.compose) rows.push(['Compose', 'hosts a composition: see the Compose elements']);
  }
  if (element.window && element.window.id !== null) rows.push(['Window', `${element.window.kind ?? 'window'} ${element.window.id}${element.window.modal ? ' · modal' : ''}`]);
  const problem = cropProblem(element); rows.push(['Crop', problem ? `no crop: ${problem}` : 'cut from the frame shown by the page']);
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
  // "Full tree" (on by default): every LayoutNode of the inspection instead of the boxes "Show layout bounds" draws
  let treeToggle = q('.ci-tree');
  if (!treeToggle && follow?.parentElement?.parentElement) { const label = document.createElement('label'); label.className = 'logcat-auto'; label.title = 'Shows every LayoutNode of the Compose tree, not only the boxes of \'Show layout bounds\''; treeToggle = document.createElement('input'); treeToggle.type = 'checkbox'; treeToggle.className = 'ci-tree'; label.append(treeToggle, ' Full tree'); follow.parentElement.after(label); }
  if (treeToggle) treeToggle.checked = true;
  const mode = () => treeToggle && !treeToggle.checked ? 'layout' : 'tree';
  const S = { capture: null, elements: [], visible: [], selected: null, frames: new Map(), thumbs: [], highlight: null, token: 0, waiters: [], followKey: null, followTimer: null, busy: false };
  const setCount = text => { count.textContent = text; };
  setCount('closed');

  const navigationKey = snapshot => {
    if (!snapshot) return null; const owner = snapshot.composeSemantics?.owners?.[0];
    return `${snapshot.activityName ?? ''}|${JSON.stringify(snapshot.navigation ?? null).slice(0, 400)}|${(owner?.nodes ?? []).slice(0, 24).map(node => node.nodeId).join(',')}`;
  };
  const release = () => {
    S.token++; clearTimeout(S.followTimer); S.followTimer = null;
    for (const canvas of S.thumbs) { canvas.width = 0; canvas.height = 0; } S.thumbs = [];
    for (const frame of S.frames.values()) { if (frame.canvas) { frame.canvas.width = 0; frame.canvas.height = 0; } } S.frames.clear();
    S.highlight?.remove(); S.highlight = null; S.capture = null; S.elements = []; S.visible = []; S.selected = null;
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
    const r = cropRect(element.cropBounds, size, frame); if (!r) return 'outside the visible area';
    const css = fit(r.sw, r.sh, maxW, maxH), ratio = Math.min(2, globalThis.devicePixelRatio || 1), px = fit(r.sw, r.sh, css.width * ratio, css.height * ratio);
    canvas.width = px.width; canvas.height = px.height; canvas.style.width = `${css.width}px`; canvas.style.height = "auto";   // height follows the canvas aspect, also when max-width narrows it
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(frame.canvas, r.sx, r.sy, r.sw, r.sh, 0, 0, px.width, px.height);
    if (element.layoutBounds) { const line = Math.max(1, Math.round(ratio)); ctx.strokeStyle = LAYOUT_BOUNDS_COLORS.bounds; ctx.lineWidth = line; ctx.strokeRect(line / 2, line / 2, px.width - line, px.height - line); }   // the box as "Mostrar limites de layout" draws it
    return null;
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

  const treeRows = () => [...body.querySelectorAll('.ci-row')];
  const select = (key, { focus = false } = {}) => {
    const element = S.elements.find(item => item.key === key); if (!element) return; S.selected = key;
    for (const row of treeRows()) { const on = row._key === key; row.setAttribute('aria-selected', String(on)); row.classList.toggle('selected', on); row.tabIndex = on ? 0 : -1; if (on && focus) { row.focus(); row.scrollIntoView?.({ block: 'nearest' }); } }
    const details = body.querySelector('.ci-details'); if (details) renderDetails(details, element);
    highlight(element);
  };
  const renderDetails = (pane, element) => {
    for (const old of pane.querySelectorAll('canvas')) { old.width = 0; old.height = 0; } S.thumbs = S.thumbs.filter(canvas => canvas.width > 0);
    const canvas = el('canvas', 'ci-detail-image'), note = el('p', 'ci-noimage'), problem = paint(element, canvas, DETAIL_W, DETAIL_H);
    if (problem) { canvas.hidden = true; note.textContent = `no crop: ${problem}`; } else { note.hidden = true; S.thumbs.push(canvas); }
    const list = el('dl', 'ci-props'); for (const [label, value] of detailRows(element)) list.append(el('dt', '', label), el('dd', '', String(value ?? '—')));
    pane.replaceChildren(el('h4', '', element.name), canvas, note, list);
  };
  const emptyDetails = () => el('p', 'logcat-empty', 'Click an element in the tree to see its crop and details.');

  const treeRow = (element, index) => {
    const row = el('div', 'ci-row'); row._key = element.key; row.tabIndex = -1; row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(Math.max(0, element.depth ?? 0) + 1)); row.setAttribute('aria-selected', 'false');
    row.style.setProperty?.('--ci-depth', String(Math.min(element.depth ?? 0, 24)));
    const { width, height } = sizeOf(element.windowBounds ?? element.bounds);
    row.append(el('span', 'ci-name', element.name), el('small', 'ci-kind', `${element.kind === 'compose' ? 'Compose' : 'View'} · ${width}×${height}`));
    row.addEventListener('click', () => select(element.key, { focus: true }));
    row.addEventListener('keydown', event => {
      const rows = treeRows(), at = rows.indexOf(row), to = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : null;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(element.key, { focus: true }); return; }
      if (to === null || !rows[to]) return; event.preventDefault(); select(rows[to]._key, { focus: true });
    });
    return row;
  };
  const renderList = () => {
    const capture = S.capture; if (!capture) return;
    for (const canvas of S.thumbs) { canvas.width = 0; canvas.height = 0; } S.thumbs = [];
    S.visible = S.elements.filter(element => matchesElement(element, filterInput.value));
    const compose = S.elements.filter(element => element.kind === 'compose').length, views = S.elements.length - compose;
    const status = el('p', 'ci-status'), notes = [...(capture.inspection?.notes ?? [])];
    for (const owner of capture.inspection?.owners ?? []) if (owner.names?.note) notes.push(owner.names.note);
    if (!capture.fullDensity) notes.push('the frame was still at reduced density (screen moving): crops are less sharp');
    status.textContent = `${mode() === 'layout' ? 'Layout bounds: ' : 'Full tree: '}${compose} Compose elements · ${views} Views${capture.inspection?.ms !== undefined ? ` · inspected in ${capture.inspection.ms} ms` : ''}${S.visible.length !== S.elements.length ? ` · ${S.visible.length} match the filter` : ''}${notes.length ? ' · ' + [...new Set(notes)].join(' · ') : ''}`;
    const split = el('div', 'ci-split'), tree = el('div', 'ci-tree'), details = el('div', 'ci-details');
    tree.setAttribute('role', 'tree'); tree.setAttribute('aria-label', 'Screen elements');
    if (S.visible.length) tree.append(...S.visible.map(treeRow)); else tree.append(el('p', 'logcat-empty', S.elements.length ? 'No element matches the filter.' : 'No element on the screen.'));
    details.append(emptyDetails()); split.append(tree, details);
    body.replaceChildren(status, split);
    setCount(`${compose} Compose · ${views} Views`);
    if (S.selected && !S.visible.some(element => element.key === S.selected)) S.selected = null;
    const rows = treeRows(); if (rows[0]) rows[0].tabIndex = 0;
    if (S.selected) select(S.selected); else highlight(null);
  };

  const capture = async () => {
    if (!root.open || S.busy) return; S.busy = true; const token = ++S.token; captureButton.disabled = true; setCount('capturing…');
    if (!S.capture) body.replaceChildren(el('p', 'logcat-empty', 'Capturing the screen…'));
    try {
      const snapshot = await fullDensity(); if (token !== S.token || !root.open) return;
      if (!snapshot) { body.replaceChildren(el('p', 'logcat-empty', 'No app is running. Run an APK and capture again.')); setCount('no screen'); return; }
      const inspection = await inspect(); if (token !== S.token || !root.open) return;
      const shownNow = getSnapshot() ?? snapshot;
      for (const frame of S.frames.values()) if (frame.canvas) { frame.canvas.width = 0; frame.canvas.height = 0; } S.frames.clear();
      S.capture = { inspection, snapshot: shownNow, fullDensity: !shownNow.rasterReduced, capturedAt: new Date().toISOString() }; S.followKey = navigationKey(shownNow);
      S.elements = buildElements(inspection, shownNow, { mode: mode() });
      for (const element of S.elements) if (element.hostId !== null && element.hostId !== undefined) freeze(element.hostId);   // the frame of this capture, before the screen moves on
      renderList();
    } catch (error) {
      if (token !== S.token) return;
      body.replaceChildren(el('p', 'logcat-empty', `Could not inspect the screen: ${String(error?.message ?? error).slice(0, 300)}`)); setCount('error');
    } finally { if (token === S.token) { S.busy = false; captureButton.disabled = false; } else S.busy = false; }
  };

  root.addEventListener('toggle', () => { if (root.open) capture(); else { release(); setCount('closed'); } });
  captureButton.addEventListener('click', () => capture());
  filterInput.addEventListener('input', () => { if (S.capture) renderList(); });
  treeToggle?.addEventListener('change', () => { if (S.capture) { S.elements = buildElements(S.capture.inspection, S.capture.snapshot, { mode: mode() }); S.selected = null; renderList(); } });
  copyButton.addEventListener('click', async () => {
    if (!S.capture) return; const label = copyButton.textContent;
    try { await copyText(exportJSON(S.capture)); copyButton.textContent = 'Copied'; } catch { copyButton.textContent = 'Failed'; }
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
      { const pane = body.querySelector('.ci-details'), chosen = S.elements.find(element => element.key === S.selected); if (pane && chosen && pane.querySelector('.ci-noimage')?.textContent.includes(NO_RASTER)) renderDetails(pane, chosen); }   // the app drew: cut what was waiting
      if (follow?.checked && S.capture && !S.busy && navigationKey(snapshot) !== S.followKey) { clearTimeout(S.followTimer); S.followTimer = setTimeout(() => { S.followTimer = null; capture(); }, 600); }
    },
    /** A new run: what the panel shows belongs to the previous one. */
    reset() { const open = root.open; release(); setCount(open ? 'no capture' : 'closed'); if (open) body.replaceChildren(el('p', 'logcat-empty', 'Run the APK and use Capture.')); },
  };
}
