/**
 * ToastHost — renders queued toasts at the bottom. Each toast enters with a
 * spring, auto-dismisses after its duration, and can be swiped away or carry an
 * inline action. Driven by two shared values (enter + swipe offset) so the
 * enter/exit and swipe animations never fight.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
import { radius, springs, spacing } from "../../theme/tokens";
import { useFloatingDockMetrics } from "../../hooks/use-floating-dock-metrics";

const SWIPE_THRESHOLD = 80;
const SWIPE_VELOCITY = 600;

function ToastItem({ toast }: { toast: Toast }) {
  const { palette, shadows } = useTheme();
  const dismiss = useToastStore((s) => s.dismiss);
  const dismissed = useRef(false);

  // 0 → 1 enter/exit; horizontal px for swipe.
  const enter = useSharedValue(0);
  const offsetX = useSharedValue(0);

  const animateOut = useCallback(() => {
    if (dismissed.current) return;
    dismissed.current = true;
    enter.value = withTiming(0, { duration: 220 }, () => runOnJS(dismiss)(toast.id));
  }, [dismiss, enter, toast.id]);

  // Enter, then schedule an auto-dismiss.
  useEffect(() => {
    enter.value = withSpring(1, springs.gentle);
    const timer = setTimeout(animateOut, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, enter, animateOut]);

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

  const iconName =
    toast.tone === "success"
      ? "checkmark-circle"
      : toast.tone === "danger"
        ? "alert-circle"
        : "information-circle";
  const iconColor =
    toast.tone === "success" ? palette.green : toast.tone === "danger" ? palette.coral : palette.blue;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          styles.toast,
          {
            backgroundColor:
              toast.tone === "danger"
                ? palette.dangerSoft
                : palette.surfaceElevated,
            borderColor: palette.borderStrong,
            borderRadius: radius.xl,
          },
          shadows.level2,
          animStyle,
        ]}
      >
        <Ionicons name={iconName as any} size={16} color={iconColor} />
        <Text variant="footnote" style={{ flex: 1, color: palette.text }}>
          {toast.message}
        </Text>
        {toast.action ? (
          <PressableScale
            scaleTo={0.92}
            hitSlop={6}
            onPress={() => {
              toast.action!.onPress();
              animateOut();
            }}
          >
            <Text variant="footnote" style={{ color: palette.accent, fontWeight: "700" }}>
              {toast.action.label}
            </Text>
          </PressableScale>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const { overlayClearance } = useFloatingDockMetrics();
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.host,
        {
          paddingBottom: overlayClearance,
          paddingLeft: Math.max(insets.left, spacing[16]),
          paddingRight: Math.max(insets.right, spacing[16]),
        },
      ]}
    >
      {toasts.map((t) => (
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
    paddingHorizontal: spacing[14],
    paddingVertical: spacing[12],
    marginTop: spacing[8],
    borderWidth: StyleSheet.hairlineWidth,
  },
});
