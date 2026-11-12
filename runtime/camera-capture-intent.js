import { IntCells } from './java-arrays.js?v=a9e9656b8d6c';

// The camera capture Intents (android-13.0.0_r1 MediaStore.java ACTION_IMAGE_CAPTURE / ACTION_IMAGE_CAPTURE_SECURE; the contract a camera app follows is the one of AOSP's Camera2
// PhotoModule.onCaptureDone). On a phone another app answers them; in the lab the page is that app: it shows a minimal camera screen over the device (live preview of the camera source,
// shutter, cancel: src/camera-capture-ui.js) and sends back the picture. Without an attached page the device has no camera app and the Intent resolves to nothing
// (ActivityNotFoundException), as before.
//
//   startActivityForResult(Intent(ACTION_IMAGE_CAPTURE).putExtra(EXTRA_OUTPUT, uri))  ->  the JPEG is written through ContentResolver.openOutputStream(uri) (the app's own FileProvider
//                                                                                        code runs), result RESULT_OK with a null Intent
//   startActivityForResult(Intent(ACTION_IMAGE_CAPTURE))                              ->  RESULT_OK, Intent("inline-data") with the "data" extra: a Bitmap of at most 50 * 1024 pixels
//   cancel                                                                             ->  RESULT_CANCELED, null
//
// The caller is paused and stopped while the camera screen is up and comes back through onRestart / onStart / onActivityResult / onResume, the order ActivityThread uses. As on
// Android 6+, an app that declares android.permission.CAMERA and does not hold it gets a SecurityException from the start (ActivityTaskSupervisor.checkStartAnyActivityPermission).
// ACTION_VIDEO_CAPTURE is not answered (no camera app records video here): it stays an ActivityNotFoundException, with a line in the run log.
const INTENT = 'Landroid/content/Intent;', STRING = 'Ljava/lang/String;', PARCELABLE = 'Landroid/os/Parcelable;', URI = 'Landroid/net/Uri;', RESOLVER = 'Landroid/content/ContentResolver;', OUTPUT_STREAM = 'Ljava/io/OutputStream;', BITMAP = 'Landroid/graphics/Bitmap;', CONFIG = 'Landroid/graphics/Bitmap$Config;', CONTEXT = 'Landroid/content/Context;';
export const ACTION_IMAGE_CAPTURE = 'android.media.action.IMAGE_CAPTURE', ACTION_IMAGE_CAPTURE_SECURE = 'android.media.action.IMAGE_CAPTURE_SECURE', ACTION_VIDEO_CAPTURE = 'android.media.action.VIDEO_CAPTURE';
const CAMERA_PERMISSION = 'android.permission.CAMERA', RESULT_OK = -1, RESULT_CANCELED = 0;
const nullish = value => value === null || value === undefined || value === 0;

