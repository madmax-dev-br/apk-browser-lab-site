// The "Layout" panel of the lab page: a one-shot inspection of the screen's layout, XML Views and Compose alike (src/compose-inspector.js, run in the Worker, and the snapshot's
// Views). The kind of screen is detected (screenKind: XML Views, Compose, or both) and shown in one tree: the View hierarchy, each AndroidComposeView with its LayoutNodes under it.
// After a capture the panel shows the status line and a two-column split: on the left the elements as a tree (one row per element, indented by depth, with its name, kind and
// size; a filterable list that scrolls inside its column), on the right the details of the clicked element (its crop cut from the frame the page shows, name, properties). Until an
// element is clicked the right column is an empty state and no crop is cut; selecting an element cuts exactly one crop and highlights the element on the device screen.
// Nothing runs while the panel is closed: no Worker message, no DOM, no images. Opening captures once; "Capture" takes a new capture (keeping the selection when the same element
// is still there); "Update on navigation" (off by default) captures again after the screen navigates. Closing drops the DOM, the frozen frame and every crop.
// "Full tree" is on by default: every LayoutNode of the inspection. Off, the elements are the boxes of lab.layoutBounds() (Views and Compose semantics nodes; the overlay of
// src/layout-bounds.js also outlines the LayoutNodes and layout modifiers without semantics), each crop outlined and named from the inspected LayoutNode with the same semanticsId.
// "Count recompositions" (src/compose-recompositions.js, off by default, only while the panel is open; the choice is kept per viewer): each Compose row and the details show the
// composable and how many times the element was recomposed and skipped, the box of an element that recomposes blinks once on the device screen and its row once in the tree, a table
// lists the composables (with or without an element of their own) with what their recompositions were for and which ones need review, a click on one selects and highlights its elements,
// the bar shows the total and "Reset recomposition counts" sets it all back to 0. The counts belong to the
// element's key (owner View and semanticsId, never reused), so an element that leaves the screen takes its count with it; a capture reads them again from the Worker.
// The tree is a role="tree" of role="treeitem" rows (aria-level = depth + 1): ArrowUp / ArrowDown move the selection, Home / End jump, Enter / Space select.
// The pure functions (element list, crop rectangles, bounds text, filter, JSON) are exported and tested without a DOM; createComposeInspectorPanel() wires them to the page.

import { LAYOUT_BOUNDS_COLORS } from './layout-bounds.js?v=109fde337e64';

const NO_RASTER = 'the displayed frame has no content raster for this element';
const DETAIL_W = 360, DETAIL_H = 260;
const COUNT_KEY = 'apkweb.layout.countRecompositions';   // the viewer's choice: '1' = count when the panel opens
export const MAX_COMPOSABLE_ROWS = 300;   // rows of the table in the DOM (the status says how many there are)
export const BLINK_MS = 700, MAX_BLINKS = 48;   // how long a recomposed element's box stays on the device screen (the fade of .ci-blink), and how many at once
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
      androidId: view.androidId ?? null, resourceName: typeof view.resourceName === 'string' ? view.resourceName : null, visibility: view.visibility ?? 0, visible, clickable: !!(view.hasClickListener ?? view.clickable), compose: /AndroidComposeView;$/.test(String(view.type ?? '')),
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
        placed: true, attached: true, zIndex: match?.zIndex ?? null, measurePolicy: match?.measurePolicy ?? null, modifiers: match?.modifiers ?? [], semantics, calls: match?.calls ?? [], window: match?.window ?? ownerView.window, density, layoutBounds: true, ...recompositionOf(inspection, match) });
    }
  }
  for (const element of viewElements(views, viewById, density)) if (element.bounds && element.placed) list.push({ ...element, layoutBounds: true });
  return list;
}

/** The counts of an element, only in an inspection taken while counting: a node without any says why (never a made-up 0). */
const recompositionOf = (inspection, node) => inspection?.recompositions?.counting ? { recomposition: node?.recomposition ?? { available: false, reason: 'this element has no LayoutNode in the inspection' } } : {};
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
/** The row badge of an element: { text, title, zero }, or null when it has no count. */
export function recompositionBadge(recomposition) {
  if (!recomposition?.available) return null; const { recompositions: n, skips } = recomposition;
  return { text: `↻ ${n}${skips ? ` · skip ${skips}` : ''}`, title: `${plural(n, 'recomposition')}, ${plural(skips, 'skip')}${recomposition.shared ? ' (of the restart group above it, which emits this element)' : ''}`, zero: n === 0 };
}
/** The total line of the panel: the counting status in words. */
export function recompositionTotal(status, on = true) {
  if (!on) return 'not counting'; if (!status) return 'counting…';
  if (!status.counting) return `not available: ${status.reason ?? 'counting is off'}`;
  return `Total: ${plural(status.total, 'recomposition')} · ${plural(status.skips, 'skip')}${status.unjoined ? ` · ${status.unjoined} in composables with no element of their own on the screen` : ''}${status.review ? ` · ${plural(status.review, 'composable')} to review` : ''}${status.note ? ` · ${status.note}` : ''}${status.evidence ? ` · ${status.evidence}` : ''}`;
}
const recompositionRows = recomposition => {
  if (!recomposition) return [];
  if (!recomposition.available) return [['Recompositions', `not available: ${recomposition.reason}`]];
  const rows = [['Composable', recomposition.label ? `${recomposition.label}${recomposition.composable?.obfuscated ? ' (obfuscated name)' : ''}` : 'not known yet: it is named when it is composed while counting'], ['Recompositions', `${recomposition.recompositions}${recomposition.shared ? ' (of the restart group above it: this element has none of its own)' : ''}`], ['Skips', String(recomposition.skips)]];
  if (recomposition.groups?.length > 1) rows.push(['Restart groups', `${recomposition.groups.length}, outermost first: ${recomposition.groups.map(group => `${group.composable ? `${group.composable.name} ` : ''}${group.recompositions}${group.skips ? ` (skip ${group.skips})` : ''}`).join(' › ')}`]);
  return rows;
};

