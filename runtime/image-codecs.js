import { APKError } from './apk-error.js?v=2e29585a666b';

// The lab's JPEG and WebP codecs: libjpeg-turbo 2.1.0 and libwebp 1.2.2 built to WebAssembly (scripts/wasm/build-codecs.sh, vendor/lab-codecs/<n>), the libraries Android's Skia uses, behind the C API of
// scripts/wasm/codecs/lab-codecs.c. CanvasKit 0.42 has neither a JPEG nor a WebP encoder, applies a JPEG's EXIF orientation when it decodes (BitmapFactory does not), and has no libjpeg DCT scaling
// (SkJpegCodec's native downscale for inSampleSize 2, 4, 8): these go through this module instead. The module is pinned by SHA-256 in vendor/lab-codecs/<n>/provenance.json and loaded by SkiaProvider.
const fail = (message, details = {}) => { throw new APKError(message, { kind: 'image-codec-unsupported', ...details }); };

export const LAB_CODECS_VERSION = 1;

/** Skia's SkSampler / SkSampledCodec arithmetic (android-13.0.0_r1): output size of a sampled decode, and where the sampler starts. */
export const sampledDimension = (size, sample) => (sample > size ? 1 : Math.floor(size / sample));
export const samplerStart = sample => Math.floor(sample / 2);
/** SkSampledCodec::accountForNativeScaling for JPEG: libjpeg scales natively by 8, 4 or 2 (the first that divides the sample size, preferring 8); the sampler does the rest. */
export function jpegNativeScale(sample) {
  if (sample === 2 || sample === 4 || sample === 8) return { native: sample, rest: 1 };
  for (const supported of [8, 4, 2]) if (sample % supported === 0) return { native: supported, rest: sample / supported };
  return { native: 1, rest: sample };
}
/** Picks pixels the way SkSampler does: column start + x * sample for each output column, likewise for rows. */
export function samplePixels(rgba, width, height, sample) {
  if (sample === 1) return { rgba, width, height };
  const outWidth = sampledDimension(width, sample), outHeight = sampledDimension(height, sample), start = samplerStart(sample), out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) { const from = ((start + y * sample) * width + start + x * sample) * 4, to = (y * outWidth + x) * 4; out[to] = rgba[from]; out[to + 1] = rgba[from + 1]; out[to + 2] = rgba[from + 2]; out[to + 3] = rgba[from + 3]; }
  return { rgba: out, width: outWidth, height: outHeight };
}
// SkMulDiv255Round and SkUnPreMultiply: Android bitmaps are premultiplied; the lab keeps straight RGBA, so encoders see what Skia sees by premultiplying (JPEG) or premultiplying then unpremultiplying (WebP).
const mulDiv255 = (a, b) => { const prod = a * b + 128; return (prod + (prod >> 8)) >> 8; };
export function premultiply(rgba) {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) { const a = rgba[i + 3]; out[i] = a === 255 ? rgba[i] : mulDiv255(rgba[i], a); out[i + 1] = a === 255 ? rgba[i + 1] : mulDiv255(rgba[i + 1], a); out[i + 2] = a === 255 ? rgba[i + 2] : mulDiv255(rgba[i + 2], a); out[i + 3] = a; }
  return out;
}
export function unpremultiply(rgba) {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a === 0 || a === 255) { out[i] = rgba[i]; out[i + 1] = rgba[i + 1]; out[i + 2] = rgba[i + 2]; out[i + 3] = a; continue; }
    const scale = Math.floor((255 * 16777216 + (a >> 1)) / a);   // SkUnPreMultiply::GetScale: ((255 << 24) + (alpha >> 1)) / alpha
    for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, Math.floor((rgba[i + c] * scale + (1 << 23)) / 16777216));   // PremultipliedColorComponentToColor: (c * scale + (1 << 23)) >> 24
    out[i + 3] = a;
  }
  return out;
}

