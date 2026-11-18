// An interpreter of adb command lines for the lab's virtual device, DOM-free: `adb install app.apk`, `adb shell am start -n pkg/.Main`, `adb shell input tap 200 400`,
// `adb logcat -d *:E`, `adb exec-out screencap -p > screen.png` ... do on the page what they do on an emulator, through the page's own paths (the `device` facade of src/app.js:
// install as a dropped file, the launcher, Intents resolved by the manifest, real touches, the keyboard path, the Controls settings). It is not adb: there is no adbd, no
// shell and no file system behind it. What the page has no path for (broadcasts, services, hardware keys outside a text field, the app's private files, port forwarding ...) fails
// by name, with exit status 127, and is never run as something else. Where the lab does a command differently from a device, the result carries a note saying how.
//
// createAdb(device).run({ command | args }, io) -> { stdout, stderr, code, images: [{ blob, type }], notes: [] }
//   io.localFile(path) -> File of the machine that runs the bridge (adb install / push); io.writeLocal(path, blob, { append }) writes one there (adb pull, `> file`).
// The command-line syntax (quotes, | grep, &&, >) is src/adb-shell.js. No process.*.
import { AdbError, unsupported, usage, parseLine, runList, FILTERS } from './adb-shell.js?v=43801fccd526';
import { formatThreadtime } from './logcat.js?v=43801fccd526';
import { kindOf, directoryOf } from './shared-storage.js?v=43801fccd526';

export const SERIAL = 'apkweb-lab';
const SHARED_ROOT = '/storage/emulated/0', SHARED_ALIASES = ['/sdcard', '/mnt/sdcard', '/storage/self/primary'];
const MIME_BY_EXTENSION = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', heic: 'image/heic', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', '3gp': 'video/3gpp', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', pdf: 'application/pdf', txt: 'text/plain', json: 'application/json', xml: 'text/xml', csv: 'text/csv', html: 'text/html', zip: 'application/zip' };
const ok = (stdout = '', extra = {}) => ({ stdout, code: 0, ...extra });
const basename = path => String(path).replace(/\/+$/, '').split('/').pop() ?? '';
const extension = name => { const dot = String(name).lastIndexOf('.'); return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''; };
/** A device path with the shared-storage aliases resolved and `.`/`..`/double slashes removed. */
export function devicePath(path) {
  let text = String(path ?? ''); if (!text.startsWith('/')) text = `/${text}`;
  const parts = []; for (const part of text.split('/')) { if (!part || part === '.') continue; if (part === '..') parts.pop(); else parts.push(part); }
  let clean = `/${parts.join('/')}`;
  for (const alias of SHARED_ALIASES) if (clean === alias || clean.startsWith(`${alias}/`)) { clean = SHARED_ROOT + clean.slice(alias.length); break; }
  return clean;
}
const shortPath = path => path === SHARED_ROOT || path.startsWith(`${SHARED_ROOT}/`) ? `/sdcard${path.slice(SHARED_ROOT.length)}` : path;

/** Options of an Android tool: `spec` maps each option to how many values it takes (0, 1 or 2); a `--name=value` form gives the value of a 1-value option. -> { options: [[name, ...values]], rest } */
function readOptions(argv, spec, tool) {
  const options = [], rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-') || arg === '-' || /^-\d/.test(arg)) { rest.push(arg); continue; }
    const [name, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    if (!Object.hasOwn(spec, name)) throw unsupported(`${tool} ${name}`);
    const count = spec[name], values = inline !== undefined ? [inline] : argv.slice(i + 1, i + 1 + count);
    if (values.length < count) throw usage(`${tool}: ${name} needs ${count} value(s)`);
    if (inline === undefined) i += count;
    options.push([name, ...values]);
  }
  return { options, rest, has: name => options.some(option => option[0] === name), get: name => options.findLast(option => option[0] === name)?.[1] };
}
const integer = (text, what) => { if (!/^-?\d+$/.test(String(text))) throw usage(`${what}: "${text}" is not an integer`); return Number(text); };
const number = (text, what) => { const value = Number(text); if (String(text).trim() === '' || !Number.isFinite(value)) throw usage(`${what}: "${text}" is not a number`); return value; };
/** An opaque 7-digit hex token for the `ActivityRecord{…}` / `Window{…}` / `Package […] (…)` lines (a device prints an identity hash there). */
const token = text => { let hash = 2166136261; for (const ch of String(text)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619); return ((hash >>> 0) & 0xfffffff).toString(16).padStart(7, '0'); };
const shortComponent = (pkg, cls) => `${pkg}/${cls && cls.startsWith(`${pkg}.`) ? cls.slice(pkg.length) : cls}`;

