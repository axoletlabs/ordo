/**
 * Branded pull-to-refresh chip for the in-app website. Lists use a themed
 * native RefreshControl so scrolling and the overlay scrollbar stay intact.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { PTR_MAX_FOLLOW, PTR_THRESHOLD } from "../../lib/pull-refresh";
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
