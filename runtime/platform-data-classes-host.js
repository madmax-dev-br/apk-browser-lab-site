import { createHostRegistry } from './host-contract.js?v=24a8d21a01ce';
import { APKError } from './apk-error.js?v=24a8d21a01ce';

// Data classes of the platform API that apps build and hand back to the framework: android.app.RemoteInput (+Builder), android.location.Address and
// android.app.ActivityOptions. Validation follows android-13.0.0_r1 (RemoteInput.Builder / ActivityOptions); the values are held as the app set them. RemoteInput results travel in
// the Intent extra "android.remoteinput.resultsData" like the framework's, so getResultsFromIntent / addResultsToIntent round-trip. ActivityOptions.toBundle carries the android:activity.* keys the
// framework would read; the virtual device does not animate or place activities from them (single task, no window animations), which the options object says.
const STRING = 'Ljava/lang/String;', CHARS = 'Ljava/lang/CharSequence;', OBJECT = 'Ljava/lang/Object;', BUNDLE = 'Landroid/os/Bundle;', INTENT = 'Landroid/content/Intent;', PENDING = 'Landroid/app/PendingIntent;', ICON = 'Landroid/graphics/drawable/Icon;';
const RI = 'Landroid/app/RemoteInput;', RIB = 'Landroid/app/RemoteInput$Builder;', ADDRESS = 'Landroid/location/Address;', AO = 'Landroid/app/ActivityOptions;';
const nullish = v => v === null || v === undefined || v === 0;
const RESULTS_KEY = 'android.remoteinput.resultsData', RESULTS_SOURCE_KEY = 'android.remoteinput.resultsSource';

