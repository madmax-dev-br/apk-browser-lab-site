// The virtual device's cameras and the frame arithmetic shared by the VM Worker (src/camera-host.js), the page (src/camera-source.js) and the Node tests: DOM-free, no process.*.
//
// The device has two cameras that look at the same scene (the source the tester picked in the page: a generated test feed, the computer's webcam, an image or a video file):
//   "0" back,  SENSOR_ORIENTATION 90,  autofocus
//   "1" front, SENSOR_ORIENTATION 270, fixed focus (as most front cameras are)
// Like a phone's, the sensors are landscape (4:3) and mounted sideways: a buffer has to be turned SENSOR_ORIENTATION degrees clockwise to be upright on a portrait screen. The page produces
// each buffer already in sensor orientation, so everything the VM hands to an app (ImageReader images, JPEG bytes) is what a real sensor delivers and an app's own rotation code is exercised.

export const LENS_FACING_FRONT = 0, LENS_FACING_BACK = 1;
export const FORMAT = Object.freeze({ JPEG: 0x100, YUV_420_888: 0x23, PRIVATE: 0x22 });
/** The sensor's pixel array (4:3). Every stream is a centred crop of it, scaled. */
export const SENSOR_ARRAY = Object.freeze({ width: 1280, height: 960 });
/** Output sizes per format, largest first (StreamConfigurationMap.getOutputSizes). PRIVATE is what SurfaceTexture / SurfaceView / TextureView consume. */
export const STREAM_SIZES = Object.freeze({
  [FORMAT.JPEG]: Object.freeze([[1280, 960], [1280, 720], [640, 480], [320, 240]]),
  [FORMAT.YUV_420_888]: Object.freeze([[1280, 960], [1280, 720], [640, 480], [352, 288], [320, 240], [176, 144]]),
  [FORMAT.PRIVATE]: Object.freeze([[1280, 960], [1280, 720], [640, 480], [352, 288], [320, 240], [176, 144]]),
});
export const CAMERAS = Object.freeze([
  Object.freeze({ id: '0', facing: LENS_FACING_BACK, orientation: 90, autofocus: true }),
  Object.freeze({ id: '1', facing: LENS_FACING_FRONT, orientation: 270, autofocus: false }),
]);
export const cameraById = id => CAMERAS.find(camera => camera.id === id) ?? null;
export const supportsSize = (format, width, height) => (STREAM_SIZES[format] ?? []).some(([w, h]) => w === width && h === height);
/** The stream size a consumer without a fixed size (SurfaceTexture, SurfaceView) gets: the largest supported size whose area does not exceed the requested one, as the camera service rounds (1080p cap is moot here). */
export function roundStreamSize(width, height) {
  const sizes = STREAM_SIZES[FORMAT.PRIVATE], exact = sizes.find(([w, h]) => w === width && h === height); if (exact) return { width, height };
  const fitting = sizes.find(([w, h]) => w * h <= width * height) ?? sizes.at(-1);
  return { width: fitting[0], height: fitting[1] };
}

/**
 * A deterministic RGBA test frame in sensor orientation (what the scripted source of the Node tests and the page's generated feed without a canvas produce): eight colour bars, a block
 * that moves with the frame number, and the frame number written into the first pixels of the first row as (n >> 8, n & 255, 255 - (n & 255)) so a reader can tell which frame it holds.
 */
export function testPatternRGBA(width, height, frame = 0) {
  const out = new Uint8Array(width * height * 4), BARS = [[235, 235, 235], [235, 235, 16], [16, 235, 235], [16, 235, 16], [235, 16, 235], [235, 16, 16], [16, 16, 235], [16, 16, 16]];
  const block = Math.max(8, width >> 3), bx = (frame * 7) % Math.max(1, width - block), by = (frame * 5) % Math.max(1, height - block);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4, inside = x >= bx && x < bx + block && y >= by && y < by + block, color = inside ? [255, 128, 0] : BARS[Math.min(7, Math.floor(x * 8 / width))];
    out[at] = color[0]; out[at + 1] = color[1]; out[at + 2] = color[2]; out[at + 3] = 255;
  }
  for (let x = 0; x < Math.min(4, width); x++) { out[x * 4] = (frame >> 8) & 255; out[x * 4 + 1] = frame & 255; out[x * 4 + 2] = 255 - (frame & 255); }
  return out;
}

const clamp8 = value => value < 0 ? 0 : value > 255 ? 255 : value;
/**
 * RGBA -> YUV 4:2:0, full-range BT.601 (JFIF, the dataspace cameras deliver for YUV_420_888): Y plane (width x height) and an interleaved chroma plane V,U,V,U... (width x height/2, the
 * NV21 order). ImageReader exposes it the way most devices do: U and V planes with pixelStride 2 and rowStride == width over the same memory. Chroma is the average of each 2x2 block.
 */
