// Scrolling a scrollable of the running app to a position or to a percentage of its range: lab.scrollTo / lab.scrollToPercent / lab.scrollInfo of the plugins
// (src/plugin-runtime.js) and the MCP tools scroll_to / scroll_info (src/mcp-tools.js). Nothing here writes a scroll position: the page reads where the scrollable is
// (the VM query `scrollState`, src/scroll-info.js) and asks the app to scroll by the difference through the paths a wheel on the device uses (the ScrollBy semantics
// action of a Compose node, View.scrollBy of a View), then reads again until the scrollable rests on the goal or stops moving. Positions are the VM's pixels
// (1 px = 1 dp at the lab's density). A lazy list (LazyColumn / LazyRow) composes only the items on screen and has no position in px of its own: it is steered by what
// is exact for it (the first item, the end of the content, ScrollBy) and, for a percentage between the ends, its content is measured first (see `lazy` below).
// DOM-free, no process.*.

export const SCROLL_LIMITS = { maxSteps: 8, measureSteps: 80, settleMs: 2500, pollMs: 120, tolerance: 1, maxDelta: 99000 };
const SCROLLABLE_VIEW = /ScrollView;$|RecyclerView;$|\/ListView;$|\/GridView;$|ViewPager2?;$|\/WebView;$/;
const fail = (code, message) => Object.assign(new Error(message), { code });
const area = item => item?.bounds ? (item.bounds.right - item.bounds.left) * (item.bounds.bottom - item.bounds.top) : Infinity;
const inside = (item, point) => !!item?.bounds && !!point && point.x >= item.bounds.left && point.x <= item.bounds.right && point.y >= item.bounds.top && point.y <= item.bounds.bottom;
const finite = value => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));
const textOf = element => [...(element.texts ?? []), element.editableText ?? '', ...(element.contentDescriptions ?? [])].join(' ').toLowerCase();

/** A target as the callers give it ({ key, testTag, text, x, y }, the MCP spelling { element_key, test_tag } or a layoutBounds element) -> { key, testTag, text, at } or null (the main scrollable). */
export function scrollSelector(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'string') return { key: null, testTag: raw, text: null, at: null };   // a bare string is a testTag
  if (typeof raw !== 'object') throw fail('bad-args', 'O alvo da rolagem é { testTag }, { text }, { key } ou { x, y }.');
  const key = raw.key ?? raw.element_key ?? null, testTag = raw.testTag ?? raw.test_tag ?? null, text = raw.text ?? null;
  const at = finite(raw.x) && finite(raw.y) ? { x: Number(raw.x), y: Number(raw.y) } : null;
  if (key === null && testTag === null && text === null && !at) return null;
  return { key: key === null ? null : String(key), testTag: testTag === null ? null : String(testTag), text: text === null ? null : String(text), at };
}

/** The element a selector names among lab.layoutBounds() elements (a scrollable one first: a list and its items may share a text), or null. */
export function findElement(elements, selector) {
  if (!selector) return null;
  if (selector.key !== null) return elements.find(item => item.key === selector.key) ?? null;
  if (selector.testTag === null && selector.text === null) return null;
  const wanted = selector.text === null ? null : selector.text.toLowerCase();
  const matches = elements.filter(item => (selector.testTag === null || item.testTag === selector.testTag) && (wanted === null || textOf(item).includes(wanted)));
  return matches.find(item => item.actions?.includes('ScrollBy')) ?? matches[0] ?? null;
}

/**
 * The scrollable a selector means. elements: lab.layoutBounds() (names not needed); views: flattenViews(snapshot) (src/compose-inspector-panel.js).
 * A scrollable element is itself; any other element (or a point) means the smallest scrollable that holds it; no selector means the largest scrollable on screen.
 * -> { kind: 'compose', ownerViewId, nodeId, key, name, bounds } | { kind: 'view', id, key, name, bounds }; throws not-found.
 */
