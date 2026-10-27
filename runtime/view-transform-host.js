import { APKError } from './apk-runtime.js?v=fd59ee7c3d79';
import { getMatrixValues } from './matrix-native.js?v=fd59ee7c3d79';
import { renderLightInfo, renderNodeProperties } from './rendernode-native.js?v=fd59ee7c3d79';

const VIEW = 'Landroid/view/View;', MATRIX = 'Landroid/graphics/Matrix;';
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const fields = ['TranslationX', 'TranslationY', 'ScaleX', 'ScaleY', 'Rotation', 'PivotX', 'PivotY', 'X', 'Y'];
const keys = new Set([
  'getMatrix()' + MATRIX, 'getInverseMatrix()' + MATRIX, 'hasIdentityMatrix()Z', 'isPivotSet()Z', 'resetPivot()V',
  ...fields.flatMap(field => [`get${field}()F`, `set${field}(F)V`]),
  ...['RotationX', 'RotationY'].flatMap(field => [`get${field}()F`, `set${field}(F)V`]),
  'getElevation()F','setElevation(F)V','getTranslationZ()F','setTranslationZ(F)V','getZ()F','setZ(F)V',
].map(signature => VIEW + '->' + signature));
const bits = new DataView(new ArrayBuffer(4));
const raw = value => { bits.setFloat32(0, value, true); return bits.getInt32(0, true); };
const number = value => { bits.setInt32(0, value, true); return bits.getFloat32(0, true); };
const fail = message => { throw new APKError(message, { kind: 'view-transform-unsupported' }); };
const dimensions = view => {
  const edge = name => view.bounds?.[name] ?? view.fields.get(`${VIEW}->m${name[0].toUpperCase() + name.slice(1)}:I`) ?? 0;
  return { left: edge('left'), top: edge('top'), width: edge('right') - edge('left'), height: edge('bottom') - edge('top') };
};

/** Native View/RenderNode boundary for planar transforms. Composition follows
 * Android13 RenderProperties::updateMatrix's 2D branch, calling original Matrix
 * Java and its Skia backend. The public matrix is a cache, not mutable View state.
 * Camera/perspective transforms are refused until an actual 3D backend exists.
 */
