import { APKError } from './apk-error.js?v=e0da55c6005f';
import { Blocked } from './scheduler.js?v=e0da55c6005f';
import { bitsDouble, doubleBits } from './host-contract.js?v=e0da55c6005f';
import { ByteCells } from './java-arrays.js?v=e0da55c6005f';
import { state as ioState } from './libcore-io-native.js?v=e0da55c6005f';
import { FORMAT, supportsSize } from './camera-frames.js?v=e0da55c6005f';
import { splitAnnexB, joinAnnexB, nalType, NAL, createMp4Writer } from './media-mp4.js?v=e0da55c6005f';
import { AVC_PROFILE } from './media-codec-backend.js?v=e0da55c6005f';

// android.media for recording video (android-13.0.0_r1: MediaFormat.java, MediaCodecList.java, MediaCodecInfo.java, MediaCodec.java, MediaMuxer.java, MediaRecorder.java,
// CamcorderProfile.java, EncoderProfiles.java, AudioRecord.java), over the codec backend of the host (src/media-codec-backend.js: the browser's WebCodecs) and the MP4 writer of
// src/media-mp4.js. The classes are the general Android ones; what they can do is what the device has:
//
//   one video encoder      H.264 / AVC, fed through an input Surface (MediaCodec.createInputSurface / createPersistentInputSurface, MediaRecorder.getSurface). The only producer of
//                          such a Surface is the lab's camera (a Camera2 session output: src/camera-host.js). MediaCodecList / MediaCodecInfo describe exactly this encoder, with the
//                          profiles the browser said it supports; CamcorderProfile / EncoderProfiles describe what it records from the camera's stream sizes.
//   one container          MediaMuxer / MediaRecorder write MPEG-4 with one H.264 track: media data as the samples arrive, the movie header at stop.
//   no audio               there is no audio encoder and no audio input: an AudioRecord never initialises (getMinBufferSize answers ERROR, getState STATE_UNINITIALIZED), MediaRecorder
//                          refuses an audio source, the camcorder profiles carry no audio profile, MediaMuxer refuses an audio track.
//   no decoder             MediaCodec.createDecoderByType finds none (MediaMetadataRetriever decodes a frame through the backend directly, src/misc-platform-host.js).
//
// Without a codec backend (a host without WebCodecs, or one whose encoder supports no AVC configuration) the device has no encoder at all: MediaCodecList is empty, MediaCodec.create*
// fails as on a device without that codec, CamcorderProfile.hasProfile is false. Nothing is ever written that the encoder did not produce; a recording without a frame fails at stop.
//
// Not provided (the VM's explicit unsupported-API error, or the framework's own exception where one exists): ByteBuffer / Image input (the encoder's only colour format is
// COLOR_FormatSurface), WebM / 3GPP / Ogg / HEIF output, MediaMuxer.setLocation, MediaRecorder capture rate, the deprecated android.hardware.Camera as a MediaRecorder source.
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', LOOPER = 'Landroid/os/Looper;', HANDLER = 'Landroid/os/Handler;', BYTE_BUFFER = 'Ljava/nio/ByteBuffer;', BUFFER = 'Ljava/nio/Buffer;', BUNDLE = 'Landroid/os/Bundle;';
const RANGE = 'Landroid/util/Range;', COMPARABLE = 'Ljava/lang/Comparable;', SURFACE = 'Landroid/view/Surface;', FD = 'Ljava/io/FileDescriptor;', FILE = 'Ljava/io/File;', RAF = 'Ljava/io/RandomAccessFile;', LIST = 'Ljava/util/List;', SET = 'Ljava/util/Set;';
const M = 'Landroid/media/';
const MEDIA_FORMAT = `${M}MediaFormat;`, CODEC_LIST = `${M}MediaCodecList;`, CODEC_INFO = `${M}MediaCodecInfo;`, CAPS = `${M}MediaCodecInfo$CodecCapabilities;`, VIDEO_CAPS = `${M}MediaCodecInfo$VideoCapabilities;`, ENCODER_CAPS = `${M}MediaCodecInfo$EncoderCapabilities;`, PROFILE_LEVEL = `${M}MediaCodecInfo$CodecProfileLevel;`;
const CODEC = `${M}MediaCodec;`, BUFFER_INFO = `${M}MediaCodec$BufferInfo;`, CODEC_CALLBACK = `${M}MediaCodec$Callback;`, CODEC_EXCEPTION = `${M}MediaCodec$CodecException;`, CRYPTO = `${M}MediaCrypto;`;
const MUXER = `${M}MediaMuxer;`, RECORDER = `${M}MediaRecorder;`, INFO_LISTENER = `${M}MediaRecorder$OnInfoListener;`, ERROR_LISTENER = `${M}MediaRecorder$OnErrorListener;`;
const CAMCORDER = `${M}CamcorderProfile;`, ENCODER_PROFILES = `${M}EncoderProfiles;`, VIDEO_PROFILE = `${M}EncoderProfiles$VideoProfile;`, AUDIO_PROFILE = `${M}EncoderProfiles$AudioProfile;`;
const AUDIO_RECORD = `${M}AudioRecord;`, AUDIO_RECORD_BUILDER = `${M}AudioRecord$Builder;`, AUDIO_FORMAT = `${M}AudioFormat;`;
const AVC = 'video/avc', COLOR_FORMAT_SURFACE = 0x7f000789;
const FLAG_KEY_FRAME = 1, FLAG_CODEC_CONFIG = 2, FLAG_END_OF_STREAM = 4, INFO_TRY_AGAIN_LATER = -1, INFO_OUTPUT_FORMAT_CHANGED = -2;
const nullish = value => value === null || value === undefined || value === 0;

/** The camcorder qualities the device can have (CamcorderProfile.QUALITY_*): the stream sizes of the lab's cameras that have a quality constant. LOW and HIGH are the smallest and the largest. */
export const CAMCORDER_QUALITIES = Object.freeze({
  0: Object.freeze({ width: 176, height: 144, bitrate: 256000 }),      // QUALITY_LOW
  1: Object.freeze({ width: 1280, height: 720, bitrate: 8000000 }),    // QUALITY_HIGH
  2: Object.freeze({ width: 176, height: 144, bitrate: 256000 }),      // QUALITY_QCIF
  3: Object.freeze({ width: 352, height: 288, bitrate: 1200000 }),     // QUALITY_CIF
  4: Object.freeze({ width: 640, height: 480, bitrate: 3000000 }),     // QUALITY_480P (the camera's 4:3 size, as on devices whose sensor has no 720x480 mode)
  5: Object.freeze({ width: 1280, height: 720, bitrate: 8000000 }),    // QUALITY_720P
  7: Object.freeze({ width: 320, height: 240, bitrate: 768000 }),      // QUALITY_QVGA
  9: Object.freeze({ width: 640, height: 480, bitrate: 3000000 }),     // QUALITY_VGA
});
const CAMCORDER_FRAME_RATE = 30, CAMCORDER_DURATION = 60, FILE_FORMAT_MPEG_4 = 2, VIDEO_ENCODER_H264 = 2;
const knownQuality = quality => (quality >= 0 && quality <= 13) || (quality >= 1000 && quality <= 1013) || (quality >= 2000 && quality <= 2005);

