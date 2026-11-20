// The wire side of the web device's network: one HTTP exchange over fetch, shared by the in-realm executor (network-native.js) and the synchronous network worker
// (network-worker.js). No VM state in here.
import { mapUrl } from './host-map.js?v=91b59af8dcf0';
import { NO_IDENTITY_CODE, destinationOfUrl, registerClientIdentity, relayUrl } from './client-identity.js?v=91b59af8dcf0';
export const FORBIDDEN_REQUEST_HEADERS = new Set(['content-length', 'host', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade', 'expect', 'te', 'trailer', 'proxy-connection']);
/** Header names a browser's fetch silently drops; with a relay they travel under an x-apkweb- prefix instead. */
export const BROWSER_ONLY_FORBIDDEN = new Set(['cookie', 'cookie2', 'user-agent', 'accept-encoding', 'origin', 'referer', 'date', 'dnt', 'via']);
const ENCODED = /^(gzip|deflate|br|compress|x-gzip|zstd)$/i;

export const inBrowser = () => typeof window !== 'undefined' || (typeof WorkerGlobalScope !== 'undefined' && typeof process === 'undefined');

/**
 * request: { method, url, headers: [[name, value]], body: Uint8Array|null, redirect: 0|1 }; options: { fetch, proxyUrl, redirect: 'auto'|'manual'|'follow', browser, signal }.
 * Resolves { head: { version, status, reason, url, headers: [[name, value]] }, reader } once the response head is available; rejects with the raw fetch error.
 * Redirects outside a browser are returned hop by hop (the Java side applies Android's rules); a browser hides redirect responses, so it follows them.
 * `clientIdentity` { dest, key, identity }: the client certificate (mTLS) the relay already holds for the request's destination (network-native.js useClientIdentity). The request names
 * it (client-identity-key); a relay that no longer holds it (restarted: it keeps identities in memory only) refuses before reaching the server, and the identity is handed to it
 * again and the request repeated once (head.clientIdentityRenewed). Only for that destination, through a relay.
 * `mux`: the relay's parallel channel (src/relay-mux.js; Device > "Parallel relay channel"), or null. With a relay proxy the exchange goes over it when it is open, built exactly as for
 * the per-request path (the same relay query and headers; the relay decides it with the same code), and the response is read by the code below as a fetch response is. When the
 * channel is not there the exchange takes the per-request path, as without the setting. head.relayChannel then says which it took ('mux' | 'fallback', with
 * head.relayChannelNote the reason), and so does error.relayChannel of a failure; neither is set without a channel.
 */
export async function openExchange(request, options = {}) {
  const { fetch: fetchFunction = globalThis.fetch, proxyUrl = '', redirect = 'auto', browser = inBrowser(), signal, dropped = null, hostMap = null, clientIdentity = null, identityRenewed = false, mux = null } = options;
  const headers = [];
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (FORBIDDEN_REQUEST_HEADERS.has(lower)) { dropped?.add(lower); continue; }
    if (browser && BROWSER_ONLY_FORBIDDEN.has(lower) && !proxyUrl) { dropped?.add(lower); continue; }
    headers.push([proxyUrl && browser && BROWSER_ONLY_FORBIDDEN.has(lower) ? 'x-apkweb-' + lower : name, value]);
  }
  const mapped = mapUrl(request.url, hostMap);
  let target = mapped?.url ?? request.url;   // "Redirecionar hosts" (src/host-map.js): the exchange goes to the mapped host, the app keeps its URL
  const identity = proxyUrl && clientIdentity?.identity && destinationOfUrl(target) === clientIdentity.dest ? clientIdentity : null;   // never named for another destination
  if (proxyUrl) target = relayUrl(proxyUrl, target, identity ? { 'client-identity-key': identity.key } : {});   // the relay repeats the (mapped) target
  const manual = redirect === 'manual' || (redirect !== 'follow' && !browser) || request.redirect === 0;
  const init = { method: request.method, headers, redirect: manual ? 'manual' : 'follow', signal, credentials: 'omit', cache: 'no-store' };
  if (request.body && request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
  let response = null, channel = null;
  try {
    if (mux && proxyUrl) {
      const pending = (await mux.ready()) ? mux.fetch(target, init) : null;   // null: no open channel (an older relay, a channel being retried later): the per-request path
      channel = pending ? 'mux' : 'fallback';
      if (pending) response = await pending;
    }
    response ??= await fetchFunction(target, init);
  } catch (error) {
    if (channel && error && typeof error === 'object') { try { error.relayChannel = channel; } catch { /* a frozen error: the log shows no channel */ } }
    // A redirected request that the browser failed ("Failed to fetch" hides the cause): say where it really went, and find out whether the target answered at all, with a HEAD of
    // its origin that needs no CORS (an opaque answer means the server is up and the failure was CORS; a rejection means nothing answered there). Only for "Redirecionar hosts" targets.
    if (mapped && browser && !proxyUrl && error?.name === 'TypeError') error.redirect = { from: request.url, target: mapped.url, rule: mapped.rule, reachable: await originAnswers(mapped.url, fetchFunction, signal) };
    throw error;
  }
  const channelInfo = channel ? { relayChannel: channel, relayChannelNote: channel === 'fallback' ? String(mux.reason ?? 'the channel is not open') : null } : null;
  if (response.type === 'opaqueredirect') { try { await response.body?.cancel(); } catch { /* ignored */ } throw Object.assign(new Error('The browser does not expose redirect responses; enable redirect following for this connection'), { code: 'APKWEB_OPAQUE_REDIRECT' }); }
  // A relay that could not reach the target answers 502 with the Node error code (scripts/cors-relay.mjs): it is the same failure as a direct connect, so it becomes the same exception.
  const relayCode = proxyUrl ? response.headers.get('x-apkweb-relay-error-code') : null;
  if (relayCode) {
    try { await response.body?.cancel(); } catch { /* ignored */ }
    if (relayCode === NO_IDENTITY_CODE && identity && !identityRenewed) {   // the relay restarted since the identity was handed over: hand it again, then the same request once more
      await registerClientIdentity({ proxyUrl, fetch: fetchFunction, dest: identity.dest, identity: identity.identity });
      const again = await openExchange(request, { ...options, identityRenewed: true }); again.head.clientIdentityRenewed = true; return again;
    }
    throw Object.assign(new Error(response.headers.get('x-apkweb-relay-error') ?? relayCode), { code: relayCode, relayed: true, ...(channelInfo ? { relayChannel: channel } : {}) });
  }
  const out = []; let encoded = false, coding = '';
  response.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower === 'content-encoding' && ENCODED.test(value.trim())) { encoded = true; coding = value.trim().toLowerCase(); return; }
    if (lower === 'x-apkweb-set-cookie') { for (const cookie of relayCookies(value)) out.push(['Set-Cookie', cookie]); return; }
    if (lower.startsWith('x-apkweb-relay-')) return;
    out.push([name, value]);
  });
  const kept = encoded ? out.filter(([name]) => name.toLowerCase() !== 'content-length') : out;   // the transport already decoded the body (OkHttp's transparent gzip drops both too)
  let url = !proxyUrl && response.redirected && response.url ? response.url : request.url;         // only a followed redirect changes the URL
  if (mapped && url !== request.url) url = unmapOrigin(url, mapped.url, request.url);              // a redirect the target followed on its own origin stays on the app's origin
  // HttpURLConnection on Android (OkHttp inside) decompresses transparently only when it added "Accept-Encoding: gzip" itself. An app that set Accept-Encoding: gzip on the connection
  // gets the compressed body and the Content-Encoding header, and decompresses it itself (GZIPInputStream). The browser (or the relay) always hands the decoded body, so for that
  // app the body is gzip-encoded again (the same content; not the server's exact bytes) and the header kept. The virtual HTTP socket's own clients (OkHttp) are left as they are.
  let body = response.body ?? null;
  if (body && encoded && (coding === 'gzip' || coding === 'x-gzip') && appAskedGzip(request) && typeof CompressionStream === 'function') { body = asStream(body).pipeThrough(new CompressionStream('gzip')); kept.push(['Content-Encoding', 'gzip']); }
  return { head: { version: 'HTTP/1.1', status: response.status, reason: response.statusText ?? '', url, headers: kept, ...channelInfo }, reader: body ? body.getReader() : null };
}
/** A ReadableStream over a body that only offers getReader() (the relay channel's responses, src/relay-mux.js): read on demand, so its flow control still follows the app's reads. */
const asStream = body => typeof body.pipeThrough === 'function' ? body : (reader => new ReadableStream({
  async pull(controller) { const { done, value } = await reader.read(); if (done) controller.close(); else controller.enqueue(value); },
  cancel(reason) { return reader.cancel?.(reason); },
}))(body.getReader());
/** An HttpURLConnection request (not the virtual HTTP socket's) whose app set Accept-Encoding with gzip itself (the lab's HttpURLConnection never adds the header). */
const appAskedGzip = request => (request.api ?? 'java.net') === 'java.net' && (request.headers ?? []).some(([name, value]) => String(name).toLowerCase() === 'accept-encoding' && /(^|[\s,])(x-)?gzip(\s*;|\s*,|\s*$)/i.test(String(value)));

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

