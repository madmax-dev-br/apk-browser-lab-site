// The process ids of the virtual device, in one place so every view of them agrees (Process.myPid, Os.getpid / getppid, Binder calling pids, the ARM64 libc's getpid /
// getppid and raw system calls, /proc/self, logcat). init is 1; zygote64 (/system/bin/app_process64, the parent of every app process) and system_server start early in
// boot, so their pids are small; an app's process is forked from zygote much later and has a large pid; a second package's process follows the app's. The numbers are the
// lab's own (every boot of a device gives other ones): only their relations are Android's (app > system_server > zygote > init, the app's parent is zygote).
export const INIT_PID = 1;
export const ZYGOTE_PID = 612;
export const SYSTEM_SERVER_PID = 900;
export const APP_PID = 14732;
export const ZYGOTE_EXECUTABLE = '/system/bin/app_process64';
