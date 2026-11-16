// A live list (the Logcat and Rede panels of the tool dock) that redraws while the person is reading it breaks what they are doing: a redraw replaces the rows that hold
// their text selection, and the scroll to the newest row moves the text under the mouse and closes the request's context menu. This tells such a panel when to wait:
// while the mouse button went down inside the list and is still down (a selection being dragged), while a selection that is not empty starts or ends inside it, and
// while `alsoBusy()` says so (an open menu). When none holds any more, the callbacks given to onRelease run once, so the panel draws what arrived meanwhile.
// DOM-only, no process.*.

/** container: the list's element. Returns { busy(), onRelease(fn), release() } (release: run the waiting callbacks if nothing holds, e.g. after a menu closed). */
export function createReadingHold(container, { doc = container?.ownerDocument ?? globalThis.document, alsoBusy = () => false } = {}) {
  let pressed = false; const waiting = new Set();
  const selecting = () => {
    const selection = doc?.getSelection?.(); if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
    return container.contains(selection.anchorNode) || container.contains(selection.focusNode);
  };
  const busy = () => pressed || selecting() || !!alsoBusy();
  const release = () => { if (!waiting.size || busy()) return; const run = [...waiting]; waiting.clear(); for (const fn of run) fn(); };
  container.addEventListener?.('mousedown', event => { if (event.button === 0) pressed = true; });
  doc?.addEventListener?.('mouseup', () => { if (!pressed) return; pressed = false; setTimeout(release, 0); }, true);   // after the click has set (or cleared) the selection
  doc?.addEventListener?.('selectionchange', () => { if (!pressed) release(); });
  return { busy, onRelease(fn) { waiting.add(fn); }, release };
}
