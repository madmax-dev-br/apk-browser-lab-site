// /system/etc/fonts.xml and /system/fonts of the virtual device, for code that reads the system fonts itself instead of asking android.graphics.Typeface: a native text engine opens
// fonts.xml and the files it names (Skia's SkFontMgr_android does), and Java code lists SystemFonts. The files are the vendored AOSP ones (src/system-font-image-data.js, generated);
// fonts.xml names more than the lab has (historic scripts, the CJK collection), and a name without a file is skipped by readers, as on a device image that leaves fonts out.
// A file's bytes are read the first time it is opened, through the Skia backend's font reader (src/font-fallback.js), and kept: `node.buf` is a getter, so stat and directory listings
// cost nothing. Without a font reader in the VM the read fails by name. No process.*.
import { APKError } from './apk-error.js?v=5afc26aa921f';
import { FONTS_XML, SYSTEM_FONT_IMAGE } from './system-font-image-data.js?v=5afc26aa921f';

/** Installs the files in `fs`; `fonts()` gives the font reader ({ readPinned }) of the running VM, or null. */
export function installSystemFonts(fs, fonts, mtime) {
  const put = (path, file, bytes, sha256) => {
    let data = null;
    const node = { type: 'file', size: bytes, mtime, mode: 0o644, uid: 0, gid: 0, mounted: true, system: true };
    // Not enumerable: whoever walks the VM's host state (the collector's root walk, src/heap-gc.js, reads every enumerable property) must not read the file.
    Object.defineProperty(node, 'buf', { enumerable: false, configurable: true, get() {
      if (data) return data;
      const reader = fonts(); if (!reader) throw new APKError(`${path}: the VM has no font reader (the Skia backend is not loaded)`, { kind: 'font-unavailable', path });
      return data = reader.readPinned(file, { bytes, sha256 });
    } });
    fs.put(path, node);
  };
  put('/system/etc/fonts.xml', FONTS_XML.path, FONTS_XML.bytes, FONTS_XML.sha256);
  for (const [name, file, bytes, sha256] of SYSTEM_FONT_IMAGE) put(`/system/fonts/${name}`, file, bytes, sha256);
}
