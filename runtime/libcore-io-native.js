import { APKError } from './apk-error.js?v=cfd2299f1410';
import { throwNew } from './java-throw.js?v=cfd2299f1410';
import { OS_CONSTANTS, STRERROR } from './os-constants-data.js?v=cfd2299f1410';
import { networkOf, isIpLiteral } from './network-native.js?v=cfd2299f1410';
import { allocateNativeBlock, freeNativeBlock, readNativeBytes, writeNativeBytes } from './unsafe-native.js?v=cfd2299f1410';

// Natives of libcore.io.Linux (the real syscall layer under android.system.Os / libcore.io.Libcore.os), android.system.OsConstants, java.io.UnixFileSystem,
// java.io.FileDescriptor and java.io.FileInputStream behind the original Android 13 libcore classes. libcore_io_Linux.cpp, OsConstants.cpp and the OpenJDK
// UnixFileSystem_md.c / FileInputStream.c wrappers are followed for argument handling and errno values; the "kernel" below is the app's VirtualFileSystem
// (src/virtual-fs.js) plus a per-process descriptor table. What the browser VM does not have fails with an explicit Java error: the Linux methods that are not
// bound here (sockets, signals, process control, xattrs, ...) have no native binding and raise the VM's "Unsupported native" failure when reached.
const FILE_DISPATCHER = 'Lsun/nio/ch/FileDispatcherImpl;', IOUTIL = 'Lsun/nio/ch/IOUtil;', NATIVE_THREAD = 'Lsun/nio/ch/NativeThread;', FILE_KEY = 'Lsun/nio/ch/FileKey;', FILE_CHANNEL = 'Lsun/nio/ch/FileChannelImpl;', MAPPED = 'Ljava/nio/MappedByteBuffer;';
const LINUX = 'Llibcore/io/Linux;', FD = 'Ljava/io/FileDescriptor;', FILE = 'Ljava/io/File;', UFS = 'Ljava/io/UnixFileSystem;', FIS = 'Ljava/io/FileInputStream;', OSCONST = 'Landroid/system/OsConstants;', CLOSE_MONITOR = 'Llibcore/io/AsynchronousCloseMonitor;';
const C = OS_CONSTANTS, STRING = 'Ljava/lang/String;';
const BOUNDARY = 'libcore-io-boundary';
const fail = (message) => { throw new APKError(message, { kind: BOUNDARY, backend: 'android13-libcore-io/VirtualFileSystem' }); };
const ERRNO_BY_NAME = name => { const value = C[name]; if (typeof value !== 'number') fail(`Unknown errno name ${name}`); return value; };
const FD_KEY = `${FD}->descriptor:I`;
const decoder = new TextDecoder('utf-8');
let inodeCounter = 0x4000;

/** Per-runtime process state: descriptor table, umask, stdio line buffers. Descriptors 0-2 exist as on every Android process. */
function state(runtime) {
  if (runtime.libcoreIo) return runtime.libcoreIo;
  const std = (name, acc) => ({ kind: 'std', name, acc, offset: 0, append: false, ownerTag: 0n, refs: 1 });
  return runtime.libcoreIo = { table: new Map([[0, { desc: std('stdin', C.O_RDONLY), cloexec: false }], [1, { desc: std('stdout', C.O_WRONLY), cloexec: false }], [2, { desc: std('stderr', C.O_WRONLY), cloexec: false }]]), umask: 0o077, lines: new Map() };
}
const files = runtime => runtime.platform.javaIo.fs();

/** Constructs an original framework object through one of its constructors (wide arguments are packed into register pairs the way bytecode passes them). */
function construct(runtime, owner, parameters, args) {
  const reference = runtime.allocate(owner);
  runtime.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, runtime.argumentWords(parameters, args, { receiver: reference }), 'direct');
  return reference;
}

// ---- error helpers ----------------------------------------------------------------------------------------------------------------------------
function throwErrno(runtime, functionName, errno) {
  const reference = construct(runtime, 'Landroid/system/ErrnoException;', [STRING, 'I'], [functionName, errno]);
  runtime.throwJavaReference(reference, `${functionName} failed: errno ${errno}`);
}
const err = (runtime, functionName, name) => throwErrno(runtime, functionName, ERRNO_BY_NAME(name));
const text = (runtime, value) => runtime.stringCharacters(value);
const requireString = (runtime, value) => { if (value === null) runtime.throwJava('Ljava/lang/NullPointerException;', null); return text(runtime, value); };

// ---- path / node helpers ----------------------------------------------------------------------------------------------------------------------
/** Resolves a path against the VFS: the node, or the errno name a lookup would fail with (ENOENT, or ENOTDIR when a parent component is a regular file). */
function lookup(fs, path) {
  const canonical = fs.canonical(path.startsWith('/') ? path : '/' + path), node = fs.nodes.get(canonical);
  if (node) return { node, path: canonical };
  for (let cursor = fs.parentOf(canonical); ; cursor = fs.parentOf(cursor)) {
    const ancestor = fs.nodes.get(cursor);
    if (ancestor) return { error: ancestor.type === 'dir' ? 'ENOENT' : 'ENOTDIR', path: canonical };
    if (cursor === '/') return { error: 'ENOENT', path: canonical };
  }
}
const modeOf = (runtime, node) => (node.type === 'dir' ? C.S_IFDIR : C.S_IFREG) | (node.mode & 0o7777);
const inode = node => node.ino ??= ++inodeCounter;
function makeStat(runtime, node, std = false) {
  const uid = runtime.platform.virtualProcess.uid, sec = Math.floor(node.mtime / 1000), ns = (node.mtime % 1000) * 1_000_000;
  const TS = 'Landroid/system/StructTimespec;', spec = () => construct(runtime, TS, ['J', 'J'], [BigInt(sec), BigInt(ns)]);
  const size = node.type === 'file' ? node.size : 0, mode = std ? C.S_IFCHR | 0o620 : modeOf(runtime, node);
  return construct(runtime, 'Landroid/system/StructStat;', ['J', 'J', 'I', 'J', 'I', 'I', 'J', 'J', TS, TS, TS, 'J', 'J'],
    [std ? 0xfn : 0xfd00n, std ? 3n : BigInt(inode(node)), mode, node.type === 'dir' ? 2n : 1n, uid, uid, std ? 0x103n : 0n, BigInt(size), spec(), spec(), spec(), 4096n, BigInt(Math.ceil(size / 512))]);
}

