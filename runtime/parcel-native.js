import { APKError } from './apk-error.js?v=af3232247547';
import { throwNew } from './java-throw.js?v=af3232247547';

// android.os.Parcel natives (android_os_Parcel.cpp over libbinder's Parcel.cpp, android-13.0.0_r1) behind the ORIGINAL Parcel.java in framework.dex.
//
// A native Parcel is a growable byte buffer with a position and size (everything 4-byte aligned, little endian, like libbinder) plus a table of the objects (strong binders)
// written into it. The layouts match the Android 13 wire format for the primitives the Java code builds: ints/longs/floats/doubles, String16 (length, UTF-16 units, NUL, padded),
// String8 (length, UTF-8 bytes, NUL, padded), byte arrays and blobs (length, padded data), interface tokens (policy header, work-source uid, 'SYST', String16) and strong
// binders (a 24-byte flat_binder_object). Because the whole VM is one process, a "binder" written into a Parcel is the in-process IBinder object itself: reading it back returns
// that object, exactly what Parcel.readStrongBinder gives for a local Binder. File descriptors cannot be passed (no kernel); they fail explicitly.
const PARCEL = 'Landroid/os/Parcel;', IBINDER = 'Landroid/os/IBinder;', STRING = 'Ljava/lang/String;';
const BINDER_TYPE_BINDER = 0x73622a85, BINDER_OBJECT_SIZE = 24, STRICT_MODE_PENALTY_GATHER = 1 << 31 >> 0, INTERFACE_HEADER = 0x53595354;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8');
const states = new WeakMap();

class NativeParcel {
  constructor() { this.bytes = new Uint8Array(256); this.view = new DataView(this.bytes.buffer); this.size = 0; this.position = 0; this.objects = new Map(); this.allowFds = true; }
  ensure(end) {
    if (end <= this.bytes.length) return;
    let capacity = this.bytes.length; while (capacity < end) capacity *= 2;
    const grown = new Uint8Array(capacity); grown.set(this.bytes.subarray(0, this.size)); this.bytes = grown; this.view = new DataView(grown.buffer);
  }
  /** Reserves `length` bytes at the position (aligned to 4), moving the position and growing the size; returns the offset. */
  reserve(length) {
    const padded = (length + 3) & ~3, at = this.position; this.ensure(at + padded);
    this.position = at + padded; if (this.position > this.size) this.size = this.position;
    for (let i = length; i < padded; i++) this.bytes[at + i] = 0;
    return at;
  }
}

