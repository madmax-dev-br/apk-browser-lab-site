// The "Blocked calls" section of the Controls panel (src/blocked-calls.js): the rules of the open package that stop a network call before it is made, one line each (switch, scope,
// method and URL pattern or host, hits; the fields show when the row is expanded; Move / Remove in the row's menu). Rules are kept per package in localStorage (every access guarded) and
// applied live to the Worker; hit counts come back with every snapshot. Every change is written to the trace: a rule the user adds changes what the app sees, so the page says so.
// Off by default and empty: the lab ships no rule and never suggests one. The Network panel's context menu (Ignore this endpoint / Ignore this host) and the MCP tools use the same list.
import { BLOCK_SCOPES, MAX_BLOCKS, defaultBlock, normalizeBlock, validateBlock, loadBlocks, saveBlocks, blockLabel, blockRuleOf, findBlock } from './blocked-calls.js?v=df19921e3eea';
import { MOCK_METHODS } from './endpoint-mocks.js?v=df19921e3eea';
import { listRow } from './list-rows.js?v=df19921e3eea';

const SAVE_DELAY_MS = 150;

export function createBlockedCallsPanel({ $, vm, trace = () => {} }) {
  const S = { pkg: null, rules: [], statuses: new Map(), hits: new Map(), sequence: 0, timer: null, saveTimer: null, expanded: new Set(), storageNote: '' };
  const doc = $('bc-list').ownerDocument ?? document;
  const el = (tag, className, text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const checkOf = rule => validateBlock(rule);
  const isActive = rule => rule.enabled && !checkOf(rule).errors.length && S.statuses.get(rule.id)?.state !== 'invalid';
  const hitsOf = rule => S.hits.get(rule.id) ?? S.statuses.get(rule.id)?.hits ?? 0;
  const problem = rule => { const errors = checkOf(rule).errors; return errors.length ? errors.map(e => e.message).join(' ') : S.statuses.get(rule.id)?.state === 'invalid' ? S.statuses.get(rule.id).error : ''; };
  const targetText = rule => rule.scope === 'host' ? rule.host.trim() || 'New host rule' : `${rule.method} ${rule.url.trim() || 'New endpoint rule'}`;
  const hitText = count => `${count} ${count === 1 ? 'call' : 'calls'} stopped`;

  function updateMeta() {
    [...$('bc-list').children].forEach((li, index) => {
      const rule = S.rules[index]; if (!rule) return;
      const error = problem(rule), count = hitsOf(rule), hits = li.querySelector('.bc-hits'), dot = li.querySelector('.bc-dot'), info = li.querySelector('.bc-meta');
      li.querySelector('.bc-target').textContent = targetText(rule);
      if (hits) { hits.textContent = String(count); hits.title = hitText(count); hits.hidden = !count; }
      if (dot) { dot.dataset.state = error ? 'error' : isActive(rule) ? 'ok' : ''; dot.textContent = error ? '!' : ''; dot.title = error || (rule.enabled ? 'Active' : 'Off'); }
      if (info) { info.textContent = error || (rule.enabled ? '' : 'Off.'); info.dataset.state = error ? 'error' : ''; }
      li.dataset.state = error ? 'error' : '';
    });
    const active = S.rules.filter(isActive), stopped = active.reduce((sum, rule) => sum + hitsOf(rule), 0);
    $('bc-summary').textContent = `${active.length} active`;
    $('bc-status').textContent = S.storageNote || (!S.rules.length ? (S.pkg ? 'No rules. A rule stops the app\'s calls to an endpoint or a host: they fail at once and are never made.' : 'Open an APK: rules are kept per app.')
      : active.length ? (stopped ? `${stopped} ${stopped === 1 ? 'call' : 'calls'} stopped by your rules.` : '') : 'No rule is on.');
    $('bc-status').dataset.empty = String(!S.rules.length);
    $('bc-list').hidden = !S.rules.length;
  }
  function field(label, input) { const wrap = el('label', 'hm-field'); wrap.append(el('span', 'hm-field-name', label), input); return wrap; }
  function details(rule, index) {
    const n = index + 1, metaId = `bc-meta-${rule.id}`, fields = el('div', 'hm-fields');
    if (rule.scope === 'host') {
      const host = el('input', 'bc-host'); host.type = 'text'; host.value = rule.host; host.placeholder = 'api.example.com, *.example.com or api.example.com:8443'; host.spellcheck = false; host.autocomplete = 'off'; host.autocapitalize = 'off';
      host.setAttribute('aria-label', `Host of rule ${n}`); host.setAttribute('aria-describedby', metaId);
      host.addEventListener('input', () => { rule.host = host.value; changed(); });
      fields.append(field('Host (every method, scheme, path and port unless one is given)', host));
    } else {
      const method = el('select', 'bc-method'); for (const name of MOCK_METHODS) method.append(Object.assign(el('option'), { value: name, textContent: name === 'ANY' ? 'Any (ANY)' : name })); method.value = rule.method; method.setAttribute('aria-label', `Method of rule ${n}`);
      const url = el('input', 'bc-url'); url.type = 'text'; url.value = rule.url; url.placeholder = 'https://api.example.com/v1/users/* or /v1/users/*'; url.spellcheck = false; url.autocomplete = 'off'; url.autocapitalize = 'off';
      url.setAttribute('aria-label', `URL or path of rule ${n}`); url.setAttribute('aria-describedby', metaId);
      const query = el('select', 'bc-query'); query.append(Object.assign(el('option'), { value: 'ignore', textContent: 'Ignore' }), Object.assign(el('option'), { value: 'exact', textContent: 'Exact' })); query.value = rule.query; query.setAttribute('aria-label', `Query of rule ${n}`);
      method.addEventListener('change', () => { rule.method = method.value; changed(); }); url.addEventListener('input', () => { rule.url = url.value; changed(); }); query.addEventListener('change', () => { rule.query = query.value; changed(); });
      fields.append(field('Method', method), field('URL or path (same patterns as the endpoint mocks)', url), field('Query', query));
    }
    const info = el('p', 'hm-meta bc-meta'); info.id = metaId; const error = problem(rule); info.textContent = error || (rule.enabled ? '' : 'Off.'); info.dataset.state = error ? 'error' : '';
    return [fields, info];
  }
  function render() {
    $('bc-list').replaceChildren(...S.rules.map((rule, index) => {
      const n = index + 1;
      const main = [el('b', 'bc-scope', rule.scope === 'host' ? 'HOST' : 'ENDPOINT'), el('code', 'lr-text bc-target', targetText(rule))];
      const hits = el('span', 'lr-count bc-hits'); hits.setAttribute('role', 'status'); hits.setAttribute('aria-live', 'polite'); const dot = el('span', 'lr-dot bc-dot');
      const li = listRow({
        doc, key: `bc-${rule.id}`, label: `blocked call rule ${n}`, switchLabel: `Turn on blocked call rule ${n}`, checked: rule.enabled,
        onToggle: on => { rule.enabled = on; changed(true, `${on ? 'on' : 'off'}: ${blockLabel(rule)}`); },
        main, trail: [hits, dot], expanded: S.expanded.has(rule.id),
        onExpand: open => { if (open) S.expanded.add(rule.id); else S.expanded.delete(rule.id); updateMeta(); },
        details: () => details(rule, S.rules.indexOf(rule)),
        menu: () => [
          { label: 'Edit', run: () => openRow(index) },
          { label: 'Move up', run: () => move(index, -1), disabled: index === 0 },
          { label: 'Move down', run: () => move(index, 1), disabled: index === S.rules.length - 1 },
          { label: 'Remove', danger: true, run: () => removeAt(index) },
        ],
      });
      li.classList.add('bc-row'); li.dataset.id = rule.id; return li;
    }));
    updateMeta();
  }
  function openRow(index) {
    const rule = S.rules[index]; if (!rule) return null;
    S.expanded.add(rule.id); render();
    const target = $('bc-list').children[index]?.querySelector('.bc-url, .bc-host'); target?.scrollIntoView?.({ block: 'center' }); target?.focus?.(); return target;
  }
  function move(index, by) {
    const to = index + by; if (to < 0 || to >= S.rules.length) return;
    const [item] = S.rules.splice(index, 1); S.rules.splice(to, 0, item); render(); changed(true, `order: ${blockLabel(item)}`);
    $('bc-list').children[to]?.querySelector('.lr-more')?.focus();
  }
  function removeAt(index) {
    const [gone] = S.rules.splice(index, 1); if (gone) S.expanded.delete(gone.id); render(); changed(true, gone ? `removed: ${blockLabel(gone)}` : '');
    ($('bc-list').children[Math.min(index, S.rules.length - 1)]?.querySelector('.lr-main') ?? $('bc-add-endpoint')).focus();
  }
  /** `said`: what the trace says about this change (a typed field says nothing until the row is left: its text is not a decision yet). */
  function changed(now = false, said = '') {
    scheduleSave(now); updateMeta(); clearTimeout(S.timer); S.timer = setTimeout(apply, now ? 0 : 300);
    if (said) trace(`Blocked calls: ${said}`);
  }
  async function apply() {
    const token = ++S.sequence;
    try {
      const statuses = vm.worker ? await vm.setBlockedCalls(S.rules.map(normalizeBlock)) : [];
      if (token !== S.sequence) return;
      S.statuses = new Map(statuses.map(status => [status.id, status])); for (const status of statuses) S.hits.set(status.id, status.hits);
    } catch (error) { for (const rule of S.rules) S.statuses.set(rule.id, { id: rule.id, state: 'invalid', error: `The VM did not apply it: ${error?.message ?? error}` }); }
    updateMeta();
  }
  function scheduleSave(now) { clearTimeout(S.saveTimer); if (S.pkg) S.saveTimer = setTimeout(persist, now ? 0 : SAVE_DELAY_MS); }
  function persist() {
    S.saveTimer = null; const pkg = S.pkg; if (!pkg) return;
    const note = saveBlocks(pkg, S.rules) ? '' : 'The browser storage is full or unavailable: these rules last until the page closes.';
    if (pkg === S.pkg && note !== S.storageNote) { S.storageNote = note; updateMeta(); }
  }
  /** Adds a rule: { scope, method, url, host, name, enabled }. -> { id, errors } (nothing is added with errors). */
  function add(raw, { open = false } = {}) {
    if (!S.pkg) return { id: null, errors: [{ field: 'pkg', message: 'Open an APK: rules are kept per app.' }] };
    const rule = normalizeBlock({ ...defaultBlock(raw?.scope), ...raw }), { errors } = validateBlock(rule); if (errors.length) return { id: null, errors };
    if (S.rules.length >= MAX_BLOCKS) return { id: null, errors: [{ field: 'list', message: `At most ${MAX_BLOCKS} rules.` }] };
    const at = S.rules.findIndex(item => item.id === rule.id); if (at >= 0) S.rules[at] = rule; else S.rules.push(rule);
    render(); changed(true, `${rule.enabled ? 'on' : 'off'}: ${blockLabel(rule)} (${rule.scope}) -- the app's calls that match fail at once and are not made`);
    if (open) openRow(S.rules.indexOf(rule));
    return { id: rule.id, errors: [] };
  }
  function addEmpty(scope) {
    if (!S.pkg) { $('bc-status').textContent = 'Open an APK: rules are kept per app.'; return; }
    if (S.rules.length >= MAX_BLOCKS) { $('bc-status').textContent = `At most ${MAX_BLOCKS} rules.`; return; }
    const rule = { ...defaultBlock(scope), enabled: false }; S.rules.push(rule); S.expanded.add(rule.id); render(); openRow(S.rules.length - 1);   // off until it is typed: an empty rule stops nothing
    scheduleSave(); trace(`Blocked calls: a new ${scope} rule (off until you type it)`);
  }
  $('bc-add-endpoint').addEventListener('click', () => addEmpty('endpoint'));
  $('bc-add-host').addEventListener('click', () => addEmpty('host'));
  render();

  return {
    /** The APK was inspected: load this package's rules and give them to the VM before the app runs. */
    async attach(inventory) {
      S.pkg = inventory?.packageName ?? null; S.rules = S.pkg ? loadBlocks(S.pkg) : []; S.statuses = new Map(); S.hits = new Map(); S.storageNote = ''; render();
      if (S.rules.length) { clearTimeout(S.timer); await apply(); }
    },
    detach() { if (S.saveTimer) { clearTimeout(S.saveTimer); persist(); } S.pkg = null; S.rules = []; S.statuses = new Map(); S.hits = new Map(); clearTimeout(S.timer); render(); },   // a change still waiting to be written is written now
    /** Live counts of the Worker's snapshot ([{ id, hits, active }]). */
    hits(entries) { if (!Array.isArray(entries)) return; let any = false; for (const entry of entries) if (S.hits.get(entry.id) !== entry.hits) { S.hits.set(entry.id, entry.hits); any = true; } if (any) updateMeta(); },
    activeCount() { return S.rules.filter(isActive).length; },
    /** The Network panel's menu: is there a rule for this endpoint / host of the entry? */
    has(scope, entry) { return S.pkg ? findBlock(S.rules, blockRuleOf(scope, entry)) >= 0 : false; },
    /** "Ignore this endpoint" / "Ignore this host" (and "Stop ignoring"): adds the rule, or removes the identical one. */
    toggle(scope, entry) {
      const rule = blockRuleOf(scope, entry), at = S.pkg ? findBlock(S.rules, rule) : -1;
      if (at >= 0) { removeAt(at); return { removed: true }; }
      const result = add({ ...rule, name: '' }); if (result.errors.length) { $('bc-status').textContent = result.errors.map(e => e.message).join(' '); return { removed: false, errors: result.errors }; }
      return { removed: false, id: result.id };
    },
    add: raw => add(raw),
    remove(id) { const at = S.rules.findIndex(item => item.id === id); if (at < 0) return false; removeAt(at); return true; },
    list() { return S.rules.map(rule => ({ id: rule.id, name: rule.name, enabled: rule.enabled, scope: rule.scope, ...(rule.scope === 'host' ? { host: rule.host } : { method: rule.method, url: rule.url, query: rule.query }), hits: hitsOf(rule), ...(problem(rule) ? { error: problem(rule) } : {}) })); },
    /** The rules as stored (the general export). */
    exportRules() { return S.rules.map(rule => ({ ...normalizeBlock(rule) })); },
    /** Replaces the whole list (the general import: already validated); applied and saved like rules typed by hand. */
    replaceAll(rules) {
      S.rules = rules.slice(0, MAX_BLOCKS).map(normalizeBlock); S.expanded.clear(); render(); changed(true, `imported ${S.rules.length} ${S.rules.length === 1 ? 'rule' : 'rules'}: ${S.rules.filter(isActive).map(blockLabel).join('; ').slice(0, 300) || 'none active'}`);
    },
    flush() { clearTimeout(S.saveTimer); persist(); },
    get state() { return S; },
  };
}
