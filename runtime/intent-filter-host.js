// android.content.IntentFilter matching: a port of android-13.0.0_r1 IntentFilter.java (+ PatternMatcher and IntentFilter.AuthorityEntry) over the filter state that device-state-host.js keeps
// per IntentFilter object ({ actions, categories, schemes, authorities, paths, types, priority }). Covers actions, categories, data schemes, authorities (host with leading-* wildcard,
// port), paths (literal, prefix, simple glob), MIME types with "type/*" and "*" wildcards, and the match() / matchData() result codes. Advanced-glob paths (API 31) are refused explicitly.
import { APKError } from './apk-error.js?v=00979d36e5ab';
export const MATCH = { CATEGORY_MASK: 0x0fff0000, ADJUSTMENT_MASK: 0x0000ffff, ADJUSTMENT_NORMAL: 0x8000, CATEGORY_EMPTY: 0x0100000, CATEGORY_SCHEME: 0x0200000, CATEGORY_SCHEME_SPECIFIC_PART: 0x0580000, CATEGORY_HOST: 0x0300000, CATEGORY_PORT: 0x0400000,
  CATEGORY_PATH: 0x0500000, CATEGORY_TYPE: 0x0600000, NO_MATCH_TYPE: -1, NO_MATCH_DATA: -2, NO_MATCH_ACTION: -3, NO_MATCH_CATEGORY: -4 };

/** PatternMatcher.matchGlobPattern (SIMPLE_GLOB): '.' any char, 'x*' zero or more x, '.*' anything, '\\' escapes. */
export function matchGlobPattern(pattern, match) {
  const NP = pattern.length; if (NP <= 0) return match.length <= 0;
  const NM = match.length; let ip = 0, im = 0, nextChar = pattern[0];
  while (ip < NP && im < NM) {
    let c = nextChar; ip++; nextChar = ip < NP ? pattern[ip] : '\0';
    const escaped = c === '\\'; if (escaped) { c = nextChar; ip++; nextChar = ip < NP ? pattern[ip] : '\0'; }
    if (nextChar === '*') {
      if (!escaped && c === '.') {
        if (ip >= NP - 1) return true;
        ip++; nextChar = pattern[ip];
        if (nextChar === '\\') { ip++; nextChar = ip < NP ? pattern[ip] : '\0'; }
        do { if (match[im] === nextChar) break; im++; } while (im < NM);
        if (im === NM) return false;
        ip++; nextChar = ip < NP ? pattern[ip] : '\0'; im++;
      } else {
        do { if (match[im] !== c) break; im++; } while (im < NM);
        ip++; nextChar = ip < NP ? pattern[ip] : '\0';
      }
    } else { if (c !== '.' && match[im] !== c) return false; im++; }
  }
  if (ip >= NP && im >= NM) return true;
  return ip === NP - 2 && pattern[ip] === '.' && pattern[ip + 1] === '*';
}
const PATTERN = { LITERAL: 0, PREFIX: 1, SIMPLE_GLOB: 2, ADVANCED_GLOB: 3, SUFFIX: 4 };
const patternMatches = (entry, text) => entry.type === PATTERN.LITERAL ? entry.path === text : entry.type === PATTERN.PREFIX ? text.startsWith(entry.path) : entry.type === PATTERN.SUFFIX ? text.endsWith(entry.path) : matchGlobPattern(entry.path, text);

