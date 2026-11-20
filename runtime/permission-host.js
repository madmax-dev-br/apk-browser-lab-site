// The VM side of the runtime-permission model (src/runtime-permissions.js): the state the page sends, what checkSelfPermission sees (platform.grantedPermissions), the requests that wait
// for the page's permission dialog and the rationale flag. The Worker posts `permission-request` to the page and takes the answer back with `respond`; nothing blocks in between, as on
// Android (Activity.requestPermissions returns at once and the result is delivered later through onRequestPermissionsResult).
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=f90be5f5e9be';
import { computeGranted, emptyConfig, sanitizeConfig, planRequest, answerDialog, settleRequest, rationale, sectionOf } from './runtime-permissions.js?v=f90be5f5e9be';

export function createPermissionHost(platform) {
  let config = emptyConfig(), sequence = 0;
  const pending = gcRoot(new Map());   // request id -> { held: [Java refs the delivery needs], names, requestCode, done, dialogs }
  const manifest = () => platform.manifest ?? {};
  /** The label the permission dialog names: the manifest's application label (a literal or a string resource), else the package name. */
  const appLabel = r => {
    const label = manifest().application?.label;
    if (typeof label === 'string' && label) return label;
    if (typeof label === 'number' && label > 0) { try { const value = platform.resource(label, ['string'])?.value; if (typeof value === 'string' && value) return value; } catch { /* unresolvable label: the package name */ } }
    return platform.packageName ?? 'O app';
  };
  const refresh = () => { platform.grantedPermissions = computeGranted(config, manifest()); platform.sharedStorage?.permissionsChanged();   /* the media files the File API shows follow the grant (src/shared-storage-host.js) */ };
  // A second installed package (src/package-registry.js) asks for its own runtime permissions from its own Activity (PermissionController, per package): its answers are kept
  // apart from the app's (each package's grants are its own), in a config of the same shape over that package's manifest. The page's dialog names that package.
  const packageConfigs = new Map();   // package name -> config
  const packageManifest = entry => ({ usesSdk: entry.manifest?.usesSdk, usesPermissions: entry.manifest?.usesPermissions ?? [], declaredPermissions: entry.manifest?.declaredPermissions ?? [] });
  const packageConfig = entry => packageConfigs.get(entry.name) ?? emptyConfig();
  const packageLabel = (r, entry) => {
    const label = entry.manifest?.application?.label;
    if (typeof label === 'string' && label) return label;
    if (typeof label === 'number' && label > 0) { try { const value = platform.withPackageResources(r, entry, () => platform.resource(label, ['string'])?.value); if (typeof value === 'string' && value) return value; } catch { /* unresolvable label: the package name */ } }
    return entry.name;
  };
  const host = {
    get config() { return config; },
    get pendingCount() { return pending.size; },
    /** Replaces the state (the page owns it: it changes it from the panel and from dialog answers). Takes effect at once for every later permission check. */
    setConfig(next) { config = sanitizeConfig(next); refresh(); },
    shouldShowRationale(permission) { return rationale(config, manifest(), permission); },
    /**
     * One requestPermissions call. `names`: the permission strings, `held`: the Java values `done` needs to deliver (kept alive while the dialog is open), `done(results)`: called with the
     * 0 / -1 answers in request order -- at once when no dialog is needed, later (from `respond`) otherwise; an empty array is Android's "request cancelled" answer.
     */
    /** Whether `permission` was granted at run time to the second installed package `entry` (its own dialog answers). */
    grantedFor(entry, permission) { return !!entry && !entry.main && computeGranted(packageConfig(entry), packageManifest(entry)).has(permission); },
    /** The runtime-permission state of a second installed package, as the page sends it back (tests, or a page that shows it). */
    setPackageConfig(entry, next) { packageConfigs.set(entry.name, sanitizeConfig(next)); },
    packageConfig,
    request(r, names, requestCode, held, done, { entry = null } = {}) {
      if (entry && !entry.main) return host.requestFor(r, entry, names, requestCode, held, done);
      const plan = planRequest(config, manifest(), names), summarize = (results) => `PERMISSIONS request ${requestCode} ${names.map((p, i) => `${p}=${results[i] === 0 ? 'granted' : 'denied'}`).join(' ')}`;
      if (pending.size > 0) { r.record(`PERMISSIONS request ${requestCode} cancelled: another permission request is already waiting for the user`); done([]); return; }   // PermissionManager answers a second concurrent request with empty arrays
      if (plan.dialogs.length === 0) { const results = names.map(name => (plan.results[name] ? 0 : -1)); r.record(summarize(results)); done(results); return; }
      const id = ++sequence, request = { id, held, names, requestCode, done, dialogs: plan.dialogs, summarize };
      if (typeof platform.onPermissionRequest !== 'function' || platform.permissionDialogs === false) {   // permissionDialogs: the Worker's page said it has no dialog (embedded player)
        // No permission dialog exists (embedded player, tests): the request is dismissed, as by a user who closed the dialog -- a denial that counts toward "don't ask again".
        let next = config; for (const dialog of plan.dialogs) next = answerDialog(next, manifest(), dialog, 'deny');
        host.setConfig(next); platform.onPermissionConfig?.(config); const results = names.map(name => (settleRequest(config, manifest(), [name])[name] ? 0 : -1)); r.record(summarize(results)); done(results); return;
      }
      pending.set(id, request); r.record(`PERMISSIONS request ${requestCode} waiting for the permission dialog (${plan.dialogs.map(dialog => dialog.group).join(', ')})`);
      platform.onPermissionRequest({
        id, requestCode, config, appLabel: appLabel(r),
        dialogs: plan.dialogs.map(dialog => ({ group: dialog.group, section: dialog.section.id, label: dialog.section.label, question: dialog.section.question, permissions: dialog.permissions, oneTime: dialog.group === 'LOCATION' })),
      });
    },
    /** requestPermissions from an Activity of a second installed package: the same plan and dialogs, over that package's manifest and its own state. */
    requestFor(r, entry, names, requestCode, held, done) {
      const own = packageManifest(entry), plan = planRequest(packageConfig(entry), own, names), summarize = (results) => `PERMISSIONS ${entry.name} request ${requestCode} ${names.map((p, i) => `${p}=${results[i] === 0 ? 'granted' : 'denied'}`).join(' ')}`;
      if (pending.size > 0) { r.record(`PERMISSIONS ${entry.name} request ${requestCode} cancelled: another permission request is already waiting for the user`); done([]); return; }
      if (plan.dialogs.length === 0) { const results = names.map(name => (plan.results[name] ? 0 : -1)); r.record(summarize(results)); done(results); return; }
      const id = ++sequence, request = { id, held, names, requestCode, done, dialogs: plan.dialogs, summarize, entry };
      if (typeof platform.onPermissionRequest !== 'function' || platform.permissionDialogs === false) {   // no dialog: dismissed, a denial
        let next = packageConfig(entry); for (const dialog of plan.dialogs) next = answerDialog(next, own, dialog, 'deny');
        packageConfigs.set(entry.name, next); const results = names.map(name => (settleRequest(next, own, [name])[name] ? 0 : -1)); r.record(summarize(results)); done(results); return;
      }
      pending.set(id, request); r.record(`PERMISSIONS ${entry.name} request ${requestCode} waiting for the permission dialog (${plan.dialogs.map(dialog => dialog.group).join(', ')})`);
      platform.onPermissionRequest({
        id, requestCode, config: packageConfig(entry), appLabel: packageLabel(r, entry), package: entry.name, manifest: own,
        dialogs: plan.dialogs.map(dialog => ({ group: dialog.group, section: dialog.section.id, label: dialog.section.label, question: dialog.section.question, permissions: dialog.permissions, oneTime: dialog.group === 'LOCATION' })),
      });
    },
    /** The page's answer to `permission-request` `id`: the new config after its dialogs (or null when it dismissed them all). Delivers the result. Unknown ids (a reloaded VM) are ignored. */
    respond(r, id, nextConfig) {
      const request = pending.get(id); if (!request) return false;
      pending.delete(id);
      if (request.entry) {   // a second installed package's own request: its own state changes, never the app's
        const own = packageManifest(request.entry); let next = packageConfig(request.entry);
        if (nextConfig) next = sanitizeConfig(nextConfig); else for (const dialog of request.dialogs) next = answerDialog(next, own, dialog, 'deny');
        packageConfigs.set(request.entry.name, next);
        const settled = settleRequest(next, own, request.names), results = request.names.map(name => (settled[name] ? 0 : -1));
        r.record(request.summarize(results)); request.done(results); return true;
      }
      if (nextConfig) host.setConfig(nextConfig);
      else { let next = config; for (const dialog of request.dialogs) next = answerDialog(next, manifest(), dialog, 'deny'); host.setConfig(next); }
      const settled = settleRequest(config, manifest(), request.names), results = request.names.map(name => (settled[name] ? 0 : -1));
      r.record(request.summarize(results)); request.done(results); return true;
    },
    /** The simulated device location from the page: { enabled, latitude, longitude, accuracy } or null. Registered listeners hear a change through the pump (platform.locationChanged). */
    setLocation(r, value) {
      const previous = platform.locationSimulation ?? null;
      if (!value || typeof value !== 'object') { platform.locationSimulation = null; if (previous) platform.locationChanged?.(r, previous); return; }
      const latitude = Number(value.latitude), longitude = Number(value.longitude), accuracy = Number(value.accuracy);
      if (!(latitude >= -90 && latitude <= 90) || !(longitude >= -180 && longitude <= 180) || !(accuracy >= 0 && accuracy < 1e7)) throw new RangeError('Invalid simulated location: latitude -90..90, longitude -180..180, accuracy in meters >= 0.');
      const enabled = !!value.enabled, changed = !previous || previous.latitude !== latitude || previous.longitude !== longitude || previous.accuracy !== accuracy || previous.enabled !== enabled;
      if (!changed) return;
      const fresh = !previous || previous.latitude !== latitude || previous.longitude !== longitude || previous.accuracy !== accuracy || (enabled && !previous.enabled);   // a new fix: new time
      platform.locationSimulation = { enabled, latitude, longitude, accuracy, hasFix: true,
        version: (previous?.version ?? 0) + (fresh ? 1 : 0), time: fresh ? platform.clock.wall() : previous.time, elapsedNanos: fresh ? Number(platform.clock.nanos()) : previous.elapsedNanos };
      platform.locationChanged?.(r, previous);
    },
    /** The ids of the requests waiting for the page (the page hides the dialog of a request that ended). */
    pendingIds: () => [...pending.keys()],
    section: sectionOf,
    [GC_ROOTS](visit) { for (const request of pending.values()) visit(request.held); },
  };
  refresh();
  return host;
}
