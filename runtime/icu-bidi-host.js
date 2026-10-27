import { createHostRegistry } from './host-contract.js?v=fd59ee7c3d79';
import { androidCharacterDirectionality } from './unicode-bidi-data.js?v=fd59ee7c3d79';

// android.icu.text.Bidi (the part android.text.AndroidBidi uses): the Unicode Bidirectional Algorithm (UAX #9, rules P2-P3, X1-X10,
// W1-W7, N0-N2, I1-I2, L1) over the Android 13 Bidi_Class data of unicode-bidi-data.js. Levels are per UTF-16 unit.
// Scope: no explicit embedding-level input, no reordering API (Android's Java Layout reorders from the levels itself).
const nullish = value => value == null || value === 0;
const BIDI = 'Landroid/icu/text/Bidi;', CHARS = '[C', BYTES = '[B';
const L = 0, R = 1, AL = 2, EN = 3, ES = 4, ET = 5, AN = 6, CS = 7, NSM = 8, BN = 9, B = 10, S = 11, WS = 12, ON = 13, LRE = 14, LRO = 15, RLE = 16, RLO = 17, PDF = 18, LRI = 19, RLI = 20, FSI = 21, PDI = 22;
const MAX_DEPTH = 125, LEVEL_DEFAULT_LTR = 0x7e, LEVEL_DEFAULT_RTL = 0x7f;
const isolateInitiator = t => t === LRI || t === RLI || t === FSI, removed = t => t === BN || (t >= LRE && t <= PDF);
const neutral = t => t === B || t === S || t === WS || t === ON || t >= LRI;
const strongOrNumber = t => t === L ? L : (t === R || t === EN || t === AN) ? R : -1; // N0/N1: numbers count as R
const BRACKETS = new Map(); for (const [open, close] of [[0x28, 0x29], [0x5b, 0x5d], [0x7b, 0x7d], [0xf3a, 0xf3b], [0xf3c, 0xf3d], [0x169b, 0x169c], [0x2045, 0x2046], [0x207d, 0x207e], [0x208d, 0x208e], [0x2308, 0x2309], [0x230a, 0x230b], [0x2329, 0x232a], [0x2768, 0x2769], [0x276a, 0x276b], [0x276c, 0x276d], [0x276e, 0x276f], [0x2770, 0x2771], [0x2772, 0x2773], [0x2774, 0x2775], [0x27c5, 0x27c6], [0x27e6, 0x27e7], [0x27e8, 0x27e9], [0x27ea, 0x27eb], [0x27ec, 0x27ed], [0x27ee, 0x27ef], [0x2983, 0x2984], [0x2985, 0x2986], [0x2987, 0x2988], [0x2989, 0x298a], [0x298b, 0x298c], [0x298d, 0x2990], [0x298f, 0x298e], [0x2991, 0x2992], [0x2993, 0x2994], [0x2995, 0x2996], [0x2997, 0x2998], [0x29d8, 0x29d9], [0x29da, 0x29db], [0x29fc, 0x29fd], [0x2e22, 0x2e23], [0x2e24, 0x2e25], [0x2e26, 0x2e27], [0x2e28, 0x2e29], [0x3008, 0x3009], [0x300a, 0x300b], [0x300c, 0x300d], [0x300e, 0x300f], [0x3010, 0x3011], [0x3014, 0x3015], [0x3016, 0x3017], [0x3018, 0x3019], [0x301a, 0x301b], [0xfe59, 0xfe5a], [0xfe5b, 0xfe5c], [0xfe5d, 0xfe5e], [0xff08, 0xff09], [0xff3b, 0xff3d], [0xff5b, 0xff5d], [0xff5f, 0xff60], [0xff62, 0xff63]]) { BRACKETS.set(open, {close, open: true}); BRACKETS.set(close, {open, open: false}); }
const canonicalBracket = cp => cp === 0x2329 ? 0x3008 : cp === 0x232a ? 0x3009 : cp;

