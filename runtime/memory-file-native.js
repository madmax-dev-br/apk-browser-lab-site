// android.os.MemoryFile's two private natives (android-13.0.0_r1 android_os_MemoryFile.cpp). The ashmem region is the lab's SharedMemory byte array, so no page is ever purged: native_pin answers
// "not purged" (false); native_get_size needs the region's file descriptor, which the lab's SharedMemory never hands out, so it fails explicitly.
import { APKError } from './apk-error.js?v=d39d0632fd73';

const MEMORY_FILE = 'Landroid/os/MemoryFile;';

export function createMemoryFileNativeBindings() {
  const bindings = new Map(), add = (signature, fn) => bindings.set(`${MEMORY_FILE}->${signature}`, fn);
  add('native_pin(Ljava/io/FileDescriptor;Z)Z', () => 0);
  add('native_get_size(Ljava/io/FileDescriptor;)I', () => { throw new APKError('MemoryFile.getSize(FileDescriptor): the virtual device has no ashmem file descriptors', { kind: 'unsupported-ashmem-fd' }); });
  return bindings;
}
