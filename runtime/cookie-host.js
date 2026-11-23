import { gcRoot } from './heap-gc.js?v=728b804e603a';
import { createHostRegistry } from './host-contract.js?v=728b804e603a';

// android.webkit.CookieManager / CookieSyncManager for the browser VM: a real in-memory RFC 6265 cookie jar per app, as on Android (each app process has its own CookieManager and
// its own WebView cookie store; with a companion package installed, e.g. microG, each package gets its own jar). The same jar serves the app's CookieManager calls, React Native's
// networking and the app's WebViews: src/webview-backend.js reads and fills it directly through `platform.cookieJarOf(packageName)` (document.cookie, and the Cookie / Set-Cookie of
// the documents the relay serves, docs/NETWORK.md "WebView documents through the relay").
// Implemented: setCookie/getCookie with Domain/Path/Expires/Max-Age/Secure matching, HttpOnly (stored; a document's script can neither read nor write it), SameSite (Strict and Lax
// cookies stay off cross-site requests of a WebView document, Lax ones go with top-level GET navigations), removeAllCookies/removeSessionCookies/removeExpiredCookie, hasCookies,
// accept flags (setAcceptThirdPartyCookies is honored for the cross-site requests of a WebView document served through the relay).
// Not implemented: persistence across launches (flush() is a no-op because nothing is persisted), public-suffix checks (a site is the last two labels of a host).
const MANAGER = 'Landroid/webkit/CookieManager;', SYNC = 'Landroid/webkit/CookieSyncManager;', CALLBACK = 'Landroid/webkit/ValueCallback;', STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;', WEBVIEW = 'Landroid/webkit/WebView;';
const isNull = v => v === null || v === undefined || v === 0;

const parseSetCookie = (header, url, now) => {
  const parts = header.split(';'), pair = parts.shift(), eq = pair.indexOf('=');
  if (eq < 0 && pair.trim() === '') return null;
  const name = (eq < 0 ? '' : pair.slice(0, eq)).trim(), value = (eq < 0 ? pair : pair.slice(eq + 1)).trim();
  const cookie = { name, value, domain: url.hostname, hostOnly: true, path: null, expires: null, secure: false, httpOnly: false, sameSite: null, created: now };
  for (const attribute of parts) {
    const index = attribute.indexOf('='), key = (index < 0 ? attribute : attribute.slice(0, index)).trim().toLowerCase(), val = index < 0 ? '' : attribute.slice(index + 1).trim();
    if (key === 'domain' && val) { cookie.domain = val.replace(/^\./, '').toLowerCase(); cookie.hostOnly = false; }
    else if (key === 'path' && val.startsWith('/')) cookie.path = val;
    else if (key === 'max-age' && /^-?\d+$/.test(val)) cookie.maxAge = Number(val);
    else if (key === 'expires') { const time = Date.parse(val); if (!Number.isNaN(time) && cookie.maxAge === undefined) cookie.expires = time; }
    else if (key === 'secure') cookie.secure = true;
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'samesite') { const mode = val.toLowerCase(); cookie.sameSite = mode === 'strict' || mode === 'lax' || mode === 'none' ? mode : null; }
  }
  if (cookie.maxAge !== undefined) cookie.expires = now + cookie.maxAge * 1000;
  delete cookie.maxAge;
  if (!cookie.hostOnly && url.hostname !== cookie.domain && !url.hostname.endsWith('.' + cookie.domain)) return null;   // a host may not set a cookie for an unrelated domain
  if (cookie.path === null) { const dir = url.pathname.slice(0, url.pathname.lastIndexOf('/')); cookie.path = dir === '' ? '/' : dir; }
  return cookie;
};
const domainMatches = (cookie, host) => cookie.hostOnly ? host === cookie.domain : host === cookie.domain || host.endsWith('.' + cookie.domain);
const pathMatches = (cookie, path) => path === cookie.path || (path.startsWith(cookie.path) && (cookie.path.endsWith('/') || path[cookie.path.length] === '/'));
/** The "site" of a host for SameSite and third-party decisions: the host itself for an IP literal, else its last two labels (no public-suffix list). */
export const siteOf = host => { const name = String(host ?? '').toLowerCase().replace(/^\[|\]$/g, ''); if (/^[\d.]+$/.test(name) || name.includes(':')) return name; return name.split('.').filter(Boolean).slice(-2).join('.'); };
const parseUrl = text => { try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : 'http://' + text); } catch { return null; } };

