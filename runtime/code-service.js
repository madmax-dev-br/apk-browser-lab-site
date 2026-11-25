// The Worker side of the Code browser (docs/CODE-BROWSER.md): search, class tree, class information, smali, decompiled Java, the Java outline and APK files of the running VM, and the user's
// edits of APK files. The page asks through the Worker's "code-service" message (src/apk-worker.js, client src/apk-worker-client.js codeService).
//
//   - search(query, { kinds, limit, cursor, framework }): classes by name, methods and fields by name or signature (the ones a class of the DEX defines), string constants at
//     the const-string instructions that load them, and the APK's entries (assets/, res/ with the resource names the table gives each file, lib/, META-INF/, ...). Each call
//     works for at most SLICE_MS and answers what it found with a cursor to go on: a large APK (or the framework) is searched in steps, never in one long task;
//   - classTree(pkg): the packages and classes under a package (the app's DEX files, splits and code loaded at run time; the framework's under its own root);
//   - classInfo / disassemble / javaOutline: read from the DEX bytes by src/smali-disassembler.js and src/java-outline.js (no class record of the VM is built);
//   - decompile(descriptor): the class as Java (src/java-decompiler.js), with each line's dex pcs. Only on demand (the Java tab shows the class, a plugin or MCP asks):
//     the decompiler module is imported on the first request, a class is decompiled in steps of at most `sliceMs` (each call does one step and answers
//     { done: false, progress } until the text is ready; the caller asks again, or stops asking when the user leaves the class), and the results are kept for the
//     last CODE_LIMITS.decompileCache classes of this VM only (a new APK is a new VM: nothing kept; 'decompile-drop' forgets them, as the page does when the Code tab closes
//     with no debugger attached);
//   - readFile(path): text (UTF-8), binary XML decoded to XML, resources.arsc summarized, a .dex as its class list, an image's bytes, or a hex dump;
//   - checkSmali(method, text): what lab.hook({ smali }) would say of a method body, with line and column (the edit itself goes through src/method-hooks.js from the page);
//   - editFile / revertFile / fileEdits: a user change to an APK entry, kept on the installed copy of this VM: the app reads the edited bytes the next time it reads the
//     entry (AssetManager.open, Resources.openRawResource, ClassLoader.getResource and every reader of runtime.apkReader). Already-read data (a decoded bitmap or typeface,
//     a cached string) keeps what was read before; the page re-applies the edits when the APK is opened again (Reopen), before the app's code runs. Every edit is listed on
//     the page as "App modified", recorded in the trace (EDIT FILE / UNEDIT FILE) and in the diagnostics summary (src/report-summary.js entryEditLines), and removable.
// Runs in the Worker and in Node tests: no DOM, no process.*.
import { APKError } from './apk-error.js?v=746332660dea';
import { DexFile } from './apk-runtime.js?v=746332660dea';
import { readClassModel, disassembleClass, accessFlagsText, valueText, decodeInstruction, instructionUnits, smaliOfMethod } from './smali-disassembler.js?v=746332660dea';
import { javaOutline } from './java-outline.js?v=746332660dea';
import { checkSmaliBody, listMethodHooks } from './method-hooks.js?v=746332660dea';

export const CODE_LIMITS = Object.freeze({ decompileCache: 4, decompileLines: 400000, sliceMs: 30, results: 200, textBytes: 4 * 1024 * 1024, hexBytes: 64 * 1024, editBytes: 8 * 1024 * 1024, edits: 200, queryChars: 200, dexListClasses: 200000 });
const KINDS = ['class', 'method', 'field', 'string', 'file'];
const now = () => globalThis.performance?.now?.() ?? Date.now();
const dotted = descriptor => descriptor.startsWith('L') && descriptor.endsWith(';') ? descriptor.slice(1, -1).replaceAll('/', '.') : descriptor;
const fail = (code, message) => Object.assign(new APKError(message), { code });

// ---- the decompiler: imported on its first use only ------------------------------------------------------------------------------------------------------------------
let decompilerModule = null, decompilerLoading = null;
/** Imports src/java-decompiler.js (once). */
export function loadDecompiler() { if (decompilerModule) return Promise.resolve(decompilerModule); decompilerLoading ??= import('./java-decompiler.js?v=746332660dea').then(m => (decompilerModule = m)); return decompilerLoading; }
/** True once the decompiler module was imported (tests check that nothing imports it before the Java view asks). */
export const decompilerLoaded = () => decompilerModule !== null;

