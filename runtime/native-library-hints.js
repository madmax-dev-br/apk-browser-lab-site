// "What is this native library?", answered from public, well-known open-source symbol conventions and version strings. Static and DOM-free: it only looks at
// names an ELF already exposes (dynamic symbols) and a few ASCII banners in its bytes. The table is data: add a row, add a test.
//   provides : prefixes of exported symbols the library defines (a library exporting them IS, or embeds, that project)
//   contains : substrings of exported/imported symbol names (C++ mangled namespaces)
//   banners  : ASCII strings a build of that project embeds
// A library that only IMPORTS a project's symbols is reported as "usa", not as "parece".
import { inspectELF } from './native-inspector.js?v=2af81fe8368d';
export const LIBRARY_HINTS = [
  { id: 'mcrypt', label: 'libmcrypt', provides: ['mcrypt_', 'mdecrypt_'], banners: ['libmcrypt'] },
  { id: 'sqlite', label: 'SQLite', provides: ['sqlite3_'], banners: ['SQLite format 3', 'SQLite version '] },
  { id: 'sqlcipher', label: 'SQLCipher', provides: ['sqlcipher_'], banners: ['SQLCipher'] },
  { id: 'openssl', label: 'OpenSSL', provides: ['SSL_', 'EVP_', 'OPENSSL_', 'CRYPTO_', 'BIO_', 'X509_', 'RSA_', 'EC_KEY_', 'BN_', 'OSSL_', 'ERR_get_error'], banners: ['OpenSSL '] },
  { id: 'boringssl', label: 'BoringSSL', provides: ['CBS_', 'CBB_', 'OPENSSL_malloc'], banners: ['BoringSSL'] },
  { id: 'mbedtls', label: 'Mbed TLS', provides: ['mbedtls_'], banners: ['mbed TLS'] },
  { id: 'wolfssl', label: 'wolfSSL', provides: ['wolfSSL_', 'wc_'], banners: ['wolfSSL'] },
  { id: 'cryptopp', label: 'Crypto++', contains: ['CryptoPP'], banners: ['Crypto++'] },
  { id: 'libsodium', label: 'libsodium', provides: ['sodium_', 'crypto_secretbox', 'crypto_box_', 'crypto_sign_', 'crypto_aead_'], banners: ['libsodium'] },
  { id: 'zstd', label: 'Zstandard', provides: ['ZSTD_', 'ZSTDMT_', 'FSE_', 'HUF_'], banners: ['Zstandard'] },
  { id: 'lz4', label: 'LZ4', provides: ['LZ4_', 'LZ4F_', 'LZ4HC_', 'lz4'], banners: ['LZ4 compression'] },
  { id: 'lzma', label: 'xz / liblzma', provides: ['lzma_', 'LzmaDec', 'Lzma2Dec', 'Lzma2Enc'], banners: ['XZ Utils', 'xz-embedded'] },
  { id: 'brotli', label: 'Brotli', provides: ['Brotli'], banners: [] },
  { id: 'bzip2', label: 'bzip2', provides: ['BZ2_'], banners: ['bzip2 1.'] },
  { id: 'zlib', label: 'zlib', provides: ['zlibVersion', 'deflateInit_', 'inflateInit_', 'deflateInit2_', 'inflateInit2_', 'gzopen', 'adler32', 'compress2'], banners: ['deflate 1.', 'inflate 1.'] },
  { id: 'libpng', label: 'libpng', provides: ['png_'], banners: ['libpng version'] },
  { id: 'libjpeg', label: 'libjpeg(-turbo)', provides: ['jpeg_', 'tjCompress', 'tjDecompress', 'tjInit'], banners: ['libjpeg-turbo'] },
  { id: 'libwebp', label: 'libwebp', provides: ['WebPEncode', 'WebPDecode', 'WebPPicture', 'WebPConfig', 'WebPGet', 'VP8'], banners: ['libwebp'] },
  { id: 'giflib', label: 'giflib', provides: ['DGif', 'EGif', 'GifMakeMapObject'], banners: [] },
  { id: 'freetype', label: 'FreeType', provides: ['FT_'], banners: ['FreeType'] },
  { id: 'harfbuzz', label: 'HarfBuzz', provides: ['hb_'], banners: ['HarfBuzz'] },
  { id: 'opus', label: 'Opus', provides: ['opus_', 'celt_', 'silk_'], banners: ['libopus'] },
  { id: 'ffmpeg', label: 'FFmpeg', provides: ['av_', 'avcodec_', 'avformat_', 'avfilter_', 'swr_', 'sws_'], banners: ['FFmpeg', 'Lavc'] },
  { id: 'curl', label: 'libcurl', provides: ['curl_'], banners: ['libcurl/'] },
  { id: 'libxml2', label: 'libxml2', provides: ['xmlParse', 'xmlNew', 'xmlFree', 'xmlDoc', 'xmlReadMemory'], banners: ['libxml2'] },
  { id: 'expat', label: 'Expat', provides: ['XML_Parser', 'XML_Parse', 'XML_SetElementHandler'], banners: ['expat_'] },
  { id: 'protobuf', label: 'Protocol Buffers', contains: ['6google8protobuf'], banners: ['google.protobuf'] },
  { id: 'lua', label: 'Lua', provides: ['lua_', 'luaL_', 'luaopen_'], banners: ['Lua 5.'] },
  { id: 'uv', label: 'libuv', provides: ['uv_'], banners: [] },
  { id: 'boost', label: 'Boost', contains: ['5boost'], banners: [] },
];

