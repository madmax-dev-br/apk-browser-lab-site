// The MCP tools as the lab page answers them (scripts/lab-mcp.mjs lists them for the MCP client and forwards each call here). Every tool reads what the page already has:
// the plugin host's read-only queries (src/plugin-host.js query: the same ones plugins use, same limits), the plugins' output, the Logcat and network stores. Results are MCP
// content: text (JSON, compact) and images (base64). DOM-free except Blob reading; no process.*.
import { blockValue, outputsOf } from './plugin-host.js?v=bcf03886254c';

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
 * status(): what the page knows about the loaded APK. clickButton(pluginId, buttonId): a click on a plugin's button (lab.button), resolved when its handler finished. sleep(ms).
 */
export function createMcpTools({ controls = null, query, plugins = () => [], pluginStore = null, clickButton = null, logcat = () => [], network = () => [], status = () => ({}), actions = null, input = null, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now() }) {
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
  const tools = {
    async lab_status() {
      const screen = await query('screen', {});
      return [text({ apk: status(), screen, plugins: plugins().map(plugin => ({ id: plugin.id, name: plugin.name, status: plugin.status, reason: plugin.reason || undefined, errors: plugin.errorCount || undefined })) })];
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
        ...(entry.mockId ? { mock: entry.mockLabel ?? entry.mockId } : {}), ...(entry.mappedUrl ? { redirectedTo: entry.mappedUrl } : {}), ...(entry.proxiedVia ? { proxiedVia: entry.proxiedVia } : {}), ...(entry.refusedHost ? { refusedHost: entry.refusedHost } : {}), ...(entry.failure ? { failure: entry.failure } : {}),
        ...(withBody && typeof entry.responseBody === 'string' ? { responseBody: entry.responseBody.length > 20000 ? entry.responseBody.slice(0, 20000) + '…' : entry.responseBody, responseHeaders: entry.responseHeaders } : {}) }));
      return [text({ requests: out, next })];
    },
    // ---- acting on the lab: the page's own controls (they show in Controls like the user's) ----
    async set_mock(args) {
      if (!actions?.mock) throw fail('Mocks are not available on this page.');
      const headers = args.headers && typeof args.headers === 'object' ? args.headers : undefined, body = args.body === undefined ? '' : typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
      const result = await actions.mock({ id: args.id, name: args.name ?? `MCP ${args.method ?? 'ANY'} ${args.url ?? ''}`.slice(0, 120), method: args.method ?? 'ANY', url: args.url, status: args.status ?? 200, headers: headers ?? (typeof args.body === 'object' && args.body !== null ? { 'Content-Type': 'application/json' } : undefined), body, delayMs: args.delay_ms ?? 0, query: args.query });
      return [text({ id: result.id, note: 'Active in Controls › Endpoint mocks: the next request that matches gets this response without going to the network. Use reload so the app fetches again.' })];
    },
    async remove_mock(args) { if (!actions?.unmock) throw fail('Mocks are not available on this page.'); return [text(await actions.unmock(String(args.id ?? '')))]; },
    async list_mocks() { if (!actions?.mocks) throw fail('Mocks are not available on this page.'); return [text(await actions.mocks())]; },
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
