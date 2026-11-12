// What a launcher shows for the installed app: the label and the icon of its launcher Activity (ResolveInfo/ActivityInfo.loadLabel and loadIcon, which fall back to the
// application's), read through the app's own PackageManager inside the VM. The icon is the Drawable drawn on a Bitmap and compressed as PNG by the VM's own codecs.
const CTX = 'Landroid/content/Context;', PM = 'Landroid/content/pm/PackageManager;', APP = 'Landroid/content/pm/ApplicationInfo;', ACT = 'Landroid/content/pm/ActivityInfo;', ITEM = 'Landroid/content/pm/PackageItemInfo;';
const COMPONENT = 'Landroid/content/ComponentName;', CHARS = 'Ljava/lang/CharSequence;', STRING = 'Ljava/lang/String;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;';
const BITMAP = 'Landroid/graphics/Bitmap;', CONFIG = 'Landroid/graphics/Bitmap$Config;', FORMAT = 'Landroid/graphics/Bitmap$CompressFormat;', CANVAS = 'Landroid/graphics/Canvas;', OUT = 'Ljava/io/ByteArrayOutputStream;', STREAM = 'Ljava/io/OutputStream;';
const ICON_PX = 192;

export function launcherInfo(runtime) {
  const r = runtime, nullish = v => v === null || v === undefined || v === 0;
  const call = (ref, owner, name, p = [], result = 'V', values = []) => r.dispatch({ owner, name, parameters: p, result, signature: `(${p.join('')})${result}` }, r.argumentWords(p, values, { receiver: ref }), 'virtual');
  const callStatic = (owner, name, p, result, values) => r.dispatch({ owner, name, parameters: p, result, signature: `(${p.join('')})${result}` }, r.argumentWords(p, values), 'static');
  const construct = (owner, p = [], values = []) => { const ref = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters: p, result: 'V', signature: `(${p.join('')})V` }, r.argumentWords(p, values, { receiver: ref }), 'direct'); return ref; };
  const staticField = (owner, name) => r.readStatic({ owner, name, type: owner, key: `${owner}->${name}:${owner}` });
  const text = cs => nullish(cs) ? '' : typeof cs === 'string' ? cs : r.stringCharacters(call(cs, 'Ljava/lang/Object;', 'toString', [], STRING));
  const context = r.platform?.application ?? r.application, packageName = r.platform?.packageName ?? '';
  const result = { packageName, label: packageName, icon: null, problems: [] };
  const steps = r.steps;
  try {
    // Before the app is started there is no Application yet: the PackageManager (which does not depend on one) answers for the installed package, as a launcher's own process would ask.
    const pm = nullish(context) ? (r.platform.packageManager ??= r.makeObject(PM)) : call(context, CTX, 'getPackageManager', [], PM);
    let item = nullish(context) ? call(pm, PM, 'getApplicationInfo', [STRING, 'I'], APP, [packageName, 0]) : call(context, CTX, 'getApplicationInfo', [], APP);
    const launcher = r.launcherActivity ? String(r.launcherActivity).replace(/^L|;$/g, '').replaceAll('/', '.') : null;
    if (launcher) { try { const info = call(pm, PM, 'getActivityInfo', [COMPONENT, 'I'], ACT, [construct(COMPONENT, [STRING, STRING], [packageName, launcher]), 0]); if (!nullish(info)) item = info; } catch (error) { result.problems.push(`getActivityInfo: ${error?.message ?? error}`.slice(0, 200)); } }
    try { const label = text(call(item, ITEM, 'loadLabel', [PM], CHARS, [pm])); if (label) result.label = label; } catch (error) { result.problems.push(`loadLabel: ${error?.message ?? error}`.slice(0, 200)); }
    try {
      const drawable = call(item, ITEM, 'loadIcon', [PM], DRAWABLE, [pm]);
      const bitmap = callStatic(BITMAP, 'createBitmap', ['I', 'I', CONFIG], BITMAP, [ICON_PX, ICON_PX, staticField(CONFIG, 'ARGB_8888')]), canvas = construct(CANVAS, [BITMAP], [bitmap]);
      call(drawable, DRAWABLE, 'setBounds', ['I', 'I', 'I', 'I'], 'V', [0, 0, ICON_PX, ICON_PX]); call(drawable, DRAWABLE, 'draw', [CANVAS], 'V', [canvas]);
      const out = construct(OUT); call(bitmap, BITMAP, 'compress', [FORMAT, 'I', STREAM], 'Z', [staticField(FORMAT, 'PNG'), 100, out]);
      const bytes = r.bytesOf(call(out, OUT, 'toByteArray', [], '[B'));
      result.icon = { mime: 'image/png', bytes: Uint8Array.from(bytes), size: ICON_PX };
    } catch (error) { result.problems.push(`loadIcon: ${error?.message ?? error}`.slice(-420)); }
  } catch (error) { result.problems.push(String(error?.message ?? error).slice(-420)); }
  finally { r.steps = steps; }
  // What the package itself declares, read without running anything (the app may not have been started yet, or its icon Drawable may need what is not there before it starts):
  // the label string of the launcher Activity or the application, and the icon when it is an image file (the variant for the device's density).
  const manifest = r.platform?.manifest ?? {}, application = manifest.application ?? {}, launcherName = r.launcherActivity ? String(r.launcherActivity).replace(/^L|;$/g, '').replaceAll('/', '.') : null;
  const activity = (manifest.activities ?? application.activities ?? []).find(entry => entry?.name === launcherName) ?? null;
  if (result.label === packageName) {
    try { let label = activity?.label ?? application.label; if (typeof label === 'number') { let value = r.platform.resources.resolve(label >>> 0); while (value?.resolved) value = value.resolved; label = typeof value?.value === 'string' ? value.value : null; } if (typeof label === 'string' && label) { result.label = label; result.problems = result.problems.filter(problem => !/^(loadLabel|getActivityInfo)/.test(problem)); } }
    catch (error) { result.problems.push(`label: ${error?.message ?? error}`.slice(0, 200)); }
  }
  if (result.icon === null) {
    try {
      const id = [activity?.icon, application.icon, application.roundIcon].find(value => typeof value === 'number' && value), file = id ? r.platform.bitmapCodec?.resourceFile?.(r, id >>> 0) : null, extension = /\.(png|jpe?g|webp|gif)$/i.exec(file?.path ?? '')?.[1]?.toLowerCase();
      if (extension && r.apkReader) { result.icon = { mime: extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`, bytes: Uint8Array.from(r.apkReader(file.path)), size: null, source: 'file' }; result.problems = result.problems.filter(problem => !problem.startsWith('loadIcon')); }
    } catch (error) { result.problems.push(`icon file: ${error?.message ?? error}`.slice(0, 200)); }
  }
  return result;
}
