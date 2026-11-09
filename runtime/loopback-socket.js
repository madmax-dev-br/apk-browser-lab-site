// The device's loopback TCP: java.net.ServerSocket / Socket over 127.0.0.0/8 and ::1 inside the VM. A phone has a working loopback interface even with no network, so a ServerSocket
// that an app opens for itself (the app is also the client) works here. What a browser cannot do is take connections from OUTSIDE the device: nothing outside ever connects, exactly
// as on a phone behind NAT, and a socket bound to a non-loopback address simply never gets a peer from anywhere but this process.
//
// The kernel side under libcore.io.Linux listen / accept / connect / read / write / shutdown / poll / close (the original PlainSocketImpl, IoBridge, SocketInputStream and
// SocketOutputStream run unchanged above it). A connection is two directional in-memory byte queues (64 KiB each, like the pipe2 implementation in libcore-io-native.js:
// partial writes, a writer parks while the queue is full, EOF when the peer closed or shut down its write side). connect() completes at once (Linux finishes the loopback handshake
// in the kernel before accept) and parks the server end in the listener's backlog. Threads park through the scheduler's Blocked and re-check their condition when woken.
import { Blocked } from './scheduler.js?v=a65043f84501';
import { throwNew } from './java-throw.js?v=a65043f84501';

export const CAPACITY = 65536;
const SOCKET_EXCEPTION = 'Ljava/net/SocketException;', TIMEOUT_EXCEPTION = 'Ljava/net/SocketTimeoutException;';
const WRITE_MESSAGES = { EPIPE: 'sendto failed: EPIPE (Broken pipe)', ECONNRESET: 'sendto failed: ECONNRESET (Connection reset by peer)', EBADF: 'Socket closed' };
const key = bytes => bytes.join('.');

/** One direction of a connection: written by one end, read by the other. */
class Direction {
  constructor() { this.chunks = []; this.size = 0; this.eof = false; this.reset = false; this.readerGone = false; this.discard = false; }
  push(bytes) { this.chunks.push(bytes); this.size += bytes.length; }
  take(count) {
    const taken = []; let need = Math.min(count, this.size);
    while (need > 0) { const chunk = this.chunks[0]; if (chunk.length <= need) { taken.push(chunk); need -= chunk.length; this.chunks.shift(); } else { taken.push(chunk.subarray(0, need)); this.chunks[0] = chunk.subarray(need); need = 0; } }
    const bytes = new Uint8Array(taken.reduce((n, c) => n + c.length, 0)); let at = 0; for (const c of taken) { bytes.set(c, at); at += c.length; }
    this.size -= bytes.length; return bytes;
  }
}

/** One end of an established connection (what `desc.loop` holds). */
class End {
  constructor(rx, tx) { this.rx = rx; this.tx = tx; this.closed = false; this.readShut = false; this.writeShut = false; }
  /** close(2): the peer sees EOF, its writes fail with EPIPE, and it is reset when this end still had unread data (the RST a kernel sends). */
  close() {
    if (this.closed) return; this.closed = true;
    this.tx.eof = true; this.rx.readerGone = true;
    if (this.rx.size > 0) this.tx.reset = true;
    this.rx.chunks = []; this.rx.size = 0;
  }
  get readable() { return this.closed || this.readShut || this.rx.size > 0 || this.rx.eof || this.rx.reset; }
  get writable() { return this.closed || this.writeShut || this.tx.readerGone || this.tx.discard || CAPACITY - this.tx.size > 0; }
}

