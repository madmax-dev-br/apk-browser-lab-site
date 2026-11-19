// The GNU build-id of an ELF file (the NT_GNU_BUILD_ID note the linker writes with --build-id), as lowercase hex, or null when the file has none or is not a
// readable ELF. Metadata only: PT_NOTE program headers are walked, nothing is executed. The build-id names one exact build of a library, which is how the lab
// recognises the official binary of an open-source artifact that carries no version of its own (scripts/wasm/fresco-libs.json).
const PT_NOTE = 4, NT_GNU_BUILD_ID = 3;

export function elfBuildId(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 52 || bytes[0] !== 0x7f || bytes[1] !== 69 || bytes[2] !== 76 || bytes[3] !== 70) return null;
  const wide = bytes[4] === 2, little = bytes[5] === 1;
  if ((!wide && bytes[4] !== 1) || (!little && bytes[5] !== 2) || bytes.length < (wide ? 64 : 52)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = at => wide ? Number(view.getBigUint64(at, little)) : view.getUint32(at, little);
  const headers = word(wide ? 32 : 28), size = view.getUint16(wide ? 54 : 42, little), count = view.getUint16(wide ? 56 : 44, little);
  if (size < (wide ? 56 : 32) || count > 4096 || headers + count * size > bytes.length) return null;
  for (let i = 0; i < count; i++) {
    const header = headers + i * size;
    if (view.getUint32(header, little) !== PT_NOTE) continue;
    const start = word(header + (wide ? 8 : 4)), end = start + word(header + (wide ? 32 : 16));
    if (!(end <= bytes.length)) continue;
    for (let at = start; at + 12 <= end;) {
      const nameSize = view.getUint32(at, little), descSize = view.getUint32(at + 4, little), type = view.getUint32(at + 8, little);
      const desc = at + 12 + ((nameSize + 3) & ~3), next = desc + ((descSize + 3) & ~3);
      if (!(desc + descSize <= end)) break;
      if (type === NT_GNU_BUILD_ID && nameSize === 4 && bytes[at + 12] === 71 && bytes[at + 13] === 78 && bytes[at + 14] === 85 && bytes[at + 15] === 0 && descSize >= 4 && descSize <= 64) {
        let hex = ''; for (let k = 0; k < descSize; k++) hex += bytes[desc + k].toString(16).padStart(2, '0');
        return hex;
      }
      at = next;
    }
  }
  return null;
}
