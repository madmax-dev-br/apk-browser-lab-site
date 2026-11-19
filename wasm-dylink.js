// Reader for the parts of a WebAssembly binary that the lab's dynamic linker needs, with no dependency on Emscripten's JS runtime:
//   - the "dylink.0" custom section (tool-conventions/DynamicLinking.md): memory/table size+alignment, DT_NEEDED-style dependencies, export-info / import-info flags;
//   - the import section (module, field, kind) so a loader can classify each import (env.memory, GOT.mem.*, GOT.func.*, plain function imports, tags);
//   - the export section (name, kind).
// Browser-safe: pure functions over a Uint8Array.

export const WASM_SYMBOL_BINDING_WEAK = 1, WASM_SYMBOL_VISIBILITY_HIDDEN = 4, WASM_SYMBOL_UNDEFINED = 0x10;
const KINDS = ['function', 'table', 'memory', 'global', 'tag'];
const VALTYPE = { 0x7f: 'i32', 0x7e: 'i64', 0x7d: 'f32', 0x7c: 'f64', 0x7b: 'v128', 0x70: 'funcref', 0x6f: 'externref' };

class Reader {
  constructor(bytes, at = 0) { this.b = bytes; this.i = at; }
  u8() { return this.b[this.i++]; }
  leb() { let r = 0, shift = 0, byte; do { byte = this.b[this.i++]; r += (byte & 0x7f) * 2 ** shift; shift += 7; } while (byte & 0x80); return r; }
  str() { const n = this.leb(), s = new TextDecoder().decode(this.b.subarray(this.i, this.i + n)); this.i += n; return s; }
}

/** Parses a wasm binary into { dylink, imports, exports, memory } or throws on a malformed module. dylink is null for non-relocatable modules. */
export function parseWasm(bytes) {
  if (bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) throw new Error('not a WebAssembly binary');
  const r = new Reader(bytes, 8), out = { dylink: null, imports: [], exports: [], memory: null, types: [] };
  while (r.i < bytes.length) {
    const id = r.u8(), size = r.leb(), end = r.i + size;
    if (id === 0) {
      const name = r.str();
      if (name === 'dylink.0') {
        const d = { memorySize: 0, memoryAlign: 0, tableSize: 0, tableAlign: 0, needed: [], exportInfo: new Map(), importInfo: new Map() };
        while (r.i < end) {
          const sub = r.u8(), subSize = r.leb(), subEnd = r.i + subSize;
          if (sub === 1) { d.memorySize = r.leb(); d.memoryAlign = r.leb(); d.tableSize = r.leb(); d.tableAlign = r.leb(); }
          else if (sub === 2) { for (let n = r.leb(); n > 0; n--) d.needed.push(r.str()); }
          else if (sub === 3) { for (let n = r.leb(); n > 0; n--) { const sym = r.str(); d.exportInfo.set(sym, r.leb()); } }
          else if (sub === 4) { for (let n = r.leb(); n > 0; n--) { const mod = r.str(), field = r.str(); d.importInfo.set(`${mod}.${field}`, r.leb()); } }
          r.i = subEnd;
        }
        out.dylink = d;
      }
    } else if (id === 1) {
      for (let n = r.leb(); n > 0; n--) {
        if (r.u8() !== 0x60) throw new Error('unsupported type form');
        const params = [], results = [];
        for (let k = r.leb(); k > 0; k--) params.push(VALTYPE[r.u8()]);
        for (let k = r.leb(); k > 0; k--) results.push(VALTYPE[r.u8()]);
        out.types.push({ params, results });
      }
    } else if (id === 2) {
      for (let n = r.leb(); n > 0; n--) {
        const module = r.str(), name = r.str(), kind = KINDS[r.u8()];
        const entry = { module, name, kind };
        if (kind === 'function') entry.type = out.types[r.leb()];
        else if (kind === 'tag') { r.u8(); r.leb(); }
        else if (kind === 'table') { r.u8(); const flags = r.u8(); r.leb(); if (flags & 1) r.leb(); }
        else if (kind === 'memory') { const flags = r.u8(); entry.initial = r.leb(); if (flags & 1) entry.maximum = r.leb(); entry.shared = !!(flags & 2); }
        else { r.u8(); entry.mutable = !!r.u8(); }
        out.imports.push(entry);
      }
    } else if (id === 5 && !out.memory) {
      r.leb(); const flags = r.u8(); out.memory = { initial: r.leb(), maximum: flags & 1 ? r.leb() : null };
    } else if (id === 7) {
      for (let n = r.leb(); n > 0; n--) { const name = r.str(), kind = KINDS[r.u8()]; r.leb(); out.exports.push({ name, kind }); }
    }
    r.i = end;
  }
  return out;
}

const leb128 = n => { const out = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return out; };
const utf8 = s => [...new TextEncoder().encode(s)];
const withLength = body => [...leb128(body.length), ...body];

/**
 * Returns a copy of the module whose dylink.0 section lists exactly `needed` (DT_NEEDED, in this order). Build-time helper: wasm-ld records only the
 * shared libraries it was given as inputs, and a shared library cannot be an input of another that carries the same inline (COMDAT) symbols, so each
 * library's dependency list is applied to the finished module instead. Everything else in the module is unchanged.
 */
export function setNeeded(bytes, needed) {
  const r = new Reader(bytes, 8), pieces = [bytes.subarray(0, 8)];
  let done = false;
  while (r.i < bytes.length) {
    const start = r.i, id = r.u8(), size = r.leb(), end = r.i + size;
    if (id === 0 && r.str() === 'dylink.0') {
      const subs = [];
      while (r.i < end) { const sub = r.u8(), subSize = r.leb(); subs.push({ id: sub, body: [...bytes.subarray(r.i, r.i + subSize)] }); r.i += subSize; }
      const neededBody = [...leb128(needed.length), ...needed.flatMap(n => withLength(utf8(n)))];
      const kept = subs.filter(s => s.id !== 2), at = kept.findIndex(s => s.id === 1) + 1;
      kept.splice(at, 0, { id: 2, body: neededBody });
      const payload = [...withLength(utf8('dylink.0')), ...kept.flatMap(s => [s.id, ...withLength(s.body)])];
      pieces.push(Uint8Array.from([0, ...withLength(payload)])); done = true;
    } else pieces.push(bytes.subarray(start, end));
    r.i = end;
  }
  if (!done) throw new Error('module has no dylink.0 section');
  const out = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0)); let at = 0;
  for (const p of pieces) { out.set(p, at); at += p.length; }
  return out;
}
