import { openExchange, serialiseError } from './network-transport.js?v=32afb2a18437';

// The network worker: runs one fetch per exchange for the web device (see network-worker-executor.js for the protocol). Works as a Node worker_thread and as a browser Worker.
const HEAD_CAPACITY = 64 * 1024;
const STATE = 0, HEAD_LENGTH = 1, WRITE_POS = 2, READ_POS = 3, ENDED = 4, ERROR_LENGTH = 5;
const nodeThreads = globalThis.process?.versions?.node ? await import('node:worker_threads') : null;
const channel = nodeThreads?.parentPort
  ? { listen: handler => nodeThreads.parentPort.on('message', handler), post: message => nodeThreads.parentPort.postMessage(message) }
  : { listen: handler => { globalThis.onmessage = event => handler(event.data); }, post: message => globalThis.postMessage(message) };
const exchanges = new Map(), encoder = new TextEncoder();

async function run({ id, request, control: controlBuffer, data: dataBuffer, signal: signalBuffer, options }) {
  const control = new Int32Array(controlBuffer), data = new Uint8Array(dataBuffer), signal = new Int32Array(signalBuffer), ring = data.length - HEAD_CAPACITY;
  const controller = new AbortController(), exchange = { controller, drained: null, aborted: false };
  exchanges.set(id, exchange);
  const wake = () => { Atomics.add(signal, 0, 1); Atomics.notify(signal, 0); channel.post({ type: 'activity', id }); };
  const writeJSON = (value, lengthWord, state) => {
    const bytes = encoder.encode(JSON.stringify(value));
    if (bytes.length > HEAD_CAPACITY) throw new Error('response head larger than 64 KiB');
    data.set(bytes, 0); Atomics.store(control, lengthWord, bytes.length); Atomics.store(control, STATE, state); wake();
  };
  try {
    const { head, reader } = await openExchange(request, { ...options, signal: controller.signal });
    if (exchange.aborted) { try { await reader?.cancel(); } catch { /* ignored */ } return; }
    writeJSON(head, HEAD_LENGTH, 1);
    if (!reader) { Atomics.store(control, ENDED, 1); wake(); return; }
    for (;;) {
      const step = await reader.read();
      if (exchange.aborted) { try { await reader.cancel(); } catch { /* ignored */ } return; }
      if (step.done) break;
      let chunk = step.value instanceof Uint8Array ? step.value : new Uint8Array(step.value);
      while (chunk.length) {
        if (exchange.aborted) return;
        const write = Atomics.load(control, WRITE_POS) >>> 0, read = Atomics.load(control, READ_POS) >>> 0, free = ring - ((write - read) >>> 0);
        if (free === 0) { await new Promise(resolve => { exchange.drained = resolve; }); continue; }
        const n = Math.min(free, chunk.length, ring - (write % ring)), offset = HEAD_CAPACITY + (write % ring);
        data.set(chunk.subarray(0, n), offset); chunk = chunk.subarray(n);
        Atomics.store(control, WRITE_POS, (write + n) | 0); wake();
      }
    }
    Atomics.store(control, ENDED, 1); wake();
  } catch (error) {
    if (exchange.aborted) return;
    try { writeJSON(serialiseError(error), ERROR_LENGTH, 2); } catch { /* the head buffer cannot hold it: nothing more to report */ }
  } finally { exchanges.delete(id); }
}

channel.listen(message => {
  if (message.type === 'start') run(message);
  else if (message.type === 'drain') { const exchange = exchanges.get(message.id); if (exchange?.drained) { const resolve = exchange.drained; exchange.drained = null; resolve(); } }
  else if (message.type === 'abort') { const exchange = exchanges.get(message.id); if (exchange) { exchange.aborted = true; exchange.controller.abort(); exchange.drained?.(); } }
});
