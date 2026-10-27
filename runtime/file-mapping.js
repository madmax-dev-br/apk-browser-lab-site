// File-backed mmap for native code (wasm32 linear memory) over the lab's virtual file system.
//
// Design (agreed with the native side): the wasm instance owns one linear memory; `mmap(MAP_SHARED, fd)` returns a region *inside it* that holds the file's bytes. All shared
// mappings of the same (file, offset, length) within the VM alias ONE region -- so two "processes" (or threads) of the same app that map a small coordination file (androidx
// datastore's SharedCounter does atomic increments on a 4 KiB page) really see each other's writes and real wasm atomics work on it. The file itself is brought up to date
//   - on msync(), on munmap() of the last alias, and when the VM stops (flushAll),
//   - and before any read()/pread()/fstat of that file through a descriptor (flushNode), with the region refreshed after any write()/ftruncate() (refreshNode),
// so reads and writes through ordinary descriptors and through the mapping stay coherent. Only bytes that changed since the last sync are written back (a shadow copy per region),
// so a mapping never overwrites bytes another descriptor wrote in the meantime unless the mapping itself changed them. MAP_PRIVATE mappings are private copies that never write back.
//
// Not modelled: partial munmap / mremap, overlapping mappings with different geometry (EINVAL, explicit), PROT changes (mprotect is accepted and recorded), SIGBUS past EOF (bytes past
// the end of the file read as zero and are never written back), hardware page granularity beyond a 4 KiB page size.
export const PAGE = 4096;
export const PROT = { NONE: 0, READ: 1, WRITE: 2, EXEC: 4 };
export const MAP = { SHARED: 1, PRIVATE: 2, FIXED: 0x10, ANONYMOUS: 0x20 };
export const MS = { ASYNC: 1, INVALIDATE: 2, SYNC: 4 };

export class MappingError extends Error {
  constructor(errno, message) { super(message ?? errno); this.errno = errno; this.name = 'MappingError'; }
}

const roundUp = n => Math.ceil(n / PAGE) * PAGE;

/**
 * @param fs      the VirtualFileSystem (readAt(node, at, out, outOffset, length), writeAt(node, at, bytes, offset, length), now())
 * @param memory  { alloc(size) -> address (page aligned, zero filled), free(address, size), view() -> Uint8Array over the current linear memory }
 */
