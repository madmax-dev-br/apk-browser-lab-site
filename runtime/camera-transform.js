// The transform of a View / RenderNode with a rotation about the X or Y axis: the 3D branch of android-13.0.0_r1 hwui RenderProperties::updateMatrix,
//
//     transform = scale about the pivot; camera.rotateX(rotationX); camera.rotateY(rotationY); camera.rotateZ(-rotation); camera.getMatrix(&transform3D);
//     transform3D.preTranslate(-pivotX, -pivotY); transform3D.postTranslate(pivotX + translationX, pivotY + translationY); transform.postConcat(transform3D);
//
// with the camera of Skia's Sk3DView (SkCamera.cpp): the patch U = (1, 0, 0), V = (0, -1, 0) at the origin is rotated by the camera's 4x4 matrix (rotateY turns about
// (0, -1, 0)) and projected by a camera on the Z axis at `cameraZ` inches (72 points an inch; -8 unless View.setCameraDistance / RenderNode.setCameraDistance moved it), looking
// along +Z with -Y up. For that camera SkCamera3D::patchToMatrix reduces to
//
//     [  U.x          V.x         0 ]
//     [ -U.y         -V.y         0 ]
//     [ -U.z / z     -V.z / z     1 ]        z = cameraZ * 72
//
// The result is a 3x3 matrix in android.graphics.Matrix order (MSCALE_X, MSKEW_X, MTRANS_X, MSKEW_Y, MSCALE_Y, MTRANS_Y, MPERSP_0, MPERSP_1, MPERSP_2), in float precision
// like the original, which the Canvas (Matrix.setValues + Canvas.concat) and the page (a CSS matrix3d, device-view.js cssTransform) both take.
const RADIANS = Math.PI / 180, f = Math.fround;
const multiply = (a, b) => { const out = new Array(9); for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) out[row * 3 + column] = f(a[row * 3] * b[column] + a[row * 3 + 1] * b[3 + column] + a[row * 3 + 2] * b[6 + column]); return out; };
/** SkM44::Rotate(axis, radians) for a unit axis, upper 3x3, row-major. */
const rotate = (x, y, z, radians) => { const c = Math.cos(radians), s = Math.sin(radians), t = 1 - c; return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c].map(f); };
/** Sk3DView.getMatrix after rotateX(rotationX), rotateY(rotationY), rotateZ(rotationZ), for a camera at (0, 0, cameraZ inches). */
export function cameraMatrix(rotationX, rotationY, rotationZ, cameraZ = -8) {
  const m = multiply(multiply(rotate(1, 0, 0, rotationX * RADIANS), rotate(0, -1, 0, rotationY * RADIANS)), rotate(0, 0, 1, rotationZ * RADIANS)), z = cameraZ * 72;
  const u = [m[0], m[3], m[6]], v = [-m[1], -m[4], -m[7]];   // the matrix applied to (1, 0, 0) and to (0, -1, 0)
  return [u[0], v[0], 0, -u[1], -v[1], 0, -u[2] / z, -v[2] / z, 1].map(value => f(value) + 0);   // + 0: no negative zero
}
/** Whether RenderProperties::updateMatrix takes its 3D branch (MathUtils::isZero is |value| < 0.00001f). */
export const hasCameraRotation = (rotationX, rotationY) => Math.abs(rotationX || 0) >= 0.00001 || Math.abs(rotationY || 0) >= 0.00001;
/** RenderProperties::updateMatrix, 3D branch. `cameraDistance` is the distance in inches (its sign is ignored: the camera sits on the negative Z axis). */
export function cameraTransform({ rotation = 0, rotationX = 0, rotationY = 0, scaleX = 1, scaleY = 1, pivotX = 0, pivotY = 0, translationX = 0, translationY = 0, cameraDistance = 8 }) {
  const scale = [scaleX, 0, f(pivotX - scaleX * pivotX), 0, scaleY, f(pivotY - scaleY * pivotY), 0, 0, 1].map(f);   // SkMatrix::preScale(sx, sy, px, py) on the identity
  let transform3D = cameraMatrix(rotationX, rotationY, -rotation, -Math.abs(cameraDistance));
  transform3D = multiply(transform3D, [1, 0, -pivotX, 0, 1, -pivotY, 0, 0, 1].map(f));
  transform3D = multiply([1, 0, f(pivotX + translationX), 0, 1, f(pivotY + translationY), 0, 0, 1], transform3D);
  return multiply(transform3D, scale);
}
