// "Mostrar limites de layout" (Android developer option, debug.layout): the rectangles the page overlay draws over the device screen.
// Pure and DOM-free. Input is the snapshot the page already draws: snapshot.views (bounds are relative to the parent; padding, margin, scrollX/scrollY per View)
// and snapshot.composeSemantics.owners[].nodes[].boundsInRoot (relative to the owning AndroidComposeView). Colours follow hwui's debugDraw approximation.
export const LAYOUT_BOUNDS_COLORS = { bounds: '#4c4cff', padding: '#80ff4c', margin: '#ff4cff' };
export const MAX_LAYOUT_RECTS = 4000;
const finite = (...values) => values.every(Number.isFinite);
/** [{ kind: 'bounds' | 'padding' | 'margin', left, top, right, bottom }] in screen px. `origin` is where non-window-surface roots start (the content frame). */
export function layoutBoundsRects(snapshot, { origin = { x: 0, y: 0 }, cap = MAX_LAYOUT_RECTS } = {}) {
  const out = [], ownerOrigins = new Map();
  const push = (kind, left, top, right, bottom) => { if (out.length < cap && finite(left, top, right, bottom) && right > left && bottom > top) out.push({ kind, left, top, right, bottom }); };
  const visit = (view, ox, oy, depth) => {
    if (!view || out.length >= cap || depth > 64) return;
    const b = view.bounds, laidOut = view.laidOut !== false && b && finite(b.left, b.top, b.right, b.bottom);
    if (!laidOut) return;
    const left = ox + b.left, top = oy + b.top, right = ox + b.right, bottom = oy + b.bottom;
    ownerOrigins.set(String(view.id), { x: left, y: top });
    push('bounds', left, top, right, bottom);
    const m = view.margin, p = view.padding;
    if (m && (m.left || m.top || m.right || m.bottom)) push('margin', left - (m.left || 0), top - (m.top || 0), right + (m.right || 0), bottom + (m.bottom || 0));
    if (p && (p.left || p.top || p.right || p.bottom)) push('padding', left + (p.left || 0), top + (p.top || 0), right - (p.right || 0), bottom - (p.bottom || 0));
    const cx = left - (view.scrollX || 0), cy = top - (view.scrollY || 0);
    for (const child of view.children || []) visit(child, cx, cy, depth + 1);
  };
  for (const root of snapshot?.views || []) { if (root.windowSurface) visit(root, 0, 0, 0); else visit(root, origin.x, origin.y, 0); }
  for (const owner of snapshot?.composeSemantics?.owners || []) {
    const base = ownerOrigins.get(String(owner.ownerViewId)); if (!base || owner.attached === false) continue;
    for (const node of owner.nodes || []) {
      if (out.length >= cap) break;
      const r = node.boundsInRoot; if (!r || node.invisibleToUser || node.placed === false) continue;
      push('bounds', base.x + r.left, base.y + r.top, base.x + r.right, base.y + r.bottom);
    }
  }
  return out;
}
/** Draws the rectangles on a 2D canvas (one stroked path per kind). Returns the number drawn. */
export function drawLayoutBounds(canvas, rects, width, height) {
  if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, width, height); ctx.lineWidth = 1;
  for (const kind of ['margin', 'padding', 'bounds']) {
    ctx.strokeStyle = LAYOUT_BOUNDS_COLORS[kind]; ctx.beginPath();
    for (const r of rects) if (r.kind === kind) ctx.rect(r.left + 0.5, r.top + 0.5, r.right - r.left - 1, r.bottom - r.top - 1);
    ctx.stroke();
  }
  return rects.length;
}
