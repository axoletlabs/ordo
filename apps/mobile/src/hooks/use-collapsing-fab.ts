import { useCallback, useMemo, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useSharedValue, withSpring } from "react-native-reanimated";
import { createFabScrollState } from "../lib/fab-scroll";
import { materialMotion, useMaterialMotion } from "../theme/material-motion";

/**
 * Scroll-aware expansion shared by FAB labels and reader chrome.
 * `threshold` is the scroll distance that flips collapse; call `expand(offset)`
 * after programmatic scrolling so stale deltas cannot flip the state back.
 */
export function useCollapsingFab(threshold = 24) {
  const motion = useMaterialMotion();
  const state = useRef(createFabScrollState(threshold));
  const collapsed = useRef(false);
  const spatial = useSharedValue(1);
  const effects = useSharedValue(1);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = state.current(event.nativeEvent.contentOffset.y);
    if (next === collapsed.current) return;
    collapsed.current = next;
    const target = next ? 0 : 1;
    spatial.value = motion.reducedMotion ? target : withSpring(target, motion.spatial);
    effects.value = motion.reducedMotion ? target : withSpring(target, materialMotion.effects.fast);
  }, [spatial, effects, motion.spatial, motion.reducedMotion]);
  const expand = useCallback((offset?: number) => {
    if (offset != null) state.current.reset(offset);
    if (!collapsed.current && spatial.value === 1 && effects.value === 1) return;
    collapsed.current = false;
    const target = 1;
    spatial.value = motion.reducedMotion ? target : withSpring(target, motion.spatial);
    effects.value = motion.reducedMotion ? target : withSpring(target, materialMotion.effects.fast);
  }, [effects, motion.reducedMotion, motion.spatial, spatial]);
  return useMemo(
    () => ({ expansion: { spatial, effects }, onScroll, expand }),
    [effects, expand, onScroll, spatial],
  );
}
