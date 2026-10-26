import { VMClock } from './vm-clock.js?v=f2127a72f766';
import { charsetRegistryCreation, charsetRegistryRegistration } from './charset-native.js?v=f2127a72f766';
import { canonicalCharset, decodeBytes, encodeString, SUPPORTED_CODECS } from './string-codec.js?v=f2127a72f766';
import { androidCharacterDirectionality } from './unicode-bidi-data.js?v=f2127a72f766';
import { textLayoutRegistryBridge, TEXT_LAYOUT_CLEANER } from './text-layout-native.js?v=f2127a72f766';
import { ICU_BREAK, ICU_BREAK_INSTANCE, ICU_BREAK_KEYS, invokeICUBreak } from './icu-break-host.js?v=f2127a72f766';
import { COLOR_FILTER_CLEANER, colorFilterRegistryBridge } from './color-filter-native.js?v=f2127a72f766';
import { RENDER_NODE_CLEANER, renderNodeRegistryBridge } from './rendernode-native.js?v=f2127a72f766';
import { REGEX_CLEANER, regexRegistryBridge } from './regex-native.js?v=f2127a72f766';
import { APKError } from './apk-error.js?v=f2127a72f766';
import { PendingCall, Invoke, runNested, runSlice, bindSupport, currentThread, JIT_THRESHOLD, JIT_LOOPS } from './interpreter.js?v=f2127a72f766';
import { Scheduler, Blocked } from './scheduler.js?v=f2127a72f766';
import { bootClassLacksMember } from './boot-class-members.js?v=f2127a72f766';
export { APKError } from './apk-error.js?v=f2127a72f766';

/* A bounded, local DEX interpreter. Android callbacks execute their original instructions. */
const fail = message => { throw new APKError(message); };
const NO_INDEX = 0xffffffff;
export class JavaException extends APKError {
  constructor(value, message, details = null) { super(message, details); this.name = 'JavaException'; this.value = value; }
}

export class BinaryReader {
  constructor(input) {
    this.bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.length = this.bytes.length;
  }
  check(offset, size = 1) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset > this.length - size)
      fail(`Malformed input: range ${offset}+${size} exceeds ${this.length}`);
  }
  u8(p) { this.check(p); return this.view.getUint8(p); }
  u16(p) { this.check(p, 2); return this.view.getUint16(p, true); }
  u32(p) { this.check(p, 4); return this.view.getUint32(p, true); }
  slice(p, n) { this.check(p, n); return this.bytes.subarray(p, p + n); }
  // The table must fit in the file; ART has no separate entry-count cap.
  table(n, p, width) { this.check(p, n * width); }
  uleb(cursor) {
    let value = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      const b = this.u8(cursor.p++);
      if (shift === 28 && b > 15) fail('Malformed ULEB128');
      value += (b & 127) * 2 ** shift;
      if (!(b & 128)) return value;
    }
    fail('Malformed ULEB128');
  }
  sleb(cursor) {
    let value = 0, shift = 0, byte;
    do {
      if (shift >= 35) fail('Malformed SLEB128');
      byte = this.u8(cursor.p++); value |= (byte & 127) << shift; shift += 7;
    } while (byte & 128);
    if (shift < 32 && byte & 64) value |= -1 << shift;
    return value | 0;
  }
}

function utf16String(units) {
  let result = '';
  for (let i = 0; i < units.length; i += 8192) result += String.fromCharCode(...units.slice(i, i + 8192));
  return result;
}
const methodKey = m => `${m.owner}->${m.name}${m.signature}`;
const fieldKey = f => `${f.owner}->${f.name}:${f.type}`;

export class DexFile {
  constructor(input, { filename = 'classes.dex', maxBytes = 64 * 1024 * 1024, typeRename = null } = {}) {
    this.filename = filename;
    const b = this.reader = new BinaryReader(input);
    if (b.length < 112 || b.length > maxBytes) fail(`Invalid DEX size (maximum ${maxBytes / 1024 / 1024} MiB): ${filename}`);
    const magic = String.fromCharCode(...b.slice(0, 8));
    if (!/^dex\n0(35|36|37|38|39|40)\0$/.test(magic)) fail('Unsupported DEX magic/version; expected dex 035–040');
    if (b.u32(32) !== b.length || b.u32(36) !== 112 || b.u32(40) !== 0x12345678) fail('Malformed DEX header or byte order');
    const table = (p, width) => { const n = b.u32(p), offset = b.u32(p + 4); b.table(n, offset, width); return [n, offset]; };
    const indexed = (list, i, name) => { if (i >= list.length) fail(`Invalid DEX ${name} index ${i}`); return list[i]; };
    const [sn, so] = table(56, 4);
    this.strings = [];
    for (let i = 0; i < sn; i++) {
      const c = { p: b.u32(so + i * 4) }, size = b.uleb(c);
      // Each UTF-16 unit takes at least one MUTF-8 byte, so the file itself bounds every string.
      if (size > b.length - c.p) fail('DEX string is longer than its file');
      const units = [];
      while (true) {
        const a = b.u8(c.p++);
        if (!a) break;
        let unit;
        if (a < 128) unit = a;
        else if ((a & 0xe0) === 0xc0) {
          const z = b.u8(c.p++);
          if ((z & 0xc0) !== 0x80) fail('Malformed DEX MUTF-8');
          unit = ((a & 31) << 6) | (z & 63);
          if (unit < 128 && !(a === 0xc0 && z === 0x80)) fail('Overlong DEX MUTF-8');
        } else if ((a & 0xf0) === 0xe0) {
          const z = b.u8(c.p++), q = b.u8(c.p++);
          if ((z & 0xc0) !== 0x80 || (q & 0xc0) !== 0x80) fail('Malformed DEX MUTF-8');
          unit = ((a & 15) << 12) | ((z & 63) << 6) | (q & 63);
          if (unit < 0x800) fail('Overlong DEX MUTF-8');
        } else fail('Malformed DEX MUTF-8');
        units.push(unit);
        if (units.length > size) fail('DEX string length mismatch');
      }
      if (units.length !== size) fail('DEX string length mismatch');
      this.strings.push(utf16String(units));
    }
    const string = i => indexed(this.strings, i, 'string');
    const [tn, to] = table(64, 4);
    // typeRename lets a ClassLoader define a second copy of a class under an alias descriptor: every type reference of this DEX (instructions,
    // method/field refs, supertypes, annotations) is read from this table, so renaming here re-binds the whole DEX to its own copies.
    this.types = Array.from({ length: tn }, (_, i) => { const t = string(b.u32(to + i * 4)); return typeRename ? typeRename(t) : t; });
    const type = i => indexed(this.types, i, 'type');
    // Protos and classes may share one type_list; parse each offset once so shared lists cost nothing extra.
    const typeLists = new Map();
    const typeList = offset => {
      if (!offset) return [];
      let list = typeLists.get(offset);
      if (!list) {
        const n = b.u32(offset); b.table(n, offset + 4, 2);
        list = Array.from({ length: n }, (_, i) => type(b.u16(offset + 4 + i * 2)));
        typeLists.set(offset, list);
      }
      return list.slice();
    };
    const [pn, po] = table(72, 12), protos = [];
    for (let i = 0; i < pn; i++) {
      const p = po + i * 12, parameters = typeList(b.u32(p + 8)), result = type(b.u32(p + 4));
      protos.push({ parameters, result, signature: `(${parameters.join('')})${result}` });
    }
    const [fn, fo] = table(80, 8);
    this.fields = Array.from({ length: fn }, (_, i) => {
      const p = fo + i * 8, f = { owner: type(b.u16(p)), type: type(b.u16(p + 2)), name: string(b.u32(p + 4)) };
      f.key = fieldKey(f); Object.defineProperty(f, 'dex', { value: this });Object.defineProperty(f,'index',{value:i});return f;
    });
    const [mn, mo] = table(88, 8);
    this.methods = Array.from({ length: mn }, (_, i) => {
      const p = mo + i * 8, proto = indexed(protos, b.u16(p + 2), 'proto');
      const m = { owner: type(b.u16(p)), name: string(b.u32(p + 4)), ...proto };
      m.key = methodKey(m); Object.defineProperty(m, 'dex', { value: this });Object.defineProperty(m,'index',{value:i});return m;
    });
    const [cn, co] = table(96, 32);
    this.classes = new Map();
    let definitions = 0;
    for (let i = 0; i < cn; i++) {
      const p = co + i * 32, name = type(b.u32(p)), parent = b.u32(p + 8);
      const cls = { name, superclass: parent === NO_INDEX ? null : type(parent), interfaces: typeList(b.u32(p + 12)),
        staticValuesOffset: b.u32(p + 28), annotationsOffset: b.u32(p + 20), staticFields: [], fields: [], methods: new Map(), flags: b.u32(p + 4) };
      Object.defineProperty(cls, 'dex', { value: this });
      const c = { p: b.u32(p + 24) };
      if (c.p) {
        const ns = b.uleb(c), ni = b.uleb(c), nd = b.uleb(c), nv = b.uleb(c);
        definitions += ns + ni + nd + nv;
        // Each field_id and method_id is defined by at most one class, so the id tables bound the total.
        if (ns > fn || ni > fn || nd > mn || nv > mn || definitions > fn + mn) fail('Invalid/excessive DEX class data');
        for (const [count, target] of [[ns, cls.staticFields], [ni, cls.fields]]) {
          let index = 0;
          for (let j = 0; j < count; j++) {
            index += b.uleb(c); const flags = b.uleb(c);
            indexed(this.fields, index, 'encoded field'); target.push({ index, flags });
          }
        }
        for (const count of [nd, nv]) {
          let index = 0;
          for (let j = 0; j < count; j++) {
            index += b.uleb(c);
            const m = indexed(this.methods, index, 'encoded method'), flags = b.uleb(c), offset = b.uleb(c);
            let code = null;
            if (offset) {
              const registers = b.u16(offset), incoming = b.u16(offset + 2), tries = b.u16(offset + 6), units = b.u32(offset + 12);
              // registers and ins are u16 in the format; b.check below bounds the code by the file.
              if (incoming > registers) fail('DEX code has more incoming than total registers');
              b.check(offset + 16, units * 2);
              code = { registers, incoming, tries, units, offset: offset + 16 };
            }
            const key = m.name + m.signature;
            if (cls.methods.has(key)) fail(`Duplicate DEX method ${m.key}`);
            cls.methods.set(key, { method: m, flags, code });
          }
        }
      }
      if (this.classes.has(name)) fail(`Duplicate DEX class ${name}`);
      this.classes.set(name, cls);
    }
  }
  annotationSet(offset,visibilityFilter=1){
    if(!offset)return [];const b=this.reader,count=b.u32(offset);if(count>100000)fail('Excessive DEX annotations');b.table(count,offset+4,4);const values=[];
    for(let i=0;i<count;i++){const p=b.u32(offset+4+i*4),visibility=b.u8(p);if(visibility>2)fail('Invalid DEX annotation visibility');if(visibility===visibilityFilter)values.push(this.encodedAnnotation({p:p+1}));}return values;
  }
  memberAnnotations(member){
    const definition=member.field??member.method,cls=this.classes.get(definition.owner);if(!cls||!cls.annotationsOffset)return [];
    if(!cls.annotationDirectories){const b=this.reader,p=cls.annotationsOffset,fields=b.u32(p+4),methods=b.u32(p+8),parameters=b.u32(p+12);if(fields>this.fields.length||methods>this.methods.length||parameters>this.methods.length)fail('Invalid DEX annotation directory');b.table(fields+methods+parameters,p+16,8);const directory=cls.annotationDirectories={fields:new Map(),methods:new Map()};for(const [size,begin,target,list]of [[fields,p+16,directory.fields,this.fields],[methods,p+16+fields*8,directory.methods,this.methods]])for(let i=0;i<size;i++){const at=begin+i*8,index=b.u32(at);if(index>=list.length||target.has(index))fail('Invalid/duplicate annotated member');target.set(index,b.u32(at+4));}}
    const offset=(member.field?cls.annotationDirectories.fields:cls.annotationDirectories.methods).get(definition.index);return this.annotationSet(offset??0);
  }
  encodedAnnotation(cursor,depth=0){
    if(depth>32)fail('DEX annotation nesting limit exceeded');
    const index=this.reader.uleb(cursor),type=this.types[index],size=this.reader.uleb(cursor);
    if(!type||size>100000)fail('Invalid/excessive DEX annotation');
    const values=new Map();for(let i=0;i<size;i++){const name=this.strings[this.reader.uleb(cursor)];if(name===undefined||values.has(name))fail('Invalid annotation element name');values.set(name,this.encodedValue(cursor,depth+1));}
    return {encoded:'annotation',type,values};
  }
  encodedValue(cursor, depth = 0) {
    if (depth > 32) fail('DEX encoded value nesting limit exceeded');
    const b = this.reader, header = b.u8(cursor.p++), type = header & 31, arg = header >> 5;
    const read = (limit, signed = false) => {
      if (arg >= limit) fail('Malformed DEX encoded value width');
      let n = 0n;
      for (let i = 0; i <= arg; i++) n |= BigInt(b.u8(cursor.p++)) << BigInt(i * 8);
      return signed ? BigInt.asIntN((arg + 1) * 8, n) : n;
    };
    if ([0x00, 0x02, 0x04, 0x06].includes(type)) {
      const n = read(type === 0 ? 1 : type === 2 ? 2 : type === 4 ? 4 : 8, true);
      return type === 6 ? BigInt.asIntN(64, n) : Number(n) | 0;
    }
    if (type === 3) return Number(read(2));
    if (type === 0x10) return Number(read(4) << BigInt((3 - arg) * 8)) | 0;
    if (type === 0x11) return BigInt.asIntN(64, read(8) << BigInt((7 - arg) * 8));
    if ([0x17, 0x18, 0x19, 0x1a, 0x1b].includes(type)) {
      const index = Number(read(4));
      const list = type === 0x17 ? this.strings : type === 0x18 ? this.types : type === 0x1a ? this.methods : this.fields;
      if (index >= list.length) fail('Invalid encoded DEX reference');
      return type === 0x17 ? list[index] : { encoded: type === 0x18 ? 'class' : type === 0x1a ? 'method' : type === 0x19 ? 'field' : 'enum', value: list[index] };
    }
    if(type===0x1d&&arg===0)return this.encodedAnnotation(cursor,depth+1);
    if (type === 0x1c && arg === 0) {
      const count = b.uleb(cursor); if (count > b.length - cursor.p) fail('Encoded array is longer than its DEX'); // each value takes at least one byte
      return { encoded: 'array', values: Array.from({ length: count }, () => this.encodedValue(cursor, depth + 1)) };
    }
    if (type === 0x1e && arg === 0) return null;
    if (type === 0x1f && arg <= 1) return arg;
    fail(`Unsupported executed encoded value 0x${type.toString(16)}`);
  }
}

/** Global resolution with DEX-local instruction indices and readers retained on definitions. */
export class DexProgram {
  constructor(files, { bootFiles = [] } = {}) {
    if (!Array.isArray(files) || !files.length || files.length > 1024) fail('DEX program requires 1–1024 DEX files');
    this.files = []; this.classes = new Map(); this.methods = []; this.fields = []; this.types = []; this.strings = [];
    let bytes = 0;
    for (let i = 0; i < files.length; i++) {
      const item = files[i], dex = item instanceof DexFile ? item : item.dex;
      if (!(dex instanceof DexFile)) fail('DexProgram requires parsed DexFile instances');
      const filename = item.filename ?? item.name ?? dex.filename ?? `classes${i ? i + 1 : ''}.dex`;
      dex.filename = filename; bytes += dex.reader.length;
      if (bytes > 768 * 1024 * 1024) fail('Aggregate DEX size exceeds 768 MiB limit');
      this.files.push({ filename, dex });
      for (const [name, cls] of dex.classes) {
        // DexPathList searches its dex elements in order, so the first definition wins and later ones are never loaded.
        if (this.classes.has(name)) { (this.duplicateClasses ??= []).push({ name, kept: this.classes.get(name).dex.filename, ignored: filename }); continue; }
        this.classes.set(name, cls);
      }
      this.methods = this.methods.concat(dex.methods); this.fields = this.fields.concat(dex.fields);
      this.types = this.types.concat(dex.types); this.strings = this.strings.concat(dex.strings);
    }
    if (!Array.isArray(bootFiles) || bootFiles.length > 16) fail('Framework layer requires at most 16 DEX files');
    this.bootFiles = []; this.bootClasses = new Map(); this.bootDexes = new Set(); let bootBytes = 0;
    for (let i = 0; i < bootFiles.length; i++) {
      const item = bootFiles[i], dex = item instanceof DexFile ? item : item.dex;
      if (!(dex instanceof DexFile)) fail('Framework layer requires parsed DexFile instances');
      if (this.files.some(file => file.dex === dex)) fail('A DEX instance cannot belong to both APK and framework layers');
      const filename = item.filename ?? item.name ?? dex.filename ?? `framework-${i}.dex`;
      dex.filename = filename; bootBytes += dex.reader.length;
      if (bootBytes > 128 * 1024 * 1024) fail('Framework DEX layer exceeds 128 MiB');
      this.bootFiles.push({ filename, dex }); this.bootDexes.add(dex);
      for (const [name, cls] of dex.classes) {
        if (!/^L(?:android\/|java\/|javax\/|dalvik\/|libcore\/|org\/json\/|dev\/apkweb\/(?:net|view|os)\/|com\/android\/(?:internal|icu|okhttp)\/|jdk\/(?:internal\/(?:util|misc|math)|net)\/|sun\/(?:misc|net|nio\/(?:cs|ch)|security\/(?:action|util)|util\/(?:calendar|logging))\/)/.test(name)) fail(`Unapproved framework namespace: ${name}`);
        if (this.bootClasses.has(name)) fail(`Duplicate framework class: ${name}`);
        this.bootClasses.set(name, cls);
      }
      if (this.bootClasses.size > 100000) fail('Framework class count limit exceeded');
    }
    // APK inventory is deliberately separate. Curated boot definitions win even if an APK
    // embeds a same-named android/java class, matching the parent-first boot lookup policy.
    this.resolvedClasses = new Map(this.classes);
    for (const [name, cls] of this.bootClasses) this.resolvedClasses.set(name, cls);
    this.dynamicFiles = [];
    this.frameworkSummary = { enabled: this.bootFiles.length > 0, dexFiles: this.bootFiles.map(file => file.filename), classes: this.bootClasses.size, bytes: bootBytes,
      shadowedAPKClasses: [...this.bootClasses.keys()].filter(name => this.classes.has(name)), policy: this.bootFiles.length ? 'curated-boot-parent-first' : 'no-boot-layer' };
  }
  /**
   * Adds a DEX loaded at run time (InMemoryDexClassLoader / DexClassLoader / DexFile). Classes join the shared class namespace after the
   * boot layer and the APK; a name that already exists is an error (the VM has one class table, so shadowing would silently change behavior).
   */
  addDynamicFile(dex, filename, { skip = new Set() } = {}) {
    if (!(dex instanceof DexFile)) fail('addDynamicFile requires a parsed DexFile');
    if (this.dynamicFiles.length >= 64) fail('Dynamic DEX file limit (64) exceeded');
    const total = this.files.reduce((sum, file) => sum + file.dex.reader.length, 0) + this.dynamicFiles.reduce((sum, file) => sum + file.dex.reader.length, 0) + dex.reader.length;
    if (total > 512 * 1024 * 1024) fail('Aggregate DEX size exceeds 512 MiB limit');
    const added = [];
    for (const name of dex.classes.keys()) {
      if (skip.has(name)) continue; // shadowed by a parent loader (parent-first delegation): that definition stays authoritative
      if (this.resolvedClasses.has(name)) throw new APKError(`Dynamic DEX class ${name} already exists in ${this.resolvedClasses.get(name).dex.filename}; the ClassLoader must alias or shadow it first`, { kind: 'duplicate-dynamic-class' });
      added.push(name);
    }
    dex.filename = filename; this.dynamicFiles.push({ filename, dex });
    for (const name of added) { const cls = dex.classes.get(name); this.classes.set(name, cls); this.resolvedClasses.set(name, cls); }
    return added;
  }
}

/*
COPYRIGHT AND PERMISSION NOTICE (ICU 58 and later)

Copyright © 1991-2020 Unicode, Inc. All rights reserved.
Distributed under the Terms of Use in https://www.unicode.org/copyright.html.

Permission is hereby granted, free of charge, to any person obtaining
a copy of the Unicode data files and any associated documentation
(the "Data Files") or Unicode software and any associated documentation
(the "Software") to deal in the Data Files or Software
without restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, and/or sell copies of
the Data Files or Software, and to permit persons to whom the Data Files
or Software are furnished to do so, provided that either
(a) this copyright and permission notice appear with all copies
of the Data Files or Software, or
(b) this copyright and permission notice appear in associated
Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT OF THIRD PARTY RIGHTS.
IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS
NOTICE BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL
DAMAGES, OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE,
DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THE DATA FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder
shall not be used in advertising or otherwise to promote the sale,
use or other dealings in these Data Files or Software without prior
written authorization of the copyright holder.
*/
// Simple UTF-16 character mappings from AOSP13 ICU UnicodeData.txt (Unicode data license).
// Source: platform/external/icu android-13.0.0_r1; SHA256 documented in work/runtime-aosp-notes.json.
const JAVA_SIMPLE_UPPER=new Map([[97,65],[98,66],[99,67],[100,68],[101,69],[102,70],[103,71],[104,72],[105,73],[106,74],[107,75],[108,76],[109,77],[110,78],[111,79],[112,80],[113,81],[114,82],[115,83],[116,84],[117,85],[118,86],[119,87],[120,88],[121,89],[122,90],[181,924],[224,192],[225,193],[226,194],[227,195],[228,196],[229,197],[230,198],[231,199],[232,200],[233,201],[234,202],[235,203],[236,204],[237,205],[238,206],[239,207],[240,208],[241,209],[242,210],[243,211],[244,212],[245,213],[246,214],[248,216],[249,217],[250,218],[251,219],[252,220],[253,221],[254,222],[255,376],[257,256],[259,258],[261,260],[263,262],[265,264],[267,266],[269,268],[271,270],[273,272],[275,274],[277,276],[279,278],[281,280],[283,282],[285,284],[287,286],[289,288],[291,290],[293,292],[295,294],[297,296],[299,298],[301,300],[303,302],[305,73],[307,306],[309,308],[311,310],[314,313],[316,315],[318,317],[320,319],[322,321],[324,323],[326,325],[328,327],[331,330],[333,332],[335,334],[337,336],[339,338],[341,340],[343,342],[345,344],[347,346],[349,348],[351,350],[353,352],[355,354],[357,356],[359,358],[361,360],[363,362],[365,364],[367,366],[369,368],[371,370],[373,372],[375,374],[378,377],[380,379],[382,381],[383,83],[384,579],[387,386],[389,388],[392,391],[396,395],[402,401],[405,502],[409,408],[410,573],[414,544],[417,416],[419,418],[421,420],[424,423],[429,428],[432,431],[436,435],[438,437],[441,440],[445,444],[447,503],[453,452],[454,452],[456,455],[457,455],[459,458],[460,458],[462,461],[464,463],[466,465],[468,467],[470,469],[472,471],[474,473],[476,475],[477,398],[479,478],[481,480],[483,482],[485,484],[487,486],[489,488],[491,490],[493,492],[495,494],[498,497],[499,497],[501,500],[505,504],[507,506],[509,508],[511,510],[513,512],[515,514],[517,516],[519,518],[521,520],[523,522],[525,524],[527,526],[529,528],[531,530],[533,532],[535,534],[537,536],[539,538],[541,540],[543,542],[547,546],[549,548],[551,550],[553,552],[555,554],[557,556],[559,558],[561,560],[563,562],[572,571],[575,11390],[576,11391],[578,577],[583,582],[585,584],[587,586],[589,588],[591,590],[592,11375],[593,11373],[594,11376],[595,385],[596,390],[598,393],[599,394],[601,399],[603,400],[604,42923],[608,403],[609,42924],[611,404],[613,42893],[614,42922],[616,407],[617,406],[618,42926],[619,11362],[620,42925],[623,412],[625,11374],[626,413],[629,415],[637,11364],[640,422],[642,42949],[643,425],[647,42929],[648,430],[649,580],[650,433],[651,434],[652,581],[658,439],[669,42930],[670,42928],[837,921],[881,880],[883,882],[887,886],[891,1021],[892,1022],[893,1023],[940,902],[941,904],[942,905],[943,906],[945,913],[946,914],[947,915],[948,916],[949,917],[950,918],[951,919],[952,920],[953,921],[954,922],[955,923],[956,924],[957,925],[958,926],[959,927],[960,928],[961,929],[962,931],[963,931],[964,932],[965,933],[966,934],[967,935],[968,936],[969,937],[970,938],[971,939],[972,908],[973,910],[974,911],[976,914],[977,920],[981,934],[982,928],[983,975],[985,984],[987,986],[989,988],[991,990],[993,992],[995,994],[997,996],[999,998],[1001,1000],[1003,1002],[1005,1004],[1007,1006],[1008,922],[1009,929],[1010,1017],[1011,895],[1013,917],[1016,1015],[1019,1018],[1072,1040],[1073,1041],[1074,1042],[1075,1043],[1076,1044],[1077,1045],[1078,1046],[1079,1047],[1080,1048],[1081,1049],[1082,1050],[1083,1051],[1084,1052],[1085,1053],[1086,1054],[1087,1055],[1088,1056],[1089,1057],[1090,1058],[1091,1059],[1092,1060],[1093,1061],[1094,1062],[1095,1063],[1096,1064],[1097,1065],[1098,1066],[1099,1067],[1100,1068],[1101,1069],[1102,1070],[1103,1071],[1104,1024],[1105,1025],[1106,1026],[1107,1027],[1108,1028],[1109,1029],[1110,1030],[1111,1031],[1112,1032],[1113,1033],[1114,1034],[1115,1035],[1116,1036],[1117,1037],[1118,1038],[1119,1039],[1121,1120],[1123,1122],[1125,1124],[1127,1126],[1129,1128],[1131,1130],[1133,1132],[1135,1134],[1137,1136],[1139,1138],[1141,1140],[1143,1142],[1145,1144],[1147,1146],[1149,1148],[1151,1150],[1153,1152],[1163,1162],[1165,1164],[1167,1166],[1169,1168],[1171,1170],[1173,1172],[1175,1174],[1177,1176],[1179,1178],[1181,1180],[1183,1182],[1185,1184],[1187,1186],[1189,1188],[1191,1190],[1193,1192],[1195,1194],[1197,1196],[1199,1198],[1201,1200],[1203,1202],[1205,1204],[1207,1206],[1209,1208],[1211,1210],[1213,1212],[1215,1214],[1218,1217],[1220,1219],[1222,1221],[1224,1223],[1226,1225],[1228,1227],[1230,1229],[1231,1216],[1233,1232],[1235,1234],[1237,1236],[1239,1238],[1241,1240],[1243,1242],[1245,1244],[1247,1246],[1249,1248],[1251,1250],[1253,1252],[1255,1254],[1257,1256],[1259,1258],[1261,1260],[1263,1262],[1265,1264],[1267,1266],[1269,1268],[1271,1270],[1273,1272],[1275,1274],[1277,1276],[1279,1278],[1281,1280],[1283,1282],[1285,1284],[1287,1286],[1289,1288],[1291,1290],[1293,1292],[1295,1294],[1297,1296],[1299,1298],[1301,1300],[1303,1302],[1305,1304],[1307,1306],[1309,1308],[1311,1310],[1313,1312],[1315,1314],[1317,1316],[1319,1318],[1321,1320],[1323,1322],[1325,1324],[1327,1326],[1377,1329],[1378,1330],[1379,1331],[1380,1332],[1381,1333],[1382,1334],[1383,1335],[1384,1336],[1385,1337],[1386,1338],[1387,1339],[1388,1340],[1389,1341],[1390,1342],[1391,1343],[1392,1344],[1393,1345],[1394,1346],[1395,1347],[1396,1348],[1397,1349],[1398,1350],[1399,1351],[1400,1352],[1401,1353],[1402,1354],[1403,1355],[1404,1356],[1405,1357],[1406,1358],[1407,1359],[1408,1360],[1409,1361],[1410,1362],[1411,1363],[1412,1364],[1413,1365],[1414,1366],[4304,7312],[4305,7313],[4306,7314],[4307,7315],[4308,7316],[4309,7317],[4310,7318],[4311,7319],[4312,7320],[4313,7321],[4314,7322],[4315,7323],[4316,7324],[4317,7325],[4318,7326],[4319,7327],[4320,7328],[4321,7329],[4322,7330],[4323,7331],[4324,7332],[4325,7333],[4326,7334],[4327,7335],[4328,7336],[4329,7337],[4330,7338],[4331,7339],[4332,7340],[4333,7341],[4334,7342],[4335,7343],[4336,7344],[4337,7345],[4338,7346],[4339,7347],[4340,7348],[4341,7349],[4342,7350],[4343,7351],[4344,7352],[4345,7353],[4346,7354],[4349,7357],[4350,7358],[4351,7359],[5112,5104],[5113,5105],[5114,5106],[5115,5107],[5116,5108],[5117,5109],[7296,1042],[7297,1044],[7298,1054],[7299,1057],[7300,1058],[7301,1058],[7302,1066],[7303,1122],[7304,42570],[7545,42877],[7549,11363],[7566,42950],[7681,7680],[7683,7682],[7685,7684],[7687,7686],[7689,7688],[7691,7690],[7693,7692],[7695,7694],[7697,7696],[7699,7698],[7701,7700],[7703,7702],[7705,7704],[7707,7706],[7709,7708],[7711,7710],[7713,7712],[7715,7714],[7717,7716],[7719,7718],[7721,7720],[7723,7722],[7725,7724],[7727,7726],[7729,7728],[7731,7730],[7733,7732],[7735,7734],[7737,7736],[7739,7738],[7741,7740],[7743,7742],[7745,7744],[7747,7746],[7749,7748],[7751,7750],[7753,7752],[7755,7754],[7757,7756],[7759,7758],[7761,7760],[7763,7762],[7765,7764],[7767,7766],[7769,7768],[7771,7770],[7773,7772],[7775,7774],[7777,7776],[7779,7778],[7781,7780],[7783,7782],[7785,7784],[7787,7786],[7789,7788],[7791,7790],[7793,7792],[7795,7794],[7797,7796],[7799,7798],[7801,7800],[7803,7802],[7805,7804],[7807,7806],[7809,7808],[7811,7810],[7813,7812],[7815,7814],[7817,7816],[7819,7818],[7821,7820],[7823,7822],[7825,7824],[7827,7826],[7829,7828],[7835,7776],[7841,7840],[7843,7842],[7845,7844],[7847,7846],[7849,7848],[7851,7850],[7853,7852],[7855,7854],[7857,7856],[7859,7858],[7861,7860],[7863,7862],[7865,7864],[7867,7866],[7869,7868],[7871,7870],[7873,7872],[7875,7874],[7877,7876],[7879,7878],[7881,7880],[7883,7882],[7885,7884],[7887,7886],[7889,7888],[7891,7890],[7893,7892],[7895,7894],[7897,7896],[7899,7898],[7901,7900],[7903,7902],[7905,7904],[7907,7906],[7909,7908],[7911,7910],[7913,7912],[7915,7914],[7917,7916],[7919,7918],[7921,7920],[7923,7922],[7925,7924],[7927,7926],[7929,7928],[7931,7930],[7933,7932],[7935,7934],[7936,7944],[7937,7945],[7938,7946],[7939,7947],[7940,7948],[7941,7949],[7942,7950],[7943,7951],[7952,7960],[7953,7961],[7954,7962],[7955,7963],[7956,7964],[7957,7965],[7968,7976],[7969,7977],[7970,7978],[7971,7979],[7972,7980],[7973,7981],[7974,7982],[7975,7983],[7984,7992],[7985,7993],[7986,7994],[7987,7995],[7988,7996],[7989,7997],[7990,7998],[7991,7999],[8000,8008],[8001,8009],[8002,8010],[8003,8011],[8004,8012],[8005,8013],[8017,8025],[8019,8027],[8021,8029],[8023,8031],[8032,8040],[8033,8041],[8034,8042],[8035,8043],[8036,8044],[8037,8045],[8038,8046],[8039,8047],[8048,8122],[8049,8123],[8050,8136],[8051,8137],[8052,8138],[8053,8139],[8054,8154],[8055,8155],[8056,8184],[8057,8185],[8058,8170],[8059,8171],[8060,8186],[8061,8187],[8064,8072],[8065,8073],[8066,8074],[8067,8075],[8068,8076],[8069,8077],[8070,8078],[8071,8079],[8080,8088],[8081,8089],[8082,8090],[8083,8091],[8084,8092],[8085,8093],[8086,8094],[8087,8095],[8096,8104],[8097,8105],[8098,8106],[8099,8107],[8100,8108],[8101,8109],[8102,8110],[8103,8111],[8112,8120],[8113,8121],[8115,8124],[8126,921],[8131,8140],[8144,8152],[8145,8153],[8160,8168],[8161,8169],[8165,8172],[8179,8188],[8526,8498],[8560,8544],[8561,8545],[8562,8546],[8563,8547],[8564,8548],[8565,8549],[8566,8550],[8567,8551],[8568,8552],[8569,8553],[8570,8554],[8571,8555],[8572,8556],[8573,8557],[8574,8558],[8575,8559],[8580,8579],[9424,9398],[9425,9399],[9426,9400],[9427,9401],[9428,9402],[9429,9403],[9430,9404],[9431,9405],[9432,9406],[9433,9407],[9434,9408],[9435,9409],[9436,9410],[9437,9411],[9438,9412],[9439,9413],[9440,9414],[9441,9415],[9442,9416],[9443,9417],[9444,9418],[9445,9419],[9446,9420],[9447,9421],[9448,9422],[9449,9423],[11312,11264],[11313,11265],[11314,11266],[11315,11267],[11316,11268],[11317,11269],[11318,11270],[11319,11271],[11320,11272],[11321,11273],[11322,11274],[11323,11275],[11324,11276],[11325,11277],[11326,11278],[11327,11279],[11328,11280],[11329,11281],[11330,11282],[11331,11283],[11332,11284],[11333,11285],[11334,11286],[11335,11287],[11336,11288],[11337,11289],[11338,11290],[11339,11291],[11340,11292],[11341,11293],[11342,11294],[11343,11295],[11344,11296],[11345,11297],[11346,11298],[11347,11299],[11348,11300],[11349,11301],[11350,11302],[11351,11303],[11352,11304],[11353,11305],[11354,11306],[11355,11307],[11356,11308],[11357,11309],[11358,11310],[11359,11311],[11361,11360],[11365,570],[11366,574],[11368,11367],[11370,11369],[11372,11371],[11379,11378],[11382,11381],[11393,11392],[11395,11394],[11397,11396],[11399,11398],[11401,11400],[11403,11402],[11405,11404],[11407,11406],[11409,11408],[11411,11410],[11413,11412],[11415,11414],[11417,11416],[11419,11418],[11421,11420],[11423,11422],[11425,11424],[11427,11426],[11429,11428],[11431,11430],[11433,11432],[11435,11434],[11437,11436],[11439,11438],[11441,11440],[11443,11442],[11445,11444],[11447,11446],[11449,11448],[11451,11450],[11453,11452],[11455,11454],[11457,11456],[11459,11458],[11461,11460],[11463,11462],[11465,11464],[11467,11466],[11469,11468],[11471,11470],[11473,11472],[11475,11474],[11477,11476],[11479,11478],[11481,11480],[11483,11482],[11485,11484],[11487,11486],[11489,11488],[11491,11490],[11500,11499],[11502,11501],[11507,11506],[11520,4256],[11521,4257],[11522,4258],[11523,4259],[11524,4260],[11525,4261],[11526,4262],[11527,4263],[11528,4264],[11529,4265],[11530,4266],[11531,4267],[11532,4268],[11533,4269],[11534,4270],[11535,4271],[11536,4272],[11537,4273],[11538,4274],[11539,4275],[11540,4276],[11541,4277],[11542,4278],[11543,4279],[11544,4280],[11545,4281],[11546,4282],[11547,4283],[11548,4284],[11549,4285],[11550,4286],[11551,4287],[11552,4288],[11553,4289],[11554,4290],[11555,4291],[11556,4292],[11557,4293],[11559,4295],[11565,4301],[42561,42560],[42563,42562],[42565,42564],[42567,42566],[42569,42568],[42571,42570],[42573,42572],[42575,42574],[42577,42576],[42579,42578],[42581,42580],[42583,42582],[42585,42584],[42587,42586],[42589,42588],[42591,42590],[42593,42592],[42595,42594],[42597,42596],[42599,42598],[42601,42600],[42603,42602],[42605,42604],[42625,42624],[42627,42626],[42629,42628],[42631,42630],[42633,42632],[42635,42634],[42637,42636],[42639,42638],[42641,42640],[42643,42642],[42645,42644],[42647,42646],[42649,42648],[42651,42650],[42787,42786],[42789,42788],[42791,42790],[42793,42792],[42795,42794],[42797,42796],[42799,42798],[42803,42802],[42805,42804],[42807,42806],[42809,42808],[42811,42810],[42813,42812],[42815,42814],[42817,42816],[42819,42818],[42821,42820],[42823,42822],[42825,42824],[42827,42826],[42829,42828],[42831,42830],[42833,42832],[42835,42834],[42837,42836],[42839,42838],[42841,42840],[42843,42842],[42845,42844],[42847,42846],[42849,42848],[42851,42850],[42853,42852],[42855,42854],[42857,42856],[42859,42858],[42861,42860],[42863,42862],[42874,42873],[42876,42875],[42879,42878],[42881,42880],[42883,42882],[42885,42884],[42887,42886],[42892,42891],[42897,42896],[42899,42898],[42900,42948],[42903,42902],[42905,42904],[42907,42906],[42909,42908],[42911,42910],[42913,42912],[42915,42914],[42917,42916],[42919,42918],[42921,42920],[42933,42932],[42935,42934],[42937,42936],[42939,42938],[42941,42940],[42943,42942],[42945,42944],[42947,42946],[42952,42951],[42954,42953],[42961,42960],[42967,42966],[42969,42968],[42998,42997],[43859,42931],[43888,5024],[43889,5025],[43890,5026],[43891,5027],[43892,5028],[43893,5029],[43894,5030],[43895,5031],[43896,5032],[43897,5033],[43898,5034],[43899,5035],[43900,5036],[43901,5037],[43902,5038],[43903,5039],[43904,5040],[43905,5041],[43906,5042],[43907,5043],[43908,5044],[43909,5045],[43910,5046],[43911,5047],[43912,5048],[43913,5049],[43914,5050],[43915,5051],[43916,5052],[43917,5053],[43918,5054],[43919,5055],[43920,5056],[43921,5057],[43922,5058],[43923,5059],[43924,5060],[43925,5061],[43926,5062],[43927,5063],[43928,5064],[43929,5065],[43930,5066],[43931,5067],[43932,5068],[43933,5069],[43934,5070],[43935,5071],[43936,5072],[43937,5073],[43938,5074],[43939,5075],[43940,5076],[43941,5077],[43942,5078],[43943,5079],[43944,5080],[43945,5081],[43946,5082],[43947,5083],[43948,5084],[43949,5085],[43950,5086],[43951,5087],[43952,5088],[43953,5089],[43954,5090],[43955,5091],[43956,5092],[43957,5093],[43958,5094],[43959,5095],[43960,5096],[43961,5097],[43962,5098],[43963,5099],[43964,5100],[43965,5101],[43966,5102],[43967,5103],[65345,65313],[65346,65314],[65347,65315],[65348,65316],[65349,65317],[65350,65318],[65351,65319],[65352,65320],[65353,65321],[65354,65322],[65355,65323],[65356,65324],[65357,65325],[65358,65326],[65359,65327],[65360,65328],[65361,65329],[65362,65330],[65363,65331],[65364,65332],[65365,65333],[65366,65334],[65367,65335],[65368,65336],[65369,65337],[65370,65338]]);
const JAVA_SIMPLE_LOWER=new Map([[65,97],[66,98],[67,99],[68,100],[69,101],[70,102],[71,103],[72,104],[73,105],[74,106],[75,107],[76,108],[77,109],[78,110],[79,111],[80,112],[81,113],[82,114],[83,115],[84,116],[85,117],[86,118],[87,119],[88,120],[89,121],[90,122],[192,224],[193,225],[194,226],[195,227],[196,228],[197,229],[198,230],[199,231],[200,232],[201,233],[202,234],[203,235],[204,236],[205,237],[206,238],[207,239],[208,240],[209,241],[210,242],[211,243],[212,244],[213,245],[214,246],[216,248],[217,249],[218,250],[219,251],[220,252],[221,253],[222,254],[256,257],[258,259],[260,261],[262,263],[264,265],[266,267],[268,269],[270,271],[272,273],[274,275],[276,277],[278,279],[280,281],[282,283],[284,285],[286,287],[288,289],[290,291],[292,293],[294,295],[296,297],[298,299],[300,301],[302,303],[304,105],[306,307],[308,309],[310,311],[313,314],[315,316],[317,318],[319,320],[321,322],[323,324],[325,326],[327,328],[330,331],[332,333],[334,335],[336,337],[338,339],[340,341],[342,343],[344,345],[346,347],[348,349],[350,351],[352,353],[354,355],[356,357],[358,359],[360,361],[362,363],[364,365],[366,367],[368,369],[370,371],[372,373],[374,375],[376,255],[377,378],[379,380],[381,382],[385,595],[386,387],[388,389],[390,596],[391,392],[393,598],[394,599],[395,396],[398,477],[399,601],[400,603],[401,402],[403,608],[404,611],[406,617],[407,616],[408,409],[412,623],[413,626],[415,629],[416,417],[418,419],[420,421],[422,640],[423,424],[425,643],[428,429],[430,648],[431,432],[433,650],[434,651],[435,436],[437,438],[439,658],[440,441],[444,445],[452,454],[453,454],[455,457],[456,457],[458,460],[459,460],[461,462],[463,464],[465,466],[467,468],[469,470],[471,472],[473,474],[475,476],[478,479],[480,481],[482,483],[484,485],[486,487],[488,489],[490,491],[492,493],[494,495],[497,499],[498,499],[500,501],[502,405],[503,447],[504,505],[506,507],[508,509],[510,511],[512,513],[514,515],[516,517],[518,519],[520,521],[522,523],[524,525],[526,527],[528,529],[530,531],[532,533],[534,535],[536,537],[538,539],[540,541],[542,543],[544,414],[546,547],[548,549],[550,551],[552,553],[554,555],[556,557],[558,559],[560,561],[562,563],[570,11365],[571,572],[573,410],[574,11366],[577,578],[579,384],[580,649],[581,652],[582,583],[584,585],[586,587],[588,589],[590,591],[880,881],[882,883],[886,887],[895,1011],[902,940],[904,941],[905,942],[906,943],[908,972],[910,973],[911,974],[913,945],[914,946],[915,947],[916,948],[917,949],[918,950],[919,951],[920,952],[921,953],[922,954],[923,955],[924,956],[925,957],[926,958],[927,959],[928,960],[929,961],[931,963],[932,964],[933,965],[934,966],[935,967],[936,968],[937,969],[938,970],[939,971],[975,983],[984,985],[986,987],[988,989],[990,991],[992,993],[994,995],[996,997],[998,999],[1000,1001],[1002,1003],[1004,1005],[1006,1007],[1012,952],[1015,1016],[1017,1010],[1018,1019],[1021,891],[1022,892],[1023,893],[1024,1104],[1025,1105],[1026,1106],[1027,1107],[1028,1108],[1029,1109],[1030,1110],[1031,1111],[1032,1112],[1033,1113],[1034,1114],[1035,1115],[1036,1116],[1037,1117],[1038,1118],[1039,1119],[1040,1072],[1041,1073],[1042,1074],[1043,1075],[1044,1076],[1045,1077],[1046,1078],[1047,1079],[1048,1080],[1049,1081],[1050,1082],[1051,1083],[1052,1084],[1053,1085],[1054,1086],[1055,1087],[1056,1088],[1057,1089],[1058,1090],[1059,1091],[1060,1092],[1061,1093],[1062,1094],[1063,1095],[1064,1096],[1065,1097],[1066,1098],[1067,1099],[1068,1100],[1069,1101],[1070,1102],[1071,1103],[1120,1121],[1122,1123],[1124,1125],[1126,1127],[1128,1129],[1130,1131],[1132,1133],[1134,1135],[1136,1137],[1138,1139],[1140,1141],[1142,1143],[1144,1145],[1146,1147],[1148,1149],[1150,1151],[1152,1153],[1162,1163],[1164,1165],[1166,1167],[1168,1169],[1170,1171],[1172,1173],[1174,1175],[1176,1177],[1178,1179],[1180,1181],[1182,1183],[1184,1185],[1186,1187],[1188,1189],[1190,1191],[1192,1193],[1194,1195],[1196,1197],[1198,1199],[1200,1201],[1202,1203],[1204,1205],[1206,1207],[1208,1209],[1210,1211],[1212,1213],[1214,1215],[1216,1231],[1217,1218],[1219,1220],[1221,1222],[1223,1224],[1225,1226],[1227,1228],[1229,1230],[1232,1233],[1234,1235],[1236,1237],[1238,1239],[1240,1241],[1242,1243],[1244,1245],[1246,1247],[1248,1249],[1250,1251],[1252,1253],[1254,1255],[1256,1257],[1258,1259],[1260,1261],[1262,1263],[1264,1265],[1266,1267],[1268,1269],[1270,1271],[1272,1273],[1274,1275],[1276,1277],[1278,1279],[1280,1281],[1282,1283],[1284,1285],[1286,1287],[1288,1289],[1290,1291],[1292,1293],[1294,1295],[1296,1297],[1298,1299],[1300,1301],[1302,1303],[1304,1305],[1306,1307],[1308,1309],[1310,1311],[1312,1313],[1314,1315],[1316,1317],[1318,1319],[1320,1321],[1322,1323],[1324,1325],[1326,1327],[1329,1377],[1330,1378],[1331,1379],[1332,1380],[1333,1381],[1334,1382],[1335,1383],[1336,1384],[1337,1385],[1338,1386],[1339,1387],[1340,1388],[1341,1389],[1342,1390],[1343,1391],[1344,1392],[1345,1393],[1346,1394],[1347,1395],[1348,1396],[1349,1397],[1350,1398],[1351,1399],[1352,1400],[1353,1401],[1354,1402],[1355,1403],[1356,1404],[1357,1405],[1358,1406],[1359,1407],[1360,1408],[1361,1409],[1362,1410],[1363,1411],[1364,1412],[1365,1413],[1366,1414],[4256,11520],[4257,11521],[4258,11522],[4259,11523],[4260,11524],[4261,11525],[4262,11526],[4263,11527],[4264,11528],[4265,11529],[4266,11530],[4267,11531],[4268,11532],[4269,11533],[4270,11534],[4271,11535],[4272,11536],[4273,11537],[4274,11538],[4275,11539],[4276,11540],[4277,11541],[4278,11542],[4279,11543],[4280,11544],[4281,11545],[4282,11546],[4283,11547],[4284,11548],[4285,11549],[4286,11550],[4287,11551],[4288,11552],[4289,11553],[4290,11554],[4291,11555],[4292,11556],[4293,11557],[4295,11559],[4301,11565],[5024,43888],[5025,43889],[5026,43890],[5027,43891],[5028,43892],[5029,43893],[5030,43894],[5031,43895],[5032,43896],[5033,43897],[5034,43898],[5035,43899],[5036,43900],[5037,43901],[5038,43902],[5039,43903],[5040,43904],[5041,43905],[5042,43906],[5043,43907],[5044,43908],[5045,43909],[5046,43910],[5047,43911],[5048,43912],[5049,43913],[5050,43914],[5051,43915],[5052,43916],[5053,43917],[5054,43918],[5055,43919],[5056,43920],[5057,43921],[5058,43922],[5059,43923],[5060,43924],[5061,43925],[5062,43926],[5063,43927],[5064,43928],[5065,43929],[5066,43930],[5067,43931],[5068,43932],[5069,43933],[5070,43934],[5071,43935],[5072,43936],[5073,43937],[5074,43938],[5075,43939],[5076,43940],[5077,43941],[5078,43942],[5079,43943],[5080,43944],[5081,43945],[5082,43946],[5083,43947],[5084,43948],[5085,43949],[5086,43950],[5087,43951],[5088,43952],[5089,43953],[5090,43954],[5091,43955],[5092,43956],[5093,43957],[5094,43958],[5095,43959],[5096,43960],[5097,43961],[5098,43962],[5099,43963],[5100,43964],[5101,43965],[5102,43966],[5103,43967],[5104,5112],[5105,5113],[5106,5114],[5107,5115],[5108,5116],[5109,5117],[7312,4304],[7313,4305],[7314,4306],[7315,4307],[7316,4308],[7317,4309],[7318,4310],[7319,4311],[7320,4312],[7321,4313],[7322,4314],[7323,4315],[7324,4316],[7325,4317],[7326,4318],[7327,4319],[7328,4320],[7329,4321],[7330,4322],[7331,4323],[7332,4324],[7333,4325],[7334,4326],[7335,4327],[7336,4328],[7337,4329],[7338,4330],[7339,4331],[7340,4332],[7341,4333],[7342,4334],[7343,4335],[7344,4336],[7345,4337],[7346,4338],[7347,4339],[7348,4340],[7349,4341],[7350,4342],[7351,4343],[7352,4344],[7353,4345],[7354,4346],[7357,4349],[7358,4350],[7359,4351],[7680,7681],[7682,7683],[7684,7685],[7686,7687],[7688,7689],[7690,7691],[7692,7693],[7694,7695],[7696,7697],[7698,7699],[7700,7701],[7702,7703],[7704,7705],[7706,7707],[7708,7709],[7710,7711],[7712,7713],[7714,7715],[7716,7717],[7718,7719],[7720,7721],[7722,7723],[7724,7725],[7726,7727],[7728,7729],[7730,7731],[7732,7733],[7734,7735],[7736,7737],[7738,7739],[7740,7741],[7742,7743],[7744,7745],[7746,7747],[7748,7749],[7750,7751],[7752,7753],[7754,7755],[7756,7757],[7758,7759],[7760,7761],[7762,7763],[7764,7765],[7766,7767],[7768,7769],[7770,7771],[7772,7773],[7774,7775],[7776,7777],[7778,7779],[7780,7781],[7782,7783],[7784,7785],[7786,7787],[7788,7789],[7790,7791],[7792,7793],[7794,7795],[7796,7797],[7798,7799],[7800,7801],[7802,7803],[7804,7805],[7806,7807],[7808,7809],[7810,7811],[7812,7813],[7814,7815],[7816,7817],[7818,7819],[7820,7821],[7822,7823],[7824,7825],[7826,7827],[7828,7829],[7838,223],[7840,7841],[7842,7843],[7844,7845],[7846,7847],[7848,7849],[7850,7851],[7852,7853],[7854,7855],[7856,7857],[7858,7859],[7860,7861],[7862,7863],[7864,7865],[7866,7867],[7868,7869],[7870,7871],[7872,7873],[7874,7875],[7876,7877],[7878,7879],[7880,7881],[7882,7883],[7884,7885],[7886,7887],[7888,7889],[7890,7891],[7892,7893],[7894,7895],[7896,7897],[7898,7899],[7900,7901],[7902,7903],[7904,7905],[7906,7907],[7908,7909],[7910,7911],[7912,7913],[7914,7915],[7916,7917],[7918,7919],[7920,7921],[7922,7923],[7924,7925],[7926,7927],[7928,7929],[7930,7931],[7932,7933],[7934,7935],[7944,7936],[7945,7937],[7946,7938],[7947,7939],[7948,7940],[7949,7941],[7950,7942],[7951,7943],[7960,7952],[7961,7953],[7962,7954],[7963,7955],[7964,7956],[7965,7957],[7976,7968],[7977,7969],[7978,7970],[7979,7971],[7980,7972],[7981,7973],[7982,7974],[7983,7975],[7992,7984],[7993,7985],[7994,7986],[7995,7987],[7996,7988],[7997,7989],[7998,7990],[7999,7991],[8008,8000],[8009,8001],[8010,8002],[8011,8003],[8012,8004],[8013,8005],[8025,8017],[8027,8019],[8029,8021],[8031,8023],[8040,8032],[8041,8033],[8042,8034],[8043,8035],[8044,8036],[8045,8037],[8046,8038],[8047,8039],[8072,8064],[8073,8065],[8074,8066],[8075,8067],[8076,8068],[8077,8069],[8078,8070],[8079,8071],[8088,8080],[8089,8081],[8090,8082],[8091,8083],[8092,8084],[8093,8085],[8094,8086],[8095,8087],[8104,8096],[8105,8097],[8106,8098],[8107,8099],[8108,8100],[8109,8101],[8110,8102],[8111,8103],[8120,8112],[8121,8113],[8122,8048],[8123,8049],[8124,8115],[8136,8050],[8137,8051],[8138,8052],[8139,8053],[8140,8131],[8152,8144],[8153,8145],[8154,8054],[8155,8055],[8168,8160],[8169,8161],[8170,8058],[8171,8059],[8172,8165],[8184,8056],[8185,8057],[8186,8060],[8187,8061],[8188,8179],[8486,969],[8490,107],[8491,229],[8498,8526],[8544,8560],[8545,8561],[8546,8562],[8547,8563],[8548,8564],[8549,8565],[8550,8566],[8551,8567],[8552,8568],[8553,8569],[8554,8570],[8555,8571],[8556,8572],[8557,8573],[8558,8574],[8559,8575],[8579,8580],[9398,9424],[9399,9425],[9400,9426],[9401,9427],[9402,9428],[9403,9429],[9404,9430],[9405,9431],[9406,9432],[9407,9433],[9408,9434],[9409,9435],[9410,9436],[9411,9437],[9412,9438],[9413,9439],[9414,9440],[9415,9441],[9416,9442],[9417,9443],[9418,9444],[9419,9445],[9420,9446],[9421,9447],[9422,9448],[9423,9449],[11264,11312],[11265,11313],[11266,11314],[11267,11315],[11268,11316],[11269,11317],[11270,11318],[11271,11319],[11272,11320],[11273,11321],[11274,11322],[11275,11323],[11276,11324],[11277,11325],[11278,11326],[11279,11327],[11280,11328],[11281,11329],[11282,11330],[11283,11331],[11284,11332],[11285,11333],[11286,11334],[11287,11335],[11288,11336],[11289,11337],[11290,11338],[11291,11339],[11292,11340],[11293,11341],[11294,11342],[11295,11343],[11296,11344],[11297,11345],[11298,11346],[11299,11347],[11300,11348],[11301,11349],[11302,11350],[11303,11351],[11304,11352],[11305,11353],[11306,11354],[11307,11355],[11308,11356],[11309,11357],[11310,11358],[11311,11359],[11360,11361],[11362,619],[11363,7549],[11364,637],[11367,11368],[11369,11370],[11371,11372],[11373,593],[11374,625],[11375,592],[11376,594],[11378,11379],[11381,11382],[11390,575],[11391,576],[11392,11393],[11394,11395],[11396,11397],[11398,11399],[11400,11401],[11402,11403],[11404,11405],[11406,11407],[11408,11409],[11410,11411],[11412,11413],[11414,11415],[11416,11417],[11418,11419],[11420,11421],[11422,11423],[11424,11425],[11426,11427],[11428,11429],[11430,11431],[11432,11433],[11434,11435],[11436,11437],[11438,11439],[11440,11441],[11442,11443],[11444,11445],[11446,11447],[11448,11449],[11450,11451],[11452,11453],[11454,11455],[11456,11457],[11458,11459],[11460,11461],[11462,11463],[11464,11465],[11466,11467],[11468,11469],[11470,11471],[11472,11473],[11474,11475],[11476,11477],[11478,11479],[11480,11481],[11482,11483],[11484,11485],[11486,11487],[11488,11489],[11490,11491],[11499,11500],[11501,11502],[11506,11507],[42560,42561],[42562,42563],[42564,42565],[42566,42567],[42568,42569],[42570,42571],[42572,42573],[42574,42575],[42576,42577],[42578,42579],[42580,42581],[42582,42583],[42584,42585],[42586,42587],[42588,42589],[42590,42591],[42592,42593],[42594,42595],[42596,42597],[42598,42599],[42600,42601],[42602,42603],[42604,42605],[42624,42625],[42626,42627],[42628,42629],[42630,42631],[42632,42633],[42634,42635],[42636,42637],[42638,42639],[42640,42641],[42642,42643],[42644,42645],[42646,42647],[42648,42649],[42650,42651],[42786,42787],[42788,42789],[42790,42791],[42792,42793],[42794,42795],[42796,42797],[42798,42799],[42802,42803],[42804,42805],[42806,42807],[42808,42809],[42810,42811],[42812,42813],[42814,42815],[42816,42817],[42818,42819],[42820,42821],[42822,42823],[42824,42825],[42826,42827],[42828,42829],[42830,42831],[42832,42833],[42834,42835],[42836,42837],[42838,42839],[42840,42841],[42842,42843],[42844,42845],[42846,42847],[42848,42849],[42850,42851],[42852,42853],[42854,42855],[42856,42857],[42858,42859],[42860,42861],[42862,42863],[42873,42874],[42875,42876],[42877,7545],[42878,42879],[42880,42881],[42882,42883],[42884,42885],[42886,42887],[42891,42892],[42893,613],[42896,42897],[42898,42899],[42902,42903],[42904,42905],[42906,42907],[42908,42909],[42910,42911],[42912,42913],[42914,42915],[42916,42917],[42918,42919],[42920,42921],[42922,614],[42923,604],[42924,609],[42925,620],[42926,618],[42928,670],[42929,647],[42930,669],[42931,43859],[42932,42933],[42934,42935],[42936,42937],[42938,42939],[42940,42941],[42942,42943],[42944,42945],[42946,42947],[42948,42900],[42949,642],[42950,7566],[42951,42952],[42953,42954],[42960,42961],[42966,42967],[42968,42969],[42997,42998],[65313,65345],[65314,65346],[65315,65347],[65316,65348],[65317,65349],[65318,65350],[65319,65351],[65320,65352],[65321,65353],[65322,65354],[65323,65355],[65324,65356],[65325,65357],[65326,65358],[65327,65359],[65328,65360],[65329,65361],[65330,65362],[65331,65363],[65332,65364],[65333,65365],[65334,65366],[65335,65367],[65336,65368],[65337,65369],[65338,65370]]);
const JAVA_SPACE_CHARS=new Set([32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288]);
const JAVA_WHITESPACE=new Set([9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8200, 8201, 8202, 8232, 8233, 8287, 12288]);
const EXTERNAL_PARENTS = new Map([
  ['Landroid/widget/Button;', 'Landroid/widget/TextView;'],
  ['Landroid/widget/TextView;', 'Landroid/view/View;'],
  ['Landroid/widget/LinearLayout;', 'Landroid/view/View;'],
  ['Landroid/app/Activity;', 'Landroid/content/Context;'],
  ['Landroid/content/Context;', 'Ljava/lang/Object;'],
  ['Landroid/view/View;', 'Ljava/lang/Object;'],
  // These device-profile classes already expose concrete fields via the platform.
  // Class.forName must see the same classes rather than report a missing Android VM.
  ['Landroid/os/Build;', 'Ljava/lang/Object;'], ['Landroid/os/Build$VERSION;', 'Ljava/lang/Object;'],
  ['Ljava/lang/String;', 'Ljava/lang/Object;'],
  ['Ljava/lang/Class;', 'Ljava/lang/Object;'], ['Ljava/lang/StringBuilder;', 'Ljava/lang/Object;'],
  ['Ljava/lang/Enum;', 'Ljava/lang/Object;'], ['Ljava/lang/Number;', 'Ljava/lang/Object;'],
  ['Ljava/lang/Integer;', 'Ljava/lang/Number;'], ['Ljava/lang/Long;', 'Ljava/lang/Number;'],
  ['Ljava/lang/Float;', 'Ljava/lang/Number;'], ['Ljava/lang/Double;', 'Ljava/lang/Number;'],
  ['Ljava/lang/Boolean;', 'Ljava/lang/Object;'], ['Ljava/lang/Runtime;', 'Ljava/lang/Object;'],
]);
const EXTERNAL_INTERFACES = new Map([
  ['Ljava/io/Closeable;', ['Ljava/lang/AutoCloseable;']],
  ['Landroid/content/ComponentCallbacks2;',['Landroid/content/ComponentCallbacks;']],
  ['Ljava/lang/Number;',['Ljava/io/Serializable;']],
  ['Ljava/lang/Enum;',['Ljava/lang/Comparable;','Ljava/io/Serializable;']],
  ['Ljava/util/ListIterator;', ['Ljava/util/Iterator;']],
  ['Ljava/lang/String;', ['Ljava/lang/CharSequence;', 'Ljava/io/Serializable;', 'Ljava/lang/Comparable;']],
  // SDK interface metadata only; createFromParcel/newArray still dispatch to actual DEX.
  ['Landroid/os/Parcelable$ClassLoaderCreator;', ['Landroid/os/Parcelable$Creator;']],
]);
EXTERNAL_PARENTS.set(ICU_BREAK, 'Ljava/lang/Object;');
EXTERNAL_PARENTS.set(ICU_BREAK_INSTANCE, ICU_BREAK);
EXTERNAL_INTERFACES.set(ICU_BREAK, ['Ljava/lang/Cloneable;']);
for (const [name, parent] of Object.entries({ Throwable: 'Object', Error: 'Throwable', LinkageError: 'Error', UnsatisfiedLinkError: 'LinkageError',
  Exception: 'Throwable', RuntimeException: 'Exception', NullPointerException: 'RuntimeException', IllegalArgumentException: 'RuntimeException',
  IllegalStateException: 'RuntimeException', IllegalMonitorStateException: 'RuntimeException', ClassCastException: 'RuntimeException',
  IndexOutOfBoundsException: 'RuntimeException', ArrayIndexOutOfBoundsException: 'IndexOutOfBoundsException', ArithmeticException: 'RuntimeException',
  NegativeArraySizeException: 'RuntimeException', ArrayStoreException: 'RuntimeException' }))
  EXTERNAL_PARENTS.set(`Ljava/lang/${name};`, `Ljava/lang/${parent};`);
EXTERNAL_PARENTS.set('Ljava/lang/StringIndexOutOfBoundsException;','Ljava/lang/IndexOutOfBoundsException;');
EXTERNAL_PARENTS.set('Ljava/lang/NumberFormatException;','Ljava/lang/IllegalArgumentException;');
EXTERNAL_PARENTS.set('Ljava/lang/SecurityException;','Ljava/lang/RuntimeException;');
EXTERNAL_PARENTS.set('Ljava/lang/AssertionError;','Ljava/lang/Error;');
EXTERNAL_PARENTS.set('Ljava/lang/ClassNotFoundException;', 'Ljava/lang/Exception;');
EXTERNAL_PARENTS.set('Ljava/lang/CloneNotSupportedException;', 'Ljava/lang/Exception;');
EXTERNAL_PARENTS.set('Ljava/lang/InterruptedException;', 'Ljava/lang/Exception;');
for (const name of ['NoSuchMethodException', 'NoSuchFieldException', 'InstantiationException', 'IllegalAccessException']) EXTERNAL_PARENTS.set(`Ljava/lang/${name};`, 'Ljava/lang/Exception;');
EXTERNAL_PARENTS.set('Ljava/lang/reflect/InvocationTargetException;', 'Ljava/lang/Exception;');
EXTERNAL_PARENTS.set('Ljava/util/ConcurrentModificationException;', 'Ljava/lang/RuntimeException;');
EXTERNAL_PARENTS.set('Ljava/util/NoSuchElementException;', 'Ljava/lang/RuntimeException;');
EXTERNAL_PARENTS.set('Ljava/lang/UnsupportedOperationException;', 'Ljava/lang/RuntimeException;');
// Exported for the bridge audit test (tests/bridge-return-types.test.mjs).
export const SHIMS = new Set([
  'Ljava/lang/Object;-><init>()V', 'Landroid/app/Activity;-><init>()V',
  'Landroid/app/Activity;->onCreate(Landroid/os/Bundle;)V',
  'Landroid/app/Activity;->setContentView(Landroid/view/View;)V',
  'Landroid/widget/LinearLayout;-><init>(Landroid/content/Context;)V',
  'Landroid/widget/LinearLayout;->setOrientation(I)V',
  'Landroid/widget/LinearLayout;->addView(Landroid/view/View;)V',
  'Landroid/widget/TextView;-><init>(Landroid/content/Context;)V',
  'Landroid/widget/Button;-><init>(Landroid/content/Context;)V',
  'Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V',
  'Landroid/widget/TextView;->setTextSize(F)V',
  'Landroid/view/View;->setOnClickListener(Landroid/view/View$OnClickListener;)V',
  'Ljava/lang/Integer;->toString(I)Ljava/lang/String;',
  'Ljava/lang/String;->valueOf(I)Ljava/lang/String;',
  'Lkotlin/jvm/internal/Intrinsics;->checkNotNullParameter(Ljava/lang/Object;Ljava/lang/String;)V',
  'Lkotlin/jvm/internal/Intrinsics;->checkNotNullExpressionValue(Ljava/lang/Object;Ljava/lang/String;)V',
  'Lkotlin/jvm/internal/Intrinsics;->checkNotNull(Ljava/lang/Object;)V',
]);
const addBridge = (owner, signatures) => { for (const signature of signatures) { SHIMS.add(`L${owner};->${signature}`); BRIDGE_OWNERS.add(`L${owner};`); } };
// Every class with at least one registered bridge method exists for Class.forName (java.lang.System, java.lang.Math, ...).
let BRIDGE_INDEX = null;
const parseParameters = text => { const out = []; for (let i = 0; i < text.length;) { const start = i; while (text[i] === '[') i++; if (text[i] === 'L') i = text.indexOf(';', i); i++; out.push(text.slice(start, i)); } return out; };
const BRIDGE_OWNERS = new Set([...SHIMS].map(key => key.slice(0, key.indexOf('->'))));
addBridge('java/lang/Integer',['rotateLeft(II)I','rotateRight(II)I','lowestOneBit(I)I','highestOneBit(I)I']);
addBridge('java/lang/Integer',['compare(II)I','compareUnsigned(II)I','signum(I)I','reverseBytes(I)I','reverse(I)I','sum(II)I','max(II)I','min(II)I','divideUnsigned(II)I','remainderUnsigned(II)I','toUnsignedLong(I)J','parseUnsignedInt(Ljava/lang/String;)I']);
addBridge('java/lang/Long',['reverseBytes(J)J','reverse(J)J','sum(JJ)J','max(JJ)J','min(JJ)J','divideUnsigned(JJ)J','remainderUnsigned(JJ)J']);
addBridge('java/lang/Short',['reverseBytes(S)S','toUnsignedInt(S)I','compare(SS)I']);
addBridge('java/lang/Character',['reverseBytes(C)C']);
addBridge('java/lang/Byte',['toUnsignedInt(B)I','toUnsignedLong(B)J','compare(BB)I']);
for(const [box,primitive] of [['Integer','I'],['Short','S'],['Byte','B'],['Character','C'],['Boolean','Z'],['Long','J'],['Float','F'],['Double','D']])addBridge('java/lang/'+box,[`hashCode(${primitive})I`]); // static Xxx.hashCode(primitive)
addBridge('java/lang/Long',['compare(JJ)I','compareUnsigned(JJ)I','signum(J)I']);
addBridge('java/lang/Integer',['toString(II)Ljava/lang/String;','toHexString(I)Ljava/lang/String;','toOctalString(I)Ljava/lang/String;','toBinaryString(I)Ljava/lang/String;','toUnsignedString(I)Ljava/lang/String;','toUnsignedString(II)Ljava/lang/String;']);
addBridge('java/lang/Long',['toString(J)Ljava/lang/String;','toString(JI)Ljava/lang/String;','toOctalString(J)Ljava/lang/String;','toBinaryString(J)Ljava/lang/String;','toUnsignedString(J)Ljava/lang/String;','toUnsignedString(JI)Ljava/lang/String;']);
addBridge('java/lang/Long',['rotateLeft(JI)J','rotateRight(JI)J','lowestOneBit(J)J','highestOneBit(J)J']);
addBridge('java/lang/Integer', ['bitCount(I)I', 'numberOfLeadingZeros(I)I', 'numberOfTrailingZeros(I)I']);
addBridge('java/lang/Long',['bitCount(J)I','numberOfLeadingZeros(J)I','numberOfTrailingZeros(J)I']);
addBridge('java/lang/Runtime', ['availableProcessors()I']);
addBridge('java/lang/System', ['getProperty(Ljava/lang/String;)Ljava/lang/String;', 'getProperty(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;', 'setProperty(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;', 'clearProperty(Ljava/lang/String;)Ljava/lang/String;']);
addBridge('java/lang/Long', ['getLong(Ljava/lang/String;)Ljava/lang/Long;', 'getLong(Ljava/lang/String;J)Ljava/lang/Long;', 'getLong(Ljava/lang/String;Ljava/lang/Long;)Ljava/lang/Long;']);
addBridge('java/lang/Integer', ['getInteger(Ljava/lang/String;)Ljava/lang/Integer;', 'getInteger(Ljava/lang/String;I)Ljava/lang/Integer;', 'getInteger(Ljava/lang/String;Ljava/lang/Integer;)Ljava/lang/Integer;', 'decode(Ljava/lang/String;)Ljava/lang/Integer;']);
addBridge('java/lang/Boolean', ['getBoolean(Ljava/lang/String;)Z']);
addBridge('java/lang/Math', ['min(JJ)J','max(JJ)J','abs(J)J']);
for (const key of ICU_BREAK_KEYS) SHIMS.add(key);
addBridge('java/lang/Math',['copySign(DD)D','copySign(FF)F','nextAfter(DD)D','ulp(D)D','IEEEremainder(DD)D','cosh(D)D','expm1(D)D','log1p(D)D','pow(DD)D','log(D)D','exp(D)D','sqrt(D)D','hypot(DD)D','cos(D)D','sin(D)D','rint(D)D','ceil(D)D','floor(D)D','signum(D)D','signum(F)F','round(F)I','round(D)J']);
for(const type of ['F','D'])addBridge('java/lang/Math',[`min(${type}${type})${type}`,`max(${type}${type})${type}`,`abs(${type})${type}`]);
EXTERNAL_PARENTS.set('Ljava/util/concurrent/CancellationException;', 'Ljava/lang/IllegalStateException;');
addBridge('java/util/concurrent/CancellationException',['<init>()V','<init>(Ljava/lang/String;)V']);
addBridge('java/util/Locale',['hashCode()I']);
EXTERNAL_PARENTS.set('Ljava/util/Properties;', 'Ljava/util/Hashtable;');
EXTERNAL_PARENTS.set('Ljava/util/Hashtable;', 'Ljava/util/Dictionary;');
EXTERNAL_PARENTS.set('Ljava/util/Dictionary;', 'Ljava/lang/Object;');
EXTERNAL_INTERFACES.set('Ljava/util/Hashtable;', ['Ljava/util/Map;', 'Ljava/lang/Cloneable;', 'Ljava/io/Serializable;']);
addBridge('java/util/Properties',['<init>()V','getProperty(Ljava/lang/String;)Ljava/lang/String;','getProperty(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;','setProperty(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/Object;']);
addBridge('java/security/AccessController',['doPrivileged(Ljava/security/PrivilegedAction;)Ljava/lang/Object;','doPrivileged(Ljava/security/PrivilegedExceptionAction;)Ljava/lang/Object;','doPrivileged(Ljava/security/PrivilegedAction;Ljava/security/AccessControlContext;)Ljava/lang/Object;','doPrivileged(Ljava/security/PrivilegedExceptionAction;Ljava/security/AccessControlContext;)Ljava/lang/Object;']);
addBridge('java/lang/System',['getSecurityManager()Ljava/lang/SecurityManager;']);
addBridge('libcore/util/NativeAllocationRegistry',['createMalloced(Ljava/lang/ClassLoader;J)Llibcore/util/NativeAllocationRegistry;','registerNativeAllocation(Ljava/lang/Object;J)Ljava/lang/Runnable;']);
EXTERNAL_PARENTS.set(TEXT_LAYOUT_CLEANER,'Ljava/lang/Object;');
EXTERNAL_INTERFACES.set(TEXT_LAYOUT_CLEANER,['Ljava/lang/Runnable;']);
addBridge(TEXT_LAYOUT_CLEANER.slice(1,-1),['run()V']);
EXTERNAL_PARENTS.set(COLOR_FILTER_CLEANER,'Ljava/lang/Object;');
EXTERNAL_INTERFACES.set(COLOR_FILTER_CLEANER,['Ljava/lang/Runnable;']);
addBridge(COLOR_FILTER_CLEANER.slice(1,-1),['run()V']);
EXTERNAL_PARENTS.set(RENDER_NODE_CLEANER,'Ljava/lang/Object;');
EXTERNAL_INTERFACES.set(RENDER_NODE_CLEANER,['Ljava/lang/Runnable;']);
addBridge(RENDER_NODE_CLEANER.slice(1,-1),['run()V']);
EXTERNAL_PARENTS.set(REGEX_CLEANER,'Ljava/lang/Object;');
EXTERNAL_INTERFACES.set(REGEX_CLEANER,['Ljava/lang/Runnable;']);
addBridge(REGEX_CLEANER.slice(1,-1),['run()V']);
addBridge('libcore/util/NativeAllocationRegistry',['<init>(Ljava/lang/ClassLoader;JJ)V']);
addBridge('java/lang/Throwable',['initCause(Ljava/lang/Throwable;)Ljava/lang/Throwable;']);
addBridge('android/content/res/Configuration',['isLayoutSizeAtLeast(I)Z']);
addBridge('java/lang/Double', ['doubleToRawLongBits(D)J', 'doubleToLongBits(D)J', 'longBitsToDouble(J)D', 'parseDouble(Ljava/lang/String;)D', 'toString(D)Ljava/lang/String;', 'valueOf(Ljava/lang/String;)Ljava/lang/Double;']);
addBridge('java/lang/Float', ['toString(F)Ljava/lang/String;', 'valueOf(Ljava/lang/String;)Ljava/lang/Float;']);
addBridge('java/lang/Float', ['parseFloat(Ljava/lang/String;)F', 'intBitsToFloat(I)F', 'floatToRawIntBits(F)I', 'floatToIntBits(F)I']);
addBridge('java/lang/String',['regionMatches(ILjava/lang/String;II)Z','regionMatches(ZILjava/lang/String;II)Z','compareTo(Ljava/lang/Object;)I']);
addBridge('java/lang/String',['toLowerCase(Ljava/util/Locale;)Ljava/lang/String;','toUpperCase(Ljava/util/Locale;)Ljava/lang/String;']);
EXTERNAL_PARENTS.set('Ljava/security/SecureRandom;', 'Ljava/util/Random;');
addBridge('java/security/SecureRandom', ['<init>()V', 'nextBytes([B)V']);
addBridge('java/lang/Long', ['toHexString(J)Ljava/lang/String;','decode(Ljava/lang/String;)Ljava/lang/Long;']);
addBridge('java/util/Arrays',['copyOf([Ljava/lang/Object;ILjava/lang/Class;)[Ljava/lang/Object;','copyOfRange([Ljava/lang/Object;IILjava/lang/Class;)[Ljava/lang/Object;']);
for(const owner of ['Collection','Set','List','ArrayList','Vector','concurrent/CopyOnWriteArrayList'])addBridge('java/util/'+owner,['toArray([Ljava/lang/Object;)[Ljava/lang/Object;','toArray()[Ljava/lang/Object;']);
for(const [owner,type]of [['Float','F'],['Double','D']])addBridge('java/lang/'+owner,[`isNaN(${type})Z`,`isInfinite(${type})Z`,`isFinite(${type})Z`,`compare(${type}${type})I`]);
addBridge('android/os/Trace', ['traceBegin(JLjava/lang/String;)V', 'traceEnd(J)V', 'isTagEnabled(J)Z']);
addBridge('java/lang/Object',['notify()V','notifyAll()V','wait()V','wait(J)V','wait(JI)V']);
addBridge('java/lang/Object', ['getClass()Ljava/lang/Class;', 'hashCode()I', 'equals(Ljava/lang/Object;)Z', 'toString()Ljava/lang/String;', 'clone()Ljava/lang/Object;']);
addBridge('java/lang/Class', ['getName()Ljava/lang/String;', 'getSimpleName()Ljava/lang/String;', 'getSuperclass()Ljava/lang/Class;', 'isInterface()Z',
  'isArray()Z', 'isPrimitive()Z', 'getComponentType()Ljava/lang/Class;', 'isAssignableFrom(Ljava/lang/Class;)Z', 'isInstance(Ljava/lang/Object;)Z',
  'forName(Ljava/lang/String;)Ljava/lang/Class;', 'forName(Ljava/lang/String;ZLjava/lang/ClassLoader;)Ljava/lang/Class;',
  'desiredAssertionStatus()Z', 'isEnum()Z', 'getEnumConstants()[Ljava/lang/Object;']);
addBridge('java/lang/Class',['getAnnotation(Ljava/lang/Class;)Ljava/lang/annotation/Annotation;','getDeclaredAnnotation(Ljava/lang/Class;)Ljava/lang/annotation/Annotation;','isAnnotationPresent(Ljava/lang/Class;)Z','getAnnotations()[Ljava/lang/annotation/Annotation;','getDeclaredAnnotations()[Ljava/lang/annotation/Annotation;']);
addBridge('java/lang/Class', ['getCanonicalName()Ljava/lang/String;', 'getDeclaringClass()Ljava/lang/Class;', 'getEnclosingClass()Ljava/lang/Class;',
  'getResource(Ljava/lang/String;)Ljava/net/URL;','getResourceAsStream(Ljava/lang/String;)Ljava/io/InputStream;','getEnclosingMethod()Ljava/lang/reflect/Method;', 'getEnclosingConstructor()Ljava/lang/reflect/Constructor;', 'isAnonymousClass()Z', 'isLocalClass()Z', 'isMemberClass()Z', 'getInterfaces()[Ljava/lang/Class;', 'getModifiers()I', 'getClassLoader()Ljava/lang/ClassLoader;']);
addBridge('java/lang/Class', ['newInstance()Ljava/lang/Object;', 'getDeclaredConstructor([Ljava/lang/Class;)Ljava/lang/reflect/Constructor;',
  'cast(Ljava/lang/Object;)Ljava/lang/Object;',
  'asSubclass(Ljava/lang/Class;)Ljava/lang/Class;',
  'getConstructor([Ljava/lang/Class;)Ljava/lang/reflect/Constructor;', 'getConstructors()[Ljava/lang/reflect/Constructor;', 'getDeclaredConstructors()[Ljava/lang/reflect/Constructor;',
  'getDeclaredMethod(Ljava/lang/String;[Ljava/lang/Class;)Ljava/lang/reflect/Method;', 'getMethod(Ljava/lang/String;[Ljava/lang/Class;)Ljava/lang/reflect/Method;',
  'getDeclaredMethods()[Ljava/lang/reflect/Method;', 'getDeclaredField(Ljava/lang/String;)Ljava/lang/reflect/Field;', 'getField(Ljava/lang/String;)Ljava/lang/reflect/Field;',
  'getDeclaredFields()[Ljava/lang/reflect/Field;']);
EXTERNAL_PARENTS.set('Ljava/lang/reflect/Array;','Ljava/lang/Object;');
{ const existing = EXTERNAL_INTERFACES.get('Ljava/lang/Class;') ?? []; EXTERNAL_INTERFACES.set('Ljava/lang/Class;', [...new Set([...existing, 'Ljava/io/Serializable;', 'Ljava/lang/reflect/Type;', 'Ljava/lang/reflect/AnnotatedElement;', 'Ljava/lang/reflect/GenericDeclaration;'])]); } // java.lang.Class implements these
addBridge('java/lang/reflect/Array',['newInstance(Ljava/lang/Class;I)Ljava/lang/Object;','newInstance(Ljava/lang/Class;[I)Ljava/lang/Object;','getLength(Ljava/lang/Object;)I','get(Ljava/lang/Object;I)Ljava/lang/Object;','set(Ljava/lang/Object;ILjava/lang/Object;)V']);
EXTERNAL_PARENTS.set('Ljava/lang/ClassLoader;', 'Ljava/lang/Object;');
addBridge('java/lang/ClassLoader', ['getSystemClassLoader()Ljava/lang/ClassLoader;', 'loadClass(Ljava/lang/String;)Ljava/lang/Class;', 'getParent()Ljava/lang/ClassLoader;']);
EXTERNAL_PARENTS.set('Ljava/lang/reflect/AccessibleObject;', 'Ljava/lang/Object;');
EXTERNAL_PARENTS.set('Ljava/lang/reflect/Executable;', 'Ljava/lang/reflect/AccessibleObject;');
for (const name of ['Method', 'Constructor', 'Field']) {
  EXTERNAL_PARENTS.set(`Ljava/lang/reflect/${name};`, name === 'Field' ? 'Ljava/lang/reflect/AccessibleObject;' : 'Ljava/lang/reflect/Executable;');
  addBridge(`java/lang/reflect/${name}`, ['getName()Ljava/lang/String;', 'getDeclaringClass()Ljava/lang/Class;', 'getModifiers()I']);
  addBridge(`java/lang/reflect/${name}`, ['equals(Ljava/lang/Object;)Z', 'hashCode()I','getAnnotations()[Ljava/lang/annotation/Annotation;','getDeclaredAnnotations()[Ljava/lang/annotation/Annotation;','getAnnotation(Ljava/lang/Class;)Ljava/lang/annotation/Annotation;','getDeclaredAnnotation(Ljava/lang/Class;)Ljava/lang/annotation/Annotation;','isAnnotationPresent(Ljava/lang/Class;)Z']);
}
// java.lang.reflect.Member (interface of Method/Constructor/Field); AccessibleObject implements AnnotatedElement.
EXTERNAL_PARENTS.set('Ljava/lang/reflect/Member;', 'Ljava/lang/Object;');
for (const name of ['Method', 'Constructor', 'Field']) EXTERNAL_INTERFACES.set(`Ljava/lang/reflect/${name};`, ['Ljava/lang/reflect/Member;']);
addBridge('java/lang/reflect/Member', ['getName()Ljava/lang/String;', 'getDeclaringClass()Ljava/lang/Class;', 'getModifiers()I']);
addBridge('java/lang/reflect/AccessibleObject', ['setAccessible(Z)V', 'isAccessible()Z', 'trySetAccessible()Z']);
addBridge('java/lang/reflect/Executable', ['getParameterTypes()[Ljava/lang/Class;', 'getParameterCount()I']);
addBridge('java/lang/reflect/Method', ['invoke(Ljava/lang/Object;[Ljava/lang/Object;)Ljava/lang/Object;', 'getReturnType()Ljava/lang/Class;', 'isSynthetic()Z', 'isBridge()Z']);
addBridge('java/lang/reflect/Constructor', ['newInstance([Ljava/lang/Object;)Ljava/lang/Object;']);
addBridge('java/lang/reflect/Field', ['getType()Ljava/lang/Class;', 'get(Ljava/lang/Object;)Ljava/lang/Object;', 'set(Ljava/lang/Object;Ljava/lang/Object;)V']);
for (const [type, name] of [['I', 'Int'], ['J', 'Long'], ['Z', 'Boolean'], ['B', 'Byte'], ['S', 'Short'], ['C', 'Char'], ['F', 'Float'], ['D', 'Double']]) {
  addBridge('java/lang/reflect/Field', [`get${name}(Ljava/lang/Object;)${type}`, `set${name}(Ljava/lang/Object;${type})V`]);
}
// Interface methods that reflective callers look up on the interface itself; virtual dispatch still resolves the receiver's implementation.
addBridge('java/io/Closeable', ['close()V']); addBridge('java/lang/AutoCloseable', ['close()V']); addBridge('java/io/Flushable', ['flush()V']);
addBridge('java/lang/reflect/InvocationTargetException', ['getTargetException()Ljava/lang/Throwable;']);
const BOX_TYPES = { Z: 'Ljava/lang/Boolean;', B: 'Ljava/lang/Byte;', S: 'Ljava/lang/Short;', C: 'Ljava/lang/Character;', I: 'Ljava/lang/Integer;', J: 'Ljava/lang/Long;', F: 'Ljava/lang/Float;', D: 'Ljava/lang/Double;' };
for (const [type, owner] of Object.entries(BOX_TYPES)) {
  if (!EXTERNAL_PARENTS.has(owner)) EXTERNAL_PARENTS.set(owner, type === 'C' || type === 'Z' ? 'Ljava/lang/Object;' : 'Ljava/lang/Number;');
  EXTERNAL_INTERFACES.set(owner,['Ljava/lang/Comparable;','Ljava/io/Serializable;']);
  addBridge(owner.slice(1,-1),[`<init>(${type})V`,`compareTo(${owner})I`,'compareTo(Ljava/lang/Object;)I','hashCode()I','equals(Ljava/lang/Object;)Z']);
  if (type !== 'I' && type !== 'Z') addBridge(owner.slice(1, -1), [`valueOf(${type})${owner}`]);
  addBridge(owner.slice(1, -1), [`${type === 'C' ? 'char' : type === 'Z' ? 'boolean' : { B: 'byte', S: 'short', I: 'int', J: 'long', F: 'float', D: 'double' }[type]}Value()${type}`]);
}
EXTERNAL_PARENTS.set('Ljava/lang/AbstractStringBuilder;','Ljava/lang/Object;');
EXTERNAL_INTERFACES.set('Ljava/lang/AbstractStringBuilder;',['Ljava/lang/Appendable;','Ljava/lang/CharSequence;']);
for(const builder of ['StringBuilder','StringBuffer']){
 EXTERNAL_PARENTS.set(`Ljava/lang/${builder};`,'Ljava/lang/AbstractStringBuilder;');
 EXTERNAL_INTERFACES.set(`Ljava/lang/${builder};`,['Ljava/io/Serializable;','Ljava/lang/CharSequence;']);
 addBridge('java/lang/'+builder, ['<init>()V', '<init>(Ljava/lang/String;)V', '<init>(I)V', 'toString()Ljava/lang/String;', 'length()I', 'charAt(I)C', 'subSequence(II)Ljava/lang/CharSequence;']);
 addBridge('java/lang/'+builder, [`append([CII)Ljava/lang/${builder};`, `append([C)Ljava/lang/${builder};`]);
 addBridge('java/lang/'+builder, [`append(Ljava/lang/CharSequence;II)Ljava/lang/${builder};`]);
 // The synthetic covariant bridges javac emits for Appendable (what an Appendable.append call resolves to).
 addBridge('java/lang/'+builder, ['append(Ljava/lang/CharSequence;)Ljava/lang/Appendable;', 'append(Ljava/lang/CharSequence;II)Ljava/lang/Appendable;', 'append(C)Ljava/lang/Appendable;']);
 const self=`Ljava/lang/${builder};`;
 addBridge('java/lang/'+builder, [`delete(II)${self}`,`deleteCharAt(I)${self}`,'setCharAt(IC)V','setLength(I)V',`replace(IILjava/lang/String;)${self}`,`reverse()${self}`,'indexOf(Ljava/lang/String;)I','indexOf(Ljava/lang/String;I)I','lastIndexOf(Ljava/lang/String;)I','lastIndexOf(Ljava/lang/String;I)I','capacity()I','ensureCapacity(I)V','trimToSize()V','substring(I)Ljava/lang/String;','substring(II)Ljava/lang/String;','codePointAt(I)I',`appendCodePoint(I)${self}`,'getChars(II[CI)V',`insert(I[C)${self}`,`insert(I[CII)${self}`,`insert(ILjava/lang/CharSequence;II)${self}`]);
 for (const t of ['Ljava/lang/String;','Ljava/lang/Object;','Ljava/lang/CharSequence;','I','J','Z','C']) addBridge('java/lang/'+builder, [`insert(I${t})${self}`]);
}
for (const type of ['Ljava/lang/String;', 'Ljava/lang/Object;', 'Ljava/lang/CharSequence;', 'I', 'J', 'F', 'D', 'Z', 'C']) {
  addBridge('java/lang/StringBuilder', [`append(${type})Ljava/lang/StringBuilder;`]);
  addBridge('java/lang/StringBuffer', [`append(${type})Ljava/lang/StringBuffer;`]);
  addBridge('java/lang/String', [`valueOf(${type})Ljava/lang/String;`]);
}
addBridge('java/lang/Character',['isWhitespace(C)Z','isWhitespace(I)Z','isSpaceChar(C)Z','isSpaceChar(I)Z']);
addBridge('android/graphics/Canvas',['setCompatibilityVersion(I)V']);
addBridge('java/lang/System',['logW(Ljava/lang/String;)V','logW(Ljava/lang/String;Ljava/lang/Throwable;)V','lineSeparator()Ljava/lang/String;']);
addBridge('java/lang/Character',['isSurrogate(C)Z','isSurrogatePair(CC)Z','toTitleCase(C)C','toTitleCase(I)I','getType(C)I','getType(I)I','codePointBefore(Ljava/lang/CharSequence;I)I']);
addBridge('java/lang/Character',['getDirectionality(C)B','getDirectionality(I)B','charCount(I)I','codePointAt(Ljava/lang/CharSequence;I)I','isHighSurrogate(C)Z','isLowSurrogate(C)Z','toCodePoint(CC)I','toUpperCase(C)C','toUpperCase(I)I','toLowerCase(C)C','toLowerCase(I)I','isDigit(C)Z','isDigit(I)Z','isLetter(C)Z','isLetter(I)Z','isLetterOrDigit(C)Z','isLetterOrDigit(I)Z','isUpperCase(C)Z','isUpperCase(I)Z','isLowerCase(C)Z','isLowerCase(I)Z','digit(CI)I','digit(II)I','forDigit(II)C']);
addBridge('java/lang/String',['getBytes()[B','getBytes(Ljava/lang/String;)[B','getBytes(Ljava/nio/charset/Charset;)[B','<init>([B)V','<init>([BII)V','<init>([BI)V','<init>([BIII)V','<init>([BLjava/lang/String;)V','<init>([BLjava/nio/charset/Charset;)V','<init>([BIILjava/lang/String;)V','<init>([BIILjava/nio/charset/Charset;)V']);
addBridge('java/lang/String',['<init>()V','<init>([C)V','<init>([CII)V','<init>(Ljava/lang/String;)V','getChars(II[CI)V','toCharArray()[C']);
addBridge('java/lang/String', ['length()I', 'isEmpty()Z', 'charAt(I)C', 'equals(Ljava/lang/Object;)Z', 'hashCode()I',
  'toString()Ljava/lang/String;', 'substring(I)Ljava/lang/String;', 'substring(II)Ljava/lang/String;',
  'startsWith(Ljava/lang/String;)Z', 'endsWith(Ljava/lang/String;)Z', 'indexOf(Ljava/lang/String;)I', 'indexOf(I)I',
  'concat(Ljava/lang/String;)Ljava/lang/String;']);
addBridge('java/lang/String', ['indexOf(II)I', 'indexOf(Ljava/lang/String;I)I', 'lastIndexOf(I)I', 'lastIndexOf(II)I',
  'lastIndexOf(Ljava/lang/String;)I', 'lastIndexOf(Ljava/lang/String;I)I', 'startsWith(Ljava/lang/String;I)Z',
  'compareTo(Ljava/lang/String;)I', 'trim()Ljava/lang/String;', 'subSequence(II)Ljava/lang/CharSequence;']);
addBridge('java/lang/String', ['contains(Ljava/lang/CharSequence;)Z', 'equalsIgnoreCase(Ljava/lang/String;)Z', 'compareToIgnoreCase(Ljava/lang/String;)I', 'codePointAt(I)I', 'intern()Ljava/lang/String;', 'repeat(I)Ljava/lang/String;', 'isBlank()Z',
  'contentEquals(Ljava/lang/CharSequence;)Z', 'toLowerCase()Ljava/lang/String;', 'toUpperCase()Ljava/lang/String;']);
addBridge('java/lang/String', ['copyValueOf([C)Ljava/lang/String;']);
addBridge('java/lang/String', ['split(Ljava/lang/String;I)[Ljava/lang/String;', 'split(Ljava/lang/String;)[Ljava/lang/String;']);
addBridge('java/lang/String', ['replace(CC)Ljava/lang/String;', 'replace(Ljava/lang/CharSequence;Ljava/lang/CharSequence;)Ljava/lang/String;']);
addBridge('java/lang/System', ['loadLibrary(Ljava/lang/String;)V', 'load(Ljava/lang/String;)V',
  'arraycopy(Ljava/lang/Object;ILjava/lang/Object;II)V', 'identityHashCode(Ljava/lang/Object;)I', 'currentTimeMillis()J', 'nanoTime()J']);
addBridge('java/lang/Runtime', ['getRuntime()Ljava/lang/Runtime;', 'loadLibrary(Ljava/lang/String;)V', 'load(Ljava/lang/String;)V']);
addBridge('java/lang/Enum', ['<init>(Ljava/lang/String;I)V', 'name()Ljava/lang/String;', 'ordinal()I', 'toString()Ljava/lang/String;']);
addBridge('java/lang/Enum', ['valueOf(Ljava/lang/Class;Ljava/lang/String;)Ljava/lang/Enum;', 'compareTo(Ljava/lang/Enum;)I', 'compareTo(Ljava/lang/Object;)I', 'getDeclaringClass()Ljava/lang/Class;']);
addBridge('java/lang/Integer', ['valueOf(I)Ljava/lang/Integer;', 'intValue()I', 'parseInt(Ljava/lang/String;)I', 'parseInt(Ljava/lang/String;I)I']);
addBridge('java/lang/Boolean', ['parseBoolean(Ljava/lang/String;)Z', 'valueOf(Z)Ljava/lang/Boolean;', 'booleanValue()Z']);
addBridge('java/lang/Math', ['min(II)I', 'max(II)I', 'abs(I)I']);
addBridge('android/text/TextUtils', ['isEmpty(Ljava/lang/CharSequence;)Z', 'equals(Ljava/lang/CharSequence;Ljava/lang/CharSequence;)Z']);
for (const [name, type] of [['AtomicReference', 'Ljava/lang/Object;'], ['AtomicInteger', 'I'], ['AtomicLong', 'J'], ['AtomicBoolean', 'Z']]) {
  const owner = `java/util/concurrent/atomic/${name}`;
  EXTERNAL_PARENTS.set(`L${owner};`, ['AtomicReference', 'AtomicBoolean'].includes(name) ? 'Ljava/lang/Object;' : 'Ljava/lang/Number;');
  addBridge(owner, [`<init>()V`, `<init>(${type})V`, `get()${type}`, `set(${type})V`, `lazySet(${type})V`,
    `getAndSet(${type})${type}`, `compareAndSet(${type}${type})Z`, `weakCompareAndSet(${type}${type})Z`]);
  if (type === 'I' || type === 'J') addBridge(owner, [`getAndIncrement()${type}`, `incrementAndGet()${type}`, `getAndDecrement()${type}`, `decrementAndGet()${type}`, `getAndAdd(${type})${type}`, `addAndGet(${type})${type}`, 'intValue()I', 'longValue()J']);
}
const MAP_TYPES = ['HashMap', 'WeakHashMap', 'LinkedHashMap', 'concurrent/ConcurrentHashMap'];
EXTERNAL_PARENTS.set('Ljava/util/concurrent/atomic/AtomicReferenceArray;', 'Ljava/lang/Object;');
EXTERNAL_INTERFACES.set('Ljava/util/concurrent/atomic/AtomicReferenceArray;', ['Ljava/io/Serializable;']);
addBridge('java/util/concurrent/atomic/AtomicReferenceArray', ['<init>(I)V','<init>([Ljava/lang/Object;)V','length()I','get(I)Ljava/lang/Object;','set(ILjava/lang/Object;)V','lazySet(ILjava/lang/Object;)V','getAndSet(ILjava/lang/Object;)Ljava/lang/Object;','compareAndSet(ILjava/lang/Object;Ljava/lang/Object;)Z','weakCompareAndSet(ILjava/lang/Object;Ljava/lang/Object;)Z']);
const LIST_TYPES = ['ArrayList'];
for (const name of [...MAP_TYPES, ...LIST_TYPES]) {
  const owner = `java/util/${name}`;
  EXTERNAL_PARENTS.set(`L${owner};`, MAP_TYPES.includes(name) ? 'Ljava/util/AbstractMap;' : 'Ljava/util/AbstractList;');
  EXTERNAL_INTERFACES.set(`L${owner};`, MAP_TYPES.includes(name) ? ['Ljava/util/Map;'] : ['Ljava/util/List;', 'Ljava/util/Collection;', 'Ljava/lang/Iterable;']);
  addBridge(owner, ['<init>()V', '<init>(I)V', 'size()I', 'isEmpty()Z', 'clear()V']);
  if (MAP_TYPES.includes(name)) addBridge(owner, ['put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;', 'get(Ljava/lang/Object;)Ljava/lang/Object;',
    'containsKey(Ljava/lang/Object;)Z', 'remove(Ljava/lang/Object;)Ljava/lang/Object;', 'entrySet()Ljava/util/Set;', 'keySet()Ljava/util/Set;', 'values()Ljava/util/Collection;', 'putAll(Ljava/util/Map;)V']);
  else addBridge(owner, ['<init>(Ljava/util/Collection;)V', 'addAll(Ljava/util/Collection;)Z', 'addAll(ILjava/util/Collection;)Z', 'add(Ljava/lang/Object;)Z', 'add(ILjava/lang/Object;)V', 'get(I)Ljava/lang/Object;', 'set(ILjava/lang/Object;)Ljava/lang/Object;',
    'remove(I)Ljava/lang/Object;', 'remove(Ljava/lang/Object;)Z', 'contains(Ljava/lang/Object;)Z', 'indexOf(Ljava/lang/Object;)I', 'iterator()Ljava/util/Iterator;', 'toArray()[Ljava/lang/Object;']);
}
for (const name of MAP_TYPES) addBridge(`java/util/${name}`, ['<init>(IF)V', '<init>(Ljava/util/Map;)V']);
addBridge('java/util/LinkedHashMap', ['<init>(IFZ)V']);
addBridge('java/util/LinkedHashMap', ['eldest()Ljava/util/Map$Entry;']);
EXTERNAL_INTERFACES.set('Ljava/util/concurrent/ConcurrentHashMap;', ['Ljava/util/concurrent/ConcurrentMap;', 'Ljava/util/Map;', 'Ljava/io/Serializable;']);
EXTERNAL_INTERFACES.set('Ljava/util/concurrent/ConcurrentMap;', ['Ljava/util/Map;']);
addBridge('java/util/concurrent/ConcurrentHashMap', ['<init>(IFI)V', 'putIfAbsent(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;',
  'remove(Ljava/lang/Object;Ljava/lang/Object;)Z', 'replace(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;',
  'replace(Ljava/lang/Object;Ljava/lang/Object;Ljava/lang/Object;)Z', 'mappingCount()J', 'containsValue(Ljava/lang/Object;)Z']);
for (const name of ['AbstractMap', 'AbstractList', 'AbstractCollection', 'AbstractSet']) {
  EXTERNAL_PARENTS.set(`Ljava/util/${name};`, ['AbstractList', 'AbstractSet'].includes(name) ? 'Ljava/util/AbstractCollection;' : 'Ljava/lang/Object;');
  addBridge(`java/util/${name}`, ['<init>()V']);
}
for (const [type, interfaces] of Object.entries({ AbstractMap: ['Map'], AbstractList: ['List'], AbstractCollection: ['Collection'], AbstractSet: ['Set'],
  List: ['Collection'], Set: ['Collection'], Queue: ['Collection'], Deque: ['Queue'], Collection: [] })) {
  EXTERNAL_INTERFACES.set(`Ljava/util/${type};`, type === 'Collection' ? ['Ljava/lang/Iterable;'] : interfaces.map(name => `Ljava/util/${name};`));
}
addBridge('java/util/AbstractList', ['iterator()Ljava/util/Iterator;']);
addBridge('java/util/AbstractCollection', ['isEmpty()Z','addAll(Ljava/util/Collection;)Z']);
addBridge('java/util/Set', ['iterator()Ljava/util/Iterator;', 'size()I', 'isEmpty()Z']);
addBridge('java/util/Collection', ['iterator()Ljava/util/Iterator;', 'size()I', 'isEmpty()Z']);
for(const owner of ['java/util/Collection','java/util/Set','java/util/AbstractCollection','java/util/ArrayList','java/util/Vector','java/util/concurrent/CopyOnWriteArrayList','java/util/concurrent/CopyOnWriteArraySet']) addBridge(owner,['removeAll(Ljava/util/Collection;)Z']);
addBridge('java/util/Collection',['contains(Ljava/lang/Object;)Z']);
addBridge('java/util/Iterator', ['hasNext()Z', 'next()Ljava/lang/Object;', 'remove()V']);
const HOST_MAP_ENTRY='Lapkweb/bridge/MapEntry;';
EXTERNAL_PARENTS.set(HOST_MAP_ENTRY,'Ljava/lang/Object;');EXTERNAL_INTERFACES.set(HOST_MAP_ENTRY,['Ljava/util/Map$Entry;']);
for(const owner of ['java/util/Map$Entry',HOST_MAP_ENTRY.slice(1,-1)])addBridge(owner,['getKey()Ljava/lang/Object;','getValue()Ljava/lang/Object;','setValue(Ljava/lang/Object;)Ljava/lang/Object;','equals(Ljava/lang/Object;)Z','hashCode()I','toString()Ljava/lang/String;']);
addBridge('java/util/Collections', ['emptyList()Ljava/util/List;', 'emptyMap()Ljava/util/Map;', 'singleton(Ljava/lang/Object;)Ljava/util/Set;', 'singletonList(Ljava/lang/Object;)Ljava/util/List;', 'unmodifiableList(Ljava/util/List;)Ljava/util/List;']);
addBridge('java/util/Collections', ['synchronizedMap(Ljava/util/Map;)Ljava/util/Map;']);
EXTERNAL_PARENTS.set('Ljava/util/Collections$SynchronizedMap;', 'Ljava/lang/Object;');
EXTERNAL_INTERFACES.set('Ljava/util/Collections$SynchronizedMap;', ['Ljava/util/Map;']);
for (const key of [...SHIMS]) if (key.startsWith('Ljava/util/HashMap;->') && !key.includes('-><init>')) SHIMS.add(key.replace('Ljava/util/HashMap;', 'Ljava/util/Collections$SynchronizedMap;'));
for (const type of ['[I', '[J', '[B', '[C', '[S', '[F', '[D', '[Z', '[Ljava/lang/Object;']) addBridge('java/util/Arrays', [`copyOf(${type}I)${type}`, `copyOfRange(${type}II)${type}`]);
// The rest of the primitive-array overloads of java.util.Arrays: toString / hashCode / natural-order sort / binarySearch (plain and ranged) for every primitive component type.
for (const c of ['Z', 'B', 'S', 'C', 'I', 'J', 'F', 'D']) addBridge('java/util/Arrays', [`toString([${c})Ljava/lang/String;`, `hashCode([${c})I`, ...(c === 'Z' ? [] : [`sort([${c})V`, `sort([${c}II)V`, `binarySearch([${c}${c})I`, `binarySearch([${c}II${c})I`])]);
addBridge('java/util/Arrays', ['deepHashCode([Ljava/lang/Object;)I']);
for (const component of ['Z','B','S','C','I','J','F','D','Ljava/lang/Object;']) addBridge('java/util/Arrays', [`fill([${component}${component})V`,`fill([${component}II${component})V`,`equals([${component}[${component})Z`]);
EXTERNAL_PARENTS.set('Ljava/util/Arrays$ArrayList;','Ljava/util/AbstractList;');
EXTERNAL_INTERFACES.set('Ljava/util/Arrays$ArrayList;',['Ljava/util/RandomAccess;','Ljava/io/Serializable;']);
addBridge('java/util/Arrays$ArrayList',['size()I','get(I)Ljava/lang/Object;','set(ILjava/lang/Object;)Ljava/lang/Object;']);
addBridge('java/util/Arrays', ['asList([Ljava/lang/Object;)Ljava/util/List;', 'binarySearch([II)I', 'binarySearch([JJ)I', 'binarySearch([FF)I', 'binarySearch([IIII)I', 'binarySearch([Ljava/lang/Object;Ljava/lang/Object;)I', 'hashCode([J)I', 'hashCode([I)I', 'toString([Ljava/lang/Object;)Ljava/lang/String;']);
addBridge('java/util/Arrays',['sort([Ljava/lang/Object;IILjava/util/Comparator;)V','sort([Ljava/lang/Object;Ljava/util/Comparator;)V']);
EXTERNAL_PARENTS.set('Ljava/lang/ref/Reference;', 'Ljava/lang/Object;');
for (const name of ['WeakReference', 'SoftReference']) {
  EXTERNAL_PARENTS.set(`Ljava/lang/ref/${name};`, 'Ljava/lang/ref/Reference;');
  addBridge(`java/lang/ref/${name}`, ['<init>(Ljava/lang/Object;)V', '<init>(Ljava/lang/Object;Ljava/lang/ref/ReferenceQueue;)V']);
}
addBridge('java/lang/ref/Reference', ['get()Ljava/lang/Object;', 'clear()V', 'refersTo(Ljava/lang/Object;)Z']);
EXTERNAL_PARENTS.set('Ljava/lang/Thread;', 'Ljava/lang/Object;');
EXTERNAL_PARENTS.set('Landroid/os/Looper;', 'Ljava/lang/Object;');
EXTERNAL_PARENTS.set('Landroid/view/Choreographer;', 'Ljava/lang/Object;');
addBridge('java/lang/Thread', ['currentThread()Ljava/lang/Thread;', 'getName()Ljava/lang/String;', 'isAlive()Z', 'getId()J']);
addBridge('android/os/Looper', ['getMainLooper()Landroid/os/Looper;', 'myLooper()Landroid/os/Looper;', 'getThread()Ljava/lang/Thread;', 'isCurrentThread()Z']);
// ContextImpl.getMainLooper() returns the process main thread's Looper for every Context (Activity, Application, Service, wrappers).
addBridge('android/content/Context', ['getMainLooper()Landroid/os/Looper;']);
addBridge('android/content/ContextWrapper', ['getMainLooper()Landroid/os/Looper;']);
addBridge('android/os/SystemClock', ['uptimeMillis()J', 'elapsedRealtime()J', 'elapsedRealtimeNanos()J']);
for (const name of ['Throwable', 'Error', 'LinkageError', 'UnsatisfiedLinkError', 'Exception', 'RuntimeException', 'NullPointerException',
  'IllegalArgumentException', 'IllegalStateException', 'IllegalMonitorStateException', 'ClassCastException', 'IndexOutOfBoundsException',
  'ArrayIndexOutOfBoundsException', 'ArithmeticException', 'UnsupportedOperationException']) {
  addBridge(`java/lang/${name}`, ['<init>()V', '<init>(Ljava/lang/String;)V', '<init>(Ljava/lang/Throwable;)V', '<init>(Ljava/lang/String;Ljava/lang/Throwable;)V']);
}
for(const name of ['ConcurrentModificationException','NoSuchElementException'])addBridge('java/util/'+name,['<init>()V','<init>(Ljava/lang/String;)V','<init>(Ljava/lang/Throwable;)V','<init>(Ljava/lang/String;Ljava/lang/Throwable;)V']);
addBridge('java/lang/ArrayIndexOutOfBoundsException',['<init>(I)V']);
addBridge('java/lang/AssertionError', ['<init>()V', '<init>(Ljava/lang/Object;)V', '<init>(Ljava/lang/String;Ljava/lang/Throwable;)V']);
// Further platform exception types with the four standard Throwable constructors (parents declared by their hosts or EXTERNAL_PARENTS above).
for (const name of ['java/util/concurrent/ExecutionException', 'java/util/concurrent/TimeoutException', 'java/util/concurrent/CancellationException', 'java/util/concurrent/RejectedExecutionException', 'java/io/IOException', 'java/io/FileNotFoundException', 'java/io/EOFException', 'java/io/UnsupportedEncodingException', 'java/util/zip/ZipException', 'java/net/MalformedURLException', 'java/lang/SecurityException',
  'java/lang/ClassNotFoundException', 'java/lang/NoSuchMethodException', 'java/lang/NoSuchFieldException', 'java/lang/InstantiationException', 'java/lang/IllegalAccessException', 'java/lang/InterruptedException', 'java/lang/CloneNotSupportedException',
  'java/lang/NegativeArraySizeException', 'java/lang/ArrayStoreException', 'java/lang/StringIndexOutOfBoundsException', 'java/lang/NumberFormatException', 'java/lang/reflect/InvocationTargetException'])
  addBridge(name, ['<init>()V', '<init>(Ljava/lang/String;)V', '<init>(Ljava/lang/Throwable;)V', '<init>(Ljava/lang/String;Ljava/lang/Throwable;)V']);
addBridge('java/lang/Throwable', ['getMessage()Ljava/lang/String;', 'getCause()Ljava/lang/Throwable;', 'toString()Ljava/lang/String;']);
// More platform exception/error types (libcore hierarchy; each has the four standard Throwable constructors, which the generic Throwable bridge implements).
const STD_THROWABLE_CTORS = ['<init>()V', '<init>(Ljava/lang/String;)V', '<init>(Ljava/lang/Throwable;)V', '<init>(Ljava/lang/String;Ljava/lang/Throwable;)V'];
for (const [name, parent] of Object.entries({
  'java/security/GeneralSecurityException': 'java/lang/Exception', 'java/security/KeyException': 'java/security/GeneralSecurityException', 'java/security/InvalidKeyException': 'java/security/KeyException',
  'java/security/InvalidAlgorithmParameterException': 'java/security/GeneralSecurityException', 'java/security/NoSuchAlgorithmException': 'java/security/GeneralSecurityException',
  'java/security/SignatureException': 'java/security/GeneralSecurityException', 'java/security/KeyStoreException': 'java/security/GeneralSecurityException',
  'java/security/spec/InvalidKeySpecException': 'java/security/GeneralSecurityException', 'java/security/spec/InvalidParameterSpecException': 'java/security/GeneralSecurityException',
  'java/security/InvalidParameterException': 'java/lang/IllegalArgumentException', 'java/security/cert/CertificateException': 'java/security/GeneralSecurityException',
  'java/security/cert/CertificateEncodingException': 'java/security/cert/CertificateException', 'java/security/cert/CertificateParsingException': 'java/security/cert/CertificateException',
  'java/security/cert/CertPathValidatorException': 'java/security/GeneralSecurityException', 'java/security/cert/CertPathBuilderException': 'java/security/GeneralSecurityException',
  'java/security/cert/CRLException': 'java/security/GeneralSecurityException', 'javax/crypto/IllegalBlockSizeException': 'java/security/GeneralSecurityException',
  'javax/crypto/BadPaddingException': 'java/security/GeneralSecurityException', 'javax/crypto/ShortBufferException': 'java/security/GeneralSecurityException',
  'javax/crypto/NoSuchPaddingException': 'java/security/GeneralSecurityException', 'java/io/ObjectStreamException': 'java/io/IOException',
  'java/io/InvalidObjectException': 'java/io/ObjectStreamException', 'java/io/NotSerializableException': 'java/io/ObjectStreamException', 'java/io/StreamCorruptedException': 'java/io/ObjectStreamException',
  'java/nio/file/FileSystemException': 'java/io/IOException', 'java/nio/file/FileSystemLoopException': 'java/nio/file/FileSystemException',
  'java/lang/VirtualMachineError': 'java/lang/Error', 'java/lang/OutOfMemoryError': 'java/lang/VirtualMachineError', 'java/lang/InternalError': 'java/lang/VirtualMachineError',
  'java/lang/StackOverflowError': 'java/lang/VirtualMachineError', 'java/lang/IncompatibleClassChangeError': 'java/lang/LinkageError', 'java/lang/NoSuchMethodError': 'java/lang/IncompatibleClassChangeError',
  'java/lang/NoSuchFieldError': 'java/lang/IncompatibleClassChangeError', 'java/lang/IllegalAccessError': 'java/lang/IncompatibleClassChangeError', 'java/lang/AbstractMethodError': 'java/lang/IncompatibleClassChangeError',
  'java/lang/NoClassDefFoundError': 'java/lang/LinkageError', 'java/lang/ExceptionInInitializerError': 'java/lang/LinkageError', 'java/lang/ClassFormatError': 'java/lang/LinkageError',
  'android/content/res/Resources$NotFoundException': 'java/lang/RuntimeException', 'android/view/InflateException': 'java/lang/RuntimeException',
  'android/view/inspector/InspectionCompanion$UninitializedPropertyMapException': 'java/lang/RuntimeException'
})) {
  if (!EXTERNAL_PARENTS.has(`L${name};`)) EXTERNAL_PARENTS.set(`L${name};`, `L${parent};`);
  addBridge(name, STD_THROWABLE_CTORS);
}
const SET_TYPES = ['java/util/HashSet', 'java/util/LinkedHashSet', 'java/util/concurrent/CopyOnWriteArraySet', 'java/util/Collections$SingletonSet'];
for (const owner of SET_TYPES) {
  EXTERNAL_PARENTS.set(`L${owner};`, owner==='java/util/LinkedHashSet'?'Ljava/util/HashSet;':'Ljava/util/AbstractSet;'); EXTERNAL_INTERFACES.set(`L${owner};`, ['Ljava/util/Set;', 'Ljava/util/Collection;', 'Ljava/lang/Iterable;']);
  if (owner.endsWith('HashSet') && !owner.includes('concurrent')) addBridge(owner, ['<init>(Ljava/util/Collection;)V']);
  addBridge(owner, ['<init>()V', '<init>(I)V', 'add(Ljava/lang/Object;)Z', 'remove(Ljava/lang/Object;)Z', 'contains(Ljava/lang/Object;)Z', 'size()I', 'isEmpty()Z', 'clear()V', 'iterator()Ljava/util/Iterator;']);
}
EXTERNAL_PARENTS.set('Ljava/util/concurrent/CopyOnWriteArrayList;', 'Ljava/lang/Object;');
EXTERNAL_INTERFACES.set('Ljava/util/concurrent/CopyOnWriteArrayList;', ['Ljava/util/List;', 'Ljava/util/Collection;', 'Ljava/lang/Iterable;']);
for (const key of [...SHIMS]) if (key.startsWith('Ljava/util/ArrayList;->')) SHIMS.add(key.replace('Ljava/util/ArrayList;', 'Ljava/util/concurrent/CopyOnWriteArrayList;'));
EXTERNAL_PARENTS.set('Ljava/util/Vector;', 'Ljava/util/AbstractList;');
EXTERNAL_PARENTS.set('Ljava/util/Stack;', 'Ljava/util/Vector;');
EXTERNAL_INTERFACES.set('Ljava/util/Vector;', ['Ljava/util/List;', 'Ljava/util/Collection;', 'Ljava/lang/Iterable;']);
for (const key of [...SHIMS]) if (key.startsWith('Ljava/util/ArrayList;->')) SHIMS.add(key.replace('Ljava/util/ArrayList;', 'Ljava/util/Vector;'));
addBridge('java/util/Stack', ['<init>()V', 'push(Ljava/lang/Object;)Ljava/lang/Object;', 'pop()Ljava/lang/Object;', 'peek()Ljava/lang/Object;', 'empty()Z', 'search(Ljava/lang/Object;)I']);
EXTERNAL_PARENTS.set('Ljava/util/EmptyStackException;', 'Ljava/lang/RuntimeException;');
for (const name of ['Buffer', 'ByteBuffer', 'ByteOrder']) EXTERNAL_PARENTS.set(`Ljava/nio/${name};`, name === 'ByteBuffer' ? 'Ljava/nio/Buffer;' : 'Ljava/lang/Object;');
EXTERNAL_PARENTS.set('Ljava/nio/CharBuffer;', 'Ljava/nio/Buffer;');
EXTERNAL_INTERFACES.set('Ljava/nio/CharBuffer;', ['Ljava/lang/CharSequence;']);
addBridge('java/nio/CharBuffer', ['wrap([C)Ljava/nio/CharBuffer;', 'wrap([CII)Ljava/nio/CharBuffer;', 'length()I', 'charAt(I)C', 'toString()Ljava/lang/String;', 'subSequence(II)Ljava/nio/CharBuffer;', 'subSequence(II)Ljava/lang/CharSequence;', 'array()[C', 'arrayOffset()I', 'hasArray()Z', 'isReadOnly()Z', 'get()C', 'get(I)C', 'get([C)Ljava/nio/CharBuffer;', 'get([CII)Ljava/nio/CharBuffer;', 'put(C)Ljava/nio/CharBuffer;', 'put([C)Ljava/nio/CharBuffer;', 'put([CII)Ljava/nio/CharBuffer;']);
for (const signature of ['position()I','limit()I','capacity()I','remaining()I','hasRemaining()Z','position(I)Ljava/nio/CharBuffer;','limit(I)Ljava/nio/CharBuffer;','clear()Ljava/nio/CharBuffer;','flip()Ljava/nio/CharBuffer;','rewind()Ljava/nio/CharBuffer;']) addBridge('java/nio/CharBuffer', [signature]);
for (const name of ['BufferUnderflowException', 'BufferOverflowException', 'ReadOnlyBufferException']) EXTERNAL_PARENTS.set(`Ljava/nio/${name};`, 'Ljava/lang/RuntimeException;');
addBridge('java/nio/ByteOrder', ['nativeOrder()Ljava/nio/ByteOrder;', 'toString()Ljava/lang/String;']);
addBridge('java/nio/ByteBuffer', ['wrap([B)Ljava/nio/ByteBuffer;', 'wrap([BII)Ljava/nio/ByteBuffer;', 'allocate(I)Ljava/nio/ByteBuffer;', 'allocateDirect(I)Ljava/nio/ByteBuffer;', 'get([B)Ljava/nio/ByteBuffer;', 'get([BII)Ljava/nio/ByteBuffer;', 'put([B)Ljava/nio/ByteBuffer;', 'put([BII)Ljava/nio/ByteBuffer;', 'getShort()S', 'getShort(I)S', 'putShort(S)Ljava/nio/ByteBuffer;', 'putShort(IS)Ljava/nio/ByteBuffer;', 'getChar()C', 'getChar(I)C', 'putChar(C)Ljava/nio/ByteBuffer;', 'putChar(IC)Ljava/nio/ByteBuffer;', 'isDirect()Z', 'asCharBuffer()Ljava/nio/CharBuffer;', 'order(Ljava/nio/ByteOrder;)Ljava/nio/ByteBuffer;', 'order()Ljava/nio/ByteOrder;', 'array()[B', 'arrayOffset()I', 'hasArray()Z', 'isReadOnly()Z']);
for (const owner of ['java/nio/Buffer', 'java/nio/ByteBuffer']) addBridge(owner, ['position()I','limit()I','capacity()I','remaining()I','hasRemaining()Z',`position(I)L${owner};`,`limit(I)L${owner};`,`clear()L${owner};`,`flip()L${owner};`,`rewind()L${owner};`]);
for (const [suffix,type] of [['','B'],['Int','I'],['Float','F'],['Long','J'],['Double','D']]) addBridge('java/nio/ByteBuffer', [`get${suffix}()${type}`,`get${suffix}(I)${type}`,`put${suffix}(${type})Ljava/nio/ByteBuffer;`,`put${suffix}(I${type})Ljava/nio/ByteBuffer;`]);
EXTERNAL_PARENTS.set('Ljava/lang/ThreadLocal;', 'Ljava/lang/Object;');
addBridge('java/lang/ThreadLocal', ['<init>()V', 'get()Ljava/lang/Object;', 'set(Ljava/lang/Object;)V', 'remove()V', 'initialValue()Ljava/lang/Object;', 'withInitial(Ljava/util/function/Supplier;)Ljava/lang/ThreadLocal;']);
EXTERNAL_PARENTS.set('Ljava/util/Random;', 'Ljava/lang/Object;');
addBridge('java/util/Random', ['<init>()V', '<init>(J)V', 'nextInt()I', 'nextInt(I)I', 'nextLong()J', 'nextBoolean()Z', 'setSeed(J)V', 'nextBytes([B)V', 'nextDouble()D', 'nextFloat()F', 'nextGaussian()D']);
EXTERNAL_PARENTS.set('Ljava/util/concurrent/ThreadLocalRandom;', 'Ljava/util/Random;');
addBridge('java/util/concurrent/ThreadLocalRandom', ['current()Ljava/util/concurrent/ThreadLocalRandom;', 'nextInt(II)I']);
const TIME_UNITS = ['NANOSECONDS', 'MICROSECONDS', 'MILLISECONDS', 'SECONDS', 'MINUTES', 'HOURS', 'DAYS'];
const TIME_FACTORS = [1n, 1000n, 1000000n, 1000000000n, 60000000000n, 3600000000000n, 86400000000000n];
EXTERNAL_PARENTS.set('Ljava/util/concurrent/TimeUnit;', 'Ljava/lang/Enum;');
for (const name of ['Nanos', 'Micros', 'Millis', 'Seconds', 'Minutes', 'Hours', 'Days']) addBridge('java/util/concurrent/TimeUnit', [`to${name}(J)J`]);
addBridge('java/util/concurrent/TimeUnit', ['convert(JLjava/util/concurrent/TimeUnit;)J', 'valueOf(Ljava/lang/String;)Ljava/util/concurrent/TimeUnit;', 'values()[Ljava/util/concurrent/TimeUnit;']);
const REENTRANT_LOCK='Ljava/util/concurrent/locks/ReentrantLock;';
EXTERNAL_PARENTS.set(REENTRANT_LOCK,'Ljava/lang/Object;');EXTERNAL_INTERFACES.set(REENTRANT_LOCK,['Ljava/util/concurrent/locks/Lock;','Ljava/io/Serializable;']);
addBridge('java/util/concurrent/locks/ReentrantLock',['<init>()V','<init>(Z)V','lock()V','lockInterruptibly()V','tryLock()Z','tryLock(JLjava/util/concurrent/TimeUnit;)Z','unlock()V','getHoldCount()I','isHeldByCurrentThread()Z','isLocked()Z','isFair()Z']);
const RW_LOCK = 'Ljava/util/concurrent/locks/ReentrantReadWriteLock;';
EXTERNAL_PARENTS.set(RW_LOCK, 'Ljava/lang/Object;');
EXTERNAL_INTERFACES.set(RW_LOCK, ['Ljava/util/concurrent/locks/ReadWriteLock;', 'Ljava/io/Serializable;']);
addBridge(RW_LOCK.slice(1, -1), ['<init>()V', '<init>(Z)V', 'readLock()Ljava/util/concurrent/locks/ReentrantReadWriteLock$ReadLock;',
  'readLock()Ljava/util/concurrent/locks/Lock;', 'writeLock()Ljava/util/concurrent/locks/ReentrantReadWriteLock$WriteLock;', 'writeLock()Ljava/util/concurrent/locks/Lock;',
  'getReadHoldCount()I', 'getReadLockCount()I', 'getWriteHoldCount()I', 'isWriteLocked()Z', 'isWriteLockedByCurrentThread()Z', 'isFair()Z']);
for (const kind of ['ReadLock', 'WriteLock']) {
  const owner = RW_LOCK.slice(1, -1) + '$' + kind;
  EXTERNAL_PARENTS.set(`L${owner};`, 'Ljava/lang/Object;'); EXTERNAL_INTERFACES.set(`L${owner};`, ['Ljava/util/concurrent/locks/Lock;', 'Ljava/io/Serializable;']);
  addBridge(owner, [`<init>(${RW_LOCK})V`, 'lock()V', 'lockInterruptibly()V', 'tryLock()Z', 'tryLock(JLjava/util/concurrent/TimeUnit;)Z', 'unlock()V']);
}
addBridge('java/util/concurrent/locks/ReentrantReadWriteLock$WriteLock', ['getHoldCount()I', 'isHeldByCurrentThread()Z']);
for (const [name, type] of [['AtomicReferenceFieldUpdater', 'Ljava/lang/Object;'], ['AtomicIntegerFieldUpdater', 'I'], ['AtomicLongFieldUpdater', 'J']]) {
  const owner = `java/util/concurrent/atomic/${name}`;
  EXTERNAL_PARENTS.set(`L${owner};`, 'Ljava/lang/Object;');
  addBridge(owner, [`newUpdater(Ljava/lang/Class;${type === 'Ljava/lang/Object;' ? 'Ljava/lang/Class;' : ''}Ljava/lang/String;)L${owner};`,
    `get(Ljava/lang/Object;)${type}`, `set(Ljava/lang/Object;${type})V`, `lazySet(Ljava/lang/Object;${type})V`,
    `getAndSet(Ljava/lang/Object;${type})${type}`, `compareAndSet(Ljava/lang/Object;${type}${type})Z`, `weakCompareAndSet(Ljava/lang/Object;${type}${type})Z`]);
  if(type==='I'||type==='J')addBridge(owner,[`getAndIncrement(Ljava/lang/Object;)${type}`,`getAndDecrement(Ljava/lang/Object;)${type}`,`incrementAndGet(Ljava/lang/Object;)${type}`,`decrementAndGet(Ljava/lang/Object;)${type}`,`getAndAdd(Ljava/lang/Object;${type})${type}`,`addAndGet(Ljava/lang/Object;${type})${type}`]);
}
EXTERNAL_PARENTS.set('Ljava/util/concurrent/ThreadPoolExecutor;', 'Ljava/lang/Object;');
EXTERNAL_INTERFACES.set('Ljava/util/concurrent/ThreadPoolExecutor;', ['Ljava/util/concurrent/Executor;', 'Ljava/util/concurrent/ExecutorService;']);
addBridge('java/util/concurrent/Executors', ['newFixedThreadPool(I)Ljava/util/concurrent/ExecutorService;', 'newFixedThreadPool(ILjava/util/concurrent/ThreadFactory;)Ljava/util/concurrent/ExecutorService;']);
addBridge('java/util/concurrent/ThreadPoolExecutor', ['execute(Ljava/lang/Runnable;)V', 'shutdown()V', 'isShutdown()Z']);
EXTERNAL_PARENTS.set('Landroid/os/Handler;', 'Ljava/lang/Object;');
addBridge('android/os/Handler', ['<init>()V', '<init>(Landroid/os/Looper;)V', '<init>(Landroid/os/Looper;Landroid/os/Handler$Callback;)V',
  '<init>(Landroid/os/Handler$Callback;)V', 'getLooper()Landroid/os/Looper;', 'createAsync(Landroid/os/Looper;)Landroid/os/Handler;', 'post(Ljava/lang/Runnable;)Z']);
EXTERNAL_PARENTS.set('Ljava/util/ArrayDeque;', 'Ljava/lang/Object;');
EXTERNAL_INTERFACES.set('Ljava/util/ArrayDeque;', ['Ljava/util/Deque;', 'Ljava/util/Queue;', 'Ljava/util/Collection;', 'Ljava/lang/Iterable;']);
addBridge('java/util/ArrayDeque', ['toArray()[Ljava/lang/Object;', '<init>(Ljava/util/Collection;)V', '<init>()V', '<init>(I)V', 'size()I', 'isEmpty()Z', 'clear()V', 'add(Ljava/lang/Object;)Z', 'addFirst(Ljava/lang/Object;)V', 'addLast(Ljava/lang/Object;)V',
  'offer(Ljava/lang/Object;)Z', 'offerFirst(Ljava/lang/Object;)Z', 'offerLast(Ljava/lang/Object;)Z', 'push(Ljava/lang/Object;)V',
  'pop()Ljava/lang/Object;', 'remove()Ljava/lang/Object;', 'removeFirst()Ljava/lang/Object;', 'removeLast()Ljava/lang/Object;',
  'poll()Ljava/lang/Object;', 'pollFirst()Ljava/lang/Object;', 'pollLast()Ljava/lang/Object;', 'getFirst()Ljava/lang/Object;', 'getLast()Ljava/lang/Object;',
  'peek()Ljava/lang/Object;', 'peekFirst()Ljava/lang/Object;', 'peekLast()Ljava/lang/Object;', 'iterator()Ljava/util/Iterator;']);
addBridge('android/util/Log', ['isLoggable(Ljava/lang/String;I)Z', 'println(ILjava/lang/String;Ljava/lang/String;)I', 'wtf(Ljava/lang/String;Ljava/lang/String;)I', 'wtf(Ljava/lang/String;Ljava/lang/String;Ljava/lang/Throwable;)I', 'wtf(Ljava/lang/String;Ljava/lang/Throwable;)I', 'getStackTraceString(Ljava/lang/Throwable;)Ljava/lang/String;']);
addBridge('android/util/Log', ['w(Ljava/lang/String;Ljava/lang/Throwable;)I']);
for (const name of ['v', 'd', 'i', 'w', 'e']) addBridge('android/util/Log', [`${name}(Ljava/lang/String;Ljava/lang/String;)I`, `${name}(Ljava/lang/String;Ljava/lang/String;Ljava/lang/Throwable;)I`]);
const descriptor = name => name.startsWith('L') && name.endsWith(';') ? name : `L${name.replaceAll('.', '/')};`;
// Classes redefined by a second ClassLoader live under an internal alias descriptor (Lfoo/Bar$$ldr2;); every user-visible name is the original.
export const LOADER_ALIAS = /\$\$ldr\d+;$/;
const PRIMITIVE_NAMES = { Z: 'boolean', B: 'byte', S: 'short', C: 'char', I: 'int', J: 'long', F: 'float', D: 'double', V: 'void' };
export const dottedName = name => name.replace(LOADER_ALIAS, ';').slice(1, -1).replaceAll('/', '.');
const ref = id => ({ ref: id });
const isNull = value => value === null || value === 0;
const describeRegister = value => value === undefined ? 'an uninitialized register' : value === null ? 'null' : typeof value === 'bigint' ? `a long (${value})` : typeof value === 'object' ? (value.ref !== undefined ? 'an object reference' : 'a host object') : `${typeof value} ${String(value).slice(0, 40)}`;
const int = value => { if (typeof value !== 'number' || !Number.isInteger(value)) fail(`Expected int register, got ${describeRegister(value)}`); return value | 0; };
// Dalvik keeps boolean/byte/short/char/int results as 32-bit ints; host bridges written in JS may answer
// with true/false, so results are normalized by the method's declared return type at the boundary.
const hostReturn = (method, value) => {
  const type = method?.result ?? method?.signature?.slice(method.signature.indexOf(')') + 1);
  return typeof value === 'boolean' && /^[ZBSCI]$/.test(type ?? '') ? (value ? 1 : 0) : value;
};
const equal = (a, b) => (isNull(a) && isNull(b)) || (a && b && typeof a === 'object' && typeof b === 'object' ? a.ref === b.ref : a === b);
const signed16 = n => (n << 16) >> 16;
const signed8 = n => (n << 24) >> 24;
const WIDE_HIGH = Symbol('wide-high');
const defaultValue = type => type === 'J' || type === 'D' ? 0n : type.startsWith('L') || type.startsWith('[') ? null : 0;
const wordCount = parameters => parameters.reduce((n, type) => n + (type === 'J' || type === 'D' ? 2 : 1), 0);
const EXTERNAL_INTERFACE_NAMES=new Set([...EXTERNAL_INTERFACES.values()].flat());
// Float/double registers carry IEEE bit patterns; typed-array views reinterpret them (little-endian hosts only, which every browser and Node target is).
const BITS = new ArrayBuffer(8), F32 = new Float32Array(BITS), I32 = new Int32Array(BITS), F64 = new Float64Array(BITS), B64 = new BigInt64Array(BITS);
const floatNumber = bits => { if (typeof bits !== 'number') int(bits); I32[0] = bits; return F32[0]; };
// A NaN produced by arithmetic is the canonical quiet NaN on ART (and the JDK); JS engines may hand back another payload.
const floatBits = n => { if (n !== n) return 0x7fc00000; F32[0] = n; return I32[0]; };
// Parse Java's decimal/hex float grammar as a rational and round once to binary32.
// Number(text)->Math.fround would double-round decimal values near a float midpoint.
function parseJavaFloatBits(input) {
  if(input.length>65536)fail('Float parser exceeds 65536-character VM limit');
  const text=input.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g,''),sign=text.startsWith('-')?0x80000000:0,body=text.replace(/^[+-]/,'');
  if(body==='NaN')return 0x7fc00000;
  if(body==='Infinity')return (sign|0x7f800000)|0;
  let numerator,denominator=1n;
  const hex=/^0[xX]((?:[0-9a-fA-F]+(?:\.[0-9a-fA-F]*)?|\.[0-9a-fA-F]+))[pP]([+-]?\d+)[fFdD]?$/.exec(body);
  const decimal=/^((?:\d+(?:\.\d*)?|\.\d+))(?:[eE]([+-]?\d+))?[fFdD]?$/.exec(body);
  if(hex){const fraction=hex[1].split('.')[1]?.length??0,digits=hex[1].replace('.','').replace(/^0+/,'');if(!digits)return sign|0;
    const exponent=Number(hex[2])-4*fraction,extent=(digits.length-1)*4+exponent;
    if(extent>140)return (sign|0x7f800000)|0;if(extent< -180)return sign|0;
    numerator=BigInt('0x'+digits);if(exponent>=0)numerator<<=BigInt(exponent);else denominator<<=BigInt(-exponent);
  }else if(decimal){const fraction=decimal[1].split('.')[1]?.length??0,digits=decimal[1].replace('.','').replace(/^0+/,'');if(!digits)return sign|0;
    const exponent=Number(decimal[2]??0)-fraction,extent=digits.length-1+exponent;
    if(extent>50)return (sign|0x7f800000)|0;if(extent< -60)return sign|0;
    numerator=BigInt(digits);if(exponent>=0)numerator*=10n**BigInt(exponent);else denominator=10n**BigInt(-exponent);
  }else return null;
  let exponent=numerator.toString(2).length-denominator.toString(2).length;
  if(exponent>=0?numerator<(denominator<<BigInt(exponent)):(numerator<<BigInt(-exponent))<denominator)exponent--;
  const rounded=(n,d)=>{const q=n/d,r=n%d;return q+(r*2n>d||r*2n===d&&(q&1n)!==0n?1n:0n);};
  if(exponent< -126)return (sign|Number(rounded(numerator<<149n,denominator)))|0;
  const shift=23-exponent;let significand=shift>=0?rounded(numerator<<BigInt(shift),denominator):rounded(numerator,denominator<<BigInt(-shift));
  if(significand===(1n<<24n)){significand>>=1n;exponent++;}
  if(exponent>127)return (sign|0x7f800000)|0;
  return (sign|((exponent+127)<<23)|(Number(significand)-0x800000))|0;
}
const doubleNumber = bits => { B64[0] = typeof bits === 'bigint' ? bits : BigInt(bits); return F64[0]; };
const doubleBits = n => { if (n !== n) return 0x7ff8000000000000n; F64[0] = n; return B64[0]; };
const wide = value => { if (typeof value !== 'bigint') fail('Expected wide register pair'); return BigInt.asIntN(64, value); };
const narrowVariant = (value, variant) => variant === 2 ? value : variant === 3 ? int(value) & 1 : variant === 4 ? signed8(int(value)) : variant === 5 ? int(value) & 65535 : variant === 6 ? signed16(int(value)) : variant === 1 ? wide(value) : int(value);
const narrow = (value, type) => /^[L[]/.test(type) ? value : type === 'J' || type === 'D' ? wide(value) : type === 'B' ? signed8(int(value)) : type === 'C' ? int(value) & 65535 : type === 'S' ? signed16(int(value)) : type === 'Z' ? int(value) & 1 : int(value);
const javaInt = n => Number.isNaN(n) ? 0 : n >= 2147483647 ? 2147483647 : n <= -2147483648 ? -2147483648 : Math.trunc(n) | 0;
const javaLong = n => Number.isNaN(n) ? 0n : n >= 2 ** 63 ? 9223372036854775807n : n <= -(2 ** 63) ? -9223372036854775808n : BigInt(Math.trunc(n));
function stringHash(text) { let n = 0; for (let i = 0; i < text.length; i++) n = (Math.imul(n, 31) + text.charCodeAt(i)) | 0; return n; }
function longArithmetic(op, x, y) {
  let result;
  switch (op) {
    case 0: result = x + y; break; case 1: result = x - y; break; case 2: result = x * y; break;
    case 3: if (!y) fail('Long divide by zero'); result = x / y; break;
    case 4: if (!y) fail('Long remainder by zero'); result = x % y; break;
    case 5: result = x & y; break; case 6: result = x | y; break; case 7: result = x ^ y; break;
    case 8: result = x << BigInt(y & 63); break; case 9: result = x >> BigInt(y & 63); break;
    case 10: result = BigInt.asUintN(64, x) >> BigInt(y & 63); break;
    default: fail('Unsupported long arithmetic');
  }
  return BigInt.asIntN(64, result);
}

/** The VM heap: object records by id. Ids are allocated sequentially and objects are never freed (no GC), so an array indexed by id replaces the Map. */
class Heap {
  constructor() { this.list = []; this.size = 0; }
  get(id) { return this.list[id]; }
  has(id) { return this.list[id] !== undefined; }
  set(id, record) { if (this.list[id] === undefined) this.size++; this.list[id] = record; return this; }
  *values() { for (const record of this.list) if (record !== undefined) yield record; }
}

export class APKRuntime {
  constructor(dex, { apkEntries = new Set(), apkReader = null, launcherActivity = null, unsupportedFeatures = [], nativeLibraries = [], apiLevel = 28, platform = null, resources = null, nativeBindings = new Map(), skia = null, icuBreakBackend = null, sqliteBackend = null, tzdata = null, zlibBackend = null, icuConverterBackend = null, maxCallDepth = 2048, maxHeapObjects = 262144, maxInstructionsPerEvent = 10000000, tolerateMissingVoid = false, tolerateMissing = tolerateMissingVoid ? 'void' : 'off' } = {}) {
    if (!Number.isInteger(maxCallDepth) || maxCallDepth < 16 || maxCallDepth > 100000) fail('VM maxCallDepth must be an integer from 16 to 100000');
    if(!Number.isInteger(maxHeapObjects)||maxHeapObjects<1024||maxHeapObjects>262144)fail('VM maxHeapObjects must be an integer from 1024 to 262144');
    this.maxHeapObjects=maxHeapObjects; this.apkEntries=apkEntries; this.apkReader=apkReader;
    // Opt-in tolerant mode for platform methods the lab does not implement: 'void' skips void ones; 'primitives' also answers
    // boolean/byte/short/char/int/long/float/double methods with 0/false; 'all' also answers object methods with null. Every stubbed call is counted and traced (STUB-VOID / STUB-RETURN), so the run
    // doubles as the to-do list of missing bridges; a run that stubbed anything is never treated as validated. The default stays strict.
    if (!['off', 'void', 'primitives', 'all'].includes(tolerateMissing)) fail('VM tolerateMissing must be off, void, primitives or all');
    this.tolerateMissing = tolerateMissing; this.missingVoid = new Map(); this.missingReturns = new Map(); this.missingClasses = new Map();
    this.maxCallDepth = maxCallDepth; this.peakCallDepth = 0;
    if (!Number.isInteger(maxInstructionsPerEvent) || maxInstructionsPerEvent < 1000 || maxInstructionsPerEvent > 20000000) fail('VM maxInstructionsPerEvent must be an integer from 1000 to 20000000');
    this.maxInstructionsPerEvent = maxInstructionsPerEvent;
    this.dex = dex;
    this.classes = dex.resolvedClasses ?? dex.classes;
    this.launcherActivity = launcherActivity;
    this.unsupportedFeatures = unsupportedFeatures;
    this.nativeLibraries = nativeLibraries; this.apiLevel = apiLevel;
    this.platform = platform; this.resources = resources; this.clock = platform?.clock ?? new VMClock();
    this.nativeBindings = nativeBindings instanceof Map ? nativeBindings : new Map(Object.entries(nativeBindings));
    this.executionByOrigin = { apk: { methods: 0, instructions: 0 }, framework: { methods: 0, instructions: 0 }, host: { calls: 0 } };
    this.heap = new Heap(); this.nextId = 1; this.fieldSlots = 0;
    this.jni = null; // JniBridge, installed by loadAPK when the lab supplies a nativeLibraryProvider
    this.classOwners = new Map(); this.dynamicPlain = new Map(); // defining ClassLoader of run-time-loaded classes (table type -> loader ref); first definer per plain name
    this.nextThreadId = 1n;
    // Official kotlinx.coroutines opt-in selects its original Main/Handler delay
    // implementation in this single-threaded web device; it is not a fake Thread.
    // Kotlin kotlinx.coroutines 1.8.1: core/jvm/src/DefaultExecutor.kt.
    this.javaProperties = new Map([['java.vm.name','APK Browser DEX VM'],['os.name','APK Browser VM'],['file.separator','/'],['path.separator',':'],['line.separator','\n'],['kotlinx.coroutines.main.delay','true']]);
    this.depth = 0; this.steps = 0; this.trace = []; this.activity = null; this.root = null; this.clicks = 0;
    this.initialized = new Map(); this.staticFields = new Map(); this.classObjects = new Map(); this.arrayCells = 0; this.initDepth = 0;
    this.collectionCells = 0;
    this.nativeArrays = new Map(); this.nextNativeArrayHandle = 0x100000000n; this.nativeRanges = []; this.nestedRuns = 0; this.maxNestedRuns = 160; this.scheduler = new Scheduler(this); this.callStats = { cached: 0, dispatched: 0, bridged: 0 }; this.lastBridge = null; this.lastBridgeDepth = -1; this.jit = true; this.jitThreshold = JIT_THRESHOLD; this.jitLoops = JIT_LOOPS; this.jitCompiled = 0; this.jitInstructions = 0; this.q = 20000; this.jitDepth = 0; this.thread = null; this.multiThreaded = false; this.monitors = new Map();
    this.skia=skia;this.skiaHost=skia?.createHost?.(this)??null;
    this.icuBreakBackend=icuBreakBackend;this.sqliteBackend=sqliteBackend;this.tzdata=tzdata;this.zlibBackend=zlibBackend;this.icuConverterBackend=icuConverterBackend;
  }
  parent(type) { return type?.startsWith('[') ? 'Ljava/lang/Object;' : this.classes.get(type)?.superclass ?? this.skiaHost?.parent?.(type) ?? this.platform?.parent?.(type) ?? EXTERNAL_PARENTS.get(type) ?? this.platform?.fallbackParent?.(type) ?? null; }
  interfaces(type) { return this.classes.get(type)?.interfaces ?? [...new Set([...(EXTERNAL_INTERFACES.get(type) ?? []), ...(this.skiaHost?.interfaces?.(type) ?? []), ...(this.platform?.interfaces?.(type) ?? [])])]; }
  /** Memoized subtype test (the class graph only grows when more DEX files are loaded, which clears the memo). */
  isSubtype(child, ancestor) {
    const epoch = this.dex.dynamicFiles?.length ?? 0;
    if (this.subtypeEpoch !== epoch) { this.subtypeEpoch = epoch; this.subtypeMemo = new Map(); }
    let row = this.subtypeMemo.get(child);
    if (row === undefined) this.subtypeMemo.set(child, row = new Map());
    let answer = row.get(ancestor);
    if (answer === undefined) row.set(ancestor, answer = this.isSubtypeUncached(child, ancestor));
    return answer;
  }
  isSubtypeUncached(child, ancestor) {
    if(ancestor==='Ljava/lang/Object;'&&child?.startsWith('L')&&child.endsWith(';'))return true;
    if (child?.startsWith('[')) {
      if (['Ljava/lang/Object;', 'Ljava/lang/Cloneable;', 'Ljava/io/Serializable;'].includes(ancestor)) return true;
      if (ancestor?.startsWith('[')) {
        if (child === ancestor) return true;
        return /^[L[]/.test(child.slice(1)) && /^[L[]/.test(ancestor.slice(1)) && this.isSubtype(child.slice(1), ancestor.slice(1));
      }
    }
    return this.ancestorSet(child).has(ancestor);
  }
  /** Every type reachable from `type` through superclass and interface edges, itself included (memoized; cleared when more DEX files are loaded). */
  ancestorSet(type) {
    let sets = this.ancestorSets; if (sets === undefined || this.ancestorEpoch !== (this.dex.dynamicFiles?.length ?? 0)) { sets = this.ancestorSets = new Map(); this.ancestorEpoch = this.dex.dynamicFiles?.length ?? 0; }
    let result = sets.get(type); if (result !== undefined) return result;
    const seen = new Set(), pending = [[type, 0]];
    while (pending.length) {
      const [current, depth] = pending.pop();
      if (!current || seen.has(current)) continue;
      if (depth > 64 || seen.size >= 512) fail('Excessive class/interface hierarchy');
      seen.add(current);
      pending.push([this.parent(current), depth + 1]);
      for (const iface of this.interfaces(current)) pending.push([iface, depth + 1]);
    }
    sets.set(type, seen); return seen;
  }
  activities() { return [...this.dex.classes.keys()].filter(t => this.isSubtype(t, 'Landroid/app/Activity;')); }
  // Execution trace: the first 128 entries are kept forever and the most recent 384 in a ring (the former splice(128,1)-per-call kept exactly this
  // content but moved ~380 elements on every VM call). Entries may be strings or {method, origin} pairs, rendered to text only when `trace` is read.
  record(line) {
    if (this.traceMuted) return; // host plumbing that must not evict APK-visible trace entries (e.g. building WindowInsets for the virtual system bars)
    const ring = this.traceRing ??= { head: [], tail: new Array(384), start: 0, length: 0 };
    if (ring.head.length < 128) { ring.head.push(line); return; }
    if (ring.length === 384) { ring.tail[ring.start] = line; ring.start = (ring.start + 1) % 384; this.traceDropped = (this.traceDropped ?? 0) + 1; return; }
    ring.tail[(ring.start + ring.length++) % 384] = line;
  }
  get trace() {
    const ring = this.traceRing; if (!ring) return [];
    const text = entry => typeof entry === 'string' ? entry : `DEX ${entry.method.key}${entry.origin === 'framework' ? ` [AOSP:${entry.method.dex.filename}]` : ''}`, out = ring.head.map(text);
    for (let i = 0; i < ring.length; i++) out.push(text(ring.tail[(ring.start + i) % 384]));
    return out;
  }
  set trace(entries) { this.traceRing = null; for (const entry of entries) this.record(entry); }
  methodOrigin(method) { return this.dex.bootDexes?.has(method.dex) ? 'framework' : 'apk'; }
  recordMethod(method) {
    // Per-method cache of the origin, its counter object, the evidence row and the (immutable) trace entry: this runs once per Java call.
    let info = method.recordInfo;
    if (info === undefined) {
      const origin = this.methodOrigin(method); this.methodEvidence ??= new Map();
      const evidenceKey = origin + '\0' + method.key; let evidence = this.methodEvidence.get(evidenceKey);
      if (!evidence) {
        if (this.methodEvidence.size < 8192) { evidence = { key: method.key, owner: method.owner, name: method.name, signature: method.signature, origin, filename: method.dex.filename, calls: 0 }; this.methodEvidence.set(evidenceKey, evidence); }
        else this.methodEvidenceTruncated = true;
      }
      info = method.recordInfo = { origin, stats: this.executionByOrigin[origin], evidence, entry: { method, origin } };
    }
    info.stats.methods++;
    if (info.evidence !== undefined && info.evidence.calls < Number.MAX_SAFE_INTEGER) info.evidence.calls++;
    this.record(info.entry);
  }
  executionSnapshot() {
    return { framework: { ...(this.dex.frameworkSummary ?? { dexFiles: [], classes: 0, bytes: 0, shadowedAPKClasses: [], policy: 'no-boot-layer' }) },
      missingVoid: [...this.missingVoid].map(([key, count]) => ({ key, count })), missingReturns: [...this.missingReturns].map(([key, count]) => ({ key, count })), missingClasses: [...this.missingClasses].map(([key, count]) => ({ key, count })), executionByOrigin: { apk: { ...this.executionByOrigin.apk }, framework: { ...this.executionByOrigin.framework }, host: { ...this.executionByOrigin.host } }, callDepth: { limit: this.maxCallDepth, peak: this.peakCallDepth }, heapBudget: { oomCount: this.oomCount ?? 0, objects: this.heap.size, limit: this.maxHeapObjects, arrayCells: this.arrayCells, fieldSlots: this.fieldSlots, collectionCells: this.collectionCells, garbageCollection: !!this.gcEnabled, collections: this.gcStats?.collections ?? 0, freedObjects: this.gcStats?.freed ?? 0, peakLiveAfterCollection: this.gcStats?.peakLiveAfterGc ?? 0 }, instructionBudget: { limit: this.maxInstructionsPerEvent, currentEvent: this.steps }, unicodeCaseBackend: this.unicodeCaseBackend ?? null, methodEvidenceSummary:{uniqueMethods:this.methodEvidence?.size??0,truncated:!!this.methodEvidenceTruncated} };
  }
  compactArguments(method, words, mode) {
    const staticCall = mode === 'static';
    if (words.length !== wordCount(method.parameters) + (staticCall ? 0 : 1)) fail(`Invalid argument count: ${methodKey(method)}`);
    const args = []; let position = 0;
    if (!staticCall) args.push(words[position++]);
    for (const type of method.parameters) { args.push(words[position]); position += type === 'J' || type === 'D' ? 2 : 1; }
    return args;
  }
  object(value) {
    if (value !== null && typeof value === 'object') { const record = this.heap.list[value.ref]; if (record !== undefined) return record; }
    if (isNull(value)) this.throwJava('Ljava/lang/NullPointerException;', 'null object reference');
    fail('Null or invalid object reference');
  }
  initialize(type) {
    const state = this.initialized.get(type);
    if (state?.status === 'failed') throw state.error;
    if (state) return; // Single thread: recursive requests see prepared fields of the initializing class.
    const cls = this.classes.get(type);
    if (!cls) return;
    if (++this.initDepth > 128) { this.initDepth--; fail('Class initialization depth limit exceeded'); }
    this.initialized.set(type, { status: 'initializing' });
    try {
      for (const entry of cls.staticFields) {
        const field = cls.dex.fields[entry.index]; this.storeField(this.staticFields, field.key, defaultValue(field.type));
      }
      if (cls.staticValuesOffset) {
        const cursor = { p: cls.staticValuesOffset }, count = cls.dex.reader.uleb(cursor);
        if (count > cls.staticFields.length) fail(`Invalid encoded static values in ${type}`);
        for (let i = 0; i < count; i++) {
          const field = cls.dex.fields[cls.staticFields[i].index];
          this.staticFields.set(field.key, this.materialize(cls.dex.encodedValue(cursor), field.type));
        }
      }
      if (cls.superclass && !(cls.flags & 0x200)) this.initialize(cls.superclass);
      if (!(cls.flags & 0x200)) {
        const seen = new Set();
        const defaults = (type, depth = 0) => {
          if (seen.has(type)) return; if (depth > 64 || seen.size >= 512) fail('Default interface initialization limit exceeded'); seen.add(type);
          const iface = this.classes.get(type); if (!iface) return;
          for (const parent of iface.interfaces) defaults(parent, depth + 1);
          if ([...iface.methods.values()].some(def => def.method.name !== '<clinit>' && !(def.flags & (0x8 | 0x400 | 0x2)) && def.code)) this.initialize(type);
        };
        for (const type of cls.interfaces) defaults(type);
      }
      const initializer = cls.methods.get('<clinit>()V');
      if (initializer) {
        if (!initializer.code) fail(`Missing class initializer code: ${type}`);
        this.recordMethod(initializer.method);
        this.execute(initializer.method, initializer.code, []);
      }
      this.initialized.set(type, { status: 'initialized' });
    } catch (error) { this.initialized.set(type, { status: 'failed', error }); throw error; }
    finally { this.initDepth--; }
  }
  materialize(value, type) {
    if (!value || typeof value !== 'object' || !value.encoded) return value;
    if(value.encoded==='annotation')return this.annotationObject(value);
    if (value.encoded === 'class') return this.classObject(value.value);
    if (value.encoded === 'enum') return this.readStatic(value.value);
    if (value.encoded === 'array') {
      if (!type.startsWith('[')) fail('Encoded array assigned to non-array field');
      const array = this.newArray(type, value.values.length), target = this.object(array);
      target.elements = value.values.map(v => this.materialize(v, type.slice(1))); return array;
    }
    fail('Unsupported encoded static reference');
  }
  bumpModCount(object){
    object.modCount=((object.modCount??0)+1)|0;
    if(this.isSubtype(object.type,'Ljava/util/AbstractList;'))this.storeField(object.fields,'Ljava/util/AbstractList;->modCount:I',object.modCount);
  }
  storeField(storage, key, value) {
    if (!storage.has(key) && ++this.fieldSlots > 1000000) { this.fieldSlots--; this.outOfMemory('Object/static field storage limit exceeded'); }
    storage.set(key, value);
  }
  resolveField(field) {
    const epoch = this.dex.dynamicFiles?.length ?? 0, cached = field.resolvedField;
    if (cached !== undefined && cached.epoch === epoch && cached.runtime === this) return cached.value;
    const value = this.resolveFieldUncached(field);
    if (Object.isExtensible(field)) field.resolvedField = { epoch, runtime: this, value };
    return value;
  }
  resolveFieldUncached(field) {
    let type = field.owner; const seen = new Set();
    while (type && !seen.has(type)) {
      seen.add(type); const cls = this.classes.get(type);
      if (cls) {
        let index = cls.fieldIndex;
        if (index === undefined) { index = cls.fieldIndex = new Map(); for (const entry of [...cls.fields, ...cls.staticFields]) { const declared = cls.dex.fields[entry.index]; const key = declared.name + ':' + declared.type; if (!index.has(key)) index.set(key, declared); } }
        const declared = index.get(field.ntKey ??= field.name + ':' + field.type);
        if (declared !== undefined) return declared;
      }
      type = this.parent(type);
    }
    const external=this.platform?.resolveExternalField?.(this,field);
    if(external){if(external.name!==field.name||external.type!==field.type||typeof external.owner!=='string')fail('Invalid external field metadata');return {...field,...external,key:`${external.owner}->${external.name}:${external.type}`};}
    return field;
  }
  readStatic(reference) {
    const field = this.resolveField(reference); this.initialize(field.owner);
    if (this.staticFields.has(field.key)) return this.staticFields.get(field.key);
    const skiaValue=this.skiaHost?.readStatic?.(this,field);if(skiaValue?.handled)return skiaValue.value;
    const platformValue = this.platform?.readStatic?.(this, field);
    if (platformValue?.handled) return platformValue.value;
    if (field.owner === 'Landroid/os/Trace;' && field.name === 'TRACE_TAG_RESOURCES') return 1n << 13n;
    if (field.owner === 'Ljava/nio/ByteOrder;' && ['BIG_ENDIAN','LITTLE_ENDIAN'].includes(field.name)) {
      this.byteOrders ??= new Map();
      if (!this.byteOrders.has(field.name)) { const value = this.makeObject(field.owner); this.object(value).byteOrderName = field.name; this.byteOrders.set(field.name,value); }
      return this.byteOrders.get(field.name);
    }
    if (field.owner === 'Ljava/util/concurrent/TimeUnit;' && field.type === field.owner && TIME_UNITS.includes(field.name)) {
      this.timeUnits ??= new Map();
      if (!this.timeUnits.has(field.name)) {
        const value = this.makeObject(field.owner), object = this.object(value), index = TIME_UNITS.indexOf(field.name);
        object.enumName = field.name; object.enumOrdinal = index; object.nanoFactor = TIME_FACTORS[index]; this.timeUnits.set(field.name, value);
      }
      return this.timeUnits.get(field.name);
    }
    if (field.name === 'TYPE' && field.type === 'Ljava/lang/Class;') {
      const primitive = { Integer: 'I', Long: 'J', Boolean: 'Z', Byte: 'B', Short: 'S', Character: 'C', Float: 'F', Double: 'D', Void: 'V' }[field.owner.slice(11, -1)];
      if (primitive) return this.classObject(primitive);
    }
    if (field.owner === 'Landroid/os/Build$VERSION;') {
      if (field.name === 'SDK_INT') return this.apiLevel;
      if (field.name === 'SDK') return String(this.apiLevel);
      if (field.name === 'CODENAME') return 'REL';
    }
    if (field.owner === 'Ljava/lang/Boolean;' && ['TRUE', 'FALSE'].includes(field.name)) {
      const value = this.makeObject(field.owner); this.object(value).boxed = field.name === 'TRUE' ? 1 : 0;
      this.storeField(this.staticFields, field.key, value); return value;
    }
    fail(`Unsupported external static field: ${field.key}`);
  }
  writeStatic(reference, value) {
    const field = this.resolveField(reference); this.initialize(field.owner);
    if (!this.classes.has(field.owner) || !this.staticFields.has(field.key)) fail(`Unresolved static field: ${field.key}`);
    this.staticFields.set(field.key, value);
  }
  classObject(type) {
    if (!this.classObjects.has(type)) { const value = this.makeObject('Ljava/lang/Class;'); this.object(value).classType = type; this.classObjects.set(type, value); }
    return this.classObjects.get(type);
  }
  classAnnotations(type,visibilityFilter=1){
    const cls=this.classes.get(type);if(!cls)return [];
    cls.annotationCache??=new Map();if(cls.annotationCache.has(visibilityFilter))return cls.annotationCache.get(visibilityFilter);
    const result=[];if(cls.annotationsOffset){const b=cls.dex.reader,set=b.u32(cls.annotationsOffset);if(set){const count=b.u32(set);if(count>100000)fail('Excessive DEX class annotations');b.table(count,set+4,4);for(let i=0;i<count;i++){const p=b.u32(set+4+i*4),visibility=b.u8(p);if(visibility>2)fail('Invalid DEX annotation visibility');if(visibility===visibilityFilter)result.push(cls.dex.encodedAnnotation({p:p+1}));}}}
    cls.annotationCache.set(visibilityFilter,result);return result;
  }
  annotationObject(annotation){
    const value=this.makeObject(annotation.type),object=this.object(value);object.annotationValues=annotation.values;return value;
  }
  classNesting(type) {
    const cls = this.classes.get(type);
    if (!cls) return {};
    if (cls.nestingInfo) return cls.nestingInfo;
    const info = cls.nestingInfo = {}, b = cls.dex.reader;
    if (!cls.annotationsOffset) return info;
    const annotations = b.u32(cls.annotationsOffset); if (!annotations) return info;
    const count = b.u32(annotations); b.table(count, annotations + 4, 4);
    for (let i = 0; i < count; i++) {
      const cursor = { p: b.u32(annotations + 4 + i * 4) + 1 }, annotationType = cls.dex.types[b.uleb(cursor)];
      if (!['Ldalvik/annotation/InnerClass;', 'Ldalvik/annotation/EnclosingClass;', 'Ldalvik/annotation/EnclosingMethod;'].includes(annotationType)) continue;
      const size = b.uleb(cursor); if (size > 32) fail('Malformed class nesting annotation');
      const attributes = new Map();
      for (let j = 0; j < size; j++) attributes.set(cls.dex.strings[b.uleb(cursor)], cls.dex.encodedValue(cursor));
      if (annotationType.endsWith('/InnerClass;')) { info.inner = true; info.simpleName = attributes.get('name'); info.modifiers = attributes.get('accessFlags'); }
      if (annotationType.endsWith('/EnclosingClass;')) info.declaringClass = attributes.get('value')?.value;
      if (annotationType.endsWith('/EnclosingMethod;')) { info.enclosingMethod = attributes.get('value')?.value; info.enclosingClass = info.enclosingMethod?.owner; }
    }
    return info;
  }
  className(type, kind = 'binary', depth = 0) {
    if (depth > 64) fail('Class nesting depth exceeded');
    const primitive = { I: 'int', J: 'long', D: 'double', F: 'float', Z: 'boolean', B: 'byte', S: 'short', C: 'char', V: 'void' }[type];
    if (primitive) return primitive;
    if (type.startsWith('[')) {
      if (kind === 'binary') return type.replaceAll('/', '.');
      const component = this.className(type.slice(1), kind, depth + 1); return component === null ? null : component + '[]';
    }
    if (kind === 'binary') return dottedName(type);
    const info = this.classNesting(type);
    if (kind === 'simple') return info.inner ? info.simpleName ?? '' : dottedName(type).split('.').pop();
    if (info.enclosingMethod || (info.inner && info.simpleName === null)) return null;
    if (info.declaringClass) { const outer = this.className(info.declaringClass, 'canonical', depth + 1); return outer === null ? null : outer + '.' + info.simpleName; }
    return dottedName(type);
  }
  typeOf(value) { return typeof value === 'string' ? 'Ljava/lang/String;' : this.object(value).type; }
  makeObject(type) {
    if (this.heap.size >= this.maxHeapObjects) this.outOfMemory(`Object limit (${this.maxHeapObjects}) exceeded`);
    const id = this.nextId++;
    this.heap.set(id, { id, type, fields: new Map(), text: '', orientation: 0, textSize: 20, children: [], listener: null });
    return ref(id);
  }
  newArray(type, length) {
    length = int(length);
    if (length < 0) this.throwJava('Ljava/lang/NegativeArraySizeException;', `negative array length ${length}`);
    if (!type.startsWith('[') || length > 1000000 || this.arrayCells + length > 4000000) fail('Invalid/excessive array allocation');
    this.arrayCells += length;
    const array = this.makeObject(type); this.object(array).elements = new Array(length).fill(defaultValue(type.slice(1))); return array;
  }
  array(value, index) {
    const obj = this.object(value);
    if (!obj.elements) fail('Expected array reference');
    if (index !== undefined && (index < 0 || index >= obj.elements.length)) this.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `array index ${index} outside length ${obj.elements.length}`);
    return obj;
  }
  nativeArrayHandle(value) {
    const array = this.array(value);
    if (array.opaqueNativeHandle === undefined) {
      // The handle is the address of array[0]; the range covers the array's whole byte image so address arithmetic (Memory.peek*, Unsafe) stays inside it.
      const bytes = array.elements.length * ({ '[Z': 1, '[B': 1, '[C': 2, '[S': 2, '[I': 4, '[F': 4, '[J': 8, '[D': 8 }[array.type] ?? 4);
      array.opaqueNativeHandle = this.nextNativeArrayHandle; this.nextNativeArrayHandle += BigInt(((bytes + 15) & ~15) + 16);
      this.nativeArrays.set(array.opaqueNativeHandle, value); this.nativeRanges.push({ base: array.opaqueNativeHandle, end: array.opaqueNativeHandle + BigInt(bytes), value });
    }
    return array.opaqueNativeHandle;
  }
  /** The pinned array whose address range contains `address`, or null. */
  nativeAddressRange(address) {
    const ranges = this.nativeRanges; let low = 0, high = ranges.length - 1;
    while (low <= high) { const mid = (low + high) >> 1, range = ranges[mid]; if (address < range.base) high = mid - 1; else if (address >= range.end) low = mid + 1; else return range; }
    return null;
  }
  nativeArray(handle) {
    if (handle === 0n) return null;
    const value = this.nativeArrays.get(wide(handle));
    if (!value) throw new APKError('Unknown VM array handle; it is not a native memory address', { kind: 'invalid-vm-array-handle', handle: String(handle) });
    return this.array(value);
  }
  allocate(type) {
    if (!this.classes.has(type) && !['Landroid/widget/LinearLayout;', 'Landroid/widget/TextView;', 'Landroid/widget/Button;', 'Ljava/lang/Object;',
      'Ljava/lang/StringBuilder;', 'Ljava/util/Properties;', 'Ljava/lang/String;', 'Ljava/lang/Integer;', 'Ljava/lang/Boolean;'].includes(type)
      && type!=='Ljava/lang/StringBuffer;'
      && !Object.values(BOX_TYPES).includes(type)
      && !/^Ljava\/util\/concurrent\/atomic\/Atomic(Reference|Integer|Long|Boolean|ReferenceArray);$/.test(type)
      && !/^Ljava\/util\/(HashMap|WeakHashMap|LinkedHashMap|ArrayList|Vector|Stack);$/.test(type)
      && !/^Ljava\/lang\/ref\/(WeakReference|SoftReference);$/.test(type)
      && !SET_TYPES.some(owner => type === `L${owner};`)
      && !['Ljava/util/concurrent/CopyOnWriteArrayList;', 'Ljava/util/concurrent/ConcurrentHashMap;', 'Ljava/lang/ThreadLocal;', 'Ljava/util/Random;', 'Ljava/security/SecureRandom;', 'Ljava/util/ArrayDeque;', 'Landroid/os/Handler;'].includes(type)
      && ![REENTRANT_LOCK, RW_LOCK, RW_LOCK.slice(0, -1) + '$ReadLock;', RW_LOCK.slice(0, -1) + '$WriteLock;'].includes(type)
      && !this.skiaHost?.canAllocate?.(type) && !this.platform?.canAllocate?.(type)
      && !this.isSubtype(type, 'Ljava/lang/Throwable;')) {
      // Tolerant mode 'all': a platform class the lab lacks becomes an opaque object whose every call is a traced stub.
      if (this.tolerateMissing !== 'all') fail(`Unsupported allocation: ${type}`);
      const count = (this.missingClasses.get(type) ?? 0) + 1; this.missingClasses.set(type, count);
      if (count === 1) this.record(`STUB-CLASS ${type}`);
    }
    this.initialize(type);
    return this.makeObject(type);
  }
  configureFrameworkRuntime(){
    const owner='Ldalvik/system/VMRuntime;';if(this.frameworkRuntimeConfigured||!this.dex.bootClasses?.has(owner))return;
    const sdk=this.platform?.manifest?.usesSdk,target=Number(sdk?.targetSdkVersion??sdk?.minSdkVersion??1);
    if(!Number.isInteger(target)||target<1||target>2147483647)fail('Unsupported manifest target SDK value for VMRuntime bootstrap');
    const receiver=this.dispatch({owner,name:'getRuntime',parameters:[],result:owner,signature:`()${owner}`},[],'static');
    this.dispatch({owner,name:'setTargetSdkVersion',parameters:['I'],result:'V',signature:'(I)V'},[receiver,target],'virtual');
    const graphics='Landroid/graphics/Compatibility;';
    if(this.dex.bootClasses?.has(graphics))this.dispatch({owner:graphics,name:'setTargetSdkVersion',parameters:['I'],result:'V',signature:'(I)V'},[target],'static');
    this.frameworkRuntimeConfigured=true;
  }
  launch(activity) {
    if (this.activity) fail('Activity already launched; load the APK again to restart');
    if (this.unsupportedFeatures.length) fail(`Unsupported APK: ${this.unsupportedFeatures.join('; ')}`);
    const candidates = this.activities();
    const selected = activity || this.launcherActivity || (candidates.length === 1 ? candidates[0] : null);
    if (!selected) fail('Choose an Activity explicitly; no unique launcher was found');
    const type = descriptor(selected);
    if (!this.classes.has(type) || !this.isSubtype(type, 'Landroid/app/Activity;')) fail(`Activity absent or not supported: ${type}`);
    this.steps = 0;
    this.configureFrameworkRuntime();
    if(this.dex.bootClasses?.has('Lsun/misc/VM;'))this.dispatch({owner:'Lsun/misc/VM;',name:'booted',parameters:[],result:'V',signature:'()V'},[],'static');
    this.platform?.beforeLaunch?.(this);
    this.activityType = type; this.activity = this.allocate(type);
    const launchedActivity = this.activity;
    this.dispatch({ owner: type, name: '<init>', signature: '()V', parameters: [], result: 'V' }, [launchedActivity], 'direct');
    this.platform?.attachActivityContext?.(this, launchedActivity);
    this.dispatch({ owner: type, name: 'onCreate', signature: '(Landroid/os/Bundle;)V', parameters: ['Landroid/os/Bundle;'], result: 'V' }, [launchedActivity, null], 'virtual');
    this.platform?.afterActivityCreate?.(this, launchedActivity);
    if (!this.root && !this.platform?.taskClosed) fail('Activity did not call setContentView');
    return this.snapshot();
  }
  click(id) {
    const view = this.object(ref(id));
    if (view.enabled === false) fail('Cannot click a disabled View');
    this.steps = 0;
    if (this.platform?.performClick?.(this, ref(id)) === true) { this.clicks++; return this.snapshot(); }
    if (!view.listener) fail('View has no OnClickListener');
    const target = this.object(view.listener);
    this.dispatch({ owner: target.type, name: 'onClick', signature: '(Landroid/view/View;)V', parameters: ['Landroid/view/View;'], result: 'V' }, [view.listener, ref(id)], 'virtual');
    this.clicks++;
    return this.snapshot();
  }
  back() {
    if (!this.platform?.back) fail('Back navigation is not implemented for this runtime');
    this.steps = 0; this.platform.back(this); return this.snapshot();
  }
  snapshot() {
    const navigation = this.platform?.navigationState?.(this) ?? {};
    if (this.platform?.taskClosed) return { activityName: null, views: [], texts: [], counters: {}, trace: [...this.trace], clicks: this.clicks, closed: true, canGoBack: false, navigation, ...this.executionSnapshot() };
    if (!this.root) fail('No content view');
    const seen = new Set(), texts = [];
    const build = (value, depth = 0) => {
      const v = this.object(value);
      if (depth > 64 || seen.size >= 1024 || seen.has(v.id)) fail('Cyclic/excessive view hierarchy');
      seen.add(v.id);
      const kind = this.platform?.viewKind?.(this, v) ?? (this.isSubtype(v.type, 'Landroid/widget/EditText;') ? 'input'
        : this.isSubtype(v.type, 'Landroid/widget/CompoundButton;') ? 'check'
        : this.isSubtype(v.type, 'Landroid/widget/ScrollView;') ? 'scroll'
        : this.isSubtype(v.type, 'Landroid/widget/FrameLayout;') ? 'frame'
        : this.isSubtype(v.type, 'Landroid/widget/ProgressBar;') ? 'progress'
        : this.isSubtype(v.type, 'Landroid/widget/Button;') ? 'button'
        : this.isSubtype(v.type, 'Landroid/widget/TextView;') ? 'text'
        : this.isSubtype(v.type, 'Landroid/widget/LinearLayout;') ? 'linear' : null);
      if (!kind) fail(`Unsupported renderer view: ${v.type}`);
      if (['text', 'button', 'input', 'check'].includes(kind)) texts.push(v.text);
      return { id: v.id, type: v.type, kind, text: v.text, orientation: v.orientation === 1 ? 'vertical' : 'horizontal',
        textSize: v.textSize, alpha: v.alpha ?? 1, renderAlpha: v.renderAlpha ?? 1, defaultFocusHighlightEnabled: v.defaultFocusHighlightEnabled !== false, readOnly: !!v.keyListenerInitialized && !v.keyListener, clickable: v.clickable ?? !!v.listener, hasClickListener: !!v.listener, androidId: v.androidId ?? null, enabled: v.enabled !== false,
        padding: v.padding ?? { top: 0, right: 0, bottom: 0, left: 0 }, layoutWidth: v.layoutWidth ?? null,
        clipChildren: v.clipChildren !== false, clipToPadding: v.clipToPadding !== false,
        layoutHeight: v.layoutHeight ?? null, textColor: v.textColor ?? null,
        hint: v.hint ?? '', inputType: v.inputType ?? 1, checked: !!v.checked, progress: v.progress ?? 0,
        max: v.max ?? 100, indeterminate: !!v.indeterminate, visibility: v.visibility ?? 0,
        margin: v.margin ?? { top: 0, right: 0, bottom: 0, left: 0 }, gravity: v.gravity ?? null,
        layoutGravity: v.layoutGravity ?? null, weight: v.weight ?? 0, background: v.background ?? null,
        textStyle: v.textStyle ?? 0, textAllCaps: !!v.textAllCaps, singleLine: !!v.singleLine,
        switchWidget: this.platform?.drawableViewHost?.switchWidget?.(this, value)?.bounds ?? null, progressTint: v.progressTint ?? null, fillViewport: !!(v.fields.get('Landroid/widget/ScrollView;->mFillViewport:Z') ?? v.fillViewport), progressStyle: v.progressStyle ?? null,
        scrollX: v.fields.get('Landroid/view/View;->mScrollX:I') ?? 0, scrollY: v.fields.get('Landroid/view/View;->mScrollY:I') ?? 0,
        drawableSVG: v.drawableSVG ?? null,
        buttonSVG: v.buttonSVG ?? null, buttonBounds: v.buttonBounds ?? null, compoundPadding: v.compoundPadding ?? null,
        foregroundSVG: v.foregroundSVG ?? null,
        foregroundBounds: v.foregroundBounds ?? null,
        contentRaster: v.contentRaster ?? null, canvasChildrenCaptured: !!v.canvasChildrenCaptured,
        transformMatrix: this.platform?.viewTransformHost?.snapshot(this, value) ?? null,
        shadow: this.platform?.viewTransformHost?.shadow?.(this, value) ?? null,
        contentDescription: v.contentDescription ?? null,
        focused: !!v.focused, displayText: v.displayText ?? v.text,
        textFontWeight: v.textFontWeight ?? null, textFontItalic: !!v.textFontItalic,
        bounds: v.bounds ?? null, laidOut: !!v.laidOut, textLineHeight: v.textLineHeight ?? null, textMetrics: v.textMetrics ?? null, textRaster: v.textRaster ?? null, textParagraph: v.textParagraph ?? null,
        children: v.children.map(child => build(child, depth + 1)) };
    };
    const roots = this.platform?.viewRoots?.(this) ?? [{ root: this.root, window: null }];
    const views = roots.map(({root, window, windowBackground}) => ({ ...build(root), ...(window ? { windowSurface: window } : {}), ...(windowBackground ? { windowBackground } : {}) })), counters = Object.create(null), activity = this.object(this.activity), seenClasses = new Set();
    let owner = this.activityType;
    while (owner && !seenClasses.has(owner)) {
      seenClasses.add(owner); const cls = this.classes.get(owner);
      if (cls) for (const entry of cls.fields) {
        const field = cls.dex.fields[entry.index]; if (field.type !== 'I') continue;
        const key = Object.hasOwn(counters, field.name) ? `${dottedName(field.owner)}.${field.name}` : field.name;
        counters[key] = activity.fields.get(field.key) ?? 0;
      }
      owner = this.parent(owner);
    }
    return { systemBars: this.platform?.systemBarsHost?.snapshot?.(this) ?? null, activityName: dottedName(this.activityType), views, texts, counters, clicks: this.clicks, trace: [...this.trace], closed: false, canGoBack: !!navigation.canGoBack, navigation, ...this.executionSnapshot() };
  }
  dispatch(method, args, mode, callerOwner = null, wantFrame = false) {
    const outcome = this.dispatchCore(method, args, mode, callerOwner, wantFrame);
    if (wantFrame || (!(outcome instanceof Blocked) && !(outcome instanceof Invoke))) return outcome;
    // A blocking or call-back native reached through host code (not an interpreter call site) cannot park its thread or push frames: finish it inside the scheduler.
    return this.finishHostStep(outcome);
  }
  /** Completes a native's Blocked / Invoke result synchronously for a host caller (nested waits and nested runs). */
  finishHostStep(step) {
    for (;;) {
      if (step instanceof Blocked) { step = this.scheduler.resolveNested(step); continue; }
      if (!(step instanceof Invoke)) return step;
      let value;
      try { value = this.dispatch(step.method, step.args, step.mode); }
      catch (error) { if (step.onError === null) throw error; step = step.onError(error); continue; }
      step = step.then === null ? value : step.then(value);
    }
  }
  dispatchCore(method, args, mode, callerOwner, wantFrame) {
    if (this.depth + currentThread(this).frames.length >= this.maxCallDepth) this.throwJava('Ljava/lang/StackOverflowError;', 'stack size 1MB');
    this.depth++;
    try {
      if(mode==='virtual'&&!isNull(args[0])&&typeof args[0]!=='string'){
        const proxy=this.object(args[0]);if(proxy.annotationValues){
          this.record(`ANNOTATION ${methodKey(method)} [DEX metadata]`);
          if(method.name==='annotationType'&&method.signature==='()Ljava/lang/Class;')return this.classObject(proxy.type);
          if(method.parameters.length===0){
            if(proxy.annotationValues.has(method.name))return this.materialize(proxy.annotationValues.get(method.name),method.result);
            const defaults=this.classAnnotations(proxy.type,2).find(a=>a.type==='Ldalvik/annotation/AnnotationDefault;')?.values.get('value');
            if(defaults?.encoded==='annotation'&&defaults.values.has(method.name))return this.materialize(defaults.values.get(method.name),method.result);
          }
          fail(`Annotation proxy operation/default is not implemented: ${methodKey(method)}`);
        }
      }
      // Resolution (class chain walk, SHIM/platform lookup, interface defaults) is cached per (method reference, mode, receiver or caller class); loading more DEX files
      // (class loaders) clears the cache because a new class can change what a name resolves to.
      const epoch = this.dex.dynamicFiles?.length ?? 0;
      if (this.resolveEpoch !== epoch) { this.resolveEpoch = epoch; this.resolveCache = new Map(); }
      const ownerKey = mode === 'virtual' ? this.typeOf(args[0]) : mode === 'super' ? callerOwner : null;
      let byMode = this.resolveCache.get(method); if (byMode === undefined) this.resolveCache.set(method, byMode = {});
      let slot = byMode[mode]; if (slot === undefined) slot = byMode[mode] = new Map();
      let resolution = slot.get(ownerKey);
      if (resolution === undefined) { resolution = this.resolveInvoke(method, args, mode, callerOwner); slot.set(ownerKey, resolution); }
      if (resolution.kind === 'missing-stub') return this.noteMissingStub(resolution.key, resolution.result);
      if (resolution.kind === 'bridge') { this.lastBridge = resolution; this.lastBridgeDepth = this.depth; this.record(resolution.text ??= `${resolution.skia ? 'SKIA' : 'SHIM'} ${resolution.key}`); this.lastHostCall = resolution.key; return hostReturn(resolution.selected, this.bridge(resolution.selected, args, mode, resolution.key, resolution)); }
      if (resolution.kind === 'default') {
        const defaultMethod = resolution.defaultMethod;
        this.recordMethod(defaultMethod.method);
        if (wantFrame) return new PendingCall(defaultMethod.method, defaultMethod.code, args);
        return this.execute(defaultMethod.method, defaultMethod.code, args);
      }
      const definition = resolution.definition;
      if (!!(definition.flags & 8) !== (mode === 'static')) fail(`Invalid static/instance invoke: ${definition.method.key}`);
      if (mode === 'static') this.initialize(definition.method.owner);
      if (definition.flags & 0x100) {
        // Only native declarations coming from the explicit boot layer may reach a
        // curated host binding. APK native methods always retain the JNI failure path.
        const binding = this.methodOrigin(definition.method) === 'framework' ? this.nativeBindings.get(definition.method.key) : null;
        if (!binding) {
          // APK `native` methods can only be satisfied by a library the JNI bridge loaded (RegisterNatives or Java_ symbol rules); framework natives never are.
          const jniBinding = this.methodOrigin(definition.method) !== 'framework' ? this.jni?.bindingFor(definition.method) : null;
          if (jniBinding) { this.executionByOrigin.host.calls++; this.record(`JNI ${definition.method.key} -> ${jniBinding.symbol}`); return this.jni.invoke(jniBinding, definition.method, this.hostArguments(definition.method, args, mode), mode); }
          this.nativeRequired(definition.method.key);
        }
        this.executionByOrigin.host.calls++;
        this.record(`HOST ${definition.method.key} [AOSP:${definition.method.dex.filename}]`); this.lastHostCall = definition.method.key;
        const result = binding(this, this.hostArguments(definition.method, args, mode), definition.method);
        if (result && typeof result.then === 'function') fail(`Framework native binding must be synchronous: ${definition.method.key}`);
        return hostReturn(definition.method, result);
      }
      if (!definition.code) fail(`Unsupported abstract/missing-code method: ${definition.method.key}`);
      this.recordMethod(definition.method);
      if (wantFrame) return new PendingCall(definition.method, definition.code, args, definition);   // the run loop pushes the frame itself
      return this.execute(definition.method, definition.code, args);
    } finally { this.depth--; }
  }
  /** Finds what an invoke runs: a class-chain definition (DEX body or native), a SHIM/platform bridge, or a Java 8 interface default; throws when nothing implements it. */
  resolveInvoke(method, args, mode, callerOwner) {
    let owner = mode === 'virtual' ? this.typeOf(args[0]) : mode === 'super' && callerOwner
      ? ((this.classes.get(method.owner)?.flags & 0x200) ? method.owner : this.parent(callerOwner)) : method.owner;
    const seen = new Set();let deferredBridge=null;
    while (owner) {
      if (seen.has(owner) || seen.size >= 64) fail('Invalid class hierarchy');
      seen.add(owner);
      const cls = this.classes.get(owner), definition = cls?.methods.get(method.nameSig ??= method.name + method.signature);
      // Packaged Kotlin/Java library bytecode always takes precedence over a bridge fallback.
      if (definition) return { kind: 'definition', definition };
      const selected = { ...method, owner }, key = methodKey(selected);
      if (SHIMS.has(key) || this.skiaHost?.supports?.(key) || this.platform?.supports?.(key)) {
        // A loaded Java class is authoritative about its declared methods.
        // Search its real superclass methods before using a legacy bridge for
        // a method that may only have been referenced with the subclass owner.
        if(cls)deferredBridge??=selected;
        else return { kind: 'bridge', selected, key, skia: !!this.skiaHost?.supports?.(key) };
      }
      if (method.name === '<init>') break;
      owner = this.parent(owner);
    }
    if(deferredBridge){const key=methodKey(deferredBridge);return { kind: 'bridge', selected: deferredBridge, key, skia: !!this.skiaHost?.supports?.(key) };}
    // Java 8 default methods: after the class chain, a concrete method inherited from a (super)interface of the receiver's class.
    const defaultMethod = this.findInterfaceDefault(mode === 'virtual' ? this.typeOf(args[0]) : method.owner, method);
    if (defaultMethod?.code) return { kind: 'default', defaultMethod };
    if (this.toleratesMissing(method)) return { kind: 'missing-stub', key: methodKey(method), result: method.result };
    fail(`Unsupported API/method: ${methodKey(method)}`);
  }
  toleratesMissing(method) { const mode = this.tolerateMissing; return mode === 'all' || (mode !== 'off' && method.result === 'V') || (mode === 'primitives' && /^[ZBSCIJFD]$/.test(method.result)); }
  /** Tolerant mode: count a stubbed call and answer with the return type's default; the first call per method is traced. */
  noteMissingStub(key, result = 'V') {
    const map = result === 'V' ? this.missingVoid : this.missingReturns, count = (map.get(key) ?? 0) + 1; map.set(key, count);
    const value = result === 'V' ? undefined : result === 'J' || result === 'D' ? 0n : result.length === 1 ? 0 : null;
    if (count === 1) this.record(result === 'V' ? `STUB-VOID ${key}` : `STUB-RETURN ${key} -> ${value === null ? 'null' : String(value).replace('n', '')}`);
    return value;
  }
  /**
   * Static availability of a referenced method, mirroring dispatch(): 'framework-dex' (AOSP DEX body), 'framework-native' (native with approved binding),
   * 'bridge' (SHIM/platform host), 'interface' (abstract, resolved by the receiver at run time) or null (dispatch would raise "Unsupported API/method").
   * Used for API-surface reports; it cannot see receiver-dependent resolution of interface/virtual calls on APK subclasses.
   */
  methodAvailability(method) {
    const seen = new Set(); let owner = method.owner;
    if (this.dex.classes.has(owner) && !this.dex.bootClasses?.has(owner)) return 'apk';
    while (owner && !seen.has(owner) && seen.size < 64) {
      seen.add(owner);
      const cls = this.classes.get(owner), definition = cls?.methods.get(method.name + method.signature);
      if (definition) return definition.flags & 0x100 ? (this.nativeBindings.has(definition.method.key) ? 'framework-native' : null) : definition.flags & 0x400 ? 'interface' : 'framework-dex';
      const key = `${owner}->${method.name}${method.signature}`;
      if (SHIMS.has(key) || this.skiaHost?.supports?.(key) || this.platform?.supports?.(key)) return 'bridge';
      if (method.name === '<init>') break;
      owner = this.parent(owner);
    }
    if (EXTERNAL_INTERFACE_NAMES.has(method.owner) || (this.classes.get(method.owner)?.flags ?? 0) & 0x200) return 'interface';
    return null;
  }
  findInterfaceDefault(startType, method) {
    const key = method.name + method.signature, seen = new Set(), queue = [];
    for (let type = startType, depth = 0; type && depth < 64; type = this.parent(type), depth++) queue.push(...this.interfaces(type));
    while (queue.length) {
      const iface = queue.shift(); if (!iface || seen.has(iface) || seen.size > 256) continue; seen.add(iface);
      const definition = this.classes.get(iface)?.methods.get(key);
      if (definition && definition.code && !(definition.flags & 0x408)) return definition; // not abstract, not static
      queue.push(...this.interfaces(iface));
    }
    return null;
  }
  nativeRequired(method, requestedLibrary = null) {
    const libraries = this.nativeLibraries.map(value => typeof value === 'string' ? value : value.path ?? value.name ?? value.basename ?? 'unknown');
    const basenames = [...new Set(libraries.map(path => path.split('/').pop()))];
    const message = `JNI execution required: ${method}${requestedLibrary ? `; requested library ${requestedLibrary}` : ''}. This VM has no Android ELF/JNI execution backend; packaged ARM/x86 machine code cannot be executed directly. Packaged libraries: ${basenames.slice(0, 12).join(', ') || 'none'}${basenames.length > 12 ? ` (+${basenames.length - 12} more)` : ''}`;
    this.throwJava('Ljava/lang/UnsatisfiedLinkError;', message, { kind: 'jni-required', method, requestedLibrary, nativeLibraries: libraries });
  }
  /** The Java frames of the current thread, innermost first: the methods Throwable.getStackTrace reports (constructors of the exception itself are not part of the trace). */
  captureStack() {
    const frames = this.thread?.frames; if (!frames) return [];
    const out = []; let leading = true;
    for (let i = frames.length - 1; i >= 0 && out.length < 1024; i--) {
      const method = frames[i].method; if (!method) continue;
      if (leading && method.name === '<init>' && this.isSubtype(method.owner, 'Ljava/lang/Throwable;')) continue;
      leading = false; out.push(method);
    }
    return out;
  }
  /**
   * The VM heap is full: like ART, throw java.lang.OutOfMemoryError into the running code. The error is also recorded on the host side (oomCount/lastOom, trace line, the
   * heapBudget of executionSnapshot and the Worker's snapshot), so an app that catches Throwable cannot hide it from the page, the harness or the validation flows.
   * The collector (src/heap-gc.js) runs between events; an event that allocates more than the free headroom still fails here.
   */
  outOfMemory(reason) {
    this.oomCount = (this.oomCount ?? 0) + 1; this.lastOom = { reason, liveObjects: this.heap.size, limit: this.maxHeapObjects, fieldSlots: this.fieldSlots, count: this.oomCount };
    this.record(`OOM java.lang.OutOfMemoryError: ${reason}; ${this.heap.size} live objects`);
    if (this.inOutOfMemory) fail(reason);
    this.inOutOfMemory = true; this.maxHeapObjects += 64;   // headroom for the throwable itself
    try { this.throwJava('Ljava/lang/OutOfMemoryError;', `Failed to allocate: ${reason} (${this.heap.size} live objects)`, { kind: 'java-heap-exhausted', limit: this.maxHeapObjects - 64, liveObjects: this.heap.size }); }
    finally { this.maxHeapObjects -= 64; this.inOutOfMemory = false; }
  }
  throwJava(type, message, details = null) {
    const value = this.makeObject(type), obj = this.object(value); obj.message = message; obj.exceptionDetails = details; obj.stack = this.captureStack();
    throw new JavaException(value, message, details);
  }
  throwJavaReference(value,message,details=null){
    if(!this.isSubtype(this.typeOf(value),'Ljava/lang/Throwable;'))fail('Native exception reference must be a Java Throwable');
    const object=this.object(value);object.message=message;object.exceptionDetails=details;throw new JavaException(value,message,details);
  }
  /** Charset selector of String.getBytes/new String(byte[],...): null = platform default (UTF-8 on Android); a String name or Charset object. */
  stringCodec(selector,decoding){
    if(selector===null||selector===0||selector===undefined)return 'UTF-8';
    let charsetName;
    if(this.isStringValue(selector))charsetName=this.stringCharacters(selector);
    else{const name=this.dispatch({owner:'Ljava/nio/charset/Charset;',name:'name',parameters:[],result:'Ljava/lang/String;',signature:'()Ljava/lang/String;'},[selector],'virtual');charsetName=this.stringCharacters(name);}
    const canonical=canonicalCharset(charsetName);
    if(!canonical||!SUPPORTED_CODECS.has(canonical))throw new APKError(`String <-> byte[] conversion for charset ${charsetName} is outside the implemented ICU profile (${[...SUPPORTED_CODECS].join(', ')})`,{kind:'unsupported-charset-profile'});
    return canonical;
  }
  isStringValue(value){return typeof value==='string'||value?.ref!==undefined&&this.heap.get(value.ref)?.type==='Ljava/lang/String;';}
  stringCharacters(value){
    if(typeof value==='string')return value;const object=this.object(value);if(object.type!=='Ljava/lang/String;')this.throwJava('Ljava/lang/ClassCastException;','Expected String');if(object.stringValue===undefined)fail('String used before constructor');return object.stringValue;
  }
  hostArguments(method,words,mode){
    const values=this.compactArguments(method,words,mode),start=mode==='static'?0:1;
    for(let i=0;i<method.parameters.length;i++)if(method.parameters[i]==='Ljava/lang/String;'&&!isNull(values[start+i]))values[start+i]=this.stringCharacters(values[start+i]);return values;
  }
  /** Calls the original jdk.internal.math.FloatingDecimal (libcore) in the framework DEX: Java's exact decimal <-> binary floating-point conversions. */
  floatingDecimal(name, parameters, values, result, asString = false) {
    const owner = 'Ljdk/internal/math/FloatingDecimal;';
    if (!this.dex.bootClasses?.has(owner)) fail('Java Float/Double decimal conversion needs the original libcore FloatingDecimal in the framework DEX');
    const value = this.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, this.argumentWords(parameters, values), 'static');
    return asString ? this.stringCharacters(value) : value;
  }
  javaString(value, type = 'Ljava/lang/Object;') {
    if (isNull(value) && type.startsWith('L')) return 'null';
    if (type === 'Z') return value ? 'true' : 'false';
    if (type === 'C') return String.fromCharCode(int(value) & 65535);
    if (type === 'F' || type === 'D') return this.floatingDecimal('toJavaFormatString', [type], [value], 'Ljava/lang/String;', true); // the original libcore FloatingDecimal, never a JavaScript conversion
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return String(value);
    const obj = this.object(value);
    if(obj.type==='Ljava/lang/String;')return this.stringCharacters(value);
    if (obj.type === 'Ljava/lang/StringBuilder;'||obj.type==='Ljava/lang/StringBuffer;') return obj.builder ?? '';
    if (obj.boxed !== undefined) return obj.primitiveType === 'F' || obj.primitiveType === 'D' ? this.javaString(obj.boxed, obj.primitiveType) : obj.type === 'Ljava/lang/Boolean;' ? (obj.boxed ? 'true' : 'false') : String(obj.boxed);
    const method=this.objectOverride(obj.type,'toString()Ljava/lang/String;')??this.externalObjectMethod(obj.type,'toString',[],'Ljava/lang/String;');
    if(method){const text=this.dispatch(method,[value],'virtual');return isNull(text)?'null':this.stringCharacters(text);}
    return `${obj.type.startsWith('[') ? obj.type.replaceAll('/', '.') : dottedName(obj.type)}@${obj.id.toString(16)}`;
  }
  objectOverride(type, signature) {
    const seen = new Set();
    while (type && !seen.has(type)) { seen.add(type); const definition = this.classes.get(type)?.methods.get(signature); if (definition) return definition.method; type = this.parent(type); }
    return null;
  }
  externalObjectMethod(type,name,parameters,result){
    const signature=`(${parameters.join('')})${result}`,seen=new Set();while(type&&type!=='Ljava/lang/Object;'){
      if(seen.has(type)||seen.size>=128)fail('Invalid external object hierarchy');seen.add(type);const key=`${type}->${name}${signature}`;
      if(SHIMS.has(key)||this.platform?.supports?.(key)||this.skiaHost?.supports?.(key))return {owner:type,name,parameters,result,signature};type=this.parent(type);
    }return null;
  }
  boxedHash(object){
    if(object.type==='Ljava/lang/Boolean;')return object.boxed?1231:1237;
    let value=object.boxed;
    if(object.type==='Ljava/lang/Float;')return Number.isNaN(floatNumber(value))?0x7fc00000:int(value);
    if(object.type==='Ljava/lang/Double;'&&Number.isNaN(doubleNumber(value)))value=0x7ff8000000000000n;
    return typeof value==='bigint'?Number(BigInt.asIntN(32,value^(value>>32n))):int(value);
  }
  boxedEquals(a,b){
    if(a.type!==b.type||a.boxed===undefined||b.boxed===undefined)return false;
    if(a.type==='Ljava/lang/Float;'){const canonical=x=>Number.isNaN(floatNumber(x))?0x7fc00000:int(x);return canonical(a.boxed)===canonical(b.boxed);}
    if(a.type==='Ljava/lang/Double;'){const canonical=x=>Number.isNaN(doubleNumber(x))?0x7ff8000000000000n:wide(x);return canonical(a.boxed)===canonical(b.boxed);}
    return a.boxed===b.boxed;
  }
  javaHash(value) {
    if (isNull(value)) return 0;
    if (typeof value === 'string') return stringHash(value);
    const obj = this.object(value);if(obj.annotationValues)throw new APKError('Annotation value hashing is not implemented by this reflection adapter',{kind:'unsupported-annotation-proxy',type:obj.type});const method = this.objectOverride(obj.type, 'hashCode()I');
    if (method) return int(this.dispatch(method, [value], 'virtual'));
    const external=this.externalObjectMethod(obj.type,'hashCode',[],'I');if(external)return int(this.dispatch(external,[value],'virtual'));
    if (obj.member) { const member = obj.member, owner = member.field?.owner ?? member.method.owner; return stringHash(dottedName(owner)) ^ (member.kind === 'constructor' ? 0 : stringHash(member.field?.name ?? member.method.name)); }
    if(obj.boxed!==undefined)return this.boxedHash(obj);
    return obj.id;
  }
  javaEquals(a, b) {
    if (equal(a, b)) return true;
    if (isNull(a) || isNull(b)) return false;
    if(typeof a==='string')return this.isStringValue(b)&&a===this.stringCharacters(b);
    const obj = this.object(a), method = this.objectOverride(obj.type, 'equals(Ljava/lang/Object;)Z');
    if (method) return int(this.dispatch(method, [a, b], 'virtual')) !== 0;
    if(typeof b==='string')return obj.type==='Ljava/lang/String;'&&this.stringCharacters(a)===b;
    if(obj.annotationValues){if(!this.isSubtype(this.typeOf(b),obj.type))return false;throw new APKError('Annotation value equality is not implemented by this reflection adapter',{kind:'unsupported-annotation-proxy',type:obj.type});}
    const external=this.externalObjectMethod(obj.type,'equals',['Ljava/lang/Object;'],'Z');if(external)return !!this.dispatch(external,[a,b],'virtual');
    const other = this.object(b);
    if (obj.member || other.member) {
      if (!obj.member || !other.member || obj.member.kind !== other.member.kind) return false;
      return (obj.member.field?.key ?? obj.member.method.key) === (other.member.field?.key ?? other.member.method.key);
    }
    return this.boxedEquals(obj,other);
  }
  mapEntry(obj, key) {
    const hash = this.javaHash(key); obj.mapBuckets ??= new Map();
    const bucket = obj.mapBuckets.get(hash) ?? [];
    for (const serial of bucket) { const entry = obj.map.get(serial); if (entry && this.javaEquals(key, entry.key)) return { hash, bucket, entry }; }
    return { hash, bucket, entry: null };
  }
  mapAccess(obj, entry) {
    if (entry && obj.accessOrder && obj.tailSerial !== entry.serial) { obj.map.delete(entry.serial); obj.map.set(entry.serial, entry); obj.tailSerial = entry.serial; this.bumpModCount(obj); }
  }
  mapRemove(obj, entry) {
    if (!entry || !obj.map.delete(entry.serial)) return;
    this.reserveCollection(-1); const bucket = obj.mapBuckets?.get(entry.hash) ?? [];
    obj.mapBuckets?.set(entry.hash, bucket.filter(serial => serial !== entry.serial)); this.bumpModCount(obj);
    if (obj.tailSerial === entry.serial) { obj.tailSerial = null; for (const serial of obj.map.keys()) obj.tailSerial = serial; }
  }
  reserveCollection(delta) {
    if (delta > 0 && this.collectionCells + delta > 4000000) fail('Aggregate Java collection storage limit exceeded');
    this.collectionCells = Math.max(0, this.collectionCells + delta);
  }
  collectionValues(obj) {
    if (obj.set) return obj.set;
    if (obj.mapSource) {
      const source = this.object(obj.mapSource);
      return [...source.map.values()].map(entry => {
        if (obj.viewKind === 'keys') return entry.key;
        if (obj.viewKind === 'values') return entry.value;
        const value = this.makeObject(HOST_MAP_ENTRY); this.object(value).entry = entry; return value;
      });
    }
    if (obj.list) return obj.list;
    if(this.objectOverride(obj.type,'iterator()Ljava/util/Iterator;')||this.isSubtype(obj.type,'Ljava/util/AbstractList;')){
      this.materializingCollections??=new Set();if(this.materializingCollections.has(obj.id))fail('Recursive collection materialization');this.materializingCollections.add(obj.id);
      const call=(receiver,name,result)=>this.dispatch({owner:this.typeOf(receiver),name,parameters:[],result,signature:`()${result}`},[receiver],'virtual');
      try{const iterator=call(ref(obj.id),'iterator','Ljava/util/Iterator;'),values=[];while(call(iterator,'hasNext','Z')){if(values.length>=1000000)fail('Collection materialization limit exceeded');values.push(call(iterator,'next','Ljava/lang/Object;'));}return values;}
      finally{this.materializingCollections.delete(obj.id);}
    }
    fail('Expected Java collection');
  }
  resolveClass(name, initialize = false, loader = undefined) {
    if (typeof name !== 'string') this.throwJava('Ljava/lang/NullPointerException;', 'null class name');
    let type = name.startsWith('[') ? name.replaceAll('.', '/') : descriptor(name);
    let component = type.replace(/^\[+/, '');
    if (this.classOwners?.size && component.length > 1) {
      // Class identity is (defining loader, name): resolve through the requesting loader's delegation chain (the caller's own loader unless one is given).
      const mapped = this.platform.classLoaders.mapType(this, loader === undefined ? (this.currentMethod?.dex?.definingLoader ?? null) : loader, component);
      if (mapped === false) this.throwJava('Ljava/lang/ClassNotFoundException;', name);
      if (mapped !== component) { type = type.slice(0, type.length - component.length) + mapped; component = mapped; }
    }
    if (!this.classes.has(component) && !BRIDGE_OWNERS.has(component) && !EXTERNAL_PARENTS.has(component) && !EXTERNAL_INTERFACE_NAMES.has(component) && !EXTERNAL_INTERFACES.has(component) && component.length !== 1 && !['Ljava/lang/Object;', 'Ljava/lang/CharSequence;'].includes(component) && !this.skiaHost?.parent?.(component) && !this.platform?.parent?.(component) && !this.platform?.fallbackParent?.(component)) this.throwJava('Ljava/lang/ClassNotFoundException;', name);
    if (initialize && !type.startsWith('[')) this.initialize(type);
    return this.classObject(type);
  }
  boxPrimitive(type, value) {
    if (type === 'V') return null;
    if (type.length !== 1) return value;
    if (type === 'Z') return this.readStatic({ owner: 'Ljava/lang/Boolean;', name: value ? 'TRUE' : 'FALSE', type: 'Ljava/lang/Boolean;', key: `Ljava/lang/Boolean;->${value ? 'TRUE' : 'FALSE'}:Ljava/lang/Boolean;` });
    const owner = BOX_TYPES[type]; if (!owner) fail(`Cannot box primitive ${type}`);
    const cacheable = ['B', 'S', 'I', 'J'].includes(type) ? value >= -128 && value <= 127 : type === 'C' && value >= 0 && value <= 127;
    this.boxCache ??= new Map(); const key = `${type}:${value}`;
    if (cacheable && this.boxCache.has(key)) return this.boxCache.get(key);
    const boxed = this.makeObject(owner), obj = this.object(boxed); obj.boxed = value; obj.primitiveType = type;
    if (cacheable) this.boxCache.set(key, boxed);
    return boxed;
  }
  unboxReflection(value, target) {
    if (target.length !== 1) {
      if (!isNull(value) && !this.isSubtype(this.typeOf(value), target)) this.throwJava('Ljava/lang/IllegalArgumentException;', `Reflection argument is not ${target}`);
      return value;
    }
    if (isNull(value)) this.throwJava('Ljava/lang/IllegalArgumentException;', 'Cannot unbox null reflection argument');
    const obj = this.object(value), source = obj.primitiveType ?? Object.keys(BOX_TYPES).find(type => BOX_TYPES[type] === obj.type);
    const allowed = { Z: ['Z'], B: ['B', 'S', 'I', 'J', 'F', 'D'], S: ['S', 'I', 'J', 'F', 'D'], C: ['C', 'I', 'J', 'F', 'D'], I: ['I', 'J', 'F', 'D'], J: ['J', 'F', 'D'], F: ['F', 'D'], D: ['D'] };
    if (!allowed[source]?.includes(target)) this.throwJava('Ljava/lang/IllegalArgumentException;', `Reflection cannot narrow ${source ?? obj.type} to ${target}`);
    if (source === target) return obj.boxed;
    const number = source === 'F' ? floatNumber(obj.boxed) : source === 'D' ? doubleNumber(obj.boxed) : Number(obj.boxed);
    if (target === 'D') return doubleBits(number);
    if (target === 'F') return floatBits(number);
    if (target === 'J') return source === 'J' ? obj.boxed : BigInt(int(obj.boxed));
    return narrow(obj.boxed, target);
  }
  reflectionObject(kind, definition) {
    const value = this.makeObject(`Ljava/lang/reflect/${kind === 'constructor' ? 'Constructor' : kind === 'field' ? 'Field' : 'Method'};`);
    this.object(value).member = { kind, ...definition }; return value;
  }
  reflectionParameterTypes(value) {
    if (isNull(value)) return [];
    return this.array(value).elements.map(element => { const type = this.object(element).classType; if (!type) this.throwJava('Ljava/lang/IllegalArgumentException;', 'Expected Class[]'); return type; });
  }
  reflectionLookup(type, kind, name, parameters, publicOnly) {
    const seen = new Set(), pending = [type];
    while (pending.length) {
      const owner = pending.shift(); if (!owner || seen.has(owner)) continue;
      if (seen.size > 512) fail('Reflection hierarchy limit exceeded'); seen.add(owner);
      const cls = this.classes.get(owner);
      if (!cls) {
        // Class can reflect on these same implemented Class APIs. Compose on
        // API 28 uses this two-stage lookup; invocation still goes through the
        // normal checked reflection dispatcher, never an app-specific shortcut.
        if(kind==='method'&&owner==='Ljava/lang/Class;'){
          const results={getDeclaredMethod:'Ljava/lang/reflect/Method;',getDeclaredField:'Ljava/lang/reflect/Field;'};
          const result=results[name],signature=`(${(parameters??[]).join('')})${result}`;
          if(result&&SHIMS.has(`${owner}->${name}${signature}`))return {method:{owner,name,parameters,result,signature,key:`${owner}->${name}${signature}`},flags:1};
        }
        const external=this.platform?.reflectionDefinition?.(owner,kind,name,parameters,publicOnly);
        if(external){const member=kind==='field'?external.field:external.method;if(!member||member.owner!==owner||member.name!==name||(publicOnly&&!(external.flags&1)))fail('Invalid host reflection metadata');return external;}
        if(kind==='constructor'&&name==='<init>'&&this.isSubtype(owner,'Landroid/view/View;')&&parameters[0]==='Landroid/content/Context;'){
          const signature=`(${parameters.join('')})V`;
          if(this.platform?.supports?.(`${owner}-><init>${signature}`))return {method:{owner,name,parameters,result:'V',signature,key:`${owner}->${name}${signature}`},flags:1};
        }
        if(kind==='method'&&owner==='Landroid/os/Handler;'&&name==='createAsync'&&parameters.join('')==='Landroid/os/Looper;'){
          const result=owner,signature=`(${parameters.join('')})${result}`;return {method:{owner,name,parameters,result,signature,key:`${owner}->${name}${signature}`},flags:9};
        }
        if(kind==='field'&&owner==='Landroid/os/Build$VERSION;'&&['SDK_INT','SDK','CODENAME'].includes(name)){
          const type=name==='SDK_INT'?'I':'Ljava/lang/String;';return {field:{owner,name,type,key:`${owner}->${name}:${type}`},flags:0x19};
        }
        if (kind === 'constructor' && this.isSubtype(owner, 'Ljava/lang/Throwable;')) {
          // Platform exception classes expose the four standard Throwable constructors; their VM implementation is the generic Throwable bridge.
          const wanted = (parameters ?? []).join('');
          if (['', 'Ljava/lang/String;', 'Ljava/lang/String;Ljava/lang/Throwable;', 'Ljava/lang/Throwable;'].includes(wanted)) return { method: { owner, name: '<init>', parameters: parameters ?? [], result: 'V', signature: `(${wanted})V`, key: `${owner}-><init>(${wanted})V` }, flags: 1 };
        }
        if (kind !== 'field') {
          // Bridge-implemented platform classes (java.lang.System, ...): reflect over the registered bridge signatures. The bridge table does not
          // record static-ness, so the member carries a "static unless a receiver is supplied" marker (Java ignores the receiver of static methods).
          const found = this.bridgeReflection(owner, kind === 'constructor' ? '<init>' : name, parameters);
          if (found) return found;
        }
        if (owner === type && !bootClassLacksMember(owner, kind, name)) fail(`External reflection metadata is not implemented: ${owner}->${name}${parameters ? '(' + parameters.join('') + ')' : ''} (${kind})`);
        continue;
      }
      if (kind === 'field') {
        for (const item of [...cls.fields, ...cls.staticFields]) {
          const field = cls.dex.fields[item.index]; if (field.name === name && (!publicOnly || item.flags & 1)) return { field, flags: item.flags };
        }
      } else {
        const matches = [...cls.methods.values()].filter(def => def.method.name === name && def.method.parameters.join('') === parameters.join('') && (!publicOnly || def.flags & 1));
        matches.sort((a, b) => ((a.flags & 0x40) ? 1 : 0) - ((b.flags & 0x40) ? 1 : 0));
        if (matches.length) return matches[0];
      }
      if (publicOnly && kind !== 'constructor') pending.push(cls.superclass, ...cls.interfaces);
    }
    // ART's messages: Class.getField -> the bare name; getDeclaredField -> "No field x in class Lpkg/C;"; methods and constructors -> "pkg.C.name [class A, int]".
    if (kind === 'field') this.throwJava('Ljava/lang/NoSuchFieldException;', publicOnly ? name : `No field ${name} in class ${type}`);
    const typeName = descriptor => { if (/^\[/.test(descriptor)) return 'class ' + descriptor.replaceAll('/', '.'); if (!descriptor.startsWith('L')) return PRIMITIVE_NAMES[descriptor] ?? descriptor; return (((this.classes.get(descriptor)?.flags ?? 0) & 0x200) || EXTERNAL_INTERFACE_NAMES.has(descriptor) ? 'interface ' : 'class ') + dottedName(descriptor); };
    this.throwJava('Ljava/lang/NoSuchMethodException;', `${dottedName(type)}.${kind === 'constructor' ? '<init>' : name} [${(parameters ?? []).map(typeName).join(', ')}]`);
  }
  apkCodePath(path) { return typeof path === 'string' && /^\/data\/app\/.+\/base\.apk$/.test(path); }
  bridgeReflection(owner, name, parameters) {
    BRIDGE_INDEX ??= (() => { const index = new Map(); for (const key of SHIMS) { const at = key.indexOf('->'), open = key.indexOf('(', at), close = key.indexOf(')', open), o = key.slice(0, at), n = key.slice(at + 2, open); const bucket = index.get(o + '\0' + n) ?? index.set(o + '\0' + n, []).get(o + '\0' + n); bucket.push({ key, params: key.slice(open + 1, close), result: key.slice(close + 1) }); } return index; })();
    const wanted = (parameters ?? []).join(''), match = BRIDGE_INDEX.get(owner + '\0' + name)?.find(entry => entry.params === wanted);
    if (!match) {
      // Platform-host bridged members (android.view.View getters/setters such as getElevation()F used by ObjectAnimator reflection).
      for (let at = owner, depth = 0; at && depth < 64; at = this.parent(at), depth++) for (const result of ['V', 'Z', 'I', 'F', 'J', 'D', 'S', 'B', 'C']) { const key = `${at}->${name}(${wanted})${result}`; if (this.platform?.supports?.(key)) return { method: { owner: at, name, parameters: parameters ?? [], result, signature: `(${wanted})${result}`, key }, flags: 1 | 0x10000 }; }
      return null;
    }
    return { method: { owner, name, parameters: parameters ?? [], result: match.result, signature: `(${match.params})${match.result}`, key: match.key }, flags: 1 | 0x10000 };
  }
  reflectionAccess(member, accessible, receiver = null) {
    if (accessible) return;
    const owner = member.field?.owner ?? member.method.owner, caller = this.currentMethod?.owner, flags = member.flags;
    const ownerPublic = (this.classNesting(owner).modifiers ?? this.classes.get(owner)?.flags ?? 1) & 1;
    const samePackage = caller && caller.slice(0, caller.lastIndexOf('/')) === owner.slice(0, owner.lastIndexOf('/'));
    const classAccess = ownerPublic || samePackage || caller === owner;
    const allowed = flags & 1 ? true : flags & 2 ? caller === owner : samePackage || ((flags & 4) && caller && this.isSubtype(caller, owner) && ((flags & 8) || !receiver || this.isSubtype(this.typeOf(receiver), caller)));
    if (!classAccess || !allowed) this.throwJava('Ljava/lang/IllegalAccessException;', `${caller ?? 'external caller'} cannot access ${owner}`);
  }
  reflectionInvoke(member, accessible, receiver, argumentsArray, wrap = true) {
    const method = member.method, parameters = isNull(argumentsArray) ? [] : this.array(argumentsArray).elements;
    if (parameters.length !== method.parameters.length) this.throwJava('Ljava/lang/IllegalArgumentException;', 'Reflection argument count mismatch');
    const constructor = method.name === '<init>', staticCall = !!(member.flags & 8) || (!!(member.flags & 0x10000) && !constructor && isNull(receiver));
    this.reflectionAccess(member, accessible, receiver);
    if (constructor) {
      const flags = this.classes.get(method.owner)?.flags ?? 0;
      if (flags & 0x4000) this.throwJava('Ljava/lang/IllegalArgumentException;', 'Reflective enum construction is forbidden');
      if (flags & (0x200 | 0x400)) this.throwJava('Ljava/lang/InstantiationException;', method.owner);
    } else if (!staticCall && (isNull(receiver) || !this.isSubtype(this.typeOf(receiver), method.owner))) this.throwJava(isNull(receiver) ? 'Ljava/lang/NullPointerException;' : 'Ljava/lang/IllegalArgumentException;', isNull(receiver) ? 'null receiver for instance method ' + dottedName(method.owner) : `expected receiver of type ${dottedName(method.owner)}, but got ${dottedName(this.typeOf(receiver))}`);
    const words = [];
    if (!constructor && !staticCall) words.push(receiver);
    for (let i = 0; i < parameters.length; i++) { const type = method.parameters[i], value = this.unboxReflection(parameters[i], type); words.push(value); if (type === 'J' || type === 'D') words.push(WIDE_HIGH); }
    // Class initialization precedes reflective construction and is not a target-method exception.
    if (constructor) { receiver = this.allocate(method.owner); words.unshift(receiver); }
    else if (staticCall) this.initialize(method.owner);
    try {
      const result = this.dispatch(method, words, constructor || member.flags & 2 ? 'direct' : staticCall ? 'static' : 'virtual');
      return constructor ? receiver : this.boxPrimitive(method.result, result);
    } catch (error) {
      if (!wrap || !(error instanceof JavaException)) throw error;
      const value = this.makeObject('Ljava/lang/reflect/InvocationTargetException;'), obj = this.object(value);
      obj.cause = error.value; obj.message = error.message; obj.exceptionDetails = error.details;
      throw new JavaException(value, error.message, error.details);
    }
  }
  argumentWords(parameters, values, { receiver = undefined } = {}) {
    if (parameters.length !== values.length) fail('Argument packing count mismatch');
    const words = receiver === undefined ? [] : [receiver];
    for (let i = 0; i < parameters.length; i++) { words.push(values[i]); if (parameters[i] === 'J' || parameters[i] === 'D') { wide(values[i]); words.push(WIDE_HIGH); } }
    return words;
  }
  bridge(method, words, mode, knownKey, resolution) {
    const staticCall = mode === 'static', args = this.hostArguments(method, words, mode);
    const key = knownKey ?? methodKey(method), name = method.name;
    if(key==='Landroid/graphics/Canvas;->setCompatibilityVersion(I)V'){this.canvasCompatibilityVersion=int(args[0]);return;}
    if(ICU_BREAK_KEYS.has(key))return invokeICUBreak(this,method,args);
    const charsetRegistry=charsetRegistryCreation(this,method,args)??charsetRegistryRegistration(this,method,args);if(charsetRegistry)return charsetRegistry.value;
    const nodeRegistry=renderNodeRegistryBridge(this,method,args);if(nodeRegistry)return nodeRegistry.value;
    const regexRegistry=regexRegistryBridge(this,method,args);if(regexRegistry)return regexRegistry.value;
    const colorRegistry=colorFilterRegistryBridge(this,method,args);if(colorRegistry)return colorRegistry.value;
    const textRegistry=textLayoutRegistryBridge(this,method,args);if(textRegistry)return textRegistry.value;
    if(this.skiaHost?.supports?.(key))return this.skiaHost.invoke(this,method,args,mode);
    if ((resolution === undefined ? this.platform?.supports?.(key) : (resolution.platformSupports ??= !!this.platform?.supports?.(key)))) return this.platform.invoke(this, method, args, mode);
    if(method.owner==='Landroid/content/res/Configuration;'&&name==='isLayoutSizeAtLeast'){
      const size=(this.object(args[0]).fields.get('Landroid/content/res/Configuration;->screenLayout:I')??0)&0x0f;return size!==0&&size>=int(args[1])?1:0;
    }
    if(method.owner==='Ljava/lang/Object;'&&['notify','notifyAll','wait'].includes(name)){
      const object=this.object(args[0]),thread=this.thread??this.scheduler.mainThread(),monitor=this.monitors.get(object.id);
      if(!monitor||monitor.owner!==thread)this.throwJava('Ljava/lang/IllegalMonitorStateException;','object not locked by thread before '+name+'()');
      if(name==='wait'){
        const millis=args[1]??0n,nanos=args[2]??0;
        if(millis<0n||nanos<0||nanos>999999)this.throwJava('Ljava/lang/IllegalArgumentException;',millis<0n?'timeout value is negative':'nanosecond timeout value out of range');
        if(thread.interrupted){thread.interrupted=false;this.throwJava('Ljava/lang/InterruptedException;',null);}
        const waiter={thread,notified:false},saved=monitor.count;object.waiters??=[];object.waiters.push(waiter);this.monitors.delete(object.id);   // wait() releases the monitor completely
        const deadline=millis===0n&&nanos===0?Infinity:this.platform.clock.now()+Number(millis)+(nanos?1:0);
        const reacquire=()=>new Blocked({ready:()=>this.monitorFree(args[0]),reason:'Object.wait (reacquire)',finish:()=>{if(!this.monitorTryEnter(args[0],thread))return reacquire();this.monitors.get(object.id).count=saved;if(thread.interrupted){thread.interrupted=false;this.throwJava('Ljava/lang/InterruptedException;',null);}return undefined;}});
        return new Blocked({ready:()=>waiter.notified,deadline,interruptible:true,reason:'Object.wait',finish:()=>{const i=object.waiters.indexOf(waiter);if(i>=0)object.waiters.splice(i,1);return reacquire();}});
      }
      const waiters=object.waiters??[];
      if(name==='notify'){const waiter=waiters.find(w=>!w.notified);if(waiter)waiter.notified=true;}else for(const waiter of waiters)waiter.notified=true;
      return;
    }
    if(method.owner==='Ljava/util/Properties;'){
      const object=this.object(args[0]);if(name==='<init>'){object.properties=new Map();return;}
      if(!object.properties)fail('Properties used before its constructor');if(isNull(args[1]))this.throwJava('Ljava/lang/NullPointerException;','Null property key');
      if(name==='setProperty'){if(isNull(args[2]))this.throwJava('Ljava/lang/NullPointerException;','Null property value');const before=object.properties.get(args[1])??null;if(!object.properties.has(args[1]))this.reserveCollection(1);object.properties.set(args[1],args[2]);return before;}
      return object.properties.get(args[1])??args[2]??null;
    }
    if(method.owner==='Ljava/security/AccessController;'&&name==='doPrivileged'){
      // No SecurityManager exists, so the action simply runs; a PrivilegedExceptionAction wraps its checked exceptions in PrivilegedActionException (as AccessController does).
      const checked=method.parameters[0]==='Ljava/security/PrivilegedExceptionAction;';
      return new Invoke({owner:this.typeOf(args[0]),name:'run',parameters:[],result:'Ljava/lang/Object;',signature:'()Ljava/lang/Object;'},[args[0]],'virtual',null,checked?error=>{
        if(!error?.value||this.isSubtype(this.typeOf(error.value),'Ljava/lang/RuntimeException;')||this.isSubtype(this.typeOf(error.value),'Ljava/lang/Error;'))throw error;
        const wrapper=this.allocate('Ljava/security/PrivilegedActionException;');this.object(wrapper).cause=error.value;this.object(wrapper).message=null;this.throwJavaReference(wrapper,null);
      }:null)};
    if(method.owner==='Ljava/lang/System;'&&name==='getSecurityManager')return null; // Explicit VM profile: no Java SecurityManager is installed.
    if(method.owner==='Ljava/lang/System;'&&name==='lineSeparator')return '\n'; // Initial line.separator of the explicit VM device, unchanged by setProperty.
    if(method.owner==='Ljava/lang/System;'&&name==='logW'){
      this.record(`LOG W ${this.javaString(args[0])}${args[1]?' '+this.javaString(args[1]):''}`);return;
    }
    if(method.owner==='Ljava/util/Locale;'&&name==='hashCode'){
      const data=this.object(args[0]).localeData;if(!data)fail('Locale has no VM language state');
      const parts=String(data.tag??'').split('-'),extensionStart=parts.findIndex((part,index)=>index>0&&part.length===1),extensions=extensionStart<0?'':parts.slice(extensionStart).join('-').toLowerCase(),script=data.script??(!data.variant&&/^[A-Z][a-z]{3}$/.test(parts[1]??'')?parts[1]:'');
      let hash=stringHash(data.language??'');for(const part of [script,data.country??'',data.variant??''])hash=(Math.imul(31,hash)+stringHash(part))|0;
      return hash^stringHash(extensions);
    }
    if(method.owner==='Ljava/lang/Character;'&&['isWhitespace','isSpaceChar'].includes(name))return(name==='isWhitespace'?JAVA_WHITESPACE:JAVA_SPACE_CHARS).has(int(args[0]))?1:0;
    if(method.owner==='Ljava/lang/Character;'&&(name==='toUpperCase'||name==='toLowerCase')&&method.parameters?.length===1&&(method.parameters[0]==='C'||method.parameters[0]==='I')){
      // Java's single-code-point case mapping is 1:1 (UnicodeData simple mapping); expansions such as U+00DF stay unchanged.
      const cp=int(args[0]),source=cp>=0&&cp<=0x10ffff?String.fromCodePoint(cp):'',mapped=name==='toUpperCase'?source.toUpperCase():source.toLowerCase();
      return source&&[...mapped].length===1?mapped.codePointAt(0):cp;
    }
    if(method.owner==='Ljava/lang/Character;'&&['isDigit','isLetter','isLetterOrDigit','isUpperCase','isLowerCase','digit','forDigit'].includes(name)){
      // Unicode general-category predicates, as java.lang.Character defines them (Nd, L*, Lu, Ll).
      const cp=int(args[0]),valid=cp>=0&&cp<=0x10ffff,ch=valid?String.fromCodePoint(cp):'',test=re=>valid&&re.test(ch)?1:0;
      if(name==='forDigit'){const radix=int(args[1]);return radix<2||radix>36||cp<0||cp>=radix?0:(cp<10?48+cp:87+cp);}
      if(name==='isDigit')return test(/^\p{Nd}$/u);if(name==='isLetter')return test(/^\p{L}$/u);if(name==='isLetterOrDigit')return test(/^[\p{L}\p{Nd}]$/u);
      if(name==='isUpperCase')return test(/^\p{Lu}$/u);if(name==='isLowerCase')return test(/^\p{Ll}$/u);
      const radix=int(args[1]);if(!valid||radix<2||radix>36)return -1;let value=-1;
      if(cp>=48&&cp<=57)value=cp-48;else if(cp>=97&&cp<=122)value=cp-87;else if(cp>=65&&cp<=90)value=cp-55;else if(cp>=0xff41&&cp<=0xff5a)value=cp-0xff41+10;else if(cp>=0xff21&&cp<=0xff3a)value=cp-0xff21+10;
      else if(/^\p{Nd}$/u.test(ch)){let start=cp;while(start>0&&/^\p{Nd}$/u.test(String.fromCodePoint(start-1)))start--;value=(cp-start)%10;}
      return value>=0&&value<radix?value:-1;
    }
    if(method.owner==='Ljava/lang/Character;'&&name==='getDirectionality')return androidCharacterDirectionality(int(args[0]));
    if(method.owner==='Ljava/lang/Character;'&&name==='isSurrogate'){const c=int(args[0])&0xffff;return c>=0xd800&&c<=0xdfff?1:0;}
    if(method.owner==='Ljava/lang/Character;'&&name==='isSurrogatePair'){const h=int(args[0])&0xffff,l=int(args[1])&0xffff;return h>=0xd800&&h<=0xdbff&&l>=0xdc00&&l<=0xdfff?1:0;}
    if(method.owner==='Ljava/lang/Character;'&&name==='toTitleCase'){
      // UnicodeData titlecase mapping: the digraph letters (DZ, Dz, dz; LJ, NJ, DŽ families) map to their Lt form; every other character titlecases as it uppercases.
      const cp=int(args[0]);const TITLE={0x1c4:0x1c5,0x1c5:0x1c5,0x1c6:0x1c5,0x1c7:0x1c8,0x1c8:0x1c8,0x1c9:0x1c8,0x1ca:0x1cb,0x1cb:0x1cb,0x1cc:0x1cb,0x1f1:0x1f2,0x1f2:0x1f2,0x1f3:0x1f2};
      if(TITLE[cp]!==undefined)return TITLE[cp];
      const source=cp>=0&&cp<=0x10ffff?String.fromCodePoint(cp):'',mapped=source.toUpperCase();return source&&[...mapped].length===1?mapped.codePointAt(0):cp;
    }
    if(method.owner==='Ljava/lang/Character;'&&name==='getType'){
      // java.lang.Character.getType: the Unicode general category as the Character.* byte constants.
      const cp=int(args[0]);if(cp<0||cp>0x10ffff)return 0;const ch=String.fromCodePoint(cp);
      const CATEGORIES=[['Cn',0],['Lu',1],['Ll',2],['Lt',3],['Lm',4],['Lo',5],['Mn',6],['Me',7],['Mc',8],['Nd',9],['Nl',10],['No',11],['Zs',12],['Zl',13],['Zp',14],['Cc',15],['Cf',16],['Co',18],['Cs',19],['Pd',20],['Ps',21],['Pe',22],['Pc',23],['Po',24],['Sm',25],['Sc',26],['Sk',27],['So',28],['Pi',29],['Pf',30]];
      for(const [category,value] of CATEGORIES)if(category!=='Cn'&&new RegExp(`^\\p{${category}}$`,'u').test(ch))return value;
      return 0;
    }
    if(method.owner==='Ljava/lang/Character;'&&name==='codePointBefore'){
      const seq=args[0],index=int(args[1]);if(seq===null||seq===undefined)this.throwJava('Ljava/lang/NullPointerException;','Attempt to get length of null object');
      const at=i=>typeof seq==='string'?seq.charCodeAt(i):int(this.dispatch({owner:'Ljava/lang/CharSequence;',name:'charAt',parameters:['I'],result:'C',signature:'(I)C'},[seq,i],'virtual'));
      const length=typeof seq==='string'?seq.length:int(this.dispatch({owner:'Ljava/lang/CharSequence;',name:'length',parameters:[],result:'I',signature:'()I'},[seq],'virtual'));
      if(index<1||index>length)this.throwJava('Ljava/lang/IndexOutOfBoundsException;',`index=${index}, length=${length}`);
      const low=at(index-1);if(low>=0xdc00&&low<=0xdfff&&index>=2){const high=at(index-2);if(high>=0xd800&&high<=0xdbff)return ((high-0xd800)<<10)+(low-0xdc00)+0x10000;}
      return low;
    }
    if(method.owner==='Ljava/lang/Character;'&&['charCount','codePointAt','isHighSurrogate','isLowSurrogate','toCodePoint'].includes(name))return this.dispatch({...method,owner:'Landroid/text/CharacterAlgorithms;'},this.argumentWords(method.parameters,args),'static');
    if(method.owner==='Ljava/lang/reflect/Array;'&&['getLength','get','set'].includes(name)){
      // java.lang.reflect.Array: non-array receivers raise IllegalArgumentException("Argument is not an array"); index errors ArrayIndexOutOfBoundsException.
      if(isNull(args[0]))this.throwJava('Ljava/lang/NullPointerException;','array == null');
      const array=this.object(args[0]);if(!array.elements||!array.type.startsWith('['))this.throwJava('Ljava/lang/IllegalArgumentException;','Argument is not an array');
      if(name==='getLength')return array.elements.length;
      const index=int(args[1]);if(index<0||index>=array.elements.length)this.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;',`length=${array.elements.length}; index=${index}`);
      const component=array.type.slice(1);
      if(name==='get')return this.boxPrimitive(component,array.elements[index]);
      array.elements[index]=this.unboxReflection(args[2],component);return undefined;
    }
    if(method.owner==='Ljava/lang/reflect/Array;'&&name==='newInstance'){
      const component=this.object(args[0]).classType;if(!component)fail('Array.newInstance requires a Class');if(component.replaceAll('[','')==='V')this.throwJava('Ljava/lang/IllegalArgumentException;','void array component');
      const dimensions=method.parameters[1]==='[I'?this.array(args[1]).elements.map(int):[int(args[1])];
      if(method.parameters[1]==='[I'&&this.typeOf(args[1])!=='[I')this.throwJava('Ljava/lang/ClassCastException;','Array dimensions require int[]');
      if(!dimensions.length||component.match(/^\[*/)[0].length+dimensions.length>255)this.throwJava('Ljava/lang/IllegalArgumentException;','Array dimensions must total1..255');
      for(const length of dimensions)if(length<0)this.throwJava('Ljava/lang/NegativeArraySizeException;','negative reflected array dimension');
      let nodes=1,totalArrays=0,totalCells=0;for(const length of dimensions){if(nodes===0)break;totalArrays+=nodes;totalCells+=nodes*length;if(length>1000000||totalCells+this.arrayCells>4000000||totalArrays+this.heap.size>this.maxHeapObjects)fail('Reflected multi-array allocation exceeds VM heap limits');nodes*=length;}
      const allocate=depth=>{const value=this.newArray('['.repeat(dimensions.length-depth)+component,dimensions[depth]);if(depth+1<dimensions.length){const values=this.array(value).elements;for(let i=0;i<values.length;i++)values[i]=allocate(depth+1);}return value;};return allocate(0);
    }
    if(method.owner==='Ljava/security/SecureRandom;'){
      const receiver=this.object(args[0]);
      if(name==='<init>'){receiver.secureRandom=true;return;}
      if(!receiver.secureRandom)fail('SecureRandom used before constructor');
      const array=this.array(args[1]);if(array.type!=='[B')this.throwJava('Ljava/lang/IllegalArgumentException;','SecureRandom requires byte[]');
      if(!globalThis.crypto?.getRandomValues)throw new APKError('WebCrypto secure randomness is unavailable; SecureRandom cannot fall back to Math.random',{kind:'secure-random-unavailable'});
      for(let start=0;start<array.elements.length;start+=65536){const bytes=globalThis.crypto.getRandomValues(new Uint8Array(Math.min(65536,array.elements.length-start)));for(let i=0;i<bytes.length;i++)array.elements[start+i]=(bytes[i]<<24)>>24;}
      return;
    }
    if(staticCall&&['Ljava/lang/Integer;','Ljava/lang/Long;'].includes(method.owner)&&['toString','toHexString','toOctalString','toBinaryString','toUnsignedString'].includes(name)){
      let radix=name==='toHexString'?16:name==='toOctalString'?8:name==='toBinaryString'?2:method.parameters.length===2?int(args[1]):10;if(radix<2||radix>36)radix=10;
      const unsigned=name!=='toString';return (method.owner==='Ljava/lang/Integer;'?(unsigned?int(args[0])>>>0:int(args[0])):(unsigned?BigInt.asUintN(64,wide(args[0])):wide(args[0]))).toString(radix);
    }
    if(name==='toArray'&&method.signature==='([Ljava/lang/Object;)[Ljava/lang/Object;'){
      const values=this.collectionValues(this.object(args[0])),provided=this.array(args[1]);
      if(!provided.type.startsWith('[L')&&!provided.type.startsWith('[['))this.throwJava('Ljava/lang/ArrayStoreException;','Collection target must be a reference array');
      const target=provided.elements.length>=values.length?args[1]:this.newArray(provided.type,values.length),array=this.array(target),component=array.type.slice(1);
      for(let i=0;i<values.length;i++){const value=values[i];if(!isNull(value)&&!this.isSubtype(this.typeOf(value),component))this.throwJava('Ljava/lang/ArrayStoreException;',`Cannot store ${this.typeOf(value)} in ${array.type}`);array.elements[i]=value;}
      if(array.elements.length>values.length)array.elements[values.length]=null;
      return target;
    }
    if(staticCall&&name==='hashCode'&&method.parameters.length===1&&method.signature.length===4&&/^[ZBSCIJFD]$/.test(method.parameters[0])){ // static Xxx.hashCode(primitive): '(Z)I' is 4 characters
      const kind=method.parameters[0];
      if(kind==='Z')return args[0]?1231:1237;
      if(kind==='J'){const v=BigInt.asUintN(64,wide(args[0]));return Number(BigInt.asIntN(32,v^(v>>32n)));}
      if(kind==='D'){let v=BigInt.asUintN(64,wide(args[0]));if((v&0x7ff0000000000000n)===0x7ff0000000000000n&&(v&0xfffffffffffffn)!==0n)v=0x7ff8000000000000n;return Number(BigInt.asIntN(32,v^(v>>32n)));}
      if(kind==='F'){const b=int(args[0]);return (b&0x7f800000)===0x7f800000&&(b&0x7fffff)!==0?0x7fc00000:b;}
      return int(args[0]);
    }
    if(['Ljava/lang/Integer;','Ljava/lang/Long;'].includes(method.owner)&&['compare','compareUnsigned','signum'].includes(name)){
      const long=method.owner==='Ljava/lang/Long;',convert=long?(name==='compareUnsigned'?n=>BigInt.asUintN(64,wide(n)):wide):(name==='compareUnsigned'?n=>int(n)>>>0:int),a=convert(args[0]),b=name==='signum'?(long?0n:0):convert(args[1]);return a===b?0:a<b?-1:1;
    }
    if(['Ljava/lang/Integer;','Ljava/lang/Long;'].includes(method.owner)&&['lowestOneBit','highestOneBit'].includes(name)){
      if(method.owner==='Ljava/lang/Integer;'){const n=int(args[0]);return name==='lowestOneBit'?n&-n:n===0?0:1<<(31-Math.clz32(n));}
      const n=BigInt.asUintN(64,wide(args[0]));return BigInt.asIntN(64,name==='lowestOneBit'?n&-n:n===0n?0n:1n<<BigInt(n.toString(2).length-1));
    }
    if(['Ljava/lang/Integer;','Ljava/lang/Long;'].includes(method.owner)&&['rotateLeft','rotateRight'].includes(name)){
      const long=method.owner==='Ljava/lang/Long;',distance=int(args[1])&(long?63:31),left=name==='rotateLeft';
      if(!long){const n=int(args[0]);return left?(n<<distance)|(n>>>(32-distance)):(n>>>distance)|(n<<(32-distance));}
      const n=BigInt.asUintN(64,wide(args[0])),d=BigInt(distance);return BigInt.asIntN(64,left?(n<<d)|(n>>(64n-d)):(n>>d)|(n<<(64n-d)));
    }
    if (staticCall && ['Ljava/lang/Integer;', 'Ljava/lang/Long;', 'Ljava/lang/Short;', 'Ljava/lang/Character;', 'Ljava/lang/Byte;'].includes(method.owner) && ['reverseBytes', 'reverse', 'sum', 'max', 'min', 'divideUnsigned', 'remainderUnsigned', 'toUnsignedLong', 'toUnsignedInt', 'parseUnsignedInt'].includes(name) || staticCall && ['Ljava/lang/Short;', 'Ljava/lang/Byte;'].includes(method.owner) && name === 'compare') {
      const owner = method.owner;
      if (owner === 'Ljava/lang/Long;') {
        const a = wide(args[0]), b = args.length > 1 ? wide(args[1]) : 0n; // host arguments are compacted: the second long is args[1]
        if (name === 'reverseBytes') { let v = BigInt.asUintN(64, a), r = 0n; for (let i = 0; i < 8; i++) { r = (r << 8n) | (v & 0xffn); v >>= 8n; } return BigInt.asIntN(64, r); }
        if (name === 'reverse') { let v = BigInt.asUintN(64, a), r = 0n; for (let i = 0; i < 64; i++) { r = (r << 1n) | (v & 1n); v >>= 1n; } return BigInt.asIntN(64, r); }
        if (name === 'sum') return BigInt.asIntN(64, a + b); if (name === 'max') return a > b ? a : b; if (name === 'min') return a < b ? a : b;
        if (b === 0n) this.throwJava('Ljava/lang/ArithmeticException;', '/ by zero');
        return BigInt.asIntN(64, name === 'divideUnsigned' ? BigInt.asUintN(64, a) / BigInt.asUintN(64, b) : BigInt.asUintN(64, a) % BigInt.asUintN(64, b));
      }
      if (owner === 'Ljava/lang/Integer;') {
        const a = int(args[0]), b = args.length > 1 ? int(args[1]) : 0;
        if (name === 'reverseBytes') return ((a & 0xff) << 24) | ((a & 0xff00) << 8) | ((a >>> 8) & 0xff00) | (a >>> 24);
        if (name === 'reverse') { let v = a >>> 0, r = 0; for (let i = 0; i < 32; i++) { r = (r << 1) | (v & 1); v >>>= 1; } return r | 0; }
        if (name === 'sum') return (a + b) | 0; if (name === 'max') return Math.max(a, b); if (name === 'min') return Math.min(a, b);
        if (name === 'toUnsignedLong') return BigInt(a >>> 0);
        if (name === 'parseUnsignedInt') { const text = this.stringCharacters(args[0]); if (!/^\+?\d+$/.test(text) || BigInt(text) > 0xffffffffn) this.throwJava('Ljava/lang/NumberFormatException;', `For input string: "${text}"`); return Number(BigInt(text)) | 0; }
        if (b === 0) this.throwJava('Ljava/lang/ArithmeticException;', '/ by zero');
        return (name === 'divideUnsigned' ? Math.floor((a >>> 0) / (b >>> 0)) : (a >>> 0) % (b >>> 0)) | 0;
      }
      const a = int(args[0]);
      if (owner === 'Ljava/lang/Short;') { if (name === 'reverseBytes') return (((a & 0xff) << 8) | ((a >> 8) & 0xff)) << 16 >> 16; if (name === 'toUnsignedInt') return a & 0xffff; return (a << 16 >> 16) - (int(args[1]) << 16 >> 16); }
      if (owner === 'Ljava/lang/Character;') return ((a & 0xff) << 8) | ((a >> 8) & 0xff);
      if (name === 'toUnsignedLong') return BigInt(a & 0xff); if (name === 'toUnsignedInt') return a & 0xff; return (a << 24 >> 24) - (int(args[1]) << 24 >> 24);
    }
    if (method.owner === 'Ljava/lang/Integer;' && name === 'bitCount') { let n=int(args[0])>>>0,count=0;while(n){n&=n-1;count++;}return count; }
    if (method.owner === 'Ljava/lang/Integer;' && name === 'numberOfLeadingZeros') return Math.clz32(int(args[0]));
    if(method.owner==='Ljava/lang/Integer;'&&name==='numberOfTrailingZeros'){const n=int(args[0]);return n===0?32:31-Math.clz32(n&-n);}
    if(method.owner==='Ljava/lang/Long;'&&['bitCount','numberOfLeadingZeros','numberOfTrailingZeros'].includes(name)){
      let n=BigInt.asUintN(64,wide(args[0]));if(name==='numberOfLeadingZeros')return n===0n?64:64-n.toString(2).length;
      if(name==='numberOfTrailingZeros'){if(n===0n)return 64;let count=0;while(!(n&1n)){count++;n>>=1n;}return count;}
      let count=0;while(n){count++;n&=n-1n;}return count;
    }
    if(method.owner==='Ljava/lang/Long;'&&(name==='getLong'||name==='decode')){
      const decode=name==='decode',fallback=decode?null:method.parameters[1]==='J'?this.boxPrimitive('J',args[1]):args[1]??null,text=decode?args[0]:typeof args[0]==='string'?this.javaProperties.get(args[0]):undefined;
      if(decode&&isNull(text))this.throwJava('Ljava/lang/NullPointerException;','Long string is null');
      const invalid=()=>{if(decode)this.throwJava('Ljava/lang/NumberFormatException;',`Invalid Long: ${text}`);return fallback;};
      if(typeof text!=='string')return invalid();
      const match=/^([+-]?)(?:(0[xX]|#)([0-9a-fA-F]+)|(0)([0-7]+)|([1-9][0-9]*|0))$/.exec(text);if(!match)return invalid();
      const digits=(match[3]??match[5]??match[6]).replace(/^0+/,'')||'0';if(digits.length>22)return invalid();
      const number=BigInt((match[3]?'0x':match[5]?'0o':'')+digits)*(match[1]==='-'?-1n:1n);
      return number<-(1n<<63n)||number>(1n<<63n)-1n?invalid():this.boxPrimitive('J',number);
    }
    // Integer.getInteger / Integer.decode (java.lang.Integer): a system property decoded like Integer.decode ("0x", "#", leading-0 octal,
    // sign); a missing or malformed property yields the default (boxed), decode throws NumberFormatException instead.
    if(method.owner==='Ljava/lang/Integer;'&&staticCall&&(name==='getInteger'||name==='decode')){
      const decode=name==='decode',fallback=decode?null:method.parameters[1]==='I'?this.boxPrimitive('I',args[1]):args[1]??null,text=decode?args[0]:typeof args[0]==='string'?this.javaProperties.get(args[0]):undefined;
      if(decode&&isNull(text))this.throwJava('Ljava/lang/NullPointerException;','Integer string is null');
      const invalid=()=>{if(decode)this.throwJava('Ljava/lang/NumberFormatException;',`For input string: "${text}"`);return fallback;};
      if(typeof text!=='string')return invalid();
      const match=/^([+-]?)(?:(0[xX]|#)([0-9a-fA-F]+)|(0)([0-7]+)|([1-9][0-9]*|0))$/.exec(text);if(!match)return invalid();
      const digits=(match[3]??match[5]??match[6]).replace(/^0+/,'')||'0';if(digits.length>12)return invalid();
      const number=BigInt((match[3]?'0x':match[5]?'0o':'')+digits)*(match[1]==='-'?-1n:1n);
      return number<-(1n<<31n)||number>(1n<<31n)-1n?invalid():this.boxPrimitive('I',Number(number));
    }
    // Boolean.getBoolean(name): true only when the system property equals "true", ignoring case.
    if(method.owner==='Ljava/lang/Boolean;'&&staticCall&&name==='getBoolean'&&method.signature==='(Ljava/lang/String;)Z'){const value=typeof args[0]==='string'?this.javaProperties.get(args[0]):undefined;return typeof value==='string'&&value.toLowerCase()==='true'?1:0;}
    if (method.owner === 'Ljava/lang/Double;' && staticCall && ['doubleToRawLongBits', 'doubleToLongBits', 'longBitsToDouble'].includes(name)) { // doubles travel as their IEEE-754 bit patterns, so the raw conversions are identity
      const bits = wide(args[0]); return name === 'doubleToLongBits' && Number.isNaN(doubleNumber(bits)) ? 0x7ff8000000000000n : bits;
    }
    if (method.owner === 'Ljava/lang/Float;' && staticCall && ['intBitsToFloat','floatToRawIntBits','floatToIntBits'].includes(name)) {
      const bits=int(args[0]);return name==='floatToIntBits'&&(bits&0x7f800000)===0x7f800000&&(bits&0x7fffff)!==0?0x7fc00000:bits;
    }
    if (staticCall && ['Ljava/lang/Float;', 'Ljava/lang/Double;'].includes(method.owner) && method.parameters.length === 1 && (name === 'toString' ? ['D', 'F'].includes(method.parameters[0]) : ['parseDouble', 'valueOf'].includes(name) && method.parameters[0] === 'Ljava/lang/String;')) {
      const isDouble = method.owner === 'Ljava/lang/Double;', prim = isDouble ? 'D' : 'F';
      if (name === 'toString') return this.floatingDecimal('toJavaFormatString', [prim], [args[0]], 'Ljava/lang/String;', true);
      if (isNull(args[0])) this.throwJava('Ljava/lang/NullPointerException;', name === 'valueOf' ? 'null' : 'Null input string');
      const bits = isDouble ? this.floatingDecimal('parseDouble', ['Ljava/lang/String;'], [args[0]], 'D') : parseJavaFloatBits(this.stringCharacters(args[0]));
      if (bits === null) this.throwJava('Ljava/lang/NumberFormatException;', `For input string: "${this.stringCharacters(args[0])}"`);
      return name === 'parseDouble' ? bits : this.dispatch({ owner: method.owner, name: 'valueOf', parameters: [prim], result: method.owner, signature: `(${prim})${method.owner}` }, this.argumentWords([prim], [bits]), 'static');
    }
    if(method.owner==='Ljava/lang/Float;'&&staticCall&&name==='parseFloat'){
      if(isNull(args[0]))this.throwJava('Ljava/lang/NullPointerException;','Float string is null');
      if(typeof args[0]!=='string')fail('Float.parseFloat requires a String');
      const value=parseJavaFloatBits(args[0]);if(value===null)this.throwJava('Ljava/lang/NumberFormatException;',`For input string: ${args[0]}`);return value;
    }
    if(staticCall&&['Ljava/lang/Float;','Ljava/lang/Double;'].includes(method.owner)&&['isNaN','isInfinite','isFinite'].includes(name)){
      const number=method.owner==='Ljava/lang/Float;'?floatNumber(args[0]):doubleNumber(args[0]);return (name==='isNaN'?Number.isNaN(number):name==='isInfinite'?Math.abs(number)===Infinity:Number.isFinite(number))?1:0;
    }
    if(staticCall&&['Ljava/lang/Float;','Ljava/lang/Double;'].includes(method.owner)&&name==='compare'){
      const double=method.owner==='Ljava/lang/Double;',decode=double?doubleNumber:floatNumber,a=decode(args[0]),b=decode(args[1]);if(a<b)return -1;if(a>b)return 1;
      const aa=Number.isNaN(a)?(double?0x7ff8000000000000n:0x7fc00000):args[0],bb=Number.isNaN(b)?(double?0x7ff8000000000000n:0x7fc00000):args[1];return aa===bb?0:aa<bb?-1:1;
    }
    if(method.owner==='Ljava/util/concurrent/atomic/AtomicReferenceArray;'){
      const object=this.object(args[0]);
      if(name==='<init>'){const source=method.parameters[0]==='I'?null:this.array(args[1]);object.atomicArray=this.newArray('[Ljava/lang/Object;',source?source.elements.length:int(args[1]));if(source)this.object(object.atomicArray).elements=source.elements.slice();return;}
      const array=this.array(object.atomicArray);if(name==='length')return array.elements.length;
      const index=int(args[1]);this.array(object.atomicArray,index);const previous=array.elements[index];
      if(name==='get')return previous;
      if(name==='compareAndSet'||name==='weakCompareAndSet'){if(!equal(previous,args[2]))return 0;array.elements[index]=args[3];return 1;}
      array.elements[index]=args[2];return name==='getAndSet'?previous:undefined;
    }
    if(name==='addAll'&&method.signature==='(Ljava/util/Collection;)Z'&&this.isSubtype(this.typeOf(args[0]),'Ljava/util/Set;')){
      const values=this.collectionValues(this.object(args[1])).slice();let changed=0;for(const value of values)if(this.dispatch({owner:this.typeOf(args[0]),name:'add',parameters:['Ljava/lang/Object;'],result:'Z',signature:'(Ljava/lang/Object;)Z'},[args[0],value],'virtual'))changed=1;return changed;
    }
    if(name==='removeAll'&&method.signature==='(Ljava/util/Collection;)Z'){
      this.object(args[1]);let changed=0,steps=0;
      const call=(receiver,name,parameters,result,values=[])=>this.dispatch({owner:this.typeOf(receiver),name,parameters,result,signature:`(${parameters.join('')})${result}`},[receiver,...values],'virtual');
      const object=this.object(args[0]);
      if(object.type.includes('CopyOnWrite')){
        const values=this.collectionValues(object),before=object.modCount??0,kept=[];
        for(const value of values)if(call(args[1],'contains',['Ljava/lang/Object;'],'Z',[value]))changed=1;else kept.push(value);
        if((object.modCount??0)!==before)this.throwJava('Ljava/util/ConcurrentModificationException;','Collection changed during bulk removal');
        if(changed){this.reserveCollection(kept.length-values.length);if(object.set){object.set=kept;object.setHashes=kept.map(value=>this.javaHash(value));}else object.list=kept;object.modCount++;}return changed;
      }
      const iterator=call(args[0],'iterator',[],'Ljava/util/Iterator;');
      while(call(iterator,'hasNext',[],'Z')){if(++steps>1000000)fail('Collection bulk operation limit exceeded');const value=call(iterator,'next',[],'Ljava/lang/Object;');if(call(args[1],'contains',['Ljava/lang/Object;'],'Z',[value])){call(iterator,'remove',[],'V');changed=1;}}
      return changed;
    }
    if (method.owner === 'Landroid/os/Trace;') {
      this.traceSpans ??= [];
      if(name==='isTagEnabled')return 1;
      if(name==='traceBegin'){if(typeof args[1]!=='string')this.throwJava('Ljava/lang/NullPointerException;','Trace name is null');if(this.traceSpans.length>=256)fail('Trace span depth limit exceeded');this.traceSpans.push({tag:args[0],name:args[1]});this.record(`TRACE begin ${args[0]} ${args[1]} [VM diagnostic spans]`);return;}
      const span=this.traceSpans.pop();this.record(`TRACE end ${args[0]} ${span?.name??''} [VM diagnostic spans]`);return;
    }
    if (method.owner === 'Ljava/nio/ByteOrder;') {
      if (name === 'nativeOrder') return this.readStatic({owner:method.owner,name:'LITTLE_ENDIAN',type:method.owner,key:`${method.owner}->LITTLE_ENDIAN:${method.owner}`});
      return this.object(args[0]).byteOrderName;
    }
    // A shared UTF-16 array view at the VM memory boundary. Text direction and
    // codepoint traversal still execute the original AOSP Java algorithms.
    if (method.owner === 'Ljava/nio/CharBuffer;' || method.owner === 'Ljava/nio/Buffer;' && !staticCall && this.object(args[0]).charArray) {
      if (staticCall) {
        const array = this.array(args[0]);
        if (array.type !== '[C') this.throwJava('Ljava/lang/IllegalArgumentException;', 'CharBuffer requires char[]');
        const offset = args.length === 3 ? int(args[1]) : 0, length = args.length === 3 ? int(args[2]) : array.elements.length;
        if (offset < 0 || length < 0 || offset > array.elements.length - length) this.throwJava('Ljava/lang/IndexOutOfBoundsException;', 'CharBuffer.wrap bounds');
        const value = this.makeObject('Ljava/nio/CharBuffer;'); Object.assign(this.object(value), {charArray: args[0], bufferPosition: offset, bufferLimit: offset + length, bufferCapacity: array.elements.length}); return value;
      }
      const buffer = this.object(args[0]), array = this.array(buffer.charArray), position = buffer.bufferPosition, limit = buffer.bufferLimit;
      if (name === 'length' || name === 'remaining') return limit - position;
      if (name === 'capacity') return buffer.bufferCapacity;
      if (name === 'hasRemaining') return position < limit ? 1 : 0;
      if (name === 'array') return buffer.charArray;
      if (name === 'arrayOffset' || name === 'isReadOnly') return 0;
      if (name === 'hasArray') return 1;
      if (name === 'charAt') { const at = int(args[1]); if (at < 0 || at >= limit - position) this.throwJava('Ljava/lang/IndexOutOfBoundsException;', 'CharBuffer.charAt bounds'); return array.elements[position + at] & 65535; }
      if (name === 'toString') return utf16String(array.elements.slice(position, limit));
      if (name === 'subSequence') { const start = int(args[1]), end = int(args[2]); if (start < 0 || end < start || end > limit - position) this.throwJava('Ljava/lang/IndexOutOfBoundsException;', 'CharBuffer.subSequence bounds'); const value = this.makeObject('Ljava/nio/CharBuffer;'); Object.assign(this.object(value), {charArray: buffer.charArray, bufferPosition: position + start, bufferLimit: position + end, bufferCapacity: buffer.bufferCapacity}); return value; }
      if (name === 'position' || name === 'limit') { if (args.length === 1) return name === 'position' ? position : limit; const n = int(args[1]), max = name === 'position' ? limit : buffer.bufferCapacity; if (n < 0 || n > max) this.throwJava('Ljava/lang/IllegalArgumentException;', 'CharBuffer position/limit bounds'); if (name === 'position') buffer.bufferPosition = n; else { buffer.bufferLimit = n; buffer.bufferPosition = Math.min(position, n); } return args[0]; }
      if (['clear', 'flip', 'rewind'].includes(name)) { buffer.bufferPosition = 0; if (name === 'clear') buffer.bufferLimit = buffer.bufferCapacity; else if (name === 'flip') buffer.bufferLimit = position; return args[0]; }
      if (name === 'get' || name === 'put') {
        // java.nio.CharBuffer relative/absolute get and put: BufferUnderflow/OverflowException when fewer than the requested units remain.
        const writing = name === 'put', error = writing ? 'Ljava/nio/BufferOverflowException;' : 'Ljava/nio/BufferUnderflowException;';
        if (method.parameters.length === 0 || method.parameters[0] === 'C') { // get() / put(char)
          if (position >= limit) this.throwJava(error, null);
          if (writing) array.elements[position] = int(args[1]) & 65535; const result = writing ? args[0] : array.elements[position] & 65535; buffer.bufferPosition++; return result;
        }
        if (method.parameters[0] === 'I') { const at = int(args[1]); if (at < 0 || at >= limit) this.throwJava('Ljava/lang/IndexOutOfBoundsException;', null); return array.elements[at] & 65535; }
        const target = this.array(args[1]), from = method.parameters.length === 3 ? int(args[2]) : 0, count = method.parameters.length === 3 ? int(args[3]) : target.elements.length;
        if (target.type !== '[C') this.throwJava('Ljava/lang/ClassCastException;', 'CharBuffer bulk transfer requires char[]');
        if (from < 0 || count < 0 || from > target.elements.length - count) this.throwJava('Ljava/lang/IndexOutOfBoundsException;', 'CharBuffer bulk range');
        if (count > limit - position) this.throwJava(error, null);
        for (let i = 0; i < count; i++) { if (writing) array.elements[position + i] = target.elements[from + i] & 65535; else target.elements[from + i] = array.elements[position + i] & 65535; }
        buffer.bufferPosition += count; return args[0];
      }
      fail(`Unsupported CharBuffer memory operation: ${key}`);
    }
    if (['Ljava/nio/ByteBuffer;', 'Ljava/nio/Buffer;'].includes(method.owner)) {
      if (staticCall) {
        if ((name === 'allocate' || name === 'allocateDirect') && int(args[0]) < 0) this.throwJava('Ljava/lang/IllegalArgumentException;', 'Negative ByteBuffer capacity');
        const array = name === 'allocate' || name === 'allocateDirect' ? this.newArray('[B',int(args[0])) : args[0], bytes = this.array(array);
        if (bytes.type !== '[B') this.throwJava('Ljava/lang/IllegalArgumentException;', 'ByteBuffer requires byte[]');
        const offset = name === 'wrap' && args.length === 3 ? int(args[1]) : 0, length = name === 'wrap' && args.length === 3 ? int(args[2]) : bytes.elements.length;
        if (offset < 0 || length < 0 || offset > bytes.elements.length - length) this.throwJava('Ljava/lang/IndexOutOfBoundsException;', 'ByteBuffer.wrap bounds');
        const value = this.makeObject('Ljava/nio/ByteBuffer;'); Object.assign(this.object(value),{byteArray:array,bufferPosition:offset,bufferLimit:offset+length,bufferCapacity:bytes.elements.length,littleEndian:false,direct:name==='allocateDirect'}); return value;
      }
      const buffer=this.object(args[0]), bytes=this.array(buffer.byteArray),pos=buffer.bufferPosition,limit=buffer.bufferLimit;
      if (name === 'order') { if (args.length === 1) return this.readStatic({owner:'Ljava/nio/ByteOrder;',name:buffer.littleEndian?'LITTLE_ENDIAN':'BIG_ENDIAN',type:'Ljava/nio/ByteOrder;',key:`Ljava/nio/ByteOrder;->${buffer.littleEndian?'LITTLE_ENDIAN':'BIG_ENDIAN'}:Ljava/nio/ByteOrder;`}); buffer.littleEndian=this.object(args[1]).byteOrderName==='LITTLE_ENDIAN';return args[0]; }
      if (name === 'isDirect') return buffer.direct ? 1 : 0;
      if (name === 'asCharBuffer') {
        // ByteBuffer.asCharBuffer(): a live view of the remaining bytes (position..limit) as UTF-16 units in the buffer's current byte order.
        const count = (limit - pos) >> 1, little = buffer.littleEndian, base = pos, storage = bytes.elements, view = this.newArray('[C', 0);
        const unit = index => little ? ((storage[base + index * 2 + 1] & 255) << 8) | (storage[base + index * 2] & 255) : ((storage[base + index * 2] & 255) << 8) | (storage[base + index * 2 + 1] & 255);
        this.object(view).elements = new Proxy(new Array(count).fill(0), {
          get: (target, property, receiver) => typeof property === 'string' && /^\d+$/.test(property) ? (Number(property) < count ? unit(Number(property)) : undefined) : Reflect.get(target, property, receiver),
          set: (target, property, value) => {
            if (typeof property === 'string' && /^\d+$/.test(property)) { const index = Number(property); if (index >= count) return false; const c = value & 65535, hi = (c >> 8 << 24) >> 24, lo = ((c & 255) << 24) >> 24; storage[base + index * 2] = little ? lo : hi; storage[base + index * 2 + 1] = little ? hi : lo; return true; }
            return Reflect.set(target, property, value);
          },
        });
        const value = this.makeObject('Ljava/nio/CharBuffer;'); Object.assign(this.object(value), { charArray: view, bufferPosition: 0, bufferLimit: count, bufferCapacity: count }); return value;
      }
      if (name === 'array') { if (buffer.direct) this.throwJava('Ljava/lang/UnsupportedOperationException;', null); return buffer.byteArray; }
      if (name === 'arrayOffset') return 0;
      if (name === 'hasArray') return buffer.direct ? 0 : 1;
      if ((name === 'get' || name === 'put') && method.parameters[0] === '[B') {
        // Relative bulk transfer (java.nio.ByteBuffer.get(byte[],int,int) / put(byte[],int,int)): BufferUnderflow/OverflowException before any copy.
        const array = this.array(args[1]), from = method.parameters.length === 3 ? int(args[2]) : 0, count = method.parameters.length === 3 ? int(args[3]) : array.elements.length;
        if (from < 0 || count < 0 || from > array.elements.length - count) this.throwJava('Ljava/lang/IndexOutOfBoundsException;', 'ByteBuffer bulk range');
        if (count > limit - pos) this.throwJava(name === 'get' ? 'Ljava/nio/BufferUnderflowException;' : 'Ljava/nio/BufferOverflowException;', null);
        for (let i = 0; i < count; i++) { if (name === 'get') array.elements[from + i] = bytes.elements[pos + i]; else bytes.elements[pos + i] = array.elements[from + i]; }
        buffer.bufferPosition += count; return args[0];
      }
      if (name === 'isReadOnly') return 0;
      if (name === 'capacity') return buffer.bufferCapacity;
      if (name === 'remaining') return limit-pos;
      if (name === 'hasRemaining') return pos<limit?1:0;
      if (name === 'position' || name === 'limit') {
        if (args.length === 1) return name === 'position' ? pos : limit;
        const n=int(args[1]),max=name==='position'?limit:buffer.bufferCapacity;
        if(n<0||n>max)this.throwJava('Ljava/lang/IllegalArgumentException;', 'Buffer position/limit out of bounds');
        if(name==='position')buffer.bufferPosition=n;else{buffer.bufferLimit=n;buffer.bufferPosition=Math.min(pos,n);}return args[0];
      }
      if (['clear','flip','rewind'].includes(name)) {buffer.bufferPosition=0;if(name==='clear')buffer.bufferLimit=buffer.bufferCapacity;else if(name==='flip')buffer.bufferLimit=pos;return args[0];}
      const writing=name.startsWith('put'),suffix=name.slice(3),width=['Long','Double'].includes(suffix)?8:['Short','Char'].includes(suffix)?2:suffix?4:1,indexed=method.parameters[0]==='I' && (writing?method.parameters.length===2:method.parameters.length===1),at=indexed?int(args[1]):pos;
      if(at<0||at>limit-width)this.throwJava(indexed?'Ljava/lang/IndexOutOfBoundsException;':writing?'Ljava/nio/BufferOverflowException;':'Ljava/nio/BufferUnderflowException;', 'ByteBuffer access outside limit');
      const data=new DataView(new ArrayBuffer(width)),little=buffer.littleEndian;
      for(let i=0;i<width;i++)data.setInt8(i,bytes.elements[at+i]);
      if(writing){const value=args[indexed?2:1];if(suffix==='Long'||suffix==='Double')data.setBigInt64(0,wide(value),little);else if(width===4)data.setInt32(0,int(value),little);else if(width===2)data.setInt16(0,int(value),little);else data.setInt8(0,int(value));for(let i=0;i<width;i++)bytes.elements[at+i]=data.getInt8(i);}
      if(!indexed)buffer.bufferPosition+=width;
      if(writing)return args[0];return width===8?data.getBigInt64(0,little):width===4?data.getInt32(0,little):width===2?(suffix==='Char'?data.getUint16(0,little):data.getInt16(0,little)):data.getInt8(0);
    }
    if (method.owner === 'Ljava/util/concurrent/TimeUnit;' && staticCall) {
      const constant = name => this.readStatic({ owner: method.owner, name, type: method.owner, key: `${method.owner}->${name}:${method.owner}` });
      if (name === 'values') { const array = this.newArray(`[${method.owner}`, TIME_UNITS.length); this.object(array).elements = TIME_UNITS.map(constant); return array; }
      if (isNull(args[0])) this.throwJava('Ljava/lang/NullPointerException;', 'null TimeUnit name');
      if (!TIME_UNITS.includes(args[0])) this.throwJava('Ljava/lang/IllegalArgumentException;', `No TimeUnit.${args[0]}`);
      return constant(args[0]);
    }
    if (method.owner === 'Ljava/lang/ClassLoader;' && name === 'getSystemClassLoader') return this.applicationClassLoader ??= this.platform?.classLoaders?.createApplicationLoader(this) ?? this.makeObject(method.owner);
    if (method.owner === 'Ljava/lang/ClassLoader;') {
      this.object(args[0]);
      if (name === 'loadClass') return this.resolveClass(args[1], false, args[0]);
      if (name === 'getParent') return null;
    }
    if ((method.owner === 'Ljava/lang/System;' || method.owner === 'Ljava/lang/Runtime;') && ['load', 'loadLibrary'].includes(name))
    {
      // System.load/loadLibrary (Runtime.nativeLoad): a null name is a NullPointerException before any loading; otherwise the request is reported verbatim.
      const requested = args[staticCall ? 0 : 1];
      if (isNull(requested)) this.throwJava('Ljava/lang/NullPointerException;', name === 'load' ? 'filename == null' : 'nativeLibraryName == null');
      const text = this.stringCharacters(requested);
      if (name === 'loadLibrary' && text.includes('/')) this.throwJava('Ljava/lang/UnsatisfiedLinkError;', 'Directory separator should not appear in library name: ' + text);
      // A lab-supplied WebAssembly module (never APK bytes) satisfies the request through the JNI bridge; otherwise the genuine failure below stands.
      if (this.jni && (name === 'load' ? this.jni.loadPath(text) : this.jni.loadLibrary(text))) return undefined;
      this.nativeRequired(key, text);
    }
    if (method.owner === 'Ljava/lang/System;') {
      if (['getProperty','setProperty','clearProperty'].includes(name)) {
        if(isNull(args[0]))this.throwJava('Ljava/lang/NullPointerException;','Property key is null');
        if(typeof args[0]!=='string'||!args[0].length)this.throwJava('Ljava/lang/IllegalArgumentException;','Property key is empty/invalid');
        const old=this.javaProperties.has(args[0])?this.javaProperties.get(args[0]):null;
        if(name==='getProperty')return old??args[1]??null;
        if(name==='clearProperty')this.javaProperties.delete(args[0]);else{if(isNull(args[1]))this.throwJava('Ljava/lang/NullPointerException;','Property value is null');if(typeof args[1]!=='string')fail('Expected Java property String');this.javaProperties.set(args[0],args[1]);}return old;
      }
      if (name === 'currentTimeMillis') return BigInt(Math.floor(this.clock.wall()));
      if (name === 'nanoTime') return this.clock.nanos();
      if (name === 'identityHashCode') return isNull(args[0]) ? 0 : typeof args[0] === 'string' ? stringHash(args[0]) : this.object(args[0]).id;
      if (name === 'arraycopy') {
        const source=this.object(args[0]),target=this.object(args[2]),from=int(args[1]),to=int(args[3]),length=int(args[4]);
        if(!source.type.startsWith('[')||!target.type.startsWith('['))this.throwJava('Ljava/lang/ArrayStoreException;','System.arraycopy requires arrays');
        if((source.type.slice(1).length===1||target.type.slice(1).length===1)&&source.type!==target.type)this.throwJava('Ljava/lang/ArrayStoreException;','System.arraycopy primitive array type mismatch');
        if(from<0||to<0||length<0||from+length>source.elements.length||to+length>target.elements.length)this.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;','System.arraycopy bounds error');
        const values = source.elements.slice(from, from + length);
        for (let i = 0; i < length; i++) { this.checkArrayValue(target, values[i]); target.elements[to + i] = values[i]; }
        return undefined;
      }
    }
    if (method.owner === 'Ljava/lang/Runtime;' && name === 'getRuntime') return this.runtimeObject ??= this.makeObject(method.owner);
    if (method.owner === 'Ljava/lang/Runtime;' && name === 'availableProcessors') { this.object(args[0]); return 1; } // One logical CPU in the explicit single-thread VM device profile.
    if (method.owner === 'Ljava/lang/Math;') {
      if(name==='rint'){
        const value=doubleNumber(args[0]);if(!Number.isFinite(value)||value===0)return args[0];
        const magnitude=Math.abs(value),floor=Math.floor(magnitude),fraction=magnitude-floor;
        const rounded=floor+(fraction>0.5||(fraction===0.5&&floor%2!==0)?1:0);
        return doubleBits(value<0?-rounded:rounded);
      }
      if(name==='pow')return doubleBits(Math.pow(doubleNumber(args[0]),doubleNumber(args[1])));
      if(['log','exp','sqrt','cos','sin','ceil','floor'].includes(name))return doubleBits(Math[name](doubleNumber(args[0])));
      if(name==='copySign'){const double=method.parameters[0]==='D',decode=double?doubleNumber:floatNumber,encode=double?doubleBits:floatBits,m=decode(args[0]),sgn=decode(args[1]);const negative=Number.isNaN(sgn)?false:(sgn<0||Object.is(sgn,-0));return encode(negative?-Math.abs(m):Math.abs(m));}
      if(name==='nextAfter'&&method.parameters[0]==='D'){
        const start=doubleNumber(args[0]),direction=doubleNumber(args[1]);if(Number.isNaN(start)||Number.isNaN(direction))return doubleBits(NaN);if(start===direction)return doubleBits(direction);
        if(start===0)return doubleBits(direction>0?Number.MIN_VALUE:-Number.MIN_VALUE);
        const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,start);let bits=view.getBigUint64(0);bits+=(direction>start)===(start>0)?1n:-1n;view.setBigUint64(0,bits);return doubleBits(view.getFloat64(0));
      }
      if(name==='ulp'&&method.parameters[0]==='D'){const x=Math.abs(doubleNumber(args[0]));if(!Number.isFinite(x))return doubleBits(Number.isNaN(x)?NaN:Infinity);const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,x);const bits=view.getBigUint64(0);if(x===Number.MAX_VALUE)return doubleBits(2**971);view.setBigUint64(0,bits+1n);return doubleBits(view.getFloat64(0)-x);}
      if(name==='IEEEremainder'){const x=doubleNumber(args[0]),y=doubleNumber(args[1]);if(Number.isNaN(x)||Number.isNaN(y)||!Number.isFinite(x)||y===0)return doubleBits(NaN);if(!Number.isFinite(y))return doubleBits(x);const q=x/y;let n=Math.round(q);if(Math.abs(q-Math.trunc(q))===0.5)n=2*Math.round(q/2);const r=x-n*y;return doubleBits(r===0?(x<0?-0:0):r);}
      if(['cosh','expm1','log1p'].includes(name))return doubleBits(Math[name](doubleNumber(args[0])));
      if(name==='hypot')return doubleBits(Math.hypot(doubleNumber(args[0]),doubleNumber(args[1])));
      if(name==='signum'){const decode=method.parameters[0]==='F'?floatNumber:doubleNumber,encode=method.result==='F'?floatBits:doubleBits,n=decode(args[0]);return Number.isNaN(n)||n===0?args[0]:encode(n<0?-1:1);}
      if(name==='round'){
        if(method.parameters[0]==='F')return javaInt(Math.floor(floatNumber(args[0])+0.5));
        const bits=BigInt.asUintN(64,wide(args[0])),exponent=Number((bits>>52n)&2047n),fraction=bits&0xfffffffffffffn,negative=!!(bits>>63n);
        if(exponent===2047)return fraction?0n:negative?-(1n<<63n):(1n<<63n)-1n;
        const mantissa=fraction|(exponent?1n<<52n:0n),shift=exponent?exponent-1075:-1074;let result;
        if(shift>=0)result=mantissa<<BigInt(shift);else{const denominator=1n<<BigInt(-shift),quotient=mantissa/denominator,remainder=mantissa%denominator;result=quotient+((negative?remainder*2n>denominator:remainder*2n>=denominator)?1n:0n);}
        if(negative)result=-result;return result<-(1n<<63n)?-(1n<<63n):result>(1n<<63n)-1n?(1n<<63n)-1n:result;
      }
      if(method.parameters[0]==='J'){const a=wide(args[0]),b=args[1]===undefined?0n:wide(args[1]);return name==='min'?(a<b?a:b):name==='max'?(a>b?a:b):a<0n?wide(-a):a;}
      if(['F','D'].includes(method.parameters[0])){const double=method.parameters[0]==='D',decode=double?doubleNumber:floatNumber,encode=double?doubleBits:floatBits,a=decode(args[0]),b=args[1]===undefined?0:decode(args[1]);if(Number.isNaN(a))return args[0];if(Number.isNaN(b))return args[1];return encode(name==='min'?Math.min(a,b):name==='max'?Math.max(a,b):Math.abs(a));}
      return name === 'min' ? Math.min(int(args[0]), int(args[1])) : name === 'max' ? Math.max(int(args[0]), int(args[1])) : Math.abs(int(args[0])) | 0;
    }
    if (method.owner === 'Landroid/text/TextUtils;') return name === 'isEmpty' ? (isNull(args[0]) || args[0] === '' ? 1 : 0) : (equal(args[0], args[1]) ? 1 : 0);
    if (method.owner === 'Ljava/util/Arrays;') {
      if(name==='sort'&&method.parameters[0]==='[Ljava/lang/Object;'||name==='sort'&&method.parameters.at(-1)==='Ljava/util/Comparator;'){
        const array=this.array(args[0]),ranged=method.parameters.length===4,from=ranged?int(args[1]):0,to=ranged?int(args[2]):array.elements.length,comparator=args[ranged?3:1];
        if(from>to)this.throwJava('Ljava/lang/IllegalArgumentException;','fromIndex > toIndex');if(from<0||to>array.elements.length)this.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;','Arrays.sort range');
        if(isNull(comparator))fail('Natural-order sorting requires a Comparable bridge; provide the APK Comparator');this.object(comparator);
        const work=array.elements.slice(from,to);let comparisons=0;
        work.sort((a,b)=>{if(++comparisons>1000000)fail('Comparator sort operation limit exceeded');return int(this.dispatch({owner:this.typeOf(comparator),name:'compare',parameters:['Ljava/lang/Object;','Ljava/lang/Object;'],result:'I',signature:'(Ljava/lang/Object;Ljava/lang/Object;)I'},[comparator,a,b],'virtual'));});
        // ES2019+ sort is stable; comparator execution remains original packaged DEX.
        for(let i=0;i<work.length;i++)array.elements[from+i]=work[i];return;
      }
      if(name==='equals'){
        if(equal(args[0],args[1]))return 1;if(isNull(args[0])||isNull(args[1]))return 0;
        const a=this.array(args[0]),b=this.array(args[1]);if(a.elements.length!==b.elements.length)return 0;const type=method.parameters[0].slice(1);
        const canonicalFloat=bits=>(int(bits)&0x7f800000)===0x7f800000&&(int(bits)&0x7fffff)!==0?0x7fc00000:int(bits);
        const canonicalDouble=bits=>(wide(bits)&0x7ff0000000000000n)===0x7ff0000000000000n&&(wide(bits)&0xfffffffffffffn)!==0n?0x7ff8000000000000n:wide(bits);
        for(let i=0;i<a.elements.length;i++){const x=a.elements[i],y=b.elements[i];if(type==='F'?canonicalFloat(x)!==canonicalFloat(y):type==='D'?canonicalDouble(x)!==canonicalDouble(y):type.startsWith('L')?!this.javaEquals(x,y):x!==y)return 0;}return 1;
      }
      const source = this.array(args[0]);
      if (name === 'fill') {
        const ranged=method.parameters.length===4,from=ranged?int(args[1]):0,to=ranged?int(args[2]):source.elements.length;
        if(from>to)this.throwJava('Ljava/lang/IllegalArgumentException;', 'fromIndex > toIndex');
        if(from<0||to>source.elements.length)this.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', 'Arrays.fill range');
        const value=narrow(args[ranged?3:1],source.type.slice(1));this.checkArrayValue(source,value);source.elements.fill(value,from,to);return;
      }
      if (name === 'asList') {if(!source.type.startsWith('[L')&&!source.type.startsWith('[['))this.throwJava('Ljava/lang/ClassCastException;','Arrays.asList requires a reference array');const value = this.makeObject('Ljava/util/Arrays$ArrayList;'); Object.assign(this.object(value),{list:source.elements,fixedSize:true,arrayRef:args[0],modCount:0});return value;}
      {   // primitive-array overloads (toString / hashCode / natural sort / binarySearch) -- elements: float = int bits, double = long bits, long = BigInt, boolean = 0/1
        const component = source.type[1], isFloat = component === 'F', isDouble = component === 'D', isLong = component === 'J';
        const floatOf = bits => { const v = new DataView(new ArrayBuffer(4)); v.setInt32(0, int(bits), true); return v.getFloat32(0, true); };
        const doubleOf = bits => { const v = new DataView(new ArrayBuffer(8)); v.setBigInt64(0, wide(bits), true); return v.getFloat64(0, true); };
        const numeric = v => isFloat ? floatOf(v) : isDouble ? doubleOf(v) : isLong ? wide(v) : int(v);
        const order = (a, b) => { if (a < b) return -1; if (a > b) return 1; if (typeof a === 'number' && (Number.isNaN(a) || Number.isNaN(b))) return Number.isNaN(a) ? (Number.isNaN(b) ? 0 : 1) : -1; if (a === 0 && b === 0 && typeof a === 'number') return Object.is(a, b) ? 0 : Object.is(a, -0) ? -1 : 1; return 0; };
        if (name === 'sort' && method.parameters.length <= 3 && source.type.length === 2 && component !== 'Z' && (method.parameters.length === 1 || method.parameters[1] === 'I')) {
          const ranged = method.parameters.length === 3, from = ranged ? int(args[1]) : 0, to = ranged ? int(args[2]) : source.elements.length;
          if (from > to) this.throwJava('Ljava/lang/IllegalArgumentException;', `fromIndex(${from}) > toIndex(${to})`); if (from < 0 || to > source.elements.length) this.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `Array index out of range: ${from < 0 ? from : to}`);
          const part = source.elements.slice(from, to).sort((a, b) => order(numeric(a), numeric(b))); for (let i = 0; i < part.length; i++) source.elements[from + i] = part[i]; return;
        }
        if (name === 'toString' && source.type.length === 2) {
          const text = v => component === 'Z' ? (int(v) ? 'true' : 'false') : component === 'C' ? String.fromCharCode(int(v) & 0xffff) : isFloat ? this.javaString(int(v), 'F') : isDouble ? this.javaString(wide(v), 'D') : String(isLong ? wide(v) : int(v));
          return '[' + source.elements.map(text).join(', ') + ']';
        }
        if (name === 'hashCode' && source.type.length === 2 && component !== 'I' && component !== 'J') {
          let h = 1; const view = new DataView(new ArrayBuffer(8));
          for (const v of source.elements) { let e; if (component === 'Z') e = int(v) ? 1231 : 1237; else if (isDouble) { const bits = BigInt.asUintN(64, wide(v)); e = Number(BigInt.asIntN(32, bits ^ (bits >> 32n))); } else e = int(v); h = (Math.imul(31, h) + e) | 0; } void view; return h;
        }
        if (name === 'binarySearch' && source.type.length === 2 && (isDouble || component === 'B' || component === 'S' || component === 'C' || method.parameters.length === 4) && component !== 'F' && !(isLong && method.parameters.length === 2)) {
          const ranged = method.parameters.length === 4, from = ranged ? int(args[1]) : 0, to = ranged ? int(args[2]) : source.elements.length, key = numeric(args[ranged ? 3 : 1]);
          if (from > to) this.throwJava('Ljava/lang/IllegalArgumentException;', `fromIndex(${from}) > toIndex(${to})`); if (from < 0 || to > source.elements.length) this.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', 'Array index out of range');
          let low = from, high = to - 1; while (low <= high) { const mid = (low + high) >>> 1, c = order(numeric(source.elements[mid]), key); if (c < 0) low = mid + 1; else if (c > 0) high = mid - 1; else return mid; } return -(low + 1);
        }
      }
      if (name === 'deepHashCode') { const hash = value => { if (isNull(value)) return 0; const o = this.object(value); if (o.elements && o.type.startsWith('[L') || o.elements && o.type.startsWith('[[')) { let h = 1; for (const v of o.elements) h = (Math.imul(31, h) + hash(v)) | 0; return h; } if (o.elements) return this.dispatch({ owner: 'Ljava/util/Arrays;', name: 'hashCode', parameters: [o.type], result: 'I', signature: `(${o.type})I` }, [value], 'static'); return this.javaHash(value); }; return hash(args[0]); }
      if (name === 'hashCode') { let h = 1; const wideKind = source.type === '[J'; for (const v of source.elements) h = (Math.imul(31, h) + (wideKind ? Number(BigInt.asIntN(32, wide(v) ^ (wide(v) >> 32n))) : int(v))) | 0; return h; }
      if (name === 'toString' && source.type.startsWith('[L')) return '[' + source.elements.map(v => isNull(v) ? 'null' : this.javaString(v, 'Ljava/lang/Object;')).join(', ') + ']';
      if (name === 'binarySearch' && method.parameters[0] === '[F') { // java.util.Arrays.binarySearch(float[], float): Float.compare order (-0.0 < 0.0, NaN last), as DualPivot/Arrays use floatToIntBits
        const view = new DataView(new ArrayBuffer(4)), decode = bits => { view.setInt32(0, int(bits), true); return view.getFloat32(0, true); }, order = value => Number.isNaN(value) ? 2 : value, key = decode(args[1]);
        const compare = (a, b) => { const x = order(a), y = order(b); if (x < y) return -1; if (x > y) return 1; if (x === 0 && y === 0 && Object.is(a, b) === false && !Number.isNaN(a)) return Object.is(a, -0) ? -1 : 1; return 0; };
        let low = 0, high = source.elements.length - 1; while (low <= high) { const mid = (low + high) >>> 1, c = compare(decode(source.elements[mid]), key); if (c < 0) low = mid + 1; else if (c > 0) high = mid - 1; else return mid; } return -low - 1;
      }
      if (name === 'binarySearch' && method.parameters[0] === '[J') { const key = wide(args[1]); let low = 0, high = source.elements.length - 1; while (low <= high) { const mid = (low + high) >>> 1, value = wide(source.elements[mid]); if (value < key) low = mid + 1; else if (value > key) high = mid - 1; else return mid; } return -low - 1; }
      if (name === 'binarySearch' && method.parameters.length === 4) { const from = int(args[1]), to = int(args[2]), key = int(args[3]); if (from > to) this.throwJava('Ljava/lang/IllegalArgumentException;', `fromIndex(${from}) > toIndex(${to})`); if (from < 0 || to > source.elements.length) this.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', 'Arrays.binarySearch range'); let low = from, high = to - 1; while (low <= high) { const mid = (low + high) >>> 1, value = int(source.elements[mid]); if (value < key) low = mid + 1; else if (value > key) high = mid - 1; else return mid; } return -low - 1; }
      if (name === 'binarySearch' && method.parameters[0] === '[Ljava/lang/Object;') {
        const key = args[1]; let low = 0, high = source.elements.length - 1;
        while (low <= high) { const mid = (low + high) >>> 1, c = int(this.dispatch({ owner: 'Ljava/lang/Comparable;', name: 'compareTo', parameters: ['Ljava/lang/Object;'], result: 'I', signature: '(Ljava/lang/Object;)I' }, [source.elements[mid], key], 'virtual')); if (c < 0) low = mid + 1; else if (c > 0) high = mid - 1; else return mid; }
        return -low - 1;
      }
      if (name === 'binarySearch') {
        const key = int(args[1]); let low = 0, high = source.elements.length - 1;
        while (low <= high) { const middle = (low + high) >>> 1, value = int(source.elements[middle]); if (value < key) low = middle + 1; else if (value > key) high = middle - 1; else return middle; }
        return -low - 1;
      }
      const from = name === 'copyOfRange' ? int(args[1]) : 0, length = name === 'copyOfRange' ? int(args[2]) - from : int(args[1]);
      if(name==='copyOfRange'&&length<0)this.throwJava('Ljava/lang/IllegalArgumentException;','from > to');
      if(from<0||from>source.elements.length)this.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;','Arrays.copyOfRange from index');
      const classArgument=method.parameters.at(-1)==='Ljava/lang/Class;'?this.object(args.at(-1)).classType:null;
      if(classArgument&&!classArgument.startsWith('['))this.throwJava('Ljava/lang/NullPointerException;','Array class has no component type');
      if(classArgument&&!classArgument.startsWith('[L')&&!classArgument.startsWith('[['))this.throwJava('Ljava/lang/ClassCastException;','Typed copy requires a reference array class');
      const result = this.newArray(classArgument??source.type, length), target = this.object(result);
      for (let i = 0; i < Math.min(length, source.elements.length - from); i++){const value=source.elements[from+i];this.checkArrayValue(target,value);target.elements[i]=value;}
      return result;
    }
    if (method.owner === 'Ljava/util/Collections;') {
      if(name==='singleton'){const value=this.makeObject('Ljava/util/Collections$SingletonSet;'),object=this.object(value);this.reserveCollection(1);Object.assign(object,{set:[args[0]],setHashes:[this.javaHash(args[0])],modCount:0,readOnly:true});return value;}
      if (name === 'synchronizedMap') { this.object(args[0]); const value = this.makeObject('Ljava/util/Collections$SynchronizedMap;'); this.object(value).delegate = args[0]; return value; }
      if (name === 'emptyMap') { const value = this.makeObject('Ljava/util/HashMap;'); this.object(value).map = new Map(); this.object(value).readOnly = true; return value; }
      const value = this.makeObject('Ljava/util/ArrayList;'), obj = this.object(value);
      obj.list = name === 'singletonList' ? [args[0]] : name === 'unmodifiableList' ? this.collectionValues(this.object(args[0])) : [];
      obj.readOnly = true; return value;
    }
    if (method.owner === 'Ljava/lang/Enum;' && name === 'valueOf') {   // Enum.valueOf(Class, String): the constant of that name among the enum class's ACC_ENUM static fields
      if (isNull(args[0]) || isNull(args[1])) this.throwJava('Ljava/lang/NullPointerException;', isNull(args[0]) ? 'enumClass == null' : 'name == null');
      const type = this.object(args[0]).classType, cls = type && this.classes.get(type);
      if (!cls || !this.isSubtype(type, 'Ljava/lang/Enum;')) this.throwJava('Ljava/lang/ClassCastException;', `${(type ?? '').slice(1, -1).replaceAll('/', '.')} is not an enum type`);
      this.initialize(type);
      const wanted = this.stringCharacters(args[1]);
      for (const entry of cls.staticFields) {
        if (!(entry.flags & 0x4000)) continue;
        const field = cls.dex.fields[entry.index], value = this.staticFields.get(field.key);
        if (value && typeof value === 'object' && this.object(value).enumName !== undefined && this.stringCharacters(this.object(value).enumName) === wanted) return value;
      }
      this.throwJava('Ljava/lang/IllegalArgumentException;', `No enum constant ${type.slice(1, -1).replaceAll('/', '.').replaceAll('$', '.')}.${wanted}`);
    }
    if (method.owner === 'Ljava/lang/ThreadLocal;' && name === 'withInitial') { const local = this.makeObject('Ljava/lang/ThreadLocal;'); this.object(local).threadLocalSupplier = args[0]; return local; } // SuppliedThreadLocal
    if (method.owner === 'Ljava/lang/Thread;' && name === 'currentThread') return this.mainThread ??= this.makeObject('Ljava/lang/Thread;');
    if ((method.owner === 'Landroid/os/Looper;' || method.owner === 'Landroid/content/Context;' || method.owner === 'Landroid/content/ContextWrapper;') && name === 'getMainLooper') return this.mainLooper ??= this.makeObject('Landroid/os/Looper;');
    // The main thread's Looper is the platform event queue; any other thread has one only after Looper.prepare() (HandlerThread does that) -- see concurrency-host.js.
    if (method.owner === 'Landroid/os/Looper;' && name === 'myLooper') return this.thread === null || this.thread === this.scheduler.main ? (this.mainLooper ??= this.makeObject('Landroid/os/Looper;')) : (this.thread.looper ?? null);
    if (method.owner === 'Landroid/os/Looper;' && name === 'isCurrentThread') return this.thread === null || this.thread === this.scheduler.main ? 1 : (this.thread.looper ? 1 : 0);
    if (method.owner === 'Landroid/os/SystemClock;') return name === 'elapsedRealtimeNanos' ? this.clock.nanos() : BigInt(Math.floor(this.clock.now()));
    if (method.owner === 'Ljava/util/concurrent/ThreadLocalRandom;' && name === 'current') {
      if (!this.threadRandom) { this.threadRandom = this.makeObject(method.owner); this.object(this.threadRandom).seed = (BigInt(Date.now()) ^ 0x5deece66dn) & ((1n << 48n) - 1n); }
      return this.threadRandom;
    }
    if (method.owner === 'Landroid/util/Log;') {
      if (name === 'isLoggable') return int(args[1]) >= (this.logLevel ?? 4) ? 1 : 0;
      if (name === 'getStackTraceString') {   // Log.getStackTraceString: "" for null, an UnknownHostException is also "" (it is noise on a device without a network), else Throwable.printStackTrace text
        if (isNull(args[0])) return '';
        const lines = []; for (let current = args[0], seen = new Set(), prefix = ''; current && !seen.has(current.ref); current = this.object(current).cause ?? null, prefix = 'Caused by: ') {
          seen.add(current.ref); const o = this.object(current); if (o.type === 'Ljava/net/UnknownHostException;' && !prefix) return '';
          lines.push(prefix + o.type.slice(1, -1).replaceAll('/', '.') + (o.message != null ? ': ' + o.message : '')); for (const m of o.stack ?? []) lines.push('\tat ' + m.owner.slice(1, -1).replaceAll('/', '.') + '.' + m.name + '(Unknown Source)');
        }
        return lines.join('\n') + '\n';
      }
      if (name === 'println') { const level = ({ 2: 'V', 3: 'D', 4: 'I', 5: 'W', 6: 'E', 7: 'A' })[int(args[0])] ?? 'V', text = `${args[1]}: ${args[2] ?? ''}`; this.record(`LOG ${level} ${text}`); return new TextEncoder().encode(text).length; }
      // Log.x(tag, msg, tr) logs msg + '\n' + getStackTraceString(tr); Log.w(tag, tr) / Log.wtf(tag, tr) log just the stack trace string.
      const trace = throwable => this.dispatch({ owner: 'Landroid/util/Log;', name: 'getStackTraceString', parameters: ['Ljava/lang/Throwable;'], result: 'Ljava/lang/String;', signature: '(Ljava/lang/Throwable;)Ljava/lang/String;' }, [throwable], 'static');
      const text = method.parameters.length === 3 ? `${args[1] ?? ''}\n${trace(args[2])}` : method.parameters[1] === 'Ljava/lang/Throwable;' ? trace(args[1]) : (args[1] ?? '');
      const message = `${args[0]}: ${text}`; this.record(`LOG ${name === 'wtf' ? 'A' : name.toUpperCase()} ${message}`); return new TextEncoder().encode(message).length;
    }
    if (method.owner === 'Landroid/os/Handler;' && name === 'createAsync') {
      this.object(args[0]); const value = this.makeObject(method.owner); this.object(value).looper = args[0]; this.object(value).async = true; return value;
    }
    if (method.owner === 'Ljava/util/concurrent/Executors;') {
      const count = int(args[0]); if (count <= 0) this.throwJava('Ljava/lang/IllegalArgumentException;', 'Executor pool size must be positive');
      if (args.length > 1 && isNull(args[1])) this.throwJava('Ljava/lang/NullPointerException;', 'ThreadFactory is null');
      const value = this.makeObject('Ljava/util/concurrent/ThreadPoolExecutor;'), executor = this.object(value);
      executor.poolSize = count; executor.threadFactory = args[1] ?? null; executor.shutdown = false; executor.tasks = [];
      // Java fixed pools create worker threads lazily, when a task is submitted.
      return value;
    }
    if (method.owner.endsWith('FieldUpdater;') && name === 'newUpdater') {
      const owner = this.object(args[0]).classType, fieldName = args[args.length - 1], cls = this.classes.get(owner);
      const expected = method.owner.includes('Reference') ? this.object(args[1]).classType : method.owner.includes('Integer') ? 'I' : 'J';
      const entry = cls?.fields.find(item => { const field = cls.dex.fields[item.index]; return field.name === fieldName && field.type === expected; });
      if (!entry || !(entry.flags & 0x40)) this.throwJava('Ljava/lang/IllegalArgumentException;', `Atomic updater requires volatile field ${owner}->${fieldName}:${expected}`);
      const value = this.makeObject(method.owner); this.object(value).updaterField = cls.dex.fields[entry.index]; return value;
    }
    if (method.owner === 'Ljava/lang/Class;' && name === 'forName') {
      return this.resolveClass(args[0], args.length === 1 || !!args[1], args.length === 3 ? (isNull(args[2]) ? 'boot' : args[2]) : undefined); // explicit null = the boot loader
    }
    if(method.owner==='Ljava/lang/Boolean;'&&name==='parseBoolean'){const text=isNull(args[0])?null:this.stringCharacters(args[0]);return text!==null&&/^[tT][rR][uU][eE]$/.test(text)?1:0;}
    const primitiveBoxType = Object.keys(BOX_TYPES).find(type => BOX_TYPES[type] === method.owner);
    if(primitiveBoxType&&!staticCall&&name==='<init>'){
      const object=this.object(args[0]);if(object.boxed!==undefined)fail('Primitive wrapper constructor cannot run twice');
      object.boxed=narrow(args[1],primitiveBoxType);object.primitiveType=primitiveBoxType;return;
    }
    if(primitiveBoxType&&!staticCall&&name==='hashCode')return this.boxedHash(this.object(args[0]));
    if(primitiveBoxType&&!staticCall&&name==='equals')return !isNull(args[1])&&typeof args[1]!=='string'&&this.boxedEquals(this.object(args[0]),this.object(args[1]))?1:0;
    if(primitiveBoxType&&!staticCall&&name==='compareTo'){
      const value=this.object(args[0]),other=this.object(args[1]);if(value.type!==other.type)this.throwJava('Ljava/lang/ClassCastException;','Boxed comparison requires the same wrapper class');
      if(primitiveBoxType==='F'||primitiveBoxType==='D')return this.dispatch({owner:method.owner,name:'compare',parameters:[primitiveBoxType,primitiveBoxType],result:'I',signature:`(${primitiveBoxType}${primitiveBoxType})I`},this.argumentWords([primitiveBoxType,primitiveBoxType],[value.boxed,other.boxed]),'static');
      return value.boxed===other.boxed?0:value.boxed<other.boxed?-1:1;
    }
    if (primitiveBoxType && staticCall && name === 'valueOf') return this.boxPrimitive(primitiveBoxType, args[0]);
    if(method.owner==='Ljava/lang/String;'&&staticCall){
      if(method.parameters[0]==='Ljava/lang/Object;'&&!isNull(args[0])){
        if(this.isStringValue(args[0]))return args[0];const object=this.object(args[0]),method=this.objectOverride(object.type,'toString()Ljava/lang/String;')??this.externalObjectMethod(object.type,'toString',[],'Ljava/lang/String;');
        if(method){const value=this.dispatch(method,[args[0]],'virtual');if(!isNull(value))this.stringCharacters(value);return value;}
      }return this.javaString(args[0],method.parameters[0]);
    }
    if (method.owner === 'Ljava/lang/Integer;' && staticCall) {
      if (name === 'toString') return String(int(args[0]));
      if (name === 'valueOf') { const object = this.makeObject(method.owner); this.object(object).boxed = int(args[0]); return object; }
      if (name === 'parseInt') {
        if (isNull(args[0])) this.throwJava('Ljava/lang/NumberFormatException;', 'Cannot parse null string');
        const value = this.stringCharacters(args[0]), radix = args[1] ?? 10, invalid = () => this.throwJava('Ljava/lang/NumberFormatException;', `For input string: "${value}"${radix === 10 ? '' : ` under radix ${radix}`}`);
        if (radix < 2 || radix > 36) this.throwJava('Ljava/lang/NumberFormatException;', `radix ${radix} ${radix < 2 ? 'less than Character.MIN_RADIX' : 'greater than Character.MAX_RADIX'}`);
        if (!/^[+-]?[0-9a-z]+$/i.test(value)) invalid();
        for (const c of value.replace(/^[+-]/, '').toLowerCase()) if (parseInt(c, 36) >= radix) invalid();
        const n = parseInt(value, radix); if (n < -2147483648 || n > 2147483647) invalid(); return n | 0;
      }
    }
    if (method.owner === 'Ljava/lang/Boolean;' && staticCall) return this.readStatic({ owner: method.owner, name: args[0] ? 'TRUE' : 'FALSE', type: method.owner, key: `${method.owner}->${args[0] ? 'TRUE' : 'FALSE'}:${method.owner}` });
    if (method.owner === 'Lkotlin/jvm/internal/Intrinsics;') {
      if (isNull(args[0])) fail(`Kotlin null contract failed: ${args[1] ?? 'value'} (exceptions unsupported)`);
      return undefined;
    }
    if (method.owner === 'Ljava/lang/String;') {
      if(name==='<init>'){
        const object=this.object(args[0]);if(object.stringValue!==undefined)fail('String constructor cannot run twice');let text='';
        if(method.parameters[0]==='Ljava/lang/String;')text=this.stringCharacters(args[1]);
        else if(method.parameters[0]==='[C'){const source=this.array(args[1]);if(source.type!=='[C')this.throwJava('Ljava/lang/ClassCastException;','String constructor requires char[]');const from=method.parameters.length===3?int(args[2]):0,count=method.parameters.length===3?int(args[3]):source.elements.length;if(from<0||count<0||from>source.elements.length-count)this.throwJava('Ljava/lang/StringIndexOutOfBoundsException;','Invalid String char array range');text=utf16String(source.elements.slice(from,from+count));}
        else if(method.parameters[0]==='[B'&&method.parameters[method.parameters.length-1]==='I'&&(method.parameters.length===2||method.parameters.length===4)){
          // Deprecated String(byte[] ascii, int hibyte[, offset, count]): each char is (hibyte << 8) | (byte & 0xff).
          const source=this.array(args[1]);if(source.type!=='[B')this.throwJava('Ljava/lang/ClassCastException;','String constructor requires byte[]');
          const quad=method.parameters.length===4,hibyte=(int(args[quad?2:2])&255)<<8,from=quad?int(args[3]):0,count=quad?int(args[4]):source.elements.length;
          if(quad&&method.parameters[1]!=='I')fail('Unexpected String(byte[],...) signature');
          if(from<0||count<0||from>source.elements.length-count)this.throwJava('Ljava/lang/StringIndexOutOfBoundsException;','Invalid String byte array range');
          text=String.fromCharCode(...source.elements.slice(from,from+count).map(byte=>hibyte|(byte&255)));
        }
        else if(method.parameters[0]==='[B'){
          const source=this.array(args[1]);if(source.type!=='[B')this.throwJava('Ljava/lang/ClassCastException;','String constructor requires byte[]');
          const ranged=method.parameters[1]==='I',from=ranged?int(args[2]):0,count=ranged?int(args[3]):source.elements.length,selector=method.parameters.length>(ranged?3:1)?args[ranged?4:2]:null;
          if(from<0||count<0||from>source.elements.length-count)this.throwJava('Ljava/lang/StringIndexOutOfBoundsException;','Invalid String byte array range');
          text=decodeBytes(Uint8Array.from(source.elements.slice(from,from+count),byte=>byte&255),this.stringCodec(selector,true));
        }
        const units=(this.constructedStringUnits??0)+text.length;if(text.length>4000000||units>16*1024*1024)fail('Constructed String UTF-16 storage limit exceeded');this.constructedStringUnits=units;object.stringValue=text;return;
      }
      if(name==='copyValueOf'){const source=this.array(args[0]);if(source.type!=='[C')this.throwJava('Ljava/lang/ClassCastException;','copyValueOf requires char[]');return utf16String(source.elements.slice());}
      const value = this.stringCharacters(args[0]);
      if(name==='getBytes'){const bytes=encodeString(value,this.stringCodec(method.parameters.length?args[1]:null,false)),result=this.newArray('[B',bytes.length);this.array(result).elements=Array.from(bytes);return result;}
      if(['contains','equalsIgnoreCase','compareToIgnoreCase','codePointAt','intern','repeat','isBlank','contentEquals'].includes(name)||(['toLowerCase','toUpperCase'].includes(name)&&method.parameters.length===0)){
        const sequence=x=>{if(isNull(x))this.throwJava('Ljava/lang/NullPointerException;',null);return this.isStringValue(x)?this.stringCharacters(x):this.javaString(x);};
        // java.lang.String semantics (libcore android-13.0.0_r1): case folding for equalsIgnoreCase/compareToIgnoreCase is per UTF-16 unit (Character.toUpperCase then toLowerCase).
        const fold=unit=>{const upper=unit.toUpperCase();const u=upper.length===1?upper:unit;const lower=u.toLowerCase();return lower.length===1?lower:u;};
        if(name==='contains')return value.includes(sequence(args[1]))?1:0;
        if(name==='contentEquals')return value===sequence(args[1])?1:0;
        if(name==='equalsIgnoreCase'){if(isNull(args[1]))return 0;const other=this.stringCharacters(args[1]);if(other.length!==value.length)return 0;for(let i=0;i<value.length;i++)if(value[i]!==other[i]&&fold(value[i])!==fold(other[i]))return 0;return 1;}
        if(name==='compareToIgnoreCase'){const other=sequence(args[1]),n=Math.min(value.length,other.length);for(let i=0;i<n;i++){const a=value[i],b=other[i];if(a!==b){const x=fold(a),y=fold(b);if(x!==y)return x.charCodeAt(0)-y.charCodeAt(0);}}return value.length-other.length;}
        if(name==='codePointAt'){const i=int(args[1]);if(i<0||i>=value.length)this.throwJava('Ljava/lang/StringIndexOutOfBoundsException;',`length=${value.length}; index=${i}`);return value.codePointAt(i);}
        if(name==='intern'){this.internedStrings??=new Map();if(!this.internedStrings.has(value))this.internedStrings.set(value,value);return this.internedStrings.get(value);}
        if(name==='repeat'){const n=int(args[1]);if(n<0)this.throwJava('Ljava/lang/IllegalArgumentException;','count is negative: '+n);if(value.length*n>4000000)fail('String.repeat result exceeds the VM string limit');return n===1?args[0]:value.repeat(n);}
        if(name==='isBlank')return /^[\t\n\v\f\r\x1c-\x20\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]*$/.test(value)?1:0;
        if(name==='toLowerCase')return value.toLowerCase()===value?args[0]:value.toLowerCase();
        if(name==='toUpperCase')return value.toUpperCase()===value?args[0]:value.toUpperCase();
      }
      if(name==='toLowerCase'||name==='toUpperCase'){
        const data=this.object(args[1]).localeData;if(!data)fail('String case conversion requires a Locale with language state');
        // Android delegates full contextual casing to ICU. This host boundary
        // uses the browser's Unicode casing tables and the VM Locale, never the
        // operating system locale. It does not claim a pinned Android ICU version.
        const language=data.language||'und',locale=['tr','az','lt'].includes(language)?language:'und';
        const changed=name==='toLowerCase'?value.toLocaleLowerCase(locale):value.toLocaleUpperCase(locale);
        this.unicodeCaseBackend='ECMAScript locale casing; browser Unicode tables';
        return changed===value?args[0]:changed;
      }
      if(name==='getChars'){
        const begin=int(args[1]),end=int(args[2]);if(begin<0||end<begin||end>value.length)this.throwJava('Ljava/lang/StringIndexOutOfBoundsException;','Invalid String source range');const target=this.array(args[3]),offset=int(args[4]);if(target.type!=='[C')this.throwJava('Ljava/lang/ClassCastException;','String.getChars requires char[]');if(offset<0||offset>target.elements.length-(end-begin))this.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;','String.getChars target range');for(let i=begin;i<end;i++)target.elements[offset+i-begin]=value.charCodeAt(i);return;
      }
      if(name==='toCharArray'){const result=this.newArray('[C',value.length);this.array(result).elements=Array.from({length:value.length},(_,i)=>value.charCodeAt(i));return result;} if (typeof value !== 'string') fail('Expected String receiver');
      if(name==='regionMatches'){
        const conditional=method.parameters[0]==='Z',shift=conditional?1:0,ignoreCase=conditional&&!!args[1],offset=int(args[1+shift]),other=args[2+shift],from=int(args[3+shift]),length=int(args[4+shift]);
        // Preserve Java's short-circuit bounds checks, including negative length.
        if(from<0||offset<0||offset>value.length-length)return 0;
        if(isNull(other))this.throwJava('Ljava/lang/NullPointerException;','String region argument is null');if(typeof other!=='string')fail('String region argument must be a String');if(from>other.length-length)return 0;
        for(let i=0;i<length;i++){const a=value.charCodeAt(offset+i),b=other.charCodeAt(from+i);if(a===b)continue;if(!ignoreCase)return 0;const upperA=JAVA_SIMPLE_UPPER.get(a)??a,upperB=JAVA_SIMPLE_UPPER.get(b)??b;if(upperA===upperB)continue;if((JAVA_SIMPLE_LOWER.get(upperA)??upperA)!==(JAVA_SIMPLE_LOWER.get(upperB)??upperB))return 0;}return 1;
      }
      if (name === 'split') {
        const pattern = args[1], limit = args[2] ?? 0;
        if (typeof pattern !== 'string') this.throwJava('Ljava/lang/NullPointerException;', 'null split pattern');
        let separator = null;
        if (pattern.length === 1 && !'\\?*+[](){}^$.|'.includes(pattern)) separator = pattern;
        else if (pattern.length === 2 && pattern[0] === '\\' && !/[A-Za-z0-9]/.test(pattern[1])) separator = pattern[1];
        if (separator === null || /[\ud800-\udfff]/.test(separator)) {
          // Java regex semantics are not JS RegExp semantics. A compiled original Pattern
          // layer may provide the full path; never silently substitute a different engine.
          if (!this.classes.has('Ljava/util/regex/Pattern;')) throw new APKError(`Java regex split is not implemented for pattern ${JSON.stringify(pattern)}`, { kind: 'java-regex-unavailable', pattern });
          const compiled = this.dispatch({ owner: 'Ljava/util/regex/Pattern;', name: 'compile', signature: '(Ljava/lang/String;)Ljava/util/regex/Pattern;', parameters: ['Ljava/lang/String;'], result: 'Ljava/util/regex/Pattern;' }, [pattern], 'static');
          return this.dispatch({ owner: this.typeOf(compiled), name: 'split', signature: '(Ljava/lang/CharSequence;I)[Ljava/lang/String;', parameters: ['Ljava/lang/CharSequence;', 'I'], result: '[Ljava/lang/String;' }, [compiled, value, limit], 'virtual');
        }
        const pieces = []; let offset = 0, next;
        while ((limit <= 0 || pieces.length < limit - 1) && (next = value.indexOf(separator, offset)) >= 0) {
          if (pieces.length >= 1000000) fail('String.split result exceeds VM array limit');
          pieces.push(value.slice(offset, next)); offset = next + separator.length;
        }
        if (offset === 0) pieces.push(value);
        else { pieces.push(value.slice(offset)); if (limit === 0) while (pieces.length && pieces.at(-1) === '') pieces.pop(); }
        const array = this.newArray('[Ljava/lang/String;', pieces.length); this.object(array).elements = pieces; return array;
      }
      if (name === 'toString') return args[0];
      if (name === 'length') return value.length;
      if (name === 'isEmpty') return value.length ? 0 : 1;
      if(name==='equals')return this.isStringValue(args[1])&&value===this.stringCharacters(args[1])?1:0;
      if (name === 'hashCode') return stringHash(value);
      if(['startsWith','endsWith','concat'].includes(name)&&isNull(args[1]))this.throwJava('Ljava/lang/NullPointerException;','String argument is null');
      if (name === 'replace') {
        // Literal (non-regex) replacement, as java.lang.String.replace.
        if (method.parameters[0] === 'C') return value.split(String.fromCharCode(args[1])).join(String.fromCharCode(args[2]));
        if (isNull(args[1]) || isNull(args[2])) this.throwJava('Ljava/lang/NullPointerException;', 'replace argument is null');
        const text = x => this.isStringValue(x) ? this.stringCharacters(x) : this.javaString(x);
        const target = text(args[1]), replacement = text(args[2]);
        if (target === '') { let out = replacement; for (const ch of value) out += ch + replacement; return out; }
        return value.split(target).join(replacement);
      }
      if (name === 'startsWith') { const from = args[2] ?? 0; return from >= 0 && from <= value.length && value.startsWith(args[1], from) ? 1 : 0; }
      if (name === 'endsWith') return value.endsWith(args[1]) ? 1 : 0;
      if (name === 'indexOf' || name === 'lastIndexOf') {
        const point = method.parameters[0] === 'I' ? int(args[1]) : null;
        if (point !== null && (point < 0 || point > 0x10ffff)) return -1;
        const text = point === null ? args[1] : String.fromCodePoint(point);
        if (typeof text !== 'string') this.throwJava('Ljava/lang/NullPointerException;', 'null search string');
        if (name === 'indexOf') return value.indexOf(text, args[2] ?? 0);
        const from = args[2] ?? value.length;
        if (from < 0) return -1;
        return value.lastIndexOf(text, from);
      }
      if (name === 'compareTo') {
        const other = this.isStringValue(args[1])?this.stringCharacters(args[1]):args[1]; if (isNull(other)) this.throwJava('Ljava/lang/NullPointerException;', 'null comparison string');if(typeof other!=='string')this.throwJava('Ljava/lang/ClassCastException;','String comparison requires String');
        for (let i = 0; i < Math.min(value.length, other.length); i++) { const difference = value.charCodeAt(i) - other.charCodeAt(i); if (difference) return difference; }
        return value.length - other.length;
      }
      if(name==='trim'){const trimmed=value.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g,'');return trimmed===value?args[0]:trimmed;}
      if (name === 'concat') { if (value.length + args[1].length > 4000000) fail('String length limit exceeded'); return args[1].length===0?args[0]:value + args[1]; }
      const from = int(args[1]), to = args.length > 2 ? int(args[2]) : value.length;
      if(from<0||from>value.length||to<from||to>value.length||(name==='charAt'&&from===value.length))this.throwJava('Ljava/lang/StringIndexOutOfBoundsException;','String index out of bounds');
      if (name === 'charAt') return value.charCodeAt(from);
      if(name==='substring'||name==='subSequence')return from===0&&to===value.length?args[0]:value.slice(from,to);
    }
    if (method.owner === 'Ljava/lang/Object;') {
      if (name === 'getClass') return this.classObject(this.typeOf(args[0]));
      if (name === 'equals') return equal(args[0], args[1]) ? 1 : 0;
      if (name === 'hashCode') return typeof args[0] === 'string' ? stringHash(args[0]) : this.object(args[0]).id;
      if (name === 'toString') return this.javaString(args[0]);
      if (name === 'clone') {
        const original = this.object(args[0]);
        if (original.elements) { const value = this.newArray(original.type, original.elements.length); this.object(value).elements = original.elements.slice(); return value; }
        if (!this.isSubtype(original.type, 'Ljava/lang/Cloneable;')) this.throwJava('Ljava/lang/CloneNotSupportedException;', original.type);
        const value = this.makeObject(original.type), target = this.object(value);
        Object.assign(target, original, { id: value.ref, fields: new Map(original.fields), children: [...original.children] }); return value;
      }
    }
    const obj = this.object(args[0]);
    if (!this.isSubtype(obj.type, method.owner)) fail(`Receiver does not match ${methodKey(method)}`);
    if(method.owner===REENTRANT_LOCK){
      if(name==='<init>'){obj.lockState={fair:!!args[1],owner:null,holds:0};return;}
      const state=obj.lockState;if(!state)fail('ReentrantLock used before constructor');const thread=this.thread??this.scheduler.mainThread();
      if(name==='isFair')return state.fair?1:0;if(name==='isLocked')return state.holds?1:0;
      if(name==='isHeldByCurrentThread')return state.owner===thread?1:0;if(name==='getHoldCount')return state.owner===thread?state.holds:0;
      if(name==='unlock'){if(state.owner!==thread||!state.holds)this.throwJava('Ljava/lang/IllegalMonitorStateException;','Lock is not held by this VM thread');if(--state.holds===0)state.owner=null;return;}
      const timed=method.parameters.length===2,interruptible=name==='lockInterruptibly'||timed;
      if(interruptible&&thread.interrupted){thread.interrupted=false;this.throwJava('Ljava/lang/InterruptedException;',null);}
      if(timed&&!this.isSubtype(this.typeOf(args[2]),'Ljava/util/concurrent/TimeUnit;'))this.throwJava('Ljava/lang/IllegalArgumentException;','Lock timeout requires TimeUnit');
      const acquire=()=>{if(state.holds===2147483647)this.throwJava('Ljava/lang/Error;','Maximum lock count exceeded');state.owner=thread;state.holds++;return name==='tryLock'?1:undefined;};
      if(state.owner===null||state.owner===thread)return acquire();
      if(name==='tryLock'&&(!timed||wide(args[1])<=0n))return 0;
      // Contended: park until the owner releases (a timed tryLock gives up at its deadline).
      const deadline=timed?this.platform.clock.now()+Number(wide(args[1])*this.object(args[2]).nanoFactor/1000000n):Infinity;
      const wait=()=>new Blocked({reason:'ReentrantLock',ready:()=>state.owner===null,deadline,interruptible,finish:timedOut=>{
        if(interruptible&&thread.interrupted){thread.interrupted=false;this.throwJava('Ljava/lang/InterruptedException;',null);}
        if(state.owner===null||state.owner===thread)return acquire();
        return timedOut?0:wait();}});
      return wait();
    }
    if (method.owner === RW_LOCK) {
      if (name === '<init>') { obj.lockState = { fair: !!args[1], writeOwner: null, writes: 0, readers: new Map() }; return undefined; }
      const state = obj.lockState; if (!state) fail('Read-write lock used before constructor');
      const thread = this.thread ?? this.scheduler.mainThread();
      if (name === 'readLock' || name === 'writeLock') {
        const property = name === 'readLock' ? 'readerLock' : 'writerLock';
        if (!obj[property]) { obj[property] = this.makeObject(RW_LOCK.slice(0, -1) + (name === 'readLock' ? '$ReadLock;' : '$WriteLock;')); this.object(obj[property]).lockState = state; }
        return obj[property];
      }
      if (name === 'isFair') return state.fair ? 1 : 0;
      if (name === 'getReadHoldCount') return state.readers.get(thread) ?? 0;
      if (name === 'getReadLockCount') return [...state.readers.values()].reduce((sum, count) => sum + count, 0);
      if (name === 'getWriteHoldCount') return state.writeOwner === thread ? state.writes : 0;
      if (name === 'isWriteLocked') return state.writes ? 1 : 0;
      if (name === 'isWriteLockedByCurrentThread') return state.writeOwner === thread ? 1 : 0;
    }
    if (method.owner.startsWith(RW_LOCK.slice(0, -1) + '$')) {
      if (name === '<init>') { const parent = this.object(args[1]); if (!parent.lockState) fail('Read-write lock used before constructor'); obj.lockState = parent.lockState; return undefined; }
      const state = obj.lockState; if (!state) fail('Lock used before constructor');
      const thread = this.thread ?? this.scheduler.mainThread(), read = method.owner.endsWith('$ReadLock;');
      if (name === 'tryLock' && args.length > 1) { const unit = this.object(args[2]); if (!this.isSubtype(unit.type, 'Ljava/util/concurrent/TimeUnit;')) this.throwJava('Ljava/lang/IllegalArgumentException;', 'Lock timeout requires TimeUnit'); }
      const heldReads = state.readers.get(thread) ?? 0, totalReads = [...state.readers.values()].reduce((sum, count) => sum + count, 0);
      if (name === 'getHoldCount') return state.writeOwner === thread ? state.writes : 0;
      if (name === 'isHeldByCurrentThread') return state.writeOwner === thread ? 1 : 0;
      if (name === 'unlock') {
        if (read) { if (!heldReads) this.throwJava('Ljava/lang/IllegalMonitorStateException;', 'Read lock is not held by this VM thread'); if (heldReads === 1) state.readers.delete(thread); else state.readers.set(thread, heldReads - 1); }
        else { if (state.writeOwner !== thread || !state.writes) this.throwJava('Ljava/lang/IllegalMonitorStateException;', 'Write lock is not held by this VM thread'); if (--state.writes === 0) state.writeOwner = null; }
        return undefined;
      }
      const timed = name === 'tryLock' && args.length > 1, interruptible = name === 'lockInterruptibly' || timed;
      if (interruptible && thread.interrupted) { thread.interrupted = false; this.throwJava('Ljava/lang/InterruptedException;', null); }
      const isAvailable = () => { const reads = [...state.readers.values()].reduce((sum, count) => sum + count, 0); return read ? state.writeOwner === null || state.writeOwner === thread : state.writeOwner === thread || (state.writeOwner === null && reads === 0); };
      const grant = () => {
        const held = state.readers.get(thread) ?? 0, total = [...state.readers.values()].reduce((sum, count) => sum + count, 0);
        if (read) { if (total >= 65535) this.throwJava('Ljava/lang/Error;', 'Maximum read lock count exceeded'); state.readers.set(thread, held + 1); }
        else { if (state.writes >= 65535) this.throwJava('Ljava/lang/Error;', 'Maximum write lock count exceeded'); state.writeOwner = thread; state.writes++; }
        return name === 'tryLock' ? 1 : undefined;
      };
      if (!isAvailable()) {
        if (name === 'tryLock' && (!timed || wide(args[1]) <= 0n)) return 0;
        // Contended: park until the lock can be granted (a timed tryLock gives up at its deadline).
        const deadline = timed ? this.platform.clock.now() + Number(wide(args[1]) * this.object(args[2]).nanoFactor / 1000000n) : Infinity;
        const wait = () => new Blocked({ reason: read ? 'ReadLock' : 'WriteLock', ready: isAvailable, deadline, interruptible, finish: timedOut => {
          if (interruptible && thread.interrupted) { thread.interrupted = false; this.throwJava('Ljava/lang/InterruptedException;', null); }
          if (isAvailable()) return grant();
          return timedOut ? 0 : wait(); } });
        return wait();
      }
      return grant();
    }
    if (method.owner === 'Ljava/util/concurrent/TimeUnit;') {
      const targetIndex = ['toNanos', 'toMicros', 'toMillis', 'toSeconds', 'toMinutes', 'toHours', 'toDays'].indexOf(name);
      const sourceFactor = name === 'convert' ? this.object(args[2]).nanoFactor : obj.nanoFactor;
      const targetFactor = name === 'convert' ? obj.nanoFactor : TIME_FACTORS[targetIndex];
      if (typeof sourceFactor !== 'bigint' || typeof targetFactor !== 'bigint') fail('Invalid TimeUnit reference');
      const value = wide(args[1]) * sourceFactor / targetFactor;
      return value > 9223372036854775807n ? 9223372036854775807n : value < -9223372036854775808n ? -9223372036854775808n : value;
    }
    if (primitiveBoxType && name.endsWith('Value')) return obj.boxed;
    if (method.owner === 'Ljava/lang/reflect/AccessibleObject;') {
      if (name === 'isAccessible') return obj.accessible ? 1 : 0;
      obj.accessible = name === 'trySetAccessible' ? true : !!args[1]; return name === 'trySetAccessible' ? 1 : undefined;
    }
    if (method.owner === 'Ljava/lang/reflect/InvocationTargetException;' && name === 'getTargetException') return obj.cause ?? null;
    if (method.owner === 'Ljava/lang/reflect/Executable;') {
      if (!obj.member?.method) fail('Missing reflective executable metadata');
      const parameters = obj.member.method.parameters;
      if (name === 'getParameterCount') return parameters.length;
      const value = this.newArray('[Ljava/lang/Class;', parameters.length); this.object(value).elements = parameters.map(type => this.classObject(type)); return value;
    }
    if (['Ljava/lang/reflect/Method;', 'Ljava/lang/reflect/Constructor;', 'Ljava/lang/reflect/Field;', 'Ljava/lang/reflect/Member;'].includes(method.owner)) {
      const member = obj.member; if (!member) fail('Missing reflected member metadata');
      const owner = member.field?.owner ?? member.method.owner;
      if(['getAnnotations','getDeclaredAnnotations','getAnnotation','getDeclaredAnnotation','isAnnotationPresent'].includes(name)){
        const definition=member.field??member.method;
        // Platform members registered as bridges/hosts carry no run-time-visible annotation metadata in this VM (documented gap: @Deprecated and friends on JDK members).
        const annotations=definition.dex?definition.dex.memberAnnotations(member):[];
        if(name==='getAnnotations'||name==='getDeclaredAnnotations'){const value=this.newArray('[Ljava/lang/annotation/Annotation;',annotations.length);this.array(value).elements=annotations.map(a=>this.annotationObject(a));return value;}
        const type=this.object(args[1]).classType;if(!type)fail('Annotation lookup requires a Class');const annotation=annotations.find(a=>a.type===type);return name==='isAnnotationPresent'?(annotation?1:0):annotation?this.annotationObject(annotation):null;
      }
      if (name === 'equals') return this.javaEquals(args[0], args[1]) ? 1 : 0;
      if (name === 'hashCode') return this.javaHash(args[0]);
      if (name === 'getName') return member.kind === 'constructor' ? dottedName(owner) : member.field?.name ?? member.method.name;
      if (name === 'getDeclaringClass') return this.classObject(owner);
      if (name === 'getModifiers') return member.flags & 0xffff;
      if (name === 'getReturnType') return this.classObject(member.method.result);
      if (name === 'isSynthetic') return member.flags & 0x1000 ? 1 : 0;
      if (name === 'isBridge') return member.flags & 0x40 ? 1 : 0;
      if (name === 'invoke') return this.reflectionInvoke(member, obj.accessible, args[1], args[2]);
      if (name === 'newInstance') return this.reflectionInvoke(member, obj.accessible, null, args[1]);
      if (name === 'getType') return this.classObject(member.field.type);
      if (member.kind === 'field') {
        const field = member.field, staticField = !!(member.flags & 8), target = staticField ? null : this.object(args[1]);
        if (!staticField && !this.isSubtype(target.type, owner)) this.throwJava('Ljava/lang/IllegalArgumentException;', 'Reflection field receiver mismatch');
        this.reflectionAccess(member, obj.accessible, args[1]);
        if (name.startsWith('get')) {
          const value = staticField ? this.readStatic(field) : target.fields.has(field.key) ? target.fields.get(field.key) : defaultValue(field.type);
          if (name === 'get') return this.boxPrimitive(field.type, value);
          return this.unboxReflection(this.boxPrimitive(field.type, value), method.result);
        }
        if (name.startsWith('set')) {
          if (member.flags & 0x10 && (staticField || !obj.accessible)) this.throwJava('Ljava/lang/IllegalAccessException;', `Final field ${field.key}`);
          const sourceType = method.parameters[1], boxed = name === 'set' ? args[2] : this.boxPrimitive(sourceType, args[2]);
          const value = this.unboxReflection(boxed, field.type);
          if (staticField) this.writeStatic(field, value); else this.storeField(target.fields, field.key, value);
          return undefined;
        }
      }
    }
    if (['Ljava/util/AbstractMap;', 'Ljava/util/AbstractCollection;', 'Ljava/util/AbstractList;', 'Ljava/util/AbstractSet;'].includes(method.owner) && name === '<init>') {
      if (method.owner === 'Ljava/util/AbstractList;') this.storeField(obj.fields, 'Ljava/util/AbstractList;->modCount:I', 0);
      return undefined;
    }
    if (method.owner === 'Ljava/util/AbstractList;' && name === 'iterator') {
      const value = this.makeObject('Ljava/util/Iterator;'), iterator = this.object(value);
      iterator.virtualList = args[0]; iterator.index = 0; iterator.last = -1; iterator.expectedListMod = obj.fields.get('Ljava/util/AbstractList;->modCount:I') ?? 0; return value;
    }
    if (method.owner === 'Ljava/util/AbstractCollection;' && name === 'isEmpty') {
      return this.dispatch({ owner: obj.type, name: 'size', signature: '()I', parameters: [], result: 'I' }, [args[0]], 'virtual') === 0 ? 1 : 0;
    }
    if (method.owner === 'Ljava/util/ArrayDeque;') {
      if (name === '<init>' && method.parameters[0] === 'Ljava/util/Collection;') {
        if (isNull(args[1])) this.throwJava('Ljava/lang/NullPointerException;', 'Attempt to invoke interface method on a null Collection');
        const incoming = this.collectionValues(this.object(args[1])).slice(); if (incoming.some(isNull)) this.throwJava('Ljava/lang/NullPointerException;', 'null deque element');
        if (incoming.length > 1000000) fail('Deque size limit exceeded'); this.reserveCollection(incoming.length); obj.list = incoming; obj.modCount = 0; return undefined; // AOSP ArrayDeque(Collection) = addAll in iteration order
      }
      if (name === '<init>') { if (args.length > 1 && int(args[1]) < 0) this.throwJava('Ljava/lang/IllegalArgumentException;', 'negative deque capacity'); obj.list = []; obj.modCount = 0; return undefined; }
      if (name === 'toArray') { const value = this.newArray('[Ljava/lang/Object;', obj.list.length); this.object(value).elements = obj.list.slice(); return value; }
      if (name === 'size') return obj.list.length;
      if (name === 'isEmpty') return obj.list.length ? 0 : 1;
      if (name === 'clear') { this.reserveCollection(-obj.list.length); obj.list = []; this.bumpModCount(obj); return undefined; }
      if (name === 'iterator') { const value = this.makeObject('Ljava/util/Iterator;'), iterator = this.object(value); iterator.source = args[0]; iterator.liveList = true; iterator.expectedModCount = obj.modCount; iterator.index = 0; iterator.last = -1; iterator.values = obj.list.slice(); return value; }
      if (name.startsWith('add') || name.startsWith('offer') || name === 'push') {
        if (isNull(args[1])) this.throwJava('Ljava/lang/NullPointerException;', 'null deque element');
        if (obj.list.length >= 1000000) fail('Deque size limit exceeded');
        this.reserveCollection(1); if (name.endsWith('First') || name === 'push') obj.list.unshift(args[1]); else obj.list.push(args[1]); this.bumpModCount(obj);
        return name.startsWith('offer') || name === 'add' ? 1 : undefined;
      }
      if (!obj.list.length) { if (name.startsWith('poll') || name.startsWith('peek')) return null; this.throwJava('Ljava/util/NoSuchElementException;', 'empty deque'); }
      const last = name.endsWith('Last'), value = obj.list[last ? obj.list.length - 1 : 0];
      if (name.startsWith('peek') || name.startsWith('get')) return value;
      if (last) obj.list.pop(); else obj.list.shift(); this.reserveCollection(-1); this.bumpModCount(obj); return value;
    }
    if (method.owner === 'Ljava/util/Collections$SynchronizedMap;') {
      this.monitorEnter(args[0]);
      try { return this.dispatch({ ...method, owner: this.typeOf(obj.delegate) }, [obj.delegate, ...words.slice(1)], 'virtual'); }
      finally { this.monitorExit(args[0]); }
    }
    if (method.owner === 'Landroid/os/Handler;') {
      if (name === '<init>') {
        if (method.parameters[0] === 'Landroid/os/Looper;') { this.object(args[1]); obj.looper = args[1]; obj.callback = args[2] ?? null; }
        else { obj.looper = this.mainLooper ??= this.makeObject('Landroid/os/Looper;'); obj.callback = args[1] ?? null; }
        return undefined;
      }
      if (name === 'getLooper') return obj.looper;
      throw new APKError('Handler message queue scheduling is not implemented; no Runnable was executed or discarded.', { kind: 'unsupported-messagequeue', method: key });
    }
    if (method.owner === 'Ljava/util/concurrent/ThreadPoolExecutor;') {
      if (name === 'shutdown') { obj.shutdown = true; return undefined; }
      if (name === 'isShutdown') return obj.shutdown ? 1 : 0;
      throw new APKError('Concurrent executor scheduling is not implemented in this single-threaded VM; no Runnable was executed or discarded.', { kind: 'unsupported-concurrency', method: key, poolSize: obj.poolSize });
    }
    if (method.owner.endsWith('FieldUpdater;')) {
      const field = obj.updaterField, target = this.object(args[1]);
      if (!field || !this.isSubtype(target.type, field.owner)) this.throwJava('Ljava/lang/ClassCastException;', 'Atomic field updater receiver mismatch');
      const current = target.fields.has(field.key) ? target.fields.get(field.key) : defaultValue(field.type);
      if(/increment|decrement|AndAdd|addAndGet/i.test(name)){
        const delta=/Increment/.test(name)||name==='incrementAndGet'?1:/Decrement/.test(name)||name==='decrementAndGet'?-1:args[2];
        const next=field.type==='J'?wide(wide(current)+BigInt(delta)):(int(current)+int(delta))|0;this.storeField(target.fields,field.key,next);return name.startsWith('getAnd')?current:next;
      }
      if (name === 'get') return current;
      if (name === 'set' || name === 'lazySet') { this.storeField(target.fields, field.key, args[2]); return undefined; }
      if (name === 'getAndSet') { this.storeField(target.fields, field.key, args[2]); return current; }
      if (name === 'compareAndSet' || name === 'weakCompareAndSet') { const same = equal(current, args[2]); if (same) this.storeField(target.fields, field.key, args[3]); return same ? 1 : 0; }
    }
    if (method.owner === 'Ljava/lang/ThreadLocal;') {
      // Values are per Thread (cooperative threads of src/concurrency-host.js each have their own slot); withInitial() = SuppliedThreadLocal.
      const thread = this.platform?.concurrency?.currentThread(this) ?? null; // the cooperative scheduler's running thread (no VM call, so no trace noise)
      const key = thread?.ref ?? thread, values = obj.threadLocalValues ??= new Map();
      if (name === '<init>') return undefined;
      if (name === 'remove') { values.delete(key); return undefined; }
      if (name === 'initialValue') return obj.threadLocalSupplier ? this.dispatch({ owner: 'Ljava/util/function/Supplier;', name: 'get', signature: '()Ljava/lang/Object;', parameters: [], result: 'Ljava/lang/Object;' }, [obj.threadLocalSupplier], 'virtual') : null;
      if (name === 'set') { values.set(key, args[1]); return undefined; }
      if (!values.has(key)) {
        const initial = { owner: obj.type, name: 'initialValue', signature: '()Ljava/lang/Object;', parameters: [], result: 'Ljava/lang/Object;' };
        values.set(key, this.dispatch(initial, [args[0]], 'virtual'));
      }
      return values.get(key);
    }
    if (method.owner === 'Ljava/util/Random;' || method.owner === 'Ljava/util/concurrent/ThreadLocalRandom;') {
      const mask = (1n << 48n) - 1n;
      if (name === '<init>') { obj.seed = (args.length > 1 ? wide(args[1]) : BigInt(Date.now())) ^ 0x5deece66dn; obj.seed &= mask; return undefined; }
      const next = bits => { obj.seed = (obj.seed * 0x5deece66dn + 11n) & mask; return Number(obj.seed >> BigInt(48 - bits)); };
      if (method.owner === 'Ljava/util/Random;') {
        // java.util.Random (libcore android-13.0.0_r1), bit-exact LCG: Math.log/sqrt stand in for StrictMath in nextGaussian().
        if (name === 'setSeed') { obj.seed = (wide(args[1]) ^ 0x5deece66dn) & mask; obj.haveNextNextGaussian = false; return undefined; }
        if (name === 'nextDouble') return doubleBits(((next(26) * 134217728) + next(27)) * (1 / 9007199254740992));
        if (name === 'nextFloat') return floatBits(next(24) / 16777216);
        if (name === 'nextBytes') {
          const array = this.array(args[1]); let i = 0; while (i < array.elements.length) for (let rnd = next(32) | 0, n = Math.min(array.elements.length - i, 4); n-- > 0; rnd >>= 8) array.elements[i++] = (rnd << 24) >> 24;
          return undefined;
        }
        if (name === 'nextGaussian') {
          if (obj.haveNextNextGaussian) { obj.haveNextNextGaussian = false; return doubleBits(obj.nextNextGaussian); }
          let v1, v2, s2; do { v1 = 2 * (((next(26) * 134217728) + next(27)) / 9007199254740992) - 1; v2 = 2 * (((next(26) * 134217728) + next(27)) / 9007199254740992) - 1; s2 = v1 * v1 + v2 * v2; } while (s2 >= 1 || s2 === 0);
          const multiplier = Math.sqrt(-2 * Math.log(s2) / s2); obj.nextNextGaussian = v2 * multiplier; obj.haveNextNextGaussian = true; return doubleBits(v1 * multiplier);
        }
      }
      if (name === 'nextBoolean') return next(1);
      if (name === 'nextLong') return BigInt.asIntN(64, (BigInt(next(32) | 0) << 32n) + BigInt(next(32) | 0));
      if (args.length === 1) return next(32) | 0;
      if (args.length === 3) {
        const from = int(args[1]), to = int(args[2]); if (from >= to) this.throwJava('Ljava/lang/IllegalArgumentException;', 'Random origin must be below bound');
        const range = to - from;
        if (range <= 2147483647) { let bits, value; do { bits = next(31); value = bits % range; } while (((bits - value + range - 1) | 0) < 0); return from + value; }
        let value; do { value = next(32) | 0; } while (value < from || value >= to); return value;
      }
      const bound = int(args[1]); if (bound <= 0) this.throwJava('Ljava/lang/IllegalArgumentException;', 'Random bound must be positive');
      if ((bound & -bound) === bound) return Number(BigInt(bound) * BigInt(next(31)) >> 31n);
      let bits, value; do { bits = next(31); value = bits % bound; } while (((bits - value + bound - 1) | 0) < 0);
      return value;
    }
    if (method.owner === 'Ljava/lang/Thread;') {
      if (name === 'getId') return obj.threadId ??= this.nextThreadId++;
      return name === 'getName' ? 'APK main' : 1;
    }
    if (method.owner === 'Landroid/os/Looper;' && name === 'getThread') { const looper = this.object(args[0]); return looper.thread?.javaObject ?? (this.mainThread ??= this.makeObject('Ljava/lang/Thread;')); }
    if (method.owner.startsWith('Ljava/lang/ref/')) {
      if (name === '<init>') { obj.referent = args[1]; return undefined; }
      if (name === 'get') return obj.referent ?? null;
      if (name === 'clear') { obj.referent = null; return undefined; }
      if (name === 'refersTo') return equal(obj.referent??null,args[1])?1:0;
    }
    if (this.isSubtype(method.owner, 'Ljava/lang/Throwable;')) {
      if (name === '<init>' && method.owner === 'Ljava/lang/AssertionError;' && method.parameters[0] === 'Ljava/lang/Object;') {   // AssertionError(Object detail): message = String.valueOf(detail); a Throwable detail is also the cause
        obj.stack = this.captureStack(); obj.message = this.javaString(args[1]); obj.causeInitialized = true; obj.cause = !isNull(args[1]) && this.isSubtype(this.typeOf(args[1]), 'Ljava/lang/Throwable;') ? args[1] : null; return undefined;
      }
      if (name === '<init>') { obj.stack = this.captureStack(); obj.message = method.owner==='Ljava/lang/ArrayIndexOutOfBoundsException;'&&method.parameters[0]==='I'?'Array index out of range: '+int(args[1]):method.parameters[0]==='Ljava/lang/Throwable;'&&!isNull(args[1])?this.javaString(args[1]):typeof args[1] === 'string' ? args[1] : null;obj.causeInitialized=method.parameters.includes('Ljava/lang/Throwable;');obj.cause=method.parameters[0]==='Ljava/lang/Throwable;'?args[1]:obj.causeInitialized?args[2]:null;return undefined; }
      if(name==='initCause'){if(obj.causeInitialized)this.throwJava('Ljava/lang/IllegalStateException;','Cause already initialized');if(equal(args[0],args[1]))this.throwJava('Ljava/lang/IllegalArgumentException;','Self-causation not permitted');obj.cause=args[1];obj.causeInitialized=true;return args[0];}
      if (name === 'getMessage') return obj.message ?? null;
      if (name === 'getCause') return obj.cause ?? null;
      if (name === 'toString') return dottedName(obj.type) + (obj.message!==null&&obj.message!==undefined ? ': ' + obj.message : '');
    }
    if (SET_TYPES.some(owner => method.owner === `L${owner};`)) {
      if (name === '<init>') {
        obj.set = []; obj.setHashes = []; obj.modCount = 0;
        if (method.parameters[0] === 'Ljava/util/Collection;') { // AOSP HashSet(Collection) = addAll, de-duplicating with hashCode/equals
          if (isNull(args[1])) this.throwJava('Ljava/lang/NullPointerException;', 'Attempt to invoke interface method on a null Collection');
          for (const value of this.collectionValues(this.object(args[1])).slice()) { const hash = this.javaHash(value); if (obj.set.some((existing, i) => obj.setHashes[i] === hash && this.javaEquals(value, existing))) continue; if (obj.set.length >= 1000000) fail('Set size limit exceeded'); this.reserveCollection(1); obj.set.push(value); obj.setHashes.push(hash); }
        }
        return undefined;
      }
      if (name === 'size') return obj.set.length;
      if (name === 'isEmpty') return obj.set.length ? 0 : 1;
      if (name === 'iterator') {
        const value = this.makeObject('Ljava/util/Iterator;'), iterator = this.object(value);
        iterator.source = args[0]; iterator.expectedModCount = obj.modCount;
        iterator.snapshotIterator = method.owner.includes('CopyOnWrite'); iterator.index = 0; iterator.last = -1; iterator.values = obj.set.slice(); return value;
      }
      if (name === 'clear') { if(obj.readOnly&&obj.set.length)this.throwJava('Ljava/lang/UnsupportedOperationException;','Immutable Set');this.reserveCollection(-obj.set.length); obj.set = []; obj.setHashes = []; this.bumpModCount(obj); return undefined; }
      const hash = this.javaHash(args[1]), index = obj.set.findIndex((value, i) => obj.setHashes[i] === hash && this.javaEquals(args[1], value));
      if (name === 'contains') return index < 0 ? 0 : 1;
      if(obj.readOnly&&(name==='add'||name==='remove'&&index>=0))this.throwJava('Ljava/lang/UnsupportedOperationException;','Immutable Set');
      if (name === 'add') { if (index >= 0) return 0; if (obj.set.length >= 1000000) fail('Set size limit exceeded'); this.reserveCollection(1); obj.set = [...obj.set, args[1]]; obj.setHashes = [...obj.setHashes, hash]; this.bumpModCount(obj); return 1; }
      if (name === 'remove') { if (index < 0) return 0; this.reserveCollection(-1); obj.set = obj.set.filter((_, i) => i !== index); obj.setHashes = obj.setHashes.filter((_, i) => i !== index); this.bumpModCount(obj); return 1; }
    }
    if (method.owner.startsWith('Ljava/util/concurrent/atomic/')) {
      const long = method.owner.endsWith('AtomicLong;'), initial = long ? 0n : /Atomic(Integer|Boolean);$/.test(method.owner) ? 0 : null;
      if (name === '<init>') { obj.atomicValue = args.length > 1 ? args[1] : initial; return undefined; }
      const current = obj.atomicValue ?? initial;
      if (name === 'get') return current;
      if (name === 'set' || name === 'lazySet') { obj.atomicValue = args[1]; return undefined; }
      if (name === 'getAndSet') { obj.atomicValue = args[1]; return current; }
      if (name === 'compareAndSet' || name === 'weakCompareAndSet') { const same = equal(current, args[1]); if (same) obj.atomicValue = args[2]; return same ? 1 : 0; }
      if (name === 'intValue') return long ? Number(BigInt.asIntN(32, current)) : current;
      if (name === 'longValue') return long ? current : BigInt(current);
      const delta = name === 'getAndAdd' || name === 'addAndGet' ? args[1] : name.includes('Decrement') || name.startsWith('decrement') ? (long ? -1n : -1) : (long ? 1n : 1);
      const next = long ? BigInt.asIntN(64, current + delta) : (current + delta) | 0;
      obj.atomicValue = next; return name.startsWith('getAnd') ? current : next;
    }
    if (MAP_TYPES.some(type => method.owner === `Ljava/util/${type};`)) {
      if (name === '<init>') {
        if (method.parameters[0] === 'I' && int(args[1]) < 0) this.throwJava('Ljava/lang/IllegalArgumentException;', 'negative map capacity');
        if (method.parameters[1] === 'F') { const load = floatNumber(args[2]); if (!(load > 0)) this.throwJava('Ljava/lang/IllegalArgumentException;', 'invalid map load factor'); obj.loadFactor = load; }
        obj.map = new Map(); obj.mapBuckets = new Map(); obj.nextEntry = 1; obj.modCount = 0; obj.tailSerial = null;
        obj.accessOrder = method.parameters.length === 3 && !!args[3];
        obj.concurrentMap = method.owner === 'Ljava/util/concurrent/ConcurrentHashMap;';
        if (obj.concurrentMap) { obj.accessOrder = false; if (method.parameters.length === 3 && int(args[3]) <= 0) this.throwJava('Ljava/lang/IllegalArgumentException;', 'invalid map concurrency level'); }
        if (method.parameters[0] === 'Ljava/util/Map;') this.dispatch({ owner: obj.type, name: 'putAll', signature: '(Ljava/util/Map;)V', parameters: ['Ljava/util/Map;'], result: 'V' }, [args[0], args[1]], 'virtual');
        return undefined;
      }
      if (!obj.map) fail('Map used before constructor');
      if (name === 'size') return obj.map.size;
      if (name === 'mappingCount') return BigInt(obj.map.size);
      if (name === 'isEmpty') return obj.map.size ? 0 : 1;
      if (name === 'eldest') {
        const entry = obj.map.values().next().value; if (!entry) return null;
        const value = this.makeObject(HOST_MAP_ENTRY); this.object(value).entry = entry; return value;
      }
      if (name === 'putAll') {
        const source = this.object(args[1]);
        if (source.map) {
          for (const { key: mapKey, value } of [...source.map.values()]) this.dispatch({ owner: obj.type, name: 'put', signature: '(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;', parameters: ['Ljava/lang/Object;', 'Ljava/lang/Object;'], result: 'Ljava/lang/Object;' }, [args[0], mapKey, value], 'virtual');
        } else {
          const invoke = (receiver, name, signature, parameters = [], result = 'V', parametersValues = []) => this.dispatch({ owner: this.typeOf(receiver), name, signature, parameters, result }, [receiver, ...parametersValues], 'virtual');
          const entries = invoke(args[1], 'entrySet', '()Ljava/util/Set;', [], 'Ljava/util/Set;');
          const iterator = invoke(entries, 'iterator', '()Ljava/util/Iterator;', [], 'Ljava/util/Iterator;');
          let visited = 0;
          while (invoke(iterator, 'hasNext', '()Z', [], 'Z')) {
            if (++visited > 1000000) fail('Map.putAll iteration limit exceeded');
            const entry = invoke(iterator, 'next', '()Ljava/lang/Object;', [], 'Ljava/lang/Object;');
            const key = invoke(entry, 'getKey', '()Ljava/lang/Object;', [], 'Ljava/lang/Object;'), value = invoke(entry, 'getValue', '()Ljava/lang/Object;', [], 'Ljava/lang/Object;');
            invoke(args[0], 'put', '(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;', ['Ljava/lang/Object;', 'Ljava/lang/Object;'], 'Ljava/lang/Object;', [key, value]);
          }
        }
        return undefined;
      }
      if (['entrySet', 'keySet', 'values'].includes(name)) {
        const value = this.makeObject(name === 'values' ? 'Ljava/util/Collection;' : 'Ljava/util/Set;');
        const view = this.object(value); view.mapSource = args[0]; view.viewKind = name === 'keySet' ? 'keys' : name === 'values' ? 'values' : 'entries'; return value;
      }
      if (name === 'clear') { if (obj.readOnly) fail('Read-only Map'); this.reserveCollection(-obj.map.size); obj.map.clear(); obj.mapBuckets?.clear(); this.bumpModCount(obj); return undefined; }
      if (obj.concurrentMap) {
        if (isNull(args[1])) this.throwJava('Ljava/lang/NullPointerException;', 'ConcurrentHashMap does not permit null keys or queried values');
        if (['put', 'putIfAbsent', 'replace'].includes(name) && (isNull(args[2]) || (args.length === 4 && isNull(args[3])))) this.throwJava('Ljava/lang/NullPointerException;', 'ConcurrentHashMap does not permit null values');
        if (name === 'containsValue') { for (const entry of obj.map.values()) if (this.javaEquals(args[1], entry.value)) return 1; return 0; }
      }
      const { hash, bucket, entry: previous } = this.mapEntry(obj, args[1]);
      if (name === 'get') { this.mapAccess(obj, previous); return previous?.value ?? null; }
      if (name === 'containsKey') return previous ? 1 : 0;
      if (obj.readOnly) fail('Read-only Map');
      if (name === 'putIfAbsent') { if (previous) return previous.value; return this.dispatch({ owner: obj.type, name: 'put', signature: '(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;', parameters: ['Ljava/lang/Object;', 'Ljava/lang/Object;'], result: 'Ljava/lang/Object;' }, [args[0], args[1], args[2]], 'virtual'); }
      if (name === 'replace') {
        if (args.length === 3) { if (!previous) return null; const old = previous.value; previous.value = args[2]; return old; }
        if (!previous || !this.javaEquals(args[2], previous.value)) return 0; previous.value = args[3]; return 1;
      }
      if (name === 'remove' && args.length === 3) { if (!previous || isNull(args[2]) || !this.javaEquals(args[2], previous.value)) return 0; this.mapRemove(obj, previous); return 1; }
      if (name === 'remove') { this.mapRemove(obj, previous); return previous?.value ?? null; }
      if (name === 'put') {
        const oldValue = previous?.value ?? null;
        if (!previous && obj.map.size >= 1000000) fail('Map entry limit exceeded');
        if (previous) { previous.value = args[2]; this.mapAccess(obj, previous); } else {
          this.reserveCollection(1); const serial = obj.nextEntry ?? 1; obj.nextEntry = serial + 1;
          obj.map.set(serial, { serial, hash, key: args[1], value: args[2] }); obj.mapBuckets.set(hash, [...bucket, serial]); obj.tailSerial = serial; this.bumpModCount(obj);
        }
        return oldValue;
      }
    }
    if (method.owner === 'Ljava/util/Iterator;') {
      if (obj.virtualList) {
        const list = this.object(obj.virtualList);
        if (name !== 'hasNext' && (list.fields.get('Ljava/util/AbstractList;->modCount:I') ?? 0) !== obj.expectedListMod) this.throwJava('Ljava/util/ConcurrentModificationException;', 'Java list changed during iteration');
        const size = int(this.dispatch({ owner: list.type, name: 'size', signature: '()I', parameters: [], result: 'I' }, [obj.virtualList], 'virtual'));
        if (name === 'hasNext') return obj.index < size ? 1 : 0;
        if (name === 'next') {
          if (obj.index >= size) this.throwJava('Ljava/util/NoSuchElementException;', 'end of list iterator');
          obj.last = obj.index; return this.dispatch({ owner: list.type, name: 'get', signature: '(I)Ljava/lang/Object;', parameters: ['I'], result: 'Ljava/lang/Object;' }, [obj.virtualList, obj.index++], 'virtual');
        }
        if (obj.last < 0) this.throwJava('Ljava/lang/IllegalStateException;', 'Iterator.remove requires next');
        this.dispatch({ owner: list.type, name: 'remove', signature: '(I)Ljava/lang/Object;', parameters: ['I'], result: 'Ljava/lang/Object;' }, [obj.virtualList, obj.last], 'virtual');
        obj.index = obj.last; obj.last = -1; obj.expectedListMod = list.fields.get('Ljava/util/AbstractList;->modCount:I') ?? 0; return undefined;
      }
      const source = this.object(obj.source);
      if (name !== 'hasNext' && !obj.snapshotIterator && !obj.weakIterator && (source.modCount ?? 0) !== obj.expectedModCount) this.throwJava('Ljava/util/ConcurrentModificationException;', 'Java collection changed during iteration');
      const values = obj.liveList ? source.list : obj.values;
      if (name === 'hasNext') return obj.index < values.length ? 1 : 0;
      if (name === 'next') {
        if (obj.index >= values.length) this.throwJava('Ljava/util/NoSuchElementException;', 'end of iterator'); obj.last = obj.index++;
        if (source.map && obj.mapViewKind !== 'entries') { const entry = source.map.get(obj.mapSerials[obj.last]); return entry ? obj.mapViewKind === 'keys' ? entry.key : entry.value : obj.values[obj.last]; }
        return values[obj.last];
      }
      if (name === 'remove') {
        if (obj.snapshotIterator || source.readOnly || source.fixedSize) this.throwJava('Ljava/lang/UnsupportedOperationException;', 'Iterator removal is unsupported by this collection');
        if (obj.last < 0) this.throwJava('Ljava/lang/IllegalStateException;', 'Iterator.remove requires next');
        if (source.map) this.mapRemove(source, obj.weakIterator ? this.mapEntry(source, obj.mapKeys[obj.last]).entry : source.map.get(obj.mapSerials[obj.last]));
        else if (source.set) { const at = source.set.findIndex(value => equal(value, obj.values[obj.last])); if (at < 0) this.throwJava('Ljava/util/ConcurrentModificationException;', 'Set entry missing'); source.set.splice(at, 1); source.setHashes.splice(at, 1); this.reserveCollection(-1); this.bumpModCount(source); }
        else if (obj.liveList) { source.list.splice(obj.last, 1); this.reserveCollection(-1); this.bumpModCount(source); obj.index = obj.last; }
        else fail('Iterator source is unsupported for removal');
        obj.last = -1; obj.expectedModCount = source.modCount ?? 0; return undefined;
      }
    }
    if (method.owner === 'Ljava/util/Map$Entry;'||method.owner===HOST_MAP_ENTRY) {
      if(name==='hashCode')return this.javaHash(obj.entry.key)^this.javaHash(obj.entry.value);
      if(name==='toString')return this.javaString(obj.entry.key)+'='+this.javaString(obj.entry.value);
      if(name==='equals'){
        if(isNull(args[1])||typeof args[1]==='string'||!this.isSubtype(this.typeOf(args[1]),'Ljava/util/Map$Entry;'))return 0;
        const read=name=>this.dispatch({owner:this.typeOf(args[1]),name,parameters:[],result:'Ljava/lang/Object;',signature:'()Ljava/lang/Object;'},[args[1]],'virtual');
        return this.javaEquals(obj.entry.key,read('getKey'))&&this.javaEquals(obj.entry.value,read('getValue'))?1:0;
      }
      if (name === 'getKey') return obj.entry.key;
      if (name === 'getValue') return obj.entry.value;
      const previous = obj.entry.value; obj.entry.value = args[1]; return previous;
    }
    if (method.owner === 'Ljava/util/Stack;') {
      if (name === '<init>') {obj.list=[];obj.modCount=0;return undefined;}
      const values=this.collectionValues(obj);
      if(name==='empty')return values.length?0:1;
      if(name==='push'){if(values.length>=1000000)fail('Stack size limit exceeded');this.reserveCollection(1);values.push(args[1]);this.bumpModCount(obj);return args[1];}
      if(name==='search'){for(let i=values.length-1;i>=0;i--)if(this.javaEquals(args[1],values[i]))return values.length-i;return -1;}
      if(!values.length)this.throwJava('Ljava/util/EmptyStackException;', 'Empty stack');
      if(name==='peek')return values.at(-1);this.reserveCollection(-1);this.bumpModCount(obj);return values.pop();
    }
    if (['Ljava/util/ArrayList;', 'Ljava/util/Vector;', 'Ljava/util/concurrent/CopyOnWriteArrayList;', 'Ljava/util/Collection;', 'Ljava/util/Set;', 'Ljava/util/Arrays$ArrayList;'].includes(method.owner)) {
      if (name === '<init>') {
        obj.list = method.parameters[0] === 'Ljava/util/Collection;' ? this.collectionValues(this.object(args[1])).slice() : [];
        if (method.parameters[0] === 'I' && int(args[1]) < 0) this.throwJava('Ljava/lang/IllegalArgumentException;', 'Illegal Capacity');
        this.reserveCollection(obj.list.length); obj.modCount = 0; return undefined;
      }
      if ((name === 'size' || name === 'isEmpty') && obj.mapSource) { const count = this.object(obj.mapSource).map.size; return name === 'size' ? count : count ? 0 : 1; }
      const values = this.collectionValues(obj);
      if (name === 'size') return values.length;
      if (name === 'isEmpty') return values.length ? 0 : 1;
      if (name === 'iterator') {
        const value = this.makeObject('Ljava/util/Iterator;'), iterator = this.object(value);
        iterator.source = obj.mapSource ?? args[0]; iterator.expectedModCount = this.object(iterator.source).modCount ?? 0;
        iterator.snapshotIterator = method.owner.includes('CopyOnWrite');
        iterator.liveList = !obj.mapSource && !iterator.snapshotIterator;
        if (obj.mapSource) { const source = this.object(obj.mapSource); iterator.mapSerials = [...source.map.keys()]; iterator.mapKeys = [...source.map.values()].map(entry => entry.key); iterator.mapViewKind = obj.viewKind; iterator.weakIterator = !!source.concurrentMap; }
        iterator.index = 0; iterator.last = -1; iterator.values = values.slice(); return value;
      }
      if (name === 'toArray') { const value = this.newArray('[Ljava/lang/Object;', values.length); this.object(value).elements = values.slice(); return value; }
      if (name === 'indexOf' || name === 'contains') { const index = values.findIndex(v => this.javaEquals(args[1], v)); return name === 'contains' ? (index < 0 ? 0 : 1) : index; }
      if (name === 'get' || name === 'set') { const index = int(args[1]); if (index < 0 || index >= values.length)this.throwJava('Ljava/lang/IndexOutOfBoundsException;','List index out of bounds'); const previous = values[index]; if (name === 'set') { if (obj.readOnly)this.throwJava('Ljava/lang/UnsupportedOperationException;','Read-only List');if(obj.arrayRef)this.checkArrayValue(this.array(obj.arrayRef),args[2]);values[index] = args[2]; } return previous; }
      if (obj.readOnly || obj.fixedSize) fail('Read-only/fixed-size List');
      if (name === 'clear') { this.reserveCollection(-values.length); values.length = 0; this.bumpModCount(obj); return undefined; }
      if (name === 'addAll') {
        const indexed = method.parameters[0] === 'I', index = indexed ? int(args[1]) : values.length;
        if (index < 0 || index > values.length) this.throwJava('Ljava/lang/IndexOutOfBoundsException;', String(index));
        const incoming = this.collectionValues(this.object(args[indexed ? 2 : 1])).slice();
        if (incoming.length + values.length > 1000000) fail('List size limit exceeded');
        this.reserveCollection(incoming.length);
        // Avoid spreading potentially large arrays into a host call stack.
        const suffix = values.splice(index); for (const value of incoming) values.push(value); for (const value of suffix) values.push(value);
        if (incoming.length) this.bumpModCount(obj); return incoming.length ? 1 : 0;
      }
      if (name === 'add') {
        if (values.length >= 1000000) fail('List size limit exceeded');
        if (args.length === 3) { const index = int(args[1]); if (index < 0 || index > values.length) fail('List insertion index out of bounds'); this.reserveCollection(1); values.splice(index, 0, args[2]); this.bumpModCount(obj); return undefined; }
        this.reserveCollection(1); values.push(args[1]); this.bumpModCount(obj); return 1;
      }
      if (name === 'remove') {
        const indexed = method.parameters[0] === 'I', index = indexed ? int(args[1]) : values.findIndex(v => this.javaEquals(args[1], v));
        if (index < 0 || index >= values.length) { if (indexed) fail('List removal index out of bounds'); return 0; }
        const previous = values.splice(index, 1)[0]; this.reserveCollection(-1); this.bumpModCount(obj); return indexed ? previous : 1;
      }
    }
    if (method.owner === 'Ljava/lang/Class;') {
      const type = obj.classType;
      if(['getAnnotation','getDeclaredAnnotation','isAnnotationPresent','getAnnotations','getDeclaredAnnotations'].includes(name)){
        const all=name==='getAnnotations'||name==='getDeclaredAnnotations',target=all?null:this.object(args[1]).classType;
        if(!all&&!target)this.throwJava('Ljava/lang/NullPointerException;','Annotation class is null');
        const annotations=new Map(this.classAnnotations(type).map(a=>[a.type,a]));
        if(name!=='getDeclaredAnnotation'&&name!=='getDeclaredAnnotations'){
          let parent=this.parent(type),seen=new Set();while(parent){if(seen.has(parent)||seen.size>=64)fail('Invalid annotation superclass chain');seen.add(parent);for(const a of this.classAnnotations(parent))if(!annotations.has(a.type)&&this.classAnnotations(a.type).some(marker=>marker.type==='Ljava/lang/annotation/Inherited;'))annotations.set(a.type,a);parent=this.parent(parent);}
        }
        if(all){const value=this.newArray('[Ljava/lang/annotation/Annotation;',annotations.size);this.object(value).elements=[...annotations.values()].map(a=>this.annotationObject(a));return value;}
        const annotation=annotations.get(target);return name==='isAnnotationPresent'?(annotation?1:0):annotation?this.annotationObject(annotation):null;
      }
      if (['getDeclaredMethod', 'getMethod', 'getDeclaredConstructor', 'getConstructor', 'getDeclaredField', 'getField'].includes(name)) {
        const kind = name.includes('Constructor') ? 'constructor' : name.includes('Field') ? 'field' : 'method';
        const memberName = kind === 'constructor' ? '<init>' : args[1];
        const parameters = kind === 'field' ? null : this.reflectionParameterTypes(args[kind === 'constructor' ? 1 : 2]);
        const member = this.reflectionLookup(type, kind, memberName, parameters, !name.startsWith('getDeclared'));
        return this.reflectionObject(kind, member);
      }
      if (['getDeclaredMethods', 'getDeclaredConstructors', 'getConstructors', 'getDeclaredFields'].includes(name)) {
        const cls = this.classes.get(type); if (!cls){
          if(name==='getConstructors'&&(type.length===1||type.startsWith('[')))return this.newArray('[Ljava/lang/reflect/Constructor;',0);
          // Platform classes without DEX bodies: the members are the registered bridge signatures (static-ness unknown, see bridgeReflection).
          const kind = name.includes('Constructors') ? 'constructor' : name.includes('Fields') ? 'field' : 'method';
          if (kind === 'field') return this.newArray('[Ljava/lang/reflect/Field;',0);
          this.bridgeReflection(type, '<init>', []); // builds BRIDGE_INDEX
          const members = [...BRIDGE_INDEX.entries()].filter(([key]) => key.startsWith(type + '\0')).flatMap(([key, list]) => list.map(entry => ({ name: key.slice(type.length + 1), entry })))
            .filter(item => (kind === 'constructor') === (item.name === '<init>')).map(item => this.bridgeReflection(type, item.name, parseParameters(item.entry.params)));
          const result = this.newArray(`[Ljava/lang/reflect/${kind === 'constructor' ? 'Constructor' : 'Method'};`, members.length);
          this.object(result).elements = members.map(member => this.reflectionObject(kind, member)); return result;
        }
        const kind = name.includes('Constructors') ? 'constructor' : name.includes('Fields') ? 'field' : 'method';
        const members = kind === 'field' ? [...cls.fields, ...cls.staticFields].map(item => ({ field: cls.dex.fields[item.index], flags: item.flags }))
          : [...cls.methods.values()].filter(def => (kind === 'constructor' ? def.method.name === '<init>' : !def.method.name.startsWith('<'))&&(name!=='getConstructors'||!!(def.flags&1)));
        const result = this.newArray(`[Ljava/lang/reflect/${kind === 'constructor' ? 'Constructor' : kind === 'field' ? 'Field' : 'Method'};`, members.length);
        this.object(result).elements = members.map(member => this.reflectionObject(kind, member)); return result;
      }
      if (name === 'newInstance') {
        const cls = this.classes.get(type); if (!cls || cls.flags & (0x200 | 0x400)) this.throwJava('Ljava/lang/InstantiationException;', type);
        const constructor = cls.methods.get('<init>()V'); if (!constructor) this.throwJava('Ljava/lang/InstantiationException;', `No no-arg constructor: ${type}`);
        return this.reflectionInvoke(constructor, false, null, null, false);
      }
      if (name === 'getName' || name === 'getSimpleName' || name === 'getCanonicalName') return this.className(type, name === 'getSimpleName' ? 'simple' : name === 'getCanonicalName' ? 'canonical' : 'binary');
      if (name === 'getModifiers') return this.classNesting(type).modifiers ?? this.classes.get(type)?.flags ?? (EXTERNAL_INTERFACE_NAMES.has(type)?0x601:1);
      if (name === 'getDeclaringClass' || name === 'getEnclosingClass') { const info = this.classNesting(type), enclosing = name === 'getDeclaringClass' ? info.declaringClass : info.enclosingClass ?? info.declaringClass; return enclosing ? this.classObject(enclosing) : null; }
      if (name === 'getResource' || name === 'getResourceAsStream') {
        // Class.getResource: absolute names drop the leading '/', relative ones are resolved against the class package (java.lang.Class.resolveName);
        // the class loader then looks the entry up in the APK archive. A present entry would need a jar: URL / stream, which this VM does not have.
        if (isNull(args[1])) this.throwJava('Ljava/lang/NullPointerException;', null);
        const requested = this.stringCharacters(args[1]), pkg = type.startsWith('L') ? type.slice(1, type.lastIndexOf('/') + 1) : '';
        const entry = requested.startsWith('/') ? requested.slice(1) : pkg + requested;
        if (!this.apkEntries.has(entry)) return null;
        return name === 'getResource' ? this.platform.javaIo.apkResourceURL(this, entry) : this.platform.javaIo.apkResourceStream(this, entry);
      }
      if (name === 'getEnclosingMethod' || name === 'getEnclosingConstructor') {
        // libcore Class.getEnclosingMethodOrConstructor: the dalvik EnclosingMethod annotation names the declaring member; <init> belongs to getEnclosingConstructor only.
        const reference = this.classNesting(type).enclosingMethod; if (!reference) return null;
        const constructor = reference.name === '<init>'; if (constructor !== (name === 'getEnclosingConstructor')) return null;
        const owner = this.classes.get(reference.owner), definition = owner?.methods.get(reference.name + reference.signature);
        if (!definition) fail(`Enclosing member metadata is unavailable: ${reference.key}`);
        return this.reflectionObject(constructor ? 'constructor' : 'method', definition);
      }
      if (name === 'isAnonymousClass') { const info = this.classNesting(type); return info.inner && info.simpleName === null ? 1 : 0; }
      if (name === 'isLocalClass') return this.classNesting(type).enclosingMethod ? 1 : 0;
      if (name === 'isMemberClass') return this.classNesting(type).declaringClass ? 1 : 0;
      if (name === 'getInterfaces') { const types = this.interfaces(type); const array = this.newArray('[Ljava/lang/Class;', types.length); this.object(array).elements = types.map(t => this.classObject(t)); return array; }
      if (name === 'getClassLoader') { if (this.classOwners?.has(type)) { const owner = this.classOwners.get(type); return this.object(owner).type === 'Ldalvik/system/DexFile;' ? (this.dexFileLoaders?.get(type) ?? null) : owner; } const definition = this.classes.get(type.replace(/^\[+/, '')); if (type.length === 1 || !definition || this.dex.bootDexes?.has(definition.dex)) return null; return this.applicationClassLoader ??= this.platform?.classLoaders?.createApplicationLoader(this) ?? this.makeObject('Ljava/lang/ClassLoader;'); }
      if (name === 'getSuperclass') { const parent = this.classes.get(type)?.flags & 0x200 ? null : type.startsWith('[') ? 'Ljava/lang/Object;' : this.parent(type); return parent ? this.classObject(parent) : null; }
      if (name === 'isInterface') return (this.classes.get(type)?.flags??(EXTERNAL_INTERFACE_NAMES.has(type)?0x200:0))&0x200?1:0;
      if (name === 'isEnum') { const flags = this.classes.get(type)?.flags ?? 0; return flags & 0x4000 && this.parent(type) === 'Ljava/lang/Enum;' ? 1 : 0; }
      if (name === 'getEnumConstants') {   // Class.getEnumConstantsShared: the enum's values() array (a copy), null for a class that is not an enum
        const flags = this.classes.get(type)?.flags ?? 0; if (!(flags & 0x4000 && this.parent(type) === 'Ljava/lang/Enum;')) return null;
        this.initialize(type); return this.dispatch({ owner: type, name: 'values', parameters: [], result: `[${type}`, signature: `()[${type}` }, [], 'static');
      }
      if (name === 'isPrimitive') return type.length === 1 ? 1 : 0;
      if (name === 'isArray') return type.startsWith('[') ? 1 : 0;
      if (name === 'getComponentType') return type.startsWith('[') ? this.classObject(type.slice(1)) : null;
      if (name === 'isAssignableFrom') return this.isSubtype(this.object(args[1]).classType, type) ? 1 : 0;
      if(name==='asSubclass'){const parent=this.object(args[1]).classType;if(!this.isSubtype(type,parent))this.throwJava('Ljava/lang/ClassCastException;',`${type} is not a subclass of ${parent}`);return args[0];}
      if (name === 'isInstance') return !isNull(args[1]) && this.isSubtype(this.typeOf(args[1]), type) ? 1 : 0;
      if(name==='cast'){if(!isNull(args[1])&&!this.isSubtype(this.typeOf(args[1]),type))this.throwJava('Ljava/lang/ClassCastException;',`Cannot cast ${this.typeOf(args[1])} to ${type}`);return args[1];}
      if (name === 'desiredAssertionStatus') return 0;
    }
    if (method.owner === 'Ljava/lang/StringBuilder;'||method.owner==='Ljava/lang/StringBuffer;') {
      if (name === '<init>') { if (method.parameters[0] === 'I' && int(args[1]) < 0) this.throwJava('Ljava/lang/IllegalArgumentException;', 'negative StringBuilder capacity'); obj.builder = typeof args[1] === 'string' ? args[1] : ''; return undefined; }
      if(name==='append'&&method.parameters[0]==='[C'){
        const array=this.array(args[1]);if(array.type!=='[C')fail('Expected char array');
        const start=method.parameters.length===1?0:int(args[2]),count=method.parameters.length===1?array.elements.length:int(args[3]);
        if(start<0||count<0||start>array.elements.length-count)this.throwJava('Ljava/lang/IndexOutOfBoundsException;','Invalid char-array append range');
        if((obj.builder??'').length+count>4000000)fail('StringBuilder length limit exceeded');
        obj.builder=(obj.builder??'')+utf16String(array.elements.slice(start,start+count));return args[0];
      }
      if(name==='append'&&method.parameters.length===3){
        const sequence=isNull(args[1])?'null':args[1],start=int(args[2]),end=int(args[3]);
        const direct=typeof sequence==='string'?sequence:this.isStringValue(sequence)?this.stringCharacters(sequence):['Ljava/lang/StringBuilder;','Ljava/lang/StringBuffer;'].includes(this.typeOf(sequence))?this.object(sequence).builder??'':null;
        const length=direct!==null?direct.length:this.dispatch({owner:'Ljava/lang/CharSequence;',name:'length',parameters:[],result:'I',signature:'()I'},[sequence],'virtual');
        if(start<0||end<start||end>length)this.throwJava('Ljava/lang/IndexOutOfBoundsException;','Invalid append CharSequence range');
        if((obj.builder??'').length+end-start>4000000)fail('StringBuilder length limit exceeded');
        let value;
        if(direct!==null)value=direct.slice(start,end);else{
          const units=new Uint16Array(end-start);for(let i=start;i<end;i++)units[i-start]=this.dispatch({owner:'Ljava/lang/CharSequence;',name:'charAt',parameters:['I'],result:'C',signature:'(I)C'},[sequence,i],'virtual');value=utf16String(units);
        }
        obj.builder=(obj.builder??'')+value;return args[0];
      }
      if (['delete','deleteCharAt','setCharAt','setLength','replace','reverse','indexOf','lastIndexOf','capacity','ensureCapacity','trimToSize','substring','codePointAt','appendCodePoint','getChars','insert'].includes(name)) {
        const text = obj.builder ?? '', bad = (kind, message) => this.throwJava(kind, message), limit = value => { if (value.length > 4000000) fail('StringBuilder length limit exceeded'); return value; };
        if (name === 'delete') { const start = int(args[1]); let end = int(args[2]); if (end > text.length) end = text.length; if (start < 0 || start > end) bad('Ljava/lang/StringIndexOutOfBoundsException;', `start ${start}, end ${end}, length ${text.length}`); obj.builder = text.slice(0, start) + text.slice(end); return args[0]; }
        if (name === 'deleteCharAt') { const index = int(args[1]); if (index < 0 || index >= text.length) bad('Ljava/lang/StringIndexOutOfBoundsException;', `index ${index},length ${text.length}`); obj.builder = text.slice(0, index) + text.slice(index + 1); return args[0]; }
        if (name === 'setCharAt') { const index = int(args[1]); if (index < 0 || index >= text.length) bad('Ljava/lang/StringIndexOutOfBoundsException;', `index ${index},length ${text.length}`); obj.builder = text.slice(0, index) + String.fromCharCode(int(args[2]) & 65535) + text.slice(index + 1); return undefined; }
        if (name === 'setLength') { const length = int(args[1]); if (length < 0) bad('Ljava/lang/StringIndexOutOfBoundsException;', `String index out of range: ${length}`); obj.builder = limit(length <= text.length ? text.slice(0, length) : text + '\0'.repeat(length - text.length)); return undefined; }
        if (name === 'replace') { const start = int(args[1]); let end = int(args[2]); if (end > text.length) end = text.length; if (start < 0 || start > text.length || start > end) bad('Ljava/lang/StringIndexOutOfBoundsException;', `start ${start}, end ${end}, length ${text.length}`); obj.builder = limit(text.slice(0, start) + this.stringCharacters(args[3]) + text.slice(end)); return args[0]; }
        if (name === 'reverse') { const units = []; for (let i = text.length - 1; i >= 0; i--) { const c = text.charCodeAt(i); if (c >= 0xdc00 && c <= 0xdfff && i > 0 && text.charCodeAt(i - 1) >= 0xd800 && text.charCodeAt(i - 1) <= 0xdbff) { units.push(text.charCodeAt(i - 1), c); i--; } else units.push(c); } obj.builder = utf16String(units); return args[0]; }
        if (name === 'indexOf') { const from = method.parameters.length === 2 ? Math.max(0, int(args[2])) : 0; return text.indexOf(this.stringCharacters(args[1]), from); }
        if (name === 'lastIndexOf') { const needle = this.stringCharacters(args[1]); return method.parameters.length === 2 ? text.lastIndexOf(needle, int(args[2])) : text.lastIndexOf(needle); }
        if (name === 'capacity') return Math.max(16, text.length); if (name === 'ensureCapacity' || name === 'trimToSize') return undefined;
        if (name === 'substring') { const start = int(args[1]), end = method.parameters.length === 2 ? int(args[2]) : text.length; if (start < 0 || end > text.length || start > end) bad('Ljava/lang/StringIndexOutOfBoundsException;', `start ${start}, end ${end}, length ${text.length}`); return text.slice(start, end); }
        if (name === 'codePointAt') { const index = int(args[1]); if (index < 0 || index >= text.length) bad('Ljava/lang/StringIndexOutOfBoundsException;', `index ${index},length ${text.length}`); return text.codePointAt(index); }
        if (name === 'appendCodePoint') { const cp = int(args[1]); if (cp < 0 || cp > 0x10ffff) bad('Ljava/lang/IllegalArgumentException;', `Not a valid Unicode code point: 0x${(cp >>> 0).toString(16).toUpperCase()}`); obj.builder = limit(text + String.fromCodePoint(cp)); return args[0]; }
        if (name === 'getChars') {
          const begin = int(args[1]), end = int(args[2]), dst = this.array(args[3]), dstBegin = int(args[4]);
          if (begin < 0 || end > text.length || begin > end) bad('Ljava/lang/StringIndexOutOfBoundsException;', `start ${begin}, end ${end}, length ${text.length}`);
          if (dstBegin < 0 || dstBegin + (end - begin) > dst.elements.length) bad('Ljava/lang/ArrayIndexOutOfBoundsException;', 'getChars destination range');
          for (let i = begin; i < end; i++) dst.elements[dstBegin + i - begin] = text.charCodeAt(i); return undefined;
        }
        // insert(offset, x...)
        const offset = int(args[1]); if (offset < 0 || offset > text.length) bad('Ljava/lang/StringIndexOutOfBoundsException;', `offset ${offset}, length ${text.length}`);
        let piece;
        if (method.parameters[1] === '[C') { const array = this.array(args[2]), ranged = method.parameters.length === 4, from = ranged ? int(args[3]) : 0, count = ranged ? int(args[4]) : array.elements.length; if (from < 0 || count < 0 || from > array.elements.length - count) bad('Ljava/lang/StringIndexOutOfBoundsException;', 'Invalid char-array insert range'); piece = utf16String(array.elements.slice(from, from + count)); }
        else if (method.parameters.length === 4) { const seq = isNull(args[2]) ? 'null' : this.javaString(args[2], 'Ljava/lang/CharSequence;'), from = int(args[3]), to = int(args[4]); if (from < 0 || to < from || to > seq.length) bad('Ljava/lang/IndexOutOfBoundsException;', `start ${from}, end ${to}, length ${seq.length}`); piece = seq.slice(from, to); }
        else piece = this.javaString(args[2], method.parameters[1]);
        obj.builder = limit(text.slice(0, offset) + piece + text.slice(offset)); return args[0];
      }
      if (name === 'append') { const value = this.javaString(args[1], method.parameters[0]); if ((obj.builder ?? '').length + value.length > 4000000) fail('StringBuilder length limit exceeded'); obj.builder = (obj.builder ?? '') + value; return args[0]; }
      if (name === 'charAt') { const value = obj.builder ?? '', index = int(args[1]); if (index < 0 || index >= value.length) this.throwJava('Ljava/lang/StringIndexOutOfBoundsException;', String(index)); return value.charCodeAt(index); }
      if (name === 'subSequence') { const value = obj.builder ?? '', start = int(args[1]), end = int(args[2]); if (start < 0 || end < start || end > value.length) this.throwJava('Ljava/lang/StringIndexOutOfBoundsException;', 'Invalid builder subsequence'); return value.slice(start, end); }
      if (name === 'toString') return obj.builder ?? '';
      if (name === 'length') return (obj.builder ?? '').length;
    }
    if (method.owner === 'Ljava/lang/Enum;') {
      if (name === '<init>') { obj.enumName = args[1]; obj.enumOrdinal = int(args[2]); return undefined; }
      const declaring = type => { let parent = this.parent(type), depth = 0; while (parent && parent !== 'Ljava/lang/Enum;' && depth++ < 64) { type = parent; parent = this.parent(type); } return type; };
      if (name === 'getDeclaringClass') return this.classObject(declaring(obj.type));
      if (name === 'compareTo') { const other = this.object(args[1]); if (declaring(obj.type) !== declaring(other.type)) this.throwJava('Ljava/lang/ClassCastException;', 'Enums have different declaring classes'); return int(obj.enumOrdinal) - int(other.enumOrdinal); }
      return name === 'ordinal' ? obj.enumOrdinal : obj.enumName;
    }
    if ((method.owner === 'Ljava/lang/Integer;' && name === 'intValue') || (method.owner === 'Ljava/lang/Boolean;' && name === 'booleanValue')) return obj.boxed;
    switch (method.name) {
      case '<init>': case 'onCreate': return undefined;
      case 'setContentView': {
        if (!this.isSubtype(this.object(args[1]).type, 'Landroid/view/View;')) fail('Content is not a View');
        this.root = args[1]; return undefined;
      }
      case 'setOrientation': {
        const n = int(args[1]); if (n !== 0 && n !== 1) fail('Invalid LinearLayout orientation'); obj.orientation = n; return undefined;
      }
      case 'addView': {
        const child = this.object(args[1]);
        if (!this.isSubtype(child.type, 'Landroid/view/View;') || child.id === obj.id || obj.children.some(v => v.ref === child.id) || obj.children.length >= 256)
          fail('Invalid/duplicate child View');
        obj.children.push(args[1]); return undefined;
      }
      case 'setText': {
        if (typeof args[1] !== 'string' && !isNull(args[1])) fail('Expected String/CharSequence');
        obj.text = isNull(args[1]) ? '' : args[1]; return undefined;
      }
      case 'setOnClickListener': obj.clickable=true;obj.listener = isNull(args[1]) ? null : (this.object(args[1]), args[1]); return undefined;
      case 'setTextSize': {
        const bits = new DataView(new ArrayBuffer(4)); bits.setInt32(0, int(args[1]), true);
        const size = bits.getFloat32(0, true);
        if (!Number.isFinite(size) || size < 1 || size > 200) fail('Unsupported TextView size');
        obj.textSize = size; return undefined;
      }
      default: if (this.toleratesMissing(method)) return this.noteMissingStub(methodKey(method), method.result); fail(`Unsupported API: ${methodKey(method)}`);
    }
  }
  checkArrayValue(array, value) {
    const type = array.type.slice(1);
    if (/^[L[]/.test(type) && !isNull(value) && !this.isSubtype(this.typeOf(value), type)) this.throwJava('Ljava/lang/ArrayStoreException;', `${this.typeOf(value)} into ${array.type}`);
  }
  catchTarget(code, dex, pc, exception) {
    if (!code.tries) return null;
    const b = dex.reader, start = code.offset + code.units * 2 + (code.units & 1 ? 2 : 0);
    b.check(start, code.tries * 8);
    const handlers = start + code.tries * 8;
    for (let i = 0; i < code.tries; i++) {
      const entry = start + i * 8, from = b.u32(entry), count = b.u16(entry + 4);
      if (pc < from || pc >= from + count) continue;
      const cursor = { p: handlers + b.u16(entry + 6) }, size = b.sleb(cursor);
      if (Math.abs(size) > 10000) fail('Exception handler limit exceeded');
      let target = null;
      for (let j = 0; j < Math.abs(size); j++) {
        const type = dex.types[b.uleb(cursor)], address = b.uleb(cursor);
        if (!type || address >= code.units) fail('Malformed DEX exception handler');
        if (target === null && this.isSubtype(this.typeOf(exception), type)) target = address;
      }
      if (size <= 0) { const address = b.uleb(cursor); if (address >= code.units) fail('Invalid catch-all address'); if (target === null) target = address; }
      return target;
    }
    return null;
  }
  /** Runs a DEX body to completion on the current thread's frame stack (src/interpreter.js). */
  execute(method, code, args) { return runNested(this, method, code, args); }
  get currentMethod() { const frames = currentThread(this).frames; return frames.length ? frames[frames.length - 1].method : null; }
  set currentMethod(value) { /* derived from the frame stack; kept assignable for legacy callers */ }
  get methodStack() { return currentThread(this).frames.map(frame => frame.method); }
  set methodStack(value) { /* derived from the frame stack */ }
  runThreads() { return runSlice(this); }
  // ---- monitors: Map<object id, {owner: VMThread, count}>. monitor-enter on a contended monitor parks the thread (interpreter.js); host code waits through the scheduler.
  monitorId(value) { return typeof value === 'string' ? value : this.object(value).id; }
  monitorTryEnter(value, thread = this.thread ?? this.scheduler.mainThread()) {
    const id = this.monitorId(value), monitor = this.monitors.get(id);
    if (monitor === undefined) { this.monitors.set(id, { owner: thread, count: 1 }); return true; }
    if (monitor.owner === thread) { monitor.count++; return true; }
    return false;
  }
  monitorFree(value) { return !this.monitors.has(this.monitorId(value)); }
  /** Host-side monitor-enter: waits for a contended monitor through the scheduler. */
  monitorEnter(value) {
    while (!this.monitorTryEnter(value)) this.scheduler.resolveNested(new Blocked({ ready: () => this.monitorFree(value), reason: 'monitor' }));
  }
  monitorExit(value, thread = this.thread ?? this.scheduler.mainThread()) {
    const id = this.monitorId(value), monitor = this.monitors.get(id);
    if (monitor === undefined || monitor.owner !== thread) this.throwJava('Ljava/lang/IllegalMonitorStateException;', 'monitor not owned');
    if (monitor.count > 1) monitor.count--; else this.monitors.delete(id);
  }
  ownsMonitor(value, thread = this.thread ?? this.scheduler.mainThread()) { return this.monitors.get(this.monitorId(value))?.owner === thread; }
  /** An exception left a thread's run(): the thread's UncaughtExceptionHandler runs, otherwise the fatal exception ends the process like Android's default handler. */
  threadUncaught(thread, error) {
    if (this.uncaughtHook) return this.uncaughtHook(thread, error);
    throw error;
  }
}

function arithmetic(op, x, y) {
  switch (op) {
    case 0: return (x + y) | 0;
    case 1: return (x - y) | 0;
    case 2: return Math.imul(x, y);
    case 3: if (!y) fail('Integer divide by zero (exceptions unsupported)'); return (x / y) | 0;
    case 4: if (!y) fail('Integer remainder by zero (exceptions unsupported)'); return (x % y) | 0;
    case 5: return x & y; case 6: return x | y; case 7: return x ^ y;
    case 8: return x << (y & 31); case 9: return x >> (y & 31); case 10: return (x >>> (y & 31)) | 0;
    default: fail('Unsupported arithmetic');
  }
}

bindSupport({ fail, isNull, int, wide, narrow, narrowVariant, equal, signed8, signed16, floatNumber, floatBits, doubleNumber, doubleBits, javaInt, javaLong, defaultValue, wordCount, methodKey, WIDE_HIGH, longArithmetic, arithmetic, JavaException });
