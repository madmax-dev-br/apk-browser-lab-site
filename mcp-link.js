// The page's side of the MCP bridge (scripts/lab-mcp.mjs, published as tools/lab-mcp.mjs): Controls › MCP › Connect opens an event stream to the bridge on this machine
// (http://127.0.0.1:8790 by default), receives each tool call the MCP client makes and posts back what src/mcp-tools.js answers. Nothing runs while disconnected; the bridge
// accepts only the lab's origins and the pairing token. The token is generated here (generateMcpToken) and handed to the bridge through the MCP client's configuration
// (mcpClientConfig: the JSON shown in Controls › MCP, token in APK_WEB_LAB_MCP_TOKEN). No process.*.

/** Kept equal to DEFAULT_ORIGINS / DEFAULT_PORT / TOKEN_ENV of scripts/lab-mcp.mjs (tests/lab-mcp.test.mjs checks it). */
export const MCP_DEFAULT_ORIGINS = ['https://madmax-dev-br.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765'];
export const MCP_DEFAULT_PORT = 8790;
export const MCP_TOKEN_ENV = 'APK_WEB_LAB_MCP_TOKEN';
export const MCP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;
export const MCP_SERVER_NAME = 'apk-lab';
export const MCP_SCRIPT_PLACEHOLDER = '/path/to/lab-mcp.mjs';

/** A new pairing token: 192 random bits from crypto.getRandomValues, base64url (32 characters). */
export function generateMcpToken(cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl?.getRandomValues !== 'function') throw new Error('This browser has no crypto.getRandomValues.');
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(24));
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The port of a bridge address ("http://127.0.0.1:8790" -> 8790), or the default. */
export function mcpBridgePort(url) {
  try { const parsed = new URL(String(url ?? '').trim()); return parsed.port ? Number(parsed.port) : MCP_DEFAULT_PORT; } catch { return MCP_DEFAULT_PORT; }
}

/**
 * The entry for the MCP client's configuration (a project .mcp.json, claude_desktop_config.json ...): starts the bridge with this page's token, the port of the bridge
 * address and, when this page is not one of the bridge's default origins, --origin for it. -> { mcpServers: { 'apk-lab': { command, args, env } } }
 */
