import { createHostRegistry } from './host-contract.js?v=0feec282e5a9';
import { APKError } from './apk-error.js?v=0feec282e5a9';
import { gcRoot } from './heap-gc.js?v=0feec282e5a9';
import { definePopupWindowMembers } from './popup-window-needs.js?v=0feec282e5a9';

// Action modes and their menus, with the semantics of android-13.0.0_r1:
//   * View.startActionMode / ViewGroup.startActionModeForChild (View.java, ViewGroup.java: the typed / legacy call dance with SENTINEL_ACTION_MODE) carry the request up the parent
//     chain to the window decor. The decor of the virtual window is the top of the chain: the Activity window's decor (or its content root, which the lab keeps parent-less) or a
//     Dialog PhoneWindow's decor. A chain that ends anywhere else (a detached View, a WindowManager root without a PhoneWindow, whose parent is ViewRootImpl) yields null.
//   * DecorView.startActionMode (com.android.internal.policy.DecorView): Window.Callback.onWindowStartingActionMode(wrapper, type) first; when it answers null the decor creates the
//     mode itself, calls onCreateActionMode, shows it (FloatingActionMode.invalidate) and reports Window.Callback.onActionModeStarted. ActionModeCallback2Wrapper forwards the app's
//     callback and, on onDestroyActionMode, clears the decor's mode and reports onActionModeFinished.
//   * TYPE_FLOATING is com.android.internal.view.FloatingActionMode over a MenuBuilder (default SHOW_AS_ACTION_IF_ROOM), positioned from Callback2.onGetContentRect relative to the
//     originating view (repositionToolbar / updateViewLocationInWindow on the window's pre-draw), with FloatingToolbarVisibilityHelper's hide / moving / out-of-bounds rules. The
//     floating toolbar itself (FloatingToolbar + LocalFloatingToolbarPopup) is drawn by the page over the device screen from snapshot(); a click on one of its items comes back
//     through performToolbarItem, which is what the toolbar's OnMenuItemClickListener does: MenuBuilder.performItemAction(item, 0).
//   * TYPE_PRIMARY without a Window.Callback that supplies the mode (an action bar) needs DecorView.createStandaloneActionMode, i.e. the window's contextual action bar
//     (ActionBarContextView inflated from action_mode_bar_stub), which the virtual window does not have: that fails explicitly.
//   * The menu of an action mode is the original com.android.internal.view.menu.MenuBuilder / MenuItemImpl / SubMenuBuilder of the framework DEX, and ActionMode.getMenuInflater the
//     original android.view.MenuInflater. A sub-menu's items are shown in place of the item that opens it, as FloatingToolbar.getVisibleAndEnabledMenuItems does.
const VIEW = 'Landroid/view/View;', GROUP = 'Landroid/view/ViewGroup;', CONTEXT = 'Landroid/content/Context;', RESOURCES = 'Landroid/content/res/Resources;', RECT = 'Landroid/graphics/Rect;';
const ACTION_MODE = 'Landroid/view/ActionMode;', CALLBACK = 'Landroid/view/ActionMode$Callback;', CALLBACK2 = 'Landroid/view/ActionMode$Callback2;', MENU = 'Landroid/view/Menu;', ITEM = 'Landroid/view/MenuItem;';
const WINDOW = 'Landroid/view/Window;', WINDOW_CALLBACK = 'Landroid/view/Window$Callback;', ACTIVITY = 'Landroid/app/Activity;', OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', CHARS = 'Ljava/lang/CharSequence;';
const MENU_BUILDER = 'Lcom/android/internal/view/menu/MenuBuilder;', MENU_BUILDER_CALLBACK = 'Lcom/android/internal/view/menu/MenuBuilder$Callback;', MENU_CALLBACK = 'Lapkweb/bridge/FloatingActionModeMenuCallback;', FLOATING = 'Lcom/android/internal/view/FloatingActionMode;';
const WRAPPER = 'Lcom/android/internal/policy/DecorView$ActionModeCallback2Wrapper;', SENTINEL = 'Landroid/view/ViewGroup$SentinelActionMode;', PRE_DRAW = 'Lapkweb/bridge/FloatingToolbarPreDrawListener;';
const PRE_DRAW_LISTENER = 'Landroid/view/ViewTreeObserver$OnPreDrawListener;', OBSERVER = 'Landroid/view/ViewTreeObserver;';
const TYPE_PRIMARY = 0, TYPE_FLOATING = 1;
const SHOW_AS_ACTION_IF_ROOM = 1;
const MOVING_HIDE_DELAY = 50, MAX_HIDE_DURATION = 3000;   // FloatingActionMode
// FloatingToolbar dimensions the page lays the toolbar out with, read from the framework resources (core/res/res/values/dimens.xml)
const TOOLBAR_DIMENS = { lineHeight: 'floating_toolbar_height', preferredWidth: 'floating_toolbar_preferred_width', marginHorizontal: 'floating_toolbar_horizontal_margin', marginVertical: 'floating_toolbar_vertical_margin',
  buttonSidePadding: 'floating_toolbar_menu_button_side_padding', buttonMinimumWidth: 'floating_toolbar_menu_button_minimum_width', textSize: 'floating_toolbar_text_size', overflowButtonWidth: 'floating_toolbar_menu_image_button_width',
  minimumOverflowHeight: 'floating_toolbar_minimum_overflow_height', bottomAllowance: 'content_rect_bottom_clip_allowance' };

