import { APKError } from './apk-runtime.js?v=f98eb8e2dd09';

const VIEW = 'Landroid/view/View;', MATRIX = 'Landroid/graphics/Matrix;';
const keys = new Set(['getLocationOnScreen([I)V', 'getLocationOnScreen()[I', 'getLocationInWindow([I)V', 'transformFromViewToWindowSpace([I)V'].map(signature => VIEW + '->' + signature));
for(const name of ['getVerticalFadingEdgeLength', 'getHorizontalFadingEdgeLength'])keys.add(VIEW+'->'+name+'()I');
for(const signature of ['requestRectangleOnScreen(Landroid/graphics/Rect;)Z','requestRectangleOnScreen(Landroid/graphics/Rect;Z)Z'])keys.add(VIEW+'->'+signature);
keys.add('Landroid/view/ViewGroup;->requestChildRectangleOnScreen(Landroid/view/View;Landroid/graphics/Rect;Z)Z');
const bits = new DataView(new ArrayBuffer(4));
const raw = value => { bits.setFloat32(0, value, true); return bits.getInt32(0, true); };
const float = value => { bits.setInt32(0, value, true); return bits.getFloat32(0, true); };
const round = value => Number.isNaN(value) ? 0 : Math.max(-2147483648, Math.min(2147483647, Math.floor(value + .5)));

/** View/window boundary following AOSP13 View.transformFromViewToWindowSpace.
 * Bounds and scroll are the VM's actual View state. Matrix mapping executes the
 * original AOSP Matrix DEX through Skia. The virtual window starts at screen
 * (0,0); browser page position and decorative preview chrome are not Android
 * window coordinates. There is no Android host process or physical display.
 */
