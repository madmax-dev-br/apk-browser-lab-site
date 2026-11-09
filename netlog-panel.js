// The "Rede" panel of the lab page: the app's network requests (src/netlog.js batches from the Worker) as a table coloured by outcome, with a text filter, an outcome filter, a detail
// view per row (full URL, headers, timing, failure), "Permitir <host>" for a request the allowlist refused, "Limpar" and "Salvar" (HAR 1.2 or plain text, bodies omitted).
// The formatting, filter and export functions are pure (tested without a DOM); createNetlogPanel() wires them to the page. Nothing here is persisted: the entries live in memory.
import { MAX_ENTRIES } from './netlog.js?v=7ad88626efdb';
import { sanitizeHosts } from './device-settings.js?v=7ad88626efdb';

export const RENDER_MAX = 500;   // rows kept in the DOM; "Salvar" still writes the whole buffer
export const CATEGORIES = ['pending', 'ok', 'redirect', 'fail', 'refused', 'error', 'loopback'];
export const CATEGORY_NAMES = { pending: 'Em andamento', ok: '2xx', redirect: '3xx', fail: '4xx / 5xx', refused: 'Recusadas', error: 'Erros', loopback: 'Loopback' };
const REFUSED = new Set(['refused-by-allowlist', 'offline']);

/** The colour class of an entry: pending | ok (1xx/2xx) | redirect (3xx) | fail (4xx/5xx) | refused (allowlist or offline) | error (every other failure). */
export function categoryOf(entry) {
  if (entry.kind === 'loopback' && entry.outcome === 'connected') return 'loopback';   // the device's own interface: never a refusal
  if (REFUSED.has(entry.outcome)) return 'refused';
  if (entry.outcome === 'pending') return 'pending';
  if (entry.status !== null && entry.status !== undefined && entry.outcome === 'response') return entry.status >= 400 ? 'fail' : entry.status >= 300 ? 'redirect' : 'ok';
  return 'error';
}

/** The entry passes when its category is `category` (or 'all') and `text` (case-insensitive) is part of its method, host, path or status. */
export function matchesFilter(entry, { text = '', category = 'all' } = {}) {
  if (category === 'mocked') { if (!entry.mockId) return false; }   // "Mockadas": answered by a "Mock de endpoints" entry
  else if (category === 'redirected') { if (!entry.mappedUrl) return false; }   // "Redirecionadas": sent elsewhere by a "Redirecionar hosts" rule
  else if (category !== 'all' && categoryOf(entry) !== category) return false;
  const needle = String(text).trim().toLowerCase(); if (!needle) return true;
  return `${entry.method} ${entry.host}${entry.path} ${entry.status ?? ''} ${entry.outcome}${entry.mockId ? ` mock ${entry.mockLabel ?? ''}` : ''}${entry.mappedUrl ? ` redirecionada ${entry.mappedUrl}` : ''}`.toLowerCase().includes(needle) || entry.url.toLowerCase().includes(needle);
}