export function resolveScrollTarget(elements, views, selector) {
  const element = findElement(elements, selector);
  if (selector && (selector.key !== null || selector.testTag !== null || selector.text !== null) && !element)
    throw fail('not-found', `Nenhum componente na tela com ${selector.key !== null ? `a chave ${selector.key}` : [selector.testTag !== null ? `testTag "${selector.testTag}"` : '', selector.text !== null ? `texto "${selector.text}"` : ''].filter(Boolean).join(' e ')} (veja lab.layoutBounds()).`);
  const point = element?.bounds ? { x: (element.bounds.left + element.bounds.right) / 2, y: (element.bounds.top + element.bounds.bottom) / 2 } : selector?.at ?? null;
  const scrollables = elements.filter(item => item.kind === 'compose' && item.actions?.includes('ScrollBy') && item.bounds);
  const compose = (element?.kind === 'compose' && element.actions?.includes('ScrollBy') ? element : null) ?? (element?.kind === 'view' ? null : point ? scrollables.filter(item => inside(item, point)).sort((a, b) => area(a) - area(b))[0] : [...scrollables].sort((a, b) => area(b) - area(a))[0]) ?? null;
  if (compose) { const [, owner, node] = String(compose.key).split(':'); return { kind: 'compose', ownerViewId: Number(owner), nodeId: Number(node), key: compose.key, name: compose.name ?? null, bounds: compose.bounds }; }
  const candidates = views.filter(view => view.visible && view.bounds && (view.kind === 'scroll' || SCROLLABLE_VIEW.test(String(view.type ?? ''))));
  const direct = element?.kind === 'view' ? candidates.find(view => String(view.id) === String(element.id)) : null;
  const view = direct ?? (point ? candidates.filter(item => inside(item, point)).sort((a, b) => b.depth - a.depth)[0] : [...candidates].sort((a, b) => area(b) - area(a))[0]) ?? null;
  if (!view) throw fail('not-found', point ? 'Nada rolável nesse ponto da tela.' : 'Nada rolável na tela.');
  return { kind: 'view', id: view.id, key: `v:${view.id}`, name: String(view.type ?? 'View').replace(/^L|;$/g, '').split('/').pop(), bounds: view.bounds };
}

/** What a call asks -> { x, y, percentX, percentY } with only the axes it names; throws bad-args when it names none, both forms of one axis or a value out of range. */
export function scrollRequest(args = {}) {
  const out = {};
  for (const [axis, percent] of [['x', 'percentX'], ['y', 'percentY']]) {
    const hasPosition = finite(args[axis]), hasPercent = finite(args[percent]);
    if (args[axis] !== undefined && args[axis] !== null && !hasPosition) throw fail('bad-args', `${axis} precisa ser um número (px).`);
    if (args[percent] !== undefined && args[percent] !== null && !hasPercent) throw fail('bad-args', `${percent} precisa ser um número de 0 a 100.`);
    if (hasPosition && hasPercent) throw fail('bad-args', `Diga ${axis} (px) ou ${percent} (0 a 100), não os dois.`);
    if (hasPosition) { const value = Number(args[axis]); if (value < 0) throw fail('bad-args', `${axis} não pode ser negativo: a posição é em px a partir do início da rolagem.`); out[axis] = value; }
    if (hasPercent) { const value = Number(args[percent]); if (value < 0 || value > 100) throw fail('bad-args', `${percent} vai de 0 a 100.`); out[percent] = value; }
  }
  if (!Object.keys(out).length) throw fail('bad-args', 'Diga para onde rolar: x / y (px) ou percentX / percentY (0 a 100).');
  return out;
}

/** The position a request means for a scrollable that is at `info` now: a percentage of the current range, a position clamped to it; an axis the request leaves out stays. */
export function scrollGoal(info, request) {
  const axis = (position, percent, current, max) => percent !== undefined ? max * percent / 100 : position !== undefined ? Math.max(0, Math.min(max, position)) : current;
  return { x: axis(request.x, request.percentX, info.x, info.maxX), y: axis(request.y, request.percentY, info.y, info.maxY) };
}

const round = value => Math.round(value * 100) / 100;
const percentOf = (value, max) => max > 0 ? round(Math.max(0, Math.min(100, value / max * 100))) : 0;
const ESTIMATED_VIEW = /RecyclerView|ListView|GridView|ViewPager/;   // their scrollbar numbers are the layout manager's estimate from the items laid out
/**
 * The answer of scrollInfo / scrollTo. A scroll container knows its position: x, y, maxX, maxY in px (= dp) and percentX / percentY of the range. A lazy list only
 * composes the items on screen, so by itself it has no position in px: x, y and the maximums are null and the percentage is known at the ends only (0 or 100), `atStart`
 * and `atEnd` say what the list does know, and `reported` carries the numbers the list gives accessibility (its own estimate, in its own unit). scrollTo fills in what
 * it measured on the way (see createLabScroll).
 */
