import { useLayoutEffect, useRef } from "react";
import { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useMaterialMotion } from "../theme/material-motion";

/** Animate measured geometry, never a scaled snapshot of text or inputs.
 * The measuring child must not shrink to this animated viewport. New openings
 * and viewport/keyboard changes lay out directly; live content changes spring
 * from the current size, including when a transition is reversed. */
export function useSurfaceSize(height: number | null, {
  active = true,
  geometryKey = "",
  initialHeight,
  width,
  onSettled,
}: { active?: boolean; geometryKey?: string; initialHeight?: number; width?: number; onSettled?: () => void } = {}) {
  const motion = useMaterialMotion();
  const extent = useSharedValue(initialHeight ?? height ?? 0);
  const breadth = useSharedValue(width ?? 0);
  const previous = useRef({ active, geometryKey, measured: height != null || initialHeight != null });
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { active, geometryKey, measured: height != null || before.measured };
    if (!active || height == null) return;
    const animate = before.active && before.measured && before.geometryKey === geometryKey && !motion.reducedMotion;
    const spring = { ...motion.spatial, overshootClamping: true };
    extent.value = animate ? withSpring(height, spring, finished => {
      if (finished && onSettled) runOnJS(onSettled)();
    }) : height;
    if (!animate) onSettled?.();
    if (width != null) breadth.value = animate ? withSpring(width, spring) : width;
  }, [active, geometryKey, height, width, motion, extent, breadth, onSettled]);
  useLayoutEffect(() => () => { cancelAnimation(extent); cancelAnimation(breadth); }, [extent, breadth]);
  return useAnimatedStyle(() => ({
    ...(height != null ? { height: Math.max(0, extent.value) } : {}),
    ...(width != null ? { width: Math.max(0, breadth.value) } : {}),
  }));
}
