import { mixerOf } from './audio-native.js?v=8411deb8def1';
import { bitsFloat } from './host-contract.js?v=8411deb8def1';

// android.media.SoundPool (android-13.0.0_r1 SoundPool.java over the native SoundPool service), for the lab's AudioTrack mixer (src/audio-native.js).
//   * load(...) reads the sample (a raw resource, an asset descriptor, a file path or a file descriptor range) and decodes it; the result is reported later through
//     OnLoadCompleteListener on the Looper of the thread that created the pool (the main Looper when it has none), with status 0, as the native loader does;
//   * the lab decodes WAV (RIFF PCM 8/16/24/32-bit and IEEE float). A sample in a format the lab has no decoder for (Ogg Vorbis, MP3, AAC ...) loads with a non-zero
//     status, as Android reports a sample it cannot decode, and the trace says which format was refused: nothing is pretended to play;
//   * play() starts a static track of the mixer with the sample (loops, volume and rate applied) and returns a stream id; at most maxStreams play at once, the lowest
//     priority (then the oldest) stream stops to make room; pause / resume / stop / setVolume / setLoop / setRate / setPriority act on that track; unload and release free them.
const POOL = 'Landroid/media/SoundPool;', BUILDER = 'Landroid/media/SoundPool$Builder;', LISTENER = 'Landroid/media/SoundPool$OnLoadCompleteListener;';
const CONTEXT = 'Landroid/content/Context;', STRING = 'Ljava/lang/String;', AFD = 'Landroid/content/res/AssetFileDescriptor;', FD = 'Ljava/io/FileDescriptor;', ATTRS = 'Landroid/media/AudioAttributes;';
const DELIVERY = 'Lapkweb/bridge/SoundPoolDelivery;', RUNNABLE = 'Ljava/lang/Runnable;', HANDLER = 'Landroid/os/Handler;', LOOPER = 'Landroid/os/Looper;', INPUT = 'Ljava/io/InputStream;';
const ENCODING_FLOAT = 4, MODE_STATIC = 0, LOAD_FAILED = 1;

