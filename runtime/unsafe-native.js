import { APKError } from './apk-error.js?v=9fc86cc65ae6';

// The VM's raw-memory model and the natives that expose it to the original libcore classes:
//   sun.misc.Unsafe / jdk.internal.misc.Unsafe     (get/put/compareAndSwap on (Object, offset) and on native addresses)
//   libcore.io.Memory                                (peek/poke/memmove behind DirectByteBuffer and ByteBuffer views)
//   java.nio.Bits.copy{From,To}*Array                (bulk typed copies behind the Buffer family)
//   sun.reflect.Reflection.getCallerClass            (caller-sensitive checks such as Unsafe.getUnsafe)
//
// Three kinds of memory exist, as on ART:
//   * Java arrays. Their byte image is the little-endian concatenation of the elements, with ART's layout constants: data starts at offset 12 (16 for long[]/double[]),
//     index scale = element size. Reads and writes of any width at any offset are served from the elements, so Unsafe.getLong(byte[], off) works like on a device.
//   * Plain objects. Field offsets are small stable integers handed out per field (Field.getOffset(), Unsafe.objectFieldOffset) and resolved back to the field slot.
//   * Native memory: a lab arena (Unsafe.allocateMemory) plus the address ranges of non-movable arrays (VMRuntime.addressOf). The VM never exposes host pointers.
const ARRAY_BASE = { '[Z': 12, '[B': 12, '[C': 12, '[S': 12, '[I': 12, '[F': 12, '[J': 16, '[D': 16 };
const ELEMENT_SIZE = { Z: 1, B: 1, C: 2, S: 2, I: 4, F: 4, J: 8, D: 8 };
const REFERENCE_BASE = 12, REFERENCE_SIZE = 4;
const ARENA_BASE = 0x400000000n, ARENA_LIMIT = 0x7ffffff00n, PAGE = 4096;
const fieldView = new DataView(new ArrayBuffer(8));
const fail = (message, kind = 'unsafe-boundary') => { throw new APKError(message, { kind }); };

function state(runtime) {
  if (!runtime.nativeMemory) {
    runtime.nativeMemory = { arena: new Uint8Array(1 << 16), top: 0, blocks: new Map(), free: [], offsets: new Map(), fieldAt: new Map(), nextOffset: 16 };
  }
  return runtime.nativeMemory;
}

// ---- array byte image -------------------------------------------------------------------------------------------------------------------------------
const elementOf = type => type.slice(1);
const baseOffset = type => ARRAY_BASE[type] ?? REFERENCE_BASE;
const indexScale = type => ELEMENT_SIZE[elementOf(type)] ?? REFERENCE_SIZE;