export function defineIntentFilterMatching({ registry, def, filterOf, text, call, INTENT, FILTER, STRING }) {
  const state = (r, ref) => { const f = filterOf(r, ref); f.categories ??= []; f.schemes ??= null; f.authorities ??= null; f.paths ??= null; f.types ??= null; f.priority ??= 0; f.partialTypes ??= false; return f; };
  const URI = 'Landroid/net/Uri;', SET = 'Ljava/util/Set;', STRING_LIST = ['Ljava/lang/String;'];
  const uriCall = (r, uri, name, result) => r.dispatch({ owner: URI, name, parameters: [], result, signature: `()${result}` }, [uri], 'virtual');
  const setValues = (r, set) => { const out = [], it = r.dispatch({ owner: 'Ljava/util/Collection;', name: 'iterator', parameters: [], result: 'Ljava/util/Iterator;', signature: '()Ljava/util/Iterator;' }, [set], 'virtual'); while (r.dispatch({ owner: 'Ljava/util/Iterator;', name: 'hasNext', parameters: [], result: 'Z', signature: '()Z' }, [it], 'virtual')) out.push(text(r, r.dispatch({ owner: 'Ljava/util/Iterator;', name: 'next', parameters: [], result: 'Ljava/lang/Object;', signature: '()Ljava/lang/Object;' }, [it], 'virtual'))); return out; };
  const MALFORMED = 'Landroid/content/IntentFilter$MalformedMimeTypeException;';
  for (const [name, field] of [['Category', 'categories'], ['DataScheme', 'schemes']]) {
    def(FILTER, `add${name}`, `(${STRING})V`, (r, _m, [self, value]) => { const f = state(r, self), list = (f[field] ??= []); const v = text(r, value); if (!list.includes(v)) list.push(v); });
    def(FILTER, `has${name}`, `(${STRING})Z`, (r, _m, [self, value]) => state(r, self)[field]?.includes(text(r, value)) ? 1 : 0);
    def(FILTER, `count${name}${name === 'Category' ? 'ies' : 's'}`, '()I', (r, _m, [self]) => state(r, self)[field]?.length ?? 0);
    def(FILTER, `get${name}`, `(I)${STRING}`, (r, _m, [self, i]) => state(r, self)[field]?.[i] ?? null);
  }
  def(FILTER, 'addDataAuthority', `(${STRING}${STRING})V`, (r, _m, [self, host, port]) => {
    const f = state(r, self); (f.authorities ??= []); let h = text(r, host); const p = port === null ? -1 : parseInt(text(r, port).replace(/^[^0-9]*/, ''), 10), wild = h.startsWith('*');
    if (wild) h = h.slice(1); f.authorities.push({ host: h, wild, port: Number.isNaN(p) ? -1 : p });
  });
  def(FILTER, 'countDataAuthorities', '()I', (r, _m, [self]) => state(r, self).authorities?.length ?? 0);
  def(FILTER, 'addDataPath', `(${STRING}I)V`, (r, _m, [self, path, type]) => { if (type === PATTERN.ADVANCED_GLOB) throw new APKError('IntentFilter advanced-glob data paths are not implemented', { kind: 'unsupported-intent-filter' }); (state(r, self).paths ??= []).push({ path: text(r, path), type }); });
  def(FILTER, 'countDataPaths', '()I', (r, _m, [self]) => state(r, self).paths?.length ?? 0);
  def(FILTER, 'addDataType', `(${STRING})V`, (r, _m, [self, type]) => {
    const t = text(r, type), slash = t.indexOf('/'), f = state(r, self);
    if (slash > 0 && t.length >= slash + 2) { (f.types ??= []); if (t.length === slash + 2 && t[slash + 1] === '*') { f.types.push(t.slice(0, slash)); f.partialTypes = true; } else f.types.push(t); return; }
    r.throwJava(MALFORMED, t);
  });
  def(FILTER, 'hasDataType', `(${STRING})Z`, (r, _m, [self, type]) => { const f = state(r, self); return type !== null && f.types && findMimeType(f, text(r, type)) ? 1 : 0; });
  def(FILTER, 'countDataTypes', '()I', (r, _m, [self]) => state(r, self).types?.length ?? 0);
  def(FILTER, 'getDataType', `(I)${STRING}`, (r, _m, [self, i]) => state(r, self).types?.[i] ?? null);
  def(FILTER, 'setPriority', '(I)V', (r, _m, [self, p]) => { state(r, self).priority = p; }); def(FILTER, 'getPriority', '()I', (r, _m, [self]) => state(r, self).priority);
  def(FILTER, 'matchAction', `(${STRING})Z`, (r, _m, [self, action]) => state(r, self).actions.some(a => text(r, a) === text(r, action)) ? 1 : 0);
  def(FILTER, 'matchCategories', `(${SET})${STRING}`, (r, _m, [self, categories]) => matchCategories(r, state(r, self), categories));
  def(FILTER, 'matchDataAuthority', `(${URI})I`, (r, _m, [self, uri]) => matchAuthority(r, state(r, self), uri));
  def(FILTER, 'hasDataPath', `(${STRING})Z`, (r, _m, [self, path]) => state(r, self).paths?.some(p => patternMatches(p, text(r, path))) ? 1 : 0);
  def(FILTER, 'matchData', `(${STRING}${STRING}${URI})I`, (r, _m, [self, type, scheme, data]) => matchData(r, state(r, self), type === null ? null : text(r, type), scheme === null ? null : text(r, scheme), data));
  const match6 = (r, _m, [self, action, type, scheme, data, categories]) => {
    const f = state(r, self);
    if (action !== null && !f.actions.some(a => text(r, a) === text(r, action))) return MATCH.NO_MATCH_ACTION;
    const dataMatch = matchData(r, f, type === null ? null : text(r, type), scheme === null ? null : text(r, scheme), data);
    if (dataMatch < 0) return dataMatch;
    if (matchCategories(r, f, categories) !== null) return MATCH.NO_MATCH_CATEGORY;
    return dataMatch;
  };
  def(FILTER, 'match', `(${STRING}${STRING}${STRING}${URI}${SET}${STRING})I`, match6);
  def(FILTER, 'match', `(Landroid/content/ContentResolver;${INTENT}ZLjava/lang/String;)I`, (r, m, [self, resolver, intent, resolve]) => {
    const o = r.object(intent), data = o.data ?? null, scheme = data === null ? null : uriCall(r, data, 'getScheme', STRING);
    const type = resolve ? call(r, intent, INTENT, 'resolveTypeIfNeeded', ['Landroid/content/ContentResolver;'], STRING, [resolver]) : (o.mimeType ?? null);
    const categories = call(r, intent, INTENT, 'getCategories', [], SET);
    return match6(r, m, [self, o.action ?? null, type, scheme, data, categories]);
  });
  def(FILTER, 'create', `(${STRING}${STRING})${FILTER}`, (r, _m, [action, type]) => {
    const ref = r.allocate(FILTER); r.dispatch({ owner: FILTER, name: '<init>', parameters: [STRING], result: 'V', signature: `(${STRING})V` }, [ref, action], 'direct');
    try { call(r, ref, FILTER, 'addDataType', [STRING], 'V', [type]); } catch (error) { if (error?.value && r.isSubtype(r.typeOf(error.value), MALFORMED)) throw new Error('Bad MIME type', { cause: error }); throw error; }
    return ref;
  }, { static: true });
  for (const [name, value] of Object.entries(MATCH)) registry.staticField(FILTER, /^NO_MATCH/.test(name) ? name : 'MATCH_' + name, 'I', () => value);
  registry.staticField(FILTER, 'SYSTEM_HIGH_PRIORITY', 'I', () => 1000); registry.staticField(FILTER, 'SYSTEM_LOW_PRIORITY', 'I', () => -1000);
  function findMimeType(f, type) {
    const t = f.types; if (type === null) return false;
    if (t.includes(type)) return true;
    if (type === '*/*') return t.length > 0;
    if (f.partialTypes && t.includes('*')) return true;
    const slash = type.indexOf('/');
    if (slash > 0) {
      if (f.partialTypes && t.includes(type.slice(0, slash))) return true;
      if (type.length === slash + 2 && type[slash + 1] === '*') for (const v of t) if (type.slice(0, slash + 1) === v.slice(0, slash + 1)) return true;
    }
    return false;
  }
  function matchCategories(r, f, categories) {
    if (categories === null) return null;
    for (const c of setValues(r, categories)) if (!f.categories.includes(c)) return c;
    return null;
  }
  function matchAuthority(r, f, data) {
    if (f.authorities === null || data === null) return MATCH.NO_MATCH_DATA;
    const hostRef = uriCall(r, data, 'getHost', STRING), port = uriCall(r, data, 'getPort', 'I');
    for (const a of f.authorities) {
      let host = hostRef === null ? null : text(r, hostRef), result;
      if (host === null) result = a.wild ? MATCH.CATEGORY_HOST : MATCH.NO_MATCH_DATA;
      else {
        if (a.wild) { if (a.host.length > host.length) { continue; } host = host.slice(host.length - a.host.length); }
        if (host.toLowerCase() !== a.host.toLowerCase()) continue;
        result = a.port >= 0 ? (a.port === port ? MATCH.CATEGORY_PORT : MATCH.NO_MATCH_DATA) : MATCH.CATEGORY_HOST;
      }
      if (result >= 0) return result;
    }
    return MATCH.NO_MATCH_DATA;
  }
  function matchData(r, f, type, scheme, data) {
    const types = f.types, schemes = f.schemes; let result = MATCH.CATEGORY_EMPTY;
    if (types === null && schemes === null) return type === null && data === null ? MATCH.CATEGORY_EMPTY + MATCH.ADJUSTMENT_NORMAL : MATCH.NO_MATCH_DATA;
    if (schemes !== null) {
      if (schemes.includes(scheme ?? '')) result = MATCH.CATEGORY_SCHEME; else return MATCH.NO_MATCH_DATA;
      if (f.authorities !== null) {
        const authority = matchAuthority(r, f, data);
        if (authority >= 0) { if (f.paths === null) result = authority; else if (f.paths.some(p => patternMatches(p, text(r, uriCall(r, data, 'getPath', STRING) ?? '')))) result = MATCH.CATEGORY_PATH; else return MATCH.NO_MATCH_DATA; }
        else return MATCH.NO_MATCH_DATA;
      }
    } else if (scheme !== null && scheme !== '' && scheme !== 'content' && scheme !== 'file') return MATCH.NO_MATCH_DATA;
    if (types !== null) { if (findMimeType(f, type)) result = MATCH.CATEGORY_TYPE; else return MATCH.NO_MATCH_TYPE; } else if (type !== null) return MATCH.NO_MATCH_TYPE;
    return result + MATCH.ADJUSTMENT_NORMAL;
  }
}