function classOf(cp) {
  if (cp >= 0x2066 && cp <= 0x2069) return [LRI, RLI, FSI, PDI][cp - 0x2066];
  const d = androidCharacterDirectionality(cp); if (d >= 0) return d;
  // Unassigned code points take the default class of their block (DerivedBidiClass.txt defaults).
  if ((cp >= 0x590 && cp <= 0x5ff) || (cp >= 0x7c0 && cp <= 0x85f) || (cp >= 0xfb1d && cp <= 0xfb4f) || (cp >= 0x10800 && cp <= 0x10cff) || (cp >= 0x10d40 && cp <= 0x10ebf) || (cp >= 0x10f00 && cp <= 0x10f2f) || (cp >= 0x10f70 && cp <= 0x10fff) || (cp >= 0x1e800 && cp <= 0x1ec6f) || (cp >= 0x1ecc0 && cp <= 0x1ecff) || (cp >= 0x1ed50 && cp <= 0x1edff) || (cp >= 0x1ef00 && cp <= 0x1efff)) return R;
  if ((cp >= 0x600 && cp <= 0x7bf) || (cp >= 0x860 && cp <= 0x8ff) || (cp >= 0xfb50 && cp <= 0xfdcf) || (cp >= 0xfdf0 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff) || (cp >= 0x10d00 && cp <= 0x10d3f) || (cp >= 0x10ec0 && cp <= 0x10eff) || (cp >= 0x10f30 && cp <= 0x10f6f) || (cp >= 0x1ec70 && cp <= 0x1ecbf) || (cp >= 0x1ed00 && cp <= 0x1ed4f) || (cp >= 0x1ee00 && cp <= 0x1eeff)) return AL;
  return L;
}

/** First strong type in [from,to) skipping isolates (P2/X5c); -1 when none. */
function firstStrong(types, from, to, matchPDI) {
  for (let i = from; i < to; i++) {
    const t = types[i];
    if (isolateInitiator(t)) { i = matchPDI[i] >= 0 ? matchPDI[i] : to; continue; }
    if (t === L) return 0; if (t === R || t === AL) return 1;
  }
  return -1;
}

