import { APKError } from './apk-runtime.js?v=2bb44ccf6413';
const ULOCALE = 'Landroid/icu/util/ULocale;', OPTIONAL = 'Ljava/util/Optional;', DISPLAY = 'Landroid/sysprop/DisplayProperties;';
const keys = new Set([`${ULOCALE}->forLocale(Ljava/util/Locale;)Landroid/icu/util/ULocale;`, `${ULOCALE}->isRightToLeft()Z`, `${DISPLAY}->debug_force_rtl()Ljava/util/Optional;`]);
const fail = message => { throw new APKError(message, { kind: 'locale-service-unsupported' }); };
/** CLDR locale information is an explicit browser system boundary. Configuration,
 * LocaleList, TextUtils and Optional algorithms remain original source DEX. */
export function createLocaleServiceHost(platform) {
  const properties = new Map();
  const call = (runtime, owner, name, signature, args, result) => runtime.dispatch({ owner, name, signature, parameters: signature.slice(1, signature.indexOf(')')).match(/L[^;]+;|[ZBCSIFJD]/g) || [], result }, args, 'static');
  return {
    properties,
    supports: key => keys.has(key),
    parent: type => type === ULOCALE ? 'Ljava/lang/Object;' : null,
    invoke(runtime, method, args) {
      if (method.owner === DISPLAY) {
        if (!runtime.classes.has(OPTIONAL)) fail('Original Optional DEX is required for DisplayProperties');
        if (!properties.has('debug.force_rtl')) return call(runtime, OPTIONAL, 'empty', '()Ljava/util/Optional;', [], OPTIONAL);
        const text = String(properties.get('debug.force_rtl')).toLowerCase();
        // The generated sysprop Boolean parser accepts only 0/1/false/true.
        if (!['0', '1', 'false', 'true'].includes(text)) return call(runtime, OPTIONAL, 'empty', '()Ljava/util/Optional;', [], OPTIONAL);
        const value = call(runtime, 'Ljava/lang/Boolean;', 'valueOf', '(Z)Ljava/lang/Boolean;', [text === '1' || text === 'true' ? 1 : 0], 'Ljava/lang/Boolean;');
        return call(runtime, OPTIONAL, 'of', '(Ljava/lang/Object;)Ljava/util/Optional;', [value], OPTIONAL);
      }
      if (method.name === 'forLocale') {
        if (!args[0]) runtime.throwJava('Ljava/lang/NullPointerException;', 'locale');
        const locale = runtime.object(args[0]);
        if (!runtime.isSubtype(locale.type, 'Ljava/util/Locale;') || !locale.localeData) fail('ULocale requires initialized VM Locale data');
        const ref = runtime.makeObject(ULOCALE);
        try { runtime.object(ref).intlLocale = new Intl.Locale(locale.localeData.tag); }
        catch { fail('The browser CLDR boundary cannot represent this VM locale'); }
        return ref;
      }
      const locale = runtime.object(args[0]).intlLocale;
      if (!locale) fail('ULocale used before forLocale initialization');
      const info = typeof locale.getTextInfo === 'function' ? locale.getTextInfo() : locale.textInfo;
      if (!info || !['ltr', 'rtl'].includes(info.direction)) fail('Intl.Locale text direction data is unavailable in this browser');
      runtime.record(`LOCALE ${locale.toString()} ${info.direction} [browser Intl.Locale / CLDR boundary]`);
      return info.direction === 'rtl' ? 1 : 0;
    },
  };
}
