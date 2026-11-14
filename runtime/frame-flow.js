// How the VM Worker paces the frames it sends the page (src/apk-worker.js postRuntimeEvent / holdSnapshot / frameAcked; the page acknowledges a snapshot once it has drawn it,
// src/device-view.js flushRuntimeSnapshot, and draws at most one per animation frame, replacing an older one that has not been drawn yet: "coalesced").
// One frame in flight serialised delivery: the page waits for its next animation frame to draw, the acknowledgement then waits behind the Worker's current task, and every frame
// the VM produced meanwhile was held and replaced by the next one. While a large app's first seconds keep the Worker busy that dropped about one produced frame in six
// (example-mega: 117-333 holds in 6 s, ~40 frames drawn a second against 47-54 produced). Two in flight (double buffering) fixed that, but two snapshots sent within one
// animation frame of each other are drawn as one, and the Worker's encoding of the first is lost (example-heavy: ~110 of ~340 per 5 s). So a second frame also waits until the
// last snapshot of any kind (an event's or a reply's) is MIN_SPACING_MS old: one display frame at 60 Hz, less the page's draw. DOM-free, no process.*.
export const FRAMES_IN_FLIGHT = 2, MIN_SPACING_MS = 12;
/**
 * Whether the next scheduled-event snapshot must wait, and for how long: null to send it now, else the ms after which to look again. It waits while FRAMES_IN_FLIGHT are sent
 * and unacknowledged (until an acknowledgement, or `ackWaitMs` after the last one sent: a page that dropped one or a hidden tab never blocks the screen for longer), and while
 * the last snapshot sent is younger than MIN_SPACING_MS.
 */
export function holdDelay(sentSeq, ackedSeq, sinceLastEventMs, sinceLastSnapshotMs, ackWaitMs) {
  const unacknowledged = sentSeq - ackedSeq;
  if (unacknowledged >= FRAMES_IN_FLIGHT && sinceLastEventMs < ackWaitMs) return ackWaitMs - sinceLastEventMs;
  if (sinceLastSnapshotMs < MIN_SPACING_MS) return MIN_SPACING_MS - sinceLastSnapshotMs;
  return null;
}
