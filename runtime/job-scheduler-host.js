import { APKError } from './apk-error.js?v=999f1f5703aa';
import { createHostRegistry } from './host-contract.js?v=999f1f5703aa';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=999f1f5703aa';

// android.app.job: JobScheduler, JobInfo (+ Builder), JobParameters and the JobService base class, with the scheduling rules of Android 13's JobSchedulerService for the
// constraints a virtual device can answer. AOSP references: frameworks/base/apex/jobscheduler (JobSchedulerService.validateJob, JobStatus.isReady / wouldBeReadyWithConstraint,
// JobServiceContext.doServiceBoundLocked / executeRunnableJob / handleFinishedLocked), core/java/android/app/job/{JobInfo,JobParameters,JobService}.java.
//
//  * Constraints are read from the Dispositivo panel: network (connectivity: online = unmetered Wi-Fi, metered = mobile data, offline = none), charging, battery not low (> 15 % or
//    charging). Storage is never low. "Device idle" has no panel switch and is false, so a job that requires it never becomes ready (documented, not faked).
//  * Time is the VM clock; latency, deadlines, periods and back-off are VM events, so they advance with animations and Looper time and skip when the VM is idle.
//  * The service runs on the main thread (JobService's handler uses the main Looper). onStartJob returning true keeps the job running until jobFinished(); losing a constraint while
//    running calls onStopJob (and re-queues the job when it returns true).
//  * Work queues (Android 8+, JobScheduler.enqueue / JobParameters.dequeueWork / completeWork; JobStatus.enqueueWorkLocked / dequeueWorkLocked / completeWorkLocked): enqueue with the same
//    JobInfo appends to the job (also while it runs); a different JobInfo for the same id replaces the job and drops its work. dequeueWork moves the next pending item to "executing" and
//    bumps its delivery count; completeWork removes it from there. When a run ends (jobFinished or onStopJob) the executing items go back to the FRONT of the pending queue, and a job
//    that finished without reschedule but still has pending work stays scheduled and starts again (JobSchedulerService keeps a job with work). JobWorkItem is a host class (the AOSP
//    class is a Parcelable around an Intent plus bookkeeping the host owns, so there is nothing for the app VM to execute that the host does not already hold).
//  * How the service is run (JobServiceContext.executeRunnableJob / doServiceBoundLocked): the system binds the job's component with BIND_AUTO_CREATE and an Intent carrying the
//    component, takes the IBinder from onBind as an IJobService and calls startJob / stopJob on it. A JobService's own engine answers that; any other Service (the API 26+
//    JobIntentService shape) returns JobServiceEngine.getBinder() from onBind. Here a JobService subclass is called directly (same result: its engine just forwards to onStartJob /
//    onStopJob); a plain Service is created (attach, onCreate), onBind(Intent[component]) is called, and the returned engine binder drives onStartJob / onStopJob / jobFinished. When the
//    job ends the service is unbound (onUnbind, onDestroy) on the main thread, like the system does for a service with no other bindings. onBind returning null or any binder that is
//    not a JobServiceEngine binder fails with a named error (kind job-service-bind-failed). The job host keeps its own instance; it does not share one with Context.bindService.
//  * Not modelled: persistence across a lab restart (setPersisted is recorded; the permission is checked), content-URI triggers (setTriggerContentUri fails explicitly), URI grants carried
//    by a work item's Intent (a persisted job rejects such an Intent like AOSP; for other jobs the grants are not applied), per-work network estimate accounting, expedited quotas,
//    doze/standby buckets, the 10 minute execution cap.
const SCHEDULER = 'Landroid/app/job/JobScheduler;', INFO = 'Landroid/app/job/JobInfo;', BUILDER = 'Landroid/app/job/JobInfo$Builder;', PARAMS = 'Landroid/app/job/JobParameters;', JOB_SERVICE = 'Landroid/app/job/JobService;', SERVICE = 'Landroid/app/Service;';
const ENGINE = 'Landroid/app/job/JobServiceEngine;', ENGINE_BINDER = 'Landroid/app/job/JobServiceEngine$JobInterface;', IBINDER = 'Landroid/os/IBinder;';
const WORK = 'Landroid/app/job/JobWorkItem;', WORK_CREATOR = 'Landroid/app/job/JobWorkItem$1;', PARCEL = 'Landroid/os/Parcel;', INTENT = 'Landroid/content/Intent;', CREATOR = 'Landroid/os/Parcelable$Creator;';
const NETWORK_BYTES_UNKNOWN = -1n;
const COMPONENT = 'Landroid/content/ComponentName;', PERSISTABLE = 'Landroid/os/PersistableBundle;', BUNDLE = 'Landroid/os/Bundle;', STRING = 'Ljava/lang/String;', NETWORK = 'Landroid/net/Network;', WRAPPER = 'Landroid/content/ContextWrapper;', LIST = 'Ljava/util/List;';
const NETWORK_NONE = 0, NETWORK_ANY = 1, NETWORK_UNMETERED = 2, NETWORK_NOT_ROAMING = 3, NETWORK_METERED = 4;
const MIN_PERIOD = 15 * 60 * 1000, MIN_FLEX = 5 * 60 * 1000, MIN_BACKOFF = 10 * 1000, MAX_BACKOFF = 5 * 60 * 60 * 1000, DEFAULT_BACKOFF = 30 * 1000;
const RESULT_FAILURE = 0, RESULT_SUCCESS = 1;
const STOP_CANCELLED = 1, STOP_CONSTRAINT_BATTERY_NOT_LOW = 5, STOP_CONSTRAINT_CHARGING = 6, STOP_CONSTRAINT_CONNECTIVITY = 7, STOP_UNDEFINED = 0;

