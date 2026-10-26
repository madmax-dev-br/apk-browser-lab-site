import { describeFailure } from './network-transport.js?v=f2127a72f766';

// Main-side half of the synchronous network bridge. The exchange runs in a dedicated worker (network-worker.js): it fetches, then hands the response to this side through
// SharedArrayBuffers (head as JSON, body through a ring buffer, state words) and wakes it with Atomics.notify, so a VM frame that cannot yield to the event loop can wait for
// it with Atomics.wait. Available where workers and shared memory are: worker_threads in Node, and a cross-origin isolated page in a browser. Backpressure: the worker stops
// reading the response while the ring is full and resumes when this side posts 'drain'.
export const HEAD_CAPACITY = 64 * 1024, RING_CAPACITY = 256 * 1024;
// Int32 control words per exchange
export const STATE = 0, HEAD_LENGTH = 1, WRITE_POS = 2, READ_POS = 3, ENDED = 4, ERROR_LENGTH = 5;
export const STATE_NONE = 0, STATE_HEAD = 1, STATE_ERROR = 2;
const nodeWorkers = () => globalThis.process?.getBuiltinModule?.('node:worker_threads') ?? null;

export class WorkerExecutor {
  static available() {
    if (nodeWorkers()) return true;
    return typeof Worker === 'function' && typeof SharedArrayBuffer === 'function' && globalThis.crossOriginIsolated === true && typeof Atomics?.wait === 'function';
  }
  constructor(bridge) { this.bridge = bridge; this.signal = new Int32Array(new SharedArrayBuffer(8)); this.worker = null; this.exchanges = new Map(); this.seen = 0; }
  ensure() {
    if (this.worker) return this.worker;
    const url = new URL('./network-worker.js', import.meta.url), node = nodeWorkers();
    if (node) { this.worker = new node.Worker(url); this.worker.on('message', message => this.onMessage(message)); this.worker.on('error', error => this.onCrash(error)); this.worker.unref(); }
    else { this.worker = new Worker(url, { type: 'module' }); this.worker.onmessage = event => this.onMessage(event.data); this.worker.onerror = event => this.onCrash(event.error ?? new Error(event.message)); }
    return this.worker;
  }
  onMessage(message) { if (message?.type === 'activity') this.bridge.signal(); }
  onCrash(error) { for (const op of this.exchanges.values()) if (op.error === null && !op.ended) op.error = { type: 'Ljava/io/IOException;', message: `network worker failed: ${error?.message ?? error}` }; this.worker = null; this.bridge.signal(); }
  post(message) { this.ensure().postMessage(message); }

  start(op, request, options) {
    const control = new SharedArrayBuffer(32), data = new SharedArrayBuffer(HEAD_CAPACITY + RING_CAPACITY);
    op.shared = { control: new Int32Array(control), data: new Uint8Array(data), headParsed: false };
    this.exchanges.set(op.handle, op);
    op.onAbort = () => { if (this.worker) this.post({ type: 'abort', id: op.handle }); this.exchanges.delete(op.handle); };
    this.post({ type: 'start', id: op.handle, request: { method: request.method, url: request.url, headers: request.headers, body: request.body ? Uint8Array.from(request.body) : null, redirect: request.redirect }, control, data, signal: this.signal.buffer, options });
  }

  /** Copies what the worker produced into the operation. Returns true if the operation changed. */
  poll(op) {
    const shared = op.shared; if (!shared || op.closed) return false;
    const { control, data } = shared; let changed = false;
    const state = Atomics.load(control, STATE);
    if (state === STATE_HEAD && !shared.headParsed) {
      const head = JSON.parse(new TextDecoder().decode(data.slice(0, Atomics.load(control, HEAD_LENGTH)))); shared.headParsed = true;
      op.head = head; this.bridge.stats.redirectsObserved += head.status >= 300 && head.status < 400 ? 1 : 0; changed = true;
    } else if (state === STATE_ERROR && op.error === null) {
      const failure = JSON.parse(new TextDecoder().decode(data.slice(0, Atomics.load(control, ERROR_LENGTH))));
      op.error = describeFailure(failure, op.request, op.request.timedOut); this.bridge.stats.failures++; changed = true;
    }
    // body bytes: from the ring into the operation's queue, as long as it is not over its high-water mark
    let write = Atomics.load(control, WRITE_POS) >>> 0, read = Atomics.load(control, READ_POS) >>> 0, moved = 0;
    while (write !== read && op.queued < 256 * 1024) {
      const available = (write - read) >>> 0, offset = HEAD_CAPACITY + (read % RING_CAPACITY), n = Math.min(available, RING_CAPACITY - (read % RING_CAPACITY), 64 * 1024);
      op.queue.push(data.slice(offset, offset + n)); op.queued += n; read = (read + n) >>> 0; moved += n;
    }
    if (moved) { Atomics.store(control, READ_POS, read | 0); this.bridge.stats.bytesIn += moved; this.post({ type: 'drain', id: op.handle }); changed = true; }
    if (!op.ended && Atomics.load(control, ENDED) === 1 && ((Atomics.load(control, WRITE_POS) >>> 0) === read)) { op.ended = true; this.exchanges.delete(op.handle); changed = true; }
    return changed;
  }

  /** The worker's progress counter; pass it to wait() to sleep only if nothing happened since. */
  mark() { return Atomics.load(this.signal, 0); }
  /** Blocks this thread until the worker signals progress (the counter moves past `seen`) or `ms` elapse. */
  wait(ms, seen = this.mark()) { Atomics.wait(this.signal, 0, seen, ms); }
}
