// ByteBuffer.allocateDirect in an app that has a native process (src/unsafe-native.js nativeHeap): the buffer's memory is the process's native memory, at one address that
// Java (Memory.peek/poke, Unsafe, the Buffer views) and native code (GetDirectBufferAddress, then plain loads and stores) both read and write, with no copy in either direction.
//
// On ART, DirectByteBuffer.MemoryRef(int) takes a non-movable byte[] (VMRuntime.newNonMovableArray) and its address (VMRuntime.addressOf): the Java heap is native memory there.
// The lab's Java arrays live in the VM's own heap, which native code cannot address, so in an app with a native process MemoryRef(int) takes its memory from that process's
// heap instead, as MemoryRef(long, Object) does for JNI NewDirectByteBuffer: `buffer` is null, `allocatedAddress` the block (zeroed, 8-byte aligned, so `offset` is 0).
// The visible difference from ART, recorded in the trace once: such a buffer has no backing array (hasArray() false, array() throws UnsupportedOperationException,
// compact() fails as it does on ART for a NewDirectByteBuffer buffer). The block lives as long as the process (the lab does not observe the MemoryRef's collection).
// Without a native process MemoryRef(int) runs its own body (a pinned array of the VM heap), as before.
import { RUN_BODY, setMethodInterceptor } from './method-overrides.js?v=e0932d3cf1f5';
import { allocateNativeBlock, nativeHeapKind, writeNativeBytes } from './unsafe-native.js?v=e0932d3cf1f5';

export const MEMORY_REF_INIT = 'Ljava/nio/DirectByteBuffer$MemoryRef;-><init>(I)V';
const REF = 'Ljava/nio/DirectByteBuffer$MemoryRef;';

export function installDirectBuffers(runtime) {
  if (runtime.directBuffersInstalled) return; runtime.directBuffersInstalled = true;
  setMethodInterceptor(runtime, MEMORY_REF_INIT, (rt, _definition, args) => {
    const kind = nativeHeapKind(rt); if (kind === 'arena') return RUN_BODY;
    const self = args[0], capacity = Number(args[1]);
    if (capacity < 0) return RUN_BODY;   // the body's own NegativeArraySizeException
    const address = allocateNativeBlock(rt, capacity + 7);
    if (capacity > 0) writeNativeBytes(rt, address, new Uint8Array(capacity + 7));   // Java's zeroed buffer (a reused heap block is not)
    const fields = rt.object(self).fields;
    rt.storeField(fields, `${REF}->buffer:[B`, null); rt.storeField(fields, `${REF}->allocatedAddress:J`, BigInt.asIntN(64, address));
    rt.storeField(fields, `${REF}->offset:I`, Number((((address + 7n) & ~7n) - address)));
    rt.storeField(fields, `${REF}->isAccessible:Z`, 1); rt.storeField(fields, `${REF}->isFreed:Z`, 0); rt.storeField(fields, `${REF}->originalBufferObject:Ljava/lang/Object;`, null);
    if (!rt.directBufferNoted) { rt.directBufferNoted = true; rt.record?.(`DIRECT BUFFER ByteBuffer.allocateDirect takes its memory from the ${kind} process's native heap (shared with native code at one address); such a buffer has no backing array (hasArray() false), unlike ART's non-movable byte[]`); }
    return undefined;
  });
}
