// Behaviour of the documentation pages (arquitetura.html, plugins.html, player/example.html): the lab's light/dark switch; code blocks with a labelled bar, a copy
// button, colouring and "Expandir" for long ones; diagrams that animate only while on screen (with a pause button; prefers-reduced-motion removes the motion in
// CSS); and the contents rail, which follows the section being read and folds into one sticky bar on narrow screens. No dependencies; every storage access
// guarded. Without this script the pages still read: the contents are a plain list and the code blocks show their label through CSS.
const root = document.documentElement;
root.classList.add('js');
document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  root.dataset.theme = theme;
  try { localStorage.setItem('apkweb-theme', theme); } catch { /* the choice lasts for this page only */ }
});

// --- Code blocks ---------------------------------------------------------------------------------------------------------------------------------------------
const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const KEYWORDS = 'async|await|break|catch|class|const|continue|else|export|false|finally|for|from|function|if|import|in|let|new|null|of|return|throw|true|try|typeof|undefined|var|while';
const GRAMMARS = {
  // comment | string | keyword | number
  js: new RegExp('(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)|(`(?:\\\\[\\s\\S]|[^`\\\\])*`|\'(?:\\\\.|[^\'\\\\\\n])*\'|"(?:\\\\.|[^"\\\\\\n])*")|\\b(' + KEYWORDS + ')\\b|\\b(\\d+(?:\\.\\d+)?)\\b', 'g'),
  json: /((?!))|("(?:\\.|[^"\\\n])*")|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?\b)/g,
  shell: /((?:^|(?<=\s))#[^\n]*)|('(?:[^'\n])*'|"(?:\\.|[^"\\\n])*")|((?!))|((?!))/gm,
  html: /(<!--[\s\S]*?-->|\/\/[^\n]*)|("(?:[^"\n])*"|'(?:[^'\n])*'|`(?:[^`])*`)|\b(await|const|async|import|from)\b|((?!))|(<\/?[a-z][\w-]*|\/?>)/g,
};
const CLASSES = ['tk-c', 'tk-s', 'tk-k', 'tk-n', 'tk-t'], LABELS = { js: 'JavaScript', json: 'JSON', shell: 'Terminal', html: 'HTML' };
function grammarOf(text) {
  const start = text.trimStart();
  if (/^</.test(start)) return 'html';
  if (/^[{[]/.test(start) && !/=>|\bawait\b|\bconst\b/.test(text)) return 'json';
  if (/=>|\b(?:const|await|function|let)\b|\blab\.|\bplayer\./.test(text)) return 'js';
  if (/^(?:#|\$|curl\b|node\b|npm\b)/m.test(text)) return 'shell';
  return null;
}
/** Colours a code block in place. The text never changes: every slice is escaped as is, so what is copied is what was written. */
function colour(code, kind) {
  const text = code.textContent, grammar = GRAMMARS[kind];
  if (!grammar || text.length > 60000) return;
  let html = '', last = 0;
  for (const match of text.matchAll(grammar)) {
    const kind = match.slice(1).findIndex(group => group !== undefined);
    if (kind < 0 || !match[0]) continue;
    html += escapeHtml(text.slice(last, match.index)) + `<span class="${CLASSES[kind]}">${escapeHtml(match[0])}</span>`;
    last = match.index + match[0].length;
  }
  code.innerHTML = html + escapeHtml(text.slice(last));
  if (code.textContent !== text) code.textContent = text;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* no permission or no secure context: the selection fallback */ }
  const area = document.createElement('textarea'); area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area); area.select();
  let done = false; try { done = document.execCommand('copy'); } catch { done = false; }
  area.remove(); return done;
}
for (const block of document.querySelectorAll('.code')) {
  const pre = block.querySelector('pre'), code = pre?.querySelector('code') ?? pre;
  if (!pre) continue;
  const text = code.textContent.replace(/\n$/, ''), name = block.dataset.name ?? '', grammar = grammarOf(text);
  try { colour(code, grammar); } catch { /* the block stays plain */ }
  const bar = document.createElement('div'), label = document.createElement('span'), copy = document.createElement('button');
  bar.className = 'code-bar'; label.className = 'code-name'; label.textContent = name || LABELS[grammar] || 'Código';
  copy.type = 'button'; copy.className = 'copy'; copy.textContent = 'Copiar'; copy.setAttribute('aria-label', `Copiar o código${name ? ': ' + name : ''}`);
  copy.addEventListener('click', async () => {
    const done = await copyText(text);
    copy.textContent = done ? 'Copiado' : 'Selecione e copie'; if (done) copy.dataset.done = '';
    setTimeout(() => { copy.textContent = 'Copiar'; delete copy.dataset.done; }, 1800);
  });
  bar.append(label, copy); block.prepend(bar); block.classList.add('has-bar');
  if (pre.scrollWidth > pre.clientWidth + 1 || pre.scrollHeight > pre.clientHeight + 1) { pre.tabIndex = 0; pre.setAttribute('role', 'region'); pre.setAttribute('aria-label', name ? `Código: ${name}` : 'Código'); }   // a scrollable region must be reachable by keyboard
  if (pre.scrollHeight > pre.clientHeight + 24) {
    const expand = document.createElement('button'); expand.type = 'button'; expand.className = 'expand'; expand.textContent = 'Expandir'; expand.setAttribute('aria-expanded', 'false');
    expand.addEventListener('click', () => {
      const open = block.classList.toggle('is-open');
      expand.textContent = open ? 'Recolher' : 'Expandir'; expand.setAttribute('aria-expanded', String(open));
      if (!open && block.getBoundingClientRect().top < 0) block.scrollIntoView({ block: 'start' });
    });
    block.classList.add('is-long'); bar.insertBefore(expand, copy);
  }
}
for (const box of document.querySelectorAll('.table-scroll, .table-wrap, .diagram-box')) if (box.scrollWidth > box.clientWidth + 1) { box.tabIndex = 0; box.setAttribute('role', 'region'); box.setAttribute('aria-label', box.classList.contains('diagram-box') ? 'Diagrama (rolável)' : 'Tabela (rolável)'); }

// --- Diagrams ------------------------------------------------------------------------------------------------------------------------------------------------
const figures = [...document.querySelectorAll('figure.diagram')];
if ('IntersectionObserver' in globalThis) {
  const watcher = new IntersectionObserver(entries => { for (const entry of entries) entry.target.classList.toggle('in-view', entry.isIntersecting); }, { rootMargin: '40px' });
  figures.forEach(figure => watcher.observe(figure));
} else figures.forEach(figure => figure.classList.add('in-view'));
for (const button of document.querySelectorAll('.motion-control')) {
  const anim = button.closest('figure')?.querySelector('.anim');
  if (!anim) continue;
  button.addEventListener('click', () => {
    const paused = anim.classList.toggle('paused');
    button.textContent = paused ? 'Retomar animação' : 'Pausar animação';
    button.setAttribute('aria-pressed', String(paused));
  });
}

// --- Headings: a link to each anchor ---------------------------------------------------------------------------------------------------------------------------
for (const heading of document.querySelectorAll('.doc h2, .doc h3:not(.api-sig), .doc .api-sig')) {
  const id = heading.classList.contains('api-sig') ? heading.parentElement.id : (heading.matches('h2') && heading.closest('section')?.id) || heading.id;
  if (!id || heading.closest('.lane')) continue;
  const link = document.createElement('a'); link.className = 'heading-link'; link.href = '#' + id; link.textContent = '#'; link.setAttribute('aria-label', 'Link para esta seção');
  heading.append(link);
}

// --- Contents rail -------------------------------------------------------------------------------------------------------------------------------------------
const toc = document.querySelector('.toc');
if (toc) {
  const links = [...toc.querySelectorAll('a[href^="#"]')], entries = links.map(link => ({ link, target: document.getElementById(decodeURIComponent(link.hash.slice(1))) })).filter(entry => entry.target);
  const body = toc.querySelector('.toc-body') ?? toc, toggle = document.createElement('button'), now = document.createElement('span');
  toggle.type = 'button'; toggle.className = 'toc-toggle'; toggle.setAttribute('aria-expanded', 'false'); toggle.append('Nesta página', now); now.className = 'toc-now';
  if (!body.id) body.id = 'toc-body'; toggle.setAttribute('aria-controls', body.id);
  toc.insertBefore(toggle, body);
  const setExpanded = open => { toc.classList.toggle('is-expanded', open); toggle.setAttribute('aria-expanded', String(open)); };
  toggle.addEventListener('click', () => setExpanded(!toc.classList.contains('is-expanded')));
  toc.addEventListener('click', event => { if (event.target.closest('a')) setExpanded(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && toc.classList.contains('is-expanded')) { setExpanded(false); toggle.focus(); } });
  document.addEventListener('click', event => { if (!toc.contains(event.target)) setExpanded(false); });

  let current = null, queued = false;
  const mark = () => {
    queued = false;
    const line = (parseFloat(getComputedStyle(root).scrollPaddingTop) || 80) + 8;
    let found = null;
    for (const entry of entries) { if (entry.target.getBoundingClientRect().top <= line) found = entry; else if (found) break; }
    if (window.innerHeight + window.scrollY >= root.scrollHeight - 2 && entries.length) { const last = entries.at(-1); if (last.target.getBoundingClientRect().top < window.innerHeight) found = last; }
    if (found === current) return;
    current = found;
    for (const { link } of entries) { link.classList.remove('is-current', 'is-parent'); link.removeAttribute('aria-current'); }
    for (const item of toc.querySelectorAll('li.is-open')) item.classList.remove('is-open');
    now.textContent = found ? found.link.textContent : '';
    if (!found) return;
    found.link.classList.add('is-current'); found.link.setAttribute('aria-current', 'location');
    for (let item = found.link.closest('li'); item; item = item.parentElement.closest('li')) {
      item.classList.add('is-open');
      const own = item.querySelector(':scope > a'); if (own && own !== found.link) own.classList.add('is-parent');
    }
    if (getComputedStyle(toc).position === 'sticky' && toc.scrollHeight > toc.clientHeight) {   // the wide rail: keep the current entry in view inside it
      const box = toc.getBoundingClientRect(), at = found.link.getBoundingClientRect();
      if (at.top < box.top + 40 || at.bottom > box.bottom - 40) toc.scrollTop += at.top - box.top - box.height / 2;
    }
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(mark); } };
  addEventListener('scroll', queue, { passive: true }); addEventListener('resize', queue); addEventListener('hashchange', queue);
  mark();
}
