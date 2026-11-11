// Method return overrides: a debugging tool. The tester names a method (smali form `Lpkg/Class;->name(Params)Ret`) and a return value; while the override is enabled, every call whose
// RESOLVED target definition is that method returns the value and the body does not run. Nothing is silent: each hit is counted, the first hit of an override and then every 100th is a
// Logcat warning (tag APKWebLab), the report summary lists the active overrides with their call counts, and the page shows the live count per row.
//
// Hook: APKRuntime.dispatchCore asks `rt.methodOverrides` (null while no override is enabled -- the whole cost of the feature when idle is that one null test on the uncached call path) once the
// target definition is resolved. Every call that is not served by an inline cache goes through dispatchCore (interpreted invoke-* of every kind, a call site that has not cached its callee yet,
// reflection, host code calling `runtime.dispatch`). Call sites that DID cache the callee (interpreter site.callee / site.poly, read by compiled callers, frameless getters and shapes) are
// reset by `applyMethodOverrides` for the methods whose override changed, so their next call goes through dispatchCore too; a call that dispatchCore answers with a value never fills a cache.
// Runs in the Worker and in Node tests: no DOM, no process.*.

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
  if (!text) return { ok: false, error: 'Informe o método.' };
  if (text.startsWith('L') && text.includes('->')) {
    const arrow = text.indexOf('->'), owner = text.slice(0, arrow);
    if (!/^L[^;\s]+;$/.test(owner) || !CLASS_PATH.test(owner.slice(1, -1))) return { ok: false, error: 'Classe inválida: use Lpacote/Classe; antes de "->".' };
    const open = text.indexOf('(', arrow), close = text.indexOf(')', open);
    if (open < 0 || close < 0) return { ok: false, error: 'Faltam os parênteses dos parâmetros: Lpkg/Classe;->nome(Params)Retorno.' };
    const name = text.slice(arrow + 2, open); if (!SIMPLE_NAME.test(name)) return { ok: false, error: `Nome de método inválido: "${name}".` };
    const parameters = smaliParameters(text.slice(open + 1, close)); if (!parameters) return { ok: false, error: 'Parâmetros inválidos: use tipos smali (I, Z, Ljava/lang/String;, [B...).' };
    const result = text.slice(close + 1), read = result === 'V' ? { type: 'V', end: 1 } : readSmaliType(result, 0);
    if (!read || read.end !== result.length) return { ok: false, error: 'Tipo de retorno inválido: use um tipo smali (V, Z, I, Ljava/lang/String;...).' };
    return finish(owner, name, parameters, result);
  }
  let rest = text, result = null;
  const prefix = /^([\w$.]+(?:\[\])*)\s+(?=[\w$.]+\s*\()/.exec(rest);
  if (prefix) { result = prefix[1]; rest = rest.slice(prefix[0].length); }
  const suffix = /\)\s*:\s*([\w$.]+(?:\[\])*)\s*$/.exec(rest);
  if (suffix) { if (result !== null) return { ok: false, error: 'Tipo de retorno informado duas vezes.' }; result = suffix[1]; rest = rest.slice(0, suffix.index + 1); }
  const match = /^([\w$.]+)\.([\w$<>]+)\s*\(([^)]*)\)$/.exec(rest.trim());
  if (!match) return { ok: false, error: 'Formato não reconhecido: use Lpkg/Classe;->nome(Params)Ret ou pacote.Classe.nome(tipos).' };
  const [, className, name, list] = match; if (!JAVA_CLASS.test(className) || !SIMPLE_NAME.test(name)) return { ok: false, error: 'Nome de classe ou método inválido.' };
  const parameters = [];
  for (const piece of list.split(',')) {
    const trimmed = piece.trim(); if (!trimmed) { if (list.trim()) return { ok: false, error: 'Parâmetro vazio na lista.' }; continue; }
    const smali = javaTypeToSmali(trimmed); if (!smali || smali === 'V') return { ok: false, error: `Tipo de parâmetro inválido: "${trimmed}".` };
    parameters.push(smali);
  }
  let smaliResult = null;
  if (result !== null) { smaliResult = javaTypeToSmali(result); if (!smaliResult) return { ok: false, error: `Tipo de retorno inválido: "${result}".` }; }
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
  if (result === 'Z') { const t = text.trim(); if (t === 'true') return { ok: true, value: 1, display: 'true' }; if (t === 'false') return { ok: true, value: 0, display: 'false' }; return { ok: false, error: 'boolean: use true ou false.' }; }
  if (result in INT_RANGES) {
    const t = text.trim(), [lo, hi] = INT_RANGES[result], name = PRIMITIVES[result];
    if (result === 'C' && /^'.'$/u.test(t) && t.length === 3) return { ok: true, value: t.charCodeAt(1), display: t };
    if (!/^[+-]?\d+$/.test(t)) return { ok: false, error: `${name}: use um inteiro entre ${lo} e ${hi}.` };
    const n = Number(t); if (!Number.isSafeInteger(n) || n < lo || n > hi) return { ok: false, error: `${name}: ${t} fora do intervalo ${lo} a ${hi}.` };
    return { ok: true, value: n, display: String(n) };
  }
  if (result === 'J') {
    const t = text.trim(); if (!/^[+-]?\d+$/.test(t)) return { ok: false, error: 'long: use um inteiro entre -9223372036854775808 e 9223372036854775807.' };
    const n = BigInt(t); if (n < -(2n ** 63n) || n > 2n ** 63n - 1n) return { ok: false, error: `long: ${t} fora do intervalo de 64 bits.` };
    return { ok: true, value: n, display: String(n) };
  }
  if (result === 'F' || result === 'D') {
    const t = text.trim(), name = PRIMITIVES[result], special = { NaN: NaN, Infinity: Infinity, '+Infinity': Infinity, '-Infinity': -Infinity };
    let n; if (t in special) n = special[t]; else if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[fFdD]?$/.test(t)) n = Number(t.replace(/[fFdD]$/, '')); else return { ok: false, error: `${name}: use um número (1.5, -2e3, NaN, Infinity).` };
    if (result === 'F') { F32[0] = n; if (Number.isFinite(n) && !Number.isFinite(F32[0])) return { ok: false, error: 'float: valor fora do intervalo de float.' }; return { ok: true, value: n !== n ? 0x7fc00000 : I32[0], display: t }; }
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
    return { ok: false, error: `${smaliTypeToJava(result)}: só "null" é aceito para este tipo de referência.` };
  }
  return { ok: false, error: 'Tipo de retorno desconhecido.' };
}

