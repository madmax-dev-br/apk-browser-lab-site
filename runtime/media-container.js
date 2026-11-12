// Container metadata of a media file, read from the bytes: what android.media.MediaMetadataRetriever reports without decoding a frame. Only the ISO base media file format
// (ISO/IEC 14496-12: MP4, M4A, M4V, 3GP, MOV) is read: the movie header (moov/mvhd: timescale and duration) and each track's header (tkhd: size, rotation matrix) and handler (hdlr:
// video or audio). No codec is involved. DOM-free, no process.*.

const fourcc = (bytes, at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
const u32 = (bytes, at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
const u64 = (bytes, at) => u32(bytes, at) * 4294967296 + u32(bytes, at + 4);
const s32 = (bytes, at) => (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];

/** The boxes directly inside [start, end): [{ type, start (of the payload), end }]. Stops at the first box whose size does not fit. */
function boxes(bytes, start, end) {
  const out = [];
  for (let at = start; at + 8 <= end;) {
    let size = u32(bytes, at), header = 8; const type = fourcc(bytes, at + 4);
    if (size === 1) { if (at + 16 > end) break; size = u64(bytes, at + 8); header = 16; } else if (size === 0) size = end - at;
    if (size < header || at + size > end) break;
    out.push({ type, start: at + header, end: at + size }); at += size;
  }
  return out;
}
const BRANDS_AUDIO = new Set(['M4A ', 'M4B ', 'M4P ']), BRANDS_3GP = /^3g[p2]/, BRANDS_QT = new Set(['qt  ']);

/** A short name of the container the bytes start with, for the error that says which one is not read ("Matroska / WebM", "Ogg", ...), or null when unknown. */
export function sniffContainer(bytes) {
  if (bytes.length >= 12 && fourcc(bytes, 4) === 'ftyp') return 'ISO BMFF';
  if (bytes.length >= 4 && u32(bytes, 0) === 0x1a45dfa3) return 'Matroska / WebM';
  if (bytes.length >= 4 && fourcc(bytes, 0) === 'OggS') return 'Ogg';
  if (bytes.length >= 12 && fourcc(bytes, 0) === 'RIFF') return fourcc(bytes, 8) === 'WAVE' ? 'WAVE' : fourcc(bytes, 8) === 'AVI ' ? 'AVI' : 'RIFF';
  if (bytes.length >= 4 && fourcc(bytes, 0) === 'fLaC') return 'FLAC';
  if (bytes.length >= 6 && fourcc(bytes, 0) === '#!AM') return 'AMR';
  if (bytes.length >= 4 && fourcc(bytes, 0) === 'MThd') return 'MIDI';
  if (bytes.length >= 3 && (fourcc(bytes, 0).startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) return 'MPEG audio';
  if (bytes.length >= 188 && bytes[0] === 0x47 && bytes[188] === 0x47) return 'MPEG-TS';
  return null;
}

/**
 * The movie metadata of an ISO BMFF file: { mime, durationMs, width, height, rotation, hasVideo, hasAudio, tracks }, or null when the bytes are not one (no ftyp / moov / mvhd).
 * width / height are the first video track's presentation size (tkhd, 16.16 fixed point); rotation is 0 / 90 / 180 / 270 from its matrix.
 */
export function probeIsoBmff(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 16) return null;
  const top = boxes(bytes, 0, bytes.length), ftyp = top.find(box => box.type === 'ftyp'), moov = top.find(box => box.type === 'moov');
  if (!ftyp || !moov) return null;
  const inside = boxes(bytes, moov.start, moov.end), mvhd = inside.find(box => box.type === 'mvhd'); if (!mvhd || mvhd.end - mvhd.start < 20) return null;
  const version = bytes[mvhd.start], timescale = version === 1 ? u32(bytes, mvhd.start + 20) : u32(bytes, mvhd.start + 12), duration = version === 1 ? u64(bytes, mvhd.start + 24) : u32(bytes, mvhd.start + 16);
  const out = { mime: null, durationMs: timescale > 0 ? Math.round(duration * 1000 / timescale) : 0, width: null, height: null, rotation: 0, hasVideo: false, hasAudio: false, tracks: 0 };
  for (const trak of inside.filter(box => box.type === 'trak')) {
    const parts = boxes(bytes, trak.start, trak.end), tkhd = parts.find(box => box.type === 'tkhd'), mdia = parts.find(box => box.type === 'mdia');
    const hdlr = mdia ? boxes(bytes, mdia.start, mdia.end).find(box => box.type === 'hdlr') : null, handler = hdlr && hdlr.end - hdlr.start >= 12 ? fourcc(bytes, hdlr.start + 8) : null;
    out.tracks++;
    if (handler === 'soun') out.hasAudio = true;
    if (handler !== 'vide') continue;
    out.hasVideo = true;
    if (out.width !== null || !tkhd) continue;
    const base = tkhd.start + (bytes[tkhd.start] === 1 ? 36 : 24), matrix = base + 16;   // after ids, times and duration: reserved(8) layer(2) group(2) volume(2) reserved(2), then the 3x3 matrix, width, height
    if (matrix + 44 > tkhd.end) continue;
    const a = s32(bytes, matrix), b = s32(bytes, matrix + 4), c = s32(bytes, matrix + 12), d = s32(bytes, matrix + 16);
    out.rotation = a === 0 && d === 0 ? (b > 0 && c < 0 ? 90 : b < 0 && c > 0 ? 270 : 0) : a < 0 && d < 0 ? 180 : 0;
    out.width = u32(bytes, matrix + 36) >>> 16; out.height = u32(bytes, matrix + 40) >>> 16;
  }
  const brand = ftyp.end - ftyp.start >= 4 ? fourcc(bytes, ftyp.start) : '';
  out.mime = BRANDS_QT.has(brand) ? 'video/quicktime' : BRANDS_3GP.test(brand) ? (out.hasVideo ? 'video/3gpp' : 'audio/3gpp') : out.hasVideo ? 'video/mp4' : (out.hasAudio || BRANDS_AUDIO.has(brand)) ? 'audio/mp4' : 'video/mp4';
  return out;
}

/**
 * The first video track's sample table of an ISO BMFF file: what a frame extractor needs to hand samples to a decoder, read from the track's sample description (stsd: the codec's
 * four-character code, the coded size and, for H.264, the avcC record) and its tables (stts times, stsz sizes, stsc / stco / co64 positions, stss sync samples). Returns
 * { fourcc, codedWidth, codedHeight, rotation, description, samples: [{ offset, size, timeUs, key }] }, or null when the file has no video track with a readable table.
 */
export function videoSampleTable(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 16) return null;
  const moov = boxes(bytes, 0, bytes.length).find(box => box.type === 'moov'); if (!moov) return null;
  const child = (parent, type) => (parent ? boxes(bytes, parent.start, parent.end).find(box => box.type === type) ?? null : null);
  for (const trak of boxes(bytes, moov.start, moov.end).filter(box => box.type === 'trak')) {
    const mdia = child(trak, 'mdia'), hdlr = child(mdia, 'hdlr'); if (!hdlr || hdlr.end - hdlr.start < 12 || fourcc(bytes, hdlr.start + 8) !== 'vide') continue;
    const mdhd = child(mdia, 'mdhd'), stbl = child(child(mdia, 'minf'), 'stbl'), stsd = child(stbl, 'stsd'), stts = child(stbl, 'stts'), stsz = child(stbl, 'stsz'), stsc = child(stbl, 'stsc'), stco = child(stbl, 'stco'), co64 = child(stbl, 'co64'), stss = child(stbl, 'stss');
    if (!mdhd || !stsd || !stts || !stsz || !stsc || !(stco || co64) || stsd.end - stsd.start < 8 + 86) return null;
    const timescale = bytes[mdhd.start] === 1 ? u32(bytes, mdhd.start + 20) : u32(bytes, mdhd.start + 12); if (!(timescale > 0)) return null;
    const entry = stsd.start + 8, entrySize = u32(bytes, entry), code = fourcc(bytes, entry + 4), codedWidth = (bytes[entry + 32] << 8) | bytes[entry + 33], codedHeight = (bytes[entry + 34] << 8) | bytes[entry + 35];
    const config = boxes(bytes, entry + 86, Math.min(stsd.end, entry + entrySize)).find(box => box.type === 'avcC' || box.type === 'hvcC' || box.type === 'vpcC' || box.type === 'av1C');
    const count = u32(bytes, stsz.start + 8), fixed = u32(bytes, stsz.start + 4), sizes = index => (fixed ? fixed : u32(bytes, stsz.start + 12 + index * 4));
    const offsets = []; { const table = stco ?? co64, n = u32(bytes, table.start + 4); for (let i = 0; i < n; i++) offsets.push(stco ? u32(bytes, table.start + 8 + i * 4) : u64(bytes, table.start + 8 + i * 8)); }
    const runs = []; { const n = u32(bytes, stsc.start + 4); for (let i = 0; i < n; i++) runs.push({ first: u32(bytes, stsc.start + 8 + i * 12), perChunk: u32(bytes, stsc.start + 12 + i * 12) }); }
    const sync = stss ? new Set(Array.from({ length: u32(bytes, stss.start + 4) }, (_, i) => u32(bytes, stss.start + 8 + i * 4))) : null;   // no stss: every sample is a sync sample
    const samples = []; let time = 0, sttsAt = 0, sttsLeft = 0, delta = 0; const sttsCount = u32(bytes, stts.start + 4);
    for (let chunk = 1, run = 0; chunk <= offsets.length && samples.length < count; chunk++) {
      while (run + 1 < runs.length && runs[run + 1].first <= chunk) run++;
      let offset = offsets[chunk - 1];
      for (let i = 0; i < (runs[run]?.perChunk ?? 0) && samples.length < count; i++) {
        if (sttsLeft === 0 && sttsAt < sttsCount) { sttsLeft = u32(bytes, stts.start + 8 + sttsAt * 8); delta = u32(bytes, stts.start + 12 + sttsAt * 8); sttsAt++; }
        const index = samples.length, size = sizes(index); if (offset + size > bytes.length) return null;
        samples.push({ offset, size, timeUs: Math.round(time * 1e6 / timescale), key: sync ? sync.has(index + 1) : true });
        offset += size; time += delta; if (sttsLeft > 0) sttsLeft--;
      }
    }
    const meta = probeIsoBmff(bytes);
    return { fourcc: code, codedWidth, codedHeight, rotation: meta?.rotation ?? 0, description: config ? bytes.subarray(config.start, config.end) : null, samples };
  }
  return null;
}