/** true when something answers HTTP at the origin of `url` (a HEAD without CORS: an opaque answer still proves it), false when nothing does, null when it cannot be told. */
async function originAnswers(url, fetchFunction, signal) {
  let origin; try { origin = new URL(url).origin; } catch { return null; }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2500), abort = () => controller.abort(); signal?.addEventListener?.('abort', abort);
  try { await fetchFunction(origin + '/', { method: 'HEAD', mode: 'no-cors', credentials: 'omit', cache: 'no-store', signal: controller.signal }); return true; }
  catch { return controller.signal.aborted ? null : false; }
  finally { clearTimeout(timer); signal?.removeEventListener?.('abort', abort); }
}

/** A fetch failure (or a worker-serialised copy of one) as the Java exception an Android device would throw: { type, message }. */
export function describeFailure(error, request, timedOut = false) {
  const cause = error?.cause ?? error, code = cause?.code ?? error?.code ?? '', name = error?.name ?? '', message = String(cause?.message ?? error?.message ?? error);
  const redirect = error?.redirect ?? cause?.redirect ?? null;   // "Redirecionar hosts": the exchange went to the mapped target, so the failure names it (and where it came from)
  const url = redirect?.target ? new URL(redirect.target) : request?.url ? new URL(request.url) : null, port = url ? (url.port || (url.protocol === 'https:' ? '443' : '80')) : '0', host = url?.hostname ?? '';
  if (redirect && name === 'TypeError') {
    const from = (() => { try { const original = new URL(redirect.from); return `${original.hostname}:${original.port || (original.protocol === 'https:' ? '443' : '80')}`; } catch { return redirect.from; } })();
    const why = redirect.reachable === true ? `the server at ${url.origin} answered, but not with CORS for this page: it must send Access-Control-Allow-Origin (and answer the OPTIONS preflight), or set the CORS relay as the Proxy (it reaches this machine and the local network too)`
      : redirect.reachable === false ? `nothing answered at ${url.origin}: check that the server is running there and speaks ${url.protocol === 'https:' ? 'HTTPS' : 'plain HTTP'}`
      : 'the browser reports unreachable hosts, CORS rejections and blocked requests identically ("Failed to fetch")';
    return { type: 'Ljava/net/ConnectException;', message: `failed to connect to ${host}/${host} (port ${port}) (host redirect of ${from}): ${why}` };
  }
  if (name === 'AbortError' && timedOut) return { type: 'Ljava/net/SocketTimeoutException;', message: 'timeout' };
  if (name === 'AbortError') return { type: 'Ljava/net/SocketException;', message: 'Socket closed' };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { type: 'Ljava/net/UnknownHostException;', message: `Unable to resolve host "${host}": No address associated with hostname` };
  if (code === 'ECONNREFUSED') return { type: 'Ljava/net/ConnectException;', message: `failed to connect to ${host}/${host} (port ${port}) from /:: (port 0): connect failed: ECONNREFUSED (Connection refused)` };
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') return { type: 'Ljava/net/SocketTimeoutException;', message: `failed to connect to ${host}/${host} (port ${port}) from /:: (port 0)` };
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') return { type: 'Ljava/net/SocketException;', message: 'Connection reset' };
  if (/^(CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_|ERR_TLS|ERR_SSL|ERR_CERT|HANDSHAKE)/.test(code) || /certificate|tls|ssl/i.test(message)) return { type: 'Ljavax/net/ssl/SSLHandshakeException;', message: `Chain validation failed: ${message}` };
  if (code === 'UND_ERR_ABORTED' || code === 'ERR_STREAM_PREMATURE_CLOSE') return { type: 'Ljava/io/IOException;', message: 'unexpected end of stream' };
  if (code === 'APKWEB_OPAQUE_REDIRECT') return { type: 'Ljava/io/IOException;', message };
  if (code === NO_IDENTITY_CODE) return { type: 'Ljava/io/IOException;', message: `the client certificate for ${host}:${port} is not at the relay: ${message}` };
  if (code === 'APKWEB_RELAY_TOKEN') return { type: 'Ljava/net/ConnectException;', message: `failed to connect to ${host}/${host} (port ${port}): the CORS relay refused the Proxy address (${message})` };
  if (code === 'APKWEB_RELAY_PRIVATE') return { type: 'Ljava/net/ConnectException;', message: `failed to connect to ${host}/${host} (port ${port}) from /:: (port 0): the CORS relay refused the target (${message})` };   // only relays from before 2026-11-16 refuse private destinations; the code stays mapped for them
  if (name === 'TypeError' && /fetch/i.test(message)) return { type: 'Ljava/net/ConnectException;', message: `failed to connect to ${host}/${host} (port ${port}): the browser reports unreachable hosts, CORS rejections and blocked requests identically ("${message}")` };
  return { type: 'Ljava/io/IOException;', message: `${name || 'Error'}: ${message}` };
}

/** What crosses a thread boundary of a failure: plain data only. */
export const serialiseError = error => ({ name: error?.name ?? 'Error', message: String(error?.message ?? error), code: error?.code ?? null, redirect: error?.redirect ? { ...error.redirect } : null, cause: error?.cause ? { code: error.cause.code ?? null, message: String(error.cause.message ?? error.cause) } : null, relayChannel: error?.relayChannel ?? null });
