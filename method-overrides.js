// Method changes chosen by the user (CLAUDE.md, "a third exception"): the page's "Method returns" rows (a debugging tool: a method's return value fixed) and the plugins' lab.hook
// changes (src/method-hooks.js: a fixed return or exception, observed calls, a smali body), all in ONE registry per runtime (below). The tester names a method (smali form
// `Lpkg/Class;->name(Params)Ret`); every call whose RESOLVED target definition is that method takes the change. Nothing is silent: each hit is counted, a change that alters
// behavior writes a Logcat warning (tag APKWebLab) at its first hit and every 100th, each change is recorded in the trace when it is installed and removed, the report summary
// lists the active changes with their call counts, and the page lists them ("App modified", with a remove button) with live counts.
//
// Hook: APKRuntime.dispatchCore asks `rt.methodOverrides` (null while no change is active -- the whole cost of the feature when idle is that one null test on the uncached call
// path) once the target definition is resolved. Every call that is not served by an inline cache goes through dispatchCore (interpreted invoke-* of every kind, a call site that
// has not cached its callee yet, reflection, host code calling `runtime.dispatch`). Call sites that DID cache the callee (interpreter site.callee / site.poly, read by compiled
// callers, frameless getters and shapes) are reset by `updateHooks` for the methods whose change was added or removed, so their next call goes through dispatchCore too; a call
// that dispatchCore answers through a hook never fills a cache. The WebAssembly core routes every hooked method's calls to dispatchCore (vmcore/js/host-bridge.js syncRouting).
// Runs in the Worker and in Node tests: no DOM, no process.*.
import { PendingCall, BodyInvoke } from './interpreter.js?v=953f70426d12';

const PRIMITIVES = { Z: 'boolean', B: 'byte', S: 'short', C: 'char', I: 'int', J: 'long', F: 'float', D: 'double', V: 'void' };
const JAVA_PRIMITIVES = Object.fromEntries(Object.entries(PRIMITIVES).map(([smali, name]) => [name, smali]));
const SIMPLE_NAME = /^(?:<init>|<clinit>|[A-Za-z_$][\w$]*)$/;
const CLASS_PATH = /^[A-Za-z_$][\w$]*(?:\/[A-Za-z_$][\w$]*)*$/;
const JAVA_CLASS = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

/** One smali type at `text[at]`: { type, end } or null. */
function readSmaliType(text, at) {
  let i = at; while (text[i] === '[') i++;
  if (i - at > 255) return null;
  if (text[i] === 'L') { const end = text.indexOf(';', i); if (end < 0 || !CLASS_PATH.test(text.slice(i + 1, end))) return null; return { type: text.slice(at, end + 1), end: end + 1 }; }
  if (i < text.length && 'ZBSCIJFD'.includes(text[i])) return { type: text.slice(at, i + 1), end: i + 1 };
  return null;
}
function smaliParameters(text) {
  const out = []; let at = 0;
  while (at < text.length) { const read = readSmaliType(text, at); if (!read || read.type === 'V') return null; out.push(read.type); at = read.end; }
  return out;
}
/** A Java type name (`int`, `java.lang.String`, `a.B[]`) -> smali, or null. */
function javaTypeToSmali(name) {
  let dims = 0, base = name.trim(); while (base.endsWith('[]')) { dims++; base = base.slice(0, -2).trim(); }
  const prim = JAVA_PRIMITIVES[base];
  if (prim !== undefined) return '['.repeat(dims) + prim;
  return JAVA_CLASS.test(base) ? '['.repeat(dims) + 'L' + base.replaceAll('.', '/') + ';' : null;
}
export function smaliTypeToJava(type) {
  let dims = 0, base = type; while (base[0] === '[') { dims++; base = base.slice(1); }
  const name = base.length === 1 ? PRIMITIVES[base] : base.slice(1, -1).replaceAll('/', '.');
  return name + '[]'.repeat(dims);
}

