/**
 * ToastHost — renders queued toasts at the bottom. Each toast enters with a
 * spring, auto-dismisses after its duration, and can be swiped away or carry an
 * inline action. Driven by two shared values (enter + swipe offset) so the
 * enter/exit and swipe animations never fight.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, type View } from "react-native";
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
import { radius, spacing } from "../../theme/tokens";
import { useFloatingDockMetrics } from "../../hooks/use-floating-dock-metrics";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { useFloatingActions } from "../../store/floating-actions";

const SWIPE_THRESHOLD = 80;
const SWIPE_VELOCITY = 600;
/** Action toasts never auto-dismiss faster than this. */
const ACTION_TOAST_FLOOR_MS = 8_000;

function ToastItem({ toast, active, onExited }: { toast: Toast; active: boolean; onExited: (id: string) => void }) {
  const { palette, shadows } = useTheme();
  const motion = useMaterialMotion();
  const dismiss = useToastStore((s) => s.dismiss);
  const dismissed = useRef(false);
  const finished = useRef(false);
  const closeFallback = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [closing, setClosing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const surfaceRef = useRef<View>(null);
  React.useLayoutEffect(() => {
    if (Platform.OS === "web" && surfaceRef.current) (surfaceRef.current as unknown as HTMLElement).inert = !active || closing;
  }, [active, closing]);

  // 0 → 1 enter/exit; horizontal px for swipe.
  const enter = useSharedValue(0);
  const spatial = useSharedValue(0);
  const offsetX = useSharedValue(0);

  const finishExit = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    clearTimeout(closeFallback.current);
    dismiss(toast.id);
    onExited(toast.id);
  }, [dismiss, onExited, toast.id]);
  useEffect(() => () => clearTimeout(closeFallback.current), []);

  const animateOut = useCallback(() => {
    if (dismissed.current) return;
    dismissed.current = true;
    setClosing(true);
    spatial.value = motion.reducedMotion ? 0 : withSpring(0, motion.fast);
    if (motion.reducedMotion) { enter.value = 0; finishExit(); return; }
    enter.value = withTiming(0, { duration: 200 }, (complete) => { if (complete) runOnJS(finishExit)(); });
    closeFallback.current = setTimeout(finishExit, 270);
  }, [enter, spatial, finishExit, motion.reducedMotion, motion.fast]);
  useEffect(() => { if (!active) animateOut(); }, [active, animateOut]);
  useEffect(() => { if (closing && motion.reducedMotion) finishExit(); }, [closing, motion.reducedMotion, finishExit]);

  // Enter, then schedule an auto-dismiss. Action toasts keep their explicit
  // close button but still time out — with a longer floor so the action can
  // be read and tapped. Web keeps the close button and gains the same timer.
  useEffect(() => {
    if (dismissed.current) return;
    enter.value = motion.reducedMotion ? 1 : withSpring(1, materialMotion.effects.spatial);
    spatial.value = motion.reducedMotion ? 1 : withSpring(1, motion.fast);
  }, [enter, spatial, motion.reducedMotion, motion.fast]);
  useEffect(() => {
    // Hover/focus may pause the timer, but must never restart an exit fade.
    if (dismissed.current || hovered || focused) return;
    const duration = toast.action ? Math.max(toast.duration, ACTION_TOAST_FLOOR_MS) : toast.duration;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (timeout: number) => { if (active) timer = setTimeout(animateOut, Math.max(duration, timeout)); };
    if (Platform.OS === "android") AccessibilityInfo.getRecommendedTimeoutMillis(duration).then(schedule, () => schedule(duration));
    else schedule(duration);
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [toast.id, toast.duration, toast.action, animateOut, hovered, focused]);

  // Rebuilding the gesture per render (hover/focus/store updates) re-attaches
  // detectors on the exact frames a delete/undo toast competes with the list.
  const pan = useMemo(() => Gesture.Pan()
    .enabled(toast.swipeable)
    .onUpdate((e) => {
      offsetX.value = e.translationX;
    })
    .onEnd((e) => {
      const past = Math.abs(offsetX.value) > SWIPE_THRESHOLD || Math.abs(e.velocityX) > SWIPE_VELOCITY;
      if (past) {
        const dir = Math.sign(offsetX.value) || 1;
        if (motion.reducedMotion) runOnJS(animateOut)();
        else offsetX.value = withSpring(dir * 500, motion.spatial, (finished) => { if (finished) runOnJS(animateOut)(); });
      } else {
        offsetX.value = motion.reducedMotion ? 0 : withSpring(0, motion.spatial);
      }
    }), [toast.swipeable, motion.reducedMotion, motion.spatial, animateOut, offsetX]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateX: offsetX.value }, { translateY: (1 - spatial.value) * 20 }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        ref={surfaceRef}
        pointerEvents={active && !closing ? "auto" : "none"}
        aria-hidden={!active || closing}
        accessibilityElementsHidden={!active || closing}
        importantForAccessibility={active && !closing ? "auto" : "no-hide-descendants"}
        onPointerEnter={(event) => { if (event.nativeEvent.pointerType !== "touch") setHovered(true); }}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(event) => { if (Platform.OS !== "web" || !(event.currentTarget as unknown as HTMLElement).contains((event as unknown as { relatedTarget: Node }).relatedTarget)) setFocused(false); }}
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
              if (dismissed.current || toast.action!.onPress() === false) return;
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
  const next = toasts[0] ?? null;
  const [displayed, setDisplayed] = useState<Toast | null>(next);
  if (!displayed && next) setDisplayed(next);
  const finishExit = useCallback((id: string) => setDisplayed(current => current?.id === id ? null : current), []);
  const { overlayClearance } = useFloatingDockMetrics();
  const hasFab = useFloatingActions((state) => state.ids.length > 0);
  const insets = useSafeAreaInsets();
  const { lead } = useSceneColumnInsets();
  const motion = useMaterialMotion();
  const bottom = overlayClearance + (hasFab ? 72 : 0);
  const clearance = useSharedValue(bottom);
  React.useLayoutEffect(() => {
    clearance.value = motion.reducedMotion ? bottom : withSpring(bottom, motion.spatial);
  }, [bottom, clearance, motion]);
  const clearanceStyle = useAnimatedStyle(() => ({ paddingBottom: clearance.value }));
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.host,
        {
          paddingLeft: lead > 0 ? lead + SCREEN_RAIL : contentInset(insets.left),
          paddingRight: contentInset(insets.right),
        },
        clearanceStyle,
      ]}
    >
      {displayed ? <ToastItem key={displayed.id} toast={displayed} active={displayed.id === next?.id} onExited={finishExit} /> : null}
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
    minWidth: 48,
  },
  message: { flex: 1, minWidth: 0, includeFontPadding: false, paddingVertical: spacing[14] },
  // Actions retain a full touch target without making the container taller.
  actionHit: {
    flexShrink: 0,
    minHeight: 48,
    minWidth: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  action: { includeFontPadding: false },
});
