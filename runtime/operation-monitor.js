import { APKError } from './apk-error.js?v=6a6418abc03c';

// What the VM is doing during one page request (launch, click, back, ...) and during the scheduled pumps in between, seen from inside the Worker:
//  - a heartbeat posted to the page every ~250 ms of wall time at the scheduler tick, and at the entry of the host calls that can run long (zip/inflate, class loading, regex/ICU, Skia, image decode,
//    SQLite, crypto, file mapping, wasm, sleep/park). postMessage from a synchronous loop reaches the page at once, so the page knows what the VM last did even if the Worker never answers;
//  - an operation wall budget (host time of the whole operation, not of one event): a pump that keeps scheduling short events (a self-rescheduling Handler loop, a polling thread, a Timer) restarts
//    the per-event watchdog every time, so only this budget ends it, with the execution profile and the list of what kept being scheduled.
const SLOW_HOST = /Inflater|Deflater|java\/util\/zip|ZipFile|ZipEntry|DexFile|DexClassLoader|PathClassLoader|ClassLoader;->(?:loadClass|defineClass|findClass)|regex\/|Pattern;|Matcher;|\/icu\/|Icu|Collator|BreakIterator|Normalizer|Skia|Paragraph|Bitmap|ImageDecoder|sqlite|SQLite|Cipher|MessageDigest|Mac;|Signature;|KeyStore|Crypto|conscrypt|Thread;->sleep|LockSupport|MappedByteBuffer|FileChannel|Linux;|Hermes|NativeLibrary|System;->load|Runtime;->load|AssetManager|XmlBlock|ApkAssets|Resources;->(?:getValue|obtain)|Typeface|FontFamily|Gzip|Zlib|ObjectInputStream|MessageFormat|NumberFormat|DateFormat|URLConnection|HttpURLConnection/;
const short = key => String(key ?? '?').replace(/^L/, '').replace(/;->/, '.');
const typeName = type => String(type ?? '?').replace(/^L/, '').replace(/;$/, '').replaceAll('/', '.');

export class OperationMonitor {
  constructor(runtime) {
    this.rt = runtime; this.sink = null; this.intervalMs = 250; this.budgetMs = 0; this.op = null; this.lastBeat = 0; this.beats = 0; this.active = false;
  }
  /** sink(message) posts a heartbeat; budgetMs = wall budget per operation (0 = none); intervalMs = heartbeat period. */
  configure({ sink = null, budgetMs = 0, intervalMs = 250 } = {}) { this.sink = sink; this.budgetMs = budgetMs; this.intervalMs = intervalMs; this.active = sink !== null || budgetMs > 0; return this; }
  begin(name) {
    const now = performance.now();
    this.op = { name, start: now, events: 0, pump: new Map(), slices: new Map(), expired: false, startInstructions: this.instructions() };
    this.lastBeat = now; this.rt.hostCall = null;
    if (this.sink) this.beat(now, 'begin');
  }
  end() { this.op = null; this.rt.hostCall = null; }
  instructions() { const by = this.rt.executionByOrigin; return (by?.apk?.instructions ?? 0) + (by?.framework?.instructions ?? 0); }

  /** Cheap check at the scheduler tick, thread switches, idle rounds and event dispatch: heartbeat when due, operation budget. */
  tick() {
    if (!this.active) return;
    const now = performance.now();
    if (this.sink !== null && now - this.lastBeat >= this.intervalMs) this.beat(now, 'tick');
    const op = this.op;
    if (op !== null && this.budgetMs > 0 && !op.expired && now - op.start > this.budgetMs) this.expire(now);
  }
  /** A host call is starting: remember it (the page sees it in the next heartbeat) and, for the calls known to run long, post a heartbeat right away so a hang inside names its culprit. */
  hostEnter(key, holder) {
    this.rt.hostCall = key;
    if (this.sink === null) return;
    let slow = holder.slowHost;
    if (slow === undefined) slow = holder.slowHost = SLOW_HOST.test(key);
    if (slow) { const now = performance.now(); if (now - this.lastBeat >= 50) this.beat(now, 'host'); }
  }
  snapshot(now, reason) {
    const rt = this.rt, op = this.op, thread = rt.thread, profile = rt.profile;
    let nextDelay = null, queueDepth = null;
    try { queueDepth = rt.platform?.eventQueue?.length ?? null; nextDelay = rt.platform?.nextEventDelay?.() ?? null; } catch { /* a heartbeat never fails the VM */ }
    return {
      type: 'heartbeat', reason, operation: op?.name ?? null, wallMs: op ? Math.round(now - op.start) : null, instructions: this.instructions(), events: op?.events ?? 0, thread: thread?.name ?? null,
      stack: profile.currentStack(6), hostCall: rt.hostCall ? short(rt.hostCall) : null, queueDepth, nextDelay, busiest: profile.top(3), heartbeat: ++this.beats,
      vm: { objects: rt.heap?.size ?? null, limit: rt.maxHeapObjects ?? null, collections: rt.gcStats?.collections ?? 0, gcMs: Math.round(rt.gcStats?.totalMs ?? 0), activity: rt.activityType ?? null },   // what the page can still show when the Worker is too busy to answer a request
    };
  }
  beat(now, reason) {
    this.lastBeat = now;
    if (this.sink === null) return;
    try { this.sink(this.snapshot(now, reason)); } catch { /* a heartbeat never fails the VM */ }
  }