export function createLoopback({ C, err }) {
  const registry = runtime => runtime.loopbackNet ??= { listeners: [] };
  const normalize = bytes => (bytes.every(v => v === 0) ? [127, 0, 0, 1] : bytes);
  /** Is this (already IPv4-mapped / ::1 normalized) address one of the device's own loopback addresses? 0.0.0.0 connects to the local host like on Linux. */
  const isLoopback = bytes => (bytes.length === 4 ? bytes[0] === 127 || bytes.every(v => v === 0) : bytes.slice(0, 15).every(v => v === 0) && (bytes[15] === 1 || bytes[15] === 0));
  const isAny = bytes => bytes.every(v => v === 0);
  const findListener = (runtime, bytes, port) => registry(runtime).listeners.find(l => l.port === port && (isAny(l.bytes) || key(l.bytes) === key(bytes)));

  // ---- listen / accept
  function listen(runtime, fn, desc, backlog) {
    if (desc.kind !== 'socket') err(runtime, fn, 'ENOTSOCK');
    if (desc.type !== C.SOCK_STREAM) err(runtime, fn, 'EOPNOTSUPP');
    if (desc.connected) err(runtime, fn, 'EINVAL');
    if (!desc.bound) err(runtime, fn, 'EINVAL');   // the caller binds an ephemeral port first (the kernel's autobind)
    const limit = Math.max(0, Math.min(backlog, 4096));
    if (desc.listener) { desc.listener.limit = limit; return; }
    const net = registry(runtime);
    if (net.listeners.some(l => l.port === desc.bound.port && (isAny(l.bytes) || isAny(desc.bound.bytes) || key(l.bytes) === key(desc.bound.bytes)))) err(runtime, fn, 'EADDRINUSE');
    const listener = { desc, bytes: desc.bound.bytes, port: desc.bound.port, backlog: [], limit, closed: false };
    desc.listener = listener; net.listeners.push(listener);
    const previous = desc.onLastClose; desc.onLastClose = () => { closeListener(runtime, listener); previous?.(); };
  }
  function closeListener(runtime, listener) {
    if (listener.closed) return; listener.closed = true;
    const net = registry(runtime), at = net.listeners.indexOf(listener); if (at >= 0) net.listeners.splice(at, 1);
    for (const pending of listener.backlog.splice(0)) { pending.loop.tx.reset = true; pending.loop.close(); }   // connections nobody accepted are reset
  }
  /** accept(2) on a listening socket: the next established connection's server-end descriptor, or a wait (the listener closing wakes it; the retry then fails with EINVAL / EBADF). */
  function accept(runtime, fn, desc) {
    const listener = desc.listener; if (!listener || listener.closed) err(runtime, fn, 'EINVAL');
    if (listener.backlog.length === 0) {
      if (desc.nonblock) err(runtime, fn, 'EAGAIN');
      return new Blocked({ ready: () => listener.backlog.length > 0 || listener.closed, retry: true, interruptible: false, reason: `accept(${key(listener.bytes)}:${listener.port})` });
    }
    return listener.backlog.shift();
  }

  // ---- connect
  /** Connects `desc` to a loopback address. Returns the connection's { local, peer } or throws ECONNREFUSED when nothing listens (the RST the kernel answers). */
  function connect(runtime, desc, targetBytes, port, bindEphemeral) {
    const target = normalize(targetBytes), listener = findListener(runtime, target, port);
    if (!listener) err(runtime, 'connect', 'ECONNREFUSED');
    if (listener.backlog.length > listener.limit) err(runtime, 'connect', 'ECONNREFUSED');   // Linux drops the SYN of a full accept queue and the client retries; the lab reports a refusal instead
    if (!desc.bound) bindEphemeral(target);
    const toServer = new Direction(), toClient = new Direction(), clientEnd = new End(toClient, toServer), serverEnd = new End(toServer, toClient);
    desc.loop = clientEnd; desc.connected = true; desc.peerAddr = { bytes: target, port };
    desc.onLastClose = () => clientEnd.close();
    const accepted = {
      kind: 'socket', domain: listener.desc.domain, type: C.SOCK_STREAM, acc: C.O_RDWR, offset: 0, append: false, ownerTag: 0n, refs: 0, connected: true, accepted: true,
      bound: { bytes: target, port }, peerAddr: { bytes: desc.bound.bytes, port: desc.bound.port }, loop: serverEnd, options: new Map(),
    };
    accepted.onLastClose = () => serverEnd.close();
    listener.backlog.push(accepted);
    return accepted;
  }

  // ---- read / write
  function fail(runtime, fn, posix, name, message) { if (posix) err(runtime, fn, name); throwNew(runtime, SOCKET_EXCEPTION, message ?? WRITE_MESSAGES[name]); }
  /** read on a connected loopback socket: the bytes queued, -1 at EOF, a wait otherwise (SO_TIMEOUT: `timeoutMs`). `deliver(bytes)` stores them and returns the count. */
  function read(runtime, desc, length, timeoutMs, deliver, roots, posix) {
    const end = desc.loop;
    const attempt = () => {
      if (end.closed) fail(runtime, 'read', posix, 'EBADF', 'Socket closed');
      if (end.rx.reset) fail(runtime, 'read', posix, 'ECONNRESET', 'Connection reset');
      if (end.readShut) return -1;
      if (end.rx.size > 0) return deliver(end.rx.take(length));
      if (end.rx.eof) return -1;
      return null;
    };
    const now = attempt(); if (now !== null) return now;
    if (desc.nonblock) err(runtime, 'read', 'EAGAIN');
    return new Blocked({
      ready: () => end.readable, deadline: timeoutMs > 0 ? runtime.platform.clock.now() + timeoutMs : Infinity, reason: `socket read: loopback ${desc.bound ? desc.bound.port : '?'}`, interruptible: false, roots,
      finish: timedOut => { const value = attempt(); if (value !== null) return value; if (timedOut) throwNew(runtime, TIMEOUT_EXCEPTION, 'Read timed out'); throw new Error('loopback read woke without data'); },
    });
  }
  /** write on a connected loopback socket. `all` (socketWrite0) writes every byte, parking while the peer's queue is full; otherwise write(2): a partial count, or a wait when nothing fits. */
  function write(runtime, desc, bytes, { all = false, posix = false } = {}) {
    const end = desc.loop; let offset = 0;
    const check = () => {
      if (end.closed) fail(runtime, 'write', posix, 'EBADF', 'Socket closed');
      if (end.writeShut || end.rx.reset) fail(runtime, 'write', posix, 'EPIPE');
      if (end.tx.readerGone) {   // the first write after the peer closed is accepted (the peer's kernel answers it with a reset); the ones after it fail with EPIPE
        if (end.tx.resetSent) fail(runtime, 'write', posix, 'EPIPE');
        end.tx.resetSent = true; offset = bytes.length; return true;
      }
      return false;
    };
    const step = () => {
      if (check()) return all ? undefined : bytes.length;
      while (offset < bytes.length) {
        if (end.tx.discard) { offset = bytes.length; break; }   // the peer shut down reading: the kernel accepts and drops
        const room = CAPACITY - end.tx.size;
        if (room <= 0) {
          if (desc.nonblock) { if (offset > 0) break; err(runtime, 'write', 'EAGAIN'); }
          if (!all && offset === 0) return new Blocked({ ready: () => end.writable, retry: true, interruptible: false, reason: 'write(socket): peer queue full (64 KiB)' });
          if (!all) break;
          return new Blocked({ ready: () => end.writable, interruptible: false, reason: 'socket write: peer queue full (64 KiB)', finish: step });
        }
        const n = Math.min(room, bytes.length - offset); end.tx.push(offset === 0 && n === bytes.length ? bytes : bytes.slice(offset, offset + n)); offset += n;
        if (!all) break;
      }
      return all ? undefined : offset;
    };
    return step();
  }
  function shutdown(runtime, desc, how) {
    const end = desc.loop; if (!end) return;
    if (how === C.SHUT_RD || how === C.SHUT_RDWR) { end.readShut = true; end.rx.discard = true; end.rx.chunks = []; end.rx.size = 0; }
    if (how === C.SHUT_WR || how === C.SHUT_RDWR) { end.writeShut = true; end.tx.eof = true; }
  }
  /** poll(2) events of a loopback socket (a listener or a connected end), or null for any other socket. */
  function revents(desc, events) {
    const { POLLIN, POLLOUT, POLLERR, POLLHUP } = C;
    if (desc.listener) {
      const closed = desc.listener.closed;
      return (desc.listener.backlog.length > 0 || closed ? POLLIN : 0) | (closed ? POLLHUP : 0);
    }
    const end = desc.loop; if (!end) return null;
    let result = 0;
    if (end.readable) result |= POLLIN;
    if (events & POLLOUT && end.writable) result |= POLLOUT;
    if (end.rx.reset) result |= POLLERR;
    if (end.closed || (end.rx.eof && end.writeShut)) result |= POLLHUP;
    return result;
  }
  const available = desc => (desc.loop ? desc.loop.rx.size : 0);
  const listening = (runtime, bytes, port) => !!findListener(runtime, normalize(bytes), port);
  return { isLoopback, listening, normalize, listen, accept, connect, read, write, shutdown, revents, available, closeListener };
}
