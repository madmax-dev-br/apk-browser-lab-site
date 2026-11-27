// Finding the APK Lab Relay (its own project, github.com/madmax-dev-br/apk-lab-relay) on this computer by itself (the owner's decision, 2026-11-20: no token, no address to copy).
// The relay answers GET http://127.0.0.1:8787/hello, from the lab's origins only, with {"relay":"apk-lab-relay","version","features"}; the page asks it on load, when the Device
// section opens and before an APK is loaded or launched, and uses the relay as the device's Proxy when the field is empty. A typed Proxy is a custom proxy and wins.
//
// Only a complete answer counts: until a probe has said "this is the APK Lab Relay" the device keeps the proxy it had (none on a fresh page), so no request of the app goes to a
// half-detected relay; the proxy a run uses is decided when the run is loaded or launched (src/app.js), never in the middle of an exchange. Probes are cheap: one GET to a
// loopback port, bounded by a timeout, at most one in flight, and a result is reused for a few seconds.
//
// A browser may ask the user before a public page reaches this computer (Chrome's Local Network Access permission, "loopback-network" / "local-network-access"): while it would
// ask, nothing is probed without the user's gesture (localNetworkAccess says 'prompt'; the page offers "Look for the relay"), so a visitor who never uses a relay is never asked.
// A page served from this computer (127.0.0.1, localhost) needs no permission. VM-free; no process.*.

/** Kept equal to DEFAULT_PORT / RELAY_NAME of apk-lab-relay's src/relay.cjs (tests/relay-detect.test.mjs checks it). */
export const RELAY_DEFAULT_PORT = 8787;
export const RELAY_NAME = 'apk-lab-relay';
export const RELAY_AUTO_BASE = `http://127.0.0.1:${RELAY_DEFAULT_PORT}`;
/** The Proxy the device uses for a relay found by itself. */
export const RELAY_AUTO_PROXY = `${RELAY_AUTO_BASE}/?url={url}`;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * Whether this page may reach this computer without the browser asking: 'granted' (asked before, or a page served from this computer), 'prompt' (the browser would ask first),
 * 'denied' (the user or a policy refused), 'unsupported' (the browser has no such permission: it never asks).
 */
export async function localNetworkAccess({ permissions = globalThis.navigator?.permissions, location = globalThis.location } = {}) {
  try { if (LOOPBACK.has(String(location?.hostname ?? ''))) return 'granted'; } catch { /* no location: ask the browser */ }
  if (typeof permissions?.query !== 'function') return 'unsupported';
  for (const name of ['loopback-network', 'local-network-access']) {
    try { const status = await permissions.query({ name }); if (['granted', 'prompt', 'denied'].includes(status?.state)) return status.state; } catch { /* an unknown name in this browser */ }
  }
  return 'unsupported';
}

/** One probe: GET <base>/hello, bounded by `timeoutMs`. -> { found: true, version, features } | { found: false, reason }. Never throws. */
export async function probeRelay({ fetchImpl = (...args) => globalThis.fetch(...args), base = RELAY_AUTO_BASE, timeoutMs = 1500, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null; let timedOut = false;
  const timer = setTimer(() => { timedOut = true; controller?.abort(); }, timeoutMs);
  try {
    const response = await fetchImpl(`${base}/hello`, { cache: 'no-store', credentials: 'omit', ...(controller ? { signal: controller.signal } : {}) });
    if (!response?.ok) return { found: false, reason: `another server answers on ${hostOf(base)} (HTTP ${response?.status ?? '?'})` };
    let body = null; try { body = await response.json(); } catch { body = null; }
    if (body?.relay !== RELAY_NAME) return { found: false, reason: `another server answers on ${hostOf(base)}` };
    return { found: true, version: typeof body.version === 'string' ? body.version.slice(0, 32) : '', features: Array.isArray(body.features) ? body.features.map(String).slice(0, 16) : [] };
  } catch { return { found: false, reason: timedOut ? `no answer from ${hostOf(base)} in ${timeoutMs} ms` : `nothing answers on ${hostOf(base)}` }; }
  finally { clearTimer(timer); }
}
const hostOf = base => { try { return new URL(base).host; } catch { return String(base); } };

/**
 * The page's detector. state: { status: 'unknown' | 'checking' | 'found' | 'absent' | 'needs-permission' | 'blocked', version, reason, checkedAt }; `found` is the last complete
 * answer (it stays while a new probe runs). check({ gesture, maxAgeMs }) probes unless a result younger than maxAgeMs is at hand; `gesture`: the user asked (a click), so a
 * browser that would ask may ask now. onChange(state) hears every change of status or version.
 */
export function createRelayDetector({ probe = options => probeRelay(options), access = () => localNetworkAccess(), now = () => Date.now(), onChange = () => {}, maxAgeMs = 3000 } = {}) {
  let state = { status: 'unknown', version: null, reason: null, checkedAt: null, found: false }, inFlight = null;
  const set = next => { const before = `${state.status}|${state.version}|${state.reason}`; state = { ...state, ...next }; if (`${state.status}|${state.version}|${state.reason}` !== before) { try { onChange(state); } catch { /* a listener's failure is not the detector's */ } } };
  async function run(gesture) {
    const permission = await access().catch(() => 'unsupported');
    if (permission === 'denied') { set({ status: 'blocked', found: false, version: null, reason: 'the browser blocks this page from reaching this computer', checkedAt: now() }); return state; }
    if (permission === 'prompt' && !gesture) { if (!state.found) set({ status: 'needs-permission', reason: null, checkedAt: null }); return state; }
    if (!state.found) set({ status: 'checking' });
    const result = await probe({});
    set(result.found ? { status: 'found', found: true, version: result.version || null, features: result.features, reason: null, checkedAt: now() } : { status: 'absent', found: false, version: null, reason: result.reason ?? null, checkedAt: now() });
    return state;
  }
  return {
    get state() { return state; },
    check({ gesture = false, maxAgeMs: age = maxAgeMs } = {}) {
      if (state.checkedAt !== null && now() - state.checkedAt < age && (state.status === 'found' || state.status === 'absent')) return Promise.resolve(state);
      if (!inFlight) inFlight = run(gesture).finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}

/** The proxy a device uses: the Proxy field (custom) when it holds a valid address, else the relay found by itself, else none. -> { url, source: 'custom' | 'auto' | 'none', host } */
export function effectiveProxy(customUrl, detection) {
  const typed = String(customUrl ?? '').trim();
  if (typed) { let host = null; try { host = new URL(typed.replace('{url}', 'x')).host; } catch { host = null; } return { url: typed, source: 'custom', host }; }
  if (detection?.found) return { url: RELAY_AUTO_PROXY, source: 'auto', host: hostOf(RELAY_AUTO_BASE), version: detection.version ?? null };
  return { url: '', source: 'none', host: null };
}

/** One line for the execution log: which proxy a run uses. */
export function describeProxyForTrace(proxy) {
  if (proxy?.source === 'custom') return `Network proxy: custom proxy ${proxy.host ?? proxy.url} (Controls › Network › Proxy)`;
  if (proxy?.source === 'auto') return `Network proxy: APK Lab Relay at ${proxy.host}${proxy.version ? ` ${proxy.version}` : ''} (found automatically)`;
  return 'Network proxy: none (no relay running on 127.0.0.1:8787, Proxy field empty): the browser fetches each URL directly, CORS applies';
}
