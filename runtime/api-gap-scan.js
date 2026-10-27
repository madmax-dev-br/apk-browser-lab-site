// A static estimate of which framework/JDK APIs an APK references that this VM cannot run, and which of its native libraries the lab can serve.
//
// Nothing is executed: the scan walks the Dalvik bytecode of every app method, counts the call sites of each referenced framework method and the
// new-instance/const-class/check-cast/instance-of sites of each referenced framework class, and asks the runtime what dispatch() and class resolution would answer
// (`methodAvailability`, the class tables). The result is an UPPER BOUND on the gaps a run can hit: code behind a feature or SDK check, dead code and code reached only
// by other apps' paths all count. Each method is marked
//   direct    : the call site is in a method that reads Build.VERSION.SDK_INT nowhere, in a class that reads it nowhere
//   sdk       : the call site follows an SDK_INT read in the same method, or sits in an `ApiNN` holder class (the androidx idiom for guarded calls)
//   unknown   : the method does not read SDK_INT but its class does elsewhere, so a guard may live in a caller or sibling
// The report holds ONLY framework/JDK names and counts (and the native library file names the user asked for): app class names, method names and strings never
// enter it, so it can be pasted into a chat. DOM-free and process-free: it runs in the Worker and in Node.

import { PROTECTED_NATIVE_LIBRARY } from './protected-native.js?v=6531d427a542';

const FRAMEWORK = /^L(android|java|javax|dalvik|libcore|sun|org\/(json|xml|w3c))\//;
const SDK_INT_FIELD = 'Landroid/os/Build$VERSION;->SDK_INT:I';
const API_HOLDER = /(^|[$\/])Api\d+(Impl)?;?$|\$Api\d+/;

// Width in 16-bit code units of each Dalvik instruction, by opcode.
const WIDTH = new Uint8Array(256).fill(1);
for (const [from, to, width] of [[0x02, 0x02, 2], [0x03, 0x03, 3], [0x05, 0x05, 2], [0x06, 0x06, 3], [0x08, 0x08, 2], [0x09, 0x09, 3], [0x13, 0x13, 2], [0x14, 0x14, 3], [0x15, 0x16, 2], [0x17, 0x17, 3],
  [0x18, 0x18, 5], [0x19, 0x19, 2], [0x1a, 0x1a, 2], [0x1b, 0x1b, 3], [0x1c, 0x1c, 2], [0x1f, 0x20, 2], [0x22, 0x23, 2], [0x24, 0x26, 3], [0x29, 0x29, 2], [0x2a, 0x2c, 3], [0x2d, 0x3d, 2],
  [0x44, 0x6d, 2], [0x6e, 0x72, 3], [0x74, 0x78, 3], [0x90, 0xaf, 2], [0xd0, 0xe2, 2], [0xfa, 0xfb, 4], [0xfc, 0xfd, 3], [0xfe, 0xff, 2]]) WIDTH.fill(width, from, to + 1);

/** `Landroid/graphics/PorterDuff$Mode;` -> `PorterDuff.Mode`, `[I` -> `int[]`; anything outside the framework namespaces -> `?` (privacy). */
export function simpleType(type) {
  let dims = 0; while (type[dims] === '[') dims++;
  const base = type.slice(dims), prim = { Z: 'boolean', B: 'byte', C: 'char', S: 'short', I: 'int', J: 'long', F: 'float', D: 'double', V: 'void' }[base];
  const name = prim ?? (FRAMEWORK.test(base) ? base.slice(1, -1).split('/').pop().replaceAll('$', '.') : '?');
  return name + '[]'.repeat(dims);
}
const dotted = type => type.slice(1, -1).replaceAll('/', '.');

/**
 * scanApiGaps(runtime, { archive, nativeLibraries, yieldFn, sliceMs, cancelled }) -> report (see formatApiGapReport).
 * `yieldFn` (async) is awaited about every `sliceMs` of work so a Worker keeps serving the VM's events; `cancelled()` aborts early with null.
 */
