import { createHostRegistry } from './host-contract.js?v=99056e83c7d5';
import { APKError } from './apk-error.js?v=99056e83c7d5';

// android.widget.RemoteViews (android-13.0.0_r1 RemoteViews.java) for the virtual device: a description of a view hierarchy (a layout of an installed package) plus a list of actions
// ("set this property on the view with this id"). apply(Context, ViewGroup) inflates the layout with the LayoutInflater and runs the actions in order on the inflated views; reapply runs them on an
// existing hierarchy. Like the framework, the property setters of the generic setInt / setBoolean / ... calls are the named public methods of the target View, looked up by the argument type;
// the typed helpers (setViewVisibility, setTextViewText, setImageViewResource, setProgressBar, ...) are the framework's own method mappings. Layout selection by orientation / size, async apply,
// the action parceling and the RemoteViews.OnClickHandler are not modelled; the package must be this app (the device has no other package to inflate from).
const RV = 'Landroid/widget/RemoteViews;', VIEW = 'Landroid/view/View;', GROUP = 'Landroid/view/ViewGroup;', CONTEXT = 'Landroid/content/Context;', STRING = 'Ljava/lang/String;', CHARS = 'Ljava/lang/CharSequence;';
const PENDING = 'Landroid/app/PendingIntent;', BITMAP = 'Landroid/graphics/Bitmap;', URI = 'Landroid/net/Uri;', ICON = 'Landroid/graphics/drawable/Icon;', INFLATER = 'Landroid/view/LayoutInflater;';
const TEXT = 'Landroid/widget/TextView;', IMAGE = 'Landroid/widget/ImageView;', PROGRESS = 'Landroid/widget/ProgressBar;', LISTENER = 'Ldev/apkweb/view/PendingIntentClickListener;', CLICK = 'Landroid/view/View$OnClickListener;';
const nullish = v => v === null || v === undefined || v === 0;
const TYPES = { Byte: 'B', Short: 'S', Int: 'I', Long: 'J', Float: 'F', Double: 'D', Boolean: 'Z', Char: 'C', String: STRING, CharSequence: CHARS, Uri: URI, Bitmap: BITMAP, Bundle: 'Landroid/os/Bundle;', Intent: 'Landroid/content/Intent;', Icon: ICON };

