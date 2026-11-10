#!/usr/bin/env node
// MCP bridge for APK Web Lab: lets an MCP client (Claude Desktop, Claude Code ...) use the lab page that is open in your browser: screenshots of the screen or of one component,
// the output of the running plugins, the Compose tree and CompositionLocals, ViewModels and static state, Logcat and the network log, "Tela pronta".
// A web page cannot accept connections, so this small process sits between them:
//
//   MCP client  --stdio (JSON-RPC, MCP)-->  lab-mcp.mjs  <--HTTP on 127.0.0.1 (events + results)--  the lab page (Controles > MCP > Conectar)
//
//   node lab-mcp.mjs                      run by the MCP client (claude mcp add apk-web-lab -- node /caminho/lab-mcp.mjs)
//   node lab-mcp.mjs token                prints the pairing token to paste in the page
//   options: --port 8790  --origin <lab origin> (repeatable)  --token <token>  --timeout-ms 60000
//
// Every tool call is answered by the page, with what the page shows at that moment; the bridge stores nothing. Safety: it listens on 127.0.0.1 only; the page's requests must come
// from one of the allowed origins (the public lab and a local copy by default: another site open in the same browser is refused by its Origin) and carry the pairing token, kept in
// ~/.apk-web-lab-mcp-token (created once, readable only by you). Node.js built-ins only. Protocol logs go to stderr; stdout carries MCP messages only.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 8790;
export const DEFAULT_ORIGINS = ['https://madmax-dev-br.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765'];
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_INFO = { name: 'apk-web-lab', title: 'APK Web Lab (página aberta no navegador)', version: '1.0.0' };
const MAX_RESULT_BYTES = 24 * 1024 * 1024;

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = description => ({ type: 'string', description }), num = description => ({ type: 'number', description }), bool = description => ({ type: 'boolean', description });
/** The tools; the page (src/mcp-tools.js) answers each one by name. */
export const TOOLS = [
  { name: 'lab_status', description: 'O que a página do lab mostra agora: APK carregado, Activity, janelas, "Tela pronta" e o motivo de não estar pronta, plugins rodando.', inputSchema: obj() },
  { name: 'screenshot', description: 'Imagem da tela do app, ou de um componente: pela chave de layout_bounds (element_key), por testTag, por um texto visível, ou por um retângulo (bounds, coordenadas da janela). Opcional: esperar a tela pronta antes.',
    inputSchema: obj({ element_key: str('chave de um elemento de layout_bounds'), test_tag: str('testTag do componente Compose'), text: str('texto visível do componente (o primeiro que contém)'),
      bounds: obj({ left: num(''), top: num(''), right: num(''), bottom: num('') }, ['left', 'top', 'right', 'bottom']), max_width: num('largura máxima da imagem em px (padrão 1080)'), wait_ready: bool('esperar a "Tela pronta" antes (padrão false)') }) },
  { name: 'layout_bounds', description: 'As caixas de "Mostrar limites de layout": cada componente (Compose e Views) com chave, nome, limites na janela, textos, testTag, papel e ações.', inputSchema: obj({ names: bool('nomear pelos composables (padrão true)') }) },
  { name: 'compose_tree', description: 'A árvore de layout do Compose: cada nó com id, handle, pai, nome, limites, modificadores e semântica (textos, testTag, ações).', inputSchema: obj({ max_nodes: num('máximo de nós (padrão 600)'), locals: { type: 'array', items: { type: 'string' }, description: 'CompositionLocals a anexar a cada nó (nome ou parte): node.locals.LocalX é o valor naquele composable' } }) },
  { name: 'composition_locals', description: 'Os CompositionLocals de um componente do Compose (o que LocalX.current vale ali). handle vem de compose_tree.', inputSchema: obj({ handle: str('handle do nó (compose_tree)'), only: { type: 'array', items: { type: 'string' }, description: 'nomes ou partes de nomes' } }, ['handle']) },
  { name: 'find_composition_local', description: 'Onde um CompositionLocal é fornecido na tela, agrupado por valor, com um componente que vê cada valor.', inputSchema: obj({ match: str('nome do Local, parte dele ou a classe do valor') }, ['match']) },
  { name: 'view_models', description: 'Os ViewModels da tela (Activity, fragments, destinos de navegação) com handle e classe.', inputSchema: obj() },
  { name: 'inspect', description: 'Os campos de um objeto da VM em JSON (somente leitura).', inputSchema: obj({ handle: str('handle'), depth: num('profundidade (padrão 2)') }, ['handle']) },
  { name: 'field', description: 'Um valor por caminho a partir de um objeto: "estado.value.itens.0.titulo" (um array de partes para chaves com pontos).', inputSchema: obj({ handle: str('handle'), path: { type: ['string', 'array'], items: { type: 'string' } }, depth: num('profundidade (padrão 1)') }, ['handle', 'path']) },
  { name: 'statics', description: 'Os campos estáticos de uma classe que o app já inicializou (object Kotlin, companion, singleton, contêiner de injeção).', inputSchema: obj({ class_name: str('nome da classe') }, ['class_name']) },
  { name: 'static_field', description: 'Um valor por caminho a partir de um campo estático.', inputSchema: obj({ class_name: str('nome da classe'), path: { type: ['string', 'array'], items: { type: 'string' } } }, ['class_name', 'path']) },
  { name: 'classes', description: 'Classes do APK cujo nome contém o texto (ou casam com /regex/).', inputSchema: obj({ match: str('parte do nome'), initialized: bool('só as já inicializadas') }, ['match']) },
  { name: 'instances', description: 'Os objetos vivos de uma classe (subclasses incluídas), com handles.', inputSchema: obj({ class_name: str('nome da classe'), limit: num('máximo (padrão 20)') }, ['class_name']) },
  { name: 'referrers', description: 'Quem segura um objeto: campos estáticos e objetos (com o campo).', inputSchema: obj({ handle: str('handle') }, ['handle']) },
  { name: 'plugins', description: 'Os plugins da página e a saída de cada um (textos, tabelas, JSON e imagens dos blocos), estado e erros.', inputSchema: obj({ id: str('só este plugin (id ou nome)'), include_images: bool('incluir as imagens dos blocos (padrão true)') }) },
  { name: 'logcat', description: 'Linhas do Logcat do app (coletadas enquanto o MCP está conectado ou o painel Logcat aberto).', inputSchema: obj({ level: str('nível mínimo: V, D, I, W ou E'), contains: str('texto na tag ou na mensagem'), limit: num('máximo de linhas, as mais recentes (padrão 200)') }) },
  { name: 'network', description: 'O log de rede do app: método, URL, status, tempo, mock ou redirecionamento.', inputSchema: obj({ contains: str('texto na URL ou no método'), limit: num('máximo, as mais recentes (padrão 50)') }) },
  { name: 'wait_ready', description: 'Espera a "Tela pronta" (Activity e fragments carregados, nada pendente por 300 ms) e devolve a tela.', inputSchema: obj({ timeout_ms: num('tempo máximo (padrão 15000)') }) },
];

