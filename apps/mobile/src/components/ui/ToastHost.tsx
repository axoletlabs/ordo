/**
 * ToastHost — renders queued toasts at the bottom. Each toast enters with a
 * spring, auto-dismisses after its duration, and can be swiped away or carry an
 * inline action. Driven by two shared values (enter + swipe offset) so the
 * enter/exit and swipe animations never fight.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { Platform, StyleSheet } from "react-native";
import { MaterialIcon } from "./MaterialIcon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useToastStore, type Toast } from "./toast-store";
import { Text } from "./Text";
import { PressableScale } from "./PressableScale";
import { useTheme } from "../../theme/ThemeProvider";
import { SCREEN_RAIL, contentInset } from "../../theme/alignment";
import { useSceneColumnInsets } from "../../hooks/use-scene-column-insets";
import { radius, springs, spacing } from "../../theme/tokens";
import { useFloatingDockMetrics } from "../../hooks/use-floating-dock-metrics";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { useFloatingActions } from "../../store/floating-actions";

const SWIPE_THRESHOLD = 80;
const SWIPE_VELOCITY = 600;

function ToastItem({ toast }: { toast: Toast }) {
  const { palette, shadows } = useTheme();
  const motion = useMaterialMotion();
  const dismiss = useToastStore((s) => s.dismiss);
  const dismissed = useRef(false);

  // 0 → 1 enter/exit; horizontal px for swipe.
  const enter = useSharedValue(0);
  const offsetX = useSharedValue(0);

  const animateOut = useCallback(() => {
    if (dismissed.current) return;
    dismissed.current = true;
    enter.value = withTiming(0, { duration: motion.reducedMotion ? 0 : 200 }, () => runOnJS(dismiss)(toast.id));
  }, [dismiss, enter, toast.id, motion.reducedMotion]);

  // Enter, then schedule an auto-dismiss.
  useEffect(() => {
    enter.value = motion.reducedMotion ? 1 : withSpring(1, materialMotion.effects.spatial);
    if (toast.action || Platform.OS === "web") return;
    const timer = setTimeout(animateOut, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, enter, animateOut, motion.spatial, motion.reducedMotion]);

  const pan = Gesture.Pan()
    .enabled(toast.swipeable)
    .onUpdate((e) => {
      offsetX.value = e.translationX;
    })
    .onEnd((e) => {
      const past = Math.abs(offsetX.value) > SWIPE_THRESHOLD || Math.abs(e.velocityX) > SWIPE_VELOCITY;
      if (past) {
        const dir = Math.sign(offsetX.value) || 1;
        offsetX.value = withSpring(dir * 500, springs.snappy, () => runOnJS(animateOut)());
      } else {
        offsetX.value = withSpring(0, springs.gentle);
      }
    });

  const animStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateX: offsetX.value }, { translateY: (1 - enter.value) * 20 }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessibilityRole="alert"
        accessibilityLiveRegion={toast.tone === "danger" ? "assertive" : "polite"}
        testID="material-snackbar"
        style={[
          styles.toast,
          {
            backgroundColor: palette.inverseSurface,
            borderRadius: radius.xs,
          },
          shadows.level2,
          animStyle,
        ]}
      >
        <Text variant="bodyMedium" style={[styles.message, { color: palette.inverseOnSurface }]}>
          {toast.message}
        </Text>
        {toast.action ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={toast.action.label}
            stateLayerColor={palette.inversePrimary}
            hitSlop={6}
            onPress={() => {
              toast.action!.onPress();
              animateOut();
            }}
            style={styles.actionHit}
          >
            <Text variant="labelLarge" numberOfLines={1} style={[styles.action, { color: palette.inversePrimary }]}>
              {toast.action.label}
            </Text>
          </PressableScale>
        ) : null}
        {toast.action || Platform.OS === "web" ? <PressableScale accessibilityRole="button" accessibilityLabel="Dismiss notification"
          stateLayerColor={palette.inverseOnSurface} onPress={animateOut} style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}>
          <MaterialIcon name="close" color={palette.inverseOnSurface} />
        </PressableScale> : null}
      </Animated.View>
    </GestureDetector>
  );
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const { overlayClearance } = useFloatingDockMetrics();
  const hasFab = useFloatingActions((state) => state.ids.length > 0);
  const insets = useSafeAreaInsets();
  const { lead } = useSceneColumnInsets();
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.host,
        {
          paddingBottom: overlayClearance + (hasFab ? 72 : 0),
          paddingLeft: lead > 0 ? lead + SCREEN_RAIL : contentInset(insets.left),
          paddingRight: contentInset(insets.right),
        },
      ]}
    >
      {toasts.slice(0, 1).map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 100 },
  toast: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
    paddingHorizontal: spacing[16],
    marginTop: spacing[8],
    minHeight: 48,
  },
  message: { flex: 1, minWidth: 0, includeFontPadding: false, paddingVertical: spacing[14] },
  // Actions retain a full touch target without making the container taller.
  actionHit: {
    flexShrink: 0,
    minHeight: 48,
    justifyContent: "center",
  },
  action: { includeFontPadding: false },
});