export async function scanApiGaps(runtime, { archive = null, nativeLibraries = null, yieldFn = null, sliceMs = 8, cancelled = () => false } = {}) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let sliceStart = now();
  const tick = async () => { if (yieldFn && now() - sliceStart >= sliceMs) { await yieldFn(); sliceStart = now(); } };
  const appClasses = new Set(); for (const name of runtime.classes.keys()) if (runtime.dex.classes.has(name) && !runtime.dex.bootClasses?.has(name)) appClasses.add(name);
  const isApp = type => appClasses.has(type);

  // ---- phase 1: count the call/class sites per dex reference
  const perDex = new Map();   // dex -> { methodCounts: Map(idx -> [direct, sdk, unknown]), typeCounts: Map(`${kind}:${idx}` -> [..]) , sdkFields: Set }
  const dexState = dex => {
    let state = perDex.get(dex);
    if (!state) { const sdkFields = new Set(); dex.fields.forEach((f, i) => { if (f.key === SDK_INT_FIELD) sdkFields.add(i); }); perDex.set(dex, state = { methodCounts: new Map(), typeCounts: new Map(), sdkFields, nonVirtual: new Set() }); }
    return state;
  };
  let scannedMethods = 0, interfaceSites = 0;
  for (const name of appClasses) {
    if (cancelled()) return null;
    const cls = runtime.classes.get(name); if (!cls?.dex) continue;
    const state = dexState(cls.dex), view = cls.dex.reader.view, holder = API_HOLDER.test(name);
    const sites = [];   // per class: [kind, idx, guarded-by-position?] collected before the class-level SDK_INT knowledge is complete
    let classReadsSdk = false;
    for (const def of cls.methods.values()) {
      const code = def.code; if (!code?.units) continue;
      scannedMethods++;
      const base = code.offset, end = code.units;
      let sdkAt = -1, i = 0;
      const local = [];
      while (i < end) {
        const unit = view.getUint16(base + i * 2, true), op = unit & 0xff;
        if (op === 0x00 && unit !== 0) {   // payload pseudo-instructions: packed-switch 0x0100, sparse-switch 0x0200, fill-array-data 0x0300
          const size = view.getUint16(base + (i + 1) * 2, true);
          i += unit === 0x0100 ? 4 + size * 2 : unit === 0x0200 ? 2 + size * 4 : unit === 0x0300 ? 4 + Math.ceil(view.getUint32(base + (i + 2) * 2, true) * size / 2) : 1;
          continue;
        }
        if (op >= 0x60 && op <= 0x6d) { if (sdkAt < 0 && state.sdkFields.has(view.getUint16(base + (i + 1) * 2, true))) sdkAt = i; }
        else if (op === 0x72 || op === 0x78) interfaceSites++;   // invoke-interface dispatches on the receiver's class, not on the named interface: not assessable statically
        else if ((op >= 0x6e && op <= 0x71) || (op >= 0x74 && op <= 0x77)) { const idx = view.getUint16(base + (i + 1) * 2, true); if (op !== 0x6e && op !== 0x74) state.nonVirtual.add(idx); local.push([0, idx, i]); }
        else if (op === 0x22 || op === 0x1c) local.push([op, view.getUint16(base + (i + 1) * 2, true), i]);   // check-cast/instance-of compare types and resolve no class
        i += WIDTH[op];
      }
      if (sdkAt >= 0) classReadsSdk = true;
      for (const [kind, idx, at] of local) sites.push([kind, idx, holder || (sdkAt >= 0 && at > sdkAt) ? 1 : sdkAt >= 0 ? 2 : 3]);   // 1 sdk, 2 unknown (method reads SDK_INT later), 3 plain
    }
    for (const [kind, idx, flag] of sites) {
      const slot = flag === 1 ? 1 : flag === 2 ? 2 : classReadsSdk ? 2 : 0;
      const table = kind === 0 ? state.methodCounts : state.typeCounts, key = kind === 0 ? idx : `${kind}:${idx}`;
      let counts = table.get(key); if (!counts) table.set(key, counts = [0, 0, 0]);
      counts[slot]++;
    }
    await tick();
  }

  // ---- phase 2: ask the runtime about each referenced framework method / class
  const framework = type => FRAMEWORK.test(type) && !isApp(type);
  const classKnown = (type, kind = 0) => { try { return kind === 0x22 ? runtime.allocatable(type) : runtime.classResolvable(type); } catch { return true; } };
  let frameworkNames = null;   // every method name some framework class declares: an app-owner reference is reportable only under such a name (an app-defined name never is)
  const isFrameworkName = name => {
    if (!frameworkNames) { frameworkNames = new Set(); for (const [type, cls] of runtime.classes) if (!isApp(type)) for (const key of cls.methods.keys()) frameworkNames.add(key.slice(0, key.indexOf('('))); }
    return frameworkNames.has(name);
  };
  const rejected = ref => {   // the framework owner that lacks the method, or null when it can run (or is not a framework API)
    let owner = ref.owner;
    if (owner[0] === '[') return null;
    const appOwner = isApp(owner), key = ref.name + ref.signature, seen = new Set(), pending = [];
    while (isApp(owner) && !seen.has(owner)) {
      seen.add(owner);
      const cls = runtime.classes.get(owner); if (!cls) return null;
      if (cls.methods.has(key)) return null;
      pending.push(...(cls.interfaces ?? []));
      owner = cls.superclass;
      if (!owner) return null;
    }
    while (pending.length) {   // interfaces the app classes implement: an app interface may declare the method, a framework one may provide it
      const itf = pending.pop(); if (seen.has(itf)) continue; seen.add(itf);
      if (isApp(itf)) { const cls = runtime.classes.get(itf); if (!cls || cls.methods.has(key)) return null; pending.push(...(cls.interfaces ?? [])); continue; }
      try { if (runtime.methodAvailability({ ...ref, owner: itf })) return null; } catch { return null; }
    }
    if (!framework(owner) || (appOwner && !isFrameworkName(ref.name))) return null;
    try { return runtime.methodAvailability({ ...ref, owner }) ? null : owner; } catch { return null; }
  };
  const byClass = new Map();   // framework class -> { methods: Map(key -> entry), classSites: [0,0,0], missingClass }
  let referenced = 0, rejectedRefs = 0, omitted = 0, resolvedOnSubclass = 0;
  const entry = owner => { let e = byClass.get(owner); if (!e) byClass.set(owner, e = { methods: new Map(), sites: [0, 0, 0], classSites: [0, 0, 0], kinds: new Set(), missingClass: false }); return e; };
  for (const [dex, state] of perDex) {
    if (cancelled()) return null;
    for (const [idx, counts] of state.methodCounts) {
      const ref = dex.methods[idx]; if (!ref) continue;
      referenced++;
      const owner = rejected(ref); if (!owner) continue;
      // a virtual call on a base class dispatches on the receiver: a concrete framework subclass that provides the method makes it runnable (DateFormat.format -> SimpleDateFormat)
      if (!state.nonVirtual.has(idx) && framework(owner) && runtime.virtualProvider?.(owner, ref.name, ref.signature)) { resolvedOnSubclass++; continue; }
      rejectedRefs++;
      if (!framework(owner)) { omitted++; continue; }
      const e = entry(owner), key = ref.name + ref.signature;
      let m = e.methods.get(key); if (!m) e.methods.set(key, m = { name: ref.name, signature: ref.signature, sites: [0, 0, 0] });
      for (let k = 0; k < 3; k++) { m.sites[k] += counts[k]; e.sites[k] += counts[k]; }
      if (!classKnown(owner)) e.missingClass = true;
    }
    for (const [key, counts] of state.typeCounts) {
      const [kind, idx] = key.split(':').map(Number), type = dex.types[idx];
      if (!type || type[0] === '[' || !framework(type) || classKnown(type, kind)) continue;
      const e = entry(type); e.missingClass = true; e.kinds.add({ 0x22: 'new', 0x1c: 'class' }[kind]);
      for (let k = 0; k < 3; k++) e.classSites[k] += counts[k];
    }
    await tick();
  }

  const mark = sites => (sites[0] ? 'direct' : sites[2] ? 'unknown' : 'sdk');
  const total = sites => sites[0] + sites[1] + sites[2];
  const classes = [...byClass].map(([type, e]) => ({
    name: dotted(type), missingClass: e.missingClass, kinds: [...e.kinds].sort(),
    sites: total(e.sites) + total(e.classSites), methodCount: e.methods.size,
    classSites: { direct: e.classSites[0], sdk: e.classSites[1], unknown: e.classSites[2] },
    methods: [...e.methods.values()].map(m => ({ name: m.name, params: parameters(m.signature), sites: total(m.sites), mark: mark(m.sites), by: { direct: m.sites[0], sdk: m.sites[1], unknown: m.sites[2] } }))
      .sort((a, b) => b.sites - a.sites || a.name.localeCompare(b.name)),
  })).sort((a, b) => b.sites - a.sites || a.name.localeCompare(b.name));

  // ---- native libraries
  const native = await nativeTable(runtime, archive, nativeLibraries);
  return {
    schema: 1, estimate: 'upper-bound', scannedClasses: appClasses.size, scannedMethods, interfaceSitesSkipped: interfaceSites, resolvedOnSubclass, referencedFrameworkMethods: referenced, rejectedMethods: rejectedRefs - omitted,
    rejectedClasses: classes.filter(c => c.missingClass).length, omittedNonFramework: omitted, classes, native,
  };
}