export function installMediaCodecs({ platform, registry, post, call, callStatic, construct, cameras }) {
  const { def, type } = registry;
  const S = { backend: null, live: new Set() };
  const text = (r, value) => (nullish(value) ? null : typeof value === 'string' ? value : r.stringCharacters(value));
  const npe = (r, message = null) => r.throwJava('Ljava/lang/NullPointerException;', message), iae = (r, message) => r.throwJava('Ljava/lang/IllegalArgumentException;', message), ise = (r, message) => r.throwJava('Ljava/lang/IllegalStateException;', message);
  const unsupported = (message, method) => { throw new APKError(message, { kind: 'media-unsupported', method }); };
  const encoders = () => S.backend?.videoEncoders ?? [];
  const boxInt = (r, value) => r.boxPrimitive('I', value), rangeOf = (r, low, high) => construct(r, RANGE, [COMPARABLE, COMPARABLE], [boxInt(r, low), boxInt(r, high)]);
  const field = (r, ref, owner, name, kind, value) => r.storeField(r.object(ref).fields, `${owner}->${name}:${kind}`, value);
  const read = (r, ref, owner, name, kind) => r.object(ref).fields.get(`${owner}->${name}:${kind}`) ?? (kind === 'J' ? 0n : 0);
  const byteBuffer = (r, bytes) => callStatic(r, BYTE_BUFFER, 'wrap', ['[B'], BYTE_BUFFER, [r.newArray('[B', bytes.length, new ByteCells(bytes.buffer, bytes.byteOffset, bytes.length))]);
  /** `size` bytes of a ByteBuffer from absolute `offset`, whatever its position (MediaMuxer reads the sample that way). */
  const bufferBytes = (r, buffer, offset, size) => {
    const view = call(r, buffer, BYTE_BUFFER, 'duplicate', [], BYTE_BUFFER); call(r, view, BUFFER, 'clear', [], BUFFER); call(r, view, BUFFER, 'position', ['I'], BUFFER, [offset]);
    const array = r.newArray('[B', size); call(r, view, BYTE_BUFFER, 'get', ['[B', 'I', 'I'], BYTE_BUFFER, [array, 0, size]); return r.bytesOf(array, 0, size).slice();
  };
  /** Work that arrives from the host's event loop (an encoder output, a finished flush): run as a VM task, and wake the pump. */
  const fromHost = (task, roots) => { platform.queueTask(() => { const r = platform.vmRuntime; if (r) task(r); }, 0, roots.filter(value => !nullish(value))); platform.onExternalActivity?.(); };
  /** Where a class without a Handler of its own calls back: the Looper of the thread that made the object, else the main Looper (MediaCodec's and MediaRecorder's EventHandler). */
  const ownTarget = r => { const looper = callStatic(r, LOOPER, 'myLooper', [], LOOPER); return { handler: construct(r, HANDLER, [LOOPER], [nullish(looper) ? callStatic(r, LOOPER, 'getMainLooper', [], LOOPER) : looper]) }; };

  // ---- MediaFormat is the original class of framework.dex: read and built here through its own methods -------------------------------------------------------------------------
  const I = v => ({ t: 'I', v: v | 0 }), Str = v => ({ t: 'S', v }), Bytes = v => ({ t: 'B', v });
  /** A new MediaFormat with the given [key, value] pairs. */
  const makeFormat = (r, values) => {
    const ref = construct(r, MEDIA_FORMAT);
    for (const [name, entry] of values) {
      if (entry.t === 'I') call(r, ref, MEDIA_FORMAT, 'setInteger', [STRING, 'I'], 'V', [name, entry.v]);
      else if (entry.t === 'S') call(r, ref, MEDIA_FORMAT, 'setString', [STRING, STRING], 'V', [name, entry.v]);
      else call(r, ref, MEDIA_FORMAT, 'setByteBuffer', [STRING, BYTE_BUFFER], 'V', [name, entry.v]);
    }
    return ref;
  };
  const copyFormat = (r, format) => construct(r, MEDIA_FORMAT, [MEDIA_FORMAT], [format]);
  const has = (r, format, name) => !!call(r, format, MEDIA_FORMAT, 'containsKey', [STRING], 'Z', [name]);
  /** A numeric entry (Integer, Long or Float) as a JavaScript number, a String entry as text; undefined when the key is absent. A value of another type is the format's own ClassCastException. */
  const formatNumber = (r, format, name) => { if (!has(r, format, name)) return undefined; const value = call(r, format, MEDIA_FORMAT, 'getNumber', [STRING], 'Ljava/lang/Number;', [name]); return nullish(value) ? undefined : bitsDouble(call(r, value, 'Ljava/lang/Number;', 'doubleValue', [], 'D')); };
  const formatString = (r, format, name) => (has(r, format, name) ? text(r, call(r, format, MEDIA_FORMAT, 'getString', [STRING], STRING, [name])) ?? undefined : undefined);
  const formatBuffer = (r, format, name) => { if (!has(r, format, name)) return null; const buffer = call(r, format, MEDIA_FORMAT, 'getByteBuffer', [STRING], BYTE_BUFFER, [name]); return nullish(buffer) ? null : bufferBytes(r, buffer, 0, call(r, buffer, BUFFER, 'capacity', [], 'I')); };
  /** What an encoder looks at in a format. */
  const videoFormat = (r, format) => {
    const features = call(r, call(r, format, MEDIA_FORMAT, 'getFeatures', [], SET), SET, 'toArray', [], `[${OBJECT}`), required = r.array(features).elements.map(name => text(r, name)).filter(name => !!call(r, format, MEDIA_FORMAT, 'getFeatureEnabled', [STRING], 'Z', [name]));
    const out = { mime: formatString(r, format, 'mime'), required };
    for (const [key, name] of [['width', 'width'], ['height', 'height'], ['bitrate', 'bitrate'], ['frameRate', 'frame-rate'], ['color', 'color-format'], ['profile', 'profile'], ['interval', 'i-frame-interval'], ['bitrateMode', 'bitrate-mode']]) out[key] = formatNumber(r, format, name);
    return out;
  };

  // ---- MediaCodecList / MediaCodecInfo: the one encoder -------------------------------------------------------------------------------------------------------------------------
  type(CODEC_LIST, OBJECT, [], { allocatable: true }); type(CODEC_INFO, OBJECT); type(CAPS, OBJECT, [], { allocatable: true }); type(VIDEO_CAPS, OBJECT); type(ENCODER_CAPS, OBJECT); type(PROFILE_LEVEL, OBJECT, [], { allocatable: true });
  registry.instanceField(CAPS, 'profileLevels', `[${PROFILE_LEVEL}`, { reflect: true }); registry.instanceField(CAPS, 'colorFormats', '[I', { reflect: true });
  registry.instanceField(PROFILE_LEVEL, 'profile', 'I', { reflect: true }); registry.instanceField(PROFILE_LEVEL, 'level', 'I', { reflect: true });
  def(PROFILE_LEVEL, '<init>', '()V', () => {}); def(CAPS, '<init>', '()V', () => {});
  def(PROFILE_LEVEL, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => (!nullish(other) && r.typeOf(other) === PROFILE_LEVEL && read(r, other, PROFILE_LEVEL, 'profile', 'I') === read(r, self, PROFILE_LEVEL, 'profile', 'I') && read(r, other, PROFILE_LEVEL, 'level', 'I') === read(r, self, PROFILE_LEVEL, 'level', 'I') ? 1 : 0));
  def(PROFILE_LEVEL, 'hashCode', '()I', (r, _m, [self]) => (Math.imul(31, read(r, self, PROFILE_LEVEL, 'profile', 'I')) + read(r, self, PROFILE_LEVEL, 'level', 'I')) | 0);
  const infoRef = (r, encoder) => { const ref = r.makeObject(CODEC_INFO); r.object(ref).codecInfo = encoder; return ref; };
  const infoOf = (r, self) => r.object(self).codecInfo;
  /** Frame sizes the encoder takes: even, at least 16x16, at most its maximum in either orientation, and within the macroblock count of its level (MediaCodecInfo.VideoCapabilities). */
  const blockLimit = encoder => Math.ceil(encoder.maxWidth / 16) * Math.ceil(encoder.maxHeight / 16), longest = encoder => Math.max(encoder.maxWidth, encoder.maxHeight);
  const sizeSupported = (encoder, width, height) => width >= 16 && height >= 16 && width % 2 === 0 && height % 2 === 0 && width <= longest(encoder) && height <= longest(encoder) && Math.ceil(width / 16) * Math.ceil(height / 16) <= blockLimit(encoder);
  /** MediaCodecInfo.CodecCapabilities.isFormatSupported for a video encoder: the MIME type, the profile when one is named, the size, the frame rate and the bitrate. */
  const formatSupported = (encoder, { mime, required, profile, width, height, frameRate, bitrate }) => {
    if (mime !== undefined && mime.toLowerCase() !== encoder.mime) return false;
    if (required.length) return false;   // the encoder has no optional feature
    if (profile !== undefined && !encoder.profiles.includes(profile)) return false;
    if (width !== undefined && height !== undefined && !sizeSupported(encoder, width, height)) return false;
    if (frameRate !== undefined && !(frameRate > 0 && frameRate <= encoder.maxFrameRate)) return false;
    if (bitrate !== undefined && !(bitrate >= encoder.minBitrate && bitrate <= encoder.maxBitrate)) return false;
    return true;
  };
  def(CODEC_LIST, '<init>', '(I)V', (r, _m, [self, kind]) => { r.object(self).codecKind = kind; });
  const infoArray = r => { const list = encoders(), array = r.newArray(`[${CODEC_INFO}`, list.length); r.array(array).elements = list.map(encoder => infoRef(r, encoder)); return array; };
  def(CODEC_LIST, 'getCodecInfos', `()[${CODEC_INFO}`, r => infoArray(r));
  def(CODEC_LIST, 'findEncoderForFormat', `(${MEDIA_FORMAT})${STRING}`, (r, _m, [, format]) => { if (nullish(format)) npe(r); const wanted = videoFormat(r, format); return encoders().find(encoder => formatSupported(encoder, wanted))?.name ?? null; });
  def(CODEC_LIST, 'findDecoderForFormat', `(${MEDIA_FORMAT})${STRING}`, (r, _m, [, format]) => { if (nullish(format)) npe(r); return null; });
  def(CODEC_LIST, 'getCodecCount', '()I', () => encoders().length, { static: true });
  def(CODEC_LIST, 'getCodecInfoAt', `(I)${CODEC_INFO}`, (r, _m, [index]) => { const encoder = encoders()[index]; if (!encoder) iae(r, null); return infoRef(r, encoder); }, { static: true });
  def(CODEC_INFO, 'getName', `()${STRING}`, (r, _m, [self]) => infoOf(r, self).name);
  def(CODEC_INFO, 'getCanonicalName', `()${STRING}`, (r, _m, [self]) => infoOf(r, self).name);
  def(CODEC_INFO, 'isEncoder', '()Z', () => 1); def(CODEC_INFO, 'isAlias', '()Z', () => 0); def(CODEC_INFO, 'isVendor', '()Z', () => 0);
  def(CODEC_INFO, 'isSoftwareOnly', '()Z', () => 1); def(CODEC_INFO, 'isHardwareAccelerated', '()Z', () => 0);   // no codec HAL: whatever the host uses underneath is not a device codec component
  def(CODEC_INFO, 'getSupportedTypes', `()[${STRING}`, (r, _m, [self]) => { const array = r.newArray(`[${STRING}`, 1); r.array(array).elements = [infoOf(r, self).mime]; return array; });
  def(CODEC_INFO, 'getCapabilitiesForType', `(${STRING})${CAPS}`, (r, _m, [self, mime]) => {
    const encoder = infoOf(r, self); if (nullish(mime) || text(r, mime).toLowerCase() !== encoder.mime) iae(r, 'codec does not support type');
    const ref = r.makeObject(CAPS); r.object(ref).codecCaps = encoder;
    const levels = r.newArray(`[${PROFILE_LEVEL}`, encoder.profiles.length); r.array(levels).elements = encoder.profiles.map(profile => { const entry = r.makeObject(PROFILE_LEVEL); field(r, entry, PROFILE_LEVEL, 'profile', 'I', profile); field(r, entry, PROFILE_LEVEL, 'level', 'I', encoder.level); return entry; });
    const colors = r.newArray('[I', 1); r.array(colors).elements = [COLOR_FORMAT_SURFACE];
    field(r, ref, CAPS, 'profileLevels', `[${PROFILE_LEVEL}`, levels); field(r, ref, CAPS, 'colorFormats', '[I', colors); return ref;
  });
  const capsOf = (r, self) => r.object(self).codecCaps;
  def(CAPS, 'getMimeType', `()${STRING}`, (r, _m, [self]) => capsOf(r, self).mime);
  def(CAPS, 'getMaxSupportedInstances', '()I', () => 16);
  def(CAPS, 'isFeatureSupported', `(${STRING})Z`, () => 0); def(CAPS, 'isFeatureRequired', `(${STRING})Z`, () => 0);
  def(CAPS, 'isFormatSupported', `(${MEDIA_FORMAT})Z`, (r, _m, [self, format]) => { if (nullish(format)) npe(r); return formatSupported(capsOf(r, self), videoFormat(r, format)) ? 1 : 0; });
  def(CAPS, 'getDefaultFormat', `()${MEDIA_FORMAT}`, (r, _m, [self]) => makeFormat(r, [['mime', Str(capsOf(r, self).mime)]]));
  def(CAPS, 'getAudioCapabilities', `()${M}MediaCodecInfo$AudioCapabilities;`, () => null);
  const sub = (owner, key) => (r, _m, [self]) => { const ref = r.makeObject(owner); r.object(ref)[key] = capsOf(r, self); return ref; };
  def(CAPS, 'getVideoCapabilities', `()${VIDEO_CAPS}`, sub(VIDEO_CAPS, 'codecCaps')); def(CAPS, 'getEncoderCapabilities', `()${ENCODER_CAPS}`, sub(ENCODER_CAPS, 'codecCaps'));
  const even = value => value - (value % 2);
  def(VIDEO_CAPS, 'getBitrateRange', `()${RANGE}`, (r, _m, [self]) => rangeOf(r, capsOf(r, self).minBitrate, capsOf(r, self).maxBitrate));
  def(VIDEO_CAPS, 'getSupportedWidths', `()${RANGE}`, (r, _m, [self]) => rangeOf(r, 16, longest(capsOf(r, self))));
  def(VIDEO_CAPS, 'getSupportedHeights', `()${RANGE}`, (r, _m, [self]) => rangeOf(r, 16, longest(capsOf(r, self))));
  def(VIDEO_CAPS, 'getWidthAlignment', '()I', () => 2); def(VIDEO_CAPS, 'getHeightAlignment', '()I', () => 2);
  def(VIDEO_CAPS, 'getSupportedFrameRates', `()${RANGE}`, (r, _m, [self]) => rangeOf(r, 1, capsOf(r, self).maxFrameRate));
  const otherSide = (r, self, side, what) => { const encoder = capsOf(r, self); if (side < 16 || side > longest(encoder) || side % 2) iae(r, `unsupported ${what}`); const most = Math.min(longest(encoder), even(Math.floor(blockLimit(encoder) / Math.ceil(side / 16)) * 16)); if (most < 16) iae(r, `unsupported ${what}`); return rangeOf(r, 16, most); };
  def(VIDEO_CAPS, 'getSupportedWidthsFor', `(I)${RANGE}`, (r, _m, [self, height]) => otherSide(r, self, height, 'height'));
  def(VIDEO_CAPS, 'getSupportedHeightsFor', `(I)${RANGE}`, (r, _m, [self, width]) => otherSide(r, self, width, 'width'));
  def(VIDEO_CAPS, 'getSupportedFrameRatesFor', `(II)${RANGE}`, (r, _m, [self, width, height]) => { const encoder = capsOf(r, self); if (!sizeSupported(encoder, width, height)) iae(r, 'unsupported size'); return construct(r, RANGE, [COMPARABLE, COMPARABLE], [r.boxPrimitive('D', doubleBits(1)), r.boxPrimitive('D', doubleBits(encoder.maxFrameRate))]); });
  def(VIDEO_CAPS, 'getAchievableFrameRatesFor', `(II)${RANGE}`, (r, _m, [self, width, height]) => { if (!sizeSupported(capsOf(r, self), width, height)) iae(r, 'unsupported size'); return null; });   // no measured performance data
  def(VIDEO_CAPS, 'getSupportedPerformancePoints', `()${LIST}`, () => null);
  def(VIDEO_CAPS, 'isSizeSupported', '(II)Z', (r, _m, [self, width, height]) => (sizeSupported(capsOf(r, self), width, height) ? 1 : 0));
  def(VIDEO_CAPS, 'areSizeAndRateSupported', '(IID)Z', (r, _m, [self, width, height, rate]) => { const encoder = capsOf(r, self), fps = typeof rate === 'bigint' ? bitsDouble(rate) : rate; return sizeSupported(encoder, width, height) && fps > 0 && fps <= encoder.maxFrameRate ? 1 : 0; });
  def(ENCODER_CAPS, 'getComplexityRange', `()${RANGE}`, r => rangeOf(r, 0, 0)); def(ENCODER_CAPS, 'getQualityRange', `()${RANGE}`, r => rangeOf(r, 0, 0));
  def(ENCODER_CAPS, 'isBitrateModeSupported', '(I)Z', (r, _m, [, mode]) => (mode === 1 || mode === 2 ? 1 : 0));   // BITRATE_MODE_VBR, BITRATE_MODE_CBR; no constant-quality mode

  // ---- the encoder's input Surface ---------------------------------------------------------------------------------------------------------------------------------------------
  /** A Surface whose consumer is an encoder (`owner`: a MediaCodec or MediaRecorder state, bound later for a persistent surface). The camera host feeds it through sink.frame. */
  const encoderSurface = (r, owner, persistent) => {
    const surface = construct(r, SURFACE), state = r.object(surface).surface, sink = { kind: 'encoder', owner, persistent, stream: null, shots: 0, released: false };
    sink.valid = () => !sink.released && !state.released;
    sink.size = () => (sink.owner?.size ? { ...sink.owner.size } : null);
    sink.frame = (rt, entry, timestampNs) => (sink.owner ? sink.owner.input(rt, entry, timestampNs) : false);
    state.sink = sink; state.name = null; return surface;
  };
  const sinkOfSurface = (r, surface) => (nullish(surface) ? null : r.object(surface).surface?.sink ?? null);

  // ---- MediaCodec ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  type(CODEC, OBJECT); type(BUFFER_INFO, OBJECT, [], { allocatable: true }); type(CODEC_CALLBACK, OBJECT, [], { allocatable: true }); type(CODEC_EXCEPTION, 'Ljava/lang/IllegalStateException;', [], { allocatable: true });
  for (const [name, kind] of [['flags', 'I'], ['offset', 'I'], ['size', 'I'], ['presentationTimeUs', 'J']]) registry.instanceField(BUFFER_INFO, name, kind, { reflect: true });
  def(BUFFER_INFO, '<init>', '()V', () => {}); def(CODEC_CALLBACK, '<init>', '()V', () => {});
  const setInfo = (r, info, offset, size, timeUs, flags) => { field(r, info, BUFFER_INFO, 'offset', 'I', offset); field(r, info, BUFFER_INFO, 'size', 'I', size); field(r, info, BUFFER_INFO, 'presentationTimeUs', 'J', BigInt(timeUs)); field(r, info, BUFFER_INFO, 'flags', 'I', flags); };
  def(BUFFER_INFO, 'set', '(IIJI)V', (r, _m, [self, offset, size, timeUs, flags]) => setInfo(r, self, offset, size, timeUs, flags));
  const readInfo = (r, info) => ({ offset: read(r, info, BUFFER_INFO, 'offset', 'I'), size: read(r, info, BUFFER_INFO, 'size', 'I'), timeUs: Number(read(r, info, BUFFER_INFO, 'presentationTimeUs', 'J')), flags: read(r, info, BUFFER_INFO, 'flags', 'I') });
  def(CODEC_EXCEPTION, 'getErrorCode', '()I', (r, _m, [self]) => r.object(self).codecError?.code ?? 0);
  def(CODEC_EXCEPTION, 'isTransient', '()Z', () => 0); def(CODEC_EXCEPTION, 'isRecoverable', '()Z', () => 0);
  def(CODEC_EXCEPTION, 'getDiagnosticInfo', `()${STRING}`, (r, _m, [self]) => r.object(self).codecError?.diagnostic ?? null);
  const codecException = (r, message, code = 0x80001001) => { const ref = r.allocate(CODEC_EXCEPTION), o = r.object(ref); o.message = message; o.codecError = { code: code | 0, diagnostic: `android.media.MediaCodec.error_${code >>> 0}` }; return ref; };   // 0x80001001: OMX_ErrorUndefined, what a failed component reports
  const throwCodec = (r, message) => { const ref = codecException(r, message); r.throwJavaReference(ref, message); };
  const codecOf = (r, self) => { const codec = r.object(self).mediaCodec; if (codec.state === 'released') ise(r, 'codec is released already'); return codec; };

  const newCodec = (r, encoder) => {
    const ref = r.makeObject(CODEC), codec = { ref, encoder, state: 'uninitialized', format: null, size: null, callback: null, target: ownTarget(r), ownTarget: null, surface: null, handle: null, pending: [], outputs: new Map(), nextIndex: 0, outputFormat: null,
      eos: false, flushed: false, suspended: false, forceKey: false, sawConfig: false, lastKeyUs: null, lastUs: 0, frames: 0, dropped: 0, failure: null };
    codec.ownTarget = codec.target;
    /** A camera frame for the encoder (src/camera-host.js). Returns whether the encoder took it. */
    codec.input = (rt, entry, timestampNs) => {
      if (codec.state !== 'executing' || codec.eos || codec.flushed || !codec.handle) return false;
      if (codec.suspended) { codec.dropped++; return true; }   // PARAMETER_KEY_SUSPEND: the encoder consumes and discards its input
      const timestampUs = Math.max(codec.lastUs + 1, Math.floor(Number(timestampNs) / 1000)), key = codec.forceKey || codec.lastKeyUs === null || (codec.keyEveryUs !== Infinity && timestampUs - codec.lastKeyUs >= codec.keyEveryUs);
      if (key) { codec.lastKeyUs = timestampUs; codec.forceKey = false; }
      codec.lastUs = timestampUs; codec.frames++;
      const frame = entry.frame ?? null; if (frame) entry.taken = true;
      try { codec.handle.encode({ frame, data: frame ? null : entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data), width: codec.size.width, height: codec.size.height, timestampUs, key }); }
      catch (error) { fail(rt, codec, codec.handle, `the encoder refused a frame: ${String(error?.message ?? error)}`); }
      return true;
    };
    r.object(ref).mediaCodec = codec; return ref;
  };
  const closeHandle = codec => { const handle = codec.handle; codec.handle = null; S.live.delete(codec); try { handle?.close(); } catch { /* the host encoder is already gone */ } };
  const clearOutput = codec => { codec.pending.length = 0; codec.outputs.clear(); };
  const fail = (r, codec, handle, message) => {
    if (codec.handle !== handle || codec.state === 'released') return;
    closeHandle(codec); codec.state = 'error'; codec.failure = message; r.record(`MEDIA ${codec.encoder.name} failed: ${message}`);
    if (codec.callback) { const error = codecException(r, message), callback = codec.callback; post(r, codec.target, () => call(r, callback, CODEC_CALLBACK, 'onError', [CODEC, CODEC_EXCEPTION], 'V', [codec.ref, error]), [codec.ref, callback, error]); }
  };
  const outputFormatOf = (r, codec, sps, pps) => {
    const values = [['mime', Str(AVC)], ['width', I(codec.size.width)], ['height', I(codec.size.height)], ['bitrate', I(codec.bitrate)], ['frame-rate', I(codec.frameRate)], ['color-format', I(COLOR_FORMAT_SURFACE)]];
    if (sps) { values.push(['csd-0', Bytes(byteBuffer(r, joinAnnexB([sps])))], ['csd-1', Bytes(byteBuffer(r, joinAnnexB([pps])))], ['profile', I(({ 66: sps[2] & 0x40 ? AVC_PROFILE.ConstrainedBaseline : AVC_PROFILE.Baseline, 77: AVC_PROFILE.Main, 100: sps[2] & 0x0c ? AVC_PROFILE.ConstrainedHigh : AVC_PROFILE.High })[sps[1]] ?? AVC_PROFILE.Baseline)]); }
    return makeFormat(r, values);
  };
  /** Async mode: every queued output goes to the callback, in order. Sync mode leaves it for dequeueOutputBuffer. */
  const takeOutput = (r, codec, item, info) => {
    if (item.format) { codec.outputFormat = item.format; return INFO_OUTPUT_FORMAT_CHANGED; }
    const index = codec.nextIndex++, buffer = byteBuffer(r, item.data); codec.outputs.set(index, { buffer });
    setInfo(r, info, 0, item.data.length, item.timeUs, item.flags); return index;
  };
  const pump = (r, codec) => {
    const callback = codec.callback; if (!callback) return;
    while (codec.pending.length) {
      const item = codec.pending.shift();
      if (item.format) { codec.outputFormat = item.format; const format = item.format; post(r, codec.target, () => { if (codec.callback === callback) call(r, callback, CODEC_CALLBACK, 'onOutputFormatChanged', [CODEC, MEDIA_FORMAT], 'V', [codec.ref, format]); }, [codec.ref, callback, format]); continue; }
      const info = construct(r, BUFFER_INFO), index = takeOutput(r, codec, item, info);
      post(r, codec.target, () => { if (codec.callback === callback && codec.outputs.has(index)) call(r, callback, CODEC_CALLBACK, 'onOutputBufferAvailable', [CODEC, 'I', BUFFER_INFO], 'V', [codec.ref, index, info]); }, [codec.ref, callback, info]);
    }
  };
  /** An access unit from the host encoder: the first one announces the output format (csd-0 / csd-1) and the codec-config buffer, as a device encoder does before its first frame. */
  const encoded = (r, codec, handle, chunk) => {
    if (codec.handle !== handle || codec.state !== 'executing') return;
    const nals = splitAnnexB(chunk.data);
    if (!codec.sawConfig) {
      const sps = nals.find(nal => nalType(nal) === NAL.SPS), pps = nals.find(nal => nalType(nal) === NAL.PPS);
      if (!sps || !pps) { fail(r, codec, handle, 'the encoder\'s first output carries no H.264 parameter sets'); return; }
      codec.sawConfig = true; codec.pending.push({ format: outputFormatOf(r, codec, sps, pps) }, { data: joinAnnexB([sps, pps]), timeUs: 0, flags: FLAG_CODEC_CONFIG });
    }
    const picture = nals.filter(nal => { const kind = nalType(nal); return kind !== NAL.SPS && kind !== NAL.PPS && kind !== NAL.AUD; });
    if (picture.length) codec.pending.push({ data: joinAnnexB(picture), timeUs: chunk.timestampUs, flags: chunk.key ? FLAG_KEY_FRAME : 0 });
    pump(r, codec);
  };
  const findEncoder = predicate => encoders().find(predicate) ?? null;
  const noCodec = (r, what) => iae(r, `Failed to initialize ${what}, error 0xfffffffe`);   // NAME_NOT_FOUND: the device has no such codec
  def(CODEC, 'createEncoderByType', `(${STRING})${CODEC}`, (r, _m, [mime]) => { if (nullish(mime)) npe(r); const name = text(r, mime), encoder = findEncoder(entry => entry.mime === name.toLowerCase()); if (!encoder) noCodec(r, name); return newCodec(r, encoder); }, { static: true });
  def(CODEC, 'createDecoderByType', `(${STRING})${CODEC}`, (r, _m, [mime]) => { if (nullish(mime)) npe(r); noCodec(r, text(r, mime)); }, { static: true });
  def(CODEC, 'createByCodecName', `(${STRING})${CODEC}`, (r, _m, [name]) => { if (nullish(name)) npe(r); const wanted = text(r, name), encoder = findEncoder(entry => entry.name === wanted); if (!encoder) noCodec(r, wanted); return newCodec(r, encoder); }, { static: true });
  def(CODEC, 'createPersistentInputSurface', `()${SURFACE}`, r => encoderSurface(r, null, true), { static: true });
  def(CODEC, 'getName', `()${STRING}`, (r, _m, [self]) => codecOf(r, self).encoder.name);
  def(CODEC, 'getCanonicalName', `()${STRING}`, (r, _m, [self]) => codecOf(r, self).encoder.name);
  def(CODEC, 'getCodecInfo', `()${CODEC_INFO}`, (r, _m, [self]) => infoRef(r, codecOf(r, self).encoder));
  def(CODEC, 'setCallback', `(${CODEC_CALLBACK})V`, (r, _m, [self, callback]) => { const codec = codecOf(r, self); codec.callback = nullish(callback) ? null : callback; codec.target = codec.ownTarget; });
  def(CODEC, 'setCallback', `(${CODEC_CALLBACK}${HANDLER})V`, (r, _m, [self, callback, handler]) => { const codec = codecOf(r, self); codec.callback = nullish(callback) ? null : callback; codec.target = nullish(handler) || nullish(callback) ? codec.ownTarget : { handler }; });
  def(CODEC, 'configure', `(${MEDIA_FORMAT}${SURFACE}${CRYPTO}I)V`, (r, _m, [self, format, surface, crypto, flags]) => {
    const codec = codecOf(r, self); if (codec.state !== 'uninitialized') ise(r, `configure() is valid only in the Uninitialized state (the codec is ${codec.state})`);
    if (nullish(format)) iae(r, 'format must not be null'); if (!nullish(crypto)) iae(r, 'an encoder takes no MediaCrypto'); if (!nullish(surface)) iae(r, 'an encoder takes no output Surface');
    if (!(flags & 1)) iae(r, `${codec.encoder.name} is an encoder: configure it with CONFIGURE_FLAG_ENCODE`);
    const wanted = videoFormat(r, format), { mime, width, height, bitrate, color, profile } = wanted, frameRate = wanted.frameRate ?? 30;
    if (String(mime ?? '').toLowerCase() !== codec.encoder.mime) iae(r, `${codec.encoder.name} does not encode ${mime ?? 'a format without a MIME type'}`);
    if (width === undefined || height === undefined || !sizeSupported(codec.encoder, width, height)) iae(r, `${codec.encoder.name} does not support the size ${width}x${height}`);
    if (bitrate === undefined || bitrate < codec.encoder.minBitrate || bitrate > codec.encoder.maxBitrate) iae(r, `${codec.encoder.name} needs a bitrate between ${codec.encoder.minBitrate} and ${codec.encoder.maxBitrate} (KEY_BIT_RATE is ${bitrate ?? 'missing'})`);
    if (!(frameRate > 0 && frameRate <= codec.encoder.maxFrameRate)) iae(r, `${codec.encoder.name} does not support the frame rate ${frameRate}`);
    if (color !== COLOR_FORMAT_SURFACE) iae(r, `${codec.encoder.name} only takes its input from a Surface (KEY_COLOR_FORMAT must be COLOR_FormatSurface, 0x7f000789; it is ${color === undefined ? 'missing' : '0x' + color.toString(16)})`);
    if (profile !== undefined && !codec.encoder.profiles.includes(profile)) iae(r, `${codec.encoder.name} does not support the profile 0x${profile.toString(16)}`);
    const interval = wanted.interval ?? 1;
    codec.format = wanted; codec.size = { width, height }; codec.bitrate = Math.round(bitrate); codec.frameRate = Math.round(frameRate); codec.profile = profile ?? codec.encoder.profiles[0]; codec.constantBitrate = wanted.bitrateMode === 2;
    codec.keyEveryUs = interval < 0 ? Infinity : Math.round(interval * 1e6); codec.outputFormat = null; codec.state = 'configured'; codec.failure = null;
  });
  def(CODEC, 'createInputSurface', `()${SURFACE}`, (r, _m, [self]) => {
    const codec = codecOf(r, self); if (codec.state !== 'configured') ise(r, 'createInputSurface() is valid only between configure() and start()'); if (codec.surface) ise(r, 'the codec already has an input surface');
    codec.surface = encoderSurface(r, codec, false); return codec.surface;
  });
  def(CODEC, 'setInputSurface', `(${SURFACE})V`, (r, _m, [self, surface]) => {
    const codec = codecOf(r, self), sink = sinkOfSurface(r, surface); if (!sink || sink.kind !== 'encoder' || !sink.persistent) iae(r, 'not a PersistentSurface');
    if (codec.state !== 'configured') ise(r, 'setInputSurface() is valid only between configure() and start()');
    sink.owner = codec; codec.surface = surface;
  });
  def(CODEC, 'start', '()V', (r, _m, [self]) => {
    const codec = codecOf(r, self);
    if (codec.state === 'executing' && codec.flushed) { codec.flushed = false; return; }   // async mode: start() resumes after flush()
    if (codec.state !== 'configured') ise(r, `start() is valid only in the Configured state (the codec is ${codec.state})`);
    if (!S.backend) throwCodec(r, 'the host encoder went away');
    let handle;
    try { handle = S.backend.createVideoEncoder({ width: codec.size.width, height: codec.size.height, bitrate: codec.bitrate, frameRate: codec.frameRate, profile: codec.profile, constantBitrate: codec.constantBitrate }, {
      output: chunk => fromHost(rt => encoded(rt, codec, handle, chunk), [codec.ref]), error: message => fromHost(rt => fail(rt, codec, handle, message), [codec.ref]) });
    } catch (error) { throwCodec(r, `start failed: ${String(error?.message ?? error)}`); }
    codec.handle = handle; S.live.add(codec); clearOutput(codec); codec.state = 'executing'; codec.eos = false; codec.flushed = false; codec.suspended = false; codec.forceKey = false; codec.sawConfig = false; codec.lastKeyUs = null; codec.frames = 0; codec.dropped = 0;
    r.record(`MEDIA ${codec.encoder.name} started: ${codec.size.width}x${codec.size.height}, ${codec.bitrate} bit/s, ${codec.frameRate} fps`);
  });
  const executing = (r, codec, what) => { if (codec.state === 'error') throwCodec(r, codec.failure ?? 'the codec failed'); if (codec.state !== 'executing') ise(r, `${what} is valid only in the Executing state (the codec is ${codec.state})`); };
  def(CODEC, 'signalEndOfInputStream', '()V', (r, _m, [self]) => {
    const codec = codecOf(r, self); executing(r, codec, 'signalEndOfInputStream()'); if (!codec.surface) ise(r, 'signalEndOfInputStream() needs an input surface'); if (codec.eos) return;
    codec.eos = true; const handle = codec.handle;
    const done = () => fromHost(rt => { if (codec.handle !== handle || codec.state !== 'executing') return; codec.pending.push({ data: new Uint8Array(0), timeUs: codec.lastUs, flags: FLAG_END_OF_STREAM }); pump(rt, codec); }, [codec.ref]);
    Promise.resolve().then(() => handle.flush()).then(done, error => fromHost(rt => fail(rt, codec, handle, `the encoder failed while finishing: ${String(error?.message ?? error)}`), [codec.ref]));
  });
  const stopCodec = codec => { closeHandle(codec); clearOutput(codec); codec.eos = false; codec.flushed = false; codec.failure = null; codec.state = 'uninitialized'; };
  def(CODEC, 'stop', '()V', (r, _m, [self]) => { const codec = codecOf(r, self); if (codec.state !== 'executing' && codec.state !== 'error') ise(r, `stop() is valid only in the Executing state (the codec is ${codec.state})`); r.record(`MEDIA ${codec.encoder.name} stopped after ${codec.frames} frames`); stopCodec(codec); });
  def(CODEC, 'reset', '()V', (r, _m, [self]) => { const codec = codecOf(r, self); stopCodec(codec); codec.format = null; codec.outputFormat = null; if (codec.surface && !sinkOfSurface(r, codec.surface)?.persistent) { sinkOfSurface(r, codec.surface).released = true; } codec.surface = null; });
  def(CODEC, 'flush', '()V', (r, _m, [self]) => { const codec = codecOf(r, self); executing(r, codec, 'flush()'); clearOutput(codec); codec.eos = false; codec.forceKey = true; if (codec.callback) codec.flushed = true; });
  def(CODEC, 'release', '()V', (r, _m, [self]) => {
    const codec = r.object(self).mediaCodec; if (codec.state === 'released') return;
    stopCodec(codec); codec.state = 'released'; codec.callback = null;
    const sink = codec.surface ? sinkOfSurface(r, codec.surface) : null; if (sink && !sink.persistent) sink.released = true; else if (sink?.owner === codec) sink.owner = null;
  });
  def(CODEC, 'setParameters', `(${BUNDLE})V`, (r, _m, [self, bundle]) => {
    const codec = codecOf(r, self); if (nullish(bundle)) return;
    const has = name => !!call(r, bundle, BUNDLE, 'containsKey', [STRING], 'Z', [name]), int = name => call(r, bundle, BUNDLE, 'getInt', [STRING, 'I'], 'I', [name, 0]);
    if (has('request-sync')) codec.forceKey = true;
    if (has('drop-input-frames')) { const suspended = int('drop-input-frames') !== 0; if (codec.suspended && !suspended) codec.forceKey = true; codec.suspended = suspended; }
    if (has('video-bitrate')) r.record(`MEDIA ${codec.encoder.name}: PARAMETER_KEY_VIDEO_BITRATE ${int('video-bitrate')} is not applied (the bitrate of a started encoder stays ${codec.bitrate})`);
  });
  def(CODEC, 'getInputFormat', `()${MEDIA_FORMAT}`, (r, _m, [self]) => { const codec = codecOf(r, self); if (codec.state !== 'configured' && codec.state !== 'executing') ise(r, 'getInputFormat() needs a configured codec'); return makeFormat(r, [['mime', Str('video/raw')], ['width', I(codec.size.width)], ['height', I(codec.size.height)], ['color-format', I(COLOR_FORMAT_SURFACE)]]); });
  const currentOutputFormat = (r, codec) => { if (codec.state !== 'configured' && codec.state !== 'executing') ise(r, 'getOutputFormat() needs a configured codec'); return codec.outputFormat ? copyFormat(r, codec.outputFormat) : outputFormatOf(r, codec, null, null); };
  def(CODEC, 'getOutputFormat', `()${MEDIA_FORMAT}`, (r, _m, [self]) => currentOutputFormat(r, codecOf(r, self)));
  def(CODEC, 'getOutputFormat', `(I)${MEDIA_FORMAT}`, (r, _m, [self]) => currentOutputFormat(r, codecOf(r, self)));
  def(CODEC, 'getOutputBuffer', `(I)${BYTE_BUFFER}`, (r, _m, [self, index]) => { const codec = codecOf(r, self); executing(r, codec, 'getOutputBuffer()'); return codec.outputs.get(index)?.buffer ?? null; });
  const releaseOutput = (r, self, index) => { const codec = codecOf(r, self); executing(r, codec, 'releaseOutputBuffer()'); if (!codec.outputs.delete(index)) throwCodec(r, `releaseOutputBuffer: the client does not own output buffer ${index}`); };
  def(CODEC, 'releaseOutputBuffer', '(IZ)V', (r, _m, [self, index]) => releaseOutput(r, self, index));
  def(CODEC, 'releaseOutputBuffer', '(IJ)V', (r, _m, [self, index]) => releaseOutput(r, self, index));
  def(CODEC, 'dequeueOutputBuffer', `(${BUFFER_INFO}J)I`, (r, _m, [self, info, timeoutUs]) => {
    const codec = codecOf(r, self); executing(r, codec, 'dequeueOutputBuffer()'); if (codec.callback) ise(r, 'dequeueOutputBuffer() is not available in asynchronous mode'); if (nullish(info)) npe(r);
    const take = () => { if (codec.state === 'error') throwCodec(r, codec.failure ?? 'the codec failed'); const item = codec.state === 'executing' ? codec.pending.shift() : null; return item ? takeOutput(r, codec, item, info) : INFO_TRY_AGAIN_LATER; };
    if (codec.pending.length || timeoutUs === 0n) return take();
    return new Blocked({ reason: 'MediaCodec.dequeueOutputBuffer', ready: () => codec.pending.length > 0 || codec.state !== 'executing', deadline: timeoutUs < 0n ? Infinity : platform.clock.now() + Number(timeoutUs) / 1000, finish: take, roots: [self, info] });
  });
  const surfaceInputOnly = name => def(CODEC, name[0], name[1], (r, _m, [self]) => { codecOf(r, self); ise(r, `${name[0]}() is not available: this encoder takes its input from a Surface`); });
  for (const name of [['dequeueInputBuffer', '(J)I'], ['getInputBuffer', `(I)${BYTE_BUFFER}`], ['queueInputBuffer', '(IIIJI)V'], ['getInputImage', `(I)${M}Image;`]]) surfaceInputOnly(name);

  // ---- MediaMuxer -----------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** The file a writer fills: the inode behind a path (opened read-write and truncated, as MediaMuxer / MediaRecorder open it) or behind a descriptor. The writer keeps the inode, as the native writer keeps its own duplicate of the descriptor. */
  const nodeOfDescriptor = (r, fd) => { const node = ioState(r).table.get(r.object(fd).fields.get(`${FD}->descriptor:I`) | 0)?.desc?.node; return node && node.type === 'file' ? node : null; };
  const openPath = (r, path) => {
    const file = construct(r, RAF, [STRING, STRING], [path, 'rws']);
    try { call(r, file, RAF, 'setLength', ['J'], 'V', [0n]); return nodeOfDescriptor(r, call(r, file, RAF, 'getFD', [], FD)); } finally { call(r, file, RAF, 'close', [], 'V'); }
  };
  const fileSink = node => { const fs = platform.javaIo.fs(); return (bytes, position) => fs.writeAt(node, position, bytes, 0, bytes.length); };
  type(MUXER, OBJECT, [], { allocatable: true });
  const muxerOf = (r, self) => r.object(self).muxer ?? ise(r, 'Muxer has been released!');
  const muxerInit = (r, self, node, format) => {
    if (format < 0 || format > 4) iae(r, `format: ${format} is invalid`);
    if (format !== 0) unsupported(`android.media.MediaMuxer: the output format ${['MPEG_4', 'WEBM', 'THREE_GPP', 'HEIF', 'OGG'][format]} is not provided (the lab writes MUXER_OUTPUT_MPEG_4 only)`, 'MediaMuxer.<init>');
    if (!node) r.throwJava('Ljava/io/IOException;', 'the output is not a regular file');
    r.object(self).muxer = { state: 'initialized', node, orientation: 0, tracks: [], writer: null };
  };
  def(MUXER, '<init>', `(${STRING}I)V`, (r, _m, [self, path, format]) => { if (nullish(path)) iae(r, 'path must not be null'); muxerInit(r, self, format === 0 ? openPath(r, path) : null, format); });
  def(MUXER, '<init>', `(${FD}I)V`, (r, _m, [self, fd, format]) => { if (nullish(fd)) iae(r, 'fd must not be null'); muxerInit(r, self, format === 0 ? nodeOfDescriptor(r, fd) : null, format); });
  def(MUXER, 'setOrientationHint', '(I)V', (r, _m, [self, degrees]) => { const muxer = muxerOf(r, self); if (![0, 90, 180, 270].includes(degrees)) iae(r, `Unsupported angle: ${degrees}`); if (muxer.state !== 'initialized') ise(r, 'Can\'t set rotation degrees due to wrong state.'); muxer.orientation = degrees; });
  def(MUXER, 'setLocation', '(FF)V', () => unsupported('android.media.MediaMuxer.setLocation is not provided: the lab\'s MP4 writer stores no geodata', 'MediaMuxer.setLocation'));
  def(MUXER, 'addTrack', `(${MEDIA_FORMAT})I`, (r, _m, [self, format]) => {
    const muxer = muxerOf(r, self); if (nullish(format)) iae(r, 'format must not be null.'); if (muxer.state !== 'initialized') ise(r, 'Muxer is not initialized.');
    const mime = String(formatString(r, format, 'mime') ?? '').toLowerCase();
    if (mime !== AVC) unsupported(`android.media.MediaMuxer.addTrack(${mime || 'a format without a MIME type'}) is not provided: the lab's MP4 writer takes one video/avc track (the device has no audio encoder)`, 'MediaMuxer.addTrack');
    if (muxer.tracks.length) unsupported('android.media.MediaMuxer.addTrack: a second video track is not provided', 'MediaMuxer.addTrack');
    const width = formatNumber(r, format, 'width'), height = formatNumber(r, format, 'height'); if (!(width > 0 && height > 0)) iae(r, 'the video track format has no width and height');
    const csd = name => { const bytes = formatBuffer(r, format, name); return bytes ? splitAnnexB(bytes) : []; };
    const sets = [...csd('csd-0'), ...csd('csd-1')];
    muxer.tracks.push({ width, height, sps: sets.find(nal => nalType(nal) === NAL.SPS) ?? null, pps: sets.find(nal => nalType(nal) === NAL.PPS) ?? null }); return muxer.tracks.length - 1;
  });
  def(MUXER, 'start', '()V', (r, _m, [self]) => {
    const muxer = muxerOf(r, self); if (muxer.state !== 'initialized') ise(r, 'Can\'t start due to wrong state.'); if (!muxer.tracks.length) ise(r, 'Failed to start the muxer');   // the native writer refuses to start without a track
    const track = muxer.tracks[0]; muxer.writer = createMp4Writer({ width: track.width, height: track.height, rotation: muxer.orientation, write: fileSink(muxer.node) });
    if (track.sps && track.pps) muxer.writer.setConfig(track.sps, track.pps);
    muxer.state = 'started';
  });
  def(MUXER, 'writeSampleData', `(I${BYTE_BUFFER}${BUFFER_INFO})V`, (r, _m, [self, index, buffer, info]) => {
    const muxer = muxerOf(r, self); if (index < 0 || index >= muxer.tracks.length) iae(r, 'trackIndex is invalid'); if (nullish(buffer)) iae(r, 'byteBuffer must not be null'); if (nullish(info)) iae(r, 'bufferInfo must not be null');
    const { offset, size, timeUs, flags } = readInfo(r, info);
    if (size < 0 || offset < 0 || offset + size > call(r, buffer, BUFFER, 'capacity', [], 'I') || timeUs < 0) iae(r, 'bufferInfo must specify a valid buffer offset, size and presentation time');
    if (muxer.state !== 'started') ise(r, 'Can\'t write, muxer is not started');
    if (size === 0) return;   // an end-of-stream marker carries no sample
    const nals = splitAnnexB(bufferBytes(r, buffer, offset, size)); if (!nals.length) r.throwJava('Ljava/lang/IllegalStateException;', 'writeSampleData returned an error');   // not an H.264 access unit: MPEG4Writer rejects it (ERROR_MALFORMED)
    if (flags & FLAG_CODEC_CONFIG) { const sps = nals.find(nal => nalType(nal) === NAL.SPS), pps = nals.find(nal => nalType(nal) === NAL.PPS); if (sps && pps && !muxer.writer.hasConfig) muxer.writer.setConfig(sps, pps); return; }
    try { muxer.writer.addSample(nals, { key: !!(flags & FLAG_KEY_FRAME), timestampUs: timeUs }); } catch (error) { r.record(`MEDIA MediaMuxer rejected a sample: ${String(error?.message ?? error)}`); ise(r, 'writeSampleData returned an error'); }
  });
  def(MUXER, 'stop', '()V', (r, _m, [self]) => {
    const muxer = muxerOf(r, self); if (muxer.state !== 'started') ise(r, `Can't stop due to wrong state(${muxer.state === 'initialized' ? 'INITIALIZED' : 'STOPPED'})`);
    muxer.state = 'stopped';
    try { muxer.writer.finish(); } catch (error) { r.record(`MEDIA MediaMuxer could not finish the file: ${String(error?.message ?? error)}`); ise(r, 'Failed to stop the muxer'); }
    r.record(`MEDIA MediaMuxer wrote ${muxer.writer.samples} samples, ${muxer.writer.size} bytes, ${(muxer.writer.durationUs / 1e6).toFixed(2)} s`);
  });
  def(MUXER, 'release', '()V', (r, _m, [self]) => { const muxer = r.object(self).muxer; if (!muxer) return; if (muxer.state === 'started') { try { muxer.writer.finish(); } catch { /* nothing was written: the file stays without a movie */ } } r.object(self).muxer = null; });

  // ---- CamcorderProfile / EncoderProfiles ---------------------------------------------------------------------------------------------------------------------------------------
  type(CAMCORDER, OBJECT); type(ENCODER_PROFILES, OBJECT); type(VIDEO_PROFILE, OBJECT); type(AUDIO_PROFILE, OBJECT);
  const CAMCORDER_FIELDS = ['duration', 'quality', 'fileFormat', 'videoCodec', 'videoBitRate', 'videoFrameRate', 'videoFrameWidth', 'videoFrameHeight', 'audioCodec', 'audioBitRate', 'audioSampleRate', 'audioChannels'];
  for (const name of CAMCORDER_FIELDS) registry.instanceField(CAMCORDER, name, 'I', { reflect: true });
  /** The profile of `quality` for one of the device's cameras, or null: a quality needs a camera, an encoder that takes the size and bitrate, and the camera to produce the size. */
  const profileFor = (cameraId, quality) => {
    const entry = CAMCORDER_QUALITIES[quality], encoder = encoders()[0]; if (!entry || !encoder || !cameras().some(camera => camera.id === String(cameraId))) return null;
    return supportsSize(FORMAT.PRIVATE, entry.width, entry.height) && sizeSupported(encoder, entry.width, entry.height) && entry.bitrate <= encoder.maxBitrate ? { ...entry, profile: encoder.profiles.includes(AVC_PROFILE.High) ? AVC_PROFILE.High : encoder.profiles[0] } : null;
  };
  const checkQuality = (r, quality) => { if (!knownQuality(quality)) iae(r, `Unsupported quality level: ${quality}`); };
  const camcorder = (r, cameraId, quality) => {
    checkQuality(r, quality); const entry = profileFor(cameraId, quality); if (!entry) r.throwJava('Ljava/lang/RuntimeException;', 'Error retrieving camcorder profile params');
    const ref = r.makeObject(CAMCORDER), values = { duration: CAMCORDER_DURATION, quality, fileFormat: FILE_FORMAT_MPEG_4, videoCodec: VIDEO_ENCODER_H264, videoBitRate: entry.bitrate, videoFrameRate: CAMCORDER_FRAME_RATE, videoFrameWidth: entry.width, videoFrameHeight: entry.height, audioCodec: 0, audioBitRate: 0, audioSampleRate: 0, audioChannels: 0 };
    for (const name of CAMCORDER_FIELDS) field(r, ref, CAMCORDER, name, 'I', values[name]); return ref;
  };
  const firstBackCamera = () => cameras().find(camera => camera.facing === 1)?.id ?? cameras()[0]?.id ?? '0';
  def(CAMCORDER, 'hasProfile', '(I)Z', (r, _m, [quality]) => (profileFor(firstBackCamera(), quality) ? 1 : 0), { static: true });
  def(CAMCORDER, 'hasProfile', '(II)Z', (r, _m, [cameraId, quality]) => (profileFor(cameraId, quality) ? 1 : 0), { static: true });
  def(CAMCORDER, 'get', `(I)${CAMCORDER}`, (r, _m, [quality]) => camcorder(r, firstBackCamera(), quality), { static: true });
  def(CAMCORDER, 'get', `(II)${CAMCORDER}`, (r, _m, [cameraId, quality]) => camcorder(r, cameraId, quality), { static: true });
  def(CAMCORDER, 'getAll', `(${STRING}I)${ENCODER_PROFILES}`, (r, _m, [cameraId, quality]) => {
    checkQuality(r, quality); const id = text(r, cameraId); if (id === null || !/^-?\d+$/.test(id)) return null;
    const entry = profileFor(id, quality); if (!entry) return null;
    const ref = r.makeObject(ENCODER_PROFILES); r.object(ref).encoderProfile = entry; return ref;
  }, { static: true });
  const listOf = (r, items) => { const list = construct(r, 'Ljava/util/ArrayList;'); for (const item of items) call(r, list, 'Ljava/util/ArrayList;', 'add', [OBJECT], 'Z', [item]); return list; };
  def(ENCODER_PROFILES, 'getDefaultDurationSeconds', '()I', () => CAMCORDER_DURATION);
  def(ENCODER_PROFILES, 'getRecommendedFileFormat', '()I', () => FILE_FORMAT_MPEG_4);
  def(ENCODER_PROFILES, 'getAudioProfiles', `()${LIST}`, r => listOf(r, []));   // no audio encoder, no audio input
  def(ENCODER_PROFILES, 'getVideoProfiles', `()${LIST}`, (r, _m, [self]) => { const ref = r.makeObject(VIDEO_PROFILE); r.object(ref).encoderProfile = r.object(self).encoderProfile; return listOf(r, [ref]); });
  const videoProfile = (name, signature, value) => def(VIDEO_PROFILE, name, signature, (r, _m, [self]) => value(r.object(self).encoderProfile));
  videoProfile('getCodec', '()I', () => VIDEO_ENCODER_H264); videoProfile('getMediaType', `()${STRING}`, () => AVC); videoProfile('getBitrate', '()I', entry => entry.bitrate); videoProfile('getFrameRate', '()I', () => CAMCORDER_FRAME_RATE);
  videoProfile('getWidth', '()I', entry => entry.width); videoProfile('getHeight', '()I', entry => entry.height); videoProfile('getProfile', '()I', entry => entry.profile);
  videoProfile('getBitDepth', '()I', () => 8); videoProfile('getChromaSubsampling', '()I', () => 0); videoProfile('getHdrFormat', '()I', () => 0);   // YUV_420, HDR_NONE

  // ---- AudioRecord: a device without an audio input ------------------------------------------------------------------------------------------------------------------------------
  type(AUDIO_RECORD, OBJECT, [], { allocatable: true }); type(AUDIO_RECORD_BUILDER, OBJECT, [], { allocatable: true });
  const audioArguments = (rate, channels, encoding) => (rate === 0 || (rate >= 4000 && rate <= 192000)) && [1, 2, 16, 12, 48].includes(channels) && [1, 2, 3, 4].includes(encoding);   // CHANNEL_IN_DEFAULT / MONO / STEREO (+ the legacy configuration constants), ENCODING_DEFAULT / PCM_16BIT / PCM_8BIT / PCM_FLOAT
  def(AUDIO_RECORD, 'getMinBufferSize', '(III)I', (r, _m, [rate, channels, encoding]) => (audioArguments(rate, channels, encoding) ? -1 : -2), { static: true });   // ERROR: the audio system has no input to size a buffer for; ERROR_BAD_VALUE for parameters no input has
  def(AUDIO_RECORD, '<init>', '(IIIII)V', (r, _m, [self, source, rate, channels, encoding, size]) => {
    if (!audioArguments(rate, channels, encoding)) iae(r, `Unsupported sample rate, channel configuration or audio format (${rate}, ${channels}, ${encoding})`); if (size <= 0) iae(r, 'Invalid audio buffer size.');
    r.object(self).audioRecord = { source, rate, encoding }; r.record(`MEDIA AudioRecord(source ${source}): the device has no audio input; the record stays uninitialized`);
  });
  const recordOf = (r, self) => r.object(self).audioRecord ?? {};
  def(AUDIO_RECORD, 'getState', '()I', () => 0);            // STATE_UNINITIALIZED
  def(AUDIO_RECORD, 'getRecordingState', '()I', () => 1);   // RECORDSTATE_STOPPED
  def(AUDIO_RECORD, 'getAudioSource', '()I', (r, _m, [self]) => recordOf(r, self).source ?? 0); def(AUDIO_RECORD, 'getSampleRate', '()I', (r, _m, [self]) => recordOf(r, self).rate ?? 0); def(AUDIO_RECORD, 'getAudioFormat', '()I', (r, _m, [self]) => recordOf(r, self).encoding ?? 0);
  def(AUDIO_RECORD, 'getAudioSessionId', '()I', () => 0);
  def(AUDIO_RECORD, 'startRecording', '()V', r => ise(r, 'startRecording() called on an uninitialized AudioRecord.'));
  def(AUDIO_RECORD, 'stop', '()V', r => ise(r, 'stop() called on an uninitialized AudioRecord.'));
  def(AUDIO_RECORD, 'release', '()V', () => {});
  for (const signature of ['([BII)I', '([BIII)I', '([SII)I', '([SIII)I', '([FIII)I', `(${BYTE_BUFFER}I)I`, `(${BYTE_BUFFER}II)I`]) def(AUDIO_RECORD, 'read', signature, () => -3);   // ERROR_INVALID_OPERATION: the record was never initialised
  def(AUDIO_RECORD_BUILDER, '<init>', '()V', () => {});
  def(AUDIO_RECORD_BUILDER, 'setAudioSource', `(I)${AUDIO_RECORD_BUILDER}`, (r, _m, [self]) => self); def(AUDIO_RECORD_BUILDER, 'setBufferSizeInBytes', `(I)${AUDIO_RECORD_BUILDER}`, (r, _m, [self, size]) => { if (size <= 0) iae(r, `Invalid buffer size ${size}`); return self; });
  def(AUDIO_RECORD_BUILDER, 'setAudioFormat', `(${AUDIO_FORMAT})${AUDIO_RECORD_BUILDER}`, (r, _m, [self, format]) => { if (nullish(format)) iae(r, 'Illegal null AudioFormat argument'); return self; });
  def(AUDIO_RECORD_BUILDER, 'setContext', `(Landroid/content/Context;)${AUDIO_RECORD_BUILDER}`, (r, _m, [self]) => self);
  def(AUDIO_RECORD_BUILDER, 'build', `()${AUDIO_RECORD}`, r => r.throwJava('Ljava/lang/UnsupportedOperationException;', 'Cannot create AudioRecord'));   // AudioRecord.Builder.build when the native record does not initialise

  // ---- MediaRecorder (video from a Surface) --------------------------------------------------------------------------------------------------------------------------------------
  type(RECORDER, OBJECT, [], { allocatable: true }); type(INFO_LISTENER, OBJECT); type(ERROR_LISTENER, OBJECT);
  const recorderOf = (r, self) => { const recorder = r.object(self).recorder; if (!recorder || recorder.state === 'released') ise(r, 'MediaRecorder has been released'); return recorder; };
  const freshRecorder = previous => ({ state: 'initial', videoSource: null, outputFormat: null, videoEncoder: null, size: null, frameRate: null, bitrate: null, orientation: 0, maxDurationMs: 0, output: null, surface: previous?.persistent ?? null, persistent: previous?.persistent ?? null, handle: null, writer: null,
    infoListener: previous?.infoListener ?? null, errorListener: previous?.errorListener ?? null, target: previous?.target ?? null, paused: false, firstUs: null, lastUs: 0, lastKeyUs: null, frames: 0, maxReported: false });
  const recorderInit = (r, self) => { const recorder = freshRecorder(null); recorder.target = ownTarget(r); recorder.self = self; r.object(self).recorder = recorder; };
  def(RECORDER, '<init>', '()V', (r, _m, [self]) => recorderInit(r, self)); def(RECORDER, '<init>', '(Landroid/content/Context;)V', (r, _m, [self]) => recorderInit(r, self));
  const inState = (r, recorder, states, what) => { if (!states.includes(recorder.state)) ise(r, `${what} called in an invalid state: ${recorder.state}`); };
  def(RECORDER, 'setVideoSource', '(I)V', (r, _m, [self, source]) => {
    const recorder = recorderOf(r, self); inState(r, recorder, ['initial', 'initialized'], 'setVideoSource');
    if (source === 1) unsupported('android.media.MediaRecorder.setVideoSource(VideoSource.CAMERA) is not provided: the deprecated android.hardware.Camera does not exist in the lab; record from a Camera2 session with VideoSource.SURFACE', 'MediaRecorder.setVideoSource');
    if (source !== 2 && source !== 0) iae(r, `Invalid video source: ${source}`);
    recorder.videoSource = 2; recorder.state = 'initialized';
  });
  def(RECORDER, 'setAudioSource', '(I)V', (r, _m, [self]) => { recorderOf(r, self); r.record('MEDIA MediaRecorder.setAudioSource: the device has no audio input'); r.throwJava('Ljava/lang/RuntimeException;', 'setAudioSource failed.'); });
  def(RECORDER, 'setOutputFormat', '(I)V', (r, _m, [self, format]) => {
    const recorder = recorderOf(r, self); inState(r, recorder, ['initialized'], 'setOutputFormat');
    if (format !== 0 && format !== 2) unsupported(`android.media.MediaRecorder.setOutputFormat(${format}) is not provided: the lab writes OutputFormat.MPEG_4 only`, 'MediaRecorder.setOutputFormat');
    recorder.outputFormat = 2; recorder.state = 'configured';
  });
  const configured = (r, self, what) => { const recorder = recorderOf(r, self); inState(r, recorder, ['configured'], what); return recorder; };
  def(RECORDER, 'setVideoEncoder', '(I)V', (r, _m, [self, encoder]) => { const recorder = configured(r, self, 'setVideoEncoder'); if (encoder < 0 || encoder > 7) iae(r, `Invalid video encoder: ${encoder}`); recorder.videoEncoder = encoder === 0 ? VIDEO_ENCODER_H264 : encoder; });
  def(RECORDER, 'setAudioEncoder', '(I)V', (r, _m, [self]) => { configured(r, self, 'setAudioEncoder'); ise(r, 'setAudioEncoder called without an audio source'); });
  def(RECORDER, 'setVideoSize', '(II)V', (r, _m, [self, width, height]) => { const recorder = configured(r, self, 'setVideoSize'); if (width <= 0 || height <= 0) iae(r, 'Video size is not positive'); recorder.size = { width, height }; });
  def(RECORDER, 'setVideoFrameRate', '(I)V', (r, _m, [self, rate]) => { const recorder = configured(r, self, 'setVideoFrameRate'); if (rate <= 0) iae(r, 'Video frame rate is not positive'); recorder.frameRate = rate; });
  def(RECORDER, 'setVideoEncodingBitRate', '(I)V', (r, _m, [self, bitrate]) => { const recorder = recorderOf(r, self); if (bitrate <= 0) iae(r, 'Video encoding bit rate is not positive'); recorder.bitrate = bitrate; });
  def(RECORDER, 'setVideoEncodingProfileLevel', '(II)V', (r, _m, [self, profile]) => { const recorder = recorderOf(r, self); if (profile <= 0) iae(r, 'Video encoding profile is not positive'); recorder.profile = profile; });
  def(RECORDER, 'setCaptureRate', '(D)V', () => unsupported('android.media.MediaRecorder.setCaptureRate (time lapse) is not provided', 'MediaRecorder.setCaptureRate'));
  def(RECORDER, 'setOrientationHint', '(I)V', (r, _m, [self, degrees]) => { const recorder = recorderOf(r, self); if (![0, 90, 180, 270].includes(degrees)) iae(r, `Unsupported angle: ${degrees}`); recorder.orientation = degrees; });
  def(RECORDER, 'setMaxDuration', '(I)V', (r, _m, [self, ms]) => { recorderOf(r, self).maxDurationMs = Math.max(0, ms); });
  def(RECORDER, 'setMaxFileSize', '(J)V', (r, _m, [self, bytes]) => { if (bytes > 0n) unsupported('android.media.MediaRecorder.setMaxFileSize with a limit is not provided', 'MediaRecorder.setMaxFileSize'); recorderOf(r, self); });
  def(RECORDER, 'setPreviewDisplay', `(${SURFACE})V`, (r, _m, [self]) => { recorderOf(r, self); });   // only meaningful with the deprecated Camera source
  def(RECORDER, 'setProfile', `(${CAMCORDER})V`, (r, _m, [self, profile]) => {
    const recorder = recorderOf(r, self); if (nullish(profile)) npe(r); inState(r, recorder, ['initialized'], 'setProfile');
    const value = name => read(r, profile, CAMCORDER, name, 'I');
    recorder.outputFormat = 2; recorder.state = 'configured'; recorder.videoEncoder = value('videoCodec'); recorder.size = { width: value('videoFrameWidth'), height: value('videoFrameHeight') }; recorder.frameRate = value('videoFrameRate'); recorder.bitrate = value('videoBitRate');
  });
  def(RECORDER, 'setOutputFile', `(${STRING})V`, (r, _m, [self, path]) => { recorderOf(r, self).output = nullish(path) ? null : { path }; });
  def(RECORDER, 'setOutputFile', `(${FILE})V`, (r, _m, [self, file]) => { recorderOf(r, self).output = nullish(file) ? null : { path: call(r, file, FILE, 'getPath', [], STRING) }; });
  def(RECORDER, 'setOutputFile', `(${FD})V`, (r, _m, [self, fd]) => { recorderOf(r, self).output = nullish(fd) ? null : { fd }; });
  def(RECORDER, 'setInputSurface', `(${SURFACE})V`, (r, _m, [self, surface]) => { const recorder = recorderOf(r, self), sink = sinkOfSurface(r, surface); if (!sink || sink.kind !== 'encoder' || !sink.persistent) iae(r, 'not a PersistentSurface'); recorder.persistent = surface; recorder.surface = surface; });
  def(RECORDER, 'setOnInfoListener', `(${INFO_LISTENER})V`, (r, _m, [self, listener]) => { recorderOf(r, self).infoListener = nullish(listener) ? null : listener; });
  def(RECORDER, 'setOnErrorListener', `(${ERROR_LISTENER})V`, (r, _m, [self, listener]) => { recorderOf(r, self).errorListener = nullish(listener) ? null : listener; });
  const closeRecorder = recorder => { const handle = recorder.handle; recorder.handle = null; S.live.delete(recorder); try { handle?.close(); } catch { /* already gone */ } };
  const recorderError = (r, recorder, handle, message) => {
    if (recorder.handle !== handle) return; closeRecorder(recorder); recorder.state = 'error'; r.record(`MEDIA MediaRecorder failed: ${message}`);
    const listener = recorder.errorListener; if (listener) post(r, recorder.target, () => call(r, listener, ERROR_LISTENER, 'onError', [RECORDER, 'I', 'I'], 'V', [recorder.self, 1, 0]), [recorder.self, listener]);   // MEDIA_RECORDER_ERROR_UNKNOWN
  };
  def(RECORDER, 'prepare', '()V', (r, _m, [self]) => {
    const recorder = recorderOf(r, self); inState(r, recorder, ['configured'], 'prepare');
    const refuse = why => { r.record(`MEDIA MediaRecorder.prepare failed: ${why}`); r.throwJava('Ljava/io/IOException;', 'prepare failed.'); };
    if (!recorder.output) refuse('no output file was set'); if (recorder.videoSource !== 2) refuse('no video source was set');
    const encoder = encoders()[0]; if (!encoder) refuse('the device has no video encoder');
    if (recorder.videoEncoder !== null && recorder.videoEncoder !== VIDEO_ENCODER_H264) refuse(`the device has no encoder for VideoEncoder ${recorder.videoEncoder} (only H264)`);
    const profile = profileFor(firstBackCamera(), 1), size = recorder.size ?? (profile ? { width: profile.width, height: profile.height } : { width: 640, height: 480 });
    if (!sizeSupported(encoder, size.width, size.height)) refuse(`the encoder does not support ${size.width}x${size.height}`);
    recorder.size = size; recorder.frameRate ??= CAMCORDER_FRAME_RATE; recorder.bitrate = Math.min(encoder.maxBitrate, recorder.bitrate ?? Object.values(CAMCORDER_QUALITIES).find(entry => entry.width === size.width && entry.height === size.height)?.bitrate ?? 3000000);
    recorder.node = recorder.output.path !== undefined ? openPath(r, recorder.output.path) : nodeOfDescriptor(r, recorder.output.fd); if (!recorder.node) refuse('the output is not a regular file');
    recorder.input = (rt, entry, timestampNs) => {
      if (recorder.state !== 'recording' || !recorder.handle) return false;
      const timestampUs = Math.max(recorder.lastUs + 1, Math.floor(Number(timestampNs) / 1000)), key = recorder.lastKeyUs === null || timestampUs - recorder.lastKeyUs >= 1e6;
      if (key) recorder.lastKeyUs = timestampUs; recorder.lastUs = timestampUs; recorder.frames++;
      const frame = entry.frame ?? null; if (frame) entry.taken = true;
      try { recorder.handle.encode({ frame, data: frame ? null : entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data), width: size.width, height: size.height, timestampUs, key }); } catch (error) { recorderError(rt, recorder, recorder.handle, `the encoder refused a frame: ${String(error?.message ?? error)}`); }
      return true;
    };
    recorder.surface = recorder.persistent ?? encoderSurface(r, recorder, false); if (recorder.persistent) sinkOfSurface(r, recorder.persistent).owner = recorder;
    recorder.state = 'prepared';
  });
  def(RECORDER, 'getSurface', `()${SURFACE}`, (r, _m, [self]) => { const recorder = recorderOf(r, self); if (recorder.videoSource !== 2) ise(r, 'Cannot get surface before setting video source to SURFACE'); if (!['prepared', 'recording', 'paused'].includes(recorder.state)) ise(r, 'failed to get surface'); return recorder.surface; });
  def(RECORDER, 'start', '()V', (r, _m, [self]) => {
    const recorder = recorderOf(r, self); inState(r, recorder, ['prepared'], 'start'); if (!S.backend) ise(r, 'start failed: the host encoder went away');
    const encoder = encoders()[0]; let handle;
    recorder.writer = createMp4Writer({ width: recorder.size.width, height: recorder.size.height, rotation: recorder.orientation, write: fileSink(recorder.node) });
    const sample = (rt, chunk) => {
      if (recorder.handle !== handle || recorder.maxReported) return;
      recorder.firstUs ??= chunk.timestampUs;
      if (recorder.maxDurationMs > 0 && chunk.timestampUs - recorder.firstUs > recorder.maxDurationMs * 1000) {   // MEDIA_RECORDER_INFO_MAX_DURATION_REACHED: the writer stops taking samples; the app calls stop()
        recorder.maxReported = true; const listener = recorder.infoListener; if (listener) post(rt, recorder.target, () => call(rt, listener, INFO_LISTENER, 'onInfo', [RECORDER, 'I', 'I'], 'V', [recorder.self, 800, 0]), [recorder.self, listener]); return;
      }
      try { recorder.writer.addSample(splitAnnexB(chunk.data), { key: chunk.key, timestampUs: chunk.timestampUs }); } catch (error) { recorderError(rt, recorder, handle, String(error?.message ?? error)); }
    };
    try { handle = S.backend.createVideoEncoder({ width: recorder.size.width, height: recorder.size.height, bitrate: recorder.bitrate, frameRate: recorder.frameRate, profile: encoder.profiles.includes(recorder.profile) ? recorder.profile : encoder.profiles[0], constantBitrate: false }, {
      output: chunk => fromHost(rt => sample(rt, chunk), [self]), error: message => fromHost(rt => recorderError(rt, recorder, handle, message), [self]) });
    } catch (error) { r.record(`MEDIA MediaRecorder.start failed: ${String(error?.message ?? error)}`); ise(r, 'start failed.'); }
    recorder.handle = handle; S.live.add(recorder); recorder.state = 'recording'; recorder.frames = 0; recorder.firstUs = null; recorder.lastKeyUs = null; recorder.maxReported = false;
    r.record(`MEDIA MediaRecorder started: ${recorder.size.width}x${recorder.size.height}, ${recorder.bitrate} bit/s`);
  });
  def(RECORDER, 'pause', '()V', (r, _m, [self]) => { const recorder = recorderOf(r, self); inState(r, recorder, ['recording'], 'pause'); recorder.state = 'paused'; });
  def(RECORDER, 'resume', '()V', (r, _m, [self]) => { const recorder = recorderOf(r, self); inState(r, recorder, ['paused'], 'resume'); recorder.lastKeyUs = null; recorder.state = 'recording'; });
  /** stop(): the frames the encoder has already returned are the recording (the ones still inside it are dropped: stop cannot wait for the host's event loop); a recording without a frame is the framework's "stop failed." */
  def(RECORDER, 'stop', '()V', (r, _m, [self]) => {
    const recorder = recorderOf(r, self); inState(r, recorder, ['recording', 'paused'], 'stop');
    closeRecorder(recorder); const writer = recorder.writer, persistent = recorder.persistent, next = freshRecorder(recorder); next.self = self; next.surface = persistent; r.object(self).recorder = next;
    if (recorder.surface && !persistent) sinkOfSurface(r, recorder.surface).released = true;
    try { writer.finish(); } catch (error) { r.record(`MEDIA MediaRecorder.stop: ${String(error?.message ?? error)} (${recorder.frames} frames reached the encoder)`); r.throwJava('Ljava/lang/RuntimeException;', 'stop failed.'); }
    r.record(`MEDIA MediaRecorder wrote ${writer.samples} samples, ${writer.size} bytes, ${(writer.durationUs / 1e6).toFixed(2)} s`);
  });
  const resetRecorder = (r, self) => { const recorder = r.object(self).recorder; if (!recorder) return null; closeRecorder(recorder); if (recorder.surface && !recorder.persistent) sinkOfSurface(r, recorder.surface).released = true; const next = freshRecorder(recorder); next.self = self; r.object(self).recorder = next; return next; };
  def(RECORDER, 'reset', '()V', (r, _m, [self]) => { recorderOf(r, self); resetRecorder(r, self); });
  def(RECORDER, 'release', '()V', (r, _m, [self]) => { const next = resetRecorder(r, self); if (next) next.state = 'released'; });

  return {
    state: S,
    /** The host's codecs became the device's (src/media-codec-backend.js), or went away (null). */
    attach(backend) { S.backend = backend ?? null; },
    get backend() { return S.backend; },
    hasVideoEncoder: () => encoders().length > 0,
    /** The stream a camera session gives an encoder Surface: the encoder's configured size, when the camera produces it. null: not configurable (no encoder bound yet, or a size the camera lacks). */
    streamSize(sink) { const size = sink.size(); return size && supportsSize(FORMAT.PRIVATE, size.width, size.height) ? size : null; },
  };
}