export function createRemoteViewsHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(RV, 'Ljava/lang/Object;', ['Landroid/os/Parcelable;'], { allocatable: true });
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, args, 'static');
  const construct = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, [o, ...args], 'direct'); return o; };
  const state = (r, self) => r.object(self).remote ?? r.throwJava('Ljava/lang/IllegalStateException;', 'RemoteViews used before construction');
  const npe = (r, m = null) => r.throwJava('Ljava/lang/NullPointerException;', m);
  const text = (r, v) => nullish(v) ? null : typeof v === 'string' ? v : r.stringCharacters(v);
  const init = (r, self, pkg, layoutId) => { if (nullish(pkg)) npe(r, 'packageName'); r.object(self).remote = { pkg: text(r, pkg), layoutId, actions: [] }; };
  const add = (r, self, action) => { state(r, self).actions.push(action); };
  def(RV, '<init>', `(${STRING}I)V`, (r, _m, [self, pkg, layoutId]) => init(r, self, pkg, layoutId));
  def(RV, '<init>', `(${RV})V`, (r, _m, [self, source]) => { if (nullish(source)) npe(r); const s = state(r, source); r.object(self).remote = { pkg: s.pkg, layoutId: s.layoutId, actions: [...s.actions] }; });
  def(RV, '<init>', `(${RV}${RV})V`, (r, _m, [self, landscape, portrait]) => { if (nullish(landscape) || nullish(portrait)) npe(r, 'Both RemoteViews must be non-null'); const s = state(r, portrait); r.object(self).remote = { pkg: s.pkg, layoutId: s.layoutId, actions: [...s.actions] }; });   // portrait layout: the lab device picks by its orientation at apply time only through the layout resources
  def(RV, 'clone', `()${RV}`, (r, _m, [self]) => { const copy = r.allocate(RV), s = state(r, self); r.object(copy).remote = { pkg: s.pkg, layoutId: s.layoutId, actions: [...s.actions] }; return copy; });
  def(RV, 'clone', '()Ljava/lang/Object;', (r, _m, [self]) => { const copy = r.allocate(RV), s = state(r, self); r.object(copy).remote = { pkg: s.pkg, layoutId: s.layoutId, actions: [...s.actions] }; return copy; });
  def(RV, 'getPackage', `()${STRING}`, (r, _m, [self]) => state(r, self).pkg);
  def(RV, 'getLayoutId', '()I', (r, _m, [self]) => state(r, self).layoutId);
  def(RV, 'describeContents', '()I', () => 0);
  def(RV, 'setViewVisibility', '(II)V', (r, _m, [self, id, value]) => add(r, self, { id, call: (r2, v) => call(r2, v, VIEW, 'setVisibility', ['I'], 'V', [value]) }));
  def(RV, 'setTextViewText', `(I${CHARS})V`, (r, _m, [self, id, value]) => add(r, self, { id, call: (r2, v) => call(r2, v, TEXT, 'setText', [CHARS], 'V', [value]) }));
  def(RV, 'setTextViewTextSize', '(IIF)V', (r, _m, [self, id, unit, size]) => add(r, self, { id, call: (r2, v) => call(r2, v, TEXT, 'setTextSize', ['I', 'F'], 'V', [unit, size]) }));
  def(RV, 'setTextColor', '(II)V', (r, _m, [self, id, color]) => add(r, self, { id, call: (r2, v) => call(r2, v, TEXT, 'setTextColor', ['I'], 'V', [color]) }));
  def(RV, 'setImageViewResource', '(II)V', (r, _m, [self, id, res]) => add(r, self, { id, call: (r2, v) => call(r2, v, IMAGE, 'setImageResource', ['I'], 'V', [res]) }));
  def(RV, 'setImageViewBitmap', `(I${BITMAP})V`, (r, _m, [self, id, bitmap]) => add(r, self, { id, call: (r2, v) => call(r2, v, IMAGE, 'setImageBitmap', [BITMAP], 'V', [bitmap]) }));
  def(RV, 'setImageViewUri', `(I${URI})V`, (r, _m, [self, id, uri]) => add(r, self, { id, call: (r2, v) => call(r2, v, IMAGE, 'setImageURI', [URI], 'V', [uri]) }));
  def(RV, 'setImageViewIcon', `(I${ICON})V`, (r, _m, [self, id, icon]) => add(r, self, { id, call: (r2, v) => call(r2, v, IMAGE, 'setImageIcon', [ICON], 'V', [icon]) }));
  def(RV, 'setProgressBar', '(IIIZ)V', (r, _m, [self, id, max, progress, indeterminate]) => add(r, self, { id, call: (r2, v) => { call(r2, v, PROGRESS, 'setIndeterminate', ['Z'], 'V', [indeterminate]); if (!indeterminate) { call(r2, v, PROGRESS, 'setMax', ['I'], 'V', [max]); call(r2, v, PROGRESS, 'setProgress', ['I'], 'V', [progress]); } } }));
  def(RV, 'setViewPadding', '(IIIII)V', (r, _m, [self, id, left, top, right, bottom]) => add(r, self, { id, call: (r2, v) => call(r2, v, VIEW, 'setPadding', ['I', 'I', 'I', 'I'], 'V', [left, top, right, bottom]) }));
  def(RV, 'setContentDescription', `(I${CHARS})V`, (r, _m, [self, id, value]) => add(r, self, { id, call: (r2, v) => call(r2, v, VIEW, 'setContentDescription', [CHARS], 'V', [value]) }));
  def(RV, 'setLabelFor', '(II)V', (r, _m, [self, id, labeled]) => add(r, self, { id, call: (r2, v) => call(r2, v, VIEW, 'setLabelFor', ['I'], 'V', [labeled]) }));
  def(RV, 'setOnClickPendingIntent', `(I${PENDING})V`, (r, _m, [self, id, intent]) => add(r, self, { id, call: (r2, v) => call(r2, v, VIEW, 'setOnClickListener', [CLICK], 'V', [nullish(intent) ? null : construct(r2, LISTENER, [PENDING], [intent])]) }));
  def(RV, 'setBoolean', `(I${STRING}Z)V`, (r, _m, [self, id, method, value]) => reflected(r, self, id, method, 'Z', value));
  for (const [suffix, descriptor] of Object.entries(TYPES)) def(RV, `set${suffix}`, `(I${STRING}${descriptor})V`, (r, _m, [self, id, method, value]) => reflected(r, self, id, method, descriptor, value));
  const reflected = (r, self, id, method, descriptor, value) => {
    if (nullish(method)) npe(r, 'methodName'); const name = text(r, method);
    add(r, self, { id, call: (r2, v) => {
      const owner = r2.object(v).type, parameters = [descriptor];
      try { r2.dispatch({ owner, name, parameters, result: 'V', signature: `(${descriptor})V` }, [v, value], 'virtual'); }
      catch (error) { if (error?.name === 'JavaException') throw error; throw new APKError(`RemoteViews: ${owner}.${name}(${descriptor}) is not a setter this view provides (${error.message})`, { kind: 'remote-views-action' }); }
    } });
  };
  def(RV, 'addView', `(I${RV})V`, (r, _m, [self, id, nested]) => add(r, self, { id, call: (r2, v, context) => call(r2, v, GROUP, 'addView', [VIEW], 'V', [apply(r2, nested, context, v, false)]) }));
  def(RV, 'removeAllViews', '(I)V', (r, _m, [self, id]) => add(r, self, { id, call: (r2, v) => call(r2, v, GROUP, 'removeAllViews', [], 'V') }));
  const apply = (r, self, context, parent, attach = true) => {
    if (nullish(context)) npe(r, 'context'); const s = state(r, self);
    if (s.pkg !== platform.packageName) r.throwJava('Landroid/view/InflateException;', `RemoteViews package ${s.pkg} is not installed on the virtual device`);
    const inflater = callStatic(r, INFLATER, 'from', [CONTEXT], INFLATER, [context]);
    const root = call(r, inflater, INFLATER, 'inflate', ['I', GROUP, 'Z'], VIEW, [s.layoutId, parent ?? null, 0]);
    reapply(r, self, context, root);
    return root;
  };
  const reapply = (r, self, context, root) => {
    for (const action of state(r, self).actions) {
      const target = call(r, root, VIEW, 'findViewById', ['I'], VIEW, [action.id]);
      if (nullish(target)) continue;   // RemoteViews actions on a missing id are skipped by ViewGroupActionAdd / setter actions alike ("view not found" log)
      action.call(r, target, context);
    }
  };
  def(RV, 'apply', `(${CONTEXT}${GROUP})${VIEW}`, (r, _m, [self, context, parent]) => apply(r, self, context, parent));
  def(RV, 'apply', `(${CONTEXT}${GROUP}Landroid/widget/RemoteViews$OnClickHandler;)${VIEW}`, (r, _m, [self, context, parent]) => apply(r, self, context, parent));
  def(RV, 'reapply', `(${CONTEXT}${VIEW})V`, (r, _m, [self, context, view]) => { if (nullish(view)) npe(r); reapply(r, self, context, view); });
  def(RV, 'reapply', `(${CONTEXT}${VIEW}Landroid/widget/RemoteViews$OnClickHandler;)V`, (r, _m, [self, context, view]) => reapply(r, self, context, view));
  def(RV, 'hasSameAppInfo', '(Landroid/content/pm/ApplicationInfo;)Z', () => 1);
  def(RV, 'isReapplyDisallowed', '()Z', () => 0);
  def(RV, 'setLightBackgroundLayoutId', '(I)V', () => {});
  return registry;
}
