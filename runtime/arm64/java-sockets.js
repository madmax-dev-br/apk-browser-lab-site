// The socket and pipe descriptors Java opened (java.net.Socket / SocketChannel / DatagramSocket, Os.socket / socketpair / pipe: libcore's descriptor table,
// src/libcore-io-native.js), used by ARM64 native code (src/arm64/sockets.js). On a device Java and native code share one descriptor table, so the fd a library gets
// from ParcelFileDescriptor.fromSocket, Socket.getFileDescriptor$ or SocketImpl.fd is the same open socket: native reads take the bytes Java's reads would take, a native
// write is the socket's output, poll readiness comes from the same buffers, options and names are the socket's own, and closing either side's descriptor closes the
// description when its last descriptor goes (dup rules). Each function answers as the kernel does: bytes or a count, { errno }, or { wait } (the caller parks the thread
// until `wait()` holds and makes the call again). What the lab has no equivalent for (a peeked read, a datagram sent through a Java datagram socket) fails by name.
import { APKError } from '../apk-error.js?v=746332660dea';
import { readSocket, writeSocket, descriptorRevents, shutdownDescriptor, descriptorAvailable } from '../libcore-io-native.js?v=746332660dea';
import { Blocked } from '../scheduler.js?v=746332660dea';

const EAGAIN = 11, EBADF = 9, EPIPE = 32, ENOTCONN = 107, ECONNRESET = 104, ECONNREFUSED = 111, ENETUNREACH = 101, EINVAL = 22, ENOPROTOOPT = 92, ETIMEDOUT = 110;
const MSG_PEEK = 2, MSG_DONTWAIT = 0x40, O_ACCMODE = 3, O_RDONLY = 0, O_WRONLY = 1, SOCK_STREAM = 1, SOCK_DGRAM = 2;
const SOL_SOCKET = 1, SO_TYPE = 3, SO_ERROR = 4, SO_SNDBUF = 7, SO_RCVBUF = 8, SO_LINGER = 13, SO_RCVTIMEO = 20, SO_SNDTIMEO = 21, SO_ACCEPTCONN = 30, SO_PROTOCOL = 38, SO_DOMAIN = 39;
const ERRNO_FIELD = 'Landroid/system/ErrnoException;->errno:I';
// java.net's messages for what the kernel reports by errno (the libcore natives that build them: SocketInputStream.c, SocketOutputStream.c, the lab's virtual socket)
const MESSAGE_ERRNO = [[/closed/i, EBADF], [/reset/i, ECONNRESET], [/broken pipe|EPIPE/i, EPIPE], [/not connected|shutdown/i, ENOTCONN], [/timed out/i, ETIMEDOUT], [/refused/i, ECONNREFUSED], [/unreachable/i, ENETUNREACH]];

