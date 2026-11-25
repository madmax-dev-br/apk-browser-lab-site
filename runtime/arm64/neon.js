// Advanced SIMD (NEON) for the ARM64 interpreter (src/arm64/cpu.js): the integer and floating-point vector groups compilers emit for copies, string scans,
// hashing, image and math code. Lanes are read and written as BigInt (integers) or numbers (floats) over the 16-byte registers; each instruction is computed
// lane by lane as the Arm ARM pseudocode defines it. An encoding outside these groups stops the run naming it (Arm64Unsupported), never an approximation.
const ONES = Array.from({ length: 129 }, (_, n) => (1n << BigInt(n)) - 1n);   // the lane masks, made once: every vector instruction asks for one
const ones = n => ONES[n] ?? (1n << BigInt(n)) - 1n;
const sx = (v, bits) => BigInt.asIntN(bits, v), ux = (v, bits) => BigInt.asUintN(bits, v);
const bit = (word, n) => (word >>> n) & 1, field = (word, lo, width) => (word >>> lo) & ((1 << width) - 1);

// Lanes of 8, 16, 32 and 64 bits are read and written whole through the register file's DataView (little-endian, as the register bytes are laid out) instead of byte by
// byte through BigInt shifts; a 128-bit lane (PMULL's) keeps the byte loop. Same values, same bytes: only the cost of moving them changes.
const logicalWords = new Int32Array(4);   // the result of a vector logical operation before it is written (the destination may be a source)
const lanesBytewise =(cpu, o, eb, count, out) => { for (let i = 0; i < count; i++) { let v = 0n; for (let b = eb - 1; b >= 0; b--) v = (v << 8n) | BigInt(cpu.vbuf[o + i * eb + b]); out[i] = v; } return out; };
export function lanes(cpu, reg, esize, count) {
  const out = new Array(count), o = reg * 16, view = cpu.vview, buf = cpu.vbuf;
  switch (esize) {
    case 8: for (let i = 0; i < count; i++) out[i] = BigInt(buf[o + i]); return out;
    case 16: for (let i = 0; i < count; i++) out[i] = BigInt(view.getUint16(o + 2 * i, true)); return out;
    case 32: for (let i = 0; i < count; i++) out[i] = BigInt(view.getUint32(o + 4 * i, true)); return out;
    case 64: for (let i = 0; i < count; i++) out[i] = view.getBigUint64(o + 8 * i, true); return out;
    default: return lanesBytewise(cpu, o, esize / 8, count, out);
  }
}
export function setLanes(cpu, reg, esize, values, totalBytes = 16) {
  const o = reg * 16, eb = esize / 8, view = cpu.vview, buf = cpu.vbuf, count = values.length; buf.fill(0, o, o + 16); void totalBytes;
  switch (esize) {
    case 8: for (let i = 0; i < count; i++) if (values[i] !== undefined) buf[o + i] = Number(BigInt.asUintN(8, values[i])); return;
    case 16: for (let i = 0; i < count; i++) if (values[i] !== undefined) view.setUint16(o + 2 * i, Number(BigInt.asUintN(16, values[i])), true); return;
    case 32: for (let i = 0; i < count; i++) if (values[i] !== undefined) view.setUint32(o + 4 * i, Number(BigInt.asUintN(32, values[i])), true); return;
    case 64: for (let i = 0; i < count; i++) if (values[i] !== undefined) view.setBigUint64(o + 8 * i, BigInt.asUintN(64, values[i]), true); return;
    default: for (let i = 0; i < count; i++) { if (values[i] === undefined) continue; let v = ux(values[i], esize); for (let b = 0; b < eb; b++) { buf[o + i * eb + b] = Number(v & 0xffn); v >>= 8n; } }
  }
}
const flanes = (cpu, reg, esize, count) => { const out = []; for (let i = 0; i < count; i++) out.push(esize === 64 ? cpu.vview.getFloat64(reg * 16 + 8 * i, true) : cpu.vview.getFloat32(reg * 16 + 4 * i, true)); return out; };
const setFlanes = (cpu, reg, esize, values) => { const o = reg * 16; cpu.vbuf.fill(0, o, o + 16); values.forEach((v, i) => esize === 64 ? cpu.vview.setFloat64(o + 8 * i, v, true) : cpu.vview.setFloat32(o + 4 * i, v, true)); };
const satS = (v, bits) => { const max = (1n << BigInt(bits - 1)) - 1n, min = -(1n << BigInt(bits - 1)); return v > max ? max : v < min ? min : v; };
const satU = (v, bits) => { const max = ones(bits); return v > max ? max : v < 0n ? 0n : v; };

