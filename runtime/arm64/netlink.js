// NETLINK_ROUTE sockets of the ARM64 process (docs/ARM64-NATIVE.md "Network"): the route-information requests a library sends to the kernel to list the device's
// interfaces and addresses (bionic's getifaddrs and if_nameindex, network-change trackers). The kernel's answers are built from the virtual device's interfaces, the
// same ones java.net.NetworkInterface lists (src/libcore-io-native.js deviceInterfaces), in the kernel's message layout (linux/netlink.h, linux/rtnetlink.h,
// linux/if_link.h, linux/if_addr.h). Android 11 rules for apps (targetSdkVersion 30 and up, SELinux): bind() on a NETLINK_ROUTE socket and RTM_GETLINK requests are
// denied with EACCES (no hardware addresses); RTM_GETADDR stays allowed. A request type the lab does not answer fails by name; nothing is invented.
import { APKError } from '../apk-error.js?v=5afc26aa921f';
import { deviceInterfaces } from '../libcore-io-native.js?v=5afc26aa921f';

export const NETLINK = Object.freeze({ ROUTE: 0, NLMSG_ERROR: 2, NLMSG_DONE: 3, RTM_NEWLINK: 16, RTM_GETLINK: 18, RTM_NEWADDR: 20, RTM_GETADDR: 22, F_REQUEST: 1, F_MULTI: 2, F_ACK: 4, F_DUMP: 0x300 });
const ARPHRD_ETHER = 1, ARPHRD_LOOPBACK = 772, AF_INET = 2, AF_INET6 = 10, AF_UNSPEC = 0;
const IFLA_ADDRESS = 1, IFLA_BROADCAST = 2, IFLA_IFNAME = 3, IFLA_MTU = 4, IFA_ADDRESS = 1, IFA_LOCAL = 2, IFA_LABEL = 3, IFA_BROADCAST = 4;
const RT_SCOPE_UNIVERSE = 0, RT_SCOPE_HOST = 254, IFA_F_PERMANENT = 0x80;
const EACCES = 13;
const align4 = n => (n + 3) & ~3;

/** The apps the Android 11 netlink rules apply to: targetSdkVersion 30 and up (bionic's getifaddrs checks the same). */
export const restrictedNetlink = runtime => Number(runtime?.targetSdkVersion ?? 33) >= 30;

class Writer {
  constructor() { this.parts = []; }
  message(type, flags, seq, pid, body) {   // struct nlmsghdr (16 bytes) + body, padded to 4
    const length = 16 + body.length, out = new Uint8Array(align4(length)), v = new DataView(out.buffer);
    v.setUint32(0, length, true); v.setUint16(4, type, true); v.setUint16(6, flags, true); v.setUint32(8, seq, true); v.setUint32(12, pid, true); out.set(body, 16);
    this.parts.push(out); return this;
  }
  bytes() { const total = this.parts.reduce((n, p) => n + p.length, 0), out = new Uint8Array(total); let at = 0; for (const p of this.parts) { out.set(p, at); at += p.length; } return out; }
}
const concat = parts => { const total = parts.reduce((n, p) => n + p.length, 0), out = new Uint8Array(total); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
/** struct rtattr (len u16, type u16) + payload, padded to 4. */
const attr = (type, payload) => { const length = 4 + payload.length, out = new Uint8Array(align4(length)), v = new DataView(out.buffer); v.setUint16(0, length, true); v.setUint16(2, type, true); out.set(payload, 4); return out; };
const u32 = value => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, value >>> 0, true); return b; };
const cstr = text => { const b = new TextEncoder().encode(text), out = new Uint8Array(b.length + 1); out.set(b); return out; };
const prefixOf = mask => mask.reduce((n, byte) => n + [...Array(8).keys()].filter(i => byte & (0x80 >> i)).length, 0);

