// android:networkSecurityConfig (res/xml): Android's network security policy as android.security.net.config.XmlConfigSource / NetworkSecurityConfig (android-13.0.0_r1) read it.
// <base-config>, <domain-config> (nested, includeSubdomains), cleartextTrafficPermitted, <trust-anchors> (<certificates src="system|user|@raw/..." overridePins>), <pin-set>
// (<pin digest="SHA-256">, expiration) and <debug-overrides> (its anchors are added to every config of a debuggable app). A nested config inherits what it does not set from its
// parent, the base config from the platform default (NetworkSecurityConfig.getDefaultBuilder: system anchors, plus user anchors for an app targeting API 23 or lower).
// The trust part is enforced by the default TrustManager (src/security-host.js, over Conscrypt's TrustManagerImpl).
const boolean = (node, name, fallback) => {
  const attribute = node.attributes.find(a => a.name === name); if (!attribute) return fallback;
  if (attribute.kind === 'boolean') return !!attribute.value;
  const raw = attribute.rawValue ?? attribute.value;
  return raw === 'true' || raw === true || (typeof attribute.value === 'number' && attribute.value !== 0 && attribute.rawValue === null);
};
const attributeOf = (node, name) => node.attributes.find(a => a.name === name) ?? null;

/** <trust-anchors>: [{ source: 'system' | 'user' | { resource: id, name }, overridePins }]. XmlConfigSource rejects an unknown src string. */
function trustAnchors(node, location) {
  const anchors = [];
  for (const child of node.children) {
    if (child.name !== 'certificates') throw new Error(`${location}: <${child.name}> in <trust-anchors> (only <certificates> is allowed)`);
    const src = attributeOf(child, 'src'); if (!src) throw new Error(`${location}: <certificates> without src`);
    const overridePins = boolean(child, 'overridePins', false);
    if (src.kind === 'reference' && typeof src.value === 'number') anchors.push({ source: { resource: src.value >>> 0, name: src.rawValue ?? null }, overridePins });
    else {
      const value = String(src.rawValue ?? src.value ?? '').trim();
      if (value !== 'system' && value !== 'user') throw new Error(`${location}: unknown certificates src ${value}`);
      anchors.push({ source: value, overridePins });
    }
  }
  return anchors;
}
/** <pin-set expiration="yyyy-MM-dd">: { pins: [base64 SHA-256 of a SubjectPublicKeyInfo], expiration: ms or null }. Only SHA-256 digests exist (XmlConfigSource). */
function pinSet(node, location) {
  const expiration = attributeOf(node, 'expiration'), pins = [];
  for (const child of node.children) {
    if (child.name !== 'pin') throw new Error(`${location}: <${child.name}> in <pin-set>`);
    const digest = String(attributeOf(child, 'digest')?.rawValue ?? attributeOf(child, 'digest')?.value ?? '');
    if (digest !== 'SHA-256') throw new Error(`${location}: unsupported pin digest ${digest}`);
    const value = (child.text || '').trim(); if (decodedLength(value) !== 32) throw new Error(`${location}: invalid pin digest`);
    pins.push(value);
  }
  let until = null;
  if (expiration) { const text = String(expiration.rawValue ?? expiration.value); const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text); if (!m) throw new Error(`${location}: invalid pin-set expiration ${text}`); until = Date.UTC(+m[1], +m[2] - 1, +m[3]); }
  return { pins, expiration: until };
}
const decodedLength = base64 => { try { return atob(base64).length; } catch { return -1; } };

/**
 * Parses the XML tree of a network_security_config file into { base, domains: [{ domain, includeSubdomains, cleartext, anchors, pins }], baseAnchors, debugAnchors, ignored }.
 * `anchors` is null where the platform default applies (no <trust-anchors> on the way up); `pins` null when no <pin-set> applies.
 */