/** One paragraph (no B inside except possibly the last char). Returns {levels, paraLevel}. */
function resolveParagraph(cps, requested) {
  const n = cps.length, orig = new Array(n), matchPDI = new Int32Array(n).fill(-1), matchInit = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) orig[i] = classOf(cps[i]);
  const open = []; for (let i = 0; i < n; i++) { if (isolateInitiator(orig[i])) open.push(i); else if (orig[i] === PDI && open.length) { const j = open.pop(); matchPDI[j] = i; matchInit[i] = j; } }
  let paraLevel;
  if (requested === LEVEL_DEFAULT_LTR || requested === LEVEL_DEFAULT_RTL) { const f = firstStrong(orig, 0, n, matchPDI); paraLevel = f >= 0 ? f : requested === LEVEL_DEFAULT_RTL ? 1 : 0; } else paraLevel = requested & 1;
  const levels = new Uint8Array(n), types = orig.slice();
  // X1-X8
  const stack = [{level: paraLevel, override: -1, isolate: false}]; let overflowIsolate = 0, overflowEmbed = 0, validIsolate = 0;
  for (let i = 0; i < n; i++) {
    const t = orig[i], top = stack[stack.length - 1];
    if (t === RLE || t === LRE || t === RLO || t === LRO) {
      levels[i] = top.level; const level = (t === RLE || t === RLO) ? (top.level + 1) | 1 : (top.level + 2) & ~1;
      if (level <= MAX_DEPTH && !overflowIsolate && !overflowEmbed) stack.push({level, override: t === RLO ? R : t === LRO ? L : -1, isolate: false}); else if (!overflowIsolate) overflowEmbed++;
    } else if (isolateInitiator(t)) {
      levels[i] = top.level; if (top.override >= 0) types[i] = top.override;
      const rtl = t === RLI || (t === FSI && firstStrong(orig, i + 1, matchPDI[i] >= 0 ? matchPDI[i] : n, matchPDI) === 1);
      const level = rtl ? (top.level + 1) | 1 : (top.level + 2) & ~1;
      if (level <= MAX_DEPTH && !overflowIsolate && !overflowEmbed) { validIsolate++; stack.push({level, override: -1, isolate: true}); } else overflowIsolate++;
    } else if (t === PDI) {
      if (overflowIsolate) overflowIsolate--; else if (validIsolate) { overflowEmbed = 0; while (!stack[stack.length - 1].isolate) stack.pop(); stack.pop(); validIsolate--; }
      const now = stack[stack.length - 1]; levels[i] = now.level; if (now.override >= 0) types[i] = now.override;
    } else if (t === PDF) {
      if (overflowIsolate) { /* nothing */ } else if (overflowEmbed) overflowEmbed--; else if (!top.isolate && stack.length >= 2) stack.pop();
      levels[i] = stack[stack.length - 1].level;
    } else if (t === B) levels[i] = paraLevel;
    else if (t === BN) levels[i] = top.level;
    else { levels[i] = top.level; if (top.override >= 0) types[i] = top.override; }
  }
  // X10: level runs of the non-removed characters, chained through isolate initiator/PDI pairs
  const kept = []; for (let i = 0; i < n; i++) if (!removed(orig[i])) kept.push(i);
  const runs = []; for (const i of kept) { const last = runs[runs.length - 1]; if (last && levels[last[last.length - 1]] === levels[i]) last.push(i); else runs.push([i]); }
  const runOf = new Map(); runs.forEach((run, k) => runOf.set(run[0], k));
  const sequences = [];
  for (const run of runs) {
    if (orig[run[0]] === PDI && matchInit[run[0]] >= 0) continue;
    const seq = [...run]; let tail = run;
    while (isolateInitiator(orig[tail[tail.length - 1]]) && matchPDI[tail[tail.length - 1]] >= 0) { const next = runOf.get(matchPDI[tail[tail.length - 1]]); if (next === undefined) break; tail = runs[next]; seq.push(...tail); }
    sequences.push(seq);
  }
  const keptPos = new Map(); kept.forEach((index, k) => keptPos.set(index, k));
  for (const idx of sequences) {
    const level = levels[idx[0]], m = idx.length, t = idx.map(i => types[i]);
    const prev = keptPos.get(idx[0]) > 0 ? levels[kept[keptPos.get(idx[0]) - 1]] : paraLevel;
    const lastIndex = idx[m - 1], nextPos = keptPos.get(lastIndex) + 1;
    const next = isolateInitiator(orig[lastIndex]) || nextPos >= kept.length ? paraLevel : levels[kept[nextPos]];
    const sos = Math.max(level, prev) & 1 ? R : L, eos = Math.max(level, next) & 1 ? R : L, e = level & 1 ? R : L;
    // W1-W7
    const nsm = t.map(x => x === NSM);
    for (let k = 0; k < m; k++) if (t[k] === NSM) t[k] = k === 0 ? sos : (isolateInitiator(t[k - 1]) || t[k - 1] === PDI) ? ON : t[k - 1];
    for (let k = 0; k < m; k++) if (t[k] === EN) { let j = k - 1, strong = sos; for (; j >= 0; j--) if (t[j] === L || t[j] === R || t[j] === AL) { strong = t[j]; break; } if (strong === AL) t[k] = AN; }
    for (let k = 0; k < m; k++) if (t[k] === AL) t[k] = R;
    for (let k = 1; k < m - 1; k++) { if (t[k] === ES && t[k - 1] === EN && t[k + 1] === EN) t[k] = EN; else if (t[k] === CS && t[k - 1] === t[k + 1] && (t[k - 1] === EN || t[k - 1] === AN)) t[k] = t[k - 1]; }
    for (let k = 0; k < m; k++) if (t[k] === ET) { let a = k; while (a < m && t[a] === ET) a++; const touches = (k > 0 && t[k - 1] === EN) || (a < m && t[a] === EN); if (touches) for (let j = k; j < a; j++) t[j] = EN; k = a - 1; }
    for (let k = 0; k < m; k++) if (t[k] === ES || t[k] === ET || t[k] === CS) t[k] = ON;
    for (let k = 0; k < m; k++) if (t[k] === EN) { let strong = sos; for (let j = k - 1; j >= 0; j--) if (t[j] === L || t[j] === R) { strong = t[j]; break; } if (strong === L) t[k] = L; }
    // N0: paired brackets
    const pairs = [], stackB = [];
    for (let k = 0; k < m; k++) {
      if (t[k] !== ON) continue; const info = BRACKETS.get(cps[idx[k]]); if (!info) continue;
      if (info.open) { if (stackB.length === 63) break; stackB.push({close: canonicalBracket(info.close), k}); }
      else { const c = canonicalBracket(cps[idx[k]]); for (let s = stackB.length - 1; s >= 0; s--) if (stackB[s].close === c) { pairs.push([stackB[s].k, k]); stackB.length = s; break; } }
    }
    pairs.sort((a, b) => a[0] - b[0]);
    for (const [o, c] of pairs) {
      let foundE = false, foundOpposite = false;
      for (let k = o + 1; k < c; k++) { const s = strongOrNumber(t[k]); if (s < 0) continue; if (s === e) { foundE = true; break; } foundOpposite = true; }
      let dir = -1;
      if (foundE) dir = e; else if (foundOpposite) { let ctx = sos; for (let k = o - 1; k >= 0; k--) { const s = strongOrNumber(t[k]); if (s >= 0) { ctx = s; break; } } dir = ctx !== e ? ctx : e; }
      if (dir >= 0) for (const at of [o, c]) { t[at] = dir; for (let k = at + 1; k < m && nsm[k]; k++) t[k] = dir; }
    }
    // N1-N2
    for (let k = 0; k < m; k++) if (neutral(t[k])) {
      let a = k; while (a < m && neutral(t[a])) a++;
      const before = k === 0 ? sos : strongOrNumber(t[k - 1]), after = a === m ? eos : strongOrNumber(t[a]), dir = before === after && before >= 0 ? before : e;
      for (let j = k; j < a; j++) t[j] = dir; k = a - 1;
    }
    // I1-I2
    for (let k = 0; k < m; k++) { const x = t[k]; let l = level; if (!(level & 1)) { if (x === R) l += 1; else if (x === AN || x === EN) l += 2; } else if (x === L || x === EN || x === AN) l += 1; levels[idx[k]] = l; }
  }
  // Removed characters take the level of the preceding kept character (the paragraph level at the start).
  let carry = paraLevel; for (let i = 0; i < n; i++) { if (removed(orig[i])) levels[i] = carry; else carry = levels[i]; }
  // L1
  let reset = true;
  for (let i = n - 1; i >= 0; i--) {
    const t = orig[i];
    if (t === S || t === B) { levels[i] = paraLevel; reset = true; } else if (reset && (t === WS || t >= LRI || removed(t))) levels[i] = paraLevel; else reset = false;
  }
  return {levels, paraLevel};
}