const prefixCount = (names, prefixes, contains) => {
  let n = 0;
  for (const name of names) if (prefixes?.some(p => name.startsWith(p)) || contains?.some(c => name.includes(c))) n++;
  return n;
};

/**
 * Guesses what an ELF is from its exported/imported dynamic symbol names and (optionally) its bytes.
 * -> [{ id, label, kind: 'provides' | 'uses' | 'banner', matches }] best first. A project counts as provided with at least 1 exported match, as used with
 * at least 2 imported matches, and by banner only when no symbol evidence exists.
 */
export function guessLibrary({ exportNames = [], importNames = [], bytes = null } = {}, table = LIBRARY_HINTS) {
  const found = [];
  let text = null;
  for (const hint of table) {
    const provided = prefixCount(exportNames, hint.provides, hint.contains);
    if (provided) { found.push({ id: hint.id, label: hint.label, kind: 'provides', matches: provided }); continue; }
    const used = prefixCount(importNames, hint.provides, hint.contains);
    if (used >= 2) { found.push({ id: hint.id, label: hint.label, kind: 'uses', matches: used }); continue; }
    if (bytes && hint.banners?.length) {
      text ??= new TextDecoder('latin1').decode(bytes);
      const banner = hint.banners.find(b => text.includes(b));
      if (banner) found.push({ id: hint.id, label: hint.label, kind: 'banner', matches: 1 });
    }
  }
  const order = { provides: 0, uses: 1, banner: 2 };
  return found.sort((a, b) => order[a.kind] - order[b.kind] || b.matches - a.matches || a.id.localeCompare(b.id));
}

// Names worth showing first: JNI entry points, then plain C names; compiler/C++-runtime symbols (leading underscore) last.
const nameRank = n => n.startsWith('Java_') || n.startsWith('JNI_') ? 0 : n.startsWith('_') ? 2 : 1;
const sampleNames = names => names.map((n, i) => [n, i]).sort((a, b) => nameRank(a[0]) - nameRank(b[0]) || a[1] - b[1]).slice(0, 6).map(([n]) => n);

const ELF_ANALYSIS_LIMIT = 32 * 1024 * 1024;
/**
 * Static description of one native library from its bytes (nothing is executed): size, machine, DT_NEEDED (first 8), exported dynamic function symbols (count and up to 6 names),
 * JNI_OnLoad, whether the image mentions RegisterNatives (the JNIEnv table has no dynamic symbol, so only a string can show it), imported symbol count and the "looks like" guesses.
 * A file that is not an inspectable ELF (truncated, packed, too big) -> { size, error } with a short reason.
 */
export function describeNativeLibrary(bytes) {
  const out = { size: bytes.length };
  if (bytes.length > ELF_ANALYSIS_LIMIT) return { ...out, error: 'grande demais para análise' };
  let elf;
  try { elf = inspectELF(bytes, { maxNames: 4000, maxSymbols: 20000 }); }
  catch (error) { return { ...out, error: String(error.message ?? error).replace(/^ELF inspection: /, '').slice(0, 80) }; }
  const text = new TextDecoder('latin1').decode(bytes);
  return {
    ...out, bits: elf.bits, architecture: elf.architecture,
    needed: elf.needed.slice(0, 8), neededCount: elf.needed.length,
    exportCount: elf.exportCount, exportSample: sampleNames(elf.exportNames).map(n => n.length > 60 ? n.slice(0, 57) + '...' : n),
    importCount: elf.importCount, jniOnLoad: elf.jniOnLoad, registerNatives: text.includes('RegisterNatives'),
    noSymbols: elf.exportCount + elf.importCount === 0,
    hints: guessLibrary({ exportNames: elf.exportNames, importNames: elf.importNames, bytes }).slice(0, 2),
  };
}
