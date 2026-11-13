import { createHostRegistry } from './host-contract.js?v=79ac9440027a';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=79ac9440027a';

// android.widget.Toast (android-13.0.0_r1 Toast.java + NotificationManagerService toast queue) for the virtual device: toasts of this app are shown one at a time in the order they were shown;
// a toast stays LENGTH_SHORT (2000 ms) or LENGTH_LONG (3500 ms) of VM time, then the next one comes up. At most 5 toasts of the package wait in the queue (MAX_PACKAGE_TOASTS): later ones are
// dropped. Toast.Callback (API 30) gets onToastShown when the toast comes up and onToastHidden when it goes away (also on cancel). The page can read what is on screen through
// platform.toastState(): { current: {text, gravity, xOffset, yOffset, duration}, queued }.
const TOAST = 'Landroid/widget/Toast;', CALLBACK = 'Landroid/widget/Toast$Callback;', CONTEXT = 'Landroid/content/Context;', CHARS = 'Ljava/lang/CharSequence;', VIEW = 'Landroid/view/View;', OBJECT = 'Ljava/lang/Object;';
const SHORT_MS = 2000, LONG_MS = 3500, MAX_QUEUED = 5, GRAVITY_NONE = 0, GRAVITY_DEFAULT = 0x51;   // Gravity.BOTTOM | CENTER_HORIZONTAL
const nullish = v => v === null || v === undefined || v === 0;

