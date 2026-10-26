// In-memory POSIX-like filesystem for the browser VM's single virtual Android process.
//
// The tree models the paths an app can observe on a stock device for its own package: /data/user/0/<pkg>/{files,cache,...}
// (also reachable as /data/data/<pkg>), /storage/emulated/0 (also /sdcard), /data/app/<pkg>-*/ (read-only APK location),
// /system (directories only; no su or vendor binaries exist). Nothing is copied from the host machine: every byte is
// created by the running app. `snapshot()`/`restore()` give an IndexedDB-ready, JSON-friendly serialization.
//
// Path rules follow java.io.UnixFileSystem.normalize: collapse duplicate '/', drop a trailing '/'. Canonicalization resolves
// '.', '..' and the /data/data -> /data/user/0 and /sdcard -> /storage/emulated/0 aliases.

const ALIASES = (pkg) => [['/data/data/', '/data/user/0/'], ['/sdcard', '/storage/emulated/0'], ['/storage/self/primary', '/storage/emulated/0'], ['/mnt/sdcard', '/storage/emulated/0']];

export function normalizePath(path) {
  let out = '', previous = '';
  for (const char of path) { if (char === '/' && previous === '/') continue; out += char; previous = char; }
  return out.length > 1 && out.endsWith('/') ? out.slice(0, -1) : out;
}