/**
 * Parses a method written in smali form (`Lpkg/Class;->name(IL...;)Z`) or in Java form (`pkg.Class.name(int, java.lang.String)`, optionally `ret pkg.Class.name(...)` or
 * `pkg.Class.name(...): ret`). Returns { ok: true, key, owner, name, parameters, result } -- `result` is null when a Java-form text names no return type (the page then asks the VM which
 * return types exist for that name and parameters) -- or { ok: false, error }.
 */
export function parseMethodSpec(input) {
  const text = String(input ?? '').trim();
  if (!text) return { ok: false, error: 'Enter the method.' };
  if (text.startsWith('L') && text.includes('->')) {
    const arrow = text.indexOf('->'), owner = text.slice(0, arrow);
    if (!/^L[^;\s]+;$/.test(owner) || !CLASS_PATH.test(owner.slice(1, -1))) return { ok: false, error: 'Invalid class: use Lpackage/Class; before "->".' };
    const open = text.indexOf('(', arrow), close = text.indexOf(')', open);
    if (open < 0 || close < 0) return { ok: false, error: 'The parameter parentheses are missing: Lpkg/Class;->name(Params)Return.' };
    const name = text.slice(arrow + 2, open); if (!SIMPLE_NAME.test(name)) return { ok: false, error: `Invalid method name: "${name}".` };
    const parameters = smaliParameters(text.slice(open + 1, close)); if (!parameters) return { ok: false, error: 'Invalid parameters: use smali types (I, Z, Ljava/lang/String;, [B...).' };
    const result = text.slice(close + 1), read = result === 'V' ? { type: 'V', end: 1 } : readSmaliType(result, 0);
    if (!read || read.end !== result.length) return { ok: false, error: 'Invalid return type: use a smali type (V, Z, I, Ljava/lang/String;...).' };
    return finish(owner, name, parameters, result);
  }
  let rest = text, result = null;
  const prefix = /^([\w$.]+(?:\[\])*)\s+(?=[\w$.]+\s*\()/.exec(rest);
  if (prefix) { result = prefix[1]; rest = rest.slice(prefix[0].length); }
  const suffix = /\)\s*:\s*([\w$.]+(?:\[\])*)\s*$/.exec(rest);
  if (suffix) { if (result !== null) return { ok: false, error: 'Return type given twice.' }; result = suffix[1]; rest = rest.slice(0, suffix.index + 1); }
  const match = /^([\w$.]+)\.([\w$<>]+)\s*\(([^)]*)\)$/.exec(rest.trim());
  if (!match) return { ok: false, error: 'Format not recognized: use Lpkg/Class;->name(Params)Ret or package.Class.name(types).' };
  const [, className, name, list] = match; if (!JAVA_CLASS.test(className) || !SIMPLE_NAME.test(name)) return { ok: false, error: 'Invalid class or method name.' };
  const parameters = [];
  for (const piece of list.split(',')) {
    const trimmed = piece.trim(); if (!trimmed) { if (list.trim()) return { ok: false, error: 'Empty parameter in the list.' }; continue; }
    const smali = javaTypeToSmali(trimmed); if (!smali || smali === 'V') return { ok: false, error: `Invalid parameter type: "${trimmed}".` };
    parameters.push(smali);
  }
  let smaliResult = null;
  if (result !== null) { smaliResult = javaTypeToSmali(result); if (!smaliResult) return { ok: false, error: `Invalid return type: "${result}".` }; }
  return finish('L' + className.replaceAll('.', '/') + ';', name, parameters, smaliResult);
}
function finish(owner, name, parameters, result) {
  return { ok: true, owner, name, parameters, result, key: result === null ? null : `${owner}->${name}(${parameters.join('')})${result}` };
}

const INT_RANGES = { B: [-128, 127], S: [-32768, 32767], C: [0, 65535], I: [-2147483648, 2147483647] };
const BITS = new ArrayBuffer(8), F32 = new Float32Array(BITS), I32 = new Int32Array(BITS), F64 = new Float64Array(BITS), B64 = new BigInt64Array(BITS);
/**
 * The return value typed by the tester, in the VM's register representation for `result` (Z 0/1; B S C I numbers; J BigInt; F int32 bits; D BigInt bits; String a JavaScript string; other
 * references null). { ok: true, value, display } or { ok: false, error } with the reason shown in the page.
 */
