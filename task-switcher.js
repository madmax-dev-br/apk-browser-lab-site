// SystemUI navigation of the virtual device, on the page: the swipe-up gesture from the bottom edge, the three buttons (Back, Home, Recents), the recents card and a minimal
// launcher with the one installed app (its real label and icon, read through the app's PackageManager). The app sees what it sees on Android: leaving for the launcher or the
// recents is onUserLeaveHint, onPause, onStop (APKRuntime.home); coming back is onRestart, onStart, onResume (APKRuntime.resumeTask); a task that ended is started again by
// the launcher icon. Before any app runs the device shows that launcher too: empty, then with the app being installed (a spinner over its icon while the
// package is read) and installed (tap to start). While the finger only drags, the app stays resumed and the window just follows it; nothing is sent to the VM until the gesture commits.
// The app is thrown away (its process is killed, as when Android removes a task from the recents) by dragging its recents card up and off, with the gesture or the three
// buttons, or with the swipe-up gesture: dragging the window past the middle of the screen (it fades as it goes) or holding it and flinging it up.
const COMMIT_FRACTION = 0.22;      // of the screen height: a shorter drag springs back, a longer one opens the recents
const CLOSE_FRACTION = 0.5;        // of the screen height: the window dragged this far up and released is thrown away (the app is closed)
const CARD_SCALE = 0.62, CARD_LIFT = 0.03;   // the recents card: scale of the app window and how far (of the screen height) its centre sits above the screen's (nearly centred)
const BACK_EDGE = 14, BACK_COMMIT = 46, BACK_MAX = 72;   // the back gesture, in device px: width of the edge strips (styles.css), the pull that arms it, how far the bubble follows
const ANDROID_HEAD = 'M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24a11.463 11.463 0 00-8.94 0L5.65 5.67c-.19-.29-.58-.38-.87-.2-.28.18-.37.54-.22.83L6.4 9.48A10.78 10.78 0 001 18h22a10.78 10.78 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm10 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z';

/** Pure: what a drag of `dy` px (upwards positive) over a screen `height` px tall does to the app window, and whether releasing there commits to the recents. */
export function dragTransform(dy, height) {
  const travel = Math.max(0, Math.min(dy, height)), progress = height > 0 ? travel / height : 0;
  // the window shrinks about its centre faster than it rises, so its top edge comes down from the top of the screen as soon as the drag starts (it never sticks to it)
  return { scale: Math.max(CARD_SCALE - 0.12, 1 - progress * 0.9), lift: travel * 0.25, commits: progress >= COMMIT_FRACTION, progress, closes: progress >= CLOSE_FRACTION };
}
const FLING_SPEED = 1, FLING_HOLD_MS = 400;                // the swipe-up gesture: a release at least this fast (device px per ms, upwards) after holding the window this long throws the app away
const CARD_DISMISS_FRACTION = 0.22, CARD_FLING_SPEED = 0.5, CARD_FLING_MIN = 24;   // the recents card: dragged this far up (of the screen height), or released this fast after at least this many px, it is thrown away
/** Pure: whether releasing the swipe-up gesture throws the app away: the window was held (not a quick swipe, which opens the recents), is past the commit point, and is flung upwards. */
export function flingDismisses({ velocity, heldMs, progress }) { return progress >= CLOSE_FRACTION || (velocity >= FLING_SPEED && heldMs >= FLING_HOLD_MS && progress >= COMMIT_FRACTION); }
/** Pure: whether releasing the recents card `dy` px above where it rests (upwards positive), moving at `velocity` px/ms upwards, throws the app away. */
export function cardDismisses({ dy, velocity, height }) { return dy >= height * CARD_DISMISS_FRACTION || (velocity >= CARD_FLING_SPEED && dy >= CARD_FLING_MIN); }
/** Pure: the upward speed (px per ms) at the end of `samples` ([{ t, y }], page px, oldest first), over about the last 100 ms, for a page scale of `scale`. */
export function releaseVelocity(samples, scale = 1) {
  if (samples.length < 2) return 0; const last = samples[samples.length - 1]; let from = samples[0];
  for (let i = samples.length - 2; i >= 0; i--) { from = samples[i]; if (last.t - from.t >= 100) break; }
  const dt = last.t - from.t; return dt > 0 ? (from.y - last.y) / scale / dt : 0;
}
/** Pure: the back bubble for a pull of `dx` px inwards from an edge: how far it sits from the edge, how grown it is, and whether releasing there goes back. */
export function backPull(dx) {
  const pull = Math.max(0, Math.min(dx, BACK_MAX)), progress = pull / BACK_COMMIT;
  return { offset: pull * 0.75, grow: Math.min(1, 0.55 + progress * 0.45), armed: dx >= BACK_COMMIT, edge: BACK_EDGE };
}

