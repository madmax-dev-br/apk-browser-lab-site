// Native libraries that look like app protection, anti-fraud or payment security (hash-named payloads, tamper/root/attestation SDKs). The runtime never stubs them in tolerant
// mode (apk-runtime.js stubNativeLibrary) and the static API-gap report (api-gap-scan.js) lists them as "protegida", from this one rule, so the two agree.
// Matched against the library name without the `lib` prefix and the `.so` suffix.
export const PROTECTED_NATIVE_LIBRARY = /^(?:[0-9a-f]{4,6}|.*(?:guard|protect|shield|tamper|tmxprofiling|threatmetrix|toolchecker|rootbeer|promon|appdome|arxan|jiagu|secneo|bangcle|ijiami|softpos|payment|attest|integrity).*)$/i;