export function parseReturnValue(result, input) {
  const text = String(input ?? '');
  if (result === 'V') return { ok: true, value: undefined, display: '(void)' };
  if (result === 'Z') { const t = text.trim(); if (t === 'true') return { ok: true, value: 1, display: 'true' }; if (t === 'false') return { ok: true, value: 0, display: 'false' }; return { ok: false, error: 'boolean: use true or false.' }; }
  if (result in INT_RANGES) {
    const t = text.trim(), [lo, hi] = INT_RANGES[result], name = PRIMITIVES[result];
    if (result === 'C' && /^'.'$/u.test(t) && t.length === 3) return { ok: true, value: t.charCodeAt(1), display: t };
    if (!/^[+-]?\d+$/.test(t)) return { ok: false, error: `${name}: use an integer between ${lo} and ${hi}.` };
    const n = Number(t); if (!Number.isSafeInteger(n) || n < lo || n > hi) return { ok: false, error: `${name}: ${t} is out of range ${lo} to ${hi}.` };
    return { ok: true, value: n, display: String(n) };
  }
  if (result === 'J') {
    const t = text.trim(); if (!/^[+-]?\d+$/.test(t)) return { ok: false, error: 'long: use an integer between -9223372036854775808 and 9223372036854775807.' };
    const n = BigInt(t); if (n < -(2n ** 63n) || n > 2n ** 63n - 1n) return { ok: false, error: `long: ${t} is out of the 64-bit range.` };
    return { ok: true, value: n, display: String(n) };
  }
  if (result === 'F' || result === 'D') {
    const t = text.trim(), name = PRIMITIVES[result], special = { NaN: NaN, Infinity: Infinity, '+Infinity': Infinity, '-Infinity': -Infinity };
    let n; if (t in special) n = special[t]; else if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[fFdD]?$/.test(t)) n = Number(t.replace(/[fFdD]$/, '')); else return { ok: false, error: `${name}: use a number (1.5, -2e3, NaN, Infinity).` };
    if (result === 'F') { F32[0] = n; if (Number.isFinite(n) && !Number.isFinite(F32[0])) return { ok: false, error: 'float: value out of the float range.' }; return { ok: true, value: n !== n ? 0x7fc00000 : I32[0], display: t }; }
    if (n !== n) return { ok: true, value: 0x7ff8000000000000n, display: t };
    F64[0] = n; return { ok: true, value: B64[0], display: t };
  }
  if (result === 'Ljava/lang/String;') {
    if (text.trim() === 'null') return { ok: true, value: null, display: 'null' };
    const quoted = text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
    return { ok: true, value: quoted, display: JSON.stringify(quoted) };
  }
  if (typeof result === 'string' && (result[0] === 'L' || result[0] === '[')) {
    if (text.trim() === 'null') return { ok: true, value: null, display: 'null' };
    return { ok: false, error: `${smaliTypeToJava(result)}: only "null" is accepted for this reference type.` };
  }
  return { ok: false, error: 'Unknown return type.' };
}

