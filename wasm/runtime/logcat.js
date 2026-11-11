// The app's logcat, as the lab page shows and saves it. Everything that Android sends to logcat reaches the VM through APKRuntime.record() as a `LOG <level> <tag>: <message>`
// trace line (android.util.Log.*, System.out / System.err through libcore's stdio descriptors, Throwable.printStackTrace, fatal and uncaught exceptions). This module turns those
// lines into logcat entries, keeps the latest ones in the Worker and posts them to the page in batches. It runs in the Worker: no DOM, no process.*.
//
// Entry (one logcat line):  { seq, uptime (VM ms), wall (epoch ms), pid, tid, thread (Java thread name), level (V D I W E A), tag, message }
// A message with several lines is stored as one entry per line with the same tag, time and thread, as logcat prints it.
// Wire format (Worker -> page):  { type: 'logcat', reset?: true, rows: [[seq, uptime, wall, pid, tid, thread, level, tag, message], ...], dropped, total }
//   dropped = how many lines the Worker has discarded so far because its buffer was full; total = lines produced since the reset.
// The rows are only posted while the page's Logcat panel is open (setStreaming); closed, the lines stay in the ring and the page gets { type: 'logcat', count: true, rows: [], dropped, total }
// at most once a second, so a closed panel costs the page no DOM work and the Worker no per-line messages.

export const LEVELS = ['V', 'D', 'I', 'W', 'E', 'A'];
export const MAX_LINES = 20000;
export const FLUSH_MS = 100;
export const COUNT_MS = 1000;   // closed panel: the line counter reaches the page at most once a second
export const OPEN_TAIL = 2000;   // opening the panel shows at most this many recent lines of the ring
export const MAX_LINE_CHARS = 4076;   // logcat's own limit for one entry's payload

/** `LOG <level> <tag>: <message>` (the trace-ring form) -> { level, tag, message }, or null when the line is not a log line. */
export function parseTraceLine(line) {
  if (typeof line !== 'string' || !line.startsWith('LOG ') || line.length < 6 || line[5] !== ' ') return null;
  const level = line[4]; if (!LEVELS.includes(level)) return null;
  const rest = line.slice(6), at = rest.indexOf(': ');
  return at < 0 ? { level, tag: 'System', message: rest } : { level, tag: rest.slice(0, at), message: rest.slice(at + 2) };
}

/** Message text -> the lines logcat prints for it: split on \n, one trailing newline dropped, an empty message is one empty line. */
export function splitMessage(message) {
  const text = String(message ?? '').replace(/\r\n/g, '\n'), lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  return lines.map(line => line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line);
}

const pad = (value, width) => String(value).padStart(width, '0');
/** `MM-DD HH:MM:SS.mmm  pid  tid L tag: message` (logcat -v threadtime; the machine's local time unless utc). */
export function formatThreadtime(row, { utc = false } = {}) {
  const d = new Date(row.wall), g = utc ? { M: d.getUTCMonth(), D: d.getUTCDate(), h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds(), ms: d.getUTCMilliseconds() }
    : { M: d.getMonth(), D: d.getDate(), h: d.getHours(), m: d.getMinutes(), s: d.getSeconds(), ms: d.getMilliseconds() };
  return `${pad(g.M + 1, 2)}-${pad(g.D, 2)} ${pad(g.h, 2)}:${pad(g.m, 2)}:${pad(g.s, 2)}.${pad(g.ms, 3)} ${String(row.pid).padStart(5)} ${String(row.tid).padStart(5)} ${row.level} ${row.tag}: ${row.message}`;
}

export const rowToEntry = r => ({ seq: r[0], uptime: r[1], wall: r[2], pid: r[3], tid: r[4], thread: r[5], level: r[6], tag: r[7], message: r[8] });

/**
 * @param post     (message) => void   delivers a batch to the page (self.postMessage in the Worker)
 * @param clock    { now(): VM uptime ms, wall(): epoch ms }
 * @param identity () => ({ pid, tid, thread })   the process id and the running Java thread
 */
