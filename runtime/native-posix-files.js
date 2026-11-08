import { OS_CONSTANTS as C } from './os-constants-data.js?v=63564e17bcf5';
import { state, lookup, allocateFd, release, inode } from './libcore-io-native.js?v=63564e17bcf5';

// The libc file functions a lab-built native library calls with plain paths and descriptors (react-native-mmkv's MMKV core: open, read, write, lseek, fstat, stat, access, mkdir, unlink,
// rename, flock, fcntl, mkstemp, sendfile, close), over the same kernel the Java side uses: the app's VirtualFileSystem and the process descriptor table of src/libcore-io-native.js.
// A descriptor the library opens is therefore an ordinary VM descriptor: mmap/ftruncate (src/native-file-syscalls.js) and Java code see the same file, and the file mappings are flushed
// before it is read and refreshed after it is written, as the libcore natives do.
// Numbers are the Emscripten libc ABI (musl on WebAssembly, WASI errno values): they differ from the Linux numbers the Java side uses, so errno and struct stat are encoded here.
// stdin/stdout/stderr (descriptors 0 to 2) stay with the base module's own libc.
export const WASI_ERRNO = Object.freeze({ EPERM: 63, ENOENT: 44, EBADF: 8, EACCES: 2, EEXIST: 20, ENOTDIR: 54, EISDIR: 31, EINVAL: 28, EMFILE: 33, ENOSYS: 52, ENOTEMPTY: 55, ENOMEM: 48, ENODEV: 43, ENOTSUP: 138, EAGAIN: 6, EXDEV: 75, EFBIG: 22, ENOSPC: 51, ESPIPE: 70, EROFS: 69 });

export const POSIX_SYSCALLS = Object.freeze({
  open: { params: ['i32', 'i32', 'i32'], result: 'i32' },       // open(path, flags, ...): the optional mode is read from the variadic argument block
  close: { params: ['i32'], result: 'i32' },
  read: { params: ['i32', 'i32', 'i32'], result: 'i32' },
  write: { params: ['i32', 'i32', 'i32'], result: 'i32' },
  lseek: { params: ['i32', 'i64', 'i32'], result: 'i64' },
  fstat: { params: ['i32', 'i32'], result: 'i32' },
  stat: { params: ['i32', 'i32'], result: 'i32' },
  access: { params: ['i32', 'i32'], result: 'i32' },
  mkdir: { params: ['i32', 'i32'], result: 'i32' },
  unlink: { params: ['i32'], result: 'i32' },
  rename: { params: ['i32', 'i32'], result: 'i32' },
  flock: { params: ['i32', 'i32'], result: 'i32' },
  fcntl: { params: ['i32', 'i32', 'i32'], result: 'i32' },     // fcntl(fd, cmd, ...): the optional argument comes through the variadic argument block
  mkstemp: { params: ['i32'], result: 'i32' },
  sendfile: { params: ['i32', 'i32', 'i32', 'i32'], result: 'i32' },
  fsync: { params: ['i32'], result: 'i32' },
  fdatasync: { params: ['i32'], result: 'i32' },
});

const STAT_SIZE = 96, FLOCK_TYPE = 0, F_UNLCK = 2;
const O_ACCMODE = 3, O_RDONLY = 0, O_WRONLY = 1;