const nullish = value => value === null || value === undefined || value === 0;
const flag = value => value === true || value === 1 || value === -1 || value === 0xffffffff;
const same = (a, b) => !nullish(a) && !nullish(b) && a.ref === b.ref;

export function createActionModeHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const call = (r, receiver, owner, name, parameters = [], result = 'V', args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const construct = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: o }), 'direct'); return o; };
  const unsupported = (message, kind) => { throw new APKError(message, { kind }); };
  const npe = (r, message = null) => r.throwJava('Ljava/lang/NullPointerException;', message);
  const targetSdk = () => Number(platform.manifest?.usesSdk?.targetSdkVersion ?? platform.manifest?.usesSdk?.minSdkVersion ?? 1);
  const charSequenceText = (r, value) => nullish(value) ? null : typeof value === 'string' ? value : r.stringCharacters(call(r, value, OBJECT, 'toString', [], STRING));
  const isView = (r, value) => !nullish(value) && typeof value === 'object' && r.isSubtype(r.object(value).type, VIEW);
  const rectOf = (r, rect) => { const f = r.object(rect).fields; return ['left', 'top', 'right', 'bottom'].map(k => f.get(`${RECT}->${k}:I`) ?? 0); };
  const newRect = (r, values = [0, 0, 0, 0]) => construct(r, RECT, ['I', 'I', 'I', 'I'], values);
  const intPair = r => r.newArray('[I', 2);
  const pair = (r, array) => [...r.array(array).elements];

  // ================================================================================== class declarations (android.view.ActionMode and friends are platform classes outside framework.dex)
  type(ACTION_MODE, OBJECT);
  type(CALLBACK2, OBJECT, [CALLBACK]);
  type(FLOATING, ACTION_MODE, [], { allocatable: true });
  type(SENTINEL, ACTION_MODE, [], { allocatable: true });
  type(WRAPPER, CALLBACK2, [], { allocatable: true });
  type(MENU_CALLBACK, OBJECT, [MENU_BUILDER_CALLBACK], { allocatable: true });
  type(PRE_DRAW, OBJECT, [PRE_DRAW_LISTENER], { allocatable: true });

  // ================================================================================== android.view.ActionMode (the concrete members of the abstract class; subclasses such as AppCompat's wrappers inherit them)
  const mode = (r, self) => r.object(self);
  def(ACTION_MODE, '<init>', '()V', () => {});
  def(ACTION_MODE, 'setTag', `(${OBJECT})V`, (r, _m, [self, tag]) => { mode(r, self).amTag = nullish(tag) ? null : tag; });
  def(ACTION_MODE, 'getTag', `()${OBJECT}`, (r, _m, [self]) => mode(r, self).amTag ?? null);
  def(ACTION_MODE, 'setTitleOptionalHint', '(Z)V', (r, _m, [self, hint]) => { mode(r, self).amTitleOptionalHint = flag(hint); });
  def(ACTION_MODE, 'getTitleOptionalHint', '()Z', (r, _m, [self]) => mode(r, self).amTitleOptionalHint ? 1 : 0);
  def(ACTION_MODE, 'isTitleOptional', '()Z', () => 0);
  def(ACTION_MODE, 'setType', '(I)V', (r, _m, [self, value]) => { mode(r, self).amType = value; });
  def(ACTION_MODE, 'getType', '()I', (r, _m, [self]) => mode(r, self).amType ?? TYPE_PRIMARY);
  def(ACTION_MODE, 'isUiFocusable', '()Z', () => 1);
  def(ACTION_MODE, 'invalidateContentRect', '()V', () => {});
  def(ACTION_MODE, 'hide', '(J)V', () => {});
  def(ACTION_MODE, 'onWindowFocusChanged', '(Z)V', () => {});
  // ViewGroup.SENTINEL_ACTION_MODE: an ActionMode whose every abstract member does nothing; it only travels between the typed and the legacy startActionModeForChild.
  for (const [name, signature, value] of [['setTitle', `(${CHARS})V`], ['setTitle', '(I)V'], ['setSubtitle', `(${CHARS})V`], ['setSubtitle', '(I)V'], ['setCustomView', `(${VIEW})V`], ['invalidate', '()V'], ['finish', '()V'],
    ['getMenu', `()${MENU}`, null], ['getTitle', `()${CHARS}`, null], ['getSubtitle', `()${CHARS}`, null], ['getCustomView', `()${VIEW}`, null], ['getMenuInflater', '()Landroid/view/MenuInflater;', null]]) def(SENTINEL, name, signature, () => value);
  const sentinel = r => {
    if (!r.actionModeSentinel) { r.actionModeSentinel = r.allocate(SENTINEL); (r.hostStaticValues ??= []).push(r.actionModeSentinel); }
    return r.actionModeSentinel;
  };

  // ActionMode.Callback2.onGetContentRect default: the whole originating view
  def(CALLBACK2, '<init>', '()V', () => {});
  def(CALLBACK2, 'onGetContentRect', `(${ACTION_MODE}${VIEW}${RECT})V`, (r, _m, [, , view, outRect]) => {
    if (nullish(view)) call(r, outRect, RECT, 'set', ['I', 'I', 'I', 'I'], 'V', [0, 0, 0, 0]);
    else call(r, outRect, RECT, 'set', ['I', 'I', 'I', 'I'], 'V', [0, 0, call(r, view, VIEW, 'getWidth', [], 'I'), call(r, view, VIEW, 'getHeight', [], 'I')]);
  });

  // ================================================================================== View.startActionMode / ViewGroup.startActionModeForChild
  const rootOf = (r, view) => { let current = view; for (let depth = 0; depth < 4096; depth++) { const parent = r.object(current).parent; if (!isView(r, parent)) return current; current = parent; } throw new APKError('Cyclic/excessive View hierarchy while starting an action mode', { kind: 'action-mode-hierarchy' }); };
  /** The window whose decor `view` is (the top of the chain), or null: { owner (the Activity or the Dialog's PhoneWindow, which keeps the decor's action-mode state), window, decor, frame }. */
  const decorOf = (r, view) => {
    const object = r.object(view);
    if (isView(r, object.parent)) return null;
    if (!nullish(object.surfaceWindow)) return { owner: object.surfaceWindow, window: object.surfaceWindow, decor: view, frame: null };
    for (const frame of platform.allFrames()) {
      const decor = frame.window ? r.object(frame.window).decor : null;
      if (same(decor, view) || same(frame.root, view)) return { owner: frame.activity, window: frame.window ?? null, decor: decor ?? view, frame };
    }
    return null;
  };
  const decorState = (r, owner) => {
    const object = r.object(owner);
    if (!object.decorActionModes) { object.decorActionModes = { owner, primary: null, floating: null, floatingOrigin: null, preDraw: null }; activeDecors.set(owner.ref, owner); }
    return object.decorActionModes;
  };
  const activeDecors = gcRoot(new Map());   // owners whose decor has (or had) an action mode: what snapshot() walks
  const windowCallback = (r, info) => {
    if (info.frame) return info.window ? (r.object(info.window).callback ?? info.frame.activity) : info.frame.activity;
    return call(r, info.window, WINDOW, 'getCallback', [], WINDOW_CALLBACK);
  };
  const windowDestroyed = (r, info) => flag(info.frame ? call(r, info.frame.activity, ACTIVITY, 'isDestroyed', [], 'Z') : call(r, info.window, WINDOW, 'isDestroyed', [], 'Z'));
  const infoOfOwner = (r, owner) => {
    const frame = platform.allFrames().find(value => same(value.activity, owner));
    if (frame) return { owner, window: frame.window ?? null, decor: frame.window ? r.object(frame.window).decor : frame.root, frame };
    if (r.isSubtype(r.object(owner).type, ACTIVITY)) return { owner, window: null, decor: null, frame: { activity: owner, window: null, root: null } };   // a finished Activity: its window is destroyed
    return { owner, window: owner, decor: r.object(owner).decor ?? null, frame: null };
  };
  /** ActionModeCallback2Wrapper.onPrepareActionMode / onDestroyActionMode: requestFitSystemWindows, i.e. ViewRootImpl schedules a traversal (insets, layout, pre-draw, draw) of the window. */
  const requestTraversal = (r, info) => {
    if (!nullish(info.decor)) call(r, info.decor, VIEW, 'requestFitSystemWindows');
    const root = info.frame ? info.frame.root : info.decor;
    if (!nullish(root) && r.object(root).attached) platform.requestDraw?.(r, root);
  };

  /** DecorView.startActionMode(originatingView, callback, type). */
  const decorStart = (r, info, originatingView, callback, typeValue) => {
    const wrapper = r.allocate(WRAPPER); Object.assign(r.object(wrapper), { wrapped: callback, decorOwner: info.owner });
    const state = decorState(r, info.owner), windowCb = windowCallback(r, info);
    let started = null;
    if (!nullish(windowCb) && !windowDestroyed(r, info)) started = call(r, windowCb, WINDOW_CALLBACK, 'onWindowStartingActionMode', [CALLBACK, 'I'], ACTION_MODE, [wrapper, typeValue]);
    if (!nullish(started)) {
      const startedType = call(r, started, ACTION_MODE, 'getType', [], 'I');
      if (startedType === TYPE_PRIMARY) { state.primary = started; }
      else if (startedType === TYPE_FLOATING) { if (!nullish(state.floating)) call(r, state.floating, ACTION_MODE, 'finish'); state.floating = started; }
    } else {
      started = typeValue === TYPE_FLOATING ? createFloatingActionMode(r, info, state, originatingView, wrapper)
        : unsupported(`View.startActionMode(ActionMode.Callback${typeValue === TYPE_PRIMARY ? '' : `, ${typeValue}`}) for a primary (contextual action bar) mode: the Window.Callback did not supply one and DecorView.createStandaloneActionMode needs the window's contextual action bar (ActionBarContextView from action_mode_bar_stub), which the virtual window does not have; ActionMode.TYPE_FLOATING is supported`, 'action-mode-primary-unsupported');
      const menu = call(r, started, ACTION_MODE, 'getMenu', [], MENU);
      if (flag(call(r, wrapper, CALLBACK, 'onCreateActionMode', [ACTION_MODE, MENU], 'Z', [started, menu]))) setHandledFloatingActionMode(r, state, started);
      else started = null;
    }
    if (!nullish(started) && !nullish(windowCb) && !windowDestroyed(r, info)) call(r, windowCb, WINDOW_CALLBACK, 'onActionModeStarted', [ACTION_MODE], 'V', [started]);
    return started;
  };
  /** View.startActionMode(callback, type) on a View without a View parent: the decor itself (DecorView.startActionMode(this, ...)), or a detached View / WindowManager root (null). */
  const startFromTop = (r, self, originatingView, callback, typeValue) => {
    const info = decorOf(r, self);
    return info ? decorStart(r, info, originatingView, callback, typeValue) : null;
  };
  for (const [signature, typed] of [[`(${CALLBACK})${ACTION_MODE}`, false], [`(${CALLBACK}I)${ACTION_MODE}`, true]]) def(VIEW, 'startActionMode', signature, (r, _m, [self, callback, typeArg]) => {
    if (!typed) return call(r, self, VIEW, 'startActionMode', [CALLBACK, 'I'], ACTION_MODE, [callback, TYPE_PRIMARY]);
    const parent = r.object(self).parent;
    if (isView(r, parent)) return call(r, parent, GROUP, 'startActionModeForChild', [VIEW, CALLBACK, 'I'], ACTION_MODE, [self, callback, typeArg]);
    return startFromTop(r, self, self, callback, typeArg);
  });
  const groupFlags = (r, self) => r.object(self);
  def(GROUP, 'startActionModeForChild', `(${VIEW}${CALLBACK})${ACTION_MODE}`, (r, _m, [self, original, callback]) => {
    const flags = groupFlags(r, self);
    if (flags.amForChildTyped) return sentinel(r);   // called from the typed variant: tell it nothing overrode the legacy one
    flags.amForChildNotTyped = true;
    try { return call(r, self, GROUP, 'startActionModeForChild', [VIEW, CALLBACK, 'I'], ACTION_MODE, [original, callback, TYPE_PRIMARY]); }
    finally { flags.amForChildNotTyped = false; }
  });
  def(GROUP, 'startActionModeForChild', `(${VIEW}${CALLBACK}I)${ACTION_MODE}`, (r, _m, [self, original, callback, typeValue]) => {
    const flags = groupFlags(r, self);
    if (!flags.amForChildNotTyped && typeValue === TYPE_PRIMARY) {
      let started;
      flags.amForChildTyped = true;
      try { started = call(r, self, GROUP, 'startActionModeForChild', [VIEW, CALLBACK], ACTION_MODE, [original, callback]); }
      finally { flags.amForChildTyped = false; }
      if (!same(started, sentinel(r))) return started;
    }
    const parent = r.object(self).parent;
    if (isView(r, parent)) return call(r, parent, GROUP, 'startActionModeForChild', [VIEW, CALLBACK, 'I'], ACTION_MODE, [original, callback, typeValue]);
    return startFromTop(r, self, original, callback, typeValue);
  });

  // ================================================================================== DecorView.ActionModeCallback2Wrapper
  const wrapped = (r, self) => r.object(self).wrapped;
  def(WRAPPER, 'onCreateActionMode', `(${ACTION_MODE}${MENU})Z`, (r, _m, [self, m, menu]) => call(r, wrapped(r, self), CALLBACK, 'onCreateActionMode', [ACTION_MODE, MENU], 'Z', [m, menu]));
  def(WRAPPER, 'onPrepareActionMode', `(${ACTION_MODE}${MENU})Z`, (r, _m, [self, m, menu]) => {
    requestTraversal(r, infoOfOwner(r, r.object(self).decorOwner));
    return call(r, wrapped(r, self), CALLBACK, 'onPrepareActionMode', [ACTION_MODE, MENU], 'Z', [m, menu]);
  });
  def(WRAPPER, 'onActionItemClicked', `(${ACTION_MODE}${ITEM})Z`, (r, _m, [self, m, item]) => call(r, wrapped(r, self), CALLBACK, 'onActionItemClicked', [ACTION_MODE, ITEM], 'Z', [m, item]));
  def(WRAPPER, 'onDestroyActionMode', `(${ACTION_MODE})V`, (r, _m, [self, m]) => {
    call(r, wrapped(r, self), CALLBACK, 'onDestroyActionMode', [ACTION_MODE], 'V', [m]);
    const owner = r.object(self).decorOwner, info = infoOfOwner(r, owner), state = decorState(r, owner);
    let isPrimary, isFloating;
    if (targetSdk() >= 23) { isPrimary = same(m, state.primary); isFloating = same(m, state.floating); }   // DecorView logs "Destroying unexpected ActionMode instance" otherwise
    else { const modeType = call(r, m, ACTION_MODE, 'getType', [], 'I'); isPrimary = modeType === TYPE_PRIMARY; isFloating = modeType === TYPE_FLOATING; }
    if (isPrimary) state.primary = null;
    else if (isFloating) { cleanupFloatingActionModeViews(r, state); state.floating = null; }
    if (nullish(state.primary) && nullish(state.floating) && nullish(state.floatingOrigin)) activeDecors.delete(owner.ref);
    const windowCb = windowCallback(r, info);
    if (!nullish(windowCb) && !windowDestroyed(r, info)) call(r, windowCb, WINDOW_CALLBACK, 'onActionModeFinished', [ACTION_MODE], 'V', [m]);
    requestTraversal(r, info);
  });
  def(WRAPPER, 'onGetContentRect', `(${ACTION_MODE}${VIEW}${RECT})V`, (r, _m, [self, m, view, outRect]) => {
    const target = wrapped(r, self);
    if (r.isSubtype(r.object(target).type, CALLBACK2)) call(r, target, CALLBACK2, 'onGetContentRect', [ACTION_MODE, VIEW, RECT], 'V', [m, view, outRect]);
    else r.dispatch({ owner: CALLBACK2, name: 'onGetContentRect', parameters: [ACTION_MODE, VIEW, RECT], result: 'V', signature: `(${ACTION_MODE}${VIEW}${RECT})V` }, r.argumentWords([ACTION_MODE, VIEW, RECT], [m, view, outRect], { receiver: self }), 'direct');
  });

  // ================================================================================== DecorView floating action mode plumbing
  const createFloatingActionMode = (r, info, state, originatingView, callback) => {
    if (!nullish(state.floating)) call(r, state.floating, ACTION_MODE, 'finish');
    cleanupFloatingActionModeViews(r, state);
    const context = call(r, info.decor ?? originatingView, VIEW, 'getContext', [], CONTEXT);
    const created = newFloatingActionMode(r, context, callback, originatingView);
    state.floatingOrigin = originatingView;
    state.preDraw = r.allocate(PRE_DRAW); r.object(state.preDraw).floatingMode = created;
    activeDecors.set(info.owner.ref, info.owner);
    return created;
  };
  const setHandledFloatingActionMode = (r, state, handled) => {
    state.floating = handled;
    call(r, handled, ACTION_MODE, 'invalidate');   // shows the floating toolbar if necessary
    if (!nullish(state.floatingOrigin) && !nullish(state.preDraw)) call(r, call(r, state.floatingOrigin, VIEW, 'getViewTreeObserver', [], OBSERVER), OBSERVER, 'addOnPreDrawListener', [PRE_DRAW_LISTENER], 'V', [state.preDraw]);
  };
  const cleanupFloatingActionModeViews = (r, state) => {
    const previous = state.floating && r.object(state.floating).floatingToolbar; if (previous) dismissToolbar(previous);
    if (!nullish(state.floatingOrigin)) {
      if (!nullish(state.preDraw)) { call(r, call(r, state.floatingOrigin, VIEW, 'getViewTreeObserver', [], OBSERVER), OBSERVER, 'removeOnPreDrawListener', [PRE_DRAW_LISTENER], 'V', [state.preDraw]); state.preDraw = null; }
      state.floatingOrigin = null;
    }
  };
  def(PRE_DRAW, 'onPreDraw', '()Z', (r, _m, [self]) => { updateViewLocationInWindow(r, r.object(self).floatingMode); return 1; });

  // ================================================================================== com.android.internal.view.FloatingActionMode
  const frameworkDimension = (r, context, name) => {
    const table = platform.resources?.frameworkTable, id = table?.findId?.(`dimen/${name}`);
    if (!id) throw new APKError(`FloatingActionMode needs the framework dimension @android:dimen/${name} (the framework resource table is not loaded)`, { kind: 'action-mode-resources' });
    return call(r, call(r, context, CONTEXT, 'getResources', [], RESOURCES), RESOURCES, 'getDimensionPixelSize', ['I'], 'I', [id]);
  };
  const newFloatingActionMode = (r, context, callback, originatingView) => {
    if (nullish(context) || nullish(callback) || nullish(originatingView)) npe(r);
    const self = r.allocate(FLOATING), state = r.object(self);
    const menu = newMenu(r, context, self);
    const metrics = Object.fromEntries(Object.entries(TOOLBAR_DIMENS).map(([key, name]) => [key, frameworkDimension(r, context, name)]));
    const location = intPair(r); call(r, originatingView, VIEW, 'getLocationOnScreen', ['[I'], 'V', [location]);
    Object.assign(state, { amType: TYPE_FLOATING, context, callback, originatingView, menu, metrics, contentRect: newRect(r), contentRectOnScreen: [0, 0, 0, 0], previousContentRectOnScreen: [0, 0, 0, 0],
      viewPositionOnScreen: pair(r, location), previousViewPositionOnScreen: [0, 0], rootViewPositionOnScreen: [0, 0], viewRectOnScreen: [0, 0, 0, 0], previousViewRectOnScreen: [0, 0, 0, 0],
      helper: { active: true, hideRequested: false, moving: false, outOfBounds: false, windowFocused: true }, movingToken: 0, hideToken: 0,
      floatingToolbar: { visible: false, dismissed: true, items: [], contentRect: [0, 0, 0, 0], viewport: [0, 0, 0, 0] } });
    return self;
  };
  const floating = (r, self) => r.object(self);
  for (const [name, signature] of [['setTitle', `(${CHARS})V`], ['setTitle', '(I)V'], ['setSubtitle', `(${CHARS})V`], ['setSubtitle', '(I)V'], ['setCustomView', `(${VIEW})V`]]) def(FLOATING, name, signature, () => {});
  for (const [name, signature] of [['getTitle', `()${CHARS}`], ['getSubtitle', `()${CHARS}`], ['getCustomView', `()${VIEW}`]]) def(FLOATING, name, signature, () => null);
  def(FLOATING, 'getMenu', `()${MENU}`, (r, _m, [self]) => floating(r, self).menu);
  def(FLOATING, 'getMenuInflater', '()Landroid/view/MenuInflater;', (r, _m, [self]) => construct(r, 'Landroid/view/MenuInflater;', [CONTEXT], [floating(r, self).context]));
  def(FLOATING, 'invalidate', '()V', (r, _m, [self]) => {
    const state = floating(r, self);
    call(r, state.callback, CALLBACK, 'onPrepareActionMode', [ACTION_MODE, MENU], 'Z', [self, state.menu]);
    call(r, self, ACTION_MODE, 'invalidateContentRect');
  });
  def(FLOATING, 'invalidateContentRect', '()V', (r, _m, [self]) => {
    const state = floating(r, self);
    call(r, state.callback, CALLBACK2, 'onGetContentRect', [ACTION_MODE, VIEW, RECT], 'V', [self, state.originatingView, state.contentRect]);
    repositionToolbar(r, self);
  });
  def(FLOATING, 'hide', '(J)V', (r, _m, [self, durationArg]) => {
    const state = floating(r, self);
    let duration = Number(durationArg);
    if (duration === -1) duration = Number(callStatic(r, 'Landroid/view/ViewConfiguration;', 'getDefaultActionModeHideDuration', [], 'J'));   // ActionMode.DEFAULT_HIDE_DURATION
    duration = Math.min(MAX_HIDE_DURATION, duration);
    const token = ++state.hideToken;
    if (duration <= 0) { hideOff(r, self); return; }
    state.helper.hideRequested = true; updateToolbarVisibility(r, self);
    platform.queueTask(() => { if (state.hideToken === token) hideOff(r, self); }, duration, [self]);
  });
  def(FLOATING, 'onWindowFocusChanged', '(Z)V', (r, _m, [self, focused]) => { const state = floating(r, self); state.helper.windowFocused = flag(focused); updateToolbarVisibility(r, self); });
  def(FLOATING, 'finish', '()V', (r, _m, [self]) => {
    const state = floating(r, self);
    dismissToolbar(state.floatingToolbar); state.helper.active = false; state.movingToken++; state.hideToken++;   // reset(): dismiss, deactivate the visibility helper, drop the pending runnables
    call(r, state.callback, CALLBACK, 'onDestroyActionMode', [ACTION_MODE], 'V', [self]);
  });
  def(FLOATING, 'isUiFocusable', '()Z', () => 1);
  const viewStillActive = (r, view) => call(r, view, VIEW, 'getWindowVisibility', [], 'I') === 0 && flag(call(r, view, VIEW, 'isShown', [], 'Z'));
  const hideOff = (r, self) => { const state = floating(r, self); if (viewStillActive(r, state.originatingView)) { state.helper.hideRequested = false; updateToolbarVisibility(r, self); } };
  const movingOff = (r, self) => { const state = floating(r, self); if (viewStillActive(r, state.originatingView)) { state.helper.moving = false; updateToolbarVisibility(r, self); } };
  /** FloatingActionMode.updateViewLocationInWindow (from the window's pre-draw). */
  const updateViewLocationInWindow = (r, self) => {
    const state = floating(r, self), view = state.originatingView;
    const location = intPair(r), rootLocation = intPair(r), visible = newRect(r);
    call(r, view, VIEW, 'getLocationOnScreen', ['[I'], 'V', [location]);
    call(r, call(r, view, VIEW, 'getRootView', [], VIEW), VIEW, 'getLocationOnScreen', ['[I'], 'V', [rootLocation]);
    call(r, view, VIEW, 'getGlobalVisibleRect', [RECT], 'Z', [visible]);
    state.viewPositionOnScreen = pair(r, location); state.rootViewPositionOnScreen = pair(r, rootLocation);
    const [rx, ry] = state.rootViewPositionOnScreen, [l, t, rr, b] = rectOf(r, visible);
    state.viewRectOnScreen = [l + rx, t + ry, rr + rx, b + ry];
    if (String(state.viewPositionOnScreen) !== String(state.previousViewPositionOnScreen) || String(state.viewRectOnScreen) !== String(state.previousViewRectOnScreen)) {
      repositionToolbar(r, self);
      state.previousViewPositionOnScreen = [...state.viewPositionOnScreen]; state.previousViewRectOnScreen = [...state.viewRectOnScreen];
    }
  };
  const intersectsClosed = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
  /** FloatingActionMode.repositionToolbar. */
  const repositionToolbar = (r, self) => {
    const state = floating(r, self), view = state.originatingView, rect = newRect(r, rectOf(r, state.contentRect));
    const parent = r.object(view).parent;
    if (isView(r, parent) && r.isSubtype(r.object(parent).type, GROUP)) {
      call(r, parent, GROUP, 'getChildVisibleRect', [VIEW, RECT, 'Landroid/graphics/Point;', 'Z'], 'Z', [view, rect, null, 1]);
      call(r, rect, RECT, 'offset', ['I', 'I'], 'V', state.rootViewPositionOnScreen);
    } else call(r, rect, RECT, 'offset', ['I', 'I'], 'V', state.viewPositionOnScreen);
    let onScreen = rectOf(r, rect);
    const display = [0, 0, platform.device.widthDp, platform.device.heightDp], viewRect = state.viewRectOnScreen;
    if (intersectsClosed(onScreen, display) && intersectsClosed(onScreen, viewRect)) {
      state.helper.outOfBounds = false;
      onScreen = [Math.max(onScreen[0], viewRect[0]), Math.max(onScreen[1], viewRect[1]), Math.min(onScreen[2], viewRect[2]), Math.min(onScreen[3], viewRect[3] + state.metrics.bottomAllowance)];
      if (String(onScreen) !== String(state.previousContentRectOnScreen)) {
        const token = ++state.movingToken; state.helper.moving = true;   // the content rect is moving: hide the toolbar until it settles
        platform.queueTask(() => { if (state.movingToken === token) movingOff(r, self); }, MOVING_HIDE_DELAY, [self]);
        state.floatingToolbar.contentRect = onScreen; updateToolbarLayout(r, self);
      }
    } else { state.helper.outOfBounds = true; onScreen = [0, 0, 0, 0]; }
    state.contentRectOnScreen = onScreen;
    updateToolbarVisibility(r, self);
    state.previousContentRectOnScreen = [...onScreen];
  };
  /** FloatingToolbarVisibilityHelper.updateToolbarVisibility. */
  const updateToolbarVisibility = (r, self) => {
    const state = floating(r, self), helper = state.helper;
    if (!helper.active) return;
    if (helper.hideRequested || helper.moving || helper.outOfBounds || !helper.windowFocused) state.floatingToolbar.visible = false;
    else showToolbar(r, self);
  };

  // ---- com.android.internal.widget.FloatingToolbar: what the popup shows (the page draws it from snapshot()) ----
  const dismissToolbar = toolbar => { toolbar.visible = false; toolbar.dismissed = true; };
  const updateToolbarLayout = (r, self) => { if (floating(r, self).floatingToolbar.visible) showToolbar(r, self); };
  /** FloatingToolbar.doShow: the visible and enabled items, in the toolbar's order, laid out again when they changed; the popup shown at the content rect. */
  const showToolbar = (r, self) => {
    const state = floating(r, self), toolbar = state.floatingToolbar;
    toolbar.items = toolbarItems(r, state.menu);
    const viewport = newRect(r); call(r, call(r, state.originatingView, VIEW, 'getRootView', [], VIEW), VIEW, 'getWindowVisibleDisplayFrame', [RECT], 'V', [viewport]);
    toolbar.viewport = rectOf(r, viewport); toolbar.visible = true; toolbar.dismissed = false;
  };
  const textAssistId = () => platform.resources?.frameworkTable?.findId?.('id/textAssist') ?? null;

  // ================================================================================== com.android.internal.view.menu.MenuBuilder (the original class of the framework DEX)
  // FloatingActionMode's constructor: new MenuBuilder(context).setDefaultShowAsAction(SHOW_AS_ACTION_IF_ROOM), with a MenuBuilder.Callback whose onMenuItemSelected is the mode's
  // onActionItemClicked. Items, groups, sub-menus, shortcuts and MenuItemImpl.invoke are the original code.
  const newMenu = (r, context, mode) => {
    const self = construct(r, MENU_BUILDER, [CONTEXT], [context]);
    call(r, self, MENU_BUILDER, 'setDefaultShowAsAction', ['I'], MENU_BUILDER, [SHOW_AS_ACTION_IF_ROOM]);
    const callback = r.allocate(MENU_CALLBACK); r.object(callback).callbackMode = mode;
    call(r, self, MENU_BUILDER, 'setCallback', [MENU_BUILDER_CALLBACK], 'V', [callback]);
    return self;
  };
  def(MENU_CALLBACK, 'onMenuItemSelected', `(${MENU_BUILDER}${ITEM})Z`, (r, _m, [self, , item]) => { const owner = r.object(self).callbackMode; return flag(call(r, floating(r, owner).callback, CALLBACK, 'onActionItemClicked', [ACTION_MODE, ITEM], 'Z', [owner, item])) ? 1 : 0; });
  def(MENU_CALLBACK, 'onMenuModeChange', `(${MENU_BUILDER})V`, () => {});
  /** FloatingToolbar.getVisibleAndEnabledMenuItems: the visible and enabled items, a sub-menu's own items in place of the item that opens it. */
  const visibleAndEnabledItems = (r, menuRef, out = [], depth = 0) => {
    if (depth > 16) throw new APKError('Excessive sub-menu nesting in an action-mode menu', { kind: 'action-mode-menu' });
    const size = nullish(menuRef) ? 0 : call(r, menuRef, MENU, 'size', [], 'I');
    for (let i = 0; i < size; i++) {
      const ref = call(r, menuRef, MENU, 'getItem', ['I'], ITEM, [i]);
      if (!flag(call(r, ref, ITEM, 'isVisible', [], 'Z')) || !flag(call(r, ref, ITEM, 'isEnabled', [], 'Z'))) continue;
      const sub = call(r, ref, ITEM, 'getSubMenu', [], 'Landroid/view/SubMenu;');
      if (!nullish(sub)) visibleAndEnabledItems(r, sub, out, depth + 1); else out.push(ref);
    }
    return out;
  };
  /** The items sorted with FloatingToolbar's comparator: textAssist first, then the items that require an action button, the overflow-only items last, the rest by order. */
  const toolbarItems = (r, menuRef) => {
    const assist = textAssistId();
    const entries = visibleAndEnabledItems(r, menuRef).map((ref, index) => {
      const itemId = call(r, ref, ITEM, 'getItemId', [], 'I'), action = flag(call(r, ref, ITEM, 'requiresActionButton', [], 'Z')), overflow = flag(call(r, ref, ITEM, 'requiresOverflow', [], 'Z'));
      return { ref, index, itemId, order: call(r, ref, ITEM, 'getOrder', [], 'I'), rank: itemId === assist ? 0 : action ? 1 : overflow ? 3 : 2, requiresOverflow: overflow };
    });
    return entries.sort((a, b) => a.rank - b.rank || (a.rank === 2 ? a.order - b.order : 0) || a.index - b.index)
      .map(({ ref, itemId, requiresOverflow }) => ({ ref, itemId, groupId: call(r, ref, ITEM, 'getGroupId', [], 'I'), title: charSequenceText(r, call(r, ref, ITEM, 'getTitle', [], CHARS)) ?? '',
        contentDescription: charSequenceText(r, call(r, ref, ITEM, 'getContentDescription', [], CHARS)), requiresOverflow }));
  };
  /** The toolbar's OnMenuItemClickListener: MenuBuilder.performItemAction(item, 0) on the item's own menu (the root menu or the sub-menu it belongs to). */
  const performItemAction = (r, rootMenu, itemRef) => flag(call(r, rootMenu, MENU_BUILDER, 'performItemAction', [ITEM, 'I'], 'Z', [itemRef, 0]));

  // ================================================================================== the page's view of the floating toolbars, and a click on one of their items
  const ownerOnScreen = (r, state) => {
    const origin = state.floatingOrigin; if (nullish(origin) || !r.object(origin).attached) return null;
    const record = platform.dialogWindowHost?.recordFor?.(r, origin);
    if (record) return record.attached && (r.object(record.root).visibility ?? 0) === 0 ? { focused: record.focused !== false } : null;
    const root = rootOf(r, origin);
    return same(root, r.root) || (platform.allFrames().some(frame => frame.window && same(r.object(frame.window).decor, root) && same(frame.activity, r.activity))) ? { focused: r.object(r.root).surfaceWindowFocused !== false } : null;
  };
  /** Floating toolbars to draw, bottom to top: rects in the VM's screen pixels, with the originating view's own screen position so the page can place them over that view's element. */
  registry.snapshot = r => {
    const out = [];
    for (const owner of activeDecors.values()) {
      const state = r.object(owner).decorActionModes; if (!state || nullish(state.floating) || r.object(state.floating).type !== FLOATING) continue;
      const modeState = floating(r, state.floating), toolbar = modeState.floatingToolbar, screen = ownerOnScreen(r, state);
      if (!toolbar.visible || !screen || !screen.focused || !toolbar.items.length) continue;
      out.push({ id: state.floating.ref, type: 'floating', originViewId: state.floatingOrigin.ref, viewLocation: [...modeState.viewPositionOnScreen], windowLocation: [...modeState.rootViewPositionOnScreen],
        contentRect: [...toolbar.contentRect], viewport: [...toolbar.viewport], metrics: { ...modeState.metrics },
        items: toolbar.items.map(entry => ({ id: entry.ref.ref, itemId: entry.itemId, groupId: entry.groupId, title: entry.title, contentDescription: entry.contentDescription, requiresOverflow: entry.requiresOverflow })) });
    }
    return out;
  };
  /** The toolbar's OnMenuItemClickListener (FloatingActionMode.setFloatingToolbar): MenuBuilder.performItemAction(item, 0). Null when the toolbar or the item is gone (the event is dropped). */
  registry.performToolbarItem = (r, modeId, itemId) => {
    for (const owner of activeDecors.values()) {
      const state = r.object(owner).decorActionModes;
      if (!state || nullish(state.floating) || state.floating.ref !== modeId || r.object(state.floating).type !== FLOATING) continue;
      const modeState = floating(r, state.floating), entry = modeState.floatingToolbar.visible ? modeState.floatingToolbar.items.find(value => value.ref.ref === itemId) : null;
      if (!entry) return null;
      return { handled: performItemAction(r, modeState.menu, entry.ref) };
    }
    return null;
  };
  definePopupWindowMembers(registry, platform);   // what the original PopupWindow and menu popups need from hosted classes
  return registry;
}
