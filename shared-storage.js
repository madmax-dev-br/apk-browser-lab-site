// The virtual device's shared storage and the system pickers over it: the model shared by the page (the "Arquivos do dispositivo" group and the picker dialog) and the VM
// (src/shared-storage-host.js). DOM-free, no process.*: it runs in the Worker and the page.
//
// The tester attaches files in the page; they are the content of the device's shared storage (/storage/emulated/0/Pictures, Movies, Music, Download), as files put on a phone over USB:
// no app of the device owns them. An app reaches them the three ways Android offers:
//   - a system picker (ACTION_GET_CONTENT / ACTION_OPEN_DOCUMENT: the documents picker; MediaStore.ACTION_PICK_IMAGES: the photo picker; ACTION_PICK on images or video: the gallery),
//     which needs no permission and answers with content:// Uris the app is granted;
//   - MediaStore queries, which list the media files the app's READ_MEDIA_* (or, below targetSdk 33, READ_EXTERNAL_STORAGE) permission covers;
//   - the File API under /storage/emulated/0, which shows the same media files as MediaStore (Android 11+ scoped storage) and never another app's documents.

export const MAX_FILES = 200, MAX_FILE_BYTES = 64 * 1024 * 1024, MAX_TOTAL_BYTES = 256 * 1024 * 1024;
export const PICK_IMAGES_MAX_LIMIT = 100;   // MediaStore.getPickImagesMaxLimit()
export const ACTION = Object.freeze({
  GET_CONTENT: 'android.intent.action.GET_CONTENT', OPEN_DOCUMENT: 'android.intent.action.OPEN_DOCUMENT', OPEN_DOCUMENT_TREE: 'android.intent.action.OPEN_DOCUMENT_TREE',
  CREATE_DOCUMENT: 'android.intent.action.CREATE_DOCUMENT', PICK: 'android.intent.action.PICK', PICK_IMAGES: 'android.provider.action.PICK_IMAGES',
});
export const EXTRA = Object.freeze({ MIME_TYPES: 'android.intent.extra.MIME_TYPES', ALLOW_MULTIPLE: 'android.intent.extra.ALLOW_MULTIPLE', PICK_IMAGES_MAX: 'android.provider.extra.PICK_IMAGES_MAX' });
export const AUTHORITY = Object.freeze({ MEDIA: 'media', MEDIA_DOCUMENTS: 'com.android.providers.media.documents', STORAGE_DOCUMENTS: 'com.android.externalstorage.documents' });
export const PICKER_PREFIX = 'content://media/picker/0/com.android.providers.media.photopicker/media/';
/** The packages that answer the picker Intents on a device: DocumentsUI and the MediaProvider module (photo picker); the gallery role is played by the photo picker's package here. */
export const SYSTEM_PICKERS = Object.freeze({
  documents: { packageName: 'com.android.documentsui', className: 'com.android.documentsui.picker.PickActivity', label: 'Arquivos' },
  photos: { packageName: 'com.android.providers.media.module', className: 'com.android.providers.media.photopicker.PhotoPickerActivity', label: 'Seletor de fotos' },
  gallery: { packageName: 'com.android.providers.media.module', className: 'com.android.providers.media.photopicker.PhotoPickerGetContentActivity', label: 'Galeria' },
});

