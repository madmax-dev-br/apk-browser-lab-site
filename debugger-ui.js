// The debugger UI of the Code tool (docs/DEBUGGER.md, "The debugger in the Code tool"): a column beside the Code browser's reader with the toolbar (attach, pause, resume,
// step over / into / out, run to cursor, detach), the paused thread's call stack, variables, a watch list and the exception it stopped on, the threads and the breakpoints.
// Breakpoints are set in the reader's gutter (src/code-browser-api.js onGutterClick: a click toggles one, Shift+click opens a small form for a condition, a hit count or a
// log message) and drawn there with setMarkers; the paused line is highlighted and the reader follows the paused pc and the frame chosen in the call stack. While a thread is
// held the page says so near the device and in the status bar (`page.paused`), and the device's screen explains that it does not take input until the VM resumes.
// Everything goes through the page's debugger controller (src/debugger-controller.js), shared with plugins and MCP. Keyboard: F8 resume, F10 over, F11 into, Shift+F11 out,
// F9 toggles a breakpoint on the selected line. DOM only through `root` (the Code tool's <details>) and its document; no work at all while nobody attached, and nothing
// rendered or read while the tool is closed (it catches up when it opens; the page's paused indicators come from src/code-tool-loader.js then). Loaded on first use.
import { pausedInfo, pauseReasonText } from './code-tool-loader.js?v=6e6d833f3663';

const shortClass = name => { const text = String(name ?? ''); return text.slice(text.lastIndexOf('.') + 1); };
const dottedOf = descriptor => { const d = String(descriptor ?? ''); return d.startsWith('L') && d.endsWith(';') ? d.slice(1, -1).replaceAll('/', '.') : d; };
const descriptorOf = name => { const text = String(name ?? ''); return text.startsWith('L') && text.endsWith(';') ? text : `L${text.replaceAll('.', '/')};`; };
const ownerOfKey = key => { const at = String(key ?? '').indexOf('->'); return at > 0 ? String(key).slice(0, at) : null; };
const WATCH_KEY = 'apkweb.debugger.watch.v1';
const PRIMITIVES = new Set(['int', 'long', 'short', 'byte', 'char', 'boolean', 'float', 'double']);

/** A value as the Variables and Watch rows show it: { text, kind, handle }. */
export function valueText(value, type = null) {
  if (value === null || value === undefined) return { text: 'null', kind: 'null', handle: null };
  if (typeof value === 'string') return type && PRIMITIVES.has(type) ? { text: value, kind: 'number', handle: null } : type === 'char' ? { text: `'${value}'`, kind: 'string', handle: null } : { text: JSON.stringify(value.length > 200 ? value.slice(0, 200) + '…' : value), kind: 'string', handle: null };
  if (typeof value === 'number' || typeof value === 'bigint') return { text: String(value), kind: 'number', handle: null };
  if (typeof value === 'boolean') return { text: String(value), kind: 'boolean', handle: null };
  if (typeof value === 'object') {
    if (value.$kind === 'list' || value.$kind === 'set') return { text: `${shortClass(value.$type ?? value.$kind)} size ${value.size ?? '?'}`, kind: 'object', handle: value.$handle ?? null };
    if (value.$kind === 'map') return { text: `${shortClass(value.$type ?? 'Map')} size ${value.size ?? '?'}`, kind: 'object', handle: value.$handle ?? null };
    if (value.$kind === 'array' || Array.isArray(value.items)) return { text: `${value.$type ?? 'array'}[${value.length ?? value.size ?? '?'}]`, kind: 'object', handle: value.$handle ?? null };
    if (value.$type) return { text: `${shortClass(value.$type)} ${value.$handle ? `(${value.$handle.split('.')[0]})` : ''}`.trim(), kind: 'object', handle: value.$handle ?? null };
    try { return { text: JSON.stringify(value).slice(0, 200), kind: 'object', handle: null }; } catch { return { text: String(value), kind: 'object', handle: null }; }
  }
  return { text: String(value), kind: 'other', handle: null };
}

/**
 * root: the Code tool's <details id="code-browser"> (the column goes into its .cb-body). api: src/code-browser-api.js. controller: src/debugger-controller.js.
 * page: { paused(info | null) } -- the page shows "Paused in the debugger" near the device and in the status bar; info = { where, thread, mode, resume() }.
 */
