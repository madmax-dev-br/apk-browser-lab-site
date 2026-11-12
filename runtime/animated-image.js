import { APKError } from './apk-error.js?v=f407b1282aab';

// Animated images (GIF, animated WebP) for android.graphics.drawable.AnimatedImageDrawable and android.graphics.Movie (src/animated-image-host.js).
// The frames come from Skia's SkAnimatedImage, the class Android's own AnimatedImageDrawable is built on, through the pinned CanvasKit (MakeAnimatedImageFromEncoded): it composes
// every frame with the file's disposal and blend modes and reports the frame durations and the repetition count of the file. SkAnimatedImage only steps forward, so it keeps the
// frame on screen and what the next one needs (at most the previous canvas to restore), never every frame: an animation of any length costs the encoded bytes plus a few frames.
// This module adds what the lab needs on top: a cyclic cursor (`index`), going back by rewinding and stepping, and the pixels of the current frame for a recorded canvas command.
// The container parsers below read only structure (frame count, delays, loop count): what Movie.duration() and ImageInfo.isAnimated() need without decoding a pixel.
const fail = (message, details = {}) => { throw new APKError(message, { kind: 'animated-image', ...details }); };
const base64 = bytes => { let binary = ''; for (let at = 0; at < bytes.length; at += 16384) binary += String.fromCharCode(...bytes.subarray(at, at + 16384)); return btoa(binary); };

/**
 * The structure of a GIF (GIF87a / GIF89a): logical screen size, one entry per image descriptor with the delay and disposal of the graphic control extension before it, and the
 * NETSCAPE2.0 loop count (null without the extension: the animation plays once). Null when the data is not a GIF; a truncated file yields the frames that are complete.
 */
export function parseGifStructure(b) {
  if (!b || b.length < 13 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x38 || (b[4] !== 0x37 && b[4] !== 0x39) || b[5] !== 0x61) return null;
  const width = b[6] | (b[7] << 8), height = b[8] | (b[9] << 8), frames = []; let at = 13, loopCount = null, control = null;
  if (b[10] & 0x80) at += 3 << ((b[10] & 7) + 1);
  const skipBlocks = () => { while (at < b.length) { const size = b[at++]; if (size === 0) return true; at += size; } return false; };
  while (at < b.length) {
    const kind = b[at++];
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      const label = b[at++];
      if (label === 0xf9 && b[at] === 4 && at + 5 < b.length) control = { delayMs: (b[at + 2] | (b[at + 3] << 8)) * 10, disposal: (b[at + 1] >> 2) & 7, transparent: b[at + 1] & 1 ? b[at + 4] : -1 };
      else if (label === 0xff && b[at] === 11 && at + 16 < b.length && String.fromCharCode(...b.subarray(at + 1, at + 12)) === 'NETSCAPE2.0' && b[at + 12] === 3 && b[at + 13] === 1) loopCount = b[at + 14] | (b[at + 15] << 8);
      if (!skipBlocks()) break;
    } else if (kind === 0x2c) {
      if (at + 9 > b.length) break;
      const frame = { x: b[at] | (b[at + 1] << 8), y: b[at + 2] | (b[at + 3] << 8), width: b[at + 4] | (b[at + 5] << 8), height: b[at + 6] | (b[at + 7] << 8), delayMs: control?.delayMs ?? 0, disposal: control?.disposal ?? 0, transparent: control?.transparent ?? -1 };
      const flags = b[at + 8]; at += 9; if (flags & 0x80) at += 3 << ((flags & 7) + 1);
      at++;   // LZW minimum code size
      if (!skipBlocks()) break;
      frames.push(frame); control = null;
    } else break;
  }
  return { width, height, frames, loopCount };
}

