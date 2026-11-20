import { APKError } from './apk-error.js?v=fef4a080c36e';

// The locale's date/time pattern for a skeleton (android.icu.text.DateTimePatternGenerator.getBestPattern, which android.text.format.DateFormat.getBestDateTimePattern returns),
// from the CLDR data the platform ships: Intl.DateTimeFormat is asked for the fields the skeleton names and the parts it answers (their order and the literal text between them) are
// written back as a pattern. ICU4J and its data file are not part of the lab, so this is the data source; the field lengths follow DateTimePatternGenerator.adjustFieldTypes:
//   - hour, minute and second keep the length of the locale's pattern (h:mm, HH:mm);
//   - a numeric month or day asked with one letter keeps the locale's length (dd/MM in pt-BR, M/d in en-US), asked with two it is two;
//   - year, era, a month or weekday in letters and the zone take the length of the skeleton.
// A month or weekday that stands alone is written with the stand-alone letters (LLLL, cccc), as CLDR's available formats do.
// A skeleton with date and time fields is answered as ICU 70 (Android 13) does: the date pattern and the time pattern joined by the locale's medium date-time glue ("{1}, {0}" in en).
// The engine's own answer for such a skeleton is not used: since ICU 72 it picks the glue by the width of the month ("MMMM d, y 'at' h:mm a").
// The CLDR data is the engine's (the browser's ICU), not the CLDR 40 of Android 13: where a locale's patterns changed between the two, the answer is the engine's.
// Skeleton fields Intl cannot answer (quarter, week of year, day of year, fractional seconds, ...) are refused by name.

const SAMPLE = Date.UTC(2003, 0, 2, 4, 5, 6);   // one-digit month, day, hour, minute and second: a leading zero in the answer is the locale's two-digit field
const TEXT_WIDTH = [null, 'short', 'short', 'short', 'long', 'narrow'];
const refuse = (skeleton, what) => { throw new APKError(`DateTimePatternGenerator.getBestPattern("${skeleton}"): ${what} is not available from the platform's Intl date data`, { kind: 'date-skeleton-unsupported' }); };

/** Letters of the skeleton with their counts, in order of first appearance (quoted text and everything that is not a letter is ignored, as ICU's skeleton parser does). */
function skeletonFields(skeleton) {
  const fields = new Map(); let quoted = false;
  for (const ch of skeleton) {
    if (ch === "'") { quoted = !quoted; continue; }
    if (!quoted && /[A-Za-z]/.test(ch)) fields.set(ch, (fields.get(ch) ?? 0) + 1);
  }
  return fields;
}

const DATE_LETTERS = 'GyMLdEce', DATE_PARTS = new Set(['era', 'year', 'relatedYear', 'yearName', 'month', 'day', 'weekday']);
const QUOTED = /[\p{Script=Latin}\p{Script=Cyrillic}][\p{Script=Latin}\p{Script=Cyrillic}\p{M}]*/gu;
/** Literal text of a pattern: the narrow no-break space CLDR 42 put before AM/PM is the plain space of Android 13 (CLDR 40); letters of the Latin and Cyrillic scripts are quoted, as CLDR
 *  writes them (d 'de' MMM, y 'г'.); CLDR leaves the letters of other scripts bare (y年M月d日), and so does this. */
