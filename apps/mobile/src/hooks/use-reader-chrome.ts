import { useCallback, useEffect, useMemo } from "react";
import { Platform } from "react-native";
import { useAnimatedScrollHandler, useSharedValue, withSpring } from "react-native-reanimated";
import { stepFabScrollState, type FabScrollState } from "../lib/fab-scroll";
import { materialMotion, useMaterialMotion } from "../theme/material-motion";

/** Reader chrome must respond even while JS prepares the next article section. */
export function useReaderChrome(keepExpanded: boolean) {
  const motion = useMaterialMotion();
  const spatial = useSharedValue(1);
  const effects = useSharedValue(1);
  const state = useSharedValue<FabScrollState>({ previous: 0, origin: 0, direction: 0, collapsed: false });
  const dragging = useSharedValue(false);
  const pinned = useSharedValue(keepExpanded);
  useEffect(() => { pinned.value = keepExpanded; }, [keepExpanded, pinned]);
  const reducedMotion = motion.reducedMotion;
  const spring = motion.spatial;
  const effectsSpring = materialMotion.effects.fast;
  const web = Platform.OS === "web";
  const scrollHandler = useAnimatedScrollHandler({
    onBeginDrag: (event) => {
      dragging.value = true;
      const offset = Math.max(0, event.contentOffset.y);
      state.value = { ...state.value, previous: offset, origin: offset, direction: 0 };
    },
    onMomentumEnd: () => { dragging.value = false; },
    onScroll: (event) => {
      if (pinned.value || (!web && !dragging.value)) return;
      const previous = state.value;
      const next = stepFabScrollState(previous, event.contentOffset.y, 48);
      state.value = next;
      if (next.collapsed === previous.collapsed) return;
      const target = next.collapsed ? 0 : 1;
      spatial.value = reducedMotion ? target : withSpring(target, spring);
      effects.value = reducedMotion ? target : withSpring(target, effectsSpring);
    },
  });
  const expand = useCallback((at = 0) => {
    const offset = Math.max(0, at);
    // Programmatic jumps must not look like a user fling to the UI worklet.
    dragging.value = false;
    state.value = { previous: offset, origin: offset, direction: 0, collapsed: false };
    spatial.value = reducedMotion ? 1 : withSpring(1, spring);
    effects.value = reducedMotion ? 1 : withSpring(1, effectsSpring);
  }, [dragging, effects, effectsSpring, reducedMotion, spatial, spring, state]);
  useEffect(() => { if (keepExpanded) expand(); }, [expand, keepExpanded]);
  return useMemo(() => ({ expansion: { spatial, effects }, expand, scrollHandler }), [spatial, effects, expand, scrollHandler]);
}
