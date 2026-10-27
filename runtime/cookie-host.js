import { gcRoot } from './heap-gc.js?v=7268006482d0';
import { createHostRegistry } from './host-contract.js?v=7268006482d0';

// android.webkit.CookieManager / CookieSyncManager for the browser VM: a real in-memory RFC 6265 cookie jar (the lab has no WebView, but React Native's networking and apps' own
// HTTP code keep their session cookies in the process-wide CookieManager).
// Implemented: setCookie/getCookie with Domain/Path/Expires/Max-Age/Secure matching, removeAllCookies/removeSessionCookies/removeExpiredCookie, hasCookies, accept flags.
// Not implemented: persistence across launches (flush() is a no-op because nothing is persisted), HttpOnly/SameSite enforcement beyond storage, public-suffix checks.
const MANAGER = 'Landroid/webkit/CookieManager;', SYNC = 'Landroid/webkit/CookieSyncManager;', CALLBACK = 'Landroid/webkit/ValueCallback;', STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;', WEBVIEW = 'Landroid/webkit/WebView;';
const isNull = v => v === null || v === undefined || v === 0;

const parseSetCookie = (header, url, now) => {
  const parts = header.split(';'), pair = parts.shift(), eq = pair.indexOf('=');
  if (eq < 0 && pair.trim() === '') return null;
  const name = (eq < 0 ? '' : pair.slice(0, eq)).trim(), value = (eq < 0 ? pair : pair.slice(eq + 1)).trim();
  const cookie = { name, value, domain: url.hostname, hostOnly: true, path: null, expires: null, secure: false, httpOnly: false, created: now };
  for (const attribute of parts) {
    const index = attribute.indexOf('='), key = (index < 0 ? attribute : attribute.slice(0, index)).trim().toLowerCase(), val = index < 0 ? '' : attribute.slice(index + 1).trim();
    if (key === 'domain' && val) { cookie.domain = val.replace(/^\./, '').toLowerCase(); cookie.hostOnly = false; }
    else if (key === 'path' && val.startsWith('/')) cookie.path = val;
    else if (key === 'max-age' && /^-?\d+$/.test(val)) cookie.maxAge = Number(val);
    else if (key === 'expires') { const time = Date.parse(val); if (!Number.isNaN(time) && cookie.maxAge === undefined) cookie.expires = time; }
    else if (key === 'secure') cookie.secure = true;
    else if (key === 'httponly') cookie.httpOnly = true;
  }
  if (cookie.maxAge !== undefined) cookie.expires = now + cookie.maxAge * 1000;
  delete cookie.maxAge;
  if (!cookie.hostOnly && url.hostname !== cookie.domain && !url.hostname.endsWith('.' + cookie.domain)) return null;   // a host may not set a cookie for an unrelated domain
  if (cookie.path === null) { const dir = url.pathname.slice(0, url.pathname.lastIndexOf('/')); cookie.path = dir === '' ? '/' : dir; }
  return cookie;
};
const domainMatches = (cookie, host) => cookie.hostOnly ? host === cookie.domain : host === cookie.domain || host.endsWith('.' + cookie.domain);
const pathMatches = (cookie, path) => path === cookie.path || (path.startsWith(cookie.path) && (cookie.path.endsWith('/') || path[cookie.path.length] === '/'));