export function createToastHost(platform) {
  const registry = createHostRegistry(), { def, type, staticField } = registry;
  type(TOAST, OBJECT, [], { allocatable: true }); type(CALLBACK, OBJECT, [], { allocatable: true });
  staticField(TOAST, 'LENGTH_SHORT', 'I', () => 0); staticField(TOAST, 'LENGTH_LONG', 'I', () => 1);
  const queue = gcRoot([]); let current = null, currentInfo = null;
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const npe = (r, m = null) => r.throwJava('Ljava/lang/NullPointerException;', m);
  const t = (r, self) => r.object(self).toast ??= { text: null, view: null, duration: 0, gravity: GRAVITY_DEFAULT, x: 0, y: 0, hMargin: 0, vMargin: 0, callbacks: [], shown: false };
  const textOf = (r, v) => nullish(v) ? null : typeof v === 'string' ? v : r.stringCharacters(v);
  const notify = (r, toast, name) => { for (const callback of [...toast.callbacks]) platform.queueTask(() => call(r, callback, CALLBACK, name, [], 'V'), 0, [callback]); };
  const next = r => {
    if (current !== null || queue.length === 0) return;
    const self = queue.shift(), toast = t(r, self); current = self; toast.shown = true; currentInfo = { text: toast.text, gravity: toast.gravity, xOffset: toast.x, yOffset: toast.y, duration: toast.duration };
    r.record(`TOAST show ${JSON.stringify(toast.text ?? '<custom view>')}`); notify(r, toast, 'onToastShown');
    platform.queueTask(() => hide(r, self), toast.duration === 1 ? LONG_MS : SHORT_MS, [self]);
  };
  const hide = (r, self) => {
    const toast = t(r, self); if (current !== null && current.ref === self.ref) { current = null; currentInfo = null; toast.shown = false; notify(r, toast, 'onToastHidden'); next(r); }
  };
  platform.toastState = () => ({ current: currentInfo, queued: queue.length });
  const make = (r, self, text, duration) => { const s = t(r, self); s.text = text; s.duration = duration; return self; };
  def(TOAST, '<init>', `(${CONTEXT})V`, (r, _m, [self, context]) => { if (nullish(context)) npe(r); t(r, self); });
  const makeText = (r, context, text, duration) => { if (nullish(context)) npe(r, 'context'); const self = r.allocate(TOAST); r.object(self).toast = null; return make(r, self, text, duration); };
  def(TOAST, 'makeText', `(${CONTEXT}${CHARS}I)${TOAST}`, (r, _m, [context, text, duration]) => makeText(r, context, textOf(r, text), duration), { static: true });
  def(TOAST, 'makeText', `(${CONTEXT}II)${TOAST}`, (r, _m, [context, resId, duration]) => makeText(r, context, textOf(r, call(r, call(r, context, CONTEXT, 'getResources', [], 'Landroid/content/res/Resources;'), 'Landroid/content/res/Resources;', 'getText', ['I'], CHARS, [resId])), duration), { static: true });
  def(TOAST, 'setText', `(${CHARS})V`, (r, _m, [self, text]) => { t(r, self).text = textOf(r, text); });
  def(TOAST, 'setText', '(I)V', (r, _m, [self, resId]) => { t(r, self).text = textOf(r, call(r, call(r, platform.application, CONTEXT, 'getResources', [], 'Landroid/content/res/Resources;'), 'Landroid/content/res/Resources;', 'getText', ['I'], CHARS, [resId])); });
  def(TOAST, 'setDuration', '(I)V', (r, _m, [self, duration]) => { t(r, self).duration = duration; }); def(TOAST, 'getDuration', '()I', (r, _m, [self]) => t(r, self).duration);
  def(TOAST, 'setGravity', '(III)V', (r, _m, [self, gravity, x, y]) => { Object.assign(t(r, self), { gravity, x, y }); }); def(TOAST, 'getGravity', '()I', (r, _m, [self]) => t(r, self).gravity);
  def(TOAST, 'getXOffset', '()I', (r, _m, [self]) => t(r, self).x); def(TOAST, 'getYOffset', '()I', (r, _m, [self]) => t(r, self).y);
  def(TOAST, 'setMargin', '(FF)V', (r, _m, [self, h, v]) => { Object.assign(t(r, self), { hMargin: h, vMargin: v }); });
  def(TOAST, 'getHorizontalMargin', '()F', (r, _m, [self]) => t(r, self).hMargin); def(TOAST, 'getVerticalMargin', '()F', (r, _m, [self]) => t(r, self).vMargin);
  def(TOAST, 'setView', `(${VIEW})V`, (r, _m, [self, view]) => { t(r, self).view = nullish(view) ? null : view; }); def(TOAST, 'getView', `()${VIEW}`, (r, _m, [self]) => t(r, self).view);   // a text toast has no View (Android 11+)
  def(TOAST, 'show', '()V', (r, _m, [self]) => {
    const toast = t(r, self); if (toast.text === null && toast.view === null) r.throwJava('Ljava/lang/RuntimeException;', 'setView must have been called');
    const own = queue.filter(entry => entry.ref !== self.ref).length + (current !== null ? 1 : 0);
    if (own >= MAX_QUEUED) { r.record('TOAST dropped: too many toasts queued for the package'); return; }
    if (current?.ref === self.ref || queue.some(entry => entry.ref === self.ref)) return;
    queue.push(self); next(r);
  });
  def(TOAST, 'cancel', '()V', (r, _m, [self]) => { const i = queue.findIndex(entry => entry.ref === self.ref); if (i >= 0) queue.splice(i, 1); else hide(r, self); });
  def(TOAST, 'addCallback', `(${CALLBACK})V`, (r, _m, [self, callback]) => { if (nullish(callback)) npe(r, 'callback'); t(r, self).callbacks.push(callback); });
  def(TOAST, 'removeCallback', `(${CALLBACK})V`, (r, _m, [self, callback]) => { const s = t(r, self), i = s.callbacks.findIndex(c => c.ref === callback?.ref); if (i >= 0) s.callbacks.splice(i, 1); });
  def(CALLBACK, '<init>', '()V', () => {}); def(CALLBACK, 'onToastShown', '()V', () => {}); def(CALLBACK, 'onToastHidden', '()V', () => {});
  void GRAVITY_NONE;
  return { ...registry, [GC_ROOTS](visit) { visit(queue); visit(current); } };
}
