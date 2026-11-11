// Page side of lab.renderVariant (src/render-variant.js): the RGBA images the Worker returned become encoded Blobs, the form a plugin shows (ui.image) or keeps.
// Where the environment has no canvas (a backend, a test) the images stay as they came ({ width, height, scale, pixels }).
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

async function encode(image, type, doc) {
  const { width, height } = image, data = new ImageData(new Uint8ClampedArray(image.pixels), width, height);
  if (typeof OffscreenCanvas === 'function') { const canvas = new OffscreenCanvas(width, height); canvas.getContext('2d').putImageData(data, 0, 0); return canvas.convertToBlob({ type }); }
  const canvas = doc.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.getContext('2d').putImageData(data, 0, 0);
  try { return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Object.assign(new Error('O navegador não codificou a imagem.'), { code: 'encode' })), type)); } finally { canvas.width = 0; canvas.height = 0; }
}
/**
 * The result of APKWorkerClient.renderVariant with every image as { width, height, scale, type, blob } (`pixels: true` keeps the RGBA ArrayBuffer too). `type`: image/png
 * (default), image/jpeg or image/webp. Without a canvas the result is returned unchanged.
 */
export async function encodeVariantImages(result, { type = 'image/png', pixels = false, doc = globalThis.document } = {}) {
  const canEncode = typeof ImageData === 'function' && (typeof OffscreenCanvas === 'function' || typeof doc?.createElement === 'function');
  if (!result || !canEncode) return result;
  const format = TYPES.has(type) ? type : 'image/png';
  for (const entry of [result, ...(result.images ?? [])]) {
    const image = entry.image; if (!image?.pixels) continue;
    const blob = await encode(image, format, doc);
    entry.image = { width: image.width, height: image.height, scale: image.scale, type: format, blob, ...(pixels ? { pixels: image.pixels } : {}) };
  }
  return result;
}
