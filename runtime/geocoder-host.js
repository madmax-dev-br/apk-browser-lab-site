import { bitsDouble, createHostRegistry, doubleBits } from './host-contract.js?v=8dfe82539cb6';

// android.location.Geocoder (frameworks/base/location/java/android/location/Geocoder.java, android-13.0.0_r1) on a device with no geocoder backend: isPresent() is false, and every request is answered
// with the error LocationManagerService gives when it has no GeocoderProxy, "Service not Available": the deprecated synchronous methods throw IOException with it, the API 33 GeocodeListener
// variants deliver it to onError asynchronously. The argument checks (Preconditions.checkArgumentInRange / checkArgument) run first, with the platform's own messages.
const GEOCODER = 'Landroid/location/Geocoder;', LISTENER = 'Landroid/location/Geocoder$GeocodeListener;', CONTEXT = 'Landroid/content/Context;', LOCALE = 'Ljava/util/Locale;', STRING = 'Ljava/lang/String;', LIST = 'Ljava/util/List;';
const PRECONDITIONS = 'Lcom/android/internal/util/Preconditions;', SERVICE_NOT_AVAILABLE = 'Service not Available';

export function createGeocoderHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const nullish = value => value === null || value === undefined || value === 0;
  type(GEOCODER, 'Ljava/lang/Object;', [], { allocatable: true }); type(LISTENER, 'Ljava/lang/Object;');
  def(LISTENER, 'onError', `(${STRING})V`, () => {});   // the interface's default method
  const inRange = (r, value, lower, upper, name) => {
    const parameters = ['D', 'D', 'D', STRING];
    return r.dispatch({ owner: PRECONDITIONS, name: 'checkArgumentInRange', parameters, result: 'D', signature: `(DDDLjava/lang/String;)D` }, r.argumentWords(parameters, [doubleBits(value), doubleBits(lower), doubleBits(upper), name]), 'static');
  };
  const number = bits => bitsDouble(bits);

  def(GEOCODER, 'isPresent', '()Z', () => 0, { static: true });
  const construct = (r, [self, context, locale]) => {
    if (nullish(context)) r.throwJava('Ljava/lang/NullPointerException;', null);
    if (locale !== undefined && nullish(locale)) r.throwJava('Ljava/lang/NullPointerException;', null);
    r.object(self).geocoder = true;
  };
  def(GEOCODER, '<init>', `(${CONTEXT})V`, (r, _m, args) => construct(r, args)); def(GEOCODER, '<init>', `(${CONTEXT}${LOCALE})V`, (r, _m, args) => construct(r, args));

  const deliver = (r, listener) => {
    if (nullish(listener)) r.throwJava('Ljava/lang/NullPointerException;', null);   // GeocoderImpl(listener): Objects.requireNonNull
    platform.queueTask(() => {
      const owner = r.typeOf(listener);
      try { r.dispatch({ owner, name: 'onError', parameters: [STRING], result: 'V', signature: `(${STRING})V` }, [listener, SERVICE_NOT_AVAILABLE], 'virtual'); }
      catch (error) { if (!String(error?.message).startsWith(`Unsupported API/method: ${owner}->onError(`)) throw error; }   // the listener does not override onError: the interface's default method is empty
    }, 0, [listener]);
  };
  const synchronous = (r) => r.throwJava('Ljava/io/IOException;', SERVICE_NOT_AVAILABLE);
  const checkPoint = (r, latitude, longitude) => { inRange(r, number(latitude), -90, 90, 'latitude'); inRange(r, number(longitude), -180, 180, 'longitude'); };
  const checkBox = (r, name, a, b, c, d) => {
    if (nullish(name)) r.throwJava('Ljava/lang/IllegalArgumentException;', null);
    inRange(r, number(a), -90, 90, 'lowerLeftLatitude'); inRange(r, number(b), -180, 180, 'lowerLeftLongitude'); inRange(r, number(c), -90, 90, 'upperRightLatitude'); inRange(r, number(d), -180, 180, 'upperRightLongitude');
  };
  def(GEOCODER, 'getFromLocation', `(DDI)${LIST}`, (r, _m, [, latitude, longitude]) => { checkPoint(r, latitude, longitude); synchronous(r); });
  def(GEOCODER, 'getFromLocation', `(DDI${LISTENER})V`, (r, _m, [, latitude, longitude, , listener]) => { checkPoint(r, latitude, longitude); deliver(r, listener); });
  def(GEOCODER, 'getFromLocationName', `(${STRING}I)${LIST}`, (r, _m, [, name]) => { checkBox(r, name, doubleBits(0), doubleBits(0), doubleBits(0), doubleBits(0)); synchronous(r); });
  def(GEOCODER, 'getFromLocationName', `(${STRING}I${LISTENER})V`, (r, _m, [, name, , listener]) => { checkBox(r, name, doubleBits(0), doubleBits(0), doubleBits(0), doubleBits(0)); deliver(r, listener); });
  def(GEOCODER, 'getFromLocationName', `(${STRING}IDDDD)${LIST}`, (r, _m, [, name, , a, b, c, d]) => { checkBox(r, name, a, b, c, d); synchronous(r); });
  def(GEOCODER, 'getFromLocationName', `(${STRING}IDDDD${LISTENER})V`, (r, _m, [, name, , a, b, c, d, listener]) => { checkBox(r, name, a, b, c, d); deliver(r, listener); });
  return { ...registry };
}