export function createCookieHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(MANAGER, OBJECT, [], { allocatable: true }); type(SYNC, OBJECT, [], { allocatable: true });
  const jar = gcRoot({ cookies: [], accept: true, thirdParty: new Set(), fileScheme: false, instance: null });
  const now = r => Math.floor(r.clock.wall());
  const expire = r => { const t = now(r); jar.cookies = jar.cookies.filter(c => c.expires === null || c.expires > t); };
  const urlOf = (r, ref, strict = true) => {
    if (isNull(ref)) r.throwJava('Ljava/lang/NullPointerException;', 'url == null');
    const text = r.stringCharacters(ref);
    try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : 'http://' + text); }
    catch { if (strict) r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid URL: ${text}`); return null; }
  };
  const deliver = (r, callback, value) => {
    if (isNull(callback)) return;
    r.dispatch({ owner: r.object(callback).type, name: 'onReceiveValue', parameters: [OBJECT], result: 'V', signature: `(${OBJECT})V` }, [callback, r.boxPrimitive('Z', value)], 'virtual');
  };
  const store = (r, urlRef, valueRef) => {
    const url = urlOf(r, urlRef), header = isNull(valueRef) ? null : r.stringCharacters(valueRef);
    if (header === null) r.throwJava('Ljava/lang/NullPointerException;', 'value == null');
    const cookie = parseSetCookie(header, url, now(r));
    if (!cookie) return false;
    jar.cookies = jar.cookies.filter(c => !(c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path));
    if (cookie.expires !== null && cookie.expires <= now(r)) return true;   // an expired Set-Cookie deletes the stored one
    jar.cookies.push(cookie); return true;
  };
  const instance = r => jar.instance ??= r.allocate(MANAGER);
  def(MANAGER, 'getInstance', `()${MANAGER}`, r => instance(r), { static: true });
  def(MANAGER, 'setAcceptCookie', '(Z)V', (r, _m, [, accept]) => { jar.accept = !!accept; });
  def(MANAGER, 'acceptCookie', '()Z', () => jar.accept ? 1 : 0);
  def(MANAGER, 'setAcceptThirdPartyCookies', `(${WEBVIEW}Z)V`, (r, _m, [, view, accept]) => { if (isNull(view)) r.throwJava('Ljava/lang/NullPointerException;', 'webview cannot be null'); if (accept) jar.thirdParty.add(view.ref ?? view); else jar.thirdParty.delete(view.ref ?? view); });
  def(MANAGER, 'acceptThirdPartyCookies', `(${WEBVIEW})Z`, (r, _m, [, view]) => jar.thirdParty.has(view?.ref ?? view) ? 1 : 0);
  def(MANAGER, 'setAcceptFileSchemeCookies', '(Z)V', (r, _m, [, accept]) => { jar.fileScheme = !!accept; });
  def(MANAGER, 'setCookie', `(${STRING}${STRING})V`, (r, _m, [, url, value]) => { if (jar.accept) store(r, url, value); else urlOf(r, url); });
  def(MANAGER, 'setCookie', `(${STRING}${STRING}${CALLBACK})V`, (r, _m, [, url, value, callback]) => { const stored = jar.accept ? store(r, url, value) : (urlOf(r, url), false); deliver(r, callback, stored); });
  def(MANAGER, 'getCookie', `(${STRING})${STRING}`, (r, _m, [, ref]) => {
    const url = urlOf(r, ref, false); if (!url) return null; expire(r);
    const secure = url.protocol === 'https:' || url.protocol === 'wss:', path = url.pathname || '/';
    const matched = jar.cookies.filter(c => domainMatches(c, url.hostname) && pathMatches(c, path) && (!c.secure || secure)).sort((a, b) => b.path.length - a.path.length || a.created - b.created);
    return matched.length ? matched.map(c => c.name === '' ? c.value : `${c.name}=${c.value}`).join('; ') : null;
  });
  def(MANAGER, 'removeAllCookies', `(${CALLBACK})V`, (r, _m, [, callback]) => { const had = jar.cookies.length > 0; jar.cookies = []; deliver(r, callback, had); });
  def(MANAGER, 'removeAllCookie', '()V', () => { jar.cookies = []; });
  def(MANAGER, 'removeSessionCookies', `(${CALLBACK})V`, (r, _m, [, callback]) => { const before = jar.cookies.length; jar.cookies = jar.cookies.filter(c => c.expires !== null); deliver(r, callback, jar.cookies.length !== before); });
  def(MANAGER, 'removeSessionCookie', '()V', () => { jar.cookies = jar.cookies.filter(c => c.expires !== null); });
  def(MANAGER, 'removeExpiredCookie', '()V', r => expire(r));
  def(MANAGER, 'hasCookies', '()Z', r => { expire(r); return jar.cookies.length ? 1 : 0; });
  def(MANAGER, 'hasCookies', '(Z)Z', r => { expire(r); return jar.cookies.length ? 1 : 0; });
  def(MANAGER, 'flush', '()V', () => {});   // nothing is persisted across launches
  def(MANAGER, 'allowFileSchemeCookies', '()Z', () => jar.fileScheme ? 1 : 0, { static: true });

  // CookieSyncManager: deprecated since API 21; the WebView keeps the jar in sync itself, so every call is a documented no-op.
  const sync = r => platform.cookieSyncManager ??= r.allocate(SYNC);
  def(SYNC, 'createInstance', `(Landroid/content/Context;)${SYNC}`, r => sync(r), { static: true });
  def(SYNC, 'getInstance', `()${SYNC}`, r => { if (!platform.cookieSyncManager) r.throwJava('Ljava/lang/IllegalStateException;', 'CookieSyncManager::createInstance() needs to be called before CookieSyncManager::getInstance()'); return platform.cookieSyncManager; }, { static: true });
  for (const name of ['sync', 'resetSync', 'startSync', 'stopSync', 'run']) def(SYNC, name, '()V', () => {});
  return registry;
}
