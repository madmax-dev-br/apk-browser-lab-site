import { createHostRegistry, floatBits } from './host-contract.js?v=f407b1282aab';

// android.graphics.SurfaceTexture and the Surface made from it, as the in-memory objects they are before any producer or GL consumer exists
// (frameworks/base/graphics/java/android/graphics/SurfaceTexture.java, core/jni/android_graphics_SurfaceTexture.cpp, core/java/android/view/Surface.java, android-13.0.0_r1).
// The only producer is the lab's camera (src/camera-host.js): a frame it queues moves the timestamp and reaches the listeners; there is no codec or canvas producer and no EGL, so without a
// camera stream no frame ever arrives and everything that needs a current GL context fails the way the
// native consumer does without one (checkAndUpdateEglStateLocked -> INVALID_OPERATION). What a data class can honestly answer is answered: identity transform, timestamp 0, released state.
const TEXTURE = 'Landroid/graphics/SurfaceTexture;', LISTENER = 'Landroid/graphics/SurfaceTexture$OnFrameAvailableListener;', OUT_OF_RESOURCES = 'Landroid/graphics/SurfaceTexture$OutOfResourcesException;';
const SURFACE = 'Landroid/view/Surface;', HANDLER = 'Landroid/os/Handler;', FLOAT_ARRAY = '[F', STRING = 'Ljava/lang/String;';
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function createSurfaceTextureHost() {
  const registry = createHostRegistry(), { def, type } = registry;
  const nullish = value => value === null || value === undefined || value === 0;
  let sequence = 0;
  type(LISTENER, 'Ljava/lang/Object;');
  type(OUT_OF_RESOURCES, 'Ljava/lang/Exception;', [], { allocatable: true });
  def(OUT_OF_RESOURCES, '<init>', '()V', () => {}); def(OUT_OF_RESOURCES, '<init>', `(${STRING})V`, (r, _m, [self, message]) => { r.object(self).message = message; });
  type(TEXTURE, 'Ljava/lang/Object;', [], { allocatable: true });
  const state = (r, self) => r.object(self).texture ?? r.throwJava('Ljava/lang/IllegalStateException;', 'SurfaceTexture has not been initialized');
  const create = (r, self, detached, texName, single) => {
    r.object(self).texture = { released: false, single, width: 1, height: 1, attached: !detached, texName: detached ? 0 : texName, name: `SurfaceTexture-${detached ? 0 : texName}-${r.platform.virtualProcess.pid}-${++sequence}`, listener: null, listenerHandler: null, timestamp: 0, frames: 0 };
  };
  def(TEXTURE, '<init>', '(I)V', (r, _m, [self, texName]) => create(r, self, false, texName, false));
  def(TEXTURE, '<init>', '(IZ)V', (r, _m, [self, texName, single]) => create(r, self, false, texName, !!single));
  def(TEXTURE, '<init>', '(Z)V', (r, _m, [self, single]) => create(r, self, true, 0, !!single));
  def(TEXTURE, 'setOnFrameAvailableListener', `(${LISTENER})V`, (r, _m, [self, listener]) => { const texture = state(r, self); texture.listener = nullish(listener) ? null : listener; texture.listenerHandler = null; });
  def(TEXTURE, 'setOnFrameAvailableListener', `(${LISTENER}${HANDLER})V`, (r, _m, [self, listener, handler]) => { const texture = state(r, self); texture.listener = nullish(listener) ? null : listener; texture.listenerHandler = nullish(listener) || nullish(handler) ? null : handler; });
  def(TEXTURE, 'setDefaultBufferSize', '(II)V', (r, _m, [self, width, height]) => { const texture = state(r, self); texture.width = width; texture.height = height; });
  // GLConsumer needs a current EGL display for these: INVALID_OPERATION, or NO_INIT once the texture is released.
  const needsGl = (r, self, ise, message) => { if (state(r, self).released) r.throwJava('Ljava/lang/RuntimeException;', message.runtime); r.throwJava(ise ? 'Ljava/lang/IllegalStateException;' : 'Ljava/lang/RuntimeException;', ise ? message.state : message.runtime); };
  def(TEXTURE, 'updateTexImage', '()V', (r, _m, [self]) => needsGl(r, self, true, { state: 'Unable to update texture contents (see logcat for details)', runtime: 'Error during updateTexImage (see logcat for details)' }));
  def(TEXTURE, 'releaseTexImage', '()V', (r, _m, [self]) => needsGl(r, self, true, { state: 'Unable to release texture contents (see logcat for details)', runtime: 'Error during updateTexImage (see logcat for details)' }));
  def(TEXTURE, 'detachFromGLContext', '()V', (r, _m, [self]) => { state(r, self); r.throwJava('Ljava/lang/RuntimeException;', 'Error during detachFromGLContext (see logcat for details)'); });
  def(TEXTURE, 'attachToGLContext', '(I)V', (r, _m, [self]) => { state(r, self); r.throwJava('Ljava/lang/RuntimeException;', 'Error during attachToGLContext (see logcat for details)'); });
  def(TEXTURE, 'getTransformMatrix', `(${FLOAT_ARRAY})V`, (r, _m, [self, matrix]) => {
    state(r, self);
    if (nullish(matrix)) r.throwJava('Ljava/lang/NullPointerException;', "Attempt to get length of null array");
    const cells = r.array(matrix).elements;
    if (cells.length !== 16) r.throwJava('Ljava/lang/IllegalArgumentException;', null);
    for (let i = 0; i < 16; i++) cells[i] = floatBits(IDENTITY[i]);   // GLConsumer starts from the identity and only a queued frame changes it
  });
  def(TEXTURE, 'getTimestamp', '()J', (r, _m, [self]) => BigInt(state(r, self).timestamp));   // 0 until the camera queues a frame (src/camera-host.js); the frame itself is only latched by updateTexImage, which needs GL
  def(TEXTURE, 'getDataSpace', '()I', (r, _m, [self]) => { state(r, self); return 0; });   // HAL_DATASPACE_UNKNOWN
  def(TEXTURE, 'release', '()V', (r, _m, [self]) => { state(r, self).released = true; });   // abandon()
  def(TEXTURE, 'isReleased', '()Z', (r, _m, [self]) => (state(r, self).released ? 1 : 0));

  // Surface: only the part that wraps a SurfaceTexture or stays empty. Drawing into it (lockCanvas, hardware canvas, buffers) needs a producer connection and is not provided.
  type(SURFACE, 'Ljava/lang/Object;', [], { allocatable: true });
  const surface = (r, self) => (r.object(self).surface ??= { texture: null, name: null, sink: null, released: false });   // sink: the consumer of a Surface that is not a SurfaceTexture's (SurfaceView, ImageReader: src/camera-surface-host.js)
  def(SURFACE, '<init>', '()V', (r, _m, [self]) => { surface(r, self); });
  def(SURFACE, '<init>', `(${TEXTURE})V`, (r, _m, [self, texture]) => {
    if (nullish(texture)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'surfaceTexture must not be null');
    state(r, texture); const s = surface(r, self); s.texture = texture;
    s.name = r.stringCharacters(r.dispatch({ owner: 'Ljava/lang/Object;', name: 'toString', parameters: [], result: STRING, signature: `()${STRING}` }, [texture], 'virtual'));
  });
  def(SURFACE, 'release', '()V', (r, _m, [self]) => { const s = surface(r, self); s.texture = null; s.released = true; });
  def(SURFACE, 'isValid', '()Z', (r, _m, [self]) => { const s = surface(r, self); if (s.released) return 0; if (s.sink) return s.sink.valid() ? 1 : 0; return s.texture && !state(r, s.texture).released ? 1 : 0; });   // the producer is valid while the consumer is not abandoned
  def(SURFACE, 'toString', `()${STRING}`, (r, _m, [self]) => `Surface(name=${surface(r, self).name})/@0x${r.object(self).id.toString(16)}`);
  return { ...registry };
}
