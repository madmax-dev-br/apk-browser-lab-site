// A capped copy of a response body for the network log (src/netlog.js), taken where the network layer receives the bytes (src/network-native.js,
// src/network-worker-executor.js). The app reads the full body as before; this copy only fills the Rede panel's "Criar mock". No process.*.
/** The first BODY_CAPTURE_BYTES of a response, kept for the network log (the Rede panel's "Criar mock" fills the mock with them); the app reads the full body as before. */
export const BODY_CAPTURE_BYTES = 48 * 1024;
export function captureBody(op, bytes) {
  const have = op.capture?.length ?? 0; if (have >= BODY_CAPTURE_BYTES) { op.captureTruncated = true; return; }
  const take = bytes.subarray ? bytes.subarray(0, BODY_CAPTURE_BYTES - have) : bytes.slice(0, BODY_CAPTURE_BYTES - have);
  const next = new Uint8Array(have + take.length); if (op.capture) next.set(op.capture); next.set(take, have); op.capture = next;
  if (take.length < bytes.length) op.captureTruncated = true;
}