export function scrollResult(target, info, extra = {}) {
  const base = { element: target.name, key: target.key, kind: target.kind, unit: 'px', horizontal: !!info.horizontal, vertical: !!info.vertical };
  if (!info.lazy) return { ...base, x: round(info.x), y: round(info.y), maxX: round(info.maxX), maxY: round(info.maxY), percentX: percentOf(info.x, info.maxX), percentY: percentOf(info.y, info.maxY), lazy: false, estimated: target.kind === 'view' && ESTIMATED_VIEW.test(target.name ?? ''), ...extra };
  const atStart = { x: info.x <= 0.01, y: info.y <= 0.01 }, atEnd = { x: info.maxX - info.x <= 0.01, y: info.maxY - info.y <= 0.01 };
  const edge = (axis, scrolls) => !scrolls || atStart[axis] ? 0 : atEnd[axis] ? 100 : null, main = info.vertical || !info.horizontal ? 'y' : 'x';
  return { ...base, x: null, y: null, maxX: null, maxY: null, percentX: edge('x', info.horizontal), percentY: edge('y', info.vertical), lazy: true, estimated: false,
    atStart: atStart[main], atEnd: atEnd[main], reported: { x: round(info.x), y: round(info.y), maxX: round(info.maxX), maxY: round(info.maxY) }, ...extra };
}
/**
 * How far the content of a scrollable moved between two readings of lab.layoutBounds(), in px along an axis: the components that are whole inside the scrollable both
 * times (a component cut by the edge has clipped bounds) moved by the same amount; the most common one wins. null when no component is in both readings.
 */
export function contentShift(before, after, target, axis = 'y') {
  const [start, end] = axis === 'y' ? ['top', 'bottom'] : ['left', 'right'], box = target.bounds;
  const whole = item => item?.bounds && item.key !== target.key && item.bounds[start] > box[start] + 0.5 && item.bounds[end] < box[end] - 0.5 && item.bounds.left >= box.left - 0.5 && item.bounds.right <= box.right + 0.5 && item.bounds.top >= box.top - 0.5 && item.bounds.bottom <= box.bottom + 0.5;
  const starts = new Map(before.filter(whole).map(item => [item.key, item.bounds[start]])), votes = new Map();
  for (const item of after) if (whole(item) && starts.has(item.key)) { const moved = round(starts.get(item.key) - item.bounds[start]); votes.set(moved, (votes.get(moved) ?? 0) + 1); }
  let best = null, most = 0; for (const [moved, count] of votes) if (count > most) { best = moved; most = count; }
  return best;
}

/**
 * query(args) -> the VM's scrollState for { compose: { ownerViewId, nodeId } } | { view: id } (null when the target is gone); elements() -> lab.layoutBounds() elements;
 * views() -> flattenViews of the drawn snapshot; scrollBy(target, dx, dy) -> queues the app's own scroll (ScrollBy action / View.scrollBy) and resolves once the VM took
 * it; scrollToIndex(target, index) -> the same for the ScrollToIndex action of a Compose lazy list.
 */
