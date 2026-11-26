import { APKError } from './apk-runtime.js?v=858dc45125cc';
import { createWidgetStateHost } from './widget-state-host.js?v=858dc45125cc';
import { gcRoot } from './heap-gc.js?v=858dc45125cc';

const VIEW = 'Landroid/view/View;', GROUP = 'Landroid/view/ViewGroup;', PARCELABLE = 'Landroid/os/Parcelable;';
const SPARSE = 'Landroid/util/SparseArray;', ABS = 'Landroid/view/AbsSavedState;', BASE = 'Landroid/view/View$BaseSavedState;';
const signatures = [`saveHierarchyState(${SPARSE})V`, `restoreHierarchyState(${SPARSE})V`, `dispatchSaveInstanceState(${SPARSE})V`, `dispatchRestoreInstanceState(${SPARSE})V`, `onSaveInstanceState()${PARCELABLE}`, `onRestoreInstanceState(${PARCELABLE})V`];
const keys = new Set(signatures.map(signature => VIEW + '->' + signature));
for (const name of ['dispatchSaveInstanceState', 'dispatchRestoreInstanceState', 'dispatchFreezeSelfOnly', 'dispatchThawSelfOnly']) keys.add(`${GROUP}->${name}(${SPARSE})V`);
const VIEWS_TAG = 'android:views', FOCUSED_ID_TAG = 'android:focusedViewId';   // PhoneWindow.VIEWS_TAG / FOCUSED_ID_TAG
const same = (a, b) => a?.ref !== undefined && a.ref === b?.ref;

/** In-process View lifecycle boundary. Original SparseArray and saved-state
 * carriers own the values; overrides execute APK DEX. No process persistence,
 * Parcel serialization, or unsupported native widget state is fabricated.
 */
export function createViewStateHost() {
  const callbacks = gcRoot([]); let dispatchDepth = 0;
  const call = (runtime, receiver, owner, name, parameters, result, values = [], mode = 'virtual') => runtime.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, runtime.argumentWords(parameters, values, { receiver }), mode);
  const fail = message => { throw new APKError(message, { kind: 'view-state-unsupported' }); };
  const empty = runtime => {
    if (!runtime.dex.bootClasses?.has(ABS)) fail('Original AOSP AbsSavedState DEX is required');
    return runtime.readStatic({ owner: ABS, name: 'EMPTY_STATE', type: ABS, key: `${ABS}->EMPTY_STATE:${ABS}` });
  };
  const markSuper = (receiver, mode) => { const callback = callbacks.at(-1); if (callback && same(receiver, callback.receiver) && mode === callback.mode) callback.called = true; };
  const guard = (runtime, receiver, mode, operation) => {
    const callback = { receiver, mode, called: false }; callbacks.push(callback);
    try { const result = operation(); if (!callback.called) runtime.throwJava('Ljava/lang/IllegalStateException;', `Derived class did not call super.on${mode === 'save' ? 'Save' : 'Restore'}InstanceState()`); return result; }
    finally { callbacks.pop(); }
  };
  const saveBase = (runtime, receiver) => {
    const view = runtime.object(receiver); markSuper(receiver, 'save');
    const requestWho = view.startActivityRequestWho ?? null, hasRequest = requestWho !== null, autofilled = !!view.autofilled, autofillId = view.autofillViewId ?? -1;
    if (!hasRequest && !autofilled && autofillId <= 1073741823) return empty(runtime);
    if (!runtime.dex.bootClasses?.has(BASE)) fail('Original AOSP View.BaseSavedState DEX is required');
    const state = runtime.allocate(BASE); call(runtime, state, BASE, '<init>', [PARCELABLE], 'V', [empty(runtime)], 'direct');
    const fields = runtime.object(state).fields;
    for (const [name, type, value] of [['mSavedData', 'I', (hasRequest ? 1 : 0) | (autofilled ? 2 : 0) | (autofillId > 1073741823 ? 4 : 0)], ['mStartActivityRequestWhoSaved', 'Ljava/lang/String;', requestWho], ['mIsAutofilled', 'Z', autofilled ? 1 : 0], ['mHideHighlight', 'Z', view.hideAutofillHighlight ? 1 : 0], ['mAutofillViewId', 'I', autofillId]]) runtime.storeField(fields, `${BASE}->${name}:${type}`, value);
    return state;
  };
  const restoreBase = (runtime, receiver, state) => {
    const view = runtime.object(receiver); markSuper(receiver, 'restore');
    if (state && !runtime.isSubtype(runtime.object(state).type, ABS)) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'Wrong saved state class for View id ' + (view.androidId ?? -1));
    if (!state || !runtime.isSubtype(runtime.object(state).type, BASE)) return;
    const fields = runtime.object(state).fields, flags = fields.get(`${BASE}->mSavedData:I`) || 0;
    if (flags & 1) view.startActivityRequestWho = fields.get(`${BASE}->mStartActivityRequestWhoSaved:Ljava/lang/String;`) ?? null;
    if (flags & 2) { view.autofilled = !!fields.get(`${BASE}->mIsAutofilled:Z`); view.hideAutofillHighlight = !!fields.get(`${BASE}->mHideHighlight:Z`); }
    if (flags & 4) {
      runtime.storeField(fields, `${BASE}->mSavedData:I`, flags & ~4);
      if (!view.autofillIdExplicit) { view.autofillViewId = fields.get(`${BASE}->mAutofillViewId:I`); view.autofillId = null; }
    }
  };
  const widgets = createWidgetStateHost({ saveBase, restoreBase });
  const own = (runtime, receiver, container, mode) => {
    const view = runtime.object(receiver), id = view.androidId ?? -1;
    if (id === -1 || mode === 'save' && view.saveEnabled === false) return;
    if (mode === 'save') {
      const state = guard(runtime, receiver, mode, () => call(runtime, receiver, VIEW, 'onSaveInstanceState', [], PARCELABLE));
      if (state) call(runtime, container, SPARSE, 'put', ['I', 'Ljava/lang/Object;'], 'V', [id | 0, state]);
    } else {
      const state = call(runtime, container, SPARSE, 'get', ['I'], 'Ljava/lang/Object;', [id | 0]);
      if (state) guard(runtime, receiver, mode, () => call(runtime, receiver, VIEW, 'onRestoreInstanceState', [PARCELABLE], 'V', [state]));
    }
  };
  return {
    supports: key => keys.has(key) || widgets.supports(key), parent: () => null,
    invoke(runtime, method, args) {
      if (widgets.supports(`${method.owner}->${method.name}${method.signature}`)) return widgets.invoke(runtime, method, args);
      const receiver = args[0], name = method.name;
      if (name === 'onSaveInstanceState') return saveBase(runtime, receiver);
      if (name === 'onRestoreInstanceState') return restoreBase(runtime, receiver, args[1]);
      if (++dispatchDepth > 128) { dispatchDepth--; fail('View saved-state dispatch exceeds hierarchy limit'); }
      try {
        const container = args[1]; runtime.object(container);
        const mode = /Restore|Thaw|restore/.test(name) ? 'restore' : 'save', dispatchName = mode === 'save' ? 'dispatchSaveInstanceState' : 'dispatchRestoreInstanceState';
        if (name === 'saveHierarchyState' || name === 'restoreHierarchyState') return call(runtime, receiver, VIEW, dispatchName, [SPARSE], 'V', [container]);
        own(runtime, receiver, container, mode);
        if (method.owner === GROUP && !['dispatchFreezeSelfOnly', 'dispatchThawSelfOnly'].includes(name)) {
          for (const child of [...(runtime.object(receiver).children || [])]) if (runtime.object(child).saveFromParentEnabled !== false) call(runtime, child, VIEW, dispatchName, [SPARSE], 'V', [container]);
        }
      } finally { dispatchDepth--; }
    },
  };
}

