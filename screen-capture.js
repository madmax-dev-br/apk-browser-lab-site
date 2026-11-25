// Images of what the page shows, for plugins (lab.screenshot, docs/PLUGINS.md): the whole screen or one element of "Mostrar limites de layout", cut from the content
// rasters the page already drew (the same frame the user sees; nothing is asked of the VM). Views that the page draws with its own DOM (plain XML widgets) have no
// raster and do not appear in a whole-screen image: the result says how many were left out.
import { flattenViews, cropRect } from './compose-inspector-panel.js?v=803d82a8b127';

export const MAX_CAPTURE_WIDTH = 2048, MAX_DOM_NODES = 600, MAX_PADDING = 64;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const failure = (code, message) => Object.assign(new Error(message), { code });

/** The pixel size of a content layer (a canvas, or an image once loaded). */
function layerSize(layer) {
  if (!layer) return { width: 0, height: 0 };
  return layer.tagName === 'CANVAS' ? { width: layer.width | 0, height: layer.height | 0 } : { width: layer.naturalWidth | 0, height: layer.naturalHeight | 0 };
}
function toBlob(canvas, type) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type });
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(failure('encode', 'The browser did not encode the image.')), type));
}

/**
 * Paints the whole screen on `canvas` from the content rasters the page shows (no encoding, nothing asked of the VM): what a whole-screen screenshot holds, and one frame of a
 * screen recording (src/screen-recorder.js). `fit`: keep the canvas's size and draw the screen scaled into it (a recording's frames share one size); otherwise the canvas takes
 * the screen's size, at most `limit` wide. -> { width, height, drawn, domViews }. Throws 'no-image' when nothing on the screen has a raster.
 */
export function paintScreen(snapshot, getHost, canvas, { limit = 1080, fit = false } = {}) {
  if (!snapshot) throw failure('no-apk', 'No screen shown.');
  const views = flattenViews(snapshot), roots = views.filter(view => view.depth === 0 && view.bounds && view.visible);
  const width = Math.max(0, ...roots.map(view => view.bounds.right)), height = Math.max(0, ...roots.map(view => view.bounds.bottom));
  if (!(width > 0 && height > 0)) throw failure('no-image', 'The screen has no drawn content yet.');
  const layers = []; let domViews = 0;
  for (const view of views) {
    if (!view.visible || !view.bounds) continue;
    if (view.rasterHostId === null || view.rasterHostId === undefined) { if (view.depth > 0 && !view.compose) domViews++; continue; }
    if (view.rasterHostId !== view.id) continue;   // drawn inside an ancestor's raster
    const layer = getHost(view.id)?._contentLayer, size = layerSize(layer); if (!(size.width > 0 && size.height > 0)) continue;
    layers.push({ layer, size, b: view.bounds });
  }
  if (!layers.length) throw failure('no-image', 'No View of the screen has content raster (the screen is drawn by the page DOM).');
  let k, dx = 0, dy = 0;
  if (fit) { k = Math.min(canvas.width / width, canvas.height / height); dx = (canvas.width - width * k) / 2; dy = (canvas.height - height * k) / 2; }
  else { k = Math.min(1, limit / width); canvas.width = Math.max(1, Math.round(width * k)); canvas.height = Math.max(1, Math.round(height * k)); }
  const ctx = canvas.getContext('2d'); if (fit) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  for (const { layer, size, b } of layers) ctx.drawImage(layer, 0, 0, size.width, size.height, dx + b.left * k, dy + b.top * k, (b.right - b.left) * k, (b.bottom - b.top) * k);
  return { width: canvas.width, height: canvas.height, drawn: layers.length, domViews };
}

/**
 * element: an element of buildLayoutBoundsElements (hostId, hostSize, cropBounds), or null for the whole screen. getHost(viewId): the page element of a View (its
 * _contentLayer is the raster). Returns { blob, width, height, notes }.
 */
