import { currentThread } from './interpreter.js?v=643e640e353f';

/**
 * Host fast paths for three small framework methods that sit on every file read and write (FileInputStream/FileOutputStream/RandomAccessFile -> IoBridge -> BlockGuardOs): a tiny libcore
 * read costs half a dozen Java frames, and the guard lookups are a third of them. Each fast path keeps the exact contract of the method it replaces:
 *   ArrayUtils.throwsIfOutOfBounds   the same ArrayIndexOutOfBoundsException messages;
 *   BlockGuard.get/setThreadPolicy   the per-thread policy (LAX_POLICY until StrictMode sets one) kept in a field of the scheduler thread instead of a ThreadLocal map lookup;
 *   IoTracker.trackIo(int)           the same counters, and the same onUnbufferedIO() call on the policy after more than 10 small operations.
 * They apply only to the framework's own classes (the resolver checks the origin) and are looked up once per call site by the resolution cache.
 */
const TRACKER = 'Llibcore/io/IoTracker;';
const field = name => `${TRACKER}->${name}`;

export const FAST_PATHS = new Map([
  ['Lcom/android/internal/util/ArrayUtils;->throwsIfOutOfBounds(III)V', (rt, [length, offset, count]) => {
    if (length < 0) rt.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `Negative length: ${length}`);
    if ((offset | count) < 0 || offset > length - count) rt.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `length=${length}; regionStart=${offset}; regionLength=${count}`);
  }],
  ['Ldalvik/system/BlockGuard;->getThreadPolicy()Ldalvik/system/BlockGuard$Policy;', rt => {
    const thread = currentThread(rt);
    return thread.guardPolicy ??= rt.readStatic({ owner: 'Ldalvik/system/BlockGuard;', name: 'LAX_POLICY', type: 'Ldalvik/system/BlockGuard$Policy;' });
  }],
  ['Ldalvik/system/BlockGuard;->setThreadPolicy(Ldalvik/system/BlockGuard$Policy;)V', (rt, [policy]) => {
    if (policy === null || policy === undefined || policy === 0) rt.throwJava('Ljava/lang/NullPointerException;', null);
    currentThread(rt).guardPolicy = policy;
  }],
  [`${TRACKER}->trackIo(I)V`, (rt, [self, byteCount]) => {
    const fields = rt.object(self).fields;
    const ops = (fields.get(field('opCount:I')) ?? 0) + 1, total = ((fields.get(field('totalByteCount:I')) ?? 0) + byteCount) | 0;
    fields.set(field('opCount:I'), ops); fields.set(field('totalByteCount:I'), total);
    const open = fields.get(field('isOpen:Z')) ?? 1;
    if (open && ops > 10 && total < 10 * 512) {
      const policy = (currentThread(rt).guardPolicy ?? rt.dispatch({ owner: 'Ldalvik/system/BlockGuard;', name: 'getThreadPolicy', parameters: [], result: 'Ldalvik/system/BlockGuard$Policy;', signature: '()Ldalvik/system/BlockGuard$Policy;' }, [], 'static'));
      rt.dispatch({ owner: 'Ldalvik/system/BlockGuard$Policy;', name: 'onUnbufferedIO', parameters: [], result: 'V', signature: '()V' }, [policy], 'virtual');
      fields.set(field('isOpen:Z'), 0);
    }
  }],
]);
