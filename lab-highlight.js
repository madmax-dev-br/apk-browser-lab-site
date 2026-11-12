// lab.highlight (docs/PLUGINS.md "Componente por id"): outlines over the simulated device around components a plugin named by id. A page overlay inside the device screen
// (the same place as "Mostrar limites de layout"): the app never sees it and nothing is asked of the VM. Each highlight keeps its selector and is matched again against the
// elements of every drawn frame, so the outline follows the component while it moves or scrolls, hides while it is not on screen and comes back with it.
// Costs nothing without highlights: refresh() returns at once. No process.*.
import { matchTargets } from './lab-target.js?v=e91f6eb1377f';

export const HIGHLIGHT_LIMITS = Object.freeze({ perOwner: 32, boxes: 64, label: 60, minDurationMs: 100, maxDurationMs: 600000, maxWidth: 8, maxPadding: 32 });
export const HIGHLIGHT_COLOR = '#ff3d7f';
const fail = (code, message) => Object.assign(new Error(message), { code });
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,24}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/a-z-]{1,40}\))$/i;
const clamp = (value, min, max, fallback) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };

/** A plugin's options -> { color, fill, width, padding, label (string | true = the component's own name | false), all, index, durationMs | null }; `previous` keeps what is not given. */
export function sanitizeHighlightStyle(raw, previous = null) {
  const o = raw && typeof raw === 'object' ? raw : {}, base = previous ?? { color: HIGHLIGHT_COLOR, fill: false, width: 2, padding: 0, label: true, all: false, durationMs: null };
  const color = typeof o.color === 'string' && COLOR.test(o.color.trim()) ? o.color.trim() : base.color;
  const label = o.label === undefined ? base.label : o.label === false || o.label === null ? false : o.label === true ? true : String(o.label).slice(0, HIGHLIGHT_LIMITS.label);
  const durationMs = o.durationMs === undefined ? base.durationMs : o.durationMs === null || !(Number(o.durationMs) > 0) ? null : clamp(o.durationMs, HIGHLIGHT_LIMITS.minDurationMs, HIGHLIGHT_LIMITS.maxDurationMs, null);
  return { color, fill: o.fill === undefined ? base.fill : o.fill === true, width: o.width === undefined ? base.width : Math.round(clamp(o.width, 1, HIGHLIGHT_LIMITS.maxWidth, 2)),
    padding: o.padding === undefined ? base.padding : clamp(o.padding, 0, HIGHLIGHT_LIMITS.maxPadding, 0), label, all: o.all === undefined ? base.all : o.all === true, durationMs };
}
const autoLabel = element => String(element.testTag ?? element.name ?? element.key ?? '').slice(0, HIGHLIGHT_LIMITS.label);

/**
 * root() -> the element the boxes go into (positioned over the device screen, in the screen's own px) or null; getOrigin() -> { x, y }: where the app's window starts on
 * the screen (the coordinates of lab.layoutBounds() are the window's); elements() -> the lab.layoutBounds() elements of the frame the page shows (no names needed).
 */
