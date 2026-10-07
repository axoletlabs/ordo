/**
 * Expressive rows lift their corners under the pointer: rest → hover → press.
 * A single spring drives every corner; each corner clamps at its group-silhouette
 * radius, so segment edges stay aligned while the inner corners round. Standard
 * mode never lifts (state layers only).
 */
import { useEffect, useRef } from "react";
import { Animated } from "react-native";
import { materialMotion } from "./material-motion";

export type CornerRadii = { borderTopLeftRadius: number; borderTopRightRadius: number; borderBottomLeftRadius: number; borderBottomRightRadius: number };

export function useRowLift({ expressive, hovered, pressed, hoverRadius = 16, pressRadius = 20, reducedMotion }: {
  expressive: boolean; hovered: boolean; pressed?: boolean; hoverRadius?: number; pressRadius?: number; reducedMotion: boolean;
}) {
  const lift = useRef(new Animated.Value(0)).current;
  const target = !expressive ? 0 : pressed ? pressRadius : hovered ? hoverRadius : 0;
  const previous = useRef({ target, reducedMotion });
  useEffect(() => {
    if (previous.current.target === target && previous.current.reducedMotion === reducedMotion) return;
    previous.current = { target, reducedMotion };
    if (reducedMotion) { lift.stopAnimation(); lift.setValue(target); return; }
    // borderRadius is not native-drivable; one hovered/pressed row at a time keeps this off the hot path.
    const animation = Animated.spring(lift, { toValue: target, ...materialMotion.effects.fast, useNativeDriver: false, isInteraction: false });
    animation.start();
    return () => animation.stop();
  }, [lift, reducedMotion, target]);
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
