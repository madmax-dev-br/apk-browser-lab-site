// Progressive raster: while the screen is moving, the Worker replays the recorded frames at a reduced scale (the page stretches the smaller bitmap over the
// same box); once the screen is still, the last frame is replayed again at full density, so a settled screen is always pixel-exact. Nothing about the VM
// changes (same Java code, same frames, same layout): only the scale of the host's CanvasKit replay (src/skia-canvas-host.js `options.scale`, read when a
// View's content raster is read, src/compose-canvas-host.js setContentRaster). This module is the policy, shared by the Worker (src/apk-worker.js) and its tests.
//
// Motion signal, taken from what the VM already knows when a snapshot is made:
//  - a Choreographer frame is pending AND the content is changing at an animation's cadence (the last two snapshots with new rasters less than MOTION_CADENCE_MS apart, the last one recent): an
//    animation, transition, ripple, fling or scroll posts the next frame callback while the current frame runs, so the frame being shown is about to be replaced
//    (the last frame of an animation has no pending frame: it is replayed at full density right away). A pending frame alone is not motion: a focused text field's
//    cursor is an infinite animation that keeps a frame pending forever but changes the screen once per blink (every 500 ms); each blink is drawn at full density;
//  - a pointer gesture is in progress (DOWN without UP/CANCEL, with a sample in the last GESTURE_STALE_MS): the finger moves the content;
//  - the snapshot answers a pointer DOWN/MOVE or a wheel scroll step: input in flight.
// Settle rule: a snapshot that carried a reduced raster owes a full-density one. It is due once REFINE_QUIET_MS passed since the reduced content last changed and
// either no Choreographer frame is pending or STILL_SNAPSHOTS snapshots in a row showed the same reduced rasters (frames keep running but draw nothing new, e.g. a
// focused text field's cursor animation between its steps). The Worker's pump wakes for it and posts the refined snapshot even when no VM event ran.
export const MOTION_RASTER_SCALE = 0.5;   // replay at half the linear resolution (a quarter of the pixels); chosen by measurement, see docs/INTERACTION-PERFORMANCE.md
export const REFINE_QUIET_MS = 100;       // quiet period after the last change of the reduced content before the full-density replay (about 6 frames)
export const STILL_SNAPSHOTS = 2;         // snapshots in a row with the same reduced rasters while frames are pending: the screen is still
export const SETTLED_SCALE_STEPS = Object.freeze([1, 0.9, 0.8]);   // "Resolução com a tela parada" (Controles): the density of the frame the screen settles on (1 = full)
export const MOTION_SCALE_STEPS = Object.freeze([1, 0.75, 0.5, 0.35, 0.25]);   // "Resolução no movimento" (Controles): 1 = always full density
export const NAVIGATION_REDUCED_MS = 400;   // "Tela nova em baixa resolução": a new Activity or window is drawn reduced this long after it appears, then refined once still
export const MOTION_CADENCE_MS = 250;     // content that changed less than this before the previous change is moving (an animation draws every 16-60 ms; a cursor blinks every 500 ms)
export const GESTURE_STALE_MS = 1500;     // a gesture whose last sample is older than this no longer counts as motion (a lost UP must not keep the screen reduced)

