// The compact block at the very top of "Copy diagnostics" and "Screen state": what a person photographing the screen needs first -- memory, who holds it, the one-line uncaught exceptions,
// the main thread and the busiest methods. The long sections (threads, queue, profile, log) follow it.
import { TimeBreakdown, loadTimingText } from './time-breakdown.js?v=448e4ced7d81';
import { staticRetentionLines } from './heap-gc.js?v=448e4ced7d81';
import { overrideSummaryLines } from './method-overrides.js?v=448e4ced7d81';
import { ignoredActivitiesLine } from './ignored-activities.js?v=448e4ced7d81';
import { endpointMockSummaryLines } from './endpoint-mocks.js?v=448e4ced7d81';
import { hostMapSummaryLines } from './host-map.js?v=448e4ced7d81';
import { attributeGap } from './worker-task-log.js?v=448e4ced7d81';
const dotted = type => String(type ?? '?').replace(/^L|;$/g, '').replaceAll('/', '.');
const MiB = 1048576, BYTES_PER_OBJECT = 1600;

/** Lines of the summary for `runtime`; never throws (every part is optional). */
/** When the monitor the main thread waits on belongs to a java.lang.Thread (HandlerThread.getLooper waits on the HandlerThread until its run() reached Looper.prepare): that thread's name, state, whether it started, ran run(), died, and whether Looper.prepare was reached. */
function threadObjectNote(runtime, target) {
  const type = runtime.typeOf(target); if (!runtime.isSubtype(type, 'Ljava/lang/Thread;')) return null;
  const id = runtime.object(target).id, vt = (runtime.scheduler.threads ?? []).find(t => t.javaObject && runtime.object(t.javaObject).id === id);
  const handlerThread = runtime.isSubtype(type, 'Landroid/os/HandlerThread;'), label = handlerThread ? 'HandlerThread' : 'Thread';
  if (!vt) return `  the expected thread is a ${dotted(type)} (${label}) that the scheduler does not know: start() has not been called yet or the thread was already discarded`;
  const looper = handlerThread ? runtime.object(target).fields.get('Landroid/os/HandlerThread;->mLooper:Landroid/os/Looper;') : undefined;
  const crash = [...(runtime.uncaughtExceptions?.values() ?? [])].find(entry => entry.thread === vt.name);
  const parts = [`${label} "${vt.name}" (${dotted(type)}): state ${vt.state}`, vt.started ? 'start() was called' : 'start() has not been called yet'];
  const ran = vt.began || vt.finished || (vt.frames?.length ?? 0) > 0; parts.push(ran ? 'run() has executed' : 'run() has not started executing (the thread was not scheduled)');
  if (handlerThread) parts.push(looper ? 'Looper.prepare was reached' : 'Looper.prepare has not been reached yet (getLooper keeps waiting)');
  if (vt.finished) parts.push(crash ? `finished with the exception ${crash.type.split('.').pop()}${crash.message ? ': ' + crash.message.slice(0, 100) : ''}` : 'finished with no recorded exception');
  else if (vt.frames?.length) parts.push(`now in ${vt.frames.filter(frame => frame.method).slice(-3).reverse().map(frame => `${dotted(frame.method.owner)}.${frame.method.name}`).join(' ← ')}`);
  return `  ${parts.join('; ')}`;
}

