// Why a View is 0x0, and which Views host a Compose hierarchy, for the "Screen state" report (src/screen-state.js) and the summary at the top of "Copy diagnostics".
// Read-only on the VM: it reads what the measure and layout passes recorded on each View (src/view-layout-host.js: the last MeasureSpecs of View.measure, the measured size,
// the frame from View.layout) and the View's LayoutParams, and says in Android API terms why the size is 0, walking up the parents: the MeasureSpec a parent passed (EXACTLY 0,
// AT_MOST 0, UNSPECIFIED), the LayoutParams it came from (width / height, LinearLayout weight, ConstraintLayout's match constraint), a GONE view, a ViewStub not inflated,
// a window with no size, or a measure pass that never reached the subtree. No app or library names are written here; the class names come from the running app.
import { isComposeOwner } from './compose-owner.js?v=266d8da382fc';

const VIEW = 'Landroid/view/View;', GROUP = 'Landroid/view/ViewGroup;', SIZE = 0x00ffffff, MODE = 0xc0000000, EXACTLY = 0x40000000, AT_MOST = 0x80000000;
const COMPOSE_CONTAINER = 'Landroidx/compose/ui/platform/AbstractComposeView;';
const GONE = 8;
const dotted = type => String(type ?? '?').replace(/^L/, '').replace(/;$/, '').replaceAll('/', '.');
const floatBits = new DataView(new ArrayBuffer(4));
const asFloat = value => { if (typeof value !== 'number' || !Number.isInteger(value) || Math.abs(value) <= 0xffff) return Number(value ?? 0); floatBits.setInt32(0, value | 0); return floatBits.getFloat32(0); };

// AbstractComposeView (the ComposeView an Activity's setContent or an XML layout creates holds the owner View as its only child) overrides these framework methods in every
// Compose UI release: it refuses children other than its own (addViewInLayout), lays out and measures that child itself, is a transition group and does not delay its
// child's pressed state. A minified app keeps the overrides, as they are framework methods, so a class of the app's DEX with all of them is the container under a short name.
const CONTAINER_OVERRIDES = ['addViewInLayout(Landroid/view/View;ILandroid/view/ViewGroup$LayoutParams;Z)Z', 'addViewInLayout(Landroid/view/View;ILandroid/view/ViewGroup$LayoutParams;)Z',
  'isTransitionGroup()Z', 'shouldDelayChildPressedState()Z', 'onMeasure(II)V', 'onLayout(ZIIII)V'];
const containerVerdicts = new WeakMap();

/** 'owner' (the AndroidComposeView that draws and lays out the nodes), 'container' (the AbstractComposeView / ComposeView around it) or null; by name, else by structure. */
export function composeHostKind(runtime, type) {
  if (!type) return null;
  try { if (isComposeOwner(runtime, type)) return 'owner'; } catch { /* a class the runtime cannot resolve */ }
  let known = containerVerdicts.get(runtime); if (!known) containerVerdicts.set(runtime, known = new Map());
  if (!known.has(type)) {
    let verdict = false;
    try {
      if (runtime.isSubtype(type, COMPOSE_CONTAINER)) verdict = true;
      else if (runtime.isSubtype(type, GROUP)) verdict = CONTAINER_OVERRIDES.every(signature => { const method = runtime.objectOverride(type, signature); return !!method && !!runtime.dex?.classes?.has?.(method.owner) && !runtime.dex?.bootClasses?.has?.(method.owner); });
    } catch { verdict = false; }
    known.set(type, verdict);
  }
  return known.get(type) ? 'container' : null;
}

const specText = spec => { if (spec === undefined || spec === null) return 'no MeasureSpec'; const mode = (spec & MODE) >>> 0, size = spec & 0x3fffffff; return `${mode === EXACTLY ? 'EXACTLY' : mode === AT_MOST ? 'AT_MOST' : 'UNSPECIFIED'} ${size}`; };
const modeOf = spec => (spec & MODE) >>> 0, sizeOf = spec => spec & 0x3fffffff;
const lpField = (runtime, view, name) => { if (!view.layoutParams) return undefined; for (const [key, value] of runtime.object(view.layoutParams).fields ?? []) if (key.endsWith(`->${name}:I`) || key.endsWith(`->${name}:F`)) return key.endsWith(':F') ? asFloat(value) : value; return undefined; };
const dimensionText = value => value === -1 ? 'match_parent' : value === -2 ? 'wrap_content' : value === undefined ? '?' : value === 0 ? '0dp' : `${value}px`;
const subtype = (runtime, type, of) => { try { return !!type && runtime.isSubtype(type, of); } catch { return false; } };

