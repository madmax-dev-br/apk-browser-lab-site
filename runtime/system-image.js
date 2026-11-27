// The system programs of the virtual device's Android 13 production image (owner decision of 2026-11-21): /system/bin as AOSP android-13.0.0_r1 installs it, with the
// programs built from AOSP's own sources (scripts/build-system-programs.sh, vendor/system-programs): toybox (external/toybox), mksh as /system/bin/sh (external/mksh) and
// toolbox (system/core/toolbox: getprop, setprop, start, stop). As on a production device there is no su, no busybox, nothing in /system/xbin and no /bin.
// Also here: the mount table an app's mount namespace sees, the kernel's uname, and the file labels the programs report. Everything is fixed for every app.
import { identityProperties } from './device-identity.js?v=5afc26aa921f';
import { CA_CERTIFICATES } from './ca-certificates-data.js?v=5afc26aa921f';

/** The programs and what /system/bin holds for each: toybox's symlinks are Android.bp's `toybox_symlinks` (device variant), toolbox's its `symlinks`. */
export const TOYBOX_SYMLINKS = Object.freeze(['[', 'acpi', 'base64', 'basename', 'blockdev', 'cal', 'cat', 'chattr', 'chcon', 'chgrp', 'chmod', 'chown', 'chroot', 'chrt', 'cksum', 'clear', 'comm', 'cmp', 'cp', 'cpio', 'cut',
  'date', 'dd', 'devmem', 'df', 'diff', 'dirname', 'dmesg', 'dos2unix', 'du', 'echo', 'egrep', 'env', 'expand', 'expr', 'fallocate', 'false', 'fgrep', 'file', 'find', 'flock', 'fmt', 'free', 'fsync', 'getconf',
  'getenforce', 'grep', 'groups', 'gunzip', 'gzip', 'head', 'hostname', 'hwclock', 'i2cdetect', 'i2cdump', 'i2cget', 'i2cset', 'iconv', 'id', 'ifconfig', 'inotifyd', 'insmod', 'install', 'ionice', 'iorenice',
  'kill', 'killall', 'load_policy', 'ln', 'log', 'logname', 'losetup', 'ls', 'lsattr', 'lsmod', 'lsof', 'lspci', 'lsusb', 'md5sum', 'mkdir', 'mkfifo', 'mknod', 'mkswap', 'mktemp', 'microcom', 'modinfo', 'more',
  'mount', 'mountpoint', 'mv', 'nc', 'netcat', 'netstat', 'nice', 'nl', 'nohup', 'nproc', 'nsenter', 'od', 'paste', 'patch', 'pgrep', 'pidof', 'pkill', 'pmap', 'printenv', 'printf', 'ps', 'pwd', 'readelf',
  'readlink', 'realpath', 'renice', 'restorecon', 'rm', 'rmdir', 'rmmod', 'rtcwake', 'runcon', 'sed', 'sendevent', 'seq', 'setenforce', 'setsid', 'sha1sum', 'sha224sum', 'sha256sum', 'sha384sum', 'sha512sum',
  'sleep', 'sort', 'split', 'stat', 'strings', 'stty', 'swapoff', 'swapon', 'sync', 'sysctl', 'tac', 'tail', 'tar', 'taskset', 'tee', 'test', 'time', 'timeout', 'top', 'touch', 'tr', 'true', 'truncate', 'tty',
  'uclampset', 'ulimit', 'umount', 'uname', 'uniq', 'unix2dos', 'unlink', 'unshare', 'uptime', 'usleep', 'uudecode', 'uuencode', 'uuidgen', 'vmstat', 'watch', 'wc', 'which', 'whoami', 'xargs', 'xxd', 'yes', 'zcat']);