export class MotionRasterPolicy {
  constructor({ enabled = true, scale = MOTION_RASTER_SCALE, quietMs = REFINE_QUIET_MS, navigation = true, now = () => performance.now() } = {}) {
    if (!(Number.isFinite(scale) && scale > 0 && scale <= 1)) throw new RangeError('Motion raster scale must be in (0, 1]');
    this.allowed = enabled; this.enabled = enabled && scale < 1; this.scale = scale; this.quietMs = quietMs; this.now = now;
    this.navigation = !!navigation; this.screenKey = null; this.navigatedAt = -Infinity;
    this.settled = 1;       // the scale of the settled frame: what a moving frame is refined to, and what a still screen is drawn at
    this.owed = false;      // the last snapshot carried a reduced raster: a full-density one is due once the screen is still
    this.served = '';       // identity of the reduced rasters the last snapshot carried (their raster ids: a cache hit keeps the id, so the same content has the same identity)
    this.changedAt = 0; this.unchanged = 0;
    this.contentAt = -Infinity; this.previousContentAt = -Infinity;   // host times of the last two snapshots that carried new content (a raster replayed, not a cache hit): two changes within MOTION_CADENCE_MS are an animation
    this.stats = { reducedSnapshots: 0, fullSnapshots: 0, refinements: 0 };   // snapshots with a reduced raster / without / full snapshots posted by the settle rule
  }
  /** Whether the screen is moving for the snapshot about to be taken. */
  /** "Resolução no movimento" and "Tela nova em baixa resolução" (Controles), applied live: scale 1 turns the reduced replay off; a disabled policy (`load { motionRaster: false }`, ?raster=full) stays off. */
  configure({ scale = this.scale, navigation = this.navigation, settled = this.settled } = {}) {
    if (!MOTION_SCALE_STEPS.includes(scale)) throw new RangeError(`Motion raster scale must be one of ${MOTION_SCALE_STEPS.join(', ')}`);
    if (!SETTLED_SCALE_STEPS.includes(settled)) throw new RangeError(`Settled raster scale must be one of ${SETTLED_SCALE_STEPS.join(', ')}`);
    this.scale = scale; this.settled = settled; this.enabled = this.allowed && scale < this.settledScale(); this.navigation = !!navigation; if (!this.enabled) this.reset();
    return { scale: this.scale, enabled: this.enabled, navigation: this.navigation, settled: this.settled };
  }
  /** The screen identity of the snapshot about to be taken (the Activity instance and its windows): a change starts the "tela nova" window. */
  noteScreen(key) { if (key !== this.screenKey) { this.screenKey = key; this.navigatedAt = this.now(); } }
  /** A new screen appeared less than NAVIGATION_REDUCED_MS ago and the option is on. */
  navigating() { return this.navigation && this.now() - this.navigatedAt < NAVIGATION_REDUCED_MS; }
  moving({ pendingFrames = 0, gestureActive = false, inputMotion = false, navigation = false } = {}) {
    if (navigation) return true; return gestureActive || inputMotion || (pendingFrames > 0 && this.contentAt - this.previousContentAt < MOTION_CADENCE_MS && this.now() - this.contentAt < MOTION_CADENCE_MS); }
  /** Records whether the snapshot just taken drew new content (a raster was replayed rather than served from the cache); two such snapshots within MOTION_CADENCE_MS make a pending frame motion (the first two frames of an animation are drawn at full density). */
  noteContent(changed) { if (changed) { this.previousContentAt = this.contentAt; this.contentAt = this.now(); } }
  /** The display raster scale for the snapshot about to be taken (1 = full density): reduced while moving, full once the settle rule says the reduced frame is due for refinement. */
  scaleFor(signal) { return this.enabled && this.moving(signal) && !this.refinementDue(signal) ? this.scale : this.settledScale(); }
  /** The scale a still screen is drawn at ("Resolução com a tela parada"); a disabled policy (?raster=full) always draws at full density. */
  settledScale() { return this.allowed ? this.settled : 1; }
  /** Records what the snapshot just taken carried: the ids of its reduced rasters (empty: everything at full density). */
  noteSnapshot(reducedIds = []) {
    if (!reducedIds.length) { this.owed = false; this.served = ''; this.stats.fullSnapshots++; return; }
    const served = [...new Set(reducedIds)].sort().join(','); this.stats.reducedSnapshots++;   // a raster read twice by one snapshot counts once
    if (!this.owed || served !== this.served) { this.changedAt = this.now(); this.unchanged = 0; } else this.unchanged++;
    this.owed = true; this.served = served;
  }
  /** A full-density refinement is due: one is owed, the quiet period passed, and the screen is still (no frame pending, or frames that draw nothing new). */
  refinementDue({ pendingFrames = 0, inputMotion = false } = {}) {
    return this.owed && !inputMotion && this.now() - this.changedAt >= this.quietMs && (pendingFrames === 0 || this.unchanged >= STILL_SNAPSHOTS - 1);
  }
  noteRefinement() { this.stats.refinements++; }
  /** ms until the pump should wake to check for the refinement, or null when none is owed. Never 0 unless it is due (no busy wake while frames keep coming). */
  refineDelay(signal) {
    if (!this.owed) return null;
    const left = this.changedAt + this.quietMs - this.now();
    return left > 0 ? left : this.refinementDue(signal) ? 0 : this.quietMs;
  }
  reset() { this.owed = false; this.served = ''; this.unchanged = 0; this.contentAt = -Infinity; this.previousContentAt = -Infinity; }
}