// ---- the registry of method changes (CLAUDE.md: "method changes chosen by the user") ---------------------------------------------------------------------------------
// One registry per runtime holds every active change: the page's "Method returns" rows (owner { kind: 'page' }) and the plugins' lab.hook changes (owner { kind: 'plugin', id,
// name }, installed by src/method-hooks.js). Each change is a hook { id, key, kind, owner, hits, ... } on one resolved definition (smali key):
//   returns   a fixed return value (the body does not run)          throws   a fixed exception (the body does not run)
//   observe   the body runs unchanged; the call is recorded         smali    the body is replaced by code the user wrote (its own DEX, src/smali-assembler.js)
// At most one change per method. `rt.methodOverrides` is the dispatch table (key -> hook) of the active ones, null when there is none (the idle cost of the feature).
export const HOOK_KINDS = Object.freeze(['returns', 'throws', 'observe', 'smali']);
export const PAGE_OWNER = Object.freeze({ kind: 'page', id: 'page', name: 'Method returns' });
export function hookRegistry(rt) { return rt.methodHookRegistry ??= { seq: 0, hooks: new Map() }; }
/** Adds hooks (and removes the ids in `remove`) in one step: the dispatch table is rebuilt, the call sites that cached an affected method forget it, the core reroutes. */
export function updateHooks(rt, { add = [], remove = [] } = {}) {
  const registry = hookRegistry(rt), changed = new Set();
  for (const id of remove) { const hook = registry.hooks.get(id); if (hook) { registry.hooks.delete(id); changed.add(hook.key); } }
  for (const hook of add) { registry.hooks.set(hook.id, hook); changed.add(hook.key); }
  const table = new Map(); for (const hook of registry.hooks.values()) if (hook.active !== false) table.set(hook.key, hook);
  rt.methodOverrides = table.size ? table : null;
  rt.methodOverrideEpoch = (rt.methodOverrideEpoch ?? 0) + 1;
  if (changed.size) { resetCachedSites(rt, changed); rt.onMethodHooksChanged?.(); }   // the WebAssembly core routes the calls of these methods to the host (vmcore/js/host-bridge.js syncRouting)
  return changed;
}
/** The hook on `key`, if any. */
export function hookOn(rt, key) { for (const hook of rt.methodHookRegistry?.hooks.values() ?? []) if (hook.key === key) return hook; return null; }
const ownerText = owner => owner?.kind === 'plugin' ? `plugin "${owner.name}"` : 'the page (Method returns)';
/** What a hook does, in a few words (trace, Logcat, summary). */
export function hookDetail(hook) {
  switch (hook.kind) {
    case 'returns': return `= ${hook.display}`;
    case 'throws': return `throws ${hook.throwType}${hook.message === null || hook.message === undefined ? '' : ` "${String(hook.message).slice(0, 80)}"`}`;
    case 'observe': return 'observed';
    case 'smali': return `smali body (${hook.body?.units ?? 0} code units)`;
    default: return hook.kind;
  }
}

/**
 * Installs the override set of `rt`. `specs`: [{ method: 'Lpkg/C;->m()I' | Java form with a return type, value: '42', enabled: true }]. Returns one status per spec (same order):
 * { key, state: 'active' | 'disabled' | 'invalid' | 'missing' | 'refused', error?, hits }. 'missing': no class of the VM defines that method, so nothing can be replaced (the override stays installed in
 * case a class loader defines it later); 'refused': native methods are not replaced (their body is the app's native code). The rows are the page-owned hooks of the registry
 * (kind 'returns'); a method a plugin changed already is refused ('invalid', the conflict named).
 * Hit counters survive an update that keeps the same method and value. Every inline call-site cache that entered an affected method is reset (see the header).
 */