export function rgbaToYuv420(rgba, width, height) {
  const y = new Uint8Array(width * height), chromaWidth = (width + 1) >> 1, chromaHeight = (height + 1) >> 1, vu = new Uint8Array(chromaWidth * 2 * chromaHeight);
  for (let row = 0, at = 0, out = 0; row < height; row++) for (let col = 0; col < width; col++, at += 4, out++) y[out] = (rgba[at] * 77 + rgba[at + 1] * 150 + rgba[at + 2] * 29 + 128) >> 8;
  for (let row = 0; row < chromaHeight; row++) for (let col = 0; col < chromaWidth; col++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const px = col * 2 + dx, py = row * 2 + dy; if (px >= width || py >= height) continue; const at = (py * width + px) * 4; r += rgba[at]; g += rgba[at + 1]; b += rgba[at + 2]; n++; }
    r /= n; g /= n; b /= n;
    const out = (row * chromaWidth + col) * 2;
    vu[out] = clamp8(Math.round(0.5 * r - 0.418688 * g - 0.081312 * b + 128)); vu[out + 1] = clamp8(Math.round(-0.168736 * r - 0.331264 * g + 0.5 * b + 128));
  }
  return { y, vu, chromaWidth, chromaHeight, chromaRowStride: chromaWidth * 2 };
}

/** Nearest-neighbour scale of an RGBA buffer (the inline thumbnail of a capture Intent). */
export function scaleRGBA(rgba, width, height, outWidth, outHeight) {
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) { const sy = Math.min(height - 1, Math.floor((y + 0.5) * height / outHeight)); for (let x = 0; x < outWidth; x++) { const sx = Math.min(width - 1, Math.floor((x + 0.5) * width / outWidth)), from = (sy * width + sx) * 4, to = (y * outWidth + x) * 4; out[to] = rgba[from]; out[to + 1] = rgba[from + 1]; out[to + 2] = rgba[from + 2]; out[to + 3] = rgba[from + 3]; } }
  return out;
}
/** An RGBA picture turned `degrees` clockwise (90, 180, 270): { width, height, rgba }. */
export function rotateRGBA(rgba, width, height, degrees) {
  const turn = ((degrees % 360) + 360) % 360; if (turn === 0) return { width, height, rgba };
  const outWidth = turn === 180 ? width : height, outHeight = turn === 180 ? height : width, aligned = rgba.byteOffset % 4 ? rgba.slice() : rgba, source = new Uint32Array(aligned.buffer, aligned.byteOffset, width * height), out = new Uint32Array(outWidth * outHeight);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const tx = turn === 90 ? height - 1 - y : turn === 180 ? width - 1 - x : y, ty = turn === 90 ? x : turn === 180 ? height - 1 - y : width - 1 - x;
    out[ty * outWidth + tx] = source[y * width + x];
  }
  return { width: outWidth, height: outHeight, rgba: new Uint8Array(out.buffer) };
}
/** The size of the Bitmap a camera app returns in the "data" extra when the caller gave no EXTRA_OUTPUT: the capture scaled down by a power of two until it has at most `maxPixels` (AOSP Camera2 PhotoModule: makeBitmap(data, 50 * 1024)). */
export function inlineThumbnailSize(width, height, maxPixels = 50 * 1024) {
  let sample = 1; while ((width / sample) * (height / sample) > maxPixels) sample *= 2;
  return { width: Math.max(1, Math.floor(width / sample)), height: Math.max(1, Math.floor(height / sample)) };
}

/** EXIF Orientation value for a clockwise rotation of 0 / 90 / 180 / 270 degrees (CaptureRequest.JPEG_ORIENTATION). */
export const exifOrientation = degrees => ({ 0: 1, 90: 6, 180: 3, 270: 8 })[((degrees % 360) + 360) % 360] ?? 1;
/**
 * A JPEG with an Exif APP1 segment after SOI carrying the Orientation tag (big-endian TIFF, IFD0 with one entry). A camera HAL writes JPEG_ORIENTATION this way instead of turning the pixels;
 * BitmapFactory ignores it and ExifInterface reads it, exactly as with a file from a phone.
 */
export function withExifOrientation(jpeg, orientation) {
  if (!(jpeg[0] === 0xff && jpeg[1] === 0xd8)) throw new RangeError('Not a JPEG stream (no SOI marker)');
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation & 255, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff], length = payload.length + 2, out = new Uint8Array(jpeg.length + 4 + payload.length);
  out.set([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 255, ...payload], 0); out.set(jpeg.subarray(2), 6 + payload.length);
  return out;
}

/** Mean of the Y plane: what an analyzer computes per frame (used by tests as the oracle for the app's own readout). */
export function meanLuma(y) { let sum = 0; for (let i = 0; i < y.length; i++) sum += y[i]; return y.length ? sum / y.length : 0; }
