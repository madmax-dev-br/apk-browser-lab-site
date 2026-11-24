// The "Package" window of the home screen's icon menu (hold an icon, right-click it, or press the context-menu key / Shift+F10 on it: src/task-switcher.js): what the open
// package is (name, id, version, sizes, ABIs and splits, permissions, components) and which Activity its icon opens. The Activities are a searchable list (type to filter,
// arrows to move, Enter to launch) instead of a <select>: "Launch" records the choice for the package and opens the app again from zero with it (the page's own reopen path).
// DOM built with the page's document; pure helpers exported for the tests. No process.*.

const PERMISSION_PREFIX = /^android\.permission\./;

/** The Activity the manifest opens from the launcher: the single MAIN/LAUNCHER one the loader found, else the first flagged as launcher, else null. */
export function defaultActivity(inventory) {
  if (inventory?.launcherActivity) return inventory.launcherActivity;
  const flagged = (inventory?.activities ?? []).find(activity => typeof activity === 'object' && activity?.launcher);
  return flagged?.name ?? null;
}

/** The manifest's Activities as rows of the list: { name, short, pkg, launcher, isDefault, isCurrent, alias, enabled, exported }. `current`: the Activity the icon opens now. */
export function activityRows(inventory, { current = null } = {}) {
  const fallback = defaultActivity(inventory), chosen = current ?? fallback, seen = new Set(), rows = [];
  for (const activity of inventory?.activities ?? []) {
    const name = typeof activity === 'string' ? activity : activity?.name; if (!name || seen.has(name)) continue; seen.add(name);
    const dot = name.lastIndexOf('.');
    rows.push({ name, short: dot >= 0 ? name.slice(dot + 1) : name, pkg: dot >= 0 ? name.slice(0, dot) : '', launcher: !!activity?.launcher, isDefault: name === fallback, isCurrent: name === chosen,
      alias: typeof activity?.alias === 'string' ? activity.alias : null, enabled: activity?.enabled ?? null, exported: activity?.exported ?? null });
  }
  return rows;
}

/** Rows whose name holds every word of the query (case-insensitive; dots and slashes count as separators in the query). An empty query keeps every row. */
export function filterActivities(rows, query) {
  const words = String(query ?? '').toLowerCase().split(/[\s/]+/).filter(Boolean); if (!words.length) return rows;
  return rows.filter(row => { const name = row.name.toLowerCase(); return words.every(word => name.includes(word)); });
}