export function applyMethodOverrides(rt, specs) {
  const registry = hookRegistry(rt), previousAll = rt.methodOverridesAll ?? new Map(), nextAll = new Map(), statuses = [], add = [];
  const previousPage = new Map(); for (const hook of registry.hooks.values()) if (hook.owner.kind === 'page') previousPage.set(hook.key, hook);
  for (const spec of Array.isArray(specs) ? specs : []) {
    const parsed = parseMethodSpec(spec?.method);
    if (!parsed.ok) { statuses.push({ key: String(spec?.method ?? ''), state: 'invalid', error: parsed.error, hits: 0 }); continue; }
    if (parsed.result === null || parsed.key === null) { statuses.push({ key: String(spec?.method ?? ''), state: 'invalid', error: 'Enter the return type (e.g. package.Class.name(int): boolean).', hits: 0 }); continue; }
    if (parsed.name === '<clinit>') { statuses.push({ key: parsed.key, state: 'invalid', error: 'The static initializer (<clinit>) cannot be replaced.', hits: 0 }); continue; }
    const value = parseReturnValue(parsed.result, spec.value);
    if (!value.ok) { statuses.push({ key: parsed.key, state: 'invalid', error: value.error, hits: 0 }); continue; }
    const definition = rt.classes.get(parsed.owner)?.methods.get(parsed.name + parsed.key.slice(parsed.key.indexOf('(')));
    const known = nextAll.get(parsed.key); if (known) { statuses.push({ key: parsed.key, state: 'invalid', error: 'Method repeated in the list.', hits: known.hits }); continue; }
    const other = hookOn(rt, parsed.key); if (other && other.owner.kind !== 'page') { statuses.push({ key: parsed.key, state: 'invalid', error: `This method is already changed by ${ownerText(other.owner)} (${other.kind}); remove that change first.`, hits: 0 }); continue; }
    const old = previousAll.get(parsed.key), same = old && old.display === value.display && Object.is(old.value, value.value);
    const entry = { key: parsed.key, result: parsed.result, value: value.value, display: value.display, enabled: spec.enabled !== false, hits: same ? old.hits : 0, refusedNative: !!(definition && (definition.flags & 0x100)) };
    nextAll.set(parsed.key, entry);
    const state = entry.refusedNative ? 'refused' : !definition ? 'missing' : !entry.enabled ? 'disabled' : 'active';
    if (entry.enabled && !entry.refusedNative) {
      const was = previousPage.get(parsed.key), keep = was && same;
      const hook = keep ? was : { id: `page:${parsed.key}`, key: parsed.key, kind: 'returns', owner: PAGE_OWNER, result: parsed.result, value: value.value, display: value.display, hits: 0, createdAt: Date.now(), framework: false };
      hook.entry = entry; entry.hook = hook; if (keep) entry.hits = hook.hits; else hook.hits = entry.hits;
      add.push(hook);
    }
    statuses.push({ key: parsed.key, state, hits: entry.hits, ...(state === 'refused' ? { error: 'Native methods are not replaced: the body is the app\'s native code.' } : state === 'missing' ? { error: 'No loaded class defines this method; nothing will be replaced until it exists.' } : {}) });
  }
  const kept = new Set(add.filter(hook => previousPage.get(hook.key) === hook).map(hook => hook.id));
  const remove = [...previousPage.values()].filter(hook => !kept.has(hook.id)).map(hook => hook.id);
  for (const hook of add) if (!kept.has(hook.id)) rt.record(`HOOK ${hook.id} returns ${hook.key} ${hookDetail(hook)} by ${ownerText(hook.owner)}`);
  for (const id of remove) { const hook = registry.hooks.get(id); if (hook && !add.some(other => other.id === id)) rt.record(`UNHOOK ${id} ${hook.key} (${hook.hits} calls)`); }
  rt.methodOverridesAll = nextAll;
  updateHooks(rt, { remove: remove.filter(id => !kept.has(id)), add: add.filter(hook => !kept.has(hook.id)) });
  return statuses;
}

/**
 * Method interceptors: the same hook as the overrides, for device code that decides per call (src/microg-device.js: the entry points of microG's forbidden features). `rt.methodInterceptors`
 * (null while none is installed: the idle cost is the null test next to the overrides' one in dispatchCore) maps a resolved definition's key to `fn(rt, definition, args, mode)`, which
 * answers the call's value (the body does not run) or RUN_BODY (the body runs as usual). A call that went through an interceptor never fills an inline call-site cache, so every call of
 * the method reaches it again; the sites that cached it before are reset here. Calls inside the WebAssembly core reach it through the same routing as the overrides.
 */
