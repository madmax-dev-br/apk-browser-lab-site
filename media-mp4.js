// H.264 elementary-stream arithmetic and the MP4 writer shared by android.media.MediaMuxer / MediaRecorder (src/media-codec-host.js, in the VM Worker) and the system camera screen's video
// capture (src/camera-lab.js, in the page). The container is written by the vendored mp4-muxer package (vendor/mp4-muxer/5.2.2, MIT: the official npm build, unmodified); nothing here
// encodes or decodes a picture. DOM-free, no process.*.
//
// Android's codecs speak Annex B (start-code delimited NAL units; SPS and PPS are the "csd-0" / "csd-1" buffers of the output MediaFormat), an MP4 sample is the same NAL units each
// prefixed by its 4-byte length, and the parameter sets live in the sample description (the avcC box): MediaMuxer does that conversion on a device, and so does this file.
import { Muxer, StreamTarget } from './vendor/mp4-muxer/5.2.2/mp4-muxer.mjs';

export const NAL = Object.freeze({ SLICE: 1, IDR: 5, SEI: 6, SPS: 7, PPS: 8, AUD: 9 });
export const nalType = nal => nal[0] & 0x1f;

/** The NAL units of an Annex B buffer (0x000001 or 0x00000001 start codes), without the start codes. A buffer without a start code is not Annex B: []. */
export function splitAnnexB(bytes) {
  const out = [], n = bytes.length; let start = -1;
  for (let i = 0; i + 2 < n; i++) {
    if (bytes[i] !== 0 || bytes[i + 1] !== 0 || bytes[i + 2] !== 1) continue;
    if (start >= 0) { let end = i; while (end > start && bytes[end - 1] === 0) end--; if (end > start) out.push(bytes.subarray(start, end)); }
    start = i + 3; i += 2;
  }
  if (start >= 0 && start < n) out.push(bytes.subarray(start, n));
  return out;
}
/** NAL units as one Annex B buffer with 4-byte start codes (the form of a codec's csd buffers and output buffers). */
export function joinAnnexB(nals) {
  const out = new Uint8Array(nals.reduce((sum, nal) => sum + 4 + nal.length, 0)); let at = 0;
  for (const nal of nals) { out[at + 3] = 1; out.set(nal, at + 4); at += 4 + nal.length; }
  return out;
}
/** NAL units as an MP4 sample: each prefixed by its big-endian 32-bit length. */
export function lengthPrefixed(nals) {
  const out = new Uint8Array(nals.reduce((sum, nal) => sum + 4 + nal.length, 0)); let at = 0;
  for (const nal of nals) { const size = nal.length; out[at] = size >>> 24; out[at + 1] = (size >>> 16) & 255; out[at + 2] = (size >>> 8) & 255; out[at + 3] = size & 255; out.set(nal, at + 4); at += 4 + size; }
  return out;
}
/** The NAL units of a length-prefixed (avcC-style) sample, for a decoder that wants Annex B or a reader that looks at the slice types. */
export function splitLengthPrefixed(bytes, lengthSize = 4) {
  const out = [];
  for (let at = 0; at + lengthSize <= bytes.length;) { let size = 0; for (let i = 0; i < lengthSize; i++) size = size * 256 + bytes[at + i]; at += lengthSize; if (size <= 0 || at + size > bytes.length) break; out.push(bytes.subarray(at, at + size)); at += size; }
  return out;
}
/** AVCDecoderConfigurationRecord (ISO/IEC 14496-15, 5.3.3.1) for one SPS and one PPS: the payload of the avcC box and the `description` of a WebCodecs decoder configuration. */
export function avcConfigurationRecord(sps, pps) {
  if (!(sps?.length >= 4) || nalType(sps) !== NAL.SPS) throw new RangeError('Not an H.264 sequence parameter set');
  if (!(pps?.length >= 1) || nalType(pps) !== NAL.PPS) throw new RangeError('Not an H.264 picture parameter set');
  const high = [100, 110, 122, 144].includes(sps[1]), out = new Uint8Array(11 + sps.length + pps.length + (high ? 4 : 0)); let at = 0;
  out.set([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255], 0); at = 8; out.set(sps, at); at += sps.length;
  out.set([1, pps.length >> 8, pps.length & 255], at); at += 3; out.set(pps, at); at += pps.length;
  if (high) out.set([0xfd, 0xf8, 0xf8, 0], at);   // chroma_format 4:2:0, 8-bit luma and chroma, no SPS extension (what an 8-bit High profile stream carries)
  return out;
}
/** The first SPS and PPS of an avcC record: { sps, pps, lengthSize }, or null when it carries none. */
export function parseAvcConfigurationRecord(record) {
  if (!(record?.length >= 7) || record[0] !== 1) return null;
  let at = 6; const spsCount = record[5] & 31, lengthSize = (record[4] & 3) + 1; let sps = null, pps = null;
  for (let i = 0; i < spsCount; i++) { const size = (record[at] << 8) | record[at + 1]; at += 2; if (at + size > record.length) return null; sps ??= record.subarray(at, at + size); at += size; }
  const ppsCount = record[at++] ?? 0;
  for (let i = 0; i < ppsCount; i++) { const size = (record[at] << 8) | record[at + 1]; at += 2; if (at + size > record.length) return null; pps ??= record.subarray(at, at + size); at += size; }
  return sps && pps ? { sps, pps, lengthSize } : null;
}
/** The RFC 6381 codec string of an SPS ("avc1.640028": profile_idc, constraint flags, level_idc). */
export const avcCodecString = sps => `avc1.${[sps[1], sps[2], sps[3]].map(value => value.toString(16).padStart(2, '0')).join('')}`;

