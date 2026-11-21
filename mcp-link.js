// The page's side of the MCP bridge (scripts/lab-mcp.mjs, published as tools/lab-mcp.mjs): the page finds the bridge on this machine (http://127.0.0.1:8790 by default) and
// connects by itself (the owner's decision, 2026-11-20: no pairing token, no Connect click). It opens an event stream to the bridge, receives each tool call the MCP client makes and
// posts back what src/mcp-tools.js answers. The bridge accepts only the lab's origins (its Origin check is the protection, with 127.0.0.1 as the default address). While no bridge
// answers, the link looks again quietly with a growing pause (watch / nudge); nothing it does writes to the console. No process.*.

/** Kept equal to DEFAULT_ORIGINS / DEFAULT_PORT of scripts/lab-mcp.mjs (tests/lab-mcp.test.mjs checks it). */
export const MCP_DEFAULT_ORIGINS = ['https://madmax-dev-br.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765'];
export const MCP_DEFAULT_PORT = 8790;
export const MCP_DEFAULT_URL = `http://127.0.0.1:${MCP_DEFAULT_PORT}`;
export const MCP_SERVER_NAME = 'apk-lab';
export const MCP_SCRIPT_PLACEHOLDER = '/path/to/lab-mcp.mjs';
/** The pause between two looks for a bridge that is not there: from the first to the last, then the last again (ms). */
export const MCP_RETRY_STEPS = [2000, 4000, 8000, 15000, 30000, 60000];

/** The port of a bridge address ("http://127.0.0.1:8790" -> 8790), or the default. */
export function mcpBridgePort(url) {
  try { const parsed = new URL(String(url ?? '').trim()); return parsed.port ? Number(parsed.port) : MCP_DEFAULT_PORT; } catch { return MCP_DEFAULT_PORT; }
}

/**
 * Settings stored by an older page ({ url, token, lan, agent }): the same without the token, which nothing uses any more. -> { url, lan, agent, changed } (`changed`: the stored
 * record should be written again).
 */
export function migrateMcpSettings(saved) {
  const record = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const url = typeof record.url === 'string' && /^https?:\/\//.test(record.url.trim()) ? record.url.trim() : MCP_DEFAULT_URL;
  return { url, lan: record.lan === true, agent: typeof record.agent === 'string' ? record.agent : null, changed: 'token' in record };
}

/**
 * The entry for an MCP client that starts the bridge itself over stdio (a project .mcp.json, claude_desktop_config.json ...): the port of the bridge address and, when this page is
 * not one of the bridge's default origins, --origin for it. -> { mcpServers: { 'apk-lab': { command, args } } }
 */
export function mcpClientConfig({ scriptPath = MCP_SCRIPT_PLACEHOLDER, port = MCP_DEFAULT_PORT, origin = null } = {}) {
  const args = [String(scriptPath ?? '').trim() || MCP_SCRIPT_PLACEHOLDER];
  if (Number(port) !== MCP_DEFAULT_PORT) args.push('--port', String(port));
  if (origin && /^https?:\/\//.test(origin) && !MCP_DEFAULT_ORIGINS.includes(origin)) args.push('--origin', origin);
  return { mcpServers: { [MCP_SERVER_NAME]: { command: 'node', args } } };
}

/** The one terminal command that fetches the bridge and leaves it serving MCP over HTTP (scripts/lab-mcp.mjs serve). `lan`: also for other machines of the network. */
export function mcpServeCommand({ port = MCP_DEFAULT_PORT, origin = null, lan = false, scriptUrl = 'tools/lab-mcp.mjs' } = {}) {
  const parts = [`curl -sO ${scriptUrl}`, '&&', 'node lab-mcp.mjs serve'];
  if (Number(port) !== MCP_DEFAULT_PORT) parts.push('--port', String(port));
  if (origin && /^https?:\/\//.test(origin) && !MCP_DEFAULT_ORIGINS.includes(origin)) parts.push('--origin', origin);
  if (lan) parts.push('--host', '0.0.0.0');
  return parts.join(' ');
}
/** The address an MCP client connects to (Streamable HTTP), and the Claude Code command that adds it. */
export function mcpHttpAddress({ port = MCP_DEFAULT_PORT, host = '127.0.0.1' } = {}) { return `http://${host}:${Number(port) || MCP_DEFAULT_PORT}/mcp`; }
export function mcpAgentCommand(options = {}) { return `claude mcp add --transport http ${MCP_SERVER_NAME} ${mcpHttpAddress(options)}`; }

/** The agents the page has a ready-made setup for. */
export const MCP_AGENTS = ['claude', 'codex', 'cursor'];
/**
 * What to do in each agent to add this bridge by its address: { where, text, link } (`where`: what the text is and where it goes; `link`: a one-click install link, Cursor only).
 * Claude Code takes a command; Codex takes an entry of ~/.codex/config.toml; Cursor takes an entry of .cursor/mcp.json (or its install deeplink, whose config is base64 JSON).
 */
export function mcpAgentSetup(agent, options = {}) {
  const address = mcpHttpAddress(options);
  if (agent === 'codex') return { where: 'Paste into ~/.codex/config.toml and restart Codex', text: `[mcp_servers.${MCP_SERVER_NAME}]\nurl = "${address}"`, link: null };
  if (agent === 'cursor') {
    const text = JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { url: address } } }, null, 2);
    let link = null; try { link = `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(MCP_SERVER_NAME)}&config=${encodeURIComponent(btoa(JSON.stringify({ url: address })))}`; } catch { /* no btoa: the JSON is enough */ }
    return { where: "Paste into the project's .cursor/mcp.json (or ~/.cursor/mcp.json)", text, link };
  }
  return { where: "Run in the project's terminal (Claude Code)", text: mcpAgentCommand(options), link: null };
}

