import { createHostRegistry } from './host-contract.js?v=b8911598aecd';
import { APKError } from './apk-error.js?v=b8911598aecd';
import { gcRoot } from './heap-gc.js?v=b8911598aecd';

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
//   * MenuBuilder / MenuItemImpl (com.android.internal.view.menu) are the menu of an action mode: ordering by category and order then insertion, groups, check state, click dispatch
//     (MenuItemImpl.invoke). Sub-menus, intent options, keyboard shortcuts dispatch, action providers and MenuInflater are not modelled and fail naming the API.
const VIEW = 'Landroid/view/View;', GROUP = 'Landroid/view/ViewGroup;', CONTEXT = 'Landroid/content/Context;', RESOURCES = 'Landroid/content/res/Resources;', RECT = 'Landroid/graphics/Rect;';
const ACTION_MODE = 'Landroid/view/ActionMode;', CALLBACK = 'Landroid/view/ActionMode$Callback;', CALLBACK2 = 'Landroid/view/ActionMode$Callback2;', MENU = 'Landroid/view/Menu;', ITEM = 'Landroid/view/MenuItem;';
const WINDOW = 'Landroid/view/Window;', WINDOW_CALLBACK = 'Landroid/view/Window$Callback;', ACTIVITY = 'Landroid/app/Activity;', OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', CHARS = 'Ljava/lang/CharSequence;';
const MENU_BUILDER = 'Lcom/android/internal/view/menu/MenuBuilder;', ITEM_IMPL = 'Lcom/android/internal/view/menu/MenuItemImpl;', FLOATING = 'Lcom/android/internal/view/FloatingActionMode;';
const WRAPPER = 'Lcom/android/internal/policy/DecorView$ActionModeCallback2Wrapper;', SENTINEL = 'Landroid/view/ViewGroup$SentinelActionMode;', PRE_DRAW = 'Lapkweb/bridge/FloatingToolbarPreDrawListener;';
const PRE_DRAW_LISTENER = 'Landroid/view/ViewTreeObserver$OnPreDrawListener;', OBSERVER = 'Landroid/view/ViewTreeObserver;', CLICK_LISTENER = 'Landroid/view/MenuItem$OnMenuItemClickListener;', EXPAND_LISTENER = 'Landroid/view/MenuItem$OnActionExpandListener;';
const DRAWABLE = 'Landroid/graphics/drawable/Drawable;', INTENT = 'Landroid/content/Intent;', TINT_LIST = 'Landroid/content/res/ColorStateList;', TINT_MODE = 'Landroid/graphics/PorterDuff$Mode;', ACTION_PROVIDER = 'Landroid/view/ActionProvider;';
const TYPE_PRIMARY = 0, TYPE_FLOATING = 1;
const SHOW_AS_ACTION_IF_ROOM = 1, SHOW_AS_ACTION_ALWAYS = 2, SHOW_AS_ACTION_COLLAPSE_ACTION_VIEW = 8;
const CHECKABLE = 1, CHECKED = 2, EXCLUSIVE = 4, HIDDEN = 8, ENABLED = 16;
const CATEGORY_TO_ORDER = [1, 4, 5, 3, 2, 0];   // MenuBuilder.sCategoryToOrder: none, CONTAINER, SYSTEM, SECONDARY, ALTERNATIVE, SELECTED_ALTERNATIVE
const META_CTRL_ON = 0x1000;
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
  const iae = (r, message) => r.throwJava('Ljava/lang/IllegalArgumentException;', message);
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
  type(MENU_BUILDER, OBJECT, [MENU], { allocatable: true });
  type(ITEM_IMPL, OBJECT, [ITEM], { allocatable: true });
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
    const menu = newMenu(r, context, SHOW_AS_ACTION_IF_ROOM); r.object(menu).callbackMode = self;
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
  def(FLOATING, 'getMenuInflater', '()Landroid/view/MenuInflater;', () => unsupported('ActionMode.getMenuInflater: the lab has no android.view.MenuInflater (menu XML inflation); add the items with Menu.add', 'menu-inflater-unsupported'));
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
  /** FloatingToolbar.getVisibleAndEnabledMenuItems sorted with its comparator: textAssist first, then SHOW_AS_ACTION_ALWAYS, then the rest, overflow-only items last, each by order. */
  const toolbarItems = (r, menuRef) => {
    const assist = textAssistId(), collect = menuValue => r.object(menuValue).items.filter(ref => { const item = r.object(ref); return isItemVisible(r, ref) && (item.flags & ENABLED) !== 0; });
    const rank = item => item.itemId === assist ? 0 : (item.showAsAction & SHOW_AS_ACTION_ALWAYS) === SHOW_AS_ACTION_ALWAYS ? 1 : (item.showAsAction & (SHOW_AS_ACTION_ALWAYS | SHOW_AS_ACTION_IF_ROOM)) === 0 ? 3 : 2;
    return collect(menuRef).map((ref, index) => ({ ref, index, item: r.object(ref) }))
      .sort((a, b) => rank(a.item) - rank(b.item) || (rank(a.item) === 2 ? a.item.categoryOrder - b.item.categoryOrder : 0) || a.index - b.index)
      .map(({ ref, item }) => ({ ref, itemId: item.itemId, groupId: item.groupId, title: charSequenceText(r, item.title) ?? '', contentDescription: charSequenceText(r, item.contentDescription), showAsAction: item.showAsAction, requiresOverflow: (item.showAsAction & (SHOW_AS_ACTION_ALWAYS | SHOW_AS_ACTION_IF_ROOM)) === 0 }));
  };

  // ================================================================================== com.android.internal.view.menu.MenuBuilder
  const newMenu = (r, context, defaultShowAsAction = 0) => {
    const self = r.allocate(MENU_BUILDER);
    Object.assign(r.object(self), { context, items: [], defaultShowAsAction, qwertyMode: false, groupDividerEnabled: false, callbackMode: null });
    return self;
  };
  const menu = (r, self) => r.object(self);
  const resources = (r, self) => call(r, menu(r, self).context, CONTEXT, 'getResources', [], RESOURCES);
  const ordering = (r, categoryOrder) => {
    const index = (categoryOrder & 0xffff0000) >> 16;
    if (index < 0 || index >= CATEGORY_TO_ORDER.length) iae(r, 'order does not contain a valid category.');
    return (CATEGORY_TO_ORDER[index] << 16) | (categoryOrder & 0xffff);
  };
  const addInternal = (r, self, groupId, itemId, categoryOrder, title) => {
    const order = ordering(r, categoryOrder), state = menu(r, self), item = r.allocate(ITEM_IMPL);
    Object.assign(r.object(item), { menu: self, groupId, itemId, categoryOrder, ordering: order, title: nullish(title) ? null : title, titleCondensed: null, iconResId: 0, icon: null, iconTintList: null, iconTintMode: null, needIconTint: false,
      intent: null, numericShortcut: 0, numericModifiers: META_CTRL_ON, alphabeticShortcut: 0, alphabeticModifiers: META_CTRL_ON, flags: ENABLED, showAsAction: state.defaultShowAsAction, actionView: null, clickListener: null,
      expandListener: null, contentDescription: null, tooltipText: null });
    let at = 0; for (let i = state.items.length - 1; i >= 0; i--) if (r.object(state.items[i]).ordering <= order) { at = i + 1; break; }   // MenuBuilder.findInsertIndex
    state.items.splice(at, 0, item);
    return item;
  };
  const resString = (r, self, id) => call(r, resources(r, self), RESOURCES, 'getString', ['I'], STRING, [id]);
  def(MENU_BUILDER, 'add', `(${CHARS})${ITEM}`, (r, _m, [self, title]) => addInternal(r, self, 0, 0, 0, title));
  def(MENU_BUILDER, 'add', `(I)${ITEM}`, (r, _m, [self, titleRes]) => addInternal(r, self, 0, 0, 0, resString(r, self, titleRes)));
  def(MENU_BUILDER, 'add', `(III${CHARS})${ITEM}`, (r, _m, [self, groupId, itemId, order, title]) => addInternal(r, self, groupId, itemId, order, title));
  def(MENU_BUILDER, 'add', `(IIII)${ITEM}`, (r, _m, [self, groupId, itemId, order, titleRes]) => addInternal(r, self, groupId, itemId, order, resString(r, self, titleRes)));
  for (const signature of [`(${CHARS})Landroid/view/SubMenu;`, '(I)Landroid/view/SubMenu;', `(III${CHARS})Landroid/view/SubMenu;`, '(IIII)Landroid/view/SubMenu;']) def(MENU_BUILDER, 'addSubMenu', signature, () => unsupported('Menu.addSubMenu: the lab menu has no SubMenuBuilder (sub-menus of an action mode or toolbar)', 'menu-submenu-unsupported'));
  def(MENU_BUILDER, 'addIntentOptions', `(IIILandroid/content/ComponentName;[${INTENT}${INTENT}I[${ITEM})I`, () => unsupported('Menu.addIntentOptions needs PackageManager.queryIntentActivityOptions over other installed apps, which the virtual device does not have', 'menu-intent-options-unsupported'));
  def(MENU_BUILDER, 'removeItem', '(I)V', (r, _m, [self, id]) => { const items = menu(r, self).items, index = items.findIndex(ref => r.object(ref).itemId === id); if (index >= 0) items.splice(index, 1); });
  def(MENU_BUILDER, 'removeGroup', '(I)V', (r, _m, [self, groupId]) => {
    const items = menu(r, self).items, index = items.findIndex(ref => r.object(ref).groupId === groupId); if (index < 0) return;
    const maxRemovable = items.length - index; let removed = 0;
    while (removed++ < maxRemovable && index < items.length && r.object(items[index]).groupId === groupId) items.splice(index, 1);
  });
  def(MENU_BUILDER, 'clear', '()V', (r, _m, [self]) => { menu(r, self).items.length = 0; });
  def(MENU_BUILDER, 'setGroupCheckable', '(IZZ)V', (r, _m, [self, groupId, checkable, exclusive]) => {
    for (const ref of menu(r, self).items) { const item = r.object(ref); if (item.groupId !== groupId) continue; item.flags = (item.flags & ~EXCLUSIVE) | (flag(exclusive) ? EXCLUSIVE : 0); item.flags = (item.flags & ~CHECKABLE) | (flag(checkable) ? CHECKABLE : 0); }
  });
  def(MENU_BUILDER, 'setGroupVisible', '(IZ)V', (r, _m, [self, groupId, visible]) => { for (const ref of menu(r, self).items) { const item = r.object(ref); if (item.groupId === groupId) item.flags = (item.flags & ~HIDDEN) | (flag(visible) ? 0 : HIDDEN); } });
  def(MENU_BUILDER, 'setGroupEnabled', '(IZ)V', (r, _m, [self, groupId, enabled]) => { for (const ref of menu(r, self).items) { const item = r.object(ref); if (item.groupId === groupId) item.flags = flag(enabled) ? item.flags | ENABLED : item.flags & ~ENABLED; } });
  def(MENU_BUILDER, 'setGroupDividerEnabled', '(Z)V', (r, _m, [self, enabled]) => { menu(r, self).groupDividerEnabled = flag(enabled); });
  def(MENU_BUILDER, 'hasVisibleItems', '()Z', (r, _m, [self]) => menu(r, self).items.some(ref => isItemVisible(r, ref)) ? 1 : 0);
  def(MENU_BUILDER, 'findItem', `(I)${ITEM}`, (r, _m, [self, id]) => menu(r, self).items.find(ref => r.object(ref).itemId === id) ?? null);
  def(MENU_BUILDER, 'size', '()I', (r, _m, [self]) => menu(r, self).items.length);
  def(MENU_BUILDER, 'getItem', `(I)${ITEM}`, (r, _m, [self, index]) => {
    const items = menu(r, self).items;
    if (index < 0 || index >= items.length) r.throwJava('Ljava/lang/IndexOutOfBoundsException;', `Index: ${index}, Size: ${items.length}`);
    return items[index];
  });
  def(MENU_BUILDER, 'close', '()V', () => {});   // MenuBuilder.close(true): an action-mode menu has no presenters (no panel or sub-menu popup) to close
  def(MENU_BUILDER, 'setQwertyMode', '(Z)V', (r, _m, [self, qwerty]) => { menu(r, self).qwertyMode = flag(qwerty); });
  def(MENU_BUILDER, 'performShortcut', '(ILandroid/view/KeyEvent;I)Z', () => unsupported('Menu.performShortcut: the lab menu does not match keyboard shortcuts (KeyEvent.getKeyData / KeyCharacterMap)', 'menu-shortcut-unsupported'));
  def(MENU_BUILDER, 'isShortcutKey', '(ILandroid/view/KeyEvent;)Z', () => unsupported('Menu.isShortcutKey: the lab menu does not match keyboard shortcuts (KeyEvent.getKeyData / KeyCharacterMap)', 'menu-shortcut-unsupported'));
  def(MENU_BUILDER, 'performIdentifierAction', '(II)Z', (r, _m, [self, id, flags]) => performItemAction(r, self, menu(r, self).items.find(ref => r.object(ref).itemId === id) ?? null, flags) ? 1 : 0);
  def(MENU_BUILDER, 'performItemAction', `(${ITEM}I)Z`, (r, _m, [self, item, flags]) => performItemAction(r, self, item, flags) ? 1 : 0);
  /** MenuBuilder.performItemAction: an enabled item is invoked; without FLAG_PERFORM_NO_CLOSE the menu closes (no presenters here). */
  const performItemAction = (r, self, itemRef, _flags) => {
    if (nullish(itemRef) || r.object(itemRef).type !== ITEM_IMPL || (r.object(itemRef).flags & ENABLED) === 0) return false;
    return invokeItem(r, itemRef);
  };
  /** MenuItemImpl.invoke: the item's click listener, the menu's callback (the action mode's onActionItemClicked), the intent. */
  const invokeItem = (r, ref) => {
    const item = r.object(ref);
    if (!nullish(item.clickListener) && flag(call(r, item.clickListener, CLICK_LISTENER, 'onMenuItemClick', [ITEM], 'Z', [ref]))) return true;
    const owner = menu(r, item.menu).callbackMode;
    if (!nullish(owner) && flag(call(r, floating(r, owner).callback, CALLBACK, 'onActionItemClicked', [ACTION_MODE, ITEM], 'Z', [owner, ref]))) return true;
    if (!nullish(item.intent)) {
      try { call(r, menu(r, item.menu).context, CONTEXT, 'startActivity', [INTENT], 'V', [item.intent]); return true; }
      catch (error) { if (error?.name !== 'JavaException' || !r.isSubtype(r.object(error.value).type, 'Landroid/content/ActivityNotFoundException;')) throw error; r.record?.('MenuItemImpl: Can\'t find activity to handle intent; ignoring'); }
    }
    return false;
  };

  // ================================================================================== com.android.internal.view.menu.MenuItemImpl
  const item = (r, self) => r.object(self);
  const isItemVisible = (r, ref) => (item(r, ref).flags & HIDDEN) === 0;
  const self = (name, signature, fn) => def(ITEM_IMPL, name, signature, (r, m, args) => { fn(r, item(r, args[0]), args, m); return args[0]; });   // setters return the item itself
  const lower = (r, value) => callStatic(r, 'Ljava/lang/Character;', 'toLowerCase', ['C'], 'C', [value]);
  const normalizeMeta = (r, value) => callStatic(r, 'Landroid/view/KeyEvent;', 'normalizeMetaState', ['I'], 'I', [value]);
  def(ITEM_IMPL, 'getItemId', '()I', (r, _m, [s]) => item(r, s).itemId);
  def(ITEM_IMPL, 'getGroupId', '()I', (r, _m, [s]) => item(r, s).groupId);
  def(ITEM_IMPL, 'getOrder', '()I', (r, _m, [s]) => item(r, s).categoryOrder);
  self('setTitle', `(${CHARS})${ITEM}`, (r, state, [, title]) => { state.title = nullish(title) ? null : title; });
  self('setTitle', `(I)${ITEM}`, (r, state, [, titleRes]) => { state.title = call(r, menu(r, state.menu).context, CONTEXT, 'getString', ['I'], STRING, [titleRes]); });
  def(ITEM_IMPL, 'getTitle', `()${CHARS}`, (r, _m, [s]) => item(r, s).title ?? null);
  self('setTitleCondensed', `(${CHARS})${ITEM}`, (r, state, [, title]) => { state.titleCondensed = nullish(title) ? null : title; });
  def(ITEM_IMPL, 'getTitleCondensed', `()${CHARS}`, (r, _m, [s]) => item(r, s).titleCondensed ?? item(r, s).title ?? null);
  def(ITEM_IMPL, 'toString', `()${STRING}`, (r, _m, [s]) => charSequenceText(r, item(r, s).title));
  self('setIcon', `(${DRAWABLE})${ITEM}`, (r, state, [, icon]) => { state.iconResId = 0; state.icon = nullish(icon) ? null : icon; state.needIconTint = true; });
  self('setIcon', `(I)${ITEM}`, (r, state, [, iconRes]) => { state.icon = null; state.iconResId = iconRes; state.needIconTint = true; });
  def(ITEM_IMPL, 'getIcon', `()${DRAWABLE}`, (r, _m, [s]) => {
    const state = item(r, s);
    if (nullish(state.icon) && state.iconResId) { state.icon = call(r, menu(r, state.menu).context, CONTEXT, 'getDrawable', ['I'], DRAWABLE, [state.iconResId]); state.iconResId = 0; }
    if (nullish(state.icon)) return null;
    if (state.needIconTint && (!nullish(state.iconTintList) || state.iconTintMode !== null)) {   // MenuItemImpl.applyIconTintIfNecessary
      state.icon = call(r, state.icon, DRAWABLE, 'mutate', [], DRAWABLE);
      if (state.hasIconTint) call(r, state.icon, DRAWABLE, 'setTintList', [TINT_LIST], 'V', [state.iconTintList]);
      if (state.iconTintMode !== null) call(r, state.icon, DRAWABLE, 'setTintMode', [TINT_MODE], 'V', [state.iconTintMode]);
      state.needIconTint = false;
    }
    return state.icon;
  });
  self('setIconTintList', `(${TINT_LIST})${ITEM}`, (r, state, [, tint]) => { state.iconTintList = nullish(tint) ? null : tint; state.hasIconTint = true; state.needIconTint = true; });
  def(ITEM_IMPL, 'getIconTintList', `()${TINT_LIST}`, (r, _m, [s]) => item(r, s).iconTintList ?? null);
  self('setIconTintMode', `(${TINT_MODE})${ITEM}`, (r, state, [, tintMode]) => { state.iconTintMode = nullish(tintMode) ? null : tintMode; state.needIconTint = true; });
  def(ITEM_IMPL, 'getIconTintMode', `()${TINT_MODE}`, (r, _m, [s]) => item(r, s).iconTintMode ?? null);
  self('setIntent', `(${INTENT})${ITEM}`, (r, state, [, intent]) => { state.intent = nullish(intent) ? null : intent; });
  def(ITEM_IMPL, 'getIntent', `()${INTENT}`, (r, _m, [s]) => item(r, s).intent ?? null);
  self('setShortcut', '(CC)' + ITEM, (r, state, [, numeric, alpha]) => { state.numericShortcut = numeric; state.alphabeticShortcut = lower(r, alpha); });
  self('setShortcut', '(CCII)' + ITEM, (r, state, [, numeric, alpha, numericModifiers, alphaModifiers]) => { state.numericShortcut = numeric; state.numericModifiers = normalizeMeta(r, numericModifiers); state.alphabeticShortcut = lower(r, alpha); state.alphabeticModifiers = normalizeMeta(r, alphaModifiers); });
  self('setNumericShortcut', '(C)' + ITEM, (r, state, [, numeric]) => { state.numericShortcut = numeric; });
  self('setNumericShortcut', '(CI)' + ITEM, (r, state, [, numeric, modifiers]) => { state.numericShortcut = numeric; state.numericModifiers = normalizeMeta(r, modifiers); });
  def(ITEM_IMPL, 'getNumericShortcut', '()C', (r, _m, [s]) => item(r, s).numericShortcut);
  def(ITEM_IMPL, 'getNumericModifiers', '()I', (r, _m, [s]) => item(r, s).numericModifiers);
  self('setAlphabeticShortcut', '(C)' + ITEM, (r, state, [, alpha]) => { state.alphabeticShortcut = lower(r, alpha); });
  self('setAlphabeticShortcut', '(CI)' + ITEM, (r, state, [, alpha, modifiers]) => { state.alphabeticShortcut = lower(r, alpha); state.alphabeticModifiers = normalizeMeta(r, modifiers); });
  def(ITEM_IMPL, 'getAlphabeticShortcut', '()C', (r, _m, [s]) => item(r, s).alphabeticShortcut);
  def(ITEM_IMPL, 'getAlphabeticModifiers', '()I', (r, _m, [s]) => item(r, s).alphabeticModifiers);
  self('setCheckable', `(Z)${ITEM}`, (r, state, [, checkable]) => { state.flags = (state.flags & ~CHECKABLE) | (flag(checkable) ? CHECKABLE : 0); });
  def(ITEM_IMPL, 'isCheckable', '()Z', (r, _m, [s]) => (item(r, s).flags & CHECKABLE) ? 1 : 0);
  self('setChecked', `(Z)${ITEM}`, (r, state, [s, checked]) => {
    if (state.flags & EXCLUSIVE) {   // MenuBuilder.setExclusiveItemChecked: within the group only this exclusive-checkable item is checked
      for (const ref of menu(r, state.menu).items) { const other = r.object(ref); if (other.groupId !== state.groupId || !(other.flags & EXCLUSIVE) || !(other.flags & CHECKABLE)) continue; other.flags = (other.flags & ~CHECKED) | (same(ref, s) ? CHECKED : 0); }
    } else state.flags = (state.flags & ~CHECKED) | (flag(checked) ? CHECKED : 0);
  });
  def(ITEM_IMPL, 'isChecked', '()Z', (r, _m, [s]) => (item(r, s).flags & CHECKED) ? 1 : 0);
  self('setVisible', `(Z)${ITEM}`, (r, state, [, visible]) => { state.flags = (state.flags & ~HIDDEN) | (flag(visible) ? 0 : HIDDEN); });
  def(ITEM_IMPL, 'isVisible', '()Z', (r, _m, [s]) => isItemVisible(r, s) ? 1 : 0);
  self('setEnabled', `(Z)${ITEM}`, (r, state, [, enabled]) => { state.flags = flag(enabled) ? state.flags | ENABLED : state.flags & ~ENABLED; });
  def(ITEM_IMPL, 'isEnabled', '()Z', (r, _m, [s]) => (item(r, s).flags & ENABLED) ? 1 : 0);
  def(ITEM_IMPL, 'hasSubMenu', '()Z', () => 0);
  def(ITEM_IMPL, 'getSubMenu', '()Landroid/view/SubMenu;', () => null);
  self('setOnMenuItemClickListener', `(${CLICK_LISTENER})${ITEM}`, (r, state, [, listener]) => { state.clickListener = nullish(listener) ? null : listener; });
  def(ITEM_IMPL, 'getMenuInfo', '()Landroid/view/ContextMenu$ContextMenuInfo;', () => null);
  def(ITEM_IMPL, 'setShowAsAction', '(I)V', (r, _m, [s, actionEnum]) => {
    if ((actionEnum & 3) === 3) iae(r, 'SHOW_AS_ACTION_ALWAYS, SHOW_AS_ACTION_IF_ROOM, and SHOW_AS_ACTION_NEVER are mutually exclusive.');
    item(r, s).showAsAction = actionEnum;
  });
  def(ITEM_IMPL, 'setShowAsActionFlags', `(I)${ITEM}`, (r, _m, [s, actionEnum]) => { call(r, s, ITEM, 'setShowAsAction', ['I'], 'V', [actionEnum]); return s; });
  self('setActionView', `(${VIEW})${ITEM}`, (r, state, [, view]) => {
    state.actionView = nullish(view) ? null : view;
    if (!nullish(view) && call(r, view, VIEW, 'getId', [], 'I') === -1 && state.itemId > 0) call(r, view, VIEW, 'setId', ['I'], 'V', [state.itemId]);
  });
  def(ITEM_IMPL, 'setActionView', `(I)${ITEM}`, (r, _m, [s, layout]) => {
    const context = menu(r, item(r, s).menu).context, inflater = callStatic(r, 'Landroid/view/LayoutInflater;', 'from', [CONTEXT], 'Landroid/view/LayoutInflater;', [context]);
    const view = call(r, inflater, 'Landroid/view/LayoutInflater;', 'inflate', ['I', GROUP, 'Z'], VIEW, [layout, construct(r, 'Landroid/widget/LinearLayout;', [CONTEXT], [context]), 0]);
    return call(r, s, ITEM, 'setActionView', [VIEW], ITEM, [view]);
  });
  def(ITEM_IMPL, 'getActionView', `()${VIEW}`, (r, _m, [s]) => item(r, s).actionView ?? null);
  def(ITEM_IMPL, 'setActionProvider', `(${ACTION_PROVIDER})${ITEM}`, (r, _m, [s, provider]) => {
    if (!nullish(provider)) unsupported('MenuItem.setActionProvider: android.view.ActionProvider is not part of the lab menu', 'menu-action-provider-unsupported');
    item(r, s).actionView = null; return s;
  });
  def(ITEM_IMPL, 'getActionProvider', `()${ACTION_PROVIDER}`, () => null);
  const collapsible = state => (state.showAsAction & SHOW_AS_ACTION_COLLAPSE_ACTION_VIEW) !== 0 && !nullish(state.actionView);
  // expand / collapse reach MenuBuilder.expandItemActionView / collapseItemActionView, which answer false without a presenter (an action bar) to show the view
  def(ITEM_IMPL, 'expandActionView', '()Z', (r, _m, [s]) => {
    const state = item(r, s); if (!collapsible(state)) return 0;
    if (!nullish(state.expandListener)) call(r, state.expandListener, EXPAND_LISTENER, 'onMenuItemActionExpand', [ITEM], 'Z', [s]);
    return 0;
  });
  def(ITEM_IMPL, 'collapseActionView', '()Z', (r, _m, [s]) => {
    const state = item(r, s); if ((state.showAsAction & SHOW_AS_ACTION_COLLAPSE_ACTION_VIEW) === 0) return 0; if (nullish(state.actionView)) return 1;
    if (!nullish(state.expandListener)) call(r, state.expandListener, EXPAND_LISTENER, 'onMenuItemActionCollapse', [ITEM], 'Z', [s]);
    return 0;
  });
  def(ITEM_IMPL, 'isActionViewExpanded', '()Z', () => 0);
  self('setOnActionExpandListener', `(${EXPAND_LISTENER})${ITEM}`, (r, state, [, listener]) => { state.expandListener = nullish(listener) ? null : listener; });
  self('setContentDescription', `(${CHARS})${ITEM}`, (r, state, [, text]) => { state.contentDescription = nullish(text) ? null : text; });
  def(ITEM_IMPL, 'getContentDescription', `()${CHARS}`, (r, _m, [s]) => item(r, s).contentDescription ?? null);
  self('setTooltipText', `(${CHARS})${ITEM}`, (r, state, [, text]) => { state.tooltipText = nullish(text) ? null : text; });
  def(ITEM_IMPL, 'getTooltipText', `()${CHARS}`, (r, _m, [s]) => item(r, s).tooltipText ?? null);

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
      return { handled: performItemAction(r, modeState.menu, entry.ref, 0) };
    }
    return null;
  };
  return registry;
}