/** "ComposeView #id_name" for a View: its class (short) and its android:id entry name when the app's resource table has one. */
export function viewLabel(runtime, ref) {
  const view = runtime.object(ref), id = view.androidId;
  return `${dotted(view.type).split('.').pop()}${id ? ` #${idName(runtime, id)}` : ''}`;
}

/** The entry name of an android:id (the app's resource table, then the framework's), or its hex value. */
export function idName(runtime, id) {
  let name = null; try { name = runtime.resources?.table?.entries?.get(id >>> 0)?.[0]?.name ?? runtime.platform?.resources?.frameworkTable?.entries?.get(id >>> 0)?.[0]?.name ?? null; } catch { name = null; }
  return name ?? '0x' + (id >>> 0).toString(16);
}

const parentKind = (runtime, parent) => {
  const type = parent.type;
  if (subtype(runtime, type, 'Landroid/widget/LinearLayout;')) { const orientation = [...(parent.fields ?? [])].find(([key]) => key.endsWith('LinearLayout;->mOrientation:I'))?.[1] ?? 0; return { kind: 'linear', vertical: orientation === 1 }; }
  if (/ConstraintLayout;$/.test(type ?? '')) return { kind: 'constraint' };
  if (subtype(runtime, type, 'Landroid/widget/ScrollView;') || subtype(runtime, type, 'Landroid/widget/HorizontalScrollView;') || /(NestedScrollView|RecyclerView)/.test(type ?? '')) return { kind: 'scrolling' };
  return { kind: 'other' };
};

/** The reason the `axis` ('width' | 'height') of `ref` is 0, as one clause, and whether the cause is above (the parent whose size is 0 too). */
function axisReason(runtime, ref, axis, depth) {
  const view = runtime.object(ref), spec = axis === 'width' ? view.oldWidthSpec : view.oldHeightSpec, measured = ((axis === 'width' ? view.measuredWidth : view.measuredHeight) ?? 0) & SIZE;
  const bounds = view.bounds, laid = bounds ? (axis === 'width' ? bounds.right - bounds.left : bounds.bottom - bounds.top) : null;
  const parentRef = view.parent, parent = parentRef ? runtime.object(parentRef) : null, attr = axis === 'width' ? 'layout_width' : 'layout_height', lp = lpField(runtime, view, axis);
  if (measured > 0 && laid === 0) return `it measured ${measured} ${axis === 'width' ? 'wide' : 'tall'} but ${parent ? viewLabel(runtime, parentRef) : 'its window'} laid it out at 0 (its onLayout gave it no ${axis})`;
  if (!parent || !subtype(runtime, parent.type, VIEW)) {   // the window root
    if (sizeOf(spec) === 0 && modeOf(spec) !== 0) return `the window measured it with ${specText(spec)}: the window has no ${axis}`;
    return `the window measured it with ${specText(spec)} and its own onMeasure chose 0`;
  }
  const from = viewLabel(runtime, parentRef), parentSize = ((axis === 'width' ? parent.measuredWidth : parent.measuredHeight) ?? 0) & SIZE, where = parentKind(runtime, parent);
  const above = () => depth < 12 && parentSize === 0 ? `; ${from} is 0 ${axis === 'width' ? 'wide' : 'tall'} itself: ${axisReason(runtime, parentRef, axis, depth + 1)}` : '';
  const mode = modeOf(spec), size = sizeOf(spec);
  if (mode === EXACTLY && size === 0) {
    if (lp === 0 && where.kind === 'linear' && where.vertical === (axis === 'height')) {
      const weight = lpField(runtime, view, 'weight') ?? 0;
      return `${from} passed EXACTLY 0 from ${attr}=0dp with weight ${weight} in a ${where.vertical ? 'vertical' : 'horizontal'} LinearLayout${weight > 0 ? ' (the weighted share of the space left was 0)' : ' (a 0dp child takes only its weighted share of the space left; weight 0 gets none)'}${above()}`;
    }
    if (lp === 0 && where.kind === 'constraint') {
      const [a, b] = axis === 'width' ? ['start', 'end'] : ['top', 'bottom'], anchors = axis === 'width' ? ['startToStart', 'startToEnd', 'leftToLeft', 'leftToRight', 'endToEnd', 'endToStart', 'rightToRight', 'rightToLeft'] : ['topToTop', 'topToBottom', 'bottomToBottom', 'bottomToTop'];
      const set = anchors.filter(name => (lpField(runtime, view, name) ?? -1) !== -1);
      return `${from} passed EXACTLY 0 from ${attr}=0dp (match constraint) in a ConstraintLayout: ${set.length >= 2 ? `its ${a} and ${b} constraints (${set.join(', ')}) leave no room between them` : `it has ${set.length ? `only ${set.join(', ')}` : `no ${a} / ${b} constraint`}, so a match-constraint ${axis} spans nothing`}${above()}`;
    }
    if (lp === 0) return `${from} passed EXACTLY 0 from ${attr}=0dp${above()}`;
    if (lp === -1) return `${from} passed EXACTLY 0 from ${attr}=match_parent${parentSize === 0 ? above() : ` (${from} had no ${axis} left for it)`}`;
    return `${from} passed EXACTLY 0 (its onMeasure; ${attr}=${dimensionText(lp)})${above()}`;
  }
  if (mode === AT_MOST && size === 0) return `${from} passed AT_MOST 0 for ${attr}=${dimensionText(lp)}: ${from} had no ${axis} left for it${above()}`;
  const kind = composeHostKind(runtime, view.type), content = kind === 'container' ? (view.children?.length ? 'its composition laid out no content' : 'it had no composition yet (no owner View child)') : kind === 'owner' ? 'its composition laid out no content' : `its content has no ${axis}`;
  if (mode === 0) return `${from} passed UNSPECIFIED ${size} for ${attr}=${dimensionText(lp)}${where.kind === 'scrolling' ? ' (a scrolling parent asks for the natural size)' : ''} and its own onMeasure answered 0: ${content}`;
  return `${from} passed ${specText(spec)} for ${attr}=${dimensionText(lp)} and its own onMeasure chose 0: ${content}`;
}