/** createPosixFileSyscalls({ runtime, memory, base }) -> { implementations }: `base` gives the base module's exports for descriptors 0 to 2 and the errno slot. */
export function createPosixFileSyscalls({ runtime, memory, base }) {
  const fs = () => runtime.platform.javaIo.fs();
  const bytes = () => new Uint8Array(memory.buffer), view = () => new DataView(memory.buffer);
  const setErrno = name => { const slot = base.__errno_location?.(); if (slot) view().setInt32(slot, WASI_ERRNO[name] ?? WASI_ERRNO.EINVAL, true); return -1; };
  const cString = pointer => { const b = bytes(); let end = pointer; while (b[end]) end++; return new TextDecoder().decode(b.subarray(pointer, end)); };
  const entry = fd => state(runtime).table.get(fd);
  const std = fd => fd >= 0 && fd <= 2;
  const readable = desc => (desc.acc & O_ACCMODE) !== O_WRONLY, writable = desc => (desc.acc & O_ACCMODE) !== O_RDONLY;
  const found = path => lookup(fs(), cString(path));

  /** open(2) over the VFS; returns the descriptor or the errno name. */
  const openFile = (path, flags, mode) => {
    const files = fs(), at = lookup(files, cString(path)), acc = flags & O_ACCMODE;
    let node = at.node, created = false;
    if (!node) {
      if (!(flags & C.O_CREAT)) return { error: at.error };
      const code = files.createFile(at.path); if (code !== 'ok') return { error: code };
      created = true; node = files.nodes.get(at.path); node.mode = mode & ~state(runtime).umask & 0o7777;
    } else if ((flags & C.O_CREAT) && (flags & C.O_EXCL)) return { error: 'EEXIST' };
    if (node.type === 'dir') {
      if (acc !== O_RDONLY) return { error: 'EISDIR' };
      const number = allocateFd(runtime, { kind: 'dir', node, path: at.path, acc, offset: 0, append: false, ownerTag: 0n, refs: 0 }, 3, !!(flags & C.O_CLOEXEC));
      return number < 0 ? { error: 'EMFILE' } : { fd: number };
    }
    if ((acc !== O_RDONLY && (files.isReadOnly(at.path) || !(node.mode & 0o200))) || (acc !== O_WRONLY && !(node.mode & 0o400))) return { error: 'EACCES' };
    if ((flags & C.O_TRUNC) && acc !== O_RDONLY) { runtime.fileMappings?.flushNode(node); node.size = 0; node.mtime = files.now(); if (!created) files.notify(0x2, node); runtime.fileMappings?.refreshNode(node); }
    const number = allocateFd(runtime, { kind: 'file', node, path: at.path, acc, offset: 0, append: !!(flags & C.O_APPEND), ownerTag: 0n, refs: 0 }, 3, !!(flags & C.O_CLOEXEC));
    return number < 0 ? { error: 'EMFILE' } : { fd: number };
  };

  const writeStat = (pointer, node) => {
    const v = view(), size = node.type === 'file' ? node.size : 0, sec = Math.floor(node.mtime / 1000), nsec = (node.mtime % 1000) * 1_000_000;
    bytes().fill(0, pointer, pointer + STAT_SIZE);
    v.setUint32(pointer + 0, 0xfd00, true);                                                   // st_dev
    v.setUint32(pointer + 4, (node.type === 'dir' ? C.S_IFDIR : C.S_IFREG) | (node.mode & 0o7777), true);   // st_mode
    v.setUint32(pointer + 8, node.type === 'dir' ? 2 : 1, true);                              // st_nlink
    const uid = runtime.platform.virtualProcess.uid; v.setUint32(pointer + 12, uid, true); v.setUint32(pointer + 16, uid, true);
    v.setBigInt64(pointer + 24, BigInt(size), true);                                          // st_size
    v.setInt32(pointer + 32, 4096, true); v.setInt32(pointer + 36, Math.ceil(size / 512), true);   // st_blksize, st_blocks
    for (const at of [40, 56, 72]) { v.setBigInt64(pointer + at, BigInt(sec), true); v.setInt32(pointer + at + 8, nsec, true); }   // st_atim, st_mtim, st_ctim
    v.setBigInt64(pointer + 88, BigInt(inode(node)), true);                                   // st_ino
  };

  const readFrom = (desc, target, count) => {
    if (count === 0) return 0;
    const node = desc.node; runtime.fileMappings?.flushNode(node);
    if (desc.offset >= node.size) return 0;
    const length = Math.min(count, node.size - desc.offset), chunk = new Uint8Array(length); fs().readAt(node, desc.offset, chunk, 0, length);
    bytes().set(chunk, target); desc.offset += length; return length;
  };
  const writeTo = (desc, source, count) => {
    const node = desc.node, files = fs(), at = desc.append ? node.size : desc.offset;
    runtime.fileMappings?.flushNode(node);
    files.writeAt(node, at, bytes().slice(source, source + count), 0, count); desc.offset = at + count; runtime.fileMappings?.refreshNode(node); return count;
  };

  const implementations = {
    open: (path, flags, varargs) => {
      const mode = (flags & C.O_CREAT) ? view().getUint32(varargs, true) : 0, result = openFile(path, flags, mode);
      return result.error ? setErrno(result.error) : result.fd;
    },
    close: fd => {
      if (std(fd)) return base.close ? base.close(fd) : 0;
      if (!entry(fd)) return setErrno('EBADF');
      release(runtime, fd); return 0;
    },
    read: (fd, target, count) => {
      if (std(fd)) return base.read ? base.read(fd, target, count) : setErrno('EBADF');
      const e = entry(fd); if (!e) return setErrno('EBADF');
      if (e.desc.kind !== 'file' || !readable(e.desc)) return e.desc.kind === 'dir' ? setErrno('EISDIR') : setErrno('EBADF');
      return readFrom(e.desc, target, count >>> 0);
    },
    write: (fd, source, count) => {
      if (std(fd)) return base.write ? base.write(fd, source, count) : setErrno('EBADF');
      const e = entry(fd); if (!e) return setErrno('EBADF');
      if (e.desc.kind !== 'file' || !writable(e.desc)) return e.desc.kind === 'dir' ? setErrno('EISDIR') : setErrno('EBADF');
      try { return writeTo(e.desc, source, count >>> 0); } catch (error) { if (error instanceof RangeError) return setErrno('EFBIG'); throw error; }
    },
    lseek: (fd, offset, whence) => {
      if (std(fd)) return BigInt(setErrno('ESPIPE'));
      const e = entry(fd); if (!e) return BigInt(setErrno('EBADF'));
      if (e.desc.kind !== 'file') return BigInt(setErrno('ESPIPE'));
      const origin = whence === C.SEEK_SET ? 0 : whence === C.SEEK_CUR ? e.desc.offset : whence === C.SEEK_END ? e.desc.node.size : -1;
      if (origin < 0) return BigInt(setErrno('EINVAL'));
      const target = BigInt(origin) + offset; if (target < 0n) return BigInt(setErrno('EINVAL'));
      e.desc.offset = Number(target); return target;
    },
    fstat: (fd, pointer) => {
      const e = entry(fd); if (std(fd) || !e) return std(fd) && base.fstat ? base.fstat(fd, pointer) : setErrno('EBADF');
      if (!e.desc.node) return setErrno('EBADF');
      writeStat(pointer, e.desc.node); return 0;
    },
    stat: (path, pointer) => { const at = found(path); if (!at.node) return setErrno(at.error); writeStat(pointer, at.node); return 0; },
    access: (path, mode) => {
      const at = found(path); if (!at.node) return setErrno(at.error);
      // the caller owns every file of the app's world: the owner permission bits decide (as libcore's access)
      if (((mode & C.W_OK) && (fs().isReadOnly(at.path) || !(at.node.mode & 0o200))) || ((mode & C.R_OK) && !(at.node.mode & 0o400)) || ((mode & C.X_OK) && !(at.node.mode & 0o100))) return setErrno('EACCES');
      return 0;
    },
    mkdir: (path, mode) => {
      const files = fs(), at = found(path);
      if (at.node) return setErrno('EEXIST');
      if (at.error === 'ENOTDIR') return setErrno('ENOTDIR');
      const code = files.mkdir(at.path); if (code !== 'ok') return setErrno(code);
      files.nodes.get(at.path).mode = mode & ~state(runtime).umask & 0o7777; return 0;
    },
    unlink: path => {
      const files = fs(), at = found(path); if (!at.node) return setErrno(at.error);
      if (at.node.type === 'dir') return setErrno('EISDIR');
      const code = files.delete(at.path); return code === 'ok' ? 0 : setErrno(code);
    },
    rename: (from, to) => {
      const files = fs(), source = found(from); if (!source.node) return setErrno(source.error);
      const target = lookup(files, cString(to)); if (target.error === 'ENOTDIR') return setErrno('ENOTDIR');
      const code = files.rename(source.path, target.path); return code === 'ok' ? 0 : setErrno(code);
    },
    // one process, and the VM's threads are scheduled cooperatively: an advisory lock can always be taken, so only the descriptor is checked
    flock: fd => (std(fd) || entry(fd) ? 0 : setErrno('EBADF')),
    fcntl: (fd, command, varargs) => {
      const e = entry(fd); if (!e && !std(fd)) return setErrno('EBADF');
      const argument = () => view().getInt32(varargs, true);
      switch (command) {
        case C.F_GETFD: return e?.cloexec ? C.FD_CLOEXEC : 0;
        case C.F_SETFD: if (e) e.cloexec = !!(argument() & C.FD_CLOEXEC); return 0;
        case C.F_GETFL: return e ? e.desc.acc | (e.desc.append ? C.O_APPEND : 0) : 0;
        case C.F_SETFL: if (e) e.desc.append = !!(argument() & C.O_APPEND); return 0;
        case C.F_DUPFD: case C.F_DUPFD_CLOEXEC: { const number = allocateFd(runtime, e.desc, argument(), command === C.F_DUPFD_CLOEXEC); return number < 0 ? setErrno('EMFILE') : number; }
        case 12: view().setInt16(argument() + FLOCK_TYPE, F_UNLCK, true); return 0;   // F_GETLK: no other process holds a lock
        case 13: case 14: return 0;                                                    // F_SETLK / F_SETLKW: record locks are always granted (one process)
        default: return setErrno('EINVAL');
      }
    },
    mkstemp: template => {
      const text = cString(template); if (!text.endsWith('XXXXXX')) return setErrno('EINVAL');
      const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      for (let attempt = 0; attempt < 100; attempt++) {
        let suffix = ''; for (let i = 0; i < 6; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
        const name = text.slice(0, -6) + suffix, encoded = new TextEncoder().encode(name);
        const at = lookup(fs(), name); if (at.node) continue;
        bytes().set(encoded, template);
        const opened = openFile(template, C.O_RDWR | C.O_CREAT | C.O_EXCL, 0o600); return opened.error ? setErrno(opened.error) : opened.fd;
      }
      return setErrno('EEXIST');
    },
    sendfile: (outFd, inFd, offsetPointer, count) => {
      const input = entry(inFd), output = entry(outFd);
      if (!input || !output || input.desc.kind !== 'file' || output.desc.kind !== 'file' || !readable(input.desc) || !writable(output.desc)) return setErrno('EBADF');
      const files = fs(), node = input.desc.node, start = offsetPointer ? Number(view().getBigInt64(offsetPointer, true)) : input.desc.offset;
      runtime.fileMappings?.flushNode(node);
      const length = Math.max(0, Math.min(count >>> 0, node.size - start)), chunk = new Uint8Array(length); if (length) files.readAt(node, start, chunk, 0, length);
      const target = output.desc, at = target.append ? target.node.size : target.offset;
      runtime.fileMappings?.flushNode(target.node); files.writeAt(target.node, at, chunk, 0, length); target.offset = at + length; runtime.fileMappings?.refreshNode(target.node);
      if (offsetPointer) view().setBigInt64(offsetPointer, BigInt(start + length), true); else input.desc.offset = start + length;
      return length;
    },
    // the VFS is memory: there is nothing to flush, and shared mappings reach the file through msync
    fsync: fd => (entry(fd) || std(fd) ? 0 : setErrno('EBADF')),
    fdatasync: fd => (entry(fd) || std(fd) ? 0 : setErrno('EBADF')),
  };
  return { implementations };
}