export function tokenFile() { return path.join(homedir(), '.apk-web-lab-mcp-token'); }
export function readOrCreateToken(file = tokenFile()) {
  try { const text = readFileSync(file, 'utf8').trim(); if (/^[A-Za-z0-9_-]{16,}$/.test(text)) return text; } catch { /* created below */ }
  const token = randomBytes(18).toString('base64url'); writeFileSync(file, token + '\n', { mode: 0o600 }); return token;
}

/** The bridge: an HTTP side for the page and an MCP side (handle(message) -> response or null). */
export function createBridge({ port = DEFAULT_PORT, origins = DEFAULT_ORIGINS, token, timeoutMs = 60000, log = message => process.stderr.write(`[lab-mcp] ${message}\n`) } = {}) {
  const allowed = new Set(origins), pending = new Map(); let page = null, nextId = 1, server = null;
  const cors = (origin, res, extra = {}) => { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); for (const [name, value] of Object.entries(extra)) res.setHeader(name, value); };
  const send = (res, status, body, origin) => { if (origin) cors(origin, res); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  function onRequest(req, res) {
    const origin = req.headers.origin ?? null, url = new URL(req.url, 'http://127.0.0.1');
    if (!origin || !allowed.has(origin)) { send(res, 403, { error: `origem não permitida: ${origin ?? '(nenhuma)'}; rode com --origin ${origin ?? '<origem do lab>'}` }); return; }
    if (req.method === 'OPTIONS') {
      cors(origin, res, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? 'content-type', 'Access-Control-Max-Age': '600', ...(req.headers['access-control-request-private-network'] ? { 'Access-Control-Allow-Private-Network': 'true' } : {}) });
      res.writeHead(204); res.end(); return;
    }
    const [, key, action] = url.pathname.split('/');
    if (key !== token) { send(res, 401, { error: 'token inválido: copie o token de "node lab-mcp.mjs token"' }, origin); return; }
    if (req.method === 'GET' && action === 'events') {
      cors(origin, res); res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      if (page) { page.res.write('event: replaced\ndata: {}\n\n'); page.res.end(); }
      const current = { res, origin, since: Date.now() }; page = current;
      res.write(`event: hello\ndata: ${JSON.stringify({ server: SERVER_INFO, tools: TOOLS.map(tool => tool.name) })}\n\n`);
      const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => { clearInterval(keepAlive); if (page === current) { page = null; log('página desconectada'); } });
      log(`página conectada (${origin})`); return;
    }
    if (req.method === 'POST' && action === 'result') {
      let size = 0; const chunks = [];
      req.on('data', chunk => { size += chunk.length; if (size > MAX_RESULT_BYTES) { req.destroy(); return; } chunks.push(chunk); });
      req.on('end', () => {
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { send(res, 400, { error: 'JSON inválido' }, origin); return; }
        const waiter = pending.get(body?.id); if (!waiter) { send(res, 404, { error: 'chamada desconhecida ou já expirada' }, origin); return; }
        pending.delete(body.id); clearTimeout(waiter.timer); waiter.resolve(body); send(res, 200, { ok: true }, origin);
      });
      return;
    }
    if (req.method === 'GET' && action === 'hello') { send(res, 200, { server: SERVER_INFO, connected: !!page }, origin); return; }
    send(res, 404, { error: 'não encontrado' }, origin);
  }
  /** Sends one tool call to the page; resolves with { content, isError }. */
  function callPage(name, args) {
    if (!page) return Promise.resolve({ isError: true, content: [{ type: 'text', text: 'A página do APK Web Lab não está conectada. Abra o lab no navegador, carregue o APK e em Controles › MCP clique em Conectar (token: node lab-mcp.mjs token).' }] });
    const id = nextId++, wait = name === 'wait_ready' ? Math.max(timeoutMs, Number(args?.timeout_ms ?? 15000) + 5000) : timeoutMs;
    return new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(id); resolve({ isError: true, content: [{ type: 'text', text: `A página não respondeu em ${Math.round(wait / 1000)} s (aba em segundo plano ou ocupada?).` }] }); }, wait);
      pending.set(id, { resolve: body => resolve(body.ok === false ? { isError: true, content: [{ type: 'text', text: String(body.error ?? 'falha na página') }] } : { content: Array.isArray(body.content) ? body.content : [{ type: 'text', text: JSON.stringify(body.content ?? null) }], isError: !!body.isError }), timer });
      page.res.write(`event: call\ndata: ${JSON.stringify({ id, tool: name, args: args ?? {} })}\n\n`);
    });
  }
  /** One MCP JSON-RPC message -> the response (or null for a notification). */
  async function handle(message) {
    const { id, method, params } = message ?? {}, reply = result => ({ jsonrpc: '2.0', id, result }), fail = (code, text) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message: text } });
    if (message?.jsonrpc !== '2.0' || typeof method !== 'string') return id === undefined ? null : fail(-32600, 'Invalid Request');
    if (id === undefined || id === null) return null;   // notifications (initialized, cancelled ...)
    switch (method) {
      case 'initialize': return reply({ protocolVersion: PROTOCOL_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO,
        instructions: 'Ferramentas da página do APK Web Lab aberta no navegador (um app Android rodando no navegador). Comece por lab_status; screenshot devolve imagens; compose_tree e layout_bounds dão handles e chaves para as outras ferramentas.' });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS });
      case 'tools/call': {
        const name = params?.name; if (!TOOLS.some(tool => tool.name === name)) return fail(-32602, `ferramenta desconhecida: ${name}`);
        return reply(await callPage(name, params?.arguments ?? {}));
      }
      default: return fail(-32601, `Method not found: ${method}`);
    }
  }
  return {
    handle, callPage, get connected() { return !!page; },
    listen: () => new Promise((resolve, reject) => { server = http.createServer(onRequest); server.once('error', reject); server.listen(port, '127.0.0.1', () => { log(`ouvindo a página em http://127.0.0.1:${server.address().port} (origens: ${[...allowed].join(', ')})`); resolve(server.address().port); }); }),
    close: () => new Promise(resolve => { for (const waiter of pending.values()) clearTimeout(waiter.timer); pending.clear(); page?.res.end(); if (server) server.close(() => resolve()); else resolve(); }),
  };
}