export const TOOLBOX_SYMLINKS = Object.freeze(['getprop', 'setprop', 'start', 'stop']);   // getevent and modprobe are not built (vendor/system-programs/provenance.json)
/** Program images: /system/bin/<file> -> the module that runs (the names of vendor/system-programs/*.wasm). */
export const PROGRAM_FILES = Object.freeze({ toybox: 'toybox', sh: 'mksh', toolbox: 'toolbox' });
/** The SELinux labels of these files (system/sepolicy private/file_contexts, android-13.0.0_r1). */
const FILE_LABELS = { '/system/bin/sh': 'u:object_r:shell_exec:s0', '/system/bin/toybox': 'u:object_r:toolbox_exec:s0', '/system/bin/toolbox': 'u:object_r:toolbox_exec:s0' };
/** The image's file timestamp: AOSP builds every file of the image with the fixed date 2009-01-01 00:00 UTC (build/make core/Makefile, SOURCE_DATE / the `-T 1230768000` of the image tools). */
export const IMAGE_TIME_MS = 1230768000000;
export const AID = Object.freeze({ ROOT: 0, SYSTEM: 1000, SHELL: 2000, READPROC: 3009 });
/** The directories of the image beyond the ones the virtual file system makes (src/virtual-fs.js): the partitions and APEXes PATH names. */
const IMAGE_DIRECTORIES = ['/system_ext', '/system_ext/bin', '/vendor', '/vendor/bin', '/product', '/product/bin', '/apex', '/apex/com.android.runtime', '/apex/com.android.runtime/bin',
  '/apex/com.android.art', '/apex/com.android.art/bin', '/apex/com.android.i18n', '/apex/com.android.tzdata', '/apex/com.android.conscrypt', '/mnt'];
/** Directories an untrusted_app may search but not list (DAC and system/sepolicy: system_data_root_file, system_data_file, apk_data_file, shell_data_file, fuse root): readdir is EACCES. */
export const SEARCH_ONLY = new Set(['/data', '/data/user', '/data/user/0', '/data/app', '/data/local', '/data/local/tmp', '/storage/emulated', '/mnt', '/apex']);

/**
 * Installs /system/bin and the image directories in `fs` (once): the program files (their bytes are the WebAssembly modules the lab runs, filled in by `programs`
 * when loaded) and the symbolic links. Program files are root:shell 0755, links root:root 0777, as fs_config gives them.
 */
export function installSystemImage(fs, programs = null) {
  if (fs.systemImage) { if (programs) fillPrograms(fs, programs); return fs.systemImage; }
  const dir = path => { if (!fs.nodes.has(path)) fs.put(path, { type: 'dir', mtime: IMAGE_TIME_MS, mode: 0o755, uid: 0, gid: 0, system: true }); };
  for (const path of IMAGE_DIRECTORIES) dir(path);
  for (const path of ['/system', '/system/bin', '/system/etc', '/system/lib64', '/system/fonts']) { const node = fs.nodes.get(path); if (node) Object.assign(node, { mode: 0o755, uid: 0, gid: 0 }); }
  const bin = fs.nodes.get('/system/bin'); if (bin) bin.gid = AID.SHELL;   // /system/bin is root:shell 0751 (libcutils fs_config.cpp "system/bin"): an app may search it, not list it
  if (bin) bin.mode = 0o751;
  for (const path of ['/system_ext/bin', '/vendor/bin', '/product/bin']) Object.assign(fs.nodes.get(path), { mode: 0o751, gid: AID.SHELL });   // fs_config: root:shell 0751
  for (const [file, program] of Object.entries(PROGRAM_FILES))
    fs.put(`/system/bin/${file}`, { type: 'file', buf: new Uint8Array(0), size: 0, mtime: IMAGE_TIME_MS, mode: 0o755, uid: AID.ROOT, gid: AID.SHELL, mounted: true, system: true, program, label: FILE_LABELS[`/system/bin/${file}`] });
  for (const name of TOYBOX_SYMLINKS) fs.put(`/system/bin/${name}`, { type: 'link', target: 'toybox', mtime: IMAGE_TIME_MS, mode: 0o777, uid: 0, gid: 0, system: true, size: 6 });
  for (const name of TOOLBOX_SYMLINKS) fs.put(`/system/bin/${name}`, { type: 'link', target: 'toolbox', mtime: IMAGE_TIME_MS, mode: 0o777, uid: 0, gid: 0, system: true, size: 7 });
  // /system/etc/mkshrc: external/mksh's mkshrc as the image installs it (copied with the programs, vendor/system-programs/mkshrc); read by an interactive shell only
  fs.put('/system/etc/mkshrc', { type: 'file', buf: new Uint8Array(0), size: 0, mtime: IMAGE_TIME_MS, mode: 0o644, uid: 0, gid: 0, mounted: true, system: true, imageFile: 'mkshrc' });
  // /system/etc/security/cacerts: the system CA certificates of AOSP android-13.0.0_r1 (system/ca-certificates files/, src/ca-certificates-data.js), root:root 0644 as the `cacerts`
  // module installs them. Conscrypt's TrustedCertificateStore reads them ($ANDROID_ROOT/etc/security/cacerts): the KeyStore "AndroidCAStore" and the default TrustManager's anchors.
  dir('/system/etc/security'); dir(CA_CERTS_DIR);
  for (const [name, bytes] of caCertificateFiles()) fs.put(`${CA_CERTS_DIR}/${name}`, { type: 'file', buf: bytes, size: bytes.length, mtime: IMAGE_TIME_MS, mode: 0o644, uid: 0, gid: 0, mounted: true, system: true });
  for (const path of ['/system_ext', '/vendor', '/product', '/apex']) fs.readOnly.add(path);
  fs.systemImage = { programs: null };
  if (programs) fillPrograms(fs, programs);
  return fs.systemImage;
}
export const CA_CERTS_DIR = '/system/etc/security/cacerts';
let caFiles = null;
/** The bytes of the system CA files, encoded once and shared by every file system (the partition is read-only). */
export function caCertificateFiles() {
  if (!caFiles) { const encoder = new TextEncoder(); caFiles = Object.entries(CA_CERTIFICATES).map(([name, { text }]) => [name, encoder.encode(text)]); }
  return caFiles;
}
function fillPrograms(fs, programs) {
  if (fs.systemImage.programs === programs) return;
  fs.systemImage.programs = programs;
  for (const [file, program] of Object.entries(PROGRAM_FILES)) { const node = fs.nodes.get(`/system/bin/${file}`), bytes = programs.bytes?.[program]; if (node && bytes) { node.buf = bytes; node.size = bytes.length; } }
  const rc = fs.nodes.get('/system/etc/mkshrc'), bytes = programs.bytes?.mkshrc; if (rc && bytes) { rc.buf = bytes; rc.size = bytes.length; }
}