export function createViewTransformHost(platform) {
  const call = (runtime, receiver, name, parameters = [], result = 'V', values = [], mode = 'virtual') => runtime.dispatch(
    { owner: MATRIX, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...values], mode);
  const state = view => view.webTransform ??= {
    translationX: 0, translationY: 0, scaleX: 1, scaleY: 1, rotation: 0,
    pivotX: dimensions(view).width / 2, pivotY: dimensions(view).height / 2, explicitPivot: false,
    key: null, values: IDENTITY.slice(), elevation: 0, translationZ: 0, shadowKey: null, shadowValue: null, matrix: null, inverse: null, buffer: null,
  };
  const makeMatrix = runtime => { const reference = runtime.allocate(MATRIX); call(runtime, reference, '<init>', [], 'V', [], 'direct'); return reference; };
  const update = (runtime, receiver) => {
    const view = runtime.object(receiver), s = state(view), size = dimensions(view);
    if (!s.explicitPivot) { s.pivotX = Math.fround(size.width / 2); s.pivotY = Math.fround(size.height / 2); }
    const key = [s.translationX, s.translationY, s.scaleX, s.scaleY, s.rotation, s.pivotX, s.pivotY].join(':');
    if (s.key !== key) {
      if (s.translationX === 0 && s.translationY === 0 && s.rotation === 0 && s.scaleX === 1 && s.scaleY === 1) s.values = IDENTITY.slice();
      else {
        s.matrix ??= makeMatrix(runtime);
        call(runtime, s.matrix, 'setTranslate', ['F', 'F'], 'V', [raw(s.translationX), raw(s.translationY)]);
        call(runtime, s.matrix, 'preRotate', ['F', 'F', 'F'], 'Z', [raw(s.rotation), raw(s.pivotX), raw(s.pivotY)]);
        call(runtime, s.matrix, 'preScale', ['F', 'F', 'F', 'F'], 'Z', [raw(s.scaleX), raw(s.scaleY), raw(s.pivotX), raw(s.pivotY)]);
        s.values = getMatrixValues(runtime, s.matrix);
      }
      s.key = key;
    }
    return s;
  };
  const publicMatrix = (runtime, receiver) => {
    const s = update(runtime, receiver); s.matrix ??= makeMatrix(runtime); s.buffer ??= runtime.newArray('[F', 9);
    runtime.array(s.buffer).elements = s.values.map(raw); call(runtime, s.matrix, 'setValues', ['[F'], 'V', [s.buffer]); return s.matrix;
  };
  return {
    supports: key => keys.has(key), parent: () => null,
    /** Makes the original RenderNode's hwui properties the single store of this View's transform/elevation. */
    bindRenderNode(runtime, receiver, nodeReference) {
      const view = runtime.object(receiver), s = state(view); if (s.boundNode === nodeReference?.ref) return;
      const target = renderNodeProperties(runtime, nodeReference);
      for (const key of ['translationX', 'translationY', 'scaleX', 'scaleY', 'rotation', 'pivotX', 'pivotY', 'elevation', 'translationZ']) {
        target[key] = s[key]; Object.defineProperty(s, key, { get: () => target[key], set: value => { target[key] = value; }, configurable: true, enumerable: true });
      }
      target.pivotExplicit = s.explicitPivot; Object.defineProperty(s, 'explicitPivot', { get: () => target.pivotExplicit, set: value => { target.pivotExplicit = value; }, configurable: true, enumerable: true });
      s.boundNode = nodeReference.ref; s.key = null;
    },
    snapshot(runtime, receiver) {
      if (!runtime.object(receiver).webTransform) return null;
      const values = update(runtime, receiver).values;
      return values.every((value, i) => value === IDENTITY[i]) ? null : values.slice();
    },
    /** HWUI-model shadow for a View with Z>0, drawn by the parent beneath the view: Skia SkShadowUtils
     * (CanvasKit drawShadow) over the original ViewOutlineProvider outline, light from renderLightInfo(). */
    shadow(runtime, receiver) {
      const view = runtime.object(receiver), s = view.webTransform, z = s ? Math.fround(s.elevation + s.translationZ) : 0;
      if (!(z > 0)) return null;
      const shape = platform.viewOutlineHost.shape(runtime, receiver), size = dimensions(view);
      if (!shape || !(shape.alpha > 0) || size.width <= 0 || size.height <= 0) return null;
      const light = renderLightInfo(runtime, size.width + 2 * Math.min(256, Math.ceil(z * 3 + 24)), view.context ?? runtime.activity);
      const alpha = Math.max(0, Math.min(1, (view.alpha ?? 1) * shape.alpha)), key = [z, size.width, size.height, shape.rect.join(','), shape.radius, shape.alpha, alpha, JSON.stringify(light)].join(':');
      if (s.shadowKey === key) return s.shadowValue;
      const CK = runtime.skia?.CanvasKit; if (!CK) fail('View shadows require verified Skia');
      const margin = Math.min(256, Math.ceil(z * 3 + 24)), width = size.width + margin * 2, height = size.height + margin * 2;
      if (width * height > 4 * 1024 * 1024) fail('View shadow raster exceeds the Skia VM limit');
      const surface = CK.MakeSurface(width, height); if (!surface) fail('View shadow surface allocation failed');
      try {
        const canvas = surface.getCanvas(), builder = new CK.PathBuilder(); canvas.clear(CK.TRANSPARENT);
        builder.addRRect(CK.RRectXY(shape.rect, shape.radius, shape.radius)); const path = builder.snapshot(); builder.delete();
        const color = a => CK.Color4f(0, 0, 0, a);
        canvas.translate(margin, margin);
        // Device-space light: horizontally centred over the view; y/z/radius/alphas as in HWUI.
        canvas.drawShadow(path, [0, 0, z], [margin + size.width / 2, margin + light.y, light.z], light.radius, color(light.ambientShadowAlpha * alpha), color(light.spotShadowAlpha * alpha), alpha < 1 ? 1 : 0);
        path.delete(); surface.flush();
        const image = surface.makeImageSnapshot();
        try {
          const png = image.encodeToBytes(CK.ImageFormat.PNG); let binary = ''; for (let at = 0; at < png.length; at += 32768) binary += String.fromCharCode(...png.subarray(at, at + 32768));
          s.shadowValue = { z, margin, width, height, dataURL: 'data:image/png;base64,' + btoa(binary), source: 'official-Skia-Wasm/SkShadowUtils' };
        } finally { image.delete(); }
      } finally { surface.dispose(); }
      s.shadowKey = key; return s.shadowValue;
    },
    invoke(runtime, method, args) {
      const receiver = args[0], view = runtime.object(receiver), name = method.name;
      if(name==='getElevation'||name==='getTranslationZ'||name==='getZ'){const z=view.webTransform;return raw(name==='getZ'?Math.fround((z?.elevation??0)+(z?.translationZ??0)):name==='getElevation'?(z?.elevation??0):(z?.translationZ??0));}
      if(name==='setElevation'||name==='setTranslationZ'||name==='setZ'){
        const value=number(args[1]);if(!Number.isFinite(value))fail('Non-finite View elevation is not supported');const z=state(view);
        if(name==='setElevation')z.elevation=value;else if(name==='setTranslationZ')z.translationZ=value;else z.translationZ=Math.fround(value-z.elevation);
        z.shadowKey=null;platform.requestDraw(runtime,receiver);return;
      }
      if (name === 'getMatrix') return publicMatrix(runtime, receiver);
      if (name === 'hasIdentityMatrix') return !view.webTransform || update(runtime, receiver).values.every((v, i) => v === IDENTITY[i]) ? 1 : 0;
      if (name === 'getInverseMatrix') {
        const matrix = publicMatrix(runtime, receiver), s = state(view); s.inverse ??= makeMatrix(runtime);
        // Android13 RenderNode JNI returns identity when inversion fails.
        if (!call(runtime, matrix, 'invert', [MATRIX], 'Z', [s.inverse])) call(runtime, s.inverse, 'reset');
        return s.inverse;
      }
      const s = state(view);
      if (name === 'isPivotSet') return s.explicitPivot ? 1 : 0;
      if (name === 'resetPivot') { s.explicitPivot = false; s.key = null; platform.requestDraw(runtime, receiver); return; }
      if (name.endsWith('RotationX') || name.endsWith('RotationY')) {
        if (name.startsWith('set') && number(args[1]) !== 0) fail('3D View rotation requires the original camera/perspective backend');
        return name.startsWith('get') ? raw(0) : undefined;
      }
      const suffix = name.slice(3), property = suffix[0].toLowerCase() + suffix.slice(1), size = dimensions(view);
      if (name.startsWith('get')) {
        if (property === 'x' || property === 'y') return raw(Math.fround(property === 'x' ? size.left + s.translationX : size.top + s.translationY));
        if (property === 'pivotX' || property === 'pivotY') update(runtime, receiver);
        return raw(s[property]);
      }
      const value = number(args[1]); if (!Number.isFinite(value)) fail('Non-finite View transform is not supported by the Skia/DOM boundary');
      if (property === 'x' || property === 'y') s[property === 'x' ? 'translationX' : 'translationY'] = Math.fround(value - (property === 'x' ? size.left : size.top));
      else {
        if (property === 'pivotX' || property === 'pivotY') { if (!s.explicitPivot) update(runtime, receiver); s.explicitPivot = true; }
        s[property] = value;
      }
      s.key = null; platform.requestDraw(runtime, receiver);
    },
  };
}
