import { parseSignature, floatBits } from './host-contract.js?v=7467c4d87e1f';
import { APKError } from './apk-error.js?v=7467c4d87e1f';

// The attribute pass of the android.view.View and android.view.ViewGroup constructors and of ViewGroup.LayoutParams / MarginLayoutParams, as android-13.0.0_r1 runs it:
// one TypedArray over the class's styleable (the tag's attributes, its style="", the default style and the theme, in Android's precedence: AndroidStyleBackend.obtain), read in
// attribute-id order as TypedArray.getIndex gives them, each attribute applied the way the original constructor applies it (View.java View(Context, AttributeSet, int, int),
// ViewGroup.java initFromAttributes and MarginLayoutParams(Context, AttributeSet)). Values go through the View's own setters or the state those setters keep, so the getter an
// app calls afterwards returns what the XML said. docs/XML-ATTRIBUTES.md has the per-attribute table.
//
// An attribute never fails the inflation. When the lab cannot apply one (the setter it needs refuses with an explicit "unsupported" error), the attribute is reported under
// "XML attributes NOT APPLIED" with the reason and the pass continues; a Java exception the original constructor would throw (a missing resource, an illegal value) still
// propagates, as on a device. An attribute that the lab keeps but that changes nothing a user of this VM can see is reported under "accepted, no effect in this VM".
const VIEW = 'Landroid/view/View;', GROUP = 'Landroid/view/ViewGroup;', TA = 'Landroid/content/res/TypedArray;', CONTEXT = 'Landroid/content/Context;', ATTRIBUTES = 'Lapkweb/bridge/AttributeSet;';
const DRAWABLE = 'Landroid/graphics/drawable/Drawable;', TINT = 'Landroid/content/res/ColorStateList;', BLEND = 'Landroid/graphics/BlendMode;', CHARS = 'Ljava/lang/CharSequence;', STRING = 'Ljava/lang/String;';
const DECLARED_CLICK = 'Landroid/view/View$DeclaredOnClickListener;', CLICK = 'Landroid/view/View$OnClickListener;', POINTER_ICON = 'Landroid/view/PointerIcon;', APPLICATION_INFO = 'Landroid/content/pm/ApplicationInfo;';
const MARGIN_PARAMS = 'Landroid/view/ViewGroup$MarginLayoutParams;';
const NO_ID = -1, UNDEFINED_PADDING = -2147483648, UNDEFINED_MARGIN = -2147483648;

// R.styleable.View: every attribute the View constructor's switch reads, the ones initializeScrollbarsInternal / initializeFadingEdgeInternal read from the same TypedArray, and
// android:theme (in the styleable, read by LayoutInflater.createViewFromTag, never by View).
export const VIEW_ATTRIBUTES = ['background', 'padding', 'paddingHorizontal', 'paddingVertical', 'paddingLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingStart', 'paddingEnd',
  'scrollX', 'scrollY', 'alpha', 'transformPivotX', 'transformPivotY', 'translationX', 'translationY', 'translationZ', 'elevation', 'rotation', 'rotationX', 'rotationY', 'scaleX', 'scaleY',
  'id', 'tag', 'fitsSystemWindows', 'focusable', 'focusableInTouchMode', 'clickable', 'allowClickWhenDisabled', 'longClickable', 'contextClickable', 'saveEnabled', 'duplicateParentState',
  'visibility', 'layoutDirection', 'drawingCacheQuality', 'contentDescription', 'accessibilityTraversalBefore', 'accessibilityTraversalAfter', 'labelFor', 'soundEffectsEnabled',
  'hapticFeedbackEnabled', 'scrollbars', 'fadingEdge', 'requiresFadingEdge', 'scrollbarStyle', 'isScrollContainer', 'keepScreenOn', 'filterTouchesWhenObscured', 'nextFocusLeft',
  'nextFocusRight', 'nextFocusUp', 'nextFocusDown', 'nextFocusForward', 'nextClusterForward', 'minWidth', 'minHeight', 'onClick', 'overScrollMode', 'verticalScrollbarPosition', 'layerType',
  'textDirection', 'textAlignment', 'importantForAccessibility', 'accessibilityLiveRegion', 'transitionName', 'nestedScrollingEnabled', 'stateListAnimator', 'backgroundTint',
  'backgroundTintMode', 'outlineProvider', 'foreground', 'foregroundGravity', 'foregroundTintMode', 'foregroundTint', 'foregroundInsidePadding', 'scrollIndicators', 'pointerIcon',
  'forceHasOverlappingRendering', 'tooltipText', 'keyboardNavigationCluster', 'focusedByDefault', 'autofillHints', 'importantForAutofill', 'importantForContentCapture',
  'defaultFocusHighlightEnabled', 'screenReaderFocusable', 'accessibilityPaneTitle', 'outlineSpotShadowColor', 'outlineAmbientShadowColor', 'accessibilityHeading', 'forceDarkAllowed',
  'scrollCaptureHint', 'clipToOutline', 'preferKeepClear', 'autoHandwritingEnabled',
  'fadeScrollbars', 'scrollbarFadeDuration', 'scrollbarDefaultDelayBeforeFade', 'scrollbarSize', 'scrollbarTrackHorizontal', 'scrollbarThumbHorizontal', 'scrollbarAlwaysDrawHorizontalTrack',
  'scrollbarTrackVertical', 'scrollbarThumbVertical', 'scrollbarAlwaysDrawVerticalTrack', 'fadingEdgeLength', 'theme'];
// R.styleable.ViewGroup (ViewGroup.initFromAttributes).
export const GROUP_ATTRIBUTES = ['clipChildren', 'clipToPadding', 'animationCache', 'persistentDrawingCache', 'addStatesFromChildren', 'alwaysDrawnWithCache', 'layoutAnimation',
  'descendantFocusability', 'splitMotionEvents', 'animateLayoutChanges', 'layoutMode', 'transitionGroup', 'touchscreenBlocksFocus'];
// R.styleable.ViewGroup_MarginLayout (MarginLayoutParams(Context, AttributeSet)); ViewGroup_Layout is its first two.
export const MARGIN_ATTRIBUTES = ['layout_width', 'layout_height', 'layout_margin', 'layout_marginLeft', 'layout_marginTop', 'layout_marginRight', 'layout_marginBottom', 'layout_marginStart',
  'layout_marginEnd', 'layout_marginHorizontal', 'layout_marginVertical'];
/** Names that another class's styleable also declares (TextView / ProgressBar minWidth and minHeight, ProgressBar backgroundTint*): the View part is applied here, the class's own part by its own pass. */
const SHARED_WITH_SUBCLASS = new Set(['minWidth', 'minHeight', 'backgroundTint', 'backgroundTintMode']);
// What an attribute that is kept but changes nothing in this VM is reported with (the value is still what its getter returns).
const NO_EFFECT = {
  layoutMode: 'optical bounds need the optical-insets pass of measure and layout, which the lab does not run; the group is laid out by its clip bounds',
  pointerIcon: 'the page does not change the mouse cursor over a View',
  scrollBar: "the View's own scroll bar is not drawn (the page shows its scroll indicator); the value is kept for the View API",
  fadingEdge: 'fading edges are not drawn; the value is kept for the View API',
  scrollIndicators: 'scroll indicators are not drawn; the value is kept for the View API',
};
// The look of the View's own scroll bar and of its fading edges: applied to the View's state, not drawn. Said for the attributes a tag itself carries (a theme gives most Views some).
const NOT_DRAWN = { scrollbarStyle: 'scrollBar', fadeScrollbars: 'scrollBar', scrollbarFadeDuration: 'scrollBar', scrollbarDefaultDelayBeforeFade: 'scrollBar', scrollbarSize: 'scrollBar',
  scrollbarTrackHorizontal: 'scrollBar', scrollbarThumbHorizontal: 'scrollBar', scrollbarTrackVertical: 'scrollBar', scrollbarThumbVertical: 'scrollBar', scrollbarAlwaysDrawHorizontalTrack: 'scrollBar',
  scrollbarAlwaysDrawVerticalTrack: 'scrollBar', verticalScrollbarPosition: 'scrollBar', requiresFadingEdge: 'fadingEdge', fadingEdgeLength: 'fadingEdge', scrollIndicators: 'scrollIndicators' };
/** styleable -> attribute -> why: what this pass keeps and says under "XML attributes accepted, no effect in this VM" (docs/XML-ATTRIBUTES.md counts them from here). */
export const VIEW_ATTRIBUTES_WITHOUT_EFFECT = { View: { ...Object.fromEntries(Object.entries(NOT_DRAWN).map(([name, kind]) => [name, NO_EFFECT[kind]])), pointerIcon: NO_EFFECT.pointerIcon }, ViewGroup: { layoutMode: `(the value opticalBounds) ${NO_EFFECT.layoutMode}` } };
const ANDROID_NAMESPACE = 'http://schemas.android.com/apk/res/android';
// Read only together with android:scrollbars (initializeScrollbarsInternal) or requiresFadingEdge (initializeFadingEdgeInternal), or by LayoutInflater (android:theme): alone they change nothing.
const READ_WITH_ANOTHER = new Set(['fadeScrollbars', 'scrollbarFadeDuration', 'scrollbarDefaultDelayBeforeFade', 'scrollbarSize', 'scrollbarTrackHorizontal', 'scrollbarThumbHorizontal',
  'scrollbarAlwaysDrawHorizontalTrack', 'scrollbarTrackVertical', 'scrollbarThumbVertical', 'scrollbarAlwaysDrawVerticalTrack', 'fadingEdgeLength', 'theme']);