export class VirtualFileSystem {
  constructor({ packageName = 'app', now = () => Date.now(), codePath = null } = {}) {
    this.packageName = packageName; this.now = now; this.nodes = new Map(); this.codePath = codePath ?? `/data/app/~~apkweb/${packageName}-1`;
    this.readOnly = new Set([this.codePath, '/system']);
    for (const dir of ['/', '/data', '/data/user', '/data/user/0', `/data/user/0/${packageName}`, `/data/user/0/${packageName}/cache`, `/data/user/0/${packageName}/code_cache`, '/data/app', this.codePath, '/data/local', '/data/local/tmp',
      '/storage', '/storage/emulated', '/storage/emulated/0', '/storage/emulated/0/Android', '/storage/emulated/0/Android/data', `/storage/emulated/0/Android/data/${packageName}`,
      '/system', '/system/bin', '/system/lib64', '/system/etc', '/system/fonts', '/proc']) this.nodes.set(dir, this.directory());
    // /proc and its entries are deliberately empty: nothing in the browser VM backs them.
  }
  /** Mounts immutable bytes (zero-copy) at path, e.g. the installed APK at <codePath>/base.apk. */
  mount(path, bytes) { this.nodes.set(path, { type: 'file', buf: bytes, size: bytes.length, mtime: this.now(), mode: 0o644, mounted: true }); }
  directory() { return { type: 'dir', mtime: this.now(), mode: 0o771 }; }
  canonical(path) {
    const absolute = path.startsWith('/') ? path : '/' + path, parts = [];
    for (const part of absolute.split('/')) { if (!part || part === '.') continue; if (part === '..') parts.pop(); else parts.push(part); }
    let resolved = '/' + parts.join('/');
    for (const [from, to] of ALIASES(this.packageName)) {
      const bare = from.endsWith('/') ? from.slice(0, -1) : from;
      if (resolved === bare || resolved.startsWith(bare + '/')) { resolved = (to.endsWith('/') ? to.slice(0, -1) : to) + resolved.slice(bare.length); break; }
    }
    return resolved;
  }
  parentOf(path) { const index = path.lastIndexOf('/'); return index <= 0 ? '/' : path.slice(0, index); }
  stat(path) { const node = this.nodes.get(this.canonical(path)); return node ? { type: node.type, size: node.type === 'file' ? node.size : 0, mtime: node.mtime, mode: node.mode } : null; }
  node(path) { return this.nodes.get(this.canonical(path)) ?? null; }
  isReadOnly(path) { const p = this.canonical(path); return [...this.readOnly].some(root => p === root || p.startsWith(root + '/')); }
  /** Returns 'ok' or a POSIX-style error name: ENOENT, EEXIST, ENOTDIR, EISDIR, EACCES. */
  mkdir(path) {
    const p = this.canonical(path); if (this.nodes.has(p)) return 'EEXIST';
    const parent = this.nodes.get(this.parentOf(p)); if (!parent) return 'ENOENT'; if (parent.type !== 'dir') return 'ENOTDIR';
    if (this.isReadOnly(p)) return 'EACCES';
    this.nodes.set(p, this.directory()); parent.mtime = this.now(); return 'ok';
  }
  mkdirs(path) {
    const p = this.canonical(path); const chain = []; let cursor = p;
    while (!this.nodes.has(cursor)) { chain.unshift(cursor); cursor = this.parentOf(cursor); }
    if (this.nodes.get(cursor).type !== 'dir') return 'ENOTDIR';
    for (const dir of chain) { const result = this.mkdir(dir); if (result !== 'ok') return result; }
    return chain.length ? 'ok' : 'EEXIST';
  }
  createFile(path) {
    const p = this.canonical(path); if (this.nodes.has(p)) return 'EEXIST';
    const parent = this.nodes.get(this.parentOf(p)); if (!parent) return 'ENOENT'; if (parent.type !== 'dir') return 'ENOTDIR'; if (this.isReadOnly(p)) return 'EACCES';
    this.nodes.set(p, { type: 'file', buf: new Uint8Array(0), size: 0, mtime: this.now(), mode: 0o660 }); parent.mtime = this.now(); return 'ok';
  }
  list(path) {
    const p = this.canonical(path), node = this.nodes.get(p); if (!node) return null; if (node.type !== 'dir') return null;
    const prefix = p === '/' ? '/' : p + '/', names = [];
    for (const key of this.nodes.keys()) if (key !== p && key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) names.push(key.slice(prefix.length));
    return names;
  }
  delete(path) {
    const p = this.canonical(path), node = this.nodes.get(p); if (!node) return 'ENOENT'; if (p === '/' || this.isReadOnly(p)) return 'EACCES';
    if (node.type === 'dir' && this.list(p).length) return 'ENOTEMPTY';
    this.nodes.delete(p); const parent = this.nodes.get(this.parentOf(p)); if (parent) parent.mtime = this.now(); return 'ok';
  }
  rename(from, to) {
    const a = this.canonical(from), b = this.canonical(to), node = this.nodes.get(a); if (!node) return 'ENOENT';
    if (this.isReadOnly(a) || this.isReadOnly(b)) return 'EACCES'; if (a === b) return 'ok';
    const parent = this.nodes.get(this.parentOf(b)); if (!parent || parent.type !== 'dir') return 'ENOENT';
    const target = this.nodes.get(b); if (target && (target.type === 'dir' ? this.list(b).length : false)) return 'ENOTEMPTY';
    if (node.type === 'dir' && b.startsWith(a + '/')) return 'EINVAL';
    const moved = [];
    for (const key of [...this.nodes.keys()]) if (key === a || key.startsWith(a + '/')) moved.push(key);
    for (const key of moved) { const value = this.nodes.get(key); this.nodes.delete(key); this.nodes.set(b + key.slice(a.length), value); }
    return 'ok';
  }
  /** Ensures a regular file at path exists (creating when `create`), truncating when `truncate`. Returns the node or an error name. */
  open(path, { create = false, truncate = false, write = false } = {}) {
    const p = this.canonical(path); let node = this.nodes.get(p);
    if (!node) { if (!create) return 'ENOENT'; const result = this.createFile(p); if (result !== 'ok') return result; node = this.nodes.get(p); }
    if (node.type === 'dir') return 'EISDIR';
    if (write && this.isReadOnly(p)) return 'EACCES';
    if (truncate) { node.size = 0; node.mtime = this.now(); node.rev = (node.rev ?? 0) + 1; }
    return node;
  }
  readAt(node, position, target, offset, length) {
    if (position >= node.size) return -1;
    const count = Math.min(length, node.size - position); target.set(node.buf.subarray(position, position + count), offset); return count;
  }
  writeAt(node, position, source, offset, length) {
    const end = position + length;
    if (end > 256 * 1024 * 1024) throw new RangeError('Virtual filesystem file size limit (256 MiB) exceeded');
    if (end > node.buf.length) { const grown = new Uint8Array(Math.max(end, node.buf.length * 2, 64)); grown.set(node.buf.subarray(0, node.size)); node.buf = grown; }
    if (position > node.size) node.buf.fill(0, node.size, position);
    node.buf.set(source.subarray(offset, offset + length), position); node.size = Math.max(node.size, end); node.mtime = this.now(); node.rev = (node.rev ?? 0) + 1; return length;   // `rev` lets src/app-data-store.js see a change made within the same millisecond
  }
  bytes(path) { const node = this.node(path); return node?.type === 'file' ? node.buf.slice(0, node.size) : null; }
  setBytes(path, bytes) { const node = this.open(path, { create: true, truncate: true, write: true }); if (typeof node === 'string') return node; this.writeAt(node, 0, bytes, 0, bytes.length); return 'ok'; }
  snapshot() {
    const out = [];
    for (const [path, node] of this.nodes) if (node.mounted) continue; else if (!path.startsWith('/data/app') && node.type === 'file') out.push({ path, mtime: node.mtime, mode: node.mode, data: Array.from(node.buf.subarray(0, node.size)) });
    else if (node.type === 'dir') out.push({ path, dir: true, mtime: node.mtime, mode: node.mode });
    return { version: 1, packageName: this.packageName, entries: out };
  }
  restore(snapshot) {
    if (snapshot?.version !== 1 || snapshot.packageName !== this.packageName) throw new Error('Incompatible filesystem snapshot');
    for (const entry of snapshot.entries) {
      if (entry.dir) { if (!this.nodes.has(entry.path)) this.nodes.set(entry.path, { type: 'dir', mtime: entry.mtime, mode: entry.mode }); }
      else this.nodes.set(entry.path, { type: 'file', buf: Uint8Array.from(entry.data), size: entry.data.length, mtime: entry.mtime, mode: entry.mode });
    }
  }
}
