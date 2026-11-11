import { createHostRegistry } from './host-contract.js?v=f6a892d62d6e';

// More of android.content.res.Resources over the app's resource table (frameworks/base/core/java/android/content/res/Resources.java + ResourcesImpl.java, android-13.0.0_r1):
//  getQuantityText / getQuantityString (plurals: the CLDR rule for the configuration's locale picks the item, "other" is the fallback, NotFoundException when neither exists),
//  getString(id, Object...) (String.format with the configuration locale), getText(id, default) and getFloat(id).
const RESOURCES = 'Landroid/content/res/Resources;', STRING = 'Ljava/lang/String;', CHARSEQ = 'Ljava/lang/CharSequence;', OBJECTS = '[Ljava/lang/Object;', NOT_FOUND = 'Landroid/content/res/Resources$NotFoundException;';
const ATTR = { other: 0x01000004, zero: 0x01000005, one: 0x01000006, two: 0x01000007, few: 0x01000008, many: 0x01000009 };   // ResourceTypes.h ATTR_OTHER ... ATTR_MANY

export function createResourcesExtrasHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  const hex = id => (id >>> 0).toString(16);
  const resolve = id => { try { return platform.resources?.resolve(id) ?? { kind: 'unresolved' }; } catch { return { kind: 'unresolved' }; } };
  const text = (value) => (value.kind === 'string' ? value.value : null);

  const quantityText = (r, id, quantity) => {
    const bag = resolve(id);
    if (bag.kind !== 'bag') r.throwJava(NOT_FOUND, `Plural resource ID #0x${hex(id)} quantity=${quantity} item=other`);
    const tag = platform.device?.locale && platform.device.locale !== 'und' ? platform.device.locale : 'en-US';
    let keyword; try { keyword = new Intl.PluralRules(tag).select(quantity); } catch { keyword = 'other'; }
    const item = code => { const found = bag.items.find(entry => (entry.name >>> 0) === ATTR[code]); if (!found) return null; const value = found.dataType === 1 ? resolve(found.rawData) : found; return text(value); };
    const chosen = item(keyword) ?? item('other');
    if (chosen === null) r.throwJava(NOT_FOUND, `Plural resource ID #0x${hex(id)} quantity=${quantity} item=${keyword}`);
    return chosen;
  };
  const format = (r, pattern, args) => {
    const locale = platform.locale(r, platform.device?.locale ?? 'en-US');
    return r.stringCharacters(r.dispatch({ owner: 'Ljava/lang/String;', name: 'format', parameters: ['Ljava/util/Locale;', STRING, OBJECTS], result: STRING, signature: `(Ljava/util/Locale;${STRING}${OBJECTS})${STRING}` }, [locale, pattern, args], 'static'));
  };
  const string = (r, id) => { const value = resolve(id); if (value.kind !== 'string') r.throwJava(NOT_FOUND, `String resource ID #0x${hex(id)}`); return value.kind === 'string' ? value.value : null; };

  def(RESOURCES, 'getQuantityText', `(II)${CHARSEQ}`, (r, _m, [, id, quantity]) => quantityText(r, id, quantity));
  def(RESOURCES, 'getQuantityString', `(II)${STRING}`, (r, _m, [, id, quantity]) => quantityText(r, id, quantity));
  def(RESOURCES, 'getQuantityString', `(II${OBJECTS})${STRING}`, (r, _m, [, id, quantity, args]) => format(r, quantityText(r, id, quantity), args));
  def(RESOURCES, 'getString', `(I${OBJECTS})${STRING}`, (r, _m, [, id, args]) => format(r, string(r, id), args));
  def(RESOURCES, 'getText', `(I${CHARSEQ})${CHARSEQ}`, (r, _m, [, id, fallback]) => { const value = id === 0 ? null : text(resolve(id)); return value ?? fallback; });
  def(RESOURCES, 'getFloat', '(I)F', (r, _m, [, id]) => {   // Resources.getFloat: a TYPE_FLOAT value
    const value = resolve(id);
    if (value.dataType !== 4) r.throwJava(NOT_FOUND, `Resource ID #0x${hex(id)} type #0x${(value.dataType ?? 0).toString(16)} is not valid`);
    return value.rawData | 0;
  });
  return { ...registry };
}