const pad = (value, width = 2) => String(value).padStart(width, '0');
export function formatTime(wall) { const d = new Date(wall); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`; }
export function formatSize(bytes) { const n = Number(bytes) || 0; return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`; }
export function formatDuration(ms) { return ms === null || ms === undefined ? '…' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`; }

/** Short text for the status column. */
export function statusLabel(entry) {
  switch (entry.outcome) {
    case 'pending': return 'em andamento';
    case 'response': return `${entry.status}${entry.reason ? ` ${entry.reason}` : ''}`;
    case 'refused-by-allowlist': return 'recusado: host fora da lista';
    case 'offline': return 'offline';
    case 'unknown-host': return 'host desconhecido';
    case 'timeout': return 'timeout';
    case 'aborted': return 'abortado';
    case 'unsupported': return 'não suportado';
    case 'connected': return 'loopback: conectado';
    default: return entry.status !== null && entry.status !== undefined ? `${entry.status} · erro na leitura` : 'erro';
  }
}

/** The explanation the detail view gives for how the entry ended (null for a plain response). */
export function describeOutcome(entry) {
  const failure = entry.failure?.message ? ` ${entry.failure.message}` : '';
  switch (entry.outcome) {
    case 'refused-by-allowlist': return `Recusada pela lista de hosts permitidos: ${entry.refusedHost || entry.host} não está em "Hosts permitidos na rede" (painel Dispositivo). O app viu uma falha de rede (UnknownHostException ou ConnectException); nada saiu do navegador.`;
    case 'offline': return 'Recusada porque o dispositivo virtual está offline (painel Dispositivo, Rede). O app viu a rede indisponível; nada saiu do navegador.';
    case 'unknown-host': return `O nome do host não pôde ser resolvido.${failure}`;
    case 'timeout': return `A requisição estourou o tempo limite do app.${failure}`;
    case 'aborted': return `A requisição foi interrompida antes de terminar (conexão fechada pelo app ou rede desligada).${failure}`;
    case 'unsupported': return `Operação sem suporte no navegador.${failure}`;
    case 'connected': return 'Conexão ao loopback do próprio dispositivo (127.0.0.1 / ::1): fica dentro da VM, não depende da rede nem da lista de hosts permitidos.';
    case 'error': return `Falhou${entry.status !== null ? ` depois de receber ${entry.status}` : ''}.${failure}${/CORS/.test(entry.failure?.message ?? '') && !entry.mappedUrl ? ' O navegador não distingue CORS, host inacessível e bloqueio; o console do navegador diz qual foi.' : ''}`;
    case 'pending': return 'Aguardando a resposta.';
    default: return entry.closedEarly ? 'O app fechou a resposta antes de ler o corpo inteiro.' : null;
  }
}

/** One table row's text, `HH:MM:SS.mmm METHOD host/path -> status  size  duration`. */
export const formatEntry = entry => `${formatTime(entry.wall)} ${entry.method} ${entry.host}${entry.path} -> ${statusLabel(entry)}${entry.mockId ? ' [MOCK]' : ''}${entry.mappedUrl ? ' [REDIRECIONADA]' : ''}  ${formatSize(entry.responseBytes)}  ${formatDuration(entry.durationMs)}`;
/** The note of an entry a "Redirecionar hosts" rule sent elsewhere. */
export const redirectNote = entry => `Redirecionada pelo lab (Redirecionar hosts, painel Controles): o app pediu ${entry.url}; a requisição foi para ${entry.mappedUrl} pela regra "${entry.mappedRule}". O app vê a URL original.`;
const FAILED = new Set(['error', 'unknown-host', 'timeout', 'unsupported']);
/** For a redirected entry that failed before any response: what usually causes it, in Portuguese (null otherwise). */
export function redirectFailureHint(entry) {
  if (!entry.mappedUrl || !FAILED.has(entry.outcome) || entry.status !== null && entry.status !== undefined) return null;
  const message = entry.failure?.message ?? '';
  let target; try { target = new URL(entry.mappedUrl); } catch { target = null; }
  const local = target && /^(localhost|.*\.localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(target.hostname);
  if (/CORS relay refused|--allow-private/.test(message)) return `O relay CORS recusou ${target?.host ?? entry.mappedUrl}: ele não alcança este computador nem a rede local sem a opção --allow-private (node scripts/cors-relay.mjs --allow-private), ou tire o Proxy para o navegador ir direto ao destino.`;
  const parts = [`O destino ${entry.mappedUrl} não respondeu ao navegador.`];
  if (local) parts.push(`Confira se o servidor local está rodando em ${target.host} e se fala ${target.protocol === 'https:' ? 'HTTPS' : 'HTTP simples'}.`, 'Sem o Proxy, o navegador busca o destino direto: o servidor precisa responder CORS (Access-Control-Allow-Origin com a origem do lab, e as respostas ao preflight OPTIONS) e o navegador pode pedir permissão de acesso à rede local.');
  else parts.push('Sem o Proxy, o destino precisa responder CORS (Access-Control-Allow-Origin) para a página do lab; o console do navegador diz se foi CORS, host inacessível ou bloqueio.');
  return parts.join(' ');
}
/** The note of an entry a mock answered. */
export const mockNote = entry => `Respondida pelo lab: mock "${entry.mockLabel}" (Mock de endpoints, painel Controles); a requisição não foi à rede.`;

const stamp = date => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
/** netlog-<package>-<timestamp>.har (or .txt) */
export const exportFileName = (packageName, date = new Date(), extension = 'har') => `netlog-${String(packageName || 'app').replace(/[^A-Za-z0-9._-]+/g, '_')}-${stamp(date)}.${extension}`;

/** The text "Salvar" writes in text mode: a line per request, then its headers and the failure detail. Bodies are never included. */
export function buildText(entries, { dropped = 0 } = {}) {
  const lines = []; if (dropped > 0) lines.push(`--------- ${dropped} requisições anteriores descartadas (buffer cheio) ---------`);
  for (const entry of entries) {
    lines.push(`#${entry.seq} ${formatEntry(entry)}  [${entry.api}, thread ${entry.thread}]`, `    ${entry.url}`);
    if (entry.mappedUrl) { lines.push(`    ${redirectNote(entry)}`); const hint = redirectFailureHint(entry); if (hint) lines.push(`    ${hint}`); }
    if (entry.mockId) lines.push(`    ${mockNote(entry)}`);
    if (entry.finalUrl) lines.push(`    o servidor redirecionou (3xx) para ${entry.finalUrl}`);
    const note = describeOutcome(entry); if (note) lines.push(`    ${note}`);
    for (const [name, value] of entry.requestHeaders) lines.push(`    > ${name}: ${value}`);
    if (entry.requestBytes) lines.push(`    > corpo: ${entry.requestBytes} bytes`);
    for (const [name, value] of entry.responseHeaders) lines.push(`    < ${name}: ${value}`);
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}