export function createLabScroll({ query, elements, views, scrollBy, scrollToIndex = null, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now(), limits = SCROLL_LIMITS }) {
  const queryArgs = target => target.kind === 'compose' ? { compose: { ownerViewId: target.ownerViewId, nodeId: target.nodeId } } : { view: target.id };
  async function read(target) {
    const info = await query(queryArgs(target));
    if (!info) throw fail('not-found', 'O componente rolável saiu da tela.');
    return info;
  }
  /** Reads until two reads in a row agree (the app's scroll may be animated) or settleMs passed. */
  async function settled(target) {
    const until = now() + limits.settleMs; let last = await read(target);
    for (;;) {
      await sleep(limits.pollMs); const next = await read(target);
      if ((Math.abs(next.x - last.x) < 0.01 && Math.abs(next.y - last.y) < 0.01) || now() >= until) return next;
      last = next;
    }
  }
  async function resolve(rawTarget) { return resolveScrollTarget(await elements(), views(), scrollSelector(rawTarget)); }
  /**
   * A lazy list. Its own numbers are an estimate, so the list is steered by what is exact for it: the first item (ScrollToIndex 0), the end of the content (it stops
   * scrolling forward) and ScrollBy, which moves the content by exactly the px asked while there is content left. A position is that many px from the first item. A
   * percentage between the ends needs the length of the content, which the list does not know: it is measured once, scrolling to the end (large steps, then steps of
   * half the list's height whose real movement is read from the components on screen), and then the list goes to that fraction of it.
   */
  async function lazy(target, request, first) {
    const axis = first.vertical || !first.horizontal ? 'y' : 'x', percentKey = axis === 'y' ? 'percentY' : 'percentX', maxKey = axis === 'y' ? 'maxY' : 'maxX', percent = request[percentKey], position = request[axis];
    if (percent === undefined && position === undefined) throw fail('bad-args', `Esta lista rola só na ${axis === 'y' ? 'vertical' : 'horizontal'}: diga ${axis} ou ${percentKey}.`);
    const along = value => axis === 'y' ? [0, value] : [value, 0], ended = info => (axis === 'y' ? info.maxY - info.y : info.maxX - info.x) <= 0.01, started = info => (axis === 'y' ? info.y : info.x) <= 0.01;
    const extent = Math.max(64, axis === 'y' ? target.bounds.bottom - target.bounds.top : target.bounds.right - target.bounds.left);
    let steps = 0, info = first;
    const spend = () => { if (++steps > limits.measureSteps) throw fail('unsupported', `A lista é longa demais para rolar até uma porcentagem (mais de ${limits.measureSteps} passos); use uma posição em px (y) ou 0 / 100.`); };
    const by = async value => { spend(); await scrollBy(target, ...along(value)); info = await settled(target); };
    const toStart = async () => {
      if (first.scrollToIndex && typeof scrollToIndex === 'function') { spend(); await scrollToIndex(target, 0); info = await settled(target); }
      while (!started(info)) { const was = info; await by(-limits.maxDelta); if (Math.abs(was.x - info.x) < 0.01 && Math.abs(was.y - info.y) < 0.01) break; }
    };
    const advance = async distance => { for (let left = distance; left > 0.5 && !ended(info); ) { const step = Math.min(left, limits.maxDelta); await by(step); left -= step; } };
    const done = extra => scrollResult(target, info, { steps, ...extra });
    if (percent !== undefined && percent >= 100) {
      while (!ended(info)) { const was = info; await by(limits.maxDelta); if (Math.abs(was.x - info.x) < 0.01 && Math.abs(was.y - info.y) < 0.01) break; }
      return done({ [percentKey]: ended(info) ? 100 : null, reached: ended(info), via: 'ScrollBy' });
    }
    await toStart();
    if ((percent ?? position) <= 0) return done({ [axis]: 0, [percentKey]: 0, reached: started(info), via: 'ScrollToIndex' });
    if (position !== undefined) {
      await advance(position); const clamped = ended(info);   // the content ended on the way (or exactly there: the list cannot tell the two apart)
      return done({ [axis]: clamped ? null : round(position), [percentKey]: clamped ? 100 : null, reached: !clamped, via: 'ScrollToIndex + ScrollBy' });
    }
    // the length of the content: large steps until the end is passed, back to the last position known, then measured steps to the end
    const large = extent * 4, small = Math.max(32, Math.floor(extent / 2)); let known = 0;
    for (;;) { await by(large); if (ended(info)) break; known += large; }
    await toStart(); await advance(known);
    let range = known;
    while (!ended(info)) {
      const before = await elements(); await by(small);
      const moved = ended(info) ? contentShift(before, await elements(), target, axis) : small;
      if (moved === null) throw fail('unsupported', 'Não foi possível medir o conteúdo desta lista (nenhum componente inteiro ficou na tela entre dois passos); use uma posição em px ou 0 / 100.');
      range += Math.max(0, moved);
    }
    const goal = Math.round(range * percent / 100);
    await toStart(); await advance(goal);
    return done({ [axis]: goal, [maxKey]: round(range), [percentKey]: range > 0 ? round(goal / range * 100) : 0, reached: true, measured: true, via: 'ScrollToIndex + ScrollBy' });
  }
  return {
    /** Where a scrollable is, without moving it. */
    async info(args = {}) { const target = await resolve(args.target); return scrollResult(target, await read(target)); },
    /** args: { target?, x?, y?, percentX?, percentY? } -> scrollResult plus { reached, steps, via }. */
    async scrollTo(args = {}) {
      const request = scrollRequest(args), target = await resolve(args.target);
      let info = await read(target), steps = 0, reached = false, previous = null;
      if (info.disabled) throw fail('bad-args', `${target.name ?? 'O componente'} está desabilitado: não rola.`);
      if (info.lazy) return lazy(target, request, info);
      for (;;) {
        const goal = scrollGoal(info, request), dx = goal.x - info.x, dy = goal.y - info.y;
        if (Math.abs(dx) <= limits.tolerance && Math.abs(dy) <= limits.tolerance) { reached = true; break; }
        if (steps >= limits.maxSteps) break;
        if (previous && Math.abs(previous.x - info.x) < 0.01 && Math.abs(previous.y - info.y) < 0.01) break;   // the last step moved nothing: the end of the content, or a scrollable that refuses
        previous = info; steps++;
        const clamp = value => Math.max(-limits.maxDelta, Math.min(limits.maxDelta, value));
        await scrollBy(target, clamp(Math.abs(dx) <= limits.tolerance ? 0 : dx), clamp(Math.abs(dy) <= limits.tolerance ? 0 : dy));
        info = await settled(target);
      }
      return scrollResult(target, info, { reached, steps, via: target.kind === 'compose' ? 'ScrollBy' : 'View.scrollBy' });
    },
  };
}
