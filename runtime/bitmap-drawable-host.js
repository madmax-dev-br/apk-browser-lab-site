import { createHostRegistry } from './host-contract.js?v=7dfccde7cc14';

// android.graphics.drawable.BitmapDrawable is the original android-13.0.0_r1 source in the framework DEX (inflate of <bitmap> with src/tileMode/gravity/tint/antialias/dither/filter/mipMap,
// density scaling, BitmapShader tiling, ConstantState, outline). It runs over the host Bitmap (bitmap-host.js / bitmap-codec-host.js), Paint, BitmapShader and Canvas; this host no longer
// stands in for the class, so it registers nothing. Kept as an empty registry so the platform's host list stays stable.
export function createBitmapDrawableHost() {
  const registry = createHostRegistry();
  return { ...registry, interfaces: registry.interfacesOf };
}
