import { useCallback, useEffect, useMemo, useRef } from "react";
import { Platform } from "react-native";
import type { GestureResponderEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { runOnJS, useSharedValue } from "react-native-reanimated";
import { Gesture } from "react-native-gesture-handler";
import { beginRefreshPull, finishRefreshPull, moveRefreshPull, type RefreshPull } from "../lib/pull-refresh";
import { haptics } from "../lib/haptics";
import { PTR_THRESHOLD } from "../lib/pull-refresh";

/** Material indicator with a simultaneous native observer, not a scroll responder. */
export function useMaterialRefresh(refreshing: boolean, onRefresh?: (() => void) | null, enabled = true, commitOnRelease = true) {
  const offset = useSharedValue(0);
  const pull = useRef<RefreshPull | null>(null);
  const committed = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dy = useSharedValue(0);
  const uiPull = useSharedValue<RefreshPull | null>(null);
  const busy = useSharedValue(refreshing);
  const options = useRef({ refreshing, onRefresh, enabled, commitOnRelease });
  options.current = { refreshing, onRefresh, enabled, commitOnRelease };
  useEffect(() => {
    busy.value = refreshing;
    if (!refreshing) committed.current = false;
  }, [refreshing]);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  const cancel = useCallback(() => {
    pull.current = null;
    dy.value = 0;
  }, []);
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);
  const finish = useCallback(() => {
    const { refreshing, onRefresh, enabled, commitOnRelease } = options.current;
    const shouldRefresh = finishRefreshPull(pull.current, refreshing || committed.current);
    cancel();
    if (!shouldRefresh || !enabled || !onRefresh || !commitOnRelease) return;
    committed.current = true;
    haptics.light();
    try { onRefresh(); } finally {
      // A caller that never sets refreshing must not permanently lock the gesture.
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => {
        if (!options.current.refreshing) { committed.current = false; busy.value = false; }
      }, 1000);
    }
  }, [cancel]);
  const begin = useCallback((x: number, y: number, touches: number) => {
    const { enabled, onRefresh, refreshing } = options.current;
    dy.value = 0;
    pull.current = beginRefreshPull(x, y, offset.value,
      enabled && !!onRefresh && !refreshing && !committed.current && touches === 1);
    return pull.current.eligible;
  }, []);
  const move = useCallback((x: number, y: number, touches: number) => {
    if (!pull.current) return;
    if (!options.current.enabled || options.current.refreshing) { cancel(); return; }
    const previous = pull.current.distance;
    pull.current = moveRefreshPull(pull.current, x, y, offset.value, touches);
    if (previous < PTR_THRESHOLD && pull.current.distance >= PTR_THRESHOLD) haptics.selection();
    if (Math.abs(previous - pull.current.distance) >= 3 || pull.current.distance === 0) dy.value = pull.current.distance;
  }, [cancel]);

  const gesture = useMemo(() => {
    if (Platform.OS === "web") return undefined;
    // JS onTouchMove/onTouchEnd are cancelled when native scrolling activates.
    // RNGH observes the entire stream, simultaneously with the real scroller.
    // Activate only on a downward pull, leaving taps/long-press selection alone.
    const commit = () => {
      pull.current = { x: 0, y: 0, eligible: true, distance: PTR_THRESHOLD };
      finish();
    };
    const observer = Gesture.Manual().enabled(enabled && !!onRefresh)
      .cancelsTouchesInView(false)
      .onTouchesDown((event, manager) => {
        const touch = event.allTouches[0];
        dy.value = 0;
        uiPull.value = touch ? beginRefreshPull(touch.absoluteX, touch.absoluteY, offset.value,
          !busy.value && event.numberOfTouches === 1) : null;
        if (!uiPull.value?.eligible) manager.fail();
        else manager.begin();
      })
      .onTouchesMove((event, manager) => {
        const touch = event.allTouches[0];
        if (!touch || !uiPull.value || busy.value) { dy.value = 0; manager.fail(); return; }
        const previous = uiPull.value.distance;
        uiPull.value = moveRefreshPull(uiPull.value, touch.absoluteX, touch.absoluteY, offset.value, event.numberOfTouches);
        dy.value = uiPull.value.distance;
        if (previous < PTR_THRESHOLD && dy.value >= PTR_THRESHOLD) runOnJS(haptics.selection)();
        if (!uiPull.value.eligible) manager.fail();
        else if (dy.value >= 8) manager.activate();
      })
      .onTouchesUp((_event, manager) => {
        if (finishRefreshPull(uiPull.value, busy.value) && commitOnRelease) {
          busy.value = true;
          runOnJS(commit)();
        }
        dy.value = 0;
        manager.end();
      })
      .onTouchesCancelled((_event, manager) => { dy.value = 0; uiPull.value = null; manager.fail(); })
      .onFinalize(() => { dy.value = 0; uiPull.value = null; });
    return Gesture.Simultaneous(Gesture.Native(), observer);
  }, [enabled, onRefresh, commitOnRelease, finish, dy, uiPull, busy, offset]);

  return {
    dy,
    gesture,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => { offset.value = event.nativeEvent.contentOffset.y; },
    onTouchStart: (event: GestureResponderEvent) => {
      const { touches } = event.nativeEvent;
      const { pageX, pageY } = touches[0] ?? event.nativeEvent;
      begin(pageX, pageY, touches.length);
    },
    onTouchMove: (event: GestureResponderEvent) => {
      const { touches } = event.nativeEvent;
      const { pageX, pageY } = touches[0] ?? event.nativeEvent;
      move(pageX, pageY, touches.length);
    },
    onTouchEnd: (_event: GestureResponderEvent) => { finish(); },
    onTouchCancel: (_event: GestureResponderEvent) => { cancel(); },
    onScrollEndDrag: (_event: NativeSyntheticEvent<NativeScrollEvent>) => { finish(); },
  };
}