/**
 * One app's cookie store. `store(url, header, now, { script })` -> stored?; `header(url, now, { script, crossSite, topLevelGet })` -> "a=1; b=2" or null. `script`: a document's script
 * (document.cookie), for which HttpOnly cookies do not exist; `crossSite`: a request of a WebView document of another site (SameSite applies; Lax goes with a top-level GET navigation).
 */
export function createCookieJar() {
  const jar = { cookies: [], accept: true, thirdParty: new Set(), fileScheme: false };
  const expire = now => { jar.cookies = jar.cookies.filter(c => c.expires === null || c.expires > now); };
  return {
    state: jar,
    expire,
    store(url, header, now, { script = false } = {}) {
      const target = typeof url === 'string' ? parseUrl(url) : url; if (!target) return false;
      const cookie = parseSetCookie(String(header), target, now);
      if (!cookie || (script && cookie.httpOnly)) return false;
      const existing = jar.cookies.find(c => c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path);
      if (script && existing?.httpOnly) return false;   // a script cannot overwrite an HttpOnly cookie
      jar.cookies = jar.cookies.filter(c => c !== existing);
      if (cookie.expires !== null && cookie.expires <= now) return true;   // an expired Set-Cookie deletes the stored one
      jar.cookies.push(cookie); return true;
    },
    header(url, now, { script = false, crossSite = false, topLevelGet = false } = {}) {
      const target = typeof url === 'string' ? parseUrl(url) : url; if (!target) return null;
      expire(now);
      const secure = target.protocol === 'https:' || target.protocol === 'wss:', path = target.pathname || '/';
      const matched = jar.cookies.filter(c => domainMatches(c, target.hostname) && pathMatches(c, path) && (!c.secure || secure) && !(script && c.httpOnly)
        && !(crossSite && (c.sameSite === 'strict' || (c.sameSite === 'lax' && !topLevelGet)))).sort((a, b) => b.path.length - a.path.length || a.created - b.created);
      return matched.length ? matched.map(c => c.name === '' ? c.value : `${c.name}=${c.value}`).join('; ') : null;
    },
    acceptsThirdParty: view => jar.thirdParty.has(view),
    get accepts() { return jar.accept; },
  };
}

