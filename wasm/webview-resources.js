// Sub-resources of a scriptable WebView document (design: docs/APK-REAL-TASKS.md, task 33, phase 3). The lab owns the text of the documents it hands to a frame, so it resolves their
// references itself instead of letting the browser fetch them: `file:///android_asset/...` comes out of the APK, and the app's WebViewClient.shouldInterceptRequest sees every request
// before anything else answers it. (A Service Worker cannot do this: Chrome never routes synchronous XHR through one, and a sandboxed frame without allow-same-origin is not a
// Service Worker client at all. Measured; see the design doc.)
//
// Static references (img/source/video/audio/track src, script src, link rel=stylesheet, CSS url() and @import) are rewritten here, before the frame is created: each becomes a data:
// URL, an inline <script> or an inline <style> holding the bytes the app (or the APK) answered. Pure string functions over a small HTML tokenizer; no DOM is needed, so the same code
// runs in the page and in tests. Runtime requests (fetch, XHR, elements created by scripts) are resolved by the bridge script over the same protocol (src/webview-bridge.js).
//
// `resolve(url, kind)` is the caller's: it returns { status, mime, bytes } for a resource somebody answered, or null when nobody intercepted it (the reference is then left as the
// document wrote it, and the document's CSP decides whether the browser may load it).

export const MAX_RESOURCES = 256;       // static references rewritten per document
export const MAX_CSS_DEPTH = 3;          // @import nesting
export const RESOURCE_MAX_BYTES = 8 * 1024 * 1024;

