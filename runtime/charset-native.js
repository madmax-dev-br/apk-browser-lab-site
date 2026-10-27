import { APKError } from './apk-error.js?v=751a2d13ee0f';
import { CHARSET_DATA } from './charset-data.js?v=751a2d13ee0f';
import { closeConverterHandle } from './icu-converter-native.js?v=751a2d13ee0f';

const CONVERTER = 'Lcom/android/icu/charset/NativeConverter;';
const CHARSET = 'Ljava/nio/charset/Charset;';
const CHARSET_ICU = 'Lcom/android/icu/charset/CharsetICU;';
const REGISTRY = 'Llibcore/util/NativeAllocationRegistry;';
const FINALIZER = 0x43484152534554n;
// ICU converter-name matching is ASCII case-insensitive and ignores these
// separators. Java Charset.checkName still executes from the original source.
const keyOf = name => name.replace(/[-_ ]/g, '').toLowerCase();
const aliases = new Map();
for (const data of CHARSET_DATA) for (const alias of data.lookupAliases) aliases.set(keyOf(alias), data);
export const lookupCharset = text => lookup(text);
const lookup = text => aliases.get(keyOf(text)) ?? (text.startsWith('x-') ? aliases.get(keyOf(text.slice(2))) : null);

/** Explicit ICU name/repertoire boundary. No decoder, encoder or APK JNI is supplied. */
export function createCharsetNativeBindings() {
  return new Map([
    [`${CONVERTER}->getNativeFinalizer()J`, () => FINALIZER],
    [`${CONVERTER}->charsetForName(Ljava/lang/String;)${CHARSET}`, (runtime, [name]) => {
      if (name === null || name === 0) runtime.throwJava('Ljava/lang/NullPointerException;', 'Null ICU charset name');
      const data = lookup(runtime.stringCharacters(name));
      if (!data) return null;
      const names = runtime.newArray('[Ljava/lang/String;', data.aliases.length);
      runtime.array(names).elements = data.aliases.slice();
      const charset = runtime.allocate(CHARSET_ICU);
      runtime.dispatch({ owner: CHARSET_ICU, name: '<init>', parameters: ['Ljava/lang/String;', 'Ljava/lang/String;', '[Ljava/lang/String;'], result: 'V',
        signature: '(Ljava/lang/String;Ljava/lang/String;[Ljava/lang/String;)V' }, [charset, data.canonical, data.icu === 'UTF-16' ? 'UTF-16,version=2' : data.icu, names], 'direct');
      runtime.record(`CHARSET ${data.canonical} [curated Android13 ICU name data; codecs unavailable]`);
      return charset;
    }],
    [`${CONVERTER}->contains(Ljava/lang/String;Ljava/lang/String;)Z`, (runtime, [left, right]) => {
      const a = lookup(runtime.stringCharacters(left)), b = lookup(runtime.stringCharacters(right));
      if (!a || !b) throw new APKError('Charset repertoire outside the curated six-charset ICU profile', { kind: 'unsupported-charset-profile' });
      const rank = { ascii: 0, latin1: 1, unicode: 2 };
      return rank[a.repertoire] >= rank[b.repertoire] ? 1 : 0;
    }],
  ]);
}

export const CHARSET_CLEANER = 'Lapkweb/bridge/CharsetCleaner;';
/** NativeAllocationRegistry.registerNativeAllocation(referent, converterHandle) for the ICU converter finalizer, and the returned cleaner's run(). The VM has no
 * garbage collector, so nothing runs a cleaner automatically; run() closes the ICU converter exactly once if called explicitly. */
export function charsetRegistryRegistration(runtime, method, args) {
  if (method.owner === REGISTRY && method.name === 'registerNativeAllocation' && method.signature === '(Ljava/lang/Object;J)Ljava/lang/Runnable;') {
    const registry = runtime.object(args[0]);
    if (registry.fields.get(`${REGISTRY}->freeFunction:J`) !== FINALIZER) return null;
    if (args[2] === 0n) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'nativePtr is null');
    const cleaner = runtime.makeObject(CHARSET_CLEANER); runtime.object(cleaner).converterHandle = args[2];
    return { value: cleaner };
  }
  if (method.name === 'run' && method.signature === '()V' && args[0] && runtime.object(args[0]).type === CHARSET_CLEANER) {
    const cleaner = runtime.object(args[0]);
    if (cleaner.converterHandle) { const handle = cleaner.converterHandle; cleaner.converterHandle = 0n; closeConverterHandle(runtime, handle); }
    return { value: undefined };
  }
  return null;
}
/** Registry creation owns only the known converter finalizer token. There are
 * no converter allocations in this lookup-only profile. Registration/decoding
 * remain unsupported instead of fabricating a live native converter or GC.
 */
export function charsetRegistryCreation(runtime, method, args) {
  if (method.owner !== REGISTRY || method.name !== 'createMalloced' || method.signature !== `(Ljava/lang/ClassLoader;J)${REGISTRY}` || args[1] !== FINALIZER) return null;
  const value = runtime.makeObject(REGISTRY);
  runtime.storeField(runtime.object(value).fields, `${REGISTRY}->classLoader:Ljava/lang/ClassLoader;`, args[0]);
  runtime.storeField(runtime.object(value).fields, `${REGISTRY}->freeFunction:J`, FINALIZER);
  runtime.storeField(runtime.object(value).fields, `${REGISTRY}->size:J`, 1n);
  runtime.record('ALLOCATION_REGISTRY converter finalizer [VM token; no converter allocation/automatic GC]');
  return { value };
}
