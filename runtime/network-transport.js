// The wire side of the web device's network: one HTTP exchange over fetch, shared by the in-realm executor (network-native.js) and the synchronous network worker
// (network-worker.js). No VM state in here.
import { mapUrl } from './host-map.js?v=93d82df0437e';
export const FORBIDDEN_REQUEST_HEADERS = new Set(['content-length', 'host', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade', 'expect', 'te', 'trailer', 'proxy-connection']);
/** Header names a browser's fetch silently drops; with a relay they travel under an x-apkweb- prefix instead. */
export const BROWSER_ONLY_FORBIDDEN = new Set(['cookie', 'cookie2', 'user-agent', 'accept-encoding', 'origin', 'referer', 'date', 'dnt', 'via']);
const ENCODED = /^(gzip|deflate|br|compress|x-gzip|zstd)$/i;

export const inBrowser = () => typeof window !== 'undefined' || (typeof WorkerGlobalScope !== 'undefined' && typeof process === 'undefined');

/**
 * request: { method, url, headers: [[name, value]], body: Uint8Array|null, redirect: 0|1 }; options: { fetch, proxyUrl, redirect: 'auto'|'manual'|'follow', browser, signal }.
 * Resolves { head: { version, status, reason, url, headers: [[name, value]] }, reader } once the response head is available; rejects with the raw fetch error.
 * Redirects outside a browser are returned hop by hop (the Java side applies Android's rules); a browser hides redirect responses, so it follows them.
 */
export async function openExchange(request, { fetch: fetchFunction = globalThis.fetch, proxyUrl = '', redirect = 'auto', browser = inBrowser(), signal, dropped = null, hostMap = null } = {}) {
  const headers = [];
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (FORBIDDEN_REQUEST_HEADERS.has(lower)) { dropped?.add(lower); continue; }
    if (browser && BROWSER_ONLY_FORBIDDEN.has(lower) && !proxyUrl) { dropped?.add(lower); continue; }
    headers.push([proxyUrl && browser && BROWSER_ONLY_FORBIDDEN.has(lower) ? 'x-apkweb-' + lower : name, value]);
  }
  const mapped = mapUrl(request.url, hostMap);
  let target = mapped?.url ?? request.url;   // "Redirecionar hosts" (src/host-map.js): the exchange goes to the mapped host, the app keeps its URL
  if (proxyUrl) target = proxyUrl.includes('{url}') ? proxyUrl.replace('{url}', encodeURIComponent(target)) : proxyUrl + encodeURIComponent(target);   // the relay repeats the (mapped) target
  const manual = redirect === 'manual' || (redirect !== 'follow' && !browser) || request.redirect === 0;
  const init = { method: request.method, headers, redirect: manual ? 'manual' : 'follow', signal, credentials: 'omit', cache: 'no-store' };
  if (request.body && request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
  const response = await fetchFunction(target, init);
  if (response.type === 'opaqueredirect') { try { await response.body?.cancel(); } catch { /* ignored */ } throw Object.assign(new Error('The browser does not expose redirect responses; enable redirect following for this connection'), { code: 'APKWEB_OPAQUE_REDIRECT' }); }
  // A relay that could not reach the target answers 502 with the Node error code (scripts/cors-relay.mjs): it is the same failure as a direct connect, so it becomes the same exception.
  const relayCode = proxyUrl ? response.headers.get('x-apkweb-relay-error-code') : null;
  if (relayCode) { try { await response.body?.cancel(); } catch { /* ignored */ } throw Object.assign(new Error(response.headers.get('x-apkweb-relay-error') ?? relayCode), { code: relayCode, relayed: true }); }
  const out = []; let encoded = false;
  response.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower === 'content-encoding' && ENCODED.test(value.trim())) { encoded = true; return; }
    if (lower === 'x-apkweb-set-cookie') { for (const cookie of relayCookies(value)) out.push(['Set-Cookie', cookie]); return; }
    if (lower.startsWith('x-apkweb-relay-')) return;
    out.push([name, value]);
  });
  const kept = encoded ? out.filter(([name]) => name.toLowerCase() !== 'content-length') : out;   // the transport already decoded the body (OkHttp's transparent gzip drops both too)
  let url = !proxyUrl && response.redirected && response.url ? response.url : request.url;         // only a followed redirect changes the URL
  if (mapped && url !== request.url) url = unmapOrigin(url, mapped.url, request.url);              // a redirect the target followed on its own origin stays on the app's origin
  return { head: { version: 'HTTP/1.1', status: response.status, reason: response.statusText ?? '', url, headers: kept }, reader: response.body ? response.body.getReader() : null };
}