// ---- the DEX files of the VM ------------------------------------------------------------------------------------------------------------------------------------------
/** [{ dex, filename, framework, dynamic }]: the app's DEX files (base and splits) first, then the code loaded at run time, then the framework's. */
export function dexFilesOf(rt) {
  const program = rt?.dex; if (!program) return [];
  return [...(program.files ?? []).map(f => ({ dex: f.dex, filename: f.filename, framework: false, dynamic: false })),
    ...(program.dynamicFiles ?? []).map(f => ({ dex: f.dex, filename: f.filename ?? f.dex?.filename ?? 'dynamic.dex', framework: false, dynamic: true })),
    ...(program.bootFiles ?? []).map(f => ({ dex: f.dex, filename: f.filename, framework: true, dynamic: false }))].filter(f => f.dex instanceof DexFile);
}
/** The DEX file that defines `descriptor` (the app's definition first, as the class path finds it). */
function fileOf(rt, descriptor) {
  for (const file of dexFilesOf(rt)) if (file.dex.classes.names.has(descriptor)) return file;
  return null;
}
/** A string of a DEX decoded without being kept in the DEX's cache (a search reads many strings once). */
function rawString(dex, i) {
  const b = dex.reader, c = { p: b.u32(dex.stringIdsOffset + i * 4) }; b.uleb(c);
  const bytes = b.bytes; let p = c.p, out = '', chunk = [];
  for (; p < bytes.length; p++) {
    const a = bytes[p]; if (!a) break;
    if (a < 0x80) chunk.push(a);
    else if ((a & 0xe0) === 0xc0) { chunk.push(((a & 31) << 6) | (bytes[++p] & 63)); }
    else { chunk.push(((a & 15) << 12) | ((bytes[p + 1] & 63) << 6) | (bytes[p + 2] & 63)); p += 2; }
    if (chunk.length >= 4096) { out += String.fromCharCode(...chunk); chunk = []; }
  }
  return out + String.fromCharCode(...chunk);
}
const cached = (dex, i) => dex.strings[i] ?? rawString(dex, i);
/** class_data of class_def `i` as [{ index (method id), flags, codeOff }] for its methods (direct then virtual), without building a record. */
function classMethods(dex, i) {
  const b = dex.reader, dataOff = b.u32(dex.classDefsOffset + i * 32 + 24); if (!dataOff) return [];
  const c = { p: dataOff }, ns = b.uleb(c), ni = b.uleb(c), nd = b.uleb(c), nv = b.uleb(c), out = [];
  for (let k = 0; k < ns + ni; k++) { b.uleb(c); b.uleb(c); }
  for (const count of [nd, nv]) { let idx = 0; for (let k = 0; k < count; k++) { idx += b.uleb(c); const flags = b.uleb(c), codeOff = b.uleb(c); out.push({ index: idx, flags, codeOff }); } }
  return out;
}

// ---- the service ----------------------------------------------------------------------------------------------------------------------------------------------------
/** The service of one VM (kept on the runtime: a new VM gets a new one). */
export function codeService(rt) {
  if (!rt) throw fail('no-apk', 'No APK is running.');
  if (rt.codeService) return rt.codeService;
  const S = { search: null, tree: null, entryAliases: null, decompiled: new Map() };
  const service = {
    search: (query, options) => search(rt, S, query, options),
    classTree: (pkg, options) => classTree(rt, S, pkg, options),
    classInfo: descriptor => classInfo(rt, descriptor),
    disassemble: (descriptor, options) => disassemble(rt, descriptor, options),
    javaOutline: descriptor => outline(rt, descriptor),
    decompile: (descriptor, options) => decompile(rt, S, descriptor, options),
    dropDecompiled: () => { const n = S.decompiled.size; S.decompiled.clear(); return { dropped: n }; },
    readFile: (path, options) => readFile(rt, path, options),
    checkSmali: (method, text) => checkSmali(rt, method, text),
    editFile: (path, text, options) => editFile(rt, path, text, options),
    revertFile: path => revertFile(rt, path),
    fileEdits: () => fileEdits(rt),
    files: () => fileList(rt, S).map(entry => ({ path: entry.path, size: entry.size, aliases: entry.aliases, edited: !!rt.entryEdits?.has(entry.path) })),
  };
  Object.defineProperty(rt, 'codeService', { value: service, configurable: true });
  return service;
}

/** One operation of the Worker's "code-service" message (src/apk-worker.js): op 'search' | 'class-tree' | 'class-info' | 'disassemble' | 'java-outline' | 'decompile' |
 *  'decompile-drop' | 'decompile-load' | 'read-file' | 'check-smali' | 'edit-file' | 'revert-file' | 'file-edits' | 'files' with its `args`; returns the operation's value
 *  or throws (with `code`). 'decompile' and 'decompile-load' return a promise the first time (the decompiler module is imported then); every other call is synchronous. */
export function runCodeService(rt, op, args) {
  const svc = codeService(rt), a = args && typeof args === 'object' ? args : {};
  switch (op) {
    case 'search': return svc.search(a.query, a);
    case 'class-tree': return svc.classTree(a.package ?? '', a);
    case 'class-info': return svc.classInfo(a.descriptor);
    case 'disassemble': return svc.disassemble(a.descriptor, a);
    case 'java-outline': return svc.javaOutline(a.descriptor);
    case 'decompile': return decompilerModule ? svc.decompile(a.descriptor, a) : loadDecompiler().then(() => svc.decompile(a.descriptor, a));
    case 'decompile-load': return decompilerModule ? { loaded: true } : loadDecompiler().then(() => ({ loaded: true }));
    case 'decompile-drop': return svc.dropDecompiled();
    case 'read-file': return svc.readFile(a.path, a);
    case 'check-smali': return svc.checkSmali(a.method, a.smali);
    case 'edit-file': return svc.editFile(a.path, a.text, { by: a.by ?? 'Code browser', bytes: a.bytes instanceof Uint8Array ? a.bytes : null });
    case 'revert-file': return svc.revertFile(a.path);
    case 'file-edits': return { edits: svc.fileEdits() };
    case 'files': return { files: svc.files() };
  }
  throw fail('bad-args', `Unknown code-service operation: ${String(op).slice(0, 40)}`);
}