const P = 'android.permission.';
/** 'image' | 'video' | 'audio' | 'document' */
export const kindOf = mime => { const top = String(mime ?? '').toLowerCase().split('/')[0]; return top === 'image' || top === 'video' || top === 'audio' ? top : 'document'; };
/** The public directory the scanner would find a file of this kind in. */
export const directoryOf = kind => ({ image: 'Pictures', video: 'Movies', audio: 'Music' })[kind] ?? 'Download';
/** The permission that lets an app see another owner's file of this kind through MediaStore and the File API (null: none does). */
export function readPermissionFor(kind, targetSdk) {
  if (kind === 'document') return null;
  if (targetSdk < 33) return P + 'READ_EXTERNAL_STORAGE';
  return P + (kind === 'image' ? 'READ_MEDIA_IMAGES' : kind === 'video' ? 'READ_MEDIA_VIDEO' : 'READ_MEDIA_AUDIO');
}
/** ClipDescription.compareMimeTypes / DocumentsUI MimeTypes.mimeMatches: "*" + "/*", "type/*" or the exact type. */
export function mimeMatches(filter, mime) {
  if (filter == null) return true; if (mime == null) return false;
  const f = String(filter).toLowerCase(), m = String(mime).toLowerCase();
  if (f === '*/*' || f === m) return true;
  return f.endsWith('/*') && m.startsWith(f.slice(0, -1));
}
export const mimeMatchesAny = (filters, mime) => !filters || !filters.length || filters.some(filter => mimeMatches(filter, mime));
export const extensionOf = name => { const dot = String(name).lastIndexOf('.'); return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ''; };
export const titleOf = name => { const dot = String(name).lastIndexOf('.'); return dot > 0 ? name.slice(0, dot) : String(name); };

/** A file name the shared storage can hold: no path separators or control characters, at most 255 UTF-16 units, never empty. */
export function safeName(name) {
  let out = String(name ?? '').replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim();
  if (!out || out === '.' || out === '..') out = 'arquivo';
  return out.length > 255 ? out.slice(0, 255) : out;
}
/** `name` made unique among `taken` the way a file manager does: "foto.png", "foto (1).png", ... */
export function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; ; i++) { const candidate = `${stem} (${i})${ext}`; if (!taken.has(candidate)) return candidate; }
}
const intOrNull = value => Number.isFinite(value) && value > 0 ? Math.round(value) : null;
/** The metadata of one attached file as both sides keep it (the bytes travel next to it). `mime` may be empty: the VM resolves it from the extension with libcore's MimeMap. */
export function fileRecord(input) {
  const id = Number(input?.id); if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError('Arquivo do dispositivo sem identificador válido.');
  const size = Number(input.size); if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) throw new RangeError(`Arquivo do dispositivo fora do limite de ${MAX_FILE_BYTES / 1048576} MiB.`);
  const mime = typeof input.mime === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(input.mime) ? input.mime.toLowerCase() : '';
  return { id, name: safeName(input.name), mime, size, modified: Number.isFinite(Number(input.modified)) && Number(input.modified) > 0 ? Math.floor(Number(input.modified)) : 0, added: Number.isFinite(Number(input.added)) && Number(input.added) > 0 ? Math.floor(Number(input.added)) : 0,
    width: intOrNull(input.width), height: intOrNull(input.height), duration: intOrNull(input.duration) };
}

/**
 * What a picker Intent asks for. `intent`: { action, type, data, categories, package, mimeTypes (EXTRA_MIME_TYPES or null), allowMultiple (EXTRA_ALLOW_MULTIPLE), pickImagesMax (EXTRA_PICK_IMAGES_MAX
 * or null) }. Returns null when no system picker of the device answers this Intent (the caller reports ActivityNotFoundException as before), { unsupported: message } when a system app
 * answers it on a device but the lab does not model it, else the picker spec:
 *   { picker: 'documents' | 'photos' | 'gallery', action, filters: [mime filter], multiple, max, persistable, writable, invalid: reason | null }
 * `invalid`: the photo picker's own argument check failed; it finishes with RESULT_CANCELED without showing anything, as PhotoPickerActivity does.
 */
