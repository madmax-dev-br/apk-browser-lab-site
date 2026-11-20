// The View that hosts a Compose hierarchy (Compose UI's AndroidComposeView) under its library name or under the short name R8 gives it in a minified app.
//
// The lab draws that View through its RenderNode (src/compose-canvas-host.js) and sends it real pointer input (src/pointer-input-host.js). A shipped app is usually built
// with R8, which renames the class (only its library's keep rules decide what survives), so the library name alone misses it: the View was then treated as an ordinary
// ViewGroup of the app that overrides onDraw (empty in Compose) and its content, drawn in dispatchDraw, never appeared; touches were dropped.
//
// The name is the first match. Otherwise the View is recognized by what the Compose owner is on Android, in Android API terms only: a ViewGroup whose class comes from the
// app's DEX and overrides there onDraw(Canvas) and dispatchDraw(Canvas) (it draws its node tree itself), onCreateInputConnection(EditorInfo) (it is the text editor of its
// text fields) and onProvideAutofillVirtualStructure(ViewStructure, int) (its nodes are virtual autofill children). Those overrides are in the owner of every Compose UI
// release; how it listens to its ViewTreeObserver is not (older releases implement the listener interfaces, newer ones register lambdas). A ViewGroup that only overrides
// dispatchDraw (ConstraintLayout and other layout libraries do) is not one: its children stay separate Views on the page. A structural match is recorded once per class.

const OWNER = 'Landroidx/compose/ui/platform/AndroidComposeView;', GROUP = 'Landroid/view/ViewGroup;', CANVAS = '(Landroid/graphics/Canvas;)V';
const OVERRIDES = [`onDraw${CANVAS}`, `dispatchDraw${CANVAS}`, 'onCreateInputConnection(Landroid/view/inputmethod/EditorInfo;)Landroid/view/inputmethod/InputConnection;', 'onProvideAutofillVirtualStructure(Landroid/view/ViewStructure;I)V'];
const verdicts = new WeakMap();

export const COMPOSE_OWNER_NAME = OWNER;

/** Whether instances of `type` are a Compose owner View (by name, or by the structure above in a minified app). */
export function isComposeOwner(runtime, type) {
  if (!type) return false;
  let known = verdicts.get(runtime); if (!known) verdicts.set(runtime, known = new Map());
  let verdict = known.get(type);
  if (verdict === undefined) { verdict = classify(runtime, type); known.set(type, verdict); if (verdict === 'structure') runtime.record?.(`COMPOSE owner recognized by structure (minified app): ${type.slice(1, -1).replaceAll('/', '.')} is a ViewGroup of the app overriding onDraw, dispatchDraw, onCreateInputConnection and onProvideAutofillVirtualStructure`); }
  return verdict !== false;
}

function classify(runtime, type) {
  if (runtime.isSubtype(type, OWNER)) return 'name';
  if (!runtime.isSubtype(type, GROUP)) return false;
  const own = signature => { const method = runtime.objectOverride(type, signature); return !!method && runtime.dex?.classes?.has?.(method.owner) && !runtime.dex?.bootClasses?.has?.(method.owner); };
  return OVERRIDES.every(own) ? 'structure' : false;
}