export function createJavaSockets(runtime) {
  const wrappers = new WeakMap();
  const fail = (what) => { throw new APKError(`ARM64 native code: ${what} on a descriptor Java opened is not provided by the lab`, { kind: 'arm64-network' }); };
  /** The Java socket or pipe behind descriptor `fd`, as an object of the ARM64 socket layer (kind 'java'), or null. */
  const of = fd => {
    if (fd <= 2) return null;
    const desc = runtime?.libcoreIo?.table.get(fd)?.desc;
    if (!desc || (desc.kind !== 'socket' && desc.kind !== 'pipe')) return null;
    let w = wrappers.get(desc);
    if (!w) { w = { kind: 'java', desc, get nonblocking() { return !!desc.nonblock; }, set nonblocking(value) { desc.nonblock = !!value; } }; wrappers.set(desc, w); }
    return w;
  };
  /** The errno a Java exception of the libcore natives stands for (ErrnoException carries it; java.net's SocketException by its message); anything else is rethrown. */
  const errnoOf = error => {
    if (error?.name !== 'JavaException' || !error.value) throw error;
    const errno = runtime.object(error.value).fields.get(ERRNO_FIELD); if (typeof errno === 'number' && errno > 0) return errno;
    const text = String(error.message ?? ''); for (const [pattern, value] of MESSAGE_ERRNO) if (pattern.test(text)) return value;
    throw error;
  };
  const isStream = desc => desc.kind === 'socket' && desc.type === SOCK_STREAM;
  const network = o => !!o.desc.http;
  /** recv: { bytes, length } (an empty result is the end of the stream), { errno } or { wait, what, network }. */
  const recv = (o, max, flags = 0) => {
    const desc = o.desc, dontwait = desc.nonblock || (flags & MSG_DONTWAIT);
    if (flags & MSG_PEEK) fail('MSG_PEEK');
    if (desc.kind === 'pipe') {
      if ((desc.acc & O_ACCMODE) === O_WRONLY) return { errno: EBADF };
      const pipe = desc.pipe;
      if (pipe.chunks.length === 0) { if (pipe.writers === 0 || max === 0) return { bytes: new Uint8Array(0), length: 0 }; if (dontwait) return { errno: EAGAIN }; return { wait: () => pipe.chunks.length > 0 || pipe.writers === 0, what: 'a pipe Java opened', network: false }; }
      const out = new Uint8Array(Math.min(max, pipe.size)); let at = 0;
      while (at < out.length) { const chunk = pipe.chunks[0], take = Math.min(chunk.length, out.length - at); out.set(chunk.subarray(0, take), at); at += take; if (take === chunk.length) pipe.chunks.shift(); else pipe.chunks[0] = chunk.subarray(take); }
      pipe.size -= out.length; return { bytes: out, length: out.length };
    }
    if (desc.type === SOCK_DGRAM) {   // a Java datagram socket: one queued datagram, cut to the buffer
      const queue = desc.queue ?? [];
      if (!queue.length) { if (desc.pendingError) { const errno = desc.pendingError.errno ?? ECONNREFUSED; desc.pendingError = null; return { errno }; } if (dontwait) return { errno: EAGAIN }; return { wait: () => (desc.queue?.length ?? 0) > 0 || !!desc.pendingError, what: 'a datagram on a socket Java opened', network: false }; }
      const datagram = queue.shift(); return { bytes: datagram.data.subarray(0, max), length: datagram.data.length };
    }
    if (!desc.connected && !desc.loop && !desc.http) return { errno: ENOTCONN };
    if (dontwait && !(descriptorRevents(desc, 1) & 1)) return { errno: EAGAIN };
    let got = null, result;
    try { result = readSocket(runtime, desc, Math.max(1, max), 0, bytes => { got = bytes; return bytes.length; }, [], true); }
    catch (error) { return { errno: errnoOf(error) }; }
    if (result instanceof Blocked) return { wait: () => result.ready(), what: `a socket Java opened (${desc.http?.label ?? 'loopback'})`, network: network(o) };
    if (result === -1 || got === null) return { bytes: new Uint8Array(0), length: 0 };
    return { bytes: got.length > max ? got.subarray(0, max) : got, length: got.length };
  };
  /** send: { count }, { errno } or { wait, what, network }. */
  const send = (o, bytes) => {
    const desc = o.desc;
    if (desc.kind === 'pipe') {
      if ((desc.acc & O_ACCMODE) === O_RDONLY) return { errno: EBADF };
      const pipe = desc.pipe; if (pipe.readers === 0) return { errno: EPIPE };
      if (bytes.length === 0) return { count: 0 };
      if (pipe.size >= 65536) { if (desc.nonblock) return { errno: EAGAIN }; return { wait: () => pipe.readers === 0 || pipe.size < 65536, what: 'a full pipe Java opened', network: false }; }
      const accepted = Math.min(bytes.length, 65536 - pipe.size); pipe.chunks.push(bytes.slice(0, accepted)); pipe.size += accepted; return { count: accepted };
    }
    if (!isStream(desc)) fail('sending a datagram through a datagram socket');
    if (!desc.connected && !desc.loop && !desc.http) return { errno: ENOTCONN };
    let result;
    try { result = writeSocket(runtime, desc, bytes.slice(), { posix: true }); }
    catch (error) { return { errno: errnoOf(error) }; }
    if (result instanceof Blocked) return { wait: () => result.ready(), what: 'a full socket Java opened', network: false };
    return { count: Number(result) };
  };
  const int = v => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v | 0, true); return b; };
  /** getsockopt: the value's bytes, as Java's Os.getsockopt* sees the same option (ints, struct linger, struct timeval), or { errno }. */
  const getsockopt = (o, level, name) => {
    const desc = o.desc; if (desc.kind !== 'socket') return { errno: 88 };   // ENOTSOCK
    const stored = desc.options?.get(`${level}:${name}`);
    if (level === SOL_SOCKET) {
      if (name === SO_TYPE) return int(desc.type); if (name === SO_DOMAIN) return int(desc.domain); if (name === SO_PROTOCOL) return int(desc.type === SOCK_STREAM ? 6 : 17);
      if (name === SO_ACCEPTCONN) return int(desc.listener ? 1 : 0);
      if (name === SO_ERROR) { const errno = desc.pendingError?.errno ?? 0; if (desc.pendingError) desc.pendingError = null; return int(errno); }   // read once, as the kernel clears it
      if (name === SO_LINGER) { const b = new Uint8Array(8), v = new DataView(b.buffer); v.setInt32(0, stored?.on ?? 0, true); v.setInt32(4, stored?.seconds ?? 0, true); return b; }
      if (name === SO_RCVTIMEO || name === SO_SNDTIMEO) { const b = new Uint8Array(16), v = new DataView(b.buffer); v.setBigInt64(0, BigInt(stored?.sec ?? 0n), true); v.setBigInt64(8, BigInt(stored?.usec ?? 0n), true); return b; }
      if ((name === SO_RCVBUF || name === SO_SNDBUF) && stored === undefined) return int(212992);
    }
    return int(typeof stored === 'number' ? stored : 0);
  };
  const setsockopt = (o, level, name, bytes) => {
    const desc = o.desc; if (desc.kind !== 'socket') return { errno: 88 };
    if (level === SOL_SOCKET && [SO_TYPE, SO_ERROR, SO_DOMAIN, SO_PROTOCOL, SO_ACCEPTCONN].includes(name)) return { errno: ENOPROTOOPT };
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), options = desc.options ??= new Map(), key = `${level}:${name}`;
    if (level === SOL_SOCKET && name === SO_LINGER) { if (bytes.length < 8) return { errno: EINVAL }; options.set(key, { on: v.getInt32(0, true), seconds: v.getInt32(4, true) }); return 0; }
    if (level === SOL_SOCKET && (name === SO_RCVTIMEO || name === SO_SNDTIMEO)) { if (bytes.length < 16) return { errno: EINVAL }; options.set(key, { sec: v.getBigInt64(0, true), usec: v.getBigInt64(8, true) }); return 0; }
    if (bytes.length < 4) return { errno: EINVAL };
    const value = v.getInt32(0, true);
    options.set(key, level === SOL_SOCKET && (name === SO_RCVBUF || name === SO_SNDBUF) ? Math.max(value, 2304) * 2 : value);   // as Os.setsockoptInt keeps it (the kernel doubles buffer sizes)
    return 0;
  };
  /** struct sockaddr_in / sockaddr_in6 of `{ bytes, port }` (a v4 address in an AF_INET6 socket as ::ffff:a.b.c.d). */
  const inet = (domain, address) => {
    const bytes = address?.bytes ?? [], port = address?.port ?? 0;
    if (domain === 10) { const b = new Uint8Array(28); b[0] = 10; b[2] = port >> 8; b[3] = port & 255; if (bytes.length === 16) b.set(bytes, 8); else if (bytes.length === 4) { b[18] = 0xff; b[19] = 0xff; b.set(bytes, 20); } return b; }
    const b = new Uint8Array(16); b[0] = 2; b[2] = port >> 8; b[3] = port & 255; if (bytes.length === 4) b.set(bytes, 4); return b;
  };
  const sockname = o => o.desc.kind !== 'socket' ? { errno: 88 } : o.desc.domain === 1 ? Uint8Array.of(1, 0) : inet(o.desc.domain, o.desc.bound ?? null);
  const peername = o => {
    const desc = o.desc; if (desc.kind !== 'socket') return { errno: 88 };
    if (desc.domain === 1) return desc.connected ? Uint8Array.of(1, 0) : { errno: ENOTCONN };
    const peer = desc.peerAddr ?? (desc.peer ? { bytes: desc.peer.bytes ?? desc.peer.address, port: desc.peer.port } : null);
    return desc.connected && peer ? inet(desc.domain, peer) : { errno: ENOTCONN };
  };
  const shutdown = (o, how) => { if (o.desc.kind !== 'socket') return { errno: 88 }; if (!o.desc.connected) return { errno: ENOTCONN }; shutdownDescriptor(runtime, o.desc, how); return 0; };
  const revents = (o, events) => descriptorRevents(o.desc, events);
  const available = o => descriptorAvailable(o.desc);
  return { of, recv, send, getsockopt, setsockopt, sockname, peername, shutdown, revents, available, network };
}
