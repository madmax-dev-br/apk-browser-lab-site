// The "Rede" panel of the lab page: the app's network requests (src/netlog.js batches from the Worker) as a table coloured by outcome, with a text filter, an outcome filter, a detail
// view per row (full URL, headers, timing, failure), "Permitir <host>" for a request the allowlist refused, "Limpar" and "Salvar" (HAR 1.2 or plain text, bodies omitted).
// The formatting, filter and export functions are pure (tested without a DOM); createNetlogPanel() wires them to the page. Nothing here is persisted: the entries live in memory.
import { MAX_ENTRIES } from './netlog.js?v=f738ca901a5c';
import { createReadingHold } from './reading-hold.js?v=f738ca901a5c';
import { sanitizeHosts } from './device-settings.js?v=f738ca901a5c';

export const RENDER_MAX = 500;   // rows kept in the DOM; "Salvar" still writes the whole buffer
export const CATEGORIES = ['pending', 'ok', 'redirect', 'fail', 'refused', 'error', 'loopback'];
export const CATEGORY_NAMES = { pending: 'In progress', ok: '2xx', redirect: '3xx', fail: '4xx / 5xx', refused: 'Refused', error: 'Errors', loopback: 'Loopback' };
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
  else if (category === 'proxied') { if (!entry.proxiedVia) return false; }   // "Via proxy": went through Device › Proxy
  else if (category !== 'all' && categoryOf(entry) !== category) return false;
  const needle = String(text).trim().toLowerCase(); if (!needle) return true;
  return `${entry.method} ${entry.host}${entry.path} ${entry.status ?? ''} ${entry.outcome}${entry.mockId ? ` mock ${entry.mockLabel ?? ''}` : ''}${entry.mappedUrl ? ` redirected ${entry.mappedUrl}` : ''}${entry.proxiedVia ? ` proxy ${entry.proxiedVia}` : ''}`.toLowerCase().includes(needle) || entry.url.toLowerCase().includes(needle);
}

const pad = (value, width = 2) => String(value).padStart(width, '0');
export function formatTime(wall) { const d = new Date(wall); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`; }
export function formatSize(bytes) { const n = Number(bytes) || 0; return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`; }
export function formatDuration(ms) { return ms === null || ms === undefined ? '…' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`; }

/** Short text for the status column. */
export function statusLabel(entry) {
  switch (entry.outcome) {
    case 'pending': return 'in progress';
    case 'response': return `${entry.status}${entry.reason ? ` ${entry.reason}` : ''}`;
    case 'refused-by-allowlist': return 'refused: host not allowed';
    case 'offline': return 'offline';
    case 'unknown-host': return 'unknown host';
    case 'timeout': return 'timeout';
    case 'aborted': return 'aborted';
    case 'unsupported': return 'not supported';
    case 'connected': return 'loopback: connected';
    default: return entry.status !== null && entry.status !== undefined ? `${entry.status} · read error` : 'error';
  }
}

/** The explanation the detail view gives for how the entry ended (null for a plain response). */
export function describeOutcome(entry) {
  const failure = entry.failure?.message ? ` ${entry.failure.message}` : '';
  switch (entry.outcome) {
    case 'refused-by-allowlist': return `Refused by the allowed hosts list: ${entry.refusedHost || entry.host} is not in "Allowed network hosts" (Controls › Device). The app saw a network failure (UnknownHostException or ConnectException); nothing left the browser.`;
    case 'offline': return 'Refused because the virtual device is offline (Controls › Device, Network). The app saw the network as unavailable; nothing left the browser.';
    case 'unknown-host': return `The host name could not be resolved.${failure}`;
    case 'timeout': return `The request hit the app's timeout.${failure}`;
    case 'aborted': return `The request was interrupted before it finished (connection closed by the app or network turned off).${failure}`;
    case 'unsupported': return `Operation not supported in the browser.${failure}`;
    case 'connected': return 'Connection to the loopback of the device itself (127.0.0.1 / ::1): it stays inside the VM and does not depend on the network or the allowed hosts list.';
    case 'error': return `Failed${entry.status !== null ? ` after receiving ${entry.status}` : ''}.${failure}${/CORS/.test(entry.failure?.message ?? '') && !entry.mappedUrl ? ' The browser does not tell CORS, an unreachable host and blocking apart; the browser console says which one it was.' : ''}`;
    case 'pending': return 'Waiting for the response.';
    default: return entry.closedEarly ? 'The app closed the response before reading the whole body.' : null;
  }
}

