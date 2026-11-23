// The large window of one network request (the Network panel, src/netlog-panel.js: a click on a request): its summary, the notes the inline detail had (redirect, mock,
// route, proxy, refusal), and tabs for the request (headers, body) and the response (headers, body: JSON shown formatted, with a raw view), plus copy actions (URL, cURL,
// headers, body) and the panel's own actions (create a mock, redirect the host). Kept up to date while the window is open: a pending request fills in as it completes.
// Text only through textContent; bodies are the capped copies the network log keeps (48 KB). No process.*.
export const DETAIL_TABS = ['overview', 'request', 'response'];

const shellQuote = text => `'${String(text).replaceAll("'", `'\\''`)}'`;
/** A cURL command line for the request (headers and the captured text body; a cut or binary body is said in a comment). */
export function curlOf(entry) {
  const parts = ['curl', ...(entry.method && entry.method !== 'GET' ? ['-X', entry.method] : []), shellQuote(entry.url)];
  for (const [name, value] of entry.requestHeaders ?? []) parts.push('-H', shellQuote(`${name}: ${value}`));
  if (typeof entry.requestBody === 'string' && entry.requestBody) parts.push('--data-raw', shellQuote(entry.requestBody));
  const note = entry.requestBytes && typeof entry.requestBody !== 'string' ? `\n# the request body (${entry.requestBytes} bytes) is binary: not included` : entry.requestBodyTruncated ? '\n# the request body was cut at 48 KB' : '';
  return parts.join(' ') + note;
}
/** JSON text formatted with 2 spaces, or null when it is not JSON. */
export function prettyJson(text) {
  if (typeof text !== 'string') return null; const trimmed = text.trim(); if (!trimmed || !'{["'.includes(trimmed[0])) return null;
  try { return JSON.stringify(JSON.parse(trimmed), null, 2); } catch { return null; }
}
const headerText = headers => (headers ?? []).map(([name, value]) => `${name}: ${value}`).join('\n');

/**
 * Fills `box` with the details of `entry`. view: { tab, raw } (the tab and the raw/formatted body choice survive updates); notes(entry) -> [[className, text]] from the panel;
 * actions: { createMock, redirectHost, allowHost } (each optional); on.view(next) is called when the user changes tab or body view; copy(text) writes the clipboard.
 */