/** The interleaved float32 PCM of a WAV file, or a reason it is not one the lab decodes. */
export function decodeWav(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), tag = at => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12) return { error: 'too short to be an audio file' };
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return { error: `${formatOf(bytes)} (the lab decodes WAV only)` };
  let fmt = null, data = null;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = tag(at), size = dv.getUint32(at + 4, true), body = at + 8;
    if (id === 'fmt ') fmt = { format: dv.getUint16(body, true), channels: dv.getUint16(body + 2, true), rate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true), ext: size >= 26 ? dv.getUint16(body + 24, true) : 0 };
    else if (id === 'data') data = bytes.subarray(body, Math.min(bytes.length, body + size));
    at = body + size + (size & 1);
  }
  if (!fmt || !data) return { error: 'a WAV file without fmt or data chunk' };
  const format = fmt.format === 0xfffe ? fmt.ext : fmt.format;   // WAVE_FORMAT_EXTENSIBLE: the sub-format's first word
  if (format !== 1 && format !== 3) return { error: `a WAV file with format tag ${format} (the lab decodes PCM and IEEE float)` };
  if (fmt.channels < 1 || fmt.channels > 2 || fmt.rate < 1) return { error: `a WAV file with ${fmt.channels} channels at ${fmt.rate} Hz` };
  const width = fmt.bits / 8, frames = Math.floor(data.length / (width * fmt.channels)), out = new Float32Array(frames * fmt.channels), dd = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < out.length; i++) {
    const o = i * width;
    out[i] = format === 3 ? (width === 8 ? dd.getFloat64(o, true) : dd.getFloat32(o, true))
      : width === 1 ? (dd.getUint8(o) - 128) / 128 : width === 2 ? dd.getInt16(o, true) / 32768 : width === 3 ? ((dd.getUint8(o) | (dd.getUint8(o + 1) << 8) | (dd.getInt8(o + 2) << 16)) / 8388608) : dd.getInt32(o, true) / 2147483648;
  }
  return { pcm: out, channels: fmt.channels, rate: fmt.rate, frames };
}
const formatOf = bytes => {
  const head = String.fromCharCode(...bytes.subarray(0, 4));
  if (head === 'OggS') return 'an Ogg file'; if (head.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'an MP3 file';
  if (String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp') return 'an MP4/AAC file'; if (head === 'fLaC') return 'a FLAC file';
  return 'an unrecognized audio format';
};

export function installSoundPool({ platform, registry, nullish, iae, construct, call }) {
  const { def, type } = registry;
  type(POOL, 'Ljava/lang/Object;', [], { allocatable: true }); type(BUILDER, 'Ljava/lang/Object;', [], { allocatable: true }); type(DELIVERY, 'Ljava/lang/Object;', [RUNNABLE], { allocatable: true });
  def(DELIVERY, 'run', '()V', (r, _m, [self]) => { const record = r.object(self), task = record.task; record.task = null; record.held = null; return task?.(); });
  const post = (r, handler, task, held = []) => { const runnable = r.makeObject(DELIVERY), record = r.object(runnable); record.task = task; record.held = held.filter(v => !nullish(v)); call(r, handler, HANDLER, 'post', [RUNNABLE], 'Z', [runnable]); };
  const looperHandler = r => { const statics = name => r.dispatch({ owner: LOOPER, name, parameters: [], result: LOOPER, signature: `()${LOOPER}` }, [], 'static'); const looper = statics('myLooper'); return construct(r, HANDLER, [LOOPER], [nullish(looper) ? statics('getMainLooper') : looper]); };
  // ---- Builder and constructor
  def(BUILDER, '<init>', '()V', (r, _m, [self]) => { r.object(self).poolBuilder = { maxStreams: 1, attributes: null }; });
  def(BUILDER, 'setMaxStreams', `(I)${BUILDER}`, (r, _m, [self, n]) => { if (n <= 0) iae(r, 'Strictly positive value required for the maximum number of streams'); r.object(self).poolBuilder.maxStreams = n; return self; });
  def(BUILDER, 'setAudioAttributes', `(${ATTRS})${BUILDER}`, (r, _m, [self, attributes]) => { if (nullish(attributes)) iae(r, 'Invalid null AudioAttributes'); r.object(self).poolBuilder.attributes = attributes; return self; });
  def(BUILDER, 'build', `()${POOL}`, (r, _m, [self]) => { const pool = r.allocate(POOL); open(r, pool, r.object(self).poolBuilder.maxStreams); return pool; });
  def(POOL, '<init>', '(III)V', (r, _m, [self, maxStreams]) => { if (maxStreams <= 0) iae(r, 'Strictly positive value required for the maximum number of streams'); open(r, self, maxStreams); });   // deprecated (maxStreams, streamType, srcQuality)
  const open = (r, self, maxStreams) => { r.object(self).soundPool = { maxStreams, handler: looperHandler(r), listener: null, samples: new Map(), streams: new Map(), nextSample: 1, nextStream: 1, released: false }; };
  const pool = (r, self) => r.object(self).soundPool;
  def(POOL, 'setOnLoadCompleteListener', `(${LISTENER})V`, (r, _m, [self, listener]) => { pool(r, self).listener = nullish(listener) ? null : listener; });
  // ---- loading: the bytes now, the decode result through the listener after this call returns
  const readStream = (r, stream) => {   // every byte of a java.io.InputStream (read(byte[], int, int) until -1)
    const chunk = r.newArray('[B', 65536), parts = []; let total = 0;
    for (;;) { const n = call(r, stream, INPUT, 'read', ['[B', 'I', 'I'], 'I', [chunk, 0, 65536]); if (n < 0) break; parts.push(Uint8Array.from(r.array(chunk).elements.slice(0, n), v => v & 255)); total += n; }
    call(r, stream, INPUT, 'close', [], 'V', []);
    const out = new Uint8Array(total); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out;
  };
  const load = (r, self, bytes, what) => {
    const p = pool(r, self), id = p.nextSample++, decoded = decodeWav(bytes);
    if (decoded.error) r.record(`AUDIO SoundPool sample ${id} (${what}): ${decoded.error}: not loaded (status ${LOAD_FAILED})`);
    else { p.samples.set(id, decoded); r.record(`AUDIO SoundPool sample ${id} (${what}): ${decoded.frames} frames, ${decoded.channels} ch, ${decoded.rate} Hz`); }
    const listener = p.listener;
    if (listener) post(r, p.handler, () => call(r, listener, LISTENER, 'onLoadComplete', [POOL, 'I', 'I'], 'V', [self, id, decoded.error ? LOAD_FAILED : 0]), [listener, self]);
    return id;
  };
  def(POOL, 'load', `(${CONTEXT}II)I`, (r, _m, [self, context, resId]) => { const resources = call(r, context, CONTEXT, 'getResources', [], 'Landroid/content/res/Resources;', []); return load(r, self, readStream(r, call(r, resources, 'Landroid/content/res/Resources;', 'openRawResource', ['I'], INPUT, [resId])), `resource 0x${(resId >>> 0).toString(16)}`); });
  def(POOL, 'load', `(${STRING}I)I`, (r, _m, [self, path]) => { const text = r.stringCharacters(path), bytes = platform.javaIo.fs().bytes(text); if (!bytes) { r.record(`AUDIO SoundPool load(${text}): no such file`); return 0; } return load(r, self, bytes, text); });
  def(POOL, 'load', `(${AFD}I)I`, (r, _m, [self, afd]) => load(r, self, readStream(r, call(r, afd, AFD, 'createInputStream', [], 'Ljava/io/FileInputStream;', [])), 'an asset descriptor'));
  def(POOL, 'load', `(${FD}JJI)I`, (r, _m, [self, fd, offset, length]) => {
    const stream = construct(r, 'Ljava/io/FileInputStream;', [FD], [fd]); call(r, stream, INPUT, 'skip', ['J'], 'J', [BigInt(offset)]);
    const all = readStream(r, stream); return load(r, self, all.subarray(0, Number(length)), 'a file descriptor range');
  });
  def(POOL, 'unload', '(I)Z', (r, _m, [self, id]) => { const p = pool(r, self); for (const [sid, s] of p.streams) if (s.sample === id) stopStream(r, p, sid); return p.samples.delete(id) ? 1 : 0; });
  // ---- streams over mixer tracks
  const stopStream = (r, p, sid) => { const s = p.streams.get(sid); if (!s) return; const mixer = mixerOf(r); mixer.stop(s.track); mixer.release(s.track.id); p.streams.delete(sid); };
  def(POOL, 'play', '(IFFIIF)I', (r, _m, [self, id, left, right, priority, loop, rate]) => {
    const p = pool(r, self), sample = p.samples.get(id); if (!sample || p.released) return 0;
    if (p.streams.size >= p.maxStreams) { const victim = [...p.streams].sort(([, a], [, b]) => a.priority - b.priority || a.started - b.started)[0]; if (victim[1].priority > priority) return 0; stopStream(r, p, victim[0]); }
    const mixer = mixerOf(r), track = mixer.create({ rate: sample.rate, channels: sample.channels, encoding: ENCODING_FLOAT, bufferFrames: sample.frames, mode: MODE_STATIC, usage: 1, contentType: 4, weak: null });
    mixer.enqueue(track, sample.pcm); track.loopStart = 0; track.loopEnd = sample.frames; track.loopCount = loop;
    mixer.setVolume(track, bitsFloat(left), bitsFloat(right)); mixer.setPlaybackRate(track, Math.max(0.5, Math.min(2, bitsFloat(rate))) * sample.rate); mixer.start(track);
    const sid = p.nextStream++; p.streams.set(sid, { track, sample: id, priority, started: sid }); return sid;
  });
  const onStream = (name, signature, fn) => def(POOL, name, signature, (r, _m, [self, sid, ...rest]) => { const p = pool(r, self), s = p.streams.get(sid); if (s) fn(r, p, s, sid, ...rest); });
  onStream('pause', '(I)V', (r, p, s) => mixerOf(r).pause(s.track)); onStream('resume', '(I)V', (r, p, s) => mixerOf(r).start(s.track)); onStream('stop', '(I)V', (r, p, s, sid) => stopStream(r, p, sid));
  onStream('setVolume', '(IFF)V', (r, p, s, sid, left, right) => mixerOf(r).setVolume(s.track, bitsFloat(left), bitsFloat(right)));
  onStream('setLoop', '(II)V', (r, p, s, sid, loop) => { s.track.loopCount = loop; }); onStream('setPriority', '(II)V', (r, p, s, sid, priority) => { s.priority = priority; });
  onStream('setRate', '(IF)V', (r, p, s, sid, rate) => mixerOf(r).setPlaybackRate(s.track, Math.max(0.5, Math.min(2, bitsFloat(rate))) * p.samples.get(s.sample).rate));
  def(POOL, 'autoPause', '()V', (r, _m, [self]) => { for (const s of pool(r, self).streams.values()) mixerOf(r).pause(s.track); });
  def(POOL, 'autoResume', '()V', (r, _m, [self]) => { for (const s of pool(r, self).streams.values()) mixerOf(r).start(s.track); });
  def(POOL, 'release', '()V', (r, _m, [self]) => { const p = pool(r, self); if (p.released) return; for (const sid of [...p.streams.keys()]) stopStream(r, p, sid); p.samples.clear(); p.released = true; });
}