/** A box in window coordinates from what a plugin passes: { left, top, right, bottom }, a layoutBounds element ({ bounds }) or a composeTree node ({ boundsInWindow }). */
export function regionOf(value) {
  const box = value && typeof value === 'object' ? (value.boundsInWindow ?? value.bounds ?? value) : null;
  if (!box || ![box.left, box.top, box.right, box.bottom].every(Number.isFinite)) return null;
  return box.right > box.left && box.bottom > box.top ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null;
}
/**
 * The page's own element of a View as an image (a View the page draws with its DOM: text, backgrounds, a button, its children and their content canvases): a copy of the
 * element with every computed style written inline, laid out by the browser inside an SVG foreignObject at the View's size and drawn on `canvas`. Nothing of the page
 * changes. Canvases and images are copied as data: URLs (an SVG image loads nothing from outside). Throws no-image when the browser cannot do it.
 */
export async function renderDomElement(host, canvas, { limit = 1080, doc = globalThis.document, notes = [] } = {}) {
  const view = doc.defaultView ?? globalThis, width = host.offsetWidth, height = host.offsetHeight;
  if (!(width > 0 && height > 0)) throw failure('no-image', 'The component has no size on screen (it has not been drawn yet, or it is hidden).');
  const dataUrl = async url => { const blob = await (await view.fetch(url)).blob(); return new Promise((resolve, reject) => { const reader = new view.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); };
  const clone = host.cloneNode(true), pairs = [[host, clone]], waits = []; let nodes = 0, lost = 0;
  while (pairs.length) {
    const [from, to] = pairs.pop(); if (++nodes > MAX_DOM_NODES) throw failure('no-image', `The component has more than ${MAX_DOM_NODES} elements on the page: capture a smaller component.`);
    const computed = view.getComputedStyle(from); let css = '';
    for (let i = 0; i < computed.length; i++) { const name = computed[i], value = computed.getPropertyValue(name); if (value) css += `${name}:${value};`; }
    if (from === host) css += 'position:absolute;left:0;top:0;right:auto;bottom:auto;margin:0;transform:none;opacity:1;visibility:visible;';
    if (from.tagName === 'CANVAS') {   // the pixels of a content raster, as an image
      const image = doc.createElement('img'); image.setAttribute('style', css);
      try { const copy = doc.createElement('canvas'); copy.width = from.width; copy.height = from.height; copy.getContext('2d').drawImage(from, 0, 0); image.setAttribute('src', copy.toDataURL('image/png')); } catch { lost++; }
      to.replaceWith(image); continue;
    }
    to.setAttribute('style', css);
    if (from.tagName === 'IMG' && from.currentSrc && !from.currentSrc.startsWith('data:')) waits.push(dataUrl(from.currentSrc).then(url => { to.setAttribute('src', url); to.removeAttribute('srcset'); }, () => { lost++; to.removeAttribute('src'); }));
    if (from.tagName === 'INPUT') to.setAttribute('value', from.value ?? ''); else if (from.tagName === 'TEXTAREA') to.textContent = from.value ?? '';
    for (const match of computed.getPropertyValue('background-image').matchAll(/url\("((?:blob|https?):[^"]+)"\)/g)) waits.push(dataUrl(match[1]).then(url => { to.setAttribute('style', to.getAttribute('style').split(match[1]).join(url)); }, () => { lost++; }));
    for (let i = 0; i < from.children.length; i++) if (to.children[i]) pairs.push([from.children[i], to.children[i]]);
  }
  await Promise.all(waits);
  if (lost) notes.push(`${lost} ${lost === 1 ? 'image of the component' : 'images of the component'} could not be copied and ${lost === 1 ? 'was' : 'were'} left out`);
  const wrapper = doc.createElement('div'); wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml'); wrapper.setAttribute('style', `position:relative;width:${width}px;height:${height}px;overflow:hidden;margin:0;padding:0`); wrapper.append(clone);
  const k = Math.min(2, limit / width), w = Math.max(1, Math.round(width * k)), h = Math.max(1, Math.round(height * k));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="${width}" height="${height}">${new view.XMLSerializer().serializeToString(wrapper)}</foreignObject></svg>`;
  const image = new view.Image(); image.decoding = 'sync';
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(failure('no-image', 'The browser could not build the image of this component from the page DOM.')); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  canvas.width = w; canvas.height = h; canvas.getContext('2d').drawImage(image, 0, 0, w, h);
  notes.push('View drawn by the page DOM: image built from the elements and styles the page shows');
}
/**
 * Whether a View's image has to come from the page's element of it: the page has one, and the View is drawn by the DOM (no raster of its own) or has children the page
 * draws with the DOM over its raster. A View whose pixels are all in its own raster, and every Compose node, is cut from the raster.
 */
export function drawnByDom(element, host) {
  if (!host || element?.kind !== 'view' || host.isConnected === false) return false;
  return !(host._contentLayer && String(element.hostId) === String(element.id)) || !!host.querySelector?.('.android-view');
}
export async function captureImage({ snapshot, getHost, element = null, region = null, padding = 0, maxWidth = 1080, type = 'image/png', doc = globalThis.document, renderDom = renderDomElement }) {
  if (!snapshot) throw failure('no-apk', 'No screen shown.');
  const format = TYPES.has(type) ? type : 'image/png', limit = Math.max(16, Math.min(MAX_CAPTURE_WIDTH, Number(maxWidth) || 1080)), notes = [];
  const canvas = doc.createElement('canvas'), margin = Math.max(0, Math.min(MAX_PADDING, Number(padding) || 0));
  const own = element && !region ? getHost(element.id) : null, dom = drawnByDom(element, own);
  if (dom) {
    await renderDom(own, canvas, { limit, doc, notes });
    if (margin > 0) notes.push('padding does not apply to a View drawn by the page DOM');
  } else if (element && !region && (margin > 0 || element.hostId === null || element.hostId === undefined)) {   // with a margin around it: every raster under the enlarged box
    const b = element.windowBounds ?? element.bounds; if (!b) throw failure('no-image', 'The element has no bounds in the window.');
    region = { left: b.left - margin, top: b.top - margin, right: b.right + margin, bottom: b.bottom + margin };
  }
  if (dom) { /* drawn above */ } else if (region) {   // any box of the window (a layoutBounds element, a composeTree node, a rectangle): every raster under it, at the rasters' own resolution
    const views = flattenViews(snapshot), layers = [];
    for (const view of views) {
      if (!view.visible || !view.bounds || view.rasterHostId !== view.id) continue;
      const b = view.bounds; if (b.right <= region.left || b.left >= region.right || b.bottom <= region.top || b.top >= region.bottom) continue;
      const layer = getHost(view.id)?._contentLayer, size = layerSize(layer); if (!(size.width > 0 && size.height > 0)) continue;
      layers.push({ layer, size, b });
    }
    if (!layers.length) throw failure('no-image', 'No screen raster covers that area (off screen, or drawn by the page DOM).');
    const rw = region.right - region.left, rh = region.bottom - region.top;
    const native = Math.max(1, ...layers.map(({ size, b }) => size.width / Math.max(1, b.right - b.left))), k = Math.min(native, limit / rw);
    canvas.width = Math.max(1, Math.round(rw * k)); canvas.height = Math.max(1, Math.round(rh * k));
    const ctx = canvas.getContext('2d');
    for (const { layer, size, b } of layers) ctx.drawImage(layer, 0, 0, size.width, size.height, (b.left - region.left) * k, (b.top - region.top) * k, (b.right - b.left) * k, (b.bottom - b.top) * k);
  } else if (element) {
    if (element.hostId === null || element.hostId === undefined) throw failure('no-image', 'This element is drawn by the page DOM: there is no raster to crop.');
    const layer = getHost(element.hostId)?._contentLayer, size = layerSize(layer);
    if (!(size.width > 0 && size.height > 0)) throw failure('no-image', 'The displayed frame has no raster for this element yet (the app has not drawn yet).');
    const r = cropRect(element.cropBounds, element.hostSize, size); if (!r) throw failure('no-image', 'The element is outside the visible area.');
    const k = Math.min(1, limit / r.sw); canvas.width = Math.max(1, Math.round(r.sw * k)); canvas.height = Math.max(1, Math.round(r.sh * k));
    canvas.getContext('2d').drawImage(layer, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height);
  } else {
    const painted = paintScreen(snapshot, getHost, canvas, { limit });
    if (painted.domViews) notes.push(`${painted.domViews} Views drawn by the page DOM do not appear in the image`);
  }
  let blob; try { blob = await toBlob(canvas, format); } catch (error) { if (!dom || error?.code) throw error; throw failure('no-image', 'This browser does not allow reading the image of a View built from the page DOM (canvas marked as cross-origin).'); }
  const width = canvas.width, height = canvas.height; canvas.width = 0; canvas.height = 0;   // the pixels live in the Blob only
  return { blob, width, height, type: format, notes };
}