export class LabCodecs {
  constructor(module, avifModule = null) { this.M = module; this.A = avifModule; }
  get hasAvif() { return this.A !== null; }
  #put(bytes) { const pointer = this.M._lab_alloc(bytes.length || 1); this.M.HEAPU8.set(bytes, pointer); return pointer; }
  #outWords(count = 4) { const pointer = this.M._malloc(count * 4); return { pointer, read: () => Array.from(this.M.HEAP32.subarray(pointer >> 2, (pointer >> 2) + count)) }; }
  #take(pointer, length) { const bytes = this.M.HEAPU8.slice(pointer, pointer + length); this.M._lab_free(pointer); return bytes; }
  /** { width, height, components, progressive } or null when libjpeg rejects the header. */
  jpegInfo(bytes) {
    const input = this.#put(bytes), out = this.#outWords(); try { return this.M._lab_jpeg_info(input, bytes.length, out.pointer) === 0 ? (([width, height, components, progressive]) => ({ width, height, components, progressive: !!progressive }))(out.read()) : null; } finally { this.M._lab_free(input); this.M._free(out.pointer); }
  }
  /** RGBA8888 (alpha 255) at the DCT scale 1/denom, or null when the data does not decode. */
  jpegDecode(bytes, denom = 1) {
    const input = this.#put(bytes), dims = this.#outWords(2), pointerBox = this.M._malloc(4);
    try {
      if (this.M._lab_jpeg_decode(input, bytes.length, denom, pointerBox, dims.pointer) !== 0) return null;
      const [width, height] = dims.read(), pixels = this.#take(this.M.HEAPU32[pointerBox >> 2], width * height * 4); return { width, height, rgba: pixels };
    } finally { this.M._lab_free(input); this.M._free(dims.pointer); this.M._free(pointerBox); }
  }
  /** `rgba` premultiplied or straight does not matter to libjpeg: the alpha channel is ignored (Skia's AlphaOption::kIgnore), so callers pass Android's premultiplied bytes. */
  jpegEncode(rgba, width, height, quality) {
    const input = this.#put(rgba), box = this.M._malloc(8);
    try { return this.M._lab_jpeg_encode(input, width, height, quality, box, box + 4) === 0 ? this.#take(this.M.HEAPU32[box >> 2], this.M.HEAPU32[(box + 4) >> 2]) : null; } finally { this.M._lab_free(input); this.M._free(box); }
  }
  /** { width, height, hasAlpha, hasAnimation } or null. */
  webpInfo(bytes) {
    const input = this.#put(bytes), out = this.#outWords(); try { return this.M._lab_webp_info(input, bytes.length, out.pointer) === 0 ? (([width, height, alpha, animation]) => ({ width, height, hasAlpha: !!alpha, hasAnimation: !!animation }))(out.read()) : null; } finally { this.M._lab_free(input); this.M._free(out.pointer); }
  }
  /** Premultiplied RGBA8888 (libwebp MODE_rgbA, as SkWebpCodec) unless `premul` is false; null when the data does not decode. */
  webpDecode(bytes, premul = true) {
    const input = this.#put(bytes), dims = this.#outWords(2), pointerBox = this.M._malloc(4);
    try {
      if (this.M._lab_webp_decode(input, bytes.length, premul ? 1 : 0, pointerBox, dims.pointer) !== 0) return null;
      const [width, height] = dims.read(); return { width, height, rgba: this.#take(this.M.HEAPU32[pointerBox >> 2], width * height * 4) };
    } finally { this.M._lab_free(input); this.M._free(dims.pointer); this.M._free(pointerBox); }
  }
  /** `rgba` is straight (unpremultiplied) RGBA, as SkWebpEncoder hands it to libwebp. */
  webpEncode(rgba, width, height, quality, lossless) {
    const input = this.#put(rgba), box = this.M._malloc(8);
    try { return this.M._lab_webp_encode(input, width, height, quality, lossless ? 1 : 0, box, box + 4) === 0 ? this.#take(this.M.HEAPU32[box >> 2], this.M.HEAPU32[(box + 4) >> 2]) : null; } finally { this.M._lab_free(input); this.M._free(box); }
  }
}

// AVIF (libavif + dav1d, the second module): sizes and pixels of the first image; RGBA8888, premultiplied when asked, in the stored orientation (irot/imir/clap are reported in `transforms`).
LabCodecs.prototype.avifInfo = function (bytes) {
  const A = this.A ?? fail('AVIF decoding needs the lab AVIF module (vendor/lab-codecs/lab-avif)'), pointer = A._lab_alloc(bytes.length); A.HEAPU8.set(bytes, pointer); const out = A._malloc(24);
  try { if (A._lab_avif_info(pointer, bytes.length, out) !== 0) return null; const [width, height, depth, alpha, transforms, frames] = Array.from(A.HEAP32.subarray(out >> 2, (out >> 2) + 6)); return { width, height, depth, hasAlpha: !!alpha, transforms, frames }; } finally { A._lab_free(pointer); A._free(out); }
};
LabCodecs.prototype.avifDecode = function (bytes, premul = true) {
  const A = this.A ?? fail('AVIF decoding needs the lab AVIF module (vendor/lab-codecs/lab-avif)'), pointer = A._lab_alloc(bytes.length); A.HEAPU8.set(bytes, pointer); const dims = A._malloc(12), box = dims + 8;
  try {
    if (A._lab_avif_decode(pointer, bytes.length, premul ? 1 : 0, box, dims) !== 0) return null;
    const [width, height] = Array.from(A.HEAP32.subarray(dims >> 2, (dims >> 2) + 2)), at = A.HEAPU32[box >> 2], rgba = A.HEAPU8.slice(at, at + width * height * 4); A._lab_free(at); return { width, height, rgba };
  } finally { A._lab_free(pointer); A._free(dims); }
};

const sha256 = async bytes => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');

/** Bounds a promise: a hang is not an error, so every load waits at most `ms` and then rejects with a message naming what did not load. */
const bounded = (promise, ms, label) => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new APKError(`${label} did not load within ${ms} ms`, { kind: 'image-codec-timeout' })), ms); })]).finally(() => clearTimeout(timer)); };

