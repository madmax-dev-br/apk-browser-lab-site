// UDP datagram sockets of the virtual device: the kernel side under libcore.io.Linux bind / connect / sendto / recvfrom / poll / setsockopt (android-13.0.0_r1 libcore_io_Linux.cpp), behind the
// original java.net.DatagramSocket / MulticastSocket / PlainDatagramSocketImpl. Datagrams are delivered between sockets inside the VM: loopback, the Wi-Fi address while the panel is online,
// broadcast and multicast groups joined by sockets of this process. There is no route out of the browser, so a datagram for any other address fails like on a device that has no route to it
// (ENETUNREACH), and a connected socket whose loopback peer is not there gets ECONNREFUSED (the ICMP port unreachable the kernel reports) on its next send or receive.
import { Blocked } from './scheduler.js?v=9279502e5be3';

const MAX_DATAGRAM = 65507, RECEIVE_QUEUE_BYTES = 212992, EPHEMERAL_FIRST = 32768, EPHEMERAL_LAST = 60999, OWN_V4 = [10, 0, 2, 15], BROADCAST_V4 = [10, 0, 2, 255];

export function installUdp({ L, C, err, entryOf, state, construct, byteArray, interfaces, INET, SOCKADDR }) {
  const key = bytes => bytes.join('.');
  const bytesOf = (runtime, address) => {   // InetAddress -> normalized bytes (an IPv4-mapped IPv6 address is the IPv4 address)
    const raw = runtime.dispatch({ owner: INET, name: 'getAddress', parameters: [], result: '[B', signature: '()[B' }, [address], 'virtual');
    if (raw === null || raw === 0) return [0, 0, 0, 0];   // AF_UNSPEC (what DatagramSocket.disconnect connects to) has no bytes: treated as the wildcard address
    let bytes = runtime.object(raw).elements.map(v => v & 255);
    if (bytes.length === 16 && bytes.slice(0, 10).every(v => v === 0) && bytes[10] === 255 && bytes[11] === 255) bytes = bytes.slice(12);
    if (bytes.length === 16 && bytes.slice(0, 15).every(v => v === 0) && bytes[15] === 1) bytes = [127, 0, 0, 1];   // ::1 is the loopback address like 127.0.0.1
    return bytes;
  };
  const isAny = bytes => bytes.every(v => v === 0);
  const isLoopback = bytes => (bytes.length === 4 ? bytes[0] === 127 : bytes.slice(0, 15).every(v => v === 0) && bytes[15] === 1);
  const isMulticast = bytes => (bytes.length === 4 ? bytes[0] >= 224 && bytes[0] <= 239 : bytes[0] === 255);
  const same = (a, b) => key(a) === key(b);
  const online = runtime => runtime.platform.device?.connectivity !== 'offline';
  const classify = (runtime, bytes) => {
    if (isAny(bytes) || isLoopback(bytes)) return 'local';
    if (bytes.length === 4 && key(bytes) === '255.255.255.255') return 'broadcast';
    if (bytes.length === 4 && key(bytes) === key(BROADCAST_V4)) return 'broadcast';
    if (isMulticast(bytes)) return 'multicast';
    if (bytes.length === 4 && key(bytes) === key(OWN_V4) && online(runtime)) return 'local';
    return 'remote';
  };
  const sockets = runtime => { const seen = new Set(); for (const { desc } of state(runtime).table.values()) if (desc.kind === 'socket') seen.add(desc); return [...seen]; };
  const inetAddress = (runtime, bytes) => runtime.dispatch({ owner: INET, name: 'getByAddress', parameters: ['[B'], result: INET, signature: `([B)${INET}` }, [byteArray(runtime, bytes)], 'static');
  const socketOf = (runtime, fn, fdRef) => { const entry = entryOf(runtime, fn, fdRef); if (entry.desc.kind !== 'socket') err(runtime, fn, 'ENOTSOCK'); return entry.desc; };
  const opt = (desc, level, option) => (desc.options ??= new Map()).get(`${level}:${option}`);

  const ephemeral = (runtime, desc) => {
    const used = new Set(sockets(runtime).filter(s => s.bound && s.type === desc.type).map(s => s.bound.port));
    for (let port = EPHEMERAL_FIRST; port <= EPHEMERAL_LAST; port++) if (!used.has(port)) return port;
    return err(runtime, 'bind', 'EADDRINUSE');
  };
  const bindTo = (runtime, fn, desc, bytes, port) => {
    if (desc.bound) err(runtime, fn, 'EINVAL');
    if (port !== 0 && port < 1024) err(runtime, fn, 'EACCES');          // an app is not root: no privileged ports
    if (!isAny(bytes) && !isMulticast(bytes) && classify(runtime, bytes) !== 'local' && !(classify(runtime, bytes) === 'broadcast')) err(runtime, fn, 'EADDRNOTAVAIL');
    if (port === 0) port = ephemeral(runtime, desc);
    for (const other of sockets(runtime)) {
      if (other === desc || !other.bound || other.type !== desc.type || other.bound.port !== port) continue;
      const overlap = isAny(other.bound.bytes) || isAny(bytes) || key(other.bound.bytes) === key(bytes);
      const reuse = opt(desc, C.SOL_SOCKET, C.SO_REUSEADDR) && opt(other, C.SOL_SOCKET, C.SO_REUSEADDR);
      if (overlap && !(reuse && desc.type === C.SOCK_DGRAM)) err(runtime, fn, 'EADDRINUSE');
    }
    desc.bound = { bytes, port };
  };
  const autoBind = (runtime, fn, desc) => { if (!desc.bound) bindTo(runtime, fn, desc, desc.domain === C.AF_INET6 ? new Array(16).fill(0) : [0, 0, 0, 0], 0); };

  L(`bind(Ljava/io/FileDescriptor;${INET}I)V`, (runtime, [, fdRef, address, port]) => bindTo(runtime, 'bind', socketOf(runtime, 'bind', fdRef), bytesOf(runtime, address), port));
  L(`bind(Ljava/io/FileDescriptor;${SOCKADDR})V`, (runtime, [, fdRef, socketAddress]) => {
    const get = (name, result) => runtime.dispatch({ owner: 'Ljava/net/InetSocketAddress;', name, parameters: [], result, signature: `()${result}` }, [socketAddress], 'virtual');
    bindTo(runtime, 'bind', socketOf(runtime, 'bind', fdRef), bytesOf(runtime, get('getAddress', INET)), get('getPort', 'I'));
  });
  const boundAddress = (runtime, desc) => {
    if (!desc.bound) { const bytes = new Array(desc.domain === C.AF_INET6 ? 16 : 4).fill(0); return construct(runtime, 'Ljava/net/InetSocketAddress;', [INET, 'I'], [inetAddress(runtime, bytes), 0]); }
    const bytes = isAny(desc.bound.bytes) && desc.domain === C.AF_INET6 ? new Array(16).fill(0) : desc.bound.bytes;
    return construct(runtime, 'Ljava/net/InetSocketAddress;', [INET, 'I'], [inetAddress(runtime, bytes), desc.bound.port]);
  };

  // ---- connect on a datagram socket only fixes the peer (no handshake); AF_UNSPEC / the wildcard address with port 0 dissolves the association
  const connectDatagram = (runtime, fdRef, bytes, port) => {
    const desc = socketOf(runtime, 'connect', fdRef);
    if (isAny(bytes) && port === 0) { desc.peer = null; return; }
    if (classify(runtime, bytes) === 'remote' || (!online(runtime) && classify(runtime, bytes) !== 'local')) err(runtime, 'connect', 'ENETUNREACH');
    autoBind(runtime, 'connect', desc); desc.peer = { bytes, port }; desc.connected = true;
  };

  // ---- delivery
  const deliver = (runtime, desc, data, destBytes, port, flags) => {
    if (desc.type !== C.SOCK_DGRAM) err(runtime, 'sendto', 'EPIPE');
    if (data.length > MAX_DATAGRAM) err(runtime, 'sendto', 'EMSGSIZE');
    if (desc.pendingError) { const name = desc.pendingError; desc.pendingError = null; err(runtime, 'sendto', name); }
    const destination = desc.peer && destBytes === null ? desc.peer : destBytes === null ? err(runtime, 'sendto', 'EDESTADDRREQ') : { bytes: destBytes, port };
    const kind = classify(runtime, destination.bytes);
    if (kind === 'remote' || (kind !== 'local' && !online(runtime))) err(runtime, 'sendto', 'ENETUNREACH');
    if (destination.port === 0 && !desc.peer) err(runtime, 'sendto', 'EINVAL');
    autoBind(runtime, 'sendto', desc);
    const sourceBytes = !isAny(desc.bound.bytes) ? desc.bound.bytes : isLoopback(destination.bytes) || isAny(destination.bytes) ? [127, 0, 0, 1] : OWN_V4;
    const targets = sockets(runtime).filter(s => {
      if (s.type !== C.SOCK_DGRAM || !s.bound || s.bound.port !== destination.port) return false;
      if (s.peer && !(s.peer.port === desc.bound.port && (same(s.peer.bytes, sourceBytes) || isAny(s.peer.bytes)))) return false;
      if (kind === 'multicast') return s.groups?.has(key(destination.bytes)) && (isAny(s.bound.bytes) || key(s.bound.bytes) === key(destination.bytes)) && (s !== desc || opt(desc, C.IPPROTO_IP, C.IP_MULTICAST_LOOP) !== 0);
      if (kind === 'broadcast') return isAny(s.bound.bytes) || key(s.bound.bytes) === key(destination.bytes);
      return isAny(s.bound.bytes) || same(s.bound.bytes, isAny(destination.bytes) ? [127, 0, 0, 1] : destination.bytes);
    });
    if (targets.length === 0 && desc.peer && kind === 'local') { desc.pendingError = 'ECONNREFUSED'; return data.length; }   // ICMP port unreachable for a connected sender
    for (const target of targets) {
      const queued = (target.queue ??= []), used = queued.reduce((sum, d) => sum + d.data.length, 0);
      if (used + data.length > (opt(target, C.SOL_SOCKET, C.SO_RCVBUF) ?? RECEIVE_QUEUE_BYTES)) continue;   // a full receive buffer drops the datagram
      queued.push({ data: data.slice(), source: sourceBytes, port: desc.bound.port });
    }
    return data.length;
  };
  const payload = (runtime, buffer, offset, count) => runtime.object(buffer).elements.slice(offset, offset + count);
  L(`sendtoBytes(Ljava/io/FileDescriptor;Ljava/lang/Object;IIILjava/net/InetAddress;I)I`, (runtime, [, fdRef, buffer, offset, count, flags, address, port]) => {
    const desc = socketOf(runtime, 'sendto', fdRef);
    return deliver(runtime, desc, payload(runtime, buffer, offset, count), address === null || address === 0 ? null : bytesOf(runtime, address), port, flags);
  });
  L(`sendtoBytes(Ljava/io/FileDescriptor;Ljava/lang/Object;IIILjava/net/SocketAddress;)I`, (runtime, [, fdRef, buffer, offset, count, flags, socketAddress]) => {
    const desc = socketOf(runtime, 'sendto', fdRef);
    const get = (name, result) => runtime.dispatch({ owner: 'Ljava/net/InetSocketAddress;', name, parameters: [], result, signature: `()${result}` }, [socketAddress], 'virtual');
    return deliver(runtime, desc, payload(runtime, buffer, offset, count), bytesOf(runtime, get('getAddress', INET)), get('getPort', 'I'), flags);
  });

  L(`recvfromBytes(Ljava/io/FileDescriptor;Ljava/lang/Object;IIILjava/net/InetSocketAddress;)I`, (runtime, [, fdRef, buffer, offset, count, flags, srcAddress]) => {
    const desc = socketOf(runtime, 'recvfrom', fdRef);
    if (desc.type !== C.SOCK_DGRAM) err(runtime, 'recvfrom', 'ENOTCONN');
    const take = () => {
      if (desc.pendingError) { const name = desc.pendingError; desc.pendingError = null; err(runtime, 'recvfrom', name); }
      const queue = desc.queue ??= [];
      if (queue.length === 0) {
        if (desc.nonblock || (flags & C.MSG_DONTWAIT)) err(runtime, 'recvfrom', 'EAGAIN');
        return new Blocked({ ready: () => (desc.queue?.length ?? 0) > 0 || !!desc.pendingError, retry: true, interruptible: true, reason: 'recvfrom(udp)', roots: [] });
      }
      const datagram = flags & C.MSG_PEEK ? queue[0] : queue.shift(), length = Math.min(count, datagram.data.length), cells = runtime.object(buffer).elements;
      for (let i = 0; i < length; i++) cells[offset + i] = (datagram.data[i] << 24) >> 24;
      if (srcAddress !== null && srcAddress !== 0) {
        const fresh = construct(runtime, 'Ljava/net/InetSocketAddress;', [INET, 'I'], [inetAddress(runtime, datagram.source), datagram.port]), holder = 'Ljava/net/InetSocketAddress;->holder:Ljava/net/InetSocketAddress$InetSocketAddressHolder;';
        runtime.storeField(runtime.object(srcAddress).fields, holder, runtime.object(fresh).fields.get(holder));
      }
      return length;
    };
    return take();
  });

  // ---- poll: a datagram socket is readable when something is queued (or an error is pending); writable always
  L('poll([Landroid/system/StructPollfd;I)I', (runtime, [, pollfds, timeout]) => {
    const rows = runtime.object(pollfds).elements.map(ref => {
      const fields = runtime.object(ref).fields, fdRef = fields.get('Landroid/system/StructPollfd;->fd:Ljava/io/FileDescriptor;'), events = fields.get('Landroid/system/StructPollfd;->events:S') ?? 0;
      return { ref, fields, desc: fdRef ? entryOf(runtime, 'poll', fdRef).desc : null, events };
    });
    const evaluate = () => {
      let ready = 0;
      for (const row of rows) {
        let revents = 0;
        if (row.desc?.kind === 'socket') {
          if (row.events & C.POLLIN && (row.desc.queue?.length ?? 0) > 0) revents |= C.POLLIN;
          if (row.desc.pendingError) revents |= C.POLLERR;
          if (row.events & C.POLLOUT) revents |= C.POLLOUT;
        }
        runtime.storeField(row.fields, 'Landroid/system/StructPollfd;->revents:S', revents);
        if (revents) ready++;
      }
      return ready;
    };
    const now = evaluate();
    if (now > 0 || timeout === 0) return now;
    return new Blocked({ ready: () => evaluate() > 0, deadline: timeout < 0 ? Infinity : runtime.platform.clock.now() + timeout, interruptible: true, reason: 'poll(udp)', finish: () => evaluate() });
  });

  // ioctl(FIONREAD): the size of the datagram that recvfrom would return next (DatagramSocket.connect drains what a former peer left in the queue with it)
  const FIONREAD = 0x541b;
  L('ioctlInt(Ljava/io/FileDescriptor;I)I', (runtime, [, fdRef, command]) => {
    const desc = entryOf(runtime, 'ioctl', fdRef).desc;
    if (desc.kind === 'socket' && command === FIONREAD) return desc.queue?.[0]?.data.length ?? 0;
    return err(runtime, 'ioctl', 'ENOTTY');
  });

  // ---- options. Values are kept per socket; Linux doubles SO_RCVBUF / SO_SNDBUF on set.
  const defaults = (desc, level, option) => {
    if (level === C.SOL_SOCKET) { if (option === C.SO_TYPE) return desc.type; if (option === C.SO_RCVBUF || option === C.SO_SNDBUF) return 212992; if (option === C.SO_ERROR) return 0; }
    if (level === C.IPPROTO_IP && (option === C.IP_MULTICAST_TTL || option === C.IP_MULTICAST_LOOP)) return 1;
    if (level === C.IPPROTO_IPV6 && (option === C.IPV6_MULTICAST_HOPS || option === C.IPV6_MULTICAST_LOOP)) return 1;
    return 0;
  };
  for (const name of ['setsockoptInt', 'setsockoptByte']) L(`${name}(Ljava/io/FileDescriptor;III)V`, (runtime, [, fdRef, level, option, value]) => {
    const desc = socketOf(runtime, 'setsockopt', fdRef);
    (desc.options ??= new Map()).set(`${level}:${option}`, level === C.SOL_SOCKET && (option === C.SO_RCVBUF || option === C.SO_SNDBUF) ? Math.max(value, 2304) * 2 : value);
  });
  L('getsockoptInt(Ljava/io/FileDescriptor;II)I', (runtime, [, fdRef, level, option]) => { const desc = socketOf(runtime, 'getsockopt', fdRef); return opt(desc, level, option) ?? defaults(desc, level, option); });
  L('setsockoptIpMreqn(Ljava/io/FileDescriptor;III)V', (runtime, [, fdRef, level, option, value]) => { (socketOf(runtime, 'setsockopt', fdRef).options ??= new Map()).set(`${level}:${option}`, value); });
  L('setsockoptGroupReq(Ljava/io/FileDescriptor;IILandroid/system/StructGroupReq;)V', (runtime, [, fdRef, level, option, request]) => {
    const desc = socketOf(runtime, 'setsockopt', fdRef), fields = runtime.object(request).fields;
    const group = fields.get('Landroid/system/StructGroupReq;->gr_group:Ljava/net/InetAddress;'), iface = fields.get('Landroid/system/StructGroupReq;->gr_interface:I') ?? 0;
    const bytes = bytesOf(runtime, group);
    if (!isMulticast(bytes)) err(runtime, 'setsockopt', 'EINVAL');
    const faces = interfaces(runtime), chosen = iface === 0 ? faces.find(face => (face.flags & 0x1000) && (face.flags & 0x1)) : faces.find(face => face.index === iface);
    if (!chosen || !(chosen.flags & 0x1000) || !(chosen.flags & 0x1)) err(runtime, 'setsockopt', 'ENODEV');   // no multicast-capable interface that is up (offline, or the loopback)
    const groups = desc.groups ??= new Set();
    if (option === C.MCAST_JOIN_GROUP) { if (groups.has(key(bytes))) err(runtime, 'setsockopt', 'EADDRINUSE'); groups.add(key(bytes)); }
    else if (option === C.MCAST_LEAVE_GROUP) { if (!groups.delete(key(bytes))) err(runtime, 'setsockopt', 'EADDRNOTAVAIL'); }
    else err(runtime, 'setsockopt', 'ENOPROTOOPT');
  });
  for (const name of ['setsockoptLinger', 'setsockoptTimeval']) L(`${name}(Ljava/io/FileDescriptor;IILandroid/system/${name === 'setsockoptLinger' ? 'StructLinger' : 'StructTimeval'};)V`, (runtime, [, fdRef]) => { socketOf(runtime, 'setsockopt', fdRef); });

  return { bytesOf, connectDatagram, boundAddress, isDatagram: desc => desc.kind === 'socket' && desc.type === C.SOCK_DGRAM };
}
