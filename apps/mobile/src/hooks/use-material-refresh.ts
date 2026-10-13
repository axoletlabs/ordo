import { useEffect, useRef, useState } from "react";
import type { GestureResponderEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { beginRefreshPull, finishRefreshPull, moveRefreshPull, type RefreshPull } from "../lib/pull-refresh";
import { haptics } from "../lib/haptics";
import { PTR_THRESHOLD } from "../lib/pull-refresh";

/** Custom indicator, native scrolling. No PanResponder or nested ScrollView. */
export function useMaterialRefresh(refreshing: boolean, onRefresh?: (() => void) | null, enabled = true, commitOnRelease = true) {
  const offset = useRef(0);
  const pull = useRef<RefreshPull | null>(null);
  const committed = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dy, setDy] = useState(0);
  useEffect(() => {
    if (!refreshing) committed.current = false;
  }, [refreshing]);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  const finish = () => {
    const shouldRefresh = finishRefreshPull(pull.current, refreshing || committed.current);
    pull.current = null;
    setDy(0);
    if (!shouldRefresh || !onRefresh || !commitOnRelease) return;
    committed.current = true;
    haptics.light();
    try { onRefresh(); } finally {
      // A caller that never sets refreshing must not permanently lock the gesture.
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => { committed.current = false; }, 1000);
    }
  };
  return {
    dy,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = event.nativeEvent.contentOffset.y; },
    onTouchStart: (event: GestureResponderEvent) => {
      const { touches } = event.nativeEvent;
      const { pageX, pageY } = touches[0] ?? event.nativeEvent;
      pull.current = beginRefreshPull(pageX, pageY, offset.current,
        enabled && !!onRefresh && !refreshing && !committed.current && touches.length === 1);
    },
    onTouchMove: (event: GestureResponderEvent) => {
      if (!pull.current) return;
      const { touches } = event.nativeEvent;
      const { pageX, pageY } = touches[0] ?? event.nativeEvent;
      const previous = pull.current.distance;
      pull.current = moveRefreshPull(pull.current, pageX, pageY, offset.current, touches.length);
      if (previous < PTR_THRESHOLD && pull.current.distance >= PTR_THRESHOLD) haptics.selection();
      if (Math.abs(previous - pull.current.distance) >= 3 || pull.current.distance === 0) setDy(pull.current.distance);
    },
    onTouchEnd: (_event: GestureResponderEvent) => { finish(); },
    onTouchCancel: (_event: GestureResponderEvent) => { pull.current = null; setDy(0); },
    onScrollEndDrag: (_event: NativeSyntheticEvent<NativeScrollEvent>) => { finish(); },
  };
}