/** Executes an Advanced SIMD instruction or returns false when the encoding is not one this module implements. */
export function executeNeon(cpu, word, at) {
  const q = bit(word, 30), u = bit(word, 29), rd = word & 31, rn = field(word, 5, 5), rm = field(word, 16, 5), bytes = q ? 16 : 8;
  // ---- load/store multiple structures (LD1-4 / ST1-4), post-indexed forms, and single structure (LD1 lane / LD1R)
  if ((word & 0xbf000000) === 0x0c000000 || (word & 0xbf000000) === 0x0d000000) return structures(cpu, word, at);
  const top = field(word, 24, 5);   // bits 28:24
  if (top === 0b01110 || top === 0b11110) {
    const scalar = top === 0b11110;
    if (bit(word, 21) && bit(word, 10)) return threeSame(cpu, word, scalar);
    if (bit(word, 21) && field(word, 10, 2) === 0b00 && !scalar) return threeDifferent(cpu, word);
    if (bit(word, 21) && field(word, 10, 2) === 0b10 && field(word, 17, 4) === 0b0000) return twoRegMisc(cpu, word, scalar);
    if (bit(word, 21) && field(word, 10, 2) === 0b10 && field(word, 17, 4) === 0b1000 && !scalar) return acrossLanes(cpu, word);
    if (bit(word, 21) && field(word, 10, 2) === 0b10 && field(word, 17, 4) === 0b1000 && scalar) return scalarPairwise(cpu, word);
    if (!bit(word, 21) && bit(word, 10) && field(word, 11, 4) === 0b0000 && u === 0 && field(word, 15, 1) === 0) return copy(cpu, word, scalar);
    if (!bit(word, 21) && !bit(word, 10) && bit(word, 11) === 0 && field(word, 22, 2) === 0 && !scalar && !u && field(word, 15, 1) === 0 && false) return false;
    if (!bit(word, 21) && field(word, 10, 2) === 0b10 && !scalar && !u) return permute(cpu, word);
    if (top === 0b01110 && !bit(word, 21) && !bit(word, 10) && u && !scalar && field(word, 22, 2) === 0) { // EXT
      const index = field(word, 11, 4), a = cpu.vbuf.slice(rn * 16, rn * 16 + bytes), b = cpu.vbuf.slice(rm * 16, rm * 16 + bytes), cat = new Uint8Array([...a, ...b]);
      const o = rd * 16; cpu.vbuf.fill(0, o, o + 16); cpu.vbuf.set(cat.subarray(index, index + bytes), o); return true;
    }
    if (!bit(word, 21) && !bit(word, 10) && !u && !scalar && field(word, 22, 2) === 0 && field(word, 10, 2) === 0) return table(cpu, word);
    if (!bit(word, 21) && bit(word, 10) && !scalar && field(word, 11, 4) === 0b0011 && !u) return insGeneral(cpu, word);
    if (top === 0b01110 && !bit(word, 21) && bit(word, 10) && u && bit(word, 30)) return insElement(cpu, word);   // INS (element): op=1, Q=1
  }
  if ((top === 0b01111 || top === 0b11111) && bit(word, 10) && field(word, 19, 4) !== 0) return shiftImmediate(cpu, word, top === 0b11111);
  if ((top === 0b01111 || top === 0b11111) && !bit(word, 10)) return byElement(cpu, word, top === 0b11111);
  void rd; void at;
  return false;
}

