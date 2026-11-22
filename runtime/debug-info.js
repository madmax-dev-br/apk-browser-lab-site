// DEX debug information for the Java debugger (src/debugger.js): the line table (.line), the locals (.local / .end local / .restart local) and the parameter names of a method's
// code item (DEX format, debug_info_item), and the source file of its class (class_def.source_file_idx). Read from the DEX bytes the VM already holds; nothing here runs Java
// code or changes the VM. Runs in the Worker and in Node tests: no DOM, no process.*.

const NO_INDEX = 0xffffffff;
const DBG_END_SEQUENCE = 0, DBG_ADVANCE_PC = 1, DBG_ADVANCE_LINE = 2, DBG_START_LOCAL = 3, DBG_START_LOCAL_EXTENDED = 4, DBG_END_LOCAL = 5, DBG_RESTART_LOCAL = 6,
  DBG_SET_PROLOGUE_END = 7, DBG_SET_EPILOGUE_BEGIN = 8, DBG_SET_FILE = 9, DBG_FIRST_SPECIAL = 0x0a, DBG_LINE_BASE = -4, DBG_LINE_RANGE = 15;
const ACC_STATIC = 0x8;
const cache = new WeakMap();   // code object -> debug info (immutable DEX data)

/** Words a value of type `descriptor` takes in registers. */
export const wordsOf = descriptor => descriptor === 'J' || descriptor === 'D' ? 2 : 1;

/**
 * The debug information of `definition` ({ method, flags, code }: a class record's method entry): { lines: [{ pc, line }] in address order, locals: [{ register, name, type,
 * signature, start, end }] (end exclusive; Infinity: live to the end), parameters: [{ register, name, type }] (`this` first for an instance method), sourceFile, hasDebugInfo }.
 * A method without debug info has no lines and only the parameters its signature gives (named null).
 */
export function debugInfoOf(definition) {
  const code = definition?.code; if (!code) return null;
  const known = cache.get(code); if (known) return known;
  const method = definition.method, dex = method.dex, reader = dex.reader, isStatic = (definition.flags & ACC_STATIC) !== 0;
  const info = { lines: [], locals: [], parameters: [], sourceFile: sourceFileOf(dex, method.owner), hasDebugInfo: false };
  // the incoming registers: the last `incoming` of the frame, `this` first
  let register = code.registers - code.incoming;
  if (!isStatic) info.parameters.push({ register: register++, name: 'this', type: method.owner });
  for (const type of method.parameters) { info.parameters.push({ register, name: null, type }); register += wordsOf(type); }
  const offset = reader.u32(code.offset - 16 + 8);   // code_item.debug_info_off (src/art-structures.js CODE_ITEM)
  if (offset) {
    try { parse(dex, reader, offset, code, info, isStatic); info.hasDebugInfo = true; }
    catch (error) { info.error = String(error?.message ?? error); }
  }
  cache.set(code, info);
  return info;
}

function parse(dex, reader, offset, code, info, isStatic) {
  const cursor = { p: offset }, string = index => index === NO_INDEX ? null : dex.string(index), type = index => index === NO_INDEX ? null : dex.type(index);
  let line = reader.uleb(cursor);
  const names = reader.uleb(cursor), firstParameter = isStatic ? 0 : 1;
  for (let i = 0; i < names; i++) { const name = string(reader.uleb(cursor) - 1 >>> 0); const parameter = info.parameters[firstParameter + i]; if (parameter && name !== null) parameter.name = name; }
  // the parameters are live locals from address 0 (ART's DexFile::DecodeDebugLocalInfo)
  const live = new Map();
  for (const parameter of info.parameters) if (parameter.name !== null) live.set(parameter.register, { register: parameter.register, name: parameter.name, type: parameter.type, signature: null, start: 0, end: Infinity });
  const close = (register, address) => { const local = live.get(register); if (local) { local.end = address; info.locals.push(local); live.delete(register); } return local; };
  let address = 0;
  for (let guard = 0; guard < 1 << 20; guard++) {
    const op = reader.u8(cursor.p++);
    if (op === DBG_END_SEQUENCE) break;
    switch (op) {
      case DBG_ADVANCE_PC: address += reader.uleb(cursor); break;
      case DBG_ADVANCE_LINE: line += reader.sleb(cursor); break;
      case DBG_START_LOCAL: case DBG_START_LOCAL_EXTENDED: {
        const register = reader.uleb(cursor), name = string(reader.uleb(cursor) - 1 >>> 0), localType = type(reader.uleb(cursor) - 1 >>> 0);
        const signature = op === DBG_START_LOCAL_EXTENDED ? string(reader.uleb(cursor) - 1 >>> 0) : null;
        close(register, address);
        live.set(register, { register, name, type: localType, signature, start: address, end: Infinity });
        break;
      }
      case DBG_END_LOCAL: { const register = reader.uleb(cursor), ended = close(register, address); if (ended) info.ended = (info.ended ?? new Map()).set(register, ended); break; }
      case DBG_RESTART_LOCAL: {
        const register = reader.uleb(cursor), last = info.ended?.get(register) ?? [...info.locals].reverse().find(local => local.register === register);
        close(register, address);
        if (last) live.set(register, { register, name: last.name, type: last.type, signature: last.signature, start: address, end: Infinity });
        break;
      }
      case DBG_SET_PROLOGUE_END: case DBG_SET_EPILOGUE_BEGIN: break;
      case DBG_SET_FILE: reader.uleb(cursor); break;
      default: {
        const adjusted = op - DBG_FIRST_SPECIAL;
        line += DBG_LINE_BASE + (adjusted % DBG_LINE_RANGE); address += Math.floor(adjusted / DBG_LINE_RANGE);
        if (address < code.units) info.lines.push({ pc: address, line });
      }
    }
  }
  for (const local of live.values()) info.locals.push(local);
  delete info.ended;
  info.locals.sort((a, b) => a.start - b.start || a.register - b.register);
}

/** The source line of `pc` (the last line entry at or before it), or -1. */
export function lineAt(info, pc) {
  if (!info || !info.lines.length) return -1;
  let found = -1;
  for (const entry of info.lines) { if (entry.pc > pc) break; found = entry.line; }
  return found;
}
/** The addresses where line `line` starts (every line entry for it: a loop header has one for its test and one for its update). */
export const pcsOfLine = (info, line) => info ? [...new Set(info.lines.filter(entry => entry.line === line).map(entry => entry.pc))] : [];
/** Is `pc` the address of a line entry (the first instruction of a line)? */
export const isLineStart = (info, pc) => !!info && info.lines.some(entry => entry.pc === pc);
/** The locals live at `pc`: [{ register, name, type, signature }]. */
export const localsAt = (info, pc) => info ? info.locals.filter(local => pc >= local.start && pc < local.end) : [];

const sourceFiles = new WeakMap();   // dex -> Map(class descriptor -> source file name or null)
/** class_def.source_file_idx of `owner` in `dex` (null when absent). */
export function sourceFileOf(dex, owner) {
  let map = sourceFiles.get(dex); if (!map) sourceFiles.set(dex, map = new Map());
  if (map.has(owner)) return map.get(owner);
  let name = null;
  try {
    const index = dex.classes?.names?.get?.(owner);
    if (index !== undefined) { const at = dex.reader.u32(dex.classDefsOffset + index * 32 + 16); if (at !== NO_INDEX) name = dex.string(at); }
  } catch { name = null; }
  map.set(owner, name);
  return name;
}