/**
 * /proc/self/mounts as an app's mount namespace shows it on an Android 13 device with dynamic partitions (system-as-root), made from the lab's file system layout and AOSP's
 * conventions: first-stage init mounts /dev (tmpfs mode=0755), /dev/pts, /proc (hidepid=2,gid=3009 = AID_READPROC, shown "invisible" by 5.8+ kernels), /sys, selinuxfs and /mnt
 * (system/core init/first_stage_init.cpp); the logical partitions are dm-linear devices mounted read-only (fs_mgr, the fstab of a Cuttlefish-class device:
 * device/google/cuttlefish shared/config/fstab.ext4); apexd mounts each APEX on /apex (a tmpfs) from a loop device; /data is f2fs; MediaProvider's FUSE daemon serves
 * /storage/emulated, with Android/data and Android/obb bind-mounted from /data/media (Android 11+). The dm-/loop device numbers are the lab's (a device's differ per boot).
 */
export function mountTable() {
  const data = 'rw,lazytime,seclabel,nosuid,nodev,noatime,background_gc=on,discard,no_heap,user_xattr,inline_xattr,acl,inline_data,inline_dentry,flush_merge,extent_cache,mode=adaptive,active_logs=6,reserve_root=32768,resuid=0,resgid=1065,inlinecrypt,alloc_mode=default,checkpoint_merge,fsync_mode=nobarrier';
  const apex = 'ro,dirsync,seclabel,nodev,noatime';
  return [
    ['/dev/block/dm-4', '/', 'ext4', 'ro,seclabel,nodev,relatime'],
    ['tmpfs', '/dev', 'tmpfs', 'rw,seclabel,nosuid,relatime,mode=755'],
    ['devpts', '/dev/pts', 'devpts', 'rw,seclabel,relatime,mode=600,ptmxmode=000'],
    ['proc', '/proc', 'proc', 'rw,relatime,gid=3009,hidepid=invisible'],
    ['sysfs', '/sys', 'sysfs', 'rw,seclabel,relatime'],
    ['selinuxfs', '/sys/fs/selinux', 'selinuxfs', 'rw,relatime'],
    ['tmpfs', '/mnt', 'tmpfs', 'rw,seclabel,nosuid,nodev,noexec,relatime,mode=755,gid=1000'],
    ['/dev/block/dm-5', '/system_ext', 'ext4', 'ro,seclabel,relatime'],
    ['/dev/block/dm-6', '/vendor', 'ext4', 'ro,seclabel,relatime'],
    ['/dev/block/dm-7', '/product', 'ext4', 'ro,seclabel,relatime'],
    ['tmpfs', '/apex', 'tmpfs', 'rw,seclabel,nosuid,nodev,noexec,relatime,mode=755'],
    ['/dev/block/loop1', '/apex/com.android.runtime', 'ext4', apex],
    ['/dev/block/loop2', '/apex/com.android.art', 'ext4', apex],
    ['/dev/block/loop3', '/apex/com.android.i18n', 'ext4', apex],
    ['/dev/block/loop4', '/apex/com.android.tzdata', 'ext4', apex],
    ['/dev/block/loop5', '/apex/com.android.conscrypt', 'ext4', apex],
    ['/dev/block/dm-30', '/data', 'f2fs', data],
    ['/dev/block/dm-30', '/data/user/0', 'f2fs', data],
    ['/dev/fuse', '/storage/emulated', 'fuse', 'rw,lazytime,nosuid,nodev,noexec,noatime,user_id=0,group_id=0,allow_other'],
    ['/dev/block/dm-30', '/storage/emulated/0/Android/data', 'f2fs', data],
    ['/dev/block/dm-30', '/storage/emulated/0/Android/obb', 'f2fs', data],
  ];
}
export const mountsText = () => mountTable().map(([source, target, type, options]) => `${source} ${target} ${type} ${options} 0 0\n`).join('');
/** The mount a path is on (the longest mount point that prefixes it). */
export function mountOf(path) {
  let best = null;
  for (const entry of mountTable()) { const target = entry[1]; if ((path === target || path.startsWith(target === '/' ? '/' : target + '/')) && (!best || target.length > best[1].length)) best = entry; }
  return best;
}

