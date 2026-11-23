// Sockets and event-loop primitives for the ARM64 process (docs/ARM64-NATIVE.md "Network"): TCP streams over the APK Lab Relay's tunnel (src/tcp-tunnel.js, the same
// path java.net.Socket takes), in-process pipes and eventfd counters, and poll / select / epoll over all of them.
// Names: getaddrinfo gives a host name an address from 198.18.0.0/15 (reserved for benchmarking, never routed) and connect() to it opens the tunnel by that name, so
// the relay resolves and reaches the real host; a numeric address connects as given. Each mapping is recorded in the trace. Without a relay a connect fails with
// ECONNREFUSED, as Java sockets do. Unix-domain stream sockets work inside the process (socketpair; bind/listen/accept/connect between the process's own sockets; a
// name nobody bound refuses the connection, as on a device). UDP has no path (the relay
// tunnels TCP only): a UDP socket opens, every send fails with ENETUNREACH (recorded) and nothing arrives, as on a network that blocks UDP; QUIC stacks then fall back to TCP. A blocking call waits as a native thread wait (src/arm64/threads.js);
// on the thread that runs Java the network cannot be waited for synchronously, so that call fails by name.
// NETLINK_ROUTE sockets answer the route-information dumps (interfaces, addresses) from the virtual device's interfaces, with Android 11's rules for apps (src/arm64/
// netlink.js); AF_PACKET and raw IP sockets need CAP_NET_RAW, which an app does not have (EPERM). The same functions serve the raw system calls (src/arm64/syscalls.js):
// socket, socketpair, bind, listen, accept/accept4, connect, getsockname, getpeername, sendto, recvfrom, setsockopt, getsockopt, shutdown, sendmsg, recvmsg, sendmmsg,
// recvmmsg, with the kernel's flags (MSG_DONTWAIT, MSG_PEEK, MSG_TRUNC, SOCK_NONBLOCK) and errno values.
import { APKError } from '../apk-error.js?v=cbf1579510f6';
import { createRouteSocket, restrictedNetlink } from './netlink.js?v=cbf1579510f6';
import { createJavaSockets } from './java-sockets.js?v=cbf1579510f6';
import { deviceInterfaces, allocateFd, release } from '../libcore-io-native.js?v=cbf1579510f6';
import { BLOCKED } from './cpu.js?v=cbf1579510f6';
import { tunnelEndpoint, openTunnelSession } from '../tcp-tunnel.js?v=cbf1579510f6';
import { utf8 } from './text.js?v=cbf1579510f6';

const ENETUNREACH = 101, ENOENT = 2, EADDRINUSE = 98, EOPNOTSUPP = 95, EAGAIN = 11, EBADF = 9, EINPROGRESS = 115, ECONNREFUSED = 111, ENOTCONN = 107, EPIPE = 32, EINVAL = 22, EISCONN = 106;
const POLLIN = 1, POLLOUT = 4, POLLERR = 8, POLLHUP = 16, O_NONBLOCK = 0o4000;
const EPERM = 1, EACCES = 13, ENODEV = 19, ENOTSOCK = 88, ESOCKTNOSUPPORT = 94, EAFNOSUPPORT = 97;
const MSG_PEEK = 2, MSG_TRUNC = 0x20, MSG_DONTWAIT = 0x40, MSG_WAITFORONE = 0x10000, SOCK_NONBLOCK = 0o4000, SOCK_CLOEXEC = 0o2000000, MSGHDR = 56, MMSGHDR = 64;