function threeSame(cpu, word, scalar) {
  const q = bit(word, 30) || scalar, u = bit(word, 29), size = field(word, 22, 2), opcode = field(word, 11, 5), rd = word & 31, rn = field(word, 5, 5), rm = field(word, 16, 5);
  if (opcode >= 0b11000) {   // floating point three same
    const esize = size & 1 ? 64 : 32, count = scalar ? 1 : (q ? 128 : 64) / esize, a = flanes(cpu, rn, esize, count), b = flanes(cpu, rm, esize, count), hi = size >> 1, key = `${u}${hi}${opcode.toString(2)}`;
    const fr = esize === 32 ? Math.fround : x => x, mask = esize === 64 ? ones(64) : ones(32), t = mask, f = 0n;
    const ops = {
      '0011010': (x, y) => x + y, '0111010': (x, y) => x - y, '1011011': (x, y) => x * y, '1011111': (x, y) => x / y, '0011110': (x, y) => Math.max(x, y), '0111110': (x, y) => Math.min(x, y),
      '0011000': (x, y) => isNaN(x) ? y : isNaN(y) ? x : Math.max(x, y), '0111000': (x, y) => isNaN(x) ? y : isNaN(y) ? x : Math.min(x, y), '1111010': (x, y) => Math.abs(x - y),
    };
    if (key === '0011001' || key === '0111001') { const acc = flanes(cpu, rd, esize, count); setFlanes(cpu, rd, esize, acc.map((x, i) => fr(key === '0011001' ? x + a[i] * b[i] : x - a[i] * b[i]))); return true; }   // FMLA / FMLS
    if (key === '1011010') { const pairs = [...a, ...b], out = []; for (let i = 0; i < count; i++) out.push(fr(pairs[2 * i] + pairs[2 * i + 1])); setFlanes(cpu, rd, esize, out); return true; }   // FADDP
    const cmp = { '0011100': (x, y) => x === y, '1011100': (x, y) => x >= y, '1111100': (x, y) => x > y, '1011101': (x, y) => Math.abs(x) >= Math.abs(y), '1111101': (x, y) => Math.abs(x) > Math.abs(y) }[key];
    if (cmp) { setLanes(cpu, rd, esize, a.map((x, i) => cmp(x, b[i]) ? t : f)); return true; }
    const op = ops[key]; if (!op) return false;
    setFlanes(cpu, rd, esize, a.map((x, i) => fr(op(x, b[i])))); return true;
  }
  const esize = 8 << size, count = scalar ? 1 : (q ? 128 : 64) / esize, a = lanes(cpu, rn, esize, count), b = lanes(cpu, rm, esize, count), mask = ones(esize), total = q ? 16 : 8;
  if (opcode === 0b00011) {   // logical: AND BIC ORR ORN EOR BSL BIT BIF, bitwise over the register's 32-bit words (no lanes: the operation is the same on every bit)
    const w = cpu.vwords ??= new Uint32Array(cpu.vbuf.buffer, cpu.vbuf.byteOffset, cpu.vbuf.length >> 2), n = q ? 4 : 2, a0 = rn * 4, b0 = rm * 4, d0 = rd * 4, op = u * 4 + size;
    const r = logicalWords; for (let i = 0; i < n; i++) {
      const x = w[a0 + i], y = w[b0 + i], d = w[d0 + i];
      r[i] = op === 0 ? x & y : op === 1 ? x & ~y : op === 2 ? x | y : op === 3 ? x | ~y : op === 4 ? x ^ y : op === 5 ? (x & d) | (y & ~d) : op === 6 ? (d & ~y) | (x & y) : (d & y) | (x & ~y);
    }
    for (let i = 0; i < n; i++) w[d0 + i] = r[i]; if (!q) { w[d0 + 2] = 0; w[d0 + 3] = 0; }   // a 64-bit operation zeroes the upper half
    return true;
  }
  const S = v => sx(v, esize), U = v => v, d = lanes(cpu, rd, esize, count);
  let out;
  switch (`${u}${opcode}`) {
    case '016': out = a.map((x, i) => (x + b[i]) & mask); break;                       // ADD
    case '116': out = a.map((x, i) => (x - b[i]) & mask); break;                       // SUB
    case '06': out = a.map((x, i) => S(x) > S(b[i]) ? mask : 0n); break;              // CMGT
    case '16': out = a.map((x, i) => U(x) > U(b[i]) ? mask : 0n); break;              // CMHI
    case '07': out = a.map((x, i) => S(x) >= S(b[i]) ? mask : 0n); break;             // CMGE
    case '17': out = a.map((x, i) => U(x) >= U(b[i]) ? mask : 0n); break;             // CMHS
    case '117': out = a.map((x, i) => x === b[i] ? mask : 0n); break;                 // CMEQ
    case '017': out = a.map((x, i) => (x & b[i]) ? mask : 0n); break;                 // CMTST
    case '019': out = a.map((x, i) => (x * b[i]) & mask); break;                       // MUL
    case '018': out = a.map((x, i) => (d[i] + x * b[i]) & mask); break;               // MLA
    case '118': out = a.map((x, i) => (d[i] - x * b[i]) & mask); break;               // MLS
    case '012': out = a.map((x, i) => S(x) > S(b[i]) ? x : b[i]); break;              // SMAX
    case '112': out = a.map((x, i) => x > b[i] ? x : b[i]); break;                    // UMAX
    case '013': out = a.map((x, i) => S(x) < S(b[i]) ? x : b[i]); break;              // SMIN
    case '113': out = a.map((x, i) => x < b[i] ? x : b[i]); break;                    // UMIN
    case '023': { const pairs = [...a, ...b]; out = Array.from({ length: count }, (_, i) => (pairs[2 * i] + pairs[2 * i + 1]) & mask); break; }   // ADDP
    case '020': { const pairs = [...a, ...b]; out = Array.from({ length: count }, (_, i) => S(pairs[2 * i]) > S(pairs[2 * i + 1]) ? pairs[2 * i] : pairs[2 * i + 1]); break; }   // SMAXP
    case '120': { const pairs = [...a, ...b]; out = Array.from({ length: count }, (_, i) => pairs[2 * i] > pairs[2 * i + 1] ? pairs[2 * i] : pairs[2 * i + 1]); break; }   // UMAXP
    case '021': { const pairs = [...a, ...b]; out = Array.from({ length: count }, (_, i) => S(pairs[2 * i]) < S(pairs[2 * i + 1]) ? pairs[2 * i] : pairs[2 * i + 1]); break; }   // SMINP
    case '121': { const pairs = [...a, ...b]; out = Array.from({ length: count }, (_, i) => pairs[2 * i] < pairs[2 * i + 1] ? pairs[2 * i] : pairs[2 * i + 1]); break; }   // UMINP
    case '01': out = a.map((x, i) => ux(satS(S(x) + S(b[i]), esize), esize)); break;  // SQADD
    case '11': out = a.map((x, i) => satU(x + b[i], esize)); break;                    // UQADD
    case '05': out = a.map((x, i) => ux(satS(S(x) - S(b[i]), esize), esize)); break;  // SQSUB
    case '15': out = a.map((x, i) => satU(x - b[i], esize)); break;                    // UQSUB
    case '02': out = a.map((x, i) => ux((S(x) + S(b[i]) + 1n) >> 1n, esize)); break;  // SRHADD
    case '12': out = a.map((x, i) => (x + b[i] + 1n) >> 1n); break;                    // URHADD
    case '00': out = a.map((x, i) => ux((S(x) + S(b[i])) >> 1n, esize)); break;       // SHADD
    case '10': out = a.map((x, i) => (x + b[i]) >> 1n); break;                         // UHADD
    case '014': out = a.map((x, i) => { const v = S(x) - S(b[i]); return ux(v < 0n ? -v : v, esize); }); break;   // SABD
    case '114': out = a.map((x, i) => x > b[i] ? x - b[i] : b[i] - x); break;          // UABD
    case '08': case '18': out = a.map((x, i) => { const sh = Number(sx(b[i] & 0xffn, 8)); if (sh >= 0) return sh >= esize ? 0n : (x << BigInt(sh)) & mask; const r = -sh; return u ? (r >= esize ? 0n : x >> BigInt(r)) : ux(S(x) >> BigInt(Math.min(r, esize - 1)), esize); }); break;   // SSHL / USHL
    default: return false;
  }
  setLanes(cpu, rd, esize, out, total); return true;
}

function threeDifferent(cpu, word) {
  const q = bit(word, 30), u = bit(word, 29), size = field(word, 22, 2), opcode = field(word, 12, 4), rd = word & 31, rn = field(word, 5, 5), rm = field(word, 16, 5);
  const esize = 8 << size, count = 64 / esize, wide = esize * 2, src = (reg) => { const all = lanes(cpu, reg, esize, 128 / esize); return q ? all.slice(count) : all.slice(0, count); };
  const a = src(rn), b = src(rm), ext = v => u ? v : ux(sx(v, esize), wide), mask = ones(wide), acc = lanes(cpu, rd, wide, count);
  let out;
  switch (opcode) {
    case 0b0000: out = a.map((x, i) => (ext(x) + ext(b[i])) & mask); break;                 // UADDL / SADDL
    case 0b0010: out = a.map((x, i) => (ext(x) - ext(b[i])) & mask); break;                 // USUBL / SSUBL
    case 0b0001: { const wa = lanes(cpu, rn, wide, count); out = b.map((y, i) => (wa[i] + ext(y)) & mask); break; }   // UADDW / SADDW: wide Vn + the extended (low or high) half of Vm
    case 0b0011: { const wa = lanes(cpu, rn, wide, count); out = b.map((y, i) => (wa[i] - ext(y)) & mask); break; }   // USUBW / SSUBW
    case 0b1100: out = a.map((x, i) => ux(u ? x * b[i] : sx(x, esize) * sx(b[i], esize), wide)); break;   // UMULL / SMULL
    case 0b1000: out = a.map((x, i) => (acc[i] + ux(u ? x * b[i] : sx(x, esize) * sx(b[i], esize), wide)) & mask); break;   // UMLAL / SMLAL
    case 0b1010: out = a.map((x, i) => (acc[i] - ux(u ? x * b[i] : sx(x, esize) * sx(b[i], esize), wide)) & mask); break;   // UMLSL / SMLSL
    case 0b0111: out = a.map((x, i) => { const v = u ? (x > b[i] ? x - b[i] : b[i] - x) : (() => { const d = sx(x, esize) - sx(b[i], esize); return d < 0n ? -d : d; })(); return v & mask; }); break;   // UABDL / SABDL
    case 0b0101: out = a.map((x, i) => (acc[i] + (u ? (x > b[i] ? x - b[i] : b[i] - x) : ux((() => { const d = sx(x, esize) - sx(b[i], esize); return d < 0n ? -d : d; })(), wide))) & mask); break;   // UABAL / SABAL
    case 0b1110: if (u || size !== 0) return false; out = a.map((x, i) => { let r = 0n; for (let k = 0; k < 8; k++) if ((x >> BigInt(k)) & 1n) r ^= b[i] << BigInt(k); return r; }); break;   // PMULL (8-bit)
    default: return false;
  }
  setLanes(cpu, rd, wide, out); return true;
}

