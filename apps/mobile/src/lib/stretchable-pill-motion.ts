import { Animated } from "react-native";

/** The straight middle overlaps each end cap by this many px. Adjacent,
 * independently composited parts abut at fractional offsets, so every
 * rasterizer (device pixels, layer snapping) can leave a hairline of the
 * backdrop through the exact joint; the caps paint over the overlap. */
export const PILL_BLEED = 2;

/** Exact algebra, compiled once into native animated nodes. In particular,
 * reciprocal scale is a native division, not a per-frame JS approximation. */
export function stretchablePillMotion(width: Animated.Value, canvasWidth: number, height = 48) {
  const extent = Math.max(height, canvasWidth);
  const paintedWidth = extent > height ? width.interpolate({ inputRange: [height, extent], outputRange: [height, extent], extrapolate: "clamp" }) : new Animated.Value(height);
  const scale = Animated.divide(paintedWidth, extent);
  const shift = Animated.multiply(Animated.subtract(extent, paintedWidth), 0.5);
  return {
    scale, shift,
    inverseScale: Animated.divide(1, scale),
    inverseShift: Animated.multiply(Animated.divide(shift, scale), -1),
    leadingShift: Animated.multiply(shift, 2),
    // Rendered middle width is (painted - height) plus the bleed under both
    // caps; paintedWidth is already clamped to [height, extent], so a fully
    // compressed pill paints exactly the bleed, hidden under the round caps.
    // Translucent overlays stack their alpha where parts overlap, so they keep
    // the exact-abutment variant below instead of the bleed.
    middleScale: extent > height
      ? Animated.divide(
        paintedWidth.interpolate({ inputRange: [height, extent], outputRange: [PILL_BLEED * 2, extent - height + PILL_BLEED * 2], extrapolate: "clamp" }),
        extent - height + PILL_BLEED * 2)
      : new Animated.Value(0),
    overlayMiddleScale: extent > height
      ? Animated.divide(Animated.subtract(paintedWidth, height), extent - height)
      : new Animated.Value(0),
  };
}