export function createPlatformDataClassesHost(platform) {
  const registry = createHostRegistry(), { def, type, staticField } = registry;
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const construct = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: o }), 'direct'); return o; };
  const npe = (r, m = null) => r.throwJava('Ljava/lang/NullPointerException;', m);
  const ise = (r, m) => r.throwJava('Ljava/lang/IllegalStateException;', m);
  const iae = (r, m) => r.throwJava('Ljava/lang/IllegalArgumentException;', m);
  const text = (r, v) => nullish(v) ? null : typeof v === 'string' ? v : r.stringCharacters(v);
  const unsupported = (message, kind) => { throw new APKError(message, { kind }); };
  const bundle = r => construct(r, BUNDLE, [], []);
  for (const t of [RI, RIB, ADDRESS, AO]) type(t, OBJECT, t === RI || t === ADDRESS ? ['Landroid/os/Parcelable;'] : [], { allocatable: t === RIB || t === ADDRESS });

  // ---- RemoteInput -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const ri = (r, self) => r.object(self).input;
  const rb = (r, self) => r.object(self).builder;
  staticField(RI, 'RESULTS_CLIP_LABEL', STRING, () => 'android.remoteinput.results'); staticField(RI, 'EXTRA_RESULTS_DATA', STRING, () => RESULTS_KEY); staticField(RI, 'EXTRA_RESULTS_SOURCE', STRING, () => RESULTS_SOURCE_KEY);
  staticField(RI, 'SOURCE_FREE_FORM_INPUT', 'I', () => 0); staticField(RI, 'SOURCE_CHOICE', 'I', () => 1);
  staticField(RI, 'EDIT_CHOICES_BEFORE_SENDING_AUTO', 'I', () => 0); staticField(RI, 'EDIT_CHOICES_BEFORE_SENDING_DISABLED', 'I', () => 1); staticField(RI, 'EDIT_CHOICES_BEFORE_SENDING_ENABLED', 'I', () => 2);
  def(RIB, '<init>', `(${STRING})V`, (r, _m, [self, key]) => { if (nullish(key)) npe(r, 'resultKey'); r.object(self).builder = { resultKey: text(r, key), label: null, choices: null, allowFreeForm: true, extras: null, dataTypes: new Map(), editChoices: 0 }; });
  def(RIB, 'setLabel', `(${CHARS})${RIB}`, (r, _m, [self, label]) => { rb(r, self).label = nullish(label) ? null : label; return self; });
  def(RIB, 'setChoices', `([${CHARS})${RIB}`, (r, _m, [self, choices]) => { rb(r, self).choices = nullish(choices) ? null : choices; return self; });
  def(RIB, 'setAllowFreeFormInput', `(Z)${RIB}`, (r, _m, [self, allow]) => { rb(r, self).allowFreeForm = !!allow; return self; });
  def(RIB, 'setAllowDataType', `(${STRING}Z)${RIB}`, (r, _m, [self, mime, allow]) => { if (nullish(mime)) npe(r, 'mimeType'); rb(r, self).dataTypes.set(text(r, mime), !!allow); return self; });
  def(RIB, 'setEditChoicesBeforeSending', `(I)${RIB}`, (r, _m, [self, mode]) => { if (mode < 0 || mode > 2) iae(r, `Invalid value for editChoicesBeforeSending: ${mode}`); rb(r, self).editChoices = mode; return self; });
  def(RIB, 'addExtras', `(${BUNDLE})${RIB}`, (r, _m, [self, extras]) => { if (!nullish(extras)) { const b = rb(r, self); if (nullish(b.extras)) b.extras = bundle(r); call(r, b.extras, BUNDLE, 'putAll', [BUNDLE], 'V', [extras]); } return self; });
  def(RIB, 'getExtras', `()${BUNDLE}`, (r, _m, [self]) => { const b = rb(r, self); if (nullish(b.extras)) b.extras = bundle(r); return b.extras; });
  def(RIB, 'build', `()${RI}`, (r, _m, [self]) => {
    const b = rb(r, self), allowed = [...b.dataTypes].filter(([, v]) => v).map(([k]) => k);
    if (!b.allowFreeForm && (nullish(b.choices) || r.array(b.choices).elements.length === 0) && allowed.length === 0) ise(r, 'A RemoteInput must allow free-form input, offer choices or allow a data type');
    const o = r.makeObject(RI); r.object(o).input = { ...b, allowedDataTypes: allowed, extras: nullish(b.extras) ? bundle(r) : b.extras }; return o;
  });
  def(RI, 'getResultKey', `()${STRING}`, (r, _m, [self]) => ri(r, self).resultKey); def(RI, 'getLabel', `()${CHARS}`, (r, _m, [self]) => ri(r, self).label);
  def(RI, 'getChoices', `()[${CHARS}`, (r, _m, [self]) => ri(r, self).choices); def(RI, 'getAllowFreeFormInput', '()Z', (r, _m, [self]) => ri(r, self).allowFreeForm ? 1 : 0);
  def(RI, 'getEditChoicesBeforeSending', '()I', (r, _m, [self]) => ri(r, self).editChoices); def(RI, 'getExtras', `()${BUNDLE}`, (r, _m, [self]) => ri(r, self).extras);
  def(RI, 'isDataOnly', '()Z', (r, _m, [self]) => { const i = ri(r, self); return !i.allowFreeForm && (nullish(i.choices) || r.array(i.choices).elements.length === 0) && i.allowedDataTypes.length > 0 ? 1 : 0; });
  def(RI, 'getAllowedDataTypes', '()Ljava/util/Set;', (r, _m, [self]) => { const set = construct(r, 'Ljava/util/HashSet;', [], []); for (const t of ri(r, self).allowedDataTypes) call(r, set, 'Ljava/util/HashSet;', 'add', [OBJECT], 'Z', [t]); return set; });
  def(RI, 'describeContents', '()I', () => 0);
  def(RI, 'getResultsFromIntent', `(${INTENT})${BUNDLE}`, (r, _m, [intent]) => { if (nullish(intent)) npe(r, 'intent'); return call(r, intent, INTENT, 'getBundleExtra', [STRING], BUNDLE, [RESULTS_KEY]); }, { static: true });
  def(RI, 'addResultsToIntent', `([${RI}${INTENT}${BUNDLE})V`, (r, _m, [inputs, intent, results]) => {
    if (nullish(inputs) || nullish(intent) || nullish(results)) npe(r); const merged = bundle(r);
    for (const input of r.array(inputs).elements) { const key = ri(r, input).resultKey; if (call(r, results, BUNDLE, 'containsKey', [STRING], 'Z', [key])) call(r, merged, BUNDLE, 'putCharSequence', [STRING, CHARS], 'V', [key, call(r, results, BUNDLE, 'getCharSequence', [STRING], CHARS, [key])]); }
    call(r, intent, INTENT, 'putExtra', [STRING, BUNDLE], INTENT, [RESULTS_KEY, merged]);
  }, { static: true });
  def(RI, 'setResultsSource', `(${INTENT}I)V`, (r, _m, [intent, source]) => { call(r, intent, INTENT, 'putExtra', [STRING, 'I'], INTENT, [RESULTS_SOURCE_KEY, source]); }, { static: true });
  def(RI, 'getResultsSource', `(${INTENT})I`, (r, _m, [intent]) => call(r, intent, INTENT, 'getIntExtra', [STRING, 'I'], 'I', [RESULTS_SOURCE_KEY, 0]), { static: true });
  def(RI, 'addDataResultToIntent', `(${RI}${INTENT}Ljava/util/Map;)V`, () => unsupported('RemoteInput.addDataResultToIntent: data (URI) results are not modelled', 'remote-input-data-unsupported'), { static: true });
  def(RI, 'getDataResultsFromIntent', `(${INTENT}${STRING})Ljava/util/Map;`, () => null, { static: true });


  // ---- android.location.Address ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const ad = (r, self) => r.object(self).address ??= { locale: null, lines: new Map(), lat: null, lon: null, extras: null, props: {} };
  def(ADDRESS, '<init>', '(Ljava/util/Locale;)V', (r, _m, [self, locale]) => { ad(r, self).locale = locale; });
  def(ADDRESS, 'getLocale', '()Ljava/util/Locale;', (r, _m, [self]) => ad(r, self).locale);
  for (const [prop, name] of [['adminArea', 'AdminArea'], ['subAdminArea', 'SubAdminArea'], ['locality', 'Locality'], ['subLocality', 'SubLocality'], ['thoroughfare', 'Thoroughfare'], ['subThoroughfare', 'SubThoroughfare'], ['premises', 'Premises'], ['postalCode', 'PostalCode'], ['countryCode', 'CountryCode'], ['countryName', 'CountryName'], ['featureName', 'FeatureName'], ['phone', 'Phone'], ['url', 'Url']]) {
    def(ADDRESS, `get${name}`, `()${STRING}`, (r, _m, [self]) => ad(r, self).props[prop] ?? null); def(ADDRESS, `set${name}`, `(${STRING})V`, (r, _m, [self, v]) => { ad(r, self).props[prop] = nullish(v) ? null : v; });
  }
  def(ADDRESS, 'getMaxAddressLineIndex', '()I', (r, _m, [self]) => { const keys = [...ad(r, self).lines.keys()]; return keys.length ? Math.max(...keys) : -1; });
  def(ADDRESS, 'getAddressLine', `(I)${STRING}`, (r, _m, [self, i]) => { if (i < 0) iae(r, `index = ${i} < 0`); return ad(r, self).lines.get(i) ?? null; });
  def(ADDRESS, 'setAddressLine', `(I${STRING})V`, (r, _m, [self, i, line]) => { if (i < 0) iae(r, `index = ${i} < 0`); if (nullish(line)) ad(r, self).lines.delete(i); else ad(r, self).lines.set(i, line); });
  def(ADDRESS, 'hasLatitude', '()Z', (r, _m, [self]) => ad(r, self).lat !== null ? 1 : 0); def(ADDRESS, 'hasLongitude', '()Z', (r, _m, [self]) => ad(r, self).lon !== null ? 1 : 0);
  def(ADDRESS, 'getLatitude', '()D', (r, _m, [self]) => { if (ad(r, self).lat === null) ise(r, 'latitude == null'); return ad(r, self).lat; }); def(ADDRESS, 'getLongitude', '()D', (r, _m, [self]) => { if (ad(r, self).lon === null) ise(r, 'longitude == null'); return ad(r, self).lon; });
  def(ADDRESS, 'setLatitude', '(D)V', (r, _m, [self, v]) => { ad(r, self).lat = v; }); def(ADDRESS, 'setLongitude', '(D)V', (r, _m, [self, v]) => { ad(r, self).lon = v; });
  def(ADDRESS, 'clearLatitude', '()V', (r, _m, [self]) => { ad(r, self).lat = null; }); def(ADDRESS, 'clearLongitude', '()V', (r, _m, [self]) => { ad(r, self).lon = null; });
  def(ADDRESS, 'getExtras', `()${BUNDLE}`, (r, _m, [self]) => ad(r, self).extras); def(ADDRESS, 'setExtras', `(${BUNDLE})V`, (r, _m, [self, extras]) => { ad(r, self).extras = nullish(extras) ? null : extras; });
  def(ADDRESS, 'describeContents', '()I', () => 0);
  def(ADDRESS, 'toString', `()${STRING}`, (r, _m, [self]) => { const a = ad(r, self), lines = [...a.lines.entries()].sort(([x], [y]) => x - y); return `Address[addressLines=[${lines.map(([i, l]) => `${i}:"${l}"`).join(',')}],feature=${a.props.featureName ?? null},admin=${a.props.adminArea ?? null},sub-admin=${a.props.subAdminArea ?? null},locality=${a.props.locality ?? null},thoroughfare=${a.props.thoroughfare ?? null},postalCode=${a.props.postalCode ?? null},countryCode=${a.props.countryCode ?? null},countryName=${a.props.countryName ?? null},hasLatitude=${a.lat !== null},hasLongitude=${a.lon !== null},phone=${a.props.phone ?? null},url=${a.props.url ?? null},extras=${a.extras ?? null}]`; });

  // ---- ActivityOptions ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const opt = (r, self) => r.object(self).options ??= { kind: 'basic', bounds: null, bgAllowed: null, bgMode: 0, extras: {} };
  const make = (r, kind, extras = {}) => { const o = r.makeObject(AO); r.object(o).options = { kind, bounds: null, bgAllowed: null, bgMode: 0, extras }; return o; };
  const VIEWN = 'Landroid/view/View;', CONTEXT = 'Landroid/content/Context;';
  def(AO, 'makeBasic', `()${AO}`, r => make(r, 'basic'), { static: true });
  def(AO, 'makeCustomAnimation', `(${CONTEXT}II)${AO}`, (r, _m, [, enter, exit]) => make(r, 'custom', { enterResId: enter, exitResId: exit }), { static: true });
  def(AO, 'makeScaleUpAnimation', `(${VIEWN}IIII)${AO}`, (r, _m, [, , x, y, w, h]) => make(r, 'scale-up', { startX: x, startY: y, width: w, height: h }), { static: true });
  def(AO, 'makeClipRevealAnimation', `(${VIEWN}IIII)${AO}`, (r, _m, [, , x, y, w, h]) => make(r, 'clip-reveal', { startX: x, startY: y, width: w, height: h }), { static: true });
  def(AO, 'makeThumbnailScaleUpAnimation', `(${VIEWN}Landroid/graphics/Bitmap;II)${AO}`, (r, _m, [, , , x, y]) => make(r, 'thumbnail', { startX: x, startY: y }), { static: true });
  def(AO, 'makeTaskLaunchBehind', `()${AO}`, r => make(r, 'launch-behind'), { static: true });
  def(AO, 'makeSceneTransitionAnimation', `(Landroid/app/Activity;${VIEWN}${STRING})${AO}`, () => unsupported('ActivityOptions.makeSceneTransitionAnimation: shared-element activity transitions are not modelled (single task, no window transitions)', 'scene-transition-unsupported'), { static: true });
  def(AO, 'makeSceneTransitionAnimation', `(Landroid/app/Activity;[Landroid/util/Pair;)${AO}`, () => unsupported('ActivityOptions.makeSceneTransitionAnimation: shared-element activity transitions are not modelled (single task, no window transitions)', 'scene-transition-unsupported'), { static: true });
  def(AO, 'setLaunchBounds', `(Landroid/graphics/Rect;)${AO}`, (r, _m, [self, rect]) => { opt(r, self).bounds = nullish(rect) ? null : rect; return self; });
  def(AO, 'getLaunchBounds', '()Landroid/graphics/Rect;', (r, _m, [self]) => opt(r, self).bounds);
  def(AO, 'setPendingIntentBackgroundActivityLaunchAllowed', '(Z)V', (r, _m, [self, v]) => { opt(r, self).bgAllowed = !!v; }); def(AO, 'isPendingIntentBackgroundActivityLaunchAllowed', '()Z', (r, _m, [self]) => opt(r, self).bgAllowed === false ? 0 : 1);
  def(AO, 'setPendingIntentBackgroundActivityStartMode', `(I)${AO}`, (r, _m, [self, mode]) => { if (mode < 0 || mode > 2) iae(r, `Invalid background activity start mode: ${mode}`); opt(r, self).bgMode = mode; return self; });
  def(AO, 'getPendingIntentBackgroundActivityStartMode', '()I', (r, _m, [self]) => opt(r, self).bgMode);
  def(AO, 'requestUsageTimeReport', `(${PENDING})V`, (r, _m, [, intent]) => { if (nullish(intent)) npe(r); });
  def(AO, 'update', `(${AO})V`, (r, _m, [self, other]) => { if (nullish(other)) npe(r); Object.assign(opt(r, self), { ...opt(r, other), extras: { ...opt(r, self).extras, ...opt(r, other).extras } }); });
  def(AO, 'toBundle', `()${BUNDLE}`, (r, _m, [self]) => {
    const o = opt(r, self), b = bundle(r), put = (key, value) => call(r, b, BUNDLE, 'putInt', [STRING, 'I'], 'V', [key, value]);
    const type = { basic: 0, custom: 1, scale: 2, 'scale-up': 2, thumbnail: 3, 'clip-reveal': 11, 'launch-behind': 0 }[o.kind] ?? 0;
    put('android:activity.animType', type); for (const [k, v] of Object.entries(o.extras)) put(`android:activity.${k}`, v);
    if (o.bgMode) put('android.pendingIntent.backgroundActivityAllowed', o.bgMode); return b;
  });
  def(AO, 'getAnimationType', '()I', (r, _m, [self]) => ({ basic: 0, custom: 1, 'scale-up': 2, thumbnail: 3, 'clip-reveal': 11 }[opt(r, self).kind] ?? 0));
  return registry;
}