function parameters(signature) {
  const out = []; let i = 1;
  while (signature[i] !== ')') {
    let start = i; while (signature[i] === '[') i++;
    if (signature[i] === 'L') i = signature.indexOf(';', i);
    i++; out.push(simpleType(signature.slice(start, i)));
  }
  return out.join(', ');
}

/** Lab status of each native library in the APK's lib/ directories: available, version-gated, protected (not a plain ELF: packed or encrypted) or missing. */
async function nativeTable(runtime, archive, nativeLibraries) {
  const abis = nativeLibraries ?? {}, bySoname = new Map();
  for (const [abi, info] of Object.entries(abis)) for (const name of info.libraries ?? info) { if (!bySoname.has(name)) bySoname.set(name, []); bySoname.get(name).push(abi); }
  const out = [];
  for (const [soname, where] of [...bySoname].sort((a, b) => a[0].localeCompare(b[0]))) {
    let status = runtime.jni?.libraryStatus?.(soname) ?? { status: 'missing' };
    if (status.status === 'missing' && PROTECTED_NATIVE_LIBRARY.test(soname.replace(/^lib/, '').replace(/\.so$/, ''))) status = { status: 'protected' };   // the rule tolerant mode uses (protected-native.js)
    else if (status.status === 'missing' && archive) {
      const abi = where.includes('arm64-v8a') ? 'arm64-v8a' : where[0], path = `lib/${abi}/${soname}`;
      try { if (archive.entries.has(path) && isPacked(await archive.extractPrefix(path, 4096))) status = { status: 'protected' }; } catch { /* unreadable: stays missing */ }
    }
    out.push({ name: soname, abis: where.sort(), status: status.status, needs: status.needs ?? null });
  }
  return out;
}
/** Not an ELF image, or an ELF whose first 4 KiB look encrypted (Shannon entropy above 7.5 bits/byte): a packed or protected payload. */
function isPacked(bytes) {
  if (!(bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46)) return true;
  const counts = new Uint32Array(256); for (const b of bytes) counts[b]++;
  let entropy = 0; for (const c of counts) if (c) { const p = c / bytes.length; entropy -= p * Math.log2(p); }
  return entropy > 7.5;
}

