import { createHostRegistry } from './host-contract.js?v=5553a52fdbbb';
import { APKError } from './apk-error.js?v=5553a52fdbbb';
import { cleartextPermitted } from './network-native.js?v=5553a52fdbbb';
import { probeIsoBmff, sniffContainer, videoSampleTable } from './media-container.js?v=5553a52fdbbb';
import { parseAvcConfigurationRecord, avcCodecString } from './media-mp4.js?v=5553a52fdbbb';
import { rotateRGBA } from './camera-frames.js?v=5553a52fdbbb';
import { Blocked } from './scheduler.js?v=5553a52fdbbb';
import { IntCells } from './java-arrays.js?v=5553a52fdbbb';
import { state as ioState } from './libcore-io-native.js?v=5553a52fdbbb';

// Small platform classes: android.os.WorkSource (a set of (uid, name) pairs the framework blames for work), and android.media.MediaMetadataRetriever (android.graphics.Movie is src/animated-image-host.js).
// MediaMetadataRetriever reads the container metadata of MP4 / MOV / 3GP sources (src/media-container.js: duration, size, rotation, track kinds); a missing or unrecognised source fails the way
// the framework does, and what needs another container's parser says explicitly that there is no extractor (never an invented duration or frame). A frame of an H.264 track is decoded by the
// host's video decoder (src/media-codec-backend.js: WebCodecs), which answers asynchronously: the calling thread waits for it, so it has to be a thread that can wait (not a main-thread
// callback); without a decoder, for another codec, or where the thread cannot wait, the call fails naming the reason.
const WS = 'Landroid/os/WorkSource;', MMR = 'Landroid/media/MediaMetadataRetriever;', STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;';
const URI = 'Landroid/net/Uri;', CONTEXT = 'Landroid/content/Context;', FD = 'Ljava/io/FileDescriptor;', BITMAP = 'Landroid/graphics/Bitmap;', PARAMS = 'Landroid/media/MediaMetadataRetriever$BitmapParams;', LIST = 'Ljava/util/List;';
const nullish = v => v === null || v === undefined || v === 0;