/** Why the View `ref` is 0 in width and/or height (one sentence), or null when it has a size. */
export function zeroSizeReason(runtime, ref) {
  const view = runtime.object(ref), b = view.bounds, width = b ? b.right - b.left : 0, height = b ? b.bottom - b.top : 0;
  if (width > 0 && height > 0) return null;
  if (subtype(runtime, view.type, 'Landroid/view/ViewStub;')) return 'it is a ViewStub that was never inflated (a ViewStub is GONE and measures 0x0 until inflate() or setVisibility replaces it with its layout)';
  for (let at = ref, depth = 0; at && depth < 4096; at = runtime.object(at).parent, depth++) {
    const object = runtime.object(at); if (!subtype(runtime, object.type, VIEW)) break;
    if ((object.visibility ?? 0) === GONE) return at === ref ? 'it is GONE (View.GONE: its parent skips it in measure and layout)' : `${viewLabel(runtime, at)} above it is GONE: parents skip a GONE view in measure and layout, so nothing below it was measured`;
  }
  if (view.attached === false) return 'it is not attached to a window: no measure pass reaches a detached View';
  if (view.oldWidthSpec === undefined || view.oldHeightSpec === undefined) {
    let top = ref; for (let at = view.parent, depth = 0; at && depth < 4096; at = runtime.object(at).parent, depth++) { const object = runtime.object(at); if (!subtype(runtime, object.type, VIEW) || object.oldWidthSpec !== undefined) break; top = at; }
    const parent = runtime.object(top).parent, measuredParent = parent && subtype(runtime, runtime.object(parent).type, VIEW) ? parent : null;
    return `the measure pass never ran on this subtree: no MeasureSpec reached ${top === ref ? 'it' : viewLabel(runtime, top) + ' above it'}${measuredParent ? ` (${viewLabel(runtime, measuredParent)} was measured, but its onMeasure did not measure this child)` : runtime.object(top).layoutRequested !== false ? ' (the window\'s layout pass is still pending)' : ''}`;
  }
  if (!b) { const mw = (view.measuredWidth ?? 0) & SIZE, mh = (view.measuredHeight ?? 0) & SIZE; return `it was measured (${specText(view.oldWidthSpec)} x ${specText(view.oldHeightSpec)} → ${mw}x${mh}) but never laid out: no layout pass reached it after its measure`; }
  const parts = [];
  if (width === 0) parts.push(`width: ${axisReason(runtime, ref, 'width', 0)}`);
  if (height === 0) parts.push(`height: ${axisReason(runtime, ref, 'height', 0)}`);
  return parts.join('; ');
}

/** "<label> measured WxH because <reason>" for a 0-sized View. */
export function zeroSizeLine(runtime, ref) {
  const reason = zeroSizeReason(runtime, ref); if (!reason) return null;
  const view = runtime.object(ref), b = view.bounds;
  return `${viewLabel(runtime, ref)} is ${b ? `${b.right - b.left}x${b.bottom - b.top}` : '0x0 (never laid out)'} because ${reason}`;
}
