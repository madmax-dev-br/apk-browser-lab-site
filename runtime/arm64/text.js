// UTF-8 decoding of bytes read from the ARM64 process memory (src/arm64/memory.js). That memory is a resizable ArrayBuffer (it grows in place), and browsers'
// TextDecoder.decode rejects a view of a resizable or shared buffer ("The provided ArrayBuffer value must not be resizable"; Node accepts it). Such a view is copied first.
const decoder = new TextDecoder();
const needsCopy = bytes => bytes?.buffer?.resizable === true || (typeof SharedArrayBuffer !== 'undefined' && bytes?.buffer instanceof SharedArrayBuffer);

/** A TextDecoder-like object (only decode) safe for views of the process memory. */
export const utf8 = Object.freeze({ decode: (bytes = new Uint8Array(0)) => decoder.decode(needsCopy(bytes) ? bytes.slice() : bytes) });