export function createDebuggerUi({ root, api, controller, page = null, trace = () => {}, storage = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })(), win = globalThis.window, doc = globalThis.document, getPackage = () => null }) {
  const h = (tag, props = {}, ...children) => {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) { if (v === undefined || v === null || v === false) continue; if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : String(v)); }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child);
    return el;
  };
  const U = { frames: null, frame: 0, locals: null, threads: [], expanded: new Map(), watch: loadWatch(), watchValues: new Map(), seq: 0, popover: null, note: '', busy: false, lastPausedSeq: null, openKey: null, dirty: false };
  function loadWatch() { try { const list = JSON.parse(storage?.getItem?.(WATCH_KEY) ?? '[]'); return Array.isArray(list) ? list.filter(item => typeof item === 'string').slice(0, 30) : []; } catch { return []; } }
  function saveWatch() { try { storage?.setItem?.(WATCH_KEY, JSON.stringify(U.watch)); } catch { /* not kept */ } }

  // ---- markup ------------------------------------------------------------------------------------------------------------------------------------------------------------
  const button = (cls, label, title, onclick) => h('button', { type: 'button', class: `dbg-tool ${cls}`, title, 'aria-label': title, onclick }, h('span', { class: 'dbg-glyph', 'aria-hidden': 'true', text: label }));
  const tools = {
    attach: button('dbg-attach', 'Attach', 'Attach the debugger (setting a breakpoint attaches it too)', () => act(() => controller.attach())),
    pause: button('dbg-pause', '❚❚', 'Pause every thread between two VM events', () => act(() => controller.command('pause'))),
    resume: button('dbg-resume', '▶', 'Resume (F8)', () => act(resume)),
    over: button('dbg-over', '↷', 'Step over (F10)', () => act(() => step('over'))),
    into: button('dbg-into', '↓', 'Step into (F11)', () => act(() => step('into'))),
    out: button('dbg-out', '↑', 'Step out (Shift+F11)', () => act(() => step('out'))),
    runTo: button('dbg-run-to', '⇥', 'Run to the selected line', () => act(runToCursor)),
    detach: button('dbg-detach', 'Detach', 'Detach: every breakpoint leaves the VM and the threads go on (your breakpoints stay saved)', () => act(() => controller.detach())),
  };
  tools.attach.querySelector('.dbg-glyph').className = 'dbg-word'; tools.detach.querySelector('.dbg-glyph').className = 'dbg-word';
  const toolbar = h('div', { class: 'dbg-toolbar', role: 'toolbar', 'aria-label': 'Debugger' }, tools.attach, tools.pause, tools.resume, h('span', { class: 'dbg-sep', 'aria-hidden': 'true' }), tools.over, tools.into, tools.out, tools.runTo, h('span', { class: 'dbg-spacer' }), tools.detach);
  const status = h('p', { class: 'dbg-status', role: 'status', 'aria-live': 'polite' });
  const snapshotNote = h('p', { class: 'dbg-snapshot', hidden: true });
  const section = (cls, title, ...body) => { const s = h('details', { class: `dbg-section ${cls}`, open: true }, h('summary', {}, h('span', { class: 'dbg-section-title', text: title }), h('span', { class: 'dbg-section-count' })), ...body); return s; };
  const exceptionBody = h('div', { class: 'dbg-exception-body' });
  const exceptionSection = section('dbg-exception', 'Exception', exceptionBody); exceptionSection.hidden = true;
  const stackList = h('ol', { class: 'dbg-list dbg-stack', 'aria-label': 'Call stack' });
  const varsList = h('ul', { class: 'dbg-list dbg-vars', role: 'tree', 'aria-label': 'Variables' });
  const watchInput = h('input', { class: 'dbg-input dbg-watch-input', type: 'text', placeholder: 'Add an expression, e.g. sum + i * 10', 'aria-label': 'Watch expression', spellcheck: 'false', autocomplete: 'off' });
  const watchList = h('ul', { class: 'dbg-list dbg-watch', 'aria-label': 'Watch' });
  const threadsList = h('ul', { class: 'dbg-list dbg-threads', 'aria-label': 'Threads' });
  const bpList = h('ul', { class: 'dbg-list dbg-breakpoints', 'aria-label': 'Breakpoints' });
  const excClass = h('input', { class: 'dbg-input dbg-exc-class', type: 'text', placeholder: 'Exception class (empty: any)', 'aria-label': 'Exception class for an exception breakpoint', spellcheck: 'false' });
  const excCaught = h('input', { type: 'checkbox', class: 'dbg-exc-caught', checked: true }), excUncaught = h('input', { type: 'checkbox', class: 'dbg-exc-uncaught', checked: true });
  const excForm = h('form', { class: 'dbg-exc-form', onsubmit: event => { event.preventDefault(); act(addExceptionBreakpoint); } }, excClass,
    h('label', { class: 'dbg-check' }, excCaught, ' Caught'), h('label', { class: 'dbg-check' }, excUncaught, ' Uncaught'), h('button', { type: 'submit', class: 'cb-button', text: 'Add' }));
  const sections = {
    exception: exceptionSection,
    stack: section('dbg-stack-section', 'Call stack', stackList),
    vars: section('dbg-vars-section', 'Variables', varsList),
    watch: section('dbg-watch-section', 'Watch', h('form', { class: 'dbg-watch-form', onsubmit: event => { event.preventDefault(); addWatch(watchInput.value); } }, watchInput), watchList),
    threads: section('dbg-threads-section', 'Threads', threadsList),
    breakpoints: section('dbg-bp-section', 'Breakpoints', bpList, h('p', { class: 'dbg-hint', text: 'Click the gutter of the code to set one; Shift+click for a condition, a hit count or a log message.' }), excForm),
  };
  const panel = h('aside', { class: 'dbg', 'aria-label': 'Debugger' }, toolbar, status, snapshotNote, sections.exception, sections.stack, sections.vars, sections.watch, sections.threads, sections.breakpoints);
  const body = root.querySelector('.cb-body'); body.append(panel); body.classList.add('has-debugger');
  const stage = root.querySelector('.cb-stage'), view = root.querySelector('.cb-view');

  // ---- actions -----------------------------------------------------------------------------------------------------------------------------------------------------------
  async function act(fn) { try { await fn(); } catch (error) { setNote(`${error?.code ? `${error.code}: ` : ''}${error?.message ?? error}`); } }
  function setNote(text) { U.note = text; render(); }
  const pausedThread = () => controller.paused?.thread ?? null;
  async function resume() { if (!controller.paused) return; await controller.command('resume', {}); }
  /**
   * A step. On the Java tab (the paused method's class decompiled on screen), over and into go by Java statement: the step leaves the pcs of the current Java line and stops at
   * the first pc of another (src/debugger.js step `pcs`, `stops`); elsewhere, and for out, by the source line table as before.
   */
  async function step(kind) {
    const thread = pausedThread(); if (!thread) throw Object.assign(new Error('Nothing is paused: set a breakpoint or pause first.'), { code: 'not-paused' });
    const here = controller.paused?.location, statement = kind !== 'out' && U.frame === 0 && here?.method ? api.javaStatement?.(here.method, here.pc) : null;
    await controller.command('step', { thread, kind, ...(statement ? { method: here.method, pcs: statement.pcs, stops: statement.stops } : {}) });
  }
  async function runToCursor() {
    const sel = api.currentSelection(); const at = sel?.line ? locationAtLine(sel.line) : null;
    if (!at) throw Object.assign(new Error('Select a line of a method that runs code first.'), { code: 'bad-args' });
    await controller.command('run-to', { thread: pausedThread() ?? undefined, method: at.key, pc: at.pc });
  }
  /** { key, pc, line } of a 1-based line: a Java line's first instruction; on smali, the instruction there or the first one after it in the same method (a .line or label line). */
  function locationAtLine(line) {
    if (api.locationAt) return api.locationAt(line);
    const d = api.document(); if (!d || d.kind !== 'class') return null;
    for (const m of d.methods) {
      if (line < m.startLine || line > m.endLine || !m.hasCode) continue;
      const hit = m.pcToLine.find(([, l]) => l >= line); return hit ? { key: m.key, pc: hit[0], line: hit[1] } : null;
    }
    return null;
  }
  async function toggleAtLine(line, { shift = false } = {}) {
    const at = locationAtLine(line); if (!at) { setNote(api.document()?.tab === 'java' ? 'Breakpoints go on the Java lines that run code (the ones with a pc in the gutter).' : 'Breakpoints go on the lines of a method with code.'); return; }
    if (shift) { openPopover(at); return; }
    await controller.toggleAt(at.key, at.pc);
  }
  async function addExceptionBreakpoint() {
    const name = excClass.value.trim(), caught = excCaught.checked, uncaught = excUncaught.checked;
    if (!caught && !uncaught) throw Object.assign(new Error('Tick caught, uncaught or both.'), { code: 'bad-args' });
    await controller.setBreakpoint({ type: 'exception', ...(name ? { exceptionClass: name } : {}), caught, uncaught });
    excClass.value = '';
  }
  function addWatch(expression) {
    const text = String(expression ?? '').trim(); if (!text || U.watch.includes(text)) { watchInput.value = ''; return; }
    U.watch.push(text); if (U.watch.length > 30) U.watch.shift(); saveWatch(); watchInput.value = ''; evaluateWatch().then(render);
  }

  // ---- the gutter --------------------------------------------------------------------------------------------------------------------------------------------------------
  api.onGutterClick(detail => { if ((detail.tab !== 'smali' && detail.tab !== 'java') || !detail.method) return; act(() => toggleAtLine(detail.line, { shift: detail.shiftKey })); });
  api.onOpen(() => { closePopover(); paintMarkers(); });
  function paintMarkers() {
    const d = api.document(); if (!d || d.kind !== 'class') return;
    const markers = new Map();
    for (const bp of controller.breakpoints()) {
      const sites = bp.spec?.type === 'location' ? [{ method: bp.spec.method, pc: bp.spec.pc }] : (bp.locations ?? []);
      for (const site of sites) { if (ownerOfKey(site.method) !== d.descriptor) continue; const line = api.lineForPc(site.method, site.pc); if (line && markers.get(line) !== 'breakpoint') markers.set(line, bp.enabled === false ? 'disabled' : 'breakpoint'); }
    }
    const here = currentLocation();
    if (here && ownerOfKey(here.method) === d.descriptor) { const line = api.lineForPc(here.method, here.pc); if (line) markers.set(line, 'current'); }
    api.setMarkers([...markers].map(([line, kind]) => ({ line, kind })));
  }
  /** The location the reader follows: the chosen frame of the paused thread, else the stop. */
  function currentLocation() {
    const p = controller.paused; if (!p) return null;
    const f = U.frames?.frames?.[U.frame]; return f && !f.host ? f : p.location ?? null;
  }
  async function reveal(location) {
    if (!location?.method) return;
    const descriptor = ownerOfKey(location.method) ?? descriptorOf(location.className);
    const key = `${location.method}@${location.pc}`; if (U.openKey === key && api.currentSelection()?.descriptor === descriptor) { paintMarkers(); return; }
    if (!root.open) { U.dirty = true; return; }   // closed meanwhile: shown when it opens
    U.openKey = key;
    try { await api.open(descriptor, { method: location.method, pc: location.pc }); } catch (error) { setNote(`The paused class cannot be shown: ${error?.message ?? error}`); }
    paintMarkers();
  }

  // ---- the condition / hit count / log message form ----------------------------------------------------------------------------------------------------------------------
  function openPopover(at) {
    closePopover();
    const existing = controller.breakpointAt(at.key, at.pc), spec = existing?.spec ?? {};
    const field = (label, cls, value, placeholder) => h('label', { class: 'dbg-pop-field' }, h('span', { text: label }), h('input', { class: `dbg-input ${cls}`, type: 'text', value: value ?? '', placeholder, spellcheck: 'false', autocomplete: 'off' }));
    const condition = field('Condition', 'dbg-pop-condition', spec.condition, 'i > 3 && name != null'), hits = field('Hit count', 'dbg-pop-hits', spec.hitCondition, '5, >= 5, % 5'), log = field('Log message', 'dbg-pop-log', spec.logMessage, 'i={i} sum={sum} (a logpoint never stops)');
    for (const f of [condition, hits, log]) { const input = f.querySelector('input'); input.value = input.getAttribute('value') ?? ''; }
    const where = h('p', { class: 'dbg-pop-where', text: `${shortClass(dottedOf(ownerOfKey(at.key)))}.${at.key.slice(at.key.indexOf('->') + 2)} at pc ${at.pc}` });
    const save = async () => {
      const values = { condition: condition.querySelector('input').value.trim(), hitCondition: hits.querySelector('input').value.trim(), logMessage: log.querySelector('input').value };
      if (!values.logMessage.trim()) values.logMessage = '';
      const spec2 = { type: 'location', method: at.key, pc: at.pc, ...(values.condition ? { condition: values.condition } : {}), ...(values.hitCondition ? { hitCondition: values.hitCondition } : {}), ...(values.logMessage ? { logMessage: values.logMessage } : {}) };
      if (existing) await controller.removeBreakpoint(existing.id);
      await controller.setBreakpoint(spec2); closePopover();
    };
    const form = h('form', { class: 'dbg-popover', role: 'dialog', 'aria-label': 'Breakpoint options', onsubmit: event => { event.preventDefault(); act(save); }, onkeydown: event => { if (event.key === 'Escape') { event.preventDefault(); closePopover(); } } },
      where, condition, hits, log,
      h('div', { class: 'dbg-pop-actions' }, existing ? h('button', { type: 'button', class: 'cb-button dbg-pop-remove', text: 'Remove', onclick: () => act(async () => { await controller.removeBreakpoint(existing.id); closePopover(); }) }) : null,
        h('button', { type: 'button', class: 'cb-button', text: 'Cancel', onclick: () => closePopover() }), h('button', { type: 'submit', class: 'cb-button cb-primary dbg-pop-save', text: existing ? 'Save' : 'Add breakpoint' })));
    const line = api.lineForPc(at.key, at.pc) ?? 1;
    const lineTop = (line - 1) * 18 - (view?.scrollTop ?? 0), room = view?.clientHeight ?? 400, FORM_H = 190;
    form.style.top = `${Math.max(4, lineTop + 22 + FORM_H > room ? lineTop - FORM_H - 4 : lineTop + 22)}px`;   // below the line, or above it near the bottom
    (stage ?? panel).append(form); U.popover = form;
    form.querySelector('input').focus();
  }
  function closePopover() { U.popover?.remove(); U.popover = null; }

  // ---- the paused view ---------------------------------------------------------------------------------------------------------------------------------------------------
  async function refreshPaused() {
    const p = controller.paused, seq = ++U.seq;
    if (!p) { U.frames = null; U.locals = null; U.frame = 0; U.openKey = null; render(); return; }
    if (U.lastPausedSeq !== p.seq) { U.lastPausedSeq = p.seq; U.frame = 0; U.expanded.clear(); }
    try {
      const [frames, threads] = await Promise.all([controller.command('frames', { thread: p.thread, count: 64 }), controller.command('threads')]);
      if (seq !== U.seq) return;
      U.frames = frames; U.threads = threads; await loadLocals(seq);
      await evaluateWatch();
    } catch (error) { if (seq === U.seq) U.note = `${error?.message ?? error}`; }
    if (seq !== U.seq) return;
    render(); await reveal(currentLocation());
  }
  async function loadLocals(seq = U.seq) {
    const p = controller.paused; if (!p) return;
    const f = U.frames?.frames?.[U.frame];
    if (!f || f.host) { U.locals = { locals: [], note: f?.host ? 'Host code (the lab\'s own JavaScript): no Java locals.' : '' }; return; }
    try { const out = await controller.command('locals', { thread: p.thread, frame: U.frame }); if (seq === U.seq) U.locals = out; }
    catch (error) { if (seq === U.seq) U.locals = { locals: [], note: error?.message ?? String(error) }; }
  }
  async function evaluateWatch() {
    const p = controller.paused; U.watchValues = new Map();
    if (!p) return;
    for (const expression of U.watch) {
      try { U.watchValues.set(expression, { ok: true, ...(await controller.command('evaluate', { thread: p.thread, frame: U.frame, expression })) }); }
      catch (error) { U.watchValues.set(expression, { ok: false, error: error?.message ?? String(error) }); }
    }
  }
  async function chooseFrame(index) { U.frame = index; U.expanded.clear(); const seq = ++U.seq; await loadLocals(seq); await evaluateWatch(); if (seq !== U.seq) return; render(); await reveal(currentLocation()); }
  async function expand(handle, row) {
    if (U.expanded.has(handle)) { U.expanded.delete(handle); render(); return; }
    try { const out = await controller.command('inspect', { handle, options: { depth: 1, maxFields: 100, maxItems: 50 } }); U.expanded.set(handle, out); }
    catch (error) { U.expanded.set(handle, { error: error?.message ?? String(error) }); }
    render(); row?.focus?.();
  }
  async function setLocal(local, text) {
    const p = controller.paused; if (!p) return;
    let value = text.trim();
    if (local.type === 'boolean') value = value === 'true'; else if (local.type === 'char') value = value.replace(/^'(.*)'$/, '$1'); else if (PRIMITIVES.has(local.type)) { const n = Number(value); if (!Number.isFinite(n)) throw Object.assign(new Error(`${value} is not a ${local.type}`), { code: 'bad-args' }); value = local.type === 'long' && !Number.isSafeInteger(n) ? value : n; }
    else if (local.type === 'java.lang.String') value = value.replace(/^"(.*)"$/, '$1');
    await controller.command('set-local', { thread: p.thread, frame: U.frame, name: local.name, value });
    await loadLocals(); await evaluateWatch(); render();
  }

  // ---- render ------------------------------------------------------------------------------------------------------------------------------------------------------------
  function render() {
    const st = controller.state(), p = st.paused, attached = st.attached, held = !!p;
    tools.attach.hidden = attached; tools.detach.hidden = !attached;
    tools.pause.disabled = !attached || held; tools.resume.disabled = !held;
    for (const t of [tools.over, tools.into, tools.out]) t.disabled = !held;
    tools.runTo.disabled = !held;
    panel.dataset.state = held ? 'paused' : attached ? 'running' : 'detached';
    status.textContent = U.note || (held ? `Paused in ${shortClass(p.location?.className)}.${p.location?.methodName ?? '?'}${p.location?.line ? `, line ${p.location.line}` : ''} (${reasonText(p)}; thread ${p.threadName ?? p.thread})` : attached ? `Running · ${st.breakpoints.length} breakpoint${st.breakpoints.length === 1 ? '' : 's'}${st.engine ? ` · ${st.engine === 'wasm' ? 'WebAssembly core' : 'JavaScript interpreter'}` : ''}` : 'Not attached · click the gutter of the code to set a breakpoint');
    U.note = '';
    // snapshot stops: honest about what they are
    const snap = st.lastSnapshot;
    snapshotNote.hidden = !snap || held;
    if (snap && !held) snapshotNote.textContent = `Snapshot only, no stepping: ${shortClass(snap.location?.className)}.${snap.location?.methodName ?? '?'} line ${snap.location?.line ?? '?'} was reported as it was and the thread went on (${snap.why ?? 'it runs inside host code'}).${st.channel ? '' : ' This page is not cross-origin isolated, so the Worker cannot be held inside host code (an input, a lifecycle callback): background threads and Looper messages on the WebAssembly core stop for real.'}`;
    // exception
    const ex = p?.exception; exceptionSection.hidden = !ex;
    if (ex) exceptionBody.replaceChildren(h('p', { class: 'dbg-exc-type', text: ex.type ?? 'exception' }), ex.message ? h('p', { class: 'dbg-exc-message', text: ex.message }) : null,
      h('p', { class: 'dbg-exc-meta', text: ex.caught ? `Caught${ex.catchLocation ? ` in ${shortClass(ex.catchLocation.className)}.${ex.catchLocation.methodName} line ${ex.catchLocation.line ?? '?'}` : ''}` : 'Uncaught: no Java frame of this run handles it' }),
      ex.handle ? h('button', { type: 'button', class: 'cb-link', text: 'Inspect the exception object', onclick: () => act(() => expand(ex.handle)) }) : null, ex.handle && U.expanded.has(ex.handle) ? objectRows(U.expanded.get(ex.handle), 0) : null);
    // stack
    const frames = held ? (U.frames?.frames ?? []) : [];
    setCount(sections.stack, frames.length ? `${frames.length}${U.frames?.total > frames.length ? ` of ${U.frames.total}` : ''}` : '');
    stackList.replaceChildren(...(held ? frames.map((f, index) => h('li', { class: `dbg-frame${index === U.frame ? ' is-current' : ''}${f.host ? ' is-host' : ''}`, tabindex: '0', role: 'button', 'aria-current': index === U.frame ? 'true' : null,
      onclick: () => act(() => chooseFrame(index)), onkeydown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); act(() => chooseFrame(index)); } } },
      f.host ? h('span', { class: 'dbg-frame-name', text: 'host code (the lab\'s JavaScript)' }) : [h('span', { class: 'dbg-frame-name', text: `${shortClass(f.className)}.${f.methodName}` }), h('span', { class: 'dbg-frame-where', text: `${f.source ?? ''}${f.line ? `:${f.line}` : ''} · pc ${f.pc}` })])) : [h('li', { class: 'dbg-empty', text: attached ? 'Running. The stack shows when a thread stops.' : 'Nothing to show while detached.' })]));
    // variables
    const locals = held ? (U.locals?.locals ?? []) : [];
    setCount(sections.vars, locals.length ? String(locals.length) : '');
    varsList.replaceChildren(...(held ? (locals.length ? locals.map(local => localRow(local)) : [h('li', { class: 'dbg-empty', text: U.locals?.note || (U.locals?.debugInfo === false ? 'This method has no debug info: see the registers.' : 'No locals here.') })]) : []));
    if (held && U.locals?.debugInfo === false && U.locals.registers?.length) varsList.append(...U.locals.registers.map(r => localRow({ name: r.alias ? `${r.register} (${r.alias})` : r.register, type: null, value: r.value, kind: 'register', register: r.register, readOnly: true })));
    // watch
    setCount(sections.watch, U.watch.length ? String(U.watch.length) : '');
    watchList.replaceChildren(...U.watch.map(expression => {
      const value = U.watchValues.get(expression), shown = !held ? { text: '(not paused)', kind: 'muted' } : !value ? { text: '…', kind: 'muted' } : value.ok ? valueText(value.value, value.type) : { text: value.error, kind: 'error' };
      return h('li', { class: 'dbg-row dbg-watch-row' }, h('code', { class: 'dbg-name', text: expression }), h('span', { class: `dbg-value v-${shown.kind}`, text: shown.text, title: value?.type ?? '' }),
        h('button', { type: 'button', class: 'dbg-x', title: `Remove ${expression}`, 'aria-label': `Remove the watch ${expression}`, text: '×', onclick: () => { U.watch = U.watch.filter(item => item !== expression); saveWatch(); render(); } }));
    }));
    // threads
    const threads = held ? U.threads : [];
    setCount(sections.threads, threads.length ? String(threads.length) : '');
    threadsList.replaceChildren(...threads.map(t => h('li', { class: `dbg-row dbg-thread${String(t.id) === String(p?.thread) ? ' is-current' : ''}` }, h('span', { class: 'dbg-name', text: t.name }), h('span', { class: 'dbg-value v-muted', text: t.stop ? `stopped: ${t.stop.reason}` : t.held ? 'suspended' : t.state }))));
    // breakpoints
    const bps = st.breakpoints;
    setCount(sections.breakpoints, bps.length ? String(bps.length) : '');
    bpList.replaceChildren(...(bps.length ? bps.map(bp => breakpointRow(bp)) : [h('li', { class: 'dbg-empty', text: 'None yet.' })]));
    page?.paused?.(held ? { ...pausedInfo(p), resume: () => act(resume) } : null);
    paintMarkers();
  }
  const reasonText = pauseReasonText;
  const setCount = (s, text) => { s.querySelector('.dbg-section-count').textContent = text; };
  function localRow(local) {
    const shown = valueText(local.value, local.type), canEdit = !local.readOnly && (PRIMITIVES.has(local.type) || local.type === 'java.lang.String'), open = shown.handle && U.expanded.has(shown.handle);
    const value = h('span', { class: `dbg-value v-${shown.kind}${canEdit ? ' is-editable' : ''}`, text: shown.text, title: canEdit ? 'Double-click to change the value' : '' });
    if (canEdit) value.addEventListener('dblclick', () => editValue(value, local, shown.text));
    const row = h('li', { class: 'dbg-row dbg-var', role: 'treeitem', 'aria-expanded': shown.handle ? String(!!open) : null, tabindex: shown.handle ? '0' : null },
      h('span', { class: 'dbg-twist', 'aria-hidden': 'true', text: shown.handle ? (open ? '▾' : '▸') : '' }), h('span', { class: 'dbg-name', text: local.name }), local.type ? h('span', { class: 'dbg-type', text: shortClass(local.type) }) : null, value);
    if (shown.handle) { row.addEventListener('click', event => { if (event.target.closest?.('input')) return; act(() => expand(shown.handle, row)); }); row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); act(() => expand(shown.handle, row)); } }); }
    if (open) { const frag = h('li', { class: 'dbg-children', role: 'group' }, objectRows(U.expanded.get(shown.handle), 1)); return h('li', { class: 'dbg-var-group' }, h('ul', { class: 'dbg-list' }, row, frag)); }
    return row;
  }
  function objectRows(obj, depth) {
    if (!obj) return h('p', { class: 'dbg-empty', text: '…' });
    if (obj.error) return h('p', { class: 'dbg-empty v-error', text: obj.error });
    const entries = obj.fields ? Object.entries(obj.fields) : Array.isArray(obj.items) ? obj.items.map((item, i) => [Array.isArray(item) ? String(item[0]) : `[${i}]`, Array.isArray(item) ? item[1] : item]) : obj.entries ? obj.entries.map(e => [JSON.stringify(e.key ?? e[0]), e.value ?? e[1]]) : [];
    const list = h('ul', { class: 'dbg-list dbg-fields', style: `--depth:${depth}` }, ...entries.slice(0, 100).map(([name, value]) => {
      const shown = valueText(value), open = shown.handle && U.expanded.has(shown.handle);
      const row = h('li', { class: 'dbg-row dbg-var', tabindex: shown.handle ? '0' : null }, h('span', { class: 'dbg-twist', 'aria-hidden': 'true', text: shown.handle ? (open ? '▾' : '▸') : '' }), h('span', { class: 'dbg-name', text: name }), h('span', { class: `dbg-value v-${shown.kind}`, text: shown.text }));
      if (shown.handle) row.addEventListener('click', event => { event.stopPropagation?.(); act(() => expand(shown.handle, row)); });
      return open && depth < 6 ? h('li', { class: 'dbg-var-group' }, row, objectRows(U.expanded.get(shown.handle), depth + 1)) : row;
    }));
    if (!entries.length) list.append(h('li', { class: 'dbg-empty', text: `${obj.$type ?? 'object'}: no fields` }));
    if (obj.$more || entries.length > 100) list.append(h('li', { class: 'dbg-empty', text: 'more not shown' }));
    return list;
  }
  function editValue(span, local, current) {
    const input = h('input', { class: 'dbg-input dbg-edit', type: 'text', 'aria-label': `New value of ${local.name}`, spellcheck: 'false' }); input.value = current;
    const done = commit => { if (input.dataset.done) return; input.dataset.done = '1'; if (commit) act(() => setLocal(local, input.value)); else render(); };
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); done(true); } else if (event.key === 'Escape') { event.preventDefault(); done(false); } });
    input.addEventListener('blur', () => done(false));
    span.replaceChildren(input); input.focus(); input.select?.();
  }
  function breakpointRow(bp) {
    const toggle = h('input', { type: 'checkbox', class: 'dbg-bp-enabled', 'aria-label': `Enable ${bp.where}`, checked: bp.enabled !== false });
    toggle.addEventListener('change', () => act(() => controller.enableBreakpoint(bp.id, toggle.checked)));
    const tags = [bp.condition ? `if ${bp.condition}` : null, bp.hitCondition ? `hits ${bp.hitCondition}` : null, bp.logMessage !== undefined ? 'logpoint' : null, bp.resolved === false ? 'pending' : null, bp.verified === false ? 'no code here' : null].filter(Boolean);
    const label = bp.type === 'location' ? `${shortClass(dottedOf(ownerOfKey(bp.spec?.method)))}.${String(bp.spec?.method ?? '').split('->')[1]?.split('(')[0] ?? '?'}${bp.locations?.[0]?.line ? ` line ${bp.locations[0].line}` : ''} · pc ${bp.spec?.pc}`
      : bp.type === 'line' ? `${shortClass(bp.spec?.className)}${bp.locations?.[0]?.methodName ? `.${bp.locations[0].methodName}` : ''} line ${bp.spec?.line}`
      : bp.type === 'exception' ? `${bp.spec?.exceptionClass ? shortClass(bp.spec.exceptionClass) : 'Any exception'}${bp.spec?.caught === false ? ', uncaught' : bp.spec?.uncaught === false ? ', caught' : ''}`
      : bp.where;
    const row = h('li', { class: `dbg-row dbg-bp${bp.enabled === false ? ' is-disabled' : ''}`, 'data-id': bp.id, title: `${bp.where}${bp.message ? `\n${bp.message}` : ''}` }, toggle,
      h('button', { type: 'button', class: 'dbg-bp-where cb-link', text: label, onclick: () => act(() => showBreakpoint(bp)) }),
      tags.length ? h('span', { class: 'dbg-bp-tags', text: tags.join(' · ') }) : null,
      h('span', { class: 'dbg-bp-hits', text: bp.hits ? `${bp.hits}×` : '' }),
      bp.owner && bp.owner !== 'user' ? h('span', { class: 'dbg-bp-owner', text: bp.owner.replace(/^plugin:/, 'plugin ').replace(/^mcp:.*/, 'MCP') }) : null,
      h('button', { type: 'button', class: 'dbg-x', title: 'Remove', 'aria-label': `Remove the breakpoint ${bp.where}`, text: '×', onclick: () => act(() => controller.removeBreakpoint(bp.id)) }));
    return row;
  }
  async function showBreakpoint(bp) {
    const site = bp.spec?.type === 'location' ? { method: bp.spec.method, pc: bp.spec.pc } : bp.locations?.[0];
    if (!site?.method) { if (bp.spec?.className) await api.open(descriptorOf(bp.spec.className)); return; }
    root.open = true; await api.open(ownerOfKey(site.method), { method: site.method, pc: site.pc }); paintMarkers();
  }

  // ---- keyboard ----------------------------------------------------------------------------------------------------------------------------------------------------------
  const keyTarget = doc.documentElement ?? doc;
  keyTarget.addEventListener('keydown', event => {
    const key = event.key; if (!['F8', 'F9', 'F10', 'F11'].includes(key)) return;
    const st = controller.state(), held = !!st.paused;
    if (key === 'F9') { if (!root.open) return; const sel = api.currentSelection(); if (!sel?.line || sel.kind !== 'class') return; event.preventDefault(); act(() => toggleAtLine(sel.line)); return; }
    if (!held) return;
    event.preventDefault();
    if (key === 'F8') act(resume); else if (key === 'F10') act(() => step('over')); else if (key === 'F11') act(() => step(event.shiftKey ? 'out' : 'into'));
  });

  let javaPrepared = false;
  controller.onChange(() => {
    if (controller.attached && !javaPrepared) { javaPrepared = true; api.prepareJava?.(); }   // the user reads Java: the Worker loads the decompiler now, not while a thread is held
    if (!controller.attached) javaPrepared = false;
    if (!root.open) { U.dirty = true; page?.paused?.(controller.paused ? { ...pausedInfo(controller.paused), resume: () => act(resume) } : null); return; }   // closed: no render, no read
    const p = controller.paused; if ((p?.seq ?? null) !== U.lastPausedSeq || (!p && U.frames)) refreshPaused(); else render();
  });
  root.addEventListener?.('toggle', () => { if (root.open && U.dirty) { U.dirty = false; refreshPaused(); } });
  render();
  return {
    render, refreshPaused, toggleAtLine, locationAtLine, chooseFrame, addWatch, openPopover, closePopover,
    get state() { return U; },
    get panel() { return panel; },
  };
}