export function createCookieHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(MANAGER, OBJECT, [], { allocatable: true }); type(SYNC, OBJECT, [], { allocatable: true });
  // package name -> jar. CookieManager.getInstance() answers the calling package's own instance, whose methods act on that package's jar.
  const jars = new Map(), instances = gcRoot(new Map());
  const jarNamed = name => { let jar = jars.get(name); if (!jar) jars.set(name, jar = createCookieJar()); return jar; };
  /** The package whose code is calling (the app unless a companion package's code is on the stack). */
  const callerName = r => (platform.packages?.multi ? platform.packages.callerEntry(r)?.name : null) ?? platform.packageName ?? '';
  platform.cookieJarOf = name => jarNamed(name ?? platform.packageName ?? '');
  const jarOf = (r, self) => jarNamed(r.object(self).jarOwner ?? callerName(r));
  const state = (r, self) => jarOf(r, self).state;
  const now = r => Math.floor(r.clock.wall());
  const urlOf = (r, ref, strict = true) => {
    if (isNull(ref)) r.throwJava('Ljava/lang/NullPointerException;', 'url == null');
    const text = r.stringCharacters(ref), url = parseUrl(text);
    if (!url && strict) r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid URL: ${text}`);
    return url;
  };
  const deliver = (r, callback, value) => {
    if (isNull(callback)) return;
    r.dispatch({ owner: r.object(callback).type, name: 'onReceiveValue', parameters: [OBJECT], result: 'V', signature: `(${OBJECT})V` }, [callback, r.boxPrimitive('Z', value)], 'virtual');
  };
  const store = (r, self, urlRef, valueRef) => {
    const url = urlOf(r, urlRef), header = isNull(valueRef) ? null : r.stringCharacters(valueRef);
    if (header === null) r.throwJava('Ljava/lang/NullPointerException;', 'value == null');
    return jarOf(r, self).store(url, header, now(r));
  };
  const instance = r => { const name = callerName(r); let ref = instances.get(name); if (!ref) { ref = r.allocate(MANAGER); r.object(ref).jarOwner = name; instances.set(name, ref); } return ref; };
  def(MANAGER, 'getInstance', `()${MANAGER}`, r => instance(r), { static: true });
  def(MANAGER, 'setAcceptCookie', '(Z)V', (r, _m, [self, accept]) => { state(r, self).accept = !!accept; });
  def(MANAGER, 'acceptCookie', '()Z', (r, _m, [self]) => state(r, self).accept ? 1 : 0);
  def(MANAGER, 'setAcceptThirdPartyCookies', `(${WEBVIEW}Z)V`, (r, _m, [self, view, accept]) => { if (isNull(view)) r.throwJava('Ljava/lang/NullPointerException;', 'webview cannot be null'); if (accept) state(r, self).thirdParty.add(view.ref ?? view); else state(r, self).thirdParty.delete(view.ref ?? view); });
  def(MANAGER, 'acceptThirdPartyCookies', `(${WEBVIEW})Z`, (r, _m, [self, view]) => state(r, self).thirdParty.has(view?.ref ?? view) ? 1 : 0);
  def(MANAGER, 'setAcceptFileSchemeCookies', '(Z)V', (r, _m, [self, accept]) => { state(r, self).fileScheme = !!accept; });
  def(MANAGER, 'setCookie', `(${STRING}${STRING})V`, (r, _m, [self, url, value]) => { if (state(r, self).accept) store(r, self, url, value); else urlOf(r, url); });
  def(MANAGER, 'setCookie', `(${STRING}${STRING}${CALLBACK})V`, (r, _m, [self, url, value, callback]) => { const stored = state(r, self).accept ? store(r, self, url, value) : (urlOf(r, url), false); deliver(r, callback, stored); });
  def(MANAGER, 'getCookie', `(${STRING})${STRING}`, (r, _m, [self, ref]) => { const url = urlOf(r, ref, false); return url ? jarOf(r, self).header(url, now(r)) : null; });
  def(MANAGER, 'removeAllCookies', `(${CALLBACK})V`, (r, _m, [self, callback]) => { const s = state(r, self), had = s.cookies.length > 0; s.cookies = []; deliver(r, callback, had); });
  def(MANAGER, 'removeAllCookie', '()V', (r, _m, [self]) => { state(r, self).cookies = []; });
  def(MANAGER, 'removeSessionCookies', `(${CALLBACK})V`, (r, _m, [self, callback]) => { const s = state(r, self), before = s.cookies.length; s.cookies = s.cookies.filter(c => c.expires !== null); deliver(r, callback, s.cookies.length !== before); });
  def(MANAGER, 'removeSessionCookie', '()V', (r, _m, [self]) => { const s = state(r, self); s.cookies = s.cookies.filter(c => c.expires !== null); });
  def(MANAGER, 'removeExpiredCookie', '()V', (r, _m, [self]) => jarOf(r, self).expire(now(r)));
  def(MANAGER, 'hasCookies', '()Z', (r, _m, [self]) => { jarOf(r, self).expire(now(r)); return state(r, self).cookies.length ? 1 : 0; });
  def(MANAGER, 'hasCookies', '(Z)Z', (r, _m, [self]) => { jarOf(r, self).expire(now(r)); return state(r, self).cookies.length ? 1 : 0; });
  def(MANAGER, 'flush', '()V', () => {});   // nothing is persisted across launches
  def(MANAGER, 'allowFileSchemeCookies', '()Z', r => jarNamed(callerName(r)).state.fileScheme ? 1 : 0, { static: true });

  // CookieSyncManager: deprecated since API 21; the WebView keeps the jar in sync itself, so every call is a documented no-op.
  const sync = r => platform.cookieSyncManager ??= r.allocate(SYNC);
  def(SYNC, 'createInstance', `(Landroid/content/Context;)${SYNC}`, r => sync(r), { static: true });
  def(SYNC, 'getInstance', `()${SYNC}`, r => { if (!platform.cookieSyncManager) r.throwJava('Ljava/lang/IllegalStateException;', 'CookieSyncManager::createInstance() needs to be called before CookieSyncManager::getInstance()'); return platform.cookieSyncManager; }, { static: true });
  for (const name of ['sync', 'resetSync', 'startSync', 'stopSync', 'run']) def(SYNC, name, '()V', () => {});
  return registry;
}