/** Element value -> its little-endian bytes (written into `out` at `at`). */
function encode(component, value, out, at) {
  switch (component) {
    case 'Z': case 'B': out[at] = Number(value) & 0xff; break;
    case 'C': case 'S': out[at] = Number(value) & 0xff; out[at + 1] = (Number(value) >> 8) & 0xff; break;
    case 'I': case 'F': { const v = Number(value) | 0; out[at] = v & 0xff; out[at + 1] = (v >> 8) & 0xff; out[at + 2] = (v >> 16) & 0xff; out[at + 3] = (v >>> 24) & 0xff; break; }
    default: { let v = BigInt.asUintN(64, BigInt(value)); for (let i = 0; i < 8; i++) { out[at + i] = Number(v & 0xffn); v >>= 8n; } }
  }
}
function decode(component, bytes, at) {
  switch (component) {
    case 'Z': return bytes[at] ? 1 : 0;
    case 'B': return (bytes[at] << 24) >> 24;
    case 'C': return bytes[at] | (bytes[at + 1] << 8);
    case 'S': return ((bytes[at] | (bytes[at + 1] << 8)) << 16) >> 16;
    case 'I': case 'F': return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24);
    default: { let v = 0n; for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(bytes[at + i]); return BigInt.asIntN(64, v); }
  }
}
function arrayInfo(runtime, array) {
  const object = runtime.array(array), type = object.type, component = elementOf(type);
  if (!(component in ELEMENT_SIZE)) return { object, type, component: null };
  return { object, type, component, size: ELEMENT_SIZE[component], base: baseOffset(type) };
}
function readArray(info, offset, count) {
  const out = new Uint8Array(count);
  if (info.component === 'B') { for (let i = 0; i < count; i++) out[i] = info.object.elements[offset - info.base + i] & 0xff; return out; }
  const first = Math.floor((offset - info.base) / info.size), last = Math.floor((offset - info.base + count - 1) / info.size), image = new Uint8Array((last - first + 1) * info.size);
  for (let i = first; i <= last; i++) encode(info.component, info.object.elements[i], image, (i - first) * info.size);
  out.set(image.subarray(offset - info.base - first * info.size, offset - info.base - first * info.size + count)); return out;
}
function writeArray(info, offset, bytes) {
  if (info.component === 'B') { for (let i = 0; i < bytes.length; i++) info.object.elements[offset - info.base + i] = (bytes[i] << 24) >> 24; return; }
  const first = Math.floor((offset - info.base) / info.size), last = Math.floor((offset - info.base + bytes.length - 1) / info.size), image = new Uint8Array((last - first + 1) * info.size);
  for (let i = first; i <= last; i++) encode(info.component, info.object.elements[i], image, (i - first) * info.size);
  image.set(bytes, offset - info.base - first * info.size);
  for (let i = first; i <= last; i++) info.object.elements[i] = decode(info.component, image, (i - first) * info.size);
}
function checkRange(runtime, info, offset, count) {
  const end = info.base + info.object.elements.length * info.size;
  if (offset < info.base || offset + count > end) runtime.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `Unsafe array access at offset ${offset} (+${count}) outside [${info.base}, ${end})`);
}

// ---- native addresses (arena + pinned arrays) -------------------------------------------------------------------------------------------------------
function arenaGrow(memory, needed) {
  if (needed <= memory.arena.length) return;
  let size = memory.arena.length; while (size < needed) size *= 2;
  if (size > 512 * 1024 * 1024) fail('Native memory arena limit (512 MiB) exceeded', 'native-memory-exhausted');
  const grown = new Uint8Array(size); grown.set(memory.arena); memory.arena = grown;
}
function allocateNative(runtime, bytes) {
  const memory = state(runtime), size = Number(bytes);
  if (!Number.isSafeInteger(size) || size < 0) runtime.throwJava('Ljava/lang/IllegalArgumentException;', `Unsafe.allocateMemory(${bytes})`);
  const rounded = Math.max(16, (size + 15) & ~15);
  let start = null;
  const reuse = memory.free.findIndex(block => block.size >= rounded && block.size <= rounded * 2);
  if (reuse >= 0) { start = memory.free[reuse].start; memory.free.splice(reuse, 1); memory.arena.fill(0, start, start + rounded); }
  else { start = memory.top; memory.top += rounded; arenaGrow(memory, memory.top); }
  memory.blocks.set(start, rounded); return ARENA_BASE + BigInt(start);
}
function freeNative(runtime, address) {
  const memory = state(runtime), start = Number(BigInt(address) - ARENA_BASE);
  if (!memory.blocks.has(start)) { if (address === 0n) return; fail(`Unsafe.freeMemory of an address that is not a live allocation: ${address}`, 'native-memory-invalid-free'); }
  memory.free.push({ start, size: memory.blocks.get(start) }); memory.blocks.delete(start);
}
/** Resolves a native address to {array info, byte offset in its image} or an arena slice. */
function locate(runtime, address, count) {
  address = BigInt.asIntN(64, address);
  if (address >= ARENA_BASE && address < ARENA_LIMIT) {
    const memory = state(runtime), at = Number(address - ARENA_BASE);
    if (at + count > memory.arena.length) fail(`Native access beyond the arena: ${address} (+${count})`, 'native-memory-fault');
    return { arena: memory, at };
  }
  const range = runtime.nativeAddressRange(address);
  if (!range) fail(`Native memory fault: address 0x${address.toString(16)} is not mapped`, 'native-memory-fault');
  const info = arrayInfo(runtime, range.value), offset = Number(address - range.base) + info.base;
  checkRange(runtime, info, offset, count); return { info, offset };
}
function readNative(runtime, address, count) {
  const spot = locate(runtime, address, count);
  return spot.arena ? spot.arena.arena.slice(spot.at, spot.at + count) : readArray(spot.info, spot.offset, count);
}
function writeNative(runtime, address, bytes) {
  const spot = locate(runtime, address, bytes.length);
  if (spot.arena) spot.arena.arena.set(bytes, spot.at); else writeArray(spot.info, spot.offset, bytes);
}

