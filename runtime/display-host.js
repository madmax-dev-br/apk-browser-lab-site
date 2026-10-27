import { createHostRegistry, floatBits } from './host-contract.js?v=36ea061c5c9d';
import { GC_ROOTS } from './heap-gc.js?v=36ea061c5c9d';

// android.view.Display of the virtual device (android-13.0.0_r1 Display.java): the one built-in display, sized and oriented by the device profile (160 dpi, so dp == px) and
// reporting the same metrics Resources and WindowManager report. The viewport has no system bars or cutout of its own (src/window-insets-host.js), so the real size and the
// app-visible size are the same. Display.Mode and Display.HdrCapabilities are host objects; the display is SDR, sRGB, 60 Hz and always on.
const DISPLAY = 'Landroid/view/Display;', MODE = 'Landroid/view/Display$Mode;', HDR = 'Landroid/view/Display$HdrCapabilities;', METRICS = 'Landroid/util/DisplayMetrics;', POINT = 'Landroid/graphics/Point;', RECT = 'Landroid/graphics/Rect;', OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;';
const REFRESH_RATE = 60, STATE_ON = 2, INVALID_LUMINANCE = -1;

export function createDisplayHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(DISPLAY, OBJECT, [], { allocatable: false }); type(MODE, OBJECT, [], { allocatable: false }); type(HDR, OBJECT, [], { allocatable: false });
  let display = null, mode = null, hdr = null;
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const size = () => ({ width: platform.device.widthDp, height: platform.device.heightDp });
  const rotation = () => platform.device.orientation === 'landscape' ? 1 : 0;   // Surface.ROTATION_0 / ROTATION_90
  const npe = r => r.throwJava('Ljava/lang/NullPointerException;', null);
  const nullish = value => value === null || value === undefined || value === 0;
  const setPoint = (r, point, x, y) => { if (nullish(point)) npe(r); call(r, point, POINT, 'set', ['I', 'I'], 'V', [x, y]); };
  const fillMetrics = (r, out) => { if (nullish(out)) npe(r); call(r, out, METRICS, 'setTo', [METRICS], 'V', [platform.metrics(r)]); };

  def(DISPLAY, 'getDisplayId', '()I', () => 0);
  def(DISPLAY, 'getName', `()${STRING}`, () => 'APK Web virtual display 0');
  def(DISPLAY, 'isValid', '()Z', () => 1);
  def(DISPLAY, 'getRotation', '()I', () => rotation());
  def(DISPLAY, 'getOrientation', '()I', () => rotation());
  def(DISPLAY, 'getRefreshRate', '()F', () => floatBits(REFRESH_RATE));
  def(DISPLAY, 'getSupportedRefreshRates', '()[F', r => { const a = r.newArray('[F', 1); r.array(a).elements = [floatBits(REFRESH_RATE)]; return a; });
  def(DISPLAY, 'getState', '()I', () => STATE_ON);
  def(DISPLAY, 'getFlags', '()I', () => 0);
  def(DISPLAY, 'isRound', '()Z', () => 0);
  def(DISPLAY, 'isHdr', '()Z', () => 0);
  def(DISPLAY, 'isWideColorGamut', '()Z', () => 0);
  def(DISPLAY, 'getPreferredWideGamutColorSpace', '()Landroid/graphics/ColorSpace;', () => null);
  def(DISPLAY, 'isMinimalPostProcessingSupported', '()Z', () => 0);
  def(DISPLAY, 'getDeviceProductInfo', '()Landroid/hardware/display/DeviceProductInfo;', () => null);
  def(DISPLAY, 'getCutout', '()Landroid/view/DisplayCutout;', () => null);   // no notch or punch-hole
  def(DISPLAY, 'getPresentationDeadlineNanos', '()J', () => 1000000000n / BigInt(REFRESH_RATE) / 2n);
  def(DISPLAY, 'getAppVsyncOffsetNanos', '()J', () => 1000000n);
  def(DISPLAY, 'getWidth', '()I', () => size().width);
  def(DISPLAY, 'getHeight', '()I', () => size().height);
  def(DISPLAY, 'getMetrics', `(${METRICS})V`, (r, _m, [, out]) => fillMetrics(r, out));
  def(DISPLAY, 'getRealMetrics', `(${METRICS})V`, (r, _m, [, out]) => fillMetrics(r, out));
  def(DISPLAY, 'getSize', `(${POINT})V`, (r, _m, [, out]) => { const { width, height } = size(); setPoint(r, out, width, height); });
  def(DISPLAY, 'getRealSize', `(${POINT})V`, (r, _m, [, out]) => { const { width, height } = size(); setPoint(r, out, width, height); });
  def(DISPLAY, 'getRectSize', `(${RECT})V`, (r, _m, [, out]) => { if (nullish(out)) npe(r); const { width, height } = size(); call(r, out, RECT, 'set', ['I', 'I', 'I', 'I'], 'V', [0, 0, width, height]); });
  def(DISPLAY, 'getCurrentSizeRange', `(${POINT}${POINT})V`, (r, _m, [, smallest, largest]) => {   // the shorter and longer edge, as the ranges of the two orientations
    const { width, height } = size(), low = Math.min(width, height), high = Math.max(width, height); setPoint(r, smallest, low, low); setPoint(r, largest, high, high);
  });
  def(DISPLAY, 'toString', `()${STRING}`, () => { const { width, height } = size(); return `Display id 0: DisplayInfo{"APK Web virtual display 0", displayId 0, ${width} x ${height}, ${REFRESH_RATE} fps}, DisplayAdjustments{}`; });

  // ---- Display.Mode: the one mode of the display
  const theMode = r => { if (!mode) { mode = r.makeObject(MODE); } return mode; };
  def(DISPLAY, 'getMode', `()${MODE}`, r => theMode(r));
  def(DISPLAY, 'getSupportedModes', `()[${MODE}`, r => { const a = r.newArray(`[${MODE}`, 1); r.array(a).elements = [theMode(r)]; return a; });
  def(MODE, 'getModeId', '()I', () => 1);
  def(MODE, 'getPhysicalWidth', '()I', () => size().width);
  def(MODE, 'getPhysicalHeight', '()I', () => size().height);
  def(MODE, 'getRefreshRate', '()F', () => floatBits(REFRESH_RATE));
  def(MODE, 'getAlternativeRefreshRates', '()[F', r => r.newArray('[F', 0));
  def(MODE, 'isRefreshRateCompatible', '(F)Z', () => 1);
  def(MODE, 'toString', `()${STRING}`, () => { const { width, height } = size(); return `{id=1, width=${width}, height=${height}, fps=${REFRESH_RATE}.0, alternativeRefreshRates=[]}`; });
  def(MODE, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => self?.ref !== undefined && self.ref === other?.ref ? 1 : 0);
  def(MODE, 'hashCode', '()I', () => 1);

  // ---- Display.HdrCapabilities: an SDR panel reports no HDR types and invalid luminances
  const capabilities = r => { if (!hdr) hdr = r.makeObject(HDR); return hdr; };
  def(DISPLAY, 'getHdrCapabilities', `()${HDR}`, r => capabilities(r));
  def(HDR, 'getSupportedHdrTypes', '()[I', r => r.newArray('[I', 0));
  for (const name of ['getDesiredMaxLuminance', 'getDesiredMaxAverageLuminance', 'getDesiredMinLuminance']) def(HDR, name, '()F', () => floatBits(INVALID_LUMINANCE));

  return {
    ...registry,
    /** The one Display object of the runtime (View.getDisplay, WindowManager.getDefaultDisplay, DisplayManager.getDisplay). */
    get(runtime) {
      if (!display) { display = runtime.makeObject(DISPLAY); runtime.record('DISPLAY 0 @60Hz [declared web-device profile; no Android host telemetry]'); }
      return display;
    },
    [GC_ROOTS](visit) { visit(display); visit(mode); visit(hdr); },
  };
}
