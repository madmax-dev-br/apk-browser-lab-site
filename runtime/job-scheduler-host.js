import { APKError } from './apk-error.js?v=dc4f5903d89b';
import { createHostRegistry } from './host-contract.js?v=dc4f5903d89b';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=dc4f5903d89b';

// android.app.job: JobScheduler, JobInfo (+ Builder), JobParameters and the JobService base class, with the scheduling rules of Android 13's JobSchedulerService for the
// constraints a virtual device can answer. AOSP references: frameworks/base/apex/jobscheduler (JobSchedulerService.validateJob, JobStatus.isReady / wouldBeReadyWithConstraint,
// JobServiceContext.doServiceBoundLocked / executeRunnableJob / handleFinishedLocked), core/java/android/app/job/{JobInfo,JobParameters,JobService}.java.
//
//  * Constraints are read from the Dispositivo panel: network (connectivity: online = unmetered Wi-Fi, metered = mobile data, offline = none), charging, battery not low (> 15 % or
//    charging). Storage is never low. "Device idle" has no panel switch and is false, so a job that requires it never becomes ready (documented, not faked).
//  * Time is the VM clock; latency, deadlines, periods and back-off are VM events, so they advance with animations and Looper time and skip when the VM is idle.
//  * The service runs on the main thread (JobService's handler uses the main Looper). onStartJob returning true keeps the job running until jobFinished(); losing a constraint while
//    running calls onStopJob (and re-queues the job when it returns true).
//  * Not modelled: persistence across a lab restart (setPersisted is recorded; the permission is checked), content-URI triggers (setTriggerContentUri fails explicitly), JobWorkItem
//    queues, expedited quotas, doze/standby buckets, the 10 minute execution cap.
const SCHEDULER = 'Landroid/app/job/JobScheduler;', INFO = 'Landroid/app/job/JobInfo;', BUILDER = 'Landroid/app/job/JobInfo$Builder;', PARAMS = 'Landroid/app/job/JobParameters;', JOB_SERVICE = 'Landroid/app/job/JobService;', SERVICE = 'Landroid/app/Service;';
const COMPONENT = 'Landroid/content/ComponentName;', PERSISTABLE = 'Landroid/os/PersistableBundle;', BUNDLE = 'Landroid/os/Bundle;', STRING = 'Ljava/lang/String;', NETWORK = 'Landroid/net/Network;', WRAPPER = 'Landroid/content/ContextWrapper;', LIST = 'Ljava/util/List;';
const NETWORK_NONE = 0, NETWORK_ANY = 1, NETWORK_UNMETERED = 2, NETWORK_NOT_ROAMING = 3, NETWORK_METERED = 4;
const MIN_PERIOD = 15 * 60 * 1000, MIN_FLEX = 5 * 60 * 1000, MIN_BACKOFF = 10 * 1000, MAX_BACKOFF = 5 * 60 * 60 * 1000, DEFAULT_BACKOFF = 30 * 1000;
const RESULT_FAILURE = 0, RESULT_SUCCESS = 1;
const STOP_CANCELLED = 1, STOP_CONSTRAINT_BATTERY_NOT_LOW = 5, STOP_CONSTRAINT_CHARGING = 6, STOP_CONSTRAINT_CONNECTIVITY = 7, STOP_UNDEFINED = 0;

