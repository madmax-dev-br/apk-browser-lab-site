// The device's video codecs are the browser's: this file is the whole boundary between android.media (src/media-codec-host.js) / the system camera screen (src/camera-lab.js) and
// WebCodecs (VideoEncoder / VideoDecoder, available in pages and in Workers). Nothing else in the lab touches a codec API, and a test replaces exactly this object.
//
// A browser without WebCodecs, or whose VideoEncoder supports no H.264 configuration, yields null: the device then has no encoder (MediaCodecList is empty, MediaCodec.create* fails as on
// a device without that codec, CamcorderProfile has no profile, no camera app answers ACTION_VIDEO_CAPTURE). Nothing is ever encoded by anything but the browser's encoder.
//
// The backend object:
//   videoEncoders                  [{ name, mime: 'video/avc', profiles: [android profile constants], level, maxWidth, maxHeight, maxFrameRate, minBitrate, maxBitrate }]
//   createVideoEncoder(config, { output, error })
//                                  config: { width, height, bitrate, frameRate, profile, constantBitrate }. `output({ data, key, timestampUs })` gets each access unit as Annex B bytes
//                                  (SPS / PPS in front of every key frame) some time after encode(); `error(message)` once if the encoder fails. Returns { encode, flush, close }:
//                                  encode({ frame | data, width, height, timestampUs, key }) takes a VideoFrame (closed here) or RGBA bytes; flush() resolves when every frame given
//                                  so far has been output.
//   decodeVideoFrame(request)      request: { codec, description, codedWidth, codedHeight, samples: [{ data, key, timestampUs }] } (samples in decode order, the first a key frame).
//                                  Resolves to the last decoded picture as { width, height, rgba }.

// MediaCodecInfo.CodecProfileLevel constants and the profile_idc / constraint byte each one is asked for with.
export const AVC_PROFILE = Object.freeze({ Baseline: 0x01, Main: 0x02, High: 0x08, ConstrainedBaseline: 0x10000, ConstrainedHigh: 0x80000 });
export const AVC_LEVEL = Object.freeze({ L1: 0x01, L3: 0x100, L31: 0x200, L32: 0x400, L4: 0x800, L41: 0x1000, L42: 0x2000, L5: 0x4000, L51: 0x8000 });
const PROFILE_BYTES = { [AVC_PROFILE.Baseline]: '4200', [AVC_PROFILE.ConstrainedBaseline]: '42e0', [AVC_PROFILE.Main]: '4d00', [AVC_PROFILE.High]: '6400', [AVC_PROFILE.ConstrainedHigh]: '640c' };
/** The smallest H.264 level (level_idc) whose frame size and macroblock rate hold the stream (Table A-1 of the standard, the rows a 1080p encoder needs). */
export function avcLevelFor(width, height, frameRate) {
  const blocks = Math.ceil(width / 16) * Math.ceil(height / 16), rate = blocks * Math.max(1, frameRate);
  for (const [idc, maxBlocks, maxRate] of [[30, 1620, 40500], [31, 3600, 108000], [32, 5120, 216000], [40, 8192, 245760], [42, 8704, 522240], [50, 22080, 589824], [51, 36864, 983040]]) if (blocks <= maxBlocks && rate <= maxRate) return idc;
  return 52;
}
export const avcCodecFor = (profile, width, height, frameRate) => `avc1.${PROFILE_BYTES[profile] ?? PROFILE_BYTES[AVC_PROFILE.Baseline]}${avcLevelFor(width, height, frameRate).toString(16).padStart(2, '0')}`;
const encoderConfig = ({ width, height, bitrate, frameRate, profile, constantBitrate = false }) => ({ codec: avcCodecFor(profile, width, height, frameRate), width, height, bitrate, framerate: frameRate, bitrateMode: constantBitrate ? 'constant' : 'variable', latencyMode: 'realtime', avc: { format: 'annexb' } });

