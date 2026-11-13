#!/usr/bin/env node
// MCP bridge for APK Web Lab: lets an MCP client (Claude Desktop, Claude Code ...) use the lab page that is open in your browser: screenshots of the screen or of one component,
// the output of the running plugins, the Compose tree and CompositionLocals, ViewModels and static state, Logcat and the network log, "Tela pronta".
// A web page cannot accept connections, so this small process sits between them:
//
//   MCP client  --stdio (JSON-RPC, MCP)-->  lab-mcp.mjs  <--HTTP on 127.0.0.1 (events + results)--  the lab page (Controles > MCP > Conectar)
//
//   node lab-mcp.mjs                      run by the MCP client, configured with the JSON the page shows in Controles › MCP:
//                                         { "mcpServers": { "apk-lab": { "command": "node", "args": ["/caminho/lab-mcp.mjs"], "env": { "APK_WEB_LAB_MCP_TOKEN": "<token da página>" } } } }
//   node lab-mcp.mjs serve --token <t>    the simple way: stays running and serves MCP over HTTP at http://<host>:<port>/mcp/<token> (Streamable HTTP, JSON responses), so the
//                                         client only needs that address (claude mcp add --transport http apk-lab <url>). --host 127.0.0.1 by default; --host 0.0.0.0 (or a
//                                         local IP) also accepts MCP clients from other machines of the network: the token in the address is then the only protection and the
//                                         traffic is plain HTTP, so use it on networks you trust. The page always reaches the bridge on this machine (127.0.0.1).
//   node lab-mcp.mjs token                prints the token of ~/.apk-web-lab-mcp-token (only used when neither --token nor APK_WEB_LAB_MCP_TOKEN is given)
//   options: --port 8790  --origin <lab origin> (repeatable)  --token <token>  --timeout-ms 60000
//
// Every tool call is answered by the page, with what the page shows at that moment; the bridge stores nothing. Safety: it listens on 127.0.0.1 only; the page's requests must come
// from one of the allowed origins (the public lab and a local copy by default: another site open in the same browser is refused by its Origin) and carry the pairing token. The
// token is always required: the page generates it (shown in its MCP JSON) and the client passes it in APK_WEB_LAB_MCP_TOKEN (or --token); without either, the token kept in
// ~/.apk-web-lab-mcp-token (created once, readable only by you) is used, as before. Tokens are compared in constant time and never logged. Node.js built-ins only. Protocol logs
// go to stderr; stdout carries MCP messages only.
import http from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { networkInterfaces } from 'node:os';
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
  { name: 'click_plugin_button', description: 'Clica num botão de um plugin (lab.button), como o usuário: o código do plugin roda e a resposta vem quando terminou (ok, tempo, erros novos). plugins lista os botões de cada plugin.',
    inputSchema: obj({ plugin: str('id ou nome do plugin'), button: str('id do botão (ou o texto dele)'), wait_ms: num('esperar o código terminar até (padrão 10000)') }, ['plugin', 'button']) },
  { name: 'logcat', description: 'Linhas do Logcat do app (coletadas enquanto o MCP está conectado). Para acompanhar: passe since = o "next" da resposta anterior (só linhas novas) e wait_ms para esperar até elas chegarem.',
    inputSchema: obj({ level: str('nível mínimo: V, D, I, W ou E'), contains: str('texto na tag ou na mensagem'), limit: num('máximo de linhas, as mais recentes (padrão 200)'), since: num('só o que veio depois deste cursor (o "next" da resposta anterior)'), start: str('"now": não devolve nada, só o cursor para acompanhar a partir de agora'), from_time: str('a partir deste momento (ISO 8601 ou milissegundos), relógio do aparelho'), last_seconds: num('só os últimos N segundos'), wait_ms: num('esperar até N ms por algo novo (máx. 30000)') }) },
  { name: 'network', description: 'O log de rede do app: método, URL, status, tempo, mock ou redirecionamento; com include_body, o corpo da resposta (texto). Para acompanhar: since e wait_ms, como no logcat.',
    inputSchema: obj({ contains: str('texto na URL ou no método'), limit: num('máximo, as mais recentes (padrão 50)'), since: num('só o que veio depois deste cursor (o "next" da resposta anterior)'), start: str('"now": não devolve nada, só o cursor para acompanhar a partir de agora'), from_time: str('a partir deste momento (ISO 8601 ou milissegundos), relógio do aparelho'), last_seconds: num('só os últimos N segundos'), wait_ms: num('esperar até N ms por algo novo (máx. 30000)'), include_body: bool('incluir o corpo da resposta (texto, até 20 KB) e os cabeçalhos') }) },
  { name: 'set_mock', description: 'Cria ou troca (mesmo id) um mock de endpoint: as requisições do app que casarem com método e URL recebem esta resposta sem ir à rede. Fica em Controles › Mock de endpoints do pacote aberto. Depois, use reload para o app buscar de novo.',
    inputSchema: obj({ url: str('URL ou padrão (https://api.exemplo.com/v1/perfil, *.exemplo.com/v1/*)'), method: str('GET, POST, ... ou ANY (padrão)'), status: num('status HTTP (padrão 200)'), body: { description: 'corpo da resposta: texto, ou um objeto (vira JSON)' }, headers: { type: 'object', description: 'cabeçalhos da resposta, { "Content-Type": "application/json" }' }, delay_ms: num('atraso da resposta'), id: str('id para trocar o mesmo mock depois'), name: str('nome que aparece na lista'), query: str('"ignore" (padrão) ou "exact"') }, ['url']) },
  { name: 'remove_mock', description: 'Remove um mock pelo id (de set_mock ou list_mocks).', inputSchema: obj({ id: str('id do mock') }, ['id']) },
  { name: 'list_mocks', description: 'Os mocks do pacote aberto, com quantas vezes cada um respondeu.', inputSchema: obj() },
  { name: 'tap', description: 'Toca num componente (testTag, texto ou chave de layout_bounds) ou num ponto (x, y da janela): em Compose é um toque real, numa View é o clique. Espera a tela assentar e devolve a tela (e o print, se pedido).',
    inputSchema: obj({ test_tag: str('testTag do componente'), text: str('texto visível do componente (o primeiro que contém)'), element_key: str('chave de layout_bounds'), x: num('x na janela'), y: num('y na janela'), wait_ms: num('esperar a tela assentar depois (padrão 2000)'), screenshot: bool('devolver o print da tela depois') }) },
  { name: 'type', description: 'Escreve num campo de texto (troca o texto inteiro): em Compose, foca o campo, seleciona tudo e digita caractere por caractere pelo InputConnection, como o teclado do Android (máscaras e filtros do app agem como no aparelho; sem InputConnection, SetText e o resultado diz isso); numa View, o campo.',
    inputSchema: obj({ value: str('o texto'), test_tag: str('testTag do componente'), text: str('texto visível do componente (o primeiro que contém)'), element_key: str('chave de layout_bounds'), wait_ms: num('esperar a tela assentar depois (padrão 2000)'), screenshot: bool('devolver o print da tela depois') }, ['value']) },
  { name: 'scroll', description: 'Rola a lista que contém o componente (ou a maior lista da tela, sem alvo): dy positivo desce, dx positivo vai para a direita.',
    inputSchema: obj({ dy: num('quanto rolar na vertical, em px (padrão 400)'), dx: num('na horizontal'), test_tag: str('testTag do componente'), text: str('texto visível do componente (o primeiro que contém)'), element_key: str('chave de layout_bounds'), x: num('x de um ponto dentro da lista'), y: num('y'), wait_ms: num('esperar a tela assentar depois (padrão 2000)'), screenshot: bool('devolver o print da tela depois') }) },
  { name: 'scroll_to', description: 'Rola uma lista (ou outro componente rolável) até uma posição em px (1 px = 1 dp no lab) ou até uma porcentagem (0 a 100) do curso da rolagem, na vertical e/ou na horizontal, pela rolagem do próprio app (ScrollBy do Compose, View.scrollBy), repetindo até chegar. Sem alvo, a maior lista da tela. Devolve a posição, o curso (maxX/maxY) e a porcentagem em que parou; numa lista preguiçosa os números são a estimativa da própria lista (estimated: true).',
    inputSchema: obj({ to_y: num('posição vertical em px, a partir do início'), to_x: num('posição horizontal em px'), percent_y: num('porcentagem vertical do curso, 0 a 100'), percent_x: num('porcentagem horizontal, 0 a 100'), test_tag: str('testTag do componente rolável ou de algo dentro dele'), text: str('texto visível do componente (o primeiro que contém)'), element_key: str('chave de layout_bounds'), x: num('x de um ponto dentro da lista'), y: num('y'), wait_ms: num('esperar a tela assentar depois (padrão 2000)'), screenshot: bool('devolver o print da tela depois') }) },
  { name: 'scroll_info', description: 'Onde uma lista (ou outro componente rolável) está, sem mover: posição x/y e curso maxX/maxY em px, e a porcentagem. Mesmo alvo de scroll_to.',
    inputSchema: obj({ test_tag: str('testTag do componente rolável ou de algo dentro dele'), text: str('texto visível do componente'), element_key: str('chave de layout_bounds'), x: num('x de um ponto dentro da lista'), y: num('y') }) },
  { name: 'back', description: 'Volta para a tela anterior (o botão Voltar do aparelho).', inputSchema: obj({ wait_ms: num('esperar a tela assentar depois (padrão 2000)'), screenshot: bool('devolver o print da tela depois') }) },
  { name: 'reload', description: 'Recarrega a tela atual: recreate (padrão, mantém estado salvo e ViewModels) ou reopen (instância nova com o mesmo Intent).', inputSchema: obj({ mode: str('"recreate" ou "reopen"') }) },
  { name: 'wait_ready', description: 'Espera a "Tela pronta" (Activity e fragments carregados, nada pendente por 300 ms) e devolve a tela.', inputSchema: obj({ timeout_ms: num('tempo máximo (padrão 15000)') }) },
];

