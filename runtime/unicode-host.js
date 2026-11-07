import { createHostRegistry } from './host-contract.js?v=ccd10c551257';
import { gcRoot } from './heap-gc.js?v=ccd10c551257';
import { UNICODE_BLOCKS, UNICODE_SCRIPTS } from './unicode-data.js?v=ccd10c551257';

// java.lang.Character.UnicodeBlock and Character.UnicodeScript (libcore android-13.0.0_r1 Character.java). The tables (block constants with aliases, range starts, script ranges and aliases)
// are generated from that source by scripts/build-unicode-data.py; the lookups below are the methods' own algorithms.
const CHARACTER = 'Ljava/lang/Character;', SUBSET = 'Ljava/lang/Character$Subset;', BLOCK = 'Ljava/lang/Character$UnicodeBlock;', SCRIPT = 'Ljava/lang/Character$UnicodeScript;', STRING = 'Ljava/lang/String;', ENUM = 'Ljava/lang/Enum;';

export function createUnicodeHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const nullish = value => value === null || value === undefined || value === 0;
  const iae = (r, message = null) => r.throwJava('Ljava/lang/IllegalArgumentException;', message);
  type(SUBSET, 'Ljava/lang/Object;', [], { allocatable: false }); type(BLOCK, SUBSET, [], { allocatable: false }); type(SCRIPT, ENUM, [], { allocatable: false });
  const roots = new WeakMap();   // per runtime: the one object of each constant
  const table = r => roots.get(r) ?? roots.set(r, { blocks: gcRoot(new Map()), scripts: gcRoot(new Map()) }).get(r);
  const isValid = cp => cp >= 0 && cp <= 0x10ffff;

  // ---- UnicodeBlock
  const { constants, starts, blocks } = UNICODE_BLOCKS;
  const blockObject = (r, index) => {
    const known = table(r).blocks; if (!known.has(index)) { const ref = r.makeObject(BLOCK); r.object(ref).subsetName = constants[index].idName; known.set(index, ref); } return known.get(index);
  };
  constants.forEach((constant, index) => registry.staticField(BLOCK, constant.name, BLOCK, r => blockObject(r, index)));
  const byName = new Map(); constants.forEach((constant, index) => { if (constant.mapped) { byName.set(constant.idName, index); for (const alias of constant.aliases) byName.set(alias, index); } });
  const blockOf = (r, codePoint) => {
    if (!isValid(codePoint)) iae(r);
    let bottom = 0, top = starts.length, current = top >> 1;
    while (top - bottom > 1) { if (codePoint >= starts[current]) bottom = current; else top = current; current = (top + bottom) >> 1; }
    return blocks[current] === null ? null : blockObject(r, blocks[current]);
  };
  def(BLOCK, 'of', `(C)${BLOCK}`, (r, _m, [c]) => blockOf(r, c), { static: true });
  def(BLOCK, 'of', `(I)${BLOCK}`, (r, _m, [cp]) => blockOf(r, cp), { static: true });
  def(BLOCK, 'forName', `(${STRING})${BLOCK}`, (r, _m, [name]) => {
    if (nullish(name)) r.throwJava('Ljava/lang/NullPointerException;', null);
    const index = byName.get(r.stringCharacters(name).toUpperCase()); if (index === undefined) iae(r); return blockObject(r, index);
  }, { static: true });
  def(BLOCK, 'toString', `()${STRING}`, (r, _m, [self]) => r.object(self).subsetName);
  def(BLOCK, 'equals', '(Ljava/lang/Object;)Z', (r, _m, [self, other]) => (self === other ? 1 : 0));
  def(BLOCK, 'hashCode', '()I', (r, _m, [self]) => r.dispatch({ owner: 'Ljava/lang/System;', name: 'identityHashCode', parameters: ['Ljava/lang/Object;'], result: 'I', signature: '(Ljava/lang/Object;)I' }, [self], 'static'));

  // ---- UnicodeScript
  const { names, starts: scriptStarts, scripts, aliases } = UNICODE_SCRIPTS;
  const scriptObject = (r, index) => {
    const known = table(r).scripts; if (!known.has(index)) { const ref = r.makeObject(SCRIPT), o = r.object(ref); o.enumName = names[index]; o.enumOrdinal = index; known.set(index, ref); } return known.get(index);
  };
  names.forEach((name, index) => registry.staticField(SCRIPT, name, SCRIPT, r => scriptObject(r, index)));
  def(SCRIPT, 'values', `()[${SCRIPT}`, r => { const array = r.newArray(`[${SCRIPT}`, names.length); r.array(array).elements = names.map((_, index) => scriptObject(r, index)); return array; }, { static: true });
  const valueOf = (r, name) => { const index = names.indexOf(name); if (index < 0) iae(r, `No enum constant java.lang.Character.UnicodeScript.${name}`); return scriptObject(r, index); };
  def(SCRIPT, 'valueOf', `(${STRING})${SCRIPT}`, (r, _m, [name]) => { if (nullish(name)) r.throwJava('Ljava/lang/NullPointerException;', 'Name is null'); return valueOf(r, r.stringCharacters(name)); }, { static: true });
  def(SCRIPT, 'of', `(I)${SCRIPT}`, (r, _m, [cp]) => {
    if (!isValid(cp)) iae(r);
    if (r.dispatch({ owner: CHARACTER, name: 'getType', parameters: ['I'], result: 'I', signature: '(I)I' }, [cp], 'static') === 0) return scriptObject(r, names.indexOf('UNKNOWN'));   // UNASSIGNED
    let low = 0, high = scriptStarts.length - 1;   // Arrays.binarySearch(scriptStarts, cp), then -index - 2 for a miss
    let index = -1;
    while (low <= high) { const mid = (low + high) >>> 1; if (scriptStarts[mid] < cp) low = mid + 1; else if (scriptStarts[mid] > cp) high = mid - 1; else { index = mid; break; } }
    if (index < 0) index = low - 1;   // -(-(low) - 1) - 2
    return scriptObject(r, scripts[index]);
  }, { static: true });
  def(SCRIPT, 'forName', `(${STRING})${SCRIPT}`, (r, _m, [name]) => {
    if (nullish(name)) r.throwJava('Ljava/lang/NullPointerException;', null);
    const upper = r.stringCharacters(name).toUpperCase(); const alias = aliases[upper]; return alias !== undefined ? valueOf(r, alias) : valueOf(r, upper);
  }, { static: true });
  return { ...registry, interfaces: registry.interfacesOf };
}
