import { createHostRegistry } from './host-contract.js?v=6531d427a542';

// Small pure-Java platform classes that are not in the framework DEX. android.content.UriMatcher, a line-for-line port of android-13.0.0_r1 frameworks/base/core/java/android/content/UriMatcher.java (a tree of authority/path tokens with
// "#" (digits) and "*" (any text) wildcards), and android.webkit.MimeTypeMap (android-13.0.0_r1), which delegates to the original libcore MimeMap that is in the framework DEX.
// The same algorithms run here over host state.
const MATCHER = 'Landroid/content/UriMatcher;', URI = 'Landroid/net/Uri;', STRING = 'Ljava/lang/String;', NO_MATCH = -1, EXACT = 0, NUMBER = 1, TEXT = 2;

export function createContentExtrasHost() {
  const registry = createHostRegistry(), { def, type } = registry;
  type(MATCHER, 'Ljava/lang/Object;', [], { allocatable: true });
  const node = (code, which = -1, text = null) => ({ code, which, text, children: [] });
  const root = (r, ref) => r.object(ref).matcher ?? r.throwJava('Ljava/lang/IllegalStateException;', 'UriMatcher used before construction');
  def(MATCHER, '<init>', '(I)V', (r, _m, [self, code]) => { r.object(self).matcher = node(code); });
  def(MATCHER, 'addURI', `(${STRING}${STRING}I)V`, (r, _m, [self, authority, path, code]) => {
    if (code < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', `code ${code} is invalid: it must be positive`);
    let tokens = null;
    if (path !== null) { let p = r.stringCharacters(path); if (p.length > 1 && p[0] === '/') p = p.slice(1); tokens = p.split('/'); if (p !== '') while (tokens.length && tokens.at(-1) === '') tokens.pop(); }   // String.split drops trailing empty strings
    let current = root(r, self);
    for (let i = -1, n = tokens ? tokens.length : 0; i < n; i++) {
      const token = i < 0 ? r.stringCharacters(authority) : tokens[i];
      let child = current.children.find(c => c.text === token);
      if (!child) { child = node(NO_MATCH, token === '#' ? NUMBER : token === '*' ? TEXT : EXACT, token); current.children.push(child); }
      current = child;
    }
    current.code = code;
  });
  def(MATCHER, 'match', `(${URI})I`, (r, _m, [self, uri]) => {
    const list = r.dispatch({ owner: URI, name: 'getPathSegments', parameters: [], result: 'Ljava/util/List;', signature: '()Ljava/util/List;' }, [uri], 'virtual');
    const size = r.dispatch({ owner: 'Ljava/util/List;', name: 'size', parameters: [], result: 'I', signature: '()I' }, [list], 'virtual');
    const authorityRef = r.dispatch({ owner: URI, name: 'getAuthority', parameters: [], result: STRING, signature: `()${STRING}` }, [uri], 'virtual');
    let current = root(r, self);
    if (size === 0 && authorityRef === null) return current.code;
    for (let i = -1; i < size; i++) {
      const raw = i < 0 ? authorityRef : r.dispatch({ owner: 'Ljava/util/List;', name: 'get', parameters: ['I'], result: 'Ljava/lang/Object;', signature: '(I)Ljava/lang/Object;' }, [list, i], 'virtual');
      const u = raw === null ? null : r.stringCharacters(raw);
      let next = null;
      for (const n of current.children) {
        if (n.which === EXACT) { if (n.text === u) next = n; }
        else if (n.which === NUMBER) { if (u !== null && /^[0-9]*$/.test(u)) next = n; }
        else if (n.which === TEXT) next = n;
        if (next) break;
      }
      if (!next) return NO_MATCH;
      current = next;
    }
    return current.code;
  });
  registry.staticField(MATCHER, 'NO_MATCH', 'I', () => NO_MATCH);

  // ---- android.webkit.WebView.setWebContentsDebuggingEnabled: a process-wide flag (WebViewFactory provider static); the lab has no WebView
  // renderer to attach DevTools to, so the flag is only recorded.
  def('Landroid/webkit/WebView;', 'setWebContentsDebuggingEnabled', '(Z)V', (r, _m, [enabled]) => { if (r.platform) r.platform.webContentsDebugging = !!enabled; r.record(`WEBVIEW setWebContentsDebuggingEnabled(${!!enabled})`); }, { static: true });

  // ---- android.webkit.MimeTypeMap ---------------------------------------------------------------------------------------------------------
  const MIME = 'Landroid/webkit/MimeTypeMap;', MIME_MAP = 'Llibcore/content/type/MimeMap;';
  type(MIME, 'Ljava/lang/Object;', [], { allocatable: true });
  const map = r => r.dispatch({ owner: MIME_MAP, name: 'getDefault', parameters: [], result: MIME_MAP, signature: `()${MIME_MAP}` }, [], 'static');
  const mapCall = (r, name, argument, result) => r.dispatch({ owner: MIME_MAP, name, parameters: [STRING], result, signature: `(${STRING})${result}` }, [map(r), argument], 'virtual');
  const empty = (r, value) => value === null || r.stringCharacters(value) === '';
  def(MIME, 'getSingleton', `()${MIME}`, r => r.mimeTypeMap ??= r.allocate(MIME), { static: true });
  def(MIME, 'hasMimeType', `(${STRING})Z`, (r, _m, [, mimeType]) => empty(r, mimeType) ? 0 : mapCall(r, 'hasMimeType', mimeType, 'Z'));
  def(MIME, 'getMimeTypeFromExtension', `(${STRING})${STRING}`, (r, _m, [, extension]) => empty(r, extension) ? null : mapCall(r, 'guessMimeTypeFromExtension', extension, STRING));
  def(MIME, 'hasExtension', `(${STRING})Z`, (r, _m, [, extension]) => empty(r, extension) ? 0 : mapCall(r, 'hasExtension', extension, 'Z'));
  def(MIME, 'getExtensionFromMimeType', `(${STRING})${STRING}`, (r, _m, [, mimeType]) => empty(r, mimeType) ? null : mapCall(r, 'guessExtensionFromMimeType', mimeType, STRING));
  def(MIME, 'getFileExtensionFromUrl', `(${STRING})${STRING}`, (r, _m, [url]) => {
    let text = url === null ? '' : r.stringCharacters(url);
    if (text) {
      const fragment = text.lastIndexOf('#'); if (fragment > 0) text = text.slice(0, fragment);
      const query = text.lastIndexOf('?'); if (query > 0) text = text.slice(0, query);
      const slash = text.lastIndexOf('/'), filename = slash >= 0 ? text.slice(slash + 1) : text;
      if (filename && /^[a-zA-Z_0-9.\-()%]+$/.test(filename)) { const dot = filename.lastIndexOf('.'); if (dot >= 0) return filename.slice(dot + 1); }
    }
    return '';
  }, { static: true });
  return { ...registry, interfaces: registry.interfacesOf };
}
