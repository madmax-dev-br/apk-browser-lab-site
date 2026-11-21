// The device's accounts (AccountManagerService, android-13.0.0_r1): the account authenticators the installed packages declare, the accounts they add, and who may see and use them.
// src/system-managers-host.js (the synchronous AccountManager calls) and src/managers-extras-host.js (the future-based ones) are its two front ends.
//
//  * Authenticators: a service of an installed package (the app or a companion such as microG) with the intent filter android.accounts.AccountAuthenticator and the meta-data
//    android.accounts.AccountAuthenticator naming an <account-authenticator> XML (accountType, customTokens), as RegisteredServicesCache reads them.
//  * Accounts live in memory for the device's lifetime. The accounts whose authenticator is a companion package (a device component such as microG, docs/MICROG.md) are also kept in
//    the VM's disk, as AccountManagerService keeps them in /data/system_ce/0/accounts_ce.db: one JSON file per authenticator package, ACCOUNTS_DIR/<package>.json, rewritten
//    synchronously on every change of one of its accounts (store.saved) and read when the store is created, so the device data persistence (src/app-data-store.js
//    attachDeviceData) carries them across loads with the rest of that package's data. The app's own authenticator keeps its accounts in memory only, as before.
//    Only the authenticator's own package (or a package signed with the same certificate) adds, removes, reads secrets of, or sets the visibility of an account of its type;
//    anyone else gets the service's SecurityException.
//  * Visibility (AccountManagerService.resolveAccountVisibility): the authenticator's packages see every account of their type; another package sees an account if its visibility for that
//    package is VISIBLE or USER_MANAGED_VISIBLE, else, for targetSdk 26+, by the value of PACKAGE_NAME_KEY_LEGACY_NOT_VISIBLE (not visible by default), and below 26 with GET_ACCOUNTS by
//    PACKAGE_NAME_KEY_LEGACY_VISIBLE (visible by default).
//  * Auth tokens: getAuthToken answers the token the authenticator cached with setAuthToken when the caller may use it (the authenticator's own packages) and the authenticator does not
//    declare customTokens, as the service does before it binds the authenticator; every other request goes to the authenticator itself (src/account-sessions.js: AccountManagerService's
//    Session over the original IAccountAuthenticator of framework-aosp/profiles/accounts).

export const VISIBILITY = Object.freeze({ UNDEFINED: 0, VISIBLE: 1, USER_MANAGED_VISIBLE: 2, NOT_VISIBLE: 3, USER_MANAGED_NOT_VISIBLE: 4 });
export const LEGACY_VISIBLE = 'android:accounts:key_legacy_visible', LEGACY_NOT_VISIBLE = 'android:accounts:key_legacy_not_visible';
const AUTHENTICATOR_ACTION = 'android.accounts.AccountAuthenticator';
const isVisible = value => value === VISIBILITY.VISIBLE || value === VISIBILITY.USER_MANAGED_VISIBLE;

/** The <account-authenticator> declarations of a package entry ({ name, manifest } + a resources environment with getXml / getAttribute). */
export function declaredAuthenticators(entry, environment) {
  const out = [];
  for (const detail of entry?.manifest?.componentDetails ?? []) {
    if (detail.kind !== 'service' || !(detail.filters ?? []).some(filter => (filter.actions ?? []).includes(AUTHENTICATOR_ACTION))) continue;
    const meta = (detail.metaData ?? []).find(item => item.name === AUTHENTICATOR_ACTION && item.resource !== undefined && item.resource !== null);
    if (!meta || !environment?.getXml) continue;
    let root; try { root = environment.getXml(Number(meta.resource)); } catch { continue; }
    while (root && root.name !== 'account-authenticator' && Array.isArray(root.children) && root.children.length === 1 && !root.attributes?.length) root = root.children[0];
    const attribute = name => { let found = environment.getAttribute?.(root, name) ?? root?.attributes?.find(a => a.name === name) ?? null; while (found?.resolved) found = found.resolved; return found ? found.value ?? found.rawValue ?? found.data ?? null : null; };   // android:accountType="@string/...": the string it refers to
    const type = attribute('accountType'); if (typeof type !== 'string' || !type) continue;
    const custom = attribute('customTokens');
    // the resource ids AuthenticatorDescription carries (label, icon, smallIcon, accountPreferences): a reference attribute's id, else 0 (not given)
    const idOf = name => { const found = environment.getAttribute?.(root, name) ?? root?.attributes?.find(a => a.name === name) ?? null; return found?.kind === 'reference' && Number.isInteger(found.reference) ? found.reference : 0; };
    out.push({ type, packageName: entry.name, service: detail.name, customTokens: custom === true || custom === 'true' || custom === -1 || custom === 1,
      labelId: idOf('label'), iconId: idOf('icon'), smallIconId: idOf('smallIcon'), prefId: idOf('accountPreferences') });
  }
  return out;
}