export function createMiscPlatformHost(platform) {
  const registry = createHostRegistry(), { def, type, staticField } = registry;
  type(WS, OBJECT, ['Landroid/os/Parcelable;'], { allocatable: true }); type(MMR, OBJECT, ['Ljava/lang/AutoCloseable;'], { allocatable: true });
  const npe = (r, m = null) => r.throwJava('Ljava/lang/NullPointerException;', m);
  const text = (r, v) => nullish(v) ? null : typeof v === 'string' ? v : r.stringCharacters(v);
  const unsupported = (message, kind) => { throw new APKError(message, { kind }); };

  // ---- WorkSource: ordered, duplicate-free (uid, name) entries ------------------------------------------------------------------------------------------------------------------------------------------
  const entries = (r, self) => r.object(self).work ??= [];
  const sameEntry = (a, b) => a.uid === b.uid && (a.name ?? null) === (b.name ?? null);
  const addAll = (list, other) => { let changed = false; for (const entry of other) if (!list.some(e => sameEntry(e, entry))) { list.push({ ...entry }); changed = true; } return changed; };
  def(WS, '<init>', '()V', (r, _m, [self]) => { r.object(self).work = []; });
  def(WS, '<init>', `(${WS})V`, (r, _m, [self, source]) => { r.object(self).work = nullish(source) ? [] : entries(r, source).map(e => ({ ...e })); });
  def(WS, '<init>', '(I)V', (r, _m, [self, uid]) => { r.object(self).work = [{ uid, name: null }]; });
  def(WS, '<init>', `(I${STRING})V`, (r, _m, [self, uid, name]) => { if (nullish(name)) npe(r, 'packageName'); r.object(self).work = [{ uid, name: text(r, name) }]; });
  def(WS, 'size', '()I', (r, _m, [self]) => entries(r, self).length);
  def(WS, 'isEmpty', '()Z', (r, _m, [self]) => entries(r, self).length === 0 ? 1 : 0);
  def(WS, 'getUid', '(I)I', (r, _m, [self, i]) => { const e = entries(r, self)[i]; if (!e) r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `length=${entries(r, self).length}; index=${i}`); return e.uid; });
  def(WS, 'getName', `(I)${STRING}`, (r, _m, [self, i]) => { const e = entries(r, self)[i]; if (!e) r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `length=${entries(r, self).length}; index=${i}`); return e.name; });
  def(WS, 'add', '(I)Z', (r, _m, [self, uid]) => addAll(entries(r, self), [{ uid, name: null }]) ? 1 : 0);
  def(WS, 'add', `(I${STRING})Z`, (r, _m, [self, uid, name]) => { if (nullish(name)) npe(r, 'name'); return addAll(entries(r, self), [{ uid, name: text(r, name) }]) ? 1 : 0; });
  def(WS, 'add', `(${WS})Z`, (r, _m, [self, other]) => { if (nullish(other)) npe(r); return addAll(entries(r, self), entries(r, other)) ? 1 : 0; });
  def(WS, 'remove', `(${WS})Z`, (r, _m, [self, other]) => { if (nullish(other)) npe(r); const list = entries(r, self), before = list.length; r.object(self).work = list.filter(e => !entries(r, other).some(o => sameEntry(o, e))); return r.object(self).work.length !== before ? 1 : 0; });
  def(WS, 'diff', `(${WS})Z`, (r, _m, [self, other]) => { if (nullish(other)) npe(r); const a = entries(r, self), b = entries(r, other); return a.length !== b.length || a.some(e => !b.some(o => sameEntry(o, e))) ? 1 : 0; });
  def(WS, 'set', `(${WS})V`, (r, _m, [self, other]) => { r.object(self).work = nullish(other) ? [] : entries(r, other).map(e => ({ ...e })); });
  def(WS, 'clear', '()V', (r, _m, [self]) => { r.object(self).work = []; });
  def(WS, 'clone', `()${OBJECT}`, (r, _m, [self]) => { const copy = r.allocate(WS); r.object(copy).work = entries(r, self).map(e => ({ ...e })); return copy; });
  def(WS, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => { if (nullish(other) || r.typeOf(other) !== WS) return 0; const a = entries(r, self), b = entries(r, other); return a.length === b.length && a.every(e => b.some(o => sameEntry(o, e))) ? 1 : 0; });
  def(WS, 'hashCode', '()I', (r, _m, [self]) => { let h = 0; for (const e of entries(r, self)) h = (Math.imul(31, h) + (e.uid | 0) + [...(e.name ?? '')].reduce((x, c) => (Math.imul(31, x) + c.charCodeAt(0)) | 0, 0)) | 0; return h; });
  def(WS, 'toString', `()${STRING}`, (r, _m, [self]) => `WorkSource{${entries(r, self).map(e => e.name == null ? `${e.uid}` : `${e.uid} ${e.name}`).join(', ')}}`);
  def(WS, 'describeContents', '()I', () => 0);

  // ---- MediaMetadataRetriever: container metadata of ISO BMFF sources (MP4 / MOV / 3GP, src/media-container.js); no frames, no other container ---------------------------------------------------
  const noExtractor = what => unsupported(`${what}: the lab has no media extractor for this (it reads the duration, size, rotation and track kinds of MP4 / MOV / 3GP files; no codecs, no other container)`, 'media-extractor-unsupported');
  const failed = r => r.throwJava('Ljava/lang/RuntimeException;', 'setDataSource failed: status = 0x80000000');
  /** The source's bytes become the retriever's metadata; an unreadable or unrecognised source fails as the framework does, a recognised container the lab does not read says so. */
  const setSource = (r, self, bytes, what) => {
    const meta = bytes ? probeIsoBmff(bytes) : null;
    if (!meta) { const container = bytes ? sniffContainer(bytes) : null; if (container === null) failed(r); noExtractor(`${what} (${container === 'ISO BMFF' ? 'an MP4-family file without a readable movie header' : container})`); }
    r.object(self).retriever = meta; meta.bytes = bytes;
  };
  const fileBytes = (r, path) => { const node = platform.javaIo.fs().node(path); return node && node.type === 'file' ? node.buf.subarray(0, node.size) : null; };
  const streamBytes = (r, stream) => {
    const INPUT = 'Ljava/io/InputStream;', chunks = [], buffer = r.newArray('[B', 65536), read = { owner: INPUT, name: 'read', parameters: ['[B', 'I', 'I'], result: 'I', signature: '([BII)I' };
    try { for (;;) { const n = r.dispatch(read, [stream, buffer, 0, 65536], 'virtual'); if (n < 0) break; chunks.push(r.bytesOf(buffer, 0, n).slice()); } } finally { r.dispatch({ owner: INPUT, name: 'close', parameters: [], result: 'V', signature: '()V' }, [stream], 'virtual'); }
    const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0)); let at = 0; for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; } return out;
  };
  const pathSource = (r, self, path, what) => {
    if (nullish(path)) r.throwJava('Ljava/lang/IllegalArgumentException;', null);
    const p = text(r, path); if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p) && !p.startsWith('file://')) noExtractor(`${what} with a network or content address`);
    setSource(r, self, fileBytes(r, p.replace(/^file:\/\//, '')), what);
  };
  def(MMR, '<init>', '()V', () => {});
  def(MMR, 'setDataSource', `(${STRING})V`, (r, _m, [self, path]) => pathSource(r, self, path, 'MediaMetadataRetriever.setDataSource(String)'));
  def(MMR, 'setDataSource', `(${STRING}Ljava/util/Map;)V`, (r, _m, [self, path]) => pathSource(r, self, path, 'MediaMetadataRetriever.setDataSource(String, Map)'));
  def(MMR, 'setDataSource', `(${CONTEXT}${URI})V`, (r, _m, [self, context, uri]) => {
    if (nullish(uri)) r.throwJava('Ljava/lang/IllegalArgumentException;', null);
    const what = 'MediaMetadataRetriever.setDataSource(Context, Uri)', value = text(r, r.dispatch({ owner: OBJECT, name: 'toString', parameters: [], result: STRING, signature: `()${STRING}` }, [uri], 'virtual')), scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase() ?? null;
    if (scheme === null || scheme === 'file') return setSource(r, self, fileBytes(r, decodeURIComponent(value.replace(/^file:\/\//, '').replace(/[?#].*$/, ''))), what);
    if (scheme !== 'content') noExtractor(`${what} with a ${scheme}: address`);
    let bytes = platform.sharedStorage?.bytesFor(r, value, what) ?? null;   // the device's shared storage (same access checks as ContentResolver.openFile)
    if (bytes === null) {   // another provider (the app's own): ContentResolver.openInputStream, as the framework opens an AssetFileDescriptor
      if (nullish(context)) r.throwJava('Ljava/lang/IllegalArgumentException;', null);
      const RESOLVER = 'Landroid/content/ContentResolver;', resolver = r.dispatch({ owner: CONTEXT, name: 'getContentResolver', parameters: [], result: RESOLVER, signature: `()${RESOLVER}` }, [context], 'virtual');
      const stream = r.dispatch({ owner: RESOLVER, name: 'openInputStream', parameters: [URI], result: 'Ljava/io/InputStream;', signature: `(${URI})Ljava/io/InputStream;` }, [resolver, uri], 'virtual');
      bytes = nullish(stream) ? null : streamBytes(r, stream);
    }
    setSource(r, self, bytes, what);
  });
  const descriptorBytes = (r, fd) => { if (nullish(fd)) r.throwJava('Ljava/lang/IllegalArgumentException;', null); const node = ioState(r).table.get(r.object(fd).fields.get('Ljava/io/FileDescriptor;->descriptor:I') | 0)?.desc?.node; return node && node.type === 'file' ? node.buf.subarray(0, node.size) : null; };
  def(MMR, 'setDataSource', `(${FD})V`, (r, _m, [self, fd]) => setSource(r, self, descriptorBytes(r, fd), 'MediaMetadataRetriever.setDataSource(FileDescriptor)'));
  def(MMR, 'setDataSource', `(${FD}JJ)V`, (r, _m, [self, fd, offset, length]) => {
    const bytes = descriptorBytes(r, fd), from = Number(offset), count = Number(length); if (from < 0 || count < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', null);
    setSource(r, self, bytes === null ? null : bytes.subarray(Math.min(from, bytes.length), Math.min(from + count, bytes.length)), 'MediaMetadataRetriever.setDataSource(FileDescriptor, offset, length)');
  });
  def(MMR, 'setDataSource', '(Landroid/media/MediaDataSource;)V', () => noExtractor('MediaMetadataRetriever.setDataSource(MediaDataSource)'));
  def(MMR, 'release', '()V', (r, _m, [self]) => { r.object(self).retriever = null; }); def(MMR, 'close', '()V', (r, _m, [self]) => { r.object(self).retriever = null; });
  const noSource = r => r.throwJava('Ljava/lang/IllegalStateException;', 'No data source set.');
  const sourceOf = (r, self) => r.object(self).retriever ?? noSource(r);
  // METADATA_KEY_*: NUM_TRACKS 10, DURATION 9, MIMETYPE 12, HAS_AUDIO 16, HAS_VIDEO 17, VIDEO_WIDTH 18, VIDEO_HEIGHT 19, VIDEO_ROTATION 24; a key the file does not carry answers null, as on Android.
  def(MMR, 'extractMetadata', `(I)${STRING}`, (r, _m, [self, key]) => {
    const meta = sourceOf(r, self);
    switch (key) {
      case 9: return String(meta.durationMs); case 10: return String(meta.tracks); case 12: return meta.mime;
      case 16: return meta.hasAudio ? 'yes' : null; case 17: return meta.hasVideo ? 'yes' : null;
      case 18: return meta.hasVideo && meta.width !== null ? String(meta.width) : null; case 19: return meta.hasVideo && meta.height !== null ? String(meta.height) : null;
      case 24: return meta.hasVideo ? String(meta.rotation) : null;
      case 32: { const table = meta.hasVideo ? videoSampleTable(meta.bytes) : null; return table ? String(table.samples.length) : null; }
      default: return noExtractor(`MediaMetadataRetriever.extractMetadata(${key}): only the duration, track count, MIME type, has-audio / has-video, video size, rotation and frame count keys are read`);
    }
  });
  def(MMR, 'getEmbeddedPicture', '()[B', (r, _m, [self]) => { sourceOf(r, self); return noExtractor('MediaMetadataRetriever.getEmbeddedPicture'); });
  // Frames. OPTION_PREVIOUS_SYNC 0, OPTION_NEXT_SYNC 1, OPTION_CLOSEST_SYNC 2, OPTION_CLOSEST 3; a negative time asks for a representative frame (the first sync sample here).
  const CONFIG = 'Landroid/graphics/Bitmap$Config;';
  const bitmapOf = (r, picture, rotation) => {
    const turned = rotation ? rotateRGBA(picture.rgba, picture.width, picture.height, rotation) : picture, count = turned.width * turned.height, rgba = turned.rgba, colors = new IntCells(count);
    for (let i = 0, at = 0; i < count; i++, at += 4) colors[i] = (255 << 24) | (rgba[at] << 16) | (rgba[at + 1] << 8) | rgba[at + 2];
    return r.dispatch({ owner: BITMAP, name: 'createBitmap', parameters: ['[I', 'I', 'I', CONFIG], result: BITMAP, signature: `([III${CONFIG})${BITMAP}` }, [r.newArray('[I', count, colors), turned.width, turned.height, r.readStatic({ owner: CONFIG, name: 'ARGB_8888', type: CONFIG })], 'static');
  };
  /** The sample to show for (timeUs, option), by index into the track's samples; -1 when the track is empty. */
  const pickSample = (samples, timeUs, option) => {
    const syncs = samples.map((sample, index) => (sample.key ? index : -1)).filter(index => index >= 0); if (!syncs.length) return -1;
    if (timeUs < 0) return syncs[0];
    const closest = list => list.reduce((best, index) => (Math.abs(samples[index].timeUs - timeUs) < Math.abs(samples[best].timeUs - timeUs) ? index : best), list[0]);
    if (option === 0) return syncs.filter(index => samples[index].timeUs <= timeUs).at(-1) ?? syncs[0];
    if (option === 1) return syncs.find(index => samples[index].timeUs >= timeUs) ?? syncs.at(-1);
    if (option === 3) return closest(samples.map((_, index) => index));
    return closest(syncs);
  };
  /** Decodes sample `pick(table)` of the source's video track into a Bitmap, turned by the track's rotation; `after(bitmap)` post-processes it. null when the source has no decodable frame there. */
  const frame = (r, self, what, pick, after = bitmap => bitmap) => {
    const meta = sourceOf(r, self); if (!meta.hasVideo) return null;
    const table = videoSampleTable(meta.bytes); if (!table || !table.samples.length) return null;
    const target = pick(table); if (target < 0 || target >= table.samples.length) return null;
    if (table.fourcc !== 'avc1' && table.fourcc !== 'avc3') noExtractor(`${what}: decoding a frame of a '${table.fourcc}' track (frames are decoded for H.264 / AVC tracks only)`);
    const config = table.description ? parseAvcConfigurationRecord(table.description) : null; if (!config) return null;
    const decoder = platform.camera?.media?.backend; if (typeof decoder?.decodeVideoFrame !== 'function') noExtractor(`${what}: decoding a video frame needs a codec, and this host has no video decoder (WebCodecs)`);
    let from = target; while (from > 0 && !table.samples[from].key) from--;
    const request = { codec: avcCodecString(config.sps), description: table.description.slice(), codedWidth: table.codedWidth, codedHeight: table.codedHeight, samples: table.samples.slice(from, target + 1).map(sample => ({ data: meta.bytes.slice(sample.offset, sample.offset + sample.size), key: sample.key, timestampUs: sample.timeUs })) };
    // The decoder answers from the host's event loop. A thread running under a host call (a main-thread callback served by the Looper, a native that called back) cannot yield to it.
    if ((r.thread?.nestedDepth ?? 0) > 0) throw new APKError(`${what} was called where the VM cannot wait for the host's video decoder (a main-thread callback or another host call): the decoder answers asynchronously. Call it from a background thread`, { kind: 'media-would-block' });
    const wait = { done: false, picture: null, error: null };
    Promise.resolve().then(() => decoder.decodeVideoFrame(request)).then(picture => { wait.picture = picture; }, error => { wait.error = error; }).then(() => { wait.done = true; platform.onExternalActivity?.(); });
    return new Blocked({ reason: what, roots: [self],
      ready: () => wait.done,
      finish: () => { if (wait.error || !wait.picture) { r.record(`MEDIA ${what}: no frame (${String(wait.error?.message ?? wait.error ?? 'the decoder returned nothing')})`); return null; } return after(bitmapOf(r, wait.picture, table.rotation)); } });
  };
  const atTime = (r, self, what, timeUs, option, after) => { if (option < 0 || option > 3) r.throwJava('Ljava/lang/IllegalArgumentException;', `Unsupported option: ${option}`); return frame(r, self, what, table => pickSample(table.samples, Number(timeUs), option), after); };
  def(MMR, 'getFrameAtTime', `()${BITMAP}`, (r, _m, [self]) => atTime(r, self, 'MediaMetadataRetriever.getFrameAtTime', -1, 2));
  def(MMR, 'getFrameAtTime', `(J)${BITMAP}`, (r, _m, [self, timeUs]) => atTime(r, self, 'MediaMetadataRetriever.getFrameAtTime', timeUs, 2));
  def(MMR, 'getFrameAtTime', `(JI)${BITMAP}`, (r, _m, [self, timeUs, option]) => atTime(r, self, 'MediaMetadataRetriever.getFrameAtTime', timeUs, option));
  def(MMR, 'getFrameAtTime', `(JI${PARAMS})${BITMAP}`, (r, _m, [self, timeUs, option]) => atTime(r, self, 'MediaMetadataRetriever.getFrameAtTime', timeUs, option));
  /** getScaledFrameAtTime: the frame scaled down to fit dstWidth x dstHeight, keeping its aspect ratio (MediaMetadataRetriever asks the extractor for exactly that). */
  const scaled = (r, self, timeUs, option, width, height) => {
    if (width <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid width: ${width}`); if (height <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid height: ${height}`);
    return atTime(r, self, 'MediaMetadataRetriever.getScaledFrameAtTime', timeUs, option, bitmap => {
      const size = name => r.dispatch({ owner: BITMAP, name, parameters: [], result: 'I', signature: '()I' }, [bitmap], 'virtual'), w = size('getWidth'), h = size('getHeight'), scale = Math.min(1, width / w, height / h);
      return scale >= 1 ? bitmap : r.dispatch({ owner: BITMAP, name: 'createScaledBitmap', parameters: [BITMAP, 'I', 'I', 'Z'], result: BITMAP, signature: `(${BITMAP}IIZ)${BITMAP}` }, [bitmap, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), 1], 'static');
    });
  };
  def(MMR, 'getScaledFrameAtTime', `(JIII)${BITMAP}`, (r, _m, [self, timeUs, option, width, height]) => scaled(r, self, timeUs, option, width, height));
  def(MMR, 'getScaledFrameAtTime', `(JIII${PARAMS})${BITMAP}`, (r, _m, [self, timeUs, option, width, height]) => scaled(r, self, timeUs, option, width, height));
  const atIndex = (r, self, index) => { if (index < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid frameIndex: ${index}`); return frame(r, self, 'MediaMetadataRetriever.getFrameAtIndex', table => (index < table.samples.length ? index : r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid frameIndex or numFrames: ${index}, 1`))); };
  def(MMR, 'getFrameAtIndex', `(I)${BITMAP}`, (r, _m, [self, index]) => atIndex(r, self, index)); def(MMR, 'getFrameAtIndex', `(I${PARAMS})${BITMAP}`, (r, _m, [self, index]) => atIndex(r, self, index));
  for (const [name, sig] of [['getImageAtIndex', '(I)'], ['getImageAtIndex', `(I${PARAMS})`], ['getPrimaryImage', '()'], ['getPrimaryImage', `(${PARAMS})`]])
    def(MMR, name, `${sig}${BITMAP}`, (r, _m, [self]) => { sourceOf(r, self); return noExtractor(`MediaMetadataRetriever.${name}: still images in a media file (HEIF) are not read`); });
  def(MMR, 'getFramesAtIndex', `(II)${LIST}`, (r, _m, [self]) => { sourceOf(r, self); return noExtractor('MediaMetadataRetriever.getFramesAtIndex: only single frames are decoded (getFrameAtIndex)'); });
  def(MMR, 'getFramesAtIndex', `(II${PARAMS})${LIST}`, (r, _m, [self]) => { sourceOf(r, self); return noExtractor('MediaMetadataRetriever.getFramesAtIndex: only single frames are decoded (getFrameAtIndex)'); });
  // METADATA_KEY_VIDEO_FRAME_COUNT (32): the number of samples of the video track.


  const UL = 'Landroid/icu/util/ULocale;', LOCALE = 'Ljava/util/Locale;';
  const callV = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const callS = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, args, 'static');
  // ---- java.util.Locale display names (getDisplayLanguage / getDisplayCountry / getDisplayScript / getDisplayName), in the Locale's own or a given Locale, from the platform CLDR data (Intl.DisplayNames).
  const tagOf = (r, loc) => { const t = r.object(loc).localeData?.tag; return t && t !== 'und' ? t : 'en-US'; };
  const partsOf = (r, loc) => ({ language: callV(r, loc, LOCALE, 'getLanguage', [], STRING), script: callV(r, loc, LOCALE, 'getScript', [], STRING), country: callV(r, loc, LOCALE, 'getCountry', [], STRING), variant: callV(r, loc, LOCALE, 'getVariant', [], STRING) });
  const display = (r, loc, inLoc, kind) => {
    const names = (type, code) => { if (!code) return ''; try { return new Intl.DisplayNames([tagOf(r, inLoc)], { type, fallback: 'code' }).of(code) ?? code; } catch { return code; } };
    const p = partsOf(r, loc), language = names('language', p.language), script = names('script', p.script), country = names('region', p.country);
    if (kind === 'language') return language; if (kind === 'country') return country; if (kind === 'script') return script; if (kind === 'variant') return p.variant;
    const qualifiers = [script, country, p.variant].filter(Boolean);   // Locale.getDisplayName: "language (script, country, variant)"
    return qualifiers.length ? `${language} (${qualifiers.join(', ')})` : language;
  };
  for (const [name, kind] of [['getDisplayLanguage', 'language'], ['getDisplayCountry', 'country'], ['getDisplayScript', 'script'], ['getDisplayVariant', 'variant'], ['getDisplayName', 'name']]) {
    def(LOCALE, name, `()${STRING}`, (r, _m, [self]) => display(r, self, callS(r, LOCALE, 'getDefault', [], LOCALE), kind));
    def(LOCALE, name, `(${LOCALE})${STRING}`, (r, _m, [self, inLocale]) => { if (nullish(inLocale)) npe(r, 'inLocale'); return display(r, self, inLocale, kind); });
  }

  // ---- android.icu.util.ULocale over the platform's java.util.Locale (ICU4J itself, with its data bundles, is not part of the lab; the Locale model carries language, script, country, variant and the
  // display names from the platform CLDR data). Keywords (-u- extensions) beyond the Locale's own are not modelled: getKeywordValue answers null and getKeywords null.
  type(UL, OBJECT, ['Ljava/lang/Comparable;', 'Ljava/io/Serializable;'], { allocatable: true });
  const locale = (r, self) => r.object(self).locale ?? r.throwJava('Ljava/lang/IllegalStateException;', 'ULocale used before construction');
  const KEY_LEGACY = { ca: 'calendar', nu: 'numbers', co: 'collation', hc: 'hours', cu: 'currency', kn: 'colnumeric', kf: 'colcasefirst', ks: 'colstrength' }, VALUE_LEGACY = { phonebk: 'phonebook', trad: 'traditional', dict: 'dictionary', gregory: 'gregorian', ethioaa: 'ethiopic-amete-alem', islamicc: 'islamic-civil' };
  const parseExtensions = tag => { const m = /-u((?:-[a-z0-9]{2,8})+)/i.exec(tag), out = {}; if (!m) return out; let key = null; for (const token of m[1].slice(1).split('-')) { if (token.length === 2 && /^[a-z][a-z0-9]$/i.test(token)) { key = token.toLowerCase(); out[key] = ''; } else if (key) out[key] = out[key] ? `${out[key]}-${token.toLowerCase()}` : token.toLowerCase(); } return out; };
  const wrap = (r, loc, keywords = {}) => { const o = r.allocate(UL); r.object(o).locale = loc; r.object(o).keywords = keywords; return o; };
  const tagWithKeywords = (r, loc, keywords) => { const base = text(r, callV(r, loc, LOCALE, 'toLanguageTag', [], STRING)).replace(/-u(?:-[a-z0-9]{2,8})+/i, ''), pairs = Object.entries(keywords); return pairs.length ? `${base}-u${pairs.map(([k, v]) => `-${k}${v ? '-' + v : ''}`).join('')}` : base; };
  const fromId = (r, id) => callS(r, LOCALE, 'forLanguageTag', [STRING], LOCALE, [text(r, id).replace(/_/g, '-').split('@')[0]]);
  def(UL, '<init>', `(${STRING})V`, (r, _m, [self, id]) => {
    if (nullish(id)) npe(r); const raw = text(r, id), at = raw.indexOf('@'), keywords = {};
    if (at >= 0) for (const pair of raw.slice(at + 1).split(';')) { const [k, v] = pair.split('='); const short = Object.entries(KEY_LEGACY).find(([, legacy]) => legacy === k)?.[0] ?? k; keywords[short] = Object.entries(VALUE_LEGACY).find(([, legacy]) => legacy === v)?.[0] ?? v; }
    r.object(self).locale = fromId(r, id); r.object(self).keywords = keywords;
  });
  def(UL, '<init>', `(${STRING}${STRING})V`, (r, _m, [self, lang, country]) => { r.object(self).locale = construct(r, LOCALE, [STRING, STRING], [lang ?? '', country ?? '']); r.object(self).keywords = {}; });
  def(UL, '<init>', `(${STRING}${STRING}${STRING})V`, (r, _m, [self, lang, country, variant]) => { r.object(self).locale = construct(r, LOCALE, [STRING, STRING, STRING], [lang ?? '', country ?? '', variant ?? '']); });
  const construct = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, [o, ...args], 'direct'); return o; };
  def(UL, 'forLanguageTag', `(${STRING})${UL}`, (r, _m, [tag]) => { if (nullish(tag)) npe(r); return wrap(r, callS(r, LOCALE, 'forLanguageTag', [STRING], LOCALE, [tag]), parseExtensions(text(r, tag))); }, { static: true });
  def(UL, 'createCanonical', `(${STRING})${UL}`, (r, _m, [id]) => wrap(r, fromId(r, id)), { static: true });
  def(UL, 'createCanonical', `(${UL})${UL}`, (r, _m, [other]) => other, { static: true });
  def(UL, 'getDefault', `()${UL}`, r => wrap(r, callS(r, LOCALE, 'getDefault', [], LOCALE)), { static: true });
  def(UL, 'getDefault', `(Landroid/icu/util/ULocale$Category;)${UL}`, r => wrap(r, callS(r, LOCALE, 'getDefault', [], LOCALE)), { static: true });
  def(UL, 'getAvailableLocales', `()[${UL}`, r => { const tags = ['en-US', 'pt-BR', 'es-ES', 'fr-FR', 'de-DE'], array = r.newArray(`[${UL}`, tags.length); r.array(array).elements = tags.map(tag => wrap(r, callS(r, LOCALE, 'forLanguageTag', [STRING], LOCALE, [tag]))); return array; }, { static: true });
  def(UL, 'toLanguageTag', `()${STRING}`, (r, _m, [self]) => tagWithKeywords(r, locale(r, self), r.object(self).keywords ?? {}));
  def(UL, 'toLocale', `()${LOCALE}`, (r, _m, [self]) => locale(r, self));
  for (const name of ['getLanguage', 'getCountry', 'getVariant']) def(UL, name, `()${STRING}`, (r, _m, [self]) => callV(r, locale(r, self), LOCALE, name, [], STRING));
  def(UL, 'getScript', `()${STRING}`, (r, _m, [self]) => callV(r, locale(r, self), LOCALE, 'getScript', [], STRING));
  def(UL, 'getName', `()${STRING}`, (r, _m, [self]) => { const base = text(r, callV(r, locale(r, self), OBJECT, 'toString', [], STRING)), pairs = Object.entries(r.object(self).keywords ?? {}).map(([k, v]) => [KEY_LEGACY[k] ?? k, VALUE_LEGACY[v] ?? v]).sort(([a], [b]) => a < b ? -1 : 1); return pairs.length ? `${base}@${pairs.map(([k, v]) => `${k}=${v}`).join(';')}` : base; });
  def(UL, 'getBaseName', `()${STRING}`, (r, _m, [self]) => callV(r, locale(r, self), OBJECT, 'toString', [], STRING));
  for (const name of ['getDisplayName', 'getDisplayLanguage', 'getDisplayCountry']) { def(UL, name, `()${STRING}`, (r, _m, [self]) => callV(r, locale(r, self), LOCALE, name, [], STRING)); def(UL, name, `(${UL})${STRING}`, (r, _m, [self, inLocale]) => callV(r, locale(r, self), LOCALE, name, [LOCALE], STRING, [locale(r, inLocale)])); }
  def(UL, 'getKeywordValue', `(${STRING})${STRING}`, (r, _m, [self, key]) => { if (nullish(key)) npe(r); const k = text(r, key), short = Object.entries(KEY_LEGACY).find(([, legacy]) => legacy === k)?.[0] ?? k, v = (r.object(self).keywords ?? {})[short]; return v === undefined ? null : VALUE_LEGACY[v] ?? v; });
  def(UL, 'getKeywords', '()Ljava/util/Iterator;', (r, _m, [self]) => { const names = Object.keys(r.object(self).keywords ?? {}).map(k => KEY_LEGACY[k] ?? k).sort(); if (!names.length) return null; const list = construct(r, 'Ljava/util/ArrayList;', [], []); for (const n of names) callV(r, list, 'Ljava/util/ArrayList;', 'add', [OBJECT], 'Z', [n]); return callV(r, list, 'Ljava/util/ArrayList;', 'iterator', [], 'Ljava/util/Iterator;'); });
  // ---- ULocale.Builder: language / script / region / variant, language tag, and Unicode keywords (the ca, nu, co, hc, cu keys); anything else is rejected
  const BUILDER = 'Landroid/icu/util/ULocale$Builder;'; type(BUILDER, OBJECT, [], { allocatable: true });
  const b = (r, self) => r.object(self).build ??= { language: '', script: '', region: '', variant: '', keywords: {} };
  def(BUILDER, '<init>', '()V', (r, _m, [self]) => b(r, self));
  for (const [name, key] of [['setLanguage', 'language'], ['setScript', 'script'], ['setRegion', 'region'], ['setVariant', 'variant']]) def(BUILDER, name, `(${STRING})${BUILDER}`, (r, _m, [self, v]) => { b(r, self)[key] = nullish(v) ? '' : text(r, v); return self; });
  def(BUILDER, 'setLocale', `(${UL})${BUILDER}`, (r, _m, [self, loc]) => { const st = b(r, self), l = locale(r, loc); Object.assign(st, { language: text(r, callV(r, l, LOCALE, 'getLanguage', [], STRING)), script: text(r, callV(r, l, LOCALE, 'getScript', [], STRING)), region: text(r, callV(r, l, LOCALE, 'getCountry', [], STRING)), variant: text(r, callV(r, l, LOCALE, 'getVariant', [], STRING)), keywords: { ...(r.object(loc).keywords ?? {}) } }); return self; });
  def(BUILDER, 'setLanguageTag', `(${STRING})${BUILDER}`, (r, _m, [self, tag]) => { const l = callS(r, LOCALE, 'forLanguageTag', [STRING], LOCALE, [tag]), st = b(r, self); Object.assign(st, { language: text(r, callV(r, l, LOCALE, 'getLanguage', [], STRING)), script: text(r, callV(r, l, LOCALE, 'getScript', [], STRING)), region: text(r, callV(r, l, LOCALE, 'getCountry', [], STRING)), variant: text(r, callV(r, l, LOCALE, 'getVariant', [], STRING)), keywords: parseExtensions(text(r, tag)) }); return self; });
  def(BUILDER, 'setUnicodeLocaleKeyword', `(${STRING}${STRING})${BUILDER}`, (r, _m, [self, key, value]) => { const k = text(r, key); if (!/^[a-z][a-z0-9]$/i.test(k ?? '')) r.throwJava('Ljava/util/IllformedLocaleException;', `Ill-formed Unicode locale keyword key: ${k}`); if (nullish(value)) delete b(r, self).keywords[k]; else b(r, self).keywords[k.toLowerCase()] = text(r, value).toLowerCase(); return self; });
  def(BUILDER, 'clearExtensions', `()${BUILDER}`, (r, _m, [self]) => { b(r, self).keywords = {}; return self; });
  def(BUILDER, 'clear', `()${BUILDER}`, (r, _m, [self]) => { r.object(self).build = { language: '', script: '', region: '', variant: '', keywords: {} }; return self; });
  def(BUILDER, 'build', `()${UL}`, (r, _m, [self]) => { const st = b(r, self), tag = [st.language || 'und', st.script, st.region, st.variant].filter(Boolean).join('-'); return wrap(r, callS(r, LOCALE, 'forLanguageTag', [STRING], LOCALE, [tag]), { ...st.keywords }); });
  def(UL, 'toString', `()${STRING}`, (r, _m, [self]) => callV(r, locale(r, self), OBJECT, 'toString', [], STRING));
  def(UL, 'hashCode', '()I', (r, _m, [self]) => callV(r, locale(r, self), OBJECT, 'hashCode', [], 'I'));
  def(UL, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => !nullish(other) && r.typeOf(other) === UL && callV(r, locale(r, self), OBJECT, 'equals', [OBJECT], 'Z', [locale(r, other)]) ? 1 : 0);
  def(UL, 'compareTo', `(${UL})I`, (r, _m, [self, other]) => { const a = callV(r, locale(r, self), OBJECT, 'toString', [], STRING), b = callV(r, locale(r, other), OBJECT, 'toString', [], STRING); return a < b ? -1 : a > b ? 1 : 0; });

  // ---- java.util.logging.Logger members the system host's logger model lacks: logp (source class / method are only record metadata), entering / exiting, the Supplier overloads, getGlobal, filters
  const LOGGER = 'Ljava/util/logging/Logger;', LEVEL = 'Ljava/util/logging/Level;', SUPPLIER = 'Ljava/util/function/Supplier;', THROWABLE = 'Ljava/lang/Throwable;', OBJECTS = '[Ljava/lang/Object;';
  const level = (r, name) => r.readStatic({ owner: LEVEL, name, type: LEVEL, key: `${LEVEL}->${name}:${LEVEL}` });
  const supplied = (r, supplier) => callV(r, supplier, SUPPLIER, 'get', [], OBJECT);
  const loggable = (r, self, lv) => callV(r, self, LOGGER, 'isLoggable', [LEVEL], 'Z', [lv]) === 1 || callV(r, self, LOGGER, 'isLoggable', [LEVEL], 'Z', [lv]) === true;
  const logSupplied = (r, self, lv, supplier, thrown = null) => { if (!loggable(r, self, lv)) return; const message = supplied(r, supplier); if (thrown === null) callV(r, self, LOGGER, 'log', [LEVEL, STRING], 'V', [lv, message]); else callV(r, self, LOGGER, 'log', [LEVEL, STRING, THROWABLE], 'V', [lv, message, thrown]); };
  for (const name of ['severe', 'warning', 'info', 'config', 'fine', 'finer', 'finest']) def(LOGGER, name, `(${SUPPLIER})V`, (r, _m, [self, supplier]) => logSupplied(r, self, level(r, name.toUpperCase()), supplier));
  def(LOGGER, 'log', `(${LEVEL}${SUPPLIER})V`, (r, _m, [self, lv, supplier]) => logSupplied(r, self, lv, supplier));
  def(LOGGER, 'log', `(${LEVEL}${THROWABLE}${SUPPLIER})V`, (r, _m, [self, lv, thrown, supplier]) => logSupplied(r, self, lv, supplier, thrown));
  const logp = (r, self, lv, message, extra) => { if (extra === undefined) callV(r, self, LOGGER, 'log', [LEVEL, STRING], 'V', [lv, message]); else if (extra.thrown !== undefined) callV(r, self, LOGGER, 'log', [LEVEL, STRING, THROWABLE], 'V', [lv, message, extra.thrown]); else callV(r, self, LOGGER, 'log', [LEVEL, STRING, OBJECTS], 'V', [lv, message, extra.params]); };
  const one = (r, value) => { const array = r.newArray(OBJECTS, 1); r.array(array).elements = [value]; return array; };
  def(LOGGER, 'logp', `(${LEVEL}${STRING}${STRING}${STRING})V`, (r, _m, [self, lv, , , msg]) => logp(r, self, lv, msg));
  def(LOGGER, 'logp', `(${LEVEL}${STRING}${STRING}${STRING}${OBJECT})V`, (r, _m, [self, lv, , , msg, p]) => logp(r, self, lv, msg, { params: one(r, p) }));
  def(LOGGER, 'logp', `(${LEVEL}${STRING}${STRING}${STRING}${OBJECTS})V`, (r, _m, [self, lv, , , msg, ps]) => logp(r, self, lv, msg, { params: ps }));
  def(LOGGER, 'logp', `(${LEVEL}${STRING}${STRING}${STRING}${THROWABLE})V`, (r, _m, [self, lv, , , msg, t]) => logp(r, self, lv, msg, { thrown: t }));
  def(LOGGER, 'logp', `(${LEVEL}${STRING}${STRING}${SUPPLIER})V`, (r, _m, [self, lv, , , supplier]) => logSupplied(r, self, lv, supplier));
  def(LOGGER, 'logp', `(${LEVEL}${STRING}${STRING}${THROWABLE}${SUPPLIER})V`, (r, _m, [self, lv, , , t, supplier]) => logSupplied(r, self, lv, supplier, t));
  def(LOGGER, 'entering', `(${STRING}${STRING})V`, (r, _m, [self]) => logp(r, self, level(r, 'FINER'), 'ENTRY'));
  def(LOGGER, 'entering', `(${STRING}${STRING}${OBJECT})V`, (r, _m, [self, , , p]) => logp(r, self, level(r, 'FINER'), 'ENTRY {0}', { params: one(r, p) }));
  def(LOGGER, 'entering', `(${STRING}${STRING}${OBJECTS})V`, (r, _m, [self, , , ps]) => { const n = nullish(ps) ? 0 : r.array(ps).elements.length; logp(r, self, level(r, 'FINER'), 'ENTRY' + Array.from({ length: n }, (_, i) => ` {${i}}`).join(''), nullish(ps) ? undefined : { params: ps }); });
  def(LOGGER, 'exiting', `(${STRING}${STRING})V`, (r, _m, [self]) => logp(r, self, level(r, 'FINER'), 'RETURN'));
  def(LOGGER, 'exiting', `(${STRING}${STRING}${OBJECT})V`, (r, _m, [self, , , p]) => logp(r, self, level(r, 'FINER'), 'RETURN {0}', { params: one(r, p) }));
  def(LOGGER, 'getGlobal', `()${LOGGER}`, r => callS(r, LOGGER, 'getLogger', [STRING], LOGGER, ['global']), { static: true });
  def(LOGGER, 'getFilter', '()Ljava/util/logging/Filter;', (r, _m, [self]) => r.object(self).filter ?? null); def(LOGGER, 'setFilter', '(Ljava/util/logging/Filter;)V', (r, _m, [self, filter]) => { r.object(self).filter = nullish(filter) ? null : filter; });

  // ---- AnimationUtils XML loading: the lab's AnimationUtils class carries the animation clock only; the load* / make* calls go to the original code copied into dev.apkweb.view.XmlAnimations (layouts profile)
  const UTILS = 'Landroid/view/animation/AnimationUtils;', XA = 'Ldev/apkweb/view/XmlAnimations;', ANIM = 'Landroid/view/animation/Animation;', INTERP = 'Landroid/view/animation/Interpolator;', LAC = 'Landroid/view/animation/LayoutAnimationController;';
  const xa = (r, name, parameters, result, args) => { if (!r.classes.has(XA)) unsupported(`AnimationUtils.${name}: XML animation loading needs the layouts framework profile (enableLayoutProfile)`, 'xml-animations-profile'); return callS(r, XA, name, parameters, result, args); };
  for (const [name, parameters, result] of [['loadAnimation', [CONTEXT, 'I'], ANIM], ['loadLayoutAnimation', [CONTEXT, 'I'], LAC], ['loadInterpolator', [CONTEXT, 'I'], INTERP], ['loadInterpolator', ['Landroid/content/res/Resources;', 'Landroid/content/res/Resources$Theme;', 'I'], INTERP], ]) {
    def(UTILS, name, `(${parameters.join('')})${result}`, (r, _m, args) => xa(r, name, parameters, result, args), { static: true });
  }
  for (const [name, parameters] of [['makeInAnimation', [CONTEXT, 'Z']], ['makeOutAnimation', [CONTEXT, 'Z']], ['makeInChildBottomAnimation', [CONTEXT]]]) def(UTILS, name, `(${parameters.join('')})${ANIM}`, () => unsupported(`AnimationUtils.${name}: the framework's slide_in / slide_out animation resources are not part of the lab`, 'framework-animation-resources'), { static: true });

  // ---- android.content.ContentUris (android-13.0.0_r1 ContentUris.java) ---------------------------------------------------------------------------------------------------------------------------------------
  const CU = 'Landroid/content/ContentUris;', URI_BUILDER = 'Landroid/net/Uri$Builder;'; type(CU, OBJECT, [], { allocatable: false });
  const uriLast = (r, uri) => text(r, callV(r, uri, URI, 'getLastPathSegment', [], STRING));
  def(CU, 'appendId', `(${URI_BUILDER}J)${URI_BUILDER}`, (r, _m, [builder, id]) => callV(r, builder, URI_BUILDER, 'appendEncodedPath', [STRING], URI_BUILDER, [String(id)]), { static: true });
  def(CU, 'withAppendedId', `(${URI}J)${URI}`, (r, _m, [uri, id]) => { if (nullish(uri)) npe(r); const b = callV(r, uri, URI, 'buildUpon', [], URI_BUILDER); callV(r, b, URI_BUILDER, 'appendEncodedPath', [STRING], URI_BUILDER, [String(id)]); return callV(r, b, URI_BUILDER, 'build', [], URI); }, { static: true });
  def(CU, 'parseId', `(${URI})J`, (r, _m, [uri]) => { const last = uriLast(r, uri); return last === null ? -1n : callS(r, 'Ljava/lang/Long;', 'parseLong', [STRING], 'J', [last]); }, { static: true });
  def(CU, 'removeId', `(${URI})${URI}`, (r, _m, [uri]) => {
    const last = uriLast(r, uri); if (last === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'No path segments to remove');
    const segments = callV(r, uri, URI, 'getPathSegments', [], 'Ljava/util/List;'), count = callV(r, segments, 'Ljava/util/List;', 'size', [], 'I'), b = callV(r, uri, URI, 'buildUpon', [], URI_BUILDER);
    callV(r, b, URI_BUILDER, 'path', [STRING], URI_BUILDER, [null]); for (let i = 0; i < count - 1; i++) callV(r, b, URI_BUILDER, 'appendPath', [STRING], URI_BUILDER, [callV(r, segments, 'Ljava/util/List;', 'get', ['I'], OBJECT, [i])]);
    return callV(r, b, URI_BUILDER, 'build', [], URI);
  }, { static: true });

  // ---- android.util.Xml: newPullParser / newSerializer over libcore's KXmlParser / KXmlSerializer (original sources), findEncodingByName, the SAX parse entry points are not modelled -----------------------------------------
  const XML = 'Landroid/util/Xml;', KPARSER = 'Lcom/android/org/kxml2/io/KXmlParser;', KSER = 'Lcom/android/org/kxml2/io/KXmlSerializer;', ENC = 'Landroid/util/Xml$Encoding;', PULL = 'Lorg/xmlpull/v1/XmlPullParser;', SER = 'Lorg/xmlpull/v1/XmlSerializer;';
  type(XML, OBJECT, [], { allocatable: false }); type(ENC, 'Ljava/lang/Enum;', [], { allocatable: true });
  staticField(XML, 'FEATURE_RELAXED', STRING, () => 'http://xmlpull.org/v1/doc/features.html#relaxed');
  const ENCODINGS = [['US_ASCII', 'US-ASCII'], ['UTF_8', 'UTF-8'], ['UTF_16', 'UTF-16'], ['ISO_8859_1', 'ISO-8859-1']];
  ENCODINGS.forEach(([name, expat], i) => staticField(ENC, name, ENC, r => { const v = r.allocate(ENC), o = r.object(v); o.enumName = name; o.enumOrdinal = i; o.expatName = expat; return v; }));
  def(XML, 'newPullParser', `()${PULL}`, r => { if (!r.classes.has(KPARSER)) unsupported('Xml.newPullParser: KXmlParser is not in this framework build', 'xml-parser-missing'); const p = construct(r, KPARSER, [], []); callV(r, p, KPARSER, 'setFeature', [STRING, 'Z'], 'V', ['http://xmlpull.org/v1/doc/features.html#process-docdecl', 1]); callV(r, p, KPARSER, 'setFeature', [STRING, 'Z'], 'V', ['http://xmlpull.org/v1/doc/features.html#relaxed', 1]); return p; }, { static: true });
  def(XML, 'newSerializer', `()${SER}`, r => { if (!r.classes.has(KSER)) unsupported('Xml.newSerializer: KXmlSerializer is not in this framework build', 'xml-serializer-missing'); return construct(r, KSER, [], []); }, { static: true });
  def(XML, 'findEncodingByName', `(${STRING})${ENC}`, (r, _m, [name]) => { if (nullish(name)) npe(r); const n = text(r, name).toUpperCase(), at = ENCODINGS.findIndex(([, expat]) => expat.toUpperCase() === n); if (at < 0) r.throwJava('Ljava/io/UnsupportedEncodingException;', text(r, name)); return r.readStatic({ owner: ENC, name: ENCODINGS[at][0], type: ENC, key: `${ENC}->${ENCODINGS[at][0]}:${ENC}` }); }, { static: true });
  def(ENC, 'toString', `()${STRING}`, (r, _m, [self]) => r.object(self).expatName);
  def(XML, 'asAttributeSet', `(${PULL})Landroid/util/AttributeSet;`, (r, _m, [parser]) => { if (nullish(parser)) npe(r); if (r.isSubtype(r.object(parser).type, 'Landroid/util/AttributeSet;')) return parser; unsupported('Xml.asAttributeSet over a plain XmlPullParser: XmlPullAttributes is not modelled (XML resource parsers are AttributeSets already)', 'xml-attributes-unsupported'); }, { static: true });
  for (const sig of [`(Ljava/io/InputStream;${ENC}Lorg/xml/sax/ContentHandler;)V`, `(Ljava/io/Reader;Lorg/xml/sax/ContentHandler;)V`, `(${STRING}Lorg/xml/sax/ContentHandler;)V`]) def(XML, 'parse', sig, () => unsupported('Xml.parse (SAX): the lab has no SAX parser; use Xml.newPullParser()', 'sax-unsupported'), { static: true });
  // ---- com.android.internal.util.XmlUtils.convertValueToInt / convertValueToBoolean (android-13.0.0_r1; android.text.Html reads colour attributes through the first). The class itself needs TypedXml* and
  // Bitmap.CompressFormat and is not packaged; these two keep the original bodies, with Integer.parseInt run by the real Java class so number errors are the framework's.
  const XMLUTILS = 'Lcom/android/internal/util/XmlUtils;', CHARS = 'Ljava/lang/CharSequence;';
  type(XMLUTILS, OBJECT, [], { allocatable: false });
  const emptyChars = (r, v) => nullish(v) || r.stringCharacters(v).length === 0;
  def(XMLUTILS, 'convertValueToBoolean', `(${CHARS}Z)Z`, (r, _m, [value, fallback]) => emptyChars(r, value) ? fallback : (typeof value === 'string' || r.typeOf(value) === STRING) && ['1', 'true', 'TRUE'].includes(r.stringCharacters(value)) ? 1 : 0, { static: true });
  def(XMLUTILS, 'convertValueToInt', `(${CHARS}I)I`, (r, _m, [charSeq, fallback]) => {
    if (emptyChars(r, charSeq)) return fallback;
    const nm = r.stringCharacters(charSeq); let sign = 1, index = 0, base = 10;
    if (nm[0] === '-') { sign = -1; index++; }
    if (nm[index] === '0') { if (index === nm.length - 1) return 0; const c = nm[index + 1]; if (c === 'x' || c === 'X') { index += 2; base = 16; } else { index++; base = 8; } }
    else if (nm[index] === '#') { index++; base = 16; }
    const parsed = r.dispatch({ owner: 'Ljava/lang/Integer;', name: 'parseInt', parameters: [STRING, 'I'], result: 'I', signature: `(${STRING}I)I` }, r.argumentWords([STRING, 'I'], [nm.slice(index), base]), 'static');
    return Math.imul(parsed, sign);
  }, { static: true });

  // ---- android.security.NetworkSecurityPolicy: the same decision the lab's HTTP stack takes (network_security_config, usesCleartextTraffic, target SDK) -------------------------------------------
  const NSP = 'Landroid/security/NetworkSecurityPolicy;';
  type(NSP, OBJECT, [], { allocatable: false });
  def(NSP, 'getInstance', `()${NSP}`, r => r.makeObject(NSP), { static: true });
  def(NSP, 'isCleartextTrafficPermitted', '()Z', r => cleartextPermitted(r) ? 1 : 0);
  def(NSP, 'isCleartextTrafficPermitted', `(${STRING})Z`, (r, _m, [, host]) => { if (nullish(host)) npe(r, 'hostname'); return cleartextPermitted(r, text(r, host)) ? 1 : 0; });
  def(NSP, 'isCertificateTransparencyVerificationRequired', `(${STRING})Z`, () => 0);   // certificate transparency is not enforced on Android 13 unless the network security config asks for it (not parsed)
  return registry;
}
