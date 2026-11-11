// Dragging something from a plugin's surface (src/lab-side-tabs.js) onto the simulated device. The surface is a sandboxed iframe, and native HTML drag-and-drop does not
// cross frames reliably, so the drag is made of pointer events the surface reports by postMessage and of what this layer draws on the lab page: a ghost that follows the
// pointer, a frame around the device screen and a mark with the position under the pointer. Positions come from the screen element's bounding rectangle read at every
// move (the device is drawn with a CSS scale that changes with the layout and with a full-screen mode), never from a cached size. No process.*.

const round = (value, digits = 0) => { const f = 10 ** digits; return Math.round(value * f) / f; };

/**
 * A pointer position of the page as a position on the device screen.
 * rect: the live getBoundingClientRect() of the screen element (any CSS scale included); screen: { width, height } of the device screen in device px, `density`
 * (px per dp, 1 in the lab) and `origin` { x, y }: where the app's window starts on the screen (the coordinates of lab.layoutBounds() and of the MCP tap are the window's).
 * -> { inside, x, y (device px), dpX, dpY, percentX, percentY (0–100 of the screen), windowX, windowY (px in the app's window), screen: { width, height, density } }.
 * Outside the screen the numbers keep going (negative, or above 100 %) and `inside` is false; without a measurable screen every number is null.
 */
export function devicePoint(clientX, clientY, rect, screen = {}) {
  const width = Number(screen.width), height = Number(screen.height), density = Number(screen.density) > 0 ? Number(screen.density) : 1, origin = screen.origin ?? { x: 0, y: 0 };
  const info = { width: width > 0 ? width : null, height: height > 0 ? height : null, density };
  if (!rect || !(rect.width > 0) || !(rect.height > 0) || !(width > 0) || !(height > 0) || !Number.isFinite(clientX) || !Number.isFinite(clientY))
    return { inside: false, x: null, y: null, dpX: null, dpY: null, percentX: null, percentY: null, windowX: null, windowY: null, screen: info };
  const fx = (clientX - rect.left) / rect.width, fy = (clientY - rect.top) / rect.height, x = fx * width, y = fy * height;
  return { inside: fx >= 0 && fx < 1 && fy >= 0 && fy < 1, x: round(x), y: round(y), dpX: round(x / density, 1), dpY: round(y / density, 1), percentX: round(fx * 100, 2), percentY: round(fy * 100, 2),
    windowX: round(x - (Number(origin.x) || 0)), windowY: round(y - (Number(origin.y) || 0)), screen: info };
}

/** The app element under a point of the window among lab.layoutBounds() elements: the smallest box that holds it (the innermost component), as plain data, or null. */
export function elementAtPoint(elements, x, y) {
  if (!Array.isArray(elements) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  let best = null, bestArea = Infinity;
  for (const element of elements) {
    const b = element?.bounds; if (!b || !(x >= b.left && x < b.right && y >= b.top && y < b.bottom)) continue;
    const area = (b.right - b.left) * (b.bottom - b.top); if (area <= bestArea) { best = element; bestArea = area; }   // <=: of two equal boxes the later one is drawn on top
  }
  if (!best) return null;
  return { key: best.key, kind: best.kind, name: best.name ?? null, testTag: best.testTag ?? null, role: best.role ?? null, texts: [...(best.texts ?? [])].slice(0, 8), editableText: best.editableText ?? null,
    contentDescriptions: [...(best.contentDescriptions ?? [])].slice(0, 8), actions: [...(best.actions ?? [])], bounds: { ...best.bounds } };
}

export const MAX_GHOST_IMAGE_CHARS = 400_000, DRAG_ELEMENT_MS = 120;
/** A ghost image a surface asked for: only an inline image (data:image/…) of bounded size is shown. */
export const ghostImage = value => typeof value === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(value) && value.length <= MAX_GHOST_IMAGE_CHARS ? value : null;

/**
 * getDevice() -> { element, width, height, density, origin } | null: the device screen as the page shows it now. elements() -> Promise of lab.layoutBounds() elements
 * (from the drawn snapshot: no VM work). Returns { begin, move, end, cancel, get active() }.
 */
export function createDragLayer({ doc = globalThis.document, getDevice = () => null, elements = async () => [], now = () => Date.now() } = {}) {
  let drag = null;
  const el = (className) => { const node = doc.createElement('div'); node.className = className; node.setAttribute('aria-hidden', 'true'); return node; };
  function locate(clientX, clientY) {
    const device = getDevice(), rect = device?.element?.isConnected !== false && !device?.element?.hidden ? device?.element?.getBoundingClientRect?.() : null;
    return { rect: rect && rect.width > 0 && rect.height > 0 ? rect : null, point: devicePoint(clientX, clientY, rect, device ?? {}) };
  }
  async function elementUnder(point) { if (!point.inside) return null; try { return elementAtPoint(await elements(), point.windowX, point.windowY); } catch { return null; } }
  function draw(clientX, clientY) {
    const { rect, point } = locate(clientX, clientY);
    drag.ghost.style.transform = `translate(${Math.round(clientX + 12)}px,${Math.round(clientY + 12)}px)`;
    drag.frame.hidden = !rect; if (rect) Object.assign(drag.frame.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    drag.frame.dataset.over = String(point.inside); drag.mark.hidden = !point.inside;
    if (point.inside) { drag.mark.style.transform = `translate(${Math.round(clientX)}px,${Math.round(clientY)}px)`; drag.markLabel.textContent = `${point.x}, ${point.y} px · ${Math.round(point.percentX)}%, ${Math.round(point.percentY)}%`; }
    return point;
  }
  function remove() { if (!drag) return; drag.ghost.remove(); drag.frame.remove(); drag.mark.remove(); doc.body?.classList?.remove('lab-dragging'); drag = null; }
  return {
    get active() { return !!drag; },
    /** Starts drawing: { label, image, clientX, clientY } -> the position (with `element: null`; the element comes with move / end). */
    begin({ label = '', image = null, clientX, clientY } = {}) {
      remove();
      const ghost = el('lab-drag-ghost'), frame = el('lab-drop-frame'), mark = el('lab-drop-mark'), markLabel = doc.createElement('span'), picture = ghostImage(image);
      if (picture) { const img = doc.createElement('img'); img.src = picture; img.alt = ''; ghost.append(img); }
      const text = doc.createElement('span'); text.textContent = String(label ?? '').slice(0, 80) || 'Soltar no aparelho'; ghost.append(text); mark.append(markLabel);
      doc.body.append(frame, mark, ghost); doc.body.classList?.add('lab-dragging');
      drag = { ghost, frame, mark, markLabel, lastElementAt: -Infinity, element: null };
      return { ...draw(clientX, clientY), element: null };
    },
    /** The pointer moved: redraws and answers the position; the element under it is looked up at most every DRAG_ELEMENT_MS (the last one found is repeated in between). */
    async move(clientX, clientY) {
      if (!drag) return null; const current = drag, point = draw(clientX, clientY);
      if (!point.inside) current.element = null;
      else if (now() - current.lastElementAt >= DRAG_ELEMENT_MS) { current.lastElementAt = now(); current.element = await elementUnder(point); }
      return { ...point, element: current.element };
    },
    /** The pointer was released: the final position and the element under it; the drawing goes away. */
    async end(clientX, clientY) {
      if (!drag) return null; const { point } = locate(clientX, clientY); remove();
      return { ...point, element: await elementUnder(point) };
    },
    cancel() { remove(); },
  };
}
