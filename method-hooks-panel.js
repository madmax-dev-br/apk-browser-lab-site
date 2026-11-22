// "App modified" (CLAUDE.md, "method changes chosen by the user"): the page's list of every method change active in the VM -- the plugins' lab.hook changes (src/method-hooks.js)
// and the "Method returns" rows of Controls (src/overrides-panel.js), which live in the same registry of the Worker. A chip in the preview bar says how many there are and opens
// the list: method, kind, live call count, who made it, and a Remove button. Never shown while nothing is changed.
//
// It also keeps the plugins' side of the changes: lab.hook goes through add() (the Worker installs it and answers the whole list), lab.unhook through remove(), and a plugin
// that stops loses its changes (removeOwner). A change made with { persist: true } is kept here, per package, for the plugin's session: when the VM is replaced (the APK opened
// again, a restart after a crash) attach() installs it again, with the same id, before the app's code runs; a change without persist ends with the VM it was made in.
// The counts come back with every snapshot (snapshot.methodHooks) and with every reply. No timer, no VM message while nothing is changed. DOM only through `$` and document.

const KIND_TEXT = { returns: 'fixed return', throws: 'throws', observe: 'observed', smali: 'smali body' };
/** The owner of the changes made in the Code browser (src/code-browser.js): its method edits are smali hooks of this owner, its file edits the `files` rows. */
export const CODE_BROWSER = Object.freeze({ id: 'code-browser', name: 'Code browser' });
export function createMethodHooksPanel({ $, vm, trace = () => {}, removePageRow = null, getPackage = () => null, removeFile = null, documentRef = globalThis.document } = {}) {
  const S = { hooks: [], files: [], persisted: new Map(), failures: new Map(), seq: 0, open: false };
  const chip = () => $('app-modified'), panel = () => $('app-modified-panel'), list = () => $('app-modified-list');
  const ownerLabel = hook => hook.owner === 'page' ? 'Method returns (page)' : hook.plugin?.id === CODE_BROWSER.id ? CODE_BROWSER.name : hook.plugin?.id === 'mcp' ? 'MCP' : `plugin ${hook.plugin?.name ?? '?'}`;
  const pluginOf = hook => hook.owner === 'plugin' ? hook.plugin?.id ?? null : null;
  const hitsText = hook => `${hook.hits} ${hook.hits === 1 ? 'call' : 'calls'}${hook.dropped ? ` (${hook.dropped} not delivered)` : ''}`;

  function render() {
    const c = chip(), p = panel(), l = list(); if (!c || !p || !l) return;
    const count = S.hooks.length + S.files.length, failed = [...S.failures.values()];
    c.hidden = !count && !failed.length;
    c.textContent = `App modified · ${count}`; c.title = count ? `${count} change${count === 1 ? '' : 's'} chosen by the user ${count === 1 ? 'is' : 'are'} active (methods and APK files): click for the list` : 'A persistent method change could not be applied again: click for the reason';
    c.setAttribute('aria-expanded', String(S.open && !c.hidden));
    p.hidden = !S.open || c.hidden;
    if (p.hidden) { S.rowsKey = null; return; }
    // the same changes as the rows on screen (a snapshot with new counts): only the counts are written, so a Remove button under the pointer is never replaced mid-click
    const key = JSON.stringify([S.hooks.map(hook => [hook.id, hook.kind, hook.method, hook.value ?? null]), failed.map(failure => [failure.id, failure.error]), S.files.map(file => [file.path, file.bytes])]);
    if (key === S.rowsKey && l.children.length === S.hooks.length + failed.length + S.files.length) { S.hooks.forEach((hook, index) => { const hits = l.children[index]?.children?.[2]; if (hits) hits.textContent = hitsText(hook); }); return; }
    S.rowsKey = key;
    const rows = S.hooks.map(hook => {
      const li = documentRef.createElement('li'); li.className = 'am-row'; li.dataset.kind = hook.kind;
      const method = documentRef.createElement('code'); method.className = 'am-method'; method.textContent = hook.method; method.title = hook.declaredIn ? `declared in ${hook.declaredIn}` : hook.method;
      const kind = documentRef.createElement('span'); kind.className = 'am-kind'; kind.textContent = `${KIND_TEXT[hook.kind] ?? hook.kind}${hook.kind === 'returns' ? ` ${hook.value}` : hook.kind === 'throws' ? ` ${hook.throws}` : ''}${hook.framework ? ' · framework' : ''}${hook.persist ? ' · persists' : ''}`;
      const hits = documentRef.createElement('span'); hits.className = 'am-hits'; hits.textContent = hitsText(hook);
      const owner = documentRef.createElement('span'); owner.className = 'am-owner'; owner.textContent = ownerLabel(hook);
      const remove = documentRef.createElement('button'); remove.type = 'button'; remove.className = 'cp-button am-remove'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove the change of ${hook.method}`);
      remove.addEventListener('click', () => { removeFromPage(hook).catch(error => trace(`App modified: could not remove ${hook.method}: ${error?.message ?? error}`)); });
      li.append(method, kind, hits, owner, remove); return li;
    });
    for (const failure of failed) {
      const li = documentRef.createElement('li'); li.className = 'am-row am-failed';
      const method = documentRef.createElement('code'); method.className = 'am-method'; method.textContent = failure.method;
      const why = documentRef.createElement('span'); why.className = 'am-kind'; why.textContent = `not applied again: ${failure.error}`;
      const owner = documentRef.createElement('span'); owner.className = 'am-owner'; owner.textContent = `plugin ${failure.owner.name}`;
      const remove = documentRef.createElement('button'); remove.type = 'button'; remove.className = 'cp-button am-remove'; remove.textContent = 'Forget';
      remove.addEventListener('click', () => { S.persisted.delete(failure.id); S.failures.delete(failure.id); render(); });
      li.append(method, why, owner, remove); rows.push(li);
    }
    for (const file of S.files) {
      const li = documentRef.createElement('li'); li.className = 'am-row am-file'; li.dataset.kind = 'file';
      const path = documentRef.createElement('code'); path.className = 'am-method'; path.textContent = file.path;
      const kind = documentRef.createElement('span'); kind.className = 'am-kind'; kind.textContent = 'edited file';
      const size = documentRef.createElement('span'); size.className = 'am-hits'; size.textContent = `${file.bytes} bytes (APK: ${file.originalBytes})`;
      const owner = documentRef.createElement('span'); owner.className = 'am-owner'; owner.textContent = file.by ?? CODE_BROWSER.name;
      const remove = documentRef.createElement('button'); remove.type = 'button'; remove.className = 'cp-button am-remove'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Restore the APK's ${file.path}`);
      remove.addEventListener('click', () => { Promise.resolve(removeFile?.(file.path)).catch(error => trace(`App modified: could not restore ${file.path}: ${error?.message ?? error}`)); });
      li.append(path, kind, size, owner, remove); rows.push(li);
    }
    l.replaceChildren(...rows);
  }
  function setHooks(hooks) { S.hooks = Array.isArray(hooks) ? hooks : []; render(); }
  async function removeFromPage(hook) {
    if (hook.owner === 'page') { if (typeof removePageRow !== 'function') throw new Error('the Method returns rows are not on this page'); removePageRow(hook.method); trace(`App modified: the Method returns row of ${hook.method} was removed from the page`); return; }
    await remove(hook.id); trace(`App modified: ${KIND_TEXT[hook.kind] ?? hook.kind} of ${hook.method} (${ownerLabel(hook)}) removed from the page`);
  }
  async function remove(id, { owner = null } = {}) {
    const key = String(id ?? ''), persisted = S.persisted.get(key);
    if (owner !== null && persisted && persisted.owner.id !== owner) throw Object.assign(new Error(`change ${key} belongs to plugin ${persisted.owner.name}`), { code: 'bad-args' });
    S.persisted.delete(key); const hadFailure = S.failures.delete(key);
    if (!vm?.worker) { render(); return { removed: !!persisted || hadFailure }; }
    const reply = await vm.methodHooks('remove', { id: key, owner });
    setHooks(reply.hooks);
    return { removed: !!reply.removed || hadFailure };
  }
  if (chip()) chip().addEventListener('click', () => { S.open = !S.open; render(); });

  return {
    /** lab.hook: installs the change in the VM; resolves the change as the Worker describes it. `owner`: { id, name } of the plugin. */
    async add(owner, spec) {
      if (!vm?.worker) throw Object.assign(new Error('No app is running: open an APK first.'), { code: 'no-apk' });
      const id = `h${++S.seq}`, packageName = getPackage() ?? null, clean = JSON.parse(JSON.stringify(spec ?? {}, (key, value) => typeof value === 'bigint' ? { long: String(value) } : value));
      const reply = await vm.methodHooks('add', { spec: clean, owner: { id: String(owner?.id ?? ''), name: String(owner?.name ?? 'plugin') }, id });
      if (clean.persist === true) S.persisted.set(id, { id, owner: { id: String(owner.id), name: String(owner.name) }, spec: clean, packageName, method: reply.hook.method });
      setHooks(reply.hooks);
      trace(`${owner?.id === CODE_BROWSER.id ? CODE_BROWSER.name : `Plugin ${owner?.name}`}: app modified, ${KIND_TEXT[reply.hook.kind] ?? reply.hook.kind} of ${reply.hook.method}${reply.hook.kind === 'returns' ? ` = ${reply.hook.value}` : ''} (${id}${clean.persist ? ', persists' : ''})`);
      return reply.hook;
    },
    /** lab.unhook (owner: the plugin that asks; null from the page). */
    async remove(id, { owner = null } = {}) { const out = await remove(id, { owner }); if (out.removed) trace(`App modified: change ${id} removed${owner ? ` by its plugin` : ''}`); return out; },
    /** A plugin stopped (or was removed): its changes go, persistent ones included. */
    async removeOwner(ownerId) {
      const id = String(ownerId ?? ''); let forgotten = 0;
      for (const [key, entry] of S.persisted) if (entry.owner.id === id) { S.persisted.delete(key); S.failures.delete(key); forgotten++; }
      if (!vm?.worker || !S.hooks.some(hook => pluginOf(hook) === id)) { render(); return { removed: 0, forgotten }; }
      const reply = await vm.methodHooks('remove-owner', { owner: id });
      setHooks(reply.hooks); if (reply.removed) trace(`App modified: ${reply.removed} change${reply.removed === 1 ? '' : 's'} of a stopped plugin removed`);
      return { removed: reply.removed, forgotten };
    },
    /** lab.hooks: the changes of the VM with their live counts (only the plugin's own with `owner`), plus its persistent ones that could not be applied again (state 'failed'). */
    async list({ owner = null } = {}) {
      if (vm?.worker) { try { setHooks((await vm.methodHooks('list')).hooks); } catch { /* the last list known */ } }
      const out = S.hooks.filter(hook => owner === null || pluginOf(hook) === owner).map(hook => ({ ...hook, state: 'active' }));
      for (const failure of S.failures.values()) if (owner === null || failure.owner.id === owner) out.push({ id: failure.id, method: failure.method, kind: failure.spec.kind, owner: 'plugin', plugin: failure.owner, persist: true, state: 'failed', error: failure.error, hits: 0 });
      return out;
    },
    /** The live list of a snapshot (snapshot.methodHooks: absent when nothing is changed). */
    update(hooks) { const next = Array.isArray(hooks) ? hooks : []; if (!next.length && !S.hooks.length) return; setHooks(next); },
    /** Drops a change from the ones re-applied after a reload (it was replaced by a newer change of the same method, which has its own entry). */
    forget(id) { S.persisted.delete(String(id)); S.failures.delete(String(id)); },
    /** The APK files the user edited (src/code-service.js fileEdits): [{ path, bytes, originalBytes, by }], listed with the method changes. */
    setFiles(files) { S.files = Array.isArray(files) ? files : []; render(); },
    /** The VM ended (another APK, a new run): its changes ended with it; persistent ones wait for attach(). */
    vmEnded() { S.hooks = []; S.files = []; S.failures.clear(); render(); },
    /** A new VM of `inventory.packageName` is loaded, before the app's code runs: the persistent changes made for that package are installed again, with their ids. */
    async attach(inventory) {
      const pkg = inventory?.packageName ?? null; let applied = 0;
      for (const entry of [...S.persisted.values()]) {
        if (entry.packageName !== pkg || !vm?.worker) continue;
        try { const reply = await vm.methodHooks('add', { spec: entry.spec, owner: entry.owner, id: entry.id }); setHooks(reply.hooks); applied++; S.failures.delete(entry.id); }
        catch (error) { S.failures.set(entry.id, { ...entry, error: String(error?.message ?? error).slice(0, 400) }); trace(`App modified: the persistent change ${entry.id} of plugin ${entry.owner.name} (${entry.method}) was not applied again: ${error?.message ?? error}`); }
      }
      if (applied) trace(`App modified: ${applied} persistent change${applied === 1 ? '' : 's'} applied again before the app started`);
      render();
      return applied;
    },
    /** For lab_status (MCP) and the diagnostics: { count, calls, changes }. */
    summary() { return { count: S.hooks.length + S.files.length, ...(S.files.length ? { files: S.files.map(file => ({ path: file.path, bytes: file.bytes, originalBytes: file.originalBytes, by: file.by ?? CODE_BROWSER.name })) } : {}), calls: S.hooks.reduce((sum, hook) => sum + (hook.hits ?? 0), 0), changes: S.hooks.map(hook => ({ id: hook.id, method: hook.method, kind: hook.kind, detail: hook.detail, hits: hook.hits, by: ownerLabel(hook), ...(hook.dropped ? { dropped: hook.dropped } : {}) })), ...(S.failures.size ? { failed: [...S.failures.values()].map(f => ({ id: f.id, method: f.method, error: f.error })) } : {}) }; },
    /** How many changes the plugins made (the report header; the page's rows are counted by the Method returns section). */
    pluginCount() { return S.hooks.filter(hook => hook.owner === 'plugin').length; },
    get state() { return S; },
  };
}
