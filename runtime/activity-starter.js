// The lab's ActivityStarter: Intent launch flags, android:launchMode and task affinity decide which task and which Activity instance a startActivity() reaches.
// Modelled on AOSP android-13.0.0_r1 services/core/.../wm/ActivityStarter.java (computeLaunchingTaskFlags, getReusableIntentActivity, recycleTask/complyActivityFlags,
// deliverToCurrentTopIfNeeded, Task.performClearTop, Task.resetTaskIfNeeded) and ActivityThread's NewIntentItem ordering. The platform (android-platform.js) owns the task list,
// the Activity frames and the lifecycle primitives this class drives; nothing here touches the interpreter directly.

export const FLAG = {
  NO_HISTORY: 0x40000000, SINGLE_TOP: 0x20000000, NEW_TASK: 0x10000000, MULTIPLE_TASK: 0x08000000, CLEAR_TOP: 0x04000000, FORWARD_RESULT: 0x02000000, PREVIOUS_IS_TOP: 0x01000000,
  EXCLUDE_FROM_RECENTS: 0x00800000, BROUGHT_TO_FRONT: 0x00400000, RESET_TASK_IF_NEEDED: 0x00200000, LAUNCHED_FROM_HISTORY: 0x00100000, NEW_DOCUMENT: 0x00080000, CLEAR_WHEN_TASK_RESET: 0x00080000,
  NO_USER_ACTION: 0x00040000, REORDER_TO_FRONT: 0x00020000, NO_ANIMATION: 0x00010000, CLEAR_TASK: 0x00008000, TASK_ON_HOME: 0x00004000, RETAIN_IN_RECENTS: 0x00002000, LAUNCH_ADJACENT: 0x00001000,
};
export const LAUNCH_MODE = { standard: 0, singleTop: 1, singleTask: 2, singleInstance: 3, singleInstancePerTask: 4 };
export const DOCUMENT_MODE = { none: 0, intoExisting: 1, always: 2, never: 3 };
const truthy = value => value === true || value === 'true' || (typeof value === 'number' && value !== 0);
const enumValue = (value, names) => typeof value === 'string' && Object.hasOwn(names, value) ? names[value] : Number(value) | 0;

/** The task-related manifest attributes of an Activity (android:launchMode, taskAffinity, noHistory, ...), with the application-level taskAffinity default. */
export function activityInfoOf(manifest, packageName, type) {
  const name = type.slice(1, -1).replaceAll('/', '.'), declaration = manifest?.activities?.find(value => value.descriptor === type || value.name === name) ?? {}, application = manifest?.application ?? {};
  const affinity = typeof declaration.taskAffinity === 'string' ? declaration.taskAffinity : typeof application.taskAffinity === 'string' ? application.taskAffinity : packageName;
  return {
    type, launchMode: enumValue(declaration.launchMode, LAUNCH_MODE), documentLaunchMode: enumValue(declaration.documentLaunchMode, DOCUMENT_MODE), affinity,
    clearTaskOnLaunch: truthy(declaration.clearTaskOnLaunch), finishOnTaskLaunch: truthy(declaration.finishOnTaskLaunch), noHistory: truthy(declaration.noHistory),
    excludeFromRecents: truthy(declaration.excludeFromRecents), alwaysRetainTaskState: truthy(declaration.alwaysRetainTaskState), allowTaskReparenting: truthy(declaration.allowTaskReparenting),
  };
}

const live = frame => !frame.finishing && !frame.finished && !frame.finishRequested;
const topLive = (task, skip = []) => { for (let i = task.frames.length - 1; i >= 0; i--) if (live(task.frames[i]) && !skip.includes(task.frames[i])) return task.frames[i]; return null; };

export class ActivityStarter {
  constructor(platform) { this.p = platform; }

  /** Intent.filterEquals key: action, data, type, identifier, package, component and categories (extras and flags do not take part). */
  filterKey(runtime, intent) {
    const data = intent.data ? runtime.dispatch({ owner: 'Landroid/net/Uri;', name: 'toString', signature: '()Ljava/lang/String;', parameters: [], result: 'Ljava/lang/String;' }, [intent.data], 'virtual') : null;
    const text = value => value == null ? '' : typeof value === 'string' ? value : runtime.javaString(value);
    return JSON.stringify([text(intent.action), text(data), text(intent.mimeType), text(intent.identifier), text(intent.package), intent.target ?? '', [...(intent.categories ?? [])].map(text).sort()]);
  }

