import { APKError } from './apk-runtime.js?v=e9d35ddef77e';
// android.graphics.drawable.NinePatchDrawable for compiled 9-patch PNGs (aapt2 npTc chunk).
// Layout contract (intrinsic size, getPadding) comes from the real compiled chunk; pixels are stretched with the
// official Skia rasterizer (CanvasKit) exactly along the chunk's stretch regions. No platform-drawable look-alikes.
const TYPE = 'Landroid/graphics/drawable/NinePatchDrawable;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;', RECT = 'Landroid/graphics/Rect;', CANVAS = 'Landroid/graphics/Canvas;', FILTER = 'Landroid/graphics/ColorFilter;', COLOR_LIST = 'Landroid/content/res/ColorStateList;';
const keys = new Set(['<init>()V', 'inflate(Landroid/content/res/Resources;Lorg/xmlpull/v1/XmlPullParser;Landroid/util/AttributeSet;Landroid/content/res/Resources$Theme;)V', `getPadding(${RECT})Z`, 'getIntrinsicWidth()I', 'getIntrinsicHeight()I', `draw(${CANVAS})V`, 'setAlpha(I)V', `setColorFilter(${FILTER})V`, 'getOpacity()I', 'isStateful()Z', 'onStateChange([I)Z', 'getConstantState()Landroid/graphics/drawable/Drawable$ConstantState;', 'getOpticalInsets()Landroid/graphics/Insets;'].map(signature => TYPE + '->' + signature));
const fail = (message, details = {}) => { throw new APKError(message, { kind: 'ninepatch-drawable-unsupported', ...details }); };
const u32 = (bytes, at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
const bits = new DataView(new ArrayBuffer(4)), bitsFloat = value => { bits.setInt32(0, value | 0, true); return bits.getFloat32(0, true); };
const base64 = bytes => { let binary = ''; for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384)); return btoa(binary); };
export function parseNinePatch(bytes) {
  if (!(bytes?.length > 33) || u32(bytes, 0) !== 0x89504e47) fail('9-patch resource is not a PNG');
  let width = 0, height = 0, chunk = null, optical = null;
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = u32(bytes, at), type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (at + 12 + length > bytes.length) fail('Truncated PNG chunk in 9-patch');
    if (type === 'IHDR') { width = u32(bytes, at + 8); height = u32(bytes, at + 12); }
    if (type === 'npTc') chunk = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'npOl' && length >= 16) { const view = new DataView(bytes.buffer, bytes.byteOffset + at + 8, length); optical = { left: view.getInt32(0, true), top: view.getInt32(4, true), right: view.getInt32(8, true), bottom: view.getInt32(12, true) }; } // npOl: native-endian (little) ints
    at += 12 + length;
  }
  if (!width || !height) fail('PNG 9-patch has no IHDR');
  if (!chunk || chunk.length < 32) fail('PNG has no compiled 9-patch (npTc) chunk; only aapt2-compiled 9-patches are supported');
  const numX = chunk[1], numY = chunk[2], numColors = chunk[3];
  if (chunk.length < 32 + 4 * (numX + numY + numColors)) fail('Truncated npTc chunk');
  const divs = (from, count) => Array.from({ length: count }, (_, i) => u32(chunk, from + 4 * i));
  return { width, height, optical, padding: { left: u32(chunk, 12) | 0, right: u32(chunk, 16) | 0, top: u32(chunk, 20) | 0, bottom: u32(chunk, 24) | 0 }, xDivs: divs(32, numX), yDivs: divs(32 + 4 * numX, numY) };
}
/** Source/destination segments: [src0,src1,dst0,dst1][] following Skia lattice/Android fixed+stretch semantics. */
export function ninePatchSegments(size, divs, target) {
  const bounds = [0, ...divs, size], spans = [];
  for (let i = 0; i + 1 < bounds.length; i++) if (bounds[i + 1] > bounds[i]) spans.push({ from: bounds[i], to: bounds[i + 1], stretch: i % 2 === 1 });
  const fixed = spans.filter(s => !s.stretch).reduce((sum, s) => sum + s.to - s.from, 0), stretchSource = spans.filter(s => s.stretch).reduce((sum, s) => sum + s.to - s.from, 0);
  const fixedScale = target >= fixed || !fixed ? 1 : target / fixed, extra = Math.max(0, target - fixed);
  let cursor = 0; return spans.map(span => { const length = span.to - span.from, dest = span.stretch ? (stretchSource ? extra * length / stretchSource : 0) : length * fixedScale, result = [span.from, span.to, cursor, cursor + dest]; cursor += dest; return result; });
}
export function createNinePatchDrawableHost(platform) {
  const call = (r, receiver, owner, name, parameters = [], result = 'V', values = [], mode = 'virtual') => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...values], mode);
  const state = (r, receiver) => r.object(receiver).ninePatch ??= { patch: null, bytes: null, tint: null, alpha: 255, stateColor: null, drawState: null, cache: null, filter: null };
  const bounds = (r, receiver) => { const rect = call(r, receiver, DRAWABLE, 'getBounds', [], RECT), fields = r.object(rect).fields, get = name => fields.get(`${RECT}->${name}:I`) ?? 0; return { left: get('left'), top: get('top'), right: get('right'), bottom: get('bottom') }; };
  const tintColor = (r, st) => {
    if (!st.tint) return null;
    const list = st.tint, fallback = call(r, list, COLOR_LIST, 'getDefaultColor', [], 'I');
    return st.drawState ? call(r, list, COLOR_LIST, 'getColorForState', ['[I', 'I'], 'I', [st.drawState, fallback]) >>> 0 : fallback >>> 0;
  };
  const render = (r, st, width, height) => {
    const tint = tintColor(r, st), key = `${width}x${height}:${tint}:${st.alpha}`;
    if (st.cache?.key === key) return st.cache.raster;
    const CK = r.skia?.CanvasKit; if (!CK?.MakeImageFromEncoded) fail('9-patch drawing requires the verified Skia CanvasKit backend');
    if (!(width > 0 && height > 0) || width > 4096 || height > 4096 || width * height > 4 * 1024 * 1024) fail('9-patch extent exceeds 4096px/4Mpixel VM limit');
    const image = CK.MakeImageFromEncoded(st.bytes); if (!image) fail('Skia rejected the 9-patch PNG');
    const surface = CK.MakeSurface(width, height), paint = new CK.Paint(); let filter = null;
    try {
      if (!surface) fail('Skia 9-patch raster allocation failed');
      if (tint !== null) { filter = CK.ColorFilter.MakeBlend(CK.Color((tint >>> 16) & 255, (tint >>> 8) & 255, tint & 255, (tint >>> 24) / 255), CK.BlendMode.SrcIn); paint.setColorFilter(filter); }
      paint.setAlphaf(st.alpha / 255);
      const canvas = surface.getCanvas(); canvas.clear(CK.TRANSPARENT);
      const columns = ninePatchSegments(st.patch.width, st.patch.xDivs, width), rows = ninePatchSegments(st.patch.height, st.patch.yDivs, height);
      for (const row of rows) for (const column of columns) if (column[3] > column[2] && row[3] > row[2]) canvas.drawImageRect(image, CK.LTRBRect(column[0], row[0], column[1], row[1]), CK.LTRBRect(column[2], row[2], column[3], row[3]), paint);
      surface.flush(); const snapshot = surface.makeImageSnapshot();
      try { const png = snapshot.encodeToBytes(); if (!png || png.length > 8 * 1024 * 1024) fail('Invalid or excessive 9-patch PNG'); const raster = { kind: 'raster', dataURL: 'data:image/png;base64,' + base64(png), width, height }; st.cache = { key, raster }; return raster; }
      finally { snapshot.delete(); }
    } finally { filter?.delete(); paint.delete(); surface?.dispose(); image.delete(); }
  };
  const attribute = (node, name) => node.attributes.find(item => item.name === name && item.namespace === 'http://schemas.android.com/apk/res/android');
  return {
    supports: key => keys.has(key),
    canAllocate: type => type === TYPE,
    parent: type => type === TYPE ? DRAWABLE : null,
    handles: owner => owner === TYPE,
    invoke(r, method, args) {
      const receiver = args[0], name = method.name, st = state(r, receiver);
      if (name === '<init>') return call(r, receiver, DRAWABLE, '<init>', [], 'V', [], 'direct');
      if (name === 'inflate') {
        const node = r.object(args[3])?.node ?? r.object(args[2])?.node; if (!node) fail('9-patch inflate needs the XML attribute node');
        const theme = args[4], themeValues = theme ? r.object(theme).themeValues : new Map(), backend = platform.styleBackend;
        const src = attribute(node, 'src'); if (!src || src.kind !== 'reference') fail('<nine-patch> requires android:src as a drawable resource');
        let bytes = platform.resources.frameworkTable?.ninePatch?.get(src.reference >>> 0)?.bytes ?? null;
        if (!bytes) {
          let value = platform.resources.resolve(src.reference); while (value.resolved) value = value.resolved;
          if (value.kind !== 'string' || typeof value.value !== 'string') fail(`9-patch source 0x${(src.reference >>> 0).toString(16)} has no compiled PNG (${value.reason || value.kind}); framework 9-patch data may be missing`, { resourceId: src.reference >>> 0 });
          if (!r.apkEntries?.has(value.value) || !r.apkReader) fail(`9-patch PNG ${value.value} is not readable from the APK`, { path: value.value });
          bytes = r.apkReader(value.value);
        }
        st.bytes = bytes; st.patch = parseNinePatch(bytes); st.cache = null;
        const tint = attribute(node, 'tint');
        if (tint) {
          const resolved = tint.kind === 'attribute' ? backend.resolved(tint, themeValues, false) : tint;
          if (resolved.kind === 'color' || resolved.dataType >= 28 && resolved.dataType <= 31) st.tint = r.dispatch({ owner: COLOR_LIST, name: 'valueOf', signature: `(I)${COLOR_LIST}`, parameters: ['I'], result: COLOR_LIST }, [resolved.rawData | 0], 'static');
          else if (resolved.kind === 'reference') st.tint = backend.loadColor(r, resolved.reference, theme);
          else fail('Unsupported <nine-patch> android:tint value ' + resolved.kind);
        }
        const alpha = attribute(node, 'alpha');
        if (alpha) { const resolved = alpha.kind === 'attribute' ? backend.resolved(alpha, themeValues, true) : alpha.kind === 'reference' ? backend.resolved(alpha, themeValues, true) : alpha; const f = typeof resolved.value === 'number' && resolved.dataType === 4 ? resolved.value : bitsFloat(resolved.rawData); if (!Number.isFinite(f) || f < 0 || f > 1) fail('Invalid <nine-patch> android:alpha'); st.alpha = Math.round(f * 255); }
        return;
      }
      if (!st.patch) fail('NinePatchDrawable used before inflate');
      if (name === 'getPadding') { const fields = r.object(args[1]).fields, p = st.patch.padding; for (const edge of ['left', 'top', 'right', 'bottom']) r.storeField(fields, `${RECT}->${edge}:I`, p[edge]); return 1; }
      if (name === 'getOpticalInsets') { const o = st.patch.optical, INSETS = 'Landroid/graphics/Insets;'; return o ? r.dispatch({ owner: INSETS, name: 'of', signature: '(IIII)' + INSETS, parameters: ['I', 'I', 'I', 'I'], result: INSETS }, [o.left, o.top, o.right, o.bottom], 'static') : r.readStatic({ owner: INSETS, name: 'NONE', type: INSETS, key: `${INSETS}->NONE:${INSETS}` }); }
      if (name === 'getIntrinsicWidth') return st.patch.width;
      if (name === 'getIntrinsicHeight') return st.patch.height;
      if (name === 'setAlpha') { st.alpha = args[1] & 255; st.cache = null; return; }
      if (name === 'setColorFilter') { st.filter = args[1]; return; }
      if (name === 'getOpacity') return -3;
      if (name === 'getConstantState') return null;
      if (name === 'isStateful') return st.tint && call(r, st.tint, COLOR_LIST, 'isStateful', [], 'Z') ? 1 : 0;
      if (name === 'onStateChange') { const previous = tintColor(r, st); st.drawState = args[1]; const next = tintColor(r, st); if (previous !== next) st.cache = null; return previous !== next ? 1 : 0; }
      if (name === 'draw') {
        if (st.filter) fail('9-patch with an additional ColorFilter is not supported');
        const b = bounds(r, receiver), width = b.right - b.left, height = b.bottom - b.top; if (width <= 0 || height <= 0) return;
        const canvas = args[1], handle = r.object(canvas).nativeCanvasHandle; if (!handle) fail('9-patch draw needs a recording Canvas');
        r.skiaHost.recordNative(handle, { op: 'raster', raster: render(r, st, width, height), args: [b.left, b.top] });
        r.record('DRAW NinePatchDrawable: compiled npTc chunk -> Skia stretched raster'); return;
      }
      fail('Unsupported NinePatchDrawable method ' + name);
    },
  };
}
