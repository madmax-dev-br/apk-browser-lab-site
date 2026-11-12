import { createHostRegistry, floatBits } from './host-contract.js?v=a94e2efcced9';
import { APKError } from './apk-error.js?v=a94e2efcced9';
import KEY_DATA from './camera-metadata-keys-data.js?v=a94e2efcced9';
import { CAMERAS, cameraById, FORMAT, STREAM_SIZES, SENSOR_ARRAY, supportsSize, roundStreamSize } from './camera-frames.js?v=a94e2efcced9';
import { installCameraSurfaces, SURFACE, IMAGE_READER, SURFACE_TEXTURE } from './camera-surface-host.js?v=a94e2efcced9';
import { installCaptureIntents } from './camera-capture-intent.js?v=a94e2efcced9';
import { installMediaCodecs } from './media-codec-host.js?v=a94e2efcced9';

// android.hardware.camera2 for the browser VM (android-13.0.0_r1: CameraManager.java, impl/CameraDeviceImpl.java, impl/CameraCaptureSessionImpl.java, CaptureRequest.java,
// CaptureResult.java, params/StreamConfigurationMap.java, params/OutputConfiguration.java, params/SessionConfiguration.java) and the camera capture Intents
// (src/camera-capture-intent.js), over a frame source that lives in the page (src/camera-source.js).
//
// The camera hardware is the page. Until a page attaches (`attach(backend)`: the Worker does it when the page says it can feed cameras) the device has no camera at all, exactly as
// before: getCameraIdList() is empty, the camera features are absent, a capture Intent finds no Activity. Node probes get the same by attaching a scripted backend.
//
// Recording. A MediaCodec / MediaRecorder input Surface (src/media-codec-host.js) is a session output like any other: the camera hands each frame of a request that targets it to
// the encoder behind it. The page sends that frame as a VideoFrame (no readback) or, where it cannot, as RGBA pixels; the encoder is the host's (WebCodecs).
//
// Frame path. Nothing flows while no request is active. A repeating request or a pending capture() makes the Worker post the streams it needs (`streams`); the page then sends one
// `frame` per display frame it can afford, at most one in flight per camera: the Worker answers each with `ack` after the app's callbacks for it ran (a slow app drops frames, as a
// slow consumer does on a device). A frame carries pixels (RGBA, a transferred ArrayBuffer per size) only for ImageReader targets; TextureView / SurfaceView targets are drawn by
// the page in the View's box and cost the Worker one small message per frame. A still capture asks for its buffer once (`once`), so a 1280x960 frame is read back a single time.
//
// Not provided (explicit failure, never an empty frame): reprocessing, constrained high-speed and extension sessions, deferred OutputConfigurations, multi-resolution readers, RAW /
// DEPTH / HEIC outputs, torch (no camera has a flash unit), the deprecated android.hardware.Camera API. Methods of those are simply not defined here and fail
// with the VM's unsupported-API error naming them.
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', LIST = 'Ljava/util/List;', HANDLER = 'Landroid/os/Handler;', EXECUTOR = 'Ljava/util/concurrent/Executor;', RUNNABLE = 'Ljava/lang/Runnable;', LOOPER = 'Landroid/os/Looper;', CLASS = 'Ljava/lang/Class;';
const P = 'Landroid/hardware/camera2/';
const MANAGER = `${P}CameraManager;`, CHARACTERISTICS = `${P}CameraCharacteristics;`, METADATA = `${P}CameraMetadata;`, DEVICE = `${P}CameraDevice;`, DEVICE_IMPL = `${P}impl/CameraDeviceImpl;`, DEVICE_CALLBACK = `${P}CameraDevice$StateCallback;`;
const SESSION = `${P}CameraCaptureSession;`, SESSION_IMPL = `${P}impl/CameraCaptureSessionImpl;`, SESSION_CALLBACK = `${P}CameraCaptureSession$StateCallback;`, CAPTURE_CALLBACK = `${P}CameraCaptureSession$CaptureCallback;`;
const REQUEST = `${P}CaptureRequest;`, BUILDER = `${P}CaptureRequest$Builder;`, RESULT = `${P}CaptureResult;`, TOTAL_RESULT = `${P}TotalCaptureResult;`, FAILURE = `${P}CaptureFailure;`, ACCESS_EXCEPTION = `${P}CameraAccessException;`;
const AVAILABILITY = `${P}CameraManager$AvailabilityCallback;`, TORCH = `${P}CameraManager$TorchCallback;`;
const CONFIG_MAP = `${P}params/StreamConfigurationMap;`, OUTPUT_CONFIG = `${P}params/OutputConfiguration;`, SESSION_CONFIG = `${P}params/SessionConfiguration;`;
const KEY_TYPES = { characteristics: `${P}CameraCharacteristics$Key;`, request: `${P}CaptureRequest$Key;`, result: `${P}CaptureResult$Key;` }, KEY_OWNERS = { characteristics: CHARACTERISTICS, request: REQUEST, result: RESULT };
const SIZE = 'Landroid/util/Size;', SIZE_F = 'Landroid/util/SizeF;', RANGE = 'Landroid/util/Range;', RATIONAL = 'Landroid/util/Rational;', RECT = 'Landroid/graphics/Rect;', COMPARABLE = 'Ljava/lang/Comparable;';
const DELIVERY = 'Lapkweb/bridge/CameraDelivery;';
export const CAMERA_PERMISSION = 'android.permission.CAMERA';
export const CAMERA_FEATURES = Object.freeze(['android.hardware.camera', 'android.hardware.camera.any', 'android.hardware.camera.front', 'android.hardware.camera.autofocus']);
const TEMPLATES = [1, 2, 3, 4];   // PREVIEW, STILL_CAPTURE, RECORD, VIDEO_SNAPSHOT: what a LIMITED device guarantees
const ERROR_CAMERA_DISCONNECTED = 2;   // CameraAccessException.CAMERA_DISCONNECTED
const AF = { INACTIVE: 0, PASSIVE_FOCUSED: 2, ACTIVE_SCAN: 3, FOCUSED_LOCKED: 4 }, AE = { CONVERGED: 2, PRECAPTURE: 5 };
const nullish = value => value === null || value === undefined || value === 0;
/** The largest digital zoom (SCALER_AVAILABLE_MAX_DIGITAL_ZOOM): a crop region down to a quarter of the array's width, scaled up by the page that draws the frames. */
export const MAX_DIGITAL_ZOOM = 4;
const K = KEY_DATA.keys, keyName = (group, field) => K[group][field] ?? (() => { throw new APKError(`Camera metadata key ${group}.${field} is not in src/camera-metadata-keys-data.js`); })();

// Value descriptors: what a metadata entry holds, turned into the Java object CameraMetadata.get returns.
const I = v => ({ t: 'I', v }), B = v => ({ t: 'B', v }), F = v => ({ t: 'F', v }), Z = v => ({ t: 'Z', v }), ints = v => ({ t: '[I', v }), floats = v => ({ t: '[F', v });
const size = (w, h) => ({ t: 'size', v: [w, h] }), sizes = v => ({ t: 'sizes', v }), rect = (l, t, r, b) => ({ t: 'rect', v: [l, t, r, b] }), range = (lo, hi) => ({ t: 'range', v: [lo, hi] }), ranges = v => ({ t: 'ranges', v }), rational = (n, d) => ({ t: 'rational', v: [n, d] });

