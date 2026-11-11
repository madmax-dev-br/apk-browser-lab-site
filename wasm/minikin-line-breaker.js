// Minikin's optimal line breakers (android-13.0.0_r1 frameworks/minikin: LineBreaker.cpp, OptimalLineBreaker.cpp, LineBreakerUtil.h, WordBreaker.cpp), ported to JavaScript for
// Layout.BREAK_STRATEGY_HIGH_QUALITY and BREAK_STRATEGY_BALANCED. The candidates, the scores and the dynamic program are the C++ ones; the per-character widths come from the SkParagraph
// shaping of the measured text (a cluster's width sits at its first code unit, 0 elsewhere, as Minikin does), and the word-break opportunities from the original ICU line-break iterator
// with Minikin's email/URL and emoji customisations. Hyphenation points need the Minikin pattern files (system hyphenation data), which the virtual device does not have, so the hyphenator
// finds nothing, as on a device without a pattern for the locale; the hyphenation frequency still scales the penalties exactly as computePenalties does.
export const BreakStrategy = Object.freeze({ Greedy: 0, HighQuality: 1, Balanced: 2 });
export const HyphenationFrequency = Object.freeze({ None: 0, Normal: 1, Full: 2 });

const SCORE_INFTY = 3.4028234663852886e38, SCORE_OVERFULL = 1e12, SCORE_DESPERATE = 1e10;
const LAST_LINE_PENALTY_MULTIPLIER = 4.0, LINE_PENALTY_MULTIPLIER = 2.0, SHRINK_PENALTY_MULTIPLIER = 4.0, SHRINKABILITY = 1 / 3;
const f32 = Math.fround;

const CHAR_SOFT_HYPHEN = 0xad, CHAR_ZWJ = 0x200d;
const isLineBreakingHyphen = c => c === 0x2d || c === 0x58a || c === 0x5be || c === 0x1400 || c === 0x2010 || c === 0x2013 || c === 0x2027 || c === 0x2e17 || c === 0x2e40;
const isEmoji = cp => /^\p{Emoji}$/u.test(String.fromCodePoint(cp)), isEmojiModifier = cp => /^\p{Emoji_Modifier}$/u.test(String.fromCodePoint(cp));
const isEmojiBase = cp => cp === 0x1f91d || cp === 0x1f93c || /^\p{Emoji_Modifier_Base}$/u.test(String.fromCodePoint(cp));
/** Unicode set [[:Zs:]-[:Line_Break=Glue:]] plus '\n': spaces that disappear at the end of a line. */
export const isLineEndSpace = c => c === 0x0a || c === 0x20 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a && c !== 0x2007) || c === 0x205f || c === 0x3000;
const isWordSpace = c => c === 0x20;
const codePointBefore = (text, at) => { const low = text.charCodeAt(at - 1); if (low >= 0xdc00 && low <= 0xdfff && at >= 2) { const high = text.charCodeAt(at - 2); if (high >= 0xd800 && high <= 0xdbff) return [((high - 0xd800) << 10) + (low - 0xdc00) + 0x10000, at - 2]; } return [low, at - 1]; };
const codePointAt = (text, at) => text.codePointAt(at);

const breakAfter = c => c === 0x3a || c === 0x3d || c === 0x26;                                              // : = &
const breakBefore = c => c === 0x7e || c === 0x2e || c === 0x2c || c === 0x2d || c === 0x5f || c === 0x3f || c === 0x23 || c === 0x25 || c === 0x3d || c === 0x26;   // ~ . , - _ ? # % = &
const START = 0, SAW_AT = 1, SAW_COLON = 2, SAW_COLON_SLASH = 3, SAW_COLON_SLASH_SLASH = 4;

