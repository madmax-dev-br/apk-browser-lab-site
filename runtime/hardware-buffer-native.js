import { APKError } from './apk-error.js?v=858dc45125cc';

// Natives of the original android.hardware.HardwareBuffer (android-13.0.0_r1, core/jni/android_hardware_HardwareBuffer.cpp). A buffer the virtual device allocates is a record of
// what AHardwareBuffer_describe answers (width, height, format, layers, usage): nothing in the lab maps or samples its memory, so no pixel store is behind it. What needs the
// gralloc allocator of a real device, a GraphicBuffer or the Binder parcel of a buffer handle fails by name, and every create leaves a HARDWARE-BUFFER line in the trace saying so.
const BUFFER = 'Landroid/hardware/HardwareBuffer;', REGISTRY = 'Llibcore/util/NativeAllocationRegistry;', FINALIZER = 0x4842554601n;
export const HARDWARE_BUFFER_CLEANER = 'Lapkweb/bridge/HardwareBufferCleaner;';
const states = new WeakMap();
const stateFor = runtime => { let state = states.get(runtime); if (!state) states.set(runtime, state = { next: 0x4842000000n, buffers: new Map() }); return state; };
const fail = message => { throw new APKError(message, { kind: 'unsupported-hardware-buffer' }); };
const buffer = (runtime, handle) => stateFor(runtime).buffers.get(handle) ?? fail('Invalid or released HardwareBuffer token');
// android::bytesPerPixel (libs/ui/PixelFormat.cpp) for the formats HardwareBuffer.isSupportedFormat accepts; the JNI uses 1 for a format it does not size.
const BYTES_PER_PIXEL = new Map([[1, 4], [2, 4], [3, 3], [4, 2], [0x16, 8], [0x2b, 4]]);

export function createHardwareBufferNativeBindings() {
  const bindings = new Map(), add = (name, signature, fn) => bindings.set(`${BUFFER}->${name}${signature}`, fn);
  add('nCreateHardwareBuffer', '(IIIIJ)J', (runtime, [width, height, format, layers, usage]) => {
    const state = stateFor(runtime); if (state.buffers.size >= 4096) fail('HardwareBuffer allocation limit exceeded');
    const handle = state.next++; state.buffers.set(handle, { width, height, format, layers, usage: BigInt.asIntN(64, BigInt(usage)) });
    runtime.record(`HARDWARE-BUFFER create ${width}x${height} format ${format} layers ${layers}: described only, no gralloc memory behind it`);   // visible in the trace: the buffer is a description, not an allocation
    return handle;
  });
  add('nGetNativeFinalizer', '()J', () => FINALIZER);
  add('nGetWidth', '(J)I', (runtime, [handle]) => buffer(runtime, handle).width);
  add('nGetHeight', '(J)I', (runtime, [handle]) => buffer(runtime, handle).height);
  add('nGetFormat', '(J)I', (runtime, [handle]) => buffer(runtime, handle).format);
  add('nGetLayers', '(J)I', (runtime, [handle]) => buffer(runtime, handle).layers);
  add('nGetUsage', '(J)J', (runtime, [handle]) => buffer(runtime, handle).usage);
  add('nEstimateSize', '(J)J', (runtime, [handle]) => { const b = buffer(runtime, handle); return BigInt(b.height * b.width * (BYTES_PER_PIXEL.get(b.format) ?? 1)); });   // the stride of a virtual buffer is its width
  add('nIsSupported', '(IIIIJ)Z', () => fail('HardwareBuffer.isSupported: the virtual device has no gralloc allocator to ask'));
  add('nCreateFromGraphicBuffer', '(Landroid/graphics/GraphicBuffer;)J', () => fail('HardwareBuffer.createFromGraphicBuffer: GraphicBuffer is not modeled by the lab'));
  add('nWriteHardwareBufferToParcel', '(JLandroid/os/Parcel;)V', () => fail('HardwareBuffer.writeToParcel: a buffer handle cannot cross a Parcel in the lab'));
  add('nReadHardwareBufferFromParcel', '(Landroid/os/Parcel;)J', () => fail('HardwareBuffer.CREATOR: a buffer handle cannot cross a Parcel in the lab'));
  return bindings;
}

/** NativeAllocationRegistry of HardwareBuffer(long): `new NativeAllocationRegistry(loader, nGetNativeFinalizer(), size)`, registerNativeAllocation and the cleaner's run() (close()). */
export function hardwareBufferRegistryBridge(runtime, method, args) {
  if (method.owner === REGISTRY && method.name === '<init>' && method.signature === '(Ljava/lang/ClassLoader;JJ)V' && args[2] === FINALIZER) { runtime.object(args[0]).hardwareBufferRegistry = true; return { value: undefined }; }
  if (method.owner === REGISTRY && method.name === 'registerNativeAllocation' && method.signature === '(Ljava/lang/Object;J)Ljava/lang/Runnable;' && runtime.object(args[0]).hardwareBufferRegistry) {
    buffer(runtime, args[2]); const value = runtime.makeObject(HARDWARE_BUFFER_CLEANER); runtime.object(value).hardwareBufferCleanup = args[2]; return { value };
  }
  if (method.owner === HARDWARE_BUFFER_CLEANER && method.name === 'run' && method.signature === '()V') {
    const cleaner = runtime.object(args[0]); if (cleaner.hardwareBufferCleanup) { stateFor(runtime).buffers.delete(cleaner.hardwareBufferCleanup); cleaner.hardwareBufferCleanup = 0n; } return { value: undefined };
  }
  return null;
}
export function liveHardwareBuffers(runtime) { return stateFor(runtime).buffers.size; }
