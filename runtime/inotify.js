// inotify over the virtual file system (the kernel interface android.os.FileObserver's native half uses): an instance owns watches on nodes and a queue of events. Watches follow the node, not
// the path, as inotify watches follow the inode; the events come from VirtualFileSystem.notify (create, delete, move, modify, access, open, close, attrib).
export const IN = Object.freeze({ ACCESS: 0x1, MODIFY: 0x2, ATTRIB: 0x4, CLOSE_WRITE: 0x8, CLOSE_NOWRITE: 0x10, OPEN: 0x20, MOVED_FROM: 0x40, MOVED_TO: 0x80, CREATE: 0x100, DELETE: 0x200, DELETE_SELF: 0x400, MOVE_SELF: 0x800,
  ALL_EVENTS: 0xfff, IGNORED: 0x8000, ISDIR: 0x40000000 });

export function createInotify(fs) {
  const watches = new Map(), queue = []; let nextWatch = 1, closed = false;
  const enqueue = event => {   // the kernel merges an event identical to the one at the tail of the queue
    const last = queue[queue.length - 1];
    if (last && last.wd === event.wd && last.mask === event.mask && last.name === event.name && last.cookie === event.cookie) return;
    queue.push(event);
  };
  const observer = event => {
    for (const [wd, watch] of [...watches]) {
      const selfHit = event.self && watch.node === event.node, childHit = event.child && event.parent && watch.node === event.parent;
      if (!selfHit && !childHit) continue;
      const bit = event.mask & ~IN.ISDIR & 0xfff;
      if (!(watch.mask & bit)) continue;
      enqueue({ wd, mask: event.mask, cookie: event.cookie, name: selfHit && !childHit ? null : event.name });
      if (bit === IN.DELETE_SELF && selfHit) { enqueue({ wd, mask: IN.IGNORED, cookie: 0, name: null }); watches.delete(wd); }
    }
  };
  fs.observers.add(observer);
  return {
    queue,
    /** inotify_add_watch: a watch on an existing path; adding the same node again replaces the mask and returns the same descriptor. -1 when the path does not exist. */
    addWatch(path, mask) {
      if (closed) return -1;
      const node = fs.node(path); if (!node) return -1;
      for (const [wd, watch] of watches) if (watch.node === node) { watch.mask = mask & 0xfff; return wd; }
      const wd = nextWatch++; watches.set(wd, { node, mask: mask & 0xfff }); return wd;
    },
    /** inotify_rm_watch: the watch goes and the kernel reports IN_IGNORED for it. */
    removeWatch(wd) { if (!watches.delete(wd)) return -1; enqueue({ wd, mask: IN.IGNORED, cookie: 0, name: null }); return 0; },
    close() { closed = true; fs.observers.delete(observer); watches.clear(); },
    watching: () => watches.size,
  };
}
