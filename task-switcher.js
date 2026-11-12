// SystemUI navigation of the virtual device, on the page: the swipe-up gesture from the bottom edge, the three buttons (Back, Home, Recents), the recents card and a minimal
// launcher with the one installed app (its real label and icon, read through the app's PackageManager). The app sees what it sees on Android: leaving for the launcher or the
// recents is onUserLeaveHint, onPause, onStop (APKRuntime.home); coming back is onRestart, onStart, onResume (APKRuntime.resumeTask); a task that ended is started again by
// the launcher icon. Before any app runs the device shows that launcher too: empty, then with the app being installed (a spinner over its icon while the
// package is read) and installed (tap to start). While the finger only drags, the app stays resumed and the window just follows it; nothing is sent to the VM until the gesture commits.
const COMMIT_FRACTION = 0.22;      // of the screen height: a shorter drag springs back, a longer one opens the recents
const CARD_SCALE = 0.62, CARD_LIFT = 0.03;   // the recents card: scale of the app window and how far (of the screen height) its centre sits above the screen's (nearly centred)
const BACK_EDGE = 14, BACK_COMMIT = 46, BACK_MAX = 72;   // the back gesture, in device px: width of the edge strips (styles.css), the pull that arms it, how far the bubble follows
const ANDROID_HEAD = 'M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24a11.463 11.463 0 00-8.94 0L5.65 5.67c-.19-.29-.58-.38-.87-.2-.28.18-.37.54-.22.83L6.4 9.48A10.78 10.78 0 001 18h22a10.78 10.78 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm10 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z';

/** Pure: what a drag of `dy` px (upwards positive) over a screen `height` px tall does to the app window, and whether releasing there commits to the recents. */
export function dragTransform(dy, height) {
  const travel = Math.max(0, Math.min(dy, height)), progress = height > 0 ? travel / height : 0;
  // the window shrinks about its centre faster than it rises, so its top edge comes down from the top of the screen as soon as the drag starts (it never sticks to it)
  return { scale: Math.max(CARD_SCALE - 0.12, 1 - progress * 0.9), lift: travel * 0.25, commits: progress >= COMMIT_FRACTION, progress };
}
/** Pure: the back bubble for a pull of `dx` px inwards from an edge: how far it sits from the edge, how grown it is, and whether releasing there goes back. */
export function backPull(dx) {
  const pull = Math.max(0, Math.min(dx, BACK_MAX)), progress = pull / BACK_COMMIT;
  return { offset: pull * 0.75, grow: Math.min(1, 0.55 + progress * 0.45), armed: dx >= BACK_COMMIT, edge: BACK_EDGE };
}