/**
 * uname(2) of the device. sysname "Linux"; nodename "localhost" (Android never sets a hostname: the kernel default of a GKI build, CONFIG_DEFAULT_HOSTNAME); release the
 * GKI kernel branch an Android 13 device launches on (android13-5.15: version 5.15.41, KMI generation 8, the android13-5.15 KMI freeze of mid-2022), with no build suffix;
 * version the kernel's "#1 SMP PREEMPT <build date>" with the image's build date (ro.build.date); machine the CPU the device runs ("aarch64" with the "Run ARM64 native code"
 * option, else "wasm32", the ABI ro.product.cpu.abi names: no Linux architecture name exists for it).
 */
export function unameFields(source = null) {
  const props = identityProperties(source);
  return { sysname: 'Linux', nodename: 'localhost', release: '5.15.41-android13-8', version: `#1 SMP PREEMPT ${props.get('ro.build.date') ?? 'Thu Jan  1 00:00:00 UTC 1970'}`, machine: source?.arm64 ? 'aarch64' : 'wasm32', domainname: '(none)' };
}
/** /proc/version: the same kernel, built by the platform's clang (prebuilts/clang/host clang-r450784d, the toolchain of the android13 GKI branches). */
export function procVersionText(source = null) {
  const u = unameFields(source);
  return `${u.sysname} version ${u.release} (build-user@build-host) (Android (8508608, based on r450784e) clang version 14.0.7, LLD 14.0.7) ${u.version}\n`;
}

/** The SELinux context of the app's processes (system/sepolicy private/seapp_contexts, android-13.0.0_r1: domain by targetSdkVersion, levelFrom=all categories of the app id). */
export function appSecurityContext(uid, targetSdk) {
  const appId = uid % 100000, domain = targetSdk >= 32 ? 'untrusted_app' : targetSdk >= 30 ? 'untrusted_app_30' : targetSdk >= 29 ? 'untrusted_app_29' : targetSdk >= 26 ? 'untrusted_app_27' : 'untrusted_app_25';
  const user = Math.floor(uid / 100000), app = appId - 10000;
  return `u:r:${domain}:s0:c${app & 0xff},c${256 + ((app >> 8) & 0xff)},c${512 + (user & 0xff)},c${768 + ((user >> 8) & 0xff)}`;
}