/** Levels per UTF-16 unit for `units`; paragraphs end after each paragraph separator (class B). */
export function bidiLevels(units, requested) {
  const cps = [], starts = [];
  for (let i = 0; i < units.length;) { const hi = units[i], lo = units[i + 1]; let cp = hi, w = 1; if (hi >= 0xd800 && hi < 0xdc00 && lo >= 0xdc00 && lo < 0xe000) { cp = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00); w = 2; } cps.push(cp); starts.push(i); i += w; }
  const out = new Uint8Array(units.length); let paraLevel = null;
  for (let from = 0; from < cps.length;) {
    let to = from; while (to < cps.length && classOf(cps[to]) !== B) to++; if (to < cps.length) to++;
    const result = resolveParagraph(cps.slice(from, to), requested); paraLevel ??= result.paraLevel;
    for (let k = from; k < to; k++) { const end = k + 1 < cps.length ? starts[k + 1] : units.length; for (let u = starts[k]; u < end; u++) out[u] = result.levels[k - from]; }
    from = to;
  }
  return {levels: out, paraLevel: paraLevel ?? (requested === LEVEL_DEFAULT_RTL || requested === 1 ? 1 : 0)};
}

export function createIcuBidiHost() {
  const registry = createHostRegistry(), { def, type, staticField } = registry;
  type(BIDI, 'Ljava/lang/Object;', [], { allocatable: true });
  for (const [name, value] of [['LTR', 0], ['RTL', 1], ['MIXED', 2], ['NEUTRAL', 3], ['LEVEL_DEFAULT_LTR', LEVEL_DEFAULT_LTR], ['LEVEL_DEFAULT_RTL', LEVEL_DEFAULT_RTL], ['MAX_EXPLICIT_LEVEL', MAX_DEPTH]]) staticField(BIDI, name, 'B', () => value);
  const st = (r, self) => r.object(self).bidi ?? r.throwJava('Ljava/lang/IllegalStateException;', 'Bidi: setPara() was not called');
  def(BIDI, '<init>', '()V', () => {}); def(BIDI, '<init>', '(II)V', (r, _m, [self, maxLength, maxRuns]) => { if (maxLength < 0 || maxRuns < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Bidi: negative size'); });
  const setPara = (r, self, units, level) => { if (![0, 1, LEVEL_DEFAULT_LTR, LEVEL_DEFAULT_RTL].includes(level & 0xff)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Bidi: invalid paragraph level'); r.object(self).bidi = {...bidiLevels(units, level & 0xff), length: units.length}; };
  def(BIDI, 'setPara', `(${CHARS}B${BYTES})V`, (r, _m, [self, chars, level, embedding]) => { if (nullish(chars)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Bidi: text is null'); if (!nullish(embedding)) r.throwJava('Ljava/lang/UnsupportedOperationException;', 'Bidi: explicit embedding levels are not supported'); setPara(r, self, r.array(chars).elements.map(v => v & 0xffff), level); });
  def(BIDI, 'setPara', `(Ljava/lang/String;B${BYTES})V`, (r, _m, [self, text, level, embedding]) => { if (nullish(text)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Bidi: text is null'); if (!nullish(embedding)) r.throwJava('Ljava/lang/UnsupportedOperationException;', 'Bidi: explicit embedding levels are not supported'); const s = r.stringCharacters(text); setPara(r, self, Array.from({length: s.length}, (_, i) => s.charCodeAt(i)), level); });
  def(BIDI, 'getLevelAt', '(I)B', (r, _m, [self, index]) => { const b = st(r, self); if (index < 0 || index >= b.length) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Bidi: index out of range'); return b.levels[index]; });
  def(BIDI, 'getParaLevel', '()B', (r, _m, [self]) => st(r, self).paraLevel);
  def(BIDI, 'getLength', '()I', (r, _m, [self]) => st(r, self).length);
  const direction = b => { let any0 = false, any1 = false; for (const level of b.levels) { if (level & 1) any1 = true; else any0 = true; } return any0 && any1 ? 2 : any1 ? 1 : 0; };
  def(BIDI, 'getDirection', '()B', (r, _m, [self]) => direction(st(r, self)));
  def(BIDI, 'isLeftToRight', '()Z', (r, _m, [self]) => direction(st(r, self)) === 0 ? 1 : 0);
  def(BIDI, 'isRightToLeft', '()Z', (r, _m, [self]) => direction(st(r, self)) === 1 ? 1 : 0);
  def(BIDI, 'isMixed', '()Z', (r, _m, [self]) => direction(st(r, self)) === 2 ? 1 : 0);
  return { ...registry, interfaces: registry.interfacesOf };
}