export const TOKEN_ENV = 'APK_WEB_LAB_MCP_TOKEN';
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;
/** Constant-time token check (both sides hashed first, so lengths do not leak either). */
export function tokenMatches(given, expected) {
  const digest = value => createHash('sha256').update(String(value ?? '')).digest();
  return typeof given === 'string' && typeof expected === 'string' && expected.length > 0 && timingSafeEqual(digest(given), digest(expected));
}
/** Which token the bridge uses: --token, then APK_WEB_LAB_MCP_TOKEN, then ~/.apk-web-lab-mcp-token. -> { token, source } or { error } (never contains the token). */
export function resolveToken({ argToken = null, env = {}, file = tokenFile(), readFile = readOrCreateToken } = {}) {
  const pick = (value, source) => TOKEN_PATTERN.test(value) ? { token: value, source } : { error: `token inválido em ${source}: use o token que a página mostra em Controles › MCP (16 ou mais letras, números, _ ou -)` };
  if (argToken != null) return pick(String(argToken).trim(), '--token');
  const fromEnv = env[TOKEN_ENV]; if (fromEnv != null && String(fromEnv).trim() !== '') return pick(String(fromEnv).trim(), TOKEN_ENV);
  return { token: readFile(file), source: file };
}

export function tokenFile() { return path.join(homedir(), '.apk-web-lab-mcp-token'); }
export function readOrCreateToken(file = tokenFile()) {
  try { const text = readFileSync(file, 'utf8').trim(); if (/^[A-Za-z0-9_-]{16,}$/.test(text)) return text; } catch { /* created below */ }
  const token = randomBytes(18).toString('base64url'); writeFileSync(file, token + '\n', { mode: 0o600 }); return token;
}

