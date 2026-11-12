// "Aquecendo" (snapshot.warmup): is the VM still paying for first-time work? When an app opens, most of the time goes to things that happen once per class or method -- loading and
// initializing classes, preparing a method the first time it is called (the JavaScript VM decodes it and later compiles it; the WebAssembly core copies its code and resolves its
// constants) -- and the app feels slow until that tapers off. Both engines already time that work (src/time-breakdown.js: the DECODE, COMPILE and INIT buckets; the core charges
// its linker to DECODE). The tracker looks at the share of the last WARM_WINDOW_MS of wall time spent there: warming while it is at least WARM_SHARE, warm once a whole window
// stayed below it. A new screen brings new classes and methods, so the state can go back to warming: `episodes` counts those. DOM-free, no process.*.
import { BUCKET } from './time-breakdown.js?v=0d5a397ebb41';

export const WARM_WINDOW_MS = 3000, WARM_SHARE = 0.03, WARM_POLL_MS = 500, WARM_HOT = 8;   // WARM_HOT: methods compiled within a window that still count as warming

/** { ms, events }: the first-time work of `runtime` so far, or null when it is not timed. */
export function firstTimeWork(runtime) {
  const tb = runtime?.tb; if (!tb?.ms) return null;
  const sum = (now, life) => { let n = 0; for (const b of [BUCKET.DECODE, BUCKET.COMPILE, BUCKET.INIT]) n += now[b] + (life ? life[b] : 0); return n; };   // the breakdown is reset for every operation: the lifetime totals keep what it dropped
  return { ms: sum(tb.ms, tb.lifeMs), events: sum(tb.counts, tb.lifeCounts), hot: (runtime.jitCompiled ?? 0) + (runtime.t2Compiled ?? 0) };   // hot: methods the JavaScript VM compiled so far (it compiles a method once it has run often: methods still getting there are warm-up too)
}

export class WarmupTracker {
  constructor() { this.samples = []; this.startedAt = null; this.warming = true; this.firstWarmAfterMs = null; this.episodes = 1; this.last = null; }
  /** A sample of firstTimeWork() at `now` (ms): returns the state the snapshot carries. */
  observe(work, now) {
    if (work === null || work === undefined) return null;
    if (this.startedAt === null) this.startedAt = now;
    const samples = this.samples, hot = work.hot ?? 0; samples.push([now, work.ms, hot]);
    while (samples.length > 2 && now - samples[1][0] >= WARM_WINDOW_MS) samples.shift();   // the oldest sample kept is the last one at least a window old
    const span = now - samples[0][0], recentMs = work.ms - samples[0][1], recentHot = hot - samples[0][2], full = span >= WARM_WINDOW_MS, share = span > 0 ? recentMs / span : 1, busy = share >= WARM_SHARE || recentHot >= WARM_HOT;
    if (full && !busy) { if (this.warming) { this.warming = false; this.firstWarmAfterMs ??= now - this.startedAt; } }
    else if (busy && !this.warming) { this.warming = true; this.episodes++; }
    return this.last = { warming: this.warming, share: Math.round(Math.min(1, share) * 1000) / 1000, recentMs: Math.round(recentMs), windowMs: Math.round(Math.min(span, WARM_WINDOW_MS)),
      totalMs: Math.round(work.ms), events: work.events, recentCompiled: recentHot, compiled: hot, sinceStartMs: Math.round(now - this.startedAt), warmAfterMs: this.firstWarmAfterMs === null ? null : Math.round(this.firstWarmAfterMs), episodes: this.episodes };
  }
  /** While warming with nothing else scheduled, the Worker samples again after this long, so the flip to warm is posted even when the app is idle; null when warm. */
  wakeDelay() { return this.warming && this.startedAt !== null ? WARM_POLL_MS : null; }
  /** Would a sample now change the state? (The Worker posts a snapshot for it when no event ran.) */
  flipDue(work, now) {
    if (work === null || work === undefined || !this.warming || this.samples.length === 0) return false;
    const oldest = this.samples.length > 1 && now - this.samples[1][0] >= WARM_WINDOW_MS ? this.samples[1] : this.samples[0], span = now - oldest[0];
    return span >= WARM_WINDOW_MS && (work.ms - oldest[1]) / span < WARM_SHARE && (work.hot ?? 0) - oldest[2] < WARM_HOT;
  }
}

/** The chip's text and title (Portuguese) for a snapshot.warmup. */
export function warmupLabel(warmup) {
  if (!warmup) return null;
  const seconds = ms => (ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  if (warmup.warming) return { text: `◌ aquecendo ${Math.round(warmup.share * 100)}%`, warming: true,
    title: `Aquecendo: ${Math.round(warmup.share * 100)}% dos últimos ${seconds(warmup.windowMs)} s foram trabalho de primeira vez (carga e inicialização de classes, preparo de métodos)${warmup.recentCompiled ? `; ${warmup.recentCompiled} métodos compilados nesse intervalo` : ''}. Total até agora: ${seconds(warmup.totalMs)} s.${warmup.episodes > 1 ? ' Uma tela nova trouxe classes e métodos novos.' : ''}` };
  return { text: `● aquecido${warmup.warmAfterMs !== null ? ` em ${seconds(warmup.warmAfterMs)} s` : ''}`, warming: false,
    title: `Aquecido: quase nenhum trabalho de primeira vez nos últimos ${seconds(warmup.windowMs)} s. Primeira vez que ficou assim: ${warmup.warmAfterMs !== null ? seconds(warmup.warmAfterMs) + ' s depois de abrir' : '—'}; trabalho de primeira vez no total: ${seconds(warmup.totalMs)} s.` };
}
