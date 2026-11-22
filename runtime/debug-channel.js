// The debugger's synchronous channel (src/debugger.js "in place"): while the VM Worker is held at a breakpoint inside host code (its JavaScript stack cannot unwind), the page's
// debugger commands reach it through a SharedArrayBuffer the page shares at attach time; the Worker waits for them in Atomics.wait and answers through ordinary postMessage
// (sending works while it waits). Only where SharedArrayBuffer exists (a cross-origin isolated page, Node); without it the debugger reports such a stop as a snapshot.
//
// Layout of the buffer: Int32 [0] state (0: empty, 1: a command is waiting), Int32 [1] its length in bytes, then the command as UTF-8 JSON { id, name, args }.
// No DOM, no process.*.

export const DEBUG_CHANNEL_BYTES = 1 << 20;
const HEADER = 8, EMPTY = 0, FULL = 1;

/** A channel buffer for the page to share with the Worker, or null where SharedArrayBuffer is not available. */
export function createDebugChannelBuffer(bytes = DEBUG_CHANNEL_BYTES) {
  if (typeof SharedArrayBuffer !== 'function' || typeof Atomics?.wait !== 'function') return null;
  try { return new SharedArrayBuffer(bytes); } catch { return null; }
}

/** The page's end: writes a command for the held Worker. Returns false when the previous command has not been taken yet. */
export function sendDebugCommand(buffer, command) {
  const state = new Int32Array(buffer, 0, 2), bytes = new TextEncoder().encode(JSON.stringify(command));
  if (bytes.length > buffer.byteLength - HEADER) throw new Error('Debugger command too large for the channel');
  if (Atomics.load(state, 0) !== EMPTY) return false;
  new Uint8Array(buffer, HEADER, bytes.length).set(bytes);
  Atomics.store(state, 1, bytes.length); Atomics.store(state, 0, FULL); Atomics.notify(state, 0);
  return true;
}

/**
 * The Worker's end (JavaDebugger's `channel`): receive() blocks until the page writes a command (it first posts { type: 'debug-held', state } so the page knows the Worker
 * waits for commands there); reply() posts the outcome as { type: 'debug-reply', id, result | error }.
 */
export class SharedDebugChannel {
  constructor(buffer, post, { waitMs = 1000 } = {}) { this.buffer = buffer; this.state = new Int32Array(buffer, 0, 2); this.post = post; this.waitMs = waitMs; this.closed = false; }
  receive(state) {
    try { this.post({ type: 'debug-held', state }); } catch { /* the page is gone: nothing will come */ }
    for (;;) {
      if (this.closed) return null;
      if (Atomics.load(this.state, 0) === FULL) {
        const length = Atomics.load(this.state, 1), copy = new Uint8Array(length); copy.set(new Uint8Array(this.buffer, HEADER, length));
        Atomics.store(this.state, 0, EMPTY);
        try { return JSON.parse(new TextDecoder().decode(copy)); } catch { return { id: null, name: 'state' }; }
      }
      Atomics.wait(this.state, 0, EMPTY, this.waitMs);
    }
  }
  reply(id, outcome) { try { this.post({ type: 'debug-reply', id, ...outcome }); } catch { /* the page is gone */ } }
  close() { this.closed = true; }
}