const MARK = { direct: 'incond.', sdk: 'SDK_INT', unknown: '?' };
const STATUS = { available: 'disponível', 'version-gated': 'porta de versão', protected: 'protegida', missing: 'ausente' };
export const API_GAPS_TITLE = 'APIs referenciadas sem implementação (estimativa estática)';

/** The compact, text-only section for "Copiar diagnóstico": top classes and methods by call sites, then the native library table. Bounded by the arguments. */
export function formatApiGapReport(report, { topClasses = 20, topMethods = 3, topNative = 20 } = {}) {
  if (!report) return '';
  const lines = [`${API_GAPS_TITLE}:`,
    `Limite superior: conta pontos de chamada no DEX (sem chamadas via interface, que dependem do objeto em execução), inclusive código atrás de SDK_INT ou de recursos que o app talvez não use; nada foi executado. Só nomes de API do framework/JDK. Marcas: incond. = sem SDK_INT na classe, SDK_INT = após leitura de Build.VERSION.SDK_INT, ? = guarda possível em outro método.`,
    `${report.rejectedMethods} métodos e ${report.rejectedClasses} classes do framework/JDK referenciados e sem implementação, de ${report.referencedFrameworkMethods} métodos referenciados (${report.scannedMethods} métodos do app varridos).`];
  for (const c of report.classes.slice(0, topClasses)) {
    const detail = c.missingClass ? `classe ausente${c.kinds.length ? ' (' + c.kinds.join('/') + ')' : ''}` : `${c.methodCount} métodos`;
    lines.push(`- ${c.name}: ${c.sites} pontos, ${detail}`);
    for (const m of c.methods.slice(0, topMethods)) lines.push(`    ${m.name}(${m.params}) x${m.sites} [${MARK[m.mark]}]`);
    if (c.methods.length > topMethods) lines.push(`    ... +${c.methods.length - topMethods}`);
  }
  if (report.classes.length > topClasses) lines.push(`... +${report.classes.length - topClasses} classes`);
  if (report.omittedNonFramework) lines.push(`(${report.omittedNonFramework} referências fora do framework/JDK omitidas)`);
  const rank = { protected: 0, 'version-gated': 1, missing: 2, available: 3 };   // what needs attention first, so a bounded table never hides it
  const libs = [...(report.native ?? [])].sort((x, y) => (rank[x.status] ?? 4) - (rank[y.status] ?? 4) || x.name.localeCompare(y.name));
  if (libs.length) {
    lines.push('Bibliotecas nativas do APK (estado no laboratório):');
    for (const lib of libs.slice(0, topNative)) lines.push(`- ${lib.name} [${lib.abis.join(',')}]: ${STATUS[lib.status] ?? lib.status}${lib.needs ? ` (precisa de ${lib.needs})` : ''}`);
    if (libs.length > topNative) lines.push(`... +${libs.length - topNative} bibliotecas`);
  }
  return lines.join('\n');
}

/** The report trimmed for postMessage (the page only prints the top of it). */
export function compactApiGapReport(report, { classes = 40, methods = 6 } = {}) {
  return report && { ...report, classes: report.classes.slice(0, classes).map(c => ({ ...c, methods: c.methods.slice(0, methods) })), native: report.native.slice(0, 60) };
}
