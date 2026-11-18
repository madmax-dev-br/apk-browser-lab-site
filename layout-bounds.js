// "Mostrar limites de layout" (Android developer option, debug.layout): what the page overlay draws over the device screen, as Android draws it. Pure and DOM-free except
// drawLayoutBounds. The app never sees the option: the page draws from the snapshot it already has.
//
// Views (android.view.ViewGroup.onDebugDraw, after a group has drawn its children, in its own content coordinates: after its scroll, inside its clipToPadding clip and the
// clips and transforms of the groups above it): for each child that is not GONE, a red rectangle (its bounds; the optical insets are 0 for the backgrounds the lab draws)
// and blue corner marks (rgb 63,127,255, 8 dp long and 1 dp wide); for each child with MarginLayoutParams, GONE ones included, its margins filled in translucent magenta
// (argb 63,255,0,255). A group draws this only when it is drawn itself: VISIBLE, not fully transparent. A child's own rectangle is at its layout position (its parent draws
// it, untransformed); its children are drawn inside its transform. The window's root has no parent to draw it. A focused View also gets View.debugDrawFocus: corner squares
// and a cross. Padding is not drawn by Android.
// AndroidComposeView does not draw its children as a ViewGroup (its layers and AndroidView holders are drawn by Compose): its rectangles are Compose's, from
// snapshot.composeLayout (src/compose-layout-bounds.js: red per LayoutNode, blue per layout modifier); a holder's own children are drawn as Views again. Without
// composeLayout for an owner (the export is off, or the build cannot be read) its semantics nodes are outlined instead, as before.
export const LAYOUT_BOUNDS_COLORS = { bounds: '#ff0000', corners: 'rgb(63,127,255)', margin: 'rgba(255,0,255,0.247)', compose: '#ff0000', modifier: '#0000ff', focus: 'rgb(63,127,255)' };
export const MAX_LAYOUT_RECTS = 8000;
const OWNER = /AndroidComposeView;$/;
const finite = (...values) => values.every(Number.isFinite);
// Affine maps [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f.
const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);
const multiply = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const translate = (m, x, y) => !x && !y ? m : [m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const plain = m => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
/** A View's transformMatrix (3x3 row-major, about its top-left; a perspective row is ignored) as an affine map. */
const viewMatrix = t => Array.isArray(t) && t.length === 9 && t.every(Number.isFinite) ? [t[0], t[3], t[1], t[4], t[2], t[5]] : null;
const intersect = (a, b) => !a ? b : !b ? a : { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
const boxOfQuad = q => ({ left: Math.min(q[0], q[2], q[4], q[6]), top: Math.min(q[1], q[3], q[5], q[7]), right: Math.max(q[0], q[2], q[4], q[6]), bottom: Math.max(q[1], q[3], q[5], q[7]) });
const quadOf = (m, l, t, r, b) => [...apply(m, l, t), ...apply(m, r, t), ...apply(m, r, b), ...apply(m, l, b)];
const mapBox = (m, b) => plain(m) ? (([l, t] , [r, bo]) => ({ left: Math.min(l, r), top: Math.min(t, bo), right: Math.max(l, r), bottom: Math.max(t, bo) }))(apply(m, b.left, b.top), apply(m, b.right, b.bottom)) : boxOfQuad(quadOf(m, b.left, b.top, b.right, b.bottom));

/**
 * The overlay's items in screen px: [{ kind, left, top, right, bottom, quad?, clip?, inner? }].
 *  kind 'bounds': a View's rectangle (red, with its blue corner marks); 'margin': its margins (filled between the outer box and `inner`); 'focus': a focused View's marks;
 *  'compose': a LayoutNode's rectangle (red); 'modifier': a layout modifier's (blue); 'semantics': a Compose semantics node (only when no LayoutNode export is there for its owner).
 *  `quad` (8 numbers, corners clockwise from the top-left) when a transform rotates or skews it; `clip` when a parent's clip cuts it.
 * `origin` is where the Activity window's root starts (the content frame); WindowManager windows start at their own x, y.
 */
export function layoutBoundsRects(snapshot, { origin = { x: 0, y: 0 }, cap = MAX_LAYOUT_RECTS } = {}) {
  const out = [], layoutByOwner = new Map(), semanticsByOwner = new Map();
  for (const owner of snapshot?.composeLayout?.owners ?? []) if (owner?.source && Array.isArray(owner.rects)) layoutByOwner.set(String(owner.ownerViewId), owner.rects);
  for (const owner of snapshot?.composeSemantics?.owners ?? []) if (owner?.attached !== false) semanticsByOwner.set(String(owner.ownerViewId), owner.nodes ?? []);
  const push = (item, m, clip) => {
    if (out.length >= cap) return;
    const { left, top, right, bottom } = item; if (!finite(left, top, right, bottom)) return;
    let placed;
    if (plain(m)) { const box = mapBox(m, item); placed = { ...item, ...box }; if (item.inner) placed.inner = mapBox(m, item.inner); }
    else { const quad = quadOf(m, left, top, right, bottom); placed = { ...item, ...boxOfQuad(quad), quad }; if (item.inner) placed.inner = mapBox(m, item.inner); }
    if (clip) { if (!(clip.right > clip.left && clip.bottom > clip.top) || clip.right <= placed.left || clip.left >= placed.right || clip.bottom <= placed.top || clip.top >= placed.bottom) return; if (clip.left > placed.left || clip.top > placed.top || clip.right < placed.right || clip.bottom < placed.bottom) placed.clip = clip; }
    out.push(placed);
  };
  const sized = b => b && finite(b.left, b.top, b.right, b.bottom) && b.right > b.left && b.bottom > b.top;
  // The parent's onDebugDraw for one child, in the parent's content coordinates `m`.
  const childMarks = (child, m, clip) => {
    const b = child.bounds && finite(child.bounds.left, child.bounds.top, child.bounds.right, child.bounds.bottom) ? child.bounds : { left: 0, top: 0, right: 0, bottom: 0 };   // a View never laid out is at 0,0,0,0
    const g = child.margin;
    if (g && (g.left || g.top || g.right || g.bottom)) push({ kind: 'margin', left: b.left - (g.left || 0), top: b.top - (g.top || 0), right: b.right + (g.right || 0), bottom: b.bottom + (g.bottom || 0), inner: { left: b.left, top: b.top, right: b.right, bottom: b.bottom } }, m, clip);
    if (child.visibility !== 8 && sized(b)) push({ kind: 'bounds', left: b.left, top: b.top, right: b.right, bottom: b.bottom }, m, clip);
  };
  // A View drawn with the map `m` from its own coordinates to the screen, inside `clip`.
  const visit = (view, m, clip, depth) => {
    if (!view || out.length >= cap || depth > 128) return;
    const b = view.bounds, width = b ? b.right - b.left : 0, height = b ? b.bottom - b.top : 0;
    if (view.focused && width > 0 && height > 0) push({ kind: 'focus', left: 0, top: 0, right: width, bottom: height }, m, clip);
    if (OWNER.test(String(view.type ?? ''))) { composeOwner(view, m, clip, depth); return; }
    const children = view.children ?? []; if (!children.length) return;
    const content = translate(m, -(view.scrollX || 0), -(view.scrollY || 0));
    let inner = clip;   // ViewGroup.dispatchDraw clips to the padding box while it draws the children and the debug marks
    if (view.clipToPadding !== false && width > 0 && height > 0) { const p = view.padding ?? {}; inner = intersect(clip, mapBox(m, { left: p.left || 0, top: p.top || 0, right: width - (p.right || 0), bottom: height - (p.bottom || 0) })); }
    for (const child of children) childMarks(child, content, inner);
    for (const child of children) {
      if (child.visibility !== 0 && child.visibility !== undefined) continue;   // INVISIBLE and GONE children are not drawn
      if (child.laidOut === false || !sized(child.bounds) || !((child.alpha ?? 1) > 0)) continue;
      let cm = translate(content, child.bounds.left, child.bounds.top); const t = viewMatrix(child.transformMatrix); if (t) cm = multiply(cm, t);
      const own = mapBox(cm, { left: 0, top: 0, right: child.bounds.right - child.bounds.left, bottom: child.bounds.bottom - child.bounds.top });
      visit(child, cm, view.clipChildren !== false ? intersect(inner, own) : inner, depth + 1);
    }
  };
  // An AndroidComposeView: Compose's own rectangles, then the Views of its AndroidView holders (the holders themselves are LayoutNodes, outlined by Compose).
  const composeOwner = (view, m, clip, depth) => {
    const rects = layoutByOwner.get(String(view.id));
    if (rects) for (const r of rects) {
      if (out.length >= cap) break;
      let rclip = clip; if (r.clip) rclip = intersect(clip, mapBox(m, r.clip));
      if (r.quad) { const quad = []; for (let i = 0; i < 8; i += 2) quad.push(...apply(m, r.quad[i], r.quad[i + 1])); const item = { kind: r.kind, ...boxOfQuad(quad), quad }; pushPlaced(item, rclip); }
      else push({ kind: r.kind, left: r.left, top: r.top, right: r.right, bottom: r.bottom }, m, rclip);
    } else for (const node of semanticsByOwner.get(String(view.id)) ?? []) {
      const r = node.boundsInRoot; if (!r || node.invisibleToUser || node.placed === false || !sized(r)) continue;
      push({ kind: 'semantics', left: r.left, top: r.top, right: r.right, bottom: r.bottom }, m, clip);
    }
    for (const layer of view.children ?? []) {
      if (!layer?.children?.length) continue;
      let lm = translate(m, layer.bounds?.left || 0, layer.bounds?.top || 0); const lt = viewMatrix(layer.transformMatrix); if (lt) lm = multiply(lm, lt);
      for (const holder of layer.children) {
        if ((holder.visibility ?? 0) !== 0 || !sized(holder.bounds) || !holder.children?.length) continue;
        let hm = translate(lm, holder.bounds.left, holder.bounds.top); const ht = viewMatrix(holder.transformMatrix); if (ht) hm = multiply(hm, ht);
        visit(holder, hm, clip, depth + 2);
      }
    }
  };
  const pushPlaced = (item, clip) => {
    if (out.length >= cap) return;
    if (clip) { if (!(clip.right > clip.left && clip.bottom > clip.top) || clip.right <= item.left || clip.left >= item.right || clip.bottom <= item.top || clip.top >= item.bottom) return; if (clip.left > item.left || clip.top > item.top || clip.right < item.right || clip.bottom < item.bottom) item.clip = clip; }
    out.push(item);
  };
  for (const root of snapshot?.views ?? []) {
    if (out.length >= cap || !root) break;
    const surface = root.windowSurface;
    if (surface) {
      if (surface.visible === false || !finite(surface.x, surface.y)) continue;
      const window = finite(surface.width, surface.height) ? { left: surface.x, top: surface.y, right: surface.x + surface.width, bottom: surface.y + surface.height } : null;
      if (!sized(root.bounds) || root.laidOut === false) continue;
      let m = translate(IDENTITY, surface.x + root.bounds.left, surface.y + root.bounds.top); const t = viewMatrix(root.transformMatrix); if (t) m = multiply(m, t);
      visit(root, m, window, 0);   // a window's root (its decor) has no parent to outline it
    } else {
      // The Activity window: the snapshot's root is the content View, outlined (with its margins) by the content FrameLayout around it
      const base = translate(IDENTITY, origin.x || 0, origin.y || 0); childMarks(root, base, null);
      if (!sized(root.bounds) || root.laidOut === false || (root.visibility ?? 0) !== 0) continue;
      let m = translate(base, root.bounds.left, root.bounds.top); const t = viewMatrix(root.transformMatrix); if (t) m = multiply(m, t);
      visit(root, m, null, 0);
    }
  }
  return out;
}

/** Draws the items on a 2D canvas whose px are the snapshot's px. `density` sizes the corner marks (8 dp, 1 dp). Returns the number of items drawn. */
export function drawLayoutBounds(canvas, rects, width, height, { density = 1 } = {}) {
  if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, width, height); ctx.lineWidth = 1;
  const corner = Math.max(1, Math.floor(8 * density + 0.5)), line = Math.max(1, Math.floor(density + 0.5));
  const path = r => { if (r.quad) { const q = r.quad; ctx.moveTo(q[0] + 0.5, q[1] + 0.5); ctx.lineTo(q[2] - 0.5, q[3] + 0.5); ctx.lineTo(q[4] - 0.5, q[5] - 0.5); ctx.lineTo(q[6] + 0.5, q[7] - 0.5); ctx.closePath(); } else ctx.rect(r.left + 0.5, r.top + 0.5, r.right - r.left - 1, r.bottom - r.top - 1); };
  const marks = r => {   // ViewGroup.drawRectCorners: an L at each corner of the box
    const l = r.left, t = r.top, R = r.right, b = r.bottom;
    ctx.rect(l, t, corner, line); ctx.rect(l, t, line, corner); ctx.rect(R - corner, t, corner, line); ctx.rect(R - line, t, line, corner);
    ctx.rect(l, b - line, corner, line); ctx.rect(l, b - corner, line, corner); ctx.rect(R - corner, b - line, corner, line); ctx.rect(R - line, b - corner, line, corner);
  };
  const focus = r => { const s = corner; ctx.rect(r.left, r.top, s, s); ctx.rect(r.right - s, r.top, s, s); ctx.rect(r.left, r.bottom - s, s, s); ctx.rect(r.right - s, r.bottom - s, s, s); };
  // One pass per paint, in Android's order (Views: rectangles, margins, corner marks; then Compose and focus). Items with a clip are drawn one by one inside it.
  const passes = [['margin', 'fill', LAYOUT_BOUNDS_COLORS.margin, r => { ctx.rect(r.left, r.top, r.right - r.left, r.bottom - r.top); const i = r.inner; ctx.moveTo(i.left, i.top); ctx.lineTo(i.left, i.bottom); ctx.lineTo(i.right, i.bottom); ctx.lineTo(i.right, i.top); ctx.closePath(); }],
    ['bounds', 'stroke', LAYOUT_BOUNDS_COLORS.bounds, path], ['bounds', 'fill', LAYOUT_BOUNDS_COLORS.corners, marks], ['semantics', 'stroke', LAYOUT_BOUNDS_COLORS.compose, path],
    ['compose', 'stroke', LAYOUT_BOUNDS_COLORS.compose, path], ['modifier', 'stroke', LAYOUT_BOUNDS_COLORS.modifier, path], ['focus', 'fill', LAYOUT_BOUNDS_COLORS.focus, focus], ['focus', 'stroke', LAYOUT_BOUNDS_COLORS.focus, r => { ctx.moveTo(r.left, r.top); ctx.lineTo(r.right, r.bottom); ctx.moveTo(r.left, r.bottom); ctx.lineTo(r.right, r.top); }]];
  for (const [kind, mode, color, shape] of passes) {
    ctx.fillStyle = ctx.strokeStyle = color; ctx.beginPath(); let any = false;
    for (const r of rects) if (r.kind === kind && !r.clip) { shape(r); any = true; }
    if (any) mode === 'fill' ? ctx.fill(kind === 'margin' ? 'evenodd' : 'nonzero') : ctx.stroke();
    for (const r of rects) if (r.kind === kind && r.clip) {
      ctx.save(); ctx.beginPath(); ctx.rect(r.clip.left, r.clip.top, r.clip.right - r.clip.left, r.clip.bottom - r.clip.top); ctx.clip();
      ctx.beginPath(); shape(r); mode === 'fill' ? ctx.fill(kind === 'margin' ? 'evenodd' : 'nonzero') : ctx.stroke(); ctx.restore();
    }
  }
  return rects.length;
}
