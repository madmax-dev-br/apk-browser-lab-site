import { createHostRegistry } from './host-contract.js?v=7268006482d0';
import { gcRoot } from './heap-gc.js?v=7268006482d0';

// java.text.Normalizer and Normalizer.Form (android-13.0.0_r1 libcore): Android delegates to ICU4J's Normalizer2 instances (NFC, NFD, NFKC, NFKD). The JavaScript engine's
// String.prototype.normalize implements the same Unicode normalization algorithms (UAX #15), so the four forms are answered by it; an unpaired surrogate passes through unchanged
// in both.
const NORMALIZER = 'Ljava/text/Normalizer;', FORM = 'Ljava/text/Normalizer$Form;', STRING = 'Ljava/lang/String;', CHARS = 'Ljava/lang/CharSequence;', OBJECT = 'Ljava/lang/Object;';
const FORMS = ['NFD', 'NFC', 'NFKD', 'NFKC'];

export function createTextNormalizerHost() {
  const registry = createHostRegistry(), { def, type } = registry;
  type(NORMALIZER, OBJECT, [], { allocatable: false }); type(FORM, 'Ljava/lang/Enum;', ['Ljava/lang/Comparable;', 'Ljava/io/Serializable;'], { allocatable: false });
  const tables = new WeakMap();
  const value = (r, name) => {
    const table = tables.get(r) ?? tables.set(r, gcRoot(new Map())).get(r);
    if (!table.has(name)) { const ref = r.makeObject(FORM), o = r.object(ref); o.enumName = name; o.enumOrdinal = FORMS.indexOf(name); table.set(name, ref); }
    return table.get(name);
  };
  for (const name of FORMS) registry.staticField(FORM, name, FORM, r => value(r, name));
  def(FORM, 'values', `()[${FORM}`, r => { const a = r.newArray(`[${FORM}`, FORMS.length); r.array(a).elements = FORMS.map(name => value(r, name)); return a; }, { static: true });
  def(FORM, 'valueOf', `(${STRING})${FORM}`, (r, _m, [name]) => {
    if (name === null || name === 0) r.throwJava('Ljava/lang/NullPointerException;', 'Name is null');
    const n = r.stringCharacters(name); if (!FORMS.includes(n)) r.throwJava('Ljava/lang/IllegalArgumentException;', `No enum constant java.text.Normalizer.Form.${n}`); return value(r, n);
  }, { static: true });
  const nullCheck = (r, v, what) => { if (v === null || v === 0 || v === undefined) r.throwJava('Ljava/lang/NullPointerException;', what); };
  const text = (r, v) => typeof v === 'string' ? v : r.stringCharacters(r.dispatch({ owner: OBJECT, name: 'toString', parameters: [], result: STRING, signature: `()${STRING}` }, [v], 'virtual'));
  const formOf = (r, f) => r.object(f).enumName;
  def(NORMALIZER, 'normalize', `(${CHARS}${FORM})${STRING}`, (r, _m, [src, form]) => { nullCheck(r, src, 'src'); nullCheck(r, form, 'form'); return text(r, src).normalize(formOf(r, form)); }, { static: true });
  def(NORMALIZER, 'isNormalized', `(${CHARS}${FORM})Z`, (r, _m, [src, form]) => { nullCheck(r, src, 'src'); nullCheck(r, form, 'form'); const s = text(r, src); return s.normalize(formOf(r, form)) === s ? 1 : 0; }, { static: true });
  return { ...registry, interfaces: registry.interfacesOf };
}