/** Where the accounts of authenticator package `packageName` are kept when it is a companion package (the device's accounts_ce, one file per authenticator). */
export const ACCOUNTS_DIR = '/data/system_ce/0/accounts_ce';
export const accountsFile = packageName => `${ACCOUNTS_DIR}/${packageName}.json`;
const toObject = map => Object.fromEntries([...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
/** The file form of one account: { name, type, password, userData: {..}, tokens: {..}, visibility: {..} }. */
export const accountRecord = a => ({ name: a.name, type: a.type, password: a.password ?? null, userData: toObject(a.userData), tokens: toObject(a.tokens), visibility: toObject(a.visibility) });

/**
 * `files` (optional): { fs, persisted(packageName) } -- the VM's VirtualFileSystem and which authenticator packages keep their accounts on disk (companion packages). Without it every
 * account lives in memory only.
 */
export function createAccountStore({ packages, sameSigners = (a, b) => a === b, record = () => {}, files = null }) {
  const accounts = [];   // { name, type, password, userData: Map, tokens: Map, visibility: Map }
  let authenticators = null;
  const listeners = [];
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  /** Accounts of the files of the persisted packages, read when the store is created (a malformed file is reported and ignored, never half-read). */
  const readFiles = () => {
    if (!files?.fs) return;
    for (const { entry } of packages()) {
      if (!entry?.name || !files.persisted(entry.name)) continue;
      const bytes = files.fs.bytes(accountsFile(entry.name)); if (!bytes) continue;
      let rows; try { rows = JSON.parse(decoder.decode(bytes)); if (!Array.isArray(rows)) throw new Error('not a list'); } catch (error) { record(`ACCOUNTS ${accountsFile(entry.name)} could not be read (${error?.message ?? error}): its accounts are not restored`); continue; }
      let restored = 0;
      for (const row of rows) {
        if (typeof row?.name !== 'string' || typeof row?.type !== 'string' || accounts.some(a => a.name === row.name && a.type === row.type)) continue;
        const map = value => new Map(Object.entries(value && typeof value === 'object' ? value : {}));
        accounts.push({ name: row.name, type: row.type, password: typeof row.password === 'string' ? row.password : null, userData: map(row.userData), tokens: map(row.tokens), visibility: new Map([...map(row.visibility)].map(([k, v]) => [k, Number(v) | 0])) });
        restored++;
      }
      if (restored) record(`ACCOUNTS restored ${restored} account(s) of ${entry.name} from ${accountsFile(entry.name)}`);
    }
  };
  const store = {
    accounts,
    listeners,
    /** Every installed package's authenticators, read once (packages do not change while the device runs). */
    authenticators() { return authenticators ??= packages().flatMap(({ entry, environment }) => { try { return declaredAuthenticators(entry, environment()); } catch (error) { record(`ACCOUNTS authenticators of ${entry.name} could not be read: ${error?.message ?? error}`); return []; } }); },
    authenticatorFor(type) { return store.authenticators().find(a => a.type === type) ?? null; },
    /** May package `caller` act as the authenticator of `type` (its own package, or one signed alike)? */
    owns(caller, type) { const auth = store.authenticatorFor(type); return !!auth && (caller === auth.packageName || sameSigners(caller, auth.packageName)); },
    find(name, type) { return accounts.find(a => a.name === name && a.type === type) ?? null; },
    add(name, type, password, userData = new Map()) {
      if (store.find(name, type)) return false;
      accounts.push({ name, type, password: password ?? null, userData: new Map(userData), tokens: new Map(), visibility: new Map() });
      return true;
    },
    remove(name, type) { const at = accounts.findIndex(a => a.name === name && a.type === type); if (at < 0) return false; accounts.splice(at, 1); return true; },
    /**
     * An account of `type` changed (added, removed, its password, user data, tokens or visibility): when the type's authenticator is a persisted (companion) package, its file is
     * rewritten now with every account of the types that package authenticates (removed when none is left). Returns the path written, or null.
     */
    saved(type) {
      if (!files?.fs) return null;
      const owner = store.authenticatorFor(type)?.packageName; if (!owner || !files.persisted(owner)) return null;
      const types = new Set(store.authenticators().filter(a => a.packageName === owner).map(a => a.type));
      const rows = accounts.filter(a => types.has(a.type)).map(accountRecord), path = accountsFile(owner), fs = files.fs;
      if (!rows.length) { if (fs.node(path)) fs.delete(path); return path; }
      fs.mkdirs(ACCOUNTS_DIR);
      const result = fs.setBytes(path, encoder.encode(JSON.stringify(rows)));
      if (result !== 'ok') record(`ACCOUNTS ${path} could not be written (${result}): the accounts of ${owner} are kept in memory only`);
      return path;
    },
    /** Forgets the accounts in memory and reads the files again (after the device data was restored into the VFS). */
    reload() { accounts.length = 0; readFiles(); },
    /** resolveAccountVisibility for package `caller` (its targetSdk and whether it holds GET_ACCOUNTS / GET_ACCOUNTS_PRIVILEGED). */
    visibleTo(account, caller, options = {}) { return store.owns(caller, account.type) || isVisible(store.visibility(account, caller, options)); },
    /**
     * AccountManagerService.resolveAccountVisibility: the value stored for the package; else, for the authenticator's packages, a privileged package or (below targetSdk 26) one holding
     * GET_ACCOUNTS, the legacy-visible default (USER_MANAGED_VISIBLE unless set); else the legacy-not-visible default (USER_MANAGED_NOT_VISIBLE unless set): an account the user may still
     * choose for the package (the system's account chooser) but that the package cannot list by itself.
     */
    visibility(account, caller, { targetSdk = 33, getAccounts = false, privileged = false } = {}) {
      const own = account.visibility.get(caller);
      if (own !== undefined && own !== VISIBILITY.UNDEFINED) return own;
      const legacy = key => { const value = account.visibility.get(key); return value !== undefined && value !== VISIBILITY.UNDEFINED ? value : null; };
      if (store.owns(caller, account.type) || privileged || (targetSdk < 26 && getAccounts)) return legacy(LEGACY_VISIBLE) ?? VISIBILITY.USER_MANAGED_VISIBLE;
      return legacy(LEGACY_NOT_VISIBLE) ?? VISIBILITY.USER_MANAGED_NOT_VISIBLE;
    },
  };
  readFiles();
  return store;
}