// ---- logcat ------------------------------------------------------------------------------------------------------------------------------------------------------------
const PRIORITIES = 'VDIWEFS', priorityOf = level => level === 'A' ? 5 : Math.max(0, PRIORITIES.indexOf(level));
const two = value => String(value).padStart(2, '0'), stamp = wall => { const d = new Date(wall); return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`; };
const LOG_FORMATS = {
  threadtime: entry => formatThreadtime(entry), brief: entry => `${entry.level}/${entry.tag}(${String(entry.pid).padStart(5)}): ${entry.message}`, tag: entry => `${entry.level}/${entry.tag}: ${entry.message}`,
  process: entry => `${entry.level}(${String(entry.pid).padStart(5)}) ${entry.message}  (${entry.tag})`, thread: entry => `${entry.level}(${String(entry.pid).padStart(5)}:${String(entry.tid).padStart(5)}) ${entry.message}`,
  raw: entry => entry.message, time: entry => `${stamp(entry.wall)} ${entry.level}/${entry.tag}(${String(entry.pid).padStart(5)}): ${entry.message}`,
  long: entry => `[ ${stamp(entry.wall)} ${String(entry.pid).padStart(5)}:${String(entry.tid).padStart(5)} ${entry.level}/${entry.tag} ]\n${entry.message}\n`,
};
/** `logcat` arguments -> { clear, dump, tail, format, accept(entry), follow }. */
export function parseLogcat(argv) {
  const { options, rest, has, get } = readOptions(argv, { '-d': 0, '-c': 0, '--clear': 0, '-t': 1, '-T': 1, '-s': 0, '-v': 1, '--format': 1, '-b': 1, '--buffer': 1, '-e': 1, '--regex': 1, '-m': 1, '--max-count': 1, '--pid': 1 }, 'logcat');
  let format = 'threadtime';
  for (const [name, value] of options) {
    if (name === '-v' || name === '--format') for (const part of String(value).split(',')) { if (Object.hasOwn(LOG_FORMATS, part)) format = part; else throw unsupported(`logcat -v ${part}`, `formats: ${Object.keys(LOG_FORMATS).join(', ')}`); }
    if ((name === '-b' || name === '--buffer') && !String(value).split(',').every(buffer => ['main', 'default', 'all'].includes(buffer))) throw unsupported(`logcat -b ${value}`, 'the lab has a single buffer, main');
  }
  const tailText = get('-t') ?? get('-T'); if (tailText !== undefined && !/^\d+$/.test(tailText)) throw unsupported(`logcat -t '${tailText}'`, 'only -t <number of lines>');
  const pid = get('--pid') === undefined ? null : integer(get('--pid'), 'logcat --pid'), max = get('-m') ?? get('--max-count');
  let regex = null; const pattern = get('-e') ?? get('--regex'); if (pattern !== undefined) { try { regex = new RegExp(pattern); } catch (error) { throw usage(`logcat -e: ${error.message}`); } }
  // filterspecs: TAG[:PRIORITY]; `*` sets the priority of every tag not named; -s is `*:S` (and a tag without a priority there is TAG:V)
  const byTag = new Map(); let fallback = has('-s') ? 6 : 0;
  for (const spec of rest) {
    const at = spec.lastIndexOf(':'), tag = at > 0 ? spec.slice(0, at) : spec, letter = at > 0 ? spec.slice(at + 1).toUpperCase()[0] : 'V', priority = PRIORITIES.indexOf(letter);
    if (priority < 0) throw usage(`logcat: invalid priority in "${spec}" (V D I W E F S)`);
    if (tag === '*') fallback = priority; else byTag.set(tag, priority);
  }
  return { clear: has('-c') || has('--clear'), dump: has('-d') || tailText !== undefined, tail: tailText === undefined ? null : Number(tailText), max: max === undefined ? null : integer(max, 'logcat -m'), format,
    accept: entry => priorityOf(entry.level) >= (byTag.has(entry.tag) ? byTag.get(entry.tag) : fallback) && (pid === null || entry.pid === pid) && (!regex || regex.test(entry.message)) };
}

// ---- uiautomator dump --------------------------------------------------------------------------------------------------------------------------------------------------
const xmlAttribute = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
const javaName = descriptor => /^L.*;$/.test(String(descriptor ?? '')) ? descriptor.slice(1, -1).replace(/\//g, '.') : String(descriptor ?? '');
/**
 * The window hierarchy as `uiautomator dump` writes it, from a page snapshot: the Views (class, text, resource id, content description, bounds, clickable, checked, focused)
 * and, under each Compose owner, its semantics nodes as android.view.View nodes (what Compose's accessibility delegate gives UiAutomator). `resourceNames`: Map of android:id
 * number -> "pkg:id/name". Attributes the page does not know (checkable and password for Views, focusable, long-clickable for Views) are left out, never written as false.
 */
export function uiHierarchyXml(snapshot, { packageName = '', resourceNames = new Map(), rotation = 0 } = {}) {
  const out = [`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>`, `<!-- APK Web Lab: built from the page's view tree and Compose semantics; attributes the page does not know are left out -->`, `<hierarchy rotation="${rotation}">`];
  const rect = b => `[${Math.round(b.left)},${Math.round(b.top)}][${Math.round(b.right)},${Math.round(b.bottom)}]`;
  const open = (index, fields, hasChildren) => out.push(`<node index="${index}"${Object.entries(fields).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => ` ${key}="${xmlAttribute(value)}"`).join('')}${hasChildren ? '>' : ' />'}`);
  const composeNode = (node, byParent, origin, index) => {
    const b = node.boundsInRoot, actions = (node.actions ?? []).map(action => action.name ?? action), kids = (byParent.get(node.nodeId) ?? []).filter(child => !child.invisibleToUser && child.placed !== false);
    open(index, { text: node.editableText ?? (node.texts ?? []).join(', '), 'resource-id': node.testTag ?? '', class: 'android.view.View', package: packageName, 'content-desc': (node.contentDescriptions ?? []).join(', '),
      checkable: node.toggleState != null, checked: node.toggleState === 'On', clickable: actions.includes('OnClick'), enabled: !node.disabled, focused: node.focused === true, scrollable: actions.includes('ScrollBy'), 'long-clickable': actions.includes('OnLongClick'),
      selected: node.selected === true, bounds: rect({ left: origin.x + b.left, top: origin.y + b.top, right: origin.x + b.right, bottom: origin.y + b.bottom }) }, kids.length > 0);
    if (kids.length) { kids.forEach((child, at) => composeNode(child, byParent, origin, at)); out.push('</node>'); }
  };
  const view = (item, offset, index) => {
    if (!item || typeof item !== 'object' || item.visibility === 4 || item.visibility === 8) return false;
    const b = item.laidOut && item.bounds ? item.bounds : null, own = b ? { x: offset.x + b.left, y: offset.y + b.top } : offset;
    const owner = /AndroidComposeView;$/.test(String(item.type ?? '')) ? (snapshot?.composeSemantics?.owners ?? []).find(candidate => candidate.ownerViewId === item.id && candidate.attached !== false) : null;
    const nodes = owner?.nodes ?? [], ids = new Set(nodes.map(node => node.nodeId)), byParent = new Map();
    for (const node of nodes) { const parent = ids.has(node.parentId) ? node.parentId : null; if (!byParent.has(parent)) byParent.set(parent, []); byParent.get(parent).push(node); }
    const roots = (byParent.get(null) ?? []).filter(node => !node.invisibleToUser && node.placed !== false), children = (item.children ?? []).filter(child => child && child.visibility !== 4 && child.visibility !== 8);
    open(index, { text: typeof item.text === 'string' ? item.text : '', 'resource-id': resourceNames.get(item.androidId) ?? '', class: javaName(item.type), package: packageName, 'content-desc': item.contentDescription ?? '',
      checked: typeof item.checked === 'boolean' ? item.checked : undefined, clickable: !!(item.hasClickListener ?? item.clickable), enabled: item.enabled === undefined ? undefined : item.enabled !== false, focused: !!item.focused,
      bounds: b ? rect({ left: own.x, top: own.y, right: own.x + b.right - b.left, bottom: own.y + b.bottom - b.top }) : '[0,0][0,0]' }, roots.length + children.length > 0);
    if (roots.length + children.length) { let at = 0; for (const node of roots) composeNode(node, byParent, own, at++); for (const child of children) if (view(child, own, at)) at++; out.push('</node>'); }
    return true;
  };
  let index = 0; for (const root of snapshot?.views ?? []) { if (root?.windowSurface?.visible === false) continue; if (view(root, { x: root.windowSurface?.x ?? 0, y: root.windowSurface?.y ?? 0 }, index)) index++; }
  out.push('</hierarchy>'); return out.join('');
}

// ---- intents (am start) ------------------------------------------------------------------------------------------------------------------------------------------------
const NEW_TASK = 0x10000000;
const AM_START_OPTIONS = { '-W': 0, '-S': 0, '-N': 0, '--user': 1, '--display': 1, '-a': 1, '-d': 1, '-t': 1, '-c': 1, '-n': 1, '-p': 1, '-f': 1, '-e': 2, '--es': 2, '--ez': 2, '--ei': 2, '--activity-brought-to-front': 0 };
/** The Intent of an `am start` command line -> { intent: { action, data, type, category, extras, component }, packageName, wait, stopFirst }. */
export function parseIntentArgs(argv, tool = 'am start') {
  const { options, rest, has } = readOptions(argv, AM_START_OPTIONS, tool);
  const intent = { category: [], extras: {} }; let packageName = null;
  for (const [name, a, b] of options) {
    if (name === '-a') intent.action = a; else if (name === '-d') intent.data = a; else if (name === '-t') intent.type = a; else if (name === '-c') intent.category.push(a); else if (name === '-n') intent.component = a; else if (name === '-p') packageName = a;
    else if (name === '-e' || name === '--es') intent.extras[a] = b;
    else if (name === '--ez') { if (!/^(true|false|t|f|yes|no|y|n|on|off|1|0)$/i.test(b)) throw usage(`${tool}: --ez ${a} needs true or false`); intent.extras[a] = /^(true|t|yes|y|on|1)$/i.test(b); }
    else if (name === '--ei') { const value = integer(b, `${tool} --ei ${a}`); if (value < -2147483648 || value > 2147483647) throw usage(`${tool}: --ei ${a} is outside the range of an int`); intent.extras[a] = value; }
    else if (name === '-f') { const flags = Number(a); if (flags !== NEW_TASK) throw unsupported(`${tool} -f ${a}`, 'the page does not pass Intent flags; only 0x10000000 (NEW_TASK, which am already sets) is accepted'); }
    else if (name === '--user' && !['0', 'current', 'cur'].includes(a)) throw unsupported(`${tool} --user ${a}`, 'the device has one user, 0');
    else if (name === '--display' && a !== '0') throw unsupported(`${tool} --display ${a}`);
    else if (name === '-N') throw unsupported(`${tool} -N`);
  }
  if (rest.length > 1) throw usage(`${tool}: extra arguments: ${rest.slice(1).join(' ')}`);
  if (rest.length) { const last = rest[0]; if (last.includes(':')) intent.data = last; else if (last.includes('/')) intent.component = last; else packageName = last; }   // Intent.parseCommandArgs: a URI, a component, or a package
  if (intent.component && intent.component.includes('/')) packageName ??= intent.component.split('/')[0];
  return { intent, packageName, wait: has('-W'), stopFirst: has('-S') };
}