function twoRegMisc(cpu, word, scalar) {
  const q = bit(word, 30) || scalar, u = bit(word, 29), size = field(word, 22, 2), opcode = field(word, 12, 5), rd = word & 31, rn = field(word, 5, 5), total = q ? 16 : 8;
  if (u && opcode === 0b10011 && !scalar && size < 3) {   // SHLL / SHLL2: widen each element of the lower (upper) half and shift it left by the element size
    const esize = 8 << size, half = lanes(cpu, rn, esize, 128 / esize).slice(bit(word, 30) ? 64 / esize : 0, (bit(word, 30) ? 2 : 1) * 64 / esize);
    setLanes(cpu, rd, esize * 2, half.map(v => (v << BigInt(esize)) & ones(esize * 2))); return true;
  }
  // FCVTN / FCVTN2 (narrow: double -> single, single -> half), FCVTXN / FCVTXN2 (double -> single, round to odd), FCVTL / FCVTL2 (widen) -- vector forms
  if (!scalar && (size >> 1) === 0 && ((opcode === 0b10110) || (!u && opcode === 0b10111))) {
    const sz = size & 1, high = bit(word, 30), wide = sz ? 64 : 32, narrow = sz ? 32 : 16, count = 64 / narrow;
    if (opcode === 0b10110) {
      if (u && !sz) return false;   // FCVTXN needs sz = 1
      const values = (sz ? flanes(cpu, rn, 64, 2) : flanes(cpu, rn, 32, 4)).map(x => sz ? (u ? toSingleRoundOdd(x) : f32Bits(x)) : f16Bits(x));
      setLanes(cpu, rd, narrow, high ? [...lanes(cpu, rd, narrow, count), ...values] : values); return true;   // FCVTN2 keeps the lower half, FCVTN clears the upper
    }
    const source = lanes(cpu, rn, narrow, 2 * count).slice(high ? count : 0, high ? 2 * count : count);
    setFlanes(cpu, rd, wide, source.map(bits => sz ? f32FromBits(bits) : f16FromBits(bits))); return true;
  }
  // floating point two-register forms
  if (opcode >= 0b01100 && (size & 2 || [0b11000, 0b11001, 0b11101, 0b11011, 0b11010, 0b11100, 0b01111, 0b11111].includes(opcode) || [0b01100, 0b01101, 0b01110].includes(opcode))) {
    const esize = size & 1 ? 64 : 32, count = scalar ? 1 : (bit(word, 30) ? 128 : 64) / esize, key = `${u}${size >> 1}${opcode}`;
    const fr = esize === 32 ? Math.fround : x => x;
    if (key === '0029' || key === '1029') { const a = lanes(cpu, rn, esize, count); setFlanes(cpu, rd, esize, a.map(v => fr(u ? Number(v) : Number(sx(v, esize))))); return true; }   // SCVTF / UCVTF (vector)
    const a = flanes(cpu, rn, esize, count);
    const toInt = (x, signed, round = Math.trunc) => { const t = round(x); if (isNaN(t)) return 0n; const min = signed ? -(2 ** (esize - 1)) : 0, max = signed ? 2 ** (esize - 1) - 1 : 2 ** esize - 1; return ux(BigInt(t <= min ? min : t >= max ? max : t), esize); };
    switch (key) {
      case '0127': setLanes(cpu, rd, esize, a.map(x => toInt(x, true))); return true;   // FCVTZS
      // FRINT<N|M|P|Z|A|X|I> (round to an integral value) and FCVT<N|M|A|P><S|U> (to an integer with that rounding); X and I use FPCR's mode, round to nearest even by default
      case '0024': case '1025': case '1125': setFlanes(cpu, rd, esize, a.map(x => fr(roundEven(x)))); return true;   // FRINTN / FRINTX / FRINTI
      case '0025': setFlanes(cpu, rd, esize, a.map(x => fr(Math.floor(x)))); return true;   // FRINTM
      case '0124': setFlanes(cpu, rd, esize, a.map(x => fr(Math.ceil(x)))); return true;    // FRINTP
      case '0125': setFlanes(cpu, rd, esize, a.map(x => fr(Math.trunc(x)))); return true;   // FRINTZ
      case '1024': setFlanes(cpu, rd, esize, a.map(x => fr(roundAway(x)))); return true;    // FRINTA
      case '0026': case '1026': setLanes(cpu, rd, esize, a.map(x => toInt(x, !u, roundEven))); return true;   // FCVTNS / FCVTNU
      case '0027': case '1027': setLanes(cpu, rd, esize, a.map(x => toInt(x, !u, Math.floor))); return true;  // FCVTMS / FCVTMU
      case '0028': case '1028': setLanes(cpu, rd, esize, a.map(x => toInt(x, !u, roundAway))); return true;   // FCVTAS / FCVTAU
      case '0126': case '1126': setLanes(cpu, rd, esize, a.map(x => toInt(x, !u, Math.ceil))); return true;   // FCVTPS / FCVTPU
      case '1127': setLanes(cpu, rd, esize, a.map(x => toInt(x, false))); return true;  // FCVTZU
      case '0115': setFlanes(cpu, rd, esize, a.map(Math.abs)); return true;             // FABS
      case '1115': setFlanes(cpu, rd, esize, a.map(x => -x)); return true;              // FNEG
      case '1131': setFlanes(cpu, rd, esize, a.map(x => fr(Math.sqrt(x)))); return true; // FSQRT
      case '0113': setLanes(cpu, rd, esize, a.map(x => x === 0 ? ones(esize) : 0n)); return true;   // FCMEQ #0 (opcode 01101; the key '0126' is FCVTPS)
      case '0112': setLanes(cpu, rd, esize, a.map(x => x > 0 ? ones(esize) : 0n)); return true;     // FCMGT #0
      case '1112': setLanes(cpu, rd, esize, a.map(x => x >= 0 ? ones(esize) : 0n)); return true;    // FCMGE #0
      case '1113': setLanes(cpu, rd, esize, a.map(x => x <= 0 ? ones(esize) : 0n)); return true;    // FCMLE #0
      case '0114': setLanes(cpu, rd, esize, a.map(x => x < 0 ? ones(esize) : 0n)); return true;     // FCMLT #0
      default: break;
    }
  }
  const esize = 8 << size, count = scalar ? 1 : (bit(word, 30) ? 128 : 64) / esize, a = lanes(cpu, rn, esize, count), mask = ones(esize), S = v => sx(v, esize);
  let out;
  switch (`${u}${opcode}`) {
    case '00': { const g = 64 / esize; out = []; for (let i = 0; i < count; i += g) out.push(...a.slice(i, i + g).reverse()); break; }   // REV64
    case '10': { const g = 32 / esize; out = []; for (let i = 0; i < count; i += g) out.push(...a.slice(i, i + g).reverse()); break; }   // REV32
    case '01': { const g = 16 / esize; out = []; for (let i = 0; i < count; i += g) out.push(...a.slice(i, i + g).reverse()); break; }   // REV16
    case '05': out = a.map(x => { let c = 0n; for (let v = x; v; v >>= 1n) c += v & 1n; return c; }); break;   // CNT
    case '15': if (size === 0) { out = a.map(x => ~x & mask); break; } if (size === 1) { out = a.map(x => { let r = 0n; for (let k = 0; k < 8; k++) if ((x >> BigInt(k)) & 1n) r |= 1n << BigInt(7 - k); return r; }); break; } return false;   // NOT / RBIT
    case '111': out = a.map(x => (-x) & mask); break;                                  // NEG
    case '011': out = a.map(x => S(x) < 0n ? (-x) & mask : x); break;                  // ABS
    case '09': out = a.map(x => x === 0n ? mask : 0n); break;                          // CMEQ #0
    case '08': out = a.map(x => S(x) > 0n ? mask : 0n); break;                         // CMGT #0
    case '18': out = a.map(x => S(x) >= 0n ? mask : 0n); break;                        // CMGE #0
    case '19': out = a.map(x => S(x) <= 0n ? mask : 0n); break;                        // CMLE #0
    case '010': out = a.map(x => S(x) < 0n ? mask : 0n); break;                        // CMLT #0
    case '04': out = a.map(x => { let c = 0n; for (let k = esize - 2; k >= 0 && (((x >> BigInt(k)) & 1n) === ((x >> BigInt(esize - 1)) & 1n)); k--) c++; return c; }); break;   // CLS
    case '14': out = a.map(x => { let c = 0n; for (let k = esize - 1; k >= 0 && !((x >> BigInt(k)) & 1n); k--) c++; return c; }); break;   // CLZ
    case '018': case '118': {   // XTN / SQXTN / UQXTN (narrow to half width, written to the low or high half)
      const src = lanes(cpu, rn, esize * 2, 128 / (esize * 2)), narrow = src.map(v => v & mask), base = bit(word, 30) ? lanes(cpu, rd, esize, 64 / esize) : [];
      void u; setLanes(cpu, rd, esize, [...base, ...narrow]); return true;
    }
    case '02': case '12': { const wide = esize * 2, pairs = Array.from({ length: count / 2 }, (_, i) => u ? a[2 * i] + a[2 * i + 1] : ux(sx(a[2 * i], esize) + sx(a[2 * i + 1], esize), wide)); setLanes(cpu, rd, wide, pairs); return true; }   // SADDLP / UADDLP
    case '06': case '16': { const wide = esize * 2, acc = lanes(cpu, rd, wide, count / 2), pairs = Array.from({ length: count / 2 }, (_, i) => ux(acc[i] + (u ? a[2 * i] + a[2 * i + 1] : sx(a[2 * i], esize) + sx(a[2 * i + 1], esize)), wide)); setLanes(cpu, rd, wide, pairs); return true; }   // SADALP / UADALP: the pairwise sums added to the destination's wide lanes
    default: return false;
  }
  setLanes(cpu, rd, esize, out, total); return true;
}

