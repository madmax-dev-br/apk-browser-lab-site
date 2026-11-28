// The size a Bitmap may have, as on Android. A bitmap's pixels are native memory (Android 8+): Bitmap.createBitmap and BitmapFactory allocate any size whose byte count fits
// the int of Bitmap.getAllocationByteCount, and fail with OutOfMemoryError ("Failed to allocate a N byte allocation") when the memory cannot be had. Drawing a bitmap of more than
// 100 MB is refused by the original RecordingCanvas (throwIfCannotDraw), not here. The lab used to refuse anything above 4096 px or 4 Mpixel: a camera photo (4284 x 4284) or a
// tall screenshot an app decodes on a device failed only in the lab.
export const MAX_BITMAP_BYTES = 0x7fffffff;
/** null when a width x height bitmap of `bytesPerPixel` fits; otherwise the OutOfMemoryError message Android gives. */
export function bitmapExtentProblem(width, height, bytesPerPixel = 4) {
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) return `Bitmap extent ${width}x${height} is not positive`;
  const bytes = width * height * bytesPerPixel;
  return bytes > MAX_BITMAP_BYTES ? `Failed to allocate a ${bytes} byte allocation` : null;
}
/** Throws the OutOfMemoryError Android throws for a bitmap that does not fit (or fails `fail` for a malformed extent). */
export function requireBitmapExtent(runtime, width, height, bytesPerPixel, fail) {
  const problem = bitmapExtentProblem(width, height, bytesPerPixel); if (problem === null) return;
  if (problem.startsWith('Failed to allocate') && typeof runtime?.throwJava === 'function') runtime.throwJava('Ljava/lang/OutOfMemoryError;', problem);
  fail(problem);
}