export function parseNetworkSecurityConfig(tree, defaultCleartext) {
  if (tree.name !== 'network-security-config') throw new Error(`network security config root is <${tree.name}>`);
  const base = tree.children.find(child => child.name === 'base-config'), result = { base: base ? boolean(base, 'cleartextTrafficPermitted', defaultCleartext) : defaultCleartext, domains: [], ignored: [], baseAnchors: null, debugAnchors: null };
  if (base) for (const entry of base.children) {
    if (entry.name === 'trust-anchors') result.baseAnchors = trustAnchors(entry, '<base-config>');
    else if (entry.name === 'pin-set') throw new Error('<base-config>: <pin-set> is not allowed here');
  }
  const debug = tree.children.find(child => child.name === 'debug-overrides');
  if (debug) { const anchors = debug.children.find(child => child.name === 'trust-anchors'); result.debugAnchors = anchors ? trustAnchors(anchors, '<debug-overrides>') : []; }
  const walk = (node, inherited) => {
    for (const child of node.children) {
      if (child.name !== 'domain-config') continue;
      const cleartext = boolean(child, 'cleartextTrafficPermitted', inherited.cleartext);
      const anchorsNode = child.children.find(entry => entry.name === 'trust-anchors'), pinsNode = child.children.find(entry => entry.name === 'pin-set');
      const own = { cleartext, anchors: anchorsNode ? trustAnchors(anchorsNode, '<domain-config>') : inherited.anchors, pins: pinsNode ? pinSet(pinsNode, '<domain-config>') : inherited.pins };
      for (const domain of child.children.filter(entry => entry.name === 'domain')) result.domains.push({ domain: (domain.text || '').trim().toLowerCase(), includeSubdomains: boolean(domain, 'includeSubdomains', false), cleartext, anchors: own.anchors, pins: own.pins, depth: result.domains.length });
      walk(child, own);
    }
  };
  walk(tree, { cleartext: result.base, anchors: result.baseAnchors, pins: null });
  return result;
}

/** The most specific matching domain-config (longer domain, then exact over wildcard), or null. */
export function domainConfigFor(config, host) {
  const name = String(host).toLowerCase().replace(/\.$/, ''); let best = null;
  for (const entry of config.domains) {
    const exact = name === entry.domain, sub = entry.includeSubdomains && name.endsWith('.' + entry.domain);
    if (!exact && !sub) continue;
    if (!best || entry.domain.length > best.domain.length || (entry.domain.length === best.domain.length && exact && !best.exactMatch)) best = { ...entry, exactMatch: exact };
  }
  return best;
}
/** NetworkSecurityPolicy.isCleartextTrafficPermitted(host): the most specific matching domain-config wins, else base-config. */
export function cleartextPermittedFor(config, host) {
  const best = domainConfigFor(config, host);
  return best ? best.cleartext : config.base;
}

/** NetworkSecurityConfig.getDefaultBuilder(targetSdk): system anchors, and user anchors for an app targeting API 23 or lower (TARGET_SDK < N). */
export const defaultTrustAnchors = targetSdk => targetSdk <= 23 ? [{ source: 'system', overridePins: false }, { source: 'user', overridePins: false }] : [{ source: 'system', overridePins: false }];

/**
 * The trust configuration that applies to `host` (null: the base config): { anchors, pins }. A debuggable app adds the <debug-overrides> anchors to every config
 * (ManifestConfigSource / XmlConfigSource with debugBuild), as Android does.
 */
export function trustConfigFor(config, host, { targetSdk, debuggable = false }) {
  const domain = config && host !== null && host !== undefined ? domainConfigFor(config, host) : null;
  let anchors = domain?.anchors ?? config?.baseAnchors ?? defaultTrustAnchors(targetSdk);
  if (debuggable && config?.debugAnchors?.length) anchors = [...anchors, ...config.debugAnchors];
  return { anchors, pins: domain?.pins ?? null, domain: domain?.domain ?? null };
}