export function createTaskSwitcher({ document: doc = document, $, vm, render, back, relaunch, canGoBack, busy, begin, finish, report, announce = () => {} }) {
  const screen = $('android-screen');
  if (!screen || typeof screen.prepend !== 'function' || typeof screen.querySelector !== 'function') return { sync() {}, closed() {}, home() {}, restate() {}, reset() {}, icon: () => null, state: () => 'foreground' };   // no device on this page (or a host without a full DOM): nothing to navigate
  const el = (tag, className, parent) => { const node = doc.createElement(tag); node.className = className; parent?.append(node); return node; };
  const launcher = el('div', 'launcher-layer'); launcher.hidden = true; screen.prepend(launcher);
  const wall = el('div', 'launcher-hint', launcher); wall.textContent = 'Solte um APK aqui para instalar';
  const app = el('button', 'launcher-app', launcher); app.type = 'button';
  const iconBox = el('span', 'launcher-icon', app), label = el('span', 'launcher-label', app), spinner = el('span', 'launcher-installing', app); spinner.setAttribute('aria-hidden', 'true');
  const hit = el('button', 'task-card-hit'); hit.type = 'button'; hit.hidden = true; hit.setAttribute('aria-label', 'Voltar ao aplicativo'); screen.querySelector('.system-bars')?.before(hit);
  const zone = el('div', 'task-gesture-zone'); zone.setAttribute('aria-hidden', 'true'); screen.append(zone);
  const edges = ['left', 'right'].map(side => { const strip = el('div', `task-back-edge ${side}`); strip.dataset.side = side; strip.setAttribute('aria-hidden', 'true'); screen.append(strip); return strip; });
  const bubble = el('div', 'task-back-bubble'); bubble.hidden = true; bubble.setAttribute('aria-hidden', 'true'); bubble.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'; screen.append(bubble);
  const targets = () => [$('android-content'), $('android-window-layer'), $('android-action-mode-layer')].filter(Boolean);
  let mode = 'foreground', info = null, infoFor = null, iconURL = null, drag = null, working = false, pendingLabel = '';
  const away = () => mode === 'home' || mode === 'closed' || mode === 'idle' || mode === 'installing' || mode === 'installed';   // the launcher is on screen, no app window

  const setTransform = (scale, lift, animate) => { for (const node of targets()) { node.style.transition = animate ? 'transform .26s cubic-bezier(.2,.8,.2,1), border-radius .26s, opacity .2s' : 'none'; node.style.transformOrigin = '50% 50%'; node.style.transform = scale === 1 && lift === 0 ? '' : `translateY(${-lift}px) scale(${scale})`; node.style.borderRadius = scale === 1 ? '' : '28px'; node.style.opacity = ''; } };
  const show = next => {
    mode = next; const height = screen.offsetHeight, launcherOnly = next === 'idle' || next === 'installing' || next === 'installed';
    screen.dataset.task = launcherOnly ? 'home' : next; screen.dataset.launcher = launcherOnly ? next : next === 'closed' ? 'installed' : '';   // the page styles the three launcher-only states as the home screen
    launcher.hidden = next === 'foreground'; hit.hidden = next !== 'overview'; app.hidden = next === 'idle'; app.disabled = next === 'installing'; wall.hidden = next !== 'idle';
    if (next === 'foreground') setTransform(1, 0, true);
    else if (next === 'overview') setTransform(CARD_SCALE, height * CARD_LIFT, true);
    else { setTransform(0.2, height * 0.02, true); for (const node of targets()) node.style.opacity = '0'; }   // home / closed: the window shrank into the launcher
    app.dataset.state = next === 'closed' || next === 'installed' ? 'closed' : next === 'installing' ? 'installing' : 'background';
    announce(next);
  };
  const paintIcon = () => {
    label.textContent = info?.label || info?.packageName || pendingLabel || 'App'; iconBox.replaceChildren(); iconBox.classList.remove('generic');
    if (iconURL) { const img = doc.createElement('img'); img.alt = ''; img.src = iconURL; img.draggable = false; iconBox.append(img); }
    else { iconBox.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${ANDROID_HEAD}"/></svg>`; iconBox.classList.add('generic'); }
    app.setAttribute('aria-label', mode === 'installing' ? `Instalando ${label.textContent}` : `Abrir ${label.textContent}`);
  };
  const loadInfo = async key => {
    if (infoFor === key) return; infoFor = key;
    try { const got = await vm().launcherInfo(); if (infoFor !== key) return; info = got; if (iconURL) URL.revokeObjectURL(iconURL); iconURL = got?.icon?.bytes ? URL.createObjectURL(new Blob([got.icon.bytes], { type: got.icon.mime || 'image/png' })) : null; paintIcon(); if (!got?.icon) for (const problem of got?.problems ?? []) report?.(`Launcher: ${problem}`); }
    catch (error) { report?.(`Launcher: ${error?.message ?? error}`); paintIcon(); }
  };
  const run = async (message, action) => {
    if (working || busy()) return false; working = true; const token = begin(message);
    try { const snapshot = await action(); if (snapshot) render(snapshot); return true; } catch (error) { report?.(error?.message ?? String(error), error); return false; } finally { finish(token); working = false; }
  };
  const leave = async next => { if (mode === 'foreground' || mode === 'dragging') { show(next); await run('Saindo do aplicativo…', () => vm().home()); announce(next); } else show(next); };   // announced again: the snapshot of the stopped app repainted the status line
  const resume = async () => { if (mode === 'installing' || mode === 'idle') return; if (mode === 'closed' || mode === 'installed') { show('foreground'); await relaunch(); return; } const ok = await run('Voltando ao aplicativo…', () => vm().resumeTask()); if (ok) show('foreground'); };

  // ---- the swipe-up gesture ---------------------------------------------------------------------------------------------------------------------------------------------
  const pageScale = () => { const rect = screen.getBoundingClientRect(); return screen.offsetHeight > 0 && rect.height > 0 ? rect.height / screen.offsetHeight : 1; };
  zone.addEventListener('pointerdown', event => {
    if (event.button !== 0 || working || busy() || away() || $('sysbar-nav')?.classList.contains('buttons')) return;
    drag = { id: event.pointerId, y: event.clientY, scale: pageScale(), from: mode, last: null }; try { zone.setPointerCapture(event.pointerId); } catch { /* released already */ }
    event.preventDefault(); event.stopPropagation();
  });
  zone.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return; const dy = (drag.y - event.clientY) / drag.scale, height = screen.offsetHeight;
    if (drag.from === 'overview') { drag.last = { commits: dy > height * 0.05, progress: 1 }; return; }
    const t = dragTransform(dy, height); drag.last = t; if (dy > 2) { if (mode !== 'dragging') { mode = 'dragging'; screen.dataset.task = 'dragging'; launcher.hidden = false; } setTransform(t.scale, t.lift, false); }
    event.preventDefault();
  });
  const end = event => {
    if (!drag || event.pointerId !== drag.id) return; const { last, from } = drag; drag = null; try { zone.releasePointerCapture(event.pointerId); } catch { /* gone */ }
    if (from === 'overview') { if (last?.commits) show('home'); return; }          // a second swipe up from the recents goes home
    if (mode !== 'dragging') return;
    if (event.type === 'pointercancel' || !last?.commits) { mode = 'foreground'; show('foreground'); return; }   // a short drag: the window springs back, the app never left
    mode = 'foreground'; leave('overview');
  };
  zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);

  // ---- the back gesture: press an edge and pull towards the middle; a bubble with the arrow follows the finger and going far enough arms it -------------------------------
  const goBack = () => { if (mode !== 'foreground' || working || busy()) return; if (canGoBack()) back(); else leave('home'); };   // on the root Activity of the launcher task, Back leaves it in the background (Android 12+)
  let pull = null;
  // A press on the strip that never became a pull is a tap on the app: it is handed to whatever is underneath.
  const tapThrough = event => { for (const strip of edges) strip.style.pointerEvents = 'none'; const under = doc.elementFromPoint(event.clientX, event.clientY); for (const strip of edges) strip.style.pointerEvents = ''; if (!under) return;
    const init = { bubbles: true, cancelable: true, composed: true, clientX: event.clientX, clientY: event.clientY, button: 0, pointerId: event.pointerId, pointerType: event.pointerType, isPrimary: true };
    under.dispatchEvent(new PointerEvent('pointerdown', { ...init, buttons: 1 })); under.dispatchEvent(new PointerEvent('pointerup', init)); under.dispatchEvent(new MouseEvent('click', init)); };
  for (const strip of edges) {
    strip.addEventListener('pointerdown', event => {
      if (event.button !== 0 || mode !== 'foreground' || working || $('sysbar-nav')?.classList.contains('buttons')) return;
      pull = { id: event.pointerId, x: event.clientX, y: event.clientY, side: strip.dataset.side, scale: pageScale(), last: null }; try { strip.setPointerCapture(event.pointerId); } catch { /* released already */ }
      event.preventDefault(); event.stopPropagation();
    });
    strip.addEventListener('pointermove', event => {
      if (!pull || event.pointerId !== pull.id) return; const dx = (pull.side === 'left' ? event.clientX - pull.x : pull.x - event.clientX) / pull.scale;
      if (dx < 4 && !pull.last) return; const rect = screen.getBoundingClientRect(), t = backPull(dx); pull.last = t;
      bubble.hidden = false; bubble.dataset.side = pull.side; bubble.dataset.armed = String(t.armed);
      bubble.style.top = `${Math.max(40, Math.min(screen.offsetHeight - 40, (event.clientY - rect.top) / pull.scale))}px`; bubble.style[pull.side] = `${t.offset - 22}px`; bubble.style[pull.side === 'left' ? 'right' : 'left'] = 'auto'; bubble.style.setProperty('--grow', String(t.grow));
      event.preventDefault();
    });
    const release = event => {
      if (!pull || event.pointerId !== pull.id) return; const { last } = pull; pull = null; try { strip.releasePointerCapture(event.pointerId); } catch { /* gone */ }
      bubble.hidden = true;
      if (event.type === 'pointercancel') return;
      if (!last) tapThrough(event); else if (last.armed) goBack();
    };
    strip.addEventListener('pointerup', release); strip.addEventListener('pointercancel', release);
  }

  // ---- recents card, launcher icon, the three buttons ----------------------------------------------------------------------------------------------------------------------
  hit.addEventListener('click', event => {
    const rect = screen.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height, half = CARD_SCALE / 2, centre = 0.5 - CARD_LIFT;
    if (event.detail === 0 || (Math.abs(x - 0.5) <= half && Math.abs(y - centre) <= half)) resume(); else show('home');   // keyboard activation or a tap on the card resumes; a tap beside it goes home
  });
  app.addEventListener('click', () => resume());
  const button = (selector, action) => screen.querySelector(selector)?.addEventListener('click', event => { event.stopPropagation(); if (!working && !busy()) action(); });
  button('.sysbar-back', () => { if (mode === 'overview') { resume(); return; } if (away()) return; if (canGoBack()) back(); else leave('home'); });   // Back on the root Activity of the launcher task leaves it in the background (Android 12+)
  button('.sysbar-home', () => { if (mode === 'overview' || !away()) leave('home'); });
  button('.sysbar-recents', () => { if (mode === 'overview') resume(); else if (!away()) leave('overview'); });

  return {
    state: () => mode,
    /** The app's launcher icon as a URL (null until it is known, or when the package has none the page can show). */
    icon: () => iconURL,
    /** Every rendered snapshot: the launcher data for this run, and the VM's own word on whether the task is in the background (an app can call moveTaskToBack itself). */
    sync(snapshot, key) {
      loadInfo(key);
      const background = !!snapshot?.navigation?.taskInBackground;
      if (mode === 'closed' || mode === 'idle' || mode === 'installing' || mode === 'installed') { show('foreground'); return; }
      if (background && (mode === 'foreground')) show('home');
      else if (!background && (mode === 'overview' || mode === 'home') && !working) show('foreground');
    },
    closed() { paintIcon(); show('closed'); },
    /** The launcher before an app runs: 'idle' (nothing installed), 'installing' (the package is being read: its name under a spinner) or 'installed' (tap the icon to start; `key` loads its real label and icon). */
    home(next, { label: text = '', key = null } = {}) {
      if (next !== 'idle' && next !== 'installing' && next !== 'installed') return;
      if (next === 'installing') { info = null; infoFor = null; if (iconURL) { URL.revokeObjectURL(iconURL); iconURL = null; } pendingLabel = String(text ?? '').replace(/\.apk$/i, ''); }
      show(next); if (next !== 'idle') paintIcon(); if (next === 'installed' && key) loadInfo(key);
    },
    /** After a render repainted the page's status: say again that the app is in the background. */
    restate() { if (mode === 'overview' || mode === 'home') announce(mode); },
    reset() { drag = null; pull = null; bubble.hidden = true; working = false; info = null; infoFor = null; pendingLabel = ''; delete screen.dataset.launcher; if (iconURL) { URL.revokeObjectURL(iconURL); iconURL = null; } mode = 'foreground'; delete screen.dataset.task; launcher.hidden = true; hit.hidden = true; for (const node of targets()) { node.style.transition = 'none'; node.style.transform = ''; node.style.borderRadius = ''; node.style.opacity = ''; } },
  };
}