// ---- help ---------------------------------------------------------------------------------------------------------------------------------------------------------------
export const ADB_HELP = `adb commands interpreted by APK Web Lab (the device is the open page; serial ${SERIAL}):
  adb devices [-l] | get-state | get-serialno | wait-for-device | version
  adb install [-r -t -d -g] <file.apk>             installs on the home screen (-g grants the runtime permissions); one app at a time
  adb uninstall [-k] <package>                     removes it from the home screen and deletes its data (-k keeps the data)
  adb push <local> <remote>                        to shared storage (/sdcard/Pictures|Movies|Music|Download, the folder for the file's type)
  adb pull <remote> [local]                        files sent with push and those screencap / uiautomator dump wrote
  adb logcat [-d] [-c] [-t N] [-s] [-v format] [--pid N] [-e regex] [-m N] [TAG:P ... *:S]
  adb exec-out <command>                           like shell; screencap -p returns the image
  adb shell <command>, with | grep/head/tail/wc/sort/uniq, && || ; and > file:
    am start [-W -S -n pkg/.Activity -a action -d uri -t type -c category -e|--es key value --ez key bool --ei key int -p package]
    am force-stop <package> | am kill <package> | am get-current-user
    monkey -p <package> [-c android.intent.category.LAUNCHER] 1      opens the app
    pm list packages [-3 -s] [filter] | pm clear <package> | pm grant|revoke <package> <permission> | pm uninstall [-k] <package>
    input tap x y | input swipe x1 y1 x2 y2 [ms] | input text <text> | input keyevent <code or name> ...
    screencap -p [file] | uiautomator dump [file | /dev/tty]
    dumpsys activity [activities|top] | dumpsys window [windows|displays] | dumpsys package <package> | dumpsys battery [set level N | set status N | set ac|usb|wireless 0|1 | unplug | reset]
    getprop [key] | setprop persist.sys.locale|persist.sys.timezone <value>
    settings get|put global animator_duration_scale|transition_animation_scale|window_animation_scale, system font_scale|time_12_24|user_rotation|accelerometer_rotation, secure ui_night_mode
    wm size [WxH|reset] | wm density | svc wifi|data enable|disable | cmd uimode night [yes|no] | cmd connectivity airplane-mode [enable|disable] | cmd package … | cmd activity … | cmd battery …
    ls [-l] [path] | cat <file> | rm [-f] <file> (in /sdcard) | echo | sleep
Not implemented (fails with the command's name, status 127): am broadcast / startservice / instrument, keys that are not text or cursor keys in a focused field (except BACK, HOME, APP_SWITCH), run-as and the
app's private files (use the app_data tool), pm path, getprop ro.product.* / ro.build.* (android.os.Build stays in the VM), forward / reverse (use host_redirects), reboot, root,
screenrecord, install-multiple, interactive shell.
1 px = 1 dp in the lab (160 dpi): the coordinates of input and uiautomator are the window's.`;

const SETTINGS_KEYS = 'global animator_duration_scale | transition_animation_scale | window_animation_scale; system font_scale | time_12_24 | user_rotation | accelerometer_rotation; secure ui_night_mode';
const SCALE_KEYS = ['animator_duration_scale', 'transition_animation_scale', 'window_animation_scale'];
const BUILD_PROPS = [['ro.product.model', 'MODEL'], ['ro.product.manufacturer', 'MANUFACTURER'], ['ro.product.brand', 'BRAND'], ['ro.product.device', 'DEVICE'], ['ro.product.name', 'PRODUCT'], ['ro.hardware', 'HARDWARE'], ['ro.build.fingerprint', 'FINGERPRINT'],
  ['ro.build.id', 'ID'], ['ro.build.display.id', 'DISPLAY'], ['ro.build.type', 'TYPE'], ['ro.build.tags', 'TAGS'], ['ro.build.version.release', 'VERSION.RELEASE'], ['ro.build.version.sdk', 'VERSION.SDK_INT'], ['ro.build.version.codename', 'VERSION.CODENAME'], ['ro.build.version.incremental', 'VERSION.INCREMENTAL']];

/**
 * The interpreter over a device facade (src/app.js adbDevice; tests pass a fake). Every method of the facade does what the page's own control does:
 *   info() -> { packageName, running, loaded, activity, tasks: [{ id, activityStack }], dialogs, background, widthPx, heightPx, densityDpi, inventory: { packageName, versionName, versionCode, minSdk, targetSdk, requestedPermissions } | null }
 *   packages() -> [{ packageName, system }]; install(file, { grant }); uninstall(packageName, { keepData }) -> boolean; clearData(packageName); ensureLoaded(packageName) -> note | null
 *   openApp(packageName | null) -> { opened, error }; closeApp(); startIntent(intent, { packageName }) -> deepLink + { notes } (an implicit Intent: the installed app that answers it); waitReady(ms) -> { ready, activity }
 *   permissions() -> [{ name, state, granted }]; setPermission(name, state)
 *   tap(x, y) -> via; swipe(x1, y1, x2, y2, ms) -> via; text(text) -> via; key(code) -> via; keyCode(name) -> number | null; nav('back' | 'home' | 'recents')
 *   screenshot() -> { blob }; snapshot() -> page snapshot; resourceNames(ids) -> Map; logcat() -> entries; clearLogcat()
 *   settings() -> device settings; setSettings(patch); defaultScreen() -> the screen setting to go back to; buildProps() -> { MODEL, 'VERSION.SDK_INT', ... } | null
 *   sharedFiles() -> [{ id, name, mime, size, modified }]; pushShared(file) -> { name }; removeShared(id); sharedBlob(id) -> Blob
 */