export const RUN_BODY = Symbol('run the method body');
export function setMethodInterceptor(rt, key, fn) {
  const map = rt.methodInterceptors ?? new Map();
  if (fn) map.set(key, fn); else map.delete(key);
  rt.methodInterceptors = map.size ? map : null;
  resetCachedSites(rt, new Set([key])); rt.onMethodHooksChanged?.();
}
/** The keys whose calls the WebAssembly core must route through the host's dispatch: every active method change and every interceptor. */
export function hookedMethodKeys(rt) {
  const keys = new Set(rt.methodOverrides?.keys() ?? []);
  for (const key of rt.methodInterceptors?.keys() ?? []) keys.add(key);
  return keys;
}

/** Forgets every inline call-site cache entry that enters one of `keys`: the next call at those sites resolves again through dispatchCore (which answers the hook, or fills the cache again). */
function resetCachedSites(rt, keys) {
  for (const prog of rt.allProgs ?? []) {
    prog.refs.forEach(site => {
      if (site === undefined || site === null || site.callee === undefined || site.poly === undefined) return;   // not an invoke site
      let hit = site.callee !== null && keys.has(site.callee.method.key);
      if (!hit && site.poly !== null) for (const entry of site.poly.values()) if (keys.has(entry.callee.method.key)) { hit = true; break; }
      if (hit) { site.callee = null; site.calleeProg = null; site.type = null; site.poly = null; }
    });
  }
}

/** A call that changes behavior: the first one, then every 100th, is a Logcat warning (tag APKWebLab). */
function warnHit(rt, hook, hits) {
  if (hits !== 1 && hits % 100 !== 0) return;
  rt.record(hook.owner.kind === 'page' ? `LOG W APKWebLab: return replaced: ${hook.key} = ${hook.display} (${hits} calls)` : `LOG W APKWebLab: app modified by ${ownerText(hook.owner)}: ${hook.key} ${hookDetail(hook)} (${hits} calls)`);
}
/** Called by dispatchCore for an enabled override: counts the hit, writes the Logcat warning (first hit and every 100th) and returns the value. */
export function overrideHit(rt, entry, definition, mode) {
  if (mode === 'static') rt.initialize(definition.method.owner);   // class initialization semantics stay exact: a static call initializes its class before returning
  const hits = ++entry.hits; if (entry.entry) entry.entry.hits = hits;
  warnHit(rt, entry, hits);
  return entry.value;
}
/**
 * APKRuntime.dispatchCore found a hook on the resolved definition (`definition`, called with `args` in `mode`; `wantFrame`: an interpreter call site, which takes a PendingCall
 * or an Invoke). What each kind answers:
 *   returns  the value (overrideHit);   throws  the exception, thrown here;
 *   observe  the original body, run as usual: a PendingCall (no call-site cache is filled), or a BodyInvoke whose continuation records the value or exception and passes it on
 *            unchanged when the observer takes this call (src/method-hooks.js: the rate limit); from host code (no frame), the body runs nested and is recorded the same way;
 *   smali    the hook's body (its own DEX method and code item): a PendingCall of it, or a nested run from host code.
 * A static call initializes its class first, as the original call would.
 */
export function hookCall(rt, hook, definition, args, mode, wantFrame) {
  const kind = hook.kind;
  if (kind === 'returns') return overrideHit(rt, hook, definition, mode);
  if (mode === 'static') rt.initialize(definition.method.owner);
  const hits = ++hook.hits;
  if (kind === 'observe') {
    rt.recordMethod(definition.method);
    const observer = rt.methodHookObserver, call = observer ? observer.begin(rt, hook, definition, args, mode) : null;
    if (!wantFrame) {
      let value; try { value = rt.execute(definition.method, definition.code, args); } catch (error) { if (call !== null) observer.end(rt, call, undefined, error); throw error; }
      if (call !== null) observer.end(rt, call, value, null);
      return value;
    }
    const body = new PendingCall(definition.method, definition.code, args, null);
    if (call === null) return body;
    return new BodyInvoke(body, value => { observer.end(rt, call, value, null); return value; }, error => { observer.end(rt, call, undefined, error); throw error; });
  }
  warnHit(rt, hook, hits);
  if (kind === 'throws') return hook.raise(rt);
  if (kind === 'smali') {
    const body = hook.body; rt.recordMethod(body.method);
    if (args.length !== body.code.incoming) throw new Error(`smali body of ${hook.key}: ${args.length} argument words, the body takes ${body.code.incoming}`);
    return wantFrame ? new PendingCall(body.method, body.code, args, null) : rt.execute(body.method, body.code, args);
  }
  throw new Error(`Unknown method change kind: ${kind}`);
}

