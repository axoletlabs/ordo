import { Animated } from "react-native";

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
    middleScale: extent > height ? Animated.divide(Animated.subtract(paintedWidth, height), extent - height) : new Animated.Value(0),
  };
}