/**
 * execute(tool, args, context) -> Promise<{ content, isError }>; context.fetchFile(file) reads a file the bridge offers with the call (adb install / push) and context.sendFile(slot, blob)
 * hands it one to write (adb pull). onState({ state, message, server, calls, lastTool }), state: 'desconectado' (off: stopped by the user, or another tab took the bridge),
 * 'procurando' (no bridge answers yet: looking again later), 'ocupado' (the bridge serves another lab tab), 'conectando', 'conectado', 'erro'.
 * Returns { watch({ url }), nudge(), connect({ url }), disconnect(), get connected(), get state }:
 *  - watch: look for the bridge now and keep looking while it is not there (a pause from MCP_RETRY_STEPS); connects as soon as it answers and no other tab holds it;
 *  - nudge: look again now (the section was opened, the tab became visible), from the shortest pause;
 *  - connect: the user's Connect: connect now, taking the bridge from another tab if one holds it, and keep watching;
 *  - disconnect: the user's Disconnect: close the link and stop looking until watch or connect.
 * `timers` ({ setTimeout, clearTimeout }) and `visible()` (no look while the page is hidden) are injectable for tests.
 */
export function createMcpLink({ execute, onState = () => {}, EventSourceImpl = globalThis.EventSource, fetchImpl = (...args) => globalThis.fetch(...args), timers = { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: id => globalThis.clearTimeout(id) }, visible = () => globalThis.document?.visibilityState !== 'hidden', probeTimeoutMs = 2000 }) {
  const S = { source: null, base: null, url: MCP_DEFAULT_URL, state: 'desconectado', message: '', server: null, calls: 0, lastTool: null, watching: false, timer: null, attempt: 0, looking: null };
  const emit = (state, message = '') => { if (S.state === state && S.message === message) return; S.state = state; S.message = message; onState({ state, message, server: S.server, calls: S.calls, lastTool: S.lastTool }); };
  const report = () => onState({ state: S.state, message: S.message, server: S.server, calls: S.calls, lastTool: S.lastTool });
  const clean = url => String(url ?? '').trim().replace(/\/+$/, '');
  const originHint = () => { const origin = globalThis.location?.origin; return origin && !MCP_DEFAULT_ORIGINS.includes(origin) ? ` If it is running, it must accept this page's origin (${origin}): the command above carries --origin.` : ''; };
  async function answer(call) {
    const base = S.base; if (!base) return;
    let result; try { result = await execute(call.tool, call.args ?? {}, { fetchFile: file => fetchFile(base, file), sendFile: (slot, blob, options) => sendFile(base, slot, blob, options) }); } catch (error) { result = { isError: true, content: [{ type: 'text', text: String(error?.message ?? error) }] }; }
    S.calls++; S.lastTool = call.tool; if (S.state === 'conectado') report();
    try { await fetchImpl(`${base}/result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: call.id, ...result }) }); }
    catch (error) { emit('erro', `the response did not reach the bridge: ${error?.message ?? error}`); }
  }
  /** A file the bridge offers for the call in flight (adb install / push: { id, name, size }), read from the bridge on this machine into a File. */
  async function fetchFile(base, { id, name, size } = {}) {
    if (!/^[0-9a-f]{16,64}$/.test(String(id ?? ''))) throw new Error('The bridge did not deliver the file for this call.');
    const res = await fetchImpl(`${base}/file/${id}`, { cache: 'no-store' });
    if (!res?.ok) throw new Error(`The bridge did not deliver the file (HTTP ${res?.status ?? '?'}).`);
    const blob = await res.blob();
    if (Number.isFinite(size) && blob.size !== size) throw new Error(`The file arrived incomplete from the bridge (${blob.size} of ${size} bytes).`);
    return new File([blob], String(name ?? 'app.apk'), { type: 'application/vnd.android.package-archive' });
  }
  /** Bytes for a file the bridge will write on its machine for the call in flight (adb pull, `> file`: { id }). */
  async function sendFile(base, { id } = {}, blob, { ext = null } = {}) {   // ext: the extension of a file the bridge named without one (a screen recording: mp4 or webm)
    if (!/^[0-9a-f]{16,64}$/.test(String(id ?? ''))) throw new Error('The bridge did not open an output file for this call.');
    const res = await fetchImpl(`${base}/file/${id}${/^[a-z0-9]{1,8}$/.test(String(ext ?? '')) ? `?ext=${ext}` : ''}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: blob });
    if (!res?.ok) { let reason = ''; try { reason = (await res.json())?.error ?? ''; } catch { /* no body */ } throw new Error(`The bridge did not write the file (HTTP ${res?.status ?? '?'}${reason ? `: ${reason}` : ''}).`); }
  }
  /** GET <url>/hello, bounded: -> { status: 'up', connected, server } | { status: 'refused', error } (403: another origin) | { status: 'down' }. */
  async function hello(url) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null, timer = timers.setTimeout(() => controller?.abort(), probeTimeoutMs);
    try {
      const res = await fetchImpl(`${url}/hello`, { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) });
      let body = null; try { body = await res.json(); } catch { body = null; }
      if (res?.status === 403) return { status: 'refused', error: body?.error ?? 'origin not allowed' };
      if (!res?.ok || !body?.server) return { status: 'down' };
      return { status: 'up', connected: body.connected === true, server: body.server };
    } catch { return { status: 'down' }; }
    finally { timers.clearTimeout(timer); }
  }
  function schedule(fast = false) {
    if (S.timer !== null) { timers.clearTimeout(S.timer); S.timer = null; }
    if (!S.watching || S.source) return;
    const pause = fast ? MCP_RETRY_STEPS[0] : MCP_RETRY_STEPS[Math.min(S.attempt, MCP_RETRY_STEPS.length - 1)];
    S.attempt++; S.timer = timers.setTimeout(() => { S.timer = null; look(); }, pause);
  }
  /** One look for the bridge; connects when it answers and is free (or when `take`: the user's Connect). */
  async function look({ take = false } = {}) {
    if (S.source || S.looking) return S.looking;
    if (!take && !visible()) { schedule(); return null; }   // a hidden tab looks again when it is shown (nudge) or after the pause
    const url = S.url;
    S.looking = (async () => {
      const found = await hello(url);
      if (url !== S.url || (!S.watching && !take)) return;
      if (found.status === 'up' && (take || S.take || !found.connected)) { S.take = false; open(url); return; }
      if (found.status === 'up') { emit('ocupado', `The bridge at ${url} is serving another lab tab. Connect takes it over here.`); schedule(); return; }
      if (found.status === 'refused') { emit('erro', `The bridge at ${url} refused this page (${found.error}).${originHint()}`); schedule(); return; }
      emit('procurando', `Waiting for the bridge at ${url}: run the command above in a terminal and leave it open; the page connects by itself.${originHint()}`); schedule();
    })().finally(() => { S.looking = null; });
    return S.looking;
  }
  function open(url) {
    if (typeof EventSourceImpl !== 'function') { emit('erro', 'This browser has no EventSource.'); return; }
    closeSource();
    S.base = url; S.calls = 0; S.server = null; emit('conectando', `${url}…`);
    const source = new EventSourceImpl(`${url}/events`); S.source = source;
    source.addEventListener('hello', event => { if (S.source !== source) return; try { S.server = JSON.parse(event.data).server ?? null; } catch { S.server = null; } S.attempt = 0; emit('conectado', url); });
    source.addEventListener('call', event => { if (S.source !== source) return; let call; try { call = JSON.parse(event.data); } catch { return; } answer(call); });
    source.addEventListener('replaced', () => { if (S.source !== source) return; closeSource(); S.watching = false; emit('desconectado', 'Another lab tab connected to this bridge. Connect takes it back here.'); });
    // The bridge stopped (or the network dropped): close the stream at once, instead of letting EventSource retry every few seconds, and go back to looking with a pause.
    source.onerror = () => { if (S.source !== source) return; closeSource(); S.attempt = 0; emit('procurando', `The bridge at ${url} stopped answering: looking for it again…`); schedule(true); };
  }
  function closeSource() { if (S.source) { try { S.source.close(); } catch { /* already closed */ } } S.source = null; S.base = null; }
  function setUrl(url) {
    const next = clean(url);
    if (!/^https?:\/\//.test(next)) { emit('erro', `Invalid bridge address (e.g. ${MCP_DEFAULT_URL}).`); return false; }
    if (next !== S.url) { closeSource(); S.url = next; S.attempt = 0; }
    return true;
  }
  return {
    watch({ url = S.url } = {}) { if (!setUrl(url)) return false; S.watching = true; if (!S.source) { S.attempt = 0; look(); } return true; },
    nudge() { if (!S.watching || S.source) return; S.attempt = 0; if (S.timer !== null) { timers.clearTimeout(S.timer); S.timer = null; } look(); },
    connect({ url = S.url } = {}) { if (!setUrl(url)) return false; S.watching = true; S.take = true; if (S.timer !== null) { timers.clearTimeout(S.timer); S.timer = null; } closeSource(); S.attempt = 0; look({ take: true }); return true; },
    disconnect(notify = true) { S.watching = false; S.take = false; if (S.timer !== null) { timers.clearTimeout(S.timer); S.timer = null; } closeSource(); if (notify) emit('desconectado', 'Disconnected. Connect connects again.'); },
    get connected() { return S.state === 'conectado'; },
    get state() { return { state: S.state, message: S.message, server: S.server, calls: S.calls, lastTool: S.lastTool, watching: S.watching, url: S.url }; },
  };
}