const harHeaders = headers => headers.map(([name, value]) => ({ name, value }));
const queryOf = url => { try { return [...new URL(url).searchParams].map(([name, value]) => ({ name, value })); } catch { return []; } };
/** HAR 1.2 (http://www.softwareishard.com/blog/har-12-spec/) of the entries: no bodies (content.size and bodySize carry the byte counts). Failures are status 0 with the details in `_` fields. */
export function buildHar(entries, { dropped = 0, creator = { name: 'APK Web Lab', version: '1' }, packageName = '' } = {}) {
  return { log: {
    version: '1.2', creator, comment: `${packageName ? `${packageName}; ` : ''}bodies omitted${dropped ? `; ${dropped} earlier requests discarded` : ''}`,
    entries: entries.map(entry => {
      const location = entry.responseHeaders.find(([name]) => name.toLowerCase() === 'location')?.[1] ?? '', time = entry.durationMs ?? -1;
      return {
        startedDateTime: new Date(entry.wall).toISOString(), time,
        request: { method: entry.method, url: entry.url, ...(entry.mappedUrl ? { _mappedUrl: entry.mappedUrl, _mappedRule: entry.mappedRule } : {}), httpVersion: 'HTTP/1.1', cookies: [], headers: harHeaders(entry.requestHeaders), queryString: queryOf(entry.url), headersSize: -1, bodySize: entry.requestBytes },
        response: { status: entry.status ?? 0, statusText: entry.status === null ? '' : entry.reason, httpVersion: 'HTTP/1.1', cookies: [], headers: harHeaders(entry.responseHeaders),
          content: { size: entry.responseBytes, mimeType: (entry.contentType ?? '').split(';')[0].trim() || 'x-unknown' }, redirectURL: location, headersSize: -1, bodySize: entry.responseBytes },
        cache: {}, timings: { send: 0, wait: Math.max(time, 0), receive: 0 },
        ...(entry.mockId ? { _mock: { id: entry.mockId, label: entry.mockLabel }, comment: mockNote(entry) } : {}),
        ...(entry.mappedUrl ? { _redirect: { from: entry.url, to: entry.mappedUrl, rule: entry.mappedRule }, comment: [redirectNote(entry), redirectFailureHint(entry)].filter(Boolean).join(' ') } : {}),
        _seq: entry.seq, _api: entry.api, _thread: entry.thread, _outcome: entry.outcome, _failure: entry.failure?.message ?? null, _refusedHost: entry.refusedHost, _finalUrl: entry.finalUrl, _uptimeMs: entry.uptime,
      };
    }),
  } };
}

/** A host list as typed in the Dispositivo field ("a.com, *.b.com") + one more host -> the new text (validated, de-duplicated like the field itself). */
export function addAllowedHost(current, host) { return sanitizeHosts([...sanitizeHosts(current), String(host).trim().toLowerCase()]).join(', '); }
/** Is `host` already covered by the list (exact, "*.suffix" or "*"; ports are ignored)? */
export function hostIsAllowed(list, host) {
  const lower = String(host).toLowerCase();
  return (list ?? []).some(raw => { const entry = String(raw).toLowerCase().replace(/:\d+$/, ''); return entry === '*' || entry === lower || (entry.startsWith('*.') && lower.endsWith(entry.slice(1)) && lower.length > entry.length - 1); });
}