/**
 * An MP4 file with one H.264 video track, written the way MediaMuxer writes it: the media data as the samples arrive, the movie header at the end. `write(bytes, position)` receives every
 * piece with its absolute file offset (the header is patched once the size of the media data is known). A sample's duration is the distance to the next sample's timestamp (the last one
 * repeats the previous distance), so the movie's duration is what the timestamps say, never a nominal frame rate. Timestamps are microseconds; the first sample becomes time 0.
 */
export function createMp4Writer({ width, height, rotation = 0, write }) {
  if (typeof write !== 'function') throw new TypeError('An MP4 writer needs write(bytes, position)');
  const state = { samples: 0, bytes: 0, size: 0, firstUs: null, lastUs: null, lastDeltaUs: 0, held: null, config: null, finished: false };
  let muxer = null;   // made with the first sample: a writer that never gets one writes nothing at all
  const open = () => (muxer ??= new Muxer({ target: new StreamTarget({ onData: (data, position) => { state.size = Math.max(state.size, position + data.length); write(data, position); } }), video: { codec: 'avc', width, height, rotation }, fastStart: false, firstTimestampBehavior: 'offset' }));
  const flushHeld = nextUs => {
    const held = state.held; if (!held) return;
    const delta = nextUs === null ? (state.lastDeltaUs || 33333) : Math.max(1, nextUs - held.timestampUs); state.lastDeltaUs = delta; state.held = null;
    open().addVideoChunkRaw(held.data, held.key ? 'key' : 'delta', held.timestampUs, delta, held.first ? { decoderConfig: { codec: avcCodecString(state.config.sps), codedWidth: width, codedHeight: height, description: avcConfigurationRecord(state.config.sps, state.config.pps) } } : undefined);
  };
  return {
    get samples() { return state.samples; }, get sampleBytes() { return state.bytes; }, get size() { return state.size; },
    /** Microseconds from the first sample to the end of the last one (0 before any sample). */
    get durationUs() { return state.firstUs === null ? 0 : state.lastUs - state.firstUs + (state.samples > 1 ? state.lastDeltaUs || 0 : 0); },
    get hasConfig() { return !!state.config; },
    /** The parameter sets of the track (the csd-0 / csd-1 of the track's MediaFormat). Needed before the first sample. */
    setConfig(sps, pps) { avcConfigurationRecord(sps, pps); state.config = { sps: sps.slice(), pps: pps.slice() }; },
    /** One access unit as NAL units (parameter sets and delimiters among them are left out: they belong to the sample description). Returns false for a unit that held no picture. */
    addSample(nals, { key, timestampUs }) {
      if (state.finished) throw new Error('The MP4 file is already finished');
      if (!state.config) { const sps = nals.find(nal => nalType(nal) === NAL.SPS), pps = nals.find(nal => nalType(nal) === NAL.PPS); if (sps && pps) this.setConfig(sps, pps); }
      const picture = nals.filter(nal => { const type = nalType(nal); return type !== NAL.SPS && type !== NAL.PPS && type !== NAL.AUD; });
      if (!picture.some(nal => nalType(nal) === NAL.IDR || nalType(nal) === NAL.SLICE)) return false;
      if (!state.config) throw new Error('The first H.264 sample arrived before the parameter sets (SPS / PPS)');
      if (state.samples === 0 && !key) throw new Error('An MP4 video track must start with a sync sample');
      if (state.lastUs !== null && timestampUs <= state.lastUs) timestampUs = state.lastUs + 1;   // decode order is presentation order here (no B-frames): equal or older stamps are nudged, as MPEG4Writer does
      open(); flushHeld(timestampUs);
      const data = lengthPrefixed(picture); state.held = { data, key: !!key, timestampUs, first: state.samples === 0 };
      state.samples++; state.bytes += data.length; state.firstUs ??= timestampUs; state.lastUs = timestampUs; return true;
    },
    /** Writes the last sample and the movie header. A file without a single sample is not a movie: throws (the caller reports it, as MediaMuxer.stop does). */
    finish() {
      if (state.finished) return; if (!state.samples) throw new Error('No sample was written');
      flushHeld(null); muxer.finalize(); state.finished = true;
    },
  };
}