/** Adds the constructor attribute passes to the platform (platform.viewXmlAttributes) and the framework members they need to an existing contract-host registry. */
export function installViewXmlAttributes(platform, registry) {
  const { def } = registry, lists = new WeakMap(), subclassPasses = [];
  const nullish = value => value === null || value === undefined || value === 0;
  const method = (owner, name, signature) => ({ owner, name, signature, ...parseSignature(signature) });
  const call = (r, kind, owner, name, signature, args) => r.dispatch(method(owner, name, signature), args, kind);
  const table = () => platform.resources?.frameworkTable || platform.resources?.table || null;
  // Context.getApplicationInfo() of the Context a View or its LayoutParams are built with, as the original constructors ask it (the Context may belong to a second package);
  // without a Context, the loaded app's manifest (AndroidPlatform.contextApplication).
  const targetSdk = (r, context) => platform.contextApplication(r, context ?? null).targetSdk;
  const truthy = value => value === true || value === 'true' || (typeof value === 'number' && value !== 0);
  /** android:supportsRtl of the loaded app's manifest (what its ApplicationInfo.flags are built from). */
  const hasRtlSupport = () => truthy(platform.manifest?.application?.supportsRtl);
  /** View.isRtlCompatibilityMode(): before Jelly Bean MR1, or an application without android:supportsRtl. */
  const rtlCompatibility = (r, context) => { const application = platform.contextApplication(r, context ?? null); return application.targetSdk < 17 || !application.supportsRtl; };
  const isJava = error => error?.name === 'JavaException';
  const javaIs = (r, error, type) => isJava(error) && r.isSubtype(r.typeOf(error.value), type);

  // The public id of a framework attribute (0x0101xxxx, what an app's compiled XML carries). The framework table can also hold the same name under a staging id, which
  // findId would return; the public one is looked up among the table's entries once.
  const publicIds = new WeakMap(), publicNames = new WeakMap();
  const attributeId = name => {
    const source = table(); if (!source) return 0;
    let ids = publicIds.get(source);
    if (!ids) { ids = new Map(); const names = new Map(); for (const [id, entries] of source.entries ?? []) if ((id >>> 16) === 0x0101 && entries?.[0]?.resourceType === 'attr' && !ids.has(entries[0].name)) { ids.set(entries[0].name, id >>> 0); names.set(id >>> 0, entries[0].name); } publicIds.set(source, ids); publicNames.set(source, names); }
    return ids.get(name) ?? ((source.findId('attr/' + name) ?? 0) >>> 0);
  };
  /** The name of a public framework attribute id (0x0101xxxx), or null. */
  const attributeName = id => { attributeId('id'); const source = table(); return (source && publicNames.get(source)?.get(id >>> 0)) ?? null; };
  /** The attribute ids of a styleable in ascending order (as R.styleable arrays are), with the index of each name; names the resource table does not have are left out. */
  const styleable = (r, key, names) => {
    let cached = lists.get(r); if (!cached) lists.set(r, cached = new Map());
    if (cached.has(key)) return cached.get(key);
    const found = names.map(name => ({ name, id: attributeId(name) })).filter(entry => entry.id).sort((a, b) => a.id - b.id);
    const result = { names: found.map(entry => entry.name), ids: found.map(entry => entry.id | 0), index: new Map(found.map((entry, index) => [entry.name, index])), handled: new Set(found.map(entry => entry.name)),
      ownIds: found.filter(entry => !READ_WITH_ANOTHER.has(entry.name)).map(entry => entry.id), beyondId: new Set(found.map(entry => entry.name).filter(name => name !== 'id')) };   // the attributes the constructor's own switch acts on
    cached.set(key, result); return result;
  };
  // Whether a theme gives any of a styleable's attributes directly (asked once per theme and styleable; a theme that gained entries is asked again).
  const themeAnswers = new WeakMap();
  const themeGives = (r, context, key, ids) => {
    const values = r.object(theme(r, context)).themeValues; if (!values) return true;
    let answers = themeAnswers.get(values); if (!answers) themeAnswers.set(values, answers = new Map());
    const known = answers.get(key); if (known && known.size === values.size) return known.gives;
    const gives = ids.some(id => values.has(id >>> 0)); answers.set(key, { size: values.size, gives }); return gives;
  };
  /** Whether the tag itself can give one of the names: an android: attribute of the list, or a style="" (whose items are not known without reading it). */
  const tagGives = (node, names) => !!node && node.attributes.some(attribute => attribute.namespace === ANDROID_NAMESPACE ? names.has(attribute.name) : attribute.namespace === null && attribute.name === 'style');
  /** A reader over one TypedArray: the TypedArray getters by attribute name. */
  const reader = (r, array, list) => {
    const at = name => list.index.get(name), get = (name, signature, ...values) => call(r, 'virtual', TA, name, signature, [array, ...values]);
    // TypedArray.getIndexCount / getIndex / hasValue / getType are reads of the array's own records (mIndices, and the type slot of mData's 7-int records): read here without a call.
    // Every other value goes through the original getter, which converts it; a getter asked for an attribute without a value returns its default, so it is not called for one.
    const data = r.array(platform.styleBackend.get(r, array, TA, 'mData', '[I')).elements, indices = r.array(platform.styleBackend.get(r, array, TA, 'mIndices', '[I')).elements;
    const present = []; for (let i = 1; i <= indices[0]; i++) present.push(list.names[indices[i]]);
    const type = name => at(name) === undefined ? 0 : data[at(name) * 7] | 0, has = name => type(name) !== 0;
    return {
      present, has, type,
      bool: (name, fallback) => has(name) ? !!get('getBoolean', '(IZ)Z', at(name), fallback ? 1 : 0) : !!fallback,
      int: (name, fallback) => has(name) ? get('getInt', '(II)I', at(name), fallback) | 0 : fallback,
      floatBits: (name, fallback) => has(name) ? get('getFloat', '(IF)F', at(name), floatBits(fallback)) : floatBits(fallback),
      dimensionBits: (name, fallback) => has(name) ? get('getDimension', '(IF)F', at(name), floatBits(fallback)) : floatBits(fallback),
      size: (name, fallback) => has(name) ? get('getDimensionPixelSize', '(II)I', at(name), fallback) | 0 : fallback,
      offset: (name, fallback) => has(name) ? get('getDimensionPixelOffset', '(II)I', at(name), fallback) | 0 : fallback,
      resource: (name, fallback) => has(name) ? get('getResourceId', '(II)I', at(name), fallback) | 0 : fallback,
      color: (name, fallback) => has(name) ? get('getColor', '(II)I', at(name), fallback) | 0 : fallback,
      string: name => has(name) ? get('getString', `(I)${STRING}`, at(name)) ?? null : null,
      text: name => has(name) ? get('getText', `(I)${CHARS}`, at(name)) ?? null : null,
      textArray: name => get('getTextArray', `(I)[${CHARS}`, at(name)) ?? null,
      drawable: name => has(name) ? get('getDrawable', `(I)${DRAWABLE}`, at(name)) ?? null : null,
      colors: name => has(name) ? get('getColorStateList', `(I)${TINT}`, at(name)) ?? null : null,
      /** The raw data word of the value (a dimension's complex value, a resource id of a reference). */
      data: name => at(name) === undefined ? 0 : data[at(name) * 7 + 1] | 0,
      /** The resource the value came from (a colour state list, a drawable, a string resource), 0 for a value written in place. */
      source: name => at(name) === undefined ? 0 : data[at(name) * 7 + 3] >>> 0,
      /** TypedArray.getFont(index), or null when the value is not a font resource (the original throws UnsupportedOperationException / NotFoundException for those). */
      font: name => {
        if (!has(name)) return null;
        try { return get('getFont', '(I)Landroid/graphics/Typeface;', at(name)) ?? null; }
        catch (error) { if (javaIs(r, error, 'Ljava/lang/UnsupportedOperationException;') || javaIs(r, error, 'Landroid/content/res/Resources$NotFoundException;')) return null; throw error; }
      },
      array,
      recycle: () => get('recycle', '()V'),
    };
  };
  const tagOf = view => view.xmlTag ?? view.type.slice(1, -1).replaceAll('/', '.');
  const noteNoEffect = (r, name, tag, reason) => {
    const notes = platform.xmlAttributesNoEffect ??= new Map(), key = `android:${name} on <${tag}>`, seen = notes.get(key);
    if (!seen && notes.size >= 400) { if ((platform.xmlAttributesNoEffectDropped = (platform.xmlAttributesNoEffectDropped ?? 0) + 1) === 1) r.record('XML attributes accepted without effect: more than 400 kinds (attribute and tag); the further ones are counted, not listed'); return; }   // bounded, never silent
    notes.set(key, { count: (seen?.count ?? 0) + 1, reason });
    if (!seen) r.record(`XML attribute accepted, no effect in this VM: ${key} (${reason})`);
  };
  /**
   * Runs the application of one attribute. An explicit "unsupported" failure of the lab reports the attribute as not applied. So does a RuntimeException the value causes
   * (a setter that refuses it, a getter that cannot read it): on a device that exception ends the inflation of the screen, here the attribute is left out and said (the
   * owner's rule: an android: attribute never fails an inflation, whatever its value). An Error (out of memory, stack overflow) and a checked exception are not about the value,
   * and neither is an exception that a method of the app threw (a View subclass of the app that overrides the setter): that one propagates.
   */
  const attempt = (r, view, name, apply) => {
    try { apply(); }
    catch (error) {
      if (platform.thrownByAppCode(r, error)) throw error;   // an exception of the app's own code (its override of the setter): the app's, as on a device
      if (javaIs(r, error, 'Ljava/lang/RuntimeException;')) { platform.noteXmlAttributeNotApplied(r, name, tagOf(view), platform.javaRefusalReason(r, error)); return; }
      // Only the lab's own explicit refusals (an APKError naming what is unsupported) become a report. A limit of the VM (the instruction budget, the heap) and a defect (any other
      // JavaScript error) are not about the attribute and propagate.
      if (isJava(error) || error?.name !== 'APKError' || error.details?.kind === 'instruction-budget' || /budget|heap|limit exceeded|aborted|cancell?ed/i.test(String(error.message))) throw error;
      platform.noteXmlAttributeNotApplied(r, name, tagOf(view), platform.refusalReason(error));
    }
  };
  const attributeSet = (r, node) => { if (!node) return null; const attrs = r.makeObject(ATTRIBUTES); r.object(attrs).node = node; return attrs; };
  const theme = (r, context) => platform.styleBackend.theme(r, context);
  const parseBlendMode = (r, value) => call(r, 'static', DRAWABLE, 'parseBlendMode', `(I${BLEND})${BLEND}`, [value, null]) ?? null;
  const set = (r, self, name, signature, values = [], kind = 'virtual', owner = VIEW) => call(r, kind, owner, name, signature, [self, ...values]);
  const colorText = color => `#${(color >>> 0).toString(16).padStart(8, '0')}`;

  /** View.resolveLayoutDirection(): the resolved direction of a raw one (LTR, RTL, INHERIT from the parent, LOCALE); always LTR in RTL compatibility mode. */
  const resolveDirection = (r, view, raw) => {
    if (rtlCompatibility(r, view.context)) return 0;
    if (raw === 1) return 1;
    if (raw === 2) { const parent = view.parent && typeof view.parent === 'object' ? r.object(view.parent) : null; return parent && r.isSubtype(parent.type, VIEW) ? (parent.layoutDirection === 1 ? 1 : 0) : 0; }
    if (raw === 3) {
      try { const locale = call(r, 'static', 'Ljava/util/Locale;', 'getDefault', '()Ljava/util/Locale;', []); return call(r, 'static', 'Landroid/text/TextUtils;', 'getLayoutDirectionFromLocale', '(Ljava/util/Locale;)I', [locale]) === 1 ? 1 : 0; }
      catch (error) { if (isJava(error)) throw error; return 0; }
    }
    return 0;
  };
  /** View.internalSetPadding: an inset scroll bar style (insideInset, outsideInset) adds the scroll bar's size to the padding of the side the bar is on. */
  const scrollbarInsets = (r, self) => {
    const view = r.object(self), inset = { left: 0, right: 0, bottom: 0 };
    if (!(view.verticalScrollBar || view.horizontalScrollBar) || !((view.scrollBarStyle ?? 0) & 0x01000000)) return inset;   // SCROLLBARS_INSET_MASK
    if (view.verticalScrollBar) { const position = view.verticalScrollbarPosition ?? 0, side = position === 1 || (position === 0 && view.layoutDirection === 1) ? 'left' : 'right'; inset[side] += call(r, 'virtual', VIEW, 'getVerticalScrollbarWidth', '()I', [self]); }
    if (view.horizontalScrollBar) inset.bottom += call(r, 'virtual', VIEW, 'getHorizontalScrollbarHeight', '()I', [self]);
    return inset;
  };
  const definedPadding = value => value !== undefined && value !== UNDEFINED_PADDING;
  /** Writes mPaddingLeft .. mPaddingBottom as View.internalSetPadding does: the user padding "initial" values (what setPadding, the XML or the background gave) are not touched. */
  const writePadding = (r, self, next) => {
    const view = r.object(self), value = { left: next.left || 0, top: next.top || 0, right: next.right || 0, bottom: next.bottom || 0 };
    if (view.nativeFieldAccessors) for (const edge of ['left', 'top', 'right', 'bottom']) view.padding[edge] = value[edge];   // a whole assignment is a new initial padding (AndroidPlatform.syncViewFields)
    else view.padding = value;
  };
  /**
   * View.resolvePadding(): android:paddingStart / paddingEnd (or setPaddingRelative) become the left / right padding of the resolved layout direction, the side a relative padding
   * does not define is the user padding "initial" value; nothing in RTL compatibility mode. The class is told through internalSetPadding when it overrides it (CheckedTextView
   * adds its check mark there). This is the one implementation: the XML pass, setLayoutDirection, setPaddingRelative and a measure that finds a new inherited direction end here.
   */
  const resolveRelativePadding = (r, self) => {
    const view = r.object(self), start = view.userPaddingStart ?? UNDEFINED_PADDING, end = view.userPaddingEnd ?? UNDEFINED_PADDING;
    if ((start === UNDEFINED_PADDING && end === UNDEFINED_PADDING) || rtlCompatibility(r, view.context)) return;
    const rtl = view.layoutDirection === 1, current = { left: 0, top: 0, right: 0, bottom: 0, ...(view.padding || {}) };
    const next = { ...current, left: view.userPaddingLeftInitial ?? current.left, right: view.userPaddingRightInitial ?? current.right };
    if (start !== UNDEFINED_PADDING) next[rtl ? 'right' : 'left'] = start;
    if (end !== UNDEFINED_PADDING) next[rtl ? 'left' : 'right'] = end;
    if (r.objectOverride(view.type, 'internalSetPadding(IIII)V')) {
      if (next.left === current.left && next.right === current.right) return;
      platform.syncViewFields?.(r, self); call(r, 'virtual', VIEW, 'internalSetPadding', '(IIII)V', [self, next.left, next.top, next.right, next.bottom]);
    } else {
      const inset = scrollbarInsets(r, self); next.left += inset.left; next.right += inset.right;
      if (next.left === current.left && next.right === current.right) return;
      writePadding(r, self, next); platform.syncViewFields?.(r, self);
    }
    if (view.laidOut) platform.viewLayoutHost?.invoke(r, { name: 'requestLayout' }, [self]);
  };
  /**
   * View.setLayoutDirection / the android:layoutDirection attribute / a View that inherits and whose parent's direction changed: keeps the raw value, resolves it
   * (View.resolveLayoutDirection) and re-resolves what depends on it: the relative padding and the LayoutParams' relative margins. A child that inherits the direction takes the
   * new one at its next measure pass (View.resolveRtlPropertiesIfNeeded, view-layout-host.js), as on Android, where setLayoutDirection resets the children's resolution.
   * The View's own state is Android's whatever lays it out (its direction, padding and margins are what the probes of docs/XML-ATTRIBUTES.md read back). Where the layout
   * containers are the host classes (no layouts profile: they place children left-to-right only) a direction that resolves to right-to-left is said so, once, under
   * "Framework behaviour NOT IMPLEMENTED": the container does not mirror its children.
   */
  const applyLayoutDirection = (r, self, raw) => {
    const view = r.object(self), resolved = resolveDirection(r, view, raw), changed = (view.layoutDirection || 0) !== resolved;
    if (resolved === 1 && changed && !platform.rtlLayoutAvailable(r)) platform.noteFrameworkGap(r, 'rtl-host-layout', platform.rtlNeedsProfile);
    view.layoutDirectionRaw = raw; view.layoutDirection = resolved;
    resolveRelativePadding(r, self);
    if (view.layoutParams && typeof view.layoutParams === 'object' && r.isSubtype(r.typeOf(view.layoutParams), MARGIN_PARAMS)) call(r, 'virtual', MARGIN_PARAMS, 'resolveLayoutDirection', '(I)V', [view.layoutParams, resolved]);   // View.resolveLayoutParams
    return changed;
  };

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------- android.view.View
  /**
   * View(Context, AttributeSet, int defStyleAttr, int defStyleRes). `node` is the XML tag (null for a View built in code with a default style). Returns the names of
   * R.styleable.View this pass owns (the caller must not apply them again), or null when the pass could not run (no resource table, no TypedArray class).
   */
  const applyView = (r, self, node, context) => {
    const view = r.object(self), source = table();
    if (!source || !context || !r.classes.has(TA) || !platform.styleBackend) return null;
    // The default style (defStyleAttr / defStyleRes) is read where the VM measures and draws the View itself (a Skia backend and the framework's own styles); in the page-laid-out
    // flow mode the page gives widgets their look, so only the tag's attributes and its style="" are read there, as before.
    const styled = !!r.skia && !!platform.resources.frameworkXml;
    let defStyleAttr = 0, defStyleRes = 0;
    if (styled) {
      defStyleAttr = view.defStyleExplicit ? view.defStyleAttr | 0 : (view.defStyleAttr || (r.isSubtype(view.type, 'Landroid/widget/TextView;') ? source.findId(platform.drawableViewHost.defaultStyleName(r, view.type)) : 0)) | 0;
      defStyleRes = view.defStyleRes | 0;
    }
    if (!node && !defStyleAttr && !defStyleRes) return null;
    const list = styleable(r, 'View', VIEW_ATTRIBUTES);
    // Nothing to read: no attribute of the styleable on the tag, no style, no default style, and the theme gives none directly, apart from the scroll bar and fading edge values
    // that only android:scrollbars / requiresFadingEdge read. The constructor would loop over nothing.
    // (android:id alone does not count: the XML pass sets the id of every tag itself.)
    if (!defStyleAttr && !defStyleRes && !tagGives(node, list.beyondId) && !themeGives(r, context, 'View', list.ownIds)) return list.handled;
    const ids = r.newArray('[I', list.ids.length); r.object(ids).elements = [...list.ids];
    const array = platform.styleBackend.obtain(r, theme(r, context), attributeSet(r, node), ids, defStyleAttr, defStyleRes), a = reader(r, array, list);
    const flag = (name, setter, kind = 'direct') => { if (a.bool(name, false)) set(r, self, setter, '(Z)V', [1], kind); };
    const id = (name, setter) => set(r, self, setter, '(I)V', [a.resource(name, NO_ID)], 'direct');
    let background = null, backgroundColor = null, hasBackground = false, backgroundPadded = false;
    let leftPadding = -1, topPadding = -1, rightPadding = -1, bottomPadding = -1, startPadding = UNDEFINED_PADDING, endPadding = UNDEFINED_PADDING, padding = -1, paddingHorizontal = -1, paddingVertical = -1;
    let leftPaddingDefined = false, rightPaddingDefined = false, startPaddingDefined = false, endPaddingDefined = false;
    let x = 0, y = 0, transformSet = false, setScrollContainer = false, verticalScrollbars = false, initializeScrollbars = false, overScrollMode = null, layoutDirection = null;
    const transform = { translationX: floatBits(0), translationY: floatBits(0), translationZ: floatBits(0), elevation: floatBits(0), rotation: floatBits(0), rotationX: floatBits(0), rotationY: floatBits(0), scaleX: floatBits(1), scaleY: floatBits(1) };
    const sdk = targetSdk(r, context), foregroundRead = sdk >= 23 || r.isSubtype(view.type, 'Landroid/widget/FrameLayout;');
    // The TextView constructor reads android:focusable, clickable and longClickable from this same TypedArray again at its end (textview-xml-attributes.js): what is read here is left for it.
    const textView = r.isSubtype(view.type, 'Landroid/widget/TextView;'); if (textView) delete view.xmlFocusRead;
    try {
      for (const name of a.present) attempt(r, view, name, () => {
        switch (name) {
          case 'background': {
            // a.getDrawable(attr): a colour value is a ColorDrawable. The lab keeps a plain colour as the View's background colour (drawn without a Drawable); View.getBackground()
            // and a background tint turn it into the ColorDrawable.
            const type = a.type(name);
            if (type >= 0x1c && type <= 0x1f) backgroundColor = a.color(name, 0); else background = a.drawable(name);
            hasBackground = true; break;
          }
          case 'padding': padding = a.size(name, -1); leftPaddingDefined = rightPaddingDefined = true; break;
          case 'paddingHorizontal': paddingHorizontal = a.size(name, -1); leftPaddingDefined = rightPaddingDefined = true; break;
          case 'paddingVertical': paddingVertical = a.size(name, -1); break;
          case 'paddingLeft': leftPadding = a.size(name, -1); leftPaddingDefined = true; break;
          case 'paddingTop': topPadding = a.size(name, -1); break;
          case 'paddingRight': rightPadding = a.size(name, -1); rightPaddingDefined = true; break;
          case 'paddingBottom': bottomPadding = a.size(name, -1); break;
          case 'paddingStart': startPadding = a.size(name, UNDEFINED_PADDING); startPaddingDefined = startPadding !== UNDEFINED_PADDING; break;
          case 'paddingEnd': endPadding = a.size(name, UNDEFINED_PADDING); endPaddingDefined = endPadding !== UNDEFINED_PADDING; break;
          case 'scrollX': x = a.offset(name, 0); break;
          case 'scrollY': y = a.offset(name, 0); break;
          case 'alpha': set(r, self, 'setAlpha', '(F)V', [a.floatBits(name, 1)]); break;
          case 'transformPivotX': set(r, self, 'setPivotX', '(F)V', [a.dimensionBits(name, 0)]); break;
          case 'transformPivotY': set(r, self, 'setPivotY', '(F)V', [a.dimensionBits(name, 0)]); break;
          case 'translationX': case 'translationY': case 'translationZ': case 'elevation': transform[name] = a.dimensionBits(name, 0); transformSet = true; break;
          case 'rotation': case 'rotationX': case 'rotationY': transform[name] = a.floatBits(name, 0); transformSet = true; break;
          case 'scaleX': case 'scaleY': transform[name] = a.floatBits(name, 1); transformSet = true; break;
          case 'id': { const value = a.resource(name, NO_ID); if (value !== NO_ID) view.androidId = value >>> 0; break; }
          case 'tag': view.tag = a.text(name); break;
          case 'fitsSystemWindows': if (a.bool(name, false)) view.fitsSystemWindows = true; break;   // the FITS_SYSTEM_WINDOWS view flag
          case 'focusable': {   // View.getFocusableAttribute: a boolean is FOCUSABLE / NOT_FOCUSABLE, anything else the enum value ("auto" = FOCUSABLE_AUTO)
            const value = a.type(name) === 0x12 ? (a.bool(name, false) ? 1 : 0) : a.int(name, 0x10);
            set(r, self, 'setFocusable', '(I)V', [value], 'direct'); if (textView) (view.xmlFocusRead ??= {}).focusable = value; break;
          }
          case 'focusableInTouchMode': flag(name, 'setFocusableInTouchMode'); break;
          case 'clickable': flag(name, 'setClickable'); if (textView) (view.xmlFocusRead ??= {}).clickable = a.bool(name, false); break;
          case 'allowClickWhenDisabled': set(r, self, 'setAllowClickWhenDisabled', '(Z)V', [a.bool(name, false) ? 1 : 0]); break;
          case 'longClickable': flag(name, 'setLongClickable'); if (textView) (view.xmlFocusRead ??= {}).longClickable = a.bool(name, false); break;
          case 'contextClickable': flag(name, 'setContextClickable'); break;
          case 'saveEnabled': if (!a.bool(name, true)) set(r, self, 'setSaveEnabled', '(Z)V', [0], 'direct'); break;
          case 'duplicateParentState': flag(name, 'setDuplicateParentStateEnabled'); break;
          case 'visibility': { const value = a.int(name, 0); if (value !== 0) view.visibility = [0, 4, 8][value] ?? 0; break; }   // VISIBILITY_FLAGS through setFlags: no setVisibility call
          case 'layoutDirection': {   // LAYOUT_DIRECTION_FLAGS[value], else the default (inherit); a value outside the enum is not a direction and is reported, not skipped
            const value = a.int(name, -1); layoutDirection = value >= 0 && value <= 3 ? value : 2;
            if (value !== -1 && layoutDirection !== value) platform.noteXmlAttributeNotApplied(r, name, tagOf(view), `value ${value} is not a layout direction (ltr 0, rtl 1, inherit 2, locale 3)`, view.type);
            break;
          }
          case 'drawingCacheQuality': { const value = a.int(name, 0); if (value !== 0) set(r, self, 'setDrawingCacheQuality', '(I)V', [[0, 0x80000, 0x100000][value] ?? 0], 'direct'); break; }
          case 'contentDescription': set(r, self, 'setContentDescription', `(${CHARS})V`, [a.string(name)]); break;
          case 'accessibilityTraversalBefore': set(r, self, 'setAccessibilityTraversalBefore', '(I)V', [a.resource(name, NO_ID)]); break;
          case 'accessibilityTraversalAfter': set(r, self, 'setAccessibilityTraversalAfter', '(I)V', [a.resource(name, NO_ID)]); break;
          case 'labelFor': set(r, self, 'setLabelFor', '(I)V', [a.resource(name, NO_ID)]); break;
          case 'soundEffectsEnabled': if (!a.bool(name, true)) set(r, self, 'setSoundEffectsEnabled', '(Z)V', [0], 'direct'); break;
          case 'hapticFeedbackEnabled': if (!a.bool(name, true)) set(r, self, 'setHapticFeedbackEnabled', '(Z)V', [0], 'direct'); break;
          case 'scrollbars': {   // SCROLLBARS_HORIZONTAL = 0x100, SCROLLBARS_VERTICAL = 0x200
            const value = a.int(name, 0); if (value === 0) break;
            set(r, self, 'setHorizontalScrollBarEnabled', '(Z)V', [value & 0x100 ? 1 : 0], 'direct'); set(r, self, 'setVerticalScrollBarEnabled', '(Z)V', [value & 0x200 ? 1 : 0], 'direct');
            verticalScrollbars = (value & 0x200) !== 0; initializeScrollbars = true; break;
          }
          case 'fadingEdge': case 'requiresFadingEdge': {   // FADING_EDGE_HORIZONTAL = 0x1000, FADING_EDGE_VERTICAL = 0x2000, then initializeFadingEdgeInternal
            if (name === 'fadingEdge' && sdk >= 14) break;   // ignored starting with Ice Cream Sandwich; before it, the same as requiresFadingEdge
            const value = a.int(name, 0); if (value === 0) break;
            set(r, self, 'setHorizontalFadingEdgeEnabled', '(Z)V', [value & 0x1000 ? 1 : 0], 'direct'); set(r, self, 'setVerticalFadingEdgeEnabled', '(Z)V', [value & 0x2000 ? 1 : 0], 'direct');
            const scaled = call(r, 'virtual', 'Landroid/view/ViewConfiguration;', 'getScaledFadingEdgeLength', '()I', [call(r, 'static', 'Landroid/view/ViewConfiguration;', 'get', `(${CONTEXT})Landroid/view/ViewConfiguration;`, [context])]);
            set(r, self, 'setFadingEdgeLength', '(I)V', [a.size('fadingEdgeLength', scaled)], 'direct'); break;
          }
          case 'scrollbarStyle': { const value = a.int(name, 0); if (value !== 0) set(r, self, 'setScrollBarStyle', '(I)V', [value & 0x03000000], 'direct'); break; }
          case 'isScrollContainer': setScrollContainer = true; if (a.bool(name, false)) set(r, self, 'setScrollContainer', '(Z)V', [1]); break;
          case 'keepScreenOn': flag(name, 'setKeepScreenOn'); break;
          case 'filterTouchesWhenObscured': flag(name, 'setFilterTouchesWhenObscured'); break;
          case 'nextFocusLeft': id(name, 'setNextFocusLeftId'); break;
          case 'nextFocusRight': id(name, 'setNextFocusRightId'); break;
          case 'nextFocusUp': id(name, 'setNextFocusUpId'); break;
          case 'nextFocusDown': id(name, 'setNextFocusDownId'); break;
          case 'nextFocusForward': id(name, 'setNextFocusForwardId'); break;
          case 'nextClusterForward': id(name, 'setNextClusterForwardId'); break;
          case 'minWidth': view.minimumWidth = a.size(name, 0); break;
          case 'minHeight': view.minimumHeight = a.size(name, 0); break;
          case 'onClick': {
            if (call(r, 'virtual', CONTEXT, 'isRestricted', '()Z', [context])) r.throwJava('Ljava/lang/IllegalStateException;', 'The android:onClick attribute cannot be used within a restricted context');
            const handler = a.string(name);
            if (handler !== null) { const listener = r.makeObject(DECLARED_CLICK); Object.assign(r.object(listener), { hostView: self, methodName: typeof handler === 'string' ? handler : r.stringCharacters(handler) }); set(r, self, 'setOnClickListener', `(${CLICK})V`, [listener]); }
            break;
          }
          case 'overScrollMode': overScrollMode = a.int(name, 1); break;
          case 'verticalScrollbarPosition': set(r, self, 'setVerticalScrollbarPosition', '(I)V', [a.int(name, 0)], 'direct'); break;
          case 'layerType': set(r, self, 'setLayerType', '(ILandroid/graphics/Paint;)V', [a.int(name, 0), null]); break;
          case 'textDirection': { const value = a.int(name, -1); if (value !== -1) set(r, self, 'setTextDirection', '(I)V', [value], 'direct'); break; }   // PFLAG2_TEXT_DIRECTION_FLAGS[value]
          case 'textAlignment': set(r, self, 'setTextAlignment', '(I)V', [a.int(name, 1)], 'direct'); break;   // default TEXT_ALIGNMENT_GRAVITY
          case 'importantForAccessibility': set(r, self, 'setImportantForAccessibility', '(I)V', [a.int(name, 0)]); break;
          case 'accessibilityLiveRegion': set(r, self, 'setAccessibilityLiveRegion', '(I)V', [a.int(name, 0)]); break;
          case 'transitionName': set(r, self, 'setTransitionName', `(${STRING})V`, [a.string(name)]); break;
          case 'nestedScrollingEnabled': set(r, self, 'setNestedScrollingEnabled', '(Z)V', [a.bool(name, false) ? 1 : 0]); break;
          case 'stateListAnimator': {
            const animator = call(r, 'static', 'Landroid/animation/AnimatorInflater;', 'loadStateListAnimator', `(${CONTEXT}I)Landroid/animation/StateListAnimator;`, [context, a.resource(name, 0)]);
            set(r, self, 'setStateListAnimator', '(Landroid/animation/StateListAnimator;)V', [animator ?? null]); break;
          }
          case 'backgroundTint': set(r, self, 'setBackgroundTintList', `(${TINT})V`, [a.colors(name)], 'direct'); break;   // TintInfo fields: applied when the background is set below
          case 'backgroundTintMode': set(r, self, 'setBackgroundTintBlendMode', `(${BLEND})V`, [parseBlendMode(r, a.int(name, -1))], 'direct'); break;
          case 'outlineProvider': {   // View.setOutlineProviderFromAttribute: background (0), none (1), bounds (2), paddedBounds (3)
            const field = ['BACKGROUND', null, 'BOUNDS', 'PADDED_BOUNDS'][a.int(name, 0)], provider = 'Landroid/view/ViewOutlineProvider;';
            if (field === undefined) break;
            set(r, self, 'setOutlineProvider', `(${provider})V`, [field ? r.readStatic({ owner: provider, name: field, type: provider }) : null]); break;
          }
          case 'foreground': if (foregroundRead) set(r, self, 'setForeground', `(${DRAWABLE})V`, [a.drawable(name)]); break;
          case 'foregroundGravity': if (foregroundRead) set(r, self, 'setForegroundGravity', '(I)V', [a.int(name, 0)]); break;
          case 'foregroundTintMode': if (foregroundRead) set(r, self, 'setForegroundTintBlendMode', `(${BLEND})V`, [parseBlendMode(r, a.int(name, -1))]); break;
          case 'foregroundTint': if (foregroundRead) set(r, self, 'setForegroundTintList', `(${TINT})V`, [a.colors(name)]); break;
          case 'foregroundInsidePadding': if (foregroundRead) view.foregroundInsidePadding = a.bool(name, view.foregroundInsidePadding !== false); break;
          case 'scrollIndicators': { const value = a.int(name, 0) & 0x3f; if (value !== 0) set(r, self, 'setScrollIndicators', '(I)V', [value], 'direct'); break; }
          case 'pointerIcon': {
            const resource = a.resource(name, 0);
            if (resource !== 0) { set(r, self, 'setPointerIcon', `(${POINTER_ICON})V`, [call(r, 'static', POINTER_ICON, 'load', `(Landroid/content/res/Resources;I)${POINTER_ICON}`, [call(r, 'virtual', CONTEXT, 'getResources', '()Landroid/content/res/Resources;', [context]), resource])]); break; }
            const type = a.int(name, 1);   // PointerIcon.TYPE_NOT_SPECIFIED
            if (type !== 1) { set(r, self, 'setPointerIcon', `(${POINTER_ICON})V`, [call(r, 'static', POINTER_ICON, 'getSystemIcon', `(${CONTEXT}I)${POINTER_ICON}`, [context, type])]); noteNoEffect(r, name, tagOf(view), NO_EFFECT.pointerIcon); }
            break;
          }
          case 'forceHasOverlappingRendering': set(r, self, 'forceHasOverlappingRendering', '(Z)V', [a.bool(name, true) ? 1 : 0]); break;
          case 'tooltipText': set(r, self, 'setTooltipText', `(${CHARS})V`, [a.text(name)]); break;
          case 'keyboardNavigationCluster': set(r, self, 'setKeyboardNavigationCluster', '(Z)V', [a.bool(name, true) ? 1 : 0]); break;
          case 'focusedByDefault': set(r, self, 'setFocusedByDefault', '(Z)V', [a.bool(name, true) ? 1 : 0]); break;
          case 'autofillHints': {
            let raw = null, single = null;
            if (a.type(name) === 1) {   // TYPE_REFERENCE: a string-array, else the string resource
              const resource = a.resource(name, 0);
              try { raw = a.textArray(name); }
              catch (error) { if (!javaIs(r, error, 'Landroid/content/res/Resources$NotFoundException;')) throw error; single = call(r, 'virtual', 'Landroid/content/res/Resources;', 'getString', `(I)${STRING}`, [call(r, 'virtual', CONTEXT, 'getResources', '()Landroid/content/res/Resources;', [context]), resource]); }
            } else single = a.string(name);
            const text = value => typeof value === 'string' ? value : r.stringCharacters(call(r, 'virtual', CHARS, 'toString', `()${STRING}`, [value]));
            let hints;
            if (raw !== null) hints = r.array(raw).elements.map(text);
            else { if (single === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Could not resolve autofillHints'); hints = text(single).split(','); }
            const value = r.newArray(`[${STRING}`, hints.length); r.object(value).elements = hints.map(hint => hint.trim());
            set(r, self, 'setAutofillHints', `([${STRING})V`, [value]); break;
          }
          case 'importantForAutofill': set(r, self, 'setImportantForAutofill', '(I)V', [a.int(name, 0)]); break;
          case 'importantForContentCapture':
            set(r, self, 'setImportantForContentCapture', '(I)V', [a.int(name, 0)]);
            // android-13.0.0_r1 View.java has no break here: the case runs on into defaultFocusHighlightEnabled with this attribute's value
            set(r, self, 'setDefaultFocusHighlightEnabled', '(Z)V', [a.bool(name, true) ? 1 : 0]); break;
          case 'defaultFocusHighlightEnabled': set(r, self, 'setDefaultFocusHighlightEnabled', '(Z)V', [a.bool(name, true) ? 1 : 0]); break;
          case 'screenReaderFocusable': set(r, self, 'setScreenReaderFocusable', '(Z)V', [a.bool(name, false) ? 1 : 0]); break;
          case 'accessibilityPaneTitle': set(r, self, 'setAccessibilityPaneTitle', `(${CHARS})V`, [a.string(name)]); break;
          case 'outlineSpotShadowColor': set(r, self, 'setOutlineSpotShadowColor', '(I)V', [a.color(name, 0xff000000 | 0)]); break;
          case 'outlineAmbientShadowColor': set(r, self, 'setOutlineAmbientShadowColor', '(I)V', [a.color(name, 0xff000000 | 0)]); break;
          case 'accessibilityHeading': set(r, self, 'setAccessibilityHeading', '(Z)V', [a.bool(name, false) ? 1 : 0]); break;
          case 'forceDarkAllowed': set(r, self, 'setForceDarkAllowed', '(Z)V', [a.bool(name, true) ? 1 : 0], 'direct'); break;   // mRenderNode.setForceDarkAllowed
          case 'scrollCaptureHint': set(r, self, 'setScrollCaptureHint', '(I)V', [a.int(name, 0)]); break;
          case 'clipToOutline': set(r, self, 'setClipToOutline', '(Z)V', [a.bool(name, false) ? 1 : 0]); break;
          case 'preferKeepClear': set(r, self, 'setPreferKeepClear', '(Z)V', [a.bool(name, false) ? 1 : 0]); break;
          case 'autoHandwritingEnabled': set(r, self, 'setAutoHandwritingEnabled', '(Z)V', [a.bool(name, true) ? 1 : 0]); break;
          default: break;   // the scroll bar and fading edge values are read with android:scrollbars / requiresFadingEdge; android:theme is LayoutInflater's
        }
      });
      if (overScrollMode !== null) attempt(r, view, 'overScrollMode', () => set(r, self, 'setOverScrollMode', '(I)V', [overScrollMode]));
      if (layoutDirection !== null) attempt(r, view, 'layoutDirection', () => applyLayoutDirection(r, self, layoutDirection));

      // The background, then the padding: View.setBackground adopts the Drawable's padding (the user padding "initial" values), and the padding attributes override it.
      if (hasBackground) attempt(r, view, 'background', () => {
        if (backgroundColor !== null && !view.backgroundTintInfo?.hasList && !view.backgroundTintInfo?.hasBlend) { if (view.backgroundDrawable) set(r, self, 'setBackground', `(${DRAWABLE})V`, [null]); view.backgroundColorDrawable = null; view.background = colorText(backgroundColor); return; }
        if (backgroundColor !== null) { const owner = 'Landroid/graphics/drawable/ColorDrawable;', drawable = r.allocate(owner); call(r, 'direct', owner, '<init>', '(I)V', [drawable, backgroundColor]); background = drawable; }
        if (background !== null) {
          view.background = null; set(r, self, 'setBackground', `(${DRAWABLE})V`, [background]);
          const rect = r.allocate('Landroid/graphics/Rect;'); call(r, 'direct', 'Landroid/graphics/Rect;', '<init>', '()V', [rect]);
          backgroundPadded = !!call(r, 'virtual', DRAWABLE, 'getPadding', '(Landroid/graphics/Rect;)Z', [background, rect]);   // setBackgroundDrawable then replaces the user padding "initial" values
        }
      });
      view.userPaddingStart = startPadding; view.userPaddingEnd = endPadding;
      const current = { left: 0, top: 0, right: 0, bottom: 0, ...(view.padding || {}) };
      let userLeft = !backgroundPadded && leftPadding >= 0 ? leftPadding : current.left, userRight = !backgroundPadded && rightPadding >= 0 ? rightPadding : current.right;   // mUserPaddingLeftInitial / RightInitial
      if (padding >= 0) { leftPadding = topPadding = rightPadding = bottomPadding = padding; userLeft = userRight = padding; }
      else {
        if (paddingHorizontal >= 0) { leftPadding = rightPadding = paddingHorizontal; userLeft = userRight = paddingHorizontal; }
        if (paddingVertical >= 0) { topPadding = bottomPadding = paddingVertical; }
      }
      if (rtlCompatibility(r, context)) {   // start / end are used as left / right when those are not defined; the layout direction is not taken into account
        if (!leftPaddingDefined && startPaddingDefined) leftPadding = startPadding;
        userLeft = leftPadding >= 0 ? leftPadding : userLeft;
        if (!rightPaddingDefined && endPaddingDefined) rightPadding = endPadding;
        userRight = rightPadding >= 0 ? rightPadding : userRight;
      } else {
        const relative = startPaddingDefined || endPaddingDefined;
        if (leftPaddingDefined && !relative) userLeft = leftPadding;
        if (rightPaddingDefined && !relative) userRight = rightPadding;
      }
      const next = { left: userLeft, top: topPadding >= 0 ? topPadding : current.top, right: userRight, bottom: bottomPadding >= 0 ? bottomPadding : current.bottom };
      if (['left', 'top', 'right', 'bottom'].some(edge => next[edge] !== current[edge])) view.padding = next;
      view.userPaddingLeftInitial = userLeft; view.userPaddingRightInitial = userRight;
      resolveRelativePadding(r, self);

      if (initializeScrollbars) attempt(r, view, 'scrollbars', () => {   // View.initializeScrollbarsInternal(a)
        set(r, self, 'setScrollbarFadingEnabled', '(Z)V', [a.bool('fadeScrollbars', true) ? 1 : 0], 'direct');
        if (a.has('scrollbarFadeDuration')) set(r, self, 'setScrollBarFadeDuration', '(I)V', [a.int('scrollbarFadeDuration', 0)], 'direct');
        if (a.has('scrollbarDefaultDelayBeforeFade')) set(r, self, 'setScrollBarDefaultDelayBeforeFade', '(I)V', [a.int('scrollbarDefaultDelayBeforeFade', 0)], 'direct');
        if (a.has('scrollbarSize')) set(r, self, 'setScrollBarSize', '(I)V', [a.size('scrollbarSize', 0)], 'direct');
        for (const [attribute, setter, always] of [['scrollbarTrackHorizontal', 'setHorizontalScrollbarTrackDrawable', true], ['scrollbarThumbHorizontal', 'setHorizontalScrollbarThumbDrawable', false], ['scrollbarTrackVertical', 'setVerticalScrollbarTrackDrawable', true], ['scrollbarThumbVertical', 'setVerticalScrollbarThumbDrawable', false]]) {
          const drawable = a.has(attribute) ? a.drawable(attribute) : null;
          if (drawable !== null || always) set(r, self, setter, `(${DRAWABLE})V`, [drawable], 'direct');
        }
        for (const attribute of ['scrollbarAlwaysDrawHorizontalTrack', 'scrollbarAlwaysDrawVerticalTrack']) if (a.bool(attribute, false)) view[attribute] = true;
      });
      if ((view.scrollBarStyle ?? 0) !== 0) {   // "Needs to be called after mViewFlags is set": recomputePadding() adds the inset of the scroll bar style
        const inset = scrollbarInsets(r, self);
        if (inset.left || inset.right || inset.bottom) { const now = { left: 0, top: 0, right: 0, bottom: 0, ...(view.padding || {}) }; writePadding(r, self, { left: now.left + inset.left, top: now.top, right: now.right + inset.right, bottom: now.bottom + inset.bottom }); }
      }
      // What the tag asked for that this VM keeps but does not draw
      for (const attribute of node?.attributes ?? []) {
        const kind = attribute.namespace === ANDROID_NAMESPACE ? NOT_DRAWN[attribute.name] : null; if (!kind || !a.has(attribute.name)) continue;
        if (kind === 'scrollBar' && !initializeScrollbars && attribute.name !== 'scrollbarStyle' && attribute.name !== 'verticalScrollbarPosition') continue;   // Android does not read them without android:scrollbars either
        if (kind === 'fadingEdge' && !(view.horizontalFadingEdge || view.verticalFadingEdge)) continue;
        if ((attribute.name === 'scrollbarStyle' || attribute.name === 'scrollIndicators' || attribute.name === 'verticalScrollbarPosition' || attribute.name === 'requiresFadingEdge') && a.int(attribute.name, 0) === 0) continue;
        noteNoEffect(r, attribute.name, tagOf(view), NO_EFFECT[kind]);
      }
    } finally { a.recycle(); }
    if (x !== 0 || y !== 0) attempt(r, view, 'scrollX', () => set(r, self, 'scrollTo', '(II)V', [x, y]));
    if (transformSet) for (const [name, setter] of [['translationX', 'setTranslationX'], ['translationY', 'setTranslationY'], ['translationZ', 'setTranslationZ'], ['elevation', 'setElevation'], ['rotation', 'setRotation'], ['rotationX', 'setRotationX'], ['rotationY', 'setRotationY'], ['scaleX', 'setScaleX'], ['scaleY', 'setScaleY']])
      attempt(r, view, name, () => set(r, self, setter, '(F)V', [transform[name]]));
    if (!setScrollContainer && verticalScrollbars) attempt(r, view, 'scrollbars', () => set(r, self, 'setScrollContainer', '(Z)V', [1]));
    platform.syncViewFields?.(r, self);
    return list.handled;
  };

  // ------------------------------------------------------------------------------------------------------------------------------------------------------- android.view.ViewGroup
  /** ViewGroup.initFromAttributes(context, attrs, defStyleAttr, defStyleRes). */
  const applyViewGroup = (r, self, node, context) => {
    const view = r.object(self), source = table();
    if (!source || !context || !node || !r.classes.has(TA) || !platform.styleBackend || !r.isSubtype(view.type, GROUP)) return null;
    const styled = !!r.skia && !!platform.resources.frameworkXml, list = styleable(r, 'ViewGroup', GROUP_ATTRIBUTES), defStyleAttr = styled ? view.defStyleAttr | 0 : 0, defStyleRes = styled ? view.defStyleRes | 0 : 0;
    if (!defStyleAttr && !defStyleRes && !tagGives(node, list.handled) && !themeGives(r, context, 'ViewGroup', list.ownIds)) return list.handled;   // nothing to read
    const ids = r.newArray('[I', list.ids.length); r.object(ids).elements = [...list.ids];
    const array = platform.styleBackend.obtain(r, theme(r, context), attributeSet(r, node), ids, defStyleAttr, defStyleRes), a = reader(r, array, list);
    const flag = (name, setter, fallback) => set(r, self, setter, '(Z)V', [a.bool(name, fallback) ? 1 : 0], 'virtual', GROUP);
    try {
      for (const name of a.present) attempt(r, view, name, () => {
        switch (name) {
          case 'clipChildren': flag(name, 'setClipChildren', true); break;
          case 'clipToPadding': flag(name, 'setClipToPadding', true); break;
          case 'animationCache': flag(name, 'setAnimationCacheEnabled', true); break;
          case 'persistentDrawingCache': set(r, self, 'setPersistentDrawingCache', '(I)V', [a.int(name, 2)], 'virtual', GROUP); break;   // PERSISTENT_SCROLLING_CACHE
          case 'addStatesFromChildren': flag(name, 'setAddStatesFromChildren', false); break;
          case 'alwaysDrawnWithCache': flag(name, 'setAlwaysDrawnWithCacheEnabled', true); break;
          case 'layoutAnimation': {
            const resource = a.resource(name, -1); if (resource <= 0) break;
            const controller = 'Landroid/view/animation/LayoutAnimationController;';
            set(r, self, 'setLayoutAnimation', `(${controller})V`, [call(r, 'static', 'Landroid/view/animation/AnimationUtils;', 'loadLayoutAnimation', `(${CONTEXT}I)${controller}`, [context, resource])], 'virtual', GROUP); break;
          }
          case 'descendantFocusability': {   // DESCENDANT_FOCUSABILITY_FLAGS: before (0x20000), after (0x40000), block (0x60000)
            const flags = [0x20000, 0x40000, 0x60000], value = a.int(name, 0);
            if (value < 0 || value >= flags.length) r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `length=${flags.length}; index=${value}`);
            set(r, self, 'setDescendantFocusability', '(I)V', [flags[value]], 'virtual', GROUP); break;
          }
          case 'splitMotionEvents': flag(name, 'setMotionEventSplittingEnabled', false); break;
          case 'animateLayoutChanges': {
            if (!a.bool(name, false)) break;
            const transition = 'Landroid/animation/LayoutTransition;';
            if (!r.classes.has(transition)) throw new APKError('android.animation.LayoutTransition is an original class of the layouts profile, which is not loaded for this APK (the loader brings the profile for an APK whose layouts or styles give android:animateLayoutChanges, or whose code names the class)', { kind: 'layout-transition-profile' });
            const value = r.allocate(transition); call(r, 'direct', transition, '<init>', '()V', [value]);
            set(r, self, 'setLayoutTransition', `(${transition})V`, [value], 'virtual', GROUP); break;
          }
          case 'layoutMode': {
            const mode = a.int(name, -1);
            if (mode !== 1) { set(r, self, 'setLayoutMode', '(I)V', [mode], 'virtual', GROUP); break; }
            // LAYOUT_MODE_OPTICAL_BOUNDS: the mode is kept (getLayoutMode returns it) and the group is measured and laid out by its clip bounds.
            call(r, 'virtual', GROUP, 'getLayoutMode', '()I', [self]); view.vg.layoutMode = 1; noteNoEffect(r, name, tagOf(view), NO_EFFECT.layoutMode); break;
          }
          case 'transitionGroup': flag(name, 'setTransitionGroup', false); break;
          case 'touchscreenBlocksFocus': flag(name, 'setTouchscreenBlocksFocus', false); break;
          default: break;
        }
      });
    } finally { a.recycle(); }
    return list.handled;
  };

  // ----------------------------------------------------------------------------------------------------------------- ViewGroup.LayoutParams / ViewGroup.MarginLayoutParams
  const marginState = (r, params) => r.object(params).marginState ??= { start: UNDEFINED_MARGIN, end: UNDEFINED_MARGIN, dir: 0, leftUndefined: true, rightUndefined: true, needResolution: false, rtlCompatibility: false };
  /**
   * MarginLayoutParams(Context, AttributeSet): layout_width / layout_height (setBaseAttributes), then the margins in the original's precedence: layout_margin, else
   * layout_marginHorizontal / layout_marginVertical, else the four sides; layout_marginStart / layout_marginEnd are kept relative and resolved by the layout direction.
   * `store(name, value)` writes a field of the params object (width, height, leftMargin, topMargin, rightMargin, bottomMargin).
   */
  const readMarginLayout = (r, params, attrs, context, store, baseOnly = false) => {
    const list = styleable(r, 'ViewGroup_MarginLayout', MARGIN_ATTRIBUTES), ids = r.newArray('[I', list.ids.length); r.object(ids).elements = [...list.ids];
    const array = platform.styleBackend.obtain(r, theme(r, context), attrs, ids), a = reader(r, array, list), state = marginState(r, params);
    try {
      const dimension = name => call(r, 'virtual', TA, 'getLayoutDimension', `(I${STRING})I`, [array, list.index.get(name), name]);
      // ViewGroup.LayoutParams(Context, AttributeSet) / MarginLayoutParams(Context, AttributeSet) call the virtual setBaseAttributes(TypedArray, widthAttr, heightAttr): a LayoutParams
      // class that overrides it (TableLayout.LayoutParams, TableRow.LayoutParams: a missing layout_width / layout_height has a default instead of failing) decides the size.
      const realType = r.object(params).type, BASE = '(Landroid/content/res/TypedArray;II)V';
      if (realType && r.objectOverride(realType, `setBaseAttributes${BASE}`)) call(r, 'virtual', realType, 'setBaseAttributes', BASE, [params, array, list.index.get('layout_width'), list.index.get('layout_height')]);
      else { store('width', dimension('layout_width')); store('height', dimension('layout_height')); }
      if (baseOnly) return;   // ViewGroup.LayoutParams(Context, AttributeSet) reads R.styleable.ViewGroup_Layout only
      let left = 0, top = 0, right = 0, bottom = 0;
      const margin = a.size('layout_margin', -1);
      Object.assign(state, { start: UNDEFINED_MARGIN, end: UNDEFINED_MARGIN, dir: 0, leftUndefined: false, rightUndefined: false, needResolution: false });
      if (margin >= 0) left = top = right = bottom = margin;
      else {
        const horizontal = a.size('layout_marginHorizontal', -1), vertical = a.size('layout_marginVertical', -1);
        if (horizontal >= 0) left = right = horizontal;
        else {
          left = a.size('layout_marginLeft', UNDEFINED_MARGIN); if (left === UNDEFINED_MARGIN) { state.leftUndefined = true; left = 0; }
          right = a.size('layout_marginRight', UNDEFINED_MARGIN); if (right === UNDEFINED_MARGIN) { state.rightUndefined = true; right = 0; }
        }
        state.start = a.size('layout_marginStart', UNDEFINED_MARGIN); state.end = a.size('layout_marginEnd', UNDEFINED_MARGIN);
        if (vertical >= 0) top = bottom = vertical;
        else { top = a.size('layout_marginTop', 0); bottom = a.size('layout_marginBottom', 0); }
        if (state.start !== UNDEFINED_MARGIN || state.end !== UNDEFINED_MARGIN) state.needResolution = true;
      }
      state.rtlCompatibility = rtlCompatibility(r, context);
      store('leftMargin', left); store('topMargin', top); store('rightMargin', right); store('bottomMargin', bottom);
      // The relative margins are resolved for the default direction (LTR) at once; the View that takes these params resolves them again with its own direction. MarginLayoutParams' own
      // resolution, not the virtual one: this runs inside the super constructor of a subclass (RelativeLayout.LayoutParams), whose override reads fields it has not initialized yet.
      if (state.needResolution) call(r, 'direct', MARGIN_PARAMS, 'resolveLayoutDirection', '(I)V', [params, 0]);
    } finally { a.recycle(); }
  };

  // ---------------------------------------------------------------------------------------------------------------------------------------- framework members the passes need
  // View.DeclaredOnClickListener (android:onClick): the handler is looked up on first click in the View's Context and the ContextWrapper chain below it, as a public method
  // name(View), and invoked through reflection; the failures are the original's IllegalStateExceptions.
  registry.type(DECLARED_CLICK, 'Ljava/lang/Object;', [CLICK], { allocatable: true });
  def(DECLARED_CLICK, 'onClick', `(${VIEW})V`, (r, _m, [self, clicked]) => {
    const listener = r.object(self), METHOD = 'Ljava/lang/reflect/Method;', CLASS = 'Ljava/lang/Class;', OBJECT = 'Ljava/lang/Object;';
    if (!listener.resolvedMethod) {
      let context = call(r, 'virtual', VIEW, 'getContext', `()${CONTEXT}`, [listener.hostView]);
      for (let depth = 0; !nullish(context) && depth < 64; depth++) {
        try {
          if (!call(r, 'virtual', CONTEXT, 'isRestricted', '()Z', [context])) {
            const types = r.newArray(`[${CLASS}`, 1); r.object(types).elements = [r.classObject(VIEW)];
            const found = call(r, 'virtual', CLASS, 'getMethod', `(${STRING}[${CLASS})${METHOD}`, [r.classObject(r.typeOf(context)), listener.methodName, types]);
            if (!nullish(found)) { listener.resolvedMethod = found; listener.resolvedContext = context; break; }
          }
        } catch (error) { if (!javaIs(r, error, 'Ljava/lang/NoSuchMethodException;')) throw error; }   // try the next context in the chain
        context = r.isSubtype(r.typeOf(context), 'Landroid/content/ContextWrapper;') ? call(r, 'virtual', 'Landroid/content/ContextWrapper;', 'getBaseContext', `()${CONTEXT}`, [context]) : null;
      }
      if (!listener.resolvedMethod) {
        const host = r.object(listener.hostView);
        r.throwJava('Ljava/lang/IllegalStateException;', `Could not find method ${listener.methodName}(View) in a parent or ancestor Context for android:onClick attribute defined on view class ${host.type.slice(1, -1).replaceAll('/', '.')}`);
      }
    }
    const args = r.newArray(`[${OBJECT}`, 1); r.object(args).elements = [clicked];
    try { call(r, 'virtual', METHOD, 'invoke', `(${OBJECT}[${OBJECT})${OBJECT}`, [listener.resolvedMethod, listener.resolvedContext, args]); }
    catch (error) {
      if (javaIs(r, error, 'Ljava/lang/IllegalAccessException;')) r.throwJava('Ljava/lang/IllegalStateException;', 'Could not execute non-public method for android:onClick');
      if (javaIs(r, error, 'Ljava/lang/reflect/InvocationTargetException;')) r.throwJava('Ljava/lang/IllegalStateException;', 'Could not execute method for android:onClick');
      throw error;
    }
  });

  // android.view.PointerIcon: the system icons by type (PointerIcon.getSystemIcon keeps one instance per type). The icon is state of the View (View.getPointerIcon,
  // onResolvePointerIcon); the page does not change the mouse cursor. Icons loaded from a resource or made from a Bitmap are not available (PointerIcon.load / create fail by name).
  registry.type(POINTER_ICON, 'Ljava/lang/Object;', ['Landroid/os/Parcelable;'], { allocatable: true });
  const systemIcons = new WeakMap();
  def(POINTER_ICON, 'getSystemIcon', `(${CONTEXT}I)${POINTER_ICON}`, (r, _m, [context, type]) => {
    if (nullish(context)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'context must not be null');
    let icons = systemIcons.get(r); if (!icons) systemIcons.set(r, icons = new Map());
    if (!icons.has(type)) { const icon = r.makeObject(POINTER_ICON); r.object(icon).pointerType = type; icons.set(type, icon); (r.hostStaticValues ??= []).push(icon); }
    return icons.get(type);
  }, { static: true });
  def(POINTER_ICON, 'getType', '()I', (r, _m, [self]) => r.object(self).pointerType ?? 1);
  def(POINTER_ICON, 'describeContents', '()I', () => 0);

  // ApplicationInfo.hasRtlSupport(): FLAG_SUPPORTS_RTL (android:supportsRtl), read by MarginLayoutParams and RelativeLayout.LayoutParams.
  def(APPLICATION_INFO, 'hasRtlSupport', '()Z', (r, _m, [self]) => ((r.object(self).fields.get(`${APPLICATION_INFO}->flags:I`) ?? 0) & 0x400000) !== 0 ? 1 : 0);

  // The raw (unresolved) direction values of a View, as the hidden getters of View.java return them.
  def(VIEW, 'getRawLayoutDirection', '()I', (r, _m, [self]) => r.object(self).layoutDirectionRaw ?? 2);
  def(VIEW, 'getRawTextDirection', '()I', (r, _m, [self]) => r.object(self).textDirection ?? 0);
  def(VIEW, 'getRawTextAlignment', '()I', (r, _m, [self]) => r.object(self).textAlignment ?? 1);
  def(VIEW, 'isRtlCompatibilityMode', '()Z', (r, _m, [self]) => rtlCompatibility(r, r.object(self).context) ? 1 : 0);

  platform.viewXmlAttributes = {
    applyView, applyViewGroup, readMarginLayout, marginState, applyLayoutDirection, resolveRelativePadding, resolveDirection, rtlCompatibility, hasRtlSupport, scrollbarInsets, writePadding, definedPadding,
    /** The names of a pass that only that pass applies (the caller skips them); names another class's styleable shares stay with the caller too. */
    exclusive: handled => handled && new Set([...handled].filter(name => !SHARED_WITH_SUBCLASS.has(name))),
    /** Runs both constructor passes for a View built from `node` and remembers it, so that the XML pass of the same node does not run them again. */
    construct(r, self, node, context) {
      const view = r.object(self), backend = platform.styleBackend, reading = backend?.readingFor;
      if (backend) backend.readingFor = view.type.slice(view.type.lastIndexOf('/') + 1, -1);   // what a style that cannot be read is reported for when the View has no tag
      try {
        const handled = applyView(r, self, node ?? null, context); if (!handled) return null;
        const all = new Set(handled), group = node ? applyViewGroup(r, self, node, context) : null; if (group) for (const name of group) all.add(name);
        const exclusive = new Set([...all].filter(name => !SHARED_WITH_SUBCLASS.has(name)));
        // The subclass constructors, in the order Android runs them after View's: TextView, then CompoundButton (textview-xml-attributes.js). What they read is theirs alone.
        for (const pass of subclassPasses) { const names = pass(r, self, node ?? null, context); if (names) for (const name of names) { all.add(name); exclusive.add(name); } }
        view.viewAttributesNode = node ?? null; view.viewAttributesHandled = all; view.viewAttributesExclusive = exclusive;
        return all;
      } finally { if (backend) backend.readingFor = reading; }
    },
    /** Adds the constructor attribute pass of a View subclass: pass(r, self, node, context) returns the attribute names it owns, or null when it did not run. */
    addSubclassPass(pass) { subclassPasses.push(pass); },
    /** What a subclass pass is written with: the styleable lists, the TypedArray reader and the reporting of this file. */
    kit: { styleable, reader, attempt, attributeSet, theme, table, targetSdk, tagOf, tagGives, themeGives, noteNoEffect, parseBlendMode, call, set, isJava, javaIs, attributeId, attributeName, colorText },
  };
}