/**
 * Installs the override set of `rt`. `specs`: [{ method: 'Lpkg/C;->m()I' | Java form with a return type, value: '42', enabled: true }]. Returns one status per spec (same order):
 * { key, state: 'active' | 'disabled' | 'invalid' | 'missing' | 'refused', error?, hits }. 'missing': no class of the VM defines that method, so nothing can be replaced (the override stays installed in
 * case a class loader defines it later); 'refused': native methods are not replaced (their body is the app's native code).
 * Hit counters survive an update that keeps the same method and value. Every inline call-site cache that entered an affected method is reset (see the header).
 */
export function applyMethodOverrides(rt, specs) {
  const previous = rt.methodOverrides ?? new Map(), previousAll = rt.methodOverridesAll ?? new Map(), next = new Map(), nextAll = new Map(), statuses = [];
  for (const spec of Array.isArray(specs) ? specs : []) {
    const parsed = parseMethodSpec(spec?.method);
    if (!parsed.ok) { statuses.push({ key: String(spec?.method ?? ''), state: 'invalid', error: parsed.error, hits: 0 }); continue; }
    if (parsed.result === null || parsed.key === null) { statuses.push({ key: String(spec?.method ?? ''), state: 'invalid', error: 'Informe o tipo de retorno (ex.: pacote.Classe.nome(int): boolean).', hits: 0 }); continue; }
    if (parsed.name === '<clinit>') { statuses.push({ key: parsed.key, state: 'invalid', error: 'O inicializador estático (<clinit>) não pode ser substituído.', hits: 0 }); continue; }
    const value = parseReturnValue(parsed.result, spec.value);
    if (!value.ok) { statuses.push({ key: parsed.key, state: 'invalid', error: value.error, hits: 0 }); continue; }
    const definition = rt.classes.get(parsed.owner)?.methods.get(parsed.name + parsed.key.slice(parsed.key.indexOf('(')));
    const known = nextAll.get(parsed.key); if (known) { statuses.push({ key: parsed.key, state: 'invalid', error: 'Método repetido na lista.', hits: known.hits }); continue; }
    const old = previousAll.get(parsed.key), same = old && old.display === value.display && Object.is(old.value, value.value);
    const entry = { key: parsed.key, result: parsed.result, value: value.value, display: value.display, enabled: spec.enabled !== false, hits: same ? old.hits : 0, refusedNative: !!(definition && (definition.flags & 0x100)) };
    nextAll.set(parsed.key, entry);
    const state = entry.refusedNative ? 'refused' : !definition ? 'missing' : !entry.enabled ? 'disabled' : 'active';
    if (entry.enabled && !entry.refusedNative) next.set(parsed.key, entry);
    statuses.push({ key: parsed.key, state, hits: entry.hits, ...(state === 'refused' ? { error: 'Métodos native não são substituídos: o corpo é código nativo do app.' } : state === 'missing' ? { error: 'Nenhuma classe carregada define este método; nada será substituído até que exista.' } : {}) });
  }
  const changed = new Set();
  for (const [key, entry] of previous) { const now = next.get(key); if (!now || now.display !== entry.display || !Object.is(now.value, entry.value)) changed.add(key); }
  for (const key of next.keys()) if (!previous.has(key)) changed.add(key);
  rt.methodOverridesAll = nextAll;
  rt.methodOverrides = next.size ? next : null;
  rt.methodOverrideEpoch = (rt.methodOverrideEpoch ?? 0) + 1;
  if (changed.size) resetCachedSites(rt, changed);
  return statuses;
}