  /** A queued event is about to run (Handler message or host task): count it and what it is. */
  eventRan(event) {
    const op = this.op; if (op === null) return;
    op.events++;
    const rt = this.rt; let key;
    try {
      if (event.platformTask) key = `tarefa do host ${event.platformTask.name || '(anônima)'}`;
      else {
        const handler = typeName(rt.typeOf(event.handler)), callback = rt.object(event.message).messageCallback ?? null, what = callback ? 0 : rt.platform.messageField(rt, event.message, 'what', 'I');
        key = `Handler ${handler} → ${callback ? typeName(rt.typeOf(callback)) : 'what=' + what}`;
      }
    } catch { key = 'evento'; }
    let entry = op.pump.get(key);
    if (entry === undefined) { if (op.pump.size >= 256) return; op.pump.set(key, entry = { count: 0, first: event.when ?? 0, last: event.when ?? 0 }); }
    entry.count++; entry.last = event.when ?? entry.last;
  }
  /** Threads that are about to get a slice of the processor. */
  sliceRan() {
    const op = this.op; if (op === null) return;
    for (const thread of this.rt.scheduler.threads) if (thread.state === 'runnable' && thread.nestedDepth === 0) op.slices.set(thread.name, (op.slices.get(thread.name) ?? 0) + 1);
  }
  pumpReport(limit = 8) {
    const op = this.op; if (op === null) return { text: '', recurring: [], threads: [] };
    const recurring = [...op.pump].sort((a, b) => b[1].count - a[1].count).slice(0, limit).map(([key, e]) => ({ target: key, count: e.count, periodMs: e.count > 1 ? Math.round((e.last - e.first) / (e.count - 1)) : null }));
    const threads = [...op.slices].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({ name, slices: count }));
    const lines = [`O que a VM continuou agendando nesta operação (${op.events} eventos):`,
      ...recurring.map(row => `  ${row.count}×${row.periodMs === null ? '' : ` a cada ~${row.periodMs} ms (tempo virtual)`}  ${row.target}`),
      ...(recurring.length ? [] : ['  (nenhum evento da fila)']),
      'Threads que receberam tempo de processador:', ...threads.map(row => `  ${row.slices}× ${row.name}`), ...(threads.length ? [] : ['  (nenhuma)'])];
    return { text: lines.join('\n'), recurring, threads, events: op.events };
  }
  expire(now) {
    const op = this.op; op.expired = true;
    const rt = this.rt, profile = rt.profile.report(), pump = this.pumpReport(), ms = Math.round(now - op.start);
    this.beat(now, 'expired');
    throw new APKError(`A operação ${op.name} usou ${ms} ms de tempo do host (limite ${this.budgetMs} ms) sem chegar ao fim; ${op.events} eventos e ${this.instructions() - op.startInstructions} instruções nesta operação${rt.hostCall ? `; chamada do host em andamento: ${short(rt.hostCall)}` : ''}.${rt.profile.summary()}`,
      { kind: 'operation-wall-budget', operation: op.name, wallMs: ms, limitMs: this.budgetMs, events: op.events, pump, profile: { ...profile, text: `${profile.text}\n${pump.text}` } });
  }
}
