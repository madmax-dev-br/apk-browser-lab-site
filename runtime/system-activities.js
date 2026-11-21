// The Activities of the "android" package the virtual device has (the system's own screens, declared in frameworks/base/core/res/AndroidManifest.xml of android-13.0.0_r1 and
// compiled from the pinned originals): the account chooser that AccountManager.newChooseAccountIntent starts (and Play services' account picker forwards to), ChooseTypeAndAccountActivity,
// and the account type chooser it starts when several authenticators could add the account, ChooseAccountTypeActivity (framework-aosp/profiles/accounts).
//
// On a device they run in the system's ":ui" process as uid 1000 with a Context of the "android" package. Here they run in the VM's one process: their Context answers the "android"
// package name, their calls to AccountManagerService are the system's (the nearest non-framework frame on the stack is one of these classes: src/package-registry.js systemUiCode),
// their window is an ordinary Activity window themed by the manifest's theme, and they use the framework's resources (com.android.internal.R). Only the Activities listed here exist;
// any other component of the "android" package finds no Activity (ActivityNotFoundException), as before.
export const SYSTEM_PACKAGE = 'android';

/** The <activity> declarations, as core/res/AndroidManifest.xml writes them (theme and label by framework resource name). */
const DECLARATIONS = [
  { name: 'android.accounts.ChooseTypeAndAccountActivity', exported: true, excludeFromRecents: true, theme: 'style/Theme.DeviceDefault.Light.Dialog', label: 'string/choose_account_label', process: ':ui' },
  { name: 'android.accounts.ChooseAccountTypeActivity', exported: false, excludeFromRecents: true, theme: 'style/Theme.DeviceDefault.Light.Dialog', label: 'string/choose_account_label', process: ':ui' },
];
const BY_DESCRIPTOR = new Map(DECLARATIONS.map(declaration => [`L${declaration.name.replaceAll('.', '/')};`, declaration]));
const OUTER = [...BY_DESCRIPTOR.keys()].map(type => type.slice(0, -1));

/** The declaration of a system Activity class (`Lpkg/Cls;`), or null. */
export const systemActivityDeclaration = type => BY_DESCRIPTOR.get(type) ?? null;
/** Whether class `owner` is one of the system Activities or a class nested in one (its listeners, lambdas, callbacks). */
export const isSystemActivityCode = owner => typeof owner === 'string' && OUTER.some(prefix => owner.startsWith(prefix) && (owner.length === prefix.length + 1 ? owner.endsWith(';') : owner[prefix.length] === '$'));
/** The class names of the system Activities, for messages. */
export const systemActivityNames = () => DECLARATIONS.map(declaration => declaration.name);

/**
 * The declaration with its framework resource ids (the theme and label the platform applies as it does for a manifest's), resolved once per framework table; `findId(name)` looks up a
 * framework resource by `type/name` (dots or underscores in a style's name).
 */
export function resolvedSystemDeclaration(type, findId) {
  const declaration = systemActivityDeclaration(type); if (!declaration) return null;
  const id = name => findId?.(name) ?? findId?.(name.replaceAll('.', '_')) ?? null;
  return { name: declaration.name, descriptor: type, exported: declaration.exported, excludeFromRecents: declaration.excludeFromRecents, process: declaration.process,
    theme: id(declaration.theme) ?? undefined, label: id(declaration.label) ?? undefined, system: true };
}