/** Forgets every inline call-site cache entry that enters one of `keys`: the next call at those sites resolves again through dispatchCore (which answers the override, or fills the cache again). */
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

/** Called by dispatchCore for an enabled override: counts the hit, writes the Logcat warning (first hit and every 100th) and returns the value. */
export function overrideHit(rt, entry, definition, mode) {
  if (mode === 'static') rt.initialize(definition.method.owner);   // class initialization semantics stay exact: a static call initializes its class before returning
  const hits = ++entry.hits;
  if (hits === 1 || hits % 100 === 0) rt.record(`LOG W APKWebLab: retorno substituído: ${entry.key} = ${entry.display} (${hits} chamadas)`);
  return entry.value;
}

/** Current overrides for the page / the report: [{ key, display, enabled, hits }]. */
export function describeMethodOverrides(rt) {
  return [...(rt.methodOverridesAll?.values() ?? [])].map(entry => ({ key: entry.key, value: entry.display, enabled: entry.enabled, hits: entry.hits }));
}
/** Lines for the Resumo: null when no override is installed and enabled. */
export function overrideSummaryLines(rt) {
  const active = [...(rt.methodOverrides?.values() ?? [])]; if (!active.length) return null;
  const calls = active.reduce((sum, entry) => sum + entry.hits, 0);
  const lines = [`Retornos substituídos: ${active.length} métodos, ${calls} chamadas (ferramenta de depuração; os corpos desses métodos não executam)`];
  for (const entry of active.slice(0, 6)) lines.push(`  ${entry.key} = ${entry.display} (${entry.hits} chamadas)`);
  if (active.length > 6) lines.push(`  … e mais ${active.length - 6}`);
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
