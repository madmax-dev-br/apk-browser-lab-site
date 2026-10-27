import { createFileMappings, MappingError, MAP } from './file-mapping.js?v=d50f2f368405';

// mmap, munmap, msync, mprotect and ftruncate for lab-built native libraries (androidx datastore's SharedCounter, ...): the file-backed part goes to src/file-mapping.js over the
// VM's virtual file system, everything anonymous stays with the base module's own libc. The NativeLinker consults `override` before it binds a library's import to the base
// module's export (src/native-linker.js), so only libraries calling these functions are affected; the base module's internals keep their own.
//
// Descriptors are the VM's: the fd a library gets from Java (FileDescriptor.getInt$) is a key of `runtime.libcoreIo.table`. Failures return -1 with errno set in the base module's
// errno slot, exactly as libc does; MappingError.errno names the error (ENOTSUP, EINVAL, EACCES, ...).
const ERRNO = { EPERM: 1, ENOENT: 2, EBADF: 9, ENOMEM: 12, EACCES: 13, EINVAL: 22, ENODEV: 19, ENOTSUP: 95 };
const O_ACCMODE = 3, O_RDONLY = 0, O_WRONLY = 1;
const FAILED = -1;   // MAP_FAILED as an i32

/** The functions this module replaces, with the wasm signatures musl's wasm32 ABI gives them (off_t / size_t: i64 for off_t, i32 for size_t and pointers). */
export const SYSCALLS = Object.freeze({
  mmap: { params: ['i32', 'i32', 'i32', 'i32', 'i32', 'i64'], result: 'i32' },
  munmap: { params: ['i32', 'i32'], result: 'i32' },
  msync: { params: ['i32', 'i32', 'i32'], result: 'i32' },
  mprotect: { params: ['i32', 'i32', 'i32'], result: 'i32' },
  ftruncate: { params: ['i32', 'i64'], result: 'i32' },
});

/**
 * createFileSyscalls({ runtime, memory, base }) -> { implementations, mappings, flushAll }
 *   memory  the shared WebAssembly.Memory;  base  { aligned_alloc, free, mmap, munmap, msync, mprotect, __errno_location } the base module's exports (functions or undefined)
 * `implementations[name]` are plain JS functions with the signature above (BigInt for i64); the caller wraps them as wasm functions of the importing library's own type.
 */
export function createFileSyscalls({ runtime, memory, base }) {
  const view = () => new Uint8Array(memory.buffer);
  const setErrno = code => { const slot = base.__errno_location?.(); if (slot) new DataView(memory.buffer).setInt32(slot, ERRNO[code] ?? ERRNO.EINVAL, true); return FAILED; };
  const region = {
    alloc(size) {
      const address = base.aligned_alloc?.(4096, size);
      if (!address) throw new MappingError('ENOMEM', 'no linear memory left for a file mapping');
      view().fill(0, address, address + size); return address;
    },
    free(address) { base.free?.(address); },
    view,
  };
  const mappings = runtime.fileMappings ??= createFileMappings(runtime.platform.javaIo.fs(), region);
  const mine = new Map();   // start -> { length, refs }: the regions this module mapped (aliases of one shared region count); everything else is the base libc's
  const owns = (address, length) => { for (const [start, info] of mine) if (address >= start && address + Math.max(1, length) <= start + info.length) return true; return false; };
  const entry = fd => runtime.libcoreIo?.table.get(fd) ?? null;
  const guarded = (fn) => (...args) => {
    try { return fn(...args); }
    catch (error) { if (error instanceof MappingError) return setErrno(error.errno); throw error; }
  };

  const implementations = {
    mmap: guarded((address, length, prot, flags, fd, offset) => {
      if ((flags & MAP.ANONYMOUS) || fd < 0) return base.mmap(address, length, prot, flags, fd, offset);   // not a file: musl's own (anonymous) mapping
      const found = entry(fd); if (!found) return setErrno('EBADF');
      const desc = found.desc, access = desc.acc & O_ACCMODE;
      if (desc.kind !== 'file') return setErrno('ENODEV');
      const start = mappings.map({ node: desc.node, offset: Number(offset), length: length >>> 0, prot, flags, readable: access !== O_WRONLY, writable: access !== O_RDONLY });
      const info = mine.get(start) ?? mine.set(start, { length: Math.ceil((length >>> 0) / 4096) * 4096, refs: 0 }).get(start); info.refs++;
      return start;
    }),
    munmap: guarded((address, length) => {
      if (!mine.has(address)) return base.munmap(address, length);   // a partial unmap of a mapping fails inside file-mapping.js (EINVAL), never reaches musl
      mappings.munmap(address, length >>> 0);
      const info = mine.get(address); if (info && --info.refs <= 0) mine.delete(address);
      return 0;
    }),
    msync: guarded((address, length, flags) => { if (!owns(address, length)) return base.msync(address, length, flags); mappings.msync(address, length >>> 0, flags); return 0; }),
    mprotect: guarded((address, length, prot) => { if (!owns(address, length)) return base.mprotect(address, length, prot); mappings.mprotect(address, length >>> 0, prot); return 0; }),
    ftruncate: guarded((fd, length) => {
      const found = entry(fd); if (!found) return setErrno('EBADF');
      const desc = found.desc, access = desc.acc & O_ACCMODE;
      if (desc.kind !== 'file' || access === O_RDONLY || length < 0n) return setErrno('EINVAL');
      const node = desc.node, target = Number(length), fs = runtime.platform.javaIo.fs();
      mappings.flushNode(node);   // shared mappings reach the file first, then the file changes, then the mappings show the new contents (as the libcore ftruncate does)
      if (target < node.size) { node.size = target; node.mtime = fs.now(); } else if (target > node.size) fs.writeAt(node, target, new Uint8Array(0), 0, 0);
      mappings.refreshNode(node);
      return 0;
    }),
  };
  return { implementations, mappings, flushAll: () => mappings.flushAll() };
}
