// The memory side of the graphics natives (vmcore/graphics.h) for the JavaScript hosts: the CanvasBlock of each native canvas (allocated from metaspace, recycled with a new
// generation when its canvas is released), the Canvas records bound to them, the log the natives wrote, and the Paint payload's offsets. src/vector-native.js and
// src/paint-host.js reach it as `runtime.wasm.graphics` (absent on the JavaScript VM, where nothing changes).
import { CANVAS, PAINT } from './natives.js?v=a8e6c1332674';

// graphics.h: the Canvas record's payload, the CanvasBlock, the Paint record's payload
export const CANVAS_RECORD = Object.freeze({ block: 8, generation: 12, end: 16 });
export const CANVAS_BLOCK = Object.freeze({ active: 0, generation: 4, depth: 8, count: 12, kinds: 16, log: 272, entry: 12, capacity: 512, maxSaves: 256 });
export const CANVAS_OP = Object.freeze({ translate: 1, save: 2, restoreTo: 3 });
export const PAINT_RECORD = Object.freeze({ state: 8, color: 12, flags: 16, hyphenEdit: 20, colorLongSet: 24, colorLong: 32, handle: 40, end: 48 });
const BLOCK_BYTES = CANVAS_BLOCK.log + CANVAS_BLOCK.entry * CANVAS_BLOCK.capacity;
/** The most blocks metaspace gives the canvases (about 6 KiB each); a canvas made past it has none, and the natives defer for it. */
export const MAX_CANVAS_BLOCKS = 4096;

export class GraphicsBlocks {
  constructor(engine) { this.engine = engine; this.free = []; this.made = 0; this.f32view = null; this.i32view = null; }
  get u32() { return this.engine.u32; }
  get f32() { return this.f32view ??= new Float32Array(this.engine.memory.buffer); }
  get i32() { return this.i32view ??= new Int32Array(this.engine.memory.buffer); }
  /** A fresh block for a new canvas (depth 0, an empty log, active), or 0 when none is left. */
  allocateCanvas() {
    let at = this.free.pop();
    if (at === undefined) { if (this.made >= MAX_CANVAS_BLOCKS) return 0; at = this.engine.linker.alloc(BLOCK_BYTES); this.made++; }
    const u32 = this.u32, w = at >>> 2;
    u32[w + 2] = 0; u32[w + 3] = 0; u32[w] = 1;
    return at;
  }
  /** The canvas of `at` is released: its block goes back with a new generation (a Canvas record still bound to the old one defers). */
  releaseCanvas(at) { if (!at) return; const u32 = this.u32, w = at >>> 2; u32[w] = 0; u32[w + 1] = (u32[w + 1] + 1) >>> 0; this.free.push(at); }
  /** Binds Canvas record `ref` (android.graphics.Canvas or a subclass) to block `at` (0: unbinds it). */
  bindCanvas(ref, at) {
    const engine = this.engine, address = engine.handles.addressById.get(ref?.ref); if (address === undefined) return;
    const info = engine.linker.classes.get(engine.space.objectById(ref.ref)?.type); if (info?.graphicsOwner !== CANVAS) return;
    engine.w32(address + CANVAS_RECORD.block, at); engine.w32(address + CANVAS_RECORD.generation, at ? engine.r32(at + CANVAS_BLOCK.generation) : 0);
  }
  // The log (CANVAS_BLOCK.log, `count` entries of { op, a, b }) is replayed and emptied by src/vector-native.js VectorGraphics.fromCore.
  depth(at) { return this.u32[(at + CANVAS_BLOCK.depth) >>> 2]; }
  /** The host's save stack changed: its depth and, per level, whether only the host may restore it (`needsHost(entry)`). */
  setStack(at, stack, needsHost) {
    const u32 = this.u32, n = Math.min(stack.length, CANVAS_BLOCK.maxSaves), bytes = new Uint8Array(this.engine.memory.buffer, at + CANVAS_BLOCK.kinds, n);
    for (let i = 0; i < n; i++) bytes[i] = needsHost(stack[i]) ? 1 : 0;
    u32[(at + CANVAS_BLOCK.depth) >>> 2] = stack.length;
  }
  /** The payload address of Paint record `ref` (android.graphics.Paint or a subclass), or 0. */
  paintPayload(ref) {
    const engine = this.engine, address = engine.handles.addressById.get(ref?.ref); if (address === undefined) return 0;
    return engine.linker.classes.get(engine.space.objectById(ref.ref)?.type)?.graphicsOwner === PAINT ? address : 0;
  }
}