  /** RootWindowContainer.findTask: the most recent task whose base Activity is the target (ideal), else the first whose root affinity equals the target's. singleInstance tasks never match. */
  findTask(target, info) {
    let candidate = null;
    for (let i = this.p.tasks.length - 1; i >= 0; i--) {
      const task = this.p.tasks[i], top = topLive(task); if (!top) continue;
      if (this.p.activityInfo(task.frames[0]?.type ?? task.realActivity).launchMode === LAUNCH_MODE.singleInstance) continue;
      if (task.realActivity === target || task.frames[0]?.type === target) return task;
      if (!candidate && task.rootAffinity != null && task.rootAffinity === info.affinity) candidate = task;
    }
    return candidate;
  }

  /** ActivityStarter.getReusableIntentActivity: the existing task a NEW_TASK / singleTask / singleInstance launch lands in, or null. */
  reusableTask(target, info, flags) {
    const lm = info.launchMode, multiple = (flags & FLAG.MULTIPLE_TASK) !== 0;
    const putInto = ((flags & FLAG.NEW_TASK) !== 0 && !multiple) || lm === LAUNCH_MODE.singleInstance || lm === LAUNCH_MODE.singleTask;
    if (!putInto) return null;
    const tasks = [...this.p.tasks].reverse();
    if (lm === LAUNCH_MODE.singleInstance) return tasks.find(task => task.frames.some(frame => live(frame) && frame.type === target)) ?? null;
    if (lm === LAUNCH_MODE.singleInstancePerTask) return tasks.find(task => live(task.frames[0] ?? {}) && task.frames[0].type === target) ?? null;
    return this.findTask(target, info);
  }

  /** Task.performClearTop: everything above the topmost instance of the target finishes; a standard-mode instance (no SINGLE_TOP) finishes too and a fresh one is created. */
  clearTop(task, target, info, flags, finish) {
    for (let i = task.frames.length - 1; i >= 0; i--) {
      const frame = task.frames[i]; if (!live(frame) || frame.type !== target) continue;
      for (let j = task.frames.length - 1; j > i; j--) if (live(task.frames[j])) finish.push(task.frames[j]);
      const intoExisting = (flags & FLAG.NEW_DOCUMENT) !== 0 && (flags & FLAG.MULTIPLE_TASK) === 0 && info.documentLaunchMode !== DOCUMENT_MODE.never;
      if (info.launchMode === LAUNCH_MODE.standard && (flags & FLAG.SINGLE_TOP) === 0 && !intoExisting) { finish.push(frame); return null; }
      return frame;
    }
    return null;
  }

  /** Task.resetTaskIfNeeded (simplified, no reparenting): clearTaskOnLaunch of the launched Activity, finishOnTaskLaunch and CLEAR_WHEN_TASK_RESET Activities above the root finish. */
  resetList(task, info, finish) {
    const force = info.clearTaskOnLaunch;
    for (let i = task.frames.length - 1; i > 0; i--) {
      const frame = task.frames[i]; if (!live(frame) || finish.includes(frame)) continue;
      const own = this.p.activityInfo(frame.type);
      if (force || own.finishOnTaskLaunch || ((frame.launchFlags ?? 0) & FLAG.CLEAR_WHEN_TASK_RESET) !== 0) finish.push(frame);
    }
  }