/** Asks the browser which H.264 encodings it has. Resolves to the backend, or null when it has none (no WebCodecs, or no supported AVC configuration). */
export async function probeWebCodecs(scope = globalThis) {
  if (typeof scope.VideoEncoder !== 'function' || typeof scope.VideoFrame !== 'function' || typeof scope.VideoEncoder.isConfigSupported !== 'function') return null;
  const supported = async config => { try { return (await scope.VideoEncoder.isConfigSupported(encoderConfig(config))).supported === true; } catch { return false; } };
  const profiles = [];
  for (const profile of [AVC_PROFILE.Baseline, AVC_PROFILE.ConstrainedBaseline, AVC_PROFILE.Main, AVC_PROFILE.High, AVC_PROFILE.ConstrainedHigh]) if (await supported({ width: 1280, height: 720, bitrate: 4000000, frameRate: 30, profile })) profiles.push(profile);
  if (!profiles.length) return null;
  const fullHd = await supported({ width: 1920, height: 1080, bitrate: 8000000, frameRate: 30, profile: profiles[0] });
  return createWebCodecsBackend(scope, { profiles, maxWidth: fullHd ? 1920 : 1280, maxHeight: fullHd ? 1088 : 720, level: fullHd ? AVC_LEVEL.L4 : AVC_LEVEL.L31 });
}

export function createWebCodecsBackend(scope, { profiles, maxWidth, maxHeight, level }) {
  const canvasFor = (width, height) => (typeof scope.OffscreenCanvas === 'function' ? new scope.OffscreenCanvas(width, height) : Object.assign(scope.document.createElement('canvas'), { width, height }));
  return {
    kind: 'webcodecs',
    videoEncoders: [{ name: 'c2.lab.avc.encoder', mime: 'video/avc', profiles, level, maxWidth, maxHeight, maxFrameRate: 60, minBitrate: 1, maxBitrate: 20000000 }],
    createVideoEncoder(config, { output, error }) {
      let closed = false;
      const encoder = new scope.VideoEncoder({
        output(chunk) { if (closed) return; const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); output({ data, key: chunk.type === 'key', timestampUs: chunk.timestamp }); },
        error(failure) { if (!closed) error(String(failure?.message ?? failure)); },
      });
      encoder.configure(encoderConfig(config));
      return {
        encode({ frame, data, width, height, timestampUs, key }) {
          if (closed || encoder.state !== 'configured') { frame?.close?.(); return; }
          const picture = frame ? (frame.timestamp === timestampUs ? frame : new scope.VideoFrame(frame, { timestamp: timestampUs })) : new scope.VideoFrame(data, { format: 'RGBA', codedWidth: width, codedHeight: height, timestamp: timestampUs });
          try { encoder.encode(picture, { keyFrame: !!key }); } finally { picture.close(); if (frame && frame !== picture) frame.close(); }
        },
        get queued() { return encoder.encodeQueueSize; },
        flush: () => (closed || encoder.state !== 'configured' ? Promise.resolve() : encoder.flush()),
        close() { if (closed) return; closed = true; try { if (encoder.state !== 'closed') encoder.close(); } catch { /* already closed by an error */ } },
      };
    },
    async decodeVideoFrame({ codec, description, codedWidth, codedHeight, samples }) {
      if (typeof scope.VideoDecoder !== 'function') throw new Error('this browser has no WebCodecs VideoDecoder');
      const config = { codec, codedWidth, codedHeight, ...(description ? { description } : {}) };
      if (!(await scope.VideoDecoder.isConfigSupported(config)).supported) throw new Error(`the browser's VideoDecoder does not support ${codec} at ${codedWidth}x${codedHeight}`);
      let last = null, failure = null;
      const decoder = new scope.VideoDecoder({ output(frame) { last?.close(); last = frame; }, error(reason) { failure = reason; } });
      try {
        decoder.configure(config);
        for (const sample of samples) decoder.decode(new scope.EncodedVideoChunk({ type: sample.key ? 'key' : 'delta', timestamp: sample.timestampUs, data: sample.data }));
        await decoder.flush();
        if (failure || !last) throw new Error(String(failure?.message ?? failure ?? 'the decoder produced no picture'));
        const width = last.displayWidth, height = last.displayHeight, canvas = canvasFor(width, height), context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(last, 0, 0, width, height);
        return { width, height, rgba: new Uint8Array(context.getImageData(0, 0, width, height).data.buffer) };
      } finally { last?.close(); try { if (decoder.state !== 'closed') decoder.close(); } catch { /* closed by its error */ } }
    },
  };
}
