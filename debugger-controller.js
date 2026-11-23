// The page's side of the Java debugger (docs/DEBUGGER.md, "The page, plugins and MCP"): one controller per page over the VM client's debugger session (src/apk-worker-client.js
// debugAttach / debug / onDebugEvent). Every caller goes through it -- the debugger UI of the Code tool (src/debugger-ui.js), the plugins' lab.debug (src/plugin-host.js) and
// the MCP tools (src/mcp-tools.js) -- so they share one set of breakpoints (each with its owner), one paused state and one stream of events:
//   - attach on demand (the first breakpoint attaches), detach removes every breakpoint and lets every thread go;
//   - the user's breakpoints are kept per package in localStorage (try/catch: a page without storage just does not keep them) and set again when the APK is opened again,
//     before the app's code runs; a plugin's breakpoints go when the plugin stops, MCP's when the bridge asks (never persisted);
//   - waitForPause(ms): the next stop (or the current one), for MCP's debug_wait;
//   - code: the Code browser's reads (src/code-service.js; while the Worker is held in place they go through the debugger's channel) and the user-chosen edits of APK files
//     and method bodies, each listed as "App modified" with its owner (src/method-hooks-panel.js).
// Cost: nothing while no one attached (no Worker message, no timer). The lab's debugger stays invisible to the app: Debug.isDebuggerConnected() is false (src/vm-debug-host.js).
// DOM-free; no process.*.

export const DEBUG_STORE_KEY = 'apkweb.debugger.breakpoints.v1';
export const DEBUG_CONTROLLER_LIMITS = Object.freeze({ breakpointsPerOwner: 200, logs: 200, searchResults: 1000, searchSteps: 40, storedPackages: 50, decompileMs: 60000 });
const fail = (code, message) => Object.assign(new Error(message), { code });
const READ_OPS = new Set(['search', 'class-tree', 'class-info', 'disassemble', 'java-outline', 'decompile', 'read-file', 'files', 'file-edits']);
/** A descriptor from 'Lpkg/Name;', 'pkg.Name' or 'pkg/Name'. */
export const toDescriptor = name => { const text = String(name ?? '').trim(); return text.startsWith('L') && text.endsWith(';') ? text : `L${text.replaceAll('.', '/')};`; };
/** The method key 'Lpkg/C;->name(sig)ret' from a descriptor and 'name(sig)ret' (or a key already). */
export function methodKey(descriptor, method) {
  const m = String(method ?? ''); if (m.includes('->')) return m;
  return `${toDescriptor(descriptor)}->${m}`;
}
/** The class descriptor of a method key, or null. */
export const ownerOfKey = key => { const at = String(key ?? '').indexOf('->'); return at > 0 ? String(key).slice(0, at) : null; };

/** The fields of a breakpoint spec that are kept and sent (the rest is dropped). */
export function cleanBreakpointSpec(spec = {}) {
  const out = {}, s = spec && typeof spec === 'object' ? spec : {};
  for (const key of ['type', 'className', 'line', 'method', 'signature', 'pc', 'exceptionClass', 'caught', 'uncaught', 'field', 'access', 'condition', 'hitCondition', 'logMessage', 'suspend', 'thread', 'enabled']) {
    if (s[key] === undefined || s[key] === null || s[key] === '') continue;
    out[key] = typeof s[key] === 'number' || typeof s[key] === 'boolean' ? s[key] : String(s[key]).slice(0, 1000);
  }
  if (out.line !== undefined) out.line = Number(out.line);
  if (out.pc !== undefined) out.pc = Number(out.pc);
  if (!out.type) out.type = out.exceptionClass !== undefined || s.type === 'exception' ? 'exception' : out.field !== undefined ? 'field' : out.pc !== undefined ? 'location' : out.line !== undefined ? 'line' : undefined;
  if (out.type === undefined) delete out.type;
  return out;
}

function defaultStorage() { try { return globalThis.localStorage ?? null; } catch { return null; } }