export function mcpClientConfig({ token, scriptPath = MCP_SCRIPT_PLACEHOLDER, port = MCP_DEFAULT_PORT, origin = null } = {}) {
  const args = [String(scriptPath ?? '').trim() || MCP_SCRIPT_PLACEHOLDER];
  if (Number(port) !== MCP_DEFAULT_PORT) args.push('--port', String(port));
  if (origin && /^https?:\/\//.test(origin) && !MCP_DEFAULT_ORIGINS.includes(origin)) args.push('--origin', origin);
  return { mcpServers: { [MCP_SERVER_NAME]: { command: 'node', args, env: { [MCP_TOKEN_ENV]: String(token ?? '') } } } };
}

/** The one terminal command that fetches the bridge and leaves it serving MCP over HTTP with this page's token (scripts/lab-mcp.mjs serve). `lan`: also for other machines of the network. */
export function mcpServeCommand({ token, port = MCP_DEFAULT_PORT, origin = null, lan = false, scriptUrl = 'tools/lab-mcp.mjs' } = {}) {
  const parts = [`curl -sO ${scriptUrl}`, '&&', 'node lab-mcp.mjs serve', '--token', String(token ?? '')];
  if (Number(port) !== MCP_DEFAULT_PORT) parts.push('--port', String(port));
  if (origin && /^https?:\/\//.test(origin) && !MCP_DEFAULT_ORIGINS.includes(origin)) parts.push('--origin', origin);
  if (lan) parts.push('--host', '0.0.0.0');
  return parts.join(' ');
}
/** The address an MCP client connects to (Streamable HTTP), and the Claude Code command that adds it. */
export function mcpHttpAddress({ token, port = MCP_DEFAULT_PORT, host = '127.0.0.1' } = {}) { return `http://${host}:${Number(port) || MCP_DEFAULT_PORT}/mcp/${encodeURIComponent(String(token ?? ''))}`; }
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
 * execute(tool, args, context) -> Promise<{ content, isError }>; context.fetchFile(file) reads a file the bridge offers with the call (adb install / push) and context.sendFile(slot, blob) hands it one to write (adb pull). onState({ state: 'desconectado' | 'conectando' | 'conectado' | 'erro', message, server, calls }).
 * Returns { connect({ url, token }), disconnect(), get connected(), state }.
 */
export function createMcpLink({ execute, onState = () => {}, EventSourceImpl = globalThis.EventSource, fetchImpl = (...args) => globalThis.fetch(...args) }) {
  const S = { source: null, base: null, state: 'desconectado', message: '', server: null, calls: 0, lastTool: null };
  const emit = (state, message = '') => { S.state = state; S.message = message; onState({ state, message, server: S.server, calls: S.calls, lastTool: S.lastTool }); };
  async function answer(call) {
    const base = S.base; if (!base) return;
    let result; try { result = await execute(call.tool, call.args ?? {}, { fetchFile: file => fetchFile(base, file), sendFile: (slot, blob, options) => sendFile(base, slot, blob, options) }); } catch (error) { result = { isError: true, content: [{ type: 'text', text: String(error?.message ?? error) }] }; }
    S.calls++; S.lastTool = call.tool; if (S.state === 'conectado') emit('conectado', S.message);
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
  function connect({ url, token }) {
    disconnect(false);
    const clean = String(url ?? '').trim().replace(/\/+$/, ''), key = String(token ?? '').trim();
    if (!/^https?:\/\//.test(clean)) { emit('erro', 'Invalid address (e.g. http://127.0.0.1:8790).'); return false; }
    if (!key) { emit('erro', 'No token: click Generate new and run the step 1 command again.'); return false; }
    if (!MCP_TOKEN_PATTERN.test(key)) { emit('erro', 'Invalid token (16 or more letters, digits, _ or -): click Generate new and run the step 1 command again.'); return false; }
    if (typeof EventSourceImpl !== 'function') { emit('erro', 'This browser has no EventSource.'); return false; }
    S.key = key; S.base = `${clean}/${encodeURIComponent(key)}`; S.calls = 0; S.server = null; emit('conectando', `${clean}…`);
    const source = new EventSourceImpl(`${S.base}/events`); S.source = source;
    source.addEventListener('hello', event => { if (S.source !== source) return; try { S.server = JSON.parse(event.data).server ?? null; } catch { S.server = null; } emit('conectado', `${clean}`); });
    source.addEventListener('call', event => { if (S.source !== source) return; let call; try { call = JSON.parse(event.data); } catch { return; } answer(call); });
    source.addEventListener('replaced', () => { if (S.source !== source) return; disconnect(false); emit('desconectado', 'Another tab connected to this bridge.'); });
    source.onerror = () => {
      if (S.source !== source) return;
      // EventSource reconnects by itself (the bridge restarts with the MCP client); CLOSED means a refusal (wrong token or origin). EventSource does not say which, so ask the
      // bridge once (GET /<token>/hello answers 401 for another token, 403 for another origin) and say it plainly.
      if (source.readyState !== 2) emit('conectando', `reconnecting to ${clean}…`);
      diagnose(source, clean);
    };
    return true;
  }
  async function diagnose(source, clean) {
    if (S.checking === source) return; S.checking = source;
    let status = 0, body = null;
    try { const res = await fetchImpl(`${S.base ?? `${clean}/${encodeURIComponent(S.key ?? '')}`}/hello`, { cache: 'no-store' }); status = res?.status ?? 0; body = await res?.json?.().catch(() => null); }
    catch { status = -1; }
    finally { if (S.checking === source) S.checking = null; }
    if (S.source !== source) return;
    if (status === 401) { disconnect(false); emit('erro', `The bridge at ${clean} refused this page's token. The token changed or the MCP client still uses the old one: stop the bridge and run the step 1 command again (and update the address in the agent).`); }
    else if (status === 403) { disconnect(false); emit('erro', `The bridge at ${clean} refused this origin (${body?.error ?? 'origin not allowed'}). Run the step 1 command again: it carries --origin for this page.`); }
    else if (status === -1) {
      // a bridge that refuses this origin answers without CORS headers, which looks like no bridge at all from here
      const origin = globalThis.location?.origin, hint = origin && !MCP_DEFAULT_ORIGINS.includes(origin) ? ` If the bridge is running, it must accept this origin (${origin}): the step 1 command already carries --origin.` : '';
      if (source.readyState === 2) { disconnect(false); emit('erro', `No bridge at ${clean}: is the step 1 command running in the terminal? Run it and click Connect.${hint}`); }
      else emit('conectando', `No bridge at ${clean} yet: is the step 1 command running in the terminal? Trying again…${hint}`);
    }
    else if (source.readyState === 2) { disconnect(false); emit('erro', `The bridge at ${clean} closed the connection${body?.error ? `: ${body.error}` : ''}.`); }
  }
  function disconnect(notify = true) {
    if (S.source) { try { S.source.close(); } catch { /* already closed */ } }
    S.source = null; S.base = null; if (notify) emit('desconectado', '');
  }
  return { connect, disconnect, get connected() { return S.state === 'conectado'; }, get state() { return { ...S, source: undefined }; } };
}
