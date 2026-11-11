// Behaviour of the static explainer pages (arquitetura.html, plugins.html): the lab's light/dark switch, copy buttons on code blocks, diagrams that animate only while on screen
// (with a pause button; prefers-reduced-motion removes the motion in CSS), and the contents rail that follows the section being read. No dependencies; every storage access guarded.
const root = document.documentElement;
document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  root.dataset.theme = theme;
  try { localStorage.setItem('apkweb-theme', theme); } catch { /* the choice lasts for this page only */ }
});

for (const block of document.querySelectorAll('.code')) {
  const pre = block.querySelector('pre'), button = document.createElement('button');
  if (!pre) continue;
  button.type = 'button'; button.className = 'copy'; button.textContent = 'Copiar';
  button.setAttribute('aria-label', `Copiar o código${block.dataset.name ? ': ' + block.dataset.name : ''}`);
  button.addEventListener('click', async () => {
    const text = pre.innerText.replace(/\n$/, '');
    let done = false;
    try { await navigator.clipboard.writeText(text); done = true; } catch {
      const area = document.createElement('textarea'); area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area); area.select();
      try { done = document.execCommand('copy'); } catch { done = false; } area.remove();
    }
    button.textContent = done ? 'Copiado' : 'Selecione e copie'; if (done) button.dataset.done = '';
    setTimeout(() => { button.textContent = 'Copiar'; delete button.dataset.done; }, 1800);
  });
  block.append(button);
}

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

const links = [...document.querySelectorAll('.toc a[href^="#"]')], targets = links.map(link => document.getElementById(link.getAttribute('href').slice(1))).filter(Boolean);
if (targets.length && 'IntersectionObserver' in globalThis) {
  const visible = new Set();
  const mark = () => {
    const current = targets.find(target => visible.has(target)) ?? null;
    for (const link of links) link.classList.toggle('is-current', !!current && link.getAttribute('href') === '#' + current.id);
  };
  const spy = new IntersectionObserver(entries => { for (const entry of entries) entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target); mark(); }, { rootMargin: '-10% 0px -70% 0px' });
  targets.forEach(target => spy.observe(target));
}
