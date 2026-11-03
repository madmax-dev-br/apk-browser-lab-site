// The compact block at the very top of "Copiar diagnóstico" and "Estado da tela": what a person photographing the screen needs first -- memory, who holds it, the one-line uncaught exceptions,
// the main thread and the busiest methods. The long sections (threads, queue, profile, log) follow it.
const dotted = type => String(type ?? '?').replace(/^L|;$/g, '').replaceAll('/', '.');
const MiB = 1048576, BYTES_PER_OBJECT = 1600;

/** Lines of the summary for `runtime`; never throws (every part is optional). */
export function reportSummary(runtime, { heartbeat = null, error = null } = {}) {
  const out = ['== Resumo ==']; const part = fn => { try { fn(); } catch { /* a part of the summary is unavailable */ } };
  part(() => {   // an internal JavaScript error: its own message and the top frames, so one photo has them
    const stack = error?.details?.jsStack; if (!stack) return;
    const lines = String(stack).split('\n'); out.push(`ERRO INTERNO: ${lines[0]}`);
    const frames = lines.slice(1).filter(line => /\bat\b/.test(line)).slice(0, 3).map(line => line.trim().replace(/file:\/\/\/[^ )]*\//g, '').replace(/^at /, ''));
    if (frames.length) out.push(`  em: ${frames.join(' ← ')}`);
  });
  part(() => {   // (a) memory
    const live = runtime.heap.size, limit = runtime.maxHeapObjects, last = runtime.gcPhases?.[0];
    out.push(`Memória: ${live} de ${limit} objetos vivos (${Math.round(100 * live / limit)}%), ~${Math.round(live * BYTES_PER_OBJECT / MiB)} MiB estimados; ${last ? `última coleta liberou ${last.before - last.after} (${last.before} → ${last.after}); ${runtime.gcStats?.collections ?? 0} coletas` : 'nenhuma coleta ainda'}${runtime.oomCount ? `; OutOfMemoryError ${runtime.oomCount}×` : ''}`);
  });
  part(() => {   // (b) survivors, (c) who keeps them, retention paths
    const last = runtime.gcPhases?.[0]; if (!last) return;
    if (last.survivorsByCount?.length) out.push(`sobreviventes (por quantidade): ${last.survivorsByCount.slice(0, 8).map(c => `${c.n} ${c.type}`).join(', ')}`);
    if (last.survivorsByBytes?.length) out.push(`sobreviventes (por bytes estimados): ${last.survivorsByBytes.slice(0, 8).map(c => `${Math.round(c.bytes / 1024)} KiB ${c.type}`).join(', ')}`);
    if (last.categories?.length) {
      out.push(`quem mantém vivo (primeira raiz que alcança): ${last.categories.slice(0, 6).map(c => `${c.n} ${c.name}`).join('; ')}`);
      const top = last.categories[0]?.topClass; if (top) out.push(`  maior grupo "${last.categories[0].name}": principalmente ${top.n} ${top.type}`);
    }
    if (last.byDex?.length) out.push(`vivos por origem da classe: ${last.byDex.map(d => `${d.n} ${d.dex}`).join(', ')}`);
    const retention = runtime.gcRetention;
    if (retention?.paths?.length) out.push(`exemplo de retenção (${dotted(retention.type)}):`, ...retention.paths.map(path => `  ${path}`));
  });
  part(() => {   // (d) one line per thread
    const table = runtime.uncaughtExceptions; if (!table?.size) return;
    out.push('exceções não tratadas (uma linha por thread; pilhas completas mais abaixo):');
    for (const entry of [...table.values()].reverse().slice(0, 8)) out.push(`  ${entry.thread}${entry.count > 1 ? ` (${entry.count}x)` : ''}: ${entry.type}${entry.message ? ': ' + entry.message.slice(0, 120) : ''}`);
  });
  part(() => {   // (e) main thread
    const main = runtime.scheduler?.main; if (!main) return;
    const frames = (main.frames ?? []).slice(-6).reverse().map(frame => frame.method ? `${dotted(frame.method.owner)}.${frame.method.name}` : frame.cont ? '(chamada do host)' : '?');
    out.push(`thread principal: ${main.state}${main.blocked ? ` (${main.blocked.reason ?? 'espera'})` : ''}${main.nestedDepth ? `, dentro de chamada nativa aninhada (${main.nestedDepth})` : ''}${frames.length ? '; ' + frames.join(' ← ') : ''}`);
  });
  part(() => {   // (f) busiest methods
    const busiest = heartbeat?.busiest?.length ? heartbeat.busiest : runtime.profile?.top?.(5);
    if (busiest?.length) out.push(`métodos mais ocupados: ${busiest.slice(0, 5).join(', ')}`);
  });
  return out.length > 1 ? [...out, '== fim do resumo =='] : [];
}

const IDLE_WAIT = /LockSupport\.park|Unsafe\.park|Object\.wait|ThreadPoolExecutor\.getTask|ConditionObject\.await|CountDownLatch\.await|Semaphore\.acquire|SynchronousQueue|LinkedBlockingQueue\.take|DelayedWorkQueue|AbstractQueuedSynchronizer|Thread\.sleep|CoroutineScheduler\$Worker\.park|parkNanos|\.awaitNanos|Looper\.loop/;
/** Groups threads by name pattern and state; returns { groups: ['45× pool-N-thread-N [blocked: LockSupport.park]'], shown: [threads worth printing in full] }. */
export function collapseThreads(runtime, threads, mainThread) {
  const groups = new Map(), shown = [];
  for (const thread of threads) {
    const frames = (thread.frames ?? []).slice(-4).map(frame => frame.method?.key ?? '');
    const idle = thread !== mainThread && thread.state === 'blocked' && (frames.length === 0 || frames.some(key => IDLE_WAIT.test(key)));
    if (!idle) { shown.push(thread); continue; }
    const pattern = String(thread.name ?? '?').replace(/\d+/g, 'N'), reason = thread.blocked?.reason ?? 'espera', key = `${pattern} [${thread.state}: ${reason}]`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return { groups: [...groups].sort((a, b) => b[1] - a[1]).map(([key, n]) => `${n}× ${key}`), shown };
}