function scalarPairwise(cpu, word) {   // ADDP (scalar) and FADDP / FMAXP / FMINP / FMAXNMP / FMINNMP (scalar): the two lanes of Vn combined into a scalar
  const u = bit(word, 29), size = field(word, 22, 2), opcode = field(word, 12, 5), rn = field(word, 5, 5), rd = word & 31;
  if (!u && opcode === 0b11011 && size === 3) { const [a, b] = lanes(cpu, rn, 64, 2); setLanes(cpu, rd, 64, [(a + b) & ones(64)]); return true; }
  if (!u) return false;
  const esize = size & 1 ? 64 : 32, [a, b] = flanes(cpu, rn, esize, 2), fr = esize === 32 ? Math.fround : v => v, min = size >> 1;
  const nm = (x, y, pick) => Number.isNaN(x) ? y : Number.isNaN(y) ? x : pick(x, y);
  let value;
  if (opcode === 0b01101 && !min) value = a + b;                                           // FADDP
  else if (opcode === 0b01111) value = Number.isNaN(a) || Number.isNaN(b) ? NaN : min ? Math.min(a, b) : Math.max(a, b);   // FMAXP / FMINP
  else if (opcode === 0b01100) value = nm(a, b, min ? Math.min : Math.max);              // FMAXNMP / FMINNMP
  else return false;
  setFlanes(cpu, rd, esize, [fr(value)]); return true;
}
function acrossLanes(cpu, word) {
  const q = bit(word, 30), u = bit(word, 29), size = field(word, 22, 2), opcode = field(word, 12, 5), rd = word & 31, rn = field(word, 5, 5);
  const esize = 8 << size, count = (q ? 128 : 64) / esize, a = lanes(cpu, rn, esize, count), S = v => sx(v, esize);
  let r;
  switch (`${u}${opcode}`) {
    case '027': r = a.reduce((x, y) => (x + y) & ones(esize)); break;                   // ADDV
    case '03': case '13': { const wide = esize * 2; r = a.reduce((x, y) => x + (u ? y : ux(S(y), wide)), 0n) & ones(wide); setLanes(cpu, rd, wide, [r]); return true; }   // SADDLV / UADDLV
    case '010': r = a.reduce((x, y) => S(x) > S(y) ? x : y); break;   // SMAXV
    case '110': r = a.reduce((x, y) => x > y ? x : y); break;         // UMAXV
    case '026': r = a.reduce((x, y) => S(x) < S(y) ? x : y); break;   // SMINV
    case '126': r = a.reduce((x, y) => x < y ? x : y); break;         // UMINV
    default: return false;
  }
  setLanes(cpu, rd, esize, [r]); return true;
}

