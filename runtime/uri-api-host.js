import { createHostRegistry } from './host-contract.js?v=fd59ee7c3d79';
import { gcRoot } from './heap-gc.js?v=fd59ee7c3d79';
import { APKError } from './apk-error.js?v=fd59ee7c3d79';
import { encodeUri } from './content-resolver-host.js?v=fd59ee7c3d79';

// android.net.Uri members the StringUri model of content-resolver-host.js did not carry (android-13.0.0_r1 Uri.java): EMPTY, fromFile, fromParts, withAppendedPath, normalizeScheme,
// compareTo. Uris are built by composing the string the AOSP HierarchicalUri / OpaqueUri would print and parsing it, so every accessor answers like the original.
const URI = 'Landroid/net/Uri;', BUILDER = 'Landroid/net/Uri$Builder;', STRING = 'Ljava/lang/String;', FILE = 'Ljava/io/File;', OBJECT = 'Ljava/lang/Object;';
const nullish = v => v === null || v === undefined || v === 0;

export function createUriApiHost() {
  const registry = createHostRegistry(), { def } = registry;
  const call = (r, receiver, owner, name, parameters = [], result = 'V', args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const parse = (r, text) => r.dispatch({ owner: URI, name: 'parse', parameters: [STRING], result: URI, signature: `(${STRING})${URI}` }, [text], 'static');
  const empty = new WeakMap();
  registry.staticField(URI, 'EMPTY', URI, r => { if (!empty.has(r)) empty.set(r, gcRoot({ value: parse(r, '') })); return empty.get(r).value; });
  def(URI, 'fromFile', `(${FILE})${URI}`, (r, _m, [file]) => {
    if (nullish(file)) r.throwJava('Ljava/lang/NullPointerException;', 'file');
    return parse(r, 'file://' + encodeUri(r.stringCharacters(call(r, file, FILE, 'getAbsolutePath', [], STRING)), '/'));   // HierarchicalUri(scheme "file", empty authority, encoded path)
  }, { static: true });
  def(URI, 'fromParts', `(${STRING}${STRING}${STRING})${URI}`, (r, _m, [scheme, ssp, fragment]) => {
    if (nullish(scheme)) r.throwJava('Ljava/lang/NullPointerException;', 'scheme'); if (nullish(ssp)) r.throwJava('Ljava/lang/NullPointerException;', 'ssp');
    return parse(r, `${r.stringCharacters(scheme)}:${encodeUri(r.stringCharacters(ssp))}${nullish(fragment) ? '' : '#' + encodeUri(r.stringCharacters(fragment))}`);
  }, { static: true });
  def(URI, 'withAppendedPath', `(${URI}${STRING})${URI}`, (r, _m, [base, segment]) => {
    const builder = call(r, base, URI, 'buildUpon', [], BUILDER); call(r, builder, BUILDER, 'appendEncodedPath', [STRING], BUILDER, [segment]); return call(r, builder, BUILDER, 'build', [], URI);
  }, { static: true });
  def(URI, 'normalizeScheme', `()${URI}`, (r, _m, [self]) => {
    const scheme = call(r, self, URI, 'getScheme', [], STRING); if (nullish(scheme)) return self;
    const text = r.stringCharacters(scheme), lower = text.toLowerCase(); if (text === lower) return self;
    const builder = call(r, self, URI, 'buildUpon', [], BUILDER); call(r, builder, BUILDER, 'scheme', [STRING], BUILDER, [lower]); return call(r, builder, BUILDER, 'build', [], URI);
  });
  const compare = (r, a, b) => { const x = r.stringCharacters(call(r, a, OBJECT, 'toString', [], STRING)), y = r.stringCharacters(call(r, b, OBJECT, 'toString', [], STRING)); return x < y ? -1 : x > y ? 1 : 0; };
  def(URI, 'compareTo', `(${URI})I`, (r, _m, [self, other]) => { if (nullish(other)) r.throwJava('Ljava/lang/NullPointerException;', null); return compare(r, self, other); });
  def(URI, 'compareTo', `(${OBJECT})I`, (r, _m, [self, other]) => { if (nullish(other)) r.throwJava('Ljava/lang/NullPointerException;', null); return compare(r, self, other); });
  def(URI, 'describeContents', '()I', () => 0);
  def(URI, 'writeToParcel', '(Landroid/os/Parcel;I)V', () => { throw new APKError('Uri.writeToParcel needs the Parcel wire format, which the virtual device only keeps in memory', { kind: 'uri-parcel-unsupported' }); });
  def(URI, 'writeToParcel', `(Landroid/os/Parcel;${URI})V`, () => { throw new APKError('Uri.writeToParcel needs the Parcel wire format, which the virtual device only keeps in memory', { kind: 'uri-parcel-unsupported' }); }, { static: true });
  return registry;
}