export function createLogcat({ post = () => {}, clock = { now: () => 0, wall: () => Date.now() }, identity = () => ({ pid: 0, tid: 0, thread: 'main' }), maxLines = MAX_LINES, flushMs = FLUSH_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id), streaming = true, countMs = COUNT_MS, now = () => Date.now() } = {}) {
  let buffer = [], pending = [], dropped = 0, total = 0, seq = 0, timer = null, reset = true, countedTotal = 0, countedAt = -Infinity;
  // Closed panel (streaming off): lines only go to the ring; the page gets a counter { type: 'logcat', count: true, total, dropped } at most every countMs, no rows.
  const sendCount = () => {
    if (total === countedTotal && !reset) return;
    if (now() - countedAt < countMs && !reset) { if (timer === null) timer = setTimer(send, countMs - (now() - countedAt)); return; }
    countedTotal = total; countedAt = now(); const message = { type: 'logcat', count: true, rows: [], dropped, total }; if (reset) message.reset = true; reset = false; post(message);
  };
  const send = () => {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (!streaming) { sendCount(); return; }
    if (!pending.length && !reset) return;
    const message = { type: 'logcat', rows: pending, dropped, total }; if (reset) message.reset = true;
    pending = []; reset = false; post(message);
  };
  const trim = () => { if (buffer.length > maxLines) { dropped += buffer.length - maxLines; buffer = buffer.slice(buffer.length - maxLines); } };
  const push = row => {
    buffer.push(row); total++;
    if (buffer.length > maxLines + 256) trim();   // amortized: trim in chunks, never per line
    if (!streaming) return;
    pending.push(row); if (pending.length > maxLines) pending = pending.slice(pending.length - maxLines);
  };
  const log = (level, tag, message) => {
    const who = identity(), uptime = clock.now(), wall = clock.wall();
    for (const line of splitMessage(message)) push([seq++, Math.round(uptime * 1000) / 1000, Math.floor(wall), who.pid, who.tid, who.thread, level, String(tag), line]);
    if (timer === null) timer = setTimer(send, streaming ? flushMs : countMs);
  };
  return {
    log,
    /** A `LOG <level> <tag>: <message>` trace line; anything else is ignored. */
    traceLine(line) { const parsed = parseTraceLine(line); if (parsed) log(parsed.level, parsed.tag, parsed.message); },
    /** Posts what is pending now (called at the end of a drained event batch / operation). */
    flush: send,
    /** The buffered entries (at most maxLines) with the counters. */
    snapshot() { trim(); return { rows: buffer.map(rowToEntry), dropped, total }; },
    /** Forgets everything and tells the page to do the same (a new APK / a restart). */
    clear() { buffer = []; pending = []; dropped = 0; total = 0; seq = 0; countedTotal = 0; reset = true; send(); },
    /**
     * The page's Logcat panel opened (true) or closed (false). Opening posts the last `tail` lines of the ring as a reset batch (the page's store counts the older ones as
     * discarded: total - rows) and streams from then on; closing stops the rows, the page then only gets the counter.
     */
    setStreaming(on, { tail = OPEN_TAIL } = {}) {
      on = !!on; if (on === streaming && !on) return;
      streaming = on; if (timer !== null) { clearTimer(timer); timer = null; }
      if (on) { trim(); pending = buffer.slice(Math.max(0, buffer.length - tail)); reset = true; send(); }
      else { pending = []; countedTotal = -1; countedAt = -Infinity; sendCount(); }
    },
    get streaming() { return streaming; },
    get size() { trim(); return buffer.length; },
    get dropped() { trim(); return dropped; },
    /** Routes the runtime's log lines here. */
    attach(runtime) {
      identity = () => { const t = runtime.thread ?? runtime.scheduler?.mainThread?.(); return { pid: runtime.platform?.virtualProcess?.pid ?? 0, tid: Number(t?.id ?? 0), thread: t?.name ?? 'main' }; };
      clock = runtime.clock ?? clock;
      runtime.logSink = line => this.traceLine(line);
      runtime.logEntry = log;
      return this;
    },
  };
}