/** One table row's text, `HH:MM:SS.mmm METHOD host/path -> status  size  duration`. */
export const formatEntry = entry => `${formatTime(entry.wall)} ${entry.method} ${entry.host}${entry.path} -> ${statusLabel(entry)}${entry.mockId ? ' [MOCK]' : ''}${entry.mappedUrl ? ' [REDIRECTED]' : ''}${entry.proxiedVia ? ` [PROXY ${entry.proxiedVia}]` : ''}  ${formatSize(entry.responseBytes)}  ${formatDuration(entry.durationMs)}`;
/** The note of an entry a "Redirecionar hosts" rule sent elsewhere. */
export const redirectNote = entry => `Redirected by the lab (Redirect hosts, Controls): the app asked for ${entry.url}; the request went to ${entry.mappedUrl} by the rule "${entry.mappedRule}". The app sees the original URL.`;
const FAILED = new Set(['error', 'unknown-host', 'timeout', 'unsupported']);
/** For a redirected entry that failed before any response: what usually causes it, in Portuguese (null otherwise). */
export function redirectFailureHint(entry) {
  if (!entry.mappedUrl || !FAILED.has(entry.outcome) || entry.status !== null && entry.status !== undefined) return null;
  const message = entry.failure?.message ?? '';
  let target; try { target = new URL(entry.mappedUrl); } catch { target = null; }
  const local = target && /^(localhost|.*\.localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(target.hostname);
  if (/CORS relay refused|--allow-private/.test(message)) return `The CORS relay refused ${target?.host ?? entry.mappedUrl}: it is an old version of the relay, which blocked this computer and the local network. Update the relay (the current version reaches any target), start the old one with --allow-private, or remove the Proxy so the browser goes straight to the target.`;   // only an older relay sends APKWEB_RELAY_PRIVATE
  const parts = [`The target ${entry.mappedUrl} did not answer the browser.`];
  if (local) parts.push(`Check that the local server is running on ${target.host} and that it speaks ${target.protocol === 'https:' ? 'HTTPS' : 'plain HTTP'}.`, 'Without the Proxy, the browser fetches the target directly: the server must answer CORS (Access-Control-Allow-Origin with the lab page origin, and the replies to the OPTIONS preflight) and the browser may ask for permission to access the local network.');
  else parts.push('Without the Proxy, the target must answer CORS (Access-Control-Allow-Origin) for the lab page; the browser console says whether it was CORS, an unreachable host or blocking.');
  return parts.join(' ');
}
/** The note of an entry a mock answered. */
export const mockNote = entry => `Answered by the lab: mock "${entry.mockLabel}" (Endpoint mocks, Controls); the request did not go to the network.`;

const stamp = date => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
/** netlog-<package>-<timestamp>.har (or .txt) */
export const exportFileName = (packageName, date = new Date(), extension = 'har') => `netlog-${String(packageName || 'app').replace(/[^A-Za-z0-9._-]+/g, '_')}-${stamp(date)}.${extension}`;

/** The text "Salvar" writes in text mode: a line per request, then its headers and the failure detail. Bodies are never included. */
export function buildText(entries, { dropped = 0 } = {}) {
  const lines = []; if (dropped > 0) lines.push(`--------- ${dropped} earlier requests dropped (buffer full) ---------`);
  for (const entry of entries) {
    lines.push(`#${entry.seq} ${formatEntry(entry)}  [${entry.api}, thread ${entry.thread}]`, `    ${entry.url}`);
    if (entry.mappedUrl) { lines.push(`    ${redirectNote(entry)}`); const hint = redirectFailureHint(entry); if (hint) lines.push(`    ${hint}`); }
    if (entry.mockId) lines.push(`    ${mockNote(entry)}`);
    if (entry.finalUrl) lines.push(`    the server redirected (3xx) to ${entry.finalUrl}`);
    const note = describeOutcome(entry); if (note) lines.push(`    ${note}`);
    for (const [name, value] of entry.requestHeaders) lines.push(`    > ${name}: ${value}`);
    if (entry.requestBytes) lines.push(`    > body: ${entry.requestBytes} bytes`);
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
export function createNetlogPanel({ root, getPackage = () => 'app', getAllowedHosts = () => [], allowHost = () => {}, save = download, createMock = null, redirectHost = null } = {}) {
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
      const block = el('div', 'netlog-block netlog-redirect-block'); block.append(el('div', 'netlog-block-title', 'Redirected (Redirect hosts, Controls)'));
      for (const [label, value] of [['Original', entry.url], ['Sent to', entry.mappedUrl], ['Rule', entry.mappedRule]]) { const line = el('div', 'netlog-header'); line.append(el('b', null, `${label}: `), document.createTextNode(value)); block.append(line); }
      block.append(el('div', 'netlog-note', 'The app sees the original URL; only the browser request went to the target.'));
      const hint = redirectFailureHint(entry); if (hint) block.append(el('div', 'netlog-note netlog-note-error', hint));
      box.append(block);
    }
    if (entry.mockId) box.append(el('div', 'netlog-note netlog-note-mock', mockNote(entry)));
    if (entry.proxiedVia) box.append(el('div', 'netlog-note', `Via proxy ${entry.proxiedVia} (Controls › Device › Proxy): the browser asked the proxy for the URL, and the proxy fetched ${entry.mappedUrl ?? entry.url}.`));
    if (entry.finalUrl) box.append(el('div', 'netlog-note', `The server redirected (3xx) and the transport followed to ${entry.finalUrl}`));
    if (note) box.append(el('div', `netlog-note netlog-note-${categoryOf(entry)}`, note));
    if (entry.outcome === 'refused-by-allowlist' && entry.refusedHost) {
      const allowed = hostIsAllowed(getAllowedHosts(), entry.refusedHost);
      if (allowed) box.append(el('div', 'netlog-note', `${entry.refusedHost} is already on the list; the app has to try again.`));
      else { const button = el('button', 'netlog-allow', `Allow ${entry.refusedHost}`); button.type = 'button'; button.addEventListener('click', event => { event.stopPropagation(); allowHost(entry.refusedHost); renderAll(); }); box.append(button); }
    }
    box.append(el('div', 'netlog-timing', `Start ${formatTime(entry.wall)} (uptime ${entry.uptime} ms) · duration ${formatDuration(entry.durationMs)} · thread ${entry.thread} (${entry.tid}) · ${entry.api} · request ${formatSize(entry.requestBytes)} · response ${formatSize(entry.responseBytes)}${entry.contentType ? ` · ${entry.contentType}` : ''}`));
    box.append(headerTable('Request headers', entry.requestHeaders), headerTable('Response headers', entry.responseHeaders));
    if (typeof entry.responseBody === 'string' && entry.responseBody) {
      const block = el('div', 'netlog-block'); block.append(el('div', 'netlog-block-title', `Response body${entry.responseBodyTruncated ? ' (first 48 KB)' : ''}`));
      block.append(el('pre', 'netlog-body', entry.responseBody.length > 4000 ? entry.responseBody.slice(0, 4000) + '\n…' : entry.responseBody)); box.append(block);
    }
    box.append(el('div', 'netlog-note', 'Right-click the request: create a mock of it or redirect the host.'));
    return box;
  };
  const row = entry => {
    const wrap = el('div', `netlog-entry cat-${categoryOf(entry)}${entry.mockId ? ' is-mocked' : ''}${entry.mappedUrl ? ' is-redirected' : ''}${entry.proxiedVia ? ' is-proxied' : ''}`), line = el('div', 'netlog-line');
    const target = el('span', 'netlog-target', `${entry.host}${entry.path}`); if (entry.mockId) target.prepend(el('b', 'netlog-mock', 'MOCK'));
    if (entry.proxiedVia) { const badge = el('b', 'netlog-proxied', 'PROXY'); badge.title = `Via proxy ${entry.proxiedVia}`; target.prepend(badge); }
    if (entry.mappedUrl) { const badge = el('b', 'netlog-redirected', 'REDIRECTED'); badge.title = `Sent to ${entry.mappedUrl}`; target.prepend(badge); }
    line.append(el('span', 'netlog-time', formatTime(entry.wall)), el('span', 'netlog-method', entry.method), target, el('span', 'netlog-status', statusLabel(entry)), el('span', 'netlog-size', formatSize(entry.responseBytes)), el('span', 'netlog-duration', formatDuration(entry.durationMs)));
    line.title = entry.mappedUrl ? `${entry.url}\n→ ${entry.mappedUrl}` : entry.url; line.tabIndex = 0; line.setAttribute('role', 'button'); line.setAttribute('aria-expanded', String(expanded.has(entry.seq)));
    const toggle = () => { if (expanded.has(entry.seq)) expanded.delete(entry.seq); else expanded.add(entry.seq); renderAll(); };
    line.addEventListener('click', toggle); line.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
      else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const r = line.getBoundingClientRect(); openMenu(entry, r.left + 24, r.bottom, line); }
    });
    line.addEventListener('contextmenu', event => { if (!createMock && !redirectHost) return; event.preventDefault(); openMenu(entry, event.clientX, event.clientY, line); });
    wrap.append(line); if (expanded.has(entry.seq)) wrap.append(detail(entry));
    return wrap;
  };
  // ---- the context menu of a request (right click, the Menu key or Shift+F10): create a mock of it, redirect its host, copy the URL -------------------------------
  let menu = null;
  function closeMenu(restore = true) { if (!menu) return; const { node, opener, cleanup } = menu; menu = null; node.remove(); cleanup(); if (restore && opener?.isConnected) opener.focus?.(); hold?.release(); }
  function openMenu(entry, x, y, opener) {
    closeMenu(false);
    const doc = root.ownerDocument ?? document, node = doc.createElement('div'); node.className = 'netlog-menu'; node.setAttribute('role', 'menu'); node.setAttribute('aria-label', `Actions for ${entry.method} ${entry.host}${entry.path}`);
    const items = [];
    const item = (label, run, enabled = true) => { const button = doc.createElement('button'); button.type = 'button'; button.className = 'netlog-menu-item'; button.setAttribute('role', 'menuitem'); button.textContent = label; button.disabled = !enabled; button.addEventListener('click', () => { closeMenu(false); run(); }); node.append(button); items.push(button); };
    if (createMock) item('Create a mock of this request…', () => createMock(entry));
    if (redirectHost) item(`Redirect ${entry.host}${entry.port && ![80, 443].includes(Number(entry.port)) ? ':' + entry.port : ''}…`, () => redirectHost(entry), !!entry.host);
    item('Copy URL', () => { globalThis.navigator?.clipboard?.writeText?.(entry.url)?.catch?.(() => {}); });
    doc.body.append(node);
    const width = node.offsetWidth || 240, height = node.offsetHeight || 120, view = doc.defaultView ?? globalThis;
    node.style.left = `${Math.max(4, Math.min(x, (view.innerWidth ?? 1024) - width - 4))}px`; node.style.top = `${Math.max(4, Math.min(y, (view.innerHeight ?? 768) - height - 4))}px`;
    const onDown = event => { if (!node.contains(event.target)) closeMenu(false); };
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const enabled = items.filter(button => !button.disabled), at = enabled.indexOf(doc.activeElement); enabled[(at + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length]?.focus(); }
      if (event.key === 'Tab') closeMenu(false);
    };
    const onScroll = () => closeMenu(false);
    doc.addEventListener('mousedown', onDown, true); doc.addEventListener('keydown', onKey, true); view.addEventListener?.('resize', onScroll); out.addEventListener('scroll', onScroll);
    menu = { node, opener, cleanup: () => { doc.removeEventListener('mousedown', onDown, true); doc.removeEventListener('keydown', onKey, true); view.removeEventListener?.('resize', onScroll); out.removeEventListener('scroll', onScroll); } };
    items.find(button => !button.disabled)?.focus();
  }
  const updateCount = () => {
    const refused = store.entries.filter(entry => categoryOf(entry) === 'refused').length, mocked = store.entries.filter(entry => entry.mockId).length, redirected = store.entries.filter(entry => entry.mappedUrl).length;
    count.textContent = `${store.entries.length} ${store.entries.length === 1 ? 'request' : 'requests'}${refused ? ` · ${refused} refused` : ''}${mocked ? ` · ${mocked} mocked` : ''}${redirected ? ` · ${redirected} redirected` : ''}${visibleCount !== store.entries.length ? ` · ${visibleCount} shown` : ''}${store.dropped ? ` · ${store.dropped} dropped` : ''}`;
  };
  const renderAll = () => {
    timer = null;
    const f = filter(), visible = store.entries.filter(entry => matchesFilter(entry, f)); visibleCount = visible.length;
    out.replaceChildren(...visible.slice(-RENDER_MAX).map(row));
    if (!visible.length) out.append(el('div', 'netlog-empty', store.entries.length ? 'No request matches the filter.' : 'The app\'s network requests will appear here (HTTP, DNS, refused connections).'));
    updateCount(); if (auto.checked) out.scrollTop = out.scrollHeight;
  };
  // while the person selects text in the list or has a request's menu open, new requests wait (a redraw would drop the selection and its scroll would close the menu)
  const hold = createReadingHold(out, { alsoBusy: () => menu !== null });
  const schedule = () => { if (timer !== null) return; if (hold.busy()) { hold.onRelease(schedule); return; } timer = setTimeout(() => { if (hold.busy()) { timer = null; hold.onRelease(schedule); return; } renderAll(); }, 80); };
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
