// The scroll position and range of one scrollable of the running app, read for lab.scrollTo / lab.scrollInfo (src/lab-scroll.js) and the MCP tool scroll_to. Read-only:
// a Compose node answers with its ScrollAxisRange semantics (src/compose-semantics.js scrollInfo), a View with what its scrollbars are drawn from
// (View.computeVerticalScrollOffset / Range / Extent and the horizontal ones, which ScrollView, RecyclerView and the others override). Units are the VM's pixels
// (1 px = 1 dp at the lab's density). Runs in the VM Worker as a plugin query; no process.*.
import { isFreedId } from './heap-gc.js?v=8cf39c3035e0';
import { PluginQueryError } from './plugin-queries.js?v=8cf39c3035e0';

const VIEW = 'Landroid/view/View;';

/** args: { compose: { ownerViewId, nodeId } } | { view: id } -> { kind, x, y, maxX, maxY, horizontal, vertical, lazy, ... } or null when the target is gone. */
export function readScrollInfo(runtime, composeSemantics, args = {}) {
  if (args.compose && typeof args.compose === 'object') {
    const ownerViewId = Number(args.compose.ownerViewId), nodeId = Number(args.compose.nodeId);
    if (!Number.isSafeInteger(ownerViewId) || !Number.isSafeInteger(nodeId)) throw new PluginQueryError('bad-args', 'scrollInfo: compose precisa de ownerViewId e nodeId inteiros.');
    if (!composeSemantics || isFreedId(runtime, ownerViewId)) return null;
    const info = composeSemantics.scrollInfo({ ownerViewId, nodeId });
    return info ? { kind: 'compose', ...info } : null;
  }
  const id = Number(args.view);
  if (!Number.isSafeInteger(id) || id <= 0) throw new PluginQueryError('bad-args', 'scrollInfo: diga compose { ownerViewId, nodeId } ou view (id).');
  if (isFreedId(runtime, id)) return null;
  const receiver = { ref: id };
  if (!runtime.isSubtype(runtime.object(receiver).type, VIEW)) throw new PluginQueryError('bad-args', 'scrollInfo: o alvo não é uma View.');
  const read = name => { const value = runtime.dispatch({ owner: VIEW, name, signature: '()I', parameters: [], result: 'I' }, [receiver], 'virtual'); return Number.isFinite(value) ? value : 0; };
  const x = read('computeHorizontalScrollOffset'), y = read('computeVerticalScrollOffset');
  const maxX = Math.max(0, read('computeHorizontalScrollRange') - read('computeHorizontalScrollExtent')), maxY = Math.max(0, read('computeVerticalScrollRange') - read('computeVerticalScrollExtent'));
  return { kind: 'view', x, y, maxX, maxY, horizontal: maxX > 0, vertical: maxY > 0, reverseX: false, reverseY: false, lazy: false, scrollBy: true, disabled: false };
}
