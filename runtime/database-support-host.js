import { createHostRegistry } from './host-contract.js?v=9b98a94b8ae7';
import { fieldOffset } from './unsafe-native.js?v=9b98a94b8ae7';

// Platform contract for the hidden/internal framework APIs that android.database and android.database.sqlite (Android 13 sources, compiled into the
// framework DEX) call: dalvik.system.CloseGuard, dalvik.system.BlockGuard, android.os.FileUtils.setPermissions, android.os.StrictMode SQLite leak
// reporting, and the few android.os/app/provider lookups the SQLite classes perform. Each follows the libcore/framework behaviour for a process
// with no StrictMode policy, no ActivityManager service and no Settings provider (see the per-definition notes).
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', THROWABLE = 'Ljava/lang/Throwable;';
const CLOSE_GUARD = 'Ldalvik/system/CloseGuard;', FILE_UTILS = 'Landroid/os/FileUtils;';

export function createDatabaseSupportHost(platform) {
  const registry = createHostRegistry(), { def, type, staticField } = registry;
  const fs = () => platform.javaIo.fs();

  // ---- CloseGuard (libcore): get() always returns a guard; warnIfOpen() reports a resource that was open()ed and never close()d.
  type(CLOSE_GUARD, OBJECT, [], { allocatable: true });
  def(CLOSE_GUARD, 'get', `()${CLOSE_GUARD}`, r => { const guard = r.allocate(CLOSE_GUARD); r.object(guard).closeGuard = { opened: null }; return guard; }, { static: true });
  def(CLOSE_GUARD, 'open', `(${STRING})V`, (r, _m, [self, warning]) => {
    if (warning === null || warning === 0) r.throwJava('Ljava/lang/NullPointerException;', 'closer == null');
    r.object(self).closeGuard.opened = r.stringCharacters(warning);
  });
  def(CLOSE_GUARD, 'close', '()V', (r, _m, [self]) => { r.object(self).closeGuard.opened = null; });
  def(CLOSE_GUARD, 'warnIfOpen', '()V', (r, _m, [self]) => {
    const state = r.object(self).closeGuard;
    if (state.opened !== null) { r.record(`LOG W StrictMode: A resource was acquired at attached stack trace but never released. See java.io.Closeable for information on avoiding resource leaks. (${state.opened})`); state.opened = null; }
  });

  // dalvik.system.BlockGuard is the original libcore class in framework.dex (LAX_POLICY by default; StrictMode installs its own policy).

  // ---- android.os.FileUtils.setPermissions(path, mode, uid, gid): chmod over the virtual filesystem, returns an errno (0 = success).
  type(FILE_UTILS, OBJECT);
  def(FILE_UTILS, 'setPermissions', `(${STRING}III)I`, (r, _m, [path, mode]) => {
    const files = fs(), node = files.node(r.stringCharacters(path)); if (!node) return 2; // ENOENT
    if (files.isReadOnly(path)) return 1; // EPERM
    node.mode = mode & 0o7777; return 0;
  }, { static: true });

  // ---- android.app.ActivityManager.isLowRamDeviceStatic(): SystemProperties.getBoolean("ro.config.low_ram", false) on a device that does not set it.
  def('Landroid/app/ActivityManager;', 'isLowRamDeviceStatic', '()Z', () => 0, { static: true });

  // ---- android.os.StatFs: only the block size (statvfs f_frsize of the f2fs/ext4 /data partition: 4096) is modelled; capacity queries are not provided.
  const STATFS = 'Landroid/os/StatFs;';
  type(STATFS, OBJECT, [], { allocatable: true });
  def(STATFS, '<init>', `(${STRING})V`, (r, _m, [self, path]) => {
    const name = r.stringCharacters(path);
    if (!fs().stat(name)) r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid path: ${name}`);
    r.object(self).statFsPath = name;
  });
  def(STATFS, 'getBlockSize', '()I', () => 4096);
  def(STATFS, 'getBlockSizeLong', '()J', () => 4096n);

  // ---- java.util.Locale.Category / getDefault(Category) / extension accessors, for the original java.time sources (the Locale object itself is the platform's)
  const CATEGORY = 'Ljava/util/Locale$Category;', LOCALE = 'Ljava/util/Locale;';
  type(CATEGORY, 'Ljava/lang/Enum;', [], { allocatable: true });
  ['DISPLAY', 'FORMAT'].forEach((name, ordinal) => staticField(CATEGORY, name, CATEGORY, r => { const value = r.allocate(CATEGORY), o = r.object(value); o.enumName = name; o.enumOrdinal = ordinal; return value; }));
  def(LOCALE, 'getDefault', `(${CATEGORY})${LOCALE}`, (r, _m, [category]) => { r.object(category); return platform.locale(r, platform.device.locale); }, { static: true }); // one default for every category, as Locale.getDefault()
  def(LOCALE, 'hasExtensions', '()Z', () => 0);
  def(LOCALE, 'getUnicodeLocaleType', `(${STRING})${STRING}`, (r, _m, [, key]) => { r.stringCharacters(key); return null; });

  // ---- Resources.getSystem(): framework resources (the lab's framework table serves android.R / com.android.internal.R ids through the same Resources object)
  def('Landroid/content/res/Resources;', 'getSystem', '()Landroid/content/res/Resources;', r => platform.resourcesForContext(r, null), { static: true });

  // ---- sun.reflect.Reflection.getCallerClass() and Field.getOffset() for the original Unsafe/Bits/Buffer classes.
  // getCallerClass: the class of the method that called the caller-sensitive method (stack = [..., caller, caller-sensitive method]).
  def('Lsun/reflect/Reflection;', 'getCallerClass', '()Ljava/lang/Class;', r => { const caller = r.methodStack.at(-2); return caller ? r.classObject(caller.owner) : null; }, { static: true });
  def('Ljava/lang/reflect/Field;', 'getOffset', '()I', (r, _m, [self]) => fieldOffset(r, r.object(self).member.field.key));

  // ---- android.app.ActivityThread: the process's single thread object exists before Application creation; getApplication() is mInitialApplication
  // (assigned after Application.attach(), so null until then).
  const THREAD = 'Landroid/app/ActivityThread;', APPLICATION = 'Landroid/app/Application;';
  type(THREAD, OBJECT, [], { allocatable: true });
  def(THREAD, 'currentActivityThread', `()${THREAD}`, r => r.activityThread ??= r.allocate(THREAD), { static: true });
  def(THREAD, 'getApplication', `()${APPLICATION}`, () => platform.applicationAttached ? platform.application : null);

  return registry;
}
