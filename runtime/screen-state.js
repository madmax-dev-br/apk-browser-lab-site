// "Screen state": a plain-text picture of what the VM shows and why it may be blank, for "Copy diagnostics" and for a button that works without any error. Read-only on the VM.
// Pure data: no app or library names are written here; class names come from the running app and only reach the user's clipboard.
import { reportSummary, collapseThreads } from './report-summary.js?v=57e968aaaf17';
import { ignoredActivitiesLine } from './ignored-activities.js?v=57e968aaaf17';
const MiB = 1024 * 1024, BYTES_PER_OBJECT = 1600;
const STAGES = { 0: 'destroyed', 1: 'created', 2: 'stopped', 3: 'started/paused', 4: 'resumed (foreground)' };
const dotted = type => String(type ?? '?').replace(/^L/, '').replace(/;$/, '').replaceAll('/', '.');
const isCompose = type => /(^|\.)(AndroidComposeView|ComposeView|AbstractComposeView)$/.test(dotted(type));
const sizeOf = view => ({ width: Math.max(0, (view.bounds?.right ?? 0) - (view.bounds?.left ?? 0)), height: Math.max(0, (view.bounds?.bottom ?? 0) - (view.bounds?.top ?? 0)) });
const colorOf = background => background === null || background === undefined ? 'none' : typeof background === 'number' ? '#' + (background >>> 0).toString(16).padStart(8, '0') : typeof background === 'object' ? (background.color !== undefined ? '#' + (background.color >>> 0).toString(16).padStart(8, '0') : background.kind ?? background.type ?? 'drawable') : String(background);