/** CameraCharacteristics of one of the lab's cameras, by the public constant's name. A key that is not listed is one the camera does not report: get() answers null. The numbers describe the lab's virtual sensor (src/camera-frames.js). */
export function characteristicsOf(camera) {
  const { width, height } = SENSOR_ARRAY;
  return {
    LENS_FACING: I(camera.facing), SENSOR_ORIENTATION: I(camera.orientation),
    INFO_SUPPORTED_HARDWARE_LEVEL: I(0),   // LIMITED
    REQUEST_AVAILABLE_CAPABILITIES: ints([0]),   // BACKWARD_COMPATIBLE
    REQUEST_MAX_NUM_OUTPUT_RAW: I(0), REQUEST_MAX_NUM_OUTPUT_PROC: I(3), REQUEST_MAX_NUM_OUTPUT_PROC_STALLING: I(1), REQUEST_MAX_NUM_INPUT_STREAMS: I(0), REQUEST_PARTIAL_RESULT_COUNT: I(1), REQUEST_PIPELINE_MAX_DEPTH: B(4),
    SCALER_STREAM_CONFIGURATION_MAP: { t: 'map' }, SCALER_AVAILABLE_MAX_DIGITAL_ZOOM: F(MAX_DIGITAL_ZOOM), SCALER_CROPPING_TYPE: I(0),   // CENTER_ONLY: a crop region is a centred digital zoom
    SENSOR_INFO_ACTIVE_ARRAY_SIZE: rect(0, 0, width, height), SENSOR_INFO_PRE_CORRECTION_ACTIVE_ARRAY_SIZE: rect(0, 0, width, height), SENSOR_INFO_PIXEL_ARRAY_SIZE: size(width, height), SENSOR_INFO_TIMESTAMP_SOURCE: I(0),
    SENSOR_INFO_PHYSICAL_SIZE: { t: 'sizeF', v: [4.8, 3.6] }, LENS_INFO_AVAILABLE_FOCAL_LENGTHS: floats([4]), LENS_INFO_AVAILABLE_APERTURES: floats([2]),
    LENS_INFO_MINIMUM_FOCUS_DISTANCE: F(camera.autofocus ? 10 : 0), LENS_INFO_FOCUS_DISTANCE_CALIBRATION: I(0), LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION: ints([0]),
    CONTROL_AVAILABLE_MODES: ints([1]), CONTROL_AE_AVAILABLE_MODES: ints([1]), CONTROL_AE_AVAILABLE_ANTIBANDING_MODES: ints([3]), CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES: ranges([[15, 30], [30, 30]]),
    CONTROL_AE_COMPENSATION_RANGE: range(0, 0), CONTROL_AE_COMPENSATION_STEP: rational(1, 1), CONTROL_AE_LOCK_AVAILABLE: Z(false), CONTROL_AWB_LOCK_AVAILABLE: Z(false),
    CONTROL_AF_AVAILABLE_MODES: ints(camera.autofocus ? [0, 1, 3, 4] : [0]), CONTROL_AWB_AVAILABLE_MODES: ints([1]), CONTROL_AVAILABLE_EFFECTS: ints([0]), CONTROL_AVAILABLE_SCENE_MODES: ints([0]), CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES: ints([0]),
    CONTROL_MAX_REGIONS_AE: I(1), CONTROL_MAX_REGIONS_AWB: I(0), CONTROL_MAX_REGIONS_AF: I(camera.autofocus ? 1 : 0),   // metering regions are accepted (the AF scan of a trigger completes); they do not change the picture
    FLASH_INFO_AVAILABLE: Z(false), JPEG_AVAILABLE_THUMBNAIL_SIZES: sizes([[0, 0], [160, 120]]), SYNC_MAX_LATENCY: I(-1),
    STATISTICS_INFO_AVAILABLE_FACE_DETECT_MODES: ints([0]), STATISTICS_INFO_MAX_FACE_COUNT: I(0), NOISE_REDUCTION_AVAILABLE_NOISE_REDUCTION_MODES: ints([0]),
  };
}
/** The settings of CameraDevice.createCaptureRequest(template), by CaptureRequest constant. */
export function templateDefaults(camera, template) {
  const { width, height } = SENSOR_ARRAY;
  return {
    CONTROL_MODE: I(1), CONTROL_AE_MODE: I(1), CONTROL_AWB_MODE: I(1), CONTROL_AF_MODE: I(!camera.autofocus ? 0 : template === 3 || template === 4 ? 3 : 4), CONTROL_CAPTURE_INTENT: I(template),
    CONTROL_AE_TARGET_FPS_RANGE: template === 3 || template === 4 ? range(30, 30) : range(15, 30), CONTROL_AE_EXPOSURE_COMPENSATION: I(0), CONTROL_AE_LOCK: Z(false), CONTROL_AWB_LOCK: Z(false), CONTROL_AE_ANTIBANDING_MODE: I(3),
    CONTROL_AF_TRIGGER: I(0), CONTROL_AE_PRECAPTURE_TRIGGER: I(0), CONTROL_EFFECT_MODE: I(0), CONTROL_SCENE_MODE: I(0), CONTROL_VIDEO_STABILIZATION_MODE: I(0),
    FLASH_MODE: I(0), JPEG_QUALITY: B(95), JPEG_THUMBNAIL_QUALITY: B(90), JPEG_ORIENTATION: I(0), JPEG_THUMBNAIL_SIZE: size(0, 0), LENS_OPTICAL_STABILIZATION_MODE: I(0), NOISE_REDUCTION_MODE: I(0),
    STATISTICS_FACE_DETECT_MODE: I(0), SCALER_CROP_REGION: rect(0, 0, width, height),
  };
}