export function pickerSpec(intent) {
  const action = intent?.action ?? null, type = intent?.type ? String(intent.type).toLowerCase() : null, categories = intent?.categories ?? [];
  const system = Object.values(SYSTEM_PICKERS).map(entry => entry.packageName);
  if (intent?.package && !system.includes(intent.package)) return null;
  const extra = Array.isArray(intent?.mimeTypes) && intent.mimeTypes.length ? intent.mimeTypes.map(value => String(value).toLowerCase()) : null;
  const known = ['android.intent.category.DEFAULT', 'android.intent.category.OPENABLE'];
  if (action === ACTION.GET_CONTENT || action === ACTION.OPEN_DOCUMENT) {
    // DocumentsUI's filters: <action GET_CONTENT | OPEN_DOCUMENT> <category DEFAULT, OPENABLE> <data mimeType "*/*">: an Intent without a MIME type, or with another category, matches nothing.
    if (!type || categories.some(category => !known.includes(category)) || intent?.data) return null;
    const open = action === ACTION.OPEN_DOCUMENT;
    return { picker: 'documents', action, filters: extra ?? [type], multiple: !!intent.allowMultiple, max: 0, persistable: open, writable: open, invalid: null };
  }
  if (action === ACTION.OPEN_DOCUMENT_TREE || action === ACTION.CREATE_DOCUMENT) {
    if (action === ACTION.CREATE_DOCUMENT && !type) return null;
    return { unsupported: `Intent ${action}: the lab's documents picker only opens files attached to the virtual device; ${action === ACTION.CREATE_DOCUMENT ? 'creating a document' : 'granting a directory tree'} is not modelled` };
  }
  if (action === ACTION.PICK_IMAGES) {
    if (categories.some(category => category !== known[0])) return null;
    const filters = extra ?? (type ? [type] : ['image/*', 'video/*']), visual = filter => filter.startsWith('image/') || filter.startsWith('video/');
    const max = intent.pickImagesMax;
    let invalid = null;
    if (!filters.every(visual)) invalid = `the photo picker only offers images and videos (type ${filters.join(', ')})`;
    else if (max !== null && max !== undefined && (!(max > 1) || max > PICK_IMAGES_MAX_LIMIT)) invalid = `EXTRA_PICK_IMAGES_MAX must be greater than 1 and at most ${PICK_IMAGES_MAX_LIMIT} (got ${max})`;
    const multiple = max !== null && max !== undefined;
    return { picker: 'photos', action, filters, multiple, max: multiple ? max : 1, persistable: true, writable: false, invalid };
  }
  if (action === ACTION.PICK) {
    // The gallery answers ACTION_PICK for the image and video collections: by data Uri (MediaStore.Images.Media.EXTERNAL_CONTENT_URI) or by type (image/*, vnd.android.cursor.dir/image).
    if (categories.some(category => category !== known[0])) return null;
    const data = intent.data ? String(intent.data) : null, collection = data ? /^content:\/\/media\/(?:external|external_primary|internal)\/(images|video)\/media\/?$/.exec(data)?.[1] : null;
    if (data && !collection) return null;
    let filters = null;
    if (type === 'vnd.android.cursor.dir/image') filters = ['image/*']; else if (type === 'vnd.android.cursor.dir/video') filters = ['video/*'];
    else if (type && (type.startsWith('image/') || type.startsWith('video/'))) filters = [type];
    else if (type) return null;
    else if (collection) filters = [collection === 'images' ? 'image/*' : 'video/*'];
    if (!filters) return null;
    if (collection && !filters.every(filter => filter.startsWith(collection === 'images' ? 'image/' : 'video/'))) return null;
    return { picker: 'gallery', action, filters, multiple: !!intent.allowMultiple, max: 0, persistable: false, writable: false, invalid: null };
  }
  return null;
}

/** The files a picker lists: the photo picker and the gallery show only what matches; the documents picker shows every file and lets the matching ones be chosen. */
export function pickerCandidates(spec, files) {
  const matching = files.filter(file => mimeMatchesAny(spec.filters, file.mime) && (spec.picker === 'documents' || kindOf(file.mime) === 'image' || kindOf(file.mime) === 'video'));
  return { matching, others: files.length - matching.length };
}
/** The user's choice checked against the request: known ids that were offered, in the order chosen, cut to the limit; an empty result is a cancellation. */
export function settleSelection(spec, offered, selected) {
  if (!Array.isArray(selected)) return [];
  const allowed = new Set(offered), out = [];
  for (const id of selected) { const value = Number(id); if (allowed.has(value) && !out.includes(value)) out.push(value); }
  const limit = spec.multiple ? (spec.max > 0 ? spec.max : out.length) : 1;
  return out.slice(0, limit);
}