/** The View tree of one root: lines (depth <= maxDepth, at most maxLines) plus aggregate facts used by the blank-screen verdict. */
function walkTree(runtime, root, { maxDepth = 6, maxLines = 80 } = {}) {
  const lines = [], facts = { views: 0, visibleDrawn: 0, zero: 0, invisible: 0, composeHosts: [], truncated: false };
  const seen = new Set();
  const visit = (ref, depth, ancestorsVisible) => {
    const view = runtime.object(ref); if (seen.has(view.id) || seen.size > 4096) return; seen.add(view.id); facts.views++;
    const { width, height } = sizeOf(view), visibility = view.visibility ?? 0, alpha = view.alpha ?? 1, visible = ancestorsVisible && visibility === 0 && alpha > 0;
    if (width === 0 || height === 0) facts.zero++;
    if (!visible) facts.invisible++;
    if (visible && width > 0 && height > 0) facts.visibleDrawn++;
    if (isCompose(view.type)) facts.composeHosts.push({ ref, view, width, height, visible });
    if (depth <= maxDepth) {
      if (lines.length < maxLines) {
        const flags = [];
        if (visibility !== 0) flags.push(visibility === 4 ? 'INVISIBLE' : 'GONE'); if (alpha === 0) flags.push('alpha=0'); if (width === 0 || height === 0) flags.push('0x0');
        if (view.willNotDraw) flags.push('willNotDraw'); if (view.layoutRequested || view.layoutRequired) flags.push('layout pending'); if (view.displayListDirty) flags.push('redraw pending'); if (view.laidOut === false) flags.push('no layout'); if (view.attached === false) flags.push('detached');
        lines.push(`${'  '.repeat(depth)}${dotted(view.type)}${view.androidId ? ` #${view.androidId}` : ''} [${view.bounds ? `${view.bounds.left},${view.bounds.top},${view.bounds.right},${view.bounds.bottom}` : 'no bounds'}] children=${(view.children ?? []).length} background=${colorOf(view.background)}${alpha !== 1 ? ` alpha=${alpha}` : ''}${flags.length ? ' ⚠ ' + flags.join(', ') : ''}`);
      } else facts.truncated = true;
    }
    for (const child of view.children ?? []) visit(child, depth + 1, visible);
  };
  visit(root, 0, true);
  if (facts.truncated) lines.push('  … (tree truncated)');
  return { lines, facts };
}

function composeFacts(runtime, host, semantics) {
  const out = { size: `${host.width}x${host.height}`, attached: host.view.attached !== false, visible: host.visible };
  const view = host.view, interesting = [];
  for (const [key, value] of view.fields ?? []) if (/composition|recomposer|parentContext|ownerView/i.test(key) && value) interesting.push(key.split('->').pop().split(':')[0]);
  out.fieldsWithValue = interesting;
  const owner = semantics?.owners?.find(candidate => candidate.ownerViewId === view.id);
  out.owner = owner ? { nodes: owner.nodes.length, placed: owner.nodes.filter(n => n.placed).length, withText: owner.nodes.filter(n => n.texts?.length).length, invisible: owner.nodes.filter(n => n.invisibleToUser).length, width: owner.width, height: owner.height, outside: owner.nodes.filter(n => n.placed && n.boundsInRoot && (n.boundsInRoot.right <= 0 || n.boundsInRoot.bottom <= 0 || n.boundsInRoot.left >= owner.width || n.boundsInRoot.top >= owner.height)).length } : null;
  return out;
}

/** { text, blank, reasons[] } for the running VM. `semantics` is the Compose semantics snapshot (optional), `heartbeat` the last monitor snapshot (optional). */
export function buildScreenState(runtime, { semantics = null, heartbeat = null } = {}) {
  const platform = runtime.platform, out = [], reasons = [];
  const tasks = platform.tasks ?? [], frames = platform.allFrames?.() ?? [];
  const top = frames.length ? frames[frames.length - 1] : null;
  out.push('Screen state');
  if (runtime.methodOverrides) out.push(`ATTENTION: replaced method returns ACTIVE (${runtime.methodOverrides.size} methods): their original code did not run; debugging tool.`);
  if (runtime.platform?.ignoredActivities?.size) out.push(`ATTENTION: ${ignoredActivitiesLine(runtime)}; those launches did not happen (debugging tool).`);
  const summaryAt = out.length;
  // ---- activity stack
  out.push('Activity stack (task: Activity, stage):');
  for (const task of tasks) for (const frame of task.frames) out.push(`  task ${task.id}: ${dotted(frame.type)}, ${STAGES[frame.lifecycleStage] ?? frame.lifecycleStage}${frame.finished ? ', finished' : ''}${frame === top ? '  ← top' : ''}`);
  if (!tasks.length) out.push('  (none — ' + (platform.taskClosed ? 'the task was ended' : 'no Activity was started') + ')');
  // ---- window and view tree
  let roots = []; try { roots = platform.viewRoots?.(runtime) ?? []; } catch { /* no window */ }
  if (!roots.length && runtime.root) roots = [{ root: runtime.root, window: null }];
  const hosts = [];
  if (!roots.length) reasons.push('no window/root view exists');
  roots.forEach((entry, index) => {
    const rootView = runtime.object(entry.root), { width, height } = sizeOf(rootView);
    out.push(`Window ${index + 1}${index === roots.length - 1 ? ' (top)' : ''}: root ${dotted(rootView.type)} ${width}x${height}, windowBackground=${colorOf(entry.windowBackground)}`);
    const { lines, facts } = walkTree(runtime, entry.root);
    out.push(...lines.map(line => '  ' + line));
    out.push(`  summary: ${facts.views} views, ${facts.visibleDrawn} visible with area, ${facts.zero} with 0x0, ${facts.invisible} invisible/alpha 0`);
    if (index === roots.length - 1) {
      if (width === 0 || height === 0) reasons.push(`the top window measures ${width}x${height}`);
      else if (facts.views > 0 && facts.visibleDrawn === 0) reasons.push('everything invisible/0x0: no view has visible area');
      hosts.push(...facts.composeHosts);
    }
  });
  // ---- compose
  out.push('Compose:');
  if (!hosts.length) out.push('  no ComposeView/AndroidComposeView in the top window');
  const frameState = platform.viewWindowHost?.frameState?.() ?? null;
  for (const host of hosts) {
    const facts = composeFacts(runtime, host, semantics);
    out.push(`  ${dotted(host.view.type)}: ${facts.size}, ${facts.attached ? 'attached' : 'DETACHED'}, ${facts.visible ? 'visible' : 'INVISIBLE'}; composition fields filled: ${facts.fieldsWithValue.join(', ') || 'none'}`);
    if (facts.owner) out.push(`    semantics: ${facts.owner.nodes} nodes (${facts.owner.placed} placed, ${facts.owner.withText} with text, ${facts.owner.invisible} invisible, ${facts.owner.outside} outside the bounds ${facts.owner.width}x${facts.owner.height})`);
    else out.push('    semantics: no semantics owner on this view' + (/AndroidComposeView$/.test(dotted(host.view.type)) ? ' (the composition created no nodes)' : ' (it is the container; the nodes live in the AndroidComposeView)'));
    const wrapper = !/AndroidComposeView$/.test(dotted(host.view.type));
    if (host.width === 0 || host.height === 0) reasons.push('the ComposeView measures 0x0 (clipped to 0)');
    else if (host.view.attached === false) reasons.push('the ComposeView is not attached to the window');
    else if (wrapper) { if (!facts.fieldsWithValue.includes('composition')) reasons.push('composition not created: the ComposeView has no composition'); }
    else if (!facts.owner || facts.owner.nodes === 0) reasons.push('composition not created: the AndroidComposeView produced no semantics node');
    else if (facts.owner.placed === 0) reasons.push('the composition exists but no node was placed (layout did not run)');
    else if (facts.owner.outside === facts.owner.placed) reasons.push('all the content is beyond the window bounds');
    else if (facts.owner.invisible === facts.owner.nodes) reasons.push('all the content is invisible (alpha 0)');
    else if (facts.owner.withText === 0 && facts.owner.placed <= 2) reasons.push('the composition has few nodes and no text');
  }
  if (frameState) {
    out.push(`  frame clock: ${frameState.framesRun} frames produced, ${frameState.callbacksRun} callbacks run, ${frameState.pendingFrames} pending${Number.isFinite(frameState.nextFrameAt) ? ` (next in ${Math.round(frameState.nextFrameAt - platform.clock.now())} virtual ms)` : ''}, callbacks of detached views: ${frameState.detachedCallbacks}`);
    if (hosts.length && frameState.framesRun === 0) reasons.push('no frame was produced (the frame clock never ran)');
    if (hosts.length && frameState.framesRun === 0 && frameState.pendingFrames === 0) reasons.push('no frame callback is scheduled: the composition did not ask for a frame');
  }
  out.push(`  first frame confirmed: ${(frameState?.framesRun ?? 0) > 0 || (platform.lastFrameMs ?? 0) > 0 ? 'yes' : 'no'}`);
  // ---- bars and insets
  let bars = null; try { bars = platform.systemBarsHost?.snapshot?.(runtime) ?? null; } catch { /* not modelled */ }
  out.push(`System bars/insets: ${bars ? JSON.stringify(bars).slice(0, 400) : 'not available'}`);
  // ---- queued work
  const now = platform.clock.now(), queue = platform.eventQueue ?? [];
  out.push(`Event queue (${queue.length}, now=${Math.round(now)} virtual ms):`);
  for (const event of queue.slice(0, 12)) {
    let what; try { what = event.platformTask ? `host task ${event.platformTask.name || '(anonymous)'}` : event.windowFrameTime !== undefined ? 'frame (Choreographer)' : `Handler ${dotted(runtime.typeOf(event.handler))} → ${platform.looperHost.callbackOf(runtime, event.message) ? dotted(runtime.typeOf(platform.looperHost.callbackOf(runtime, event.message))) : 'what=' + platform.looperHost.whatOf(runtime, event.message)}`; } catch { what = 'event'; }
    out.push(`  in ${Math.round((event.when ?? now) - now)} ms: ${what}`);
  }
  if (queue.length > 12) out.push(`  … +${queue.length - 12}`);
  // ---- why layout is pending
  const layout = platform.viewLayoutHost?.detail?.(runtime), scheduler = runtime.scheduler, mainThread = scheduler.main;
  if (layout) {
    out.push(`Layout: ${layout.pending ? 'PENDING' : 'no pass pending'}; measure/layout task in the queue: ${layout.queued ? 'yes' : 'no'}`);
    for (const root of layout.roots) out.push(`  root ${dotted(root.type)}: ${root.attached ? 'attached' : 'NOT attached to the window (the pass is only scheduled after attaching)'}, task ${root.queued ? 'in the queue' : 'not scheduled'}`);
    if (layout.pending && layout.roots.some(root => root.attached)) {
      const head = queue[0], running = runtime.thread?.frames?.length > 0;
      const mainState = mainThread ? `${mainThread.state}${mainThread.blocked ? ` (${mainThread.blocked.reason ?? 'waiting'})` : ''}` : 'no main thread';
      out.push(`  why it did not run: ${running ? 'a thread is running Java code right now (event in progress; the pass only runs between events)' : mainThread?.state === 'blocked' ? `the main thread is blocked: ${mainState}` : head && (head.when ?? now) > now ? `the next event is only due in ${Math.round(head.when - now)} virtual ms` : 'the queue has events before the layout pass'}; main thread: ${mainState}`);
    }
  }
  const shortKey = key => String(key ?? '?').replace(/^L/, '').replace(/;->/, '.');
  const wakeOp = runtime.monitor.op ?? (runtime.monitor.lastWakes ? { wakes: runtime.monitor.lastWakes } : null); if (wakeOp?.wakes?.size) out.push('Thread wake-ups in this operation (thread · primitive · cause): ' + runtime.monitor.wakeRows(wakeOp, 5).map(row => `${row.count}× ${row.key}`).join('; '));
  out.push(runtime.monitor.executionLine());
  const anonymous = [...(platform.anonymousTaskSites ?? [])].sort((a, b) => b[1] - a[1]).slice(0, 6);
  out.push(`Host tasks without a root list (queued with conservative roots), by origin: ${anonymous.length ? anonymous.map(([site, count]) => `${count}× ${site}`).join('; ') : 'none'}`);
  out.push('Threads (name, state, wait, 6 innermost frames):');
  const collapsed = collapseThreads(runtime, scheduler.threads, mainThread);
  for (const group of collapsed.groups) out.push(`  ${group} (idle pool wait; omitted)`);
  for (const thread of [...(mainThread ? [mainThread] : []), ...collapsed.shown.filter(candidate => candidate !== mainThread)]) {
    const frames = (thread.frames ?? []).slice(-6).reverse().map(frame => frame.method ? shortKey(frame.method.key) : frame.cont ? '(host call)' : '?');
    let target = ''; try { if (thread.blocked) target = `waiting: ${thread.blocked.reason ?? '?'}${thread.blocker ? ' on ' + dotted(runtime.typeOf(thread.blocker)) : ''}`; } catch { target = `waiting: ${thread.blocked?.reason ?? '?'}`; }
    out.push(`  ${thread.name}${thread === mainThread ? ' [main]' : ''}: ${thread.state}${thread.nestedDepth ? `, inside a nested native call (${thread.nestedDepth})` : ''}${target ? ', ' + target : ''}${runtime.initDepth && thread.state === 'blocked' && /class init/i.test(String(thread.blocked?.reason)) ? ' [class initialization]' : ''}`);
    for (const frame of frames) out.push(`      ${frame}`);
  }
  if (heartbeat) out.push(`Last VM signal: ${heartbeat.operation ?? 'idle'}, ${heartbeat.thread ?? 'no thread'}, host call: ${heartbeat.hostCall ?? 'none'}, events: ${heartbeat.events}, instructions: ${heartbeat.instructions}`);
  // ---- memory
  const live = runtime.heap.size, mib = Math.round(live * BYTES_PER_OBJECT / MiB);
  out.push(`VM memory: ${live} objects of ${runtime.maxHeapObjects} (${Math.round(100 * live / runtime.maxHeapObjects)}%), ~${mib} MiB estimated; collections: ${runtime.gcStats?.collections ?? 0}`);
  // ---- swallowed exceptions
  const caught = runtime.caughtExceptions;
  out.push(`Exceptions caught by the app code and discarded (${caught?.total ?? 0} in total; first ${Math.min(15, caught?.distinct.size ?? 0)} distinct):`);
  for (const [, entry] of [...(caught?.distinct ?? [])].slice(0, 15)) out.push(`  ${entry.count}× ${entry.type}${entry.message ? ': ' + entry.message : ''}  (caught in ${entry.where})`);
  if (!caught?.total) out.push('  (none)');
  { const uncaught = runtime.uncaughtText?.(); if (uncaught) out.push(uncaught); }
  { const failed = runtime.threadFailureText?.(); if (failed) out.push(failed); }
  const blank = reasons.length > 0;
  // The "Screen:" lines of the summary, read back from the sections above (activity on top, first-frame verdict, Compose, layout)
  const screenLines = [], find = pattern => out.find(line => pattern.test(line));
  { const top = find(/← top/)?.trim().replace(/^task \d+: /, '').replace(/\s+← top$/, ''); screenLines.push(`Screen: ${top ?? 'no Activity'} — ${blank ? 'first frame BLANK: ' + reasons.join('; ') : 'the screen has content'}`);
    const semantics = find(/semantics: \d+ nodes/)?.trim(), frames = find(/frame clock:/)?.trim(); if (semantics || frames) screenLines.push(`  Compose: ${[semantics?.replace(/^semantics: /, 'semantics '), frames?.replace(/^frame clock: /, 'frames ')].filter(Boolean).join('; ')}`);
    const layout = find(/^Layout: /), why = find(/why it did not run:/)?.trim(); if (layout) screenLines.push(`  ${layout}${why ? '; ' + why : ''}`); }
  out.splice(summaryAt, 0, ...reportSummary(runtime, { heartbeat, tela: screenLines }));
  if (blank) out.splice(1, 0, `first frame blank — reason(s): ${reasons.join('; ')}`);
  else out.splice(1, 0, 'the screen has content: no reason for a blank screen found');
  return { text: spaced(out), blank, reasons, tela: screenLines };
}

/** The report as text with room between its parts: each entry of the Summary is set off by a blank line, and each section after it (Activities, windows, Compose, queue, threads, memory,
 * exceptions...) starts after a blank line and a rule, so that a photo or a printout shows where one part ends. Lines that start with spaces stay with the entry above them. */
function spaced(lines) {
  const RULE = '────────────────────────────────────────';
  const out = []; let inSummary = false;
  lines.flatMap(entry => String(entry).split('\n')).forEach((line, index) => {   // a part that returned several lines at once (execution, GC) is split so each of its sections is set off too
    if (/^== (Summary|Resumo) ==$/.test(line)) { out.push('', line); inSummary = true; return; }
    if (/^== (end of summary|fim do resumo) ==$/.test(line)) { out.push('', line); inSummary = false; return; }
    const topLevel = index > 1 && line !== '' && !/^\s/.test(line);
    if (topLevel && inSummary) out.push('');
    else if (topLevel) out.push('', RULE);
    out.push(line);
  });
  return out.join('\n');
}
