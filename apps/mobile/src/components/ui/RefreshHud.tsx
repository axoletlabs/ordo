/**
 * Shared contained Material loading indicator for lists and the in-app website.
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
import { spacing, timing } from "../../theme/tokens";
import { useMaterialMotion } from "../../theme/material-motion";
import { ReloadSpinner } from "./Spinner";

export function RefreshHud({
  dy,
  refreshing,
}: {
  dy: number;
  refreshing: boolean;
}) {
  const motion = useMaterialMotion();
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
        pull.value = motion.reducedMotion ? PTR_THRESHOLD : withSpring(PTR_THRESHOLD, motion.fast);
      } else {
        pull.value = dy;
      }
      return;
    }
    pull.value = withTiming(0, { duration: motion.reducedMotion ? 0 : timing.normal, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
  }, [dy, pull, refreshing, motion.fast, motion.reducedMotion]);

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
      transform: [{ translateY: motion.reducedMotion ? PTR_THRESHOLD * 0.55 : translateY },
        { scale: motion.reducedMotion ? 1 : 0.4 + progress * 0.6 }, { rotate: `${motion.reducedMotion ? 0 : rotate}deg` }],
    };
  });

  if (!mounted) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ptrHud, hudStyle]}
      accessibilityRole={refreshing ? "progressbar" : undefined}
      accessibilityLabel={refreshing ? "Refreshing" : undefined}
      accessibilityState={refreshing ? { busy: true } : undefined}
    >
      <ReloadSpinner spinning={refreshing} />
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