export function createTaskSwitcher({ document: doc = document, $, vm, render, back, relaunch, canGoBack, busy, begin, finish, report, dismiss = () => {}, announce = () => {}, shelf: shelfActions = {}, onInfo = () => {}, onIcon = () => {} }) {
  const screen = $('android-screen');
  if (!screen || typeof screen.prepend !== 'function' || typeof screen.querySelector !== 'function') return { sync() {}, closed() {}, home() {}, restate() {}, reset() {}, setShelf() {}, infoSettled: async () => {}, icon: () => null, state: () => 'foreground', resume: async () => {}, navigate: async () => null };   // no device on this page (or a host without a full DOM): nothing to navigate
  const el = (tag, className, parent) => { const node = doc.createElement(tag); node.className = className; parent?.append(node); return node; };
  const launcher = el('div', 'launcher-layer'); launcher.hidden = true; screen.prepend(launcher);
  const wall = el('div', 'launcher-hint', launcher); wall.textContent = 'Drop an APK here to install';
  const app = el('button', 'launcher-app', launcher); app.type = 'button';
  const iconBox = el('span', 'launcher-icon', app), label = el('span', 'launcher-label', app), spinner = el('span', 'launcher-installing', app); spinner.setAttribute('aria-hidden', 'true');
  const hit = el('button', 'task-card-hit'); hit.type = 'button'; hit.hidden = true; hit.setAttribute('aria-label', 'Back to the app'); screen.querySelector('.system-bars')?.before(hit);
  const zone = el('div', 'task-gesture-zone'); zone.setAttribute('aria-hidden', 'true'); screen.append(zone);
  const edges = ['left', 'right'].map(side => { const strip = el('div', `task-back-edge ${side}`); strip.dataset.side = side; strip.setAttribute('aria-hidden', 'true'); screen.append(strip); return strip; });
  const bubble = el('div', 'task-back-bubble'); bubble.hidden = true; bubble.setAttribute('aria-hidden', 'true'); bubble.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'; screen.append(bubble);
  const targets = () => [$('android-content'), $('android-window-layer'), $('android-action-mode-layer')].filter(Boolean);
  let mode = 'foreground', info = null, infoFor = null, iconURL = null, drag = null, working = false, pendingLabel = '';
  // the saved apps (src/apk-shelf.js), one beside the other in the order they were added; the app of this run keeps its own icon (`app`) at its place among them
  let shelfItems = [], shelfCurrent = null, shelfButtons = [], shelfURLs = [], savedIconURL = null, savedLabel = '';   // savedIconURL, savedLabel: the icon and label stored with the app of this run, shown until its PackageManager answers (opening a saved app does not lose its icon meanwhile)
  const renderShelf = () => {
    closeMenu();
    for (const node of shelfButtons) node.remove(); shelfButtons = []; for (const url of shelfURLs.splice(0)) URL.revokeObjectURL(url);
    let placed = false;
    // two saved APKs of the same app (the same label) also show their file names, so they can be told apart
    const nameOf = item => item.label || String(item.name).replace(/\.apk$/i, ''), seen = new Map();
    for (const item of shelfItems) seen.set(nameOf(item), (seen.get(nameOf(item)) ?? 0) + 1);
    const fileLine = (button, item) => { button.querySelector('.launcher-file')?.remove(); if ((seen.get(nameOf(item)) ?? 0) > 1) { const line = el('span', 'launcher-file', button); line.textContent = String(item.name).replace(/\.apk$/i, ''); } };
    app.querySelector('.launcher-file')?.remove();
    for (const item of shelfItems) {
      if (item.id === shelfCurrent) { launcher.append(app); fileLine(app, item); placed = true; continue; }
      const button = el('button', 'launcher-app', launcher), box = el('span', 'launcher-icon', button), text = el('span', 'launcher-label', button), name = item.label || String(item.name).replace(/\.apk$/i, '');
      button.type = 'button'; button.dataset.state = 'saved'; button.dataset.shelfId = item.id; text.textContent = name;
      if (item.icon?.bytes) { const url = URL.createObjectURL(new Blob([item.icon.bytes], { type: item.icon.mime || 'image/png' })), img = doc.createElement('img'); shelfURLs.push(url); img.alt = ''; img.src = url; img.draggable = false; box.append(img); }
      else { box.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${ANDROID_HEAD}"/></svg>`; box.classList.add('generic'); }
      fileLine(button, item); button.setAttribute('aria-label', `Open ${name}`);
      button.title = `${name}\n${item.packageName ?? item.name}${item.hasHandle ? '\nOpens the file from where it is on disk (the newest version)' : '\nOpens the copy saved in this browser'}\nHold or right-click: uninstall`;
      if (item.problem) { button.dataset.problem = item.problem.code ?? 'problem'; button.title = `${name}\n${item.problem.message ?? 'The stored APK cannot be opened.'}\nTap to see why and choose the APK again.\nHold or right-click: uninstall`; const mark = el('span', 'launcher-problem', button); mark.textContent = '!'; mark.setAttribute('aria-hidden', 'true'); button.setAttribute('aria-label', `${name}: the stored APK cannot be opened, choose it again`); }   // the stored copy could not be used (src/apk-shelf.js file()): still on the launcher, marked
      button.addEventListener('click', () => { if (!working) shelfActions.open?.(item.id); });   // the page decides (busy() also means "no app loaded", the very case a saved app is opened in)
      button.addEventListener('contextmenu', event => { event.preventDefault(); shelfActions.remove?.(item); });
      longPress(button, () => item);
      shelfButtons.push(button);
    }
    if (!placed) wall.after(app);   // an app that is not saved (a demo, a hosted example) leads the row
    wall.hidden = !(mode === 'idle' && shelfButtons.length === 0);
  };
  // Long press on an icon of the home screen (as on a launcher): a small menu over it with Uninstall (the copy kept in this browser is deleted; shelfActions.remove confirms).
  // The press that opened the menu is not a click: it does not open the app.
  let menu = null, pressTimer = 0, pressed = null;
  const closeMenu = () => { menu?.remove(); menu = null; };
  const openMenu = (button, item) => {
    closeMenu(); menu = el('div', 'launcher-menu', launcher); menu.setAttribute('role', 'menu');
    const name = el('div', 'launcher-menu-title', menu); name.textContent = item.label || String(item.name).replace(/\.apk$/i, '');
    const remove = el('button', 'launcher-menu-item', menu); remove.type = 'button'; remove.setAttribute('role', 'menuitem'); remove.textContent = 'Uninstall';
    remove.addEventListener('click', event => { event.stopPropagation(); closeMenu(); shelfActions.remove?.(item); });
    const box = button.getBoundingClientRect(), base = launcher.getBoundingClientRect(), scale = pageScale();
    menu.style.left = `${Math.max(4, (box.left - base.left) / scale)}px`; menu.style.top = `${(box.bottom - base.top) / scale + 4}px`; remove.focus?.();
  };
  const longPress = (button, itemOf) => {
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return; const item = itemOf(); if (!item) return; clearTimeout(pressTimer);
      pressed = { button, x: event.clientX, y: event.clientY, fired: false };
      pressTimer = setTimeout(() => { if (pressed?.button !== button) return; pressed.fired = true; navigator.vibrate?.(10); openMenu(button, item); }, 550);
    });
    button.addEventListener('pointermove', event => { if (pressed?.button === button && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 10) { clearTimeout(pressTimer); pressed = null; } });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) button.addEventListener(type, () => { clearTimeout(pressTimer); if (pressed?.button === button && !pressed.fired) pressed = null; });
    button.addEventListener('click', event => { if (pressed?.button === button && pressed.fired) { pressed = null; event.stopImmediatePropagation(); event.preventDefault(); } }, true);
  };
  doc.addEventListener?.('pointerdown', event => { if (menu && !menu.contains(event.target)) closeMenu(); }, true);
  doc.addEventListener?.('keydown', event => { if (event.key === 'Escape') closeMenu(); });
  const away = () => mode === 'home' || mode === 'closed' || mode === 'idle' || mode === 'installing' || mode === 'installed';   // the launcher is on screen, no app window

  const setTransform = (scale, lift, animate) => { for (const node of targets()) { node.style.transition = animate ? 'transform .26s cubic-bezier(.2,.8,.2,1), border-radius .26s, opacity .2s' : 'none'; node.style.transformOrigin = '50% 50%'; node.style.transform = scale === 1 && lift === 0 ? '' : `translateY(${-lift}px) scale(${scale})`; node.style.borderRadius = scale === 1 ? '' : '28px'; node.style.opacity = ''; } };
  const show = next => {
    mode = next; const height = screen.offsetHeight, launcherOnly = next === 'idle' || next === 'installing' || next === 'installed';
    screen.dataset.task = launcherOnly ? 'home' : next; screen.dataset.launcher = launcherOnly ? next : next === 'closed' ? 'installed' : '';   // the page styles the three launcher-only states as the home screen
    launcher.hidden = next === 'foreground'; hit.hidden = next !== 'overview'; app.hidden = next === 'idle'; app.disabled = next === 'installing'; wall.hidden = next !== 'idle' || shelfButtons.length > 0;
    if (next === 'foreground') setTransform(1, 0, true);
    else if (next === 'overview') setTransform(CARD_SCALE, height * CARD_LIFT, true);
    else { setTransform(0.2, height * 0.02, true); for (const node of targets()) node.style.opacity = '0'; }   // home / closed: the window shrank into the launcher
    app.dataset.state = next === 'closed' || next === 'installed' ? 'closed' : next === 'installing' ? 'installing' : 'background';
    announce(next);
  };
  let iconSent;   // the icon last given to onIcon: the saved app's stored icon at once, then the one its PackageManager answers
  const iconChanged = () => { const url = iconURL ?? savedIconURL ?? null; if (url !== iconSent) { iconSent = url; onIcon(url); } };
  const paintIcon = () => {
    iconChanged();
    label.textContent = info?.label || info?.packageName || savedLabel || pendingLabel || 'App'; iconBox.replaceChildren(); iconBox.classList.remove('generic');
    const url = iconURL ?? savedIconURL; if (url) { const img = doc.createElement('img'); img.alt = ''; img.src = url; img.draggable = false; iconBox.append(img); }
    else { iconBox.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${ANDROID_HEAD}"/></svg>`; iconBox.classList.add('generic'); }
    app.setAttribute('aria-label', mode === 'installing' ? `Installing ${label.textContent}` : `Open ${label.textContent}`);
  };
  let infoPending = Promise.resolve();   // the launcher-info request in flight: a launch started right after a load waits for it (the client takes one VM request at a time)
  const loadInfo = key => infoFor === key ? infoPending : (infoPending = loadInfoOnce(key));   // asked again for the same package (the launcher shown twice during a restart): the request in flight is the one to wait for
  const loadInfoOnce = async key => {
    if (infoFor === key) return; infoFor = key;
    try { const got = await vm().launcherInfo(); if (infoFor !== key) return; info = got; onInfo(got); if (iconURL) URL.revokeObjectURL(iconURL); iconURL = got?.icon?.bytes ? URL.createObjectURL(new Blob([got.icon.bytes], { type: got.icon.mime || 'image/png' })) : null; paintIcon(); if (!got?.icon) for (const problem of got?.problems ?? []) report?.(`Launcher: ${problem}`); }
    catch (error) { report?.(`Launcher: ${error?.message ?? error}`); paintIcon(); }
  };
  let settled = Promise.resolve();   // the navigation request in flight (leaving, resuming)
  const run = (message, action) => {
    if (working || busy()) return Promise.resolve(false); working = true; const token = begin(message);
    const done = (async () => { try { const snapshot = await action(); if (snapshot) render(snapshot); return true; } catch (error) { report?.(error?.message ?? String(error), error); return false; } finally { finish(token); working = false; } })();
    settled = done; return done;
  };
  // The app is thrown away: its window flies off the top, then the page kills its process (after the request that was taking it to the background, if one is in flight).
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  let dismissing = false;
  const throwAway = async () => {
    if (dismissing || away()) return; dismissing = true; hit.hidden = true;
    try {
      const height = screen.offsetHeight; setTransform(CARD_SCALE, height * 1.1, true); for (const node of targets()) node.style.opacity = '0';
      await settled; await new Promise(resolve => setTimeout(resolve, 180));
      await dismiss();   // the page shows the launcher with the app's icon (closed())
    } catch (error) { report?.(error?.message ?? String(error), error); } finally { dismissing = false; }
  };
  const leave = async next => { if (mode === 'foreground' || mode === 'dragging') { show(next); await run('Leaving the app…', () => vm().home()); announce(next); } else show(next); };   // announced again: the snapshot of the stopped app repainted the status line
  const resume = async () => { if (mode === 'installing' || mode === 'idle') return; if (mode === 'closed' || mode === 'installed') { show('foreground'); await relaunch(); return; } const ok = await run('Returning to the app…', () => vm().resumeTask()); if (ok) show('foreground'); };

  // ---- the swipe-up gesture ---------------------------------------------------------------------------------------------------------------------------------------------
  const pageScale = () => { const rect = screen.getBoundingClientRect(); return screen.offsetHeight > 0 && rect.height > 0 ? rect.height / screen.offsetHeight : 1; };
  zone.addEventListener('pointerdown', event => {
    if (event.button !== 0 || working || busy() || away() || $('sysbar-nav')?.classList.contains('buttons')) return;
    drag = { id: event.pointerId, y: event.clientY, scale: pageScale(), from: mode, last: null, at: now(), samples: [{ t: now(), y: event.clientY }] }; try { zone.setPointerCapture(event.pointerId); } catch { /* released already */ }
    event.preventDefault(); event.stopPropagation();
  });
  zone.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return; const dy = (drag.y - event.clientY) / drag.scale, height = screen.offsetHeight;
    drag.samples.push({ t: now(), y: event.clientY }); if (drag.samples.length > 24) drag.samples.shift();
    if (drag.from === 'overview') { drag.last = { commits: dy > height * 0.05, progress: 1 }; return; }
    const t = dragTransform(dy, height); drag.last = t; if (dy > 2) { if (mode !== 'dragging') { mode = 'dragging'; screen.dataset.task = 'dragging'; launcher.hidden = false; } setTransform(t.scale, t.lift, false); for (const node of targets()) node.style.opacity = t.closes ? String(Math.max(0.3, 1 - (t.progress - CLOSE_FRACTION) * 2.5)) : ''; screen.dataset.closing = String(t.closes); }   // past the middle the window fades: released there, the app closes
    event.preventDefault();
  });
  const end = event => {
    if (!drag || event.pointerId !== drag.id) return; const { last, from, at, samples, scale } = drag; drag = null; try { zone.releasePointerCapture(event.pointerId); } catch { /* gone */ } delete screen.dataset.closing;
    samples.push({ t: now(), y: event.clientY });
    if (from === 'overview') { if (last?.commits) show('home'); return; }          // a second swipe up from the recents goes home
    if (mode !== 'dragging') return;
    if (event.type === 'pointercancel' || !last?.commits) { mode = 'foreground'; show('foreground'); return; }   // a short drag: the window springs back, the app never left
    if (flingDismisses({ velocity: releaseVelocity(samples, scale), heldMs: now() - at, progress: last.progress })) { throwAway(); return; }   // held, then flung up: the app is thrown away
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
  // The recents card follows a drag upwards; released far enough up, or flung, the app is thrown away (with the gesture or the three buttons). A press that never moved is the click below.
  let card = null, swallowClick = false;
  const onCard = event => { const rect = screen.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height, half = CARD_SCALE / 2, centre = 0.5 - CARD_LIFT; return Math.abs(x - 0.5) <= half && Math.abs(y - centre) <= half; };
  hit.addEventListener('pointerdown', event => {
    if (event.button !== 0 || mode !== 'overview' || dismissing || !onCard(event)) return; swallowClick = false;
    card = { id: event.pointerId, y: event.clientY, scale: pageScale(), dy: 0, moved: false, samples: [{ t: now(), y: event.clientY }] }; try { hit.setPointerCapture(event.pointerId); } catch { /* released already */ }
  });
  hit.addEventListener('pointermove', event => {
    if (!card || event.pointerId !== card.id) return; const height = screen.offsetHeight; card.dy = Math.max(0, (card.y - event.clientY) / card.scale);
    card.samples.push({ t: now(), y: event.clientY }); if (card.samples.length > 24) card.samples.shift();
    if (card.dy > 6) card.moved = true;
    if (card.moved) { setTransform(CARD_SCALE, height * CARD_LIFT + card.dy, false); for (const node of targets()) node.style.opacity = String(Math.max(0.35, 1 - card.dy / (height * 0.6))); event.preventDefault(); }
  });
  const cardEnd = event => {
    if (!card || event.pointerId !== card.id) return; const { dy, moved, samples, scale } = card; card = null; try { hit.releasePointerCapture(event.pointerId); } catch { /* gone */ }
    if (!moved) return; swallowClick = true; samples.push({ t: now(), y: event.clientY }); for (const node of targets()) node.style.opacity = '';
    if (event.type !== 'pointercancel' && cardDismisses({ dy, velocity: releaseVelocity(samples, scale), height: screen.offsetHeight })) throwAway(); else show('overview');   // not far enough: the card springs back
  };
  hit.addEventListener('pointerup', cardEnd); hit.addEventListener('pointercancel', cardEnd);
  hit.addEventListener('click', event => {
    if (swallowClick) { swallowClick = false; return; }
    const rect = screen.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height, half = CARD_SCALE / 2, centre = 0.5 - CARD_LIFT;
    if (event.detail === 0 || (Math.abs(x - 0.5) <= half && Math.abs(y - centre) <= half)) resume(); else show('home');   // keyboard activation or a tap on the card resumes; a tap beside it goes home
  });
  longPress(app, () => (mode === 'closed' || mode === 'installed') ? shelfItems.find(item => item.id === shelfCurrent) ?? null : null);   // the app of this run, when it is not running (closed, or installed and not started) and is saved
  app.addEventListener('click', () => resume());
  const button = (selector, action) => screen.querySelector(selector)?.addEventListener('click', event => { event.stopPropagation(); if (!working && !busy()) action(); });
  button('.sysbar-back', () => { if (mode === 'overview') { resume(); return; } if (away()) return; if (canGoBack()) back(); else leave('home'); });   // Back on the root Activity of the launcher task leaves it in the background (Android 12+)
  button('.sysbar-home', () => { if (mode === 'overview' || !away()) leave('home'); });
  button('.sysbar-recents', () => { if (mode === 'overview') resume(); else if (!away()) leave('overview'); });

  return {
    state: () => mode,
    /** A tap on the app's launcher icon: an app in the background comes back to the front (onRestart, onStart, onResume); a closed or just installed one is started. */
    resume: () => resume(),
    /** What the system bar's buttons do (Back, Home, Recents), for a caller that is not a click on them: -> 'back' | 'home' | 'overview' | 'foreground' | null (nothing to do: no app on screen, or busy). */
    async navigate(button) {
      if (working || busy()) return null;
      if (button === 'back') { if (mode === 'overview') { await resume(); return 'foreground'; } if (away()) return null; if (canGoBack()) { await back(); return 'back'; } await leave('home'); return 'home'; }   // Back on the root Activity leaves the task in the background (Android 12+)
      if (button === 'home') { if (mode === 'overview' || !away()) { await leave('home'); return 'home'; } return null; }
      if (button === 'recents') { if (mode === 'overview') { await resume(); return 'foreground'; } if (!away()) { await leave('overview'); return 'overview'; } return null; }
      return null;
    },
    /** Keyboard focus on the app's launcher icon (after the error window closes: Enter opens the app again); false when the launcher does not show it. */
    focusApp: () => { if (!away() || app.hidden || app.disabled) return false; app.focus?.(); return true; },
    /** Settles once the launcher's label and icon request (a VM request) is answered: the page waits for it before sending the next one. */
    infoSettled: () => infoPending.catch(() => {}),
    /** The app's launcher icon as a URL (null until it is known, or when the package has none the page can show). */
    icon: () => iconURL ?? savedIconURL,
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
    /** The saved apps to show on the launcher (src/apk-shelf.js list()), and which of them is the app of this run (its icon is the live one: running, closed, installing). */
    setShelf(items, currentId = null) {
      shelfItems = Array.isArray(items) ? items : []; shelfCurrent = currentId; renderShelf();
      const current = shelfItems.find(item => item.id === currentId), saved = current?.icon, hadSaved = !!savedIconURL, name = current?.label ?? ''; const relabel = name !== savedLabel; savedLabel = name; if (savedIconURL) { URL.revokeObjectURL(savedIconURL); savedIconURL = null; }
      if (saved?.bytes) savedIconURL = URL.createObjectURL(new Blob([saved.bytes], { type: saved.mime || 'image/png' }));
      if ((!iconURL && (hadSaved || savedIconURL)) || (relabel && !info?.label)) paintIcon(); else iconChanged();
    },
    /** After a render repainted the page's status: say again that the app is in the background. */
    restate() { if (mode === 'overview' || mode === 'home') announce(mode); },
    reset() { drag = null; pull = null; card = null; swallowClick = false; dismissing = false; bubble.hidden = true; working = false; info = null; infoFor = null; pendingLabel = ''; delete screen.dataset.launcher; if (iconURL) { URL.revokeObjectURL(iconURL); iconURL = null; } mode = 'idle'; screen.dataset.task = 'home'; launcher.hidden = false; hit.hidden = true;
      // The windows of the run that ends stay out of sight, at once and without a transition: shown again at full size here they would flash on screen (with what the previous app last drew)
      // and then shrink into the launcher when the next run shows it. The launcher stays on screen until the page says what comes next (installing, idle).
      const height = screen.offsetHeight; for (const node of targets()) { node.style.transition = 'none'; node.style.transformOrigin = '50% 50%'; node.style.transform = `translateY(${-height * 0.02}px) scale(0.2)`; node.style.borderRadius = '28px'; node.style.opacity = '0'; } },
  };
}