// ---- file descriptors -------------------------------------------------------------------------------------------------------------------------
function fdNumber(runtime, reference) {
  if (reference === null) runtime.throwJava('Ljava/lang/NullPointerException;', 'fd == null');
  return runtime.object(reference).fields.get(FD_KEY) | 0;
}
function setFdNumber(runtime, reference, value) { runtime.storeField(runtime.object(reference).fields, FD_KEY, value); }
function newFileDescriptor(runtime, number) {
  const reference = construct(runtime, FD, [], []);
  setFdNumber(runtime, reference, number); return reference;
}
function allocateFd(runtime, desc, minimum = 0, cloexec = false) {
  const table = state(runtime).table; let number = minimum;
  while (table.has(number)) number++;
  if (number >= 1024) return -1;
  table.set(number, { desc, cloexec }); desc.refs++; return number;
}
function entryOf(runtime, functionName, reference) {
  const number = fdNumber(runtime, reference), entry = state(runtime).table.get(number);
  if (!entry) err(runtime, functionName, 'EBADF');
  return { number, ...entry };
}
const readable = desc => (desc.acc & C.O_ACCMODE) !== C.O_WRONLY, writable = desc => (desc.acc & C.O_ACCMODE) !== C.O_RDONLY;

// ---- buffers (byte[] or direct ByteBuffer) ----------------------------------------------------------------------------------------------------
function bufferAccess(runtime, buffer, offset, count) {
  if (buffer === null) runtime.throwJava('Ljava/lang/NullPointerException;', null);
  const object = runtime.object(buffer);
  if (object.type === '[B') {
    if (offset < 0 || count < 0 || offset > object.elements.length - count) runtime.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `length=${object.elements.length}; regionStart=${offset}; regionLength=${count}`);
    return { get: () => Uint8Array.from(object.elements.slice(offset, offset + count), v => v & 255), put: bytes => { for (let i = 0; i < bytes.length; i++) object.elements[offset + i] = (bytes[i] << 24) >> 24; } };
  }
  const address = BigInt.asIntN(64, object.fields.get('Ljava/nio/Buffer;->address:J') ?? 0n) + BigInt(offset);   // direct ByteBuffer: libcore reads it through GetDirectBufferAddress
  return { get: () => readNativeBytes(runtime, address, count), put: bytes => writeNativeBytes(runtime, address, bytes) };
}
const stdLog = (runtime, desc, bytes) => {
  const st = state(runtime), previous = st.lines.get(desc.name) ?? '', combined = previous + decoder.decode(bytes, { stream: true }), parts = combined.split('\n');
  st.lines.set(desc.name, parts.pop());
  for (const line of parts) runtime.record(`LOG ${desc.name === 'stderr' ? 'W' : 'I'} System.${desc.name === 'stderr' ? 'err' : 'out'}: ${line}`);   // Android's AndroidPrintStream: one log line per newline
};

// ---- the syscalls -----------------------------------------------------------------------------------------------------------------------------
function open(runtime, path, flags, mode) {
  const fs = files(runtime), name = requireString(runtime, path), found = lookup(fs, name), acc = flags & C.O_ACCMODE;
  let node = found.node;
  if (!node) {
    if (!(flags & C.O_CREAT)) err(runtime, 'open', found.error);
    const code = fs.createFile(found.path); if (code !== 'ok') err(runtime, 'open', code);
    node = fs.nodes.get(found.path); node.mode = mode & ~state(runtime).umask & 0o7777;
  } else if ((flags & C.O_CREAT) && (flags & C.O_EXCL)) err(runtime, 'open', 'EEXIST');
  if (node.type === 'dir') {
    if (acc !== C.O_RDONLY) err(runtime, 'open', 'EISDIR');
    return allocateFd(runtime, { kind: 'dir', node, path: found.path, acc, offset: 0, append: false, ownerTag: 0n, refs: 0 }, 0, !!(flags & C.O_CLOEXEC));
  }
  if ((acc !== C.O_RDONLY && (fs.isReadOnly(found.path) || !(node.mode & 0o200))) || (acc !== C.O_WRONLY && !(node.mode & 0o400))) err(runtime, 'open', 'EACCES');
  if ((flags & C.O_TRUNC) && acc !== C.O_RDONLY) { node.size = 0; node.mtime = fs.now(); }
  const number = allocateFd(runtime, { kind: 'file', node, path: found.path, acc, offset: 0, append: !!(flags & C.O_APPEND), ownerTag: 0n, refs: 0 }, 0, !!(flags & C.O_CLOEXEC));
  if (number < 0) err(runtime, 'open', 'EMFILE');
  return number;
}
function release(runtime, number) {
  const table = state(runtime).table, entry = table.get(number);
  table.delete(number); entry.desc.refs--;
}
function readInto(runtime, fn, fdRef, buffer, offset, count, position) {
  const entry = entryOf(runtime, fn, fdRef), desc = entry.desc;
  if (desc.kind === 'dir') err(runtime, fn, 'EISDIR');
  if (!readable(desc) || (desc.kind === 'std' && desc.name !== 'stdin')) err(runtime, fn, 'EBADF');
  const target = bufferAccess(runtime, buffer, offset, count);
  if (count === 0 || desc.kind === 'std') return 0;                       // stdin is an empty stream: end of file
  const at = position ?? desc.offset, node = desc.node;
  if (at >= node.size) return 0;
  const length = Math.min(count, node.size - at), chunk = new Uint8Array(length); files(runtime).readAt(node, at, chunk, 0, length);
  target.put(chunk); if (position === null) desc.offset += length; return length;
}
function writeFrom(runtime, fn, fdRef, buffer, offset, count, position) {
  const entry = entryOf(runtime, fn, fdRef), desc = entry.desc;
  if (desc.kind === 'dir') err(runtime, fn, 'EBADF');
  if (!writable(desc)) err(runtime, fn, 'EBADF');
  const source = bufferAccess(runtime, buffer, offset, count), bytes = source.get();
  if (desc.kind === 'std') { stdLog(runtime, desc, bytes); return count; }
  const fs = files(runtime), node = desc.node, at = position ?? (desc.append ? node.size : desc.offset);
  try { fs.writeAt(node, at, bytes, 0, count); } catch (error) { if (error instanceof RangeError) err(runtime, fn, 'EFBIG'); throw error; }
  if (position === null) desc.offset = at + count; return count;
}
const sizeOf = desc => desc.kind === 'file' ? desc.node.size : 0;
function seek(runtime, fn, fdRef, offset, whence) {
  const desc = entryOf(runtime, fn, fdRef).desc;
  if (desc.kind === 'std') err(runtime, fn, 'ESPIPE');
  const base = whence === C.SEEK_SET ? 0 : whence === C.SEEK_CUR ? desc.offset : whence === C.SEEK_END ? sizeOf(desc) : -1;
  if (base < 0) err(runtime, fn, 'EINVAL');
  const target = BigInt(base) + offset; if (target < 0n) err(runtime, fn, 'EINVAL');
  desc.offset = Number(target); return target;
}
const mutate = (runtime, fn, path) => {
  const fs = files(runtime), name = requireString(runtime, path), found = lookup(fs, name);
  if (!found.node) err(runtime, fn, found.error);
  return { fs, ...found };
};