export function renderRequestDetails(box, entry, { view, notes = () => [], actions = {}, on = {}, copy = text => globalThis.navigator?.clipboard?.writeText?.(text)?.catch?.(() => {}), labels = {} } = {}) {
  const doc = box.ownerDocument ?? globalThis.document;
  const el = (tag, className, text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined && text !== null) node.textContent = text; return node; };
  const button = (text, run, className = 'cb-button') => { const b = el('button', className, text); b.type = 'button'; b.addEventListener('click', run); return b; };
  const copyButton = (label, text) => { const b = button(label, () => { copy(text()); b.textContent = 'Copied'; setTimeout(() => { b.textContent = label; }, 1200); }); return b; };
  const kv = rows => { const list = el('dl', 'nld-kv'); for (const [k, v] of rows) { if (v === null || v === undefined || v === '') continue; list.append(el('dt', null, k), el('dd', null, String(v))); } return list; };
  const headers = (title, list) => {
    const section = el('section', 'nld-section'), head = el('div', 'nld-section-head');
    head.append(el('h3', null, `${title} (${list?.length ?? 0})`)); if (list?.length) head.append(copyButton('Copy', () => headerText(list)));
    section.append(head);
    if (!list?.length) { section.append(el('p', 'nld-empty', 'None.')); return section; }
    const table = el('table', 'nld-headers'), tbody = el('tbody');
    for (const [name, value] of list) { const tr = el('tr'); tr.append(el('th', null, name), el('td', null, value)); tbody.append(tr); }
    table.append(tbody); section.append(table); return section;
  };
  const body = (title, text, { bytes = 0, truncated = false, contentType = null, binaryNote }) => {
    const section = el('section', 'nld-section'), head = el('div', 'nld-section-head');
    head.append(el('h3', null, `${title}${bytes ? ` · ${labels.size?.(bytes) ?? `${bytes} B`}` : ''}${truncated ? ' · first 48 KB' : ''}`));
    const pretty = prettyJson(text);
    if (typeof text === 'string' && text) {
      if (pretty !== null) { const toggle = button(view.raw ? 'Formatted' : 'Raw', () => on.view?.({ ...view, raw: !view.raw })); head.append(toggle); }
      head.append(copyButton('Copy', () => text));
    }
    section.append(head);
    if (typeof text === 'string' && text) section.append(el('pre', 'nld-body', pretty !== null && !view.raw ? pretty : text));
    else section.append(el('p', 'nld-empty', bytes ? binaryNote : 'No body.'));
    if (contentType) section.append(el('p', 'nld-hint', `Content-Type: ${contentType}`));
    return section;
  };

  box.replaceChildren();
  const summary = el('div', 'nld-summary');
  summary.append(el('span', `nld-method`, entry.method), el('span', `nld-status nld-cat-${labels.category?.(entry) ?? 'other'}`, labels.status?.(entry) ?? String(entry.status ?? '')),
    el('span', 'nld-url', entry.url));
  const toolbar = el('div', 'nld-actions');
  toolbar.append(copyButton('Copy URL', () => entry.url), copyButton('Copy as cURL', () => curlOf(entry)));
  if (actions.createMock) toolbar.append(button('Create mock…', () => actions.createMock(entry)));
  if (actions.redirectHost && entry.host) toolbar.append(button(`Redirect ${entry.host}…`, () => actions.redirectHost(entry)));
  if (actions.allowHost && entry.outcome === 'refused-by-allowlist' && entry.refusedHost) toolbar.append(button(`Allow ${entry.refusedHost}`, () => actions.allowHost(entry.refusedHost), 'cb-button cb-primary'));
  const tabs = el('div', 'nld-tabs'); tabs.setAttribute('role', 'tablist');
  const names = { overview: 'Overview', request: `Request${entry.requestHeaders?.length ? ` (${entry.requestHeaders.length})` : ''}`, response: `Response${entry.responseHeaders?.length ? ` (${entry.responseHeaders.length})` : ''}` };
  for (const tab of DETAIL_TABS) {
    const t = button(names[tab], () => on.view?.({ ...view, tab }), 'nld-tab'); t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', String(view.tab === tab)); t.dataset.tab = tab; tabs.append(t);
  }
  const panel = el('div', 'nld-panel'); panel.setAttribute('role', 'tabpanel');
  if (view.tab === 'overview') {
    for (const [className, text] of notes(entry)) panel.append(el('p', `nld-note ${className}`, text));
    panel.append(kv([
      ['URL', entry.url], ['Sent to', entry.mappedUrl], ['Final URL', entry.finalUrl], ['Method', entry.method], ['Status', labels.status?.(entry) ?? entry.status], ['Outcome', entry.outcome],
      ['Failure', entry.failure ? `${entry.failure.type ?? ''} ${entry.failure.message ?? ''}`.trim() : null], ['Started', labels.time?.(entry.wall) ?? entry.wall], ['Duration', labels.duration?.(entry.durationMs) ?? entry.durationMs],
      ['Request size', labels.size?.(entry.requestBytes) ?? entry.requestBytes], ['Response size', labels.size?.(entry.responseBytes) ?? entry.responseBytes], ['Content-Type', entry.contentType],
      ['API', entry.api], ['Thread', `${entry.thread} (${entry.tid})`], ['Uptime', `${entry.uptime} ms`], ['Proxy', entry.proxiedVia], ['Mock', entry.mockLabel], ['Route', entry.routeLabel ? `${entry.routeLabel}${entry.routeChange ? ` (${entry.routeChange})` : ''}` : null],
    ]));
  } else if (view.tab === 'request') {
    panel.append(headers('Request headers', entry.requestHeaders), body('Request body', entry.requestBody, { bytes: entry.requestBytes, truncated: entry.requestBodyTruncated, binaryNote: 'The body is binary: only its size is kept.' }));
  } else {
    panel.append(headers('Response headers', entry.responseHeaders), body('Response body', entry.responseBody, { bytes: entry.responseBytes, truncated: entry.responseBodyTruncated, contentType: entry.contentType,
      binaryNote: entry.complete ? 'The body is not text (or arrived compressed in a form the lab does not keep): only its size is kept.' : 'Waiting for the response…' }));
  }
  box.append(summary, toolbar, tabs, panel);
}