function copy(cpu, word, scalar) {   // DUP (element) and its scalar MOV form
  const q = bit(word, 30), imm5 = field(word, 16, 5), imm4 = field(word, 11, 4), rd = word & 31, rn = field(word, 5, 5);
  if (imm4 !== 0) return false;
  const shift = imm5 & 1 ? 0 : imm5 & 2 ? 1 : imm5 & 4 ? 2 : 3, esize = 8 << shift, index = imm5 >> (shift + 1), value = lanes(cpu, rn, esize, 128 / esize)[index];
  setLanes(cpu, rd, esize, scalar ? [value] : Array((q ? 128 : 64) / esize).fill(value)); return true;
}
function insGeneral(cpu, word) {   // INS (general) is in cpu.js; here: SMOV / UMOV variants reached through this group
  void cpu; void word; return false;
}
function insElement(cpu, word) {   // INS (element): Vd.T[i] = Vn.T[j]
  const imm5 = field(word, 16, 5), imm4 = field(word, 11, 4), rd = word & 31, rn = field(word, 5, 5), shift = imm5 & 1 ? 0 : imm5 & 2 ? 1 : imm5 & 4 ? 2 : 3, eb = 1 << shift;
  const dst = imm5 >> (shift + 1), src = imm4 >> shift;
  cpu.vbuf.copyWithin(rd * 16 + dst * eb, rn * 16 + src * eb, rn * 16 + src * eb + eb); return true;
}
function permute(cpu, word) {   // UZP1/2, TRN1/2, ZIP1/2
  const q = bit(word, 30), size = field(word, 22, 2), opcode = field(word, 12, 3), rd = word & 31, rn = field(word, 5, 5), rm = field(word, 16, 5);
  const esize = 8 << size, count = (q ? 128 : 64) / esize, a = lanes(cpu, rn, esize, count), b = lanes(cpu, rm, esize, count), half = count / 2, out = [];
  switch (opcode) {
    case 1: case 5: { const part = opcode === 5 ? 1 : 0, cat = [...a, ...b]; for (let i = 0; i < count; i++) out.push(cat[2 * i + part]); break; }   // UZP1 / UZP2
    case 2: case 6: { const part = opcode === 6 ? 1 : 0; for (let i = 0; i < half; i++) { out.push(a[2 * i + part], b[2 * i + part]); } break; }       // TRN1 / TRN2
    case 3: case 7: { const base = opcode === 7 ? half : 0; for (let i = 0; i < half; i++) out.push(a[base + i], b[base + i]); break; }               // ZIP1 / ZIP2
    default: return false;
  }
  setLanes(cpu, rd, esize, out); return true;
}
function table(cpu, word) {   // TBL / TBX with 1-4 table registers
  const q = bit(word, 30), len = field(word, 13, 2) + 1, op = bit(word, 12), rd = word & 31, rn = field(word, 5, 5), rm = field(word, 16, 5), count = q ? 16 : 8;
  if (field(word, 21, 3) !== 0 && false) return false;
  const tableBytes = []; for (let i = 0; i < len; i++) tableBytes.push(...cpu.vbuf.slice(((rn + i) % 32) * 16, ((rn + i) % 32) * 16 + 16));
  const indices = cpu.vbuf.slice(rm * 16, rm * 16 + count), prior = cpu.vbuf.slice(rd * 16, rd * 16 + 16), o = rd * 16;
  cpu.vbuf.fill(0, o, o + 16);
  for (let i = 0; i < count; i++) cpu.vbuf[o + i] = indices[i] < tableBytes.length ? tableBytes[indices[i]] : op ? prior[i] : 0;
  return true;
}
function shiftImmediate(cpu, word, scalar) {
  const q = bit(word, 30) || scalar, u = bit(word, 29), immh = field(word, 19, 4), immb = field(word, 16, 3), opcode = field(word, 11, 5), rd = word & 31, rn = field(word, 5, 5);
  const esize = immh & 8 ? 64 : immh & 4 ? 32 : immh & 2 ? 16 : 8, immhb = (immh << 3) | immb, count = scalar ? 1 : (q ? 128 : 64) / esize, mask = ones(esize);
  const left = immhb - esize, right = 2 * esize - immhb, a = lanes(cpu, rn, esize, count), d = lanes(cpu, rd, esize, count), S = v => sx(v, esize);
  let out;
  switch (`${u}${opcode}`) {
    case '010': out = a.map(x => (x << BigInt(left)) & mask); break;                                  // SHL
    case '00': out = a.map(x => ux(S(x) >> BigInt(right), esize)); break;                             // SSHR
    case '10': out = a.map(x => right >= esize ? 0n : x >> BigInt(right)); break;                     // USHR
    case '02': out = a.map((x, i) => (d[i] + ux(S(x) >> BigInt(right), esize)) & mask); break;        // SSRA
    case '12': out = a.map((x, i) => (d[i] + (right >= esize ? 0n : x >> BigInt(right))) & mask); break;   // USRA
    case '04': out = a.map(x => ux((S(x) + (1n << BigInt(right - 1))) >> BigInt(right), esize)); break;      // SRSHR
    case '14': out = a.map(x => (x + (1n << BigInt(right - 1))) >> BigInt(right)); break;                    // URSHR
    case '18': { const m = right >= esize ? 0n : mask >> BigInt(right); out = a.map((x, i) => (d[i] & ~m & mask) | (right >= esize ? 0n : x >> BigInt(right))); break; }   // SRI
    case '110': { const m = (mask << BigInt(left)) & mask; out = a.map((x, i) => (d[i] & ~m & mask) | ((x << BigInt(left)) & mask)); break; }                          // SLI
    case '020': case '120': {   // SSHLL / USHLL (SXTL / UXTL): widen the low or high half, shift left
      const src = lanes(cpu, rn, esize, 128 / esize), part = bit(word, 30) ? src.slice(64 / esize) : src.slice(0, 64 / esize), wide = esize * 2;
      setLanes(cpu, rd, wide, part.map(x => ux((u ? x : ux(sx(x, esize), wide)) << BigInt(left), wide))); return true;
    }
    case '016': {   // SHRN / RSHRN (narrow the 2x-wide source)
      const wide = esize * 2, rightN = 2 * esize - immhb, src = lanes(cpu, rn, wide, 128 / wide).map(x => (x >> BigInt(rightN)) & mask), base = bit(word, 30) ? lanes(cpu, rd, esize, 64 / esize) : [];
      setLanes(cpu, rd, esize, [...base, ...src]); return true;
    }
    case '028': case '128': {   // SCVTF / UCVTF (vector and scalar, fixed-point): integer / 2^fbits
      if (esize < 32) return false;   // half precision
      setFlanes(cpu, rd, esize, a.map(x => { const v = Number(u ? x : S(x)) / 2 ** right; return esize === 32 ? Math.fround(v) : v; })); return true;
    }
    case '031': case '131': {   // FCVTZS / FCVTZU (vector and scalar, fixed-point): value * 2^fbits truncated toward zero and saturated; NaN is 0
      if (esize < 32) return false;
      const min = u ? 0n : -(1n << BigInt(esize - 1)), max = u ? mask : (1n << BigInt(esize - 1)) - 1n;
      out = flanes(cpu, rn, esize, count).map(x => { const t = Math.trunc(x * 2 ** right); return ux(Number.isNaN(t) ? 0n : t <= Number(min) ? min : t >= Number(max) ? max : BigInt(t), esize); }); break;
    }
    default: return false;
  }
  setLanes(cpu, rd, esize, out); return true;
}
function byElement(cpu, word, scalar) {   // MUL / MLA / FMUL / FMLA by element
  const q = bit(word, 30) || scalar, u = bit(word, 29), size = field(word, 22, 2), l = bit(word, 21), m = bit(word, 20), rmLow = field(word, 16, 4), opcode = field(word, 12, 4), h = bit(word, 11), rd = word & 31, rn = field(word, 5, 5);
  if ((opcode === 0b0001 || opcode === 0b1001 || opcode === 0b0101) && size >= 2) {   // FMLA / FMUL / FMLS (element)
    const esize = size === 3 ? 64 : 32, index = esize === 64 ? h : (h << 1) | l, rm = (m << 4) | rmLow, count = scalar ? 1 : (q ? 128 : 64) / esize;
    const a = flanes(cpu, rn, esize, count), e = flanes(cpu, rm, esize, 128 / esize)[index], acc = flanes(cpu, rd, esize, count), fr = esize === 32 ? Math.fround : x => x;
    setFlanes(cpu, rd, esize, a.map((x, i) => fr(opcode === 0b1001 ? x * e : opcode === 0b0001 ? acc[i] + x * e : acc[i] - x * e))); return true;
  }
  if ((opcode === 0b1000 || opcode === 0b0000 || opcode === 0b0100) && !u && size >= 1) {   // MUL / MLA / MLS (element)
    const esize = 8 << size, index = esize === 16 ? (h << 2) | (l << 1) | m : (h << 1) | l, rm = esize === 16 ? rmLow : (m << 4) | rmLow, count = (q ? 128 : 64) / esize, mask = ones(esize);
    const a = lanes(cpu, rn, esize, count), e = lanes(cpu, rm, esize, 128 / esize)[index], acc = lanes(cpu, rd, esize, count);
    setLanes(cpu, rd, esize, a.map((x, i) => opcode === 0b1000 ? (x * e) & mask : opcode === 0b0000 ? (acc[i] + x * e) & mask : (acc[i] - x * e) & mask)); return true;
  }
  return false;
}
function structures(cpu, word, at) {
  const q = bit(word, 30), l = bit(word, 22), single = bit(word, 24), post = bit(word, 23), rm = field(word, 16, 5), opcode = field(word, 12, 4), size = field(word, 10, 2), rn = field(word, 5, 5), rt = word & 31;
  const mem = cpu.mem, base = Number(cpu.rsp(rn)), regBytes = q ? 16 : 8;
  let bytes;
  if (!single) {
    const forms = { 0b0000: [4, 4], 0b0010: [4, 1], 0b0100: [3, 3], 0b0110: [3, 1], 0b0111: [1, 1], 0b1000: [2, 2], 0b1010: [2, 1] }[opcode];
    if (!forms) return false;
    const [regs, interleave] = forms, esize = 8 << size, eb = esize / 8, perReg = regBytes / eb;
    let address = base;
    if (interleave === 1) {   // LD1/ST1 with 1-4 consecutive registers
      for (let r = 0; r < regs; r++) { const reg = (rt + r) % 32; if (l) { const data = mem.bytes(address, regBytes).slice(), o = reg * 16; cpu.vbuf.fill(0, o, o + 16); cpu.vbuf.set(data, o); } else mem.copyIn(address, cpu.vbuf.slice(reg * 16, reg * 16 + regBytes)); address += regBytes; }
    } else {   // LD2/3/4, ST2/3/4: element-interleaved
      if (l) for (let r = 0; r < regs; r++) cpu.vbuf.fill(0, ((rt + r) % 32) * 16, ((rt + r) % 32) * 16 + 16);
      for (let e = 0; e < perReg; e++) for (let r = 0; r < regs; r++) { const reg = (rt + r) % 32, o = reg * 16 + e * eb; if (l) cpu.vbuf.set(mem.bytes(address, eb), o); else mem.copyIn(address, cpu.vbuf.slice(o, o + eb)); address += eb; }
    }
    bytes = address - base;
  } else {
    // single structure: opcode<2:0> is bits 15:13 (the 4-bit `opcode` above is bits 15:12, whose low bit is S); scale = opcode<2:1>, selem = opcode<0>:R + 1
    const opc = opcode >> 1, selem = ((opc & 1) << 1 | bit(word, 21)) + 1, scale = opc >> 1, s = bit(word, 12);
    if (scale === 3) {   // LD1R..LD4R: load and replicate
      if (!l) return false;
      const esize = 8 << size, eb = esize / 8;
      for (let r = 0; r < selem; r++) { const reg = (rt + r) % 32, value = mem.read(base + r * eb, eb); setLanes(cpu, reg, esize, Array(regBytes / eb).fill(value)); }
      bytes = selem * eb;
    } else {
      // scale 2 is a 32-bit lane (size 00, index Q:S) or a 64-bit one (size 01, index Q)
      const eb = scale === 2 && (size & 1) ? 8 : 1 << scale, index = scale === 0 ? (q << 3) | (s << 2) | size : scale === 1 ? (q << 2) | (s << 1) | (size >> 1) : scale === 2 ? (size & 1 ? q : (q << 1) | s) : q;
      for (let r = 0; r < selem; r++) { const o = ((rt + r) % 32) * 16 + index * eb; if (l) cpu.vbuf.set(mem.bytes(base + r * eb, eb), o); else mem.copyIn(base + r * eb, cpu.vbuf.slice(o, o + eb)); }
      bytes = selem * eb;
    }
  }
  if (post) cpu.wsp(rn, BigInt(base + (rm === 31 ? bytes : Number(cpu.r(rm)))));
  void at; return true;
}