// ---- search ---------------------------------------------------------------------------------------------------------------------------------------------------------
/** The words of a query, lower case, '/' as '.'; a word in descriptor form (Lpkg/Name;) is matched as the dotted name. */
function words(query) {
  return String(query ?? '').slice(0, CODE_LIMITS.queryChars).split(/\s+/).filter(Boolean)
    .map(w => (/^L[\w$]+\//.test(w) ? w.slice(1).replace(/;$/, '') : w).toLowerCase().replaceAll('/', '.'));
}
const matches = (haystack, list) => { for (const w of list) if (!haystack.includes(w)) return false; return true; };
/**
 * One step of a search: { results: [{ kind, ... }], cursor (pass it back for more; null when the search is complete), ms }. `kinds`: any of class, method, field, string,
 * file (all by default); `framework`: also search the framework's DEX files (marked framework: true). Results of a kind come in the order of the files, never re-sorted
 * across steps; a class whose simple name starts with the query comes first within a step.
 */
function search(rt, S, query, { kinds = KINDS, limit = 100, cursor = null, framework = true, sliceMs = CODE_LIMITS.sliceMs } = {}) {
  const list = words(query), wanted = KINDS.filter(kind => kinds.includes(kind)), started = now(), results = [], max = Math.max(1, Math.min(CODE_LIMITS.results, Number(limit) || 100));
  if (!list.length || !wanted.length) return { results, cursor: null, ms: 0 };
  const key = `${list.join(' ')}|${wanted.join(',')}|${framework}`;
  if (!S.search || S.search.key !== key || !cursor) S.search = { key, strings: new Map() };
  const files = dexFilesOf(rt).filter(f => framework || !f.framework);
  let at = cursor && cursor.key === key ? { ...cursor } : { key, kind: 0, file: 0, i: 0, phase: 0 };
  const out = () => ({ results, cursor: at, ms: Math.round((now() - started) * 10) / 10 });
  const timeUp = () => results.length >= max || now() - started > sliceMs;
  const joined = list.join(' ');
  while (at.kind < wanted.length) {
    const kind = wanted[at.kind];
    if (kind === 'file') {
      const entries = fileList(rt, S);
      for (; at.i < entries.length; at.i++) {
        if ((at.i & 255) === 0 && timeUp()) return out();
        const entry = entries[at.i]; if (!matches(entry.haystack, list)) continue;
        results.push({ kind: 'file', path: entry.path, size: entry.size, aliases: entry.aliases, edited: !!rt.entryEdits?.has(entry.path) });
        if (results.length >= max) { at.i++; return out(); }
      }
      at = { key, kind: at.kind + 1, file: 0, i: 0, phase: 0 }; continue;
    }
    if (at.file >= files.length) { at = { key, kind: at.kind + 1, file: 0, i: 0, phase: 0 }; continue; }
    const { dex, filename, framework: isFramework } = files[at.file], names = dex.classes.names, b = dex.reader;
    const next = () => { at = { key, kind: at.kind, file: at.file + 1, i: 0, phase: 0 }; };
    if (kind === 'class') {
      const types = [...names.keys()];   // the class_def order (cheap: the names are read at load)
      const step = [];
      for (; at.i < types.length; at.i++) {
        if ((at.i & 1023) === 0 && timeUp()) break;
        const type = types[at.i], name = dotted(type).toLowerCase();
        if (!matches(name, list)) continue;
        const simple = name.slice(name.lastIndexOf('.') + 1);
        step.push({ kind: 'class', descriptor: type, name: dotted(type), framework: isFramework, file: filename, rank: simple.startsWith(joined) ? 0 : simple.includes(joined) ? 1 : 2 });
        if (results.length + step.length >= max) { at.i++; break; }
      }
      step.sort((a, b2) => a.rank - b2.rank); for (const item of step) { delete item.rank; results.push(item); }
      if (at.i >= types.length) next();
      if (timeUp()) return out();
      continue;
    }
    if (kind === 'method' || kind === 'field') {
      const isMethod = kind === 'method', count = isMethod ? dex.methods.length : dex.fields.length, base = isMethod ? dex.methodIdsOffset : dex.fieldIdsOffset;
      const nameCache = new Map();
      for (; at.i < count; at.i++) {
        if ((at.i & 1023) === 0 && timeUp()) return out();
        const p = base + at.i * 8, owner = dex.types[b.u16(p)]; if (!names.has(owner)) continue;
        const nameIndex = b.u32(p + 4); let name = nameCache.get(nameIndex); if (name === undefined) { name = cached(dex, nameIndex); nameCache.set(nameIndex, name); }
        const extra = isMethod ? dex.proto(b.u16(p + 2)).signature : `:${dex.types[b.u16(p + 2)]}`;
        const haystack = `${dotted(owner)}.${name}${extra}`.toLowerCase().replaceAll('/', '.');
        if (!matches(haystack, list)) continue;
        results.push(isMethod ? { kind: 'method', descriptor: owner, name, signature: extra, key: `${owner}->${name}${extra}`, framework: isFramework, file: filename }
          : { kind: 'field', descriptor: owner, name, type: extra.slice(1), key: `${owner}->${name}${extra}`, framework: isFramework, file: filename });
        if (results.length >= max) { at.i++; return out(); }
      }
      next(); continue;
    }
    // strings: phase 0 finds the matching strings of this DEX, phase 1 walks the classes' code for the const-string instructions that load them
    let state = S.search.strings.get(at.file);
    if (!state) S.search.strings.set(at.file, state = { matched: new Set(), next: 0 });
    if (at.phase === 0) {
      const count = dex.strings.length;
      for (; state.next < count; state.next++) {
        if ((state.next & 1023) === 0 && timeUp()) { at.i = state.next; return out(); }
        if (matches(cached(dex, state.next).toLowerCase(), list)) state.matched.add(state.next);
      }
      at.phase = 1; at.i = 0; at.m = 0;
      if (!state.matched.size) { next(); continue; }
    }
    const types = [...names.keys()];
    for (; at.i < types.length; at.i++) {
      if (timeUp()) return out();
      const defIndex = names.get(types[at.i]);
      const methods = classMethods(dex, defIndex);
      for (; (at.m ?? 0) < methods.length; at.m = (at.m ?? 0) + 1) {
        const m = methods[at.m]; if (!m.codeOff) continue;
        const size = b.u32(m.codeOff + 12), start = m.codeOff + 16;
        for (let pc = 0; pc < size;) {
          const w = b.u16(start + pc * 2), op = w & 0xff;
          if (op === 0x1a || op === 0x1b) {
            const index = op === 0x1a ? b.u16(start + pc * 2 + 2) : (b.u16(start + pc * 2 + 2) | (b.u16(start + pc * 2 + 4) << 16)) >>> 0;
            if (state.matched.has(index)) {
              const method = dex.method(m.index);
              results.push({ kind: 'string', value: dex.string(index), descriptor: types[at.i], method: method.name, signature: method.signature, key: `${types[at.i]}->${method.name}${method.signature}`, pc, framework: isFramework, file: filename });
            }
          }
          pc += op === 0 ? unitsAt(b, start, pc) : unitsOfOp(op);
        }
        if (results.length >= max) { at.m++; return out(); }
      }
      at.m = 0;
    }
    next();
  }
  return { results, cursor: null, ms: Math.round((now() - started) * 10) / 10 };
}
const OP_UNITS = new Uint8Array(256);
{ const fake = new Uint16Array(6); for (let op = 0; op < 256; op++) { fake[0] = op; OP_UNITS[op] = op === 0 ? 1 : instructionUnits(fake, 0); } }
const unitsOfOp = op => OP_UNITS[op];
function unitsAt(b, start, pc) { const view = new Uint16Array(4); for (let i = 0; i < 4; i++) { try { view[i] = b.u16(start + (pc + i) * 2); } catch { view[i] = 0; } } return instructionUnits(view, 0); }

// ---- APK entries --------------------------------------------------------------------------------------------------------------------------------------------------
/** [{ path, size, aliases, haystack }] of the APK's entries; a res/ file lists the resource names the table gives it (res/a.xml -> layout/main). */
function fileList(rt, S) {
  if (S.files) return S.files;
  const aliases = new Map();
  try {
    for (const variants of rt.resources?.table?.entries?.values?.() ?? []) for (const entry of variants) {
      if (entry.kind === 'string' && typeof entry.value === 'string' && entry.value.startsWith('res/')) { let list = aliases.get(entry.value); if (!list) aliases.set(entry.value, list = []); const name = `${entry.resourceType}/${entry.name}`; if (!list.includes(name)) list.push(name); }
    }
  } catch { /* no table: the paths alone */ }
  const sizes = rt.codeEntrySizes ?? null;
  S.files = [...(rt.apkEntries ?? [])].sort().map(path => { const list = aliases.get(path) ?? []; return { path, size: sizes?.get(path) ?? null, aliases: list, haystack: `${path} ${list.join(' ')}`.toLowerCase().replaceAll('/', '.') }; });
  return S.files;
}

// ---- class tree -----------------------------------------------------------------------------------------------------------------------------------------------------
/** The packages and classes directly under `pkg` ('' = the root; 'framework:' prefixes the framework's tree): { package, packages: [{ name, path, count }], classes: [{ descriptor, name, framework, file }] }. */
function classTree(rt, S, pkg = '', { framework = false } = {}) {
  if (!S.tree) {
    S.tree = { app: new Map(), framework: new Map() };
    for (const { dex, filename, framework: isFramework } of dexFilesOf(rt)) {
      const tree = isFramework ? S.tree.framework : S.tree.app;
      for (const type of dex.classes.names.keys()) {
        if (!type.startsWith('L')) continue;
        const body = type.slice(1, -1), slash = body.lastIndexOf('/'), packageName = slash < 0 ? '' : body.slice(0, slash);
        let node = tree.get(packageName); if (!node) tree.set(packageName, node = { classes: [], subs: new Map(), count: 0 });
        if (!node.classes.some(c => c.descriptor === type)) node.classes.push({ descriptor: type, name: body.slice(slash + 1), framework: isFramework, file: filename });
        // the package's ancestors know it, with the number of classes below them
        let child = packageName;
        while (child) {
          const cut = child.lastIndexOf('/'), parent = cut < 0 ? '' : child.slice(0, cut);
          let up = tree.get(parent); if (!up) tree.set(parent, up = { classes: [], subs: new Map(), count: 0 });
          up.subs.set(child, (up.subs.get(child) ?? 0) + 1);
          child = parent;
        }
      }
    }
    for (const tree of [S.tree.app, S.tree.framework]) for (const node of tree.values()) node.classes.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }
  const tree = framework ? S.tree.framework : S.tree.app, key = String(pkg ?? '').replaceAll('.', '/').replace(/^\/+|\/+$/g, ''), node = tree.get(key);
  if (!node) return { package: key, packages: [], classes: [], framework };
  return { package: key, framework, packages: [...node.subs].map(([path, count]) => ({ name: path.slice(path.lastIndexOf('/') + 1), path, count })).sort((a, b) => a.name < b.name ? -1 : 1), classes: node.classes };
}

// ---- classes --------------------------------------------------------------------------------------------------------------------------------------------------------
function modelOf(rt, descriptor) {
  const type = String(descriptor ?? '');
  const file = fileOf(rt, type); if (!file) throw fail('no-class', `Class not found in the DEX files: ${dotted(type) || '(none)'}`);
  return { file, model: readClassModel(file.dex, type) };
}
const hookedKeys = rt => new Map(listMethodHooks(rt).map(hook => [hook.method, hook]));
/** Superclass, interfaces, flags, source, annotations, fields (with values) and methods (with signatures) of a class. */
function classInfo(rt, descriptor) {
  const { file, model } = modelOf(rt, descriptor), dex = model.dex, hooks = hookedKeys(rt);
  const annotationText = a => `${a.visibility} ${a.type}${a.elements.length ? ` (${a.elements.map(e => `${e.name} = ${valueText(dex, e.value).replace(/\s+/g, ' ')}`).join(', ')})` : ''}`;
  const field = (f, isStatic) => ({ name: f.name, type: f.type, flags: accessFlagsText(f.flags, 'f').trim(), static: isStatic, value: f.value ? valueText(dex, f.value).replace(/\s+/g, ' ') : null, annotations: f.annotations.map(annotationText), key: `${model.type}->${f.name}:${f.type}` });
  const method = (m, direct) => {
    const signature = `(${m.parameters.join('')})${m.result}`, key = `${model.type}->${m.name}${signature}`;
    return { name: m.name, signature, key, flags: accessFlagsText(m.flags, 'm').trim(), direct, hasCode: !!m.code, native: !!(m.flags & 0x100), abstract: !!(m.flags & 0x400),
      registers: m.code?.registers ?? 0, units: m.code?.units.length ?? 0, tries: m.code?.tries.length ?? 0, annotations: m.annotations.map(annotationText), modified: hooks.get(key)?.kind ?? null };
  };
  return { descriptor: model.type, name: dotted(model.type), file: file.filename, framework: file.framework, dynamic: file.dynamic, flags: accessFlagsText(model.flags, 'c').trim(),
    superclass: model.superclass, interfaces: model.interfaces, source: model.source, annotations: model.annotations.map(annotationText),
    fields: [...model.staticFields.map(f => field(f, true)), ...model.instanceFields.map(f => field(f, false))],
    methods: [...model.directMethods.map(m => method(m, true)), ...model.virtualMethods.map(m => method(m, false))] };
}
/** Accepts 'name(sig)ret', a full key 'Lc;->name(sig)ret', or { name, signature }. */
function methodSpec(descriptor, method) {
  if (!method) return null;
  if (typeof method === 'object') return { name: String(method.name ?? ''), signature: String(method.signature ?? '') };
  const text = String(method), body = text.includes('->') ? text.slice(text.indexOf('->') + 2) : text, open = body.indexOf('(');
  return open < 0 ? { name: body, signature: null } : { name: body.slice(0, open), signature: body.slice(open) };
}
/**
 * The smali of a class: { descriptor, file, framework, text, lineCount, pcOfLine, methodOfLine, methods: [{ name, signature, key, flags, startLine, endLine, hasCode, registers,
 * units, pcToLine, direct, modified }] }; with `method`, also { method: { index, key, text } } -- that method alone, the text the method editor starts from.
 */
function disassemble(rt, descriptor, { method = null } = {}) {
  const { file, model } = modelOf(rt, descriptor), out = disassembleClass(model.dex, model), hooks = hookedKeys(rt);
  const methods = out.methods.map(m => ({ name: m.name, signature: m.signature, key: m.key, flags: accessFlagsText(m.flags, 'm').trim(), startLine: m.startLine, endLine: m.endLine,
    hasCode: m.hasCode, registers: m.registers, units: m.units, pcToLine: m.pcToLine, direct: m.direct, modified: hooks.get(m.key)?.kind ?? null }));
  const result = { descriptor: model.type, name: dotted(model.type), file: file.filename, framework: file.framework, text: out.text, lineCount: out.lineCount, pcOfLine: out.pcOfLine, methodOfLine: out.methodOfLine, methods };
  const wanted = methodSpec(model.type, method);
  if (wanted) {
    const index = methods.findIndex(m => m.name === wanted.name && (wanted.signature === null || m.signature === wanted.signature || m.signature.startsWith(wanted.signature)));
    if (index < 0) throw fail('no-method', `Method not found: ${dotted(model.type)}.${wanted.name}${wanted.signature ?? ''}`);
    const record = [...model.directMethods, ...model.virtualMethods].find(m => m.name === methods[index].name && `(${m.parameters.join('')})${m.result}` === methods[index].signature);
    result.method = { index, key: methods[index].key, text: smaliOfMethod(model.dex, model.type, record).text };
  }
  return result;
}
/**
 * One step of the Java view of a class: { done: false, descriptor, progress: { done, total } } while it is being decompiled (call again), then { done: true, descriptor, name,
 * file, framework, text, lineCount, pcsOfLine (per line: null or [methodKey, firstPc, ...pcs]), lineOfPc ({ methodKey: { pc: line } }), methodOfLine, methods: [{ key, name,
 * signature, startLine, endLine, ok, fallback, reason, modified }], stats } (lines 0-based). Synchronous: the module is loaded (runCodeService loads it first).
 */
function decompile(rt, S, descriptor, { sliceMs = CODE_LIMITS.sliceMs } = {}) {
  const { createDecompileJob } = decompilerModule;
  const type = String(descriptor ?? ''), hooks = hookedKeys(rt), modified = new Set([...hooks.keys()].filter(key => key.startsWith(`${type}->`)));
  const stamp = [...modified].sort().join('|');
  let entry = S.decompiled.get(type);
  if (entry && entry.stamp !== stamp) { S.decompiled.delete(type); entry = null; }
  if (!entry) {
    const { file, model } = modelOf(rt, type);
    entry = { stamp, file, model, job: createDecompileJob(model, { modified }), result: null };
  }
  S.decompiled.delete(type); S.decompiled.set(type, entry);   // most recent last
  if (!entry.result) {
    entry.job.step(Math.max(1, Math.min(200, Number(sliceMs) || CODE_LIMITS.sliceMs)));
    if (!entry.job.done) { trimDecompiled(S); return { done: false, descriptor: entry.model.type, progress: entry.job.progress }; }
    const out = entry.job.result();
    entry.result = { done: true, descriptor: entry.model.type, name: dotted(entry.model.type), file: entry.file.filename, framework: entry.file.framework, text: out.text, lineCount: out.lineCount,
      pcsOfLine: out.pcsOfLine, lineOfPc: out.lineOfPc, methodOfLine: out.methodOfLine, typeRefs: out.typeRefs, methods: out.methods.map(m => ({ ...m, modified: hooks.get(m.key)?.kind ?? null })), stats: out.stats };
    entry.lines = out.lineCount; entry.job = null; entry.model = null;
  }
  trimDecompiled(S);
  return entry.result;
}
/** The decompiled classes kept: the last CODE_LIMITS.decompileCache, and fewer when they are big. */
function trimDecompiled(S) {
  let lines = 0; for (const e of S.decompiled.values()) lines += e.lines ?? 0;
  while (S.decompiled.size > CODE_LIMITS.decompileCache || (S.decompiled.size > 1 && lines > CODE_LIMITS.decompileLines)) { const [first, e] = S.decompiled.entries().next().value; lines -= e.lines ?? 0; S.decompiled.delete(first); }
}
function outline(rt, descriptor) {
  const { file, model } = modelOf(rt, descriptor), out = javaOutline(model);
  return { descriptor: model.type, name: dotted(model.type), file: file.filename, framework: file.framework, kind: 'outline', text: out.text, methodOfLine: out.methodOfLine, methods: out.methods };
}

// ---- smali check ----------------------------------------------------------------------------------------------------------------------------------------------------
/** The column (1-based) an error message points at in its line: a quoted token or a register / label it names, else the first non-blank character. */
export function errorColumn(lineText, message) {
  const text = String(lineText ?? ''), candidates = [];
  for (const m of String(message).matchAll(/"([^"]{1,80})"/g)) candidates.push(m[1]);
  for (const m of String(message).matchAll(/(?:^|[\s(,])((?:[vp]\d+)|(?::[\w$-]+)|(?:L[\w/$-]+;(?:->[\w$<>]+(?:\([^)]*\)\S*|:\S+))?))/g)) candidates.push(m[1]);
  for (const candidate of candidates) { const at = text.indexOf(candidate); if (at >= 0) return at + 1; }
  const first = text.search(/\S/); return first < 0 ? 1 : first + 1;
}
function checkSmali(rt, method, text) {
  try {
    const out = checkSmaliBody(rt, { method: String(method ?? ''), smali: text });
    return { ok: true, errors: [], ...out };
  } catch (error) {
    const lines = String(text ?? '').split(/\r?\n/);
    const errors = Array.isArray(error?.errors) && error.errors.length ? error.errors.map(e => ({ line: e.line ?? 0, column: e.line ? errorColumn(lines[e.line - 1], e.message) : 1, message: e.message }))
      : [{ line: 0, column: 1, message: String(error?.message ?? error) }];
    return { ok: false, code: error?.code ?? 'failed', message: String(error?.message ?? error), errors };
  }
}

// ---- files ----------------------------------------------------------------------------------------------------------------------------------------------------------
const IMAGE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon' };
const isBinaryXml = bytes => bytes.length >= 8 && bytes[0] === 0x03 && bytes[1] === 0x00 && bytes[2] === 0x08 && bytes[3] === 0x00;
function entryBytes(rt, path) {
  if (!rt.apkEntries?.has(path)) throw fail('no-file', `No such APK entry: ${path}`);
  if (typeof rt.apkReader !== 'function') throw fail('unsupported', 'The APK entries cannot be read in this VM');
  return rt.apkReader(path);
}
/** Why `path` cannot be edited (null when it can): binary XML, the resource table, DEX code (changed through Edit method), native libraries, the signature files. */
export function editRefusal(path, bytes = null) {
  if (/^classes\d*\.dex$/.test(path) || path.endsWith('.dex')) return 'DEX code is changed one method at a time (Edit method), so the change is listed, counted and removable';
  if (path === 'resources.arsc') return 'the resource table is compiled binary data; edit the files it points to';
  if (path === 'AndroidManifest.xml' || (bytes && isBinaryXml(bytes))) return 'compiled (binary) XML is read once at load and needs a compiler to write; it is shown decoded, read-only';
  if (path.startsWith('lib/') || path.endsWith('.so')) return 'native libraries are native code; the lab does not change an app\'s native code';
  if (path.startsWith('META-INF/')) return 'the signature files describe the original APK';
  return null;
}
const decoder = new TextDecoder('utf-8', { fatal: true });
function asText(bytes) {
  if (bytes.length > CODE_LIMITS.textBytes) return null;
  let text; try { text = decoder.decode(bytes); } catch { return null; }
  let control = 0; for (let i = 0; i < Math.min(text.length, 65536); i++) { const c = text.charCodeAt(i); if (c === 0 || (c < 0x20 && c !== 9 && c !== 10 && c !== 13 && c !== 12)) control++; }
  return control > Math.min(text.length, 65536) / 100 ? null : text;
}
function hexDump(bytes, limit = CODE_LIMITS.hexBytes) {
  const lines = [], n = Math.min(bytes.length, limit);
  for (let at = 0; at < n; at += 16) {
    const row = bytes.subarray(at, Math.min(n, at + 16));
    lines.push(`${at.toString(16).padStart(8, '0')}  ${[...row].map(b => b.toString(16).padStart(2, '0')).join(' ').padEnd(47)}  ${[...row].map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.').join('')}`);
  }
  if (bytes.length > n) lines.push(`… ${bytes.length - n} more bytes`);
  return lines.join('\n');
}
const xmlEscape = (text, attribute = true) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(attribute ? /"/g : /$^/, '&quot;');
/** Binary XML (the manifest, res/ XML) as readable XML: element and attribute names, raw strings as written, typed values as aapt2 dump writes them. */
export function binaryXmlText(rt, bytes) {
  const table = rt.resources?.table, frameworkTable = rt.resources?.frameworkTable;
  const tree = (table ?? frameworkTable)?.parseLayout?.(bytes); if (!tree) throw fail('unsupported', 'No resource table to decode binary XML with');
  const nameOf = id => {
    for (const t of [table, frameworkTable]) { const variants = t?.entries?.get?.(id >>> 0); if (variants?.length) { const e = variants[0]; return `${e.packageName === 'android' || (id >>> 24) === 1 ? 'android:' : ''}${e.resourceType}/${e.name}`; } }
    return null;
  };
  const value = a => {
    if (a.rawValue !== null && a.rawValue !== undefined) return a.rawValue;
    switch (a.kind) {
      case 'reference': { const n = nameOf(a.reference); return n ? `@${n}` : `@0x${(a.reference >>> 0).toString(16).padStart(8, '0')}`; }
      case 'attribute': { const n = nameOf(a.reference); return n ? `?${n}` : `?0x${(a.reference >>> 0).toString(16).padStart(8, '0')}`; }
      case 'boolean': return a.value ? 'true' : 'false';
      case 'color': return a.value;
      case 'dimension': return `${Number(a.value.toFixed(4))}${a.unit}`;
      case 'fraction': return `${Number((a.value * 100).toFixed(4))}${a.unit}`;
      case 'integer': return a.dataType === 0x11 ? `0x${(a.value >>> 0).toString(16)}` : String(a.value);
      case 'float': return String(a.value);
      case 'string': return a.value;
      case 'null': return a.empty ? '@empty' : '@null';
      default: return `(type 0x${(a.dataType ?? 0).toString(16)} 0x${((a.rawData ?? 0) >>> 0).toString(16)})`;
    }
  };
  const lines = ['<?xml version="1.0" encoding="utf-8"?>'];
  const prefixOf = (uri, scope) => { for (let i = scope.length - 1; i >= 0; i--) if (scope[i].uri === uri) return scope[i].prefix; return null; };
  const walk = (node, depth, parentScope) => {
    const pad = '    '.repeat(depth), scope = node.namespaces ?? parentScope, fresh = scope.filter(ns => !parentScope.some(p => p.uri === ns.uri && p.prefix === ns.prefix));
    const attrs = [...fresh.map(ns => `xmlns:${ns.prefix}="${xmlEscape(ns.uri)}"`), ...node.attributes.map(a => { const prefix = a.namespace ? prefixOf(a.namespace, scope) ?? 'ns' : null; return `${prefix ? prefix + ':' : ''}${a.name}="${xmlEscape(value(a))}"`; })];
    const name = node.namespace ? `${prefixOf(node.namespace, scope) ?? 'ns'}:${node.name}` : node.name;
    const open = attrs.length <= 1 ? `${pad}<${name}${attrs.length ? ' ' + attrs[0] : ''}` : `${pad}<${name}\n${attrs.map(a => `${pad}    ${a}`).join('\n')}`;
    const text = node.text?.trim();
    if (!node.children.length && !text) { lines.push(`${open} />`); return; }
    lines.push(`${open}>`);
    if (text) lines.push(`${pad}    ${xmlEscape(text, false)}`);
    for (const child of node.children) walk(child, depth + 1, scope);
    lines.push(`${pad}</${name}>`);
  };
  walk(tree, 0, []);
  return lines.join('\n');
}
function arscSummary(rt) {
  const table = rt.resources?.table; if (!table) return '# No resource table was loaded for this APK.';
  const lines = ['# resources.arsc, summarized (the compiled resource table; read-only)', ''];
  const byPackage = new Map();
  for (const [id, variants] of table.entries) {
    const first = variants[0], pkg = first.packageName ?? `0x${(id >>> 24).toString(16)}`;
    let p = byPackage.get(pkg); if (!p) byPackage.set(pkg, p = { id: id >>> 24, types: new Map(), resources: 0, values: 0 });
    p.resources++; p.values += variants.length;
    let t = p.types.get(first.resourceType); if (!t) p.types.set(first.resourceType, t = { count: 0, values: 0, sample: [] });
    t.count++; t.values += variants.length;
    if (t.sample.length < 200) t.sample.push(`0x${(id >>> 0).toString(16).padStart(8, '0')} ${first.resourceType}/${first.name}${first.resourceType === 'id' ? '' : first.kind === 'string' || first.kind === 'integer' || first.kind === 'boolean' || first.kind === 'color' ? ` = ${JSON.stringify(first.value)}` : first.kind === 'bag' ? ` (bag, ${first.items?.length ?? 0} items)` : first.kind === 'reference' ? ` -> 0x${(first.reference >>> 0).toString(16)}` : ''}${variants.length > 1 ? `   [${variants.length} configurations]` : ''}`);
  }
  for (const [name, p] of byPackage) {
    lines.push(`package 0x${p.id.toString(16).padStart(2, '0')} ${name}: ${p.resources} resources, ${p.values} values`);
    for (const [type, t] of [...p.types].sort()) lines.push(`    ${type}: ${t.count} resources, ${t.values} values`);
    lines.push('');
  }
  for (const [name, p] of byPackage) for (const [type, t] of [...p.types].sort()) {
    lines.push(`# ${name} ${type}${t.count > t.sample.length ? ` (first ${t.sample.length} of ${t.count})` : ''}`);
    lines.push(...t.sample); lines.push('');
  }
  return lines.join('\n');
}
function dexClassList(rt, path, bytes) {
  const loaded = dexFilesOf(rt).find(f => f.filename === path)?.dex;
  let dex = loaded; if (!dex) { try { dex = new DexFile(bytes, { filename: path }); } catch (error) { return `# ${path}: not a readable DEX file (${error?.message ?? error})`; } }
  const names = [...dex.classes.names.keys()].sort(), shown = names.slice(0, CODE_LIMITS.dexListClasses);
  return [`# ${path}: ${names.length} classes, ${dex.methods.length} method ids, ${dex.fields.length} field ids, ${dex.strings.length} strings${loaded ? '' : ' (not loaded by the VM)'}`,
    '# Open a class from the tree or the search to read its smali.', '', ...shown, ...(names.length > shown.length ? [`… ${names.length - shown.length} more`] : [])].join('\n');
}
/**
 * An APK entry for the viewer: { path, size, kind: 'text' | 'xml' | 'arsc' | 'dex' | 'image' | 'hex', text?, bytes? (image), mime?, truncated, editable, refusal, edited, original? }.
 * `original: true` reads the entry as the APK has it (the diff of an edited file).
 */
function readFile(rt, path, { original = false } = {}) {
  const name = String(path ?? ''), edits = rt.entryEdits, edit = edits?.get(name);
  const bytes = original && edit ? edit.original : entryBytes(rt, name), base = { path: name, size: bytes.length, edited: !!edit, truncated: false };
  if (name.endsWith('.dex')) return { ...base, kind: 'dex', text: dexClassList(rt, name, bytes), editable: false, refusal: editRefusal(name, bytes) };
  if (name === 'resources.arsc') return { ...base, kind: 'arsc', text: arscSummary(rt), editable: false, refusal: editRefusal(name, bytes) };
  if (isBinaryXml(bytes)) {
    try { return { ...base, kind: 'xml', text: binaryXmlText(rt, bytes), editable: false, refusal: editRefusal(name, bytes) }; }
    catch (error) { return { ...base, kind: 'hex', text: `# binary XML that could not be decoded: ${error?.message ?? error}\n${hexDump(bytes)}`, truncated: bytes.length > CODE_LIMITS.hexBytes, editable: false, refusal: editRefusal(name, bytes) }; }
  }
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (IMAGE[extension] && !name.endsWith('.9.png')) return { ...base, kind: 'image', mime: IMAGE[extension], bytes: bytes.slice(), editable: false, refusal: 'images are shown, not edited here' };
  const refusal = editRefusal(name, bytes), text = asText(bytes);
  if (text !== null) return { ...base, kind: 'text', text, editable: !refusal, refusal };
  return { ...base, kind: 'hex', text: hexDump(bytes), truncated: bytes.length > CODE_LIMITS.hexBytes, editable: false, refusal: refusal ?? 'binary files are shown as hex, not edited here' };
}
/** The edits map of the VM, installing (once) the reader that serves the edited bytes. */
function entryEdits(rt) {
  if (rt.entryEdits) return rt.entryEdits;
  const edits = new Map(), read = rt.apkReader, range = rt.apkEntryRange;
  Object.defineProperty(rt, 'entryEdits', { value: edits, configurable: true });
  rt.apkReader = name => { const edit = edits.get(name); return edit ? edit.bytes.slice() : read(name); };
  rt.apkEntryRange = name => {
    if (edits.has(name)) throw new APKError(`${name} was edited by the user (App modified): a file descriptor over the installed APK (AssetManager.openFd, openRawResourceFd) would read the original bytes, so it is not opened; open() reads the edited file`, { kind: 'edited-entry' });
    return range ? range(name) : null;
  };
  return edits;
}
/** Every edited entry: [{ path, bytes, originalBytes, at }] (oldest first). */
function fileEdits(rt) { return [...(rt.entryEdits?.values() ?? [])].map(edit => ({ path: edit.path, bytes: edit.bytes.length, originalBytes: edit.original.length, at: edit.at, by: edit.by })); }
/** Replaces the bytes of an APK entry with `text` (UTF-8; or `bytes`), from the next read on. */
function editFile(rt, path, text, { bytes = null, by = 'Code browser' } = {}) {
  const name = String(path ?? ''), original = rt.entryEdits?.get(name)?.original ?? entryBytes(rt, name);
  const why = editRefusal(name, original); if (why) throw fail('unsupported', `${name} cannot be edited: ${why}`);
  const next = bytes instanceof Uint8Array ? bytes.slice() : new TextEncoder().encode(String(text ?? ''));
  if (next.length > CODE_LIMITS.editBytes) throw fail('limit', `An edited file can have at most ${CODE_LIMITS.editBytes / 1024 / 1024} MB`);
  const edits = entryEdits(rt);
  if (!edits.has(name) && edits.size >= CODE_LIMITS.edits) throw fail('limit', `At most ${CODE_LIMITS.edits} edited files at a time`);
  edits.set(name, { path: name, bytes: next, original, at: Date.now(), by: String(by).slice(0, 80) });
  remountEntry(rt, name, next);
  rt.record?.(`EDIT FILE ${name} (${next.length} bytes; the APK has ${original.length}) by the ${String(by).slice(0, 80)}: the app reads the edited bytes from its next read`);
  return { edit: fileEdits(rt).find(e => e.path === name), edits: fileEdits(rt) };
}
function revertFile(rt, path) {
  const name = String(path ?? ''), edit = rt.entryEdits?.get(name); if (!edit) return { removed: false, edits: fileEdits(rt) };
  rt.entryEdits.delete(name); remountEntry(rt, name, edit.original);
  rt.record?.(`UNEDIT FILE ${name} (the APK's ${edit.original.length} bytes again)`);
  return { removed: true, edits: fileEdits(rt) };
}
/** A large entry the app already opened is a file of the virtual file system (src/java-io-host.js apkEntryStream): its node gets the new bytes too. */
function remountEntry(rt, name, bytes) {
  try { const fs = rt.platform?.javaIo?.fs?.(), node = fs ? `${fs.codePath}/.entries/${name}` : null; if (node && fs.nodes?.has(node)) fs.mount(node, bytes.slice()); } catch { /* no file system: nothing mounted */ }
}
export { KINDS as CODE_SEARCH_KINDS, decodeInstruction };