const literal = value => value.replace(/ /g, ' ').replace(/'/g, "''").replace(QUOTED, letters => `'${letters}'`);
const intl = (tag, skeleton, options) => { try { return new Intl.DateTimeFormat(tag, { timeZone: 'UTC', ...options }); } catch { return refuse(skeleton, `the locale ${tag}`); } };

/** The pattern Intl answers for one group of skeleton fields (all of a skeleton CLDR has as one format, or its date fields, or its time fields). */
function fieldsPattern(tag, skeleton, fields) {
  const options = {}, asked = {};
  for (const [letter, count] of fields) {
    switch (letter) {
      case 'G': if (count > 5) refuse(skeleton, `era of ${count} letters`); options.era = TEXT_WIDTH[count]; asked.era = count; break;
      case 'y': options.year = count === 2 ? '2-digit' : 'numeric'; asked.year = count; break;
      case 'M': case 'L': if (count > 5) refuse(skeleton, `month of ${count} letters`); options.month = count === 1 ? 'numeric' : count === 2 ? '2-digit' : TEXT_WIDTH[count]; asked.month = count; break;
      case 'd': if (count > 2) refuse(skeleton, `day of ${count} letters`); options.day = count === 1 ? 'numeric' : '2-digit'; asked.day = count; break;
      case 'E': if (count > 5) refuse(skeleton, `weekday of ${count} letters`); options.weekday = TEXT_WIDTH[count]; asked.weekday = count; break;
      case 'c': case 'e': if (count < 3 || count > 5) refuse(skeleton, `the numeric weekday (${letter.repeat(count)})`); options.weekday = TEXT_WIDTH[count]; asked.weekday = count; break;
      case 'a': asked.dayPeriod = true; break;
      case 'j': case 'h': case 'H': case 'k': case 'K':
        if (count > 2) refuse(skeleton, `hour of ${count} letters`);
        options.hour = count === 1 ? 'numeric' : '2-digit'; if (letter !== 'j') options.hourCycle = { h: 'h12', K: 'h11', H: 'h23', k: 'h24' }[letter]; break;
      case 'm': if (count > 2) refuse(skeleton, `minute of ${count} letters`); options.minute = count === 1 ? 'numeric' : '2-digit'; break;
      case 's': if (count > 2) refuse(skeleton, `second of ${count} letters`); options.second = count === 1 ? 'numeric' : '2-digit'; break;
      case 'z': if (count > 4) refuse(skeleton, `zone of ${count} letters`); options.timeZoneName = count === 4 ? 'long' : 'short'; asked.zone = 'z'.repeat(count); break;
      case 'v': if (count !== 1 && count !== 4) refuse(skeleton, `zone ${'v'.repeat(count)}`); options.timeZoneName = count === 4 ? 'longGeneric' : 'shortGeneric'; asked.zone = 'v'.repeat(count); break;
      case 'O': if (count !== 1 && count !== 4) refuse(skeleton, `zone ${'O'.repeat(count)}`); options.timeZoneName = count === 4 ? 'longOffset' : 'shortOffset'; asked.zone = 'O'.repeat(count); break;
      default: refuse(skeleton, `the field "${letter}"`);
    }
  }
  if (asked.dayPeriod && options.hour === undefined) refuse(skeleton, 'a day period without an hour');
  if (asked.dayPeriod && options.hourCycle === undefined) options.hourCycle = 'h12';
  const format = intl(tag, skeleton, options), parts = format.formatToParts(new Date(SAMPLE)), resolved = format.resolvedOptions(), cycle = resolved.hourCycle;
  const zero = new Intl.NumberFormat(tag, { numberingSystem: resolved.numberingSystem, useGrouping: false }).format(0);   // the zero digit of the numbering system the locale formats dates with
  const padded = (value, letter) => /^\p{Nd}{2}/u.test(value) && value.startsWith(zero) ? letter + letter : letter;
  const only = type => !['year', 'month', 'day', 'weekday', 'era'].some(other => other !== type && options[other] !== undefined);   // the one date field of the group
  let pattern = '';
  for (const { type, value } of parts) {
    switch (type) {
      case 'era': pattern += 'G'.repeat(asked.era); break;
      case 'year': pattern += 'y'.repeat(asked.year); break;
      case 'month': pattern += asked.month === 1 || (asked.month > 2 && /^\p{Nd}+$/u.test(value)) ? padded(value, 'M') : asked.month === 2 ? 'MM' : (only('month') ? 'L' : 'M').repeat(asked.month); break;   // a locale whose abbreviated month is its number (ja, zh, ko) writes it with M
      case 'day': pattern += asked.day === 1 ? padded(value, 'd') : 'dd'; break;
      case 'weekday': pattern += only('weekday') && options.hour === undefined ? 'c'.repeat(Math.max(3, asked.weekday)) : 'E'.repeat(asked.weekday); break;
      case 'hour': pattern += padded(value, { h11: 'K', h12: 'h', h23: 'H', h24: 'k' }[cycle] ?? 'H'); break;
      case 'minute': pattern += padded(value, 'm'); break;
      case 'second': pattern += padded(value, 's'); break;
      case 'dayPeriod': pattern += 'a'; break;
      case 'timeZoneName': pattern += asked.zone; break;
      case 'literal': pattern += literal(value); break;
      default: refuse(skeleton, `the part "${type}" of the locale ${tag}`);
    }
  }
  return pattern;
}

/** The locale's medium date-time glue (CLDR dateTimeFormat, "{1}, {0}" in en): which of date and time comes first and the text between them. Intl answers a medium date with a medium
 *  time; the text between its last date part and its first time part is the end of the date pattern, the glue and the start of the time pattern, so the two ends are taken off. */
function dateTimeGlue(tag, skeleton) {
  const at = new Date(SAMPLE), parts = options => intl(tag, skeleton, options).formatToParts(at);
  const both = parts({ dateStyle: 'medium', timeStyle: 'medium' }), kinds = both.map(part => part.type === 'literal' ? 0 : DATE_PARTS.has(part.type) ? 1 : 2);
  const dateFirst = kinds.lastIndexOf(1) < kinds.indexOf(2), timeFirst = kinds.lastIndexOf(2) < kinds.indexOf(1);
  if (!dateFirst && !timeFirst) refuse(skeleton, `the date-time glue of the locale ${tag} (its date and time fields are interleaved)`);
  const from = dateFirst ? kinds.lastIndexOf(1) : kinds.lastIndexOf(2), to = dateFirst ? kinds.indexOf(2) : kinds.indexOf(1);
  let text = both.slice(from + 1, to).map(part => part.value).join('');
  const first = parts(dateFirst ? { dateStyle: 'medium' } : { timeStyle: 'medium' }), second = parts(dateFirst ? { timeStyle: 'medium' } : { dateStyle: 'medium' });
  const tail = first.at(-1).type === 'literal' ? first.at(-1).value : '', head = second[0].type === 'literal' ? second[0].value : '';
  if (tail && text.startsWith(tail)) text = text.slice(tail.length);
  if (head && text.endsWith(head)) text = text.slice(0, text.length - head.length);
  return { dateFirst, text: literal(text) };
}

const formats = new Map();
export function bestDateTimePattern(tag, skeleton) {
  const key = `${tag}\u0000${skeleton}`; if (formats.has(key)) return formats.get(key);
  const fields = skeletonFields(skeleton), date = new Map(), time = new Map();
  for (const [letter, count] of fields) (DATE_LETTERS.includes(letter) ? date : time).set(letter, count);
  // ICU 70 getBestPattern: one pattern when CLDR has a format with exactly these fields, else the best date pattern and the best time pattern joined by the medium glue. The formats
  // of CLDR that hold date and time fields together are the weekday with hour and minute (Ehm, EHm, Ehms, EHms).
  const weekdayTime = date.size === 1 && (date.has('E') || date.has('c') || date.has('e')) && time.has('m') && [...time.keys()].every(letter => 'jhHkKmsa'.includes(letter)) && [...time.keys()].some(letter => 'jhHkK'.includes(letter));
  let pattern;
  if (!date.size || !time.size || weekdayTime) pattern = fieldsPattern(tag, skeleton, fields);
  else {
    const datePattern = fieldsPattern(tag, skeleton, date), timePattern = fieldsPattern(tag, skeleton, time), glue = dateTimeGlue(tag, skeleton);
    pattern = glue.dateFirst ? datePattern + glue.text + timePattern : timePattern + glue.text + datePattern;
  }
  if (formats.size >= 512) formats.clear();
  formats.set(key, pattern); return pattern;
}

/** DateTimePatternGenerator.getDefaultHourCycle: the hour cycle of the locale's preferred time format ('h11' | 'h12' | 'h23' | 'h24'). */
export function defaultHourCycle(tag) {
  let cycle; try { cycle = new Intl.DateTimeFormat(tag, { hour: 'numeric' }).resolvedOptions().hourCycle; } catch { cycle = undefined; }
  if (!['h11', 'h12', 'h23', 'h24'].includes(cycle)) throw new APKError(`DateTimePatternGenerator.getDefaultHourCycle: the platform's Intl data has no hour cycle for the locale ${tag}`, { kind: 'date-skeleton-unsupported' });
  return cycle;
}