export function addSockets(lib, { runtime } = {}) {
  const n = (c, i) => Number(c.x[i]), s32 = (c, i) => Number(BigInt.asIntN(32, c.x[i])), x = (c, i) => c.x[i];
  const objects = new Map(); let nextFd = 1000;
  // fork (src/arm64/processes.js): the child's descriptors are the parent's open descriptions (a pipe or socket shared by both: each descriptor counts in `refs`)
  lib.__socketTable = () => ({ objects, nextFd });
  lib.__adoptSockets = from => { const table = from.__socketTable(); for (const [fd, o] of table.objects) { o.refs = (o.refs ?? 1) + 1; objects.set(fd, o); } nextFd = table.nextFd; };
  { const files = lib.__ownsFd; lib.__ownsFd = fd => objects.has(fd) || !!files?.(fd); }
  const names = new Map(), byAddress = new Map();
  const fail = (p, errno) => { p.memory.writeU32(p.errnoAddress, errno); return 0xffffffffffffffffn; };
  const unsupported = what => { throw new APKError(`ARM64 native code: ${what} is not provided by the lab`, { kind: 'arm64-network' }); };
  const T = p => p.threads;
  // the sockets and pipes Java opened (src/arm64/java-sockets.js): objects of kind 'java' over libcore's open description, found by their descriptor number
  const javaSockets = createJavaSockets(runtime), javaOf = fd => objects.has(fd) ? null : javaSockets.of(fd), lookup = fd => objects.get(fd) ?? javaOf(fd);
  // ---- readiness, shared by read/recv, poll, select and epoll
  const expirations = o => { const now = o.now ? o.now() : performance.now(); if (now < o.next) return 0; return o.interval ? 1 + Math.floor((now - o.next) / o.interval) : 1; };   // o.now: the native threads' clock (timerfd_create)
  const readable = o => o.kind === 'java' ? !!(javaSockets.revents(o, POLLIN) & (POLLIN | POLLHUP | POLLERR)) : o.kind === 'unix' ? (o.listening ? o.backlog.length > 0 : !!o.rx && (o.rx.bytes.length > 0 || o.rx.closed)) : o.kind === 'tcp' ? (o.session && (o.session.queue.length > 0 || o.session.closed || !!o.session.error)) : o.kind === 'pipe-read' ? (o.pipe.bytes.length > 0 || o.pipe.closed) : o.kind === 'eventfd' ? o.count > 0n : o.kind === 'timerfd' ? expirations(o) > 0 : o.kind === 'netlink' ? o.route.datagrams.length > 0 : o.kind === 'unixdgram' ? o.queue.length > 0 : o.kind === 'file' ? true : false;
  const writable = o => o.kind === 'java' ? !!(javaSockets.revents(o, POLLOUT) & POLLOUT) : o.kind === 'udp' || o.kind === 'netlink' || o.kind === 'unixdgram' ? true : o.kind === 'unix' ? !!o.tx && !o.tx.closed : o.kind === 'tcp' ? !!o.session?.connected && !o.session.closed : o.kind === 'pipe-write' ? true : o.kind === 'eventfd' ? true : o.kind === 'file' ? true : false;
  const events = o => o.kind === 'java' ? javaSockets.revents(o, POLLIN | POLLOUT) : (readable(o) ? POLLIN : 0) | (writable(o) ? POLLOUT : 0) | (o.kind === 'tcp' && o.session?.error ? POLLERR : 0) | (o.kind === 'tcp' && o.session?.closed ? POLLHUP : 0);
  const waitFor = (p, c, ready, what, deadline = Infinity, network = true, wakeAt = null) => {
    if (ready()) return true;
    if (network && !T(p).canSuspend(c) && T(p).current.main) throw new APKError(`ARM64 native code waits for ${what} on the thread that runs Java: the network cannot be waited for there (use a native thread)`, { kind: 'arm64-network' });
    return T(p).wait(c, ready, { what, deadline, wakeAt });
  };
  // ---- addresses
  const resolve = name => { if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return name; if (!names.has(name)) { const i = names.size + 1, ip = `198.18.${(i >> 8) & 255}.${i & 255}`; names.set(name, ip); byAddress.set(ip, name); runtime?.record?.(`NET native getaddrinfo ${name} -> ${ip} (placeholder; the relay resolves the name at connect)`); } return names.get(name); };
  const writeSockaddr = (p, ptr, ip, port) => { p.memory.fill(ptr, 0, 16); p.memory.setUint16(ptr, 2); p.memory.setUint16(ptr + 2, port, false); ip.split('.').forEach((b, i) => { p.memory.setByte(ptr + 4 + i, Number(b)); }); };
  const readSockaddr = (p, ptr) => { const family = p.memory.uint16(ptr); if (family !== 2) unsupported(family === 10 ? 'an IPv6 address in connect()' : `address family ${family}`); return { ip: [...p.memory.bytes(ptr + 4, 4)].join('.'), port: p.memory.uint16(ptr + 2, false) }; };
  lib.getaddrinfo = (p, c) => {
    const node = n(c, 0) ? utf8.decode(p.memory.cString(n(c, 0))) : '127.0.0.1', service = n(c, 1) ? utf8.decode(p.memory.cString(n(c, 1))) : '0', hints = n(c, 2);
    const socktype = hints ? p.memory.int32(hints + 8) : 0, family = hints ? p.memory.int32(hints + 4) : 0;
    if (family === 10) return 8;   // EAI_ADDRFAMILY: only IPv4 here
    const ip = resolve(node), port = Number(service) || { http: 80, https: 443 }[service] || 0, info = p.malloc(48), addr = p.malloc(16);
    writeSockaddr(p, addr, ip, port);
    p.memory.fill(info, 0, 48); p.memory.setInt32(info + 4, 2); p.memory.setInt32(info + 8, socktype || 1); p.memory.setInt32(info + 12, 6); p.memory.writeU32(info + 16, 16); p.memory.writePtr(info + 32, addr);   // bionic struct addrinfo: flags, family, socktype, protocol, addrlen @16, canonname @24, addr @32, next @40
    p.memory.writePtr(n(c, 3), info); return 0;
  };
  lib.freeaddrinfo = (p, c) => { let info = n(c, 0); while (info) { const next = p.memory.readPtr(info + 40); p.free(p.memory.readPtr(info + 32)); p.free(info); info = next; } };
  lib.gai_strerror = (p, c) => p.allocString(`getaddrinfo error ${s32(c, 0)}`);
  // inet_pton / inet_ntop for AF_INET and AF_INET6 (RFC 5952 text: the longest run of zero groups as "::", a v4-mapped or compatible address with its IPv4 tail, as bionic prints them)
  const v4Text = bytes => [...bytes].join('.');
  const v6Text = bytes => {
    const groups = []; for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);
    if (groups.slice(0, 5).every(g => g === 0) && (groups[5] === 0xffff || (groups[5] === 0 && groups[6] !== 0))) return (groups[5] === 0xffff ? '::ffff:' : '::') + v4Text(bytes.subarray(12));
    let best = -1, length = 0; for (let i = 0; i < 8; ) { if (groups[i] !== 0) { i++; continue; } let k = i; while (k < 8 && groups[k] === 0) k++; if (k - i > length && k - i > 1) { best = i; length = k - i; } i = k; }
    const hex = groups.map(g => g.toString(16)); if (best < 0) return hex.join(':');
    return hex.slice(0, best).join(':') + '::' + hex.slice(best + length).join(':');
  };
  const parseV4 = text => { const parts = text.split('.'); if (parts.length !== 4 || parts.some(v => !/^\d{1,3}$/.test(v) || Number(v) > 255)) return null; return parts.map(Number); };
  const parseV6 = text => {
    let tail = []; const lastColon = text.lastIndexOf(':'); if (text.includes('.')) { tail = parseV4(text.slice(lastColon + 1)); if (!tail) return null; text = text.slice(0, lastColon + 1) + '0:0'; }
    const halves = text.split('::'); if (halves.length > 2) return null;
    const groups = half => half === '' ? [] : half.split(':'); const head = groups(halves[0]), rest = halves.length === 2 ? groups(halves[1]) : [];
    if ([...head, ...rest].some(g => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
    const missing = 8 - head.length - rest.length; if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
    const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest].map(g => parseInt(g, 16)), out = [];
    for (const g of all) out.push(g >> 8, g & 255); if (tail.length) out.splice(12, 4, ...tail); return out;
  };
  lib.inet_pton = (p, c) => { const family = s32(c, 0), text = utf8.decode(p.memory.cString(n(c, 1))); if (family !== 2 && family !== 10) { p.memory.writeU32(p.errnoAddress, EAFNOSUPPORT); return -1; } const bytes = family === 2 ? parseV4(text) : parseV6(text); if (!bytes) return 0; bytes.forEach((b, i) => { p.memory.setByte(n(c, 2) + i, b); }); return 1; };
  lib.inet_ntop = (p, c) => {
    const family = s32(c, 0); if (family !== 2 && family !== 10) { p.memory.writeU32(p.errnoAddress, EAFNOSUPPORT); return 0; }
    const text = family === 2 ? v4Text(p.memory.bytes(n(c, 1), 4)) : v6Text(p.memory.bytes(n(c, 1), 16)), bytes = new TextEncoder().encode(text);
    if (bytes.length + 1 > n(c, 3)) { p.memory.writeU32(p.errnoAddress, 28); return 0; }   // ENOSPC
    p.memory.copyIn(n(c, 2), bytes); p.memory.setByte(n(c, 2) + bytes.length, 0); return n(c, 2);
  };
  lib.inet_addr = (p, c) => { const parts = utf8.decode(p.memory.cString(n(c, 0))).split('.').map(Number); return parts.length === 4 ? (parts[0] | parts[1] << 8 | parts[2] << 16 | parts[3] << 24) >>> 0 : 0xffffffff; };
  lib.htons = lib.ntohs = (p, c) => ((n(c, 0) & 0xff) << 8) | ((n(c, 0) >> 8) & 0xff);
  lib.htonl = lib.ntohl = (p, c) => { const v = n(c, 0) >>> 0; return (((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | (v >>> 24)) >>> 0; };
  lib.if_nametoindex = (p, c) => deviceInterfaces(runtime).find(face => face.name === utf8.decode(p.memory.cString(n(c, 0))))?.index ?? 0;
  lib.if_indextoname = (p, c) => { const face = deviceInterfaces(runtime).find(f => f.index === s32(c, 0)); if (!face) return fail(p, 6) && 0; const bytes = new TextEncoder().encode(face.name); p.memory.copyIn(n(c, 1), bytes); p.memory.setByte(n(c, 1) + bytes.length, 0); return n(c, 1); };   // ENXIO
  // ---- sockets
  lib.socket = (p, c) => {
    const domain = s32(c, 0), type = s32(c, 1) & 0xf, flags = s32(c, 1), protocol = s32(c, 2), common = { domain, type, protocol, nonblocking: !!(flags & SOCK_NONBLOCK), cloexec: !!(flags & SOCK_CLOEXEC) };
    if (domain === 1 && type === 2) { const fd = nextFd++; objects.set(fd, { kind: 'unixdgram', queue: [], peer: null, name: null, ...common }); return fd; }   // SOCK_DGRAM: datagrams between the process's own sockets
    if (domain === 1) { if (type !== 1 && type !== 5) return fail(p, ESOCKTNOSUPPORT); const fd = nextFd++; objects.set(fd, { kind: 'unix', rx: null, tx: null, ...common }); return fd; }
    if (domain === 16) {   // AF_NETLINK
      if (type !== 3 && type !== 2) return fail(p, ESOCKTNOSUPPORT);
      if (protocol !== 0) unsupported(`a netlink socket of protocol ${protocol} (NETLINK_ROUTE is provided)`);
      const fd = nextFd++; objects.set(fd, { kind: 'netlink', route: createRouteSocket(runtime, p.pid), ...common }); return fd;
    }
    if (domain === 17) return fail(p, EPERM);   // AF_PACKET: CAP_NET_RAW, which an app does not have
    if (domain !== 2 && domain !== 10) { if (domain <= 0 || domain > 45) return fail(p, EAFNOSUPPORT); unsupported(`socket domain ${domain}`); }
    if (type === 3) return fail(p, EPERM);   // SOCK_RAW: CAP_NET_RAW
    if (type === 2) { const fd = nextFd++; objects.set(fd, { kind: 'udp', ...common }); return fd; }
    if (type !== 1) return fail(p, ESOCKTNOSUPPORT);
    const fd = nextFd++; objects.set(fd, { kind: 'tcp', session: null, host: null, port: 0, ...common }); return fd;
  };
  lib.connect = (p, c) => {
    const o = objects.get(s32(c, 0)); if (!o) return fail(p, EBADF);
    if (o.kind === 'unix') return unixConnect(p, c, o);
    if (o.kind === 'unixdgram') { const target = dgramTarget(p, n(c, 1), n(c, 2), 'connect'); if (typeof target === 'bigint') return target; o.peer = target; return 0; }
    if (o.kind === 'udp') { const family = p.memory.uint16(n(c, 1)); if (family === 2) { const { ip, port } = readSockaddr(p, n(c, 1)); o.peer = `${byAddress.get(ip) ?? ip}:${port}`; } return 0; }   // UDP connect only sets the peer
    if (!o.session) {
      const policy = runtime?.platform?.networkPolicy ?? runtime?.network?.policy, { ip, port } = readSockaddr(p, n(c, 1)), host = byAddress.get(ip) ?? ip, endpoint = tunnelEndpoint(policy);
      Object.assign(o, { host, port });
      if (!endpoint) { runtime?.record?.(`NET native connect ${host}:${port}: no relay configured (a browser cannot open TCP): ECONNREFUSED`); return fail(p, ECONNREFUSED); }
      runtime?.record?.(`NET native connect ${host}:${port} through the relay tunnel`);
      const Socket = policy?.WebSocket ?? globalThis.WebSocket;   // the realm's WebSocket, or the one the network policy names (as java.net.Socket's tunnel takes it: src/network-native.js)
      o.session = openTunnelSession({ endpoint, host, port, create: url => new Socket(url), signal: () => T(p).schedulePump() });
      if (o.nonblocking) return fail(p, EINPROGRESS);
    }
    const r = waitFor(p, c, () => o.session.connected || !!o.session.error, `the connection to ${o.host}:${o.port}`);
    if (r === BLOCKED) return BLOCKED;
    return o.session.error ? fail(p, ECONNREFUSED) : 0;
  };
  // ---- the data path of every socket kind: what send/sendto/sendmsg/write give, what recv/recvfrom/recvmsg/read take
  /** Sends `bytes` on socket `o`: the count sent, or fail(errno). */
  const sendData = (p, o, bytes, to = null, c = null) => {
    if (o.kind === 'java') {
      const r = javaSockets.send(o, bytes);
      if (r.wait) { if (!c) return fail(p, EAGAIN); const got = waitFor(p, c, r.wait, r.what, Infinity, r.network); if (got === BLOCKED) return BLOCKED; return sendData(p, o, bytes, to, c); }
      return r.errno ? fail(p, r.errno) : r.count;
    }
    if (o.kind === 'udp') return udpSend(p, o);
    if (o.kind === 'unixdgram') {   // to the address given, else the connected peer; a datagram longer than the receive queue's room is EMSGSIZE on a device (not reached here)
      const target = to ?? o.peer; if (!target) return fail(p, ENOTCONN); if (target.closed) return fail(p, ECONNREFUSED);
      target.queue.push({ bytes: bytes.slice(), from: o.name }); T(p).schedulePump(); pumpMain(p); return bytes.length;
    }
    if (o.kind === 'netlink') { const errno = o.route.request(bytes); return errno ? fail(p, errno) : bytes.length; }
    if (o.kind === 'unix') {
      if (!o.tx) return fail(p, o.listening ? ENOTCONN : ENOTCONN); if (o.tx.closed) return fail(p, EPIPE);
      const next = new Uint8Array(o.tx.bytes.length + bytes.length); next.set(o.tx.bytes); next.set(bytes, o.tx.bytes.length); o.tx.bytes = next; T(p).schedulePump(); pumpMain(p); return bytes.length;
    }
    if (o.kind !== 'tcp') return fail(p, ENOTSOCK);
    if (!o.session?.connected) return fail(p, o.session?.error ? ECONNREFUSED : ENOTCONN);
    if (o.session.closed) return fail(p, EPIPE);
    o.session.send(bytes.slice()); return bytes.length;
  };
  /**
   * Receives at most `max` bytes from socket `o` (`flags`: MSG_DONTWAIT, MSG_PEEK): { bytes, length } where `length` is the whole datagram's (a netlink datagram longer
   * than `max` is cut, the rest discarded, as the kernel does), or fail(errno), or BLOCKED (the thread waits; the call is made again).
   */
  const recvData = (p, c, o, max, flags) => {
    if (o.kind === 'java') {
      const r = javaSockets.recv(o, max, flags);
      if (r.wait) { const got = waitFor(p, c, r.wait, r.what, Infinity, r.network); if (got === BLOCKED) return BLOCKED; return recvData(p, c, o, max, flags); }
      return r.errno ? fail(p, r.errno) : r;
    }
    if (o.kind === 'udp') return udpReceive(p, c, o, flags);
    if (o.kind === 'tcp' && !o.session) return fail(p, ENOTCONN);
    if (o.kind === 'unix' && !o.rx) return fail(p, ENOTCONN);
    if (o.kind !== 'tcp' && o.kind !== 'unix' && o.kind !== 'netlink' && o.kind !== 'unixdgram') return fail(p, ENOTSOCK);
    if (!readable(o)) {
      if (o.nonblocking || (flags & MSG_DONTWAIT)) return fail(p, EAGAIN);
      const what = o.kind === 'tcp' ? `data from ${o.host}:${o.port}` : o.kind === 'unix' ? 'a Unix-domain socket' : o.kind === 'unixdgram' ? `a datagram on unix:${o.name ?? '(unnamed)'}` : 'a netlink answer';
      const r = waitFor(p, c, () => readable(o), what, Infinity, o.kind === 'tcp'); if (r === BLOCKED) return BLOCKED;
    }
    const peek = !!(flags & MSG_PEEK);
    if (o.kind === 'netlink') { const datagram = peek ? o.route.datagrams[0] : o.route.datagrams.shift(); return { bytes: datagram.subarray(0, max), length: datagram.length }; }
    if (o.kind === 'unixdgram') { const datagram = peek ? o.queue[0] : o.queue.shift(); o.lastFrom = datagram.from; return { bytes: datagram.bytes.subarray(0, max), length: datagram.bytes.length }; }
    if (o.kind === 'unix') { const bytes = o.rx.bytes.slice(0, max); if (!peek) { o.rx.bytes = o.rx.bytes.slice(bytes.length); T(p).schedulePump(); } return { bytes, length: bytes.length }; }
    if (o.session.error && !o.session.queue.length) return fail(p, ECONNREFUSED);
    const out = new Uint8Array(Math.min(max, o.session.queue.reduce((k, chunk) => k + chunk.length, 0))); let copied = 0;
    for (let i = 0; copied < out.length && i < o.session.queue.length; ) {
      const chunk = o.session.queue[i], take = Math.min(chunk.length, out.length - copied); out.set(chunk.subarray(0, take), copied); copied += take;
      if (peek) { i++; continue; }
      if (take === chunk.length) o.session.queue.shift(); else o.session.queue[0] = chunk.subarray(take);
    }
    return { bytes: out, length: out.length };
  };
  const settled = r => r === BLOCKED || typeof r === 'bigint';   // a wait, or fail()'s value
  /** The address of the other end, as recvfrom/recvmsg/accept/getpeername give it: [bytes, length] (a netlink message comes from the kernel, port 0). */
  const peerAddress = o => {
    if (o.kind === 'java') return new Uint8Array(0);   // a connected stream gives no source address (msg_namelen 0)
    if (o.kind === 'netlink') { const b = new Uint8Array(12); b[0] = 16; return b; }   // struct sockaddr_nl: AF_NETLINK, pid 0, groups 0
    if (o.kind === 'unix') return unixAddress(o.peerName ?? null);
    if (o.kind === 'unixdgram') return unixAddress(o.lastFrom !== undefined ? o.lastFrom : o.peer?.name ?? null);   // recvfrom: the sender's name; getpeername: the connected peer's
    const b = new Uint8Array(16), ip = names.get(o.host) ?? o.host ?? '0.0.0.0'; b[0] = 2; b[2] = (o.port >> 8) & 255; b[3] = o.port & 255; String(ip).split('.').forEach((part, i) => { b[4 + i] = Number(part) & 255; }); return b;
  };
  const unixAddress = name => {   // struct sockaddr_un: AF_UNIX and the name (an abstract name starts with a NUL); unnamed: the family alone
    if (name === null) return Uint8Array.of(1, 0);
    const text = new TextEncoder().encode(name.startsWith('@') ? name.slice(1) : name), b = new Uint8Array(2 + (name.startsWith('@') ? 1 : 0) + text.length + (name.startsWith('@') ? 0 : 1));
    b[0] = 1; b.set(text, name.startsWith('@') ? 3 : 2); return b;
  };
  /** Writes `address` to (ptr, lenPtr) as the kernel does: at most *lenPtr bytes, and *lenPtr becomes the address's whole length. */
  const putAddress = (p, ptr, lenPtr, address) => { if (!ptr || !lenPtr) return; const room = p.memory.readU32(lenPtr); p.memory.copyIn(ptr, address.subarray(0, Math.min(room, address.length))); p.memory.writeU32(lenPtr, address.length); };
  const socketOf = (p, fd) => lookup(fd) ?? null;
  lib.send = (p, c) => { const o = socketOf(p, s32(c, 0)); return o ? sendData(p, o, p.memory.bytes(n(c, 1), n(c, 2)), null, c) : fail(p, EBADF); };
  lib.sendto = (p, c) => {   // the destination of a connected stream socket is ignored (Linux: EISCONN only for some kinds); a UDP datagram has nowhere to go anyway
    const o = socketOf(p, s32(c, 0)); if (!o) return fail(p, EBADF);
    if (o.kind === 'udp' && n(c, 4) && p.memory.uint16(n(c, 4)) === 2) { const { ip, port } = readSockaddr(p, n(c, 4)); o.peer ??= `${byAddress.get(ip) ?? ip}:${port}`; }
    if (o.kind === 'unixdgram' && n(c, 4)) { const target = dgramTarget(p, n(c, 4), n(c, 5), 'sendto'); if (typeof target === 'bigint') return target; return sendData(p, o, p.memory.bytes(n(c, 1), n(c, 2)), target); }
    return sendData(p, o, p.memory.bytes(n(c, 1), n(c, 2)), null, c);
  };
  lib.recv = (p, c) => lib.recvfrom(p, { x: [c.x[0], c.x[1], c.x[2], c.x[3], 0n, 0n], where: c.where });
  lib.recvfrom = (p, c) => {
    const o = socketOf(p, s32(c, 0)); if (!o) return fail(p, EBADF);
    const flags = s32(c, 3), r = recvData(p, c, o, n(c, 2), flags); if (settled(r)) return r;
    p.memory.copyIn(n(c, 1), r.bytes); putAddress(p, n(c, 4), n(c, 5), peerAddress(o));
    return flags & MSG_TRUNC ? r.length : r.bytes.length;
  };
  // struct msghdr (arm64): msg_name @0, msg_namelen @8, msg_iov @16, msg_iovlen @24, msg_control @32, msg_controllen @40, msg_flags @48; struct iovec: base @0, len @8
  const iovecs = (p, msg) => { const iov = p.memory.readPtr(msg + 16), count = Number(p.memory.read64(msg + 24)), out = []; for (let i = 0; i < count; i++) out.push({ base: p.memory.readPtr(iov + 16 * i), length: Number(p.memory.read64(iov + 16 * i + 8)) }); return out; };
  const sendMessage = (p, o, msg, c = null) => {
    if (Number(p.memory.read64(msg + 40)) > 0) unsupported(`ancillary data in sendmsg on a ${o.kind} socket (SCM_RIGHTS / SCM_CREDENTIALS)`);
    const parts = iovecs(p, msg).map(v => p.memory.bytes(v.base, v.length)), bytes = new Uint8Array(parts.reduce((k, b) => k + b.length, 0)); let at = 0; for (const b of parts) { bytes.set(b, at); at += b.length; }
    const name = p.memory.readPtr(msg); if (o.kind === 'unixdgram' && name) { const target = dgramTarget(p, name, p.memory.readU32(msg + 8), 'sendmsg'); if (typeof target === 'bigint') return target; return sendData(p, o, bytes, target); }
    return sendData(p, o, bytes, null, c);
  };
  const recvMessage = (p, c, o, msg, flags) => {
    const vectors = iovecs(p, msg), r = recvData(p, c, o, vectors.reduce((k, v) => k + v.length, 0), flags); if (settled(r)) return r;
    let at = 0; for (const v of vectors) { if (at >= r.bytes.length) break; const take = Math.min(v.length, r.bytes.length - at); p.memory.copyIn(v.base, r.bytes.subarray(at, at + take)); at += take; }
    const name = p.memory.readPtr(msg); if (name) { const address = peerAddress(o), room = p.memory.readU32(msg + 8); p.memory.copyIn(name, address.subarray(0, Math.min(room, address.length))); p.memory.writeU32(msg + 8, address.length); }
    p.memory.write64(msg + 40, 0n); p.memory.writeU32(msg + 48, r.length > r.bytes.length ? MSG_TRUNC : 0);   // no ancillary data; MSG_TRUNC for a cut datagram
    return flags & MSG_TRUNC ? r.length : r.bytes.length;
  };
  lib.sendmsg = (p, c) => { const o = socketOf(p, s32(c, 0)); return o ? sendMessage(p, o, n(c, 1), c) : fail(p, EBADF); };
  lib.recvmsg = (p, c) => { const o = socketOf(p, s32(c, 0)); return o ? recvMessage(p, c, o, n(c, 1), s32(c, 2)) : fail(p, EBADF); };
  // struct mmsghdr: a msghdr and msg_len @56, 64 bytes. The count of messages done; an error only when the first one fails. recvmmsg waits for the first message only
  // (what MSG_WAITFORONE asks); the rest are the ones already there.
  lib.sendmmsg = (p, c) => {
    const o = socketOf(p, s32(c, 0)); if (!o) return fail(p, EBADF);
    const vec = n(c, 1), count = n(c, 2); let done = 0;
    for (; done < count; done++) { const r = sendMessage(p, o, vec + MMSGHDR * done); if (typeof r === 'bigint') { if (done === 0) return r; break; } p.memory.writeU32(vec + MMSGHDR * done + MSGHDR, Number(r)); }
    return done;
  };
  lib.recvmmsg = (p, c) => {
    const o = socketOf(p, s32(c, 0)); if (!o) return fail(p, EBADF);
    const vec = n(c, 1), count = n(c, 2), flags = s32(c, 3); let done = 0;
    for (; done < count; done++) {
      const r = recvMessage(p, c, o, vec + MMSGHDR * done, done === 0 ? flags & ~MSG_WAITFORONE : flags | MSG_DONTWAIT);
      if (r === BLOCKED) return BLOCKED;
      if (typeof r === 'bigint') { if (done === 0) return r; break; }
      p.memory.writeU32(vec + MMSGHDR * done + MSGHDR, Number(r));
    }
    return done;
  };
  // UDP: no datagram leaves or arrives (the relay carries TCP only)
  const udpSend = (p, o) => { if (!o.reported) { o.reported = true; runtime?.record?.(`NET native UDP send${o.peer ? ` to ${o.peer}` : ''}: ENETUNREACH (the lab's network path is the relay's TCP tunnel; no UDP)`); } return fail(p, ENETUNREACH); };
  const udpReceive = (p, c, o, flags = 0) => { if (o.nonblocking || (flags & MSG_DONTWAIT)) return fail(p, EAGAIN); const r = waitFor(p, c, () => false, 'a UDP datagram (none can arrive: the lab has no UDP path)', Infinity, false); return r === BLOCKED ? BLOCKED : fail(p, EAGAIN); };
  // ---- socket options (SOL_SOCKET answers from the socket; the others as set): what setsockopt stored, the kernel's defaults otherwise
  const SOL_SOCKET = 1, SO_TYPE = 3, SO_ERROR = 4, SO_SNDBUF = 7, SO_RCVBUF = 8, SO_ACCEPTCONN = 30, SO_PROTOCOL = 38, SO_DOMAIN = 39, BUFFER_DEFAULT = 212992;
  lib.setsockopt = (p, c) => {
    const o = socketOf(p, s32(c, 0)); if (!o) return fail(p, EBADF);
    if (o.kind === 'java') { if (n(c, 4) > 0 && !n(c, 3)) return fail(p, 14); const r = javaSockets.setsockopt(o, s32(c, 1), s32(c, 2), p.memory.bytes(n(c, 3), n(c, 4)).slice()); return r?.errno ? fail(p, r.errno) : 0; }
    const level = s32(c, 1), name = s32(c, 2), length = n(c, 4); if (length > 0 && !n(c, 3)) return fail(p, 14);   // EFAULT
    let bytes = p.memory.bytes(n(c, 3), length).slice();
    if (level === SOL_SOCKET && (name === SO_SNDBUF || name === SO_RCVBUF) && length >= 4) { const v = new DataView(bytes.buffer); v.setInt32(0, Math.min(2 * v.getInt32(0, true), 0x7fffffff), true); }   // the kernel doubles the size asked for
    if (level === SOL_SOCKET && [SO_TYPE, SO_ERROR, SO_DOMAIN, SO_PROTOCOL, SO_ACCEPTCONN].includes(name)) return fail(p, 92);   // ENOPROTOOPT: read-only options
    (o.options ??= new Map()).set(`${level}:${name}`, bytes); return 0;
  };
  lib.getsockopt = (p, c) => {
    const o = socketOf(p, s32(c, 0)); if (!o) return fail(p, EBADF);
    if (o.kind === 'java') { const value = javaSockets.getsockopt(o, s32(c, 1), s32(c, 2)); if (value.errno) return fail(p, value.errno); const lenPtr = n(c, 4); if (lenPtr) { const room = p.memory.readU32(lenPtr); if (n(c, 3)) p.memory.copyIn(n(c, 3), value.subarray(0, Math.min(room, value.length))); p.memory.writeU32(lenPtr, Math.min(room, value.length)); } return 0; }
    const level = s32(c, 1), name = s32(c, 2), out = n(c, 3), lenPtr = n(c, 4), int = v => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); return b; };
    let value = o.options?.get(`${level}:${name}`) ?? null;
    if (level === SOL_SOCKET) {
      if (name === SO_TYPE) value = int(o.type ?? 1); else if (name === SO_DOMAIN) value = int(o.domain ?? 2); else if (name === SO_PROTOCOL) value = int(o.protocol || (o.kind === 'tcp' ? 6 : o.kind === 'udp' ? 17 : 0));
      else if (name === SO_ACCEPTCONN) value = int(o.listening ? 1 : 0);
      else if (name === SO_ERROR) { value = int(o.session?.error && !o.errorTaken ? ECONNREFUSED : 0); if (o.session?.error) o.errorTaken = true; }   // read once, as the kernel clears it
      else if ((name === SO_SNDBUF || name === SO_RCVBUF) && !value) value = int(BUFFER_DEFAULT);
    }
    value ??= int(0);
    if (lenPtr) { const room = p.memory.readU32(lenPtr); if (out) p.memory.copyIn(out, value.subarray(0, Math.min(room, value.length))); p.memory.writeU32(lenPtr, Math.min(room, value.length)); }
    return 0;
  };
  lib.getsockname = (p, c) => {
    const o = socketOf(p, s32(c, 0)); if (!o) return fail(p, EBADF);
    if (o.kind === 'java') { const r = javaSockets.sockname(o); if (r.errno) return fail(p, r.errno); putAddress(p, n(c, 1), n(c, 2), r); return 0; }
    let address;
    if (o.kind === 'netlink') { address = new Uint8Array(12); address[0] = 16; new DataView(address.buffer).setUint32(4, o.route.pid, true); }
    else if (o.kind === 'unix' || o.kind === 'unixdgram') address = unixAddress(o.name ?? null);
    else {   // the device's address once connected (the relay's tunnel stands for its connection), the wildcard address and port 0 before
      const connected = o.kind === 'tcp' ? !!o.session : !!o.peer, port = connected ? 40000 + (s32(c, 0) % 20000) : 0;
      if (o.domain === 10) { address = new Uint8Array(28); address[0] = 10; address[2] = port >> 8; address[3] = port & 255; if (connected) { address[18] = 0xff; address[19] = 0xff; address.set([10, 0, 2, 15], 20); } }
      else { address = new Uint8Array(16); address[0] = 2; address[2] = port >> 8; address[3] = port & 255; if (connected) address.set([10, 0, 2, 15], 4); }
    }
    putAddress(p, n(c, 1), n(c, 2), address); return 0;
  };
  lib.getpeername = (p, c) => {
    const o = socketOf(p, s32(c, 0)); if (!o) return fail(p, EBADF);
    if (o.kind === 'java') { const r = javaSockets.peername(o); if (r.errno) return fail(p, r.errno); putAddress(p, n(c, 1), n(c, 2), r); return 0; }
    if (o.kind === 'tcp' ? !o.session : o.kind === 'unix' ? !o.rx : o.kind === 'udp' || o.kind === 'unixdgram' ? !o.peer : false) return fail(p, ENOTCONN);
    putAddress(p, n(c, 1), n(c, 2), o.kind === 'unixdgram' ? unixAddress(o.peer.name ?? null) : peerAddress(o)); return 0;
  };
  lib.shutdown = (p, c) => { const o = lookup(s32(c, 0)); if (!o) return fail(p, EBADF); if (s32(c, 1) < 0 || s32(c, 1) > 2) return fail(p, EINVAL); if (o.kind === 'java') { const r = javaSockets.shutdown(o, s32(c, 1)); return r?.errno ? fail(p, r.errno) : 0; } if (o?.kind === 'unix') { const how = s32(c, 1); if (how !== 0 && o.tx) o.tx.closed = true; if (how !== 1 && o.rx) o.rx.closed = true; T(p).schedulePump(); return 0; } o?.session?.close(); return 0; };
  // ---- Unix-domain stream sockets: each connected end reads one in-process byte queue and writes the other's
  const unixNames = new Map(), decoder = utf8;   // bound name ('@' + abstract name, or a path) -> socket
  const unixName = (p, ptr, length) => { const family = p.memory.uint16(ptr); if (family !== 1) return null; const raw = p.memory.bytes(ptr + 2, Math.max(0, length - 2)); if (raw[0] === 0) return '@' + decoder.decode(raw.subarray(1)); const end = raw.indexOf(0); return decoder.decode(end >= 0 ? raw.subarray(0, end) : raw); };
  const queue = () => ({ bytes: new Uint8Array(0), closed: false });
  const connectEnds = (a, b) => { const ab = queue(), ba = queue(); Object.assign(a, { tx: ab, rx: ba }); Object.assign(b, { tx: ba, rx: ab }); };
  /** The datagram socket bound at the sockaddr_un (ptr, length), or fail(): ENOENT for a path no socket has, ECONNREFUSED for a free name, EPROTOTYPE for a stream socket. */
  const dgramTarget = (p, ptr, length, call) => {
    const name = unixName(p, ptr, length); if (name === null) return fail(p, EINVAL);
    const target = unixNames.get(name);
    if (target?.kind === 'unixdgram') return target;
    if (target) return fail(p, 91);   // EPROTOTYPE: a stream socket has that name
    const files = runtime?.platform?.javaIo?.fs?.(), missing = !name.startsWith('@') && !files?.stat?.(name);
    runtime?.record?.(`NET native ${call} unix:${name} (datagram): ${missing ? 'ENOENT' : 'ECONNREFUSED'} (no socket of the process is bound there)`); return fail(p, missing ? ENOENT : ECONNREFUSED);
  };
  const unixConnect = (p, c, o) => {
    if (o.rx) return fail(p, EISCONN);
    const name = unixName(p, n(c, 1), n(c, 2)); if (name === null) return fail(p, EINVAL);
    const listener = unixNames.get(name);
    if (listener?.kind === 'unixdgram') return fail(p, 91);   // EPROTOTYPE
    if (!listener?.listening) { const files = runtime?.platform?.javaIo?.fs?.(); const missing = !name.startsWith('@') && !files?.stat?.(name); runtime?.record?.(`NET native connect unix:${name}: ${missing ? 'ENOENT' : 'ECONNREFUSED'} (no socket of the process listens there)`); return fail(p, missing ? ENOENT : ECONNREFUSED); }
    const peer = { kind: 'unix', rx: null, tx: null, nonblocking: false, domain: 1, type: o.type, peerName: o.name ?? null, name: name }; o.peerName = name; connectEnds(o, peer); listener.backlog.push(peer); T(p).schedulePump(); return 0;
  };
  lib.socketpair = (p, c) => {
    const domain = s32(c, 0), type = s32(c, 1) & 0xf, flags = s32(c, 1); if (domain !== 1) return fail(p, EOPNOTSUPP);
    if (type === 2) { const mk = () => ({ kind: 'unixdgram', queue: [], name: null, domain: 1, type, nonblocking: !!(flags & SOCK_NONBLOCK), cloexec: !!(flags & SOCK_CLOEXEC) }), a = mk(), b = mk(); a.peer = b; b.peer = a; const fa = nextFd++, fb = nextFd++; objects.set(fa, a); objects.set(fb, b); p.memory.writeU32(n(c, 3), fa); p.memory.writeU32(n(c, 3) + 4, fb); return 0; }
    if (type !== 1 && type !== 5) return fail(p, ESOCKTNOSUPPORT);
    const a = { kind: 'unix', domain: 1, type, nonblocking: !!(flags & SOCK_NONBLOCK), cloexec: !!(flags & SOCK_CLOEXEC) }, b = { kind: 'unix', domain: 1, type, nonblocking: !!(flags & SOCK_NONBLOCK), cloexec: !!(flags & SOCK_CLOEXEC) }; connectEnds(a, b);
    const fa = nextFd++, fb = nextFd++; objects.set(fa, a); objects.set(fb, b); p.memory.writeU32(n(c, 3), fa); p.memory.writeU32(n(c, 3) + 4, fb); return 0;
  };
  lib.bind = (p, c) => {
    const o = objects.get(s32(c, 0)); if (!o) return fail(p, EBADF); if (o.kind === 'udp') return 0;
    if (o.kind === 'netlink') {   // struct sockaddr_nl: family, pad, nl_pid @4, nl_groups @8. Denied to apps targeting API 30+ (Android 11)
      if (restrictedNetlink(runtime)) { runtime?.record?.('NET native netlink bind: EACCES (denied to apps targeting API 30+, as on Android 11+)'); return fail(p, EACCES); }
      const pid = p.memory.readU32(n(c, 1) + 4); if (pid) o.route.pid = pid; o.groups = p.memory.readU32(n(c, 1) + 8); return 0;
    }
    if (o.kind !== 'unix' && o.kind !== 'unixdgram') unsupported('a listening TCP socket (bind)');
    const name = unixName(p, n(c, 1), n(c, 2)); if (name === null) return fail(p, EINVAL); if (unixNames.has(name)) return fail(p, EADDRINUSE);
    unixNames.set(name, o); o.name = name; return 0;
  };
  lib.listen = (p, c) => { const o = objects.get(s32(c, 0)); if (!o) return fail(p, EBADF); if (o.kind === 'netlink' || o.kind === 'udp' || o.kind === 'unixdgram') return fail(p, EOPNOTSUPP); if (o.kind !== 'unix') unsupported('a listening TCP socket (listen)'); o.listening = true; o.backlog ??= []; return 0; };
  lib.accept = (p, c) => lib.accept4(p, { x: [c.x[0], c.x[1], c.x[2], 0n], where: c.where });
  lib.accept4 = (p, c) => {
    const o = objects.get(s32(c, 0)); if (!o) return fail(p, EBADF); if (o.kind === 'netlink' || o.kind === 'udp' || o.kind === 'unixdgram') return fail(p, EOPNOTSUPP); if (o.kind !== 'unix') unsupported('a listening TCP socket (accept)'); if (!o.listening) return fail(p, EINVAL);
    if (!o.backlog.length) { if (o.nonblocking) return fail(p, EAGAIN); const r = waitFor(p, c, () => o.backlog.length > 0, `a connection to unix:${o.name}`, Infinity, false); if (r === BLOCKED) return BLOCKED; }
    const peer = o.backlog.shift(), fd = nextFd++, flags = c.x.length > 3 ? s32(c, 3) : 0; peer.nonblocking = !!(flags & SOCK_NONBLOCK); peer.cloexec = !!(flags & SOCK_CLOEXEC); objects.set(fd, peer); putAddress(p, n(c, 1), n(c, 2), unixAddress(peer.peerName ?? null)); return fd;   // accept4's flags
  };
  // ---- pipes and eventfd
  lib.pipe = (p, c) => lib.pipe2(p, { x: [c.x[0], 0n], where: c.where });   // pipe(fds) has no flags: x1 is whatever the caller left there
  lib.pipe2 = (p, c) => { const pipe = { bytes: new Uint8Array(0), closed: false }, r = nextFd++, w = nextFd++; objects.set(r, { kind: 'pipe-read', pipe, nonblocking: !!(n(c, 1) & O_NONBLOCK), cloexec: !!(n(c, 1) & SOCK_CLOEXEC) }); objects.set(w, { kind: 'pipe-write', pipe, nonblocking: !!(n(c, 1) & O_NONBLOCK), cloexec: !!(n(c, 1) & SOCK_CLOEXEC) }); p.memory.writeU32(n(c, 0), r); p.memory.writeU32(n(c, 0) + 4, w); return 0; };
  lib.eventfd = (p, c) => { const fd = nextFd++; objects.set(fd, { kind: 'eventfd', count: BigInt(n(c, 0) >>> 0), nonblocking: !!(n(c, 1) & O_NONBLOCK), semaphore: !!(n(c, 1) & 1) }); return fd; };
  // read/write/close/fcntl on these fds; everything else goes to the file implementation
  const base = { read: lib.read, write: lib.write, close: lib.close, fcntl: lib.fcntl };
  lib.read = (p, c) => {
    const o = lookup(s32(c, 0)); if (!o) return base.read(p, c);
    if (o.kind === 'tcp' || o.kind === 'unix' || o.kind === 'unixdgram' || o.kind === 'netlink' || o.kind === 'udp' || o.kind === 'java') { const r = recvData(p, c, o, n(c, 2), 0); if (settled(r)) return r; p.memory.copyIn(n(c, 1), r.bytes); return r.bytes.length; }
    if (o.kind === 'pipe-read') { if (!readable(o)) { if (o.nonblocking) return fail(p, EAGAIN); const r = waitFor(p, c, () => readable(o), 'a pipe', Infinity, false); if (r === BLOCKED) return BLOCKED; } const take = Math.min(o.pipe.bytes.length, n(c, 2)); p.memory.copyIn(n(c, 1), o.pipe.bytes.subarray(0, take)); o.pipe.bytes = o.pipe.bytes.slice(take); return take; }
    if (o.kind === 'timerfd') { if (!expirations(o)) { if (o.nonblocking) return fail(p, EAGAIN); const r = waitFor(p, c, () => expirations(o) > 0, 'a timerfd', Infinity, false, () => o.next); if (r === BLOCKED) return BLOCKED; } const count = expirations(o); o.next = o.interval ? o.next + count * o.interval : Infinity; p.memory.write64(n(c, 1), BigInt(count)); return 8; }
    if (o.kind === 'eventfd') { if (o.count === 0n) { if (o.nonblocking) return fail(p, EAGAIN); const r = waitFor(p, c, () => o.count > 0n, 'an eventfd', Infinity, false); if (r === BLOCKED) return BLOCKED; } const value = o.semaphore ? 1n : o.count; o.count -= value; p.memory.write64(n(c, 1), value); return 8; }
    return fail(p, EINVAL);
  };
  lib.write = (p, c) => {
    const o = lookup(s32(c, 0)); if (!o) return base.write(p, c);
    if (o.kind === 'tcp' || o.kind === 'unix' || o.kind === 'unixdgram' || o.kind === 'netlink' || o.kind === 'udp' || o.kind === 'java') return sendData(p, o, p.memory.bytes(n(c, 1), n(c, 2)), null, c);
    if (o.kind === 'pipe-write') { if (o.pipe.closed) return fail(p, EPIPE); const add = p.memory.bytes(n(c, 1), n(c, 2)), next = new Uint8Array(o.pipe.bytes.length + add.length); next.set(o.pipe.bytes); next.set(add, o.pipe.bytes.length); o.pipe.bytes = next; T(p).schedulePump(); pumpMain(p); return add.length; }
    if (o.kind === 'eventfd') { o.count += p.memory.read64(n(c, 1)); T(p).schedulePump(); pumpMain(p); return 8; }
    return fail(p, EINVAL);
  };
  lib.close = (p, c) => { const fd = s32(c, 0), o = objects.get(fd); if (!o) return base.close(p, c); if ((o.refs ?? 1) > 1) { o.refs--; objects.delete(fd); return 0; }   // another descriptor still refers to it (dup)
    if (o.kind === 'tcp') o.session?.close(); if (o.kind === 'pipe-write' || o.kind === 'pipe-read') o.pipe.closed = true; if (o.kind === 'unix') { if (o.tx) o.tx.closed = true; if (o.rx) o.rx.closed = true; if (o.name && unixNames.get(o.name) === o) unixNames.delete(o.name); T(p).schedulePump(); }
    if (o.kind === 'unixdgram') { o.closed = true; if (o.name && unixNames.get(o.name) === o) unixNames.delete(o.name); }
    objects.delete(fd); return 0; };
  // F_DUPFD / F_DUPFD_CLOEXEC, F_GETFD / F_SETFD (FD_CLOEXEC), F_GETFL / F_SETFL (O_NONBLOCK; the access mode stays), anything else fails by name
  const javaEntry = fd => runtime.libcoreIo.table.get(fd);
  const javaDup = (o, minimum, cloexec) => { const number = allocateFd(runtime, o.desc, Math.max(0, minimum), cloexec); return number; };
  lib.fcntl = (p, c) => {
    { const fd = s32(c, 0), j = javaOf(fd); if (j) {   // a descriptor Java opened: the flags of libcore's entry and description
      const cmd = s32(c, 1), entry = javaEntry(fd);
      if (cmd === 0 || cmd === 1030) { const number = javaDup(j, n(c, 2), cmd === 1030); return number < 0 ? fail(p, 24) : number; }   // EMFILE
      if (cmd === 1) return entry.cloexec ? 1 : 0; if (cmd === 2) { entry.cloexec = !!(n(c, 2) & 1); return 0; }
      if (cmd === 3) return (j.desc.acc & 3) | (j.desc.nonblock ? O_NONBLOCK : 0);
      if (cmd === 4) { j.desc.nonblock = !!(n(c, 2) & O_NONBLOCK); return 0; }
      throw new APKError(`ARM64 native code called fcntl command ${cmd} on a descriptor Java opened: not provided by the lab`, { kind: 'arm64-network' });
    } }
    const o = objects.get(s32(c, 0)); if (!o) return base.fcntl(p, c); const cmd = s32(c, 1);
    if (cmd === 0 || cmd === 1030) { const fd = nextFd++; o.refs = (o.refs ?? 1) + 1; objects.set(fd, o); return fd; }
    if (cmd === 1) return o.cloexec ? 1 : 0; if (cmd === 2) { o.cloexec = !!(n(c, 2) & 1); return 0; }
    if (cmd === 3) return (o.kind === 'pipe-read' ? 0 : o.kind === 'pipe-write' ? 1 : 2) | (o.nonblocking ? O_NONBLOCK : 0);
    if (cmd === 4) { o.nonblocking = !!(n(c, 2) & O_NONBLOCK); return 0; }
    throw new APKError(`ARM64 native code called fcntl command ${cmd} on a ${o.kind} descriptor: not provided by the lab`, { kind: 'arm64-network' });
  };
  { const own = { dup: lib.dup, dup3: lib.dup3 };   // dup / dup2 / dup3 of a socket, pipe, eventfd, timerfd or epoll descriptor: one open description under two numbers
    const dupTo = (p, oldFd, newFd, flags) => { const o = objects.get(oldFd); if (oldFd === newFd) return flags === null ? newFd : fail(p, EINVAL); if (objects.has(newFd)) lib.close(p, { x: [BigInt(newFd)] }); o.refs = (o.refs ?? 1) + 1; objects.set(newFd, o); return newFd; };
    const javaDupTo = (p, oldFd, newFd, flags) => {   // dup2 / dup3 onto an exact number of libcore's table (closing what was there)
      const j = javaOf(oldFd); if (newFd < 0 || newFd >= 1024) return fail(p, EBADF); if (oldFd === newFd) return flags === null ? newFd : fail(p, EINVAL);
      const table = runtime.libcoreIo.table; if (table.has(newFd)) release(runtime, newFd); else if (objects.has(newFd)) lib.close(p, { x: [BigInt(newFd)] });
      table.set(newFd, { desc: j.desc, cloexec: !!((flags ?? 0) & 0o2000000) }); j.desc.refs++; return newFd;
    };
    lib.dup = (p, c) => { { const j = javaOf(s32(c, 0)); if (j) { const number = javaDup(j, 3, false); return number < 0 ? fail(p, 24) : number; } } const o = objects.get(s32(c, 0)); if (!o) return own.dup(p, c); const fd = nextFd++; o.refs = (o.refs ?? 1) + 1; objects.set(fd, o); return fd; };
    lib.dup2 = (p, c) => objects.has(s32(c, 0)) ? dupTo(p, s32(c, 0), s32(c, 1), null) : javaOf(s32(c, 0)) ? javaDupTo(p, s32(c, 0), s32(c, 1), null) : own.dup(p, c);
    lib.dup3 = (p, c) => objects.has(s32(c, 0)) ? dupTo(p, s32(c, 0), s32(c, 1), s32(c, 2)) : javaOf(s32(c, 0)) ? javaDupTo(p, s32(c, 0), s32(c, 1), s32(c, 2)) : own.dup3(p, c); }
  // ioctl on sockets: FIONREAD, FIONBIO, and the interface queries of struct ifreq (name[16], then the answer @16) over the device's interfaces. SIOCGIFHWADDR is denied
  // to apps targeting API 30+ (Android 11: no hardware addresses). Another request fails by name.
  { const own = lib.ioctl;
    lib.ioctl = (p, c) => {
      const o = lookup(s32(c, 0)); if (!o) return own(p, c);
      const request = n(c, 1) >>> 0, arg = n(c, 2);
      if (o.kind === 'java' && request === 0x541b) { p.memory.writeU32(arg, javaSockets.available(o)); return 0; }   // FIONREAD: what Java's available() sees
      if (o.kind === 'java' && request === 0x5421) { o.desc.nonblock = p.memory.readU32(arg) !== 0; return 0; }   // FIONBIO
      if (request === 0x541b) { const count = o.kind === 'unixdgram' ? o.queue[0]?.bytes.length ?? 0 : o.kind === 'unix' ? o.rx?.bytes.length ?? 0 : o.kind === 'tcp' ? (o.session?.queue ?? []).reduce((k, b) => k + b.length, 0) : o.kind === 'pipe-read' ? o.pipe.bytes.length : o.kind === 'netlink' ? o.route.datagrams[0]?.length ?? 0 : 0; p.memory.writeU32(arg, count); return 0; }   // FIONREAD
      if (request === 0x5421) { o.nonblocking = p.memory.readU32(arg) !== 0; return 0; }   // FIONBIO
      const IFREQ = { 0x8913: 'flags', 0x8921: 'mtu', 0x8933: 'index', 0x8915: 'addr', 0x891b: 'netmask', 0x8919: 'broadcast', 0x8927: 'hwaddr' }, what = IFREQ[request];
      if (!what || !['tcp', 'udp', 'unix', 'unixdgram', 'netlink'].includes(o.kind) && !(o.kind === 'java' && o.desc.kind === 'socket')) throw new APKError(`ARM64 native code called ioctl 0x${request.toString(16)} on a ${o.kind} descriptor: not provided by the lab`, { kind: 'arm64-network' });
      const raw = p.memory.bytes(arg, 16), end = raw.indexOf(0), name = utf8.decode(raw.subarray(0, end < 0 ? 16 : end)), face = deviceInterfaces(runtime).find(f => f.name === name);
      if (!face) return fail(p, ENODEV);
      const at = arg + 16, inet = bytes => { p.memory.fill(at, 0, 16); p.memory.setUint16(at, 2); bytes.forEach((b, i) => { p.memory.setByte(at + 4 + i, b); }); return 0; }, v4 = face.addresses.find(a => a.addr.length === 4);
      if (what === 'flags') { p.memory.setUint16(at, face.flags & 0xffff); return 0; }
      if (what === 'mtu') { p.memory.writeU32(at, face.mtu); return 0; }
      if (what === 'index') { p.memory.writeU32(at, face.index); return 0; }
      if (what === 'hwaddr') { if (restrictedNetlink(runtime)) { runtime?.record?.(`NET native ioctl SIOCGIFHWADDR ${name}: EACCES (denied to apps targeting API 30+, as on Android 11+)`); return fail(p, EACCES); } p.memory.fill(at, 0, 16); p.memory.setUint16(at, name === 'lo' ? 772 : 1); face.mac.forEach((b, i) => { p.memory.setByte(at + 2 + i, b); }); return 0; }
      if (!v4) return fail(p, 99);   // EADDRNOTAVAIL: the interface has no IPv4 address (wlan0 while offline)
      if (what === 'addr') return inet(v4.addr); if (what === 'netmask') return inet(v4.mask);
      return v4.broadcast ? inet(v4.broadcast) : fail(p, 99);
    }; }
  // ---- poll / select / epoll
  const objectOrFile = fd => lookup(fd) ?? (fd >= 0 && fd < 1000 ? { kind: 'file' } : null);
  const networkFd = fd => { const o = lookup(fd); return o?.kind === 'tcp' || (o?.kind === 'java' && javaSockets.network(o)); };   // a wait for it is a wait for the network
  const timespecMs = (p, ptr) => ptr ? Number(p.memory.read64(ptr)) * 1000 + Number(p.memory.read64(ptr + 8)) / 1e6 : -1;   // NULL: no timeout
  lib.ppoll = (p, c) => { const ms = timespecMs(p, n(c, 2)); return lib.poll(p, { x: [c.x[0], c.x[1], BigInt(ms < 0 ? -1 : Math.ceil(ms))], where: c.where }); };   // the signal mask: the lab delivers signals between calls (src/arm64/signals.js)
  lib.poll = lib.__poll_chk = (p, c) => {
    const fds = n(c, 0), count = n(c, 1), timeout = s32(c, 2), deadline = timeout < 0 ? Infinity : T(p).now() + timeout;
    const ready = () => { let k = 0; for (let i = 0; i < count; i++) { const at = fds + 8 * i, o = objectOrFile(p.memory.int32(at)); const wanted = p.memory.int16(at + 4) | POLLERR | POLLHUP, got = o ? events(o) & wanted : 32; p.memory.setInt16(at + 6, got); if (got) k++; } return k; };
    if (ready() || timeout === 0) return ready();
    const r = waitFor(p, c, () => ready() > 0, 'poll()', deadline, [...Array(count).keys()].some(i => networkFd(p.memory.int32(fds + 8 * i))), () => timerWake([...Array(count).keys()].map(i => p.memory.int32(fds + 8 * i)))); if (r === BLOCKED) return BLOCKED; return ready();
  };
  lib.pselect = (p, c) => { const ms = timespecMs(p, n(c, 4)); return selectUntil(p, c, ms < 0 ? Infinity : T(p).now() + ms); };
  lib.select = (p, c) => { const tv = n(c, 4); return selectUntil(p, c, tv ? T(p).now() + Number(p.memory.read64(tv)) * 1000 + Number(p.memory.read64(tv + 8)) / 1000 : Infinity); };   // struct timeval
  const selectUntil = (p, c, deadline) => {
    const nfds = s32(c, 0), sets = [n(c, 1), n(c, 2), n(c, 3)];
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
    const r = waitFor(p, c, () => collect(false) > 0, 'epoll_wait()', deadline, [...e.watched.keys()].some(fd => networkFd(fd)), () => timerWake(e.watched.keys())); if (r === BLOCKED) return BLOCKED; return collect(true);
  };
  // ---- timerfd: a descriptor that becomes readable when its (monotonic or realtime) timer expires; read gives the expirations since the last read
  lib.timerfd_create = (p, c) => { const fd = nextFd++; objects.set(fd, { kind: 'timerfd', clock: s32(c, 0), now: () => T(p).now(), next: Infinity, interval: 0, nonblocking: !!(n(c, 1) & O_NONBLOCK) }); return fd; };
  const spec = (p, at) => Number(p.memory.read64(at)) * 1000 + Number(p.memory.read64(at + 8)) / 1e6;
  const writeSpec = (p, at, ms) => { p.memory.write64(at, BigInt(Math.floor(ms / 1000))); p.memory.write64(at + 8, BigInt(Math.floor((ms % 1000) * 1e6))); };
  const timerOf = (p, c) => { const o = objects.get(s32(c, 0)); return o?.kind === 'timerfd' ? o : null; };
  lib.timerfd_gettime = (p, c) => { const o = timerOf(p, c); if (!o) return fail(p, EBADF); const out = n(c, 1); writeSpec(p, out, o.interval); writeSpec(p, out + 16, o.next === Infinity ? 0 : Math.max(0, o.next - T(p).now())); return 0; };
  lib.timerfd_settime = (p, c) => {
    const o = timerOf(p, c); if (!o) return fail(p, EBADF);
    const flags = n(c, 1), value = n(c, 2), old = n(c, 3);
    if (old) { writeSpec(p, old, o.interval); writeSpec(p, old + 16, o.next === Infinity ? 0 : Math.max(0, o.next - T(p).now())); }
    const interval = spec(p, value), first = spec(p, value + 16), now = T(p).now();
    const absoluteBase = o.clock === 0 ? (runtime?.platform?.clock?.wall?.() ?? Date.now()) : now;   // TFD_TIMER_ABSTIME: the value is a time on the timer's clock (CLOCK_REALTIME or CLOCK_MONOTONIC / BOOTTIME)
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