export function createCameraHost(platform) {
  const registry = createHostRegistry(), { def, type, staticField } = registry;
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const construct = (r, owner, parameters = [], args = []) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: o }), 'direct'); return o; };
  const iae = (r, message) => r.throwJava('Ljava/lang/IllegalArgumentException;', message), ise = (r, message) => r.throwJava('Ljava/lang/IllegalStateException;', message);
  const listItems = (r, list) => { if (nullish(list)) return []; const count = call(r, list, LIST, 'size', [], 'I'), out = []; for (let i = 0; i < count; i++) out.push(call(r, list, LIST, 'get', ['I'], OBJECT, [i])); return out; };
  const listOf = (r, items) => { const list = construct(r, 'Ljava/util/ArrayList;'); for (const item of items) call(r, list, 'Ljava/util/ArrayList;', 'add', [OBJECT], 'Z', [item]); return list; };
  const now = () => Number(platform.clock.nanos());

  /** Host state. Everything that holds a Java value is plain data reachable from the returned host (`state`), so the collector's walk of the platform finds it. */
  const S = { backend: null, devices: new Map(), availability: [], sequence: 0, once: 0, posted: '', captures: new Map(), stats: { frames: 0, pixelFrames: 0, pixelBytes: 0, dropped: 0, frameMs: 0, encoded: 0 } };
  const send = (message, transfer) => { try { S.backend?.post(message, transfer); } catch { /* the page is gone: the next attach starts clean */ } };

  // ---- delivery on the app's Handler / Executor ---------------------------------------------------------------------------------------------------------------------------
  type(DELIVERY, OBJECT, [RUNNABLE], { allocatable: true });
  def(DELIVERY, 'run', '()V', (r, _m, [self]) => { const record = r.object(self), task = record.task; record.task = null; record.held = null; return task?.(); });
  /** Where callbacks go: the Executor given, or a Handler (the one given, else one on the calling thread's Looper; without a Looper the framework refuses, CameraDeviceImpl.checkHandler). */
  const targetFor = (r, handler, message = 'No handler given, and current thread has no looper!') => {
    if (!nullish(handler)) return { handler };
    const looper = callStatic(r, LOOPER, 'myLooper', [], LOOPER); if (nullish(looper)) iae(r, message);
    return { handler: construct(r, HANDLER, [LOOPER], [looper]) };
  };
  const executorTarget = (r, executor) => { if (nullish(executor)) iae(r, 'executor must not be null'); return { executor }; };
  /** Runs `task` on the target, after the current call returns. `held`: the Java values the closure uses (kept alive by the Runnable until it ran). */
  const post = (r, target, task, held = []) => {
    const runnable = r.makeObject(DELIVERY), record = r.object(runnable); record.task = task; record.held = held.filter(value => !nullish(value));
    if (target.executor) call(r, target.executor, EXECUTOR, 'execute', [RUNNABLE], 'V', [runnable]);
    else call(r, target.handler, HANDLER, 'post', [RUNNABLE], 'Z', [runnable]);
  };

  const surfaces = installCameraSurfaces({ platform, registry, post, targetFor });
  const media = installMediaCodecs({ platform, registry, post, call, callStatic, construct, cameras: () => cameras() });

  // ---- metadata keys and values ---------------------------------------------------------------------------------------------------------------------------------------------
  for (const [group, owner] of Object.entries(KEY_OWNERS)) {
    const keyType = KEY_TYPES[group]; type(keyType, OBJECT, [], { allocatable: true });
    for (const [field, name] of Object.entries(K[group])) staticField(owner, field, keyType, r => { const ref = r.makeObject(keyType); r.object(ref).cameraKey = name; return ref; });
    def(keyType, '<init>', `(${STRING}${CLASS})V`, (r, _m, [self, name]) => { r.object(self).cameraKey = r.stringCharacters(name); });   // vendor keys: accepted, never reported
    def(keyType, 'getName', `()${STRING}`, (r, _m, [self]) => r.object(self).cameraKey);
    def(keyType, 'toString', `()${STRING}`, (r, _m, [self]) => `${owner.slice(P.length + 1, -1)}.Key(${r.object(self).cameraKey})`);
    def(keyType, 'hashCode', '()I', (r, _m, [self]) => { let h = 0; for (const c of r.object(self).cameraKey) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; return h; });
    def(keyType, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => (!nullish(other) && r.typeOf(other) === keyType && r.object(other).cameraKey === r.object(self).cameraKey ? 1 : 0));
  }
  const keyOf = (r, key) => { if (nullish(key)) r.throwJava('Ljava/lang/NullPointerException;', 'key must not be null'); return r.object(key).cameraKey; };
  const keyObject = (r, group, field) => r.readStatic({ owner: KEY_OWNERS[group], name: field, type: KEY_TYPES[group] });
  const toJava = (r, d, camera) => {
    switch (d.t) {
      case 'I': case 'B': return r.boxPrimitive(d.t, d.v);
      case 'Z': return r.boxPrimitive('Z', d.v ? 1 : 0);
      case 'F': return r.boxPrimitive('F', floatBits(d.v));
      case 'J': return r.boxPrimitive('J', BigInt(d.v));
      case '[I': { const a = r.newArray('[I', d.v.length); r.array(a).elements = d.v; return a; }
      case '[F': { const a = r.newArray('[F', d.v.length); r.array(a).elements = d.v.map(floatBits); return a; }
      case 'size': return construct(r, SIZE, ['I', 'I'], d.v);
      case 'sizeF': return construct(r, SIZE_F, ['F', 'F'], d.v.map(floatBits));
      case 'sizes': { const a = r.newArray(`[${SIZE}`, d.v.length); r.array(a).elements = d.v.map(([w, h]) => construct(r, SIZE, ['I', 'I'], [w, h])); return a; }
      case 'rect': return construct(r, RECT, ['I', 'I', 'I', 'I'], d.v);
      case 'range': return construct(r, RANGE, [COMPARABLE, COMPARABLE], d.v.map(v => r.boxPrimitive('I', v)));
      case 'ranges': { const a = r.newArray(`[${RANGE}`, d.v.length); r.array(a).elements = d.v.map(pair => construct(r, RANGE, [COMPARABLE, COMPARABLE], pair.map(v => r.boxPrimitive('I', v)))); return a; }
      case 'rational': return construct(r, RATIONAL, ['I', 'I'], d.v);
      case 'map': { const ref = r.makeObject(CONFIG_MAP); r.object(ref).cameraId = camera.id; return ref; }
      default: throw new APKError(`Camera metadata value of kind ${d.t} has no Java form`);
    }
  };
  const unboxed = (r, value, fallback) => (nullish(value) ? fallback : Number(r.object(value).boxed ?? fallback));

  // ---- CameraCharacteristics and StreamConfigurationMap ----------------------------------------------------------------------------------------------------------------------
  type(METADATA, OBJECT); type(CHARACTERISTICS, METADATA); type(CONFIG_MAP, OBJECT);
  const characteristicsByName = camera => Object.fromEntries(Object.entries(characteristicsOf(camera)).map(([field, value]) => [keyName('characteristics', field), { field, value }]));
  def(CHARACTERISTICS, 'get', `(${KEY_TYPES.characteristics})${OBJECT}`, (r, _m, [self, key]) => { const o = r.object(self), entry = (o.table ??= characteristicsByName(cameraById(o.cameraId)))[keyOf(r, key)]; return entry ? toJava(r, entry.value, cameraById(o.cameraId)) : null; });
  def(CHARACTERISTICS, 'getKeys', `()${LIST}`, (r, _m, [self]) => listOf(r, Object.keys(characteristicsOf(cameraById(r.object(self).cameraId))).map(field => keyObject(r, 'characteristics', field))));
  def(CHARACTERISTICS, 'getAvailableCaptureRequestKeys', `()${LIST}`, (r, _m, [self]) => listOf(r, Object.keys(templateDefaults(cameraById(r.object(self).cameraId), 1)).map(field => keyObject(r, 'request', field))));
  def(CHARACTERISTICS, 'getAvailableCaptureResultKeys', `()${LIST}`, (r, _m, [self]) => listOf(r, [...Object.keys(templateDefaults(cameraById(r.object(self).cameraId), 1)), ...RESULT_ONLY].filter(field => K.result[field]).map(field => keyObject(r, 'result', field))));
  def(CHARACTERISTICS, 'getAvailableSessionKeys', `()${LIST}`, r => listOf(r, []));
  def(CHARACTERISTICS, 'getAvailablePhysicalCameraRequestKeys', `()${LIST}`, () => null);   // not a logical multi-camera
  def(CHARACTERISTICS, 'getPhysicalCameraIds', '()Ljava/util/Set;', r => construct(r, 'Ljava/util/HashSet;'));
  const RESULT_ONLY = ['SENSOR_TIMESTAMP', 'CONTROL_AE_STATE', 'CONTROL_AF_STATE', 'CONTROL_AWB_STATE', 'LENS_STATE', 'FLASH_STATE', 'REQUEST_PIPELINE_DEPTH'];
  const sizeArray = (r, list) => { const a = r.newArray(`[${SIZE}`, list.length); r.array(a).elements = list.map(([w, h]) => construct(r, SIZE, ['I', 'I'], [w, h])); return a; };
  const FORMATS = [FORMAT.JPEG, FORMAT.YUV_420_888, FORMAT.PRIVATE], FRAME_NS = 33333333n;
  /** The classes StreamConfigurationMap.isOutputSupportedFor(Class) accepts on any device; all of them consume the implementation-defined (PRIVATE) format. */
  const PRIVATE_CONSUMERS = ['android.media.ImageReader', 'android.media.MediaRecorder', 'android.media.MediaCodec', 'android.renderscript.Allocation', 'android.view.SurfaceHolder', 'android.graphics.SurfaceTexture'];
  const className = (r, klass) => { if (nullish(klass)) r.throwJava('Ljava/lang/NullPointerException;', 'klass must not be null'); return r.stringCharacters(call(r, klass, CLASS, 'getName', [], STRING)); };
  const sizeOf = (r, value) => { if (nullish(value)) r.throwJava('Ljava/lang/NullPointerException;', 'size must not be null'); return [call(r, value, SIZE, 'getWidth', [], 'I'), call(r, value, SIZE, 'getHeight', [], 'I')]; };
  def(CONFIG_MAP, 'getOutputFormats', '()[I', r => { const a = r.newArray('[I', FORMATS.length); r.array(a).elements = FORMATS; return a; });
  def(CONFIG_MAP, 'getValidOutputFormatsForInput', '(I)[I', r => r.newArray('[I', 0));
  def(CONFIG_MAP, 'getInputFormats', '()[I', r => r.newArray('[I', 0));
  def(CONFIG_MAP, 'getInputSizes', `(I)[${SIZE}`, () => null);
  def(CONFIG_MAP, 'isOutputSupportedFor', '(I)Z', (r, _m, [, format]) => (FORMATS.includes(format) ? 1 : 0));
  def(CONFIG_MAP, 'isOutputSupportedFor', `(${CLASS})Z`, (r, _m, [, klass]) => (PRIVATE_CONSUMERS.includes(className(r, klass)) ? 1 : 0));
  def(CONFIG_MAP, 'isOutputSupportedFor', `(${SURFACE})Z`, (r, _m, [, surface]) => { if (nullish(surface)) r.throwJava('Ljava/lang/NullPointerException;', 'surface must not be null'); const sink = surfaces.sinkOf(r, surface); if (!sink) iae(r, 'Abandoned surface'); return streamFor(sink) ? 1 : 0; });
  def(CONFIG_MAP, 'getOutputSizes', `(I)[${SIZE}`, (r, _m, [, format]) => (STREAM_SIZES[format] ? sizeArray(r, STREAM_SIZES[format]) : null));
  def(CONFIG_MAP, 'getOutputSizes', `(${CLASS})[${SIZE}`, (r, _m, [, klass]) => (PRIVATE_CONSUMERS.includes(className(r, klass)) ? sizeArray(r, STREAM_SIZES[FORMAT.PRIVATE]) : null));
  def(CONFIG_MAP, 'getHighResolutionOutputSizes', `(I)[${SIZE}`, () => null);
  def(CONFIG_MAP, 'getHighSpeedVideoSizes', `()[${SIZE}`, r => sizeArray(r, []));
  def(CONFIG_MAP, 'getHighSpeedVideoFpsRanges', `()[${RANGE}`, r => r.newArray(`[${RANGE}`, 0));
  const duration = (r, supported, value, stall) => { if (!supported) iae(r, 'size was not supported'); void value; return stall ? 0n : FRAME_NS; };
  def(CONFIG_MAP, 'getOutputMinFrameDuration', `(I${SIZE})J`, (r, _m, [, format, value]) => { const [w, h] = sizeOf(r, value); return duration(r, supportsSize(format, w, h), value, false); });
  def(CONFIG_MAP, 'getOutputMinFrameDuration', `(${CLASS}${SIZE})J`, (r, _m, [, klass, value]) => { const [w, h] = sizeOf(r, value); return duration(r, PRIVATE_CONSUMERS.includes(className(r, klass)) && supportsSize(FORMAT.PRIVATE, w, h), value, false); });
  def(CONFIG_MAP, 'getOutputStallDuration', `(I${SIZE})J`, (r, _m, [, format, value]) => { const [w, h] = sizeOf(r, value); return duration(r, supportsSize(format, w, h), value, true); });
  def(CONFIG_MAP, 'getOutputStallDuration', `(${CLASS}${SIZE})J`, (r, _m, [, klass, value]) => { const [w, h] = sizeOf(r, value); return duration(r, PRIVATE_CONSUMERS.includes(className(r, klass)) && supportsSize(FORMAT.PRIVATE, w, h), value, true); });

  /** The stream a consumer gets: an ImageReader's own size and format must be one the camera produces; a SurfaceTexture / SurfaceView gets the closest supported size. null: not configurable. */
  const streamFor = sink => {
    if (sink.kind === 'reader') { const { width, height, format } = sink.state; return supportsSize(format, width, height) ? { width, height, format } : null; }
    if (sink.kind === 'encoder') { const size = media.streamSize(sink); return size ? { ...size, format: FORMAT.PRIVATE } : null; }
    if (sink.kind === 'texture') return { ...roundStreamSize(sink.state.width, sink.state.height), format: FORMAT.PRIVATE };
    const view = platform.vmRuntime?.object(sink.view), state = view?.surfaceView, bounds = view?.bounds, w = state?.fixed?.width ?? (bounds ? bounds.right - bounds.left : 0), h = state?.fixed?.height ?? (bounds ? bounds.bottom - bounds.top : 0);
    return { ...roundStreamSize(Math.max(w, h), Math.min(w, h)), format: FORMAT.PRIVATE };   // a SurfaceView buffer is sized in the sensor's (landscape) orientation; the compositor rotates it
  };

  // ---- CameraAccessException ------------------------------------------------------------------------------------------------------------------------------------------------
  type(ACCESS_EXCEPTION, 'Landroid/util/AndroidException;', [], { allocatable: true });
  const REASONS = { 1: 'CAMERA_DISABLED', 2: 'CAMERA_DISCONNECTED', 3: 'CAMERA_ERROR', 4: 'CAMERA_IN_USE', 5: 'MAX_CAMERAS_IN_USE' };
  const accessInit = (r, self, reason, message) => { const o = r.object(self); o.cameraReason = reason; o.message = `${REASONS[reason] ?? 'CAMERA_ERROR'} (${reason})${message ? ': ' + message : ''}`; };
  def(ACCESS_EXCEPTION, '<init>', '(I)V', (r, _m, [self, reason]) => accessInit(r, self, reason, null));
  def(ACCESS_EXCEPTION, '<init>', `(I${STRING})V`, (r, _m, [self, reason, message]) => accessInit(r, self, reason, nullish(message) ? null : r.stringCharacters(message)));
  def(ACCESS_EXCEPTION, 'getReason', '()I', (r, _m, [self]) => r.object(self).cameraReason ?? 3);
  const accessException = (r, reason, message) => { const ref = r.allocate(ACCESS_EXCEPTION); accessInit(r, ref, reason, message); r.throwJavaReference(ref, r.object(ref).message); };

  // ---- CameraManager --------------------------------------------------------------------------------------------------------------------------------------------------------
  type(AVAILABILITY, OBJECT, [], { allocatable: true }); def(AVAILABILITY, '<init>', '()V', () => {}); type(TORCH, OBJECT, [], { allocatable: true }); def(TORCH, '<init>', '()V', () => {});
  for (const name of ['onCameraAvailable', 'onCameraUnavailable']) def(AVAILABILITY, name, `(${STRING})V`, () => {});
  def(AVAILABILITY, 'onCameraAccessPrioritiesChanged', '()V', () => {}); def(AVAILABILITY, 'onPhysicalCameraAvailable', `(${STRING}${STRING})V`, () => {}); def(AVAILABILITY, 'onPhysicalCameraUnavailable', `(${STRING}${STRING})V`, () => {});
  def(TORCH, 'onTorchModeUnavailable', `(${STRING})V`, () => {}); def(TORCH, 'onTorchModeChanged', `(${STRING}Z)V`, () => {}); def(TORCH, 'onTorchStrengthLevelChanged', `(${STRING}I)V`, () => {});
  const cameras = () => (S.backend ? CAMERAS : []);
  const known = (r, id) => { if (nullish(id)) iae(r, 'cameraId was null'); const text = r.stringCharacters(id), camera = cameras().find(entry => entry.id === text); if (!camera) iae(r, `Unable to retrieve camera characteristics for unknown device ${text}`); return camera; };
  const tellAvailability = (r, cameraId, available, only = null) => { for (const entry of only ? [only] : [...S.availability]) post(r, entry.target, () => { if (S.availability.includes(entry)) call(r, entry.callback, AVAILABILITY, available ? 'onCameraAvailable' : 'onCameraUnavailable', [STRING], 'V', [cameraId]); }, [entry.callback]); };
  const manager = {
    idList: () => cameras().map(camera => camera.id),
    characteristics(r, id) { const camera = known(r, id), ref = r.makeObject(CHARACTERISTICS); r.object(ref).cameraId = camera.id; return ref; },
    registerAvailability(r, callback, target) {
      if (nullish(callback)) iae(r, 'callback must not be null'); if (S.availability.some(entry => entry.callback.ref === callback.ref)) return;
      const entry = { callback, target }; S.availability.push(entry);
      for (const camera of cameras()) tellAvailability(r, camera.id, !S.devices.has(camera.id), entry);   // a new callback hears the current state of every camera
    },
    unregisterAvailability(r, callback) { if (nullish(callback)) iae(r, 'callback must not be null'); S.availability = S.availability.filter(entry => entry.callback.ref !== callback.ref); },
    /** CameraManager.openCamera: the CAMERA permission, then onOpened on the callback's executor. An already open camera is taken from its previous owner (onDisconnected), as the camera service evicts it. */
    open(r, id, callback, target) {
      if (nullish(id)) iae(r, 'cameraId was null'); if (nullish(callback)) iae(r, 'callback was null');
      const camera = known(r, id);
      if (!platform.holdsPermission?.(r, CAMERA_PERMISSION)) r.throwJava('Ljava/lang/SecurityException;', `Caller "${platform.packageName}" (PID ${platform.virtualProcess?.pid ?? 0}, UID ${platform.virtualProcess?.uid ?? 10000}) cannot open camera "${camera.id}" without camera permission`);
      const previous = S.devices.get(camera.id); if (previous) disconnect(r, previous);
      const ref = r.makeObject(DEVICE_IMPL), device = { id: camera.id, camera, ref, callback, target, closed: false, session: null, frameNumber: 0, af: { mode: -1, state: AF.INACTIVE }, ae: { state: AE.CONVERGED }, inFlight: null };
      r.object(ref).cameraDevice = device; S.devices.set(camera.id, device);
      r.record(`CAMERA open ${camera.id} (${camera.facing === 1 ? 'back' : 'front'})`); send({ op: 'open', cameraId: camera.id });
      tellAvailability(r, camera.id, false);
      post(r, target, () => { if (!device.closed) call(r, callback, DEVICE_CALLBACK, 'onOpened', [DEVICE], 'V', [ref]); }, [ref, callback]);
    },
    targetFor, executorTarget,
  };

  // ---- CameraDevice ---------------------------------------------------------------------------------------------------------------------------------------------------------
  type(DEVICE, OBJECT, ['Ljava/lang/AutoCloseable;']); type(DEVICE_IMPL, DEVICE, [], { allocatable: true }); type(DEVICE_CALLBACK, OBJECT, [], { allocatable: true });
  def(DEVICE_CALLBACK, '<init>', '()V', () => {}); def(DEVICE_CALLBACK, 'onClosed', `(${DEVICE})V`, () => {});
  const deviceOf = (r, self) => r.object(self).cameraDevice;
  const openDevice = (r, self) => { const device = deviceOf(r, self); if (device.closed) ise(r, 'CameraDevice was already closed'); return device; };
  def(DEVICE_IMPL, 'getId', `()${STRING}`, (r, _m, [self]) => deviceOf(r, self).id);
  def(DEVICE_IMPL, 'createCaptureRequest', `(I)${BUILDER}`, (r, _m, [self, template]) => {
    const device = openDevice(r, self); if (!TEMPLATES.includes(template)) iae(r, `Template ${template} is not supported`);   // the camera service's ERROR_ILLEGAL_ARGUMENT for a template the HAL has no defaults for
    const builder = r.makeObject(BUILDER), values = new Map();
    for (const [field, value] of Object.entries(templateDefaults(device.camera, template))) values.set(keyName('request', field), toJava(r, value, device.camera));
    r.object(builder).request = { cameraId: device.id, template, targets: [], values, tag: null }; return builder;
  });
  const endSession = (r, session, { tell = true } = {}) => {
    if (session.closed) return; session.closed = true;
    stopStreams(r, session);
    if (session.device.session === session) session.device.session = null;
    if (tell) post(r, session.target, () => call(r, session.callback, SESSION_CALLBACK, 'onClosed', [SESSION], 'V', [session.ref]), [session.ref, session.callback]);
    publish(r);
  };
  /** A session over `surfacesList`: every Surface needs a live consumer the camera can feed, at a size and format it produces; otherwise onConfigureFailed (CameraDeviceImpl.configureStreamsChecked failing). */
  const configSurfaces = (r, configs) => configs.flatMap(config => { const c = r.object(config).outputConfig; return c.dynamicRange === 1 && c.useCase === 0 ? c.surfaces : [null]; });   // an unsupported dynamic range or stream use case makes the configuration fail
  const createSession = (r, self, surfaceList, callback, target) => {
    const device = openDevice(r, self); if (nullish(callback)) iae(r, 'callback must not be null');
    if (device.session) endSession(r, device.session);   // CameraDeviceImpl.createCaptureSessionInternal: the previous session is replaced
    const ref = r.makeObject(SESSION_IMPL), session = { ref, device, callback, target, outputs: [], closed: false, repeating: null, jobs: [], active: false };
    r.object(ref).cameraSession = session;
    let failure = null;
    for (const surface of surfaceList) {
      const sink = nullish(surface) ? null : surfaces.sinkOf(r, surface), stream = sink ? streamFor(sink) : null;
      if (!sink) { failure = nullish(surface) ? 'a null Surface, or an OutputConfiguration with a dynamic range profile or stream use case the camera does not have' : 'a Surface without a live consumer the camera can fill (released or never created)'; break; }
      if (!stream) { failure = sink.kind === 'encoder' ? `an encoder Surface of ${sink.size() ? `${sink.size().width}x${sink.size().height}, which is not in StreamConfigurationMap.getOutputSizes` : 'a codec that is not configured yet'}` : `an ImageReader of ${sink.state.width}x${sink.state.height} format 0x${sink.state.format.toString(16)}, which is not in StreamConfigurationMap.getOutputSizes`; break; }
      if (session.outputs.some(output => output.surface.ref === surface.ref)) continue;
      session.outputs.push({ surface, sink, stream });
    }
    if (failure) { session.closed = true; r.record(`CAMERA ${device.id} session not configured: ${failure}`); post(r, target, () => call(r, callback, SESSION_CALLBACK, 'onConfigureFailed', [SESSION], 'V', [ref]), [ref, callback]); return; }
    device.session = session; r.record(`CAMERA ${device.id} session configured: ${session.outputs.map(output => `${output.sink.kind} ${output.stream.width}x${output.stream.height}`).join(', ') || 'no outputs'}`);
    post(r, target, () => { if (session.closed) return; call(r, callback, SESSION_CALLBACK, 'onConfigured', [SESSION], 'V', [ref]); if (!session.closed && !session.active) call(r, callback, SESSION_CALLBACK, 'onReady', [SESSION], 'V', [ref]); }, [ref, callback]);
  };
  def(DEVICE_IMPL, 'createCaptureSession', `(${LIST}${SESSION_CALLBACK}${HANDLER})V`, (r, _m, [self, list, callback, handler]) => { openDevice(r, self); createSession(r, self, listItems(r, list), callback, targetFor(r, handler)); });
  def(DEVICE_IMPL, 'createCaptureSessionByOutputConfigurations', `(${LIST}${SESSION_CALLBACK}${HANDLER})V`, (r, _m, [self, list, callback, handler]) => { openDevice(r, self); createSession(r, self, configSurfaces(r, listItems(r, list)), callback, targetFor(r, handler)); });
  def(DEVICE_IMPL, 'createCaptureSession', `(${SESSION_CONFIG})V`, (r, _m, [self, config]) => {
    openDevice(r, self); if (nullish(config)) iae(r, 'Invalid session configuration'); const c = r.object(config).sessionConfig;
    if (c.type !== 0) iae(r, 'Constrained high speed session is not supported by this camera device');
    createSession(r, self, configSurfaces(r, c.outputs), c.callback, { executor: c.executor });
  });
  def(DEVICE_IMPL, 'isSessionConfigurationSupported', `(${SESSION_CONFIG})Z`, (r, _m, [self, config]) => { openDevice(r, self); const c = r.object(config).sessionConfig; return c.type === 0 && c.outputs.flatMap(output => r.object(output).outputConfig.surfaces).every(surface => { const sink = surfaces.sinkOf(r, surface); return sink && streamFor(sink); }) ? 1 : 0; });
  const closeDevice = (r, device, { disconnected = false } = {}) => {
    if (device.closed) return; device.closed = true;
    if (device.session) endSession(r, device.session);
    if (S.devices.get(device.id) === device) S.devices.delete(device.id);
    r.record(`CAMERA ${disconnected ? 'disconnected' : 'close'} ${device.id}`); send({ op: 'close', cameraId: device.id }); publish(r);
    post(r, device.target, () => { if (disconnected) call(r, device.callback, DEVICE_CALLBACK, 'onDisconnected', [DEVICE], 'V', [device.ref]); call(r, device.callback, DEVICE_CALLBACK, 'onClosed', [DEVICE], 'V', [device.ref]); }, [device.ref, device.callback]);
    if (S.backend) tellAvailability(r, device.id, true);
  };
  const disconnect = (r, device) => closeDevice(r, device, { disconnected: true });
  def(DEVICE_IMPL, 'close', '()V', (r, _m, [self]) => closeDevice(r, deviceOf(r, self)));

  // ---- OutputConfiguration / SessionConfiguration -----------------------------------------------------------------------------------------------------------------------------
  type(OUTPUT_CONFIG, OBJECT, ['Landroid/os/Parcelable;'], { allocatable: true }); type(SESSION_CONFIG, OBJECT, ['Landroid/os/Parcelable;'], { allocatable: true });
  const outputInit = (r, self, group, surface) => { if (nullish(surface)) iae(r, 'surface must not be null'); r.object(self).outputConfig = { group, surfaces: [surface], shared: false, physicalId: null, dynamicRange: 1, useCase: 0, mirror: 0, timestampBase: 0 }; };
  def(OUTPUT_CONFIG, '<init>', `(${SURFACE})V`, (r, _m, [self, surface]) => outputInit(r, self, -1, surface));
  def(OUTPUT_CONFIG, '<init>', `(I${SURFACE})V`, (r, _m, [self, group, surface]) => outputInit(r, self, group, surface));
  def(OUTPUT_CONFIG, 'getSurface', `()${SURFACE}`, (r, _m, [self]) => r.object(self).outputConfig.surfaces[0] ?? null);
  def(OUTPUT_CONFIG, 'getSurfaces', `()${LIST}`, (r, _m, [self]) => listOf(r, r.object(self).outputConfig.surfaces));
  def(OUTPUT_CONFIG, 'getSurfaceGroupId', '()I', (r, _m, [self]) => r.object(self).outputConfig.group);
  def(OUTPUT_CONFIG, 'enableSurfaceSharing', '()V', (r, _m, [self]) => { r.object(self).outputConfig.shared = true; });
  def(OUTPUT_CONFIG, 'addSurface', `(${SURFACE})V`, (r, _m, [self, surface]) => { const c = r.object(self).outputConfig; if (nullish(surface)) iae(r, 'surface must not be null'); if (!c.shared) ise(r, 'Cannot have 2 surfaces for a non-sharing configuration'); if (c.surfaces.some(entry => entry.ref === surface.ref)) ise(r, 'Surface is already added!'); c.surfaces.push(surface); });
  def(OUTPUT_CONFIG, 'removeSurface', `(${SURFACE})V`, (r, _m, [self, surface]) => { const c = r.object(self).outputConfig; if (c.surfaces[0]?.ref === surface?.ref) iae(r, 'Cannot remove surface associated with this output configuration'); const at = c.surfaces.findIndex(entry => entry.ref === surface?.ref); if (at < 0) iae(r, 'Surface is not part of this output configuration'); c.surfaces.splice(at, 1); });
  def(OUTPUT_CONFIG, 'setPhysicalCameraId', `(${STRING})V`, (r, _m, [self, id]) => { r.object(self).outputConfig.physicalId = nullish(id) ? null : r.stringCharacters(id); });
  def(OUTPUT_CONFIG, 'getMaxSharedSurfaceCount', '()I', () => 4);
  // API 33: stored as given; a session only configures with what the camera has (DynamicRangeProfiles.STANDARD, the default stream use case)
  for (const [name, key, kind] of [['DynamicRangeProfile', 'dynamicRange', 'J'], ['StreamUseCase', 'useCase', 'J'], ['MirrorMode', 'mirror', 'I'], ['TimestampBase', 'timestampBase', 'I']]) {
    def(OUTPUT_CONFIG, `set${name}`, `(${kind})V`, (r, _m, [self, value]) => { r.object(self).outputConfig[key] = Number(value); });
    def(OUTPUT_CONFIG, `get${name}`, `()${kind}`, (r, _m, [self]) => (kind === 'J' ? BigInt(r.object(self).outputConfig[key]) : r.object(self).outputConfig[key]));
  }
  def(SESSION_CONFIG, '<init>', `(I${LIST}${EXECUTOR}${SESSION_CALLBACK})V`, (r, _m, [self, sessionType, outputs, executor, callback]) => {
    if (nullish(executor)) r.throwJava('Ljava/lang/NullPointerException;', null); if (nullish(callback)) r.throwJava('Ljava/lang/NullPointerException;', null);
    r.object(self).sessionConfig = { type: sessionType, outputs: listItems(r, outputs), executor, callback, parameters: null };
  });
  def(SESSION_CONFIG, 'getSessionType', '()I', (r, _m, [self]) => r.object(self).sessionConfig.type);
  def(SESSION_CONFIG, 'getOutputConfigurations', `()${LIST}`, (r, _m, [self]) => listOf(r, r.object(self).sessionConfig.outputs));
  def(SESSION_CONFIG, 'getExecutor', `()${EXECUTOR}`, (r, _m, [self]) => r.object(self).sessionConfig.executor);
  def(SESSION_CONFIG, 'getStateCallback', `()${SESSION_CALLBACK}`, (r, _m, [self]) => r.object(self).sessionConfig.callback);
  def(SESSION_CONFIG, 'setSessionParameters', `(${REQUEST})V`, (r, _m, [self, request]) => { r.object(self).sessionConfig.parameters = nullish(request) ? null : request; });
  def(SESSION_CONFIG, 'getSessionParameters', `()${REQUEST}`, (r, _m, [self]) => r.object(self).sessionConfig.parameters);
  def(SESSION_CONFIG, 'getInputConfiguration', `()${P}params/InputConfiguration;`, () => null);

  // ---- params/MeteringRectangle (android-13.0.0_r1 MeteringRectangle.java): a weighted rectangle of the active array, the value of the AE / AF / AWB region keys ---------------------
  const METERING = `${P}params/MeteringRectangle;`, POINT = 'Landroid/graphics/Point;';
  type(METERING, OBJECT, [], { allocatable: true });
  for (const [name, value] of Object.entries({ METERING_WEIGHT_MIN: 0, METERING_WEIGHT_MAX: 1000, METERING_WEIGHT_DONT_CARE: 0 })) staticField(METERING, name, 'I', () => value);
  const meteringInit = (r, self, x, y, width, height, weight) => {
    for (const [value, name] of [[x, 'x'], [y, 'y'], [width, 'width'], [height, 'height']]) if (value < 0) iae(r, `${name} must be nonnegative`);
    if (weight < 0 || weight > 1000) iae(r, `meteringWeight is out of range of [0, 1000] (too ${weight < 0 ? 'low' : 'high'})`);
    r.object(self).metering = { x, y, width, height, weight };
  };
  const rectField = (r, rect, name) => r.object(rect).fields.get(`${RECT}->${name}:I`) ?? 0;
  def(METERING, '<init>', '(IIIII)V', (r, _m, [self, x, y, width, height, weight]) => meteringInit(r, self, x, y, width, height, weight));
  def(METERING, '<init>', `(${POINT}${SIZE}I)V`, (r, _m, [self, point, size, weight]) => { if (nullish(point) || nullish(size)) r.throwJava('Ljava/lang/NullPointerException;', nullish(point) ? 'xy must not be null' : 'dimensions must not be null'); const [width, height] = sizeOf(r, size), field = name => r.object(point).fields.get(`${POINT}->${name}:I`) ?? 0; meteringInit(r, self, field('x'), field('y'), width, height, weight); });
  def(METERING, '<init>', `(${RECT}I)V`, (r, _m, [self, rect, weight]) => { if (nullish(rect)) r.throwJava('Ljava/lang/NullPointerException;', 'rect must not be null'); const left = rectField(r, rect, 'left'), top = rectField(r, rect, 'top'); meteringInit(r, self, left, top, rectField(r, rect, 'right') - left, rectField(r, rect, 'bottom') - top, weight); });
  const metering = (r, self) => r.object(self).metering;
  for (const [name, key] of [['getX', 'x'], ['getY', 'y'], ['getWidth', 'width'], ['getHeight', 'height'], ['getMeteringWeight', 'weight']]) def(METERING, name, '()I', (r, _m, [self]) => metering(r, self)[key]);
  def(METERING, 'getUpperLeftPoint', `()${POINT}`, (r, _m, [self]) => construct(r, POINT, ['I', 'I'], [metering(r, self).x, metering(r, self).y]));
  def(METERING, 'getSize', `()${SIZE}`, (r, _m, [self]) => construct(r, SIZE, ['I', 'I'], [metering(r, self).width, metering(r, self).height]));
  def(METERING, 'getRect', `()${RECT}`, (r, _m, [self]) => { const m = metering(r, self); return construct(r, RECT, ['I', 'I', 'I', 'I'], [m.x, m.y, m.x + m.width, m.y + m.height]); });
  def(METERING, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => { if (nullish(other) || r.typeOf(other) !== METERING) return 0; const a = metering(r, self), b = metering(r, other); return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.weight === b.weight ? 1 : 0; });
  def(METERING, 'hashCode', '()I', (r, _m, [self]) => { const m = metering(r, self); let h = 0; for (const value of [m.x, m.y, m.width, m.height, m.weight]) h = (Math.imul(31, h) + value) | 0; return h; });
  def(METERING, 'toString', `()${STRING}`, (r, _m, [self]) => { const m = metering(r, self); return `(x:${m.x}, y:${m.y}, w:${m.width}, h:${m.height}, wt:${m.weight})`; });

  // ---- CaptureRequest and its Builder ---------------------------------------------------------------------------------------------------------------------------------------
  type(REQUEST, METADATA, ['Landroid/os/Parcelable;']); type(BUILDER, OBJECT);
  const building = (r, self) => r.object(self).request;
  def(BUILDER, 'addTarget', `(${SURFACE})V`, (r, _m, [self, surface]) => { if (nullish(surface)) r.throwJava('Ljava/lang/NullPointerException;', 'Surface must not be null'); const q = building(r, self); if (!q.targets.some(entry => entry.ref === surface.ref)) q.targets.push(surface); });
  def(BUILDER, 'removeTarget', `(${SURFACE})V`, (r, _m, [self, surface]) => { const q = building(r, self); q.targets = q.targets.filter(entry => nullish(surface) || entry.ref !== surface.ref); });
  def(BUILDER, 'set', `(${KEY_TYPES.request}${OBJECT})V`, (r, _m, [self, key, value]) => { const name = keyOf(r, key), q = building(r, self); if (nullish(value)) q.values.delete(name); else q.values.set(name, value); });
  def(BUILDER, 'get', `(${KEY_TYPES.request})${OBJECT}`, (r, _m, [self, key]) => building(r, self).values.get(keyOf(r, key)) ?? null);
  def(BUILDER, 'setTag', `(${OBJECT})V`, (r, _m, [self, tag]) => { building(r, self).tag = nullish(tag) ? null : tag; });
  def(BUILDER, 'build', `()${REQUEST}`, (r, _m, [self]) => { const q = building(r, self), ref = r.makeObject(REQUEST); r.object(ref).request = { cameraId: q.cameraId, template: q.template, targets: [...q.targets], values: new Map(q.values), tag: q.tag }; return ref; });
  def(REQUEST, 'get', `(${KEY_TYPES.request})${OBJECT}`, (r, _m, [self, key]) => r.object(self).request.values.get(keyOf(r, key)) ?? null);
  def(REQUEST, 'getTag', `()${OBJECT}`, (r, _m, [self]) => r.object(self).request.tag);
  def(REQUEST, 'isReprocess', '()Z', () => 0);
  const keysOfValues = (r, group, values) => { const byName = Object.entries(K[group]); return listOf(r, [...values.keys()].map(name => byName.find(([, value]) => value === name)).filter(Boolean).map(([field]) => keyObject(r, group, field))); };
  def(REQUEST, 'getKeys', `()${LIST}`, (r, _m, [self]) => keysOfValues(r, 'request', r.object(self).request.values));

  // ---- CaptureResult ----------------------------------------------------------------------------------------------------------------------------------------------------------
  type(RESULT, METADATA); type(TOTAL_RESULT, RESULT); type(FAILURE, OBJECT);
  const resultOf = (r, self) => r.object(self).captureResult;
  for (const owner of [RESULT, TOTAL_RESULT]) {
    def(owner, 'get', `(${KEY_TYPES.result})${OBJECT}`, (r, _m, [self, key]) => resultOf(r, self).values.get(keyOf(r, key)) ?? null);
    def(owner, 'getRequest', `()${REQUEST}`, (r, _m, [self]) => resultOf(r, self).request);
    def(owner, 'getFrameNumber', '()J', (r, _m, [self]) => BigInt(resultOf(r, self).frameNumber));
    def(owner, 'getSequenceId', '()I', (r, _m, [self]) => resultOf(r, self).sequenceId);
    def(owner, 'getCameraId', `()${STRING}`, (r, _m, [self]) => resultOf(r, self).cameraId);
    def(owner, 'getKeys', `()${LIST}`, (r, _m, [self]) => keysOfValues(r, 'result', resultOf(r, self).values));
  }
  def(TOTAL_RESULT, 'getPartialResults', `()${LIST}`, r => listOf(r, []));
  def(TOTAL_RESULT, 'getPhysicalCameraResults', '()Ljava/util/Map;', r => construct(r, 'Ljava/util/HashMap;'));

  // ---- CameraCaptureSession ---------------------------------------------------------------------------------------------------------------------------------------------------
  type(SESSION, OBJECT, ['Ljava/lang/AutoCloseable;']); type(SESSION_IMPL, SESSION, [], { allocatable: true }); type(SESSION_CALLBACK, OBJECT, [], { allocatable: true }); type(CAPTURE_CALLBACK, OBJECT, [], { allocatable: true });
  def(SESSION_CALLBACK, '<init>', '()V', () => {}); def(CAPTURE_CALLBACK, '<init>', '()V', () => {});
  for (const name of ['onReady', 'onActive', 'onClosed', 'onCaptureQueueEmpty']) def(SESSION_CALLBACK, name, `(${SESSION})V`, () => {});
  def(SESSION_CALLBACK, 'onSurfacePrepared', `(${SESSION}${SURFACE})V`, () => {});
  def(CAPTURE_CALLBACK, 'onCaptureStarted', `(${SESSION}${REQUEST}JJ)V`, () => {}); def(CAPTURE_CALLBACK, 'onCaptureProgressed', `(${SESSION}${REQUEST}${RESULT})V`, () => {});
  def(CAPTURE_CALLBACK, 'onCaptureCompleted', `(${SESSION}${REQUEST}${TOTAL_RESULT})V`, () => {}); def(CAPTURE_CALLBACK, 'onCaptureFailed', `(${SESSION}${REQUEST}${FAILURE})V`, () => {});
  def(CAPTURE_CALLBACK, 'onCaptureSequenceCompleted', `(${SESSION}IJ)V`, () => {}); def(CAPTURE_CALLBACK, 'onCaptureSequenceAborted', `(${SESSION}I)V`, () => {}); def(CAPTURE_CALLBACK, 'onCaptureBufferLost', `(${SESSION}${REQUEST}${SURFACE}J)V`, () => {});
  const sessionOf = (r, self) => r.object(self).cameraSession;
  const liveSession = (r, self) => { const session = sessionOf(r, self); if (session.closed) ise(r, 'Session has been closed; further changes are illegal.'); if (session.device.closed) ise(r, 'CameraDevice was already closed'); return session; };
  /** CameraCaptureSessionImpl.checkCaptureRequest: a request needs targets, all of them outputs of this session. */
  const checked = (r, session, request) => {
    if (nullish(request)) iae(r, 'request must not be null'); const q = r.object(request).request;
    if (!q.targets.length) iae(r, 'Each request must have at least one Surface target');
    const outputs = q.targets.map(surface => session.outputs.find(output => output.surface.ref === surface.ref) ?? iae(r, 'CaptureRequest contains unconfigured Input/Output Surface!'));
    return { request, q, outputs };
  };
  /** The target for capture callbacks: none needed without a callback; otherwise the Executor, the Handler, or the calling thread's Looper. */
  const callbackTarget = (r, callback, handler, executor) => (executor !== undefined ? executorTarget(r, executor) : nullish(callback) ? null : targetFor(r, handler));
  /** How the page draws a frame for a request: the display rotation of the device (degrees; the scene is fixed, the phone turns) and the request's crop region (the digital zoom). Fields only when they differ from portrait / the full array. */
  const viewOf = (r, values) => {
    const out = {}, rotation = displayRotation(); if (rotation) out.rotation = rotation;
    const rect = values?.get(keyName('request', 'SCALER_CROP_REGION')), field = name => r.object(rect).fields.get(`${RECT}->${name}:I`) ?? 0;
    if (!nullish(rect)) {
      const { width, height } = SENSOR_ARRAY, left = Math.max(0, field('left')), top = Math.max(0, field('top')), right = Math.min(width, field('right')), bottom = Math.min(height, field('bottom'));
      const zoom = Math.min(MAX_DIGITAL_ZOOM, Math.max(1, Math.min(width / Math.max(1, right - left), height / Math.max(1, bottom - top))));
      if (right > left && bottom > top && zoom > 1.0001) out.crop = { zoom: Math.round(zoom * 1000) / 1000, cx: Math.round((left + right) / 2 / width * 1e4) / 1e4, cy: Math.round((top + bottom) / 2 / height * 1e4) / 1e4 };
    }
    return out;
  };
  const displayRotation = () => (platform.device?.orientation === 'landscape' ? 90 : 0);   // Display.getRotation: ROTATION_90 in landscape (src/display-host.js)
  const markStreams = (r, outputs, live, cameraId, values = null) => {
    for (const output of outputs) {
      const sink = output.sink; if (sink.kind === 'reader' || sink.kind === 'encoder') continue;
      const camera = cameraById(cameraId); sink.stream = { cameraId, facing: camera.facing, orientation: camera.orientation, width: output.stream.width, height: output.stream.height, live, ...(live && values ? viewOf(r, values) : live ? {} : { ...(sink.stream?.rotation ? { rotation: sink.stream.rotation } : {}), ...(sink.stream?.crop ? { crop: sink.stream.crop } : {}) }) };
      const view = sink.kind === 'holder' ? sink.view : sink.state.ownerView; if (view) platform.requestDraw?.(r, view);
    }
  };
  const stopStreams = (r, session) => {
    if (session.repeating) markStreams(r, session.repeating.entries.flatMap(entry => entry.outputs), false, session.device.id);
    session.repeating = null; session.jobs.length = 0; session.active = false;
  };
  const tellActive = (r, session) => { if (session.active) return; session.active = true; post(r, session.target, () => { if (!session.closed) call(r, session.callback, SESSION_CALLBACK, 'onActive', [SESSION], 'V', [session.ref]); }, [session.ref, session.callback]); };
  const tellReadyIfIdle = (r, session) => { if (!session.active || session.repeating || session.jobs.length || session.closed) return; session.active = false; post(r, session.target, () => { if (!session.closed && !session.active) call(r, session.callback, SESSION_CALLBACK, 'onReady', [SESSION], 'V', [session.ref]); }, [session.ref, session.callback]); };
  const submit = (r, self, requests, callback, target, repeating) => {
    const session = liveSession(r, self); if (!requests.length) iae(r, 'At least one request must be given');
    const entries = requests.map(request => checked(r, session, request)), sequenceId = ++S.sequence, job = { entries, callback: nullish(callback) ? null : callback, target, sequenceId, next: 0, once: [], lastFrame: -1 };
    if (repeating) {
      const previous = session.repeating; if (previous) { markStreams(r, previous.entries.flatMap(entry => entry.outputs), false, session.device.id); sequenceDone(r, session, previous); }
      session.repeating = job; markStreams(r, entries.flatMap(entry => entry.outputs), true, session.device.id, entries[0].q.values);
    } else {
      // each ImageReader target of a single capture gets its buffer once
      entries.forEach((entry, index) => { for (const output of entry.outputs) if (output.sink.kind === 'reader' || output.sink.kind === 'encoder') job.once.push({ id: ++S.once, index, output }); else output.sink.shots++; });
      session.jobs.push(job);
    }
    tellActive(r, session); publish(r); return sequenceId;
  };
  const sequenceDone = (r, session, job) => { if (job.callback && job.lastFrame >= 0) post(r, job.target, () => call(r, job.callback, CAPTURE_CALLBACK, 'onCaptureSequenceCompleted', [SESSION, 'I', 'J'], 'V', [session.ref, job.sequenceId, BigInt(job.lastFrame)]), [session.ref, job.callback]); };
  def(SESSION_IMPL, 'getDevice', `()${DEVICE}`, (r, _m, [self]) => sessionOf(r, self).device.ref);
  def(SESSION_IMPL, 'isReprocessable', '()Z', () => 0); def(SESSION_IMPL, 'getInputSurface', `()${SURFACE}`, () => null);
  def(SESSION_IMPL, 'capture', `(${REQUEST}${CAPTURE_CALLBACK}${HANDLER})I`, (r, _m, [self, request, callback, handler]) => { liveSession(r, self); return submit(r, self, [request], callback, callbackTarget(r, callback, handler), false); });
  def(SESSION_IMPL, 'captureSingleRequest', `(${REQUEST}${EXECUTOR}${CAPTURE_CALLBACK})I`, (r, _m, [self, request, executor, callback]) => { liveSession(r, self); if (nullish(callback)) iae(r, 'callback must not be null'); return submit(r, self, [request], callback, callbackTarget(r, callback, null, executor), false); });
  def(SESSION_IMPL, 'captureBurst', `(${LIST}${CAPTURE_CALLBACK}${HANDLER})I`, (r, _m, [self, list, callback, handler]) => { liveSession(r, self); return submit(r, self, listItems(r, list), callback, callbackTarget(r, callback, handler), false); });
  def(SESSION_IMPL, 'captureBurstRequests', `(${LIST}${EXECUTOR}${CAPTURE_CALLBACK})I`, (r, _m, [self, list, executor, callback]) => { liveSession(r, self); if (nullish(callback)) iae(r, 'callback must not be null'); return submit(r, self, listItems(r, list), callback, callbackTarget(r, callback, null, executor), false); });
  def(SESSION_IMPL, 'setRepeatingRequest', `(${REQUEST}${CAPTURE_CALLBACK}${HANDLER})I`, (r, _m, [self, request, callback, handler]) => { liveSession(r, self); return submit(r, self, [request], callback, callbackTarget(r, callback, handler), true); });
  def(SESSION_IMPL, 'setSingleRepeatingRequest', `(${REQUEST}${EXECUTOR}${CAPTURE_CALLBACK})I`, (r, _m, [self, request, executor, callback]) => { liveSession(r, self); if (nullish(callback)) iae(r, 'callback must not be null'); return submit(r, self, [request], callback, callbackTarget(r, callback, null, executor), true); });
  def(SESSION_IMPL, 'setRepeatingBurst', `(${LIST}${CAPTURE_CALLBACK}${HANDLER})I`, (r, _m, [self, list, callback, handler]) => { liveSession(r, self); return submit(r, self, listItems(r, list), callback, callbackTarget(r, callback, handler), true); });
  def(SESSION_IMPL, 'setRepeatingBurstRequests', `(${LIST}${EXECUTOR}${CAPTURE_CALLBACK})I`, (r, _m, [self, list, executor, callback]) => { liveSession(r, self); if (nullish(callback)) iae(r, 'callback must not be null'); return submit(r, self, listItems(r, list), callback, callbackTarget(r, callback, null, executor), true); });
  def(SESSION_IMPL, 'stopRepeating', '()V', (r, _m, [self]) => {
    const session = liveSession(r, self), job = session.repeating; if (!job) return;
    markStreams(r, job.entries.flatMap(entry => entry.outputs), false, session.device.id); session.repeating = null; sequenceDone(r, session, job); tellReadyIfIdle(r, session); publish(r);
  });
  def(SESSION_IMPL, 'abortCaptures', '()V', (r, _m, [self]) => {
    const session = liveSession(r, self), dropped = [...session.jobs, ...(session.repeating ? [session.repeating] : [])];
    stopStreams(r, session); session.active = true;
    for (const job of dropped) if (job.callback) post(r, job.target, () => call(r, job.callback, CAPTURE_CALLBACK, 'onCaptureSequenceAborted', [SESSION, 'I'], 'V', [session.ref, job.sequenceId]), [session.ref, job.callback]);
    tellReadyIfIdle(r, session); publish(r);
  });
  def(SESSION_IMPL, 'close', '()V', (r, _m, [self]) => endSession(r, sessionOf(r, self)));
  def(SESSION_IMPL, 'prepare', `(${SURFACE})V`, (r, _m, [self, surface]) => { const session = liveSession(r, self); if (!session.outputs.some(output => output.surface.ref === surface?.ref)) iae(r, 'Surface is not part of this session'); post(r, session.target, () => call(r, session.callback, SESSION_CALLBACK, 'onSurfacePrepared', [SESSION, SURFACE], 'V', [session.ref, surface]), [session.ref, session.callback, surface]); });

  // ---- the frame engine -------------------------------------------------------------------------------------------------------------------------------------------------------
  /** What the page has to produce: per open camera, whether frames should flow and which pixel buffers each frame (repeating ImageReader targets) or one frame (`once`: stills) must carry. Posted only when it changes. */
  const publish = (r = platform.vmRuntime) => {
    const list = [];
    for (const device of S.devices.values()) {
      const session = device.session, buffers = [], once = [];
      // a size only encoders consume may arrive as a VideoFrame (`video`); a size an ImageReader reads has to be pixels
      if (session?.repeating) for (const entry of session.repeating.entries) for (const output of entry.outputs) {
        const kind = output.sink.kind; if (kind !== 'reader' && kind !== 'encoder') continue;
        const same = buffers.find(b => b.width === output.stream.width && b.height === output.stream.height);
        if (!same) buffers.push({ width: output.stream.width, height: output.stream.height, ...(kind === 'encoder' ? { video: true } : {}) }); else if (kind === 'reader') delete same.video;
      }
      for (const job of session?.jobs ?? []) for (const need of job.once) if (!need.served) once.push({ id: need.id, width: need.output.stream.width, height: need.output.stream.height, ...(r ? viewOf(r, job.entries[need.index].q.values) : {}) });
      device.view = session?.repeating && r ? viewOf(r, session.repeating.entries[0].q.values) : {};
      list.push({ id: device.id, active: !!(session && (session.repeating || session.jobs.length)), buffers, once, ...device.view });
    }
    const text = JSON.stringify(list); if (text === S.posted) return; S.posted = text; send({ op: 'streams', cameras: list });
  };
  /** The 3A state the next result reports, after the request's AF mode and triggers (as the emulator's fake camera: an AUTO / MACRO scan reports ACTIVE_SCAN for a few frames, then FOCUSED_LOCKED). */
  const SCAN_FRAMES = 3;
  const step3A = (r, device, values) => {
    const mode = device.camera.autofocus ? unboxed(r, values.get(keyName('request', 'CONTROL_AF_MODE')), 0) : 0, trigger = unboxed(r, values.get(keyName('request', 'CONTROL_AF_TRIGGER')), 0), af = device.af, continuous = mode === 3 || mode === 4;
    if (af.mode !== mode) { af.mode = mode; af.state = continuous ? AF.PASSIVE_FOCUSED : AF.INACTIVE; }
    if (mode === 0) af.state = AF.INACTIVE;
    else if (trigger === 2) af.state = continuous ? AF.PASSIVE_FOCUSED : AF.INACTIVE;
    else if (trigger === 1) { if (af.state === AF.ACTIVE_SCAN || af.state === AF.FOCUSED_LOCKED || continuous) af.state = AF.FOCUSED_LOCKED; else { af.state = AF.ACTIVE_SCAN; af.scan = SCAN_FRAMES; } }
    else if (af.state === AF.ACTIVE_SCAN && --af.scan <= 0) af.state = AF.FOCUSED_LOCKED;
    const precapture = unboxed(r, values.get(keyName('request', 'CONTROL_AE_PRECAPTURE_TRIGGER')), 0);
    device.ae.state = precapture === 1 && device.ae.state !== AE.PRECAPTURE ? AE.PRECAPTURE : AE.CONVERGED;
  };
  const makeResult = (r, device, entry, sequenceId, frameNumber, timestamp) => {
    const values = new Map(entry.q.values); step3A(r, device, entry.q.values);
    values.set(keyName('result', 'SENSOR_TIMESTAMP'), r.boxPrimitive('J', BigInt(timestamp)));
    values.set(keyName('result', 'CONTROL_AF_STATE'), r.boxPrimitive('I', device.af.state)); values.set(keyName('result', 'CONTROL_AE_STATE'), r.boxPrimitive('I', device.ae.state)); values.set(keyName('result', 'CONTROL_AWB_STATE'), r.boxPrimitive('I', 2));
    values.set(keyName('result', 'LENS_STATE'), r.boxPrimitive('I', 0)); values.set(keyName('result', 'FLASH_STATE'), r.boxPrimitive('I', 0)); values.set(keyName('result', 'REQUEST_PIPELINE_DEPTH'), r.boxPrimitive('B', 1));
    const ref = r.makeObject(TOTAL_RESULT); r.object(ref).captureResult = { request: entry.request, frameNumber, sequenceId, cameraId: device.id, values }; return ref;
  };
  /** One request served by one frame: onCaptureStarted, the frame into each target, onCaptureCompleted. `bufferFor(output)`: the RGBA buffer of a reader target, or null when the frame carries none for it. */
  const serve = (r, device, session, job, entry, bufferFor) => {
    const frameNumber = device.frameNumber++, timestamp = now(), { callback, target } = job, request = entry.request;
    if (callback) post(r, target, () => call(r, callback, CAPTURE_CALLBACK, 'onCaptureStarted', [SESSION, REQUEST, 'J', 'J'], 'V', [session.ref, request, BigInt(timestamp), BigInt(frameNumber)]), [session.ref, request, callback]);
    const lost = [];
    for (const output of entry.outputs) {
      const sink = output.sink;
      if (sink.kind === 'texture') surfaces.textureFrame(r, sink.texture, timestamp);
      else if (sink.kind === 'reader') {
        const picture = bufferFor(output), buffer = picture?.data ? new Uint8Array(picture.data) : null, values = entry.q.values;
        const queued = buffer ? surfaces.readerFrame(r, sink, buffer, { timestamp, jpegQuality: unboxed(r, values.get(keyName('request', 'JPEG_QUALITY')), 95), jpegOrientation: unboxed(r, values.get(keyName('request', 'JPEG_ORIENTATION')), 0) }) : false;
        if (!queued) { lost.push(output.surface); S.stats.dropped++; }
      } else if (sink.kind === 'encoder') {
        const picture = bufferFor(output);
        if (!picture || !sink.frame(r, picture, timestamp)) { lost.push(output.surface); S.stats.dropped++; } else S.stats.encoded++;
      }
    }
    job.lastFrame = frameNumber;
    const result = makeResult(r, device, entry, job.sequenceId, frameNumber, timestamp);
    if (callback) post(r, target, () => {
      for (const surface of lost) call(r, callback, CAPTURE_CALLBACK, 'onCaptureBufferLost', [SESSION, REQUEST, SURFACE, 'J'], 'V', [session.ref, request, surface, BigInt(frameNumber)]);
      call(r, callback, CAPTURE_CALLBACK, 'onCaptureCompleted', [SESSION, REQUEST, TOTAL_RESULT], 'V', [session.ref, request, result]);
    }, [session.ref, request, result, callback, ...lost]);
  };
  /** A frame from the page for an open camera: the oldest pending capture() whose buffers it carries, else the repeating request. Returns where that request's callbacks were posted (null: nowhere). */
  const processFrame = (r, device, frame) => {
    const session = device.session; if (!session || session.closed) return null;
    const buffers = frame.buffers ?? [];
    const job = session.jobs[0];
    if (job) {
      const index = job.next, needs = job.once.filter(need => need.index === index), found = needs.map(need => buffers.find(buffer => buffer.once === need.id));
      if (found.every(Boolean)) {
        for (const need of needs) need.served = true;
        serve(r, device, session, job, job.entries[index], output => { const at = needs.findIndex(need => need.output === output); return at < 0 ? null : found[at]; });
        if (++job.next >= job.entries.length) { session.jobs.shift(); sequenceDone(r, session, job); tellReadyIfIdle(r, session); }
        publish(r); return job.target;
      }
    }
    const repeating = session.repeating; if (!repeating) return null;
    const entry = repeating.entries[repeating.next++ % repeating.entries.length];
    const view = viewOf(r, entry.q.values); if (JSON.stringify(view) !== JSON.stringify(device.view ?? {})) { markStreams(r, entry.outputs, true, device.id, entry.q.values); publish(r); }   // the device turned, or the app zoomed: the next frames are drawn that way
    serve(r, device, session, repeating, entry, output => { const buffer = buffers.find(candidate => candidate.once === undefined && candidate.width === output.stream.width && candidate.height === output.stream.height); return buffer ?? null; });
    return repeating.target;
  };

  const intents = installCaptureIntents({ platform, state: S, send, call, callStatic, construct });

  return {
    ...registry, interfaces: registry.interfacesOf, state: S, manager, media,
    /** The host's video codecs (src/media-codec-backend.js; null: none). Independent of the camera hardware: a device can have an encoder and no camera page. */
    attachCodecs(backend) { media.attach(backend); },
    get attached() { return !!S.backend; },
    get stats() { return S.stats; },
    /** The page (or a scripted source) became the device's camera hardware. `backend.post(message, transfer?)` receives { op: 'open' | 'close' | 'streams' | 'ack' | 'capture-ui' | 'capture-ui-close', ... }. */
    attach(backend) {
      if (!backend || typeof backend.post !== 'function') throw new TypeError('A camera backend needs post(message, transfer)');
      S.backend = backend; S.posted = ''; for (const feature of CAMERA_FEATURES) platform.systemFeatures.add(feature);
      const r = platform.vmRuntime; if (r) for (const camera of CAMERAS) if (S.availability.length) platform.queueTask(() => tellAvailability(r, camera.id, true), 0, []);
    },
    /** The page went away: open cameras are disconnected (onDisconnected) and the device has no camera again. */
    detach(r) {
      if (!S.backend) return;
      if (r) { for (const device of [...S.devices.values()]) platform.queueTask(() => disconnect(r, device), 0, [device.ref]); for (const camera of CAMERAS) if (S.availability.length) platform.queueTask(() => tellAvailability(r, camera.id, false), 0, []); intents.cancelAll(r); }
      S.backend = null; surfaces.dropPreviews(); for (const feature of CAMERA_FEATURES) platform.systemFeatures.delete(feature);
    },
    /** A message of the camera hardware: { op: 'frame', cameraId, seq, buffers: [{ width, height, data, once? }] } or { op: 'capture-result', id, ... }. The app's callbacks run later, through the pump. */
    handle(r, message) {
      if (!S.backend || !message || typeof message !== 'object') return;
      if (message.op === 'frame') {
        const device = S.devices.get(String(message.cameraId)), acknowledge = () => send({ op: 'ack', cameraId: message.cameraId, seq: message.seq });
        const release = () => { for (const buffer of message.buffers ?? []) if (buffer.frame && !buffer.taken) { buffer.taken = true; try { buffer.frame.close(); } catch { /* already closed */ } } };   // a VideoFrame no encoder took holds host memory until closed
        if (!device || device.closed) { release(); acknowledge(); return; }
        for (const preview of message.previews ?? []) surfaces.setPreview(preview.viewId, preview);   // what the page's preview surfaces show now (TextureView.getBitmap, PixelCopy)
        S.stats.frames++; for (const buffer of message.buffers ?? []) if (buffer.data) { S.stats.pixelFrames++; S.stats.pixelBytes += buffer.data.byteLength ?? 0; }
        // The ack follows the app's callbacks for this frame on the thread they run on (its Handler or Executor), so a slow consumer slows the source down instead of growing a queue.
        platform.queueTask(() => {
          const started = performance.now(); let target = null;
          try { if (!device.closed) target = processFrame(r, device, message); }
          finally { release(); S.stats.frameMs += performance.now() - started; try { if (target) post(r, target, acknowledge); else platform.queueTask(acknowledge, 0, []); } catch { platform.queueTask(acknowledge, 0, []); } }
        }, 0, [device.ref]);
      } else if (message.op === 'capture-result') intents.respond(r, message);
      else if (message.op === 'capabilities') S.backend.captureVideo = message.captureVideo === true;   // the page found out (asynchronously) whether its camera screen can record
    },
    viewKind: surfaces.viewKind, nodeState: surfaces.nodeState,
    interceptStartActivity: intents.intercept, resolvesIntent: intents.resolves, systemActivity: intents.systemActivity,
  };
}