/** MCP over stdio: one JSON-RPC message per line on stdin, responses on stdout. */
export function serveStdio(bridge, { input = process.stdin, output = process.stdout } = {}) {
  let buffer = '';
  input.setEncoding('utf8');
  input.on('data', chunk => {
    buffer += chunk; let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1); if (!line) continue;
      let message; try { message = JSON.parse(line); } catch { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); continue; }
      const batch = Array.isArray(message) ? message : [message];
      for (const item of batch) bridge.handle(item).then(response => { if (response) output.write(JSON.stringify(response) + '\n'); }, error => output.write(JSON.stringify({ jsonrpc: '2.0', id: item?.id ?? null, error: { code: -32603, message: String(error?.message ?? error) } }) + '\n'));
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2), options = { port: DEFAULT_PORT, origins: [...DEFAULT_ORIGINS], token: null, timeoutMs: 60000 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'token') { console.log(readOrCreateToken()); process.exit(0); }
    else if (arg === '--port') options.port = Number(args[++i]);
    else if (arg === '--origin') options.origins.push(String(args[++i]).replace(/\/$/, ''));
    else if (arg === '--token') options.token = String(args[++i]);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(args[++i]);
    else if (arg === '--help' || arg === '-h') { console.error('node lab-mcp.mjs [token] [--port 8790] [--origin <origem do lab>]... [--token <token>] [--timeout-ms 60000]'); process.exit(0); }
  }
  options.token ??= readOrCreateToken();
  const bridge = createBridge(options);
  bridge.listen().then(() => {
    process.stderr.write(`[lab-mcp] token de pareamento em ${existsSync(tokenFile()) && !args.includes('--token') ? tokenFile() : '--token'} (node lab-mcp.mjs token)\n`);
    serveStdio(bridge);
  }, error => { process.stderr.write(`[lab-mcp] não abriu a porta ${options.port}: ${error.message}\n`); process.exit(1); });
  process.stdin.on('end', () => bridge.close().then(() => process.exit(0)));
}
