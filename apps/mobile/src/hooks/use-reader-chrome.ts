import { useCallback, useEffect, useMemo } from "react";
import { Platform } from "react-native";
import { useAnimatedScrollHandler, useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { stepFabScrollState, type FabScrollState } from "../lib/fab-scroll";
import { materialMotion, useMaterialMotion } from "../theme/material-motion";

/** Reader chrome must respond even while JS prepares the next article section. */
export function useReaderChrome(keepExpanded: boolean, height: SharedValue<number>) {
  const motion = useMaterialMotion();
  const spatial = useSharedValue(1);
  const effects = useSharedValue(1);
  const hidden = useSharedValue(0);
  const lastOffset = useSharedValue(0);
  const state = useSharedValue<FabScrollState>({ previous: 0, origin: 0, direction: 0, collapsed: false });
  const dragging = useSharedValue(false);
  const userMomentum = useSharedValue(false);
  const pinned = useSharedValue(keepExpanded);
  useEffect(() => { pinned.value = keepExpanded; }, [keepExpanded, pinned]);
  const reducedMotion = motion.reducedMotion;
  const spring = motion.spatial;
  const effectsSpring = materialMotion.effects.fast;
  const web = Platform.OS === "web";
  // Keep the worklet identity stable across ordinary renders. Reanimated
  // compares captured worklet closures by identity; a new `settle` here would
  // make useAnimatedScrollHandler unregister and re-register every scroll
  // event on each reader render. Depend only on values that change the worklet.
  const settle = useCallback(() => {
    "worklet";
    const target = hidden.value > height.value / 2 ? height.value : 0;
    hidden.value = reducedMotion ? target : withSpring(target, { ...spring, overshootClamping: true });
  }, [height, hidden, reducedMotion, spring]);
  const scrollHandler = useAnimatedScrollHandler({
    onBeginDrag: (event) => {
      dragging.value = true;
      userMomentum.value = true;
      const offset = Math.max(0, event.contentOffset.y);
      lastOffset.value = offset;
      state.value = { ...state.value, previous: offset, origin: offset, direction: 0 };
    },
    onEndDrag: () => { dragging.value = false; settle(); },
    onMomentumBegin: () => { dragging.value = userMomentum.value; },
    onMomentumEnd: () => {
      dragging.value = false;
      if (userMomentum.value) settle();
      userMomentum.value = false;
    },
    onScroll: (event) => {
      if (pinned.value || (!web && !dragging.value)) return;
      const previous = state.value;
      const next = stepFabScrollState(previous, event.contentOffset.y, 48);
      state.value = next;
      // The app bar tracks the finger directly, rather than waiting 48dp then
      // chasing a spring. Clamp overscroll so a bottom bounce cannot reveal it.
      const maxOffset = Math.max(0, event.contentSize.height - event.layoutMeasurement.height);
      const offset = Math.min(maxOffset, Math.max(0, event.contentOffset.y));
      const previousOffset = Math.min(maxOffset, Math.max(0, lastOffset.value));
      lastOffset.value = offset;
      hidden.value = offset <= 8 ? 0 : Math.min(height.value, Math.max(0, hidden.value + offset - previousOffset));
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
    userMomentum.value = false;
    lastOffset.value = offset;
    state.value = { previous: offset, origin: offset, direction: 0, collapsed: false };
    spatial.value = reducedMotion ? 1 : withSpring(1, spring);
    effects.value = reducedMotion ? 1 : withSpring(1, effectsSpring);
    hidden.value = reducedMotion ? 0 : withSpring(0, { ...spring, overshootClamping: true });
  }, [dragging, effects, effectsSpring, hidden, lastOffset, reducedMotion, spatial, spring, state, userMomentum]);
  useEffect(() => { if (keepExpanded) expand(); }, [expand, keepExpanded]);
  return useMemo(() => ({ expansion: { spatial, effects }, hidden, expand, scrollHandler }), [spatial, effects, hidden, expand, scrollHandler]);
}
