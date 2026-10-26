// Natives behind dev.apkweb.view.ViewHidden: the hidden View members the original AccessibilityNodeInfo family reads.
//   accessibilityViewId   -- View.getAccessibilityViewId(): allocated on first use from one counter (View.sNextAccessibilityViewId, first id 1) and stable for the view.
//   accessibilityWindowId -- View.getAccessibilityWindowId(): the window id lives in the ViewRootImpl attach info; the browser host has no accessibility window
//                            registry, so this reports AccessibilityWindowInfo.UNDEFINED_WINDOW_ID (-1) like a view that is not attached to a window.
const HIDDEN = 'Ldev/apkweb/view/ViewHidden;', VIEW = 'Landroid/view/View;';
const states = new WeakMap();
const stateOf = runtime => states.get(runtime) ?? states.set(runtime, { ids: new Map(), next: 0 }).get(runtime);

export function createViewHiddenNativeBindings() {
  return [
    [`${HIDDEN}->accessibilityViewId(${VIEW})I`, (runtime, [view]) => {
      if (view === null || view === undefined) throw runtime.throwJava('Ljava/lang/NullPointerException;', 'view == null');
      const state = stateOf(runtime), key = view.ref ?? view;
      if (!state.ids.has(key)) state.ids.set(key, ++state.next);
      return state.ids.get(key);
    }],
    [`${HIDDEN}->accessibilityWindowId(${VIEW})I`, (runtime, [view]) => {
      if (view === null || view === undefined) throw runtime.throwJava('Ljava/lang/NullPointerException;', 'view == null');
      return -1;
    }]
  ];
}