/** WordBreaker.cpp over a precomputed list of ICU line-break boundaries (ascending, starting at 0 and ending at the text length). */
export class WordBreaker {
  constructor(text) { this.text = text; this.size = text.length; this.last = 0; this.current = 0; this.scanOffset = 0; this.inEmailOrUrl = false; this.boundaries = [0, text.length]; }
  following(offset) { const list = this.boundaries; let lo = 0, hi = list.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] > offset) hi = mid; else lo = mid + 1; } return lo < list.length ? list[lo] : -1; }   // ubrk_following; -1 is UBRK_DONE
  isBoundary(offset) { const list = this.boundaries; let lo = 0, hi = list.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid] === offset) return true; if (list[mid] < offset) lo = mid + 1; else hi = mid - 1; } return false; }
  /** The break iterator for the run's locale: restarts at `from` (followingWithLocale). */
  followingWithLocale(boundaries, from) {
    this.boundaries = boundaries;
    if (!this.inEmailOrUrl) { this.current = this.last = this.scanOffset = from; this.next(); }
    return this.current;
  }
  isValidBreak(i) {
    if (i === -1 || i === this.size) return true;
    const [codePoint, previousOffset] = codePointBefore(this.text, i);
    if (isLineBreakingHyphen(codePoint) || codePoint === CHAR_SOFT_HYPHEN) return false;
    if (codePoint === 0x1039) return false;                                                  // MYANMAR SIGN VIRAMA
    const nextCodePoint = codePointAt(this.text, i);
    if (codePoint === CHAR_ZWJ && isEmoji(nextCodePoint)) return false;
    if (isEmojiModifier(nextCodePoint)) {
      let base = codePoint, prev = previousOffset;
      if (base === 0xfe0f && prev > 0) base = codePointBefore(this.text, prev)[0];
      if (isEmojiBase(base)) return false;
    }
    return true;
  }
  iteratorNext() {
    let result = this.following(this.current);
    while (!this.isValidBreak(result)) result = this.following(result);                          // ubrk_next continues from the current boundary
    return result;
  }
  detectEmailOrUrl() {
    if (this.last < this.scanOffset) return;
    let state = START, i;
    for (i = this.last; i < this.size; i++) {
      const c = this.text.charCodeAt(i);
      if (!(c > 0x20 && c <= 0x7e)) break;
      if (state === START && c === 0x40) state = SAW_AT;
      else if (state === START && c === 0x3a) state = SAW_COLON;
      else if (state === SAW_COLON || state === SAW_COLON_SLASH) { if (c === 0x2f) state += 1; else state = START; }
    }
    if (state === SAW_AT || state === SAW_COLON_SLASH_SLASH) { if (!this.isBoundary(i)) i = this.following(i); this.inEmailOrUrl = true; } else this.inEmailOrUrl = false;
    this.scanOffset = i;
  }
  findNextBreakInEmailOrUrl() {
    let lastChar = this.text.charCodeAt(this.last), i;
    for (i = this.last + 1; i < this.scanOffset; i++) {
      if (breakAfter(lastChar)) break;
      if (lastChar === 0x2f && i >= this.last + 2 && this.text.charCodeAt(i - 2) === 0x2f) break;
      const thisChar = this.text.charCodeAt(i);
      if (lastChar !== 0x2d) {
        if (breakBefore(thisChar)) break;
        if (thisChar === 0x2f && lastChar !== 0x2f && !(i + 1 < this.scanOffset && this.text.charCodeAt(i + 1) === 0x2f)) break;
      }
      lastChar = thisChar;
    }
    return i;
  }
  next() {
    this.last = this.current;
    this.detectEmailOrUrl();
    this.current = this.inEmailOrUrl ? this.findNextBreakInEmailOrUrl() : this.iteratorNext();
    return this.current;
  }
  breakBadness() { return this.inEmailOrUrl && this.current < this.scanOffset ? 1 : 0; }
}

