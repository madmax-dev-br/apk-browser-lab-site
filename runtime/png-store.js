// A decoded opaque bitmap kept as a PNG without compression (zlib "stored" blocks): the same pixels, exactly, as Skia's own PNG encoder would keep, without its deflate.
//
// BitmapFactory keeps a decoded Bitmap's pixels as a PNG data URL (src/bitmap-codec-host.js: the recorded raster every later draw replays). A JPEG or WebP photo decoded at
// its own size was re-encoded with CanvasKit's encodeToBytes(PNG): zlib level 6 with adaptive row filters over every pixel, about two thirds of the host time of a first decode
// (example-heavy: 50 of 80 ms over its first images in Node, 25-45 ms of a 50 ms frame in the browser), on the frame that shows the image. A stored PNG is a copy: the rows
// (filter 0) in deflate blocks of at most 65 535 bytes, the zlib Adler-32 and the chunk CRCs. PNG is lossless either way and the replay decodes it with the same Skia codec, so
// the pixels drawn are the ones decoded. Only for images that are fully opaque (every alpha 255, so premultiplied and straight values agree and RGB is exact) and small enough
// that the uncompressed data stays well inside the raster bound (decodeRasterImage refuses a data URL above 12 MiB); everything else keeps Skia's encoder. DOM-free, no process.*.
import { crc32 } from './apk-loader.js?v=a104526a388b';

export const STORED_PNG_MAX_PIXELS = 1024 * 1024;   // 3 MiB of RGB: a 4 MiB data URL, a third of the raster bound
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], BLOCK = 65535;

function adler32(bytes) {
  let a = 1, b = 0;
  for (let i = 0, n = bytes.length; i < n;) { const end = Math.min(n, i + 65536); for (; i < end; i++) { a += bytes[i]; b += a; } a %= 65521; b %= 65521; }   // doubles: 64 KiB between reductions keeps b below 2^41, exact
  return ((b << 16) | a) >>> 0;
}

/** RGBA8 (straight alpha, `width` x `height`) -> the bytes of an RGB PNG with stored deflate blocks, or null when a pixel is not opaque or the image is too large for it. */
export function encodeOpaqueStoredPng(rgba, width, height) {
  if (!(width > 0 && height > 0) || width * height > STORED_PNG_MAX_PIXELS || rgba.length < width * height * 4) return null;
  const stride = 1 + width * 3, raw = new Uint8Array(stride * height);
  for (let y = 0, s = 0, d = 0; y < height; y++) {
    raw[d++] = 0;   // filter type None
    for (let x = 0; x < width; x++, s += 4) { if (rgba[s + 3] !== 255) return null; raw[d++] = rgba[s]; raw[d++] = rgba[s + 1]; raw[d++] = rgba[s + 2]; }
  }
  const blocks = Math.max(1, Math.ceil(raw.length / BLOCK)), zlibLength = 2 + raw.length + 5 * blocks + 4;
  const total = 8 + (12 + 13) + (12 + zlibLength) + 12, out = new Uint8Array(total), view = new DataView(out.buffer);
  out.set(SIGNATURE, 0); let at = 8;
  const chunk = (type, length, write) => {
    view.setUint32(at, length); const start = at + 4;
    for (let i = 0; i < 4; i++) out[start + i] = type.charCodeAt(i);
    write(start + 4); at = start + 4 + length;
    view.setUint32(at, crc32(out.subarray(start, at))); at += 4;
  };
  chunk('IHDR', 13, p => { view.setUint32(p, width); view.setUint32(p + 4, height); out[p + 8] = 8; out[p + 9] = 2; out[p + 10] = 0; out[p + 11] = 0; out[p + 12] = 0; });   // 8-bit RGB, deflate, adaptive filtering, no interlace
  chunk('IDAT', zlibLength, p => {
    out[p] = 0x78; out[p + 1] = 0x01; let q = p + 2;   // zlib header: deflate, 32 KiB window, no dictionary, fastest (FCHECK makes 0x7801 a multiple of 31)
    for (let i = 0, from = 0; i < blocks; i++, from += BLOCK) {
      const length = Math.min(BLOCK, raw.length - from), last = i === blocks - 1;
      out[q] = last ? 1 : 0; out[q + 1] = length & 255; out[q + 2] = length >>> 8; out[q + 3] = ~length & 255; out[q + 4] = (~length >>> 8) & 255; q += 5;
      out.set(raw.subarray(from, from + length), q); q += length;
    }
    view.setUint32(q, adler32(raw));
  });
  chunk('IEND', 0, () => {});
  return out;
}
