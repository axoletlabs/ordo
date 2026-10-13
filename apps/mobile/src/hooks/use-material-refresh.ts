import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import type { GestureResponderEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { beginRefreshPull, finishRefreshPull, moveRefreshPull, type RefreshPull } from "../lib/pull-refresh";
import { haptics } from "../lib/haptics";
import { PTR_THRESHOLD } from "../lib/pull-refresh";

/** Material indicator with a simultaneous native observer, not a scroll responder. */
export function useMaterialRefresh(refreshing: boolean, onRefresh?: (() => void) | null, enabled = true, commitOnRelease = true) {
  const offset = useRef(0);
  const pull = useRef<RefreshPull | null>(null);
  const committed = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dy, setDy] = useState(0);
  const options = useRef({ refreshing, onRefresh, enabled, commitOnRelease });
  options.current = { refreshing, onRefresh, enabled, commitOnRelease };
  useEffect(() => {
    if (!refreshing) committed.current = false;
  }, [refreshing]);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  const cancel = useCallback(() => {
    pull.current = null;
    setDy(0);
  }, []);
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
      resetTimer.current = setTimeout(() => { committed.current = false; }, 1000);
    }
  }, [cancel]);
  const begin = useCallback((x: number, y: number, touches: number) => {
    const { enabled, onRefresh, refreshing } = options.current;
    setDy(0);
    pull.current = beginRefreshPull(x, y, offset.current,
      enabled && !!onRefresh && !refreshing && !committed.current && touches === 1);
    return pull.current.eligible;
  }, []);
  const move = useCallback((x: number, y: number, touches: number) => {
    if (!pull.current) return;
    if (!options.current.enabled || options.current.refreshing) { cancel(); return; }
    const previous = pull.current.distance;
    pull.current = moveRefreshPull(pull.current, x, y, offset.current, touches);
    if (previous < PTR_THRESHOLD && pull.current.distance >= PTR_THRESHOLD) haptics.selection();
    if (Math.abs(previous - pull.current.distance) >= 3 || pull.current.distance === 0) setDy(pull.current.distance);
  }, [cancel]);

  const gesture = useMemo(() => {
    if (Platform.OS === "web") return undefined;
    // JS onTouchMove/onTouchEnd are cancelled when native scrolling activates.
    // RNGH observes the entire stream, simultaneously with the real scroller.
    // Activate only on a downward pull, leaving taps/long-press selection alone.
    const observer = Gesture.Manual().enabled(enabled).runOnJS(true)
      .cancelsTouchesInView(false)
      .onTouchesDown((event, manager) => {
        const touch = event.allTouches[0];
        if (!touch || !begin(touch.absoluteX, touch.absoluteY, event.numberOfTouches)) manager.fail();
        else manager.begin();
      })
      .onTouchesMove((event, manager) => {
        const touch = event.allTouches[0];
        if (!touch) { cancel(); manager.fail(); return; }
        move(touch.absoluteX, touch.absoluteY, event.numberOfTouches);
        if (!pull.current?.eligible) manager.fail();
        else if (pull.current.distance >= 8) manager.activate();
      })
      .onTouchesUp((_event, manager) => { finish(); manager.end(); })
      .onTouchesCancelled((_event, manager) => { cancel(); manager.fail(); })
      .onFinalize(cancel);
    return Gesture.Simultaneous(Gesture.Native(), observer);
  }, [enabled, begin, move, finish, cancel]);

  return {
    dy,
    gesture,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = event.nativeEvent.contentOffset.y; },
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
