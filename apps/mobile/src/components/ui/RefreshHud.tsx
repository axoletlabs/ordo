/**
 * Branded pull-to-refresh chip. Follows the finger, arms only after a
 * safe distance, and springs back up on cancel or when the reload ends.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  PanResponder,
  StyleSheet,
  type GestureResponderHandlers,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import {
  PTR_MAX_FOLLOW,
  PTR_THRESHOLD,
  listIsAtTop,
  listRefreshOverscrollDy,
  shouldCommitPtr,
} from "../../lib/pull-refresh";
import { haptics } from "../../lib/haptics";
import { useTheme } from "../../theme/ThemeProvider";
import { springs, spacing, timing } from "../../theme/tokens";
import { ReloadSpinner } from "./Spinner";

export function RefreshHud({
  dy,
  refreshing,
}: {
  dy: number;
  refreshing: boolean;
}) {
  const { palette } = useTheme();
  const pull = useSharedValue(0);
  const refreshingSv = useSharedValue(refreshing);
  const [mounted, setMounted] = useState(dy > 0 || refreshing);

  useEffect(() => {
    refreshingSv.value = refreshing;
  }, [refreshing, refreshingSv]);

  useEffect(() => {
    if (refreshing || dy > 0) {
      setMounted(true);
      if (refreshing) {
        pull.value = withSpring(PTR_THRESHOLD, springs.snappy);
      } else {
        pull.value = dy;
      }
      return;
    }
    pull.value = withTiming(0, { duration: timing.normal, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
  }, [dy, pull, refreshing]);

  const hudStyle = useAnimatedStyle(() => {
    const raw = Math.max(0, pull.value);
    const progress = Math.min(1, raw / PTR_THRESHOLD);
    const translateY =
      raw <= PTR_THRESHOLD
        ? raw * 0.55
        : Math.min(PTR_MAX_FOLLOW, PTR_THRESHOLD * 0.55 + (raw - PTR_THRESHOLD) * 0.18);
    const rotate = refreshingSv.value ? 0 : progress * 270;
    return {
      opacity: Math.min(1, progress / 0.32),
      transform: [{ translateY }, { scale: 0.4 + progress * 0.6 }, { rotate: `${rotate}deg` }],
    };
  });

  if (!mounted) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ptrHud, hudStyle]}
      accessibilityRole={refreshing ? "progressbar" : undefined}
      accessibilityLabel={refreshing ? "Refreshing" : undefined}
    >
      <ReloadSpinner
        spinning={refreshing}
        color={palette.accent}
        backgroundColor={palette.surfaceElevated}
        borderColor={palette.borderStrong}
      />
    </Animated.View>
  );
}

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

export function useBrandedRefresh(
  refreshing: boolean | null | undefined,
  onRefresh: (() => void) | null | undefined,
  refreshControl?: React.ReactElement,
) {
  const [ptrDy, setPtrDy] = useState(0);
  const atTopRef = useRef(true);
  const dyRef = useRef(0);
  const refreshingRef = useRef(!!refreshing);
  const prevRefreshingRef = useRef(!!refreshing);
  const holdRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const armedHapticRef = useRef(false);
  onRefreshRef.current = onRefresh;

  const setDy = useCallback((next: number) => {
    dyRef.current = next;
    setPtrDy((prev) => (Math.abs(prev - next) < 2 ? prev : next));
  }, []);

  const armHaptic = useCallback((dy: number) => {
    if (dy >= PTR_THRESHOLD && !armedHapticRef.current) {
      armedHapticRef.current = true;
      haptics.selection();
    } else if (dy < PTR_THRESHOLD) {
      armedHapticRef.current = false;
    }
  }, []);

  const commitOrDismiss = useCallback((dy: number) => {
    armedHapticRef.current = false;
    if (shouldCommitPtr(dy, refreshingRef.current)) {
      holdRef.current = true;
      dyRef.current = PTR_THRESHOLD;
      setPtrDy(PTR_THRESHOLD);
      onRefreshRef.current?.();
      return;
    }
    dyRef.current = 0;
    setPtrDy(0);
  }, []);

  useEffect(() => {
    const next = !!refreshing;
    refreshingRef.current = next;
    if (next) {
      holdRef.current = false;
      dyRef.current = PTR_THRESHOLD;
      setPtrDy(PTR_THRESHOLD);
    } else if (prevRefreshingRef.current) {
      holdRef.current = false;
      dyRef.current = 0;
      setPtrDy(0);
    }
    prevRefreshingRef.current = next;
  }, [refreshing]);

  const onScroll = useCallback(
    (event: ScrollEvent) => {
      const y = event.nativeEvent.contentOffset.y;
      atTopRef.current = listIsAtTop(y);
      if (Platform.OS !== "ios" || refreshingRef.current || holdRef.current) return;
      const next = listRefreshOverscrollDy(y);
      setDy(next);
      armHaptic(next);
    },
    [armHaptic, setDy],
  );

  const onScrollEndDrag = useCallback(
    (event: ScrollEvent) => {
      if (Platform.OS !== "ios" || refreshingRef.current || holdRef.current) return;
      const dy = listRefreshOverscrollDy(event.nativeEvent.contentOffset.y);
      if (shouldCommitPtr(dy, false)) {
        commitOrDismiss(dy);
      }
    },
    [commitOrDismiss],
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => {
        if (Platform.OS === "ios") return false;
        if (refreshingRef.current || holdRef.current || !onRefreshRef.current) return false;
        return atTopRef.current && gesture.dy > 8 && gesture.dy > Math.abs(gesture.dx);
      },
      onMoveShouldSetPanResponderCapture: (_, gesture) => {
        if (Platform.OS === "ios") return false;
        if (refreshingRef.current || holdRef.current || !onRefreshRef.current) return false;
        return atTopRef.current && gesture.dy > 8 && gesture.dy > Math.abs(gesture.dx);
      },
      onPanResponderMove: (_, gesture) => {
        const dy = Math.max(0, gesture.dy);
        dyRef.current = dy;
        setPtrDy((prev) => (Math.abs(prev - dy) < 4 ? prev : dy));
        if (dy >= PTR_THRESHOLD && !armedHapticRef.current) {
          armedHapticRef.current = true;
          haptics.selection();
        } else if (dy < PTR_THRESHOLD) {
          armedHapticRef.current = false;
        }
      },
      onPanResponderRelease: () => {
        commitOrDismiss(dyRef.current);
      },
      onPanResponderTerminate: () => {
        if (!refreshingRef.current) {
          dyRef.current = 0;
          setPtrDy(0);
        }
      },
    }),
  ).current;

  const enabled = !refreshControl && (refreshing != null || onRefresh != null);
  if (!enabled) {
    return {
      refreshControl,
      hud: null as React.ReactNode,
      onScroll: undefined,
      onScrollEndDrag: undefined,
      panHandlers: undefined as GestureResponderHandlers | undefined,
    };
  }

  return {
    refreshControl: undefined,
    hud: <RefreshHud dy={ptrDy} refreshing={!!refreshing} />,
    onScroll,
    onScrollEndDrag,
    panHandlers: Platform.OS === "ios" ? undefined : panResponder.panHandlers,
  };
}

const styles = StyleSheet.create({
  ptrHud: {
    position: "absolute",
    top: spacing[8],
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 2,
  },
});