export function createJobSchedulerHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(SERVICE, WRAPPER, [], { allocatable: true }); type(JOB_SERVICE, SERVICE, [], { allocatable: true });
  type(SCHEDULER, 'Ljava/lang/Object;'); type(INFO, 'Ljava/lang/Object;', [], { allocatable: true }); type(BUILDER, 'Ljava/lang/Object;', [], { allocatable: true }); type(PARAMS, 'Ljava/lang/Object;', ['Landroid/os/Parcelable;'], { allocatable: true });
  const constants = { NETWORK_TYPE_NONE: NETWORK_NONE, NETWORK_TYPE_ANY: NETWORK_ANY, NETWORK_TYPE_UNMETERED: NETWORK_UNMETERED, NETWORK_TYPE_NOT_ROAMING: NETWORK_NOT_ROAMING, NETWORK_TYPE_METERED: NETWORK_METERED,
    BACKOFF_POLICY_LINEAR: 0, BACKOFF_POLICY_EXPONENTIAL: 1, PRIORITY_DEFAULT: 300, PRIORITY_LOW: 200, PRIORITY_MIN: 100, PRIORITY_HIGH: 400, PRIORITY_MAX: 500 };
  for (const [name, value] of Object.entries(constants)) registry.staticField(INFO, name, 'I', () => value);
  for (const [name, value] of Object.entries({ DEFAULT_INITIAL_BACKOFF_MILLIS: DEFAULT_BACKOFF, MAX_BACKOFF_DELAY_MILLIS: MAX_BACKOFF, MIN_BACKOFF_MILLIS: MIN_BACKOFF })) registry.staticField(INFO, name, 'J', () => BigInt(value));
  def(INFO, 'getMinPeriodMillis', '()J', () => BigInt(MIN_PERIOD), { static: true }); def(INFO, 'getMinFlexMillis', '()J', () => BigInt(MIN_FLEX), { static: true });
  for (const [name, value] of Object.entries({ RESULT_FAILURE, RESULT_SUCCESS })) registry.staticField(SCHEDULER, name, 'I', () => value);
  for (const [name, value] of Object.entries({ STOP_REASON_UNDEFINED: 0, STOP_REASON_CANCELLED_BY_APP: 1, STOP_REASON_PREEMPT: 2, STOP_REASON_TIMEOUT: 3, STOP_REASON_DEVICE_STATE: 4, STOP_REASON_CONSTRAINT_BATTERY_NOT_LOW: 5, STOP_REASON_CONSTRAINT_CHARGING: 6, STOP_REASON_CONSTRAINT_CONNECTIVITY: 7, STOP_REASON_CONSTRAINT_DEVICE_IDLE: 8, STOP_REASON_CONSTRAINT_STORAGE_NOT_LOW: 9, STOP_REASON_QUOTA: 10, STOP_REASON_BACKGROUND_RESTRICTION: 11, STOP_REASON_APP_STANDBY: 12, STOP_REASON_USER: 13, STOP_REASON_SYSTEM_PROCESSING: 14 }))
    registry.staticField(PARAMS, name, 'I', () => value);
  registry.staticField(JOB_SERVICE, 'PERMISSION_BIND', STRING, () => 'android.permission.BIND_JOB_SERVICE');

  // ---- state --------------------------------------------------------------------------------------------------------------------------------
  /** pending jobs by id: { id, info (Java JobInfo), spec (plain data), submitted, earliest, deadline, nextPeriod, running, backoffAttempts, generation } */
  const jobs = gcRoot(new Map()), services = gcRoot(new Map());
  const stats = platform.jobStats = { scheduled: 0, started: 0, finished: 0, stopped: 0, cancelled: 0, rescheduled: 0 };
  let scheduler = null;
  const clock = () => platform.clock.now();
  const dispatch = (r, owner, name, parameters, result, args, mode = 'virtual') => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, args, mode);
  const className = (r, component) => r.stringCharacters(dispatch(r, COMPONENT, 'getClassName', [], STRING, [component]));
  const describe = spec => `(job:${spec.id}/${spec.className})`;

  // ---- constraints ---------------------------------------------------------------------------------------------------------------------------
  const device = () => platform.device, connectivity = () => device().connectivity ?? 'online', battery = () => device().battery ?? { level: 80, charging: false };
  /** Which constraints of `spec` hold now; returns the STOP_* reason of the first unmet one, or null. */
  function unmetConstraint(spec) {
    const state = connectivity(), { level, charging } = battery();
    if (spec.networkType === NETWORK_ANY && state === 'offline') return STOP_CONSTRAINT_CONNECTIVITY;
    if (spec.networkType === NETWORK_NOT_ROAMING && state === 'offline') return STOP_CONSTRAINT_CONNECTIVITY;
    if (spec.networkType === NETWORK_UNMETERED && state !== 'online') return STOP_CONSTRAINT_CONNECTIVITY;
    if (spec.networkType === NETWORK_METERED && state !== 'metered') return STOP_CONSTRAINT_CONNECTIVITY;
    if (spec.requiresCharging && !charging) return STOP_CONSTRAINT_CHARGING;
    if (spec.requiresBatteryNotLow && !(charging || level > 15)) return STOP_CONSTRAINT_BATTERY_NOT_LOW;
    if (spec.requiresDeviceIdle) return 8;
    return null;
  }
  const backoffDelay = job => {
    const { backoffPolicy, initialBackoff } = job.spec, n = Math.max(1, job.backoffAttempts);
    return Math.min(MAX_BACKOFF, backoffPolicy === 1 ? initialBackoff * 2 ** (n - 1) : initialBackoff * n);
  };

  // ---- the scheduling loop (a VM event whenever something that matters changes) ------------------------------------------------------------------
  let pass = 0;
  /** Re-evaluates every job: stops running jobs whose constraints were lost, starts ready ones, and arms a timer for the next time-based change. */
  function evaluate(r) {
    const now = clock(); let next = Infinity; ++pass;
    for (const job of [...jobs.values()]) {
      const spec = job.spec;
      if (job.running) {
        const unmet = unmetConstraint(spec);
        if (unmet !== null && !job.deadlineForced) stop(r, job, unmet, true);
        continue;
      }
      const deadlinePassed = job.deadline !== null && now >= job.deadline;
      const timeReady = now >= job.earliest;
      if (deadlinePassed || (timeReady && unmetConstraint(spec) === null)) { start(r, job, deadlinePassed && unmetConstraint(spec) !== null); continue; }
      if (!timeReady) next = Math.min(next, job.earliest);
      if (job.deadline !== null) next = Math.min(next, job.deadline);
    }
    if (next !== Infinity) platform.queueTask(() => evaluate(r), Math.max(1, next - clock()), []);   // the closure holds only the runtime; jobs are reachable through [GC_ROOTS]
  }
  const kick = r => platform.queueTask(() => evaluate(r), 0, []);

  function serviceFor(r, job) {
    const key = job.spec.className;
    let instance = services.get(key);
    if (!instance) {
      const descriptor = `L${key.replaceAll('.', '/')};`;
      if (!r.classes.has(descriptor) || !r.isSubtype(descriptor, JOB_SERVICE)) throw new APKError(`JobService ${key} is not a JobService of this APK`, { kind: 'job-service-missing' });
      const ref = r.allocate(descriptor); dispatch(r, descriptor, '<init>', [], 'V', [ref], 'direct');
      r.object(ref).baseContext = platform.application; r.object(ref).jobServiceType = descriptor;
      dispatch(r, descriptor, 'onCreate', [], 'V', [ref]);
      instance = { ref, descriptor }; services.set(key, instance);
    }
    return instance;
  }
  function start(r, job, deadlineForced) {
    const spec = job.spec, service = serviceFor(r, job);
    job.running = true; job.deadlineForced = deadlineForced; stats.started++;
    const params = r.makeObject(PARAMS); Object.assign(r.object(params), { job, jobId: spec.id, overrideDeadlineExpired: deadlineForced, stopReason: STOP_UNDEFINED });
    job.params = params; job.service = service;
    r.record(`JOB start ${describe(spec)}${deadlineForced ? ' [deadline]' : ''}`);
    let more;
    try { more = dispatch(r, service.descriptor, 'onStartJob', [PARAMS], 'Z', [service.ref, params]); }
    catch (error) { job.running = false; throw error; }
    if (!more) finish(r, job, false, 'onStartJob returned false');
  }
  /** Periodic jobs run once per period, in the last `flex` ms of it; the period after a run starts where the previous one ended (JobStatus.createFromOldJob / getPeriodicJobRunTimes). */
  const nextPeriod = job => {
    const { interval, flex } = job.spec; job.periodStart += interval;
    while (job.periodStart + interval <= clock()) job.periodStart += interval;
    job.earliest = job.periodStart + interval - flex; job.deadline = job.periodStart + interval;
  };
  /** The job is over: remove it, re-queue it (back-off) or arm the next period. */
  function finish(r, job, reschedule, why) {
    if (!job.running) return;
    job.running = false; job.params = null; stats.finished++;
    r.record(`JOB finished ${describe(job.spec)} reschedule=${reschedule} (${why})`);
    if (!jobs.has(job.spec.id) || jobs.get(job.spec.id) !== job) return;           // cancelled or replaced meanwhile
    if (reschedule) { job.backoffAttempts++; job.earliest = clock() + backoffDelay(job); job.deadline = null; stats.rescheduled++; }
    else if (job.spec.periodic) { job.backoffAttempts = 0; nextPeriod(job); }
    else jobs.delete(job.spec.id);
    kick(r);
  }
  /** The system stops a running job (constraint lost, cancel): onStopJob(params) decides whether it comes back. */
  function stop(r, job, reason, constraint) {
    if (!job.running) return;
    stats.stopped++; r.object(job.params).stopReason = reason;
    const reschedule = dispatch(r, job.service.descriptor, 'onStopJob', [PARAMS], 'Z', [job.service.ref, job.params]);
    r.record(`JOB stopped ${describe(job.spec)} reason=${reason} reschedule=${!!reschedule}`);
    job.running = false; job.params = null;
    if (constraint === false) return;                                                // cancelled: removed by the caller
    if (jobs.get(job.spec.id) !== job) return;
    if (reschedule || job.spec.periodic) { if (reschedule) { job.backoffAttempts++; job.earliest = clock() + backoffDelay(job); } else nextPeriod(job); stats.rescheduled++; }
    else jobs.delete(job.spec.id);
    kick(r);
  }

  // ---- android.app.Service / JobService base classes ---------------------------------------------------------------------------------------------
  def(SERVICE, '<init>', '()V', () => {}); def(SERVICE, 'onCreate', '()V', () => {}); def(SERVICE, 'onDestroy', '()V', () => {});
  def(SERVICE, 'onBind', '(Landroid/content/Intent;)Landroid/os/IBinder;', () => null); def(SERVICE, 'onUnbind', '(Landroid/content/Intent;)Z', () => 0);
  def(SERVICE, 'getApplication', '()Landroid/app/Application;', () => platform.application);
  def(SERVICE, 'stopSelf', '()V', () => {}); def(SERVICE, 'onLowMemory', '()V', () => {}); def(SERVICE, 'onTrimMemory', '(I)V', () => {});
  def(JOB_SERVICE, '<init>', '()V', () => {});
  def(JOB_SERVICE, 'jobFinished', `(${PARAMS}Z)V`, (r, _m, [, params, wantsReschedule]) => {
    if (params === null || params === 0) r.throwJava('Ljava/lang/NullPointerException;', 'params');
    const job = r.object(params).job; if (!job) return;
    finish(r, job, !!wantsReschedule, 'jobFinished');
  });
  def(JOB_SERVICE, 'onNetworkChanged', `(${PARAMS})V`, () => {});

  // ---- JobParameters --------------------------------------------------------------------------------------------------------------------------
  def(PARAMS, 'getJobId', '()I', (r, _m, [self]) => r.object(self).jobId);
  def(PARAMS, 'getExtras', `()${PERSISTABLE}`, (r, _m, [self]) => (r.object(self).job.spec.extras ??= emptyBundle(r, PERSISTABLE)));
  def(PARAMS, 'getTransientExtras', `()${BUNDLE}`, (r, _m, [self]) => (r.object(self).job.spec.transientExtras ??= emptyBundle(r, BUNDLE)));
  def(PARAMS, 'isOverrideDeadlineExpired', '()Z', (r, _m, [self]) => r.object(self).overrideDeadlineExpired ? 1 : 0);
  def(PARAMS, 'getTriggeredContentUris', '()[Landroid/net/Uri;', () => null); def(PARAMS, 'getTriggeredContentAuthorities', `()[${STRING}`, () => null);
  def(PARAMS, 'getNetwork', `()${NETWORK}`, r => { const manager = platform.deviceState.getService(r, 'connectivity'); return manager ? dispatch(r, 'Landroid/net/ConnectivityManager;', 'getActiveNetwork', [], NETWORK, [manager]) : null; });
  def(PARAMS, 'getStopReason', '()I', (r, _m, [self]) => r.object(self).stopReason);
  def(PARAMS, 'getClipData', '()Landroid/content/ClipData;', () => null); def(PARAMS, 'dequeueWork', '()Landroid/app/job/JobWorkItem;', () => null);
  def(PARAMS, 'describeContents', '()I', () => 0);

  // ---- JobInfo / Builder ------------------------------------------------------------------------------------------------------------------------
  const specOf = (r, ref) => r.object(ref).spec;
  def(BUILDER, '<init>', `(I${COMPONENT})V`, (r, _m, [self, id, component]) => {
    if (component === null || component === 0) r.throwJava('Ljava/lang/NullPointerException;', 'Attempt to invoke virtual method on a null ComponentName');
    r.object(self).spec = { id, component, className: className(r, component), extras: null, transientExtras: null, networkType: NETWORK_NONE, requiresCharging: false, requiresBatteryNotLow: false, requiresStorageNotLow: false, requiresDeviceIdle: false,
      persisted: false, periodic: false, interval: 0, flex: 0, minLatency: 0, maxDelay: 0, hasLatency: false, hasDeadline: false, backoffPolicy: 1, initialBackoff: DEFAULT_BACKOFF, backoffSet: false, importantWhileForeground: false, prefetch: false, expedited: false };
  });
  const setter = (name, parameters, apply) => def(BUILDER, name, `(${parameters.join('')})${BUILDER}`, (r, _m, [self, ...args]) => { apply(specOf(r, self), r, ...args); return self; });
  setter('setRequiredNetworkType', ['I'], (spec, r, type) => { if (type < 0 || type > 4) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Unknown network type ' + type); spec.networkType = type; });
  setter('setRequiresCharging', ['Z'], (spec, r, value) => { spec.requiresCharging = !!value; });
  setter('setRequiresBatteryNotLow', ['Z'], (spec, r, value) => { spec.requiresBatteryNotLow = !!value; });
  setter('setRequiresStorageNotLow', ['Z'], (spec, r, value) => { spec.requiresStorageNotLow = !!value; });
  setter('setRequiresDeviceIdle', ['Z'], (spec, r, value) => { spec.requiresDeviceIdle = !!value; });
  setter('setPersisted', ['Z'], (spec, r, value) => { spec.persisted = !!value; });
  setter('setImportantWhileForeground', ['Z'], (spec, r, value) => { spec.importantWhileForeground = !!value; });
  setter('setPrefetch', ['Z'], (spec, r, value) => { spec.prefetch = !!value; });
  setter('setExpedited', ['Z'], (spec, r, value) => { spec.expedited = !!value; });
  setter('setExtras', [PERSISTABLE], (spec, r, extras) => { spec.extras = extras === 0 ? null : extras; });
  setter('setTransientExtras', [BUNDLE], (spec, r, extras) => { spec.transientExtras = extras === 0 ? null : extras; });
  setter('setMinimumLatency', ['J'], (spec, r, millis) => { spec.minLatency = Number(millis); spec.hasLatency = true; });
  setter('setOverrideDeadline', ['J'], (spec, r, millis) => { spec.maxDelay = Number(millis); spec.hasDeadline = true; });
  setter('setPeriodic', ['J'], (spec, r, interval) => { spec.periodic = true; spec.interval = Math.max(MIN_PERIOD, Number(interval)); spec.flex = spec.interval; });
  setter('setPeriodic', ['J', 'J'], (spec, r, interval, flex) => { spec.periodic = true; spec.interval = Math.max(MIN_PERIOD, Number(interval)); spec.flex = Math.min(spec.interval, Math.max(MIN_FLEX, Number(flex))); });
  setter('setBackoffCriteria', ['J', 'I'], (spec, r, initial, policy) => { spec.initialBackoff = Math.max(MIN_BACKOFF, Number(initial)); spec.backoffPolicy = policy; spec.backoffSet = true; });
  setter('setRequiredNetwork', ['Landroid/net/NetworkRequest;'], (spec, r) => { r.throwJava('Ljava/lang/UnsupportedOperationException;', 'JobInfo.Builder.setRequiredNetwork(NetworkRequest) needs NetworkRequest capabilities the virtual device does not model; use setRequiredNetworkType'); });
  for (const name of ['addTriggerContentUri', 'setTriggerContentUpdateDelay', 'setTriggerContentMaxDelay', 'setClipData'])
    def(BUILDER, name, `(${name === 'addTriggerContentUri' ? 'Landroid/app/job/JobInfo$TriggerContentUri;' : name === 'setClipData' ? 'Landroid/content/ClipData;I' : 'J'})${BUILDER}`, () => { throw new APKError(`JobInfo.Builder.${name}: content-URI triggers and clip data need a ContentObserver bridge that the virtual device does not have`, { kind: 'job-trigger-unsupported' }); });
  def(BUILDER, 'build', `()${INFO}`, (r, _m, [self]) => {
    const spec = { ...specOf(r, self) }, fail = message => r.throwJava('Ljava/lang/IllegalArgumentException;', message);
    if (spec.periodic) {
      if (spec.hasLatency) fail("Can't call setMinimumLatency() on a periodic job");
      if (spec.hasDeadline) fail("Can't call setOverrideDeadline() on a periodic job.");
    }
    if (spec.importantWhileForeground && spec.periodic) fail('An important while foreground job cannot have a time delay');
    if (spec.backoffSet && spec.initialBackoff < MIN_BACKOFF) fail('backoffMillis must be at least ' + MIN_BACKOFF);
    const info = r.makeObject(INFO); r.object(info).spec = spec; return info;
  });
  const infoSpec = (r, self) => specOf(r, self);
  def(INFO, 'getId', '()I', (r, _m, [self]) => infoSpec(r, self).id);
  def(INFO, 'getService', `()${COMPONENT}`, (r, _m, [self]) => infoSpec(r, self).component);
  def(INFO, 'getExtras', `()${PERSISTABLE}`, (r, _m, [self]) => (infoSpec(r, self).extras ??= emptyBundle(r, PERSISTABLE)));
  def(INFO, 'getTransientExtras', `()${BUNDLE}`, (r, _m, [self]) => (infoSpec(r, self).transientExtras ??= emptyBundle(r, BUNDLE)));
  def(INFO, 'getNetworkType', '()I', (r, _m, [self]) => infoSpec(r, self).networkType);
  for (const [name, key] of [['isRequireCharging', 'requiresCharging'], ['isRequireBatteryNotLow', 'requiresBatteryNotLow'], ['isRequireStorageNotLow', 'requiresStorageNotLow'], ['isRequireDeviceIdle', 'requiresDeviceIdle'], ['isPersisted', 'persisted'], ['isPeriodic', 'periodic'], ['isImportantWhileForeground', 'importantWhileForeground'], ['isPrefetch', 'prefetch'], ['isExpedited', 'expedited']])
    def(INFO, name, '()Z', (r, _m, [self]) => infoSpec(r, self)[key] ? 1 : 0);
  def(INFO, 'getIntervalMillis', '()J', (r, _m, [self]) => BigInt(infoSpec(r, self).periodic ? infoSpec(r, self).interval : 0));
  def(INFO, 'getFlexMillis', '()J', (r, _m, [self]) => BigInt(infoSpec(r, self).periodic ? infoSpec(r, self).flex : 0));
  def(INFO, 'getMinLatencyMillis', '()J', (r, _m, [self]) => BigInt(infoSpec(r, self).minLatency));
  def(INFO, 'getMaxExecutionDelayMillis', '()J', (r, _m, [self]) => BigInt(infoSpec(r, self).maxDelay));
  def(INFO, 'getBackoffPolicy', '()I', (r, _m, [self]) => infoSpec(r, self).backoffPolicy);
  def(INFO, 'getInitialBackoffMillis', '()J', (r, _m, [self]) => BigInt(infoSpec(r, self).initialBackoff));
  def(INFO, 'getTriggerContentUris', '()[Landroid/app/job/JobInfo$TriggerContentUri;', () => null);
  def(INFO, 'getTriggerContentUpdateDelay', '()J', () => -1n); def(INFO, 'getTriggerContentMaxDelay', '()J', () => -1n);
  def(INFO, 'toString', `()${STRING}`, (r, _m, [self]) => { const s = infoSpec(r, self); return `(job:${s.id}/${s.className})`; });
  def(INFO, 'hashCode', '()I', (r, _m, [self]) => infoSpec(r, self).id);
  def(INFO, 'equals', '(Ljava/lang/Object;)Z', (r, _m, [self, other]) => other && r.typeOf(other) === INFO && JSON.stringify({ ...infoSpec(r, self), extras: 0, component: 0, transientExtras: 0 }) === JSON.stringify({ ...infoSpec(r, other), extras: 0, component: 0, transientExtras: 0 }) ? 1 : 0);
  const emptyBundle = (r, owner) => { const ref = r.allocate(owner); dispatch(r, owner, '<init>', [], 'V', [ref], 'direct'); return ref; };

  // ---- JobScheduler ---------------------------------------------------------------------------------------------------------------------------------
  /** JobSchedulerService.validateJob: the service must be declared in the manifest and require android.permission.BIND_JOB_SERVICE. */
  function validate(r, spec) {
    const details = (platform.manifest?.componentDetails ?? []).find(entry => entry.kind === 'service' && entry.name === spec.className);
    if (!details) r.throwJava('Ljava/lang/IllegalArgumentException;', `No such service ComponentInfo{${platform.packageName}/${spec.className}}`);
    if (details.permission !== 'android.permission.BIND_JOB_SERVICE') r.throwJava('Ljava/lang/IllegalArgumentException;', `Scheduled service ServiceInfo{${spec.className}} does not require android.permission.BIND_JOB_SERVICE permission`);
    if (spec.persisted && !platform.holdsPermission?.(r, 'android.permission.RECEIVE_BOOT_COMPLETED')) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Error: requested job be persisted without holding RECEIVE_BOOT_COMPLETED permission.');
  }
  const SCHEDULER_STUB = SCHEDULER;
  def(SCHEDULER_STUB, 'schedule', `(${INFO})I`, (r, _m, [, info]) => {
    if (info === null || info === 0) r.throwJava('Ljava/lang/NullPointerException;', 'job');
    const spec = specOf(r, info); validate(r, spec);
    const now = clock(), previous = jobs.get(spec.id);
    if (previous?.running) stop(r, previous, STOP_CANCELLED, false);
    const job = { spec, info, submitted: now, periodStart: now, earliest: spec.periodic ? now + spec.interval - spec.flex : now + (spec.hasLatency ? spec.minLatency : 0), deadline: spec.periodic ? now + spec.interval : spec.hasDeadline ? now + spec.maxDelay : null, running: false, backoffAttempts: 0, params: null };
    jobs.set(spec.id, job); stats.scheduled++; r.record(`JOB schedule ${describe(spec)} network=${spec.networkType} charging=${spec.requiresCharging} periodic=${spec.periodic}`);
    kick(r); return RESULT_SUCCESS;
  });
  def(SCHEDULER_STUB, 'cancel', '(I)V', (r, _m, [, id]) => { const job = jobs.get(id); if (!job) return; if (job.running) stop(r, job, STOP_CANCELLED, false); jobs.delete(id); stats.cancelled++; });
  def(SCHEDULER_STUB, 'cancelAll', '()V', r => { for (const job of [...jobs.values()]) { if (job.running) stop(r, job, STOP_CANCELLED, false); jobs.delete(job.spec.id); stats.cancelled++; } });
  def(SCHEDULER_STUB, 'getAllPendingJobs', `()${LIST}`, r => {
    const list = r.allocate('Ljava/util/ArrayList;'); dispatch(r, 'Ljava/util/ArrayList;', '<init>', [], 'V', [list], 'direct');
    for (const job of jobs.values()) dispatch(r, 'Ljava/util/ArrayList;', 'add', ['Ljava/lang/Object;'], 'Z', [list, job.info]);
    return list;
  });
  def(SCHEDULER_STUB, 'getPendingJob', `(I)${INFO}`, (r, _m, [, id]) => jobs.get(id)?.info ?? null);
  def(SCHEDULER_STUB, 'enqueue', `(${INFO}Landroid/app/job/JobWorkItem;)I`, () => { throw new APKError('JobScheduler.enqueue(JobWorkItem) work queues are not implemented by the virtual device', { kind: 'job-work-item-unsupported' }); });

  return {
    ...registry,
    /** Java values this host keeps outside the heap: pending jobs (JobInfo, extras, running JobParameters), service instances and the scheduler object. */
    [GC_ROOTS](visit) { for (const job of jobs.values()) visit(job); for (const service of services.values()) visit(service); if (scheduler) visit(scheduler); },
    getService(r, name) { if (name !== 'jobscheduler') return null; scheduler ??= r.makeObject(SCHEDULER); return scheduler; },
    /** Device settings changed (connectivity, charging, battery): constraints are re-evaluated like JobSchedulerService's StateControllers do. */
    constraintsChanged(r) { if (jobs.size) kick(r); },
    pendingJobs: () => [...jobs.values()].map(job => ({ id: job.spec.id, service: job.spec.className, running: job.running, networkType: job.spec.networkType, periodic: job.spec.periodic })),
  };
}
