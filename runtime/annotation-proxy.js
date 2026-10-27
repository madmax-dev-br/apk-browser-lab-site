// Object methods of the VM's annotation proxies (objects whose members come from DEX annotation metadata), following libcore's AnnotationFactory / the JDK's
// AnnotationInvocationHandler:
//   hashCode : sum over members of (127 * name.hashCode()) ^ valueHash   (array members through Arrays.hashCode of their element type)
//   equals   : same annotation type, and every member equal (arrays element-wise, floats/doubles by bit pattern like the wrappers do)
//   toString : @pkg.Type(member=value, ...), "value=" omitted for a lone `value` member; strings quoted, chars quoted, longs L, floats f, classes X.class
// Value representations are the VM's: int-like members are numbers, long members BigInt, float/double members raw bit patterns, strings JS strings.

import { bitsDouble, bitsFloat } from './host-contract.js?v=79e2ded60c95';

const stringHash = text => { let n = 0; for (let i = 0; i < text.length; i++) n = (Math.imul(n, 31) + text.charCodeAt(i)) | 0; return n; };
const isArrayType = type => type.startsWith('[');
const FLOAT_NAN = 0x7fc00000, DOUBLE_NAN = 0x7ff8000000000000n;
const floatBitsOf = (rt, v) => { const f = bitsFloat(v); return Number.isNaN(f) ? FLOAT_NAN : (v | 0); };

/** Members of an annotation type in declaration order: [{ name, type }] for the abstract no-argument methods. */
export function annotationMembers(rt, type) {
  const cls = rt.classes.get(type), members = [];
  if (!cls) return members;
  for (const [key, def] of cls.methods) {
    if (!(def.flags & 0x400)) continue; // abstract
    const open = key.indexOf('('); if (key.slice(open, open + 2) !== '()') continue;
    members.push({ name: key.slice(0, open), type: key.slice(open + 2) });
  }
  return members;
}

/** The member's value: the explicit DEX element, else the AnnotationDefault of the annotation type. */
export function annotationMemberValue(rt, proxy, member) {
  const values = proxy.annotationValues;
  if (values.has(member.name)) return rt.materialize(values.get(member.name), member.type);
  const defaults = rt.classAnnotations(proxy.type, 2).find(a => a.type === 'Ldalvik/annotation/AnnotationDefault;')?.values.get('value');
  if (defaults?.encoded === 'annotation' && defaults.values.has(member.name)) return rt.materialize(defaults.values.get(member.name), member.type);
  return undefined;
}

function elementHash(rt, v, type) {
  switch (type) {
    case 'I': case 'S': case 'B': return v | 0;
    case 'C': return v & 0xffff;
    case 'Z': return v ? 1231 : 1237;
    case 'J': { const u = BigInt.asUintN(64, BigInt(v)); return Number(BigInt.asIntN(32, u ^ (u >> 32n))); }
    case 'F': return floatBitsOf(rt, v);
    case 'D': { let u = BigInt.asUintN(64, BigInt(v)); if (Number.isNaN(bitsDouble(v))) u = DOUBLE_NAN; return Number(BigInt.asIntN(32, u ^ (u >> 32n))); }
    default: return rt.javaHash(v);
  }
}
function valueHash(rt, v, type) {
  if (!isArrayType(type)) return elementHash(rt, v, type);
  if (v === null || v === 0 || v === undefined) return 0;
  let h = 1; for (const e of rt.array(v).elements) h = (Math.imul(31, h) + (e === null ? 0 : elementHash(rt, e, type.slice(1)))) | 0; return h;
}
export function annotationHash(rt, proxy) {
  let sum = 0;
  for (const m of annotationMembers(rt, proxy.type)) sum = (sum + (Math.imul(127, stringHash(m.name)) ^ valueHash(rt, annotationMemberValue(rt, proxy, m), m.type))) | 0;
  return sum;
}

function elementEquals(rt, a, b, type) {
  switch (type) {
    case 'F': return floatBitsOf(rt, a) === floatBitsOf(rt, b);
    case 'D': { const x = Number.isNaN(bitsDouble(a)) ? DOUBLE_NAN : BigInt.asUintN(64, BigInt(a)), y = Number.isNaN(bitsDouble(b)) ? DOUBLE_NAN : BigInt.asUintN(64, BigInt(b)); return x === y; }
    case 'J': return BigInt(a) === BigInt(b);
    case 'I': case 'S': case 'B': case 'C': case 'Z': return a === b;
    default: return rt.javaEquals(a, b);
  }
}
function valueEquals(rt, a, b, type) {
  if (!isArrayType(type)) return elementEquals(rt, a, b, type);
  const x = a == null || a === 0 ? null : rt.array(a).elements, y = b == null || b === 0 ? null : rt.array(b).elements;
  if (x === null || y === null) return x === y;
  return x.length === y.length && x.every((e, i) => elementEquals(rt, e, y[i], type.slice(1)));
}
export function annotationEquals(rt, proxy, other) {
  if (other === null || other === undefined || other === 0) return false;
  if (!rt.isSubtype(rt.typeOf(other), proxy.type)) return false;
  const o = typeof other === 'string' ? null : rt.object(other);
  if (!o?.annotationValues) return false; // an annotation implemented by app code would need member calls; the DEX annotation proxies are the only source here
  return annotationMembers(rt, proxy.type).every(m => valueEquals(rt, annotationMemberValue(rt, proxy, m), annotationMemberValue(rt, o, m), m.type));
}

const dotted = type => type.slice(1, -1).replaceAll('/', '.').replaceAll('$', '.');
function valueText(rt, v, type) {
  switch (type) {
    case 'Ljava/lang/String;': return JSON.stringify(v ?? null);
    case 'C': return `'${String.fromCharCode(v)}'`;
    case 'J': return `${BigInt.asIntN(64, BigInt(v))}L`;
    case 'F': return `${bitsFloat(v) ?? v}f`;
    case 'D': return String(bitsDouble(v) ?? v);
    case 'B': return `(byte)0x${(v & 0xff).toString(16).padStart(2, '0')}`;
    case 'Z': return v ? 'true' : 'false';
    case 'I': case 'S': return String(v | 0);
    case 'Ljava/lang/Class;': return `${dotted(rt.object(v).classType)}.class`;
    default: {
      if (v === null || v === 0 || v === undefined) return 'null';
      const o = rt.object(v);
      if (o.annotationValues) return annotationToString(rt, o);
      if (rt.isSubtype(o.type, 'Ljava/lang/Enum;')) return String(o.fields.get('Ljava/lang/Enum;->name:Ljava/lang/String;') ?? '');
      return String(rt.javaHash(v));
    }
  }
}
export function annotationToString(rt, proxy) {
  const members = annotationMembers(rt, proxy.type);
  const parts = members.map(m => {
    const v = annotationMemberValue(rt, proxy, m);
    const text = isArrayType(m.type) ? `{${(v == null || v === 0 ? [] : rt.array(v).elements).map(e => valueText(rt, e, m.type.slice(1))).join(', ')}}` : valueText(rt, v, m.type);
    return members.length === 1 && m.name === 'value' ? text : `${m.name}=${text}`;
  });
  return `@${dotted(proxy.type)}(${parts.join(', ')})`;
}