export function createJobSchedulerHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(SERVICE, WRAPPER, [], { allocatable: true }); type(JOB_SERVICE, SERVICE, [], { allocatable: true });
  type(SCHEDULER, 'Ljava/lang/Object;'); type(INFO, 'Ljava/lang/Object;', [], { allocatable: true }); type(BUILDER, 'Ljava/lang/Object;', [], { allocatable: true }); type(PARAMS, 'Ljava/lang/Object;', ['Landroid/os/Parcelable;'], { allocatable: true });
  type(ENGINE, 'Ljava/lang/Object;', [], { allocatable: true }); type(ENGINE_BINDER, 'Landroid/os/Binder;', [IBINDER], { allocatable: true });
  type(WORK, 'Ljava/lang/Object;', ['Landroid/os/Parcelable;'], { allocatable: true }); type(WORK_CREATOR, 'Ljava/lang/Object;', [CREATOR], { allocatable: true });
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

  /** The Intent JobServiceContext binds with: only the job's component. */
  function bindIntent(r, job) {
    const intent = r.allocate(INTENT); dispatch(r, INTENT, '<init>', [], 'V', [intent], 'direct');
    dispatch(r, INTENT, 'setComponent', [COMPONENT], INTENT, [intent, job.spec.component]); return intent;
  }
  /** Creates (or reuses) the service of a job: { ref, descriptor, callee: { ref, descriptor } receiving onStartJob/onStopJob, engine, intent }. */
  function serviceFor(r, job) {
    const key = job.spec.className;
    let instance = services.get(key);
    if (!instance) {
      const descriptor = `L${key.replaceAll('.', '/')};`;
      if (!r.classes.has(descriptor) || !r.isSubtype(descriptor, SERVICE)) throw new APKError(`Service ${key} is not a Service of this APK`, { kind: 'job-service-missing' });
      const ref = r.allocate(descriptor); dispatch(r, descriptor, '<init>', [], 'V', [ref], 'direct');
      r.object(ref).baseContext = platform.application; r.object(ref).jobServiceType = descriptor;
      dispatch(r, descriptor, 'onCreate', [], 'V', [ref]);
      instance = { ref, descriptor, callee: { ref, descriptor }, engine: null, intent: null };
      if (!r.isSubtype(descriptor, JOB_SERVICE)) {
        // Not a JobService: bind it the way the system does and drive the job through the JobServiceEngine binder onBind returns.
        const intent = bindIntent(r, job), binder = dispatch(r, descriptor, 'onBind', [INTENT], IBINDER, [ref, intent]);
        const engine = binder === null || binder === 0 ? null : r.object(binder).jobEngine ?? null;
        if (engine === null) {
          dispatch(r, descriptor, 'onDestroy', [], 'V', [ref]);
          throw new APKError(`Service ${key} was scheduled as a job but its onBind(Intent) returned ${binder === null || binder === 0 ? 'null' : `a ${r.typeOf(binder).slice(1, -1).replaceAll('/', '.')}`}, not a JobServiceEngine binder; JobSchedulerService can only run a JobService or a Service whose onBind returns JobServiceEngine.getBinder()`, { kind: 'job-service-bind-failed' });
        }
        Object.assign(instance, { engine, intent, callee: { ref: engine, descriptor: r.typeOf(engine) } });
      }
      services.set(key, instance);
    }
    return instance;
  }
  /** The job's run is over: a service that was bound for it is unbound (onUnbind, onDestroy) on the main thread, after the app code that ended the job returned. */
  function releaseService(r, job) {
    const service = job.service; job.service = null;
    if (!service?.engine || service.released) return;
    service.released = true;
    platform.queueTask(() => {
      if (services.get(job.spec.className) === service) services.delete(job.spec.className);
      dispatch(r, service.descriptor, 'onUnbind', [INTENT], 'Z', [service.ref, service.intent]);
      dispatch(r, service.descriptor, 'onDestroy', [], 'V', [service.ref]);
      r.record(`JOB unbind+destroy ${describe(job.spec)}`);
    }, 0, [service.ref, service.intent]);
  }
  function start(r, job, deadlineForced) {
    const spec = job.spec, service = serviceFor(r, job);
    job.running = true; job.deadlineForced = deadlineForced; stats.started++;
    const params = r.makeObject(PARAMS); Object.assign(r.object(params), { job, jobId: spec.id, overrideDeadlineExpired: deadlineForced, stopReason: STOP_UNDEFINED });
    job.params = params; job.service = service;
    r.record(`JOB start ${describe(spec)}${deadlineForced ? ' [deadline]' : ''}`);
    let more;
    try { more = dispatch(r, service.callee.descriptor, 'onStartJob', [PARAMS], 'Z', [service.callee.ref, params]); }
    catch (error) { job.running = false; releaseService(r, job); throw error; }
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
    job.running = false; job.params = null; stats.finished++; releaseWork(job); releaseService(r, job);
    r.record(`JOB finished ${describe(job.spec)} reschedule=${reschedule} (${why})`);
    if (!jobs.has(job.spec.id) || jobs.get(job.spec.id) !== job) return;           // cancelled or replaced meanwhile
    if (reschedule) { job.backoffAttempts++; job.earliest = clock() + backoffDelay(job); job.deadline = null; stats.rescheduled++; }
    else if (job.spec.periodic) { job.backoffAttempts = 0; nextPeriod(job); }
    else if (job.pending?.length) { job.backoffAttempts = 0; r.record(`JOB work left ${describe(job.spec)} items=${job.pending.length}`); }   // JobSchedulerService keeps a job that still has work and runs it again
    else jobs.delete(job.spec.id);
    kick(r);
  }
  /** A run ended: items handed out by dequeueWork but never completed return to the front of the pending queue, delivery count already bumped (JobStatus.stopTrackingJobLocked / JobServiceContext cleanup). */
  const releaseWork = job => { if (job.executing?.length) { job.pending = [...job.executing, ...(job.pending ?? [])]; job.executing = []; } };
  /** The system stops a running job (constraint lost, cancel): onStopJob(params) decides whether it comes back. */
  function stop(r, job, reason, constraint) {
    if (!job.running) return;
    stats.stopped++; r.object(job.params).stopReason = reason;
    const reschedule = dispatch(r, job.service.callee.descriptor, 'onStopJob', [PARAMS], 'Z', [job.service.callee.ref, job.params]);
    r.record(`JOB stopped ${describe(job.spec)} reason=${reason} reschedule=${!!reschedule}`);
    job.running = false; job.params = null; releaseWork(job); releaseService(r, job);
    if (constraint === false) return;                                                // cancelled: removed by the caller
    if (jobs.get(job.spec.id) !== job) return;
    if (reschedule || job.spec.periodic) { if (reschedule) { job.backoffAttempts++; job.earliest = clock() + backoffDelay(job); } else nextPeriod(job); stats.rescheduled++; }
    else if (job.pending?.length) { job.earliest = clock(); stats.rescheduled++; }
    else jobs.delete(job.spec.id);
    kick(r);
  }

  // ---- android.app.Service / JobService base classes ---------------------------------------------------------------------------------------------
  def(SERVICE, '<init>', '()V', () => {}); def(SERVICE, 'onCreate', '()V', () => {}); def(SERVICE, 'onDestroy', '()V', () => {});
  def(SERVICE, 'onBind', '(Landroid/content/Intent;)Landroid/os/IBinder;', () => null); def(SERVICE, 'onUnbind', '(Landroid/content/Intent;)Z', () => 0);
  def(SERVICE, 'getApplication', '()Landroid/app/Application;', () => platform.application);
  def(SERVICE, 'stopSelf', '()V', (r, _m, [self]) => { platform.serviceControl?.stopSelf(r, self); }); def(SERVICE, 'stopSelf', '(I)V', (r, _m, [self, startId]) => { platform.serviceControl?.stopSelf(r, self, startId); });
  // Foreground services (Service.java): startForeground needs android.permission.FOREGROUND_SERVICE on API 28+ and a Notification; the state is kept on the Service.
  const NOTIFICATION = 'Landroid/app/Notification;';
  const foreground = (r, self, id, notification, type) => {
    if (id === 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'id must not be 0');
    if (notification === null || notification === 0) r.throwJava('Ljava/lang/NullPointerException;', 'notification');
    if (!platform.holdsPermission?.(r, 'android.permission.FOREGROUND_SERVICE')) r.throwJava('Ljava/lang/SecurityException;', `Permission Denial: startForeground requires android.permission.FOREGROUND_SERVICE`);
    r.object(self).foreground = { id, type }; r.record(`SERVICE startForeground ${id}`);
  };
  def(SERVICE, 'startForeground', `(I${NOTIFICATION})V`, (r, _m, [self, id, notification]) => foreground(r, self, id, notification, -1));
  def(SERVICE, 'startForeground', `(I${NOTIFICATION}I)V`, (r, _m, [self, id, notification, type]) => foreground(r, self, id, notification, type));
  def(SERVICE, 'stopForeground', '(Z)V', (r, _m, [self]) => { r.object(self).foreground = null; });
  def(SERVICE, 'stopForeground', '(I)V', (r, _m, [self]) => { r.object(self).foreground = null; });
  def(SERVICE, 'getForegroundServiceType', '()I', (r, _m, [self]) => r.object(self).foreground?.type ?? 0);   // FOREGROUND_SERVICE_TYPE_NONE
  def(SERVICE, 'onRebind', '(Landroid/content/Intent;)V', () => {}); def(SERVICE, 'onTaskRemoved', '(Landroid/content/Intent;)V', () => {});
  def(SERVICE, 'onConfigurationChanged', '(Landroid/content/res/Configuration;)V', () => {});
  def(SERVICE, 'dump', '(Ljava/io/FileDescriptor;Ljava/io/PrintWriter;[Ljava/lang/String;)V', (r, _m, [, , writer]) => { if (writer !== null && writer !== 0) r.dispatch({ owner: 'Ljava/io/PrintWriter;', name: 'println', parameters: ['Ljava/lang/String;'], result: 'V', signature: '(Ljava/lang/String;)V' }, [writer, 'nothing to dump'], 'virtual'); });
  def(SERVICE, 'stopSelfResult', '(I)Z', (r, _m, [self, startId]) => platform.serviceControl?.stopSelf(r, self, startId) ?? 0);
  def(SERVICE, 'onStartCommand', '(Landroid/content/Intent;II)I', (r, _m, [self, intent, , startId]) => { r.dispatch({ owner: SERVICE, name: 'onStart', parameters: ['Landroid/content/Intent;', 'I'], result: 'V', signature: '(Landroid/content/Intent;I)V' }, [self, intent, startId], 'virtual'); return 1; });   // START_STICKY (the app targets API 5+)
  def(SERVICE, 'onStart', '(Landroid/content/Intent;I)V', () => {}); def(SERVICE, 'onLowMemory', '()V', () => {}); def(SERVICE, 'onTrimMemory', '(I)V', () => {});
  def(JOB_SERVICE, '<init>', '()V', () => {});
  def(JOB_SERVICE, 'jobFinished', `(${PARAMS}Z)V`, (r, _m, [, params, wantsReschedule]) => {
    if (params === null || params === 0) r.throwJava('Ljava/lang/NullPointerException;', 'params');
    const job = r.object(params).job; if (!job) return;
    finish(r, job, !!wantsReschedule, 'jobFinished');
  });
  // JobServiceEngine (core/java/android/app/job/JobServiceEngine.java, API 26): the base of the engine a Service wraps; the app subclass implements onStartJob / onStopJob. getBinder() is
  // the IJobService stub (here a Binder carrying the engine, which the job host recognises); jobFinished ends the run exactly as JobService.jobFinished does.
  def(ENGINE, '<init>', `(${SERVICE})V`, (r, _m, [self, service]) => { r.object(self).engineService = service; });
  def(ENGINE, 'getBinder', `()${IBINDER}`, (r, _m, [self]) => {
    const object = r.object(self);
    if (!object.engineBinder) { object.engineBinder = r.allocate(ENGINE_BINDER); dispatch(r, 'Landroid/os/Binder;', '<init>', [], 'V', [object.engineBinder], 'direct'); r.object(object.engineBinder).jobEngine = self; }
    return object.engineBinder;
  });
  def(ENGINE, 'jobFinished', `(${PARAMS}Z)V`, (r, _m, [, params, wantsReschedule]) => {
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
  def(PARAMS, 'getClipData', '()Landroid/content/ClipData;', () => null); 
  // JobParameters.dequeueWork / completeWork: only the run that received these parameters may use them (JobServiceContext.assertCallerLocked); a stale caller gets null / true.
  def(PARAMS, 'dequeueWork', `()${WORK}`, (r, _m, [self]) => {
    const job = r.object(self).job;
    if (!job?.running || job.params !== self) return null;
    const item = job.pending?.shift(); if (!item) return null;
    r.object(item).deliveryCount++; (job.executing ??= []).push(item); return item;
  });
  def(PARAMS, 'completeWork', `(${WORK})V`, (r, _m, [self, item]) => {
    if (item === null || item === 0) r.throwJava('Ljava/lang/NullPointerException;', 'work');
    const job = r.object(self).job;
    if (!job?.running || job.params !== self) return;
    const index = job.executing?.indexOf(item) ?? -1;
    if (index < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', `Given work is not active: ${r.stringCharacters(dispatch(r, WORK, 'toString', [], STRING, [item]))}`);
    job.executing.splice(index, 1);
  });
  def(PARAMS, 'describeContents', '()I', () => 0);

  // ---- JobWorkItem (core/java/android/app/job/JobWorkItem.java) ---------------------------------------------------------------------------------
  const work = (r, ref) => r.object(ref);
  const initWork = (r, self, intent, download, upload, chunk) => {
    if (chunk !== NETWORK_BYTES_UNKNOWN && chunk <= 0n) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Minimum chunk size must be positive');
    Object.assign(work(r, self), { intent: intent === 0 ? null : intent, downloadBytes: download, uploadBytes: upload, minimumChunkBytes: chunk, deliveryCount: 0, workId: 0 });
  };
  def(WORK, '<init>', `(${INTENT})V`, (r, _m, [self, intent]) => initWork(r, self, intent, NETWORK_BYTES_UNKNOWN, NETWORK_BYTES_UNKNOWN, NETWORK_BYTES_UNKNOWN));
  def(WORK, '<init>', `(${INTENT}JJ)V`, (r, _m, [self, intent, download, upload]) => initWork(r, self, intent, download, upload, NETWORK_BYTES_UNKNOWN));
  def(WORK, '<init>', `(${INTENT}JJJ)V`, (r, _m, [self, intent, download, upload, chunk]) => initWork(r, self, intent, download, upload, chunk));
  def(WORK, 'getIntent', `()${INTENT}`, (r, _m, [self]) => work(r, self).intent);
  def(WORK, 'getDeliveryCount', '()I', (r, _m, [self]) => work(r, self).deliveryCount);
  def(WORK, 'getEstimatedNetworkDownloadBytes', '()J', (r, _m, [self]) => work(r, self).downloadBytes);
  def(WORK, 'getEstimatedNetworkUploadBytes', '()J', (r, _m, [self]) => work(r, self).uploadBytes);
  def(WORK, 'getMinimumNetworkChunkBytes', '()J', (r, _m, [self]) => work(r, self).minimumChunkBytes);
  def(WORK, 'describeContents', '()I', () => 0);
  def(WORK, 'toString', `()${STRING}`, (r, _m, [self]) => {
    const w = work(r, self), intent = w.intent === null ? 'null' : r.stringCharacters(dispatch(r, INTENT, 'toString', [], STRING, [w.intent]));
    return `JobWorkItem{id=${w.workId} intent=${intent} dcount=${w.deliveryCount}}`;
  });
  // Parcel layout of the original: intent flag + Intent, three long network byte counts, delivery count, work id (the URI grants a system caller attaches are not carried).
  const parcel = (r, p, name, parameters, result, args = []) => dispatch(r, PARCEL, name, parameters, result, [p, ...args]);
  def(WORK, 'writeToParcel', `(${PARCEL}I)V`, (r, _m, [self, out]) => {
    const w = work(r, self);
    if (w.intent !== null) throw new APKError('JobWorkItem.writeToParcel: the lab has no Intent.writeToParcel, so a work item carrying an Intent cannot be parcelled', { kind: 'job-work-item-parcel-unsupported' });
    parcel(r, out, 'writeInt', ['I'], 'V', [0]);
    for (const value of [w.downloadBytes, w.uploadBytes, w.minimumChunkBytes]) parcel(r, out, 'writeLong', ['J'], 'V', [value]);
    parcel(r, out, 'writeInt', ['I'], 'V', [w.deliveryCount]); parcel(r, out, 'writeInt', ['I'], 'V', [w.workId]);
  });
  def(WORK_CREATOR, 'createFromParcel', `(${PARCEL})Ljava/lang/Object;`, (r, _m, [, input]) => {
    const item = r.allocate(WORK);
    if (parcel(r, input, 'readInt', [], 'I')) throw new APKError('JobWorkItem.CREATOR: the lab has no Intent.CREATOR, so a parcelled Intent cannot be read', { kind: 'job-work-item-parcel-unsupported' });
    const intent = null;
    const download = parcel(r, input, 'readLong', [], 'J'), upload = parcel(r, input, 'readLong', [], 'J'), chunk = parcel(r, input, 'readLong', [], 'J');
    initWork(r, item, intent, download, upload, chunk); work(r, item).deliveryCount = parcel(r, input, 'readInt', [], 'I'); work(r, item).workId = parcel(r, input, 'readInt', [], 'I'); return item;
  });
  def(WORK_CREATOR, 'newArray', '(I)[Ljava/lang/Object;', (r, _m, [, size]) => r.newArray(`[${WORK}`, size));
  registry.staticField(WORK, 'CREATOR', CREATOR, r => r.allocate(WORK_CREATOR));

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
  // JobScheduler.scheduleAsPackage(job, packageName, userId, tag): the hidden system-API overload (Firebase/Play Services measurement uses it with its own package). JobSchedulerService
  // accepts a request on behalf of the caller's own package and user only; the tag merely labels the work for attribution.
  def(SCHEDULER_STUB, 'scheduleAsPackage', `(${INFO}${STRING}I${STRING})I`, (r, m, [self, info, packageName, userId, tag]) => {
    if (packageName === null || packageName === 0) r.throwJava('Ljava/lang/NullPointerException;', 'packageName');
    const wanted = r.stringCharacters(packageName);
    if (wanted !== platform.packageName || userId !== 0) r.throwJava('Ljava/lang/SecurityException;', `Caller uid ${platform.virtualProcess.uid} cannot schedule jobs for package ${wanted} (user ${userId})`);
    return schedule(r, info);
  });
  def(SCHEDULER_STUB, 'schedule', `(${INFO})I`, (r, _m, [, info]) => schedule(r, info));
  function schedule(r, info) {
    if (info === null || info === 0) r.throwJava('Ljava/lang/NullPointerException;', 'job');
    const spec = specOf(r, info); validate(r, spec);
    const now = clock(), previous = jobs.get(spec.id);
    if (previous?.running) stop(r, previous, STOP_CANCELLED, false);
    const job = { spec, info, submitted: now, periodStart: now, earliest: spec.periodic ? now + spec.interval - spec.flex : now + (spec.hasLatency ? spec.minLatency : 0), deadline: spec.periodic ? now + spec.interval : spec.hasDeadline ? now + spec.maxDelay : null, running: false, backoffAttempts: 0, params: null };
    jobs.set(spec.id, job); stats.scheduled++; r.record(`JOB schedule ${describe(spec)} network=${spec.networkType} charging=${spec.requiresCharging} periodic=${spec.periodic}`);
    kick(r); return RESULT_SUCCESS;
  }
  def(SCHEDULER_STUB, 'cancel', '(I)V', (r, _m, [, id]) => { const job = jobs.get(id); if (!job) return; if (job.running) stop(r, job, STOP_CANCELLED, false); jobs.delete(id); stats.cancelled++; });
  def(SCHEDULER_STUB, 'cancelAll', '()V', r => { for (const job of [...jobs.values()]) { if (job.running) stop(r, job, STOP_CANCELLED, false); jobs.delete(job.spec.id); stats.cancelled++; } });
  def(SCHEDULER_STUB, 'getAllPendingJobs', `()${LIST}`, r => {
    const list = r.allocate('Ljava/util/ArrayList;'); dispatch(r, 'Ljava/util/ArrayList;', '<init>', [], 'V', [list], 'direct');
    for (const job of jobs.values()) dispatch(r, 'Ljava/util/ArrayList;', 'add', ['Ljava/lang/Object;'], 'Z', [list, job.info]);
    return list;
  });
  def(SCHEDULER_STUB, 'getPendingJob', `(I)${INFO}`, (r, _m, [, id]) => jobs.get(id)?.info ?? null);
  // JobSchedulerService.enqueue: the same JobInfo as the pending job appends to it (even while it runs); another JobInfo replaces the job (the old one is stopped, its work dropped).
  def(SCHEDULER_STUB, 'enqueue', `(${INFO}${WORK})I`, (r, _m, [, info, item]) => {
    if (info === null || info === 0) r.throwJava('Ljava/lang/NullPointerException;', 'job');
    if (item === null || item === 0) r.throwJava('Ljava/lang/NullPointerException;', 'work');
    const spec = specOf(r, info); validate(r, spec);
    const w = r.object(item);
    if (w.workId !== 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Already enqueued');
    if (spec.persisted && w.intent !== null && (dispatch(r, INTENT, 'getFlags', [], 'I', [w.intent]) & 3) !== 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Work items with URI grants cannot be enqueued on a persisted job');
    const previous = jobs.get(spec.id);
    if (previous && dispatch(r, INFO, 'equals', ['Ljava/lang/Object;'], 'Z', [previous.info, info])) { addWork(r, previous, item); r.record(`JOB enqueue ${describe(spec)} work=${w.workId}`); kick(r); return RESULT_SUCCESS; }
    const result = schedule(r, info); addWork(r, jobs.get(spec.id), item); r.record(`JOB enqueue ${describe(spec)} work=${w.workId}`); return result;
  });
  /** JobStatus.enqueueWorkLocked: work ids count from 1 per job. */
  function addWork(r, job, item) { job.nextWorkId ??= 1; r.object(item).workId = job.nextWorkId++; (job.pending ??= []).push(item); job.executing ??= []; }

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