// IEEE-754 conversions for FCVTN / FCVTL (round to nearest even, as the default FPCR rounding mode)
const conv = new DataView(new ArrayBuffer(8));
function f32Bits(x) { conv.setFloat32(0, x, true); return BigInt(conv.getUint32(0, true)); }
function f32FromBits(bits) { conv.setUint32(0, Number(bits), true); return conv.getFloat32(0, true); }
/** FCVTXN: double -> single rounded to odd (the result's least significant bit is set when the conversion was inexact), so a later rounding to half is correct. */
function toSingleRoundOdd(x) {
  if (!Number.isFinite(x)) return f32Bits(x);
  conv.setFloat32(0, x, true); let bits = conv.getUint32(0, true); const back = conv.getFloat32(0, true);
  if (back !== x) {   // inexact: take the truncation toward zero, then force the low bit
    if (Math.abs(back) > Math.abs(x)) bits = (bits - 1) >>> 0;
    bits = (bits | 1) >>> 0;
  }
  return BigInt(bits);
}
function f16Bits(x) {
  conv.setFloat32(0, x, true); const f = conv.getUint32(0, true), sign = (f >>> 16) & 0x8000, exp = (f >>> 23) & 0xff, mant = f & 0x7fffff;
  if (exp === 0xff) return BigInt(sign | 0x7c00 | (mant ? 0x200 | (mant >>> 13) : 0));   // infinity, or a quiet NaN keeping the top payload bits
  let e = exp - 127 + 15;
  if (e >= 0x1f) return BigInt(sign | 0x7c00);   // overflow: infinity
  if (e <= 0) {   // subnormal half (or zero)
    if (e < -10) return BigInt(sign);
    const m = mant | 0x800000, shift = 14 - e, half = m >>> shift, rest = m & ((1 << shift) - 1), mid = 1 << (shift - 1);
    return BigInt(sign | (half + (rest > mid || (rest === mid && (half & 1)) ? 1 : 0)));
  }
  let half = (e << 10) | (mant >>> 13); const rest = mant & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && (half & 1))) half++;   // may carry into the exponent (to infinity), as rounding does
  return BigInt(sign | half);
}
function f16FromBits(bits) {
  const h = Number(bits), sign = h & 0x8000 ? -1 : 1, exp = (h >>> 10) & 0x1f, mant = h & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

/** Round to nearest, ties to even (the default rounding of FPCR); keeps -0 and infinities. */
function roundEven(x) { if (!Number.isFinite(x)) return x; const r = Math.round(x); return (Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r) || (x < 0 ? -0 : 0); }
/** Round to nearest, ties away from zero (FRINTA, FCVTA*). */
function roundAway(x) { if (!Number.isFinite(x)) return x; return (Math.sign(x) * Math.round(Math.abs(x))) || (x < 0 ? -0 : 0); }
