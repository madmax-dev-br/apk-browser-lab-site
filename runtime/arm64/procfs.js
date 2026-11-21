// The ARM64 native process's side of the app's /proc. The model is ONE (src/procfs.js: what exists, the status / cmdline / comm / task / fd / exe content, hidepid), read by
// Java through the virtual file system and by native code through this adapter; the native process contributes what only it has:
//   maps        one line per mapping (the kernel's show_map_vma format): each library's PT_LOAD segments with its path (libart.so's image included), the thread stacks, the
//               malloc heap, ART's LinearAlloc and DEX mappings, mmap regions by name (src/arm64/process.js mapRegion / noteRegion)
//   mem         the process's memory at the file offset = address (src/arm64/libc.js reads and writes it; an unmapped address is EIO)
//   task/       its threads: the main thread, the Java threads that called native code, the threads native code created (src/arm64/threads.js), each with its comm
//   fd/         its own descriptors beside Java's
import { processComm } from '../procfs.js?v=d6bc8426c03e';

const hex = (value, width = 8) => value.toString(16).padStart(width, '0');
export const threadComm = processComm;   // ART's SetThreadName applies the same rule to thread names

export function createProcfs({ runtime = null, fs = () => null, fdFile = () => null, fdList = () => [] } = {}) {
  let attached = null;
  const shared = () => fs()?.procfs ?? null;
  const processName = () => runtime?.platform?.packageName ?? 'app_process';
  const threadsOf = p => {
    const list = [...(p.threads?.threads.values() ?? [])], java = [...(p.threads?.javaByTid?.values() ?? [])];
    return [...list, ...java].filter(t => t.state !== 'done').sort((a, b) => a.tid - b.tid);
  };
  // a thread's comm: what it set (pthread_setname_np, prctl PR_SET_NAME), else what ART set (the process name for the main thread, the Java name for a Java thread), else its creator's (clone copies it)
  const commOf = (p, t) => t.comm ?? (t.main ? processComm(processName()) : t.java ? processComm(t.name ?? 'Thread') : t.parent ? commOf(p, t.parent) : processComm(processName()));
  // the mappings as { start, end, perms, offset, name }: what maps prints, and what the memory figures count (src/process-memory.js)
  const mappings = p => {
    const out = [];
    for (const lib of p.order) {
      for (const s of lib.elf?.segments ?? []) {
        if (s.type !== 1) continue;
        const start = Math.floor((lib.base + s.vaddr) / 0x1000) * 0x1000, end = Math.ceil((lib.base + s.vaddr + s.memsz) / 0x1000) * 0x1000;
        out.push({ start, end, perms: `${s.flags & 4 ? 'r' : '-'}${s.flags & 2 ? 'w' : '-'}${s.flags & 1 ? 'x' : '-'}p`, offset: Math.floor(s.offset / 0x1000) * 0x1000, name: lib.path ?? lib.name });
      }
    }
    for (const region of p.regions ?? []) out.push({ start: region.start, end: region.end, perms: region.perms, offset: 0, name: region.name ?? '' });
    return out.sort((a, b) => a.start - b.start);
  };
  const maps = p => {
    const lines = [];
    // show_map_vma: start-end perms offset major:minor inode, then the name padded to column 73 (the lab's files have no device or inode numbers)
    const add = (start, end, perms, offset, name) => { const head = `${hex(start)}-${hex(end)} ${perms} ${hex(offset)} 00:00 0 `; lines.push({ start, end, text: name ? head.padEnd(73, ' ') + name : head.trimEnd() }); };
    for (const m of mappings(p)) add(m.start, m.end, m.perms, m.offset, m.name);
    return lines.map(l => l.text).join('\n') + '\n';
  };
  /** Attaches the process `p` to the app's /proc model (at process start, src/arm64/glue.js; again at a lookup if it was not). */
  const attach = p => {
    const model = shared(); if (!model || attached === p) return model;
    attached = p;
    model.attachNative({ maps: () => maps(p), mappings: () => mappings(p).map(m => ({ ...m, size: m.end - m.start })), threads: () => threadsOf(p), currentTid: () => p.threads?.current?.tid ?? p.pid, commOf: t => commOf(p, t), fdFile, fdList }, line => runtime?.record?.(line));
    return model;
  };
  /** The libc's view of a path: { data } a file, { names } a directory, { link, deleted, bytes } a link, { mem }, { missing } a /proc path of this process that does not exist; null when the path is not one. */
  function lookup(p, path) {
    const model = attach(p); if (!model) return null;
    const entry = model.lookup(fs().canonical(String(path))); if (!entry) return null;
    if (entry.dir) return { names: entry.dir };
    if (entry.file) return { data: entry.file() };
    if (entry.link) return { link: entry.link.path, deleted: !!entry.link.deleted, bytes: () => entry.link.bytes?.() ?? (entry.link.node?.type === 'file' ? entry.link.node.buf.slice(0, entry.link.node.size) : null) };
    if (entry.mem) return { mem: true };
    return { missing: true };
  }
  return {
    attach, lookup, commOf, threadComm,
    /** readlink of a /proc link (fd/<n>, exe): the model's answer, null when the path is not a link. */
    readlink(p, path) { const model = attach(p); return model ? model.readlink(fs().canonical(String(path))) : null; },
  };
}