  start(runtime, intentObject, target, sourceFrame, { resultCaller = null, requestCode = -1, fromActivity = true } = {}) {
    const p = this.p, intent = intentObject, info = p.activityInfo(target);
    let flags = intent.flags | 0;
    // ActivityStarter.adjustLaunchFlagsToDocumentMode (documents are approximated as NEW_TASK launches, see activityInfoOf).
    if (info.documentLaunchMode === DOCUMENT_MODE.always) flags |= FLAG.NEW_TASK | FLAG.MULTIPLE_TASK;
    else if (info.documentLaunchMode === DOCUMENT_MODE.intoExisting) flags |= FLAG.NEW_TASK;
    else if (info.documentLaunchMode === DOCUMENT_MODE.never) flags &= ~FLAG.NEW_DOCUMENT;
    else if ((flags & FLAG.NEW_DOCUMENT) !== 0) flags |= FLAG.NEW_TASK;
    const source = fromActivity ? sourceFrame : null, lm = info.launchMode;
    // computeLaunchingTaskFlags
    if (!source) flags |= FLAG.NEW_TASK;
    else if (p.activityInfo(source.type).launchMode === LAUNCH_MODE.singleInstance) flags |= FLAG.NEW_TASK;
    else if (lm === LAUNCH_MODE.singleInstance || lm === LAUNCH_MODE.singleTask || lm === LAUNCH_MODE.singleInstancePerTask) flags |= FLAG.NEW_TASK;
    // The result target: startActivityForResult names the caller; FLAG_ACTIVITY_FORWARD_RESULT hands the source's own result target to the new Activity instead.
    const frameOfActivity = ref => ref ? p.allFrames().find(frame => frame.activity.ref === ref.ref && !frame.finished) ?? null : null;
    let receiver = requestCode >= 0 && resultCaller && source && !source.finishing && !source.finishRequested ? frameOfActivity(resultCaller) : null, code = receiver ? requestCode : -1;
    if ((flags & FLAG.FORWARD_RESULT) !== 0 && source) {
      if (requestCode >= 0) p.throwAndroidRuntime(runtime, 'FORWARD_RESULT_FLAG used while also requesting a result');
      receiver = frameOfActivity(source.resultReceiver); code = receiver ? source.resultRequestCode : -1; source.resultReceiver = null; source.resultRequestCode = -1;
    }
    const noHistory = (flags & FLAG.NO_HISTORY) !== 0 || info.noHistory;
    const sourceTask = source ? p.taskOf(source) : null;
    // Which task: a reusable one for NEW_TASK / singleTask / singleInstance, a new one for plain NEW_TASK, else the caller's task.
    const reused = this.reusableTask(target, info, flags);
    let task = reused ?? ((flags & FLAG.NEW_TASK) !== 0 ? null : sourceTask ?? p.tasks.at(-1) ?? null);
    const plan = { flags, finish: [], deliver: null, task, newTask: false, reused: !!reused, receiver, code, noHistory, info, target, reorder: false };
    const intoExisting = (flags & FLAG.NEW_DOCUMENT) !== 0 && (flags & FLAG.MULTIPLE_TASK) === 0;
    let adding = false;
    if (!task || !topLive(task)) { plan.newTask = !task; adding = true; if (task && !topLive(task)) plan.finish.push(...task.frames.filter(live)); }
    else {
      if (reused && (flags & FLAG.RESET_TASK_IF_NEEDED) !== 0) this.resetList(task, info, plan.finish);
      const top = topLive(task, plan.finish);
      if ((flags & (FLAG.NEW_TASK | FLAG.CLEAR_TASK)) === (FLAG.NEW_TASK | FLAG.CLEAR_TASK)) {
        // complyActivityFlags: the task is emptied and the target becomes its new root.
        for (let i = task.frames.length - 1; i >= 0; i--) if (live(task.frames[i]) && !plan.finish.includes(task.frames[i])) plan.finish.push(task.frames[i]);
        plan.resetRoot = true; adding = true;
      } else if ((flags & FLAG.CLEAR_TOP) !== 0 || intoExisting || lm === LAUNCH_MODE.singleTask || lm === LAUNCH_MODE.singleInstance || lm === LAUNCH_MODE.singleInstancePerTask) {
        const found = this.clearTop(task, target, info, flags, plan.finish);
        if (found) plan.deliver = found; else adding = true;
      } else if (task.realActivity === target) {
        // The task's base Activity is launched again: the task comes to the front; SINGLE_TOP delivers to the top instance, another intent filter starts a new instance on top.
        if (((flags & FLAG.SINGLE_TOP) !== 0 || lm === LAUNCH_MODE.singleTop) && top.type === target) plan.deliver = top;
        else if (task.intentKey !== this.filterKey(runtime, intent)) adding = true;
        else if (!reused) adding = true;
        else { plan.deliver = top; plan.bringOnly = true; }
      } else if ((flags & FLAG.RESET_TASK_IF_NEEDED) === 0) adding = true;
      else if (reused) { plan.deliver = topLive(task, plan.finish); plan.bringOnly = true; }
      else adding = true;
      // FLAG_ACTIVITY_REORDER_TO_FRONT (ActivityStarter.setTaskFromSourceRecord, android-7.0): an existing instance in the task moves to the front instead of starting a new one.
      if (adding && !plan.resetRoot && (flags & FLAG.REORDER_TO_FRONT) !== 0 && (flags & FLAG.CLEAR_TOP) === 0) {
        const existing = [...task.frames].reverse().find(frame => live(frame) && frame.type === target && !plan.finish.includes(frame));
        if (existing) { plan.deliver = existing; plan.reorder = true; adding = false; }
      }
    }
    // deliverToCurrentTopIfNeeded: the Activity at the very top is the target and the launch is SINGLE_TOP (flag or launchMode) without a result request.
    if (adding) {
      const front = task ?? p.tasks.at(-1), top = front ? topLive(front, plan.finish) : null;
      if (top && !receiver && top.type === target && ((flags & FLAG.SINGLE_TOP) !== 0 || lm === LAUNCH_MODE.singleTop)) { plan.deliver = top; adding = false; plan.newTask = false; }
    }
    plan.add = adding;
    // A result requested from an Activity that lands in another task is cancelled at once (ActivityStarter.sendNewTaskResultRequestIfNeeded); a delivered-to-existing launch drops the request.
    const finalTask = plan.deliver ? p.taskOf(plan.deliver) : task;
    if (receiver) {
      if (plan.deliver || (adding && (flags & FLAG.NEW_TASK) !== 0 && finalTask !== sourceTask)) {
        if (!plan.deliver) { (receiver.pendingActivityResults ||= []).push({ requestCode: code, resultCode: 0, data: null }); plan.cancelled = receiver; }
        plan.receiver = null; plan.code = -1;
      }
    }
    return this.execute(runtime, intent, plan, source);
  }

