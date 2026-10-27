import { gcRoot } from './heap-gc.js?v=33d211b8a989';
import { createHostRegistry } from './host-contract.js?v=33d211b8a989';

// android.widget.ImageView members that the drawable-view-host does not cover: the ScaleType enum (getScaleType / setScaleType, ordinal = the XML android:scaleType value that
// drawable-view-host already honours when drawing) and setImageBitmap (ImageView wraps the Bitmap in a BitmapDrawable, android-13.0.0_r1 ImageView.setImageBitmap).
const IMAGE = 'Landroid/widget/ImageView;', SCALE_TYPE = 'Landroid/widget/ImageView$ScaleType;', ENUM = 'Ljava/lang/Enum;', BITMAP = 'Landroid/graphics/Bitmap;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;', BITMAP_DRAWABLE = 'Landroid/graphics/drawable/BitmapDrawable;', STRING = 'Ljava/lang/String;';
const NAMES = ['MATRIX', 'FIT_XY', 'FIT_START', 'FIT_CENTER', 'FIT_END', 'CENTER', 'CENTER_CROP', 'CENTER_INSIDE'];

export function createImageViewHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(SCALE_TYPE, ENUM);
  const values = new WeakMap();
  const scaleType = (r, name) => {
    const table = values.get(r) ?? values.set(r, gcRoot(new Map())).get(r);
    if (!table.has(name)) { const ref = r.makeObject(SCALE_TYPE), o = r.object(ref); o.enumName = name; o.enumOrdinal = NAMES.indexOf(name); r.storeField(o.fields, `${SCALE_TYPE}->nativeInt:I`, NAMES.indexOf(name)); table.set(name, ref); }
    return table.get(name);
  };
  for (const name of NAMES) registry.staticField(SCALE_TYPE, name, SCALE_TYPE, r => scaleType(r, name));
  def(SCALE_TYPE, 'values', `()[${SCALE_TYPE}`, r => { const a = r.newArray(`[${SCALE_TYPE}`, NAMES.length); r.array(a).elements = NAMES.map(n => scaleType(r, n)); return a; }, { static: true });
  def(SCALE_TYPE, 'valueOf', `(${STRING})${SCALE_TYPE}`, (r, _m, [name]) => { const n = r.stringCharacters(name); if (!NAMES.includes(n)) r.throwJava('Ljava/lang/IllegalArgumentException;', `No enum constant android.widget.ImageView.ScaleType.${n}`); return scaleType(r, n); }, { static: true });
  const call = (r, receiver, owner, name, parameters, result, args) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  def(IMAGE, 'getScaleType', `()${SCALE_TYPE}`, (r, _m, [self]) => scaleType(r, NAMES[r.object(self).imageScaleType ?? 3]));
  def(IMAGE, 'setScaleType', `(${SCALE_TYPE})V`, (r, _m, [self, type_]) => {
    if (type_ === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    const view = r.object(self), next = r.object(type_).enumOrdinal;
    if ((view.imageScaleType ?? 3) === next) return;
    view.imageScaleType = next;
    if (view.imageDrawable) call(r, self, 'Landroid/view/View;', 'invalidateDrawable', [DRAWABLE], 'V', [view.imageDrawable]); else platform.requestDraw(r, self);
  });
  def(IMAGE, 'setImageBitmap', `(${BITMAP})V`, (r, _m, [self, bitmap]) => {
    const drawable = r.allocate(BITMAP_DRAWABLE);
    r.dispatch({ owner: BITMAP_DRAWABLE, name: '<init>', parameters: ['Landroid/content/res/Resources;', BITMAP], result: 'V', signature: `(Landroid/content/res/Resources;${BITMAP})V` }, [drawable, null, bitmap], 'direct');
    call(r, self, IMAGE, 'setImageDrawable', [DRAWABLE], 'V', [bitmap === null ? null : drawable]);
  });
  return { ...registry, interfaces: registry.interfacesOf };
}
