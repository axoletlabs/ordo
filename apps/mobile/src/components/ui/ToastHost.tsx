/**
 * ToastHost — renders queued toasts at the bottom. Each toast enters with a
 * spring, auto-dismisses after its duration, and can be swiped away or carry an
 * inline action. Driven by two shared values (enter + swipe offset) so the
 * enter/exit and swipe animations never fight.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { MaterialIcon as Ionicons } from "./MaterialIcon";
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
import { iconGlyphStyle } from "../../theme/icon-glyph";
import { FOOTNOTE_LINE_BOX } from "../../theme/type-metrics";
import { useSceneColumnInsets } from "../../hooks/use-scene-column-insets";
import { radius, springs, spacing } from "../../theme/tokens";
import { useFloatingDockMetrics } from "../../hooks/use-floating-dock-metrics";
import { useMaterialMotion } from "../../theme/material-motion";

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
    enter.value = motion.reducedMotion ? 1 : withSpring(1, motion.spatial);
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

  const iconName =
    toast.tone === "success"
      ? "checkmark-circle"
      : toast.tone === "danger"
        ? "alert-circle"
        : "information-circle";
  const iconColor = palette.inversePrimary;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
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
        <View style={styles.icon}>
          <Ionicons name={iconName as any} size={16} color={iconColor} style={iconGlyphStyle(16)} />
        </View>
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
      </Animated.View>
    </GestureDetector>
  );
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const { overlayClearance } = useFloatingDockMetrics();
  const insets = useSafeAreaInsets();
  const { lead } = useSceneColumnInsets();
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.host,
        {
          paddingBottom: overlayClearance,
          paddingLeft: lead > 0 ? lead + SCREEN_RAIL : contentInset(insets.left),
          paddingRight: contentInset(insets.right),
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
    minHeight: 48,
  },
  icon: {
    width: 16,
    height: FOOTNOTE_LINE_BOX,
    alignItems: "center",
    justifyContent: "center",
  },
  message: { flex: 1, minWidth: 0, includeFontPadding: false },
  // Same first-line box as the icon, but the label keeps its own width.
  // The icon slot is 16px; putting Download / Restart in it clipped them.
  actionHit: {
    flexShrink: 0,
    minHeight: 48,
    justifyContent: "center",
  },
  action: { includeFontPadding: false },
});