const virtual = (runtime, receiver, owner, name, parameters, result, values = []) => runtime.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, runtime.argumentWords(parameters, values, { receiver }), 'virtual');
/**
 * Window.saveHierarchyState(): PhoneWindow (android-13.0.0_r1) saves its content parent's views into a SparseArray put in a Bundle under "android:views", and the id of the focused
 * view under "android:focusedViewId". The views are the real View.saveHierarchyState above. The panels and the action bar's toolbar state ("android:Panels",
 * "android:ActionBar") are not modeled: the lab has no menu panels, and a window's decor is its own content tree (src/dialog-window-host.js).
 */
export function saveWindowHierarchyState(runtime, platform, content) {
  const outState = platform.bundle(runtime);
  if (!content) return outState;   // PhoneWindow: no content parent yet, nothing to save
  const states = runtime.allocate(SPARSE); runtime.dispatch({ owner: SPARSE, name: '<init>', parameters: [], result: 'V', signature: '()V' }, runtime.argumentWords([], [], { receiver: states }), 'direct');
  virtual(runtime, content, VIEW, 'saveHierarchyState', [SPARSE], 'V', [states]);
  platform.put(runtime, outState, VIEWS_TAG, SPARSE, states);
  const focused = virtual(runtime, content, VIEW, 'findFocus', [], VIEW);
  if (focused) { const id = virtual(runtime, focused, VIEW, 'getId', [], 'I'); if (id !== -1) platform.put(runtime, outState, FOCUSED_ID_TAG, 'I', id); }
  return outState;
}
/** Window.restoreHierarchyState(Bundle): the views from "android:views", then the focus to the view that had it (when it is still in the content). */
export function restoreWindowHierarchyState(runtime, platform, content, savedInstanceState) {
  if (!content) return;
  if (!savedInstanceState) runtime.throwJava('Ljava/lang/NullPointerException;', "Attempt to invoke virtual method 'android.util.SparseArray android.os.Bundle.getSparseParcelableArray(java.lang.String)' on a null object reference");
  const states = platform.get(runtime, savedInstanceState, VIEWS_TAG, SPARSE, null);
  if (states) virtual(runtime, content, VIEW, 'restoreHierarchyState', [SPARSE], 'V', [states]);
  const focusedId = platform.get(runtime, savedInstanceState, FOCUSED_ID_TAG, 'I', -1);
  if (focusedId !== -1) { const view = platform.find(runtime, content, focusedId); if (view) virtual(runtime, view, VIEW, 'requestFocus', [], 'Z'); }
}