/**
 * vm: the VM client (debugAttach, debug, codeService, debugHeld; `worker` while a VM is loaded). hooks: the "App modified" panel (src/method-hooks-panel.js: add, remove,
 * setFiles). getPackage(): the open package. trace(line): the page's trace. storage: localStorage-like (null: nothing is kept).
 */
export function createDebuggerController({ vm, hooks = null, getPackage = () => null, trace = () => {}, storage = defaultStorage(), now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id), onFileEdit = null } = {}) {
  const S = { attached: false, attaching: null, engine: null, channel: false, breakpoints: new Map(), stops: new Map(), paused: null, lastSnapshot: null, logs: [], seq: 0, fileOwners: new Map(), epoch: 0 };
  const listeners = new Set(), eventListeners = new Set(), waiters = new Set();
  const notify = () => { for (const fn of [...listeners]) { try { fn(view()); } catch { /* a listener's failure stays its own */ } } };
  const loaded = () => !!vm?.worker;
  const needVm = () => { if (!loaded()) throw fail('no-apk', 'No APK is running.'); };
  const ownerOf = owner => ({ kind: owner?.kind === 'plugin' || owner?.kind === 'mcp' ? owner.kind : owner?.id === 'mcp' ? 'mcp' : 'user', id: String(owner?.id ?? (owner?.kind === 'mcp' ? 'mcp' : 'user')), name: String(owner?.name ?? (owner?.kind === 'mcp' || owner?.id === 'mcp' ? 'MCP' : owner?.kind === 'plugin' ? 'plugin' : 'You')).slice(0, 80) });

  // ---- persistence (the user's breakpoints, per package) ---------------------------------------------------------------------------------------------------------------
  function readStore() { try { const raw = storage?.getItem?.(DEBUG_STORE_KEY); const data = raw ? JSON.parse(raw) : {}; return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; } }
  function writeStore(data) { try { storage?.setItem?.(DEBUG_STORE_KEY, JSON.stringify(data)); } catch { /* storage full or blocked: not kept */ } }
  function persist() {
    const pkg = getPackage(); if (!pkg) return;
    const data = readStore(), list = [...S.breakpoints.values()].filter(bp => bp.owner.kind === 'user').map(bp => ({ ...bp.spec, enabled: bp.result?.enabled !== false }));
    if (list.length) data[pkg] = list; else delete data[pkg];
    const keys = Object.keys(data); if (keys.length > DEBUG_CONTROLLER_LIMITS.storedPackages) for (const key of keys.slice(0, keys.length - DEBUG_CONTROLLER_LIMITS.storedPackages)) delete data[key];
    writeStore(data);
  }
  /** The stored breakpoints of a package (for the UI and tests). */
  const storedFor = pkg => { const list = readStore()[pkg]; return Array.isArray(list) ? list.map(cleanBreakpointSpec) : []; };

  // ---- attach / detach ---------------------------------------------------------------------------------------------------------------------------------------------------
  async function attach(options = {}) {
    needVm();
    if (S.attached) return state();
    if (S.attaching) return S.attaching;
    const epoch = S.epoch;
    S.attaching = (async () => {
      try {
        const out = await vm.debugAttach({ suspend: options.suspend === 'thread' ? 'thread' : 'all' });
        if (epoch !== S.epoch) return out;
        S.attached = !!out?.attached; S.engine = out?.engine ?? null; S.channel = !!out?.channel;
        trace(`Debugger: attached (${S.engine ?? 'engine'}${S.channel ? '' : '; the page is not cross-origin isolated: stops inside host code are snapshots, without stepping'})`);
        if (options.rearm !== false && S.attached) S.lastRearm = await rearm();
        notify(); return state();
      } finally { S.attaching = null; }
    })();
    return S.attaching;
  }
  /** Detaches: every breakpoint leaves the VM and every thread goes on. The user's saved breakpoints stay saved (attach or the next breakpoint sets them again) unless `forget`. */
  async function detach({ forget = false } = {}) {
    if (forget) { const pkg = getPackage(); if (pkg) { const data = readStore(); delete data[pkg]; writeStore(data); } }
    if (!S.attached) { notify(); return { detached: false }; }
    let out = { detached: true };
    if (loaded()) { try { out = await vm.debug('detach'); } catch (error) { if (error?.code !== 'no-apk') throw error; } }
    resetSession(); trace('Debugger: detached (every breakpoint removed, every thread resumed)');
    notify(); return out;
  }
  function resetSession() { S.attached = false; S.engine = null; S.breakpoints.clear(); S.stops.clear(); S.paused = null; S.lastSnapshot = null; for (const waiter of [...waiters]) waiter.resolve(null); }

  // ---- breakpoints -------------------------------------------------------------------------------------------------------------------------------------------------------
  async function setBreakpoint(spec, owner = { kind: 'user' }, { keep = true } = {}) {
    needVm();
    const who = ownerOf(owner), clean = cleanBreakpointSpec(spec);
    if ([...S.breakpoints.values()].filter(bp => bp.owner.id === who.id).length >= DEBUG_CONTROLLER_LIMITS.breakpointsPerOwner) throw fail('limit', `At most ${DEBUG_CONTROLLER_LIMITS.breakpointsPerOwner} breakpoints per owner.`);
    await attach();
    const same = [...S.breakpoints.values()].find(bp => bp.owner.id === who.id && JSON.stringify({ ...bp.spec, enabled: undefined }) === JSON.stringify({ ...clean, enabled: undefined }));
    if (same) return describe(same);   // the same breakpoint again (a saved one set again on attach, a plugin that runs twice): one breakpoint
    const result = await vm.debug('set-breakpoint', { breakpoint: clean });
    S.breakpoints.set(result.id, { id: result.id, spec: clean, owner: who, result });
    if (who.kind === 'user' && keep) persist();
    notify(); return describe(S.breakpoints.get(result.id));
  }
  const describe = bp => ({ ...bp.result, owner: bp.owner.kind === 'user' ? 'user' : `${bp.owner.kind}:${bp.owner.name}`, spec: { ...bp.spec } });
  function checkOwner(bp, owner) {
    const who = owner ? ownerOf(owner) : null;
    if (who && who.kind === 'plugin' && bp.owner.id !== who.id) throw fail('not-owner', `Breakpoint ${bp.id} belongs to ${bp.owner.kind === 'user' ? 'the user' : bp.owner.name}: a plugin removes or changes only its own.`);
  }
  async function removeBreakpoint(id, owner = null) {
    const bp = S.breakpoints.get(String(id)); if (!bp) throw fail('no-breakpoint', `No breakpoint ${id}`);
    checkOwner(bp, owner);
    if (S.attached && loaded()) { try { await vm.debug('remove-breakpoint', { id: bp.id }); } catch (error) { if (error?.code !== 'no-breakpoint') throw error; } }
    S.breakpoints.delete(bp.id); if (bp.owner.kind === 'user') persist();
    notify(); return { removed: bp.id };
  }
  async function enableBreakpoint(id, enabled = true, owner = null) {
    const bp = S.breakpoints.get(String(id)); if (!bp) throw fail('no-breakpoint', `No breakpoint ${id}`);
    checkOwner(bp, owner);
    bp.result = await vm.debug('enable-breakpoint', { id: bp.id, enabled: !!enabled }); bp.spec.enabled = !!enabled;
    if (bp.owner.kind === 'user') persist();
    notify(); return describe(bp);
  }
  /** A breakpoint changed in place (condition, hit count, log message): removed and set again with the same owner. */
  async function updateBreakpoint(id, changes, owner = null) {
    const bp = S.breakpoints.get(String(id)); if (!bp) throw fail('no-breakpoint', `No breakpoint ${id}`);
    checkOwner(bp, owner);
    const spec = { ...bp.spec }; for (const key of ['condition', 'hitCondition', 'logMessage', 'suspend']) if (key in (changes ?? {})) { if (changes[key] === null || changes[key] === '') delete spec[key]; else spec[key] = changes[key]; }
    await removeBreakpoint(bp.id, owner);
    return setBreakpoint(spec, bp.owner);
  }
  function breakpoints({ owner = null } = {}) {
    const who = owner ? ownerOf(owner) : null;
    return [...S.breakpoints.values()].filter(bp => !who || who.kind !== 'plugin' || bp.owner.id === who.id).map(describe);
  }
  /** The breakpoint at a code location (method key + pc), if any. */
  const breakpointAt = (key, pc) => [...S.breakpoints.values()].find(bp => bp.spec.type === 'location' && bp.spec.method === key && bp.spec.pc === pc) ?? null;
  async function toggleAt(key, pc, owner = { kind: 'user' }) {
    const existing = breakpointAt(key, pc);
    if (existing) { await removeBreakpoint(existing.id); return null; }
    return setBreakpoint({ type: 'location', method: key, pc }, owner);
  }
  /** Removes what an owner set (a plugin that stopped; MCP). */
  async function removeOwner(id, { files = true } = {}) {
    const mine = [...S.breakpoints.values()].filter(bp => bp.owner.id === String(id));
    for (const bp of mine) { try { await removeBreakpoint(bp.id); } catch { S.breakpoints.delete(bp.id); } }
    if (files) for (const [path, who] of [...S.fileOwners]) if (who.id === String(id)) { try { await revertFile(path); } catch { /* the VM is gone */ } }
    if (mine.length) notify();
    return { removed: mine.length };
  }

  // ---- commands ----------------------------------------------------------------------------------------------------------------------------------------------------------
  const COMMANDS = new Set(['pause', 'resume', 'step', 'run-to', 'threads', 'frames', 'locals', 'evaluate', 'set-local', 'inspect', 'field', 'state', 'return', 'invoke']);
  async function command(name, args = {}) {
    const op = String(name ?? '').replace(/^debug-/, '');
    if (!COMMANDS.has(op)) throw fail('bad-args', `Unknown debugger command: ${op.slice(0, 40)}`);
    needVm();
    if (op === 'state') return state();
    if (!S.attached) { if (op === 'pause' || op === 'threads') await attach(); else throw fail('not-attached', 'The debugger is not attached: set a breakpoint or attach first.'); }
    const result = await vm.debug(op, args ?? {});
    if (op === 'set-local') notify();
    return result;
  }

  // ---- events ------------------------------------------------------------------------------------------------------------------------------------------------------------
  function handleEvent(event) {
    if (!event || typeof event !== 'object') return;
    S.seq++;
    switch (event.type) {
      case 'paused':
        if (event.held === false) { S.lastSnapshot = { ...event, seq: S.seq, at: now() }; }
        else { S.stops.set(String(event.thread), { ...event, seq: S.seq, at: now() }); S.paused = S.stops.get(String(event.thread)); }
        for (const bp of S.breakpoints.values()) { const hit = (event.reasons ?? []).find(reason => reason.id === bp.id); if (hit) bp.result = { ...bp.result, hits: (bp.result.hits ?? 0) + 1 }; }
        for (const waiter of [...waiters]) waiter.resolve({ ...event, seq: S.seq });
        break;
      case 'resumed':
        if (event.thread === null || event.thread === undefined) S.stops.clear(); else S.stops.delete(String(event.thread));
        S.paused = S.stops.size ? [...S.stops.values()].at(-1) : null;
        break;
      case 'breakpoint-resolved': { const bp = S.breakpoints.get(event.breakpoint?.id); if (bp) bp.result = event.breakpoint; break; }
      case 'log': S.logs.push({ ...event, at: now() }); if (S.logs.length > DEBUG_CONTROLLER_LIMITS.logs) S.logs.splice(0, S.logs.length - DEBUG_CONTROLLER_LIMITS.logs); break;
      case 'detached': resetSession(); break;
      default: break;
    }
    for (const fn of [...eventListeners]) { try { fn(event); } catch { /* the listener's own */ } }
    notify();
  }
  /** The next stop within `ms` (or the current one when `current` and a thread is held now): resolves the paused event, or null at the timeout. */
  function waitForPause(ms = 10000, { current = true, after = null } = {}) {
    if (current && S.paused && (after === null || S.paused.seq > after)) return Promise.resolve(S.paused);
    return new Promise(resolve => {
      const waiter = { resolve: value => { waiters.delete(waiter); clearTimer(waiter.timer); resolve(value); } };
      waiter.timer = setTimer(() => waiter.resolve(null), Math.max(0, Math.min(120000, Number(ms) || 0)));
      waiters.add(waiter);
    });
  }

  // ---- the VM's lifecycle -------------------------------------------------------------------------------------------------------------------------------------------------
  /** A new VM is loaded (before the app's code runs): the user's stored breakpoints of this package are set again. */
  async function vmAttached(packageName = getPackage()) {
    S.epoch++; resetSession(); S.fileOwners.clear(); S.logs = [];
    const stored = packageName ? storedFor(packageName) : [];
    if (!stored.length || !loaded()) { notify(); return { rearmed: 0, failed: [] }; }
    await attach();   // attaching sets the stored breakpoints again (rearm), before the app's code runs
    return S.lastRearm ?? { rearmed: 0, failed: [] };
  }
  /** The user's stored breakpoints of the open package that are not set in this session (after a new VM, or a detach): set again, with their enabled state. */
  async function rearm() {
    const pkg = getPackage(), stored = pkg ? storedFor(pkg) : [], have = new Set([...S.breakpoints.values()].map(bp => JSON.stringify({ ...bp.spec, enabled: undefined })));
    let rearmed = 0; const failed = [];
    for (const spec of stored) {
      const { enabled, ...rest } = spec; if (have.has(JSON.stringify({ ...rest, enabled: undefined }))) continue;
      try {
        const result = await vm.debug('set-breakpoint', { breakpoint: rest });
        S.breakpoints.set(result.id, { id: result.id, spec: rest, owner: ownerOf({ kind: 'user' }), result });
        if (enabled === false) { S.breakpoints.get(result.id).result = await vm.debug('enable-breakpoint', { id: result.id, enabled: false }); S.breakpoints.get(result.id).spec.enabled = false; }
        rearmed++;
      } catch (error) { failed.push({ where: spec.method ?? spec.className ?? spec.exceptionClass ?? '?', error: String(error?.message ?? error).slice(0, 200) }); }
    }
    if (rearmed || failed.length) trace(`Debugger: ${rearmed} saved breakpoint${rearmed === 1 ? '' : 's'} of ${pkg} set again${failed.length ? ` (${failed.length} could not be: ${failed.map(f => f.where).join(', ')})` : ''}`);
    return { rearmed, failed };
  }
  function vmEnded() { S.epoch++; resetSession(); S.fileOwners.clear(); notify(); }

  // ---- code: reads and the user's edits ---------------------------------------------------------------------------------------------------------------------------------
  async function codeRead(op, args) { needVm(); if (!READ_OPS.has(op)) throw fail('bad-args', `Unknown code read: ${op}`); return vm.codeService(op, args); }
  const plainDisassembly = out => ({ descriptor: out.descriptor, name: out.name, file: out.file, framework: out.framework, lineCount: out.lineCount, text: out.text,
    methods: out.methods.map(m => ({ key: m.key, name: m.name, signature: m.signature, flags: m.flags, startLine: m.startLine + 1, endLine: m.endLine + 1, hasCode: m.hasCode, registers: m.registers, units: m.units, modified: m.modified, pcToLine: m.pcToLine.map(([pc, line]) => [pc, line + 1]) })),
    ...(out.method ? { method: { key: out.method.key, text: out.method.text } } : {}) });
  const code = {
    /** Search classes, methods, fields, strings and files: { results, more, cursor }. limit: 1..1000 (default 100). */
    async search(query, { kinds, limit = 100, framework = false, cursor = null } = {}) {
      const max = Math.max(1, Math.min(DEBUG_CONTROLLER_LIMITS.searchResults, Number(limit) || 100)), results = [];
      let at = cursor ?? null, steps = 0;
      do {
        const step = await codeRead('search', { query: String(query ?? ''), cursor: at, limit: Math.min(200, max - results.length), framework: !!framework, ...(Array.isArray(kinds) ? { kinds } : {}) });
        results.push(...step.results); at = step.cursor; steps++;
      } while (at !== null && results.length < max && steps < DEBUG_CONTROLLER_LIMITS.searchSteps);
      return { results: results.slice(0, max), more: at !== null, cursor: at };
    },
    /** A class as smali (lines 1-based), or one method's smali with `method` ('name(sig)ret', a key, or { name, signature }). */
    async disassemble(descriptor, method = null) {
      const spec = method === null || method === undefined ? null : typeof method === 'object' ? method : (() => { const body = String(method).includes('->') ? String(method).slice(String(method).indexOf('->') + 2) : String(method), open = body.indexOf('('); return open < 0 ? { name: body, signature: null } : { name: body.slice(0, open), signature: body.slice(open) }; })();
      const out = await codeRead('disassemble', { descriptor: toDescriptor(descriptor), ...(spec ? { method: spec } : {}) });
      return plainDisassembly(out);
    },
    classInfo: descriptor => codeRead('class-info', { descriptor: toDescriptor(descriptor) }),
    /**
     * A class as Java (src/java-decompiler.js), lines 1-based: { descriptor, name, file, framework, lineCount, text, methods: [{ key, name, signature, startLine, endLine, ok,
     * fallback, reason, modified }], lines: [[line, methodKey, firstPc, ...pcs]] (the lines that run code), stats }; with `method` ('name(sig)ret', a key or { name,
     * signature }), also { method: { key, startLine, endLine } }. Decompiled in the Worker in steps (the VM runs between them), on demand only.
     */
    async decompile(descriptor, method = null) {
      const started = Date.now(); let out;
      do {
        out = await codeRead('decompile', { descriptor: toDescriptor(descriptor) });
        if (!out.done && Date.now() - started > DEBUG_CONTROLLER_LIMITS.decompileMs) throw fail('timeout', `Decompiling ${descriptor} takes longer than ${DEBUG_CONTROLLER_LIMITS.decompileMs / 1000} s`);
      } while (!out.done);
      const lines = []; out.pcsOfLine.forEach((map, i) => { if (map) lines.push([i + 1, ...map]); });
      const result = { descriptor: out.descriptor, name: out.name, file: out.file, framework: out.framework, lineCount: out.lineCount, text: out.text, stats: out.stats,
        methods: out.methods.map(m => ({ key: m.key, name: m.name, signature: m.signature, startLine: m.startLine + 1, endLine: m.endLine + 1, hasCode: m.hasCode, ok: m.ok, fallback: m.fallback, reason: m.reason, modified: m.modified })), lines };
      if (method !== null && method !== undefined) {
        const spec = typeof method === 'object' ? method : (() => { const body = String(method).includes('->') ? String(method).slice(String(method).indexOf('->') + 2) : String(method), open = body.indexOf('('); return open < 0 ? { name: body, signature: null } : { name: body.slice(0, open), signature: body.slice(open) }; })();
        const m = result.methods.find(x => x.name === spec.name && (!spec.signature || x.signature === spec.signature || x.signature.startsWith(spec.signature)));
        if (!m) throw fail('no-method', `Method not found: ${out.name}.${spec.name}${spec.signature ?? ''}`);
        result.method = { key: m.key, startLine: m.startLine, endLine: m.endLine };
      }
      return result;
    },
    async readFile(path) { const out = await codeRead('read-file', { path: String(path ?? '') }); return out; },
    files: () => codeRead('files', {}),
    /** Replaces an APK entry's bytes (text, or a Uint8Array) for the app's next read; listed as App modified with its owner. */
    async editFile(path, content, owner = { kind: 'user' }) {
      needVm();
      const who = ownerOf(owner), name = String(path ?? ''); if (!name) throw fail('bad-args', 'editFile(path, text | bytes)');
      if (vm.debugHeld) throw fail('debugger-paused', 'The VM is held at a breakpoint: resume it before changing the app.');
      const previous = S.fileOwners.get(name); if (previous && who.kind === 'plugin' && previous.id !== who.id) throw fail('conflict', `${name} was edited by ${previous.name}: remove that edit first.`);
      const by = who.kind === 'plugin' ? `plugin ${who.name}` : who.kind === 'mcp' ? 'MCP' : 'Code browser';
      const bytes = content instanceof Uint8Array ? content : content instanceof ArrayBuffer ? new Uint8Array(content) : null;
      const out = await vm.codeService('edit-file', { path: name, by, ...(bytes ? { bytes } : { text: String(content ?? '') }) });
      S.fileOwners.set(name, who); hooks?.setFiles?.(out.edits); onFileEdit?.(name, true);
      trace(`${by}: app modified, ${name} edited (${out.edit?.bytes ?? 0} bytes): the app reads it from its next read`);
      return out.edit;
    },
    async revertFile(path, owner = null) { return revertFile(path, owner); },
    /** A method body in smali (lab.hook { smali }): listed as App modified with its owner. */
    async editMethod(descriptor, method, smali, owner = { kind: 'user' }, { persist = false } = {}) {
      needVm();
      if (!hooks?.add) throw fail('unsupported', 'Method changes are not available here.');
      if (vm.debugHeld) throw fail('debugger-paused', 'The VM is held at a breakpoint: resume it before changing the app.');
      const who = ownerOf(owner), key = methodKey(descriptor, method);
      if (!/->[^(]+\(/.test(key)) throw fail('bad-args', "editMethod(descriptor, 'name(params)ret', smali): name the method with its signature");
      return hooks.add({ id: who.id, name: who.name }, { method: key, kind: 'smali', smali: String(smali ?? ''), persist: !!persist });
    },
  };
  async function revertFile(path, owner = null) {
    needVm();
    const name = String(path ?? ''), who = owner ? ownerOf(owner) : null, previous = S.fileOwners.get(name);
    if (who?.kind === 'plugin' && previous && previous.id !== who.id) throw fail('not-owner', `${name} was edited by ${previous.name}: a plugin reverts only its own edits.`);
    const out = await vm.codeService('revert-file', { path: name });
    S.fileOwners.delete(name); hooks?.setFiles?.(out.edits); onFileEdit?.(name, false);
    if (out.removed) trace(`${name} restored to the APK's bytes${who ? ` by ${who.kind === 'mcp' ? 'MCP' : who.name}` : ''}`);
    return { removed: !!out.removed };
  }

  // ---- read model --------------------------------------------------------------------------------------------------------------------------------------------------------
  function state() {
    return { attached: S.attached, engine: S.engine, channel: S.channel, held: !!vm?.debugHeld, paused: S.paused ? { ...S.paused } : null, stops: [...S.stops.values()].map(stop => ({ ...stop })),
      lastSnapshot: S.lastSnapshot ? { ...S.lastSnapshot } : null, breakpoints: breakpoints(), logs: S.logs.slice(-20) };
  }
  const view = () => state();
  return {
    attach, detach, setBreakpoint, removeBreakpoint, enableBreakpoint, updateBreakpoint, breakpoints, breakpointAt, toggleAt, removeOwner, command, handleEvent, waitForPause,
    vmAttached, vmEnded, code, state, storedFor,
    get attached() { return S.attached; },
    get paused() { return S.paused; },
    get crossOriginIsolated() { return S.channel; },
    /** fn(state) on every change; returns the unsubscribe function. */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** fn(event) for every debugger event (paused, resumed, breakpoint-resolved, log, exception, thread-started, thread-ended, detached). */
    onEvent(fn) { eventListeners.add(fn); return () => eventListeners.delete(fn); },
  };
}
