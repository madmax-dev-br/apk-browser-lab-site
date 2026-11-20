// Sockets and event-loop primitives for the ARM64 process (docs/ARM64-NATIVE.md "Network"): TCP streams over the APK Lab Relay's tunnel (src/tcp-tunnel.js, the same
// path java.net.Socket takes), in-process pipes and eventfd counters, and poll / select / epoll over all of them.
// Names: getaddrinfo gives a host name an address from 198.18.0.0/15 (reserved for benchmarking, never routed) and connect() to it opens the tunnel by that name, so
// the relay resolves and reaches the real host; a numeric address connects as given. Each mapping is recorded in the trace. Without a relay a connect fails with
// ECONNREFUSED, as Java sockets do. Unix-domain stream sockets work inside the process (socketpair; bind/listen/accept/connect between the process's own sockets; a
// name nobody bound refuses the connection, as on a device). UDP has no path (the relay
// tunnels TCP only): a UDP socket opens, every send fails with ENETUNREACH (recorded) and nothing arrives, as on a network that blocks UDP; QUIC stacks then fall back to TCP. A blocking call waits as a native thread wait (src/arm64/threads.js);
// on the thread that runs Java the network cannot be waited for synchronously, so that call fails by name.
import { APKError } from '../apk-error.js?v=5376509d4366';
import { BLOCKED } from './cpu.js?v=5376509d4366';
import { tunnelEndpoint, openTunnelSession } from '../tcp-tunnel.js?v=5376509d4366';

const ENETUNREACH = 101, ENOENT = 2, EADDRINUSE = 98, EOPNOTSUPP = 95, EAGAIN = 11, EBADF = 9, EINPROGRESS = 115, ECONNREFUSED = 111, ENOTCONN = 107, EPIPE = 32, EINVAL = 22, EISCONN = 106;
const POLLIN = 1, POLLOUT = 4, POLLERR = 8, POLLHUP = 16, O_NONBLOCK = 0o4000;

