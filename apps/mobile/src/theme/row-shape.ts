/**
 * Expressive rows morph their corners on press/selection; hover uses ink.
 * A single spring drives every corner; each corner clamps at its group-silhouette
 * radius, so segment edges stay aligned while the inner corners round. Standard
 * mode retains its baseline geometry (state layers only).
 */
import { useEffect, useMemo, useRef } from "react";
import { Animated } from "react-native";
import { useMaterialMotion } from "./material-motion";

export type CornerRadii = { borderTopLeftRadius: number; borderTopRightRadius: number; borderBottomLeftRadius: number; borderBottomRightRadius: number };

export function useRowLift({ expressive, hovered, pressed, selected = false, hoverRadius = 0, pressRadius = 16, reducedMotion, immediate = false }: {
  expressive: boolean; hovered: boolean; pressed?: boolean; selected?: boolean; hoverRadius?: number; pressRadius?: number; reducedMotion: boolean; immediate?: boolean;
}) {
  const motion = useMaterialMotion();
  const target = !expressive ? 0 : pressed || selected ? pressRadius : hovered ? hoverRadius : 0;
  // Recycled/already-selected rows must paint the right shape on their first frame.
  const lift = useRef(new Animated.Value(target)).current;
  const previous = useRef({ target, reducedMotion, immediate, spring: motion.fast });
  useEffect(() => {
    if (previous.current.target === target && previous.current.reducedMotion === reducedMotion && previous.current.immediate === immediate && previous.current.spring === motion.fast) return;
    previous.current = { target, reducedMotion, immediate, spring: motion.fast };
    if (reducedMotion || immediate) { lift.stopAnimation(); lift.setValue(target); return; }
    // borderRadius is not native-drivable; one hovered/pressed row at a time keeps this off the hot path.
    const animation = Animated.spring(lift, { toValue: target, ...motion.fast, useNativeDriver: false, isInteraction: false });
    animation.start();
    return () => animation.stop();
  }, [lift, reducedMotion, target, immediate, motion.fast]);
  return lift;
}

/** Corner styles that hold the group silhouette at rest and follow the lift upward. */
export function rowCornerStyle(lift: Animated.Value, rest: CornerRadii) {
  const corner = (restRadius: number) => lift.interpolate({
    inputRange: [0, restRadius, 48], outputRange: [restRadius, restRadius, 48], extrapolate: "clamp",
  });
  return {
    borderTopLeftRadius: corner(rest.borderTopLeftRadius), borderTopRightRadius: corner(rest.borderTopRightRadius),
    borderBottomLeftRadius: corner(rest.borderBottomLeftRadius), borderBottomRightRadius: corner(rest.borderBottomRightRadius),
  };
}

/** Keep AnimatedProps attached to the same graph during row data/size updates.
 * Callers create fresh rest objects, so memoize by radii, not object identity. */
export function useRowCornerStyle(lift: Animated.Value, rest?: CornerRadii) {
  const topLeft = rest?.borderTopLeftRadius;
  const topRight = rest?.borderTopRightRadius;
  const bottomLeft = rest?.borderBottomLeftRadius;
  const bottomRight = rest?.borderBottomRightRadius;
  return useMemo(() => topLeft == null || topRight == null || bottomLeft == null || bottomRight == null ? null : rowCornerStyle(lift, {
    borderTopLeftRadius: topLeft, borderTopRightRadius: topRight,
    borderBottomLeftRadius: bottomLeft, borderBottomRightRadius: bottomRight,
  }), [lift, topLeft, topRight, bottomLeft, bottomRight]);
}
