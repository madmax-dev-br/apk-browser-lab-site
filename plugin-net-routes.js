// The page's side of the plugin network routes (lab.route, src/network-routes.js, docs/PLUGINS.md "Network routes"): which plugin owns which route, the list the VM matches
// with (sent whole on every change and after each APK load), and the relay of a held request to its plugin and of the plugin's decision back to the VM. A plugin's routes go
// away when it stops (the VM then lets what they hold go on unchanged). DOM-free; no process.*.
export const MAX_ROUTES_PER_PLUGIN = 20;

/** vm: { setNetworkRoutes(list), netRouteDecision(rid, decision), worker }; deliver(pluginId, message) -> false when the plugin is gone; onChange(list) for the page. */
export function createPluginNetRoutes({ vm, deliver, onChange = () => {}, record = () => {} } = {}) {
  const routes = new Map();   // id -> { id, owner, ownerName, name, filter, hits, state, error }
  const held = new Map();     // rid -> owner (the plugin a held request was handed to)
  let syncing = Promise.resolve();
  const list = owner => [...routes.values()].filter(route => owner === undefined || owner === null || route.owner === owner).map(route => ({ id: route.id, name: route.name, filter: { ...route.filter }, state: route.state, hits: route.hits, ...(route.error ? { error: route.error } : {}) }));
  function sync() {
    const payload = [...routes.values()].map(({ id, owner, ownerName, name, filter }) => ({ id, owner, ownerName, name, filter }));
    syncing = syncing.catch(() => {}).then(async () => {
      if (!vm?.worker) { for (const route of routes.values()) route.state = 'waiting'; return []; }   // no VM yet: applied at the next load (attach)
      const statuses = await vm.setNetworkRoutes(payload);
      for (const status of statuses ?? []) { const route = routes.get(status.id); if (route) Object.assign(route, { state: status.state, hits: status.hits ?? route.hits, error: status.error ?? null }); }
      return statuses;
    });
    return syncing.finally(() => { try { onChange(list()); } catch { /* the page's problem */ } });
  }
  return {
    /** lab.route(filter, handler): a new route of `plugin` ({ id, name }); resolves with its status once the VM has it (an invalid filter rejects with the reason). */
    async add(plugin, { id, filter = {}, name = '' } = {}) {
      const key = `r${String(plugin.id).replace(/[^\w-]/g, '')}-${String(id ?? '').replace(/[^\w.-]/g, '')}`.slice(0, 80);
      if (!routes.has(key) && [...routes.values()].filter(route => route.owner === plugin.id).length >= MAX_ROUTES_PER_PLUGIN) throw Object.assign(new Error(`At most ${MAX_ROUTES_PER_PLUGIN} network routes per plugin.`), { code: 'bad-args' });
      const f = filter && typeof filter === 'object' ? filter : {};
      routes.set(key, { id: key, owner: plugin.id, ownerName: String(plugin.name ?? ''), name: String(name ?? '').slice(0, 120), filter: { method: f.method ?? 'ANY', url: f.url ?? '', query: f.query ?? 'ignore', bodyContains: f.bodyContains ?? '' }, hits: 0, state: 'pending', error: null });
      await sync();
      const route = routes.get(key);
      if (route?.state === 'invalid') { routes.delete(key); await sync(); throw Object.assign(new Error(`lab.route: ${route.error}`), { code: 'bad-args' }); }
      record(`plugin ${plugin.name}: network route ${route.filter.method} ${route.filter.url || '(every request)'} added`);
      return { id: key, state: route?.state ?? 'waiting' };
    },
    async remove(plugin, routeId) {
      const route = routes.get(String(routeId)); if (!route || route.owner !== plugin.id) return { removed: false };
      routes.delete(route.id); await sync(); record(`plugin ${plugin.name}: network route ${route.filter.method} ${route.filter.url || '(every request)'} removed`); return { removed: true };
    },
    /** The plugin stopped: its routes go (what they hold continues unchanged in the VM). */
    removeOwner(owner) {
      let any = false; for (const route of [...routes.values()]) if (route.owner === owner) { routes.delete(route.id); any = true; }
      for (const [rid, who] of held) if (who === owner) held.delete(rid);
      return any ? sync() : Promise.resolve();
    },
    list,
    get count() { return routes.size; },
    /** A new VM (APK load): the routes are sent again. */
    attach() { held.clear(); return routes.size ? sync() : Promise.resolve(); },
    /** Hit counts from a snapshot (snapshot.netRoutes). */
    update(described) { if (!Array.isArray(described)) return; for (const item of described) { const route = routes.get(item.id); if (route) route.hits = item.hits; } },
    /** A 'net-route' message from the VM: a held request (no phase) or the outcome of a decision / the real response of a fetch (phase). */
    fromVm(message) {
      const route = routes.get(String(message?.routeId ?? '')), owner = message?.phase ? held.get(message.rid) ?? route?.owner : route?.owner;
      if (!message?.phase) {
        if (!route || !deliver(route.owner, { ...message, routeId: route.id })) { vm.netRouteDecision(message.rid, { action: 'continue' }); return; }   // no plugin to ask: the request goes on unchanged
        held.set(message.rid, route.owner); return;
      }
      if (message.phase === 'done') held.delete(message.rid);
      if (owner && !deliver(owner, message) && message.phase === 'response') vm.netRouteDecision(message.rid, { action: 'continue' });
    },
    /** The plugin's decision (only for a request handed to that plugin). */
    decide(plugin, { rid, decision } = {}) {
      const who = held.get(Number(rid)); if (who !== plugin.id) throw Object.assign(new Error('This request is not held for this plugin (already decided, or its route was removed).'), { code: 'not-found' });
      vm.netRouteDecision(Number(rid), decision ?? { action: 'continue' }); return { ok: true };
    },
  };
}
