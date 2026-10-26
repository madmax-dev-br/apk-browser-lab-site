import { APKError } from './apk-runtime.js?v=5c4318daa7f6';
import { gcRoot } from './heap-gc.js?v=5c4318daa7f6';

const OBSERVER = 'Landroid/view/ViewTreeObserver;';
const GET_OBSERVER = 'Landroid/view/View;->getViewTreeObserver()Landroid/view/ViewTreeObserver;';
const call = (runtime, receiver, name, parameters = [], result = 'V', values = [], mode = 'virtual') => runtime.dispatch(
  { owner: OBSERVER, name, parameters, result, signature: `(${parameters.join('')})${result}` },
  [receiver, ...values], mode);

/** Window-event boundary. Listener storage, mutation and dispatch are original AOSP DEX. */
export function createViewTreeHost(platform) {
  const windows = gcRoot(new Map());
  const newObserver = (runtime, context) => {
    if (!runtime.classes.has(OBSERVER)) throw new APKError('ViewTreeObserver requires the source-compiled AOSP boot layer', { kind: 'framework-source-required', className: OBSERVER });
    if (!context) throw new APKError('ViewTreeObserver requires a View Context');
    const observer = runtime.allocate(OBSERVER);
    call(runtime, observer, '<init>', ['Landroid/content/Context;'], 'V', [context], 'direct');
    return observer;
  };
  const contextFor = (runtime, view) => view.context ?? runtime.activity ?? platform.application;
  const windowKey = (runtime, view) => {
    // A detached View owns a floating observer. Attached descendants use their window's
    // observer, not independent listener registries for each DOM element.
    const seen = new Set(); let current = view;
    while (current.parent) {
      if (seen.has(current.id) || seen.size >= 4096) throw new APKError('Cyclic/excessive ViewTreeObserver hierarchy');
      seen.add(current.id); current = runtime.object(current.parent);
    }
    return current.id;
  };
  const windowFor = (runtime, view) => {
    const key = windowKey(runtime, view);
    if (!windows.has(key)) windows.set(key, newObserver(runtime, contextFor(runtime, view)));
    return windows.get(key);
  };
  const observerFor = (runtime, view) => {
    if (view.attached) return windowFor(runtime, view);
    return view.floatingTreeObserver ??= newObserver(runtime, contextFor(runtime, view));
  };
  return {
    supports: key => key === GET_OBSERVER,
    invoke(runtime, method, args) {
      if (`${method.owner}->${method.name}${method.signature}` !== GET_OBSERVER) throw new APKError('Unsupported view-tree host method');
      return observerFor(runtime, runtime.object(args[0]));
    },
    afterAttach(runtime, receiver, attached) {
      if (!runtime.classes.has(OBSERVER)) return;
      const view = runtime.object(receiver);
      if (attached) {
        const observer = windowFor(runtime, view);
        const object = runtime.object(observer);
        const pending = [receiver], seen = new Set();
        while (pending.length) {
          const child = runtime.object(pending.pop());
          if (seen.has(child.id) || seen.size >= 4096) throw new APKError('Cyclic/excessive ViewTreeObserver attachment');
          seen.add(child.id);
          if (child.floatingTreeObserver && child.floatingTreeObserver.ref !== observer.ref) {
            call(runtime, observer, 'merge', [OBSERVER], 'V', [child.floatingTreeObserver]);
            child.floatingTreeObserver = null;
          }
          pending.push(...(child.children || []));
        }
        (object.hostAttachedViews ??= new Set()).add(view.id);
        if (!object.hostWindowAttached) {
          object.hostWindowAttached = true;
          call(runtime, observer, 'dispatchOnWindowAttachedChange', ['Z'], 'V', [1]);
          call(runtime, observer, 'dispatchOnWindowFocusChange', ['Z'], 'V', [1]);
        }
        view.attachedTreeObserver = observer;
      } else {
        const observer = view.attachedTreeObserver;
        if (observer) runtime.object(observer).hostAttachedViews?.delete(view.id);
        if (observer && !runtime.object(observer).hostAttachedViews?.size && runtime.object(observer).hostWindowAttached) {
          call(runtime, observer, 'dispatchOnWindowFocusChange', ['Z'], 'V', [0]);
          call(runtime, observer, 'dispatchOnWindowAttachedChange', ['Z'], 'V', [0]);
          runtime.object(observer).hostWindowAttached = false;
          for (const [key, value] of windows) if (value.ref === observer.ref) windows.delete(key);
        }
        view.attachedTreeObserver = null;
      }
    },
    noteScroll(runtime,receiver){
      const view=runtime.object(receiver);if(!view.attached||!runtime.classes.has(OBSERVER))return;
      runtime.object(windowFor(runtime,view)).hostScrollChanged=true;
    },
    dispatchFrame(runtime, root, drawCallback = null) {
      if (!runtime.classes.has(OBSERVER) || !root || !runtime.object(root).attached) return false;
      const observer = windowFor(runtime, runtime.object(root));
      call(runtime, observer, 'dispatchOnGlobalLayout');
      if (call(runtime, observer, 'dispatchOnPreDraw', [], 'Z')) return false;
      // AOSP ViewRootImpl.draw clears the window scroll flag before notifying,
      // after a successful preDraw and before OnDraw; reentrant scrolling stays queued.
      if(runtime.object(observer).hostScrollChanged){runtime.object(observer).hostScrollChanged=false;call(runtime,observer,'dispatchOnScrollChanged');}
      call(runtime, observer, 'dispatchOnDraw');
      if(drawCallback!==null){if(typeof drawCallback!=='function')throw new APKError('Window draw callback must be callable');const result=drawCallback(runtime,root);if(result&&typeof result.then==='function')throw new APKError('Window draw callback must complete synchronously inside this frame');}
      if (!runtime.object(observer).hostWindowShown) {
        runtime.object(observer).hostWindowShown = true;
        call(runtime, observer, 'dispatchOnWindowShown');
      }
      // This boundary completes the VM's web drawing pass; it makes no GPU/Android
      // framebuffer claim. Capture is original source and drains one-shot callbacks.
      const commits = call(runtime, observer, 'captureFrameCommitCallbacks', [], 'Ljava/util/ArrayList;');
      if (commits) for (const callback of runtime.collectionValues(runtime.object(commits)).slice()) runtime.dispatch(
        { owner: 'Ljava/lang/Runnable;', name: 'run', signature: '()V', parameters: [], result: 'V' }, [callback], 'virtual');
      return true;
    },
  };
}
