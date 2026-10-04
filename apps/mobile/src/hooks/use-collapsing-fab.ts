import { useCallback, useMemo, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useSharedValue, withSpring } from "react-native-reanimated";
import { createFabScrollState } from "../lib/fab-scroll";
import { materialMotion, useMaterialMotion } from "../theme/material-motion";

export function useCollapsingFab() {
  const motion = useMaterialMotion();
  const state = useRef(createFabScrollState());
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
  return { expansion: useMemo(() => ({ spatial, effects }), [spatial, effects]), onScroll };
}
