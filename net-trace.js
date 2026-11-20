// The timeline of every HTTP exchange the app makes, from the request to its last byte read by the app (docs/INTERACTION-PERFORMANCE.md section 25). A measurement aid: the
// network layer (src/network-native.js, src/virtual-http-socket.js) marks the moments below in host time (performance.now()), and the Worker exposes the finished entries as
// self.__apkNetTrace for scripts/validation/background-calls.mjs (DevTools protocol). Nothing here changes what the app sees. DOM-free, no process.*.
//
//   start      the request was handed to the transport (NetworkBridge.start)
//   head       the response head reached the Worker (the fetch promise resolved, or the network worker's ring was polled)
//   first/last the first and the last piece of the body reached the Worker; `pieces` counts them
//   ended      the body ended in the Worker
//   headTaken  the app had the head (HttpURLConnection: its open returned; a socket: its read took the head's last byte)
//   bodyTaken  the app read the body's last byte (or the end of the stream)
//   reads      the app's read calls; parks: the reads that found nothing and parked the thread
//   readyLag   (sum, ms) from the moment the data a parked read waits for reached the Worker to the moment the scheduler saw the read ready
//   resumeLag  (sum, ms) from that moment to the moment the thread ran again and took the bytes; maxResume is the longest one
// Times are reported as epoch milliseconds (performance.timeOrigin + host time), comparable with a server's log on the same machine.

const now = () => performance.now();
const epoch = t => (t ? Math.round(((globalThis.performance?.timeOrigin ?? 0) + t) * 10) / 10 : null);

export class ExchangeTrace {
  constructor(api, url, thread) {
    this.api = api; this.url = url; this.thread = thread; this.start = now(); this.head = 0; this.first = 0; this.last = 0; this.ended = 0; this.pieces = 0; this.bytes = 0;
    this.headTaken = 0; this.bodyTaken = 0; this.reads = 0; this.parks = 0; this.readyLag = 0; this.resumeLag = 0; this.maxResume = 0; this.activity = this.start;
    this.parkedAt = 0; this.readyAt = 0; this.done = false;
  }
  /** The transport produced something (the head, a piece, the end, a failure): what a parked read may be waiting for. */
  arrived(kind, bytes = 0) {
    const t = now(); this.activity = t;
    if (kind === 'head') { if (!this.head) this.head = t; }
    else if (kind === 'piece') { if (!this.first) this.first = t; this.last = t; this.pieces++; this.bytes += bytes; }
    else if (kind === 'end' && !this.ended) this.ended = t;
  }
  read() { this.reads++; }
  /** A read found nothing and parks its thread. */
  park() { this.parks++; this.parkedAt = now(); this.readyAt = 0; }
  /** The parked read's condition holds (asked by the scheduler's wake()). */
  ready() { if (this.parkedAt && !this.readyAt) { this.readyAt = now(); this.readyLag += Math.max(0, this.readyAt - Math.max(this.parkedAt, this.activity)); } }
  /** The parked thread runs again. */
  resume() {
    if (!this.parkedAt) return; const t = now(); if (!this.readyAt) this.ready();
    const lag = t - this.readyAt; this.resumeLag += lag; if (lag > this.maxResume) this.maxResume = lag; this.parkedAt = 0; this.readyAt = 0;
  }
  toJSON() {
    const r = v => Math.round(v * 10) / 10;
    return { api: this.api, url: this.url, thread: this.thread, start: epoch(this.start), head: epoch(this.head), first: epoch(this.first), last: epoch(this.last), ended: epoch(this.ended),
      headTaken: epoch(this.headTaken), bodyTaken: epoch(this.bodyTaken), pieces: this.pieces, bytes: this.bytes, reads: this.reads, parks: this.parks, readyLag: r(this.readyLag), resumeLag: r(this.resumeLag), maxResume: r(this.maxResume) };
  }
}

/** The finished exchanges (a ring of the last `max`). */
export class NetTrace {
  constructor(max = 512) { this.max = max; this.entries = []; }
  finish(trace) { if (trace.done) return; trace.done = true; if (!trace.bodyTaken) trace.bodyTaken = now(); this.entries.push(trace); if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max); }
  /** The entries that started at or after `since` (epoch ms), as plain data. */
  since(since = 0) { return this.entries.filter(entry => epoch(entry.start) >= since).map(entry => entry.toJSON()); }
}