const MIME = {
  html: 'text/html', htm: 'text/html', xhtml: 'application/xhtml+xml', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', txt: 'text/plain', xml: 'text/xml',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', wasm: 'application/wasm',
};
/** The MIME type Android's MimeTypeMap gives a path's extension (octet-stream when unknown). */
export const mimeForPath = path => MIME[String(path).split(/[?#]/)[0].split('.').pop().toLowerCase()] ?? 'application/octet-stream';

export const ASSET_PREFIX = 'file:///android_asset/';
/** The APK entry (`assets/...`) for a file:///android_asset/ URL, or null (another scheme, a path that climbs out of the assets directory, or an empty path). */
export function assetEntry(url) {
  const text = String(url);
  if (!text.startsWith(ASSET_PREFIX)) return null;
  let path;
  try { path = decodeURIComponent(text.slice(ASSET_PREFIX.length).split(/[?#]/)[0]); } catch { return null; }
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); continue; }
    parts.push(part);
  }
  return parts.length ? 'assets/' + parts.join('/') : null;
}

export function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
export const dataUrl = (mime, bytes) => `data:${String(mime || 'application/octet-stream').split(';')[0].trim()};base64,${toBase64(bytes)}`;
const decoder = new TextDecoder('utf-8');
const textOf = bytes => decoder.decode(bytes);

const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noembed', 'noframes', 'plaintext']);
const MEDIA_SRC = { img: ['src'], source: ['src'], video: ['src', 'poster'], audio: ['src'], track: ['src'] };
const escapeAttribute = text => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const unescapeAttribute = text => String(text).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const inlineScript = text => text.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const inlineStyle = text => text.replace(/<\/(style)/gi, '<\\/$1');

/** Tokenizes `html` into tags with their attribute and raw-text ranges. Comments, doctypes and the contents of script/style/textarea/title are skipped, never mistaken for markup. */
export function* tags(html) {
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) return;
    if (html.startsWith('<!--', lt)) { const end = html.indexOf('-->', lt + 4); i = end < 0 ? n : end + 3; continue; }
    if (html[lt + 1] === '!' || html[lt + 1] === '?' || html[lt + 1] === '/') { const end = html.indexOf('>', lt + 1); i = end < 0 ? n : end + 1; continue; }
    const nameMatch = /^[A-Za-z][^\s/>]*/.exec(html.slice(lt + 1, lt + 64));
    if (!nameMatch) { i = lt + 1; continue; }
    const name = nameMatch[0].toLowerCase(), attrs = [];
    let p = lt + 1 + nameMatch[0].length;
    for (;;) {
      while (p < n && /[\s/]/.test(html[p])) p++;
      if (p >= n) break;
      if (html[p] === '>') { p++; break; }
      const nameStart = p;
      while (p < n && !/[\s=/>]/.test(html[p])) p++;
      if (p === nameStart) { p++; continue; }
      const attr = { name: html.slice(nameStart, p).toLowerCase(), start: nameStart, value: null, valueStart: -1, valueEnd: -1 };
      let q = p; while (q < n && /\s/.test(html[q])) q++;
      if (html[q] === '=') {
        q++; while (q < n && /\s/.test(html[q])) q++;
        if (html[q] === '"' || html[q] === "'") { const close = html.indexOf(html[q], q + 1); const end = close < 0 ? n : close; attr.valueStart = q + 1; attr.valueEnd = end; attr.value = unescapeAttribute(html.slice(q + 1, end)); p = close < 0 ? n : close + 1; }
        else { let e = q; while (e < n && !/[\s>]/.test(html[e])) e++; attr.valueStart = q; attr.valueEnd = e; attr.value = unescapeAttribute(html.slice(q, e)); p = e; }
      }
      attr.end = p; attrs.push(attr);
    }
    const tag = { name, start: lt, end: p, attrs, content: null, close: null };
    if (RAW_TEXT.has(name)) {
      const closeAt = html.toLowerCase().indexOf('</' + name, p);
      const contentEnd = closeAt < 0 ? n : closeAt, closeEnd = closeAt < 0 ? n : (html.indexOf('>', closeAt) < 0 ? n : html.indexOf('>', closeAt) + 1);
      tag.content = { start: p, end: contentEnd }; tag.close = { start: contentEnd, end: closeEnd }; p = closeEnd;
    }
    yield tag;
    i = p;
  }
}
const attrOf = (tag, name) => tag.attrs.find(a => a.name === name);
const skippable = value => !value || /^(#|data:|blob:|javascript:|about:|mailto:|tel:)/i.test(value.trim());
const absolute = (value, base) => { try { return new URL(value.trim(), base).href; } catch { return null; } };
const tokens = value => String(value ?? '').toLowerCase().split(/\s+/).filter(Boolean);

/** Rewrites CSS: @import and url() references become inline text and data: URLs. */
export async function rewriteCss(css, { base, resolve, depth = 0, budget = { left: MAX_RESOURCES } }) {
  const edits = [];
  const importPattern = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*([^;]*);/gi;
  for (const m of css.matchAll(importPattern)) {
    const target = m[2] ?? m[4], url = skippable(target) ? null : absolute(target, base);
    if (!url || depth >= MAX_CSS_DEPTH || budget.left-- <= 0) continue;
    edits.push((async () => {
      const result = await resolve(url, 'style'); if (!result || result.status >= 400) return null;
      const inner = await rewriteCss(textOf(result.bytes), { base: url, resolve, depth: depth + 1, budget });
      return { start: m.index, end: m.index + m[0].length, text: (m[5].trim() ? `@media ${m[5].trim()} {\n` : '') + inner + (m[5].trim() ? '\n}' : '') };
    })());
  }
  const importRanges = (await Promise.all(edits.splice(0))).filter(Boolean);
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    if (importRanges.some(e => m.index >= e.start && m.index < e.end) || /@import\s+$/i.test(css.slice(Math.max(0, m.index - 12), m.index))) continue;
    const url = skippable(m[2]) ? null : absolute(m[2], base);
    if (!url || budget.left-- <= 0) continue;
    edits.push((async () => {
      const result = await resolve(url, 'image'); if (!result || result.status >= 400) return null;
      return { start: m.index, end: m.index + m[0].length, text: `url("${dataUrl(result.mime, result.bytes)}")` };
    })());
  }
  const all = [...importRanges, ...(await Promise.all(edits)).filter(Boolean)].sort((a, b) => a.start - b.start);
  let out = '', at = 0;
  for (const e of all) { if (e.start < at) continue; out += css.slice(at, e.start) + e.text; at = e.end; }
  return out + css.slice(at);
}

/**
 * Rewrites the static references of `html` through `resolve`. Returns { html, resolved, passthrough, failed } (counts of references). References nobody intercepted stay as written;
 * references answered with an error status stay as written too and are counted in `failed` (the browser will then fail them under the document's CSP).
 */
export async function rewriteDocument(html, { base, resolve }) {
  const text = String(html), budget = { left: MAX_RESOURCES }, stats = { resolved: 0, passthrough: 0, failed: 0 };
  let docBase = base;
  const found = [...tags(text)];
  const baseTag = found.find(t => t.name === 'base' && attrOf(t, 'href'));
  if (baseTag) { const resolved = absolute(attrOf(baseTag, 'href').value, base); if (resolved) docBase = resolved; }
  const count = outcome => { stats[outcome]++; };
  const fetchOne = async (url, kind) => {
    const result = await resolve(url, kind);
    if (!result) { count('passthrough'); return null; }
    if (result.status >= 400 || !result.bytes) { count('failed'); return null; }
    count('resolved'); return result;
  };
  const jobs = [];
  for (const tag of found) {
    const take = () => budget.left-- > 0;
    if (MEDIA_SRC[tag.name]) {
      for (const name of MEDIA_SRC[tag.name]) {
        const attr = attrOf(tag, name); if (!attr || attr.value === null || skippable(attr.value)) continue;
        const url = absolute(attr.value, docBase); if (!url || !take()) continue;
        jobs.push(fetchOne(url, name === 'poster' ? 'image' : tag.name === 'img' ? 'image' : 'media').then(r => r && { start: attr.valueStart, end: attr.valueEnd, text: escapeAttribute(dataUrl(r.mime, r.bytes)) }));
      }
    } else if (tag.name === 'script') {
      const attr = attrOf(tag, 'src'); if (!attr || attr.value === null || skippable(attr.value)) continue;
      const url = absolute(attr.value, docBase); if (!url || !take()) continue;
      jobs.push(fetchOne(url, 'script').then(r => {
        if (!r) return null;
        const kept = tag.attrs.filter(a => !['src', 'integrity', 'crossorigin', 'async', 'defer'].includes(a.name)).map(a => text.slice(a.start, a.end)).join(' ');
        return { start: tag.start, end: tag.close.end, text: `<script${kept ? ' ' + kept : ''}>${inlineScript(textOf(r.bytes))}</script>` };
      }));
    } else if (tag.name === 'link') {
      const rel = tokens(attrOf(tag, 'rel')?.value), attr = attrOf(tag, 'href');
      if (!attr || attr.value === null || skippable(attr.value)) continue;
      if (rel.includes('stylesheet')) {
        const url = absolute(attr.value, docBase); if (!url || !take()) continue;
        const media = attrOf(tag, 'media')?.value;
        jobs.push(fetchOne(url, 'style').then(async r => r && { start: tag.start, end: tag.end, text: `<style${media ? ` media="${escapeAttribute(media)}"` : ''}>${inlineStyle(await rewriteCss(textOf(r.bytes), { base: url, resolve: fetchOne, budget }))}</style>` }));
      } else if (rel.some(r => ['icon', 'shortcut', 'apple-touch-icon', 'preload', 'prefetch', 'modulepreload'].includes(r))) {
        jobs.push(Promise.resolve({ start: tag.start, end: tag.end, text: '' }));   // a frame has no favicon and the document's CSP would refuse the hint
      }
    } else if (tag.name === 'style' && tag.content) {
      const css = text.slice(tag.content.start, tag.content.end);
      if (/url\(|@import/i.test(css)) jobs.push(rewriteCss(css, { base: docBase, resolve: fetchOne, budget }).then(out => ({ start: tag.content.start, end: tag.content.end, text: inlineStyle(out) })));
    }
    const style = attrOf(tag, 'style');
    if (style && style.value && /url\(/i.test(style.value) && tag.name !== 'style') jobs.push(rewriteCss(style.value, { base: docBase, resolve: fetchOne, budget }).then(out => ({ start: style.valueStart, end: style.valueEnd, text: escapeAttribute(out) })));
  }
  const edits = (await Promise.all(jobs)).filter(Boolean).sort((a, b) => a.start - b.start);
  let out = '', at = 0;
  for (const e of edits) { if (e.start < at) continue; out += text.slice(at, e.start) + e.text; at = e.end; }
  return { html: out + text.slice(at), ...stats };
}