/** What a row of the composables table says about its recompositions: only what was measured. */
export const causeText = row => [['needed', row.needed], ['likely avoidable', row.avoidable], ['unnecessary', row.unnecessary], ['unknown', row.unknown]].filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}`).join(' · ') || '—';
const SORTS = { name: (a, b) => a.name.localeCompare(b.name), recompositions: (a, b) => b.recompositions - a.recompositions, skips: (a, b) => b.skips - a.skips, instances: (a, b) => b.instances - a.instances, review: (a, b) => (b.review.length > 0) - (a.review.length > 0) || (b.unnecessary + b.avoidable) - (a.unnecessary + a.avoidable) };
/** The rows of the table in the order of `sort`, equal ones by recompositions, skips and name; the ones whose name, class or reasons have every word of `filter`. */
export function sortComposables(rows, sort = 'recompositions', filter = '') {
  const words = String(filter).toLowerCase().split(/\s+/).filter(Boolean), text = row => [row.name, row.declaredIn, row.detail, ...row.reasons.map(item => item.reason)].join('\n').toLowerCase();
  return rows.filter(row => words.every(word => text(row).includes(word))).sort((a, b) => SORTS[sort](a, b) || SORTS.recompositions(a, b) || SORTS.skips(a, b) || (a.key < b.key ? -1 : 1));
}
/** Whether an element is one of a composable's: it is emitted by it, or the composable is one of the restart groups between its parent element and it. */
export const elementOfComposable = (element, key) => element.kind === 'compose' && !!element.recomposition?.available && (element.recomposition.composable?.key === key || (element.recomposition.groups ?? []).some(group => group.composable?.key === key));
export const REVIEW_NOTE = 'An indication of what to analyse, not a verdict: "unnecessary" ran with the same inputs and nothing it reads changed, "likely avoidable" ran because an input is a new instance with the same content, "unknown" lacks evidence. Needs review: 3 or more of those two, at least half of the ones with a known cause. Frequent: 10 in one second, or 2 in one frame, of one instance.';

const viewElements = (views, viewById, density) => views.map(view => {
  const label = view.text || view.contentDescription;
  return { key: `v:${view.id}`, kind: 'view', name: `${simple(view.type)}${view.resourceName ? ` #${view.resourceName}` : ''}${label ? ` "${label.length > 40 ? label.slice(0, 39) + '…' : label}"` : ''}`, nameSource: 'view', id: view.id, parentName: view.parentId !== null ? simple(viewById.get(String(view.parentId))?.type) : null,
    depth: view.depth, hostId: view.rasterHostId, hostSize: view.rasterHostId === null ? null : sizeOf(viewById.get(String(view.rasterHostId))?.bounds), cropBounds: view.rasterBounds, bounds: view.bounds, visibleBounds: view.bounds, windowBounds: view.bounds, placed: view.visible,
    zIndex: null, type: view.type, viewKind: view.kind, text: view.text, contentDescription: view.contentDescription, androidId: view.androidId, resourceName: view.resourceName ?? null, visibility: view.visibility, clickable: view.clickable, compose: view.compose, window: view.window, density };
});

/** One list for the carousel and the table: the Compose elements of the inspection (by owner), then the Views of the snapshot. */
export function buildElements(inspection, snapshot, { mode = 'tree' } = {}) {
  if (mode === 'layout') return buildLayoutBoundsElements(inspection, snapshot);
  const density = inspection?.density ?? snapshot?.density ?? null, list = [], views = flattenViews(snapshot), viewById = new Map(views.map(view => [String(view.id), view]));
  // one tree: the Views in drawing order, and under each AndroidComposeView the LayoutNodes of its composition (an owner whose View is not in the snapshot comes last)
  const owners = new Map((inspection?.owners ?? []).map(owner => [String(owner.ownerViewId), owner]));
  const nodesOf = (owner, base) => {
    const ownerView = viewById.get(String(owner.ownerViewId)), names = new Map(owner.nodes.map(node => [node.id, node.name]));
    for (const node of owner.nodes) {
      list.push({ key: `c:${node.id}`, kind: 'compose', name: node.name, nameSource: node.nameSource, id: node.semanticsId, ownerViewId: owner.ownerViewId, parentName: node.parentId ? names.get(node.parentId) ?? null : null,
        depth: base + node.depth, childCount: node.childCount, hostId: owner.ownerViewId, hostSize: { width: owner.width, height: owner.height }, cropBounds: node.visibleBounds, bounds: node.bounds, visibleBounds: node.visibleBounds,
        windowBounds: node.boundsInWindow ?? (ownerView?.bounds && node.visibleBounds ? shift(node.visibleBounds, ownerView.bounds) : null), placed: node.placed, attached: node.attached, zIndex: node.zIndex,
        measurePolicy: node.measurePolicy, modifiers: node.modifiers ?? [], semantics: node.semantics, calls: node.calls ?? [], window: owner.window, density, ...recompositionOf(inspection, node) });
    }
  };
  for (const element of viewElements(views, viewById, density)) {
    list.push(element);
    const owner = owners.get(String(element.id)); if (owner) { owners.delete(String(element.id)); nodesOf(owner, element.depth + 1); }
  }
  for (const owner of owners.values()) nodesOf(owner, 0);
  return list;
}
/**
 * What the screen is made of: 'compose' when every content View is part of a composition (the Views around an AndroidComposeView are only its containers), 'xml' without any
 * AndroidComposeView, 'mixed' with both, 'empty' with no View. Views inside an AndroidComposeView (its ViewLayers, ripples, interop hosts' layers) belong to the composition.
 */
export function screenKind(snapshot) {
  const views = flattenViews(snapshot); if (!views.length) return 'empty';
  const byId = new Map(views.map(view => [String(view.id), view])), hosts = views.filter(view => view.compose); if (!hosts.length) return 'xml';
  const containers = new Set(), inside = new Set();
  for (const host of hosts) for (let at = byId.get(String(host.parentId)); at; at = byId.get(String(at.parentId))) containers.add(String(at.id));
  for (const view of views) for (let at = view; at; at = byId.get(String(at.parentId))) if (at.compose) { inside.add(String(view.id)); break; }
  return views.some(view => !containers.has(String(view.id)) && !inside.has(String(view.id)) && view.visible && view.bounds) ? 'mixed' : 'compose';
}
export const SCREEN_KINDS = { xml: 'XML Views', compose: 'Compose', mixed: 'XML Views + Compose', empty: 'no View' };
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
    ...(s ? [...(s.texts ?? []), s.editableText, s.testTag, s.role, ...(s.contentDescriptions ?? []), ...(s.actions ?? [])] : []), ...(element.calls ?? []), element.recomposition?.label].filter(Boolean).join('\n').toLowerCase();
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
  rows.push(...recompositionRows(element.recomposition));
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
    rows.push(['Class', String(element.type ?? '').replace(/^L|;$/g, '').replaceAll('/', '.')]);
    if (element.androidId > 0) rows.push(['Resource id', element.resourceName ? `@id/${element.resourceName} (0x${(element.androidId >>> 0).toString(16)})` : `0x${(element.androidId >>> 0).toString(16)}`]);
    rows.push(['Renderer type', element.viewKind ?? '—'], ['In the window', formatBounds(element.windowBounds, element.density)]);
    if (element.text) rows.push(['Text', element.text]);
    if (element.contentDescription) rows.push(['contentDescription', element.contentDescription]);
    rows.push(['Visible', element.placed ? 'yes' : `no (visibility ${element.visibility})`], ['Clickable', element.clickable ? 'yes' : 'no']);
    if (element.compose) rows.push(['Compose', 'hosts a composition: its LayoutNodes are listed under it']);
  }
  if (element.window && element.window.id !== null) rows.push(['Window', `${element.window.kind ?? 'window'} ${element.window.id}${element.window.modal ? ' · modal' : ''}`]);
  const problem = cropProblem(element); rows.push(['Crop', element.kind === 'view' && element.placed && (element.hostId === null || element.hostId === undefined) ? 'built from the page\'s element of this View (drawn by the page DOM)' : problem ? `no crop: ${problem}` : 'cut from the frame shown by the page']);
  return rows;
}

/**
 * root: the <details id="compose-inspector"> element (see index.html).
 * inspect(): Promise of the Worker's inspection (APKWorkerClient.inspectCompose). getSnapshot(): the snapshot the device shows. getHost(viewId): the element of a View on the
 * device (its _contentLayer is the raster to cut). getScreen(): the #android-screen element (the highlight's parent). copyText(text): Promise (clipboard).
 * recompositions: { sync(on): Promise of the counting status or null, reset(): the same } (APKWorkerClient.syncRecompositions / resetRecompositions); without it nothing is counted.
 * Returns { rendered(snapshot), recomposed(update), reset(), capture(), state }.
 */
export function createComposeInspectorPanel({ root, inspect, getSnapshot = () => null, getHost = () => null, getScreen = () => null, copyText = text => navigator.clipboard.writeText(text), fullDensityWaitMs = 2000, domImage = null, resourceNames = null, recompositions = null, blinkMs = BLINK_MS, storage = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })() } = {}) {
  const q = selector => root.querySelector(selector), body = q('.ci-body'), count = q('.ci-count'), captureButton = q('.ci-capture'), follow = q('.ci-follow'), filterInput = q('.ci-filter'), copyButton = q('.ci-copy');
  const el = (tag, className = '', text = null) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== null) node.textContent = text; return node; };
  // "Full tree" (on by default): every LayoutNode of the inspection instead of the boxes "Show layout bounds" draws
  let treeToggle = q('.ci-tree');
  if (!treeToggle && follow?.parentElement?.parentElement) { const label = document.createElement('label'); label.className = 'logcat-auto'; label.title = 'Shows every LayoutNode of the Compose tree, not only the boxes of \'Show layout bounds\''; treeToggle = document.createElement('input'); treeToggle.type = 'checkbox'; treeToggle.className = 'ci-tree'; label.append(treeToggle, ' Full tree'); follow.parentElement.after(label); }
  if (treeToggle) treeToggle.checked = true;
  if (follow) follow.checked = true;   // automatic: a new screen is captured again (only while the panel is open)
  const mode = () => treeToggle && !treeToggle.checked ? 'layout' : 'tree';
  const S = { capture: null, elements: [], visible: [], selected: null, frames: new Map(), thumbs: [], highlight: null, token: 0, waiters: [], followKey: null, followTimer: null, busy: false, recomposition: null, blinks: new Map(), rowBlinks: new Map(), composables: new Map(), composable: null, marks: [], sort: 'recompositions', orderedAt: 0, table: null };
  const countToggle = q('.ci-recompose'), totalLine = q('.ci-recompose-total'), resetCounts = q('.ci-recompose-reset');
  if (countToggle) { try { countToggle.checked = storage?.getItem(COUNT_KEY) === '1'; } catch { countToggle.checked = false; } }   // off unless this viewer turned it on
  const counting = () => !!recompositions && root.open && !!countToggle?.checked;
  const setCount = text => { count.textContent = text; };
  setCount('closed');

  const navigationKey = snapshot => {
    if (!snapshot) return null; const owner = snapshot.composeSemantics?.owners?.[0];
    return `${snapshot.activityName ?? ''}|${JSON.stringify(snapshot.navigation ?? null).slice(0, 400)}|${(owner?.nodes ?? []).slice(0, 24).map(node => node.nodeId).join(',')}`;
  };
  // recomposition counts
  /** "Copy JSON" has the status and the table as they are now. */
  const syncJSON = () => { if (S.capture?.inspection?.recompositions?.counting) S.capture.inspection.recompositions = { ...S.recomposition, composables: sortComposables([...S.composables.values()]) }; };
  const showTotal = () => { const text = counting() ? recompositionTotal(S.recomposition) : 'not counting'; if (totalLine && totalLine.textContent !== text) totalLine.textContent = text; if (resetCounts) resetCounts.disabled = !(counting() && S.recomposition?.counting); };
  /** Counting on or off in the Worker, as the panel and its toggle are now (a message only when that changes). */
  const syncCounting = async () => {
    if (!recompositions) return;
    const on = counting(), status = await recompositions.sync(on);
    if (on !== counting()) return;
    if (!on) { S.recomposition = null; S.composables.clear(); clearBlinks(); } else if (status) S.recomposition = status;
    showTotal();
  };
  const clearBlinks = () => { for (const { mark, timer } of S.blinks.values()) { clearTimeout(timer); mark.remove(); } S.blinks.clear(); for (const { row, timer } of S.rowBlinks.values()) { clearTimeout(timer); row.classList.remove('ci-row-blink'); } S.rowBlinks.clear(); };
  /** The same blink on the element's row of the tree, when it has one: no scroll, no focus, the colour and the time of the box on the screen. */
  const blinkRow = (key, row) => {
    const old = S.rowBlinks.get(key); if (old) { clearTimeout(old.timer); old.row.classList.remove('ci-row-blink'); void row.offsetWidth; }   // the reflow restarts the animation
    row.style.setProperty?.('--ci-blink-ms', `${blinkMs}ms`); row.classList.add('ci-row-blink');
    const entry = { row, timer: setTimeout(() => { row.classList.remove('ci-row-blink'); if (S.rowBlinks.get(key) === entry) S.rowBlinks.delete(key); }, blinkMs) }; entry.timer?.unref?.(); S.rowBlinks.set(key, entry);
  };
  /** One short highlight over the element's box; a second recomposition restarts it. The box never takes pointer input (.ci-blink) and is removed when it ends. */
  const blink = (key, box) => {
    const old = S.blinks.get(key); if (old) { clearTimeout(old.timer); old.mark.remove(); S.blinks.delete(key); }
    if (S.blinks.size >= MAX_BLINKS) { const [first, entry] = S.blinks.entries().next().value; clearTimeout(entry.timer); entry.mark.remove(); S.blinks.delete(first); }
    const mark = el('div', 'ci-blink'); mark.setAttribute('aria-hidden', 'true'); mark.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`; mark.style.animationDuration = `${blinkMs}ms`;
    const entry = { mark, timer: setTimeout(() => { mark.remove(); if (S.blinks.get(key) === entry) S.blinks.delete(key); }, blinkMs) }; entry.timer?.unref?.();
    S.blinks.set(key, entry); getScreen()?.append(mark);
  };
  const setBadge = (row, element) => {
    const label = element.recomposition?.label ?? null, chip = row.querySelector('.ci-composable');
    if (!label) chip?.remove(); else { const node = chip ?? el('span', 'ci-composable'), text = element.recomposition.shared ? `in ${label}` : label; if (node.textContent !== text) node.textContent = text; node.classList.toggle('shared', !!element.recomposition.shared); node.title = `${text}${element.recomposition.composable?.obfuscated ? ' (obfuscated name)' : ''}: the composable this element belongs to`; if (!chip) row.prepend(node); }
    const badge = recompositionBadge(element.recomposition), at = row.querySelector('.ci-recount');
    if (!badge) { at?.remove(); return; }
    const node = at ?? el('span', 'ci-recount'); node.textContent = badge.text; node.title = badge.title; node.setAttribute('aria-label', badge.title); node.setAttribute('aria-live', 'off'); node.classList.toggle('zero', badge.zero);
    if (!at) row.append(node);
  };
  /** The counts of these elements changed (key -> recomposition): their rows and the details of the selected one. */
  const setCounts = changed => {
    const byKey = new Map(S.elements.map(element => [element.key, element])), shown = new Map(treeRows().map(row => [row._key, row]));
    for (const [key, recomposition] of changed) {
      const element = byKey.get(key); if (!element?.recomposition) continue;   // not in this capture: the next one lists it with its counts
      Object.assign(element.recomposition, recomposition); const row = shown.get(key); if (row) setBadge(row, element);   // the node of the capture shares the object: "Copy JSON" has the counts too
      if (key === S.selected) { const list = body.querySelector('.ci-props'); if (list) { list.setAttribute('aria-live', 'off'); fillProps(list, element); } }   // a running count is not read out
    }
  };
  // ---- the composables table
  const COLUMNS = [['name', 'Composable'], ['recompositions', '↻', 'Recompositions'], ['skips', 'Skips'], ['instances', 'Inst.', 'Instances: the restart groups of it seen while counting'], ['review', 'Why', 'What the recompositions were for; sorts the ones to review first']];
  const tableRow = row => {
    const tr = el('tr', 'ci-crow'); tr._key = row.key; tr.tabIndex = -1;
    const name = el('td', 'ci-cname'), why = el('td', 'ci-cwhy'); tr.append(name, el('td', 'ci-cnum'), el('td', 'ci-cnum'), el('td', 'ci-cnum'), why);
    const choose = () => selectComposable(row.key); tr.addEventListener('click', choose);
    tr.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); return; }
      const rows = [...S.table.body.children], to = event.key === 'ArrowDown' ? rows.indexOf(tr) + 1 : event.key === 'ArrowUp' ? rows.indexOf(tr) - 1 : -1; if (!rows[to]) return; event.preventDefault(); for (const item of rows) item.tabIndex = item === rows[to] ? 0 : -1; rows[to].focus();
    });
    return tr;
  };
  const fillRow = (tr, row) => {
    const [name, recomposed, skipped, instances, why] = tr.children;
    name.replaceChildren(el('b', '', row.name), el('small', '', `${row.declaredIn}${row.obfuscated ? ' · obfuscated name' : ''}${row.library ? ' · library' : ''}`)); name.title = row.detail;
    recomposed.textContent = String(row.recompositions); skipped.textContent = String(row.skips); instances.textContent = String(row.instances);
    why.replaceChildren(); if (row.review.length) { const flag = el('span', 'ci-review', 'needs review'); flag.title = row.review.map(item => `${item.count}× ${item.reason}`).join('\n'); why.append(flag); }
    if (row.frequent.length) { const flag = el('span', 'ci-frequent', 'frequent'); flag.title = row.frequent.join(', '); why.append(flag); }
    why.append(el('span', 'ci-causes', causeText(row)));
    if (row.key === S.composable) { const reasons = el('ul', 'ci-reasons'); for (const item of row.reasons) reasons.append(el('li', '', `${item.count}× ${item.reason}`)); for (const text of row.frequent) reasons.append(el('li', '', `frequent: ${text}`)); if (!reasons.children.length) reasons.append(el('li', '', 'only skipped')); reasons.append(el('li', '', elementsText(row.key)), el('li', '', `${row.source}: ${row.detail}`)); why.append(reasons); }
    tr.classList.toggle('selected', row.key === S.composable); tr.setAttribute('aria-selected', String(row.key === S.composable)); tr.classList.toggle('flagged', row.review.length > 0);
  };
  const elementsText = key => { const n = S.elements.filter(element => elementOfComposable(element, key)).length; return n ? `${plural(n, 'element')} on this capture` : 'no element of its own on this capture'; };
  /** Builds or updates the table in place: a row keeps its DOM element, and the order is not changed under the pointer. */
  const renderComposables = ({ order = true } = {}) => {
    const t = S.table; if (!t) return;
    const all = [...S.composables.values()], rows = sortComposables(all, S.sort, filterInput.value), shown = rows.slice(0, MAX_COMPOSABLE_ROWS), review = all.filter(row => row.review.length).length;
    t.title.textContent = `Composables: ${all.length}${rows.length !== all.length ? ` · ${rows.length} match the filter` : ''}${rows.length > shown.length ? ` · the first ${shown.length}` : ''}${review ? ` · ${review} to review` : ''}`;
    const keys = new Set(shown.map(row => row.key)); for (const [key, tr] of t.rows) if (!keys.has(key)) { tr.remove(); t.rows.delete(key); }
    const hovered = !order && !!t.body.matches?.(':hover');
    for (const row of shown) { let tr = t.rows.get(row.key); if (!tr) { t.rows.set(row.key, tr = tableRow(row)); t.body.append(tr); } const selected = row.key === S.composable; if (tr._row !== row || tr._selected !== selected || selected) { tr._row = row; tr._selected = selected; fillRow(tr, row); } }
    if (!hovered && (order || Date.now() - S.orderedAt > 1000)) { S.orderedAt = Date.now(); const now = [...t.body.children]; if (shown.some((row, i) => now[i]?._key !== row.key)) { const focus = document.activeElement; for (const row of shown) t.body.append(t.rows.get(row.key)); if (focus?.isConnected && t.body.contains?.(focus)) focus.focus({ preventScroll: true }); } }
    const first = t.body.children[0]; if (first && ![...t.body.children].some(tr => tr.tabIndex === 0)) first.tabIndex = 0;
    for (const th of t.heads) { const on = th._sort === S.sort; th.setAttribute('aria-sort', on ? (S.sort === 'name' ? 'ascending' : 'descending') : 'none'); th.classList.toggle('sorted', on); }
    t.empty.hidden = all.length > 0;
  };
  const composablesTable = () => {
    if (!counting() || !S.recomposition?.counting) { S.table = null; return null; }
    const box = el('details', 'ci-composables'); box.open = S.table?.box.open ?? true; const title = el('summary'), scroll = el('div', 'ci-ctable'), table = el('table'), head = el('thead'), tr = el('tr'), tbody = el('tbody'), heads = [];
    for (const [sort, text, hint] of COLUMNS) { const th = el('th'), button = el('button', '', text); th._sort = sort; button.type = 'button'; button.title = hint ?? `Sort by ${text.toLowerCase()}`; button.addEventListener('click', () => { S.sort = sort; renderComposables(); }); th.append(button); heads.push(th); tr.append(th); }
    table.setAttribute('aria-label', 'Composables and their recompositions'); scroll.setAttribute('aria-live', 'off'); head.append(tr); table.append(head, tbody);
    const empty = el('p', 'logcat-empty', 'Nothing recomposed since counting started or was reset. Use the app.'); scroll.append(table, empty); box.append(title, el('p', 'ci-cnote', REVIEW_NOTE), scroll);
    S.table = { box, title, body: tbody, rows: new Map(), heads, empty }; renderComposables(); return box;
  };
  const clearMarks = () => { for (const mark of S.marks) mark.remove(); S.marks = []; };
  /** The elements of the selected composable, outlined on the screen (as many as MAX_BLINKS) and marked in the tree. */
  const markComposable = () => {
    clearMarks(); const hits = S.composable ? S.elements.filter(element => elementOfComposable(element, S.composable)) : [], keys = new Set(hits.map(element => element.key));
    for (const row of treeRows()) row.classList.toggle('of-composable', keys.has(row._key));
    for (const element of hits.slice(0, MAX_BLINKS)) { const box = element.placed ? boxOf(element) : null; if (!box) continue; const mark = el('div', 'ci-highlight ci-highlight-composable'); mark.setAttribute('aria-hidden', 'true'); mark.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`; getScreen().append(mark); S.marks.push(mark); }
    return hits;
  };
  /** A click on a composable: its elements are outlined and marked, the first one is selected (its details, its row in view); clicked again, nothing is. */
  const selectComposable = key => {
    S.composable = S.composable === key ? null : key; renderComposables({ order: false });
    const hits = markComposable(), row = hits.length ? treeRows().find(item => item._key === hits[0].key) : null;
    if (row) { select(row._key); row.scrollIntoView?.({ block: 'nearest' }); }
  };
  const release = () => {
    clearBlinks(); clearMarks(); S.recomposition = null; S.composables.clear(); S.composable = null; S.table = null;
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

  /** Where an element is in the #android-screen, in its own px, or null. */
  const boxOf = element => {
    const screen = getScreen(), host = getHost(element.kind === 'compose' ? element.hostId : element.id); if (!screen || !host?.getBoundingClientRect || !screen.getBoundingClientRect) return null;
    const sr = screen.getBoundingClientRect(), hr = host.getBoundingClientRect(), scale = screen.offsetWidth > 0 ? sr.width / screen.offsetWidth : 1;
    let box;
    if (element.kind === 'compose') { const b = element.visibleBounds; if (!b || !(b.right > b.left && b.bottom > b.top)) return null; const k = host.offsetWidth > 0 ? hr.width / host.offsetWidth : scale; box = { left: (hr.left - sr.left) / scale + b.left * k / scale, top: (hr.top - sr.top) / scale + b.top * k / scale, width: (b.right - b.left) * k / scale, height: (b.bottom - b.top) * k / scale }; }
    else box = { left: (hr.left - sr.left) / scale, top: (hr.top - sr.top) / scale, width: hr.width / scale, height: hr.height / scale };
    return box.width > 0 && box.height > 0 ? box : null;
  };
  const highlight = element => {
    S.highlight?.remove(); S.highlight = null; if (!element || !element.placed) return;   // nothing on the screen to point at
    const box = boxOf(element); if (!box) return;
    const mark = el('div', 'ci-highlight'); mark.setAttribute('aria-hidden', 'true'); mark.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
    getScreen().append(mark); S.highlight = mark;
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
    if (element.kind === 'view' && element.placed && domImage) {   // a View the page draws with its DOM (an XML widget, or a raster with DOM children over it): the image of its element
      const token = S.token; if (problem) note.textContent = 'building the image of this View from the page…';
      Promise.resolve().then(() => domImage(element, canvas)).then(done => {
        if (token !== S.token || !canvas.isConnected) return; if (!done) { if (problem) note.textContent = `no crop: ${problem}`; return; }
        const css = fit(canvas.width, canvas.height, DETAIL_W, DETAIL_H); canvas.style.width = `${css.width}px`; canvas.style.height = 'auto'; canvas.hidden = false; note.hidden = true; if (!S.thumbs.includes(canvas)) S.thumbs.push(canvas);
      }, error => { if (token === S.token && canvas.isConnected && problem) note.textContent = `no crop: ${String(error?.message ?? error).slice(0, 200)}`; });
    }
    const list = el('dl', 'ci-props'); fillProps(list, element);
    pane.replaceChildren(el('h4', '', element.name), canvas, note, list);
  };
  const fillProps = (list, element) => { list.replaceChildren(); for (const [label, value] of detailRows(element)) list.append(el('dt', '', label), el('dd', '', String(value ?? '—'))); };
  const emptyDetails = () => el('p', 'logcat-empty', 'Click an element in the tree to see its crop and details.');

  const treeRow = (element, index) => {
    const row = el('div', 'ci-row'); row._key = element.key; row.tabIndex = -1; row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(Math.max(0, element.depth ?? 0) + 1)); row.setAttribute('aria-selected', 'false');
    row.style.setProperty?.('--ci-depth', String(Math.min(element.depth ?? 0, 24)));
    const { width, height } = sizeOf(element.windowBounds ?? element.bounds);
    row.append(el('span', 'ci-name', element.name), el('small', 'ci-kind', `${element.kind === 'compose' ? 'Compose' : 'View'} · ${width}×${height}`));
    setBadge(row, element);
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
    const kind = screenKind(capture.snapshot);
    status.textContent = `Screen: ${SCREEN_KINDS[kind]} · ${mode() === 'layout' ? 'layout bounds: ' : 'full tree: '}${views} Views${compose || kind !== 'xml' ? ` · ${compose} Compose elements` : ''}${capture.inspection?.ms !== undefined ? ` · inspected in ${capture.inspection.ms} ms` : ''}${S.visible.length !== S.elements.length ? ` · ${S.visible.length} match the filter` : ''}${notes.length ? ' · ' + [...new Set(notes)].join(' · ') : ''}`;
    const split = el('div', 'ci-split'), tree = el('div', 'ci-tree'), details = el('div', 'ci-details');
    tree.setAttribute('role', 'tree'); tree.setAttribute('aria-label', 'Screen elements');
    if (S.visible.length) tree.append(...S.visible.map(treeRow)); else tree.append(el('p', 'logcat-empty', S.elements.length ? 'No element matches the filter.' : 'No element on the screen.'));
    details.append(emptyDetails()); split.append(tree, details);
    const table = composablesTable(); body.replaceChildren(...[status, table, split].filter(Boolean));
    setCount(kind === 'xml' ? `XML · ${views} Views` : kind === 'compose' ? `Compose · ${compose} nodes` : `XML + Compose · ${views} Views · ${compose} nodes`);
    if (S.selected && !S.visible.some(element => element.key === S.selected)) S.selected = null;
    const rows = treeRows(); if (rows[0]) rows[0].tabIndex = 0;
    if (S.selected) select(S.selected); else highlight(null);
    markComposable();
  };

  const capture = async () => {
    if (!root.open || S.busy) return; S.busy = true; const token = ++S.token; captureButton.disabled = true; setCount('capturing…');
    if (!S.capture) body.replaceChildren(el('p', 'logcat-empty', 'Capturing the screen…'));
    try {
      const snapshot = await fullDensity(); if (token !== S.token || !root.open) return;
      if (!snapshot) { body.replaceChildren(el('p', 'logcat-empty', 'No app is running. Run an APK and capture again.')); setCount('no screen'); return; }
      await syncCounting(); if (token !== S.token || !root.open) return;   // counting first, so this capture already carries the counts
      const inspection = await inspect(); if (token !== S.token || !root.open) return;
      if (counting() && inspection?.recompositions && inspection.recompositions.available !== null) { const { composables = [], ...status } = inspection.recompositions; S.recomposition = status; S.composables = new Map(composables.map(row => [row.key, row])); showTotal(); }
      const shownNow = getSnapshot() ?? snapshot;
      if (resourceNames) {   // "@id/name" of the Views that have an id (the app's resources), as uiautomator shows resource-id
        const ids = []; (function walk(view) { if (!view) return; if (Number.isInteger(view.androidId) && view.androidId > 0) ids.push(view.androidId); for (const child of view.children ?? []) walk(child); })({ children: shownNow.views ?? [] });
        const names = ids.length ? await resourceNames([...new Set(ids)]).catch(() => null) : null; if (token !== S.token || !root.open) return;
        if (names?.size) (function name(view) { if (!view) return; const found = names.get(view.androidId); if (found) view.resourceName = String(found).replace(/^.*:id\//, '').replace(/^id\//, ''); for (const child of view.children ?? []) name(child); })({ children: shownNow.views ?? [] });
      }
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

  root.addEventListener('toggle', () => { if (root.open) capture(); else { release(); setCount('closed'); syncCounting(); } });
  countToggle?.addEventListener('change', async () => {
    try { storage?.setItem(COUNT_KEY, countToggle.checked ? '1' : '0'); } catch { /* storage may be blocked: the choice lasts until the page is closed */ }
    if (!root.open) return;
    if (!countToggle.checked) {
      S.composables.clear(); S.composable = null; clearMarks();   // the Worker drops the counts: none is left on a row or in the JSON
      for (const element of S.elements) delete element.recomposition;
      if (S.capture?.inspection) { S.capture.inspection.recompositions = null; for (const owner of S.capture.inspection.owners ?? []) for (const node of owner.nodes ?? []) delete node.recomposition; }
    }
    showTotal(); await syncCounting();
    if (countToggle.checked) { if (S.capture) capture(); } else if (S.capture) renderList();
  });
  resetCounts?.addEventListener('click', async () => {
    const status = await recompositions?.reset(); if (!status || !counting()) return;
    S.recomposition = status; S.composables.clear(); S.composable = null; clearMarks(); clearBlinks(); showTotal(); renderComposables(); markComposable();
    setCounts(S.elements.filter(element => element.recomposition?.available).map(element => [element.key, { recompositions: 0, skips: 0, groups: (element.recomposition.groups ?? []).map(group => ({ ...group, recompositions: 0, skips: 0 })) }]));
    syncJSON();
  });
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
      if (counting()) syncCounting();   // a new Worker (another run) starts with counting off; the same one gets no message
      if (!snapshot?.rasterReduced && S.waiters.length) for (const resolve of S.waiters.splice(0)) resolve(snapshot);
      if (S.selected) highlight(S.elements.find(element => element.key === S.selected));
      { const pane = body.querySelector('.ci-details'), chosen = S.elements.find(element => element.key === S.selected); if (pane && chosen && pane.querySelector('.ci-noimage')?.textContent.includes(NO_RASTER)) renderDetails(pane, chosen); }   // the app drew: cut what was waiting
      if (follow?.checked && S.capture && !S.busy && navigationKey(snapshot) !== S.followKey) { clearTimeout(S.followTimer); S.followTimer = setTimeout(() => { S.followTimer = null; capture(); }, 600); }
    },
    /** An update of src/compose-recompositions.js: the total, the counts of the elements that changed, and one blink per element that recomposed. */
    recomposed(update) {
      if (!counting() || !update) return;
      const { changed = [], composables = [], ...status } = update; S.recomposition = status; showTotal();
      for (const row of composables) if (row.recompositions > 0 || row.skips > 0) S.composables.set(row.key, row); else S.composables.delete(row.key);
      const keyOf = item => `c:${item.ownerViewId}:${item.semanticsId}`;
      setCounts(changed.map(item => [keyOf(item), { available: item.available, recompositions: item.recompositions, skips: item.skips, shared: item.shared, groups: item.groups, composable: item.composable ?? null, label: item.label ?? null }]));
      renderComposables({ order: false }); if (S.composable) markComposable(); syncJSON();
      const shown = new Map(treeRows().map(row => [row._key, row]));
      for (const item of changed) if (item.recomposed > 0) {
        const key = keyOf(item), row = shown.get(key); if (row) blinkRow(key, row);
        const box = item.bounds ? boxOf({ kind: 'compose', hostId: item.ownerViewId, visibleBounds: item.bounds }) : null; if (box) blink(key, box);
      }
    },
    /** A new run: what the panel shows belongs to the previous one. */
    reset() { const open = root.open; release(); setCount(open ? 'no capture' : 'closed'); showTotal(); if (open) body.replaceChildren(el('p', 'logcat-empty', 'Run the APK and use Capture.')); },
  };
}
