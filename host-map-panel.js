// The "Redirecionar hosts" section of the Controles panel (src/host-map.js): N from -> to rows kept in the device settings (network.hostMap) and applied live through the same path as the
// other device settings (the running VM gets them at once; the app keeps its URLs, only the exchange goes elsewhere).
import { parseRule } from './host-map.js?v=b2ddf4678f67';

export function createHostMapPanel({ $, get, set }) {
  const list = () => $('hm-list');
  const rows = () => get().map(rule => ({ ...rule }));
  let current = rows(), timer = null;

  function meta(rule) {
    const parsed = parseRule(rule);
    if (parsed.empty) return ['', ''];
    if (parsed.error) return [parsed.error, 'error'];
    if (!rule.enabled) return ['desligada', ''];
    const target = `${parsed.target.scheme ? parsed.target.scheme + '://' : ''}${parsed.target.host}${parsed.target.port !== null ? ':' + parsed.target.port : ''}`;
    const keeps = parsed.target.scheme ? '' : parsed.target.port === null ? ' (mantém o esquema e a porta do app)' : ' (mantém o esquema do app)';
    return [`${parsed.source.host}${parsed.source.port !== null ? ':' + parsed.source.port : ''} vai para ${target}${keeps}`, 'ok'];
  }
  function updateMeta() {
    [...list().children].forEach((li, index) => { const [text, state] = meta(current[index]), element = li.querySelector('.hm-meta'); element.textContent = text; element.dataset.state = state; element.hidden = !text; });
    const active = current.filter(rule => rule.enabled && !parseRule(rule).error && !parseRule(rule).empty).length;
    $('hm-summary').textContent = `${active} ${active === 1 ? 'ativa' : 'ativas'}`;
    $('hm-status').textContent = active ? `${active} ${active === 1 ? 'regra ativa' : 'regras ativas'}. O app continua vendo a URL original; o painel Rede mostra para onde cada requisição foi.` : 'Nenhum host redirecionado.';
  }
  function render() {
    list().replaceChildren(...current.map((rule, index) => {
      const li = document.createElement('li'); li.className = 'hm-row';
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = rule.enabled; check.setAttribute('aria-label', `Ativar o redirecionamento ${index + 1}`);
      const from = document.createElement('input'); from.type = 'text'; from.className = 'hm-from'; from.value = rule.from; from.placeholder = 'api.exemplo.com'; from.spellcheck = false; from.autocomplete = 'off'; from.autocapitalize = 'off'; from.setAttribute('aria-label', `Host de origem ${index + 1}`);
      const arrow = document.createElement('span'); arrow.className = 'hm-arrow'; arrow.textContent = '→'; arrow.setAttribute('aria-hidden', 'true');
      const to = document.createElement('input'); to.type = 'text'; to.className = 'hm-to'; to.value = rule.to; to.placeholder = 'staging.exemplo.com ou http://127.0.0.1:3000'; to.spellcheck = false; to.autocomplete = 'off'; to.autocapitalize = 'off'; to.setAttribute('aria-label', `Host de destino ${index + 1}`);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'cp-button hm-remove'; remove.textContent = 'Remover'; remove.setAttribute('aria-label', `Remover o redirecionamento ${index + 1}`);
      const info = document.createElement('span'); info.className = 'hm-meta'; info.setAttribute('role', 'status');
      check.addEventListener('change', () => { rule.enabled = check.checked; changed(true); });
      from.addEventListener('input', () => { rule.from = from.value; changed(); });
      to.addEventListener('input', () => { rule.to = to.value; changed(); });
      remove.addEventListener('click', () => { current.splice(index, 1); render(); changed(true); });
      li.append(check, from, arrow, to, remove, info); return li;
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
    /** The device settings changed elsewhere (reset, another tab): show them. */
    refresh() { current = rows(); render(); },
    get rules() { return current; },
  };
}
