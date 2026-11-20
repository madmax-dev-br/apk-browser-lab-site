// The device's accounts (AccountManagerService, android-13.0.0_r1): the account authenticators the installed packages declare, the accounts they add, and who may see and use them.
// src/system-managers-host.js (the synchronous AccountManager calls) and src/managers-extras-host.js (the future-based ones) are its two front ends.
//
//  * Authenticators: a service of an installed package (the app or a companion such as microG) with the intent filter android.accounts.AccountAuthenticator and the meta-data
//    android.accounts.AccountAuthenticator naming an <account-authenticator> XML (accountType, customTokens), as RegisteredServicesCache reads them.
//  * Accounts live in memory for the device's lifetime (accounts_ce.db is not modelled: nothing is written to the VM's disk). Only the authenticator's own package (or a package signed
//    with the same certificate) adds, removes, reads secrets of, or sets the visibility of an account of its type; anyone else gets the service's SecurityException.
//  * Visibility (AccountManagerService.resolveAccountVisibility): the authenticator's packages see every account of their type; another package sees an account if its visibility for that
//    package is VISIBLE or USER_MANAGED_VISIBLE, else, for targetSdk 26+, by the value of PACKAGE_NAME_KEY_LEGACY_NOT_VISIBLE (not visible by default), and below 26 with GET_ACCOUNTS by
//    PACKAGE_NAME_KEY_LEGACY_VISIBLE (visible by default).
//  * Auth tokens: getAuthToken answers the token the authenticator cached with setAuthToken when the caller may use it (the authenticator's own packages) and the authenticator does not
//    declare customTokens, as the service does before it would bind the authenticator. Calling an authenticator (its IAccountAuthenticator) is NOT implemented: the framework classes
//    behind it (AbstractAccountAuthenticator, AccountAuthenticatorResponse, IAccountAuthenticator) are not in the lab's framework, so such a request fails with an AuthenticatorException
//    that says so, and the trace records it.

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
    const attribute = name => { const found = environment.getAttribute?.(root, name) ?? root?.attributes?.find(a => a.name === name) ?? null; return found ? found.value ?? found.rawValue ?? found.data ?? null : null; };
    const type = attribute('accountType'); if (typeof type !== 'string' || !type) continue;
    const custom = attribute('customTokens');
    out.push({ type, packageName: entry.name, service: detail.name, customTokens: custom === true || custom === 'true' || custom === -1 || custom === 1 });
  }
  return out;
}

export function createAccountStore({ packages, sameSigners = (a, b) => a === b, record = () => {} }) {
  const accounts = [];   // { name, type, password, userData: Map, tokens: Map, visibility: Map }
  let authenticators = null;
  const listeners = [];
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
    /** resolveAccountVisibility for package `caller` (its targetSdk and whether it holds GET_ACCOUNTS / GET_ACCOUNTS_PRIVILEGED). */
    visibleTo(account, caller, { targetSdk = 33, getAccounts = false, privileged = false } = {}) {
      if (store.owns(caller, account.type)) return true;
      const own = account.visibility.get(caller);
      if (own !== undefined && own !== VISIBILITY.UNDEFINED) return isVisible(own);
      if (privileged) return true;
      if (targetSdk < 26) { const legacy = account.visibility.get(LEGACY_VISIBLE) ?? VISIBILITY.UNDEFINED; return getAccounts && legacy !== VISIBILITY.NOT_VISIBLE && legacy !== VISIBILITY.USER_MANAGED_NOT_VISIBLE; }
      return isVisible(account.visibility.get(LEGACY_NOT_VISIBLE) ?? VISIBILITY.NOT_VISIBLE);
    },
  };
  return store;
}