export function reportSummary(runtime, { heartbeat = null, error = null, tela = null } = {}) {
  const out = ['== Summary ==']; const part = fn => { try { fn(); } catch { /* a part of the summary is unavailable */ } };
  part(() => {   // a VM error: its message and the innermost Java frames (the message lists them outermost first), so one photo has them
    const message = error?.message; if (!message || error?.details?.jsStack) return;
    const frames = [...String(message).matchAll(/(L[^\s:]+?;->[^\s]+?) \[[^\]]+\] at PC (0x[\da-f]+)/gi)].map(([, frame, pc]) => `${dotted(frame.split('->')[0])}.${frame.split('->')[1].replace(/\(.*$/, '')}@${pc}`);
    const text = String(message).replace(/^(?:L[^\s:]+?;->[^\s]+? \[[^\]]+\] at PC 0x[\da-f]+: )+/i, '');
    out.push(`VM ERROR: ${text.slice(0, 240)}`); if (frames.length) out.push(`  at: ${frames.slice(-6).reverse().join(' ← ')}`);
  });
  part(() => {   // an internal JavaScript error: its own message and the top frames, so one photo has them
    const stack = error?.details?.jsStack; if (!stack) return;
    const lines = String(stack).split('\n'); out.push(`INTERNAL ERROR: ${lines[0]}`);
    const frames = lines.slice(1).filter(line => /\bat\b/.test(line)).slice(0, 3).map(line => line.trim().replace(/file:\/\/\/[^ )]*\//g, '').replace(/^at /, ''));
    if (frames.length) out.push(`  at: ${frames.join(' ← ')}`);
  });
  part(() => { if (runtime.loadTiming) out.push(loadTimingText(runtime.loadTiming)); });   // where the time of the load went, by phase
  part(() => {   // (a) memory
    if (runtime.engine === 'wasm' && runtime.wasm) {   // the core's heap is counted in bytes, not in records of the JavaScript VM
      const m = runtime.wasm.memoryInfo();
      out.push(`Memory (Wasm core): metaspace ${Math.round(m.metaBytes / MiB)} of ${Math.round(m.metaCapacity / MiB)} MiB (${m.classes} classes, ${m.methods} methods linked); ${m.threadRecords - m.threadRecordsFree} of ${m.threadCapacity} thread records in use; heap of ${Math.round(m.heapBytes / MiB)} MiB${m.dynamic ? ` (dynamic mode: heap and threads use ${Math.round(m.areaBytes / MiB)} of ${Math.round(m.areaLimit / MiB)} MiB)` : ' (fixed mode)'}; ${m.handles} objects with a host handle; ${m.collections ? `${m.collections} collections, the last left ${m.liveObjects} live objects (~${Math.round(m.liveBytes / MiB)} MiB)` : 'no collection yet'}`);
      return;
    }
    const live = runtime.heap.size, limit = runtime.maxHeapObjects, last = runtime.gcPhases?.[0];
    out.push(`Memory: ${live} of ${limit} live objects (${Math.round(100 * live / limit)}%), ~${Math.round(live * BYTES_PER_OBJECT / MiB)} MiB estimated; ${last ? `the last collection freed ${last.before - last.after} (${last.before} → ${last.after}); ${runtime.gcStats?.collections ?? 0} collections` : 'no collection yet'}${runtime.gcDeferralStats ? `, ${runtime.gcDeferralStats.episodes} deferred during motion (${runtime.gcDeferralStats.idle} at rest, ${runtime.gcDeferralStats.forced} forced by the ceiling)` : ''}${runtime.oomCount ? `; OutOfMemoryError ${runtime.oomCount}×` : ''}`);
  });
  part(() => {   // renderer (src/gpu-raster.js): only when the experimental GPU replay was selected in this session; a fallback to CPU is never silent
    const gpu = runtime.gpuRaster; if (!gpu) return; const s = gpu.status();
    out.push(s.active === 'gpu' ? `Rendering: GPU (experimental, ${s.api ?? 'WebGL'}${s.gpuRenderer ? `, ${s.gpuRenderer}` : ''}): ${s.frames} frames, ${s.gpuMs} ms, max ${s.maxMs} ms` : s.requested === 'gpu' || s.reason ? `Rendering: CPU — GPU unavailable: ${s.reason ?? 'unknown'}` : 'Rendering: CPU (default)');
  });
  part(() => { const lines = overrideSummaryLines(runtime); if (lines) out.push(...lines); });   // debugging tool in use: never silent (src/method-overrides.js)
  part(() => { const line = ignoredActivitiesLine(runtime); if (line) out.push(line); });   // debugging tool in use: never silent (src/ignored-activities.js)
  part(() => { const lines = endpointMockSummaryLines(runtime); if (lines) out.push(...lines); });   // debugging tool in use: never silent (src/endpoint-mocks.js)
  part(() => { const lines = hostMapSummaryLines(runtime.network?.policy?.hostMap ?? runtime.platform?.device?.network?.hostMap, runtime.network?.redirectTable); if (lines) out.push(...lines); });   // "Redirect hosts" in use: never silent (src/host-map.js)
  if (tela?.length) out.push(...tela);   // "Tela:" lines computed by the screen-state report (activity, first frame verdict, Compose, layout)
  part(() => {   // reflection over hidden members the lab cannot back: answered with NoSuchFieldException / NoSuchMethodException (src/apk-runtime.js reflectionLookup), never silent
    const gaps = runtime.reflectionGaps; if (!gaps?.size) return;
    out.push(`Reflection gaps — members of framework classes the lab hosts without metadata, answered as missing (NoSuchFieldException / NoSuchMethodException; ${gaps.size} distinct):`);
    for (const [member, count] of [...gaps].slice(0, 6)) out.push(`  ${count}× ${member}`);
  });
  part(() => {   // fatal exceptions the tolerant mode let pass: never silent
    const table = runtime.toleratedFatals; if (!table?.size) return;
    out.push(`FATAL (tolerated) — tolerant mode let the app continue; only the thread that failed ended (${[...table.values()].reduce((sum, e) => sum + e.count, 0)} occurrences, ${table.size} distinct):`);
    for (const e of [...table.values()].slice(0, 4)) out.push(`  ${e.count}× ${e.type}${e.message ? ': ' + e.message.slice(0, 140) : ''} [${[...e.threads].slice(0, 3).join(', ')}]${e.stack?.length ? '  at ' + e.stack.slice(0, 6).map(frame => String(frame).split('.').slice(-2).join('.')).join(' ← ') : ''}`);
  });
  part(() => {   // the app crash: the default handler (KillApplicationHandler) ended the run
    const crash = runtime.appCrash; if (!crash) return;
    out.push(`FATAL EXCEPTION: ${crash.thread}: ${crash.type}${crash.message ? ': ' + crash.message.slice(0, 140) : ''}${crash.stack?.length ? '  at ' + crash.stack.slice(0, 6).map(frame => String(frame).split('.').slice(-2).join('.')).join(' ← ') : ''}${crash.phase ? ` (phase: ${crash.phase}, ${crash.atMs} virtual ms)` : ''}`);
  });
  part(() => {   // every OutOfMemoryError: which limit, where
    const log = runtime.oomLog; if (!log?.length) return;
    for (const entry of log.slice(-3)) {
      out.push(`OOM (${entry.kind}) in ${entry.thread ?? '?'}: ${entry.frames.join(' ← ') || entry.hostCall || 'host code'}; objects ${entry.objects}/${entry.maxObjects}, fields ${entry.fieldSlots}/${entry.maxFieldSlots}, array cells ${entry.arrayCells}/${entry.maxArrayCells} (weighted by element width), collection cells ${entry.collectionCells}/${entry.maxCollectionCells}${entry.reason ? `; reason: ${entry.reason}` : ''}${entry.gcTries ? `; collector: ${entry.gcTries.calls ?? 0} safepoints asked for a collection (${entry.gcTries.notDue ?? 0} not due), skipped ${JSON.stringify(entry.gcSkips ?? {})}, ${entry.sinceGc} allocated since the last collection` : ''}${entry.gcEmergency?.attempts ? `; emergency collection on allocation: ${entry.gcEmergency.attempts} attempts, ${entry.gcEmergency.ran} run (${entry.gcEmergency.freed} objects freed), blocked ${JSON.stringify(entry.gcEmergency.blocked)}` : ''}; ${entry.soft ? `soft references: the collection under pressure (policy ${entry.soft.policy}) cleared ${entry.soft.cleared} of ${entry.soft.softReferences}, ${entry.soft.totalCleared} in total` : 'no soft reference was cleared'}`);
      const a = entry.arrays; if (a) {
        out.push(`  arrays at the OOM: ${a.liveCells} weighted cells live and ${a.garbageCells} unreachable and not yet collected (counter ${a.cellsInUse}); above 1 M cells: ${a.liveOver1M.arrays} live (${a.liveOver1M.cells} cells) and ${a.garbageOver1M.arrays} unreachable (${a.garbageOver1M.cells} cells)`);
        for (const c of a.liveTop) out.push(`    live: ${c.type} length ${c.length} elements (${c.cells} weighted cells), held by ${c.root}`);
        for (const c of a.garbageTop.slice(0, 3)) out.push(`    unreachable: ${c.type} length ${c.length} elements (${c.cells} weighted cells)`);
      }
    }
  });
  part(() => {   // soft references cleared under pressure (heap-gc.js softPolicy) and which static fields hold the heap (computed on OutOfMemoryError and by the heap census)
    const stats = runtime.gcStats, soft = runtime.gcSoftLast;
    if (soft || stats?.softCleared) out.push(`soft references: ${stats?.softCleared ?? 0} referents cleared in ${stats?.softCollections ?? 0} collections under pressure${soft ? `; the last (policy ${soft.policy}) cleared ${soft.cleared} of ${soft.softReferences} and freed ${soft.freed} objects` : ''}`);
    out.push(...staticRetentionLines(runtime.gcStaticRetention));
  });
  part(() => {   // (b) survivors, (c) who keeps them, retention paths
    const last = runtime.gcPhases?.[0]; if (!last) return;
    if (last.survivorsByCount?.length) out.push(`survivors (by count): ${last.survivorsByCount.slice(0, 8).map(c => `${c.n} ${c.type}`).join(', ')}`);
    if (last.survivorsByBytes?.length) out.push(`survivors (by estimated bytes): ${last.survivorsByBytes.slice(0, 8).map(c => `${Math.round(c.bytes / 1024)} KiB ${c.type}`).join(', ')}`);
    if (last.categories?.length) {
      out.push(`what keeps them alive (first root that reaches): ${last.categories.slice(0, 6).map(c => `${c.n} ${c.name}`).join('; ')}`);
      const top = last.categories[0]?.topClass; if (top) out.push(`  largest group "${last.categories[0].name}": mostly ${top.n} ${top.type}`);
    }
    if (last.byDex?.length) out.push(`live by class origin: ${last.byDex.map(d => `${d.n} ${d.dex}`).join(', ')}`);
    const retention = runtime.gcRetention;
    if (retention?.paths?.length) out.push(`retention example (${dotted(retention.type)}):`, ...retention.paths.map(path => `  ${path}`));
  });
  part(() => {   // (d) one line per thread
    const table = runtime.uncaughtExceptions; if (!table?.size) return;
    out.push('uncaught exceptions (one line per thread; full stacks further below):');
    const shortFrame = frame => String(frame).split('.').slice(-2).join('.');
    for (const entry of [...table.values()].reverse().slice(0, 8)) {
      out.push(`  original exception (${entry.thread}${entry.count > 1 ? `, ${entry.count}x` : ''}): ${entry.type.split('.').pop()}${entry.message ? ': ' + entry.message.slice(0, 140) : ''}${entry.stack?.length ? '  at ' + entry.stack.slice(0, 6).map(shortFrame).join(' ← ') : ''}`);
      if (entry.handlerFailure) { const h = entry.handlerFailure; out.push(`    the handler also failed: ${h.type.split('.').pop()}${h.message ? ': ' + h.message.slice(0, 140) : ''}${h.stack?.length ? '  at ' + h.stack.slice(0, 6).map(shortFrame).join(' ← ') : ''}`); }
    }
  });
  part(() => {   // (e) main thread
    const main = runtime.scheduler?.main; if (!main) return;
    const frames = (main.frames ?? []).slice(-8).reverse().map(frame => frame.method ? `${dotted(frame.method.owner)}.${frame.method.name}` : frame.cont ? '(host call)' : '?');
    { const target = main.blocked?.blocker ?? main.blocker;
      if (main.blocked && target && !(main.blocker)) { try {
        const record = runtime.object(target), owner = runtime.monitors?.get(record.id)?.owner;
        const releasers = (runtime.scheduler.threads ?? []).filter(t => t !== main && (t.state === 'runnable' || (t.state === 'blocked' && Number.isFinite(t.blocked?.deadline)))).slice(0, 4).map(t => `${t.name} ${t.state}`);
        out.push(`the main thread waits on the monitor of a ${dotted(runtime.typeOf(target))} (${main.blocked.reason}); ${owner ? `monitor held by ${owner.name}` : 'no thread holds the monitor'}; may call notify: ${releasers.join(', ') || 'no active thread'}`);
        const thread = threadObjectNote(runtime, target); if (thread) out.push(thread);
      } catch { /* the monitor object is not inspectable */ } } }
    if (main.blocked && main.blocker) { try { const releasers = (runtime.scheduler.threads ?? []).filter(t => t !== main && (t.state === 'runnable' || (t.state === 'blocked' && Number.isFinite(t.blocked?.deadline)))).slice(0, 4).map(t => `${t.name} ${t.state}${t.frames?.length ? ' in ' + (t.frames.at(-1).method ? dotted(t.frames.at(-1).method.owner).split('.').pop() + '.' + t.frames.at(-1).method.name : '(host)') : ''}`); out.push(`the main thread waits on a ${dotted(runtime.typeOf(main.blocker))}; may release it: ${releasers.join(', ') || 'no active thread'}`); } catch { /* blocker not inspectable */ } }
    out.push(`main thread: ${main.state}${main.blocked ? ` (${main.blocked.reason ?? 'waiting'})` : ''}${main.nestedDepth ? `, inside a nested native call (${main.nestedDepth})` : ''}${frames.length ? '; ' + frames.join(' ← ') : '; no Java frames (idle in the looper' + (runtime.lastHostCall ? `, last host call ${String(runtime.lastHostCall).replace(/^L|;->/g, m => m === ';->' ? '.' : '').replaceAll('/', '.')}` : '') + ')'}`);
    // the longest episode of the main thread inside one event (kept after it ended): where it was, what it was doing, the hottest methods of the last seconds
    { const busy = runtime.monitor?.mainBusy;
      if (busy) out.push(`main thread busy for ${(busy.busyMs / 1000).toFixed(0)} s in a single event (${busy.event})${busy.capped ? `; event ended by the limit after ${(busy.endedAfterMs / 1000).toFixed(0)} s (the stack was already unwound: the frames below are from the last sample)` : busy.ended ? `; the event ended after ${(busy.endedAfterMs / 1000).toFixed(0)} s` : ' and is still running'}; main thread loop: ${busy.hot.join(', ') || '(no samples)'}; innermost frames: ${busy.frames.join(' <- ') || '(none)'}${busy.hostCall ? `; inside the host call ${busy.hostCall}${busy.resourceCall ? ` (${busy.resourceCall})` : ''}` : ''}${busy.overdue?.count ? `; ${busy.overdue.count} overdue messages, the oldest for ${(busy.overdue.oldestMs / 1000).toFixed(1)} s` : ''}`); }
    for (const line of runtime.sampler?.lines?.() ?? []) out.push(line);   // the sampled profile of the last 30 s: the busiest threads and their stacks, independent of any event boundary
    // park / wait details: what it waits on, with or without a deadline, and who could release it -- also when the thread is already runnable (woken, not yet resumed)
    if (main.blocked) {
      const now = runtime.platform?.clock?.now?.() ?? 0, deadline = main.blocked.deadline, timed = Number.isFinite(deadline);
      const blockerClass = main.blocker ? dotted(runtime.typeOf(main.blocker)) : main.blocked.blocker ? dotted(runtime.typeOf(main.blocked.blocker)) : 'none (park without LockSupport.getBlocker)';
      const releasers = (runtime.scheduler.threads ?? []).filter(t => t !== main && (t.state === 'runnable' || (t.state === 'blocked' && Number.isFinite(t.blocked?.deadline)))).slice(0, 5).map(t => `${t.name} ${t.state}`);
      out.push(`  wait: ${main.blocked.reason ?? '?'}; ${timed ? `with a deadline in ${Math.round(deadline - now)} ms` : 'no deadline'}; blocking object: ${blockerClass}; ${main.state === 'runnable' ? 'already woken up and waiting to resume; ' : ''}threads that may release it (unpark/notify): ${releasers.join(', ') || 'none'}`);
    }
    // main-looper messages the thread owes: queued events already due
    { const queue = runtime.platform?.eventQueue ?? [], now = runtime.platform?.clock?.now?.() ?? 0, overdue = queue.filter(event => !event.front && Number.isFinite(event.when) && event.when < now - 50);
      if (overdue.length) {
        const oldest = Math.max(...overdue.map(event => now - event.when)), top = frames[0] ?? (runtime.lastHostCall ? `host call ${runtime.lastHostCall}` : 'the looper (idle)');
        out.push(`${overdue.length} overdue main Looper messages, the oldest for ${(oldest / 1000).toFixed(1)} s, waiting for the main thread to leave: ${top}`);
      } }
  });
  // XML attributes the lab did not apply while inflating layouts (android-platform.js noteXmlAttributeNotApplied): the screens were built without them. Every kind is listed,
  // one per line, with what a gap is found by: the attribute, the tag, how often, why, where the value came from (the tag itself, its style="", the default style) and the class
  // that was built for the tag (a factory may build another class than the tag names). Nothing is cut here: the only bound is the 400 kinds the platform records, and the uses
  // of kinds beyond it are counted and said.
  part(() => { const notes = runtime.platform?.xmlAttributesNotApplied; if (!notes?.size) return;
    const rows = [...notes].sort((a, b) => b[1] - a[1]), total = rows.reduce((sum, row) => sum + row[1], 0);
    const dropped = runtime.platform.xmlAttributesNotAppliedDropped ?? 0, details = runtime.platform.xmlAttributesNotAppliedDetails;
    const row = ([key, n]) => { const detail = details?.get(key), origin = detail?.origin === 'style' ? 'its style=""' : detail?.origin === 'default style' ? 'the default style' : detail?.origin ? detail.origin : 'the tag';
      return `${key} ×${n} (${detail?.reason ?? "the lab's View classes do not implement it yet"}) [given by ${origin}${detail?.className ? `; built as ${detail.className}` : ''}]`; };
    out.push(`XML attributes NOT APPLIED: ${rows.length} kinds, ${total} uses (screens were inflated without them)${dropped ? `, and ${dropped} further uses of kinds that were not recorded (more than 400 kinds: those are counted, not listed)` : ''}:\n  ${rows.map(row).join('\n  ')}`);
  });
  // XML attributes the lab kept (their getter returns the value) but that change nothing a user of this VM can see (view-xml-attributes.js): said once per attribute and tag, with the reason; all of them
  part(() => { const notes = runtime.platform?.xmlAttributesNoEffect; if (!notes?.size) return;
    const rows = [...notes].sort((a, b) => b[1].count - a[1].count), total = rows.reduce((sum, row) => sum + row[1].count, 0);
    const dropped = runtime.platform.xmlAttributesNoEffectDropped ?? 0;
    out.push(`XML attributes accepted, no effect in this VM: ${rows.length} kinds, ${total} uses${dropped ? `, and ${dropped} further uses of kinds that were not recorded (more than 400 kinds: those are counted, not listed)` : ''}:\n  ${rows.map(([key, note]) => `${key} ×${note.count} (${note.reason})`).join('\n  ')}`);
  });
  // resources Android would not resolve either (android-platform.js noteResourceUnresolved): a style that cannot be read, a theme attribute without a value, a package that is not loaded
  part(() => { const notes = runtime.platform?.resourcesUnresolved; if (!notes?.size) return;
    const rows = [...notes].sort((a, b) => b[1].count - a[1].count);
    out.push(`Resources NOT RESOLVED: ${rows.length} kinds (read without them, as AssetManager does): ${rows.slice(0, 8).map(([what, note]) => `${what} ×${note.count} (${note.reason})`).join('; ')}${rows.length > 8 ? `; +${rows.length - 8} more` : ''}`);
  });
  // the opt-in permissive native version mode: which libraries went to an app of another version (jni-host.js)
  part(() => { const waived = runtime.nativeVersionWaivers; if (!waived?.size) return; out.push(`NATIVE VERSION MISMATCH ALLOWED (permissive mode): ${[...waived].map(([soname, what]) => `${soname} ${what}`).join('; ')}`); });
  // framework behaviour the lab tolerates without implementing it (android-platform.js noteFrameworkGap)
  part(() => { const notes = runtime.platform?.frameworkGaps; if (!notes?.size) return;
    out.push(`Framework behaviour NOT IMPLEMENTED (the app went on without it): ${[...notes.values()].slice(0, 8).map(note => `${note.text}${note.count > 1 ? ` ×${note.count}` : ''}`).join('; ')}${notes.size > 8 ? `; +${notes.size - 8} more` : ''}`);
  });
  // the last interaction (a tap, a drag, typing): how long the main thread ran, how much background work ran in between and why (android-platform.js drainEvents), the longest of each
  part(() => { const it = runtime.platform?.interactionStats?.(); if (!it) return;
    const ms = v => `${Math.round(v)} ms`, span = Math.max(0, it.endedAt - it.startedAt), background = it.floorMs + it.sliceMs + it.creditMs;
    out.push(`Last interaction (${it.inputs} input${it.inputs === 1 ? '' : 's'}, ${(it.sinceLastInputMs / 1000).toFixed(1)} s ago; measured over ${ms(span)}): main thread ${ms(it.mainMs)} in ${it.mainEvents} events${it.longestMain ? ` (longest ${ms(it.longestMain.ms)}: ${it.longestMain.event})` : ''}; background threads ${ms(background)} (floor ${ms(it.floorMs)}, slices ${ms(it.sliceMs)} in ${it.slices}, parallel credit ${ms(it.creditMs)}${it.creditHeld ? `, ${it.creditHeld} held back for the input` : ''})${it.longestSlice ? `; longest background slice ${ms(it.longestSlice.ms)} on ${it.longestSlice.thread ?? '?'}${it.longestSlice.hostCall ? ` (host call ${it.longestSlice.hostCall})` : ''}` : ''}${it.overruns ? `; ${it.overruns} slices could not be preempted for more than 50 ms` : ''}`);
    const longest = it.longestMain;
    if (longest && longest.ms >= 50 && (longest.buckets?.length || longest.hosts?.length)) out.push(`  Longest main-thread event, ${ms(longest.ms)} (${longest.event}): ${(longest.buckets ?? []).map(([name, v]) => `${name} ${ms(v)}`).join(', ') || 'no breakdown'}${longest.hosts?.length ? `; host calls by time: ${longest.hosts.map(([key, n, v]) => `${key} ${n}× ${ms(v)}`).join(', ')}` : ''}`);
    // where the Worker's time went over the interaction (src/worker-task-log.js, the Worker's own ring of tasks): first-time work is what a first visit costs and later ones do not
    const log = globalThis.__apkWorkerTasks;
    if (log?.since && span > 0 && typeof performance !== 'undefined') {
      const from = performance.timeOrigin + it.startedAt, to = performance.timeOrigin + it.endedAt, gap = attributeGap(log.since(from), from, to), sum = key => gap.tasks.reduce((total, task) => total + (task[key] ?? 0), 0);
      const parts = Object.entries(gap.share).filter(([, value]) => value >= 1).sort((a, b) => b[1] - a[1]).map(([key, value]) => `${key} ${ms(value)}`);
      const firstTime = sum('inits') || sum('decodes') ? ` (${sum('inits')} classes initialized, ${sum('decodes')} methods prepared, ${sum('collections')} collections)` : '';
      out.push(`  Worker time over that interaction (${gap.tasks.length} tasks): ${parts.join(', ') || 'nothing measured'}${gap.idle >= 1 ? `, idle ${ms(gap.idle)}` : ''}${firstTime}`);
      const kinds = {}; for (const task of gap.tasks) { const entry = kinds[task.kind] ??= { n: 0, ms: 0, max: 0 }; entry.n++; entry.ms += task.ms; entry.max = Math.max(entry.max, task.ms); }
      const byKind = Object.entries(kinds).sort((a, b) => b[1].ms - a[1].ms).slice(0, 6).map(([kind, k]) => `${kind} ${k.n}× ${ms(k.ms)} (longest ${ms(k.max)})`);
      if (byKind.length) out.push(`  Worker tasks over that interaction: ${byKind.join(', ')}`);
    }
    // which background threads ran, what the Worker waited for while idle, and the app's network requests since the input
    const threads = Object.entries(it.threads ?? {}).sort((a, b) => b[1].ms - a[1].ms).slice(0, 8);
    if (threads.length) out.push(`  Threads that ran in the background: ${threads.map(([name, t]) => `${name} ${ms(t.ms)} (${t.slices} slices)`).join(', ')}`);
    const idle = Object.entries(it.idle ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (idle.length) out.push(`  Worker idle ${ms(it.idleMs)}, waiting for: ${idle.map(([reason, value]) => `${ms(value)} ${reason}`).join(' | ')}`);
    const net = runtime.netLog?.snapshot && it.netSeq !== null && it.netSeq !== undefined ? runtime.netLog.snapshot().rows.filter(row => row.seq >= it.netSeq) : [];
    if (net.length) {
      const describe = row => `${row.method} ${row.host ?? ''}${String(row.path ?? '').slice(0, 60)} ${row.complete ? `${row.status ?? row.outcome} in ${Math.round(row.durationMs ?? 0)} ms${row.failure ? ` (${String(row.failure.type || row.failure.message || '').slice(0, 60)})` : ''}` : 'still pending'} [${row.thread}]`;
      const pending = net.filter(row => !row.complete), failed = net.filter(row => row.complete && (row.failure || row.outcome !== 'response'));
      const slowest = [...pending, ...net.filter(row => row.complete).sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))].slice(0, 4);
      out.push(`  Network since the input: ${net.length} requests (${pending.length} pending, ${failed.length} failed); ${slowest.map(describe).join(' | ')}`);
    }
  });
  part(() => { const tb = runtime.tb?.snapshot(); if (tb) { for (const p of tb.pollers ?? []) {
      out.push(`thread ${p.thread} is polling (${p.perSecond} host calls/s): ${p.calls.map(([key, n]) => `${key} ${n}×`).join(', ')}`);
      // where the loop is: the innermost frames of that thread, application code first (the loop and its exit condition live in the innermost app method)
      const thread = runtime.scheduler?.threads?.find(candidate => candidate.name === p.thread), frames = (thread?.frames ?? []).filter(frame => frame.method).reverse();
      const app = frames.filter(frame => !runtime.dex.bootDexes?.has(frame.method.dex)), chosen = (app.length ? app : frames).slice(0, 4);
      if (chosen.length) out.push(`  loop in: ${chosen.map(frame => `${dotted(frame.method.owner)}.${frame.method.name}`).join(' ← ')} (the exit condition is in the innermost method)`);
    } out.push(TimeBreakdown.text(tb)); } });   // where the host time of this operation went
  part(() => {   // the virtual clocks, all on one timeline, and where the queue head sits
    const clock = runtime.platform?.clock; if (!clock?.readings) return; const c = clock.readings(), queue = runtime.platform.eventQueue ?? [];
    const whens = queue.map(event => event.when ?? c.uptime).sort((a, b) => a - b);
    out.push(`Clocks: uptimeMillis ${Math.round(c.uptime)}, elapsedRealtime ${Math.round(c.elapsedRealtime)}, nanoTime−uptime ${c.nanoMinusUptimeUs} µs, currentTimeMillis−(origin+uptime) ${c.wallMinusTimelineMs} ms; virtual time skipped ${c.skippedMs} ms of ${Math.round(c.uptime)} ms${whens.length ? `; queue: first event in ${Math.round(whens[0] - c.uptime)} ms, last in ${Math.round(whens.at(-1) - c.uptime)} ms` : ''}`);
  });
  part(() => {   // the Handler targets that keep recurring in the event queue
    const queue = runtime.platform?.eventQueue ?? []; if (!queue.length) return;
    const now = runtime.platform.clock.now(), groups = new Map();
    for (const event of queue) {
      let what; try { what = event.platformTask ? `host task ${event.platformTask.name || '(anonymous)'}` : event.windowFrameTime !== undefined ? 'frame (Choreographer)' : `${dotted(runtime.typeOf(event.handler)).split('.').pop()} → ${runtime.platform.looperHost.callbackOf(runtime, event.message) ? dotted(runtime.typeOf(runtime.platform.looperHost.callbackOf(runtime, event.message))) : 'what=' + runtime.platform.looperHost.whatOf(runtime, event.message)}`; } catch { what = '(message)'; }
      const group = groups.get(what) ?? groups.set(what, { n: 0, overdue: -Infinity }).get(what); group.n++; group.overdue = Math.max(group.overdue, now - (event.when ?? now));
    }
    out.push(`event queue (${queue.length}): ${[...groups].sort((a, b) => b[1].n - a[1].n).slice(0, 3).map(([what, g]) => `${g.n}× ${what}${g.overdue > 0 ? `, max delay ${Math.round(g.overdue)} ms` : ''}`).join('; ')}`);
  });
  part(() => {   // a thread that has been executing for a long time without returning
    const tb = runtime.tb?.snapshot(); if (!tb) return;
    for (const [name, ms] of tb.threads ?? []) {
      if (ms < 10000) continue;
      const thread = runtime.scheduler?.threads?.find(candidate => candidate.name === name); if (!thread || !(thread.frames?.length > 0)) continue;
      const frames = thread.frames.filter(frame => frame.method).slice(-6).reverse().map(frame => `${dotted(frame.method.owner)}.${frame.method.name}`);
      const hot = runtime.profile?.topOf?.(name, 3) ?? [];
      out.push(`thread ${name} running for ${Math.round(ms / 1000)} s without returning (${thread.state}): ${frames.join(' ← ') || '(no Java frames)'}${hot.length ? `; hottest methods: ${hot.join(', ')}` : ''}`);
    }
  });
  part(() => {   // (f) busiest methods
    const busiest = heartbeat?.busiest?.length ? heartbeat.busiest : runtime.profile?.top?.(5);
    if (busiest?.length) out.push(`busiest methods: ${busiest.slice(0, 5).join(', ')}`);
  });
  return out.length > 1 ? [...out, '== end of summary =='] : [];
}

