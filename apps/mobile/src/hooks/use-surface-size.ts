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
  const settledRef = useRef(onSettled);
  useLayoutEffect(() => { settledRef.current = onSettled; }, [onSettled]);
  useLayoutEffect(() => {
    const before = previous.current;
    // A missing measurement invalidates the baseline, including when it
    // arrives a commit after activation. Never spring from a former opening.
    previous.current = { active, geometryKey, measured: active && height != null };
    if (!active) {
      // Retain the exact committed exit geometry instead of letting an old
      // size spring run behind a dismiss/reopen or an obscuring sibling.
      cancelAnimation(extent);
      cancelAnimation(breadth);
      return;
    }
    const animate = before.active && before.measured && before.geometryKey === geometryKey && !motion.reducedMotion;
    // Use the shared spatial scheme for continuous, interruptible geometry.
    // Clamp the edge so a shrinking viewport never bounces into its actions.
    const spring = { ...motion.spatial, overshootClamping: true };
    if (width != null) breadth.value = animate ? withSpring(width, spring) : width;
    if (height == null) { cancelAnimation(extent); return; }
    const notify = () => settledRef.current?.();
    extent.value = animate ? withSpring(height, spring, settledRef.current ? finished => {
      if (finished) runOnJS(notify)();
    } : undefined) : height;
    if (!animate) notify();
  }, [active, geometryKey, height, width, motion, extent, breadth]);
  useLayoutEffect(() => () => { cancelAnimation(extent); cancelAnimation(breadth); }, [extent, breadth]);
  return useAnimatedStyle(() => ({
    ...(height != null ? { height: Math.max(0, extent.value) } : {}),
    ...(width != null ? { width: Math.max(0, breadth.value) } : {}),
  }));
}
