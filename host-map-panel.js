// The "Redirecionar hosts" section of the Controles panel (src/host-map.js): N from -> to rows kept in the device settings (network.hostMap) and applied live through the same path as the
// other device settings (the running VM gets them at once; the app keeps its URLs, only the exchange goes elsewhere). Each row shows the effective URL shape of its rule and, like the
// "Mock de endpoints" rows, the live count of the requests it redirected (responses and failures), which come back with every snapshot (snapshot.hostMap).
import { parseRule, describeRule, ruleKey, hitText } from './host-map.js?v=da7619ccc1f1';

export function createHostMapPanel({ $, get, set }) {
  const list = () => $('hm-list');
  const rows = () => get().map(rule => ({ ...rule }));
  let current = rows(), timer = null, counts = new Map();

  function meta(rule) {
    const parsed = parseRule(rule);
    if (parsed.empty) return ['Digite a origem (o host que o app usa) e o destino.', ''];
    if (parsed.error) return [parsed.error, 'error'];
    return [`${rule.enabled ? '' : 'desligada · '}${describeRule(parsed)}`, rule.enabled ? 'ok' : ''];
  }
  function hitsOf(rule) {
    const parsed = parseRule(rule); if (parsed.empty || parsed.error) return ['', ''];
    const record = counts.get(ruleKey(rule)) ?? null;
    return [hitText(record), record?.failures ? 'warn' : '', record?.lastFailure ? `Última falha: ${record.lastFailure}` : ''];
  }
  const activeRules = () => current.filter(rule => { const parsed = parseRule(rule); return rule.enabled && !parsed.error && !parsed.empty; });
  function updateMeta() {
    [...list().children].forEach((li, index) => {
      const rule = current[index]; if (!rule) return;
      const [text, state] = meta(rule), info = li.querySelector('.hm-meta'); info.textContent = text; info.dataset.state = state;
      const [hits, hitState, title] = hitsOf(rule), counter = li.querySelector('.hm-hits'); counter.textContent = hits; counter.dataset.state = hitState; counter.hidden = !hits; counter.title = title ?? '';
      li.querySelector('.hm-from').setAttribute('aria-invalid', String(state === 'error' && /^Origem/.test(text)));
      li.querySelector('.hm-to').setAttribute('aria-invalid', String(state === 'error' && /^Destino|^Falta o destino/.test(text)));
    });
    const active = activeRules(), responses = active.reduce((sum, rule) => sum + (counts.get(ruleKey(rule))?.responses ?? 0), 0), failures = active.reduce((sum, rule) => sum + (counts.get(ruleKey(rule))?.failures ?? 0), 0);
    $('hm-summary').textContent = `${active.length} ${active.length === 1 ? 'ativa' : 'ativas'}`;
    $('hm-status').textContent = active.length
      ? `${active.length} ${active.length === 1 ? 'regra ativa' : 'regras ativas'}, ${responses} ${responses === 1 ? 'resposta' : 'respostas'}${failures ? `, ${failures} ${failures === 1 ? 'falha' : 'falhas'}` : ''}. O app continua vendo a URL original; o painel Rede marca cada requisição REDIRECIONADA e diz para onde ela foi.`
      : current.length ? 'Nenhuma regra ativa.' : 'Nenhum host redirecionado.';
  }
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  function input(className, value, placeholder, label, describedBy) {
    const field = el('input', className); field.type = 'text'; field.value = value; field.placeholder = placeholder; field.spellcheck = false; field.autocomplete = 'off'; field.autocapitalize = 'off';
    field.setAttribute('aria-label', label); field.setAttribute('aria-describedby', describedBy); field.inputMode = 'url'; return field;
  }
  function render() {
    list().replaceChildren(...current.map((rule, index) => {
      const n = index + 1, metaId = `hm-meta-${n}`, li = el('li', 'hm-row');
      const head = el('div', 'hm-head'), toggle = el('label', 'hm-toggle'), check = el('input'); check.type = 'checkbox'; check.checked = rule.enabled; check.setAttribute('aria-label', `Ativar o redirecionamento ${n}`);
      toggle.append(check, el('span', null, `Regra ${n}`));
      const remove = el('button', 'cp-button hm-remove', 'Remover'); remove.type = 'button'; remove.setAttribute('aria-label', `Remover o redirecionamento ${n}`);
      head.append(toggle, remove);
      const fields = el('div', 'hm-fields');
      const fromLabel = el('label', 'hm-field'), toLabel = el('label', 'hm-field');
      const from = input('hm-from', rule.from, 'https://api.exemplo.com', `Origem do redirecionamento ${n}: o host que o app usa`, metaId);
      const to = input('hm-to', rule.to, 'localhost:8080 ou https://staging.exemplo.com', `Destino do redirecionamento ${n}`, metaId);
      fromLabel.append(el('span', 'hm-field-name', 'Origem (host do app)'), from); toLabel.append(el('span', 'hm-field-name', 'Destino'), to);
      const arrow = el('span', 'hm-arrow', '→'); arrow.setAttribute('aria-hidden', 'true');
      fields.append(fromLabel, arrow, toLabel);
      const info = el('span', 'hm-meta'); info.id = metaId;
      const hits = el('span', 'hm-hits'); hits.setAttribute('role', 'status'); hits.setAttribute('aria-live', 'polite');
      check.addEventListener('change', () => { rule.enabled = check.checked; changed(true); });
      from.addEventListener('input', () => { rule.from = from.value; changed(); });
      to.addEventListener('input', () => { rule.to = to.value; changed(); });
      remove.addEventListener('click', () => { current.splice(index, 1); render(); changed(true); (list().querySelectorAll('.hm-remove')[Math.min(index, current.length - 1)] ?? $('hm-add')).focus(); });
      li.append(head, fields, info, hits); return li;
    }));
    updateMeta();
  }
  function changed(now = false) { updateMeta(); clearTimeout(timer); timer = setTimeout(() => set(current.map(rule => ({ ...rule }))), now ? 0 : 400); }
  $('hm-add').addEventListener('click', () => {
    if (current.length >= 50) { $('hm-status').textContent = 'No máximo 50 redirecionamentos.'; return; }
    current.push({ from: '', to: '', enabled: true }); render(); list().querySelectorAll('.hm-from')[current.length - 1]?.focus();
  });
  render();
  return {
    /** "Redirecionar" from a request of the Rede panel: a new rule with that origin; the destination field gets the focus (nothing applies until it is typed). */
    addRule(from) {
      if (current.length >= 50) { $('hm-status').textContent = 'No máximo 50 redirecionamentos.'; return false; }
      const existing = current.findIndex(rule => rule.from.trim() === String(from).trim());
      const index = existing >= 0 ? existing : current.push({ from: String(from), to: '', enabled: true }) - 1;
      render(); const target = list().querySelectorAll('.hm-to')[index]; target?.scrollIntoView?.({ block: 'center' }); target?.focus?.(); return true;
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
