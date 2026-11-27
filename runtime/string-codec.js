import { lookupCharset } from './charset-native.js?v=88e579518234';

// java.lang.String <-> byte[] conversion for the charsets of the curated Android13 ICU profile
// (UTF-8, UTF-16, UTF-16BE, UTF-16LE, UTF-32, UTF-32BE, UTF-32LE, ISO-8859-1, US-ASCII), following the Android/Java REPLACE actions:
//  - encode: unmappable characters and unpaired surrogates become '?' (UTF-16 and UTF-32 families: U+FFFD; ICU's UTF-16 and UTF-32 write a byte-order mark first);
//  - decode: malformed input becomes U+FFFD per maximal subpart.
// Charsets outside the profile are NOT approximated: the caller must surface an explicit failure.
export const SUPPORTED_CODECS = new Set(['UTF-8', 'UTF-16', 'UTF-16BE', 'UTF-16LE', 'UTF-32', 'UTF-32BE', 'UTF-32LE', 'ISO-8859-1', 'US-ASCII']);
export const canonicalCharset = name => lookupCharset(name)?.canonical ?? null;

/** Splits a UTF-16 string into code points, mapping an unpaired surrogate to -1. */
function* codePoints(text) {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit < 0xdc00 && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low < 0xe000) { i++; yield ((unit - 0xd800) << 10) + (low - 0xdc00) + 0x10000; continue; }
    }
    yield unit >= 0xd800 && unit < 0xe000 ? -1 : unit;
  }
}
const utf8Encode = point => point < 0x80 ? [point] : point < 0x800 ? [0xc0 | point >> 6, 0x80 | point & 63]
  : point < 0x10000 ? [0xe0 | point >> 12, 0x80 | point >> 6 & 63, 0x80 | point & 63]
  : [0xf0 | point >> 18, 0x80 | point >> 12 & 63, 0x80 | point >> 6 & 63, 0x80 | point & 63];

export function encodeString(text, charset) {
  const out = [];
  if (charset === 'UTF-8') for (const point of codePoints(text)) out.push(...(point < 0 ? [0x3f] : utf8Encode(point)));
  else if (charset === 'ISO-8859-1' || charset === 'US-ASCII') { const limit = charset === 'US-ASCII' ? 0x7f : 0xff; for (const point of codePoints(text)) out.push(point < 0 || point > limit ? 0x3f : point); }
  else if (charset === 'UTF-16' || charset === 'UTF-16BE' || charset === 'UTF-16LE') {
    const little = charset === 'UTF-16LE', put = unit => little ? out.push(unit & 255, unit >> 8) : out.push(unit >> 8, unit & 255);
    if (charset === 'UTF-16') out.push(0xfe, 0xff);
    for (let i = 0; i < text.length; i++) {
      const unit = text.charCodeAt(i);
      if (unit >= 0xd800 && unit < 0xdc00 && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { put(unit); put(text.charCodeAt(++i)); }
      else put(unit >= 0xd800 && unit < 0xe000 ? 0xfffd : unit);
    }
  } else if (charset === 'UTF-32' || charset === 'UTF-32BE' || charset === 'UTF-32LE') {
    const little = charset === 'UTF-32LE', put = point => little ? out.push(point & 255, point >> 8 & 255, point >> 16 & 255, 0) : out.push(0, point >> 16 & 255, point >> 8 & 255, point & 255);
    if (charset === 'UTF-32') put(0xfeff);
    for (const point of codePoints(text)) put(point < 0 ? 0xfffd : point);
  } else throw new Error('Unsupported codec ' + charset);
  return Int8Array.from(out);
}

export function decodeBytes(bytes, charset) {
  // bytes: Uint8Array
  if (charset === 'UTF-8') return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  if (charset === 'ISO-8859-1') { let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return text; }
  if (charset === 'US-ASCII') { let text = ''; for (const byte of bytes) text += byte > 0x7f ? '�' : String.fromCharCode(byte); return text; }
  if (charset === 'UTF-16' || charset === 'UTF-16BE' || charset === 'UTF-16LE') {
    let little = charset === 'UTF-16LE', from = 0;
    if (charset === 'UTF-16' && bytes.length >= 2) {
      if (bytes[0] === 0xfe && bytes[1] === 0xff) from = 2; else if (bytes[0] === 0xff && bytes[1] === 0xfe) { from = 2; little = true; }
    }
    const units = [];
    for (let i = from; i + 1 < bytes.length; i += 2) units.push(little ? bytes[i] | bytes[i + 1] << 8 : bytes[i] << 8 | bytes[i + 1]);
    let text = '';
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      if (unit >= 0xd800 && unit < 0xdc00 && i + 1 < units.length && (units[i + 1] & 0xfc00) === 0xdc00) text += String.fromCharCode(unit, units[++i]);
      else text += unit >= 0xd800 && unit < 0xe000 ? '�' : String.fromCharCode(unit);
    }
    return (bytes.length - from) % 2 ? text + '�' : text;
  }
  if (charset === 'UTF-32' || charset === 'UTF-32BE' || charset === 'UTF-32LE') {   // a unit beyond U+10FFFF or a surrogate is malformed (U+FFFD), as is a trailing partial unit
    let little = charset === 'UTF-32LE', from = 0;
    if (charset === 'UTF-32' && bytes.length >= 4) { if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff) from = 4; else if (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) { from = 4; little = true; } }
    let text = '';
    for (let i = from; i + 3 < bytes.length; i += 4) {
      const point = little ? (bytes[i] | bytes[i + 1] << 8 | bytes[i + 2] << 16 | bytes[i + 3] << 24) >>> 0 : (bytes[i] << 24 | bytes[i + 1] << 16 | bytes[i + 2] << 8 | bytes[i + 3]) >>> 0;
      text += point > 0x10ffff || (point >= 0xd800 && point < 0xe000) ? '\ufffd' : String.fromCodePoint(point);
    }
    return (bytes.length - from) % 4 ? text + '\ufffd' : text;
  }
  throw new Error('Unsupported codec ' + charset);
}
