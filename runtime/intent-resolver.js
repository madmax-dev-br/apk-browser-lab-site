// Intent resolution against the manifest's <intent-filter> declarations, as `am start -a <action> -d <uri>` / PackageManager.resolveActivity(MATCH_DEFAULT_ONLY) does it.
// Modelled on AOSP android-13.0.0_r1 core/java/android/content/IntentFilter.java (match, matchAction, matchData, matchCategories, AuthorityEntry.match, hasDataPath) and
// os/PatternMatcher.java (literal, prefix, simple glob, advanced glob, suffix). DOM-free and process-free: it runs in the Worker and in node tests.

export const MATCH_CATEGORY = { EMPTY: 0x0100000, SCHEME: 0x0200000, HOST: 0x0300000, PORT: 0x0400000, PATH: 0x0500000, TYPE: 0x0600000 };
export const MATCH_ADJUSTMENT_NORMAL = 0x8000;
export const NO_MATCH = { TYPE: -1, DATA: -2, ACTION: -3, CATEGORY: -4 };
export const CATEGORY_DEFAULT = 'android.intent.category.DEFAULT';
export const ACTION_VIEW = 'android.intent.action.VIEW';

/** android.net.Uri.parse (RFC 2396/3986 split): scheme, authority (host and port), decoded path, query, fragment. Hierarchical and opaque ("mailto:a@b") forms. */
export function parseUri(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const value = text.trim(), match = /^(?:([A-Za-z][A-Za-z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value);
  if (!match) return null;
  const [, scheme = null, authority = null, rawPath = '', query = null, fragment = null] = match;
  let host = null, port = -1, userInfo = null;
  if (authority !== null) {
    let rest = authority; const at = rest.lastIndexOf('@'); if (at >= 0) { userInfo = rest.slice(0, at); rest = rest.slice(at + 1); }
    const portMatch = /^(.*):(\d*)$/.exec(rest); if (portMatch && !/^\[.*\]$/.test(rest)) { rest = portMatch[1]; port = portMatch[2] === '' ? -1 : Number(portMatch[2]); }
    host = rest === '' ? null : rest;
  }
  let path = rawPath; try { path = decodeURIComponent(rawPath); } catch { /* malformed escapes stay as typed, like Uri.getPath for a bad sequence */ }
  const opaque = scheme !== null && authority === null && rawPath !== '' && !rawPath.startsWith('/');
  return { text: value, scheme: scheme === null ? null : scheme.toLowerCase(), authority, userInfo, host, port, path: opaque ? null : path, schemeSpecificPart: opaque ? value.slice(scheme.length + 1).replace(/#.*$/, '') : null, query, fragment, opaque };
}

/** PatternMatcher.PATTERN_SIMPLE_GLOB: '.' matches any char, '*' zero or more of the previous char, ".*" any string, '\\' escapes the next char. */
export function matchGlob(pattern, text) {
  const np = pattern.length; if (np <= 0) return text.length <= 0;
  let ip = 0, im = 0, nextChar = pattern[0];
  while (ip < np && im < text.length) {
    let c = nextChar; ip++; nextChar = ip < np ? pattern[ip] : '\0';
    let escaped = false;
    if (c === '\\') { c = nextChar; escaped = true; ip++; nextChar = ip < np ? pattern[ip] : '\0'; }
    if (nextChar === '*') {
      if (!escaped && c === '.') {
        if (ip >= np - 1) return true;   // ".*" at the end matches everything left
        ip++; nextChar = pattern[ip];
        if (nextChar === '\\') { ip++; nextChar = ip < np ? pattern[ip] : '\0'; }
        do { if (text[im] === nextChar) break; im++; } while (im < text.length);
        if (im === text.length) return false;
        ip++; nextChar = ip < np ? pattern[ip] : '\0'; im++;
      } else {
        do { if (text[im] !== c) break; im++; } while (im < text.length);
        ip++; nextChar = ip < np ? pattern[ip] : '\0';
      }
    } else {
      if (c !== '.' && text[im] !== c) return false;
      im++;
    }
  }
  if (ip >= np && im >= text.length) return true;
  if (ip === np - 2 && pattern[ip] === '.' && pattern[ip + 1] === '*') return true;
  return false;
}

/** PatternMatcher.PATTERN_ADVANCED_GLOB: '.', '*', '+', '?', '[...]' sets, '{n,m}' ranges and '\\' escapes, anchored at both ends. */
export function matchAdvancedGlob(pattern, text) {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') { i++; if (i < pattern.length) source += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    else if (c === '[' || c === ']' || c === '{' || c === '}' || c === '.' || c === '*' || c === '+' || c === '?') source += c;
    else source += c.replace(/[()|^$]/g, '\\$&');
  }
  try { return new RegExp(`^(?:${source})$`, 's').test(text); } catch { return false; }
}

const PATH_RULES = [['path', (rule, path) => rule === path], ['pathPrefix', (rule, path) => path.startsWith(rule)], ['pathPattern', matchGlob], ['pathAdvancedPattern', matchAdvancedGlob], ['pathSuffix', (rule, path) => path.endsWith(rule)]];

/** The merged <data> view of one filter: all schemes, authorities (host plus optional port), paths and MIME types, since attributes of several <data> elements combine (IntentFilter.addData*). */
function dataOf(filter) {
  const out = { schemes: [], authorities: [], paths: [], types: [] };
  for (const entry of filter.data ?? []) {
    if (entry.scheme !== undefined) out.schemes.push(entry.scheme.toLowerCase());
    if (entry.host !== undefined) out.authorities.push({ host: entry.host, port: entry.port !== undefined && /^\d+$/.test(entry.port) ? Number(entry.port) : -1 });
    for (const [kind] of PATH_RULES) if (entry[kind] !== undefined) out.paths.push({ kind, rule: entry[kind] });
    if (entry.mimeType !== undefined) out.types.push(entry.mimeType);
  }
  return out;
}

/** IntentFilter.AuthorityEntry.match: a "*." host matches any subdomain suffix, case-insensitively; a declared port must equal the Uri's. */
function matchAuthority(entry, uri) {
  let host = uri.host; if (host === null) return NO_MATCH.DATA;
  const wild = entry.host.startsWith('*'), rule = wild ? entry.host.slice(1) : entry.host;
  if (wild) { if (host.length < rule.length) return NO_MATCH.DATA; host = host.slice(host.length - rule.length); }
  if (host.toLowerCase() !== rule.toLowerCase()) return NO_MATCH.DATA;
  if (entry.port >= 0) return entry.port === uri.port ? MATCH_CATEGORY.PORT : NO_MATCH.DATA;
  return MATCH_CATEGORY.HOST;
}

/** IntentFilter.findMimeType: exact, a "type" + slash + star family and the any-type wildcard, against the intent's own type (parameters after ';' ignored). */
function matchMime(types, type) {
  if (type === null || type === undefined) return false;
  const wanted = type.split(';')[0].trim().toLowerCase(), slash = wanted.indexOf('/'); if (slash < 0) return false;
  for (const raw of types) {
    const have = raw.toLowerCase();
    if (have === wanted) return true;
    if (have === '*/*' || have === '*') return true;
    if (have.endsWith('/*') && have.slice(0, have.length - 2) === wanted.slice(0, slash)) return true;
  }
  return false;
}

/** IntentFilter.matchData: >= 0 is a match quality (MATCH_CATEGORY_* + adjustment), a negative value is NO_MATCH_*. */
export function matchData(filter, type, uri) {
  const { schemes, authorities, paths, types } = dataOf(filter), scheme = uri?.scheme ?? null;
  let match = MATCH_CATEGORY.EMPTY;
  if (!types.length && !schemes.length) return type == null && uri == null ? MATCH_CATEGORY.EMPTY + MATCH_ADJUSTMENT_NORMAL : NO_MATCH.DATA;
  if (schemes.length) {
    if (!schemes.includes(scheme ?? '')) return NO_MATCH.DATA;
    match = MATCH_CATEGORY.SCHEME;
    if (authorities.length) {
      let best = NO_MATCH.DATA; for (const entry of authorities) { const value = matchAuthority(entry, uri); if (value > best) best = value; }
      if (best < 0) return NO_MATCH.DATA;
      if (!paths.length) match = best;
      else if (uri.path !== null && paths.some(rule => PATH_RULES.find(([kind]) => kind === rule.kind)[1](rule.rule, uri.path))) match = MATCH_CATEGORY.PATH;
      else return NO_MATCH.DATA;
    } else if (paths.length) {
      // A path rule with no host: IntentFilter only applies path rules after an authority matched, so the data is accepted on the scheme alone.
    }
  } else if (scheme !== null && scheme !== '' && scheme !== 'content' && scheme !== 'file') return NO_MATCH.DATA;
  if (types.length) { if (matchMime(types, type)) match = MATCH_CATEGORY.TYPE; else return NO_MATCH.TYPE; }
  else if (type != null) return NO_MATCH.TYPE;
  return match + MATCH_ADJUSTMENT_NORMAL;
}

/** One-line description of a filter for diagnostics: `VIEW [DEFAULT, BROWSABLE] myscheme://item/*`. */
export function describeFilter(filter) {
  const short = name => name.replace(/^android\.intent\.(?:action|category)\./, '');
  const data = (filter.data ?? []).map(entry => {
    const path = PATH_RULES.map(([kind]) => entry[kind] === undefined ? '' : kind === 'path' ? entry.path : kind === 'pathPrefix' ? `${entry.pathPrefix}*` : kind === 'pathSuffix' ? `*${entry.pathSuffix}` : `~${entry[kind]}`).join('');
    return `${entry.scheme !== undefined ? entry.scheme + '://' : entry.host !== undefined || path ? '*://' : ''}${entry.host ?? ''}${entry.port ? ':' + entry.port : ''}${path}${entry.mimeType ? ` type=${entry.mimeType}` : ''}`.trim();
  }).filter(Boolean);
  return `${(filter.actions ?? []).map(short).join('|') || '(no action)'} [${(filter.categories ?? []).map(short).join(', ')}]${data.length ? ' ' + data.join(' ') : ''}`;
}

const truthyAttr = value => value === true || value === 'true' || (typeof value === 'number' && value !== 0);
/** android:enabled="false" hides the component from resolution. */
const enabled = activity => activity.enabled === undefined || activity.enabled === null || truthyAttr(activity.enabled) || activity.enabled === 'true';

/**
 * IntentFilter.match for one filter: the action test (an Intent with no action only needs the filter to declare some), the data/type test and the category test.
 * `defaultOnly` is MATCH_DEFAULT_ONLY, which every implicit startActivity() carries: the filter must declare CATEGORY_DEFAULT.
 * Returns { match: number >= 0, or a negative NO_MATCH_* } and the human reason on failure.
 */
export function matchFilter(filter, { action = null, categories = [], uri = null, type = null }, { defaultOnly = true } = {}) {
  const actions = filter.actions ?? [];
  if (action !== null && action !== undefined && action !== '') { if (!actions.includes(action)) return { match: NO_MATCH.ACTION, reason: `action ${action} is not declared` }; }
  else if (!actions.length) return { match: NO_MATCH.ACTION, reason: 'the filter declares no action' };
  const data = matchData(filter, type, uri);
  if (data < 0) return { match: data, reason: data === NO_MATCH.TYPE ? `MIME type ${type ?? '(none)'} does not match` : uri ? `data ${uri.text} does not match the filter's scheme/host/path` : 'the filter requires data and the Intent has none' };
  const have = new Set(filter.categories ?? []);
  if (defaultOnly && !have.has(CATEGORY_DEFAULT)) return { match: NO_MATCH.CATEGORY, reason: 'the filter lacks android.intent.category.DEFAULT' };
  for (const category of categories) if (!have.has(category)) return { match: NO_MATCH.CATEGORY, reason: `category ${category} is not declared` };
  return { match: data, reason: null };
}

const componentOf = (packageName, text) => {
  const slash = text.indexOf('/'); let pkg = packageName, cls = text;
  if (slash >= 0) { pkg = text.slice(0, slash); cls = text.slice(slash + 1); }
  if (cls.startsWith('.')) cls = (pkg || packageName) + cls; else if (!cls.includes('.')) cls = `${pkg || packageName}.${cls}`;
  return { packageName: pkg || packageName, className: cls };
};

/** The Intent description the page sends, trimmed and validated (the Worker never trusts it). */
export function normalizeIntentRequest(input = {}) {
  const request = input && typeof input === 'object' ? input : {};
  const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
  const extras = {};
  if (request.extras && typeof request.extras === 'object') for (const [key, value] of Object.entries(request.extras).slice(0, 64)) {
    if (typeof key === 'string' && key && (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))) extras[key] = value;
    else throw new TypeError(`Intent extra "${key}" must be a string, number or boolean`);
  }
  const categories = Array.isArray(request.category) ? request.category.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()) : typeof request.category === 'string' && request.category.trim() ? [request.category.trim()] : [];
  const out = { action: text(request.action), data: text(request.data), type: text(request.type), category: [...new Set(categories)], extras, component: text(request.component) };
  if (!out.action && !out.data && !out.component) throw new TypeError('Intent needs an action, data or component');
  if (out.data && !parseUri(out.data)) throw new TypeError(`Malformed data URI: ${out.data}`);
  return out;
}

/** Android's Intent.toString shape for diagnostics: `Intent { act=... cat=[...] dat=... typ=... cmp=... }`. */
export function describeIntent(request) {
  const parts = [];
  if (request.action) parts.push(`act=${request.action}`);
  if (request.category?.length) parts.push(`cat=[${request.category.join(',')}]`);
  if (request.data) parts.push(`dat=${request.data}`);
  if (request.type) parts.push(`typ=${request.type}`);
  if (request.component) parts.push(`cmp=${request.component}`);
  return `Intent { ${parts.join(' ')} }`;
}

/**
 * Resolves an Intent against the manifest. Explicit (component given): the named Activity must be declared; filters are not consulted (as Android). Implicit: every enabled Activity's
 * filters are matched; results are ordered by priority, then match quality, then manifest order. `considered` lists every filter tried with the reason it failed, for the error message.
 */
export function resolveIntent(manifest, input) {
  const request = normalizeIntentRequest(input), packageName = manifest?.packageName ?? '', activities = manifest?.activities ?? [];
  if (request.component) {
    const component = componentOf(packageName, request.component);
    if (component.packageName !== packageName) return { kind: 'explicit', request, matches: [], considered: [], error: `component ${request.component}: package ${component.packageName} is not this app (${packageName})` };
    const activity = activities.find(value => value.name === component.className);
    if (!activity) return { kind: 'explicit', request, matches: [], considered: [], error: `component ${request.component}: ${component.className} is not an Activity declared in the manifest` };
    if (!enabled(activity)) return { kind: 'explicit', request, matches: [], considered: [], error: `component ${request.component}: ${component.className} is disabled (android:enabled="false")` };
    return { kind: 'explicit', request, matches: [{ activity: activity.name, filter: null, filterText: null, match: null, priority: 0 }], considered: [] };
  }
  return { kind: 'implicit', request, ...resolveIntentFields(manifest, { action: request.action, data: request.data, type: request.type, categories: request.category }) };
}

/**
 * PackageManager-side resolution of an Intent the app built (startActivity with no component, queryIntentActivities, resolveActivity): its fields as the Intent holds them; never throws.
 * `defaultOnly` is MATCH_DEFAULT_ONLY (every implicit startActivity carries it; queryIntentActivities only with the flag). An Intent restricted to another package (setPackage) resolves to
 * nothing: only this app is installed. Ordered as resolveIntent: priority, match quality, manifest order; one entry per Activity.
 */
export function resolveIntentFields(manifest, { action = null, data = null, type = null, categories = [], package: wanted = null } = {}, { defaultOnly = true } = {}) {
  const packageName = manifest?.packageName ?? '', activities = manifest?.activities ?? [];
  if (wanted && wanted !== packageName) return { matches: [], considered: [{ activity: wanted, filter: null, reason: `the Intent is restricted to package ${wanted}, which is not installed` }] };
  const uri = data ? parseUri(data) : null, query = { action: action || null, categories: categories ?? [], uri, type: type || null };
  const matches = [], considered = []; let order = 0;
  for (const activity of activities) {
    if (!enabled(activity)) { considered.push({ activity: activity.name, filter: null, reason: 'the Activity is disabled' }); continue; }
    for (const filter of activity.filters ?? []) {
      const outcome = matchFilter(filter, query, { defaultOnly });
      if (outcome.match >= 0) matches.push({ activity: activity.name, filter: describeFilter(filter), filterText: describeFilter(filter), match: outcome.match, priority: filter.priority | 0, order: order++ });
      else considered.push({ activity: activity.name, filter: describeFilter(filter), reason: outcome.reason });
    }
    if (!(activity.filters ?? []).length) considered.push({ activity: activity.name, filter: null, reason: 'the Activity declares no intent filter (reachable only with an explicit component)' });
  }
  matches.sort((a, b) => b.priority - a.priority || b.match - a.match || a.order - b.order);
  const unique = []; for (const entry of matches) if (!unique.some(value => value.activity === entry.activity)) unique.push(entry);
  return { matches: unique, considered };
}

/** The message shown when nothing matches (the page prints it as is). */
export function unresolvedMessage(resolution) {
  if (resolution.error) return `Activity not started: ${resolution.error}`;
  const rows = resolution.considered.slice(0, 24).map(entry => `  ${entry.activity}${entry.filter ? ` [${entry.filter}]` : ''}: ${entry.reason}`);
  return `Activity not started, unable to resolve ${describeIntent(resolution.request)}; ${resolution.considered.length} filter(s) considered:\n${rows.join('\n') || '  (the manifest declares no Activity)'}${resolution.considered.length > 24 ? `\n  ... ${resolution.considered.length - 24} more` : ''}`;
}
