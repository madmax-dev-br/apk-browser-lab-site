import { Blocked } from './scheduler.js?v=d8fff06341bc';
import { createInotify } from './inotify.js?v=d8fff06341bc';

// android.os.FileObserver.ObserverThread's natives (frameworks/base/core/jni/android_util_FileObserver.cpp) over the virtual file system's inotify (src/inotify.js): init() makes an inotify instance,
// startWatching / stopWatching add and remove watches, and observe(fd) -- which never returns on a device -- delivers every queued event to ObserverThread.onEvent(wd, mask, name) and parks the
// observer thread until the next one.
const OBSERVER = 'Landroid/os/FileObserver$ObserverThread;';
const instancesOf = runtime => (runtime.inotifyInstances ??= new Map());

export function createFileObserverNativeBindings() {
  const bindings = new Map(), add = (signature, fn) => bindings.set(`${OBSERVER}->${signature}`, fn);
  add('init()I', (runtime) => {
    const instances = instancesOf(runtime), fd = 1000 + instances.size;
    instances.set(fd, createInotify(runtime.platform.javaIo.fs())); return fd;
  });
  const instance = (runtime, fd) => instancesOf(runtime).get(fd);
  add('startWatching(I[Ljava/lang/String;I[I)V', (runtime, [, fd, paths, mask, wfds]) => {
    const inotify = instance(runtime, fd); if (!inotify) return;
    const names = runtime.array(paths).elements, out = runtime.array(wfds).elements;
    names.forEach((path, index) => { out[index] = path === null || path === 0 ? -1 : inotify.addWatch(runtime.stringCharacters(path), mask); });
  });
  add('stopWatching(I[I)V', (runtime, [, fd, wfds]) => { const inotify = instance(runtime, fd); if (!inotify) return; for (const wd of runtime.array(wfds).elements) inotify.removeWatch(wd); });
  add('observe(I)V', (runtime, [self, fd]) => {
    const inotify = instance(runtime, fd); if (!inotify) return;
    while (inotify.queue.length) {
      const event = inotify.queue.shift();
      runtime.dispatch({ owner: OBSERVER, name: 'onEvent', parameters: ['I', 'I', 'Ljava/lang/String;'], result: 'V', signature: '(IILjava/lang/String;)V' }, runtime.argumentWords(['I', 'I', 'Ljava/lang/String;'], [event.wd, event.mask, event.name], { receiver: self }), 'virtual');
    }
    return new Blocked({ ready: () => inotify.queue.length > 0, retry: true, interruptible: false, reason: 'inotify' });   // the observer thread waits for the next event for the life of the process
  });
  return bindings;
}