/** content:// Uri of a file as each picker hands it out. */
export function uriFor(style, file) {
  const kind = kindOf(file.mime);
  if (style === 'picker') return PICKER_PREFIX + file.id;
  if (style === 'media') return `content://media/external/${kind === 'image' ? 'images/media' : kind === 'video' ? 'video/media' : kind === 'audio' ? 'audio/media' : 'file'}/${file.id}`;
  if (kind === 'document') return `content://${AUTHORITY.STORAGE_DOCUMENTS}/document/${encodeURIComponent(`primary:${directoryOf(kind)}/${file.name}`)}`;   // encodeURIComponent keeps the characters android.net.Uri.encode keeps
  return `content://${AUTHORITY.MEDIA_DOCUMENTS}/document/${kind}%3A${file.id}`;
}
/**
 * Parses a content Uri of the shared storage providers. { authority, kind, ... } or null for another authority:
 *   media: { kind: 'collection' | 'item' | 'picker' | 'unknown', volume, table: 'images' | 'video' | 'audio' | 'file' | 'downloads', id }
 *   documents: { kind: 'document' | 'unknown', docId, id (media documents), path (storage documents: "Download/name") }
 */
export function parseStorageUri(text) {
  const match = /^content:\/\/([^/?#]+)(\/[^?#]*)?/.exec(String(text ?? '')); if (!match) return null;
  const authority = decodeURIComponent(match[1]); let segments;
  try { segments = (match[2] ?? '').split('/').filter(Boolean).map(decodeURIComponent); } catch { return Object.values(AUTHORITY).includes(authority) ? { authority, kind: 'unknown' } : null; }
  const numeric = value => /^\d{1,15}$/.test(value ?? '') ? Number(value) : null;
  if (authority === AUTHORITY.MEDIA) {
    if (segments[0] === 'picker') { const id = numeric(segments[4]); return segments.length === 5 && segments[2] === 'com.android.providers.media.photopicker' && segments[3] === 'media' && id !== null ? { authority, kind: 'picker', id } : { authority, kind: 'unknown' }; }
    const [volume, table, third, fourth] = segments;
    if (!['external', 'external_primary', 'internal'].includes(volume)) return { authority, kind: 'unknown' };
    if (['images', 'video', 'audio'].includes(table) && third === 'media' && segments.length <= 4) { if (segments.length === 3) return { authority, kind: 'collection', volume, table }; const id = numeric(fourth); return id === null ? { authority, kind: 'unknown' } : { authority, kind: 'item', volume, table, id }; }
    if ((table === 'file' || table === 'downloads') && segments.length <= 3) { if (segments.length === 2) return { authority, kind: 'collection', volume, table }; const id = numeric(third); return id === null ? { authority, kind: 'unknown' } : { authority, kind: 'item', volume, table, id }; }
    return { authority, kind: 'unknown' };
  }
  if (authority === AUTHORITY.MEDIA_DOCUMENTS || authority === AUTHORITY.STORAGE_DOCUMENTS) {
    if (segments.length !== 2 || segments[0] !== 'document') return { authority, kind: 'unknown' };
    const docId = segments[1], colon = docId.indexOf(':'); if (colon < 0) return { authority, kind: 'unknown' };
    if (authority === AUTHORITY.MEDIA_DOCUMENTS) { const id = numeric(docId.slice(colon + 1)), type = docId.slice(0, colon); return id !== null && ['image', 'video', 'audio'].includes(type) ? { authority, kind: 'document', docId, type, id } : { authority, kind: 'unknown' }; }
    return docId.startsWith('primary:') ? { authority, kind: 'document', docId, path: docId.slice(colon + 1) } : { authority, kind: 'unknown' };
  }
  return null;
}

// ---- MediaStore selection / sort (the SQL subset apps write against the media collections) -------------------------------------------------------------------------------------------------
export class QuerySyntaxError extends Error {}
function tokenize(sql) {
  const tokens = [], pattern = /\s*(?:(\?)|('(?:[^']|'')*')|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(<>|!=|<=|>=|==|=|<|>|\(|\)|,))/y;
  let at = 0;
  while (at < sql.length) {
    if (/^\s*$/.test(sql.slice(at))) break;
    pattern.lastIndex = at; const m = pattern.exec(sql);
    if (!m) throw new QuerySyntaxError(`near "${sql.slice(at).trim().slice(0, 24)}"`);
    at = pattern.lastIndex;
    if (m[1]) tokens.push({ kind: 'arg' }); else if (m[2] !== undefined) tokens.push({ kind: 'value', value: m[2].slice(1, -1).replaceAll("''", "'") });
    else if (m[3] !== undefined) tokens.push({ kind: 'value', value: Number(m[3]) }); else if (m[4] !== undefined) tokens.push({ kind: 'word', text: m[4], upper: m[4].toUpperCase() }); else tokens.push({ kind: 'op', text: m[5] });
  }
  return tokens;
}
const likePattern = pattern => new RegExp('^' + [...String(pattern)].map(c => c === '%' ? '[\\s\\S]*' : c === '_' ? '[\\s\\S]' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$', 'i');
/** SQLite comparison of a column value with an operand: numbers compare numerically (a numeric string bound with `?` against an INTEGER column too), text compares as text. */
function compare(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return null;
  const numeric = value => typeof value === 'number' || (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value));
  if (typeof left === 'number' && numeric(right)) return left - Number(right);
  if (typeof right === 'number' && numeric(left)) return Number(left) - right;
  const a = String(left), b = String(right); return a < b ? -1 : a > b ? 1 : 0;
}
/**
 * Compiles a WHERE clause over `columns` (Set of names) into row => boolean. Supported: comparisons (= == != <> < <= > >=), [NOT] LIKE, [NOT] IN (...), IS [NOT] NULL, AND, OR, NOT,
 * parentheses, `?` arguments, string and number literals. Anything else throws QuerySyntaxError naming the token; an unknown column throws QuerySyntaxError('no such column: x').
 */
export function compileSelection(selection, args, columns) {
  if (selection === null || selection === undefined || !String(selection).trim()) return () => true;
  const tokens = tokenize(String(selection)); let at = 0, argAt = 0;
  const peek = () => tokens[at], isWord = word => peek()?.kind === 'word' && peek().upper === word, isOp = text => peek()?.kind === 'op' && peek().text === text;
  const fail = () => { const token = peek(); throw new QuerySyntaxError(token ? `near "${token.text ?? token.value ?? '?'}"` : 'incomplete input'); };
  const KEYWORDS = new Set(['AND', 'OR', 'NOT', 'LIKE', 'IN', 'IS', 'NULL']);
  const operand = () => {
    const token = tokens[at++]; if (!token) { at--; fail(); }
    if (token.kind === 'arg') { const index = argAt++; if (!args || index >= args.length) throw new QuerySyntaxError(`bind argument ${index + 1} is missing`); const value = args[index]; return () => value; }
    if (token.kind === 'value') return () => token.value;
    if (token.kind === 'word' && token.upper === 'NULL') return () => null;
    if (token.kind === 'word' && !KEYWORDS.has(token.upper)) { if (isOp('(')) throw new QuerySyntaxError(`near "${token.text}(": SQL functions are not evaluated`); if (!columns.has(token.text)) throw new QuerySyntaxError(`no such column: ${token.text}`); return row => row[token.text] ?? null; }
    at--; return fail();
  };
  const predicate = () => {
    if (isWord('NOT')) { at++; const inner = predicate(); return row => !inner(row); }
    if (isOp('(')) { at++; const inner = disjunction(); if (!isOp(')')) fail(); at++; return inner; }
    const left = operand();
    let negate = false; if (isWord('NOT')) { at++; negate = true; if (!isWord('LIKE') && !isWord('IN')) fail(); }
    if (isWord('LIKE')) { at++; const right = operand(); return row => { const value = left(row), pattern = right(row); if (value === null || pattern === null) return false; return likePattern(pattern).test(String(value)) !== negate; }; }
    if (isWord('IN')) {
      at++; if (!isOp('(')) fail(); at++; const items = [];
      if (!isOp(')')) for (;;) { items.push(operand()); if (isOp(',')) { at++; continue; } break; }
      if (!isOp(')')) fail(); at++;
      return row => { const value = left(row); if (value === null) return false; return items.some(item => compare(value, item(row)) === 0) !== negate; };
    }
    if (isWord('IS')) { at++; let not = false; if (isWord('NOT')) { at++; not = true; } if (!isWord('NULL')) fail(); at++; return row => (left(row) === null) !== not; }
    const op = peek(); if (op?.kind !== 'op' || ['(', ')', ','].includes(op.text)) fail(); at++;
    const right = operand();
    return row => { const c = compare(left(row), right(row)); if (c === null) return false; switch (op.text) { case '=': case '==': return c === 0; case '!=': case '<>': return c !== 0; case '<': return c < 0; case '<=': return c <= 0; case '>': return c > 0; default: return c >= 0; } };
  };
  const conjunction = () => { let left = predicate(); while (isWord('AND')) { at++; const a = left, b = predicate(); left = row => a(row) && b(row); } return left; };
  function disjunction() { let left = conjunction(); while (isWord('OR')) { at++; const a = left, b = conjunction(); left = row => a(row) || b(row); } return left; }
  const compiled = disjunction(); if (at < tokens.length) fail();
  return compiled;
}
/** Parses "col [ASC|DESC] [, ...] [LIMIT n [OFFSET m]]" into { keys: [{ column, descending }], limit, offset }. */
export function parseSortOrder(sort, columns) {
  const out = { keys: [], limit: null, offset: 0 }; if (sort === null || sort === undefined || !String(sort).trim()) return out;
  const tokens = tokenize(String(sort)); let at = 0;
  const word = name => tokens[at]?.kind === 'word' && tokens[at].upper === name;
  const number = () => { const token = tokens[at++]; if (token?.kind !== 'value' || typeof token.value !== 'number') throw new QuerySyntaxError('near "LIMIT"'); return token.value; };
  if (!word('LIMIT')) for (;;) {
    const token = tokens[at++]; if (token?.kind !== 'word') throw new QuerySyntaxError(`near "${token?.text ?? token?.value ?? ''}"`);
    if (tokens[at]?.kind === 'op' && tokens[at].text === '(') throw new QuerySyntaxError(`near "${token.text}(": SQL functions are not evaluated`);
    if (!columns.has(token.text)) throw new QuerySyntaxError(`no such column: ${token.text}`);
    let descending = false; if (word('COLLATE')) { at += 2; } if (word('ASC')) at++; else if (word('DESC')) { at++; descending = true; }
    out.keys.push({ column: token.text, descending });
    if (tokens[at]?.kind === 'op' && tokens[at].text === ',') { at++; continue; } break;
  }
  if (word('LIMIT')) { at++; out.limit = number(); if (word('OFFSET')) { at++; out.offset = number(); } else if (tokens[at]?.kind === 'op' && tokens[at].text === ',') { at++; out.offset = out.limit; out.limit = number(); } }
  if (at < tokens.length) throw new QuerySyntaxError(`near "${tokens[at].text ?? tokens[at].value ?? '?'}"`);
  return out;
}
export function sortRows(rows, order) {
  const sorted = order.keys.length ? [...rows].sort((a, b) => { for (const key of order.keys) { const x = a[key.column] ?? null, y = b[key.column] ?? null; const c = x === null ? (y === null ? 0 : -1) : y === null ? 1 : compare(x, y); if (c) return key.descending ? -c : c; } return 0; }) : rows;
  return order.limit === null ? sorted.slice(order.offset) : sorted.slice(order.offset, order.offset + order.limit);
}