/** Page-side store: applies the Worker's batches (reset, new and changed rows), bounded like the Worker's buffer. */
export function createNetlogStore({ maxEntries = MAX_ENTRIES } = {}) {
  let entries = [], lost = 0, trimmed = 0, lastTotal = 0;
  const find = seq => { let lo = 0, hi = entries.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1, s = entries[mid].seq; if (s === seq) return mid; if (s < seq) lo = mid + 1; else hi = mid - 1; } return -1; };
  return {
    apply(message) {
      if (message.reset) { entries = []; lost = 0; trimmed = 0; lastTotal = 0; }
      let added = 0;
      for (const row of message.rows ?? []) {
        if (!entries.length || row.seq > entries.at(-1).seq) { entries.push(row); added++; } else { const at = find(row.seq); if (at >= 0) entries[at] = row; }   // an update of an entry already trimmed is ignored
      }
      if (entries.length > maxEntries) { trimmed += entries.length - maxEntries; entries = entries.slice(entries.length - maxEntries); }
      if (message.total !== undefined) { lost += Math.max(0, message.total - lastTotal - added); lastTotal = message.total; }
      return message.rows ?? [];
    },
    clear() { entries = []; lost = 0; trimmed = 0; },
    get entries() { return entries; },
    get dropped() { return lost + trimmed; },
  };
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** root: the <details id="netlog"> element (see index.html). allowHost(host) puts the host in the Dispositivo field. Returns { push(message), reset(), store }. */
export function createNetlogPanel({ root, getPackage = () => 'app', getAllowedHosts = () => [], allowHost = () => {}, save = download } = {}) {
  const q = selector => root.querySelector(selector), out = q('.netlog-rows'), count = q('.netlog-count'), filterInput = q('.netlog-filter'), categorySelect = q('.netlog-category'), scopeSelect = q('.netlog-scope'), formatSelect = q('.netlog-format'), auto = q('.netlog-autoscroll');
  const store = createNetlogStore(), expanded = new Set(); let timer = null, visibleCount = 0;
  const filter = () => ({ text: filterInput.value, category: categorySelect.value });
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const headerTable = (title, headers) => {
    const block = el('div', 'netlog-block'); block.append(el('div', 'netlog-block-title', `${title} (${headers.length})`));
    for (const [name, value] of headers) block.append(el('div', 'netlog-header', `${name}: ${value}`));
    return block;
  };
  const detail = entry => {
    const box = el('div', 'netlog-detail'), note = describeOutcome(entry);
    box.append(el('div', 'netlog-url', entry.url));
    if (entry.mappedUrl) {
      const block = el('div', 'netlog-block netlog-redirect-block'); block.append(el('div', 'netlog-block-title', 'Redirecionada (Redirecionar hosts, painel Controles)'));
      for (const [label, value] of [['Original', entry.url], ['Enviada para', entry.mappedUrl], ['Regra', entry.mappedRule]]) { const line = el('div', 'netlog-header'); line.append(el('b', null, `${label}: `), document.createTextNode(value)); block.append(line); }
      block.append(el('div', 'netlog-note', 'O app vê a URL original; só a requisição do navegador foi para o destino.'));
      const hint = redirectFailureHint(entry); if (hint) block.append(el('div', 'netlog-note netlog-note-error', hint));
      box.append(block);
    }
    if (entry.mockId) box.append(el('div', 'netlog-note netlog-note-mock', mockNote(entry)));
    if (entry.finalUrl) box.append(el('div', 'netlog-note', `O servidor redirecionou (3xx) e o transporte seguiu para ${entry.finalUrl}`));
    if (note) box.append(el('div', `netlog-note netlog-note-${categoryOf(entry)}`, note));
    if (entry.outcome === 'refused-by-allowlist' && entry.refusedHost) {
      const allowed = hostIsAllowed(getAllowedHosts(), entry.refusedHost);
      if (allowed) box.append(el('div', 'netlog-note', `${entry.refusedHost} já está na lista; o app precisa tentar de novo.`));
      else { const button = el('button', 'netlog-allow', `Permitir ${entry.refusedHost}`); button.type = 'button'; button.addEventListener('click', event => { event.stopPropagation(); allowHost(entry.refusedHost); renderAll(); }); box.append(button); }
    }
    box.append(el('div', 'netlog-timing', `Início ${formatTime(entry.wall)} (uptime ${entry.uptime} ms) · duração ${formatDuration(entry.durationMs)} · thread ${entry.thread} (${entry.tid}) · ${entry.api} · requisição ${formatSize(entry.requestBytes)} · resposta ${formatSize(entry.responseBytes)}${entry.contentType ? ` · ${entry.contentType}` : ''}`));
    box.append(headerTable('Cabeçalhos da requisição', entry.requestHeaders), headerTable('Cabeçalhos da resposta', entry.responseHeaders));
    return box;
  };
  const row = entry => {
    const wrap = el('div', `netlog-entry cat-${categoryOf(entry)}${entry.mockId ? ' is-mocked' : ''}${entry.mappedUrl ? ' is-redirected' : ''}`), line = el('div', 'netlog-line');
    const target = el('span', 'netlog-target', `${entry.host}${entry.path}`); if (entry.mockId) target.prepend(el('b', 'netlog-mock', 'MOCK'));
    if (entry.mappedUrl) { const badge = el('b', 'netlog-redirected', 'REDIRECIONADA'); badge.title = `Enviada para ${entry.mappedUrl}`; target.prepend(badge); }
    line.append(el('span', 'netlog-time', formatTime(entry.wall)), el('span', 'netlog-method', entry.method), target, el('span', 'netlog-status', statusLabel(entry)), el('span', 'netlog-size', formatSize(entry.responseBytes)), el('span', 'netlog-duration', formatDuration(entry.durationMs)));
    line.title = entry.mappedUrl ? `${entry.url}\n→ ${entry.mappedUrl}` : entry.url; line.tabIndex = 0; line.setAttribute('role', 'button'); line.setAttribute('aria-expanded', String(expanded.has(entry.seq)));
    const toggle = () => { if (expanded.has(entry.seq)) expanded.delete(entry.seq); else expanded.add(entry.seq); renderAll(); };
    line.addEventListener('click', toggle); line.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } });
    wrap.append(line); if (expanded.has(entry.seq)) wrap.append(detail(entry));
    return wrap;
  };
  const updateCount = () => {
    const refused = store.entries.filter(entry => categoryOf(entry) === 'refused').length, mocked = store.entries.filter(entry => entry.mockId).length, redirected = store.entries.filter(entry => entry.mappedUrl).length;
    count.textContent = `${store.entries.length} requisições${refused ? ` · ${refused} recusadas` : ''}${mocked ? ` · ${mocked} mockadas` : ''}${redirected ? ` · ${redirected} ${redirected === 1 ? 'redirecionada' : 'redirecionadas'}` : ''}${visibleCount !== store.entries.length ? ` · ${visibleCount} exibidas` : ''}${store.dropped ? ` · ${store.dropped} descartadas` : ''}`;
  };
  const renderAll = () => {
    timer = null;
    const f = filter(), visible = store.entries.filter(entry => matchesFilter(entry, f)); visibleCount = visible.length;
    out.replaceChildren(...visible.slice(-RENDER_MAX).map(row));
    if (!visible.length) out.append(el('div', 'netlog-empty', store.entries.length ? 'Nenhuma requisição passa pelo filtro.' : 'As requisições de rede do app aparecerão aqui (HTTP, DNS, conexões recusadas).'));
    updateCount(); if (auto.checked) out.scrollTop = out.scrollHeight;
  };
  const schedule = () => { if (timer === null) timer = setTimeout(renderAll, 80); };
  filterInput.addEventListener('input', renderAll); categorySelect.addEventListener('change', renderAll);
  out.addEventListener('scroll', () => { auto.checked = out.scrollHeight - out.scrollTop - out.clientHeight < 24; });
  auto.addEventListener('change', () => { if (auto.checked) out.scrollTop = out.scrollHeight; });
  q('.netlog-clear').addEventListener('click', () => { store.clear(); expanded.clear(); renderAll(); });
  q('.netlog-save').addEventListener('click', () => {
    const f = filter(), entries = scopeSelect.value === 'filtered' ? store.entries.filter(entry => matchesFilter(entry, f)) : store.entries, name = getPackage();
    if (formatSelect.value === 'text') save(exportFileName(name, new Date(), 'txt'), buildText(entries, { dropped: store.dropped }), 'text/plain;charset=utf-8');
    else save(exportFileName(name, new Date(), 'har'), JSON.stringify(buildHar(entries, { dropped: store.dropped, packageName: name }), null, 2), 'application/json');
  });
  renderAll();
  return {
    store,
    push(message) { store.apply(message); if (message.reset) { expanded.clear(); renderAll(); } else schedule(); },
    reset() { store.apply({ reset: true, rows: [], dropped: 0, total: 0 }); expanded.clear(); renderAll(); },
    flushNow() { if (timer !== null) { clearTimeout(timer); renderAll(); } },
  };
}
