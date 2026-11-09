// Images of what the page shows, for plugins (lab.screenshot, docs/PLUGINS.md): the whole screen or one element of "Mostrar limites de layout", cut from the content
// rasters the page already drew (the same frame the user sees; nothing is asked of the VM). Views that the page draws with its own DOM (plain XML widgets) have no
// raster and do not appear in a whole-screen image: the result says how many were left out.
import { flattenViews, cropRect } from './compose-inspector-panel.js?v=93d82df0437e';

export const MAX_CAPTURE_WIDTH = 2048;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const failure = (code, message) => Object.assign(new Error(message), { code });

/** The pixel size of a content layer (a canvas, or an image once loaded). */
function layerSize(layer) {
  if (!layer) return { width: 0, height: 0 };
  return layer.tagName === 'CANVAS' ? { width: layer.width | 0, height: layer.height | 0 } : { width: layer.naturalWidth | 0, height: layer.naturalHeight | 0 };
}
function toBlob(canvas, type) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type });
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(failure('encode', 'O navegador não codificou a imagem.')), type));
}

/**
 * element: an element of buildLayoutBoundsElements (hostId, hostSize, cropBounds), or null for the whole screen. getHost(viewId): the page element of a View (its
 * _contentLayer is the raster). Returns { blob, width, height, notes }.
 */
export async function captureImage({ snapshot, getHost, element = null, maxWidth = 1080, type = 'image/png', doc = globalThis.document }) {
  if (!snapshot) throw failure('no-apk', 'Nenhuma tela exibida.');
  const format = TYPES.has(type) ? type : 'image/png', limit = Math.max(16, Math.min(MAX_CAPTURE_WIDTH, Number(maxWidth) || 1080)), notes = [];
  const canvas = doc.createElement('canvas');
  if (element) {
    if (element.hostId === null || element.hostId === undefined) throw failure('no-image', 'Este elemento é desenhado pelo DOM da página: não há raster para cortar.');
    const layer = getHost(element.hostId)?._contentLayer, size = layerSize(layer);
    if (!(size.width > 0 && size.height > 0)) throw failure('no-image', 'O quadro exibido ainda não tem raster para este elemento (o app ainda não desenhou).');
    const r = cropRect(element.cropBounds, element.hostSize, size); if (!r) throw failure('no-image', 'O elemento está fora da área visível.');
    const k = Math.min(1, limit / r.sw); canvas.width = Math.max(1, Math.round(r.sw * k)); canvas.height = Math.max(1, Math.round(r.sh * k));
    canvas.getContext('2d').drawImage(layer, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height);
  } else {
    const views = flattenViews(snapshot), roots = views.filter(view => view.depth === 0 && view.bounds && view.visible);
    const width = Math.max(0, ...roots.map(view => view.bounds.right)), height = Math.max(0, ...roots.map(view => view.bounds.bottom));
    if (!(width > 0 && height > 0)) throw failure('no-image', 'A tela ainda não tem conteúdo desenhado.');
    const k = Math.min(1, limit / width); canvas.width = Math.max(1, Math.round(width * k)); canvas.height = Math.max(1, Math.round(height * k));
    const ctx = canvas.getContext('2d'); let drawn = 0, domViews = 0;
    for (const view of views) {
      if (!view.visible || !view.bounds) continue;
      if (view.rasterHostId === null || view.rasterHostId === undefined) { if (view.depth > 0 && !view.compose) domViews++; continue; }
      if (view.rasterHostId !== view.id) continue;   // drawn inside an ancestor's raster
      const layer = getHost(view.id)?._contentLayer, size = layerSize(layer); if (!(size.width > 0 && size.height > 0)) continue;
      const b = view.bounds; ctx.drawImage(layer, 0, 0, size.width, size.height, b.left * k, b.top * k, (b.right - b.left) * k, (b.bottom - b.top) * k); drawn++;
    }
    if (!drawn) throw failure('no-image', 'Nenhuma View da tela tem raster de conteúdo (a tela é desenhada pelo DOM da página).');
    if (domViews) notes.push(`${domViews} Views desenhadas pelo DOM da página não aparecem na imagem`);
  }
  const width = canvas.width, height = canvas.height, blob = await toBlob(canvas, format); canvas.width = 0; canvas.height = 0;   // the pixels live in the Blob only
  return { blob, width, height, type: format, notes };
}