export function createViewCoordinateHost(platform) {
  const call = (runtime, receiver, owner, name, parameters, result, values = []) => runtime.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...values], 'virtual');
  const fail = message => { throw new APKError(message, { kind: 'view-coordinate-unsupported' }); };
  const array = (runtime, reference) => {
    if (!reference || runtime.object(reference).type !== '[I' || runtime.object(reference).elements.length < 2) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'Location must be an array of at least two integers');
    return runtime.object(reference).elements;
  };
  const hierarchy = (runtime, receiver) => {
    const chain = [], seen = new Set(); let current = receiver;
    while (current && runtime.isSubtype(runtime.object(current).type, VIEW)) {
      if (seen.has(current.ref) || chain.length >= 4096) fail('Cyclic/excessive View coordinate hierarchy');
      seen.add(current.ref); chain.push(current); current = runtime.object(current).parent;
    }
    return chain;
  };
  const windowState = (runtime, chain) => {
    // A WindowManager root (Dialog/Popup) owns its own screen offset, computed from its real LayoutParams gravity/x/y.
    const surface = platform.dialogWindowHost?.surfaceOffset(runtime, chain[chain.length - 1]);
    if (surface) return { left: surface.x, top: surface.y, rootScrollY: 0 };
    const ids = new Set(chain.map(value => value.ref));
    const frame = platform.frames.find(frame => ids.has(frame.root?.ref) || frame.window && ids.has(runtime.object(frame.window).decor?.ref));
    // Explicit virtual-window state; a future window-manager bridge can move it.
    const owner = frame?.window ? runtime.object(frame.window) : platform;
    return owner.virtualWindowCoordinates ??= { left: 0, top: 0, rootScrollY: 0 };
  };
  const transform = (runtime, chain, coordinates, window) => {
    let x = Math.fround(coordinates[0]), y = Math.fround(coordinates[1]), scratch;
    for (let index = 0; index < chain.length; index++) {
      const view = runtime.object(chain[index]);
      if (index) { x = Math.fround(x - Math.fround(view.fields.get(`${VIEW}->mScrollX:I`) ?? 0)); y = Math.fround(y - Math.fround(view.fields.get(`${VIEW}->mScrollY:I`) ?? 0)); }
      if (!call(runtime, chain[index], VIEW, 'hasIdentityMatrix', [], 'Z')) {
        scratch ??= runtime.newArray('[F', 2); runtime.object(scratch).elements = [raw(x), raw(y)];
        const matrix = call(runtime, chain[index], VIEW, 'getMatrix', [], MATRIX);
        call(runtime, matrix, MATRIX, 'mapPoints', ['[F'], 'V', [scratch]);
        [x, y] = runtime.object(scratch).elements.map(float);
      }
      x = Math.fround(x + Math.fround(view.bounds?.left ?? view.fields.get(`${VIEW}->mLeft:I`) ?? 0));
      y = Math.fround(y + Math.fround(view.bounds?.top ?? view.fields.get(`${VIEW}->mTop:I`) ?? 0));
    }
    y = Math.fround(y - Math.fround(window.rootScrollY));
    coordinates[0] = round(x); coordinates[1] = round(y);
  };
  return {
    supports: key => keys.has(key), parent: () => null,
    invoke(runtime, method, args) {
      const receiver = args[0], name = method.name, allocated = !method.parameters.length;
      if(name==='getVerticalFadingEdgeLength'||name==='getHorizontalFadingEdgeLength'){
        const view=runtime.object(receiver),vertical=name==='getVerticalFadingEdgeLength';
        const enabled=(view.fields.get(VIEW+'->mViewFlags:I')??0)&(vertical?0x2000:0x1000);
        if(enabled)fail('Fading-edge masks are not implemented by this View renderer');
        return 0; // AOSP View.java: disabled fading edges return zero before consulting the cache.
      }
      if(name==='requestChildRectangleOnScreen')return 0; // Original ViewGroup default; real ScrollView overrides dispatch first.
      if(name==='requestRectangleOnScreen'){
        if(method.parameters.length===1)return call(runtime,receiver,VIEW,name,['Landroid/graphics/Rect;','Z'],'Z',[args[1],0]);
        let child=receiver,parent=runtime.object(child).parent;if(!parent)return 0;
        const rect=runtime.object(args[1]),R='Landroid/graphics/Rect;',fields=['left','top','right','bottom'],position=fields.map(field=>Math.fround(rect.fields.get(`${R}->${field}:I`)??0)),seen=new Set();let scrolled=0;
        while(parent){
          if(seen.has(parent.ref)||seen.size>=4096)fail('Cyclic/excessive requested-rectangle hierarchy');seen.add(parent.ref);
          call(runtime,args[1],R,'set',['I','I','I','I'],'V',position.map(value=>Math.max(-2147483648,Math.min(2147483647,Math.trunc(value)))));
          scrolled|=call(runtime,parent,'Landroid/view/ViewParent;','requestChildRectangleOnScreen',[VIEW,R,'Z'],'Z',[child,args[1],args[2]]);
          if(!runtime.isSubtype(runtime.typeOf(parent),VIEW))break;
          const object=runtime.object(child),x=(object.bounds?.left??0)-call(runtime,child,VIEW,'getScrollX',[],'I'),y=(object.bounds?.top??0)-call(runtime,child,VIEW,'getScrollY',[],'I');
          for(let i=0;i<4;i++)position[i]=Math.fround(position[i]+(i%2?y:x));child=parent;parent=runtime.object(child).parent;
        }
        return scrolled?1:0;
      }
      if (allocated) { const reference = runtime.newArray('[I', 2); call(runtime, receiver, VIEW, name, ['[I'], 'V', [reference]); return reference; }
      const reference = args[1];
      if (name === 'getLocationOnScreen') {
        call(runtime, receiver, VIEW, 'getLocationInWindow', ['[I'], 'V', [reference]);
        if (call(runtime, receiver, VIEW, 'isAttachedToWindow', [], 'Z')) {
          const window = windowState(runtime, hierarchy(runtime, receiver)), coordinates = array(runtime, reference);
          coordinates[0] = (coordinates[0] + window.left) | 0; coordinates[1] = (coordinates[1] + window.top) | 0;
        }
        return;
      }
      const coordinates = array(runtime, reference);
      if (name === 'getLocationInWindow') {
        coordinates[0] = coordinates[1] = 0;
        return call(runtime, receiver, VIEW, 'transformFromViewToWindowSpace', ['[I'], 'V', [reference]);
      }
      const chain = hierarchy(runtime, receiver);
      if (!call(runtime, receiver, VIEW, 'isAttachedToWindow', [], 'Z')) { coordinates[0] = coordinates[1] = 0; return; }
      const window = windowState(runtime, chain);
      transform(runtime, chain, coordinates, window);
    },
  };
}
