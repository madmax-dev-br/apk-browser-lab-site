// The MCP tools as the lab page answers them (scripts/lab-mcp.mjs lists them for the MCP client and forwards each call here). Every tool reads what the page already has:
// the plugin host's read-only queries (src/plugin-host.js query: the same ones plugins use, same limits), the plugins' output, the Logcat and network stores. Results are MCP
// content: text (JSON, compact) and images (base64). DOM-free except Blob reading; no process.*.

export const MAX_TEXT_CHARS = 400_000;
const LEVEL_ORDER = ['V', 'D', 'I', 'W', 'E', 'A'];
const text = value => {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  return { type: 'text', text: body.length > MAX_TEXT_CHARS ? body.slice(0, MAX_TEXT_CHARS) + `\n… (cortado: ${body.length - MAX_TEXT_CHARS} caracteres a mais; peça menos, por exemplo max_nodes ou limit)` : body };
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

/**
 * query(method, args): the plugin host's page-level query (screen, layoutBounds, screenshot, composeTree, viewModels, inspect, field, statics, staticField, classes,
 * instances, referrers, compositionLocals, findCompositionLocal). plugins(): the host's read model of the plugins. logcat() / network(): the entries of the page stores.
 * status(): what the page knows about the loaded APK. sleep(ms).
 */
export function createMcpTools({ query, plugins = () => [], logcat = () => [], network = () => [], status = () => ({}), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now() }) {
  async function waitReady(timeoutMs = 15000) {
    const until = now() + bounded(timeoutMs, 15000, 100, 120000);
    for (;;) {
      const screen = await query('screen', {});
      if (screen?.ready?.ready) return { ready: true, screen };
      if (now() >= until) return { ready: false, screen };
      await sleep(150);
    }
  }
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
      if (!element) throw fail(`Nenhum componente na tela com ${tag ? `testTag "${tag}"` : ''}${tag && wanted ? ' e ' : ''}${wanted ? `texto "${args.text}"` : ''} (veja layout_bounds).`);
      return { key: element.key };
    }
    return {};
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
    async composition_locals(args) { if (!args.handle) throw fail('handle é obrigatório (de compose_tree).'); return [text(await query('compositionLocals', { handle: String(args.handle), only: Array.isArray(args.only) ? args.only.map(String) : null, options: { depth: 1 } }))]; },
    async find_composition_local(args) { return [text(await query('findCompositionLocal', { match: String(args.match ?? ''), options: { depth: 1 } }))]; },
    async view_models() { return [text(await query('viewModels', {}))]; },
    async inspect(args) { return [text(await query('inspect', { handle: String(args.handle ?? ''), options: { depth: bounded(args.depth, 2, 0, 6) } }))]; },
    async field(args) { return [text(await query('field', { handle: String(args.handle ?? ''), path: Array.isArray(args.path) ? args.path.map(String) : String(args.path ?? ''), options: { depth: bounded(args.depth, 1, 0, 6) } }))]; },
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
          if (block.kind === 'kv') blocks.push({ id: block.id, kind: 'kv', entries: Object.fromEntries(block.entries) });
          else if (block.kind === 'table') blocks.push({ id: block.id, kind: 'table', rows: block.rows.map(row => Object.fromEntries(block.columns.map((column, index) => [column, row[index]]))) });
          else if (block.kind === 'json') { let value; try { value = JSON.parse(block.text); } catch { value = block.text; } blocks.push({ id: block.id, kind: 'json', value }); }
          else blocks.push({ id: block.id, kind: block.kind, text: block.text });
        }
        out.push({ id: plugin.id, name: plugin.name, status: plugin.status, reason: plugin.reason || undefined, badge: plugin.output?.badge || undefined, blocks,
          errors: (plugin.errors ?? []).slice(-5).map(error => `${error.phase}: ${error.message}`), console: (plugin.console ?? []).slice(-20).map(line => `${line.level}: ${line.text}`) });
      }
      if (wanted && !out.length) throw fail(`Plugin "${wanted}" não encontrado (lab_status lista os plugins).`);
      const content = [text(out)];
      for (const { plugin, block } of images.slice(0, 8)) { content.push(await image({ blob: block.blob, type: block.blob.type })); content.push(text(`↑ imagem do plugin ${plugin}${block.caption ? `: ${block.caption}` : ''}`)); }
      return content;
    },
    async logcat(args) {
      const min = LEVEL_ORDER.indexOf(String(args.level ?? 'V').toUpperCase()), needle = args.contains ? String(args.contains).toLowerCase() : null, limit = bounded(args.limit, 200, 1, 5000);
      const rows = logcat().filter(entry => LEVEL_ORDER.indexOf(entry.level) >= Math.max(0, min) && (!needle || `${entry.tag} ${entry.message}`.toLowerCase().includes(needle))).slice(-limit);
      const lines = rows.map(entry => `${(entry.uptime / 1000).toFixed(3)} ${entry.level}/${entry.tag} (${entry.thread}): ${entry.message}`);
      return [text(lines.length ? lines.join('\n') : `Sem linhas${needle || min > 0 ? ' com esse filtro' : ''}. O Logcat é coletado enquanto o MCP está conectado (linhas de antes da conexão não existem).`)];
    },
    async network(args) {
      const needle = args.contains ? String(args.contains).toLowerCase() : null, limit = bounded(args.limit, 50, 1, 1000);
      const rows = network().filter(entry => !needle || `${entry.method} ${entry.url}`.toLowerCase().includes(needle)).slice(-limit).map(entry => ({
        method: entry.method, url: entry.url, status: entry.status, outcome: entry.outcome, durationMs: entry.durationMs, contentType: entry.contentType, responseBytes: entry.responseBytes,
        ...(entry.mockId ? { mock: entry.mockLabel ?? entry.mockId } : {}), ...(entry.mappedUrl ? { redirectedTo: entry.mappedUrl } : {}), ...(entry.refusedHost ? { refusedHost: entry.refusedHost } : {}), ...(entry.failure ? { failure: entry.failure } : {}) }));
      return [text(rows)];
    },
    async wait_ready(args) { const result = await waitReady(args.timeout_ms); return [text({ ready: result.ready, activity: result.screen?.activity ?? null, waitingFor: result.screen?.ready?.waitingFor ?? [] })]; },
  };
  return {
    names: Object.keys(tools),
    /** One MCP tool call -> { content, isError }. Errors are tool errors (the client sees the message), never thrown. */
    async execute(name, args = {}) {
      const tool = tools[name]; if (!tool) return { isError: true, content: [text(`Ferramenta desconhecida nesta página: ${name}. Atualize a página do lab (a ponte é mais nova).`)] };
      try { return { content: await tool(args && typeof args === 'object' ? args : {}) }; }
      catch (error) { return { isError: true, content: [text(`${error?.code ? `[${error.code}] ` : ''}${error?.message ?? error}`)] }; }
    },
  };
}