/** Current page overrides for the page / the report: [{ key, display, enabled, hits }]. */
export function describeMethodOverrides(rt) {
  return [...(rt.methodOverridesAll?.values() ?? [])].map(entry => ({ key: entry.key, value: entry.display, enabled: entry.enabled, hits: entry.hook?.hits ?? entry.hits }));
}
/** Lines for the Resumo: null when no change is active. The page's rows (Method returns) and the plugins' changes (App modified) each have their block. */
export function overrideSummaryLines(rt) {
  const active = [...(rt.methodOverrides?.values() ?? [])]; if (!active.length) return null;
  const page = active.filter(hook => hook.owner.kind === 'page'), plugins = active.filter(hook => hook.owner.kind !== 'page'), lines = [];
  if (page.length) {
    const calls = page.reduce((sum, hook) => sum + hook.hits, 0);
    lines.push(`Method returns REPLACED: ${page.length} methods, ${calls} calls (debugging tool; the bodies of these methods do not run)`);
    for (const hook of page.slice(0, 6)) lines.push(`  ${hook.key} = ${hook.display} (${hook.hits} calls)`);
    if (page.length > 6) lines.push(`  … and ${page.length - 6} more`);
  }
  if (plugins.length) {
    const calls = plugins.reduce((sum, hook) => sum + hook.hits, 0), byKind = HOOK_KINDS.map(kind => [kind, plugins.filter(hook => hook.kind === kind).length]).filter(([, n]) => n).map(([kind, n]) => `${n} ${kind}`);
    lines.push(`App modified by plugins: ${plugins.length} method changes (${byKind.join(', ')}), ${calls} calls (chosen by the user; listed on the page as "App modified")`);
    for (const hook of plugins.slice(0, 8)) lines.push(`  ${hook.kind} ${hook.key} ${hook.kind === 'observe' ? '' : hookDetail(hook) + ' '}(${hook.hits} calls${hook.dropped ? `, ${hook.dropped} not delivered` : ''}) · ${ownerText(hook.owner)}`);
    if (plugins.length > 8) lines.push(`  … and ${plugins.length - 8} more`);
  }
  return lines;
}

/** Methods of the APK's own DEX files (not the framework) whose smali form contains every word of `query`; at most `limit`. [{ key, owner, name, signature, result }] */
export function searchMethods(rt, query, limit = 50) {
  const words = String(query ?? '').toLowerCase().replaceAll('/', '.').split(/\s+/).filter(Boolean), out = [];
  if (!words.length) return out;
  const boot = rt.dex.bootDexes;
  for (const [owner, cls] of rt.classes) {
    if (boot?.has(cls.dex)) continue;
    const dotted = owner.slice(1, -1).replaceAll('/', '.').toLowerCase();
    for (const [nameSig, definition] of cls.methods) {
      const key = `${owner}->${nameSig}`, haystack = dotted + '.' + nameSig.toLowerCase().replaceAll('/', '.');
      if (!words.every(word => haystack.includes(word))) continue;
      out.push({ key, owner, name: definition.method.name, signature: definition.method.signature, result: definition.method.result, abstract: !definition.code, native: !!(definition.flags & 0x100) });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
/** The distinct smali keys of the APK's methods named `owner->name(params)` with any return type (to complete a Java-form spec). */
export function returnTypesOf(rt, owner, name, parameters) {
  const cls = rt.classes.get(owner), prefix = `${name}(${parameters.join('')})`, out = [];
  if (cls) for (const nameSig of cls.methods.keys()) if (nameSig.startsWith(prefix)) out.push(nameSig.slice(prefix.length));
  return out;
}
