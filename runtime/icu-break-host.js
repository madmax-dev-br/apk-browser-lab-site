import { APKError } from './apk-error.js?v=c81d48011848';

export const ICU_BREAK = 'Landroid/icu/text/BreakIterator;';
export const ICU_BREAK_INSTANCE = 'Lapkweb/bridge/ICUBreakIterator;';
const ITERATOR = 'Ljava/text/CharacterIterator;', STRING_ITERATOR = 'Ljava/text/StringCharacterIterator;', LOCALE = 'Ljava/util/Locale;';
const methods = ['first()I', 'last()I', 'next()I', 'next(I)I', 'previous()I', 'following(I)I', 'preceding(I)I', 'isBoundary(I)Z', 'current()I',
  `getText()${ITERATOR}`, `setText(${ITERATOR})V`, 'setText(Ljava/lang/String;)V', 'clone()Ljava/lang/Object;'];
export const ICU_BREAK_KEYS = new Set(methods.flatMap(method => [ICU_BREAK + '->' + method, ICU_BREAK_INSTANCE + '->' + method]));
for (const kind of ['Line', 'Word', 'Character', 'Sentence']) for (const parameter of ['', LOCALE]) ICU_BREAK_KEYS.add(`${ICU_BREAK}->get${kind}Instance(${parameter})${ICU_BREAK}`);
const fail = message => { throw new APKError(message, { kind: 'icu-break-boundary', backend: 'original-ICU4C/Wasm' }); };
const nullish = value => value === null || value === undefined || value === 0;
const call = (runtime, receiver, owner, name, parameters = [], result = 'I', values = [], mode = 'virtual') => runtime.dispatch(
  { owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, runtime.argumentWords(parameters, values, mode === 'static' ? {} : { receiver }), mode);

/** The original java.text classes remain in DEX. This adapter replaces only
 * their android.icu service with the original ICU4C rule engine in Wasm.
 * Boundary computation never uses a JS regexp or word-segmentation substitute.
 */
export function invokeICUBreak(runtime, method, args) {
  const backend = runtime.icuBreakBackend;
  if (!backend || typeof backend.breaks !== 'function') fail('Original ICU break-analysis Wasm is not loaded');
  const name = method.name;
  const makeStringIterator = text => {
    const value = runtime.allocate(STRING_ITERATOR);
    call(runtime, value, STRING_ITERATOR, '<init>', ['Ljava/lang/String;'], 'V', [text], 'direct');
    return value;
  };
  const readIterator = reference => {
    if (nullish(reference)) runtime.throwJava('Ljava/lang/NullPointerException;', 'CharacterIterator is null');
    if (!runtime.isSubtype(runtime.typeOf(reference), ITERATOR)) runtime.throwJava('Ljava/lang/ClassCastException;', 'Expected CharacterIterator');
    const begin = call(runtime, reference, ITERATOR, 'getBeginIndex'), end = call(runtime, reference, ITERATOR, 'getEndIndex');
    if (!Number.isInteger(begin) || !Number.isInteger(end) || begin < 0 || end < begin || end - begin > 65536) fail('CharacterIterator exceeds the 65536 UTF16-unit ICU limit');
    let text = '';
    for (let index = begin; index < end; index++) text += String.fromCharCode(call(runtime, reference, ITERATOR, 'setIndex', ['I'], 'C', [index]));
    call(runtime, reference, ITERATOR, 'setIndex', ['I'], 'C', [begin]);
    return { text, begin, end, reference };
  };
  const replaceText = (state, reference) => {
    const data = readIterator(reference), offsets = backend.breaks(data.text, state.locale, state.kind);
    if (!Array.isArray(offsets) && !ArrayBuffer.isView(offsets)) fail('Invalid ICU boundary output');
    if (!offsets.length || offsets.length > 65537 || offsets[0] !== 0 || offsets.at(-1) !== data.text.length ||
      [...offsets].some((offset, index) => !Number.isInteger(offset) || offset < 0 || offset > data.text.length || index && offset <= offsets[index - 1])) fail('ICU returned invalid UTF16 boundaries');
    runtime.reserveCollection(offsets.length + data.text.length - (state.offsets?.length ?? 0) - (state.text?.length ?? 0));
    Object.assign(state, data, { offsets: Array.from(offsets, offset => offset + data.begin), cursor: 0 });
  };
  if (/^get(Line|Word|Character|Sentence)Instance$/.test(name)) {
    const localeRef = method.parameters.length ? args[0] : call(runtime, null, LOCALE, 'getDefault', [], LOCALE, [], 'static');
    if (nullish(localeRef)) runtime.throwJava('Ljava/lang/NullPointerException;', 'Locale is null');
    const data = runtime.object(localeRef).localeData;
    if (!data) fail('ICU requires the VM Locale language state');
    const locale = data.tag || [data.language, data.country, data.variant].filter(Boolean).join('-') || 'und';
    const reference = runtime.makeObject(ICU_BREAK_INSTANCE), state = { locale, kind: name.slice(3, -8).toLowerCase() };
    replaceText(state, makeStringIterator('')); runtime.object(reference).icuBreak = state;
    runtime.icuBreakMetadata = backend.metadata;
    return reference;
  }
  const state = runtime.object(args[0]).icuBreak;
  if (!state) fail('BreakIterator has no initialized ICU state');
  const current = () => state.offsets[state.cursor];
  const move = index => {
    const done = index < 0 || index >= state.offsets.length;
    state.cursor = Math.max(0, Math.min(state.offsets.length - 1, index));
    call(runtime, state.reference, ITERATOR, 'setIndex', ['I'], 'C', [current()]);
    return done ? -1 : current();
  };
  const lowerBound = offset => {
    let low = 0, high = state.offsets.length;
    while (low < high) { const middle = (low + high) >>> 1; if (state.offsets[middle] < offset) low = middle + 1; else high = middle; }
    return low;
  };
  if (name === 'setText') {
    if (nullish(args[1])) runtime.throwJava('Ljava/lang/NullPointerException;', 'BreakIterator text is null');
    replaceText(state, method.parameters[0] === ITERATOR ? args[1] : makeStringIterator(args[1])); return;
  }
  if (name === 'getText') return state.reference;
  if (name === 'current') return current();
  if (name === 'first') return move(0);
  if (name === 'last') return move(state.offsets.length - 1);
  if (name === 'next') return move(state.cursor + (method.parameters.length ? args[1] : 1));
  if (name === 'previous') return move(state.cursor - 1);
  if (name === 'isBoundary') {
    if (args[1] < state.begin || args[1] > state.end) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'offset out of bounds');
    const index = lowerBound(args[1]), found = state.offsets[index] === args[1]; move(index); return found ? 1 : 0;
  }
  if (name === 'following') {
    if (args[1] < state.begin) return move(0);
    if (args[1] >= state.end) { move(state.offsets.length - 1); return -1; }
    const index = lowerBound(args[1]); return move(index + (state.offsets[index] === args[1] ? 1 : 0));
  }
  if (name === 'preceding') {
    if (args[1] > state.end) return move(state.offsets.length - 1);
    if (args[1] < state.begin) return move(0);
    // ICU4J first normalizes an offset inside a surrogate pair to its lead.
    let offset = args[1]; const local = offset - state.begin;
    if (local > 0 && local < state.text.length && /[\uDC00-\uDFFF]/.test(state.text[local]) && /[\uD800-\uDBFF]/.test(state.text[local - 1])) offset--;
    return move(lowerBound(offset) - 1);
  }
  if (name === 'clone') {
    const value = runtime.makeObject(ICU_BREAK_INSTANCE);
    const reference = call(runtime, state.reference, ITERATOR, 'clone', [], 'Ljava/lang/Object;');
    runtime.reserveCollection(state.offsets.length + state.text.length);
    runtime.object(value).icuBreak = { ...state, reference, offsets: state.offsets.slice() }; return value;
  }
  fail('Unsupported ICU iterator operation: ' + name);
}
