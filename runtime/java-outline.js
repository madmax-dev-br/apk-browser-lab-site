// The "Java outline" of the Code browser (docs/CODE-BROWSER.md): a class's declarations in Java syntax -- package, modifiers, superclass and interfaces, fields with their
// constant values, constructors and methods with their signatures -- and, under each method, the string constants it loads, the methods it calls and the fields it reads
// or writes, as comments. It is NOT a decompilation: no statement of a method body is reconstructed (a faithful decompiler does not run here yet; the reasons are in the
// doc), and the text says so on its first line. The Smali tab has the exact code. Built from the class model of src/smali-disassembler.js. Pure module: no DOM, no process.*.
import { ACC, decodeInstruction, OPCODES, valueText, javaFloatText, javaDoubleText, floatOfBits, doubleOfBits } from './smali-disassembler.js?v=67f3eead5b24';

const PRIMITIVES = { V: 'void', Z: 'boolean', B: 'byte', S: 'short', C: 'char', I: 'int', J: 'long', F: 'float', D: 'double' };
/** A descriptor as Java writes it: int[], java.lang.String, Outer.Inner (relative to `pkg` when given: the class's own package is left out). */
export function javaType(descriptor, pkg = null) {
  let dims = 0; while (descriptor[dims] === '[') dims++;
  const base = descriptor.slice(dims);
  let name = PRIMITIVES[base] ?? (base.startsWith('L') && base.endsWith(';') ? base.slice(1, -1).replaceAll('/', '.') : base);
  if (base[0] === 'L') {
    if (name.startsWith('java.lang.') && !name.slice(10).includes('.')) name = name.slice(10);
    else if (pkg && name.startsWith(pkg + '.') && !name.slice(pkg.length + 1).includes('.')) name = name.slice(pkg.length + 1);
    name = name.replace(/\$(?=[^\d])/g, '.');
  }
  return name + '[]'.repeat(dims);
}
const classFlags = (flags, isInterface) => [flags & ACC.PUBLIC && 'public', flags & ACC.PRIVATE && 'private', flags & ACC.PROTECTED && 'protected', flags & ACC.STATIC && 'static',
  !isInterface && flags & ACC.ABSTRACT && !(flags & ACC.ANNOTATION) && 'abstract', flags & ACC.FINAL && !(flags & ACC.ENUM) && 'final'].filter(Boolean);
const memberFlags = (flags, kind) => [flags & ACC.PUBLIC && 'public', flags & ACC.PRIVATE && 'private', flags & ACC.PROTECTED && 'protected', flags & ACC.STATIC && 'static',
  flags & ACC.FINAL && 'final', kind === 'm' && flags & ACC.ABSTRACT && 'abstract', kind === 'm' && (flags & (ACC.SYNCHRONIZED | ACC.DECLARED_SYNCHRONIZED)) && 'synchronized',
  kind === 'm' && flags & ACC.NATIVE && 'native', kind === 'f' && flags & ACC.VOLATILE && 'volatile', kind === 'f' && flags & ACC.TRANSIENT && 'transient'].filter(Boolean);