/** CharProcessor from LineBreakerUtil.h. */
class CharProcessor {
  constructor(text) {
    this.rawSpaceCount = 0; this.effectiveSpaceCount = 0; this.sumOfCharWidths = 0; this.effectiveWidth = 0; this.sumOfCharWidthsAtPrevWordBreak = 0;
    this.nextWordBreak = 0; this.prevWordBreak = 0; this.spaceWidth = 0; this.breaker = new WordBreaker(text); this.localeKey = null;
  }
  widthFromLastWordBreak() { return this.effectiveWidth - this.sumOfCharWidthsAtPrevWordBreak; }
  wordBreakPenalty() { return this.breaker.breakBadness(); }
  contextRange() { return [this.prevWordBreak, this.nextWordBreak]; }
  updateLocaleIfNecessary(run, boundariesFor) {
    if (this.localeKey === run.locale) return;
    this.nextWordBreak = this.breaker.followingWithLocale(boundariesFor(run.locale), run.start); this.localeKey = run.locale;
  }
  feedChar(idx, c, w, canBreakHere) {
    if (idx === this.nextWordBreak) {
      if (canBreakHere) { this.prevWordBreak = this.nextWordBreak; this.sumOfCharWidthsAtPrevWordBreak = this.sumOfCharWidths; }
      const next = this.breaker.next(); this.nextWordBreak = next < 0 ? Infinity : next;
    }
    if (isWordSpace(c)) { this.rawSpaceCount += 1; this.spaceWidth = w; }
    this.sumOfCharWidths = f32(this.sumOfCharWidths + w);
    if (!isLineEndSpace(c)) { this.effectiveSpaceCount = this.rawSpaceCount; this.effectiveWidth = this.sumOfCharWidths; }
  }
}

function computePenalties(run, lineWidth, frequency, justified) {
  let linePenalty = 0;
  let hyphenPenalty = f32(0.5 * run.size * run.scaleX * lineWidth.getAt(0));                      // a heuristic that seems to perform well
  if (frequency === HyphenationFrequency.Normal) hyphenPenalty = f32(hyphenPenalty * 4.0);
  if (justified) hyphenPenalty = f32(hyphenPenalty * 0.25); else linePenalty = f32(hyphenPenalty * LINE_PENALTY_MULTIPLIER);
  return [hyphenPenalty, linePenalty];
}

function populateDesperatePoints(widths, start, end) {
  const out = []; let width = widths[start];
  for (let i = start + 1; i < end; i++) { const w = widths[i]; if (w === 0) continue; out.push({ offset: i, sumOfChars: width }); width = f32(width + w); }   // w == 0: not a grapheme boundary
  return out;
}

/** populateCandidates + LineBreakOptimizer.computeBreaks + finishBreaksOptimal. `measured` = { widths[], runs[{start,end,size,scaleX,locale,canBreak}], extent(start,end) -> {ascent,descent} }.
 *  Returns { breakPoints, widths, ascents, descents, flags } like LineBreakResult. */