/** CameraManager's methods on the service host type of src/peripheral-services-host.js (which owns Context.CAMERA_SERVICE); everything behind them is the camera host of the platform. */
export function installCameraManager({ def, stringArray, construct, nullish: isNull, iae, text }, platform, CAMERA) {
  const host = () => platform.camera.manager;
  def(CAMERA, 'getCameraIdList', `()[${STRING}`, r => stringArray(r, host().idList()));
  def(CAMERA, 'getCameraIdListNoLazy', `()[${STRING}`, r => stringArray(r, host().idList()));
  def(CAMERA, 'getConcurrentCameraIds', '()Ljava/util/Set;', r => construct(r, 'Ljava/util/HashSet;'));
  def(CAMERA, 'registerAvailabilityCallback', `(${AVAILABILITY}${HANDLER})V`, (r, _m, [, callback, handler]) => { if (isNull(callback)) iae(r, 'callback must not be null'); host().registerAvailability(r, callback, host().targetFor(r, handler)); });
  def(CAMERA, 'registerAvailabilityCallback', `(${EXECUTOR}${AVAILABILITY})V`, (r, _m, [, executor, callback]) => { if (isNull(executor)) iae(r, 'executor was null'); host().registerAvailability(r, callback, { executor }); });
  def(CAMERA, 'unregisterAvailabilityCallback', `(${AVAILABILITY})V`, (r, _m, [, callback]) => host().unregisterAvailability(r, callback));
  def(CAMERA, 'registerTorchCallback', `(${TORCH}${HANDLER})V`, (r, _m, [, callback]) => { if (isNull(callback)) iae(r, 'callback must not be null'); });   // no camera has a flash unit: a torch callback never fires
  def(CAMERA, 'registerTorchCallback', `(${EXECUTOR}${TORCH})V`, (r, _m, [, , callback]) => { if (isNull(callback)) iae(r, 'callback must not be null'); });
  def(CAMERA, 'unregisterTorchCallback', `(${TORCH})V`, (r, _m, [, callback]) => { if (isNull(callback)) iae(r, 'callback must not be null'); });
  def(CAMERA, 'getCameraCharacteristics', `(${STRING})${CHARACTERISTICS}`, (r, _m, [, id]) => host().characteristics(r, id));
  def(CAMERA, 'setTorchMode', `(${STRING}Z)V`, (r, _m, [, id]) => { if (isNull(id)) iae(r, 'cameraId was null'); iae(r, `Camera ${text(r, id)} is not a flashlight device`); });
  def(CAMERA, 'openCamera', `(${STRING}${DEVICE_CALLBACK}${HANDLER})V`, (r, _m, [, id, callback, handler]) => { if (isNull(id)) iae(r, 'cameraId was null'); if (isNull(callback)) iae(r, 'callback was null'); host().open(r, id, callback, host().targetFor(r, handler)); });
  def(CAMERA, 'openCamera', `(${STRING}${EXECUTOR}${DEVICE_CALLBACK})V`, (r, _m, [, id, executor, callback]) => { if (isNull(executor)) iae(r, 'executor was null'); host().open(r, id, callback, { executor }); });
}
export { IMAGE_READER, SURFACE_TEXTURE };