// ---- object fields --------------------------------------------------------------------------------------------------------------------------------
/** Reads `count` bytes at a native address (arena or pinned array); used by natives that take a raw address, e.g. CRC32.updateByteBuffer. */
export function readNativeBytes(runtime, address, count) { return readNative(runtime, BigInt(address), count); }
/** Writes bytes at a native address (arena or pinned array); the counterpart of readNativeBytes for natives that fill a direct buffer. */
export function writeNativeBytes(runtime, address, bytes) { writeNative(runtime, BigInt(address), bytes); }
/** Allocates / frees a block of native arena memory (Unsafe.allocateMemory / freeMemory) for natives that hand a raw address to Java, e.g. a memory-mapped file. */
export function allocateNativeBlock(runtime, bytes) { return allocateNative(runtime, bytes); }
export function freeNativeBlock(runtime, address) { freeNative(runtime, address); }
export function fieldOffset(runtime, key) {
  const memory = state(runtime);
  let offset = memory.offsets.get(key);
  if (offset === undefined) { offset = memory.nextOffset; memory.nextOffset += 8; memory.offsets.set(key, offset); memory.fieldAt.set(offset, key); }
  return offset;
}
function fieldKey(runtime, offset) {
  const key = state(runtime).fieldAt.get(Number(offset));
  if (!key) runtime.throwJava('Ljava/lang/IllegalArgumentException;', `Unsafe: offset ${offset} does not name an instance field`);
  return key;
}

// ---- Unsafe ---------------------------------------------------------------------------------------------------------------------------------------
const KINDS = [['Boolean', 'Z', 1], ['Byte', 'B', 1], ['Char', 'C', 2], ['Short', 'S', 2], ['Int', 'I', 4], ['Long', 'J', 8], ['Float', 'F', 4], ['Double', 'D', 8]];

function access(runtime, object, offset, component, size) {
  if (object === null || object === 0) return { native: true, address: BigInt(offset) };
  const target = runtime.object(object);
  if (target.elements) {
    const info = arrayInfo(runtime, object); if (info.component === null) fail('Unsafe primitive access to a reference array is not supported', 'unsafe-reference-array');
    checkRange(runtime, info, Number(offset), size); return { info, offset: Number(offset) };
  }
  return { field: fieldKey(runtime, offset), fields: target.fields, object: target };
}
function getValue(runtime, object, offset, component) {
  const size = ELEMENT_SIZE[component], spot = access(runtime, object, offset, component, size);
  if (spot.field) { const value = spot.fields.get(spot.field); return value === undefined ? (component === 'J' || component === 'D' ? 0n : 0) : value; }
  const bytes = spot.native ? readNative(runtime, spot.address, size) : readArray(spot.info, spot.offset, size);
  return decode(component, bytes, 0);
}
function putValue(runtime, object, offset, component, value) {
  const size = ELEMENT_SIZE[component], spot = access(runtime, object, offset, component, size);
  if (spot.field) { runtime.storeField(spot.fields, spot.field, value); return; }
  const bytes = new Uint8Array(size); encode(component, value, bytes, 0);
  if (spot.native) writeNative(runtime, spot.address, bytes); else writeArray(spot.info, spot.offset, bytes);
}
function objectSlot(runtime, object, offset) {
  const target = runtime.object(object);
  if (target.elements) {
    const info = arrayInfo(runtime, object), index = (Number(offset) - info.base) / info.size;
    if (!Number.isInteger(index) || index < 0 || index >= target.elements.length) runtime.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `Unsafe object-array access at offset ${offset}`);
    return { get: () => target.elements[index], set: value => { runtime.checkArrayValue(target, value); target.elements[index] = value; } };
  }
  const key = fieldKey(runtime, offset);
  return { get: () => target.fields.get(key) ?? null, set: value => runtime.storeField(target.fields, key, value) };
}