  /** ActivityRecord.deliverNewIntentLocked + ActivityThread: the pausing, the NewIntentItem (after onRestart/onStart for a stopped Activity) and the resume. */
  execute(runtime, intent, plan, source) {
    const p = this.p, { flags, target, info } = plan;
    const delivered = p.copyIntent(runtime, intent, flags);
    const previous = p.tasks.at(-1)?.frames.at(-1) ?? null;
    const userLeaving = (flags & FLAG.NO_USER_ACTION) === 0;
    p.taskInBackground = false;
    const pinned = [...new Set([plan.task, plan.deliver ? p.taskOf(plan.deliver) : null].filter(Boolean))]; for (const task of pinned) task.pinned = (task.pinned ?? 0) + 1;
    try {
      if (plan.cancelled && plan.cancelled.lifecycleStage === 4) p.deliverActivityResults(runtime, plan.cancelled);
      const bringOnlySame = plan.bringOnly && plan.deliver === previous;
      if (previous && !bringOnlySame && plan.deliver !== previous) p.pauseForLaunch(runtime, previous, userLeaving);
      const deferred = [];
      for (const frame of plan.finish) {
        if (frame === previous) { frame.finishing = true; deferred.push(frame); continue; }
        p.retireFrame(runtime, frame);
      }
      const transition = { kind: 'open', animated: (flags & FLAG.NO_ANIMATION) === 0, from: source?.type ?? null, to: target };
      if (plan.deliver) {
        const frame = plan.deliver, task = p.taskOf(frame);
        if (plan.reorder) { task.frames.splice(task.frames.indexOf(frame), 1); task.frames.push(frame); }
        if (task.frames[0] === frame && !plan.bringOnly) { task.realActivity = target; task.intentKey = this.filterKey(runtime, intent); }   // the task takes the identity of the new intent when its root receives it
        p.bringTaskToFront(task);
        p.recordTransition(runtime, transition, source);
        runtime.record(`ACTIVITY task ${task.id} ${plan.bringOnly ? 'brought to front' : 'new intent'} ${frame.type}`);
        if (bringOnlySame) { /* already resumed at the top of the front task */ } else p.resumeFrame(runtime, frame, plan.bringOnly ? [] : [delivered]);
      } else {
        let task = plan.task;
        if (!task || plan.newTask) {
          task = p.newTask(target, info, { intentKey: this.filterKey(runtime, intent), exclude: (flags & FLAG.EXCLUDE_FROM_RECENTS) !== 0 || info.excludeFromRecents });
        } else {
          if (plan.resetRoot) { task.realActivity = target; task.intentKey = this.filterKey(runtime, intent); if ((flags & FLAG.EXCLUDE_FROM_RECENTS) !== 0) task.excludeFromRecents = true; }
          p.bringTaskToFront(task);
        }
        task.pinned = (task.pinned ?? 0) + 1; pinned.push(task);
        p.recordTransition(runtime, transition, source);
        p.createInstance(runtime, target, delivered, task, { resultReceiver: plan.receiver ? plan.receiver.activity : null, requestCode: plan.code, flags, noHistory: plan.noHistory });
      }
      // The Activity that was on top is no longer visible: onStop (noHistory Activities finish with it); one the launch finishes is torn down now.
      if (previous && plan.deliver !== previous && !deferred.includes(previous) && p.allFrames().includes(previous)) p.stopFrame(runtime, previous);
      for (const frame of deferred) {
        if (frame.lifecycleDepth > 0) { frame.finishing = false; frame.finishRequested = true; continue; }   // inside its own callback: ActivityThread finishes it when the callback returns
        if (p.allFrames().includes(frame)) p.retireFrame(runtime, frame);
      }
    } finally {
      for (const task of pinned) { task.pinned--; }
      p.dropEmptyTasks();
    }
  }
}
