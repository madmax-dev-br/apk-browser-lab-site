import { createHostRegistry } from './host-contract.js?v=da7619ccc1f1';

// More of android.app.ActivityManager for the one-process virtual device (frameworks/base ActivityManager.java and ActivityManagerService, android-13.0.0_r1):
//  getHistoricalProcessExitReasons / setProcessStateSummary (ApplicationExitInfo is the original class): nothing of this app has ever exited in the VM, so the history is empty;
//  the process state summary is kept and limited to 128 bytes; the rest answers like a device with no test harness, no lock task mode and no errors in the process list.
const AM = 'Landroid/app/ActivityManagerImpl;', AM_STATIC = 'Landroid/app/ActivityManager;', LIST = 'Ljava/util/List;', STRING = 'Ljava/lang/String;';
const KILL_BACKGROUND_PROCESSES = 'android.permission.KILL_BACKGROUND_PROCESSES', REORDER_TASKS = 'android.permission.REORDER_TASKS', MAX_STATE_BYTES = 128;

export function createActivityManagerExtrasHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  const uid = () => platform.virtualProcess.uid;
  const emptyList = r => { const list = r.allocate('Ljava/util/ArrayList;'); r.dispatch({ owner: 'Ljava/util/ArrayList;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [list], 'direct'); return list; };
  const require = (r, permission, what) => { if (!platform.holdsPermission?.(r, permission)) r.throwJava('Ljava/lang/SecurityException;', `Permission Denial: ${what} from pid=${platform.virtualProcess.pid}, uid=${uid()} requires ${permission}`); };

  def(AM, 'getHistoricalProcessExitReasons', `(${STRING}II)${LIST}`, r => emptyList(r));   // a package that is not this app is unknown to the VM, which AMS answers with an empty list as well
  def(AM, 'setProcessStateSummary', '([B)V', (r, _m, [, state]) => {
    if (state !== null && state !== 0 && r.array(state).elements.length > MAX_STATE_BYTES) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Data size is too large');
    platform.processStateSummary = state === null || state === 0 ? null : Uint8Array.from(r.array(state).elements, value => value & 255);
  });
  def(AM_STATIC, 'isLowMemoryKillReportSupported', '()Z', r => (r.dispatch({ owner: 'Landroid/os/SystemProperties;', name: 'getBoolean', parameters: [STRING, 'Z'], result: 'Z', signature: `(${STRING}Z)Z` }, ['persist.sys.lmk.reportkills', 0], 'static') ? 1 : 0), { static: true });
  def(AM_STATIC, 'isRunningInTestHarness', '()Z', () => 0, { static: true });
  def(AM, 'isRunningInUserTestHarness', '()Z', () => 0); def(AM, 'isUserAMonkey', '()Z', () => 0);
  def(AM, 'getProcessesInErrorState', `()${LIST}`, () => null);   // no process of the device is in an error state
  def(AM, 'getRecentTasks', `(II)${LIST}`, r => emptyList(r));
  def(AM, 'isInLockTaskMode', '()Z', () => 0); def(AM, 'getLockTaskModeState', '()I', () => 0);   // LOCK_TASK_MODE_NONE
  def(AM, 'getLauncherLargeIconDensity', '()I', () => 160); def(AM, 'getLauncherLargeIconSize', '()I', () => 48);   // the model is a 160 dpi display; the launcher icon is 48dp
  for (const name of ['killBackgroundProcesses', 'restartPackage']) def(AM, name, `(${STRING})V`, (r, _m, [, packageName]) => { if (packageName === null) r.throwJava('Ljava/lang/NullPointerException;', null); require(r, KILL_BACKGROUND_PROCESSES, name); });
  def(AM, 'moveTaskToFront', '(II)V', r => require(r, REORDER_TASKS, 'moveTaskToFront')); def(AM, 'moveTaskToFront', '(IILandroid/os/Bundle;)V', r => require(r, REORDER_TASKS, 'moveTaskToFront'));
  def(AM, 'setWatchHeapLimit', '(J)V', () => {}); def(AM, 'clearWatchHeapLimit', '()V', () => {});
  def(AM, 'getRunningServiceControlPanel', '(Landroid/content/ComponentName;)Landroid/app/PendingIntent;', () => null);
  def(AM, 'isActivityStartAllowedOnDisplay', '(Landroid/content/Context;ILandroid/content/Intent;)Z', (r, _m, [, , displayId]) => (displayId === 0 ? 1 : 0));   // only the default display exists
  return { ...registry };
}