/** The structure of an animated WebP (VP8X with the animation flag): canvas size, the ANMF frames (duration, offset, size, blend and dispose bits) and the ANIM loop count. Null for anything else. */
export function parseWebpAnimation(b) {
  if (!b || b.length < 30 || String.fromCharCode(b[0], b[1], b[2], b[3], b[8], b[9], b[10], b[11]) !== 'RIFFWEBP') return null;
  const u24 = at => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16), u32 = at => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
  let width = 0, height = 0, animated = false, loopCount = 0; const frames = [];
  for (let at = 12; at + 8 <= b.length;) {
    const tag = String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]), size = u32(at + 4), body = at + 8;
    if (body + size > b.length) break;
    if (tag === 'VP8X' && size >= 10) { animated = (b[body] & 0x02) !== 0; width = u24(body + 4) + 1; height = u24(body + 7) + 1; }
    else if (tag === 'ANIM' && size >= 6) loopCount = b[body + 4] | (b[body + 5] << 8);
    else if (tag === 'ANMF' && size >= 16) frames.push({ x: u24(body) * 2, y: u24(body + 3) * 2, width: u24(body + 6) + 1, height: u24(body + 9) + 1, durationMs: u24(body + 12), blend: (b[body + 15] & 2) === 0, disposeToBackground: (b[body + 15] & 1) !== 0 });
    at = body + size + (size & 1);
  }
  return animated ? { width, height, frames, loopCount } : null;
}

/** How many frames the container declares (1 for a still image or an unknown container): cheap, no decoding. */
export function declaredFrameCount(bytes) { return parseGifStructure(bytes)?.frames.length ?? parseWebpAnimation(bytes)?.frames.length ?? 1; }

/**
 * A cursor over the frames of an animated image. `index` is the frame on screen (0-based), `duration` its duration in ms as the file says, `repetitionCount` the file's own
 * (SkCodec's: -1 forever, n = played n + 1 times). advance() shows the next frame and wraps to the first after the last (the caller counts the loops); seek(i) shows frame i.
 * pixels() is the composed canvas now: premultiplied RGBA8 rows plus their base64 (cached per frame for the recorded canvas command).
 */
export class AnimatedFrames {
  constructor(CanvasKit, bytes) {
    if (!CanvasKit?.MakeAnimatedImageFromEncoded) fail('Animated image decoding requires the verified Skia CanvasKit backend');
    this.CK = CanvasKit; this.bytes = bytes; this.image = CanvasKit.MakeAnimatedImageFromEncoded(bytes);
    if (!this.image) fail('Skia rejected the animated image');
    this.width = this.image.width(); this.height = this.image.height(); this.frameCount = Math.max(1, this.image.getFrameCount()); this.repetitionCount = this.image.getRepetitionCount();
    this.index = 0; this.duration = this.image.currentFrameDuration(); this.cached = null; this.decoded = 1;
  }
  /** Back to the first frame. SkAnimatedImage counts its own repetitions and stops stepping when they are used up; the lab counts loops itself, so a rewind also restarts that count. */
  reset() { this.image.reset(); this.index = 0; this.duration = this.image.currentFrameDuration(); this.cached = null; }
  advance() {
    if (this.frameCount <= 1) return this.duration;
    if (this.index === this.frameCount - 1) { this.reset(); return this.duration; }
    const next = this.image.decodeNextFrame(); this.decoded++;
    if (next < 0) { this.reset(); return this.duration; }   // the image's own repetition count ran out in the middle (the frame count of a truncated file): start over
    this.index++; this.duration = next; this.cached = null; return next;
  }
  seek(index) {
    if (index < 0 || index >= this.frameCount) fail(`Animated image frame ${index} out of range (${this.frameCount} frames)`);
    if (index < this.index) this.reset();
    while (this.index < index) { const before = this.index; this.advance(); if (this.index <= before) break; }
  }
  pixels() {
    if (this.cached) return this.cached;
    const CK = this.CK, image = this.image.makeImageAtCurrentFrame(); if (!image) fail('Skia produced no image for the current animation frame');
    try {
      const rgba = image.readPixels(0, 0, { width: this.width, height: this.height, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Premul, colorSpace: CK.ColorSpace.SRGB });
      if (!rgba) fail('Skia could not read the current animation frame');
      return this.cached = { rgba, base64: base64(rgba), width: this.width, height: this.height };
    } finally { image.delete(); }
  }
  dispose() { if (this.image) { try { this.image.delete(); } catch { /* already released */ } this.image = null; this.cached = null; } }
}