function constantText(dex, value, type) {
  if (!value) return null;
  switch (value.t) {
    case 'boolean': return value.v ? 'true' : 'false';
    case 'byte': case 'short': case 'int': return String(value.v);
    case 'long': return `${value.v}L`;
    case 'char': { const c = Number(value.v); return c >= 0x20 && c < 0x7f && c !== 0x27 && c !== 0x5c ? `'${String.fromCharCode(c)}'` : `'\\u${c.toString(16).padStart(4, '0')}'`; }
    case 'float': { const f = floatOfBits(value.v); return Number.isFinite(f) ? `${javaFloatText(f)}f` : Number.isNaN(f) ? 'Float.NaN' : f > 0 ? 'Float.POSITIVE_INFINITY' : 'Float.NEGATIVE_INFINITY'; }
    case 'double': { const d = doubleOfBits(value.v); return Number.isFinite(d) ? javaDoubleText(d) : Number.isNaN(d) ? 'Double.NaN' : d > 0 ? 'Double.POSITIVE_INFINITY' : 'Double.NEGATIVE_INFINITY'; }
    case 'string': return JSON.stringify(dex.string(value.v));
    case 'null': return 'null';
    case 'type': return `${javaType(dex.type(value.v))}.class`;
    default: return `/* ${valueText(dex, value).replace(/\s+/g, ' ').slice(0, 120)} */`;
  }
}
/** What a method body uses, read from its instructions: { strings, calls, fields } (each in first-use order, without repeats). */
export function bodyUses(dex, code) {
  const strings = new Set(), calls = new Set(), fields = new Set();
  if (!code) return { strings: [], calls: [], fields: [] };
  const u = code.units;
  for (let pc = 0; pc < u.length;) {
    const ins = decodeInstruction(u, pc); pc += Math.max(1, ins.units);
    if (ins.unused || ins.bad || ins.fmt === 'payload') continue;
    const ref = OPCODES[ins.op]?.ref;
    try {
      if (ref === 's') strings.add(dex.string(ins.ref));
      else if (ref === 'm') { const m = dex.method(ins.ref); calls.add(`${m.owner}->${m.name}(${m.parameters.join('')})${m.result}`); }
      else if (ref === 'f') { const f = dex.field(ins.ref); fields.add(`${ins.name.startsWith('s') ? 'static ' : ''}${ins.name.includes('put') ? 'write' : 'read'} ${f.owner}->${f.name}:${f.type}`); }
    } catch { /* an index outside its table */ }
  }
  return { strings: [...strings], calls: [...calls], fields: [...fields] };
}
const callText = (key, pkg) => {
  const m = /^(L[^;]+;|\[[^-]*)->([^(]+)\(([^)]*)\)(.*)$/.exec(key); if (!m) return key;
  const params = []; let rest = m[3]; while (rest) { const t = /^\[*(?:[ZBSCIJFD]|L[^;]+;)/.exec(rest)?.[0]; if (!t) break; params.push(javaType(t, pkg)); rest = rest.slice(t.length); }
  return `${javaType(m[1], pkg)}.${m[2]}(${params.join(', ')})`;
};
const fieldUseText = (use, pkg) => { const m = /^((?:static )?(?:read|write)) (L[^;]+;)->([^:]+):(.*)$/.exec(use); return m ? `${m[1]} ${javaType(m[2], pkg)}.${m[3]}` : use; };

/**
 * The outline of the class `model` (src/smali-disassembler.js readClassModel). Returns { text, methodOfLine: Int32Array (index into `methods` for the lines of a method's
 * declaration and comments, -1 elsewhere), methods: [{ name, signature, line }] } -- the method indices follow the Smali tab's order (direct methods, then virtual).
 */
export function javaOutline(model) {
  const dex = model.dex, lines = [], marks = [];
  const pkgSlash = model.type.lastIndexOf('/'), pkg = pkgSlash > 0 ? model.type.slice(1, pkgSlash).replaceAll('/', '.') : '';
  const simple = javaType(model.type).split('.').pop();
  const isInterface = !!(model.flags & ACC.INTERFACE), isAnnotation = !!(model.flags & ACC.ANNOTATION), isEnum = !!(model.flags & ACC.ENUM);
  lines.push('// Java outline (not decompiled): the declarations of this class, the field constants, and what each method uses.');
  lines.push('// Method bodies are not reconstructed. The Smali tab has the exact code, and Edit method changes it there.');
  if (model.source) lines.push(`// Source file: ${model.source}`);
  lines.push('');
  if (pkg) { lines.push(`package ${pkg};`); lines.push(''); }
  for (const annotation of model.annotations) if (annotation.visibility !== 'system') lines.push(`@${javaType(annotation.type, pkg)}${annotation.elements.length ? `(${annotation.elements.map(e => `${e.name} = ${valueText(dex, e.value).replace(/\s+/g, ' ')}`).join(', ')})` : ''}`);
  const kind = isAnnotation ? '@interface' : isInterface ? 'interface' : isEnum ? 'enum' : 'class';
  let header = [...classFlags(model.flags, isInterface), kind, simple].join(' ');
  if (model.superclass && model.superclass !== 'Ljava/lang/Object;' && !(isEnum && model.superclass === 'Ljava/lang/Enum;')) header += ` extends ${javaType(model.superclass, pkg)}`;
  const interfaces = model.interfaces.filter(i => !(isAnnotation && i === 'Ljava/lang/annotation/Annotation;'));
  if (interfaces.length) header += ` ${isInterface ? 'extends' : 'implements'} ${interfaces.map(i => javaType(i, pkg)).join(', ')}`;
  lines.push(`${header} {`);
  const fieldLine = field => {
    const value = (field.flags & ACC.STATIC) ? constantText(dex, field.value, field.type) : null;
    return `    ${[...memberFlags(field.flags, 'f'), javaType(field.type, pkg), field.name].join(' ')}${value !== null ? ` = ${value}` : ''};${field.flags & ACC.SYNTHETIC ? '   // synthetic' : ''}`;
  };
  if (model.staticFields.length || model.instanceFields.length) {
    for (const field of model.staticFields) lines.push(fieldLine(field));
    for (const field of model.instanceFields) lines.push(fieldLine(field));
    lines.push('');
  }
  const methods = [];
  [...model.directMethods, ...model.virtualMethods].forEach((method, index) => {
    const signature = `(${method.parameters.join('')})${method.result}`, start = lines.length;
    methods.push({ name: method.name, signature, line: start });
    for (const annotation of method.annotations) if (annotation.visibility !== 'system') lines.push(`    @${javaType(annotation.type, pkg)}`);
    const params = method.parameters.map((t, i) => `${javaType(t, pkg)} p${i}`).join(', ');
    const flags = memberFlags(method.flags, 'm').filter(flag => !(isInterface && (flag === 'public' || flag === 'abstract')));
    let decl;
    if (method.name === '<clinit>') decl = 'static';
    else if (method.name === '<init>') decl = [...flags.filter(f => f !== 'static'), `${simple}(${params})`].join(' ');
    else decl = [...flags, javaType(method.result, pkg), `${method.name}(${params})`].join(' ');
    const notes = [];
    if (method.flags & ACC.SYNTHETIC) notes.push('synthetic'); if (method.flags & ACC.BRIDGE) notes.push('bridge');
    if (!method.code) { lines.push(`    ${decl};${notes.length ? `   // ${notes.join(', ')}` : ''}`); }
    else {
      const uses = bodyUses(dex, method.code);
      lines.push(`    ${decl} {${notes.length ? `   // ${notes.join(', ')}` : ''}`);
      lines.push(`        // ${method.code.units.length} code units, ${method.code.registers} registers${method.code.tries.length ? `, ${method.code.tries.length} try ranges` : ''}`);
      if (uses.strings.length) lines.push(`        // strings: ${uses.strings.slice(0, 20).map(s => JSON.stringify(s.length > 200 ? s.slice(0, 200) + '…' : s)).join(', ')}${uses.strings.length > 20 ? `, … (${uses.strings.length} in all)` : ''}`);
      for (const call of uses.calls.slice(0, 30)) lines.push(`        // calls ${callText(call, pkg)}`);
      if (uses.calls.length > 30) lines.push(`        // … and ${uses.calls.length - 30} more calls`);
      for (const use of uses.fields.slice(0, 20)) lines.push(`        // ${fieldUseText(use, pkg)}`);
      if (uses.fields.length > 20) lines.push(`        // … and ${uses.fields.length - 20} more field accesses`);
      lines.push('    }');
    }
    for (let line = start; line < lines.length; line++) marks[line] = index;
    lines.push('');
  });
  if (lines.at(-1) === '') lines.pop();
  lines.push('}');
  const methodOfLine = new Int32Array(lines.length).fill(-1); marks.forEach((index, line) => { if (index !== undefined) methodOfLine[line] = index; });
  return { text: lines.join('\n'), methodOfLine, methods };
}
