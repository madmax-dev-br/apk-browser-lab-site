// The "Redirect hosts" section of the Controls panel (src/host-map.js): N from -> to rules kept in the device settings (network.hostMap) and applied live through the same path as
// the other device settings (the running VM gets them at once; the app keeps its URLs, only the exchange goes elsewhere). One line per rule like the Plugins and Endpoint mocks
// rows (src/list-rows.js): switch, "source → target", the live count of the requests it redirected (from every snapshot, snapshot.hostMap), and a menu; the two fields and the
// rule's effective URL shape show when the row is expanded (a new rule opens expanded).
import { parseRule, describeRule, ruleKey, hitText } from './host-map.js?v=2e0bd04dc9d5';
import { listRow } from './list-rows.js?v=2e0bd04dc9d5';

export function createHostMapPanel({ $, get, set }) {
  const list = () => $('hm-list');
  const rows = () => get().map(rule => ({ ...rule }));
  let current = rows(), timer = null, counts = new Map(), keys = new WeakMap(), counter = 0;
  const expanded = new Set();
  const keyOf = rule => { let key = keys.get(rule); if (!key) { key = `hm-${++counter}`; keys.set(rule, key); } return key; };

  function meta(rule) {
    const parsed = parseRule(rule);
    if (parsed.empty) return ['Enter the source (the host the app uses) and the target.', ''];
    if (parsed.error) return [parsed.error, 'error'];
    return [`${rule.enabled ? '' : 'Off. '}${describeRule(parsed)}`, rule.enabled ? 'ok' : ''];
  }
  function hitsOf(rule) {
    const parsed = parseRule(rule); if (parsed.empty || parsed.error) return ['', '', ''];
    const record = counts.get(ruleKey(rule)) ?? null; if (!record?.hits && !record?.failures) return ['', '', ''];   // nothing redirected yet: no count on the row
    return [hitText(record), record?.failures ? 'warn' : '', record?.lastFailure ? `Last failure: ${record.lastFailure}` : ''];
  }
  const activeRules = () => current.filter(rule => { const parsed = parseRule(rule); return rule.enabled && !parsed.error && !parsed.empty; });
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  function updateMeta() {
    [...list().children].forEach((li, index) => {
      const rule = current[index]; if (!rule) return;
      const [text, state] = meta(rule), info = li.querySelector('.hm-meta');
      if (info) { info.textContent = text; info.dataset.state = state; }
      li.querySelector('.hm-from-text').textContent = rule.from.trim() || 'New rule';
      li.querySelector('.hm-to-text').textContent = rule.to.trim() || '…';
      const [hits, hitState, title] = hitsOf(rule), counter = li.querySelector('.hm-hits'); counter.textContent = hits; counter.dataset.state = hitState; counter.hidden = !hits; counter.title = title ?? '';
      const dot = li.querySelector('.hm-dot'); dot.dataset.state = state; dot.textContent = state === 'error' ? '!' : ''; dot.title = state === 'error' ? text : rule.enabled ? 'Active' : 'Off';
      li.dataset.state = state === 'error' ? 'error' : '';
      li.querySelector('.hm-from')?.setAttribute('aria-invalid', String(state === 'error' && /source/i.test(text) && !/target/i.test(text)));
      li.querySelector('.hm-to')?.setAttribute('aria-invalid', String(state === 'error' && /target/i.test(text)));
    });
    const active = activeRules(), responses = active.reduce((sum, rule) => sum + (counts.get(ruleKey(rule))?.responses ?? 0), 0), failures = active.reduce((sum, rule) => sum + (counts.get(ruleKey(rule))?.failures ?? 0), 0);
    $('hm-summary').textContent = `${active.length} active`;
    $('hm-status').textContent = active.length && (responses || failures)
      ? `${responses} ${responses === 1 ? 'response' : 'responses'}${failures ? `, ${failures} ${failures === 1 ? 'failure' : 'failures'}` : ''} through redirects. The app still sees the original URL.`
      : active.length ? '' : current.length ? 'No rule is on.' : 'No redirects. A redirect sends the app\'s requests for one host to another server; the app still sees its own URL.';
    $('hm-status').dataset.empty = String(!current.length);
    list().hidden = !current.length;
  }
  function input(className, value, placeholder, label, describedBy) {
    const field = el('input', className); field.type = 'text'; field.value = value; field.placeholder = placeholder; field.spellcheck = false; field.autocomplete = 'off'; field.autocapitalize = 'off';
    field.setAttribute('aria-label', label); field.setAttribute('aria-describedby', describedBy); field.inputMode = 'url'; return field;
  }
  function details(rule, index) {
    const n = index + 1, metaId = `hm-meta-${keyOf(rule)}`, fields = el('div', 'hm-fields');
    const fromLabel = el('label', 'hm-field'), toLabel = el('label', 'hm-field');
    const from = input('hm-from', rule.from, 'https://api.example.com', `Source of redirect ${n}: the host the app uses`, metaId);
    const to = input('hm-to', rule.to, 'localhost:8080 or https://staging.example.com', `Target of redirect ${n}`, metaId);
    fromLabel.append(el('span', 'hm-field-name', 'Source (app host)'), from); toLabel.append(el('span', 'hm-field-name', 'Target'), to);
    const arrow = el('span', 'hm-arrow', '→'); arrow.setAttribute('aria-hidden', 'true');
    fields.append(fromLabel, arrow, toLabel);
    from.addEventListener('input', () => { rule.from = from.value; changed(); });
    to.addEventListener('input', () => { rule.to = to.value; changed(); });
    const info = el('p', 'hm-meta'); info.id = metaId; const [text, state] = meta(rule); info.textContent = text; info.dataset.state = state;
    return [fields, info];
  }
  function render() {
    list().replaceChildren(...current.map((rule, index) => {
      const n = index + 1, key = keyOf(rule);
      const main = [el('code', 'lr-text hm-from-text', rule.from.trim() || 'New rule'), el('span', 'hm-arrow-inline', '→'), el('code', 'lr-text hm-to-text', rule.to.trim() || '…')];
      main[1].setAttribute('aria-hidden', 'true');
      const hits = el('span', 'lr-count hm-hits'); hits.setAttribute('role', 'status'); hits.setAttribute('aria-live', 'polite');
      const dot = el('span', 'lr-dot hm-dot');
      const li = listRow({
        doc: document, key, label: `redirect ${n}`, switchLabel: `Turn on redirect ${n}`, checked: rule.enabled,
        onToggle: on => { rule.enabled = on; changed(true); },
        main, trail: [hits, dot], expanded: expanded.has(key),
        onExpand: open => { if (open) expanded.add(key); else expanded.delete(key); updateMeta(); },
        details: () => details(rule, current.indexOf(rule)),
        menu: () => [
          { label: 'Edit', run: () => openRow(index, '.hm-from') },
          { label: 'Move up', run: () => move(index, -1), disabled: index === 0 },
          { label: 'Move down', run: () => move(index, 1), disabled: index === current.length - 1 },
          { label: 'Remove', danger: true, run: () => removeAt(index) },
        ],
      });
      li.classList.add('hm-row'); return li;
    }));
    updateMeta();
  }
  function openRow(index, focus) {
    const rule = current[index]; if (!rule) return null;
    expanded.add(keyOf(rule)); render();
    const target = list().children[index]?.querySelector(focus); target?.scrollIntoView?.({ block: 'center' }); target?.focus?.(); return target;
  }
  function move(index, by) {
    const to = index + by; if (to < 0 || to >= current.length) return;
    const [item] = current.splice(index, 1); current.splice(to, 0, item); render(); changed(true);
    list().children[to]?.querySelector('.lr-more')?.focus();
  }
  function removeAt(index) {
    const [gone] = current.splice(index, 1); if (gone) expanded.delete(keyOf(gone)); render(); changed(true);
    (list().children[Math.min(index, current.length - 1)]?.querySelector('.lr-main') ?? $('hm-add')).focus();
  }
  function changed(now = false) { updateMeta(); clearTimeout(timer); timer = setTimeout(() => set(current.map(rule => ({ ...rule }))), now ? 0 : 400); }
  $('hm-add').addEventListener('click', () => {
    if (current.length >= 50) { $('hm-status').textContent = 'At most 50 redirects.'; return; }
    current.push({ from: '', to: '', enabled: true }); openRow(current.length - 1, '.hm-from');
  });
  render();
  return {
    /** "Redirect" from a request of the Network panel: a new rule with that origin; the target field gets the focus (nothing applies until it is typed). */
    addRule(from) {
      if (current.length >= 50) { $('hm-status').textContent = 'At most 50 redirects.'; return false; }
      const existing = current.findIndex(rule => rule.from.trim() === String(from).trim());
      const index = existing >= 0 ? existing : current.push({ from: String(from), to: '', enabled: true }) - 1;
      openRow(index, '.hm-to'); return true;
    },
    /** The device settings changed elsewhere (reset, another tab): show them. */
    refresh() { current = rows(); render(); },
    get rules() { return current; },
    /** Live counts of the Worker's snapshot ([{ key, hits, responses, failures, closed, lastFailure }]). */
    hits(entries) {
      if (!Array.isArray(entries)) return;
      let changedAny = false;
      for (const entry of entries) { const old = counts.get(entry.key); if (!old || old.hits !== entry.hits || old.responses !== entry.responses || old.failures !== entry.failures || old.closed !== entry.closed) { counts.set(entry.key, { ...entry }); changedAny = true; } }
      if (changedAny) updateMeta();
    },
    /** A new run: the counts start again. */
    resetHits() { if (!counts.size) return; counts = new Map(); updateMeta(); },
    /** The active rules with their counts, for the diagnostic report header. */
    activeLines() { return activeRules().map(rule => `${describeRule(parseRule(rule))} (${hitText(counts.get(ruleKey(rule)))})`); },
  };
}