/** The bridge: an HTTP side for the page and an MCP side (handle(message) -> response or null). */
export function createBridge({ port = DEFAULT_PORT, host = '127.0.0.1', origins = DEFAULT_ORIGINS, token, timeoutMs = 60000, log = message => process.stderr.write(`[lab-mcp] ${message}\n`) } = {}) {
  if (!TOKEN_PATTERN.test(String(token ?? ''))) throw new Error('lab-mcp: a ponte precisa de um token (16 ou mais letras, números, _ ou -)');
  const allowed = new Set(origins), pending = new Map(); let page = null, nextId = 1, server = null, refused = null, refusedLogged = 0;
  const cors = (origin, res, extra = {}) => { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); for (const [name, value] of Object.entries(extra)) res.setHeader(name, value); };
  const send = (res, status, body, origin) => { if (origin) cors(origin, res); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  /** MCP over HTTP (Streamable HTTP, JSON responses only): POST /mcp/<token> with one JSON-RPC message or a batch. A browser page of another site is refused by its Origin;
   *  clients that are not browsers send none, and the token in the address (or Authorization: Bearer) is what admits them. */
  function onMcp(req, res, url, origin) {
    const plain = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(body === null ? '' : JSON.stringify(body)); };
    if (origin && !allowed.has(origin)) { plain(403, { error: `origem não permitida: ${origin}` }); return; }
    if (origin) cors(origin, res);
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? 'content-type, authorization, mcp-protocol-version' }); res.end(); return; }
    let given = ''; try { given = decodeURIComponent(url.pathname.split('/')[2] ?? ''); } catch { /* refused below */ }
    if (!given) given = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '';
    // 403, never 401: to an MCP client a 401 means "log in with OAuth" (MCP authorization), and clients such as Cursor then start an OAuth flow this bridge does not have and
    // wait there. The token is in the address: a wrong or missing one is simply refused, with the reason.
    if (!tokenMatches(given, token)) { plain(403, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'token recusado: use o endereço que a ponte mostrou ao iniciar (…/mcp/<token>), com o token da página (Controles › MCP)' } }); return; }
    if (req.method !== 'POST') { plain(405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method Not Allowed: esta ponte responde a POST (sem fluxo iniciado pelo servidor)' } }, { allow: 'POST' }); return; }
    let size = 0; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) { req.destroy(); return; } chunks.push(chunk); });
    req.on('end', async () => {
      let message; try { message = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { plain(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
      const one = async item => { try { return await handle(item); } catch (error) { return { jsonrpc: '2.0', id: item?.id ?? null, error: { code: -32603, message: String(error?.message ?? error) } }; } };
      if (Array.isArray(message)) { const answers = (await Promise.all(message.map(one))).filter(Boolean); if (answers.length) plain(200, answers); else plain(202, null); return; }
      const answer = await one(message); if (answer) plain(200, answer); else plain(202, null);   // a notification or a response from the client: accepted, nothing to say
    });
  }
  function onRequest(req, res) {
    const origin = req.headers.origin ?? null, url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) { onMcp(req, res, url, origin); return; }
    // OAuth discovery (RFC 9728 protected-resource and RFC 8414 server metadata, which MCP clients look up): none here, said plainly, so a client goes on without OAuth
    if (url.pathname.startsWith('/.well-known/')) { res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify({ error: 'esta ponte não usa OAuth: o token vai no endereço (…/mcp/<token>)' })); return; }
    if (!origin || !allowed.has(origin)) { send(res, 403, { error: `origem não permitida: ${origin ?? '(nenhuma)'}; rode com --origin ${origin ?? '<origem do lab>'}` }); return; }
    if (req.method === 'OPTIONS') {
      cors(origin, res, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? 'content-type', 'Access-Control-Max-Age': '600', ...(req.headers['access-control-request-private-network'] ? { 'Access-Control-Allow-Private-Network': 'true' } : {}) });
      res.writeHead(204); res.end(); return;
    }
    const [, key, action] = url.pathname.split('/');
    let given = ''; try { given = decodeURIComponent(key ?? ''); } catch { /* malformed: refused below */ }
    if (!tokenMatches(given, token)) {
      refused = { at: Date.now(), origin };
      if (Date.now() - refusedLogged > 5000) { refusedLogged = Date.now(); log(`página recusada (${origin}): o token dela é diferente do desta ponte. Pare a ponte e rode de novo o comando de Controles › MCP (ou copie de novo a configuração, se o cliente MCP inicia a ponte).`); }
      send(res, 401, { error: 'token recusado: o token desta página é diferente do configurado na ponte. Pare a ponte e rode de novo o comando de Controles › MCP (ou copie de novo a configuração, se o cliente MCP inicia a ponte).', code: 'bad-token' }, origin); return;
    }
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
    if (!page) {
      const mismatch = refused && Date.now() - refused.at < 10 * 60 * 1000 ? ` Uma página (${refused.origin}) tentou conectar há ${Math.round((Date.now() - refused.at) / 1000)} s com outro token e foi recusada: rode de novo o comando de Controles › MCP (o token mudou?) para a configuração do cliente MCP e reinicie o servidor MCP.` : '';
      return Promise.resolve({ isError: true, content: [{ type: 'text', text: `A página do APK Web Lab não está conectada. Abra o lab no navegador, carregue o APK e em Controles › MCP clique em Conectar.${mismatch}` }] });
    }
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
    listen: () => new Promise((resolve, reject) => { server = http.createServer(onRequest); server.once('error', reject); server.listen(port, host, () => { log(`ouvindo a página em http://127.0.0.1:${server.address().port} (origens: ${[...allowed].join(', ')})`); resolve(server.address().port); }); }),
    close: () => new Promise(resolve => { for (const waiter of pending.values()) clearTimeout(waiter.timer); pending.clear(); page?.res.end(); if (server) server.close(() => resolve()); else resolve(); }),
  };
}

