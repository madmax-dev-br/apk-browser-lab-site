// The MCP tools as the lab page answers them (scripts/lab-mcp.mjs lists them for the MCP client and forwards each call here). Every tool reads what the page already has:
// the plugin host's read-only queries (src/plugin-host.js query: the same ones plugins use, same limits), the plugins' output, the Logcat and network stores. Results are MCP
// content: text (JSON, compact) and images (base64). DOM-free except Blob reading; no process.*.
import { blockValue, outputsOf } from './plugin-host.js?v=88e579518234';

export const MAX_TEXT_CHARS = 400_000;
const LEVEL_ORDER = ['V', 'D', 'I', 'W', 'E', 'A'];
const text = value => {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  return { type: 'text', text: body.length > MAX_TEXT_CHARS ? body.slice(0, MAX_TEXT_CHARS) + `\n… (truncated: ${body.length - MAX_TEXT_CHARS} more characters; ask for less, for example max_nodes or limit)` : body };
};
/** A Blob -> base64 (chunked, so a large image does not overflow the call stack). */
export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return globalThis.btoa(binary);
}
const image = async shot => ({ type: 'image', data: await blobToBase64(shot.blob), mimeType: shot.type ?? shot.blob?.type ?? 'image/png' });
const bounded = (value, fallback, min, max) => { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback; };
const fail = message => Object.assign(new Error(message), { code: 'bad-args' });
/** The scrollable a scroll_to / scroll_info call names: element_key, test_tag, text or a point (x, y) inside it; none = the largest scrollable on screen. */
const scrollTargetOf = args => args.element_key || args.test_tag || args.text || (Number.isFinite(args.x) && Number.isFinite(args.y)) ? { key: args.element_key, testTag: args.test_tag, text: args.text, x: args.x, y: args.y } : null;

export const NETWORK_WAIT_MS = 5000;
/**
 * Waits for "Screen ready" without letting an endpoint hold the caller: the screen is not ready while a network exchange is in flight, so a slow or hanging request (a long poll,
 * a stream, a server that does not answer) would keep every wait until its timeout. Once the screen is drawn and still and only the network is pending (screen.ready.onlyNetwork),
 * the wait gives the requests `networkMs` more and then returns, saying which requests are still open. -> { ready, screen, networkPending: [{ method, url, seconds }] | undefined }
 * screen(): the page's screen (src/plugin-host.js screenFromSnapshot); requests(): the network log's entries; sleep(ms); now().
 */
export async function waitScreenReady({ screen, requests = () => [], sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now() }, timeoutMs = 15000, networkMs = NETWORK_WAIT_MS) {
  const until = now() + timeoutMs; let onlyNetworkSince = null, current;
  const open = () => { const at = Date.now(); return requests().filter(entry => entry && entry.complete === false).slice(-8).map(entry => ({ method: entry.method ?? null, url: String(entry.url ?? '').slice(0, 300), seconds: Number.isFinite(entry.wall) ? Math.max(0, Math.round((at - entry.wall) / 100) / 10) : null })); };
  for (;;) {
    current = await screen();
    if (current?.ready?.ready) return { ready: true, screen: current };
    if (current?.ready?.onlyNetwork) { onlyNetworkSince ??= now(); if (now() - onlyNetworkSince >= networkMs) return { ready: false, screen: current, networkPending: open() }; }
    else onlyNetworkSince = null;
    if (now() >= until) return { ready: false, screen: current };
    await sleep(150);
  }
}
/** What a wait reports to the MCP client: ready, the Activity and, when not ready, why; a wait that ended on open requests names them. */
export function readyReport(result) {
  const report = { ready: result.ready, activity: result.screen?.activity ?? null };
  if (!result.ready) report.waitingFor = result.screen?.ready?.waitingFor ?? [];
  if (result.networkPending) { report.networkPending = result.networkPending; report.note = 'The screen is drawn and still; only network requests are in flight, so the wait did not run to the end. If the content depends on that response, call wait_ready with a larger network_ms.'; }
  return report;
}

/**
 * query(method, args): the plugin host's page-level query (screen, layoutBounds, screenshot, composeTree, viewModels, inspect, field, statics, staticField, classes,
 * instances, referrers, compositionLocals, findCompositionLocal). plugins(): the host's read model of the plugins. logcat() / network(): the entries of the page stores.
 * pluginStore: { list() -> stored plugins with code, save(spec) -> { plugin, created } } (src/plugins-panel.js), for get_plugin / save_plugin.
 * debug: { controller() (src/debugger-controller.js), actions (src/debugger-plugin-actions.js), owner } for the code_* and debug_* tools; hook(spec): a method change by MCP (App modified).
 * frameStats(): the summary of "Show frame rate" (current / average / minimum FPS, janky frames, idle) while that option is on, else null; lab_status adds it as `frameRate`. status(): what the page knows about the loaded APK. clickButton(pluginId, buttonId): a click on a plugin's button (lab.button), resolved when its handler finished. sleep(ms).
 */