export function addSockets(lib, { runtime } = {}) {
  const n = (c, i) => Number(c.x[i]), s32 = (c, i) => Number(BigInt.asIntN(32, c.x[i])), x = (c, i) => c.x[i];
  const objects = new Map(); let nextFd = 1000;
  { const files = lib.__ownsFd; lib.__ownsFd = fd => objects.has(fd) || !!files?.(fd); }
  const names = new Map(), byAddress = new Map();
  const fail = (p, errno) => { p.memory.writeU32(p.errnoAddress, errno); return 0xffffffffffffffffn; };
  const unsupported = what => { throw new APKError(`ARM64 native code: ${what} is not provided by the lab`, { kind: 'arm64-network' }); };
  const T = p => p.threads;
  // ---- readiness, shared by read/recv, poll, select and epoll
  const expirations = o => { const now = performance.now(); if (now < o.next) return 0; return o.interval ? 1 + Math.floor((now - o.next) / o.interval) : 1; };
  const readable = o => o.kind === 'unix' ? (o.listening ? o.backlog.length > 0 : !!o.rx && (o.rx.bytes.length > 0 || o.rx.closed)) : o.kind === 'tcp' ? (o.session && (o.session.queue.length > 0 || o.session.closed || !!o.session.error)) : o.kind === 'pipe-read' ? (o.pipe.bytes.length > 0 || o.pipe.closed) : o.kind === 'eventfd' ? o.count > 0n : o.kind === 'timerfd' ? expirations(o) > 0 : o.kind === 'file' ? true : false;
  const writable = o => o.kind === 'udp' ? true : o.kind === 'unix' ? !!o.tx && !o.tx.closed : o.kind === 'tcp' ? !!o.session?.connected && !o.session.closed : o.kind === 'pipe-write' ? true : o.kind === 'eventfd' ? true : o.kind === 'file' ? true : false;
  const events = o => (readable(o) ? POLLIN : 0) | (writable(o) ? POLLOUT : 0) | (o.kind === 'tcp' && o.session?.error ? POLLERR : 0) | (o.kind === 'tcp' && o.session?.closed ? POLLHUP : 0);
  const waitFor = (p, c, ready, what, deadline = Infinity, network = true, wakeAt = null) => {
    if (ready()) return true;
    if (network && !T(p).canSuspend(c) && T(p).current.main) throw new APKError(`ARM64 native code waits for ${what} on the thread that runs Java: the network cannot be waited for there (use a native thread)`, { kind: 'arm64-network' });
    return T(p).wait(c, ready, { what, deadline, wakeAt });
  };
  // ---- addresses
  const resolve = name => { if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return name; if (!names.has(name)) { const i = names.size + 1, ip = `198.18.${(i >> 8) & 255}.${i & 255}`; names.set(name, ip); byAddress.set(ip, name); runtime?.record?.(`NET native getaddrinfo ${name} -> ${ip} (placeholder; the relay resolves the name at connect)`); } return names.get(name); };
  const writeSockaddr = (p, ptr, ip, port) => { p.memory.fill(ptr, 0, 16); p.memory.dv.setUint16(ptr, 2, true); p.memory.dv.setUint16(ptr + 2, port, false); ip.split('.').forEach((b, i) => { p.memory.u8[ptr + 4 + i] = Number(b); }); };
  const readSockaddr = (p, ptr) => { const family = p.memory.dv.getUint16(ptr, true); if (family !== 2) unsupported(family === 10 ? 'an IPv6 address in connect()' : `address family ${family}`); return { ip: [...p.memory.bytes(ptr + 4, 4)].join('.'), port: p.memory.dv.getUint16(ptr + 2, false) }; };
  lib.getaddrinfo = (p, c) => {
    const node = n(c, 0) ? new TextDecoder().decode(p.memory.cString(n(c, 0))) : '127.0.0.1', service = n(c, 1) ? new TextDecoder().decode(p.memory.cString(n(c, 1))) : '0', hints = n(c, 2);
    const socktype = hints ? p.memory.dv.getInt32(hints + 8, true) : 0, family = hints ? p.memory.dv.getInt32(hints + 4, true) : 0;
    if (family === 10) return 8;   // EAI_ADDRFAMILY: only IPv4 here
    const ip = resolve(node), port = Number(service) || { http: 80, https: 443 }[service] || 0, info = p.malloc(48), addr = p.malloc(16);
    writeSockaddr(p, addr, ip, port);
    p.memory.fill(info, 0, 48); p.memory.dv.setInt32(info + 4, 2, true); p.memory.dv.setInt32(info + 8, socktype || 1, true); p.memory.dv.setInt32(info + 12, 6, true); p.memory.writeU32(info + 16, 16); p.memory.writePtr(info + 32, addr);   // bionic struct addrinfo: flags, family, socktype, protocol, addrlen @16, canonname @24, addr @32, next @40
    p.memory.writePtr(n(c, 3), info); return 0;
  };
  lib.freeaddrinfo = (p, c) => { let info = n(c, 0); while (info) { const next = p.memory.readPtr(info + 40); p.free(p.memory.readPtr(info + 32)); p.free(info); info = next; } };
  lib.gai_strerror = (p, c) => p.allocString(`getaddrinfo error ${s32(c, 0)}`);
  lib.inet_pton = (p, c) => { if (s32(c, 0) !== 2) return 0; const parts = new TextDecoder().decode(p.memory.cString(n(c, 1))).split('.').map(Number); if (parts.length !== 4 || parts.some(v => !(v >= 0 && v <= 255))) return 0; parts.forEach((b, i) => { p.memory.u8[n(c, 2) + i] = b; }); return 1; };
  lib.inet_ntop = (p, c) => { if (s32(c, 0) !== 2) return 0; const text = [...p.memory.bytes(n(c, 1), 4)].join('.'), bytes = new TextEncoder().encode(text); p.memory.copyIn(n(c, 2), bytes); p.memory.u8[n(c, 2) + bytes.length] = 0; return n(c, 2); };
  lib.inet_addr = (p, c) => { const parts = new TextDecoder().decode(p.memory.cString(n(c, 0))).split('.').map(Number); return parts.length === 4 ? (parts[0] | parts[1] << 8 | parts[2] << 16 | parts[3] << 24) >>> 0 : 0xffffffff; };
  lib.htons = lib.ntohs = (p, c) => ((n(c, 0) & 0xff) << 8) | ((n(c, 0) >> 8) & 0xff);
  lib.htonl = lib.ntohl = (p, c) => { const v = n(c, 0) >>> 0; return (((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | (v >>> 24)) >>> 0; };
  lib.if_nametoindex = () => 0; lib.if_indextoname = () => 0;
  // ---- sockets
  lib.socket = (p, c) => {
    const domain = s32(c, 0), type = s32(c, 1) & 0xf, flags = s32(c, 1);
    if (domain === 1) { if (type !== 1 && type !== 5) unsupported('a Unix-domain datagram socket'); const fd = nextFd++; objects.set(fd, { kind: 'unix', rx: null, tx: null, nonblocking: !!(flags & O_NONBLOCK) }); return fd; }
    if (type === 2) { const fd = nextFd++; objects.set(fd, { kind: 'udp', nonblocking: !!(flags & O_NONBLOCK) }); return fd; } if (domain !== 2 && domain !== 10) unsupported(`socket domain ${domain}`);
    const fd = nextFd++; objects.set(fd, { kind: 'tcp', session: null, nonblocking: !!(flags & O_NONBLOCK), host: null, port: 0 }); return fd;
  };
  lib.connect = (p, c) => {
    const o = objects.get(s32(c, 0)); if (!o) return fail(p, EBADF);
    if (o.kind === 'unix') return unixConnect(p, c, o);
    if (o.kind === 'udp') { const family = p.memory.dv.getUint16(n(c, 1), true); if (family === 2) { const { ip, port } = readSockaddr(p, n(c, 1)); o.peer = `${byAddress.get(ip) ?? ip}:${port}`; } return 0; }   // UDP connect only sets the peer
    if (!o.session) {
      const { ip, port } = readSockaddr(p, n(c, 1)), host = byAddress.get(ip) ?? ip, endpoint = tunnelEndpoint(runtime?.platform?.networkPolicy ?? runtime?.network?.policy);
      Object.assign(o, { host, port });
      if (!endpoint) { runtime?.record?.(`NET native connect ${host}:${port}: no relay configured (a browser cannot open TCP): ECONNREFUSED`); return fail(p, ECONNREFUSED); }
      runtime?.record?.(`NET native connect ${host}:${port} through the relay tunnel`);
      o.session = openTunnelSession({ endpoint, host, port, signal: () => T(p).schedulePump() });
      if (o.nonblocking) return fail(p, EINPROGRESS);
    }
    const r = waitFor(p, c, () => o.session.connected || !!o.session.error, `the connection to ${o.host}:${o.port}`);
    if (r === BLOCKED) return BLOCKED;
    return o.session.error ? fail(p, ECONNREFUSED) : 0;
  };
  const sendBytes = (p, c, o, ptr, length) => {
    if (!o.session?.connected) return fail(p, o.session?.error ? ECONNREFUSED : ENOTCONN);
    if (o.session.closed) return fail(p, EPIPE);
    o.session.send(p.memory.bytes(ptr, length).slice()); return length;
  };
  const receive = (p, c, o, ptr, length) => {
    if (!o.session) return fail(p, ENOTCONN);
    if (!readable(o)) { if (o.nonblocking) return fail(p, EAGAIN); const r = waitFor(p, c, () => readable(o), `data from ${o.host}:${o.port}`); if (r === BLOCKED) return BLOCKED; }
    if (o.session.error && !o.session.queue.length) return fail(p, ECONNREFUSED);
    let copied = 0;
    while (copied < length && o.session.queue.length) { const chunk = o.session.queue[0], take = Math.min(chunk.length, length - copied); p.memory.copyIn(ptr + copied, chunk.subarray(0, take)); copied += take; if (take === chunk.length) o.session.queue.shift(); else o.session.queue[0] = chunk.subarray(take); }
    return copied;
  };
  lib.send = lib.sendto = (p, c) => { const o = objects.get(s32(c, 0)); return !o ? fail(p, EBADF) : o.kind === 'udp' ? udpSend(p, o) : o.kind === 'unix' ? unixWrite(p, c, o, n(c, 1), n(c, 2)) : sendBytes(p, c, o, n(c, 1), n(c, 2)); };
  lib.recv = lib.recvfrom = (p, c) => { const o = objects.get(s32(c, 0)); return !o ? fail(p, EBADF) : o.kind === 'udp' ? udpReceive(p, c, o) : o.kind === 'unix' ? unixRead(p, c, o, n(c, 1), n(c, 2)) : receive(p, c, o, n(c, 1), n(c, 2)); };
  // UDP: no datagram leaves or arrives (the relay carries TCP only)
  const udpSend = (p, o) => { if (!o.reported) { o.reported = true; runtime?.record?.(`NET native UDP send${o.peer ? ` to ${o.peer}` : ''}: ENETUNREACH (the lab's network path is the relay's TCP tunnel; no UDP)`); } return fail(p, ENETUNREACH); };
  const udpReceive = (p, c, o) => { if (o.nonblocking) return fail(p, EAGAIN); const r = waitFor(p, c, () => false, 'a UDP datagram (none can arrive: the lab has no UDP path)', Infinity, false); return r === BLOCKED ? BLOCKED : fail(p, EAGAIN); };
  lib.sendmsg = lib.sendmmsg = (p, c) => { const o = objects.get(s32(c, 0)); if (o?.kind === 'udp') return udpSend(p, o); return unsupported('sendmsg on a stream socket'); };
  lib.recvmsg = lib.recvmmsg = (p, c) => { const o = objects.get(s32(c, 0)); if (o?.kind === 'udp') return udpReceive(p, c, o); return unsupported('recvmsg on a stream socket'); };
  lib.setsockopt = () => 0;
  lib.getsockopt = (p, c) => { const o = objects.get(s32(c, 0)); if (!o) return fail(p, EBADF); const value = s32(c, 2) === 4 ? (o.session?.error ? ECONNREFUSED : 0) : 0; if (n(c, 3)) p.memory.writeU32(n(c, 3), value); if (n(c, 4)) p.memory.writeU32(n(c, 4), 4); return 0; };   // SO_ERROR
  lib.getsockname = (p, c) => { writeSockaddr(p, n(c, 1), '10.0.2.15', 40000 + (s32(c, 0) % 20000)); p.memory.writeU32(n(c, 2), 16); return 0; };
  lib.getpeername = (p, c) => { const o = objects.get(s32(c, 0)); if (!o?.session) return fail(p, ENOTCONN); writeSockaddr(p, n(c, 1), names.get(o.host) ?? o.host, o.port); p.memory.writeU32(n(c, 2), 16); return 0; };
  lib.shutdown = (p, c) => { const o = objects.get(s32(c, 0)); if (o?.kind === 'unix') { const how = s32(c, 1); if (how !== 0 && o.tx) o.tx.closed = true; if (how !== 1 && o.rx) o.rx.closed = true; T(p).schedulePump(); return 0; } o?.session?.close(); return 0; };
  // ---- Unix-domain stream sockets: each connected end reads one in-process byte queue and writes the other's
  const unixNames = new Map(), decoder = new TextDecoder();   // bound name ('@' + abstract name, or a path) -> socket
  const unixName = (p, ptr, length) => { const family = p.memory.dv.getUint16(ptr, true); if (family !== 1) return null; const raw = p.memory.bytes(ptr + 2, Math.max(0, length - 2)); if (raw[0] === 0) return '@' + decoder.decode(raw.subarray(1)); const end = raw.indexOf(0); return decoder.decode(end >= 0 ? raw.subarray(0, end) : raw); };
  const queue = () => ({ bytes: new Uint8Array(0), closed: false });
  const connectEnds = (a, b) => { const ab = queue(), ba = queue(); Object.assign(a, { tx: ab, rx: ba }); Object.assign(b, { tx: ba, rx: ab }); };
  const unixConnect = (p, c, o) => {
    if (o.rx) return fail(p, EISCONN);
    const name = unixName(p, n(c, 1), n(c, 2)); if (name === null) return fail(p, EINVAL);
    const listener = unixNames.get(name);
    if (!listener?.listening) { const files = runtime?.platform?.javaIo?.fs?.(); const missing = !name.startsWith('@') && !files?.stat?.(name); runtime?.record?.(`NET native connect unix:${name}: ${missing ? 'ENOENT' : 'ECONNREFUSED'} (no socket of the process listens there)`); return fail(p, missing ? ENOENT : ECONNREFUSED); }
    const peer = { kind: 'unix', rx: null, tx: null, nonblocking: false }; connectEnds(o, peer); listener.backlog.push(peer); T(p).schedulePump(); return 0;
  };
  const unixRead = (p, c, o, ptr, length) => {
    if (!o.rx) return fail(p, ENOTCONN);
    if (!readable(o)) { if (o.nonblocking) return fail(p, EAGAIN); const r = waitFor(p, c, () => readable(o), 'a Unix-domain socket', Infinity, false); if (r === BLOCKED) return BLOCKED; }
    const take = Math.min(o.rx.bytes.length, length); p.memory.copyIn(ptr, o.rx.bytes.subarray(0, take)); o.rx.bytes = o.rx.bytes.slice(take); T(p).schedulePump(); return take;
  };
  const unixWrite = (p, c, o, ptr, length) => {
    if (!o.tx) return fail(p, ENOTCONN); if (o.tx.closed) return fail(p, EPIPE);
    const add = p.memory.bytes(ptr, length), next = new Uint8Array(o.tx.bytes.length + add.length); next.set(o.tx.bytes); next.set(add, o.tx.bytes.length); o.tx.bytes = next; T(p).schedulePump(); pumpMain(p); return length;
  };
  lib.socketpair = (p, c) => {
    const domain = s32(c, 0), type = s32(c, 1) & 0xf, flags = s32(c, 1); if (domain !== 1) return fail(p, EOPNOTSUPP); if (type !== 1 && type !== 5) unsupported('a Unix-domain datagram socketpair');
    const a = { kind: 'unix', nonblocking: !!(flags & O_NONBLOCK) }, b = { kind: 'unix', nonblocking: !!(flags & O_NONBLOCK) }; connectEnds(a, b);
    const fa = nextFd++, fb = nextFd++; objects.set(fa, a); objects.set(fb, b); p.memory.writeU32(n(c, 3), fa); p.memory.writeU32(n(c, 3) + 4, fb); return 0;
  };
  lib.bind = (p, c) => {
    const o = objects.get(s32(c, 0)); if (!o) return fail(p, EBADF); if (o.kind === 'udp') return 0; if (o.kind !== 'unix') unsupported('a listening TCP socket (bind)');
    const name = unixName(p, n(c, 1), n(c, 2)); if (name === null) return fail(p, EINVAL); if (unixNames.has(name)) return fail(p, EADDRINUSE);
    unixNames.set(name, o); o.name = name; return 0;
  };
  lib.listen = (p, c) => { const o = objects.get(s32(c, 0)); if (!o) return fail(p, EBADF); if (o.kind !== 'unix') unsupported('a listening TCP socket (listen)'); o.listening = true; o.backlog ??= []; return 0; };
  lib.accept = lib.accept4 = (p, c) => {
    const o = objects.get(s32(c, 0)); if (!o) return fail(p, EBADF); if (o.kind !== 'unix') unsupported('a listening TCP socket (accept)'); if (!o.listening) return fail(p, EINVAL);
    if (!o.backlog.length) { if (o.nonblocking) return fail(p, EAGAIN); const r = waitFor(p, c, () => o.backlog.length > 0, `a connection to unix:${o.name}`, Infinity, false); if (r === BLOCKED) return BLOCKED; }
    const peer = o.backlog.shift(), fd = nextFd++; objects.set(fd, peer); if (n(c, 2)) p.memory.writeU32(n(c, 2), 2); return fd;
  };
  // ---- pipes and eventfd
  lib.pipe = lib.pipe2 = (p, c) => { const pipe = { bytes: new Uint8Array(0), closed: false }, r = nextFd++, w = nextFd++; objects.set(r, { kind: 'pipe-read', pipe, nonblocking: !!(n(c, 1) & O_NONBLOCK) }); objects.set(w, { kind: 'pipe-write', pipe }); p.memory.writeU32(n(c, 0), r); p.memory.writeU32(n(c, 0) + 4, w); return 0; };
  lib.eventfd = (p, c) => { const fd = nextFd++; objects.set(fd, { kind: 'eventfd', count: BigInt(n(c, 0) >>> 0), nonblocking: !!(n(c, 1) & O_NONBLOCK), semaphore: !!(n(c, 1) & 1) }); return fd; };
  // read/write/close/fcntl on these fds; everything else goes to the file implementation
  const base = { read: lib.read, write: lib.write, close: lib.close, fcntl: lib.fcntl };
  lib.read = (p, c) => {
    const o = objects.get(s32(c, 0)); if (!o) return base.read(p, c);
    if (o.kind === 'tcp') return receive(p, c, o, n(c, 1), n(c, 2));
    if (o.kind === 'unix') return unixRead(p, c, o, n(c, 1), n(c, 2));
    if (o.kind === 'pipe-read') { if (!readable(o)) { if (o.nonblocking) return fail(p, EAGAIN); const r = waitFor(p, c, () => readable(o), 'a pipe', Infinity, false); if (r === BLOCKED) return BLOCKED; } const take = Math.min(o.pipe.bytes.length, n(c, 2)); p.memory.copyIn(n(c, 1), o.pipe.bytes.subarray(0, take)); o.pipe.bytes = o.pipe.bytes.slice(take); return take; }
    if (o.kind === 'timerfd') { if (!expirations(o)) { if (o.nonblocking) return fail(p, EAGAIN); const r = waitFor(p, c, () => expirations(o) > 0, 'a timerfd', Infinity, false, () => o.next); if (r === BLOCKED) return BLOCKED; } const count = expirations(o); o.next = o.interval ? o.next + count * o.interval : Infinity; p.memory.write64(n(c, 1), BigInt(count)); return 8; }
    if (o.kind === 'eventfd') { if (o.count === 0n) { if (o.nonblocking) return fail(p, EAGAIN); const r = waitFor(p, c, () => o.count > 0n, 'an eventfd', Infinity, false); if (r === BLOCKED) return BLOCKED; } const value = o.semaphore ? 1n : o.count; o.count -= value; p.memory.write64(n(c, 1), value); return 8; }
    return fail(p, EINVAL);
  };
  lib.write = (p, c) => {
    const o = objects.get(s32(c, 0)); if (!o) return base.write(p, c);
    if (o.kind === 'tcp') return sendBytes(p, c, o, n(c, 1), n(c, 2));
    if (o.kind === 'unix') return unixWrite(p, c, o, n(c, 1), n(c, 2));
    if (o.kind === 'pipe-write') { if (o.pipe.closed) return fail(p, EPIPE); const add = p.memory.bytes(n(c, 1), n(c, 2)), next = new Uint8Array(o.pipe.bytes.length + add.length); next.set(o.pipe.bytes); next.set(add, o.pipe.bytes.length); o.pipe.bytes = next; T(p).schedulePump(); pumpMain(p); return add.length; }
    if (o.kind === 'eventfd') { o.count += p.memory.read64(n(c, 1)); T(p).schedulePump(); pumpMain(p); return 8; }
    return fail(p, EINVAL);
  };
  lib.close = (p, c) => { const fd = s32(c, 0), o = objects.get(fd); if (!o) return base.close(p, c); if (o.kind === 'tcp') o.session?.close(); if (o.kind === 'pipe-write' || o.kind === 'pipe-read') o.pipe.closed = true; if (o.kind === 'unix') { if (o.tx) o.tx.closed = true; if (o.rx) o.rx.closed = true; if (o.name && unixNames.get(o.name) === o) unixNames.delete(o.name); T(p).schedulePump(); } objects.delete(fd); return 0; };
  lib.fcntl = (p, c) => { const o = objects.get(s32(c, 0)); if (!o) return base.fcntl(p, c); const cmd = s32(c, 1); if (cmd === 3) return o.nonblocking ? O_NONBLOCK : 2; if (cmd === 4) { o.nonblocking = !!(n(c, 2) & O_NONBLOCK); return 0; } return 0; };   // F_GETFL / F_SETFL
  // ---- poll / select / epoll
  const objectOrFile = fd => objects.get(fd) ?? (fd >= 0 && fd < 1000 ? { kind: 'file' } : null);
  lib.poll = lib.__poll_chk = lib.ppoll = (p, c) => {
    const fds = n(c, 0), count = n(c, 1), timeout = s32(c, 2), deadline = timeout < 0 ? Infinity : T(p).now() + timeout;
    const ready = () => { let k = 0; for (let i = 0; i < count; i++) { const at = fds + 8 * i, o = objectOrFile(p.memory.dv.getInt32(at, true)); const wanted = p.memory.dv.getInt16(at + 4, true) | POLLERR | POLLHUP, got = o ? events(o) & wanted : 32; p.memory.dv.setInt16(at + 6, got, true); if (got) k++; } return k; };
    if (ready() || timeout === 0) return ready();
    const r = waitFor(p, c, () => ready() > 0, 'poll()', deadline, [...Array(count).keys()].some(i => objects.get(p.memory.dv.getInt32(fds + 8 * i, true))?.kind === 'tcp'), () => timerWake([...Array(count).keys()].map(i => p.memory.dv.getInt32(fds + 8 * i, true)))); if (r === BLOCKED) return BLOCKED; return ready();
  };
  lib.select = lib.pselect = (p, c) => {
    const nfds = s32(c, 0), sets = [n(c, 1), n(c, 2), n(c, 3)], tv = n(c, 4), deadline = tv ? T(p).now() + Number(p.memory.read64(tv)) * 1000 + Number(p.memory.read64(tv + 8)) / 1000 : Infinity;
    const wanted = sets.map(ptr => ptr ? p.memory.bytes(ptr, Math.ceil(nfds / 8)).slice() : null);
    const compute = write => { let k = 0; wanted.forEach((bits, kind) => { if (!bits) return; const out = new Uint8Array(bits.length); for (let fd = 0; fd < nfds; fd++) if (bits[fd >> 3] & (1 << (fd & 7))) { const o = objectOrFile(fd), on = o && (kind === 0 ? readable(o) : kind === 1 ? writable(o) : !!o.session?.error); if (on) { out[fd >> 3] |= 1 << (fd & 7); k++; } } if (write) p.memory.copyIn(sets[kind], out); }); return k; };
    if (compute(false) || deadline <= T(p).now()) return compute(true);
    const r = waitFor(p, c, () => compute(false) > 0, 'select()', deadline); if (r === BLOCKED) return BLOCKED; return compute(true);
  };
  lib.epoll_create = lib.epoll_create1 = () => { const fd = nextFd++; objects.set(fd, { kind: 'epoll', watched: new Map() }); return fd; };
  lib.epoll_ctl = (p, c) => { const e = objects.get(s32(c, 0)); if (e?.kind !== 'epoll') return fail(p, EBADF); const op = s32(c, 1), fd = s32(c, 2); if (op === 2) { e.watched.delete(fd); return 0; } if (op === 1 && e.watched.has(fd)) return fail(p, 17); e.watched.set(fd, { events: p.memory.readU32(n(c, 3)), data: p.memory.read64(n(c, 3) + 8) }); return 0; };
  lib.epoll_wait = lib.epoll_pwait = (p, c) => {
    const e = objects.get(s32(c, 0)); if (e?.kind !== 'epoll') return fail(p, EBADF);
    const out = n(c, 1), max = s32(c, 2), timeout = s32(c, 3), deadline = timeout < 0 ? Infinity : T(p).now() + timeout;
    const collect = write => { let k = 0; for (const [fd, w] of e.watched) { if (k >= max) break; const o = objectOrFile(fd); const got = o ? events(o) & (w.events | POLLERR | POLLHUP) : 0; if (got) { if (write) { p.memory.writeU32(out + 16 * k, got); p.memory.write64(out + 16 * k + 8, w.data); } k++; } } return k; };   // struct epoll_event on arm64: 16 bytes (events, pad, data)
    if (collect(false) || timeout === 0) return collect(true);
    const r = waitFor(p, c, () => collect(false) > 0, 'epoll_wait()', deadline, [...e.watched.keys()].some(fd => objects.get(fd)?.kind === 'tcp'), () => timerWake(e.watched.keys())); if (r === BLOCKED) return BLOCKED; return collect(true);
  };
  // ---- timerfd: a descriptor that becomes readable when its (monotonic or realtime) timer expires; read gives the expirations since the last read
  lib.timerfd_create = (p, c) => { const fd = nextFd++; objects.set(fd, { kind: 'timerfd', clock: s32(c, 0), next: Infinity, interval: 0, nonblocking: !!(n(c, 1) & O_NONBLOCK) }); return fd; };
  const spec = (p, at) => Number(p.memory.read64(at)) * 1000 + Number(p.memory.read64(at + 8)) / 1e6;
  const writeSpec = (p, at, ms) => { p.memory.write64(at, BigInt(Math.floor(ms / 1000))); p.memory.write64(at + 8, BigInt(Math.floor((ms % 1000) * 1e6))); };
  const timerOf = (p, c) => { const o = objects.get(s32(c, 0)); return o?.kind === 'timerfd' ? o : null; };
  lib.timerfd_gettime = (p, c) => { const o = timerOf(p, c); if (!o) return fail(p, EBADF); const out = n(c, 1); writeSpec(p, out, o.interval); writeSpec(p, out + 16, o.next === Infinity ? 0 : Math.max(0, o.next - T(p).now())); return 0; };
  lib.timerfd_settime = (p, c) => {
    const o = timerOf(p, c); if (!o) return fail(p, EBADF);
    const flags = n(c, 1), value = n(c, 2), old = n(c, 3);
    if (old) { writeSpec(p, old, o.interval); writeSpec(p, old + 16, o.next === Infinity ? 0 : Math.max(0, o.next - T(p).now())); }
    const interval = spec(p, value), first = spec(p, value + 16), now = T(p).now();
    const absoluteBase = o.clock === 0 ? Date.now() : now;   // TFD_TIMER_ABSTIME: the value is a time on the timer's clock (CLOCK_REALTIME or CLOCK_MONOTONIC / BOOTTIME)
    o.interval = interval; o.next = first === 0 ? Infinity : flags & 1 ? now + (first - absoluteBase) : now + first;
    T(p).schedulePump(); pumpMain(p); return 0;
  };
  // ---- ALooper (libandroid): each thread may have a looper that polls its file descriptors. A native thread polls its own (ALooper_pollOnce / pollAll);
  // the thread that runs Java already has one, the main looper, whose callbacks run on the VM's event loop between its other events, as the Java Looper
  // runs them on a device. The event bits are poll's: INPUT 1, OUTPUT 4, ERROR 8, HANGUP 16.
  const loopers = new Map(), byThread = new Map(); let nextLooper = 1;
  const newLooper = tid => { const looper = { handle: 0x7c0000000000 + 16 * nextLooper++, tid, watches: new Map(), woken: false }; loopers.set(looper.handle, looper); byThread.set(tid, looper); return looper; };
  const looperOf = (p, c) => loopers.get(n(c, 0)) ?? (() => { throw new APKError(`ARM64 native code used ALooper 0x${n(c, 0).toString(16)} that ALooper_forThread / ALooper_prepare did not return`, { kind: 'arm64-looper' }); })();
  const mainLooper = p => byThread.get('main') ?? (() => { const l = newLooper('main'); l.main = true; return l; })();
  const currentLooper = p => T(p).current.main ? mainLooper(p) : byThread.get(T(p).current.tid) ?? null;
  lib.ALooper_forThread = p => currentLooper(p)?.handle ?? 0;
  lib.ALooper_prepare = p => (currentLooper(p) ?? newLooper(T(p).current.tid)).handle;
  lib.ALooper_acquire = lib.ALooper_release = () => {};
  lib.ALooper_addFd = (p, c) => { const looper = looperOf(p, c), fd = s32(c, 1); looper.watches.set(fd, { ident: s32(c, 2), events: n(c, 3), callback: n(c, 4), data: x(c, 5) }); if (looper.main) pumpMain(p); return 1; };
  lib.ALooper_removeFd = (p, c) => looperOf(p, c).watches.delete(s32(c, 1)) ? 1 : 0;
  lib.ALooper_wake = (p, c) => { const looper = looperOf(p, c); looper.woken = true; T(p).schedulePump(); if (looper.main) pumpMain(p); };
  const readyWatches = looper => { const out = []; for (const [fd, w] of looper.watches) { const o = objectOrFile(fd), got = o ? events(o) & (w.events | POLLERR | POLLHUP) : POLLERR; if (got) out.push([fd, w, got]); } return out; };
  const runCallback = (p, looper, fd, w, got) => { const keep = Number(BigInt.asIntN(32, p.call(w.callback, [fd, got, w.data]))); if (!keep && looper.watches.get(fd) === w) looper.watches.delete(fd); };
  const timerWake = fds => { let at = Infinity; for (const fd of fds) { const o = objects.get(fd); if (o?.kind === 'timerfd') at = Math.min(at, o.next); } return at; };
  const pollOnce = (p, c, all) => {
    const looper = currentLooper(p); if (!looper) throw new APKError('ARM64 native code called ALooper_pollOnce on a thread without a looper (ALooper_prepare was not called)', { kind: 'arm64-looper' });
    const timeout = s32(c, 0), outFd = n(c, 1), outEvents = n(c, 2), outData = n(c, 3), t = T(p).current;
    if (t.pollDeadline === undefined) t.pollDeadline = timeout < 0 ? Infinity : T(p).now() + timeout;
    const deadline = t.pollDeadline;
    for (;;) {
      const r = waitFor(p, c, () => looper.woken || readyWatches(looper).length > 0 || T(p).now() >= deadline, 'ALooper_pollOnce', deadline, false, () => timerWake(looper.watches.keys()));
      if (r === BLOCKED) return BLOCKED;
      if (looper.woken) { looper.woken = false; t.pollDeadline = undefined; return -1; }   // ALOOPER_POLL_WAKE
      const ready = readyWatches(looper);
      if (!ready.length) { t.pollDeadline = undefined; return -3; }                       // ALOOPER_POLL_TIMEOUT
      let calledBack = false;
      for (const [fd, w, got] of ready) {
        if (w.callback) { runCallback(p, looper, fd, w, got); calledBack = true; continue; }
        if (outFd) p.memory.writeU32(outFd, fd); if (outEvents) p.memory.writeU32(outEvents, got); if (outData) p.memory.write64(outData, BigInt.asUintN(64, w.data));
        t.pollDeadline = undefined; return w.ident;
      }
      if (calledBack && !all) { t.pollDeadline = undefined; return -2; }                  // ALOOPER_POLL_CALLBACK
    }
  };
  lib.ALooper_pollOnce = (p, c) => pollOnce(p, c, false);
  lib.ALooper_pollAll = (p, c) => pollOnce(p, c, true);
  // the main looper: dispatched from the VM's event loop when one of its descriptors can be ready (a write to a pipe/eventfd, a timer, a wake, or network data)
  let mainQueued = false;
  function pumpMain(p, delay = 0) {
    const looper = byThread.get('main'); if (!looper || mainQueued || !T(p).queueTask) return;
    mainQueued = true;
    T(p).queueTask(() => {
      mainQueued = false; looper.woken = false;
      for (const [fd, w, got] of readyWatches(looper)) if (w.callback) runCallback(p, looper, fd, w, got);
      let next = Infinity, network = false;
      for (const fd of looper.watches.keys()) { const o = objects.get(fd); if (o?.kind === 'timerfd') next = Math.min(next, o.next); if (o?.kind === 'tcp') network = true; }
      if (next !== Infinity && next > T(p).now()) pumpMain(p, next - T(p).now()); else if (network) pumpMain(p, 4);
    }, delay);
  }
  void EISCONN; void x;
  return lib;
}