export function createAdb(device, { sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now() } = {}) {
  const scratch = new Map();   // files adb tools wrote at a path the shared storage cannot hold (screencap, uiautomator dump): path -> { blob, modified }; only adb reads them back
  let batteryBefore = null, screenBefore = null, radios = null;
  const current = async () => device.info();
  const requirePackage = async (packageName, what) => { const known = await device.packages(); if (!known.some(item => item.packageName === packageName)) throw new AdbError(`${what}: package ${packageName} is not installed. Installed: ${known.map(item => item.packageName).join(', ') || 'none'}`); };
  /** Loads the package's APK when another one (or none) is in the VM: one app at a time. */
  const load = async (packageName, notes) => { const info = await current(); if (info.packageName === packageName && info.loaded) return; const note = await device.ensureLoaded(packageName); if (note) notes.push(note); };

  // ---- shared storage and the adb scratch files ----
  const sharedPathOf = file => `${SHARED_ROOT}/${directoryOf(kindOf(file.mime))}/${file.name}`;
  const listFiles = async () => [...(await device.sharedFiles()).map(file => ({ path: sharedPathOf(file), size: file.size, modified: file.modified, shared: file })), ...[...scratch].map(([path, entry]) => ({ path, size: entry.blob.size, modified: entry.modified, scratch: true }))];
  const findFile = async path => (await listFiles()).find(file => file.path === path) ?? null;
  const readFile = async (path, what) => { const file = await findFile(path); if (!file) throw new AdbError(`${what}: ${shortPath(path)}: No such file or directory (the lab only reads back what adb push, screencap and uiautomator dump wrote; files created by the app do not reach the page)`); return file.scratch ? scratch.get(path).blob : device.sharedBlob(file.shared.id); };
  /** Writes a tool's output file: into the shared storage when the path is where the lab keeps that kind of file (apps see it), else as an adb-only scratch file (said in a note). */
  async function writeToolFile(path, blob, mime, notes) {
    const dir = `${SHARED_ROOT}/${directoryOf(kindOf(mime))}`, name = basename(path);
    if (path === `${dir}/${name}`) { const old = await findFile(path); if (old?.shared) await device.removeShared(old.shared.id); await device.pushShared(new File([blob], name, { type: mime })); return; }
    if (!(path.startsWith(`${SHARED_ROOT}/`) || path.startsWith('/data/local/tmp/'))) throw new AdbError(`${shortPath(path)}: Permission denied (write to /sdcard/… or /data/local/tmp/…)`);
    scratch.set(path, { blob, modified: now() });
    notes.push(`${shortPath(path)} was kept for adb only (pull, cat, rm): the lab's shared storage keeps this kind of file in ${shortPath(dir)}/, so apps do not see this path.`);
  }

  // ---- adb shell commands: name -> async (argv, env) -> { stdout, code, binary? } ----
  const SHELL = {
    async echo(argv) { const bare = argv[0] === '-n'; return ok((bare ? argv.slice(1) : argv).join(' ') + (bare ? '' : '\n')); },
    async true() { return ok(); }, async ':'() { return ok(); }, async false() { return { stdout: '', code: 1 }; },
    async sleep(argv) { const seconds = number(argv[0] ?? '', 'sleep'); if (seconds < 0 || seconds > 60) throw unsupported(`sleep ${argv[0]}`, 'up to 60 s per command'); await sleep(seconds * 1000); return ok(); },

    async am(argv, env) {
      const [sub, ...rest] = argv;
      if (sub === 'start' || sub === 'start-activity') {
        const { intent, packageName, wait, stopFirst } = parseIntentArgs(rest), started = now();
        if (packageName) { await requirePackage(packageName, 'am start').catch(() => { throw new AdbError(`Error: Activity class {${intent.component ?? packageName}} does not exist. (package ${packageName} is not installed)`); }); await load(packageName, env.notes); }
        const before = await current();
        if (stopFirst && before.running) await device.closeApp();
        const bare = !intent.component && !intent.data && !intent.type && Object.keys(intent.extras).length === 0;
        const launcherOnly = bare && intent.action === 'android.intent.action.MAIN' && intent.category.length === 1 && intent.category[0] === 'android.intent.category.LAUNCHER';
        if (bare && !intent.action) { if (!packageName) throw usage('am start: say what to start (-n package/.Activity, -a action, -d uri)'); throw new AdbError(`Starting: Intent { pkg=${packageName} }\nError: Activity not started, unable to resolve Intent { pkg=${packageName} } (a package alone does not say which Activity; to open the app: am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p ${packageName}, or monkey -p ${packageName} 1)`); }
        let text, activity, cold;
        if (launcherOnly) {   // the launcher Intent of the package: what the tap on its icon sends
          if (!before.loaded) throw new AdbError('Error: Activity not started: no app loaded on the device. Install with adb install or give the package (-p package).');
          cold = !before.running; const opened = await device.openApp(null);
          text = `Starting: Intent { act=android.intent.action.MAIN cat=[android.intent.category.LAUNCHER] pkg=${before.packageName} }\n`;
          if (!opened.opened) throw new AdbError(`${text}Error: Activity not started: ${opened.error ?? 'the app did not open'}`);
          activity = (await current()).activity;
        } else {
          // an implicit Intent (a deep link) goes to the installed app whose filters answer it: the device loads that app when it is not the one in the VM
          const outcome = await device.startIntent({ ...intent, category: intent.category.length ? intent.category : undefined, extras: Object.keys(intent.extras).length ? intent.extras : undefined }, { packageName });
          for (const note of outcome?.notes ?? []) env.notes.push(note);
          text = `Starting: ${outcome?.intent ?? 'Intent'}\n`;
          if (!outcome?.ok) { if (outcome?.error) env.notes.push(outcome.error); throw new AdbError(`${text}Error: Activity not started, unable to resolve ${outcome?.intent ?? 'Intent'}`); }
          if (outcome.alternatives?.length) env.notes.push(`More than one Activity answers this Intent; the lab opened ${outcome.activity} (on a device the system would show the chooser). Others: ${outcome.alternatives.map(item => item.activity).join(', ')}.`);
          activity = outcome.activity; cold = !!outcome.launched;
        }
        if (wait) { const ready = await device.waitReady(15000), info = await current(), elapsed = now() - started; text += `Status: ok\nLaunchState: ${cold ? 'COLD' : 'HOT'}\nActivity: ${shortComponent(info.packageName, ready.activity ?? activity ?? info.activity)}\nTotalTime: ${elapsed}\nWaitTime: ${elapsed}\nComplete\n`; }
        return ok(text);
      }
      if (sub === 'force-stop' || sub === 'kill' || sub === 'stop-app') {
        const { rest: names } = readOptions(rest, { '--user': 1 }, `am ${sub}`); if (names.length !== 1) throw usage(`am ${sub} <package>`);
        const info = await current(); if (info.packageName === names[0] && (info.running || info.starting)) await device.closeApp();
        return ok();
      }
      if (sub === 'get-current-user') return ok('0\n');
      if (['broadcast', 'startservice', 'start-service', 'start-foreground-service', 'startforegroundservice', 'stopservice', 'stop-service'].includes(sub)) throw unsupported(`am ${sub}`, 'the page only delivers Intents to Activities; there is no path from outside the VM for a broadcast or a service');
      throw unsupported(`am ${sub ?? ''}`.trim());
    },

    async monkey(argv, env) {
      const { options, rest, get } = readOptions(argv, { '-p': 1, '-c': 1, '-v': 0, '-s': 1, '--throttle': 1, '--pct-syskeys': 1, '--pct-touch': 1, '--ignore-crashes': 0, '--ignore-timeouts': 0 }, 'monkey');
      const packageName = get('-p'), categories = options.filter(option => option[0] === '-c').map(option => option[1]);
      if (!packageName || rest.length !== 1 || rest[0] !== '1' || categories.some(category => category !== 'android.intent.category.LAUNCHER')) throw unsupported(`monkey ${argv.join(' ')}`, 'only the form that opens an app: monkey -p <package> [-c android.intent.category.LAUNCHER] 1');
      await requirePackage(packageName, 'monkey'); await load(packageName, env.notes);
      const opened = await device.openApp(null); if (!opened.opened) throw new AdbError(`** No activities found to run, monkey aborted. (${opened.error ?? 'the app did not open'})`);
      return ok('  bash arg: -p\n  bash arg: ' + packageName + '\nEvents injected: 1\n## Network stats: elapsed time=0ms (0ms mobile, 0ms wifi, 0ms not connected)\n');
    },

    async pm(argv, env) {
      const [sub, ...rest] = argv;
      if (sub === 'list') {
        if (rest[0] !== 'packages' && rest[0] !== 'package') throw unsupported(`pm list ${rest[0] ?? ''}`.trim());
        const { rest: filters, has } = readOptions(rest.slice(1), { '-3': 0, '-s': 0, '-e': 0, '-d': 0, '-a': 0, '--user': 1 }, 'pm list packages');
        if (has('-d')) return ok();   // nothing is disabled on this device
        const wanted = filters[0]?.toLowerCase(), names = [...new Set((await device.packages()).filter(item => (!has('-3') || !item.system) && (!has('-s') || item.system)).map(item => item.packageName))].filter(name => !wanted || name.toLowerCase().includes(wanted));
        return ok(names.map(name => `package:${name}\n`).join(''));
      }
      if (sub === 'clear') {
        const { rest: names } = readOptions(rest, { '--user': 1 }, 'pm clear'); if (names.length !== 1) throw usage('pm clear <package>');
        await requirePackage(names[0], 'pm clear'); await load(names[0], env.notes); await device.clearData(names[0]); return ok('Success\n');
      }
      if (sub === 'grant' || sub === 'revoke') {
        const { rest: names } = readOptions(rest, { '--user': 1 }, `pm ${sub}`); if (names.length !== 2) throw usage(`pm ${sub} <package> <permission>`);
        await requirePackage(names[0], `pm ${sub}`); await load(names[0], env.notes);
        try { await device.setPermission(names[1], sub === 'grant' ? 'allow' : 'ask'); } catch (error) { throw new AdbError(`Exception occurred while executing '${sub}':\njava.lang.SecurityException: ${error?.message ?? error}`, { code: 255 }); }
        if (sub === 'revoke') { const info = await current(); if (info.running) { await device.closeApp(); env.notes.push('The app was stopped, as Android does when a runtime permission is revoked.'); } }
        return ok();
      }
      if (sub === 'uninstall') {
        const { rest: names, has } = readOptions(rest, { '-k': 0, '--user': 1 }, 'pm uninstall'); if (names.length !== 1) throw usage('pm uninstall [-k] <package>');
        const removed = await device.uninstall(names[0], { keepData: has('-k') });
        return removed ? ok('Success\n') : { stdout: `Failure [not installed for 0]\n`, code: 1 };
      }
      if (sub === 'dump') return SHELL.dumpsys(['package', ...rest], env);
      if (sub === 'path') throw unsupported('pm path', 'the page does not know the APK path inside the VM');
      if (sub === 'install') throw unsupported('pm install', 'install with adb install <file.apk>: the file comes from the computer, not from a path on the device');
      throw unsupported(`pm ${sub ?? ''}`.trim());
    },

    async cmd(argv, env) {
      const [service, ...rest] = argv;
      if (service === 'package') return SHELL.pm(rest, env);
      if (service === 'activity') return SHELL.am(rest, env);
      if (service === 'battery') return SHELL.dumpsys(['battery', ...rest], env);
      if (service === 'uimode' && rest[0] === 'night') {
        if (rest.length === 1) return ok(`Night mode: ${(await device.settings()).darkTheme ? 'yes' : 'no'}\n`);
        if (rest[1] !== 'yes' && rest[1] !== 'no') throw unsupported(`cmd uimode night ${rest[1]}`, 'yes or no');
        await device.setSettings({ darkTheme: rest[1] === 'yes' }); return ok(`Night mode: ${rest[1]}\n`);
      }
      if (service === 'connectivity' && rest[0] === 'airplane-mode') {
        if (rest.length === 1) return ok(`${(await device.settings()).connectivity === 'offline' ? 'enabled' : 'disabled'}\n`);
        if (rest[1] !== 'enable' && rest[1] !== 'disable') throw usage('cmd connectivity airplane-mode [enable|disable]');
        radios = null; await device.setSettings({ connectivity: rest[1] === 'enable' ? 'offline' : 'online' }); return ok();
      }
      throw unsupported(`cmd ${argv.join(' ')}`.trim());
    },

    async input(argv, env) {
      const sources = ['touchscreen', 'keyboard', 'mouse', 'touchpad', 'gamepad', 'touchnavigation', 'joystick', 'stylus', 'dpad', 'trackball', 'rotaryencoder'];
      let args = [...argv]; if (sources.includes(args[0])) args.shift(); if (args[0] === '-d') { if (args[1] !== '0') throw unsupported(`input -d ${args[1]}`); args = args.slice(2); }
      const [sub, ...rest] = args;
      if (sub === 'tap') { if (rest.length !== 2) throw usage('input tap <x> <y>'); env.notes.push(`tap: ${await device.tap(number(rest[0], 'input tap'), number(rest[1], 'input tap'))}`); return ok(); }
      if (sub === 'swipe') {
        if (rest.length !== 4 && rest.length !== 5) throw usage('input swipe <x1> <y1> <x2> <y2> [duration in ms]');
        const [x1, y1, x2, y2] = rest.slice(0, 4).map(value => number(value, 'input swipe')), ms = rest[4] === undefined ? 300 : number(rest[4], 'input swipe'); if (ms < 0 || ms > 20000) throw usage('input swipe: duration from 0 to 20000 ms');
        env.notes.push(`gesture: ${await device.swipe(x1, y1, x2, y2, ms)}`); return ok();
      }
      if (sub === 'text') { if (rest.length !== 1) throw usage(`input text <text> (${rest.length} arguments: in an adb shell, text with spaces needs %s in place of them or quotes inside the quotes)`); env.notes.push(`text: ${await device.text(rest[0].replace(/%s/g, ' '))}`); return ok(); }
      if (sub === 'keyevent') {
        if (rest.includes('--longpress') || rest.includes('--doubletap')) throw unsupported(`input keyevent ${rest.find(arg => arg.startsWith('--'))}`);
        if (!rest.length) throw usage('input keyevent <code or name> ...');
        for (const key of rest) {
          let code = /^\d+$/.test(key) ? Number(key) : await device.keyCode(key.startsWith('KEYCODE_') ? key : `KEYCODE_${key}`);
          if (!Number.isInteger(code)) throw usage(`input keyevent: unknown key: ${key}`);
          if (code === 4) env.notes.push(`BACK: ${await device.nav('back')}`); else if (code === 3) env.notes.push(`HOME: ${await device.nav('home')}`); else if (code === 187) env.notes.push(`APP_SWITCH: ${await device.nav('recents')}`);
          else env.notes.push(`key ${key}: ${await device.key(code)}`);
        }
        return ok();
      }
      throw unsupported(`input ${sub ?? ''}`.trim());
    },

    async screencap(argv, env) {
      const { rest, has } = readOptions(argv, { '-p': 0, '-d': 1 }, 'screencap'); if (rest.length > 1) throw usage('screencap [-p] [file]');
      if (!has('-p') && !/\.png$/i.test(rest[0] ?? '')) throw unsupported('screencap without -p', 'the raw screencap format is not produced; use -p (PNG)');
      const shot = await device.screenshot(), blob = shot.blob.type === 'image/png' ? shot.blob : new Blob([shot.blob], { type: 'image/png' });
      if (!rest.length) return ok('', { binary: blob });
      await writeToolFile(devicePath(rest[0]), blob, 'image/png', env.notes); return ok();
    },
    async screenrecord() { throw unsupported('screenrecord', 'a command that keeps recording until interrupted does not fit in one call; use the MCP tool record_screen (start, then stop with the file)'); },

    async uiautomator(argv, env) {
      const [sub, ...rest] = argv; if (sub !== 'dump') throw unsupported(`uiautomator ${sub ?? ''}`.trim());
      const { rest: files } = readOptions(rest, { '--compressed': 0, '--windows': 0 }, 'uiautomator dump'); if (files.length > 1) throw usage('uiautomator dump [file]');
      const info = await current(); if (!info.running) throw new AdbError('ERROR: could not get idle state. (no app open on the device)');
      const snapshot = await device.snapshot(), ids = []; (function walk(view) { if (!view) return; if (Number.isInteger(view.androidId) && view.androidId > 0) ids.push(view.androidId); for (const child of view.children ?? []) walk(child); })({ children: snapshot?.views ?? [] });
      const xml = uiHierarchyXml(snapshot, { packageName: info.packageName ?? '', resourceNames: ids.length ? await device.resourceNames([...new Set(ids)]) : new Map(), rotation: info.widthPx > info.heightPx ? 1 : 0 });
      const target = files[0] ?? '/sdcard/window_dump.xml';
      if (target === '/dev/tty' || target === '/dev/stdout') return ok(`${xml}UI hierchary dumped to: ${target}\n`);
      await writeToolFile(devicePath(target), new Blob([xml], { type: 'text/xml' }), 'text/xml', env.notes); return ok(`UI hierchary dumped to: ${target}\n`);
    },

    async dumpsys(argv, env) {
      const [service, ...rest] = argv, info = await current(), density = info.densityDpi;
      const record = (cls, task) => `ActivityRecord{${token(cls)} u0 ${shortComponent(info.packageName, cls)} t${task}}`;
      const front = info.running && !info.background, tasks = info.tasks ?? [], top = tasks.at(-1) ?? null, topActivity = top?.activityStack?.at(-1) ?? info.activity ?? null;
      if (service === 'activity') {
        const what = rest[0] ?? 'activities'; if (!['activities', 'a', 'top'].includes(what)) throw unsupported(`dumpsys activity ${what}`, 'activities or top');
        env.notes.push('Summary in the Android 13 format with what the page knows (tasks, Activity stack, the resumed Activity); the other dumpsys sections do not exist here.');
        if (what === 'top') return ok(front && topActivity ? `TASK ${info.packageName} id=${top?.id ?? 1} userId=0\n  ACTIVITY ${shortComponent(info.packageName, topActivity)} ${token(topActivity)}${info.pid ? ` pid=${info.pid}` : ''}\n` : '');
        let text = 'ACTIVITY MANAGER ACTIVITIES (dumpsys activity activities)\nDisplay #0 (activities from top to bottom):\n';
        for (const task of [...tasks].reverse()) {
          const stack = task.activityStack ?? [];
          text += `  * Task{${token(`task${task.id}`)} #${task.id} type=standard A=${info.packageName} U=0 visible=${front && task === top} sz=${stack.length}}\n`;
          stack.slice().reverse().forEach((cls, index) => { text += `    * Hist  #${stack.length - 1 - index}: ${record(cls, task.id)}\n`; });
        }
        text += front && topActivity ? `  ResumedActivity: ${record(topActivity, top?.id ?? 1)}\n  topResumedActivity=${record(topActivity, top?.id ?? 1)}\n` : '  ResumedActivity: null\n  topResumedActivity=null\n';
        return ok(text);
      }
      if (service === 'window') {
        const what = rest[0] ?? 'windows'; if (!['windows', 'w', 'displays', 'd'].includes(what)) throw unsupported(`dumpsys window ${what}`, 'windows or displays');
        if (what === 'displays' || what === 'd') return ok(`WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)\n  Display: mDisplayId=0\n    init=${info.widthPx}x${info.heightPx} ${density}dpi cur=${info.widthPx}x${info.heightPx} app=${info.widthPx}x${info.heightPx}\n`);
        env.notes.push('Summary with what the page knows: the focused window and app.');
        return ok(`WINDOW MANAGER WINDOWS (dumpsys window windows)\n  mCurrentFocus=${front && topActivity ? `Window{${token(`w${topActivity}`)} u0 ${info.packageName}/${topActivity}}` : 'null'}\n  mFocusedApp=${front && topActivity ? record(topActivity, top?.id ?? 1) : 'null'}\n`);
      }
      if (service === 'package') {
        if (rest.length !== 1) throw unsupported('dumpsys package without a package', 'dumpsys package <package>');
        const known = await device.packages(); if (!known.some(item => item.packageName === rest[0])) return ok(`Unable to find package: ${rest[0]}\n`);
        const inventory = info.inventory; if (!inventory || inventory.packageName !== rest[0]) throw new AdbError(`dumpsys package ${rest[0]}: the page only knows the manifest of the loaded app (${info.packageName ?? 'none'}). Open ${rest[0]} first (am start, monkey -p or open_app).`);
        env.notes.push('Summary with what the manifest and the permissions panel say; the other dumpsys package sections do not exist here.');
        const permissions = await device.permissions(), runtime = new Map(permissions.map(item => [item.name, item.granted]));
        let text = `Packages:\n  Package [${rest[0]}] (${token(rest[0])}):\n    pkg=Package{${token(rest[0])} ${rest[0]}}\n`;
        text += `    versionCode=${inventory.versionCode ?? 0} minSdk=${inventory.minSdk ?? 1} targetSdk=${inventory.targetSdk ?? inventory.minSdk ?? 1}\n    versionName=${inventory.versionName ?? 'null'}\n    requested permissions:\n`;
        for (const name of inventory.requestedPermissions ?? []) text += `      ${name}\n`;
        text += '    User 0: installed=true hidden=false suspended=false stopped=false\n      runtime permissions:\n';
        for (const [name, granted] of runtime) text += `        ${name}: granted=${granted}\n`;
        return ok(text);
      }
      if (service === 'battery') {
        const settings = await device.settings(), battery = settings.battery ?? { level: 100, charging: true };
        if (!rest.length) {
          const status = battery.level >= 100 && battery.charging ? 5 : battery.charging ? 2 : 3;
          return ok(`Current Battery Service state:\n  AC powered: ${!!battery.charging}\n  USB powered: false\n  Wireless powered: false\n  status: ${status}\n  present: true\n  level: ${battery.level}\n  scale: 100\n`);
        }
        const remember = () => { batteryBefore ??= { ...battery }; };
        if (rest[0] === 'reset') { if (batteryBefore) await device.setSettings({ battery: batteryBefore }); batteryBefore = null; return ok(); }
        if (rest[0] === 'unplug') { remember(); await device.setSettings({ battery: { ...battery, charging: false } }); return ok(); }
        if (rest[0] === 'set' && rest.length === 3) {
          const value = integer(rest[2], `dumpsys battery set ${rest[1]}`);
          if (rest[1] === 'level') { if (value < 0 || value > 100) throw usage('dumpsys battery set level: 0 to 100'); remember(); await device.setSettings({ battery: { ...battery, level: value } }); return ok(); }
          if (rest[1] === 'status') { if (![2, 3, 4, 5].includes(value)) throw unsupported(`dumpsys battery set status ${value}`, '2 charging, 3 discharging, 4 not charging, 5 full'); remember(); await device.setSettings({ battery: { level: value === 5 ? 100 : battery.level, charging: value === 2 || value === 5 } }); return ok(); }
          if (['ac', 'usb', 'wireless'].includes(rest[1])) { remember(); await device.setSettings({ battery: { ...battery, charging: value !== 0 } }); return ok(); }
        }
        throw unsupported(`dumpsys battery ${rest.join(' ')}`);
      }
      if (service === '-l') return ok('Currently running services:\n  activity\n  battery\n  package\n  window\n');
      throw unsupported(`dumpsys ${service ?? ''}`.trim(), 'activity, window, package <package> and battery');
    },

    async getprop(argv, env) {
      const settings = await device.settings(), build = await device.buildProps(), props = new Map();
      if (build) for (const [key, field] of BUILD_PROPS) if (build[field] !== undefined && build[field] !== null) props.set(key, String(build[field]));
      props.set('ro.sf.lcd_density', String((await current()).densityDpi)); props.set('persist.sys.locale', settings.locale ?? ''); if (settings.timeZone) props.set('persist.sys.timezone', settings.timeZone);
      if (!argv.length) { if (!build) env.notes.push('Only the properties the page knows: those of android.os.Build (ro.product.*, ro.build.*) stay in the VM and the page does not read them yet.'); return ok([...props].sort(([a], [b]) => a < b ? -1 : 1).map(([key, value]) => `[${key}]: [${value}]\n`).join('')); }
      if (argv.length > 2) throw usage('getprop [key [default]]');
      if (props.has(argv[0])) return ok(`${props.get(argv[0])}\n`);
      if (BUILD_PROPS.some(([key]) => key === argv[0])) throw unsupported(`getprop ${argv[0]}`, 'the value is that of android.os.Build inside the VM, which the page does not read yet');
      env.notes.push(`The page does not know the property ${argv[0]}; the answer is that of a property with no value.`);
      return ok(`${argv[1] ?? ''}\n`);
    },
    async setprop(argv) {
      if (argv.length !== 2) throw usage('setprop <key> <value>');
      if (argv[0] === 'persist.sys.locale') { if (!/^[a-z]{2}-[A-Z]{2}$/.test(argv[1])) throw usage('setprop persist.sys.locale: use language-REGION, e.g. pt-BR'); await device.setSettings({ locale: argv[1] }); return ok(); }
      if (argv[0] === 'persist.sys.timezone') { await device.setSettings({ timeZone: argv[1] }); return ok(); }
      throw unsupported(`setprop ${argv[0]}`, 'only persist.sys.locale and persist.sys.timezone, which are device settings in the lab');
    },

    async settings(argv) {
      const { rest } = readOptions(argv, { '--user': 1 }, 'settings'), [verb, namespace, key, ...values] = rest, settings = await device.settings();
      if (verb !== 'get' && verb !== 'put') throw unsupported(`settings ${verb ?? ''}`.trim(), 'get and put');
      if (!namespace || !key || (verb === 'put') !== (values.length === 1)) throw usage(`settings ${verb} <global|system|secure> <key>${verb === 'put' ? ' <value>' : ''}`);
      const value = values[0], id = `${namespace} ${key}`, scale = text => { const n = number(text, `settings put ${id}`); if (n < 0 || n > 10) throw usage(`settings put ${id}: 0 to 10`); return n; };
      const float = n => Number.isInteger(n) ? n.toFixed(1) : String(n);
      if (namespace === 'global' && SCALE_KEYS.includes(key)) { if (verb === 'get') return ok(`${float(settings.animatorScale ?? 1)}\n`); await device.setSettings({ animatorScale: scale(value) }); return ok(); }
      if (id === 'system font_scale') { if (verb === 'get') return ok(`${float(settings.fontScale ?? 1)}\n`); const n = number(value, 'settings put system font_scale'); if (n < 0.85 || n > 2) throw unsupported(`settings put system font_scale ${value}`, 'the lab accepts 0.85 to 2'); await device.setSettings({ fontScale: n }); return ok(); }
      if (id === 'system time_12_24') { if (verb === 'get') return ok(`${settings.hour24 ? '24' : '12'}\n`); if (value !== '12' && value !== '24') throw usage('settings put system time_12_24: 12 or 24'); await device.setSettings({ hour24: value === '24' }); return ok(); }
      if (id === 'system user_rotation') { if (verb === 'get') return ok(`${settings.orientation === 'landscape' ? 1 : 0}\n`); if (!['0', '1', '2', '3'].includes(value)) throw usage('settings put system user_rotation: 0 to 3'); if (value === '2' || value === '3') throw unsupported(`settings put system user_rotation ${value}`, 'the lab has portrait (0) and landscape (1)'); await device.setSettings({ orientation: value === '1' ? 'landscape' : 'portrait' }); return ok(); }
      if (id === 'system accelerometer_rotation') { if (verb === 'get') return ok('0\n'); if (value !== '0') throw unsupported('settings put system accelerometer_rotation 1', 'the lab device does not rotate by sensor; orientation is user_rotation'); return ok(); }
      if (id === 'secure ui_night_mode') { if (verb === 'get') return ok(`${settings.darkTheme ? 2 : 1}\n`); if (value !== '1' && value !== '2') throw unsupported(`settings put secure ui_night_mode ${value}`, '1 (light) or 2 (dark)'); await device.setSettings({ darkTheme: value === '2' }); return ok(); }
      throw unsupported(`settings ${verb} ${id}`, `the page only reaches the device settings: ${SETTINGS_KEYS}`);
    },

    async wm(argv) {
      const [sub, value, ...extra] = argv, info = await current(); if (extra.length) throw usage(`wm ${sub}: extra arguments`);
      if (sub === 'size') {
        if (value === undefined) return ok(`Physical size: ${info.widthPx}x${info.heightPx}\n`);
        if (value === 'reset') { if (screenBefore) await device.setSettings(screenBefore); screenBefore = null; return ok(); }
        const match = /^(\d+)x(\d+)$/.exec(value); if (!match) throw usage('wm size [reset|WIDTHxHEIGHT]');
        const settings = await device.settings(); screenBefore ??= { screen: settings.screen, customScreen: settings.customScreen };
        await device.setSettings({ screen: 'custom', customScreen: { width: Number(match[1]), height: Number(match[2]), unit: 'px' } }); return ok();
      }
      if (sub === 'density') { if (value === undefined) return ok(`Physical density: ${info.densityDpi}\n`); if (value === 'reset' || Number(value) === info.densityDpi) return ok(); throw unsupported(`wm density ${value}`, `the lab's density is fixed at ${info.densityDpi} dpi (1 px = 1 dp)`); }
      throw unsupported(`wm ${sub ?? ''}`.trim(), 'size and density');
    },

    async svc(argv) {
      const [what, verb] = argv; if (!['wifi', 'data'].includes(what)) throw unsupported(`svc ${what ?? ''}`.trim(), 'wifi and data');
      if (verb !== 'enable' && verb !== 'disable') throw usage(`svc ${what} enable|disable`);
      const state = (await device.settings()).connectivity, derived = { wifi: state === 'online', data: state !== 'offline' };
      if (!radios || (radios.wifi ? 'online' : radios.data ? 'metered' : 'offline') !== state) radios = derived;   // the two radios behind the lab's one setting: Wi-Fi (online), mobile data only (metered), none (offline)
      radios[what] = verb === 'enable'; await device.setSettings({ connectivity: radios.wifi ? 'online' : radios.data ? 'metered' : 'offline' }); return ok();
    },

    async logcat(argv, env) {
      const options = parseLogcat(argv);
      if (options.clear) { await device.clearLogcat(); return ok(); }
      let entries = (await device.logcat()).filter(options.accept); if (options.tail !== null) entries = entries.slice(-options.tail); if (options.max !== null) entries = entries.slice(0, options.max);
      if (!options.dump) env.notes.push('adb logcat without -d follows the log without stopping; here the response carries what there is now (like -d). To follow it, use the MCP logcat tool with since and wait_ms.');
      return ok(entries.length ? `--------- beginning of main\n${entries.map(entry => `${LOG_FORMATS[options.format](entry)}\n`).join('')}` : '');
    },

    async ls(argv) {
      const { rest, has } = readOptions(argv, { '-l': 0, '-a': 0, '-1': 0, '-la': 0, '-al': 0 }, 'ls'), long = has('-l') || has('-la') || has('-al'), files = await listFiles(), out = [];
      for (const target of rest.length ? rest : ['/sdcard']) {
        const path = devicePath(target), file = files.find(item => item.path === path), prefix = path === '/' ? '/' : `${path}/`, names = new Map();
        if (file) { out.push(long ? `-rw-rw---- 1 u0_a0 media_rw ${String(file.size).padStart(9)} ${stamp(file.modified).slice(0, 11)} ${shortPath(path)}` : shortPath(path)); continue; }
        for (const item of files) if (item.path.startsWith(prefix)) { const [name, ...deeper] = item.path.slice(prefix.length).split('/'); names.set(name, deeper.length ? null : item); }
        if (path === SHARED_ROOT) { for (const dir of ['Download', 'Movies', 'Music', 'Pictures']) if (!names.has(dir)) names.set(dir, null); }
        else if (!names.size && !['Download', 'Movies', 'Music', 'Pictures'].some(dir => path === `${SHARED_ROOT}/${dir}`) && path !== '/data/local/tmp') throw new AdbError(`ls: ${target}: No such file or directory (the lab lists /sdcard and /data/local/tmp, with what adb push, screencap and uiautomator dump wrote)`);
        for (const [name, item] of [...names].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) out.push(long ? (item ? `-rw-rw---- 1 u0_a0 media_rw ${String(item.size).padStart(9)} ${stamp(item.modified).slice(0, 11)} ${name}` : `drwxrwx--- 2 u0_a0 media_rw ${'0'.padStart(9)} ${stamp(now()).slice(0, 11)} ${name}`) : name);
      }
      return ok(out.map(line => `${line}\n`).join(''));
    },
    async cat(argv) { if (!argv.length) throw unsupported('cat without a file'); let text = ''; for (const target of argv) text += await (await readFile(devicePath(target), 'cat')).text(); return ok(text); },
    async rm(argv) {
      const { rest, has } = readOptions(argv, { '-f': 0, '-r': 0, '-rf': 0, '-fr': 0 }, 'rm'), force = has('-f') || has('-rf') || has('-fr'); if (!rest.length) throw usage('rm [-f] <file>');
      for (const target of rest) { const path = devicePath(target), file = await findFile(path); if (!file) { if (force) continue; throw new AdbError(`rm: ${target}: No such file or directory`); } if (file.scratch) scratch.delete(path); else await device.removeShared(file.shared.id); }
      return ok();
    },
    async 'run-as'() { throw unsupported('run-as', 'the app\'s private files do not reach the page; SharedPreferences and databases are in the MCP app_data tool'); },
  };

  /** One line of the device shell (`adb shell …`): its own pipes and lists, then the command table. */
  async function shell(line, env) {
    const list = parseLine(line); if (!list.length) throw unsupported('adb shell without a command', 'there is no interactive shell; pass the command');
    return runList(list, async argv => {
      const command = SHELL[argv[0]];
      if (FILTERS[argv[0]] && !command) throw unsupported(`${argv[0]} as the first command`, 'the text filters only read the output of another command');
      if (!command || !Object.hasOwn(SHELL, argv[0])) throw new AdbError(`/system/bin/sh: ${argv[0]}: inaccessible or not found (not implemented in APK Web Lab; adb help lists what there is)`, { code: 127, kind: 'unsupported' });
      return command(argv.slice(1), env);
    }, { describeStage: name => `${name} in a shell pipe` });
  }

  // ---- adb itself ----
  const GLOBAL = { '-s': 1, '-d': 0, '-e': 0, '-a': 0, '-H': 1, '-P': 1, '-L': 1, '-t': 1, '--one-device': 1, '--exit-on-write-error': 0 };
  async function adb(argv, env, io) {
    let args = [...argv]; if (args[0] === 'adb') args.shift();
    while (args.length && Object.hasOwn(GLOBAL, args[0])) { const [name, value] = args.splice(0, 1 + GLOBAL[args[0]]); if (name === '-s' && value !== SERIAL) env.notes.push(`-s ${value}: the lab has a single device (${SERIAL}); the command went to it.`); }
    const [sub, ...rest] = args;
    switch (sub) {
      case undefined: case 'help': case '--help': case '-h': return ok(`${ADB_HELP}\n`);
      case 'version': case '--version': return ok('APK Web Lab: adb command interpreter (not the Android Debug Bridge)\n');
      case 'devices': {
        const build = rest.includes('-l') ? await device.buildProps() : null, detail = build ? ` product:${String(build.PRODUCT).replace(/\s+/g, '_')} model:${String(build.MODEL).replace(/\s+/g, '_')} device:${String(build.DEVICE).replace(/\s+/g, '_')} transport_id:1` : rest.includes('-l') ? ' transport_id:1' : '';
        return ok(rest.includes('-l') ? `List of devices attached\n${SERIAL.padEnd(22)} device${detail}\n\n` : `List of devices attached\n${SERIAL}\tdevice\n\n`);
      }
      case 'get-state': return ok('device\n');
      case 'get-serialno': return ok(`${SERIAL}\n`);
      case 'wait-for-device': case 'wait-for-any-device': case 'wait-for-local-device': case 'wait-for-usb-device': return rest.length ? adb(rest, env, io) : ok();
      case 'start-server': case 'kill-server': case 'reconnect': env.notes.push(`adb ${sub}: there is no adb server here; nothing to do.`); return ok();
      case 'install': {
        const { rest: files, has } = readOptions(rest, { '-r': 0, '-t': 0, '-d': 0, '-g': 0, '-l': 0, '-s': 0, '--no-streaming': 0, '--streaming': 0, '--fastdeploy': 0, '--no-fastdeploy': 0, '--user': 1, '--abi': 1, '--instant': 0, '--full': 0 }, 'adb install');
        if (has('--instant')) throw unsupported('adb install --instant'); if (files.length !== 1) throw usage('adb install [-r -t -d -g] <file.apk> (one file; split APKs are not supported)');
        const file = await io.localFile(files[0]), before = await current();
        if (before.running) env.notes.push('The device runs one app at a time: the app that was open was stopped by the installation.');
        try { await device.install(file, { grant: has('-g') }); } catch (error) { return { stdout: `Performing Streamed Install\nadb: failed to install ${files[0]}: Failure [INSTALL_PARSE_FAILED_NOT_APK: ${error?.message ?? error}]\n`, code: 1 }; }
        return ok('Performing Streamed Install\nSuccess\n');
      }
      case 'uninstall': {
        const { rest: names, has } = readOptions(rest, { '-k': 0, '--user': 1 }, 'adb uninstall'); if (names.length !== 1) throw usage('adb uninstall [-k] <package>');
        return (await device.uninstall(names[0], { keepData: has('-k') })) ? ok('Success\n') : { stdout: 'Failure [DELETE_FAILED_INTERNAL_ERROR]\n', code: 1 };
      }
      case 'push': {
        const { rest: operands } = readOptions(rest, { '--sync': 0, '-z': 1, '-Z': 0, '-n': 0 }, 'adb push'); if (operands.length !== 2) throw usage('adb push <local file> <path on the device> (one file at a time)');
        const file = await io.localFile(operands[0]), remote = devicePath(operands[1]), mime = MIME_BY_EXTENSION[extension(file.name)] ?? '', dir = `${SHARED_ROOT}/${directoryOf(kindOf(mime))}`;
        const asDirectory = operands[1].endsWith('/') || remote === dir || remote === SHARED_ROOT, target = asDirectory ? `${remote}/${file.name}` : remote, name = basename(target);
        if (target !== `${dir}/${name}`) throw new AdbError(`adb: error: failed to copy '${operands[0]}' to '${operands[1]}': the lab's shared storage keeps this kind of file in ${shortPath(dir)}/ (images in Pictures, videos in Movies, audio in Music, the rest in Download). Use: adb push ${operands[0]} ${shortPath(dir)}/`);
        if (MIME_BY_EXTENSION[extension(name)] !== (mime || undefined) && extension(name) !== extension(file.name)) throw new AdbError(`adb: error: the destination name (${name}) has a different type than the file (${file.name})`);
        const old = await findFile(target); if (old?.shared) await device.removeShared(old.shared.id);
        const stored = await device.pushShared(new File([file], name, { type: mime, lastModified: file.lastModified }));
        if (stored?.name && stored.name !== name) env.notes.push(`The file was stored as ${stored.name}.`);
        return ok(`${operands[0]}: 1 file pushed, 0 skipped. (${file.size} bytes)\n`);
      }
      case 'pull': {
        const { rest: operands } = readOptions(rest, { '-a': 0, '-z': 1, '-Z': 0 }, 'adb pull'); if (operands.length < 1 || operands.length > 2) throw usage('adb pull <path on the device> [local file]');
        const blob = await readFile(devicePath(operands[0]), 'adb: error: failed to stat remote object'); await io.writeLocal(operands[1] ?? `pull:${operands[0]}`, blob, { append: false });
        return ok(`${operands[0]}: 1 file pulled, 0 skipped. (${blob.size} bytes)\n`);
      }
      case 'shell': return shell(rest.join(' '), env);
      case 'exec-out': return shell(rest.join(' '), env);
      case 'logcat': return SHELL.logcat(rest, env);
      case 'forward': case 'reverse': throw unsupported(`adb ${sub}`, 'there are no ports to forward: the app talks to the network through the browser. To point an app host at a local server, use the MCP host_redirects tool');
      case 'install-multiple': case 'install-multi-package': throw unsupported(`adb ${sub}`, 'split APKs are not supported; install a single APK');
      default: throw unsupported(`adb ${sub}`, 'adb help lists what there is');
    }
  }

  return {
    help: () => ADB_HELP,
    /** Runs a command line (`command`: quotes, pipes, && and > as in a terminal) or one adb invocation given as words (`args`). Never throws: a failure is the exit status and stderr. */
    async run({ command = null, args = null } = {}, io = {}) {
      const env = { notes: [] }, files = { localFile: io.localFile ?? (async path => { throw new AdbError(`adb: local file ${path}: this call has no access to the computer's files (use the MCP adb tool through the lab-mcp bridge)`); }), writeLocal: io.writeLocal ?? (async path => { throw new AdbError(`adb: write ${path}: this call has no access to the computer's files (use the MCP adb tool through the lab-mcp bridge)`); }) };
      let stderr = '';
      try {
        const list = Array.isArray(args) && args.length ? [{ join: null, stages: [args.map(String)], redirect: null }] : parseLine(String(command ?? ''));
        if (!list.length) return { stdout: `${ADB_HELP}\n`, stderr: '', code: 0, images: [], notes: [] };
        const known = new Set(['adb', 'help', 'version', 'devices', 'install', 'uninstall', 'push', 'pull', 'shell', 'exec-out', 'logcat', 'get-state', 'get-serialno', 'wait-for-device', 'start-server', 'kill-server', ...Object.keys(GLOBAL)]);
        const result = await runList(list, async argv => {
          if (!known.has(argv[0])) throw unsupported(`${argv[0]}: only adb command lines are interpreted`, 'e.g. adb shell input tap 200 400');
          try { return await adb(argv, env, files); }
          catch (error) { if (!(error instanceof AdbError)) throw error; stderr += `${error.message}\n`; return { stdout: '', code: error.exitCode }; }
        }, { allowRedirect: true, describeStage: name => `${name} after a |` });
        const images = [];
        if (result.redirect) { const { file, append, binary, text } = result.redirect; await files.writeLocal(file, binary ?? new Blob([text ?? ''], { type: 'text/plain' }), { append }); return { stdout: '', stderr, code: result.code, images, notes: env.notes }; }
        if (result.binary) images.push({ blob: result.binary, type: result.binary.type || 'image/png' });
        return { stdout: result.stdout, stderr, code: result.code, images, notes: env.notes };
      } catch (error) {
        if (error instanceof AdbError) return { stdout: '', stderr: stderr + `${error.message}\n`, code: error.exitCode, images: [], notes: env.notes };
        return { stdout: '', stderr: stderr + `${error?.code ? `[${error.code}] ` : ''}${error?.message ?? error}\n`, code: 1, images: [], notes: env.notes };
      }
    },
  };
}