const formatBytes = bytes => {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB']; let value = bytes, unit = 0; while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

/** What the window says about the package: { title, packageName, version, facts: [[label, value]], permissions: [names] }. `file`: { name, bytes } of the APK opened. */
export function packageFacts(inventory, { label = null, file = null } = {}) {
  const attrs = inventory?.manifestAttrs ?? {}, sdk = inventory?.usesSdk ?? {};
  const version = [attrs.versionName ? String(attrs.versionName) : null, attrs.versionCode !== undefined && attrs.versionCode !== null ? `code ${attrs.versionCode}` : null].filter(Boolean).join(' · ');
  const nativeBytes = (inventory?.nativeLibraryDetails ?? []).reduce((sum, lib) => sum + (lib.bytes || 0), 0);
  const abis = Object.keys(inventory?.nativeByABI ?? {}).sort();
  const splits = (inventory?.splits ?? []).map(split => split.name).filter(Boolean);
  const permissions = [...new Set((inventory?.usesPermissions ?? []).map(entry => entry?.name).filter(Boolean))].sort();
  const count = key => inventory?.[key]?.length ?? 0;
  const facts = [
    ['Version', version || 'not declared'],
    ['SDK', `min ${sdk.minSdkVersion ?? '—'} · target ${sdk.targetSdkVersion ?? sdk.minSdkVersion ?? '—'}`],
    ['File', file?.name ? `${file.name}${formatBytes(file.bytes) ? ` · ${formatBytes(file.bytes)}` : ''}` : null],
    ['Code', `${inventory?.dexFiles?.length ?? 0} DEX${formatBytes(inventory?.totalDexBytes) ? ` · ${formatBytes(inventory.totalDexBytes)}` : ''} · ${inventory?.classes ?? '—'} classes`],
    ['Native', inventory?.nativeLibraries?.length ? `${inventory.nativeLibraries.length} ${inventory.nativeLibraries.length === 1 ? 'library' : 'libraries'}${formatBytes(nativeBytes) ? ` · ${formatBytes(nativeBytes)}` : ''}` : 'none'],
    ['ABIs', abis.length ? abis.join(', ') : 'any (no native code)'],
    ['Splits', splits.length ? splits.join(', ') : 'none (a single APK)'],
    ['Components', [['activities', 'activity', 'activities'], ['services', 'service', 'services'], ['receivers', 'receiver', 'receivers'], ['providers', 'provider', 'providers']].map(([key, one, many]) => `${count(key)} ${count(key) === 1 ? one : many}`).join(' · ')],
    ['Permissions', permissions.length ? `${permissions.length} requested` : 'none requested'],
  ].filter(([, value]) => value !== null);
  return { title: label || inventory?.packageName || file?.name || 'Package', packageName: inventory?.packageName ?? null, version: attrs.versionName ? String(attrs.versionName) : null, facts, permissions };
}

/** Lists longer than this get a search box. */
export const SEARCH_FROM = 3;
let modalCounter = 0;
/**
 * Opens the window. options: { modalHost (src/lab-modal.js), doc, inventory, label, icon (URL or null), file: { name, bytes }, current (the Activity the icon opens now, or null
 * for the manifest's), busy() -> true while the page cannot start the app, onLaunch(name) (records the choice and opens the app with it) }. Returns the modal.
 */
export function openPackageModal({ modalHost, doc = globalThis.document, inventory, label = null, icon = null, file = null, current = null, busy = () => false, onLaunch = () => {} }) {
  const info = packageFacts(inventory, { label, file }), rows = activityRows(inventory, { current }), id = `pkg-${++modalCounter}`;
  const el = (tag, className, parent, text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; parent?.append(node); return node; };
  const root = el('div', 'pkg'), main = el('div', 'pkg-main', root);

  // who the package is
  const head = el('div', 'pkg-head', main), badge = el('span', 'pkg-icon', head);
  if (icon) { const img = el('img', '', badge); img.alt = ''; img.src = icon; } else badge.textContent = 'APK';
  const who = el('div', 'pkg-who', head);
  el('strong', 'pkg-name', who, info.title);
  if (info.packageName) el('code', 'pkg-id', who, info.packageName);
  const facts = el('dl', 'pkg-facts', main);
  for (const [term, value] of info.facts) { const row = el('div', 'pkg-fact', facts); el('dt', '', row, term); const [first, ...rest] = String(value).split(' · ').filter((part, at) => at === 0 || !/^0 /.test(part)); el('dd', '', row, first); if (rest.length) el('dd', 'pkg-fact-more', row, rest.join(' · ')); }
  // which Activity the icon opens
  const launch = el('section', 'pkg-launch', main);
  el('h3', 'pkg-launch-title', launch, rows.length > 1 ? `Launch activity (${rows.length})` : 'Launch activity');
  el('p', 'pkg-launch-note', launch, 'What the home-screen icon opens. Kept for this package until the page reloads.');
  const search = el('input', 'pkg-search', launch); search.type = 'search'; search.id = `${id}-search`; search.spellcheck = false; search.autocomplete = 'off';
  search.placeholder = `Search ${rows.length} ${rows.length === 1 ? 'activity' : 'activities'}`;
  search.setAttribute('role', 'combobox'); search.setAttribute('aria-label', 'Search activities'); search.setAttribute('aria-controls', `${id}-list`); search.setAttribute('aria-expanded', 'true'); search.setAttribute('aria-autocomplete', 'list');
  search.hidden = rows.length <= SEARCH_FROM;   // a short list is read at a glance: the list itself takes the keys
  const list = el('ul', 'pkg-activities', launch); list.tabIndex = search.hidden ? 0 : -1; list.id = `${id}-list`; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Activities');
  const empty = el('p', 'pkg-empty', launch); empty.hidden = true; empty.setAttribute('role', 'status');
  const actions = el('div', 'pkg-actions'), status = el('span', 'pkg-status', actions), go = el('button', 'cp-button primary pkg-go', actions, 'Launch'); go.type = 'button';
  status.setAttribute('aria-live', 'polite');

  if (info.permissions.length) {
    const more = el('details', 'pkg-perms', main); el('summary', '', more, `Requested permissions (${info.permissions.length})`);
    const list = el('ul', 'pkg-perm-list', more); for (const name of info.permissions) { const item = el('li', '', list, name.replace(PERMISSION_PREFIX, '')); item.title = name; }
  }

  root.append(actions);   // the foot stays in view while the rest scrolls

  let shown = rows, active = Math.max(0, rows.findIndex(row => row.isCurrent));
  const tag = (parent, text, kind) => el('span', `pkg-tag ${kind}`, parent, text);
  const render = () => {
    list.replaceChildren();
    shown.forEach((row, index) => {
      const item = el('li', 'pkg-activity', list); item.id = `${id}-opt-${index}`; item.setAttribute('role', 'option'); item.setAttribute('aria-selected', index === active ? 'true' : 'false'); item.dataset.name = row.name;
      if (index === active) item.classList.add('active');
      el('span', 'pkg-radio', item).setAttribute('aria-hidden', 'true');
      const text = el('span', 'pkg-activity-text', item); el('span', 'pkg-activity-short', text, row.short); if (row.pkg) el('span', 'pkg-activity-pkg', text, row.pkg);
      const tags = el('span', 'pkg-tags', item);
      if (row.isCurrent) tag(tags, 'opens now', 'current');
      if (row.isDefault) tag(tags, 'default', 'default'); else if (row.launcher) tag(tags, 'launcher', 'default');
      if (row.alias) tag(tags, 'alias', 'plain');
      if (row.enabled === false || row.enabled === 'false') tag(tags, 'disabled', 'plain');
      item.title = row.name;
      item.addEventListener('mousedown', event => event.preventDefault?.());   // the search keeps the focus (and the keyboard) while the list is clicked
      item.addEventListener('click', () => { active = index; render(); });
      item.addEventListener('dblclick', () => { active = index; render(); start(); });
    });
    const row = shown[active];
    for (const node of [search, list]) node.setAttribute('aria-activedescendant', row ? `${id}-opt-${active}` : '');
    list.querySelector?.('.active')?.scrollIntoView?.({ block: 'nearest' });
    empty.hidden = shown.length > 0 || !rows.length; empty.textContent = rows.length ? `No activity matches “${search.value}”.` : '';
    if (!rows.length) { empty.hidden = false; empty.textContent = 'The manifest declares no activity: the lab starts the first one it finds in the code.'; }
    go.disabled = !row || busy();
    status.textContent = row ? (row.isCurrent ? `The icon opens ${row.short}` : `Restarts the app with ${row.short}`) : '';
  };
  const start = () => {
    const row = shown[active]; if (!row || busy()) return;
    modal.close('launch'); onLaunch(row.name);
  };
  search.addEventListener('input', () => { shown = filterActivities(rows, search.value); const at = shown.findIndex(row => row.isCurrent); active = at >= 0 ? at : 0; render(); });
  for (const node of [search, list]) node.addEventListener('keydown', event => {
    const last = shown.length - 1, move = to => { event.preventDefault?.(); active = Math.max(0, Math.min(last, to)); render(); };
    if (event.key === 'ArrowDown') move(active + 1);
    else if (event.key === 'ArrowUp') move(active - 1);
    else if (event.key === 'PageDown') move(active + 8);
    else if (event.key === 'PageUp') move(active - 8);
    else if (event.key === 'Home' && event.ctrlKey) move(0);
    else if (event.key === 'End' && event.ctrlKey) move(last);
    else if (event.key === 'Enter') { event.preventDefault?.(); start(); }
  });
  go.addEventListener('click', start);
  render();
  const modal = modalHost.open({ title: 'Package', size: 'medium', content: root });
  modal.element.querySelector?.('.lab-modal')?.classList?.add('pkg-modal');
  (search.hidden ? list : search).focus?.();
  return Object.assign(modal, { search, list, refresh: render });
}