export function createMcpTools({ debug = null, hook = null, controls = null, query, plugins = () => [], pluginStore = null, clickButton = null, logcat = () => [], network = () => [], status = () => ({}), frameStats = () => null, actions = null, input = null, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now() }) {
  const waitReady = (timeoutMs = 15000, networkMs = NETWORK_WAIT_MS) => waitScreenReady({ screen: () => query('screen', {}), requests: network, sleep, now }, bounded(timeoutMs, 15000, 100, 120000), bounded(networkMs, NETWORK_WAIT_MS, 0, 120000));
  /** instances / referrers: the runtime's short pages, walked until `limit` items or the end (as lab.instances does). */
  async function paged(method, args, limit) {
    const items = []; let after = 0, scanned = 0, done = false;
    for (let page = 0; page < 100 && items.length < limit && !done; page++) {
      const result = await query(method, { ...args, limit: limit - items.length, after });
      items.push(...(result?.items ?? [])); scanned += result?.scanned ?? 0;
      if (result?.next === null || result?.next === undefined) done = true; else after = result.next;
    }
    return { items, scanned, done };
  }
  async function screenshotTarget(args) {
    if (args.bounds) return { bounds: args.bounds };
    if (args.element_key) return { key: String(args.element_key) };
    if (args.test_tag || args.text) {
      const elements = await query('layoutBounds', { names: false }), tag = args.test_tag ? String(args.test_tag) : null, wanted = args.text ? String(args.text).toLowerCase() : null;
      const element = elements.find(item => (tag ? item.testTag === tag : true) && (wanted ? [...(item.texts ?? []), item.editableText ?? '', ...(item.contentDescriptions ?? [])].some(value => String(value).toLowerCase().includes(wanted)) : true));
      if (!element) throw fail(`No component on screen with ${tag ? `testTag "${tag}"` : ''}${tag && wanted ? ' and ' : ''}${wanted ? `text "${args.text}"` : ''} (see layout_bounds).`);
      return { key: element.key };
    }
    return {};
  }
  /** The window of entries a call wants: start "now" (nothing yet, only the cursor to follow from here), after a cursor (since), from a moment (from_time: ISO or epoch ms),
   * or the last N seconds (last_seconds); the device clock is the entries' `wall`. */
  function windowOf(args) {
    const since = Number.isFinite(Number(args.since)) ? Number(args.since) : null;
    const fromTime = args.from_time !== undefined ? (Number.isFinite(Number(args.from_time)) ? Number(args.from_time) : Date.parse(String(args.from_time))) : Number.isFinite(Number(args.last_seconds)) ? Date.now() - Number(args.last_seconds) * 1000 : null;
    if (args.from_time !== undefined && !Number.isFinite(fromTime)) throw fail(`invalid from_time: ${args.from_time} (use ISO 8601 or milliseconds since 1970).`);
    return entry => (since === null || !(entry.seq <= since)) && (fromTime === null || !Number.isFinite(entry.wall) || entry.wall >= fromTime);
  }
  /** After an input: wait for the screen to settle (up to wait_ms), then the screen and, when asked, its image. */
  async function afterInput(result, args) {
    const wait = bounded(args.wait_ms, 2000, 0, 20000), settledNow = wait > 0 ? await waitScreenReady({ screen: () => query('screen', {}), requests: network, sleep, now }, wait, Math.min(wait, NETWORK_WAIT_MS)) : { ready: false, screen: await query('screen', {}) };
    if (wait === 0 && settledNow.screen?.ready?.ready) settledNow.ready = true;
    const { note, ...report } = readyReport(settledNow), content = [text({ ...result, ...report })];
    if (args.screenshot) { const shot = await query('screenshot', { maxWidth: args.max_width }); content.unshift(await image(shot)); }
    return content;
  }
  // ---- code and debugger helpers (debug: { controller(), actions: src/debugger-plugin-actions.js, owner }) ----
  const dbg = () => { const c = debug?.controller?.(); if (!c) throw fail('The debugger is not available on this page.'); return c; };
  const owner = debug?.owner ?? { id: 'mcp', name: 'MCP' };
  const codeAction = args => { if (!debug?.actions?.code) throw fail('The Code browser is not available on this page.'); return debug.actions.code(owner, args); };
  const compact = value => JSON.parse(JSON.stringify(value, (key, item) => item === null || item === false ? undefined : item));
  const pcOf = value => { const text = String(value ?? '').trim(); const n = /^0x/i.test(text) ? parseInt(text, 16) : Number(text); if (!Number.isInteger(n) || n < 0) throw fail(`pc: a dex code-unit offset (decimal or 0x hex), got ${text}`); return n; };
  const methodRef = args => {
    const m = String(args.method ?? ''); if (!m) throw fail('method is required with pc ("name(params)ret", or the name alone when it has one version).');
    if (m.includes('->')) return m;
    const owner = String(args.class_name ?? ''); if (!owner) throw fail('class_name is required with method.');
    const d = owner.startsWith('L') && owner.endsWith(';') ? owner : `L${owner.replaceAll('.', '/')};`;
    return `${d}->${m}`;   // without a signature: the method of that name (src/debugger.js parseMethodRef)
  };
  function breakpointSpec(args) {
    const common = { ...(args.condition ? { condition: String(args.condition) } : {}), ...(args.hit_condition ? { hitCondition: String(args.hit_condition) } : {}), ...(args.log_message !== undefined && args.log_message !== null && args.log_message !== '' ? { logMessage: String(args.log_message) } : {}), ...(args.suspend === 'thread' ? { suspend: 'thread' } : {}), ...(args.thread ? { thread: String(args.thread) } : {}) };
    if (args.exception !== undefined || args.type === 'exception') return { type: 'exception', ...(args.exception && args.exception !== '*' ? { exceptionClass: String(args.exception) } : {}), caught: args.caught !== false, uncaught: args.uncaught !== false, ...common };
    if (args.field) return { type: 'field', className: String(args.class_name ?? ''), field: String(args.field), access: ['read', 'write'].includes(args.access) ? args.access : 'any', ...common };
    if (args.type === 'entry' || args.type === 'exit') { const ref = methodRef(args); return { type: args.type, ...(typeof ref === 'string' ? { method: ref } : { className: ref.className, method: ref.method }), ...common }; }
    if (args.pc !== undefined) { const ref = methodRef(args); return { type: 'location', ...(typeof ref === 'string' ? { method: ref } : { className: ref.className, method: ref.method }), pc: pcOf(args.pc), ...common }; }
    if (args.line !== undefined) { if (!args.class_name) throw fail('class_name is required with line.'); return { type: 'line', className: String(args.class_name), line: Number(args.line), ...(args.method ? { method: String(args.method).split('(')[0] } : {}), ...common }; }
    throw fail('Give class_name + line (a source line), class_name + method + pc (a dex pc, from code_disassemble), exception (a class, or "*"), or class_name + field.');
  }
  const where = location => location ? `${location.className ?? '?'}.${location.methodName ?? '?'}${location.signature ?? ''}${location.line ? ` line ${location.line}` : ''} pc ${location.pc}` : null;
  const compactBreakpoint = bp => compact({ id: bp.id, where: bp.where, enabled: bp.enabled, resolved: bp.resolved, verified: bp.verified === false ? false : undefined, message: bp.message, hits: bp.hits, condition: bp.condition, hitCondition: bp.hitCondition, logMessage: bp.logMessage, owner: bp.owner, locations: (bp.locations ?? []).slice(0, 8).map(where) });
  const frameOut = f => f.host ? { host: true } : { index: f.index, at: where(f), source: f.source ?? undefined, ...(f.receiver ? { receiver: f.receiver.$handle } : {}) };
  const localsOut = (out, registers) => ({ at: where(out.location), debugInfo: out.debugInfo, locals: Object.fromEntries((out.locals ?? []).map(local => [local.name, local.value])), types: Object.fromEntries((out.locals ?? []).map(local => [local.name, local.type])), ...(registers || out.debugInfo === false ? { registers: out.registers } : {}) });
  const threadOf = args => args.thread ? String(args.thread) : dbg().paused?.thread ?? undefined;
  const summaryOf = state => compact({ attached: state.attached, engine: state.engine, crossOriginIsolated: state.channel, paused: state.paused ? where(state.paused.location) : null, breakpoints: state.breakpoints?.length ?? 0 });
  /** What debug_wait / debug_step / debug_run_to answer: where the thread stopped, why, its stack and the locals of the innermost frame. */
  async function pauseReport(event, args = {}) {
    if (!event) { const st = dbg().state(); return compact({ paused: false, timedOut: true, attached: st.attached, breakpoints: st.breakpoints.map(compactBreakpoint), note: 'No stop within the time: trigger the code (tap, invoke_method, open_app), then debug_wait again.' }); }
    const base = compact({ paused: event.held !== false, seq: event.seq, thread: event.thread, threadName: event.threadName, reason: event.reason, breakpoints: (event.reasons ?? []).map(r => r.id).filter(Boolean), at: where(event.location), mode: event.mode,
      exception: event.exception ? { type: event.exception.type, message: event.exception.message, caught: event.exception.caught, handle: event.exception.handle } : undefined, conditionError: event.conditionError });
    if (event.held === false) return { ...base, snapshot: true, note: `Snapshot only, no stepping: ${event.why ?? 'the thread ran on'}.`, stack: (event.frames?.frames ?? []).slice(0, 16).map(frameOut) };
    const depth = bounded(args.stack_depth, 16, 1, 128);
    let stack = null, locals = null;
    try { const frames = await dbg().command('frames', { thread: event.thread, count: depth }); stack = frames.frames.map(frameOut); } catch (error) { stack = { error: error.message }; }
    if (args.include_locals !== false) { try { locals = localsOut(await dbg().command('locals', { thread: event.thread, frame: 0 }), false); delete locals.at; } catch (error) { locals = { error: error.message }; } }
    return { ...base, stack, ...(locals ? { locals: locals.locals, types: locals.types, ...(locals.error ? { localsError: locals.error } : {}) } : {}), next: 'debug_step (over/into/out), debug_evaluate, debug_set_local, debug_continue then debug_wait.' };
  }
  const tools = {
    async lab_status() {
      const screen = await query('screen', {});
      const frameRate = frameStats(), { appModified, ...apk } = status() ?? {};   // appModified: the method changes in effect (src/method-hooks-panel.js summary), never left out while one is active
      return [text({ apk, screen, ...(frameRate ? { frameRate } : {}), ...(appModified?.count || appModified?.failed?.length ? { appModified } : {}), plugins: plugins().map(plugin => ({ id: plugin.id, name: plugin.name, status: plugin.status, reason: plugin.reason || undefined, errors: plugin.errorCount || undefined })) })];
    },
    async screenshot(args) {
      let ready = null; if (args.wait_ready) ready = await waitReady(args.timeout_ms);
      const shot = await query('screenshot', { ...(await screenshotTarget(args)), maxWidth: args.max_width });
      return [await image(shot), text({ width: shot.width, height: shot.height, ...(shot.notes?.length ? { notes: shot.notes } : {}), ...(ready ? { ready: ready.ready, activity: ready.screen?.activity ?? null } : {}) })];
    },
    async layout_bounds(args) { return [text(await query('layoutBounds', { names: args.names !== false }))]; },
    async compose_tree(args) { return [text(await query('composeTree', { maxNodes: bounded(args.max_nodes, 600, 1, 4000), ...(Array.isArray(args.locals) && args.locals.length ? { locals: args.locals.map(String) } : {}) }))]; },
    async composition_locals(args) { if (!args.handle) throw fail('handle is required (from compose_tree).'); return [text(await query('compositionLocals', { handle: String(args.handle), only: Array.isArray(args.only) ? args.only.map(String) : null, options: { depth: 1 } }))]; },
    async find_composition_local(args) { return [text(await query('findCompositionLocal', { match: String(args.match ?? ''), options: { depth: 1 } }))]; },
    async view_models() { return [text(await query('viewModels', {}))]; },
    async inspect(args) { return [text(await query('inspect', { handle: String(args.handle ?? ''), options: { depth: bounded(args.depth, 2, 0, 6) } }))]; },
    async field(args) { return [text(await query('field', { handle: String(args.handle ?? ''), path: Array.isArray(args.path) ? args.path.map(String) : String(args.path ?? ''), options: { depth: bounded(args.depth, 1, 0, 6) } }))]; },
    async methods(args) { return [text(await query('methods', { ...(args.class_name ? { className: String(args.class_name) } : { handle: String(args.handle ?? '') }), match: args.match === undefined ? undefined : String(args.match), parameters: Number.isFinite(args.parameters) ? args.parameters : undefined, static: typeof args.static === 'boolean' ? args.static : undefined }))]; },
    async invoke_method(args) {   // lab.invoke: a page operation like a click (src/app-invoke.js); a Java exception comes back as an error with its type and message
      return [text(await query('invoke', { ...(args.class_name ? { className: String(args.class_name) } : { handle: String(args.handle ?? '') }), method: String(args.method ?? ''), args: Array.isArray(args.args) ? args.args : [], signature: args.signature === undefined ? undefined : String(args.signature) }))];
    },
    async statics(args) { return [text(await query('statics', { className: String(args.class_name ?? '') }))]; },
    async static_field(args) { return [text(await query('staticField', { className: String(args.class_name ?? ''), path: Array.isArray(args.path) ? args.path.map(String) : String(args.path ?? '') }))]; },
    async classes(args) { return [text(await query('classes', { match: String(args.match ?? ''), limit: 100, initialized: !!args.initialized }))]; },
    async instances(args) { return [text(await paged('instances', { className: String(args.class_name ?? ''), subclasses: true }, bounded(args.limit, 20, 1, 500)))]; },
    async referrers(args) { return [text(await paged('referrers', { handle: String(args.handle ?? '') }, 50))]; },
    async plugins(args) {
      const wanted = args.id ? String(args.id) : null, withImages = args.include_images !== false, out = [], images = [];
      for (const plugin of plugins()) {
        if (wanted && plugin.id !== wanted && plugin.name !== wanted) continue;
        const blocks = [];
        for (const block of plugin.output?.blocks ?? []) {
          if (block.kind === 'image') { blocks.push({ id: block.id, kind: 'image', caption: block.caption || undefined }); if (withImages && block.blob) images.push({ plugin: plugin.name, block }); continue; }
          const value = blockValue(block);   // the same conversion as the click answer's outputs and window.apkLabPlugins.outputs (src/plugin-host.js)
          if (block.kind === 'kv') blocks.push({ id: block.id, kind: 'kv', entries: value });
          else if (block.kind === 'table') blocks.push({ id: block.id, kind: 'table', rows: value });
          else if (block.kind === 'json') blocks.push({ id: block.id, kind: 'json', value });
          else blocks.push({ id: block.id, kind: block.kind, text: value });
        }
        out.push({ id: plugin.id, name: plugin.name, status: plugin.status, reason: plugin.reason || undefined, badge: plugin.output?.badge || undefined, outputs: outputsOf(plugin.output), blocks,
          ...(plugin.buttons?.length ? { buttons: plugin.buttons.map(button => ({ id: button.id, label: button.label, icon: button.icon || undefined, title: button.title || undefined, placement: button.placement, disabled: button.disabled || undefined, busy: button.busy || undefined })) } : {}),
          errors: (plugin.errors ?? []).slice(-5).map(error => `${error.phase}: ${error.message}`), console: (plugin.console ?? []).slice(-20).map(line => `${line.level}: ${line.text}`) });
      }
      if (wanted && !out.length) throw fail(`Plugin "${wanted}" not found (lab_status lists the plugins).`);
      const content = [text(out)];
      for (const { plugin, block } of images.slice(0, 8)) { content.push(await image({ blob: block.blob, type: block.blob.type })); content.push(text(`↑ image from plugin ${plugin}${block.caption ? `: ${block.caption}` : ''}`)); }
      return content;
    },
    /** One plugin with its code (the `plugins` tool lists them without it), by id or name. */
    async get_plugin(args) {
      if (!pluginStore?.list) throw fail('Plugins cannot be read on this page.');
      const wanted = String(args.plugin ?? ''), stored = pluginStore.list(), plugin = stored.find(item => item.id === wanted) ?? stored.find(item => item.name === wanted);
      if (!plugin) throw fail(`Plugin "${wanted}" not found (plugins lists them: ${stored.map(item => item.name).join(', ') || 'none'}).`);
      const live = plugins().find(item => item.id === plugin.id);
      return [text({ id: plugin.id, name: plugin.name, enabled: plugin.enabled, packageFilter: plugin.packageFilter, status: live?.status ?? null, reason: live?.reason || undefined,
        errors: (live?.errors ?? []).slice(-5).map(error => `${error.phase}: ${error.message}`), codeChars: plugin.code.length, code: plugin.code })];
    },
    /**
     * Creates a plugin (no `plugin`) or edits one (`plugin`: id or name). `code` replaces the whole code; `edits` ([{ old_text, new_text }]) changes parts of it, each old_text
     * found exactly once, applied in order (all or nothing). The plugin then runs like one saved in the dialog; the answer waits up to wait_ms for it to start or fail.
     */
    async save_plugin(args) {
      if (!pluginStore?.save) throw fail('Plugins cannot be changed on this page.');
      const stored = pluginStore.list(), wanted = args.plugin === undefined || args.plugin === null || args.plugin === '' ? null : String(args.plugin);
      const current = wanted === null ? null : stored.find(item => item.id === wanted) ?? stored.find(item => item.name === wanted);
      if (wanted !== null && !current) throw fail(`Plugin "${wanted}" not found: leave "plugin" out to create one (plugins lists them: ${stored.map(item => item.name).join(', ') || 'none'}).`);
      if (args.code !== undefined && args.edits !== undefined) throw fail('Pass code (the whole code) or edits (parts of it), not both.');
      let code = args.code === undefined ? undefined : String(args.code);
      if (args.edits !== undefined) {
        if (!current) throw fail('edits change an existing plugin: pass "plugin", or pass "code" to create one.');
        if (!Array.isArray(args.edits) || !args.edits.length || args.edits.length > 50) throw fail('edits is a list of 1 to 50 { old_text, new_text }.');
        code = current.code;
        args.edits.forEach((edit, index) => {
          const from = String(edit?.old_text ?? ''), to = String(edit?.new_text ?? ''); if (!from) throw fail(`edits[${index}]: old_text is empty.`);
          const first = code.indexOf(from); if (first < 0) throw fail(`edits[${index}]: old_text was not found in the code (get_plugin returns the current code). Nothing was changed.`);
          if (code.indexOf(from, first + 1) >= 0) throw fail(`edits[${index}]: old_text appears more than once: include more of the surrounding code. Nothing was changed.`);
          code = code.slice(0, first) + to + code.slice(first + from.length);
        });
      }
      if (!current && code === undefined) throw fail('A new plugin needs "code".');
      if (!current && !String(args.name ?? '').trim()) throw fail('A new plugin needs "name".');
      const spec = { ...(current ? { id: current.id } : {}), ...(args.name !== undefined ? { name: String(args.name) } : {}), ...(code !== undefined ? { code } : {}),
        ...(args.enabled !== undefined ? { enabled: args.enabled === true } : {}), ...(args.package_filter !== undefined ? { packageFilter: String(args.package_filter) } : {}) };
      let saved; try { saved = pluginStore.save(spec); } catch (error) { throw fail(error?.message ?? String(error)); }
      const id = saved.plugin.id, wait = bounded(args.wait_ms, 2000, 0, 30000), live = () => plugins().find(item => item.id === id);
      if (saved.plugin.enabled) for (const until = now() + wait; now() < until && !['rodando', 'erro'].includes(live()?.status) ;) await sleep(50);
      if (saved.plugin.enabled && live()?.status === 'rodando') await sleep(Math.min(150, wait));   // the top-level code of a plugin that throws at once reports right after it starts
      const after = live();
      return [text({ id, name: saved.plugin.name, created: saved.created, enabled: saved.plugin.enabled, packageFilter: saved.plugin.packageFilter, codeChars: saved.plugin.code.length,
        status: after?.status ?? null, reason: after?.reason || undefined, errors: (after?.errors ?? []).slice(-5).map(error => `${error.phase}: ${error.message}`),
        buttons: (after?.buttons ?? []).map(button => button.id) })];
    },
    /** A click on a plugin's button (lab.button), as the user's: the plugin's handler runs; the answer comes when it finished, with what it wrote (blocks, errors). */
    async click_plugin_button(args) {
      if (typeof clickButton !== 'function') throw fail('Plugin buttons are not available on this page.');
      const wanted = String(args.plugin ?? ''), plugin = plugins().find(item => item.id === wanted) ?? plugins().find(item => item.name === wanted);
      if (!plugin) throw fail(`Plugin "${wanted}" not found (lab_status lists the plugins).`);
      const key = String(args.button ?? ''), button = (plugin.buttons ?? []).find(item => item.id === key) ?? (plugin.buttons ?? []).find(item => item.label === key);
      if (!button) throw fail(`Plugin ${plugin.name} has no button "${key}" (plugins lists the buttons: ${(plugin.buttons ?? []).map(item => item.id).join(', ') || 'none'}).`);
      const errorsBefore = plugin.errorCount ?? 0, wait = bounded(args.wait_ms, 10000, 0, 60000);
      const result = await Promise.race([clickButton(plugin.id, button.id), sleep(wait).then(() => ({ ok: null, reason: 'still-running' }))]);
      const after = plugins().find(item => item.id === plugin.id) ?? plugin, fresh = Math.min(5, Math.max(0, (after.errorCount ?? 0) - errorsBefore));
      return [text({ plugin: plugin.name, button: button.id, ...result, newErrors: fresh ? (after.errors ?? []).slice(-fresh).map(error => `${error.phase}: ${error.message}`) : [] })];
    },
    async logcat(args) {
      // a cursor to follow the Logcat: `since` (the `next` of the previous answer) returns only newer lines; `wait_ms` waits up to that long for one to arrive
      const min = LEVEL_ORDER.indexOf(String(args.level ?? 'V').toUpperCase()), needle = args.contains ? String(args.contains).toLowerCase() : null, limit = bounded(args.limit, 200, 1, 5000);
      const wait = bounded(args.wait_ms, 0, 0, 30000), inWindow = windowOf(args), since = Number.isFinite(Number(args.since)) ? Number(args.since) : -1;
      if (args.start === 'now') { const all = logcat(); return [text('Following from now on: pass since with the next below in the following calls.'), text({ next: all.length ? all.at(-1).seq : -1, count: 0 })]; }
      const pick = () => logcat().filter(entry => inWindow(entry) && LEVEL_ORDER.indexOf(entry.level) >= Math.max(0, min) && (!needle || `${entry.tag} ${entry.message}`.toLowerCase().includes(needle)));
      let rows = pick(); for (const until = now() + wait; !rows.length && now() < until;) { await sleep(200); rows = pick(); }
      rows = rows.slice(-limit);
      const all = logcat(), next = all.length ? all.at(-1).seq : since;
      const lines = rows.map(entry => `${(entry.uptime / 1000).toFixed(3)} ${entry.level}/${entry.tag} (${entry.thread}): ${entry.message}`);
      return [text(lines.length ? lines.join('\n') : `No new lines${needle || min > 0 ? ' with that filter' : ''}. Logcat is collected while MCP is connected.`), text({ next, count: rows.length })];
    },
    async network(args) {
      const needle = args.contains ? String(args.contains).toLowerCase() : null, limit = bounded(args.limit, 50, 1, 1000), withBody = args.include_body === true;
      const wait = bounded(args.wait_ms, 0, 0, 30000), inWindow = windowOf(args), since = Number.isFinite(Number(args.since)) ? Number(args.since) : -1;
      if (args.start === 'now') { const all = network(); return [text({ requests: [], next: all.length ? all.at(-1).seq : -1, note: 'Following from now on: pass since with this next in the following calls.' })]; }
      const pick = () => network().filter(entry => inWindow(entry) && (!needle || `${entry.method} ${entry.url}`.toLowerCase().includes(needle)));
      let rows = pick(); for (const until = now() + wait; !rows.length && now() < until;) { await sleep(200); rows = pick(); }
      const all = network(), next = all.length ? all.at(-1).seq : since;
      const out = rows.slice(-limit).map(entry => ({ seq: entry.seq, method: entry.method, url: entry.url, status: entry.status, outcome: entry.outcome, complete: entry.complete, durationMs: entry.durationMs, contentType: entry.contentType, responseBytes: entry.responseBytes,
        ...(entry.mockId ? { mock: entry.mockLabel ?? entry.mockId } : {}), ...(entry.blockId ? { blockedByUser: entry.blockLabel ?? entry.blockId } : {}), ...(entry.mappedUrl ? { redirectedTo: entry.mappedUrl } : {}), ...(entry.proxiedVia ? { proxiedVia: entry.proxiedVia } : {}), ...(entry.refusedHost ? { refusedHost: entry.refusedHost } : {}), ...(entry.failure ? { failure: entry.failure } : {}),
        ...(withBody && typeof entry.responseBody === 'string' ? { responseBody: entry.responseBody.length > 20000 ? entry.responseBody.slice(0, 20000) + '…' : entry.responseBody, responseHeaders: entry.responseHeaders } : {}) }));
      return [text({ requests: out, next })];
    },
    // ---- acting on the lab: the page's own controls (they show in Controls like the user's) ----
    async set_mock(args) {
      if (!actions?.mock) throw fail('Mocks are not available on this page.');
      const headers = args.headers && typeof args.headers === 'object' ? args.headers : undefined, body = args.body === undefined ? '' : typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
      const result = await actions.mock({ id: args.id, name: args.name ?? `MCP ${args.method ?? 'ANY'} ${args.url ?? ''}`.slice(0, 120), method: args.method ?? 'ANY', url: args.url, status: args.status ?? 200, headers: headers ?? (typeof args.body === 'object' && args.body !== null ? { 'Content-Type': 'application/json' } : undefined), body, delayMs: args.delay_ms ?? 0, query: args.query });
      return [text({ id: result.id, note: 'Active in Controls › Network › Endpoint mocks: the next request that matches gets this response without going to the network. Use reload so the app fetches again.' })];
    },
    async remove_mock(args) { if (!actions?.unmock) throw fail('Mocks are not available on this page.'); return [text(await actions.unmock(String(args.id ?? '')))]; },
    async list_mocks() { if (!actions?.mocks) throw fail('Mocks are not available on this page.'); return [text(await actions.mocks())]; },
    // ---- Blocked calls (Controls › Network › Blocked calls, src/blocked-calls.js) and the one general Export / Import of the Controls (src/config-bundle.js) ----
    async set_block(args) {
      if (!controls?.blocks) throw fail('Blocked calls are not available on this page.');
      const scope = args.scope === undefined ? (args.host !== undefined && args.url === undefined ? 'host' : 'endpoint') : String(args.scope);
      if (scope === 'host' ? !args.host : !args.url) throw fail(scope === 'host' ? 'host is required for scope "host" (api.example.com, *.example.com, host:port).' : 'url is required for scope "endpoint" (https://api.example.com/v1/profile or /v1/*).');
      const result = await controls.blocks.add({ id: args.id, scope, name: args.name, method: args.method ?? 'ANY', url: args.url, query: args.query, host: args.host, enabled: args.enabled !== false });
      return [text({ id: result.id, note: 'Active in Controls › Network › Blocked calls of the open package: the app\'s next call that matches is not made and fails at once (ConnectException; UnknownHostException for a host name). Use reload so the app calls again.' })];
    },
    async remove_block(args) { if (!controls?.blocks) throw fail('Blocked calls are not available on this page.'); return [text(await controls.blocks.remove(String(args.id ?? '')))]; },
    async list_blocks() { if (!controls?.blocks) throw fail('Blocked calls are not available on this page.'); return [text(await controls.blocks.list())]; },
    async export_config(args) {
      if (!controls?.config) throw fail('The configuration export is not available on this page.');
      const parts = Array.isArray(args.parts) && args.parts.length ? args.parts.map(String) : null, known = ['device', 'plugins', 'mocks', 'blockedCalls', 'methodReturns', 'ignoredActivities', 'permissions'];
      if (parts) { const bad = parts.filter(part => !known.includes(part)); if (bad.length) throw fail(`Unknown parts: ${bad.join(', ')} (available: ${known.join(', ')}).`); }
      const result = await controls.config.export(parts), size = JSON.stringify(result).length;
      if (size > MAX_TEXT_CHARS - 2000) throw fail(`The configuration is ${size} characters, more than one answer carries: ask for fewer parts (parts), or use Export in the Controls panel.`);
      return [text(result)];
    },
    async import_config(args) {
      if (!controls?.config) throw fail('The configuration import is not available on this page.');
      let document = args.document; if (typeof document === 'string') { try { document = JSON.parse(document); } catch (error) { throw fail(`document is not valid JSON: ${String(error?.message ?? error).slice(0, 120)}`); } }
      if (document === undefined || document === null) throw fail('document is required (the object export_config returns as "document", or the text of a file saved with Export).');
      return [text(await controls.config.import(document, { allowPlugins: args.allowPlugins === true }))];
    },
    // ---- input: the page's own input paths (a real touch on Compose, a click on a View, SetText, ScrollBy) ----
    async tap(args) { if (!input?.tap) throw fail('Input is not available on this page.'); return afterInput(await input.tap(args), args); },
    async type(args) { if (!input?.type) throw fail('Input is not available on this page.'); return afterInput(await input.type(args), args); },
    async scroll(args) { if (!input?.scroll) throw fail('Input is not available on this page.'); return afterInput(await input.scroll(args), args); },
    // to a position (px = dp) or a percentage of the scroll range, as lab.scrollTo / lab.scrollToPercent of the plugins (src/lab-scroll.js): the app's own scroll, steered until it gets there
    async scroll_to(args) {
      if (!input?.scrollTo) throw fail('Input is not available on this page.');
      return afterInput(await input.scrollTo({ target: scrollTargetOf(args), x: args.to_x, y: args.to_y, percentX: args.percent_x, percentY: args.percent_y }), args);
    },
    async scroll_info(args) { if (!input?.scrollInfo) throw fail('Input is not available on this page.'); return [text(await input.scrollInfo({ target: scrollTargetOf(args) }))]; },
    async reload(args) { if (!actions?.reload) throw fail('Reload is not available on this page.'); return [text(await actions.reload(args.mode === 'reopen' ? 'reopen' : 'recreate'))]; },
    // ---- the Controls panel (controls: src/app.js mcpControls) ----
    async app_data(args) {
      if (!controls?.appData) throw fail('App data is not available on this page.');
      if (args.prefs) return [text(await controls.appData({ op: 'prefs', name: String(args.prefs) }))];
      if (args.db && args.table) return [text(await controls.appData({ op: 'rows', db: String(args.db), table: String(args.table), offset: bounded(args.offset, 0, 0, 1e9), limit: bounded(args.limit, 100, 1, 500) }))];
      return [text(await controls.appData({ op: 'overview' }))];
    },
    async set_preferences(args) {
      if (!controls?.appData) throw fail('App data is not available on this page.');
      if (!args.name || !Array.isArray(args.changes) || !args.changes.length) throw fail('name and changes ([{ key, type, value } or { key, remove: true }]) are required.');
      return [text(await controls.appData({ op: 'edit-prefs', name: String(args.name), changes: args.changes }))];
    },
    async edit_row(args) {
      if (!controls?.appData) throw fail('App data is not available on this page.');
      if (!args.db || !args.table) throw fail('db and table are required.');
      const change = { rowid: args.rowid ?? null, key: args.key ?? null, set: args.set ?? null, insert: args.insert ?? null, remove: args.remove === true };
      return [text(await controls.appData({ op: 'edit-row', db: String(args.db), table: String(args.table), change }))];
    },
    async sql(args) {
      if (!controls?.appData) throw fail('App data is not available on this page.');
      if (!args.db || !args.sql) throw fail('db and sql are required.');
      return [text(await controls.appData({ op: 'sql', db: String(args.db), sql: String(args.sql), params: Array.isArray(args.params) ? args.params : [], limit: bounded(args.limit, 200, 1, 500) }))];
    },
    async device(args) { if (!controls?.device) throw fail('Device settings are not available on this page.'); return [text(controls.device(args.set ?? null))]; },
    // ---- installing, opening and closing apps, deep links, Back and permissions are adb commands (adb install, am start, am force-stop, input keyevent 4, pm grant) ----
    /** A video of the screen (src/screen-recorder.js): start, then the other tools act on the app, then stop writes the file on the bridge's machine (`args.local.outputs.recording`). */
    async record_screen(args, context) {
      const recorder = controls?.recordScreen; if (!recorder) throw fail('Screen recording is not available on this page.');
      const action = String(args.action ?? '');
      if (action === 'start') return [text({ ...recorder.start({ fps: args.fps, maxWidth: args.max_width, maxSeconds: args.max_seconds, format: args.format ?? null }), note: 'Recording. Use the other tools, then record_screen with action "stop" (and path) to write the file.' })];
      if (action === 'status') return [text(recorder.status())];
      if (action === 'discard') return [text({ discarded: recorder.discard() })];
      if (action !== 'stop') throw fail('action is start, stop, status or discard.');
      const { blob, ...video } = await recorder.stop(), slot = args.local?.outputs?.recording;
      const kept = 'The video is still kept on the page: call stop again with a valid path, or discard.';
      if (!slot?.id || typeof context?.sendFile !== 'function') throw fail(`${args.local?.missing?.recording ?? 'the bridge did not open the output file (use the current lab-mcp.mjs bridge)'}. ${kept}`);
      if (slot.ext && slot.ext !== video.container) throw fail(`The recording is ${video.container} (${video.type}): use a path ending in .${video.container}. ${kept}`);
      await context.sendFile(slot, blob, { ext: video.container }); recorder.discard();
      return [text({ saved: true, ...video })];
    },
    /** An adb command line run by the page's interpreter (src/adb-commands.js). `args.local`, put there by the bridge: the local files the command names ({ files: { path: { id, name, size } }, missing: { path: reason }, outputs: { path: { id } } }). */
    async adb(args, context) {
      if (!controls?.adb) throw fail('The adb command interpreter is not available on this page.');
      const command = typeof args.command === 'string' && args.command.trim() ? args.command : null, words = Array.isArray(args.args) && args.args.length ? args.args.map(String) : null;
      if (!command && !words) throw fail('Pass command (the line, e.g. "adb shell input tap 200 400") or args (the words of an adb command). "adb help" lists what there is.');
      const local = args.local ?? {}, io = {
        localFile: async path => { const file = local.files?.[path]; if (file && typeof context?.fetchFile === 'function') return context.fetchFile(file); throw Object.assign(new Error(`adb: ${path}: ${local.missing?.[path] ?? 'the bridge did not offer this file (use the current lab-mcp.mjs bridge)'}`), { name: 'AdbError', exitCode: 1 }); },
        writeLocal: async (path, blob) => { const slot = local.outputs?.[path]; if (slot?.id && typeof context?.sendFile === 'function') return context.sendFile(slot, blob); throw Object.assign(new Error(`adb: write ${path.replace(/^pull:/, '')}: ${local.missing?.[path] ?? 'the bridge did not open this output file (use the current lab-mcp.mjs bridge)'}`), { name: 'AdbError', exitCode: 1 }); },
      };
      const result = await controls.adb(command ? { command } : { args: words }, io), content = [];
      for (const picture of result.images ?? []) content.push(await image({ blob: picture.blob, type: picture.type }));
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      content.push(text(output || (result.images?.length ? '(image)' : '(no output)')));
      if (result.code !== 0 || result.notes?.length) content.push(text({ exit: result.code, ...(result.notes?.length ? { lab: result.notes } : {}) }));
      return Object.assign(content, { isError: result.code !== 0 });
    },
    async host_redirects(args) { if (!controls?.hostRedirects) throw fail('Redirect hosts is not available on this page.'); return [text(controls.hostRedirects(Array.isArray(args.rules) ? args.rules : null))]; },
    // ---- the app's code (src/code-service.js through the page's debugger controller, src/debugger-controller.js) ----
    async code_search(args) {
      const out = await codeAction({ op: 'search', query: String(args.query ?? ''), kinds: Array.isArray(args.kinds) ? args.kinds.map(String) : undefined, limit: bounded(args.limit, 50, 1, 500), framework: args.framework === true });
      return [text({ count: out.results.length, more: out.more, results: out.results.map(r => compact(r)) })];
    },
    async code_disassemble(args) {
      if (!args.class_name) throw fail('class_name is required (pkg.Name or Lpkg/Name;).');
      const out = await codeAction({ op: 'disassemble', descriptor: String(args.class_name), method: args.method ? String(args.method) : null });
      if (!args.method) return [text({ descriptor: out.descriptor, file: out.file, framework: out.framework || undefined, lineCount: out.lineCount, methods: out.methods.map(m => ({ key: m.key, lines: `${m.startLine}-${m.endLine}`, hasCode: m.hasCode || undefined, modified: m.modified || undefined })), smali: out.text })];
      // one method: each instruction line with its dex pc, the unit breakpoints and steps use
      const m = out.methods.find(item => item.key === out.method.key), lines = out.text.split('\n'), pcAt = new Map(m.pcToLine.map(([pc, line]) => [line, pc]));
      const listing = lines.slice(m.startLine - 1, m.endLine).map((line, i) => { const pc = pcAt.get(m.startLine + i); return `${pc === undefined ? '    ' : pc.toString(16).padStart(4, '0')}  ${line}`; }).join('\n');
      return [text({ key: m.key, registers: m.registers, units: m.units, modified: m.modified || undefined, note: 'Each instruction line starts with its dex pc in hex: debug_set_breakpoint takes it as pc (decimal or "0x..").', listing })];
    },
    async code_decompile(args) {
      if (!args.class_name) throw fail('class_name is required (pkg.Name or Lpkg/Name;).');
      const out = await codeAction({ op: 'decompile', descriptor: String(args.class_name), method: args.method ? String(args.method) : null });
      const source = out.text.split('\n'), firstPc = new Map(out.lines.map(([line, , pc]) => [line, pc]));
      const from = out.method ? out.method.startLine : 1, to = out.method ? out.method.endLine : source.length;
      const listing = source.slice(from - 1, to).map((line, i) => { const n = from + i, pc = firstPc.get(n); return `${String(n).padStart(5)} ${pc === undefined ? '    ' : pc.toString(16).padStart(4, '0')}  ${line}`; }).join('\n');
      const methodsShown = out.method ? out.methods.filter(m => m.key === out.method.key) : out.methods;
      return [text({ descriptor: out.descriptor, file: out.file, framework: out.framework || undefined, lineCount: out.lineCount, stats: out.stats,
        methods: methodsShown.map(m => ({ key: m.key, lines: `${m.startLine}-${m.endLine}`, notDecompiled: m.fallback ? `${m.fallback}: ${m.reason}` : undefined, modified: m.modified || undefined })),
        note: 'Decompiled Java, not the original source. Each line: its number, then the dex pc (hex) of the first instruction it runs, blank for lines that run no code. A breakpoint on a Java line: debug_set_breakpoint with class_name, method (the key of the method the line is in) and that pc.',
        listing })];
    },
    async code_class_info(args) { if (!args.class_name) throw fail('class_name is required.'); return [text(await codeAction({ op: 'classInfo', descriptor: String(args.class_name) }))]; },
    async code_read_file(args) {
      if (!args.path) throw fail('path is required (an APK entry such as assets/config.json; code_search with kinds ["file"] lists them).');
      const out = await codeAction({ op: 'readFile', path: String(args.path) }), { bytes, ...rest } = out;
      return [text({ ...rest, ...(bytes ? { note: `${out.kind} (${out.mime ?? ''}, ${out.size} bytes): shown in the Code tool, not returned here` } : {}) })];
    },
    async code_edit_file(args) {
      if (!args.path || typeof args.text !== 'string') throw fail('path and text are required.');
      const edit = await codeAction({ op: 'editFile', path: String(args.path), text: args.text });
      return [text({ edited: edit, note: 'Listed as "App modified" (owner MCP): the app reads the new bytes the next time it opens the file; reload (mode reopen) to see it everywhere. code_revert_file restores the APK\'s bytes.' })];
    },
    async code_revert_file(args) { if (!args.path) throw fail('path is required.'); return [text(await codeAction({ op: 'revertFile', path: String(args.path) }))]; },
    async code_edit_method(args) {
      if (typeof hook !== 'function') throw fail('Method changes are not available on this page.');
      if (!args.class_name || !args.method || typeof args.smali !== 'string') throw fail('class_name, method ("name(params)ret", as code_disassemble lists it) and smali (the body) are required.');
      const key = String(args.method).includes('->') ? String(args.method) : `${String(args.class_name).startsWith('L') ? String(args.class_name) : `L${String(args.class_name).replaceAll('.', '/')};`}->${args.method}`;
      try { const out = await hook({ method: key, kind: 'smali', smali: args.smali, persist: args.persist === true }); return [text({ id: out.id, method: out.method, kind: out.kind, persist: out.persist || undefined, note: 'Listed as "App modified" (owner MCP); the next call runs the new body. Remove it in App modified.' })]; }
      catch (error) { if (Array.isArray(error?.errors) && error.errors.length) throw Object.assign(new Error(`${error.message}\n${error.errors.slice(0, 20).map(e => `  line ${e.line}: ${e.message}`).join('\n')}`), { code: error.code ?? 'verify' }); throw error; }
    },
    // ---- the debugger (src/debugger-controller.js: the same session as the Code tool's debugger UI) ----
    async debug_attach(args) { return [text(summaryOf(await dbg().attach({ suspend: args.suspend })))]; },
    async debug_detach() { return [text(await dbg().detach())]; },
    async debug_set_breakpoint(args) {
      const spec = breakpointSpec(args), bp = await dbg().setBreakpoint(spec, owner);
      return [text({ ...compactBreakpoint(bp), next: 'Trigger the code (tap, invoke_method, open_app...), then debug_wait.' })];
    },
    async debug_remove_breakpoint(args) { if (!args.id) throw fail('id is required (debug_breakpoints lists them).'); return [text(await dbg().removeBreakpoint(String(args.id)))]; },
    async debug_breakpoints() { return [text(dbg().breakpoints().map(compactBreakpoint))]; },
    async debug_pause() { await dbg().command('pause', {}); return [text({ ...summaryOf(dbg().state()), note: 'A running VM event finishes first; a breakpoint is the way to stop inside one.' })]; },
    async debug_continue(args) { await dbg().command('resume', args.thread ? { thread: String(args.thread) } : {}); return [text({ resumed: true, thread: args.thread ?? 'all' })]; },
    async debug_step(args) {
      const thread = args.thread ? String(args.thread) : dbg().paused?.thread; if (!thread) throw Object.assign(new Error('Nothing is paused (debug_wait first).'), { code: 'not-paused' });
      const before = dbg().paused?.seq ?? null;
      await dbg().command('step', { thread, kind: ['into', 'over', 'out'].includes(args.kind) ? args.kind : 'over', unit: args.unit === 'instruction' ? 'instruction' : 'line' });
      if (args.wait === false) return [text({ stepping: true })];
      return [text(await pauseReport(await dbg().waitForPause(bounded(args.timeout_ms, 5000, 0, 60000), { after: before }), args))];
    },
    async debug_run_to(args) {
      const thread = args.thread ? String(args.thread) : dbg().paused?.thread;
      const target = args.pc !== undefined ? { method: methodRef(args), pc: pcOf(args.pc) } : { className: String(args.class_name ?? ''), line: Number(args.line) };
      if (target.method === undefined && !target.className) throw fail('class_name and line, or class_name, method and pc.');
      const before = dbg().paused?.seq ?? null;
      const out = await dbg().command('run-to', { ...(thread ? { thread } : {}), ...target });
      if (args.wait === false) return [text(out)];
      return [text(await pauseReport(await dbg().waitForPause(bounded(args.timeout_ms, 10000, 0, 60000), { after: before }), args))];
    },
    async debug_threads() { return [text((await dbg().command('threads')).map(t => ({ id: t.id, name: t.name, state: t.state, held: t.held || undefined, main: t.main || undefined, stop: t.stop ? `${t.stop.reason} at ${where(t.stop.location)}` : undefined })))]; },
    async debug_stack(args) { const out = await dbg().command('frames', { thread: threadOf(args), count: bounded(args.count, 32, 1, 256) }); return [text({ thread: out.thread, total: out.total, frames: out.frames.map(frameOut) })]; },
    async debug_locals(args) { const out = await dbg().command('locals', { thread: threadOf(args), frame: bounded(args.frame, 0, 0, 10000) }); return [text(localsOut(out, args.registers === true))]; },
    async debug_evaluate(args) { if (!args.expression) throw fail('expression is required (Java-like, read-only: names, fields, arrays, arithmetic, comparisons).'); return [text(await dbg().command('evaluate', { thread: threadOf(args), frame: bounded(args.frame, 0, 0, 10000), expression: String(args.expression) }))]; },
    async debug_set_local(args) { if (!args.name) throw fail('name and value are required.'); return [text(await dbg().command('set-local', { thread: threadOf(args), frame: bounded(args.frame, 0, 0, 10000), name: String(args.name), value: args.value }))]; },
    /** The agent's main loop: waits for the next stop (or returns the current one) with its location, stack and locals. */
    async debug_wait(args) {
      const c = dbg(); if (!c.attached) throw Object.assign(new Error('The debugger is not attached: debug_set_breakpoint first.'), { code: 'not-attached' });
      const event = await c.waitForPause(bounded(args.timeout_ms, 10000, 0, 120000), { current: args.current !== false, after: Number.isFinite(Number(args.after)) ? Number(args.after) : null });
      return [text(await pauseReport(event, args))];
    },
    async wait_ready(args) { const report = readyReport(await waitReady(args.timeout_ms, args.network_ms)); return [text({ ...report, waitingFor: report.waitingFor ?? [] })]; },
  };
  return {
    names: Object.keys(tools),
    /** One MCP tool call -> { content, isError }. Errors are tool errors (the client sees the message), never thrown. `context.fetchFile(file)`: a file the bridge offers with the call. */
    async execute(name, args = {}, context = {}) {
      const tool = tools[name]; if (!tool) return { isError: true, content: [text(`Unknown tool on this page: ${name}. Refresh the lab page (the bridge is newer).`)] };
      try { const content = await tool(args && typeof args === 'object' ? args : {}, context ?? {}); return content.isError ? { content: [...content], isError: true } : { content }; }
      catch (error) { return { isError: true, content: [text(`${error?.code ? `[${error.code}] ` : ''}${error?.message ?? error}`)] }; }
    },
  };
}