export function breakLineOptimal(text, measured, lineWidth, strategy, frequency, justified, boundariesFor) {
  if (text.length === 0) return { breakPoints: [], widths: [], ascents: [], descents: [], flags: [] };
  const minLineWidth = lineWidth.getMin(), proc = new CharProcessor(text), candidates = [{ offset: 0, preBreak: 0, postBreak: 0, penalty: 0, preSpaceCount: 0, postSpaceCount: 0, hyphenType: 0 }];
  let linePenalty = 0;
  for (const run of measured.runs) {
    let hyphenPenalty = 0;
    if (run.canBreak !== false) { const [h, l] = computePenalties(run, lineWidth, frequency, justified); hyphenPenalty = h; linePenalty = Math.max(l, linePenalty); }
    proc.updateLocaleIfNecessary(run, boundariesFor);
    for (let i = run.start; i < run.end; i++) {
      const canBreak = run.canBreak !== false || i + 1 === run.end;
      proc.feedChar(i, text.charCodeAt(i), measured.widths[i], canBreak);
      const nextCharOffset = i + 1;
      if (nextCharOffset !== proc.nextWordBreak) continue;                                       // wait until a word break point
      const [contextStart, contextEnd] = proc.contextRange();
      if (proc.widthFromLastWordBreak() > minLineWidth) for (const d of populateDesperatePoints(measured.widths, contextStart, contextEnd)) {
        candidates.push({ offset: d.offset, preBreak: f32(proc.sumOfCharWidthsAtPrevWordBreak + d.sumOfChars), postBreak: f32(proc.sumOfCharWidthsAtPrevWordBreak + d.sumOfChars), penalty: SCORE_DESPERATE, preSpaceCount: proc.effectiveSpaceCount, postSpaceCount: proc.effectiveSpaceCount, hyphenType: 0 });
      }
      if (run.canBreak !== false || nextCharOffset === run.end || measured.widths[nextCharOffset] > 0) {
        candidates.push({ offset: nextCharOffset, preBreak: proc.sumOfCharWidths, postBreak: proc.effectiveWidth, penalty: f32(hyphenPenalty * proc.wordBreakPenalty()), preSpaceCount: proc.rawSpaceCount, postSpaceCount: proc.effectiveSpaceCount, hyphenType: 0 });
      }
    }
  }
  const nCand = candidates.length, maxShrink = justified ? f32(SHRINKABILITY * proc.spaceWidth) : 0;
  let active = 0;
  const data = [{ score: 0, prev: 0, lineNumber: 0 }];                                             // the first candidate is always on the first line
  for (let i = 1; i < nCand; i++) {
    const atEnd = i === nCand - 1; let best = SCORE_INFTY, bestPrev = 0;
    let lineNumberLast = data[active].lineNumber, width = lineWidth.getAt(lineNumberLast), leftEdge = f32(candidates[i].postBreak - width), bestHope = 0;
    for (let j = active; j < i; j++) {
      const lineNumber = data[j].lineNumber;
      if (lineNumber !== lineNumberLast) {
        const widthNew = lineWidth.getAt(lineNumber);
        if (widthNew !== width) { leftEdge = f32(candidates[i].postBreak - width); bestHope = 0; width = widthNew; }
        lineNumberLast = lineNumber;
      }
      const jScore = data[j].score;
      if (f32(jScore + bestHope) >= best) continue;
      const delta = f32(candidates[j].preBreak - leftEdge);
      let widthScore = 0, additionalPenalty = 0;
      if ((atEnd || !justified) && delta < 0) widthScore = SCORE_OVERFULL;
      else if (atEnd && strategy !== BreakStrategy.Balanced) additionalPenalty = f32(LAST_LINE_PENALTY_MULTIPLIER * candidates[j].penalty);      // increase penalty for hyphen on last line
      else {
        widthScore = f32(delta * delta);
        if (delta < 0) { if (-delta < maxShrink * (candidates[i].postSpaceCount - candidates[j].preSpaceCount)) widthScore = f32(widthScore * SHRINK_PENALTY_MULTIPLIER); else widthScore = SCORE_OVERFULL; }
      }
      if (delta < 0) active = j + 1; else bestHope = widthScore;
      const score = f32(f32(jScore + widthScore) + additionalPenalty);
      if (score <= best) { best = score; bestPrev = j; }
    }
    data.push({ score: f32(f32(best + candidates[i].penalty) + linePenalty), prev: bestPrev, lineNumber: data[bestPrev].lineNumber + 1 });
  }
  const result = { breakPoints: [], widths: [], ascents: [], descents: [], flags: [] };
  for (let i = nCand - 1, prevIndex; i > 0; i = prevIndex) {
    prevIndex = data[i].prev;
    const cand = candidates[i], prev = candidates[prevIndex], extent = measured.extent(prev.offset, cand.offset);
    result.breakPoints.push(cand.offset); result.widths.push(f32(cand.postBreak - prev.preBreak)); result.ascents.push(extent.ascent); result.descents.push(extent.descent); result.flags.push(0);
  }
  for (const key of Object.keys(result)) result[key].reverse();
  return result;
}

/** RectangleLineWidth / the Java ParagraphConstraints: `first` for the first `count` lines, `rest` afterwards. */
export const lineWidthOf = (first, count, rest) => ({ getAt: line => (line < count ? first : rest), getMin: () => Math.min(first, rest) });