export function createFileMappings(fs, memory) {
  const mappings = new Map();        // address -> mapping
  const shared = new Map();          // node -> Set(mapping), shared writable-or-readable file mappings (the aliasing / coherence set)
  const bytes = (mapping) => memory.view().subarray(mapping.address, mapping.address + mapping.length);

  function load(mapping) {        // file -> region (and shadow); bytes past EOF read as zero
    const region = bytes(mapping), node = mapping.node, available = Math.max(0, Math.min(mapping.length, node.size - mapping.offset));
    region.fill(0); if (available > 0) fs.readAt(node, mapping.offset, region, 0, available);
    mapping.shadow = region.slice();
  }
  function writeBack(mapping) {   // region -> file, only the bytes that changed since the last sync
    if (!mapping.writable || !mapping.shared) return false;
    const region = bytes(mapping), shadow = mapping.shadow, node = mapping.node, limit = Math.max(0, Math.min(mapping.length, node.size - mapping.offset));
    let changed = false, i = 0;
    while (i < limit) {
      if (region[i] === shadow[i]) { i++; continue; }
      let j = i; while (j < limit && region[j] !== shadow[j]) j++;
      fs.writeAt(node, mapping.offset + i, region, i, j - i); shadow.set(region.subarray(i, j), i); changed = true; i = j;
    }
    return changed;
  }
  const find = (address, length) => {
    for (const mapping of mappings.values()) if (address >= mapping.address && address + length <= mapping.address + mapping.length) return mapping;
    return null;
  };

  return {
    /** mmap. `node` is the file node (null with MAP_ANONYMOUS); `readable`/`writable` are the descriptor's access mode. Returns the address inside the linear memory. */
    map({ node = null, offset = 0, length, prot, flags, readable = true, writable = false }) {
      if (!(length > 0) || !Number.isInteger(length)) throw new MappingError('EINVAL', 'mmap length must be positive');
      if (offset % PAGE !== 0 || offset < 0) throw new MappingError('EINVAL', 'mmap offset must be page aligned');
      const sharedMap = (flags & MAP.SHARED) !== 0, privateMap = (flags & MAP.PRIVATE) !== 0;
      if (sharedMap === privateMap) throw new MappingError('EINVAL', 'mmap needs exactly one of MAP_SHARED / MAP_PRIVATE');
      if (flags & MAP.FIXED) throw new MappingError('ENOTSUP', 'MAP_FIXED is not supported');
      const size = roundUp(length), anonymous = (flags & MAP.ANONYMOUS) !== 0;
      if (!anonymous) {
        if (!node) throw new MappingError('EBADF', 'mmap needs a file descriptor');
        if (node.type !== 'file') throw new MappingError('ENODEV', 'only regular files can be mapped');
        if (!readable) throw new MappingError('EACCES', 'mmap needs a readable descriptor');
        if (sharedMap && (prot & PROT.WRITE) && !writable) throw new MappingError('EACCES', 'MAP_SHARED + PROT_WRITE needs a writable descriptor');
      }
      if (!anonymous && sharedMap) {
        for (const other of shared.get(node) ?? []) {
          const overlaps = offset < other.offset + other.length && other.offset < offset + size;
          if (!overlaps) continue;
          if (other.offset !== offset || other.length !== size) throw new MappingError('EINVAL', 'overlapping MAP_SHARED mappings of one file with different geometry are not supported');
          if ((prot & PROT.WRITE) && !other.writable) other.writable = true;
          other.refs++; return other.address;
        }
      }
      const address = memory.alloc(size);
      const mapping = { address, length: size, node: anonymous ? null : node, offset, prot, shared: sharedMap && !anonymous, writable: !!(prot & PROT.WRITE) && (!sharedMap || writable), refs: 1, shadow: null };
      mappings.set(address, mapping);
      if (!anonymous) {
        load(mapping);
        if (mapping.shared) (shared.get(node) ?? shared.set(node, new Set()).get(node)).add(mapping);
      }
      return address;
    },
    /** msync: write the mapping's changed bytes back to the file (MS_ASYNC / MS_SYNC are the same here: the file system is in memory). */
    msync(address, length, flags = MS.SYNC) {
      if (address % PAGE !== 0 || (flags & MS.ASYNC && flags & MS.SYNC)) throw new MappingError('EINVAL', 'msync arguments');
      const mapping = find(address, Math.max(1, length)); if (!mapping) throw new MappingError('ENOMEM', 'msync of an unmapped range');
      if (mapping.node && mapping.shared && writeBack(mapping)) mapping.node.mtime = fs.now();
    },
    /** munmap of a whole mapping (partial unmapping is not supported). The last alias flushes and frees the region. */
    munmap(address, length) {
      const mapping = mappings.get(address); if (!mapping) throw new MappingError('EINVAL', 'munmap of an address that is not the start of a mapping');
      if (roundUp(length) !== mapping.length) throw new MappingError('EINVAL', 'partial munmap is not supported');
      if (--mapping.refs > 0) return;
      if (mapping.node && mapping.shared) { writeBack(mapping); shared.get(mapping.node)?.delete(mapping); }
      mappings.delete(address); memory.free(address, mapping.length);
    },
    mprotect(address, length, prot) {
      const mapping = find(address, Math.max(1, length)); if (!mapping) throw new MappingError('ENOMEM', 'mprotect of an unmapped range');
      mapping.prot = prot;
    },
    /** Called before a descriptor read/pread/fstat/copy of `node`: shared mappings' changes reach the file first. */
    flushNode(node) { for (const mapping of shared.get(node) ?? []) writeBack(mapping); },
    /** Called after a descriptor write/pwrite/ftruncate of `node`: the region shows what the file now holds. */
    refreshNode(node) { for (const mapping of shared.get(node) ?? []) { writeBack(mapping); load(mapping); } },
    /** The VM stops: every shared writable mapping is written back. */
    flushAll() { for (const mapping of mappings.values()) if (mapping.node && mapping.shared) writeBack(mapping); },
    hasMappings: node => (shared.get(node)?.size ?? 0) > 0,
    get count() { return mappings.size; },
  };
}