const IDLE_WAIT = /LockSupport\.park|Unsafe\.park|Object\.wait|ThreadPoolExecutor\.getTask|ConditionObject\.await|CountDownLatch\.await|Semaphore\.acquire|SynchronousQueue|LinkedBlockingQueue\.take|DelayedWorkQueue|AbstractQueuedSynchronizer|Thread\.sleep|CoroutineScheduler\$Worker\.park|parkNanos|\.awaitNanos|Looper\.loop/;
/** Groups threads by name pattern and state; returns { groups: ['45× pool-N-thread-N [blocked: LockSupport.park]'], shown: [threads worth printing in full] }. */
export function collapseThreads(runtime, threads, mainThread) {
  const groups = new Map(), shown = [];
  for (const thread of threads) {
    const frames = (thread.frames ?? []).slice(-4).map(frame => frame.method?.key ?? '');
    const idle = thread !== mainThread && thread.state === 'blocked' && (frames.length === 0 || frames.some(key => IDLE_WAIT.test(key)));
    if (!idle) { shown.push(thread); continue; }
    const pattern = String(thread.name ?? '?').replace(/\d+/g, 'N'), reason = thread.blocked?.reason ?? 'waiting', key = `${pattern} [${thread.state}: ${reason}]`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return { groups: [...groups].sort((a, b) => b[1] - a[1]).map(([key, n]) => `${n}× ${key}`), shown };
}