export function createLibcoreIoNativeBindings() {
  const bindings = new Map(), add = (owner, signature, callback) => bindings.set(`${owner}->${signature}`, callback);
  const L = (signature, callback) => add(LINUX, signature, callback);

  // ---- android.system.OsConstants
  add(OSCONST, 'initConstants()V', runtime => { for (const [name, value] of Object.entries(C)) runtime.staticFields.set(`${OSCONST}->${name}:I`, value | 0); });

  // ---- descriptors and I/O
  L('open(Ljava/lang/String;II)Ljava/io/FileDescriptor;', (runtime, [, path, flags, mode]) => newFileDescriptor(runtime, open(runtime, path, flags, mode)));
  // ---- sockets. The browser cannot open raw TCP: a socket descriptor exists (so java.net.Socket behaves up to connect()), connect() obeys the device network policy and
  // fails with the errno an Android device reports (ENETUNREACH offline or for a host the policy does not allow); a connect the policy would allow stops with an explicit
  // error because there is no TCP transport to carry it. HTTP(S) goes through dev.apkweb.net.NetBridge instead.
  const INET = 'Ljava/net/InetAddress;', SOCKADDR = 'Ljava/net/SocketAddress;';
  L('socket(III)Ljava/io/FileDescriptor;', (runtime, [, domain, type, protocol]) => {
    if (!runtime.platform.holdsPermission?.(runtime, 'android.permission.INTERNET')) err(runtime, 'socket', 'EACCES');
    if (domain !== C.AF_INET && domain !== C.AF_INET6) err(runtime, 'socket', 'EAFNOSUPPORT');
    const base = type & 0xff; if (base !== C.SOCK_STREAM && base !== C.SOCK_DGRAM) err(runtime, 'socket', 'EPROTONOSUPPORT');
    const number = allocateFd(runtime, { kind: 'socket', domain, type: base, acc: C.O_RDWR, offset: 0, append: false, ownerTag: 0n, refs: 0, connected: false }, 0, !!(type & C.SOCK_CLOEXEC));
    if (number < 0) err(runtime, 'socket', 'EMFILE');
    return newFileDescriptor(runtime, number);
  });
  L('socketpair(IIILjava/io/FileDescriptor;Ljava/io/FileDescriptor;)V', (runtime, [, domain, type, protocol, first, second]) => {   // PlainSocketImpl's "marker" descriptors (dup2'ed over a closing socket); both ends are inert
    for (const target of [first, second]) {
      const number = allocateFd(runtime, { kind: 'socket', domain, type: type & 0xff, acc: C.O_RDWR, offset: 0, append: false, ownerTag: 0n, refs: 0, connected: true, pair: true }, 0, false);
      if (number < 0) err(runtime, 'socketpair', 'EMFILE'); setFdNumber(runtime, target, number);
    }
  });
  L('shutdown(Ljava/io/FileDescriptor;I)V', (runtime, [, fdRef]) => { const entry = entryOf(runtime, 'shutdown', fdRef); if (entry.desc.kind !== 'socket') err(runtime, 'shutdown', 'ENOTSOCK'); if (!entry.desc.connected) err(runtime, 'shutdown', 'ENOTCONN'); });
  L('getsockoptInt(Ljava/io/FileDescriptor;II)I', (runtime, [, fdRef, level, option]) => {
    const desc = entryOf(runtime, 'getsockopt', fdRef).desc; if (desc.kind !== 'socket') err(runtime, 'getsockopt', 'ENOTSOCK');
    if (level === C.SOL_SOCKET) { if (option === C.SO_TYPE) return desc.type; if (option === C.SO_RCVBUF || option === C.SO_SNDBUF) return 212992; }
    return 0;                                                   // SO_ERROR and the boolean options: no pending error, nothing enabled
  });
  L(`getsockname(Ljava/io/FileDescriptor;)${SOCKADDR}`, (runtime, [, fdRef]) => {   // a socket that never bound or connected is on the wildcard address, port 0
    const desc = entryOf(runtime, 'getsockname', fdRef).desc; if (desc.kind !== 'socket') err(runtime, 'getsockname', 'ENOTSOCK');
    const bytes = runtime.newArray('[B', desc.domain === C.AF_INET6 ? 16 : 4); runtime.object(bytes).elements.fill(0);
    const address = runtime.dispatch({ owner: INET, name: 'getByAddress', parameters: ['[B'], result: INET, signature: `([B)${INET}` }, [bytes], 'static');
    return construct(runtime, 'Ljava/net/InetSocketAddress;', [INET, 'I'], [address, 0]);
  });
  L(`getnameinfo(${INET}I)Ljava/lang/String;`, (runtime, [, address, flags]) => {   // numeric form only: the VM has no reverse DNS (NI_NUMERICHOST is what libcore asks for)
    const raw = runtime.object(runtime.dispatch({ owner: INET, name: 'getAddress', parameters: [], result: '[B', signature: '()[B' }, [address], 'virtual')).elements.map(v => v & 255);
    if (raw.length === 4) return raw.join('.');
    const groups = []; for (let i = 0; i < 16; i += 2) groups.push((raw[i] << 8) | raw[i + 1]);
    if (groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff) return `::ffff:${raw.slice(12).join('.')}`;
    let bestStart = -1, bestLength = 0;
    for (let i = 0; i < 8;) { if (groups[i] !== 0) { i++; continue; } let j = i; while (j < 8 && groups[j] === 0) j++; if (j - i > bestLength) { bestStart = i; bestLength = j - i; } i = j; }
    if (bestLength < 2) return groups.map(g => g.toString(16)).join(':');
    const left = groups.slice(0, bestStart).map(g => g.toString(16)).join(':'), right = groups.slice(bestStart + bestLength).map(g => g.toString(16)).join(':');
    return `${left}::${right}`;
  });
  const connectSocket = (runtime, fdRef, host, port) => {
    const entry = entryOf(runtime, 'connect', fdRef); if (entry.desc.kind !== 'socket') err(runtime, 'connect', 'ENOTSOCK');
    const net = networkOf(runtime); net.noteHost(host);
    if (!net.online || !net.allowed(host, port)) { net.stats.denied++; if (!net.online) net.stats.offlineRejections++; err(runtime, 'connect', 'ENETUNREACH'); }
    throw new APKError(`Raw TCP connect to ${host}:${port} is not available in the browser; only HTTP(S) through java.net.HttpURLConnection reaches the network (src/network-native.js)`, { kind: 'raw-socket-unsupported' });
  };
  const hostOf = (runtime, address) => runtime.stringCharacters(runtime.dispatch({ owner: INET, name: 'getHostAddress', parameters: [], result: 'Ljava/lang/String;', signature: '()Ljava/lang/String;' }, [address], 'virtual'));
  L(`connect(Ljava/io/FileDescriptor;${INET}I)V`, (runtime, [, fdRef, address, port]) => connectSocket(runtime, fdRef, hostOf(runtime, address), port));
  L(`connect(Ljava/io/FileDescriptor;${SOCKADDR})V`, (runtime, [, fdRef, socketAddress]) => {
    const address = runtime.dispatch({ owner: 'Ljava/net/InetSocketAddress;', name: 'getAddress', parameters: [], result: INET, signature: `()${INET}` }, [socketAddress], 'virtual');
    const port = runtime.dispatch({ owner: 'Ljava/net/InetSocketAddress;', name: 'getPort', parameters: [], result: 'I', signature: '()I' }, [socketAddress], 'virtual');
    connectSocket(runtime, fdRef, hostOf(runtime, address), port);
  });
  for (const name of ['setsockoptInt', 'setsockoptByte']) L(`${name}(Ljava/io/FileDescriptor;III)V`, (runtime, [, fdRef]) => { entryOf(runtime, 'setsockopt', fdRef); });   // options of a socket that never connects have no effect to model
  L('close(Ljava/io/FileDescriptor;)V', (runtime, [, fdRef]) => {
    const number = fdNumber(runtime, fdRef); if (!state(runtime).table.has(number)) err(runtime, 'close', 'EBADF');
    release(runtime, number); setFdNumber(runtime, fdRef, -1);                    // libcore_io_Linux.cpp marks the Java descriptor invalid after closing it
  });
  L('dup(Ljava/io/FileDescriptor;)Ljava/io/FileDescriptor;', (runtime, [, fdRef]) => newFileDescriptor(runtime, allocateFd(runtime, entryOf(runtime, 'dup', fdRef).desc)));
  L('dup2(Ljava/io/FileDescriptor;I)Ljava/io/FileDescriptor;', (runtime, [, fdRef, target]) => {
    const entry = entryOf(runtime, 'dup2', fdRef), table = state(runtime).table;
    if (target < 0 || target >= 1024) err(runtime, 'dup2', 'EBADF');
    if (target !== entry.number) { if (table.has(target)) release(runtime, target); table.set(target, { desc: entry.desc, cloexec: false }); entry.desc.refs++; }
    return newFileDescriptor(runtime, target);
  });
  L('fcntlInt(Ljava/io/FileDescriptor;II)I', (runtime, [, fdRef, command, argument]) => {
    const entry = entryOf(runtime, 'fcntl', fdRef);
    if (command === C.F_DUPFD || command === C.F_DUPFD_CLOEXEC) { const number = allocateFd(runtime, entry.desc, argument, command === C.F_DUPFD_CLOEXEC); if (number < 0) err(runtime, 'fcntl', 'EMFILE'); return number; }
    if (command === C.F_SETFD) { entry.cloexec = !!(argument & C.FD_CLOEXEC); state(runtime).table.get(entry.number).cloexec = entry.cloexec; return 0; }
    if (command === C.F_SETFL) { entry.desc.append = !!(argument & C.O_APPEND); return 0; }
    err(runtime, 'fcntl', 'EINVAL');
  });
  L('fcntlVoid(Ljava/io/FileDescriptor;I)I', (runtime, [, fdRef, command]) => {
    const entry = entryOf(runtime, 'fcntl', fdRef);
    if (command === C.F_GETFD) return entry.cloexec ? C.FD_CLOEXEC : 0;
    if (command === C.F_GETFL) return entry.desc.acc | (entry.desc.append ? C.O_APPEND : 0);
    err(runtime, 'fcntl', 'EINVAL');
  });
  L('readBytes(Ljava/io/FileDescriptor;Ljava/lang/Object;II)I', (runtime, [, fdRef, buffer, offset, count]) => readInto(runtime, 'read', fdRef, buffer, offset, count, null));
  L('preadBytes(Ljava/io/FileDescriptor;Ljava/lang/Object;IIJ)I', (runtime, [, fdRef, buffer, offset, count, position]) => {
    if (entryOf(runtime, 'pread', fdRef).desc.kind === 'std') err(runtime, 'pread', 'ESPIPE');
    return readInto(runtime, 'pread', fdRef, buffer, offset, count, Number(position));
  });
  L('writeBytes(Ljava/io/FileDescriptor;Ljava/lang/Object;II)I', (runtime, [, fdRef, buffer, offset, count]) => writeFrom(runtime, 'write', fdRef, buffer, offset, count, null));
  L('pwriteBytes(Ljava/io/FileDescriptor;Ljava/lang/Object;IIJ)I', (runtime, [, fdRef, buffer, offset, count, position]) => {
    if (entryOf(runtime, 'pwrite', fdRef).desc.kind === 'std') err(runtime, 'pwrite', 'ESPIPE');
    return writeFrom(runtime, 'pwrite', fdRef, buffer, offset, count, Number(position));
  });
  L('lseek(Ljava/io/FileDescriptor;JI)J', (runtime, [, fdRef, offset, whence]) => seek(runtime, 'lseek', fdRef, offset, whence));
  L('fstat(Ljava/io/FileDescriptor;)Landroid/system/StructStat;', (runtime, [, fdRef]) => {
    const desc = entryOf(runtime, 'fstat', fdRef).desc;
    return makeStat(runtime, desc.kind === 'std' ? { type: 'file', size: 0, mtime: 0, mode: 0 } : desc.node, desc.kind === 'std');
  });
  L('ftruncate(Ljava/io/FileDescriptor;J)V', (runtime, [, fdRef, length]) => {
    const desc = entryOf(runtime, 'ftruncate', fdRef).desc;
    if (desc.kind !== 'file' || !writable(desc) || length < 0n) err(runtime, 'ftruncate', 'EINVAL');
    const node = desc.node, target = Number(length);
    if (target < node.size) { node.size = target; node.mtime = files(runtime).now(); } else if (target > node.size) files(runtime).writeAt(node, target, new Uint8Array(0), 0, 0);
  });
  for (const name of ['fsync', 'fdatasync']) L(`${name}(Ljava/io/FileDescriptor;)V`, (runtime, [, fdRef]) => { const desc = entryOf(runtime, name, fdRef).desc; if (desc.kind !== 'file' && desc.kind !== 'dir') err(runtime, name, 'EINVAL'); });   // the filesystem is memory: every write is already stable
  L('isatty(Ljava/io/FileDescriptor;)Z', (runtime, [, fdRef]) => { entryOf(runtime, 'isatty', fdRef); return 0; });
  L('posix_fallocate(Ljava/io/FileDescriptor;JJ)V', (runtime, [, fdRef, offset, length]) => {
    const desc = entryOf(runtime, 'posix_fallocate', fdRef).desc; if (desc.kind !== 'file' || !writable(desc)) err(runtime, 'posix_fallocate', 'EBADF');
    const end = Number(offset + length); if (end > desc.node.size) files(runtime).writeAt(desc.node, end, new Uint8Array(0), 0, 0);
  });
  L('android_fdsan_exchange_owner_tag(Ljava/io/FileDescriptor;JJ)V', (runtime, [, fdRef, previous, next]) => {
    const desc = entryOf(runtime, 'android_fdsan_exchange_owner_tag', fdRef).desc;
    if (desc.ownerTag !== previous) runtime.record(`LOG E libc: fdsan: failed to exchange ownership of file descriptor: fd ${fdNumber(runtime, fdRef)} is owned by 0x${desc.ownerTag.toString(16)}, was expected to be 0x${previous.toString(16)}`);
    desc.ownerTag = next;
  });
  L('android_fdsan_get_owner_tag(Ljava/io/FileDescriptor;)J', (runtime, [, fdRef]) => entryOf(runtime, 'android_fdsan_get_owner_tag', fdRef).desc.ownerTag);

  // ---- paths
  L('access(Ljava/lang/String;I)Z', (runtime, [, path, mode]) => {
    const { fs, node, path: resolved } = mutate(runtime, 'access', path);
    // the caller is the file's owner (every file in the app's world belongs to the app uid), so the owner permission bits decide
    if (((mode & C.W_OK) && (fs.isReadOnly(resolved) || !(node.mode & 0o200))) || ((mode & C.R_OK) && !(node.mode & 0o400)) || ((mode & C.X_OK) && !(node.mode & 0o100))) err(runtime, 'access', 'EACCES');
    return 1;
  });
  const statPath = name => (runtime, [, path]) => makeStat(runtime, mutate(runtime, name, path).node);
  L('stat(Ljava/lang/String;)Landroid/system/StructStat;', statPath('stat')); L('lstat(Ljava/lang/String;)Landroid/system/StructStat;', statPath('lstat'));   // the virtual filesystem has no symbolic links
  L('mkdir(Ljava/lang/String;I)V', (runtime, [, path, mode]) => {
    const fs = files(runtime), name = requireString(runtime, path), found = lookup(fs, name);
    if (found.node) err(runtime, 'mkdir', 'EEXIST');
    if (found.error === 'ENOTDIR') err(runtime, 'mkdir', 'ENOTDIR');
    const code = fs.mkdir(found.path); if (code !== 'ok') err(runtime, 'mkdir', code);
    fs.nodes.get(found.path).mode = mode & ~state(runtime).umask & 0o7777;
  });
  L('remove(Ljava/lang/String;)V', (runtime, [, path]) => { const { fs, path: resolved } = mutate(runtime, 'remove', path), code = fs.delete(resolved); if (code !== 'ok') err(runtime, 'remove', code); });
  L('unlink(Ljava/lang/String;)V', (runtime, [, path]) => {
    const { fs, node, path: resolved } = mutate(runtime, 'unlink', path);
    if (node.type === 'dir') err(runtime, 'unlink', 'EISDIR');
    const code = fs.delete(resolved); if (code !== 'ok') err(runtime, 'unlink', code);
  });
  L('rename(Ljava/lang/String;Ljava/lang/String;)V', (runtime, [, from, to]) => {
    const { fs, path: source } = mutate(runtime, 'rename', from), target = lookup(fs, requireString(runtime, to));
    if (target.error === 'ENOTDIR') err(runtime, 'rename', 'ENOTDIR');
    const code = fs.rename(source, target.path); if (code !== 'ok') err(runtime, 'rename', code);
  });
  L('chmod(Ljava/lang/String;I)V', (runtime, [, path, mode]) => { const { fs, node, path: resolved } = mutate(runtime, 'chmod', path); if (fs.isReadOnly(resolved)) err(runtime, 'chmod', 'EPERM'); node.mode = mode & 0o7777; });
  L('fchmod(Ljava/io/FileDescriptor;I)V', (runtime, [, fdRef, mode]) => { const desc = entryOf(runtime, 'fchmod', fdRef).desc; if (desc.kind === 'std') err(runtime, 'fchmod', 'EINVAL'); desc.node.mode = mode & 0o7777; });
  L('realpath(Ljava/lang/String;)Ljava/lang/String;', (runtime, [, path]) => mutate(runtime, 'realpath', path).path);
  L('readlink(Ljava/lang/String;)Ljava/lang/String;', (runtime, [, path]) => { mutate(runtime, 'readlink', path); err(runtime, 'readlink', 'EINVAL'); });   // exists, but no path is a symbolic link here
  L('umaskImpl(I)I', (runtime, [, mask]) => { const st = state(runtime), old = st.umask; st.umask = mask & 0o777; return old; });
  L('strerror(I)Ljava/lang/String;', (runtime, [, errno]) => STRERROR[errno] ?? `Unknown error ${errno}`);

  // ---- process identity and environment: the single virtual process of the platform
  const ids = name => L(`${name}()I`, runtime => runtime.platform.virtualProcess.uid);
  ['getuid', 'geteuid', 'getgid', 'getegid'].forEach(ids);
  for (const name of ['getpid', 'gettid']) L(`${name}()I`, runtime => runtime.platform.virtualProcess.pid);
  L('getppid()I', () => 1);                                                   // zygote's pid on a booted device
  L('getenv(Ljava/lang/String;)Ljava/lang/String;', (runtime, [, name]) => runtime.platform.environment[requireString(runtime, name)] ?? null);
  L('environ()[Ljava/lang/String;', runtime => { const entries = Object.entries(runtime.platform.environment).map(([k, v]) => `${k}=${v}`), array = runtime.newArray('[Ljava/lang/String;', entries.length); runtime.array(array).elements = entries; return array; });
  L('sysconf(I)J', (runtime, [, name]) => {
    const table = { [C._SC_PAGESIZE]: 4096n, [C._SC_PAGE_SIZE]: 4096n, [C._SC_NPROCESSORS_CONF]: 8n, [C._SC_NPROCESSORS_ONLN]: 8n, [C._SC_CLK_TCK]: 100n, [C._SC_OPEN_MAX]: 1024n, [C._SC_ARG_MAX]: 131072n, [C._SC_IOV_MAX]: 1024n, [C._SC_NGROUPS_MAX]: 65536n };
    return table[name] ?? -1n;                                                // sysconf returns -1 for a name the kernel does not report
  });
  L('uname()Landroid/system/StructUtsname;', runtime => {
    return construct(runtime, 'Landroid/system/StructUtsname;', Array(5).fill(STRING), ['Linux', 'localhost', '5.10.43-android12-9', '#1 SMP PREEMPT', 'aarch64']);
  });

  // ---- java.io.FileDescriptor / AsynchronousCloseMonitor
  add(FD, 'sync()V', (runtime, [self]) => {
    const entry = state(runtime).table.get(runtime.object(self).fields.get(FD_KEY) | 0);
    if (!entry || (entry.desc.kind !== 'file' && entry.desc.kind !== 'dir')) throwNew(runtime, 'Ljava/io/SyncFailedException;', 'sync failed');
  });
  add(FD, 'isSocket(I)Z', () => 0);                                                              // no socket descriptor can exist: the VM has no network stack
  add(CLOSE_MONITOR, 'signalBlockedThreads(Ljava/io/FileDescriptor;)V', () => undefined);       // file reads and writes complete synchronously, so no thread is ever blocked in a descriptor operation

  // ---- java.io.FileInputStream (the descriptor-based natives Android keeps)
  add(FIS, 'initIDs()V', () => undefined);                                                       // caches JNI field ids in OpenJDK; the VM resolves fields by name
  add(FIS, 'available0()I', (runtime, [self]) => {
    const fdRef = runtime.object(self).fields.get(`${FIS}->fd:${FD}`), number = fdNumber(runtime, fdRef), entry = state(runtime).table.get(number);
    if (!entry) throwNew(runtime, 'Ljava/io/IOException;', 'Stream Closed');
    const desc = entry.desc; if (desc.kind !== 'file') return 0;
    return Math.max(0, Math.min(0x7fffffff, desc.node.size - desc.offset));
  });
  add(FIS, 'skip0(J)J', (runtime, [self, n]) => {
    const fdRef = runtime.object(self).fields.get(`${FIS}->fd:${FD}`), number = fdNumber(runtime, fdRef), entry = state(runtime).table.get(number);
    if (!entry) throwNew(runtime, 'Ljava/io/IOException;', 'Stream Closed');
    const desc = entry.desc; if (desc.kind !== 'file') throwNew(runtime, 'Ljava/io/FileInputStream$UseManualSkipException;');   // lseek fails with ESPIPE
    const start = desc.offset, end = start + Number(n); if (end < 0) throwNew(runtime, 'Ljava/io/IOException;', 'Seek error');
    desc.offset = end; return BigInt(end - start);
  });

  // ---- java.io.UnixFileSystem (UnixFileSystem_md.c)
  const BA_EXISTS = 1, BA_REGULAR = 2, BA_DIRECTORY = 4;
  const fileOf = (runtime, file) => runtime.stringCharacters(runtime.object(file).fields.get(`${FILE}->path:${STRING}`));
  const find = (runtime, path) => lookup(files(runtime), path);
  add(UFS, 'initIDs()V', () => undefined);
  add(UFS, 'canonicalize0(Ljava/lang/String;)Ljava/lang/String;', (runtime, [, path]) => files(runtime).canonical(requireString(runtime, path)));
  add(UFS, 'getBooleanAttributes0(Ljava/lang/String;)I', (runtime, [, path]) => { const { node } = find(runtime, requireString(runtime, path)); return node ? BA_EXISTS | (node.type === 'dir' ? BA_DIRECTORY : BA_REGULAR) : 0; });
  add(UFS, 'getLastModifiedTime0(Ljava/io/File;)J', (runtime, [, file]) => { const { node } = find(runtime, fileOf(runtime, file)); return node ? BigInt(Math.trunc(node.mtime)) : 0n; });
  add(UFS, 'setLastModifiedTime0(Ljava/io/File;J)Z', (runtime, [, file, time]) => { const { node, path } = find(runtime, fileOf(runtime, file)); if (!node || files(runtime).isReadOnly(path)) return 0; node.mtime = Number(time); return 1; });
  add(UFS, 'setPermission0(Ljava/io/File;IZZ)Z', (runtime, [, file, access, enable, ownerOnly]) => {
    const { node, path } = find(runtime, fileOf(runtime, file)); if (!node || files(runtime).isReadOnly(path)) return 0;
    let bits = 0; if (access & 4) bits |= ownerOnly ? 0o400 : 0o444; if (access & 2) bits |= ownerOnly ? 0o200 : 0o222; if (access & 1) bits |= ownerOnly ? 0o100 : 0o111;
    node.mode = enable ? node.mode | bits : node.mode & ~bits; return 1;
  });
  add(UFS, 'setReadOnly0(Ljava/io/File;)Z', (runtime, [, file]) => { const { node, path } = find(runtime, fileOf(runtime, file)); if (!node || files(runtime).isReadOnly(path)) return 0; node.mode &= ~0o222; return 1; });
  add(UFS, 'createFileExclusively0(Ljava/lang/String;)Z', (runtime, [, path]) => {
    const fs = files(runtime), found = find(runtime, requireString(runtime, path));
    if (found.node) return 0;                                                  // EEXIST
    const code = found.error === 'ENOTDIR' ? 'ENOTDIR' : fs.createFile(found.path);
    if (code === 'ok') { fs.nodes.get(found.path).mode = 0o666 & ~state(runtime).umask; return 1; }
    throwNew(runtime, 'Ljava/io/IOException;', STRERROR[ERRNO_BY_NAME(code)]);   // JNU_ThrowIOExceptionWithLastError: just the strerror text
  });
  add(UFS, 'list0(Ljava/io/File;)[Ljava/lang/String;', (runtime, [, file]) => {
    const { node, path } = find(runtime, fileOf(runtime, file)); if (!node || node.type !== 'dir') return null;
    const names = files(runtime).list(path), array = runtime.newArray('[Ljava/lang/String;', names.length); runtime.array(array).elements = names; return array;
  });
  add(UFS, 'createDirectory0(Ljava/io/File;)Z', (runtime, [, file]) => {
    const fs = files(runtime), found = find(runtime, fileOf(runtime, file)); if (found.node || found.error === 'ENOTDIR') return 0;
    if (fs.mkdir(found.path) !== 'ok') return 0; fs.nodes.get(found.path).mode = 0o777 & ~state(runtime).umask; return 1;
  });

  // ---- sun.nio.ch (FileChannelImpl and its dispatcher): FileDispatcherImpl.c, IOUtil.c, FileKey.c, FileChannelImpl.c over the same descriptor table
  const IOS_EOF = -1, IOS_UNSUPPORTED_CASE = -6;
  const ioError = (runtime, name) => throwNew(runtime, 'Ljava/io/IOException;', STRERROR[ERRNO_BY_NAME(name)]);   // JNU_ThrowIOExceptionWithLastError
  const descOf = (runtime, fdRef, forWrite) => {
    const entry = state(runtime).table.get(fdNumber(runtime, fdRef)); if (!entry) ioError(runtime, 'EBADF');
    const desc = entry.desc;
    if (desc.kind === 'dir') ioError(runtime, 'EISDIR');
    if (desc.kind === 'closed' || (forWrite ? !writable(desc) : !readable(desc))) ioError(runtime, 'EBADF');
    return desc;
  };
  const pull = (runtime, desc, at, address, length) => {      // file bytes -> native memory
    if (desc.kind === 'std' || at >= desc.node.size || length === 0) return 0;
    const count = Math.min(length, desc.node.size - at), chunk = new Uint8Array(count); files(runtime).readAt(desc.node, at, chunk, 0, count);
    writeNativeBytes(runtime, address, chunk); return count;
  };
  const push = (runtime, desc, at, address, length) => {      // native memory -> file bytes
    const bytes = readNativeBytes(runtime, address, length);
    if (desc.kind === 'std') { stdLog(runtime, desc, bytes); return length; }
    try { files(runtime).writeAt(desc.node, at, bytes, 0, length); } catch (error) { if (error instanceof RangeError) ioError(runtime, 'EFBIG'); throw error; }
    return length;
  };
  const readOp = (runtime, fdRef, address, length, position) => {
    const desc = descOf(runtime, fdRef, false), at = position ?? desc.offset, count = pull(runtime, desc, at, BigInt(address), length);
    if (position === null) desc.offset += count; return count === 0 && length > 0 ? IOS_EOF : count;
  };
  const writeOp = (runtime, fdRef, address, length, position) => {
    const desc = descOf(runtime, fdRef, true), at = position ?? (desc.append && desc.kind === 'file' ? desc.node.size : desc.offset);
    const count = push(runtime, desc, at, BigInt(address), length); if (position === null) desc.offset = at + count; return count;
  };
  const vector = (runtime, address, count) => { const raw = readNativeBytes(runtime, address, count * 16), view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength); return Array.from({ length: count }, (_, i) => ({ base: view.getBigInt64(i * 16, true), length: Number(view.getBigInt64(i * 16 + 8, true)) })); };
  add(FILE_DISPATCHER, 'read0(Ljava/io/FileDescriptor;JI)I', (runtime, [fdRef, address, length]) => readOp(runtime, fdRef, address, length, null));
  add(FILE_DISPATCHER, 'pread0(Ljava/io/FileDescriptor;JIJ)I', (runtime, [fdRef, address, length, position]) => readOp(runtime, fdRef, address, length, Number(position)));
  add(FILE_DISPATCHER, 'write0(Ljava/io/FileDescriptor;JI)I', (runtime, [fdRef, address, length]) => writeOp(runtime, fdRef, address, length, null));
  add(FILE_DISPATCHER, 'pwrite0(Ljava/io/FileDescriptor;JIJ)I', (runtime, [fdRef, address, length, position]) => writeOp(runtime, fdRef, address, length, Number(position)));
  add(FILE_DISPATCHER, 'readv0(Ljava/io/FileDescriptor;JI)J', (runtime, [fdRef, address, count]) => {
    let total = 0;
    for (const { base, length } of vector(runtime, address, count)) { const n = readOp(runtime, fdRef, base, length, null); if (n === IOS_EOF) return total === 0 ? BigInt(IOS_EOF) : BigInt(total); total += n; if (n < length) break; }
    return BigInt(total);
  });
  add(FILE_DISPATCHER, 'writev0(Ljava/io/FileDescriptor;JI)J', (runtime, [fdRef, address, count]) => { let total = 0; for (const { base, length } of vector(runtime, address, count)) total += writeOp(runtime, fdRef, base, length, null); return BigInt(total); });
  add(FILE_DISPATCHER, 'force0(Ljava/io/FileDescriptor;Z)I', (runtime, [fdRef]) => { descOf(runtime, fdRef, false); return 0; });
  add(FILE_DISPATCHER, 'truncate0(Ljava/io/FileDescriptor;J)I', (runtime, [fdRef, size]) => {
    const desc = descOf(runtime, fdRef, true); if (desc.kind !== 'file') ioError(runtime, 'EINVAL');
    const target = Number(size), node = desc.node; if (target < node.size) { node.size = target; node.mtime = files(runtime).now(); } else if (target > node.size) files(runtime).writeAt(node, target, new Uint8Array(0), 0, 0);
    return 0;
  });
  add(FILE_DISPATCHER, 'size0(Ljava/io/FileDescriptor;)J', (runtime, [fdRef]) => { const entry = state(runtime).table.get(fdNumber(runtime, fdRef)); if (!entry || entry.desc.kind === 'closed') ioError(runtime, 'EBADF'); return BigInt(sizeOf(entry.desc)); });
  add(FILE_DISPATCHER, 'lock0(Ljava/io/FileDescriptor;ZJJZ)I', (runtime, [fdRef]) => { descOf(runtime, fdRef, false); return 0; });      // LOCKED: fcntl record locks never conflict inside one process, and the VM is one process
  add(FILE_DISPATCHER, 'release0(Ljava/io/FileDescriptor;JJ)V', (runtime, [fdRef]) => { descOf(runtime, fdRef, false); });
  add(FILE_DISPATCHER, 'closeIntFD(I)V', (runtime, [number]) => { if (!state(runtime).table.has(number)) ioError(runtime, 'EBADF'); release(runtime, number); });
  add(FILE_DISPATCHER, 'close0(Ljava/io/FileDescriptor;)V', (runtime, [fdRef]) => { const number = fdNumber(runtime, fdRef); if (number >= 0) { if (!state(runtime).table.has(number)) ioError(runtime, 'EBADF'); release(runtime, number); } });
  add(FILE_DISPATCHER, 'preClose0(Ljava/io/FileDescriptor;)V', (runtime, [fdRef]) => {      // FileDispatcherImpl.c dup2()s a closed socket over the descriptor so that blocked I/O fails; nothing blocks here, but later I/O must fail with EBADF
    const table = state(runtime).table, number = fdNumber(runtime, fdRef), entry = table.get(number); if (!entry) ioError(runtime, 'EBADF');
    entry.desc.refs--; table.set(number, { desc: { kind: 'closed', acc: 0, offset: 0, refs: 1 }, cloexec: false });
  });
  add(IOUTIL, 'initIDs()V', () => undefined);
  add(IOUTIL, 'fdVal(Ljava/io/FileDescriptor;)I', (runtime, [fdRef]) => fdNumber(runtime, fdRef));
  add(IOUTIL, 'setfdVal(Ljava/io/FileDescriptor;I)V', (runtime, [fdRef, value]) => setFdNumber(runtime, fdRef, value));
  add(IOUTIL, 'configureBlocking(Ljava/io/FileDescriptor;Z)V', (runtime, [fdRef]) => { descOf(runtime, fdRef, false); });   // regular files are always in blocking mode and never block
  add(IOUTIL, 'fdLimit()I', () => 1024);
  add(IOUTIL, 'iovMax()I', () => 1024);
  add(IOUTIL, 'randomBytes([B)Z', (runtime, [array]) => { const target = runtime.array(array), bytes = new Uint8Array(target.elements.length); globalThis.crypto.getRandomValues(bytes); for (let i = 0; i < bytes.length; i++) target.elements[i] = (bytes[i] << 24) >> 24; return 1; });
  add(NATIVE_THREAD, 'init()V', () => undefined);
  add(NATIVE_THREAD, 'current()J', () => 1n);    // a thread token for NativeThreadSet; signal() has nothing to interrupt because nothing blocks
  add(NATIVE_THREAD, 'signal(J)V', () => undefined);
  add(FILE_KEY, 'initIDs()V', () => undefined);
  add(FILE_KEY, 'init(Ljava/io/FileDescriptor;)V', (runtime, [self, fdRef]) => {
    const desc = entryOf(runtime, 'fstat', fdRef).desc, node = desc.kind === 'std' ? null : desc.node, fields = runtime.object(self).fields;
    runtime.storeField(fields, `${FILE_KEY}->st_dev:J`, node ? 0xfd00n : 0xfn); runtime.storeField(fields, `${FILE_KEY}->st_ino:J`, node ? BigInt(inode(node)) : 3n);
  });

  // ---- FileChannelImpl.c: mapping, positioning and sendfile. A mapping is a block of the VM's native arena filled from the file; MAP_SHARED writes reach the file at
  // force()/unmap time (the VirtualFileSystem cannot alias its byte buffer into arena memory), so unlike a kernel mapping it is not coherent with concurrent read()/write() calls.
  const maps = runtime => state(runtime).maps ??= new Map();
  const writeBack = (runtime, mapping, from = 0, to = mapping.length) => {
    if (mapping.prot !== 1) return;                                          // only MAP_RW (MAP_SHARED) mappings update the file
    const bytes = readNativeBytes(runtime, mapping.address + BigInt(from), to - from), size = mapping.node.size;
    if (mapping.position + from >= size) return;
    files(runtime).writeAt(mapping.node, mapping.position + from, bytes, 0, Math.min(bytes.length, size - mapping.position - from));
  };
  add(FILE_CHANNEL, 'initIDs()J', () => 4096n);                                // the page size: allocationGranularity
  add(FILE_CHANNEL, 'position0(Ljava/io/FileDescriptor;J)J', (runtime, [, fdRef, offset]) => {
    const desc = entryOf(runtime, 'lseek', fdRef).desc; if (desc.kind === 'std' || desc.kind === 'closed') ioError(runtime, 'ESPIPE');
    if (offset >= 0n) desc.offset = Number(offset); return BigInt(desc.offset);
  });
  add(FILE_CHANNEL, 'map0(IJJ)J', (runtime, [self, prot, position, length]) => {
    const fdRef = runtime.object(self).fields.get(`${FILE_CHANNEL}->fd:${FD}`), desc = descOf(runtime, fdRef, false);
    if (desc.kind !== 'file') ioError(runtime, 'ENODEV');
    const address = allocateNativeBlock(runtime, Number(length)), at = Number(position);
    pull(runtime, desc, at, address, Number(length)); maps(runtime).set(address, { address, node: desc.node, position: at, length: Number(length), prot });
    return address;
  });
  add(FILE_CHANNEL, 'unmap0(JJ)I', (runtime, [address]) => {
    const mapping = maps(runtime).get(address); if (!mapping) return -1;
    writeBack(runtime, mapping); maps(runtime).delete(address); freeNativeBlock(runtime, address); return 0;
  });
  add(FILE_CHANNEL, 'transferTo0(Ljava/io/FileDescriptor;JJLjava/io/FileDescriptor;)J', () => BigInt(IOS_UNSUPPORTED_CASE));   // sendfile(2) unavailable: FileChannelImpl falls back to its read/write copy loop
  add(MAPPED, 'isLoaded0(JJI)Z', () => 1);                                     // arena memory is always resident
  add(MAPPED, 'load0(JJ)V', () => undefined);
  add(MAPPED, 'force0(Ljava/io/FileDescriptor;JJ)V', (runtime, [, , address, length]) => {
    for (const mapping of maps(runtime).values()) {
      const from = Number(address - mapping.address); if (from < -mapping.length || from >= mapping.length) continue;
      const start = Math.max(0, from), end = Math.min(mapping.length, from + Number(length)); if (start < end) writeBack(runtime, mapping, start, end);
    }
  });
  return bindings;
}