export function createHighlightLayer({ doc = globalThis.document, root = () => null, getOrigin = () => ({ x: 0, y: 0 }), elements = () => [], setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) } = {}) {
  const entries = new Map();   // `${owner}\n${id}` -> { owner, id, selector, keys, style, boxes: [nodes], matched: [elements], timer }
  let serial = 0;
  const keyOf = (owner, id) => `${owner}\n${id}`;
  const out = entry => ({ id: entry.id, matches: entry.found, visible: entry.matched.length > 0, elements: entry.matched.map(element => ({ ...element })), bounds: entry.matched[0]?.bounds ? { ...entry.matched[0].bounds } : null,
    color: entry.style.color, fill: entry.style.fill, width: entry.style.width, padding: entry.style.padding, label: entry.style.label, all: entry.style.all, durationMs: entry.style.durationMs });
  /** The elements of the frame a highlight is on: its selector matched again; a selector by composable name (names come from a Compose inspection, not from the frame) follows the keys it had. */
  function match(entry, list) {
    const found = entry.keys ? list.filter(element => entry.keys.includes(element.key)) : matchTargets(list, entry.selector);
    entry.found = found.length;
    entry.matched = (entry.style.all ? found : [found[entry.selector.index ?? 0]].filter(Boolean)).slice(0, HIGHLIGHT_LIMITS.boxes);
  }
  function draw(entry) {
    const host = root(), origin = getOrigin() ?? { x: 0, y: 0 };
    while (entry.boxes.length > (host ? entry.matched.length : 0)) entry.boxes.pop().remove();
    if (!host) return;
    entry.matched.forEach((element, index) => {
      let box = entry.boxes[index];
      if (!box) {
        box = doc.createElement('div'); box.className = 'lab-highlight'; box.setAttribute('aria-hidden', 'true');
        const fill = doc.createElement('div'); fill.className = 'lab-highlight-fill'; const label = doc.createElement('span'); label.className = 'lab-highlight-label'; box.append(fill, label); entry.boxes[index] = box;
      }
      if (box.parentNode !== host) host.append(box);
      const b = element.bounds, pad = entry.style.padding, left = (Number(origin.x) || 0) + b.left - pad, top = (Number(origin.y) || 0) + b.top - pad;
      Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(1, b.right - b.left + pad * 2)}px`, height: `${Math.max(1, b.bottom - b.top + pad * 2)}px`, borderColor: entry.style.color, borderWidth: `${entry.style.width}px` });
      box.dataset.owner = entry.owner; box.dataset.highlight = entry.id;
      const [fill, label] = box.children; fill.style.background = entry.style.color; fill.hidden = !entry.style.fill;
      const caption = entry.style.label === true ? autoLabel(element) : entry.style.label || '';
      label.textContent = caption; label.hidden = !caption; label.style.background = entry.style.color; label.dataset.place = top >= 18 ? 'above' : 'inside';
    });
  }
  function drop(entry) { if (entry.timer !== null) clearTimer(entry.timer); entry.timer = null; for (const box of entry.boxes.splice(0)) box.remove(); entries.delete(keyOf(entry.owner, entry.id)); }
  function arm(entry) { if (entry.timer !== null) clearTimer(entry.timer); entry.timer = entry.style.durationMs ? setTimer(() => { entry.timer = null; drop(entry); }, entry.style.durationMs) : null; }
  const owned = owner => [...entries.values()].filter(entry => entry.owner === String(owner));
  const find = (owner, id) => { const entry = entries.get(keyOf(String(owner), String(id ?? ''))); if (!entry) throw fail('not-found', 'Destaque removido ou desconhecido.'); return entry; };
  return {
    /**
     * Draws (or replaces, with the same id) a highlight. selector: a resolved selector (src/lab-target.js); list: the elements it was matched against now (they may carry
     * names from a Compose inspection; the frame's own elements are used when not given). -> { id, matches, visible, elements, bounds, ...style }.
     */
    show(owner, { id = null, selector, elements: list = null, options = null } = {}) {
      owner = String(owner); id = id === null || id === undefined || id === '' ? null : String(id).slice(0, 80);
      let entry = id ? entries.get(keyOf(owner, id)) : null;
      if (!entry) {
        if (owned(owner).length >= HIGHLIGHT_LIMITS.perOwner) throw fail('limit', `No máximo ${HIGHLIGHT_LIMITS.perOwner} destaques por plugin: remova algum (lab.highlights.clear()).`);
        while (!id || entries.has(keyOf(owner, id))) id = `h${++serial}`;
        entry = { owner, id, selector: null, keys: null, style: sanitizeHighlightStyle(options), boxes: [], matched: [], found: 0, timer: null }; entries.set(keyOf(owner, id), entry);
      } else entry.style = sanitizeHighlightStyle(options, entry.style);
      entry.selector = selector; const now = Array.isArray(list) ? list : elements();
      entry.keys = selector.name !== null ? matchTargets(now, selector).map(element => element.key) : null;
      match(entry, now); draw(entry); arm(entry); return out(entry);
    },
    /** Changes the look of a highlight (colour, label, fill, width, padding, all, durationMs). */
    update(owner, id, options) { const entry = find(owner, id); entry.style = sanitizeHighlightStyle(options, entry.style); match(entry, elements()); draw(entry); arm(entry); return out(entry); },
    remove(owner, id) { const entry = entries.get(keyOf(String(owner), String(id ?? ''))); if (!entry) return { removed: 0 }; drop(entry); return { removed: 1 }; },
    clear(owner) { const list = owned(owner); list.forEach(drop); return { removed: list.length }; },
    list(owner) { return owned(owner).map(out); },
    /** The page drew a frame (or the device changed): every highlight is matched and placed again. */
    refresh() { if (!entries.size) return 0; const list = elements(); for (const entry of entries.values()) { match(entry, list); draw(entry); } return entries.size; },
    /** A plugin stopped: its highlights go. */
    closeOwner(owner) { return this.clear(owner).removed; },
    get size() { return entries.size; },
  };
}
/** The page action behind lab.highlight (src/plugin-host.js resolves the target first): { op: 'show' | 'update' | 'remove' | 'clear' | 'list', ... }. */
export function createHighlightAction(layer) {
  return (plugin, args = {}) => {
    switch (String(args.op ?? 'show')) {
      case 'show': return layer.show(plugin.id, { id: args.id, selector: args.selector, elements: args.elements, options: args.options });
      case 'update': return layer.update(plugin.id, args.id, args.options);
      case 'remove': return layer.remove(plugin.id, args.id);
      case 'clear': return layer.clear(plugin.id);
      case 'list': return layer.list(plugin.id);
      default: throw fail('bad-args', `op desconhecida: ${String(args.op).slice(0, 20)}`);
    }
  };
}