/** `url` on the origin of `mappedUrl` -> the same path on the origin of `originalUrl` (any other URL is returned as is). */
function unmapOrigin(url, mappedUrl, originalUrl) {
  try { const at = new URL(url), mapped = new URL(mappedUrl); if (at.origin !== mapped.origin) return url; const original = new URL(originalUrl); return original.origin + at.pathname + at.search + at.hash; } catch { return url; }
}

/** The Set-Cookie values a relay returned in x-apkweb-set-cookie: a JSON array (a header value cannot hold line breaks), or the older newline-separated form. */
export function relayCookies(value) {
  const text = String(value).trim();
  if (text.startsWith('[')) { try { const list = JSON.parse(text); if (Array.isArray(list)) return list.filter(item => typeof item === 'string'); } catch { /* not JSON: fall through */ } }
  return text.split('\n').filter(Boolean);
}

/** A fetch failure (or a worker-serialised copy of one) as the Java exception an Android device would throw: { type, message }. */
export function describeFailure(error, request, timedOut = false) {
  const cause = error?.cause ?? error, code = cause?.code ?? error?.code ?? '', name = error?.name ?? '', message = String(cause?.message ?? error?.message ?? error);
  const url = request?.url ? new URL(request.url) : null, port = url ? (url.port || (url.protocol === 'https:' ? '443' : '80')) : '0', host = url?.hostname ?? '';
  if (name === 'AbortError' && timedOut) return { type: 'Ljava/net/SocketTimeoutException;', message: 'timeout' };
  if (name === 'AbortError') return { type: 'Ljava/net/SocketException;', message: 'Socket closed' };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { type: 'Ljava/net/UnknownHostException;', message: `Unable to resolve host "${host}": No address associated with hostname` };
  if (code === 'ECONNREFUSED') return { type: 'Ljava/net/ConnectException;', message: `failed to connect to ${host}/${host} (port ${port}) from /:: (port 0): connect failed: ECONNREFUSED (Connection refused)` };
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') return { type: 'Ljava/net/SocketTimeoutException;', message: `failed to connect to ${host}/${host} (port ${port}) from /:: (port 0)` };
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') return { type: 'Ljava/net/SocketException;', message: 'Connection reset' };
  if (/^(CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_|ERR_TLS|ERR_SSL|ERR_CERT|HANDSHAKE)/.test(code) || /certificate|tls|ssl/i.test(message)) return { type: 'Ljavax/net/ssl/SSLHandshakeException;', message: `Chain validation failed: ${message}` };
  if (code === 'UND_ERR_ABORTED' || code === 'ERR_STREAM_PREMATURE_CLOSE') return { type: 'Ljava/io/IOException;', message: 'unexpected end of stream' };
  if (code === 'APKWEB_OPAQUE_REDIRECT') return { type: 'Ljava/io/IOException;', message };
  if (code === 'APKWEB_RELAY_PRIVATE') return { type: 'Ljava/net/ConnectException;', message: `failed to connect to ${host}/${host} (port ${port}) from /:: (port 0): the CORS relay refused the target (${message})` };
  if (name === 'TypeError' && /fetch/i.test(message)) return { type: 'Ljava/net/ConnectException;', message: `failed to connect to ${host}/${host} (port ${port}): the browser reports unreachable hosts, CORS rejections and blocked requests identically ("${message}")` };
  return { type: 'Ljava/io/IOException;', message: `${name || 'Error'}: ${message}` };
}

/** What crosses a thread boundary of a failure: plain data only. */
export const serialiseError = error => ({ name: error?.name ?? 'Error', message: String(error?.message ?? error), code: error?.code ?? null, cause: error?.cause ? { code: error.cause.code ?? null, message: String(error.cause.message ?? error.cause) } : null });