export function createUnsafeNativeBindings() {
  const bindings = new Map(), add = (owner, signature, callback) => bindings.set(`${owner}->${signature}`, callback);
  for (const owner of ['Lsun/misc/Unsafe;', 'Ljdk/internal/misc/Unsafe;']) {
    // static helpers behind arrayBaseOffset/arrayIndexScale
    add(owner, 'getArrayBaseOffsetForComponentType(Ljava/lang/Class;)I', (runtime, [component]) => baseOffset('[' + (runtime.object(component).classType ?? 'L')));
    add(owner, 'getArrayIndexScaleForComponentType(Ljava/lang/Class;)I', (runtime, [component]) => indexScale('[' + (runtime.object(component).classType ?? 'L')));
    for (const [name, component] of KINDS) {
      const wide = component === 'J' || component === 'D';
      for (const suffix of ['', 'Volatile']) {
        if (component === 'Z' && suffix) continue;
        add(owner, `get${name}${suffix}(Ljava/lang/Object;J)${component}`, (runtime, [, object, offset]) => getValue(runtime, object, offset, component));
        add(owner, `put${name}${suffix}(Ljava/lang/Object;J${component})V`, (runtime, [, object, offset, value]) => { putValue(runtime, object, offset, component, value); });
      }
      add(owner, `get${name}(J)${component}`, (runtime, [, address]) => getValue(runtime, null, address, component));
      add(owner, `put${name}(J${component})V`, (runtime, [, address, value]) => { putValue(runtime, null, address, component, value); });
      void wide;
    }
    for (const [name, component] of [['Int', 'I'], ['Long', 'J']]) add(owner, `putOrdered${name}(Ljava/lang/Object;J${component})V`, (runtime, [, object, offset, value]) => { putValue(runtime, object, offset, component, value); });
    add(owner, 'putOrderedObject(Ljava/lang/Object;JLjava/lang/Object;)V', (runtime, [, object, offset, value]) => { objectSlot(runtime, object, offset).set(value); });
    add(owner, 'getObject(Ljava/lang/Object;J)Ljava/lang/Object;', (runtime, [, object, offset]) => objectSlot(runtime, object, offset).get());
    add(owner, 'getObjectVolatile(Ljava/lang/Object;J)Ljava/lang/Object;', (runtime, [, object, offset]) => objectSlot(runtime, object, offset).get());
    add(owner, 'putObject(Ljava/lang/Object;JLjava/lang/Object;)V', (runtime, [, object, offset, value]) => { objectSlot(runtime, object, offset).set(value); });
    add(owner, 'putObjectVolatile(Ljava/lang/Object;JLjava/lang/Object;)V', (runtime, [, object, offset, value]) => { objectSlot(runtime, object, offset).set(value); });
    const cas = (name, component) => (runtime, [, object, offset, expected, value]) => {
      const current = getValue(runtime, object, offset, component); if (current !== (component === 'J' ? BigInt.asIntN(64, expected) : expected)) return 0;
      putValue(runtime, object, offset, component, value); return 1;
    };
    add(owner, 'compareAndSwapInt(Ljava/lang/Object;JII)Z', cas('Int', 'I')); add(owner, 'compareAndSwapLong(Ljava/lang/Object;JJJ)Z', cas('Long', 'J'));
    add(owner, 'compareAndSetInt(Ljava/lang/Object;JII)Z', cas('Int', 'I')); add(owner, 'compareAndSetLong(Ljava/lang/Object;JJJ)Z', cas('Long', 'J'));
    const casObject = (runtime, [, object, offset, expected, value]) => {
      const slot = objectSlot(runtime, object, offset), current = slot.get();
      const same = current === expected || (current?.ref !== undefined && current.ref === expected?.ref); if (!same) return 0; slot.set(value); return 1;
    };
    add(owner, 'compareAndSwapObject(Ljava/lang/Object;JLjava/lang/Object;Ljava/lang/Object;)Z', casObject); add(owner, 'compareAndSetObject(Ljava/lang/Object;JLjava/lang/Object;Ljava/lang/Object;)Z', casObject);
    add(owner, 'allocateInstance(Ljava/lang/Class;)Ljava/lang/Object;', (runtime, [, cls]) => runtime.allocate(runtime.object(cls).classType));
    add(owner, 'addressSize()I', () => 4); add(owner, 'pageSize()I', () => PAGE);
    add(owner, 'allocateMemory(J)J', (runtime, [, bytes]) => allocateNative(runtime, bytes));
    add(owner, 'freeMemory(J)V', (runtime, [, address]) => { freeNative(runtime, address); });
    add(owner, 'setMemory(JJB)V', (runtime, [, address, bytes, value]) => { writeNative(runtime, address, new Uint8Array(Number(bytes)).fill(value & 0xff)); });
    for (const fence of ['loadFence', 'storeFence', 'fullFence']) add(owner, `${fence}()V`, () => {}); // one thread of execution at a time: every access is already ordered
    if (owner === 'Ljdk/internal/misc/Unsafe;') add(owner, 'copyMemory0(Ljava/lang/Object;JLjava/lang/Object;JJ)V', (runtime, [, srcBase, srcOffset, dstBase, dstOffset, bytes]) => {
      const count = Number(bytes), data = srcBase === null ? readNative(runtime, BigInt(srcOffset), count) : readArray(access(runtime, srcBase, srcOffset, 'B', count).info, Number(srcOffset), count);
      if (dstBase === null) writeNative(runtime, BigInt(dstOffset), data); else writeArray(access(runtime, dstBase, dstOffset, 'B', count).info, Number(dstOffset), data);
    });
    else add(owner, 'copyMemory(JJJ)V', (runtime, [, src, dst, bytes]) => { writeNative(runtime, dst, readNative(runtime, src, Number(bytes))); });
  }

  // ---- libcore.io.Memory
  const MEMORY = 'Llibcore/io/Memory;';
  add(MEMORY, 'peekByte(J)B', (runtime, [address]) => decode('B', readNative(runtime, address, 1), 0));
  add(MEMORY, 'pokeByte(JB)V', (runtime, [address, value]) => { writeNative(runtime, address, Uint8Array.of(value & 0xff)); });
  add(MEMORY, 'peekShortNative(J)S', (runtime, [address]) => decode('S', readNative(runtime, address, 2), 0));
  add(MEMORY, 'peekIntNative(J)I', (runtime, [address]) => decode('I', readNative(runtime, address, 4), 0));
  add(MEMORY, 'peekLongNative(J)J', (runtime, [address]) => decode('J', readNative(runtime, address, 8), 0));
  add(MEMORY, 'pokeShortNative(JS)V', (runtime, [address, value]) => { const b = new Uint8Array(2); encode('S', value, b, 0); writeNative(runtime, address, b); });
  add(MEMORY, 'pokeIntNative(JI)V', (runtime, [address, value]) => { const b = new Uint8Array(4); encode('I', value, b, 0); writeNative(runtime, address, b); });
  add(MEMORY, 'pokeLongNative(JJ)V', (runtime, [address, value]) => { const b = new Uint8Array(8); encode('J', value, b, 0); writeNative(runtime, address, b); });
  add(MEMORY, 'peekByteArray(J[BII)V', (runtime, [address, dst, offset, count]) => {
    const info = arrayInfo(runtime, dst), bytes = readNative(runtime, address, count); checkRange(runtime, info, info.base + offset, count); writeArray(info, info.base + offset, bytes);
  });
  add(MEMORY, 'pokeByteArray(J[BII)V', (runtime, [address, src, offset, count]) => {
    const info = arrayInfo(runtime, src); checkRange(runtime, info, info.base + offset, count); writeNative(runtime, address, readArray(info, info.base + offset, count));
  });
  const swapElements = (bytes, size) => { for (let i = 0; i < bytes.length; i += size) bytes.subarray(i, i + size).reverse(); return bytes; };
  for (const [name, component, array] of [['Char', 'C', '[C'], ['Double', 'D', '[D'], ['Float', 'F', '[F'], ['Int', 'I', '[I'], ['Long', 'J', '[J'], ['Short', 'S', '[S']]) {
    const size = ELEMENT_SIZE[component];
    add(MEMORY, `peek${name}Array(J${array}IIZ)V`, (runtime, [address, dst, offset, count, swap]) => {
      const info = arrayInfo(runtime, dst); let bytes = readNative(runtime, address, count * size); if (swap) swapElements(bytes, size);
      checkRange(runtime, info, info.base + offset * size, count * size); writeArray(info, info.base + offset * size, bytes);
    });
    add(MEMORY, `poke${name}Array(J${array}IIZ)V`, (runtime, [address, src, offset, count, swap]) => {
      const info = arrayInfo(runtime, src); checkRange(runtime, info, info.base + offset * size, count * size);
      const bytes = readArray(info, info.base + offset * size, count * size); if (swap) swapElements(bytes, size); writeNative(runtime, address, bytes);
    });
  }
  // memmove between any two array/native images (byte offsets measured from the start of the data)
  add(MEMORY, 'memmove(Ljava/lang/Object;ILjava/lang/Object;IJ)V', (runtime, [dst, dstOffset, src, srcOffset, byteCount]) => {
    const count = Number(byteCount), s = arrayInfo(runtime, src), d = arrayInfo(runtime, dst);
    checkRange(runtime, s, s.base + srcOffset, count); checkRange(runtime, d, d.base + dstOffset, count); writeArray(d, d.base + dstOffset, readArray(s, s.base + srcOffset, count));
  });
  add(MEMORY, 'unsafeBulkGet(Ljava/lang/Object;II[BIIZ)V', (runtime, [dst, dstOffset, byteCount, src, srcOffset, sizeofElements, swap]) => {
    const s = arrayInfo(runtime, src), d = arrayInfo(runtime, dst); checkRange(runtime, s, s.base + srcOffset, byteCount); checkRange(runtime, d, d.base + dstOffset, byteCount);
    const bytes = readArray(s, s.base + srcOffset, byteCount); if (swap) swapElements(bytes, sizeofElements); writeArray(d, d.base + dstOffset, bytes);
  });
  add(MEMORY, 'unsafeBulkPut([BIILjava/lang/Object;IIZ)V', (runtime, [dst, dstOffset, byteCount, src, srcOffset, sizeofElements, swap]) => {
    const s = arrayInfo(runtime, src), d = arrayInfo(runtime, dst); checkRange(runtime, s, s.base + srcOffset, byteCount); checkRange(runtime, d, d.base + dstOffset, byteCount);
    const bytes = readArray(s, s.base + srcOffset, byteCount); if (swap) swapElements(bytes, sizeofElements); writeArray(d, d.base + dstOffset, bytes);
  });

  // ---- java.nio.Bits bulk copies: (array object, byte offset from the array object, native address, byte length)
  const BITS = 'Ljava/nio/Bits;';
  for (const [name, size] of [['Short', 2], ['Int', 4], ['Long', 8]]) {
    add(BITS, `copyFrom${name}Array(Ljava/lang/Object;JJJ)V`, (runtime, [src, srcPos, dstAddr, length]) => {
      const info = arrayInfo(runtime, src), count = Number(length); checkRange(runtime, info, Number(srcPos), count); writeNative(runtime, dstAddr, readArray(info, Number(srcPos), count));
    });
    add(BITS, `copyTo${name}Array(JLjava/lang/Object;JJ)V`, (runtime, [srcAddr, dst, dstPos, length]) => {
      const info = arrayInfo(runtime, dst), count = Number(length); checkRange(runtime, info, Number(dstPos), count); writeArray(info, Number(dstPos), readNative(runtime, srcAddr, count));
    });
    void size;
  }

  return bindings;
}
