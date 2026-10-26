import { APKError } from './apk-runtime.js?v=0e6d4aa783cd';

const fail = message => { throw new APKError(`ELF inspection: ${message}`); };
const ARCHITECTURES = new Map([[3, 'x86'], [8, 'mips'], [40, 'arm'], [62, 'x86_64'], [183, 'aarch64'], [243, 'riscv']]);
const bounded = (value, fallback, maximum) => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) fail('inspection limits must be nonnegative safe integers');
  return Math.min(value, maximum);
};

/** Bounded metadata inspection only. Android ELF machine code is never executed. */
export function inspectELF(input, options = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const maxBytes = bounded(options.maxBytes, 32 * 1024 * 1024, 64 * 1024 * 1024);
  if (bytes.length < 52 || bytes.length > maxBytes) fail(`invalid file size (limit ${maxBytes} bytes)`);
  if (bytes[0] !== 0x7f || bytes[1] !== 69 || bytes[2] !== 76 || bytes[3] !== 70) fail('not an ELF file');
  const bits = bytes[4] === 1 ? 32 : bytes[4] === 2 ? 64 : null;
  if (!bits || ![1, 2].includes(bytes[5]) || bytes[6] !== 1) fail('unsupported ELF class, byte order or version');
  const little = bytes[5] === 1, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const check = (offset, size) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset > bytes.length - size)
      fail(`file range ${offset}+${size} is outside ${bytes.length} bytes`);
  };
  const u16 = p => { check(p, 2); return view.getUint16(p, little); };
  const u32 = p => { check(p, 4); return view.getUint32(p, little); };
  const word = p => {
    if (bits === 32) return u32(p);
    check(p, 8);
    const n = view.getBigUint64(p, little);
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) fail('ELF address exceeds safe integer range');
    return Number(n);
  };
  const headerSize = bits === 64 ? 64 : 52;
  check(0, headerSize);
  const machine = u16(18), type = u16(16), warnings = [];
  const result = { format: 'ELF', bits, endianness: little ? 'little' : 'big', machine,
    architecture: ARCHITECTURES.get(machine) ?? `machine-${machine}`, type,
    needed: [], soname: null, jniExports: [], jniOnLoad: false, dynamicSymbolsScanned: 0,
    symbolInspectionComplete: false, executed: false, warnings };
  const maxHeaders = bounded(options.maxHeaders, 1024, 4096);
  const maxSections = bounded(options.maxSections, 4096, 8192);
  const maxSymbols = bounded(options.maxSymbols, 100000, 250000);
  const maxJNIExports = bounded(options.maxJNIExports, 1024, 4096);
  const maxStringBytes = bounded(options.maxStringBytes, 8 * 1024 * 1024, 16 * 1024 * 1024);
  const loads = [];
  let dynamic = null;
  const phoff = word(bits === 64 ? 32 : 28), phsize = u16(bits === 64 ? 54 : 42), phnum = u16(bits === 64 ? 56 : 44);
  if (phnum > maxHeaders) fail('program-header count exceeds inspection limit');
  if (phnum && phsize < (bits === 64 ? 56 : 32)) fail('invalid program-header size');
  check(phoff, phnum * phsize);
  for (let i = 0; i < phnum; i++) {
    const p = phoff + i * phsize, kind = u32(p);
    const offset = word(p + (bits === 64 ? 8 : 4)), address = word(p + (bits === 64 ? 16 : 8));
    const size = word(p + (bits === 64 ? 32 : 16));
    check(offset, size);
    if (kind === 1) loads.push({ offset, address, size });
    if (kind === 2) dynamic = { offset, size };
  }
  const atAddress = (address, length = 1) => {
    const segment = loads.find(s => address >= s.address && address - s.address <= s.size - length);
    if (!segment) fail(`unmapped ELF virtual address ${address}`);
    return segment.offset + address - segment.address;
  };
  const text = (offset, limit) => {
    check(offset, limit);
    let end = offset;
    const cap = Math.min(offset + limit, offset + 4096);
    while (end < cap && bytes[end]) end++;
    if (end === cap) fail('unterminated/excessive ELF string');
    return new TextDecoder().decode(bytes.subarray(offset, end));
  };
  const tags = new Map(), neededOffsets = [];
  if (dynamic) {
    const width = bits === 64 ? 16 : 8;
    const count = Math.floor(dynamic.size / width);
    if (count > 8192) fail('dynamic entry count exceeds inspection limit');
    for (let i = 0; i < count; i++) {
      const p = dynamic.offset + i * width, tag = word(p), value = word(p + width / 2);
      if (!tag) break;
      if (tag === 1) { if (neededOffsets.length >= 256) fail('DT_NEEDED count exceeds limit'); neededOffsets.push(value); }
      else tags.set(tag, value);
    }
    if (tags.has(5) && tags.has(10)) {
      const size = tags.get(10);
      if (size > maxStringBytes) fail('dynamic string table exceeds limit');
      const start = atAddress(tags.get(5), size);
      const dynamicText = index => { if (index >= size) fail('invalid dynamic string offset'); return text(start + index, size - index); };
      result.needed = neededOffsets.map(dynamicText);
      if (tags.has(14)) result.soname = dynamicText(tags.get(14));
    } else if (neededOffsets.length) warnings.push('DT_NEEDED strings could not be resolved.');
  }
  const shoff = word(bits === 64 ? 40 : 32), shsize = u16(bits === 64 ? 58 : 46), shnum = u16(bits === 64 ? 60 : 48);
  const sections = [];
  if (shnum && shnum <= maxSections) {
    if (shsize < (bits === 64 ? 64 : 40)) fail('invalid section-header size');
    check(shoff, shnum * shsize);
    for (let i = 0; i < shnum; i++) {
      const p = shoff + i * shsize;
      sections.push({ type: u32(p + 4), offset: word(p + (bits === 64 ? 24 : 16)),
        size: word(p + (bits === 64 ? 32 : 20)), link: u32(p + (bits === 64 ? 40 : 24)),
        width: word(p + (bits === 64 ? 56 : 36)) });
    }
  } else if (shnum) warnings.push('Section count exceeds limit; dynamic symbol inspection skipped.');
  const symbolTables = [];
  for (const section of sections.filter(s => s.type === 11)) {
    const strings = sections[section.link];
    if (!strings || strings.type !== 3 || strings.size > maxStringBytes) fail('invalid/oversize dynamic symbol string table');
    check(strings.offset, strings.size); check(section.offset, section.size);
    symbolTables.push({ ...section, strings });
  }
  // Stripped files may retain only program headers and SysV/GNU hash metadata.
  if (!symbolTables.length && tags.has(6) && tags.has(5) && tags.has(10)) {
    let count = null;
    if (tags.has(4)) count = u32(atAddress(tags.get(4), 8) + 4);
    else if (tags.has(0x6ffffef5)) {
      const hash = atAddress(tags.get(0x6ffffef5), 16), buckets = u32(hash), firstSymbol = u32(hash + 4), bloomWords = u32(hash + 8);
      if (buckets > 250000 || bloomWords > 131072 || firstSymbol > 250000) fail('GNU hash header exceeds bounds');
      const bucketOffset = hash + 16 + bloomWords * (bits / 8);
      check(bucketOffset, buckets * 4);
      let last = 0;
      for (let i = 0; i < buckets; i++) last = Math.max(last, u32(bucketOffset + i * 4));
      if (last > 250000) fail('GNU hash symbol index exceeds bounds');
      if (!buckets || !last) count = firstSymbol;
      else {
        const chains = bucketOffset + buckets * 4;
        let scanned = 0;
        while (true) {
          if (last < firstSymbol || scanned++ >= maxSymbols) fail('GNU hash chain exceeds bounded scan');
          const value = u32(chains + (last - firstSymbol) * 4);
          last++;
          if (value & 1) { count = last; break; }
        }
      }
    }
    const width = tags.get(11) ?? (bits === 64 ? 24 : 16);
    const size = tags.get(10);
    if (size > maxStringBytes) fail('dynamic symbol strings exceed limit');
    if (count !== null) {
      if (count > maxSymbols) warnings.push('Dynamic symbol scan reached its limit.');
      const bounded = Math.min(count, maxSymbols);
      symbolTables.push({ offset: atAddress(tags.get(6), bounded * width), size: bounded * width, width,
        strings: { offset: atAddress(tags.get(5), size), size } });
    }
  }
  let exportedBytes = 0;
  for (const table of symbolTables) {
    if (table.width < (bits === 64 ? 24 : 16)) fail('invalid dynamic symbol entry width');
    const count = Math.floor(table.size / table.width);
    for (let i = 0; i < count; i++) {
      if (result.dynamicSymbolsScanned >= maxSymbols) { warnings.push('Dynamic symbol scan reached its limit.'); break; }
      result.dynamicSymbolsScanned++;
      const p = table.offset + i * table.width, name = u32(p), info = bytes[p + (bits === 64 ? 4 : 12)];
      const defined = u16(p + (bits === 64 ? 6 : 14)) !== 0;
      if (!defined || ![1, 2].includes(info >> 4) || ![0, 2].includes(info & 15) || !name) continue;
      if (name >= table.strings.size) fail('invalid symbol name offset');
      const value = text(table.strings.offset + name, table.strings.size - name);
      if (value === 'JNI_OnLoad') result.jniOnLoad = true;
      if (value.startsWith('Java_') || value === 'JNI_OnLoad' || value === 'JNI_OnUnload') {
        exportedBytes += value.length;
        if (result.jniExports.length >= maxJNIExports || exportedBytes > 1024 * 1024) { warnings.push('JNI export names reached their limit.'); break; }
        result.jniExports.push(value);
      }
    }
  }
  result.symbolInspectionComplete = symbolTables.length > 0 && !warnings.some(w => /scan reached|export names/.test(w));
  if (!symbolTables.length) warnings.push('No inspectable dynamic symbol table; JNI may also use dynamic registration.');
  return result;
}
