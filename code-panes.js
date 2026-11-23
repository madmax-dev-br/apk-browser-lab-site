// The Code tool's column widths (src/code-browser.js .cb-body): two handles the user drags between the list on the left, the code and the debugger column on the right
// (src/debugger-ui.js). The widths are the CSS variables --cb-left / --cb-right of .cb-body (src/lab-theme.css), kept per browser in localStorage (guarded); double-click
// or Home on a handle gives the default width back. A narrow window stacks the columns (the media queries of lab-theme.css) and the handles hide. No process.*.
export const PANES_KEY = 'apkweb.codePanes.v1';
export const MIN_LEFT = 160, MIN_RIGHT = 220, MIN_CODE = 280, STEP = 16;

const readSaved = storage => { try { const value = JSON.parse(storage?.getItem(PANES_KEY) ?? 'null'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } };

/** Widths that fit a body `total` px wide: the code column keeps at least MIN_CODE; `right` is 0 without the debugger column. */
export function clampPanes({ left, right }, total, withRight) {
  const r = withRight && Number.isFinite(right) ? Math.max(MIN_RIGHT, Math.min(right, total - MIN_CODE - MIN_LEFT)) : null;
  const l = Number.isFinite(left) ? Math.max(MIN_LEFT, Math.min(left, total - MIN_CODE - (withRight ? r ?? MIN_RIGHT : 0))) : null;
  return { left: l, right: r };
}

/** body: the .cb-body grid; side: its first column. Returns { refresh(), widths(), reset(), dispose() }. */
export function createCodePanes({ body, side, doc = body.ownerDocument, win = doc?.defaultView ?? globalThis.window, storage = (() => { try { return win?.localStorage ?? null; } catch { return null; } })() }) {
  let saved = readSaved(storage);
  const handle = which => {
    const el = doc.createElement('div');
    el.className = `cb-splitter cb-splitter-${which}`; el.tabIndex = 0;
    el.setAttribute('role', 'separator'); el.setAttribute('aria-orientation', 'vertical');
    el.setAttribute('aria-label', which === 'left' ? 'Resize the list' : 'Resize the debugger');
    el.title = 'Drag to resize · double-click: default width';
    return el;
  };
  const left = handle('left'), right = handle('right');
  const debuggerColumn = () => [...body.children].find(child => child.classList?.contains('dbg')) ?? null;
  const columns = () => { const text = win?.getComputedStyle?.(body)?.gridTemplateColumns ?? ''; return text.trim() ? text.trim().split(/\s+/).length : 0; };
  const save = () => { try { storage?.setItem(PANES_KEY, JSON.stringify(saved)); } catch { /* storage full or blocked: the widths last for this page */ } };
  function apply() {
    const total = body.clientWidth || 0, withRight = !!debuggerColumn() && body.classList.contains('has-debugger');
    const fit = total ? clampPanes(saved, total, withRight) : { left: saved.left ?? null, right: saved.right ?? null };
    if (fit.left !== null) body.style.setProperty('--cb-left', `${Math.round(fit.left)}px`); else body.style.removeProperty('--cb-left');
    if (fit.right !== null) body.style.setProperty('--cb-right', `${Math.round(fit.right)}px`); else body.style.removeProperty('--cb-right');
  }
  function place() {
    const n = columns(), dbg = debuggerColumn();
    left.hidden = n < 2; right.hidden = !(n >= 3 && dbg);
    if (!left.hidden) { left.style.left = `${side.offsetLeft + side.offsetWidth - 4}px`; left.setAttribute('aria-valuenow', String(side.offsetWidth)); }
    if (!right.hidden) { right.style.left = `${dbg.offsetLeft - 4}px`; right.setAttribute('aria-valuenow', String(dbg.offsetWidth)); }
  }
  function refresh() { if (!left.isConnected) body.append(left, right); apply(); place(); }
  function set(which, width) {
    saved = { ...saved, [which]: width };
    const total = body.clientWidth, fit = total ? clampPanes(saved, total, !!debuggerColumn() && body.classList.contains('has-debugger')) : null;
    if (fit?.[which] !== null && fit?.[which] !== undefined) saved = { ...saved, [which]: Math.round(fit[which]) };
    save(); apply(); place();
  }
  function reset(which = null) { if (which) { const { [which]: _, ...rest } = saved; saved = rest; } else saved = {}; save(); apply(); place(); }
  const current = which => which === 'left' ? side.offsetWidth : debuggerColumn()?.offsetWidth ?? MIN_RIGHT;
  for (const [el, which] of [[left, 'left'], [right, 'right']]) {
    el.addEventListener('pointerdown', event => {
      if (event.button !== 0) return; event.preventDefault();
      const startX = event.clientX, start = current(which);
      el.setPointerCapture?.(event.pointerId); el.classList.add('is-dragging'); doc.body?.classList?.add('cb-resizing');
      const move = e => set(which, which === 'left' ? start + (e.clientX - startX) : start - (e.clientX - startX));
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.classList.remove('is-dragging'); doc.body?.classList?.remove('cb-resizing'); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', () => reset(which));
    el.addEventListener('keydown', event => {
      const grow = which === 'left' ? 1 : -1;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); set(which, current(which) + (event.key === 'ArrowRight' ? STEP : -STEP) * grow * (event.shiftKey ? 4 : 1)); }
      else if (event.key === 'Home') { event.preventDefault(); reset(which); }
    });
  }
  // the debugger column comes and goes, the dock and the window resize: the handles follow
  const ResizeObs = win?.ResizeObserver, MutationObs = win?.MutationObserver;
  const resized = ResizeObs ? new ResizeObs(() => { apply(); place(); }) : null; resized?.observe(body); resized?.observe(side);
  const mutated = MutationObs ? new MutationObs(() => { const dbg = debuggerColumn(); if (dbg && resized) resized.observe(dbg); refresh(); }) : null;
  mutated?.observe(body, { childList: true, attributes: true, attributeFilter: ['class'] });
  refresh();
  return { refresh, reset, widths: () => ({ ...saved }), elements: { left, right }, dispose() { resized?.disconnect(); mutated?.disconnect(); left.remove(); right.remove(); } };
}
