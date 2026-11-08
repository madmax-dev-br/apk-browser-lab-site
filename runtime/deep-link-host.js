// "Open a deep link": the page describes an Intent ({ action, data, category, extras, type, component }); this resolves it against the manifest the way `am start -a VIEW -d <uri>` does
// (src/intent-resolver.js), builds the real android.content.Intent inside the VM through its public API (new Intent, setAction, setData(Uri.parse), addCategory, putExtra,
// setComponent) and hands it to the same starter every startActivity() uses. A running app gets a system launch (no source Activity: FLAG_ACTIVITY_NEW_TASK, launchMode and
// onNewIntent decide the rest); an app that was not started yet gets the Intent as its launcher Intent.
import { resolveIntent, unresolvedMessage, describeIntent, normalizeIntentRequest } from './intent-resolver.js?v=cde218cfa9f2';

const INTENT = 'Landroid/content/Intent;', URI = 'Landroid/net/Uri;', COMPONENT = 'Landroid/content/ComponentName;', STRING = 'Ljava/lang/String;';
const F64 = new Float64Array(1), B64 = new BigInt64Array(F64.buffer);
const doubleBits = number => { F64[0] = number; return B64[0]; };   // a double argument travels as its IEEE bits (a wide register pair)
const call = (r, owner, name, parameters, result, args, mode = 'virtual') => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` },
  mode === 'static' ? r.argumentWords(parameters, args) : r.argumentWords(parameters, args.slice(1), { receiver: args[0] }), mode);

/** The Intent object for `request`, targeting the resolved Activity (Android fills the resolved component into the Intent the Activity receives). */
export function buildIntent(runtime, request, activityName) {
  const packageName = runtime.platform.packageName, intent = runtime.allocate(INTENT);
  runtime.hostRoots.push(intent);
  try {
    call(runtime, INTENT, '<init>', [], 'V', [intent], 'direct');
    if (request.action) call(runtime, INTENT, 'setAction', [STRING], INTENT, [intent, request.action]);
    if (request.data) {
      const uri = call(runtime, URI, 'parse', [STRING], URI, [request.data], 'static');
      if (request.type) call(runtime, INTENT, 'setDataAndType', [URI, STRING], INTENT, [intent, uri, request.type]); else call(runtime, INTENT, 'setData', [URI], INTENT, [intent, uri]);
    } else if (request.type) call(runtime, INTENT, 'setType', [STRING], INTENT, [intent, request.type]);
    for (const category of request.category) call(runtime, INTENT, 'addCategory', [STRING], INTENT, [intent, category]);
    for (const [key, value] of Object.entries(request.extras)) {
      const kind = typeof value === 'string' ? STRING : typeof value === 'boolean' ? 'Z' : Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ? 'I' : 'D';
      call(runtime, INTENT, 'putExtra', [STRING, kind], INTENT, [intent, key, kind === 'Z' ? (value ? 1 : 0) : kind === 'D' ? doubleBits(value) : value]);
    }
    const component = runtime.allocate(COMPONENT);
    call(runtime, COMPONENT, '<init>', [STRING, STRING], 'V', [component, packageName, activityName], 'direct');
    call(runtime, INTENT, 'setComponent', [COMPONENT], INTENT, [intent, component]);
  } finally { runtime.hostRoots.pop(); }
  return intent;
}

/**
 * Resolves and starts. Returns { ok: false, error, considered } when nothing matches (nothing is started), else
 * { ok: true, activity, filter, alternatives, launched } where `launched` says whether this was the app's first start.
 */
export function startDeepLink(runtime, input) {
  const platform = runtime.platform, request = normalizeIntentRequest(input), resolution = resolveIntent(platform.manifest, request);
  const described = describeIntent(request);
  if (!resolution.matches.length) {
    const error = unresolvedMessage(resolution);
    runtime.record(`ACTIVITY deep link ${described} unresolved (${resolution.considered.length} filter(s) considered)`);
    return { ok: false, intent: described, error, considered: resolution.considered };
  }
  const [chosen, ...others] = resolution.matches, type = `L${chosen.activity.replaceAll('.', '/')};`;
  if (!runtime.dex.classes.has(type) || !runtime.isSubtype(type, 'Landroid/app/Activity;')) {
    const error = `Activity not started: ${chosen.activity} is declared in the manifest but is not an Activity class packaged in this APK`;
    runtime.record(`ACTIVITY deep link ${described} failed: ${chosen.activity} is not packaged`);
    return { ok: false, intent: described, error, considered: [] };
  }
  const alternatives = others.map(entry => ({ activity: entry.activity, filter: entry.filter }));
  runtime.record(`ACTIVITY deep link ${described} -> ${chosen.activity}${alternatives.length ? ` (also matched: ${alternatives.map(entry => entry.activity).join(', ')})` : ''}`);
  runtime.steps = 0;
  const intent = buildIntent(runtime, request, chosen.activity), launched = platform.applicationState !== 'initialized';
  runtime.hostRoots.push(intent);
  try {
    if (launched) runtime.launch(chosen.activity, { intent });
    else platform.startFromSystem(runtime, intent);
  } finally { runtime.hostRoots.pop(); }
  return { ok: true, intent: described, kind: resolution.kind, activity: chosen.activity, filter: chosen.filter, alternatives, launched };
}