function linkBody(face) {   // struct ifinfomsg: family u8, pad u8, type u16, index i32, flags u32, change u32
  const head = new Uint8Array(16), v = new DataView(head.buffer), loopback = face.name === 'lo';
  v.setUint8(0, AF_UNSPEC); v.setUint16(2, loopback ? ARPHRD_LOOPBACK : ARPHRD_ETHER, true); v.setInt32(4, face.index, true); v.setUint32(8, face.flags >>> 0, true); v.setUint32(12, 0xffffffff, true);
  const parts = [head, attr(IFLA_IFNAME, cstr(face.name)), attr(IFLA_MTU, u32(face.mtu)), attr(IFLA_ADDRESS, Uint8Array.from(face.mac))];
  if (!loopback) parts.push(attr(IFLA_BROADCAST, Uint8Array.from([255, 255, 255, 255, 255, 255])));
  return concat(parts);
}
function addressBody(face, a) {   // struct ifaddrmsg: family u8, prefixlen u8, flags u8, scope u8, index u32
  const v4 = a.addr.length === 4, head = new Uint8Array(8), v = new DataView(head.buffer);
  v.setUint8(0, v4 ? AF_INET : AF_INET6); v.setUint8(1, prefixOf(a.mask)); v.setUint8(2, IFA_F_PERMANENT); v.setUint8(3, face.name === 'lo' ? RT_SCOPE_HOST : RT_SCOPE_UNIVERSE); v.setUint32(4, face.index, true);
  const parts = [head, attr(IFA_ADDRESS, Uint8Array.from(a.addr))];
  if (v4) { parts.push(attr(IFA_LOCAL, Uint8Array.from(a.addr))); if (a.broadcast) parts.push(attr(IFA_BROADCAST, Uint8Array.from(a.broadcast))); parts.push(attr(IFA_LABEL, cstr(face.name))); }
  return concat(parts);
}

/**
 * The kernel's side of one NETLINK_ROUTE socket. `request(bytes)` takes what the process sent (one or more nlmsghdr) and queues the answers (datagrams) or returns
 * an errno the send fails with (EACCES for a request the device's rules deny). `pid` is the port id the kernel gives the socket (the process id).
 */
export function createRouteSocket(runtime, pid) {
  const datagrams = [];
  const familyOf = body => body.length ? body[0] : AF_UNSPEC;
  return {
    pid, datagrams,
    request(bytes) {
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let at = 0; at + 16 <= bytes.length;) {
        const length = v.getUint32(at, true), type = v.getUint16(at + 4, true), flags = v.getUint16(at + 6, true), seq = v.getUint32(at + 8, true);
        if (length < 16 || at + length > bytes.length) return 22;   // EINVAL: a truncated message
        const body = bytes.subarray(at + 16, at + length);
        if (!(flags & NETLINK.F_REQUEST)) { at += align4(length); continue; }   // the kernel ignores what is not a request
        if (type === NETLINK.RTM_GETLINK && restrictedNetlink(runtime)) { runtime?.record?.('NET native netlink RTM_GETLINK: EACCES (denied to apps targeting API 30+, as on Android 11+)'); return EACCES; }
        if ((type === NETLINK.RTM_GETLINK || type === NETLINK.RTM_GETADDR) && (flags & NETLINK.F_DUMP) === NETLINK.F_DUMP) {
          const faces = deviceInterfaces(runtime), out = new Writer(), wanted = familyOf(body);
          if (type === NETLINK.RTM_GETLINK) for (const face of faces) out.message(NETLINK.RTM_NEWLINK, NETLINK.F_MULTI, seq, pid, linkBody(face));
          else for (const face of faces) for (const a of face.addresses) { const family = a.addr.length === 4 ? AF_INET : AF_INET6; if (wanted === AF_UNSPEC || wanted === family) out.message(NETLINK.RTM_NEWADDR, NETLINK.F_MULTI, seq, pid, addressBody(face, a)); }
          if (out.parts.length) datagrams.push(out.bytes());
          datagrams.push(new Writer().message(NETLINK.NLMSG_DONE, NETLINK.F_MULTI, seq, pid, u32(0)).bytes());   // the dump's end, in a datagram of its own as the kernel sends it
          runtime?.record?.(`NET native netlink ${type === NETLINK.RTM_GETLINK ? 'RTM_GETLINK' : 'RTM_GETADDR'} dump: ${out.parts.length} entries of the device's interfaces`);
        } else throw new APKError(`ARM64 native code sent the netlink route request type ${type} (flags 0x${flags.toString(16)}): not provided by the lab (RTM_GETLINK and RTM_GETADDR dumps are)`, { kind: 'arm64-network' });
        at += align4(length);
      }
      return 0;
    },
  };
}