/** The addresses an MCP client can use for a bridge bound to `host`: the loopback one, and for 0.0.0.0 every local IPv4 of this machine. */
export function mcpAddresses(host, port, token, interfaces = networkInterfaces()) {
  const hosts = host === '0.0.0.0' ? ['127.0.0.1', ...Object.values(interfaces).flat().filter(entry => entry && entry.family === 'IPv4' && !entry.internal).map(entry => entry.address)] : [host];
  return [...new Set(hosts)].map(name => `http://${name}:${port}/mcp/${encodeURIComponent(token)}`);
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
  const args = process.argv.slice(2), options = { port: DEFAULT_PORT, host: '127.0.0.1', serve: false, origins: [...DEFAULT_ORIGINS], token: null, timeoutMs: 60000 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'token') { console.log(readOrCreateToken()); process.exit(0); }
    else if (arg === 'serve') options.serve = true;
    else if (arg === '--host') options.host = String(args[++i]);
    else if (arg === '--port') options.port = Number(args[++i]);
    else if (arg === '--origin') options.origins.push(String(args[++i]).replace(/\/$/, ''));
    else if (arg === '--token') options.token = String(args[++i]);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(args[++i]);
    else if (arg === '--help' || arg === '-h') { console.error('node lab-mcp.mjs [serve] [token] [--host 127.0.0.1] [--port 8790] [--origin <origem do lab>]... [--token <token>] [--timeout-ms 60000]  (ou o token em APK_WEB_LAB_MCP_TOKEN, como no JSON de Controles › MCP)'); process.exit(0); }
  }
  const chosen = resolveToken({ argToken: options.token, env: process.env });
  if (chosen.error) { process.stderr.write(`[lab-mcp] ${chosen.error}\n`); process.exit(1); }
  options.token = chosen.token;
  const bridge = createBridge(options);
  process.stderr.write(`[lab-mcp] token de pareamento: ${chosen.source}${chosen.source === tokenFile() ? ' (node lab-mcp.mjs token; cole em Controles › MCP › Token)' : ''}\n`);
  bridge.listen().then(port => {
    if (!options.serve) { serveStdio(bridge); return; }
    for (const address of mcpAddresses(options.host, port, options.token)) process.stderr.write(`[lab-mcp] MCP: ${address}\n`);
    process.stderr.write('[lab-mcp] no agente: claude mcp add --transport http apk-lab <um dos endereços acima>   ·   na página: Controles › MCP › Conectar   ·   Ctrl+C encerra\n');
  }, error => { process.stderr.write(`[lab-mcp] não abriu a porta ${options.port}: ${error.message}\n`); process.exit(1); });
  if (!options.serve) process.stdin.on('end', () => bridge.close().then(() => process.exit(0)));
  else for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => bridge.close().then(() => process.exit(0)));
}
