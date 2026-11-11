// The page's side of the MCP bridge (scripts/lab-mcp.mjs, published as tools/lab-mcp.mjs): Controles › MCP › Conectar opens an event stream to the bridge on this machine
// (http://127.0.0.1:8790 by default), receives each tool call the MCP client makes and posts back what src/mcp-tools.js answers. Nothing runs while disconnected; the bridge
// accepts only the lab's origins and the pairing token. No process.*.

/**
 * execute(tool, args) -> Promise<{ content, isError }>. onState({ state: 'desconectado' | 'conectando' | 'conectado' | 'erro', message, server, calls }).
 * Returns { connect({ url, token }), disconnect(), get connected(), state }.
 */
export function createMcpLink({ execute, onState = () => {}, EventSourceImpl = globalThis.EventSource, fetchImpl = (...args) => globalThis.fetch(...args) }) {
  const S = { source: null, base: null, state: 'desconectado', message: '', server: null, calls: 0, lastTool: null };
  const emit = (state, message = '') => { S.state = state; S.message = message; onState({ state, message, server: S.server, calls: S.calls, lastTool: S.lastTool }); };
  async function answer(call) {
    const base = S.base; if (!base) return;
    let result; try { result = await execute(call.tool, call.args ?? {}); } catch (error) { result = { isError: true, content: [{ type: 'text', text: String(error?.message ?? error) }] }; }
    S.calls++; S.lastTool = call.tool; if (S.state === 'conectado') emit('conectado', S.message);
    try { await fetchImpl(`${base}/result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: call.id, ...result }) }); }
    catch (error) { emit('erro', `a resposta não chegou à ponte: ${error?.message ?? error}`); }
  }
  function connect({ url, token }) {
    disconnect(false);
    const clean = String(url ?? '').trim().replace(/\/+$/, ''), key = String(token ?? '').trim();
    if (!/^https?:\/\//.test(clean)) { emit('erro', 'Endereço inválido (ex.: http://127.0.0.1:8790).'); return false; }
    if (!key) { emit('erro', 'Informe o token (no terminal: node lab-mcp.mjs token).'); return false; }
    if (typeof EventSourceImpl !== 'function') { emit('erro', 'Este navegador não tem EventSource.'); return false; }
    S.base = `${clean}/${encodeURIComponent(key)}`; S.calls = 0; S.server = null; emit('conectando', `${clean}…`);
    const source = new EventSourceImpl(`${S.base}/events`); S.source = source;
    source.addEventListener('hello', event => { if (S.source !== source) return; try { S.server = JSON.parse(event.data).server ?? null; } catch { S.server = null; } emit('conectado', `${clean}`); });
    source.addEventListener('call', event => { if (S.source !== source) return; let call; try { call = JSON.parse(event.data); } catch { return; } answer(call); });
    source.addEventListener('replaced', () => { if (S.source !== source) return; disconnect(false); emit('desconectado', 'Outra aba conectou a esta ponte.'); });
    source.onerror = () => {
      if (S.source !== source) return;
      // EventSource reconnects by itself (the bridge restarts with the MCP client); CLOSED means a refusal (wrong token or origin) or a bridge that is not running
      if (source.readyState === 2) { disconnect(false); emit('erro', `Sem ponte em ${clean} (rodando? token e origem certos?). No terminal: node lab-mcp.mjs token`); }
      else emit('conectando', `reconectando a ${clean}…`);
    };
    return true;
  }
  function disconnect(notify = true) {
    if (S.source) { try { S.source.close(); } catch { /* already closed */ } }
    S.source = null; S.base = null; if (notify) emit('desconectado', '');
  }
  return { connect, disconnect, get connected() { return S.state === 'conectado'; }, get state() { return { ...S, source: undefined }; } };
}