/** Loads the pinned modules from `baseURL` (a directory URL holding provenance.json, lab-codecs.mjs/.wasm and lab-avif.mjs/.wasm): every file is checked against the recorded SHA-256 before it runs, and each module
 *  load is bounded by `timeoutMs`. The JPEG/WebP module is required; a missing or hung AVIF module only leaves AVIF unavailable (`avifError`).
 *  Emscripten's glue locates its wasm with `new URL(name, import.meta.url)` unless told otherwise, and inside a Worker that module is a Blob URL (`blob:` cannot be a base): the glue's async setup then throws
 *  into a promise nobody awaits and the factory never resolves. `locateFile` (an absolute URL) and `wasmBinary` (the verified bytes) keep it from ever asking. */
export async function loadLabCodecs({ baseURL, readBytes = null, timeoutMs = 20000, blobImport = !(typeof globalThis.process === 'object' && !!globalThis.process.versions?.node) }) {
  const fetched = async (url, limit) => { const response = await globalThis.fetch(url); if (!response.ok) fail(`Image codec asset ${url} is unavailable`); const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.length > limit) fail(`Image codec asset ${url} is too large`); return bytes; };
  const read = (name, limit) => (readBytes ?? fetched)(new URL(name, baseURL), limit);
  const metadata = JSON.parse(new TextDecoder().decode(await bounded(read('provenance.json', 1 << 20), timeoutMs, 'Image codec provenance')));
  if (metadata.package !== 'lab-codecs') fail('Unexpected image codec metadata');
  const load = stem => bounded((async () => {
    const [moduleBytes, wasmBytes] = await Promise.all([read(`${stem}.mjs`, 1 << 20), read(`${stem}.wasm`, 16 << 20)]);
    for (const [name, bytes] of [[`${stem}.mjs`, moduleBytes], [`${stem}.wasm`, wasmBytes]]) if (bytes.length !== metadata.files[name]?.bytes || await sha256(bytes) !== metadata.files[name]?.sha256) fail(`Pinned image codec asset integrity mismatch: ${name}`);
    const url = !blobImport ? new URL(`${stem}.mjs`, baseURL).href : blobImport === 'data' ? `data:text/javascript;base64,${Buffer.from(moduleBytes).toString('base64')}` : URL.createObjectURL(new Blob([moduleBytes], { type: 'text/javascript' }));   // 'data': the same no-usable-base situation for Node tests (Node cannot import blob:)
    try { const factory = (await import(/* @vite-ignore */ url)).default; return await factory({ wasmBinary: wasmBytes, locateFile: name => new URL(name, baseURL).href }); } finally { if (blobImport === true) URL.revokeObjectURL(url); }
  })(), timeoutMs, `Image codec module ${stem}`);
  const [main, avif] = await Promise.allSettled([load('lab-codecs'), metadata.files['lab-avif.wasm'] ? load('lab-avif') : Promise.resolve(null)]);
  if (main.status === 'rejected') throw main.reason;
  const codecs = new LabCodecs(main.value, avif.status === 'fulfilled' ? avif.value : null); if (avif.status === 'rejected') codecs.avifError = avif.reason;
  return codecs;
}