export function installCaptureIntents({ platform, state: S, send, call, callStatic, construct }) {
  let sequence = 0;
  const actionOf = (r, intent) => (nullish(intent.action) ? null : typeof intent.action === 'string' ? intent.action : r.stringCharacters(intent.action));
  const answers = action => !!S.backend?.captureUi && (action === ACTION_IMAGE_CAPTURE || action === ACTION_IMAGE_CAPTURE_SECURE);
  const liveFrame = frame => frame && !frame.finished && !frame.finishing && platform.allFrames().includes(frame);
  /** Delivers the result to the Activity that asked and brings it back to the resumed state. */
  const finish = (r, capture, resultCode, data) => {
    S.captures.delete(capture.id);
    const frame = capture.frame; if (!liveFrame(frame)) { r.record(`CAMERA capture ${capture.id} result dropped: the Activity that asked is gone`); return; }
    if (capture.requestCode >= 0) (frame.pendingActivityResults ||= []).push({ requestCode: capture.requestCode, resultCode, data });
    if (platform.taskInBackground || platform.tasks.at(-1)?.frames.at(-1) !== frame) return;   // not on top any more (the user left the app): the result waits for the Activity's next resume
    platform.resumeFrame(r, frame, []);
  };
  const writeOutput = (r, capture, jpeg) => {
    const context = platform.application ?? r.application, resolver = call(r, context, CONTEXT, 'getContentResolver', [], RESOLVER);
    const stream = call(r, resolver, RESOLVER, 'openOutputStream', [URI], OUTPUT_STREAM, [capture.output]);
    if (nullish(stream)) throw new Error('ContentResolver.openOutputStream returned null');
    const bytes = new Uint8Array(jpeg), array = r.newArray('[B', bytes.length); r.array(array).elements.set(bytes);
    try { call(r, stream, OUTPUT_STREAM, 'write', ['[B'], 'V', [array]); } finally { call(r, stream, OUTPUT_STREAM, 'close', [], 'V'); }
  };
  const inlineBitmap = (r, thumb) => {
    const rgba = new Uint8Array(thumb.data), count = thumb.width * thumb.height, colors = new IntCells(count);
    for (let i = 0, at = 0; i < count; i++, at += 4) colors[i] = (255 << 24) | (rgba[at] << 16) | (rgba[at + 1] << 8) | rgba[at + 2];
    const array = r.newArray('[I', count, colors), config = r.readStatic({ owner: CONFIG, name: 'ARGB_8888', type: CONFIG });
    return callStatic(r, BITMAP, 'createBitmap', ['[I', 'I', 'I', CONFIG], BITMAP, [array, thumb.width, thumb.height, config]);
  };
  return {
    /** Whether the device's camera app answers `action` (PackageManager.resolveActivity / queryIntentActivities can ask before starting). */
    resolves: action => answers(action),
    /**
     * Called first by AndroidPlatform.startActivity. Returns true when the Intent is one the camera app answers and the capture was started (the caller must not look for an Activity
     * of the APK); false for every other Intent. An explicit component is never intercepted.
     */
    intercept(r, intentValue, resultCaller, requestCode) {
      const intent = r.object(intentValue); if (intent.target) return false;
      const action = actionOf(r, intent);
      if (action === ACTION_VIDEO_CAPTURE && S.backend) { r.record('CAMERA android.media.action.VIDEO_CAPTURE: the lab has no camera app that records video; no Activity answers it'); return false; }
      if (!answers(action)) return false;
      if ((platform.manifest?.usesPermissions ?? []).some(entry => entry.name === CAMERA_PERMISSION) && !platform.holdsPermission?.(r, CAMERA_PERMISSION)) {
        const described = platform.describeIntentFields(platform.intentFields(r, intent), intent.flags | 0);
        r.throwJava('Ljava/lang/SecurityException;', `Permission Denial: starting ${described} from ProcessRecord{${platform.packageName}} (pid=${platform.virtualProcess?.pid ?? 0}, uid=${platform.virtualProcess?.uid ?? 10000}) with revoked permission ${CAMERA_PERMISSION}`);
      }
      platform.syncCurrent(r);
      const source = !nullish(r.activity) && !platform.finishedActivities.has(r.activity.ref) ? platform.frame(r) : null;
      const receiver = !nullish(resultCaller) ? platform.allFrames().find(frame => frame.activity.ref === resultCaller.ref && !frame.finished) ?? source : source;
      const output = call(r, intentValue, INTENT, 'getParcelableExtra', [STRING], PARCELABLE, ['output']);   // MediaStore.EXTRA_OUTPUT
      if (!nullish(output) && !r.isSubtype(r.typeOf(output), URI)) r.throwJava('Ljava/lang/ClassCastException;', `MediaStore.EXTRA_OUTPUT must be a Uri, not ${r.typeOf(output).slice(1, -1).replaceAll('/', '.')}`);
      const id = ++sequence, capture = { id, frame: receiver, requestCode: receiver && requestCode >= 0 ? requestCode : -1, output: nullish(output) ? null : output, activity: receiver?.activity ?? null };
      S.captures.set(id, capture);
      r.record(`CAMERA capture ${id} ${action}${capture.output ? ' -> EXTRA_OUTPUT' : ' (inline thumbnail)'}${capture.requestCode >= 0 ? ` request ${capture.requestCode}` : ' without a result'}`);
      if (source) { platform.pauseForLaunch(r, source, true); if (liveFrame(source)) platform.stopFrame(r, source); }
      send({ op: 'capture-ui', id, mode: 'image', wantsFile: !!capture.output });
      return true;
    },
    /** The camera screen's answer: { id, ok: false } (cancelled) or { id, ok: true, jpeg: ArrayBuffer, thumb: { width, height, data } }. */
    respond(r, message) {
      const capture = S.captures.get(message.id); if (!capture) return;
      platform.queueTask(() => {
        if (!S.captures.has(capture.id)) return;
        if (!message.ok) { r.record(`CAMERA capture ${capture.id} cancelled`); finish(r, capture, RESULT_CANCELED, null); return; }
        try {
          if (capture.output) { writeOutput(r, capture, message.jpeg); r.record(`CAMERA capture ${capture.id} wrote ${message.jpeg.byteLength} JPEG bytes to EXTRA_OUTPUT`); finish(r, capture, RESULT_OK, null); return; }
          const data = construct(r, INTENT, [STRING], ['inline-data']); call(r, data, INTENT, 'putExtra', [STRING, PARCELABLE], INTENT, ['data', inlineBitmap(r, message.thumb)]);
          r.record(`CAMERA capture ${capture.id} returned a ${message.thumb.width}x${message.thumb.height} Bitmap`); finish(r, capture, RESULT_OK, data);
        } catch (error) {
          // A camera app that cannot write its output has nothing to return: the caller sees a cancelled capture, and the reason is in the log.
          r.record(`CAMERA capture ${capture.id} failed: ${String(error?.message ?? error).slice(0, 300)}`); finish(r, capture, RESULT_CANCELED, null);
        }
      }, 0, [capture.activity, capture.output].filter(Boolean));
    },
    /** The camera app went away with captures open (the page detached): each is a cancelled capture. */
    cancelAll(r) { for (const capture of [...S.captures.values()]) platform.queueTask(() => { if (S.captures.has(capture.id)) finish(r, capture, RESULT_CANCELED, null); }, 0, [capture.activity].filter(Boolean)); },
  };
}
