/**
 * ToastHost — the app's single notification surface, mounted once above
 * every scene. A floating, elevated tonal card: a leading status icon
 * carries the tone (success/danger), the message sits on the shared
 * elevated surface. Enters on a spatial spring (rise + settle), exits on
 * a fast fade, carries an optional inline action, and can be swiped away
 * to either side or downward. Driven by shared values (enter, spatial,
 * swipe offsets) so the enter/exit and swipe animations never fight.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, type View as ViewType } from "react-native";
import { MaterialIcon } from "./MaterialIcon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
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

/** The lifetime a toast displays (action toasts keep the 8s floor). */
function toastDuration(toast: Toast): number {
  return toast.action ? Math.max(toast.duration, ACTION_TOAST_FLOOR_MS) : toast.duration;
}

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
  const surfaceRef = useRef<ViewType>(null);
  React.useLayoutEffect(() => {
    if (Platform.OS === "web" && surfaceRef.current) (surfaceRef.current as unknown as HTMLElement).inert = !active || closing;
  }, [active, closing]);

  // 0 → 1 enter/exit and settle; horizontal + downward px for swipe.
  const enter = useSharedValue(0);
  const spatial = useSharedValue(0);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const swipeStartX = useSharedValue(0);
  const swipeStartY = useSharedValue(0);
  const dragging = useSharedValue(false);
  const [swiping, setSwiping] = useState(false);

  // Tone reads at a glance through the canonical Material status icons
  // (checkmark-circle → check-circle, alert-circle → error); default toasts
  // stay quiet.
  const statusIcon: "checkmark-circle" | "alert-circle" | null =
    toast.tone === "success" ? "checkmark-circle" : toast.tone === "danger" ? "alert-circle" : null;
  const statusColor = toast.tone === "danger" ? palette.error : palette.primary;

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
    spatial.value = motion.reducedMotion ? 1 : withSpring(1, motion.spatial);
  }, [enter, spatial, motion.reducedMotion, motion.fast]);
  useEffect(() => {
    // Hover/focus may pause the timer, but must never restart an exit fade.
    if (dismissed.current || hovered || focused || swiping) return;
    const duration = toastDuration(toast);
    let activeTimer = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (timeout: number) => { if (activeTimer) timer = setTimeout(animateOut, Math.max(duration, timeout)); };
    if (Platform.OS === "android") AccessibilityInfo.getRecommendedTimeoutMillis(duration).then(schedule, () => schedule(duration));
    else schedule(duration);
    return () => { activeTimer = false; if (timer) clearTimeout(timer); };
  }, [toast.id, toast.duration, toast.action, animateOut, hovered, focused, swiping]);

  // Rebuilding the gesture per render (hover/focus/store updates) re-attaches
  // detectors on the exact frames a delete/undo toast competes with the list.
  // The pan activates on horizontal movement in either direction or a
  // downward drag; moving up fails it so scrolling content passes through.
  const pan = useMemo(() => Gesture.Pan()
    .enabled(toast.swipeable && active && !closing)
    .activeOffsetX([-10, 10])
    .activeOffsetY(12)
    .failOffsetY(-16)
    .onStart(() => {
      cancelAnimation(offsetX); cancelAnimation(offsetY);
      swipeStartX.value = offsetX.value; swipeStartY.value = offsetY.value;
      dragging.value = true; runOnJS(setSwiping)(true);
    })
    .onUpdate((e) => {
      offsetX.value = swipeStartX.value + e.translationX;
      offsetY.value = Math.max(0, swipeStartY.value + e.translationY);
    })
    .onEnd((e) => {
      const pastX = Math.abs(offsetX.value) > SWIPE_THRESHOLD || Math.abs(e.velocityX) > SWIPE_VELOCITY;
      const pastY = offsetY.value > SWIPE_THRESHOLD || e.velocityY > SWIPE_VELOCITY;
      if (pastX) {
        const dir = Math.sign(Math.abs(e.velocityX) > SWIPE_VELOCITY ? e.velocityX : offsetX.value) || 1;
        if (motion.reducedMotion) runOnJS(animateOut)();
        else offsetX.value = withSpring(dir * 500, { ...motion.spatial, velocity: e.velocityX }, (finished) => { if (finished) runOnJS(animateOut)(); });
        offsetY.value = motion.reducedMotion ? 0 : withSpring(0, motion.fast);
      } else if (pastY) {
        if (motion.reducedMotion) runOnJS(animateOut)();
        else offsetY.value = withSpring(400, { ...motion.spatial, velocity: e.velocityY }, (finished) => { if (finished) runOnJS(animateOut)(); });
        offsetX.value = motion.reducedMotion ? 0 : withSpring(0, motion.fast);
      } else {
        offsetX.value = motion.reducedMotion ? 0 : withSpring(0, { ...motion.spatial, velocity: e.velocityX });
        offsetY.value = motion.reducedMotion ? 0 : withSpring(0, { ...motion.spatial, velocity: e.velocityY });
      }
      dragging.value = false;
    })
    .onFinalize(() => {
      if (dragging.value) {
        offsetX.value = motion.reducedMotion ? 0 : withSpring(0, motion.spatial);
        offsetY.value = motion.reducedMotion ? 0 : withSpring(0, motion.spatial);
      }
      dragging.value = false; runOnJS(setSwiping)(false);
    }), [active, closing, toast.swipeable, motion.reducedMotion, motion.spatial, motion.fast, animateOut, offsetX, offsetY, swipeStartX, swipeStartY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateX: offsetX.value },
      { translateY: (1 - spatial.value) * 24 + offsetY.value },
      { scale: 0.94 + 0.06 * spatial.value },
    ],
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
            backgroundColor: palette.surfaceContainerHigh,
            borderColor: palette.outlineVariant,
          },
          shadows.level3,
          animStyle,
        ]}
      >
        {statusIcon ? (
          <MaterialIcon name={statusIcon} size={24} color={statusColor} />
        ) : null}
        <Text variant="bodyMedium" style={[styles.message, { color: palette.onSurface }]}>
          {toast.message}
        </Text>
        {toast.action ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={toast.action.label}
            stateLayerColor={palette.onSurface}
            hitSlop={6}
            onPress={() => {
              if (dismissed.current || toast.action!.onPress() === false) return;
              animateOut();
            }}
            style={styles.actionHit}
          >
            <Text variant="labelLarge" numberOfLines={1} style={[styles.action, { color: palette.primary }]}>
              {toast.action.label}
            </Text>
          </PressableScale>
        ) : null}
        {toast.action || Platform.OS === "web" ? <PressableScale accessibilityRole="button" accessibilityLabel="Dismiss notification"
          stateLayerColor={palette.onSurface} onPress={animateOut} style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}>
          <MaterialIcon name="close" size={20} color={palette.onSurfaceVariant} />
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
    gap: spacing[12],
    paddingHorizontal: spacing[16],
    marginTop: spacing[8],
    minHeight: 56,
    minWidth: 48,
    borderWidth: 1,
    borderRadius: radius.lg,
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
