// Modals of the lab page: a plugin's output opened large ("Expandir" on its card) and the screens a plugin renders itself (lab.modal.open). Small, medium or full screen,
// with a close button and Esc. Content is DOM the page builds, or HTML a plugin wrote, shown in a sandboxed iframe (opaque origin: no access to this page, its storage or the
// VM; scripts run there only) that talks to the plugin by messages (window.lab.post / window.lab.on inside the iframe). No process.*.
export const MODAL_SIZES = ['small', 'medium', 'full'];
export const MAX_MODAL_HTML = 1_000_000;
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])';

/** The script put at the top of a plugin's HTML: window.lab.post(data) sends to the plugin, window.lab.on(fn) receives what the plugin posts (lab.modal.post). */
const bridgeScript = token => `<script>(()=>{const T=${JSON.stringify(token)},h=[];window.lab=Object.freeze({post:d=>parent.postMessage({__labModal:T,data:d},'*'),on:f=>{if(typeof f==='function')h.push(f);}});addEventListener('message',e=>{if(e.source===parent&&e.data&&e.data.__labModal===T)for(const f of h)try{f(e.data.data)}catch(x){console.error(x)}});})();<\/script>`;

/** doc: the page document. Returns { open(options) -> modal, closeAll(), get open() }. */
export function createModalHost({ doc = globalThis.document, win = globalThis.window } = {}) {
  const open = new Map(); let counter = 0;
  function onMessage(event) {
    for (const modal of open.values()) if (modal.frame && event.source === modal.frame.contentWindow && event.data?.__labModal === modal.token) { modal.onMessage?.(event.data.data); return; }
  }
  win?.addEventListener?.('message', onMessage);
  /**
   * options: { title, size: 'small'|'medium'|'full', content: Node, html: string, onClose(reason), onMessage(data), label }.
   * Returns { id, element, body, setTitle(text), setSize(size), setContent(node), setHtml(html), post(data), close() }.
   */
  function openModal({ title = '', size = 'medium', content = null, html = null, onClose = null, onMessage: receive = null, label = '' } = {}) {
    const id = `lab-modal-${++counter}`, opener = doc.activeElement;
    const scrim = doc.createElement('div'), card = doc.createElement('div'), head = doc.createElement('div'), heading = doc.createElement('h2'), close = doc.createElement('button'), body = doc.createElement('div');
    scrim.className = 'lab-modal-scrim'; card.className = 'lab-modal'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', `${id}-title`); card.id = id;
    head.className = 'lab-modal-head'; heading.id = `${id}-title`; close.type = 'button'; close.className = 'lab-modal-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Fechar');
    body.className = 'lab-modal-body'; head.append(heading); if (label) { const tag = doc.createElement('span'); tag.className = 'lab-modal-label'; tag.textContent = label; head.append(tag); } head.append(close); card.append(head, body); scrim.append(card);
    const modal = { id, element: scrim, body, token: `${id}-${Math.random().toString(36).slice(2)}`, frame: null, onMessage: receive, closed: false };
    modal.setTitle = text => { heading.textContent = String(text ?? '').slice(0, 200); };
    modal.setSize = value => { card.dataset.size = MODAL_SIZES.includes(value) ? value : 'medium'; };
    modal.setContent = node => { modal.frame = null; body.replaceChildren(...(node ? [node] : [])); };
    modal.setHtml = text => {
      const source = String(text ?? ''); if (source.length > MAX_MODAL_HTML) throw Object.assign(new Error(`HTML grande demais (máximo ${MAX_MODAL_HTML} caracteres).`), { code: 'bad-args' });
      const frame = doc.createElement('iframe'); frame.className = 'lab-modal-frame'; frame.title = heading.textContent || 'Conteúdo do plugin';
      frame.setAttribute('sandbox', 'allow-scripts allow-forms');   // opaque origin: no same-origin, no top navigation, no popups
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${bridgeScript(modal.token)}${source}`;
      modal.frame = frame; body.replaceChildren(frame);
    };
    modal.post = data => { modal.frame?.contentWindow?.postMessage({ __labModal: modal.token, data }, '*'); };
    modal.close = (reason = 'code') => {
      if (modal.closed) return; modal.closed = true; open.delete(id); scrim.remove(); doc.removeEventListener('keydown', onKey, true);
      try { onClose?.(reason); } catch { /* the caller's problem */ }
      if (!open.size) doc.body?.classList?.remove('lab-modal-open');
      if (opener?.isConnected) opener.focus?.();
    };
    const onKey = event => {
      if (open.size && [...open.values()].at(-1) !== modal) return;   // the topmost modal takes the keys
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); modal.close('user'); return; }
      if (event.key !== 'Tab') return;
      const items = [...card.querySelectorAll(FOCUSABLE)]; if (!items.length) return;
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    close.addEventListener('click', () => modal.close('user'));
    scrim.addEventListener('mousedown', event => { if (event.target === scrim) modal.close('user'); });
    doc.addEventListener('keydown', onKey, true);
    modal.setTitle(title); modal.setSize(size);
    if (html !== null && html !== undefined) modal.setHtml(html); else if (content) modal.setContent(content);
    doc.body.append(scrim); doc.body?.classList?.add('lab-modal-open'); open.set(id, modal); close.focus?.();
    return modal;
  }
  return { open: openModal, closeAll: () => { for (const modal of [...open.values()]) modal.close('code'); }, get count() { return open.size; } };
}
