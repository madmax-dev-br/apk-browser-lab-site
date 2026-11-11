// android:networkSecurityConfig (res/xml): the cleartext part of Android's network security policy. <base-config>, <domain-config> (nested, includeSubdomains) and
// cleartextTrafficPermitted follow android.security.net.config.XmlConfigSource / NetworkSecurityConfig. Trust anchors (<trust-anchors>, <pin-set>, <debug-overrides>) are
// read as present but NOT enforced: certificate validation belongs to the browser until a TLS stack exists (task 22).
const boolean = (node, name, fallback) => {
  const attribute = node.attributes.find(a => a.name === name); if (!attribute) return fallback;
  if (attribute.kind === 'boolean') return !!attribute.value;
  const raw = attribute.rawValue ?? attribute.value;
  return raw === 'true' || raw === true || (typeof attribute.value === 'number' && attribute.value !== 0 && attribute.rawValue === null);
};

/** Parses the XML tree of a network_security_config file into { base, domains: [{ domain, includeSubdomains, cleartext }], hasTrustAnchors }. */
export function parseNetworkSecurityConfig(tree, defaultCleartext) {
  if (tree.name !== 'network-security-config') throw new Error(`network security config root is <${tree.name}>`);
  const base = tree.children.find(child => child.name === 'base-config'), result = { base: base ? boolean(base, 'cleartextTrafficPermitted', defaultCleartext) : defaultCleartext, domains: [], ignored: [] };
  const walk = (node, inherited) => {
    for (const child of node.children) {
      if (child.name === 'domain-config') {
        const cleartext = boolean(child, 'cleartextTrafficPermitted', inherited);
        for (const domain of child.children.filter(entry => entry.name === 'domain')) result.domains.push({ domain: (domain.text || '').trim().toLowerCase(), includeSubdomains: boolean(domain, 'includeSubdomains', false), cleartext, depth: result.domains.length });
        walk(child, cleartext);
      } else if (['trust-anchors', 'pin-set', 'debug-overrides'].includes(child.name)) result.ignored.push(child.name);
    }
  };
  walk(tree, result.base);
  for (const entry of (base?.children ?? [])) if (['trust-anchors', 'pin-set'].includes(entry.name)) result.ignored.push(entry.name);
  return result;
}

/** NetworkSecurityPolicy.isCleartextTrafficPermitted(host): the most specific matching domain-config wins (longer domain, then exact over wildcard), else base-config. */
export function cleartextPermittedFor(config, host) {
  const name = String(host).toLowerCase().replace(/\.$/, ''); let best = null;
  for (const entry of config.domains) {
    const exact = name === entry.domain, sub = entry.includeSubdomains && name.endsWith('.' + entry.domain);
    if (!exact && !sub) continue;
    if (!best || entry.domain.length > best.domain.length || (entry.domain.length === best.domain.length && exact && !best.exactMatch)) best = { ...entry, exactMatch: exact };
  }
  return best ? best.cleartext : config.base;
}
