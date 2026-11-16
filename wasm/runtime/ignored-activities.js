// "Activities ignoradas" (Controles panel): a debugging tool. A start of an Activity on the list is validated like any start (an explicit target in this APK, FLAG_ACTIVITY_NEW_TASK outside an
// Activity, FORWARD_RESULT with a request code) and then dropped: no Activity is created, the caller keeps running, and a startActivityForResult caller never gets a result. Only starts the
// app asks for are affected (startActivity, startActivityForResult, startActivities, PendingIntent.send); the launch of the app and the deep links of the panel are not.
// Never silent: every dropped start is counted, the first and then every 100th writes a Logcat warning, the report and the Resumo list the ignored Activities and their counts.
// DOM-free and no process.*: runs in the Worker and in Node tests.

const ACTIVITY = 'Landroid/app/Activity;';
const MAX_ENTRIES = 50;

/** "pkg.Name", ".Name" (relative to the package), "Lpkg/Name;" or "pkg/.Name" as the class descriptor, or null when it cannot name a class. */
export function activityDescriptor(name, packageName = '') {
  let text = String(name ?? '').trim();
  if (!text) return null;
  if (/^L[^;\s]+;$/.test(text)) return text;
  const slash = text.indexOf('/');
  if (slash > 0 && !text.startsWith('L')) { const pkg = text.slice(0, slash), cls = text.slice(slash + 1); text = cls.startsWith('.') ? pkg + cls : cls; }   // the ComponentName short form
  if (text.startsWith('.')) text = packageName + text;
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(text)) return null;
  return `L${text.replaceAll('.', '/')};`;
}
const dotted = descriptor => descriptor.slice(1, -1).replaceAll('/', '.');

/**
 * Replaces the set of ignored Activities of the running VM. `entries`: [{ name, enabled }]. Answers one status per entry: { name, descriptor, state: 'active' | 'disabled' | 'invalid' |
 * 'missing', hits, error? }. Counts survive a re-apply of the same Activity.
 */
export function applyIgnoredActivities(runtime, entries) {
  const platform = runtime.platform, previous = platform.ignoredActivitiesAll ?? new Map(), all = new Map(), active = new Map(), statuses = [];
  const packageName = platform.packageName ?? '';
  for (const entry of (Array.isArray(entries) ? entries : []).slice(0, MAX_ENTRIES)) {
    const name = String(entry?.name ?? '').trim(), descriptor = activityDescriptor(name, packageName);
    if (!descriptor) { statuses.push({ name, descriptor: null, state: 'invalid', hits: 0, error: 'Nome de Activity inválido: use pacote.Classe, .Classe ou Lpacote/Classe;.' }); continue; }
    const record = previous.get(descriptor) ?? all.get(descriptor) ?? { descriptor, name: dotted(descriptor), hits: 0 };
    all.set(descriptor, record);
    let known = false; try { known = runtime.dex.classes.has(descriptor) && runtime.isSubtype(descriptor, ACTIVITY); } catch { known = false; }
    if (!known) { statuses.push({ name, descriptor, state: 'missing', hits: record.hits, error: `${dotted(descriptor)} não é uma Activity deste APK.` }); continue; }
    if (entry?.enabled === false) { statuses.push({ name, descriptor, state: 'disabled', hits: record.hits }); continue; }
    active.set(descriptor, record); statuses.push({ name, descriptor, state: 'active', hits: record.hits });
  }
  platform.ignoredActivitiesAll = all;
  platform.ignoredActivities = active.size ? active : null;   // null: the start path pays one property test and nothing else
  return statuses;
}

/** A start the platform is about to queue: true (and counted, and logged) when its target is on the list. */
export function ignoreActivityStart(runtime, descriptor, kind) {
  const record = runtime.platform.ignoredActivities?.get(descriptor);
  if (!record) return false;
  const hits = ++record.hits;
  runtime.record(`ACTIVITY start ignored ${record.name} (${kind})`);
  if (hits === 1 || hits % 100 === 0) runtime.record(`LOG W APKWebLab: Activity ignorada: ${record.name} não foi aberta (${kind}; ${hits} ${hits === 1 ? 'vez' : 'vezes'})`);
  return true;
}

/** The ignored Activities with their counts (snapshot, report and Resumo). */
export function describeIgnoredActivities(runtime) {
  return [...(runtime.platform.ignoredActivitiesAll?.values() ?? [])].map(record => ({ descriptor: record.descriptor, name: record.name, hits: record.hits, active: !!runtime.platform.ignoredActivities?.has(record.descriptor) }));
}

/** One line for the Resumo / screen state, or null when nothing is ignored. */
export function ignoredActivitiesLine(runtime) {
  const active = runtime.platform?.ignoredActivities;
  if (!active?.size) return null;
  const list = [...active.values()], starts = list.reduce((sum, record) => sum + record.hits, 0);
  return `Activities ignoradas ATIVAS: ${list.length} (${starts} ${starts === 1 ? 'abertura descartada' : 'aberturas descartadas'}): ${list.map(record => `${record.name} ×${record.hits}`).join(', ')}`;
}