export function createParcelNativeBindings() {
  const bindings = new Map(), add = (signature, callback) => bindings.set(`${PARCEL}->${signature}`, callback);
  const registry = runtime => states.get(runtime) ?? states.set(runtime, { parcels: new Map(), next: 0x7000_0000_0000n, allocated: 0n, count: 0n }).get(runtime);
  const parcel = (runtime, pointer) => { const value = registry(runtime).parcels.get(pointer); if (!value) throw new APKError('Parcel native pointer is not live (use after recycle/destroy)', { kind: 'parcel-dead' }); return value; };
  const bad = (runtime, message) => runtime.throwJava('Ljava/lang/RuntimeException;', message);
  const need = (runtime, p, length) => { if (p.position + length > p.size) bad(runtime, 'Parcel: read past the end of the data'); };

  add('nativeCreate()J', runtime => { const r = registry(runtime), pointer = r.next++; r.parcels.set(pointer, new NativeParcel()); r.count++; return pointer; });
  add('nativeDestroy(J)V', (runtime, [pointer]) => { const r = registry(runtime); if (r.parcels.delete(pointer)) r.count--; });
  add('nativeFreeBuffer(J)V', (runtime, [pointer]) => { const p = parcel(runtime, pointer); p.size = 0; p.position = 0; p.objects.clear(); });
  add('nativeMarkSensitive(J)V', () => undefined);
  add('nativeMarkForBinder(JLandroid/os/IBinder;)V', () => undefined);
  add('nativeDataSize(J)I', (runtime, [pointer]) => parcel(runtime, pointer).size);
  add('nativeDataAvail(J)I', (runtime, [pointer]) => { const p = parcel(runtime, pointer); return Math.max(0, p.size - p.position); });
  add('nativeDataPosition(J)I', (runtime, [pointer]) => parcel(runtime, pointer).position);
  add('nativeDataCapacity(J)I', (runtime, [pointer]) => parcel(runtime, pointer).bytes.length);
  add('nativeSetDataSize(JI)V', (runtime, [pointer, size]) => { const p = parcel(runtime, pointer); if (size < 0) bad(runtime, 'Parcel: negative size'); p.ensure(size); if (size > p.size) p.bytes.fill(0, p.size, size); p.size = size; if (p.position > size) p.position = size; for (const offset of [...p.objects.keys()]) if (offset + BINDER_OBJECT_SIZE > size) p.objects.delete(offset); });
  add('nativeSetDataPosition(JI)V', (runtime, [pointer, position]) => { const p = parcel(runtime, pointer); if (position < 0 || position > p.size) bad(runtime, 'Parcel: invalid position'); p.position = position; });
  add('nativeSetDataCapacity(JI)V', (runtime, [pointer, capacity]) => parcel(runtime, pointer).ensure(capacity));
  add('nativePushAllowFds(JZ)Z', (runtime, [pointer, allow]) => { const p = parcel(runtime, pointer), last = p.allowFds; p.allowFds = !!allow && p.allowFds; return last ? 1 : 0; });
  add('nativeRestoreAllowFds(JZ)V', (runtime, [pointer, last]) => { parcel(runtime, pointer).allowFds = !!last; });
  add('nativeHasFileDescriptors(J)Z', () => 0);
  add('nativeHasFileDescriptorsInRange(JII)Z', () => 0);
  add('nativeGetOpenAshmemSize(J)J', () => 0n);
  add('nativeReplaceCallingWorkSourceUid(JI)Z', () => 1);
  add('nativeReadCallingWorkSourceUid(J)I', () => -1);
  add('getGlobalAllocSize()J', runtime => registry(runtime).allocated);
  add('getGlobalAllocCount()J', runtime => registry(runtime).count);

  // ---- writing
  const writeInt = (p, value) => { const at = p.reserve(4); p.view.setInt32(at, value, true); };
  add('nativeWriteInt(JI)I', (runtime, [pointer, value]) => { writeInt(parcel(runtime, pointer), value); return 0; });
  add('nativeWriteLong(JJ)I', (runtime, [pointer, value]) => { const p = parcel(runtime, pointer), at = p.reserve(8); p.view.setBigInt64(at, BigInt.asIntN(64, BigInt(value)), true); return 0; });
  add('nativeWriteFloat(JF)I', (runtime, [pointer, value]) => { const p = parcel(runtime, pointer), at = p.reserve(4); p.view.setInt32(at, value, true); return 0; });   // floats travel as their IEEE bits
  add('nativeWriteDouble(JD)I', (runtime, [pointer, value]) => { const p = parcel(runtime, pointer), at = p.reserve(8); p.view.setBigInt64(at, BigInt.asIntN(64, BigInt(value)), true); return 0; });
  add('nativeSignalExceptionForError(I)V', (runtime, [error]) => {
    if (error === 0) return;
    // libbinder status codes: -EBADF/-EBADMSG are protocol faults, DEAD_OBJECT is a dead remote, anything else an unknown failure (jniThrowExceptionForStatus).
    const messages = { [-2147483647 - 1]: 'Unknown error', [-32]: 'Broken pipe', [-74]: 'Bad message', [-22]: 'Invalid argument', [-1]: 'Operation not permitted', [-12]: 'Out of memory', [-32 - 0]: 'Broken pipe' };
    if (error === -32) throwNew(runtime, 'Landroid/os/DeadObjectException;', null);
    runtime.throwJava('Ljava/lang/RuntimeException;', messages[error] ?? `Unknown error: ${error}`);
  });
  const writeBytes = (p, source, offset, length) => { const at = p.reserve(length); for (let i = 0; i < length; i++) p.bytes[at + i] = source[offset + i] & 255; };
  add('nativeWriteByteArray(J[BII)V', (runtime, [pointer, array, offset, length]) => {
    const p = parcel(runtime, pointer);
    if (array === null || array === 0) { writeInt(p, -1); return; }
    const elements = runtime.object(array).elements; if (offset < 0 || length < 0 || offset > elements.length - length) runtime.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `length=${elements.length}; regionStart=${offset}; regionLength=${length}`);
    writeInt(p, length); writeBytes(p, elements, offset, length);
  });
  add('nativeWriteBlob(J[BII)V', (runtime, [pointer, array, offset, length]) => {   // libbinder writeBlob: length, BLOB_INPLACE flag, data (ashmem is not used)
    const p = parcel(runtime, pointer);
    if (array === null || array === 0) { writeInt(p, -1); return; }
    const elements = runtime.object(array).elements; if (offset < 0 || length < 0 || offset > elements.length - length) runtime.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `length=${elements.length}; regionStart=${offset}; regionLength=${length}`);
    writeInt(p, length); writeInt(p, 0); writeBytes(p, elements, offset, length);
  });
  const writeString16 = (p, value) => {
    if (value === null || value === 0) { writeInt(p, -1); return; }
    const text = typeof value === 'string' ? value : String(value); writeInt(p, text.length);
    const at = p.reserve((text.length + 1) * 2); for (let i = 0; i < text.length; i++) p.view.setUint16(at + i * 2, text.charCodeAt(i), true); p.view.setUint16(at + text.length * 2, 0, true);
  };
  add('nativeWriteString16(JLjava/lang/String;)V', (runtime, [pointer, value]) => writeString16(parcel(runtime, pointer), value === null || value === 0 ? null : runtime.stringCharacters(value)));
  add('nativeWriteString8(JLjava/lang/String;)V', (runtime, [pointer, value]) => {
    const p = parcel(runtime, pointer); if (value === null || value === 0) { writeInt(p, -1); return; }
    const bytes = encoder.encode(runtime.stringCharacters(value)); writeInt(p, bytes.length); const at = p.reserve(bytes.length + 1); p.bytes.set(bytes, at); p.bytes[at + bytes.length] = 0;
  });
  add('nativeWriteStrongBinder(JLandroid/os/IBinder;)V', (runtime, [pointer, binder]) => {
    const p = parcel(runtime, pointer), at = p.reserve(BINDER_OBJECT_SIZE);
    if (binder === null || binder === 0) { p.view.setUint32(at, BINDER_TYPE_BINDER, true); p.view.setUint32(at + 4, 0x7f, true); p.view.setBigUint64(at + 8, 0n, true); p.view.setBigUint64(at + 16, 0n, true); return; }
    p.view.setUint32(at, BINDER_TYPE_BINDER, true); p.view.setUint32(at + 4, 0x7f, true); p.view.setBigUint64(at + 8, BigInt(binder.ref), true); p.view.setBigUint64(at + 16, 0n, true);
    p.objects.set(at, binder);
  });
  add('nativeWriteFileDescriptor(JLjava/io/FileDescriptor;)V', () => { throw new APKError('Parcel.writeFileDescriptor: file descriptors cannot be passed between Parcels in the browser VM (there is no kernel to dup them into another process)', { kind: 'parcel-fd-unsupported' }); });
  add('nativeWriteInterfaceToken(JLjava/lang/String;)V', (runtime, [pointer, name]) => {
    const p = parcel(runtime, pointer); writeInt(p, STRICT_MODE_PENALTY_GATHER); writeInt(p, -1); writeInt(p, INTERFACE_HEADER); writeString16(p, runtime.stringCharacters(name));
  });

  // ---- reading
  const readInt = (runtime, p) => { need(runtime, p, 4); const value = p.view.getInt32(p.position, true); p.position += 4; return value; };
  add('nativeReadInt(J)I', (runtime, [pointer]) => readInt(runtime, parcel(runtime, pointer)));
  add('nativeReadLong(J)J', (runtime, [pointer]) => { const p = parcel(runtime, pointer); need(runtime, p, 8); const value = p.view.getBigInt64(p.position, true); p.position += 8; return value; });
  add('nativeReadFloat(J)F', (runtime, [pointer]) => readInt(runtime, parcel(runtime, pointer)));
  add('nativeReadDouble(J)D', (runtime, [pointer]) => { const p = parcel(runtime, pointer); need(runtime, p, 8); const value = p.view.getBigInt64(p.position, true); p.position += 8; return value; });
  const readPadded = (runtime, p, length) => { const padded = (length + 3) & ~3; need(runtime, p, padded); const at = p.position; p.position += padded; return at; };
  const javaBytes = (p, at, length) => Array.from(p.bytes.subarray(at, at + length), v => (v << 24) >> 24);
  add('nativeCreateByteArray(J)[B', (runtime, [pointer]) => {
    const p = parcel(runtime, pointer), length = readInt(runtime, p); if (length < 0) return null;
    const at = readPadded(runtime, p, length), array = runtime.newArray('[B', length); runtime.object(array).elements = javaBytes(p, at, length); return array;
  });
  add('nativeReadByteArray(J[BI)Z', (runtime, [pointer, dest, destLength]) => {
    const p = parcel(runtime, pointer), start = p.position, length = readInt(runtime, p);
    if (length !== destLength) { p.position = start + 4; if (length > 0) p.position = Math.min(p.size, p.position + ((length + 3) & ~3)); return 0; }
    const at = readPadded(runtime, p, length), elements = runtime.object(dest).elements; for (let i = 0; i < length; i++) elements[i] = (p.bytes[at + i] << 24) >> 24; return 1;
  });
  add('nativeReadBlob(J)[B', (runtime, [pointer]) => {
    const p = parcel(runtime, pointer), length = readInt(runtime, p); if (length < 0) return null;
    const kind = readInt(runtime, p); if (kind !== 0) throw new APKError('Parcel.readBlob: shared-memory blobs are not produced by this VM', { kind: 'parcel-ashmem-unsupported' });
    const at = readPadded(runtime, p, length), array = runtime.newArray('[B', length); runtime.object(array).elements = javaBytes(p, at, length); return array;
  });
  const readString16 = (runtime, p) => {
    const length = readInt(runtime, p); if (length < 0) return null;
    const at = readPadded(runtime, p, (length + 1) * 2); let text = ''; for (let i = 0; i < length; i++) text += String.fromCharCode(p.view.getUint16(at + i * 2, true)); return text;
  };
  add('nativeReadString16(J)Ljava/lang/String;', (runtime, [pointer]) => readString16(runtime, parcel(runtime, pointer)));
  add('nativeReadString8(J)Ljava/lang/String;', (runtime, [pointer]) => {
    const p = parcel(runtime, pointer), length = readInt(runtime, p); if (length < 0) return null;
    const at = readPadded(runtime, p, length + 1); return decoder.decode(p.bytes.subarray(at, at + length));
  });
  add('nativeReadStrongBinder(J)Landroid/os/IBinder;', (runtime, [pointer]) => {
    const p = parcel(runtime, pointer); need(runtime, p, BINDER_OBJECT_SIZE); const at = p.position;
    if (p.view.getUint32(at, true) !== BINDER_TYPE_BINDER) bad(runtime, 'Parcel: not a binder object at this position');
    p.position += BINDER_OBJECT_SIZE; return p.objects.get(at) ?? null;
  });
  add('nativeReadFileDescriptor(J)Ljava/io/FileDescriptor;', () => { throw new APKError('Parcel.readFileDescriptor: file descriptors cannot be passed between Parcels in the browser VM', { kind: 'parcel-fd-unsupported' }); });
  add('nativeEnforceInterface(JLjava/lang/String;)V', (runtime, [pointer, name]) => {
    const p = parcel(runtime, pointer); readInt(runtime, p); readInt(runtime, p); const header = readInt(runtime, p), actual = readString16(runtime, p), wanted = runtime.stringCharacters(name);
    if (header !== INTERFACE_HEADER || actual !== wanted) runtime.throwJava('Ljava/lang/SecurityException;', `Binder invocation to an incorrect interface`);
  });

  // ---- whole-parcel operations
  add('nativeMarshall(J)[B', (runtime, [pointer]) => { const p = parcel(runtime, pointer), array = runtime.newArray('[B', p.size); runtime.object(array).elements = javaBytes(p, 0, p.size); return array; });
  add('nativeUnmarshall(J[BII)V', (runtime, [pointer, data, offset, length]) => {
    const p = parcel(runtime, pointer), elements = runtime.object(data).elements; p.objects.clear(); p.ensure(length); for (let i = 0; i < length; i++) p.bytes[i] = elements[offset + i] & 255;
    p.size = length; p.position = length;
  });
  add('nativeCompareData(JJ)I', (runtime, [a, b]) => { const x = parcel(runtime, a), y = parcel(runtime, b); if (x.size !== y.size) return x.size < y.size ? -1 : 1; for (let i = 0; i < x.size; i++) if (x.bytes[i] !== y.bytes[i]) return x.bytes[i] < y.bytes[i] ? -1 : 1; return 0; });
  add('nativeCompareDataInRange(JIJII)Z', (runtime, [a, aOffset, b, bOffset, length]) => { const x = parcel(runtime, a), y = parcel(runtime, b); if (aOffset + length > x.size || bOffset + length > y.size) bad(runtime, 'Parcel: range out of bounds'); for (let i = 0; i < length; i++) if (x.bytes[aOffset + i] !== y.bytes[bOffset + i]) return 0; return 1; });
  add('nativeAppendFrom(JJII)V', (runtime, [toPointer, fromPointer, offset, length]) => {
    const to = parcel(runtime, toPointer), from = parcel(runtime, fromPointer); if (offset < 0 || length < 0 || offset + length > from.size) bad(runtime, 'Parcel: appendFrom range out of bounds');
    const at = to.position; to.ensure(at + length); to.bytes.set(from.bytes.subarray(offset, offset + length), at); to.position = at + length; if (to.position > to.size) to.size = to.position;
    for (const [objectOffset, binder] of from.objects) if (objectOffset >= offset && objectOffset + BINDER_OBJECT_SIZE <= offset + length) to.objects.set(at + objectOffset - offset, binder);
  });
  return bindings;
}
